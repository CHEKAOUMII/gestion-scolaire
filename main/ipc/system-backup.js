const { getDb } = require('../db/context');
const { requireRole, getSessionByEvent } = require('./auth');
const { authErrorResponse } = require('./ipc-helpers');

// Intentionally not in CHANNEL_REGISTRY: full DB backup/restore is local-only.

const CONTENT_RESTORE_TABLES = [
    'school_identity',
    'settings',
    'students',
    'student_files',
    'student_movements',
    'student_profile_data',
    'student_risk_snapshot',
    'teachers',
    'teacher_aliases',
    'teacher_absences',
    'name_aliases',
    'absences',
    'grades',
    'exams',
    'tests',
    'exam_rooms',
    'exam_proctors',
    'timetable_data',
    'staff_attendance',
    'support_sessions',
    'compensation_tracking',
    'correspondence',
    'inspectors',
    'school_events',
    'system_tags',
    'notifications',
    'page_visibility'
];

function quoteIdent(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
}

function tableExists(db, schemaName, tableName) {
    const schema = schemaName === 'backup_content' ? 'backup_content' : 'main';
    const row = db
        .prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
        .get(tableName);
    return !!row;
}

function getColumnNames(db, schemaName, tableName) {
    const schema = schemaName === 'backup_content' ? 'backup_content' : 'main';
    return db.prepare(`PRAGMA ${schema}.table_info(${quoteIdent(tableName)})`).all().map((row) => row.name);
}

function registerSystemBackupIpc(ipcMain) {
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
            const { setDb, getDbPath, applyConnectionPragmas } = require('../db/context');
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
                applyConnectionPragmas(newDb);
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
                    applyConnectionPragmas(rollbackDb);
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

    ipcMain.handle('system:restoreDbContent', async (event, payload) => {
        const fs = require('fs');
        const Database = require('better-sqlite3');
        const { getDbPath } = require('../db/context');
        const tempPath = getDbPath() + '.content-restore.tmp';
        let attached = false;

        try {
            console.log('[backup] restoreDbContent: started');
            const session = getSessionByEvent(event);
            if (session) {
                requireRole(event, ['admin', 'principal']);
                console.log('[backup] restoreDbContent: authenticated as', session.role);
            } else {
                console.log('[backup] restoreDbContent: no session — proceeding without auth');
            }

            const dbBase64 = String(payload?.dbBase64 || '');
            if (!dbBase64) {
                return { success: false, error: 'Missing backup payload' };
            }

            const buffer = Buffer.from(dbBase64, 'base64');
            const expectedByteLength = Number(payload?.expectedByteLength || 0);
            if (!buffer.length) {
                return { success: false, error: 'Invalid backup payload' };
            }
            if (expectedByteLength > 0 && buffer.length !== expectedByteLength) {
                return { success: false, error: 'Backup payload size mismatch' };
            }

            fs.writeFileSync(tempPath, buffer);
            const testDb = new Database(tempPath, { readonly: true });
            try {
                const quickCheck = testDb.pragma('quick_check');
                const result = quickCheck[0]?.quick_check;
                if (result && result !== 'ok') {
                    return { success: false, error: `SQLite quick_check failed: ${result}` };
                }
            } finally {
                testDb.close();
            }

            const db = getDb();
            db.prepare('ATTACH DATABASE ? AS backup_content').run(tempPath);
            attached = true;

            const restoredTables = [];
            const skippedTables = [];
            const previousForeignKeys = db.pragma('foreign_keys', { simple: true });
            db.pragma('foreign_keys = OFF');

            try {
                db.prepare('BEGIN IMMEDIATE').run();

                for (const tableName of CONTENT_RESTORE_TABLES) {
                    if (!tableExists(db, 'main', tableName) || !tableExists(db, 'backup_content', tableName)) {
                        skippedTables.push(tableName);
                        continue;
                    }

                    const mainColumns = getColumnNames(db, 'main', tableName);
                    const backupColumns = new Set(getColumnNames(db, 'backup_content', tableName));
                    const columns = mainColumns.filter((column) => backupColumns.has(column));
                    if (!columns.length) {
                        skippedTables.push(tableName);
                        continue;
                    }

                    const quotedTable = quoteIdent(tableName);
                    const quotedColumns = columns.map(quoteIdent).join(', ');
                    db.prepare(`DELETE FROM main.${quotedTable}`).run();
                    db.prepare(
                        `
                        INSERT INTO main.${quotedTable}(${quotedColumns})
                        SELECT ${quotedColumns}
                        FROM backup_content.${quotedTable}
                    `
                    ).run();
                    restoredTables.push(tableName);
                }

                db.prepare('COMMIT').run();
            } catch (restoreError) {
                try {
                    db.prepare('ROLLBACK').run();
                } catch {
                    // ignore rollback failures
                }
                throw restoreError;
            } finally {
                db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
            }

            console.log('[backup] restoreDbContent: restored tables:', restoredTables.join(', '));
            return {
                success: true,
                mode: 'content',
                restoredTables,
                skippedTables,
                restoredItems: restoredTables.length
            };
        } catch (err) {
            console.error('[backup] restoreDbContent: FAILED —', err.message);
            if (err?.code) return authErrorResponse(err);
            return { success: false, error: err.message };
        } finally {
            try {
                if (attached) getDb().prepare('DETACH DATABASE backup_content').run();
            } catch {
                // ignore detach cleanup failures
            }
            try {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            } catch {
                // ignore temp cleanup failures
            }
        }
    });
}

module.exports = { registerSystemBackupIpc };
