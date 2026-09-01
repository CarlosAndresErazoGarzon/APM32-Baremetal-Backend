/**
 * cloud-save-rename-does-not-resurrect.test.js
 * Regression test for a real reported bug: renaming a file in Playground
 * (e.g. "arreglos.c" -> "test/arreglos.c"), then logging back in later,
 * showed BOTH the new path AND the old one back at the base directory --
 * a file the user had just renamed away came back from the dead.
 *
 * Root cause: saveProjectToCloud() wrote with `{ merge: true }` (no field
 * list). That option is load-bearing for the DOCUMENT's top-level fields
 * (`project`/`playgroundProject`/`learnProgress` are sibling fields on the
 * same users/{uid} doc, written by different bloc instances -- a plain
 * .set() would wipe whichever ones this call doesn't own) -- but real
 * Firestore also recurses `merge: true` INTO nested map fields. virtualFS
 * (this.cloudField's value) is exactly that: a nested map of filepath ->
 * content. A renamed-away key is simply absent from the new write, and
 * "absent" means "leave it alone" under merge:true, not "delete it" -- so
 * the old filename survived in Firestore forever, and the next
 * loadProjectFromCloud() pulled it back down alongside the new one.
 *
 * Fixed by writing with `{ mergeFields: ['email', 'lastUpdated',
 * this.cloudField] }` instead -- still protects sibling top-level fields
 * (the original goal), but each *named* field's value is now replaced
 * wholesale rather than deep-merged, so a removed virtualFS key actually
 * stays removed.
 *
 * The existing cloud-save-persistence.test.js's fake `db` is a total
 * no-op (`set: async () => {}`) -- it never actually stores anything, so
 * it could never have caught this. This test's fake Firestore keeps a
 * real in-memory document and implements both `merge: true` (recursive,
 * matching real Firestore's documented nested-map behavior) and
 * `mergeFields` (named top-level fields replaced wholesale) faithfully,
 * so it fails against the old `{ merge: true }` call and passes against
 * the fixed `{ mergeFields: [...] }` one.
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

test('renaming a file then saving to cloud does not resurrect the old name on the next login', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();

        // Deep-merge helper mirroring real Firestore's documented behavior
        // for `{ merge: true }`: recurse into plain-object values instead
        // of replacing them outright. Non-object values (strings, the
        // stubbed serverTimestamp sentinel) just overwrite, like Firestore
        // treats any scalar/leaf value.
        function deepMerge(target, incoming) {
            for (const [key, value] of Object.entries(incoming)) {
                if (value && typeof value === 'object' && !Array.isArray(value) &&
                    target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                    deepMerge(target[key], value);
                } else {
                    target[key] = value;
                }
            }
        }

        let stored = null; // the one users/{uid} "document" this fake persists across calls
        const fakeDb = {
            collection: () => ({
                doc: () => ({
                    set: async (data, options) => {
                        if (!stored) {
                            stored = {};
                        }
                        if (options && options.mergeFields) {
                            // Real Firestore semantics for a *named* field:
                            // replace that field's value wholesale, don't
                            // recurse into it -- this is the fix under test.
                            for (const field of options.mergeFields) {
                                stored[field] = data[field];
                            }
                        } else if (options && options.merge) {
                            deepMerge(stored, data);
                        } else {
                            stored = { ...data };
                        }
                    },
                    get: async () => ({
                        exists: !!stored,
                        data: () => stored
                    })
                })
            })
        };
        window.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'stub-timestamp' } } };
        const fakeUser = { uid: 'test-uid', email: 'test@example.com' };

        // 1) Simulate an existing cloud save from before the rename --
        //    the precondition the reported bug needs (a file already
        //    persisted under its old name).
        await bloc.saveProjectToCloud(fakeDb, fakeUser);
        const oldName = bloc.state.currentFile; // 'src/main.c' from the seed

        // 2) Rename it, like the file tree's "Rename" menu option does.
        const newName = 'moved/main_renamed.c';
        bloc.renameFile(oldName, newName);

        // 3) Save again -- this is the write that must actually drop the
        //    old key from the cloud copy, not just add the new one.
        await bloc.saveProjectToCloud(fakeDb, fakeUser);

        // 4) Simulate logging back in on a fresh session: pull the cloud
        //    copy back down and see what comes back.
        await bloc.loadProjectFromCloud(fakeDb, fakeUser);

        return {
            oldName,
            newName,
            hasOldName: oldName in bloc.state.virtualFS,
            hasNewName: newName in bloc.state.virtualFS,
            fileCount: Object.keys(bloc.state.virtualFS).length
        };
    });

    expect(result.hasNewName).toBe(true);
    expect(result.hasOldName).toBe(false);
});
