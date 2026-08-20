/**
 * mobile-title-clickable.test.js
 * Regression test for two real bugs found this session in the same
 * feature: BrandingUI.js picks a random ASCII-art font for the header
 * title on every load (see that file's own header comment for why --
 * restored at the user's explicit request after a prior removal, then
 * expanded from 6 fonts to all 28 available). Some variants render
 * 130-1040+ characters wide.
 *   1. On a narrow (mobile) viewport, an unconstrained title pushed into /
 *      overlapped the IDE/LEARN/PLAYGROUND buttons enough to intercept
 *      their clicks entirely (confirmed: clicking playgroundModeBtn timed
 *      out with Playwright reporting projectTitle "intercepts pointer
 *      events").
 *   2. After expanding the font pool, the SAME failure mode reappeared at
 *      ordinary laptop widths (confirmed overflowing at 1024px, a real
 *      `lg:` breakpoint width, not just a mobile edge case) -- several of
 *      the newly-added fonts are 600-1040px wide.
 * Both fixed with a max-width + overflow-hidden cap on #projectTitle in
 * index.html, one tier per breakpoint (120px mobile, 420px lg+). Runs
 * several random loads for (1) since a narrow font wouldn't reproduce it,
 * and forces the single widest known font for (2) since relying on chance
 * to draw it from 28 options would make the test flaky.
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

test('the mode-switcher buttons stay clickable on a mobile viewport regardless of which random title font loads', async ({ browser }) => {
    // 6 full page loads in sequence is legitimately slow (measured
    // 2.5-6.5s each depending on machine load), and this test's own loop
    // was tight against Playwright's 30s default -- occasional real
    // timeouts under parallel-worker contention, not a product bug (no
    // console/page errors on any run, every click succeeded once given
    // enough time). Room to breathe instead of trimming the coverage.
    test.setTimeout(60_000);
    for (let i = 0; i < 6; i++) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(400);

        await page.click('#playgroundModeBtn', { timeout: 5000 });
        await expect(page.locator('#playgroundModeBtn')).toHaveClass(/active/);

        await page.click('#learnModeBtn', { timeout: 5000 });
        await expect(page.locator('#learnModeBtn')).toHaveClass(/active/);

        await page.close();
    }
});

test('the mode-switcher buttons stay clickable at ordinary laptop widths even with the widest known title font', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 300 } });
    // ticks2.txt is the widest font in the rotation (~1040px rendered) --
    // force it instead of relying on a 1-in-28 random draw.
    await page.addInitScript(() => {
        const origFetch = window.fetch;
        window.fetch = (url, ...args) => {
            if (typeof url === 'string' && url.startsWith('fonts/')) {
                return origFetch('fonts/ticks2.txt', ...args);
            }
            return origFetch(url, ...args);
        };
    });
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const nav = page.locator('nav');
    const overflow = await nav.evaluate(el => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.click('#playgroundModeBtn', { timeout: 5000 });
    await expect(page.locator('#playgroundModeBtn')).toHaveClass(/active/);
    await page.close();
});
