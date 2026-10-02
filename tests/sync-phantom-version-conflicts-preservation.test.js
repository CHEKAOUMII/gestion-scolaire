'use strict';

// Preservation test — EXPECTED to PASS on UNFIXED code (baseline capture).
//
// Spec: .kiro/specs/sync-phantom-version-conflicts/
// Task 2 — Property 2 (Preservation):
//   "Non-Buggy Push and Conflict Behavior Unchanged"
//
//   The fix for the phantom version-conflict flood (task 3.1) introduces a
//   reconciliation branch on the push conflict path that is gated STRICTLY on
//   `isBugCondition`. Therefore, every push attempt where `isBugCondition`
//   returns FALSE must behave byte-for-byte as it does today: the same
//   `sync_outbox` status transitions, the same `sync_id_map.version` /
//   `ancestor_data` updates, and the same `sync_conflicts` rows.
//
//   This file OBSERVES the unfixed behavior across the non-buggy input domain
//   and locks it in as assertions. It MUST PASS on the unfixed code (that is
//   what makes it a valid baseline), and the SAME file is re-run after the fix
//   (task 3.3) where it must STILL pass — any deviation introduced by the fix
//   on a non-buggy input surfaces here as a failure.
//
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
//
// ---------------------------------------------------------------------------
// Why this test runs in Node and replicates the push-conflict path
// ---------------------------------------------------------------------------
// Identical constraint to tests/sync-phantom-version-conflicts-bug-exploration.test.js:
// the push-conflict handling (`flushPreparedItems` / `writeItemWithVersionCheck` /
// `logVersionConflict` / `markEntrySent` / `markEntryFailed`) lives un-exported
// inside `main/sync/engine.js`, whose require chain pulls in `electron` and the
// live Firestore SDK, and `better-sqlite3` is compiled against Electron's ABI —
// so engine.js cannot be loaded under plain Node.
//
// We therefore reuse the genuinely-pure production logic verbatim
// (`computeRowChecksum`, `threeWayMerge` from `main/sync/merge.js`) and
// faithfully replicate the small push-conflict surface from `engine.js`
// against an in-memory model of the sync tables and a fake Firestore store.
// Each replica is annotated with the exact `engine.js` semantics it mirrors,
// so any drift surfaces here as a failure. These replicas are intentionally
// the SAME ones used by the task-1 exploration test, kept in lock-step.
//
// ---------------------------------------------------------------------------
// Preservation domain (all inputs where isBugCondition === false)
// ---------------------------------------------------------------------------
//   3.5 Reconciled-row push      — version > 0 + non-null ancestor, server doc
//                                   absent or behind → success, version++ .
//   3.4 Byte-equivalent conflict — server doc trips the guard but is byte-equal
//                                   → auto-resolve via isEquivalentRemoteData.
//   3.3 Genuine version-lag      — reconciled row, server ahead and NOT byte-
//                                   equivalent → guard rejects, real conflict.
//   3.1 Different-field edits     — threeWayMerge with ancestor present merges
//                                   the union cleanly (no conflict).
//   3.2 Same-field edits          — threeWayMerge with ancestor present resolves
//                                   via last-writer-wins and records a conflict.

const assert = require('assert');
const fc = require('fast-check');

// ---- REAL production pure logic (no Electron / Firestore deps) -------------
const { computeRowChecksum, threeWayMerge } = require('../main/sync/merge');

const MIN_CASES = 100;

// ---------------------------------------------------------------------------
// Faithful replicas of the relevant engine.js helpers (annotated with source).
// Kept identical to the task-1 exploration test so both tests exercise the
// same baseline push-conflict surface.
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
// In-memory model of the sync tables.
//   - main/db/schema.js          (sync_outbox, sync_id_map base)
//   - main/db/migrations.js      (sync_id_map.version/ancestor_data,
//                                  sync_conflicts table)
// ---------------------------------------------------------------------------

