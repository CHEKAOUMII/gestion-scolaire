'use strict';

/**
 * Diagnostics IPC — main/ipc/diagnostics.js
 *
 * قنوات سجل الأخطاء المتاحة لكل المستخدمين (بلا مصادقة):
 *   - diagnostics:getRecent  → قراءة آخر الأخطاء المسجّلة (handleRead، لا كتابة).
 *   - diagnostics:exportLog  → دمج ملفات السجل وحفظها كملف نصي عبر حوار الحفظ.
 *   - diagnostics:revealLog  → فتح مجلد السجلّات في مستكشف الملفات.
 *
 * ⚠️ لا تُسجَّل أي قناة عبر handleWrite/handleWriteSoftAuth — فهي محلية بحتة ولا
 * تُزامَن، وتسجيلها ككتابة سيتطلّب إدخالاً في CHANNEL_REGISTRY ويفشل smoke test.
 */

const { handleRead } = require('./ipc-helpers');
const { readRecentErrors, getErrorLogFiles, resolveErrorLogPath } = require('../diagnostics/error-log');

function buildDefaultExportName() {
    // نتجنّب Date.now/new Date غير المسموح في بعض السياقات — نستخدم توقيتاً بسيطاً آمناً هنا (main process).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `app-errors-${stamp}.txt`;
}

function registerDiagnosticsIpc(ipcMain) {
    handleRead(ipcMain, 'diagnostics:getRecent', (_db, options) => readRecentErrors(options || {}));

    ipcMain.handle('diagnostics:exportLog', async (event) => {
        try {
            const { BrowserWindow, dialog } = require('electron');
            const fs = require('fs');

            const files = getErrorLogFiles();
            if (!files.length) {
                return { success: false, error: 'لا يوجد سجل أخطاء بعد — لم تُسجَّل أي أخطاء.' };
            }

            const win = BrowserWindow.fromWebContents(event.sender);
            const { filePath, canceled } = await dialog.showSaveDialog(win, {
                defaultPath: buildDefaultExportName(),
                filters: [
                    { name: 'Text', extensions: ['txt', 'log'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (canceled || !filePath) {
                return { success: false, error: 'تم الإلغاء' };
            }

            // دمج الملفات (الأقدم أولاً) في ملف نصي واحد
            let merged = '';
            for (const file of files) {
                try {
                    merged += fs.readFileSync(file, 'utf8');
                    if (merged && !merged.endsWith('\n')) merged += '\n';
                } catch (_) {
                    /* skip unreadable file */
                }
            }

            fs.writeFileSync(filePath, merged, 'utf8');
            return { success: true, filePath, fileCount: files.length };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('diagnostics:revealLog', async () => {
        try {
            const { shell } = require('electron');
            const logPath = resolveErrorLogPath();
            if (!logPath) {
                return { success: false, error: 'تعذّر تحديد مسار السجل' };
            }
            const fs = require('fs');
            if (fs.existsSync(logPath)) {
                shell.showItemInFolder(logPath);
            } else {
                // الملف غير موجود بعد — افتح المجلد الحاوي
                const path = require('path');
                shell.openPath(path.dirname(logPath));
            }
            return { success: true, logPath };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

module.exports = { registerDiagnosticsIpc };
