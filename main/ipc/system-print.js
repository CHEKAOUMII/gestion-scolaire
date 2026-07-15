const { printHTML } = require('../print-window');

// Intentionally not in CHANNEL_REGISTRY: print is local UI I/O only.

function registerSystemPrintIpc(ipcMain) {
    ipcMain.handle('system:printCurrentWindow', async (event, options = {}) => {
        try {
            const webContents = event.sender;
            const printOptions = {
                silent: false,
                printBackground: options.printBackground !== false,
                landscape: !!options.landscape,
                pageSize: options.pageSize || 'A4',
                margins: options.margins || { marginType: 'default' },
                copies: Number(options.copies) > 0 ? Number(options.copies) : 1
            };

            const result = await new Promise((resolve) => {
                webContents.print(printOptions, (success, failureReason) => {
                    if (!success) {
                        resolve({
                            success: false,
                            error: failureReason || 'Print failed'
                        });
                        return;
                    }
                    resolve({ success: true });
                });
            });

            return result;
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('system:printToPDF', async (event, options = {}) => {
        try {
            const { BrowserWindow, dialog, shell } = require('electron');
            const fs = require('fs');
            const webContents = event.sender;

            const pdfBuffer = await webContents.printToPDF({
                printBackground: options.printBackground !== false,
                landscape: !!options.landscape,
                pageSize: options.pageSize || 'A4',
                margins: options.margins || { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
                preferCSSPageSize: !!options.preferCSSPageSize
            });

            const win = BrowserWindow.fromWebContents(webContents);
            const suggested = String(options.defaultFileName || `document_${Date.now()}.pdf`)
                .replace(/[\\/:*?"<>|]+/g, '_')
                .trim();
            const defaultPath = /\.pdf$/i.test(suggested) ? suggested : `${suggested || 'document'}.pdf`;
            const { filePath } = await dialog.showSaveDialog(win, {
                defaultPath,
                filters: [{ name: 'PDF', extensions: ['pdf'] }]
            });

            if (filePath) {
                fs.writeFileSync(filePath, pdfBuffer);
                shell.openPath(filePath);
                return { success: true, filePath };
            }
            return { success: false, error: 'Cancelled by user' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ===== Hidden-window print: same app formatting, no sidebar/header =====
    ipcMain.handle('system:printHTML', async (event, payload = {}) => {
        try {
            const { BrowserWindow } = require('electron');
            const parentWindow = BrowserWindow.fromWebContents(event.sender);
            return await printHTML({
                htmlContent: payload.htmlContent || '',
                inlineStyles: payload.inlineStyles || '',
                title: payload.title || 'طباعة',
                pageSize: payload.pageSize || 'A4',
                landscape: !!payload.landscape,
                mode: payload.mode || 'pdf',
                defaultFileName: payload.defaultFileName || undefined,
                parentWindow,
                skipAutoLetterhead: !!payload.skipAutoLetterhead
            });
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

}

module.exports = { registerSystemPrintIpc };
