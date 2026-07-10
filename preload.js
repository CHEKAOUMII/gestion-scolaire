const { contextBridge, ipcRenderer } = require('electron');

// Expose secure API to renderer process
contextBridge.exposeInMainWorld('api', {
    // Students
    students: {
        getAll: (schoolYear) => ipcRenderer.invoke('students:getAll', schoolYear),
        getCodesByYear: (schoolYear) => ipcRenderer.invoke('students:getCodesByYear', schoolYear),
        getByCode: (code, schoolYear) => ipcRenderer.invoke('students:getByCode', code, schoolYear),
        search: (name, className, code, schoolYear) =>
            ipcRenderer.invoke('students:search', name, className, code, schoolYear),
        add: (student) => ipcRenderer.invoke('students:add', student),
        addBulk: (students) => ipcRenderer.invoke('students:addBulk', students),
        update: (id, data) => ipcRenderer.invoke('students:update', id, data),
        delete: (id) => ipcRenderer.invoke('students:delete', id),
        deleteByYear: (schoolYear) => ipcRenderer.invoke('students:deleteByYear', schoolYear),
        getByStatus: (filters) => ipcRenderer.invoke('students:getByStatus', filters),
        updateStatusBulk: (items) => ipcRenderer.invoke('students:updateStatusBulk', items)
    },

    // Student Profile Data (bataqa mutabaat)
    studentProfile: {
        getAllTabs: (studentCode, schoolYear) => ipcRenderer.invoke('studentProfile:getAllTabs', studentCode, schoolYear),
        saveTab: (payload) => ipcRenderer.invoke('studentProfile:saveTab', payload),
        saveRiskSnapshot: (payload) => ipcRenderer.invoke('studentProfile:saveRiskSnapshot', payload)
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
        getByStudentCode: (studentCode, schoolYear) =>
            ipcRenderer.invoke('grades:getByStudentCode', studentCode, schoolYear),
        getZeroStudents: (filters) => ipcRenderer.invoke('grades:getZeroStudents', filters),
        save: (grade) => ipcRenderer.invoke('grades:save', grade),
        saveBulk: (grades) => ipcRenderer.invoke('grades:saveBulk', grades),
        reassignTeacherBulk: (payload) => ipcRenderer.invoke('grades:reassignTeacherBulk', payload),
        deleteByYear: (schoolYear) => ipcRenderer.invoke('grades:deleteByYear', schoolYear),
        deleteBySemester: (schoolYear, semester) => ipcRenderer.invoke('grades:deleteBySemester', schoolYear, semester)
    },

    // Settings
    settings: {
        get: (key) => ipcRenderer.invoke('settings:get', key),
        set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
        setSchoolYear: (year) => ipcRenderer.invoke('settings:setSchoolYear', year)
    },

    // Page visibility
    pageVisibility: {
        getMap: () => ipcRenderer.invoke('pageVisibility:getMap'),
        setVisibility: (payload) => ipcRenderer.invoke('pageVisibility:setVisibility', payload)
    },

    appDefaults: {
        listLevels: () => ipcRenderer.invoke('appDefaults:listLevels'),
        getExamCounts: (levelCode) => ipcRenderer.invoke('appDefaults:getExamCounts', levelCode),
        saveExamCounts: (payload) => ipcRenderer.invoke('appDefaults:saveExamCounts', payload),
        getExamCount: (levelCode, subject) =>
            ipcRenderer.invoke('appDefaults:getExamCount', { levelCode, subject }),
        listPages: () => ipcRenderer.invoke('appDefaults:listPages'),
        getPageAccessMap: () => ipcRenderer.invoke('appDefaults:getPageAccessMap'),
        savePageAccess: (payload) => ipcRenderer.invoke('appDefaults:savePageAccess', payload)
    },

    // Statistics
    stats: {
        get: (schoolYear) => ipcRenderer.invoke('stats:get', schoolYear)
    },

    // Absences
    absences: {
        getAll: (schoolYear) => ipcRenderer.invoke('absences:getAll', schoolYear),
        getByStudent: (studentId, schoolYear) => ipcRenderer.invoke('absences:getByStudent', studentId, schoolYear),
        getByStudentCode: (studentCode, schoolYear) =>
            ipcRenderer.invoke('absences:getByStudentCode', studentCode, schoolYear),
        getBySection: (section, schoolYear) => ipcRenderer.invoke('absences:getBySection', section, schoolYear),
        save: (absence) => ipcRenderer.invoke('absences:save', absence),
        saveBulk: (absences) => ipcRenderer.invoke('absences:saveBulk', absences),
        delete: (id) => ipcRenderer.invoke('absences:delete', id),
        deleteByYear: (schoolYear) => ipcRenderer.invoke('absences:deleteByYear', schoolYear),
        getStats: (schoolYear) => ipcRenderer.invoke('absences:getStats', schoolYear),
        getSummaryByStudent: (schoolYear) => ipcRenderer.invoke('absences:getSummaryByStudent', schoolYear)
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
        getFromGrades: (schoolYear) => ipcRenderer.invoke('teachers:getFromGrades', schoolYear),
        add: (teacher) => ipcRenderer.invoke('teachers:add', teacher),
        update: (id, data) => ipcRenderer.invoke('teachers:update', id, data),
        delete: (id) => ipcRenderer.invoke('teachers:delete', id),
        deleteByYear: (schoolYear) => ipcRenderer.invoke('teachers:deleteByYear', schoolYear),
        importBulk: (teachers) => ipcRenderer.invoke('teachers:importBulk', teachers),
        saveTafwijAliases: (payload) => ipcRenderer.invoke('teachers:saveTafwijAliases', payload),
        getNameAliases: (entityType, schoolYear) =>
            ipcRenderer.invoke('teachers:getNameAliases', entityType, schoolYear),
        saveNameAlias: (payload) => ipcRenderer.invoke('teachers:saveNameAlias', payload),
        deleteNameAlias: (id) => ipcRenderer.invoke('teachers:deleteNameAlias', id)
    },

    // Inspectors
    inspectors: {
        getAll: (schoolYear) => ipcRenderer.invoke('inspectors:getAll', schoolYear),
        getStats: (schoolYear) => ipcRenderer.invoke('inspectors:getStats', schoolYear),
        add: (data) => ipcRenderer.invoke('inspectors:add', data),
        update: (id, data) => ipcRenderer.invoke('inspectors:update', id, data),
        delete: (id) => ipcRenderer.invoke('inspectors:delete', id)
    },

    // Teacher absences
    teacherAbsences: {
        getAll: (schoolYear) => ipcRenderer.invoke('teacherAbsences:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('teacherAbsences:save', payload),
        delete: (id) => ipcRenderer.invoke('teacherAbsences:delete', id)
    },

    // Daily report
    dailyReport: {
        getData: (date, schoolYear) => ipcRenderer.invoke('dailyReport:getData', date, schoolYear)
    },

    // School events (daily report)
    schoolEvents: {
        save: (payload) => ipcRenderer.invoke('schoolEvents:save', payload),
        delete: (id) => ipcRenderer.invoke('schoolEvents:delete', id)
    },

    // System tags (daily report)
    systemTags: {
        getByDate: (date, schoolYear) => ipcRenderer.invoke('systemTags:getByDate', date, schoolYear),
        getTeacherTags: (schoolYear) => ipcRenderer.invoke('systemTags:getTeacherTags', schoolYear),
        save: (payload) => ipcRenderer.invoke('systemTags:save', payload),
        saveNote: (payload) => ipcRenderer.invoke('systemTags:saveNote', payload),
        delete: (id) => ipcRenderer.invoke('systemTags:delete', id),
        deleteByGroup: (noteGroup) => ipcRenderer.invoke('systemTags:deleteByGroup', noteGroup)
    },

    // Compensation tracking
    compensation: {
        getByDate: (date, schoolYear) => ipcRenderer.invoke('compensation:getByDate', date, schoolYear),
        getAll: (schoolYear) => ipcRenderer.invoke('compensation:getAll', schoolYear),
        getPending: (schoolYear) => ipcRenderer.invoke('compensation:getPending', schoolYear),
        saveBatch: (sessions) => ipcRenderer.invoke('compensation:saveBatch', sessions),
        toggleCompensated: (id, compensated) => ipcRenderer.invoke('compensation:toggleCompensated', id, compensated)
    },

    // Support sessions
    supportSessions: {
        list: (filters) => ipcRenderer.invoke('supportSessions:list', filters),
        stats: (schoolYear) => ipcRenderer.invoke('supportSessions:stats', schoolYear),
        add: (session) => ipcRenderer.invoke('supportSessions:add', session),
        delete: (id) => ipcRenderer.invoke('supportSessions:delete', id),
        export: (schoolYear) => ipcRenderer.invoke('supportSessions:export', schoolYear),
        import: (payload) => ipcRenderer.invoke('supportSessions:import', payload)
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
        bulkImport: (payload) => ipcRenderer.invoke('examProctors:bulkImport', payload),
        deleteAll: (schoolYear) => ipcRenderer.invoke('examProctors:deleteAll', schoolYear),
        getAll: (schoolYear) => ipcRenderer.invoke('examProctors:getAll', schoolYear),
        delete: (id) => ipcRenderer.invoke('examProctors:delete', id)
    },

    // Exam invitations (الاستدعاءات)
    examInvitations: {
        getAll: (schoolYear) => ipcRenderer.invoke('examInvitations:getAll', schoolYear),
        upsert: (payload) => ipcRenderer.invoke('examInvitations:upsert', payload),
        delete: (id) => ipcRenderer.invoke('examInvitations:delete', id),
        deleteAll: (schoolYear) => ipcRenderer.invoke('examInvitations:deleteAll', schoolYear)
    },

    // Exam attendance tracking (تتبع الحضور)
    examAttendance: {
        getAll: (schoolYear) => ipcRenderer.invoke('examAttendance:getAll', schoolYear),
        getBySession: (schoolYear, sessionKey) => ipcRenderer.invoke('examAttendance:getBySession', schoolYear, sessionKey),
        upsert: (payload) => ipcRenderer.invoke('examAttendance:upsert', payload),
        bulkUpsert: (payload) => ipcRenderer.invoke('examAttendance:bulkUpsert', payload),
        delete: (id) => ipcRenderer.invoke('examAttendance:delete', id),
        deleteAll: (schoolYear) => ipcRenderer.invoke('examAttendance:deleteAll', schoolYear)
    },

    // Exam rooms
    examRooms: {
        getAll: (schoolYear) => ipcRenderer.invoke('examRooms:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('examRooms:save', payload),
        delete: (id) => ipcRenderer.invoke('examRooms:delete', id)
    },

    timetable: {
        get: (schoolYear) => ipcRenderer.invoke('timetableData:get', schoolYear),
        save: (payload) => ipcRenderer.invoke('timetableData:save', payload),
        delete: (schoolYear) => ipcRenderer.invoke('timetableData:delete', schoolYear)
    },

    examConfig: {
        get: (schoolYear, configKey) => ipcRenderer.invoke('examConfigData:get', schoolYear, configKey),
        getAll: (schoolYear) => ipcRenderer.invoke('examConfigData:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('examConfigData:save', payload),
        delete: (payload) => ipcRenderer.invoke('examConfigData:delete', payload)
    },

    // Supervised tests
    tests: {
        getAll: (schoolYear) => ipcRenderer.invoke('tests:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('tests:save', payload),
        delete: (id) => ipcRenderer.invoke('tests:delete', id)
    },

    // Reports — unified document engine
    reports: {
        printDocument: (payload) => ipcRenderer.invoke('reports:printDocument', payload),
        getIdentity: () => ipcRenderer.invoke('reports:getIdentity'),
        getIdentityDiagnostics: () => ipcRenderer.invoke('reports:getIdentityDiagnostics'),
        updateIdentity: (updates) => ipcRenderer.invoke('reports:updateIdentity', updates),
        renderLetterhead: (overrides) => ipcRenderer.invoke('reports:renderLetterhead', overrides),
        generateAdminForm: (payload) => ipcRenderer.invoke('reports:generateAdminForm', payload)
    },

    // Logs
    systemLogs: {
        getAll: (limit) => ipcRenderer.invoke('systemLogs:getAll', limit),
        add: (payload) => ipcRenderer.invoke('systemLogs:add', payload)
    },

    // Auth
    auth: {
        login: (payload) => ipcRenderer.invoke('auth:login', payload),
        register: (payload) => ipcRenderer.invoke('auth:register', payload),
        changePassword: (payload) => ipcRenderer.invoke('auth:changePassword', payload),
        getSession: () => ipcRenderer.invoke('auth:getSession'),
        logout: () => ipcRenderer.invoke('auth:logout'),
        setupPin: (payload) => ipcRenderer.invoke('auth:setupPin', payload),
        verifyPin: (payload) => ipcRenderer.invoke('auth:verifyPin', payload),
        removePin: () => ipcRenderer.invoke('auth:removePin'),
        getPinStatus: () => ipcRenderer.invoke('auth:getPinStatus'),
        lockSession: () => ipcRenderer.invoke('auth:lockSession'),
        unlockWithPassword: (payload) => ipcRenderer.invoke('auth:unlockWithPassword', payload),
        getAllowedPages: () => ipcRenderer.invoke('auth:getAllowedPages'),
        submitLinkRequest: (payload) => ipcRenderer.invoke('auth:submitLinkRequest', payload),
        listLinkRequests: () => ipcRenderer.invoke('auth:listLinkRequests'),
        resolveLinkRequest: (payload) => ipcRenderer.invoke('auth:resolveLinkRequest', payload)
    },

    // Users
    users: {
        getAll: () => ipcRenderer.invoke('users:getAll'),
        add: (payload) => ipcRenderer.invoke('users:add', payload),
        updateRole: (id, role) => ipcRenderer.invoke('users:updateRole', id, role),
        disable: (id, disabled) => ipcRenderer.invoke('users:disable', id, disabled),
        resetAdminPassword: () => ipcRenderer.invoke('users:resetAdminPassword')
    },

    // Licensing
    licensing: {
        getActivationRequest: () => ipcRenderer.invoke('licensing:getActivationRequest'),
        getPublicStatus: () => ipcRenderer.invoke('licensing:getPublicStatus'),
        activatePublic: (payload) => ipcRenderer.invoke('licensing:activatePublic', payload),
        getStatus: () => ipcRenderer.invoke('licensing:getStatus'),
        getPlans: () => ipcRenderer.invoke('licensing:getPlans'),
        listDevices: () => ipcRenderer.invoke('licensing:listDevices'),
        deactivateCurrentDevice: () => ipcRenderer.invoke('licensing:deactivateCurrentDevice'),
        adminRevokeDevice: (payload) => ipcRenderer.invoke('licensing:adminRevokeDevice', payload),
        refreshValidation: () => ipcRenderer.invoke('licensing:refreshValidation'),
        getTrialStatus: () => ipcRenderer.invoke('licensing:getTrialStatus'),
        setTrialDuration: (payload) => ipcRenderer.invoke('licensing:setTrialDuration', payload)
    },

    ownerTelemetry: {
        getConfig: () => ipcRenderer.invoke('ownerTelemetry:getConfig'),
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
        restoreDbContent: (payload) => ipcRenderer.invoke('system:restoreDbContent', payload),
        savePageVisibilityDefaults: () => ipcRenderer.invoke('system:savePageVisibilityDefaults'),
        quit: () => ipcRenderer.invoke('app:quit')
    },

    // Notifications
    notifications: {
        send: (event) => ipcRenderer.invoke('notifications:send', event),
        getRecent: (limit) => ipcRenderer.invoke('notifications:getRecent', limit),
        markRead: (id) => ipcRenderer.invoke('notifications:markRead', id),
        markAllRead: () => ipcRenderer.invoke('notifications:markAllRead'),
        unreadCount: () => ipcRenderer.invoke('notifications:unreadCount'),
        deleteOld: (days) => ipcRenderer.invoke('notifications:deleteOld', days),
        onToast: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('notification:toast', handler);
            return () => ipcRenderer.removeListener('notification:toast', handler);
        },
        onCenterUpdate: (callback) => {
            const handler = (_event, data) => callback(data);
            ipcRenderer.on('notification:center:update', handler);
            return () => ipcRenderer.removeListener('notification:center:update', handler);
        }
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
    },

    // Staff Attendance (absence & tardiness records)
    staffAttendance: {
        getAll: (schoolYear) => ipcRenderer.invoke('staffAttendance:getAll', schoolYear),
        save: (payload) => ipcRenderer.invoke('staffAttendance:save', payload),
        update: (payload) => ipcRenderer.invoke('staffAttendance:update', payload),
        delete: (id) => ipcRenderer.invoke('staffAttendance:delete', id)
    },

    sync: {
        getConfig: () => ipcRenderer.invoke('sync:getConfig'),
        getStatus: () => ipcRenderer.invoke('sync:getStatus'),
        setConfig: (updates) => ipcRenderer.invoke('sync:setConfig', updates),
        triggerNow: () => ipcRenderer.invoke('sync:triggerNow'),
        getConflictLog: (options) => ipcRenderer.invoke('sync:getConflictLog', options),
        getConflictForensics: (options) => ipcRenderer.invoke('sync:getConflictForensics', options),
        resolveConflict: (payload) => ipcRenderer.invoke('sync:resolveConflict', payload),
        testConnection: () => ipcRenderer.invoke('sync:testConnection')
    },

    institution: {
        getStatus: () => ipcRenderer.invoke('institution:get-status'),
        relink: (payload) => ipcRenderer.invoke('institution:relink', payload),
        setupNew: (payload) => ipcRenderer.invoke('institution:setup-new', payload),
        updateMassarCode: (payload) => ipcRenderer.invoke('institution:updateMassarCode', payload),
        submitIdentityChangeRequest: (payload) => ipcRenderer.invoke('institution:submitIdentityChangeRequest', payload),
        getIdentityChangeRequests: (payload) => ipcRenderer.invoke('institution:getIdentityChangeRequests', payload),
        applyApprovedIdentityChange: (payload) => ipcRenderer.invoke('institution:applyApprovedIdentityChange', payload)
    },

    appAdmin: {
        listIdentityChangeRequests: (payload) => ipcRenderer.invoke('appAdmin:listIdentityChangeRequests', payload),
        approveIdentityChangeRequest: (payload) => ipcRenderer.invoke('appAdmin:approveIdentityChangeRequest', payload),
        rejectIdentityChangeRequest: (payload) => ipcRenderer.invoke('appAdmin:rejectIdentityChangeRequest', payload)
    },

    diagnostics: {
        getRecent: (options) => ipcRenderer.invoke('diagnostics:getRecent', options),
        exportLog: () => ipcRenderer.invoke('diagnostics:exportLog'),
        revealLog: () => ipcRenderer.invoke('diagnostics:revealLog')
    },

});

console.log('Preload script loaded - API exposed to renderer');
