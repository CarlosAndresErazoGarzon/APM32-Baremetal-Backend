/**
 * terminal-compile-race.test.js
 * Regression test for a real reported bug (relayed second-hand: "a veces
 * no compila bien" / "la creación de archivos [falla]") -- compiling or
 * running a command in Playground's live terminal IMMEDIATELY after
 * editing/creating a file (a completely normal workflow: type, then hit
 * Enter to compile) could see STALE content, or "No such file" for a file
 * just created.
 *
 * Root cause: ConsoleUI.js only pushed editor changes into the terminal
 * session's jobDir on a 500ms debounce (FILE_SYNC_DEBOUNCE_MS). Pressing
 * Enter to run a command sends that keystroke straight through
 * immediately, with no relation to the debounce timer -- so a command
 * typed within that window reached bash (and therefore `gcc`/`grep`/
 * whatever) BEFORE the file's latest content (or existence, for a
 * brand-new file) had actually been written to the sandbox.
 *
 * Fixed by flushing any pending sync synchronously the moment Enter is
 * detected in the typed input, BEFORE forwarding that keystroke -- since
 * WebSocket preserves per-connection message order, the file write is
 * now guaranteed to land server-side before the keystroke that triggers
 * the command, not just "usually fast enough". See ConsoleUI.js's
 * term.onData/flushSync() for the fix itself.
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

test('compiling immediately after editing sees the LATEST content, not a stale sync', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);
    await page.click('#consoleTabBtn');
    await page.waitForTimeout(800);

    // Edit main.c, then IMMEDIATELY (zero wait) run a command referencing
    // the just-typed line -- the exact real-world "type, then hit Enter
    // to compile" sequence that raced the debounce.
    const lines = page.locator('#editor .view-line');
    const lineCount = await lines.count();
    await lines.nth(lineCount - 1).click();
    await page.keyboard.press('End');
    await page.keyboard.insertText('\n// RACE_MARKER_LINE');

    // `greprc=$?` appears in the command; `greprc=<digit>` only in the
    // OUTPUT -- so neither the wait nor the assert can be satisfied by
    // the pty just echoing the command line back. rc 0 = grep matched
    // the just-typed line (jobDir has the latest content); rc 1 = it
    // ran against a stale main.c missing that line; rc 2 = no file.
    await page.click('#consoleXtermMount');
    await page.keyboard.insertText('grep RACE_MARKER_LINE main.c > /dev/null 2>&1; echo "greprc=$?"');
    await page.keyboard.press('Enter');

    await page.waitForFunction(
        () => /greprc=\d/.test(document.getElementById('consoleXtermMount').innerText),
        { timeout: 5000 }
    );
    const text = await page.evaluate(() => document.getElementById('consoleXtermMount').innerText);
    expect(text).toContain('greprc=0');
});

test('a file created and used in the same breath is found, not "No such file"', async ({ page }) => {
    page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'fresh.c' : undefined));

    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);
    await page.click('#consoleTabBtn');
    await page.waitForTimeout(800);

    // Brand-new file: this session's jobDir has NEVER seen it before at
    // all (not even a stale copy) -- the worst case of the race.
    await page.click('#playgroundNewFileBtn');
    await page.waitForTimeout(200);

    await page.click('#consoleXtermMount');
    await page.keyboard.insertText('ls fresh.c');
    await page.keyboard.press('Enter');

    await page.waitForFunction(
        () => {
            const t = document.getElementById('consoleXtermMount').innerText;
            return t.includes('fresh.c') || t.includes('No such file');
        },
        { timeout: 5000 }
    );
    const text = await page.evaluate(() => document.getElementById('consoleXtermMount').innerText);
    expect(text).not.toContain('No such file');
});
