'use strict';

/**
 * D1 student remote identity migration helpers.
 *
 * Canonical Firestore document ID: school_year__code (encodeURIComponent parts).
 * Legacy document ID: code only.
 *
 * Default operations are report-only. Copy / delete require explicit apply flags.
 * Legacy retirement must never run without a prior verified copy step.
 */

const {
    buildDocumentId,
    buildLegacyDocumentId,
    parseStudentDocumentId,
    studentLogicalKey
} = require('../firebase/collections');

const REMOTE_META = ['version', 'operation', 'rowSyncId', 'deviceHash', 'schoolYear', 'updatedAt', 'ttl'];

function stripMeta(data) {
    const clean = { ...(data || {}) };
    for (const key of REMOTE_META) delete clean[key];
    return clean;
}

/**
 * Classify a remote students collection document for migration.
 * @param {{ id: string, data?: object }} docSnap
 */
function classifyStudentRemoteDoc(docSnap) {
    const documentId = String(docSnap?.id || '').trim();
    const raw = docSnap?.data || {};
    const data = stripMeta(raw);

    const fromId = parseStudentDocumentId(documentId) || {};
    if (!data.code && fromId.code) data.code = fromId.code;
    if (!data.school_year && fromId.school_year) data.school_year = fromId.school_year;
    if (!data.school_year && raw.schoolYear) data.school_year = raw.schoolYear;

    const logicalKey = studentLogicalKey(data);
    const canonicalId = logicalKey ? buildDocumentId('students', logicalKey) : null;
    const legacyId = logicalKey ? buildLegacyDocumentId('students', logicalKey) : null;

    if (!logicalKey || !canonicalId) {
        if (fromId.code && !fromId.school_year) {
            return {
                classification: 'orphan_legacy',
                documentId,
                canonicalId: null,
                legacyId: documentId,
                logicalKey: null,
                reason: 'legacy_doc_missing_school_year'
            };
        }
        return {
            classification: 'malformed',
            documentId,
            canonicalId: null,
            legacyId: null,
            logicalKey: null,
            reason: 'missing_code_or_school_year'
        };
    }

    if (documentId === canonicalId) {
        return {
            classification: 'canonical',
            documentId,
            canonicalId,
            legacyId,
            logicalKey,
            reason: null
        };
    }

    if (legacyId && documentId === legacyId) {
        return {
            classification: 'legacy',
            documentId,
            canonicalId,
            legacyId,
            logicalKey,
            reason: null
        };
    }

    if (!String(documentId).includes('__') && fromId.code) {
        return {
            classification: 'legacy',
            documentId,
            canonicalId,
            legacyId: documentId,
            logicalKey,
            reason: 'legacy_shape_with_payload_year'
        };
    }

    return {
        classification: 'malformed',
        documentId,
        canonicalId,
        legacyId,
        logicalKey,
        reason: 'id_payload_mismatch'
    };
}

/**
 * @param {Array<{ id: string, data?: object }>} docs
 */
function summarizeStudentRemoteDocs(docs) {
    const list = Array.isArray(docs) ? docs : [];
    const summary = {
        total: list.length,
        canonical: 0,
        legacy: 0,
        orphanLegacy: 0,
        malformed: 0,
        needsCopy: 0,
        samples: {
            legacy: [],
            orphanLegacy: [],
            malformed: []
        }
    };

    const canonicalIds = new Set();
    const classified = [];

    for (const docSnap of list) {
        const result = classifyStudentRemoteDoc(docSnap);
        classified.push(result);
        if (result.classification === 'canonical') {
            summary.canonical += 1;
            if (result.canonicalId) canonicalIds.add(result.canonicalId);
        } else if (result.classification === 'legacy') {
            summary.legacy += 1;
            if (summary.samples.legacy.length < 20) {
                summary.samples.legacy.push({
                    documentId: result.documentId,
                    canonicalId: result.canonicalId,
                    logicalKey: result.logicalKey
                });
            }
        } else if (result.classification === 'orphan_legacy') {
            summary.orphanLegacy += 1;
            if (summary.samples.orphanLegacy.length < 20) {
                summary.samples.orphanLegacy.push({
                    documentId: result.documentId,
                    reason: result.reason
                });
            }
        } else {
            summary.malformed += 1;
            if (summary.samples.malformed.length < 20) {
                summary.samples.malformed.push({
                    documentId: result.documentId,
                    reason: result.reason
                });
            }
        }
    }

    for (const result of classified) {
        if (result.classification === 'legacy' && result.canonicalId && !canonicalIds.has(result.canonicalId)) {
            summary.needsCopy += 1;
        }
    }

    return { summary, classified };
}

