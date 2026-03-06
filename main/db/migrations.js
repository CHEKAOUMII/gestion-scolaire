const { getDb } = require('./context');
const { ensureColumn, ensureLicensingSchema, ensureOwnerSyncSchema, ensurePageVisibilitySchema } = require('./schema');
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
    },
    {
        version: '2026-02-012-page-visibility-controls',
        up: () => ensurePageVisibilitySchema()
    },
    {
        version: '2026-02-013-students-birth-place',
        up: () => ensureColumn('students', 'birth_place', 'TEXT')
    },
    {
        version: '2026-03-14-school-identity',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS school_identity (
                    key         TEXT PRIMARY KEY,
                    value       TEXT NOT NULL DEFAULT '',
                    updated_at  INTEGER DEFAULT (strftime('%s','now') * 1000)
                )
            `);
            const seed = db.prepare(
                'INSERT OR IGNORE INTO school_identity (key, value) VALUES (?, ?)'
            );
            const defaults = [
                ['country', 'المملكة المغربية'],
                ['ministry', 'وزارة التربية الوطنية والتعليم الأولي والرياضة'],
                ['academy', ''],
                ['directorate', ''],
                ['school_name', ''],
                ['school_code', ''],
                ['director_name', ''],
                ['director_title', 'مدير(ة) المؤسسة'],
                ['city', ''],
                ['logo_base64', ''],
                ['seal_base64', ''],
                ['signature_base64', ''],
                ['footer_text', 'سلمت هذه الوثيقة للمعني(ة) بالأمر قصد الاستعمال فيما يقتضيه.']
            ];
            const txn = db.transaction(() => {
                for (const [k, v] of defaults) seed.run(k, v);
            });
            txn();
        }
    },
    {
        version: '2026-03-015-notifications-table',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS notifications (
                    id          TEXT PRIMARY KEY,
                    type        TEXT NOT NULL,
                    severity    TEXT NOT NULL,
                    title       TEXT,
                    body        TEXT,
                    icon        TEXT,
                    read        INTEGER DEFAULT 0,
                    created_at  INTEGER NOT NULL,
                    meta        TEXT
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)`);
        }
    },
    {
        version: '2026-03-016-grades-unique-constraint',
        up: () => {
            const db = getDb();
            db.exec(`UPDATE grades SET student_code = '' WHERE student_code IS NULL`);
            db.exec(`UPDATE grades SET subject = '' WHERE subject IS NULL`);
            db.exec(`UPDATE grades SET semester = 0 WHERE semester IS NULL`);
            db.exec(`UPDATE grades SET school_year = '' WHERE school_year IS NULL`);
            db.exec(`
                DELETE FROM grades WHERE id NOT IN (
                    SELECT MAX(id) FROM grades
                    GROUP BY student_code, subject, semester, school_year
                )
            `);
            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_unique
                ON grades(student_code, subject, semester, school_year)
            `);
        }
    },
    {
        version: '2026-03-017-absences-unique-constraint',
        up: () => {
            const db = getDb();
            db.exec(`UPDATE absences SET student_code = '' WHERE student_code IS NULL`);
            db.exec(`UPDATE absences SET month = '' WHERE month IS NULL`);
            db.exec(`UPDATE absences SET school_year = '' WHERE school_year IS NULL`);
            db.exec(`UPDATE absences SET absence_type = 'unjustified' WHERE absence_type IS NULL`);
            db.exec(`
                UPDATE absences SET
                    hours = COALESCE((
                        SELECT SUM(a2.hours) FROM absences a2
                        WHERE a2.student_code = absences.student_code
                          AND a2.month = absences.month
                          AND a2.school_year = absences.school_year
                          AND a2.absence_type = absences.absence_type
                    ), absences.hours),
                    days = COALESCE((
                        SELECT SUM(a2.days) FROM absences a2
                        WHERE a2.student_code = absences.student_code
                          AND a2.month = absences.month
                          AND a2.school_year = absences.school_year
                          AND a2.absence_type = absences.absence_type
                    ), absences.days)
                WHERE id IN (
                    SELECT MAX(id) FROM absences
                    GROUP BY student_code, month, school_year, absence_type
                    HAVING COUNT(*) > 1
                )
            `);
            db.exec(`
                DELETE FROM absences WHERE id NOT IN (
                    SELECT MAX(id) FROM absences
                    GROUP BY student_code, month, school_year, absence_type
                )
            `);
            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_absences_unique
                ON absences(student_code, month, school_year, absence_type)
            `);
        }
    },
    {
        version: '2026-03-018-repair-unique-constraints',
        up: () => {
            const db = getDb();
            // Repair: if migrations 016/017 ran but failed on NULLs,
            // the index was never created. Fix NULLs and retry.
            db.exec(`UPDATE grades SET student_code = '' WHERE student_code IS NULL`);
            db.exec(`UPDATE grades SET subject = '' WHERE subject IS NULL`);
            db.exec(`UPDATE grades SET semester = 0 WHERE semester IS NULL`);
            db.exec(`UPDATE grades SET school_year = '' WHERE school_year IS NULL`);
            db.exec(`
                DELETE FROM grades WHERE id NOT IN (
                    SELECT MAX(id) FROM grades
                    GROUP BY student_code, subject, semester, school_year
                )
            `);
            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_unique
                ON grades(student_code, subject, semester, school_year)
            `);

            db.exec(`UPDATE absences SET student_code = '' WHERE student_code IS NULL`);
            db.exec(`UPDATE absences SET month = '' WHERE month IS NULL`);
            db.exec(`UPDATE absences SET school_year = '' WHERE school_year IS NULL`);
            db.exec(`UPDATE absences SET absence_type = 'unjustified' WHERE absence_type IS NULL`);
            db.exec(`
                DELETE FROM absences WHERE id NOT IN (
                    SELECT MAX(id) FROM absences
                    GROUP BY student_code, month, school_year, absence_type
                )
            `);
            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_absences_unique
                ON absences(student_code, month, school_year, absence_type)
            `);
        }
    },
    {
        version: '2026-03-019-students-unique-constraint-year',
        up: () => {
            const db = getDb();
            // Check if we need to migrate (if code is UNIQUE)
            const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='students'").get();
            if (tableInfo && tableInfo.sql.includes('code TEXT UNIQUE')) {
                db.exec('PRAGMA foreign_keys=off;');
                const txn = db.transaction(() => {
                    db.exec(`
                        CREATE TABLE IF NOT EXISTS students_new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            code TEXT,
                            full_name TEXT NOT NULL,
                            family_name TEXT,
                            birth_date TEXT,
                            birth_place TEXT,
                            gender TEXT,
                            section TEXT,
                            school_year TEXT,
                            status TEXT DEFAULT 'active',
                            registration_type TEXT DEFAULT 'new',
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE(code, school_year)
                        );
                    `);

                    db.exec(`
                        INSERT INTO students_new (id, code, full_name, family_name, birth_date, birth_place, gender, section, school_year, status, registration_type, created_at)
                        SELECT id, code, full_name, family_name, birth_date, birth_place, gender, section, school_year, status, COALESCE(registration_type, 'new'), created_at
                        FROM students;
                    `);

                    db.exec('DROP TABLE students;');
                    db.exec('ALTER TABLE students_new RENAME TO students;');

                    db.exec('CREATE INDEX IF NOT EXISTS idx_students_year ON students(school_year);');
                    db.exec('CREATE INDEX IF NOT EXISTS idx_students_code_year ON students(code, school_year);');
                });
                txn();
                db.exec('PRAGMA foreign_keys=on;');
            }
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
