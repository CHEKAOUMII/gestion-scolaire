const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// sql.js setup
let db = null;
const DB_PATH = path.join(app.getPath('userData'), 'gestion-scolaire.db');

// Initialize sql.js and database
async function initDatabase() {
    const initSqlJs = require('sql.js');
    
    const SQL = await initSqlJs();
    
    // Load existing database or create new one
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
        console.log('Database loaded from:', DB_PATH);
    } else {
        db = new SQL.Database();
        createTables();
        saveDatabase();
        console.log('New database created at:', DB_PATH);
    }
}

// Create tables
function createTables() {
    db.run(`
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE,
            full_name TEXT NOT NULL,
            family_name TEXT,
            birth_date TEXT,
            gender TEXT,
            section TEXT,
            school_year TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            student_code TEXT,
            subject TEXT,
            grade REAL,
            semester INTEGER,
            school_year TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(id)
        );
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);
    
    // Set default school year
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('currentSchoolYear', '2025/2026')`);
}

// Save database to file
function saveDatabase() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

// Create window
function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'icon.ico'),
        title: 'برنامج التدبير المدرسي'
    });

    mainWindow.loadFile('index.html');
    
    // Open DevTools in development
    // mainWindow.webContents.openDevTools();
}

// IPC Handlers - Students
ipcMain.handle('students:getAll', async (event, schoolYear) => {
    const year = schoolYear || '2025/2026';
    const stmt = db.prepare('SELECT * FROM students WHERE school_year = ? ORDER BY section, full_name');
    stmt.bind([year]);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
});

ipcMain.handle('students:add', async (event, student) => {
    try {
        db.run(`
            INSERT INTO students (code, full_name, family_name, birth_date, gender, section, school_year, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [student.code, student.full_name, student.family_name, student.birth_date, 
            student.gender, student.section, student.school_year, student.status || 'active']);
        saveDatabase();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('students:addBulk', async (event, students) => {
    try {
        for (const student of students) {
            db.run(`
                INSERT OR REPLACE INTO students (code, full_name, family_name, birth_date, gender, section, school_year, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [student.code, student.full_name, student.family_name, student.birth_date,
                student.gender, student.section, student.school_year, student.status || 'active']);
        }
        saveDatabase();
        return { success: true, count: students.length };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('students:update', async (event, id, data) => {
    try {
        const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
        const values = Object.values(data);
        values.push(id);
        db.run(`UPDATE students SET ${fields} WHERE id = ?`, values);
        saveDatabase();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('students:delete', async (event, id) => {
    try {
        db.run('DELETE FROM students WHERE id = ?', [id]);
        saveDatabase();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// IPC Handlers - Grades
ipcMain.handle('grades:getAll', async (event, schoolYear) => {
    const year = schoolYear || '2025/2026';
    const stmt = db.prepare(`
        SELECT g.*, s.full_name, s.section 
        FROM grades g 
        LEFT JOIN students s ON g.student_id = s.id 
        WHERE g.school_year = ?
    `);
    stmt.bind([year]);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
});

ipcMain.handle('grades:save', async (event, grade) => {
    try {
        db.run(`
            INSERT OR REPLACE INTO grades (student_id, student_code, subject, grade, semester, school_year)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [grade.student_id, grade.student_code, grade.subject, grade.grade, grade.semester, grade.school_year]);
        saveDatabase();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('grades:saveBulk', async (event, grades) => {
    try {
        for (const grade of grades) {
            db.run(`
                INSERT OR REPLACE INTO grades (student_id, student_code, subject, grade, semester, school_year)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [grade.student_id, grade.student_code, grade.subject, grade.grade, grade.semester, grade.school_year]);
        }
        saveDatabase();
        return { success: true, count: grades.length };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// IPC Handlers - Settings
ipcMain.handle('settings:get', async (event, key) => {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    stmt.bind([key]);
    let value = null;
    if (stmt.step()) {
        value = stmt.getAsObject().value;
    }
    stmt.free();
    return value;
});

ipcMain.handle('settings:set', async (event, key, value) => {
    try {
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
        saveDatabase();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// IPC Handlers - Statistics
ipcMain.handle('stats:get', async (event, schoolYear) => {
    const year = schoolYear || '2025/2026';
    
    // Total students
    let stmt = db.prepare('SELECT COUNT(*) as total FROM students WHERE school_year = ?');
    stmt.bind([year]);
    stmt.step();
    const totalStudents = stmt.getAsObject().total;
    stmt.free();
    
    // By gender
    stmt = db.prepare('SELECT gender, COUNT(*) as count FROM students WHERE school_year = ? GROUP BY gender');
    stmt.bind([year]);
    const byGender = {};
    while (stmt.step()) {
        const row = stmt.getAsObject();
        byGender[row.gender] = row.count;
    }
    stmt.free();
    
    // By section
    stmt = db.prepare('SELECT section, COUNT(*) as count FROM students WHERE school_year = ? GROUP BY section');
    stmt.bind([year]);
    const bySection = {};
    while (stmt.step()) {
        const row = stmt.getAsObject();
        bySection[row.section] = row.count;
    }
    stmt.free();
    
    return {
        totalStudents,
        maleCount: byGender['ذكر'] || 0,
        femaleCount: byGender['أنثى'] || 0,
        bySection
    };
});

// App lifecycle
app.whenReady().then(async () => {
    await initDatabase();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