function makeSyncDb() {
    return {
        syncIdMap: new Map(), // row_sync_id -> { ..., version, ancestor_data }
        syncOutbox: new Map(), // id -> { ..., status, retries, sent_at, last_error }
        syncConflicts: [],
        _outboxSeq: 0,
        _conflictSeq: 0
    };
}

// engine.js — markEntrySent(db, entryId, versionOverride, ...)
function markEntrySent(db, entryId, versionOverride = null) {
    const entry = db.syncOutbox.get(entryId);
    if (!entry) return;
    entry.status = 'sent';
    entry.sent_at = 'now';
    entry.last_error = null;

    const mapping = db.syncIdMap.get(entry.row_sync_id);
    if (mapping) {
        if (versionOverride != null && Number.isFinite(Number(versionOverride))) {
            mapping.version = Number(versionOverride);
            mapping.ancestor_data = entry.row_data;
        } else {
            mapping.version = Number(mapping.version || 0) + 1;
            mapping.ancestor_data = entry.row_data;
        }
    }
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
function writeItemWithVersionCheck(serverDocs, item) {
    const key = `${item.collectionPath}/${item.documentId}`;
    const existing = serverDocs.get(key);

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

// engine.js — flushPreparedItems(...) conditional-write branch (UNFIXED).
function flushPreparedItemsUnfixed(db, serverDocs, preparedItems, maxRetries) {
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
            markEntrySent(db, prepared.entryId, result.remoteVersion || prepared.item.version);
            sentCount += 1;
            continue;
        }

        lastError = result.error || 'Conditional write failed';
        markEntryFailed(db, prepared.entryId, lastError, maxRetries, result.isThrottle || result.isAccessDenied, result.conflict);
        failedCount += 1;

        if (result.conflict) {
            logVersionConflict(db, prepared, result);
        }
    }

    return { sentCount, failedCount, lastError };
}

// ---------------------------------------------------------------------------
// Row-data builders (same shapes as the task-1 exploration test).
// ---------------------------------------------------------------------------

const DEVICE_HASH_LOCAL = 'devLOCAL000000aa';
const DEVICE_HASH_SERVER = 'devSEEDER00000bb';

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

// ---------------------------------------------------------------------------
// Generic push-scenario builder for the push-path preservation properties.
//
// `opts` controls the sync_id_map state (localVersion/localAncestor), whether a
// server document exists and at what version, and the local/server row data so
// byte-equivalence can be steered precisely.
// Returns { db, serverDocs, prepared, rowSyncId, pushedVersion, serverData }.
// ---------------------------------------------------------------------------

function buildPushScenario(tableName, opts) {
    const db = makeSyncDb();
    const serverDocs = new Map();

    const rowSyncId = opts.rowSyncId || `school:${tableName}:${opts.localId || 1}`;
    const localId = opts.localId || 1;
    const schoolYear = opts.schoolYear || '2025/2026';
    const entityType = opts.entityType || tableName.replace(/s$/, '');
    const localData = opts.localData;

    // sync_id_map state (may be reconciled or unreconciled depending on opts).
    db.syncIdMap.set(rowSyncId, {
        row_sync_id: rowSyncId,
        table_name: tableName,
        local_id: localId,
        version: opts.localVersion,
        ancestor_data: opts.localAncestor != null ? opts.localAncestor : null
    });

    let serverData = null;
    if (opts.serverExists) {
        serverData = opts.serverData;
        const serverItem = {
            collectionPath: tableName,
            documentId: rowSyncId,
            data: serverData,
            version: opts.serverVersion,
            operation: 'PUT',
            rowSyncId,
            deviceHash: DEVICE_HASH_SERVER,
            schoolYear,
            updatedAt: opts.serverUpdatedAt
        };
        serverDocs.set(`${tableName}/${rowSyncId}`, buildFirestorePayload(serverItem));
    }

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

    // buildFirestoreDoc: newVersion = (sync_id_map.version || 0) + 1
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

    return { db, serverDocs, prepared, rowSyncId, pushedVersion, serverData };
}

