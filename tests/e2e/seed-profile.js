/**
 * Seed a local institution + admin into an Electron userData DB.
 *
 * Runs under Electron so better-sqlite3 matches the app ABI:
 *   electron tests/e2e/seed-profile.js --user-data-dir=<path>
 *
 * Env (optional): E2E_SEED_JSON — JSON overrides for email/password/etc.
 */
'use strict';

const path = require('path');
const { app } = require('electron');

const DEFAULT_SEED = {
    email: 'e2e@local.test',
    password: 'E2eTest123!',
    name: 'E2E Admin',
    role: 'admin',
    institutionName: 'ثانوية اختبار E2E',
    massarCode: 'E2E001',
    schoolId: 'E2E001'
};

function parseArgs(argv) {
    let userDataDir = null;
    for (const arg of argv) {
        if (arg.startsWith('--user-data-dir=')) {
            userDataDir = arg.slice('--user-data-dir='.length);
        }
    }
    return { userDataDir };
}

function loadSeed() {
    if (process.env.E2E_SEED_JSON) {
        try {
            return { ...DEFAULT_SEED, ...JSON.parse(process.env.E2E_SEED_JSON) };
        } catch (err) {
            console.warn('[e2e-seed] Invalid E2E_SEED_JSON, using defaults:', err.message);
        }
    }
    return { ...DEFAULT_SEED };
}

function tableCols(db, table) {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
}

function seedDatabase(db, seedPayload) {
    const instCols = tableCols(db, 'institution_config');
    const massarCode = String(seedPayload.massarCode || 'E2E001')
        .trim()
        .toUpperCase();
    const institutionName = String(seedPayload.institutionName || 'E2E School').trim();
    const schoolId = String(seedPayload.schoolId || massarCode).trim();

    const instSets = {
        setup_completed: 1,
        setup_mode: 'e2e-seed',
        institution_name: institutionName,
        updated_at: new Date().toISOString()
    };
    if (instCols.has('code_etablissement')) instSets.code_etablissement = schoolId;
    if (instCols.has('massar_code')) instSets.massar_code = massarCode;
    if (instCols.has('onboarding_version')) instSets.onboarding_version = 1;
    if (instCols.has('onboarding_completed_at')) {
        instSets.onboarding_completed_at = new Date().toISOString();
    }

    const existingInst = db.prepare('SELECT id FROM institution_config WHERE id = 1').get();
    if (existingInst) {
        const assignments = Object.keys(instSets)
            .map((k) => `${k} = ?`)
            .join(', ');
        db.prepare(`UPDATE institution_config SET ${assignments} WHERE id = 1`).run(...Object.values(instSets));
    } else {
        const cols = ['id', ...Object.keys(instSets)];
        const placeholders = cols.map(() => '?').join(', ');
        db.prepare(`INSERT INTO institution_config (${cols.join(', ')}) VALUES (${placeholders})`).run(
            1,
            ...Object.values(instSets)
        );
    }

    try {
        const syncCols = tableCols(db, 'sync_config');
        if (syncCols.has('school_id')) {
            const syncRow = db.prepare('SELECT id FROM sync_config WHERE id = 1').get();
            if (syncRow) {
                db.prepare(`UPDATE sync_config SET school_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(
                    schoolId
                );
            }
        }
    } catch (err) {
        console.warn('[e2e-seed] sync_config update skipped:', err.message);
    }

    const { hashPassword } = require('../../main/auth/password');
    const email = String(seedPayload.email || '')
        .trim()
        .toLowerCase();
    const name = String(seedPayload.name || 'E2E Admin').trim();
    const role = String(seedPayload.role || 'admin')
        .trim()
        .toLowerCase();
    const passwordHash = hashPassword(String(seedPayload.password || ''));
    const userCols = tableCols(db, 'users');
    const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);

    if (existingUser) {
        const updates = ['name = ?', 'role = ?', 'password_hash = ?', 'disabled = 0'];
        const params = [name, role, passwordHash];
        if (userCols.has('must_change_password')) updates.push('must_change_password = 0');
        if (userCols.has('auth_source')) updates.push("auth_source = 'local'");
        if (userCols.has('invite_status')) updates.push("invite_status = 'active'");
        params.push(existingUser.id);
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    } else {
        const cols = ['name', 'email', 'role', 'password_hash', 'disabled'];
        const vals = [name, email, role, passwordHash, 0];
        if (userCols.has('must_change_password')) {
            cols.push('must_change_password');
            vals.push(0);
        }
        if (userCols.has('auth_source')) {
            cols.push('auth_source');
            vals.push('local');
        }
        if (userCols.has('invite_status')) {
            cols.push('invite_status');
            vals.push('active');
        }
        const placeholders = cols.map(() => '?').join(', ');
        db.prepare(`INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
    }

    const user = db
        .prepare(
            'SELECT id, name, email, role, auth_source, must_change_password, disabled FROM users WHERE lower(email) = lower(?)'
        )
        .get(email);
    const institution = db
        .prepare('SELECT setup_completed, institution_name FROM institution_config WHERE id = 1')
        .get();

    return {
        ok: true,
        email,
        userId: user?.id || null,
        role: user?.role || null,
        authSource: user?.auth_source || null,
        setupCompleted: Number(institution?.setup_completed || 0) === 1,
        institutionName: institution?.institution_name || null,
        dbPath: require('../../main/db/context').getDbPath()
    };
}

const { userDataDir } = parseArgs(process.argv.slice(2));
if (!userDataDir) {
    console.error('[e2e-seed] Missing --user-data-dir=<path>');
    process.exit(2);
}

// Match packaged app name so paths stay consistent if anything else reads app.getName().
app.setName('gestion-scolaire');
app.setPath('userData', path.resolve(userDataDir));

// Avoid fighting a running main-app instance on the same profile when possible.
// Seed is a one-shot process; quit immediately after work.
app.whenReady()
    .then(() => {
        const seed = loadSeed();
        const { initDatabase } = require('../../main/db/init');
        initDatabase();
        const { getDb } = require('../../main/db/context');
        const result = seedDatabase(getDb(), seed);
        console.log('[e2e-seed] OK', JSON.stringify(result));
    })
    .catch((err) => {
        console.error('[e2e-seed] FAIL', err && err.stack ? err.stack : err);
        process.exitCode = 1;
    })
    .finally(() => {
        try {
            const { getDb } = require('../../main/db/context');
            getDb()?.close?.();
        } catch (_) {
            /* ignore */
        }
        app.quit();
    });
