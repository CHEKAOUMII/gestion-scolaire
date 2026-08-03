const { getDb } = require('./context');
const {
    ensureColumn,
    ensureTeacherSourceColumns,
    ensureTeacherTeachingAssignmentsSchema,
    ensureInstitutionSchema,
    ensureInstitutionCyclesSchema,
    ensureCycleReferenceSchema,
    ensureStageRulesSchema,
    ensureCycleProfilesSchema,
    ensureLicensingSchema,
    ensureOwnerSyncSchema,
    ensurePageVisibilitySchema,
    ensureSyncSchema
} = require('./schema');
const { generateRandomPassword, hashPassword } = require('../auth/password');
const { seedSyncDefaults } = require('../sync/defaults');
const { normalizeTeacherName, seedTeacherAliases, resolveTeacherIdentity } = require('../teachers/identity');
const { PRIMARY_CYCLE, COLLEGIAL_CYCLE, QUALIFIANT_CYCLE } = require('../../js/shared/education/cycles');

function tableExists(db, tableName) {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
}

function isBlankCycle(cycleCode) {
    return cycleCode == null || String(cycleCode).trim() === '';
}

function recordUnmappableCycle(db, report) {
    const details = JSON.stringify({ reason: report.reason, source: report.source });
    const exists = db
        .prepare(
            `SELECT 1 FROM system_logs
             WHERE action = 'CYCLE_BACKFILL_UNMAPPABLE'
               AND entity_type = ? AND entity_id = ?`
        )
        .get(report.tableName, String(report.rowId));
    if (!exists) {
        db.prepare(
            `INSERT INTO system_logs(action, entity_type, entity_id, details)
             VALUES('CYCLE_BACKFILL_UNMAPPABLE', ?, ?, ?)`
        ).run(report.tableName, String(report.rowId), details);
    }
}

function populateSectionsFromStudents(db) {
    if (!tableExists(db, 'students') || !tableExists(db, 'sections')) return;
    const { inferEducationPlacement } = require('../../js/shared/education/cycles');
    const students = db
        .prepare(
            `SELECT id, section, level, cycle_code, school_year
             FROM students
             WHERE TRIM(COALESCE(section, '')) != ''
               AND TRIM(COALESCE(school_year, '')) != ''`
        )
        .all();
    const insertSection = db.prepare(
        `INSERT OR IGNORE INTO sections(
            section_code, raw_name, normalized_name, cycle_code, level_code, stream_code, school_year
         ) VALUES(?, ?, ?, ?, ?, NULL, ?)`
    );
    // A student who already carries a cycle keeps it — inference never reclassifies
    // an explicit value. Students without a cycle get catalog inference (primary-
    // aware since 2026-08-01-primary-stage-catalogs.md, S1); the ones the catalog
    // cannot classify are reported for operator review instead of silently
    // defaulting (§13 rule, same reporting style as migration 076).
    const unclassified = [];
    for (const student of students) {
        const sectionCode = String(student.section).trim();
        const cycleCode = String(student.cycle_code || '').trim();
        const resolved = cycleCode || inferEducationPlacement({ section: student.section, level: student.level });
        if (!resolved) {
            unclassified.push({
                id: student.id,
                section: sectionCode,
                level: String(student.level || '').trim()
            });
            continue;
        }
        insertSection.run(
            sectionCode,
            String(student.section),
            sectionCode,
            resolved,
            isBlankCycle(student.level) ? null : String(student.level).trim(),
            String(student.school_year).trim()
        );
    }
    if (unclassified.length) {
        db.prepare(
            `INSERT INTO system_logs(action, entity_type, entity_id, details)
             VALUES('CYCLE_SECTION_UNCLASSIFIED', 'students', NULL, ?)`
        ).run(JSON.stringify({ count: unclassified.length, samples: unclassified.slice(0, 10) }));
    }
}

function resolveSectionCycle(db, sectionName, schoolYear) {
    const normalizedName = String(sectionName || '').trim();
    const normalizedYear = String(schoolYear || '').trim();
    if (!normalizedName || !normalizedYear) return { cycleCode: null, reason: 'section_or_year_missing' };
    const matches = db
        .prepare(
            `SELECT cycle_code FROM sections
             WHERE school_year = ? AND (section_code = ? OR raw_name = ?)`
        )
        .all(normalizedYear, normalizedName, normalizedName);
    const cycleCodes = [...new Set(matches.map((match) => String(match.cycle_code || '').trim()).filter(Boolean))];
    if (cycleCodes.length === 1) return { cycleCode: cycleCodes[0], reason: null };
    return {
        cycleCode: null,
        reason: cycleCodes.length > 1 ? 'ambiguous_section_cycle' : 'section_not_found'
    };
}

function backfillSectionOwnedCycles(db, tableName) {
    if (!tableExists(db, tableName)) return;
    const rows = db
        .prepare(`SELECT id, section, school_year FROM ${tableName} WHERE cycle_code IS NULL OR TRIM(cycle_code) = ''`)
        .all();
    const updateCycle = db.prepare(`UPDATE ${tableName} SET cycle_code = ? WHERE id = ?`);
    for (const row of rows) {
        const mapping = resolveSectionCycle(db, row.section, row.school_year);
        if (mapping.cycleCode) updateCycle.run(mapping.cycleCode, row.id);
        else recordUnmappableCycle(db, { tableName, rowId: row.id, reason: mapping.reason, source: 'sections' });
    }
}

