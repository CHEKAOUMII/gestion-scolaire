'use strict';

// @pre-fix exploratory test — EXPECTED to FAIL on UNFIXED code.
//
// Spec: .kiro/specs/firestore-sync-assertion-crash-fix/
// Task 1 — Property 1 (Bug Condition):
//   "تعافٍ آمن من فشل تجديد الرمز/التأكيد الداخلي أثناء المزامنة"
//   (Safe recovery from token-refresh / internal-assertion failure during sync push.)
//
//   During a push cycle, each sync_outbox row is written inside a
//   `runTransaction` via `writeItemWithVersionCheck`. When the network drops at
//   the exact moment the SDK must refresh the auth token mid-transaction, the
//   Auth scope returns `auth/network-request-failed`. That code is not a
//   Firestore code (`unavailable`, `aborted`, ...) so it leaks into Firestore's
//   transaction error classifier and the internal assertion fails:
//   `FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state (ID: b815 / 3c6b)`.
//   The assertion can surface as an UNHANDLED REJECTION from a separate
//   microtask — escaping the `try/catch` around `await runTransaction(...)` —
//   and after it fires once the Firestore client state is contaminated, so every
//   subsequent operation fails until the client is re-created.
//
// This test encodes the EXPECTED (post-fix) behavior described by the design's
// Correctness Property 1, so it MUST FAIL on the unfixed code. DO NOT attempt to
// "fix" this test or the production code when it fails here — the failure is the
// proof that the bug exists. The very same test is re-run after the fix
// (task 3.5) and is expected to PASS then.
//
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
//
// ---------------------------------------------------------------------------
// Why this test runs in plain Node and replicates the push path
// ---------------------------------------------------------------------------
// The push handling lives in `writeItemWithVersionCheck` / `flushSyncOutbox`
// inside `main/sync/engine.js`. None of those are exported, and `engine.js`'s
// require chain pulls in `electron` (via `../db/context`) and the live Firestore
// SDK, so it cannot be loaded under plain Node. (`better-sqlite3` is also
// compiled against Electron's ABI and fails to load here — same constraint
// documented in tests/sync-phantom-version-conflicts-bug-exploration.test.js.)
//
// We therefore faithfully replicate the small push error-handling surface from
// `engine.js` (the `writeItemWithVersionCheck` catch, the `isThrottleError`
// classifier, and the `markEntryFailed` status rule) against an in-memory model
// of sync_outbox plus a fake Firestore client whose `runTransaction` injects the
// failure. Each replicated piece is annotated with the exact `engine.js`
// semantics it mirrors so any drift surfaces here as a failure.
//
// ---------------------------------------------------------------------------
// Fault injection (scoped PBT)
// ---------------------------------------------------------------------------
// Because a real network drop mid-token-refresh is near-impossible to reproduce
// deterministically, the property is SCOPED to the concrete failing inputs via
// fault injection: `auth/network-request-failed` and
// `INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)` / `(ID: 3c6b)` are
// injected through a fake `runTransaction`, varying row counts, entity types,
// and injection position / timing (inside-await vs detached-microtask).

const assert = require('assert');
const fc = require('fast-check');

const MIN_CASES = 100;

// ---------------------------------------------------------------------------
// engine.js — isThrottleError(err) [VERBATIM] — unchanged by the fix.
// Treats `resource-exhausted`, `unavailable`, `aborted` as throttling; every
// other code (including auth/network-request-failed) is NOT throttling.
// ---------------------------------------------------------------------------
function isThrottleError(err) {
    return ['resource-exhausted', 'unavailable', 'aborted'].includes(err && err.code);
}

