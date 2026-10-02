/**
 * Unit tests for js/algorithms/proctor-v3/constraints/hard-constraints.js
 *
 * Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.7a, 3.8, 3.10, 5.1, 5.4, 5.9
 *
 * Run directly:   node tests/proctor-v3/hard-constraints.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const HC = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'constraints',
    'hard-constraints.js'
));
const {
    isExempt,
    isOnDuty,
    isMEBlocked,
    wouldDoubleBookSession,
    wouldViolateSameDay,
    wouldExceedClassUpper,
    recordGuardOccupancy,
    recordReserveOccupancy,
    clearGuardOccupancy,
    clearReserveOccupancy,
    _internals,
} = HC;

const { createLoadState } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'utils',
    'load-state.js'
));

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok  ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  FAIL  ${name}`);
        console.error(err && err.stack ? err.stack : err);
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

test('canonicalKeyOf trims cin and falls back to __idx_N', () => {
    assert.strictEqual(_internals.canonicalKeyOf({ cin: '  ABC ' }, 0), 'ABC');
    assert.strictEqual(_internals.canonicalKeyOf({ cin: '' }, 3), '__idx_3');
    assert.strictEqual(_internals.canonicalKeyOf({ cin: '   ' }, 7), '__idx_7');
    assert.strictEqual(_internals.canonicalKeyOf({}, 5), '__idx_5');
    assert.strictEqual(_internals.canonicalKeyOf(null, 9), '__idx_9');
});

test('dayKeyFromHalfdayKey splits on the first pipe', () => {
    assert.strictEqual(_internals.dayKeyFromHalfdayKey('2026-06-04|صباحا'), '2026-06-04');
    assert.strictEqual(_internals.dayKeyFromHalfdayKey('2026-06-04|مساء'), '2026-06-04');
    assert.strictEqual(_internals.dayKeyFromHalfdayKey('legacy-key'), 'legacy-key');
    assert.strictEqual(_internals.dayKeyFromHalfdayKey(''), '');
    assert.strictEqual(_internals.dayKeyFromHalfdayKey(null), '');
});

// ---------------------------------------------------------------------------
// isExempt — AC 3.2 (C-EXEMPT)
// ---------------------------------------------------------------------------

test('isExempt returns true when canonical key present under sessionKey', () => {
    const exemptions = { 'S1': { 'ABC': 'no' } };
    const proctor = { cin: 'ABC' };
    assert.strictEqual(isExempt(proctor, 0, 'S1', exemptions), true);
});

test('isExempt returns false when proctor not listed for sessionKey', () => {
    const exemptions = { 'S1': { 'OTHER': 'no' } };
    assert.strictEqual(isExempt({ cin: 'ABC' }, 0, 'S1', exemptions), false);
});

test('isExempt returns false when sessionKey absent from exemptionsData', () => {
    const exemptions = { 'S1': { 'ABC': 'no' } };
    assert.strictEqual(isExempt({ cin: 'ABC' }, 0, 'S2', exemptions), false);
});

test('isExempt uses canonical key (cin trimmed) — not raw cin', () => {
    // exemptionsData is normalized → trimmed CIN keys only.
    const exemptions = { 'S1': { 'ABC': 'no' } };
    // Even if proctor.cin has whitespace, canonicalKeyOf trims.
    assert.strictEqual(isExempt({ cin: ' ABC ' }, 0, 'S1', exemptions), true);
});

test('isExempt uses __idx_N for som-only proctors', () => {
    const exemptions = { 'S1': { '__idx_4': 'no' } };
    assert.strictEqual(isExempt({ som: 'X' }, 4, 'S1', exemptions), true);
    assert.strictEqual(isExempt({ som: 'X' }, 5, 'S1', exemptions), false);
});

test('isExempt presence-based: any value (including false-y) counts', () => {
    const exemptions = { 'S1': { 'ABC': null } };
    assert.strictEqual(isExempt({ cin: 'ABC' }, 0, 'S1', exemptions), true);
});

test('isExempt is defensive against malformed inputs', () => {
    assert.strictEqual(isExempt({ cin: 'A' }, 0, 'S1', null), false);
    assert.strictEqual(isExempt({ cin: 'A' }, 0, 'S1', 'not-an-object'), false);
    assert.strictEqual(isExempt({ cin: 'A' }, 0, 'S1', []), false);
    assert.strictEqual(isExempt({ cin: 'A' }, 0, '', { S1: { A: 'no' } }), false);
    assert.strictEqual(isExempt({ cin: 'A' }, 0, null, { S1: { A: 'no' } }), false);
});

// ---------------------------------------------------------------------------
// isOnDuty — AC 3.3 (C-DUTY)
// ---------------------------------------------------------------------------

test('isOnDuty returns true when canonical key listed under halfday', () => {
    const duty = { '2026-06-04|صباحا': { 'CIN1': true } };
    assert.strictEqual(isOnDuty({ cin: 'CIN1' }, 0, '2026-06-04|صباحا', duty), true);
});

test('isOnDuty returns false when proctor not on duty for that halfday', () => {
    const duty = { '2026-06-04|صباحا': { 'CIN1': true } };
    assert.strictEqual(isOnDuty({ cin: 'CIN2' }, 1, '2026-06-04|صباحا', duty), false);
});

test('isOnDuty isolates halfdays — duty in one halfday does not block another', () => {
    const duty = { '2026-06-04|صباحا': { 'CIN1': true } };
    assert.strictEqual(isOnDuty({ cin: 'CIN1' }, 0, '2026-06-04|مساء', duty), false);
    assert.strictEqual(isOnDuty({ cin: 'CIN1' }, 0, '2026-06-05|صباحا', duty), false);
});

test('isOnDuty is defensive against malformed inputs', () => {
    assert.strictEqual(isOnDuty({ cin: 'A' }, 0, 'h1', null), false);
    assert.strictEqual(isOnDuty({ cin: 'A' }, 0, '', { h1: { A: true } }), false);
    assert.strictEqual(isOnDuty({ cin: 'A' }, 0, 'h1', { h1: 'wrong-shape' }), false);
});

// ---------------------------------------------------------------------------
// isMEBlocked — AC 3.4 (C-ME)
// ---------------------------------------------------------------------------

test('isMEBlocked returns false for proctors not in any ME group', () => {
    const me = { 'g1': { 'OTHER': true } };
    assert.strictEqual(isMEBlocked({ cin: 'ABC' }, 0, 'h1', me), false);
});

test('isMEBlocked returns false when proctor pinned to the requested halfday', () => {
    const me = { 'h1': { 'ABC': true } };
    assert.strictEqual(isMEBlocked({ cin: 'ABC' }, 0, 'h1', me), false);
});

test('isMEBlocked returns true when proctor pinned to a different halfday', () => {
    const me = { 'h1': { 'ABC': true } };
    assert.strictEqual(isMEBlocked({ cin: 'ABC' }, 0, 'h2', me), true);
});

test('isMEBlocked: multi-group membership — any matching group lifts the block', () => {
    const me = {
        'h1': { 'ABC': true },
        'h2': { 'ABC': true },
    };
    assert.strictEqual(isMEBlocked({ cin: 'ABC' }, 0, 'h1', me), false);
    assert.strictEqual(isMEBlocked({ cin: 'ABC' }, 0, 'h2', me), false);
    assert.strictEqual(isMEBlocked({ cin: 'ABC' }, 0, 'h3', me), true);
});

test('isMEBlocked: empty meAssignments → never blocked', () => {
    assert.strictEqual(isMEBlocked({ cin: 'ABC' }, 0, 'h1', {}), false);
    assert.strictEqual(isMEBlocked({ cin: 'ABC' }, 0, 'h1', null), false);
});

// ---------------------------------------------------------------------------
// wouldDoubleBookSession — AC 3.5 + 3.6 (C-NO-DOUBLE)
// ---------------------------------------------------------------------------

test('wouldDoubleBookSession returns false for fresh load state', () => {
    const ls = createLoadState(['A1']);
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', 'session-1'), false);
});

test('wouldDoubleBookSession returns true after recording a guard for that session', () => {
    const ls = createLoadState(['A1']);
    recordGuardOccupancy(ls, 'A1', 'session-1', '2026-06-04|صباحا');
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', 'session-1'), true);
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', 'session-2'), false);
});

test('wouldDoubleBookSession also catches reserve-side duplicates (AC 3.6)', () => {
    // A proctor cannot be guard in room A and reserve in room B of the
    // same session — the same canonical key must not appear twice across
    // the union of guards∪reserves of that session.
    const ls = createLoadState(['A1']);
    recordReserveOccupancy(ls, 'A1', 'session-1', '2026-06-04|صباحا');
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', 'session-1'), true);
});

test('wouldDoubleBookSession returns false when entry has no occupancy sets', () => {
    const ls = createLoadState(['A1']);
    // The bare entry from createLoadState has no Set fields.
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', 'session-1'), false);
});

test('wouldDoubleBookSession returns false for missing key / missing session', () => {
    const ls = createLoadState(['A1']);
    recordGuardOccupancy(ls, 'A1', 'session-1', '2026-06-04|صباحا');
    assert.strictEqual(wouldDoubleBookSession(ls, 'GHOST', 'session-1'), false);
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', ''), false);
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', null), false);
});

test('clearGuardOccupancy un-marks a session and the predicate flips back', () => {
    const ls = createLoadState(['A1']);
    recordGuardOccupancy(ls, 'A1', 'session-1', '2026-06-04|صباحا');
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', 'session-1'), true);
    clearGuardOccupancy(ls, 'A1', 'session-1', '2026-06-04|صباحا');
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', 'session-1'), false);
});

// ---------------------------------------------------------------------------
// wouldViolateSameDay — AC 3.7 + 3.7a + 3.8
// ---------------------------------------------------------------------------

test('wouldViolateSameDay returns false on fresh state regardless of allowSameDay', () => {
    const ls = createLoadState(['A1']);
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', '2026-06-04|صباحا', false), false);
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', '2026-06-04|صباحا', true), false);
});

test('wouldViolateSameDay catches morning→afternoon collision when guards already in AM', () => {
    const ls = createLoadState(['A1']);
    recordGuardOccupancy(ls, 'A1', 'sess-am-1', '2026-06-04|صباحا');
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', '2026-06-04|مساء', false), true);
});

test('wouldViolateSameDay allows same halfday (no cross-halfday violation)', () => {
    // Multiple sessions within the same halfday are allowed (sessions are
    // sequential, not concurrent — see AC 3.10 of the requirements).
    const ls = createLoadState(['A1']);
    recordGuardOccupancy(ls, 'A1', 'sess-am-1', '2026-06-04|صباحا');
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', '2026-06-04|صباحا', false), false);
});

test('wouldViolateSameDay allows different DAYS even when a guard exists', () => {
    const ls = createLoadState(['A1']);
    recordGuardOccupancy(ls, 'A1', 'sess-am-1', '2026-06-04|صباحا');
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', '2026-06-05|صباحا', false), false);
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', '2026-06-05|مساء', false), false);
});

test('wouldViolateSameDay relaxes when allowSameDay === true (AC 3.8)', () => {
    const ls = createLoadState(['A1']);
    recordGuardOccupancy(ls, 'A1', 'sess-am-1', '2026-06-04|صباحا');
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', '2026-06-04|مساء', true), false);
});

test('wouldViolateSameDay considers reserve halfdays too (AC 3.7a)', () => {
    // A reserve role still ties the proctor to the half-day (must be
    // physically present), so reserve-in-AM blocks guard-in-PM under the
    // strict same-day policy.
    const ls = createLoadState(['A1']);
    recordReserveOccupancy(ls, 'A1', 'sess-am-1', '2026-06-04|صباحا');
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', '2026-06-04|مساء', false), true);
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', '2026-06-04|مساء', true), false);
});

test('wouldViolateSameDay handles legacy halfday keys without pipe', () => {
    const ls = createLoadState(['A1']);
    // A "legacy key" with no pipe is treated as its own day; same exact
    // string ⇒ same halfday ⇒ no cross-halfday violation.
    recordGuardOccupancy(ls, 'A1', 'sess-1', 'legacy-key');
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', 'legacy-key', false), false);
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', 'other-legacy', false), false);
});

test('wouldViolateSameDay defensive on malformed inputs', () => {
    const ls = createLoadState(['A1']);
    assert.strictEqual(wouldViolateSameDay(ls, 'A1', '', false), false);
    assert.strictEqual(wouldViolateSameDay(ls, 'GHOST', 'h1', false), false);
    assert.strictEqual(wouldViolateSameDay(null, 'A1', 'h1', false), false);
});

// ---------------------------------------------------------------------------
// wouldExceedClassUpper — AC 3.10 + 5.1 + 5.4 + 5.9
// (CRITICAL: must account for Duty_Count — fairness axis is Primary_Load.)
// ---------------------------------------------------------------------------

test('wouldExceedClassUpper: bare proctor below upper → false', () => {
    const ls = createLoadState(['A1']);
    const classBounds = { c1: { upper: 3, lower: 1 } };
    const cBy = { A1: 'c1' };
    assert.strictEqual(wouldExceedClassUpper(ls, 'A1', classBounds, cBy), false);
});

test('wouldExceedClassUpper: assigning the slot that hits exactly upper → false', () => {
    const ls = createLoadState(['A1']);
    // guardCount currently = 2, dutyCount = 0. Upper = 3.
    // Primary_Load after one more guard = 3, NOT > 3 → not exceeded.
    ls.proctors.A1.guardCount = 2;
    const classBounds = { c1: { upper: 3 } };
    const cBy = { A1: 'c1' };
    assert.strictEqual(wouldExceedClassUpper(ls, 'A1', classBounds, cBy), false);
});

test('wouldExceedClassUpper: assigning past upper → true', () => {
    const ls = createLoadState(['A1']);
    ls.proctors.A1.guardCount = 3; // already at upper
    const classBounds = { c1: { upper: 3 } };
    const cBy = { A1: 'c1' };
    assert.strictEqual(wouldExceedClassUpper(ls, 'A1', classBounds, cBy), true);
});

test('wouldExceedClassUpper accounts for duty_count (CRITICAL — Primary_Load = G + D)', () => {
    // A proctor with 1 duty and 2 guards has Primary_Load = 3. With upper = 3,
    // adding another guard would push Primary_Load to 4 → overflow.
    // V2 missed this case because it only checked guardCount.
    const ls = createLoadState(['A1']);
    ls.proctors.A1.guardCount = 2;
    ls.proctors.A1.dutyCount = 1;
    const classBounds = { c1: { upper: 3 } };
    const cBy = { A1: 'c1' };
    assert.strictEqual(wouldExceedClassUpper(ls, 'A1', classBounds, cBy), true);
});

test('wouldExceedClassUpper: heavily-mandated proctor with no guards still blocks (AC 5.9)', () => {
    // dutyCount alone equals upper. Adding even one guard tips Primary_Load
    // to upper + 1 → must reject (matches "Duty_Count >= upper" rule).
    const ls = createLoadState(['A1']);
    ls.proctors.A1.guardCount = 0;
    ls.proctors.A1.dutyCount = 3;
    const classBounds = { c1: { upper: 3 } };
    const cBy = { A1: 'c1' };
    assert.strictEqual(wouldExceedClassUpper(ls, 'A1', classBounds, cBy), true);
});

test('wouldExceedClassUpper: missing class mapping → defensive false (assignment allowed)', () => {
    const ls = createLoadState(['A1']);
    ls.proctors.A1.guardCount = 5;
    const classBounds = { c1: { upper: 3 } };
    // A1 is not mapped to any class.
    assert.strictEqual(wouldExceedClassUpper(ls, 'A1', classBounds, {}), false);
});

test('wouldExceedClassUpper: missing class bound entry → defensive false', () => {
    const ls = createLoadState(['A1']);
    ls.proctors.A1.guardCount = 5;
    const cBy = { A1: 'c-unknown' };
    assert.strictEqual(wouldExceedClassUpper(ls, 'A1', { c1: { upper: 3 } }, cBy), false);
});

test('wouldExceedClassUpper: non-numeric upper → defensive false', () => {
    const ls = createLoadState(['A1']);
    const cBy = { A1: 'c1' };
    assert.strictEqual(
        wouldExceedClassUpper(ls, 'A1', { c1: { upper: 'three' } }, cBy),
        false
    );
    assert.strictEqual(
        wouldExceedClassUpper(ls, 'A1', { c1: { upper: Infinity } }, cBy),
        false
    );
    assert.strictEqual(
        wouldExceedClassUpper(ls, 'A1', { c1: {} }, cBy),
        false
    );
});

test('wouldExceedClassUpper: missing loadState entry uses zero counts', () => {
    // No entry for A1 in loadState → guardCount=0, dutyCount=0 →
    // Primary_Load after = 1 → not > upper=3 → false.
    const ls = createLoadState([]);
    const classBounds = { c1: { upper: 3 } };
    const cBy = { A1: 'c1' };
    assert.strictEqual(wouldExceedClassUpper(ls, 'A1', classBounds, cBy), false);
});

test('wouldExceedClassUpper: malformed args → defensive false', () => {
    const ls = createLoadState(['A1']);
    assert.strictEqual(wouldExceedClassUpper(ls, 'A1', null, { A1: 'c1' }), false);
    assert.strictEqual(wouldExceedClassUpper(ls, 'A1', { c1: { upper: 3 } }, null), false);
    assert.strictEqual(wouldExceedClassUpper(ls, '', { c1: { upper: 3 } }, { A1: 'c1' }), false);
});

// ---------------------------------------------------------------------------
// Occupancy helpers — basic mechanics + idempotency
// ---------------------------------------------------------------------------

test('recordGuardOccupancy is idempotent — same triple twice is a no-op', () => {
    const ls = createLoadState(['A1']);
    recordGuardOccupancy(ls, 'A1', 'sess-1', '2026-06-04|صباحا');
    recordGuardOccupancy(ls, 'A1', 'sess-1', '2026-06-04|صباحا');
    assert.strictEqual(ls.proctors.A1.guardSessions.size, 1);
    assert.strictEqual(ls.proctors.A1.guardHalfdays.size, 1);
});

test('recordGuardOccupancy lazily creates an entry if missing', () => {
    const ls = createLoadState([]);
    recordGuardOccupancy(ls, 'NEW', 'sess-1', '2026-06-04|صباحا');
    assert.ok(ls.proctors.NEW);
    assert.strictEqual(ls.proctors.NEW.guardCount, 0); // counts NOT auto-bumped
    assert.ok(ls.proctors.NEW.guardSessions.has('sess-1'));
});

test('recordGuardOccupancy skips empty/missing session/halfday inputs', () => {
    const ls = createLoadState(['A1']);
    recordGuardOccupancy(ls, 'A1', '', '');
    assert.ok(!ls.proctors.A1.guardSessions);
    assert.ok(!ls.proctors.A1.guardHalfdays);
    recordGuardOccupancy(ls, 'A1', undefined, undefined);
    assert.ok(!ls.proctors.A1.guardSessions);
});

test('recordReserveOccupancy mirrors guard side on its own sets', () => {
    const ls = createLoadState(['A1']);
    recordReserveOccupancy(ls, 'A1', 'sess-1', '2026-06-04|صباحا');
    assert.ok(ls.proctors.A1.reserveSessions.has('sess-1'));
    assert.ok(ls.proctors.A1.reserveHalfdays.has('2026-06-04|صباحا'));
    // Guard sets are NOT touched by reserve recording.
    assert.ok(!ls.proctors.A1.guardSessions);
    assert.ok(!ls.proctors.A1.guardHalfdays);
});

test('clearGuardOccupancy / clearReserveOccupancy are idempotent on missing entries', () => {
    const ls = createLoadState(['A1']);
    // No throw, no creation.
    clearGuardOccupancy(ls, 'GHOST', 'sess-1', 'h1');
    clearReserveOccupancy(ls, 'GHOST', 'sess-1', 'h1');
    clearGuardOccupancy(ls, 'A1', 'never-recorded', 'never-recorded');
});

test('record helpers throw on malformed loadState (parity with utils/load-state.js)', () => {
    assert.throws(() => recordGuardOccupancy(null, 'A', 's', 'h'), TypeError);
    assert.throws(() => recordGuardOccupancy({}, 'A', 's', 'h'), TypeError);
    assert.throws(() => recordReserveOccupancy({ proctors: null }, 'A', 's', 'h'), TypeError);
    assert.throws(() => recordGuardOccupancy({ proctors: {} }, '', 's', 'h'), TypeError);
});

// ---------------------------------------------------------------------------
// Integration sanity: predicates + helpers compose correctly
// ---------------------------------------------------------------------------

test('predicates compose: all six checks usable in a single feasibility pass', () => {
    // Setup: one proctor (A1), exempt from S2, on duty in halfday H_AM,
    // pinned by ME to H_PM only, currently guarding session "sess-1" at H_AM,
    // class c1 has upper=2 and the proctor already has Primary_Load=2.
    const proctorA1 = { cin: 'A1' };
    const exemptions = { 'S2': { 'A1': 'no' } };
    const duty = { '2026-06-04|صباحا': { 'A1': true } };
    const me = { '2026-06-04|مساء': { 'A1': true } };

    const ls = createLoadState(['A1']);
    ls.proctors.A1.guardCount = 1;
    ls.proctors.A1.dutyCount = 1;
    recordGuardOccupancy(ls, 'A1', 'sess-1', '2026-06-04|صباحا');

    const classBounds = { c1: { upper: 2 } };
    const cBy = { A1: 'c1' };

    // C-EXEMPT
    assert.strictEqual(isExempt(proctorA1, 0, 'S1', exemptions), false);
    assert.strictEqual(isExempt(proctorA1, 0, 'S2', exemptions), true);

    // C-DUTY
    assert.strictEqual(isOnDuty(proctorA1, 0, '2026-06-04|صباحا', duty), true);
    assert.strictEqual(isOnDuty(proctorA1, 0, '2026-06-04|مساء', duty), false);

    // C-ME — pinned to PM, blocked from AM (which is also a duty halfday,
    // separately blocked by isOnDuty).
    assert.strictEqual(isMEBlocked(proctorA1, 0, '2026-06-04|صباحا', me), true);
    assert.strictEqual(isMEBlocked(proctorA1, 0, '2026-06-04|مساء', me), false);

    // C-NO-DOUBLE
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', 'sess-1'), true);
    assert.strictEqual(wouldDoubleBookSession(ls, 'A1', 'sess-2'), false);

    // C-NO-SAME-DAY
    assert.strictEqual(
        wouldViolateSameDay(ls, 'A1', '2026-06-04|مساء', false),
        true
    );
    assert.strictEqual(
        wouldViolateSameDay(ls, 'A1', '2026-06-04|مساء', true),
        false
    );

    // Class upper — Primary_Load = 2, upper = 2, adding 1 → 3 > 2 → true.
    assert.strictEqual(
        wouldExceedClassUpper(ls, 'A1', classBounds, cBy),
        true
    );
});

// ---------------------------------------------------------------------------
// Property-Based Test (Task 27) — fast-check
//
//    **Validates: Requirements 3.5, 14.2**
//
//    Strategy: use fast-check to generate 100+ random GS3_Input_Contract
//    instances via the PBT helpers. Run the V3 orchestrator end-to-end,
//    then verify the universal property:
//
//      AC 3.5: FOR EACH Result_Row R, no Canonical_Proctor_Key appears
//              more than once across `R.proctor_keys ∪ R.reserve_keys`.
//              (This subsumes: no proctor is guard twice in a row, and no
//              proctor is both guard and reserve in the same row.)
//
//    `null` entries in `proctor_keys` (unresolved hard-constraint slots,
//    AC 3.12) are skipped — only resolved canonical keys participate in
//    the at-most-once check.
// ---------------------------------------------------------------------------

const fc = require('fast-check');
const { runOrchestrator } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'orchestrator.js'
));
const { createPRNG } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'utils',
    'prng.js'
));
// Individual PBT helpers imported below in the PBT section.

/**
 * fast-check arbitrary that produces a SMALL valid GS3_Input_Contract
 * (5–10 proctors, 2–3 schedule entries) to keep solver runs fast.
 * Uses the PBT helpers with constrained sizes.
 */
