const {
    activateLicense,
    adminRevokeDevice,
    deactivateCurrentDevice,
    getActivationRequest,
    getLicenseStatus,
    getPublicActivationStatus,
    generateSerialKey,
    getPlanLimits,
    listLicenseDevices,
    refreshLicenseValidation
} = require('../licensing/service');
const { requireRole } = require('./auth');

function authErrorResponse(err) {
    const isAuthError = err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN';
    return {
        success: false,
        code: isAuthError ? err.code : 'INTERNAL_ERROR',
        error: err?.message || (isAuthError ? 'غير مصرح' : 'حدث خطأ داخلي')
    };
}

function registerLicensingIpc(ipcMain) {
    // Public activation channels (available before login)
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

    ipcMain.handle('licensing:activatePublic', async (_event, payload) => {
        try {
            return activateLicense(payload || {});
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('licensing:generateSerial', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            return generateSerialKey(payload || {});
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    // Admin channels
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

    ipcMain.handle('licensing:activate', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            return activateLicense(payload || {});
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
}

module.exports = { registerLicensingIpc };
