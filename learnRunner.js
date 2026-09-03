/**
 * learnRunner.js
 * Compiles and RUNS student-submitted plain host C for "Learn mode" levels,
 * comparing stdout against each level's expected output. This is a different
 * toolchain profile from the ARM firmware pipeline in server.js's /compile:
 * that one only ever cross-compiles (arm-none-eabi-gcc) and never executes
 * the result on this machine. This one actually executes untrusted student
 * binaries, which is strictly more dangerous, so it gets its own sandboxing:
 * a hard wall-clock timeout, a memory/CPU/file/process ulimit, an
 * unprivileged OS user, and an explicitly whitelisted environment (never
 * process.env, which holds Firebase secrets from backend/.env).
 *
 * Sandboxing (uid/gid drop + ulimit) only applies on Linux running as root --
 * i.e. inside the Docker image (see Dockerfile's `learnrunner` user). Local
 * dev on macOS (not root, no such user) still compiles/runs correctly, just
 * without the OS-level guards; only the timeout still applies there.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const LEARN_LEVELS_DIR = process.env.LEARN_LEVELS_DIR || path.join(__dirname, 'learn-levels');
const RUNNER_USER = 'learnrunner';
const SANDBOX_AVAILABLE = process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0;

let cachedRunnerIds = null;
function getRunnerIds() {
    if (!SANDBOX_AVAILABLE) return null;
    if (cachedRunnerIds) return cachedRunnerIds;
    try {
        // Avoids a hard dependency on a specific uid number matching the
        // Dockerfile's `useradd -u 1500` -- looks the user up by name instead.
        const passwd = fs.readFileSync('/etc/passwd', 'utf8');
        const line = passwd.split('\n').find(l => l.startsWith(RUNNER_USER + ':'));
        if (!line) return null;
        const fields = line.split(':');
        cachedRunnerIds = { uid: parseInt(fields[2], 10), gid: parseInt(fields[3], 10) };
        return cachedRunnerIds;
    } catch {
        return null;
    }
}

function loadTests(levelId) {
    const testsPath = path.join(LEARN_LEVELS_DIR, levelId, 'tests.json');
    if (!fs.existsSync(testsPath)) {
        throw new Error(`Unknown level: ${levelId}`);
    }
    return JSON.parse(fs.readFileSync(testsPath, 'utf8'));
}

function normalize(output) {
    return output.replace(/\s+$/, '');
}

// Runs `cmd`/`args` with a whitelisted env, a wall-clock timeout, and (when
// SANDBOX_AVAILABLE) the unprivileged learnrunner uid/gid + a ulimit prefix.
// Resolves with { stdout, stderr, code, timedOut } -- never rejects on a
// non-zero exit code or timeout, since both are meaningful grading outcomes.
function runProcess({ cmd, args, cwd, stdin, timeoutMs, ulimit }) {
    return new Promise(resolve => {
        const ids = getRunnerIds();
        const env = { PATH: '/usr/bin:/bin' };

        let spawnCmd = cmd;
        let spawnArgs = args;
        if (ulimit && SANDBOX_AVAILABLE) {
            // ulimit is a shell builtin, not a standalone executable -- has to
            // run inside a shell that then execs the real command. Needs to
            // be bash specifically, not the image's default /bin/sh (dash):
            // dash's ulimit builtin has no -u (max user processes) at all
            // ("Illegal option -u", confirmed against the real node:18-slim
            // image), which would silently drop fork-bomb protection. Bash
            // is already present in that base image, no new dependency.
            const quoted = [cmd, ...args].map(a => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
            spawnCmd = '/bin/bash';
            spawnArgs = ['-c', `${ulimit}; exec ${quoted}`];
        }

        const child = spawn(spawnCmd, spawnArgs, {
            cwd,
            env,
            timeout: timeoutMs,
            killSignal: 'SIGKILL',
            ...(ids ? { uid: ids.uid, gid: ids.gid } : {}),
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        child.on('error', err => {
            resolve({ stdout, stderr: stderr + '\n' + err.message, code: -1, timedOut: false });
        });

        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });

        if (stdin !== undefined && child.stdin) {
            child.stdin.on('error', () => {}); // program may exit before reading stdin
            child.stdin.write(stdin);
            child.stdin.end();
        } else if (child.stdin) {
            child.stdin.end();
        }

        child.on('close', (code, signal) => {
            timedOut = signal === 'SIGKILL' || signal === 'SIGTERM';
            resolve({ stdout, stderr, code, timedOut });
        });
    });
}

// Runs a raw shell command line (e.g. "gcc main.c -o prog && ./prog") under
// a real shell -c (bash when sandboxed, plain /bin/sh otherwise -- see the
// ulimit comment below for why), unlike runProcess()'s ulimit path which
// execs a fixed argv and only uses the shell as a vehicle for the ulimit
// prefix. This one
// needs the shell's own operators (&&, pipes, custom gcc flags the student
// typed) to actually mean something -- it's the backing for Playground's
// manual "terminal" tab. Same sandboxing envelope as runProcess(): whitelisted
// env, wall-clock timeout, and (when SANDBOX_AVAILABLE) the unprivileged
// learnrunner uid/gid + ulimit. Not a materially bigger risk than the C
// execution this app already does unsandboxed-beyond-ulimit: a student's C
// program can already `system()` or open sockets from inside runArbitrary();
// this just skips the compile step for the same jail.
// Unlikely-to-collide marker this appends to every script so the caller
// can recover the shell's OWN final working directory afterward (see
// below) -- not adversarial-proof (a student could `cat` a file containing
// this exact line and confuse the parser), but that's the same risk
// tolerance already accepted elsewhere in this file (e.g. the null-byte
// heuristic readJobFilesBack() uses to tell binary output from text).
const CWD_MARKER = '###APM32_CWD###';

function runShellCommand({ command, cwd, stdin, timeoutMs }) {
    return new Promise(resolve => {
        const ids = getRunnerIds();
        // TERM matters here (unlike runProcess()'s compile/run paths) --
        // this is the one place a student can type ncurses-ish commands
        // like `clear`/`tput`, which error out on a missing TERM instead
        // of just doing nothing.
        const env = { PATH: '/usr/bin:/bin', TERM: 'xterm' };
        // One `ulimit -X value` per call, semicolon-chained -- the bash-style
        // multi-flag form in one invocation ("ulimit -v 131072 -t 5 -f 2048
        // -u 16") is invalid under a strict POSIX ulimit and fails with
        // "too many arguments". Only takes effect when sandboxed (below,
        // spawnShell is bash then, whose ulimit builtin supports every flag
        // used here, unlike dash's -- see runProcess()'s ulimit branch for
        // why dash specifically can't be used).
        const ulimit = 'ulimit -v 131072; ulimit -t 5; ulimit -f 2048; ulimit -u 16';
        // `cd` only changes the *spawned shell's own* working directory,
        // which is gone the instant this process exits -- there's no
        // persistent shell across separate exec() calls (each gets a
        // fresh, disposable jobDir, see createJobDir()). To make `cd`
        // still feel like it "sticks" across commands, the command runs
        // at the top level of THIS SAME shell (not a subshell -- a
        // subshell's `cd` wouldn't be visible to anything after it), then
        // this appends its own `pwd` capture printed behind a marker line
        // so the caller can parse it back out, compute where the shell
        // ended up relative to the job root, and hand that back to the
        // client to send as `cwd` on the NEXT command. `$?` is captured
        // immediately after the real command so the marker/pwd lines
        // right after it can't clobber the exit code this reports back.
        const withCwdCapture = `${command}\n__apm32_ec__=$?\nprintf '\\n${CWD_MARKER}:%s\\n' "$(pwd)"\nexit $__apm32_ec__`;
        const script = SANDBOX_AVAILABLE ? `${ulimit}; ${withCwdCapture}` : withCwdCapture;
        const spawnShell = SANDBOX_AVAILABLE ? '/bin/bash' : '/bin/sh';

        const child = spawn(spawnShell, ['-c', script], {
            cwd,
            env,
            timeout: timeoutMs,
            killSignal: 'SIGKILL',
            ...(ids ? { uid: ids.uid, gid: ids.gid } : {}),
        });

        let stdout = '';
        let stderr = '';

        child.on('error', err => {
            resolve({ stdout, stderr: stderr + '\n' + err.message, code: -1, timedOut: false, finalCwd: cwd });
        });

        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });

        if (stdin !== undefined && child.stdin) {
            child.stdin.on('error', () => {});
            child.stdin.write(stdin);
            child.stdin.end();
        } else if (child.stdin) {
            child.stdin.end();
        }

        child.on('close', (code, signal) => {
            const timedOut = signal === 'SIGKILL' || signal === 'SIGTERM';
            // Strip the marker line back out of stdout -- it's plumbing
            // for this function's own caller, not something the student
            // ever typed or should see in their terminal transcript.
            let finalCwd = cwd;
            const markerIndex = stdout.lastIndexOf(`${CWD_MARKER}:`);
            if (markerIndex !== -1) {
                const afterMarker = stdout.slice(markerIndex + CWD_MARKER.length + 1);
                const newlineIndex = afterMarker.indexOf('\n');
                const captured = (newlineIndex === -1 ? afterMarker : afterMarker.slice(0, newlineIndex)).trim();
                if (captured) finalCwd = captured;
                // Drop the marker line (and the blank line printf's
                // leading \n produced ahead of it) from what the student
                // actually sees.
                stdout = stdout.slice(0, markerIndex).replace(/\n$/, '');
            }
            resolve({ stdout, stderr, code, timedOut, finalCwd });
        });
    });
}

// Recursively lists every file under `dir`, returned as paths relative to
// `dir` (posix-style, since these get passed straight to gcc as args).
function listFilesRecursive(dir, base = dir) {
    let out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out = out.concat(listFilesRecursive(full, base));
        } else {
            out.push(path.relative(base, full));
        }
    }
    return out;
}

// Creates a throwaway sandbox dir under /tmp, writes `files` (plain utf8
// text) and `binaryFiles` (base64 -- compiled executables carried forward
// across separate terminal commands, see execCommand()) into it (rejecting
// path traversal/absolute paths), and chowns the whole tree to the
// unprivileged learnrunner uid/gid when sandboxed. Shared by runArbitrary()
// and execCommand() -- both need the exact same "materialize the student's
// files into a real, disposable directory" step before spawning anything
// into it.
function createJobDir(prefix, files, binaryFiles) {
    const jobId = crypto.randomBytes(8).toString('hex');
    const jobDir = path.join('/tmp', `${prefix}_${jobId}`);

    fs.mkdirSync(jobDir, { recursive: true, mode: 0o700 });

    const writeEntry = (relPath, buf, executable) => {
        // This write happens before the unprivileged uid is dropped (that
        // only applies to whatever gets spawned into jobDir afterward), so
        // it runs with the parent Node process's own privileges and must
        // not escape jobDir.
        const normalized = path.normalize(relPath);
        if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
            throw new Error(`Invalid file path: ${relPath}`);
        }
        const fullPath = path.join(jobDir, normalized);
        try {
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, buf);
            // writeFileSync's default mode doesn't preserve the execute
            // bit -- a compiled binary written back from a previous
            // command's outputFiles needs it restored, or `./test` fails
            // with EACCES even though the file is right there.
            if (executable) fs.chmodSync(fullPath, 0o755);
        } catch (err) {
            if (err.code === 'EEXIST' && err.syscall === 'mkdir') {
                // A real reported bug: virtualFS has no separate "this is
                // a folder" marker (folders are purely derived from '/'
                // -prefixes of its keys, see SidebarUI.buildTree()), so a
                // plain file and a folder could end up sharing the same
                // name (e.g. a stray file literally called "fun_est"
                // alongside "fun_est/estructuras.c") -- this is exactly
                // where that surfaces: mkdir can't create a directory
                // where a file already sits. Client-side now has guards
                // preventing this from being CREATED (see
                // FileSystemBloc.js's fileBlockingPath/folderExistsAt),
                // but this message is what any already-corrupted project
                // sees until its owner renames/deletes the colliding
                // entry -- a named, actionable error instead of a raw
                // "EEXIST ... mkdir '...'" with no indication of what
                // collided or what to do about it.
                throw new Error(`Your project has a file and a folder with the same name ("${path.basename(err.path)}"). Rename or delete one of them in the file tree, then try again.`);
            }
            throw err;
        }
    };

    try {
        for (const [relPath, content] of Object.entries(files)) {
            writeEntry(relPath, content || '', false);
        }
        if (binaryFiles) {
            for (const [relPath, base64Content] of Object.entries(binaryFiles)) {
                writeEntry(relPath, Buffer.from(base64Content, 'base64'), true);
            }
        }
    } catch (err) {
        // Every throw above used to leave whatever had already been
        // written sitting in /tmp forever (the invalid-path branch was
        // the only one that cleaned up) -- one cleanup path for all of
        // them now, instead of relying on each new throw site to remember it.
        fs.rmSync(jobDir, { recursive: true, force: true });
        throw err;
    }

    const ids = getRunnerIds();
    if (ids) {
        // chown the whole tree (dir + every written file), not just the
        // top-level dir -- there can be nested subdirectories.
        const chownRecursive = (p) => {
            fs.chownSync(p, ids.uid, ids.gid);
            if (fs.statSync(p).isDirectory()) {
                for (const entry of fs.readdirSync(p)) {
                    chownRecursive(path.join(p, entry));
                }
            }
        };
        chownRecursive(jobDir);
    }

    return jobDir;
}

// Round-trip: a program that does fopen("x", "w") (or a shell command that
// does `> x`) writes into a jobDir that's about to be deleted -- read every
// file back so the caller can diff it against what it submitted and merge
// anything created/changed forward. Splits into two buckets:
//   - outputFiles: real text (utf8, no null byte) -- merged into the
//     visible file manager (a student's fopen("log.txt","w") case).
//   - binaryFiles: everything else (compiled ELF/Mach-O executables, other
//     genuinely binary output), base64 -- NOT shown in the file manager
//     (it'd just render as garbage), but still carried forward so
//     execCommand()'s caller can feed it back into the NEXT command's
//     jobDir. Without this, "gcc main.c -o test" in one command followed
//     by "./test" in a separate one would fail with "No such file" --  the
//     binary existed only inside the first command's now-deleted jobDir.
function readJobFilesBack(jobDir) {
    const outputFiles = {};
    const binaryFiles = {};
    for (const f of listFilesRecursive(jobDir)) {
        if (f === 'a.out') continue;
        try {
            const buf = fs.readFileSync(path.join(jobDir, f));
            // A compiled ELF/Mach-O binary almost always has a null byte in
            // its first few bytes, real text essentially never does --
            // cheap enough of a filter to sort the two buckets.
            if (buf.includes(0)) {
                binaryFiles[f] = buf.toString('base64');
            } else {
                outputFiles[f] = buf.toString('utf8');
            }
        } catch { /* unreadable (permissions) -- skip it */ }
    }
    return { outputFiles, binaryFiles };
}

