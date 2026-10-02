'use strict';

/**
 * Qualifiant report isolation tests (isolation plan, Slice 7).
 *
 *   node tests/qualifiant/report-isolation.test.js
 *
 * Every qualifiant read binds (school_year, cycle_code): a qualifiant listing
 * containing collegial rows returns zero collegial rows — even with
 * overlapping section names. Uses ONLY the shared builders + production repos.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const studentsRepo = require('../../main/repos/students');
const { resolveStudentOwnership, resolveStudentForCycle } = require('../../main/repos/student-cycle');

const { COLLEGIAL, QUALIFIANT, YEAR } = builders;

console.log('[test] qualifiant report isolation (slice 7)');

builders.withNoOpCapture();
const db = builders.openDb();
builders.createStudentsSchema(db);

// Dual-stage fixture: distinct student codes (UNIQUE(code, school_year)),
// deliberately OVERLAPPING section names across stages.
builders.insertStudent(db, {
    code: 'QUA-101',
    fullName: 'تلميذ تأهيلي أول',
    section: '2BACSMA-1',
    level: 'السنة الثانية بكالوريا',
    cycle: QUALIFIANT
});
builders.insertStudent(db, {
    code: 'QUA-102',
    fullName: 'تلميذ تأهيلي ثان',
    section: 'TCS-1',
    level: 'الجذع المشترك',
    cycle: QUALIFIANT
});
builders.insertStudent(db, {
    code: 'COL-101',
    fullName: 'تلميذ إعدادي أول',
    section: 'TCS-1',
    level: 'الأولى إعدادي مسار دولي',
    cycle: COLLEGIAL
});
builders.insertStudent(db, {
    code: 'COL-102',
    fullName: 'تلميذ إعدادي ثان',
    section: '1APIC-1',
    level: 'الأولى إعدادي مسار دولي',
    cycle: COLLEGIAL
});

// 1. Qualifiant roster binds the stage: exactly the qualifiant rows, even with
//    the shared 'TCS-1' section name.
{
    const rows = studentsRepo.listByYear(db, YEAR, QUALIFIANT);
    assert.deepStrictEqual(
        rows.map((row) => row.code).sort(),
        ['QUA-101', 'QUA-102']
    );
    assert.ok(rows.every((row) => row.cycle_code === QUALIFIANT), 'no foreign cycle_code may appear');
    console.log('  [ok] qualifiant roster excludes collegial rows (overlapping sections)');
}

// 2. Single-student lookup is stage-scoped: a collegial code is invisible
//    from the qualifiant context.
{
    assert.strictEqual(studentsRepo.getByCode(db, 'COL-101', YEAR, QUALIFIANT), undefined);
    assert.strictEqual(studentsRepo.getByCode(db, 'QUA-101', YEAR, QUALIFIANT).full_name, 'تلميذ تأهيلي أول');
    console.log('  [ok] stage-scoped lookup hides foreign codes');
}

// 3. Owner resolution reports the foreign stage instead of crossing it.
{
    const ownership = resolveStudentOwnership(db, 'COL-101', YEAR, QUALIFIANT);
    assert.strictEqual(ownership.foreignCycle, true);
    assert.strictEqual(ownership.student.cycle_code, COLLEGIAL);
    assert.throws(() => resolveStudentForCycle(db, 'COL-101', YEAR, QUALIFIANT));
    const own = resolveStudentForCycle(db, 'QUA-101', YEAR, QUALIFIANT);
    assert.strictEqual(own.code, 'QUA-101');
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
        .all(YEAR, QUALIFIANT);
    assert.strictEqual(counts.length, 1);
    assert.strictEqual(counts[0].cycle_code, QUALIFIANT);
    assert.strictEqual(counts[0].c, 2);
    const foreign = db
        .prepare(
            `SELECT COUNT(*) AS c FROM students
             WHERE school_year = ? AND cycle_code = ? AND section = ?`
        )
        .get(YEAR, QUALIFIANT, '1APIC-1').c;
    assert.strictEqual(foreign, 0, 'collegial sections never appear in qualifiant aggregates');
    console.log('  [ok] report aggregation binds (school_year, cycle_code)');
}

// 5. Search stays inside the stage.
{
    const hits = studentsRepo.search(db, YEAR, QUALIFIANT, { className: 'TCS-1' });
    assert.deepStrictEqual(
        hits.map((row) => row.code),
        ['QUA-102']
    );
    console.log('  [ok] section search stays inside the stage');
}

console.log('[pass] qualifiant report isolation');
