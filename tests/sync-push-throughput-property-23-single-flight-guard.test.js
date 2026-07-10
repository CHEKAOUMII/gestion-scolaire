'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 6.6 — Property 23: Single-flight guard
//
// **Validates: Requirements 9.5**
//
// Exercises the REAL exported `flushSyncOutbox` from main/sync/engine.js and its
// module-level `_flushRunning` single-flight guard. The engine's external seams are
// stubbed by injecting mock modules into the require cache BEFORE requiring the engine
// (the same technique used by other engine tests to avoid Electron/Firebase wiring):
//
//   ../db/context      -> getDb() returns a tiny in-memory sync_config/outbox stub
//   ./credentials      -> getCredentials() is a CONTROLLABLE gate we hold open, parking
//                         the in-flight cycle inside the guarded body with _flushRunning
//                         true until we release it
//   ../firebase/config -> getFirestoreDb() returns an inert handle
//   ../auth/permissions + ../ipc/auth -> resolve a single 'admin' session role so the
//                         cycle proceeds to the (parked) credentials await
//
// With one cycle parked inside the body, the property fires N additional overlapping
// `flushSyncOutbox()` calls and asserts EVERY one returns the already-running skip and
// that the guarded body was entered exactly once (getCredentials called once) — i.e.
// no double-processing. Releasing the gate lets the first cycle complete, after which
// the guard is clear and a fresh cycle may enter again.
//
// Seam note: `flushSyncOutbox` reaches its first await at `await getCredentials()`
// (every step before it — config read, reopen/compact, role resolution — is
// synchronous). Holding getCredentials open is therefore the faithful way to keep a
// single cycle resident in the guarded region while overlapping calls race the guard.
//
// Feature: sync-push-throughput-optimization, Property 23: For any number of
// overlapping flushSyncOutbox invocations, at most one push cycle body executes at a
// time; the remaining invocations return immediately as skipped.

const assert = require('assert');
const fc = require('fast-check');
const path = require('path');

// ---------------------------------------------------------------------------
// Controllable credentials gate (shared with the injected ./credentials mock).
// ---------------------------------------------------------------------------
let credState = null;
function newCredGate() {
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    credState = { calls: 0, gate, release };
    return credState;
}
newCredGate();

// ---------------------------------------------------------------------------
// Tiny in-memory DB stub — handles exactly the statements flushSyncOutbox issues.
// ---------------------------------------------------------------------------
const fakeDb = {
    prepare(sqlRaw) {
        const sql = String(sqlRaw).replace(/\s+/g, ' ').trim();
        return {
            get: () => {
                if (sql.includes('FROM sync_config')) {
                    return { id: 1, enabled: 1, max_retries: 10, school_id: 'SCHOOL1', sync_interval_minutes: 5 };
                }
                if (sql.includes('COUNT(*)')) return { c: 0 };
                return {};
            },
            all: () => [],
            run: () => ({ changes: 0 })
        };
    }
};

// ---------------------------------------------------------------------------
// Inject mock modules into the require cache before requiring the engine.
// ---------------------------------------------------------------------------
function setCache(absPath, exports) {
    const resolved = require.resolve(absPath);
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports,
        children: [],
        paths: []
    };
    return resolved;
}

const MAIN = path.resolve(__dirname, '../main');

setCache(path.join(MAIN, 'db/context.js'), {
    setDb() {},
    getDb: () => fakeDb,
    getDbPath: () => ''
});

setCache(path.join(MAIN, 'sync/credentials.js'), {
    getCredentials: async () => {
        credState.calls += 1;
        await credState.gate;
        return { schoolId: 'SCHOOL1' };
    },
    clearCredentials: () => {},
    isAuthenticated: () => true,
    testConnection: async () => ({ success: true }),
    restoreFirebaseSession: async () => {},
    persistCredential: () => {},
    clearStoredCredential: () => {},
    resolveSyncSchoolId: (config, credentials) =>
        cleanSyncSchoolId(credentials?.schoolId) || cleanSyncSchoolId(config?.school_id) || null
});

// resolveSyncSchoolId helper used by the credentials mock above — mirrors the
// pure cleaner in main/sync/credentials.js (NULL-safe upper-trim of the school
// id sources).
function cleanSyncSchoolId(value) {
    return String(value || '').trim().toUpperCase() || null;
}

setCache(path.join(MAIN, 'firebase/config.js'), {
    getFirestoreDb: () => ({ __inert: true }),
    initFirebase: () => ({ app: null, db: null, auth: null }),
    getFirebaseConfig: () => ({}),
    readSchoolId: () => 'SCHOOL1',
    isInvalidCredentialError: () => false,
    readSyncConfig: () => ({})
});

setCache(path.join(MAIN, 'auth/permissions.js'), {
    resolveRole: (r) => r
});

setCache(path.join(MAIN, 'ipc/auth.js'), {
    getActiveSessions: () => new Map([['s1', { role: 'admin' }]])
});

// Now require the engine — it captures the mocks above.
const engine = require('../main/sync/engine');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const ALREADY_RUNNING = { success: true, skipped: true, reason: 'already_running' };

console.log('[pbt] sync-push-throughput Property 23: single-flight guard');

let checks = 0;

(async () => {
    await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 25 }), async (overlap) => {
            newCredGate();

            // Start one cycle; it runs synchronously up to `await getCredentials()` and
            // parks there with _flushRunning === true.
            const inFlight = engine.flushSyncOutbox();
            await tick();

            // The guarded body was entered exactly once so far.
            assert.strictEqual(credState.calls, 1, 'exactly one cycle should have entered the body');

            // Fire N overlapping invocations while the first is parked. Every one must be
            // turned away by the single-flight guard.
            const overlapping = await Promise.all(
                Array.from({ length: overlap }, () => engine.flushSyncOutbox())
            );
            for (const r of overlapping) {
                assert.deepStrictEqual(r, ALREADY_RUNNING, 'overlapping invocation must return the already_running skip');
            }

            // No double-processing: the body was still entered exactly once.
            assert.strictEqual(credState.calls, 1, 'overlapping invocations must NOT enter the guarded body');

            // Release the gate; the in-flight cycle completes and clears the guard.
            credState.release();
            const firstResult = await inFlight;
            assert.notStrictEqual(firstResult.skipped, true, 'the in-flight cycle actually executed (not skipped)');

            // Guard is now clear: a fresh, non-overlapping cycle may enter the body again.
            const afterCalls = credState.calls;
            const fresh = await engine.flushSyncOutbox();
            assert.notStrictEqual(fresh.skipped, true, 'a cycle after completion must run, not be skipped');
            assert.strictEqual(credState.calls, afterCalls + 1, 'the post-completion cycle re-entered the body once');

            checks += 1;
            return true;
        }),
        { numRuns: 120 }
    );

    // -----------------------------------------------------------------------
    // Targeted anchor: the classic two-call race.
    // -----------------------------------------------------------------------
    {
        newCredGate();
        const p1 = engine.flushSyncOutbox();
        await tick();
        assert.strictEqual(credState.calls, 1);
        const p2 = await engine.flushSyncOutbox();
        assert.deepStrictEqual(p2, ALREADY_RUNNING, 'second concurrent call returns already_running');
        assert.strictEqual(credState.calls, 1, 'second call did not enter the body');
        credState.release();
        const r1 = await p1;
        assert.notStrictEqual(r1.skipped, true, 'first call executed');
    }

    console.log(`[pass] Property 23 held across ${checks} generated overlap counts + anchor`);
})().catch((err) => {
    console.error('[fail] Property 23', err && err.stack ? err.stack : err);
    process.exit(1);
});
