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
const { logAuthDebug } = require('./debug');

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
        const instRow = db.prepare('SELECT code_etablissement FROM institution_config WHERE id = 1').get() || {};
        return String(instRow.code_etablissement || '').trim();
    } catch {
        try {
            const instRow = db.prepare('SELECT massar_code AS code_etablissement FROM institution_config WHERE id = 1').get() || {};
            return String(instRow.code_etablissement || '').trim();
        } catch {
            return '';
        }
    }
}

function normalizeSchoolId(value) {
    return String(value || '').trim().toUpperCase();
}

function persistDiscoveredSchoolId(db, schoolId, source) {
    const normalized = normalizeSchoolId(schoolId);
    if (!normalized) return;

    try {
        const syncColumns = getTableColumns(db, 'sync_config');
        if (syncColumns.has('school_id')) {
            db.prepare(
                `
                INSERT OR IGNORE INTO sync_config(id, enabled, sync_interval_minutes, retention_days)
                VALUES(1, 1, 10, 7)
            `
            ).run();
            const syncAssignments = ['school_id = ?'];
            const syncParams = [normalized];
            if (syncColumns.has('enabled')) syncAssignments.push('enabled = 1');
            if (syncColumns.has('updated_at')) syncAssignments.push('updated_at = CURRENT_TIMESTAMP');
            db.prepare(`UPDATE sync_config SET ${syncAssignments.join(', ')} WHERE id = 1`).run(...syncParams);
        }

        const institutionColumns = getTableColumns(db, 'institution_config');
        if (institutionColumns.has('code_etablissement')) {
            const insertColumns = ['id', 'code_etablissement'];
            const insertValues = [1, normalized];
            if (institutionColumns.has('setup_completed')) {
                insertColumns.push('setup_completed');
                insertValues.push(1);
            }
            if (institutionColumns.has('setup_mode')) {
                insertColumns.push('setup_mode');
                insertValues.push('firebase-login');
            }
            const placeholders = insertColumns.map(() => '?').join(', ');
            db.prepare(`INSERT OR IGNORE INTO institution_config(${insertColumns.join(', ')}) VALUES(${placeholders})`).run(
                ...insertValues
            );

            const institutionAssignments = ['code_etablissement = ?'];
            const institutionParams = [normalized];
            if (institutionColumns.has('setup_completed')) institutionAssignments.push('setup_completed = 1');
            if (institutionColumns.has('setup_mode')) {
                institutionAssignments.push("setup_mode = COALESCE(NULLIF(setup_mode, ''), 'firebase-login')");
            }
            if (institutionColumns.has('updated_at')) institutionAssignments.push('updated_at = CURRENT_TIMESTAMP');
            db.prepare(`UPDATE institution_config SET ${institutionAssignments.join(', ')} WHERE id = 1`).run(
                ...institutionParams
            );
        }

        logAuthDebug('firebase.school-id.persisted', {
            schoolId: normalized,
            source
        });
    } catch (err) {
        logAuthDebug('firebase.school-id.persist-failed', {
            schoolId: normalized,
            source,
            code: err.code || null,
            message: err.message || String(err)
        });
    }
}

