'use strict';

/**
 * Legacy `_bulk` outbox pilot tooling (Milestone A rollout).
 *
 * Default is report-only. Quarantine is opt-in and never infers deletes from
 * a full-table read.
 */

const { classifyLegacyBulkRow } = require('./engine/expand-bulk');

function listPendingBulkRows(db) {
    return db
        .prepare(
            `SELECT id, table_name, row_sync_id, row_data, school_year, status, retries, created_at, last_error
             FROM sync_outbox
             WHERE status = 'pending'
               AND row_data LIKE '%"_bulk"%'
             ORDER BY id ASC`
        )
        .all();
}

function countWhere(db, sql, params = []) {
    return Number(db.prepare(sql).get(...params)?.count || 0);
}

function extractChannel(rowData) {
    try {
        const parsed = JSON.parse(rowData || '{}');
        return parsed.channel || null;
    } catch {
        return null;
    }
}

/**
 * High-level outbox health snapshot for pilot monitoring.
 * @param {object} db
 */
function getOutboxHealthReport(db) {
    const pendingCount = countWhere(db, "SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'pending'");
    const failedCount = countWhere(db, "SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'failed'");
    const sentCount = countWhere(db, "SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'sent'");
    const bulkPendingCount = countWhere(
        db,
        `SELECT COUNT(*) AS count FROM sync_outbox
         WHERE status = 'pending' AND row_data LIKE '%"_bulk"%'`
    );
    const legacyQuarantineFailed = countWhere(
        db,
        `SELECT COUNT(*) AS count FROM sync_outbox
         WHERE status = 'failed' AND last_error LIKE 'legacy_bulk_quarantine:%'`
    );

    const oldestPending = db
        .prepare(
            `SELECT id, table_name, created_at, school_year
             FROM sync_outbox
             WHERE status = 'pending'
             ORDER BY id ASC
             LIMIT 1`
        )
        .get();

    const pendingByTable = db
        .prepare(
            `SELECT table_name AS tableName, COUNT(*) AS count
             FROM sync_outbox
             WHERE status = 'pending'
             GROUP BY table_name
             ORDER BY count DESC`
        )
        .all();

    const bulkPendingByTable = db
        .prepare(
            `SELECT table_name AS tableName, COUNT(*) AS count
             FROM sync_outbox
             WHERE status = 'pending' AND row_data LIKE '%"_bulk"%'
             GROUP BY table_name
             ORDER BY count DESC`
        )
        .all();

    const failedByError = db
        .prepare(
            `SELECT COALESCE(last_error, '(null)') AS error, COUNT(*) AS count
             FROM sync_outbox
             WHERE status = 'failed'
             GROUP BY last_error
             ORDER BY count DESC
             LIMIT 15`
        )
        .all();

    let oldestPendingAgeHours = null;
    if (oldestPending?.created_at) {
        const createdMs = Date.parse(String(oldestPending.created_at).replace(' ', 'T'));
        if (Number.isFinite(createdMs)) {
            oldestPendingAgeHours = Math.round(((Date.now() - createdMs) / 3600000) * 10) / 10;
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        pendingCount,
        failedCount,
        sentCount,
        bulkPendingCount,
        legacyQuarantineFailed,
        oldestPending: oldestPending || null,
        oldestPendingAgeHours,
        pendingByTable,
        bulkPendingByTable,
        failedByError,
        /** True when there is nothing left that needs pilot attention for legacy bulk. */
        pilotClean: bulkPendingCount === 0
    };
}

/**
 * Classify pending `_bulk` rows.
 * @param {object} db
 * @param {{ applyQuarantine?: boolean, includeDetails?: boolean, detailLimit?: number }} [options]
 */
function classifyLegacyBulkOutbox(db, options = {}) {
    const applyQuarantine = options.applyQuarantine === true;
    const includeDetails = options.includeDetails !== false;
    const detailLimit = Number.isFinite(Number(options.detailLimit))
        ? Math.max(0, Number(options.detailLimit))
        : 200;

    const rows = listPendingBulkRows(db);
    const summary = {
        generatedAt: new Date().toISOString(),
        mode: applyQuarantine ? 'quarantine' : 'report-only',
        total: rows.length,
        exact: 0,
        empty: 0,
        quarantine: 0,
        quarantinedNow: 0,
        byTable: {},
        byChannel: {},
        byReason: {},
        details: []
    };

    const failStmt = applyQuarantine
        ? db.prepare(
              `UPDATE sync_outbox
               SET status = 'failed',
                   last_error = ?,
                   last_attempt_at = CURRENT_TIMESTAMP,
                   retries = retries + 1
               WHERE id = ? AND status = 'pending'`
          )
        : null;

    const run = db.transaction(() => {
        for (const row of rows) {
            const result = classifyLegacyBulkRow(row);
            const channel = extractChannel(row.row_data);
            const table = row.table_name || '(unknown)';

            summary[result.classification] = (summary[result.classification] || 0) + 1;
            summary.byTable[table] = (summary.byTable[table] || 0) + 1;
            const chKey = channel || '(none)';
            summary.byChannel[chKey] = (summary.byChannel[chKey] || 0) + 1;
            summary.byReason[result.reason] = (summary.byReason[result.reason] || 0) + 1;

            if (includeDetails && summary.details.length < detailLimit) {
                summary.details.push({
                    id: row.id,
                    table,
                    schoolYear: row.school_year || null,
                    channel,
                    classification: result.classification,
                    reason: result.reason,
                    retries: row.retries,
                    createdAt: row.created_at || null
                });
            }

            if (applyQuarantine && result.classification === 'quarantine' && failStmt) {
                const info = failStmt.run(`legacy_bulk_quarantine:${result.reason}`, row.id);
                if (info.changes > 0) summary.quarantinedNow += 1;
            }
        }
    });
    run();

    summary.detailsTruncated = includeDetails && rows.length > detailLimit;
    return summary;
}

/**
 * Human-readable multi-line report for CLI / logs.
 */
function formatPilotReport(health, classification) {
    const lines = [];
    lines.push('=== Sync bulk pilot report ===');
    lines.push(`Generated: ${health.generatedAt}`);
    lines.push('');
    lines.push('-- Outbox health --');
    lines.push(`  pending:              ${health.pendingCount}`);
    lines.push(`  failed:               ${health.failedCount}`);
    lines.push(`  sent (retained):      ${health.sentCount}`);
    lines.push(`  pending _bulk rows:   ${health.bulkPendingCount}`);
    lines.push(`  legacy quarantined:   ${health.legacyQuarantineFailed}`);
    lines.push(`  pilotClean:           ${health.pilotClean ? 'YES' : 'NO'}`);
    if (health.oldestPending) {
        lines.push(
            `  oldest pending:       id=${health.oldestPending.id} table=${health.oldestPending.table_name} ` +
                `ageHours=${health.oldestPendingAgeHours ?? '?'}`
        );
    }
    if (health.bulkPendingByTable.length) {
        lines.push('  bulk pending by table:');
        for (const row of health.bulkPendingByTable) {
            lines.push(`    ${row.tableName}: ${row.count}`);
        }
    }
    lines.push('');
    lines.push(`-- Legacy _bulk classification (${classification.mode}) --`);
    lines.push(`  total pending bulk:   ${classification.total}`);
    lines.push(`  exact (safe expand):  ${classification.exact}`);
    lines.push(`  empty (safe mark):    ${classification.empty}`);
    lines.push(`  quarantine needed:    ${classification.quarantine}`);
    if (classification.mode === 'quarantine') {
        lines.push(`  quarantined now:      ${classification.quarantinedNow}`);
    }
    if (Object.keys(classification.byChannel).length) {
        lines.push('  by channel:');
        for (const [ch, n] of Object.entries(classification.byChannel).sort((a, b) => b[1] - a[1])) {
            lines.push(`    ${ch}: ${n}`);
        }
    }
    if (Object.keys(classification.byReason).length) {
        lines.push('  by reason:');
        for (const [reason, n] of Object.entries(classification.byReason).sort((a, b) => b[1] - a[1])) {
            lines.push(`    ${reason}: ${n}`);
        }
    }
    if (classification.details && classification.details.length) {
        lines.push('');
        lines.push(`-- Sample details (up to ${classification.details.length}) --`);
        for (const d of classification.details.slice(0, 20)) {
            lines.push(
                `  #${d.id} ${d.table} ${d.classification} reason=${d.reason}` +
                    (d.channel ? ` channel=${d.channel}` : '')
            );
        }
        if (classification.detailsTruncated) {
            lines.push('  … details truncated');
        }
    }
    lines.push('');
    lines.push('-- Next actions --');
    if (health.pilotClean && classification.total === 0) {
        lines.push('  No pending legacy bulk rows. Safe to enable broader rollout.');
    } else {
        lines.push('  1) Keep report-only until counts match expectations.');
        lines.push('  2) For quarantine rows: re-snapshot affected tables/years or re-import.');
        lines.push('  3) Only then: npm run sync:pilot-report -- --apply-quarantine');
        lines.push('  4) Monitor pendingCount, bulkPendingCount, failed last_error prefixes.');
        lines.push('  (Exit code 3 in report-only mode means bulk still pending — expected.)');
    }
    return lines.join('\n');
}

/**
 * Combined pilot snapshot (health + classification).
 */
function runPilotReport(db, options = {}) {
    const health = getOutboxHealthReport(db);
    const classification = classifyLegacyBulkOutbox(db, {
        applyQuarantine: options.applyQuarantine === true,
        includeDetails: options.includeDetails !== false,
        detailLimit: options.detailLimit
    });
    // Refresh health after quarantine so counts match post-apply state
    const healthAfter =
        options.applyQuarantine === true ? getOutboxHealthReport(db) : health;
    return {
        health: healthAfter,
        classification,
        text: formatPilotReport(healthAfter, classification)
    };
}

module.exports = {
    listPendingBulkRows,
    getOutboxHealthReport,
    classifyLegacyBulkOutbox,
    formatPilotReport,
    runPilotReport
};
