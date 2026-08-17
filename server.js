require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { runLevel } = require('./learnRunner');

const app = express();
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`APM32 Compiler API running on http://localhost:${PORT}`);
});