// Playground: compile+run an ARBITRARY multi-file plain-C project -- no
// levelId, no tests.json, no expectedStdout comparison. Reuses runProcess()
// and the exact sandboxing runLevel() already has (same risk class: this
// executes untrusted, arbitrary user code).
async function runArbitrary(files, stdin) {
    if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
        throw new Error('files is required');
    }

    const jobDir = createJobDir('playground_build', files);

    try {
        const allFiles = listFilesRecursive(jobDir);
        const sourceFiles = allFiles.filter(f => f.endsWith('.c'));
        if (sourceFiles.length === 0) {
            return { success: false, stage: 'compile', stderr: 'No .c files to compile.' };
        }

        // A quote-form #include only searches the including file's own
        // directory by default -- a student organizing files into src/inc
        // folders (main.c in src/ including a header from inc/) would hit
        // "undeclared function" errors otherwise. -I every directory that
        // actually has a file in it, same reasoning the real ARM Makefile
        // already uses (-I$(INC_DIR) -I$(SDK_INC_DIR)).
        const includeDirs = new Set(['.']);
        for (const f of allFiles) {
            const dir = path.dirname(f);
            if (dir !== '.') includeDirs.add(dir);
        }
        const includeFlags = [...includeDirs].map(d => `-I${d}`);

        const compileResult = await runProcess({
            cmd: 'gcc',
            args: ['-O0', '-Wall', '-std=c11', ...includeFlags, ...sourceFiles, '-o', 'a.out'],
            cwd: jobDir,
            timeoutMs: 5000,
        });

        if (compileResult.code !== 0) {
            return { success: false, stage: 'compile', stderr: compileResult.stderr };
        }

        const runResult = await runProcess({
            cmd: './a.out',
            args: [],
            cwd: jobDir,
            stdin: stdin || '',
            timeoutMs: 5000,
            ulimit: 'ulimit -v 131072; ulimit -t 5; ulimit -f 2048; ulimit -u 16',
        });

        const { outputFiles } = readJobFilesBack(jobDir);
        return {
            success: true,
            stage: 'run',
            stdout: runResult.stdout,
            stderr: runResult.stderr,
            code: runResult.code,
            timedOut: runResult.timedOut,
            outputFiles,
        };
    } finally {
        await fs.promises.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    }
}