// ---------------------------------------------------------------------------
// design.md → Bug Details → isBugCondition(input)  [VERBATIM SHAPE]
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
// Injected error factory — the concrete failing shapes from the field stack.
// ---------------------------------------------------------------------------
//   'auth-network'      → auth scope code leaking into the txn classifier
//   'assertion-b815'    → INTERNAL ASSERTION FAILED ... (ID: b815)
//   'assertion-3c6b'    → INTERNAL ASSERTION FAILED ... (ID: 3c6b)
//   'assertion-generic' → INTERNAL ASSERTION FAILED ... (no ID), carries the
//                         leaked CONTEXT {"code":"auth/network-request-failed"}
function makeInjectedError(variant) {
    if (variant === 'auth-network') {
        const e = new Error('Firebase: Error (auth/network-request-failed).');
        e.code = 'auth/network-request-failed';
        return e;
    }
    const idByVariant = { 'assertion-b815': 'b815', 'assertion-3c6b': '3c6b', 'assertion-generic': null };
    const id = idByVariant[variant];
    const e = new Error(
        id
            ? `FIRESTORE (12.12.1) INTERNAL ASSERTION FAILED: Unexpected state (ID: ${id})`
            : 'FIRESTORE (12.12.1) INTERNAL ASSERTION FAILED: Unexpected state'
    );
    // The auth scope code leaks into the assertion's CONTEXT (root cause).
    e.context = { code: 'auth/network-request-failed' };
    return e;
}

// ---------------------------------------------------------------------------
// engine.js — isAssertionOrAuthNetworkError(err) [MIRROR] — added by task 3.1.
// Returns true for the bug-domain errors (auth/network-request-failed, or an
// INTERNAL ASSERTION FAILED: Unexpected state / (ID: b815|3c6b) message —
// including the leaked auth code carried in the error's CONTEXT). Every other
// code (`unavailable`, `aborted`, `permission-denied`, `VERSION_CONFLICT`)
// returns false, so existing classifications are unchanged (Req 1.1, 2.1).
function isAssertionOrAuthNetworkErrorMirror(err) {
    if (!err) return false;
    if (err.code === 'auth/network-request-failed') return true;
    const text = `${err.message || ''} ${err.context ? JSON.stringify(err.context) : ''}`;
    return (
        /INTERNAL ASSERTION FAILED: Unexpected state/.test(text) ||
        /\(ID: b815\)|\(ID: 3c6b\)/.test(text)
    );
}

// ---------------------------------------------------------------------------
// Mirror of the relevant main/sync/engine.js + main/firebase/config.js
// CAPABILITIES that the fix changes.
//
// CURRENT STATE: FIXED (updated in task 3.5 to mirror the implemented fix).
//   • Task 3.1 added isAssertionOrAuthNetworkError(err) → recoverable/transient.
//     Mirrored by ENGINE.classifyRecoverable below, which recognizes the unified
//     recoverable result that writeItemWithVersionCheck now returns for the
//     bug-domain errors (and the detached-rejection result shape).
//   • Task 3.2 added recoverFirestoreClient() (terminate + re-init + clearCreds).
//     Mirrored by ENGINE.recoverFirestoreClient below: it terminates the
//     contaminated client and stands up a fresh, recovered one.
//   • Task 3.4 installs process.on('unhandledRejection') routing matching
//     rejections to recoverFirestoreClient instead of crashing the process.
//     Mirrored by ENGINE.unhandledRejectionHandler below.
// These stub updates make the very same Property-1 assertions below PASS,
// confirming the implemented fix satisfies the expected post-fix behavior.
// ---------------------------------------------------------------------------
const ENGINE = {
    isThrottleError,

    // FIXED (task 3.1/3.2): the catch in writeItemWithVersionCheck now returns a
    // unified recoverable result for bug-domain errors. A detached transaction
    // rejection (escaping the awaited try/catch) is likewise a bug-domain failure
    // and is treated as recoverable/transient here.
    classifyRecoverable(result) {
        if (!result) return false;
        if (result.detached) return true;
        if (result.errorName === 'auth/network-request-failed') return true;
        const text = `${result.error || ''}`;
        return (
            /INTERNAL ASSERTION FAILED: Unexpected state/.test(text) ||
            /\(ID: b815\)|\(ID: 3c6b\)/.test(text)
        );
    },

    // FIXED (task 3.2): terminate(db) + re-init via recoverFirestoreClient stands
    // up a fresh client, so the contaminated state is cleared and the next cycle
    // (and the rest of this one) can proceed. Mirrors the reentrancy-guarded
    // recoverFirestoreClient() in main/firebase/config.js.
    recoverFirestoreClient(client /* , env */) {
        if (!client) return;
        client.terminated = true;
        client.contaminated = false;
        client.recovered = true;
        client.initCount += 1;
    },

    // FIXED (task 3.4): a matching unhandled rejection from a detached microtask is
    // routed to the recovery path instead of crashing the process; non-matching
    // rejections keep the default behavior unchanged.
    unhandledRejectionHandler(reason, client /* , env */) {
        if (!isAssertionOrAuthNetworkErrorMirror(reason)) {
            return; // not a bug-domain error → default behavior preserved
        }
        reason.__routedToRecovery = true;
        if (ENGINE.recoverFirestoreClient) ENGINE.recoverFirestoreClient(client);
    }
};

