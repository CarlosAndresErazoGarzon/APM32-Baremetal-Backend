/**
 * autosave-typing-race.test.js
 * Regression test for a real reported bug: "a veces estoy escribiendo
 * dentro del editor y me devuelve al top del archivo" -- the cursor jumps
 * to line 1 mid-typing.
 *
 * Root cause: FileSystemBloc.saveProjectToCloud() (fired by the Autosave
 * checkbox's debounce, or the manual SAVE CLOUD button) snapshotted the
 * editor content BEFORE the Firestore write, then reused that same stale
 * snapshot in the local virtualFS update AFTER the write's real,
 * unbounded-latency network round-trip finished. If the student resumed
 * typing during that window, EditorUI.render()'s stale-content check saw
 * the live editor disagree with the (stale) virtualFS and called
 * Monaco's setValue() -- which unconditionally resets the cursor to the
 * top of the file regardless of whether the content it's setting even
 * differs. Fixed by re-reading the editor content fresh (via a getter
 * function, not a pre-evaluated string) right before that final emit.
 *
 * Simulates real network latency with a deliberately slow fake Firestore
 * write, typing more content while it's "in flight" -- exactly the
 * reported scenario.
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

        // Simulates the editor's live content -- a plain mutable string
        // the getter always reads fresh, exactly like editorUI.getContent().
        let liveEditorContent = 'ORIGINAL';
        const getEditorContent = () => liveEditorContent;

        const fakeDb = {
            collection: () => ({
                doc: () => ({
                    set: async () => { await new Promise(r => setTimeout(r, 500)); }
                })
            })
        };
        window.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'stub' } } };
        const fakeUser = { uid: 'u1', email: 'u1@example.com' };

        const savePromise = bloc.saveProjectToCloud(fakeDb, fakeUser, getEditorContent);

        // The student resumes typing WHILE the save is still in flight.
        await new Promise(r => setTimeout(r, 100));
        liveEditorContent = 'ORIGINAL PLUS NEW TYPING';

        await savePromise;

        return {
            virtualFSAfterSave: bloc.state.virtualFS[currentFile],
            liveEditorContent,
        };
    });

    expect(result.virtualFSAfterSave).toBe('ORIGINAL PLUS NEW TYPING');
    expect(result.virtualFSAfterSave).toBe(result.liveEditorContent);
});
