'use strict';

/**
 * S4 cycle profiles — effectivity spine (docs/plans/2026-08-02-multi-stage-school-architecture.md
 * rows 105-115).
 *
 * Covers:
 *   1. migration 2026-08-082-cycle-profiles: official profile seeds, assignment
 *      backfill to the ACTIVE stage_rule_sets revision per school year, strict
 *      idempotence, zero outbox rows, collegial profile NOT seeded (row 115);
 *      migration 2026-08-083-cycle-profile-assignments-fk: composite-FK rebuild
 *      on upgraded DBs (row 113), row identity preserved, FK enforced at schema;
 *   2. repository effectivity: every version-copy save re-binds the assignment
 *      atomically, getActiveRuleSetForCycle resolves through the assignment
 *      (never CYCLE_CATALOG.seedProfileVersionHint), getActiveProfileForCycle returns
 *      the ASSIGNED version (never the newest), continuous cycles refuse a
 *      rule-set binding, missing cycle_profiles table is RULES_UNAVAILABLE
 *      (row 114);
 *   3. sync-apply revalidation (row 113): checkCycleProfileConsistency refuses
 *      unknown cycles, missing local profiles, nullability mismatches and
 *      cross-year rule sets, and any pulled PUT that would change an existing
 *      official profile's content (immutability);
 *   4. sync version gate (row 112): minAppVersion '1.0.42' declared on both
 *      entities, semantic comparator, and apply-time quarantine on older devices;
 *   5. engine integration: version-gate and consistency failures land in
 *      sync_quarantine (never written, never holding the cursor), valid rows apply.
 */

const assert = require('assert');

const registry = require('../main/sync/entity-registry');
const { ensureStageRulesSchema, ensureCycleProfilesSchema } = require('../main/db/schema');
const { checkCycleProfileConsistency } = require('../main/sync/apply-hooks-stage-rules');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const { clearSchemaColumnsCache, TOPO_ORDER_PUT } = require('../main/sync/engine/helpers');
const { applySingleItem, buildPullResult } = require('../main/sync/engine/apply');

let stageRulesRepo = null;
try {
    stageRulesRepo = require('../main/repos/stage-rules');
} catch {
    stageRulesRepo = null;
}

const YEAR = '2025/2026';
const PROFILE_PRIMARY = { cycle_code: 'primary', profile_version: 'primary-2026-v1', uses_coefficients: 0, assessment_model: 'continuous' };
const PROFILE_QUALIFIANT = { cycle_code: 'secondary_qualifiant', profile_version: 'qualifiant-2026-v1', uses_coefficients: 1, assessment_model: 'exams' };

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
        db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
        db.transaction = (fn) => fn;
        return db;
    } catch {
        return null;
    }
}

function seedProfiles(db) {
    const insert = db.prepare(
        `INSERT INTO cycle_profiles(cycle_code, profile_version, uses_coefficients, assessment_model)
         VALUES (?, ?, ?, ?)`
    );
    insert.run(PROFILE_PRIMARY.cycle_code, PROFILE_PRIMARY.profile_version, PROFILE_PRIMARY.uses_coefficients, PROFILE_PRIMARY.assessment_model);
    insert.run(PROFILE_QUALIFIANT.cycle_code, PROFILE_QUALIFIANT.profile_version, PROFILE_QUALIFIANT.uses_coefficients, PROFILE_QUALIFIANT.assessment_model);
}

function makeRecordingCapturePort() {
    const base = createNoOpCapturePort();
    const state = { captureResolvedRows: 0, notifyCaptureCommitted: 0, byTable: {} };
    const record = (name) => (...args) => {
        state[name] += 1;
        return base[name](...args);
    };
    const recordResolved = (name) => (db, table, rows, op) => {
        state[name] += 1;
        state.byTable[table] = (state.byTable[table] || 0) + 1;
        return base[name](db, table, rows, op);
    };
    return {
        state,
        port: {
            captureInputUpserts: record('captureInputUpserts'),
            captureResolvedRows: recordResolved('captureResolvedRows'),
            capturePutsByIds: record('capturePutsByIds'),
            captureDeletesFromRows: record('captureDeletesFromRows'),
            selectRowsBySchoolYear: base.selectRowsBySchoolYear,
            deleteBySchoolYearWithCapture: record('deleteBySchoolYearWithCapture'),
            notifyCaptureCommitted: record('notifyCaptureCommitted')
        }
    };
}

function getAssignment(db, schoolYear, cycleCode) {
    return db.prepare(`SELECT * FROM cycle_profile_assignments WHERE school_year = ? AND cycle_code = ?`).get(schoolYear, cycleCode);
}

