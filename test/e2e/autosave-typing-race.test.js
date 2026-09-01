/**
 * autosave-typing-race.test.js
 * Regression test for a real reported bug: "a veces estoy escribiendo
 * dentro del editor y me devuelve al top del archivo" -- the cursor jumps
 * to line 1 mid-typing.
 *
 * Root cause (original): FileSystemBloc.saveProjectToCloud() snapshotted
 * the editor content BEFORE the Firestore write, then reused that same
 * stale snapshot in the local virtualFS update AFTER the write's real,
 * unbounded-latency network round-trip finished. If the student resumed
 * typing during that window, EditorUI.render()'s stale-content check saw
 * the live editor disagree with the (stale) virtualFS and called Monaco's
 * setValue() -- which unconditionally resets the cursor to the top of the
 * file regardless of whether the content it's setting even differs.
 *
 * Current design: the editor is no longer the thing saveProjectToCloud()
 * has to reconcile against at all. EditorUI.onDidChangeModelContent() now
 * pushes every keystroke into state.virtualFS synchronously (see
 * EditorUI.js), so virtualFS is always whatever's newest -- including
 * anything typed WHILE a save's network round-trip is still in flight --
 * and saveProjectToCloud()'s own trailing emit no longer touches virtualFS
 * at all (see FileSystemBloc.js), so it has nothing stale left to write
 * back over newer keystrokes.
 *
 * Simulates real network latency with a deliberately slow fake Firestore
 * write, then simulates the student resuming typing while it's "in
 * flight" the same way EditorUI would: a synchronous updateFileContent()
 * call, not a getter saveProjectToCloud() reads later.
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

test('resuming typing while a cloud save is still in flight does not revert the newer keystrokes', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();
        const currentFile = bloc.state.currentFile;

        bloc.updateFileContent(currentFile, 'ORIGINAL');

        const fakeDb = {
            collection: () => ({
                doc: () => ({
                    set: async () => { await new Promise(r => setTimeout(r, 500)); }
                })
            })
        };
        window.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'stub' } } };
        const fakeUser = { uid: 'u1', email: 'u1@example.com' };

        const savePromise = bloc.saveProjectToCloud(fakeDb, fakeUser);

        // The student resumes typing WHILE the save is still in flight --
        // same synchronous call EditorUI.onDidChangeModelContent() makes
        // on every keystroke.
        await new Promise(r => setTimeout(r, 100));
        bloc.updateFileContent(currentFile, 'ORIGINAL PLUS NEW TYPING');

        await savePromise;

        return { virtualFSAfterSave: bloc.state.virtualFS[currentFile] };
    });

    expect(result.virtualFSAfterSave).toBe('ORIGINAL PLUS NEW TYPING');
});
