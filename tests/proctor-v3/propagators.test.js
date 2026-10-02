/**
 * Unit tests for js/algorithms/proctor-v3/solver/propagators.js
 *
 * Validates: Requirements 3.5, 3.6, 5.6 (AC-3 propagators for the V3 CP
 * solver). Three propagators under test:
 *   - propagateAllDifferent — singleton propagation, cascades, conflicts.
 *   - propagateUpperBound   — class-upper-bound pruning via Primary_Load.
 *   - propagateAC3          — generic driver running both kinds to fixpoint.
 *
 * Run directly:   node tests/proctor-v3/propagators.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const { Domain } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'solver',
    'domain.js'
));

const {
    propagateAllDifferent,
    propagateUpperBound,
    propagateAC3
} = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'solver',
    'propagators.js'
));

const {
    createLoadState,
    addGuardLoad,
    addDutyLoad
} = require(path.join(
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

/**
 * Build a Map<string, Domain> from a plain { varId: [values] } shape.
 */
function makeDomains(spec) {
    const m = new Map();
    Object.keys(spec).forEach((id) => {
        m.set(id, new Domain(spec[id]));
    });
    return m;
}

/**
 * Snapshot a domains Map into a plain { varId: sortedValues[] } object for
 * straightforward deep-equal assertions.
 */
function snapshot(domains) {
    const out = {};
    if (domains instanceof Map) {
        for (const [id, d] of domains) {
            out[id] = d.toArray();
        }
    } else {
        Object.keys(domains).sort().forEach((id) => {
            out[id] = domains[id].toArray();
        });
    }
    return out;
}

// ===========================================================================
// propagateAllDifferent
// ===========================================================================

test('AllDifferent: empty varGroup returns ok with changed=false', () => {
    const domains = makeDomains({ a: ['x', 'y'] });
    const r = propagateAllDifferent(domains, []);
    assert.deepStrictEqual(r, { ok: true, changed: false });
    assert.deepStrictEqual(snapshot(domains), { a: ['x', 'y'] });
});

test('AllDifferent: single variable in group is a no-op', () => {
    const domains = makeDomains({ a: ['x', 'y'] });
    const r = propagateAllDifferent(domains, ['a']);
    assert.deepStrictEqual(r, { ok: true, changed: false });
    assert.deepStrictEqual(snapshot(domains), { a: ['x', 'y'] });
});

test('AllDifferent: no singletons → no change', () => {
    const domains = makeDomains({
        a: ['x', 'y'],
        b: ['x', 'y'],
        c: ['x', 'y', 'z']
    });
    const r = propagateAllDifferent(domains, ['a', 'b', 'c']);
    assert.deepStrictEqual(r, { ok: true, changed: false });
    assert.deepStrictEqual(snapshot(domains), {
        a: ['x', 'y'],
        b: ['x', 'y'],
        c: ['x', 'y', 'z']
    });
});

test('AllDifferent: singleton triggers removal from peers', () => {
    // Initial: a={x} (singleton), b={x,y}, c={x,y,z}.
    // a's value x must be removed from b and c.
    const domains = makeDomains({
        a: ['x'],
        b: ['x', 'y'],
        c: ['x', 'y', 'z']
    });
    const r = propagateAllDifferent(domains, ['a', 'b', 'c']);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    // After cascade: b={y} (singleton), then c loses y → c={z}.
    assert.deepStrictEqual(snapshot(domains), {
        a: ['x'],
        b: ['y'],
        c: ['z']
    });
});

test('AllDifferent: singleton removes value but does not force further singletons when domains are wide', () => {
    const domains = makeDomains({
        a: ['x'],
        b: ['x', 'y', 'z'],
        c: ['x', 'y', 'z', 'w']
    });
    const r = propagateAllDifferent(domains, ['a', 'b', 'c']);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    // a's x propagated to b and c; nothing else triggered.
    assert.deepStrictEqual(snapshot(domains), {
        a: ['x'],
        b: ['y', 'z'],
        c: ['w', 'y', 'z']
    });
});

