const { handleAuthedRead, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { resolveCycleForRequest } = require('../auth/resolve-cycle');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');
const { getCycleDefinition } = require('../../js/shared/education/cycles');
const dailyReportRepo = require('../repos/daily-report');
const schoolEventsRepo = require('../repos/school-events');
const systemTagsRepo = require('../repos/system-tags');

const ADMINISTRATIVE_REPORT_ROLES = new Set(['admin', 'principal', 'developer']);
const ALL_CYCLE_VALUES = new Set(['all', 'all_cycles', 'all-cycles']);

function reportError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function parseReportRequest(schoolYearOrContext) {
    if (schoolYearOrContext && typeof schoolYearOrContext === 'object') {
        return {
            schoolYear: schoolYearOrContext.schoolYear,
            cycleCode: String(schoolYearOrContext.cycleCode || '').trim() || null
        };
    }
    return { schoolYear: schoolYearOrContext, cycleCode: null };
}

function rejectAllCycleWrite(payload) {
    const requested = String(payload?.scope || payload?.cycle_code || payload?.cycleCode || '').trim().toLowerCase();
    if (ALL_CYCLE_VALUES.has(requested)) {
        throw reportError('عمليات الكتابة تتطلب تحديد سلك واحد', 'ALL_CYCLES_WRITE_FORBIDDEN');
    }
}

function getKnownCycleCodes(db, fallbackCycle) {
    try {
        const rows = dailyReportRepo.listKnownCycleCodes(db);
        const codes = rows.map((row) => String(row.cycle_code).trim()).filter(Boolean);
        if (codes.length) return [...new Set([...codes, ...(fallbackCycle ? [fallbackCycle] : [])])];
    } catch {
        // Single-cycle installations may not have institution_cycles yet.
    }
    return fallbackCycle ? [fallbackCycle] : [];
}

function resolveReportScope(db, event, session, request) {
    const requestedCycle = request.cycleCode;
    if (requestedCycle && ALL_CYCLE_VALUES.has(requestedCycle.toLowerCase())) {
        // The all-cycles gate is a pure role decision — it must never be shadowed by
        // an unrelated cycle-resolution failure (multi-stage review, Phase 4A).
        if (!ADMINISTRATIVE_REPORT_ROLES.has(session?.role)) {
            throw reportError('التقرير المجمع بين الأسلاك مخصص للإدارة فقط', 'ALL_CYCLES_REPORT_FORBIDDEN');
        }
        let activeCycle = null;
        try {
            activeCycle = resolveCycleForRequest(db, event);
        } catch {
            // Administrative aggregate reports do not depend on a single active
            // cycle; the institution rows below are authoritative. The active
            // cycle only feeds the fallback when no rows exist.
        }
        return {
            cycleCode: 'all',
            cycleCodes: getKnownCycleCodes(db, activeCycle),
            label: 'تقرير إداري مجمع — جميع الأسلاك',
            administrative: true
        };
    }

    const activeCycle = resolveCycleForRequest(db, event);
    if (requestedCycle && requestedCycle !== activeCycle) {
        throw reportError('السلك المطلوب لا يطابق السلك النشط للجلسة', 'REPORT_CYCLE_MISMATCH');
    }
    const definition = getCycleDefinition(activeCycle);
    return {
        cycleCode: activeCycle,
        cycleCodes: [activeCycle],
        label: definition?.labelAr || activeCycle,
        administrative: false
    };
}

function normalizeTimetableName(value) {
    return String(value || '')
        .replace(/_/g, ' ')
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/\bال/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function timetableTeacherKeys(data, teacherId, teacherName) {
    const entries = new Map();
    Object.entries(data?.teacherMetaByKey || {}).forEach(([key, entry]) => entries.set(key, entry || {}));
    (Array.isArray(data?.teachers) ? data.teachers : []).forEach((entry) => {
        const key = String(entry?.key || entry?.name || '').trim();
        if (key && !entries.has(key)) entries.set(key, entry);
    });
    Object.keys(data?.timetables || {}).forEach((key) => {
        if (!entries.has(key)) entries.set(key, { teacherName: key });
    });

    const id = Number(teacherId) || null;
    const name = String(teacherName || '').trim();
    const normalized = normalizeTimetableName(name);
    const fields = (key, entry) => [
        entry?.teacherName,
        entry?.displayName,
        entry?.sourceDisplayName,
        entry?.sourceName,
        key.replace(/^tafwij:/, '').replace(/_/g, ' ')
    ];
    const byId = id ? [...entries].filter(([, entry]) => Number(entry?.teacherId) === id).map(([key]) => key) : [];
    if (byId.length) return byId;
    const exact = [...entries].filter(([key, entry]) => fields(key, entry).some((value) => String(value || '').trim() === name)).map(([key]) => key);
    if (exact.length) return exact;
    return [...entries]
        .filter(([key, entry]) => fields(key, entry).some((value) => {
            const candidate = normalizeTimetableName(value);
            return candidate && normalized && (candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate));
        }))
        .map(([key]) => key);
}

function hasScheduledSession(data, teacherId, teacherName, date, period) {
    const dateValue = new Date(`${date}T00:00:00`);
    if (Number.isNaN(dateValue.getTime())) return false;
    const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const dayName = dayNames[dateValue.getDay()];
    const keys = timetableTeacherKeys(data, teacherId, teacherName);
    const periods = period === 'morning' || period === 'afternoon' ? [period] : ['morning', 'afternoon'];
    return keys.some((key) => periods.some((periodName) => {
        const hours = data?.timetables?.[key]?.[dayName]?.[periodName];
        return hours && Object.values(hours).some((lesson) => lesson && typeof lesson === 'object' && (lesson.subject || lesson.students));
    }));
}

function getLinkedSessionCycles(db, year, record, cycleCodes) {
    const table = (() => {
        try {
            return dailyReportRepo.timetableTableExists(db);
        } catch {
            return false;
        }
    })();
    if (!table) return [];

    const rows = dailyReportRepo.listTimetableRows(db, year);
    const allowed = new Set(cycleCodes);
    return rows
        .filter((row) => allowed.has(String(row.cycle_code || '').trim()))
        .filter((row) => {
            try {
                return hasScheduledSession(
                    JSON.parse(row.data_json || '{}'),
                    record.teacher_id,
                    record.full_name || record.teacher_name,
                    record.attendance_date || record.absence_date,
                    record.absence_period || 'full_day'
                );
            } catch {
                return false;
            }
        })
        .map((row) => String(row.cycle_code).trim())
        .filter(Boolean);
}

function annotateLinkedSession(record, db, year, cycleCodes) {
    const linkedCodes = [...new Set(getLinkedSessionCycles(db, year, record, cycleCodes))];
    const labels = linkedCodes.map((code) => getCycleDefinition(code)?.labelAr || code);
    return {
        ...record,
        linked_session_cycle_codes: linkedCodes,
        linked_session_cycle_labels: labels,
        linked_session_cycle_label: labels.length === 1 ? labels[0] : labels.join('، '),
        cycle_resolution: labels.length === 1 ? 'linked' : labels.length > 1 ? 'multiple' : 'unresolved'
    };
}

function registerDailyReportIpc(ipcMain) {
    // Teachers, staff attendance and school events stay institution-wide; the grades and
    // students lookups below are cycle-scoped and resolve the cycle from the session.
    handleAuthedRead(ipcMain, 'dailyReport:getData', ({ db, event, session }, date, schoolYearOrContext) => {
        const request = parseReportRequest(schoolYearOrContext);
        const year = normalizeYear(request.schoolYear);
        const reportScope = resolveReportScope(db, event, session, request);

        // 1. Teacher absences from teacher_absences table (legacy)
        const absences = dailyReportRepo.listLegacyAbsencesByDate(db, date, year);

        // 1b. Staff attendance records for the given date (new table)
        const staffRecords = dailyReportRepo.listStaffAttendanceByDate(db, date, year);

        // Fill in missing subjects from grades table
        const recordsNeedingSubject = staffRecords.filter((r) => !r.subject && (r.full_name || r.teacher_name));
        if (recordsNeedingSubject.length > 0) {
            const gradeSubjects = new Map();
            try {
                const gs = dailyReportRepo.listGradeTeacherSubjects(db, year, reportScope.cycleCodes);
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
        const staffAbsences = staffRecords.filter((r) => r.type === 'absence').map((record) => annotateLinkedSession(record, db, year, reportScope.cycleCodes));
        const staffTardiness = staffRecords.filter((r) => r.type === 'late').map((record) => annotateLinkedSession(record, db, year, reportScope.cycleCodes));
        const linkedLegacyAbsences = absences.map((record) => annotateLinkedSession(record, db, year, reportScope.cycleCodes));

        // 2. Teacher → sections mapping (derived from grades)
        const teacherSectionRows = dailyReportRepo.listTeacherSections(db, year, reportScope.cycleCodes);

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
        const sectionRows = dailyReportRepo.countActiveStudentsBySection(db, year, reportScope.cycleCodes);

        const sectionStudentCounts = {};
        for (const row of sectionRows) {
            sectionStudentCounts[row.section] = row.count;
        }

        // 4. All sections list
        const allSections = sectionRows.map((r) => r.section);

        // 5. Affected sections — combine legacy absences + new staff absences
        const affectedSections = {};
        const allAbsenceRecords = [...linkedLegacyAbsences, ...staffAbsences];
        for (const absence of allAbsenceRecords) {
            const name = absence.full_name;
            const teacherKey = absence.teacher_id ? `id:${absence.teacher_id}` : `name:${name}`;
            if (name && teacherSections[teacherKey] && !affectedSections[name]) {
                affectedSections[name] = teacherSections[teacherKey];
            }
        }

        // 6. School events for this date
        const events = schoolEventsRepo.listByDate(db, date, year);

        // 7. System tags for this date
        let tags = [];
        try {
            tags = systemTagsRepo.listByDate(db, date, year);
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
            absences: linkedLegacyAbsences,
            staffAbsences,
            staffTardiness,
            reportContext: {
                cycleCode: reportScope.cycleCode,
                cycleCodes: reportScope.cycleCodes,
                label: reportScope.label,
                administrative: reportScope.administrative
            },
            teacherSections,
            sectionStudentCounts,
            allSections,
            affectedSections,
            events,
            tags
        };
    });

    // ── School Events CRUD ──

    // ISOLATION-CARVEOUT (Slice 0): school events are an institution-wide calendar (no student link, no cycle); unscoped writes are by design (pinned by Check D). Scoping needs an ADR + tests.
    handleWriteSoftAuth(ipcMain, 'schoolEvents:save', WRITE_ROLES, (db, payload) => {
        try {
            rejectAllCycleWrite(payload);
        } catch (error) {
            return { success: false, code: error.code, error: error.message };
        }
        const { id, event_date, event_type, details, event_time, school_year } = payload;
        requireFields(payload, ['event_date', 'event_type', 'school_year']);
        const year = requireSchoolYear(school_year);

        if (id) {
            schoolEventsRepo.updateById(db, {
                id,
                event_type,
                details: details || '',
                event_time: event_time || '',
                event_date,
                school_year: year
            });
            return { success: true, id };
        } else {
            const result = schoolEventsRepo.insert(db, {
                event_date,
                event_type,
                details: details || '',
                event_time: event_time || '',
                school_year: year
            });
            return { success: true, id: result.lastInsertRowid };
        }
    });

    handleWriteSoftAuth(ipcMain, 'schoolEvents:delete', WRITE_ROLES, (db, eventId) => {
        try {
            if (eventId && typeof eventId === 'object') rejectAllCycleWrite(eventId);
        } catch (error) {
            return { success: false, code: error.code, error: error.message };
        }
        if (!eventId || (typeof eventId === 'object' && !eventId.id)) return { success: false, error: 'Invalid ID' };
        const resolvedEventId = typeof eventId === 'object' ? eventId.id : eventId;
        schoolEventsRepo.deleteById(db, resolvedEventId);
        return { success: true };
    });
}

module.exports = {
    registerDailyReportIpc,
    parseReportRequest,
    resolveReportScope,
    annotateLinkedSession,
    rejectAllCycleWrite
};
