/**
 * pty-session-cap.test.js
 * Regression coverage for a real incident: the deployed backend exceeded
 * its host's memory limit. A persistent pty session (see ptySession.js --
 * up to MAX_SESSION_MS each, not the old spawn-run-exit-in-seconds batch
 * model) costs memory for as long as it stays connected, so a classroom's
 * worth of concurrent Playground terminals could add up to multiples of
 * whatever the old model ever had live at once, even with nothing
 * individually wrong. ptySession.js's own per-session `ulimit -v` bounds
 * how much any ONE session can use; server.js's MAX_CONCURRENT_SESSIONS
 * is the other half -- a hard cap on how many sessions can be open AT
 * ALL, refused before anything is even spawned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startScratchServer } = require('../helpers/scratchServer');

function wsUrl(scratch) {
    return scratch.baseUrl.replace(/^http/, 'ws') + '/playground/pty';
}

function openAndWait(url) {
    return new Promise((resolve) => {
        const ws = new WebSocket(url);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'start', files: { 'main.c': 'int main(){return 0;}' }, cwd: '' })));
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw);
            if (msg.type === 'ready') resolve({ ws, outcome: 'ready' });
            else if (msg.type === 'error') resolve({ ws, outcome: 'error', message: msg.message });
        });
        ws.on('error', () => resolve({ ws, outcome: 'ws-error' }));
        setTimeout(() => resolve({ ws, outcome: 'timeout' }), 5000);
    });
}

test('a session beyond the concurrent cap is refused, and slots free up once one closes', async () => {
    const scratch = await startScratchServer();
    const url = wsUrl(scratch);
    const held = [];
    try {
        // Fill the cap exactly (15 -- see server.js's MAX_CONCURRENT_SESSIONS).
        for (let i = 0; i < 15; i++) {
            const r = await openAndWait(url);
            assert.equal(r.outcome, 'ready');
            held.push(r.ws);
        }

        // The 16th is refused -- nothing new was spawned for it.
        const over = await openAndWait(url);
        assert.equal(over.outcome, 'error');
        assert.match(over.message, /límite/);
        over.ws.close();

        // Freeing exactly one slot lets exactly one more through.
        held.shift().close();
        await new Promise(r => setTimeout(r, 300)); // let the server-side kill() actually run
        const afterFree = await openAndWait(url);
        assert.equal(afterFree.outcome, 'ready');
        held.push(afterFree.ws);
    } finally {
        held.forEach(ws => ws.close());
        await scratch.stop();
    }
});
