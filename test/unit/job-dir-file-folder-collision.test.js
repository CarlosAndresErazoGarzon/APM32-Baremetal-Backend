/**
 * job-dir-file-folder-collision.test.js
 * Regression test for a real reported bug: running a terminal command in
 * Playground crashed with a raw, unhelpful
 *   "EEXIST: file already exists, mkdir '/tmp/playground_exec_.../fun_est'"
 * Root cause: virtualFS has no separate "this is a folder" marker --
 * folders in the file tree (SidebarUI.buildTree()) are purely derived from
 * '/'-prefixes of its keys -- so a plain file and a same-named folder
 * (e.g. a stray file literally called "fun_est" alongside
 * "fun_est/estructuras.c") could coexist client-side with nothing to stop
 * it. createJobDir() materializes that map into a real directory tree to
 * compile/run it, and mkdir legitimately can't turn an existing file into
 * a directory -- hence the crash.
 *
 * FileSystemBloc.js now guards createFile/renameFile/renameFolder against
 * creating this collision in the first place (see its
 * fileBlockingPath/folderExistsAt). This test covers the OTHER half: any
 * project that already has the collision (saved before that guard existed,
 * or a project this guard has a gap in) must get a clear, actionable
 * error from the backend instead of a raw Node fs exception -- and must
 * not leak its half-written job directory in /tmp when it fails.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execCommand } = require('../../learnRunner.js');

function playgroundExecDirs() {
    return fs.readdirSync('/tmp').filter(name => name.startsWith('playground_exec_'));
}

test('a file/folder name collision in virtualFS surfaces a clear error, not a raw EEXIST', async () => {
    const before = new Set(playgroundExecDirs());

    const files = {
        // The exact shape from the report: a plain file with no extension
        // sitting alongside a folder of the same name.
        'fun_est': '// stray file\n',
        'fun_est/estructuras.c': 'int main(void) { return 0; }\n'
    };

    await assert.rejects(
        () => execCommand(files, 'echo hi', '', null),
        (err) => {
            assert.ok(!/EEXIST/.test(err.message), `error should be friendly, not raw: ${err.message}`);
            assert.match(err.message, /file and a folder with the same name/);
            assert.match(err.message, /fun_est/);
            return true;
        }
    );

    // The failed job's directory must not linger in /tmp.
    const after = playgroundExecDirs().filter(name => !before.has(name));
    assert.deepEqual(after, [], `leaked job dir(s) after failure: ${after.join(', ')}`);
});

test('a normal (non-colliding) project still runs fine through the same path', async () => {
    const files = {
        'fun_est/estructuras.c': '#include <stdio.h>\nint main(void) { printf("ok\\n"); return 0; }\n'
    };
    const result = await execCommand(files, 'gcc fun_est/estructuras.c -o test && ./test', '', null);
    assert.equal(result.success, true);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /ok/);
});
