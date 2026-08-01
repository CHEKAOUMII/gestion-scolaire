'use strict';

const { handleRead, handleWrite } = require('./ipc-helpers');
const { getSessionByEvent } = require('./auth');
const subjectCoefficientsRepo = require('../repos/subject-coefficients');

function registerSubjectCoefficientsIpc(ipcMain) {
    handleRead(ipcMain, 'subjectCoefficients:getAll', (db) => ({
        success: true,
        mappings: subjectCoefficientsRepo.readMappings(db)
    }));

    handleWrite(ipcMain, 'subjectCoefficients:override', ['admin'], (db, event, payload) => {
        const session = getSessionByEvent(event);
        const outcome = subjectCoefficientsRepo.overrideMapping(db, payload, session);
        return { success: true, ...outcome };
    });
}

module.exports = { registerSubjectCoefficientsIpc };