/**
 * Plan copy operations: legacy docs that have a year and no canonical twin yet.
 * @param {Array<{ id: string, data?: object }>} docs
 */
function planLegacyToCanonicalCopies(docs) {
    const list = Array.isArray(docs) ? docs : [];
    const byId = new Map(list.map((d) => [String(d.id), d]));
    const plans = [];
    const seenTargets = new Set();

    for (const docSnap of list) {
        const result = classifyStudentRemoteDoc(docSnap);
        if (result.classification !== 'legacy' || !result.canonicalId) continue;
        if (byId.has(result.canonicalId)) continue;
        if (seenTargets.has(result.canonicalId)) continue;

        const raw = docSnap.data || {};
        plans.push({
            fromId: result.documentId,
            toId: result.canonicalId,
            logicalKey: result.logicalKey,
            version: Number(raw.version || 1),
            data: stripMeta(raw)
        });
        seenTargets.add(result.canonicalId);
    }

    return plans;
}

/**
 * Plan safe legacy deletes: only when a verified canonical twin already exists
 * with the same logical key and version >= legacy version.
 * @param {Array<{ id: string, data?: object }>} docs
 */
function planSafeLegacyDeletes(docs) {
    const list = Array.isArray(docs) ? docs : [];
    const byId = new Map(list.map((d) => [String(d.id), d]));
    const deletes = [];

    for (const docSnap of list) {
        const result = classifyStudentRemoteDoc(docSnap);
        if (result.classification !== 'legacy' || !result.canonicalId) continue;

        const twin = byId.get(result.canonicalId);
        if (!twin) continue;

        const legacyVersion = Number(docSnap.data?.version || 0);
        const canonicalVersion = Number(twin.data?.version || 0);
        if (canonicalVersion < legacyVersion) continue;

        const twinKey = studentLogicalKey(stripMeta(twin.data || {}));
        if (
            !twinKey ||
            !result.logicalKey ||
            twinKey.code !== result.logicalKey.code ||
            twinKey.school_year !== result.logicalKey.school_year
        ) {
            continue;
        }

        deletes.push({
            legacyId: result.documentId,
            canonicalId: result.canonicalId,
            logicalKey: result.logicalKey,
            legacyVersion,
            canonicalVersion
        });
    }

    return deletes;
}

function formatMigrationReport(docs) {
    const { summary, classified } = summarizeStudentRemoteDocs(docs);
    const copies = planLegacyToCanonicalCopies(docs);
    const deletes = planSafeLegacyDeletes(docs);

    const lines = [];
    lines.push('=== D1 student remote identity migration report ===');
    lines.push(`total remote student docs: ${summary.total}`);
    lines.push(`  canonical:       ${summary.canonical}`);
    lines.push(`  legacy:          ${summary.legacy}`);
    lines.push(`  orphan legacy:   ${summary.orphanLegacy} (missing school_year — manual fix)`);
    lines.push(`  malformed:       ${summary.malformed}`);
    lines.push(`  needs copy:      ${summary.needsCopy}`);
    lines.push(`  safe to delete:  ${deletes.length} (only after copy + version check)`);
    lines.push('');
    lines.push('Copy plan (legacy → canonical):');
    if (!copies.length) {
        lines.push('  (none)');
    } else {
        for (const p of copies.slice(0, 50)) {
            lines.push(`  ${p.fromId} → ${p.toId} (v${p.version})`);
        }
        if (copies.length > 50) lines.push(`  … and ${copies.length - 50} more`);
    }
    lines.push('');
    lines.push('Safe legacy delete plan (verified twin present):');
    if (!deletes.length) {
        lines.push('  (none)');
    } else {
        for (const d of deletes.slice(0, 50)) {
            lines.push(
                `  delete ${d.legacyId} (canonical ${d.canonicalId} v${d.canonicalVersion} >= legacy v${d.legacyVersion})`
            );
        }
        if (deletes.length > 50) lines.push(`  … and ${deletes.length - 50} more`);
    }
    lines.push('');
    lines.push('Rules:');
    lines.push('  1) Report-only by default.');
    lines.push('  2) Copy legacy → canonical before any legacy delete.');
    lines.push('  3) Never delete orphan_legacy without manual school_year repair.');
    lines.push('  4) New writers already use canonical IDs (school_year + code).');

    return {
        text: lines.join('\n'),
        summary,
        classified,
        copyPlan: copies,
        deletePlan: deletes
    };
}

module.exports = {
    classifyStudentRemoteDoc,
    summarizeStudentRemoteDocs,
    planLegacyToCanonicalCopies,
    planSafeLegacyDeletes,
    formatMigrationReport,
    studentLogicalKey,
    stripMeta
};
