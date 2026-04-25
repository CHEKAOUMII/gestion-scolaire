'use strict';

/**
 * One-time backfill: provisions existing local-only SQLite users to Firebase Auth + Firestore.
 *
 * Usage:
 *   node scripts/migrate-users-to-firebase.js [--dry-run] [--db=<path>]
 *
 * Required env vars:
 *   FIREBASE_FUNCTIONS_URL   — deployed Cloud Functions base URL
 *   FIREBASE_API_KEY         — Firebase client SDK key
 *   FIREBASE_AUTH_DOMAIN     — e.g. gestionscholaire.firebaseapp.com
 *   FIREBASE_PROJECT_ID      — Firebase project ID
 *   FIREBASE_FUNCTIONS_ADMIN_EMAIL  — admin email to sign in for the migration
 *   FIREBASE_FUNCTIONS_ADMIN_PASS   — admin password
 *
 * Optional env vars:
 *   DB_PATH                  — path to gestion-scolaire.db (defaults to userData path)
 */

const path = require('path');
const fs = require('fs');
const { initializeApp, getApps, deleteApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, signOut } = require('firebase/auth');

const DRY_RUN = process.argv.includes('--dry-run');
const DB_PATH_ARG = (process.argv.find((a) => a.startsWith('--db=')) || '').slice(5);

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function openDb() {
    const dbPath =
        DB_PATH_ARG ||
        process.env.DB_PATH ||
        path.join(
            process.env.APPDATA ||
                (process.platform === 'darwin'
                    ? path.join(require('os').homedir(), 'Library', 'Application Support')
                    : path.join(require('os').homedir(), '.config')),
            'برنامج التدبير المدرسي',
            'gestion-scolaire.db'
        );

    if (!fs.existsSync(dbPath)) {
        console.error(`ERROR: Database not found at: ${dbPath}`);
        console.error('Use --db=<path> to specify the database location.');
        process.exit(1);
    }

    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: false });
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
}

function getTableColumns(db, tableName) {
    try {
        return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((r) => r.name));
    } catch {
        return new Set();
    }
}

function loadLocalUsers(db) {
    const columns = getTableColumns(db, 'users');
    const hasFirebaseUid = columns.has('firebase_uid');
    const hasAuthSource = columns.has('auth_source');
    const hasEmail = columns.has('email');

    if (!hasEmail) {
        console.error('ERROR: users table has no email column — cannot migrate.');
        process.exit(1);
    }

    // Select users that are not yet linked to Firebase
    const whereClause = hasFirebaseUid
        ? `WHERE COALESCE(trim(firebase_uid), '') = '' ${hasAuthSource ? "OR COALESCE(auth_source, 'local') = 'local'" : ''}`
        : '';

    return db.prepare(`SELECT * FROM users ${whereClause} ORDER BY id`).all();
}

function getFunctionsUrl(db) {
    try {
        const row = db.prepare('SELECT firebase_functions_url FROM sync_config WHERE id = 1').get() || {};
        return String(row.firebase_functions_url || process.env.FIREBASE_FUNCTIONS_URL || '')
            .trim()
            .replace(/\/+$/, '');
    } catch {
        return String(process.env.FIREBASE_FUNCTIONS_URL || '').trim().replace(/\/+$/, '');
    }
}

// ---------------------------------------------------------------------------
// Firebase client auth (to get idToken for the Cloud Function calls)
// ---------------------------------------------------------------------------

const APP_NAME = 'migrate-tool';

function buildFirebaseConfig(db) {
    let syncRow = {};
    try {
        syncRow = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    } catch {
        // fall through to env vars
    }

    function val(col, env) {
        return String(syncRow[col] || process.env[env] || '').trim();
    }

    return {
        apiKey: val('firebase_api_key', 'FIREBASE_API_KEY'),
        authDomain: val('firebase_auth_domain', 'FIREBASE_AUTH_DOMAIN'),
        projectId: val('firebase_project_id', 'FIREBASE_PROJECT_ID'),
        storageBucket: val('firebase_storage_bucket', 'FIREBASE_STORAGE_BUCKET'),
        messagingSenderId: val('firebase_messaging_sender_id', 'FIREBASE_MESSAGING_SENDER_ID'),
        appId: val('firebase_app_id', 'FIREBASE_APP_ID'),
    };
}

