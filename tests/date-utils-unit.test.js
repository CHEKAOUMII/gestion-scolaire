'use strict';

// CH4: unit/snapshot tests for js/shared/date-utils.js
//
//   node tests/date-utils-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const api = require('../js/shared/date-utils.js');
const {
    todayStr,
    daysAgoISO,
    thirtyDaysAgo,
    getNextMondayISO,
    formatDateDMY,
    formatDateShort,
    formatDateAr,
    MOROCCAN_MONTHS
} = api;

// --- todayStr / daysAgoISO shape ---
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(todayStr()));
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(thirtyDaysAgo()));
assert.strictEqual(thirtyDaysAgo(), daysAgoISO(30));

// --- getNextMondayISO: always Monday, never today if today is Monday ---
const mon = getNextMondayISO();
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(mon));
const monDate = new Date(mon + 'T00:00:00');
assert.strictEqual(monDate.getDay(), 1, 'must be Monday');
const today = new Date();
today.setHours(0, 0, 0, 0);
assert.ok(monDate.getTime() > today.getTime(), 'next Monday is strictly in the future');

// --- formatDateDMY (exams-proctors / staff-attendance) ---
assert.strictEqual(formatDateDMY(''), '—');
assert.strictEqual(formatDateDMY(null), '—');
assert.strictEqual(formatDateDMY(''), '—');
assert.strictEqual(formatDateDMY('', ''), ''); // custom empty token
assert.strictEqual(formatDateDMY('2026-03-15'), '15/03/2026');

// --- formatDateShort / DM (compensation) ---
assert.strictEqual(formatDateShort(''), '—');
assert.strictEqual(formatDateShort('2026-03-15'), '15/03');

// --- formatDateAr styles ---
assert.strictEqual(formatDateAr('2026-03-15'), '15/03/2026'); // default dmy
assert.strictEqual(formatDateAr('2026-03-15', 'dmy'), '15/03/2026');
assert.strictEqual(formatDateAr('2026-03-15', 'dm'), '15/03');
assert.strictEqual(formatDateAr('', 'moroccan'), '');
assert.strictEqual(formatDateAr('2026-03-15', 'moroccan'), '15 مارس 2026');
assert.strictEqual(MOROCCAN_MONTHS[2], 'مارس');
assert.strictEqual(MOROCCAN_MONTHS[6], 'يوليوز');

// locale styles: non-empty string containing day numeral (environment-dependent text)
const shortLoc = formatDateAr('2026-03-15', 'locale-short');
const longLoc = formatDateAr('2026-03-15', 'locale-long');
assert.ok(typeof shortLoc === 'string' && shortLoc.length > 0, 'locale-short');
assert.ok(typeof longLoc === 'string' && longLoc.length > 0, 'locale-long');
assert.ok(longLoc.length >= shortLoc.length || longLoc.includes('2026'), 'locale-long richer');

// --- Consumers must not re-define shared helpers (except thin aliases) ---
const noLocalDefs = {
    'js/pages/compensation-tracking.js': [
        /function\s+todayStr\b/,
        /function\s+formatDateShort\b/,
        /function\s+thirtyDaysAgo\b/,
        /function\s+formatDateAr\b/
    ],
    'js/pages/staff-daily-report.js': [/function\s+todayStr\b/, /function\s+formatDateAr\b/],
    'js/pages/staff-attendance.js': [/function\s+todayStr\b/],
    'js/pages/exams-proctors.js': [/function\s+formatDateAr\b/],
    'js/pages/absence-weekly.js': [/function\s+getNextMondayISO\b/]
};
for (const [rel, bans] of Object.entries(noLocalDefs)) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    for (const re of bans) {
        assert.ok(!re.test(src), rel + ' must not define ' + re);
    }
}

// exams-schedule may keep a thin wrapper that delegates to window.formatDateAr(..., 'moroccan')
const es = fs.readFileSync(path.join(__dirname, '..', 'js/pages/exams-schedule.js'), 'utf8');
assert.ok(/moroccan/.test(es), 'exams-schedule must request moroccan style');
assert.ok(
    !/const\s+months\s*=\s*\[\s*'يناير'/.test(es),
    'exams-schedule must not re-declare Moroccan months array for formatDateAr'
);

// HTML hosts
for (const rel of [
    'compensation-tracking.html',
    'staff-daily-report.html',
    'staff-attendance.html',
    'exams-proctors.html',
    'exams-schedule.html',
    'absence-weekly.html'
]) {
    const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(html.includes('js/shared/date-utils.js'), rel + ' must load date-utils.js');
}

console.log('date-utils-unit: OK');
