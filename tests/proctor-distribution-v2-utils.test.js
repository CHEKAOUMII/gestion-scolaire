/**
 * Unit tests for proctor-distribution-v2.js — Task 1.2 utilities
 * Tests: computeBounds, load state management, halfdayKey computation
 */
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// Load the module in a simulated browser context
const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'),
  'utf8'
);

const sandbox = { window: {}, Math, console, Infinity, Set, Object, Array, String, Number, Error };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const internals = sandbox.window.ProctorDistributionV2._internals;

function testComputeBounds() {
  // Basic case: 10 tasks, 2 fixed, 4 teachers → floor((10-2)/4) = 2, upper = 3
  const r1 = internals.computeBounds(10, 2, 4);
  assert.strictEqual(r1.lowerBound, 2, 'lowerBound should be floor((10-2)/4) = 2');
  assert.strictEqual(r1.upperBound, 3, 'upperBound should be lowerBound + 1 = 3');

  // Exact division: 12 tasks, 0 fixed, 4 teachers → floor(12/4) = 3, upper = 4
  const r2 = internals.computeBounds(12, 0, 4);
  assert.strictEqual(r2.lowerBound, 3, 'lowerBound should be 3 for exact division');
  assert.strictEqual(r2.upperBound, 4, 'upperBound should be 4');

  // Zero eligible teachers → safe fallback
  const r3 = internals.computeBounds(10, 0, 0);
  assert.strictEqual(r3.lowerBound, 0, 'lowerBound should be 0 when no eligible teachers');
  assert.strictEqual(r3.upperBound, 1, 'upperBound should be 1 when no eligible teachers');

  // All tasks are fixed: 5 tasks, 5 fixed, 3 teachers → floor(0/3) = 0
  const r4 = internals.computeBounds(5, 5, 3);
  assert.strictEqual(r4.lowerBound, 0, 'lowerBound should be 0 when all tasks are fixed');
  assert.strictEqual(r4.upperBound, 1, 'upperBound should be 1');

  // Large numbers
  const r5 = internals.computeBounds(100, 10, 30);
  assert.strictEqual(r5.lowerBound, 3, 'lowerBound should be floor(90/30) = 3');
  assert.strictEqual(r5.upperBound, 4, 'upperBound should be 4');

  // Single teacher
  const r6 = internals.computeBounds(7, 2, 1);
  assert.strictEqual(r6.lowerBound, 5, 'lowerBound should be 5 for single teacher');
  assert.strictEqual(r6.upperBound, 6, 'upperBound should be 6');

  console.log('  [pass] computeBounds');
}

function testHalfdayKey() {
  // Standard morning entry
  const entry1 = { date_year: '2026', date_month: '3', date_day: '15', period: 'صباحا' };
  assert.strictEqual(internals.computeHalfdayKey(entry1), '2026-03-15|صباحا', 'Morning halfday key');

  // Standard afternoon entry
  const entry2 = { date_year: '2026', date_month: '11', date_day: '5', period: 'مساء' };
  assert.strictEqual(internals.computeHalfdayKey(entry2), '2026-11-05|مساء', 'Afternoon halfday key');

  // Default period when missing
  const entry3 = { date_year: '2026', date_month: '1', date_day: '20' };
  assert.strictEqual(internals.computeHalfdayKey(entry3), '2026-01-20|صباحا', 'Default period should be صباحا');

  // Padding single-digit month and day
  const entry4 = { date_year: '2025', date_month: '6', date_day: '9', period: 'مساء' };
  assert.strictEqual(internals.computeHalfdayKey(entry4), '2025-06-09|مساء', 'Should pad month and day');

  // Already padded values
  const entry5 = { date_year: '2025', date_month: '12', date_day: '25', period: 'صباحا' };
  assert.strictEqual(internals.computeHalfdayKey(entry5), '2025-12-25|صباحا', 'Already padded values');

  console.log('  [pass] computeHalfdayKey');
}

