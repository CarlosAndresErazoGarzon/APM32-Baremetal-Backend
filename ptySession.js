/**
 * ptySession.js
 * A real, persistent interactive shell for Playground's Console tab --
 * replaces the old one-shot-per-command model (see learnRunner.js's
 * execCommand(), still used by two unit tests directly but no longer by
 * any HTTP route). That model couldn't support a program mid-`scanf()`
 * accepting more input, because there was no live process left to send it
 * to by the time the client could react -- each command ran to completion
 * inside one HTTP request/response.
 *
 * This spawns one real pty-backed bash per WebSocket connection (see
 * server.js's '/playground/pty' handler) using the SAME disposable-jobDir
 * + uid/gid-drop sandboxing envelope learnRunner.js already built and
 * tested, so `cd`, running a compiled binary, everything just works the
 * way a real terminal would -- no CWD_MARKER parsing needed here at all,
 * since the shell process itself is the one thing keeping that state now.
 *
 * File sync, jobDir -> client: because the shell can now stay open
 * indefinitely (not one request per command), there's no single "end of
 * the exec() call" moment to diff jobDir against the file manager like the
 * old flow did. This used to poll jobDir on a fixed clock (every 2s,
 * regardless of whether anything was happening) -- replaced after a real
 * incident (a background clock ticking during active typing raced the
 * editor and periodically clobbered it, see ConsoleUI.js's own history)
 * with a debounce keyed off the pty's OWN output instead: every time the
 * shell prints anything, a short quiet-timer resets; once output actually
 * stops for OUTPUT_QUIET_MS, that's a good proxy for "a command just
 * finished" (or at least stopped producing output), and exactly one poll
 * runs then. No clock runs at all while the student is just sitting in
 * the editor with an idle terminal -- there's nothing to be quiet after.
 *
 * File sync, client -> jobDir: the OTHER direction. The session's jobDir
 * is only ever seeded ONCE, when the session is created -- if the student
 * keeps editing in Monaco (very likely, since a session now stays alive
 * for the whole visit instead of one command's lifetime), the next `gcc
 * main.c` typed into an already-open terminal would otherwise silently
 * compile the STALE snapshot from whenever the session first connected.
 * syncFiles() (called from server.js on every 'sync' WS message, itself
 * fired by ConsoleUI.js on every meaningful editor change) rewrites
 * changed files into the SAME jobDir the live shell is already running
 * in -- no restart, no interrupting whatever command is mid-flight.
 */
const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const { createJobDir, writeFilesIntoDir, readJobFilesBack, getRunnerIds, SANDBOX_AVAILABLE } = require('./learnRunner');

// Looser than the batch path's grading-run limits (128MB/5s/2MB/16-proc) --
// this is a whole interactive session, not one quick graded check, and a
// real terminal session dying mid-command because of a tight CPU-time cap
// would feel broken rather than safe. Still bounded, just not razor-thin.
//
// -v 98304 (96MB), not the original 262144 (256MB) -- a real reported
// incident: the backend hit its host's memory limit. Root cause: this is a
// PERSISTENT session (up to MAX_SESSION_MS each), not the old
// spawn-run-exit-in-seconds batch model, so its memory cost is "N students
// x up to their own ulimit, for as long as each stays connected" instead
// of "however many compiles happen to overlap for a few seconds" -- a
// classroom's worth of concurrent terminals could add up to multiples of
// the OLD model's peak, even with nothing individually wrong. 96MB was
// picked by actually testing (real Linux container, matching this image)
// how low gcc itself tolerates going: it broke between 32-64MB (cc1
// itself segfaulting or failing to even load its shared libs), while 64MB
// compiled and ran a realistic program (malloc, recursion, buffers) fine.
// 96MB keeps a real margin above that observed failure point instead of
// riding the edge, while still cutting per-session worst-case memory by
// ~2.7x from the original number. See server.js's MAX_CONCURRENT_SESSIONS
// for the OTHER half of this fix -- a per-session cap alone doesn't bound
// how many sessions can be open AT ONCE.
const ULIMIT = 'ulimit -v 98304; ulimit -t 60; ulimit -f 8192; ulimit -u 32';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // no input for 5 minutes -> kill it
const MAX_SESSION_MS = 20 * 60 * 1000; // hard cap regardless of activity
// How long the pty has to stay quiet (no new output) before a file-poll
// runs -- see this file's header comment. Long enough that a command's
// own output (compiler warnings, a program printing a menu) doesn't
// trigger several polls mid-stream as it trickles in one buffer at a
// time; short enough that the file tree still updates promptly once a
// command actually finishes.
const OUTPUT_QUIET_MS = 400;

