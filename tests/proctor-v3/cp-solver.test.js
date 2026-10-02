/**
 * Unit tests for js/algorithms/proctor-v3/solver/cp-solver.js
 *
 * Validates: Requirement 12.6 (CP solver returns assignments / partial /
 * timedOut, supports cost-function-driven anytime optimisation, and is
 * deterministic on identical models when no costFn is supplied).
 *
 * Run directly:   node tests/proctor-v3/cp-solver.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const { solve } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'solver',
    'cp-solver.js'
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
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a model where `vars` form a single AllDifferent group, each with
 * the same domain `values`.
 */
function buildAllDifferentModel(vars, values, opts) {
    const initialDomains = {};
    for (let i = 0; i < vars.length; i += 1) {
        initialDomains[vars[i]] = values.slice();
    }
    const model = {
        variables: vars.slice(),
        initialDomains: initialDomains,
        constraints: [
            { type: 'allDifferent', varGroup: vars.slice() }
        ]
    };
    if (opts && opts.costFn) model.costFn = opts.costFn;
    return model;
}

/**
 * Verify all values in an AllDifferent assignment are distinct and lie in
 * the variable's allowed domain.
 */
function assertAllDifferentValid(model, assignments) {
    const vals = [];
    for (let i = 0; i < model.variables.length; i += 1) {
        const id = model.variables[i];
        const v = assignments[id];
        assert.ok(typeof v === 'string',
            `expected assignment for ${id}, got ${v}`);
        const dom = model.initialDomains[id];
        assert.ok(dom.indexOf(v) >= 0,
            `value ${v} for ${id} not in initial domain`);
        vals.push(v);
    }
    const distinct = new Set(vals);
    assert.strictEqual(distinct.size, vals.length,
        `AllDifferent violated: ${JSON.stringify(vals)}`);
}

// ---------------------------------------------------------------------------
// 1. Trivial single-var problem
// ---------------------------------------------------------------------------

test('trivial single-variable model returns the assignment', () => {
    const model = {
        variables: ['x'],
        initialDomains: { x: ['a', 'b', 'c'] },
        constraints: []
    };
    const out = solve(model);
    assert.strictEqual(out.partial, false);
    assert.strictEqual(out.timedOut, false);
    assert.strictEqual(typeof out.assignments.x, 'string');
    assert.ok(['a', 'b', 'c'].indexOf(out.assignments.x) >= 0);
    assert.strictEqual(out.cost, null);
});

test('single-variable singleton domain returns that value', () => {
    const model = {
        variables: ['only'],
        initialDomains: { only: ['z'] },
        constraints: []
    };
    const out = solve(model);
    assert.deepStrictEqual(out.assignments, { only: 'z' });
    assert.strictEqual(out.partial, false);
});

// ---------------------------------------------------------------------------
// 2. 5-variable AllDifferent with unique solution (forces backtracking)
// ---------------------------------------------------------------------------

test('5-var AllDifferent with constrained singletons forces backtracking', () => {
    // Each variable is forced to a different value through narrow domains
    // that overlap heavily in early-search choices, requiring AC-3 + DFS
    // to find the consistent assignment.
    //
    //   v0 ∈ {a, b}
    //   v1 ∈ {a, b, c}
    //   v2 ∈ {a, b, c, d}
    //   v3 ∈ {a, b, c, d, e}
    //   v4 ∈ {a, b, c, d, e}
    // Only valid AllDifferent assignment is the unique completion driven
    // by the smallest-domain-first ordering.
    const vars = ['v0', 'v1', 'v2', 'v3', 'v4'];
    const model = {
        variables: vars,
        initialDomains: {
            v0: ['a', 'b'],
            v1: ['a', 'b', 'c'],
            v2: ['a', 'b', 'c', 'd'],
            v3: ['a', 'b', 'c', 'd', 'e'],
            v4: ['a', 'b', 'c', 'd', 'e']
        },
        constraints: [
            { type: 'allDifferent', varGroup: vars.slice() }
        ]
    };
    const out = solve(model);
    assert.strictEqual(out.partial, false, JSON.stringify(out));
    assert.strictEqual(out.timedOut, false);
    // Validate AllDifferent.
    const used = new Set();
    for (let i = 0; i < vars.length; i += 1) {
        const v = out.assignments[vars[i]];
        assert.ok(typeof v === 'string');
        assert.ok(!used.has(v), 'duplicate value: ' + v);
        used.add(v);
    }
    // Stats sanity.
    assert.ok(out.stats.nodesExplored >= 1);
});

