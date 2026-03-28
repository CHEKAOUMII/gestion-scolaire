const WRITER_AUTHORITY = {
    students: ['admin', 'developer'],
    correspondence: ['admin', 'developer'],
    student_files: ['admin', 'developer'],
    student_movements: ['admin', 'developer'],
    grades: ['admin', 'developer', 'staff'],
    absences: ['admin', 'developer', 'staff'],
    teachers: ['admin', 'developer'],
    teacher_aliases: ['admin', 'developer'],
    staff_attendance: ['admin', 'developer'],
    compensation_tracking: ['admin', 'developer'],
    teacher_absences: ['admin', 'developer'],
    exams: ['admin', 'developer'],
    exam_proctors: ['admin', 'developer'],
    exam_rooms: ['admin', 'developer'],
    tests: ['admin', 'developer'],
    settings: ['admin', 'developer'],
    page_visibility: ['admin', 'developer'],
    device_revocation: ['admin', 'developer']
};

const ENTITY_TYPE_REGISTRY = {
    students: { entityType: 'student', skPrefix: 'STUDENT', keyFields: ['code'] },
    grades: {
        entityType: 'grade',
        skPrefix: 'GRADE',
        keyFields: ['student_code', 'subject', 'semester', 'school_year']
    },
    absences: {
        entityType: 'absence',
        skPrefix: 'ABSENCE',
        keyFields: ['student_code', 'month', 'school_year', 'absence_type']
    },
    teachers: { entityType: 'teacher', skPrefix: 'TEACHER', keyFields: ['id'] },
    teacher_aliases: { entityType: 'teacher_alias', skPrefix: 'TEACHER_ALIAS', keyFields: ['id'] },
    staff_attendance: {
        entityType: 'staff_attendance',
        skPrefix: 'STAFF_ATTENDANCE',
        keyFields: ['teacher_id', 'date']
    },
    teacher_absences: {
        entityType: 'teacher_absence',
        skPrefix: 'TEACHER_ABSENCE',
        keyFields: ['teacher_id', 'date']
    },
    exams: { entityType: 'exam', skPrefix: 'EXAM', keyFields: ['id'] },
    exam_proctors: {
        entityType: 'exam_proctor',
        skPrefix: 'EXAM_PROCTOR',
        keyFields: ['exam_id', 'teacher_id']
    },
    exam_rooms: { entityType: 'exam_room', skPrefix: 'EXAM_ROOM', keyFields: ['exam_id', 'room_id'] },
    tests: { entityType: 'test', skPrefix: 'TEST', keyFields: ['id'] },
    correspondence: { entityType: 'correspondence', skPrefix: 'CORRESPONDENCE', keyFields: ['id'] },
    student_files: { entityType: 'student_file', skPrefix: 'STUDENT_FILE', keyFields: ['student_code', 'id'] },
    student_movements: { entityType: 'student_movement', skPrefix: 'STUDENT_MOVEMENT', keyFields: ['id'] },
    compensation_tracking: { entityType: 'compensation', skPrefix: 'COMPENSATION', keyFields: ['id'] },
    settings: { entityType: 'settings', skPrefix: 'SETTINGS', keyFields: ['key'] },
    page_visibility: { entityType: 'page_visibility', skPrefix: 'PAGE_VISIBILITY', keyFields: ['key'] },
    device_revocation: { entityType: 'device_revocation', skPrefix: 'REVOCATION', keyFields: ['revokedDeviceHash'] }
};

function canPush(tableName, role) {
    if (!WRITER_AUTHORITY[tableName]) return false;
    if (!role) return false;
    return WRITER_AUTHORITY[tableName].includes(role);
}

function getAuthorizedTables(role) {
    if (!role) return [];
    return Object.entries(WRITER_AUTHORITY)
        .filter(([, roles]) => roles.includes(role))
        .map(([table]) => table);
}

function buildSortKey(tableName, rowData) {
    const entry = ENTITY_TYPE_REGISTRY[tableName];
    if (!entry) return null;
    const values = entry.keyFields.map((field) => rowData?.[field] ?? '');
    return `${entry.skPrefix}#${values.join('#')}`;
}

function getEntityType(tableName) {
    return ENTITY_TYPE_REGISTRY[tableName]?.entityType || null;
}

module.exports = {
    WRITER_AUTHORITY,
    ENTITY_TYPE_REGISTRY,
    canPush,
    getAuthorizedTables,
    buildSortKey,
    getEntityType
};
