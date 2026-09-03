/**
 * playground-edit-persistence.test.js
 * Regression test for a real bug reported by the user: editing main.c in
 * Playground and compiling it via the manual terminal ("gcc main.c -o
 * test") silently reverted the editor back to the Playground seed
 * ("Hello, APM32!"). Root cause: ConsoleUI's execute() patched a LOCAL
 * `files` object with the live editor content for the outgoing request,
 * but never wrote that back into playgroundFsBloc's own `virtualFS` --
 * only a file SWITCH did that. Any later emit on the same bloc (e.g.
 * setBinaryNames(), fired right after a successful compile) made
 * EditorUI.renderPlayground()'s stale-content self-heal check see editor
 * != virtualFS and "fix" it backwards, overwriting the user's unsaved edit
 * with the last-synced (often: never synced, still-seed) content. Fixed
 * by syncing virtualFS via updateFileContent() at the same point the live
 * editor content is read, in ConsoleUI.js's execute(). (There used to be
 * a second copy of this test for a fixed compile-then-run RUN button,
 * which had the identical bug and the identical fix -- removed along with
 * that button once the terminal became the only way to run things in
 * Playground.)
 *
 * The Clear button (below) hit the exact same root cause through a
 * different door: it also emits on playgroundFsBloc (setBinaryNames([])),
 * with no compile involved at all -- reported separately, fixed the same
 * way.
 *
 * The terminal itself is a real pty-backed shell now (see
 * backend/ptySession.js/ConsoleUI.js), not a request/response exec per
 * command, but the same class of bug is worth re-guarding here: compiling
 * (a `files` snapshot round-tripping through the WebSocket) or clearing
 * (xterm's own term.clear(), which touches nothing bloc-related at all
 * anymore) must still never revert an unsaved Monaco edit.
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

const EDITED_CONTENT = '#include <stdio.h>\n\nint main(void) {\n    printf("EDITED BY TEST\\n");\n    return 0;\n}\n';

async function editMainC(page) {
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);
    await page.evaluate((code) => {
        const models = monaco.editor.getModels();
        if (models.length > 0) models[0].setValue(code);
    }, EDITED_CONTENT);
    // Let the edit fully settle into playgroundFsBloc before the terminal
    // reads it (see terminal-stdin.test.js's own comment on this same
    // ordering -- ConsoleUI.js seeds its pty session from whatever
    // playgroundFsBloc.state.virtualFS says at the moment the tab opens).
    await page.waitForTimeout(1000);
}

async function editorValue(page) {
    return page.evaluate(() => monaco.editor.getModels()[0].getValue());
}

test('editing main.c and compiling it via the manual terminal does not revert the edit', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await editMainC(page);

    await page.click('#consoleTabBtn');
    await page.waitForTimeout(800); // pty session connects lazily
    await page.click('#consoleXtermMount');
    await page.keyboard.type('gcc main.c -o test');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
        () => document.getElementById('consoleXtermMount').innerText.includes('gcc main.c -o test'),
        { timeout: 10000 }
    );
    // The compile itself has no output on success -- wait for the prompt
    // to come back instead of a specific message.
    await page.waitForTimeout(1000);

    expect(await editorValue(page)).toBe(EDITED_CONTENT);
});

test('editing main.c and pressing the terminal\'s Clear button does not revert the edit', async ({ page }) => {
    // Same bug, same fix, different trigger: a real user hit this by
    // editing a file and clicking Clear before ever running a command --
    // no compile involved, so setBinaryNames([]) was the only emit on
    // playgroundFsBloc, and that alone was enough to trip the self-heal.
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await editMainC(page);

    await page.click('#consoleTabBtn');
    await page.waitForTimeout(800);
    await page.click('#consoleClearBtn');
    await page.waitForTimeout(300);

    expect(await editorValue(page)).toBe(EDITED_CONTENT);
});
