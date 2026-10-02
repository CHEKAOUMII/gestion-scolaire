'use strict';

/** Build Firestore push documents from outbox rows (WP3). */

const {
    getCollectionPath,
    buildDocumentId,
    buildLegacyDocumentId,
    COLLECTION_MAP
} = require('../../firebase/collections');
const { stripSensitiveFields, SENSITIVE_FIELDS } = require('../capture');
const { getEntityType } = require('../authority');
const { computeRowChecksum } = require('../merge');
const { failFirestoreDocBuild, parseLocalIdFromRowSyncId } = require('./helpers');
const { readOutboxAncestorData } = require('./outbox');

const REMOTE_SYNC_METADATA_FIELDS = [
    'version',
    'operation',
    'rowSyncId',
    'deviceHash',
    'schoolYear',
    'updatedAt',
    'ttl'
];

function stripRemoteSyncMetadata(data) {
    const clean = { ...(data || {}) };
    for (const field of REMOTE_SYNC_METADATA_FIELDS) {
        delete clean[field];
    }
    return clean;
}

function resolveStudentCode(db, studentId, schoolYear) {
    if (studentId == null || String(studentId).trim() === '') {
        return null;
    }

    let row = null;
    if (schoolYear) {
        row = db.prepare('SELECT code FROM students WHERE id = ? AND school_year = ?').get(studentId, schoolYear);
    }
    if (!row) {
        row = db.prepare('SELECT code FROM students WHERE id = ?').get(studentId);
    }

    const code = String(row?.code || '').trim();
    return code || null;
}

function resolveStudentId(db, studentCode, schoolYear) {
    const normalizedCode = String(studentCode || '').trim();
    if (!normalizedCode) {
        return null;
    }

    let row = null;
    if (schoolYear) {
        row = db.prepare('SELECT id FROM students WHERE code = ? AND school_year = ?').get(normalizedCode, schoolYear);
    }
    if (!row) {
        row = db.prepare('SELECT id FROM students WHERE code = ? ORDER BY id ASC LIMIT 1').get(normalizedCode);
    }

    return row?.id ?? null;
}

function normalizeSortKeyRowData(entry, rowData) {
    const normalized = { ...(rowData || {}) };
    const localId = parseLocalIdFromRowSyncId(entry.row_sync_id, entry.table_name);

    if (normalized.school_year == null && entry.school_year != null) {
        normalized.school_year = entry.school_year;
    }

    if (localId !== null && normalized.id == null) {
        normalized.id = localId;
    }

    if (entry.table_name === 'page_visibility' && normalized.key == null && normalized.page_key != null) {
        normalized.key = normalized.page_key;
    }

    if (entry.table_name === 'staff_attendance' && normalized.date == null && normalized.attendance_date != null) {
        normalized.date = normalized.attendance_date;
    }

    if (entry.table_name === 'teacher_absences' && normalized.date == null && normalized.absence_date != null) {
        normalized.date = normalized.absence_date;
    }

    if (entry.table_name === 'exam_rooms') {
        if (normalized.room_id == null) {
            normalized.room_id = normalized.id || localId || normalized.room_name || '';
        }
    }

    if (entry.table_name === 'students' && normalized.code == null && localId != null) {
        normalized.code = localId;
    }

    if (entry.table_name === 'settings' && normalized.key == null && localId != null) {
        normalized.key = localId;
    }

    return normalized;
}