async function getAdminIdToken(config) {
    const adminEmail = process.env.FIREBASE_FUNCTIONS_ADMIN_EMAIL;
    const adminPass = process.env.FIREBASE_FUNCTIONS_ADMIN_PASS;
    if (!adminEmail || !adminPass) {
        console.error('ERROR: FIREBASE_FUNCTIONS_ADMIN_EMAIL and FIREBASE_FUNCTIONS_ADMIN_PASS are required.');
        process.exit(1);
    }

    const existing = getApps().find((a) => a.name === APP_NAME);
    const app = existing || initializeApp(config, APP_NAME);
    const auth = getAuth(app);
    const credential = await signInWithEmailAndPassword(auth, adminEmail, adminPass);
    return credential.user.getIdToken(true);
}

async function cleanupFirebaseApp() {
    const app = getApps().find((a) => a.name === APP_NAME);
    if (!app) return;
    try {
        await signOut(getAuth(app));
    } catch {
        // best-effort
    }
    await deleteApp(app);
}

// ---------------------------------------------------------------------------
// Provision a single user via Cloud Function
// ---------------------------------------------------------------------------

async function provisionUser(functionsUrl, idToken, user) {
    const email = String(user.email || '').trim().toLowerCase();
    const name = String(user.name || email).trim();
    const role = String(user.role || 'principal').trim();
    const mustChangePassword = Number(user.must_change_password || 0) === 1;

    const response = await fetch(`${functionsUrl}/provisionSchoolUser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, email, name, role, mustChangePassword, createInvite: false }),
    });

    const text = await response.text();
    let data = {};
    try {
        data = JSON.parse(text);
    } catch {
        data = { message: text };
    }

    if (!response.ok || data.success === false) {
        const err = new Error(data.message || data.error || `provisionSchoolUser failed (HTTP ${response.status})`);
        err.code = data.code || data.error || 'PROVISION_FAILED';
        err.httpStatus = response.status;
        throw err;
    }

    return data;
}

// ---------------------------------------------------------------------------
// Save the firebase_uid back into the local users row
// ---------------------------------------------------------------------------

function saveFirebaseUid(db, userId, firebaseUid, columns) {
    const updates = [];
    const params = [];

    if (columns.has('firebase_uid')) {
        updates.push('firebase_uid = ?');
        params.push(firebaseUid);
    }
    if (columns.has('auth_source')) {
        updates.push("auth_source = 'firebase'");
    }
    if (columns.has('email_verified')) {
        updates.push('email_verified = 0');
    }
    if (columns.has('invite_status')) {
        updates.push("invite_status = 'active'");
    }

    if (!updates.length) return;
    params.push(userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function findDuplicateEmails(users) {
    const seen = new Map();
    const duplicates = new Set();
    for (const u of users) {
        const email = String(u.email || '').trim().toLowerCase();
        if (!email) continue;
        if (seen.has(email)) {
            duplicates.add(email);
        } else {
            seen.set(email, u.id);
        }
    }
    return duplicates;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
    console.log('=== Firebase User Backfill Migration ===');
    if (DRY_RUN) console.log('[DRY RUN] No changes will be made.\n');

    const db = openDb();
    const columns = getTableColumns(db, 'users');
    const users = loadLocalUsers(db);

    console.log(`Found ${users.length} local-only user(s) to migrate.\n`);

    if (!users.length) {
        console.log('Nothing to do. All users are already linked to Firebase.');
        db.close();
        return;
    }

    const functionsUrl = getFunctionsUrl(db);
    if (!functionsUrl) {
        console.error('ERROR: FIREBASE_FUNCTIONS_URL is not configured.');
        console.error('Set it in .env or in the sync_config table.');
        db.close();
        process.exit(1);
    }

    const firebaseConfig = buildFirebaseConfig(db);
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
        console.error('ERROR: Firebase client config (FIREBASE_API_KEY, FIREBASE_PROJECT_ID) is missing.');
        db.close();
        process.exit(1);
    }

    // Pre-flight validation report
    const duplicates = findDuplicateEmails(users);
    const report = { provisioned: [], skipped: [], failed: [] };

    for (const user of users) {
        const email = String(user.email || '').trim().toLowerCase();
        const label = `[id=${user.id} name="${user.name}" email="${email}"]`;

        if (!email || !validateEmail(email)) {
            console.warn(`  SKIP ${label} — missing or invalid email`);
            report.skipped.push({ id: user.id, name: user.name, email, reason: 'invalid-email' });
            continue;
        }

        if (duplicates.has(email)) {
            console.warn(`  SKIP ${label} — duplicate email in local DB (manual resolution required)`);
            report.skipped.push({ id: user.id, name: user.name, email, reason: 'duplicate-email' });
            continue;
        }
    }

    const eligibleUsers = users.filter((u) => {
        const email = String(u.email || '').trim().toLowerCase();
        return validateEmail(email) && !duplicates.has(email);
    });

    if (!eligibleUsers.length) {
        console.log('\nNo eligible users to provision after validation. See skipped list above.');
        printSummary(report);
        db.close();
        return;
    }

    if (DRY_RUN) {
        for (const u of eligibleUsers) {
            console.log(`  WOULD PROVISION id=${u.id} email="${u.email}" role="${u.role}"`);
            report.provisioned.push({ id: u.id, name: u.name, email: u.email, uid: '(dry-run)' });
        }
        printSummary(report);
        db.close();
        return;
    }

    // Sign in as admin to obtain idToken for Cloud Function calls
    console.log('\nSigning in as admin to obtain Firebase Auth token...');
    let idToken;
    try {
        idToken = await getAdminIdToken(firebaseConfig);
        console.log('Admin sign-in successful.\n');
    } catch (err) {
        console.error(`ERROR: Admin sign-in failed — ${err.message}`);
        db.close();
        process.exit(1);
    }

    // Provision eligible users one by one
    for (const user of eligibleUsers) {
        const email = String(user.email || '').trim().toLowerCase();
        const label = `[id=${user.id} name="${user.name}" email="${email}"]`;

        try {
            const result = await provisionUser(functionsUrl, idToken, user);
            const uid = String(result.uid || result.profile?.uid || '').trim();

            if (uid) {
                saveFirebaseUid(db, user.id, uid, columns);
                console.log(`  OK ${label} → firebase_uid=${uid}`);
                report.provisioned.push({ id: user.id, name: user.name, email, uid });
            } else {
                console.warn(`  WARN ${label} — provisioned but no uid returned`);
                report.skipped.push({ id: user.id, name: user.name, email, reason: 'no-uid-returned' });
            }
        } catch (err) {
            const isEmailConflict =
                err.code === 'EMAIL_IN_USE_DIFFERENT_SCHOOL' ||
                err.code === 'EMAIL_EXISTS' ||
                err.httpStatus === 409;

            if (isEmailConflict) {
                console.warn(`  SKIP ${label} — email already registered in Firebase (${err.code})`);
                report.skipped.push({ id: user.id, name: user.name, email, reason: 'email-exists-in-firebase' });
            } else {
                console.error(`  FAIL ${label} — ${err.message} (${err.code || ''})`);
                report.failed.push({ id: user.id, name: user.name, email, error: err.message, code: err.code });
            }
        }
    }

    await cleanupFirebaseApp();
    db.close();

    printSummary(report);

    if (report.failed.length > 0) {
        process.exitCode = 1;
    }
}

function printSummary(report) {
    console.log('\n=== Migration Summary ===');
    console.log(`  Provisioned : ${report.provisioned.length}`);
    console.log(`  Skipped     : ${report.skipped.length}`);
    console.log(`  Failed      : ${report.failed.length}`);

    if (report.skipped.length) {
        console.log('\nSkipped (need manual resolution):');
        for (const entry of report.skipped) {
            console.log(`  id=${entry.id} email="${entry.email}" — ${entry.reason}`);
        }
    }

    if (report.failed.length) {
        console.log('\nFailed (retry or investigate):');
        for (const entry of report.failed) {
            console.log(`  id=${entry.id} email="${entry.email}" — ${entry.error} (${entry.code})`);
        }
    }

    console.log('\nDone.');
}

run().catch((err) => {
    console.error('Unexpected error during migration:', err);
    process.exit(1);
});
