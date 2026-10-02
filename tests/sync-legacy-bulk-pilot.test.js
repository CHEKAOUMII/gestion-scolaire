'use strict';

/**
 * Unit tests for legacy bulk pilot report / quarantine (ops track).
 */
const assert = require('assert');
const {
    getOutboxHealthReport,
    classifyLegacyBulkOutbox,
    runPilotReport,
    formatPilotReport
} = require('../main/sync/legacy-bulk-repair');

function createMemoryOutboxDb(rows = []) {
    const outbox = rows.map((r, i) => ({
        id: r.id != null ? r.id : i + 1,
        table_name: r.table_name || 'students',
        row_sync_id: r.row_sync_id || `rs-${i + 1}`,
        operation: r.operation || 'PUT',
        row_data: r.row_data,
        school_year: r.school_year || '2025/2026',
        status: r.status || 'pending',
        retries: r.retries || 0,
        created_at: r.created_at || '2025-01-01 00:00:00',
        last_error: r.last_error || null,
        last_attempt_at: null,
        sent_at: null
    }));

    function norm(sql) {
        return String(sql).replace(/\s+/g, ' ').trim();
    }

    return {
        _outbox: outbox,
        transaction(fn) {
            return (...args) => fn(...args);
        },
        prepare(sqlRaw) {
            const sql = norm(sqlRaw);
            return {
                all(...params) {
                    if (sql.includes('FROM sync_outbox') && sql.includes('GROUP BY table_name')) {
                        if (sql.includes('"_bulk"')) {
                            const map = {};
                            for (const r of outbox) {
                                if (r.status !== 'pending') continue;
                                if (!String(r.row_data || '').includes('"_bulk"')) continue;
                                map[r.table_name] = (map[r.table_name] || 0) + 1;
                            }
                            return Object.entries(map).map(([tableName, count]) => ({ tableName, count }));
                        }
                        const map = {};
                        for (const r of outbox) {
                            if (r.status !== 'pending') continue;
                            map[r.table_name] = (map[r.table_name] || 0) + 1;
                        }
                        return Object.entries(map).map(([tableName, count]) => ({ tableName, count }));
                    }
                    if (sql.includes('GROUP BY last_error')) {
                        const map = {};
                        for (const r of outbox) {
                            if (r.status !== 'failed') continue;
                            const k = r.last_error || '(null)';
                            map[k] = (map[k] || 0) + 1;
                        }
                        return Object.entries(map).map(([error, count]) => ({ error, count }));
                    }
                    if (sql.includes('row_data LIKE') && sql.includes("status = 'pending'")) {
                        return outbox.filter(
                            (r) => r.status === 'pending' && String(r.row_data || '').includes('"_bulk"')
                        );
                    }
                    return [];
                },
                get(...params) {
                    if (sql.startsWith('SELECT COUNT(*)')) {
                        if (sql.includes("status = 'pending'") && sql.includes('"_bulk"')) {
                            return {
                                count: outbox.filter(
                                    (r) =>
                                        r.status === 'pending' && String(r.row_data || '').includes('"_bulk"')
                                ).length
                            };
                        }
                        if (sql.includes("status = 'pending'")) {
                            return { count: outbox.filter((r) => r.status === 'pending').length };
                        }
                        if (sql.includes('legacy_bulk_quarantine')) {
                            return {
                                count: outbox.filter(
                                    (r) =>
                                        r.status === 'failed' &&
                                        String(r.last_error || '').startsWith('legacy_bulk_quarantine:')
                                ).length
                            };
                        }
                        if (sql.includes("status = 'failed'")) {
                            return { count: outbox.filter((r) => r.status === 'failed').length };
                        }
                        if (sql.includes("status = 'sent'")) {
                            return { count: outbox.filter((r) => r.status === 'sent').length };
                        }
                        return { count: 0 };
                    }
                    if (sql.includes('ORDER BY id ASC') && sql.includes('LIMIT 1')) {
                        const pending = outbox.filter((r) => r.status === 'pending').sort((a, b) => a.id - b.id);
                        return pending[0] || null;
                    }
                    return null;
                },
                run(...params) {
                    if (sql.startsWith('UPDATE sync_outbox')) {
                        const error = params[0];
                        const id = params[1];
                        const row = outbox.find((r) => r.id === id && r.status === 'pending');
                        if (!row) return { changes: 0 };
                        row.status = 'failed';
                        row.last_error = error;
                        row.retries = (row.retries || 0) + 1;
                        return { changes: 1 };
                    }
                    return { changes: 0 };
                }
            };
        }
    };
}

