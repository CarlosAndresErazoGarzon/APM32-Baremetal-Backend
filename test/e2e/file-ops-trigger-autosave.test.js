/**
 * file-ops-trigger-autosave.test.js
 * Regression test for a real reported bug: deleting a file (or renaming
 * one, or a folder), then reloading or logging back in before ALSO typing
 * something or clicking SAVE CLOUD, brought the deleted/old file right
 * back. Root cause: AutoSaveUI only ever schedules a cloud save in
 * response to the 'EDITOR_CONTENT_CHANGED' event, which used to fire on
 * keystrokes only -- createFile/deleteFile/renameFile/renameFolder/
 * deleteFolder never fired it, so a session that only did file-tree
 * housekeeping (no typing, no manual Save Cloud click) never persisted
 * that housekeeping at all. The next loadProjectFromCloud() then restored
 * the untouched old cloud copy, silently undoing it.
 *
 * Concretely this is how the "fun_est" file/folder collision (see
 * job-dir-file-folder-collision.test.js) kept coming back even after being
 * deleted in the file tree: the delete never made it to the cloud.
 *
 * Fixed by having those five FileSystemBloc mutations also emit
 * 'EDITOR_CONTENT_CHANGED' -- the exact signal AutoSaveUI already listens
 * for, so no changes were needed in AutoSaveUI itself.
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

test('createFile/deleteFile/renameFile/renameFolder/deleteFolder all fire EDITOR_CONTENT_CHANGED', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const { globalEventBus } = await import('./js/core/EventBus.js');
        const bloc = new FileSystemBloc();

        let fires = 0;
        const listener = () => { fires++; };
        globalEventBus.on('EDITOR_CONTENT_CHANGED', listener);

        const seen = {};

        fires = 0;
        bloc.createFile('a.c');
        seen.createFile = fires > 0;

        fires = 0;
        bloc.deleteFile('a.c');
        seen.deleteFile = fires > 0;

        bloc.createFile('b.c');
        fires = 0;
        bloc.renameFile('b.c', 'c.c');
        seen.renameFile = fires > 0;

        bloc.createFile('folder/x.c');
        fires = 0;
        bloc.renameFolder('folder', 'renamed');
        seen.renameFolder = fires > 0;

        fires = 0;
        bloc.deleteFolder('renamed');
        seen.deleteFolder = fires > 0;

        globalEventBus.off('EDITOR_CONTENT_CHANGED', listener);
        return seen;
    });

    expect(result.createFile).toBe(true);
    expect(result.deleteFile).toBe(true);
    expect(result.renameFile).toBe(true);
    expect(result.renameFolder).toBe(true);
    expect(result.deleteFolder).toBe(true);
});
