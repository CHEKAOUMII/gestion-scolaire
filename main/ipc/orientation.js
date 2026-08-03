'use strict';

const {
    handleRead,
    handleWrite,
    handleWriteSoftAuth,
    normalizeYear,
    requireSchoolYear,
    looksLikeInternalErrorMessage
} = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const orientationRepo = require('../repos/orientation');
const OrientationErrorContract = require('../../js/shared/errors/orientation-error-contract');

const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');

/** Soft cap for pre-skip detail rows returned to the renderer. */
const MAX_PRE_SKIP_DETAILS = 40;

/**
 * Shared orientation error vocabulary (legacy shape: { message, retryable }).
 * Source of truth: js/shared/errors/orientation-error-contract.js
 */
const ORIENTATION_ERROR_CATALOG = OrientationErrorContract.sharedCatalogLegacy();

function inferOrientationErrorCode(err, fallback) {
    if (err?.code && OrientationErrorContract.isShared(err.code)) return err.code;
    const msg = String(err?.message || '');
    if (/السنة الدراسية|YYYY\/YYYY|school.?year/i.test(msg)) return 'INVALID_SCHOOL_YEAR';
    if (/\[sync:capture\]|outbox|captureInputUpserts/i.test(msg)) return 'SYNC_ERROR';
    if (/SQLITE|database|disk|constraint|UNIQUE/i.test(msg)) return 'DATABASE_ERROR';
    if (/لا توجد صفوف/i.test(msg)) return 'INVALID_RECORD';
    return fallback || 'DATABASE_ERROR';
}

/**
 * Map any thrown error to a structured, user-safe IPC response.
 * Does not expose stack traces, SQL, or filesystem internals.
 */
function toOrientationErrorResponse(err, fallbackCode) {
    const code = inferOrientationErrorCode(err, fallbackCode);
    const def =
        OrientationErrorContract.getDefinition(code) ||
        OrientationErrorContract.getDefinition('DATABASE_ERROR');
    const rawMsg = String(err?.message || '').trim();
    const safeMessage =
        rawMsg && /[\u0600-\u06FF]/.test(rawMsg) && !looksLikeInternalErrorMessage(rawMsg)
            ? rawMsg
            : def.message;

    const details =
        err?.details && typeof err.details === 'object'
            ? OrientationErrorContract.safeDetails(err.details)
            : null;

    return {
        success: false,
        code: def.code,
        error: safeMessage,
        message: safeMessage,
        details,
        retryable: !!def.retryable
    };
}

/**
 * Strict school-year coerce for row-level checks (no silent default-year fallback).
 * Accepts YYYY/YYYY or YYYY-YYYY when consecutive years.
 * @returns {string|null}
 */
function coerceSchoolYearStrict(value) {
    if (value == null || value === '') return null;
    const raw = String(value).trim();
    if (/^\d{4}\/\d{4}$/.test(raw)) return raw;
    const m = raw.match(/\b(20\d{2})\s*[\/\-]\s*(20\d{2})\b/);
    if (!m) return null;
    const y1 = parseInt(m[1], 10);
    const y2 = parseInt(m[2], 10);
    if (y2 === y1 + 1) return `${y1}/${y2}`;
    return null;
}

/**
 * IPC-side validation + alias normalization before any DB write.
 * Frontend validation is not trusted.
 *
 * - Maps aliases via orientationRepo.mapRow (code/massar_code, choix1, affectation, moyenne, …)
 * - Enforces request school year on every record
 * - Requires student_code; origin_stream may be filled later by existing DB row on update
 * - Dedupes by student_code only (last wins); never by name/section/level
 * - Counts duplicatesInFile within this batch
 *
 * Does NOT call clearYear or delete any existing year data.
 *
 * @param {object|array} payload
 * @param {string} schoolYear - validated YYYY/YYYY
 * @returns {{
 *   rows: object[],
 *   duplicatesInFile: number,
 *   preSkipped: number,
 *   preSkipDetails: object[]
 * }}
 */
