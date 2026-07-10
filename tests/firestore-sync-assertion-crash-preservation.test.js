'use strict';

// Preservation test — EXPECTED to PASS on UNFIXED code (baseline capture).
//
// Spec: .kiro/specs/firestore-sync-assertion-crash-fix/
// Task 2 — Property 2 (Preservation):
//   "الحفاظ على سلوك المسار غير المتأثّر"
//   (Preserve the behavior of the un-affected push path.)
//
//   The fix for the INTERNAL ASSERTION / auth-network crash (tasks 3.1–3.4)
//   adds a NEW classifier `isAssertionOrAuthNetworkError(err)` plus a
//   recovery/transient branch that is gated STRICTLY on that classifier (i.e.
//   on `isBugCondition`). Therefore every push attempt whose thrown error is
//   NOT an auth-network / INTERNAL ASSERTION error — successful commits,
//   throttling errors (`unavailable` / `aborted` / `resource-exhausted`),
//   access-denied (`permission-denied`), and version conflicts — must behave
//   byte-for-byte as it does today: the same unified result object, the same
//   `sync_outbox` status transitions, the same `sync_id_map.version` /
//   `ancestor_data` updates, the same `sync_conflicts` rows, and no Firestore
//   data loss or duplication.
//
//   This file encodes that as an EXACT-EQUALITY property: for every input where
//   `isBugCondition` is false, the FIXED push surface produces a result that is
//   strictly equal to the ORIGINAL push surface. Both surfaces are replicated
//   verbatim from production here (see note below); the `fixed` replica also
//   carries the planned `isAssertionOrAuthNetworkError` + recoverable branch.
//   Because that branch can only ever fire inside the bug domain, the two
//   surfaces are identical across the entire non-buggy input space — which is
//   exactly what makes this a valid baseline that PASSES on unfixed code and
//   keeps PASSING after the fix (task 3.6).
//
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
//
// ---------------------------------------------------------------------------
// Why this test runs in plain Node and replicates the push path
// ---------------------------------------------------------------------------
// Same constraint as tests/firestore-sync-assertion-crash-bug-exploration.test.js:
// the push handling (`writeItemWithVersionCheck` / `flushSyncOutbox` /
// `markEntrySent` / `markEntryFailed`) lives un-exported inside
// `main/sync/engine.js`, whose require chain pulls in `electron` and the live
// Firestore SDK, and `better-sqlite3` is compiled against Electron's ABI — so
// engine.js cannot be loaded under plain Node. We therefore faithfully
// replicate the small push surface from engine.js (annotated with the exact
// semantics each replica mirrors) against an in-memory model of the sync tables
// plus a fake Firestore store. Each piece is kept in lock-step with the task-1
// exploration test so both exercise the same baseline surface.

const assert = require('assert');
const fc = require('fast-check');

const MIN_CASES = 200;

// ---------------------------------------------------------------------------
// engine.js:412 — isThrottleError(err) [VERBATIM] — unchanged by the fix.
// Treats `resource-exhausted`, `unavailable`, `aborted` as throttling; every
// other code is NOT throttling.
// ---------------------------------------------------------------------------
function isThrottleError(err) {
    return ['resource-exhausted', 'unavailable', 'aborted'].includes(err && err.code);
}

// ---------------------------------------------------------------------------
// design.md → Bug Details → isBugCondition(input)  [VERBATIM SHAPE]
// The runtime condition for the crash. The preservation domain is its negation.
// ---------------------------------------------------------------------------
function isBugCondition(input) {
    const msg = (input.thrownError && input.thrownError.message) || '';
    return (
        input.insideTransaction &&
        input.tokenRefreshNeeded &&
        input.networkInterrupted &&
        (
            (input.thrownError && input.thrownError.code === 'auth/network-request-failed') ||
            /INTERNAL ASSERTION FAILED: Unexpected state/.test(msg) ||
            /\(ID: b815\)|\(ID: 3c6b\)/.test(msg)
        )
    );
}

// ---------------------------------------------------------------------------
// design.md → Fix Implementation → isAssertionOrAuthNetworkError(err)
// The NEW classifier the fix introduces (task 3.1). Returns true only for the
// bug-domain errors; false for every existing/other error code.
// ---------------------------------------------------------------------------
function isAssertionOrAuthNetworkError(err) {
    if (!err) return false;
    if (err.code === 'auth/network-request-failed') return true;
    const text = `${err.message || ''} ${err.context ? JSON.stringify(err.context) : ''}`;
    return (
        /INTERNAL ASSERTION FAILED: Unexpected state/.test(text) ||
        /\(ID: b815\)|\(ID: 3c6b\)/.test(text)
    );
}

