/**
 * starter-integrity.test.js
 * Compiles and runs EVERY exercise's starter.c exactly as shipped (the
 * untouched, unsolved state a student first sees), with the same gcc flags
 * learnRunner.js's runLevel() uses. Catches a real bug found this session:
 * 8 of 54 starters called a function/type that was never declared anywhere
 * in the file (just a bare "// TODO: implement X" comment, no stub) --
 * those exercises failed to compile before a student ever touched the
 * editor, which is a much worse first-touch experience than the
 * established, working pattern (see maquinas_estado/ejercicio-01's TT
 * table): leave a compiling placeholder/no-op stub so the untouched
 * starter runs and fails its tests cleanly instead of erroring out.
 *
 * This does NOT require a "known-correct solution" for all 54 exercises
 * (we only have those for the 10 authored this session) -- it only
 * asserts the WEAKER, still valuable property that every starter.c is
 * itself valid, compilable C that runs to completion without crashing or
 * hanging, for every test case's stdin.
 *
 * One intentional, documented exception: estructuras/ejercicio-01 (M25)
 * asks the student to define a struct TYPE from scratch (not just fill in
 * a function body around an already-known signature) -- main() references
 * the type's field names directly, so there is no safe compiling stub that
 * doesn't either give away the exact field names/types (solving the
 * exercise) or risk undefined behavior (passing mismatched types through
 * printf's varargs). A compile error on this one untouched starter is the
 * correct, expected state -- verified separately (via a live WASM-path
 * browser run) to be handled gracefully by the UI (a clear "Error de
 * compilación" message, never a crash).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const os = require('os');

const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'learn-levels');

// See this file's own header comment -- defining a struct type from
// scratch has no safe compiling placeholder.
const KNOWN_COMPILE_ERROR_STARTERS = new Set([
    'estructuras/ejercicio-01',
]);

function loadIndex() {
    return JSON.parse(fs.readFileSync(path.join(FRONT, 'index.json'), 'utf8'));
}

const units = loadIndex();
const allExercises = [];
for (const unit of units) {
    for (const ex of unit.exercises) {
        allExercises.push({ unitId: unit.id, exId: ex.id, title: ex.title, starterFile: ex.starterFile || `${ex.id}/starter.c` });
    }
}

test(`every exercise (${allExercises.length} total) has a starter.c and tests.json`, () => {
    assert.ok(allExercises.length >= 54, `expected at least 54 exercises, found ${allExercises.length}`);
    for (const ex of allExercises) {
        const starterPath = path.join(FRONT, ex.unitId, ex.starterFile);
        const testsPath = path.join(FRONT, ex.unitId, ex.exId, 'tests.json');
        assert.ok(fs.existsSync(starterPath), `missing starter.c: ${ex.unitId}/${ex.exId}`);
        assert.ok(fs.existsSync(testsPath), `missing tests.json: ${ex.unitId}/${ex.exId}`);
    }
});

for (const ex of allExercises) {
    const key = `${ex.unitId}/${ex.exId}`;
    const testName = KNOWN_COMPILE_ERROR_STARTERS.has(key)
        ? `${key} (${ex.title}): starter.c is a documented compile-error-until-solved exercise`
        : `${key} (${ex.title}): starter.c compiles and runs without crashing/timing out`;

    test(testName, () => {
        const starterPath = path.join(FRONT, ex.unitId, ex.starterFile);
        const testsPath = path.join(FRONT, ex.unitId, ex.exId, 'tests.json');
        const code = fs.readFileSync(starterPath, 'utf8');
        const tests = JSON.parse(fs.readFileSync(testsPath, 'utf8'));

        const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter_integrity_'));
        try {
            fs.writeFileSync(path.join(jobDir, 'main.c'), code);
            const compile = spawnSync('gcc', ['-O0', '-Wall', '-std=c11', 'main.c', '-o', 'a.out'], { cwd: jobDir, encoding: 'utf8', timeout: 5000 });

            if (KNOWN_COMPILE_ERROR_STARTERS.has(key)) {
                assert.notEqual(compile.status, 0, `${key} was expected to fail compiling (documented exception) but it compiled -- update KNOWN_COMPILE_ERROR_STARTERS or check if this exercise was fixed`);
                return;
            }

            assert.equal(compile.status, 0, `${key} starter.c failed to compile:\n${compile.stderr}`);

            for (let i = 0; i < tests.length; i++) {
                const run = spawnSync(path.join(jobDir, 'a.out'), [], {
                    cwd: jobDir,
                    input: tests[i].stdin || '',
                    encoding: 'utf8',
                    timeout: 3000,
                });
                assert.equal(run.signal, null, `${key} test[${i}]: starter crashed with signal ${run.signal} (segfault/abort)`);
                assert.ok(!(run.error && run.error.code === 'ETIMEDOUT'), `${key} test[${i}]: starter timed out (possible infinite loop)`);
            }
        } finally {
            fs.rmSync(jobDir, { recursive: true, force: true });
        }
    });
}
