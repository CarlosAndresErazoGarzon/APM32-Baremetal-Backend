/**
 * exec-cwd-persistence.test.js
 * Regression test for a real reported bug: `cd archivos/` in Playground's
 * terminal reported exit code 0 (looked like it worked) but had zero
 * effect on the next command -- each `/playground/exec` call runs in its
 * own fresh, disposable sandbox dir with no persistent shell, so a `cd`
 * inside one call's shell process vanishes the instant that process exits.
 *
 * Fixed by having runShellCommand() append its own `pwd` capture (behind
 * a marker line stripped back out of stdout) after the student's command,
 * so execCommand() can report back where the shell ended up (relative to
 * the project root) as `cwd` in its response. The client (ConsoleUI.js)
 * remembers that and sends it as the starting `cwd` on the NEXT command,
 * so a fresh sandbox starts wherever the previous one left off instead of
 * always back at the root.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execCommand } = require('../../learnRunner.js');

test('cd in one exec() call is reported back and honored by the next one', async () => {
    const files = {
        'archivos/estructuras.c': 'int main(void){return 0;}\n',
        'main.c': 'int main(void){return 0;}\n'
    };

    // 1) `cd` into a real subfolder.
    const r1 = await execCommand(files, 'cd archivos && pwd', '', null, '');
    assert.equal(r1.success, true);
    assert.equal(r1.code, 0);
    assert.equal(r1.cwd, 'archivos');

    // 2) A SEPARATE call (fresh sandbox, like a real second terminal
    //    command) starting from the cwd the first one reported back --
    //    `ls` here should see archivos/'s OWN contents, not the root's.
    const r2 = await execCommand(files, 'ls', '', null, r1.cwd);
    assert.equal(r2.success, true);
    assert.match(r2.stdout, /estructuras\.c/);
    assert.doesNotMatch(r2.stdout, /main\.c/);
    // Plain `ls` doesn't move anywhere -- still reports the same cwd.
    assert.equal(r2.cwd, 'archivos');

    // 3) `cd ..` from there goes back to the root.
    const r3 = await execCommand(files, 'cd .. && pwd', '', null, r2.cwd);
    assert.equal(r3.cwd, '');
});

test('a cwd pointing at a deleted/renamed folder falls back to the project root instead of failing', async () => {
    const files = { 'main.c': 'int main(void){return 0;}\n' };

    // Client claims it's sitting in "gone" (e.g. that folder was deleted
    // in the file manager since the last command) -- must not crash.
    const result = await execCommand(files, 'pwd', '', null, 'gone');
    assert.equal(result.success, true);
    assert.equal(result.cwd, '');
});

test('a cwd trying to escape the sandbox is rejected, not honored', async () => {
    const files = { 'main.c': 'int main(void){return 0;}\n' };

    const result = await execCommand(files, 'pwd', '', null, '../../etc');
    assert.equal(result.success, true);
    assert.equal(result.cwd, '');
});

test('the pwd marker never leaks into what the student sees', async () => {
    const files = { 'main.c': 'int main(void){return 0;}\n' };
    const result = await execCommand(files, 'echo hello', '', null, '');
    assert.equal(result.stdout.trim(), 'hello');
    assert.doesNotMatch(result.stdout, /APM32_CWD/);
});
