const { printDocument } = require('../reports/engine');
const { getIdentity, updateIdentity } = require('../reports/identity');
const { renderLetterhead } = require('../reports/letterhead');

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

    // Server-rendered letterhead — single source of truth for all contexts
    ipcMain.handle('reports:renderLetterhead', (_event, overrides) => {
        return renderLetterhead(overrides || {});
    });
}

module.exports = { registerReportsIpc };
