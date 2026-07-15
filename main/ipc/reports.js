const { printDocument } = require('../reports/engine');
const { getIdentity, updateIdentity } = require('../reports/identity');
const { renderLetterhead } = require('../reports/letterhead');
const { FORM_BUILDERS } = require('../reports/channels/adminForms');
const { getDb } = require('../db/context');
const { authErrorResponse } = require('./ipc-helpers');
const { requireRole } = require('./auth');

const IDENTITY_DIAG_ROLES = ['admin', 'developer', 'staff', 'principal'];

function getIdentityDiagnostics() {
    const db = getDb();
    const tableExists = !!db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'school_identity'")
        .get();
    const rows = tableExists ? db.prepare('SELECT key, value FROM school_identity ORDER BY key').all() : [];
    const identity = {};
    for (const row of rows) {
        identity[row.key] = row.value;
    }

    return {
        tableExists,
        rowCount: rows.length,
        identity: {
            school_name: identity.school_name || '',
            academy: identity.academy || '',
            directorate: identity.directorate || '',
            commune: identity.commune || '',
            city: identity.city || '',
            school_year: identity.school_year || ''
        },
        hasLogo: !!identity.logo_base64,
        logoLength: String(identity.logo_base64 || '').length
    };
}

function registerReportsIpc(ipcMain) {
    // Unified document printing — single entry point for all pages
    ipcMain.handle('reports:printDocument', (_event, payload) => {
        return printDocument(payload);
    });

    // Identity management
    ipcMain.handle('reports:getIdentity', () => {
        return getIdentity();
    });

    ipcMain.handle('reports:getIdentityDiagnostics', async (event) => {
        try {
            requireRole(event, IDENTITY_DIAG_ROLES);
            return getIdentityDiagnostics();
        } catch (err) {
            return authErrorResponse(err);
        }
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