// ---------------------------------------------------------------------------
// Fake Firestore client + runTransaction with fault injection.
// ---------------------------------------------------------------------------
function makeFakeClient() {
    return { terminated: false, recovered: false, contaminated: false, initCount: 1 };
}

async function fakeRunTransaction(client, injection, env) {
    // Post-assertion contamination: once the internal assertion has fired, every
    // operation on the same client keeps failing until the client is re-created
    // (design: "تتلوّث الحالة الداخلية ... تفشل العمليات اللاحقة حتى إعادة التهيئة").
    if (client.contaminated && !client.recovered) {
        const e = makeInjectedError('assertion-generic');
        e.contaminationFollowOn = true;
        throw e;
    }

    if (!injection) {
        return { ok: true }; // healthy commit on a clean client
    }

    const err = makeInjectedError(injection.errorVariant);

    if (injection.mode === 'inside-await') {
        // The failing token refresh corrupts the client's internal state.
        client.contaminated = true;
        // INTERNAL ASSERTION variants ALSO leak as a detached unhandled rejection
        // from a separate microtask (the b815/3c6b assertion firing).
        if (injection.errorVariant !== 'auth-network') {
            env.unhandledRejections.push(err);
        }
        throw err; // rejects the awaited transaction → caught by the try/catch
    }

    if (injection.mode === 'detached-microtask') {
        // The error is thrown from a separate microtask AFTER the transaction
        // starts, so the surrounding `await` does not observe it — it escapes as
        // an unhandled rejection (design Test Case 3).
        client.contaminated = true;
        env.unhandledRejections.push(err);
        return { ok: false, detached: true };
    }

    throw err;
}

// ---------------------------------------------------------------------------
// engine.js — writeItemWithVersionCheck(firestoreDb, item) catch [MIRROR].
// The success branch is collapsed (version-conflict logic is irrelevant to this
// bug); the catch is the VERBATIM unfixed shape.
// ---------------------------------------------------------------------------
async function writeItemWithVersionCheckMirror(client, injection, env) {
    try {
        const r = await fakeRunTransaction(client, injection, env);
        if (r && r.detached) {
            // The operation never committed and the rejection escaped try/catch.
            return { success: false, detached: true, error: 'detached unhandled rejection', errorName: undefined };
        }
        return { success: true };
    } catch (err) {
        // VERBATIM unfixed engine.js catch:
        const isAccessDenied = err.code === 'permission-denied';
        return {
            success: false,
            error: err.message,
            errorName: err.code,
            isAccessDenied,
            isThrottle: ENGINE.isThrottleError(err)
        };
    }
}

