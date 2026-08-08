// Sync capture layer - Phase 1

const { getDb: defaultGetDb } = require('../db/context');
const { collectCurrentFingerprint } = require('../licensing/deviceFingerprint');

let _cachedDeviceHash = null;
let _cachedDeviceName = null;
let _pushDebounceTimer = null;

/** Injectable DB accessor (default: main process singleton). Override in unit tests. */
let _getDb = defaultGetDb;

function getCaptureDb() {
    return _getDb();
}

/**
 * Override the database resolver used by capture helpers.
 * Pass a function, or null/undefined to restore the default getDb().
 * @param {(() => any) | null | undefined} fn
 */
function setCaptureGetDb(fn) {
    _getDb = typeof fn === 'function' ? fn : defaultGetDb;
}

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
 *   captureMode: 'wrapper' | 'explicit' — explicit = handler/repo writes outbox atomically
 */
const CHANNEL_REGISTRY = {
    // === absences.js ===
    'absences:save': { tables: ['absences'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'absences:saveBulk': {
        tables: ['absences'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true,
        localKeyFields: ['school_year', 'student_code', 'month', 'absence_type']
    },
    'absences:delete': { tables: ['absences'], operation: 'DEL', idExtractor: 'argId' },
    'absences:deleteByYear': {
        tables: ['absences'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    // Atomic import apply: delete year + bulk upsert in one repo transaction
    'absences:replaceByYear': {
        tables: ['absences'],
        operation: 'MIXED',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true,
        localKeyFields: ['school_year', 'student_code', 'month', 'absence_type']
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
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'examProctors:delete': { tables: ['exam_proctors'], operation: 'DEL', idExtractor: 'argId' },
    'examProctors:bulkImport': {
        tables: ['exam_proctors'],
        operation: 'MIXED',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'examProctors:deleteAll': {
        tables: ['exam_proctors'],
        operation: 'MIXED',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true,
        captureMode: 'explicit',
        exclude: true
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
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'examAttendance:upsert': { tables: ['exam_attendance'], operation: 'UPSERT', idExtractor: 'argIdOrLastInsert' },
    'examAttendance:bulkUpsert': {
        tables: ['exam_attendance'],
        operation: 'UPSERT',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'examAttendance:delete': { tables: ['exam_attendance'], operation: 'DEL', idExtractor: 'argId' },
    'examAttendance:deleteAll': {
        tables: ['exam_attendance'],
        operation: 'MIXED',
        idExtractor: 'preQuery+bulk',
        preCapture: true,
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },

    // === schoolOps.js ===
    'studentFiles:upsert': { tables: ['student_files'], operation: 'UPSERT', idExtractor: 'compositeKey' },
    'studentFiles:upsertBulk': {
        tables: ['student_files'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true,
        localKeyFields: ['student_id', 'doc_key', 'school_year']
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
            'teacher_absences',
            'teacher_teaching_assignments'
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
            'teacher_absences',
            'teacher_teaching_assignments'
        ],
        operation: 'MIXED',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'teachers:saveTafwijAliases': {
        tables: ['teacher_aliases'],
        operation: 'PUT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'teachers:importBulk': {
        tables: ['teachers', 'teacher_aliases'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'teachers:reviewAssignment': {
        tables: ['teacher_teaching_assignments'],
        operation: 'PUT',
        idExtractor: 'argId',
        captureMode: 'explicit',
        exclude: true
    },
    'teachers:resolveAssignmentReview': {
        // staffRepo.resolveUnresolvedGradeAssignment captures inside its own transaction:
        // grades (capturePutsByIds), then the derived assignment + alias rows.
        tables: ['grades', 'teacher_teaching_assignments', 'teacher_aliases'],
        operation: 'PUT',
        idExtractor: 'argId',
        captureMode: 'explicit',
        exclude: true
    },
    'teachers:setScope': {
        // staffRepo.setTeacherScope captures the updated teacher row explicitly.
        tables: ['teachers'],
        operation: 'PUT',
        idExtractor: 'argId',
        captureMode: 'explicit',
        exclude: true
    },
    'teachers:saveNameAlias': { tables: ['name_aliases'], operation: 'UPSERT', idExtractor: 'argIdOrLastInsert' },
    'teachers:deleteNameAlias': { tables: ['name_aliases'], operation: 'DEL', idExtractor: 'argId' },
    'teacherAbsences:save': { tables: ['teacher_absences'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'teacherAbsences:delete': { tables: ['teacher_absences'], operation: 'DEL', idExtractor: 'argId' },
    'schoolEvents:save': { tables: ['school_events'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'schoolEvents:delete': { tables: ['school_events'], operation: 'DEL', idExtractor: 'argId' },
    'systemTags:save': { tables: ['system_tags'], operation: 'PUT', idExtractor: 'argIdOrLastInsert' },
    'systemTags:saveNote': {
        tables: ['system_tags'],
        operation: 'PUT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'systemTags:delete': { tables: ['system_tags'], operation: 'DEL', idExtractor: 'argId' },
    'systemTags:deleteByGroup': {
        tables: ['system_tags'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'compensation:saveBatch': {
        tables: ['compensation_tracking'],
        operation: 'PUT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'compensation:toggleCompensated': { tables: ['compensation_tracking'], operation: 'PUT', idExtractor: 'argId' },
    'supportSessions:add': { tables: ['support_sessions'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'supportSessions:delete': { tables: ['support_sessions'], operation: 'DEL', idExtractor: 'argId' },
    'supportSessions:import': {
        tables: ['support_sessions'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },

    // === orientation.js ===
    // Exact bulk: each inserted/updated student_orientation row is written to the
    // sync outbox individually via captureInputUpserts inside the same SQLite
    // transaction (main/repos/orientation.js bulkUpsert — not the IPC summary).
    // Record key for sync: school_year + student_code (localKeyFields).
    // Operations distinguished as PUT (insert or non-destructive update). Unchanged
    // rows are not captured. If capture throws mid-transaction, the whole batch
    // rolls back (mapped to SYNC_ERROR / IMPORT_ROLLBACK at the IPC layer).
    // Normal import must never call orientation:clearYear.
    'orientation:bulkUpsert': {
        tables: ['student_orientation'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true,
        localKeyFields: ['school_year', 'student_code']
    },
    // Explicit year-wide delete only (settings UI). Outside automatic capture so a
    // bulk clear is never mistaken for per-row DELs; re-import re-syncs via bulkUpsert.
    // DEL tombstones are written inside the repo transaction (main/repos/orientation.js
    // clearYear) — captureMode 'explicit' keeps the wrapper from double-capturing.
    'orientation:clearYear': {
        tables: ['student_orientation'],
        operation: 'DEL',
        captureMode: 'explicit',
        exclude: true
    },
    // Individual row delete — DEL tombstone written inside the repo transaction
    // (main/repos/orientation.js deleteById); explicit keeps the wrapper from
    // writing a duplicate post-commit outbox entry.
    'orientation:delete': {
        tables: ['student_orientation'],
        operation: 'DEL',
        idExtractor: 'argId',
        captureMode: 'explicit'
    },

    // === students.js ===
    'students:add': { tables: ['students'], operation: 'PUT', idExtractor: 'lastInsertRowid' },
    'students:addBulk': {
        tables: ['students'],
        operation: 'UPSERT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true,
        localKeyFields: ['school_year', 'code']
    },
    'students:update': { tables: ['students'], operation: 'PUT', idExtractor: 'argId' },
    'students:delete': { tables: ['students'], operation: 'DEL', idExtractor: 'argId' },
    'students:deleteByYear': {
        tables: ['students', 'grades', 'absences', 'correspondence', 'student_files', 'student_movements'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'students:updateStatusBulk': {
        tables: ['students'],
        operation: 'PUT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true,
        localKeyFields: ['id']
    },
    'studentProfile:saveTab': { tables: ['student_profile_data'], operation: 'UPSERT', idExtractor: 'compositeKey' },
    'studentProfile:saveRiskSnapshot': {
        tables: ['student_risk_snapshot'],
        operation: 'UPSERT',
        idExtractor: 'compositeKey'
    },
    'settings:set': { tables: ['settings'], operation: 'PUT', idExtractor: 'argKey' },
    'settings:setSchoolYear': { tables: ['settings'], operation: 'PUT', idExtractor: 'literal' },

    // Membership changes capture atomically in the repository; active context stays session-local.
    'cycles:add': {
        tables: ['institution_cycles'],
        operation: 'PUT',
        captureMode: 'explicit',
        exclude: true
    },
    'cycles:setActive': { tables: [], operation: 'PUT', exclude: true },
    'cycles:setEnabled': {
        tables: ['institution_cycles'],
        operation: 'PUT',
        captureMode: 'explicit',
        exclude: true
    },
    'grades:save': { tables: ['grades'], operation: 'PUT', idExtractor: 'compositeKey' },
    'grades:saveBulk': {
        tables: ['grades', 'teacher_teaching_assignments'],
        operation: 'PUT',
        idExtractor: 'inputArray',
        bulk: true,
        captureMode: 'explicit',
        exclude: true,
        localKeyFields: ['school_year', 'student_code', 'subject', 'semester']
    },
    'grades:reassignTeacherBulk': {
        tables: ['grades'],
        operation: 'PUT',
        idExtractor: 'queryMatch',
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'grades:deleteByYear': {
        tables: ['grades'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true,
        captureMode: 'explicit',
        exclude: true
    },
    'grades:deleteBySemester': {
        tables: ['grades'],
        operation: 'DEL',
        idExtractor: 'preQuery',
        preCapture: true,
        bulk: true,
        captureMode: 'explicit',
        exclude: true
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

    // systemLogs rows are device-local audit/diagnostic data, never synced.
    'systemLogs:add': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },

    // === cycle-access.js (S6 user_cycle_access) — LOCAL-ONLY, never captured ===
    // user_cycle_access is a per-device authorization policy, not school data: the
    // users table is not a sync entity (user IDs are device-local) and syncing grants
    // would let any device push its own authorization. Deliberately excluded — see
    // docs/plans/2026-08-02-multi-stage-school-architecture.md row 130.
    'cycleAccess:setUsers': { tables: ['user_cycle_access'], operation: 'PUT', idExtractor: 'none', exclude: true },
    'cycleAccess:setCycles': { tables: ['user_cycle_access'], operation: 'MIXED', idExtractor: 'none', exclude: true },

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

    // === stage-rules.js (explicit outbox written inside the repo transaction) ===
    'stageRules:saveCoefficients': {
        tables: ['stage_rule_sets', 'subject_coefficients'],
        operation: 'PUT',
        idExtractor: 'none',
        captureMode: 'explicit',
        exclude: true
    },
    'stageRules:saveExamCounts': {
        tables: ['stage_rule_sets', 'exam_count_rules'],
        operation: 'PUT',
        idExtractor: 'none',
        captureMode: 'explicit',
        exclude: true
    },
    'stageRules:saveAll': {
        tables: ['stage_rule_sets', 'subject_coefficients', 'exam_count_rules', 'subject_weight_rules'],
        operation: 'PUT',
        idExtractor: 'none',
        captureMode: 'explicit',
        exclude: true
    },
    'stageRules:resetToOfficial': {
        tables: ['stage_rule_sets', 'subject_coefficients', 'exam_count_rules', 'subject_weight_rules'],
        operation: 'PUT',
        idExtractor: 'none',
        captureMode: 'explicit',
        exclude: true
    },

    // === sync.js ===
    'sync:setConfig': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'sync:triggerNow': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'sync:resolveConflict': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'sync:testConnection': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    'sync:quarantineLegacyBulk': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },

    // === timetable-data.js ===
    'timetableData:save': { tables: ['timetable_data'], operation: 'UPSERT', idExtractor: 'argKey', captureMode: 'explicit', exclude: true, localKeyFields: ['school_year', 'cycle_code'] },
    'timetableData:delete': { tables: ['timetable_data'], operation: 'DEL', idExtractor: 'argKey', captureMode: 'explicit', exclude: true },

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

/**
 * Resolve rows by declared local key fields and write one outbox PUT per row.
 * Intended to run inside the same SQLite transaction as the mutation (WP1 D2).
 *
 * @param {object} db
 * @param {{ tableName: string, keyFields: string[], items: object[], operation?: string }} opts
 * @returns {object[]} resolved rows
 */
function captureInputUpserts(db, opts) {
    const tableName = opts.tableName;
    const keyFields = opts.keyFields;
    const items = opts.items || [];
    const operation = opts.operation || 'PUT';

    if (!tableName || !Array.isArray(keyFields) || !keyFields.length) {
        throw new Error('[sync:capture] captureInputUpserts requires tableName and keyFields');
    }

    if (!items.length) {
        return [];
    }

    const where = keyFields.map((f) => `"${f}" = ?`).join(' AND ');
    const select = db.prepare(`SELECT * FROM "${tableName}" WHERE ${where}`);
    const resolved = [];

    for (const item of items) {
        const params = keyFields.map((f) => {
            if (item[f] === undefined || item[f] === null || String(item[f]).trim() === '') {
                throw new Error(
                    `[sync:capture] Missing key field '${f}' for ${tableName} after mutation`
                );
            }
            return item[f];
        });
        const row = select.get(...params);
        if (!row) {
            throw new Error(
                `[sync:capture] Row not found after mutation in ${tableName} ` +
                    `(${keyFields.map((f, i) => `${f}=${params[i]}`).join(', ')})`
            );
        }
        if (row.id == null) {
            throw new Error(`[sync:capture] Resolved ${tableName} row has no id`);
        }
        recordOutboxEntry(db, tableName, row.id, operation, row, row.school_year || item.school_year || null);
        resolved.push(row);
    }

    return resolved;
}

/**
 * Write outbox entries for already-resolved rows (must include numeric `id`).
 * Safe inside an open transaction; does not open a nested one.
 */
function captureResolvedRows(db, tableName, rows, operation = 'PUT') {
    for (const row of rows) {
        if (!row || row.id == null) {
            throw new Error(`[sync:capture] captureResolvedRows requires row.id for ${tableName}`);
        }
        recordOutboxEntry(db, tableName, row.id, operation, row, row.school_year || null);
    }
}

/**
 * Capture PUT outbox rows for a list of local IDs (re-read from DB).
 * Skips missing IDs; throws if any id is invalid.
 */
function capturePutsByIds(db, tableName, ids, schoolYear = null) {
    if (!ids || !ids.length) return [];
    const select = db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`);
    const resolved = [];
    for (const rawId of ids) {
        const id = Number(rawId);
        if (!Number.isFinite(id) || id <= 0) {
            throw new Error(`[sync:capture] Invalid id for ${tableName}: ${rawId}`);
        }
        const row = select.get(id);
        if (!row) {
            throw new Error(`[sync:capture] Row id=${id} missing in ${tableName} after mutation`);
        }
        recordOutboxEntry(db, tableName, row.id, 'PUT', row, schoolYear || row.school_year || null);
        resolved.push(row);
    }
    return resolved;
}

/**
 * Capture DEL entries from pre-selected full rows (must run before DELETE).
 */
function captureDeletesFromRows(db, tableName, rows) {
    if (!rows || !rows.length) return 0;
    for (const row of rows) {
        if (!row || row.id == null) {
            throw new Error(`[sync:capture] captureDeletesFromRows requires row.id for ${tableName}`);
        }
        recordOutboxEntry(db, tableName, row.id, 'DEL', row, row.school_year || null);
    }
    return rows.length;
}

/**
 * Select all rows for a school year (helper for year-scoped bulk deletes).
 */
function selectRowsBySchoolYear(db, tableName, schoolYear) {
    return db.prepare(`SELECT * FROM "${tableName}" WHERE school_year = ?`).all(schoolYear);
}

/**
 * Delete all rows for a school year and capture exact DEL outbox entries.
 * Must be called inside or as a transaction.
 * @returns {number} deleted count
 */
function deleteBySchoolYearWithCapture(db, tableName, schoolYear) {
    const rows = selectRowsBySchoolYear(db, tableName, schoolYear);
    if (rows.length) {
        captureDeletesFromRows(db, tableName, rows);
    }
    return db.prepare(`DELETE FROM "${tableName}" WHERE school_year = ?`).run(schoolYear).changes;
}

/**
 * Notify push scheduler after an explicit-capture transaction commits.
 */
function notifyCaptureCommitted() {
    scheduleDebouncedPush();
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
 * @param {{ getDb?: () => any }} [options] - optional deps (injectable DB for tests)
 * @returns {Function} wrapped handler
 */
const CAPTURE_WARNING_MESSAGE = 'تعذر تسجيل التغيير للمزامنة السحابية';

function attachCaptureWarning(result) {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        return {
            ...result,
            captureWarning: true,
            captureError: CAPTURE_WARNING_MESSAGE
        };
    }
    return {
        success: true,
        data: result,
        captureWarning: true,
        captureError: CAPTURE_WARNING_MESSAGE
    };
}

function wrapWithSyncCapture(channel, originalHandler, options = {}) {
    const registryEntry = CHANNEL_REGISTRY[channel];

    // Skip channels not in registry, excluded, or using explicit atomic capture (WP1).
    if (!registryEntry || registryEntry.exclude || registryEntry.captureMode === 'explicit') {
        return originalHandler;
    }

    const resolveDb = typeof options.getDb === 'function' ? options.getDb : getCaptureDb;

    return async function wrappedHandler(event, ...args) {
        const preCapturedRow = captureRowBeforeDelete(registryEntry, args, resolveDb);

        // Run the original handler first — if it throws, we do not capture
        const result = await originalHandler(event, ...args);

        // Only capture if the handler succeeded
        // Convention: handlers return { success: false, ... } on failure
        if (result && result.success === false) {
            return result;
        }

        // Capture in a try/catch — never disrupt the original result
        try {
            const db = resolveDb();
            captureAfterWrite(db, channel, registryEntry, args, result, preCapturedRow);
            scheduleDebouncedPush();
        } catch (captureErr) {
            console.warn(`[sync:capture] Capture failed for channel '${channel}':`, captureErr.message);
            try {
                const db = resolveDb();
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
            return attachCaptureWarning(result);
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

function captureRowBeforeDelete(registryEntry, handlerArgs, resolveDb = getCaptureDb) {
    if (registryEntry.operation !== 'DEL' || registryEntry.idExtractor !== 'argId') return null;
    try {
        const db = resolveDb();
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
    const compositeData = extractCompositeFromArgs(handlerArgs, tableName, db);
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

function extractCompositeFromArgs(handlerArgs, tableName, db = getCaptureDb()) {
    // Try to re-query the row using known composite key patterns
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
        const db = getCaptureDb();
        runMaintenanceCleanup(db);

        const SIX_HOURS = 6 * 60 * 60 * 1000;
        _cleanupTimer = setInterval(() => {
            try {
                const db = getCaptureDb();
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
    getCaptureDb,
    getDeviceHash,
    getDeviceName,
    recordOutboxEntries,
    recordOutboxEntry,
    captureInputUpserts,
    captureResolvedRows,
    capturePutsByIds,
    captureDeletesFromRows,
    selectRowsBySchoolYear,
    deleteBySchoolYearWithCapture,
    notifyCaptureCommitted,
    setCaptureGetDb,
    startOutboxCleanup,
    stopOutboxCleanup,
    stripSensitiveFields,
    wrapWithSyncCapture
};
