/**
 * main/updater.js — Auto-Updater Module
 * Uses electron-updater to check GitHub Releases for new versions.
 */

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(app.getAppPath(), '.env') });

let _mainWindow = null;

/**
 * Send a status event to the renderer process.
 */
function sendToRenderer(channel, data) {
    if (_mainWindow && !_mainWindow.isDestroyed()) {
        _mainWindow.webContents.send(channel, data);
    }
}

/**
 * Initialize the auto-updater.
 * Call this once the main BrowserWindow is ready.
 *
 * @param {Electron.BrowserWindow} mainWindow
 */
function initAutoUpdater(mainWindow) {
    _mainWindow = mainWindow;

    // Configure updater
    autoUpdater.autoDownload = false; // Don't download automatically — let user decide
    autoUpdater.autoInstallOnAppQuit = true; // Install update when user quits
    autoUpdater.allowPrerelease = false;

    // Authenticate auto-updater for private GitHub repo
    const ghToken = process.env.GH_TOKEN;
    if (ghToken) {
        autoUpdater.setFeedURL({
            provider: 'github',
            owner: 'CHEKAOUMII',
            repo: 'project6.2',
            token: ghToken,   // Crucial: authenticates the request to releases.atom
            private: true
        });
        console.log('[updater] GitHub provider configured with authentication token.');
    } else {
        console.warn('[updater] WARNING: No GH_TOKEN found. Auto-updates will fail with 404 for private repository.');
    }

    // Log updater events
    autoUpdater.logger = {
        info: (...args) => console.log('[updater]', ...args),
        warn: (...args) => console.warn('[updater]', ...args),
        error: (...args) => console.error('[updater]', ...args),
        debug: (...args) => console.log('[updater:debug]', ...args)
    };

    // ─── Event Handlers ───

    autoUpdater.on('checking-for-update', () => {
        console.log('[updater] Checking for updates...');
        sendToRenderer('updater:status', { status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
        console.log('[updater] Update available:', info.version);
        sendToRenderer('updater:status', {
            status: 'available',
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes || ''
        });
    });

    autoUpdater.on('update-not-available', (info) => {
        console.log('[updater] App is up to date:', info.version);
        sendToRenderer('updater:status', {
            status: 'up-to-date',
            version: info.version
        });
    });

    autoUpdater.on('download-progress', (progress) => {
        sendToRenderer('updater:status', {
            status: 'downloading',
            percent: Math.round(progress.percent),
            bytesPerSecond: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log('[updater] Update downloaded:', info.version);
        sendToRenderer('updater:status', {
            status: 'downloaded',
            version: info.version
        });
    });

    autoUpdater.on('error', (err) => {
        console.warn('[updater] Error:', err?.message || err);
        sendToRenderer('updater:status', {
            status: 'error',
            error: err?.message || 'Unknown update error'
        });
    });

    // Check for updates after a short delay (5 seconds)
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
            console.warn('[updater] Initial check failed:', err?.message || err);
        });
    }, 5000);

    console.log('[updater] Auto-updater initialized (v' + app.getVersion() + ')');
}

/**
 * Manually trigger an update check.
 */
async function checkForUpdates() {
    try {
        const result = await autoUpdater.checkForUpdates();
        return { success: true, version: result?.updateInfo?.version || null };
    } catch (err) {
        return { success: false, error: err?.message || 'Check failed' };
    }
}

/**
 * Start downloading the available update.
 */
async function downloadUpdate() {
    try {
        await autoUpdater.downloadUpdate();
        return { success: true };
    } catch (err) {
        return { success: false, error: err?.message || 'Download failed' };
    }
}

/**
 * Quit the app and install the downloaded update.
 */
function installUpdate() {
    autoUpdater.quitAndInstall(false, true);
}

module.exports = {
    initAutoUpdater,
    checkForUpdates,
    downloadUpdate,
    installUpdate
};
