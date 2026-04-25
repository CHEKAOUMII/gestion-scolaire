'use strict';

const { getApps, initializeApp } = require('firebase/app');
const {
    EmailAuthProvider,
    getAuth,
    reauthenticateWithCredential,
    signInWithEmailAndPassword,
    signOut,
    updatePassword
} = require('firebase/auth');
const { doc, getDoc, getFirestore, updateDoc } = require('firebase/firestore');
const dbContext = require('../db/context');
const { hashPassword, verifyPassword } = require('./password');
const { resolveRole } = require('./permissions');

const APP_NAME = 'pencil-user-auth';

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function getTableColumns(db, tableName) {
    try {
        return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
    } catch {
        return new Set();
    }
}

function readConfigValue(row, column, envName) {
    return String(row?.[column] || process.env[envName] || '').trim();
}

function readFirebaseConfig(db) {
    let syncConfig = {};
    try {
        syncConfig = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    } catch {
        syncConfig = {};
    }

    return {
        apiKey: readConfigValue(syncConfig, 'firebase_api_key', 'FIREBASE_API_KEY'),
        authDomain: readConfigValue(syncConfig, 'firebase_auth_domain', 'FIREBASE_AUTH_DOMAIN'),
        projectId: readConfigValue(syncConfig, 'firebase_project_id', 'FIREBASE_PROJECT_ID'),
        storageBucket: readConfigValue(syncConfig, 'firebase_storage_bucket', 'FIREBASE_STORAGE_BUCKET'),
        messagingSenderId: readConfigValue(syncConfig, 'firebase_messaging_sender_id', 'FIREBASE_MESSAGING_SENDER_ID'),
        appId: readConfigValue(syncConfig, 'firebase_app_id', 'FIREBASE_APP_ID')
    };
}

function readSchoolId(db) {
    try {
        const syncRow = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
        const fromSync = String(syncRow.school_id || '').trim();
        if (fromSync) return fromSync;
    } catch {
        // Continue to institution_config fallback.
    }

    try {
        const instRow = db.prepare('SELECT massar_code FROM institution_config WHERE id = 1').get() || {};
        return String(instRow.massar_code || '').trim();
    } catch {
        return '';
    }
}

function getFirebaseClients() {
    const db = dbContext.getDb();
    const config = readFirebaseConfig(db);
    if (!config.apiKey || !config.projectId) {
        const err = new Error('Firebase Auth is not configured');
        err.code = 'FIREBASE_NOT_CONFIGURED';
        throw err;
    }

    const app = getApps().find((candidate) => candidate.name === APP_NAME) || initializeApp(config, APP_NAME);
    return {
        app,
        auth: getAuth(app),
        firestore: getFirestore(app),
        schoolId: readSchoolId(db)
    };
}

function isFirebaseUnavailable(err) {
    const code = String(err?.code || '');
    return (
        code === 'auth/network-request-failed' ||
        code === 'unavailable' ||
        code.includes('network') ||
        code.includes('unavailable') ||
        /network|offline|unavailable|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(String(err?.message || ''))
    );
}

function isInvalidFirebaseCredential(err) {
    const code = String(err?.code || '');
    return (
        code === 'auth/invalid-credential' ||
        code === 'auth/invalid-login-credentials' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-email' ||
        code === 'auth/user-disabled'
    );
}

function normalizeProfile(snapshotData, firebaseUser, localUser) {
    const profile = snapshotData && typeof snapshotData === 'object' ? snapshotData : {};
    const email = normalizeEmail(profile.email || firebaseUser?.email || localUser?.email);
    return {
        uid: String(profile.uid || firebaseUser?.uid || localUser?.firebase_uid || ''),
        name: String(profile.name || profile.displayName || firebaseUser?.displayName || localUser?.name || email).trim(),
        email,
        role: resolveRole(String(profile.role || localUser?.role || 'principal').trim().toLowerCase()),
        status: String(profile.status || (localUser?.disabled ? 'disabled' : 'active')).trim().toLowerCase(),
        mustChangePassword: !!(profile.mustChangePassword ?? profile.must_change_password ?? localUser?.must_change_password),
        emailVerified: firebaseUser?.emailVerified ? 1 : 0
    };
}

function selectUserByEmail(db, email) {
    return (
        db
            .prepare(
                `
                SELECT *
                FROM users
                WHERE lower(email) = ?
                LIMIT 1
            `
            )
            .get(normalizeEmail(email)) || null
    );
}

function selectUserByFirebaseUid(db, uid) {
    const columns = getTableColumns(db, 'users');
    if (!columns.has('firebase_uid') || !uid) return null;
    return db.prepare('SELECT * FROM users WHERE firebase_uid = ? LIMIT 1').get(uid) || null;
}

function upsertLocalUserFromProfile(db, profile, password, mode) {
    const columns = getTableColumns(db, 'users');
    const existing = selectUserByFirebaseUid(db, profile.uid) || selectUserByEmail(db, profile.email);
    const passwordHash = password ? hashPassword(password) : existing?.password_hash || null;
    const disabled = profile.status === 'disabled' ? 1 : 0;
    const values = {
        name: profile.name,
        email: profile.email || null,
        role: profile.role,
        password_hash: passwordHash,
        disabled,
        must_change_password: profile.mustChangePassword ? 1 : 0,
        firebase_uid: profile.uid || null,
        auth_source: 'firebase',
        email_verified: profile.emailVerified ? 1 : 0,
        invite_status: profile.status || 'active',
        last_login_at: new Date().toISOString(),
        last_auth_mode: mode
    };

    if (existing) {
        const assignments = [];
        const params = [];
        for (const [column, value] of Object.entries(values)) {
            if (!columns.has(column)) continue;
            assignments.push(`${column} = ?`);
            params.push(value);
        }
        if (assignments.length) {
            params.push(existing.id);
            db.prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
        }
        return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
    }

    const insertColumns = [];
    const insertParams = [];
    for (const [column, value] of Object.entries(values)) {
        if (!columns.has(column)) continue;
        insertColumns.push(column);
        insertParams.push(value);
    }

    const placeholders = insertColumns.map(() => '?').join(', ');
    const result = db
        .prepare(`INSERT INTO users(${insertColumns.join(', ')}) VALUES(${placeholders})`)
        .run(...insertParams);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
}

