/**
 * file-folder-name-collision-guard.test.js
 * Regression test for a real reported bug: a plain file and a folder
 * ended up sharing the same name in virtualFS (e.g. a stray file literally
 * called "fun_est" alongside "fun_est/estructuras.c") -- there was no
 * separate "this is a folder" marker to prevent it, and it crashed the
 * backend's job-dir writer with a raw
 *   "EEXIST: file already exists, mkdir '/tmp/playground_exec_.../fun_est'"
 * the moment the student tried to compile/run anything (see
 * job-dir-file-folder-collision.test.js for that half).
 *
 * This covers the other half: FileSystemBloc.createFile/renameFile/
 * renameFolder must refuse to CREATE that collision in the first place,
 * from any of the three places a name can change.
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

test('createFile/renameFile/renameFolder refuse a file/folder name collision', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();

        // Start from a known, minimal virtualFS instead of the IDE seed,
        // so the folder/file relationships under test are unambiguous.
        bloc.emit({ virtualFS: { 'fun_est/estructuras.c': 'int main(){return 0;}' }, currentFile: 'fun_est/estructuras.c' });

        // 1) createFile: a plain file named exactly like the existing folder.
        const createOk = bloc.createFile('fun_est');

        // 2) renameFile: renaming some OTHER file into that same collision.
        bloc.createFile('other.c');
        const renameOk = bloc.renameFile('other.c', 'fun_est');

        // 3) renameFolder: renaming an unrelated folder to collide with a
        //    plain file that already exists.
        bloc.emit({ virtualFS: { ...bloc.state.virtualFS, 'plainfile': 'x', 'otherfolder/a.c': 'x' } });
        const renameFolderOk = bloc.renameFolder('otherfolder', 'plainfile');

        // Sanity: a legitimate, non-colliding rename still works fine --
        // the guard must not be over-broad.
        bloc.createFile('legit.c');
        const legitRenameOk = bloc.renameFile('legit.c', 'somewhere/legit.c');

        return {
            createOk, renameOk, renameFolderOk, legitRenameOk,
            hasStrayFunEst: bloc.state.virtualFS['fun_est'] !== undefined,
            hasLegitMove: bloc.state.virtualFS['somewhere/legit.c'] !== undefined
        };
    });

    expect(result.createOk).toBe(false);
    expect(result.renameOk).toBe(false);
    expect(result.renameFolderOk).toBe(false);
    expect(result.hasStrayFunEst).toBe(false);

    expect(result.legitRenameOk).toBe(true);
    expect(result.hasLegitMove).toBe(true);
});
