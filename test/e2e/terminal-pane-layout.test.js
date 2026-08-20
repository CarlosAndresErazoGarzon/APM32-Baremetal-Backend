/**
 * terminal-pane-layout.test.js
 * Regression test for a real bug found this session: collapsing the
 * terminal pane, then clicking the console tab (Playground's manual
 * terminal), used to visually misplace #terminalHeader -- caused by a bare
 * `.focus()` call on #consoleCommandInput triggering the browser's default
 * scroll-into-view on an element clipped by the collapsed pane's
 * overflow:hidden. Fixed with `{ preventScroll: true }` plus a
 * collapsed-state guard in both TerminalUI.js and ConsoleUI.js. This test
 * reproduces the exact repro steps and asserts #terminalHeader's position
 * doesn't move when the pane is collapsed.
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

test('collapsing the terminal pane then switching to the console tab does not move #terminalHeader', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Playground mode is the only one where #consoleTabBtn is visible.
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);

    // Collapse the terminal pane (h-64 -> h-8, overflow-hidden). The class
    // swap is immediate but the actual height change animates via CSS
    // transition -- wait for it to actually finish (pane height settled at
    // 32px) before taking the "before" measurement, or the settling
    // animation itself looks like a false-positive shift.
    await page.click('#toggleTerminalBtn');
    await expect(page.locator('#terminalPane')).toHaveClass(/h-8/);
    await page.waitForFunction(() => {
        const el = document.getElementById('terminalPane');
        return el && Math.round(el.getBoundingClientRect().height) === 32;
    });

    const before = await page.locator('#terminalHeader').boundingBox();

    // The exact repro: click the console tab while the pane is still collapsed.
    await page.click('#consoleTabBtn');
    await page.waitForTimeout(300);

    const after = await page.locator('#terminalHeader').boundingBox();

    // The bug this guards against: a bare .focus() on #consoleCommandInput
    // triggered the browser's default scroll-into-view and visibly shifted
    // #terminalHeader (confirmed in the original repro: top went from
    // matching the pane's top to a value ~57px off). Any real shift should
    // be a fraction of that; a few px of subpixel layout noise is fine.
    expect(Math.abs(after.y - before.y)).toBeLessThan(5);
});

test('the tab switcher menu stays visible after collapse + tab switch', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(500);

    await page.click('#toggleTerminalBtn');
    await page.waitForTimeout(200);
    await page.click('#consoleTabBtn');
    await page.waitForTimeout(300);

    // The original user-reported symptom: the tab buttons themselves
    // became unreachable/invisible after this sequence.
    await expect(page.locator('#logsTabBtn')).toBeVisible();
    await expect(page.locator('#consoleTabBtn')).toBeVisible();
    await expect(page.locator('#toggleTerminalBtn')).toBeVisible();
});