console.log('[test] sync legacy bulk pilot');

// Health: empty
{
    const db = createMemoryOutboxDb([]);
    const health = getOutboxHealthReport(db);
    assert.strictEqual(health.pendingCount, 0);
    assert.strictEqual(health.bulkPendingCount, 0);
    assert.strictEqual(health.pilotClean, true);
    console.log('  [ok] empty health');
}

// Classification: legacy summary → quarantine; exact localIds → exact
{
    const db = createMemoryOutboxDb([
        {
            id: 1,
            table_name: 'students',
            row_data: JSON.stringify({ _bulk: true, channel: 'students:addBulk', args_summary: { arg0: { type: 'array', length: 10 } } })
        },
        {
            id: 2,
            table_name: 'grades',
            row_data: JSON.stringify({ _bulk: true, channel: 'grades:saveBulk', localIds: [1, 2, 3] })
        },
        {
            id: 3,
            table_name: 'absences',
            row_data: JSON.stringify({ _bulk: true, channel: 'absences:saveBulk', localIds: [] })
        }
    ]);

    const report = classifyLegacyBulkOutbox(db, { applyQuarantine: false, detailLimit: 10 });
    assert.strictEqual(report.total, 3);
    assert.strictEqual(report.quarantine, 1);
    assert.strictEqual(report.exact, 1);
    assert.strictEqual(report.empty, 1);
    assert.strictEqual(report.mode, 'report-only');
    assert.ok(report.byChannel['students:addBulk'] === 1);
    assert.ok(report.details.length === 3);
    // Nothing mutated
    assert.strictEqual(db._outbox.filter((r) => r.status === 'pending').length, 3);
    console.log('  [ok] report-only classification');
}

// Quarantine apply
{
    const db = createMemoryOutboxDb([
        {
            id: 10,
            row_data: JSON.stringify({ _bulk: true, channel: 'old:bulk' })
        },
        {
            id: 11,
            row_data: JSON.stringify({ _bulk: true, localIds: [5] })
        }
    ]);
    const report = runPilotReport(db, { applyQuarantine: true, detailLimit: 20 });
    assert.strictEqual(report.classification.quarantinedNow, 1);
    assert.strictEqual(db._outbox.find((r) => r.id === 10).status, 'failed');
    assert.ok(String(db._outbox.find((r) => r.id === 10).last_error).startsWith('legacy_bulk_quarantine:'));
    assert.strictEqual(db._outbox.find((r) => r.id === 11).status, 'pending', 'exact rows not quarantined');
    assert.ok(report.text.includes('Sync bulk pilot report'));
    console.log('  [ok] quarantine apply only unsafe rows');
}

// formatPilotReport smoke
{
    const health = getOutboxHealthReport(createMemoryOutboxDb([]));
    const classification = {
        mode: 'report-only',
        total: 0,
        exact: 0,
        empty: 0,
        quarantine: 0,
        byTable: {},
        byChannel: {},
        byReason: {},
        details: []
    };
    const text = formatPilotReport(health, classification);
    assert.ok(text.includes('pilotClean'));
    console.log('  [ok] formatPilotReport');
}

console.log('[test] sync legacy bulk pilot OK');
