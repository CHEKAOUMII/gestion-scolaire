// Sync capture layer - Phase 1

const { getDb } = require('../db/context');
const { collectCurrentFingerprint } = require('../licensing/deviceFingerprint');

let _cachedDeviceHash = null;
let _cachedDeviceName = null;

const SENSITIVE_FIELDS = ['password_hash', 'pin_hash'];

/**
 * Channel-to-table registry.
 * Maps every write IPC channel to its affected table(s) and capture metadata.
 *
 * Fields per entry:
 *   tables:      string[]  - database table(s) written by this channel
 *   operation:   string    - 'PUT' | 'DEL' | 'UPSERT' | 'MIXED'
 *   idExtractor: string    - strategy for obtaining the affected row ID(s):
 *       'lastInsertRowid'       - use better-sqlite3 lastInsertRowid (for INSERTs)
 *       'argId'                 - extract `id` from handler arguments
 *       'argIdOrLastInsert'     - use arg.id if present (UPDATE), else lastInsertRowid (INSERT)
 *       'argKey'                - extract `key` from handler arguments (settings key-value)
 *       'literal'               - fixed/known key (e.g., settings:setSchoolYear always writes 'currentSchoolYear')
 *       'compositeKey'          - extract composite key fields from arguments
 *       'inputArray'            - iterate input array for bulk operations
 *       'preQuery'              - SELECT affected IDs before handler runs (for DELETEs)
 *       'preQuery+bulk'         - preQuery for deletes + bulk for inserts (mixed ops)
 *       'lastInsertRowid+conditional' - lastInsertRowid + conditional secondary table write
 *       'queryMatch'            - query matching rows by criteria after operation
 *   preCapture:  boolean   - true if IDs must be collected BEFORE handler runs
 *   bulk:        boolean   - true if handler processes multiple rows
 *   exclude:     boolean   - true to skip capture (read-only channels using handleWrite)
 */
