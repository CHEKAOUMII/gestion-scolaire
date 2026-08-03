'use strict';

/** Pull apply: PUT/DEL local rows, conflict handling, entity hooks (WP3). */

const { threeWayMerge, computeRowChecksum } = require('../merge');
const { SENSITIVE_FIELDS } = require('../capture');
const { ENTITY_TYPE_REGISTRY } = require('../authority');
const { getApplyHooks, findLocalIdByLogicalKeys, getRequiredColumns, getContractVersion, checkAppVersionGate } = require('../entity-registry');
const { logConflictForensics } = require('../conflict-forensics');
const { checkCycleProfileConsistency } = require('../apply-hooks-stage-rules');
const {
    filterToValidColumns,
    getValidColumns,
    recordPullApplyFailure,
    recordPullQuarantine,
    releaseQuarantinedItem
} = require('./helpers');
const { resolveStudentId } = require('./doc-build');

const PULL_SOFT_FOREIGN_KEYS = {
    grades: [['teacher_id', 'teachers']],
    tests: [['teacher_id', 'teachers']],
    staff_attendance: [['teacher_id', 'teachers']],
    compensation_tracking: [['teacher_id', 'teachers']],
    support_sessions: [['teacher_id', 'teachers']],
    exam_invitations: [['teacher_id', 'teachers']],
    exam_attendance: [['teacher_id', 'teachers']],
    exam_proctors: [
        ['teacher_id', 'teachers'],
        ['exam_id', 'exams']
    ],
    student_risk_snapshot: [['student_id', 'students']]
};

function sanitizeSoftForeignKeys(db, item) {
    if (item.operation !== 'PUT' || !item.data) return;
    const specs = PULL_SOFT_FOREIGN_KEYS[item.tableName];
    if (!specs) return;
    for (const [column, parentTable] of specs) {
        const value = item.data[column];
        if (value == null) continue;
        const exists = db.prepare(`SELECT 1 FROM "${parentTable}" WHERE id = ?`).get(value);
        if (!exists) {
            item.data = { ...item.data, [column]: null };
        }
    }
}

/**
 * Contract check before a PUT (multi-cycle plan §9.2).
 *
 * A device whose local schema predates a required column would otherwise have that
 * column stripped by filterToValidColumns and write the row anyway — accepting, for
 * example, a cycle-scoped record with its cycle silently removed. Returning a reason
 * here routes the item to recordPullQuarantine, which stores the payload for replay
 * without holding the pull cursor — §9.2 asks for the affected entities to stop, not
 * the whole sync. Only entities that declare requiredColumns are affected; every other
 * entity behaves exactly as before.
 *
 * @returns {string | null} failure reason, or null when the row may be applied
 */
function checkLocalContract(db, item) {
    if (item.operation !== 'PUT') return null;
    const required = getRequiredColumns(item.tableName);
    if (!required.length) return null;

    const localColumns = getValidColumns(db, item.tableName);
    const missingLocally = required.filter((column) => !localColumns.has(column));
    if (missingLocally.length) {
        return (
            `هذا الجهاز يحتاج تحديثاً لاستقبال بيانات ${item.tableName} — ` +
            `أعمدة مطلوبة غير موجودة محلياً: ${missingLocally.join(', ')} ` +
            `(contract v${getContractVersion(item.tableName)})`
        );
    }

    const missingInPayload = required.filter(
        (column) => item.data?.[column] === undefined || item.data?.[column] === null || item.data?.[column] === ''
    );
    if (missingInPayload.length) {
        return `سجل وارد بدون قيم مطلوبة في ${item.tableName}: ${missingInPayload.join(', ')}`;
    }
    return null;
}

