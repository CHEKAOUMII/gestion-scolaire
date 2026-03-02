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
const { registerPageVisibilityIpc } = require('./pageVisibility');
const { registerNotificationsIpc } = require('./notifications');
const { registerReportsIpc } = require('./reports');

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
    registerPageVisibilityIpc(ipcMain);
    registerNotificationsIpc(ipcMain);
    registerReportsIpc(ipcMain);
}

module.exports = { registerAllIpcHandlers };
