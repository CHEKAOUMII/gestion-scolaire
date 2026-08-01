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
db.exec(`
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE system_logs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        entity_type TEXT,
        entity_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

const actor = { userId: 7, name: 'مدير المؤسسة', email: 'admin@example.test', role: 'admin' };
const saved = subjectCoefficientsRepo.overrideMapping(
    db,
    {
        cycleCode: 'secondary_qualifiant',
        streamCode: '2BACSMA',
        subject: ' مادة مجهولة ',
        coefficient: 3,
        reason: 'تصحيح إعدادات المادة',
        schoolYear: '2025/2026'
    },
    actor
);

assert.strictEqual(saved.replaced, false);
assert.deepStrictEqual(subjectCoefficientsRepo.readMappings(db), [
    { cycleCode: 'secondary_qualifiant', streamCode: '2BACSMA', subject: 'مادة مجهولة', coefficient: 3 }
]);

const audit = db.prepare('SELECT action, details, entity_type FROM system_logs').get();
assert.strictEqual(audit.action, 'SUBJECT_COEFFICIENT_ADMIN_OVERRIDE');
assert.strictEqual(audit.entity_type, 'subject_coefficient');
const auditDetails = JSON.parse(audit.details);
assert.strictEqual(auditDetails.actor.userId, 7);
assert.strictEqual(auditDetails.reason, 'تصحيح إعدادات المادة');
assert.strictEqual(auditDetails.next.coefficient, 3);

assert.throws(
    () => subjectCoefficientsRepo.overrideMapping(db, {
        cycleCode: 'secondary_collegial',
        streamCode: '3APIC',
        subject: 'الرياضيات',
        coefficient: 5,
        reason: 'غير مسموح'
    }, actor),
    (error) => error.code === 'INVALID_SUBJECT_COEFFICIENT_OVERRIDE'
);

db.close();
console.log('[test] subject coefficient persistence and audit: all checks passed');
