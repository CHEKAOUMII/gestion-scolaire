const { printDocument } = require('../reports/engine');
const { getIdentity, updateIdentity, readIdentityDiagnostics } = require('../reports/identity');
const { renderLetterhead } = require('../reports/letterhead');
const { FORM_BUILDERS } = require('../reports/channels/adminForms');
const { getDb } = require('../db/context');
const { authErrorResponse, handleAuthedRead, handleWrite } = require('./ipc-helpers');
const { requireRole } = require('./auth');

const IDENTITY_DIAG_ROLES = ['admin', 'developer', 'staff', 'principal'];

function getIdentityDiagnostics() {
    const db = getDb();
    const { tableExists, rows } = readIdentityDiagnostics(db);
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
    // ISOLATION-CARVEOUT (Slice 0): printDocument/generateAdminForm render caller data + institution identity only; the engine runs no school-data queries (pinned by scripts/check-invariants.js Check D). Scoping this surface needs an ADR + tests.
    handleAuthedRead(ipcMain, 'reports:printDocument', (_ctx, payload) => printDocument(payload));

    // Identity management
    handleAuthedRead(ipcMain, 'reports:getIdentity', () => getIdentity());

    ipcMain.handle('reports:getIdentityDiagnostics', async (event) => {
        try {
            requireRole(event, IDENTITY_DIAG_ROLES);
            return getIdentityDiagnostics();
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    // Same writers as the institution identity channels (permissions.js settings-school page roles)
    handleWrite(ipcMain, 'reports:updateIdentity', ['principal', 'external-guardian'], (db, _event, updates) =>
        updateIdentity(updates || {})
    );

    // Server-rendered letterhead — single source of truth for all contexts
    handleAuthedRead(ipcMain, 'reports:renderLetterhead', (_ctx, overrides) => renderLetterhead(overrides || {}));

    // Admin forms — generates official form PDFs via the unified engine
    handleAuthedRead(ipcMain, 'reports:generateAdminForm', (_ctx, payload) => {
        const { formType, data = {}, mode = 'pdf' } = payload || {};
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