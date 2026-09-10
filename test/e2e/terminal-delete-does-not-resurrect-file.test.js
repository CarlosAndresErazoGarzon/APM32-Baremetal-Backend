/**
 * terminal-delete-does-not-resurrect-file.test.js
 * Regression test for a real reported bug: deleting a file from the
 * sidebar while Playground's live terminal was connected "didn't delete
 * it" -- it disappeared immediately, then came back a few seconds later.
 *
 * Root cause: ptySession.js's syncFiles() only ever WRITES whatever's in
 * the synced `files` object into the session's jobDir -- it had no
 * concept of "this file used to exist and doesn't anymore", so a deleted
 * file just sat on disk in jobDir forever. The next jobDir -> client poll
 * read it straight back off disk and handed it to the client as if the
 * terminal itself had just created/changed it, which (compared against
 * the client's own freshly-synced, file-deleted state) looked exactly
 * like a genuine external write -- resurrecting the very file the
 * student had just deleted.
 *
 * Fixed by having syncFiles() track the editor-tracked filenames from
 * the previous sync and explicitly remove from jobDir whichever ones
 * dropped out of the new set (see ptySession.js's own comment).
 *
 * File sync no longer runs on a background clock in either direction
 * (see ConsoleUI.js/ptySession.js's own history). A file reaches jobDir
 * only when Enter is pressed in the terminal (ConsoleUI flushes its
 * `dirty` flag synchronously first), and the terminal only polls jobDir
 * back once its own output goes quiet. So this test:
 *   1. creates extra.c, then runs a command in the terminal -- the Enter
 *      is what actually writes extra.c into jobDir (proven by `ls`),
 *   2. deletes extra.c, then runs another command -- that Enter's flush
 *      is where syncFiles() must notice extra.c dropped out and remove
 *      it from jobDir,
 *   3. waits out the command's output-quiet poll and confirms the
 *      sidebar didn't get the (by-then stale) file handed back.
 * Without the delete-diff, step 2's `ls` still finds extra.c AND step 3's
 * poll resurrects it in the tree -- the test catches the regression at
 * both points.
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

test('deleting a file stays deleted -- terminal command and file tree both', async ({ page }) => {
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'extra.c' : undefined));

    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(800);

    await page.click('#playgroundNewFileBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('#playgroundFileTreeList')).toContainText('extra.c');

    await page.click('#consoleTabBtn');
    await page.waitForTimeout(800);

    // Run a command -- this Enter flushes the pending edit (creating
    // extra.c marked ConsoleUI's `dirty` flag), which is what actually
    // writes extra.c into the session's jobDir. Confirm it landed.
    // `seedrc=$?` in the command, `seedrc=<digit>` only in the OUTPUT --
    // so the wait/assert can't be fooled by the pty echoing the command
    // line back. rc 0 = ls found it, rc 2 = "No such file".
    await page.click('#consoleXtermMount');
    await page.keyboard.insertText('ls extra.c > /dev/null 2>&1; echo "seedrc=$?"');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
        () => /seedrc=\d/.test(document.getElementById('consoleXtermMount').innerText),
        { timeout: 5000 }
    );
    let text = await page.evaluate(() => document.getElementById('consoleXtermMount').innerText);
    expect(text).toContain('seedrc=0'); // the Enter-flush really wrote it into jobDir

    // Delete it from the sidebar. Same sequence as playground-file-delete.test.js.
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

    // Run another command -- this Enter's flush is where syncFiles() has
    // to notice extra.c dropped out of the editor's file set and remove
    // it from jobDir. Without the delete-diff it's still sitting there.
    await page.click('#consoleXtermMount');
    await page.keyboard.insertText('ls extra.c > /dev/null 2>&1; echo "delrc=$?"');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
        () => /delrc=\d/.test(document.getElementById('consoleXtermMount').innerText),
        { timeout: 5000 }
    );
    text = await page.evaluate(() => document.getElementById('consoleXtermMount').innerText);
    expect(text).toMatch(/delrc=[1-9]/); // ls failed -> delete-diff removed it from jobDir
    expect(text).not.toContain('delrc=0'); // rc 0 would mean the stale file is still sitting there

    // The command's output going quiet triggers the next jobDir -> client
    // poll (ptySession.js's OUTPUT_QUIET_MS) -- give it comfortably long
    // enough to run, then confirm it didn't hand the file back as if the
    // terminal had just recreated it.
    await page.waitForTimeout(1500);
    await expect(page.locator('#playgroundFileTreeList')).not.toContainText('extra.c');
});
