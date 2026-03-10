const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// Force dd/mm/yyyy date format in HTML date inputs
app.commandLine.appendSwitch('lang', 'fr');

const { initDatabase } = require('./main/db/init');
const { getDb } = require('./main/db/context');
const { registerAllIpcHandlers } = require('./main/ipc/registerAll');
const { startOwnerSyncBackground } = require('./main/licensing/ownerSync');
const { initAutoUpdater } = require('./main/updater');

function createWindow() {
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
    const mainWindow = new BrowserWindow({
        width: Math.round(Math.min(screenW * 0.85, 1920)),
        height: Math.round(Math.min(screenH * 0.85, 1200)),
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

    return mainWindow;
}

app.whenReady().then(() => {
    initDatabase();
    registerAllIpcHandlers(ipcMain);
    startOwnerSyncBackground();
    const mainWindow = createWindow();
    initAutoUpdater(mainWindow);

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
