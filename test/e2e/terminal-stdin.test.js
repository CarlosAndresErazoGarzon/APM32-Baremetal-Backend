/**
 * terminal-stdin.test.js
 * Regression test for a real reported gap: a program that reads from
 * stdin (scanf/getchar/gets) had no way to receive input in Playground's
 * manual terminal -- each command ran non-interactively with empty
 * stdin, so e.g. `while(getchar() != EOF)` saw immediate EOF and never
 * printed anything, exactly as in the user's screenshot. The backend
 * (execCommand -> runShellCommand -> child.stdin.write()) already
 * supported a stdin string end-to-end; ConsoleUI.js just always passed
 * ''. Fixed with a collapsed-by-default stdin textarea whose value now
 * gets sent with the next command.
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

test('text typed into the stdin box reaches the running program', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);

    // Same character-counting program as the reported screenshot.
    const CODE = '#include <stdio.h>\n\nint main(void) {\n' +
        '    long nc = 0;\n' +
        '    while (getchar() != EOF) {\n' +
        '        ++nc;\n' +
        '    }\n' +
        '    printf("%ld\\n", nc);\n' +
        '    return 0;\n' +
        '}\n';
    await page.evaluate((code) => { monaco.editor.getModels()[0].setValue(code); }, CODE);
    await page.waitForTimeout(200);

    await page.click('#consoleTabBtn');
    await page.click('#consoleStdinToggle');
    await page.fill('#consoleStdinInput', 'hello\nworld\n');

    await page.fill('#consoleCommandInput', 'gcc main.c -o test && ./test');
    await page.press('#consoleCommandInput', 'Enter');
    await page.waitForFunction(
        () => document.getElementById('consoleOutput')?.innerText.includes('exit code'),
        { timeout: 10000 }
    );

    const output = await page.locator('#consoleOutput').innerText();
    // "hello\nworld\n" is 12 bytes.
    expect(output).toContain('12');
});
