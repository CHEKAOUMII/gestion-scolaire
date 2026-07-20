const { handleRead, handleWrite, normalizeYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');

function registerSchoolOpsIpc(ipcMain) {
    // ── Read handlers (no auth required) ──

    handleRead(ipcMain, 'studentFiles:getByYear', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const students = db
            .prepare('SELECT * FROM students WHERE school_year = ? ORDER BY section, full_name')
            .all(year);
        const files = db
            .prepare('SELECT student_id, doc_key, is_present FROM student_files WHERE school_year = ?')
            .all(year);

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

    handleWrite(ipcMain, 'studentFiles:upsert', WRITE_ROLES, (db, _event, payload) => {
        db.prepare(
            `
                INSERT INTO student_files(student_id, doc_key, is_present, school_year, updated_at)
                VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(student_id, doc_key, school_year)
                DO UPDATE SET is_present = excluded.is_present, updated_at = CURRENT_TIMESTAMP
            `
        ).run(payload.student_id, payload.doc_key, payload.is_present ? 1 : 0, payload.school_year);
        return { success: true };
    });

    handleWrite(ipcMain, 'studentFiles:upsertBulk', WRITE_ROLES, (db, _event, items) => {
        const { captureInputUpserts, notifyCaptureCommitted } = require('../sync/capture');
        const list = Array.isArray(items) ? items : [];
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
            captureInputUpserts(db, {
                tableName: 'student_files',
                keyFields: ['student_id', 'doc_key', 'school_year'],
                items: rows,
                operation: 'PUT'
            });
        });
        upsertMany(list);
        notifyCaptureCommitted();
        return { success: true, count: list.length };
    });

    handleWrite(ipcMain, 'studentFiles:setDocumentStatus', WRITE_ROLES, (db, _event, payload) => {
        db.prepare(
            `
                INSERT INTO student_files(student_id, doc_key, is_present, school_year, updated_at)
                VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(student_id, doc_key, school_year)
                DO UPDATE SET is_present = excluded.is_present, updated_at = CURRENT_TIMESTAMP
            `
        ).run(payload.student_id, payload.doc_key, payload.is_present ? 1 : 0, payload.school_year);
        return { success: true };
    });

    // ── Student movements (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'studentMovements:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT m.*, s.full_name, s.code
            FROM student_movements m
            LEFT JOIN students s ON s.id = m.student_id
            WHERE m.school_year = ?
            ORDER BY m.movement_date DESC, m.id DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'studentMovements:add', WRITE_ROLES, (db, _event, movement) => {
        const addMovement = db.transaction(() => {
            db.prepare(
                `
                    INSERT INTO student_movements(student_id, movement_type, from_section, to_section, movement_date, notes, school_year)
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                `
            ).run(
                movement.student_id,
                movement.movement_type,
                movement.from_section || null,
                movement.to_section || null,
                movement.movement_date,
                movement.notes || null,
                movement.school_year
            );

            if (movement.movement_type === 'internal' && movement.to_section) {
                db.prepare('UPDATE students SET section = ? WHERE id = ?').run(
                    movement.to_section,
                    movement.student_id
                );
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
    });

    handleRead(ipcMain, 'studentMovements:getStats', (db, schoolYear) => {
        const rows = db
            .prepare(
                `
            SELECT movement_type, COUNT(*) as count
            FROM student_movements
            WHERE school_year = ?
            GROUP BY movement_type
        `
            )
            .all(normalizeYear(schoolYear));
        const stats = { arrival: 0, departure: 0, internal: 0, dropout: 0 };
        for (const row of rows) stats[row.movement_type] = row.count;
        return stats;
    });
}

module.exports = { registerSchoolOpsIpc };
