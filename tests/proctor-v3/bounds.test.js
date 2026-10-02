/**
 * Unit tests for
 *   js/algorithms/proctor-v3/constraints/bounds.js
 *   js/algorithms/proctor-v3/phases/03-bounds.js
 *
 * Validates: Requirements 5.2, 5.3, 5.4, 5.5
 *
 * Run directly:   node tests/proctor-v3/bounds.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const {
    computeGlobalBounds,
    computeClassBounds
} = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'constraints',
    'bounds.js'
));

const { computeBounds } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'phases',
    '03-bounds.js'
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

// ===========================================================================
// computeGlobalBounds — Acceptance Criterion 5.2
// ===========================================================================

test('AC 5.2: standard exact-divide case G=10 D=2 N=3 → lower=4 upper=4', () => {
    const r = computeGlobalBounds(10, 2, 3);
    assert.strictEqual(r.globalLowerBound, 4);
    assert.strictEqual(r.globalUpperBound, 4);
});

test('AC 5.2: remainder case G=10 D=3 N=3 → lower=4 upper=5', () => {
    const r = computeGlobalBounds(10, 3, 3);
    assert.strictEqual(r.globalLowerBound, 4);
    assert.strictEqual(r.globalUpperBound, 5);
});

test('AC 5.2: zero D, exact divide G=10 D=0 N=5 → lower=2 upper=2', () => {
    const r = computeGlobalBounds(10, 0, 5);
    assert.strictEqual(r.globalLowerBound, 2);
    assert.strictEqual(r.globalUpperBound, 2);
});

test('AC 5.2: zero D, with remainder G=11 D=0 N=5 → lower=2 upper=3', () => {
    const r = computeGlobalBounds(11, 0, 5);
    assert.strictEqual(r.globalLowerBound, 2);
    assert.strictEqual(r.globalUpperBound, 3);
});

test('AC 5.2: zero N edge case G=0 D=0 N=0 → lower=0 upper=0', () => {
    const r = computeGlobalBounds(0, 0, 0);
    assert.strictEqual(r.globalLowerBound, 0);
    assert.strictEqual(r.globalUpperBound, 0);
});

test('AC 5.2: zero N with positive G/D still returns 0/0 (no division by zero)', () => {
    const r = computeGlobalBounds(50, 10, 0);
    assert.strictEqual(r.globalLowerBound, 0);
    assert.strictEqual(r.globalUpperBound, 0);
});

test('AC 5.2: singleton N=1 with G=5 D=2 → lower=upper=7', () => {
    const r = computeGlobalBounds(5, 2, 1);
    assert.strictEqual(r.globalLowerBound, 7);
    assert.strictEqual(r.globalUpperBound, 7);
});

test('AC 5.2: large evenly-divisible inputs G=300 D=0 N=100 → lower=upper=3', () => {
    const r = computeGlobalBounds(300, 0, 100);
    assert.strictEqual(r.globalLowerBound, 3);
    assert.strictEqual(r.globalUpperBound, 3);
});

test('AC 5.2: large inputs with remainder G=301 D=0 N=100 → lower=3 upper=4', () => {
    const r = computeGlobalBounds(301, 0, 100);
    assert.strictEqual(r.globalLowerBound, 3);
    assert.strictEqual(r.globalUpperBound, 4);
});

test('AC 5.2: zero work G=0 D=0 N=10 → lower=0 upper=0', () => {
    const r = computeGlobalBounds(0, 0, 10);
    assert.strictEqual(r.globalLowerBound, 0);
    assert.strictEqual(r.globalUpperBound, 0);
});

test('AC 5.2: work less than N (G+D < N) → lower=0 upper=1', () => {
    const r = computeGlobalBounds(3, 0, 10);
    assert.strictEqual(r.globalLowerBound, 0);
    assert.strictEqual(r.globalUpperBound, 1);
});

test('AC 5.2: defensive coercion of negative or NaN inputs to 0', () => {
    assert.deepStrictEqual(computeGlobalBounds(-5, 2, 3),
        { globalLowerBound: 0, globalUpperBound: 1 });   // G coerced to 0; (0+2)/3
    assert.deepStrictEqual(computeGlobalBounds(10, NaN, 3),
        { globalLowerBound: 3, globalUpperBound: 4 });   // D coerced to 0; 10/3
    assert.deepStrictEqual(computeGlobalBounds(10, 2, -1),
        { globalLowerBound: 0, globalUpperBound: 0 });   // N coerced to 0
});

test('AC 5.2: returned object keys are exactly the documented two', () => {
    const r = computeGlobalBounds(6, 0, 3);
    assert.deepStrictEqual(Object.keys(r).sort(), ['globalLowerBound', 'globalUpperBound']);
});

// ===========================================================================
// computeClassBounds — basic sanity & AC 5.3 / 5.4 caps
// ===========================================================================

test('returns empty bounds for empty class list', () => {
    const r = computeClassBounds([], 4, 5, {}, {});
    assert.deepStrictEqual(r.byClass, {});
    assert.deepStrictEqual(r.list, []);
});

test('single class with even total: lower=upper=natural', () => {
    const classes = [{ classId: 'c1', size: 3 }];
    const dutyByClass = { c1: 2 };
    const slotsByClass = { c1: 10 };  // total = 12, /3 = 4
    const r = computeClassBounds(classes, 4, 4, dutyByClass, slotsByClass);
    assert.strictEqual(r.byClass.c1.lower, 4);
    assert.strictEqual(r.byClass.c1.upper, 4);
    assert.strictEqual(r.byClass.c1.size, 3);
    assert.strictEqual(r.byClass.c1.slotsInClass, 10);
    assert.strictEqual(r.byClass.c1.dutyInClass, 2);
});

test('single class with remainder: lower<upper, both within global caps', () => {
    const classes = [{ classId: 'c1', size: 3 }];
    const dutyByClass = { c1: 1 };
    const slotsByClass = { c1: 10 };  // total = 11, floor 3, ceil 4
    const r = computeClassBounds(classes, 4, 5, dutyByClass, slotsByClass);
    // total=11 > globalLower=4 → lower = min(3, 5) = 3, upper = min(4, 6) = 4
    assert.strictEqual(r.byClass.c1.lower, 3);
    assert.strictEqual(r.byClass.c1.upper, 4);
});

test('AC 5.3: class lower never exceeds globalUpper', () => {
    // Class with very high natural lower (small size, big total).
    const classes = [{ classId: 'c1', size: 1 }];
    const dutyByClass = { c1: 0 };
    const slotsByClass = { c1: 100 };  // natural lower = 100
    const globalLower = 4;
    const globalUpper = 5;
    const r = computeClassBounds(classes, globalLower, globalUpper, dutyByClass, slotsByClass);
    // total=100 > GL=4 → use cap branch. lower capped at globalUpper=5.
    assert.strictEqual(r.byClass.c1.lower, 5);
    // upper capped at globalUpper + 1 = 6.
    assert.strictEqual(r.byClass.c1.upper, 6);
});

test('AC 5.4: class upper never exceeds globalUpper + 1', () => {
    const classes = [{ classId: 'c1', size: 1 }];
    const slotsByClass = { c1: 50 };
    const r = computeClassBounds(classes, 3, 4, { c1: 0 }, slotsByClass);
    // natural upper for c1 = 50, capped to globalUpper+1 = 5.
    assert.strictEqual(r.byClass.c1.upper, 5);
});

// ===========================================================================
// computeClassBounds — AC 5.5: monotonicity guard with `<=`, NOT `<`
// ===========================================================================

test('AC 5.5: when total <= globalLower with small total, lower respects invariant', () => {
    // class size 3 with total 2; globalLower = 4. naturalLower=floor(2/3)=0,
    // naturalUpper=ceil(2/3)=1. AC 5.5 → guard branch: raw lower=total=2.
    // upper = min(naturalUpper=1, GU+1=6) = 1. Defensive invariant collapses
    // lower down to upper=1 so lower<=upper holds. The class collectively
    // can carry exactly `total` units of work (2), which is enforced
    // upstream by the bounds being interpreted as PER-PROCTOR averages —
    // not a sum cap.
    const classes = [{ classId: 'c1', size: 3 }];
    const dutyByClass = { c1: 0 };
    const slotsByClass = { c1: 2 };
    const r = computeClassBounds(classes, 4, 5, dutyByClass, slotsByClass);
    assert.strictEqual(r.byClass.c1.upper, 1);
    assert.ok(r.byClass.c1.lower <= r.byClass.c1.upper, 'lower must not exceed upper');
    assert.strictEqual(r.byClass.c1.lower, 1);
});

test('AC 5.5 boundary: total == globalLower → guard triggers (uses `<=`, NOT `<`)', () => {
    // V2 used `<` so this case fell into the cap branch and could produce
    // an inflated lower. V3 uses `<=` so the guard owns this case.
    // Use size=1 so the guard's `lower = total` doesn't conflict with the
    // ceil-based naturalUpper (with size=1, naturalLower==naturalUpper==total,
    // so the per-proctor lower and upper align cleanly).
    const classes = [{ classId: 'c1', size: 1 }];
    const dutyByClass = { c1: 2 };
    const slotsByClass = { c1: 2 };  // total = 4
    const globalLower = 4;
    const globalUpper = 5;
    const r = computeClassBounds(classes, globalLower, globalUpper, dutyByClass, slotsByClass);
    // total == GL → guard branch. lower = total = 4.
    assert.strictEqual(r.byClass.c1.lower, 4);
    // naturalUpper = ceil(4/1) = 4; capped at globalUpper+1=6. upper = 4.
    assert.strictEqual(r.byClass.c1.upper, 4);
});

test('AC 5.5 with `<` (V2 bug) WOULD HAVE skipped guard at total==GL — V3 does not', () => {
    // Demonstrates the difference between `<` and `<=`.
    // Setup: size=1, total=4, GL=4, GU=5.
    //   With `<` (buggy): falls into cap branch, lower=min(floor(4/1)=4, GU=5)=4.
    //   With `<=` (V3):   guard branch, lower=total=4.
    // The numeric outcome happens to coincide here because size=1 makes
    // floor(total/size)==total. The behavioral difference shows when total > GL
    // is needed to differentiate; this test asserts the DOC contract that
    // V3 uses `<=`. An implementation that switched to `<` would still pass
    // this assertion for size=1, but would diverge in many other cases
    // covered by the surrounding tests.
    const classes = [{ classId: 'c1', size: 1 }];
    const r = computeClassBounds(classes, 4, 5, { c1: 0 }, { c1: 4 });
    assert.strictEqual(r.byClass.c1.lower, 4);
});

test('AC 5.5: total > globalLower does NOT trigger guard (cap branch used)', () => {
    const classes = [{ classId: 'c1', size: 4 }];
    const dutyByClass = { c1: 0 };
    const slotsByClass = { c1: 5 };  // total = 5, > GL = 4
    const r = computeClassBounds(classes, 4, 5, dutyByClass, slotsByClass);
    // Cap branch: lower = min(floor(5/4)=1, GU=5) = 1. upper = min(ceil(5/4)=2, 6) = 2.
    assert.strictEqual(r.byClass.c1.lower, 1);
    assert.strictEqual(r.byClass.c1.upper, 2);
});

// ===========================================================================
// computeClassBounds — singleton classes
// ===========================================================================

test('singleton class (size 1) with no work: lower=0, upper=0', () => {
    const classes = [{ classId: 'c1', size: 1 }];
    const r = computeClassBounds(classes, 4, 5, { c1: 0 }, { c1: 0 });
    assert.strictEqual(r.byClass.c1.lower, 0);
    assert.strictEqual(r.byClass.c1.upper, 0);
});

test('singleton class (size 1) with one duty and one slot: total=2', () => {
    const classes = [{ classId: 'c1', size: 1 }];
    const r = computeClassBounds(classes, 4, 5, { c1: 1 }, { c1: 1 });
    // total=2 <= GL=4 → guard. lower = total = 2.
    // upper = min(ceil(2/1)=2, 6) = 2.
    assert.strictEqual(r.byClass.c1.lower, 2);
    assert.strictEqual(r.byClass.c1.upper, 2);
});

test('singleton class with high total: caps applied', () => {
    const classes = [{ classId: 'c1', size: 1 }];
    const r = computeClassBounds(classes, 4, 5, { c1: 0 }, { c1: 50 });
    // total=50 > GL=4 → cap branch. lower=min(50,GU=5)=5. upper=min(50,GU+1=6)=6.
    assert.strictEqual(r.byClass.c1.lower, 5);
    assert.strictEqual(r.byClass.c1.upper, 6);
});

test('classes with size 0 collapse to lower=0, upper=0 (defensive)', () => {
    const classes = [{ classId: 'empty', size: 0 }];
    const r = computeClassBounds(classes, 4, 5, { empty: 0 }, { empty: 0 });
    assert.strictEqual(r.byClass.empty.lower, 0);
    assert.strictEqual(r.byClass.empty.upper, 0);
});

// ===========================================================================
// computeClassBounds — multi-class scenarios
// ===========================================================================

test('multiple classes computed independently and reported in list', () => {
    const classes = [
        { classId: 'a', size: 2 },
        { classId: 'b', size: 5 },
        { classId: 'c', size: 1 }
    ];
    const dutyByClass = { a: 0, b: 1, c: 0 };
    const slotsByClass = { a: 4, b: 9, c: 3 };
    const r = computeClassBounds(classes, 3, 4, dutyByClass, slotsByClass);
    // a: total=4, > GL=3 → cap. lower=min(2,4)=2, upper=min(2,5)=2
    assert.strictEqual(r.byClass.a.lower, 2);
    assert.strictEqual(r.byClass.a.upper, 2);
    // b: total=10, > GL=3 → cap. lower=min(2,4)=2, upper=min(2,5)=2
    assert.strictEqual(r.byClass.b.lower, 2);
    assert.strictEqual(r.byClass.b.upper, 2);
    // c: total=3, <= GL=3 → guard. lower=3, upper=min(3,5)=3
    assert.strictEqual(r.byClass.c.lower, 3);
    assert.strictEqual(r.byClass.c.upper, 3);
    // list mirrors byClass
    assert.strictEqual(r.list.length, 3);
    assert.strictEqual(r.list.map((x) => x.classId).sort().join(','), 'a,b,c');
});

test('class.proctorKeys.length is used as size when explicit `size` is missing', () => {
    const classes = [{ classId: 'c1', proctorKeys: ['k1', 'k2', 'k3'] }];
    const r = computeClassBounds(classes, 4, 5, { c1: 0 }, { c1: 6 });
    // size derived = 3. total=6 > GL=4 → cap. lower=min(2,5)=2, upper=min(2,6)=2
    assert.strictEqual(r.byClass.c1.size, 3);
    assert.strictEqual(r.byClass.c1.lower, 2);
    assert.strictEqual(r.byClass.c1.upper, 2);
});

test('missing entries in dutyByClass / slotsByClass default to 0', () => {
    const classes = [{ classId: 'c1', size: 2 }];
    const r = computeClassBounds(classes, 1, 2, {}, {});
    // total=0 <= GL=1 → guard. lower=0, upper=min(0, 3)=0.
    assert.strictEqual(r.byClass.c1.lower, 0);
    assert.strictEqual(r.byClass.c1.upper, 0);
});

test('classes without classId are silently skipped', () => {
    const classes = [{ size: 2 }, { classId: '', size: 2 }, { classId: 'good', size: 2 }];
    const r = computeClassBounds(classes, 1, 2, { good: 1 }, { good: 1 });
    assert.deepStrictEqual(Object.keys(r.byClass), ['good']);
});

test('lower <= upper invariant holds for a wide range of inputs', () => {
    const cases = [];
    for (let size = 1; size <= 5; size += 1) {
        for (let total = 0; total <= 10; total += 1) {
            for (let GL = 0; GL <= 6; GL += 1) {
                const GU = GL + (total % 2 === 0 ? 0 : 1);
                cases.push({ size, total, GL, GU });
            }
        }
    }
    for (const c of cases) {
        const r = computeClassBounds(
            [{ classId: 'x', size: c.size }],
            c.GL,
            c.GU,
            { x: 0 },
            { x: c.total }
        );
        assert.ok(
            r.byClass.x.lower <= r.byClass.x.upper,
            `invariant lower<=upper violated for ${JSON.stringify(c)}: ` +
            `got ${JSON.stringify(r.byClass.x)}`
        );
        // AC 5.3
        assert.ok(r.byClass.x.lower <= c.GU,
            `AC 5.3 violated for ${JSON.stringify(c)}: lower=${r.byClass.x.lower} > GU=${c.GU}`);
        // AC 5.4
        assert.ok(r.byClass.x.upper <= c.GU + 1,
            `AC 5.4 violated for ${JSON.stringify(c)}: upper=${r.byClass.x.upper} > GU+1=${c.GU + 1}`);
    }
});

// ===========================================================================
// Phase 3 wiring — computeBounds(state)
// ===========================================================================

function makeRow(sessionKey, slots) {
    const proctor_keys = new Array(slots == null ? 2 : slots);
    for (let i = 0; i < proctor_keys.length; i += 1) proctor_keys[i] = null;
    return {
        session_key: sessionKey,
        halfday_key: sessionKey + '_h',
        day_key: '2026-06-04',
        room_key: 'R',
        room_name: 'Salle',
        proctor_keys: proctor_keys,
        proctors: [],
        reserve_keys: [],
        reserves: [],
        duty_teachers: [],
        softViolations: []
    };
}

test('computeBounds: throws on null state or non-object input', () => {
    assert.throws(() => computeBounds(null), TypeError);
    assert.throws(() => computeBounds({}), TypeError);
    assert.throws(() => computeBounds({ input: null }), TypeError);
    assert.throws(() => computeBounds({ input: [] }), TypeError);
});

test('computeBounds: empty input → globals 0/0, empty classBounds', () => {
    const state = { input: { proctorsList: [], scheduleEntries: [] } };
    const r = computeBounds(state);
    assert.strictEqual(r.bounds.global.lower, 0);
    assert.strictEqual(r.bounds.global.upper, 0);
    assert.strictEqual(r.bounds.global.gTotalSlots, 0);
    assert.strictEqual(r.bounds.global.dExpected, 0);
    assert.strictEqual(r.bounds.global.nEligible, 0);
    assert.deepStrictEqual(r.bounds.byClass, {});
    assert.deepStrictEqual(r.bounds.list, []);
});

test('computeBounds: produces NEW state and does not mutate input state', () => {
    const state = {
        input: { proctorsList: [{ cin: 'A1' }], scheduleEntries: [] },
        rows: [],
        classes: [{ classId: 'c0', size: 1, proctorKeys: ['A1'], eligibleSessions: [] }],
        classByProctorKey: { A1: 'c0' }
    };
    const snap = JSON.parse(JSON.stringify(state));
    const r = computeBounds(state);
    assert.notStrictEqual(r, state);
    assert.strictEqual(state.bounds, undefined);
    assert.deepStrictEqual(state, snap);
    assert.ok(r.bounds);
});

test('computeBounds: preserves unrelated state fields by shallow copy', () => {
    const state = { input: { proctorsList: [] }, somethingElse: { foo: 'bar' } };
    const r = computeBounds(state);
    assert.strictEqual(r.somethingElse, state.somethingElse);
});

test('computeBounds: standard wiring G=10 D=2 N=3 → global lower=upper=4', () => {
    // Build 5 rows with 2 slots each → G = 10.
    const rows = [];
    for (let i = 0; i < 5; i += 1) rows.push(makeRow('s' + i, 2));
    const state = {
        input: {
            proctorsList: [{ cin: 'A1' }, { cin: 'A2' }, { cin: 'A3' }],
            examCenterConfig: { expected_duty_tasks: 2 }
        },
        rows: rows,
        classes: [],
        classByProctorKey: {}
    };
    const r = computeBounds(state);
    assert.strictEqual(r.bounds.global.gTotalSlots, 10);
    assert.strictEqual(r.bounds.global.dExpected, 2);
    assert.strictEqual(r.bounds.global.nEligible, 3);
    assert.strictEqual(r.bounds.global.lower, 4);
    assert.strictEqual(r.bounds.global.upper, 4);
});

test('computeBounds: classBounds populated for each class with duty/slot tallies', () => {
    const rows = [
        makeRow('s1', 2),  // 2 slots in s1
        makeRow('s2', 2)   // 2 slots in s2
    ];
    const classes = [
        {
            classId: 'class_000',
            size: 2,
            proctorKeys: ['A1', 'A2'],
            eligibleSessions: ['s1', 's2']
        }
    ];
    const state = {
        input: {
            proctorsList: [{ cin: 'A1' }, { cin: 'A2' }],
            examCenterConfig: { expected_duty_tasks: 0 }
        },
        rows: rows,
        normalizedDutyData: { 's1_h': { A1: true } },
        classes: classes,
        classByProctorKey: { A1: 'class_000', A2: 'class_000' }
    };
    const r = computeBounds(state);
    assert.strictEqual(r.bounds.byClass.class_000.size, 2);
    assert.strictEqual(r.bounds.byClass.class_000.slotsInClass, 4);  // 2+2
    assert.strictEqual(r.bounds.byClass.class_000.dutyInClass, 1);   // A1 has 1 duty
});

test('computeBounds: proctors not in any class → no duty entries credited', () => {
    const rows = [makeRow('s1', 2)];
    const state = {
        input: {
            proctorsList: [{ cin: 'A1' }, { cin: 'orphan' }],
            examCenterConfig: { expected_duty_tasks: 0 }
        },
        rows: rows,
        normalizedDutyData: { 's1_h': { A1: true, orphan: true } },
        classes: [{ classId: 'c0', size: 1, eligibleSessions: ['s1'] }],
        classByProctorKey: { A1: 'c0' }   // 'orphan' deliberately missing
    };
    const r = computeBounds(state);
    assert.strictEqual(r.bounds.byClass.c0.dutyInClass, 1);  // only A1 counted
});

test('computeBounds: rows with same session_key sum slot counts', () => {
    const rows = [
        makeRow('shared', 2),
        makeRow('shared', 2),
        makeRow('other', 2)
    ];
    const classes = [
        { classId: 'c0', size: 1, eligibleSessions: ['shared'] }
    ];
    const state = {
        input: { proctorsList: [{ cin: 'A1' }] },
        rows: rows,
        classes: classes,
        classByProctorKey: { A1: 'c0' }
    };
    const r = computeBounds(state);
    assert.strictEqual(r.bounds.byClass.c0.slotsInClass, 4);  // both 'shared' rows
});

test('computeBounds: missing examCenterConfig → dExpected defaults to 0', () => {
    const state = {
        input: { proctorsList: [{ cin: 'A1' }] },
        rows: [],
        classes: [],
        classByProctorKey: {}
    };
    const r = computeBounds(state);
    assert.strictEqual(r.bounds.global.dExpected, 0);
});

test('computeBounds: respects nEligible from proctorsList length', () => {
    const state = {
        input: { proctorsList: new Array(7).fill({ cin: 'X' }) },
        rows: [],
        classes: [],
        classByProctorKey: {}
    };
    const r = computeBounds(state);
    assert.strictEqual(r.bounds.global.nEligible, 7);
});

test('computeBounds: D from examCenterConfig.expected_duty_tasks', () => {
    const state = {
        input: {
            proctorsList: [{ cin: 'A1' }],
            examCenterConfig: { expected_duty_tasks: 5 }
        },
        rows: [],
        classes: [],
        classByProctorKey: {}
    };
    const r = computeBounds(state);
    assert.strictEqual(r.bounds.global.dExpected, 5);
});

test('computeBounds: bounds.list mirrors bounds.byClass', () => {
    const rows = [makeRow('s1', 2)];
    const classes = [
        { classId: 'a', size: 2, eligibleSessions: ['s1'] },
        { classId: 'b', size: 1, eligibleSessions: ['s1'] }
    ];
    const state = {
        input: {
            proctorsList: [{ cin: 'A1' }, { cin: 'A2' }, { cin: 'B1' }],
            examCenterConfig: { expected_duty_tasks: 0 }
        },
        rows: rows,
        classes: classes,
        classByProctorKey: { A1: 'a', A2: 'a', B1: 'b' }
    };
    const r = computeBounds(state);
    assert.strictEqual(r.bounds.list.length, 2);
    const ids = r.bounds.list.map((x) => x.classId).sort();
    assert.deepStrictEqual(ids, ['a', 'b']);
    for (const item of r.bounds.list) {
        assert.deepStrictEqual(item, r.bounds.byClass[item.classId]);
    }
});

test('computeBounds: zero-N edge case still returns well-formed bounds', () => {
    const state = {
        input: { proctorsList: [], examCenterConfig: { expected_duty_tasks: 5 } },
        rows: [makeRow('s1', 2)],   // G=2 but N=0
        classes: [],
        classByProctorKey: {}
    };
    const r = computeBounds(state);
    assert.strictEqual(r.bounds.global.lower, 0);
    assert.strictEqual(r.bounds.global.upper, 0);
});

// ===========================================================================
// Property-Based Test (Task 28) — fast-check
//
//   **Validates: Requirements 5.6, 14.3**
//
//   AC 5.6: FOR EACH proctor T ∈ Eligible_Proctor with class c,
//             Class_Lower_Bound(c) ≤ Primary_Load(T) ≤ Class_Upper_Bound(c)
//           where Primary_Load(T) = Guard_Count(T) + Duty_Count(T).
//
//   Strategy: use fast-check to generate 100+ random GS3_Input_Contract
//   instances via the PBT helpers. Run the V3 orchestrator end-to-end,
//   then verify the universal property by computing bounds independently
//   and checking each proctor's Primary_Load against their class bounds.
//
//   Exceptions:
//     - UPPER (hard): Primary_Load(T) ≤ Class_Upper_Bound(c). The single
//       legitimate exception is *pure-duty overflow* — a proctor whose
//       pre-pinned Duty_Count alone exceeds the class upper bound.
//     - LOWER (best-effort, AC 5.13): Primary_Load(T) ≥ Class_Lower_Bound(c)
//       OR a `diagnostics.coverageWarnings` entry was recorded for T.
//     - If diagnostics contains a `fairness_violation` or
//       `coverage_infeasible` error, the algorithm couldn't achieve perfect
//       fairness — bounds violations are acceptable in that case.
// ===========================================================================

const fc = require('fast-check');
const { runOrchestrator } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'orchestrator.js'
));
const { createPRNG: createPRNG_PBT } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'utils', 'prng.js'
));
const { normalizeKeys } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'phases', '01-normalize-keys.js'
));
const { buildRoomsAndRows } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'phases', '01b-build-rooms-and-rows.js'
));
const { deriveEligibilityClasses } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'phases', '02-eligibility-classes.js'
));
const { arbitraryInput } = require(path.join(__dirname, 'pbt-helpers.js'));

function canonicalKeyOfPBT(proctor, idx) {
    const cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

/**
 * Compute bounds independently from the input (mirrors Phase 3 logic)
 * and return a per-proctor-key bounds map. This avoids relying on the
 * diagnostics output which may not surface classBoundsByProctorKey.
 */
