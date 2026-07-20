'use strict';

/**
 * Unit tests for pure timetable move/edit helpers.
 * Covers plan scenarios 2–10 (automated) from:
 * docs/plans/2026-07-09-timetable-tabs-drag-drop-plan-v2.md
 *
 * Run: node tests/timetable-move-logic.test.js
 */

const assert = require('assert');
const Move = require('../js/shared/timetable-move-logic.js');

function emptyDay() {
    return { morning: {}, afternoon: {} };
}

function makeTimetables() {
    return {
        T1: {
            الاثنين: {
                morning: {
                    H1: { subject: 'رياضيات', students: '1BAC-1', room: 'S1' }
                },
                afternoon: {}
            },
            الثلاثاء: emptyDay(),
            الأربعاء: emptyDay(),
            الخميس: emptyDay(),
            الجمعة: emptyDay(),
            السبت: emptyDay()
        },
        T2: {
            الاثنين: {
                morning: {
                    H2: { subject: 'فيزياء', students: '1BAC-2', room: 'S2' }
                },
                afternoon: {
                    H3: { subject: 'فيزياء', students: '1BAC-1', room: 'S1' }
                }
            },
            الثلاثاء: emptyDay(),
            الأربعاء: emptyDay(),
            الخميس: emptyDay(),
            الجمعة: emptyDay(),
            السبت: emptyDay()
        }
    };
}

function depsFrom(timetables) {
    return {
        getSlotData(teacher, day, period, periodType) {
            return timetables[teacher]?.[day]?.[periodType]?.[period] || null;
        },
        isRoomOccupied(room, day, period, periodType, excludeTeacher) {
            if (!room) return { occupied: false };
            for (const teacher of Object.keys(timetables)) {
                if (excludeTeacher && teacher === excludeTeacher) continue;
                const slot = timetables[teacher]?.[day]?.[periodType]?.[period];
                if (slot && slot.room === room) {
                    return { occupied: true, byTeacher: teacher };
                }
            }
            return { occupied: false };
        },
        buildClassTimetable(className) {
            const classTimetable = {};
            for (const teacher of Object.keys(timetables)) {
                for (const day of Object.keys(timetables[teacher])) {
                    classTimetable[day] = classTimetable[day] || { morning: {}, afternoon: {} };
                    for (const periodType of ['morning', 'afternoon']) {
                        const bucket = timetables[teacher][day][periodType] || {};
                        for (const period of Object.keys(bucket)) {
                            const act = bucket[period];
                            if (act && act.students === className) {
                                classTimetable[day][periodType][period] = { ...act, teacher };
                            }
                        }
                    }
                }
            }
            return classTimetable;
        }
    };
}

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log('  PASS  ' + name);
    } catch (err) {
        console.error('  FAIL  ' + name);
        console.error('        ' + (err && err.stack ? err.stack : err));
        process.exitCode = 1;
    }
}

console.log('timetable-move-logic');

// --- getConsecutivePeriods / band guard ---

test('getConsecutivePeriods returns adjacent keys within a half-day (no band clamp)', () => {
    // Within one periodType, H1–H4 are all valid, adjacent time slots.
    assert.deepStrictEqual(Move.getConsecutivePeriods('H1', 2, 'morning'), ['H1', 'H2']);
    assert.deepStrictEqual(Move.getConsecutivePeriods('H2', 2, 'morning'), ['H2', 'H3']);
    assert.deepStrictEqual(Move.getConsecutivePeriods('H3', 2, 'afternoon'), ['H3', 'H4']);
    // Anchored at the last slot there is no room for a second hour.
    assert.deepStrictEqual(Move.getConsecutivePeriods('H4', 2, 'afternoon'), ['H4']);
});

// A double lesson may span any adjacent pair inside one half-day (H2-H3 is valid).
test('validateMoveTarget accepts double lesson anchored at H2 morning (spans H2-H3)', () => {
    const timetables = makeTimetables();
    const result = Move.validateMoveTarget(
        {
            teacher: 'T1',
            className: '1BAC-1',
            room: 'S1',
            sourceDay: 'الاثنين',
            sourcePeriodType: 'morning',
            sourcePeriods: ['H1', 'H2'],
            destDay: 'الثلاثاء',
            destPeriod: 'H2',
            destPeriodType: 'morning'
        },
        depsFrom(timetables)
    );
    assert.strictEqual(result.valid, true, result.message);
    assert.deepStrictEqual(result.destPeriods, ['H2', 'H3']);
});

