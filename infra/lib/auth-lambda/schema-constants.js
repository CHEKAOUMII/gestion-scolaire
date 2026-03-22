const ENTITY_SK_PREFIX = {
    student: 'STUDENT',
    grade: 'GRADE',
    absence: 'ABSENCE',
    teacher: 'TEACHER',
    teacher_alias: 'TEACHER_ALIAS',
    staff_attendance: 'STAFF_ATTENDANCE',
    teacher_absence: 'TEACHER_ABSENCE',
    exam: 'EXAM',
    exam_proctor: 'EXAM_PROCTOR',
    exam_room: 'EXAM_ROOM',
    test: 'TEST',
    correspondence: 'CORRESPONDENCE',
    student_file: 'STUDENT_FILE',
    student_movement: 'STUDENT_MOVEMENT',
    compensation: 'COMPENSATION',
    settings: 'SETTINGS',
    page_visibility: 'PAGE_VISIBILITY'
};

const SCHOOL_PK_PREFIX = 'SCHOOL#';
const GSI_NAME = 'SyncGSI';
const TABLE_NAME = 'pencil2-sync';
const OTP_PK_PREFIX = 'OTP#';
const OTP_SK_ACTIVE = 'ACTIVE';

module.exports = {
    ENTITY_SK_PREFIX,
    GSI_NAME,
    OTP_PK_PREFIX,
    OTP_SK_ACTIVE,
    SCHOOL_PK_PREFIX,
    TABLE_NAME
};
