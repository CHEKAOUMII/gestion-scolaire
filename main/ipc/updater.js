/**
 * main/ipc/updater.js — IPC handlers for auto-updater
 *
 * Lazy-loads the updater module so that smoke tests (which run in plain Node.js)
 * can still import and validate this file without requiring Electron runtime.
 */

let _updater = null;
function getUpdater() {
    if (!_updater) _updater = require('../updater');
    return _updater;
}

function registerUpdaterIpc(ipcMain) {
    ipcMain.handle('updater:checkForUpdates', async () => {
        return await getUpdater().checkForUpdates({ silent: false, reason: 'manual' });
    });

    ipcMain.handle('updater:downloadUpdate', async () => {
        return await getUpdater().downloadUpdate();
    });

    ipcMain.handle('updater:installUpdate', () => {
        getUpdater().installUpdate();
        return { success: true };
    });
}

module.exports = { registerUpdaterIpc };