// Playground's manual "terminal" tab: runs a raw shell command line the
// student typed (e.g. "gcc main.c -o prog && ./prog", or just "./prog") in
// the same kind of disposable sandbox as runArbitrary(), seeded from the
// current file manager state PLUS `binaryFiles` -- compiled executables the
// caller carried forward from a PREVIOUS command's response (see
// ConsoleUI.js), since each command gets its own fresh, disposable jobDir
// and there's no real persistent shell/cwd otherwise. Round-trips both
// buckets back out so the caller can keep carrying binaries forward and
// merge text output into the file manager.
// Resolves the client-supplied `relCwd` (a path relative to the project
// root, e.g. "archivos" after a previous `cd archivos`) against THIS
// command's freshly-materialized jobDir -- never trusted blindly, since
// it's state a previous response handed back to the client and the client
// echoes back verbatim on the next request. Path-traversal is rejected the
// same way writeEntry() rejects it for uploaded file paths; a directory
// that no longer exists (deleted/renamed between commands, or simply never
// existed) falls back to the job root instead of handing spawn() a path
// that would make it fail with ENOENT.
function resolveCwd(jobDir, relCwd) {
    if (!relCwd) return jobDir;
    const normalized = path.normalize(relCwd);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) return jobDir;
    const full = path.join(jobDir, normalized);
    try {
        if (fs.statSync(full).isDirectory()) return full;
    } catch {
        // Doesn't exist (anymore) -- fall through to the job root.
    }
    return jobDir;
}

