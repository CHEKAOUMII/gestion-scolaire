'use strict';

// Test fixture — sync-push-throughput-optimization
//
// Provides a real-schema backing database for exercising the REAL exported
// `applyItemOutcome` (and the `markEntrySent` / `markEntryFailed` /
// `reconcileUnreconciledRow` / `logVersionConflict` helpers it calls) from
// `main/sync/engine.js` against the production `sync_outbox` / `sync_id_map` /
// `sync_conflicts` schema.
//
// Two backing stores are supported (preferring the most faithful one):
//   (a) `better-sqlite3` in-memory database created with the production DDL
//       (mirrored verbatim from main/db/schema.js + main/db/migrations.js).
//       Used when the native binding loads (e.g. under Electron's ABI).
//   (b) A faithful in-memory SQL emulator that implements EXACTLY the closed
//       set of statements the engine helpers execute. Used when better-sqlite3
//       cannot load under plain Node (documented ABI constraint shared with
//       tests/preservation-config-roundtrip.pbt.test.js and the phantom
//       version-conflict tests).
//
// In BOTH modes the engine functions under test are the genuine production
// functions — only the SQL execution layer differs. The emulator mirrors the
// schema's column semantics (AUTOINCREMENT ids, COALESCE on resolved_data /
// ancestor_data, the `version + 1` increment, status transitions) so that
// side-effect assertions hold identically against either store.

// ---------------------------------------------------------------------------
// Production DDL — mirrored verbatim from the schema/migrations so the real
// better-sqlite3 path uses the exact same column definitions as production.
//   main/db/schema.js            → sync_outbox, sync_id_map (base)
//   main/db/migrations.js        → sync_conflicts, sync_id_map.version/ancestor_data
// ---------------------------------------------------------------------------
const PRODUCTION_DDL = `
    CREATE TABLE IF NOT EXISTS sync_outbox (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name      TEXT    NOT NULL,
        row_sync_id     TEXT    NOT NULL,
        operation       TEXT    NOT NULL CHECK(operation IN ('PUT','DEL')),
        row_data        TEXT,
        school_year     TEXT,
        status          TEXT    NOT NULL DEFAULT 'pending',
        retries         INTEGER          DEFAULT 0,
        last_attempt_at DATETIME,
        sent_at         DATETIME,
        last_error      TEXT,
        created_at      DATETIME         DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_id_map (
        row_sync_id   TEXT PRIMARY KEY,
        table_name    TEXT    NOT NULL,
        local_id      INTEGER NOT NULL,
        version       INTEGER DEFAULT 0,
        ancestor_data TEXT,
        UNIQUE(table_name, local_id)
    );

    CREATE TABLE IF NOT EXISTS sync_conflicts (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name         TEXT     NOT NULL,
        row_sync_id        TEXT     NOT NULL,
        entity_type        TEXT     NOT NULL,
        local_data         TEXT,
        remote_data        TEXT     NOT NULL,
        remote_version     INTEGER  NOT NULL,
        remote_device_hash TEXT     NOT NULL,
        local_outbox_id    INTEGER,
        status             TEXT     NOT NULL DEFAULT 'unresolved'
                           CHECK(status IN ('unresolved','resolved')),
        resolution         TEXT     CHECK(resolution IN ('local','remote','merged')),
        resolved_at        DATETIME,
        created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
        ancestor_data      TEXT,
        conflicting_fields TEXT,
        resolution_method  TEXT,
        resolved_data      TEXT
    );
`;

