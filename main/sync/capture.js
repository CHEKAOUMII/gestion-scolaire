// Sync capture layer - Phase 1

const { getDb } = require('../db/context');
const { collectCurrentFingerprint } = require('../licensing/deviceFingerprint');

let _cachedDeviceHash = null;
let _cachedDeviceName = null;
let _pushDebounceTimer = null;

const SENSITIVE_FIELDS = ['password_hash', 'pin_hash'];
const PUSH_DEBOUNCE_MS = 8000;

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
    'examProctors:saveManual': { tables: ['exam_proctors'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'examProctors:generateRoundRobin': {
        tables: ['exam_proctors'],
        operation: 'MIXED',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true
    },
    'examProctors:delete': { tables: ['exam_proctors'], operation: 'DEL', idExtractor: 'argId' },
    'examProctors:bulkImport': {
        tables: ['exam_proctors'],
        operation: 'MIXED',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true
    },
    'examProctors:deleteAll': {
        tables: ['exam_proctors'],
        operation: 'MIXED',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true
    },
    'examRooms:save': { tables: ['exam_rooms'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'examRooms:delete': { tables: ['exam_rooms'], operation: 'DEL', idExtractor: 'argId' },
    'tests:save': { tables: ['tests'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'tests:delete': { tables: ['tests'], operation: 'DEL', idExtractor: 'argId' },
    'examInvitations:upsert': { tables: ['exam_invitations'], operation: 'UPSERT', idExtractor: 'argIdOrLastInsert' },
    'examInvitations:delete': { tables: ['exam_invitations'], operation: 'DEL', idExtractor: 'argId' },
    'examInvitations:deleteAll': {
        tables: ['exam_invitations'],
        operation: 'MIXED',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true
    },
    'examAttendance:upsert': { tables: ['exam_attendance'], operation: 'UPSERT', idExtractor: 'argIdOrLastInsert' },
    'examAttendance:bulkUpsert': {
        tables: ['exam_attendance'],
        operation: 'UPSERT',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true
    },
    'examAttendance:delete': { tables: ['exam_attendance'], operation: 'DEL', idExtractor: 'argId' },
    'examAttendance:deleteAll': {
        tables: ['exam_attendance'],
        operation: 'MIXED',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true
    },

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
    'teachers:saveNameAlias': { tables: ['name_aliases'], operation: 'UPSERT', idExtractor: 'argIdOrLastInsert' },
    'teachers:deleteNameAlias': { tables: ['name_aliases'], operation: 'DEL', idExtractor: 'argId' },
    'teacherAbsences:save': { tables: ['teacher_absences'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'teacherAbsences:delete': { tables: ['teacher_absences'], operation: 'DEL', idExtractor: 'argId' },
    'schoolEvents:save': { tables: ['school_events'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'schoolEvents:delete': { tables: ['school_events'], operation: 'DEL', idExtractor: 'argId' },
    'systemTags:save': { tables: ['system_tags'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'systemTags:saveNote': { tables: ['system_tags'], operation: 'PUT', idExtractor: 'inputArray', bulk: true },
    'systemTags:delete': { tables: ['system_tags'], operation: 'DEL', idExtractor: 'argId' },
    'systemTags:deleteByGroup': {
        tables: ['system_tags'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true
    },
    'compensation:saveBatch': {
        tables: ['compensation_tracking'],
        operation: 'PUT',
        idExtractor: 'inputArray',
        bulk: true
    },
    'compensation:toggleCompensated': { tables: ['compensation_tracking'], operation: 'PUT', idExtractor: 'argId' },
    'supportSessions:add': { tables: ['support_sessions'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'supportSessions:delete': { tables: ['support_sessions'], operation: 'DEL', idExtractor: 'argId' },
    'supportSessions:import': {
        tables: ['support_sessions'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true
    },

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
    'studentProfile:saveTab': { tables: ['student_profile_data'], operation: 'UPSERT', idExtractor: 'compositeKey' },
    'studentProfile:saveRiskSnapshot': {
        tables: ['student_risk_snapshot'],
        operation: 'UPSERT',
        idExtractor: 'compositeKey'
    },
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
    'staffAttendance:update': { tables: ['staff_attendance'], operation: 'PUT', idExtractor: 'argId' },
    'staffAttendance:delete': { tables: ['staff_attendance'], operation: 'DEL', idExtractor: 'argId' },

    // === inspectors.js ===
    'inspectors:add': { tables: ['inspectors'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'inspectors:update': { tables: ['inspectors'], operation: 'PUT', idExtractor: 'argId' },
    'inspectors:delete': { tables: ['inspectors'], operation: 'DEL', idExtractor: 'argId' },

    // === system.js ===
    'users:getAll': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },

    // === pageVisibility.js ===
    'pageVisibility:setVisibility': { tables: ['page_visibility'], operation: 'PUT', idExtractor: 'argKey' },

    // === appDefaults.js (bulk matrix saves — exclude full rewrite from fine-grained outbox) ===
    'appDefaults:saveExamCounts': {
        tables: ['exam_count_rules'],
        operation: 'PUT',
        idExtractor: 'none',
        exclude: true
    },
    'appDefaults:savePageAccess': {
        tables: ['page_role_access'],
        operation: 'PUT',
        idExtractor: 'none',
        exclude: true
    },

    // === sync.js ===
    'sync:setConfig': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'sync:triggerNow': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'sync:resolveConflict': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'sync:testConnection': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },

    // === timetable-data.js ===
    'timetableData:save': { tables: ['timetable_data'], operation: 'UPSERT', idExtractor: 'argKey', exclude: true },
    'timetableData:delete': { tables: ['timetable_data'], operation: 'DEL', idExtractor: 'argKey', exclude: true },

    // === exam-config-data.js ===
    'examConfigData:save': { tables: ['exam_config_data'], operation: 'UPSERT', idExtractor: 'argKey', exclude: true },
    'examConfigData:delete': { tables: ['exam_config_data'], operation: 'DEL', idExtractor: 'argKey', exclude: true },

    // === institution.js ===
    'institution:relink': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'institution:setup-new': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'institution:updateMassarCode': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'institution:submitIdentityChangeRequest': { tables: [], operation: 'POST', idExtractor: 'none', exclude: true },
    'institution:getIdentityChangeRequests': { tables: [], operation: 'GET', idExtractor: 'none', exclude: true },
    'institution:applyApprovedIdentityChange': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },

    // === app-admin.js ===
    'appAdmin:listIdentityChangeRequests': { tables: [], operation: 'GET', idExtractor: 'none', exclude: true },
    'appAdmin:approveIdentityChangeRequest': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'appAdmin:rejectIdentityChangeRequest': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true }
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
        } catch (fpErr) {
            console.warn('[sync:capture] Device fingerprinting failed, using random hash:', fpErr.message);
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
    const cleanedData = rowData ? stripSensitiveFields(rowData) : null;

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

function scheduleDebouncedPush() {
    if (_pushDebounceTimer) {
        clearTimeout(_pushDebounceTimer);
    }

    _pushDebounceTimer = setTimeout(() => {
        _pushDebounceTimer = null;
        try {
            const { flushSyncOutbox } = require('./engine');
            void flushSyncOutbox().catch((err) => {
                console.warn('[sync:capture] Debounced push failed:', err.message);
            });
        } catch (err) {
            console.warn('[sync:capture] Debounced push failed to start:', err.message);
        }
    }, PUSH_DEBOUNCE_MS);

    if (typeof _pushDebounceTimer.unref === 'function') {
        _pushDebounceTimer.unref();
    }
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
        const preCapturedRow = captureRowBeforeDelete(registryEntry, args);

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
            captureAfterWrite(db, channel, registryEntry, args, result, preCapturedRow);
            scheduleDebouncedPush();
        } catch (captureErr) {
            console.warn(`[sync:capture] Capture failed for channel '${channel}':`, captureErr.message);
            try {
                const db = getDb();
                db.prepare(
                    `
                    UPDATE sync_config
                    SET last_capture_error = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = 1
                `
                ).run(`[${channel}] ${captureErr.message}`);
            } catch (dbErr) {
                console.warn('[sync:capture] Failed to persist capture error:', dbErr.message);
            }
        }

        return result;
    };
}

function captureLastInsertRowid(db, tableName, _entry, handlerArgs, handlerResult, schoolYear) {
    const lastId = getLastInsertId(db, tableName, handlerResult);
    if (lastId) {
        recordOutboxEntry(db, tableName, lastId, 'PUT', fetchRowById(db, tableName, lastId), schoolYear);
    }
}

function captureRowBeforeDelete(registryEntry, handlerArgs) {
    if (registryEntry.operation !== 'DEL' || registryEntry.idExtractor !== 'argId') return null;
    try {
        const db = getDb();
        const tableName = registryEntry.tables[0];
        const id = extractIdFromArgs(handlerArgs);
        return id ? fetchRowById(db, tableName, id) : null;
    } catch {
        return null;
    }
}

function captureArgId(db, tableName, entry, handlerArgs, _handlerResult, schoolYear, preCapturedRow = null) {
    const id = extractIdFromArgs(handlerArgs);
    if (!id) return;
    if (entry.operation === 'DEL') {
        recordOutboxEntry(db, tableName, id, 'DEL', preCapturedRow, schoolYear);
    } else {
        recordOutboxEntry(db, tableName, id, 'PUT', fetchRowById(db, tableName, id), schoolYear);
    }
}

function captureArgIdOrLastInsert(db, tableName, _entry, handlerArgs, handlerResult, schoolYear) {
    const id = extractIdFromArgs(handlerArgs);
    if (id) {
        recordOutboxEntry(db, tableName, id, 'PUT', fetchRowById(db, tableName, id), schoolYear);
    } else {
        const lastId = getLastInsertId(db, tableName, handlerResult);
        if (lastId) {
            recordOutboxEntry(db, tableName, lastId, 'PUT', fetchRowById(db, tableName, lastId), schoolYear);
        }
    }
}

function captureArgKey(db, tableName, _entry, handlerArgs, _handlerResult, schoolYear) {
    const key = extractKeyFromArgs(handlerArgs);
    if (!key) return;
    const rowData = fetchRowByKey(db, tableName, key);
    const localId = rowData ? rowData.id || hashStringToInt(key) : hashStringToInt(key);
    recordOutboxEntry(db, tableName, localId, 'PUT', rowData, schoolYear);
}

function captureLiteral(db, _tableName, _entry, _handlerArgs, _handlerResult, schoolYear) {
    const key = 'currentSchoolYear';
    const rowData = fetchRowByKey(db, 'settings', key);
    recordOutboxEntry(db, 'settings', hashStringToInt(key), 'PUT', rowData, schoolYear);
}

function captureCompositeKey(db, tableName, _entry, handlerArgs, _handlerResult, schoolYear) {
    const compositeData = extractCompositeFromArgs(handlerArgs, tableName);
    if (compositeData?.id) {
        recordOutboxEntry(
            db,
            tableName,
            compositeData.id,
            'PUT',
            fetchRowById(db, tableName, compositeData.id),
            schoolYear
        );
    }
}

const EXTRACTOR_DISPATCH = {
    lastInsertRowid: captureLastInsertRowid,
    argId: captureArgId,
    argIdOrLastInsert: captureArgIdOrLastInsert,
    argKey: captureArgKey,
    literal: captureLiteral,
    compositeKey: captureCompositeKey
};

const BULK_EXTRACTORS = new Set([
    'inputArray',
    'queryMatch',
    'preQuery',
    'preQuery+bulk',
    'lastInsertRowid+conditional'
]);

function captureAfterWrite(db, channel, entry, handlerArgs, handlerResult, preCapturedRow = null) {
    const tableName = entry.tables[0];
    const schoolYear = extractSchoolYear(handlerArgs) || preCapturedRow?.school_year || null;
    const handler = EXTRACTOR_DISPATCH[entry.idExtractor];

    if (handler) {
        handler(db, tableName, entry, handlerArgs, handlerResult, schoolYear, preCapturedRow);
    } else if (BULK_EXTRACTORS.has(entry.idExtractor)) {
        recordBulkSummary(db, channel, entry, handlerArgs, schoolYear);
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
    if (!isKnownTable(tableName)) return null;
    try {
        return db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`).get(id) || null;
    } catch (err) {
        console.warn(`[sync:capture] fetchRowById failed for ${tableName} id=${id}:`, err.message);
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
    } catch (err) {
        console.warn(`[sync:capture] fetchRowByKey failed for ${tableName} key=${key}:`, err.message);
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

// Default retention window for the system_logs audit table (R2). Overridable at
// runtime via the 'systemLogsRetentionDays' key in the settings table.
const DEFAULT_SYSTEM_LOGS_RETENTION_DAYS = 90;

function runOutboxCleanup(db) {
    try {
        const config = db.prepare('SELECT retention_days FROM sync_config WHERE id = 1').get();
        const days = (config && config.retention_days) || 7;
        db.prepare(
            `
            DELETE FROM sync_outbox WHERE created_at < datetime('now', '-' || ? || ' days')
        `
        ).run(days);
    } catch (err) {
        console.warn('[sync:capture] Outbox cleanup failed:', err.message);
    }
}

// R2 — bound the unbounded, highest-write audit table. Keeps the most recent
// N days (default 90, configurable via the 'systemLogsRetentionDays' setting) so
// the audit log stays useful without growing forever.
function runSystemLogsCleanup(db) {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'systemLogsRetentionDays'").get();
        let days = Number(row && row.value);
        if (!Number.isFinite(days) || days <= 0) {
            days = DEFAULT_SYSTEM_LOGS_RETENTION_DAYS;
        }
        db.prepare(`DELETE FROM system_logs WHERE created_at < datetime('now', '-' || ? || ' days')`).run(days);
    } catch (err) {
        console.warn('[sync:capture] system_logs cleanup failed:', err.message);
    }
}

// R9 — bulk-purge sync_snapshots rows whose row_sync_id no longer maps to a live
// local row (sync_id_map). Point-deletes happen inline during snapshot cycles, but
// nothing swept orphans left behind by out-of-band deletions; this closes that gap
// on the same maintenance cadence.
function runSyncSnapshotsOrphanPurge(db) {
    try {
        db.prepare(
            `
            DELETE FROM sync_snapshots
            WHERE row_sync_id NOT IN (SELECT row_sync_id FROM sync_id_map)
        `
        ).run();
    } catch (err) {
        console.warn('[sync:capture] sync_snapshots orphan purge failed:', err.message);
    }
}

function runMaintenanceCleanup(db) {
    runOutboxCleanup(db);
    runSystemLogsCleanup(db);
    runSyncSnapshotsOrphanPurge(db);
}

function startOutboxCleanup() {
    if (_cleanupTimer) return;

    try {
        const db = getDb();
        runMaintenanceCleanup(db);

        const SIX_HOURS = 6 * 60 * 60 * 1000;
        _cleanupTimer = setInterval(() => {
            try {
                const db = getDb();
                runMaintenanceCleanup(db);
            } catch (err) {
                console.warn('[sync:capture] Periodic outbox cleanup failed:', err.message);
            }
        }, SIX_HOURS);

        if (typeof _cleanupTimer.unref === 'function') {
            _cleanupTimer.unref();
        }
    } catch (err) {
        console.warn('[sync:capture] Failed to start outbox cleanup:', err.message);
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
