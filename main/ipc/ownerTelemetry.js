const { authErrorResponse } = require('./ipc-helpers');
const { requireRole } = require('./auth');
const {
    getOwnerSyncConfig,
    getOwnerTelemetryOverview,
    getOwnerTelemetryDevices,
    setOwnerSyncConfig,
    syncOwnerTelemetryNow,
    testOwnerSyncConnection
} = require('../licensing/ownerSync');

function registerOwnerTelemetryIpc(ipcMain) {
    ipcMain.handle('ownerTelemetry:getConfig', async (event) => {
        try {
            requireRole(event, ['admin']);
            return getOwnerSyncConfig();
        } catch (err) {
            return authErrorResponse(err);
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
