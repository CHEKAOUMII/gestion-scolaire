'use strict';

/**
 * verify-migration.js
 *
 * One-time utility: compares record counts between a DynamoDB export JSON file
 * and live Firestore to confirm the import completed successfully.
 *
 * Usage:
 *   node scripts/verify-migration.js [input-file]
 */

require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const INPUT_FILE = process.argv[2] || 'dynamo-export.json';
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || path.join(__dirname, '..', 'firebase', 'gestionscholaire-firebase-adminsdk-fbsvc-d818682f4a.json');

const ENTITY_TO_COLLECTION = {
    student: 'students',
    grade: 'grades',
    absence: 'absences',
    teacher: 'teachers',
    teacher_alias: 'teacherAliases',
    staff_attendance: 'staffAttendance',
    teacher_absence: 'teacherAbsences',
    exam: 'exams',
    exam_proctor: 'examProctors',
    exam_room: 'examRooms',
    test: 'tests',
    correspondence: 'correspondence',
    student_file: 'studentFiles',
    student_movement: 'studentMovements',
    compensation: 'compensation',
    settings: 'settings',
    page_visibility: 'pageVisibility',
    device_revocation: 'deviceRevocations'
};

admin.initializeApp({
    credential: admin.credential.cert(require(path.resolve(SERVICE_ACCOUNT_PATH)))
});
const db = admin.firestore();

function extractSchoolId(pk) {
    return String(pk || '').replace(/^SCHOOL#/i, '').trim();
}

async function countCollection(pathValue) {
    const snap = await db.collection(pathValue).count().get();
    return snap.data().count;
}

async function verify() {
    const inputPath = path.resolve(INPUT_FILE);
    if (!fs.existsSync(inputPath)) {
        console.error(`Input file not found: ${inputPath}`);
        process.exit(1);
    }

    const items = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    console.log(`Loaded ${items.length} items from ${inputPath}\n`);

    const unmappedEntityTypes = new Set();
    const expectedBySchool = new Map();

    for (const item of items) {
        const schoolId = extractSchoolId(item.PK || item.pk || '');
        const entityType = item.entityType || item.entity_type || 'unknown';
        const collection = ENTITY_TO_COLLECTION[entityType];

        if (!collection) {
            unmappedEntityTypes.add(entityType);
            continue;
        }

        if (!schoolId) {
            continue;
        }

        const schoolCounts = expectedBySchool.get(schoolId) || {
            collections: new Map(),
            syncLogCount: 0
        };
        schoolCounts.collections.set(collection, (schoolCounts.collections.get(collection) || 0) + 1);
        schoolCounts.syncLogCount += 1;
        expectedBySchool.set(schoolId, schoolCounts);
    }

    if (unmappedEntityTypes.size > 0) {
        console.error('Unmapped entity types detected:');
        for (const entityType of [...unmappedEntityTypes].sort()) {
            console.error(`  - ${entityType}`);
        }
        process.exit(1);
    }

    const mismatches = [];

    for (const [schoolId, schoolCounts] of [...expectedBySchool.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`School: ${schoolId}`);

        for (const [collectionName, expected] of [...schoolCounts.collections.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            const actual = await countCollection(`schools/${schoolId}/${collectionName}`);
            const match = actual === expected;
            console.log(
                `  ${collectionName.padEnd(25)} expected: ${String(expected).padStart(5)}  actual: ${String(actual).padStart(5)}  ${match ? 'OK' : 'MISMATCH'}`
            );

            if (!match) {
                mismatches.push({ schoolId, target: collectionName, expected, actual });
            }
        }

        const syncLogActual = await countCollection(`syncLog/${schoolId}/changes`);
        const syncLogExpected = schoolCounts.syncLogCount;
        const syncLogMatch = syncLogActual === syncLogExpected;
        console.log(
            `  ${'syncLog'.padEnd(25)} expected: ${String(syncLogExpected).padStart(5)}  actual: ${String(syncLogActual).padStart(5)}  ${syncLogMatch ? 'OK' : 'MISMATCH'}`
        );

        if (!syncLogMatch) {
            mismatches.push({ schoolId, target: 'syncLog', expected: syncLogExpected, actual: syncLogActual });
        }
    }

    if (mismatches.length > 0) {
        console.error('\nCount mismatches detected:');
        for (const mismatch of mismatches) {
            console.error(
                `  - school=${mismatch.schoolId} target=${mismatch.target} expected=${mismatch.expected} actual=${mismatch.actual}`
            );
        }
        process.exit(1);
    }

    console.log('\nAll collection and syncLog counts match exactly.');
}

verify().catch((err) => {
    console.error('Verification failed:', err.message);
    process.exit(1);
});
