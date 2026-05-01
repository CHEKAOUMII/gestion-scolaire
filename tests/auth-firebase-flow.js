'use strict';

/**
 * Emulator-oriented tests for Firebase-backed auth/admin user flows.
 *
 * Expected environment:
 *   FIREBASE_PROJECT_ID=gestionscholaire
 *   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
 *   FIRESTORE_EMULATOR_HOST=localhost:8080
 *   FUNCTIONS_EMULATOR_HOST=localhost:5001
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gestionscholaire';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.FUNCTIONS_EMULATOR_HOST = process.env.FUNCTIONS_EMULATOR_HOST || 'localhost:5001';

const assert = require('assert');
const net = require('net');
const admin = require('firebase-admin');

// Firebase client SDK for login tests (signInWithEmailAndPassword etc.)
const { initializeApp: initializeClientApp, deleteApp: deleteClientApp } = require('firebase/app');
const {
    getAuth: getClientAuth,
    connectAuthEmulator,
    signInWithEmailAndPassword
} = require('firebase/auth');

const {
    _private: {
        provisionFirebaseUser,
        updateFirebaseUserRole,
        updateFirebaseUserDisabled,
        buildFirebaseProvisioningWarning
    }
} = require('../main/ipc/system');

const { hashPassword } = require('../main/auth/password');

const {
    COLLECTION_MAP,
    SCHOOL_USERS_COLLECTION,
    SCHOOL_USER_INVITES_COLLECTION
} = require('../main/firebase/collections');

const results = [];

async function test(name, fn) {
    try {
        await fn();
        results.push({ name, passed: true });
        console.log(`  PASS ${name}`);
    } catch (err) {
        results.push({ name, passed: false, error: err.message });
        console.error(`  FAIL ${name}`);
        console.error(`    ${err.message}`);
    }
}

function createTestDb(schoolId) {
    return {
        prepare(sql) {
            const normalized = String(sql || '').trim().toLowerCase();
            return {
                all() {
                    if (normalized.startsWith('pragma table_info(sync_config)')) {
                        return [{ name: 'id' }, { name: 'school_id' }];
                    }
                    if (normalized.startsWith('pragma table_info(institution_config)')) {
                        return [{ name: 'id' }, { name: 'code_etablissement' }];
                    }
                    return [];
                },
                get() {
                    if (normalized.includes('from sync_config')) {
                        return { school_id: schoolId };
                    }
                    if (normalized.includes('from institution_config')) {
                        return { code_etablissement: schoolId };
                    }
                    return null;
                }
            };
        }
    };
}

/**
 * Create a mock db for offline fallback tests.
 * Simulates a `users` table with a single user row.
 */
function createOfflineMockDb(userRow) {
    return {
        prepare(sql) {
            const normalized = String(sql || '').trim().toLowerCase();
            return {
                all() {
                    if (normalized.startsWith('pragma table_info(users)')) {
                        return [
                            { name: 'id' },
                            { name: 'name' },
                            { name: 'email' },
                            { name: 'role' },
                            { name: 'password_hash' },
                            { name: 'disabled' },
                            { name: 'must_change_password' },
                            { name: 'firebase_uid' },
                            { name: 'auth_source' },
                            { name: 'last_login_at' },
                            { name: 'last_auth_mode' }
                        ];
                    }
                    return [];
                },
                get(...params) {
                    if (normalized.includes('from users') && normalized.includes('where id = ?')) {
                        if (userRow && Number(params[0]) === Number(userRow.id)) {
                            return { ...userRow };
                        }
                        return null;
                    }
                    // SELECT * FROM users WHERE lower(email) = ? LIMIT 1
                    if (normalized.includes('from users') && normalized.includes('where')) {
                        if (userRow && params.length > 0) {
                            const queryEmail = String(params[0] || '').trim().toLowerCase();
                            const rowEmail = String(userRow.email || '').trim().toLowerCase();
                            if (queryEmail === rowEmail) {
                                return { ...userRow };
                            }
                        }
                        if (userRow && params.length === 0) {
                            return { ...userRow };
                        }
                        return null;
                    }
                    return null;
                },
                run() {
                    return { changes: 1 };
                }
            };
        }
    };
}