// ---------------------------------------------------------------------------
// engine.js — buildFirestorePayload(item) [MIRROR].
// ---------------------------------------------------------------------------
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

// engine.js — isEquivalentRemoteData(...) — collapsed to a strict structural
// compare of the payload-relevant fields (sufficient for this bug's domain;
// the real byte-equivalence path is exercised by the phantom-conflicts spec).
function isEquivalentRemoteData(localData, remoteData) {
    const a = JSON.stringify(localData || {});
    const r = { ...(remoteData || {}) };
    delete r.version;
    delete r.operation;
    delete r.rowSyncId;
    delete r.deviceHash;
    delete r.schoolYear;
    delete r.updatedAt;
    const b = JSON.stringify(r);
    return a === b;
}

// ---------------------------------------------------------------------------
// In-memory model of the sync tables + a fake Firestore store.
//   - sync_outbox  : id -> { status, retries, last_error, row_data, ... }
//   - sync_id_map  : row_sync_id -> { version, ancestor_data }
//   - sync_conflicts (array)
//   - serverDocs   : `${path}/${id}` -> payload (the Firestore store)
// ---------------------------------------------------------------------------
function makeSyncDb() {
    return {
        syncIdMap: new Map(),
        syncOutbox: new Map(),
        syncConflicts: [],
        _conflictSeq: 0
    };
}

// engine.js — markEntrySent(db, entryId, versionOverride, rowSyncId, rowData) [MIRROR]
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

// engine.js:844 — markEntryFailed(db, entryId, error, maxRetries, ignoreMaxRetries, forceFailed) [VERBATIM rule]
function markEntryFailed(db, entryId, error, maxRetries, ignoreMaxRetries = false, forceFailed = false) {
    const entry = db.syncOutbox.get(entryId);
    if (!entry) return;
    const retries = Number(entry.retries || 0);
    entry.status = forceFailed ? 'failed' : !ignoreMaxRetries && retries >= maxRetries ? 'failed' : 'pending';
    entry.last_error = error;
}

// engine.js — logVersionConflict(...) [MIRROR, minimal].
function logVersionConflict(db, prepared, result) {
    const existing = db.syncConflicts.find(
        (c) => c.local_outbox_id === prepared.entryId && c.status === 'unresolved'
    );
    if (existing) {
        existing.remote_version = result.remoteVersion;
        return;
    }
    db.syncConflicts.push({
        id: ++db._conflictSeq,
        row_sync_id: prepared.item.rowSyncId,
        local_outbox_id: prepared.entryId,
        remote_version: result.remoteVersion,
        status: 'unresolved'
    });
}

// ---------------------------------------------------------------------------
// Fault injection through a fake runTransaction.
//   injection === null            → healthy commit (Req 3.1)
//   { kind: 'throw', error }       → the awaited transaction rejects (Req 3.2/3.4
//                                    access-denied), caught by the try/catch.
//   { kind: 'conflict' }           → version guard trips (Req 3.4).
// The injected `error.code` is constrained by the generator to the NON-buggy
// domain (never auth/network-request-failed or INTERNAL ASSERTION).
// ---------------------------------------------------------------------------
async function fakeRunTransaction(serverDocs, prepared, injection) {
    const key = `${prepared.item.collectionPath}/${prepared.item.documentId}`;

    if (injection && injection.kind === 'throw') {
        throw injection.error;
    }

    const existing = serverDocs.get(key);
    if (injection && injection.kind === 'conflict') {
        // Guard: server doc exists with version >= pushed version.
        const remoteData = existing || injection.remoteData;
        return { conflict: true, remoteData: remoteData || {} };
    }

    // Healthy commit: write-through to the fake Firestore store (merge semantics).
    serverDocs.set(key, buildFirestorePayload(prepared.item));
    return { conflict: false };
}

