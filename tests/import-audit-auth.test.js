'use strict';

/**
 * Import-pipeline review F2 (docs/reviews/2026-08-04-import-pipeline-review.md,
 * task 3) — authentication + audit contract for school-data imports.
 *
 *   - Every import write channel (students/grades/absences/teachers/orientation/
 *     FET) must DENY without a session (allowNoSession removed); the deny is
 *     `UNAUTHENTICATED`, never a silent no-op.
 *   - Successful imports must produce a main-side system_logs audit row
 *     (entity_type 'import', action `import:<type>`) — the renderer can no longer
 *     write arbitrary audit actions.
 *   - `systemLogs:add` is authenticated and whitelist-bounded: only
 *     `import:<whitelisted-type>` (entity_id must match) and the single
 *     `print_semester_report` action are accepted.
 *   - `diagnostics:reportRendererError` is the bounded renderer error path.
 *   - `SOFT_AUTH_NO_SESSION_CHANNELS` must not contain any import channel.
 */

const assert = require('assert');
const context = require('../main/db/context');
const {
    ensureInstitutionCyclesSchema,
    ensureCycleReferenceSchema
} = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const { setCaptureGetDb } = require('../main/sync/capture');
const { registerCyclesIpc } = require('../main/ipc/cycles');
const { registerStudentsIpc } = require('../main/ipc/students');
const { registerGradesIpc } = require('../main/ipc/grades');
const { registerAbsencesIpc } = require('../main/ipc/absences');
const { registerStaffIpc } = require('../main/ipc/staff');
const { registerOrientationIpc } = require('../main/ipc/orientation');
const { registerTimetableDataIpc } = require('../main/ipc/timetable-data');
const { registerSystemIpc } = require('../main/ipc/system');
const { registerDiagnosticsIpc } = require('../main/ipc/diagnostics');
const { getActiveSessions } = require('../main/ipc/auth');
const { SOFT_AUTH_NO_SESSION_CHANNELS } = require('../main/ipc/ipc-helpers');
const {
    IMPORT_AUDIT_TYPES,
    logImportAudit,
    buildImportAuditDetails
} = require('../main/ipc/import-audit');

const QUALIFIANT = 'secondary_qualifiant';
const YEAR = '2025/2026';

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.transaction = (fn) => (...args) => {
            db.exec('BEGIN');
            try {
                const result = fn(...args);
                db.exec('COMMIT');
                return result;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
        return db;
    }
}