function testGetScheduleDateKey() {
  const entry = { date_year: '2026', date_month: '3', date_day: '7' };
  assert.strictEqual(internals.getScheduleDateKey(entry), '2026-03-07', 'Date key format YYYY-MM-DD');

  // Missing parts
  const partial = { date_year: '2026', date_month: '', date_day: '' };
  assert.strictEqual(internals.getScheduleDateKey(partial), '2026', 'Only year when month/day empty');

  console.log('  [pass] getScheduleDateKey');
}

function testLoadStateCreation() {
  const state = internals.createLoadState();
  assert.strictEqual(Object.keys(state).length, 0, 'createLoadState returns empty object');
  assert.strictEqual(typeof state, 'object', 'createLoadState returns an object');

  console.log('  [pass] createLoadState');
}

function testGetTeacherLoad() {
  const state = internals.createLoadState();
  const load = internals.getTeacherLoad(state, 'teacher_1');

  assert.strictEqual(load.teacherName, '', 'Default teacherName is empty');
  assert.strictEqual(load.guardCount, 0, 'Default guardCount is 0');
  assert.strictEqual(load.reserveCount, 0, 'Default reserveCount is 0');
  assert.strictEqual(load.dutyCount, 0, 'Default dutyCount is 0');
  assert.strictEqual(load.morningCount, 0, 'Default morningCount is 0');
  assert.strictEqual(load.afternoonCount, 0, 'Default afternoonCount is 0');
  assert.ok(load.guardHalfdays instanceof Set, 'guardHalfdays is a Set');
  assert.ok(load.reserveHalfdays instanceof Set, 'reserveHalfdays is a Set');
  assert.ok(load.dutyHalfdays instanceof Set, 'dutyHalfdays is a Set');

  // Same reference on second call
  const load2 = internals.getTeacherLoad(state, 'teacher_1');
  assert.strictEqual(load, load2, 'Returns same reference for same key');

  console.log('  [pass] getTeacherLoad');
}

function testAddGuardLoad() {
  const state = internals.createLoadState();

  // Add morning guard
  const added = internals.addGuardLoad(state, 'teacher_1', '2026-03-15|صباحا', 'أحمد');
  assert.strictEqual(added, true, 'First guard add returns true');
  assert.strictEqual(state['teacher_1'].guardCount, 1, 'guardCount incremented');
  assert.strictEqual(state['teacher_1'].morningCount, 1, 'morningCount incremented');
  assert.strictEqual(state['teacher_1'].afternoonCount, 0, 'afternoonCount unchanged');
  assert.strictEqual(state['teacher_1'].teacherName, 'أحمد', 'teacherName set');

  // Add afternoon guard
  internals.addGuardLoad(state, 'teacher_1', '2026-03-15|مساء', 'أحمد');
  assert.strictEqual(state['teacher_1'].guardCount, 2, 'guardCount incremented for afternoon');
  assert.strictEqual(state['teacher_1'].afternoonCount, 1, 'afternoonCount incremented');

  // Duplicate halfday — should not increment
  const dup = internals.addGuardLoad(state, 'teacher_1', '2026-03-15|صباحا', 'أحمد');
  assert.strictEqual(dup, false, 'Duplicate halfday returns false');
  assert.strictEqual(state['teacher_1'].guardCount, 2, 'guardCount not incremented for duplicate');

  // Invalid inputs
  assert.strictEqual(internals.addGuardLoad(state, '', '2026-03-15|صباحا', 'x'), false, 'Empty key returns false');
  assert.strictEqual(internals.addGuardLoad(state, 'teacher_1', '', 'x'), false, 'Empty halfday returns false');

  console.log('  [pass] addGuardLoad');
}

