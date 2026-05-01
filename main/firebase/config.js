'use strict';

let _app = null;
let _db = null;
let _auth = null;
let _emulatorsConnected = false;

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

    _app = firebaseApp.initializeApp(config);
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

module.exports = {
    FirebaseConfigError,
    initFirebase,
    getFirestoreDb,
    getFirebaseAuth,
    getFirebaseConfig,
    getFirebaseConfigSources,
    getFirebaseConfigStatus,
    getMissingFirebaseConfigKeys,
    assertFirebaseConfig
};
