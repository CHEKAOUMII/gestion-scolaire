'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildC3FixedInput } = require('./fixtures/proctor-v2-bug-fixtures');

function loadV2() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'), 'utf8');
  const sandbox = { window: {}, Math, console, Infinity, isFinite, isNaN, Set, Map, Object, Array, String, Number, Error, Boolean, Date, parseInt, parseFloat, TypeError, RangeError, NaN };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ProctorDistributionV2;
}

const input = buildC3FixedInput();
input.exemptionsData = {
  'session|الأول|صباحا|الحصة الأولى': { C3F005: 'no' }
};
input.dutyData = {
  '2026-04-10|الأول|صباحا|الحصة الأولى|الرياضيات': { C3F006: true }
};
const output = loadV2().run(input);

for (const row of output.result || []) {
  const guardKeys = new Set(row.proctor_keys || []);
  for (const reserveKey of row.reserve_keys || []) {
    assert.ok(!guardKeys.has(reserveKey), 'reserve must not already be a guard in the same session');
    if (row.day === 'الأول' && row.period === 'صباحا' && row.session === 'الحصة الأولى') {
      assert.notStrictEqual(reserveKey, 'C3F005', 'exempt teacher must not be selected as reserve');
      assert.notStrictEqual(reserveKey, 'C3F006', 'duty teacher must not be selected as reserve');
    }
  }
}
console.log('[pass] P5 reserve eligibility property holds for guards/exemptions/duty');
