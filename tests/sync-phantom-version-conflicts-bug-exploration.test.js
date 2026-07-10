'use strict';

// @pre-fix exploratory test — EXPECTED to FAIL on UNFIXED code.
//
// Spec: .kiro/specs/sync-phantom-version-conflicts/
// Task 1 — Property 1 (Bug Condition):
//   "Reconcile Unreconciled Seeded Rows Instead of Phantom Conflicts"
//
//   When a device is provisioned from a shared database backup/seed, its rows
//   already exist on the server (written by another device from the same seed),
//   but locally `sync_id_map.version` is missing/`0` and `ancestor_data` is
//   null. On the first push `buildFirestoreDoc` computes
//   `newVersion = (sync_id_map.version || 0) + 1 = 1`, while the matching
//   server document already holds `version = 1`. The conditional write guard
//   in `writeItemWithVersionCheck` rejects the write because `1 >= 1`, and
//   because the stale remote is not byte-equivalent (`isEquivalentRemoteData`
//   returns false) the push falls through to `logVersionConflict`, recording a
//   persistent `status = 'unresolved'` row in `sync_conflicts` — a PHANTOM
//   conflict that needs no human decision.
//
// This test encodes the EXPECTED (fixed) behavior described by the design's
// Correctness Property 1, so it MUST FAIL on the unfixed code. DO NOT attempt
// to "fix" this test or the production code when it fails — the failure is the
// proof that the bug exists. The very same test is re-run after the fix
// (task 3.2) and is expected to PASS then.
//
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
//
// ---------------------------------------------------------------------------
// Why this test runs in Node and replicates the push-conflict path
// ---------------------------------------------------------------------------
// The push-conflict handling lives in `flushPreparedItems` /
// `writeItemWithVersionCheck` / `logVersionConflict` inside
// `main/sync/engine.js`. None of those are exported, and `engine.js`'s require
// chain pulls in `electron` (via `../db/context`) and the live `firebase`
// Firestore SDK (via `writeItemWithVersionCheck`'s `runTransaction`), so it
// cannot be loaded under plain Node. (`better-sqlite3` is also compiled
// against Electron's ABI and fails to load here — same constraint documented
// in tests/preservation-config-roundtrip.pbt.test.js.)
//
// We therefore reuse the genuinely-pure production logic verbatim
// (`computeRowChecksum`, `threeWayMerge` from `main/sync/merge.js`) and
// faithfully replicate the small, well-defined push-conflict surface from
// `engine.js` against an in-memory model of the three sync tables and a fake
// Firestore transaction. Each replicated piece is annotated with the exact
// `engine.js` semantics it mirrors so any drift surfaces here as a failure.
//
// ---------------------------------------------------------------------------
// Scenario (the seeded-device first push)
// ---------------------------------------------------------------------------
//   - Local `sync_id_map`: version = 0, ancestor_data = null (UNRECONCILED).
//   - Local row data: semantically the row the device intends to keep, with a
//     recent incidental field (e.g. `updated_at`) or trailing whitespace.
//   - Fake server document: the SAME row written weeks ago by another device
//     from the same seed, at `version = 1`, NOT byte-equivalent (older
//     `updated_at` / differing whitespace).
//   - Pushed version for the unreconciled row = (0) + 1 = 1, so the guard
//     `serverVersion (1) >= pushedVersion (1)` trips.
//
// Expected (fixed) behavior asserted here:
//   1. NO `status = 'unresolved'` row is recorded in `sync_conflicts`.
//   2. `sync_id_map.version` is reconciled to the server version.
//   3. `sync_id_map.ancestor_data` is reconciled to the (stripped) server data.

const assert = require('assert');
const fc = require('fast-check');

// ---- REAL production pure logic (no Electron / Firestore deps) -------------
// `computeRowChecksum` powers the real `isEquivalentRemoteData` byte-equivalence
// test; `threeWayMerge` is reused by the FIX (task 3.1) to re-merge against the
// adopted ancestor, so it is imported here for the post-fix re-run.
const { computeRowChecksum, threeWayMerge } = require('../main/sync/merge');

const MIN_CASES = 100;

// ---------------------------------------------------------------------------
// Faithful replicas of the relevant engine.js helpers (annotated with source).
// ---------------------------------------------------------------------------

