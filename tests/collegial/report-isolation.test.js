'use strict';

/**
 * Collegial report isolation tests (isolation plan, Slice 7).
 *
 *   node tests/collegial/report-isolation.test.js
 *
 * Every collegial read binds (school_year, cycle_code): a collegial listing
 * containing qualifiant rows returns zero qualifiant rows — even with
 * overlapping section names. Uses ONLY the shared builders + production repos.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const studentsRepo = require('../../main/repos/students');
const { resolveStudentOwnership, resolveStudentForCycle } = require('../../main/repos/student-cycle');

const { COLLEGIAL, QUALIFIANT, YEAR } = builders;

console.log('[test] collegial report isolation (slice 7)');

builders.withNoOpCapture();
const db = builders.openDb();
builders.createStudentsSchema(db);

// Dual-stage fixture: distinct student codes (UNIQUE(code, school_year)),
// deliberately OVERLAPPING section names across stages.
builders.insertStudent(db, {
    code: 'COL-001',
    fullName: 'تلميذ إعدادي أول',
    section: '1APIC-1',
    level: 'الأولى إعدادي مسار دولي',
    cycle: COLLEGIAL
});
builders.insertStudent(db, {
    code: 'COL-002',
    fullName: 'تلميذ إعدادي ثان',
    section: 'TCS-1',
    level: 'الأولى إعدادي مسار دولي',
    cycle: COLLEGIAL
});
builders.insertStudent(db, {
    code: 'QUA-001',
    fullName: 'تلميذ تأهيلي أول',
    section: 'TCS-1',
    level: 'الجذع المشترك',
    cycle: QUALIFIANT
});
builders.insertStudent(db, {
    code: 'QUA-002',
    fullName: 'تلميذ تأهيلي ثان',
    section: '2BACSMA-1',
    level: 'السنة الثانية بكالوريا',
    cycle: QUALIFIANT
});

// 1. Collegial roster binds the stage: exactly the collegial rows, even with
//    the shared 'TCS-1' section name.
{
    const rows = studentsRepo.listByYear(db, YEAR, COLLEGIAL);
    assert.deepStrictEqual(
        rows.map((row) => row.code).sort(),
        ['COL-001', 'COL-002']
    );
    assert.ok(rows.every((row) => row.cycle_code === COLLEGIAL), 'no foreign cycle_code may appear');
    console.log('  [ok] collegial roster excludes qualifiant rows (overlapping sections)');
}

// 2. Single-student lookup is stage-scoped: a qualifiant code is invisible
//    from the collegial context.
{
    assert.strictEqual(studentsRepo.getByCode(db, 'QUA-001', YEAR, COLLEGIAL), undefined);
    assert.strictEqual(studentsRepo.getByCode(db, 'COL-001', YEAR, COLLEGIAL).full_name, 'تلميذ إعدادي أول');
    console.log('  [ok] stage-scoped lookup hides foreign codes');
}

// 3. Owner resolution reports the foreign stage instead of crossing it.
{
    const ownership = resolveStudentOwnership(db, 'QUA-001', YEAR, COLLEGIAL);
    assert.strictEqual(ownership.foreignCycle, true);
    assert.strictEqual(ownership.student.cycle_code, QUALIFIANT);
    assert.throws(() => resolveStudentForCycle(db, 'QUA-001', YEAR, COLLEGIAL));
    const own = resolveStudentForCycle(db, 'COL-001', YEAR, COLLEGIAL);
    assert.strictEqual(own.code, 'COL-001');
    console.log('  [ok] foreign owner reported, strict resolution throws');
}

// 4. Report-style aggregation binds (school_year, cycle_code): zero foreign rows.
{
    const counts = db
        .prepare(
            `SELECT cycle_code, COUNT(*) AS c FROM students
             WHERE school_year = ? AND cycle_code = ?
             GROUP BY cycle_code`
        )
        .all(YEAR, COLLEGIAL);
    assert.strictEqual(counts.length, 1);
    assert.strictEqual(counts[0].cycle_code, COLLEGIAL);
    assert.strictEqual(counts[0].c, 2);
    const foreign = db
        .prepare(
            `SELECT COUNT(*) AS c FROM students
             WHERE school_year = ? AND cycle_code = ? AND section = ?`
        )
        .get(YEAR, COLLEGIAL, '2BACSMA-1').c;
    assert.strictEqual(foreign, 0, 'qualifiant sections never appear in collegial aggregates');
    console.log('  [ok] report aggregation binds (school_year, cycle_code)');
}

// 5. Search stays inside the stage.
{
    const hits = studentsRepo.search(db, YEAR, COLLEGIAL, { className: 'TCS-1' });
    assert.deepStrictEqual(
        hits.map((row) => row.code),
        ['COL-002']
    );
    console.log('  [ok] section search stays inside the stage');
}

console.log('[pass] collegial report isolation');