// ---------------------------------------------------------------------------
// engine.js:769 — writeItemWithVersionCheck(firestoreDb, item) [MIRROR].
// `mode` selects the ORIGINAL (unfixed) catch or the FIXED catch.
//   ORIGINAL: catch → { success:false, error, errorName, isAccessDenied, isThrottle }
//   FIXED   : catch → if isAssertionOrAuthNetworkError → recoverable/transient,
//                     ELSE identical to ORIGINAL.
// ---------------------------------------------------------------------------
async function writeItemWithVersionCheck(serverDocs, prepared, injection, mode) {
    try {
        const transactionResult = await fakeRunTransaction(serverDocs, prepared, injection);

        if (transactionResult && transactionResult.conflict) {
            const remoteData = transactionResult.remoteData || {};
            return {
                success: false,
                conflict: true,
                equivalent: isEquivalentRemoteData(prepared.item.data, remoteData),
                error: 'Version conflict',
                errorName: 'VERSION_CONFLICT',
                remoteData,
                remoteVersion: Number(remoteData.version || 0),
                remoteDeviceHash: remoteData.deviceHash || ''
            };
        }
        return { success: true };
    } catch (err) {
        // FIXED branch (tasks 3.1/3.2): bug-domain errors become recoverable/transient.
        if (mode === 'fixed' && isAssertionOrAuthNetworkError(err)) {
            return { success: false, isRecoverable: true, isTransient: true, errorName: err.code };
        }
        // VERBATIM unfixed engine.js catch (also the FIXED fall-through for
        // every non-bug-domain error):
        const isAccessDenied = err.code === 'permission-denied';
        return { success: false, error: err.message, errorName: err.code, isAccessDenied, isThrottle: isThrottleError(err) };
    }
}