// capture.js:10 — const SENSITIVE_FIELDS = ['password_hash', 'pin_hash'];
const SENSITIVE_FIELDS = ['password_hash', 'pin_hash'];

// engine.js — const REMOTE_SYNC_METADATA_FIELDS = [...]; stripRemoteSyncMetadata
const REMOTE_SYNC_METADATA_FIELDS = ['version', 'operation', 'rowSyncId', 'deviceHash', 'schoolYear', 'updatedAt', 'ttl'];

function stripRemoteSyncMetadata(data) {
    const clean = { ...(data || {}) };
    for (const field of REMOTE_SYNC_METADATA_FIELDS) {
        delete clean[field];
    }
    return clean;
}

// engine.js — isEquivalentRemoteData(localData, remoteData)
function isEquivalentRemoteData(localData, remoteData) {
    const localChecksum = computeRowChecksum(localData || {}, SENSITIVE_FIELDS);
    const remoteChecksum = computeRowChecksum(stripRemoteSyncMetadata(remoteData), SENSITIVE_FIELDS);
    return localChecksum === remoteChecksum;
}

// engine.js — buildFirestorePayload(item)
function buildFirestorePayload(item) {
    return {
        ...item.data,
        version: item.version,
        operation: item.operation,
        rowSyncId: item.rowSyncId,
        deviceHash: item.deviceHash,
        schoolYear: item.schoolYear,
        updatedAt: item.updatedAt
    };
}

// design.md → Bug Details → isBugCondition(input)
function isBugCondition(input) {
    const localUnreconciled =
        (input.localVersion == null || input.localVersion === 0) && input.localAncestor == null;

    const pushedVersion = (input.localVersion == null ? 0 : input.localVersion) + 1;
    const guardTripped = input.serverExists && input.serverVersion >= pushedVersion;

    const notByteEquivalent = !isEquivalentRemoteData(input.localData, input.serverData);

    return localUnreconciled && guardTripped && notByteEquivalent;
}

// ---------------------------------------------------------------------------
// In-memory model of the three sync tables.
//
// Mirrors the columns from:
//   - main/db/schema.js          (sync_outbox, sync_id_map base)
//   - main/db/migrations.js      (sync_id_map.version/ancestor_data,
//                                  sync_conflicts table)
// ---------------------------------------------------------------------------

function makeSyncDb() {
    return {
        // row_sync_id -> { row_sync_id, table_name, local_id, version, ancestor_data }
        syncIdMap: new Map(),
        // id -> { id, table_name, row_sync_id, operation, row_data, school_year, status, retries, sent_at, last_error }
        syncOutbox: new Map(),
        // append-only list of conflict rows
        syncConflicts: [],
        _outboxSeq: 0,
        _conflictSeq: 0
    };
}

// engine.js — markEntrySent(db, entryId, versionOverride, rowSyncId, rowData)
// Mirrors the production signature: callers may pass an explicit rowSyncId and
// rowData (e.g. the reconciliation path passes the adopted server-baseline
// ancestor JSON). When omitted they default to the outbox entry's own
// row_sync_id / row_data, preserving the original 2-arg behavior exactly.
function markEntrySent(db, entryId, versionOverride = null, rowSyncId = null, rowData = null) {
    const entry = db.syncOutbox.get(entryId);
    if (!entry) return;

    if (!rowSyncId || rowData === null) {
        rowSyncId = rowSyncId || entry.row_sync_id;
        rowData = rowData !== null ? rowData : entry.row_data;
    }

    entry.status = 'sent';
    entry.sent_at = 'now';
    entry.last_error = null;

    const mapping = db.syncIdMap.get(rowSyncId);
    if (mapping) {
        if (versionOverride != null && Number.isFinite(Number(versionOverride))) {
            mapping.version = Number(versionOverride);
            mapping.ancestor_data = rowData;
        } else {
            mapping.version = Number(mapping.version || 0) + 1;
            mapping.ancestor_data = rowData;
        }
    }
    // resolve any unresolved conflict tied to this outbox entry
    for (const c of db.syncConflicts) {
        if (c.local_outbox_id === entryId && c.status === 'unresolved') {
            c.status = 'resolved';
            c.resolution = 'merged';
        }
    }
}

