'use strict';

/**
 * Shared builders/fixtures for the Slice-7 per-stage suites
 * (docs/plans/2026-09-27-isolation-principle-stage-separation(1).md, Slice 7).
 *
 * This is the ONLY tests/ module both `tests/collegial/*` and
 * `tests/qualifiant/*` may import (pinned by
 * tests/stage-isolation-constitution.test.js). Factories only: every helper
 * builds a FRESH in-memory DB / vm sandbox per call, and this module holds no
 * module-level mutable state (no setDb, no shared connections).
 *
 * Not a test file (no .test.js suffix) — required, never executed directly.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const COLLEGIAL = 'secondary_collegial';
const QUALIFIANT = 'secondary_qualifiant';
const PRIMARY = 'primary';
const YEAR = '2025/2026';

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        // Native ABI mismatch (module built for Electron) — fall back to node:sqlite.
    }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
    db.transaction = (fn) => (...args) => {
        db.exec('BEGIN');
        try {
            const result = fn(...args);
            db.exec('COMMIT');
            return result;
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    };
    return db;
}

function withNoOpCapture() {
    const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
    setRepoCapturePort(createNoOpCapturePort());
}

// Mirrors createTables() + migration 2026-07-071-students-cycle-code for the
// students table (same shape as tests/cycle-isolation-students.test.js).
function createStudentsSchema(db) {
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT,
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
            cycle_code TEXT NOT NULL DEFAULT 'secondary_qualifiant',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(code, school_year)
        );
        CREATE INDEX idx_students_year_cycle ON students(school_year, cycle_code);
    `);
}

function insertStudent(db, { code, fullName, section, level, year, cycle, status }) {
    const info = db
        .prepare(
            `INSERT INTO students(code, full_name, section, level, school_year, cycle_code, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
            code,
            fullName,
            section || null,
            level || null,
            year || YEAR,
            cycle,
            status || 'active'
        );
    return Number(info.lastInsertRowid);
}

function createAccessSchema(db) {
    const { ensureInstitutionCyclesSchema, ensureCycleReferenceSchema } = require('../main/db/schema');
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT,
            email TEXT,
            role TEXT NOT NULL
        );
    `);
    ensureInstitutionCyclesSchema(db);
    ensureCycleReferenceSchema(db);
}

function seedInstitution(db, entries) {
    const insert = db.prepare(
        `INSERT OR IGNORE INTO institution_cycles(cycle_code, is_active, seed_profile_version_hint, sort_order)
         VALUES (?, 1, ?, ?)`
    );
    for (const entry of entries) insert.run(entry.code, entry.hint, entry.order);
}

function addUser(db, id, role, name) {
    db.prepare(`INSERT INTO users(id, name, email, role) VALUES (?, ?, ?, ?)`)
        .run(id, name || `user-${id}`, `user-${id}@school.local`, role);
}

function grantCycles(db, userId, codes) {
    const insert = db.prepare(`INSERT OR IGNORE INTO user_cycle_access(user_id, cycle_code) VALUES (?, ?)`);
    for (const code of codes) insert.run(userId, code);
}

function createRulesSchema(db, { profiles } = {}) {
    const {
        ensureCycleReferenceSchema,
        ensureStageRulesSchema,
        ensureCycleProfilesSchema
    } = require('../main/db/schema');
    const { seedSubjectCatalog } = require('../main/db/education-catalogs/subject-catalog');
    ensureCycleReferenceSchema(db);
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
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS sync_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            row_sync_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('PUT','DEL')),
            row_data TEXT,
            school_year TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
        );
    `);
    db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES ('currentSchoolYear', ?)`).run(YEAR);
    const seedProfiles =
        profiles || [
            { cycle: COLLEGIAL, version: 'collegial-2026-v1', uses: 1, model: 'exams_activities' },
            { cycle: QUALIFIANT, version: 'qualifiant-2026-v1', uses: 1, model: 'exams' }
        ];
    const insertProfile = db.prepare(
        `INSERT OR IGNORE INTO cycle_profiles(cycle_code, profile_version, uses_coefficients, assessment_model)
         VALUES (?, ?, ?, ?)`
    );
    for (const profile of seedProfiles) {
        insertProfile.run(profile.cycle, profile.version, profile.uses, profile.model);
    }
    seedSubjectCatalog(db);
}

function createActiveRuleSet(db, year) {
    db.prepare(`INSERT INTO stage_rule_sets(school_year, revision, status, reason) VALUES (?, 1, 'active', ?)`)
        .run(year || YEAR, 'slice-7 stage fixture');
    return db
        .prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ? AND revision = 1`)
        .get(year || YEAR).id;
}

function ruleSetPayload({ ruleSet, coefficients, examCounts, weights } = {}) {
    return {
        ruleSet: ruleSet || {
            id: 1,
            school_year: YEAR,
            revision: 2,
            status: 'active',
            created_by: 'admin',
            reason: 'slice-7 stage fixture',
            created_at: '2026-08-01 00:00:00'
        },
        rows: {
            coefficients: coefficients || [],
            examCounts: examCounts || [],
            weights: weights || []
        }
    };
}

function coefficientRow(overrides) {
    return Object.assign(
        {
            cycle_code: QUALIFIANT,
            level_code: '2BAC',
            stream_code: '2BACSMA',
            subject_code: 'MATH',
            coefficient: 9,
            source: 'official',
            updated_by: null,
            reason: null,
            updated_at: '2026-08-01 00:00:00'
        },
        overrides
    );
}

function examCountRow(overrides) {
    return Object.assign(
        {
            cycle_code: QUALIFIANT,
            level_code: '2BAC',
            subject_code: 'MATH',
            exam_count: 3,
            source: 'official'
        },
        overrides
    );
}

function weightRow(overrides) {
    return Object.assign(
        {
            cycle_code: QUALIFIANT,
            subject_code: 'MATH',
            exam_weight_bps: 10000,
            activity_weight_bps: 0,
            source: 'official'
        },
        overrides
    );
}

/**
 * Load js/cc-rules.js into a FRESH vm sandbox (no shared cache between suites
 * or within a file). The stubbed getActive resolves `payload` (or null when
 * the test passes ruleSet inline via context). `extraGlobals` (e.g. the
 * collegial level catalog) is installed before the script runs.
 */
