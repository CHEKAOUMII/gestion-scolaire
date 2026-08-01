const { handleAuthedRead, normalizeYear } = require('./ipc-helpers');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const { normalizeSubjectName } = require('../../js/data/ma-education-labels');

// These three channels read `students` and `grades`, which are cycle-scoped
// (multi-cycle plan §5.4). They must resolve the cycle from the session: `classes:getAll`
// in particular feeds every FilterManager dropdown in the app, so leaving it unscoped
// would show both cycles' sections on every page as soon as a second cycle is enabled.
function registerCatalogIpc(ipcMain) {
    handleAuthedRead(ipcMain, 'stats:get', ({ db, event }, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const cycle = resolveCycleForRequest(db, event);

        // Total students
        const { total: totalStudents } = db
            .prepare('SELECT COUNT(*) as total FROM students WHERE school_year = ? AND cycle_code = ?')
            .get(year, cycle);

        // By gender
        const genderRows = db
            .prepare(
                'SELECT gender, COUNT(*) as count FROM students WHERE school_year = ? AND cycle_code = ? GROUP BY gender'
            )
            .all(year, cycle);
        const byGender = {};
        for (const row of genderRows) byGender[row.gender] = row.count;

        // By section
        const sectionRows = db
            .prepare(
                'SELECT section, COUNT(*) as count FROM students WHERE school_year = ? AND cycle_code = ? GROUP BY section'
            )
            .all(year, cycle);
        const bySection = {};
        for (const row of sectionRows) bySection[row.section] = row.count;

        return {
            totalStudents,
            maleCount: byGender['ذكر'] || 0,
            femaleCount: byGender['أنثى'] || 0,
            bySection
        };
    });

    // ── Catalogs/lookup ──

    handleAuthedRead(ipcMain, 'classes:getAll', ({ db, event }, schoolYear) => {
        const rows = db
            .prepare(
                `
            SELECT section
            FROM students
            WHERE school_year = ? AND cycle_code = ? AND section IS NOT NULL AND TRIM(section) <> ''
            GROUP BY section
            ORDER BY section
        `
            )
            .all(normalizeYear(schoolYear), resolveCycleForRequest(db, event));
        return rows.map((r) => ({ name: r.section }));
    });

    handleAuthedRead(ipcMain, 'subjects:getAll', ({ db, event }) => {
        const rows = db
            .prepare(
                `
            SELECT subject
            FROM grades
            WHERE cycle_code = ? AND subject IS NOT NULL AND TRIM(subject) <> ''
            GROUP BY subject
            ORDER BY subject
        `
            )
            .all(resolveCycleForRequest(db, event));

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