function buildFixture() {
    const db = openDb();
    ensureInstitutionCyclesSchema(db);
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT,
            role TEXT DEFAULT 'staff'
        );
        CREATE TABLE system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            details TEXT,
            entity_type TEXT,
            entity_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    ensureCycleReferenceSchema(db);
    db.prepare(
        `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES ('secondary_qualifiant', 1, 'qualifiant-2026-v1', 20)`
    ).run();
    db.prepare(
        `INSERT INTO institution_cycles (cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES ('secondary_collegial', 1, 'collegial-2026-v1', 10)`
    ).run();
    db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)').run(
        'المدير',
        'admin@school.local',
        'admin'
    );
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            full_name TEXT NOT NULL,
            family_name TEXT,
            birth_date TEXT,
            birth_place TEXT,
            gender TEXT,
            section TEXT,
            level TEXT,
            school_name TEXT,
            school_year TEXT,
            status TEXT DEFAULT 'active',
            registration_type TEXT DEFAULT 'new',
            cycle_code TEXT NOT NULL,
            UNIQUE(code, school_year)
        );
        CREATE TABLE absences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            student_code TEXT,
            absence_date TEXT,
            month TEXT,
            absence_type TEXT DEFAULT 'unjustified',
            hours INTEGER DEFAULT 0,
            days REAL DEFAULT 0,
            reason TEXT,
            school_year TEXT,
            cycle_code TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_code, month, school_year, absence_type)
        );
        CREATE TABLE student_orientation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_code TEXT NOT NULL,
            full_name TEXT,
            gender TEXT,
            section TEXT,
            level TEXT,
            origin_stream TEXT NOT NULL,
            choice_1 TEXT,
            choice_2 TEXT,
            choice_3 TEXT,
            assigned_stream TEXT,
            decision_status TEXT,
            average REAL,
            rank_num INTEGER,
            notes TEXT,
            cycle_code TEXT,
            school_year TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_code, school_year)
        );
        CREATE TABLE teachers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ppr TEXT,
            cin TEXT,
            full_name TEXT NOT NULL,
            full_name_fr TEXT,
            subject TEXT,
            specialty_subject TEXT,
            gender TEXT,
            birth_date TEXT,
            birth_place TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            grade TEXT,
            cadre TEXT,
            echelon INTEGER,
            hire_date TEXT,
            marital_status TEXT,
            function_title TEXT,
            position TEXT,
            statut TEXT,
            diploma_school TEXT,
            diploma_professional TEXT,
            seniority_admin TEXT,
            seniority_grade TEXT,
            echelon_date TEXT,
            titularization_date TEXT,
            total_hours REAL,
            overtime_hours REAL,
            num_classes REAL,
            is_surplus INTEGER DEFAULT 0,
            source TEXT DEFAULT 'manual',
            school_year TEXT,
            active INTEGER DEFAULT 1,
            source_function_code TEXT,
            source_assignment_mode TEXT,
            source_cycle_code TEXT,
            scope_type TEXT NOT NULL DEFAULT 'teaching_assignment',
            source_updated_at TEXT,
            source_activity_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE teacher_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id INTEGER NOT NULL,
            alias_name TEXT NOT NULL,
            alias_normalized TEXT NOT NULL,
            source TEXT,
            school_year TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(teacher_id, school_year, alias_normalized)
        );
        CREATE UNIQUE INDEX idx_teachers_ppr_year ON teachers(ppr, school_year)
            WHERE ppr IS NOT NULL AND ppr != '';
    `);
    db.prepare(
        `INSERT INTO students (code, full_name, family_name, section, school_year, cycle_code)
         VALUES ('S-1', 'تلميذ ١', '', '1BAC-1', '2025/2026', 'secondary_qualifiant')`
    ).run();
    return db;
}

function grant(db, userId, cycleCodes) {
    db.prepare('DELETE FROM user_cycle_access WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT OR IGNORE INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)');
    for (const code of cycleCodes) insert.run(userId, code);
}

function makeNoOpCaptureDb() {
    return {
        prepare() {
            return {
                get() {
                    return null;
                },
                run() {
                    return { changes: 1, lastInsertRowid: 1 };
                },
                all() {
                    return [];
                }
            };
        }
    };
}

/** Records every captureDeletesFromRows call — the DEL outbox is the behavior under test. */
function createCapturingPort(log) {
    return {
        captureInputUpserts() {
            return 0;
        },
        captureResolvedRows() {
            return 0;
        },
        capturePutsByIds() {
            return 0;
        },
        captureDeletesFromRows(db, tableName, rows) {
            if (!rows || !rows.length) return 0;
            log.push({ tableName, operation: 'DEL', rows: rows.map((row) => ({ ...row })) });
            return rows.length;
        },
        selectRowsBySchoolYear(db, tableName, schoolYear) {
            return db.prepare(`SELECT * FROM "${tableName}" WHERE school_year = ?`).all(schoolYear);
        },
        deleteBySchoolYearWithCapture(db, tableName, schoolYear) {
            return db.prepare(`DELETE FROM "${tableName}" WHERE school_year = ?`).run(schoolYear).changes;
        },
        notifyCaptureCommitted() {}
    };
}

/** Simulates a sync-outbox write failure mid-transaction. */
function createFailingCapturePort() {
    const port = createNoOpCapturePort();
    port.captureDeletesFromRows = () => {
        throw new Error('[sync:capture] outbox write failed');
    };
    return port;
}

function collectHandlers() {
    const handlers = new Map();
    return {
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        handlers
    };
}

function eventFor(senderId) {
    return { sender: { id: senderId, send: () => {} } };
}

function signIn(senderId, userId, role) {
    getActiveSessions().set(senderId, { userId, role, username: `u${userId}`, locked: false });
}

function call(handlers, channel, senderId, ...args) {
    return handlers.get(channel)(eventFor(senderId), ...args);
}

function auditRows(db) {
    return db.prepare("SELECT * FROM system_logs WHERE entity_type = 'import' ORDER BY id").all();
}

(async () => {
    const db = buildFixture();
    setRepoCapturePort(createNoOpCapturePort());
    setCaptureGetDb(() => makeNoOpCaptureDb());
    context.setDb(db);

    const { ipcMain, handlers } = collectHandlers();
    registerCyclesIpc(ipcMain);
    registerStudentsIpc(ipcMain);
    registerGradesIpc(ipcMain);
    registerAbsencesIpc(ipcMain);
    registerStaffIpc(ipcMain);
    registerOrientationIpc(ipcMain);
    registerTimetableDataIpc(ipcMain);
    registerSystemIpc(ipcMain);
    registerDiagnosticsIpc(ipcMain);

    const SENDER_ADMIN = 7101;
    const SENDER_ANON = 7102;
    signIn(SENDER_ADMIN, 1, 'admin');
    grant(db, 1, [QUALIFIANT]);

    // ── 0. No import channel may be allowlisted for no-session writes ─────────────
    for (const channel of [
        'students:addBulk',
        'grades:saveBulk',
        'absences:saveBulk',
        'absences:replaceByYear',
        'teachers:importBulk',
        'orientation:bulkUpsert',
        'timetableData:save',
        'systemLogs:add'
    ]) {
        assert.strictEqual(
            SOFT_AUTH_NO_SESSION_CHANNELS.has(channel),
            false,
            `${channel} must not be allowNoSession (F2)`
        );
    }

    // ── 1. Anonymous callers are denied on every import write channel ─────────────
    const denied = [
        ['students:addBulk', [[{ code: 'S-X', full_name: 'X', school_year: YEAR }]]],
        ['grades:saveBulk', [[{ code: 'S-X', subject: 'MATH', month: '2025-09', school_year: YEAR }]]],
        ['absences:saveBulk', [[{ student_code: 'S-1', month: '2025-09', school_year: YEAR }]]],
        ['absences:replaceByYear', [YEAR, [{ student_code: 'S-1', month: '2025-09', school_year: YEAR }]]],
        ['teachers:importBulk', [[{ full_name: 'أستاذ', school_year: YEAR }]]],
        ['orientation:bulkUpsert', [{ rows: [] }]],
        ['timetableData:save', [YEAR, QUALIFIANT, '{}']],
        ['systemLogs:add', [{ action: 'import:students', entity_type: 'import', entity_id: 'students' }]]
    ];
    for (const [channel, args] of denied) {
        const res = await call(handlers, channel, SENDER_ANON, ...args);
        assert.strictEqual(res.success, false, `${channel} must refuse an anonymous write`);
        assert.strictEqual(
            res.code,
            'UNAUTHENTICATED',
            `${channel} must surface UNAUTHENTICATED, got ${res.code}`
        );
    }

    // ── 2. Signed import writes succeed and write a main-side audit row ───────────
    const selected = await call(handlers, 'cycles:setActive', SENDER_ADMIN, {
        cycleCode: QUALIFIANT,
        schoolYear: YEAR
    });
    assert.strictEqual(selected.success, true, 'admin selects qualifiant cycle');

    const absences = await call(handlers, 'absences:saveBulk', SENDER_ADMIN, [
        {
            student_code: 'S-1',
            absence_date: '2025-09-15',
            month: '2025-09',
            absence_type: 'unjustified',
            hours: 2,
            days: 1,
            reason: '',
            school_year: YEAR
        }
    ]);
    assert.strictEqual(absences.success, true, 'signed absences bulk import succeeds');
    assert.strictEqual(Number(absences.count), 1, 'one absence imported');

    const students = await call(handlers, 'students:addBulk', SENDER_ADMIN, [
        {
            code: 'S-3',
            full_name: 'تلميذ ٣',
            family_name: '',
            birth_date: '',
            gender: '',
            section: '1BAC-1',
            school_year: YEAR
        }
    ]);
    assert.strictEqual(students.success, true, 'signed students bulk import succeeds');
    assert.strictEqual(Number(students.count), 1, 'one student imported');

    const status = await call(handlers, 'students:addBulk', SENDER_ADMIN, [
        {
            code: 'S-4',
            full_name: 'تلميذ ٤',
            family_name: '',
            birth_date: '',
            gender: '',
            section: '1BAC-1',
            school_year: YEAR,
            status: 'active'
        }
    ], 'student-status');
    assert.strictEqual(status.success, true, 'student-status import via addBulk succeeds');

    const rows = auditRows(db);
    assert.strictEqual(rows.length, 3, 'three main-side audit rows written');
    const byAction = new Map(rows.map((r) => [r.action, r]));
    assert.ok(byAction.has('import:absences'), 'absences audit row present');
    assert.ok(byAction.has('import:students'), 'students audit row present');
    assert.ok(byAction.has('import:student-status'), 'student-status audit row present');
    assert.ok(
        /^استيراد 1 /.test(byAction.get('import:absences').details || ''),
        'audit details are the Arabic summary line'
    );
    assert.ok(
        /السنة=2025\/2026/.test(byAction.get('import:students').details || ''),
        'audit details carry the school year'
    );
    assert.ok(
        /السلك=secondary_qualifiant/.test(byAction.get('import:absences').details || ''),
        'audit details carry the resolved cycle'
    );

    // ── 3. systemLogs:add is bounded ──────────────────────────────────────────────
    const forged = await call(handlers, 'systemLogs:add', SENDER_ADMIN, {
        action: 'uncaught_error',
        details: 'forged',
        entity_type: 'renderer',
        entity_id: 'students-list.html'
    });
    assert.strictEqual(forged.success, false, 'arbitrary renderer actions are rejected');

    const manual = await call(handlers, 'systemLogs:add', SENDER_ADMIN, {
        action: 'manual:test',
        details: 'x',
        entity_type: 'manual',
        entity_id: 'seed'
    });
    assert.strictEqual(manual.success, false, 'manual/seed actions are rejected');

    const unknownType = await call(handlers, 'systemLogs:add', SENDER_ADMIN, {
        action: 'import:hack',
        details: 'x',
        entity_type: 'import',
        entity_id: 'hack'
    });
    assert.strictEqual(unknownType.success, false, 'non-whitelisted import types are rejected');

    const mismatched = await call(handlers, 'systemLogs:add', SENDER_ADMIN, {
        action: 'import:students',
        details: 'x',
        entity_type: 'import',
        entity_id: 'grades'
    });
    assert.strictEqual(mismatched.success, false, 'entity_id must match the import type');

    const notice = await call(handlers, 'systemLogs:add', SENDER_ADMIN, {
        action: 'import:students',
        details: 'تم منع الاستيراد قبل الكتابة | السنة=2025/2026',
        entity_type: 'import',
        entity_id: 'students'
    });
    assert.strictEqual(notice.success, true, 'whitelisted import notice is accepted');

    const forgedSuccess = await call(handlers, 'systemLogs:add', SENDER_ADMIN, {
        action: 'import:students',
        details: 'استيراد 999 تلميذ | السنة=2025/2026',
        entity_type: 'import',
        entity_id: 'students'
    });
    assert.strictEqual(forgedSuccess.success, false, 'renderer cannot forge a successful import summary');

    const printEvent = await call(handlers, 'systemLogs:add', SENDER_ADMIN, {
        action: 'print_semester_report',
        details: '{"status":"printed"}',
        entity_type: 'print',
        entity_id: 'REF-1'
    });
    assert.strictEqual(printEvent.success, true, 'bounded print audit is accepted');

    const allRows = db.prepare('SELECT * FROM system_logs ORDER BY id').all();
    const noticeRows = allRows.filter((r) => r.action === 'import:students' && r.details.startsWith('تم منع'));
    assert.strictEqual(noticeRows.length, 1, 'import notice row stored');
    const printRows = allRows.filter((r) => r.action === 'print_semester_report');
    assert.strictEqual(printRows.length, 1, 'print audit row stored');

    const anonymousLogs = await call(handlers, 'systemLogs:getAll', SENDER_ANON, 20);
    assert.strictEqual(anonymousLogs.success, false, 'audit reads require an authenticated session');
    assert.strictEqual(anonymousLogs.code, 'UNAUTHENTICATED');

    // ── 4. diagnostics:reportRendererError is bounded and separate ────────────────
    const noPayload = await call(handlers, 'diagnostics:reportRendererError', SENDER_ANON, null);
    assert.strictEqual(noPayload.success, false, 'null payload rejected');

    const noAction = await call(handlers, 'diagnostics:reportRendererError', SENDER_ANON, { details: 'x' });
    assert.strictEqual(noAction.success, false, 'missing action rejected');

    const reported = await call(handlers, 'diagnostics:reportRendererError', SENDER_ANON, {
        action: 'uncaught_error',
        details: JSON.stringify({ message: 'boom' }),
        page: 'students-list.html'
    });
    assert.strictEqual(reported.success, true, 'renderer error report accepted');

    const rendererRows = db
        .prepare("SELECT * FROM system_logs WHERE entity_type = 'renderer' OR entity_id LIKE '%renderer%'")
        .all();
    assert.strictEqual(rendererRows.length, 0, 'renderer errors never reach system_logs');

    // ── 5. logImportAudit unit contract ───────────────────────────────────────────
    assert.strictEqual(IMPORT_AUDIT_TYPES.includes('students'), true, 'students whitelisted');
    assert.strictEqual(IMPORT_AUDIT_TYPES.includes('orientation'), true, 'orientation whitelisted');
    assert.strictEqual(IMPORT_AUDIT_TYPES.includes('clear'), true, 'clear whitelisted');
    assert.strictEqual(IMPORT_AUDIT_TYPES.includes('hack'), false, 'unknown type not whitelisted');

    assert.strictEqual(logImportAudit(db, 'not-a-type', 'x'), false, 'unknown type returns false');
    assert.strictEqual(
        logImportAudit(db, 'students', 'a'.repeat(IMPORT_AUDIT_TYPES.length * 2000)),
        true,
        'valid type writes'
    );
    const maxDetails = db
        .prepare("SELECT details FROM system_logs WHERE action = 'import:students' AND details LIKE 'aaa%' ORDER BY id DESC")
        .get();
    assert.ok(maxDetails, 'oversized details row stored');
    assert.ok(String(maxDetails.details).length <= 4000, 'details truncated to the bounded size');

    const withoutTable = openDb();
    assert.strictEqual(logImportAudit(withoutTable, 'students', 'x'), false, 'never throws on missing table');
    withoutTable.close();

    // ── 6. buildImportAuditDetails shape ──────────────────────────────────────────
    assert.strictEqual(
        buildImportAuditDetails({ label: 'تلميذ', count: 3 }, '2025/2026', QUALIFIANT),
        'استيراد 3 تلميذ | السنة=2025/2026 | السلك=secondary_qualifiant'
    );
    assert.strictEqual(
        buildImportAuditDetails({ label: 'نقطة', count: 5, inserted: 4, updated: 1, skipped: 2 }),
        'استيراد 5 نقطة (إدراج 4، تحديث 1، تخطي 2)'
    );
    assert.strictEqual(
        buildImportAuditDetails({ label: 'غياب', count: 10, deleted: 3 }, YEAR),
        'استيراد 10 غياب (حذف 3) | السنة=2025/2026'
    );
    assert.strictEqual(
        buildImportAuditDetails({ label: 'وضعية', count: 0 }),
        'استيراد 0 وضعية',
        'zero-count line still rendered'
    );

    // ── 7. teachers:importBulk is bounded (F6) ──────────────────────────────────
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM teachers').get().c, 0, 'fixture starts without teachers');

    const oversized = await call(
        handlers,
        'teachers:importBulk',
        SENDER_ADMIN,
        Array.from({ length: 5001 }, () => ({ full_name: 'أستاذ', school_year: YEAR }))
    );
    assert.strictEqual(oversized.success, false, 'oversized teacher batch is rejected');
    assert.strictEqual(oversized.error, 'Batch size exceeds maximum of 5000');
    assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS c FROM teachers').get().c,
        0,
        'no rows written for the oversized batch (rejected before the repo)'
    );

    const notAnArray = await call(handlers, 'teachers:importBulk', SENDER_ADMIN, { rows: [] });
    assert.strictEqual(notAnArray.success, false, 'non-array payload is rejected');
    assert.strictEqual(notAnArray.error, 'Expected an array');

    const missingYear = await call(handlers, 'teachers:importBulk', SENDER_ADMIN, [{ full_name: 'أستاذ' }]);
    assert.strictEqual(missingYear.success, false, 'row without school_year is rejected');
    assert.ok(/school_year/.test(missingYear.error), 'error names the missing field');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM teachers').get().c, 0, 'no rows written for the invalid row');

    const nonObjectRow = await call(handlers, 'teachers:importBulk', SENDER_ADMIN, ['أستاذ']);
    assert.strictEqual(nonObjectRow.success, false, 'non-object row is rejected');

    const oversizedName = await call(handlers, 'teachers:importBulk', SENDER_ADMIN, [
        { full_name: 'x'.repeat(501), school_year: YEAR }
    ]);
    assert.strictEqual(oversizedName.success, false, 'name over 500 chars is rejected');
    assert.ok(/exceeds 500/.test(oversizedName.error), 'error names the character bound');

    const validImport = await call(handlers, 'teachers:importBulk', SENDER_ADMIN, [
        {
            ppr: 'P-1',
            full_name: 'أستاذ ١',
            full_name_fr: 'EL SAIDI Noureddine',
            subject: 'علوم',
            school_year: YEAR
        }
    ]);
    assert.strictEqual(validImport.success, true, 'a valid teacher batch still imports');
    assert.strictEqual(Number(validImport.count), 1, 'one teacher imported');
    assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS c FROM teachers WHERE school_year = ?').get(YEAR).c,
        1,
        'teacher row written'
    );
    const teacherAudit = auditRows(db).filter((row) => row.action === 'import:agent-xml');
    assert.strictEqual(teacherAudit.length, 1, 'teacher import keeps writing the agent-xml audit row');

    // ── 8. orientation:clearYear is transactional and sync-visible (F5) ─────────
    const captureLog = [];
    setRepoCapturePort(createCapturingPort(captureLog));
    db.prepare(
        `INSERT INTO student_orientation(student_code, full_name, origin_stream, cycle_code, school_year)
         VALUES(?, ?, ?, ?, ?)`
    ).run('S-1', 'تلميذ ١', 'علوم', QUALIFIANT, YEAR);

    const cleared = await call(handlers, 'orientation:clearYear', SENDER_ADMIN, YEAR);
    assert.strictEqual(cleared.success, true, 'clearYear succeeds');
    assert.strictEqual(Number(cleared.deleted), 1, 'one row cleared');
    const delEntries = captureLog.filter(
        (entry) => entry.operation === 'DEL' && entry.tableName === 'student_orientation'
    );
    assert.strictEqual(delEntries.length, 1, 'one DEL capture call for the cleared rows');
    assert.strictEqual(delEntries[0].rows.length, 1, 'the deleted row is captured');
    assert.strictEqual(delEntries[0].rows[0].student_code, 'S-1', 'captured row keeps its identity');
    assert.strictEqual(delEntries[0].rows[0].school_year, YEAR, 'captured row keeps its school year');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM student_orientation').get().c, 0, 'rows are deleted');

    setRepoCapturePort(createFailingCapturePort());
    db.prepare(
        `INSERT INTO student_orientation(student_code, full_name, origin_stream, cycle_code, school_year)
         VALUES(?, ?, ?, ?, ?)`
    ).run('S-1', 'تلميذ ١', 'علوم', QUALIFIANT, YEAR);
    const failedClear = await call(handlers, 'orientation:clearYear', SENDER_ADMIN, YEAR);
    assert.strictEqual(failedClear.success, false, 'capture failure surfaces as a failed clear');
    assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS c FROM student_orientation').get().c,
        1,
        'transaction rollback keeps the rows'
    );
    setRepoCapturePort(createNoOpCapturePort());

    db.close();
    console.log('[test] import-audit-auth OK');
    process.exit(0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
