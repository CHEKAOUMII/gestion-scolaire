'use strict';

const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator } = require('firebase/firestore');
const { getAuth, connectAuthEmulator } = require('firebase/auth');

let _app = null;
let _db = null;
let _auth = null;

function getFirebaseConfig() {
    return {
        apiKey: process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.FIREBASE_APP_ID || ''
    };
}

function initFirebase() {
    if (_app) return { app: _app, db: _db, auth: _auth };

    const config = getFirebaseConfig();
    if (!config.projectId) {
        console.warn('[firebase] No FIREBASE_PROJECT_ID — Firebase not initialized');
        return { app: null, db: null, auth: null };
    }

    _app = initializeApp(config);
    _db = getFirestore(_app);
    _auth = getAuth(_app);

    if (process.env.FIRESTORE_EMULATOR_HOST) {
        const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
        connectFirestoreEmulator(_db, host, parseInt(port, 10));
    }
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        connectAuthEmulator(_auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
    }

    console.log(`[firebase] Initialized for project: ${config.projectId}`);
    return { app: _app, db: _db, auth: _auth };
}

function getFirestoreDb() {
    if (!_db) initFirebase();
    return _db;
}

function getFirebaseAuth() {
    if (!_auth) initFirebase();
    return _auth;
}

module.exports = { initFirebase, getFirestoreDb, getFirebaseAuth, getFirebaseConfig };
