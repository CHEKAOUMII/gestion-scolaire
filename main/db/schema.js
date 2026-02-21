const { getDb } = require('./context');
const { generateRandomPassword, hashPassword } = require('../auth/password');

// Create tables
function createTables() {
    const db = getDb();

    db.exec(`
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE,
            full_name TEXT NOT NULL,
            family_name TEXT,
            birth_date TEXT,
            gender TEXT,
            section TEXT,
            school_year TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS grades(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        student_code TEXT,
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
        full_name TEXT NOT NULL,
        subject TEXT,
        phone TEXT,
        email TEXT,
        school_year TEXT,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    // Set default school year
    db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES('currentSchoolYear', '2025/2026')`).run();
    const adminPassword = generateRandomPassword();
    db.prepare(
        `
            INSERT OR IGNORE INTO users(id, name, email, role, password_hash, disabled, must_change_password)
            VALUES(1, 'Admin', 'admin@school.local', 'admin', ?, 0, 1)
        `
    ).run(hashPassword(adminPassword));

    db.prepare(
        `
            UPDATE users
            SET password_hash = ?, must_change_password = 1
            WHERE lower(email) = 'admin@school.local'
              AND (password_hash IS NULL OR trim(password_hash) = '')
        `
    ).run(hashPassword(generateRandomPassword()));

    // Log the initial admin password to console on first-ever database creation
    const adminRow = db.prepare('SELECT id FROM users WHERE id = 1').get();
    if (adminRow) {
        console.log('[SETUP] Initial admin password: ' + adminPassword);
        console.log('[SETUP] You will be required to change this password on first login.');
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
        CREATE INDEX IF NOT EXISTS idx_correspondence_year  ON correspondence(school_year);
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

function ensureColumn(table, column, definition) {
    const db = getDb();
    const columns = db.pragma(`table_info(${table})`);
    const exists = columns.some((col) => col.name === column);
    if (!exists) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

module.exports = { createTables, ensureColumn, ensureLicensingSchema, ensureOwnerSyncSchema };