function buildFirestoreDoc(db, entry, schoolId, deviceHash) {
    let parsedRowData = {};
    try {
        parsedRowData = entry.row_data ? JSON.parse(entry.row_data) : {};
    } catch (err) {
        return failFirestoreDocBuild(entry, `Failed to parse row_data: ${err.message}`, { code: err.code || null });
    }

    const hasOutboxRowData = Object.keys(parsedRowData).length > 0;
    if (entry.operation === 'DEL' && !hasOutboxRowData) {
        parsedRowData = readOutboxAncestorData(db, entry.row_sync_id) || {};
    }
    const hasDeleteIdentityData = Object.keys(parsedRowData).length > 0;

    const rowData = stripSensitiveFields(parsedRowData) || {};
    const entityType = getEntityType(entry.table_name);
    if (!entityType) {
        return failFirestoreDocBuild(entry, `Unknown entity type for table '${entry.table_name}'`);
    }

    const normalizedData = normalizeSortKeyRowData(entry, rowData);

    if (entry.table_name === 'absences' || entry.table_name === 'grades') {
        if (normalizedData.student_code == null) {
            normalizedData.student_code = resolveStudentCode(db, normalizedData.student_id, normalizedData.school_year);
        }
        delete normalizedData.student_id;
        delete normalizedData.id;
    }

    if (entry.table_name === 'student_files') {
        if (normalizedData.doc_key == null && normalizedData.file_id != null) {
            normalizedData.doc_key = normalizedData.file_id;
        }

        if (normalizedData.student_code == null) {
            normalizedData.student_code = resolveStudentCode(db, normalizedData.student_id, normalizedData.school_year);
        }

        if (!normalizedData.student_code) {
            return failFirestoreDocBuild(entry, 'Failed to resolve student_code for student_files', {
                studentId: normalizedData.student_id || null,
                schoolYear: normalizedData.school_year || null
            });
        }

        delete normalizedData.student_id;
        delete normalizedData.file_id;
        delete normalizedData.id;
    }

    const documentId = buildDocumentId(entry.table_name, normalizedData);
    if (!documentId) {
        if (entry.operation === 'DEL' && !hasOutboxRowData && !hasDeleteIdentityData) {
            entry._syncNoopDelete = true;
            entry._syncBuildError =
                `[sync:push] Skipped no-op delete without local identity data ` +
                `(table=${entry.table_name}, rowSyncId=${entry.row_sync_id || '—'}, outboxId=${entry.id || '—'})`;
            // Benign, expected drain: these DEL entries were never pushed to Firestore,
            // so retiring them is a true no-op. Keep a console breadcrumb but do NOT
            // write to the app error log — otherwise the diagnostics viewer surfaces a
            // routine queue drain as if it were a failure.
            console.debug(entry._syncBuildError);
            return null;
        }
        return failFirestoreDocBuild(entry, `Failed to build document ID for table '${entry.table_name}'`, {
            requiredIdFields: COLLECTION_MAP[entry.table_name]?.idFields || []
        });
    }

    // D1 compatibility: keep legacy student document id for dual-read / dual-delete.
    const legacyDocumentId = buildLegacyDocumentId(entry.table_name, normalizedData);

    const mapping = db.prepare('SELECT version FROM sync_id_map WHERE row_sync_id = ?').get(entry.row_sync_id);
    const currentVersion = Number(mapping?.version || 0);
    const newVersion = currentVersion + 1;
    const updatedAt = Math.floor(Date.now() / 1000);

    return {
        collectionPath: getCollectionPath(schoolId, entry.table_name),
        documentId,
        legacyDocumentId: legacyDocumentId || null,
        entityType,
        entityId: documentId,
        data: normalizedData,
        version: newVersion,
        operation: entry.operation,
        rowSyncId: entry.row_sync_id,
        deviceHash: String(deviceHash || '').substring(0, 16),
        schoolYear: entry.school_year || '',
        updatedAt
    };
}

function buildFirestorePayload(item) {
    return {
        ...item.data,
        version: item.version,
        operation: item.operation,
        rowSyncId: item.rowSyncId,
        deviceHash: item.deviceHash,
        schoolYear: item.schoolYear,
        updatedAt: item.updatedAt
    };
}

function isEquivalentRemoteData(localData, remoteData) {
    const localChecksum = computeRowChecksum(localData || {}, SENSITIVE_FIELDS);
    const remoteChecksum = computeRowChecksum(stripRemoteSyncMetadata(remoteData), SENSITIVE_FIELDS);
    return localChecksum === remoteChecksum;
}

module.exports = {
    REMOTE_SYNC_METADATA_FIELDS,
    resolveStudentCode,
    resolveStudentId,
    normalizeSortKeyRowData,
    buildFirestoreDoc,
    buildFirestorePayload,
    stripRemoteSyncMetadata,
    isEquivalentRemoteData
};
