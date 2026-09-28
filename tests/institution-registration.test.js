'use strict';

/**
 * Unit and contract tests for Institution Registration and Setup (institution:setup-new,
 * applyBootstrap, getStatusRecord, validation, and offline / online behaviors).
 */

const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const { setDb } = require('../main/db/context');
const { createTables } = require('../main/db/schema');
const { hashPassword, verifyPassword } = require('../main/auth/password');
const institutionRepo = require('../main/repos/institution');
const { registerInstitutionIpc } = require('../main/ipc/institution');

process.env.GESTION_LICENSE_SECRET = 'test-secret-32-bytes-minimum-length-key-12345';

console.log('[test] institution registration and setup suite');

function createTestDb() {
    const db = new DatabaseSync(':memory:');
    db.pragma = (statement) => db.prepare('PRAGMA ' + statement).all();
    db.transaction =
        (fn) =>
        (...args) => {
            db.exec('BEGIN');
            try {
                const r = fn(...args);
                db.exec('COMMIT');
                return r;
            } catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
        };
    setDb(db);
    createTables(db);
    return db;
}

// 1. Initial fresh database state
{
    const db = createTestDb();
    const status = institutionRepo.getStatusRecord(db);
    assert.strictEqual(status.setupCompleted, false, 'Fresh install must not have setup completed');
    assert.strictEqual(status.institutionName, null);
    assert.strictEqual(status.massarCode, null);
    console.log('  [ok] fresh install reports setupCompleted = false');
}

// 2. applyBootstrap stores school identity, admin user, and sync config correctly
{
    const db = createTestDb();
    const password = 'AdminPassword123!';
    const passwordHash = hashPassword(password);

    institutionRepo.applyBootstrap(db, {
        bootstrap: {
            schoolId: 'SCH_MARRAKECH_001',
            massarCode: null,
            institutionName: 'ثانوية ابن رشد التأهيلية',
            syncConfig: {
                schoolId: 'SCH_MARRAKECH_001',
                firebaseFunctionsUrl: 'https://custom-functions.cloudfunctions.net',
                firebaseProjectId: 'project-ibnrushd'
            },
            user: {
                uid: 'firebase_principal_uid_777',
                name: 'ذ. عبد الرحيم الإدريسي',
                email: 'principal@ibnrushd.ma',
                role: 'principal'
            }
        },
        passwordHash,
        deviceHash: 'device_fingerprint_test_hash',
        academy: 'أكاديمية مراكش آسفي',
        directorate: 'المديرية الإقليمية مراكش'
    });

    // Verify institution status
    const status = institutionRepo.getStatusRecord(db);
    assert.strictEqual(status.setupCompleted, true, 'setupCompleted must be true after bootstrap');
    assert.strictEqual(status.institutionName, 'ثانوية ابن رشد التأهيلية');

    // Verify user was created with principal role and valid password hash
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('principal@ibnrushd.ma');
    assert.ok(user, 'Principal user must exist');
    assert.strictEqual(user.name, 'ذ. عبد الرحيم الإدريسي');
    assert.strictEqual(user.role, 'principal');
    assert.strictEqual(user.firebase_uid, 'firebase_principal_uid_777');
    assert.strictEqual(verifyPassword(password, user.password_hash), true, 'Password must verify');

    // Verify sync config was populated
    const sync = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
    assert.strictEqual(sync.school_id, 'SCH_MARRAKECH_001');
    assert.strictEqual(sync.firebase_project_id, 'project-ibnrushd');
    assert.strictEqual(sync.firebase_functions_url, 'https://custom-functions.cloudfunctions.net');
    assert.strictEqual(sync.enabled, 1);

    // Verify academy and directorate in school_identity
    const academy = db.prepare('SELECT value FROM school_identity WHERE key = ?').get('academy');
    const directorate = db.prepare('SELECT value FROM school_identity WHERE key = ?').get('directorate');
    assert.strictEqual(academy?.value, 'أكاديمية مراكش آسفي');
    assert.strictEqual(directorate?.value, 'المديرية الإقليمية مراكش');

    console.log('  [ok] applyBootstrap records school metadata, principal account, and sync config');
}

// 3. IPC validation rules for institution:setup-new
{
    const db = createTestDb();
    const handlers = new Map();
    registerInstitutionIpc({ handle: (channel, handler) => handlers.set(channel, handler) });

    const setupNew = (payload) => handlers.get('institution:setup-new')(db, payload);

    // Missing institution name
    setupNew({ adminName: 'Admin', adminEmail: 'a@b.com', adminPassword: 'password123' })
        .then((res) => {
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.code, 'INVALID_INSTITUTION_NAME');
            console.log('  [ok] IPC rejects empty institution name');

            // Missing admin name
            return setupNew({ institutionName: 'School', adminEmail: 'a@b.com', adminPassword: 'password123' });
        })
        .then((res) => {
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.code, 'INVALID_ADMIN_NAME');
            console.log('  [ok] IPC rejects empty admin name');

            // Invalid admin email
            return setupNew({
                institutionName: 'School',
                adminName: 'Admin',
                adminEmail: 'not-an-email',
                adminPassword: 'password123'
            });
        })
        .then((res) => {
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.code, 'INVALID_EMAIL');
            console.log('  [ok] IPC rejects invalid admin email');

            // Password too short
            return setupNew({
                institutionName: 'School',
                adminName: 'Admin',
                adminEmail: 'a@b.com',
                adminPassword: '123'
            });
        })
        .then((res) => {
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.code, 'INVALID_PASSWORD');
            console.log('  [ok] IPC rejects password under 6 chars');

            // Guard against already configured institution
            institutionRepo.applyBootstrap(db, {
                bootstrap: {
                    schoolId: 'EXISTING_001',
                    institutionName: 'Existing School',
                    syncConfig: { schoolId: 'EXISTING_001' },
                    user: { name: 'Admin', email: 'admin@school.com', role: 'principal' }
                },
                passwordHash: hashPassword('pass123'),
                deviceHash: 'hash'
            });

            return setupNew({
                institutionName: 'Another School',
                adminName: 'Another Admin',
                adminEmail: 'another@school.com',
                adminPassword: 'password123'
            });
        })
        .then((res) => {
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.code, 'ALREADY_CONFIGURED');
            console.log('  [ok] IPC rejects setup-new when institution is already configured');
            console.log('[test] institution registration and setup suite: all tests passed!');
        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