function getFirebaseClients() {
    const db = dbContext.getDb();
    const config = readFirebaseConfig(db);
    if (!config.apiKey || !config.projectId) {
        logAuthDebug('firebase.config.missing', {
            hasApiKey: !!config.apiKey,
            hasProjectId: !!config.projectId,
            hasAppId: !!config.appId,
            authDomain: config.authDomain ? '(set)' : '(missing)'
        });
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
        code === 'FIREBASE_NOT_CONFIGURED' ||
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

function createAuthServiceError(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
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
        logAuthDebug('firebase.profile.missing-input', {
            hasSchoolId: !!schoolId,
            hasFirebaseUid: !!firebaseUser?.uid,
            email: firebaseUser?.email || localUser?.email || null
        });
        throw createAuthServiceError('FIREBASE_PROFILE_REQUIRED', 'Firebase school profile is required');
    }

    const snapshot = await getDoc(doc(firestore, 'schools', schoolId, 'users', firebaseUser.uid));
    if (!snapshot.exists()) {
        logAuthDebug('firebase.profile.not-found', {
            schoolId,
            firebaseUid: firebaseUser.uid,
            email: firebaseUser.email || localUser?.email || null
        });
        throw createAuthServiceError('FIREBASE_PROFILE_REQUIRED', 'Firebase school profile is required');
    }
    return normalizeProfile(snapshot.data(), firebaseUser, localUser);
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
    logAuthDebug('firebase.login.start', {
        email,
        schoolId: schoolId || null
    });
    const credential = await signInWithEmailAndPassword(auth, normalizeEmail(email), password);
    const tokenResult = await credential.user.getIdTokenResult(true);
    const claimSchoolId = normalizeSchoolId(tokenResult?.claims?.schoolId);
    const expectedSchoolId = normalizeSchoolId(schoolId);
    if (expectedSchoolId && claimSchoolId && claimSchoolId !== expectedSchoolId) {
        logAuthDebug('firebase.school-mismatch', {
            email,
            firebaseUid: credential.user.uid,
            expectedSchoolId,
            claimSchoolId
        });
        throw createAuthServiceError('FIREBASE_SCHOOL_MISMATCH', 'Firebase user does not belong to this school');
    }
    const resolvedSchoolId = expectedSchoolId || claimSchoolId;
    if (!resolvedSchoolId) {
        logAuthDebug('firebase.school-id.missing', {
            email,
            firebaseUid: credential.user.uid,
            hasLocalSchoolId: !!expectedSchoolId,
            hasClaimSchoolId: !!claimSchoolId
        });
        throw createAuthServiceError('LOCAL_SCHOOL_ID_MISSING', 'Local school id is missing');
    }
    if (!expectedSchoolId && claimSchoolId) {
        persistDiscoveredSchoolId(db, claimSchoolId, 'firebase-claim');
    }
    const localUser = selectUserByFirebaseUid(db, credential.user.uid) || selectUserByEmail(db, email);
    let profile;
    if (claimSchoolId) {
        profile = await loadProfileForUser(firestore, resolvedSchoolId, credential.user, localUser);
    } else if (localUser) {
        logAuthDebug('firebase.profile.local-fallback', {
            email,
            firebaseUid: credential.user.uid,
            localUserId: localUser.id,
            reason: 'no-schoolId-claim'
        });
        profile = normalizeProfile(null, credential.user, localUser);
    } else {
        logAuthDebug('firebase.profile.no-claim-no-local', {
            email,
            firebaseUid: credential.user.uid,
            resolvedSchoolId
        });
        throw createAuthServiceError('FIREBASE_PROFILE_REQUIRED', 'هذا الحساب غير مرتبط بهذه المؤسسة');
    }
    assertActiveProfile(profile);
    const userRow = upsertLocalUserFromProfile(db, profile, password, 'online');
    logAuthDebug('firebase.login.success', {
        email: profile.email,
        firebaseUid: profile.uid,
        schoolId: resolvedSchoolId,
        localUserId: userRow?.id || null,
        role: profile.role
    });
    return { mode: 'online', userRow, profile, firebaseUser: credential.user };
}

function loginWithLocalFallback(email, password, { firebaseNotConfigured } = {}) {
    const db = dbContext.getDb();
    const user = selectUserByEmail(db, email);
    if (!user || Number(user.disabled || 0) === 1) {
        logAuthDebug('offline.fallback.no-local-user', {
            email,
            firebaseNotConfigured: !!firebaseNotConfigured,
            foundUser: !!user,
            disabled: !!user?.disabled
        });
        return null;
    }
    if (!firebaseNotConfigured) {
        const hasPriorFirebaseLogin =
            String(user.firebase_uid || '').trim() ||
            String(user.auth_source || '').trim().toLowerCase() === 'firebase' ||
            String(user.last_auth_mode || '').trim().toLowerCase() === 'online';
        if (!hasPriorFirebaseLogin) {
            logAuthDebug('offline.fallback.no-prior-firebase-login', {
                email,
                localUserId: user.id,
                authSource: user.auth_source || null,
                lastAuthMode: user.last_auth_mode || null,
                hasFirebaseUid: !!String(user.firebase_uid || '').trim()
            });
            return null;
        }
    }
    const storedHash = String(user.password_hash || '').trim();
    if (!storedHash || !verifyPassword(password, storedHash)) {
        logAuthDebug('offline.fallback.invalid-local-password', {
            email,
            localUserId: user.id,
            hasStoredHash: !!storedHash
        });
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

    logAuthDebug('offline.fallback.success', {
        email,
        localUserId: user.id,
        firebaseNotConfigured: !!firebaseNotConfigured
    });
    return {
        mode: 'offline',
        userRow: db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    };
}

async function loginFirebaseFirst(email, password) {
    try {
        return await loginWithFirebase(email, password);
    } catch (err) {
        logAuthDebug('firebase.login.failed', {
            email,
            code: err.code || null,
            publicCode: err.publicCode || null,
            message: err.message || String(err),
            firebaseUnavailable: isFirebaseUnavailable(err),
            invalidCredential: isInvalidFirebaseCredential(err)
        });
        if (isInvalidFirebaseCredential(err)) {
            err.publicCode = 'INVALID_CREDENTIALS';
            throw err;
        }
        if (!isFirebaseUnavailable(err)) {
            throw err;
        }

        const firebaseNotConfigured = err.code === 'FIREBASE_NOT_CONFIGURED';
        const fallback = loginWithLocalFallback(email, password, { firebaseNotConfigured });
        if (fallback) {
            fallback.warning = err.code || err.message;
            return fallback;
        }

        logAuthDebug('offline.fallback.unavailable', {
            email,
            firebaseErrorCode: err.code || null,
            firebaseNotConfigured
        });
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