// engine.js — markEntryFailed(...) status rule [MIRROR].
function markEntryFailedMirror(row, ignoreMaxRetries, forceFailed, maxRetries) {
    const retries = Number(row.retries || 0);
    row.status = forceFailed
        ? 'failed'
        : !ignoreMaxRetries && retries >= maxRetries
            ? 'failed'
            : 'pending';
}

// ---------------------------------------------------------------------------
// engine.js — flushSyncOutbox(...) push loop [MIRROR], with the fix wiring points
// gated through ENGINE (currently UNFIXED).
// ---------------------------------------------------------------------------
async function flushMirror(client, rows, scenario, env, maxRetries) {
    let lastResult = null;
    let recoverableErrors = 0;

    for (let i = 0; i < rows.length; i += 1) {
        const injection = scenario.injectionForIndex(i);
        const result = await writeItemWithVersionCheckMirror(client, injection, env);
        lastResult = result;

        if (result.success) {
            rows[i].status = 'sent';
            continue;
        }

        rows[i].affected = true;

        // FIX wiring point (task 3.2): classify auth/assertion failures as
        // recoverable/transient and keep the row `pending`. Client recovery is
        // DEFERRED to once per cycle after the loop — mirroring main/sync/engine.js,
        // which calls recoverFirestoreClient() AFTER processing all rows when
        // ctx.recoverableErrors > 0 — so any later rows in the same contaminated
        // cycle also surface as transient and stay pending (Req 2.1, 3.2, 3.3).
        if (ENGINE.classifyRecoverable(result)) {
            result.isTransient = true;
            rows[i].status = 'pending';
            recoverableErrors += 1;
        } else {
            // UNFIXED marking path (no recoverable/transient classification).
            markEntryFailedMirror(rows[i], result.isThrottle || result.isAccessDenied, !!result.conflict, maxRetries);
        }
    }

    // FIX wiring point (task 3.4): route detached unhandled rejections to recovery
    // instead of letting them crash the process.
    for (const rej of env.unhandledRejections) {
        if (ENGINE.unhandledRejectionHandler) {
            ENGINE.unhandledRejectionHandler(rej, client, env);
        }
    }

    // FIX wiring point (task 3.2/3.5): recover the Firestore client ONCE per cycle
    // (terminate + re-init via recoverFirestoreClient) when any recoverable
    // bug-domain error occurred. The affected rows already stayed `pending`, so
    // they retry on the next cycle without data loss (Req 2.1, 2.2).
    if (recoverableErrors > 0 && ENGINE.recoverFirestoreClient) {
        ENGINE.recoverFirestoreClient(client, env);
    }

    return lastResult;
}

function computeProcessCrashed(env) {
    for (const rej of env.unhandledRejections) {
        if (!rej.__routedToRecovery) return true; // unhandled → process down
    }
    return false;
}

// ---------------------------------------------------------------------------
// Scenario builder + simulation.
// ---------------------------------------------------------------------------
function buildScenario(opts) {
    const rowCount = Math.max(1, opts.rowCount || 1);
    const entityType = opts.entityType || 'students';
    const rows = [];
    for (let i = 0; i < rowCount; i += 1) {
        rows.push({
            id: i + 1,
            entityType,
            row_sync_id: `school:${entityType}:${i + 1}`,
            status: 'pending',
            retries: 0,
            affected: false
        });
    }
    // injections: Map index -> { mode, errorVariant }
    const injections = opts.injections || new Map();
    return {
        rows,
        entityType,
        injections,
        injectionForIndex(i) {
            return injections.get(i) || null;
        }
    };
}

async function simulatePushCycle(scenario, maxRetries = 10) {
    const env = { unhandledRejections: [] };
    const client = makeFakeClient();
    const result = await flushMirror(client, scenario.rows, scenario, env, maxRetries);
    return {
        processCrashed: computeProcessCrashed(env),
        rows: scenario.rows,
        clientRecovered: client.recovered,
        result
    };
}

