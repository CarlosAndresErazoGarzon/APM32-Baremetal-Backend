/**
 * terminal-long-line-wrap.test.js
 * Regression test for a real reported bug: typing a line long enough to
 * wrap scrambled the terminal's text and made the cursor visibly jump
 * back mid-line instead of continuing onto the next row.
 *
 * Root cause: ptySession.js always spawned the pty at a hardcoded 80x24,
 * and only got resized later if the client's own xterm.js fired an
 * onResize event -- which it doesn't for a redundant resize() call
 * (xterm skips firing it when the newly-computed size already matches
 * what's internally set). The very FIRST real fit() runs in
 * ConsoleUI.js's initTerminal(), called from the constructor before
 * this.ws even exists -- so that resize had nowhere to send itself, and
 * every LATER fit() (CONSOLE_TAB_SHOWN, window resize...) recomputed the
 * exact same size and therefore never fired onResize again either. Net
 * effect: bash's readline wrapped long lines against the WRONG width
 * (its own hardcoded 80 columns) while xterm.js rendered at whatever the
 * container's actual width really was -- the two disagreeing about
 * where a line wraps is exactly what scrambled the redraw.
 *
 * Fixed by sending the real cols/rows together with the 'start' message
 * itself, so the pty spawns already correctly sized instead of hoping a
 * resize message arrives afterward.
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

test('a line long enough to wrap renders in order, not scrambled', async ({ page }) => {
    // Narrow viewport -- forces a wrap at a much smaller column count than
    // a full-size window would, so the test doesn't need an absurdly long
    // string to reliably trigger it.
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await page.waitForTimeout(1000);

    await page.click('#consoleXtermMount');
    const payload = 'A'.repeat(150) + 'B'.repeat(150);
    await page.keyboard.type(`echo ${payload}`, { delay: 5 });
    await page.keyboard.press('Enter');

    // The shell echoes the argument back on its own output line -- once
    // that appears (not scrambled, which the .replace(/\s+/g, '') below
    // guards against -- wrapped text is broken up by real newlines that
    // a correct terminal inserts at its own column boundaries) the whole
    // round trip through a genuine multi-row wrap is verified.
    await page.waitForFunction(
        (expected) => document.getElementById('consoleXtermMount').innerText.replace(/\s+/g, '').includes(expected),
        payload,
        { timeout: 10000 }
    );

    const text = await page.evaluate(() => document.getElementById('consoleXtermMount').innerText);
    expect(text.replace(/\s+/g, '')).toContain(`echo${payload}${payload}`);
});

test("the 'start' WS message carries the terminal's real cols/rows", async ({ page }) => {
    // Registered via page.on(), not page.waitForEvent() + a second
    // .on('framesent', ...) after awaiting it -- that races the 'start'
    // frame, which can go out before a listener attached only after the
    // websocket event resolves ever gets a chance to see it. page.on()
    // fires synchronously the instant the WebSocket object exists, so the
    // framesent listener below is live before ANY frame could be sent.
    let startPayload = null;
    page.on('websocket', (ws) => {
        if (!ws.url().includes('/playground/pty')) return;
        ws.on('framesent', (f) => {
            if (typeof f.payload !== 'string') return;
            const msg = JSON.parse(f.payload);
            if (msg.type === 'start') startPayload = msg;
        });
    });

    await page.goto(`${scratch.baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.click('#playgroundModeBtn');
    await expect.poll(() => startPayload !== null, { timeout: 10000 }).toBe(true);

    expect(typeof startPayload.cols).toBe('number');
    expect(typeof startPayload.rows).toBe('number');
    // Not the old hardcoded fallback -- a real measured size from xterm.js
    // fitting to the actual mounted container.
    expect(startPayload.cols).toBeGreaterThan(0);
    expect(startPayload.rows).toBeGreaterThan(0);
});
