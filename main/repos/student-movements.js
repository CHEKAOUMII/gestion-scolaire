'use strict';

/** student_movements SQL and ownership resolution; cycle resolution stays in the repository. */
const { requireCycle, resolveStudentForCycle } = require('./student-cycle');

function listByYear(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db
        .prepare(
            `
        SELECT m.*, s.full_name, s.code
        FROM student_movements m
        LEFT JOIN students s ON s.id = m.student_id
        WHERE m.school_year = ? AND (s.id IS NULL OR s.cycle_code = ?)
        ORDER BY m.movement_date DESC, m.id DESC
    `
        )
        .all(year, cycle);
}

function getStats(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const rows = db
        .prepare(
            `
        SELECT movement_type, COUNT(*) as count
        FROM student_movements
        WHERE school_year = ? AND cycle_code = ?
        GROUP BY movement_type
    `
        )
        .all(year, cycle);
    const stats = { arrival: 0, departure: 0, internal: 0, dropout: 0 };
    for (const row of rows) stats[row.movement_type] = row.count;
    return stats;
}

/**
 * Single movement write. Ownership resolves from massar_code first, then
 * student_code (the legacy student_id payload never reaches this repo); the
 * resolved row id is authoritative. All student side-effects are cycle-guarded.
 */
function addMovement(db, movement, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const code = String(movement.massar_code || movement.student_code || '').trim();
    const student = resolveStudentForCycle(db, code, movement.school_year, cycle);
    db.transaction(() => {
        db.prepare(
            `
            INSERT INTO student_movements(student_id, movement_type, from_section, to_section, movement_date, notes, school_year, cycle_code)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
            student.id,
            movement.movement_type,
            movement.from_section || null,
            movement.to_section || null,
            movement.movement_date,
            movement.notes || null,
            movement.school_year,
            cycle
        );

        if (movement.movement_type === 'internal' && movement.to_section) {
            db.prepare('UPDATE students SET section = ? WHERE id = ? AND cycle_code = ?').run(
                movement.to_section,
                student.id,
                cycle
            );
        }
        if (movement.movement_type === 'departure' || movement.movement_type === 'dropout') {
            db.prepare("UPDATE students SET status = 'inactive' WHERE id = ? AND cycle_code = ?").run(
                student.id,
                cycle
            );
        }
        if (movement.movement_type === 'arrival') {
            db.prepare("UPDATE students SET status = 'active' WHERE id = ? AND cycle_code = ?").run(
                student.id,
                cycle
            );
        }
    })();
    return { success: true };
}

module.exports = { listByYear, getStats, addMovement };
