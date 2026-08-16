const { handleRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');
const systemTagsRepo = require('../repos/system-tags');

function registerSystemTagsIpc(ipcMain) {
    handleRead(ipcMain, 'systemTags:getByDate', (db, date, schoolYear) => {
        return systemTagsRepo.listByDate(db, date, normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'systemTags:getTeacherTags', (db, schoolYear) => {
        return systemTagsRepo.listTeacherTags(db, normalizeYear(schoolYear));
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:save', WRITE_ROLES, (db, payload) => {
        const { id, tag_date, entity_type, entity_id, entity_name, tag_key, tag_label, details, school_year } = payload;
        requireFields(payload, ['tag_date', 'entity_type', 'entity_name', 'tag_key', 'tag_label', 'school_year']);
        const year = requireSchoolYear(school_year);

        if (id) {
            systemTagsRepo.updateById(db, {
                id,
                tag_date,
                entity_type,
                entity_id: entity_id || null,
                entity_name,
                tag_key,
                tag_label,
                details: details || '',
                school_year: year
            });
            return { success: true, id };
        } else {
            const result = systemTagsRepo.insert(db, {
                tag_date,
                entity_type,
                entity_id: entity_id || null,
                entity_name,
                tag_key,
                tag_label,
                details: details || '',
                school_year: year
            });
            return { success: true, id: result.lastInsertRowid };
        }
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:delete', WRITE_ROLES, (db, tagId) => {
        if (!tagId) return { success: false, error: 'Invalid ID' };
        systemTagsRepo.deleteById(db, tagId);
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

        const noteGroup = (payload.note_group && typeof payload.note_group === 'string')
            ? payload.note_group
            : require('crypto').randomUUID();

        systemTagsRepo.saveNote(db, {
            tag_date,
            tag_key,
            tag_label,
            noteGroup,
            note_text,
            mentions,
            details: details || '',
            year,
            replaceTagId,
            replaceNoteGroup,
            replaceLegacyEventId
        });

        return { success: true, noteGroup };
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:deleteByGroup', WRITE_ROLES, (db, noteGroup) => {
        if (!noteGroup) return { success: false, error: 'Invalid group' };
        const count = systemTagsRepo.deleteByGroup(db, noteGroup);
        return { success: true, count };
    });
}

module.exports = { registerSystemTagsIpc };
