'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CYCLE_SCOPED_TABLES } = require('../main/sync/entity-registry');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

assert.deepStrictEqual(
    [...CYCLE_SCOPED_TABLES].sort(),
    [
        'absences',
        'correspondence',
        'grades',
        'institution_cycles',
        'student_files',
        'student_movements',
        'student_profile_data',
        'students',
        'support_sessions',
        'teacher_teaching_assignments'
    ],
    'cycle-scoped tables must be derived from requiredColumns metadata'
);

const expectedCycleReads = {
    'main/ipc/students.js': ['students:getAll', 'students:list', 'students:getCodesByYear', 'students:getByCode', 'students:search', 'students:getByStatus'],
    'main/ipc/grades.js': ['grades:getAll', 'grades:list', 'grades:getByStudentCode', 'grades:getZeroStudents'],
    'main/ipc/absences.js': ['absences:getAll', 'absences:getByStudent', 'absences:getByStudentCode', 'absences:getBySection', 'absences:getStats', 'absences:getSummaryByStudent', 'correspondence:getAll', 'correspondence:getByStudent'],
    'main/ipc/cycles.js': ['cycles:list', 'cycles:getActive'],
    'main/ipc/schoolOps.js': ['studentFiles:getByYear', 'studentMovements:getAll', 'studentMovements:getStats'],
    'main/ipc/support-sessions.js': ['supportSessions:list', 'supportSessions:stats', 'supportSessions:export']
};

for (const [file, channels] of Object.entries(expectedCycleReads)) {
    const text = source(file);
    for (const channel of channels) {
        assert.match(text, new RegExp(`handleAuthedRead\\(ipcMain, '${channel}'`), `${channel} must use handleAuthedRead`);
    }
}

console.log('[test] cycle-scoped read contract coverage: all checks passed');