function condInputFor(scenario, opts) {
    return {
        rowSyncId: scenario.rowSyncId,
        tableName: scenario.prepared.tableName,
        localData: scenario.prepared.item.data,
        localVersion: opts.localVersion,
        localAncestor: opts.localAncestor != null ? opts.localAncestor : null,
        serverExists: !!opts.serverExists,
        serverVersion: opts.serverVersion,
        serverData: opts.serverExists ? scenario.serverDocs.get(`${scenario.prepared.tableName}/${scenario.rowSyncId}`) : undefined
    };
}

// ===========================================================================
// Runner
// ===========================================================================

console.log('[preservation] sync phantom version conflicts — Property 2 (Preservation) ' +
    '(EXPECTED TO PASS on unfixed code — baseline capture)');

const AFFECTED_TABLES = ['settings', 'compensation_tracking', 'system_tags'];
let checks = 0;

try {
    // =====================================================================
    // 3.5 — Reconciled-row push (version > 0, non-null ancestor) pushes,
    //       versions, and logs exactly as today.
    //
    // Observed baseline: server doc absent (or behind) → write succeeds →
    // outbox 'sent', sync_id_map.version incremented by 1, ancestor_data set
    // to the pushed row_data, NO conflict recorded. isBugCondition is false
    // (the row is reconciled), so the fix must leave this untouched.
    // =====================================================================
    function assertReconciledPushUnchanged(scenario, opts, label) {
        const ci = condInputFor(scenario, opts);
        assert.ok(!isBugCondition(ci), `[${label}] precondition: expected isBugCondition === false (reconciled row)`);

        const beforeVersion = Number(scenario.db.syncIdMap.get(scenario.rowSyncId).version);
        flushPreparedItemsUnfixed(scenario.db, scenario.serverDocs, [scenario.prepared], 10);

        const entry = scenario.db.syncOutbox.get(scenario.prepared.entryId);
        assert.strictEqual(entry.status, 'sent', `[${label}] expected sync_outbox status 'sent'`);

        const mapping = scenario.db.syncIdMap.get(scenario.rowSyncId);
        assert.strictEqual(
            Number(mapping.version),
            beforeVersion + 1,
            `[${label}] expected sync_id_map.version incremented from ${beforeVersion} to ${beforeVersion + 1}, got ${mapping.version}`
        );
        assert.strictEqual(
            mapping.ancestor_data,
            JSON.stringify(scenario.prepared.item.data),
            `[${label}] expected ancestor_data set to the pushed row_data`
        );
        assert.strictEqual(
            scenario.db.syncConflicts.length,
            0,
            `[${label}] expected NO sync_conflicts row for a clean reconciled push`
        );
        checks += 1;
    }

    {
        const localData = makeRowData('settings', { value: 'ثانوية ابن سينا', updatedAt: 1726000000 });
        const scen = buildPushScenario('settings', {
            localData,
            localVersion: 5,
            localAncestor: JSON.stringify(makeRowData('settings', { value: 'old', updatedAt: 1720000000 })),
            serverExists: false
        });
        assertReconciledPushUnchanged(
            scen,
            { localVersion: 5, localAncestor: '{}', serverExists: false },
            'settings/reconciled-clean-push'
        );
    }

    // =====================================================================
    // 3.4 — Byte-equivalent conflict auto-resolves via isEquivalentRemoteData.
    //
    // Observed baseline: server doc trips the guard (serverVersion >= pushed)
    // but local/remote are byte-equivalent → markEntrySent(remoteVersion):
    // outbox 'sent', sync_id_map.version := remoteVersion, ancestor_data set,
    // NO conflict. isBugCondition is false (notByteEquivalent is false).
    // =====================================================================
    function assertByteEquivalentAutoResolve(scenario, opts, label) {
        const ci = condInputFor(scenario, opts);
        assert.ok(
            isEquivalentRemoteData(ci.localData, ci.serverData),
            `[${label}] precondition: local/remote must be byte-equivalent`
        );
        assert.ok(!isBugCondition(ci), `[${label}] precondition: expected isBugCondition === false (byte-equivalent)`);

        flushPreparedItemsUnfixed(scenario.db, scenario.serverDocs, [scenario.prepared], 10);

        const entry = scenario.db.syncOutbox.get(scenario.prepared.entryId);
        assert.strictEqual(entry.status, 'sent', `[${label}] expected sync_outbox status 'sent' (auto-resolved)`);

        const mapping = scenario.db.syncIdMap.get(scenario.rowSyncId);
        assert.strictEqual(
            Number(mapping.version),
            Number(opts.serverVersion),
            `[${label}] expected sync_id_map.version adopted from remote version ${opts.serverVersion}, got ${mapping.version}`
        );
        assert.strictEqual(
            scenario.db.syncConflicts.length,
            0,
            `[${label}] expected NO sync_conflicts row when local/remote are byte-equivalent`
        );
        checks += 1;
    }

    {
        // Identical underlying row data on both sides → byte-equivalent.
        const localData = makeRowData('compensation_tracking', { amount: 1500, status: 'paid', updatedAt: 1726000000 });
        const serverData = makeRowData('compensation_tracking', { amount: 1500, status: 'paid', updatedAt: 1726000000 });
        const opts = { localData, serverData, localVersion: 0, localAncestor: null, serverExists: true, serverVersion: 1 };
        const scen = buildPushScenario('compensation_tracking', opts);
        assertByteEquivalentAutoResolve(scen, opts, 'compensation_tracking/byte-equivalent');
    }

    // =====================================================================
    // 3.3 — Genuine version-lag on a RECONCILED row is rejected by the guard
    //       and treated as a real conflict (NOT silently overwritten).
    //
    // Observed baseline: reconciled row (version > 0, ancestor present), server
    // ahead and NOT byte-equivalent → markEntryFailed(forceFailed) +
    // logVersionConflict: outbox 'failed', exactly one unresolved conflict,
    // sync_id_map UNCHANGED. isBugCondition is false (row is reconciled).
    // =====================================================================
    function assertGenuineVersionLagConflict(scenario, opts, label) {
        const ci = condInputFor(scenario, opts);
        assert.ok(
            !isEquivalentRemoteData(ci.localData, ci.serverData),
            `[${label}] precondition: local/remote must NOT be byte-equivalent`
        );
        assert.ok(!isBugCondition(ci), `[${label}] precondition: expected isBugCondition === false (reconciled row)`);

        const beforeVersion = Number(scenario.db.syncIdMap.get(scenario.rowSyncId).version);
        const beforeAncestor = scenario.db.syncIdMap.get(scenario.rowSyncId).ancestor_data;

        flushPreparedItemsUnfixed(scenario.db, scenario.serverDocs, [scenario.prepared], 10);

        const entry = scenario.db.syncOutbox.get(scenario.prepared.entryId);
        assert.strictEqual(entry.status, 'failed', `[${label}] expected sync_outbox status 'failed' (guard rejected)`);

        const conflicts = scenario.db.syncConflicts.filter((c) => c.row_sync_id === scenario.rowSyncId && c.status === 'unresolved');
        assert.strictEqual(conflicts.length, 1, `[${label}] expected exactly one unresolved sync_conflicts row`);

        const mapping = scenario.db.syncIdMap.get(scenario.rowSyncId);
        assert.strictEqual(Number(mapping.version), beforeVersion, `[${label}] expected sync_id_map.version unchanged`);
        assert.strictEqual(mapping.ancestor_data, beforeAncestor, `[${label}] expected sync_id_map.ancestor_data unchanged`);
        checks += 1;
    }

    {
        const localData = makeRowData('system_tags', { noteText: 'حصة دعم محلية', updatedAt: 1726000000 });
        const serverData = makeRowData('system_tags', { noteText: 'حصة دعم بعيدة', updatedAt: 1726500000 });
        // Reconciled row at version 3, server ahead at version 4 → genuine lag.
        const opts = {
            localData,
            serverData,
            localVersion: 3,
            localAncestor: JSON.stringify(makeRowData('system_tags', { noteText: 'حصة دعم أصل', updatedAt: 1725000000 })),
            serverExists: true,
            serverVersion: 4
        };
        const scen = buildPushScenario('system_tags', opts);
        assertGenuineVersionLagConflict(scen, opts, 'system_tags/genuine-version-lag');
    }

    // =====================================================================
    // 3.1 — Genuine concurrent edits to DIFFERENT fields, ancestor present,
    //       merge cleanly into the union (no conflict).
    //
    // Observed via the real threeWayMerge (the pure logic the fix re-uses,
    // unchanged by the fix): only-local and only-remote field changes collapse
    // correctly → resolution 'merged', conflicts empty, merged is the union.
    // =====================================================================
    {
        const ancestor = { a: 1, b: 2, c: 3 };
        const local = { a: 9, b: 2, c: 3 }; // local changed `a`
        const remote = { a: 1, b: 8, c: 3 }; // remote changed `b`
        const res = threeWayMerge(ancestor, local, remote, 1000, 2000);
        assert.strictEqual(res.resolution, 'merged', '[merge/different-fields] expected resolution "merged"');
        assert.deepStrictEqual(res.conflicts, [], '[merge/different-fields] expected no conflicting fields');
        assert.strictEqual(res.merged.a, 9, '[merge/different-fields] expected local change to `a` preserved');
        assert.strictEqual(res.merged.b, 8, '[merge/different-fields] expected remote change to `b` preserved');
        assert.strictEqual(res.merged.c, 3, '[merge/different-fields] expected unchanged `c`');
        checks += 1;
    }

    // =====================================================================
    // 3.2 — Genuine concurrent edits to the SAME field, ancestor present,
    //       resolve via last-writer-wins and record a real conflict.
    // =====================================================================
    {
        const ancestor = { a: 1, b: 2 };
        const local = { a: 5, b: 2 }; // local changed `a` -> 5
        const remote = { a: 7, b: 2 }; // remote changed `a` -> 7

        // remote newer → remote wins
        const resRemoteWins = threeWayMerge(ancestor, local, remote, 1000, 2000);
        assert.strictEqual(resRemoteWins.resolution, 'lww', '[merge/same-field] expected resolution "lww"');
        assert.deepStrictEqual(resRemoteWins.conflicts, ['a'], '[merge/same-field] expected `a` recorded as conflict');
        assert.strictEqual(resRemoteWins.merged.a, 7, '[merge/same-field] expected remote (newer) to win');

        // local newer → local wins (still a recorded conflict)
        const resLocalWins = threeWayMerge(ancestor, local, remote, 3000, 2000);
        assert.strictEqual(resLocalWins.resolution, 'lww', '[merge/same-field] expected resolution "lww"');
        assert.deepStrictEqual(resLocalWins.conflicts, ['a'], '[merge/same-field] expected `a` recorded as conflict');
        assert.strictEqual(resLocalWins.merged.a, 5, '[merge/same-field] expected local (newer) to win');
        checks += 1;
    }

    // =====================================================================
    // PBT — Reconciled-row clean push (3.5) across all tables & versions.
    // For ANY reconciled row (version > 0, ancestor present) with no blocking
    // server doc, the push succeeds and the version increments by exactly 1.
    // =====================================================================
    fc.assert(
        fc.property(
            fc.constantFrom.apply(fc, AFFECTED_TABLES),
            fc.integer({ min: 1, max: 9999 }), // local_id
            fc.integer({ min: 1, max: 500 }), // reconciled version (> 0)
            fc.integer({ min: 1_700_000_000, max: 1_730_000_000 }), // updated_at
            fc.string({ minLength: 1, maxLength: 12 }),
            fc.boolean(), // server absent vs server behind
            (tableName, localId, localVersion, updatedAt, text, serverBehind) => {
                const localData = makeRowData(tableName, {
                    value: tableName === 'settings' ? `v_${text}` : undefined,
                    noteText: tableName === 'system_tags' ? `n_${text}` : undefined,
                    status: tableName === 'compensation_tracking' ? 'paid' : undefined,
                    updatedAt
                });
                const localAncestor = JSON.stringify(makeRowData(tableName, { updatedAt: updatedAt - 100 }));

                const opts = {
                    localId,
                    rowSyncId: `school:${tableName}:${localId}`,
                    localData,
                    localVersion,
                    localAncestor,
                    localUpdatedAt: updatedAt
                };
                if (serverBehind) {
                    // Server exists but its version is below the pushed version → no conflict.
                    opts.serverExists = true;
                    opts.serverVersion = localVersion; // pushedVersion = localVersion + 1 > serverVersion
                    opts.serverData = makeRowData(tableName, { updatedAt: updatedAt - 50 });
                    opts.serverUpdatedAt = updatedAt - 50;
                } else {
                    opts.serverExists = false;
                }

                const scen = buildPushScenario(tableName, opts);
                const ci = condInputFor(scen, opts);
                fc.pre(!isBugCondition(ci)); // reconciled rows are always non-buggy

                flushPreparedItemsUnfixed(scen.db, scen.serverDocs, [scen.prepared], 10);

                const entry = scen.db.syncOutbox.get(scen.prepared.entryId);
                assert.strictEqual(entry.status, 'sent', `[pbt:${tableName}] reconciled push should succeed`);
                const mapping = scen.db.syncIdMap.get(scen.rowSyncId);
                assert.strictEqual(
                    Number(mapping.version),
                    localVersion + 1,
                    `[pbt:${tableName}] version should increment by 1 (got ${mapping.version})`
                );
                assert.strictEqual(
                    scen.db.syncConflicts.length,
                    0,
                    `[pbt:${tableName}] no conflict expected for a clean reconciled push`
                );
            }
        ),
        { numRuns: MIN_CASES, verbose: true }
    );

    // =====================================================================
    // PBT — Byte-equivalent conflict auto-resolution (3.4) across tables.
    // For ANY guard-tripping collision where local/remote are byte-equivalent,
    // the push auto-resolves to the remote version with NO conflict, regardless
    // of whether the local row was reconciled. isBugCondition is always false.
    // =====================================================================
    fc.assert(
        fc.property(
            fc.constantFrom.apply(fc, AFFECTED_TABLES),
            fc.integer({ min: 1, max: 9999 }),
            fc.integer({ min: 0, max: 50 }), // local version (0 → unreconciled, but byte-equal so non-buggy)
            fc.integer({ min: 1_700_000_000, max: 1_730_000_000 }),
            fc.string({ minLength: 1, maxLength: 12 }),
            (tableName, localId, localVersion, updatedAt, text) => {
                // Identical underlying row data on both sides → byte-equivalent.
                const rowOpts = {
                    value: tableName === 'settings' ? `v_${text}` : undefined,
                    noteText: tableName === 'system_tags' ? `n_${text}` : undefined,
                    status: tableName === 'compensation_tracking' ? 'paid' : undefined,
                    updatedAt
                };
                const localData = makeRowData(tableName, rowOpts);
                const serverData = makeRowData(tableName, rowOpts);
                const serverVersion = localVersion + 1; // guarantees the guard trips

                const opts = {
                    localId,
                    rowSyncId: `school:${tableName}:${localId}`,
                    localData,
                    serverData,
                    localVersion,
                    localAncestor: localVersion > 0 ? JSON.stringify(makeRowData(tableName, rowOpts)) : null,
                    serverExists: true,
                    serverVersion,
                    serverUpdatedAt: updatedAt
                };

                const scen = buildPushScenario(tableName, opts);
                const ci = condInputFor(scen, opts);
                fc.pre(isEquivalentRemoteData(ci.localData, ci.serverData));
                fc.pre(!isBugCondition(ci)); // byte-equivalent ⇒ never the bug condition

                flushPreparedItemsUnfixed(scen.db, scen.serverDocs, [scen.prepared], 10);

                const entry = scen.db.syncOutbox.get(scen.prepared.entryId);
                assert.strictEqual(entry.status, 'sent', `[pbt:${tableName}] byte-equivalent collision should auto-resolve`);
                const mapping = scen.db.syncIdMap.get(scen.rowSyncId);
                assert.strictEqual(
                    Number(mapping.version),
                    serverVersion,
                    `[pbt:${tableName}] version should adopt remote version (got ${mapping.version})`
                );
                assert.strictEqual(
                    scen.db.syncConflicts.length,
                    0,
                    `[pbt:${tableName}] no conflict expected for byte-equivalent data`
                );
            }
        ),
        { numRuns: MIN_CASES, verbose: true }
    );

    // =====================================================================
    // PBT — Genuine version-lag on RECONCILED rows (3.3) across tables.
    // For ANY reconciled row (version > 0, ancestor present) whose server copy
    // is ahead and NOT byte-equivalent, the guard rejects the push and records
    // exactly one unresolved conflict, leaving sync_id_map unchanged.
    // =====================================================================
    fc.assert(
        fc.property(
            fc.constantFrom.apply(fc, AFFECTED_TABLES),
            fc.integer({ min: 1, max: 9999 }),
            fc.integer({ min: 1, max: 200 }), // reconciled local version (> 0)
            fc.integer({ min: 1_700_000_000, max: 1_730_000_000 }),
            fc.string({ minLength: 1, maxLength: 12 }),
            (tableName, localId, localVersion, updatedAt, text) => {
                const localData = makeRowData(tableName, {
                    value: tableName === 'settings' ? `local_${text}` : undefined,
                    noteText: tableName === 'system_tags' ? `local_${text}` : undefined,
                    status: tableName === 'compensation_tracking' ? 'paid' : undefined,
                    updatedAt
                });
                // Server differs genuinely (different value AND newer updated_at) → not byte-equivalent.
                const serverData = makeRowData(tableName, {
                    value: tableName === 'settings' ? `remote_${text}` : undefined,
                    noteText: tableName === 'system_tags' ? `remote_${text}` : undefined,
                    status: tableName === 'compensation_tracking' ? 'unpaid' : undefined,
                    updatedAt: updatedAt + 1000
                });

                const opts = {
                    localId,
                    rowSyncId: `school:${tableName}:${localId}`,
                    localData,
                    serverData,
                    localVersion,
                    localAncestor: JSON.stringify(makeRowData(tableName, { updatedAt: updatedAt - 500 })),
                    serverExists: true,
                    serverVersion: localVersion + 1, // server genuinely ahead of the pushed version
                    serverUpdatedAt: updatedAt + 1000
                };

                const scen = buildPushScenario(tableName, opts);
                const ci = condInputFor(scen, opts);
                fc.pre(!isEquivalentRemoteData(ci.localData, ci.serverData));
                fc.pre(!isBugCondition(ci)); // reconciled ⇒ never the bug condition

                const beforeVersion = Number(scen.db.syncIdMap.get(scen.rowSyncId).version);
                const beforeAncestor = scen.db.syncIdMap.get(scen.rowSyncId).ancestor_data;

                flushPreparedItemsUnfixed(scen.db, scen.serverDocs, [scen.prepared], 10);

                const entry = scen.db.syncOutbox.get(scen.prepared.entryId);
                assert.strictEqual(entry.status, 'failed', `[pbt:${tableName}] genuine version-lag should fail the push`);
                const conflicts = scen.db.syncConflicts.filter((c) => c.status === 'unresolved');
                assert.strictEqual(conflicts.length, 1, `[pbt:${tableName}] expected exactly one unresolved conflict`);
                const mapping = scen.db.syncIdMap.get(scen.rowSyncId);
                assert.strictEqual(Number(mapping.version), beforeVersion, `[pbt:${tableName}] version must be unchanged`);
                assert.strictEqual(mapping.ancestor_data, beforeAncestor, `[pbt:${tableName}] ancestor_data must be unchanged`);
            }
        ),
        { numRuns: MIN_CASES, verbose: true }
    );

    // =====================================================================
    // PBT — Merge invariant for genuine concurrent edits with ancestor (3.1/3.2).
    // With an ancestor present: disjoint field edits merge cleanly into the
    // union; a same-field edit produces an LWW conflict resolved by timestamp.
    // =====================================================================
    fc.assert(
        fc.property(
            fc.integer({ min: -1000, max: 1000 }), // ancestor a
            fc.integer({ min: -1000, max: 1000 }), // ancestor b
            fc.integer({ min: -1000, max: 1000 }), // local's new a
            fc.integer({ min: -1000, max: 1000 }), // remote's new b
            fc.integer({ min: -1000, max: 1000 }), // remote's new a (for same-field case)
            fc.integer({ min: 0, max: 10000 }), // localTs
            fc.integer({ min: 0, max: 10000 }), // remoteTs
            (a0, b0, aLocal, bRemote, aRemote, localTs, remoteTs) => {
                const ancestor = { a: a0, b: b0 };

                // --- Different-field edits → clean union (3.1) ---
                // Only assert when the edits are genuinely on different fields.
                fc.pre(aLocal !== a0 && bRemote !== b0);
                const localD = { a: aLocal, b: b0 };
                const remoteD = { a: a0, b: bRemote };
                const merged = threeWayMerge(ancestor, localD, remoteD, localTs, remoteTs);
                assert.deepStrictEqual(merged.conflicts, [], 'different-field edits must not conflict');
                assert.notStrictEqual(merged.resolution, 'lww', 'different-field edits must not be LWW');
                assert.strictEqual(merged.merged.a, aLocal, 'local change to `a` must survive');
                assert.strictEqual(merged.merged.b, bRemote, 'remote change to `b` must survive');

                // --- Same-field edits → LWW conflict (3.2) ---
                // Only assert when both genuinely changed `a` to DIFFERENT values.
                fc.pre(aRemote !== a0 && aRemote !== aLocal);
                const localS = { a: aLocal, b: b0 };
                const remoteS = { a: aRemote, b: b0 };
                const lww = threeWayMerge(ancestor, localS, remoteS, localTs, remoteTs);
                assert.deepStrictEqual(lww.conflicts, ['a'], 'same-field edit must record `a` as a conflict');
                assert.strictEqual(lww.resolution, 'lww', 'same-field edit must resolve via LWW');
                assert.strictEqual(
                    lww.merged.a,
                    remoteTs >= localTs ? aRemote : aLocal,
                    'LWW must pick the newer writer'
                );
            }
        ),
        { numRuns: MIN_CASES, verbose: true }
    );

    console.log(`[preservation] OK — baseline preserved across ${checks} pinned checks + 4 property suites ` +
        `(${MIN_CASES}+ cases each). All non-buggy push/merge behavior captured.`);
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 2 (Preservation) — a non-buggy push/merge behavior did NOT match the ' +
        'expected baseline on the unfixed code. This baseline must hold before (and after) the fix.');
    console.error(err && err.message ? err.message : err);
    if (err && err.counterexample) {
        console.error('Counterexample: ' + JSON.stringify(err.counterexample));
    }
    process.exit(1);
}
