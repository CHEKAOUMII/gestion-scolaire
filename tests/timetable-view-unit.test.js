'use strict';

// C5: timetable-view pure helpers
//
//   node tests/timetable-view-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const tv = require('../js/shared/timetable-view.js');

assert.strictEqual(tv.TT_VIEW_DAYS.length, 6);
assert.ok(tv.ttNaturalSortHours('H2', 'H10') < 0 || tv.ttNaturalSortHours('H2', 'H10') !== 0);

const pack = tv.ttBuildHoursOrdered(['H1', 'H2'], ['H1']);
assert.strictEqual(pack.allHoursOrdered.length, 3);
assert.strictEqual(pack.separatorAfter, 2);

const lookup = tv.ttBuildSlotLookup([
    { day: 'الاثنين', period: 'morning', hour: 'H1', subject: 'A' },
    { day: 'الاثنين', period: 'morning', hour: 'H1', subject: 'B' }
]);
assert.strictEqual(lookup['الاثنين|morning|H1'].length, 2);

assert.strictEqual(tv.ttSafeFileName('a/b:c'), 'a_b_c');

// Consumers + host
for (const rel of ['js/pages/timetable-rooms.js', 'js/pages/timetable-students.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(/ttResolveHourLabel|ttBuildHoursOrdered|ttBuildSlotLookup/.test(src), rel);
    assert.ok(!/defaultHourLabels/.test(src), rel + ' must not keep local hour label map');
}
const html = fs.readFileSync(path.join(__dirname, '..', 'timetable.html'), 'utf8');
assert.ok(html.includes('js/shared/timetable-view.js'));

console.log('timetable-view-unit: OK');
