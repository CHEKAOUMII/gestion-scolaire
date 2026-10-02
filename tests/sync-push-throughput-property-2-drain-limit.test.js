'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 1.3 — Property 2: Backlog drain-limit resolution
//
// **Validates: Requirements 6.1, 6.2, 6.4**
//
// Exercises the REAL exported `resolvePushTuning` + `resolveDrainLimit` from
// main/sync/engine.js across the full input space and asserts the documented
// drain-limit rules hold for every (config, pendingCount) pair.
//
// Feature: sync-push-throughput-optimization, Property 2: For any sync_config
// and pending count, the effective drain limit equals min(backlogBatchSize,
// 5000) when pendingCount > push_batch_size, and equals push_batch_size
// otherwise; an absent / non-numeric / < push_batch_size push_backlog_batch_size
// resolves to the default 1000 before clamping.

const assert = require('assert');
const fc = require('fast-check');

const { resolvePushTuning, resolveDrainLimit } = require('../main/sync/engine');

const MIN_RUNS = 300;
const MAX_BACKLOG = 5000;
const DEFAULT_BACKLOG = 1000;
const DEFAULT_BATCH = 100;

// ---------------------------------------------------------------------------
// Independent reference resolvers mirroring the DOCUMENTED rules (design.md
// "Effective drain limit" + Requirements 6.1/6.2/6.4). Derived from the spec,
// not copied from the implementation under test.
// ---------------------------------------------------------------------------

function refParseNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t === '') return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

// Existing steady-state batch size: falsy/invalid/<1 -> default 100.
function refPushBatchSize(cfg) {
    const p = refParseNumber(cfg.push_batch_size);
    if (p == null || p < 1) return DEFAULT_BATCH;
    return Math.floor(p);
}

// push_backlog_batch_size: absent / non-numeric / < push_batch_size -> 1000,
// then clamp to <= 5000 (Req 6.1, 6.2).
function refBacklogBatchSize(cfg, pushBatchSize) {
    let bbs = refParseNumber(cfg.push_backlog_batch_size);
    if (bbs == null || bbs < pushBatchSize) {
        bbs = DEFAULT_BACKLOG;
    }
    return Math.min(Math.floor(bbs), MAX_BACKLOG);
}

// ---------------------------------------------------------------------------
// Generators: config values span absent / valid / huge / sub-batch / junk, and
// the pending count spans below, at, and above the batch size.
// ---------------------------------------------------------------------------

const numericLike = fc.oneof(
    fc.integer({ min: 1, max: 100 }), // small (often < backlog default)
    fc.integer({ min: 100, max: 6000 }), // around / above the 5000 clamp
    fc.integer({ min: -50, max: 0 }), // <= 0 -> invalid for batch size
    fc.integer({ min: -50, max: 6000 }).map((n) => String(n)), // numeric strings
    fc.constantFrom('abc', '', '  ', null, NaN, undefined)
);

function configArb() {
    return fc.record(
        {
            push_batch_size: fc.option(numericLike, { nil: undefined }),
            push_backlog_batch_size: fc.option(numericLike, { nil: undefined })
        },
        { requiredKeys: [] }
    );
}

console.log('[pbt] sync-push-throughput Property 2: backlog drain-limit resolution');

let checks = 0;

fc.assert(
    fc.property(configArb(), fc.integer({ min: 0, max: 60000 }), (cfg, pendingCount) => {
        const tuning = resolvePushTuning(cfg);
        const limit = resolveDrainLimit(cfg, pendingCount, tuning);

        const pbs = refPushBatchSize(cfg);
        const bbs = refBacklogBatchSize(cfg, pbs);

        // tuning's resolved values must match the documented reference.
        assert.strictEqual(tuning.pushBatchSize, pbs, 'resolved push_batch_size mismatch');
        assert.strictEqual(tuning.backlogBatchSize, bbs, 'resolved backlog batch size mismatch');

        const isBacklog = pendingCount > pbs;
        const expected = isBacklog ? Math.min(bbs, MAX_BACKLOG) : pbs;

        assert.strictEqual(
            limit,
            expected,
            `drain limit mismatch (pending=${pendingCount}, pbs=${pbs}, bbs=${bbs}, backlog=${isBacklog})`
        );

        // The 5000 ceiling applies to the BACKLOG branch only (Req 6.1). The
        // steady-state branch returns push_batch_size verbatim (Req 6.4), which
        // carries no documented upper cap, so the bound is asserted only when a
        // backlog exists.
        if (isBacklog) {
            assert.ok(limit <= MAX_BACKLOG, 'backlog drain limit must never exceed 5000');
        }
        assert.ok(limit >= 1, 'drain limit must be >= 1');

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// Targeted anchors (Req 6.1, 6.2, 6.4).
{
    const t = resolvePushTuning({ push_batch_size: 100, push_backlog_batch_size: 1000 });

    // steady-state: pending at or below batch size -> push_batch_size.
    assert.strictEqual(resolveDrainLimit({}, 100, t), 100, 'pending == batch -> steady push_batch_size');
    assert.strictEqual(resolveDrainLimit({}, 50, t), 100, 'pending < batch -> steady push_batch_size');

    // backlog: pending above batch size -> min(backlogBatchSize, 5000).
    assert.strictEqual(resolveDrainLimit({}, 101, t), 1000, 'pending > batch -> backlog limit 1000');

    // absent backlog key -> default 1000.
    const tAbsent = resolvePushTuning({ push_batch_size: 100 });
    assert.strictEqual(resolveDrainLimit({}, 5000, tAbsent), DEFAULT_BACKLOG, 'absent backlog -> default 1000');

    // backlog below batch size -> default 1000.
    const tBelow = resolvePushTuning({ push_batch_size: 200, push_backlog_batch_size: 50 });
    assert.strictEqual(resolveDrainLimit({}, 99999, tBelow), DEFAULT_BACKLOG, 'backlog < batch -> default 1000');

    // huge backlog clamps to 5000.
    const tHuge = resolvePushTuning({ push_batch_size: 100, push_backlog_batch_size: 999999 });
    assert.strictEqual(resolveDrainLimit({}, 99999, tHuge), MAX_BACKLOG, 'huge backlog clamps to 5000');
}

console.log(`[pass] Property 2 held across ${checks} generated (config, pending) pairs + anchors`);
