/**
 * scratchServer.js
 * Boots the REAL Express app (backend/server.js, the exact same code path
 * `node server.js` uses) on an OS-assigned ephemeral port (`app.listen(0)`)
 * for tests. Never touches the user's own port 3000 -- there's no fixed
 * port to collide with, ever, even if several test files run in parallel.
 *
 * server.js only auto-listens when run directly (`require.main === module`)
 * and otherwise just exports the `app` -- see that file's own comment.
 */
const app = require('../../server.js');

function startScratchServer() {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', (err) => {
            if (err) return reject(err);
            const { port } = server.address();
            resolve({
                server,
                port,
                baseUrl: `http://127.0.0.1:${port}`,
                stop: () => new Promise((res) => server.close(() => res())),
            });
        });
    });
}

module.exports = { startScratchServer };
