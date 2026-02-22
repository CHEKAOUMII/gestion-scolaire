const { contextBridge, ipcRenderer } = require('electron');

// Expose secure API to renderer process
contextBridge.exposeInMainWorld('api', {
    // Students
    students: {
        getAll: (schoolYear) => ipcRenderer.invoke('students:getAll', schoolYear),
        search: (name, className, code, schoolYear) =>
            ipcRenderer.invoke('students:search', name, className, code, schoolYear),
        add: (student) => ipcRenderer.invoke('students:add', student),
        addBulk: (students) => ipcRenderer.invoke('students:addBulk', students),
        update: (id, data) => ipcRenderer.invoke('students:update', id, data),
        delete: (id) => ipcRenderer.invoke('students:delete', id),
        deleteByYear: (schoolYear) => ipcRenderer.invoke('students:deleteByYear', schoolYear)
    },

    // Lookup catalogs
    classes: {
        getAll: (schoolYear) => ipcRenderer.invoke('classes:getAll', schoolYear)
    },

    subjects: {
        getAll: () => ipcRenderer.invoke('subjects:getAll')
    },

    // Grades
    grades: {
        getAll: (schoolYear) => ipcRenderer.invoke('grades:getAll', schoolYear),
        getZeroStudents: (filters) => ipcRenderer.invoke('grades:getZeroStudents', filters),
        save: (grade) => ipcRenderer.invoke('grades:save', grade),
        saveBulk: (grades) => ipcRenderer.invoke('grades:saveBulk', grades),
        deleteByYear: (schoolYear) => ipcRenderer.invoke('grades:deleteByYear', schoolYear)
    },

    // Settings
    settings: {
        get: (key) => ipcRenderer.invoke('settings:get', key),
        set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
    },

    // Statistics
    stats: {
        get: (schoolYear) => ipcRenderer.invoke('stats:get', schoolYear)
    },

    // Absences
    absences: {
        getAll: (schoolYear) => ipcRenderer.invoke('absences:getAll', schoolYear),
        getByStudent: (studentId) => ipcRenderer.invoke('absences:getByStudent', studentId),
        getBySection: (section, schoolYear) => ipcRenderer.invoke('absences:getBySection', section, schoolYear),
        save: (absence) => ipcRenderer.invoke('absences:save', absence),
        saveBulk: (absences) => ipcRenderer.invoke('absences:saveBulk', absences),
        delete: (id) => ipcRenderer.invoke('absences:delete', id),
        deleteByYear: (schoolYear) => ipcRenderer.invoke('absences:deleteByYear', schoolYear),
        getStats: (schoolYear) => ipcRenderer.invoke('absences:getStats', schoolYear),
        getSummaryByStudent: (schoolYear) => ipcRenderer.invoke('absences:getSummaryByStudent', schoolYear)
    },

    // Compatibility alias (legacy pages)
    absence: {
        getByClass: (className, schoolYear) => ipcRenderer.invoke('absence:getByClass', className, schoolYear)
    },

    // Correspondence
    correspondence: {
        getAll: (schoolYear) => ipcRenderer.invoke('correspondence:getAll', schoolYear),
        save: (letter) => ipcRenderer.invoke('correspondence:save', letter),
        getByStudent: (studentId) => ipcRenderer.invoke('correspondence:getByStudent', studentId),
        markPrinted: (id) => ipcRenderer.invoke('correspondence:markPrinted', id)
    },

    // Student files
    studentFiles: {
        getByYear: (schoolYear) => ipcRenderer.invoke('studentFiles:getByYear', schoolYear),
        upsert: (payload) => ipcRenderer.invoke('studentFiles:upsert', payload),
        upsertBulk: (items) => ipcRenderer.invoke('studentFiles:upsertBulk', items),
        setDocumentStatus: (payload) => ipcRenderer.invoke('studentFiles:setDocumentStatus', payload)
    },

    // Student movement
    studentMovements: {
        getAll: (schoolYear) => ipcRenderer.invoke('studentMovements:getAll', schoolYear),
        add: (movement) => ipcRenderer.invoke('studentMovements:add', movement),
        getStats: (schoolYear) => ipcRenderer.invoke('studentMovements:getStats', schoolYear)
    },

    // Teachers
    teachers: {
        getAll: (schoolYear) => ipcRenderer.invoke('teachers:getAll', schoolYear),
        add: (teacher) => ipcRenderer.invoke('teachers:add', teacher),
        update: (id, data) => ipcRenderer.invoke('teachers:update', id, data),
        delete: (id) => ipcRenderer.invoke('teachers:delete', id)
    },

    // Teacher absences
    teacherAbsences: {
        getAll: (schoolYear) => ipcRenderer.invoke('teacherAbsences:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('teacherAbsences:save', payload),
        delete: (id) => ipcRenderer.invoke('teacherAbsences:delete', id)
    },

    // Compatibility alias (legacy pages)
    teacherAbsence: {
        getAll: (schoolYear) => ipcRenderer.invoke('teacherAbsence:getAll', schoolYear),
        add: (payload) => ipcRenderer.invoke('teacherAbsence:add', payload),
        delete: (id) => ipcRenderer.invoke('teacherAbsence:delete', id)
    },

    // Exams
    exams: {
        getAll: (schoolYear) => ipcRenderer.invoke('exams:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('exams:save', payload),
        delete: (id) => ipcRenderer.invoke('exams:delete', id)
    },

    // Exam proctors
    examProctors: {
        generateRoundRobin: (payload) => ipcRenderer.invoke('examProctors:generateRoundRobin', payload),
        saveManual: (payload) => ipcRenderer.invoke('examProctors:saveManual', payload),
        getAll: (schoolYear) => ipcRenderer.invoke('examProctors:getAll', schoolYear),
        delete: (id) => ipcRenderer.invoke('examProctors:delete', id)
    },

    // Compatibility alias (legacy pages)
    proctors: {
        getAll: (schoolYear) => ipcRenderer.invoke('proctors:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('proctors:save', payload),
        delete: (id) => ipcRenderer.invoke('proctors:delete', id)
    },

    // Exam rooms
    examRooms: {
        getAll: (schoolYear) => ipcRenderer.invoke('examRooms:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('examRooms:save', payload),
        delete: (id) => ipcRenderer.invoke('examRooms:delete', id)
    },

    // Compatibility alias (legacy pages)
    rooms: {
        getAll: (schoolYear) => ipcRenderer.invoke('rooms:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('rooms:save', payload),
        delete: (id) => ipcRenderer.invoke('rooms:delete', id)
    },

    timetable: {
        getByTeacher: (teacher, schoolYear) => ipcRenderer.invoke('timetable:getByTeacher', teacher, schoolYear),
        getByRoom: (room, schoolYear) => ipcRenderer.invoke('timetable:getByRoom', room, schoolYear),
        getByClass: (className, schoolYear) => ipcRenderer.invoke('timetable:getByClass', className, schoolYear)
    },

    // Supervised tests
    tests: {
        getAll: (schoolYear) => ipcRenderer.invoke('tests:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('tests:save', payload),
        delete: (id) => ipcRenderer.invoke('tests:delete', id)
    },

    // Reports
    reports: {
        generateCertificate: (payload) => ipcRenderer.invoke('reports:generateCertificate', payload),
        generateSemesterSummary: (payload) => ipcRenderer.invoke('reports:generateSemesterSummary', payload)
    },

    // Logs
    systemLogs: {
        getAll: (limit) => ipcRenderer.invoke('systemLogs:getAll', limit),
        add: (payload) => ipcRenderer.invoke('systemLogs:add', payload)
    },

    // Auth
    auth: {
        login: (payload) => ipcRenderer.invoke('auth:login', payload),
        getSession: () => ipcRenderer.invoke('auth:getSession'),
        logout: () => ipcRenderer.invoke('auth:logout')
    },

    // Users
    users: {
        getAll: () => ipcRenderer.invoke('users:getAll'),
        add: (payload) => ipcRenderer.invoke('users:add', payload),
        updateRole: (id, role) => ipcRenderer.invoke('users:updateRole', id, role),
        disable: (id, disabled) => ipcRenderer.invoke('users:disable', id, disabled)
    },

    // Licensing
    licensing: {
        getActivationRequest: () => ipcRenderer.invoke('licensing:getActivationRequest'),
        getPublicStatus: () => ipcRenderer.invoke('licensing:getPublicStatus'),
        activatePublic: (payload) => ipcRenderer.invoke('licensing:activatePublic', payload),
        generateSerial: (payload) => ipcRenderer.invoke('licensing:generateSerial', payload),
        getStatus: () => ipcRenderer.invoke('licensing:getStatus'),
        getPlans: () => ipcRenderer.invoke('licensing:getPlans'),
        activate: (payload) => ipcRenderer.invoke('licensing:activate', payload),
        listDevices: () => ipcRenderer.invoke('licensing:listDevices'),
        deactivateCurrentDevice: () => ipcRenderer.invoke('licensing:deactivateCurrentDevice'),
        adminRevokeDevice: (payload) => ipcRenderer.invoke('licensing:adminRevokeDevice', payload),
        refreshValidation: () => ipcRenderer.invoke('licensing:refreshValidation'),
        getTrialStatus: () => ipcRenderer.invoke('licensing:getTrialStatus'),
        setTrialDuration: (payload) => ipcRenderer.invoke('licensing:setTrialDuration', payload)
    },

    ownerTelemetry: {
        getConfig: () => ipcRenderer.invoke('ownerTelemetry:getConfig'),
        saveConfig: (payload) => ipcRenderer.invoke('ownerTelemetry:saveConfig', payload),
        testConnection: (payload) => ipcRenderer.invoke('ownerTelemetry:testConnection', payload),
        syncNow: () => ipcRenderer.invoke('ownerTelemetry:syncNow'),
        getOverview: () => ipcRenderer.invoke('ownerTelemetry:getOverview'),
        getDevices: (payload) => ipcRenderer.invoke('ownerTelemetry:getDevices', payload)
    },

    // System backup/restore
    system: {
        printCurrentWindow: (options = {}) => ipcRenderer.invoke('system:printCurrentWindow', options),
        printToPDF: (options = {}) => ipcRenderer.invoke('system:printToPDF', options),
        printHTML: (payload = {}) => ipcRenderer.invoke('system:printHTML', payload),
        backupDb: () => ipcRenderer.invoke('system:backupDb'),
        restoreDb: (payload) => ipcRenderer.invoke('system:restoreDb', payload),
        quit: () => ipcRenderer.invoke('app:quit')
    },

    // Auto-updater
    updater: {
        checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
        downloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
        installUpdate: () => ipcRenderer.invoke('updater:installUpdate'),
        onStatus: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('updater:status', handler);
            return () => ipcRenderer.removeListener('updater:status', handler);
        }
    }
});

console.log('Preload script loaded - API exposed to renderer');
