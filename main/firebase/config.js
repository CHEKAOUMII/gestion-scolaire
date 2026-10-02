'use strict';

let _app = null;
let _db = null;
let _auth = null;
let _emulatorsConnected = false;
let _recovering = false;

const FIREBASE_APP_NAME = 'pencil-user-auth';
const CONFIG_FIELDS = [
    ['apiKey', 'FIREBASE_API_KEY', 'firebase_api_key'],
    ['authDomain', 'FIREBASE_AUTH_DOMAIN', 'firebase_auth_domain'],
    ['projectId', 'FIREBASE_PROJECT_ID', 'firebase_project_id'],
    ['storageBucket', 'FIREBASE_STORAGE_BUCKET', 'firebase_storage_bucket'],
    ['messagingSenderId', 'FIREBASE_MESSAGING_SENDER_ID', 'firebase_messaging_sender_id'],
    ['appId', 'FIREBASE_APP_ID', 'firebase_app_id']
];
const PROJECT_REQUIRED_CONFIG_KEYS = ['projectId'];
const AUTH_REQUIRED_CONFIG_KEYS = ['apiKey', 'projectId', 'appId'];

class FirebaseConfigError extends Error {
    constructor(missingKeys) {
        super(`Missing Firebase client config: ${missingKeys.join(', ')}`);
        this.name = 'FirebaseConfigError';
        this.code = 'FIREBASE_CONFIG_MISSING';
        this.missingKeys = missingKeys;
    }
}

function safeRequire(moduleName) {
    try {
        return require(moduleName);
    } catch (err) {
        if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message || '').includes(moduleName)) {
            return null;
        }
        throw err;
    }
}

function clean(value) {
    return String(value || '').trim();
}

function readSyncConfig() {
    try {
        const { getDb } = require('../db/context');
        return getDb().prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    } catch {
        return {};
    }
}

function getFirebaseConfig(env = process.env, options = {}) {
    const syncConfig = options.syncConfig || readSyncConfig();
    const config = {};

    for (const [configKey, envKey, dbKey] of CONFIG_FIELDS) {
        config[configKey] = clean(env[envKey]) || clean(syncConfig[dbKey]);
    }

    return config;
}

function getFirebaseConfigSources(env = process.env, options = {}) {
    const syncConfig = options.syncConfig || readSyncConfig();
    const sources = {};

    for (const [configKey, envKey, dbKey] of CONFIG_FIELDS) {
        if (clean(env[envKey])) {
            sources[configKey] = 'env';
        } else if (clean(syncConfig[dbKey])) {
            sources[configKey] = 'sync_config';
        } else {
            sources[configKey] = null;
        }
    }

    return sources;
}

function getMissingFirebaseConfigKeys(config, requiredKeys = AUTH_REQUIRED_CONFIG_KEYS) {
    return requiredKeys.filter((key) => !clean(config?.[key]));
}

function assertFirebaseConfig(config, requiredKeys = AUTH_REQUIRED_CONFIG_KEYS) {
    const missing = getMissingFirebaseConfigKeys(config, requiredKeys);
    if (missing.length) {
        throw new FirebaseConfigError(missing);
    }
    return config;
}

function getFirebaseConfigStatus(env = process.env, options = {}) {
    const config = getFirebaseConfig(env, options);
    return {
        config,
        sources: getFirebaseConfigSources(env, options),
        missingForProject: getMissingFirebaseConfigKeys(config, PROJECT_REQUIRED_CONFIG_KEYS),
        missingForAuth: getMissingFirebaseConfigKeys(config, AUTH_REQUIRED_CONFIG_KEYS)
    };
}

function initFirebase(env = process.env) {
    if (_app) {
        return { app: _app, db: _db, auth: _auth };
    }

    const firebaseApp = safeRequire('firebase/app');
    const firestore = safeRequire('firebase/firestore');
    const firebaseAuth = safeRequire('firebase/auth');

    if (!firebaseApp || !firestore || !firebaseAuth) {
        console.warn('[firebase] Firebase client SDK is not installed');
        return { app: null, db: null, auth: null };
    }

    const config = getFirebaseConfig(env);
    const missing = getMissingFirebaseConfigKeys(config, PROJECT_REQUIRED_CONFIG_KEYS);
    if (missing.length) {
        console.warn(`[firebase] ${new FirebaseConfigError(missing).message}`);
        return { app: null, db: null, auth: null };
    }

    _app = firebaseApp.getApps().find((candidate) => candidate.name === FIREBASE_APP_NAME) ||
        firebaseApp.initializeApp(config, FIREBASE_APP_NAME);
    _db = firestore.getFirestore(_app);

    if (!_emulatorsConnected) {
        if (env.FIRESTORE_EMULATOR_HOST) {
            const [host, portValue] = String(env.FIRESTORE_EMULATOR_HOST).split(':');
            const port = Number(portValue) || 8080;
            firestore.connectFirestoreEmulator(_db, host || '127.0.0.1', port);
        }

        if (env.FIREBASE_AUTH_EMULATOR_HOST) {
            _auth = firebaseAuth.getAuth(_app);
            firebaseAuth.connectAuthEmulator(_auth, `http://${String(env.FIREBASE_AUTH_EMULATOR_HOST).trim()}`);
        }

        _emulatorsConnected = true;
    }

    return { app: _app, db: _db, auth: _auth };
}

