const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');
const path = require('path');

try {
    const dotenvPaths = [
        path.join(__dirname, '.env'),
        path.join(process.resourcesPath || __dirname, '.env'),
        path.join(path.dirname(process.execPath), '.env')
    ];
    let dotenvLoaded = false;
    for (const dotenvPath of dotenvPaths) {
        const result = require('dotenv').config({ path: dotenvPath });
        if (!result.error) {
            dotenvLoaded = true;
            break;
        }
    }
    if (!dotenvLoaded) {
        console.warn('[main] .env not found in any search path:', dotenvPaths);
    }
} catch (error) {
    console.warn('[main] dotenv config load skipped:', error?.message || error);
}

// Force dd/mm/yyyy date format in HTML date inputs
app.commandLine.appendSwitch('lang', 'fr');

const { initDatabase } = require('./main/db/init');
const { getDb } = require('./main/db/context');
const { registerAllIpcHandlers } = require('./main/ipc/registerAll');
const { startOwnerSyncBackground, initSyncListeners } = require('./main/licensing/ownerSync');
const {
    startSyncPushBackground,
    stopSyncPushBackground,
    startSyncPullBackground,
    stopSyncPullBackground
} = require('./main/sync/engine');
const { startSnapshotBackground, stopSnapshotBackground } = require('./main/sync/snapshot');
const { restoreFirebaseSession } = require('./main/sync/credentials');
const { bindUpdaterWindow, initAutoUpdater } = require('./main/updater');

let mainWindow = null;
let hasShownFatalStartupError = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

function parseUrl(targetUrl) {
    try {
        return new URL(targetUrl);
    } catch (_) {
        return null;
    }
}

function isAllowedLocalUrl(targetUrl) {
    const parsed = parseUrl(targetUrl);
    return parsed ? parsed.protocol === 'file:' : false;
}

function openExternallyIfSupported(targetUrl) {
    const parsed = parseUrl(targetUrl);
    if (!parsed) {
        return;
    }

    if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
        shell.openExternal(targetUrl).catch((error) => {
            console.warn('[main] Failed to open external URL:', error?.message || error);
        });
    }
}

function installWebContentsGuards(webContents) {
    webContents.on('will-navigate', (event, targetUrl) => {
        if (isAllowedLocalUrl(targetUrl)) {
            return;
        }

        event.preventDefault();
        openExternallyIfSupported(targetUrl);
    });

    webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedLocalUrl(url)) {
            return { action: 'allow' };
        }

        openExternallyIfSupported(url);
        return { action: 'deny' };
    });

    webContents.on('will-attach-webview', (event) => {
        event.preventDefault();
    });
}

function focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return createWindow();
    }

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();

    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.focus();
    }

    return mainWindow;
}

async function handleFatalStartupError(message, error) {
    const details = error?.stack || error?.message || String(error);
    console.error(`[main] ${message}`, error);

    if (!hasShownFatalStartupError) {
        hasShownFatalStartupError = true;
        dialog.showErrorBox('Startup failed', `${message}\n\n${details}`);
    }

    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.destroy();
        }
    } catch (_) {
        // Ignore cleanup failures after a fatal startup error.
    }

    app.exit(1);
}

process.on('uncaughtException', (error) => {
    console.error('[process] Uncaught exception:', error);

    // Persist synchronously BEFORE any side-effect (process.exit / fatal dialog) below.
    try {
        require('./main/diagnostics/error-log').logAppError({
            source: 'main',
            action: 'uncaughtException',
            message: error?.message || String(error),
            stack: error?.stack
        });
    } catch (_) {
        /* logging must never block crash handling */
    }

    if (app.isReady()) {
        void handleFatalStartupError('An unexpected error occurred.', error);
        return;
    }

    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('[process] Unhandled promise rejection:', reason);

    try {
        require('./main/diagnostics/error-log').logAppError({
            source: 'main',
            action: 'unhandledRejection',
            message: reason?.message || String(reason),
            stack: reason?.stack
        });
    } catch (_) {
        /* logging must never block */
    }
});

if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        focusMainWindow();
    });
}

function createWindow() {
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
    const window = new BrowserWindow({
        width: Math.round(Math.min(screenW * 0.85, 1920)),
        height: Math.round(Math.min(screenH * 0.85, 1200)),
        minWidth: 1000,
        minHeight: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'icon.ico'),
        title: 'برنامج التدبير المدرسي'
    });

    mainWindow = window;
    installWebContentsGuards(window.webContents);
    bindUpdaterWindow(window);

    window.on('closed', () => {
        if (mainWindow === window) {
            mainWindow = null;
        }
    });

    const setupDb = getDb();
    const instCols = new Set(setupDb.prepare('PRAGMA table_info(institution_config)').all().map((c) => c.name));
    const codeCol = instCols.has('code_etablissement') ? 'code_etablissement' : 'massar_code';
    const inst = setupDb.prepare(`SELECT setup_completed, ${codeCol} AS school_code FROM institution_config WHERE id = 1`).get();
    if (inst && inst.school_code) {
        setupDb
            .prepare(
                `UPDATE sync_config SET school_id = ?, enabled = 1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = 1 AND (school_id IS NULL OR school_id != ?)`
            )
            .run(inst.school_code, inst.school_code);
        setupDb
            .prepare(
                `UPDATE sync_config SET enabled = 1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = 1 AND COALESCE(trim(school_id), '') != ''`
            )
            .run();
        startSyncPushBackground();
        startSyncPullBackground();
        startSnapshotBackground();
    }
    // Auth-gated entry: login.html handles authentication then redirects to index.html
    const targetPage = !inst || !inst.setup_completed ? 'setup.html' : 'login.html';

    window.loadFile(targetPage).catch((error) => {
        console.error(`[main] Failed to load ${targetPage}:`, error);
    });

    // window.webContents.openDevTools();

    return window;
}

if (gotSingleInstanceLock) {
    app.whenReady().then(async () => {
        try {
            initDatabase();
            registerAllIpcHandlers(ipcMain);
            initSyncListeners();
            startOwnerSyncBackground();
            await restoreFirebaseSession().catch((err) => {
                console.warn('[main] Firebase session restoration failed:', err.message);
            });
            startSyncPushBackground();
            startSyncPullBackground();
            startSnapshotBackground();
            const window = createWindow();
            initAutoUpdater(window);
        } catch (error) {
            void handleFatalStartupError('Failed to initialize the application.', error);
        }

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            } else {
                focusMainWindow();
            }
        });
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    stopSyncPushBackground();
    stopSyncPullBackground();
    stopSnapshotBackground();
    try {
        const db = getDb();
        db.close();
    } catch (_) {
        // DB may already be closed
    }
});
