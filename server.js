require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { runLevel, runArbitrary } = require('./learnRunner');
const { createSession } = require('./ptySession');

const app = express();
// Load-bearing for frontend/vendor/wasm-clang/ (~60MB uncompressed: clang
// + lld + sysroot.tar) -- gzip brings that down to what the browser
// actually needs to transfer, same order of magnitude as loading it from
// the upstream demo's own (gzip'd) GitHub Pages hosting. Explicit
// req.path check rather than trusting compression's own default filter:
// clang/lld/sysroot.tar have no file extension, so express.static serves
// them as application/octet-stream, and whether the 'compressible' package
// (which the default filter defers to) classifies that MIME type as
// compressible has changed across its own versions -- this app has
// observed it go both ways. Forcing it explicitly for this one path avoids
// silently losing compression again on some future `npm update`.
app.use(compression({
    filter: (req, res) => {
        if (req.path.startsWith('/vendor/wasm-clang/')) return true;
        // The .vsix under /downloads/ is already a zip container -- gzip/
        // brotli-ing it again on every download burns CPU for a fraction
        // of a percent of size, and it also falls under the same
        // application/octet-stream MIME type as the wasm-clang assets
        // above, which the default filter doesn't reliably skip either.
        if (req.path.startsWith('/downloads/')) return false;
        return compression.filter(req, res);
    }
}));
app.use(cors({
    exposedHeaders: ['X-Size-Text', 'X-Size-Data', 'X-Size-Bss']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const TEMPLATE_DIR = process.env.TEMPLATE_DIR || path.join(__dirname, 'source', 'template');
const COMPONENTS_DIR = process.env.COMPONENTS_DIR || path.join(__dirname, 'source', 'components');

function getAllFiles(dirPath, arrayOfFiles) {
    if (!fs.existsSync(dirPath)) return arrayOfFiles;
    let files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];
    files.forEach(file => {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });
    return arrayOfFiles;
}
app.get('/health', (req, res) => {
    res.json({ status: "OK", engine: "APM32-GCC" });
});

app.get('/api/config', (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
        measurementId: process.env.FIREBASE_MEASUREMENT_ID
    });
});

app.post('/compile', (req, res) => {
    const { files, mainContent } = req.body;
    
    const projectFiles = files || (mainContent ? { 'main.c': mainContent } : null);

    if (!projectFiles || Object.keys(projectFiles).length === 0) {
        return res.status(400).json({ error: 'Source files are required' });
    }

    const jobId = crypto.randomBytes(8).toString('hex');
    const tmpDir = path.join('/tmp', `apm32_build_${jobId}`);
    
    try {
        fs.mkdirSync(tmpDir, { recursive: true });
        execSync(`cp -r "${TEMPLATE_DIR}"/* "${tmpDir}/"`);

        // Create src and inc if not existing
        const srcDir = path.join(tmpDir, 'src');
        const incDir = path.join(tmpDir, 'inc');
        if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
        if (!fs.existsSync(incDir)) fs.mkdirSync(incDir, { recursive: true });

        // Build a set of user-provided basenames to avoid duplicate symbols
        const userFileBasenames = new Set();
        for (const rawFilename of Object.keys(projectFiles)) {
            const basename = path.basename(rawFilename);
            userFileBasenames.add(basename);
        }

        // Copy component files ONLY if the user didn't provide them
        const allComponentDirs = fs.readdirSync(COMPONENTS_DIR).filter(f => fs.statSync(path.join(COMPONENTS_DIR, f)).isDirectory());
        
        allComponentDirs.forEach(comp => {
            const compSrc = path.join(COMPONENTS_DIR, comp, 'src');
            const compInc = path.join(COMPONENTS_DIR, comp, 'inc');
            
            if (fs.existsSync(compSrc)) {
                fs.readdirSync(compSrc).forEach(f => {
                    if (!userFileBasenames.has(f)) {
                        fs.copyFileSync(path.join(compSrc, f), path.join(srcDir, f));
                    }
                });
            }
            if (fs.existsSync(compInc)) {
                fs.readdirSync(compInc).forEach(f => {
                    if (!userFileBasenames.has(f)) {
                        fs.copyFileSync(path.join(compInc, f), path.join(incDir, f));
                    }
                });
            }
        });

        // Write user files (these take priority over components)
        for (const [rawFilename, content] of Object.entries(projectFiles)) {
            let relativePath = rawFilename;
            const isHeader = rawFilename.endsWith('.h');
            
            // Check if user provided an explicit path like src/ or inc/
            if (!rawFilename.startsWith('src/') && !rawFilename.startsWith('inc/')) {
                relativePath = path.join(isHeader ? 'inc' : 'src', rawFilename);
            }

            const fullPath = path.join(tmpDir, relativePath);
            const parentDir = path.dirname(fullPath);
            
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }
            
            fs.writeFileSync(fullPath, content || '');
        }
        
        // Ensure standard entry points exist if not provided
        const mainPath = path.join(tmpDir, 'src', 'main.c');
        if (!fs.existsSync(mainPath) && !projectFiles['main.c'] && !projectFiles['src/main.c']) {
             fs.writeFileSync(mainPath, '#include "apm32f10x.h"\nint main(void){ while(1); }');
        }

        console.log(`[${jobId}] Compiling project...`);
        const compileOut = execSync('make -f build_tools/Makefile all', { cwd: tmpDir, stdio: 'pipe' }).toString();

        const binPath = path.join(tmpDir, 'build', 'firmware.bin');
        if (fs.existsSync(binPath)) {
            const fileBuffer = fs.readFileSync(binPath);
            
            // Extract size information
            // Example line:    1764	   1088	   1572	   4424	   1148	build/firmware.elf
            const sizeLine = compileOut.split('\n').find(l => l.includes('build/firmware.elf'));
            if (sizeLine) {
                const parts = sizeLine.trim().split(/\s+/);
                res.setHeader('X-Size-Text', parts[0]);
                res.setHeader('X-Size-Data', parts[1]);
                res.setHeader('X-Size-Bss', parts[2]);
            }

            console.log(`[${jobId}] Success! Sending bin (${fileBuffer.length} bytes).`);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename=firmware.bin');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.send(fileBuffer);
        } else {
            throw new Error("Build succeeded but firmware.bin not found.");
        }

    } catch (err) {
        console.error(`[${jobId}] Compilation Error`, err.stderr ? err.stderr.toString() : err);
        res.status(500).json({ error: 'Compilation failed', details: err.stderr ? err.stderr.toString() : err.message });
    } finally {
        if (fs.existsSync(tmpDir)) {
            execSync(`rm -rf "${tmpDir}"`);
        }
    }
});

