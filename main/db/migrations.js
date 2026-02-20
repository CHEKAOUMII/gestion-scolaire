const { getDb } = require('./context');
const { ensureColumn, ensureLicensingSchema, ensureOwnerSyncSchema } = require('./schema');
const { generateRandomPassword, hashPassword } = require('../auth/password');

const MIGRATIONS = [
    {
        version: '2026-02-001-grades-section',
        up: () => ensureColumn('grades', 'section', 'TEXT')
    },
    {
        version: '2026-02-002-students-registration-type',
        up: () => ensureColumn('students', 'registration_type', "TEXT DEFAULT 'new'")
    },
    {
        version: '2026-02-003-teacher-absences-justified',
        up: () => ensureColumn('teacher_absences', 'justified', 'INTEGER DEFAULT 1')
    },
    {
        version: '2026-02-004-exam-proctors-date',
        up: () => ensureColumn('exam_proctors', 'date', 'TEXT')
    },
    {
        version: '2026-02-005-exam-proctors-session',
        up: () => ensureColumn('exam_proctors', 'session', 'TEXT')
    },
    {
        version: '2026-02-006-grades-teacher-name',
        up: () => ensureColumn('grades', 'teacher_name', 'TEXT')
    },
    {
        version: '2026-02-007-grades-level',
        up: () => ensureColumn('grades', 'level', 'TEXT')
    },
    {
        version: '2026-02-008-licensing-schema',
        up: () => ensureLicensingSchema()
    },
    {
        version: '2026-02-009-users-password-auth',
        up: () => {
            ensureColumn('users', 'password_hash', 'TEXT');
            const db = getDb();
            db.prepare(
                `
                    UPDATE users
                    SET password_hash = ?
                    WHERE lower(email) = 'admin@school.local'
                      AND (password_hash IS NULL OR trim(password_hash) = '')
                `
            ).run(hashPassword(generateRandomPassword()));
        }
    },
    {
        version: '2026-02-010-owner-sync-schema',
        up: () => ensureOwnerSyncSchema()
    },
    {
        version: '2026-02-011-owner-sync-token-split',
        up: () => {
            ensureColumn('owner_sync_config', 'write_token', 'TEXT');
            ensureColumn('owner_sync_config', 'read_token', 'TEXT');

            const db = getDb();
            db.prepare(
                `
                    UPDATE owner_sync_config
                    SET
                        write_token = CASE
                            WHEN trim(COALESCE(write_token, '')) = '' THEN owner_token
                            ELSE write_token
                        END,
                        read_token = CASE
                            WHEN trim(COALESCE(read_token, '')) = '' THEN owner_token
                            ELSE read_token
                        END
                    WHERE id = 1
                `
            ).run();
        }
    }
];

function ensureMigrationsTable() {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations(
            version TEXT PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

function runMigrations() {
    ensureMigrationsTable();
    const db = getDb();

    const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    for (const migration of MIGRATIONS) {
        if (appliedVersions.has(migration.version)) continue;

        migration.up();
        db.prepare('INSERT INTO schema_migrations(version) VALUES(?)').run(migration.version);
    }
}

module.exports = { runMigrations, ensureMigrationsTable };
