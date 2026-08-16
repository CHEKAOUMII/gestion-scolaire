'use strict';

/**
 * System tags repository.
 * Owns SQL for `system_tags` (note-based daily-observation tags) and the legacy
 * `school_events` row replaced by a note save. Note saves and group deletes
 * capture explicitly inside their transactions via capture-port (channels
 * registered captureMode 'explicit' — the generic wrapper never double-captures).
 */

const { captureDeletesFromRows, captureResolvedRows, notifyCaptureCommitted } = require('./capture-port');

function listByDate(db, date, year) {
    return db
        .prepare(
            `SELECT * FROM system_tags
             WHERE tag_date = ? AND school_year = ?
             ORDER BY entity_type, entity_name, id`
        )
        .all(date, year);
}

// All teacher-mentioned tags for the year (inspection visits, activities, …).
// Consumed by tracking-teachers-performance to surface a teacher's
// inspection visits and the activities they took part in.
function listTeacherTags(db, year) {
    return db
        .prepare(
            `SELECT * FROM system_tags
             WHERE entity_type = 'teacher' AND school_year = ?
             ORDER BY tag_date DESC, id DESC`
        )
        .all(year);
}

function updateById(db, tag) {
    db.prepare(
        `UPDATE system_tags
         SET tag_date = ?, entity_type = ?, entity_id = ?, entity_name = ?,
             tag_key = ?, tag_label = ?, details = ?, school_year = ?
         WHERE id = ?`
    ).run(
        tag.tag_date,
        tag.entity_type,
        tag.entity_id,
        tag.entity_name,
        tag.tag_key,
        tag.tag_label,
        tag.details,
        tag.school_year,
        tag.id
    );
}

function insert(db, tag) {
    return db
        .prepare(
            `INSERT INTO system_tags (tag_date, entity_type, entity_id, entity_name, tag_key, tag_label, details, school_year)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
            tag.tag_date,
            tag.entity_type,
            tag.entity_id,
            tag.entity_name,
            tag.tag_key,
            tag.tag_label,
            tag.details,
            tag.school_year
        );
}

function deleteById(db, tagId) {
    return db.prepare('DELETE FROM system_tags WHERE id = ?').run(tagId);
}

/**
 * Save a note: optionally replace a single tag and/or a previous note group,
 * insert one row per mention (or a single general row), capture the created
 * rows, and delete a legacy school_events row — all in one transaction.
 * The note payload arrives validated; `noteGroup` is the caller-resolved
 * idempotency key.
 */
function saveNote(db, note) {
    const deleteNoteGroupStmt = db.prepare('DELETE FROM system_tags WHERE note_group = ?');
    const deleteTagStmt = db.prepare('DELETE FROM system_tags WHERE id = ?');
    const deleteLegacyEventStmt = db.prepare('DELETE FROM school_events WHERE id = ?');
    const selectById = db.prepare('SELECT * FROM system_tags WHERE id = ?');
    const selectByGroup = db.prepare('SELECT * FROM system_tags WHERE note_group = ?');
    const stmt = db.prepare(
        `INSERT INTO system_tags
         (tag_date, entity_type, entity_id, entity_name, tag_key, tag_label, note_group, note_text, details, school_year)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const txn = db.transaction((items) => {
        if (note.replaceTagId) {
            const old = selectById.get(note.replaceTagId);
            if (old) captureDeletesFromRows(db, 'system_tags', [old]);
            deleteTagStmt.run(note.replaceTagId);
        }
        if (note.replaceNoteGroup) {
            const oldGroup = selectByGroup.all(note.replaceNoteGroup);
            captureDeletesFromRows(db, 'system_tags', oldGroup);
            deleteNoteGroupStmt.run(note.replaceNoteGroup);
        }
        if (items && items.length > 0) {
            for (const m of items) {
                stmt.run(
                    note.tag_date,
                    m.type,
                    m.id || null,
                    m.name,
                    note.tag_key,
                    note.tag_label,
                    note.noteGroup,
                    note.note_text,
                    note.details,
                    note.year
                );
            }
        } else {
            // No mentions — save as a general entry
            stmt.run(
                note.tag_date,
                'general',
                null,
                note.tag_label,
                note.tag_key,
                note.tag_label,
                note.noteGroup,
                note.note_text,
                note.details,
                note.year
            );
        }
        const created = selectByGroup.all(note.noteGroup);
        captureResolvedRows(db, 'system_tags', created, 'PUT');
        if (note.replaceLegacyEventId) {
            deleteLegacyEventStmt.run(note.replaceLegacyEventId);
        }
    });

    txn(note.mentions || []);
    notifyCaptureCommitted();
}

function deleteByGroup(db, noteGroup) {
    const run = db.transaction((group) => {
        const rows = db.prepare('SELECT * FROM system_tags WHERE note_group = ?').all(group);
        captureDeletesFromRows(db, 'system_tags', rows);
        return db.prepare('DELETE FROM system_tags WHERE note_group = ?').run(group).changes;
    });
    const count = run(noteGroup);
    notifyCaptureCommitted();
    return count;
}

module.exports = { listByDate, listTeacherTags, updateById, insert, deleteById, saveNote, deleteByGroup };
