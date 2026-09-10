/**
 * console-file-poll-does-not-clobber-typing.test.js
 * Regression test for a real reported bug: typing in the editor while
 * Playground's live terminal is connected would periodically reset the
 * cursor to the start of the file and swallow a keystroke there --
 * visually, the student saw their own typed text ("hola hola hola...")
 * get prepended ahead of the file's real content ("hola#include
 * <stdio.h>").
 *
 * Root cause: ConsoleUI.js's 'files' handler (fired every jobDir poll)
 * compared the server's echoed-back content against a FRESH read of the
 * CURRENT live bloc state to decide whether the terminal genuinely
 * changed a file. For whichever file is actively being typed into, the
 * live editor is ALWAYS ahead of a stale poll snapshot -- so every poll
 * tick looked like "the terminal changed this file" purely from that
 * lag, and EditorUI.js's own contentChanged check (see renderMode())
 * called editor.setValue() with the STALE content, which both reverted
 * recent keystrokes AND reset Monaco's cursor to (1,1) as setValue()'s
 * own side effect -- exactly where the next keystroke then landed.
 *
 * Fixed by comparing against the EXACT snapshot last actually sent to the
 * server (ConsoleUI.js's own this.lastSyncedFiles), not a live re-read --
 * see ConsoleUI.js's own comment on this.
 *
 * The poll itself no longer runs on a background clock (see
 * ptySession.js's own history -- that clock, ticking independently of
 * whatever the student was doing, is what made this race possible at
 * all) -- it now runs once shortly after the pty's OWN output goes
 * quiet. So this test has to actually MAKE the pty do something on a
 * loop while typing (a shell loop that appends to a file and prints
 * once a second) to keep genuinely re-triggering that poll AND giving
 * it a real change to report back -- typing with the terminal merely
 * connected and otherwise silent would never poll at all under the new
 * mechanism, and would pass trivially without proving anything.
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

test('typing in the editor survives the terminal\'s file-poll echoing content back', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);

    // Connect the live terminal, then kick off a background loop that
    // both prints AND changes a file once a second for the next several
    // seconds. The print re-arms ptySession.js's output-quiet poll (each
    // ~1s gap is well past OUTPUT_QUIET_MS); the file change is what
    // makes that poll actually SEND a 'files' message back -- a full
    // jobDir snapshot that also carries the (server-side unchanged)
    // main.c. That echoed-back main.c racing against the copy being
    // typed into the editor is the exact original bug; it must be
    // compared against ConsoleUI's lastSyncedFiles, not a live re-read.
    await page.click('#consoleTabBtn');
    await page.waitForTimeout(500);
    await page.click('#consoleXtermMount');
    await page.keyboard.insertText('for i in 1 2 3 4 5 6 7 8; do echo "tick $i" >> ticks.log; sleep 1; done');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Back to the editor, type continuously for long enough to overlap
    // several of that loop's own print-then-quiet cycles -- the exact
    // real-world timing that triggered it.
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
