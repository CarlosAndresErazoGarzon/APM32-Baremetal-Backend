/**
 * header-file-companion.test.js
 * Regression coverage for a real user request: creating a new .h file
 * should seed it with what a header actually carries (an include guard),
 * not the same generic "// New file: x.h" placeholder every plain file
 * gets -- and, since a header is rarely useful on its own, auto-create the
 * matching .c alongside it (same folder, same base name) if one doesn't
 * already exist. See FileSystemBloc.js's createFile()/headerGuardName().
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

test('creating a .h file seeds an include guard and auto-creates the matching .c', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();
        bloc.emit({ virtualFS: {}, currentFile: null });

        bloc.createFile('motor_driver.h');

        return {
            headerContent: bloc.state.virtualFS['motor_driver.h'],
            companionContent: bloc.state.virtualFS['motor_driver.c'],
            currentFile: bloc.state.currentFile,
        };
    });

    expect(result.headerContent).toBe('#ifndef MOTOR_DRIVER_H\n#define MOTOR_DRIVER_H\n\n\n\n#endif // MOTOR_DRIVER_H\n');
    expect(result.companionContent).toBe('#include "motor_driver.h"\n');
    // The .h itself is what the student explicitly asked to create --
    // that's what should end up open, not the auto-generated companion.
    expect(result.currentFile).toBe('motor_driver.h');
});

test('the guard name is a valid C identifier even for tricky filenames', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();
        bloc.emit({ virtualFS: {}, currentFile: null });

        return {
            // Non-alphanumeric characters collapse to underscores.
            dashed: bloc.headerGuardName('my-cool-driver.h'),
            // A name that would otherwise start with a digit needs a
            // leading underscore -- "3D_MATH_H" alone isn't a legal
            // identifier for #define/#ifndef.
            leadingDigit: bloc.headerGuardName('3d_math.h'),
            // Only the basename matters -- a header nested under inc/
            // doesn't need its own path baked into the guard.
            nested: bloc.headerGuardName('inc/gpio.h'),
        };
    });

    expect(result.dashed).toBe('MY_COOL_DRIVER_H');
    expect(result.leadingDigit).toBe('_3D_MATH_H');
    expect(result.nested).toBe('GPIO_H');
});

test('creating a .h next to an ALREADY-EXISTING .c does not overwrite it', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();
        const existingC = 'int main(void) { return 42; }\n';
        bloc.emit({ virtualFS: { 'utils.c': existingC }, currentFile: 'utils.c' });

        bloc.createFile('utils.h');

        return {
            headerContent: bloc.state.virtualFS['utils.h'],
            cContentUnchanged: bloc.state.virtualFS['utils.c'] === existingC,
        };
    });

    expect(result.headerContent).toContain('#ifndef UTILS_H');
    expect(result.cContentUnchanged).toBe(true);
});

test('a header inside a subfolder gets its companion .c in the SAME subfolder', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();
        bloc.emit({ virtualFS: {}, currentFile: null });

        bloc.createFile('drivers/uart.h');

        return {
            hasHeader: bloc.state.virtualFS['drivers/uart.h'] !== undefined,
            companionContent: bloc.state.virtualFS['drivers/uart.c'],
        };
    });

    expect(result.hasHeader).toBe(true);
    // The #include is just the bare filename (both files sit in the same
    // folder), not the full "drivers/uart.h" path.
    expect(result.companionContent).toBe('#include "uart.h"\n');
});

test('creating a plain .c file is unaffected -- still the generic placeholder', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
        const { FileSystemBloc } = await import('./js/blocs/FileSystemBloc.js');
        const bloc = new FileSystemBloc();
        bloc.emit({ virtualFS: {}, currentFile: null });

        bloc.createFile('helpers.c');

        return {
            content: bloc.state.virtualFS['helpers.c'],
            fileCount: Object.keys(bloc.state.virtualFS).length,
        };
    });

    expect(result.content).toBe('// New file: helpers.c\n');
    // No surprise companion file for a plain .c.
    expect(result.fileCount).toBe(1);
});
