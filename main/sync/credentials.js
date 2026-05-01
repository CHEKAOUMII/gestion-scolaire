'use strict';

const { getAuth } = require('firebase/auth');
const { getApps } = require('firebase/app');
const { doc, getDoc } = require('firebase/firestore');
const { getFirestoreDb } = require('../firebase/config');
const { getDb } = require('../db/context');

const USER_AUTH_APP_NAME = 'pencil-user-auth';

let _cachedCredentials = null;
let _refreshPromise = null;

function readSyncConfig(db) {
    return db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
}

function getFunctionsUrl(config) {
    const url = String(config.firebase_functions_url || process.env.FIREBASE_FUNCTIONS_URL || '')
        .trim()
        .replace(/\/+$/, '');
    return url || null;
}

function readSchoolIdFromDb(db) {
    const config = readSyncConfig(db);
    const fromSync = String(config.school_id || '').trim().toUpperCase();
    if (fromSync) return fromSync;

    try {
        const instRow = db.prepare('SELECT massar_code FROM institution_config WHERE id = 1').get() || {};
        return String(instRow.massar_code || '').trim().toUpperCase();
    } catch {
        return '';
    }
}

async function getFirebaseSession() {
    try {
        const app = getApps().find((a) => a.name === USER_AUTH_APP_NAME);
        if (!app) {
            console.log('[sync:credentials] Firebase app not found:', USER_AUTH_APP_NAME);
            return null;
        }

        const auth = getAuth(app);
        if (!auth.currentUser) {
            console.log('[sync:credentials] No currentUser on Firebase auth');
            return null;
        }

        let tokenResult;
        try {
            tokenResult = await auth.currentUser.getIdTokenResult(true);
        } catch (refreshErr) {
            console.warn('[sync:credentials] Forced token refresh failed, trying cached:', refreshErr.message);
            tokenResult = await auth.currentUser.getIdTokenResult(false);
        }

        let schoolId = String(tokenResult?.claims?.schoolId || '').trim().toUpperCase();

        if (!schoolId) {
            const db = getDb();
            schoolId = readSchoolIdFromDb(db);
        }

        if (!schoolId) {
            console.log('[sync:credentials] No schoolId found in claims or DB');
            return null;
        }

        return {
            user: auth.currentUser,
            schoolId,
            expiresAt: Math.floor(new Date(tokenResult.expirationTime).getTime() / 1000)
        };
    } catch (err) {
        console.warn('[sync:credentials] getFirebaseSession failed:', err.message);
        return null;
    }
}

async function refreshCredentials() {
    try {
        const session = await getFirebaseSession();
        if (session) {
            _cachedCredentials = session;
            return _cachedCredentials;
        }

        return null;
    } catch (err) {
        console.warn('[sync:credentials] Credential refresh failed:', err.message);
        return null;
    }
}

async function getCredentials() {
    if (_cachedCredentials && _cachedCredentials.expiresAt - Math.floor(Date.now() / 1000) > 300) {
        return _cachedCredentials;
    }

    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = refreshCredentials();
    try {
        return await _refreshPromise;
    } finally {
        _refreshPromise = null;
    }
}

function clearCredentials() {
    _cachedCredentials = null;
    _refreshPromise = null;
}

function isAuthenticated() {
    return _cachedCredentials !== null && _cachedCredentials.expiresAt - Math.floor(Date.now() / 1000) > 300;
}

async function testConnection() {
    // Try 1: Use existing Firebase login session
    const session = await getFirebaseSession();
    if (session) {
        try {
            const firestoreDb = getFirestoreDb();
            if (!firestoreDb) return { success: false, step: 'firestore', error: 'Firestore not initialized' };
            const schoolRef = doc(firestoreDb, 'schools', session.schoolId);
            await getDoc(schoolRef);
            return { success: true, schoolId: session.schoolId };
        } catch (err) {
            return { success: false, step: 'firestore', error: err.message };
        }
    }

    // Firestore sync is independent from app activation/licensing, but it still
    // needs a Firebase-authenticated school user because rules reject anonymous access.
    const db = getDb();
    const config = readSyncConfig(db);
    const functionsUrl = getFunctionsUrl(config);

    if (!functionsUrl) {
        return { success: false, error: 'لم يتم تحديد رابط Firebase Functions بعد' };
    }
    return { success: false, error: 'لا توجد جلسة Firebase نشطة. سجّل الدخول بحساب المؤسسة السحابي ثم أعد الاختبار.' };
}

module.exports = { getCredentials, clearCredentials, isAuthenticated, testConnection };
