'use strict';

/**
 * Injectable change-tracking port for domain repositories.
 * Production default delegates to main/sync/capture.
 * Unit tests may setRepoCapturePort(createNoOpCapturePort()).
 *
 * @see specs/027-layering-remediation/contracts/capture-port.md
 */

const DEFAULT_CAPTURE = () => require('../sync/capture');

/** @type {object | null} */
let _overridePort = null;

function createDefaultCapturePort() {
    return DEFAULT_CAPTURE();
}

/**
 * No-op port: skips outbox side effects but still performs local DELETEs
 * for deleteBySchoolYearWithCapture so SQL-only unit tests stay consistent.
 */
function createNoOpCapturePort() {
    return {
        captureInputUpserts() {
            return 0;
        },
        captureResolvedRows() {
            return 0;
        },
        capturePutsByIds() {
            return 0;
        },
        captureDeletesFromRows() {
            return 0;
        },
        selectRowsBySchoolYear(db, tableName, schoolYear) {
            return db.prepare(`SELECT * FROM "${tableName}" WHERE school_year = ?`).all(schoolYear);
        },
        deleteBySchoolYearWithCapture(db, tableName, schoolYear) {
            return db.prepare(`DELETE FROM "${tableName}" WHERE school_year = ?`).run(schoolYear).changes;
        },
        notifyCaptureCommitted() {
            /* no push scheduling in unit tests */
        }
    };
}

function getCapturePort() {
    return _overridePort || createDefaultCapturePort();
}

/**
 * @param {object | null} port - CapturePort-like object, or null to restore default
 */
function setRepoCapturePort(port) {
    _overridePort = port && typeof port === 'object' ? port : null;
}

function captureInputUpserts(db, opts) {
    return getCapturePort().captureInputUpserts(db, opts);
}

function captureResolvedRows(db, tableName, rows, operation) {
    return getCapturePort().captureResolvedRows(db, tableName, rows, operation);
}

function capturePutsByIds(db, tableName, ids, schoolYear) {
    return getCapturePort().capturePutsByIds(db, tableName, ids, schoolYear);
}

function captureDeletesFromRows(db, tableName, rows) {
    return getCapturePort().captureDeletesFromRows(db, tableName, rows);
}

function selectRowsBySchoolYear(db, tableName, schoolYear) {
    return getCapturePort().selectRowsBySchoolYear(db, tableName, schoolYear);
}

function deleteBySchoolYearWithCapture(db, tableName, schoolYear) {
    return getCapturePort().deleteBySchoolYearWithCapture(db, tableName, schoolYear);
}

function notifyCaptureCommitted() {
    return getCapturePort().notifyCaptureCommitted();
}

module.exports = {
    getCapturePort,
    setRepoCapturePort,
    createNoOpCapturePort,
    createDefaultCapturePort,
    captureInputUpserts,
    captureResolvedRows,
    capturePutsByIds,
    captureDeletesFromRows,
    selectRowsBySchoolYear,
    deleteBySchoolYearWithCapture,
    notifyCaptureCommitted
};
