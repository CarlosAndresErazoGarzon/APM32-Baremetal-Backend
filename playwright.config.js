// @ts-check
const { defineConfig } = require('playwright/test');

module.exports = defineConfig({
    testDir: './test/e2e',
    timeout: 30000,
    fullyParallel: false, // each test boots its own scratch server on its own ephemeral port, but keeps things simple/deterministic to reason about in CI logs
    retries: 0,
    reporter: [['list']],
    use: {
        headless: true,
    },
});
