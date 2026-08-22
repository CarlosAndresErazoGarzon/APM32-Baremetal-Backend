/**
 * narrow-viewport-overflow.test.js
 * Regression test for a real reported bug ("cuando acoplo en iPad
 * desaparece el panel inferior" -- an iPad in Split View, whose narrower
 * side commonly renders around 320-375px wide). Root cause wasn't
 * anything panel-specific: the nav row's hamburger + title + IDE/LEARN/
 * PLAYGROUND button group never wrapped or shrank, so their combined
 * width (400px+) overflowed <nav> horizontally. body is overflow-hidden
 * with no scroll fallback, so everything past the right edge (which
 * included, depending on exact width, the terminal pane sitting below)
 * was just gone -- not literally removed, just unreachable. Fixed by
 * letting that row wrap (flex-wrap) instead of overflowing.
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

for (const width of [320, 375, 507]) {
    test(`no horizontal page overflow at ${width}px (iPad Split View width)`, async ({ page }) => {
        await page.setViewportSize({ width, height: 820 });
        await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        const overflow = await page.evaluate(() => document.body.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);

        // The actual symptom reported: the bottom terminal pane must be
        // reachable within the viewport, not pushed off past the overflow.
        await page.click('#playgroundModeBtn');
        await page.waitForTimeout(300);
        const paneBox = await page.locator('#terminalPane').boundingBox();
        expect(paneBox.x).toBeGreaterThanOrEqual(0);
        expect(paneBox.x + paneBox.width).toBeLessThanOrEqual(width + 1);
    });
}