function handlePullConflict(db, item, pending) {
    const ancestorRow = db.prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?').get(item.rowSyncId);
    let ancestor = null;
    try {
        ancestor = ancestorRow?.ancestor_data ? JSON.parse(ancestorRow.ancestor_data) : null;
    } catch (parseErr) {
        console.warn(`[sync:pull] Failed to parse ancestor_data for ${item.rowSyncId}:`, parseErr.message);
    }

    let localData = {};
    try {
        localData = pending.rowData ? JSON.parse(pending.rowData) : {};
    } catch (parseErr) {
        console.warn(`[sync:pull] Failed to parse local outbox data for ${item.rowSyncId}:`, parseErr.message);
    }

    const localTs = Math.floor(Date.now() / 1000);
    const remoteTs = item.updatedAt || 0;
    const originalRemoteData = JSON.stringify(item.data);
    const mergeResult = threeWayMerge(ancestor, localData, item.data, localTs, remoteTs);

    item.data = mergeResult.merged;

    if (mergeResult.resolution === 'clean') {
        db.prepare("UPDATE sync_outbox SET status = 'sent' WHERE id = ?").run(pending.outboxId);
        return false;
    }

    const resolutionMethod = mergeResult.resolution === 'lww' ? 'lww' : 'merged';

    // Forensics: record pull-side merge outcome (reveals missing-ancestor false conflicts & LWW bias)
    logConflictForensics({
        phase: 'pull',
        table: item.tableName,
        rowSyncId: item.rowSyncId,
        entityType: item.entityType,
        localVersion: null,
        remoteVersion: item.version,
        ancestorPresent: !!ancestorRow?.ancestor_data,
        conflictingFields: mergeResult.conflicts,
        localTs,
        remoteTs,
        remoteDeviceHash: item.deviceHash || null,
        resolution: mergeResult.conflicts.length > 0 ? 'lww-auto' : 'merged-auto',
        note: ancestorRow?.ancestor_data ? null : 'no-ancestor'
    });

    db.prepare(
        `INSERT INTO sync_conflicts(table_name, row_sync_id, entity_type, local_data, remote_data,
            remote_version, remote_device_hash, local_outbox_id, ancestor_data,
            conflicting_fields, resolution_method, resolved_data, status, resolution, resolved_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'resolved', ?, CURRENT_TIMESTAMP)`
    ).run(
        item.tableName,
        item.rowSyncId,
        item.entityType,
        pending.rowData,
        originalRemoteData,
        item.version,
        item.deviceHash,
        pending.outboxId,
        ancestorRow?.ancestor_data || null,
        JSON.stringify(mergeResult.conflicts),
        resolutionMethod,
        JSON.stringify(mergeResult.merged),
        mergeResult.conflicts.length > 0 ? 'remote' : 'merged'
    );
    db.prepare("UPDATE sync_outbox SET status = 'sent' WHERE id = ?").run(pending.outboxId);
    return true;
}

function applyPutOperation(db, item, mapping, stats) {
    const columnKeys = Object.keys(item.data).filter((k) => k !== 'id');

    // Detect the primary key column for this table (defaults to 'id')
    var pkColumn = 'id';
    try {
        const tableInfo = db.prepare(`PRAGMA table_info("${item.tableName}")`).all();
        const pkCol = tableInfo.find((col) => col.pk === 1);
        if (pkCol) pkColumn = pkCol.name;
    } catch {
        /* fallback to 'id' */
    }

    // D1 / WP2: if row_sync_id is new (legacy vs canonical remote ids) but the logical
    // key already exists locally, update that row instead of inserting a duplicate.
    let localId = mapping?.local_id;
    if (localId == null) {
        localId = findLocalIdByLogicalKeys(db, item.tableName, item.data);
        if (localId != null && item.rowSyncId) {
            try {
                db.prepare(
                    'INSERT OR IGNORE INTO sync_id_map(row_sync_id, table_name, local_id) VALUES(?, ?, ?)'
                ).run(item.rowSyncId, item.tableName, localId);
            } catch {
                /* mapping best-effort */
            }
        }
    }

    if (localId != null) {
        const columns = filterToValidColumns(
            db,
            item.tableName,
            columnKeys.filter((k) => k !== pkColumn)
        );
        if (columns.length > 0) {
            const setClause = columns.map((c) => `"${c}" = ?`).join(', ');
            const values = columns.map((c) => item.data[c]);
            values.push(localId);
            try {
                db.prepare(`UPDATE "${item.tableName}" SET ${setClause} WHERE "${pkColumn}" = ?`).run(...values);
            } catch (updateErr) {
                recordPullApplyFailure(
                    stats,
                    item,
                    `UPDATE failed for ${item.tableName} ${pkColumn}=${localId}: ${updateErr.message}`,
                    { sqliteCode: updateErr.code || null, pkColumn, localId, columns }
                );
                return false;
            }
        }
    } else {
        const columns = filterToValidColumns(db, item.tableName, columnKeys);
        if (columns.length > 0) {
            const colNames = columns.map((c) => `"${c}"`).join(', ');
            const placeholders = columns.map(() => '?').join(', ');
            const values = columns.map((c) => item.data[c]);
            let info;
            try {
                info = db
                    .prepare(`INSERT OR REPLACE INTO "${item.tableName}" (${colNames}) VALUES (${placeholders})`)
                    .run(...values);
            } catch (insertErr) {
                recordPullApplyFailure(stats, item, `INSERT failed for ${item.tableName}: ${insertErr.message}`, {
                    sqliteCode: insertErr.code || null,
                    columns
                });
                return false;
            }
            db.prepare('INSERT OR IGNORE INTO sync_id_map(row_sync_id, table_name, local_id) VALUES(?, ?, ?)').run(
                item.rowSyncId,
                item.tableName,
                info.lastInsertRowid
            );
        }
    }

    try {
        db.prepare('UPDATE sync_id_map SET ancestor_data = ?, version = ? WHERE row_sync_id = ?').run(
            JSON.stringify(item.data),
            item.version,
            item.rowSyncId
        );
        const checksum = computeRowChecksum(item.data, SENSITIVE_FIELDS);
        db.prepare(
            `INSERT INTO sync_snapshots(row_sync_id, table_name, checksum, updated_at)
             VALUES(?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(row_sync_id) DO UPDATE SET checksum = ?, updated_at = CURRENT_TIMESTAMP`
        ).run(item.rowSyncId, item.tableName, checksum, checksum);
    } catch (snapshotErr) {
        console.warn(`[sync:pull] Ancestor/snapshot update failed for ${item.rowSyncId}:`, snapshotErr.message);
    }
    return true;
}

