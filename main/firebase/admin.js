'use strict';

const path = require('path');

let _admin = null;
let _adminApp = null;

function getAdminModule() {
    if (_admin) {
        return _admin;
    }

    try {
        _admin = require('firebase-admin');
        return _admin;
    } catch (err) {
        if (err && err.code === 'MODULE_NOT_FOUND' && String(err.message || '').includes('firebase-admin')) {
            console.warn('[firebase-admin] firebase-admin is not installed');
            return null;
        }
        throw err;
    }
}

function initAdmin(env = process.env) {
    if (_adminApp) {
        return _adminApp;
    }

    const admin = getAdminModule();
    if (!admin) {
        return null;
    }

    const serviceAccountPath = String(env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();

    try {
        if (serviceAccountPath) {
            const resolvedPath = path.resolve(serviceAccountPath);
            // Require JSON lazily so local dev does not crash when the file is absent.
            const serviceAccount = require(resolvedPath);
            _adminApp = admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            return _adminApp;
        }

        const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
        if (projectId) {
            _adminApp = admin.initializeApp({ projectId });
            return _adminApp;
        }
    } catch (err) {
        console.warn('[firebase-admin] Initialization failed:', err.message);
        return null;
    }

    console.warn('[firebase-admin] No Firebase admin credentials configured');
    return null;
}

function getAdminFirestore(env = process.env) {
    const admin = getAdminModule();
    const app = initAdmin(env);
    return admin && app ? admin.firestore(app) : null;
}

function getAdminAuth(env = process.env) {
    const admin = getAdminModule();
    const app = initAdmin(env);
    return admin && app ? admin.auth(app) : null;
}

module.exports = {
    initAdmin,
    getAdminFirestore,
    getAdminAuth
};
