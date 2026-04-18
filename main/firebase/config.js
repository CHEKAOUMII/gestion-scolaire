'use strict';

let _app = null;
let _db = null;
let _auth = null;
let _emulatorsConnected = false;

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

function getFirebaseConfig(env = process.env) {
    return {
        apiKey: String(env.FIREBASE_API_KEY || '').trim(),
        authDomain: String(env.FIREBASE_AUTH_DOMAIN || '').trim(),
        projectId: String(env.FIREBASE_PROJECT_ID || '').trim(),
        storageBucket: String(env.FIREBASE_STORAGE_BUCKET || '').trim(),
        messagingSenderId: String(env.FIREBASE_MESSAGING_SENDER_ID || '').trim(),
        appId: String(env.FIREBASE_APP_ID || '').trim()
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
    if (!config.projectId) {
        console.warn('[firebase] No FIREBASE_PROJECT_ID configured');
        return { app: null, db: null, auth: null };
    }

    _app = firebaseApp.initializeApp(config);
    _db = firestore.getFirestore(_app);
    _auth = firebaseAuth.getAuth(_app);

    if (!_emulatorsConnected) {
        if (env.FIRESTORE_EMULATOR_HOST) {
            const [host, portValue] = String(env.FIRESTORE_EMULATOR_HOST).split(':');
            const port = Number(portValue) || 8080;
            firestore.connectFirestoreEmulator(_db, host || '127.0.0.1', port);
        }

        if (env.FIREBASE_AUTH_EMULATOR_HOST) {
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
    if (!_auth) {
        initFirebase(env);
    }
    return _auth;
}

module.exports = {
    initFirebase,
    getFirestoreDb,
    getFirebaseAuth,
    getFirebaseConfig
};
