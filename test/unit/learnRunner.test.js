/**
 * Unit tests for backend/learnRunner.js -- exercises the compile+run+grade
 * pipeline directly (no HTTP, no browser). Uses `node:test`, native to
 * Node 22 (see package.json's "engines"), so this needs zero extra
 * dependency for the unit layer -- only the e2e layer pulls in Playwright.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { runLevel, runArbitrary } = require('../../learnRunner.js');

// M46 (uso_gpio_salidas/ejercicio-02) -- a real, currently-shipping level.
// Picked over intro/ejercicio-01 specifically because it's this session's
// own new content: a green result here is direct proof the freshly-authored
// tests.json/starter.c pair actually grades correctly through the real
// server-side runner, not just through the WASM path already checked live.
const LEVEL_ID = 'uso_gpio_salidas/ejercicio-02';

const SOLVED_CODE = `#include <stdio.h>
#include <stdint.h>

typedef struct {
    uint32_t CFGLOW, CFGHIG, IDATA, ODATA;
} GPIO_TypeDef;

#define LED_PIN 2

void led_on(GPIO_TypeDef *gpio) {
    gpio->ODATA |= (1 << LED_PIN);
}

void led_off(GPIO_TypeDef *gpio) {
    gpio->ODATA &= ~(1 << LED_PIN);
}

int main(void) {
    GPIO_TypeDef puerto = {0, 0, 0, 0};
    GPIO_TypeDef *GPIOB = &puerto;

    led_on(GPIOB);
    printf("ODATA tras encender: 0x%08X\\n", GPIOB->ODATA);

    led_off(GPIOB);
    printf("ODATA tras apagar:   0x%08X\\n", GPIOB->ODATA);

    return 0;
}
`;

// Compiles fine but both functions are no-ops -- ODATA never changes, so
// the printed values won't match expectedStdout. Grading should report a
// clean FAIL, never a thrown error or a crash.
const UNSOLVED_CODE = `#include <stdio.h>
#include <stdint.h>

typedef struct {
    uint32_t CFGLOW, CFGHIG, IDATA, ODATA;
} GPIO_TypeDef;

#define LED_PIN 2

void led_on(GPIO_TypeDef *gpio) {  }
void led_off(GPIO_TypeDef *gpio) {  }

int main(void) {
    GPIO_TypeDef puerto = {0, 0, 0, 0};
    GPIO_TypeDef *GPIOB = &puerto;

    led_on(GPIOB);
    printf("ODATA tras encender: 0x%08X\\n", GPIOB->ODATA);

    led_off(GPIOB);
    printf("ODATA tras apagar:   0x%08X\\n", GPIOB->ODATA);

    return 0;
}
`;

const BROKEN_CODE = `#include <stdio.h>
int main(void) {
    this does not compile
    return 0;
}
`;

test('runLevel: correct solution passes all tests', async () => {
    const result = await runLevel(LEVEL_ID, SOLVED_CODE);
    assert.equal(result.success, true);
    assert.equal(result.stage, 'tests');
    assert.equal(result.allPassed, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].passed, true);
});

test('runLevel: unsolved starter compiles but fails grading cleanly', async () => {
    const result = await runLevel(LEVEL_ID, UNSOLVED_CODE);
    assert.equal(result.success, true);
    assert.equal(result.stage, 'tests');
    assert.equal(result.allPassed, false);
    assert.equal(result.results[0].passed, false);
    // The mismatch is legible, not a crash -- both strings are present.
    assert.ok(typeof result.results[0].actualStdout === 'string');
    assert.ok(typeof result.results[0].expectedStdout === 'string');
});

test('runLevel: a compile error is reported, not thrown', async () => {
    const result = await runLevel(LEVEL_ID, BROKEN_CODE);
    assert.equal(result.success, false);
    assert.equal(result.stage, 'compile');
    assert.ok(result.stderr.length > 0);
});

test('runLevel: unknown levelId rejects with a clear error', async () => {
    await assert.rejects(
        () => runLevel('not_a_real_unit/not_a_real_exercise', SOLVED_CODE),
        /Unknown level/
    );
});

test('runArbitrary: compiles and runs a multi-file Playground-style project', async () => {
    const files = {
        'main.c': '#include <stdio.h>\n#include "helper.h"\nint main(void) { printf("sum=%d\\n", add(2, 3)); return 0; }\n',
        'helper.h': 'int add(int a, int b);\n',
        'helper.c': 'int add(int a, int b) { return a + b; }\n',
    };
    // runArbitrary compiles every .c file it finds -- main.c and helper.c
    // together, exactly like Playground's RUN button would.
    const combined = {
        'main.c': files['main.c'],
        'helper.h': files['helper.h'],
        'helper.c': files['helper.c'],
    };
    const result = await runArbitrary(combined, '');
    assert.equal(result.success, true);
    assert.equal(result.stage, 'run');
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'sum=5\n');
});

test('runArbitrary: rejects empty files object', async () => {
    await assert.rejects(() => runArbitrary({}, ''), /files is required/);
});
