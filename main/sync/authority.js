'use strict';

const { buildDocumentId: buildDocId } = require('../firebase/collections');

const WRITER_AUTHORITY = {
    students:              ['admin', 'principal'],
    grades:                ['admin', 'principal', 'staff'],
    absences:              ['admin', 'principal', 'staff'],
    teachers:              ['admin', 'principal'],
    teacher_aliases:       ['admin', 'principal'],
    staff_attendance:      ['admin', 'principal'],
    teacher_absences:      ['admin', 'principal'],
    exams:                 ['admin', 'principal'],
    exam_proctors:         ['admin', 'principal'],
    exam_rooms:            ['admin', 'principal'],
    tests:                 ['admin', 'principal'],
    correspondence:        ['admin', 'principal'],
    student_files:         ['admin', 'principal'],
    student_movements:     ['admin', 'principal'],
    compensation_tracking: ['admin', 'principal'],
    settings:              ['admin', 'principal'],
    page_visibility:       ['admin', 'principal'],
    device_revocation:     ['admin', 'principal']
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
    compensation_tracking: { entityType: 'compensation' },
    settings:              { entityType: 'settings' },
    page_visibility:       { entityType: 'page_visibility' },
    device_revocation:     { entityType: 'device_revocation' }
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
