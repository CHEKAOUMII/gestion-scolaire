const { handleRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');

function registerDailyReportIpc(ipcMain) {
    handleRead(ipcMain, 'dailyReport:getData', (db, date, schoolYear) => {
        const year = normalizeYear(schoolYear);

        // 1. Teacher absences from teacher_absences table (legacy)
        const absences = db
            .prepare(
                `
            SELECT a.*, t.full_name, t.subject
            FROM teacher_absences a
            LEFT JOIN teachers t ON t.id = a.teacher_id
            WHERE a.absence_date = ? AND a.school_year = ?
            ORDER BY t.full_name
        `
            )
            .all(date, year);

        // 1b. Staff attendance records for the given date (new table)
        const staffRecords = db
            .prepare(
                `
            SELECT sa.*,
                   COALESCE(t.full_name, sa.teacher_name) as full_name,
                   COALESCE(sa.subject, t.subject, '') as subject
            FROM staff_attendance sa
            LEFT JOIN teachers t ON t.id = sa.teacher_id
            WHERE sa.attendance_date = ? AND sa.school_year = ?
            ORDER BY sa.type, COALESCE(t.full_name, sa.teacher_name)
        `
            )
            .all(date, year);

        // Fill in missing subjects from grades table
        const recordsNeedingSubject = staffRecords.filter((r) => !r.subject && (r.full_name || r.teacher_name));
        if (recordsNeedingSubject.length > 0) {
            const gradeSubjects = new Map();
            try {
                const gs = db
                    .prepare(
                        `
                    SELECT teacher_id, teacher_name, subject
                    FROM grades
                    WHERE school_year = ?
                      AND subject IS NOT NULL AND TRIM(subject) <> ''
                      AND ((teacher_id IS NOT NULL AND teacher_id > 0) OR (teacher_name IS NOT NULL AND TRIM(teacher_name) <> ''))
                `
                    )
                    .all(year);
                for (const row of gs) {
                    const key = row.teacher_id ? `id:${row.teacher_id}` : `name:${row.teacher_name}`;
                    const current = gradeSubjects.get(key);
                    if (!current) {
                        gradeSubjects.set(key, new Set());
                    }
                    gradeSubjects.get(key).add(row.subject);
                }
            } catch {
                /* ignore */
            }
            for (const r of recordsNeedingSubject) {
                const byId = r.teacher_id ? gradeSubjects.get(`id:${r.teacher_id}`) : null;
                const byName = gradeSubjects.get(`name:${r.full_name}`) || gradeSubjects.get(`name:${r.teacher_name}`);
                const subjectSet = byId || byName;
                r.subject = subjectSet ? Array.from(subjectSet).join(', ') : '';
            }
        }

        // Separate into absences and tardiness
        const staffAbsences = staffRecords.filter((r) => r.type === 'absence');
        const staffTardiness = staffRecords.filter((r) => r.type === 'late');

        // 2. Teacher → sections mapping (derived from grades)
        const teacherSectionRows = db
            .prepare(
                `
            SELECT teacher_id, teacher_name, section
            FROM grades
            WHERE school_year = ?
              AND section IS NOT NULL AND TRIM(section) <> ''
              AND ((teacher_id IS NOT NULL AND teacher_id > 0) OR (teacher_name IS NOT NULL AND TRIM(teacher_name) <> ''))
        `
            )
            .all(year);

        const teacherSections = {};
        for (const row of teacherSectionRows) {
            const key = row.teacher_id ? `id:${row.teacher_id}` : `name:${row.teacher_name}`;
            if (!teacherSections[key]) {
                teacherSections[key] = [];
            }
            if (!teacherSections[key].includes(row.section)) {
                teacherSections[key].push(row.section);
            }
            if (row.teacher_name) {
                if (!teacherSections[row.teacher_name]) {
                    teacherSections[row.teacher_name] = [];
                }
                if (!teacherSections[row.teacher_name].includes(row.section)) {
                    teacherSections[row.teacher_name].push(row.section);
                }
            }
        }

        // 3. Student counts per section
        const sectionRows = db
            .prepare(
                `
            SELECT section, COUNT(*) as count
            FROM students
            WHERE school_year = ? AND status = 'active'
              AND section IS NOT NULL AND TRIM(section) <> ''
            GROUP BY section
            ORDER BY section
        `
            )
            .all(year);

        const sectionStudentCounts = {};
        for (const row of sectionRows) {
            sectionStudentCounts[row.section] = row.count;
        }

        // 4. All sections list
        const allSections = sectionRows.map((r) => r.section);

        // 5. Affected sections — combine legacy absences + new staff absences
        const affectedSections = {};
        const allAbsenceRecords = [...absences, ...staffAbsences];
        for (const absence of allAbsenceRecords) {
            const name = absence.full_name;
            const teacherKey = absence.teacher_id ? `id:${absence.teacher_id}` : `name:${name}`;
            if (name && teacherSections[teacherKey] && !affectedSections[name]) {
                affectedSections[name] = teacherSections[teacherKey];
            }
        }

        // 6. School events for this date
        const events = db
            .prepare(
                `
            SELECT * FROM school_events
            WHERE event_date = ? AND school_year = ?
            ORDER BY event_time, id
        `
            )
            .all(date, year);

        // 7. System tags for this date
        let tags = [];
        try {
            tags = db
                .prepare(
                    `SELECT * FROM system_tags
                     WHERE tag_date = ? AND school_year = ?
                     ORDER BY entity_type, entity_name, id`
                )
                .all(date, year);
        } catch { /* table may not exist yet */ }

        // 8. Merge legacy school_events into tags format
        const EVENT_TYPE_TO_TAG_KEY = {
            'زيارة تفتيشية': 'inspection',
            'اجتماع': 'meeting',
            'نشاط تربوي': 'educational_activity',
            'عطلة / توقف': 'holiday',
            'حادث مدرسي': 'school_incident',
            'إضراب': 'strike',
            'تكوين / ورشة': 'training',
            'امتحان': 'exam',
            'زيارة رسمية': 'official_visit',
            'أخرى': 'other'
        };
        for (const ev of events) {
            const tagKey = EVENT_TYPE_TO_TAG_KEY[ev.event_type] || 'other';
            const eventDetails = ev.details || '';
            const detailsField = ev.event_time
                ? `time::${ev.event_time}|${eventDetails}`
                : eventDetails;
            tags.push({
                id: -ev.id,
                tag_date: ev.event_date,
                entity_type: 'general',
                entity_id: null,
                entity_name: ev.event_type || 'أخرى',
                tag_key: tagKey,
                tag_label: ev.event_type || 'أخرى',
                note_group: `legacy-event-${ev.id}`,
                note_text: eventDetails,
                details: detailsField,
                school_year: ev.school_year,
                created_at: ev.created_at || null,
                _legacy_event: true
            });
        }

        return {
            absences,
            staffAbsences,
            staffTardiness,
            teacherSections,
            sectionStudentCounts,
            allSections,
            affectedSections,
            events,
            tags
        };
    });

    // ── School Events CRUD ──

    handleWriteSoftAuth(ipcMain, 'schoolEvents:save', WRITE_ROLES, (db, payload) => {
        const { id, event_date, event_type, details, event_time, school_year } = payload;
        requireFields(payload, ['event_date', 'event_type', 'school_year']);
        const year = requireSchoolYear(school_year);

        if (id) {
            db.prepare(
                `
                UPDATE school_events
                SET event_type = ?, details = ?, event_time = ?, event_date = ?, school_year = ?
                WHERE id = ?
            `
            ).run(event_type, details || '', event_time || '', event_date, year, id);
            return { success: true, id };
        } else {
            const result = db
                .prepare(
                    `
                INSERT INTO school_events (event_date, event_type, details, event_time, school_year)
                VALUES (?, ?, ?, ?, ?)
            `
                )
                .run(event_date, event_type, details || '', event_time || '', year);
            return { success: true, id: result.lastInsertRowid };
        }
    });

    handleWriteSoftAuth(ipcMain, 'schoolEvents:delete', WRITE_ROLES, (db, eventId) => {
        if (!eventId) return { success: false, error: 'Invalid ID' };
        db.prepare('DELETE FROM school_events WHERE id = ?').run(eventId);
        return { success: true };
    });
}

module.exports = { registerDailyReportIpc };