// ---------------------------------------------------------------------------
// (a) Real better-sqlite3, when the native binding loads.
// ---------------------------------------------------------------------------
function tryRealSqlite() {
    try {
        const Database = require('better-sqlite3');
        const db = new Database(':memory:');
        db.exec(PRODUCTION_DDL);
        db._kind = 'better-sqlite3';
        return db;
    } catch (_) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// (b) Faithful in-memory SQL emulator.
//
// Implements ONLY the closed set of statements executed by the engine helpers
// under test. Each prepared statement is matched by stable fragments of its
// (whitespace-normalized) SQL text. Any unrecognized statement throws loudly so
// a future engine change that adds a statement surfaces here instead of
// silently passing.
// ---------------------------------------------------------------------------
function norm(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function makeEmulator() {
    const store = {
        _kind: 'emulator',
        outbox: new Map(), // id -> row
        idMap: new Map(), // row_sync_id -> mapping
        conflicts: [], // array of conflict rows
        _conflictSeq: 0
    };

    function has(s, frag) {
        return s.indexOf(frag) !== -1;
    }

    // Faithful emulation of better-sqlite3's db.transaction(fn): returns a wrapped
    // function that runs fn with the passed args. The in-memory emulator has no real
    // rollback semantics (these unit tests assert side effects, not atomicity), so a
    // synchronous pass-through is sufficient — while keeping the API surface identical
    // to the real store now that engine helpers (markEntrySent) wrap writes in a txn.
    store.transaction = function transaction(fn) {
        return function (...args) {
            return fn(...args);
        };
    };

    store.prepare = function prepare(sqlRaw) {
        const sql = norm(sqlRaw);

        // --- sync_outbox -----------------------------------------------------
        // A. SELECT row_sync_id, row_data FROM sync_outbox WHERE id = ?
        if (has(sql, 'SELECT row_sync_id, row_data FROM sync_outbox WHERE id = ?')) {
            return {
                get: (id) => {
                    const row = store.outbox.get(Number(id));
                    if (!row) return undefined;
                    return { row_sync_id: row.row_sync_id, row_data: row.row_data };
                }
            };
        }

        // B. UPDATE sync_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?
        if (has(sql, "UPDATE sync_outbox SET status = 'sent'") && has(sql, 'WHERE id = ?')) {
            return {
                run: (id) => {
                    const row = store.outbox.get(Number(id));
                    if (row) {
                        row.status = 'sent';
                        row.sent_at = 'CURRENT_TIMESTAMP';
                        row.last_error = null;
                        return { changes: 1 };
                    }
                    return { changes: 0 };
                }
            };
        }

        // F. SELECT retries FROM sync_outbox WHERE id = ?
        if (has(sql, 'SELECT retries FROM sync_outbox WHERE id = ?')) {
            return {
                get: (id) => {
                    const row = store.outbox.get(Number(id));
                    if (!row) return undefined;
                    return { retries: row.retries };
                }
            };
        }

        // G. UPDATE sync_outbox SET retries = ?, last_attempt_at = CURRENT_TIMESTAMP, last_error = ?, status = ? WHERE id = ?
        if (has(sql, 'UPDATE sync_outbox SET retries = ?') && has(sql, 'status = ? WHERE id = ?')) {
            return {
                run: (retries, error, status, id) => {
                    const row = store.outbox.get(Number(id));
                    if (row) {
                        row.retries = retries;
                        row.last_attempt_at = 'CURRENT_TIMESTAMP';
                        row.last_error = error;
                        row.status = status;
                        return { changes: 1 };
                    }
                    return { changes: 0 };
                }
            };
        }

        // --- sync_id_map -----------------------------------------------------
        // C. UPDATE sync_id_map SET version = ?, ancestor_data = ? WHERE row_sync_id = ?
        if (has(sql, 'UPDATE sync_id_map SET version = ?, ancestor_data = ? WHERE row_sync_id = ?')) {
            return {
                run: (version, ancestor, rowSyncId) => {
                    const m = store.idMap.get(rowSyncId);
                    if (m) {
                        m.version = Number(version);
                        m.ancestor_data = ancestor;
                        return { changes: 1 };
                    }
                    return { changes: 0 };
                }
            };
        }

        // D. UPDATE sync_id_map SET version = version + 1, ancestor_data = ? WHERE row_sync_id = ?
        if (has(sql, 'UPDATE sync_id_map SET version = version + 1, ancestor_data = ? WHERE row_sync_id = ?')) {
            return {
                run: (ancestor, rowSyncId) => {
                    const m = store.idMap.get(rowSyncId);
                    if (m) {
                        m.version = Number(m.version || 0) + 1;
                        m.ancestor_data = ancestor;
                        return { changes: 1 };
                    }
                    return { changes: 0 };
                }
            };
        }

        // H. SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?
        if (has(sql, 'SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?')) {
            return {
                get: (rowSyncId) => {
                    const m = store.idMap.get(rowSyncId);
                    if (!m) return undefined;
                    return { ancestor_data: m.ancestor_data ?? null };
                }
            };
        }

        // L. SELECT version, ancestor_data FROM sync_id_map WHERE row_sync_id = ?
        if (has(sql, 'SELECT version, ancestor_data FROM sync_id_map WHERE row_sync_id = ?')) {
            return {
                get: (rowSyncId) => {
                    const m = store.idMap.get(rowSyncId);
                    if (!m) return undefined;
                    return { version: m.version ?? 0, ancestor_data: m.ancestor_data ?? null };
                }
            };
        }

        // --- sync_conflicts --------------------------------------------------
        // E. UPDATE sync_conflicts SET status='resolved' ... WHERE local_outbox_id = ? AND status = 'unresolved'
        if (
            has(sql, 'UPDATE sync_conflicts') &&
            has(sql, "SET status = 'resolved'") &&
            has(sql, 'WHERE local_outbox_id = ?') &&
            has(sql, "status = 'unresolved'")
        ) {
            return {
                run: (entryId) => {
                    let changes = 0;
                    for (const c of store.conflicts) {
                        if (c.local_outbox_id === Number(entryId) && c.status === 'unresolved') {
                            c.status = 'resolved';
                            c.resolution = 'merged';
                            c.resolved_data = c.resolved_data != null ? c.resolved_data : c.local_data; // COALESCE
                            c.resolved_at = 'CURRENT_TIMESTAMP';
                            changes += 1;
                        }
                    }
                    return { changes };
                }
            };
        }

        // I. SELECT id FROM sync_conflicts WHERE local_outbox_id = ? AND status = 'unresolved' LIMIT 1
        if (
            has(sql, 'SELECT id FROM sync_conflicts') &&
            has(sql, 'WHERE local_outbox_id = ?') &&
            has(sql, "status = 'unresolved'")
        ) {
            return {
                get: (entryId) => {
                    const c = store.conflicts.find(
                        (x) => x.local_outbox_id === Number(entryId) && x.status === 'unresolved'
                    );
                    return c ? { id: c.id } : undefined;
                }
            };
        }

        // J. UPDATE sync_conflicts SET remote_data=?, remote_version=?, remote_device_hash=?, ancestor_data=COALESCE(ancestor_data, ?) WHERE id = ?
        if (
            has(sql, 'UPDATE sync_conflicts') &&
            has(sql, 'SET remote_data = ?') &&
            has(sql, 'ancestor_data = COALESCE(ancestor_data, ?)') &&
            has(sql, 'WHERE id = ?')
        ) {
            return {
                run: (remoteData, remoteVersion, remoteDeviceHash, ancestor, id) => {
                    const c = store.conflicts.find((x) => x.id === Number(id));
                    if (c) {
                        c.remote_data = remoteData;
                        c.remote_version = remoteVersion;
                        c.remote_device_hash = remoteDeviceHash;
                        c.ancestor_data = c.ancestor_data != null ? c.ancestor_data : ancestor; // COALESCE
                        return { changes: 1 };
                    }
                    return { changes: 0 };
                }
            };
        }

        // K. INSERT INTO sync_conflicts(...) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'lww', 'unresolved')
        if (has(sql, 'INSERT INTO sync_conflicts')) {
            return {
                run: (
                    tableName,
                    rowSyncId,
                    entityType,
                    localData,
                    remoteData,
                    remoteVersion,
                    remoteDeviceHash,
                    localOutboxId,
                    ancestorData
                ) => {
                    const id = ++store._conflictSeq;
                    store.conflicts.push({
                        id,
                        table_name: tableName,
                        row_sync_id: rowSyncId,
                        entity_type: entityType,
                        local_data: localData,
                        remote_data: remoteData,
                        remote_version: remoteVersion,
                        remote_device_hash: remoteDeviceHash,
                        local_outbox_id: localOutboxId == null ? null : Number(localOutboxId),
                        status: 'unresolved',
                        resolution: null,
                        resolved_at: null,
                        ancestor_data: ancestorData ?? null,
                        resolution_method: 'lww',
                        resolved_data: null
                    });
                    return { changes: 1, lastInsertRowid: id };
                }
            };
        }

        throw new Error(`[sync-outbox-db emulator] Unhandled SQL statement: ${sql}`);
    };

    return store;
}

// ---------------------------------------------------------------------------
// Public factory + seeding helpers (work identically against either store).
// ---------------------------------------------------------------------------

function createSyncDb() {
    return tryRealSqlite() || makeEmulator();
}

function dbKind(db) {
    return db._kind || 'unknown';
}

// Insert a pending sync_outbox row and return its id.
function seedOutboxRow(db, { tableName, rowSyncId, operation = 'PUT', rowData, schoolYear = '2025/2026', retries = 0 }) {
    if (db._kind === 'better-sqlite3') {
        const info = db
            .prepare(
                `INSERT INTO sync_outbox (table_name, row_sync_id, operation, row_data, school_year, status, retries)
                 VALUES (?, ?, ?, ?, ?, 'pending', ?)`
            )
            .run(tableName, rowSyncId, operation, rowData, schoolYear, retries);
        return Number(info.lastInsertRowid);
    }
    // emulator
    const id = (db._outboxSeq = (db._outboxSeq || 0) + 1);
    db.outbox.set(id, {
        id,
        table_name: tableName,
        row_sync_id: rowSyncId,
        operation,
        row_data: rowData,
        school_year: schoolYear,
        status: 'pending',
        retries,
        last_attempt_at: null,
        sent_at: null,
        last_error: null,
        created_at: 'CURRENT_TIMESTAMP'
    });
    return id;
}

// Insert / upsert a sync_id_map mapping.
function seedIdMap(db, { rowSyncId, tableName, localId = 1, version = 0, ancestorData = null }) {
    if (db._kind === 'better-sqlite3') {
        db.prepare(
            `INSERT INTO sync_id_map (row_sync_id, table_name, local_id, version, ancestor_data)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(row_sync_id) DO UPDATE SET version = excluded.version, ancestor_data = excluded.ancestor_data`
        ).run(rowSyncId, tableName, localId, version, ancestorData);
        return;
    }
    db.idMap.set(rowSyncId, {
        row_sync_id: rowSyncId,
        table_name: tableName,
        local_id: localId,
        version,
        ancestor_data: ancestorData
    });
}

// Insert an unresolved sync_conflicts row, returns its id.
function seedConflict(db, conflict) {
    const c = {
        table_name: conflict.tableName || '',
        row_sync_id: conflict.rowSyncId || '',
        entity_type: conflict.entityType || '',
        local_data: conflict.localData ?? null,
        remote_data: conflict.remoteData ?? '{}',
        remote_version: conflict.remoteVersion ?? 0,
        remote_device_hash: conflict.remoteDeviceHash ?? '',
        local_outbox_id: conflict.localOutboxId ?? null,
        status: conflict.status || 'unresolved'
    };
    if (db._kind === 'better-sqlite3') {
        const info = db
            .prepare(
                `INSERT INTO sync_conflicts (table_name, row_sync_id, entity_type, local_data, remote_data,
                    remote_version, remote_device_hash, local_outbox_id, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                c.table_name,
                c.row_sync_id,
                c.entity_type,
                c.local_data,
                c.remote_data,
                c.remote_version,
                c.remote_device_hash,
                c.local_outbox_id,
                c.status
            );
        return Number(info.lastInsertRowid);
    }
    const id = ++db._conflictSeq;
    db.conflicts.push({
        id,
        ...c,
        resolution: null,
        resolved_at: null,
        ancestor_data: null,
        resolution_method: null,
        resolved_data: null
    });
    return id;
}

// Read a sync_outbox row (normalized shape) for assertions.
function getOutboxRow(db, id) {
    if (db._kind === 'better-sqlite3') {
        return db.prepare('SELECT * FROM sync_outbox WHERE id = ?').get(id);
    }
    return db.outbox.get(Number(id));
}

// Read a sync_id_map mapping for assertions.
function getIdMap(db, rowSyncId) {
    if (db._kind === 'better-sqlite3') {
        return db.prepare('SELECT * FROM sync_id_map WHERE row_sync_id = ?').get(rowSyncId);
    }
    return db.idMap.get(rowSyncId);
}

// Count conflict rows, optionally filtered by status.
function countConflicts(db, status) {
    if (db._kind === 'better-sqlite3') {
        if (status) {
            return db.prepare('SELECT COUNT(*) AS n FROM sync_conflicts WHERE status = ?').get(status).n;
        }
        return db.prepare('SELECT COUNT(*) AS n FROM sync_conflicts').get().n;
    }
    if (status) return db.conflicts.filter((c) => c.status === status).length;
    return db.conflicts.length;
}

// Fetch unresolved conflict rows for a given outbox id.
function getUnresolvedConflictsForEntry(db, entryId) {
    if (db._kind === 'better-sqlite3') {
        return db
            .prepare("SELECT * FROM sync_conflicts WHERE local_outbox_id = ? AND status = 'unresolved'")
            .all(entryId);
    }
    return db.conflicts.filter((c) => c.local_outbox_id === Number(entryId) && c.status === 'unresolved');
}

module.exports = {
    createSyncDb,
    dbKind,
    seedOutboxRow,
    seedIdMap,
    seedConflict,
    getOutboxRow,
    getIdMap,
    countConflicts,
    getUnresolvedConflictsForEntry,
    PRODUCTION_DDL
};
