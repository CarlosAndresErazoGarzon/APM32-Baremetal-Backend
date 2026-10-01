/**
 * compile-error-markers-clear.test.js
 * Regression test for a real reported bug: fixing a syntax error and
 * recompiling successfully left the PREVIOUS attempt's red squiggly
 * markers sitting on the editor forever.
 *
 * Root cause: CompilerBloc.compile() only ever emitted COMPILER_ERRORS
 * (which EditorUI.js turns into Monaco markers) from its catch block, on
 * failure -- there was no code path that told the editor "there's nothing
 * to show anymore" once a later attempt actually succeeded. Contrast with
 * LearnBloc.js's grading flow, which already clears markers the instant a
 * NEW attempt starts, not just when one fails.
 *
 * Fixed by clearing markers (`COMPILER_ERRORS` with an empty array) right
 * when compile() begins, matching LearnBloc.js's own pattern -- so a
 * clean recompile always clears whatever the previous one left behind.
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

test('a clean recompile clears the previous attempt\'s error markers', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#editor .view-line');

    const originalContent = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());

    // #flashBtn stays disabled (see HardwareUI.js) until a real WebUSB DAP
    // link connects, which no headless test can do -- force it enabled to
    // exercise CompilerBloc.compile() itself, the thing this test is
    // actually about. compile() doesn't check dapBloc.state at all; only
    // the click handler's OWN flash-after-compile step does, and that's
    // fine either way since compile() returning null (the error case) or
    // dapBloc having no processor connected (the success case) both just
    // no-op past this point.
    const forceEnableFlashBtn = () => { document.getElementById('flashBtn').disabled = false; };

    // Break it -- a real syntax error the ARM cross-compiler will reject.
    await page.evaluate((c) => {
        window.monaco.editor.getModels()[0].setValue(c + '\nint x = ;\n');
    }, originalContent);

    await page.evaluate(forceEnableFlashBtn);
    await page.click('#flashBtn');
    await page.waitForFunction(
        () => document.getElementById('logBox').innerText.includes('Compile Error'),
        { timeout: 30000 }
    );

    const markersAfterFailure = await page.evaluate(
        () => window.monaco.editor.getModelMarkers({ owner: 'compiler' }).length
    );
    expect(markersAfterFailure).toBeGreaterThan(0);

    // Fix it -- back to the known-good starter content -- and recompile.
    await page.evaluate((c) => {
        window.monaco.editor.getModels()[0].setValue(c);
    }, originalContent);

    await page.evaluate(forceEnableFlashBtn);
    await page.click('#flashBtn');
    await page.waitForFunction(
        () => document.getElementById('logBox').innerText.includes('Compilation successful'),
        { timeout: 30000 }
    );

    const markersAfterSuccess = await page.evaluate(
        () => window.monaco.editor.getModelMarkers({ owner: 'compiler' }).length
    );
    expect(markersAfterSuccess).toBe(0);
});