function prepareBulkUpsertPayload(payload, schoolYear) {
    const rawRows = Array.isArray(payload) ? payload : payload && payload.rows;
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
        const err = new Error('لا توجد صفوف للاستيراد');
        err.code = 'INVALID_RECORD';
        throw err;
    }

    const byCode = new Map();
    let duplicatesInFile = 0;
    let preSkipped = 0;
    const preSkipDetails = [];

    const pushSkip = (entry) => {
        preSkipped += 1;
        if (preSkipDetails.length < MAX_PRE_SKIP_DETAILS) {
            preSkipDetails.push(entry);
        }
    };

    for (const raw of rawRows) {
        // Normalize aliases → canonical field names before persistence
        const mapped = orientationRepo.mapRow(raw);

        // Every record must belong to the requested school year when a year is present
        if (mapped.school_year) {
            const rowYear = coerceSchoolYearStrict(mapped.school_year);
            if (!rowYear) {
                pushSkip({
                    student_code: mapped.student_code || null,
                    outcome: 'skipped',
                    reason: 'invalid_school_year',
                    message: 'سنة الصف غير صالحة'
                });
                continue;
            }
            if (rowYear !== schoolYear) {
                pushSkip({
                    student_code: mapped.student_code || null,
                    outcome: 'skipped',
                    reason: 'year_mismatch',
                    message: 'سنة الصف لا تطابق سنة الطلب'
                });
                continue;
            }
        }

        if (!mapped.student_code) {
            pushSkip({
                student_code: null,
                outcome: 'skipped',
                reason: 'missing_code',
                message: 'رمز التلميذ مفقود'
            });
            continue;
        }

        // origin_stream: required for new inserts; updates may keep existing (repo re-checks)
        // Still flag clearly empty origin when present as whitespace-only (mapRow already nulls it)
        // Dedupe key = student_code only within the school year (year stamped below)
        if (byCode.has(mapped.student_code)) {
            duplicatesInFile += 1;
        }

        byCode.set(mapped.student_code, {
            student_code: mapped.student_code,
            full_name: mapped.full_name,
            gender: mapped.gender,
            section: mapped.section,
            level: mapped.level,
            origin_stream: mapped.origin_stream,
            choice_1: mapped.choice_1,
            choice_2: mapped.choice_2,
            choice_3: mapped.choice_3,
            assigned_stream: mapped.assigned_stream,
            decision_status: mapped.decision_status,
            average: mapped.average,
            rank_num: mapped.rank_num,
            notes: mapped.notes,
            // Always stamp the validated request year — never trust a silent substitute
            school_year: schoolYear
        });
    }

    return {
        rows: Array.from(byCode.values()),
        duplicatesInFile,
        preSkipped,
        preSkipDetails
    };
}

/**
 * Run bulkUpsert with IPC validation + structured result.
 * Entire DB batch is one transaction inside the repo (full rollback on unexpected errors).
 */
function handleBulkUpsert(db, payload) {
    let schoolYear;
    try {
        schoolYear = requireSchoolYear(
            (payload && !Array.isArray(payload) && (payload.schoolYear || payload.school_year)) || null
        );
    } catch (yearErr) {
        return toOrientationErrorResponse(yearErr, 'INVALID_SCHOOL_YEAR');
    }

    let prepared;
    try {
        prepared = prepareBulkUpsertPayload(payload, schoolYear);
    } catch (prepErr) {
        return toOrientationErrorResponse(prepErr, 'INVALID_RECORD');
    }

    // All rows invalid after IPC validation — nothing to write; not a DB error
    if (!prepared.rows.length) {
        return {
            success: true,
            schoolYear,
            inserted: 0,
            updated: 0,
            unchanged: 0,
            skipped: prepared.preSkipped,
            duplicatesInFile: prepared.duplicatesInFile,
            imported: 0,
            unresolvedCycle: [],
            details: prepared.preSkipDetails,
            detailsTruncated: prepared.preSkipped > prepared.preSkipDetails.length
        };
    }

    // Repo: single SQLite transaction, non-destructive merge, no clearYear
    const result = orientationRepo.bulkUpsert(
        db,
        { rows: prepared.rows, schoolYear },
        schoolYear,
        normalizeYear,
        { duplicatesInFile: prepared.duplicatesInFile }
    );

    const details = [...prepared.preSkipDetails, ...(result.details || [])];
    const skipped = (Number(result.skipped) || 0) + prepared.preSkipped;
    const MAX_DETAILS = 80;

    return {
        success: true,
        schoolYear: result.schoolYear || schoolYear,
        inserted: Number(result.inserted) || 0,
        updated: Number(result.updated) || 0,
        unchanged: Number(result.unchanged) || 0,
        skipped,
        duplicatesInFile: prepared.duplicatesInFile,
        imported: (Number(result.inserted) || 0) + (Number(result.updated) || 0),
        details: details.slice(0, MAX_DETAILS),
        detailsTruncated:
            !!result.detailsTruncated ||
            details.length > MAX_DETAILS ||
            prepared.preSkipped > prepared.preSkipDetails.length
    };
}