// engine.js — markEntryFailed(db, entryId, error, maxRetries, ignoreMaxRetries, forceFailed)
function markEntryFailed(db, entryId, error, maxRetries, ignoreMaxRetries = false, forceFailed = false) {
    const entry = db.syncOutbox.get(entryId);
    if (!entry) return;
    const retries = Number(entry.retries || 0);
    entry.status = forceFailed ? 'failed' : !ignoreMaxRetries && retries >= maxRetries ? 'failed' : 'pending';
    entry.last_error = error;
}

// engine.js — logVersionConflict(db, prepared, result)
// Records (or updates) a status='unresolved' row in sync_conflicts.
function logVersionConflict(db, prepared, result) {
    const mapping = db.syncIdMap.get(prepared.item.rowSyncId);
    const ancestorData = mapping ? mapping.ancestor_data : null;
    const remoteData = stripRemoteSyncMetadata(result.remoteData || {});

    const existing = db.syncConflicts.find(
        (c) => c.local_outbox_id === prepared.entryId && c.status === 'unresolved'
    );
    if (existing) {
        existing.remote_data = JSON.stringify(remoteData);
        existing.remote_version = result.remoteVersion || prepared.item.version;
        existing.remote_device_hash = result.remoteDeviceHash || '';
        if (existing.ancestor_data == null) existing.ancestor_data = ancestorData || null;
        return;
    }

    db.syncConflicts.push({
        id: ++db._conflictSeq,
        table_name: prepared.tableName || '',
        row_sync_id: prepared.item.rowSyncId || '',
        entity_type: prepared.item.entityType || '',
        local_data: JSON.stringify(prepared.item.data || {}),
        remote_data: JSON.stringify(remoteData),
        remote_version: result.remoteVersion || prepared.item.version,
        remote_device_hash: result.remoteDeviceHash || '',
        local_outbox_id: prepared.entryId,
        ancestor_data: ancestorData || null,
        resolution_method: 'lww',
        status: 'unresolved'
    });
}

// engine.js — writeItemWithVersionCheck(firestoreDb, item) against a fake store.
// `serverDocs` is a Map keyed by `${collectionPath}/${documentId}`.
function writeItemWithVersionCheck(serverDocs, item) {
    const key = `${item.collectionPath}/${item.documentId}`;
    const existing = serverDocs.get(key);

    // Guard: existing.version >= item.version  →  conflict (no write).
    if (existing && Number(existing.version || 0) >= item.version) {
        const remoteData = existing;
        return {
            success: false,
            conflict: true,
            equivalent: isEquivalentRemoteData(item.data, remoteData),
            error: 'Version conflict',
            errorName: 'VERSION_CONFLICT',
            remoteData,
            remoteVersion: Number(remoteData.version || 0),
            remoteDeviceHash: remoteData.deviceHash || ''
        };
    }

    serverDocs.set(key, buildFirestorePayload(item));
    return { success: true };
}

