'use strict';

// CH2: characterization tests for ttResolveTeacherKeys / ttNormalizeName
// (js/shared/timetable-utils.js). Documents KD20 behavior improvement for
// exam-papers (ID + meta + partial) over name-only matching.
//
//   node tests/timetable-resolver-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadTimetableUtils() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'timetable-utils.js'), 'utf8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(
        src +
            '\n;this.ttNormalizeName = ttNormalizeName;' +
            '\n;this.ttResolveTeacherKeys = ttResolveTeacherKeys;' +
            '\n;this.ttGetStoredTeacherEntries = ttGetStoredTeacherEntries;',
        sandbox
    );
    return sandbox;
}

const { ttNormalizeName, ttResolveTeacherKeys } = loadTimetableUtils();

// --- ttNormalizeName ---
assert.strictEqual(ttNormalizeName('أحمد_بن علي'), ttNormalizeName('أحمد بن علي'));
assert.ok(ttNormalizeName('الأستاذ') !== undefined);
assert.strictEqual(ttNormalizeName('  Foo  Bar '), ttNormalizeName('Foo Bar'));

// --- Fixture timetable ---
const data = {
    timetables: {
        'tafwij:أحمد_بن_علي': {
            الاثنين: {
                morning: { H1: { subject: 'الرياضيات', students: '1BACSE-1', room: 'A1' } }
            }
        },
        other_teacher: {
            الاثنين: {
                morning: { H1: { subject: 'الفيزياء والكيمياء', students: '2BACSM-1', room: 'B1' } }
            }
        }
    },
    teacherMetaByKey: {
        'tafwij:أحمد_بن_علي': {
            teacherId: 42,
            teacherName: 'أحمد بن علي',
            displayName: 'أحمد بن علي',
            sourceName: 'أحمد_بن_علي'
        },
        other_teacher: {
            teacherId: 7,
            teacherName: 'سارة العلمي',
            displayName: 'سارة العلمي'
        }
    },
    teachers: []
};

const KEY_AHMAD = 'tafwij:أحمد_بن_علي';
function asArray(value) {
    return Array.from(value || []).map(String);
}
function assertKeys(actual, expectedKey) {
    const keys = asArray(actual);
    assert.strictEqual(keys.length, 1, 'expected single key, got ' + JSON.stringify(keys));
    assert.strictEqual(keys[0], expectedKey);
}

// Phase 1: match by ID (even if name is wrong/empty)
assertKeys(ttResolveTeacherKeys(data, 42, ''), KEY_AHMAD);
assertKeys(ttResolveTeacherKeys(data, 42, 'wrong name'), KEY_AHMAD);

// Phase 2: exact name
assertKeys(ttResolveTeacherKeys(data, null, 'أحمد بن علي'), KEY_AHMAD);

// Phase 3: normalized (underscore / spacing)
assertKeys(ttResolveTeacherKeys(data, null, 'أحمد_بن_علي'), KEY_AHMAD);

// Phase 4: partial
const partial = asArray(ttResolveTeacherKeys(data, null, 'أحمد'));
assert.ok(partial.includes(KEY_AHMAD), 'partial name should resolve: ' + JSON.stringify(partial));

// No false positive for empty
assert.strictEqual(asArray(ttResolveTeacherKeys(data, null, '')).length, 0);
assert.strictEqual(asArray(ttResolveTeacherKeys(data, null, null)).length, 0);

// Consumers no longer re-implement full resolver
const consumers = {
    'js/pages/compensation-tracking.js': {
        ban: [/function\s+resolveTeacherTimetableKeys\b/, /function\s+normalizeStoredTeacherMeta\b/],
        require: [/ttResolveTeacherKeys/, /ttGetStoredTeacherEntries|ttNormalizeName/]
    },
    'js/pages/exam-papers.js': {
        ban: [/function\s+normName\b/],
        require: [/ttResolveTeacherKeys/]
    }
};
for (const [rel, rules] of Object.entries(consumers)) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    for (const re of rules.ban) {
        assert.ok(!re.test(src), rel + ' must not match ' + re);
    }
    for (const re of rules.require) {
        assert.ok(re.test(src), rel + ' must use ' + re);
    }
}

// HTML hosts load shared util
for (const rel of ['compensation-tracking.html', 'exam-papers.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(html.includes('js/shared/timetable-utils.js'), rel + ' must load timetable-utils.js');
}

console.log('timetable-resolver-unit: OK');
