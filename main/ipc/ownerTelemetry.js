const { requireRole } = require('./auth');
const {
    getOwnerSyncConfig,
    getOwnerTelemetryOverview,
    getOwnerTelemetryDevices,
    setOwnerSyncConfig,
    syncOwnerTelemetryNow,
    testOwnerSyncConnection
} = require('../licensing/ownerSync');

function authErrorResponse(err) {
    const isAuthError = err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN';
    return {
        success: false,
        code: isAuthError ? err.code : 'INTERNAL_ERROR',
        error: err?.message || (isAuthError ? 'غير مصرح' : 'حدث خطأ داخلي')
    };
}

function registerOwnerTelemetryIpc(ipcMain) {
    ipcMain.handle('ownerTelemetry:getConfig', async (_event) => {
        try {
            return getOwnerSyncConfig();
        } catch (err) {
            return { success: false, code: 'INTERNAL_ERROR', error: err?.message || 'حدث خطأ داخلي' };
        }
    });

    ipcMain.handle('ownerTelemetry:saveConfig', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            return setOwnerSyncConfig(payload || {});
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('ownerTelemetry:syncNow', async (event) => {
        try {
            requireRole(event, ['admin']);
            return await syncOwnerTelemetryNow();
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('ownerTelemetry:testConnection', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            return await testOwnerSyncConnection(payload || {});
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('ownerTelemetry:getOverview', async (event) => {
        try {
            requireRole(event, ['admin']);
            return await getOwnerTelemetryOverview();
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('ownerTelemetry:getDevices', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            return await getOwnerTelemetryDevices(payload?.limit);
        } catch (err) {
            return authErrorResponse(err);
        }
    });
}

module.exports = { registerOwnerTelemetryIpc };