function registerOrientationIpc(ipcMain) {
    handleRead(ipcMain, 'orientation:list', (db, filters = {}) => {
        try {
            const year = normalizeYear(filters.schoolYear || filters.school_year);
            return orientationRepo.list(db, year, filters);
        } catch (err) {
            return toOrientationErrorResponse(err, 'LIST_LOAD_ERROR');
        }
    });

    handleRead(ipcMain, 'orientation:stats', (db, schoolYear) => {
        try {
            const year = normalizeYear(schoolYear);
            return orientationRepo.stats(db, year);
        } catch (err) {
            return toOrientationErrorResponse(err, 'STATS_LOAD_ERROR');
        }
    });

    // Soft-auth bulk import: one-line registration keeps smoke channel scan correct
    handleWriteSoftAuth(ipcMain, 'orientation:bulkUpsert', WRITE_ROLES, (db, payload) => {
        try {
            return handleBulkUpsert(db, payload);
        } catch (err) {
            // better-sqlite3 rolls back the transaction on throw — no partial batch
            const code = inferOrientationErrorCode(err, 'DATABASE_ERROR');
            if (code === 'SYNC_ERROR') {
                return toOrientationErrorResponse(err, 'SYNC_ERROR');
            }
            if (code === 'INVALID_RECORD') {
                return toOrientationErrorResponse(err, 'INVALID_RECORD');
            }
            const mapped = toOrientationErrorResponse(err, 'DATABASE_ERROR');
            if (
                mapped.code === 'DATABASE_ERROR' &&
                /SQLITE|constraint|UNIQUE|transaction/i.test(String(err?.message || ''))
            ) {
                const rollbackMsg = OrientationErrorContract.getDefaultMessage('IMPORT_ROLLBACK');
                return {
                    ...mapped,
                    code: 'IMPORT_ROLLBACK',
                    error: rollbackMsg,
                    message: rollbackMsg,
                    retryable: true
                };
            }
            return mapped;
        }
    }, { allowNoSession: true });

    // clearYear: explicit bulk delete only — never called from bulkUpsert / normal import
    handleWrite(ipcMain, 'orientation:clearYear', WRITE_ROLES, (db, _event, schoolYear) => {
        try {
            const year = requireSchoolYear(schoolYear);
            return orientationRepo.clearYear(db, year);
        } catch (err) {
            return toOrientationErrorResponse(err, 'DATABASE_ERROR');
        }
    });

    handleWrite(ipcMain, 'orientation:delete', WRITE_ROLES, (db, _event, id) => {
        try {
            return orientationRepo.deleteById(db, id);
        } catch (err) {
            return toOrientationErrorResponse(err, 'DATABASE_ERROR');
        }
    });
}

module.exports = {
    registerOrientationIpc,
    toOrientationErrorResponse,
    prepareBulkUpsertPayload,
    handleBulkUpsert,
    coerceSchoolYearStrict,
    ORIENTATION_ERROR_CATALOG,
    mapRow: orientationRepo.mapRow,
    mergeOrientationRow: orientationRepo.mergeOrientationRow,
    pickText: orientationRepo.pickText,
    pickNum: orientationRepo.pickNum,
    toNumberOrNull: orientationRepo.toNumberOrNull,
    normalizeCode: orientationRepo.normalizeCode,
    normalizeText: orientationRepo.normalizeText
};
