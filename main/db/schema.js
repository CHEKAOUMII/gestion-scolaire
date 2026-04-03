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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);

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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);

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
        pin_hash TEXT,
        pin_failed_attempts INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        must_change_password INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);

    // Backward-compatibility for existing databases created before password auth
    ensureColumn('users', 'password_hash', 'TEXT');
    ensureColumn('users', 'must_change_password', 'INTEGER DEFAULT 0');

    ensureLicensingSchema(db);
    ensureOwnerSyncSchema(db);
    ensureSyncSchema(db);
    ensurePageVisibilitySchema(db);
    ensureInstitutionSchema(db);

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

        console.log('[SETUP] Initial admin password: ' + adminPassword);
        console.log('[SETUP] You will be required to change this password on first login.');
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
        console.log('[SETUP] Admin password was missing — reset to: ' + resetPassword);
    }

    // ── Performance indexes ──
    // Almost every query filters by school_year; many JOIN on student_code.
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
        CREATE INDEX IF NOT EXISTS idx_staff_attendance_year ON staff_attendance(school_year);
        CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance(attendance_date, school_year);
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
            enabled                 INTEGER  DEFAULT 0,
            sync_interval_minutes   INTEGER  DEFAULT 10,
            device_hash             TEXT,
            device_name             TEXT,
            school_id_hash          TEXT,
            retention_days          INTEGER  DEFAULT 7,
            last_capture_error      TEXT,
            updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sync_pull_state (
            table_name      TEXT PRIMARY KEY,
            last_pulled_at  TEXT,
            last_pull_error TEXT,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    db.prepare(
        `
        INSERT OR IGNORE INTO sync_config(id, enabled, sync_interval_minutes, retention_days)
        VALUES(1, 0, 10, 7)
    `
    ).run();
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
    let hiddenPages = new Set(['student-profile-prototype.html', 'communication-center-prototype.html']);
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
        db.prepare("INSERT INTO app_meta(key, value) VALUES('page_visibility_defaults_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .run(String(configVersion));
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
            massar_code       TEXT,
            institution_name  TEXT,
            setup_completed   INTEGER DEFAULT 0,
            setup_mode        TEXT,
            setup_device_hash TEXT,
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
}

function ensureColumn(table, column, definition) {
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
    ensureInstitutionSchema,
    ensureLicensingSchema,
    ensureOwnerSyncSchema,
    ensureSyncSchema,
    ensurePageVisibilitySchema
};
