const { registerStudentsIpc } = require('./students');
const { registerAbsencesIpc } = require('./absences');
const { registerAuthIpc } = require('./auth');
const { registerSchoolOpsIpc } = require('./schoolOps');
const { registerStaffIpc } = require('./staff');
const { registerExamsIpc } = require('./exams');
const { registerSystemIpc } = require('./system');
const { registerLicensingIpc } = require('./licensing');
const { registerOwnerTelemetryIpc } = require('./ownerTelemetry');
const { registerUpdaterIpc } = require('./updater');

function registerAllIpcHandlers(ipcMain) {
    registerAuthIpc(ipcMain);
    registerStudentsIpc(ipcMain);
    registerAbsencesIpc(ipcMain);
    registerSchoolOpsIpc(ipcMain);
    registerStaffIpc(ipcMain);
    registerExamsIpc(ipcMain);
    registerSystemIpc(ipcMain);
    registerLicensingIpc(ipcMain);
    registerOwnerTelemetryIpc(ipcMain);
    registerUpdaterIpc(ipcMain);
}

module.exports = { registerAllIpcHandlers };
