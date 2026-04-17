'use strict';

/**
 * tests/integration-firebase.js
 *
 * Integration test suite for the Firebase sync layer.
 * Runs against the Firebase Emulator Suite — does NOT touch production.
 *
 * Prerequisites (run once before this test):
 *   npm install -g firebase-tools
 *   cd firebase && firebase emulators:start --only firestore,auth
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *   FIREBASE_PROJECT_ID=gestionscholaire \
 *   node tests/integration-firebase.js
 *
 * Each test is independent and self-contained.
 * A PASS/FAIL summary is printed at the end; process exits 1 if any test failed.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gestionscholaire';
process.env.FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'emulator-fake-api-key';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

const assert = require('assert');

// --- Firebase client SDK (used by application code) ---
const { initializeApp, getApps, deleteApp } = require('firebase/app');
const {
    getFirestore,
    connectFirestoreEmulator,
    doc, setDoc, getDoc, collection, getDocs,
    query, where, orderBy, limit,
    writeBatch, deleteDoc,
    Timestamp
} = require('firebase/firestore');
const { getAuth, connectAuthEmulator } = require('firebase/auth');

// --- Firebase admin SDK (used to seed data without auth) ---
const admin = require('firebase-admin');

// --- Application modules under test ---
const { logChange, logChangeBatch, pullChanges } = require('../main/firebase/sync-log');
const { buildDocumentId, getCollectionPath, COLLECTION_MAP } = require('../main/firebase/collections');

// ─────────────────────────────────────────────────────────────────────────────
// Test harness
// ─────────────────────────────────────────────────────────────────────────────

const results = [];

async function test(name, fn) {
    try {
        await fn();
        results.push({ name, passed: true });
        console.log(`  ✓ ${name}`);
    } catch (err) {
        results.push({ name, passed: false, error: err.message });
        console.error(`  ✗ ${name}`);
        console.error(`      ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Firebase instances
// ─────────────────────────────────────────────────────────────────────────────

let clientApp, clientDb;
let adminApp, adminDb;

function initClients() {
    // Tear down any existing apps to get a clean state
    for (const app of getApps()) deleteApp(app);

    clientApp = initializeApp({
        apiKey: process.env.FIREBASE_API_KEY,
        projectId: process.env.FIREBASE_PROJECT_ID
    });
    clientDb = getFirestore(clientApp);
    const clientAuth = getAuth(clientApp);

    const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080').split(':');
    connectFirestoreEmulator(clientDb, fsHost, parseInt(fsPort, 10));
    connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099'}`, { disableWarnings: true });

    if (!admin.apps.length) {
        adminApp = admin.initializeApp({
            projectId: process.env.FIREBASE_PROJECT_ID
        }, 'integration-test');
    } else {
        adminApp = admin.apps.find(a => a.name === 'integration-test') || admin.apps[0];
    }
    adminDb = adminApp.firestore();
    // Point admin SDK at emulator
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
}

async function clearCollection(colPath) {
    const snap = await adminDb.collection(colPath).get();
    const batch = adminDb.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
}

// ─────────────────────────────────────────────────────────────────────────────
// Test groups
// ─────────────────────────────────────────────────────────────────────────────

async function testCollections() {
    console.log('\n[collections.js]');

    await test('buildDocumentId — single id field (students)', () => {
        const id = buildDocumentId('students', { code: 'S12345' });
        assert.strictEqual(id, 'S12345');
    });

    await test('buildDocumentId — composite id (grades)', () => {
        const id = buildDocumentId('grades', {
            student_code: 'S123',
            subject: 'Math',
            semester: 'S1',
            school_year: '2025/2026'
        });
        assert.strictEqual(id, 'S123__Math__S1__2025/2026');
    });

    await test('buildDocumentId — returns null when required field missing', () => {
        const id = buildDocumentId('grades', {
            student_code: 'S123',
            subject: '',     // empty
            semester: 'S1',
            school_year: '2025/2026'
        });
        assert.strictEqual(id, null);
    });

    await test('getCollectionPath — known table', () => {
        const path = getCollectionPath('SCHOOL01', 'teachers');
        assert.strictEqual(path, 'schools/SCHOOL01/teachers');
    });

    await test('getCollectionPath — unknown table returns null', () => {
        const path = getCollectionPath('SCHOOL01', 'nonexistent_table');
        assert.strictEqual(path, null);
    });

    await test('COLLECTION_MAP covers all 18 expected tables', () => {
        const expected = [
            'students', 'grades', 'absences', 'teachers', 'teacher_aliases',
            'staff_attendance', 'teacher_absences', 'exams', 'exam_proctors',
            'exam_rooms', 'tests', 'correspondence', 'student_files',
            'student_movements', 'compensation_tracking', 'settings',
            'page_visibility', 'device_revocation'
        ];
        for (const t of expected) {
            assert.ok(COLLECTION_MAP[t], `Missing table in COLLECTION_MAP: ${t}`);
        }
    });
}

async function testSyncLog() {
    console.log('\n[sync-log.js — against emulator]');

    const schoolId = 'TEST_SCHOOL_SYNCLOG';
    const changesPath = `syncLog/${schoolId}/changes`;

    // Clean up before tests
    await clearCollection(changesPath);

    await test('logChange — writes a document to syncLog/{schoolId}/changes', async () => {
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
        assert.ok(changeId, 'changeId should be truthy');
        assert.ok(changeId.includes('student'), 'changeId should contain entityType');

        const docSnap = await adminDb.doc(`${changesPath}/${changeId}`).get();
        assert.ok(docSnap.exists, 'document should exist in Firestore');
        assert.strictEqual(docSnap.data().entityType, 'student');
        assert.strictEqual(docSnap.data().operation, 'PUT');
    });

    await test('logChangeBatch — writes multiple entries atomically', async () => {
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

        const snap = await adminDb.collection(changesPath).get();
        // At least the 2 new + 1 from previous test
        assert.ok(snap.size >= 3, `Expected at least 3 docs, got ${snap.size}`);
    });

    await test('pullChanges — returns entries with updatedAt > cursor, ordered ascending', async () => {
        // Seed two entries with known timestamps via admin SDK
        const schoolId2 = 'TEST_SCHOOL_PULL';
        await clearCollection(`syncLog/${schoolId2}/changes`);

        const t1 = 1000000;
        const t2 = 1000005;
        const t3 = 1000010;

        await adminDb.doc(`syncLog/${schoolId2}/changes/c1`).set({ updatedAt: t1, entityType: 'student', operation: 'PUT' });
        await adminDb.doc(`syncLog/${schoolId2}/changes/c2`).set({ updatedAt: t2, entityType: 'grade',   operation: 'PUT' });
        await adminDb.doc(`syncLog/${schoolId2}/changes/c3`).set({ updatedAt: t3, entityType: 'absence', operation: 'PUT' });

        // Pull with cursor = t1 — should return only c2 and c3
        const results = await pullChanges(clientDb, schoolId2, t1);
        assert.strictEqual(results.length, 2, `Expected 2 results, got ${results.length}`);
        assert.strictEqual(results[0].entityType, 'grade');
        assert.strictEqual(results[1].entityType, 'absence');
    });

    await test('pullChanges — returns empty array when nothing is newer than cursor', async () => {
        const schoolId3 = 'TEST_SCHOOL_EMPTY';
        await clearCollection(`syncLog/${schoolId3}/changes`);
        await adminDb.doc(`syncLog/${schoolId3}/changes/old`).set({ updatedAt: 500, entityType: 'student', operation: 'PUT' });

        const results = await pullChanges(clientDb, schoolId3, 1000);
        assert.strictEqual(results.length, 0);
    });

    await test('pullChanges — respects maxResults limit', async () => {
        const schoolId4 = 'TEST_SCHOOL_LIMIT';
        await clearCollection(`syncLog/${schoolId4}/changes`);

        const batch = adminDb.batch();
        for (let i = 1; i <= 10; i++) {
            batch.set(
                adminDb.doc(`syncLog/${schoolId4}/changes/c${i}`),
                { updatedAt: 2000000 + i, entityType: 'student', operation: 'PUT' }
            );
        }
        await batch.commit();

        const results = await pullChanges(clientDb, schoolId4, 2000000, 3);
        assert.strictEqual(results.length, 3, `Expected 3 (limit), got ${results.length}`);
    });
}

async function testFirestoreWrite() {
    console.log('\n[Firestore write — document path convention]');

    const schoolId = 'TEST_SCHOOL_WRITE';

    await test('Can write and read a student document at correct path', async () => {
        const docId = buildDocumentId('students', { code: 'S999' });
        const colPath = getCollectionPath(schoolId, 'students');
        const docRef = adminDb.doc(`${colPath}/${docId}`);

        await docRef.set({
            code: 'S999',
            full_name: 'Test Student',
            school_year: '2025/2026',
            updatedAt: Date.now(),
            version: 1
        });

        const snap = await docRef.get();
        assert.ok(snap.exists, 'Document should exist');
        assert.strictEqual(snap.data().code, 'S999');
        assert.strictEqual(snap.data().full_name, 'Test Student');
    });

    await test('Can write a grade document with composite ID', async () => {
        const rowData = {
            student_code: 'S999',
            subject: 'Arabic',
            semester: 'S1',
            school_year: '2025/2026'
        };
        const docId = buildDocumentId('grades', rowData);
        const colPath = getCollectionPath(schoolId, 'grades');

        assert.strictEqual(docId, 'S999__Arabic__S1__2025/2026');

        const docRef = adminDb.doc(`${colPath}/${docId}`);
        await docRef.set({ ...rowData, score: 16, updatedAt: Date.now(), version: 1 });

        const snap = await docRef.get();
        assert.ok(snap.exists);
        assert.strictEqual(snap.data().score, 16);
    });

    await test('writeBatch respects 500-document limit (writes 450 docs)', async () => {
        const batch = adminDb.batch();
        for (let i = 0; i < 450; i++) {
            const ref = adminDb.doc(`schools/${schoolId}/students/bulk_${i}`);
            batch.set(ref, { code: `bulk_${i}`, updatedAt: Date.now(), version: 1 });
        }
        // Should not throw
        await batch.commit();

        const snap = await adminDb.collection(`schools/${schoolId}/students`).count().get();
        assert.ok(snap.data().count >= 450, 'Expected at least 450 student docs');
    });

    await test('version-check write: setDoc with { merge: true } preserves existing fields', async () => {
        const ref = adminDb.doc(`schools/${schoolId}/settings/app_settings`);
        await ref.set({ key: 'app_settings', theme: 'light', version: 1, updatedAt: 1000 });

        // Simulate a version-check update (only updates allowed fields, preserves rest)
        await ref.set({ version: 2, updatedAt: 2000, language: 'ar' }, { merge: true });

        const snap = await ref.get();
        assert.strictEqual(snap.data().theme, 'light',  'theme should be preserved');
        assert.strictEqual(snap.data().version, 2,      'version should be updated');
        assert.strictEqual(snap.data().language, 'ar',  'language should be added');
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main runner
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
    console.log('Firebase Integration Tests');
    console.log(`  Firestore emulator : ${process.env.FIRESTORE_EMULATOR_HOST}`);
    console.log(`  Auth emulator      : ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
    console.log(`  Project            : ${process.env.FIREBASE_PROJECT_ID}`);

    try {
        initClients();
    } catch (err) {
        console.error('\n[FATAL] Could not init Firebase clients:', err.message);
        console.error('Make sure the emulator is running:');
        console.error('  cd firebase && firebase emulators:start --only firestore,auth');
        process.exit(1);
    }

    await testCollections();
    await testSyncLog();
    await testFirestoreWrite();

    // Summary
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);

    if (failed > 0) {
        console.log('\nFailed tests:');
        results.filter(r => !r.passed).forEach(r => {
            console.log(`  ✗ ${r.name}`);
            console.log(`      ${r.error}`);
        });
        process.exit(1);
    } else {
        console.log('All integration tests passed.');
    }
}

run().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