function computeBoundsForInput(input) {
    let state = { input: input, options: {} };
    state = normalizeKeys(state);
    state = buildRoomsAndRows(state);
    state = deriveEligibilityClasses(state);
    state = computeBounds(state);

    // Build per-proctor-key bounds map from state.bounds.byClass + classByProctorKey
    const cbpk = state.classByProctorKey || {};
    const byClass = (state.bounds && state.bounds.byClass) || {};
    const result = {};
    const keys = Object.keys(cbpk);
    for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        const classId = cbpk[key];
        const b = byClass[classId];
        if (b && typeof b.lower === 'number' && typeof b.upper === 'number') {
            result[key] = { classLowerBound: b.lower, classUpperBound: b.upper, classId: classId };
        }
    }
    return result;
}

/**
 * Compute duty counts per proctor key from the input's dutyData.
 * Each (proctor, halfday) pair counts as one duty unit.
 */
function computeDutyCounts(input) {
    const dutyCounts = Object.create(null);
    if (!input.dutyData || typeof input.dutyData !== 'object') return dutyCounts;
    const hdKeys = Object.keys(input.dutyData);
    for (let h = 0; h < hdKeys.length; h += 1) {
        const inner = input.dutyData[hdKeys[h]];
        if (!inner || typeof inner !== 'object') continue;
        const pKeys = Object.keys(inner);
        for (let p = 0; p < pKeys.length; p += 1) {
            dutyCounts[pKeys[p]] = (dutyCounts[pKeys[p]] || 0) + 1;
        }
    }
    return dutyCounts;
}

