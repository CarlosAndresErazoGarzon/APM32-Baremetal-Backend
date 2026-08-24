/**
 * auth-session-persistence.test.js
 * Regression test for a real reported concern: this app runs on shared
 * lab computers, and Firebase Auth's own default persistence
 * (browserLocalPersistence) survives closing the browser entirely,
 * indefinitely, until an explicit logout -- so a student who forgot to
 * click LOGOUT would leave their account signed in (with full access to
 * their saved projects and Learn progress) for whoever opens the browser
 * next. AuthBloc.initFirebase() now calls
 * auth.setPersistence(firebase.auth.Auth.Persistence.SESSION) before
 * wiring up onAuthStateChanged, so the session clears once the tab/
 * window closes instead of lingering forever.
 *
 * Stubs the global `firebase` object entirely (and fetch, for the
 * /api/config call) rather than depending on a real Firebase project or
 * network access -- this is testing AuthBloc's own call sequence, not
 * Firebase itself.
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

test('initFirebase() sets SESSION persistence before registering onAuthStateChanged', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const calls = [];

        // Stub /api/config so initFirebase() doesn't need a real backend.
        const origFetch = window.fetch;
        window.fetch = async (url, ...args) => {
            if (typeof url === 'string' && url.endsWith('/api/config')) {
                return new Response(JSON.stringify({ apiKey: 'stub' }), { status: 200 });
            }
            return origFetch(url, ...args);
        };

        // Stub the global `firebase` compat SDK -- just enough surface
        // for AuthBloc.initFirebase() to run its real logic against.
        window.firebase = {
            initializeApp: () => {},
            auth: Object.assign(
                () => ({
                    setPersistence: async (mode) => { calls.push({ fn: 'setPersistence', mode }); },
                    onAuthStateChanged: (cb) => { calls.push({ fn: 'onAuthStateChanged' }); cb(null); },
                }),
                { Auth: { Persistence: { SESSION: 'SESSION_MARKER' } } }
            ),
            firestore: () => ({}),
        };

        const { AuthBloc } = await import('./js/blocs/AuthBloc.js');
        const bloc = new AuthBloc();
        await bloc.initFirebase('http://stub');

        return calls;
    });

    expect(result[0]).toEqual({ fn: 'setPersistence', mode: 'SESSION_MARKER' });
    expect(result[1]).toEqual({ fn: 'onAuthStateChanged' });
});