// Learn mode: compiles + RUNS plain host C (not ARM firmware) and grades it
// against a level's expected stdout. See learnRunner.js for the sandboxing.
app.post('/learn/run', async (req, res) => {
    const { levelId, code } = req.body;

    if (!levelId || typeof code !== 'string') {
        return res.status(400).json({ error: 'levelId and code are required' });
    }

    try {
        const result = await runLevel(levelId, code);
        res.json(result);
    } catch (err) {
        console.error('[learn/run]', err.message);
        res.status(400).json({ error: err.message });
    }
});

// Playground mode: compile + run an ARBITRARY multi-file plain-C project --
// no curriculum levelId, no expectedStdout grading, just raw stdout/stderr.
// Same sandboxing as /learn/run (see learnRunner.js's runArbitrary()).
app.post('/playground/run', async (req, res) => {
    const { files, stdin } = req.body;

    if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
        return res.status(400).json({ error: 'files is required' });
    }

    try {
        const result = await runArbitrary(files, stdin);
        res.json(result);
    } catch (err) {
        console.error('[playground/run]', err.message);
        res.status(400).json({ error: err.message });
    }
});

// Playground's manual "terminal" tab used to be a plain HTTP endpoint here
// (one request per command, no live process) -- see git history for that
// implementation (learnRunner.js's execCommand(), still exported and unit-
// tested directly since it's a perfectly good piece of sandboxing on its
// own) if it's ever needed again. Replaced by a real interactive shell over
// a WebSocket (below) so a program mid-scanf() can actually receive more
// input instead of only ever reading whatever was typed into a separate
// box before the command even started.

const httpServer = http.createServer(app);

// One PtySession per connection (see ptySession.js) -- a real, persistent
// bash the client streams raw bytes to/from, not a fresh sandbox per
// command. noServer-less form (server + path) since this is the only
// WebSocket endpoint this app has; nothing else needs its own upgrade
// handling to coexist with.
const wss = new WebSocketServer({ server: httpServer, path: '/playground/pty' });

wss.on('connection', (ws) => {
    let session = null;

    // Guards against a client sending 'input'/'resize' (or a malformed
    // repeat 'start') before/without ever sending a valid 'start' -- there's
    // no session yet to forward those to.
    const send = (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return send({ type: 'error', message: 'Malformed message' });
        }

        if (msg.type === 'start') {
            if (session) return; // already started -- ignore a stray repeat
            const { files, binaryFiles, cwd } = msg;
            if (!files || typeof files !== 'object') {
                return send({ type: 'error', message: 'files is required' });
            }
            try {
                session = createSession({ files, binaryFiles, cwd });
            } catch (err) {
                console.error('[playground/pty] session create failed:', err.message);
                return send({ type: 'error', message: err.message });
            }
            session.onData(data => send({ type: 'data', data }));
            session.onFiles(({ outputFiles, binaryFiles }) => send({ type: 'files', outputFiles, binaryFiles }));
            session.onExit((code, cwd) => {
                send({ type: 'exit', code, cwd });
                ws.close();
            });
            send({ type: 'ready' });
        } else if (msg.type === 'input') {
            if (session && typeof msg.data === 'string') session.write(msg.data);
        } else if (msg.type === 'resize') {
            if (session) session.resize(msg.cols, msg.rows);
        } else if (msg.type === 'sync') {
            // Keeps an already-running session's jobDir current with
            // Monaco's latest content -- see ptySession.js's own header
            // comment ("File sync, client -> jobDir") for why this exists.
            if (session && msg.files && typeof msg.files === 'object') {
                session.syncFiles(msg.files, msg.binaryFiles);
            }
        }
    });

    // Covers every way this connection can end -- the student closing the
    // tab, a network drop, or the browser navigating away -- so a pty
    // (and the ulimited-but-still-real OS process it's running) never
    // outlives the WebSocket that's supposed to own it.
    ws.on('close', () => { if (session) session.kill('ws-close'); });
    ws.on('error', () => { if (session) session.kill('ws-error'); });
});

const PORT = process.env.PORT || 3000;
// require.main check: only auto-listen when this file is run directly
// (`node server.js`) -- normal `node server.js` behavior is unaffected.
// backend/test/helpers/scratchServer.js instead requires this module and
// calls .listen(0) itself, so every test run gets a real OS-assigned
// ephemeral port and can never collide with the user's own 3000 (or with
// another test file's server running in parallel). Exports the http.Server
// wrapping `app` (not `app` itself) now that WebSocket upgrades need to
// share the same underlying server -- `.listen()` has the identical
// signature either way, so scratchServer.js needs no changes.
if (require.main === module) {
    httpServer.listen(PORT, () => {
        console.log(`APM32 Compiler API running on http://localhost:${PORT}`);
    });
}

module.exports = httpServer;