test('AllDifferent: cascade — singleton creates new singleton creates more removals', () => {
    // Initial: a={x}, b={x,y}, c={x,y,z}, d={x,y,z,w}
    // Round 1: a singleton x → remove x from b,c,d
    //   b={y}    (new singleton)
    //   c={y,z}
    //   d={y,z,w}
    // Round 2: b singleton y → remove y from a (already singleton x, skip), c, d
    //   c={z}    (new singleton)
    //   d={z,w}
    // Round 3: c singleton z → remove z from d
    //   d={w}    (new singleton)
    const domains = makeDomains({
        a: ['x'],
        b: ['x', 'y'],
        c: ['x', 'y', 'z'],
        d: ['x', 'y', 'z', 'w']
    });
    const r = propagateAllDifferent(domains, ['a', 'b', 'c', 'd']);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(snapshot(domains), {
        a: ['x'],
        b: ['y'],
        c: ['z'],
        d: ['w']
    });
});

test('AllDifferent: two singletons with same value → conflict', () => {
    const domains = makeDomains({
        a: ['x'],
        b: ['x'],
        c: ['x', 'y']
    });
    const r = propagateAllDifferent(domains, ['a', 'b', 'c']);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.conflict.type, 'all_different_collision');
    assert.strictEqual(r.conflict.value, 'x');
    assert.deepStrictEqual(r.conflict.varIds.sort(), ['a', 'b']);
});

test('AllDifferent: cascade producing collision → conflict', () => {
    // a={x}, b={x,y}, c={y}.
    // Round 1: a singleton x → remove x from b → b={y}.
    //   b is now singleton with value y; c is also singleton with value y.
    //   The propagator must detect this collision.
    const domains = makeDomains({
        a: ['x'],
        b: ['x', 'y'],
        c: ['y']
    });
    const r = propagateAllDifferent(domains, ['a', 'b', 'c']);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.conflict.type, 'all_different_collision');
    assert.strictEqual(r.conflict.value, 'y');
});

test('AllDifferent: domain wipeout → conflict', () => {
    // a={x}, b={x}. Round 1 wipes b.
    const domains = makeDomains({
        a: ['x'],
        b: ['x']
    });
    const r = propagateAllDifferent(domains, ['a', 'b']);
    assert.strictEqual(r.ok, false);
    // Either 'all_different_collision' (caught at seed time) or
    // 'domain_wipeout' (caught after removal). Both seed-time singletons
    // → seed-time collision.
    assert.ok(
        r.conflict.type === 'all_different_collision'
        || r.conflict.type === 'domain_wipeout',
        'expected collision or wipeout, got ' + r.conflict.type
    );
});

test('AllDifferent: pre-existing empty domain → conflict', () => {
    const domains = makeDomains({ a: [], b: ['x'] });
    const r = propagateAllDifferent(domains, ['a', 'b']);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.conflict.type, 'domain_wipeout');
    assert.strictEqual(r.conflict.varId, 'a');
});

test('AllDifferent: unknown var IDs in group are ignored', () => {
    const domains = makeDomains({ a: ['x', 'y'] });
    const r = propagateAllDifferent(domains, ['a', 'missing']);
    assert.deepStrictEqual(r, { ok: true, changed: false });
});

test('AllDifferent: works with plain-object domains shape', () => {
    const domains = {
        a: new Domain(['x']),
        b: new Domain(['x', 'y']),
        c: new Domain(['x', 'y', 'z'])
    };
    const r = propagateAllDifferent(domains, ['a', 'b', 'c']);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(domains.b.toArray(), ['y']);
    assert.deepStrictEqual(domains.c.toArray(), ['z']);
});

// ===========================================================================
// propagateUpperBound
// ===========================================================================

test('UpperBound: empty varGroup returns ok with changed=false', () => {
    const domains = makeDomains({ a: ['k1', 'k2'] });
    const loadState = createLoadState(['k1', 'k2']);
    const r = propagateUpperBound(domains, [], {}, loadState, {});
    assert.deepStrictEqual(r, { ok: true, changed: false });
});

