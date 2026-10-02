const { notify } = require('../notifications/dispatcher');
const store = require('../notifications/store');
const { handleAuthedRead } = require('./ipc-helpers');

// Device-local UI state (not synced school data) — session-required reads are
// the right tier; every handler below previously ran without any session check.
function registerNotificationsIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'notifications:send', (_ctx, rawEvent) => notify(rawEvent));

    handleAuthedRead(ipcMain, 'notifications:getRecent', (_ctx, limit) => store.getRecent(limit));

    handleAuthedRead(ipcMain, 'notifications:markRead', (_ctx, id) => {
        store.markRead(id);
        return { success: true };
    });

    handleAuthedRead(ipcMain, 'notifications:markAllRead', () => {
        store.markAllRead();
        return { success: true };
    });

    handleAuthedRead(ipcMain, 'notifications:unreadCount', () => store.unreadCount());

    handleAuthedRead(ipcMain, 'notifications:deleteOld', (_ctx, days) => {
        store.deleteOlderThan(days || 30);
        return { success: true };
    });
}

module.exports = { registerNotificationsIpc };
