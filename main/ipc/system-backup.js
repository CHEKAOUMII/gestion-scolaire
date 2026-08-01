const { getDb } = require('../db/context');
const { createHash } = require('crypto');
const { requireRole, getSessionByEvent } = require('./auth');
const { authErrorResponse } = require('./ipc-helpers');
const { ENTITY_REGISTRY, getContractVersion } = require('../sync/entity-registry');

const BACKUP_FORMAT_VERSION = 2;
const CYCLE_REQUIRED_TABLES = Object.entries(ENTITY_REGISTRY)
    .filter(([, entity]) => entity.local?.requiredColumns?.includes('cycle_code'))
    .map(([tableName]) => tableName);
const BACKUP_SAFETY_CODES = new Set([
    'BACKUP_CYCLE_INSTALLATION_UPDATE_REQUIRED',
    'BACKUP_CYCLE_REPLACEMENT_REQUIRED',
    'BACKUP_CYCLE_METADATA_MISMATCH',
    'BACKUP_QUARANTINE_UNAVAILABLE'
]);

function backupSafetyResponse(error) {
    if (BACKUP_SAFETY_CODES.has(error?.code)) {
        return { success: false, code: error.code, error: error.message };
    }
    return null;
}

// Intentionally not in CHANNEL_REGISTRY: full DB backup/restore is local-only.

