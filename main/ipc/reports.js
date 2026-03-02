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

    // Legacy compat — wraps into the unified engine
    ipcMain.handle('reports:generateCertificate', (_event, payload) => {
        return printDocument({
            documentType: 'certificate',
            documentTitle: payload.typeLabel || 'شهادة مدرسية',
            bodyHTML: payload.htmlContent || payload.bodyHTML || '',
            data: { studentName: payload.studentName || '' },
            options: {
                mode: payload.mode || 'pdf',
                copies: 2,
                bodyHeight: '148.5mm',
                defaultFileName: payload.defaultFileName
            }
        });
    });

    ipcMain.handle('reports:generateSemesterSummary', (_event, payload) => {
        return printDocument({
            documentType: 'semester_report',
            documentTitle: 'تقرير الفصل الدراسي',
            bodyHTML: payload.htmlContent || payload.bodyHTML || '',
            data: payload.data || {},
            options: {
                mode: payload.mode || 'pdf',
                showSecurity: true,
                showWatermark: true,
                defaultFileName: payload.defaultFileName
            }
        });
    });
}

module.exports = { registerReportsIpc };
