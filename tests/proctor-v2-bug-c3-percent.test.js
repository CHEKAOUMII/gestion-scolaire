'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fixtures = require('./fixtures/proctor-v2-bug-fixtures');

function loadPreFixV2() {
  const source = fs.readFileSync(
    path.join(__dirname, '__snapshots__', 'proctor-distribution-v2.pre-fix.js'),
    'utf8'
  );
  const sandbox = {
    window: {},
    Math, console, Infinity, isFinite, isNaN,
    Set, Map, Object, Array, String, Number, Error, Boolean, Date,
    parseInt, parseFloat, TypeError, RangeError, NaN
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ProctorDistributionV2;
}

function buildEightGuardSingleSessionInput() {
  const input = fixtures.buildC3PercentInput();
  input.scheduleEntries = [fixtures.makeEntry({
    day: 'الأول',
    period: 'صباحا',
    session: 'الحصة الأولى',
    dateDay: 15,
    dateMonth: 4,
    dateYear: 2026,
    subject: 'الرياضيات'
  })];
  input.options.roomsList = [];
  for (let i = 1; i <= 8; i++) {
    input.options.roomsList.push(fixtures.makeRoom('R' + i, 'الثانية بكالوريا'));
  }
  input.reservesConfig = { mode: 'percent', percent: 25, fixed: 0 };
  return input;
}

const V2 = loadPreFixV2();
const input = buildEightGuardSingleSessionInput();
const output = V2.run(input);
const badRows = (output.result || []).filter(function (row) {
  return (row.reserves || []).length !== 2;
});

assert.ok(badRows.length > 0,
  'Expected pre-fix C3 percent counterexample where reserves length is not 2');
assert.ok(badRows.every(function (row) { return (row.reserves || []).length === 0; }),
  'Expected pre-fix v2 to emit empty reserves arrays');

console.log('[pass] C3 percent pre-fix reserves bug surfaced: ' + badRows.length + ' rows emit 0 reserves instead of 2');
