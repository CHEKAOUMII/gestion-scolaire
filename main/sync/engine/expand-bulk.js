'use strict';

/**
 * Typed bulk outbox expansion (plan D3).
 *
 * Returns:
 *   { status: 'expanded' | 'empty' | 'error', entries: [], error: null|string }
 *
 * Never uses full-table / full-year SELECT to infer mutation sets.
 * Legacy `_bulk` summaries without exact keys are quarantined as `error`.
 */

const { CHANNEL_REGISTRY, ensureSyncIdMapping, stripSensitiveFields } = require('../capture');
const { isKnownSyncTable, resolveLocalId } = require('../entity-registry');

function expandOutcome(status, entries = [], error = null) {
    return { status, entries, error };
}

/**
 * Expand a bulk outbox row into exact per-row push entries.
 * @param {object} db
 * @param {object} entry - sync_outbox row
 * @param {string} [_deviceHash]
 * @returns {{ status: string, entries: object[], error: string|null }}
 */
function expandBulkEntry(db, entry, _deviceHash) {
    let bulkData = {};

    try {
        bulkData = JSON.parse(entry.row_data || '{}');
    } catch (err) {
        const message = `Bulk expansion parse failed for entry ${entry.id}: ${err.message}`;
        console.warn(`[sync:push] ${message}`);
        return expandOutcome('error', [], message);
    }

    const tableName = entry.table_name;
    const schoolYear = entry.school_year || '';
    const bulkChannel = bulkData.channel;

    if (bulkChannel && !CHANNEL_REGISTRY[bulkChannel]) {
        const message = `Unknown bulk channel '${bulkChannel}' for entry ${entry.id}`;
        console.warn(`[sync:push] ${message}`);
        return expandOutcome('error', [], message);
    }

    if (!isKnownSyncTable(tableName)) {
        const message = `Bulk expansion rejected for unknown table '${tableName}'`;
        console.warn(`[sync:push] ${message}`);
        return expandOutcome('error', [], message);
    }

    // Preferred: exact local IDs written by atomic capture (new format).
    const exactLocalIds = Array.isArray(bulkData.localIds)
        ? bulkData.localIds
        : Array.isArray(bulkData.rows)
          ? bulkData.rows.map((r) => (r && typeof r === 'object' ? r.id : r)).filter((id) => id != null)
          : null;

    if (exactLocalIds) {
        if (exactLocalIds.length === 0) {
            return expandOutcome('empty', [], null);
        }
        try {
            return expandFromLocalIds(db, tableName, schoolYear, exactLocalIds, entry.operation);
        } catch (err) {
            const message = `Bulk expansion by localIds failed for ${tableName}: ${err.message}`;
            console.warn(`[sync:push] ${message}`);
            return expandOutcome('error', [], message);
        }
    }

    // Preferred: exact logical keys re-resolved against current DB.
    if (Array.isArray(bulkData.logicalKeys) && bulkData.logicalKeys.length >= 0) {
        if (bulkData.logicalKeys.length === 0) {
            return expandOutcome('empty', [], null);
        }
        try {
            return expandFromLogicalKeys(db, tableName, schoolYear, bulkData.logicalKeys, bulkData.keyFields);
        } catch (err) {
            const message = `Bulk expansion by logicalKeys failed for ${tableName}: ${err.message}`;
            console.warn(`[sync:push] ${message}`);
            return expandOutcome('error', [], message);
        }
    }

    // Legacy summary without recoverable identity — quarantine (never full-table expand).
    const message =
        `Legacy bulk summary for entry ${entry.id} (channel=${bulkChannel || 'n/a'}) ` +
        `cannot be expanded safely without exact keys; quarantining for operator repair`;
    console.warn(`[sync:push] ${message}`);
    return expandOutcome('error', [], message);
}

function expandFromLocalIds(db, tableName, schoolYear, localIds, operation) {
    const op = operation === 'DEL' ? 'DEL' : 'PUT';
    const select = db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`);
    const expanded = [];

    for (const localId of localIds) {
        if (op === 'DEL') {
            const rowSyncId = ensureSyncIdMapping(db, tableName, localId);
            expanded.push({
                table_name: tableName,
                row_sync_id: rowSyncId,
                operation: 'DEL',
                row_data: null,
                school_year: schoolYear
            });
            continue;
        }

        const row = select.get(localId);
        if (!row) {
            // Row gone after capture — still push DEL-like absence? Prefer skip with warning.
            console.warn(`[sync:push] localId ${localId} missing from ${tableName} during bulk expand`);
            continue;
        }
        const id = resolveLocalId(tableName, row);
        if (id == null) continue;
        const rowSyncId = ensureSyncIdMapping(db, tableName, id);
        expanded.push({
            table_name: tableName,
            row_sync_id: rowSyncId,
            operation: 'PUT',
            row_data: JSON.stringify(stripSensitiveFields({ ...row })),
            school_year: schoolYear || row.school_year || ''
        });
    }

    if (expanded.length === 0) {
        return expandOutcome('empty', [], null);
    }
    return expandOutcome('expanded', expanded, null);
}

function expandFromLogicalKeys(db, tableName, schoolYear, logicalKeys, keyFields) {
    if (!Array.isArray(keyFields) || !keyFields.length) {
        throw new Error('logicalKeys expansion requires keyFields');
    }
    const where = keyFields.map((f) => `"${f}" = ?`).join(' AND ');
    const select = db.prepare(`SELECT * FROM "${tableName}" WHERE ${where}`);
    const expanded = [];

    for (const keyObj of logicalKeys) {
        const params = keyFields.map((f) => keyObj[f]);
        const row = select.get(...params);
        if (!row) {
            console.warn(
                `[sync:push] logical key not found in ${tableName}:`,
                keyFields.map((f, i) => `${f}=${params[i]}`).join(', ')
            );
            continue;
        }
        const id = resolveLocalId(tableName, row);
        if (id == null) continue;
        const rowSyncId = ensureSyncIdMapping(db, tableName, id);
        expanded.push({
            table_name: tableName,
            row_sync_id: rowSyncId,
            operation: 'PUT',
            row_data: JSON.stringify(stripSensitiveFields({ ...row })),
            school_year: schoolYear || row.school_year || ''
        });
    }

    if (expanded.length === 0) {
        return expandOutcome('empty', [], null);
    }
    return expandOutcome('expanded', expanded, null);
}

/**
 * Classify a legacy queued `_bulk` outbox row without mutating it.
 * @returns {{ classification: 'exact'|'quarantine'|'empty', reason: string }}
 */
function classifyLegacyBulkRow(entry) {
    let bulkData = {};
    try {
        bulkData = JSON.parse(entry.row_data || '{}');
    } catch (err) {
        return { classification: 'quarantine', reason: `malformed_json: ${err.message}` };
    }
    if (Array.isArray(bulkData.localIds) || Array.isArray(bulkData.logicalKeys) || Array.isArray(bulkData.rows)) {
        const n =
            (bulkData.localIds && bulkData.localIds.length) ||
            (bulkData.logicalKeys && bulkData.logicalKeys.length) ||
            (bulkData.rows && bulkData.rows.length) ||
            0;
        if (n === 0) return { classification: 'empty', reason: 'exact_empty' };
        return { classification: 'exact', reason: 'has_exact_keys' };
    }
    return {
        classification: 'quarantine',
        reason: 'legacy_summary_without_keys'
    };
}

module.exports = {
    expandBulkEntry,
    classifyLegacyBulkRow,
    expandOutcome
};
