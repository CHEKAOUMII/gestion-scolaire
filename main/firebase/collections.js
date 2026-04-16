'use strict';

/**
 * Firestore collection path constants and document ID builders.
 * Replaces DynamoDB sort-key construction from authority.js.
 *
 * Convention: composite document IDs use '__' as separator
 * (replacing '#' from DynamoDB sort keys, minus the entity type prefix).
 */

const COLLECTION_MAP = {
    students:              { collection: 'students',           idFields: ['code'] },
    grades:                { collection: 'grades',             idFields: ['student_code', 'subject', 'semester', 'school_year'] },
    absences:              { collection: 'absences',           idFields: ['student_code', 'month', 'school_year', 'absence_type'] },
    teachers:              { collection: 'teachers',           idFields: ['id'] },
    teacher_aliases:       { collection: 'teacherAliases',     idFields: ['id'] },
    staff_attendance:      { collection: 'staffAttendance',    idFields: ['teacher_id', 'date'] },
    teacher_absences:      { collection: 'teacherAbsences',    idFields: ['teacher_id', 'date'] },
    exams:                 { collection: 'exams',              idFields: ['id'] },
    exam_proctors:         { collection: 'examProctors',       idFields: ['exam_id', 'teacher_id'] },
    exam_rooms:            { collection: 'examRooms',          idFields: ['exam_id', 'room_id'] },
    tests:                 { collection: 'tests',              idFields: ['id'] },
    correspondence:        { collection: 'correspondence',     idFields: ['id'] },
    student_files:         { collection: 'studentFiles',       idFields: ['student_code', 'file_id'] },
    student_movements:     { collection: 'studentMovements',   idFields: ['id'] },
    compensation_tracking: { collection: 'compensation',       idFields: ['id'] },
    settings:              { collection: 'settings',           idFields: ['key'] },
    page_visibility:       { collection: 'pageVisibility',     idFields: ['page_key'] },
    device_revocation:     { collection: 'deviceRevocations',  idFields: ['revokedDeviceHash'] }
};

const SCHOOL_PREFIX = 'schools';

function getCollectionPath(schoolId, tableName) {
    const mapping = COLLECTION_MAP[tableName];
    if (!mapping) return null;
    return `${SCHOOL_PREFIX}/${schoolId}/${mapping.collection}`;
}

function buildDocumentId(tableName, rowData) {
    const mapping = COLLECTION_MAP[tableName];
    if (!mapping) return null;

    const parts = [];
    for (const field of mapping.idFields) {
        const value = rowData[field];
        if (value == null || String(value).trim() === '') return null;
        parts.push(String(value).trim());
    }

    return parts.join('__');
}

function getCollectionName(tableName) {
    const mapping = COLLECTION_MAP[tableName];
    return mapping ? mapping.collection : null;
}

module.exports = {
    COLLECTION_MAP,
    SCHOOL_PREFIX,
    getCollectionPath,
    buildDocumentId,
    getCollectionName
};
