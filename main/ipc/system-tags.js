const { handleRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');

function registerSystemTagsIpc(ipcMain) {
    handleRead(ipcMain, 'systemTags:getByDate', (db, date, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `SELECT * FROM system_tags
                 WHERE tag_date = ? AND school_year = ?
                 ORDER BY entity_type, entity_name, id`
            )
            .all(date, year);
    });

    // All teacher-mentioned tags for the year (inspection visits, activities, …).
    // Consumed by tracking-teachers-performance to surface a teacher's
    // inspection visits and the activities they took part in.
    handleRead(ipcMain, 'systemTags:getTeacherTags', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `SELECT * FROM system_tags
                 WHERE entity_type = 'teacher' AND school_year = ?
                 ORDER BY tag_date DESC, id DESC`
            )
            .all(year);
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:save', WRITE_ROLES, (db, payload) => {
        const { id, tag_date, entity_type, entity_id, entity_name, tag_key, tag_label, details, school_year } = payload;
        requireFields(payload, ['tag_date', 'entity_type', 'entity_name', 'tag_key', 'tag_label', 'school_year']);
        const year = requireSchoolYear(school_year);

        if (id) {
            db.prepare(
                `UPDATE system_tags
                 SET tag_date = ?, entity_type = ?, entity_id = ?, entity_name = ?,
                     tag_key = ?, tag_label = ?, details = ?, school_year = ?
                 WHERE id = ?`
            ).run(tag_date, entity_type, entity_id || null, entity_name, tag_key, tag_label, details || '', year, id);
            return { success: true, id };
        } else {
            const result = db
                .prepare(
                    `INSERT INTO system_tags (tag_date, entity_type, entity_id, entity_name, tag_key, tag_label, details, school_year)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(tag_date, entity_type, entity_id || null, entity_name, tag_key, tag_label, details || '', year);
            return { success: true, id: result.lastInsertRowid };
        }
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:delete', WRITE_ROLES, (db, tagId) => {
        if (!tagId) return { success: false, error: 'Invalid ID' };
        db.prepare('DELETE FROM system_tags WHERE id = ?').run(tagId);
        return { success: true };
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:saveNote', WRITE_ROLES, (db, payload) => {
        const {
            tag_date,
            tag_key,
            tag_label,
            note_text,
            mentions,
            school_year,
            details,
            replace_note_group,
            replace_tag_id,
            replace_legacy_event_id
        } = payload;
        requireFields(payload, ['tag_date', 'tag_key', 'tag_label', 'school_year']);
        const year = requireSchoolYear(school_year);
        const replaceNoteGroup = typeof replace_note_group === 'string' && replace_note_group.trim()
            ? replace_note_group.trim()
            : null;
        const replaceTagId = Number(replace_tag_id) > 0 ? Number(replace_tag_id) : null;
        const replaceLegacyEventId = Number(replace_legacy_event_id) > 0 ? Number(replace_legacy_event_id) : null;

        // Accept a caller-supplied idempotency key so retries reuse the same group
        // and are blocked by uidx_system_tags_note_entity; fall back to a fresh UUID.
        const noteGroup = (payload.note_group && typeof payload.note_group === 'string')
            ? payload.note_group
            : require('crypto').randomUUID();

        const deleteNoteGroupStmt = db.prepare('DELETE FROM system_tags WHERE note_group = ?');
        const deleteTagStmt = db.prepare('DELETE FROM system_tags WHERE id = ?');
        const deleteLegacyEventStmt = db.prepare('DELETE FROM school_events WHERE id = ?');
        const stmt = db.prepare(
            `INSERT INTO system_tags
             (tag_date, entity_type, entity_id, entity_name, tag_key, tag_label, note_group, note_text, details, school_year)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        const txn = db.transaction((items) => {
            if (replaceTagId) {
                deleteTagStmt.run(replaceTagId);
            }
            if (replaceNoteGroup) {
                deleteNoteGroupStmt.run(replaceNoteGroup);
            }
            if (items && items.length > 0) {
                for (const m of items) {
                    stmt.run(tag_date, m.type, m.id || null, m.name, tag_key, tag_label, noteGroup, note_text, details || '', year);
                }
            } else {
                // No mentions — save as a general entry
                stmt.run(tag_date, 'general', null, tag_label, tag_key, tag_label, noteGroup, note_text, details || '', year);
            }
            if (replaceLegacyEventId) {
                deleteLegacyEventStmt.run(replaceLegacyEventId);
            }
        });

        txn(mentions || []);
        return { success: true, noteGroup };
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:deleteByGroup', WRITE_ROLES, (db, noteGroup) => {
        if (!noteGroup) return { success: false, error: 'Invalid group' };
        db.prepare('DELETE FROM system_tags WHERE note_group = ?').run(noteGroup);
        return { success: true };
    });
}

module.exports = { registerSystemTagsIpc };
