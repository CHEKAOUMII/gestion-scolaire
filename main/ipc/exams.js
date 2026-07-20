'use strict';

const { handleRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields, validateDate } = require('./validation');
const examsRepo = require('../repos/exams');

function registerExamsIpc(ipcMain) {
    handleRead(ipcMain, 'exams:getAll', (db, schoolYear) => {
        return examsRepo.listExams(db, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'exams:save', WRITE_ROLES, (db, _event, payload) => {
        requireFields(payload, ['title', 'school_year']);
        requireSchoolYear(payload.school_year);
        if (payload.exam_date) {
            validateDate('exam_date', payload.exam_date);
        }
        return examsRepo.saveExam(db, payload);
    });

    handleWrite(ipcMain, 'exams:delete', WRITE_ROLES, (db, _event, id) => {
        return examsRepo.deleteExam(db, id);
    });

    handleRead(ipcMain, 'examProctors:getAll', (db, schoolYear) => {
        return examsRepo.listProctors(db, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'examProctors:saveManual', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        if (payload.date) {
            validateDate('date', payload.date);
        }
        return examsRepo.saveProctorManual(db, payload, year);
    });

    handleWrite(ipcMain, 'examProctors:generateRoundRobin', ['admin'], (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.generateProctorsRoundRobin(db, payload, year);
    });

    handleWrite(ipcMain, 'examProctors:bulkImport', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.bulkImportProctors(db, payload, year);
    });

    handleWrite(ipcMain, 'examProctors:deleteAll', ['admin'], (db, _event, schoolYear) => {
        return examsRepo.deleteAllProctors(db, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'examProctors:delete', WRITE_ROLES, (db, _event, id) => {
        return examsRepo.deleteProctor(db, id);
    });

    handleRead(ipcMain, 'examRooms:getAll', (db, schoolYear) => {
        return examsRepo.listRooms(db, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'examRooms:save', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.saveRoom(db, payload, year);
    });

    handleWrite(ipcMain, 'examRooms:delete', ['admin'], (db, _event, id) => {
        return examsRepo.deleteRoom(db, id);
    });

    handleRead(ipcMain, 'tests:getAll', (db, schoolYear) => {
        return examsRepo.listTests(db, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'tests:save', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.saveTest(db, payload, year);
    });

    handleWrite(ipcMain, 'tests:delete', WRITE_ROLES, (db, _event, id) => {
        return examsRepo.deleteTest(db, id);
    });

    handleRead(ipcMain, 'examInvitations:getAll', (db, schoolYear) => {
        return examsRepo.listInvitations(db, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'examInvitations:upsert', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.upsertInvitation(db, payload, year);
    });

    handleWrite(ipcMain, 'examInvitations:delete', WRITE_ROLES, (db, _event, id) => {
        return examsRepo.deleteInvitation(db, id);
    });

    handleWrite(ipcMain, 'examInvitations:deleteAll', ['admin'], (db, _event, schoolYear) => {
        return examsRepo.deleteAllInvitations(db, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'examAttendance:getAll', (db, schoolYear) => {
        return examsRepo.listAttendance(db, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'examAttendance:getBySession', (db, schoolYear, sessionKey) => {
        return examsRepo.listAttendanceBySession(db, normalizeYear(schoolYear), sessionKey);
    });

    handleWrite(ipcMain, 'examAttendance:upsert', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.upsertAttendance(db, payload, year);
    });

    handleWrite(ipcMain, 'examAttendance:delete', WRITE_ROLES, (db, _event, id) => {
        return examsRepo.deleteAttendance(db, id);
    });

    handleWrite(ipcMain, 'examAttendance:bulkUpsert', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.bulkUpsertAttendance(db, payload, year);
    });

    handleWrite(ipcMain, 'examAttendance:deleteAll', ['admin'], (db, _event, schoolYear) => {
        return examsRepo.deleteAllAttendance(db, normalizeYear(schoolYear));
    });
}

module.exports = { registerExamsIpc };
