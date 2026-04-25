const { getDb } = require('../db/context');
const { printHTML } = require('../print-window');
const { requireRole, getSessionByEvent } = require('./auth');
const { hashPassword, generateRandomPassword } = require('../auth/password');
const { authErrorResponse, handleWrite, handleRead } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const { getCurrentFirebaseIdToken } = require('../auth/firebase-auth-service');

function normalizeEmail(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function getTableColumns(db, tableName) {
    try {
        return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
    } catch {
        return new Set();
    }
}

function columnExpr(columns, columnName, fallbackSql = 'NULL') {
    return columns.has(columnName) ? columnName : `${fallbackSql} AS ${columnName}`;
}

function getSchoolId(db) {
    const syncColumns = getTableColumns(db, 'sync_config');
    const institutionColumns = getTableColumns(db, 'institution_config');
    const syncRow = syncColumns.has('school_id')
        ? db.prepare('SELECT school_id FROM sync_config WHERE id = 1').get() || {}
        : {};
    const institutionRow = institutionColumns.has('massar_code')
        ? db.prepare('SELECT massar_code FROM institution_config WHERE id = 1').get() || {}
        : {};
    return String(syncRow.school_id || institutionRow.massar_code || process.env.FIREBASE_SCHOOL_ID || '').trim();
}

function getFirebaseFunctionsUrl(db) {
    const row = db.prepare('SELECT firebase_functions_url FROM sync_config WHERE id = 1').get() || {};
    return String(row.firebase_functions_url || process.env.FIREBASE_FUNCTIONS_URL || '').trim().replace(/\/+$/, '');
}

async function postFirebaseFunction(db, functionName, body) {
    const functionsUrl = getFirebaseFunctionsUrl(db);
    if (!functionsUrl) {
        const err = new Error('Firebase Functions URL is not configured');
        err.code = 'FIREBASE_FUNCTIONS_NOT_CONFIGURED';
        throw err;
    }

    const idToken = await getCurrentFirebaseIdToken(true);
    const response = await fetch(`${functionsUrl}/${functionName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(body || {}), idToken })
    });
    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { message: text };
        }
    }

    if (!response.ok || data.success === false) {
        const err = new Error(data.message || data.error || `Firebase function ${functionName} failed`);
        err.code = data.code || data.error || 'FIREBASE_FUNCTION_FAILED';
        err.status = response.status;
        throw err;
    }

    return data;
}

async function provisionFirebaseUser(db, payload) {
    const email = normalizeEmail(payload.email);
    if (!email) {
        const err = new Error('Email is required for Firebase user provisioning');
        err.code = 'MISSING_EMAIL';
        throw err;
    }

    const data = await postFirebaseFunction(db, 'provisionSchoolUser', {
        email,
        name: String(payload.name || '').trim(),
        role: payload.role || 'principal',
        temporaryPassword: String(payload.password || ''),
        mustChangePassword: !!payload.mustChangePassword,
        createInvite: payload.createInvite !== false
    });

    return {
        status: 'created',
        uid: data.uid,
        emailVerified: !!data.profile?.emailVerified,
        temporaryPassword: data.temporaryPassword || null
    };
}

async function updateFirebaseUserRole(db, user, role) {
    let uid = String(user?.firebase_uid || '').trim();
    if (!uid) {
        const err = new Error('Firebase UID is required for role updates');
        err.code = 'MISSING_FIREBASE_UID';
        throw err;
    }

    const data = await postFirebaseFunction(db, 'updateSchoolUserRole', { targetUid: uid, role });
    return { status: 'updated', uid: data.uid || uid };
}

async function updateFirebaseUserDisabled(db, user, disabled) {
    let uid = String(user?.firebase_uid || '').trim();
    if (!uid) {
        const err = new Error('Firebase UID is required for disabling users');
        err.code = 'MISSING_FIREBASE_UID';
        throw err;
    }

    const data = await postFirebaseFunction(db, 'setSchoolUserDisabled', { targetUid: uid, disabled: !!disabled });
    return { status: 'updated', uid: data.uid || uid };
}

function buildFirebaseProvisioningWarning(result) {
    if (!result || result.status === 'created' || result.status === 'linked' || result.status === 'updated') {
        return null;
    }
    return result.reason || 'firebase-provisioning-skipped';
}

function registerSystemIpc(ipcMain) {
    // IPC Handlers - System logs
    handleRead(ipcMain, 'systemLogs:getAll', (db, limit) => {
        return db
            .prepare(
                `
            SELECT * FROM system_logs
            ORDER BY id DESC
            LIMIT ?
        `
            )
            .all(limit || 200);
    });

    ipcMain.handle('systemLogs:add', async (_event, payload) => {
        try {
            const db = getDb();
            db.prepare(
                `
                INSERT INTO system_logs(action, details, entity_type, entity_id)
                VALUES(?, ?, ?, ?)
            `
            ).run(payload.action, payload.details || null, payload.entity_type || null, payload.entity_id || null);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // IPC Handlers - Users
    handleWrite(ipcMain, 'users:getAll', ['admin'], (db) => {
        const columns = getTableColumns(db, 'users');
        return db
            .prepare(
                `
                SELECT
                    id,
                    name,
                    email,
                    role,
                    disabled,
                    must_change_password,
                    created_at,
                    ${columnExpr(columns, 'firebase_uid')},
                    ${columnExpr(columns, 'auth_source', "'local'")},
                    ${columnExpr(columns, 'email_verified', '0')},
                    ${columnExpr(columns, 'invite_status', "'active'")}
                FROM users
                ORDER BY created_at DESC
            `
            )
            .all();
    });

    ipcMain.handle('users:add', async (event, payload) => {
        try {
            requireRole(event, ['admin']);
            const db = getDb();
            const password = String(payload?.password || '').trim();
            const usedGenerated = !password;
            const finalPassword = password || generateRandomPassword();
            const role = payload.role || 'principal'; // default when role field is omitted
            if (!ALLOWED_ROLES.includes(role)) {
                return { success: false, error: `دور غير صالح: ${role}` };
            }
            const email = normalizeEmail(payload.email) || null;
            const existing = email
                ? db.prepare('SELECT id FROM users WHERE lower(email) = ? LIMIT 1').get(email)
                : null;
            if (existing) {
                return { success: false, code: 'EMAIL_EXISTS', error: 'هذا البريد الإلكتروني مستخدم بالفعل' };
            }

            const firebaseProvisioning = await provisionFirebaseUser(db, {
                ...payload,
                email,
                password: finalPassword,
                role,
                disabled: !!payload.disabled,
                mustChangePassword: usedGenerated,
                resetPasswordForExisting: true
            });

            const columns = getTableColumns(db, 'users');
            const insertColumns = ['name', 'email', 'role', 'password_hash', 'disabled', 'must_change_password'];
            const insertValues = [
                payload.name,
                email,
                role,
                hashPassword(finalPassword),
                payload.disabled ? 1 : 0,
                usedGenerated ? 1 : 0
            ];

            if (columns.has('firebase_uid')) {
                insertColumns.push('firebase_uid');
                insertValues.push(firebaseProvisioning.uid || null);
            }
            if (columns.has('auth_source')) {
                insertColumns.push('auth_source');
                insertValues.push(firebaseProvisioning.uid ? 'firebase' : 'local');
            }
            if (columns.has('email_verified')) {
                insertColumns.push('email_verified');
                insertValues.push(firebaseProvisioning.emailVerified ? 1 : 0);
            }
            if (columns.has('invite_status')) {
                insertColumns.push('invite_status');
                insertValues.push(payload.disabled ? 'disabled' : 'active');
            }

            const placeholders = insertColumns.map(() => '?').join(', ');
            db.prepare(`INSERT INTO users(${insertColumns.join(', ')}) VALUES(${placeholders})`).run(...insertValues);
            // Return the generated password only once so admin can share it securely.
            // Never return a hardcoded constant.
            return {
                success: true,
                usedGeneratedPassword: usedGenerated,
                temporaryPassword: usedGenerated ? finalPassword : null,
                firebaseProvisioning,
                warning: buildFirebaseProvisioningWarning(firebaseProvisioning)
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('users:updateRole', async (event, id, role) => {
        try {
            requireRole(event, ['admin']);
            if (!ALLOWED_ROLES.includes(role)) {
                return { success: false, error: `دور غير صالح: ${role}` };
            }
            const db = getDb();
            const columns = getTableColumns(db, 'users');
            const user = db
                .prepare(
                    `
                    SELECT id, name, email, role, disabled, ${columnExpr(columns, 'firebase_uid')}
                    FROM users
                    WHERE id = ?
                `
                )
                .get(id);
            if (!user) {
                return { success: false, code: 'USER_NOT_FOUND', error: 'المستخدم غير موجود' };
            }

            const firebaseProvisioning = await updateFirebaseUserRole(db, user, role);

            db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
            return {
                success: true,
                firebaseProvisioning,
                warning: buildFirebaseProvisioningWarning(firebaseProvisioning)
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('users:disable', async (event, id, disabled) => {
        try {
            requireRole(event, ['admin']);
            const db = getDb();
            const columns = getTableColumns(db, 'users');
            const user = db
                .prepare(
                    `
                    SELECT id, name, email, role, disabled, ${columnExpr(columns, 'firebase_uid')}
                    FROM users
                    WHERE id = ?
                `
                )
                .get(id);
            if (!user) {
                return { success: false, code: 'USER_NOT_FOUND', error: 'المستخدم غير موجود' };
            }

            const firebaseProvisioning = await updateFirebaseUserDisabled(db, user, !!disabled);

            db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
            if (columns.has('invite_status')) {
                db.prepare('UPDATE users SET invite_status = ? WHERE id = ?').run(disabled ? 'disabled' : 'active', id);
            }
            return {
                success: true,
                firebaseProvisioning,
                warning: buildFirebaseProvisioningWarning(firebaseProvisioning)
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Admin password reset (no auth required — recovery mechanism) ──
    ipcMain.handle('users:resetAdminPassword', async () => {
        try {
            const db = getDb();
            let admin = db.prepare("SELECT id FROM users WHERE lower(email) = 'admin@school.local'").get();
            const newPassword = generateRandomPassword();
            if (!admin) {
                // Create the default developer account if it doesn't exist
                db.prepare(`
                    INSERT INTO users(name, email, role, password_hash, disabled, must_change_password)
                    VALUES('المشرف', 'admin@school.local', 'developer', ?, 0, 0)
                `).run(hashPassword(newPassword));
                console.log('[RESET] Developer account created with password: ' + newPassword);
                return { success: true, temporaryPassword: newPassword, created: true };
            }
            db.prepare("UPDATE users SET password_hash = ?, role = 'developer', disabled = 0, must_change_password = 0 WHERE lower(email) = 'admin@school.local'").run(
                hashPassword(newPassword)
            );
            console.log('[RESET] Admin password has been reset to: ' + newPassword);
            return { success: true, temporaryPassword: newPassword };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Save current page visibility as defaults for future installations ──
    ipcMain.handle('system:savePageVisibilityDefaults', async (event) => {
        try {
            requireRole(event, ['admin']);
            const db = getDb();
            const path = require('path');
            const fs = require('fs');

            // Get all pages that are explicitly hidden
            const rows = db.prepare('SELECT page_key FROM page_visibility WHERE is_visible = 0').all();
            const hiddenPages = rows
                .map((r) => r.page_key)
                .filter(Boolean)
                .sort();

            const defaults = {
                version: 1,
                description:
                    'Default page visibility settings. Hidden pages here will be hidden for all new installations.',
                updatedAt: new Date().toISOString(),
                hiddenPages
            };

            const defaultsPath = path.join(__dirname, '..', '..', 'page-visibility-defaults.json');
            fs.writeFileSync(defaultsPath, JSON.stringify(defaults, null, 2) + '\n', 'utf-8');

            return { success: true, hiddenCount: hiddenPages.length };
        } catch (err) {
            if (err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN') {
                return authErrorResponse(err);
            }
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
                parentWindow,
                skipAutoLetterhead: !!payload.skipAutoLetterhead
            });
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('system:backupDb', async (event) => {
        try {
            console.log('[backup] backupDb: started');
            // Soft auth: allow backup without login (settings-imports page is pre-login)
            const session = getSessionByEvent(event);
            if (session) {
                requireRole(event, ['admin']);
                console.log('[backup] backupDb: authenticated as', session.role);
            } else {
                console.log('[backup] backupDb: no session — proceeding without auth');
            }

            const fs = require('fs');
            const { getDbPath } = require('../db/context');
            const database = getDb();

            // Use better-sqlite3's native backup API for safe, complete snapshots (includes WAL)
            const backupTempPath = getDbPath() + '.backup.tmp';
            console.log('[backup] backupDb: using native database.backup() to', backupTempPath);
            await database.backup(backupTempPath);
            
            const fileBuffer = fs.readFileSync(backupTempPath);
            fs.unlinkSync(backupTempPath);
            console.log('[backup] backupDb: DB file size =', fileBuffer.length, 'bytes');

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
            // Clean up left-over temporary backup file if any error occurs
            try {
                const fs = require('fs');
                const { getDbPath } = require('../db/context');
                const tmpPath = getDbPath() + '.backup.tmp';
                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            } catch {}
            
            console.error('[backup] backupDb: FAILED —', err.message);
            if (err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN') {
                return authErrorResponse(err);
            }
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('system:restoreDb', async (event, payload) => {
        try {
            console.log('[backup] restoreDb: started');
            // Soft auth: allow restore without login (settings-imports page is pre-login)
            const session = getSessionByEvent(event);
            if (session) {
                requireRole(event, ['admin']);
                console.log('[backup] restoreDb: authenticated as', session.role);
            } else {
                console.log('[backup] restoreDb: no session — proceeding without auth');
            }

            const dbBase64 = String(payload?.dbBase64 || '');
            if (!dbBase64) {
                console.error('[backup] restoreDb: missing dbBase64 payload');
                return { success: false, error: 'Missing backup payload' };
            }
            console.log('[backup] restoreDb: base64 payload length =', dbBase64.length);

            const Database = require('better-sqlite3');
            const { setDb, getDbPath } = require('../db/context');
            const { createTables } = require('../db/schema');
            const { runMigrations } = require('../db/migrations');
            const fs = require('fs');

            const buffer = Buffer.from(dbBase64, 'base64');
            console.log('[backup] restoreDb: decoded buffer size =', buffer.length, 'bytes');
            if (!buffer.length) {
                return { success: false, error: 'Invalid backup payload' };
            }

            const expectedByteLength = Number(payload?.expectedByteLength || 0);
            if (expectedByteLength > 0 && buffer.length !== expectedByteLength) {
                console.error('[backup] restoreDb: size mismatch — expected', expectedByteLength, 'got', buffer.length);
                return { success: false, error: 'Backup payload size mismatch' };
            }

            // Validate the backup by opening it as a temporary database
            const tempValidationPath = getDbPath() + '.validate.tmp';
            fs.writeFileSync(tempValidationPath, buffer);
            try {
                const testDb = new Database(tempValidationPath, { readonly: true });
                const quickCheck = testDb.pragma('quick_check');
                const result = quickCheck[0]?.quick_check;
                // Count tables in backup to verify it has data
                const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
                console.log('[backup] restoreDb: backup contains tables:', tables.map(t => t.name).join(', '));
                const studentCount = (() => { try { return testDb.prepare('SELECT COUNT(*) as c FROM students').get()?.c; } catch { return 'N/A'; } })();
                const teacherCount = (() => { try { return testDb.prepare('SELECT COUNT(*) as c FROM teachers').get()?.c; } catch { return 'N/A'; } })();
                console.log('[backup] restoreDb: backup data — students:', studentCount, ', teachers:', teacherCount);
                testDb.close();
                if (result && result !== 'ok') {
                    throw new Error(`SQLite quick_check failed: ${result}`);
                }
                console.log('[backup] restoreDb: quick_check passed');
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
            console.log('[backup] restoreDb: closing current database...');
            const currentDb = getDb();
            currentDb.close();

            const hadDbFile = fs.existsSync(dbPath);
            if (hadDbFile) {
                fs.renameSync(dbPath, rollbackPath);
                console.log('[backup] restoreDb: old DB backed up to', rollbackPath);
            }
            // Also remove WAL/SHM files from old database
            safeUnlink(dbPath + '-wal');
            safeUnlink(dbPath + '-shm');

            console.log('[backup] restoreDb: writing restored DB to', dbPath);
            fs.writeFileSync(dbPath, buffer);

            try {
                const newDb = new Database(dbPath);
                newDb.pragma('journal_mode = WAL');
                newDb.pragma('foreign_keys = ON');
                setDb(newDb);

                console.log('[backup] restoreDb: running createTables...');
                createTables();
                console.log('[backup] restoreDb: running runMigrations...');
                runMigrations();

                // Verify data after restore
                const postStudents = (() => { try { return newDb.prepare('SELECT COUNT(*) as c FROM students').get()?.c; } catch { return 'N/A'; } })();
                const postTeachers = (() => { try { return newDb.prepare('SELECT COUNT(*) as c FROM teachers').get()?.c; } catch { return 'N/A'; } })();
                console.log('[backup] restoreDb: POST-RESTORE — students:', postStudents, ', teachers:', postTeachers);

                safeUnlink(rollbackPath);
                console.log('[backup] restoreDb: SUCCESS');
                return { success: true };
            } catch (postRestoreError) {
                console.error('[backup] restoreDb: post-restore FAILED —', postRestoreError.message);
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
                    console.log('[backup] restoreDb: rolled back to previous database');
                }

                throw postRestoreError;
            }
        } catch (err) {
            console.error('[backup] restoreDb: FINAL ERROR —', err.message);
            if (err?.code) return authErrorResponse(err);
            return { success: false, error: err.message };
        }
    });
}

module.exports = {
    registerSystemIpc,
    _private: {
        normalizeEmail,
        getTableColumns,
        columnExpr,
        getSchoolId,
        provisionFirebaseUser,
        updateFirebaseUserRole,
        updateFirebaseUserDisabled,
        buildFirebaseProvisioningWarning
    }
};
