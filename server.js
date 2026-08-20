require('dotenv').config();
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { runLevel, runArbitrary, execCommand } = require('./learnRunner');

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

// Playground's manual "terminal" tab: runs a raw command line the student
// typed themselves (gcc with whatever flags, chained with &&, etc.) instead
// of the fixed compile+run RUN button does. Same sandbox, see
// learnRunner.js's execCommand().
app.post('/playground/exec', async (req, res) => {
    const { files, command, stdin, binaryFiles } = req.body;

    if (!files || typeof files !== 'object') {
        return res.status(400).json({ error: 'files is required' });
    }
    if (typeof command !== 'string' || command.trim() === '') {
        return res.status(400).json({ error: 'command is required' });
    }

    try {
        const result = await execCommand(files, command, stdin, binaryFiles);
        res.json(result);
    } catch (err) {
        console.error('[playground/exec]', err.message);
        res.status(400).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
// require.main check: only auto-listen when this file is run directly
// (`node server.js`) -- normal `node server.js` behavior is unaffected.
// backend/test/helpers/scratchServer.js instead requires this module and
// calls app.listen(0) itself, so every test run gets a real OS-assigned
// ephemeral port and can never collide with the user's own 3000 (or with
// another test file's server running in parallel).
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`APM32 Compiler API running on http://localhost:${PORT}`);
    });
}

module.exports = app;
