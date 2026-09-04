/**
 * terminal-connects-on-direct-load.test.js
 * Regression test for a real reported bug: the terminal never connected
 * (blank cursor, typing did nothing) whenever the page loaded DIRECTLY
 * into Playground mode -- e.g. reloading a tab that was already in
 * Playground last time, not switching to it via a live click.
 *
 * Root cause: ConsoleUI.js only ever called connect() in response to a
 * CONSOLE_TAB_SHOWN event, fired by TerminalUI.js's onModeChange(). But
 * TerminalUI is constructed BEFORE ConsoleUI in app.js, and
 * modeBloc.subscribe() calls its callback SYNCHRONOUSLY with the CURRENT
 * state the moment it subscribes (see Bloc.js) -- not just on future
 * changes. If the persisted mode was already 'playground', that
 * synchronous first call fired CONSOLE_TAB_SHOWN before ConsoleUI even
 * existed to register a listener for it. The event fired into nothing,
 * connect() was never called, and xterm.js (which has no local echo of
 * its own -- it relies entirely on the pty echoing back whatever's sent)
 * showed nothing at all: not even an error, just a blank cursor forever.
 *
 * Fixed by also checking the DOM directly at ConsoleUI's own construction
 * time (whatever hid/showed #consolePanel already ran by then, regardless
 * of whether the event that used to signal it was heard).
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

test('the terminal auto-connects on a fresh load that starts directly in Playground mode', async ({ page }) => {
    // First visit: switch to Playground so it's what gets persisted --
    // the exact real-world path (last thing you did before closing the
    // tab), not something this test fakes by writing localStorage itself.
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => localStorage.getItem('apm32_mode'))).toBe('playground');

    // A genuinely fresh navigation -- not a live setMode() call, which
    // would have masked this bug (a REAL mode change reaches an
    // already-existing ConsoleUI listener just fine; only the page's own
    // very first synchronous mode-sync at construction time is affected).
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#playgroundModeBtn')).toHaveClass(/active/);

    // No manual click on the console tab anywhere in this test -- it
    // should already be showing (Playground always lands there) AND
    // already connected, without any further interaction.
    await page.click('#consoleXtermMount');
    await page.keyboard.type('echo direct-load-works');
    await page.keyboard.press('Enter');

    await page.waitForFunction(
        () => document.getElementById('consoleXtermMount').innerText.includes('direct-load-works'),
        { timeout: 10000 }
    );
});