const CHANNEL_REGISTRY = {
    // === absences.js ===
    'absences:save': { tables: ['absences'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'absences:saveBulk': { tables: ['absences'], operation: 'UPSERT', idExtractor: 'inputArray', bulk: true },
    'absences:delete': { tables: ['absences'], operation: 'DEL', idExtractor: 'argId' },
    'absences:deleteByYear': {
        tables: ['absences'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },
    'correspondence:save': { tables: ['correspondence'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'correspondence:markPrinted': { tables: ['correspondence'], operation: 'PUT', idExtractor: 'argId' },

    // === exams.js ===
    'exams:save': { tables: ['exams'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'exams:delete': { tables: ['exams'], operation: 'DEL', idExtractor: 'argId' },
    'examProctors:saveManual': { tables: ['exam_proctors'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'examProctors:generateRoundRobin': {
        tables: ['exam_proctors'],
        operation: 'MIXED',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true
    },
    'examProctors:delete': { tables: ['exam_proctors'], operation: 'DEL', idExtractor: 'argId' },
    'examRooms:save': { tables: ['exam_rooms'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'examRooms:delete': { tables: ['exam_rooms'], operation: 'DEL', idExtractor: 'argId' },
    'tests:save': { tables: ['tests'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'tests:delete': { tables: ['tests'], operation: 'DEL', idExtractor: 'argId' },

    // === schoolOps.js ===
    'studentFiles:upsert': { tables: ['student_files'], operation: 'UPSERT', idExtractor: 'compositeKey' },
    'studentFiles:upsertBulk': {
        tables: ['student_files'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true
    },
    'studentFiles:setDocumentStatus': {
        tables: ['student_files'],
        operation: 'UPSERT',
        idExtractor: 'compositeKey'
    },
    'studentMovements:add': {
        tables: ['student_movements', 'students'],
        operation: 'MIXED',
        idExtractor: 'lastInsertRowid+conditional'
    },

    // === staff.js ===
    'teachers:add': { tables: ['teachers', 'teacher_aliases'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'teachers:update': { tables: ['teachers', 'teacher_aliases'], operation: 'PUT', idExtractor: 'argId' },
    'teachers:delete': {
        tables: [
            'teachers',
            'teacher_aliases',
            'grades',
            'tests',
            'staff_attendance',
            'exam_proctors',
            'compensation_tracking',
            'teacher_absences'
        ],
        operation: 'MIXED',
        idExtractor: 'preQuery',
        preCapture: true
    },
    'teachers:deleteByYear': {
        tables: [
            'teachers',
            'teacher_aliases',
            'grades',
            'tests',
            'staff_attendance',
            'exam_proctors',
            'compensation_tracking',
            'teacher_absences'
        ],
        operation: 'MIXED',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },
    'teachers:saveTafwijAliases': {
        tables: ['teacher_aliases'],
        operation: 'PUT',
        idExtractor: 'inputArray',
        bulk: true
    },
    'teachers:importBulk': {
        tables: ['teachers', 'teacher_aliases'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true
    },
    'teacherAbsences:save': { tables: ['teacher_absences'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'teacherAbsences:delete': { tables: ['teacher_absences'], operation: 'DEL', idExtractor: 'argId' },
    'schoolEvents:save': { tables: ['school_events'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'schoolEvents:delete': { tables: ['school_events'], operation: 'DEL', idExtractor: 'argId' },
    'compensation:saveBatch': {
        tables: ['compensation_tracking'],
        operation: 'PUT',
        idExtractor: 'inputArray',
        bulk: true
    },
    'compensation:toggleCompensated': { tables: ['compensation_tracking'], operation: 'PUT', idExtractor: 'argId' },
    'supportSessions:add': { tables: ['support_sessions'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'supportSessions:delete': { tables: ['support_sessions'], operation: 'DEL', idExtractor: 'argId' },
    'supportSessions:import': { tables: ['support_sessions'], operation: 'UPSERT', idExtractor: 'inputArray', bulk: true },

    // === students.js ===
    'students:add': { tables: ['students'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'students:addBulk': { tables: ['students'], operation: 'UPSERT', idExtractor: 'inputArray', bulk: true },
    'students:update': { tables: ['students'], operation: 'PUT', idExtractor: 'argId' },
    'students:delete': { tables: ['students'], operation: 'DEL', idExtractor: 'argId' },
    'students:deleteByYear': {
        tables: ['students', 'grades', 'absences', 'correspondence', 'student_files', 'student_movements'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },
    'students:updateStatusBulk': { tables: ['students'], operation: 'PUT', idExtractor: 'inputArray', bulk: true },
    'settings:set': { tables: ['settings'], operation: 'PUT', idExtractor: 'argKey' },
    'settings:setSchoolYear': { tables: ['settings'], operation: 'PUT', idExtractor: 'literal' },
    'grades:save': { tables: ['grades'], operation: 'PUT', idExtractor: 'compositeKey' },
    'grades:saveBulk': { tables: ['grades'], operation: 'PUT', idExtractor: 'inputArray', bulk: true },
    'grades:reassignTeacherBulk': { tables: ['grades'], operation: 'PUT', idExtractor: 'queryMatch', bulk: true },
    'grades:deleteByYear': {
        tables: ['grades'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },
    'grades:deleteBySemester': {
        tables: ['grades'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },

    // === staffAttendance.js ===
    'staffAttendance:save': { tables: ['staff_attendance'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'staffAttendance:delete': { tables: ['staff_attendance'], operation: 'DEL', idExtractor: 'argId' },

    // === system.js ===
    'users:getAll': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },

    // === pageVisibility.js ===
    'pageVisibility:setVisibility': { tables: ['page_visibility'], operation: 'PUT', idExtractor: 'argKey' },

    // === sync.js ===
    'sync:setConfig': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'sync:triggerNow': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'sync:resolveConflict': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'sync:testConnection': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },

    // === linking.js ===
    'linking:setup-new-institution': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'linking:verify-and-link': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'linking:generateOtp': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'linking:cancelOtp': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'linking:getOtpStatus': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'linking:getLinkedDevices': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'linking:revokeDevice': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'linking:getCurrentDevice': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    device_revocation: { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true }
};

const KNOWN_CAPTURE_TABLES = new Set(
    Object.values(CHANNEL_REGISTRY)
        .flatMap((entry) => entry.tables || [])
        .filter(Boolean)
);

function getDeviceHash() {
    if (!_cachedDeviceHash) {
        try {
            const fp = collectCurrentFingerprint();
            _cachedDeviceHash = fp.deviceHash;
            _cachedDeviceName = fp.deviceName;
        } catch {
            // Fallback: use a random hash if fingerprinting fails
            _cachedDeviceHash = require('crypto').randomBytes(16).toString('hex');
            _cachedDeviceName = require('os').hostname();
        }
    }
    return _cachedDeviceHash;
}

function getDeviceName() {
    if (!_cachedDeviceName) {
        getDeviceHash(); // populates both
    }
    return _cachedDeviceName;
}

function ensureSyncIdMapping(db, tableName, localId) {
    const deviceHash = getDeviceHash();
    const rowSyncId = `${deviceHash}:${tableName}:${localId}`;

    db.prepare(
        `
        INSERT OR IGNORE INTO sync_id_map(row_sync_id, table_name, local_id)
        VALUES(?, ?, ?)
    `
    ).run(rowSyncId, tableName, localId);

    return rowSyncId;
}

function stripSensitiveFields(rowData) {
    if (!rowData || typeof rowData !== 'object') return rowData;
    const cleaned = { ...rowData };
    for (const field of SENSITIVE_FIELDS) {
        delete cleaned[field];
    }
    return cleaned;
}

function recordOutboxEntry(db, tableName, localId, operation, rowData, schoolYear) {
    const rowSyncId = ensureSyncIdMapping(db, tableName, localId);
    const cleanedData = operation === 'DEL' ? null : stripSensitiveFields(rowData);

    db.prepare(
        `
        INSERT INTO sync_outbox(table_name, row_sync_id, operation, row_data, school_year, status, retries)
        VALUES(?, ?, ?, ?, ?, 'pending', 0)
    `
    ).run(tableName, rowSyncId, operation, cleanedData ? JSON.stringify(cleanedData) : null, schoolYear || null);
}

function recordOutboxEntries(db, entries) {
    // entries = [{ tableName, localId, operation, rowData, schoolYear }, ...]
    const txn = db.transaction(() => {
        for (const entry of entries) {
            recordOutboxEntry(db, entry.tableName, entry.localId, entry.operation, entry.rowData, entry.schoolYear);
        }
    });
    txn();
}

/**
 * Wraps an existing ipcMain.handle callback to capture write operations
 * into the sync_outbox after the original handler succeeds.
 *
 * @param {string} channel - IPC channel name
 * @param {Function} originalHandler - the original ipcMain.handle callback
 * @returns {Function} wrapped handler
 */
function wrapWithSyncCapture(channel, originalHandler) {
    const registryEntry = CHANNEL_REGISTRY[channel];

    // Skip channels not in registry or explicitly excluded
    if (!registryEntry || registryEntry.exclude) {
        return originalHandler;
    }

    return async function wrappedHandler(event, ...args) {
        // Run the original handler first — if it throws, we do not capture
        const result = await originalHandler(event, ...args);

        // Only capture if the handler succeeded
        // Convention: handlers return { success: false, ... } on failure
        if (result && result.success === false) {
            return result;
        }

        // Capture in a try/catch — never disrupt the original result
        try {
            const db = getDb();
            captureAfterWrite(db, channel, registryEntry, args, result);
        } catch (captureErr) {
            // FR-014: Silently persist the error, never throw
            try {
                const db = getDb();
                db.prepare(
                    `
                    UPDATE sync_config
                    SET last_capture_error = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = 1
                `
                ).run(`[${channel}] ${captureErr.message}`);
            } catch {
                // Even error logging failed — silently ignore
            }
        }

        return result;
    };
}

/**
 * Extracts row data and records outbox entries based on the registry entry's
 * idExtractor strategy. This handles simple single-row operations.
 * Complex extractors (preQuery, inputArray, bulk) are handled with
 * simplified fallback — they record a summary entry for Phase 3 to process.
 */
function captureAfterWrite(db, channel, entry, handlerArgs, handlerResult) {
    const tableName = entry.tables[0]; // primary table
    const schoolYear = extractSchoolYear(handlerArgs);

    switch (entry.idExtractor) {
        case 'lastInsertRowid': {
            // The handler just did an INSERT. Query lastInsertRowid from result
            // or re-read the row. For safety, query the last inserted row.
            const lastId = getLastInsertId(db, tableName, handlerResult);
            if (lastId) {
                const rowData = fetchRowById(db, tableName, lastId);
                recordOutboxEntry(db, tableName, lastId, 'PUT', rowData, schoolYear);
            }
            break;
        }
        case 'argId': {
            const id = extractIdFromArgs(handlerArgs);
            if (id) {
                if (entry.operation === 'DEL') {
                    recordOutboxEntry(db, tableName, id, 'DEL', null, schoolYear);
                } else {
                    const rowData = fetchRowById(db, tableName, id);
                    recordOutboxEntry(db, tableName, id, 'PUT', rowData, schoolYear);
                }
            }
            break;
        }
        case 'argIdOrLastInsert': {
            // Check if args contain an id (UPDATE) or not (INSERT)
            const id = extractIdFromArgs(handlerArgs);
            if (id) {
                const rowData = fetchRowById(db, tableName, id);
                recordOutboxEntry(db, tableName, id, 'PUT', rowData, schoolYear);
            } else {
                const lastId = getLastInsertId(db, tableName, handlerResult);
                if (lastId) {
                    const rowData = fetchRowById(db, tableName, lastId);
                    recordOutboxEntry(db, tableName, lastId, 'PUT', rowData, schoolYear);
                }
            }
            break;
        }
        case 'argKey': {
            // Settings-style: key is the identifier
            const key = extractKeyFromArgs(handlerArgs);
            if (key) {
                const rowData = fetchRowByKey(db, tableName, key);
                const localId = rowData ? rowData.id || hashStringToInt(key) : hashStringToInt(key);
                recordOutboxEntry(db, tableName, localId, 'PUT', rowData, schoolYear);
            }
            break;
        }
        case 'literal': {
            // settings:setSchoolYear — always writes the key 'currentSchoolYear'
            const key = 'currentSchoolYear';
            const rowData = fetchRowByKey(db, 'settings', key);
            const localId = hashStringToInt(key);
            recordOutboxEntry(db, 'settings', localId, 'PUT', rowData, schoolYear);
            break;
        }
        case 'compositeKey': {
            // For tables with composite unique keys (grades, student_files)
            // Re-query the affected row using args
            const compositeData = extractCompositeFromArgs(handlerArgs, tableName);
            if (compositeData && compositeData.id) {
                const rowData = fetchRowById(db, tableName, compositeData.id);
                recordOutboxEntry(db, tableName, compositeData.id, 'PUT', rowData, schoolYear);
            }
            break;
        }
        case 'inputArray':
        case 'queryMatch':
        case 'preQuery':
        case 'preQuery+bulk':
        case 'lastInsertRowid+conditional': {
            // Complex extractors — for Phase 1, record a simplified summary entry
            // using the primary table. Phase 3 will implement full per-row extraction.
            // For now, mark the channel as needing enhanced capture.
            recordBulkSummary(db, channel, entry, handlerArgs, schoolYear);
            break;
        }
        default:
            // Unknown extractor — skip silently
            break;
    }
}

// ---- Helper functions for captureAfterWrite ----

function extractSchoolYear(handlerArgs) {
    // Scan handler arguments for a schoolYear or school_year field
    for (const arg of handlerArgs) {
        if (arg && typeof arg === 'object') {
            if (arg.schoolYear) return arg.schoolYear;
            if (arg.school_year) return arg.school_year;
        }
        if (typeof arg === 'string' && /^\d{4}\/\d{4}$/.test(arg)) {
            return arg;
        }
    }
    return null;
}

function extractIdFromArgs(handlerArgs) {
    for (const arg of handlerArgs) {
        if (typeof arg === 'number') return arg;
        if (arg && typeof arg === 'object' && arg.id) return arg.id;
    }
    return null;
}

function extractKeyFromArgs(handlerArgs) {
    for (const arg of handlerArgs) {
        if (typeof arg === 'string' && arg.length > 0 && !/^\d{4}\/\d{4}$/.test(arg)) {
            return arg;
        }
        if (arg && typeof arg === 'object' && arg.key) return arg.key;
        if (arg && typeof arg === 'object' && arg.page_key) return arg.page_key;
    }
    return null;
}

function extractCompositeFromArgs(handlerArgs, tableName) {
    // Try to re-query the row using known composite key patterns
    const db = getDb();
    for (const arg of handlerArgs) {
        if (!arg || typeof arg !== 'object') continue;

        if (tableName === 'grades' && arg.student_code && arg.subject && arg.semester) {
            const row = db
                .prepare(
                    `
                SELECT * FROM grades
                WHERE student_code = ? AND subject = ? AND semester = ? AND school_year = ?
            `
                )
                .get(arg.student_code, arg.subject, arg.semester, arg.school_year || '');
            return row;
        }
        if (tableName === 'student_files' && arg.student_id && arg.doc_key) {
            const row = db
                .prepare(
                    `
                SELECT * FROM student_files
                WHERE student_id = ? AND doc_key = ? AND school_year = ?
            `
                )
                .get(arg.student_id, arg.doc_key, arg.school_year || '');
            return row;
        }
    }
    return null;
}

function getLastInsertId(db, _tableName, handlerResult) {
    // Try to get ID from handler result first
    if (handlerResult && typeof handlerResult === 'object') {
        if (handlerResult.id) return handlerResult.id;
        if (handlerResult.lastInsertRowid) return handlerResult.lastInsertRowid;
        if (handlerResult.data && handlerResult.data.id) return handlerResult.data.id;
    }
    // Fallback: query SQLite for last insert rowid.
    // This remains best-effort for handlers that do not return an inserted ID.
    // Multi-table insert handlers should expose the primary row ID explicitly to
    // avoid ambiguity about which table wrote the last rowid.
    const row = db.prepare('SELECT last_insert_rowid() as id').get();
    return row ? row.id : null;
}

function fetchRowById(db, tableName, id) {
    try {
        // Validate tableName to prevent SQL injection (only known table names)
        if (!isKnownTable(tableName)) return null;
        const row = db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`).get(id);
        return row || null;
    } catch {
        return null;
    }
}

function fetchRowByKey(db, tableName, key) {
    try {
        if (tableName === 'settings') {
            return db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
        }
        if (tableName === 'page_visibility') {
            return db.prepare('SELECT * FROM page_visibility WHERE page_key = ?').get(key);
        }
        return null;
    } catch {
        return null;
    }
}

function hashStringToInt(str) {
    // Simple hash for string-keyed tables (settings, page_visibility)
    // Produces a stable positive integer from a string
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

function isKnownTable(tableName) {
    return KNOWN_CAPTURE_TABLES.has(tableName);
}

function recordBulkSummary(db, channel, entry, handlerArgs, schoolYear) {
    // Phase 1 foundation behavior for complex extractors:
    // record a summary placeholder entry on the primary table instead of trying
    // to guess per-row IDs for bulk or multi-table handlers. Later sync phases
    // must revisit `_bulk: true` entries for row-level extraction before push
    // logic relies on FR-013-style per-row completeness.
    const tableName = entry.tables[0];
    const deviceHash = getDeviceHash();
    const timestamp = Date.now();
    const summaryId = `${deviceHash}:${tableName}:bulk_${timestamp}`;

    db.prepare(
        `
        INSERT INTO sync_outbox(table_name, row_sync_id, operation, row_data, school_year, status, retries)
        VALUES(?, ?, ?, ?, ?, 'pending', 0)
    `
    ).run(
        tableName,
        summaryId,
        entry.operation === 'DEL' ? 'DEL' : 'PUT',
        JSON.stringify({ _bulk: true, channel, args_summary: summarizeArgs(handlerArgs) }),
        schoolYear
    );
}

function summarizeArgs(handlerArgs) {
    // Create a safe summary of handler args for bulk logging
    // Avoid serializing huge arrays — just record count and type
    const summary = {};
    for (let i = 0; i < handlerArgs.length; i++) {
        const arg = handlerArgs[i];
        if (Array.isArray(arg)) {
            summary[`arg${i}`] = { type: 'array', length: arg.length };
        } else if (arg && typeof arg === 'object') {
            summary[`arg${i}`] = { type: 'object', keys: Object.keys(arg).slice(0, 10) };
        } else {
            summary[`arg${i}`] = arg;
        }
    }
    return summary;
}

let _cleanupTimer = null;

function runOutboxCleanup(db) {
    try {
        const config = db.prepare('SELECT retention_days FROM sync_config WHERE id = 1').get();
        const days = (config && config.retention_days) || 7;
        db.prepare(
            `
            DELETE FROM sync_outbox WHERE created_at < datetime('now', '-' || ? || ' days')
        `
        ).run(days);
    } catch {
        // Silently ignore cleanup errors
    }
}

function startOutboxCleanup() {
    if (_cleanupTimer) return;

    try {
        const db = getDb();
        // Run cleanup immediately on startup
        runOutboxCleanup(db);

        // Then every 6 hours
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        _cleanupTimer = setInterval(() => {
            try {
                const db = getDb();
                runOutboxCleanup(db);
            } catch {
                // Silently ignore
            }
        }, SIX_HOURS);

        // Don't block process exit
        if (typeof _cleanupTimer.unref === 'function') {
            _cleanupTimer.unref();
        }
    } catch {
        // Silently ignore startup errors
    }
}

function stopOutboxCleanup() {
    if (_cleanupTimer) {
        clearInterval(_cleanupTimer);
        _cleanupTimer = null;
    }
}

module.exports = {
    CHANNEL_REGISTRY,
    SENSITIVE_FIELDS,
    ensureSyncIdMapping,
    getDeviceHash,
    getDeviceName,
    recordOutboxEntries,
    recordOutboxEntry,
    startOutboxCleanup,
    stopOutboxCleanup,
    stripSensitiveFields,
    wrapWithSyncCapture
};