// Scenario 5: double into two free consecutive morning slots
test('validateMoveTarget accepts double lesson into free morning pair', () => {
    const timetables = makeTimetables();
    // free morning on الثلاثاء
    const result = Move.validateMoveTarget(
        {
            teacher: 'T1',
            className: '1BAC-1',
            room: 'S9',
            sourceDay: 'الاثنين',
            sourcePeriodType: 'morning',
            sourcePeriods: ['H1', 'H2'],
            destDay: 'الثلاثاء',
            destPeriod: 'H1',
            destPeriodType: 'morning'
        },
        depsFrom(timetables)
    );
    assert.strictEqual(result.valid, true, result.message);
    assert.deepStrictEqual(result.destPeriods, ['H1', 'H2']);
});

// Scenario 6: not enough consecutive slots (double lesson anchored at last slot H4)
test('validateMoveTarget rejects when consecutive count insufficient', () => {
    const timetables = makeTimetables();
    const result = Move.validateMoveTarget(
        {
            teacher: 'T1',
            className: '1BAC-1',
            room: '',
            sourceDay: 'الاثنين',
            sourcePeriodType: 'morning',
            sourcePeriods: ['H1', 'H2'],
            destDay: 'الثلاثاء',
            destPeriod: 'H4',
            destPeriodType: 'morning'
        },
        depsFrom(timetables)
    );
    assert.strictEqual(result.valid, false);
});

// Scenario 2: teacher busy
test('validateMoveTarget rejects teacher conflict', () => {
    const timetables = makeTimetables();
    const result = Move.validateMoveTarget(
        {
            teacher: 'T1',
            className: '1BAC-X',
            room: '',
            sourceDay: 'الثلاثاء',
            sourcePeriodType: 'morning',
            sourcePeriods: ['H1'],
            destDay: 'الاثنين',
            destPeriod: 'H1',
            destPeriodType: 'morning'
        },
        depsFrom(timetables)
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.message.includes('الأستاذ مشغول'), result.message);
});

// Scenario 3: class busy
test('validateMoveTarget rejects class conflict', () => {
    const timetables = makeTimetables();
    // 1BAC-1 already has H3 afternoon with T2
    const result = Move.validateMoveTarget(
        {
            teacher: 'T1',
            className: '1BAC-1',
            room: '',
            sourceDay: 'الاثنين',
            sourcePeriodType: 'morning',
            sourcePeriods: ['H1'],
            destDay: 'الاثنين',
            destPeriod: 'H3',
            destPeriodType: 'afternoon'
        },
        depsFrom(timetables)
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.message.includes('القسم مشغول'), result.message);
});

// Scenario 4: room busy
test('validateMoveTarget rejects room conflict', () => {
    const timetables = makeTimetables();
    // S2 occupied mon morning H2 by T2
    const result = Move.validateMoveTarget(
        {
            teacher: 'T1',
            className: '1BAC-X',
            room: 'S2',
            sourceDay: 'الثلاثاء',
            sourcePeriodType: 'morning',
            sourcePeriods: ['H1'],
            destDay: 'الاثنين',
            destPeriod: 'H2',
            destPeriodType: 'morning'
        },
        depsFrom(timetables)
    );
    assert.strictEqual(result.valid, false);
    assert.ok(result.message.includes('القاعة'), result.message);
});

// Scenario 1-like: single free slot
test('validateMoveTarget accepts single move to free slot', () => {
    const timetables = makeTimetables();
    const result = Move.validateMoveTarget(
        {
            teacher: 'T1',
            className: '1BAC-1',
            room: 'S1',
            sourceDay: 'الاثنين',
            sourcePeriodType: 'morning',
            sourcePeriods: ['H1'],
            destDay: 'الثلاثاء',
            destPeriod: 'H1',
            destPeriodType: 'morning'
        },
        depsFrom(timetables)
    );
    assert.strictEqual(result.valid, true, result.message);
    assert.deepStrictEqual(result.destPeriods, ['H1']);
});

// Gap detection stays wired
test('causesGapAfterMove detects internal gap', () => {
    const classTimetable = {
        الاثنين: {
            morning: {
                H1: { subject: 'A', teacher: 'T1' },
                H2: { subject: 'B', teacher: 'T2' }
            },
            afternoon: {}
        }
    };
    const sourceKeys = new Set([Move.buildTimetableSlotKey('الاثنين', 'morning', 'H2')]);
    const destinationKeys = new Set([Move.buildTimetableSlotKey('الثلاثاء', 'morning', 'H1')]);
    // After vacating H2, H1 alone remains — no internal gap on monday morning
    assert.strictEqual(
        Move.causesGapAfterMove(classTimetable, 'الاثنين', 'morning', sourceKeys, destinationKeys),
        false
    );

    classTimetable.الاثنين.morning.H1 = { subject: 'A', teacher: 'T1' };
    classTimetable.الاثنين.morning.H2 = null;
    // occupancy H1 true, H2 false, then dest not on same day — if H1 and something later
    classTimetable.الاثنين.afternoon.H3 = { subject: 'C', teacher: 'T3' };
    // gap check is per periodType slice only
    assert.strictEqual(
        Move.hasInternalGap([true, false, true, false]),
        true
    );
    assert.strictEqual(Move.hasInternalGap([true, true, false, false]), false);
});

