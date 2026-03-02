const { printDocument } = require('../reports/engine');
const { getIdentity, updateIdentity } = require('../reports/identity');
const { renderLetterhead } = require('../reports/letterhead');
const { FORM_BUILDERS } = require('../reports/channels/adminForms');

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

    // Admin forms — generates official form PDFs via the unified engine
    ipcMain.handle('reports:generateAdminForm', (_event, payload) => {
        const { formType, data = {}, mode = 'pdf' } = payload;
        const builder = FORM_BUILDERS[formType];
        if (!builder) {
            return { success: false, error: `نوع الاستمارة غير معروف: ${formType}` };
        }
        const bodyHTML = builder.build(data);
        return printDocument({
            documentType: 'admin_form',
            documentTitle: builder.title,
            bodyHTML,
            data: { studentName: data.studentName || '' },
            options: {
                mode,
                showSecurity: true,
                showWatermark: false,
                defaultFileName: `${builder.title}_${data.massarCode || ''}`
            }
        });
    });
}

module.exports = { registerReportsIpc };
