const { BrowserWindow } = require('electron');

module.exports = {
    send(rendered, event) {
        const wins = BrowserWindow.getAllWindows();
        for (const win of wins) {
            if (win.isDestroyed()) continue;
            if (event.targetPage) {
                const url = win.webContents.getURL();
                if (!url.includes(event.targetPage)) continue;
            }
            win.webContents.send('notification:toast', {
                message: rendered.message,
                type: event.severity,
                duration: rendered.duration || 3000
            });
        }
        return { success: true };
    }
};
