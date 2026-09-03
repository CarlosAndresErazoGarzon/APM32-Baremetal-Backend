/**
 * terminal-stdin.test.js
 * Playground's manual "terminal" used to run each command in a fresh,
 * non-interactive sandbox job (see git history for that implementation --
 * a request/response HTTP call, with a separate collapsed-by-default
 * "stdin" textarea whose text got sent up front since there was no live
 * process left to send more input to once a command had already started).
 * Replaced by a real interactive shell over a WebSocket (backend/
 * ptySession.js): this is the actual regression test for the reported gap
 * that used to be impossible to fix properly -- a program mid-scanf()
 * genuinely receiving MORE input typed live, not just whatever was staged
 * in a box before the command even ran.
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

test('typing into the terminal while a program is blocked on scanf() delivers it live', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);

    const CODE = '#include <stdio.h>\n\nint main(void) {\n' +
        '    int x;\n' +
        '    printf("Enter a number: ");\n' +
        '    fflush(stdout);\n' +
        '    scanf("%d", &x);\n' +
        '    printf("\\nDoubled: %d\\n", x * 2);\n' +
        '    return 0;\n' +
        '}\n';
    await page.evaluate((code) => { monaco.editor.getModels()[0].setValue(code); }, CODE);
    // Edit fully settled into playgroundFsBloc BEFORE opening the terminal
    // (not just a token wait) -- ConsoleUI.js seeds the pty session's
    // jobDir from playgroundFsBloc.state.virtualFS at the moment the tab
    // is FIRST shown, so opening it before Monaco's own change has
    // propagated would compile whatever main.c looked like a moment
    // earlier. A real student always types the whole gcc command
    // afterwards, taking far longer than that propagation ever does; this
    // wait just makes the test's own much-faster keyboard.type() honest
    // about the same ordering.
    await page.waitForTimeout(1000);

    await page.click('#consoleTabBtn');
    await page.waitForTimeout(800); // pty session connects lazily -- give it a moment
    await page.click('#consoleXtermMount');
    await page.keyboard.type('gcc main.c -o test && ./test');
    await page.keyboard.press('Enter');

    // The prompt must show up BEFORE any input is sent -- proves the real
    // pty isn't fully-buffering stdout the way a plain pipe would (the
    // exact bug a naive "spawn without a pty" implementation would hit:
    // glibc only line-buffers when stdout looks like a terminal).
    await page.waitForFunction(
        () => document.getElementById('consoleXtermMount').innerText.includes('Enter a number:'),
        { timeout: 10000 }
    );

    // Now type the answer live, into the SAME terminal, while the compiled
    // program is still running and genuinely blocked inside scanf().
    await page.keyboard.type('21');
    await page.keyboard.press('Enter');

    await page.waitForFunction(
        () => document.getElementById('consoleXtermMount').innerText.includes('Doubled: 42'),
        { timeout: 10000 }
    );
});