function parseHostPort(value, fallbackPort) {
    const raw = String(value || '').replace(/^https?:\/\//, '');
    const [host, port] = raw.split(':');
    return {
        host: host || 'localhost',
        port: Number(port || fallbackPort)
    };
}

function canConnect({ host, port }) {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });
        const finish = (ok) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(500);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
    });
}

async function ensureEmulatorsAvailable() {
    const authTarget = parseHostPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, 9099);
    const firestoreTarget = parseHostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080);
    const functionsTarget = parseHostPort(process.env.FUNCTIONS_EMULATOR_HOST, 5001);
    const [authOk, firestoreOk, functionsOk] = await Promise.all([
        canConnect(authTarget),
        canConnect(firestoreTarget),
        canConnect(functionsTarget)
    ]);
    if (!functionsOk) {
        console.log('  NOTE: Functions emulator not reachable — onboarding test will be skipped.');
    }
    return { authOk, firestoreOk, functionsOk, allCore: authOk && firestoreOk };
}

async function deleteUserIfExists(auth, email) {
    try {
        const userRecord = await auth.getUserByEmail(email);
        await auth.deleteUser(userRecord.uid);
    } catch (err) {
        if (err.code !== 'auth/user-not-found') {
            throw err;
        }
    }
}

/**
 * Initialize a Firebase client app connected to the Auth emulator.
 * Returns { clientApp, clientAuth }.
 */
function initClientSdk() {
    const clientApp = initializeClientApp(
        {
            apiKey: 'fake-api-key-for-emulator',
            projectId: process.env.FIREBASE_PROJECT_ID
        },
        `test-client-${Date.now()}`
    );
    const clientAuth = getClientAuth(clientApp);
    const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
    connectAuthEmulator(clientAuth, `http://${emulatorHost}`, { disableWarnings: true });
    return { clientApp, clientAuth };
}

