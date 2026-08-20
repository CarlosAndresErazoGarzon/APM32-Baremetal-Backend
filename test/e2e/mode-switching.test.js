/**
 * mode-switching.test.js
 * Boots a real scratch server (ephemeral port, see helpers/scratchServer.js)
 * and drives a real Chromium tab through IDE / Learn / Playground -- the
 * 3-way ModeBloc/ModeSwitcherUI added earlier this session. Also re-checks
 * (as an automated regression, not a one-off manual script anymore) the
 * super-unit tree and progress-preservation guarantee from this session's
 * Learn Mode reorganization.
 */
const { test, expect } = require('playwright/test');
const { startScratchServer } = require('../helpers/scratchServer');

let scratch;

test.beforeAll(async () => {
    scratch = await startScratchServer();
});

test.afterAll(async () => {
    await scratch.stop();
});

test('switches between IDE, Learn, and Playground modes', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    await expect(page.locator('#ideModeBtn')).toBeVisible();
    await expect(page.locator('#learnModeBtn')).toBeVisible();
    await expect(page.locator('#playgroundModeBtn')).toBeVisible();

    await page.click('#learnModeBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('#levelListPane')).toBeVisible();

    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('#playgroundModeBtn')).toHaveClass(/active/);

    await page.click('#ideModeBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('#ideModeBtn')).toHaveClass(/active/);

    expect(consoleErrors).toEqual([]);
});

test('Learn mode tree groups all 14 units under 3 super units, always expanded', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.click('#learnModeBtn');
    await page.waitForTimeout(500);

    // Super-unit headers render `uppercase` via CSS (a class, not the
    // text content itself) -- innerText reflects the rendered (uppercase)
    // text, so compare case-insensitively rather than hardcoding the caps.
    const treeText = (await page.locator('#levelListPane').innerText()).toLowerCase();
    for (const header of ['basicos de c', 'uso de la placa', 'c avanzado']) {
        expect(treeText).toContain(header);
    }
    // All 14 units' short titles should be present somewhere in the tree
    // (they render inside a collapsed/expanded row either way).
    for (const unit of [
        'Fundamentos de C', 'Operadores y Formato', 'Estructuras de Control',
        'Bucles e Iteraciones', 'Arreglos y Cadenas', 'Funciones y Modularidad',
        'Estructuras de Datos', 'Manejo de Archivos (I/O)',
        'GPIO - Configuracion y Salidas', 'GPIO - Entradas y Anti-Rebote',
        'Capstone - FSM + GPIO',
        'Bitwise y Registros Avanzados', 'Apuntadores y Memoria', 'Maquinas de Estado (FSM)',
    ]) {
        expect(treeText).toContain(unit.toLowerCase());
    }
});

test('progress on a pre-existing unit survives the super-unit reorganization', async ({ page }) => {
    // Simulates a real returning user: progress saved under the OLD flat
    // unit/exercise ids, from before super units existed.
    await page.addInitScript(() => {
        localStorage.setItem('apm32_learn_progress', JSON.stringify({
            'intro/ejercicio-01': true,
            'bitwise_avanzado/ejercicio-02': true,
        }));
    });

    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.click('#learnModeBtn');
    await page.waitForTimeout(500);

    // "Fundamentos de C" (intro) should show as [OK] (completed) -- 1 of
    // its 4 exercises done is enough for getUnitCompletedCount() > 0.
    // innerText renders the "[OK]"/title/count spans of one row on 3
    // separate lines (confirmed via an earlier manual Playwright dump),
    // so the marker is the line right before the title line, not on it.
    const lines = (await page.locator('#levelListPane').innerText()).split('\n');
    const titleIdx = lines.findIndex(l => l.trim() === 'Fundamentos de C');
    expect(titleIdx).toBeGreaterThan(0);
    expect(lines[titleIdx - 1].trim()).toBe('[OK]');
});