function testAddReserveLoad() {
  const state = internals.createLoadState();

  const added = internals.addReserveLoad(state, 'teacher_2', '2026-03-15|صباحا', 'فاطمة');
  assert.strictEqual(added, true, 'First reserve add returns true');
  assert.strictEqual(state['teacher_2'].reserveCount, 1, 'reserveCount incremented');
  assert.strictEqual(state['teacher_2'].teacherName, 'فاطمة', 'teacherName set');

  // Duplicate
  const dup = internals.addReserveLoad(state, 'teacher_2', '2026-03-15|صباحا', 'فاطمة');
  assert.strictEqual(dup, false, 'Duplicate reserve returns false');
  assert.strictEqual(state['teacher_2'].reserveCount, 1, 'reserveCount not incremented');

  console.log('  [pass] addReserveLoad');
}

function testAddDutyLoad() {
  const state = internals.createLoadState();

  const added = internals.addDutyLoad(state, 'teacher_3', '2026-03-16|مساء', 'محمد');
  assert.strictEqual(added, true, 'First duty add returns true');
  assert.strictEqual(state['teacher_3'].dutyCount, 1, 'dutyCount incremented');
  assert.strictEqual(state['teacher_3'].teacherName, 'محمد', 'teacherName set');

  // Duplicate
  const dup = internals.addDutyLoad(state, 'teacher_3', '2026-03-16|مساء', 'محمد');
  assert.strictEqual(dup, false, 'Duplicate duty returns false');
  assert.strictEqual(state['teacher_3'].dutyCount, 1, 'dutyCount not incremented');

  console.log('  [pass] addDutyLoad');
}

function testGetGuardCount() {
  const state = internals.createLoadState();
  internals.addGuardLoad(state, 'teacher_1', '2026-03-15|صباحا', 'أحمد');
  internals.addGuardLoad(state, 'teacher_1', '2026-03-15|مساء', 'أحمد');

  assert.strictEqual(internals.getGuardCount(state, 'teacher_1'), 2, 'Guard count is 2');
  assert.strictEqual(internals.getGuardCount(state, 'nonexistent'), 0, 'Nonexistent teacher has 0 guards');

  console.log('  [pass] getGuardCount');
}

function testGetPrimaryLoad() {
  const state = internals.createLoadState();
  internals.addGuardLoad(state, 'teacher_1', '2026-03-15|صباحا', 'أحمد');
  internals.addDutyLoad(state, 'teacher_1', '2026-03-16|صباحا', 'أحمد');

  assert.strictEqual(internals.getPrimaryLoad(state, 'teacher_1'), 2, 'Primary load = guard + duty');
  assert.strictEqual(internals.getPrimaryLoad(state, 'nonexistent'), 0, 'Nonexistent teacher has 0 primary load');

  console.log('  [pass] getPrimaryLoad');
}

function testGetFinalLoad() {
  const state = internals.createLoadState();
  internals.addGuardLoad(state, 'teacher_1', '2026-03-15|صباحا', 'أحمد');
  internals.addReserveLoad(state, 'teacher_1', '2026-03-15|مساء', 'أحمد');
  internals.addDutyLoad(state, 'teacher_1', '2026-03-16|صباحا', 'أحمد');

  assert.strictEqual(internals.getFinalLoad(state, 'teacher_1'), 3, 'Final load = guard + reserve + duty');
  assert.strictEqual(internals.getFinalLoad(state, 'nonexistent'), 0, 'Nonexistent teacher has 0 final load');

  console.log('  [pass] getFinalLoad');
}

