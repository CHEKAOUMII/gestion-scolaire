const { getDb } = require('../db/context');
const { printHTML } = require('../print-window');
const { requireRole } = require('./auth');
const { hashPassword, generateRandomPassword } = require('../auth/password');


function authErrorResponse(err) {
    const isAuthError = err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN';
    return {
        success: false,
        code: isAuthError ? err.code : 'INTERNAL_ERROR',
        error: err?.message || (isAuthError ? 'غير مصرح' : 'حدث خطأ داخلي')
    };
}

function registerSystemIpc(ipcMain) {
    // IPC Handlers - Reports
    ipcMain.handle('reports:generateCertificate', async (event, payload) => {
        const db = getDb();
        const student = db.prepare('SELECT * FROM students WHERE id = ?').get(payload.student_id) || null;
        return {
            success: true,
            reportType: payload.type || 'school_certificate',
            generatedAt: new Date().toISOString(),
            student
        };
    });

    ipcMain.handle('reports:generateSemesterSummary', async (event, payload) => {
        const db = getDb();
        const year = payload.school_year || '2025/2026';
        const grades = db.prepare(
            'SELECT COUNT(*) as total, AVG(grade) as avg_grade FROM grades WHERE school_year = ?'
        ).get(year);
        const students = db.prepare('SELECT COUNT(*) as total_students FROM students WHERE school_year = ?').get(year);

        return {
            success: true,
            generatedAt: new Date().toISOString(),
            school_year: year,
            summary: { ...grades, ...students }
        };
    });

    // IPC Handlers - System logs
    ipcMain.handle('systemLogs:getAll', async (event, limit = 200) => {
        const db = getDb();
        return db.prepare(`
            SELECT * FROM system_logs
            ORDER BY id DESC
            LIMIT ?
        `).all(limit);
    });

    ipcMain.handle('systemLogs:add', async (event, payload) => {
        try {
            const db = getDb();
            db.prepare(`
                INSERT INTO system_logs(action, details, entity_type, entity_id)
                VALUES(?, ?, ?, ?)
            `).run(payload.action, payload.details || null, payload.entity_type || null, payload.entity_id || null);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // IPC Handlers - Users
    ipcMain.handle('users:getAll', async (event) => {
        try {
            requireRole(event, ['admin']);
            const db = getDb();
            return db
                .prepare('SELECT id, name, email, role, disabled, created_at FROM users ORDER BY created_at DESC')
                .all();
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('users:add', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            const db = getDb();
            const password = String(payload?.password || '').trim();
            const usedGenerated = !password;
            const finalPassword = password || generateRandomPassword();
            db.prepare(`
                INSERT INTO users(name, email, role, password_hash, disabled, must_change_password)
                VALUES(?, ?, ?, ?, ?, ?)
            `).run(
                payload.name,
                payload.email || null,
                payload.role || 'staff',
                hashPassword(finalPassword),
                payload.disabled ? 1 : 0,
                usedGenerated ? 1 : 0
            );
            // Return the generated password only once so admin can share it securely.
            // Never return a hardcoded constant.
            return {
                success: true,
                usedGeneratedPassword: usedGenerated,
                temporaryPassword: usedGenerated ? finalPassword : null
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('users:updateRole', async (event, id, role) => {
        try {
            requireRole(event, ['admin']);
            const db = getDb();
            db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('users:disable', async (event, id, disabled) => {
        try {
            requireRole(event, ['admin']);
            const db = getDb();
            db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

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
                margins: options.margins || { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
            });

            const win = BrowserWindow.fromWebContents(webContents);
            const { filePath } = await dialog.showSaveDialog(win, {
                defaultPath: `document_${Date.now()}.pdf`,
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
                parentWindow
            });
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('system:backupDb', async () => {
        try {
            const fs = require('fs');
            const { getDbPath } = require('../db/context');
            const database = getDb();

            // Checkpoint WAL to ensure all data is in the main file
            database.pragma('wal_checkpoint(TRUNCATE)');

            const dbPath = getDbPath();
            const fileBuffer = fs.readFileSync(dbPath);
            return {
                success: true,
                data: {
                    formatVersion: 1,
                    dbBase64: fileBuffer.toString('base64'),
                    byteLength: fileBuffer.length,
                    createdAt: new Date().toISOString()
                }
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('system:restoreDb', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            const dbBase64 = String(payload?.dbBase64 || '');
            if (!dbBase64) {
                return { success: false, error: 'Missing backup payload' };
            }

            const Database = require('better-sqlite3');
            const { setDb, getDbPath } = require('../db/context');
            const { createTables } = require('../db/schema');
            const { runMigrations } = require('../db/migrations');
            const fs = require('fs');

            const buffer = Buffer.from(dbBase64, 'base64');
            if (!buffer.length) {
                return { success: false, error: 'Invalid backup payload' };
            }

            const expectedByteLength = Number(payload?.expectedByteLength || 0);
            if (expectedByteLength > 0 && buffer.length !== expectedByteLength) {
                return { success: false, error: 'Backup payload size mismatch' };
            }

            // Validate the backup by opening it as a temporary database
            const tempValidationPath = getDbPath() + '.validate.tmp';
            fs.writeFileSync(tempValidationPath, buffer);
            try {
                const testDb = new Database(tempValidationPath, { readonly: true });
                const quickCheck = testDb.pragma('quick_check');
                const result = quickCheck[0]?.quick_check;
                testDb.close();
                if (result && result !== 'ok') {
                    throw new Error(`SQLite quick_check failed: ${result}`);
                }
            } finally {
                if (fs.existsSync(tempValidationPath)) fs.unlinkSync(tempValidationPath);
            }

            const dbPath = getDbPath();
            const rollbackPath = `${dbPath}.restore.bak`;

            const safeUnlink = (filePath) => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            };

            safeUnlink(rollbackPath);

            // Close current database before replacing the file
            const currentDb = getDb();
            currentDb.close();

            const hadDbFile = fs.existsSync(dbPath);
            if (hadDbFile) {
                fs.renameSync(dbPath, rollbackPath);
            }
            // Also remove WAL/SHM files from old database
            safeUnlink(dbPath + '-wal');
            safeUnlink(dbPath + '-shm');

            fs.writeFileSync(dbPath, buffer);

            try {
                const newDb = new Database(dbPath);
                newDb.pragma('journal_mode = WAL');
                newDb.pragma('foreign_keys = ON');
                setDb(newDb);

                createTables();
                runMigrations();
                safeUnlink(rollbackPath);
                return { success: true };
            } catch (postRestoreError) {
                // Rollback: restore old database
                if (hadDbFile && fs.existsSync(rollbackPath)) {
                    safeUnlink(dbPath);
                    safeUnlink(dbPath + '-wal');
                    safeUnlink(dbPath + '-shm');
                    fs.renameSync(rollbackPath, dbPath);

                    const rollbackDb = new Database(dbPath);
                    rollbackDb.pragma('journal_mode = WAL');
                    rollbackDb.pragma('foreign_keys = ON');
                    setDb(rollbackDb);
                }

                throw postRestoreError;
            }
        } catch (err) {
            if (err?.code) return authErrorResponse(err);
            return { success: false, error: err.message };
        }
    });
}

module.exports = { registerSystemIpc };
