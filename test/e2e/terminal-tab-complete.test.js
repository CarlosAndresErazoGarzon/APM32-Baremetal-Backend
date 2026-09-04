/**
 * terminal-tab-complete.test.js
 * ConsoleUI.js used to implement its own client-side filename completion
 * against virtualFS's own keys (no PATH command-name completion, since the
 * real available command set lives in the sandbox's shell, not anywhere
 * this client had an authoritative answer for -- see git history for that
 * implementation). Now that the terminal is a real pty-backed bash (see
 * backend/ptySession.js), Tab reaches bash's OWN readline completion
 * directly -- this is the regression test for the part that's actually
 * this app's responsibility: that a raw Tab keypress reaches the pty as a
 * plain byte instead of the browser's default "jump to the next focusable
 * element" behavior, which would silently un-focus the terminal instead of
 * completing anything.
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

test('Tab reaches the real shell and completes a unique filename', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);

    await page.click('#consoleTabBtn');
    await page.waitForTimeout(800); // pty session connects lazily

    await page.click('#consoleXtermMount');
    await page.keyboard.type('cat ma');
    await page.keyboard.press('Tab');
    // Give bash's own readline a moment to answer -- not a round trip to
    // this app's server logic, just the pty's own local echo of whatever
    // it completed to.
    await page.waitForFunction(
        () => document.getElementById('consoleXtermMount').innerText.includes('cat main.c'),
        { timeout: 5000 }
    );

    // The default browser Tab behavior (move focus to the next element)
    // must have been suppressed -- the hidden textarea xterm.js types
    // into should still be the active element, not e.g. the Clear button
    // that happens to sit right after this panel in tab order.
    const stillFocused = await page.evaluate(() =>
        document.activeElement?.classList.contains('xterm-helper-textarea')
    );
    expect(stillFocused).toBe(true);
});

test('Tab with no matching file leaves the shell waiting instead of guessing', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);

    await page.click('#consoleTabBtn');
    await page.waitForTimeout(800);

    await page.click('#consoleXtermMount');
    await page.keyboard.type('cat zzz');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    // Bash's completion has nothing to offer for "zzz" -- the line stays
    // exactly as typed (at most a bell/no-op), never silently mangled or
    // cleared.
    const text = await page.evaluate(() => document.getElementById('consoleXtermMount').innerText);
    expect(text).toContain('cat zzz');
});
