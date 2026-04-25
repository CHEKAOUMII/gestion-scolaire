'use strict';

/**
 * import-firestore.js
 *
 * One-time utility: reads a JSON file produced by export-dynamodb.js and
 * writes each record into the correct Firestore collection plus syncLog.
 *
 * Usage:
 *   node scripts/import-firestore.js [input-file]
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

const BATCH_SIZE = 225;
const TTL_SECONDS = 30 * 24 * 60 * 60;

admin.initializeApp({
    credential: admin.credential.cert(require(path.resolve(SERVICE_ACCOUNT_PATH)))
});
const db = admin.firestore();

function extractSchoolId(pk) {
    return String(pk || '').replace(/^SCHOOL#/i, '').trim();
}

function extractDocId(sk) {
    return String(sk || '')
        .replace(/^[A-Z_]+#/i, '')
        .replace(/#/g, '__')
        .trim();
}

function extractKeyParts(sk) {
    return String(sk || '')
        .replace(/^[A-Z_]+#/i, '')
        .split('#')
        .map((part) => String(part || '').trim())
        .filter(Boolean);
}

function normalizeUpdatedAt(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return Math.floor(Date.now() / 1000);
    }

    return numeric > 9999999999 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function sanitizePayload(item) {
    const { PK, SK, pk: _pk, sk: _sk, GSI1PK, GSI1SK, ...data } = item;
    return { ...data };
}

function buildStudentLookup(items) {
    const lookup = new Map();

    for (const item of items) {
        const entityType = item.entityType || item.entity_type || '';
        if (entityType !== 'student') {
            continue;
        }

        const schoolId = extractSchoolId(item.PK || item.pk || '');
        if (!schoolId) {
            continue;
        }

        const data = sanitizePayload(item);
        const code = String(data.code || extractDocId(item.SK || item.sk || '')).trim();
        if (!code) {
            continue;
        }

        const bySchool = lookup.get(schoolId) || new Map();
        const keys = [
            data.id,
            data.student_id,
            data.studentId
        ].filter((value) => value != null && String(value).trim() !== '');

        for (const key of keys) {
            bySchool.set(String(key), code);
        }

        lookup.set(schoolId, bySchool);
    }

    return lookup;
}

function normalizeImportedRecord(item, studentLookup) {
    const pk = item.PK || item.pk || '';
    const sk = item.SK || item.sk || '';
    const schoolId = extractSchoolId(pk);
    const entityType = item.entityType || item.entity_type || '';
    const collection = ENTITY_TO_COLLECTION[entityType];

    if (!schoolId || !collection) {
        return null;
    }

    const data = sanitizePayload(item);
    const keyParts = extractKeyParts(sk);
    const updatedAt = normalizeUpdatedAt(data.updatedAt);
    const version = Number(data.version) || 1;
    const operation = String(data.operation || item.operation || 'PUT').trim() || 'PUT';
    const schoolYear = String(data.schoolYear || data.school_year || '').trim();
    const rowSyncId = String(data.rowSyncId || data.row_sync_id || extractDocId(sk)).trim();
    const deviceHash = String(data.deviceHash || data.device_hash || '').trim().substring(0, 16);

    let docId = extractDocId(sk);
    let entityId = docId;
    let normalizedData = { ...data, updatedAt, version };

    if (entityType === 'student_file') {
        const studentCodeLookup = studentLookup.get(schoolId) || new Map();
        const docKey = String(data.doc_key || data.file_id || keyParts[1] || '').trim();
        const studentCode =
            String(
                data.student_code ||
                data.studentCode ||
                studentCodeLookup.get(String(data.student_id || data.studentId || '')) ||
                keyParts[0] ||
                ''
            ).trim();
        const resolvedSchoolYear = schoolYear || String(keyParts[2] || '').trim();

        if (!studentCode || !docKey || !resolvedSchoolYear) {
            return null;
        }

        normalizedData = {
            ...normalizedData,
            student_code: studentCode,
            doc_key: docKey,
            school_year: resolvedSchoolYear
        };
        delete normalizedData.file_id;
        delete normalizedData.student_id;
        delete normalizedData.studentId;

        docId = `${studentCode}__${docKey}__${resolvedSchoolYear}`;
        entityId = docId;
    }

    const changeId = `migration_${updatedAt}_${entityType}_${docId}`;

    return {
        schoolId,
        entityType,
        collection,
        docId,
        changeId,
        updatedAt,
        entityId,
        operation,
        version,
        rowSyncId,
        schoolYear: String(normalizedData.school_year || normalizedData.schoolYear || schoolYear || '').trim(),
        deviceHash,
        data: normalizedData
    };
}

async function importAll() {
    const inputPath = path.resolve(INPUT_FILE);
    if (!fs.existsSync(inputPath)) {
        console.error(`Input file not found: ${inputPath}`);
        process.exit(1);
    }

    const items = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const studentLookup = buildStudentLookup(items);

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
            const normalized = normalizeImportedRecord(item, studentLookup);
            if (!normalized) {
                skipped++;
                continue;
            }

            const docRef = db.doc(`schools/${normalized.schoolId}/${normalized.collection}/${normalized.docId}`);
            const syncLogRef = db.doc(`syncLog/${normalized.schoolId}/changes/${normalized.changeId}`);

            batch.set(docRef, normalized.data, { merge: true });
            batch.set(syncLogRef, {
                entityType: normalized.entityType,
                entityId: normalized.entityId,
                operation: normalized.operation,
                data: normalized.data,
                version: normalized.version,
                deviceHash: normalized.deviceHash,
                rowSyncId: normalized.rowSyncId,
                schoolYear: normalized.schoolYear,
                updatedAt: normalized.updatedAt,
                ttl: admin.firestore.Timestamp.fromMillis((normalized.updatedAt + TTL_SECONDS) * 1000)
            });
            batchCount++;
        }

        if (batchCount > 0) {
            await batch.commit();
            imported += batchCount;
            batchNumber++;
            console.log(`Batch ${batchNumber}: committed ${batchCount} rows (total imported: ${imported}, skipped: ${skipped})`);
        }
    }

    console.log(`\nDone. Imported: ${imported}  Skipped: ${skipped}`);
}

importAll().catch((err) => {
    console.error('Import failed:', err.message);
    process.exit(1);
});
