'use strict';

const { handleRead, handleAuthedRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields, validateDate } = require('./validation');
const examsRepo = require('../repos/exams');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');

function registerExamsIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'exams:getAll', ({ db, event }, schoolYear) => {
        return examsRepo.listExams(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event));
    });

    handleWrite(ipcMain, 'exams:save', WRITE_ROLES, (db, event, payload) => {
        requireFields(payload, ['title', 'school_year']);
        requireSchoolYear(payload.school_year);
        if (payload.exam_date) {
            validateDate('exam_date', payload.exam_date);
        }
        return examsRepo.saveExam(db, payload, resolveCycleForRequest(db, event));
    });

    handleWrite(ipcMain, 'exams:delete', WRITE_ROLES, (db, event, id) => {
        return examsRepo.deleteExam(db, id, resolveCycleForRequest(db, event));
    });

    handleAuthedRead(ipcMain, 'examProctors:getAll', ({ db, event }, schoolYear) => {
        return examsRepo.listProctors(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event));
    });

    handleWrite(ipcMain, 'examProctors:saveManual', WRITE_ROLES, (db, event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        if (payload.date) {
            validateDate('date', payload.date);
        }
        return examsRepo.saveProctorManual(db, payload, year, resolveCycleForRequest(db, event));
    });

    handleWrite(ipcMain, 'examProctors:generateRoundRobin', ['admin'], (db, event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.generateProctorsRoundRobin(db, payload, year, resolveCycleForRequest(db, event));
    });

    handleWrite(ipcMain, 'examProctors:bulkImport', WRITE_ROLES, (db, event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.bulkImportProctors(db, payload, year, resolveCycleForRequest(db, event));
    });

    handleWrite(ipcMain, 'examProctors:deleteAll', ['admin'], (db, event, schoolYear) => {
        const year = requireSchoolYear(schoolYear);
        return examsRepo.deleteAllProctors(db, year, resolveCycleForRequest(db, event));
    });

    handleWrite(ipcMain, 'examProctors:delete', WRITE_ROLES, (db, event, id) => {
        return examsRepo.deleteProctor(db, id, resolveCycleForRequest(db, event));
    });

    handleAuthedRead(ipcMain, 'examRooms:getAll', ({ db }, schoolYear) => {
        return examsRepo.listRooms(db, normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'examRooms:save', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.saveRoom(db, payload, year);
    });

    handleWrite(ipcMain, 'examRooms:delete', ['admin'], (db, _event, id) => {
        return examsRepo.deleteRoom(db, id);
    });

    handleAuthedRead(ipcMain, 'tests:getAll', ({ db, event }, schoolYear) => {
        return examsRepo.listTests(db, normalizeYear(schoolYear), resolveCycleForRequest(db, event));
    });

    handleWrite(ipcMain, 'tests:save', WRITE_ROLES, (db, event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        return examsRepo.saveTest(db, payload, year, resolveCycleForRequest(db, event));
    });

    handleWrite(ipcMain, 'tests:delete', WRITE_ROLES, (db, event, id) => {
        return examsRepo.deleteTest(db, id, resolveCycleForRequest(db, event));
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
