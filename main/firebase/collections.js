'use strict';

const SCHOOLS_COLLECTION = 'schools';
const SCHOOL_META_COLLECTION = 'meta';
const SCHOOL_INSTITUTION_META_DOC = 'institution';
const SCHOOL_USERS_COLLECTION = 'users';
const SCHOOL_USER_INVITES_COLLECTION = 'userInvites';
const SYNC_LOG_COLLECTION = 'syncLog';
const SYNC_LOG_CHANGES_COLLECTION = 'changes';
const OTP_CODES_COLLECTION = 'otpCodes';

// Composite Firestore document IDs use "__" instead of DynamoDB sort-key "#".
const COLLECTION_MAP = {
    students: { collection: 'students', idFields: ['code'] },
    grades: { collection: 'grades', idFields: ['student_code', 'subject', 'semester', 'school_year'] },
    absences: { collection: 'absences', idFields: ['student_code', 'month', 'school_year', 'absence_type'] },
    teachers: { collection: 'teachers', idFields: ['id'] },
    teacher_aliases: { collection: 'teacherAliases', idFields: ['id'] },
    staff_attendance: { collection: 'staffAttendance', idFields: ['teacher_id', 'date'] },
    teacher_absences: { collection: 'teacherAbsences', idFields: ['teacher_id', 'date'] },
    exams: { collection: 'exams', idFields: ['id'] },
    exam_proctors: { collection: 'examProctors', idFields: ['exam_id', 'teacher_id'] },
    exam_rooms: { collection: 'examRooms', idFields: ['exam_id', 'room_id'] },
    tests: { collection: 'tests', idFields: ['id'] },
    correspondence: { collection: 'correspondence', idFields: ['id'] },
    student_files: { collection: 'studentFiles', idFields: ['student_code', 'doc_key', 'school_year'] },
    student_movements: { collection: 'studentMovements', idFields: ['id'] },
    support_sessions: { collection: 'supportSessions', idFields: ['id'] },
    compensation_tracking: { collection: 'compensation', idFields: ['id'] },
    settings: { collection: 'settings', idFields: ['key'] },
    page_visibility: { collection: 'pageVisibility', idFields: ['page_key'] },
    device_revocation: { collection: 'deviceRevocations', idFields: ['revokedDeviceHash'] },
    system_tags: { collection: 'systemTags', idFields: ['id'] }
};

function sanitizeDocumentIdPart(value) {
    return encodeURIComponent(String(value).trim()).replace(/\./g, '%2E');
}

function getCollectionName(tableName) {
    return COLLECTION_MAP[tableName]?.collection || null;
}

function getCollectionPath(schoolId, tableName) {
    const collectionName = getCollectionName(tableName);
    if (!schoolId || !collectionName) {
        return null;
    }
    return `${SCHOOLS_COLLECTION}/${schoolId}/${collectionName}`;
}

function buildDocumentId(tableName, rowData) {
    const entry = COLLECTION_MAP[tableName];
    if (!entry) {
        return null;
    }

    const parts = [];
    for (const field of entry.idFields) {
        const value = rowData?.[field];
        if (value === undefined || value === null || String(value).trim() === '') {
            return null;
        }
        parts.push(sanitizeDocumentIdPart(value));
    }

    return parts.join('__');
}

function getSyncLogPath(schoolId) {
    if (!schoolId) {
        return null;
    }
    return `${SYNC_LOG_COLLECTION}/${schoolId}/${SYNC_LOG_CHANGES_COLLECTION}`;
}

function getSchoolMetaPath(schoolId) {
    if (!schoolId) {
        return null;
    }
    return `${SCHOOLS_COLLECTION}/${schoolId}/${SCHOOL_META_COLLECTION}`;
}

function getSchoolInstitutionMetaPath(schoolId) {
    if (!schoolId) {
        return null;
    }
    return `${getSchoolMetaPath(schoolId)}/${SCHOOL_INSTITUTION_META_DOC}`;
}

function getSchoolUsersPath(schoolId) {
    if (!schoolId) {
        return null;
    }
    return `${SCHOOLS_COLLECTION}/${schoolId}/${SCHOOL_USERS_COLLECTION}`;
}

function getSchoolUserPath(schoolId, uid) {
    if (!schoolId || !uid) {
        return null;
    }
    return `${getSchoolUsersPath(schoolId)}/${uid}`;
}

function getSchoolInvitesPath(schoolId) {
    if (!schoolId) {
        return null;
    }
    return `${SCHOOLS_COLLECTION}/${schoolId}/${SCHOOL_USER_INVITES_COLLECTION}`;
}

function getSchoolInvitePath(schoolId, inviteId) {
    if (!schoolId || !inviteId) {
        return null;
    }
    return `${getSchoolInvitesPath(schoolId)}/${inviteId}`;
}

module.exports = {
    SCHOOLS_COLLECTION,
    SCHOOL_META_COLLECTION,
    SCHOOL_INSTITUTION_META_DOC,
    SCHOOL_USERS_COLLECTION,
    SCHOOL_USER_INVITES_COLLECTION,
    SYNC_LOG_COLLECTION,
    SYNC_LOG_CHANGES_COLLECTION,
    OTP_CODES_COLLECTION,
    COLLECTION_MAP,
    sanitizeDocumentIdPart,
    getCollectionName,
    getCollectionPath,
    buildDocumentId,
    getSyncLogPath,
    getSchoolMetaPath,
    getSchoolInstitutionMetaPath,
    getSchoolUsersPath,
    getSchoolUserPath,
    getSchoolInvitesPath,
    getSchoolInvitePath
};