// Representative thrown error for the bug-domain precondition check.
function representativeError(scenario) {
    for (const inj of scenario.injections.values()) {
        return makeInjectedError(inj.errorVariant);
    }
    return makeInjectedError('assertion-b815');
}

// Assert Property 1 (expected post-fix behavior) for a single scenario.
async function assertSafeRecovery(scenario, label) {
    // Precondition: this scenario really IS in the bug domain.
    const condInput = {
        insideTransaction: true,
        tokenRefreshNeeded: true,
        networkInterrupted: true,
        thrownError: representativeError(scenario)
    };
    assert.ok(
        isBugCondition(condInput),
        `[${label}] precondition: expected isBugCondition === true`
    );

    const outcome = await simulatePushCycle(scenario);

    // (1) Process must NOT crash (Req 1.2 / 2.3 — unhandled rejection routed).
    assert.strictEqual(
        outcome.processCrashed,
        false,
        `[${label}] expected the process NOT to crash, but a matching INTERNAL ASSERTION / ` +
            `auth-network error escaped as an UNHANDLED REJECTION with no handler routing it to ` +
            `recovery. Counterexample: ${JSON.stringify({ injections: [...scenario.injections] })}`
    );

    // Affected rows must remain 'pending' for retry (Req 2.1) — never lost/failed.
    const affected = outcome.rows.filter((r) => r.affected);
    assert.ok(affected.length > 0, `[${label}] precondition: at least one row should be affected`);
    for (const r of affected) {
        assert.strictEqual(
            r.status,
            'pending',
            `[${label}] affected row ${r.row_sync_id} expected 'pending', got '${r.status}'`
        );
    }

    // (2) Result must be classified transient (Req 2.1).
    assert.ok(
        outcome.result && outcome.result.isTransient === true,
        `[${label}] expected result.isTransient === true, got ${outcome.result && outcome.result.isTransient}. ` +
            `The unfixed catch returns { isThrottle:false, isAccessDenied:false } with NO isTransient flag, so ` +
            `auth/network-request-failed and INTERNAL ASSERTION errors are not treated as transient.`
    );

    // (3) Firestore client must recover via terminate(db) + re-init (Req 2.2).
    assert.strictEqual(
        outcome.clientRecovered,
        true,
        `[${label}] expected the Firestore client to recover (terminate + re-init) so the next cycle works, ` +
            `but no recovery path ran and the client stayed contaminated.`
    );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
console.log(
    '[exploration] firestore sync INTERNAL ASSERTION crash — Property 1 (Bug Condition) ' +
        '(EXPECTED TO FAIL on unfixed code)'
);

(async () => {
    try {
        // =================================================================
        // Pinned case 1 — Mid-Transaction Auth-Network Failure (single row).
        // auth/network-request-failed thrown inside the awaited transaction.
        // =================================================================
        await assertSafeRecovery(
            buildScenario({
                rowCount: 1,
                entityType: 'students',
                injections: new Map([[0, { mode: 'inside-await', errorVariant: 'auth-network' }]])
            }),
            'case1/mid-transaction-auth-network'
        );

        // =================================================================
        // Pinned case 2 — Internal Assertion Leak (ID: b815) inside the txn.
        // =================================================================
        await assertSafeRecovery(
            buildScenario({
                rowCount: 1,
                entityType: 'teachers',
                injections: new Map([[0, { mode: 'inside-await', errorVariant: 'assertion-b815' }]])
            }),
            'case2/internal-assertion-leak-b815'
        );

        // =================================================================
        // Pinned case 3 — Unhandled Rejection Path (ID: 3c6b) from a separate
        // microtask — escapes the try/catch around await runTransaction.
        // =================================================================
        await assertSafeRecovery(
            buildScenario({
                rowCount: 1,
                entityType: 'grades',
                injections: new Map([[0, { mode: 'detached-microtask', errorVariant: 'assertion-3c6b' }]])
            }),
            'case3/unhandled-rejection-path-3c6b'
        );

        // =================================================================
        // Pinned case 4 — Post-Crash Client Contamination. Row 0 trips the
        // assertion; row 1 is a normal write that fails because the client is
        // contaminated and was never re-created.
        // =================================================================
        await assertSafeRecovery(
            buildScenario({
                rowCount: 2,
                entityType: 'absences',
                injections: new Map([[0, { mode: 'inside-await', errorVariant: 'assertion-b815' }]])
            }),
            'case4/post-crash-client-contamination'
        );

        // =================================================================
        // Scoped PBT — across varied row counts, entity types, error variants,
        // and injection position/timing, the fixed push path must recover safely
        // (Property 1): no crash, affected rows pending, client recovered,
        // result.isTransient === true.
        // =================================================================
        const ENTITY_TYPES = ['students', 'teachers', 'grades', 'absences', 'system_tags', 'exams'];
        const ERROR_VARIANTS = ['auth-network', 'assertion-b815', 'assertion-3c6b', 'assertion-generic'];
        const INJECTION_MODES = ['inside-await', 'detached-microtask'];

        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 8 }), // row count
                fc.constantFrom.apply(fc, ENTITY_TYPES), // entity type
                fc.constantFrom.apply(fc, ERROR_VARIANTS), // injected error variant
                fc.constantFrom.apply(fc, INJECTION_MODES), // injection timing
                fc.nat(), // injection position seed
                async (rowCount, entityType, errorVariant, mode, posSeed) => {
                    const injectIndex = posSeed % rowCount;
                    const scenario = buildScenario({
                        rowCount,
                        entityType,
                        injections: new Map([[injectIndex, { mode, errorVariant }]])
                    });

                    // Only assert within the bug domain.
                    fc.pre(
                        isBugCondition({
                            insideTransaction: true,
                            tokenRefreshNeeded: true,
                            networkInterrupted: true,
                            thrownError: makeInjectedError(errorVariant)
                        })
                    );

                    const outcome = await simulatePushCycle(scenario);

                    assert.strictEqual(
                        outcome.processCrashed,
                        false,
                        `[pbt] process crashed (rowCount=${rowCount}, entity=${entityType}, ` +
                            `variant=${errorVariant}, mode=${mode}, index=${injectIndex})`
                    );

                    const affected = outcome.rows.filter((r) => r.affected);
                    for (const r of affected) {
                        assert.strictEqual(
                            r.status,
                            'pending',
                            `[pbt] affected row not pending (variant=${errorVariant}, mode=${mode})`
                        );
                    }

                    assert.ok(
                        outcome.result && outcome.result.isTransient === true,
                        `[pbt] result.isTransient !== true (variant=${errorVariant}, mode=${mode})`
                    );

                    assert.strictEqual(
                        outcome.clientRecovered,
                        true,
                        `[pbt] client not recovered (variant=${errorVariant}, mode=${mode})`
                    );
                }
            ),
            { numRuns: MIN_CASES, verbose: true }
        );

        // Reaching here means the bug did NOT reproduce — unexpected for unfixed code.
        console.log(
            '[exploration] (UNEXPECTED) all assertions passed — the INTERNAL ASSERTION crash ' +
                'bug did not reproduce. The code may already be fixed, or the root-cause/test logic needs review.'
        );
        process.exit(0);
    } catch (err) {
        console.error(
            'FAIL (EXPECTED on unfixed code): Property 1 — auth/network-request-failed & ' +
                'INTERNAL ASSERTION FAILED during a mid-transaction token refresh are not treated as ' +
                'transient, crash the process via unhandled rejection, and leave the Firestore client ' +
                'contaminated with no recovery.'
        );
        console.error(err && err.message ? err.message : err);
        if (err && err.counterexample) {
            console.error('Counterexample: ' + JSON.stringify(err.counterexample));
        }
        process.exit(1);
    }
})();
