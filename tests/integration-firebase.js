'use strict';

/**
 * Integration test suite for the Firebase sync layer and auth flows.
 * Runs against the Firebase Emulator Suite and does not touch production.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gestionscholaire';
process.env.FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'emulator-fake-api-key';
process.env.FIREBASE_AUTH_DOMAIN = process.env.FIREBASE_AUTH_DOMAIN || 'gestionscholaire.firebaseapp.com';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

const assert = require('assert');
const { initializeApp, getApps, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken, signOut } = require('firebase/auth');
const admin = require('firebase-admin');

const { logChange, logChangeBatch, pullChanges } = require('../main/firebase/sync-log');
const { buildDocumentId, getCollectionPath, COLLECTION_MAP } = require('../main/firebase/collections');
const { parsePullCursor, serializePullCursor } = require('../main/sync/engine');

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

let clientApp;
let clientDb;
let adminDb;
let clientAuth;

function initClients() {
    for (const app of getApps()) {
        deleteApp(app);
    }

    clientApp = initializeApp({
        apiKey: process.env.FIREBASE_API_KEY,
        projectId: process.env.FIREBASE_PROJECT_ID
    });
    clientDb = getFirestore(clientApp);
    clientAuth = getAuth(clientApp);

    const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080').split(':');
    connectFirestoreEmulator(clientDb, fsHost, parseInt(fsPort, 10));
    connectAuthEmulator(
        clientAuth,
        `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099'}`,
        { disableWarnings: true }
    );

    if (!admin.apps.find((app) => app.name === 'integration-test')) {
        admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID }, 'integration-test');
    }
    adminDb = admin.app('integration-test').firestore();
}

async function signInAsSchool(schoolId) {
    const auth = admin.app('integration-test').auth();
    const uid = `integration-${schoolId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    try {
        await auth.getUser(uid);
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            await auth.createUser({ uid });
        } else {
            throw err;
        }
    }

    await auth.setCustomUserClaims(uid, { schoolId });
    const customToken = await auth.createCustomToken(uid, { schoolId });

    if (clientAuth.currentUser) {
        await signOut(clientAuth);
    }

    await signInWithCustomToken(clientAuth, customToken);
}

async function clearCollection(collectionPath) {
    const snap = await adminDb.collection(collectionPath).get();
    if (snap.empty) {
        return;
    }

    const batch = adminDb.batch();
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
}

async function testCollections() {
    console.log('\n[collections]');

    await test('student document id uses code', () => {
        assert.strictEqual(buildDocumentId('students', { code: 'S12345' }), 'S12345');
    });

    await test('grade document id uses canonical composite key', () => {
        assert.strictEqual(
            buildDocumentId('grades', {
                student_code: 'S123',
                subject: 'Math',
                semester: 'S1',
                school_year: '2025/2026'
            }),
            'S123__Math__S1__2025/2026'
        );
    });

    await test('student_files document id uses student_code + doc_key + school_year', () => {
        assert.strictEqual(
            buildDocumentId('student_files', {
                student_code: 'S123',
                doc_key: 'birth_certificate',
                school_year: '2025/2026'
            }),
            'S123__birth_certificate__2025/2026'
        );
    });

    await test('known collection path resolves correctly', () => {
        assert.strictEqual(getCollectionPath('SCHOOL01', 'teachers'), 'schools/SCHOOL01/teachers');
    });

    await test('collection map keeps expected sync tables', () => {
        const expected = [
            'students', 'grades', 'absences', 'teachers', 'teacher_aliases',
            'staff_attendance', 'teacher_absences', 'exams', 'exam_proctors',
            'exam_rooms', 'tests', 'correspondence', 'student_files',
            'student_movements', 'compensation_tracking', 'settings',
            'page_visibility', 'device_revocation'
        ];

        for (const tableName of expected) {
            assert.ok(COLLECTION_MAP[tableName], `Missing collection mapping for ${tableName}`);
        }
    });
}

async function testSyncLog() {
    console.log('\n[sync log]');

    const schoolId = 'TEST_SCHOOL_SYNCLOG';
    await clearCollection(`syncLog/${schoolId}/changes`);

    await test('logChange writes a sync log entry', async () => {
        await signInAsSchool(schoolId);
        const changeId = await logChange(
            clientDb,
            schoolId,
            'student',
            'doc-001',
            'PUT',
            { code: 'S001', full_name: 'Ali' },
            1,
            'device_abc',
            'row-sync-id-001',
            '2025/2026'
        );

        const snap = await adminDb.doc(`syncLog/${schoolId}/changes/${changeId}`).get();
        assert.ok(snap.exists, 'Expected sync log document to exist');
        assert.strictEqual(snap.data().entityType, 'student');
        assert.strictEqual(snap.data().operation, 'PUT');
    });

    await test('logChangeBatch writes multiple entries', async () => {
        await signInAsSchool(schoolId);
        const now = Math.floor(Date.now() / 1000);
        await logChangeBatch(clientDb, schoolId, [
            {
                entityType: 'grade',
                entityId: 'g1',
                operation: 'PUT',
                data: { subject: 'Math', score: 15 },
                version: 1,
                deviceHash: 'dev1',
                rowSyncId: 'rs-g1',
                schoolYear: '2025/2026',
                updatedAt: now
            },
            {
                entityType: 'absence',
                entityId: 'a1',
                operation: 'PUT',
                data: { days: 2 },
                version: 1,
                deviceHash: 'dev1',
                rowSyncId: 'rs-a1',
                schoolYear: '2025/2026',
                updatedAt: now + 1
            }
        ]);

        const count = (await adminDb.collection(`syncLog/${schoolId}/changes`).count().get()).data().count;
        assert.ok(count >= 3, `Expected at least 3 sync log entries, got ${count}`);
    });

    await test('pullChanges honors composite cursor pagination for same-second writes', async () => {
        const pagedSchoolId = 'TEST_SCHOOL_SAME_SECOND';
        await clearCollection(`syncLog/${pagedSchoolId}/changes`);
        await signInAsSchool(pagedSchoolId);

        const updatedAt = 3000000;
        await adminDb.doc(`syncLog/${pagedSchoolId}/changes/a_change`).set({ updatedAt, entityType: 'student', operation: 'PUT' });
        await adminDb.doc(`syncLog/${pagedSchoolId}/changes/b_change`).set({ updatedAt, entityType: 'grade', operation: 'PUT' });
        await adminDb.doc(`syncLog/${pagedSchoolId}/changes/c_change`).set({ updatedAt, entityType: 'absence', operation: 'PUT' });

        const firstPage = await pullChanges(clientDb, pagedSchoolId, { updatedAt: updatedAt - 1, changeId: '' }, 2);
        assert.strictEqual(firstPage.length, 2, `Expected first page length 2, got ${firstPage.length}`);

        const secondPage = await pullChanges(
            clientDb,
            pagedSchoolId,
            { updatedAt: firstPage[1].updatedAt, changeId: firstPage[1].id },
            2
        );

        const seenIds = new Set([...firstPage, ...secondPage].map((item) => item.id));
        assert.strictEqual(secondPage.length, 1, `Expected second page length 1, got ${secondPage.length}`);
        assert.strictEqual(seenIds.size, 3, 'Expected all same-second changes to be returned across pages');
    });

    await test('pullChanges returns empty when cursor is ahead of all changes', async () => {
        const emptySchoolId = 'TEST_SCHOOL_EMPTY';
        await clearCollection(`syncLog/${emptySchoolId}/changes`);
        await signInAsSchool(emptySchoolId);
        await adminDb.doc(`syncLog/${emptySchoolId}/changes/old`).set({ updatedAt: 500, entityType: 'student', operation: 'PUT' });

        const results = await pullChanges(clientDb, emptySchoolId, { updatedAt: 1000, changeId: '' });
        assert.strictEqual(results.length, 0);
    });
}

async function testCursorHelpers() {
    console.log('\n[cursor helpers]');

    await test('serializePullCursor and parsePullCursor round-trip composite cursor', () => {
        const encoded = serializePullCursor({ updatedAt: 1700000000, changeId: '1700000000_2_grade_row-1' });
        const decoded = parsePullCursor(encoded);

        assert.strictEqual(decoded.updatedAt, 1700000000);
        assert.strictEqual(decoded.changeId, '1700000000_2_grade_row-1');
    });

    await test('parsePullCursor keeps backward compatibility with numeric cursors', () => {
        const decoded = parsePullCursor('1700000000');
        assert.strictEqual(decoded.updatedAt, 1700000000);
        assert.strictEqual(decoded.changeId, '');
    });
}

// ---------------------------------------------------------------------------
// Auth flow helpers
// ---------------------------------------------------------------------------

const SCHOOL_ID = 'TEST_AUTH_SCHOOL';
const ADMIN_EMAIL = 'admin@test-auth.dev';
const ADMIN_PASS = 'TestPass123!';
const USER_EMAIL = 'teacher@test-auth.dev';
const USER_PASS = 'TeacherPass123!';

async function createSchoolUser(email, password, role, schoolId) {
    const adminAuth = admin.app('integration-test').auth();
    let user;
    try {
        user = await adminAuth.getUserByEmail(email);
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            user = await adminAuth.createUser({ email, password });
        } else {
            throw err;
        }
    }
    await adminAuth.setCustomUserClaims(user.uid, { schoolId, role });
    await adminDb
        .doc(`schools/${schoolId}/users/${user.uid}`)
        .set({ uid: user.uid, email, name: email, role, status: 'active', mustChangePassword: false });
    return user;
}

async function deleteSchoolUser(email, schoolId) {
    const adminAuth = admin.app('integration-test').auth();
    try {
        const user = await adminAuth.getUserByEmail(email);
        await adminAuth.deleteUser(user.uid);
        await adminDb.doc(`schools/${schoolId}/users/${user.uid}`).delete();
    } catch {
        // best-effort cleanup
    }
}

async function signInClientWithPassword(email, password) {
    const { signInWithEmailAndPassword: signInEP } = require('firebase/auth');
    if (clientAuth.currentUser) await signOut(clientAuth);
    return signInEP(clientAuth, email, password);
}

// ---------------------------------------------------------------------------
// Auth flow tests
// ---------------------------------------------------------------------------

async function testAuthFlows() {
    console.log('\n[auth flows]');

    // Seed school document so Firestore rules can evaluate schoolId
    await adminDb.doc(`schools/${SCHOOL_ID}`).set({ name: 'Test Auth School' });

    // Create admin and regular user for the school
    const adminUser = await createSchoolUser(ADMIN_EMAIL, ADMIN_PASS, 'admin', SCHOOL_ID);
    await createSchoolUser(USER_EMAIL, USER_PASS, 'principal', SCHOOL_ID);

    await test('admin can sign in with email + password', async () => {
        const credential = await signInClientWithPassword(ADMIN_EMAIL, ADMIN_PASS);
        assert.ok(credential.user, 'Expected a Firebase user object');
        assert.strictEqual(credential.user.email, ADMIN_EMAIL);
    });

    await test('admin id token carries schoolId and role claims', async () => {
        const credential = await signInClientWithPassword(ADMIN_EMAIL, ADMIN_PASS);
        const idTokenResult = await credential.user.getIdTokenResult(true);
        assert.strictEqual(idTokenResult.claims.schoolId, SCHOOL_ID);
        assert.strictEqual(idTokenResult.claims.role, 'admin');
    });

    await test('regular user can sign in with email + password', async () => {
        const credential = await signInClientWithPassword(USER_EMAIL, USER_PASS);
        assert.ok(credential.user, 'Expected a Firebase user object');
        assert.strictEqual(credential.user.email, USER_EMAIL);
    });

    await test('wrong password is rejected', async () => {
        let threw = false;
        try {
            await signInClientWithPassword(ADMIN_EMAIL, 'wrong-password-xyz');
        } catch (err) {
            threw = true;
            const code = String(err.code || '');
            assert.ok(
                code.includes('invalid-credential') ||
                    code.includes('invalid-login-credentials') ||
                    code.includes('wrong-password'),
                `Expected invalid-credential error, got: ${code}`
            );
        }
        assert.ok(threw, 'Expected an error for wrong password');
    });

    await test('disabled user cannot sign in', async () => {
        const adminAuth = admin.app('integration-test').auth();
        const disabledUser = await adminAuth.createUser({
            email: 'disabled@test-auth.dev',
            password: 'DisabledPass123!',
        });
        await adminAuth.setCustomUserClaims(disabledUser.uid, { schoolId: SCHOOL_ID, role: 'viewer' });
        await adminAuth.updateUser(disabledUser.uid, { disabled: true });

        let threw = false;
        try {
            await signInClientWithPassword('disabled@test-auth.dev', 'DisabledPass123!');
        } catch (err) {
            threw = true;
            const code = String(err.code || '');
            assert.ok(code.includes('user-disabled'), `Expected user-disabled error, got: ${code}`);
        }
        assert.ok(threw, 'Expected an error for disabled user');

        // Cleanup
        await adminAuth.deleteUser(disabledUser.uid);
    });

    await test('mustChangePassword flag is stored on Firestore profile', async () => {
        const adminAuth = admin.app('integration-test').auth();
        const tempUser = await adminAuth.createUser({
            email: 'mustchange@test-auth.dev',
            password: 'TempPass123!',
        });
        await adminAuth.setCustomUserClaims(tempUser.uid, { schoolId: SCHOOL_ID, role: 'teacher' });
        await adminDb.doc(`schools/${SCHOOL_ID}/users/${tempUser.uid}`).set({
            uid: tempUser.uid,
            email: 'mustchange@test-auth.dev',
            name: 'Temp User',
            role: 'teacher',
            status: 'active',
            mustChangePassword: true,
        });

        const snap = await adminDb.doc(`schools/${SCHOOL_ID}/users/${tempUser.uid}`).get();
        assert.ok(snap.exists, 'Expected profile document to exist');
        assert.strictEqual(snap.data().mustChangePassword, true);

        // Cleanup
        await adminAuth.deleteUser(tempUser.uid);
        await adminDb.doc(`schools/${SCHOOL_ID}/users/${tempUser.uid}`).delete();
    });

    await test('admin can read own profile from Firestore', async () => {
        const { doc: fsDoc, getDoc } = require('firebase/firestore');
        const credential = await signInClientWithPassword(ADMIN_EMAIL, ADMIN_PASS);
        const snap = await getDoc(fsDoc(clientDb, `schools/${SCHOOL_ID}/users/${credential.user.uid}`));
        assert.ok(snap.exists(), 'Expected admin profile document to exist');
        assert.strictEqual(snap.data().role, 'admin');
    });

    await test('regular user cannot read other user profile', async () => {
        const { doc: fsDoc, getDoc } = require('firebase/firestore');
        await signInClientWithPassword(USER_EMAIL, USER_PASS);
        let denied = false;
        try {
            await getDoc(fsDoc(clientDb, `schools/${SCHOOL_ID}/users/${adminUser.uid}`));
        } catch (err) {
            denied = true;
            assert.ok(
                String(err.code || '').includes('permission-denied'),
                `Expected permission-denied, got: ${err.code}`
            );
        }
        assert.ok(denied, 'Expected permission-denied when reading another user profile');
    });

    await test('user from school A cannot read data of school B', async () => {
        const { doc: fsDoc, getDoc } = require('firebase/firestore');
        const OTHER_SCHOOL = 'OTHER_SCHOOL_XYZ';
        await adminDb.doc(`schools/${OTHER_SCHOOL}/users/some-user`).set({ name: 'Other User' });

        await signInClientWithPassword(ADMIN_EMAIL, ADMIN_PASS);
        let denied = false;
        try {
            await getDoc(fsDoc(clientDb, `schools/${OTHER_SCHOOL}/users/some-user`));
        } catch (err) {
            denied = true;
            assert.ok(
                String(err.code || '').includes('permission-denied'),
                `Expected permission-denied, got: ${err.code}`
            );
        }
        assert.ok(denied, 'Expected permission-denied for cross-school access');
        await adminDb.doc(`schools/${OTHER_SCHOOL}/users/some-user`).delete();
    });

    // Teardown: delete test users and school data
    await deleteSchoolUser(ADMIN_EMAIL, SCHOOL_ID);
    await deleteSchoolUser(USER_EMAIL, SCHOOL_ID);
    await clearCollection(`schools/${SCHOOL_ID}/users`);
}

async function run() {
    console.log('Firebase Integration Tests');
    console.log(`  Firestore emulator : ${process.env.FIRESTORE_EMULATOR_HOST}`);
    console.log(`  Auth emulator      : ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
    console.log(`  Project            : ${process.env.FIREBASE_PROJECT_ID}`);

    try {
        initClients();

        await testCollections();
        await testSyncLog();
        await testCursorHelpers();
        await testAuthFlows();

        const passed = results.filter((result) => result.passed).length;
        const failed = results.filter((result) => !result.passed).length;

        console.log(`\nResults: ${passed} passed, ${failed} failed`);

        if (failed > 0) {
            console.log('\nFailed tests:');
            for (const result of results.filter((entry) => !entry.passed)) {
                console.log(`  FAIL ${result.name}`);
                console.log(`    ${result.error}`);
            }
            process.exitCode = 1;
        }
    } finally {
        if (clientApp) {
            await deleteApp(clientApp).catch(() => {});
        }
        if (admin.apps.find((app) => app.name === 'integration-test')) {
            await admin.app('integration-test').delete().catch(() => {});
        }
    }
}

run().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
