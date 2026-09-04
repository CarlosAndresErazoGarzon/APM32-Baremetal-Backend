/**
 * hotkeys.test.js
 * HotkeysUI.js's global keydown listener (frontend/js/ui/HotkeysUI.js) --
 * bare single letters, no Ctrl/Cmd modifier (see that file's own header
 * comment for why), guarded against firing while focus is in an
 * input/textarea/contentEditable. Covers the main things that could
 * silently regress: mode-switch digits, a button whose owning UI class
 * reactively rewrites its own innerHTML (confirmed this session to wipe
 * out an appended-child badge -- the actual bug that shaped this file's
 * data-attribute + CSS ::after approach instead), the typing-context
 * guard itself, and the show/hide toggle.
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

test('digit keys switch modes', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    await page.keyboard.press('2');
    await expect(page.locator('#learnModeBtn')).toHaveClass(/active/);

    await page.keyboard.press('1');
    await expect(page.locator('#ideModeBtn')).toHaveClass(/active/);
});

test('a hotkey does nothing while typing in an input or the Monaco editor', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    await page.click('#editor');
    await page.waitForTimeout(200);
    const modeBefore = await page.evaluate(() => document.getElementById('learnModeBtn').classList.contains('active'));
    await page.keyboard.type('2'); // types a literal "2" into the code, must NOT switch to Learn mode
    await page.waitForTimeout(200);
    const modeAfter = await page.evaluate(() => document.getElementById('learnModeBtn').classList.contains('active'));
    expect(modeAfter).toBe(modeBefore);
});

test('the "?" toggle shows the key badges, and they survive a button reactively rewriting its own innerHTML', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.activeElement.blur());

    await page.keyboard.press('?');
    await expect(page.locator('body')).toHaveClass(/hotkeys-visible/);

    await page.click('#learnModeBtn');
    await page.waitForTimeout(300);

    const before = await page.locator('#runTestsBtn').evaluate(el => getComputedStyle(el, '::after').content);
    expect(before).toBe('"R"');

    // Runs it for real -- RunUI.js reassigns runTestsBtn.innerHTML while
    // grading and again once done, the exact thing that used to wipe out
    // an appended-child badge.
    await page.click('#runTestsBtn');
    await page.waitForFunction(
        () => !document.getElementById('runTestsBtn').disabled,
        { timeout: 15000 }
    );

    const after = await page.locator('#runTestsBtn').evaluate(el => getComputedStyle(el, '::after').content);
    expect(after).toBe('"R"');
});

test('Shift-modified hotkeys and their non-shifted sibling stay distinct', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.activeElement.blur());

    // 'r' with no modifier, in Learn mode, runs the tests -- not Shift+R
    // (reset). Use the same run-completes signal as above to confirm it
    // was actually 'r' (run) and not 'R' (reset) that fired.
    await page.click('#learnModeBtn');
    await page.waitForTimeout(300);
    await page.keyboard.press('r');
    await page.waitForFunction(
        () => document.getElementById('logBox')?.innerText.includes('Evaluando'),
        { timeout: 5000 }
    );
});

test('"i" focuses the editor, "j" focuses the terminal input, "Escape" exits either back out', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.activeElement.blur());

    await page.keyboard.press('i');
    await expect(page.locator('#editor textarea')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#editor textarea')).not.toBeFocused();

    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(800); // pty session connects lazily
    await page.evaluate(() => document.activeElement.blur());

    // The terminal's own hidden input (xterm.js listens on this textarea
    // for every keystroke -- see ConsoleUI.js/HotkeysUI.js's
    // focusableTerminalInput(), there's no separate command-input element
    // anymore).
    const termInput = page.locator('#consoleXtermMount .xterm-helper-textarea');
    await page.keyboard.press('j');
    await expect(termInput).toBeFocused();

    // A literal backslash typed once already inside must still work
    // normally (the exact thing a Windows path or shell escape needs) --
    // 'j' itself is the letter that was chosen specifically so it never
    // collides with a character someone would actually type here. Checked
    // via the terminal's own visible transcript (real pty echo), not a
    // plain <input>'s .value -- there isn't one anymore.
    await page.keyboard.type('a\\b');
    await page.waitForFunction(
        () => document.getElementById('consoleXtermMount').innerText.includes('a\\b'),
        { timeout: 5000 }
    );

    await page.keyboard.press('Escape');
    await expect(termInput).not.toBeFocused();

    // Hotkeys work normally again once focus is back out.
    await page.keyboard.press('2');
    await expect(page.locator('#learnModeBtn')).toHaveClass(/active/);
});

test('"o" / "Shift+O" cycle terminal tabs (letters, not the old "[ ]" -- dead-key/AltGr risk on some layouts)', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);
    await page.evaluate(() => document.activeElement.blur());

    await page.keyboard.press('o');
    await page.waitForTimeout(200);
    const forward = await page.evaluate(() => ['logsTabBtn', 'serialTabBtn', 'consoleTabBtn'].find(id => document.getElementById(id)?.classList.contains('active')));
    expect(forward).toBe('logsTabBtn');

    await page.keyboard.press('Shift+O');
    await page.waitForTimeout(200);
    const backward = await page.evaluate(() => ['logsTabBtn', 'serialTabBtn', 'consoleTabBtn'].find(id => document.getElementById(id)?.classList.contains('active')));
    expect(backward).toBe('consoleTabBtn');
});

test('"p" collapses/expands the terminal panel (letter, not the old dead-key backtick)', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.activeElement.blur());

    await page.keyboard.press('p');
    await expect(page.locator('#terminalPane')).toHaveClass(/h-8/);

    await page.keyboard.press('p');
    await expect(page.locator('#terminalPane')).not.toHaveClass(/h-8/);
});