function run() {
    const recording = makeRecordingCapturePort();
    setRepoCapturePort(recording.port);
    const db = openDb();
    if (!db) {
        console.log('cycle-profiles.test.js: SKIPPED (no SQLite driver available)');
        setRepoCapturePort(null);
        return;
    }

    try {
        // ─────────────────────────────────────────────────────────────────────
        // 1. Registry declarations — sync contract (rows 107-112)
        // ─────────────────────────────────────────────────────────────────────
        assert.deepStrictEqual(registry.getLocalKeyFields('cycle_profiles'), ['cycle_code', 'profile_version']);
        assert.deepStrictEqual(registry.getRemoteIdFields('cycle_profiles'), ['cycle_code', 'profile_version']);
        assert.deepStrictEqual(registry.getLocalKeyFields('cycle_profile_assignments'), ['school_year', 'cycle_code']);
        assert.deepStrictEqual(registry.getRemoteIdFields('cycle_profile_assignments'), ['school_year', 'cycle_code']);
        assert.strictEqual(registry.getContractVersion('cycle_profiles'), 2);
        assert.strictEqual(registry.getContractVersion('cycle_profile_assignments'), 2);
        assert.strictEqual(registry.getMinAppVersion('cycle_profiles'), '1.0.42', 'cycle_profiles declares minAppVersion');
        assert.strictEqual(registry.getMinAppVersion('cycle_profile_assignments'), '1.0.42', 'assignments declare minAppVersion');
        assert.strictEqual(registry.getMinAppVersion('students'), null, 'entities without a gate declare nothing');
        assert.deepStrictEqual(registry.validateEntityRegistry(), [], 'shipped registry satisfies its own contract rules');
        assert.ok(
            TOPO_ORDER_PUT.indexOf('cycle_profiles') < TOPO_ORDER_PUT.indexOf('cycle_profile_assignments'),
            'profiles must be applied before assignments'
        );
        assert.ok(
            TOPO_ORDER_PUT.indexOf('cycle_profile_assignments') > TOPO_ORDER_PUT.indexOf('subject_weight_rules'),
            'assignments come after the stage-rule tables'
        );
        console.log('[cycle-profiles] registry declarations: PASS');

        // ── Version gate helpers (row 112) ──
        assert.strictEqual(registry.compareSemanticVersions('1.0.41', '1.0.42'), -1);
        assert.strictEqual(registry.compareSemanticVersions('1.0.42', '1.0.42'), 0);
        assert.strictEqual(registry.compareSemanticVersions('1.0.43', '1.0.42'), 1);
        assert.strictEqual(registry.compareSemanticVersions('v1.0.42', '1.0.42'), 0, 'v prefix is tolerated');
        assert.strictEqual(registry.compareSemanticVersions('1.0.42', '1.0'), 1, 'missing segments compare as 0');
        assert.strictEqual(registry.compareSemanticVersions('abc', '1.0.42'), null, 'unparseable version cannot be compared');
        assert.strictEqual(registry.compareSemanticVersions('', '1.0.42'), null);

        registry.setLocalAppVersionForTests('1.0.41');
        let gate = registry.checkAppVersionGate('cycle_profiles');
        assert.strictEqual(gate.allowed, false, 'a device below minAppVersion is refused');
        assert.ok(gate.reason.includes('older than minAppVersion 1.0.42'), gate.reason);

        registry.setLocalAppVersionForTests('1.0.42');
        gate = registry.checkAppVersionGate('cycle_profiles');
        assert.deepStrictEqual(gate, { allowed: true }, 'the exact minimum is allowed');

        registry.setLocalAppVersionForTests('1.1.0');
        assert.deepStrictEqual(registry.checkAppVersionGate('cycle_profile_assignments'), { allowed: true });

        registry.setLocalAppVersionForTests('not-a-version');
        gate = registry.checkAppVersionGate('cycle_profiles');
        assert.strictEqual(gate.allowed, false, 'an unparseable local version refuses the row');
        assert.ok(gate.reason.includes('cannot be compared'), gate.reason);

        registry.setLocalAppVersionForTests(null);
        assert.deepStrictEqual(
            registry.checkAppVersionGate('cycle_profiles'),
            { allowed: true },
            'without an app version (pure-node) the gate is skipped'
        );
        console.log('[cycle-profiles] version gate helpers: PASS');

        // ─────────────────────────────────────────────────────────────────────
        // 2. Migration 2026-08-082-cycle-profiles
        // ─────────────────────────────────────────────────────────────────────
        const { setDb } = require('../main/db/context');
        const { MIGRATIONS } = require('../main/db/migrations');
        const migration = MIGRATIONS.find((entry) => entry.version === '2026-08-082-cycle-profiles');
        assert.ok(migration, 'migration 2026-08-082-cycle-profiles must be registered');

        const mdb = openDb();
        mdb.exec(`
            CREATE TABLE sync_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                row_sync_id TEXT NOT NULL,
                operation TEXT NOT NULL CHECK(operation IN ('PUT','DEL')),
                row_data TEXT,
                school_year TEXT,
                status TEXT NOT NULL DEFAULT 'pending'
            );
        `);
        ensureStageRulesSchema(mdb);
        setDb(mdb);

        // First run on an empty stage-rules state: profiles seeded, no assignments.
        migration.up();
        const profiles = mdb.prepare('SELECT * FROM cycle_profiles ORDER BY cycle_code').all();
        assert.strictEqual(profiles.length, 2, 'exactly two official profiles are seeded');
        assert.deepStrictEqual(
            profiles.map((p) => [p.cycle_code, p.profile_version, p.uses_coefficients, p.assessment_model]),
            [
                [PROFILE_PRIMARY.cycle_code, PROFILE_PRIMARY.profile_version, 0, 'continuous'],
                [PROFILE_QUALIFIANT.cycle_code, PROFILE_QUALIFIANT.profile_version, 1, 'exams']
            ],
            'primary is continuous without coefficients; qualifiant is exams with coefficients'
        );
        assert.strictEqual(
            mdb.prepare(`SELECT COUNT(*) AS count FROM cycle_profiles WHERE cycle_code = 'secondary_collegial'`).get().count,
            0,
            'the collegial profile is NOT seeded until its official file is approved (row 115)'
        );
        assert.strictEqual(
            mdb.prepare('SELECT COUNT(*) AS count FROM cycle_profile_assignments').get().count,
            0,
            'no assignments when no active rule sets exist'
        );
        assert.strictEqual(
            mdb.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get().count,
            0,
            'migration seeds are local data — zero outbox rows'
        );

        // Seed rule sets for two years (one active each) + one closed set, re-run.
        mdb.prepare(`INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 1, 'active', ?)`).run(YEAR, 'baseline');
        const yearAId = mdb.prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ? AND revision = 1`).get(YEAR).id;
        mdb.prepare(`INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 1, 'active', ?)`).run('2024/2025', 'baseline');
        const yearBId = mdb.prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ? AND revision = 1`).get('2024/2025').id;
        mdb.prepare(`INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 5, 'closed', ?)`).run('2023/2024', 'old');
        migration.up();
        migration.up(); // idempotence: reruns must not change counts

        const assignments = mdb.prepare('SELECT * FROM cycle_profile_assignments ORDER BY school_year').all();
        assert.strictEqual(assignments.length, 2, 'one assignment per year that has an active rule set');
        const forA = getAssignment(mdb, YEAR, 'secondary_qualifiant');
        const forB = getAssignment(mdb, '2024/2025', 'secondary_qualifiant');
        assert.ok(forA && forB, 'both active years are bound to the qualifiant profile');
        assert.strictEqual(forA.profile_version, 'qualifiant-2026-v1');
        assert.strictEqual(forA.rule_set_id, yearAId, 'assignment binds the ACTIVE revision of the same year');
        assert.strictEqual(forB.rule_set_id, yearBId);
        assert.strictEqual(
            mdb.prepare(`SELECT COUNT(*) AS count FROM cycle_profile_assignments WHERE cycle_code = 'primary'`).get().count,
            0,
            'the continuous primary profile is never bound by the migration'
        );
        assert.strictEqual(
            mdb.prepare(`SELECT COUNT(*) AS count FROM cycle_profile_assignments WHERE school_year = '2023/2024'`).get().count,
            0,
            'a year with only closed revisions gets no assignment'
        );
        assert.strictEqual(mdb.prepare('SELECT COUNT(*) AS count FROM cycle_profiles').get().count, 2, 'profiles stay seeded once');
        assert.strictEqual(mdb.prepare('SELECT COUNT(*) AS count FROM sync_outbox').get().count, 0);

        // The upsert re-seeds a year whose active revision moved (ON CONFLICT DO UPDATE).
        mdb.prepare(`UPDATE stage_rule_sets SET status = 'closed' WHERE id = ?`).run(yearAId);
        mdb.prepare(`INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 2, 'active', ?)`).run(YEAR, 'upgraded');
        const yearA2Id = mdb.prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ? AND revision = 2`).get(YEAR).id;
        migration.up();
        const forAAfter = getAssignment(mdb, YEAR, 'secondary_qualifiant');
        assert.strictEqual(forAAfter.rule_set_id, yearA2Id, 're-running the migration follows the new active revision');
        mdb.close();
        console.log('[cycle-profiles] migration 2026-08-082: PASS');

        // ─────────────────────────────────────────────────────────────────────
        // 2b. Migration 2026-08-083-cycle-profile-assignments-fk
        // ─────────────────────────────────────────────────────────────────────
        // Upgraded DBs whose assignments table shipped WITHOUT the profile FK get
        // it via a rebuild (SQLite cannot ALTER-ADD a foreign key); fresh installs
        // get it from the canonical DDL (ensureCycleProfilesSchema).
        const fkVersion = '2026-08-083-cycle-profile-assignments-fk';
        const fkMigration = MIGRATIONS.find((entry) => entry.version === fkVersion);
        assert.ok(fkMigration, `migration ${fkVersion} must be registered`);

        const fkdb = openDb();
        fkdb.exec(`
            CREATE TABLE schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        ensureStageRulesSchema(fkdb);
        // Simulate a pre-083 install: the exact shape migration 082 shipped (no
        // composite FK on cycle_profile_assignments).
        fkdb.exec(`
            CREATE TABLE cycle_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cycle_code TEXT NOT NULL,
                profile_version TEXT NOT NULL,
                uses_coefficients INTEGER NOT NULL DEFAULT 1 CHECK(uses_coefficients IN (0, 1)),
                assessment_model TEXT NOT NULL DEFAULT 'exams' CHECK(assessment_model IN ('exams','continuous')),
                is_official INTEGER NOT NULL DEFAULT 1 CHECK(is_official IN (0, 1)),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(cycle_code, profile_version)
            );
            CREATE TABLE cycle_profile_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                school_year TEXT NOT NULL,
                cycle_code TEXT NOT NULL,
                profile_version TEXT NOT NULL,
                rule_set_id INTEGER REFERENCES stage_rule_sets(id),
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(school_year, cycle_code)
            );
            CREATE INDEX idx_cycle_profile_assignments_school_year
                ON cycle_profile_assignments(school_year);
        `);
        fkdb.prepare(
            `INSERT INTO cycle_profiles(cycle_code, profile_version, uses_coefficients, assessment_model)
             VALUES (?, ?, ?, ?)`
        ).run('secondary_qualifiant', 'qualifiant-2026-v1', 1, 'exams');
        fkdb.prepare(`INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 1, 'active', ?)`).run(YEAR, 'base');
        const fkSetId = fkdb.prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ?`).get(YEAR).id;
        fkdb.prepare(
            `INSERT INTO cycle_profile_assignments(school_year, cycle_code, profile_version, rule_set_id)
             VALUES (?, ?, ?, ?)`
        ).run(YEAR, 'secondary_qualifiant', 'qualifiant-2026-v1', fkSetId);
        const oldRow = fkdb
            .prepare(`SELECT id, school_year, cycle_code, profile_version, rule_set_id FROM cycle_profile_assignments`)
            .get();
        assert.ok(oldRow, 'a pre-migration assignment exists');

        setDb(fkdb);
        fkMigration.up();
        const fkList = fkdb.prepare(`PRAGMA foreign_key_list(cycle_profile_assignments)`).all();
        const profileFkPairs = fkList
            .filter((fk) => String(fk.table) === 'cycle_profiles')
            .map((fk) => [String(fk.from), String(fk.to)]);
        assert.ok(
            profileFkPairs.some(([from, to]) => from === 'cycle_code' && to === 'cycle_code') &&
                profileFkPairs.some(([from, to]) => from === 'profile_version' && to === 'profile_version'),
            'the rebuild adds the composite FK to cycle_profiles'
        );
        assert.deepStrictEqual(
            fkdb
                .prepare(`SELECT id, school_year, cycle_code, profile_version, rule_set_id FROM cycle_profile_assignments`)
                .get(),
            oldRow,
            'the rebuild preserves row identity (id + data) for sync linkage'
        );
        assert.strictEqual(
            fkdb.prepare(`SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?`).get(fkVersion).count,
            1,
            'the migration records itself once'
        );

        // Idempotence on the guard path: a re-run with the FK present skips the rebuild.
        fkdb.prepare(`DELETE FROM schema_migrations WHERE version = ?`).run(fkVersion);
        fkMigration.up();
        assert.strictEqual(
            fkdb.prepare(`SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?`).get(fkVersion).count,
            1
        );

        // With the FK declared (and foreign_keys back ON after the rebuild), a
        // dangling assignment is rejected at the schema layer — layer one of the
        // row-113 consistency contract.
        assert.throws(
            () =>
                fkdb.prepare(
                    `INSERT INTO cycle_profile_assignments(school_year, cycle_code, profile_version, rule_set_id)
                     VALUES ('2098/2099', 'secondary_qualifiant', 'ghost-2026-v1', NULL)`
                ).run(),
            (err) =>
                String(err.code || '').includes('SQLITE_CONSTRAINT') ||
                /FOREIGN KEY constraint failed/i.test(String(err.message || '')),
            'the FK rejects an assignment whose profile does not exist'
        );
        fkdb.close();
        setDb(null);
        console.log('[cycle-profiles] migration 2026-08-083 FK rebuild: PASS');

        // ─────────────────────────────────────────────────────────────────────
        // 3. Repository effectivity (rows 109-111, 114)
        // ─────────────────────────────────────────────────────────────────────
        ensureCycleProfilesSchema(db);
        ensureStageRulesSchema(db);
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
        seedProfiles(db);

        // Missing cycle_profiles table → RULES_UNAVAILABLE, never a guessed default (row 114).
        const bareDb = openDb();
        ensureStageRulesSchema(bareDb);
        assert.throws(
            () => stageRulesRepo.saveCoefficients(bareDb, {
                schoolYear: YEAR,
                entries: [{
                    cycleCode: 'secondary_qualifiant',
                    levelCode: '2BAC',
                    streamCode: '2BACSMA',
                    subjectCode: 'MATH',
                    coefficient: 7
                }],
                reason: 'probe',
                actor: { name: 'tester' }
            }),
            (err) => err.code === 'RULES_UNAVAILABLE',
            'a missing cycle_profiles table is RULES_UNAVAILABLE (never silently uses coefficients)'
        );
        bareDb.close();

        // saveCoefficients creates revision 1 and binds the assignment atomically.
        const setRow1 = stageRulesRepo.saveCoefficients(db, {
            schoolYear: YEAR,
            entries: [{
                cycleCode: 'secondary_qualifiant',
                levelCode: '2BAC',
                streamCode: '2BACSMA',
                subjectCode: 'MATH',
                coefficient: 7
            }],
            reason: 'first revision',
            actor: { name: 'tester' }
        });
        let assignment = getAssignment(db, YEAR, 'secondary_qualifiant');
        assert.ok(assignment, 'the save writes the effectivity assignment');
        assert.strictEqual(assignment.profile_version, 'qualifiant-2026-v1');
        assert.strictEqual(assignment.rule_set_id, setRow1.id, 'assignment binds the new revision');

        // The assignment is captured for sync along with the revision.
        assert.ok(
            recording.state.byTable['cycle_profile_assignments'] >= 1,
            'assignment rows are captured with the revision'
        );

        // getActiveRuleSetForCycle resolves through the assignment (row 110).
        const resolved = stageRulesRepo.getActiveRuleSetForCycle(db, YEAR, 'secondary_qualifiant');
        assert.deepStrictEqual(resolved, setRow1, 'assignment-based resolver returns the active revision');
        assert.throws(
            () => stageRulesRepo.getActiveRuleSetForCycle(db, YEAR, 'primary'),
            (err) => err.code === 'RULES_UNAVAILABLE',
            'a continuous profile has no rule set to resolve'
        );
        assert.throws(
            () => stageRulesRepo.getActiveRuleSetForCycle(db, '2099/2100', 'secondary_qualifiant'),
            (err) => err.code === 'RULES_UNAVAILABLE',
            'a year without an assignment cannot be resolved'
        );

        // A second version-copy save re-binds the assignment to the newest revision.
        const setRow2 = stageRulesRepo.saveCoefficients(db, {
            schoolYear: YEAR,
            entries: [{
                cycleCode: 'secondary_qualifiant',
                levelCode: '2BAC',
                streamCode: '2BACSMA',
                subjectCode: 'MATH',
                coefficient: 8
            }],
            reason: 'second revision',
            actor: { name: 'tester' }
        });
        assignment = getAssignment(db, YEAR, 'secondary_qualifiant');
        assert.strictEqual(assignment.rule_set_id, setRow2.id, 'assignment follows every new revision');
        assert.deepStrictEqual(
            stageRulesRepo.getActiveRuleSetForCycle(db, YEAR, 'secondary_qualifiant'),
            setRow2
        );

        // The official seed path re-binds in the same transaction and never captures.
        const callsBefore = recording.state.captureResolvedRows;
        const seeded = stageRulesRepo.applyOfficialRuleSet(
            db,
            { schoolYear: YEAR, cycleCode: 'secondary_qualifiant' },
            'official refresh'
        );
        assignment = getAssignment(db, YEAR, 'secondary_qualifiant');
        assert.strictEqual(assignment.rule_set_id, seeded.id, 'seed path re-binds the assignment');
        assert.strictEqual(recording.state.captureResolvedRows, callsBefore, 'seed path never captures');

        // A continuous cycle refuses a rule-set binding via the seed path.
        assert.throws(
            () =>
                stageRulesRepo.applyOfficialRuleSet(
                    db,
                    { schoolYear: YEAR, cycleCode: 'primary' },
                    'primary seed attempt'
                ),
            (err) => err.code === 'RULES_UNAVAILABLE',
            'the continuous primary profile cannot be bound to a rule set'
        );

        // Read helpers: profiles + assignments exposed with the getActive payload shape.
        assert.deepStrictEqual(
            stageRulesRepo.getCycleProfiles(db).map((p) => p.cycle_code),
            ['primary', 'secondary_qualifiant']
        );
        assert.deepStrictEqual(
            stageRulesRepo.getActiveAssignments(db, YEAR).map((a) => a.cycle_code),
            ['secondary_qualifiant']
        );

        // ── getActiveProfileForCycle (rows 110-111, 114) ──
        // The resolver returns the version the assignment POINTS AT — never the
        // newest profile of the cycle, never a guess.
        db.prepare(
            `INSERT INTO cycle_profiles(cycle_code, profile_version, uses_coefficients, assessment_model)
             VALUES (?, ?, ?, ?)`
        ).run('primary', 'primary-2026-v2', 1, 'exams');
        db.prepare(
            `INSERT INTO cycle_profile_assignments(school_year, cycle_code, profile_version, rule_set_id)
             VALUES (?, 'primary', 'primary-2026-v1', NULL)`
        ).run(YEAR);
        const assignedProfile = stageRulesRepo.getActiveProfileForCycle(db, YEAR, 'primary');
        assert.strictEqual(
            assignedProfile.profile_version,
            'primary-2026-v1',
            'the profile resolver returns the assigned version'
        );
        assert.strictEqual(assignedProfile.uses_coefficients, 0);
        assert.notStrictEqual(
            assignedProfile.profile_version,
            'primary-2026-v2',
            'a newer profile never overrides the assignment (row 110)'
        );
        assert.throws(
            () => stageRulesRepo.getActiveProfileForCycle(db, '2099/2100', 'secondary_qualifiant'),
            (err) => err.code === 'RULES_UNAVAILABLE',
            'a year without an assignment cannot resolve a profile'
        );

        // A dangling assignment (profile_version that no longer resolves) refuses
        // in both profile and rule-set resolution paths. The composite FK (row 113,
        // schema layer) already rejects such rows on enforcing connections, so the
        // fixture inserts with foreign_keys OFF to reach the repo-level guard.
        db.prepare(`INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 1, 'active', ?)`).run('2098/2099', 'ghost');
        const ghostSetId = db.prepare(`SELECT id FROM stage_rule_sets WHERE school_year = '2098/2099'`).get().id;
        db.exec('PRAGMA foreign_keys=off;');
        db.prepare(
            `INSERT INTO cycle_profile_assignments(school_year, cycle_code, profile_version, rule_set_id)
             VALUES ('2098/2099', 'secondary_qualifiant', 'ghost-2026-v1', ?)`
        ).run(ghostSetId);
        db.exec('PRAGMA foreign_keys=on;');
        assert.throws(
            () => stageRulesRepo.getActiveProfileForCycle(db, '2098/2099', 'secondary_qualifiant'),
            (err) => err.code === 'RULES_UNAVAILABLE',
            'an assignment pointing at a missing profile is RULES_UNAVAILABLE'
        );
        assert.throws(
            () => stageRulesRepo.getActiveRuleSetForCycle(db, '2098/2099', 'secondary_qualifiant'),
            (err) => err.code === 'RULES_UNAVAILABLE',
            'getActiveRuleSetForCycle verifies the assigned profile_version resolves'
        );
        console.log('[cycle-profiles] repository effectivity: PASS');

        // ─────────────────────────────────────────────────────────────────────
        // 4. checkCycleProfileConsistency — sync-apply revalidation (row 113)
        // ─────────────────────────────────────────────────────────────────────
        const hdb = openDb();
        ensureCycleProfilesSchema(hdb);
        ensureStageRulesSchema(hdb);
        seedProfiles(hdb);
        hdb.prepare(`INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 1, 'active', ?)`).run(YEAR, 'base');
        const hSetId = hdb.prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ? AND revision = 1`).get(YEAR).id;

        const ck = (item) => checkCycleProfileConsistency(hdb, item);

        assert.deepStrictEqual(
            ck({ tableName: 'cycle_profiles', data: PROFILE_QUALIFIANT }),
            null,
            'a known official profile is consistent'
        );
        assert.ok(
            ck({ tableName: 'cycle_profiles', data: { cycle_code: 'unknown_cycle_xyz', profile_version: 'collegial-2026-v1' } }),
            'an unknown cycle is refused'
        );
        assert.ok(
            ck({ tableName: 'cycle_profiles', data: { profile_version: 'x' } }),
            'missing cycle_code is refused'
        );
        assert.deepStrictEqual(
            ck({ tableName: 'teachers', data: { id: 1 } }),
            null,
            'non-profile tables are not revalidated here'
        );

        // Content-immutability (row 109): an existing official profile cannot be
        // changed by a pulled PUT — a new official file ships as a NEW version row.
        assert.deepStrictEqual(
            ck({ tableName: 'cycle_profiles', data: { ...PROFILE_QUALIFIANT } }),
            null,
            'an identical re-pull of an existing profile passes'
        );
        assert.ok(
            ck({
                tableName: 'cycle_profiles',
                data: { ...PROFILE_QUALIFIANT, uses_coefficients: 0 }
            }),
            'changing uses_coefficients of an existing profile is refused'
        );
        assert.ok(
            ck({
                tableName: 'cycle_profiles',
                data: { ...PROFILE_QUALIFIANT, assessment_model: 'continuous' }
            }),
            'changing assessment_model of an existing profile is refused'
        );

        const goodAssignment = {
            tableName: 'cycle_profile_assignments',
            data: { school_year: YEAR, cycle_code: 'secondary_qualifiant', profile_version: 'qualifiant-2026-v1', rule_set_id: hSetId }
        };
        assert.deepStrictEqual(ck(goodAssignment), null, 'a consistent assignment passes');

        const failing = [
            [
                { tableName: 'cycle_profile_assignments', data: { school_year: YEAR, cycle_code: 'secondary_qualifiant', profile_version: 'qualifiant-2026-v1' } },
                'coefficient cycle without rule_set_id'
            ],
            [
                { tableName: 'cycle_profile_assignments', data: { school_year: YEAR, cycle_code: 'primary', profile_version: 'primary-2026-v1', rule_set_id: hSetId } },
                'continuous cycle with rule_set_id'
            ],
            [
                { tableName: 'cycle_profile_assignments', data: { school_year: YEAR, cycle_code: 'secondary_qualifiant', profile_version: 'ghost-2026-v1', rule_set_id: hSetId } },
                'profile missing locally'
            ],
            [
                { tableName: 'cycle_profile_assignments', data: { school_year: YEAR, cycle_code: 'unknown_cycle_xyz', profile_version: 'x', rule_set_id: hSetId } },
                'unknown cycle'
            ],
            [
                { tableName: 'cycle_profile_assignments', data: { school_year: '2023/2024', cycle_code: 'secondary_qualifiant', profile_version: 'qualifiant-2026-v1', rule_set_id: hSetId } },
                'rule set from a different year'
            ]
        ];
        for (const [item, label] of failing) {
            const result = ck(item);
            assert.ok(result && result.reason, `${label} must be refused`);
        }
        hdb.close();
        console.log('[cycle-profiles] apply-hook consistency checks: PASS');

        // ─────────────────────────────────────────────────────────────────────
        // 5. Engine apply — quarantine on old devices, apply on current ones
        // ─────────────────────────────────────────────────────────────────────
        const edb = openDb();
        clearSchemaColumnsCache();
        edb.exec(`
            CREATE TABLE sync_id_map (
                row_sync_id TEXT PRIMARY KEY,
                table_name TEXT,
                local_id INTEGER,
                ancestor_data TEXT,
                version INTEGER
            );
            CREATE TABLE sync_snapshots (
                row_sync_id TEXT PRIMARY KEY,
                table_name TEXT,
                checksum TEXT,
                updated_at TEXT
            );
            CREATE TABLE sync_quarantine (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                row_sync_id TEXT NOT NULL UNIQUE,
                table_name TEXT NOT NULL,
                operation TEXT NOT NULL,
                contract_version INTEGER DEFAULT 1,
                reason TEXT NOT NULL,
                item_json TEXT NOT NULL,
                retry_count INTEGER NOT NULL DEFAULT 0,
                last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        ensureCycleProfilesSchema(edb);
        ensureStageRulesSchema(edb);
        seedProfiles(edb);
        edb.prepare(`INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 1, 'active', ?)`).run(YEAR, 'base');
        const eSetId = edb.prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ? AND revision = 1`).get(YEAR).id;

        const apply = (item) => {
            const stats = buildPullResult();
            applySingleItem(edb, item, new Map(), [], [], [], stats, false);
            return stats;
        };
        const profileItem = {
            tableName: 'cycle_profiles',
            operation: 'PUT',
            rowSyncId: 'cp-1',
            entityType: 'cycle_profile',
            data: { cycle_code: 'secondary_qualifiant', profile_version: 'qualifiant-2026-v1', uses_coefficients: 1, assessment_model: 'exams' },
            version: 1
        };

        // Old device (below minAppVersion) → quarantined, nothing written.
        registry.setLocalAppVersionForTests('1.0.41');
        let stats = apply(profileItem);
        assert.strictEqual(stats.quarantinedCount, 1, 'an old device quarantines the profile row');
        assert.strictEqual(stats.appliedCount, 0);
        assert.strictEqual(
            edb.prepare(`SELECT COUNT(*) AS count FROM cycle_profiles WHERE profile_version = 'qualifiant-2026-v1'`).get().count,
            1,
            'the row already existed — no duplicate write'
        );
        assert.strictEqual(
            edb.prepare(`SELECT COUNT(*) AS count FROM cycle_profiles WHERE profile_version = 'ghost'`).get().count,
            0
        );
        registry.setLocalAppVersionForTests('1.0.42');

        // Current device → the same row applies cleanly.
        stats = apply({ ...profileItem, rowSyncId: 'cp-2' });
        assert.strictEqual(stats.appliedCount, 1, 'a current device applies the profile row');
        assert.strictEqual(stats.quarantinedCount, 0);

        // Consistency revalidation quarantines a bad assignment even on a current device.
        stats = apply({
            tableName: 'cycle_profile_assignments',
            operation: 'PUT',
            rowSyncId: 'cpa-1',
            entityType: 'cycle_profile_assignment',
            data: { school_year: YEAR, cycle_code: 'secondary_qualifiant', profile_version: 'ghost-2026-v1', rule_set_id: eSetId },
            version: 1
        });
        assert.strictEqual(stats.quarantinedCount, 1, 'an assignment for a missing profile is quarantined');
        assert.strictEqual(
            edb.prepare(`SELECT COUNT(*) AS count FROM cycle_profile_assignments`).get().count,
            0,
            'nothing is written'
        );

        // A consistent assignment applies.
        stats = apply({
            tableName: 'cycle_profile_assignments',
            operation: 'PUT',
            rowSyncId: 'cpa-2',
            entityType: 'cycle_profile_assignment',
            data: { school_year: YEAR, cycle_code: 'secondary_qualifiant', profile_version: 'qualifiant-2026-v1', rule_set_id: eSetId },
            version: 1
        });
        assert.strictEqual(stats.appliedCount, 1, 'a consistent assignment applies');
        assert.strictEqual(getAssignment(edb, YEAR, 'secondary_qualifiant').rule_set_id, eSetId);

        // Cross-year rule set → quarantined.
        stats = apply({
            tableName: 'cycle_profile_assignments',
            operation: 'PUT',
            rowSyncId: 'cpa-3',
            entityType: 'cycle_profile_assignment',
            data: { school_year: '2023/2024', cycle_code: 'secondary_qualifiant', profile_version: 'qualifiant-2026-v1', rule_set_id: eSetId },
            version: 1
        });
        assert.strictEqual(stats.quarantinedCount, 1, 'a cross-year rule set is quarantined');

        // The quarantine store actually holds the payload for replay.
        const { countQuarantinedRows } = require('../main/sync/engine/helpers');
        assert.ok(countQuarantinedRows(edb) >= 3, 'quarantined rows are persisted for replay');
        edb.close();
        registry.setLocalAppVersionForTests(null);
        console.log('[cycle-profiles] engine apply gates: PASS');
    } finally {
        db.close();
        setRepoCapturePort(null);
        registry.setLocalAppVersionForTests(null);
    }

    console.log('cycle-profiles.test.js: OK');
}

run();
