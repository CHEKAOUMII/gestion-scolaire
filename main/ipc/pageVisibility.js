const { getDb } = require('../db/context');
const { requireRole } = require('./auth');

function authErrorResponse(err) {
    const isAuthError = err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN';
    return {
        success: false,
        code: isAuthError ? err.code : 'INTERNAL_ERROR',
        error: err?.message || (isAuthError ? 'غير مصرح' : 'حدث خطأ داخلي')
    };
}

function normalizePageKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const clean = raw.split('#')[0].split('?')[0].replace(/\\/g, '/');
    const fileName = clean.split('/').pop() || '';
    if (!/^[a-zA-Z0-9._-]+\.html$/.test(fileName)) return '';
    return fileName;
}

function registerPageVisibilityIpc(ipcMain) {
    ipcMain.handle('pageVisibility:getMap', async () => {
        const db = getDb();
        const rows = db.prepare('SELECT page_key, is_visible FROM page_visibility').all();
        const map = {};
        for (const row of rows) {
            const key = normalizePageKey(row.page_key);
            if (!key) continue;
            map[key] = Number(row.is_visible) === 1;
        }
        return { success: true, map };
    });

    ipcMain.handle('pageVisibility:setVisibility', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            const pageKey = normalizePageKey(payload?.pageKey);
            if (!pageKey) {
                return { success: false, code: 'INVALID_PAGE', error: 'اسم الصفحة غير صالح' };
            }

            const isVisible = payload?.isVisible === true ? 1 : 0;
            const db = getDb();
            db.prepare(
                `
                    INSERT INTO page_visibility(page_key, is_visible, updated_at)
                    VALUES(?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(page_key)
                    DO UPDATE SET is_visible = excluded.is_visible, updated_at = CURRENT_TIMESTAMP
                `
            ).run(pageKey, isVisible);

            return {
                success: true,
                pageKey,
                isVisible: isVisible === 1
            };
        } catch (err) {
            return authErrorResponse(err);
        }
    });
}

module.exports = { registerPageVisibilityIpc };