const { arbitraryProctorsList, arbitraryScheduleEntries, arbitraryDutyData, arbitraryExemptions } = require(path.join(__dirname, 'pbt-helpers.js'));
const { _internals: pbtInternals } = require(path.join(__dirname, 'pbt-helpers.js'));

const arbSmallV3Input = fc.integer({ min: 1, max: 2147483647 }).map((seed) => {
    const rng = createPRNG(seed);
    // Small sizes: 5–8 proctors, 2–3 schedule entries, 2 halfdays, 1 room/level
    const nProctors = 5 + rng.nextInt(4);   // 5..8
    const nEntries = 2 + rng.nextInt(2);    // 2..3
    const nHalfdays = 2;

    const proctorsList = arbitraryProctorsList(rng, nProctors);
    const scheduleEntries = arbitraryScheduleEntries(rng, nEntries, nHalfdays);
    const dutyData = arbitraryDutyData(rng, proctorsList, scheduleEntries);
    const exemptionsData = arbitraryExemptions(rng, proctorsList, scheduleEntries);

    const levels = pbtInternals.collectLevels(scheduleEntries);
    const examCenterLevels = {};
    const examCenterRoomsData = {};
    for (let i = 0; i < levels.length; i += 1) {
        const lvl = levels[i];
        const roomCount = 1; // 1 room per level to keep solver fast
        examCenterLevels[lvl] = { rooms: roomCount, sessions: 1 };
        const rooms = [];
        for (let r = 0; r < roomCount; r += 1) {
            rooms.push({
                key: lvl + '_R' + (r + 1),
                room_num: String(r + 1),
                roomName: 'Salle ' + lvl + '-' + (r + 1),
            });
        }
        examCenterRoomsData[lvl] = rooms;
    }

    return {
        proctorsList,
        scheduleEntries,
        dutyData,
        exemptionsData,
        meAssignments: {},
        examDistributionRules: {
            proctorsPerRoom: 2,
            allowSameDayBothHalfdays: false,
        },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels,
        examCenterRoomsData,
        randomSeed: seed,
    };
});

