const { printDocument } = require('../reports/engine');
const { getIdentity, updateIdentity } = require('../reports/identity');

function registerReportsIpc(ipcMain) {
    // Unified document printing — single entry point for all pages
    ipcMain.handle('reports:printDocument', (_event, payload) => {
        return printDocument(payload);
    });

    // Identity management
    ipcMain.handle('reports:getIdentity', () => {
        return getIdentity();
    });

    ipcMain.handle('reports:updateIdentity', (_event, updates) => {
        return updateIdentity(updates);
    });
}

module.exports = { registerReportsIpc };
