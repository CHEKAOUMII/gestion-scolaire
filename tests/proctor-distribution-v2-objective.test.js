/**
 * Unit tests for proctor-distribution-v2.js — Task 6.2
 * Tests: objectiveFunction, resolveWeights, WEIGHTS_PRESETS
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

const sandbox = { window: {}, Math, console, Infinity, isFinite, Set, Map, Object, Array, String, Number, Error, Date, Boolean, parseInt, isNaN };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const internals = sandbox.window.ProctorDistributionV2._internals;

// ============================================================
// WEIGHTS_PRESETS tests
// ============================================================

function testWeightsPresetsExist() {
  assert.ok(internals.WEIGHTS_PRESETS, 'WEIGHTS_PRESETS should exist');
  assert.strictEqual(typeof internals.WEIGHTS_PRESETS, 'object', 'WEIGHTS_PRESETS should be an object');

  // Three presets
  assert.ok(internals.WEIGHTS_PRESETS['توازن'], 'Preset "توازن" should exist');
  assert.ok(internals.WEIGHTS_PRESETS['احترام المجموعات'], 'Preset "احترام المجموعات" should exist');
  assert.ok(internals.WEIGHTS_PRESETS['تنوع القاعات'], 'Preset "تنوع القاعات" should exist');

  console.log('  [pass] WEIGHTS_PRESETS exist');
}

function testWeightsPresetsValues() {
  // "توازن" (Balance): α=3, β=1, γ=2
  const balance = internals.WEIGHTS_PRESETS['توازن'];
  assert.strictEqual(balance.alpha, 3, 'توازن alpha should be 3');
  assert.strictEqual(balance.beta, 1, 'توازن beta should be 1');
  assert.strictEqual(balance.gamma, 2, 'توازن gamma should be 2');

  // "احترام المجموعات" (Groups): α=1, β=1, γ=5
  const groups = internals.WEIGHTS_PRESETS['احترام المجموعات'];
  assert.strictEqual(groups.alpha, 1, 'احترام المجموعات alpha should be 1');
  assert.strictEqual(groups.beta, 1, 'احترام المجموعات beta should be 1');
  assert.strictEqual(groups.gamma, 5, 'احترام المجموعات gamma should be 5');

  // "تنوع القاعات" (Room Variety): α=1, β=4, γ=1
  const rooms = internals.WEIGHTS_PRESETS['تنوع القاعات'];
  assert.strictEqual(rooms.alpha, 1, 'تنوع القاعات alpha should be 1');
  assert.strictEqual(rooms.beta, 4, 'تنوع القاعات beta should be 4');
  assert.strictEqual(rooms.gamma, 1, 'تنوع القاعات gamma should be 1');

  console.log('  [pass] WEIGHTS_PRESETS values correct');
}

// ============================================================
// resolveWeights tests
// ============================================================

function testResolveWeightsWithPreset() {
  // "توازن" preset
  const r1 = internals.resolveWeights({ weightsPreset: 'توازن' });
  assert.strictEqual(r1.weights.alpha, 3, 'توازن alpha');
  assert.strictEqual(r1.weights.beta, 1, 'توازن beta');
  assert.strictEqual(r1.weights.gamma, 2, 'توازن gamma');
  assert.strictEqual(r1.presetName, 'توازن', 'Preset name should be توازن');

  // "احترام المجموعات" preset
  const r2 = internals.resolveWeights({ weightsPreset: 'احترام المجموعات' });
  assert.strictEqual(r2.weights.alpha, 1, 'احترام المجموعات alpha');
  assert.strictEqual(r2.weights.beta, 1, 'احترام المجموعات beta');
  assert.strictEqual(r2.weights.gamma, 5, 'احترام المجموعات gamma');
  assert.strictEqual(r2.presetName, 'احترام المجموعات', 'Preset name should be احترام المجموعات');

  // "تنوع القاعات" preset
  const r3 = internals.resolveWeights({ weightsPreset: 'تنوع القاعات' });
  assert.strictEqual(r3.weights.alpha, 1, 'تنوع القاعات alpha');
  assert.strictEqual(r3.weights.beta, 4, 'تنوع القاعات beta');
  assert.strictEqual(r3.weights.gamma, 1, 'تنوع القاعات gamma');
  assert.strictEqual(r3.presetName, 'تنوع القاعات', 'Preset name should be تنوع القاعات');

  console.log('  [pass] resolveWeights with presets');
}

function testResolveWeightsWithCustom() {
  // Custom weights override preset
  const input = {
    weightsPreset: 'توازن',
    customWeights: { alpha: 5, beta: 2, gamma: 3 }
  };
  const r = internals.resolveWeights(input);
  assert.strictEqual(r.weights.alpha, 5, 'Custom alpha');
  assert.strictEqual(r.weights.beta, 2, 'Custom beta');
  assert.strictEqual(r.weights.gamma, 3, 'Custom gamma');
  assert.strictEqual(r.presetName, 'custom', 'Preset name should be "custom"');

  console.log('  [pass] resolveWeights with custom weights');
}

function testResolveWeightsDefault() {
  // No preset, no custom → default to "توازن"
  const r = internals.resolveWeights({});
  assert.strictEqual(r.weights.alpha, 3, 'Default alpha');
  assert.strictEqual(r.weights.beta, 1, 'Default beta');
  assert.strictEqual(r.weights.gamma, 2, 'Default gamma');
  assert.strictEqual(r.presetName, 'توازن', 'Default preset name should be توازن');

  // Invalid preset name → default
  const r2 = internals.resolveWeights({ weightsPreset: 'nonexistent' });
  assert.strictEqual(r2.weights.alpha, 3, 'Invalid preset alpha falls back');
  assert.strictEqual(r2.weights.beta, 1, 'Invalid preset beta falls back');
  assert.strictEqual(r2.weights.gamma, 2, 'Invalid preset gamma falls back');
  assert.strictEqual(r2.presetName, 'توازن', 'Invalid preset name falls back to توازن');

  console.log('  [pass] resolveWeights default fallback');
}

function testResolveWeightsCustomRequiresAllFields() {
  // Partial custom weights (missing beta) → should NOT use custom, fall back to preset
  const input = {
    weightsPreset: 'تنوع القاعات',
    customWeights: { alpha: 5, gamma: 3 }
  };
  const r = internals.resolveWeights(input);
  assert.strictEqual(r.weights.alpha, 1, 'Partial custom falls back to preset alpha');
  assert.strictEqual(r.weights.beta, 4, 'Partial custom falls back to preset beta');
  assert.strictEqual(r.weights.gamma, 1, 'Partial custom falls back to preset gamma');
  assert.strictEqual(r.presetName, 'تنوع القاعات', 'Partial custom uses preset name');

  // customWeights is not an object
  const r2 = internals.resolveWeights({ customWeights: 'invalid', weightsPreset: 'توازن' });
  assert.strictEqual(r2.weights.alpha, 3, 'Non-object custom falls back alpha');
  assert.strictEqual(r2.weights.beta, 1, 'Non-object custom falls back beta');
  assert.strictEqual(r2.weights.gamma, 2, 'Non-object custom falls back gamma');

  console.log('  [pass] resolveWeights custom requires all fields');
}

// ============================================================
// objectiveFunction tests
// ============================================================

function testObjectiveFunctionEmpty() {
  // Empty assignments → 0
  const result = internals.objectiveFunction([], { alpha: 3, beta: 1, gamma: 2 }, {});
  assert.strictEqual(result, 0, 'Empty assignments should return 0');

  // Null/undefined assignments → 0
  const result2 = internals.objectiveFunction(null, { alpha: 3, beta: 1, gamma: 2 }, {});
  assert.strictEqual(result2, 0, 'Null assignments should return 0');

  console.log('  [pass] objectiveFunction empty input');
}

function testObjectiveFunctionStdComponent() {
  // Two proctors with loads [3, 1] → mean=2, std=1
  // Create assignments where proctor A appears in 3 different halfdays, proctor B in 1
  const assignments = [
    { proctor_keys: ['A'], halfday_key: '2026-03-15|صباحا', softViolations: [] },
    { proctor_keys: ['A'], halfday_key: '2026-03-15|مساء', softViolations: [] },
    { proctor_keys: ['A'], halfday_key: '2026-03-16|صباحا', softViolations: [] },
    { proctor_keys: ['B'], halfday_key: '2026-03-16|مساء', softViolations: [] }
  ];

  // With α=1, β=0, γ=0 → only std component
  const result = internals.objectiveFunction(assignments, { alpha: 1, beta: 0, gamma: 0 }, {});
  // std([3, 1]) = sqrt(((3-2)^2 + (1-2)^2) / 2) = sqrt(1) = 1
  assert.strictEqual(result, 1, 'std([3,1]) should be 1');

  // With α=3, β=0, γ=0 → 3 * std
  const result2 = internals.objectiveFunction(assignments, { alpha: 3, beta: 0, gamma: 0 }, {});
  assert.strictEqual(result2, 3, '3 * std([3,1]) should be 3');

  console.log('  [pass] objectiveFunction std component');
}

function testObjectiveFunctionSoftViolationsComponent() {
  // Assignments with soft violations
  const assignments = [
    { proctor_keys: ['A'], halfday_key: '2026-03-15|صباحا', softViolations: ['group_mismatch'] },
    { proctor_keys: ['A'], halfday_key: '2026-03-15|مساء', softViolations: ['same_room', 'no_gender_pair'] },
    { proctor_keys: ['B'], halfday_key: '2026-03-16|صباحا', softViolations: [] }
  ];

  // With α=0, β=1, γ=0 → only soft violations count
  const result = internals.objectiveFunction(assignments, { alpha: 0, beta: 1, gamma: 0 }, {});
  // Total soft violations = 1 + 2 + 0 = 3
  assert.strictEqual(result, 3, 'Total soft violations should be 3');

  // With β=4
  const result2 = internals.objectiveFunction(assignments, { alpha: 0, beta: 4, gamma: 0 }, {});
  assert.strictEqual(result2, 12, '4 * 3 soft violations = 12');

  console.log('  [pass] objectiveFunction soft violations component');
}

function testObjectiveFunctionMorningEveningImbalance() {
  // Proctor A: 2 morning, 0 afternoon → imbalance = |2-0| = 2
  // Proctor B: 1 morning, 1 afternoon → imbalance = |1-1| = 0
  // Total imbalance = 2
  const assignments = [
    { proctor_keys: ['A'], halfday_key: '2026-03-15|صباحا', softViolations: [] },
    { proctor_keys: ['A'], halfday_key: '2026-03-16|صباحا', softViolations: [] },
    { proctor_keys: ['B'], halfday_key: '2026-03-15|مساء', softViolations: [] },
    { proctor_keys: ['B'], halfday_key: '2026-03-16|صباحا', softViolations: [] }
  ];

  // With α=0, β=0, γ=1 → only imbalance
  const result = internals.objectiveFunction(assignments, { alpha: 0, beta: 0, gamma: 1 }, {});
  assert.strictEqual(result, 2, 'Morning/evening imbalance should be 2');

  // With γ=5
  const result2 = internals.objectiveFunction(assignments, { alpha: 0, beta: 0, gamma: 5 }, {});
  assert.strictEqual(result2, 10, '5 * 2 imbalance = 10');

  console.log('  [pass] objectiveFunction morning/evening imbalance component');
}

function testObjectiveFunctionCombined() {
  // Proctor A: 3 halfdays (2 morning, 1 afternoon) → imbalance = |2-1| = 1
  // Proctor B: 1 halfday (1 afternoon) → imbalance = |0-1| = 1
  // Total imbalance = 2
  // Loads: [3, 1], mean=2, std=1
  // Soft violations: 2 total
  const assignments = [
    { proctor_keys: ['A'], halfday_key: '2026-03-15|صباحا', softViolations: ['group_mismatch'] },
    { proctor_keys: ['A'], halfday_key: '2026-03-16|صباحا', softViolations: [] },
    { proctor_keys: ['A'], halfday_key: '2026-03-16|مساء', softViolations: ['same_room'] },
    { proctor_keys: ['B'], halfday_key: '2026-03-15|مساء', softViolations: [] }
  ];

  // "توازن" weights: α=3, β=1, γ=2
  // f = 3*1 + 1*2 + 2*2 = 3 + 2 + 4 = 9
  const result = internals.objectiveFunction(
    assignments,
    { alpha: 3, beta: 1, gamma: 2 },
    {}
  );
  assert.strictEqual(result, 9, 'Combined objective with توازن weights should be 9');

  // "احترام المجموعات" weights: α=1, β=1, γ=5
  // f = 1*1 + 1*2 + 5*2 = 1 + 2 + 10 = 13
  const result2 = internals.objectiveFunction(
    assignments,
    { alpha: 1, beta: 1, gamma: 5 },
    {}
  );
  assert.strictEqual(result2, 13, 'Combined objective with احترام المجموعات weights should be 13');

  // "تنوع القاعات" weights: α=1, β=4, γ=1
  // f = 1*1 + 4*2 + 1*2 = 1 + 8 + 2 = 11
  const result3 = internals.objectiveFunction(
    assignments,
    { alpha: 1, beta: 4, gamma: 1 },
    {}
  );
  assert.strictEqual(result3, 11, 'Combined objective with تنوع القاعات weights should be 11');

  console.log('  [pass] objectiveFunction combined formula');
}

function testObjectiveFunctionUniformLoads() {
  // All proctors have same load → std = 0
  const assignments = [
    { proctor_keys: ['A'], halfday_key: '2026-03-15|صباحا', softViolations: [] },
    { proctor_keys: ['B'], halfday_key: '2026-03-15|مساء', softViolations: [] },
    { proctor_keys: ['C'], halfday_key: '2026-03-16|صباحا', softViolations: [] }
  ];

  const result = internals.objectiveFunction(assignments, { alpha: 3, beta: 1, gamma: 2 }, {});
  // std = 0, soft violations = 0, imbalance: A=|1-0|=1, B=|0-1|=1, C=|1-0|=1 → total=3
  // f = 3*0 + 1*0 + 2*3 = 6
  assert.strictEqual(result, 6, 'Uniform loads with imbalance should be 6');

  console.log('  [pass] objectiveFunction uniform loads');
}

function testObjectiveFunctionDuplicateHalfday() {
  // Same proctor in same halfday counts each appearance for guardLoad
  // But morning/evening imbalance uses unique halfdays
  const assignments = [
    { proctor_keys: ['A'], halfday_key: '2026-03-15|صباحا', softViolations: [] },
    { proctor_keys: ['A'], halfday_key: '2026-03-15|صباحا', softViolations: [] },
    { proctor_keys: ['B'], halfday_key: '2026-03-15|مساء', softViolations: [] }
  ];

  // A appears 2 times → guardCount = 2
  // B appears 1 time → guardCount = 1
  // Loads: [2, 1], mean=1.5, std = sqrt(((2-1.5)^2 + (1-1.5)^2)/2) = sqrt(0.25) = 0.5
  const result = internals.objectiveFunction(assignments, { alpha: 1, beta: 0, gamma: 0 }, {});
  assert.strictEqual(result, 0.5, 'std([2,1]) should be 0.5');

  // Morning/evening imbalance uses unique halfdays:
  // A: 1 unique morning halfday, 0 afternoon → imbalance = 1
  // B: 0 morning, 1 unique afternoon → imbalance = 1
  // Total imbalance = 2
  const result2 = internals.objectiveFunction(assignments, { alpha: 0, beta: 0, gamma: 1 }, {});
  assert.strictEqual(result2, 2, 'Imbalance uses unique halfdays');

  console.log('  [pass] objectiveFunction counts appearances for std, unique halfdays for imbalance');
}

function testObjectiveFunctionMultipleProctorsPerRow() {
  // Rows with multiple proctor_keys (dual-proctor rooms)
  const assignments = [
    { proctor_keys: ['A', 'B'], halfday_key: '2026-03-15|صباحا', softViolations: [] },
    { proctor_keys: ['C', 'A'], halfday_key: '2026-03-15|مساء', softViolations: ['group_mismatch'] }
  ];

  // A: halfdays = {صباحا, مساء} → guardCount=2, morning=1, afternoon=1, imbalance=0
  // B: halfdays = {صباحا} → guardCount=1, morning=1, afternoon=0, imbalance=1
  // C: halfdays = {مساء} → guardCount=1, morning=0, afternoon=1, imbalance=1
  // Loads: [2, 1, 1], mean=4/3, std = sqrt(((2-4/3)^2 + (1-4/3)^2 + (1-4/3)^2)/3)
  //   = sqrt(((2/3)^2 + (-1/3)^2 + (-1/3)^2)/3) = sqrt((4/9 + 1/9 + 1/9)/3) = sqrt((6/9)/3) = sqrt(2/9)
  // Total imbalance = 0 + 1 + 1 = 2
  // Soft violations = 1

  const result = internals.objectiveFunction(assignments, { alpha: 0, beta: 1, gamma: 0 }, {});
  assert.strictEqual(result, 1, 'Soft violations from multi-proctor row');

  const result2 = internals.objectiveFunction(assignments, { alpha: 0, beta: 0, gamma: 1 }, {});
  assert.strictEqual(result2, 2, 'Imbalance from multi-proctor row');

  console.log('  [pass] objectiveFunction multiple proctors per row');
}

// ============================================================
// Integration: phase3Optimize records weightsUsed and weightValues
// ============================================================

function testPhase3DiagnosticsRecordsWeights() {
  // Minimal phase2 result
  const phase2Result = {
    assignments: [
      {
        session_key: 's1', session_label: 'Day 1', halfday_key: '2026-03-15|صباحا',
        group_number: 1, group_label: 'G1', day: 'الأول', period: 'صباحا',
        session: 'الحصة الأولى', schedule_entry: { day: 'الأول', period: 'صباحا', session: 'الحصة الأولى' },
        level_name: 'L1', subject_name: 'Math', duty_teachers: [], duty_teacher_keys: [],
        room_name: 'R1', room_number: '1', room_key: 'R1', room_place: '',
        proctors: ['أحمد'], proctor_keys: ['t1'], proctor_groups: ['G1'],
        reserves: [], reserve_keys: [], notes: '', softViolations: []
      }
    ],
    loadState: {},
    diagnostics: {}
  };

  const input = {
    weightsPreset: 'احترام المجموعات',
    enablePhase3: false,
    proctorsList: [{ cin: 't1', teacher_name: 'أحمد', gender: 'ذكر', specialty: '' }],
    scheduleEntries: [],
    exemptionsData: {},
    dutyData: {},
    meAssignments: {},
    examDistributionRules: {},
    options: {}
  };

  const rng = internals.buildSeededPRNG(42);
  const result = internals.phase3Optimize(phase2Result, input, rng, {});

  // Check diagnostics records weightsUsed and weightValues
  assert.strictEqual(result.diagnostics.weightsUsed, 'احترام المجموعات', 'weightsUsed should be preset name');
  assert.strictEqual(result.diagnostics.weightValues.alpha, 1, 'weightValues alpha');
  assert.strictEqual(result.diagnostics.weightValues.beta, 1, 'weightValues beta');
  assert.strictEqual(result.diagnostics.weightValues.gamma, 5, 'weightValues gamma');
  assert.strictEqual(result.diagnostics.phase3Skipped, true, 'phase3Skipped should be true when disabled');

  console.log('  [pass] phase3Optimize records weightsUsed and weightValues');
}

function testPhase3DiagnosticsCustomWeights() {
  const phase2Result = {
    assignments: [],
    loadState: {},
    diagnostics: {}
  };

  const input = {
    weightsPreset: 'توازن',
    customWeights: { alpha: 7, beta: 3, gamma: 1 },
    enablePhase3: false,
    proctorsList: [],
    scheduleEntries: [],
    exemptionsData: {},
    dutyData: {},
    meAssignments: {},
    examDistributionRules: {},
    options: {}
  };

  const rng = internals.buildSeededPRNG(42);
  const result = internals.phase3Optimize(phase2Result, input, rng, {});

  assert.strictEqual(result.diagnostics.weightsUsed, 'custom', 'weightsUsed should be "custom" for custom weights');
  assert.strictEqual(result.diagnostics.weightValues.alpha, 7, 'Custom weightValues alpha');
  assert.strictEqual(result.diagnostics.weightValues.beta, 3, 'Custom weightValues beta');
  assert.strictEqual(result.diagnostics.weightValues.gamma, 1, 'Custom weightValues gamma');

  console.log('  [pass] phase3Optimize records custom weights in diagnostics');
}

// ============================================================
// Run all tests
// ============================================================

function run() {
  console.log('[test] proctor-distribution-v2 objective function & weights (Task 6.2)');
  testWeightsPresetsExist();
  testWeightsPresetsValues();
  testResolveWeightsWithPreset();
  testResolveWeightsWithCustom();
  testResolveWeightsDefault();
  testResolveWeightsCustomRequiresAllFields();
  testObjectiveFunctionEmpty();
  testObjectiveFunctionStdComponent();
  testObjectiveFunctionSoftViolationsComponent();
  testObjectiveFunctionMorningEveningImbalance();
  testObjectiveFunctionCombined();
  testObjectiveFunctionUniformLoads();
  testObjectiveFunctionDuplicateHalfday();
  testObjectiveFunctionMultipleProctorsPerRow();
  testPhase3DiagnosticsRecordsWeights();
  testPhase3DiagnosticsCustomWeights();
  console.log('[test] All Task 6.2 tests passed ✓');
}

run();
