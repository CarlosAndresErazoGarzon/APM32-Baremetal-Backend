/**
 * editor-survives-unrelated-file-op.test.js
 * Regression test for a bug found in code review (not yet reported by a
 * user, caught before ship): typing in the active file, then deleting or
 * renaming a DIFFERENT file from the sidebar before the old 800ms
 * app.js debounce had flushed the keystrokes into virtualFS, silently
 * reverted the edit. deleteFile()/renameFile()/renameFolder() (see
 * FileSystemBloc.js) all emit; that notified EditorUI's render(), whose
 * "did virtualFS change under me" self-heal check couldn't tell "my own
 * unsynced typing" apart from "a genuine external change" and called
 * Monaco's setValue() with the stale pre-keystroke content -- even though
 * the file being edited was never itself touched by the delete/rename.
 *
 * Fixed by removing the debounce entirely: EditorUI.onDidChangeModelContent()
 * now pushes every keystroke into the bloc synchronously (see EditorUI.js),
 * so there's no window left where virtualFS can lag the live buffer for
 * the active file, regardless of what else emits in the meantime.
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

test('typing survives deleting a different file from the sidebar before the old debounce would have flushed', async ({ page }) => {
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'extra.c' : undefined));

    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    // A second file to delete, distinct from the one being edited below.
    // createFile() switches currentFile to the new file, so re-select
    // main.c afterward -- otherwise these keystrokes would land in
    // extra.c, not the file this test means to protect.
    await page.click('#newFileBtn');
    await page.waitForTimeout(500);
    await expect(page.locator('#fileTreeList')).toContainText('extra.c');

    await page.locator('#fileTreeList span.truncate').filter({ hasText: /^main\.c$/ }).click({ force: true });
    await page.waitForTimeout(300);

    const EDITED = '// UNRELATED-DELETE RACE MARKER\nint main(void) { return 9; }\n';
    await page.evaluate((c) => {
        const models = monaco.editor.getModels();
        if (models.length > 0) models[0].setValue(c);
    }, EDITED);

    // Immediately (no wait -- the old bug needed to land INSIDE the
    // now-removed 800ms debounce window) delete the other file via the
    // sidebar's menu, same as a real user would.
    const nameSpan = page.locator('#fileTreeList span.truncate').filter({ hasText: /^extra\.c$/ });
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
        } catch {
            // Menu closed in the gap -- retry the whole sequence.
        }
    }
    await page.waitForTimeout(300);

    await expect(page.locator('#fileTreeList')).not.toContainText('extra.c');

    const value = await page.evaluate(() => monaco.editor.getModels()[0].getValue());
    expect(value).toBe(EDITED);
});
