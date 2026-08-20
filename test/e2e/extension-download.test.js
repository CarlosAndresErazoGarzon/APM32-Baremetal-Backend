/**
 * extension-download.test.js
 * The [Extension] button in the sidebar footer (next to [Recovery]) links
 * straight to the real .vsix under frontend/downloads/ -- no JS handler,
 * just a static <a download> -- and server.js explicitly skips gzip/brotli
 * on it (it's already a zip container; recompressing wastes CPU for
 * negligible size gain, same class of fix as the /vendor/wasm-clang/
 * compression carve-out above it in server.js).
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

test('the [Extension] button links to a real, uncompressed .vsix', async ({ page }) => {
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });

    const btn = page.locator('#downloadExtensionBtn');
    await expect(btn).toBeVisible();
    const href = await btn.getAttribute('href');
    expect(href).toMatch(/\.vsix$/);

    const res = await page.request.get(`${scratch.baseUrl}/${href}`, {
        headers: { 'Accept-Encoding': 'gzip, deflate, br' }
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-encoding']).toBeUndefined();
    // A real VS Code extension package, not a placeholder -- .vsix is a
    // zip, so it must start with the zip local-file-header magic bytes.
    const body = await res.body();
    expect(body.length).toBeGreaterThan(1_000_000);
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
});