async function execCommand(files, command, stdin, binaryFiles, cwd) {
    if (!files || typeof files !== 'object') {
        throw new Error('files is required');
    }
    if (typeof command !== 'string' || command.trim() === '') {
        throw new Error('command is required');
    }

    const jobDir = createJobDir('playground_exec', files, binaryFiles);

    try {
        const startCwd = resolveCwd(jobDir, cwd);
        const result = await runShellCommand({ command, cwd: startCwd, stdin: stdin || '', timeoutMs: 8000 });
        const { outputFiles, binaryFiles: newBinaryFiles } = readJobFilesBack(jobDir);

        // Relative to the job root, and clamped back to '' (the root) if
        // the command somehow `cd`'d to somewhere outside it -- '..' one
        // too many times, `cd /`, etc. -- so a client can never accumulate
        // a cwd that would resolve outside its own sandbox on a later call
        // (resolveCwd() would already refuse it next time regardless, but
        // there's no reason to hand back a value that looks like it means
        // something it can't).
        // realpathSync both sides before comparing -- NOT optional on a Mac
        // dev machine, where /tmp is itself a symlink to /private/tmp: the
        // shell's own `pwd` follows that symlink and reports the physical
        // path, while jobDir was built by joining onto the logical '/tmp',
        // so a bare path.relative() between them produced "../private/tmp/
        // ..." (looked like it had escaped the sandbox) even for a `cd`
        // that stayed well inside it -- confirmed as the actual reason a
        // `cd` that plainly worked (visible in the command's own stdout)
        // still came back reporting cwd: ''. Linux (Cloud Run, the
        // Dockerfile's own image) doesn't symlink /tmp, but resolving both
        // sides makes this correct regardless of platform instead of
        // relying on that happening not to matter there.
        const realJobDir = fs.realpathSync(jobDir);
        let realFinalCwd = realJobDir;
        try {
            realFinalCwd = fs.realpathSync(result.finalCwd || jobDir);
        } catch {
            // The directory the shell ended up in no longer exists by the
            // time we get here (unusual, but not impossible) -- treat it
            // as "back at the root" rather than throwing.
        }
        let relativeCwd = path.relative(realJobDir, realFinalCwd);
        if (relativeCwd.startsWith('..') || path.isAbsolute(relativeCwd)) relativeCwd = '';

        return {
            success: true,
            stdout: result.stdout,
            stderr: result.stderr,
            code: result.code,
            timedOut: result.timedOut,
            cwd: relativeCwd,
            outputFiles,
            binaryFiles: newBinaryFiles,
        };
    } finally {
        await fs.promises.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function runLevel(levelId, code) {
    const tests = loadTests(levelId);

    const jobId = crypto.randomBytes(8).toString('hex');
    const jobDir = path.join('/tmp', `learn_build_${jobId}`);

    try {
        fs.mkdirSync(jobDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(jobDir, 'main.c'), code);

        const ids = getRunnerIds();
        if (ids) {
            fs.chownSync(jobDir, ids.uid, ids.gid);
            fs.chownSync(path.join(jobDir, 'main.c'), ids.uid, ids.gid);
        }

        const compileResult = await runProcess({
            cmd: 'gcc',
            args: ['-O0', '-Wall', '-std=c11', 'main.c', '-o', 'a.out'],
            cwd: jobDir,
            timeoutMs: 5000,
        });

        if (compileResult.code !== 0) {
            return { success: false, stage: 'compile', stderr: compileResult.stderr };
        }

        const results = [];
        for (let i = 0; i < tests.length; i++) {
            const test = tests[i];
            const runResult = await runProcess({
                cmd: './a.out',
                args: [],
                cwd: jobDir,
                stdin: test.stdin || '',
                timeoutMs: 3000,
                ulimit: 'ulimit -v 131072; ulimit -t 5; ulimit -f 2048; ulimit -u 16',
            });

            const passed = !runResult.timedOut && normalize(runResult.stdout) === normalize(test.expectedStdout);
            results.push({
                index: i,
                passed,
                actualStdout: runResult.stdout,
                expectedStdout: test.expectedStdout,
                timedOut: runResult.timedOut,
            });
        }

        return { success: true, stage: 'tests', allPassed: results.every(r => r.passed), results };
    } finally {
        // Runs as root (the parent Node process), so it can remove the job dir
        // even though its contents may be owned by the unprivileged runner user.
        await fs.promises.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = { runLevel, runArbitrary, execCommand };
