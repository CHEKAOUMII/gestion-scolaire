const { getDb } = require('./context');
const {
    ensureColumn,
    ensureInstitutionSchema,
    ensureLicensingSchema,
    ensureOwnerSyncSchema,
    ensurePageVisibilitySchema,
    ensureSyncSchema
} = require('./schema');
const { generateRandomPassword, hashPassword } = require('../auth/password');
const { seedSyncDefaults } = require('../sync/defaults');
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
        recordsVersionInternally: true,
        up: () => {
            const db = getDb();
            const recordMigration = db.prepare('INSERT INTO schema_migrations(version) VALUES(?)');
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
                    recordMigration.run('2026-03-019-students-unique-constraint-year');
                });
                try {
                    txn();
                } finally {
                    db.exec('PRAGMA foreign_keys=on;');
                }
                return;
            }

            recordMigration.run('2026-03-019-students-unique-constraint-year');
        }
    },
    {
        version: '2026-03-020-staff-attendance-teacher-name',
        up: () => {
            const db = getDb();
            // Add teacher_name column if staff_attendance table exists without it
            try {
                db.exec(`ALTER TABLE staff_attendance ADD COLUMN teacher_name TEXT`);
            } catch {
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
            } catch {
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
    },
    {
        version: '2026-03-030-sync-foundation',
        up: () => {
            const db = getDb();
            ensureSyncSchema(db);
        }
    },
    {
        version: '2026-03-031-push-engine-config',
        up: () => {
            ensureColumn('sync_config', 'auth_lambda_url', 'TEXT');
            ensureColumn('sync_config', 'aws_region', "TEXT DEFAULT 'us-east-1'");
            ensureColumn('sync_config', 'last_push_at', 'DATETIME');
            ensureColumn('sync_config', 'last_push_error', 'TEXT');
            ensureColumn('sync_config', 'push_batch_size', 'INTEGER DEFAULT 100');
            ensureColumn('sync_config', 'max_retries', 'INTEGER DEFAULT 10');
            ensureColumn('sync_config', 'school_id', 'TEXT');
        }
    },
    {
        version: '2026-03-032-pull-engine',
        up: () => {
            const db = getDb();

            // 1. Create sync_conflicts table
            db.exec(`
                CREATE TABLE IF NOT EXISTS sync_conflicts (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    table_name        TEXT     NOT NULL,
                    row_sync_id       TEXT     NOT NULL,
                    entity_type       TEXT     NOT NULL,
                    local_data        TEXT,
                    remote_data       TEXT     NOT NULL,
                    remote_version    INTEGER  NOT NULL,
                    remote_device_hash TEXT    NOT NULL,
                    local_outbox_id   INTEGER,
                    status            TEXT     NOT NULL DEFAULT 'unresolved'
                                      CHECK(status IN ('unresolved','resolved')),
                    resolution        TEXT     CHECK(resolution IN ('local','remote','merged')),
                    resolved_at       DATETIME,
                    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(status, created_at);
                CREATE INDEX IF NOT EXISTS idx_sync_conflicts_row ON sync_conflicts(table_name, row_sync_id);
            `);

            // 2. Add pull-engine columns to sync_config
            ensureColumn('sync_config', 'pull_cursor', 'TEXT');
            ensureColumn('sync_config', 'last_pull_at', 'DATETIME');
            ensureColumn('sync_config', 'last_pull_error', 'TEXT');

            // 3. Add push-engine columns to sync_config (idempotent)
            ensureColumn('sync_config', 'auth_lambda_url', 'TEXT');
            ensureColumn('sync_config', 'aws_region', "TEXT DEFAULT 'us-east-1'");
            ensureColumn('sync_config', 'last_push_at', 'DATETIME');
            ensureColumn('sync_config', 'last_push_error', 'TEXT');
            ensureColumn('sync_config', 'push_batch_size', 'INTEGER DEFAULT 100');
            ensureColumn('sync_config', 'max_retries', 'INTEGER DEFAULT 10');
            ensureColumn('sync_config', 'school_id', 'TEXT');

            // 4. Add conflict detection index on sync_outbox
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_sync_outbox_conflict_check ON sync_outbox(status, table_name, row_sync_id);
            `);
        }
    },
    {
        version: '2026-03-033-integrity-conflict-resolution',
        up: () => {
            const db = getDb();

            // 1. Snapshot table for re-snapshot checker
            db.exec(`
                CREATE TABLE IF NOT EXISTS sync_snapshots (
                    row_sync_id TEXT PRIMARY KEY,
                    table_name  TEXT NOT NULL,
                    checksum    TEXT NOT NULL,
                    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_sync_snapshots_table ON sync_snapshots(table_name)');

            // 2. Enrich sync_conflicts with merge details
            ensureColumn('sync_conflicts', 'ancestor_data', 'TEXT');
            ensureColumn('sync_conflicts', 'conflicting_fields', 'TEXT');
            ensureColumn('sync_conflicts', 'resolution_method', 'TEXT');
            ensureColumn('sync_conflicts', 'resolved_data', 'TEXT');

            // 3. Version tracking + ancestor in sync_id_map
            ensureColumn('sync_id_map', 'version', 'INTEGER DEFAULT 0');
            ensureColumn('sync_id_map', 'ancestor_data', 'TEXT');

            // 4. Snapshot config
            ensureColumn('sync_config', 'snapshot_interval_minutes', 'INTEGER DEFAULT 30');
            ensureColumn('sync_config', 'last_snapshot_at', 'DATETIME');
            ensureColumn('sync_config', 'last_snapshot_error', 'TEXT');
        }
    },
    {
        version: '2026-03-034-sync-config-license-key',
        up: () => {
            ensureColumn('sync_config', 'license_key', 'TEXT');
        }
    },
    {
        version: '2026-03-035-institution-device-linking',
        up: () => {
            const db = getDb();
            ensureInstitutionSchema(db);

            const syncRow = db.prepare('SELECT school_id FROM sync_config WHERE id = 1').get();
            const schoolId = String(syncRow?.school_id || '').trim();
            if (!schoolId) {
                return;
            }

            db.prepare(
                `
                    INSERT INTO institution_config (id, code_etablissement, setup_completed, setup_mode, updated_at)
                    VALUES (1, ?, 1, 'linked', CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET
                        code_etablissement = excluded.code_etablissement,
                        setup_completed = 1,
                        updated_at = CURRENT_TIMESTAMP
                `
            ).run(schoolId);
        }
    },
    {
        version: '2026-03-036-sync-app-defaults',
        up: () => {
            const db = getDb();
            seedSyncDefaults(db);
        }
    },
    {
        version: '2026-03-038-massar-schoolid-sync',
        up: () => {
            const db = getDb();
            const inst = db.prepare('SELECT code_etablissement FROM institution_config WHERE id = 1').get();
            if (inst && inst.code_etablissement) {
                db.prepare(
                    `UPDATE sync_config SET school_id = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = 1 AND (school_id IS NULL OR school_id != ?)`
                ).run(inst.code_etablissement, inst.code_etablissement);
            }
        },
        recordsVersionInternally: false
    },
    {
        version: '2026-03-039-page-visibility-seed-all',
        up: () => ensurePageVisibilitySchema()
    },
    {
        version: '2026-03-29-support-sessions',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS support_sessions (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    teacher_id        INTEGER,
                    teacher_name      TEXT,
                    subject           TEXT NOT NULL,
                    section           TEXT NOT NULL,
                    room              TEXT,
                    session_date      TEXT NOT NULL,
                    time_from         TEXT NOT NULL,
                    time_to           TEXT NOT NULL,
                    duration_hours    REAL,
                    attendance_status TEXT NOT NULL
                        CHECK(attendance_status IN ('full','partial','absent')),
                    school_year       TEXT NOT NULL,
                    created_at        TEXT DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_support_sessions_year
                    ON support_sessions(school_year);
                CREATE INDEX IF NOT EXISTS idx_support_sessions_teacher
                    ON support_sessions(teacher_id, school_year);
            `);
        }
    },
    {
        version: '2026-03-29-support-sessions-unique',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_support_sessions_unique
                ON support_sessions(teacher_id, session_date, time_from, section, school_year)
            `);
        }
    },
    {
        version: '2026-04-040-staff-attendance-absence-period',
        up: () => {
            ensureColumn('staff_attendance', 'absence_period', "TEXT DEFAULT 'full_day'");
        }
    },
    {
        version: '2026-04-041-compensation-tracking-reason-notes',
        up: () => {
            ensureColumn('compensation_tracking', 'reason', 'TEXT');
            ensureColumn('compensation_tracking', 'notes', 'TEXT');
        }
    },
    {
        version: '2026-04-042-name-aliases',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS name_aliases (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_type       TEXT NOT NULL,
                    canonical_id      INTEGER NOT NULL,
                    alias_text        TEXT NOT NULL,
                    alias_normalized  TEXT NOT NULL,
                    source            TEXT NOT NULL,
                    school_year       TEXT,
                    confidence        REAL DEFAULT 1.0,
                    created_at        TEXT DEFAULT (datetime('now')),
                    UNIQUE(entity_type, alias_normalized, school_year)
                );
                CREATE INDEX IF NOT EXISTS idx_name_aliases_lookup
                    ON name_aliases(entity_type, alias_normalized, school_year);
            `);
        }
    },
    {
        version: '2026-04-044-timetable-data-table',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS timetable_data (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    school_year  TEXT NOT NULL,
                    data_json    TEXT NOT NULL,
                    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(school_year)
                )
            `);
        }
    },
    {
        version: '2026-04-045-system-tags',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS system_tags (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    tag_date        TEXT NOT NULL,
                    entity_type     TEXT NOT NULL
                                    CHECK(entity_type IN ('teacher','section')),
                    entity_id       INTEGER,
                    entity_name     TEXT NOT NULL,
                    tag_key         TEXT NOT NULL,
                    tag_label       TEXT NOT NULL,
                    details         TEXT,
                    school_year     TEXT NOT NULL,
                    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(tag_date, entity_type, entity_name, tag_key, school_year)
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_system_tags_date ON system_tags(tag_date, school_year)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_system_tags_entity ON system_tags(entity_type, entity_name, school_year)`);
        }
    },
    {
        version: '2026-04-046-system-tags-notes',
        up: () => {
            ensureColumn('system_tags', 'note_group', 'TEXT');
            ensureColumn('system_tags', 'note_text', 'TEXT');
        }
    },
    {
        version: '2026-04-047-system-tags-fix-unique',
        up: () => {
            // The original UNIQUE(tag_date, entity_type, entity_name, tag_key, school_year)
            // prevents saving a second same-day note for the same entity+tag.
            // Also ignores entity_id, so two teachers with identical display names collide.
            // SQLite cannot DROP a constraint, so we recreate the table preserving all data.
            // We add a scoped partial unique index for non-note tags (note_group IS NULL)
            // so standalone tags remain idempotent, while multi-mention notes (note_group set)
            // are deduplicated per note_group+entity via a separate index.
            const db = getDb();
            db.exec(`
                CREATE TABLE system_tags_new (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    tag_date        TEXT NOT NULL,
                    entity_type     TEXT NOT NULL
                                    CHECK(entity_type IN ('teacher','section')),
                    entity_id       INTEGER,
                    entity_name     TEXT NOT NULL,
                    tag_key         TEXT NOT NULL,
                    tag_label       TEXT NOT NULL,
                    details         TEXT,
                    school_year     TEXT NOT NULL,
                    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                    note_group      TEXT,
                    note_text       TEXT
                )
            `);
            db.exec(`INSERT INTO system_tags_new SELECT * FROM system_tags`);
            db.exec(`DROP TABLE system_tags`);
            db.exec(`ALTER TABLE system_tags_new RENAME TO system_tags`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_system_tags_date ON system_tags(tag_date, school_year)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_system_tags_entity ON system_tags(entity_type, entity_name, school_year)`);
            // Idempotency for standalone tags (no note_group): same entity+tag on same day is blocked.
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uidx_system_tags_standalone
                     ON system_tags(tag_date, entity_type, COALESCE(entity_id, -1), entity_name, tag_key, school_year)
                     WHERE note_group IS NULL`);
            // Idempotency for note rows: same note_group cannot mention the same entity twice.
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uidx_system_tags_note_entity
                     ON system_tags(note_group, entity_type, COALESCE(entity_id, -1), entity_name)
                     WHERE note_group IS NOT NULL`);
        }
    },
    {
        version: '2026-04-048-student-profile-data',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS student_profile_data (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id    INTEGER NOT NULL,
                    student_code  TEXT NOT NULL,
                    tab_key       TEXT NOT NULL
                                  CHECK(tab_key IN ('economic','social','health','followup')),
                    data_json     TEXT NOT NULL DEFAULT '{}',
                    school_year   TEXT NOT NULL,
                    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_by    TEXT,
                    UNIQUE(student_code, tab_key, school_year)
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_student_profile_student ON student_profile_data(student_code, school_year)`);
        }
    },
    {
        version: '2026-04-049-system-tags-allow-general',
        up: () => {
            // The entity_type CHECK constraint only allows ('teacher','section') but
            // saveNote inserts 'general' for entries without @mentions, causing
            // silent INSERT failures. Recreate the table with the corrected constraint.
            const db = getDb();
            db.exec(`
                CREATE TABLE system_tags_v2 (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    tag_date        TEXT NOT NULL,
                    entity_type     TEXT NOT NULL
                                    CHECK(entity_type IN ('teacher','section','general')),
                    entity_id       INTEGER,
                    entity_name     TEXT NOT NULL,
                    tag_key         TEXT NOT NULL,
                    tag_label       TEXT NOT NULL,
                    details         TEXT,
                    school_year     TEXT NOT NULL,
                    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                    note_group      TEXT,
                    note_text       TEXT
                )
            `);
            db.exec(`INSERT INTO system_tags_v2 SELECT * FROM system_tags`);
            db.exec(`DROP TABLE system_tags`);
            db.exec(`ALTER TABLE system_tags_v2 RENAME TO system_tags`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_system_tags_date ON system_tags(tag_date, school_year)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_system_tags_entity ON system_tags(entity_type, entity_name, school_year)`);
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uidx_system_tags_standalone
                     ON system_tags(tag_date, entity_type, COALESCE(entity_id, -1), entity_name, tag_key, school_year)
                     WHERE note_group IS NULL`);
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uidx_system_tags_note_entity
                     ON system_tags(note_group, entity_type, COALESCE(entity_id, -1), entity_name)
                     WHERE note_group IS NOT NULL`);
        }
    },
    {
        version: '2026-04-15-role-hierarchy',
        up() {
            // Rename legacy 'staff' rows to 'principal' as safest default upgrade.
            // Admins should reassign roles via settings-users.html after deployment.
            const db = getDb();
            db.prepare("UPDATE users SET role = 'principal' WHERE role = 'staff'").run();
        },
    },
    {
        version: '2026-04-18-firebase-sync-config',
        up() {
            ensureColumn('sync_config', 'firebase_functions_url', 'TEXT DEFAULT \'\'');
            ensureColumn('sync_config', 'firebase_project_id', 'TEXT DEFAULT \'\'');
        }
    },
    {
        version: '2026-04-19-backfill-firebase-functions-url',
        up() {
            const db = getDb();
            db.prepare(
                `
                    UPDATE sync_config
                    SET
                        firebase_functions_url = CASE
                            WHEN COALESCE(trim(firebase_functions_url), '') = ''
                                 AND COALESCE(trim(auth_lambda_url), '') != ''
                            THEN trim(auth_lambda_url)
                            ELSE firebase_functions_url
                        END,
                        updated_at = CASE
                            WHEN COALESCE(trim(firebase_functions_url), '') = ''
                                 AND COALESCE(trim(auth_lambda_url), '') != ''
                            THEN CURRENT_TIMESTAMP
                            ELSE updated_at
                        END
                    WHERE id = 1
                `
            ).run();
        }
    },
    {
        version: '2026-04-22-firebase-onboarding-auth-schema',
        up() {
            const db = getDb();

            ensureColumn('users', 'firebase_uid', 'TEXT');
            ensureColumn('users', 'auth_source', "TEXT DEFAULT 'local'");
            ensureColumn('users', 'email_verified', 'INTEGER DEFAULT 0');
            ensureColumn('users', 'invite_status', "TEXT DEFAULT 'active'");
            ensureColumn('users', 'last_login_at', 'DATETIME');
            ensureColumn('users', 'last_auth_mode', 'TEXT');

            db.prepare(
                `
                    UPDATE users
                    SET
                        auth_source = CASE
                            WHEN COALESCE(trim(firebase_uid), '') = '' THEN 'local'
                            WHEN COALESCE(trim(auth_source), '') = '' THEN 'local'
                            ELSE auth_source
                        END,
                        email_verified = COALESCE(email_verified, 0),
                        invite_status = CASE
                            WHEN COALESCE(trim(invite_status), '') = '' THEN 'active'
                            ELSE invite_status
                        END
                `
            ).run();

            db.exec(`
                UPDATE users
                SET firebase_uid = NULL
                WHERE firebase_uid IS NOT NULL
                  AND trim(firebase_uid) != ''
                  AND id NOT IN (
                      SELECT MIN(id)
                      FROM users
                      WHERE firebase_uid IS NOT NULL AND trim(firebase_uid) != ''
                      GROUP BY firebase_uid
                  )
            `);

            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS uidx_users_firebase_uid
                ON users(firebase_uid)
                WHERE firebase_uid IS NOT NULL AND trim(firebase_uid) != '';
            `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_users_auth_source ON users(auth_source)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_users_invite_status ON users(invite_status)');

            ensureColumn('sync_config', 'firebase_api_key', 'TEXT DEFAULT \'\'');
            ensureColumn('sync_config', 'firebase_auth_domain', 'TEXT DEFAULT \'\'');
            ensureColumn('sync_config', 'firebase_app_id', 'TEXT DEFAULT \'\'');
            ensureColumn('sync_config', 'firebase_storage_bucket', 'TEXT DEFAULT \'\'');
            ensureColumn('sync_config', 'firebase_messaging_sender_id', 'TEXT DEFAULT \'\'');

            ensureColumn('institution_config', 'onboarding_version', 'INTEGER DEFAULT 1');
            ensureColumn('institution_config', 'onboarding_completed_at', 'DATETIME');
        }
    },
    {
        version: '2026-04-050-inspectors-table',
        up() {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS inspectors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    specialty TEXT NOT NULL,
                    phone TEXT DEFAULT '',
                    email TEXT DEFAULT '',
                    status TEXT DEFAULT 'نشط',
                    last_visit_date TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
                    school_year TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            db.exec('CREATE INDEX IF NOT EXISTS idx_inspectors_year ON inspectors(school_year)');
            db.exec('CREATE INDEX IF NOT EXISTS idx_inspectors_specialty ON inspectors(school_year, specialty)');
        }
    },
    {
        version: '2026-04-051-normalize-subject-names',
        up() {
            const db = getDb();
            // أسماء عربية بديلة → الاسم القياسي
            const aliases = {
                'الاجتماعيات': 'التاريخ والجغرافيا',
            };
            const stmt = db.prepare(
                `UPDATE compensation_tracking SET subject = ? WHERE subject = ?`
            );
            const txn = db.transaction(() => {
                for (const [oldName, newName] of Object.entries(aliases)) {
                    stmt.run(newName, oldName);
                }
            });
            txn();
        }
    },
    {
        version: '2026-04-052-system-tags-allow-inspector-subject',
        up: () => {
            // Expand entity_type to support inspector and subject mentions while
            // preserving note columns and the current index layout.
            const db = getDb();
            db.exec(`
                CREATE TABLE system_tags_v3 (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    tag_date        TEXT NOT NULL,
                    entity_type     TEXT NOT NULL
                                    CHECK(entity_type IN ('teacher','section','general','inspector','subject')),
                    entity_id       INTEGER,
                    entity_name     TEXT NOT NULL,
                    tag_key         TEXT NOT NULL,
                    tag_label       TEXT NOT NULL,
                    details         TEXT,
                    school_year     TEXT NOT NULL,
                    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                    note_group      TEXT,
                    note_text       TEXT
                )
            `);
            db.exec(`INSERT INTO system_tags_v3 SELECT * FROM system_tags`);
            db.exec(`DROP TABLE system_tags`);
            db.exec(`ALTER TABLE system_tags_v3 RENAME TO system_tags`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_system_tags_date ON system_tags(tag_date, school_year)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_system_tags_entity ON system_tags(entity_type, entity_name, school_year)`);
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uidx_system_tags_standalone
                     ON system_tags(tag_date, entity_type, COALESCE(entity_id, -1), entity_name, tag_key, school_year)
                     WHERE note_group IS NULL`);
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uidx_system_tags_note_entity
                     ON system_tags(note_group, entity_type, COALESCE(entity_id, -1), entity_name)
                     WHERE note_group IS NOT NULL`);
        }
    },
    {
        version: '2026-04-053-staff-attendance-unique',
        up: () => {
            const db = getDb();
            db.exec(`
                DELETE FROM staff_attendance
                WHERE type = 'absence'
                  AND id NOT IN (
                    SELECT MIN(id)
                    FROM staff_attendance
                    WHERE type = 'absence'
                    GROUP BY
                        attendance_date,
                        school_year,
                        COALESCE(teacher_id, -1),
                        COALESCE(teacher_name, ''),
                        COALESCE(absence_period, 'full_day')
                  )
            `);
            db.exec(`
                DELETE FROM staff_attendance
                WHERE type = 'late'
                  AND id NOT IN (
                    SELECT MIN(id)
                    FROM staff_attendance
                    WHERE type = 'late'
                    GROUP BY
                        attendance_date,
                        school_year,
                        COALESCE(teacher_id, -1),
                        COALESCE(teacher_name, '')
                  )
            `);
            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS uidx_staff_attendance_absence
                ON staff_attendance(
                    attendance_date,
                    school_year,
                    COALESCE(teacher_id, -1),
                    COALESCE(teacher_name, ''),
                    COALESCE(absence_period, 'full_day')
                )
                WHERE type = 'absence'
            `);
            db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS uidx_staff_attendance_late
                ON staff_attendance(
                    attendance_date,
                    school_year,
                    COALESCE(teacher_id, -1),
                    COALESCE(teacher_name, '')
                )
                WHERE type = 'late'
            `);
        }
    },
    {
        version: '2026-04-054-sync-credential-store',
        up: () => {
            ensureColumn('sync_config', 'firebase_email', 'TEXT');
            ensureColumn('sync_config', 'firebase_credential', 'TEXT');
        }
    },
    {
        version: '2026-05-055-exam-proctors-extra-columns',
        up: () => {
            ensureColumn('exam_proctors', 'cin', 'TEXT');
            ensureColumn('exam_proctors', 'som', 'TEXT');
            ensureColumn('exam_proctors', 'gender', 'TEXT');
            ensureColumn('exam_proctors', 'specialty', 'TEXT');
        }
    },
    {
        version: '2026-05-056-exam-proctors-workplace',
        up: () => {
            ensureColumn('exam_proctors', 'workplace', 'TEXT');
        }
    },
    {
        version: '2026-05-057-exam-proctors-name-fr',
        up: () => {
            ensureColumn('exam_proctors', 'teacher_name_fr', 'TEXT');
        }
    },
    {
        version: '2026-05-058-exam-invitations',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS exam_invitations (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    school_year     TEXT NOT NULL,
                    teacher_id      INTEGER,
                    teacher_name    TEXT NOT NULL,
                    sent_at         DATETIME,
                    notes           TEXT,
                    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(school_year, teacher_name)
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_exam_invitations_year ON exam_invitations(school_year)`);
        }
    },
    {
        version: '2026-05-059-exam-attendance',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS exam_attendance (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    school_year     TEXT NOT NULL,
                    session_key     TEXT NOT NULL,
                    session_label   TEXT,
                    session_date    TEXT,
                    teacher_id      INTEGER,
                    teacher_name    TEXT NOT NULL,
                    role            TEXT DEFAULT 'proctor',
                    status          TEXT DEFAULT 'present'
                                    CHECK(status IN ('present','absent','late','excused')),
                    notes           TEXT,
                    recorded_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(school_year, session_key, teacher_name)
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_exam_attendance_session ON exam_attendance(school_year, session_key)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_exam_attendance_teacher ON exam_attendance(school_year, teacher_name)`);
        }
    },
    {
        version: '2026-05-060-exam-indexes',
        up: () => {
            const db = getDb();
            db.exec(`CREATE INDEX IF NOT EXISTS idx_exams_year_date ON exams(school_year, exam_date)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_exam_proctors_year ON exam_proctors(school_year)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_exam_rooms_year ON exam_rooms(school_year)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_exam_invitations_year_teacher ON exam_invitations(school_year, teacher_name)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_absences_year ON teacher_absences(school_year)`);
        }
    },
    {
        version: '2026-05-061-exam-config-data',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS exam_config_data (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    school_year  TEXT NOT NULL,
                    config_key   TEXT NOT NULL,
                    data_json    TEXT NOT NULL,
                    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(school_year, config_key)
                )
            `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_exam_config_year ON exam_config_data(school_year)`);
        }
    },
    {
        // NOTE: The task brief referenced "2026-04-050-student-risk-snapshot", but the
        // schema_migrations table keys on `version` as a PRIMARY KEY and the runner skips
        // any version already recorded. `2026-04-050` is already taken by the
        // `inspectors-table` migration, so reusing it would cause this migration to be
        // silently skipped. We therefore use the next truly-sequential unused version.
        version: '2026-05-062-student-risk-snapshot',
        up: () => {
            const db = getDb();

            // PART A (H3) — persisted risk snapshot keyed by (student_code, school_year).
            // Idempotent CREATE statements mirror the 2026-04-048-student-profile-data style.
            db.exec(`
                CREATE TABLE IF NOT EXISTS student_risk_snapshot (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id   INTEGER,
                    student_code TEXT NOT NULL,
                    risk_score   INTEGER,
                    risk_level   TEXT,
                    school_year  TEXT NOT NULL,
                    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_by   TEXT,
                    UNIQUE(student_code, school_year)
                )
            `);
            // Index so "list all critical students for a year" is an indexed lookup.
            db.exec(`CREATE INDEX IF NOT EXISTS idx_student_risk_snapshot_year_level
                     ON student_risk_snapshot(school_year, risk_level)`);

            // PART B (M3) — FK / dead-column cleanup for student_profile_data.
            // DECISION: NO-OP (documented intentionally).
            // `student_profile_data.student_id` is declared NOT NULL but is routinely written
            // as 0 because `student_code` is the real key. Adding a real FK (or dropping the
            // dead column) in SQLite requires a full table rebuild (create _new, copy rows,
            // drop, rename, recreate indexes) as done in 2026-03-019-students-unique-constraint-year.
            // A rebuild of a table holding sensitive profile data carries data-loss risk and is
            // out of scope for an automated migration, so we deliberately leave student_id as-is.
            // Revisit only as a supervised, backed-up maintenance task if the column must change.
        }
    },
    {
        // Auto-generated-institution-id refactor: the descriptive Massar_Code becomes a
        // distinct, always-editable field, separate from the technical school_id stored in
        // sync_config. No backfill UPDATE is needed here — legacy rows (created before this
        // migration) simply have massar_code = NULL, and the display-fallback chain in
        // getInstitutionStatusRecord() falls back to code_etablissement / sync_config.school_id.
        version: '2026-05-063-massar-code-column',
        up: () => ensureColumn('institution_config', 'massar_code', 'TEXT')
    },
    {
        // R2 — index the highest-write table. system_logs previously had only the
        // implicit rowid PK, so every filtered read (by entity_type / action / date)
        // was a full scan. These composite indexes lead with the common filter column
        // and trail with created_at so time-ordered lookups per entity/action are
        // covered. Retention (default 90 days, configurable via the
        // 'systemLogsRetentionDays' setting) runs on the existing cleanup timer.
        version: '2026-07-064-system-logs-indexes',
        up: () => {
            const db = getDb();
            db.exec(`CREATE INDEX IF NOT EXISTS idx_system_logs_entity ON system_logs(entity_type, created_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_system_logs_action ON system_logs(action, created_at)`);
        }
    },
    {
        // R6 + R7 — the single structural remediation campaign.
        //
        // Adds ON DELETE behavior to student/teacher foreign keys and real FKs to the
        // eight previously-unconstrained logical references, and switches
        // exam_invitations/exam_attendance from fragile teacher_NAME uniqueness to
        // teacher_ID uniqueness (with a name fallback for id-less rows).
        //
        // Delete-policy decisions (derived from the existing detachTeacherReferences /
        // students:deleteByYear handlers so runtime behavior is preserved and formalized):
        //   • students → academic children (grades, absences, correspondence,
        //     student_files, student_movements, student_risk_snapshot): ON DELETE CASCADE.
        //   • teachers → soft references (grades, tests, staff_attendance, exam_proctors,
        //     compensation_tracking, support_sessions, exam_invitations, exam_attendance):
        //     ON DELETE SET NULL — drops the broken id link while keeping the teacher_name
        //     display snapshot, exactly as detachTeacherReferences already does.
        //   • teachers → owned children (teacher_aliases, teacher_absences, both NOT NULL):
        //     ON DELETE CASCADE.
        //   • exams → exam_proctors.exam_id: ON DELETE CASCADE (matches exams:delete).
        //
        // student_profile_data.student_id is intentionally left untouched — a NOT NULL
        // dead column keyed by student_code, per the documented decision in migration
        // 2026-05-062-student-risk-snapshot.
        //
        // recordsVersionInternally: PRAGMA foreign_keys can only be toggled outside a
        // transaction, so this migration runs outside the runner's wrapping transaction
        // and manages its own atomic transaction + version record.
        version: '2026-07-065-fk-ondelete-and-identity-keys',
        recordsVersionInternally: true,
        up: () => {
            const db = getDb();
            const recordMigration = db.prepare('INSERT INTO schema_migrations(version) VALUES(?)');

            const rebuiltTables = [
                'grades',
                'absences',
                'correspondence',
                'student_files',
                'student_movements',
                'teacher_aliases',
                'teacher_absences',
                'exam_proctors',
                'tests',
                'staff_attendance',
                'compensation_tracking',
                'support_sessions',
                'exam_invitations',
                'exam_attendance',
                'student_risk_snapshot'
            ];

            db.exec('PRAGMA foreign_keys=off;');
            const txn = db.transaction(() => {
                // ── 1. Clean orphaned references so the new FKs (and foreign_key_check) hold ──
                const cleanup = [
                    // Dual-key student tables: re-link a stale student_id from student_code,
                    // leaving NULL when it cannot be resolved (student_code stays authoritative).
                    `UPDATE grades SET student_id = (SELECT s.id FROM students s WHERE s.code = grades.student_code AND s.school_year = grades.school_year) WHERE student_id IS NOT NULL AND student_id NOT IN (SELECT id FROM students)`,
                    `UPDATE absences SET student_id = (SELECT s.id FROM students s WHERE s.code = absences.student_code AND s.school_year = absences.school_year) WHERE student_id IS NOT NULL AND student_id NOT IN (SELECT id FROM students)`,
                    `UPDATE correspondence SET student_id = (SELECT s.id FROM students s WHERE s.code = correspondence.student_code AND s.school_year = correspondence.school_year) WHERE student_id IS NOT NULL AND student_id NOT IN (SELECT id FROM students)`,
                    // NOT NULL student children with no code fallback: orphans are dead rows.
                    `DELETE FROM student_files WHERE student_id NOT IN (SELECT id FROM students)`,
                    `DELETE FROM student_movements WHERE student_id NOT IN (SELECT id FROM students)`,
                    // Teacher soft-refs → NULL out dangling teacher_ids (teacher_name preserved).
                    `UPDATE grades SET teacher_id = NULL WHERE teacher_id IS NOT NULL AND teacher_id NOT IN (SELECT id FROM teachers)`,
                    `UPDATE tests SET teacher_id = NULL WHERE teacher_id IS NOT NULL AND teacher_id NOT IN (SELECT id FROM teachers)`,
                    `UPDATE staff_attendance SET teacher_id = NULL WHERE teacher_id IS NOT NULL AND teacher_id NOT IN (SELECT id FROM teachers)`,
                    `UPDATE exam_proctors SET teacher_id = NULL WHERE teacher_id IS NOT NULL AND teacher_id NOT IN (SELECT id FROM teachers)`,
                    `UPDATE compensation_tracking SET teacher_id = NULL WHERE teacher_id IS NOT NULL AND teacher_id NOT IN (SELECT id FROM teachers)`,
                    `UPDATE support_sessions SET teacher_id = NULL WHERE teacher_id IS NOT NULL AND teacher_id NOT IN (SELECT id FROM teachers)`,
                    `UPDATE exam_invitations SET teacher_id = NULL WHERE teacher_id IS NOT NULL AND teacher_id NOT IN (SELECT id FROM teachers)`,
                    `UPDATE exam_attendance SET teacher_id = NULL WHERE teacher_id IS NOT NULL AND teacher_id NOT IN (SELECT id FROM teachers)`,
                    // exam_proctors.exam_id → NULL out dangling exam links.
                    `UPDATE exam_proctors SET exam_id = NULL WHERE exam_id IS NOT NULL AND exam_id NOT IN (SELECT id FROM exams)`,
                    // Teacher-owned NOT NULL children: orphans are dead rows.
                    `DELETE FROM teacher_aliases WHERE teacher_id NOT IN (SELECT id FROM teachers)`,
                    `DELETE FROM teacher_absences WHERE teacher_id NOT IN (SELECT id FROM teachers)`,
                    // Risk snapshot: backfill the real student_id from student_code (the column
                    // was historically written as 0); NULL when unresolvable.
                    `UPDATE student_risk_snapshot SET student_id = (SELECT s.id FROM students s WHERE s.code = student_risk_snapshot.student_code AND s.school_year = student_risk_snapshot.school_year) WHERE student_id IS NULL OR student_id NOT IN (SELECT id FROM students)`,
                    // Dedup for the new teacher_id-scoped exam unique indexes: two rows sharing
                    // (school_year[, session_key], teacher_id) can exist today because uniqueness
                    // was on teacher_NAME. Keep the newest (MAX(id)).
                    `DELETE FROM exam_invitations WHERE teacher_id IS NOT NULL AND id NOT IN (SELECT MAX(id) FROM exam_invitations WHERE teacher_id IS NOT NULL GROUP BY school_year, teacher_id)`,
                    `DELETE FROM exam_attendance WHERE teacher_id IS NOT NULL AND id NOT IN (SELECT MAX(id) FROM exam_attendance WHERE teacher_id IS NOT NULL GROUP BY school_year, session_key, teacher_id)`
                ];
                for (const sql of cleanup) db.exec(sql);

                // ── 2. Rebuild each table with the new constraints (id + indexes preserved) ──
                rebuildTableWithConstraints(
                    db,
                    'grades',
                    `CREATE TABLE grades__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        student_id INTEGER,
                        student_code TEXT,
                        teacher_id INTEGER,
                        subject TEXT,
                        grade REAL,
                        semester INTEGER,
                        teacher_name TEXT,
                        level TEXT,
                        section TEXT,
                        school_year TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
                        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'absences',
                    `CREATE TABLE absences__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        student_id INTEGER,
                        student_code TEXT,
                        absence_date DATE,
                        month TEXT,
                        absence_type TEXT DEFAULT 'unjustified',
                        hours INTEGER DEFAULT 0,
                        days REAL DEFAULT 0,
                        reason TEXT,
                        school_year TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'correspondence',
                    `CREATE TABLE correspondence__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        student_id INTEGER,
                        student_code TEXT,
                        letter_type TEXT,
                        letter_date DATE,
                        total_hours INTEGER,
                        school_year TEXT,
                        printed INTEGER DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'student_files',
                    `CREATE TABLE student_files__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        student_id INTEGER NOT NULL,
                        doc_key TEXT NOT NULL,
                        is_present INTEGER DEFAULT 0,
                        school_year TEXT,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(student_id, doc_key, school_year),
                        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'student_movements',
                    `CREATE TABLE student_movements__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        student_id INTEGER NOT NULL,
                        movement_type TEXT NOT NULL,
                        from_section TEXT,
                        to_section TEXT,
                        movement_date DATE NOT NULL,
                        notes TEXT,
                        school_year TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'teacher_aliases',
                    `CREATE TABLE teacher_aliases__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        teacher_id INTEGER NOT NULL,
                        alias_name TEXT NOT NULL,
                        alias_normalized TEXT NOT NULL,
                        source TEXT,
                        school_year TEXT NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
                        UNIQUE(teacher_id, school_year, alias_normalized)
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'teacher_absences',
                    `CREATE TABLE teacher_absences__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        teacher_id INTEGER NOT NULL,
                        absence_date DATE NOT NULL,
                        reason TEXT,
                        replacement_teacher TEXT,
                        school_year TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        justified INTEGER DEFAULT 1,
                        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'exam_proctors',
                    `CREATE TABLE exam_proctors__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        exam_id INTEGER,
                        teacher_id INTEGER,
                        teacher_name TEXT,
                        room TEXT,
                        school_year TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        date TEXT,
                        session TEXT,
                        cin TEXT,
                        som TEXT,
                        gender TEXT,
                        specialty TEXT,
                        workplace TEXT,
                        teacher_name_fr TEXT,
                        FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE,
                        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'tests',
                    `CREATE TABLE tests__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        section TEXT,
                        subject TEXT,
                        teacher_id INTEGER,
                        teacher_name TEXT,
                        status TEXT DEFAULT 'planned',
                        test_date DATE,
                        school_year TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'staff_attendance',
                    `CREATE TABLE staff_attendance__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        teacher_id INTEGER,
                        teacher_name TEXT,
                        subject TEXT,
                        attendance_date DATE NOT NULL,
                        type TEXT NOT NULL DEFAULT 'absence',
                        late_duration INTEGER,
                        arrival_time TEXT,
                        reason TEXT,
                        notes TEXT,
                        absence_period TEXT DEFAULT 'full_day',
                        school_year TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'compensation_tracking',
                    `CREATE TABLE compensation_tracking__rb (
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
                        teacher_id       INTEGER,
                        reason           TEXT,
                        UNIQUE(absence_date, teacher_name, section, period_slot, school_year),
                        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
                    )`
                );
                rebuildTableWithConstraints(
                    db,
                    'support_sessions',
                    `CREATE TABLE support_sessions__rb (
                        id                INTEGER PRIMARY KEY AUTOINCREMENT,
                        teacher_id        INTEGER,
                        teacher_name      TEXT,
                        subject           TEXT NOT NULL,
                        section           TEXT NOT NULL,
                        room              TEXT,
                        session_date      TEXT NOT NULL,
                        time_from         TEXT NOT NULL,
                        time_to           TEXT NOT NULL,
                        duration_hours    REAL,
                        attendance_status TEXT NOT NULL
                            CHECK(attendance_status IN ('full','partial','absent')),
                        school_year       TEXT NOT NULL,
                        created_at        TEXT DEFAULT (datetime('now')),
                        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
                    )`
                );
                // exam_invitations / exam_attendance (R7): drop the teacher_NAME UNIQUE
                // constraint and replace it with partial-unique-on-teacher_id (with a
                // teacher_name fallback only when teacher_id IS NULL).
                rebuildTableWithConstraints(
                    db,
                    'exam_invitations',
                    `CREATE TABLE exam_invitations__rb (
                        id              INTEGER PRIMARY KEY AUTOINCREMENT,
                        school_year     TEXT NOT NULL,
                        teacher_id      INTEGER,
                        teacher_name    TEXT NOT NULL,
                        sent_at         DATETIME,
                        notes           TEXT,
                        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
                    )`,
                    [
                        `CREATE UNIQUE INDEX uidx_exam_invitations_teacher ON exam_invitations(school_year, teacher_id) WHERE teacher_id IS NOT NULL`,
                        `CREATE UNIQUE INDEX uidx_exam_invitations_name ON exam_invitations(school_year, teacher_name) WHERE teacher_id IS NULL`
                    ]
                );
                rebuildTableWithConstraints(
                    db,
                    'exam_attendance',
                    `CREATE TABLE exam_attendance__rb (
                        id              INTEGER PRIMARY KEY AUTOINCREMENT,
                        school_year     TEXT NOT NULL,
                        session_key     TEXT NOT NULL,
                        session_label   TEXT,
                        session_date    TEXT,
                        teacher_id      INTEGER,
                        teacher_name    TEXT NOT NULL,
                        role            TEXT DEFAULT 'proctor',
                        status          TEXT DEFAULT 'present'
                                        CHECK(status IN ('present','absent','late','excused')),
                        notes           TEXT,
                        recorded_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
                    )`,
                    [
                        `CREATE UNIQUE INDEX uidx_exam_attendance_teacher ON exam_attendance(school_year, session_key, teacher_id) WHERE teacher_id IS NOT NULL`,
                        `CREATE UNIQUE INDEX uidx_exam_attendance_name ON exam_attendance(school_year, session_key, teacher_name) WHERE teacher_id IS NULL`
                    ]
                );
                rebuildTableWithConstraints(
                    db,
                    'student_risk_snapshot',
                    `CREATE TABLE student_risk_snapshot__rb (
                        id           INTEGER PRIMARY KEY AUTOINCREMENT,
                        student_id   INTEGER,
                        student_code TEXT NOT NULL,
                        risk_score   INTEGER,
                        risk_level   TEXT,
                        school_year  TEXT NOT NULL,
                        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_by   TEXT,
                        UNIQUE(student_code, school_year),
                        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
                    )`
                );

                // ── 3. Integrity gate — the rebuilt tables must have zero FK violations.
                // Scoped to the tables this migration touched so a pre-existing violation
                // elsewhere can't roll back (and thereby block startup on) this migration.
                const rebuiltSet = new Set(rebuiltTables);
                const violations = db.pragma('foreign_key_check').filter((v) => rebuiltSet.has(v.table));
                if (violations.length > 0) {
                    throw new Error(
                        `[migration 065] foreign_key_check found ${violations.length} violation(s) after rebuild: ` +
                            JSON.stringify(violations.slice(0, 20))
                    );
                }

                recordMigration.run('2026-07-065-fk-ondelete-and-identity-keys');
            });
            try {
                txn();
            } finally {
                db.exec('PRAGMA foreign_keys=on;');
            }
        }
    },
    {
        version: '2026-07-066-app-defaults',
        up: () => {
            const db = getDb();
            const { DEFAULT_EXAM_COUNTS } = require('./exam-count-defaults');
            db.exec(`
                CREATE TABLE IF NOT EXISTS exam_count_rules (
                    level_code TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    exam_count INTEGER NOT NULL CHECK (exam_count BETWEEN 1 AND 12),
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (level_code, subject)
                );
                CREATE TABLE IF NOT EXISTS page_role_access (
                    page_key TEXT NOT NULL,
                    role TEXT NOT NULL,
                    allowed INTEGER NOT NULL DEFAULT 1,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (page_key, role)
                );
            `);
            const count = db.prepare('SELECT COUNT(*) AS c FROM exam_count_rules').get();
            if (Number(count?.c || 0) === 0) {
                const insert = db.prepare(`
                    INSERT INTO exam_count_rules(level_code, subject, exam_count, updated_at)
                    VALUES(?, ?, ?, CURRENT_TIMESTAMP)
                `);
                const tx = db.transaction(() => {
                    for (const [subject, examCount] of DEFAULT_EXAM_COUNTS) {
                        const n = Math.min(12, Math.max(1, Math.round(Number(examCount) || 2)));
                        insert.run('*', subject, n);
                    }
                });
                tx();
            }
        }
    },
    {
        // Allow tab_key = 'guidance' for school orientation matching form
        // on the student profile (التوجيه المدرسي).
        // SQLite cannot ALTER CHECK constraints — rebuild the table when needed.
        version: '2026-07-067-student-profile-guidance',
        up: () => {
            const db = getDb();
            const hasTable = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='student_profile_data'")
                .get();
            const createSql = `
                CREATE TABLE student_profile_data (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id    INTEGER NOT NULL,
                    student_code  TEXT NOT NULL,
                    tab_key       TEXT NOT NULL
                                  CHECK(tab_key IN ('economic','social','health','followup','guidance')),
                    data_json     TEXT NOT NULL DEFAULT '{}',
                    school_year   TEXT NOT NULL,
                    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_by    TEXT,
                    UNIQUE(student_code, tab_key, school_year)
                )
            `;
            if (!hasTable) {
                db.exec(createSql);
                db.exec(
                    `CREATE INDEX IF NOT EXISTS idx_student_profile_student ON student_profile_data(student_code, school_year)`
                );
                return;
            }

            // Idempotent: skip rebuild if CHECK already allows guidance
            const existingSql =
                db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='student_profile_data'").get()
                    ?.sql || '';
            if (existingSql.includes("'guidance'")) {
                return;
            }

            // Drop leftover temp from a previous interrupted rebuild
            db.exec(`DROP TABLE IF EXISTS student_profile_data_v2`);
            db.exec(`
                CREATE TABLE student_profile_data_v2 (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id    INTEGER NOT NULL,
                    student_code  TEXT NOT NULL,
                    tab_key       TEXT NOT NULL
                                  CHECK(tab_key IN ('economic','social','health','followup','guidance')),
                    data_json     TEXT NOT NULL DEFAULT '{}',
                    school_year   TEXT NOT NULL,
                    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_by    TEXT,
                    UNIQUE(student_code, tab_key, school_year)
                )
            `);
            db.exec(`
                INSERT INTO student_profile_data_v2
                    (id, student_id, student_code, tab_key, data_json, school_year, updated_at, updated_by)
                SELECT id, student_id, student_code, tab_key, data_json, school_year, updated_at, updated_by
                FROM student_profile_data
            `);
            db.exec(`DROP TABLE student_profile_data`);
            db.exec(`ALTER TABLE student_profile_data_v2 RENAME TO student_profile_data`);
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_student_profile_student ON student_profile_data(student_code, school_year)`
            );
        }
    },
    {
        // School orientation / guidance choices (التوجيه المدرسي).
        // One row per student per school year: origin stream + ranked choices + assignment.
        version: '2026-07-068-student-orientation',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS student_orientation (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_code      TEXT NOT NULL,
                    full_name         TEXT,
                    gender            TEXT,
                    section           TEXT,
                    level             TEXT,
                    origin_stream     TEXT NOT NULL,
                    choice_1          TEXT,
                    choice_2          TEXT,
                    choice_3          TEXT,
                    assigned_stream   TEXT,
                    decision_status   TEXT,
                    average           REAL,
                    rank_num          INTEGER,
                    notes             TEXT,
                    school_year       TEXT NOT NULL,
                    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(student_code, school_year)
                );
            `);
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_student_orientation_year
                ON student_orientation(school_year);
            `);
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_student_orientation_origin
                ON student_orientation(school_year, origin_stream);
            `);
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_student_orientation_section
                ON student_orientation(school_year, section);
            `);
        }
    }
];

// R6/R7 — SQLite cannot ALTER an existing table to add/modify a FOREIGN KEY or its
// ON DELETE action, so each affected table must be rebuilt. This helper performs the
// canonical rebuild dance while preserving row identity and indexes:
//   1. Snapshot the current column list (PRAGMA table_info) and named indexes.
//   2. Create `<name>__rb` with the new schema (passed in createTempSql).
//   3. Copy every row with an EXPLICIT column list so `id` (and thus sync_id_map /
//      sync_snapshots linkage) is preserved exactly.
//   4. Drop the old table and rename the rebuilt one into place.
//   5. Recreate every captured named index, plus any extra (e.g. new partial unique)
//      indexes supplied by the caller.
// Must run with foreign_keys OFF and inside a transaction (see migration 065).
function rebuildTableWithConstraints(db, tableName, createTempSql, extraIndexes = []) {
    const columns = db
        .prepare(`PRAGMA table_info("${tableName}")`)
        .all()
        .map((c) => `"${c.name}"`)
        .join(', ');
    // Only capture explicitly-created (named) indexes — auto-indexes backing inline
    // UNIQUE/PK constraints have sql=NULL and are re-created by the new table's own
    // constraint definitions, so they must NOT be replayed here.
    const namedIndexes = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL")
        .all(tableName)
        .map((r) => r.sql);

    const tempName = `${tableName}__rb`;
    db.exec(createTempSql);
    db.exec(`INSERT INTO "${tempName}" (${columns}) SELECT ${columns} FROM "${tableName}"`);
    db.exec(`DROP TABLE "${tableName}"`);
    db.exec(`ALTER TABLE "${tempName}" RENAME TO "${tableName}"`);
    for (const sql of namedIndexes) db.exec(sql);
    for (const sql of extraIndexes) db.exec(sql);
}

function ensureMigrationsTable() {
    const db = getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations(
            version TEXT PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

// R5 — guard the migration version scheme. `version` is the PRIMARY KEY of
// schema_migrations, and the runner skips any version already recorded, so a
// duplicate silently drops the newer migration (migration 062 documents a
// near-miss of exactly this). This static assertion runs before any migration is
// applied and fails fast — the MIGRATIONS array is code, so a violation is a
// deterministic build-time bug (the smoke test catches it in CI) and can never
// reach a shipped build.
const MIGRATION_SEQ_PATTERN = /^\d{4}-\d{2}-(\d{3})-/;

function assertMigrationVersionIntegrity(migrations) {
    const seen = new Set();
    for (const migration of migrations) {
        if (seen.has(migration.version)) {
            throw new Error(
                `[db:migrations] Duplicate migration version '${migration.version}' — versions must be unique ` +
                    `(a duplicate is silently skipped by the runner).`
            );
        }
        seen.add(migration.version);
    }

    // Canonical scheme going forward is YYYY-MM-NNN-slug with a monotonically
    // increasing NNN. Legacy bare-date versions (2-digit day, no NNN) predate the
    // scheme and are intentionally ignored here.
    let lastSeq = -1;
    let lastSeqVersion = null;
    for (const migration of migrations) {
        const match = MIGRATION_SEQ_PATTERN.exec(migration.version);
        if (!match) continue;
        const seq = Number(match[1]);
        if (seq <= lastSeq) {
            throw new Error(
                `[db:migrations] Migration version '${migration.version}' (seq ${seq}) is not strictly greater ` +
                    `than '${lastSeqVersion}' (seq ${lastSeq}). New migrations must use a monotonically increasing ` +
                    `YYYY-MM-NNN-slug sequence.`
            );
        }
        lastSeq = seq;
        lastSeqVersion = migration.version;
    }
}

function runMigrations() {
    assertMigrationVersionIntegrity(MIGRATIONS);
    ensureMigrationsTable();
    const db = getDb();
    const recordMigration = db.prepare('INSERT INTO schema_migrations(version) VALUES(?)');
    const applyMigration = db.transaction((migration) => {
        migration.up();
        recordMigration.run(migration.version);
    });

    const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    for (const migration of MIGRATIONS) {
        if (appliedVersions.has(migration.version)) continue;

        if (migration.recordsVersionInternally) {
            migration.up();
            continue;
        }

        applyMigration(migration);
    }
}

module.exports = { runMigrations, ensureMigrationsTable, assertMigrationVersionIntegrity, MIGRATIONS };