// ---------------------------------------------------------------------------
// 3. 5-var AllDifferent, multiple solutions, no costFn → ANY valid result
// ---------------------------------------------------------------------------

test('5-var AllDifferent with multiple solutions returns SOME valid assignment', () => {
    const vars = ['a', 'b', 'c', 'd', 'e'];
    const model = buildAllDifferentModel(vars, ['1', '2', '3', '4', '5']);
    const out = solve(model);
    assert.strictEqual(out.partial, false);
    assert.strictEqual(out.timedOut, false);
    assertAllDifferentValid(model, out.assignments);
});

// ---------------------------------------------------------------------------
// 4. 5-var AllDifferent, multiple solutions, WITH costFn → lowest-cost
// ---------------------------------------------------------------------------

test('5-var AllDifferent with costFn returns the lowest-cost valid assignment', () => {
    const vars = ['v1', 'v2', 'v3', 'v4', 'v5'];
    // Cost = sum of integer values of assigned digits. Lowest-cost
    // complete assignment uses {1,2,3,4,5} (sum = 15) — the unique
    // smallest sum since AllDifferent forces five distinct picks. We
    // give an extra value '9' so the solver could pick higher values
    // and gain cost; the optimal answer must NOT contain '9'.
    const allValues = ['1', '2', '3', '4', '5', '9'];
    const model = buildAllDifferentModel(vars, allValues, {
        costFn: function (assignment) {
            let s = 0;
            for (const k in assignment) {
                if (Object.prototype.hasOwnProperty.call(assignment, k)) {
                    s += parseInt(assignment[k], 10);
                }
            }
            return s;
        }
    });
    const out = solve(model, { timeBudgetMs: 5000 });
    assert.strictEqual(out.partial, false);
    assert.strictEqual(out.timedOut, false);
    assertAllDifferentValid(model, out.assignments);
    // Optimal cost is 1+2+3+4+5 = 15.
    assert.strictEqual(out.cost, 15,
        `expected optimal cost 15, got ${out.cost} (${JSON.stringify(out.assignments)})`);
    // None of the values should be '9'.
    for (const k in out.assignments) {
        if (Object.prototype.hasOwnProperty.call(out.assignments, k)) {
            assert.notStrictEqual(out.assignments[k], '9',
                'optimal assignment must not include 9');
        }
    }
});

// ---------------------------------------------------------------------------
// 5. Determinism (no costFn) — byte-identical output across two runs
// ---------------------------------------------------------------------------

test('determinism: same model twice produces byte-identical assignment', () => {
    const vars = ['p', 'q', 'r', 's', 't'];
    const model1 = buildAllDifferentModel(vars, ['x', 'y', 'z', 'w', 'v']);
    const model2 = buildAllDifferentModel(vars, ['x', 'y', 'z', 'w', 'v']);

    const a = solve(model1);
    const b = solve(model2);

    assert.strictEqual(a.partial, false);
    assert.strictEqual(b.partial, false);
    // Compare canonical JSON of assignments (sorted keys).
    const aJson = JSON.stringify(a.assignments, Object.keys(a.assignments).sort());
    const bJson = JSON.stringify(b.assignments, Object.keys(b.assignments).sort());
    assert.strictEqual(aJson, bJson,
        `non-deterministic assignments:\n  a=${aJson}\n  b=${bJson}`);
});

test('determinism is preserved when input variable order is shuffled', () => {
    const valuesA = ['x', 'y', 'z', 'w', 'v'];
    const valuesB = ['x', 'y', 'z', 'w', 'v'];

    const m1 = buildAllDifferentModel(['a', 'b', 'c', 'd', 'e'], valuesA);
    // Shuffled `variables` array — ordering decisions inside the solver
    // are derived from sorted IDs, so result must be identical.
    const m2 = buildAllDifferentModel(['c', 'a', 'e', 'b', 'd'], valuesB);

    const r1 = solve(m1);
    const r2 = solve(m2);
    assert.deepStrictEqual(r1.assignments, r2.assignments);
});

// ---------------------------------------------------------------------------
// 6. Infeasible problem
// ---------------------------------------------------------------------------

