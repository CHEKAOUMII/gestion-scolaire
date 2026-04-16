'use strict';

const admin = require('firebase-admin');
const path = require('path');

let _adminApp = null;

function initAdmin() {
    if (_adminApp) return _adminApp;

    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '';

    if (serviceAccountPath) {
        const serviceAccount = require(path.resolve(serviceAccountPath));
        _adminApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } else if (process.env.FIREBASE_PROJECT_ID) {
        _adminApp = admin.initializeApp({
            projectId: process.env.FIREBASE_PROJECT_ID
        });
    } else {
        console.warn('[firebase-admin] No credentials configured');
        return null;
    }

    console.log('[firebase-admin] Initialized');
    return _adminApp;
}

function getAdminFirestore() {
    const app = initAdmin();
    return app ? admin.firestore(app) : null;
}

function getAdminAuth() {
    const app = initAdmin();
    return app ? admin.auth(app) : null;
}

module.exports = { initAdmin, getAdminFirestore, getAdminAuth };
