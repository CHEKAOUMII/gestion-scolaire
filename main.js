const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const { initDatabase } = require('./main/db/init');
const { getDb } = require('./main/db/context');
const { registerAllIpcHandlers } = require('./main/ipc/registerAll');
const { startOwnerSyncBackground } = require('./main/licensing/ownerSync');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'icon.ico'),
        title: 'برنامج التدبير المدرسي'
    });

    mainWindow.loadFile('index.html');

    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    initDatabase();
    registerAllIpcHandlers(ipcMain);
    startOwnerSyncBackground();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    try {
        const db = getDb();
        db.close();
    } catch (_) {
        // DB may already be closed
    }
});
