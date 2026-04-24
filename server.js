const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const app = express();
app.use(cors());
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
        if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);
        if (!fs.existsSync(incDir)) fs.mkdirSync(incDir);

        const allComponentDirs = fs.readdirSync(COMPONENTS_DIR).filter(f => fs.statSync(path.join(COMPONENTS_DIR, f)).isDirectory());
        
        allComponentDirs.forEach(comp => {
            const compSrc = path.join(COMPONENTS_DIR, comp, 'src');
            const compInc = path.join(COMPONENTS_DIR, comp, 'inc');
            
            if (fs.existsSync(compSrc)) {
                fs.readdirSync(compSrc).forEach(f => fs.copyFileSync(path.join(compSrc, f), path.join(srcDir, f)));
            }
            if (fs.existsSync(compInc)) {
                fs.readdirSync(compInc).forEach(f => fs.copyFileSync(path.join(compInc, f), path.join(incDir, f)));
            }
        });

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
        execSync('make -f build_tools/Makefile all', { cwd: tmpDir, stdio: 'pipe' });

        const binPath = path.join(tmpDir, 'build', 'firmware.bin');
        if (fs.existsSync(binPath)) {
            const fileBuffer = fs.readFileSync(binPath);
            console.log(`[${jobId}] Success! Sending bin (${fileBuffer.length} bytes).`);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename=firmware.bin');
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`APM32 Compiler API running on http://localhost:${PORT}`);
});
