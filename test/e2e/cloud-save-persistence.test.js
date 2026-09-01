/**
 * cloud-save-persistence.test.js
 * Regression test for a real reported bug: editing a file and clicking
 * "SAVE CLOUD" erased the edit from the editor right after saving it.
 * Root cause (original): FileSystemBloc.saveProjectToCloud() synced the
 * live editor content into a *local* `fsToSave` copy for the Firestore
 * write, but never wrote it back into `this.state.virtualFS`. The trailing
 * `this.emit({ projectType: 'cloud', ... })` still notified EditorUI's
 * render()/renderPlayground(), whose stale-content self-heal check saw
 * the (unpatched, stale) virtualFS disagree with the live editor content
 * and reverted the editor -- the cloud copy was correct, the on-screen one
 * wasn't.
 *
 * Current design: EditorUI.onDidChangeModelContent() now pushes every
 * keystroke into state.virtualFS synchronously (see EditorUI.js), so
 * virtualFS already IS "what's on screen" at every instant -- there's no
 * separate snapshot for saveProjectToCloud() to fold back in anymore, and
 * its own emit no longer touches virtualFS at all. This test drives that
 * same sequence directly on the bloc (updateFileContent(), simulating
 * EditorUI's per-keystroke sync, then saveProjectToCloud()) and asserts
 * the edit is still there afterward.
 *
 * Drives FileSystemBloc directly (dynamically imported inside the page)
 * with a stub Firestore db/user rather than through real Firebase auth --
 * this is really testing FileSystemBloc's own state-consistency
 * bookkeeping, not Firebase itself.
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

test('saving to cloud does not revert the just-saved edit in the bloc\'s own state', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();

        // Stub db: just enough of the chain saveProjectToCloud() calls,
        // resolving instantly instead of hitting real Firestore.
        const fakeDb = {
            collection: () => ({
                doc: () => ({
                    set: async () => {}
                })
            })
        };
        // saveProjectToCloud() reads `firebase.firestore.FieldValue...` as
        // a global -- stub the one property it touches.
        window.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'stub-timestamp' } } };
        const fakeUser = { uid: 'test-uid', email: 'test@example.com' };

        const currentFile = bloc.state.currentFile;
        const EDITED = '// EDITED CONTENT FOR THIS TEST\nint x = 42;\n';

        // Same call EditorUI.onDidChangeModelContent() makes on every
        // keystroke -- by the time SAVE CLOUD is clicked, virtualFS is
        // already this, not a stale seed.
        bloc.updateFileContent(currentFile, EDITED);

        await bloc.saveProjectToCloud(fakeDb, fakeUser);

        return { virtualFSContent: bloc.state.virtualFS[currentFile], projectType: bloc.state.projectType };
    });

    expect(result.virtualFSContent).toBe('// EDITED CONTENT FOR THIS TEST\nint x = 42;\n');
    expect(result.projectType).toBe('cloud');
});
