'use strict';

/**
 * Collegial permission-matrix tests (isolation plan, Slice 7).
 *
 *   node tests/collegial/permission-matrix.test.js
 *
 * A user granted the collegial stage works in collegial and gets FORBIDDEN in
 * qualifiant (and the reverse grant behaves symmetrically). Cross-stage staff
 * need two explicit grants; admin/principal/developer keep full access by
 * role. Uses ONLY the shared builders + production auth modules.
 */

const assert = require('assert');
const builders = require('../stage-isolation-builders');
const {
    assertCycleAuthorized,
    filterAuthorizedCycles,
    listAuthorizedCycleCodes,
    setUserCycles
} = require('../../main/auth/cycle-access');
const cyclesRepo = require('../../main/repos/cycles');

const { COLLEGIAL, QUALIFIANT } = builders;

console.log('[test] collegial permission matrix (slice 7)');

builders.withNoOpCapture();
const db = builders.openDb();
builders.createAccessSchema(db);
builders.seedInstitution(db, [
    { code: COLLEGIAL, hint: 'collegial-2026-v1', order: 10 },
    { code: QUALIFIANT, hint: 'qualifiant-2026-v1', order: 20 }
]);

builders.addUser(db, 1, 'admin', 'مدير التطبيق');
builders.addUser(db, 2, 'teacher', 'أستاذ إعدادي');
builders.addUser(db, 3, 'teacher', 'أستاذ تأهيلي');
builders.addUser(db, 4, 'teacher', 'أستاذ مشترك');
builders.addUser(db, 5, 'principal', 'مدير المؤسسة');
setUserCycles(db, 2, [COLLEGIAL]);
setUserCycles(db, 3, [QUALIFIANT]);
setUserCycles(db, 4, [COLLEGIAL, QUALIFIANT]);

const sessionFor = (userId, role) => ({ userId, role });
const usableCycles = cyclesRepo.listCycles(db).filter((cycle) => Number(cycle.is_active));

// 1. Collegial-only grant: collegial allowed, qualifiant FORBIDDEN.
{
    assert.strictEqual(assertCycleAuthorized(db, sessionFor(2, 'teacher'), COLLEGIAL), COLLEGIAL);
    builders.throwsCode(() => assertCycleAuthorized(db, sessionFor(2, 'teacher'), QUALIFIANT), 'FORBIDDEN');
    assert.deepStrictEqual(
        [...listAuthorizedCycleCodes(db, sessionFor(2, 'teacher'))].sort(),
        [COLLEGIAL]
    );
    console.log('  [ok] collegial-only grant: collegial allowed, qualifiant FORBIDDEN');
}

// 2. Reverse grant behaves symmetrically (both directions pinned per stage).
{
    assert.strictEqual(assertCycleAuthorized(db, sessionFor(3, 'teacher'), QUALIFIANT), QUALIFIANT);
    builders.throwsCode(() => assertCycleAuthorized(db, sessionFor(3, 'teacher'), COLLEGIAL), 'FORBIDDEN');
    console.log('  [ok] qualifiant-only grant: qualifiant allowed, collegial FORBIDDEN');
}

// 3. Cross-stage staff need two explicit grants — no "teacher ⇒ all stages".
{
    assert.strictEqual(assertCycleAuthorized(db, sessionFor(4, 'teacher'), COLLEGIAL), COLLEGIAL);
    assert.strictEqual(assertCycleAuthorized(db, sessionFor(4, 'teacher'), QUALIFIANT), QUALIFIANT);
    assert.deepStrictEqual(
        [...listAuthorizedCycleCodes(db, sessionFor(4, 'teacher'))].sort(),
        [COLLEGIAL, QUALIFIANT].sort()
    );
    console.log('  [ok] dual grant authorizes both stages explicitly');
}

// 4. Aggregations bind grants: filterAuthorizedCycles narrows the cycle list.
{
    const collegialOnly = filterAuthorizedCycles(db, usableCycles, sessionFor(2, 'teacher'));
    assert.deepStrictEqual(
        collegialOnly.map((cycle) => cycle.cycle_code),
        [COLLEGIAL]
    );
    const dual = filterAuthorizedCycles(db, usableCycles, sessionFor(4, 'teacher'));
    assert.strictEqual(dual.length, 2);
    console.log('  [ok] cycle lists filtered by grant');
}

// 5. Full-access roles bypass the matrix by role (never via grants).
{
    for (const [userId, role] of [[1, 'admin'], [5, 'principal'], [9, 'developer']]) {
        assert.strictEqual(listAuthorizedCycleCodes(db, sessionFor(userId, role)), null);
        assert.strictEqual(assertCycleAuthorized(db, sessionFor(userId, role), COLLEGIAL), COLLEGIAL);
        assert.strictEqual(assertCycleAuthorized(db, sessionFor(userId, role), QUALIFIANT), QUALIFIANT);
    }
    console.log('  [ok] admin/principal/developer keep full access by role');
}

// 6. Unknown stage is never authorized for a granted user.
{
    builders.throwsCode(
        () => assertCycleAuthorized(db, sessionFor(2, 'teacher'), 'secondary_unknown'),
        'FORBIDDEN'
    );
    console.log('  [ok] unknown stage FORBIDDEN for granted user');
}

console.log('[pass] collegial permission matrix');
