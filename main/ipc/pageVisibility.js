const { handleRead, handleWrite } = require('./ipc-helpers');
const pageVisibilityRepo = require('../repos/page-visibility');

function normalizePageKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const clean = raw.split('#')[0].split('?')[0].replace(/\\/g, '/');
    const fileName = clean.split('/').pop() || '';
    if (!/^[a-zA-Z0-9._-]+\.html$/.test(fileName)) return '';
    return fileName;
}

function registerPageVisibilityIpc(ipcMain) {
    handleRead(ipcMain, 'pageVisibility:getMap', (db) => {
        const rows = pageVisibilityRepo.listVisibilityRows(db);
        const map = {};
        for (const row of rows) {
            const key = normalizePageKey(row.page_key);
            if (!key) continue;
            map[key] = Number(row.is_visible) === 1;
        }
        return { success: true, map };
    });

    handleWrite(ipcMain, 'pageVisibility:setVisibility', ['admin', 'principal', 'developer'], (db, _event, payload) => {
        const pageKey = normalizePageKey(payload?.pageKey);
        if (!pageKey) {
            return { success: false, code: 'INVALID_PAGE', error: 'اسم الصفحة غير صالح' };
        }

        const isVisible = payload?.isVisible === true ? 1 : 0;
        pageVisibilityRepo.setVisibility(db, pageKey, isVisible);

        return {
            success: true,
            pageKey,
            isVisible: isVisible === 1
        };
    });
}

module.exports = { registerPageVisibilityIpc };
