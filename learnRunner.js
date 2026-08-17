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
            // run inside a shell that then execs the real command.
            const quoted = [cmd, ...args].map(a => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
            spawnCmd = '/bin/sh';
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
                ulimit: 'ulimit -v 131072 -t 5 -f 2048 -u 16',
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

module.exports = { runLevel };