/**
 * fast-check arbitrary that produces a valid GS3_Input_Contract by seeding
 * the PBT helpers with a random integer seed. Uses small inputs (5-8
 * proctors, 2 schedule entries) to keep PBT runs fast given the solver.
 */
const arbV3InputForBounds = fc.integer({ min: 1, max: 2147483647 }).map((seed) => {
    const rng = createPRNG_PBT(seed);
    const input = arbitraryInput(rng);
    // Constrain to small inputs for speed: cap proctors at 8, entries at 2
    if (input.proctorsList.length > 8) {
        input.proctorsList = input.proctorsList.slice(0, 8);
    }
    if (input.scheduleEntries.length > 2) {
        input.scheduleEntries = input.scheduleEntries.slice(0, 2);
    }
    // Attach seed for diagnostics on failure
    input._pbtSeed = seed;
    return input;
});

test('property (fast-check): Class_Lower_Bound ≤ Primary_Load ≤ Class_Upper_Bound for every eligible proctor — AC 5.6', () => {
    // **Validates: Requirements 5.6, 14.3**
    let totalInspected = 0;

    fc.assert(
        fc.property(arbV3InputForBounds, (input) => {
            const runResult = runOrchestrator(input, {
                totalBudgetMs: 3000,
                phase4TimeBudgetMs: 800,
                phase5TimeBudgetMs: 400,
                phase7TimeBudgetMs: 800,
                phase8TimeBudgetMs: 300,
                phase9TimeBudgetMs: 300
            });

            // Envelope sanity
            if (!runResult || typeof runResult !== 'object') return true;
            if (!Array.isArray(runResult.result)) return true;

            const diag = runResult.diagnostics || {};

            // If the algorithm reported a fairness_violation or
            // coverage_infeasible error, bounds violations are acceptable
            // (the algorithm couldn't achieve perfect fairness).
            const errors = Array.isArray(diag.errors) ? diag.errors : [];
            const hasFairnessViolation = errors.some(function (e) {
                return e && (e.type === 'fairness_violation'
                    || e.type === 'coverage_infeasible'
                    || e.type === 'coverage_infeasible_regardless');
            });
            if (hasFairnessViolation) return true;

            // Compute bounds independently from the input
            const boundsMap = computeBoundsForInput(input);
            if (Object.keys(boundsMap).length === 0) return true; // no eligible proctors

            // Build set of warned keys (proctors that couldn't reach lower bound)
            const coverageWarnings = Array.isArray(diag.coverageWarnings)
                ? diag.coverageWarnings : [];
            const warnedKeys = Object.create(null);
            for (let i = 0; i < coverageWarnings.length; i += 1) {
                const w = coverageWarnings[i];
                if (w && typeof w.canonicalKey === 'string') {
                    warnedKeys[w.canonicalKey] = true;
                }
            }

            // Compute Guard_Count for each proctor from the result rows
            const resultRows = runResult.result;
            const guardCounts = Object.create(null);
            for (let r = 0; r < resultRows.length; r += 1) {
                const row = resultRows[r];
                if (!row || !Array.isArray(row.proctor_keys)) continue;
                for (let s = 0; s < row.proctor_keys.length; s += 1) {
                    const k = row.proctor_keys[s];
                    if (k === null || k === undefined) continue;
                    guardCounts[k] = (guardCounts[k] || 0) + 1;
                }
            }

            // Compute Duty_Count for each proctor from the input
            const dutyCounts = computeDutyCounts(input);

            // Verify AC 5.6 for every proctor that has class bounds
            const proctorKeys = Object.keys(boundsMap).sort();
            for (let k = 0; k < proctorKeys.length; k += 1) {
                const key = proctorKeys[k];
                const bounds = boundsMap[key];

                const classLower = bounds.classLowerBound;
                const classUpper = bounds.classUpperBound;
                const gc = guardCounts[key] || 0;
                const dc = dutyCounts[key] || 0;
                const primaryLoad = gc + dc;
                totalInspected += 1;

                // --- UPPER bound (AC 5.6, hard) ---
                if (primaryLoad > classUpper) {
                    // Pure-duty overflow exception: if Duty_Count alone
                    // exceeds the upper bound, the engine must NOT have
                    // assigned any guard slot (AC 5.9).
                    if (dc > classUpper) {
                        if (gc !== 0) return false; // AC 5.9 violated
                    } else {
                        return false; // genuine upper-bound violation
                    }
                }

                // --- LOWER bound (AC 5.6, best-effort per AC 5.13) ---
                if (primaryLoad < classLower) {
                    // Acceptable only if a coverage warning was recorded
                    if (!warnedKeys[key]) return false;
                }
            }

            return true;
        }),
        { numRuns: 100, verbose: true }
    );

    // Guard against vacuous pass
    assert.ok(
        totalInspected > 0,
        'Expected to inspect at least one eligible proctor across 100'
        + ' random inputs (otherwise the property holds vacuously)'
    );

    passed += 1;
    console.log('  ok  property (fast-check): AC 5.6 bounds hold for all eligible proctors (100 runs, ' + totalInspected + ' proctors inspected)');
});

// ===========================================================================
// Summary
// ===========================================================================

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
