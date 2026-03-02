const { notify } = require('../notifications/dispatcher');
const store = require('../notifications/store');

function registerNotificationsIpc(ipcMain) {
    ipcMain.handle('notifications:send', (_event, rawEvent) => {
        return notify(rawEvent);
    });

    ipcMain.handle('notifications:getRecent', (_event, limit) => {
        return store.getRecent(limit);
    });

    ipcMain.handle('notifications:markRead', (_event, id) => {
        store.markRead(id);
        return { success: true };
    });

    ipcMain.handle('notifications:markAllRead', () => {
        store.markAllRead();
        return { success: true };
    });

    ipcMain.handle('notifications:unreadCount', () => {
        return store.unreadCount();
    });

    ipcMain.handle('notifications:deleteOld', (_event, days) => {
        store.deleteOlderThan(days || 30);
        return { success: true };
    });
}

module.exports = { registerNotificationsIpc };