test('UpperBound: removes value whose class is at upper bound', () => {
    const loadState = createLoadState(['k1', 'k2']);
    // k1 already has 2 guards in class C1 with upper=2 → must be removed.
    addGuardLoad(loadState, 'k1', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(loadState, 'k1', 'h2', 'd1', 's2', 'مساء');

    const domains = makeDomains({ a: ['k1', 'k2'], b: ['k1', 'k2'] });
    const classBounds = {
        C1: { upper: 2 },
        C2: { upper: 5 }
    };
    const classByProctorKey = { k1: 'C1', k2: 'C2' };

    const r = propagateUpperBound(
        domains,
        ['a', 'b'],
        classBounds,
        loadState,
        { classByProctorKey: classByProctorKey }
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(snapshot(domains), {
        a: ['k2'],
        b: ['k2']
    });
});

test('UpperBound: leaves values with room untouched', () => {
    const loadState = createLoadState(['k1', 'k2']);
    addGuardLoad(loadState, 'k1', 'h1', 'd1', 's1', 'صباحا');
    // k1 has guardCount=1, primaryLoad=1; upper=3 → room left.

    const domains = makeDomains({ a: ['k1', 'k2'] });
    const classBounds = { C: { upper: 3 } };
    const classByProctorKey = { k1: 'C', k2: 'C' };

    const r = propagateUpperBound(
        domains,
        ['a'],
        classBounds,
        loadState,
        { classByProctorKey: classByProctorKey }
    );
    assert.deepStrictEqual(r, { ok: true, changed: false });
    assert.deepStrictEqual(snapshot(domains), { a: ['k1', 'k2'] });
});

test('UpperBound: counts duty into Primary_Load', () => {
    const loadState = createLoadState(['k1']);
    // k1: guard=1, duty=2 → primaryLoad=3. Upper=3 → must be removed.
    addGuardLoad(loadState, 'k1', 'h1', 'd1', 's1', 'صباحا');
    addDutyLoad(loadState, 'k1', 'h2');
    addDutyLoad(loadState, 'k1', 'h3');

    const domains = makeDomains({ a: ['k1', 'k2'] });
    const classBounds = { C: { upper: 3 } };
    const classByProctorKey = { k1: 'C', k2: 'C' };

    const r = propagateUpperBound(
        domains,
        ['a'],
        classBounds,
        loadState,
        { classByProctorKey: classByProctorKey }
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(snapshot(domains), { a: ['k2'] });
});

test('UpperBound: conflict when all values pruned', () => {
    const loadState = createLoadState(['k1', 'k2']);
    // Both k1 and k2 are at their class upper bound.
    addGuardLoad(loadState, 'k1', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(loadState, 'k2', 'h1', 'd1', 's1', 'صباحا');

    const domains = makeDomains({ a: ['k1', 'k2'] });
    const classBounds = { C: { upper: 1 } };
    const classByProctorKey = { k1: 'C', k2: 'C' };

    const r = propagateUpperBound(
        domains,
        ['a'],
        classBounds,
        loadState,
        { classByProctorKey: classByProctorKey }
    );
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.conflict.type, 'domain_wipeout');
    assert.strictEqual(r.conflict.varId, 'a');
});

test('UpperBound: missing classByProctorKey entry → value left alone', () => {
    const loadState = createLoadState(['k1']);
    addGuardLoad(loadState, 'k1', 'h1', 'd1', 's1', 'صباحا');

    const domains = makeDomains({ a: ['k1', 'k2'] });
    const classBounds = { C: { upper: 1 } };
    // k1 has class entry; k2 does not — propagator must skip k2 cleanly.
    const classByProctorKey = { k1: 'C' };

    const r = propagateUpperBound(
        domains,
        ['a'],
        classBounds,
        loadState,
        { classByProctorKey: classByProctorKey }
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(snapshot(domains), { a: ['k2'] });
});

test('UpperBound: missing classBounds entry → value left alone', () => {
    const loadState = createLoadState(['k1']);
    addGuardLoad(loadState, 'k1', 'h1', 'd1', 's1', 'صباحا');

    const domains = makeDomains({ a: ['k1'] });
    const classBounds = {}; // no bounds anywhere
    const classByProctorKey = { k1: 'C' };

    const r = propagateUpperBound(
        domains,
        ['a'],
        classBounds,
        loadState,
        { classByProctorKey: classByProctorKey }
    );
    assert.deepStrictEqual(r, { ok: true, changed: false });
    assert.deepStrictEqual(snapshot(domains), { a: ['k1'] });
});

// ===========================================================================
// propagateAC3 driver
// ===========================================================================

test('AC3: empty constraint list is a no-op', () => {
    const domains = makeDomains({ a: ['x', 'y'] });
    const r = propagateAC3(domains, []);
    assert.deepStrictEqual(r, { ok: true, changed: false });
    assert.deepStrictEqual(snapshot(domains), { a: ['x', 'y'] });
});

test('AC3: runs AllDifferent to fixpoint', () => {
    const domains = makeDomains({
        a: ['x'],
        b: ['x', 'y'],
        c: ['x', 'y', 'z']
    });
    const r = propagateAC3(domains, [
        { type: 'allDifferent', varGroup: ['a', 'b', 'c'] }
    ]);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(snapshot(domains), {
        a: ['x'],
        b: ['y'],
        c: ['z']
    });
});

test('AC3: composes AllDifferent and UpperBound to fixpoint', () => {
    // Two-row scenario:
    //   row1 has slots r1s1, r1s2.
    //   row2 has slots r2s1, r2s2.
    //   AllDifferent within each row (no double-booking same row).
    //   UpperBound: class C1 has upper=1 — so k1 can be assigned at most
    //                once across the whole problem.
    //   We force k1 onto r1s1 by giving it a singleton, then AC3 must
    //   1) propagate AllDifferent in row1 → r1s2 loses k1
    //   2) propagate UpperBound (loadState shows k1 at upper) → r2s1, r2s2
    //      lose k1 too
    const loadState = createLoadState(['k1', 'k2', 'k3']);
    // Pre-populate k1 to its upper to simulate an already-committed
    // assignment elsewhere.
    addGuardLoad(loadState, 'k1', 'h1', 'd1', 's1', 'صباحا');

    const domains = makeDomains({
        r1s1: ['k1', 'k2', 'k3'],
        r1s2: ['k1', 'k2', 'k3'],
        r2s1: ['k1', 'k2', 'k3'],
        r2s2: ['k1', 'k2', 'k3']
    });
    const classBounds = {
        C1: { upper: 1 },
        C2: { upper: 5 },
        C3: { upper: 5 }
    };
    const classByProctorKey = { k1: 'C1', k2: 'C2', k3: 'C3' };

    const r = propagateAC3(domains, [
        { type: 'allDifferent', varGroup: ['r1s1', 'r1s2'] },
        { type: 'allDifferent', varGroup: ['r2s1', 'r2s2'] },
        {
            type: 'upperBound',
            varGroup: ['r1s1', 'r1s2', 'r2s1', 'r2s2'],
            classBounds: classBounds,
            loadState: loadState,
            classByProctorKey: classByProctorKey
        }
    ]);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(snapshot(domains), {
        r1s1: ['k2', 'k3'],
        r1s2: ['k2', 'k3'],
        r2s1: ['k2', 'k3'],
        r2s2: ['k2', 'k3']
    });
});

test('AC3: returns conflict early when a constraint fails', () => {
    const domains = makeDomains({
        a: ['x'],
        b: ['x']
    });
    const r = propagateAC3(domains, [
        { type: 'allDifferent', varGroup: ['a', 'b'] }
    ]);
    assert.strictEqual(r.ok, false);
    assert.ok(r.conflict, 'expected a conflict description');
});

test('AC3: terminates on a satisfied constraint set (no infinite loop)', () => {
    const domains = makeDomains({
        a: ['x', 'y'],
        b: ['y', 'z'],
        c: ['x', 'z']
    });
    const r = propagateAC3(domains, [
        { type: 'allDifferent', varGroup: ['a', 'b', 'c'] }
    ]);
    assert.deepStrictEqual(r, { ok: true, changed: false });
    assert.deepStrictEqual(snapshot(domains), {
        a: ['x', 'y'],
        b: ['y', 'z'],
        c: ['x', 'z']
    });
});

test('AC3: supports custom revise callback', () => {
    const domains = makeDomains({ a: ['x', 'y', 'z'] });
    let calls = 0;
    // Custom constraint: removes 'y' on first call, no-op afterwards.
    const customConstraint = {
        type: 'custom',
        varGroup: ['a'],
        revise: function (doms) {
            calls += 1;
            const d = doms.get('a');
            const before = d.size();
            d.remove('y');
            const after = d.size();
            return { ok: true, changed: after !== before };
        }
    };
    const r = propagateAC3(domains, [customConstraint]);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    assert.deepStrictEqual(snapshot(domains), { a: ['x', 'z'] });
    // Driver invokes the constraint at least once (changed) and one
    // settling round (no change). Must NOT loop forever.
    assert.ok(calls >= 1 && calls < 50, 'expected bounded number of calls, got ' + calls);
});

test('AC3: skips unknown constraint types without revise callback', () => {
    const domains = makeDomains({ a: ['x', 'y'] });
    const r = propagateAC3(domains, [
        { type: 'mystery', varGroup: ['a'] }
    ]);
    assert.deepStrictEqual(r, { ok: true, changed: false });
});

test('AC3: detects pre-existing empty Domain', () => {
    const domains = makeDomains({ a: [], b: ['x'] });
    const r = propagateAC3(domains, [
        { type: 'allDifferent', varGroup: ['a', 'b'] }
    ]);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.conflict.type, 'domain_wipeout');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