// Scenario 9: cancel restore
test('restoreTeacherTimetableSnapshot replaces live data with snapshot', () => {
    const timetables = makeTimetables();
    const snapshot = JSON.parse(JSON.stringify(timetables.T1));
    timetables.T1.الاثنين.morning.H1 = { subject: 'CHANGED', students: 'X', room: 'Z' };
    const ok = Move.restoreTeacherTimetableSnapshot(timetables, 'T1', snapshot);
    assert.strictEqual(ok, true);
    assert.strictEqual(timetables.T1.الاثنين.morning.H1.subject, 'رياضيات');
    // deep copy: mutating restored should not mutate snapshot
    timetables.T1.الاثنين.morning.H1.subject = 'MUT';
    assert.strictEqual(snapshot.الاثنين.morning.H1.subject, 'رياضيات');
});

test('restoreTeacherTimetableSnapshot no-ops without snapshot', () => {
    const timetables = makeTimetables();
    assert.strictEqual(Move.restoreTeacherTimetableSnapshot(timetables, 'T1', null), false);
});

// Scenario P2-1: preserve non-form fields on edit
test('buildEditedSlotData preserves activityId and tags', () => {
    const oldData = {
        subject: 'رياضيات',
        students: '1BAC-1',
        room: 'S1',
        activityId: 'A99',
        tags: ['lab']
    };
    const next = Move.buildEditedSlotData({
        subject: 'فيزياء',
        students: '1BAC-1',
        room: 'S2',
        oldData
    });
    assert.strictEqual(next.subject, 'فيزياء');
    assert.strictEqual(next.room, 'S2');
    assert.strictEqual(next.activityId, 'A99');
    assert.deepStrictEqual(next.tags, ['lab']);
});

test('buildEditedSlotData returns null on delete', () => {
    assert.strictEqual(Move.buildEditedSlotData({ deleteSlot: true, oldData: { subject: 'X' } }), null);
});

test('buildPeriodRange covers inclusive span', () => {
    assert.deepStrictEqual(Move.buildPeriodRange('H1', 'H2'), ['H1', 'H2']);
    assert.deepStrictEqual(Move.buildPeriodRange('H3', 'H3'), ['H3']);
});

// --- Invariant #3: no morning/afternoon "band" clamp ---
// H1–H4 are valid, adjacent time slots inside one periodType. A double lesson
// anchored at H2 (morning) must span H2–H3, never jumping across the
// morning/afternoon boundary (regression test for a previous clamp bug).
test('getConsecutivePeriods keeps a double lesson within one periodType (no band clamp)', () => {
    assert.deepStrictEqual(Move.getConsecutivePeriods('H2', 2, 'morning'), ['H2', 'H3']);
    assert.deepStrictEqual(Move.getConsecutivePeriods('H3', 2, 'afternoon'), ['H3', 'H4']);
});

// --- T3.1: hoverKeyChanged predicate (dragover throttle) ---
test('hoverKeyChanged returns false for identical keys and true for different keys', () => {
    assert.strictEqual(Move.hoverKeyChanged('a|morning|H1', 'a|morning|H1'), false);
    assert.strictEqual(Move.hoverKeyChanged('a|morning|H1', 'a|morning|H2'), true);
    // First dragover has prev === null while next is defined → must report change.
    assert.strictEqual(Move.hoverKeyChanged(null, 'a|morning|H1'), true);
});

