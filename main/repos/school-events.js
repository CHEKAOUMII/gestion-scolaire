'use strict';
// ISOLATION-CARVEOUT (Slice 0): school_events carries no cycle_code by design (institution-wide calendar).

/**
 * School events repository.
 * Owns SQL for the `school_events` table (legacy calendar events surfaced in
 * the daily report and merged into the system-tags format); IPC stays auth,
 * all-cycle write guard, and validation.
 */

function listByDate(db, date, year) {
    return db
        .prepare(
            `
            SELECT * FROM school_events
            WHERE event_date = ? AND school_year = ?
            ORDER BY event_time, id
        `
        )
        .all(date, year);
}

function updateById(db, ev) {
    db.prepare(
        `
        UPDATE school_events
        SET event_type = ?, details = ?, event_time = ?, event_date = ?, school_year = ?
        WHERE id = ?
    `
    ).run(ev.event_type, ev.details, ev.event_time, ev.event_date, ev.school_year, ev.id);
}

function insert(db, ev) {
    return db
        .prepare(
            `
        INSERT INTO school_events (event_date, event_type, details, event_time, school_year)
        VALUES (?, ?, ?, ?, ?)
    `
        )
        .run(ev.event_date, ev.event_type, ev.details, ev.event_time, ev.school_year);
}

function deleteById(db, eventId) {
    return db.prepare('DELETE FROM school_events WHERE id = ?').run(eventId);
}

module.exports = { listByDate, updateById, insert, deleteById };
