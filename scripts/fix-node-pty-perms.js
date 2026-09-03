/**
 * fix-node-pty-perms.js
 * Defensive postinstall step: on this dev machine, `npm install` extracted
 * node-pty's prebuilt macOS binaries (spawn-helper and pty.node, under
 * node_modules/node-pty/prebuilds/) WITHOUT the executable bit (644, not
 * 755) -- some npm/tar
 * combinations don't preserve the tarball's original permission bits on
 * extraction. Without +x, spawning any pty fails at the OS level
 * ("posix_spawnp failed"), not with a clear "permission denied" -- easy to
 * mistake for a real spawn/argv problem instead of a packaging artifact.
 * Cheap and harmless to always run: a no-op if the files are already
 * executable (e.g. the Linux build, which compiles from source instead of
 * using a prebuild, and whose build output already has the right bits).
 */
const fs = require('fs');
const path = require('path');

const prebuildsDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');

function chmodExecutableRecursive(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            chmodExecutableRecursive(full);
        } else if (entry.name === 'spawn-helper' || entry.name.endsWith('.node')) {
            try {
                fs.chmodSync(full, 0o755);
            } catch {
                // Not fatal -- node-pty just won't work on whatever platform
                // this was for, same as if this script didn't exist at all.
            }
        }
    }
}

chmodExecutableRecursive(prebuildsDir);
