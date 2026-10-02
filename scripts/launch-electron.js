// Launches Electron with ELECTRON_RUN_AS_NODE removed from the environment.
//
// `cross-env ELECTRON_RUN_AS_NODE= electron .` does NOT work: it sets the
// variable to an empty string instead of deleting it, and Electron only checks
// whether the variable *exists* (regardless of value). An empty string still
// forces Electron into "run as Node" mode, so `app` ends up undefined.
//
// Deleting the key here guarantees Electron starts in its normal GUI mode, even
// if a parent process (e.g. an Electron-based IDE terminal) inherited the var.

const { spawn } = require('child_process');

delete process.env.ELECTRON_RUN_AS_NODE;

const electron = require('electron');
const args = ['.', ...process.argv.slice(2)];

const child = spawn(electron, args, {
    stdio: 'inherit',
    env: process.env
});

child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
    console.error('[launch-electron] failed to start Electron:', err);
    process.exit(1);
});
