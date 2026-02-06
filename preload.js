const { contextBridge, ipcRenderer } = require('electron');

// Expose secure API to renderer process
contextBridge.exposeInMainWorld('api', {
    // Students
    students: {
        getAll: (schoolYear) => ipcRenderer.invoke('students:getAll', schoolYear),
        add: (student) => ipcRenderer.invoke('students:add', student),
        addBulk: (students) => ipcRenderer.invoke('students:addBulk', students),
        update: (id, data) => ipcRenderer.invoke('students:update', id, data),
        delete: (id) => ipcRenderer.invoke('students:delete', id)
    },

    // Grades
    grades: {
        getAll: (schoolYear) => ipcRenderer.invoke('grades:getAll', schoolYear),
        save: (grade) => ipcRenderer.invoke('grades:save', grade),
        saveBulk: (grades) => ipcRenderer.invoke('grades:saveBulk', grades)
    },

    // Settings
    settings: {
        get: (key) => ipcRenderer.invoke('settings:get', key),
        set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
    },

    // Statistics
    stats: {
        get: (schoolYear) => ipcRenderer.invoke('stats:get', schoolYear)
    }
});

console.log('Preload script loaded - API exposed to renderer');
