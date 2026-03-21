const { BrowserWindow } = require('electron');

module.exports = {
    send(rendered, event) {
        const wins = BrowserWindow.getAllWindows();
        for (const win of wins) {
            if (win.isDestroyed()) continue;
            win.webContents.send('notification:center:update', {
                id: event.id,
                title: rendered.title,
                body: rendered.body,
                icon: rendered.icon,
                severity: event.severity,
                timestamp: event.timestamp,
                type: event.type,
                read: false
            });
        }
        return { success: true };
    }
};
