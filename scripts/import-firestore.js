'use strict';

/**
 * import-firestore.js
 *
 * One-time utility: reads a JSON file produced by export-dynamodb.js and
 * writes each record into the correct Firestore collection.
 *
 * Document path: schools/{schoolId}/{collection}/{docId}
 *   - schoolId  extracted from DynamoDB PK  ("SCHOOL#<schoolId>" → "<schoolId>")
 *   - collection and docId come from ENTITY_TO_COLLECTION + extractDocId()
 *
 * Usage:
 *   node scripts/import-firestore.js [input-file]
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

// Maps DynamoDB entityType values → Firestore collection names under schools/{schoolId}/
// Must stay in sync with main/firebase/collections.js COLLECTION_MAP
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

// Firestore batch limit
const BATCH_SIZE = 450;

admin.initializeApp({
    credential: admin.credential.cert(require(path.resolve(SERVICE_ACCOUNT_PATH)))
});
const db = admin.firestore();

function extractSchoolId(pk) {
    // PK format in DynamoDB: "SCHOOL#<schoolId>"
    return String(pk || '').replace(/^SCHOOL#/i, '').trim();
}

function extractDocId(sk) {
    // SK format: "ENTITY_TYPE#field1#field2#..."
    // Strip the leading "TYPE#" prefix, then replace remaining "#" with "__"
    return String(sk || '')
        .replace(/^[A-Z_]+#/i, '')
        .replace(/#/g, '__')
        .trim();
}

async function importAll() {
    const inputPath = path.resolve(INPUT_FILE);
    if (!fs.existsSync(inputPath)) {
        console.error(`Input file not found: ${inputPath}`);
        process.exit(1);
    }

    const items = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    console.log(`Read ${items.length} items from ${inputPath}`);
    console.log(`Using service account: ${SERVICE_ACCOUNT_PATH}\n`);

    let imported = 0;
    let skipped = 0;
    let batchNumber = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const slice = items.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        let batchCount = 0;

        for (const item of slice) {
            const pk = item.PK || item.pk || '';
            const sk = item.SK || item.sk || '';
            const schoolId = extractSchoolId(pk);
            const entityType = item.entityType || item.entity_type || '';
            const collection = ENTITY_TO_COLLECTION[entityType];

            if (!schoolId || !collection) {
                skipped++;
                continue;
            }

            const docId = extractDocId(sk);
            if (!docId) {
                skipped++;
                continue;
            }

            const docRef = db.doc(`schools/${schoolId}/${collection}/${docId}`);

            // Strip DynamoDB-specific metadata fields; keep application data
            const { PK, SK, pk: _pk, sk: _sk, GSI1PK, GSI1SK, ...data } = item;

            batch.set(
                docRef,
                {
                    ...data,
                    updatedAt: data.updatedAt || Date.now(),
                    version: Number(data.version) || 1
                },
                { merge: true }
            );
            batchCount++;
        }

        if (batchCount > 0) {
            await batch.commit();
            imported += batchCount;
            batchNumber++;
            console.log(`Batch ${batchNumber}: committed ${batchCount} docs (total imported: ${imported}, skipped: ${skipped})`);
        }
    }

    console.log(`\nDone. Imported: ${imported}  Skipped: ${skipped}`);
}

importAll().catch((err) => {
    console.error('Import failed:', err.message);
    process.exit(1);
});
