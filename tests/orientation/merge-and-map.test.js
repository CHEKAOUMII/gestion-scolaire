'use strict';

// node tests/orientation/merge-and-map.test.js

const assert = require('assert');
const path = require('path');

const {
    mapRow,
    mergeOrientationRow,
    pickText,
    pickNum,
    toNumberOrNull
} = require(path.join(__dirname, '..', '..', 'main', 'ipc', 'orientation.js'));

// ── pickText / pickNum ──────────────────────────────────────
assert.strictEqual(pickText('old', null), 'old');
assert.strictEqual(pickText('old', ''), 'old');
assert.strictEqual(pickText('old', '  '), 'old');
assert.strictEqual(pickText('old', 'new'), 'new');
assert.strictEqual(pickText(null, 'new'), 'new');

assert.strictEqual(pickNum(5, null), 5);
assert.strictEqual(pickNum(5, ''), 5);
assert.strictEqual(pickNum(5, 0), 0, 'zero is a valid average/rank');
assert.strictEqual(pickNum(null, 12.5), 12.5);

assert.strictEqual(toNumberOrNull('12,13'), 12.13);
assert.strictEqual(toNumberOrNull(' 14.5 '), 14.5);
assert.strictEqual(toNumberOrNull(''), null);
assert.strictEqual(toNumberOrNull(0), 0);

// ── mapRow Massar orientation ───────────────────────────────
const mappedOrient = mapRow({
    studentCode: 'g161055302',
    fullName: 'البكراوي اناس',
    currentLevel: 'الجذع المشترك العلمي – خيار فرنسية',
    className: 'TCSF-4',
    status: 'مصادق عليه',
    choices: [
        { order: 2, targetLevel: 'علوم فيزيائية' },
        { order: 1, targetLevel: 'علوم اقتصادية' }
    ]
});
assert.strictEqual(mappedOrient.student_code, 'G161055302');
assert.strictEqual(mappedOrient.full_name, 'البكراوي اناس');
assert.strictEqual(mappedOrient.section, 'TCSF-4');
assert.strictEqual(mappedOrient.origin_stream, 'الجذع المشترك العلمي – خيار فرنسية');
assert.strictEqual(mappedOrient.choice_1, 'علوم اقتصادية');
assert.strictEqual(mappedOrient.choice_2, 'علوم فيزيائية');
assert.strictEqual(mappedOrient.decision_status, 'مصادق عليه');

// ── mapRow Massar results ───────────────────────────────────
const mappedResults = mapRow({
    studentCode: 'D151013694',
    fullName: 'الغازي دعاء',
    className: 'TCLSH-5',
    average: '12,13',
    result: 'ينتقل',
    assignedLevel: 'الأولى باكالوريا الآداب و العلوم الإنسانية',
    resultCategory: 'ينتقل'
});
assert.strictEqual(mappedResults.student_code, 'D151013694');
assert.strictEqual(mappedResults.average, 12.13);
assert.strictEqual(mappedResults.decision_status, 'ينتقل');
assert.strictEqual(
    mappedResults.assigned_stream,
    'الأولى باكالوريا الآداب و العلوم الإنسانية'
);
// results without currentLevel: origin left null (context filled by renderer)
assert.strictEqual(mappedResults.origin_stream, null);

// ── merge: results after orientation keep choices ───────────
const existing = {
    student_code: 'G1',
    full_name: 'طالب',
    gender: 'ذكر',
    section: 'TCSF-1',
    level: 'جذع علمي',
    origin_stream: 'جذع علمي',
    choice_1: 'اقتصاد',
    choice_2: 'تجريبي',
    choice_3: null,
    assigned_stream: null,
    decision_status: 'مصادق عليه',
    average: null,
    rank_num: null,
    notes: 'طلب مسار: 1'
};

const incomingResults = mapRow({
    student_code: 'G1',
    full_name: 'طالب',
    section: 'TCSF-1',
    origin_stream: 'جذع علمي',
    average: '11,5',
    result: 'ينتقل',
    assignedLevel: 'أولى اقتصاد'
});

const { merged: m1, changedFields: ch1 } = mergeOrientationRow(existing, incomingResults);
assert.strictEqual(m1.choice_1, 'اقتصاد', 'choices preserved');
assert.strictEqual(m1.choice_2, 'تجريبي');
assert.strictEqual(m1.assigned_stream, 'أولى اقتصاد');
assert.strictEqual(m1.decision_status, 'ينتقل');
assert.strictEqual(m1.average, 11.5);
assert.strictEqual(m1.notes, 'طلب مسار: 1', 'notes not wiped by empty incoming');
assert.ok(ch1.includes('assigned_stream'));
assert.ok(ch1.includes('average'));
assert.ok(!ch1.includes('choice_1'));

// ── merge: orientation after results keep assigned ──────────
const existingResults = {
    student_code: 'G2',
    full_name: 'ب',
    origin_stream: 'جذع أدب',
    choice_1: null,
    choice_2: null,
    choice_3: null,
    assigned_stream: 'أولى آداب',
    decision_status: 'ينتقل',
    average: 12,
    notes: null
};
const incomingOrient = mapRow({
    student_code: 'G2',
    full_name: 'ب',
    origin_stream: 'جذع أدب',
    choice_1: 'آداب',
    choice_2: 'علوم',
    status: 'مصادق عليه'
});
const { merged: m2, changedFields: ch2 } = mergeOrientationRow(existingResults, incomingOrient);
assert.strictEqual(m2.assigned_stream, 'أولى آداب', 'assigned preserved');
assert.strictEqual(m2.average, 12, 'average preserved');
assert.strictEqual(m2.choice_1, 'آداب');
assert.strictEqual(m2.choice_2, 'علوم');
assert.ok(ch2.includes('choice_1'));

// ── merge: insert path ──────────────────────────────────────
const { merged: m3, changedFields: ch3 } = mergeOrientationRow(null, mappedOrient);
assert.strictEqual(m3.student_code, 'G161055302');
assert.deepStrictEqual(ch3, ['*']);

// ── merge: unchanged ────────────────────────────────────────
const { changedFields: ch4 } = mergeOrientationRow(existing, {
    student_code: 'G1',
    full_name: null,
    gender: null,
    section: null,
    level: null,
    origin_stream: 'جذع علمي',
    choice_1: null,
    choice_2: null,
    choice_3: null,
    assigned_stream: null,
    decision_status: null,
    average: null,
    rank_num: null,
    notes: null
});
assert.deepStrictEqual(ch4, [], 'empty incoming must not change existing');

// ── year on row mapped ──────────────────────────────────────
const withYear = mapRow({ student_code: 'X', origin_stream: 'A', schoolYear: '2024/2025' });
assert.strictEqual(withYear.school_year, '2024/2025');

console.log('orientation merge-and-map: OK');
