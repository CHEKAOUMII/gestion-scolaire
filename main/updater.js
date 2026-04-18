/**
 * main/updater.js - Auto-Updater Module
 * Uses electron-updater to check GitHub Releases for new versions.
 */

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');
const path = require('path');
const { getUpdaterErrorMessage, isTransientUpdaterError } = require('./updater-errors');
require('dotenv').config({ path: path.join(app.getAppPath(), '.env') });

let _mainWindow = null;
let _initialized = false;
let _scheduledCheckTimer = null;
let _activeOperation = null;
let _backgroundRetryIndex = 0;

const INITIAL_UPDATE_CHECK_DELAY_MS = 5000;
const BACKGROUND_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];

function bindUpdaterWindow(mainWindow) {
    _mainWindow = mainWindow;
}

/**
 * Send a status event to the renderer process.
 */
function sendToRenderer(channel, data) {
    if (_mainWindow && !_mainWindow.isDestroyed()) {
        _mainWindow.webContents.send(channel, data);
    }
}

function scheduleBackgroundCheck(delayMs, reason = 'scheduled') {
    if (_scheduledCheckTimer) {
        clearTimeout(_scheduledCheckTimer);
    }

    _scheduledCheckTimer = setTimeout(() => {
        _scheduledCheckTimer = null;
        checkForUpdates({ silent: true, reason }).catch((err) => {
            console.warn('[updater] Scheduled check failed:', err?.message || err);
        });
    }, delayMs);
}

/**
 * Initialize the auto-updater.
 * Call this once the main BrowserWindow is ready.
 *
 * @param {Electron.BrowserWindow} mainWindow
 */
function initAutoUpdater(mainWindow) {
    bindUpdaterWindow(mainWindow);

    if (_initialized) {
        return;
    }

    _initialized = true;

    // Configure updater
    autoUpdater.autoDownload = false; // Don't download automatically - let user decide
    autoUpdater.autoInstallOnAppQuit = true; // Install update when user quits
    autoUpdater.allowPrerelease = false;

    // Authenticate auto-updater for private GitHub repo
    const ghToken = process.env.GH_TOKEN;
    if (ghToken) {
        autoUpdater.setFeedURL({
            provider: 'github',
            owner: 'CHEKAOUMII',
            repo: 'project6.2',
            token: ghToken, // Crucial: authenticates the request to releases.atom
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

    // --- Event Handlers ---

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
        const interactive = _activeOperation?.type === 'download' || _activeOperation?.silent === false;
        const transient = isTransientUpdaterError(err);
        const message = getUpdaterErrorMessage(err, { interactive });

        console.warn('[updater] Error:', message);

        if (_activeOperation?.type === 'download' || !transient || interactive) {
            sendToRenderer('updater:status', {
                status: 'error',
                error: message,
                transient
            });
        }
    });

    // Check for updates after a short delay (5 seconds)
    scheduleBackgroundCheck(INITIAL_UPDATE_CHECK_DELAY_MS, 'startup');

    console.log('[updater] Auto-updater initialized (v' + app.getVersion() + ')');
}

/**
 * Manually trigger an update check.
 */
async function checkForUpdates(options = {}) {
    const silent = options.silent === true;
    const reason = options.reason || (silent ? 'background' : 'manual');

    try {
        _activeOperation = { type: 'check', silent, reason };
        const result = await autoUpdater.checkForUpdates();
        if (_scheduledCheckTimer) {
            clearTimeout(_scheduledCheckTimer);
            _scheduledCheckTimer = null;
        }
        _backgroundRetryIndex = 0;
        return { success: true, version: result?.updateInfo?.version || null };
    } catch (err) {
        const transient = isTransientUpdaterError(err);
        const message = getUpdaterErrorMessage(err, { interactive: !silent });

        if (silent && transient && _backgroundRetryIndex < BACKGROUND_RETRY_DELAYS_MS.length) {
            const retryDelayMs = BACKGROUND_RETRY_DELAYS_MS[_backgroundRetryIndex];
            _backgroundRetryIndex += 1;
            console.warn(
                `[updater] ${reason} check hit a transient error. Retrying in ${Math.round(retryDelayMs / 1000)}s.`
            );
            scheduleBackgroundCheck(retryDelayMs, 'retry');
        }

        return { success: false, transient, error: message };
    } finally {
        _activeOperation = null;
    }
}

/**
 * Start downloading the available update.
 */
async function downloadUpdate() {
    try {
        _activeOperation = { type: 'download', silent: false, reason: 'download' };
        await autoUpdater.downloadUpdate();
        return { success: true };
    } catch (err) {
        return { success: false, error: getUpdaterErrorMessage(err, { interactive: true }) };
    } finally {
        _activeOperation = null;
    }
}

/**
 * Quit the app and install the downloaded update.
 */
function installUpdate() {
    autoUpdater.quitAndInstall(false, true);
}

module.exports = {
    bindUpdaterWindow,
    initAutoUpdater,
    checkForUpdates,
    downloadUpdate,
    installUpdate
};
