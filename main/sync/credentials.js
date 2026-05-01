'use strict';

const crypto = require('crypto');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getApps, initializeApp } = require('firebase/app');
const { doc, getDoc } = require('firebase/firestore');
const { getFirestoreDb } = require('../firebase/config');
const { getDb } = require('../db/context');

const USER_AUTH_APP_NAME = 'pencil-user-auth';
const RESTORATION_COOLDOWN_MS = 5 * 60 * 1000;

let _cachedCredentials = null;
let _refreshPromise = null;
let _lastRestorationAttempt = 0;

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
        const instRow = db.prepare('SELECT code_etablissement FROM institution_config WHERE id = 1').get() || {};
        const val = String(instRow.code_etablissement || '').trim().toUpperCase();
        if (val) return val;
    } catch { /* column may not exist */ }

    try {
        const instRow = db.prepare('SELECT massar_code FROM institution_config WHERE id = 1').get() || {};
        return String(instRow.massar_code || '').trim().toUpperCase();
    } catch {
        return '';
    }
}

function clean(value) {
    return String(value || '').trim();
}

function readFirebaseConfigFromDb(db) {
    const syncConfig = readSyncConfig(db);
    return {
        apiKey: clean(process.env.FIREBASE_API_KEY) || clean(syncConfig.firebase_api_key),
        authDomain: clean(process.env.FIREBASE_AUTH_DOMAIN) || clean(syncConfig.firebase_auth_domain),
        projectId: clean(process.env.FIREBASE_PROJECT_ID) || clean(syncConfig.firebase_project_id),
        storageBucket: clean(process.env.FIREBASE_STORAGE_BUCKET) || clean(syncConfig.firebase_storage_bucket),
        messagingSenderId: clean(process.env.FIREBASE_MESSAGING_SENDER_ID) || clean(syncConfig.firebase_messaging_sender_id),
        appId: clean(process.env.FIREBASE_APP_ID) || clean(syncConfig.firebase_app_id)
    };
}

function ensureFirebaseApp() {
    const existing = getApps().find((a) => a.name === USER_AUTH_APP_NAME);
    if (existing) return existing;

    try {
        const db = getDb();
        const config = readFirebaseConfigFromDb(db);
        if (!config.apiKey || !config.projectId) {
            console.log('[sync:credentials] Cannot init Firebase app: missing apiKey or projectId');
            return null;
        }
        const app = initializeApp(config, USER_AUTH_APP_NAME);
        console.log('[sync:credentials] Initialized Firebase app:', USER_AUTH_APP_NAME);
        return app;
    } catch (err) {
        console.warn('[sync:credentials] Failed to initialize Firebase app:', err.message);
        return null;
    }
}

// ── Credential vault (encrypt/decrypt with safeStorage or AES fallback) ──

function getDeviceHashForEncryption() {
    try {
        const db = getDb();
        const config = readSyncConfig(db);
        if (config.device_hash) return config.device_hash;
    } catch { /* fall through */ }
    try {
        const { getDeviceHash } = require('./capture');
        return getDeviceHash();
    } catch {
        throw new Error('Cannot derive encryption key: no device hash available');
    }
}

function encryptCredential(plaintext) {
    try {
        const { safeStorage } = require('electron');
        if (safeStorage.isEncryptionAvailable()) {
            return safeStorage.encryptString(plaintext).toString('base64');
        }
    } catch { /* safeStorage unavailable — use fallback */ }

    const key = crypto.createHash('sha256').update(getDeviceHashForEncryption()).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return 'aes:' + iv.toString('hex') + ':' + encrypted.toString('base64');
}

function decryptCredential(stored) {
    if (!stored) return null;

    if (stored.startsWith('aes:')) {
        try {
            const parts = stored.split(':');
            const iv = Buffer.from(parts[1], 'hex');
            const encryptedData = parts[2];
            const key = crypto.createHash('sha256').update(getDeviceHashForEncryption()).digest();
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            return decipher.update(encryptedData, 'base64', 'utf8') + decipher.final('utf8');
        } catch (err) {
            console.warn('[sync:credentials] AES fallback decryption failed:', err.message);
            return null;
        }
    }

    try {
        const { safeStorage } = require('electron');
        return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch (err) {
        console.warn('[sync:credentials] safeStorage decryption failed:', err.message);
        return null;
    }
}

function persistCredential(email, password) {
    try {
        const db = getDb();
        const encrypted = encryptCredential(password);
        db.prepare(
            'UPDATE sync_config SET firebase_email = ?, firebase_credential = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        ).run(email, encrypted);
        _lastRestorationAttempt = 0;
    } catch (err) {
        console.warn('[sync:credentials] Failed to persist credential:', err.message);
    }
}

function clearStoredCredential() {
    try {
        const db = getDb();
        db.prepare(
            'UPDATE sync_config SET firebase_email = NULL, firebase_credential = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        ).run();
    } catch (err) {
        console.warn('[sync:credentials] Failed to clear stored credential:', err.message);
    }
}

function isInvalidCredentialError(code) {
    return (
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential' ||
        code === 'auth/invalid-login-credentials' ||
        code === 'auth/user-not-found' ||
        code === 'auth/user-disabled'
    );
}

async function restoreFirebaseSession() {
    const now = Date.now();
    if (now - _lastRestorationAttempt < RESTORATION_COOLDOWN_MS) {
        return;
    }
    _lastRestorationAttempt = now;

    try {
        const app = ensureFirebaseApp();
        if (!app) return;

        const auth = getAuth(app);
        if (auth.currentUser) return;

        const db = getDb();
        const config = readSyncConfig(db);
        const email = clean(config.firebase_email);
        const encryptedPassword = config.firebase_credential;

        if (!email || !encryptedPassword) return;

        const password = decryptCredential(encryptedPassword);
        if (!password) {
            console.warn('[sync:credentials] Failed to decrypt stored credential');
            return;
        }

        await signInWithEmailAndPassword(auth, email, password);
        console.log('[sync:credentials] Firebase session restored for', email);
    } catch (err) {
        const code = String(err?.code || '');
        console.warn('[sync:credentials] Session restoration failed:', code || err.message);

        if (isInvalidCredentialError(code)) {
            clearStoredCredential();
        }
    }
}

async function getFirebaseSession() {
    try {
        const app = ensureFirebaseApp();
        if (!app) {
            console.log('[sync:credentials] Firebase app not available:', USER_AUTH_APP_NAME);
            return null;
        }

        const auth = getAuth(app);
        if (!auth.currentUser) {
            const now = Date.now();
            if (now - _lastRestorationAttempt >= RESTORATION_COOLDOWN_MS) {
                await restoreFirebaseSession();
            }
            if (!auth.currentUser) {
                return null;
            }
        }

        let tokenResult;
        try {
            tokenResult = await auth.currentUser.getIdTokenResult(true);
        } catch (refreshErr) {
            console.warn('[sync:credentials] Forced token refresh failed, trying cached:', refreshErr.message);
            tokenResult = await auth.currentUser.getIdTokenResult(false);
        }

        const schoolId = String(tokenResult?.claims?.schoolId || '').trim().toUpperCase();
        const localSchoolId = readSchoolIdFromDb(getDb());
        if (!schoolId) {
            console.log('[sync:credentials] Firebase token is missing schoolId claim');
            return null;
        }
        if (localSchoolId && schoolId !== localSchoolId) {
            console.warn('[sync:credentials] Firebase token schoolId does not match local sync_config');
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

module.exports = {
    getCredentials,
    clearCredentials,
    isAuthenticated,
    testConnection,
    restoreFirebaseSession,
    persistCredential,
    clearStoredCredential
};
