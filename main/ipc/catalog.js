const { handleRead, normalizeYear } = require('./ipc-helpers');
const { normalizeSubjectName } = require('../../js/data/ma-education-labels');

function registerCatalogIpc(ipcMain) {
    handleRead(ipcMain, 'stats:get', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);

        // Total students
        const { total: totalStudents } = db
            .prepare('SELECT COUNT(*) as total FROM students WHERE school_year = ?')
            .get(year);

        // By gender
        const genderRows = db
            .prepare('SELECT gender, COUNT(*) as count FROM students WHERE school_year = ? GROUP BY gender')
            .all(year);
        const byGender = {};
        for (const row of genderRows) byGender[row.gender] = row.count;

        // By section
        const sectionRows = db
            .prepare('SELECT section, COUNT(*) as count FROM students WHERE school_year = ? GROUP BY section')
            .all(year);
        const bySection = {};
        for (const row of sectionRows) bySection[row.section] = row.count;

        return {
            totalStudents,
            maleCount: byGender['ذكر'] || 0,
            femaleCount: byGender['أنثى'] || 0,
            bySection
        };
    });

    // ── Catalogs/lookup (read = open) ──

    handleRead(ipcMain, 'classes:getAll', (db, schoolYear) => {
        const rows = db
            .prepare(
                `
            SELECT section
            FROM students
            WHERE school_year = ? AND section IS NOT NULL AND TRIM(section) <> ''
            GROUP BY section
            ORDER BY section
        `
            )
            .all(normalizeYear(schoolYear));
        return rows.map((r) => ({ name: r.section }));
    });

    handleRead(ipcMain, 'subjects:getAll', (db) => {
        const rows = db
            .prepare(
                `
            SELECT subject
            FROM grades
            WHERE subject IS NOT NULL AND TRIM(subject) <> ''
            GROUP BY subject
            ORDER BY subject
        `
            )
            .all();

        // Subject normalization — uses normalizeSubjectName() from js/data/ma-education-labels.js
        const invalidSubjectNames = new Set(['sheet', 'sheet1', 'feuil1', 'notes', 'notescc', 'note', 'ورقة1', 'ورقة']);
        const uniqueSubjects = new Set();

        rows.forEach((row) => {
            const clean = normalizeSubjectName(row.subject);
            if (!clean) return;
            if (invalidSubjectNames.has(clean.toLowerCase())) return;
            uniqueSubjects.add(clean);
        });

        return Array.from(uniqueSubjects)
            .sort((a, b) => a.localeCompare(b, 'ar'))
            .map((name) => ({ name }));
    });
}

module.exports = { registerCatalogIpc };
