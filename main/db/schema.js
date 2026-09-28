const { getDb } = require('./context');
const { generateRandomPassword, hashPassword } = require('../auth/password');

// Create tables
function createTables() {
    const db = getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS students (
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(code, school_year)
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS grades(
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
        cycle_code TEXT NOT NULL,
        teacher_resolution TEXT DEFAULT 'unresolved',
        source_file_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(id)
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS settings(
        key TEXT PRIMARY KEY,
        value TEXT
    );
    `);

    // Absences table
    db.exec(`
        CREATE TABLE IF NOT EXISTS absences(
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
        cycle_code TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(student_id) REFERENCES students(id)
    );
    `);

    // Correspondence table
    db.exec(`
        CREATE TABLE IF NOT EXISTS correspondence(
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
        FOREIGN KEY(student_id) REFERENCES students(id)
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS student_files(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        doc_key TEXT NOT NULL,
        is_present INTEGER DEFAULT 0,
        school_year TEXT,
        cycle_code TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, doc_key, school_year),
        FOREIGN KEY(student_id) REFERENCES students(id)
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS student_movements(
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
        FOREIGN KEY(student_id) REFERENCES students(id)
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS teachers(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ppr TEXT,
        cin TEXT,
        full_name TEXT NOT NULL,
        full_name_fr TEXT,
        subject TEXT,
        specialty_subject TEXT,
        gender TEXT,
        birth_date TEXT,
        birth_place TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        grade TEXT,
        cadre TEXT,
        echelon INTEGER,
        hire_date TEXT,
        marital_status TEXT,
        function_title TEXT,
        position TEXT,
        statut TEXT,
        diploma_school TEXT,
        diploma_professional TEXT,
        seniority_admin TEXT,
        seniority_grade TEXT,
        echelon_date TEXT,
        titularization_date TEXT,
        total_hours REAL,
        overtime_hours REAL,
        num_classes REAL,
        is_surplus INTEGER DEFAULT 0,
        source TEXT DEFAULT 'manual',
        school_year TEXT,
        active INTEGER DEFAULT 1,
        source_function_code TEXT,
        source_assignment_mode TEXT,
        source_cycle_code TEXT,
        scope_type TEXT NOT NULL DEFAULT 'teaching_assignment',
        source_updated_at TEXT,
        source_activity_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);

    ensureTeacherTeachingAssignmentsSchema(db);

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
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS teacher_absences(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        absence_date DATE NOT NULL,
        reason TEXT,
        replacement_teacher TEXT,
        school_year TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(teacher_id) REFERENCES teachers(id)
    );
    `);

    // Staff attendance (absences + tardiness)
    db.exec(`
        CREATE TABLE IF NOT EXISTS staff_attendance(
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS exams(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        section TEXT,
        subject TEXT,
        exam_date DATE,
        exam_time TEXT,
        school_year TEXT,
        cycle_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS exam_proctors(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exam_id INTEGER,
        teacher_id INTEGER,
        teacher_name TEXT,
        room TEXT,
        school_year TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(exam_id) REFERENCES exams(id),
        FOREIGN KEY(teacher_id) REFERENCES teachers(id)
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS exam_rooms(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_name TEXT NOT NULL,
        capacity INTEGER DEFAULT 0,
        equipment TEXT,
        school_year TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS tests(
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS student_profile_data (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id    INTEGER NOT NULL,
            student_code  TEXT NOT NULL,
            tab_key       TEXT NOT NULL
                          CHECK(tab_key IN ('economic','social','health','followup','guidance')),
            data_json     TEXT NOT NULL DEFAULT '{}',
            school_year   TEXT NOT NULL,
            cycle_code    TEXT,
            updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_by    TEXT,
            UNIQUE(student_code, tab_key, school_year)
        );
    `);
    db.exec(
        `CREATE INDEX IF NOT EXISTS idx_student_profile_student ON student_profile_data(student_code, school_year)`
    );

    db.exec(`
        CREATE TABLE IF NOT EXISTS system_logs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        entity_type TEXT,
        entity_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        role TEXT DEFAULT 'staff',
        password_hash TEXT,
        firebase_uid TEXT,
        auth_source TEXT DEFAULT 'local',
        email_verified INTEGER DEFAULT 0,
        invite_status TEXT DEFAULT 'active',
        last_login_at DATETIME,
        last_auth_mode TEXT,
        pin_hash TEXT,
        pin_failed_attempts INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        must_change_password INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);

    // Backward-compatibility for existing databases created before password auth
    ensureColumn('users', 'password_hash', 'TEXT');
    ensureColumn('users', 'firebase_uid', 'TEXT');
    ensureColumn('users', 'auth_source', "TEXT DEFAULT 'local'");
    ensureColumn('users', 'email_verified', 'INTEGER DEFAULT 0');
    ensureColumn('users', 'invite_status', "TEXT DEFAULT 'active'");
    ensureColumn('users', 'last_login_at', 'DATETIME');
    ensureColumn('users', 'last_auth_mode', 'TEXT');
    ensureColumn('users', 'must_change_password', 'INTEGER DEFAULT 0');
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS uidx_users_firebase_uid
        ON users(firebase_uid)
        WHERE firebase_uid IS NOT NULL AND trim(firebase_uid) != '';
    `);

    ensureLicensingSchema(db);
    ensureOwnerSyncSchema(db);
    ensureSyncSchema(db);
    ensurePageVisibilitySchema(db);
    ensureInstitutionSchema(db);
    ensureCycleReferenceSchema(db);

    // Initialize trial start date on first DB creation
    const { ensureTrialStartDate } = require('../licensing/trialService');
    ensureTrialStartDate(db);

    // Set default school year
    db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES('currentSchoolYear', '2025/2026')`).run();

    // Only seed admin user on first-ever creation (no row with id=1 yet)
    const existingAdmin = db.prepare('SELECT id FROM users WHERE id = 1').get();
    if (!existingAdmin) {
        const adminPassword = generateRandomPassword();
        db.prepare(
            `
                INSERT INTO users(id, name, email, role, password_hash, disabled, must_change_password)
                VALUES(1, 'Admin', 'admin@school.local', 'admin', ?, 0, 1)
            `
        ).run(hashPassword(adminPassword));

        console.log(
            '[SETUP] Initial admin account created (admin@school.local). Password will be required on first login.'
        );
    }

    // Safety net: if admin exists but has no password (e.g. corrupted data), reset it
    const adminNoPw = db
        .prepare(`SELECT id FROM users WHERE id = 1 AND (password_hash IS NULL OR trim(password_hash) = '')`)
        .get();
    if (adminNoPw) {
        const resetPassword = generateRandomPassword();
        db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = 1`).run(
            hashPassword(resetPassword)
        );
        console.log('[SETUP] Admin password was missing — a new password has been generated. Must change on login.');
    }

    // ── Performance indexes ──
    // Almost every query filters by school_year; many JOIN on student_code.
    // NOTE: the *_year_cycle indexes on exams/tests/student_profile_data/student_files/
    // correspondence/student_movements are owned by migration 2026-07-077, which adds
    // the cycle_code columns first. createTables() runs BEFORE migrations
    // (main/db/init.js), so creating them here breaks startup on pre-077 databases
    // where those tables exist without cycle_code.
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_students_year       ON students(school_year);
        CREATE INDEX IF NOT EXISTS idx_students_code_year   ON students(code, school_year);
        CREATE INDEX IF NOT EXISTS idx_grades_year_code     ON grades(school_year, student_code);
        CREATE INDEX IF NOT EXISTS idx_grades_year_subject  ON grades(school_year, subject);
        CREATE INDEX IF NOT EXISTS idx_absences_year_code   ON absences(school_year, student_code);
        CREATE INDEX IF NOT EXISTS idx_absences_year_month  ON absences(school_year, month);
        CREATE INDEX IF NOT EXISTS idx_teachers_year        ON teachers(school_year);
        CREATE INDEX IF NOT EXISTS idx_teacher_aliases_lookup ON teacher_aliases(school_year, alias_normalized);
        CREATE INDEX IF NOT EXISTS idx_teacher_aliases_teacher ON teacher_aliases(teacher_id, school_year);
        CREATE INDEX IF NOT EXISTS idx_correspondence_year  ON correspondence(school_year);
        CREATE INDEX IF NOT EXISTS idx_system_logs_entity   ON system_logs(entity_type, created_at);
        CREATE INDEX IF NOT EXISTS idx_system_logs_action   ON system_logs(action, created_at);
        CREATE INDEX IF NOT EXISTS idx_staff_attendance_year ON staff_attendance(school_year);
        CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance(attendance_date, school_year);
        CREATE UNIQUE INDEX IF NOT EXISTS uidx_staff_attendance_absence
            ON staff_attendance(
                attendance_date,
                school_year,
                COALESCE(teacher_id, -1),
                COALESCE(teacher_name, ''),
                COALESCE(absence_period, 'full_day')
            )
            WHERE type = 'absence';
        CREATE UNIQUE INDEX IF NOT EXISTS uidx_staff_attendance_late
            ON staff_attendance(
                attendance_date,
                school_year,
                COALESCE(teacher_id, -1),
                COALESCE(teacher_name, '')
            )
            WHERE type = 'late';
    `);
    try {
        db.exec(`CREATE INDEX IF NOT EXISTS idx_grades_year_teacher ON grades(school_year, teacher_id)`);
    } catch {
        /* column doesn't exist yet on upgraded DBs — migration will create it */
    }
    try {
        db.exec(`CREATE INDEX IF NOT EXISTS idx_tests_year_teacher ON tests(school_year, teacher_id)`);
    } catch {
        /* column doesn't exist yet on upgraded DBs — migration will create it */
    }
    // ppr index: may fail on existing DBs before migration adds the column — migration handles it too
    try {
        db.exec(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_ppr_year ON teachers(ppr, school_year) WHERE ppr IS NOT NULL AND ppr != ''`
        );
    } catch {
        /* column doesn't exist yet — migration will create it */
    }
}

function listTableColumns(db, tableName) {
    if (typeof db.pragma === 'function') return db.pragma(`table_info(${tableName})`);
    return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

function ensureTeacherSourceColumns(existingDb) {
    const db = existingDb || getDb();
    const columns = [
        ['source_function_code', 'TEXT'],
        ['source_assignment_mode', 'TEXT'],
        ['source_cycle_code', 'TEXT'],
        ['scope_type', "TEXT NOT NULL DEFAULT 'teaching_assignment'"],
        ['source_updated_at', 'TEXT'],
        ['source_activity_json', 'TEXT']
    ];
    const existing = new Set(listTableColumns(db, 'teachers').map((column) => column.name));
    for (const [name, definition] of columns) {
        if (!existing.has(name)) db.exec(`ALTER TABLE teachers ADD COLUMN ${name} ${definition}`);
    }
    db.prepare(
        `UPDATE teachers SET scope_type = 'teaching_assignment'
         WHERE scope_type IS NULL OR TRIM(scope_type) = ''`
    ).run();
}

function ensureTeacherTeachingAssignmentsSchema(existingDb) {
    const db = existingDb || getDb();
    ensureTeacherSourceColumns(db);
    db.exec(`
        CREATE TABLE IF NOT EXISTS teacher_teaching_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
            school_year TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            level_code TEXT NOT NULL DEFAULT '',
            section TEXT NOT NULL DEFAULT '',
            subject_code TEXT NOT NULL DEFAULT '',
            subject_label TEXT,
            source TEXT NOT NULL,
            source_file_name TEXT,
            decision_source TEXT NOT NULL DEFAULT 'import_suggestion'
                CHECK(decision_source IN ('import_suggestion','principal_decision','admin_decision','manual_assignment')),
            decided_by_user_id INTEGER,
            decided_at TEXT,
            confidence TEXT NOT NULL DEFAULT 'review_required'
                CHECK(confidence IN ('confirmed','review_required','rejected')),
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(teacher_id, school_year, cycle_code, level_code, section, subject_code)
        );
        CREATE INDEX IF NOT EXISTS idx_teacher_assignments_cycle_year
            ON teacher_teaching_assignments(cycle_code, school_year);
        CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_year
            ON teacher_teaching_assignments(teacher_id, school_year);
        CREATE INDEX IF NOT EXISTS idx_teacher_assignments_operational
            ON teacher_teaching_assignments(cycle_code, school_year, confidence, is_active);
    `);
}

function ensureLicensingSchema(existingDb) {
    const db = existingDb || getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS license_plans(
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            max_devices INTEGER NOT NULL CHECK(max_devices >= 1),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS licenses(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_key_hash TEXT UNIQUE NOT NULL,
            key_hint TEXT,
            plan_code TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            expires_at DATETIME,
            offline_grace_days INTEGER DEFAULT 14,
            requires_online_validation INTEGER DEFAULT 0,
            last_validated_at DATETIME,
            metadata TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(plan_code) REFERENCES license_plans(code)
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS license_activations(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_id INTEGER NOT NULL,
            device_hash TEXT NOT NULL,
            fingerprint_vector TEXT,
            device_name TEXT,
            os_platform TEXT,
            app_version TEXT,
            first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            revoked_at DATETIME,
            UNIQUE(license_id, device_hash),
            FOREIGN KEY(license_id) REFERENCES licenses(id)
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS license_events(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_id INTEGER,
            event_type TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(license_id) REFERENCES licenses(id)
        );
    `);

    db.prepare(`INSERT OR IGNORE INTO license_plans(code, name, max_devices) VALUES('basic', 'Basic', 1)`).run();
    db.prepare(`INSERT OR IGNORE INTO license_plans(code, name, max_devices) VALUES('pro', 'Pro', 3)`).run();
    db.prepare(`INSERT OR IGNORE INTO license_plans(code, name, max_devices) VALUES('business', 'Business', 10)`).run();

    db.prepare(`UPDATE license_plans SET max_devices = 1 WHERE code = 'basic'`).run();
    db.prepare(`UPDATE license_plans SET max_devices = 3 WHERE code = 'pro'`).run();
    db.prepare(`UPDATE license_plans SET max_devices = 10 WHERE code = 'business'`).run();
}

function ensureOwnerSyncSchema(existingDb) {
    const db = existingDb || getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS owner_sync_config(
            id INTEGER PRIMARY KEY CHECK(id = 1),
            server_url TEXT,
            owner_token TEXT,
            write_token TEXT,
            read_token TEXT,
            enabled INTEGER DEFAULT 0,
            heartbeat_interval_minutes INTEGER DEFAULT 360,
            last_sync_at DATETIME,
            last_error TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    ensureColumn('owner_sync_config', 'write_token', 'TEXT');
    ensureColumn('owner_sync_config', 'read_token', 'TEXT');

    db.exec(`
        CREATE TABLE IF NOT EXISTS owner_sync_outbox(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            retries INTEGER DEFAULT 0,
            last_attempt_at DATETIME,
            sent_at DATETIME,
            last_error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_owner_sync_outbox_status_id
        ON owner_sync_outbox(status, id);
    `);

    db.prepare(
        `
            INSERT OR IGNORE INTO owner_sync_config(
                id,
                server_url,
                owner_token,
                write_token,
                read_token,
                enabled,
                heartbeat_interval_minutes
            )
            VALUES(1, '', '', '', '', 0, 360)
        `
    ).run();
}

function ensureSyncSchema(existingDb) {
    const db = existingDb || getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS sync_outbox (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name      TEXT    NOT NULL,
            row_sync_id     TEXT    NOT NULL,
            operation       TEXT    NOT NULL CHECK(operation IN ('PUT','DEL')),
            row_data        TEXT,
            school_year     TEXT,
            status          TEXT    NOT NULL DEFAULT 'pending',
            retries         INTEGER          DEFAULT 0,
            last_attempt_at DATETIME,
            sent_at         DATETIME,
            last_error      TEXT,
            created_at      DATETIME         DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_id
        ON sync_outbox(status, id);

        CREATE INDEX IF NOT EXISTS idx_sync_outbox_created_at
        ON sync_outbox(created_at);

        CREATE TABLE IF NOT EXISTS sync_id_map (
            row_sync_id TEXT PRIMARY KEY,
            table_name  TEXT    NOT NULL,
            local_id    INTEGER NOT NULL,
            UNIQUE(table_name, local_id)
        );

        CREATE TABLE IF NOT EXISTS sync_config (
            id                      INTEGER PRIMARY KEY CHECK(id = 1),
            school_id               TEXT,
            enabled                 INTEGER  DEFAULT 0,
            sync_interval_minutes   INTEGER  DEFAULT 10,
            device_hash             TEXT,
            device_name             TEXT,
            school_id_hash          TEXT,
            retention_days          INTEGER  DEFAULT 7,
            last_capture_error      TEXT,
            firebase_functions_url  TEXT     DEFAULT '',
            firebase_project_id     TEXT     DEFAULT '',
            firebase_api_key        TEXT     DEFAULT '',
            firebase_auth_domain    TEXT     DEFAULT '',
            firebase_app_id         TEXT     DEFAULT '',
            firebase_storage_bucket TEXT     DEFAULT '',
            firebase_messaging_sender_id TEXT DEFAULT '',
            updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sync_pull_state (
            table_name      TEXT PRIMARY KEY,
            last_pulled_at  TEXT,
            last_pull_error TEXT,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Inbound rows this device cannot apply correctly yet (multi-cycle plan §9.2).
        -- A row missing a required column is held here with its full payload instead of
        -- stalling the pull cursor for every other entity: the device keeps syncing, and
        -- the held rows are retried automatically once its schema catches up.
        CREATE TABLE IF NOT EXISTS sync_quarantine (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            row_sync_id      TEXT NOT NULL UNIQUE,
            table_name       TEXT NOT NULL,
            operation        TEXT NOT NULL,
            contract_version INTEGER DEFAULT 1,
            reason           TEXT NOT NULL,
            item_json        TEXT NOT NULL,
            retry_count      INTEGER NOT NULL DEFAULT 0,
            quarantined_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_attempt_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sync_quarantine_table ON sync_quarantine(table_name);
    `);

    db.prepare(
        `
        INSERT OR IGNORE INTO sync_config(id, enabled, sync_interval_minutes, retention_days)
        VALUES(1, 0, 10, 7)
    `
    ).run();

    ensureColumn('sync_config', 'firebase_functions_url', "TEXT DEFAULT ''");
    ensureColumn('sync_config', 'firebase_project_id', "TEXT DEFAULT ''");
    ensureColumn('sync_config', 'firebase_api_key', "TEXT DEFAULT ''");
    ensureColumn('sync_config', 'firebase_auth_domain', "TEXT DEFAULT ''");
    ensureColumn('sync_config', 'firebase_app_id', "TEXT DEFAULT ''");
    ensureColumn('sync_config', 'firebase_storage_bucket', "TEXT DEFAULT ''");
    ensureColumn('sync_config', 'firebase_messaging_sender_id', "TEXT DEFAULT ''");
    ensureColumn('sync_config', 'firebase_email', 'TEXT');
    ensureColumn('sync_config', 'firebase_credential', 'TEXT');
}

function ensurePageVisibilitySchema(existingDb) {
    const db = existingDb || getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS page_visibility(
            page_key TEXT PRIMARY KEY,
            is_visible INTEGER NOT NULL DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_page_visibility_visible
        ON page_visibility(is_visible);
    `);

    // Track the applied defaults version so developer changes propagate automatically
    db.exec(`
        CREATE TABLE IF NOT EXISTS app_meta(
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    // Read default hidden pages and version from the bundled config file
    const path = require('path');
    const fs = require('fs');
    let hiddenPages = new Set(['communication-center-prototype.html']);
    let configVersion = 0;
    try {
        const defaultsPath = path.join(__dirname, '..', '..', 'page-visibility-defaults.json');
        if (fs.existsSync(defaultsPath)) {
            const parsed = JSON.parse(fs.readFileSync(defaultsPath, 'utf-8'));
            configVersion = Number(parsed.version) || 0;
            if (Array.isArray(parsed.hiddenPages) && parsed.hiddenPages.length > 0) {
                hiddenPages = new Set(parsed.hiddenPages.filter((p) => typeof p === 'string' && p.endsWith('.html')));
            }
        }
    } catch {
        // fallback to hardcoded defaults above
    }

    // Check the last applied defaults version
    const appliedRow = db.prepare("SELECT value FROM app_meta WHERE key = 'page_visibility_defaults_version'").get();
    const appliedVersion = Number(appliedRow?.value) || 0;
    const needsForceUpdate = configVersion > appliedVersion;

    const ALL_MANAGED_PAGES = require('./managed-pages');

    if (needsForceUpdate) {
        // Developer bumped the version → force-update ALL pages to match new defaults
        const upsert = db.prepare(`
            INSERT INTO page_visibility(page_key, is_visible, updated_at)
            VALUES(?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(page_key) DO UPDATE SET is_visible = excluded.is_visible, updated_at = CURRENT_TIMESTAMP
        `);
        for (const page of ALL_MANAGED_PAGES) {
            upsert.run(page, hiddenPages.has(page) ? 0 : 1);
        }
        // Record the applied version
        db.prepare(
            "INSERT INTO app_meta(key, value) VALUES('page_visibility_defaults_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).run(String(configVersion));
        console.log(`[schema] page_visibility: force-updated to defaults version ${configVersion}`);
    } else {
        // Same version → only seed missing pages (INSERT OR IGNORE)
        const stmt = db.prepare('INSERT OR IGNORE INTO page_visibility(page_key, is_visible) VALUES(?, ?)');
        for (const page of ALL_MANAGED_PAGES) {
            stmt.run(page, hiddenPages.has(page) ? 0 : 1);
        }
    }
}

function ensureInstitutionSchema(existingDb) {
    const db = existingDb || getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS institution_config (
            id                INTEGER PRIMARY KEY CHECK(id = 1),
            code_etablissement TEXT,
            massar_code       TEXT,
            institution_name  TEXT,
            setup_completed   INTEGER DEFAULT 0,
            setup_mode        TEXT,
            setup_device_hash TEXT,
            onboarding_version INTEGER DEFAULT 1,
            onboarding_completed_at DATETIME,
            created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS device_otp (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            otp_hash          TEXT    NOT NULL,
            massar_code       TEXT    NOT NULL,
            created_by_device TEXT,
            expires_at        DATETIME NOT NULL,
            used_by_device    TEXT,
            used_at           DATETIME,
            status            TEXT    DEFAULT 'active'
        );

        CREATE TABLE IF NOT EXISTS linked_devices (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            device_hash       TEXT    UNIQUE NOT NULL,
            device_name       TEXT,
            os_platform       TEXT,
            app_version       TEXT,
            linked_by         TEXT,
            linked_at         DATETIME,
            last_seen_at      DATETIME,
            revoked_at        DATETIME,
            status            TEXT    DEFAULT 'active'
        );

        CREATE INDEX IF NOT EXISTS idx_device_otp_massar_status
        ON device_otp(massar_code, status);

        CREATE INDEX IF NOT EXISTS idx_linked_devices_status
        ON linked_devices(status);
    `);

    ensureColumn('institution_config', 'massar_code', 'TEXT');
    ensureColumn('institution_config', 'onboarding_version', 'INTEGER DEFAULT 1');
    ensureColumn('institution_config', 'onboarding_completed_at', 'DATETIME');
}

// R5 — canonical DDL for the notifications table. Previously this schema was
// defined in BOTH migration 2026-03-015 AND main/notifications/store.js; because
// both used CREATE TABLE IF NOT EXISTS, the first writer silently won and the two
// copies could drift. This is now the single source of truth; store.js calls it.
function ensureNotificationsSchema(existingDb) {
    const db = existingDb || getDb();
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

// R5 — canonical DDL for the school_identity table. Previously duplicated in
// migration 2026-03-14 AND main/reports/identity.js. Single source of truth now;
// identity.js calls it (and keeps its own default-row seeding).
function ensureSchoolIdentitySchema(existingDb) {
    const db = existingDb || getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS school_identity (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL DEFAULT '',
            updated_at  INTEGER DEFAULT (strftime('%s','now') * 1000)
        )
    `);
}

function ensureInstitutionCyclesSchema(existingDb) {
    const db = existingDb || getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS institution_cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cycle_code TEXT NOT NULL UNIQUE,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
            seed_profile_version_hint TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_institution_cycles_active
            ON institution_cycles(is_active, sort_order);
    `);
}

function ensureCycleReferenceSchema(existingDb) {
    const db = existingDb || getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_cycle_access (
            user_id INTEGER NOT NULL,
            cycle_code TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(user_id, cycle_code),
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_user_cycle_access_cycle
            ON user_cycle_access(cycle_code, user_id);

        CREATE TABLE IF NOT EXISTS education_levels (
            level_code TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            label_ar TEXT NOT NULL DEFAULT '',
            label_fr TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
            PRIMARY KEY(level_code, cycle_code)
        );
        CREATE INDEX IF NOT EXISTS idx_education_levels_cycle
            ON education_levels(cycle_code, is_active, sort_order);

        CREATE TABLE IF NOT EXISTS level_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cycle_code TEXT NOT NULL,
            raw_alias TEXT NOT NULL,
            normalized_alias TEXT NOT NULL,
            level_code TEXT NOT NULL,
            source TEXT,
            UNIQUE(cycle_code, normalized_alias)
        );
        CREATE INDEX IF NOT EXISTS idx_level_aliases_lookup
            ON level_aliases(cycle_code, normalized_alias);

        CREATE TABLE IF NOT EXISTS education_subjects (
            subject_code TEXT PRIMARY KEY,
            label_ar TEXT NOT NULL DEFAULT '',
            label_fr TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
        );

        CREATE TABLE IF NOT EXISTS subject_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_alias TEXT NOT NULL,
            normalized_alias TEXT NOT NULL UNIQUE,
            subject_code TEXT NOT NULL,
            source TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_subject_aliases_lookup
            ON subject_aliases(normalized_alias);

        CREATE TABLE IF NOT EXISTS sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section_code TEXT NOT NULL,
            raw_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            level_code TEXT,
            stream_code TEXT,
            school_year TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
            UNIQUE(section_code, cycle_code, school_year)
        );
        CREATE INDEX IF NOT EXISTS idx_sections_year_cycle
            ON sections(school_year, cycle_code);
        CREATE INDEX IF NOT EXISTS idx_sections_cycle_level
            ON sections(cycle_code, level_code, school_year);
    `);
}

// Canonical DDL for stage rules management tables (029). Called by migration
// 2026-08-078-stage-rules-management; not wired into createTables().
function ensureStageRulesSchema(existingDb) {
    const db = existingDb || getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS stage_rule_sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_year TEXT NOT NULL,
            revision INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('draft','active','closed')),
            created_by TEXT,
            reason TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(school_year, revision)
        );
        CREATE INDEX IF NOT EXISTS idx_stage_rule_sets_school_year
            ON stage_rule_sets(school_year);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_rule_sets_one_active
            ON stage_rule_sets(school_year) WHERE status = 'active';

        CREATE TABLE IF NOT EXISTS subject_coefficients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_set_id INTEGER NOT NULL REFERENCES stage_rule_sets(id),
            cycle_code TEXT NOT NULL,
            level_code TEXT NOT NULL,
            stream_code TEXT NOT NULL,
            subject_code TEXT NOT NULL,
            coefficient INTEGER NOT NULL CHECK(coefficient BETWEEN 1 AND 20),
            source TEXT NOT NULL CHECK(source IN ('official','custom')),
            updated_by TEXT,
            reason TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(rule_set_id, cycle_code, level_code, stream_code, subject_code, source)
        );
        CREATE INDEX IF NOT EXISTS idx_subject_coefficients_rule_set
            ON subject_coefficients(rule_set_id);

        CREATE TABLE IF NOT EXISTS exam_count_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_set_id INTEGER NOT NULL REFERENCES stage_rule_sets(id),
            cycle_code TEXT NOT NULL,
            level_code TEXT NOT NULL,
            subject_code TEXT NOT NULL,
            exam_count INTEGER NOT NULL CHECK(exam_count BETWEEN 1 AND 12),
            source TEXT NOT NULL CHECK(source IN ('official','custom')),
            updated_by TEXT,
            reason TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(rule_set_id, cycle_code, level_code, subject_code, source)
        );
        CREATE INDEX IF NOT EXISTS idx_exam_count_rules_rule_set
            ON exam_count_rules(rule_set_id);

        CREATE TABLE IF NOT EXISTS subject_weight_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_set_id INTEGER NOT NULL REFERENCES stage_rule_sets(id),
            cycle_code TEXT NOT NULL,
            subject_code TEXT NOT NULL,
            exam_weight_bps INTEGER NOT NULL CHECK(exam_weight_bps BETWEEN 0 AND 10000),
            activity_weight_bps INTEGER NOT NULL CHECK(activity_weight_bps BETWEEN 0 AND 10000),
            source TEXT NOT NULL CHECK(source IN ('official','custom')),
            updated_by TEXT,
            reason TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            CHECK(exam_weight_bps + activity_weight_bps = 10000),
            UNIQUE(rule_set_id, cycle_code, subject_code, source)
        );
        CREATE INDEX IF NOT EXISTS idx_subject_weight_rules_rule_set
            ON subject_weight_rules(rule_set_id);
    `);
}

// Canonical DDL for stage profiles (S4, docs/plans/2026-08-02-multi-stage-school-architecture.md
// rows 105-115). Called by migration 2026-08-082-cycle-profiles; not wired into createTables().
//
// `cycle_profiles` holds official, immutable stage profiles; the logical key is
// (cycle_code, profile_version). The EFFECTIVE profile for a school year is decided
// exclusively by `cycle_profile_assignments` — CYCLE_CATALOG.seedProfileVersionHint and
// institution_cycles.seed_profile_version_hint are seed/migration hints only.
// `cycle_profile_assignments`: one row per (school_year, cycle_code); rule_set_id
// MUST be non-null when the profile uses coefficients (and must point at the
// active stage_rule_sets of the same school year) and MUST be NULL for
// continuous-assessment profiles. The composite FK (cycle_code, profile_version)
// → cycle_profiles pins every assignment to a real, immutable official profile;
// the cross-table year check is enforced in the repo transaction and re-checked
// in sync apply (three-layer consistency, plan row 113).
function ensureCycleProfilesSchema(existingDb) {
    const db = existingDb || getDb();
    db.exec(`
        CREATE TABLE IF NOT EXISTS cycle_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cycle_code TEXT NOT NULL,
            profile_version TEXT NOT NULL,
            uses_coefficients INTEGER NOT NULL DEFAULT 1 CHECK(uses_coefficients IN (0, 1)),
            assessment_model TEXT NOT NULL DEFAULT 'exams' CHECK(assessment_model IN ('exams','continuous','exams_activities')),
            is_official INTEGER NOT NULL DEFAULT 1 CHECK(is_official IN (0, 1)),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(cycle_code, profile_version)
        );

        CREATE TABLE IF NOT EXISTS cycle_profile_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_year TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            profile_version TEXT NOT NULL,
            rule_set_id INTEGER REFERENCES stage_rule_sets(id),
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(school_year, cycle_code),
            FOREIGN KEY(cycle_code, profile_version)
                REFERENCES cycle_profiles(cycle_code, profile_version)
        );
        CREATE INDEX IF NOT EXISTS idx_cycle_profile_assignments_school_year
            ON cycle_profile_assignments(school_year);
    `);
}

function ensureColumn(table, column, definition) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table) || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
        throw new Error(`ensureColumn: invalid identifier — table="${table}", column="${column}"`);
    }
    const db = getDb();
    const columns = db.pragma(`table_info(${table})`);
    const exists = columns.some((col) => col.name === column);
    if (!exists) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

module.exports = {
    createTables,
    ensureColumn,
    ensureTeacherSourceColumns,
    ensureTeacherTeachingAssignmentsSchema,
    ensureInstitutionSchema,
    ensureInstitutionCyclesSchema,
    ensureCycleReferenceSchema,
    ensureStageRulesSchema,
    ensureCycleProfilesSchema,
    ensureLicensingSchema,
    ensureNotificationsSchema,
    ensureOwnerSyncSchema,
    ensureSchoolIdentitySchema,
    ensureSyncSchema,
    ensurePageVisibilitySchema,
    listTableColumns
};