function getFirestoreDb(env = process.env) {
    if (!_db) {
        initFirebase(env);
    }
    return _db;
}

// Recover a contaminated Firestore client without restarting the application
// (firestore-sync-assertion-crash-fix). After the mid-transaction
// `auth/network-request-failed` / `INTERNAL ASSERTION FAILED` bug fires, the
// Firestore client's internal state can be left corrupted so every subsequent
// operation fails. This terminates the current client, clears the cached
// references, re-initializes a fresh client, and clears the cached credentials so
// the next cycle warms up a fresh auth token. A reentrancy guard prevents
// concurrent/repeated recovery from overlapping cycles (Req 2.1, 2.2, 3.2, 3.3).
async function recoverFirestoreClient(env = process.env) {
    if (_recovering) {
        return { recovered: false, skipped: true, reason: 'already_recovering' };
    }
    _recovering = true;

    try {
        const firestore = safeRequire('firebase/firestore');

        // Terminate the (possibly contaminated) client to release its internal state.
        if (firestore && _db && typeof firestore.terminate === 'function') {
            try {
                await firestore.terminate(_db);
            } catch (err) {
                console.warn('[firebase] terminate during recovery failed:', err && err.message);
            }
        }

        // Reset cached references so initFirebase rebuilds a fresh client.
        _db = null;
        _app = null;
        _auth = null;

        const result = initFirebase(env);

        // Force a fresh auth-token warm-up on the next cycle.
        try {
            const { clearCredentials } = require('../sync/credentials');
            clearCredentials();
        } catch (err) {
            console.warn('[firebase] clearCredentials during recovery failed:', err && err.message);
        }

        return { recovered: !!(result && result.db), app: result && result.app, db: result && result.db };
    } finally {
        _recovering = false;
    }
}

function getFirebaseAuth(env = process.env) {
    if (!_app) {
        initFirebase(env);
    }
    if (!_app) {
        return null;
    }
    if (!_auth) {
        const firebaseAuth = safeRequire('firebase/auth');
        if (!firebaseAuth) {
            return null;
        }
        const config = getFirebaseConfig(env);
        assertFirebaseConfig(config, AUTH_REQUIRED_CONFIG_KEYS);
        _auth = firebaseAuth.getAuth(_app);
    }
    return _auth;
}

function readSchoolId(db) {
    if (!db) {
        try {
            const { getDb } = require('../db/context');
            db = getDb();
        } catch {
            return '';
        }
    }

    try {
        const syncRow = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
        const fromSync = clean(syncRow.school_id).toUpperCase();
        if (fromSync) return fromSync;
    } catch { /* continue to institution_config fallback */ }

    try {
        const instRow = db.prepare('SELECT code_etablissement FROM institution_config WHERE id = 1').get() || {};
        const val = clean(instRow.code_etablissement).toUpperCase();
        if (val) return val;
    } catch { /* column may not exist */ }

    try {
        const instRow = db.prepare('SELECT massar_code FROM institution_config WHERE id = 1').get() || {};
        return clean(instRow.massar_code).toUpperCase();
    } catch {
        return '';
    }
}

function isInvalidCredentialError(code) {
    const c = String(code || '');
    return (
        c === 'auth/invalid-credential' ||
        c === 'auth/invalid-login-credentials' ||
        c === 'auth/user-not-found' ||
        c === 'auth/wrong-password' ||
        c === 'auth/invalid-email' ||
        c === 'auth/user-disabled'
    );
}

module.exports = {
    FirebaseConfigError,
    initFirebase,
    getFirestoreDb,
    recoverFirestoreClient,
    getFirebaseAuth,
    getFirebaseConfig,
    getFirebaseConfigSources,
    getFirebaseConfigStatus,
    getMissingFirebaseConfigKeys,
    assertFirebaseConfig,
    readSchoolId,
    isInvalidCredentialError,
    readSyncConfig
};
