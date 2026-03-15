const { getDb } = require('./context');
const { ensureColumn, ensureLicensingSchema, ensureOwnerSyncSchema, ensurePageVisibilitySchema } = require('./schema');
const { generateRandomPassword, hashPassword } = require('../auth/password');
const { normalizeTeacherName, seedTeacherAliases, resolveTeacherIdentity } = require('../teachers/identity');

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
            const seed = db.prepare('INSERT OR IGNORE INTO school_identity (key, value) VALUES (?, ?)');
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
    },
    {
        version: '2026-03-020-staff-attendance-teacher-name',
        up: () => {
            const db = getDb();
            // Add teacher_name column if staff_attendance table exists without it
            try {
                db.exec(`ALTER TABLE staff_attendance ADD COLUMN teacher_name TEXT`);
            } catch (_e) {
                // Column already exists or table doesn't exist yet
            }
        }
    },
    {
        version: '2026-03-021-staff-attendance-subject',
        up: () => {
            const db = getDb();
            try {
                db.exec(`ALTER TABLE staff_attendance ADD COLUMN subject TEXT`);
            } catch (_e) {
                // Column already exists
            }
        }
    },
    {
        version: '2026-03-022-user-pin-support',
        up: () => {
            ensureColumn('users', 'pin_hash', 'TEXT');
            ensureColumn('users', 'pin_failed_attempts', 'INTEGER DEFAULT 0');
        }
    },
    {
        version: '2026-03-023-teachers-admin-columns',
        up: () => {
            const db = getDb();
            ensureColumn('teachers', 'ppr', 'TEXT');
            ensureColumn('teachers', 'cin', 'TEXT');
            ensureColumn('teachers', 'full_name_fr', 'TEXT');
            ensureColumn('teachers', 'gender', 'TEXT');
            ensureColumn('teachers', 'birth_date', 'TEXT');
            ensureColumn('teachers', 'birth_place', 'TEXT');
            ensureColumn('teachers', 'address', 'TEXT');
            ensureColumn('teachers', 'grade', 'TEXT');
            ensureColumn('teachers', 'cadre', 'TEXT');
            ensureColumn('teachers', 'echelon', 'INTEGER');
            ensureColumn('teachers', 'hire_date', 'TEXT');
            ensureColumn('teachers', 'marital_status', 'TEXT');
            ensureColumn('teachers', 'function_title', 'TEXT');
            ensureColumn('teachers', 'source', "TEXT DEFAULT 'manual'");
            // Partial unique index on ppr+school_year (only when ppr is set)
            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_ppr_year
                ON teachers(ppr, school_year)
                WHERE ppr IS NOT NULL AND ppr != ''
            `);
        }
    },
    {
        version: '2026-03-024-teachers-specialty-subject',
        up: () => {
            ensureColumn('teachers', 'specialty_subject', 'TEXT');
        }
    },
    {
        version: '2026-03-025-teachers-ministry-fields',
        up: () => {
            ensureColumn('teachers', 'position', 'TEXT');
            ensureColumn('teachers', 'statut', 'TEXT');
            ensureColumn('teachers', 'diploma_school', 'TEXT');
            ensureColumn('teachers', 'diploma_professional', 'TEXT');
            ensureColumn('teachers', 'seniority_admin', 'TEXT');
            ensureColumn('teachers', 'seniority_grade', 'TEXT');
            ensureColumn('teachers', 'echelon_date', 'TEXT');
            ensureColumn('teachers', 'titularization_date', 'TEXT');
            ensureColumn('teachers', 'total_hours', 'REAL');
            ensureColumn('teachers', 'overtime_hours', 'REAL');
            ensureColumn('teachers', 'num_classes', 'REAL');
        }
    },
    {
        version: '2026-03-026-school-events-table',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS school_events (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_date  TEXT NOT NULL,
                    event_type  TEXT NOT NULL,
                    details     TEXT,
                    event_time  TEXT,
                    school_year TEXT NOT NULL,
                    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_school_events_date ON school_events(event_date, school_year)`);
        }
    },
    {
        version: '2026-03-027-compensation-tracking',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS compensation_tracking (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    absence_date     TEXT NOT NULL,
                    teacher_name     TEXT NOT NULL,
                    section          TEXT NOT NULL,
                    period_slot      TEXT NOT NULL,
                    period_time      TEXT,
                    subject          TEXT,
                    compensated      INTEGER DEFAULT 0,
                    compensated_date TEXT,
                    notes            TEXT,
                    school_year      TEXT NOT NULL,
                    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(absence_date, teacher_name, section, period_slot, school_year)
                )
            `);
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_compensation_date_year ON compensation_tracking(absence_date, school_year)`
            );
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_compensation_pending ON compensation_tracking(compensated, school_year)`
            );
        }
    },
    {
        version: '2026-03-028-teacher-identity-foundation',
        up: () => {
            const db = getDb();
            ensureColumn('grades', 'teacher_id', 'INTEGER');
            ensureColumn('tests', 'teacher_id', 'INTEGER');
            ensureColumn('compensation_tracking', 'teacher_id', 'INTEGER');

            db.exec(`
                CREATE TABLE IF NOT EXISTS teacher_aliases(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    teacher_id INTEGER NOT NULL,
                    alias_name TEXT NOT NULL,
                    alias_normalized TEXT NOT NULL,
                    source TEXT,
                    school_year TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(teacher_id) REFERENCES teachers(id),
                    UNIQUE(teacher_id, school_year, alias_normalized)
                )
            `);
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_teacher_aliases_lookup ON teacher_aliases(school_year, alias_normalized)`
            );
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_teacher_aliases_teacher ON teacher_aliases(teacher_id, school_year)`
            );
            db.exec(`CREATE INDEX IF NOT EXISTS idx_grades_year_teacher ON grades(school_year, teacher_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tests_year_teacher ON tests(school_year, teacher_id)`);
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_compensation_year_teacher ON compensation_tracking(school_year, teacher_id)`
            );

            const teachers = db
                .prepare("SELECT * FROM teachers WHERE school_year IS NOT NULL AND TRIM(school_year) != ''")
                .all();
            const txn = db.transaction(() => {
                for (const teacher of teachers) {
                    seedTeacherAliases(db, teacher, teacher.source || 'migration');
                }

                const grades = db.prepare('SELECT id, teacher_id, teacher_name, school_year FROM grades').all();
                const updateGrade = db.prepare('UPDATE grades SET teacher_id = ?, teacher_name = ? WHERE id = ?');
                for (const grade of grades) {
                    if (Number(grade.teacher_id) > 0) continue;
                    const resolved = resolveTeacherIdentity(db, {
                        teacher_name: grade.teacher_name,
                        school_year: grade.school_year,
                        source: 'migration:grades'
                    });
                    if (resolved.teacher_id) {
                        updateGrade.run(
                            resolved.teacher_id,
                            resolved.teacher_name || grade.teacher_name || null,
                            grade.id
                        );
                    }
                }

                const tests = db.prepare('SELECT id, teacher_id, teacher_name, school_year FROM tests').all();
                const updateTest = db.prepare('UPDATE tests SET teacher_id = ?, teacher_name = ? WHERE id = ?');
                for (const test of tests) {
                    if (Number(test.teacher_id) > 0) continue;
                    const resolved = resolveTeacherIdentity(db, {
                        teacher_name: test.teacher_name,
                        school_year: test.school_year,
                        source: 'migration:tests'
                    });
                    if (resolved.teacher_id) {
                        updateTest.run(
                            resolved.teacher_id,
                            resolved.teacher_name || test.teacher_name || null,
                            test.id
                        );
                    }
                }

                const compensationRows = db
                    .prepare('SELECT id, teacher_id, teacher_name, school_year FROM compensation_tracking')
                    .all();
                const updateCompensation = db.prepare(
                    'UPDATE compensation_tracking SET teacher_id = ?, teacher_name = ? WHERE id = ?'
                );
                for (const row of compensationRows) {
                    if (Number(row.teacher_id) > 0) continue;
                    const resolved = resolveTeacherIdentity(db, {
                        teacher_name: row.teacher_name,
                        school_year: row.school_year,
                        source: 'migration:compensation'
                    });
                    if (resolved.teacher_id) {
                        updateCompensation.run(
                            resolved.teacher_id,
                            resolved.teacher_name || row.teacher_name || null,
                            row.id
                        );
                    }
                }

                const canonicalRows = db.prepare('SELECT id, full_name, school_year FROM teachers').all();
                for (const row of canonicalRows) {
                    const normalized = normalizeTeacherName(row.full_name);
                    if (!normalized) continue;
                    db.prepare(
                        `
                            INSERT INTO teacher_aliases(teacher_id, alias_name, alias_normalized, source, school_year)
                            VALUES(?, ?, ?, ?, ?)
                            ON CONFLICT(teacher_id, school_year, alias_normalized) DO NOTHING
                        `
                    ).run(row.id, row.full_name, normalized, 'migration:canonical', row.school_year);
                }
            });
            txn();
        }
    },
    {
        version: '2026-03-029-teachers-surplus-flag',
        up: () => {
            const db = getDb();
            ensureColumn('teachers', 'is_surplus', 'INTEGER DEFAULT 0');
            db.exec(`
                UPDATE teachers
                SET is_surplus = CASE
                    WHEN
                        instr(lower(coalesce(function_title, '')), 'surnombre') > 0 OR
                        instr(lower(coalesce(function_title, '')), 'excedentaire') > 0 OR
                        instr(coalesce(function_title, ''), 'excédentaire') > 0 OR
                        instr(lower(coalesce(position, '')), 'surnombre') > 0 OR
                        instr(lower(coalesce(position, '')), 'excedentaire') > 0 OR
                        instr(coalesce(position, ''), 'excédentaire') > 0 OR
                        instr(lower(coalesce(statut, '')), 'surnombre') > 0 OR
                        instr(lower(coalesce(statut, '')), 'excedentaire') > 0 OR
                        instr(coalesce(statut, ''), 'excédentaire') > 0 OR
                        instr(coalesce(function_title, ''), 'فائض') > 0 OR
                        instr(coalesce(position, ''), 'فائض') > 0 OR
                        instr(coalesce(statut, ''), 'فائض') > 0
                    THEN 1
                    ELSE COALESCE(is_surplus, 0)
                END
            `);
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
