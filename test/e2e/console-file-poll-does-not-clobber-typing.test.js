/**
 * console-file-poll-does-not-clobber-typing.test.js
 * Regression test for a real reported bug: typing in the editor while
 * Playground's live terminal is connected would periodically reset the
 * cursor to the start of the file and swallow a keystroke there --
 * visually, the student saw their own typed text ("hola hola hola...")
 * get prepended ahead of the file's real content ("hola#include
 * <stdio.h>").
 *
 * Root cause: ConsoleUI.js's 'files' handler (fired every FILE_POLL_MS by
 * ptySession.js's jobDir poll) compared the server's echoed-back content
 * against a FRESH read of the CURRENT live bloc state to decide whether
 * the terminal genuinely changed a file. For whichever file is actively
 * being typed into, the live editor is ALWAYS ahead of the ~2-second-old
 * poll snapshot -- so every single poll tick looked like "the terminal
 * changed this file" purely from that lag, and EditorUI.js's own
 * contentChanged check (see renderMode()) called editor.setValue() with
 * the STALE content, which both reverted recent keystrokes AND reset
 * Monaco's cursor to (1,1) as setValue()'s own side effect -- exactly
 * where the next keystroke then landed.
 *
 * Fixed by comparing against the EXACT snapshot last actually sent to the
 * server (ConsoleUI.js's own this.lastSyncedFiles), not a live re-read --
 * see ConsoleUI.js's own comment on this.
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

test('typing in the editor survives the terminal\'s background file-poll cycle', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);

    // Connect the live terminal -- this is what starts the background
    // file-poll cycle (ptySession.js's FILE_POLL_MS) that raced against
    // typing in the real bug.
    await page.click('#consoleTabBtn');
    await page.waitForTimeout(500);

    // Back to the editor, type continuously for long enough to cross the
    // poll interval (2s) at least twice, plus the sync debounce (500ms)
    // several times over -- the exact real-world timing that triggered it.
    const lines = page.locator('#editor .view-line');
    const lineCount = await lines.count();
    await lines.nth(lineCount - 1).click();
    await page.keyboard.press('End');

    const typed = 'hola hola hola hola hola hola hola hola';
    for (const ch of typed) {
        await page.keyboard.type(ch);
        await page.waitForTimeout(140);
    }
    await page.waitForTimeout(500);

    const content = await page.evaluate(() => window.monaco.editor.getModels()[0].getValue());

    // The typed text landed intact, in one piece, wherever the cursor
    // actually was -- not scattered, not missing a swallowed character.
    expect(content).toContain(typed);
    // The original first line is untouched -- the real bug prepended a
    // stray fragment of the typed text directly onto it.
    expect(content.split('\n')[0]).toBe('#include <stdio.h>');
});
