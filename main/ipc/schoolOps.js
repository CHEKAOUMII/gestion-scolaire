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

function registerSchoolOpsIpc(ipcMain) {
    // ── Read handlers (no auth required) ──

    ipcMain.handle('studentFiles:getByYear', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        const students = db.prepare('SELECT * FROM students WHERE school_year = ? ORDER BY section, full_name').all(year);
        const files = db.prepare('SELECT student_id, doc_key, is_present FROM student_files WHERE school_year = ?').all(year);

        const byStudent = {};
        for (const row of files) {
            if (!byStudent[row.student_id]) byStudent[row.student_id] = {};
            byStudent[row.student_id][row.doc_key] = Number(row.is_present) === 1;
        }

        return students.map((student) => {
            const docs = byStudent[student.id] || {};
            const docsCount = Object.values(docs).filter(Boolean).length;
            return { ...student, docs, docsCount };
        });
    });

    // ── Write handlers (require admin or staff role) ──

    ipcMain.handle('studentFiles:upsert', async (event, payload) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            db.prepare(`
                INSERT INTO student_files(student_id, doc_key, is_present, school_year, updated_at)
                VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(student_id, doc_key, school_year)
                DO UPDATE SET is_present = excluded.is_present, updated_at = CURRENT_TIMESTAMP
            `).run(payload.student_id, payload.doc_key, payload.is_present ? 1 : 0, payload.school_year);
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('studentFiles:upsertBulk', async (event, items) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            const upsert = db.prepare(`
                INSERT INTO student_files(student_id, doc_key, is_present, school_year, updated_at)
                VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(student_id, doc_key, school_year)
                DO UPDATE SET is_present = excluded.is_present, updated_at = CURRENT_TIMESTAMP
            `);
            const upsertMany = db.transaction((rows) => {
                for (const payload of rows) {
                    upsert.run(payload.student_id, payload.doc_key, payload.is_present ? 1 : 0, payload.school_year);
                }
            });
            upsertMany(items);
            return { success: true, count: items.length };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('studentFiles:setDocumentStatus', async (event, payload) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            db.prepare(`
                INSERT INTO student_files(student_id, doc_key, is_present, school_year, updated_at)
                VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(student_id, doc_key, school_year)
                DO UPDATE SET is_present = excluded.is_present, updated_at = CURRENT_TIMESTAMP
            `).run(payload.student_id, payload.doc_key, payload.is_present ? 1 : 0, payload.school_year);
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    // ── Student movements (read = open, write = admin/staff) ──

    ipcMain.handle('studentMovements:getAll', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        return db.prepare(`
            SELECT m.*, s.full_name, s.code
            FROM student_movements m
            LEFT JOIN students s ON s.id = m.student_id
            WHERE m.school_year = ?
            ORDER BY m.movement_date DESC, m.id DESC
        `).all(year);
    });

    ipcMain.handle('studentMovements:add', async (event, movement) => {
        try {
            requireRole(event, ['admin', 'staff']);
            const db = getDb();
            const addMovement = db.transaction(() => {
                db.prepare(`
                    INSERT INTO student_movements(student_id, movement_type, from_section, to_section, movement_date, notes, school_year)
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                `).run(
                    movement.student_id,
                    movement.movement_type,
                    movement.from_section || null,
                    movement.to_section || null,
                    movement.movement_date,
                    movement.notes || null,
                    movement.school_year
                );

                if (movement.movement_type === 'internal' && movement.to_section) {
                    db.prepare('UPDATE students SET section = ? WHERE id = ?').run(movement.to_section, movement.student_id);
                }
                if (movement.movement_type === 'departure' || movement.movement_type === 'dropout') {
                    db.prepare("UPDATE students SET status = 'inactive' WHERE id = ?").run(movement.student_id);
                }
                if (movement.movement_type === 'arrival') {
                    db.prepare("UPDATE students SET status = 'active' WHERE id = ?").run(movement.student_id);
                }
            });
            addMovement();
            return { success: true };
        } catch (err) {
            return authErrorResponse(err);
        }
    });

    ipcMain.handle('studentMovements:getStats', async (event, schoolYear) => {
        const db = getDb();
        const year = schoolYear || '2025/2026';
        const rows = db.prepare(`
            SELECT movement_type, COUNT(*) as count
            FROM student_movements
            WHERE school_year = ?
            GROUP BY movement_type
        `).all(year);
        const stats = { arrival: 0, departure: 0, internal: 0, dropout: 0 };
        for (const row of rows) stats[row.movement_type] = row.count;
        return stats;
    });
}

module.exports = { registerSchoolOpsIpc };
