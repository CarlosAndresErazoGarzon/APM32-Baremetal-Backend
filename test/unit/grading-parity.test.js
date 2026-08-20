/**
 * grading-parity.test.js
 * Guards against the exact mirroring-drift risk introduced when client-side
 * WASM grading started needing its OWN copy of tests.json: the frontend
 * (Monaco/WASM path) and the backend (server-fallback path) must always
 * agree on what counts as a pass, or a student could see a different
 * verdict depending on which path graded them. Every unit/exercise's
 * tests.json must exist in BOTH frontend/learn-levels/ and
 * backend/learn-levels/, and the two copies must be byte-identical.
 *
 * Also checks index.json's structural invariants for the 3-super-unit
 * layer added this session: every unit has a superUnit, and none of the
 * original 11 units' ids/exercise ids were renamed (that would silently
 * reset every existing user's saved progress, keyed "unitId/exerciseId").
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'learn-levels');
const BACK = path.join(__dirname, '..', '..', 'learn-levels');

// These 11 units/44 exercises existed BEFORE the super-unit reorganization
// -- their ids must never change, since progress is keyed "unitId/exerciseId"
// in both localStorage and Firestore and nothing ever migrates/renames it.
const ORIGINAL_UNIT_IDS = [
    'intro', 'operadores', 'control_flujo', 'bucles', 'arreglos', 'funciones',
    'estructuras', 'archivos', 'bitwise_avanzado', 'apuntadores', 'maquinas_estado',
];

function loadIndex() {
    return JSON.parse(fs.readFileSync(path.join(FRONT, 'index.json'), 'utf8'));
}

test('index.json is valid JSON and every unit declares a superUnit', () => {
    const units = loadIndex();
    assert.ok(Array.isArray(units) && units.length > 0);
    for (const unit of units) {
        assert.ok(unit.superUnit && unit.superUnit.id, `${unit.id} is missing superUnit`);
        assert.ok(['basicos_c', 'uso_placa', 'c_avanzado'].includes(unit.superUnit.id),
            `${unit.id} has an unrecognized superUnit.id: ${unit.superUnit.id}`);
    }
});

test('none of the 11 pre-existing units were renamed or removed', () => {
    const units = loadIndex();
    const ids = new Set(units.map(u => u.id));
    for (const id of ORIGINAL_UNIT_IDS) {
        assert.ok(ids.has(id), `original unit "${id}" is missing from index.json`);
    }
});

test('every unit/exercise in index.json has a tests.json in both frontend/ and backend/, byte-identical', () => {
    const units = loadIndex();
    const missing = [];
    const mismatched = [];
    let checked = 0;

    for (const unit of units) {
        for (const ex of unit.exercises) {
            checked++;
            const rel = path.join(unit.id, ex.id, 'tests.json');
            const frontPath = path.join(FRONT, rel);
            const backPath = path.join(BACK, rel);

            const frontExists = fs.existsSync(frontPath);
            const backExists = fs.existsSync(backPath);
            if (!frontExists || !backExists) {
                missing.push(`${unit.id}/${ex.id} (frontend:${frontExists} backend:${backExists})`);
                continue;
            }

            const frontContent = fs.readFileSync(frontPath);
            const backContent = fs.readFileSync(backPath);
            if (!frontContent.equals(backContent)) {
                mismatched.push(`${unit.id}/${ex.id}`);
                continue;
            }

            // Must also be valid, non-empty JSON test arrays.
            const parsed = JSON.parse(frontContent.toString('utf8'));
            assert.ok(Array.isArray(parsed) && parsed.length > 0, `${unit.id}/${ex.id} has an empty tests array`);
            for (const t of parsed) {
                assert.ok(typeof t.expectedStdout === 'string', `${unit.id}/${ex.id} test missing expectedStdout`);
            }
        }
    }

    assert.equal(missing.length, 0, `tests.json missing on one side for: ${missing.join(', ')}`);
    assert.equal(mismatched.length, 0, `tests.json differs frontend<->backend for: ${mismatched.join(', ')}`);
    assert.ok(checked >= 54, `expected at least 54 exercises total, found ${checked}`);
});

test('every exercise with a starterFile has that starter.c present in frontend/', () => {
    const units = loadIndex();
    for (const unit of units) {
        for (const ex of unit.exercises) {
            if (!ex.starterFile) continue;
            const starterPath = path.join(FRONT, unit.id, ex.starterFile);
            assert.ok(fs.existsSync(starterPath), `missing starter.c: ${unit.id}/${ex.starterFile}`);
        }
    }
});

test('every unit with a theoryFile has that theory.md present in frontend/', () => {
    const units = loadIndex();
    for (const unit of units) {
        if (!unit.theoryFile) continue;
        const theoryPath = path.join(FRONT, unit.id, unit.theoryFile);
        assert.ok(fs.existsSync(theoryPath), `missing theory.md: ${unit.id}/${unit.theoryFile}`);
    }
});
