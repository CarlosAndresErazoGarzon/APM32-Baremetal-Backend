/**
 * learn-account-scoping.test.js
 * Regression test for a real bug: LearnBloc used to keep its draft code
 * and pass/fail progress under a single unscoped localStorage key
 * (`apm32_learn_progress` / `apm32_learn_draft_...`), so two different
 * Google accounts signed into the same browser -- or a signed-in account
 * and a later guest -- would read and write the exact same keys and
 * silently inherit each other's in-progress edits and completions.
 * LearnBloc.setNamespace(uid|null), wired up in app.js on AUTH_LOGIN/
 * AUTH_LOGOUT, is the fix. Drives LearnBloc directly (dynamically
 * imported inside the page) rather than through the UI/real Firebase,
 * since this is really a storage-isolation unit test that happens to
 * need a real browser's storage + a real server to fetch learn-levels/
 * from.
 *
 * Guest keys live in sessionStorage, not localStorage (see
 * guestStorage.js's own comment -- a later, separate fix for a shared-
 * lab-computer bug: plain localStorage's guest bucket survived
 * indefinitely, so the NEXT person to open the browser without logging in
 * inherited whatever the PREVIOUS guest typed). Account keys (A/B) still
 * use localStorage, unaffected by that fix.
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

test('draft code and pass/fail progress stay isolated between guest and two different accounts on the same browser', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { LearnBloc } = await import('./js/blocs/LearnBloc.js');
        const bloc = new LearnBloc();
        await bloc.loadLevelsIndex();

        const unitId = bloc.state.currentUnitId;
        const exerciseId = bloc.state.currentExerciseId;
        const starterCode = bloc.state.code;
        const levelKey = `${unitId}/${exerciseId}`;

        const out = {};

        // 1. Guest edits and passes, unauthenticated.
        bloc.emit({ code: 'GUEST EDIT MARKER' });
        bloc.saveDraft();
        bloc.emit({ progress: { ...bloc.state.progress, [levelKey]: true } });
        sessionStorage.setItem('apm32_learn_progress', JSON.stringify(bloc.state.progress));
        out.guestDraftKeyRaw = sessionStorage.getItem('apm32_learn_draft_' + unitId + '_' + exerciseId);

        // 2. Signs in as account A -- no draft/progress of their own yet,
        // so both should reset to a clean slate, NOT the guest's.
        await bloc.setNamespace('uid-account-A');
        out.accountA_codeOnLogin = bloc.state.code;
        out.accountA_progressOnLogin = { ...bloc.state.progress };

        // Account A edits and passes.
        bloc.emit({ code: 'ACCOUNT A EDIT' });
        bloc.saveDraft();
        bloc.emit({ progress: { ...bloc.state.progress, [levelKey]: true } });
        localStorage.setItem('apm32_learn_progress_uid-account-A', JSON.stringify(bloc.state.progress));

        // Guest's own key must be untouched by any of A's activity.
        out.guestDraftKeyAfterA = sessionStorage.getItem('apm32_learn_draft_' + unitId + '_' + exerciseId);

        // 3. Signs out (back to guest) -- must see the guest's own edit
        // again, not account A's.
        await bloc.setNamespace(null);
        out.guestCodeAfterLogout = bloc.state.code;
        out.guestProgressAfterLogout = { ...bloc.state.progress };

        // 4. Signs in as a second, different account B on the same
        // browser -- must NOT see account A's edit or pass.
        await bloc.setNamespace('uid-account-B');
        out.accountB_codeOnLogin = bloc.state.code;
        out.accountB_progressOnLogin = { ...bloc.state.progress };

        // 5. Signs back in as account A -- their own edit must still be
        // there, untouched by B ever having been signed in.
        await bloc.setNamespace('uid-account-A');
        out.accountA_codeOnSecondLogin = bloc.state.code;
        out.accountA_progressOnSecondLogin = { ...bloc.state.progress };

        out.starterCode = starterCode;
        out.levelKey = levelKey;
        return out;
    });

    expect(result.guestDraftKeyRaw).toBe('GUEST EDIT MARKER');

    // Account A, first login: clean slate, not the guest's edit/progress.
    expect(result.accountA_codeOnLogin).toBe(result.starterCode);
    expect(result.accountA_progressOnLogin[result.levelKey]).toBeFalsy();

    // Guest's key survived account A's session untouched.
    expect(result.guestDraftKeyAfterA).toBe('GUEST EDIT MARKER');

    // Logging out restores the guest's own edit/progress, not A's.
    expect(result.guestCodeAfterLogout).toBe('GUEST EDIT MARKER');
    expect(result.guestProgressAfterLogout[result.levelKey]).toBeTruthy();

    // A second, different account never sees account A's edit or pass.
    expect(result.accountB_codeOnLogin).toBe(result.starterCode);
    expect(result.accountB_progressOnLogin[result.levelKey]).toBeFalsy();

    // Signing back in as account A still has A's own edit/progress intact.
    expect(result.accountA_codeOnSecondLogin).toBe('ACCOUNT A EDIT');
    expect(result.accountA_progressOnSecondLogin[result.levelKey]).toBeTruthy();
});
