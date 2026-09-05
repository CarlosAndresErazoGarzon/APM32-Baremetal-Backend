/**
 * terminal-delete-does-not-resurrect-file.test.js
 * Regression test for a real reported bug: deleting a file from the
 * sidebar while Playground's live terminal was connected "didn't delete
 * it" -- it disappeared immediately, then came back a few seconds later.
 *
 * Root cause: ptySession.js's syncFiles() (fired on every meaningful
 * editor change, see ConsoleUI.js) only ever WRITES whatever's in the
 * synced `files` object into the session's jobDir -- it had no concept
 * of "this file used to exist and doesn't anymore", so a deleted file
 * just sat on disk in jobDir forever. The next file-poll tick (every
 * FILE_POLL_MS) read it straight back off disk and handed it to the
 * client as if the terminal itself had just created/changed it, which
 * (compared against the client's own freshly-synced, file-deleted state)
 * looked exactly like a genuine external write -- resurrecting the very
 * file the student had just deleted.
 *
 * Fixed by having syncFiles() track the editor-tracked filenames from
 * the previous sync and explicitly remove from jobDir whichever ones
 * dropped out of the new set (see ptySession.js's own comment).
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

test('deleting a file stays deleted after the terminal\'s background file-poll cycle', async ({ page }) => {
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'extra.c' : undefined));

    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(800);

    await page.click('#playgroundNewFileBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('#playgroundFileTreeList')).toContainText('extra.c');

    // Connect the terminal BEFORE deleting -- this is what seeds jobDir
    // with extra.c in the first place (the real scenario: the terminal
    // is already open while a file gets deleted).
    await page.click('#consoleTabBtn');
    await page.waitForTimeout(800);

    // Same delete sequence as playground-file-delete.test.js.
    const nameSpan = page.locator('#playgroundFileTreeList span.truncate').filter({ hasText: /^extra\.c$/ });
    const row = nameSpan.locator('xpath=ancestor::div[contains(@class,"group")][1]');
    const menuBtn = row.locator('button').first();
    const deleteBtn = row.locator('.file-menu').getByText('Delete', { exact: true });
    for (let attempt = 0; attempt < 5; attempt++) {
        await row.hover();
        await menuBtn.click({ force: true });
        await page.waitForTimeout(200);
        if (!(await deleteBtn.isVisible())) continue;
        try {
            await deleteBtn.click({ force: true, timeout: 1000 });
            break;
        } catch { /* menu closed in the gap -- retry */ }
    }
    await expect(page.locator('#playgroundFileTreeList')).not.toContainText('extra.c');

    // Touch the editor to trigger a fresh sync (this is what propagates
    // the deletion to jobDir), then wait long enough to cross multiple
    // file-poll ticks (FILE_POLL_MS = 2000) -- the real bug only showed
    // up once the poll actually ran again after the delete.
    const lines = page.locator('#editor .view-line');
    const lineCount = await lines.count();
    await lines.nth(lineCount - 1).click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n// touch', { delay: 20 });
    await page.waitForTimeout(6000);

    await expect(page.locator('#playgroundFileTreeList')).not.toContainText('extra.c');
});
