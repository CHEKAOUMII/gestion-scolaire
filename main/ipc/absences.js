const { getDb } = require('../db/context');
const { requireRole } = require('./auth');

function authErrorResponse(err) {
    const isAuthError = err?.code === 'UNAUTHENTICATED' || err?.code === 'FORBIDDEN';
    return {
        success: false,
        code: isAuthError ? err.code : 'INTERNAL_ERROR',
        error: err?.message || (isAuthError ? 'غير مصرح' : 'حدث خطأ داخلي')
    };
}

function registerAbsencesIpc(ipcMain) {
    // ── Read handlers (no auth required — app starts without login) ──

    ipcMain.handle('absences:getAll', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        return db.prepare(`
            SELECT a.*,
            COALESCE(sid.full_name, scode.full_name) as full_name,
            COALESCE(sid.section, scode.section) as section
            FROM absences a 
            LEFT JOIN students sid ON a.student_id = sid.id 
            LEFT JOIN students scode ON scode.code = a.student_code AND scode.school_year = a.school_year
            WHERE a.school_year = ?
            ORDER BY a.absence_date DESC
        `).all(year);
    });

    ipcMain.handle('absences:getByStudent', async (event, studentId) => {
        const db = getDb();
        return db.prepare('SELECT * FROM absences WHERE student_id = ? ORDER BY absence_date DESC').all(studentId);
    });

    ipcMain.handle('absences:getBySection', async (event, section, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        return db.prepare(`
            SELECT a.*, s.full_name, s.family_name, s.code as student_code
            FROM absences a 
            LEFT JOIN students s ON a.student_id = s.id 
            WHERE s.section = ? AND a.school_year = ?
            ORDER BY s.full_name
        `).all(section, year);
    });

    // ── Write handlers (require admin or staff role) ──

    ipcMain.handle('absences:save', async (event, absence) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            db.prepare(`
                INSERT INTO absences(student_id, student_code, absence_date, month, absence_type, hours, days, reason, school_year)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                absence.student_id,
                absence.student_code,
                absence.absence_date,
                absence.month,
                absence.absence_type,
                absence.hours,
                absence.days,
                absence.reason,
                absence.school_year
            );
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    // No auth: bulk-import is used by settings-imports page before login
    ipcMain.handle('absences:saveBulk', async (event, absences) => {
        try {
            const db = getDb();
            const check = db.prepare(`
                SELECT id FROM absences 
                WHERE student_code = ? AND month = ? AND school_year = ? AND absence_type = ?
            `);
            const update = db.prepare(`
                UPDATE absences SET hours = ?, days = ?
                WHERE student_code = ? AND month = ? AND school_year = ? AND absence_type = ?
            `);
            const insert = db.prepare(`
                INSERT INTO absences(student_id, student_code, absence_date, month, absence_type, hours, days, reason, school_year)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const upsertMany = db.transaction((items) => {
                for (const absence of items) {
                    const exists = check.get(absence.student_code, absence.month, absence.school_year, absence.absence_type);

                    if (exists) {
                        update.run(
                            absence.hours,
                            absence.days,
                            absence.student_code,
                            absence.month,
                            absence.school_year,
                            absence.absence_type
                        );
                    } else {
                        insert.run(
                            absence.student_id,
                            absence.student_code,
                            absence.absence_date,
                            absence.month,
                            absence.absence_type,
                            absence.hours,
                            absence.days,
                            absence.reason,
                            absence.school_year
                        );
                    }
                }
            });
            upsertMany(absences);
            return { success: true, count: absences.length };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('absences:delete', async (event, id) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            db.prepare('DELETE FROM absences WHERE id = ?').run(id);
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    // ── Read stats (no auth required) ──

    ipcMain.handle('absences:getStats', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';

        const { total: totalHours } = db.prepare('SELECT COALESCE(SUM(hours), 0) as total FROM absences WHERE school_year = ?').get(year);

        const bySection = db.prepare(`
            SELECT s.section, SUM(a.hours) as total_hours, COUNT(DISTINCT a.student_id) as students_count
            FROM absences a
            LEFT JOIN students s ON a.student_id = s.id
            WHERE a.school_year = ?
            GROUP BY s.section
        `).all(year);

        const byMonth = db.prepare(`
            SELECT month, SUM(hours) as total_hours
            FROM absences WHERE school_year = ?
            GROUP BY month
        `).all(year);

        const topAbsentees = db.prepare(`
            SELECT a.student_id, a.student_code, s.full_name, s.section, SUM(a.hours) as total_hours
            FROM absences a
            LEFT JOIN students s ON a.student_id = s.id
            WHERE a.school_year = ?
            GROUP BY a.student_id
            ORDER BY total_hours DESC
            LIMIT 10
        `).all(year);

        return { totalHours, bySection, byMonth, topAbsentees };
    });

    ipcMain.handle('absences:getSummaryByStudent', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        return db.prepare(`
            SELECT a.student_id, a.student_code, s.full_name, s.family_name, s.section,
            SUM(a.hours) as total_hours,
            SUM(CASE WHEN a.absence_type = 'justified' THEN a.hours ELSE 0 END) as justified_hours,
            SUM(CASE WHEN a.absence_type = 'unjustified' THEN a.hours ELSE 0 END) as unjustified_hours
            FROM absences a
            LEFT JOIN students s ON a.student_id = s.id
            WHERE a.school_year = ?
            GROUP BY a.student_id
            ORDER BY total_hours DESC
        `).all(year);
    });

    ipcMain.handle('absence:getByClass', async (event, className = '', schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        const section = String(className || '').trim();
        return db.prepare(`
            SELECT a.student_code as massar_code,
            COALESCE(s.full_name, a.student_code) as student_name,
            COALESCE(s.section, '') as class_name,
            SUM(CASE WHEN a.absence_type = 'justified' THEN a.hours ELSE 0 END) as justified_hours,
            SUM(CASE WHEN a.absence_type = 'unjustified' THEN a.hours ELSE 0 END) as unjustified_hours
            FROM absences a
            LEFT JOIN students s ON s.code = a.student_code AND s.school_year = a.school_year
            WHERE a.school_year = ?
            AND(? = '' OR COALESCE(s.section, '') = ?)
            GROUP BY a.student_code, COALESCE(s.full_name, a.student_code), COALESCE(s.section, '')
            ORDER BY COALESCE(s.section, ''), COALESCE(s.full_name, a.student_code)
        `).all(year, section, section);
    });

    // ── Correspondence (read = open, write = admin/staff) ──

    ipcMain.handle('correspondence:getAll', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        return db.prepare(`
            SELECT c.*, s.full_name, s.section 
            FROM correspondence c 
            LEFT JOIN students s ON c.student_id = s.id 
            WHERE c.school_year = ?
            ORDER BY c.letter_date DESC
        `).all(year);
    });

    ipcMain.handle('correspondence:save', async (event, letter) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            const info = db.prepare(`
                INSERT INTO correspondence(student_id, student_code, letter_type, letter_date, total_hours, school_year)
                VALUES(?, ?, ?, ?, ?, ?)
            `).run(
                letter.student_id,
                letter.student_code,
                letter.letter_type,
                letter.letter_date,
                letter.total_hours,
                letter.school_year
            );
            return { success: true, id: info.lastInsertRowid };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('correspondence:getByStudent', async (event, studentId) => {
        const db = getDb();
        return db.prepare('SELECT * FROM correspondence WHERE student_id = ? ORDER BY letter_date DESC').all(studentId);
    });

    ipcMain.handle('correspondence:markPrinted', async (event, id) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            db.prepare('UPDATE correspondence SET printed = 1 WHERE id = ?').run(id);
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    // No auth: used by settings-imports page to clear data before re-import
    ipcMain.handle('absences:deleteByYear', async (event, schoolYear) => {
        try {
            const db = getDb();
            const year = schoolYear || '2025/2026';
            db.prepare('DELETE FROM absences WHERE school_year = ?').run(year);
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });
}

module.exports = { registerAbsencesIpc };