test('property (fast-check): no canonical key appears twice in the same row — AC 3.5', () => {
    // **Validates: Requirements 3.5, 14.2**
    let rowsExercisingTheCheck = 0;

    fc.assert(
        fc.property(arbSmallV3Input, (input) => {
            const runResult = runOrchestrator(input, { totalBudgetMs: 2000, phase4TimeBudgetMs: 500 });

            // Envelope sanity
            if (!runResult || typeof runResult !== 'object') return false;
            if (!Array.isArray(runResult.result)) return false;

            const result = runResult.result;

            for (let r = 0; r < result.length; r += 1) {
                const row = result[r];
                if (!row || typeof row !== 'object') continue;

                const pkeys = Array.isArray(row.proctor_keys) ? row.proctor_keys : [];
                const rkeys = Array.isArray(row.reserve_keys) ? row.reserve_keys : [];
                const union = pkeys.concat(rkeys);

                const seen = Object.create(null);
                let resolvedCount = 0;
                for (let i = 0; i < union.length; i += 1) {
                    const k = union[i];
                    if (k === null || k === undefined) continue;
                    if (typeof k !== 'string') return false;
                    resolvedCount += 1;
                    if (seen[k]) {
                        // AC 3.5 violation: duplicate canonical key in same row
                        return false;
                    }
                    seen[k] = true;
                }
                if (resolvedCount >= 2) rowsExercisingTheCheck += 1;
            }

            return true;
        }),
        { numRuns: 100, verbose: true }
    );

    // Guard against vacuous pass: at least some rows across the random
    // inputs must have carried ≥ 2 resolved keys.
    assert.ok(
        rowsExercisingTheCheck > 0,
        'Expected at least one row across the random inputs to carry two or '
            + 'more resolved keys (otherwise the at-most-once check passes vacuously)'
    );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