// Exposed so server.js can refuse a new session once too many are already
// live -- see that file's own comment for why a PER-session memory cap
// alone doesn't protect against this.
let activeSessionCount = 0;
function getActiveSessionCount() {
    return activeSessionCount;
}

// Same fallback the pty used to always spawn at, unconditionally --
// kept as a last resort for a 'start' message that somehow doesn't carry
// a real size (an old cached client build, or the very first fit() firing
// so early the DOM genuinely reports 0).
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// Shared by the initial spawn (constructor) and every later resize() call
// -- a student's own terminal can be any size, so both clamp to something
// sane a corrupt/malicious value (or a genuinely missing one, at spawn
// time) can't hand the pty layer a 0 or absurd size.
function clampCols(cols) {
    return Math.max(2, Math.min(500, (cols | 0) || DEFAULT_COLS));
}
function clampRows(rows) {
    return Math.max(2, Math.min(200, (rows | 0) || DEFAULT_ROWS));
}

class PtySession {
    constructor({ files, binaryFiles, cwd, cols, rows }) {
        this.jobDir = createJobDir('playground_pty', files, binaryFiles);
        this.dataHandlers = [];
        this.exitHandlers = [];
        this.filesHandlers = [];
        this.lastSnapshotJSON = null;
        this.lastKnownCwd = '';
        this.killed = false;
        // The editor-tracked filenames as of the last seed/sync -- see
        // syncFiles()'s own comment for the real bug this exists to fix
        // (deleting a file in the editor never actually deleted it here).
        this.lastEditorFileNames = new Set(Object.keys(files || {}));

        const ids = getRunnerIds();
        const startDir = this._resolveStartDir(cwd);

        // $APM32_ROOT strip trick: shows just "$ " at the project root (no
        // "/" -- a real reported complaint: a bare slash before the dollar
        // sign read as visual noise, not a meaningful path) or "/subfolder
        // $ " once the student actually `cd`s somewhere, instead of
        // leaking the real /tmp/playground_pty_xxxx path. Unlike a fixed
        // string, this stays correct as they move around, since PS1's
        // $(...) re-evaluates on every single prompt draw.
        //
        // APM32_PS1 (not PS1 directly): confirmed by direct testing --
        // bash silently drops an inherited PS1 from its environment when
        // starting non-interactively (exactly what the wrapper script
        // below is, before it execs into the real interactive shell), even
        // though every OTHER env var passes through untouched. Handing it
        // a differently-named var and having the script itself do
        // `export PS1=...` sidesteps that entirely -- a plain shell
        // variable assignment, not environment inheritance across the
        // non-interactive/interactive boundary.
        const env = {
            PATH: '/usr/bin:/bin',
            TERM: 'xterm-256color',
            HOME: this.jobDir,
            APM32_ROOT: this.jobDir,
            APM32_PS1: '$(r="${PWD#$APM32_ROOT}"; [ -n "$r" ] && printf "%s " "$r")$ ',
            // macOS-only cosmetic noise (Apple's patched bash prints a
            // "default shell is now zsh" notice on every interactive
            // startup) -- this env var is bash's own documented way to
            // silence it. Meaningless (harmlessly ignored) on Linux/prod.
            BASH_SILENCE_DEPRECATION_WARNING: '1',
        };

        // Always routed through `bash -c '...; exec bash ...'` (not a
        // direct spawn of the interactive shell) so there's exactly one
        // code path for the APM32_PS1-to-PS1 handoff above, sandboxed or
        // not. ulimit itself (a bash builtin, so it has to run inside a
        // shell that then execs into the real interactive one -- `exec`
        // replaces the process image without forking, so limits set a
        // moment earlier still apply after it) is the only part that's
        // actually conditional: skipped outside the sandboxed Docker image
        // (SANDBOX_AVAILABLE false on local dev) since there's no
        // unprivileged uid to protect against there either.
        const ulimitPrefix = SANDBOX_AVAILABLE ? `${ULIMIT}; ` : '';
        const spawnArgs = ['-c', `${ulimitPrefix}export PS1="$APM32_PS1"; exec bash --norc --noprofile`];

        this.pty = pty.spawn('/bin/bash', spawnArgs, {
            name: 'xterm-256color',
            // Real size from the client's own xterm.js, not a fixed
            // guess -- see this.resize()'s clamping (same bounds) and the
            // 'start' message's own comment in ConsoleUI.js for why a
            // mismatch here is exactly what was scrambling wrapped lines.
            cols: clampCols(cols),
            rows: clampRows(rows),
            cwd: startDir,
            env,
            ...(ids ? { uid: ids.uid, gid: ids.gid } : {}),
        });

        this.pty.onData(data => {
            this.dataHandlers.forEach(cb => cb(data));
            // See this file's header comment -- every chunk of real
            // output resets the quiet-timer instead of a fixed poll
            // clock running independently of whether anything's actually
            // happening.
            this._armQuietTimer();
        });
        this.pty.onExit(({ exitCode }) => {
            this._stopTimers();
            // this.lastKnownCwd, not a fresh procfs read -- the pty (and
            // its /proc/<pid>/cwd entry) is already gone by this point.
            this.exitHandlers.forEach(cb => cb(exitCode, this.lastKnownCwd));
            this._cleanupJobDir();
        });

        this._armIdleTimer();
        this.maxTimer = setTimeout(() => this.kill('timeout'), MAX_SESSION_MS);

        // Last line of the constructor, deliberately -- everything above
        // (createJobDir, pty.spawn) can throw, and if it does, this
        // session object never finishes constructing, so nothing will
        // ever call kill() on it to balance a decrement. Only counting a
        // session once it's fully alive keeps this accurate.
        activeSessionCount++;
    }

