/**
 * logout-clears-project-badge.test.js
 * Regression test for a real reported bug (screenshot): after logging
 * out, the LOGIN button correctly flipped back, but the sidebar's
 * "[ Project: ... ]" badge kept showing the previous account's email.
 * Root cause: FileSystemBloc.setNamespace()'s "found a local draft"
 * branch only ever emitted virtualFS/currentFile, never resetting
 * projectType/projectName/projectId -- so a stale 'cloud'/email pair
 * from before logout just sat there. Fixed by resetting those three
 * alongside the restored draft.
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

test('setNamespace(null) after a cloud session clears projectType/projectName even when a local draft exists', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();

        // A local draft already exists for the guest bucket (e.g. edited
        // before ever logging in) -- must survive the whole round trip.
        localStorage.setItem('apm32_local_fs_project_guest', JSON.stringify({
            virtualFS: { 'main.c': '// guest draft\n' },
            currentFile: 'main.c'
        }));

        // Login (namespace actually changes: null -> uid, same as the real
        // AUTH_LOGIN handler in app.js).
        bloc.setNamespace('test-uid');
        // Simulates saveProjectToCloud()'s own emit while signed in.
        bloc.emit({ projectType: 'cloud', projectName: 'someone@example.com', projectId: null });

        // Logout (uid -> null, the real reported scenario).
        bloc.setNamespace(null);

        return { projectType: bloc.state.projectType, projectName: bloc.state.projectName };
    });

    expect(result.projectType).toBe('scratchpad');
    expect(result.projectName).toBe('');
});
