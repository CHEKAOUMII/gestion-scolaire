const { registerStudentsIpc } = require('./students');
const { registerAbsencesIpc } = require('./absences');
const { registerAuthIpc } = require('./auth');
const { registerSchoolOpsIpc } = require('./schoolOps');
const { registerStaffIpc } = require('./staff');
const { registerStaffAttendanceIpc } = require('./staffAttendance');
const { registerExamsIpc } = require('./exams');
const { registerSystemIpc } = require('./system');
const { registerLicensingIpc } = require('./licensing');
const { registerOwnerTelemetryIpc } = require('./ownerTelemetry');
const { registerUpdaterIpc } = require('./updater');
const { registerPageVisibilityIpc } = require('./pageVisibility');
const { registerNotificationsIpc } = require('./notifications');
const { registerReportsIpc } = require('./reports');
const { registerInstitutionIpc } = require('./institution');
const { registerSyncIpc } = require('./sync');
const { registerTimetableDataIpc } = require('./timetable-data');
const { registerInspectorsIpc } = require('./inspectors');
const { startOutboxCleanup } = require('../sync/capture');

function registerAllIpcHandlers(ipcMain) {
    registerAuthIpc(ipcMain);
    registerStudentsIpc(ipcMain);
    registerAbsencesIpc(ipcMain);
    registerSchoolOpsIpc(ipcMain);
    registerStaffIpc(ipcMain);
    registerStaffAttendanceIpc(ipcMain);
    registerExamsIpc(ipcMain);
    registerSystemIpc(ipcMain);
    registerLicensingIpc(ipcMain);
    registerOwnerTelemetryIpc(ipcMain);
    registerUpdaterIpc(ipcMain);
    registerPageVisibilityIpc(ipcMain);
    registerNotificationsIpc(ipcMain);
    registerReportsIpc(ipcMain);
    registerInstitutionIpc(ipcMain);
    registerSyncIpc(ipcMain);
    registerTimetableDataIpc(ipcMain);
    registerInspectorsIpc(ipcMain);
    startOutboxCleanup();
}

module.exports = { registerAllIpcHandlers };
