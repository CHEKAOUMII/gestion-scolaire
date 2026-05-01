'use strict';

const { buildDocumentId: buildDocId } = require('../firebase/collections');

const ALL_WRITERS = [
    'admin', 'principal', 'supervisor', 'teacher', 'staff',
    'external-guardian', 'internal-guardian', 'admin-assistant',
    'educational-specialist', 'social-specialist'
];

const WRITER_AUTHORITY = {
    students:              ALL_WRITERS,
    grades:                ALL_WRITERS,
    absences:              ALL_WRITERS,
    teachers:              ALL_WRITERS,
    teacher_aliases:       ALL_WRITERS,
    staff_attendance:      ALL_WRITERS,
    teacher_absences:      ALL_WRITERS,
    exams:                 ALL_WRITERS,
    exam_proctors:         ALL_WRITERS,
    exam_rooms:            ALL_WRITERS,
    tests:                 ALL_WRITERS,
    correspondence:        ALL_WRITERS,
    student_files:         ALL_WRITERS,
    student_movements:     ALL_WRITERS,
    support_sessions:      ALL_WRITERS,
    compensation_tracking: ALL_WRITERS,
    settings:              ALL_WRITERS,
    page_visibility:       ALL_WRITERS,
    system_tags:           ALL_WRITERS
};

const ENTITY_TYPE_REGISTRY = {
    students:              { entityType: 'student' },
    grades:                { entityType: 'grade' },
    absences:              { entityType: 'absence' },
    teachers:              { entityType: 'teacher' },
    teacher_aliases:       { entityType: 'teacher_alias' },
    staff_attendance:      { entityType: 'staff_attendance' },
    teacher_absences:      { entityType: 'teacher_absence' },
    exams:                 { entityType: 'exam' },
    exam_proctors:         { entityType: 'exam_proctor' },
    exam_rooms:            { entityType: 'exam_room' },
    tests:                 { entityType: 'test' },
    correspondence:        { entityType: 'correspondence' },
    student_files:         { entityType: 'student_file' },
    student_movements:     { entityType: 'student_movement' },
    support_sessions:      { entityType: 'support_session' },
    compensation_tracking: { entityType: 'compensation' },
    settings:              { entityType: 'settings' },
    page_visibility:       { entityType: 'page_visibility' },
    system_tags:           { entityType: 'system_tag' }
};

function canPush(tableName, role) {
    const allowed = WRITER_AUTHORITY[tableName];
    return allowed ? allowed.includes(role) : false;
}

function getAuthorizedTables(role) {
    return Object.keys(WRITER_AUTHORITY).filter((t) => WRITER_AUTHORITY[t].includes(role));
}

function buildDocumentId(tableName, rowData) {
    return buildDocId(tableName, rowData);
}

function getEntityType(tableName) {
    return ENTITY_TYPE_REGISTRY[tableName]?.entityType || null;
}

module.exports = {
    WRITER_AUTHORITY,
    ENTITY_TYPE_REGISTRY,
    canPush,
    getAuthorizedTables,
    buildDocumentId,
    getEntityType
};