function resolveStudentCycle(db, studentRow) {
    const candidates = [];
    const studentId = Number(studentRow.student_id);
    const schoolYear = String(studentRow.school_year || '').trim();
    if (Number.isFinite(studentId) && studentId > 0) {
        const student = db
            .prepare(
                `SELECT cycle_code FROM students
                 WHERE id = ? AND (? = '' OR school_year = ?)`
            )
            .get(studentId, schoolYear, schoolYear);
        if (student && !isBlankCycle(student.cycle_code)) candidates.push(String(student.cycle_code).trim());
    }
    const studentCode = String(studentRow.student_code || '').trim();
    if (studentCode && schoolYear) {
        const student = db
            .prepare('SELECT cycle_code FROM students WHERE code = ? AND school_year = ?')
            .get(studentCode, schoolYear);
        if (student && !isBlankCycle(student.cycle_code)) candidates.push(String(student.cycle_code).trim());
    }
    const cycleCodes = [...new Set(candidates)];
    if (cycleCodes.length === 1) return { cycleCode: cycleCodes[0], reason: null };
    return {
        cycleCode: null,
        reason: cycleCodes.length > 1 ? 'conflicting_student_sources' : 'student_not_found_or_cycle_missing'
    };
}

function backfillStudentOwnedCycles(db, tableName, sourceColumns) {
    if (!tableExists(db, tableName)) return;
    const rows = db
        .prepare(`SELECT id, ${sourceColumns} FROM ${tableName} WHERE cycle_code IS NULL OR TRIM(cycle_code) = ''`)
        .all();
    const updateCycle = db.prepare(`UPDATE ${tableName} SET cycle_code = ? WHERE id = ?`);
    for (const row of rows) {
        const mapping = resolveStudentCycle(db, row);
        if (mapping.cycleCode) updateCycle.run(mapping.cycleCode, row.id);
        else recordUnmappableCycle(db, { tableName, rowId: row.id, reason: mapping.reason, source: 'students' });
    }
}

