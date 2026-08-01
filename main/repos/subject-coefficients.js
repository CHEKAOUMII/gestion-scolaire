'use strict';

const SETTINGS_KEY = 'subjectCoefficientMappings:v1';
const QUALIFIANT_CYCLE = 'secondary_qualifiant';

function normalizeText(value) {
    return String(value == null ? '' : value)
        .replace(/\s+/g, ' ')
        .trim();
}

function subjectKey(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[\u0622\u0623\u0625\u0671]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
}

function normalizeMapping(value) {
    const streamCode = normalizeText(value?.streamCode || value?.stream_code).toUpperCase();
    const subject = normalizeText(value?.subject || value?.subjectName);
    const coefficient = Number(value?.coefficient);
    if (!streamCode || !subject || !Number.isFinite(coefficient) || coefficient <= 0 || coefficient > 20) return null;
    return {
        cycleCode: QUALIFIANT_CYCLE,
        streamCode,
        subject,
        coefficient
    };
}

function readMappings(db) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY);
    if (!row?.value) return [];
    try {
        const parsed = JSON.parse(row.value);
        return Array.isArray(parsed) ? parsed.map(normalizeMapping).filter(Boolean) : [];
    } catch {
        return [];
    }
}

function writeMappings(db, mappings) {
    db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)').run(SETTINGS_KEY, JSON.stringify(mappings));
}

function requireOverridePayload(payload) {
    const mapping = normalizeMapping(payload);
    const cycleCode = normalizeText(payload?.cycleCode || payload?.cycle_code || QUALIFIANT_CYCLE);
    const reason = normalizeText(payload?.reason || payload?.justification);
    if (!mapping || cycleCode !== QUALIFIANT_CYCLE || !reason || reason.length > 500) {
        const error = new Error('معطيات اعتماد معامل المادة غير صالحة');
        error.code = 'INVALID_SUBJECT_COEFFICIENT_OVERRIDE';
        throw error;
    }
    return { mapping, reason };
}

function overrideMapping(db, payload, actor) {
    const { mapping, reason } = requireOverridePayload(payload);
    const mappings = readMappings(db);
    const existingIndex = mappings.findIndex(
        (entry) => entry.streamCode === mapping.streamCode && subjectKey(entry.subject) === subjectKey(mapping.subject)
    );
    const previous = existingIndex >= 0 ? mappings[existingIndex] : null;
    if (existingIndex >= 0) mappings[existingIndex] = mapping;
    else mappings.push(mapping);

    const auditDetails = JSON.stringify({
        actor: {
            userId: Number(actor?.userId || 0),
            name: normalizeText(actor?.name),
            email: normalizeText(actor?.email),
            role: normalizeText(actor?.role)
        },
        reason,
        previous,
        next: mapping,
        context: {
            cycleCode: QUALIFIANT_CYCLE,
            schoolYear: normalizeText(payload?.schoolYear || payload?.school_year)
        }
    });

    const transaction = db.transaction(() => {
        writeMappings(db, mappings);
        db.prepare(
            `INSERT INTO system_logs(action, details, entity_type, entity_id)
             VALUES(?, ?, ?, ?)`
        ).run(
            'SUBJECT_COEFFICIENT_ADMIN_OVERRIDE',
            auditDetails,
            'subject_coefficient',
            `${mapping.streamCode}:${subjectKey(mapping.subject)}`
        );
    });
    transaction();

    return { mapping, replaced: !!previous, mappings };
}

module.exports = {
    SETTINGS_KEY,
    QUALIFIANT_CYCLE,
    readMappings,
    overrideMapping
};
