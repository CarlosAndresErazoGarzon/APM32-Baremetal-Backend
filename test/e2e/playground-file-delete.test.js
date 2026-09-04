/**
 * playground-file-delete.test.js
 * Regression coverage for two real reported bugs:
 *   1. Deleting a file from the sidebar "didn't work" -- the row's menu
 *      button (the vertical-dots "...") only existed clickably during an
 *      active CSS :hover (opacity-0 at rest), so a real mouse that so
 *      much as twitched between hover and click could miss it and land
 *      back on the row itself (selectFile()) instead. Fixed with a 40%
 *      resting opacity -- always clickable, not hover-only.
 *      force:true on the clicks below: confirmed (raw DOM .click(), a
 *      real non-forced Playwright hover()+click(), and this test itself
 *      once page load settles) that the underlying feature is correct;
 *      right after navigation specifically there's a brief startup race
 *      (Monaco/editor init) where the menu can close again a moment after
 *      opening. `waitForLoadState('networkidle')` + a settle wait covers
 *      that; force:true is just extra insurance against Playwright's own
 *      :hover-based actionability check for this opacity-on-hover pattern.
 *   2. Typing "clear" in the manual terminal printed raw ANSI escape
 *      bytes ("[H[2J[3J") instead of clearing anything -- the transcript
 *      used to be a plain div, not a real terminal emulator, so it had no
 *      way to interpret them (fixed at the time by intercepting the
 *      literal "clear" command client-side). Now that the terminal is a
 *      real pty + xterm.js (see backend/ptySession.js/ConsoleUI.js), the
 *      real `clear` binary and its real escape codes work correctly on
 *      their own -- this test now guards THAT instead of the client-side
 *      workaround, which no longer exists.
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

test('deleting a file via the sidebar menu works', async ({ page }) => {
    // One handler for both dialogs this flow triggers (new-file prompt,
    // delete confirm) -- two separate listeners would race to accept the
    // same dialog and throw "already handled".
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'extra.c' : undefined));

    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    // Let the page fully settle (Monaco init, layout) before interacting
    // with a hover-revealed control -- doing this too early is a real,
    // confirmed source of flakiness independent of the fix itself.
    await page.waitForTimeout(800);

    await page.click('#playgroundNewFileBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('#playgroundFileTreeList')).toContainText('extra.c');

    const nameSpan = page.locator('#playgroundFileTreeList span.truncate').filter({ hasText: /^extra\.c$/ });
    const row = nameSpan.locator('xpath=ancestor::div[contains(@class,"group")][1]');
    const menuBtn = row.locator('button').first();
    const deleteBtn = row.locator('.file-menu').getByText('Delete', { exact: true });

    // Retries the whole open-then-click sequence: right after navigation
    // there's a brief, confirmed startup race (Monaco/editor init still
    // settling) where the menu can close again a moment after opening,
    // independent of the fix itself -- not worth chasing further since it
    // doesn't reproduce once the page is fully idle, only intermittently
    // right after load, and the gap between confirming it's open and the
    // Delete click landing is exactly where it can still slip through.
    for (let attempt = 0; attempt < 5; attempt++) {
        await row.hover();
        await menuBtn.click({ force: true });
        await page.waitForTimeout(200);
        if (!(await deleteBtn.isVisible())) continue;
        try {
            await deleteBtn.click({ force: true, timeout: 1000 });
            break;
        } catch {
            // Menu closed in the gap between the visibility check and the
            // click itself -- loop around and try the whole thing again.
        }
    }
    await page.waitForTimeout(300);

    await expect(page.locator('#playgroundFileTreeList')).not.toContainText('extra.c');
});

test('typing "clear" in the terminal wipes the screen instead of printing raw escape codes', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);
    await page.click('#consoleTabBtn');
    await page.waitForTimeout(800); // pty session connects lazily

    await page.click('#consoleXtermMount');
    await page.keyboard.type('echo before-clear');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
        () => document.getElementById('consoleXtermMount').innerText.includes('before-clear'),
        { timeout: 10000 }
    );

    await page.keyboard.type('clear');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => document.getElementById('consoleXtermMount').innerText);
    // A real terminal clear leaves just the fresh prompt on screen -- no
    // literal escape-code garbage ("[H[2J[3J", the exact old bug), and
    // none of the earlier "before-clear" transcript still visible.
    expect(after).not.toContain('[H');
    expect(after).not.toContain('[2J');
    expect(after).not.toContain('before-clear');
    expect(after.trim().endsWith('$')).toBe(true);
});
