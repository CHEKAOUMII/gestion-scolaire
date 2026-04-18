'use strict';

const { signInWithCustomToken } = require('firebase/auth');
const { doc, getDoc } = require('firebase/firestore');
const { getFirebaseAuth, getFirestoreDb } = require('../firebase/config');
const { getDb } = require('../db/context');
const { getDeviceHash } = require('./capture');

let _cachedCredentials = null;
let _refreshPromise = null;

function readSyncConfig(db) {
    return db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
}

function readLicenseKey(db) {
    const config = readSyncConfig(db);
    return config.license_key ? String(config.license_key).trim() || null : null;
}

function getFunctionsUrl(config) {
    const url = String(config.firebase_functions_url || config.auth_lambda_url || process.env.FIREBASE_FUNCTIONS_URL || '')
        .trim()
        .replace(/\/+$/, '');
    return url || null;
}

async function refreshCredentials() {
    try {
        const db = getDb();
        const config = readSyncConfig(db);
        const functionsUrl = getFunctionsUrl(config);

        if (!functionsUrl) return null;

        const licenseKey = readLicenseKey(db);
        if (!licenseKey) return null;

        const deviceHash = getDeviceHash();

        // Step 1: Call authExchange Cloud Function
        const authResponse = await fetch(`${functionsUrl}/authExchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, deviceHash })
        });

        if (!authResponse.ok) {
            let errorBody = {};
            try { errorBody = await authResponse.json(); } catch { /* */ }
            console.warn('[sync:credentials] Auth exchange failed:', errorBody.error || authResponse.status);
            return null;
        }

        const { customToken, schoolId } = await authResponse.json();

        // Step 2: Sign in with custom token via Firebase Auth
        const auth = getFirebaseAuth();
        if (!auth) {
            console.warn('[sync:credentials] Firebase Auth not initialized');
            return null;
        }

        const userCredential = await signInWithCustomToken(auth, customToken);

        _cachedCredentials = {
            user: userCredential.user,
            schoolId,
            expiresAt: Math.floor(Date.now() / 1000) + 3500
        };

        return _cachedCredentials;
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
    const db = getDb();
    const config = readSyncConfig(db);
    const functionsUrl = getFunctionsUrl(config);
    const licenseKey = readLicenseKey(db);

    if (!functionsUrl) {
        return { success: false, error: 'لم يتم تحديد رابط Firebase Functions بعد' };
    }
    if (!licenseKey) {
        return { success: false, error: 'لم يتم إدخال مفتاح الترخيص' };
    }

    // Step 1: Test authExchange Cloud Function
    let customToken, schoolId;
    try {
        const deviceHash = getDeviceHash();
        const authRes = await fetch(`${functionsUrl}/authExchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, deviceHash })
        });
        if (!authRes.ok) {
            let body = {};
            try { body = await authRes.json(); } catch { /* */ }
            return { success: false, step: 'auth', error: body.error || `HTTP ${authRes.status}` };
        }
        ({ customToken, schoolId } = await authRes.json());
    } catch (err) {
        return { success: false, step: 'auth', error: err.message };
    }

    // Step 2: Sign in with custom token
    try {
        const auth = getFirebaseAuth();
        if (!auth) return { success: false, step: 'firebase', error: 'Firebase not initialized' };
        await signInWithCustomToken(auth, customToken);
    } catch (err) {
        return { success: false, step: 'firebase', error: err.message };
    }

    // Step 3: Firestore ping — read school document
    try {
        const firestoreDb = getFirestoreDb();
        if (!firestoreDb) return { success: false, step: 'firestore', error: 'Firestore not initialized' };
        const schoolRef = doc(firestoreDb, 'schools', schoolId);
        await getDoc(schoolRef);
    } catch (err) {
        return { success: false, step: 'firestore', error: err.message };
    }

    return { success: true, schoolId };
}

module.exports = { getCredentials, clearCredentials, isAuthenticated, testConnection };
