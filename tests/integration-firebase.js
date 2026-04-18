'use strict';

/**
 * Integration test suite for the Firebase sync layer.
 * Runs against the Firebase Emulator Suite and does not touch production.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gestionscholaire';
process.env.FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'emulator-fake-api-key';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

const assert = require('assert');
const { initializeApp, getApps, deleteApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator } = require('firebase/firestore');
const { getAuth, connectAuthEmulator } = require('firebase/auth');
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

function initClients() {
    for (const app of getApps()) {
        deleteApp(app);
    }

    clientApp = initializeApp({
        apiKey: process.env.FIREBASE_API_KEY,
        projectId: process.env.FIREBASE_PROJECT_ID
    });
    clientDb = getFirestore(clientApp);
    const clientAuth = getAuth(clientApp);

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

async function run() {
    console.log('Firebase Integration Tests');
    console.log(`  Firestore emulator : ${process.env.FIRESTORE_EMULATOR_HOST}`);
    console.log(`  Auth emulator      : ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
    console.log(`  Project            : ${process.env.FIREBASE_PROJECT_ID}`);

    initClients();

    await testCollections();
    await testSyncLog();
    await testCursorHelpers();

    const passed = results.filter((result) => result.passed).length;
    const failed = results.filter((result) => !result.passed).length;

    console.log(`\nResults: ${passed} passed, ${failed} failed`);

    if (failed > 0) {
        console.log('\nFailed tests:');
        for (const result of results.filter((entry) => !entry.passed)) {
            console.log(`  FAIL ${result.name}`);
            console.log(`    ${result.error}`);
        }
        process.exit(1);
    }
}

run().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
