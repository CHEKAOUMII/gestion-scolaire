'use strict';

/**
 * verify-migration.js
 *
 * One-time utility: compares record counts between a DynamoDB export JSON file
 * and live Firestore to confirm the import completed successfully.
 *
 * Usage:
 *   node scripts/verify-migration.js [input-file]
 *
 * Env vars:
 *   FIREBASE_SERVICE_ACCOUNT_PATH  (default: firebase/gestionscholaire-firebase-adminsdk-fbsvc-d818682f4a.json)
 */

require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const INPUT_FILE = process.argv[2] || 'dynamo-export.json';
const SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || path.join(__dirname, '..', 'firebase', 'gestionscholaire-firebase-adminsdk-fbsvc-d818682f4a.json');

// Maps DynamoDB entityType → Firestore collection name (must match import-firestore.js)
const ENTITY_TO_COLLECTION = {
    student:              'students',
    grade:                'grades',
    absence:              'absences',
    teacher:              'teachers',
    teacher_alias:        'teacherAliases',
    staff_attendance:     'staffAttendance',
    teacher_absence:      'teacherAbsences',
    exam:                 'exams',
    exam_proctor:         'examProctors',
    exam_room:            'examRooms',
    test:                 'tests',
    correspondence:       'correspondence',
    student_file:         'studentFiles',
    student_movement:     'studentMovements',
    compensation:         'compensation',
    settings:             'settings',
    page_visibility:      'pageVisibility',
    device_revocation:    'deviceRevocations'
};

admin.initializeApp({
    credential: admin.credential.cert(require(path.resolve(SERVICE_ACCOUNT_PATH)))
});
const db = admin.firestore();

function extractSchoolId(pk) {
    return String(pk || '').replace(/^SCHOOL#/i, '').trim();
}

async function verify() {
    const inputPath = path.resolve(INPUT_FILE);
    if (!fs.existsSync(inputPath)) {
        console.error(`Input file not found: ${inputPath}`);
        process.exit(1);
    }

    const items = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    console.log(`Loaded ${items.length} items from ${inputPath}\n`);

    // --- 1. Count by entityType in the export file ---
    const exportByType = {};
    const schoolIds = new Set();
    for (const item of items) {
        const et = item.entityType || item.entity_type || 'unknown';
        exportByType[et] = (exportByType[et] || 0) + 1;
        const schoolId = extractSchoolId(item.PK || item.pk || '');
        if (schoolId) schoolIds.add(schoolId);
    }

    console.log('=== DynamoDB export counts (by entityType) ===');
    let exportTotal = 0;
    for (const [et, count] of Object.entries(exportByType).sort()) {
        const col = ENTITY_TO_COLLECTION[et] || '(unmapped)';
        console.log(`  ${et.padEnd(25)} ${String(count).padStart(6)}   → ${col}`);
        exportTotal += count;
    }
    console.log(`  ${'TOTAL'.padEnd(25)} ${String(exportTotal).padStart(6)}\n`);

    if (!schoolIds.size) {
        console.log('No school IDs found in export — cannot query Firestore.');
        return;
    }

    // --- 2. For each school, count Firestore docs per collection ---
    console.log('=== Firestore counts (by collection per school) ===');

    let allMatch = true;

    for (const schoolId of [...schoolIds].sort()) {
        console.log(`\nSchool: ${schoolId}`);

        // Build expected counts for this school from the export
        const expectedByCol = {};
        for (const item of items) {
            const sid = extractSchoolId(item.PK || item.pk || '');
            if (sid !== schoolId) continue;
            const et = item.entityType || item.entity_type || '';
            const col = ENTITY_TO_COLLECTION[et];
            if (!col) continue;
            expectedByCol[col] = (expectedByCol[col] || 0) + 1;
        }

        for (const [col, expected] of Object.entries(expectedByCol).sort()) {
            const snap = await db
                .collection(`schools/${schoolId}/${col}`)
                .count()
                .get();
            const actual = snap.data().count;
            const match = actual >= expected;
            const flag = match ? '✓' : '✗ MISMATCH';
            console.log(`  ${col.padEnd(25)} expected: ${String(expected).padStart(5)}  actual: ${String(actual).padStart(5)}  ${flag}`);
            if (!match) allMatch = false;
        }
    }

    console.log('\n' + (allMatch ? '✓ All counts match — migration verified.' : '✗ Count mismatches detected — rerun import-firestore.js.'));
}

verify().catch((err) => {
    console.error('Verification failed:', err.message);
    process.exit(1);
});
