'use strict';

/**
 * Phase 5B (2026-08-03 multi-stage management review verdict, §"Structural
 * suggestion") — property-style invariant tests (fast-check v4, already in
 * devDependencies).
 *
 * Three invariants, each asserted as a fast-check property:
 *
 *   1. Assignment uniqueness — every supported+enabled institution cycle has
 *      EXACTLY ONE active cycle_profile_assignment per school year. Generated
 *      supported cycle codes (from the static catalog) and school-year strings
 *      (YYYY/YYYY) are bound through the same upsert statement the repo's
 *      effectivity spine uses (mirror of the internal `assignActiveProfile`),
 *      re-bound a second time like version-copy saves, and the table is then
 *      queried directly: count === 1 per (school_year, cycle_code), no orphan
 *      rows, and the runtime resolvers (`getActiveProfileForCycle`,
 *      `getActiveAssignments`) read through the single assignment. The real
 *      public version-copy path (`saveCoefficients`) is round-tripped as a
 *      deterministic case.
 *
 *   2. Last-grant survival — after every PERMITTED mutation the user retains
 *      >= 1 usable supported cycle; a mutation that would remove the user's
 *      last usable cycle throws LAST_USABLE_CYCLE and leaves the grant rows
 *      intact. The guard (`assertKeepsLastUsableCycle`) lives inside
 *      main/auth/cycle-access.js but is not exported, so the invariant is
 *      driven through the two public mutation entry points that enforce it
 *      (`setUserCycles`, `setCyclesForAllUsers`). Generated grant sets mix
 *      supported, preview (`primary`) and unknown codes so the throw path is
 *      exercised with junk grants present, exactly like the production guard
 *      computes "usable" (is_active && capability supported) via
 *      `usableSupportedCycleCodes`.
 *
 *   3. Capability gate — `requireCycle` (the repo write boundary) accepts a
 *      cycle only when the catalog capability is `supported`; preview
 *      (`primary`) and unknown/empty codes are refused with the established
 *      Arabic contract. Fuzzed over fc.string() + the full catalog + edge
 *      values, plus a deterministic catalog sweep.
 *
 * Runs standalone:
 *   node tests/cycle-invariants-property.test.js
 * Exits non-zero on any failure.
 */

const assert = require('assert');
const fc = require('fast-check');

const { CYCLE_CATALOG, getCycleDefinition, isKnownCycleCode } = require('../js/shared/education/cycles');
const { requireCycle } = require('../main/repos/student-cycle');
const {
    ensureInstitutionCyclesSchema,
    ensureCycleReferenceSchema,
    ensureStageRulesSchema,
    ensureCycleProfilesSchema
} = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const {
    usableSupportedCycleCodes,
    CYCLE_ACCESS_ERROR_CODES,
    setUserCycles,
    setCyclesForAllUsers
} = require('../main/auth/cycle-access');
const stageRulesRepo = require('../main/repos/stage-rules');

const SUPPORTED_CODES = CYCLE_CATALOG.filter((entry) => entry.capability === 'supported').map((entry) => entry.cycleCode);
const CATALOG_CODES = CYCLE_CATALOG.map((entry) => entry.cycleCode);