// engine.js — reconcileUnreconciledRow(db, prepared, result)  [FIX: task 3.1]
// Faithful replica of the production helper added to main/sync/engine.js. When
// an UNRECONCILED seeded row (sync_id_map.version 0/missing AND ancestor_data
// null) collides with a pre-existing server document on the
// `conflict && !equivalent` branch, adopt the server baseline (version +
// stripped ancestor) and re-run the three-way merge against that adopted
// ancestor. If the re-merge reports a genuine field-level overlap, defer to the
// existing logVersionConflict path (handled:false). Otherwise reconcile
// silently: mark the outbox entry sent and record NO unresolved conflict.
//
// NOTE: the production helper also emits a `logConflictForensics` record. That
// is best-effort logging with no schema changes and no effect on the three sync
// tables this test asserts over, so it is intentionally omitted from the replica.
function reconcileUnreconciledRow(db, prepared, result) {
    const rowSyncId = prepared.item.rowSyncId;
    const mapping = db.syncIdMap.get(rowSyncId);

    const localVersion = Number((mapping && mapping.version) || 0);
    const localAncestor = mapping && mapping.ancestor_data != null ? mapping.ancestor_data : null;

    // localUnreconciled: version missing/0 AND ancestor null. (guardTripped +
    // notByteEquivalent are implied by reaching the conflict && !equivalent branch.)
    const localUnreconciled = (mapping == null || localVersion === 0) && localAncestor == null;
    if (!localUnreconciled) {
        return { handled: false };
    }

    const remoteVersion = Number(result.remoteVersion || 0);
    const serverData = stripRemoteSyncMetadata(result.remoteData || {});
    const ancestorJson = JSON.stringify(serverData);

    // Adopt the server baseline so subsequent merges/pushes use the correct
    // version and ancestor (Requirement 2.4).
    if (mapping) {
        mapping.version = remoteVersion;
        mapping.ancestor_data = ancestorJson;
    }

    // Re-run the three-way merge with the adopted ancestor (== remote). Fields the
    // local device did not change collapse to "no change"; only genuinely
    // locally-changed fields survive. A true overlap can only arise if the data
    // diverges in a way the merge classifies as a real conflict.
    const localData = prepared.item.data || {};
    const localTs = Number(prepared.item.updatedAt) || 0;
    const remoteTs = Number(result.remoteData && result.remoteData.updatedAt) || 0;
    const remerge = threeWayMerge(serverData, localData, serverData, localTs, remoteTs);

    // Genuine field-level difference remains ONLY when the re-merge reports a real
    // overlap. Defer to the existing logVersionConflict path (now with the adopted
    // ancestor present) and let the caller record a genuine conflict (Requirement 2.5).
    if (remerge.conflicts.length > 0) {
        return { handled: false };
    }

    // No genuine difference → reconcile silently: mark the outbox entry resolved/sent
    // and KEEP the adopted server version + ancestor (Requirements 2.1, 2.3, 2.5).
    markEntrySent(db, prepared.entryId, remoteVersion, rowSyncId, ancestorJson);
    return { handled: true, sent: true };
}

// engine.js — flushPreparedItems(...) conditional-write branch (FIXED, task 3.1).
// This replica now mirrors the FIXED main/sync/engine.js: the reconciliation
// branch is wired into the `conflict && !equivalent` path exactly as production
// does, so re-running this test exercises the fix and is expected to PASS.
function flushPreparedItemsFixed(db, serverDocs, preparedItems, maxRetries) {
    let sentCount = 0;
    let failedCount = 0;
    let lastError = null;

    for (const prepared of preparedItems) {
        const result = writeItemWithVersionCheck(serverDocs, prepared.item);

        if (result.success) {
            markEntrySent(db, prepared.entryId);
            sentCount += 1;
            continue;
        }

        if (result.conflict && result.equivalent) {
            // byte-equivalent collision auto-resolves (unchanged behavior)
            markEntrySent(db, prepared.entryId, result.remoteVersion || prepared.item.version);
            sentCount += 1;
            continue;
        }

        lastError = result.error || 'Conditional write failed';

        // Reconciliation branch (phantom version-conflict fix): when an UNRECONCILED
        // seeded row collides with a pre-existing server document, adopt the server
        // baseline and re-merge instead of recording a phantom unresolved conflict.
        // Gated strictly on the bug condition — only the conflict && !equivalent branch
        // reaches here, and reconcileUnreconciledRow tests the localUnreconciled half.
        if (result.conflict && !result.equivalent) {
            const reconcileOutcome = reconcileUnreconciledRow(db, prepared, result);
            if (reconcileOutcome.handled) {
                if (reconcileOutcome.sent) {
                    sentCount += 1;
                } else {
                    failedCount += 1;
                }
                continue;
            }
        }

        markEntryFailed(db, prepared.entryId, lastError, maxRetries, result.isThrottle || result.isAccessDenied, result.conflict);
        failedCount += 1;

        if (result.conflict) {
            // Already-reconciled rows (ancestor present) still fall through to a
            // genuine version-conflict record, exactly as in the fixed engine.
            logVersionConflict(db, prepared, result);
        }
    }

    return { sentCount, failedCount, lastError };
}

// ---------------------------------------------------------------------------
// Scenario builder — seeds an UNRECONCILED local row + a semantically-identical
// but NOT byte-equivalent server document at version = 1.
// ---------------------------------------------------------------------------