function reportExamProctorMappings(db) {
    if (!tableExists(db, 'exam_proctors') || !tableExists(db, 'exams')) return;
    const proctors = db.prepare('SELECT id, exam_id FROM exam_proctors').all();
    const issues = [];
    for (const proctor of proctors) {
        const examId = Number(proctor.exam_id);
        const exam = Number.isFinite(examId) && examId > 0
            ? db.prepare('SELECT id, cycle_code FROM exams WHERE id = ?').get(examId)
            : null;
        if (!exam) {
            const reason = examId > 0 ? 'exam_not_found' : 'exam_id_missing';
            issues.push({ id: proctor.id, examId: proctor.exam_id, reason });
            recordUnmappableCycle(db, {
                tableName: 'exam_proctors',
                rowId: proctor.id,
                reason,
                source: 'exams'
            });
        } else if (isBlankCycle(exam.cycle_code)) {
            issues.push({ id: proctor.id, examId: exam.id, reason: 'exam_cycle_unmappable' });
            recordUnmappableCycle(db, {
                tableName: 'exam_proctors',
                rowId: proctor.id,
                reason: 'exam_cycle_unmappable',
                source: 'exams'
            });
        }
    }
    if (!issues.length) return;
    const reportDetails = JSON.stringify({ count: issues.length, samples: issues.slice(0, 10) });
    const reportExists = db
        .prepare(
            `SELECT 1 FROM system_logs
             WHERE action = 'CYCLE_BACKFILL_EXAM_PROCTORS_REPORT'
               AND entity_type = 'exam_proctors' AND entity_id IS NULL`
        )
        .get();
    if (!reportExists) {
        db.prepare(
            `INSERT INTO system_logs(action, entity_type, entity_id, details)
             VALUES('CYCLE_BACKFILL_EXAM_PROCTORS_REPORT', 'exam_proctors', NULL, ?)`
        ).run(reportDetails);
    }
}

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
                        cycle_code TEXT NOT NULL DEFAULT '${QUALIFIANT_CYCLE}',
                        teacher_resolution TEXT DEFAULT 'unresolved',
                        source_file_name TEXT,
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
                        cycle_code TEXT NOT NULL DEFAULT '${QUALIFIANT_CYCLE}',
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
                        cycle_code TEXT,
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
                        cycle_code TEXT,
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
                        cycle_code TEXT,
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
                        cycle_code TEXT,
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
    },
    {
        version: '2026-07-069-students-level-school-name',
        up: () => {
            ensureColumn('students', 'level', 'TEXT');
            ensureColumn('students', 'school_name', 'TEXT');
        }
    },
    {
        version: '2026-07-070-institution-cycles',
        up: () => {
            ensureInstitutionCyclesSchema();
            const db = getDb();
            db.prepare(
                `INSERT OR IGNORE INTO institution_cycles
                 (cycle_code, is_active, profile_version, sort_order)
                 VALUES ('${QUALIFIANT_CYCLE}', 1, 'qualifiant-2026-v1', 20)`
            ).run();
        }
    },
    {
        // Students carry their education cycle (docs/plans/2026-07-30-cycle-scoping-students-slice.md, D1).
        // Every existing row belongs to the qualifiant cycle — that is what the app has
        // been managing all along — so the column defaults to it and is backfilled rather
        // than left nullable, which keeps older builds able to read the table unchanged.
        version: '2026-07-071-students-cycle-code',
        up: () => {
            ensureColumn('students', 'cycle_code', `TEXT NOT NULL DEFAULT '${QUALIFIANT_CYCLE}'`);
            const db = getDb();
            db.prepare(
                `UPDATE students SET cycle_code = '${QUALIFIANT_CYCLE}'
                 WHERE cycle_code IS NULL OR TRIM(cycle_code) = ''`
            ).run();
            // UNIQUE(code, school_year) is intentionally untouched: a student belongs to
            // one cycle, so their identity does not gain a cycle component (D3).
            db.exec(
                `CREATE INDEX IF NOT EXISTS idx_students_year_cycle ON students(school_year, cycle_code);`
            );
        }
    },
    {
        // Grades and absences inherit their cycle from the owning student. Their logical
        // keys remain unchanged because student_code is institution-wide unique.
        version: '2026-07-072-grades-absences-cycle-code',
        up: () => {
            ensureColumn('grades', 'cycle_code', `TEXT NOT NULL DEFAULT '${QUALIFIANT_CYCLE}'`);
            ensureColumn('absences', 'cycle_code', `TEXT NOT NULL DEFAULT '${QUALIFIANT_CYCLE}'`);
            const db = getDb();
            for (const table of ['grades', 'absences']) {
                const orphanPredicate = `NOT EXISTS (
                    SELECT 1 FROM students s
                    WHERE s.code = ${table}.student_code
                      AND s.school_year = ${table}.school_year
                )`;
                const orphanCount = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${orphanPredicate}`).get().count;
                const unresolved = db
                    .prepare(`SELECT student_code, school_year FROM ${table} WHERE ${orphanPredicate} LIMIT 10`)
                    .all();
                db.prepare(
                    `UPDATE ${table}
                     SET cycle_code = COALESCE((
                         SELECT s.cycle_code FROM students s
                         WHERE s.code = ${table}.student_code
                           AND s.school_year = ${table}.school_year
                     ), '${QUALIFIANT_CYCLE}')`
                ).run();
                if (unresolved.length) {
                    db.prepare(
                        `INSERT INTO system_logs(action, entity_type, entity_id, details)
                         SELECT ?, ?, ?, ?
                         WHERE NOT EXISTS (
                             SELECT 1 FROM system_logs
                             WHERE action = ? AND entity_type = ?
                         )`
                    ).run(
                        'CYCLE_BACKFILL_ORPHANS',
                        table,
                        null,
                        JSON.stringify({ count: orphanCount, samples: unresolved }),
                        'CYCLE_BACKFILL_ORPHANS',
                        table
                    );
                }
            }
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_grades_year_cycle ON grades(school_year, cycle_code);
                CREATE INDEX IF NOT EXISTS idx_absences_year_cycle ON absences(school_year, cycle_code);
            `);
        }
    },
    {
        version: '2026-07-073-cross-cycle-teaching-assignments',
        up: () => {
            ensureTeacherSourceColumns();
            ensureTeacherTeachingAssignmentsSchema();
            const db = getDb();
            db.prepare(
                `UPDATE teachers SET scope_type = 'teaching_assignment'
                 WHERE scope_type IS NULL OR TRIM(scope_type) = ''`
            ).run();
        }
    },
    {
        // Keep grade-import evidence available for the assignment review queue. These
        // fields are audit metadata; they do not change the grade logical key.
        version: '2026-07-074-grade-teacher-resolution-audit',
        up: () => {
            ensureColumn('grades', 'teacher_resolution', "TEXT DEFAULT 'unresolved'");
            ensureColumn('grades', 'source_file_name', 'TEXT');
            const db = getDb();
            db.prepare(
                `UPDATE grades
                 SET teacher_resolution = CASE
                     WHEN teacher_id IS NOT NULL AND teacher_id > 0 THEN 'resolved'
                     ELSE 'unresolved'
                 END
                 WHERE teacher_resolution IS NULL OR TRIM(teacher_resolution) = ''`
            ).run();
        }
    },

    {
        // A timetable blob is cycle-keyed: saving one cycle must never overwrite the
        // other cycle's timetable in the same school year.
        version: '2026-07-075-timetable-cycle-key',
        recordsVersionInternally: true,
        up: () => {
            const db = getDb();
            const recordMigration = db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES(?)');
            const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'timetable_data'").get();
            if (!table) {
                db.exec(`
                    CREATE TABLE timetable_data (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        school_year TEXT NOT NULL,
                        cycle_code TEXT NOT NULL DEFAULT '${QUALIFIANT_CYCLE}',
                        data_json TEXT NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(school_year, cycle_code)
                    );
                    CREATE INDEX idx_timetable_data_year_cycle ON timetable_data(school_year, cycle_code);
                `);
                recordMigration.run('2026-07-075-timetable-cycle-key');
                return;
            }
            const columns = db.prepare('PRAGMA table_info(timetable_data)').all().map((column) => column.name);
            if (!columns.includes('cycle_code')) {
                db.exec('PRAGMA foreign_keys=off;');
                const transaction = db.transaction(() => {
                    db.exec(`
                        CREATE TABLE timetable_data__rb (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            school_year TEXT NOT NULL,
                            cycle_code TEXT NOT NULL DEFAULT '${QUALIFIANT_CYCLE}',
                            data_json TEXT NOT NULL,
                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE(school_year, cycle_code)
                        );
                        INSERT INTO timetable_data__rb(id, school_year, data_json, updated_at)
                        SELECT id, school_year, data_json, updated_at FROM timetable_data;
                        DROP TABLE timetable_data;
                        ALTER TABLE timetable_data__rb RENAME TO timetable_data;
                        CREATE INDEX idx_timetable_data_year_cycle ON timetable_data(school_year, cycle_code);
                    `);
                    recordMigration.run('2026-07-075-timetable-cycle-key');
                });
                transaction();
                db.exec('PRAGMA foreign_keys=on;');
                return;
            }
            db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uidx_timetable_data_year_cycle ON timetable_data(school_year, cycle_code);');
            recordMigration.run('2026-07-075-timetable-cycle-key');
        }
    },
    {
        // Support sessions are tied to the section they serve, so they carry the
        // section's cycle while teacher identity remains institution-wide.
        version: '2026-07-076-support-sessions-cycle-code',
        up: () => {
            const db = getDb();
            const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'support_sessions'").get();
            if (!table) return;
            ensureColumn('support_sessions', 'cycle_code', `TEXT NOT NULL DEFAULT '${QUALIFIANT_CYCLE}'`);
            const { inferEducationPlacement } = require('../../js/shared/education/cycles');
            const rows = db.prepare('SELECT id, section FROM support_sessions').all();
            const update = db.prepare('UPDATE support_sessions SET cycle_code = ? WHERE id = ?');
            // Rows whose section name the catalog cannot classify fall back to the cycle
            // this app has always managed. That fallback is a guess, so it is reported the
            // same way migration 072 reports orphan grades — §13 forbids silent inference,
            // not a recorded one an operator can review.
            const unclassified = [];
            for (const row of rows) {
                const inferred = inferEducationPlacement({ section: row.section });
                if (!inferred) unclassified.push({ id: row.id, section: row.section });
                update.run(inferred || QUALIFIANT_CYCLE, row.id);
            }
            if (unclassified.length) {
                db.prepare(
                    `INSERT INTO system_logs(action, entity_type, entity_id, details)
                     VALUES(?, ?, ?, ?)`
                ).run(
                    'CYCLE_BACKFILL_ASSUMED',
                    'support_sessions',
                    null,
                    JSON.stringify({ count: unclassified.length, samples: unclassified.slice(0, 10) })
                );
            }
            db.exec(`
                DROP INDEX IF EXISTS idx_support_sessions_unique;
                CREATE UNIQUE INDEX IF NOT EXISTS idx_support_sessions_unique
                    ON support_sessions(teacher_id, session_date, time_from, section, school_year, cycle_code);
                CREATE INDEX IF NOT EXISTS idx_support_sessions_year_cycle
                    ON support_sessions(school_year, cycle_code);
            `);
        }
    },
    {
        // Central cycle reference schema and the remaining cycle-carrying tables.
        // Legacy rows stay NULL when their source cannot be resolved; the audit log is
        // the operator-facing report instead of a guessed default cycle.
        version: '2026-07-077-cycle-reference-schema',
        up: () => {
            const db = getDb();
            ensureCycleReferenceSchema(db);
            db.prepare(
                `INSERT OR IGNORE INTO user_cycle_access(user_id, cycle_code)
                 SELECT id, '${QUALIFIANT_CYCLE}'
                 FROM users
                 WHERE LOWER(COALESCE(role, '')) NOT IN ('developer', 'admin', 'principal')`
            ).run();

            const cycleTables = [
                'exams',
                'tests',
                'student_profile_data',
                'student_files',
                'correspondence',
                'student_movements'
            ];
            for (const tableName of cycleTables) {
                if (tableExists(db, tableName)) ensureColumn(tableName, 'cycle_code', 'TEXT');
            }

            populateSectionsFromStudents(db);
            backfillSectionOwnedCycles(db, 'exams');
            backfillSectionOwnedCycles(db, 'tests');
            backfillStudentOwnedCycles(db, 'student_profile_data', 'student_id, student_code, school_year');
            backfillStudentOwnedCycles(db, 'correspondence', 'student_id, student_code, school_year');
            backfillStudentOwnedCycles(db, 'student_files', 'student_id, school_year');
            backfillStudentOwnedCycles(db, 'student_movements', 'student_id, school_year');
            reportExamProctorMappings(db);

            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_exams_year_cycle ON exams(school_year, cycle_code);
                CREATE INDEX IF NOT EXISTS idx_tests_year_cycle ON tests(school_year, cycle_code);
                CREATE INDEX IF NOT EXISTS idx_student_profile_year_cycle ON student_profile_data(school_year, cycle_code);
                CREATE INDEX IF NOT EXISTS idx_student_files_year_cycle ON student_files(school_year, cycle_code);
                CREATE INDEX IF NOT EXISTS idx_correspondence_year_cycle ON correspondence(school_year, cycle_code);
                CREATE INDEX IF NOT EXISTS idx_student_movements_year_cycle ON student_movements(school_year, cycle_code);
            `);
        }
    },
    {
        version: '2026-08-078-stage-rules-management',
        up: () => {
            const db = getDb();
            const { DEFAULT_EXAM_COUNTS } = require('./exam-count-defaults');
            const { seedSubjectCatalog, mapSubjectToCode } = require('./education-catalogs/subject-catalog');
            const { seedOfficialCoefficients } = require('./education-catalogs/qualifiant-coefficients');

            function logUnmappable(entityType, entityId, reason) {
                const details = JSON.stringify({ reason });
                const exists = db
                    .prepare(
                        `SELECT 1 FROM system_logs
                         WHERE action = 'STAGE_RULES_MIGRATION_UNMAPPABLE'
                           AND entity_type = ? AND entity_id = ?`
                    )
                    .get(entityType, String(entityId));
                if (!exists) {
                    db.prepare(
                        `INSERT INTO system_logs(action, entity_type, entity_id, details)
                         VALUES('STAGE_RULES_MIGRATION_UNMAPPABLE', ?, ?, ?)`
                    ).run(entityType, String(entityId), details);
                }
            }

            const legacyRows = [];
            if (tableExists(db, 'exam_count_rules')) {
                const columns = db.prepare(`PRAGMA table_info(exam_count_rules)`).all().map((c) => c.name);
                if (!columns.includes('rule_set_id')) {
                    db.exec(`ALTER TABLE exam_count_rules RENAME TO exam_count_rules_legacy`);
                    legacyRows.push(
                        ...db.prepare(`SELECT level_code, subject, exam_count FROM exam_count_rules_legacy`).all()
                    );
                }
            }

            ensureStageRulesSchema(db);
            seedSubjectCatalog(db);
            if (legacyRows.length > 0) {
                db.exec(`DROP TABLE exam_count_rules_legacy`);
            }
            const years = [];
            if (tableExists(db, 'students')) {
                years.push(
                    ...db
                        .prepare(
                            `SELECT DISTINCT school_year FROM students
                             WHERE TRIM(COALESCE(school_year, '')) != ''
                             ORDER BY school_year`
                        )
                        .all()
                        .map((row) => row.school_year)
                );
            }
            if (years.length === 0) {
                const currentYear = db.prepare(`SELECT value FROM settings WHERE key = 'currentSchoolYear'`).get();
                if (currentYear && String(currentYear.value).trim() !== '') {
                    years.push(String(currentYear.value).trim());
                }
            }
            if (years.length === 0) return;

            const insertRuleSet = db.prepare(
                `INSERT OR IGNORE INTO stage_rule_sets(school_year, revision, status, created_by, reason)
                 VALUES(?, 1, 'active', 'system', 'Official seed rules')`
            );
            const selectRuleSet = db.prepare(
                `SELECT id FROM stage_rule_sets WHERE school_year = ? AND revision = 1`
            );
            const insertExamCount = db.prepare(
                `INSERT OR IGNORE INTO exam_count_rules(
                    rule_set_id, cycle_code, level_code, subject_code, exam_count, source
                 ) VALUES(?, '${QUALIFIANT_CYCLE}', ?, ?, ?, 'official')`
            );

            for (const year of years) {
                insertRuleSet.run(year);
                const ruleSetId = selectRuleSet.get(year).id;
                seedOfficialCoefficients(db, ruleSetId, QUALIFIANT_CYCLE);
                const existingExamCount = db
                    .prepare(`SELECT COUNT(*) AS count FROM exam_count_rules WHERE rule_set_id = ?`)
                    .get(ruleSetId).count;
                if (existingExamCount > 0) continue;
                const examRows =
                    legacyRows.length > 0
                        ? legacyRows
                        : DEFAULT_EXAM_COUNTS.map(([subject, examCount]) => ({
                              level_code: '*',
                              subject,
                              exam_count: examCount
                          }));
                for (const row of examRows) {
                    const subjectCode = mapSubjectToCode(row.subject);
                    if (!subjectCode) {
                        logUnmappable('exam_count_rules', row.subject, 'no alias for subject name');
                        continue;
                    }
                    insertExamCount.run(ruleSetId, String(row.level_code).trim() || '*', subjectCode, row.exam_count);
                }
            }

            const legacySettings = db
                .prepare(`SELECT value FROM settings WHERE key = 'subjectCoefficientMappings:v1'`)
                .get();
            if (legacySettings && String(legacySettings.value).trim() !== '') {
                let mappings = [];
                try {
                    mappings = JSON.parse(legacySettings.value);
                } catch (err) {
                    logUnmappable('subjectCoefficientMappings:v1', '', `invalid JSON: ${err.message}`);
                    mappings = [];
                }
                if (!Array.isArray(mappings)) mappings = [];
                const targetYear = years[years.length - 1];
                const activeSet = db
                    .prepare(`SELECT id FROM stage_rule_sets WHERE school_year = ? AND status = 'active' LIMIT 1`)
                    .get(targetYear);
                if (activeSet && mappings.length > 0) {
                    const insertCustom = db.prepare(
                        `INSERT OR IGNORE INTO subject_coefficients(
                            rule_set_id, cycle_code, level_code, stream_code, subject_code, coefficient, source
                         ) VALUES(?, '${QUALIFIANT_CYCLE}', '*', ?, ?, ?, 'custom')`
                    );
                    for (const mapping of mappings) {
                        const subjectCode = mapSubjectToCode(mapping.subject);
                        const streamCode = String(mapping.streamCode || '').toUpperCase().trim();
                        const coefficient = Number(mapping.coefficient);
                        if (!subjectCode || !streamCode || !(coefficient >= 1 && coefficient <= 20)) {
                            logUnmappable(
                                'subjectCoefficientMappings:v1',
                                mapping.subject || JSON.stringify(mapping),
                                'invalid mapping'
                            );
                            continue;
                        }
                        insertCustom.run(activeSet.id, streamCode, subjectCode, coefficient);
                    }
                }
            }
        }
    },
    {
        version: '2026-08-079-stage-subject-weights',
        up: () => {
            const db = getDb();
            const { seedOfficialSubjectWeights } = require('./education-catalogs/subject-weights');
            ensureStageRulesSchema(db);
            const activeRuleSets = db
                .prepare(`SELECT id FROM stage_rule_sets WHERE status = 'active'`)
                .all();
            for (const ruleSet of activeRuleSets) {
                seedOfficialSubjectWeights(db, ruleSet.id, QUALIFIANT_CYCLE);
            }
        }
    },
    {
        // Primary-stage catalogs (docs/plans/2026-08-01-primary-stage-catalogs.md, S3).
        // Seeds are LOCAL seed data written by direct idempotent SQL — no outbox, no
        // capture: they are not user operations. institution_cycles remains a normal
        // synced table for later add/setEnabled IPC operations (review decision 4).
        // No primary exam_count_rules are seeded here: the official rule is not
        // approved yet, and the CHECK 1..12 range cannot represent "zero exams" —
        // exam_count_rules ownership belongs to 2026-08-01-stage-rules-management.md.
        version: '2026-08-080-primary-stage-catalogs',
        up: () => {
            const db = getDb();
            const { LEVEL_CODES } = require('./exam-count-defaults');
            const { PRIMARY_LEVEL_CODES, COLLEGIAL_LEVEL_CODES } = require('./education-catalogs/primary-levels');
            const { seedSubjectCatalog } = require('./education-catalogs/subject-catalog');
            const { seedPrimarySubjects } = require('./education-catalogs/primary-subjects');
            const { seedPrimaryLevelAliases } = require('./education-catalogs/primary-aliases');

            if (!tableExists(db, 'education_levels')) {
                ensureCycleReferenceSchema(db);
            }

            const insertLevel = db.prepare(
                `INSERT OR IGNORE INTO education_levels(level_code, cycle_code, label_ar, label_fr, sort_order)
                 VALUES (?, ?, ?, NULL, ?)`
            );
            const seedLevels = db.transaction(() => {
                for (const level of PRIMARY_LEVEL_CODES) {
                    insertLevel.run(level.code, PRIMARY_CYCLE, level.name, level.order);
                }
                for (const level of COLLEGIAL_LEVEL_CODES) {
                    insertLevel.run(level.code, COLLEGIAL_CYCLE, level.name, level.order);
                }
                for (const level of LEVEL_CODES) {
                    if (String(level.code).trim() === '*') continue;
                    insertLevel.run(level.code, QUALIFIANT_CYCLE, level.name, level.order);
                }
            });
            seedLevels();

            // Institution-wide subject union: qualifiant catalog first (existing rows
            // and aliases win), then the primary additions — INSERT OR IGNORE only.
            seedSubjectCatalog(db);
            seedPrimarySubjects(db);
            seedPrimaryLevelAliases(db);

            // The primary cycle becomes visible as a settings constraint (preview) but
            // is never resolvable as a work cycle (capability gate in cycles repo).
            db.prepare(
                `INSERT OR IGNORE INTO institution_cycles
                 (cycle_code, is_active, profile_version, sort_order)
                 VALUES (?, 1, 'primary-2026-v1', 5)`
            ).run(PRIMARY_CYCLE);
        }
    },
    {
        // S3 (docs/plans/2026-08-02-multi-stage-school-architecture.md, row 103):
        // `student_orientation.cycle_code` is a historical snapshot derived in main
        // from the students table at write time — never renderer-supplied, never
        // rewritten on update. Backfill resolves each row against its matching
        // student (same school_year, code-normalized); rows without a match stay
        // NULL — never guessed, never defaulted — and are logged for review
        // (reporting pattern mirrors 2026-08-078 STAGE_RULES_MIGRATION_UNMAPPABLE).
        // All writes here are plain local data: zero sync_outbox rows.
        version: '2026-08-081-student-orientation-cycle-code',
        up: () => {
            const db = getDb();
            ensureColumn('student_orientation', 'cycle_code', 'TEXT');

            if (tableExists(db, 'students')) {
                db.exec(`
                    UPDATE student_orientation
                       SET cycle_code = (
                           SELECT s.cycle_code
                             FROM students s
                            WHERE s.school_year = student_orientation.school_year
                              AND UPPER(TRIM(s.code)) = UPPER(TRIM(student_orientation.student_code))
                            LIMIT 1
                       )
                     WHERE cycle_code IS NULL
                `);
            }

            // Rows still NULL after backfill have no resolvable student: they keep
            // NULL and are logged once for operator review (idempotent — the
            // exists-check prevents duplicates on re-run).
            const unresolved = db
                .prepare(`SELECT COUNT(*) AS count FROM student_orientation WHERE cycle_code IS NULL`)
                .get().count;
            if (unresolved > 0) {
                const details = JSON.stringify({ count: unresolved });
                const exists = db
                    .prepare(
                        `SELECT 1 FROM system_logs
                         WHERE action = 'ORIENTATION_BACKFILL_UNRESOLVED'
                           AND entity_type = 'student_orientation'
                           AND entity_id = 'backfill'`
                    )
                    .get();
                if (!exists) {
                    db.prepare(
                        `INSERT INTO system_logs(action, entity_type, entity_id, details)
                         VALUES('ORIENTATION_BACKFILL_UNRESOLVED', 'student_orientation', 'backfill', ?)`
                    ).run(details);
                }
            }
        }
    },
    {
        // S4 (docs/plans/2026-08-02-multi-stage-school-architecture.md, rows 105-115):
        // official immutable stage profiles + the per-year effectivity spine.
        //   - cycle_profiles logical key = (cycle_code, profile_version); only the
        //     qualifiant profile (exams/coefficients) and the primary profile
        //     (continuous, no coefficients) are seeded — the collegial profile stays
        //     non-operational until its official file is approved (row 115).
        //   - cycle_profile_assignments(school_year, cycle_code, profile_version,
        //     rule_set_id) is the runtime-authoritative reference: the qualifiant
        //     profile is bound to the ACTIVE stage_rule_sets revision of the same
        //     school year when one exists; primary/continuous rows never bind a rule
        //     set. CYCLE_CATALOG.profileVersion / institution_cycles.profile_version
        //     remain seed/migration hints only (row 110).
        //   - `default_exam_counts` is NOT recreated anywhere: exam_count_rules is the
        //     sole source (row 107).
        // All writes here are local seed data by direct idempotent SQL — zero
        // sync_outbox rows, zero capture (they are not user operations).
        version: '2026-08-082-cycle-profiles',
        up: () => {
            const db = getDb();
            ensureCycleProfilesSchema(db);

            const insertProfile = db.prepare(
                `INSERT OR IGNORE INTO cycle_profiles(
                    cycle_code, profile_version, uses_coefficients, assessment_model
                 ) VALUES (?, ?, ?, ?)`
            );
            insertProfile.run(PRIMARY_CYCLE, 'primary-2026-v1', 0, 'continuous');
            insertProfile.run(QUALIFIANT_CYCLE, 'qualifiant-2026-v1', 1, 'exams');

            if (tableExists(db, 'stage_rule_sets')) {
                // Seed the qualifiant profile only where its official rules exist:
                // bind each school year's active revision (row 115).
                const activeSets = db
                    .prepare(`SELECT school_year, id FROM stage_rule_sets WHERE status = 'active'`)
                    .all();
                const upsertAssignment = db.prepare(
                    `INSERT INTO cycle_profile_assignments(
                        school_year, cycle_code, profile_version, rule_set_id
                     ) VALUES (?, ?, 'qualifiant-2026-v1', ?)
                     ON CONFLICT(school_year, cycle_code) DO UPDATE SET
                        profile_version = excluded.profile_version,
                        rule_set_id = excluded.rule_set_id`
                );
                for (const set of activeSets) upsertAssignment.run(set.school_year, QUALIFIANT_CYCLE, set.id);
            }
        }
    },
    {
        // S4 follow-up (plan row 113): the composite FK (cycle_code, profile_version)
        // → cycle_profiles was missing from the assignments table shipped by 082.
        // Fresh installs get it from the canonical DDL (ensureCycleProfilesSchema);
        // this migration rebuilds the table on upgraded DBs so every install enforces
        // the same constraint (SQLite cannot ALTER-ADD a foreign key). The rebuild
        // preserves id + row identity so sync_id_map / sync_snapshots linkage
        // survives. Local schema operation only — zero sync_outbox rows.
        // recordsVersionInternally: PRAGMA foreign_keys can only be toggled outside
        // a transaction, so this migration runs outside the runner's wrapping
        // transaction and manages its own atomic transaction + version record
        // (pattern 2026-07-065-fk-ondelete-and-identity-keys).
        version: '2026-08-083-cycle-profile-assignments-fk',
        recordsVersionInternally: true,
        up: () => {
            const db = getDb();
            const recordMigration = db.prepare('INSERT INTO schema_migrations(version) VALUES(?)');

            if (!tableExists(db, 'cycle_profile_assignments') || !tableExists(db, 'cycle_profiles')) {
                // Tables created after this migration runs (fresh install) already get
                // the FK from the canonical DDL — nothing to rebuild here.
                recordMigration.run('2026-08-083-cycle-profile-assignments-fk');
                return;
            }
            const hasProfileFk = db
                .prepare(`PRAGMA foreign_key_list(cycle_profile_assignments)`)
                .all()
                .some((fk) => String(fk.table) === 'cycle_profiles');
            if (hasProfileFk) {
                recordMigration.run('2026-08-083-cycle-profile-assignments-fk');
                return;
            }

            db.exec('PRAGMA foreign_keys=off;');
            const txn = db.transaction(() => {
                rebuildTableWithConstraints(
                    db,
                    'cycle_profile_assignments',
                    `CREATE TABLE cycle_profile_assignments__rb(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        school_year TEXT NOT NULL,
                        cycle_code TEXT NOT NULL,
                        profile_version TEXT NOT NULL,
                        rule_set_id INTEGER REFERENCES stage_rule_sets(id),
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(school_year, cycle_code),
                        FOREIGN KEY(cycle_code, profile_version)
                            REFERENCES cycle_profiles(cycle_code, profile_version)
                    )`
                );
                recordMigration.run('2026-08-083-cycle-profile-assignments-fk');
            });
            try {
                txn();
            } finally {
                db.exec('PRAGMA foreign_keys=on;');
            }
        }
    },
    {
        // Collegial official file (2026-08-084-collegial-stage-file): seals the
        // collegial dossier (D:\secondaire\معاملات المواد -نتاءئج مدرسية.md report cards + نسبة
        // الأنشطة المندمجة الشامل.md) into the stage-rules spine so the collegial
        // cycle is no longer "pending official data". Three parts:
        //   a. widen cycle_profiles.assessment_model CHECK to 'exams_activities'
        //      (SQLite cannot ALTER a CHECK → table rebuild via the recordsVersion-
        //      Internally pattern used by 083; fresh installs already get the
        //      widened CHECK from the updated ensureCycleProfilesSchema via 082);
        //   b. seed the collegial-2026-v1 profile (uses_coefficients=1,
        //      assessment_model='exams_activities') + the collegial subject catalog
        //      (TECHNOLOGY is new; the rest union-seed existing codes);
        //   c. for every ACTIVE stage_rule_sets revision, seed the collegial
        //      official coefficient/exam-count/weight rows and bind the per-year
        //      assignment (school_year, secondary_collegial, collegial-2026-v1,
        //      rule_set_id) exactly like 082 binds the qualifiant profile.
        // All seeds are direct idempotent SQL — zero capture, zero outbox rows.
        version: '2026-08-084-collegial-stage-file',
        recordsVersionInternally: true,
        up: () => {
            const db = getDb();
            const recordMigration = db.prepare('INSERT INTO schema_migrations(version) VALUES(?)');

            // (a) Widen the assessment_model CHECK on upgraded DBs.
            if (tableExists(db, 'cycle_profiles')) {
                const row = db
                    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cycle_profiles'`)
                    .get();
                const ddl = String(row?.sql || '');
                if (!ddl.includes('exams_activities')) {
                    db.exec('PRAGMA foreign_keys=off;');
                    try {
                        db.transaction(() => {
                            rebuildTableWithConstraints(
                                db,
                                'cycle_profiles',
                                `CREATE TABLE cycle_profiles__rb(
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    cycle_code TEXT NOT NULL,
                                    profile_version TEXT NOT NULL,
                                    uses_coefficients INTEGER NOT NULL DEFAULT 1 CHECK(uses_coefficients IN (0, 1)),
                                    assessment_model TEXT NOT NULL DEFAULT 'exams'
                                        CHECK(assessment_model IN ('exams','continuous','exams_activities')),
                                    is_official INTEGER NOT NULL DEFAULT 1 CHECK(is_official IN (0, 1)),
                                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                    UNIQUE(cycle_code, profile_version)
                                )`
                            );
                        })();
                    } finally {
                        db.exec('PRAGMA foreign_keys=on;');
                    }
                }
            }

            // (b) Collegial profile + subject catalog.
            db.prepare(
                `INSERT OR IGNORE INTO cycle_profiles(
                    cycle_code, profile_version, uses_coefficients, assessment_model
                 ) VALUES (?, ?, ?, ?)`
            ).run(COLLEGIAL_CYCLE, 'collegial-2026-v1', 1, 'exams_activities');
            if (tableExists(db, 'education_subjects') && tableExists(db, 'subject_aliases')) {
                const { seedCollegialSubjects } = require('./education-catalogs/collegial-subjects');
                seedCollegialSubjects(db);
            }

            // (c) Collegial rule rows + assignment for every active revision.
            if (tableExists(db, 'stage_rule_sets') && tableExists(db, 'cycle_profile_assignments')) {
                const { seedOfficialCollegialRows } = require('./education-catalogs/collegial-rules');
                const activeSets = db
                    .prepare(`SELECT school_year, id FROM stage_rule_sets WHERE status = 'active'`)
                    .all();
                const upsertAssignment = db.prepare(
                    `INSERT INTO cycle_profile_assignments(
                        school_year, cycle_code, profile_version, rule_set_id
                     ) VALUES (?, ?, 'collegial-2026-v1', ?)
                     ON CONFLICT(school_year, cycle_code) DO UPDATE SET
                        profile_version = excluded.profile_version,
                        rule_set_id = excluded.rule_set_id`
                );
                for (const set of activeSets) {
                    seedOfficialCollegialRows(db, set.id);
                    upsertAssignment.run(set.school_year, COLLEGIAL_CYCLE, set.id);
                }
            }

            recordMigration.run('2026-08-084-collegial-stage-file');
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

module.exports = {
    runMigrations,
    ensureMigrationsTable,
    assertMigrationVersionIntegrity,
    MIGRATIONS,
    populateSectionsFromStudents
};
