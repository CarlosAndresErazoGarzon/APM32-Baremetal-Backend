/**
 * learn-grading.test.js
 * Drives Learn Mode's real "Ejecutar Pruebas" button through BOTH grading
 * paths LearnBloc.runTests() can take: the primary client-side WASM
 * compiler (wasm-clang, vendored -- see frontend/vendor/wasm-clang/) and
 * the server-side fallback (POST /learn/run via learnRunner.js), forced by
 * blocking the vendored compiler's own network requests so gradeLocally()
 * throws and runTests() catches into gradeOnServer(). Uses M46
 * (uso_gpio_salidas/ejercicio-02), this session's own new content, so a
 * green run here is direct proof the freshly-authored starter.c/tests.json
 * pair grades correctly end-to-end through the real UI on BOTH paths.
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

const SOLVED_M46 = `#include <stdio.h>
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

async function openM46(page) {
    await page.addInitScript((unlocked) => {
        localStorage.setItem('apm32_learn_progress', JSON.stringify(unlocked));
    }, { 'apuntadores/ejercicio-01': true, 'apuntadores/ejercicio-02': true, 'apuntadores/ejercicio-03': true });

    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.click('#learnModeBtn');
    await page.waitForTimeout(500);

    await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#levelListPane div')];
        const row = rows.find(r => r.textContent.includes('GPIO - Configuracion y Salidas'));
        if (row) row.click();
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#levelListPane div')];
        // Leaf rows only -- the accordion's own wrapper div also matches
        // this substring in its concatenated textContent but has no
        // onclick handler.
        const row = rows.find(r => r.children.length === 0 && r.textContent.includes('M46'));
        if (row) row.click();
    });
    await page.waitForTimeout(500);
}

async function setEditorValue(page, code) {
    await page.evaluate((c) => {
        const models = monaco.editor.getModels();
        if (models.length > 0) models[0].setValue(c);
    }, code);
    await page.waitForTimeout(200);
}

test('WASM path: M46 solved code passes via the local compiler', async ({ page }) => {
    await openM46(page);
    await setEditorValue(page, SOLVED_M46);

    await page.click('#runTestsBtn');
    await page.waitForFunction(
        () => document.getElementById('logBox')?.innerText.includes('exitosamente') ||
              document.getElementById('logBox')?.innerText.includes('fallaron'),
        { timeout: 15000 }
    );

    const log = await page.locator('#logBox').innerText();
    expect(log).toContain('Cargando compilador en el navegador');
    expect(log).toContain('exitosamente');
    expect(log).not.toContain('usando el servidor');
});

test('server fallback path: M46 solved code still passes when the local compiler is blocked', async ({ page }) => {
    // Forces gradeLocally() to throw (ensureReady() can't load the
    // vendored wasm-clang assets), so runTests() catches into
    // gradeOnServer() -- POST /learn/run, learnRunner.js's real gcc path.
    await page.route('**/vendor/wasm-clang/**', route => route.abort());

    await openM46(page);
    await setEditorValue(page, SOLVED_M46);

    await page.click('#runTestsBtn');
    await page.waitForFunction(
        () => document.getElementById('logBox')?.innerText.includes('exitosamente') ||
              document.getElementById('logBox')?.innerText.includes('fallaron'),
        { timeout: 15000 }
    );

    const log = await page.locator('#logBox').innerText();
    expect(log).toContain('usando el servidor');
    expect(log).toContain('exitosamente');
});