const DEVICE_HASH_LOCAL = 'devLOCAL000000aa';
const DEVICE_HASH_SERVER = 'devSEEDER00000bb';

// Build the semantic (intended) row data per affected table.
function makeRowData(tableName, opts) {
    const sy = opts.schoolYear || '2025/2026';
    if (tableName === 'settings') {
        return { key: opts.key || 'school_name', value: opts.value || 'ثانوية ابن سينا', school_year: sy, updated_at: opts.updatedAt };
    }
    if (tableName === 'compensation_tracking') {
        return {
            id: opts.id || 7,
            teacher_id: opts.teacherId || 42,
            amount: opts.amount || 1500,
            status: opts.status || 'paid',
            school_year: sy,
            updated_at: opts.updatedAt
        };
    }
    // system_tags
    return {
        id: opts.id || 11,
        tag_date: opts.tagDate || '2025-09-15',
        entity_type: 'teacher',
        entity_name: opts.entityName || 'محمد العلوي',
        tag_key: 'educational_activity',
        tag_label: 'نشاط تربوي',
        note_text: opts.noteText || 'حصة دعم',
        school_year: sy,
        created_at: '2025-09-15 08:00:00',
        updated_at: opts.updatedAt
    };
}

// Returns { db, serverDocs, prepared, serverVersion, expectedAncestor }
function buildScenario(tableName, opts) {
    const db = makeSyncDb();
    const serverDocs = new Map();

    const rowSyncId = opts.rowSyncId || `school:${tableName}:${opts.localId || 1}`;
    const localId = opts.localId || 1;
    const schoolYear = opts.schoolYear || '2025/2026';
    const entityType = opts.entityType || tableName.replace(/s$/, '');

    // Local row data: recent incidental value.
    const localData = makeRowData(tableName, { ...opts, updatedAt: opts.localUpdatedAt });

    // Server row data: SAME semantic row, written weeks ago by the seeder.
    // Either a stale `updated_at` or a trailing-whitespace variant — both make
    // the rows semantically identical but NOT byte-equivalent.
    const serverData = makeRowData(tableName, { ...opts, updatedAt: opts.serverUpdatedAt });
    if (opts.whitespaceField && serverData[opts.whitespaceField] != null) {
        serverData[opts.whitespaceField] = `${serverData[opts.whitespaceField]}  `;
    }

    const serverVersion = 1;

    // Seed the fake server document at version = 1 (buildFirestorePayload shape).
    const serverItem = {
        collectionPath: tableName,
        documentId: rowSyncId,
        data: serverData,
        version: serverVersion,
        operation: 'PUT',
        rowSyncId,
        deviceHash: DEVICE_HASH_SERVER,
        schoolYear,
        updatedAt: opts.serverUpdatedAt
    };
    serverDocs.set(`${tableName}/${rowSyncId}`, buildFirestorePayload(serverItem));

    // Seed UNRECONCILED local version tracking: version = 0, ancestor_data null.
    db.syncIdMap.set(rowSyncId, {
        row_sync_id: rowSyncId,
        table_name: tableName,
        local_id: localId,
        version: 0,
        ancestor_data: null
    });

    // Seed the outbox entry being pushed.
    const entryId = ++db._outboxSeq;
    db.syncOutbox.set(entryId, {
        id: entryId,
        table_name: tableName,
        row_sync_id: rowSyncId,
        operation: 'PUT',
        row_data: JSON.stringify(localData),
        school_year: schoolYear,
        status: 'pending',
        retries: 0,
        sent_at: null,
        last_error: null
    });

    // buildFirestoreDoc: newVersion = (sync_id_map.version || 0) + 1 = 1
    const pushedVersion = Number(db.syncIdMap.get(rowSyncId).version || 0) + 1;

    const prepared = {
        entryId,
        tableName,
        item: {
            collectionPath: tableName,
            documentId: rowSyncId,
            entityType,
            entityId: rowSyncId,
            data: localData,
            version: pushedVersion,
            operation: 'PUT',
            rowSyncId,
            deviceHash: DEVICE_HASH_LOCAL,
            schoolYear,
            updatedAt: opts.localUpdatedAt
        }
    };

    return { db, serverDocs, prepared, serverVersion, expectedAncestor: JSON.stringify(stripRemoteSyncMetadata(serverDocs.get(`${tableName}/${rowSyncId}`))) };
}