const CONTENT_RESTORE_TABLES = [
    'school_identity',
    'settings',
    'institution_cycles',
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

function getCycleInventory(db) {
    const hasInstitutionCycles = tableExists(db, 'main', 'institution_cycles');
    if (hasInstitutionCycles) {
        const rows = db.prepare(
            `SELECT cycle_code, is_active, profile_version FROM institution_cycles
             WHERE cycle_code IS NOT NULL AND TRIM(cycle_code) <> '' ORDER BY sort_order, cycle_code`
        ).all();
        return { known: true, cycles: rows.map((row) => ({
            cycle_code: String(row.cycle_code).trim(),
            is_active: Number(row.is_active) ? 1 : 0,
            profile_version: row.profile_version || null
        })) };
    }

    const codes = new Set();
    for (const tableName of CYCLE_REQUIRED_TABLES) {
        if (!tableExists(db, 'main', tableName) || !getColumnNames(db, 'main', tableName).includes('cycle_code')) continue;
        db.prepare(`SELECT DISTINCT cycle_code FROM ${quoteIdent(tableName)} WHERE cycle_code IS NOT NULL AND TRIM(cycle_code) <> ''`).all()
            .forEach((row) => codes.add(String(row.cycle_code).trim()));
    }
    return { known: false, cycles: [...codes].sort().map((cycle_code) => ({ cycle_code })) };
}

function getContractInventory() {
    return Object.fromEntries(
        Object.entries(ENTITY_REGISTRY)
            .filter(([, entity]) => entity.local?.table)
            .map(([tableName]) => [tableName, getContractVersion(tableName)])
    );
}

function cycleCodes(inventory) {
    return new Set((inventory?.cycles || []).map((row) => String(row?.cycle_code || '').trim()).filter(Boolean));
}

function sameCycleCodes(left, right) {
    const a = [...cycleCodes(left)].sort();
    const b = [...cycleCodes(right)].sort();
    return a.length === b.length && a.every((code, index) => code === b[index]);
}

function validateCycleInventory(currentInventory, backupInventory, options = {}) {
    const currentCodes = cycleCodes(currentInventory);
    const backupCodes = cycleCodes(backupInventory);
    const unknownToInstall = [...backupCodes].filter((code) => !currentCodes.has(code));

    if (backupCodes.size && !currentInventory?.known) {
        const error = new Error('النسخة تتضمن أسلاكاً غير معروفة على هذا التثبيت — يرجى تحديث التطبيق أولاً');
        error.code = 'BACKUP_CYCLE_INSTALLATION_UPDATE_REQUIRED';
        throw error;
    }
    if (unknownToInstall.length) {
        const error = new Error(`النسخة تتضمن أسلاكاً غير معروفة على هذا التثبيت: ${unknownToInstall.join('، ')}`);
        error.code = 'BACKUP_CYCLE_INSTALLATION_UPDATE_REQUIRED';
        throw error;
    }
    if (currentCodes.size !== backupCodes.size && options.replaceAllCycles !== true) {
        const error = new Error('تختلف قائمة أسلاك النسخة عن قاعدة البيانات الحالية؛ يلزم إعلان الاستبدال الكامل قبل المتابعة');
        error.code = 'BACKUP_CYCLE_REPLACEMENT_REQUIRED';
        throw error;
    }
    return { currentCodes: [...currentCodes], backupCodes: [...backupCodes] };
}

function getDeclaredBackupMetadata(payload) {
    const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : payload || {};
    return {
        cycleInventory: Array.isArray(metadata.cycleInventory) ? { known: metadata.cycleInventoryKnown !== false, cycles: metadata.cycleInventory } : null,
        contractVersions: metadata.contractVersions && typeof metadata.contractVersions === 'object' ? metadata.contractVersions : null
    };
}

function validateDeclaredInventory(declared, derived) {
    if (declared && !sameCycleCodes(declared, derived)) {
        const error = new Error('بيانات أسلاك النسخة لا تطابق محتوى قاعدة البيانات داخل الملف');
        error.code = 'BACKUP_CYCLE_METADATA_MISMATCH';
        throw error;
    }
}

function getUnsafeCycleRows(sourceDb, schemaName, backupId, validCycleCodes = null) {
    const unsafe = [];
    for (const tableName of CYCLE_REQUIRED_TABLES) {
        if (!tableExists(sourceDb, schemaName, tableName)) continue;
        const columns = getColumnNames(sourceDb, schemaName, tableName);
        const rows = sourceDb.prepare(`SELECT * FROM ${schemaName}.${quoteIdent(tableName)}`).all();
        rows.forEach((row) => {
            const code = String(row.cycle_code || '').trim();
            const reason = !columns.includes('cycle_code')
                ? 'missing_cycle_code_column'
                : !code
                    ? 'missing_cycle_code_value'
                    : validCycleCodes && !validCycleCodes.has(code)
                        ? 'unknown_cycle_code'
                        : null;
            if (reason) unsafe.push({ tableName, row, reason, backupId });
        });
    }
    return unsafe;
}

function quarantineRows(db, unsafeRows) {
    if (!unsafeRows.length) return 0;
    if (!tableExists(db, 'main', 'sync_quarantine')) {
        const error = new Error('لا يمكن عزل سجلات النسخة غير المصنفة لأن جدول الحجر غير متاح؛ يلزم تحديث التطبيق');
        error.code = 'BACKUP_QUARANTINE_UNAVAILABLE';
        throw error;
    }
    const insert = db.prepare(
        `INSERT INTO sync_quarantine(row_sync_id, table_name, operation, contract_version, reason, item_json)
         VALUES(?, ?, 'PUT', ?, ?, ?)
         ON CONFLICT(row_sync_id) DO UPDATE SET reason = excluded.reason, item_json = excluded.item_json,
             retry_count = sync_quarantine.retry_count + 1, last_attempt_at = CURRENT_TIMESTAMP`
    );
    for (const item of unsafeRows) {
        const rowId = item.row.id ?? item.row_sync_id ?? JSON.stringify(item.row);
        const rowSyncId = `backup:${item.backupId}:${item.tableName}:${rowId}`;
        insert.run(
            rowSyncId,
            item.tableName,
            getContractVersion(item.tableName),
            `backup_restore:${item.reason}`,
            JSON.stringify({ source: 'backup_restore', tableName: item.tableName, data: item.row })
        );
    }
    return unsafeRows.length;
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
            const cycleInventory = getCycleInventory(database);
            const contractVersions = getContractInventory();

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
                    formatVersion: BACKUP_FORMAT_VERSION,
                    dbBase64: fileBuffer.toString('base64'),
                    byteLength: fileBuffer.length,
                    createdAt: new Date().toISOString(),
                    cycleInventory: cycleInventory.cycles,
                    cycleInventoryKnown: cycleInventory.known,
                    contractVersions
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
            // The restored file may have a different schema than the one whose columns the
            // sync layer cached; a stale cache would misjudge which columns exist.
            const { clearSchemaColumnsCache } = require('../sync/engine/helpers');
            const fs = require('fs');
            const currentDb = getDb();
            const currentInventory = getCycleInventory(currentDb);

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

            const backupId = createHash('sha256').update(buffer).digest('hex').slice(0, 24);

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
                if (result && result !== 'ok') {
                    testDb.close();
                    throw new Error(`SQLite quick_check failed: ${result}`);
                }
                const backupInventory = getCycleInventory(testDb);
                const declared = getDeclaredBackupMetadata(payload);
                validateDeclaredInventory(declared.cycleInventory, backupInventory);
                validateCycleInventory(currentInventory, backupInventory, { replaceAllCycles: payload?.replaceAllCycles === true });
                const unsafeRows = getUnsafeCycleRows(testDb, 'main', backupId, cycleCodes(backupInventory));
                if (unsafeRows.length) {
                    const quarantinedCount = quarantineRows(currentDb, unsafeRows);
                    testDb.close();
                    return { success: false, code: 'BACKUP_UNSAFE_CYCLE_ROWS_QUARANTINED', error: 'توجد سجلات بلا سلك؛ تم وضعها في الحجر ولم تتم الاستعادة', quarantinedCount };
                }
                testDb.close();
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
                clearSchemaColumnsCache();

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
                    clearSchemaColumnsCache();
                    console.log('[backup] restoreDb: rolled back to previous database');
                }

                throw postRestoreError;
            }
        } catch (err) {
            console.error('[backup] restoreDb: FINAL ERROR —', err.message);
            const safetyResponse = backupSafetyResponse(err);
            if (safetyResponse) return safetyResponse;
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
            const backupId = createHash('sha256').update(buffer).digest('hex').slice(0, 24);
            const db = getDb();
            const currentInventory = getCycleInventory(db);
            const expectedByteLength = Number(payload?.expectedByteLength || 0);
            if (!buffer.length) {
                return { success: false, error: 'Invalid backup payload' };
            }
            if (expectedByteLength > 0 && buffer.length !== expectedByteLength) {
                return { success: false, error: 'Backup payload size mismatch' };
            }

            fs.writeFileSync(tempPath, buffer);
            const testDb = new Database(tempPath, { readonly: true });
            let backupInventory;
            let unsafeRows;
            try {
                const quickCheck = testDb.pragma('quick_check');
                const result = quickCheck[0]?.quick_check;
                if (result && result !== 'ok') {
                    return { success: false, error: `SQLite quick_check failed: ${result}` };
                }
                backupInventory = getCycleInventory(testDb);
                const declared = getDeclaredBackupMetadata(payload);
                validateDeclaredInventory(declared.cycleInventory, backupInventory);
                validateCycleInventory(currentInventory, backupInventory, { replaceAllCycles: payload?.replaceAllCycles === true });
                unsafeRows = getUnsafeCycleRows(testDb, 'main', backupId, cycleCodes(backupInventory));
            } finally {
                testDb.close();
            }

            db.prepare('ATTACH DATABASE ? AS backup_content').run(tempPath);
            attached = true;

            const restoredTables = [];
            const skippedTables = [];
            let quarantinedCount = 0;
            const previousForeignKeys = db.pragma('foreign_keys', { simple: true });
            db.pragma('foreign_keys = OFF');

            try {
                db.prepare('BEGIN IMMEDIATE').run();
                quarantinedCount = quarantineRows(db, unsafeRows || []);

                for (const tableName of CONTENT_RESTORE_TABLES) {
                    if (!tableExists(db, 'main', tableName) || !tableExists(db, 'backup_content', tableName)) {
                        skippedTables.push(tableName);
                        continue;
                    }

                    const mainColumns = getColumnNames(db, 'main', tableName);
                    const backupColumnNames = getColumnNames(db, 'backup_content', tableName);
                    const backupColumns = new Set(backupColumnNames);
                    const isCycleRequired = CYCLE_REQUIRED_TABLES.includes(tableName);
                    if (isCycleRequired && !mainColumns.includes('cycle_code')) {
                        const rows = db.prepare(`SELECT * FROM backup_content.${quoteIdent(tableName)}`).all();
                        const destinationUnsafe = rows.map((row) => ({ tableName, row, reason: 'destination_missing_cycle_code_column', backupId }));
                        quarantinedCount += quarantineRows(db, destinationUnsafe);
                        skippedTables.push(tableName);
                        continue;
                    }
                    if (isCycleRequired && !backupColumns.has('cycle_code')) {
                        skippedTables.push(tableName);
                        continue;
                    }

                    const columns = mainColumns.filter((column) => backupColumns.has(column));
                    if (!columns.length) {
                        skippedTables.push(tableName);
                        continue;
                    }

                    const quotedTable = quoteIdent(tableName);
                    const quotedColumns = columns.map(quoteIdent).join(', ');
                    let safePredicate = '';
                    let safeParams = [];
                    if (isCycleRequired) {
                        const validCodes = [...cycleCodes(backupInventory)];
                        if (!validCodes.length) {
                            skippedTables.push(tableName);
                            continue;
                        }
                        safePredicate = ` WHERE cycle_code IS NOT NULL AND TRIM(cycle_code) <> '' AND cycle_code IN (${validCodes.map(() => '?').join(', ')})`;
                        safeParams = validCodes;
                        const safeCount = db.prepare(`SELECT COUNT(*) AS count FROM backup_content.${quotedTable}${safePredicate}`).get(...safeParams).count;
                        if (!safeCount) {
                            skippedTables.push(tableName);
                            continue;
                        }
                    }
                    db.prepare(`DELETE FROM main.${quotedTable}`).run();
                    db.prepare(
                        `
                        INSERT INTO main.${quotedTable}(${quotedColumns})
                        SELECT ${quotedColumns}
                        FROM backup_content.${quotedTable}${safePredicate}
                    `
                    ).run(...safeParams);
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
                quarantinedCount,
                restoredItems: restoredTables.length
            };
        } catch (err) {
            console.error('[backup] restoreDbContent: FAILED —', err.message);
            const safetyResponse = backupSafetyResponse(err);
            if (safetyResponse) return safetyResponse;
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

module.exports = {
    registerSystemBackupIpc,
    getCycleInventory,
    getContractInventory,
    validateCycleInventory,
    getDeclaredBackupMetadata,
    getUnsafeCycleRows,
    quarantineRows
};