// ---------------------------------------------------------------------------
// DB harness (same driver fallback as the sibling cycle suites).
// ---------------------------------------------------------------------------

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        /* better-sqlite3 may be compiled against another Node ABI — fall back */
    }
    try {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.transaction = (fn) => (...args) => {
            db.exec('BEGIN');
            try {
                const value = fn(...args);
                db.exec('COMMIT');
                return value;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
        return db;
    } catch {
        return null;
    }
}

/** Invariant-1 fixture: profiles, assignments, rule sets, institution cycles. */
function buildProfileDb() {
    const db = openDb();
    if (!db) return null;
    ensureInstitutionCyclesSchema(db);
    ensureStageRulesSchema(db);
    ensureCycleProfilesSchema(db);
    db.exec(`
        CREATE TABLE system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            details TEXT,
            entity_type TEXT,
            entity_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    return db;
}

/** Invariant-2 fixture: users + user_cycle_access + two enabled supported cycles + an enabled preview cycle. */
function buildAccessDb() {
    const db = openDb();
    if (!db) return null;
    ensureInstitutionCyclesSchema(db);
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT,
            role TEXT DEFAULT 'staff'
        );
    `);
    ensureCycleReferenceSchema(db);
    const insertUser = db.prepare('INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)');
    insertUser.run(7, 'أستاذ أول', 'teacher1@school.local', 'teacher');
    insertUser.run(8, 'أستاذ ثانٍ', 'teacher2@school.local', 'teacher');
    for (const [code, sortOrder] of [['primary', 5], ['secondary_collegial', 10], ['secondary_qualifiant', 20]]) {
        db.prepare(
            `INSERT INTO institution_cycles(cycle_code, is_active, seed_profile_version_hint, sort_order)
             VALUES (?, 1, ?, ?)`
        ).run(code, getCycleDefinition(code).seedProfileVersionHint, sortOrder);
    }
    return db;
}

// ---------------------------------------------------------------------------
// Invariant 1 — assignment uniqueness per (school_year, cycle_code).
// ---------------------------------------------------------------------------

function seedProfile(db, cycleCode) {
    const definition = getCycleDefinition(cycleCode);
    const usesCoefficients = definition && definition.capability === 'supported' ? 1 : 0;
    db.prepare(
        `INSERT OR IGNORE INTO cycle_profiles(cycle_code, profile_version, uses_coefficients, assessment_model)
         VALUES (?, ?, ?, ?)`
    ).run(cycleCode, definition.seedProfileVersionHint, usesCoefficients, definition.assessmentModel || 'exams');
}

/** Mirror of the repo's effectivity write (main/repos/stage-rules.js assignActiveProfile): same upsert statement. */
function bindAssignment(db, schoolYear, cycleCode, ruleSetId) {
    const profile = db
        .prepare(`SELECT * FROM cycle_profiles WHERE cycle_code = ? ORDER BY profile_version DESC LIMIT 1`)
        .get(cycleCode);
    assert.ok(profile, `no profile seeded for ${cycleCode}`);
    db.prepare(
        `INSERT INTO cycle_profile_assignments(
            school_year, cycle_code, profile_version, rule_set_id
         ) VALUES(?, ?, ?, ?)
         ON CONFLICT(school_year, cycle_code) DO UPDATE SET
            profile_version = excluded.profile_version,
            rule_set_id = excluded.rule_set_id`
    ).run(schoolYear, cycleCode, profile.profile_version, ruleSetId);
}

function closeRevision(db, schoolYear, revision) {
    db.prepare(`UPDATE stage_rule_sets SET status = 'closed' WHERE school_year = ? AND revision = ?`).run(schoolYear, revision);
}

function createActiveRevision(db, schoolYear, revision) {
    db.prepare(
        `INSERT INTO stage_rule_sets(school_year, revision, status, reason)
         VALUES (?, ?, 'active', 'property-assignment')`
    ).run(schoolYear, revision);
    return db
        .prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ? AND revision = ?`)
        .get(schoolYear, revision).id;
}

function assignmentCount(db, schoolYear, cycleCode) {
    return db
        .prepare(`SELECT COUNT(*) AS count FROM cycle_profile_assignments WHERE school_year = ? AND cycle_code = ?`)
        .get(schoolYear, cycleCode).count;
}

function assignmentRuleSetId(db, schoolYear, cycleCode) {
    const row = db
        .prepare(`SELECT rule_set_id FROM cycle_profile_assignments WHERE school_year = ? AND cycle_code = ?`)
        .get(schoolYear, cycleCode);
    return row ? row.rule_set_id : null;
}

/** One generated case: bind each (year, cycle) twice (version-copy style), then assert uniqueness. */
function runAssignmentCase(db, cycles, years) {
    db.exec(`
        DELETE FROM cycle_profile_assignments;
        DELETE FROM stage_rule_sets;
        DELETE FROM institution_cycles;
    `);
    for (const code of cycles) {
        seedProfile(db, code);
        db.prepare(
            `INSERT INTO institution_cycles(cycle_code, is_active, seed_profile_version_hint, sort_order)
             VALUES (?, 1, ?, 10)`
        ).run(code, getCycleDefinition(code).seedProfileVersionHint);
    }

    const nextRevision = new Map();
    const latestBinding = new Map();
    for (let pass = 0; pass < 2; pass++) {
        for (const year of years) {
            for (const code of cycles) {
                const revision = (nextRevision.get(year) || 0) + 1;
                nextRevision.set(year, revision);
                if (revision > 1) closeRevision(db, year, revision - 1);
                const setId = createActiveRevision(db, year, revision);
                bindAssignment(db, year, code, setId);
                latestBinding.set(`${year}|${code}`, revision);
            }
        }
    }

    for (const year of years) {
        for (const code of cycles) {
            assert.strictEqual(
                assignmentCount(db, year, code),
                1,
                `exactly one assignment row per (${year}, ${code}) after repeated binds`
            );
            const bound = db.prepare(`SELECT revision FROM stage_rule_sets WHERE id = ?`).get(assignmentRuleSetId(db, year, code));
            assert.strictEqual(
                bound.revision,
                latestBinding.get(`${year}|${code}`),
                `the re-bind follows the newest revision for (${year}, ${code})`
            );
            const activeProfile = stageRulesRepo.getActiveProfileForCycle(db, year, code);
            assert.strictEqual(
                activeProfile.profile_version,
                getCycleDefinition(code).seedProfileVersionHint,
                `the runtime resolver reads through the single assignment for (${year}, ${code})`
            );
        }
        assert.strictEqual(
            stageRulesRepo.getActiveAssignments(db, year).length,
            cycles.length,
            `no orphan assignment rows for ${year}`
        );
    }
    const total = db.prepare(`SELECT COUNT(*) AS count FROM cycle_profile_assignments`).get().count;
    assert.strictEqual(total, years.length * cycles.length, 'assignment rows = years x cycles, never more');
}

const yearArb = fc
    .tuple(fc.integer({ min: 2000, max: 2030 }), fc.integer({ min: 2000, max: 2030 }))
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
    .filter(([a, b]) => a !== b)
    .map(([a, b]) => `${a}/${b}`);

// ---------------------------------------------------------------------------
// Invariant 2 — last usable grant survival.
// ---------------------------------------------------------------------------

const VALID_GRANT_CODES = ['secondary_qualifiant', 'secondary_collegial', 'primary'];
const GRANT_POOL = [...VALID_GRANT_CODES, 'not_a_cycle', 'ghost_cycle'];

function replaceGrants(db, userId, codes) {
    db.prepare('DELETE FROM user_cycle_access WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT OR IGNORE INTO user_cycle_access(user_id, cycle_code) VALUES (?, ?)');
    for (const code of codes) insert.run(userId, code);
}

function getUserCycles(db, userId) {
    return db
        .prepare(`SELECT cycle_code FROM user_cycle_access WHERE user_id = ? ORDER BY cycle_code`)
        .all(userId)
        .map((row) => row.cycle_code);
}

// ---------------------------------------------------------------------------
// Invariant 3 — capability gate at the repo write boundary.
// ---------------------------------------------------------------------------

const SPECIAL_INPUTS = [...CATALOG_CODES, '', '   ', '\t', null, undefined, 'not_a_cycle', 'PRIMARY', ' secondary_qualifiant '];

function assertCycleGate(code) {
    const raw = String(code || '').trim();
    const definition = getCycleDefinition(raw);
    if (definition && definition.capability === 'supported') {
        assert.strictEqual(requireCycle(code), raw, `supported cycle ${JSON.stringify(code)} must be accepted`);
        return;
    }
    let error = null;
    try {
        requireCycle(code);
    } catch (err) {
        error = err;
    }
    assert.ok(error, `requireCycle must refuse ${JSON.stringify(code)}`);
    if (!raw) {
        assert.ok(/غير محدد/.test(error.message), `empty cycle must refuse with «غير محدد» (got: ${error.message})`);
    } else if (definition) {
        assert.ok(/قيد الإعداد/.test(error.message), `preview/hidden cycle must refuse with «قيد الإعداد» (got: ${error.message})`);
    } else {
        assert.ok(/غير معروف/.test(error.message), `unknown cycle must refuse with «غير معروف» (got: ${error.message})`);
    }
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

async function run() {
    console.log('[test] cycle invariants — property suite (verdict §Structural suggestion)');
    setRepoCapturePort(createNoOpCapturePort());

    const profileDb = buildProfileDb();
    const accessDb = buildAccessDb();
    if (!profileDb || !accessDb) {
        console.log('cycle-invariants-property.test.js: SKIPPED (no SQLite driver available)');
        setRepoCapturePort(null);
        return;
    }

    try {
        // ── Invariant 1: exactly one active assignment per (school_year, cycle) ──
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom(...SUPPORTED_CODES), { minLength: 1, maxLength: 2 }),
                fc.array(yearArb, { minLength: 1, maxLength: 2 }),
                (cyclesInput, yearsInput) => {
                    runAssignmentCase(profileDb, [...new Set(cyclesInput)], [...new Set(yearsInput)]);
                }
            ),
            { numRuns: 40 }
        );
        console.log('  [ok] invariant 1 (property): one assignment row per (school_year, supported+enabled cycle), re-binds included');

        // Real public path: a version-copy save re-binds the same single row.
        const setRow1 = stageRulesRepo.saveCoefficients(profileDb, {
            schoolYear: '2025/2026',
            entries: [{
                cycleCode: 'secondary_qualifiant',
                levelCode: '2BAC',
                streamCode: '2BACSMA',
                subjectCode: 'MATH',
                coefficient: 7
            }],
            reason: 'property round-trip 1',
            actor: { name: 'tester' }
        });
        assert.strictEqual(assignmentCount(profileDb, '2025/2026', 'secondary_qualifiant'), 1);
        assert.strictEqual(assignmentRuleSetId(profileDb, '2025/2026', 'secondary_qualifiant'), setRow1.id);
        const setRow2 = stageRulesRepo.saveCoefficients(profileDb, {
            schoolYear: '2025/2026',
            entries: [{
                cycleCode: 'secondary_qualifiant',
                levelCode: '2BAC',
                streamCode: '2BACSMA',
                subjectCode: 'MATH',
                coefficient: 8
            }],
            reason: 'property round-trip 2',
            actor: { name: 'tester' }
        });
        assert.strictEqual(
            assignmentCount(profileDb, '2025/2026', 'secondary_qualifiant'),
            1,
            'a version-copy save never duplicates the assignment'
        );
        assert.strictEqual(
            assignmentRuleSetId(profileDb, '2025/2026', 'secondary_qualifiant'),
            setRow2.id,
            'the assignment follows the newest revision'
        );
        console.log('  [ok] invariant 1 (real path): saveCoefficients re-binds one row, never duplicates');

        // ── Invariant 2: last usable grant survives every permitted mutation ──
        // The guard `assertKeepsLastUsableCycle` is not part of the module's
        // public surface, so the invariant is driven through the two mutation
        // entry points that enforce it (setUserCycles / setCyclesForAllUsers).
        fc.assert(
            fc.property(
                fc.array(fc.constantFrom(...GRANT_POOL), { minLength: 1, maxLength: 4 }),
                fc.array(fc.constantFrom(...GRANT_POOL), { minLength: 0, maxLength: 4 }),
                (grantInput, proposedInput) => {
                    const grants = [...new Set(grantInput)];
                    const proposed = [...new Set(proposedInput)];
                    const usableBefore = usableSupportedCycleCodes(accessDb, grants).size;
                    replaceGrants(accessDb, 7, grants);
                    const invalidProposed = proposed.filter((code) => !isKnownCycleCode(code));
                    let thrown = null;
                    let result = null;
                    try {
                        result = setUserCycles(accessDb, 7, proposed);
                    } catch (error) {
                        thrown = error;
                    }
                    const retainedUsable = usableSupportedCycleCodes(accessDb, getUserCycles(accessDb, 7)).size;
                    if (usableBefore === 0) {
                        // Vacuous guard: no usable cycle before, no protection is owed.
                        if (invalidProposed.length) {
                            assert.ok(
                                thrown && thrown.code === CYCLE_ACCESS_ERROR_CODES.UNKNOWN_CYCLE,
                                `junk proposals are refused even for users without a usable cycle (${JSON.stringify(proposed)})`
                            );
                            assert.deepStrictEqual(
                                getUserCycles(accessDb, 7).slice().sort(),
                                grants.slice().sort(),
                                'a refused mutation leaves grant rows untouched'
                            );
                        } else {
                            assert.ok(!thrown, `a valid proposal for an unprotectable user must be permitted: ${JSON.stringify(proposed)}`);
                        }
                        return;
                    }
                    // The user HAS >= 1 usable cycle: no mutation may silently drop that to 0.
                    if (invalidProposed.length) {
                        assert.ok(
                            thrown && thrown.code === CYCLE_ACCESS_ERROR_CODES.UNKNOWN_CYCLE,
                            `unknown codes are refused before the guard (${JSON.stringify(grants)} -> ${JSON.stringify(proposed)})`
                        );
                        assert.ok(retainedUsable >= 1, 'a refused mutation leaves >= 1 usable grant');
                        return;
                    }
                    const usableAfter = usableSupportedCycleCodes(accessDb, proposed).size;
                    if (usableAfter === 0) {
                        assert.ok(
                            thrown && thrown.code === CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
                            `removing the last usable cycle (${JSON.stringify(grants)} -> ${JSON.stringify(proposed)}) must throw LAST_USABLE_CYCLE`
                        );
                        assert.ok(retainedUsable >= 1, 'a refused revoke never leaves the user with zero usable grants');
                    } else {
                        assert.ok(!thrown, `a proposal keeping a usable cycle must be permitted: ${JSON.stringify(proposed)}`);
                        assert.ok(
                            result && usableSupportedCycleCodes(accessDb, result.cycles).size >= 1,
                            'a permitted mutation always leaves >= 1 usable grant'
                        );
                    }
                }
            ),
            { numRuns: 60 }
        );
        console.log('  [ok] invariant 2 (property): guard throws LAST_USABLE_CYCLE or keeps >= 1 usable grant');

        // Real mutation paths: guard enforced before the write, rows untouched on refusal.
        replaceGrants(accessDb, 7, ['secondary_qualifiant']);
        assert.throws(
            () => setUserCycles(accessDb, 7, ['primary']),
            (error) => error.code === CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
            'revoking the last usable grant for a preview-only proposal is refused'
        );
        assert.deepStrictEqual(getUserCycles(accessDb, 7), ['secondary_qualifiant'], 'a refused revoke leaves the rows untouched');
        const migrated = setUserCycles(accessDb, 7, ['secondary_collegial', 'primary']);
        assert.deepStrictEqual(migrated.cycles, ['secondary_collegial', 'primary']);
        assert.strictEqual(
            usableSupportedCycleCodes(accessDb, getUserCycles(accessDb, 7)).size,
            1,
            'after a permitted mutation >= 1 usable grant remains'
        );
        assert.throws(
            () => setUserCycles(accessDb, 7, ['ghost_cycle']),
            (error) => error.code === CYCLE_ACCESS_ERROR_CODES.UNKNOWN_CYCLE,
            'unknown codes are refused before the guard (never silently accepted)'
        );
        assert.throws(
            () => setCyclesForAllUsers(accessDb, 'secondary_collegial', false),
            (error) => error.code === CYCLE_ACCESS_ERROR_CODES.LAST_USABLE_CYCLE,
            'disabling a user last usable cycle via setCycles is refused'
        );
        setUserCycles(accessDb, 8, ['primary']);
        assert.deepStrictEqual(getUserCycles(accessDb, 8), ['primary'], 'a user with zero usable cycles is not protected (vacuous guard)');
        console.log('  [ok] invariant 2 (real path): setUserCycles / setCyclesForAllUsers never leave 0 usable grants');

        // ── Invariant 3: requireCycle rejects every non-supported cycle ──
        for (const entry of CYCLE_CATALOG) {
            if (entry.capability === 'supported') {
                assert.strictEqual(requireCycle(entry.cycleCode), entry.cycleCode, `${entry.cycleCode} is accepted at the write boundary`);
            } else {
                assert.throws(
                    () => requireCycle(entry.cycleCode),
                    /قيد الإعداد/,
                    `${entry.cycleCode} (${entry.capability}) is refused at the write boundary`
                );
            }
        }
        fc.assert(
            fc.property(
                fc.oneof(
                    { weight: 5, arbitrary: fc.constantFrom(...SPECIAL_INPUTS) },
                    { weight: 5, arbitrary: fc.string({ maxLength: 24 }) }
                ),
                (code) => assertCycleGate(code)
            ),
            { numRuns: 200 }
        );
        console.log('  [ok] invariant 3 (property + sweep): only supported catalog cycles pass requireCycle');
    } finally {
        profileDb.close();
        accessDb.close();
        setRepoCapturePort(null);
    }

    console.log('cycle-invariants-property: OK');
}

run().catch((error) => {
    console.error('cycle-invariants-property: FAILED');
    console.error(error);
    process.exit(1);
});
