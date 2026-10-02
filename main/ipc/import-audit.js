'use strict';

/**
 * Main-side import audit — main/ipc/import-audit.js
 *
 * Business audit entries for school-data imports must originate in authenticated
 * main-process handlers, never in the renderer (import-pipeline review F2).
 * Handlers may call writeImportAudit() from inside a domain transaction. The
 * entry is a plain system_logs row (device-local, never synced) with entity_type
 * 'import'. logImportAudit() remains the best-effort adapter for legacy callers.
 *
 * Import types mirror the settings-imports page actions. The whitelist is shared
 * with the bounded `systemLogs:add` channel (main/ipc/system.js) so the renderer
 * can only record renderer-observable events (blocked review / failure / clear)
 * under the same action vocabulary.
 */

const IMPORT_AUDIT_TYPES = Object.freeze([
    'students',
    'grades',
    'absences',
    'orientation',
    'fet',
    'agent-xml',
    'student-status',
    'clear'
]);

/** Max details length — audit rows must stay bounded. */
const IMPORT_AUDIT_MAX_DETAILS = 4000;
const RENDERER_IMPORT_NOTICE_PREFIXES = Object.freeze([
    'تم منع الاستيراد قبل الكتابة',
    'فشل الاستيراد (',
    'تم حذف '
]);

function isRendererImportNotice(details) {
    const text = String(details || '').trim();
    return RENDERER_IMPORT_NOTICE_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function writeImportAudit(db, type, details) {
    if (!IMPORT_AUDIT_TYPES.includes(type)) {
        const error = new Error(`Unknown import audit type: ${type}`);
        error.code = 'INVALID_IMPORT_AUDIT_TYPE';
        throw error;
    }
    const text = String(details || '').slice(0, IMPORT_AUDIT_MAX_DETAILS);
    db.prepare(
        `INSERT INTO system_logs(action, details, entity_type, entity_id)
         VALUES(?, ?, 'import', ?)`
    ).run(`import:${type}`, text || null, type);
    return true;
}

/**
 * Insert one business import audit row.
 * Never throws: audit logging must never break the import response.
 *
 * @param {object} db
 * @param {string} type   – one of IMPORT_AUDIT_TYPES
 * @param {string} details – Arabic summary line shown in the import logs panel
 * @returns {boolean} true when the row was written
 */
function logImportAudit(db, type, details) {
    try {
        return writeImportAudit(db, type, details);
    } catch {
        return false;
    }
}

/**
 * Build the standard Arabic summary line for an import completion.
 *
 * @param {object} counts – { label, count, inserted?, updated?, skipped?, deleted? }
 * @param {string} [schoolYear]
 * @param {string} [cycleCode]
 * @returns {string}
 */
function buildImportAuditDetails({ label, count, inserted, updated, skipped, deleted }, schoolYear, cycleCode) {
    const parts = [`استيراد ${Number(count) || 0} ${label}`];
    if (deleted) parts.push(`(حذف ${deleted})`);
    else if (inserted != null || updated != null || skipped != null) {
        const outcome = [];
        if (inserted != null) outcome.push(`إدراج ${inserted}`);
        if (updated != null) outcome.push(`تحديث ${updated}`);
        if (skipped != null) outcome.push(`تخطي ${skipped}`);
        if (outcome.length) parts.push(`(${outcome.join('، ')})`);
    }
    if (schoolYear) parts.push(`| السنة=${schoolYear}`);
    if (cycleCode) parts.push(`| السلك=${cycleCode}`);
    return parts.join(' ');
}

module.exports = {
    IMPORT_AUDIT_TYPES,
    IMPORT_AUDIT_MAX_DETAILS,
    RENDERER_IMPORT_NOTICE_PREFIXES,
    isRendererImportNotice,
    writeImportAudit,
    logImportAudit,
    buildImportAuditDetails
};