async function loadProfileForUser(firestore, schoolId, firebaseUser, localUser) {
    if (!schoolId || !firebaseUser?.uid) {
        return normalizeProfile(null, firebaseUser, localUser);
    }

    const snapshot = await getDoc(doc(firestore, 'schools', schoolId, 'users', firebaseUser.uid));
    return normalizeProfile(snapshot.exists() ? snapshot.data() : null, firebaseUser, localUser);
}

function assertActiveProfile(profile) {
    if (profile.status === 'disabled') {
        const err = new Error('User is disabled');
        err.code = 'auth/user-disabled';
        throw err;
    }
}

async function loginWithFirebase(email, password) {
    const db = dbContext.getDb();
    const { auth, firestore, schoolId } = getFirebaseClients();
    const credential = await signInWithEmailAndPassword(auth, normalizeEmail(email), password);
    const localUser = selectUserByFirebaseUid(db, credential.user.uid) || selectUserByEmail(db, email);
    const profile = await loadProfileForUser(firestore, schoolId, credential.user, localUser);
    assertActiveProfile(profile);
    const userRow = upsertLocalUserFromProfile(db, profile, password, 'online');
    return { mode: 'online', userRow, profile, firebaseUser: credential.user };
}

function loginWithLocalFallback(email, password) {
    const db = dbContext.getDb();
    const user = selectUserByEmail(db, email);
    if (!user || Number(user.disabled || 0) === 1) {
        return null;
    }
    const hasPriorFirebaseLogin =
        String(user.firebase_uid || '').trim() ||
        String(user.auth_source || '').trim().toLowerCase() === 'firebase' ||
        String(user.last_auth_mode || '').trim().toLowerCase() === 'online';
    if (!hasPriorFirebaseLogin) {
        return null;
    }
    const storedHash = String(user.password_hash || '').trim();
    if (!storedHash || !verifyPassword(password, storedHash)) {
        return null;
    }

    const columns = getTableColumns(db, 'users');
    const updates = [];
    const params = [];
    if (columns.has('last_login_at')) {
        updates.push('last_login_at = ?');
        params.push(new Date().toISOString());
    }
    if (columns.has('last_auth_mode')) {
        updates.push('last_auth_mode = ?');
        params.push('offline');
    }
    if (updates.length) {
        params.push(user.id);
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    return {
        mode: 'offline',
        userRow: db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    };
}

async function loginFirebaseFirst(email, password) {
    try {
        return await loginWithFirebase(email, password);
    } catch (err) {
        if (isInvalidFirebaseCredential(err)) {
            err.publicCode = 'INVALID_CREDENTIALS';
            throw err;
        }
        if (!isFirebaseUnavailable(err)) {
            throw err;
        }

        const fallback = loginWithLocalFallback(email, password);
        if (fallback) {
            fallback.warning = err.code || err.message;
            return fallback;
        }

        err.publicCode = 'OFFLINE_LOGIN_UNAVAILABLE';
        throw err;
    }
}

async function getCurrentFirebaseIdToken(forceRefresh = true) {
    const { auth } = getFirebaseClients();
    if (!auth.currentUser) {
        const err = new Error('No Firebase user is signed in');
        err.code = 'FIREBASE_SESSION_REQUIRED';
        throw err;
    }
    return auth.currentUser.getIdToken(forceRefresh);
}

async function logoutFirebaseUser() {
    try {
        const { auth } = getFirebaseClients();
        await signOut(auth);
    } catch (err) {
        if (!isFirebaseUnavailable(err)) {
            throw err;
        }
    }
}

async function changeFirebasePassword(session, currentPassword, newPassword) {
    const db = dbContext.getDb();
    const localUser = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(session.userId);
    if (!localUser) {
        const err = new Error('User not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
    }

    const { auth, firestore, schoolId } = getFirebaseClients();
    if (!auth.currentUser || normalizeEmail(auth.currentUser.email) !== normalizeEmail(localUser.email)) {
        await signInWithEmailAndPassword(auth, normalizeEmail(localUser.email), currentPassword);
    } else {
        const credential = EmailAuthProvider.credential(normalizeEmail(localUser.email), currentPassword);
        await reauthenticateWithCredential(auth.currentUser, credential);
    }

    await updatePassword(auth.currentUser, newPassword);

    const columns = getTableColumns(db, 'users');
    const updates = ['password_hash = ?', 'must_change_password = 0'];
    const params = [hashPassword(newPassword)];
    if (columns.has('last_auth_mode')) {
        updates.push('last_auth_mode = ?');
        params.push('online');
    }
    params.push(session.userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    if (schoolId && auth.currentUser?.uid) {
        try {
            await updateDoc(doc(firestore, 'schools', schoolId, 'users', auth.currentUser.uid), {
                mustChangePassword: false,
                updatedAt: new Date().toISOString()
            });
        } catch (err) {
            console.warn('[auth] Failed to update Firebase profile password flag:', err.message);
        }
    }
}

module.exports = {
    changeFirebasePassword,
    isFirebaseUnavailable,
    getCurrentFirebaseIdToken,
    loginFirebaseFirst,
    loginWithLocalFallback,
    logoutFirebaseUser,
    normalizeEmail
};
