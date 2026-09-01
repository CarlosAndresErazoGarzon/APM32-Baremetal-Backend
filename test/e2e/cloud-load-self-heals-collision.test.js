/**
 * cloud-load-self-heals-collision.test.js
 * Regression test for a real reported bug that kept recurring even after
 * two earlier fixes: a project with a file/folder name collision (e.g. a
 * stray "fun_est" file next to a "fun_est/" folder) errored out on every
 * single compile, no matter which file was being built (createJobDir()
 * materializes the WHOLE project, not just the target file). Deleting the
 * stray file client-side "fixed" it -- until the next fresh login pulled
 * the still-corrupted cloud copy back down and undid the fix, because
 * nothing had pushed the delete to Firestore.
 *
 * Fixed at the root: loadProjectFromCloud() now runs the loaded map
 * through sanitizeCollisions() (same logic backing createFile/renameFile/
 * renameFolder's guards) and, if it had to rename anything away, pushes
 * the corrected copy straight back to Firestore via saveProjectToCloud()
 * -- unconditionally, not gated behind the autosave toggle, since this is
 * a data-integrity repair, not an opt-in feature. So the fix survives the
 * NEXT login too, not just the current session.
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

test('a corrupted cloud project self-heals on load and the fix survives a second login', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();

        // A stateful fake Firestore (not the no-op stub other tests use --
        // this scenario specifically depends on what got WRITTEN back).
        let stored = {
            playgroundProject: {
                'fun_est': '// stray file\n',
                'fun_est/estructuras.c': 'int main(void){return 0;}\n'
            }
        };
        const fakeDb = {
            collection: () => ({
                doc: () => ({
                    set: async (data, options) => {
                        if (options && options.mergeFields) {
                            for (const field of options.mergeFields) stored[field] = data[field];
                        } else {
                            stored = { ...stored, ...data };
                        }
                    },
                    get: async () => ({ exists: true, data: () => stored })
                })
            })
        };
        window.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'stub' } } };
        const fakeUser = { uid: 'u1', email: 'u1@example.com' };
        bloc.cloudField = 'playgroundProject';

        // 1) First login: pulls the corrupted doc down.
        await bloc.loadProjectFromCloud(fakeDb, fakeUser);
        const afterFirstLoad = {
            hasStray: 'fun_est' in bloc.state.virtualFS,
            hasRenamed: 'fun_est_file' in bloc.state.virtualFS,
            hasFolder: 'fun_est/estructuras.c' in bloc.state.virtualFS
        };

        // 2) Second login (fresh bloc instance, like a brand new session)
        //    -- the fix must have made it back to `stored`, not just this
        //    bloc's own in-memory state.
        const bloc2 = new FileSystemBloc();
        bloc2.cloudField = 'playgroundProject';
        await bloc2.loadProjectFromCloud(fakeDb, fakeUser);
        const afterSecondLogin = {
            hasStray: 'fun_est' in bloc2.state.virtualFS,
            hasRenamed: 'fun_est_file' in bloc2.state.virtualFS
        };

        return { afterFirstLoad, afterSecondLogin };
    });

    expect(result.afterFirstLoad.hasStray).toBe(false);
    expect(result.afterFirstLoad.hasRenamed).toBe(true);
    expect(result.afterFirstLoad.hasFolder).toBe(true);

    expect(result.afterSecondLogin.hasStray).toBe(false);
    expect(result.afterSecondLogin.hasRenamed).toBe(true);
});