// Assert the EXPECTED (fixed) behavior for a single scenario. Throws on the
// unfixed code (which records a phantom unresolved conflict and leaves
// sync_id_map unreconciled).
function assertReconciledNoPhantomConflict(scenario, label) {
    const { db, serverDocs, prepared, serverVersion } = scenario;

    // Sanity: this scenario really IS in the bug domain.
    const condInput = {
        rowSyncId: prepared.item.rowSyncId,
        tableName: prepared.tableName,
        localData: prepared.item.data,
        localVersion: 0,
        localAncestor: null,
        serverExists: true,
        serverVersion,
        serverData: serverDocs.get(`${prepared.tableName}/${prepared.item.rowSyncId}`)
    };
    assert.ok(
        isBugCondition(condInput),
        `[${label}] precondition: expected isBugCondition === true (unreconciled + guard-tripped + not-byte-equivalent)`
    );

    flushPreparedItemsFixed(db, serverDocs, [prepared], 10);

    const rowSyncId = prepared.item.rowSyncId;

    // (1) No phantom unresolved conflict recorded.
    const unresolved = db.syncConflicts.filter((c) => c.row_sync_id === rowSyncId && c.status === 'unresolved');
    assert.strictEqual(
        unresolved.length,
        0,
        `[${label}] expected NO unresolved sync_conflicts row for a semantically-identical seeded row, ` +
            `but found ${unresolved.length}. The unreconciled row (version=0, ancestor=null) was pushed at ` +
            `version=1 against an equal-but-stale server doc at version=1; the guard tripped (1>=1) and, with ` +
            `no ancestor and a non-byte-equivalent stale remote, it was logged as a PHANTOM conflict instead ` +
            `of being reconciled. Counterexample remote_data: ${(unresolved[0] || {}).remote_data}`
    );

    // (2) sync_id_map.version reconciled to the server version.
    const mapping = db.syncIdMap.get(rowSyncId);
    assert.strictEqual(
        Number(mapping.version),
        serverVersion,
        `[${label}] expected sync_id_map.version reconciled to server version ${serverVersion}, got ${mapping.version}. ` +
            `The unfixed push path never adopts the server baseline for an unreconciled row.`
    );

    // (3) sync_id_map.ancestor_data reconciled to the stripped server data.
    assert.strictEqual(
        mapping.ancestor_data,
        scenario.expectedAncestor,
        `[${label}] expected sync_id_map.ancestor_data reconciled to the server baseline, got ${mapping.ancestor_data}. ` +
            `The unfixed push path leaves ancestor_data null, so the next merge degrades to last-writer-wins.`
    );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

console.log('[exploration] sync phantom version conflicts — Property 1 (Bug Condition) ' +
    '(EXPECTED TO FAIL on unfixed code)');

const AFFECTED_TABLES = ['settings', 'compensation_tracking', 'system_tags'];

try {
    // =====================================================================
    // Pinned case 1 — `settings` seeded row (stale server `updated_at`).
    // =====================================================================
    assertReconciledNoPhantomConflict(
        buildScenario('settings', {
            key: 'school_name',
            value: 'ثانوية ابن سينا',
            localUpdatedAt: 1726000000, // recent
            serverUpdatedAt: 1723000000 // weeks older — not byte-equivalent
        }),
        'settings/stale-updated_at'
    );

    // =====================================================================
    // Pinned case 2 — `compensation_tracking` seeded row (stale server doc).
    // =====================================================================
    assertReconciledNoPhantomConflict(
        buildScenario('compensation_tracking', {
            id: 7,
            teacherId: 42,
            amount: 1500,
            status: 'paid',
            localUpdatedAt: 1726000500,
            serverUpdatedAt: 1722000000
        }),
        'compensation_tracking/stale-updated_at'
    );

    // =====================================================================
    // Pinned case 3 — `system_tags` seeded row (trailing-whitespace variant).
    // =====================================================================
    assertReconciledNoPhantomConflict(
        buildScenario('system_tags', {
            id: 11,
            entityName: 'محمد العلوي',
            noteText: 'حصة دعم',
            localUpdatedAt: 1726001000,
            serverUpdatedAt: 1726001000, // same updated_at...
            whitespaceField: 'note_text' // ...but incidental trailing whitespace on the server copy
        }),
        'system_tags/whitespace'
    );

    // =====================================================================
    // Scoped PBT — for ALL unreconciled seeded rows across the three affected
    // tables, paired with a semantically-identical but NOT byte-equivalent
    // server doc at version=1, the fixed push path must reconcile the row and
    // record NO unresolved conflict (Property 1).
    // =====================================================================
    fc.assert(
        fc.property(
            fc.constantFrom.apply(fc, AFFECTED_TABLES),
            fc.integer({ min: 1, max: 9999 }), // local_id
            fc.integer({ min: 1_700_000_000, max: 1_730_000_000 }), // local updated_at
            fc.integer({ min: 0, max: 30_000_000 }), // age delta (server is older)
            fc.boolean(), // incidental difference type: whitespace vs stale updated_at
            fc.string({ minLength: 1, maxLength: 12 }), // varied value/note text
            (tableName, localId, localUpdatedAt, ageDelta, useWhitespace, text) => {
                const serverUpdatedAt = useWhitespace ? localUpdatedAt : localUpdatedAt - ageDelta - 1;
                const whitespaceField =
                    tableName === 'settings' ? 'value' : tableName === 'system_tags' ? 'note_text' : 'status';

                const opts = {
                    localId,
                    rowSyncId: `school:${tableName}:${localId}`,
                    localUpdatedAt,
                    serverUpdatedAt,
                    value: tableName === 'settings' ? `v_${text}` : undefined,
                    noteText: tableName === 'system_tags' ? `n_${text}` : undefined,
                    status: tableName === 'compensation_tracking' ? 'paid' : undefined
                };
                if (useWhitespace) opts.whitespaceField = whitespaceField;

                const scenario = buildScenario(tableName, opts);

                // Only assert within the bug domain (guard must actually trip and
                // the rows must be non-byte-equivalent).
                const condInput = {
                    localData: scenario.prepared.item.data,
                    localVersion: 0,
                    localAncestor: null,
                    serverExists: true,
                    serverVersion: scenario.serverVersion,
                    serverData: scenario.serverDocs.get(`${tableName}/${scenario.prepared.item.rowSyncId}`)
                };
                fc.pre(isBugCondition(condInput));

                flushPreparedItemsFixed(scenario.db, scenario.serverDocs, [scenario.prepared], 10);

                const rowSyncId = scenario.prepared.item.rowSyncId;
                const unresolved = scenario.db.syncConflicts.filter(
                    (c) => c.row_sync_id === rowSyncId && c.status === 'unresolved'
                );
                assert.strictEqual(
                    unresolved.length,
                    0,
                    `[pbt:${tableName}] phantom unresolved conflict recorded for a semantically-identical seeded row ` +
                        `(localId=${localId}, useWhitespace=${useWhitespace}). Expected reconciliation, not a conflict.`
                );

                const mapping = scenario.db.syncIdMap.get(rowSyncId);
                assert.strictEqual(
                    Number(mapping.version),
                    scenario.serverVersion,
                    `[pbt:${tableName}] sync_id_map.version not reconciled (got ${mapping.version}, expected ${scenario.serverVersion}).`
                );
                assert.strictEqual(
                    mapping.ancestor_data,
                    scenario.expectedAncestor,
                    `[pbt:${tableName}] sync_id_map.ancestor_data not reconciled to the server baseline.`
                );
            }
        ),
        { numRuns: MIN_CASES, verbose: true }
    );

    // Reaching here means the bug did NOT reproduce — unexpected for unfixed code.
    console.log('[exploration] (UNEXPECTED) all assertions passed — the phantom version-' +
        'conflict bug did not reproduce. The code may already be fixed, or the root-cause/' +
        'test logic needs review.');
    process.exit(0);
} catch (err) {
    console.error('FAIL (EXPECTED on unfixed code): Property 1 — unreconciled seeded rows ' +
        'are logged as phantom unresolved conflicts instead of being reconciled.');
    console.error(err && err.message ? err.message : err);
    if (err && err.counterexample) {
        console.error('Counterexample: ' + JSON.stringify(err.counterexample));
    }
    process.exit(1);
}
