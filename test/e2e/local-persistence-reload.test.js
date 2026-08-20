/**
 * local-persistence-reload.test.js
 * Regression test for a real reported bug: editing a file in IDE or
 * Playground (no login involved) and reloading the page lost the edit --
 * FileSystemBloc never persisted anything itself; only an explicit SAVE
 * CLOUD (which needs an account) did. Fixed with a namespace-scoped
 * localStorage mirror in FileSystemBloc (guest bucket by default, a uid
 * bucket once signed in -- same account-isolation design as
 * LearnBloc.setNamespace()) plus a debounced app.js sync so plain typing
 * (not just a file switch) reaches it.
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

async function typeIntoEditor(page, code) {
    await page.evaluate((c) => {
        const models = monaco.editor.getModels();
        if (models.length > 0) models[0].setValue(c);
    }, code);
    // The app.js debounce is 800ms.
    await page.waitForTimeout(1200);
}

test('an IDE edit survives a page reload without logging in', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const EDITED = '// IDE RELOAD TEST MARKER\nint main(void) { return 7; }\n';
    await typeIntoEditor(page, EDITED);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const value = await page.evaluate(() => monaco.editor.getModels()[0].getValue());
    expect(value).toBe(EDITED);
});

test('a Playground edit survives a page reload without logging in', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(800);

    const EDITED = '#include <stdio.h>\n\nint main(void) {\n    printf("RELOAD TEST\\n");\n    return 0;\n}\n';
    await typeIntoEditor(page, EDITED);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    // A fresh load defaults to IDE mode -- switch back to see the restored
    // Playground content.
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);

    const value = await page.evaluate(() => monaco.editor.getModels()[0].getValue());
    expect(value).toBe(EDITED);
});