function loadCcRules(payload, extraGlobals) {
    const StageRulesErrorContract = require('../js/shared/errors/stage-rules-error-contract');
    const source = fs.readFileSync(path.join(ROOT, 'js', 'cc-rules.js'), 'utf8');
    const sandbox = Object.assign({ console, StageRulesErrorContract }, extraGlobals);
    sandbox.window = {
        api: {
            stageRules: {
                getActive: async () => payload || { ruleSet: null, rows: { coefficients: [], examCounts: [], weights: [] } }
            }
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

function throwsCode(fn, expectedCode) {
    let captured = null;
    assert.throws(
        fn,
        (error) => {
            captured = error;
            return error && error.code === expectedCode;
        },
        `expected throw with code ${expectedCode}`
    );
    return captured;
}

/** Build a renderer resolver context for one stage (explicit cycle — never defaulted). */
function stageContext(cycleCode, overrides) {
    return Object.assign({ cycleCode, schoolYear: YEAR }, overrides);
}

module.exports = {
    ROOT,
    COLLEGIAL,
    QUALIFIANT,
    PRIMARY,
    YEAR,
    openDb,
    withNoOpCapture,
    createStudentsSchema,
    insertStudent,
    createAccessSchema,
    seedInstitution,
    addUser,
    grantCycles,
    createRulesSchema,
    createActiveRuleSet,
    ruleSetPayload,
    coefficientRow,
    examCountRow,
    weightRow,
    loadCcRules,
    throwsCode,
    stageContext
};
