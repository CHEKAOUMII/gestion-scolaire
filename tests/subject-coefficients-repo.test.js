'use strict';

const assert = require('assert');
const subjectCoefficientsRepo = require('../main/repos/subject-coefficients');

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.transaction = (work) => (...args) => {
            db.exec('BEGIN');
            try {
                const outcome = work(...args);
                db.exec('COMMIT');
                return outcome;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
        return db;
    }
}

const db = openDb();
db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);');

const legacyValue = JSON.stringify([
    { cycleCode: 'secondary_qualifiant', streamCode: '2BACSMA', subject: 'مادة مجهولة', coefficient: 3 }
]);
db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)').run(subjectCoefficientsRepo.SETTINGS_KEY, legacyValue);

// The legacy settings key must stay intact for rollback after migration 2026-08-078.
const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(subjectCoefficientsRepo.SETTINGS_KEY);
assert.strictEqual(row.value, legacyValue, 'legacy settings key retained untouched for rollback');

// The repo must no longer read the legacy key.
assert.deepStrictEqual(subjectCoefficientsRepo.readMappings(db), [], 'readMappings must not read legacy settings');

// The override feature is retired and must not write the legacy key.
assert.throws(
    () => subjectCoefficientsRepo.overrideMapping(db, {}, {}),
    (error) => error.code === 'RETIRED_SUBJECT_COEFFICIENT_OVERRIDE'
);

const after = db.prepare('SELECT value FROM settings WHERE key = ?').get(subjectCoefficientsRepo.SETTINGS_KEY);
assert.strictEqual(after.value, legacyValue, 'override must not write the legacy settings key');

db.close();
console.log('[test] subject coefficient repo rollback-only: all checks passed');