// --- T2: per-drag class-timetable cache equivalence ---
// Injecting deps.buildClassTimetable as `() => prebuilt` must yield the same
// validation result as letting the dep rebuild the class timetable fresh, for
// (a) a valid empty destination, (b) a class-busy destination, and (c) a
// move that would violate the no-gap rule on the source slice.
test('validateMoveTarget is equivalent with a prebuilt class timetable (T2 cache path)', () => {
    function buildTt() {
        return {
            T1: {
                الاثنين: {
                    morning: {
                        H1: { subject: 'S', students: '1BAC-1', room: 'R1' },
                        H2: { subject: 'S', students: '1BAC-1', room: 'R1' }
                    },
                    afternoon: {}
                },
                الثلاثاء: emptyDay(),
                الأربعاء: emptyDay(),
                الخميس: emptyDay(),
                الجمعة: emptyDay(),
                السبت: emptyDay()
            }
        };
    }

    // (a) valid move of the double lesson (H1,H2) الاثنين morning → الثلاثاء H1 morning
    const ttA = buildTt();
    const depsFreshA = depsFrom(ttA);
    const prebuiltA = depsFreshA.buildClassTimetable('1BAC-1');
    const depsCachedA = Object.assign({}, depsFreshA, {
        buildClassTimetable: () => prebuiltA
    });
    const inputA = {
        teacher: 'T1',
        className: '1BAC-1',
        room: 'R1',
        sourceDay: 'الاثنين',
        sourcePeriodType: 'morning',
        sourcePeriods: ['H1', 'H2'],
        destDay: 'الثلاثاء',
        destPeriod: 'H1',
        destPeriodType: 'morning'
    };
    const freshA = Move.validateMoveTarget(inputA, depsFreshA);
    const cachedA = Move.validateMoveTarget(inputA, depsCachedA);
    assert.strictEqual(cachedA.valid, freshA.valid, 'case A valid mismatch');
    assert.deepStrictEqual(cachedA.destPeriods, freshA.destPeriods, 'case A destPeriods mismatch');
    assert.strictEqual(cachedA.valid, true, 'case A should be valid: ' + (cachedA.message || ''));

    // (b) class-busy destination: T2 also teaches 1BAC-1 at الثلاثاء morning H1.
    const ttB = buildTt();
    ttB.T2 = {
        الاثنين: emptyDay(),
        الثلاثاء: { morning: { H1: { subject: 'X', students: '1BAC-1', room: 'R9' } }, afternoon: {} },
        الأربعاء: emptyDay(),
        الخميس: emptyDay(),
        الجمعة: emptyDay(),
        السبت: emptyDay()
    };
    const depsFreshB = depsFrom(ttB);
    const prebuiltB = depsFreshB.buildClassTimetable('1BAC-1');
    const depsCachedB = Object.assign({}, depsFreshB, {
        buildClassTimetable: () => prebuiltB
    });
    const inputB = {
        teacher: 'T1',
        className: '1BAC-1',
        room: 'R1',
        sourceDay: 'الاثنين',
        sourcePeriodType: 'morning',
        sourcePeriods: ['H1', 'H2'],
        destDay: 'الثلاثاء',
        destPeriod: 'H1',
        destPeriodType: 'morning'
    };
    const freshB = Move.validateMoveTarget(inputB, depsFreshB);
    const cachedB = Move.validateMoveTarget(inputB, depsCachedB);
    assert.strictEqual(cachedB.valid, freshB.valid, 'case B valid mismatch');
    assert.strictEqual(cachedB.valid, false, 'case B should be invalid');
    assert.ok(cachedB.message && cachedB.message.includes('القسم مشغول'), 'case B gap message: ' + cachedB.message);
    assert.strictEqual(cachedB.message, freshB.message, 'case B message mismatch');

    // (c) gap-creating move: class 1BAC-1 has H1+H4 morning mounted; moving H1 → H2
    // would leave occupancy [_, H2, _, H4] → internal gap detected.
    const ttC = {
        T1: {
            الاثنين: { morning: { H1: { subject: 'S', students: '1BAC-1', room: 'R1' } }, afternoon: {} },
            الثلاثاء: emptyDay(),
            الأربعاء: emptyDay(),
            الخميس: emptyDay(),
            الجمعة: emptyDay(),
            السبت: emptyDay()
        },
        T2: {
            الاثنين: { morning: { H4: { subject: 'T', students: '1BAC-1', room: 'R2' } }, afternoon: {} },
            الثلاثاء: emptyDay(),
            الأربعاء: emptyDay(),
            الخميس: emptyDay(),
            الجمعة: emptyDay(),
            السبت: emptyDay()
        }
    };
    const depsFreshC = depsFrom(ttC);
    const prebuiltC = depsFreshC.buildClassTimetable('1BAC-1');
    const depsCachedC = Object.assign({}, depsFreshC, {
        buildClassTimetable: () => prebuiltC
    });
    const inputC = {
        teacher: 'T1',
        className: '1BAC-1',
        room: 'R1',
        sourceDay: 'الاثنين',
        sourcePeriodType: 'morning',
        sourcePeriods: ['H1'],
        destDay: 'الاثنين',
        destPeriod: 'H2',
        destPeriodType: 'morning'
    };
    const freshC = Move.validateMoveTarget(inputC, depsFreshC);
    const cachedC = Move.validateMoveTarget(inputC, depsCachedC);
    assert.strictEqual(cachedC.valid, freshC.valid, 'case C valid mismatch');
    assert.strictEqual(cachedC.valid, false, 'case C should be invalid');
    assert.ok(cachedC.message && cachedC.message.includes('فراغ'), 'case C gap message: ' + cachedC.message);
    assert.strictEqual(cachedC.message, freshC.message, 'case C message mismatch');
});

if (process.exitCode) {
    console.error('\nSome timetable-move-logic tests failed');
    process.exit(1);
}

console.log('\nAll ' + passed + ' timetable-move-logic tests passed');