// ---------------------------------------------------------------------------
// engine.js — flushSyncOutbox(...) marking loop [MIRROR], with the fix wiring
// point gated by `mode`. Returns the unified result for the single row plus the
// observable side effects (row status + sync_id_map snapshot + server store).
// ---------------------------------------------------------------------------
async function flushOne(db, serverDocs, prepared, injection, maxRetries, mode) {
    const result = await writeItemWithVersionCheck(serverDocs, prepared, injection, mode);
    const entryId = prepared.entryId;

    if (result.success) {
        markEntrySent(db, entryId);
        return result;
    }

    if (result.conflict && result.equivalent) {
        markEntrySent(db, entryId, result.remoteVersion || prepared.item.version);
        return result;
    }

    // FIXED wiring point (task 3.2): recoverable/transient → keep row pending.
    if (mode === 'fixed' && result.isRecoverable) {
        const entry = db.syncOutbox.get(entryId);
        entry.status = 'pending';
        entry.last_error = result.errorName || 'recoverable';
        return result;
    }

    // UNFIXED marking path (and FIXED fall-through for non-bug-domain errors).
    markEntryFailed(db, entryId, result.error || 'Conditional write failed', maxRetries, result.isThrottle || result.isAccessDenied, result.conflict);
    if (result.conflict) {
        logVersionConflict(db, prepared, result);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Scenario builder. Produces a fresh db + server store + prepared row.
// ---------------------------------------------------------------------------
function makeRowData(entityType, opts) {
    return {
        id: opts.id,
        entity_type: entityType,
        name: opts.name || `${entityType}-${opts.id}`,
        value: opts.value != null ? opts.value : 'v',
        school_year: opts.schoolYear || '2025/2026'
    };
}

function buildScenario(opts) {
    const db = makeSyncDb();
    const serverDocs = new Map();

    const entityType = opts.entityType || 'students';
    const tableName = opts.tableName || entityType;
    const localId = opts.localId || 1;
    const rowSyncId = `school:${entityType}:${localId}`;
    const schoolYear = opts.schoolYear || '2025/2026';
    const localData = opts.localData || makeRowData(entityType, { id: localId, schoolYear });

    db.syncIdMap.set(rowSyncId, {
        row_sync_id: rowSyncId,
        version: opts.localVersion || 0,
        ancestor_data: opts.localAncestor != null ? opts.localAncestor : null
    });

    db.syncOutbox.set(1, {
        id: 1,
        table_name: tableName,
        row_sync_id: rowSyncId,
        operation: 'PUT',
        row_data: JSON.stringify(localData),
        status: 'pending',
        retries: opts.retries || 0,
        last_error: null
    });

    const pushedVersion = Number(db.syncIdMap.get(rowSyncId).version || 0) + 1;

    if (opts.serverExists) {
        const serverItem = {
            collectionPath: tableName,
            documentId: rowSyncId,
            data: opts.serverData || localData,
            version: opts.serverVersion != null ? opts.serverVersion : pushedVersion,
            operation: 'PUT',
            rowSyncId,
            deviceHash: 'devSERVER0000bb',
            schoolYear,
            updatedAt: opts.serverUpdatedAt || 1726000000
        };
        serverDocs.set(`${tableName}/${rowSyncId}`, buildFirestorePayload(serverItem));
    }

    const prepared = {
        entryId: 1,
        tableName,
        item: {
            collectionPath: tableName,
            documentId: rowSyncId,
            entityType,
            data: localData,
            version: pushedVersion,
            operation: 'PUT',
            rowSyncId,
            deviceHash: 'devLOCAL00000aa',
            schoolYear,
            updatedAt: opts.localUpdatedAt || 1726000000
        }
    };

    return { db, serverDocs, prepared, rowSyncId, tableName, pushedVersion };
}

// Snapshot the observable state for original-vs-fixed comparison.
function snapshot(scenario) {
    const entry = scenario.db.syncOutbox.get(1);
    const mapping = scenario.db.syncIdMap.get(scenario.rowSyncId);
    return {
        status: entry.status,
        last_error: entry.last_error,
        version: Number(mapping.version),
        ancestor_data: mapping.ancestor_data,
        conflicts: scenario.db.syncConflicts.map((c) => ({ row: c.row_sync_id, status: c.status, rv: c.remote_version })),
        server: [...scenario.serverDocs.entries()].map(([k, v]) => [k, JSON.stringify(v)]).sort()
    };
}

// Run the same scenario through both surfaces and return both results+snapshots.
async function runBoth(opts, injectionFactory) {
    const orig = buildScenario(opts);
    const fixed = buildScenario(opts);
    const rOrig = await flushOne(orig.db, orig.serverDocs, orig.prepared, injectionFactory(), 10, 'original');
    const rFixed = await flushOne(fixed.db, fixed.serverDocs, fixed.prepared, injectionFactory(), 10, 'fixed');
    return { orig, fixed, rOrig, rFixed };
}

// ===========================================================================
// Runner
// ===========================================================================
console.log(
    '[preservation] firestore sync INTERNAL ASSERTION crash — Property 2 (Preservation) ' +
        '(EXPECTED TO PASS on unfixed code — baseline capture)'
);

let checks = 0;

(async () => {
    try {
        // =================================================================
        // 3.1 — Successful push via runTransaction on a stable network with a
        //       valid token: row → 'sent', version incremented, server doc
        //       written exactly once, no conflict. isBugCondition === false.
        // =================================================================
        {
            const opts = { entityType: 'students', localId: 1, localVersion: 4 };
            const both = await runBoth(opts, () => null); // healthy commit

            assert.ok(
                !isBugCondition({ insideTransaction: true, tokenRefreshNeeded: false, networkInterrupted: false, thrownError: {} }),
                '[3.1] precondition: stable network is NOT the bug condition'
            );
            const sOrig = snapshot(both.orig);
            assert.strictEqual(sOrig.status, 'sent', '[3.1] expected outbox status "sent"');
            assert.strictEqual(sOrig.version, 5, '[3.1] expected sync_id_map.version 4 -> 5');
            assert.strictEqual(sOrig.conflicts.length, 0, '[3.1] expected no conflicts');
            assert.strictEqual(sOrig.server.length, 1, '[3.1] expected exactly one server doc (no duplication)');
            assert.deepStrictEqual(snapshot(both.fixed), sOrig, '[3.1] fixed must equal original for a clean push');
            assert.deepStrictEqual(both.rFixed, both.rOrig, '[3.1] fixed result must equal original result');
            checks += 1;
        }

        // =================================================================
        // 3.2 — A row that fails with another transient error (unavailable /
        //       aborted / resource-exhausted) remains 'pending'. Same result &
        //       side effects under original and fixed. isBugCondition === false.
        // =================================================================
        for (const code of ['unavailable', 'aborted', 'resource-exhausted']) {
            const opts = { entityType: 'teachers', localId: 2, localVersion: 0 };
            const makeErr = () => {
                const e = new Error(`Firestore transient: ${code}`);
                e.code = code;
                return e;
            };
            assert.ok(
                !isBugCondition({ insideTransaction: true, tokenRefreshNeeded: true, networkInterrupted: true, thrownError: makeErr() }),
                `[3.2:${code}] precondition: a plain transient error is NOT the bug condition`
            );
            const both = await runBoth(opts, () => ({ kind: 'throw', error: makeErr() }));
            const sOrig = snapshot(both.orig);
            assert.strictEqual(sOrig.status, 'pending', `[3.2:${code}] expected outbox to remain 'pending'`);
            assert.strictEqual(sOrig.version, 0, `[3.2:${code}] expected sync_id_map.version unchanged`);
            assert.strictEqual(both.rOrig.isThrottle, true, `[3.2:${code}] expected isThrottle === true (unchanged classification)`);
            assert.deepStrictEqual(snapshot(both.fixed), sOrig, `[3.2:${code}] fixed must equal original`);
            assert.deepStrictEqual(both.rFixed, both.rOrig, `[3.2:${code}] fixed result must equal original result`);
            checks += 1;
        }

        // =================================================================
        // 3.3 — Data previously uploaded to Firestore stays intact, no loss /
        //       duplication. A failing push must NOT mutate the server store;
        //       a successful push writes the SAME key once (merge), never twice.
        // =================================================================
        {
            // Pre-existing server doc; local push fails transiently → store intact.
            const opts = {
                entityType: 'grades',
                localId: 3,
                localVersion: 2,
                serverExists: true,
                serverVersion: 2,
                serverData: makeRowData('grades', { id: 3, value: 'server-original' })
            };
            const before = JSON.stringify([...buildScenario(opts).serverDocs.entries()]);
            const makeErr = () => {
                const e = new Error('temporarily unavailable');
                e.code = 'unavailable';
                return e;
            };
            const both = await runBoth(opts, () => ({ kind: 'throw', error: makeErr() }));
            const sOrig = snapshot(both.orig);
            assert.strictEqual(
                JSON.stringify([...both.orig.serverDocs.entries()]),
                before,
                '[3.3] failing push must leave previously uploaded data intact'
            );
            assert.strictEqual(sOrig.server.length, 1, '[3.3] expected exactly one server doc (no duplication)');
            assert.deepStrictEqual(snapshot(both.fixed), sOrig, '[3.3] fixed must equal original');
            checks += 1;
        }

        // =================================================================
        // 3.4 — Version guard / reconciliation behaves unchanged. A genuine
        //       NON-equivalent version conflict → outbox 'failed', exactly one
        //       unresolved conflict, sync_id_map unchanged. Equivalent conflict
        //       → auto-resolved 'sent' at remote version. isBugCondition === false.
        // =================================================================
        {
            // Non-equivalent conflict (genuine version lag).
            const opts = {
                entityType: 'absences',
                localId: 4,
                localVersion: 3,
                localAncestor: JSON.stringify(makeRowData('absences', { id: 4, value: 'ancestor' })),
                localData: makeRowData('absences', { id: 4, value: 'local-edit' }),
                serverExists: true,
                serverVersion: 4,
                serverData: makeRowData('absences', { id: 4, value: 'server-edit' })
            };
            const both = await runBoth(opts, () => ({ kind: 'conflict' }));
            const sOrig = snapshot(both.orig);
            assert.strictEqual(sOrig.status, 'failed', '[3.4] genuine conflict → outbox "failed"');
            assert.strictEqual(sOrig.version, 3, '[3.4] sync_id_map.version unchanged on conflict');
            assert.strictEqual(sOrig.ancestor_data, opts.localAncestor, '[3.4] ancestor_data unchanged on conflict');
            const unresolved = sOrig.conflicts.filter((c) => c.status === 'unresolved');
            assert.strictEqual(unresolved.length, 1, '[3.4] exactly one unresolved conflict logged');
            assert.deepStrictEqual(snapshot(both.fixed), sOrig, '[3.4] fixed must equal original (conflict path)');
            assert.deepStrictEqual(both.rFixed, both.rOrig, '[3.4] fixed result must equal original result');
            checks += 1;
        }

        {
            // Byte-equivalent conflict (auto-resolve via reconciliation).
            const sameData = makeRowData('exams', { id: 5, value: 'identical' });
            const opts = {
                entityType: 'exams',
                localId: 5,
                localVersion: 0,
                localData: sameData,
                serverExists: true,
                serverVersion: 1,
                serverData: sameData
            };
            const both = await runBoth(opts, () => ({ kind: 'conflict' }));
            const sOrig = snapshot(both.orig);
            assert.strictEqual(sOrig.status, 'sent', '[3.4] byte-equivalent conflict → auto-resolved "sent"');
            assert.strictEqual(sOrig.version, 1, '[3.4] version adopted from remote (1)');
            assert.strictEqual(sOrig.conflicts.length, 0, '[3.4] no conflict row for byte-equivalent data');
            assert.deepStrictEqual(snapshot(both.fixed), sOrig, '[3.4] fixed must equal original (equivalent path)');
            checks += 1;
        }

        // =================================================================
        // PBT — For ANY input that does NOT meet the bug condition (success,
        // throttle, access-denied, generic non-bug error, or version conflict),
        // the FIXED push surface produces a result and side effects strictly
        // equal to the ORIGINAL push surface. This is the core preservation
        // property (Req 3.1–3.4) across a broad generated input space.
        // =================================================================
        const ENTITY_TYPES = ['students', 'teachers', 'grades', 'absences', 'system_tags', 'exams'];
        // Deliberately excludes auth/network-request-failed & INTERNAL ASSERTION.
        const NONBUG_ERROR_CODES = [
            'unavailable',
            'aborted',
            'resource-exhausted',
            'permission-denied',
            'not-found',
            'deadline-exceeded',
            'failed-precondition'
        ];
        const OUTCOMES = ['success', 'throw', 'conflict'];

        await fc.assert(
            fc.asyncProperty(
                fc.constantFrom.apply(fc, ENTITY_TYPES),
                fc.integer({ min: 1, max: 9999 }), // local id
                fc.integer({ min: 0, max: 500 }), // local version
                fc.constantFrom.apply(fc, OUTCOMES),
                fc.constantFrom.apply(fc, NONBUG_ERROR_CODES),
                fc.boolean(), // for conflict: byte-equivalent or not
                fc.integer({ min: 0, max: 12 }), // retries
                async (entityType, localId, localVersion, outcome, errCode, equivalent, retries) => {
                    const localData = makeRowData(entityType, { id: localId, value: `local-${localId}` });

                    const baseOpts = {
                        entityType,
                        localId,
                        localVersion,
                        retries,
                        localData,
                        localAncestor: localVersion > 0 ? JSON.stringify(makeRowData(entityType, { id: localId, value: 'anc' })) : null
                    };

                    let injectionFactory;
                    if (outcome === 'success') {
                        injectionFactory = () => null;
                    } else if (outcome === 'throw') {
                        injectionFactory = () => {
                            const e = new Error(`err:${errCode}`);
                            e.code = errCode;
                            return { kind: 'throw', error: e };
                        };
                        // Guard: ensure this is genuinely NOT the bug condition.
                        fc.pre(
                            !isBugCondition({
                                insideTransaction: true,
                                tokenRefreshNeeded: true,
                                networkInterrupted: true,
                                thrownError: { code: errCode, message: `err:${errCode}` }
                            })
                        );
                    } else {
                        // version conflict
                        const serverData = equivalent ? localData : makeRowData(entityType, { id: localId, value: 'server-diff' });
                        baseOpts.serverExists = true;
                        baseOpts.serverVersion = localVersion + 1;
                        baseOpts.serverData = serverData;
                        injectionFactory = () => ({ kind: 'conflict' });
                    }

                    const both = await runBoth(baseOpts, injectionFactory);

                    // Core property: fixed result === original result.
                    assert.deepStrictEqual(
                        both.rFixed,
                        both.rOrig,
                        `[pbt] result drift (entity=${entityType}, outcome=${outcome}, code=${errCode})`
                    );
                    // And all observable side effects are identical.
                    assert.deepStrictEqual(
                        snapshot(both.fixed),
                        snapshot(both.orig),
                        `[pbt] side-effect drift (entity=${entityType}, outcome=${outcome}, code=${errCode}, equiv=${equivalent})`
                    );
                }
            ),
            { numRuns: MIN_CASES, verbose: true }
        );

        console.log(`[preservation] OK — ${checks} pinned baseline checks + ${MIN_CASES} generated cases passed on unfixed code.`);
        process.exit(0);
    } catch (err) {
        console.error('FAIL: preservation baseline did not hold (Property 2 — Req 3.1/3.2/3.3/3.4).');
        console.error(err && err.message ? err.message : err);
        if (err && err.counterexample) {
            console.error('Counterexample: ' + JSON.stringify(err.counterexample));
        }
        process.exit(1);
    }
})();
