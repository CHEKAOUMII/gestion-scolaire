const { handleRead, handleWrite } = require('./ipc-helpers');

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
        const rows = db.prepare('SELECT page_key, is_visible FROM page_visibility').all();
        const map = {};
        for (const row of rows) {
            const key = normalizePageKey(row.page_key);
            if (!key) continue;
            map[key] = Number(row.is_visible) === 1;
        }
        return { success: true, map };
    });

    handleWrite(ipcMain, 'pageVisibility:setVisibility', ['admin', 'developer'], (db, _event, payload) => {
        const pageKey = normalizePageKey(payload?.pageKey);
        if (!pageKey) {
            return { success: false, code: 'INVALID_PAGE', error: 'اسم الصفحة غير صالح' };
        }

        const isVisible = payload?.isVisible === true ? 1 : 0;
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
    });
}

module.exports = { registerPageVisibilityIpc };