async function run() {
    console.log('Firebase Auth Flow Tests');
    console.log(`  Firestore emulator : ${process.env.FIRESTORE_EMULATOR_HOST}`);
    console.log(`  Auth emulator      : ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
    console.log(`  Functions emulator : ${process.env.FUNCTIONS_EMULATOR_HOST}`);
    console.log(`  Project            : ${process.env.FIREBASE_PROJECT_ID}`);

    // ── Unit tests (no emulator needed) ──────────────────────────────────

    await test('offline fallback: succeeds with correct password', () => {
        // Monkey-patch getDb to return our mock
        const contextModule = require('../main/db/context');
        const originalGetDb = contextModule.getDb;

        const password = 'OfflinePass99!';
        const hash = hashPassword(password);
        const mockUser = {
            id: 1,
            name: 'Offline User',
            email: 'offline@school.test',
            role: 'teacher',
            password_hash: hash,
            firebase_uid: 'offline-firebase-uid',
            auth_source: 'firebase',
            disabled: 0,
            must_change_password: 0
        };
        const mockDb = createOfflineMockDb(mockUser);
        contextModule.getDb = () => mockDb;

        try {
            const { loginWithLocalFallback } = require('../main/auth/firebase-auth-service');
            const result = loginWithLocalFallback('offline@school.test', password);
            assert.ok(result, 'Expected a result from local fallback');
            assert.strictEqual(result.mode, 'offline');
            assert.strictEqual(result.userRow.email, 'offline@school.test');
            assert.strictEqual(result.userRow.role, 'teacher');
        } finally {
            contextModule.getDb = originalGetDb;
        }
    });

    await test('offline fallback: fails with wrong password', () => {
        const contextModule = require('../main/db/context');
        const originalGetDb = contextModule.getDb;

        const password = 'CorrectPass99!';
        const hash = hashPassword(password);
        const mockUser = {
            id: 2,
            name: 'Offline User 2',
            email: 'offline2@school.test',
            role: 'viewer',
            password_hash: hash,
            disabled: 0,
            must_change_password: 0
        };
        const mockDb = createOfflineMockDb(mockUser);
        contextModule.getDb = () => mockDb;

        try {
            const { loginWithLocalFallback } = require('../main/auth/firebase-auth-service');
            const result = loginWithLocalFallback('offline2@school.test', 'WrongPassword!');
            assert.strictEqual(result, null, 'Expected null for wrong password');
        } finally {
            contextModule.getDb = originalGetDb;
        }
    });

    await test('offline fallback: rejects disabled user', () => {
        const contextModule = require('../main/db/context');
        const originalGetDb = contextModule.getDb;

        const password = 'DisabledPass99!';
        const hash = hashPassword(password);
        const mockUser = {
            id: 3,
            name: 'Disabled Offline User',
            email: 'disabled-offline@school.test',
            role: 'teacher',
            password_hash: hash,
            disabled: 1,
            must_change_password: 0
        };
        const mockDb = createOfflineMockDb(mockUser);
        contextModule.getDb = () => mockDb;

        try {
            const { loginWithLocalFallback } = require('../main/auth/firebase-auth-service');
            const result = loginWithLocalFallback('disabled-offline@school.test', password);
            assert.strictEqual(result, null, 'Expected null for disabled user');
        } finally {
            contextModule.getDb = originalGetDb;
        }
    });

    await test('COLLECTION_MAP contains expected auth-related collections', () => {
        // Regression check: ensure auth-related collection entries still exist
        assert.ok(SCHOOL_USERS_COLLECTION, 'SCHOOL_USERS_COLLECTION should be defined');
        assert.ok(SCHOOL_USER_INVITES_COLLECTION, 'SCHOOL_USER_INVITES_COLLECTION should be defined');
        assert.strictEqual(SCHOOL_USERS_COLLECTION, 'users', 'Users collection name changed unexpectedly');
        assert.strictEqual(SCHOOL_USER_INVITES_COLLECTION, 'userInvites', 'User invites collection name changed unexpectedly');

        // COLLECTION_MAP should have all the expected data tables defined
        assert.ok(COLLECTION_MAP.students, 'COLLECTION_MAP should have students');
        assert.ok(COLLECTION_MAP.teachers, 'COLLECTION_MAP should have teachers');
        assert.ok(COLLECTION_MAP.settings, 'COLLECTION_MAP should have settings');
    });

    await test('local-only provisioning warnings are surfaced as warning codes', () => {
        assert.strictEqual(buildFirebaseProvisioningWarning({ status: 'skipped', reason: 'missing-school-id' }), 'missing-school-id');
        assert.strictEqual(buildFirebaseProvisioningWarning({ status: 'created' }), null);
        assert.strictEqual(buildFirebaseProvisioningWarning({ status: 'linked' }), null);
        assert.strictEqual(buildFirebaseProvisioningWarning({ status: 'updated' }), null);
        assert.strictEqual(
            buildFirebaseProvisioningWarning({ status: 'skipped', reason: 'firebase-admin-unavailable' }),
            'firebase-admin-unavailable'
        );
        assert.strictEqual(
            buildFirebaseProvisioningWarning(null),
            null,
            'null input should return null'
        );
    });

    // ── Emulator-dependent tests ─────────────────────────────────────────

    const emulators = await ensureEmulatorsAvailable();
    if (!emulators.allCore) {
        console.log('\nSKIP: Firebase Auth/Firestore emulators are not reachable.');
        printResults();
        return;
    }

    const schoolId = `TEST_AUTH_${Date.now()}`;
    const db = createTestDb(schoolId);
    const email = `user-${Date.now()}@example.test`;
    const testPassword = 'TempPass123!';
    let auth;
    let firestore;
    let clientApp;
    let clientAuth;

    try {
        // Initialize client SDK for login tests
        ({ clientApp, clientAuth } = initClientSdk());

        await test('users:add provisions Firebase Auth user and Firestore profile', async () => {
            const result = await provisionFirebaseUser(db, {
                name: 'Firebase Test User',
                email,
                password: testPassword,
                role: 'teacher',
                disabled: false,
                mustChangePassword: true
            });

            assert.strictEqual(result.status, 'created');
            assert.ok(result.uid, 'Expected Firebase UID');

            const app = admin.app();
            auth = admin.auth(app);
            firestore = admin.firestore(app);

            const userRecord = await auth.getUser(result.uid);
            assert.strictEqual(userRecord.email, email);
            assert.strictEqual(userRecord.disabled, false);
            assert.strictEqual(userRecord.customClaims.schoolId, schoolId);
            assert.strictEqual(userRecord.customClaims.role, 'teacher');

            const profile = await firestore.doc(`schools/${schoolId}/users/${result.uid}`).get();
            assert.ok(profile.exists, 'Expected Firestore user profile');
            assert.strictEqual(profile.data().role, 'teacher');
            assert.strictEqual(profile.data().mustChangePassword, true);
        });

        await test('successful login via client SDK after provisioning', async () => {
            const credential = await signInWithEmailAndPassword(clientAuth, email, testPassword);
            assert.ok(credential.user, 'Expected a user object from signIn');
            assert.ok(credential.user.uid, 'Expected a UID on the signed-in user');
            assert.strictEqual(credential.user.email, email);

            // Verify the ID token has the correct custom claims
            const idTokenResult = await credential.user.getIdTokenResult();
            assert.strictEqual(
                idTokenResult.claims.schoolId,
                schoolId,
                'ID token should contain the correct schoolId claim'
            );
            assert.strictEqual(
                idTokenResult.claims.role,
                'teacher',
                'ID token should contain the correct role claim'
            );
        });

        await test('failed password login throws Firebase auth error', async () => {
            let threwError = false;
            try {
                await signInWithEmailAndPassword(clientAuth, email, 'WrongPassword999!');
            } catch (err) {
                threwError = true;
                // Firebase emulator may return auth/invalid-credential or auth/wrong-password
                const code = String(err.code || '');
                assert.ok(
                    code.includes('auth/wrong-password') ||
                        code.includes('auth/invalid-credential') ||
                        code.includes('auth/invalid-login-credentials'),
                    `Expected a credential error code, got: ${code}`
                );
            }
            assert.ok(threwError, 'signInWithEmailAndPassword should have thrown for wrong password');
        });

        await test('users:updateRole updates claims and profile role', async () => {
            const userRecord = await auth.getUserByEmail(email);
            const result = await updateFirebaseUserRole(
                db,
                {
                    firebase_uid: userRecord.uid,
                    name: 'Firebase Test User',
                    email,
                    disabled: 0
                },
                'viewer'
            );

            assert.strictEqual(result.status, 'updated');

            const refreshed = await auth.getUser(userRecord.uid);
            assert.strictEqual(refreshed.customClaims.role, 'viewer');

            const profile = await firestore.doc(`schools/${schoolId}/users/${userRecord.uid}`).get();
            assert.strictEqual(profile.data().role, 'viewer');
        });

        await test('must-change-password persists in Firestore profile and can be cleared', async () => {
            // The user was provisioned with mustChangePassword: true — verify it persists
            const userRecord = await auth.getUserByEmail(email);
            const profileBefore = await firestore.doc(`schools/${schoolId}/users/${userRecord.uid}`).get();
            assert.ok(profileBefore.exists, 'Firestore profile should exist');
            assert.strictEqual(
                profileBefore.data().mustChangePassword,
                true,
                'mustChangePassword should be true after provisioning'
            );

            // Simulate a password change: update Firebase Auth password and clear the flag
            const newPassword = 'NewSecurePass456!';
            await auth.updateUser(userRecord.uid, { password: newPassword });
            await firestore.doc(`schools/${schoolId}/users/${userRecord.uid}`).update({
                mustChangePassword: false,
                updatedAt: new Date().toISOString()
            });

            const profileAfter = await firestore.doc(`schools/${schoolId}/users/${userRecord.uid}`).get();
            assert.strictEqual(
                profileAfter.data().mustChangePassword,
                false,
                'mustChangePassword should be false after password change'
            );

            // Verify the user can sign in with the new password
            const credential = await signInWithEmailAndPassword(clientAuth, email, newPassword);
            assert.ok(credential.user, 'User should be able to sign in with new password');

            // Update testPassword reference for subsequent tests by re-provisioning password
            // (the disable test below does not need to sign in with the password)
        });

        await test('users:disable disables Auth user and marks profile disabled', async () => {
            const userRecord = await auth.getUserByEmail(email);
            const result = await updateFirebaseUserDisabled(
                db,
                {
                    firebase_uid: userRecord.uid,
                    name: 'Firebase Test User',
                    email,
                    role: 'viewer'
                },
                true
            );

            assert.strictEqual(result.status, 'updated');

            const refreshed = await auth.getUser(userRecord.uid);
            assert.strictEqual(refreshed.disabled, true);

            const profile = await firestore.doc(`schools/${schoolId}/users/${userRecord.uid}`).get();
            assert.strictEqual(profile.data().status, 'disabled');
        });

        await test('disabled user is rejected at login via client SDK', async () => {
            // The user was disabled in the previous test — try to sign in
            let threwError = false;
            try {
                await signInWithEmailAndPassword(clientAuth, email, 'NewSecurePass456!');
            } catch (err) {
                threwError = true;
                const code = String(err.code || '');
                assert.ok(
                    code.includes('auth/user-disabled'),
                    `Expected auth/user-disabled error, got: ${code}`
                );
            }
            assert.ok(threwError, 'signInWithEmailAndPassword should have thrown for disabled user');
        });

        // ── Onboarding test (requires Functions emulator) ────────────────
        if (emulators.functionsOk) {
            const onboardingEmail = `onboard-${Date.now()}@example.test`;
            const onboardingSchoolId = `ONBOARD_${Date.now()}`;

            await test('bootstrapInstitution Cloud Function creates school and admin', async () => {
                const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || 'localhost:5001';
                const projectId = process.env.FIREBASE_PROJECT_ID || 'gestionscholaire';
                const url = `http://${functionsHost}/${projectId}/us-central1/bootstrapInstitution`;

                const body = {
                    massarCode: onboardingSchoolId,
                    gresaCode: `GRESA_${Date.now()}`,
                    schoolId: onboardingSchoolId,
                    institutionName: 'Test Institution',
                    adminName: 'Admin User',
                    adminEmail: onboardingEmail,
                    adminPassword: 'AdminPass123!'
                };

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                assert.ok(response.ok, `Expected 2xx from bootstrapInstitution, got ${response.status}`);
                const data = await response.json();

                // Verify response structure
                assert.ok(data.schoolId || data.school_id, 'Response should contain schoolId');
                assert.ok(data.uid || data.adminUid, 'Response should contain user UID');

                const returnedUid = data.uid || data.adminUid;
                const returnedSchoolId = data.schoolId || data.school_id;

                // Verify user was created in Firebase Auth
                const createdUser = await auth.getUser(returnedUid);
                assert.strictEqual(createdUser.email, onboardingEmail);
                assert.ok(!createdUser.disabled, 'Admin user should not be disabled');

                // Verify custom claims were set
                const claims = createdUser.customClaims || {};
                assert.strictEqual(claims.schoolId, returnedSchoolId, 'Custom claim schoolId should match');
                assert.ok(claims.role, 'Custom claim role should be set');

                // Verify Firestore documents were created
                const userProfile = await firestore
                    .doc(`schools/${returnedSchoolId}/users/${returnedUid}`)
                    .get();
                assert.ok(userProfile.exists, 'Firestore user profile should be created');

                // Clean up the onboarding user
                await deleteUserIfExists(auth, onboardingEmail);
            });
        } else {
            console.log('  SKIP bootstrapInstitution test (Functions emulator not available)');
        }
    } finally {
        // ── Cleanup ──────────────────────────────────────────────────────
        if (auth) {
            await deleteUserIfExists(auth, email);
        }
        if (clientApp) {
            await deleteClientApp(clientApp).catch(() => {});
        }
        if (admin.apps.length) {
            await admin.app().delete().catch(() => {});
        }
    }

    printResults();
}

function printResults() {
    const passed = results.filter((result) => result.passed).length;
    const failed = results.filter((result) => !result.passed).length;

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

run().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
