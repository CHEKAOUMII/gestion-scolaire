'use strict';

const assert = require('assert');
const {
    parseReportRequest,
    resolveReportScope,
    annotateLinkedSession,
    rejectAllCycleWrite: rejectReportWrite
} = require('../main/ipc/daily-report');
const { rejectAllCycleWrite: rejectAttendanceWrite } = require('../main/ipc/staffAttendance');
const {
    validateCycleInventory,
    getDeclaredBackupMetadata,
    quarantineRows
} = require('../main/ipc/system-backup');

function throwsWithCode(fn, code) {
    assert.throws(fn, (error) => error.code === code, `expected ${code}`);
}

const cycleRows = [
    { cycle_code: 'secondary_qualifiant', is_active: 1, seed_profile_version_hint: 'qualifiant-2026-v1' },
    { cycle_code: 'secondary_collegial', is_active: 1, seed_profile_version_hint: 'collegial-2026-v1' }
];

const cycleDb = {
    prepare(sql) {
        if (sql.includes('FROM institution_cycles')) return { all: () => cycleRows };
        throw new Error(`unexpected SQL: ${sql}`);
    }
};

assert.deepStrictEqual(
    parseReportRequest({ schoolYear: '2025/2026', cycleCode: 'all' }),
    { schoolYear: '2025/2026', cycleCode: 'all' }
);
assert.deepStrictEqual(
    parseReportRequest('2025/2026'),
    { schoolYear: '2025/2026', cycleCode: null }
);

throwsWithCode(
    () => resolveReportScope(cycleDb, {}, { role: 'teacher' }, { cycleCode: 'all' }),
    'ALL_CYCLES_REPORT_FORBIDDEN'
);
const administrativeScope = resolveReportScope(cycleDb, {}, { role: 'principal' }, { cycleCode: 'all' });
assert.strictEqual(administrativeScope.administrative, true);
assert.deepStrictEqual(administrativeScope.cycleCodes, ['secondary_qualifiant', 'secondary_collegial']);

// A default (non-admin) scope must surface a TYPED cycle failure, never leak an
// untyped one, and the all-cycles gate stays a pure role decision even when the
// active cycle cannot be resolved (Phase 4A resolveReportScope ordering).
const singleCycleDb = {
    prepare(sql) {
        if (sql.includes('FROM institution_cycles')) return { all: () => [cycleRows[0]] };
        throw new Error(`unexpected SQL: ${sql}`);
    }
};
const singleScope = resolveReportScope(singleCycleDb, {}, { role: 'principal' }, {});
assert.strictEqual(singleScope.cycleCode, 'secondary_qualifiant');
assert.strictEqual(singleScope.administrative, false);
const twoCycleDb = cycleDb; // two active supported catalog rows, no session context
throwsWithCode(
    () => resolveReportScope(twoCycleDb, {}, { role: 'principal' }, {}),
    'CYCLE_SELECTION_REQUIRED'
);
throwsWithCode(
    () => resolveReportScope(singleCycleDb, {}, { role: 'teacher' }, { cycleCode: 'all' }),
    'ALL_CYCLES_REPORT_FORBIDDEN'
);

throwsWithCode(() => rejectReportWrite({ cycle_code: 'all' }), 'ALL_CYCLES_WRITE_FORBIDDEN');
throwsWithCode(() => rejectAttendanceWrite({ scope: 'all_cycles' }), 'ALL_CYCLES_WRITE_FORBIDDEN');

const timetableDb = {
    prepare(sql) {
        if (sql.includes("sqlite_master") && sql.includes('timetable_data')) return { get: () => ({ name: 'timetable_data' }) };
        if (sql.includes('FROM timetable_data')) {
            return {
                all: () => [{
                    cycle_code: 'secondary_qualifiant',
                    data_json: JSON.stringify({
                        teacherMetaByKey: { teacher1: { teacherId: 7, teacherName: 'أستاذ الرياضيات' } },
                        timetables: {
                            teacher1: {
                                الاثنين: { morning: { h1: { subject: 'الرياضيات', students: '1BAC' } } }
                            }
                        }
                    })
                }]
            };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    }
};
const linked = annotateLinkedSession(
    { teacher_id: 7, full_name: 'أستاذ الرياضيات', attendance_date: '2026-07-27', absence_period: 'morning' },
    timetableDb,
    '2025/2026',
    ['secondary_qualifiant']
);
assert.deepStrictEqual(linked.linked_session_cycle_codes, ['secondary_qualifiant']);
assert.strictEqual(linked.cycle_resolution, 'linked');
assert.ok(linked.linked_session_cycle_label.includes('التأهيلي'));

const currentTwoCycles = {
    known: true,
    cycles: [{ cycle_code: 'secondary_collegial' }, { cycle_code: 'secondary_qualifiant' }]
};
const backupOneCycle = { known: true, cycles: [{ cycle_code: 'secondary_qualifiant' }] };
throwsWithCode(
    () => validateCycleInventory(currentTwoCycles, backupOneCycle),
    'BACKUP_CYCLE_REPLACEMENT_REQUIRED'
);
assert.deepStrictEqual(
    validateCycleInventory(currentTwoCycles, backupOneCycle, { replaceAllCycles: true }).backupCodes,
    ['secondary_qualifiant']
);
throwsWithCode(
    () => validateCycleInventory({ known: true, cycles: [{ cycle_code: 'secondary_qualifiant' }] }, currentTwoCycles),
    'BACKUP_CYCLE_INSTALLATION_UPDATE_REQUIRED'
);
throwsWithCode(
    () => validateCycleInventory({ known: false, cycles: [] }, currentTwoCycles),
    'BACKUP_CYCLE_INSTALLATION_UPDATE_REQUIRED'
);

const declared = getDeclaredBackupMetadata({
    metadata: {
        cycleInventory: [{ cycle_code: 'secondary_qualifiant' }],
        cycleInventoryKnown: true,
        contractVersions: { students: 2 }
    }
});
assert.strictEqual(declared.cycleInventory.cycles[0].cycle_code, 'secondary_qualifiant');
assert.strictEqual(declared.contractVersions.students, 2);

const quarantined = [];
const quarantineDb = {
    prepare(sql) {
        if (sql.includes('sqlite_master')) return { get: () => ({ name: 'sync_quarantine' }) };
        return { run: (...args) => quarantined.push(args) };
    }
};
assert.strictEqual(
    quarantineRows(quarantineDb, [{
        backupId: 'fixture',
        tableName: 'students',
        reason: 'missing_cycle_code_value',
        row: { id: 12, code: 'S-12', full_name: 'تلميذ' }
    }]),
    1
);
assert.strictEqual(quarantined.length, 1);
assert.ok(quarantined[0][3].includes('backup_restore:missing_cycle_code_value'));

console.log('staff-attendance-report-backup: OK');