    // relCwd is only ever something a PREVIOUS pty session's client echoed
    // back (see LiveTerminalUI.js) -- e.g. reopening the terminal after a
    // reload shouldn't forget you were inside a subfolder. Same guard
    // shape as learnRunner.js's resolveCwd(): never trust it blindly.
    _resolveStartDir(relCwd) {
        if (!relCwd) return this.jobDir;
        const normalized = path.normalize(relCwd);
        if (normalized.startsWith('..') || path.isAbsolute(normalized)) return this.jobDir;
        const full = path.join(this.jobDir, normalized);
        try {
            if (fs.statSync(full).isDirectory()) return full;
        } catch { /* doesn't exist (anymore) -- fall back to the root */ }
        return this.jobDir;
    }

    _armIdleTimer() {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.kill('idle'), IDLE_TIMEOUT_MS);
    }

    // Restarted on every chunk of pty output -- fires once output has
    // actually gone quiet for OUTPUT_QUIET_MS, which is when a poll is
    // both useful (a command likely just finished) and cheap (it won't
    // immediately fire again next tick the way a fixed clock would while
    // output is still trickling in).
    _armQuietTimer() {
        if (this.killed) return;
        clearTimeout(this.quietTimer);
        this.quietTimer = setTimeout(() => {
            this._pollFiles();
            this._refreshKnownCwd();
        }, OUTPUT_QUIET_MS);
    }

    _pollFiles() {
        if (this.killed) return;
        let snapshot;
        try {
            snapshot = readJobFilesBack(this.jobDir);
        } catch {
            return; // jobDir mid-teardown or transiently unreadable -- try again next tick
        }
        const json = JSON.stringify(snapshot);
        if (json === this.lastSnapshotJSON) return;
        this.lastSnapshotJSON = json;
        this.filesHandlers.forEach(cb => cb(snapshot));
    }

    _stopTimers() {
        clearTimeout(this.idleTimer);
        clearTimeout(this.maxTimer);
        clearTimeout(this.quietTimer);
    }

    _cleanupJobDir() {
        fs.rm(this.jobDir, { recursive: true, force: true }, () => {});
    }

    // See this file's own header comment ("File sync, client -> jobDir").
    // Deliberately does NOT touch this.lastSnapshotJSON -- the next poll
    // tick will just see these files already match and skip firing
    // onFiles again, no separate bookkeeping needed to avoid an echo.
    syncFiles(files, binaryFiles) {
        if (this.killed) return;
        try {
            writeFilesIntoDir(this.jobDir, files, binaryFiles);

            // Real reported bug: deleting a file in the editor never
            // actually deleted it here -- writeFilesIntoDir only ever
            // WRITES whatever's in `files`, it has no concept of "this
            // key used to exist and doesn't anymore" (its OTHER caller,
            // createJobDir, has nothing to diff against on first creation
            // either, so that method was never the right place for this).
            // The stale file just sat in jobDir forever, so the NEXT
            // file-poll tick (see _pollFiles()) kept reading it back off
            // disk and handing it to the client's mergeChangedFiles() as
            // if the terminal itself had changed it -- which, compared
            // against the client's own freshly-synced (file-deleted)
            // state, looked exactly like "the terminal just recreated
            // this file", resurrecting whatever the student had just
            // deleted.
            // Only ever removes a name that WAS tracked here before and
            // is gone now -- a compiled binary sitting in jobDir is never
            // part of `files`/lastEditorFileNames to begin with, so it's
            // never a deletion candidate.
            const currentNames = new Set(Object.keys(files || {}));
            for (const name of this.lastEditorFileNames) {
                if (currentNames.has(name)) continue;
                const normalized = path.normalize(name);
                if (normalized.startsWith('..') || path.isAbsolute(normalized)) continue;
                try { fs.rmSync(path.join(this.jobDir, normalized), { force: true }); } catch { /* already gone */ }
            }
            this.lastEditorFileNames = currentNames;
        } catch {
            // A bad path in `files` (shouldn't happen -- these are real
            // project files, not user-typed paths) -- not worth killing
            // an otherwise-healthy session over.
        }
    }

    write(data) {
        if (this.killed) return;
        this._armIdleTimer();
        this.pty.write(data);
    }

    resize(cols, rows) {
        if (this.killed) return;
        try { this.pty.resize(clampCols(cols), clampRows(rows)); } catch { /* pty already gone */ }
    }

    // Best-effort "what folder is the shell actually in right now", kept
    // fresh on every file-poll tick (see _pollFiles()) so the client can
    // remember and echo it back on the NEXT session (see _resolveStartDir
    // above) after this one ends -- reading it straight from procfs
    // instead of parsing shell output. Only ever called WHILE the pty is
    // still alive: by the time it exits, /proc/<pid>/cwd is already gone,
    // which is exactly why this is a running snapshot (this.lastKnownCwd)
    // rather than something computed on demand at exit time.
    _refreshKnownCwd() {
        if (process.platform !== 'linux') return; // no procfs on macOS dev
        try {
            const real = fs.readlinkSync(`/proc/${this.pty.pid}/cwd`);
            const rel = path.relative(this.jobDir, real);
            this.lastKnownCwd = (rel.startsWith('..') || path.isAbsolute(rel)) ? '' : rel;
        } catch {
            // pty gone/never started -- leave lastKnownCwd at its last
            // good value instead of clobbering it with ''.
        }
    }

    onData(cb) { this.dataHandlers.push(cb); }
    onExit(cb) { this.exitHandlers.push(cb); }
    onFiles(cb) { this.filesHandlers.push(cb); }

    kill(_reason) {
        if (this.killed) return;
        this.killed = true;
        activeSessionCount--;
        this._stopTimers();
        try { this.pty.kill(); } catch { /* already dead */ }
        this._cleanupJobDir();
    }
}

function createSession(opts) {
    return new PtySession(opts);
}

module.exports = { createSession, getActiveSessionCount };