function applySingleItem(
    db,
    item,
    pendingMap,
    deferredStudentFiles,
    deferredAbsences,
    deferredGrades,
    stats,
    isDeferred
) {
    try {
        const pending = pendingMap.get(item.rowSyncId);
        if (pending) {
            if (handlePullConflict(db, item, pending)) {
                stats.conflictCount++;
            }
        }

        // Contract gate (§9.2) — runs before hooks so a stale local schema is reported as
        // "this device needs an update" rather than being silently written column-stripped.
        const contractFailure = checkLocalContract(db, item);
        if (contractFailure) {
            recordPullQuarantine(db, stats, item, contractFailure, {
                contractVersion: getContractVersion(item.tableName),
                requiredColumns: getRequiredColumns(item.tableName)
            });
            return;
        }

        // S4 sync version gate (plan row 112) — a device older than the entity's declared
        // minAppVersion cannot interpret the row: quarantine before any write so the row
        // replays once the device upgrades, while the pull cursor keeps advancing.
        const versionGate = checkAppVersionGate(item.tableName);
        if (!versionGate.allowed) {
            recordPullQuarantine(db, stats, item, versionGate.reason, {
                contractVersion: getContractVersion(item.tableName),
                minAppVersion: versionGate.minAppVersion
            });
            return;
        }

        // S4 profile/assignment consistency revalidation (plan row 113) — mirrors the
        // repository transaction checks; a quarantined row replays once its
        // prerequisites (profile, rule set) exist locally.
        if (item.operation === 'PUT') {
            const profileFailure = checkCycleProfileConsistency(db, item);
            if (profileFailure) {
                recordPullQuarantine(db, stats, item, profileFailure.reason, profileFailure.extra || {});
                return;
            }
        }
        // Passed the gate — if this row was previously held, it can leave quarantine.
        // Done here rather than after the write so a later per-row failure still falls
        // through to the retryable path instead of silently staying quarantined.
        if (item._fromQuarantine) releaseQuarantinedItem(db, item.rowSyncId);

        // Entity apply hooks (WP9) — optional beforePut may mutate item.data or signal defer.
        const hooks = getApplyHooks(item.tableName);
        if (typeof hooks.beforePut === 'function' && item.operation === 'PUT') {
            const hookResult = hooks.beforePut(db, item, {
                isDeferred,
                resolveStudentId,
                deferredGrades,
                deferredAbsences,
                deferredStudentFiles
            });
            if (hookResult && hookResult.defer) {
                return;
            }
            if (hookResult && hookResult.fail) {
                recordPullApplyFailure(stats, item, hookResult.fail, hookResult.extra || {});
                return;
            }
        }

        // Degrade non-local soft foreign keys (teacher_id/exam_id/student_id) to NULL so the
        // FKs added in migration 065 never reject a pulled row (see PULL_SOFT_FOREIGN_KEYS).
        sanitizeSoftForeignKeys(db, item);

        const mapping = db.prepare('SELECT local_id FROM sync_id_map WHERE row_sync_id = ?').get(item.rowSyncId);

        if (item.operation === 'PUT') {
            if (applyPutOperation(db, item, mapping, stats)) {
                stats.appliedCount++;
            }
        } else if (item.operation === 'DEL') {
            if (mapping) {
                try {
                    // Detect primary key column for this table
                    var delPkColumn = 'id';
                    try {
                        const tInfo = db.prepare(`PRAGMA table_info("${item.tableName}")`).all();
                        const pkC = tInfo.find((col) => col.pk === 1);
                        if (pkC) delPkColumn = pkC.name;
                    } catch {
                        /* fallback to 'id' */
                    }
                    db.prepare(`DELETE FROM "${item.tableName}" WHERE "${delPkColumn}" = ?`).run(mapping.local_id);
                } catch (delErr) {
                    recordPullApplyFailure(
                        stats,
                        item,
                        `DELETE failed for ${item.tableName} key=${mapping.local_id}: ${delErr.message}`,
                        { sqliteCode: delErr.code || null, localId: mapping.local_id }
                    );
                    return;
                }
            }
            stats.appliedCount++;
        }
    } catch (applyErr) {
        recordPullApplyFailure(stats, item, applyErr.message, {
            sqliteCode: applyErr.code || null,
            stack: applyErr.stack || null
        });
    }
}