test('infeasible AllDifferent (3 vars, 2 values) returns partial with no assignments', () => {
    const vars = ['x', 'y', 'z'];
    const model = buildAllDifferentModel(vars, ['a', 'b']);
    const out = solve(model);
    assert.strictEqual(out.partial, true);
    assert.strictEqual(out.timedOut, false);
    // Either we got no progress at all, OR we have at most 2 var
    // assignments — but never 3 (infeasible).
    const count = Object.keys(out.assignments).length;
    assert.ok(count <= 2, `expected ≤ 2 assignments, got ${count}`);
});

test('empty initial domain triggers immediate conflict, returns partial', () => {
    const model = {
        variables: ['x'],
        initialDomains: { x: [] },
        constraints: []
    };
    const out = solve(model);
    assert.strictEqual(out.partial, true);
    assert.deepStrictEqual(out.assignments, {});
    assert.strictEqual(out.timedOut, false);
});

// ---------------------------------------------------------------------------
// 7. Tight time budget on a "hard" problem
// ---------------------------------------------------------------------------

test('zero time budget returns timedOut with no progress', () => {
    const vars = ['v0', 'v1', 'v2', 'v3', 'v4'];
    const model = buildAllDifferentModel(vars, ['a', 'b', 'c', 'd', 'e']);
    const out = solve(model, { timeBudgetMs: 0 });
    // Could be timedOut=true with no/partial assignments.
    assert.strictEqual(out.timedOut, true);
    // Could not have completed all 5 in zero ms (clock < threshold).
    assert.strictEqual(out.partial, true);
});

test('synthetic clock: tight budget on hard problem returns timedOut', () => {
    // Inject a clock that advances 1ms per call, with a 3ms budget.
    // The solver checks the clock at every recursion entry, so it will
    // run out very quickly. We can't predict whether it manages to find
    // a complete solution before the budget — but if `partial=true`
    // then `timedOut` MUST be true.
    let t = 0;
    const fakeNow = function () { t += 1; return t; };

    const vars = ['v0', 'v1', 'v2', 'v3', 'v4'];
    const model = buildAllDifferentModel(vars, ['a', 'b', 'c', 'd', 'e']);
    const out = solve(model, { timeBudgetMs: 3, now: fakeNow });

    if (out.partial) {
        assert.strictEqual(out.timedOut, true,
            'partial result without timedOut flag');
    } else {
        // If solver completed in 3 fake-ms it's a degenerate case but
        // still valid; verify the assignment.
        assertAllDifferentValid(model, out.assignments);
    }
});

// ---------------------------------------------------------------------------
// 8. Result shape and stats
// ---------------------------------------------------------------------------

test('result has the documented shape', () => {
    const out = solve({
        variables: ['x'],
        initialDomains: { x: ['only'] },
        constraints: []
    });
    assert.ok(out && typeof out === 'object');
    assert.ok(out.assignments && typeof out.assignments === 'object');
    assert.strictEqual(typeof out.partial, 'boolean');
    assert.strictEqual(typeof out.timedOut, 'boolean');
    assert.ok(Object.prototype.hasOwnProperty.call(out, 'cost'));
    assert.ok(out.stats && typeof out.stats === 'object');
    assert.strictEqual(typeof out.stats.nodesExplored, 'number');
    assert.strictEqual(typeof out.stats.conflicts, 'number');
    assert.strictEqual(typeof out.stats.propagateCalls, 'number');
    assert.strictEqual(typeof out.stats.elapsedMs, 'number');
});

test('cost is null when costFn is omitted, numeric when provided', () => {
    const noCost = solve({
        variables: ['x'],
        initialDomains: { x: ['a'] },
        constraints: []
    });
    assert.strictEqual(noCost.cost, null);

    const withCost = solve({
        variables: ['x'],
        initialDomains: { x: ['a', 'b'] },
        constraints: [],
        costFn: function (a) { return a.x === 'a' ? 0 : 7; }
    });
    assert.strictEqual(withCost.cost, 0);
    assert.strictEqual(withCost.assignments.x, 'a');
});

// ---------------------------------------------------------------------------
// 9. Input validation
// ---------------------------------------------------------------------------

test('solve rejects non-object model', () => {
    assert.throws(() => solve(null), TypeError);
    assert.throws(() => solve(42), TypeError);
});

test('solve rejects model without variables array', () => {
    assert.throws(() => solve({}), TypeError);
    assert.throws(() => solve({ variables: 'oops' }), TypeError);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