function testComputeLoadStats() {
  // Empty state
  const emptyStats = internals.computeLoadStats({});
  assert.strictEqual(emptyStats.std, 0, 'Empty state std is 0');
  assert.strictEqual(emptyStats.min, 0, 'Empty state min is 0');
  assert.strictEqual(emptyStats.max, 0, 'Empty state max is 0');
  assert.strictEqual(emptyStats.giniCoefficient, 0, 'Empty state gini is 0');

  // Uniform distribution: all teachers have same load
  const state = internals.createLoadState();
  internals.addGuardLoad(state, 't1', '2026-03-15|صباحا', 'A');
  internals.addGuardLoad(state, 't2', '2026-03-15|مساء', 'B');
  internals.addGuardLoad(state, 't3', '2026-03-16|صباحا', 'C');

  const uniformStats = internals.computeLoadStats(state);
  assert.strictEqual(uniformStats.min, 1, 'Uniform min is 1');
  assert.strictEqual(uniformStats.max, 1, 'Uniform max is 1');
  assert.strictEqual(uniformStats.std, 0, 'Uniform std is 0');
  assert.strictEqual(uniformStats.giniCoefficient, 0, 'Uniform gini is 0');

  // Non-uniform distribution
  const state2 = internals.createLoadState();
  internals.addGuardLoad(state2, 't1', '2026-03-15|صباحا', 'A');
  internals.addGuardLoad(state2, 't1', '2026-03-15|مساء', 'A');
  internals.addGuardLoad(state2, 't1', '2026-03-16|صباحا', 'A');
  internals.addGuardLoad(state2, 't2', '2026-03-16|مساء', 'B');
  // t1 has 3 guards, t2 has 1 guard

  const stats2 = internals.computeLoadStats(state2);
  assert.strictEqual(stats2.min, 1, 'Non-uniform min is 1');
  assert.strictEqual(stats2.max, 3, 'Non-uniform max is 3');
  assert.ok(stats2.std > 0, 'Non-uniform std > 0');
  assert.ok(stats2.giniCoefficient > 0, 'Non-uniform gini > 0');
  assert.ok(stats2.giniCoefficient <= 1, 'Gini coefficient <= 1');

  // Verify std calculation: mean = 2, variance = ((3-2)^2 + (1-2)^2)/2 = 1, std = 1
  assert.strictEqual(stats2.std, 1, 'Std should be 1 for loads [3, 1]');

  // Verify gini: |3-3|+|3-1|+|1-3|+|1-1| = 4, gini = 4 / (2 * n^2 * mean) = 4 / (2*4*2) = 0.25
  assert.strictEqual(stats2.giniCoefficient, 0.25, 'Gini should be 0.25 for loads [3, 1]');

  console.log('  [pass] computeLoadStats');
}

function testIsMorningHalfday() {
  assert.strictEqual(internals.isMorningHalfday('2026-03-15|صباحا'), true, 'صباحا is morning');
  assert.strictEqual(internals.isMorningHalfday('2026-03-15|مساء'), false, 'مساء is not morning');
  assert.strictEqual(internals.isMorningHalfday('2026-03-15|'), false, 'Empty period is not morning');

  console.log('  [pass] isMorningHalfday');
}

function testBuildSeededPRNG() {
  // Deterministic: same seed produces same sequence
  const rng1 = internals.buildSeededPRNG(42);
  const rng2 = internals.buildSeededPRNG(42);
  const seq1 = [rng1(), rng1(), rng1()];
  const seq2 = [rng2(), rng2(), rng2()];
  assert.deepStrictEqual(seq1, seq2, 'Same seed produces same sequence');

  // Different seeds produce different sequences
  const rng3 = internals.buildSeededPRNG(123);
  const seq3 = [rng3(), rng3(), rng3()];
  assert.notDeepStrictEqual(seq1, seq3, 'Different seeds produce different sequences');

  // Values are in [0, 1)
  const rng4 = internals.buildSeededPRNG(999);
  for (let i = 0; i < 100; i++) {
    const val = rng4();
    assert.ok(val >= 0 && val < 1, `PRNG value ${val} should be in [0, 1)`);
  }

  console.log('  [pass] buildSeededPRNG');
}

function run() {
  console.log('[test] proctor-distribution-v2 utilities (Task 1.2)');
  testComputeBounds();
  testHalfdayKey();
  testGetScheduleDateKey();
  testLoadStateCreation();
  testGetTeacherLoad();
  testAddGuardLoad();
  testAddReserveLoad();
  testAddDutyLoad();
  testGetGuardCount();
  testGetPrimaryLoad();
  testGetFinalLoad();
  testComputeLoadStats();
  testIsMorningHalfday();
  testBuildSeededPRNG();
  console.log('[test] All Task 1.2 utility tests passed');
}

run();
