const { app } = require('electron');
const { authErrorResponse } = require('./ipc-helpers');
const { requireRole } = require('./auth');
const {
    activateLicense,
    adminRevokeDevice,
    deactivateCurrentDevice,
    getActivationRequest,
    getLicenseStatus,
    getPublicActivationStatus,
    getPlanLimits,
    listLicenseDevices,
    refreshLicenseValidation
} = require('../licensing/service');
const { getTrialStatus, setTrialDuration } = require('../licensing/trialService');

const _activationAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

function registerLicensingIpc(ipcMain) {
    ipcMain.handle('app:quit', () => {
        app.quit();
    });

    ipcMain.handle('licensing:getActivationRequest', async () => {
        try {
            return getActivationRequest();
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('licensing:getPublicStatus', async () => {
        try {
            return getPublicActivationStatus();
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('licensing:getTrialStatus', async () => {
        try {
            return { success: true, ...getTrialStatus() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('licensing:activatePublic', async (_event, payload) => {
        const senderId = _event.sender.id;
        const now = Date.now();
        const entry = _activationAttempts.get(senderId) || { count: 0, resetAt: now + WINDOW_MS };

        if (now > entry.resetAt) {
            entry.count = 0;
            entry.resetAt = now + WINDOW_MS;
        }

        if (entry.count >= MAX_ATTEMPTS) {
            return { success: false, code: 'RATE_LIMITED', error: 'Too many attempts. Try again later.' };
        }

        entry.count++;
        _activationAttempts.set(senderId, entry);

        try {
            return activateLicense(payload || {});
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('licensing:getStatus', async (event) => {
        try {
            requireRole(event, ['admin']);
            return getLicenseStatus();
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('licensing:getPlans', async (event) => {
        try {
            requireRole(event, ['admin']);
            return getPlanLimits();
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('licensing:listDevices', async (event) => {
        try {
            requireRole(event, ['admin']);
            return listLicenseDevices();
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('licensing:deactivateCurrentDevice', async (event) => {
        try {
            requireRole(event, ['admin']);
            return deactivateCurrentDevice();
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('licensing:adminRevokeDevice', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            return adminRevokeDevice(payload?.activationId);
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('licensing:refreshValidation', async (event) => {
        try {
            requireRole(event, ['admin']);
            return refreshLicenseValidation();
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('licensing:setTrialDuration', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            return setTrialDuration(payload?.duration);
        } catch (err) {
            return authErrorResponse(err);
        }
    });
}

module.exports = { registerLicensingIpc };
