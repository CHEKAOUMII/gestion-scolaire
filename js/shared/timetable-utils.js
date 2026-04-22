/**
 * timetable-utils.js — Shared timetable resolution utilities
 *
 * Stateless helper functions for matching teachers to timetable entries
 * and extracting schedule/section data from the stored timetable structure.
 *
 * Consumed by: staff-attendance.js, staff-daily-report.js
 */

/**
 * Normalize a name for fuzzy matching:
 * remove underscores, collapse whitespace, strip Arabic diacritics, strip definite article, trim
 */
function ttNormalizeName(name) {
    return (name || '')
        .replace(/_/g, ' ')
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/\bال/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Normalize a single stored timetable teacher-meta entry into a consistent shape.
 */
function ttNormalizeStoredTeacherMeta(key, entry) {
    const sourceName = String(entry?.sourceName || key || '').trim();
    const sourceDisplayName = String(entry?.sourceDisplayName || sourceName || '').trim();
    const teacherName = String(
        entry?.teacherName || entry?.displayName || sourceDisplayName || sourceName || ''
    ).trim();
    return {
        key: String(key || entry?.key || '').trim(),
        teacherId: Number(entry?.teacherId) || null,
        teacherName,
        displayName: String(entry?.displayName || teacherName || sourceDisplayName || sourceName).trim(),
        sourceName,
        sourceDisplayName
    };
}

/**
 * Extract all teacher entries from the timetable data, merging
 * teacherMetaByKey, teachers array, and timetable keys.
 */
function ttGetStoredTeacherEntries(data) {
    const entriesByKey = new Map();

    Object.entries(data?.teacherMetaByKey || {}).forEach(([key, entry]) => {
        entriesByKey.set(key, ttNormalizeStoredTeacherMeta(key, entry));
    });

    (Array.isArray(data?.teachers) ? data.teachers : []).forEach((entry) => {
        const normalized = ttNormalizeStoredTeacherMeta(entry?.key || entry?.name, entry);
        if (normalized.key && !entriesByKey.has(normalized.key)) {
            entriesByKey.set(normalized.key, normalized);
        }
    });

    Object.keys(data?.timetables || {}).forEach((key) => {
        if (!entriesByKey.has(key)) {
            entriesByKey.set(
                key,
                ttNormalizeStoredTeacherMeta(key, { key, sourceName: key, teacherName: key })
            );
        }
    });

    return Array.from(entriesByKey.values());
}

/**
 * Resolve timetable keys for a teacher using robust multi-field matching.
 * Matching phases: 1) by ID → 2) exact name → 3) normalized → 4) partial (substring).
 *
 * @param {object} data - Timetable data object (with .timetables, .teacherMetaByKey, .teachers)
 * @param {number|null} teacherId - Teacher database ID
 * @param {string} teacherName - Teacher full name
 * @returns {string[]} Array of matching timetable keys
 */
function ttResolveTeacherKeys(data, teacherId, teacherName) {
    const entries = ttGetStoredTeacherEntries(data);
    const targetId = Number(teacherId) || null;
    const targetName = String(teacherName || '').trim();
    const normalizedTarget = ttNormalizeName(targetName);
    if (!targetName && !targetId) return [];

    const matchedKeys = [];

    const addMatches = (predicate) => {
        entries.forEach((entry) => {
            if (entry.key && predicate(entry)) matchedKeys.push(entry.key);
        });
        return [...new Set(matchedKeys)];
    };

    // 1. Match by teacher ID
    if (targetId) {
        const byId = addMatches((entry) => entry.teacherId === targetId);
        if (byId.length) return byId;
    }

    if (!targetName) return [];

    const fieldsForEntry = (entry) => [
        entry.teacherName,
        entry.displayName,
        entry.sourceDisplayName,
        entry.sourceName,
        entry.key.replace(/^tafwij:/, '').replace(/_/g, ' ')
    ];

    // 2. Exact name match
    const exact = addMatches((entry) =>
        fieldsForEntry(entry).some((value) => String(value || '').trim() === targetName)
    );
    if (exact.length) return exact;

    // 3. Normalized match (diacritics, articles stripped)
    const normalized = addMatches((entry) =>
        fieldsForEntry(entry).some((value) => ttNormalizeName(value) === normalizedTarget)
    );
    if (normalized.length) return normalized;

    // 4. Partial substring match
    return addMatches((entry) =>
        fieldsForEntry(entry).some((value) => {
            const normalizedValue = ttNormalizeName(value);
            return (
                normalizedValue &&
                (normalizedValue.includes(normalizedTarget) || normalizedTarget.includes(normalizedValue))
            );
        })
    );
}

/**
 * Get the period sub-objects to iterate based on absencePeriod.
 *
 * @param {object} dayData - Day data from timetable { morning: {...}, afternoon: {...} }
 * @param {string} absencePeriod - 'morning', 'afternoon', or 'full_day'
 * @returns {Array} Array of [periodName, hoursObject] pairs
 */
function ttGetPeriodEntries(dayData, absencePeriod) {
    if (!dayData || typeof dayData !== 'object') return [];
    if (absencePeriod === 'morning') {
        return dayData.morning ? [['morning', dayData.morning]] : [];
    }
    if (absencePeriod === 'afternoon') {
        return dayData.afternoon ? [['afternoon', dayData.afternoon]] : [];
    }
    // full_day → both periods
    const entries = [];
    if (dayData.morning) entries.push(['morning', dayData.morning]);
    if (dayData.afternoon) entries.push(['afternoon', dayData.afternoon]);
    return entries;
}

/** Arabic day names indexed by JS getDay() */
const TT_DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/**
 * Get the Arabic day name for a date string.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {string} Arabic day name
 */
function ttGetDayName(dateStr) {
    const dateObj = new Date(dateStr + 'T00:00:00');
    return TT_DAY_NAMES[dateObj.getDay()];
}