function mapRemoteItems(remoteItems) {
    const mapped = [];
    const unknownEntityTypes = [];
    for (const item of remoteItems) {
        const tableName = Object.keys(ENTITY_TYPE_REGISTRY).find(
            (k) => ENTITY_TYPE_REGISTRY[k].entityType === item.entityType
        );
        if (!tableName) {
            unknownEntityTypes.push(item.entityType || '(missing)');
            continue;
        }
        mapped.push({
            tableName,
            operation: item.operation,
            rowSyncId: item.rowSyncId,
            data: item.data || {},
            version: item.version,
            updatedAt: item.updatedAt || 0,
            deviceHash: item.deviceHash,
            entityType: item.entityType,
            schoolYear: item.schoolYear,
            changeId: item.id
        });
    }
    if (unknownEntityTypes.length > 0) {
        console.warn('[sync:pull] Skipped unknown entity types:', [...new Set(unknownEntityTypes)].join(', '));
    }
    return { mapped, unknownEntityTypes };
}

function getStudentDependency(item) {
    if (item.operation !== 'PUT') return null;
    if (item.tableName !== 'absences' && item.tableName !== 'grades' && item.tableName !== 'student_files') return null;

    const studentCode = String(item.data?.student_code || '').trim();
    const schoolYear = String(item.data?.school_year || item.schoolYear || '').trim();
    if (!studentCode) return null;

    return { studentCode, schoolYear };
}

function hasMissingStudentDependencies(db, items) {
    return items.some((item) => {
        const dependency = getStudentDependency(item);
        if (!dependency) return false;
        return resolveStudentId(db, dependency.studentCode, dependency.schoolYear) == null;
    });
}

function buildPullResult(overrides = {}) {
    return {
        success: true,
        appliedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        // Rows held back by a local contract violation — retryable after a schema update,
        // and counted apart from failures because they do not hold the pull cursor.
        quarantinedCount: 0,
        quarantinedTotal: 0,
        totalFetched: 0,
        newCursor: null,
        lastError: null,
        ...overrides
    };
}

module.exports = {
    PULL_SOFT_FOREIGN_KEYS,
    checkLocalContract,
    sanitizeSoftForeignKeys,
    handlePullConflict,
    applyPutOperation,
    applySingleItem,
    mapRemoteItems,
    getStudentDependency,
    hasMissingStudentDependencies,
    buildPullResult
};
