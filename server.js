const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

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

app.post('/compile', (req, res) => {
    const { mainContent } = req.body;
    if (!mainContent) {
        return res.status(400).json({ error: 'mainContent is required' });
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

        fs.writeFileSync(path.join(srcDir, 'main.c'), mainContent);
        
        fs.writeFileSync(path.join(incDir, 'apm32_config.h'), '#ifndef APM_CFG\n#define APM_CFG\n#include "apm32f10x.h"\nvoid APM32_Init(void);\n#endif');
        fs.writeFileSync(path.join(srcDir, 'apm32_config.c'), '#include "apm32_config.h"\n#include "delay.h"\n__attribute__((weak)) void APM32_Init(void) { SystemInit(); SysTick_Init(); }');

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
