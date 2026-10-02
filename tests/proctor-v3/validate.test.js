/**
 * Unit tests for js/algorithms/proctor-v3/phases/00-validate.js
 *
 * Validates: Requirements 1.3, 9.7
 *
 * Run directly:   node tests/proctor-v3/validate.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const { validateInput } = require(path.join(
  __dirname,
  '..',
  '..',
  'js',
  'algorithms',
  'proctor-v3',
  'phases',
  '00-validate.js'
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

function makeValidInput(overrides) {
  const base = {
    proctorsList: [{ cin: '12345' }, { cin: '67890' }],
    scheduleEntries: [
      { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'Math' },
    ],
    examDistributionRules: { allowSameDayBothHalfdays: false },
  };
  return Object.assign(base, overrides || {});
}

// ---------------------------------------------------------------------------
// 1. Result shape — { valid, errors } with structured errors (Req 9.7)
// ---------------------------------------------------------------------------

test('returns { valid: true, errors: [] } for a minimally valid input', () => {
  const result = validateInput(makeValidInput());
  assert.deepStrictEqual(result, { valid: true, errors: [] });
});

test('result is always an object with valid:boolean and errors:array', () => {
  const result = validateInput(makeValidInput());
  assert.strictEqual(typeof result, 'object');
  assert.notStrictEqual(result, null);
  assert.strictEqual(typeof result.valid, 'boolean');
  assert.ok(Array.isArray(result.errors));
});

test('errors array is empty when valid=true', () => {
  const result = validateInput(makeValidInput());
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test('every error is a structured object with required fields (Req 9.7)', () => {
  const result = validateInput({
    proctorsList: 'not an array',
    scheduleEntries: null,
    // examDistributionRules missing
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.length > 0);
  result.errors.forEach((err) => {
    assert.strictEqual(typeof err, 'object', 'error must be an object, not a string');
    assert.notStrictEqual(err, null);
    assert.strictEqual(typeof err.type, 'string', 'error.type must be a string');
    assert.ok(err.type.length > 0, 'error.type must be non-empty');
    assert.strictEqual(typeof err.message, 'string', 'error.message must be a string');
    assert.ok(err.message.length > 0, 'error.message must be non-empty');
    if ('field' in err) {
      assert.strictEqual(typeof err.field, 'string');
    }
    if ('details' in err) {
      assert.strictEqual(typeof err.details, 'object');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Null / undefined / non-object inputs
// ---------------------------------------------------------------------------

test('null input is rejected with missing_input', () => {
  const result = validateInput(null);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].type, 'missing_input');
  assert.strictEqual(result.errors[0].field, 'input');
});

test('undefined input is rejected with missing_input', () => {
  const result = validateInput(undefined);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.errors[0].type, 'missing_input');
});

test('array input is rejected with invalid_input_type', () => {
  const result = validateInput([]);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.errors[0].type, 'invalid_input_type');
  assert.strictEqual(result.errors[0].details.actualType, 'array');
});

test('primitive input is rejected with invalid_input_type', () => {
  const stringResult = validateInput('foo');
  assert.strictEqual(stringResult.valid, false);
  assert.strictEqual(stringResult.errors[0].type, 'invalid_input_type');

  const numberResult = validateInput(42);
  assert.strictEqual(numberResult.valid, false);
  assert.strictEqual(numberResult.errors[0].type, 'invalid_input_type');
});

// ---------------------------------------------------------------------------
// 3. Missing required fields
// ---------------------------------------------------------------------------

test('rejects input missing proctorsList', () => {
  const input = makeValidInput();
  delete input.proctorsList;
  const result = validateInput(input);
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'proctorsList');
  assert.ok(err, 'expected an error for proctorsList');
  assert.strictEqual(err.type, 'missing_field');
});

test('rejects input missing scheduleEntries', () => {
  const input = makeValidInput();
  delete input.scheduleEntries;
  const result = validateInput(input);
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'scheduleEntries');
  assert.ok(err);
  assert.strictEqual(err.type, 'missing_field');
});

test('rejects input missing examDistributionRules', () => {
  const input = makeValidInput();
  delete input.examDistributionRules;
  const result = validateInput(input);
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'examDistributionRules');
  assert.ok(err);
  assert.strictEqual(err.type, 'missing_field');
});

test('rejects input where required field is explicitly null', () => {
  const result = validateInput({
    proctorsList: null,
    scheduleEntries: null,
    examDistributionRules: null,
  });
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.errors.length, 3);
  result.errors.forEach((err) => {
    assert.strictEqual(err.type, 'missing_field');
  });
});

test('reports ALL missing required fields in a single pass (no short-circuit)', () => {
  const result = validateInput({});
  assert.strictEqual(result.valid, false);
  const fields = result.errors.map((e) => e.field).sort();
  assert.deepStrictEqual(fields, [
    'examDistributionRules',
    'proctorsList',
    'scheduleEntries',
  ]);
});

// ---------------------------------------------------------------------------
// 4. Wrong type for required fields
// ---------------------------------------------------------------------------

test('rejects proctorsList when it is not an array', () => {
  const result = validateInput(makeValidInput({ proctorsList: { cin: '12345' } }));
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'proctorsList');
  assert.ok(err);
  assert.strictEqual(err.type, 'invalid_field_type');
  assert.strictEqual(err.details.expectedType, 'array');
  assert.strictEqual(err.details.actualType, 'object');
});

test('rejects proctorsList when it is a string', () => {
  const result = validateInput(makeValidInput({ proctorsList: 'list' }));
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'proctorsList');
  assert.strictEqual(err.type, 'invalid_field_type');
  assert.strictEqual(err.details.actualType, 'string');
});

test('rejects scheduleEntries when it is not an array', () => {
  const result = validateInput(makeValidInput({ scheduleEntries: { date: '...' } }));
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'scheduleEntries');
  assert.strictEqual(err.type, 'invalid_field_type');
  assert.strictEqual(err.details.expectedType, 'array');
});

test('rejects scheduleEntries when it is a number', () => {
  const result = validateInput(makeValidInput({ scheduleEntries: 0 }));
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'scheduleEntries');
  assert.strictEqual(err.type, 'invalid_field_type');
});

test('rejects examDistributionRules when it is an array', () => {
  const result = validateInput(makeValidInput({ examDistributionRules: [] }));
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'examDistributionRules');
  assert.strictEqual(err.type, 'invalid_field_type');
  assert.strictEqual(err.details.expectedType, 'object');
  assert.strictEqual(err.details.actualType, 'array');
});

test('rejects examDistributionRules when it is a string', () => {
  const result = validateInput(makeValidInput({ examDistributionRules: 'rules' }));
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'examDistributionRules');
  assert.strictEqual(err.type, 'invalid_field_type');
});

// ---------------------------------------------------------------------------
// 5. Empty arrays/objects accepted at this phase (deeper checks happen later)
// ---------------------------------------------------------------------------

test('accepts empty proctorsList (deeper checks belong to later phases)', () => {
  const result = validateInput(makeValidInput({ proctorsList: [] }));
  assert.strictEqual(result.valid, true);
});

test('accepts empty scheduleEntries (deeper checks belong to later phases)', () => {
  const result = validateInput(makeValidInput({ scheduleEntries: [] }));
  assert.strictEqual(result.valid, true);
});

test('accepts empty examDistributionRules object', () => {
  const result = validateInput(makeValidInput({ examDistributionRules: {} }));
  assert.strictEqual(result.valid, true);
});

// ---------------------------------------------------------------------------
// 6. Optional examCenterLevels — present/absent/valid/invalid shapes
// ---------------------------------------------------------------------------

test('accepts input without examCenterLevels (it is optional)', () => {
  const input = makeValidInput();
  // explicitly absent
  assert.strictEqual('examCenterLevels' in input, false);
  const result = validateInput(input);
  assert.strictEqual(result.valid, true);
});

test('accepts examCenterLevels=null (treated as absent)', () => {
  const result = validateInput(makeValidInput({ examCenterLevels: null }));
  assert.strictEqual(result.valid, true);
});

test('accepts examCenterLevels=undefined (treated as absent)', () => {
  const result = validateInput(makeValidInput({ examCenterLevels: undefined }));
  assert.strictEqual(result.valid, true);
});

test('accepts a valid examCenterLevels object', () => {
  const result = validateInput(
    makeValidInput({
      examCenterLevels: {
        L1: { rooms: 4 },
        L2: { rooms: 2 },
      },
    })
  );
  assert.strictEqual(result.valid, true);
});

test('accepts an empty examCenterLevels object', () => {
  const result = validateInput(makeValidInput({ examCenterLevels: {} }));
  assert.strictEqual(result.valid, true);
});

test('accepts examCenterLevels values without rooms (lenient — Phase 1b owns deep validation)', () => {
  const result = validateInput(
    makeValidInput({
      examCenterLevels: { L1: {} },
    })
  );
  assert.strictEqual(result.valid, true);
});

test('rejects examCenterLevels that is an array', () => {
  const result = validateInput(makeValidInput({ examCenterLevels: [] }));
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'examCenterLevels');
  assert.ok(err);
  assert.strictEqual(err.type, 'invalid_field_type');
  assert.strictEqual(err.details.actualType, 'array');
});

test('rejects examCenterLevels that is a primitive', () => {
  const result = validateInput(makeValidInput({ examCenterLevels: 'levels' }));
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'examCenterLevels');
  assert.strictEqual(err.type, 'invalid_field_type');
});

test('rejects examCenterLevels whose value is a primitive', () => {
  const result = validateInput(
    makeValidInput({
      examCenterLevels: { L1: 4 },
    })
  );
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'examCenterLevels.L1');
  assert.ok(err);
  assert.strictEqual(err.type, 'invalid_field_type');
  assert.strictEqual(err.details.actualType, 'number');
});

test('rejects examCenterLevels whose value is an array', () => {
  const result = validateInput(
    makeValidInput({
      examCenterLevels: { L1: [{ rooms: 4 }] },
    })
  );
  assert.strictEqual(result.valid, false);
  const err = result.errors.find((e) => e.field === 'examCenterLevels.L1');
  assert.ok(err);
  assert.strictEqual(err.type, 'invalid_field_type');
  assert.strictEqual(err.details.actualType, 'array');
});

test('skips null/undefined values inside examCenterLevels (treated as absent)', () => {
  // Phase 1b will fall back per-level; top-level shape check is lenient here.
  const result = validateInput(
    makeValidInput({
      examCenterLevels: { L1: null, L2: undefined, L3: { rooms: 3 } },
    })
  );
  assert.strictEqual(result.valid, true);
});

// ---------------------------------------------------------------------------
// 7. Determinism / purity
// ---------------------------------------------------------------------------

test('validateInput does not mutate the input', () => {
  const input = makeValidInput({
    examCenterLevels: { L1: { rooms: 4 } },
  });
  const snapshot = JSON.parse(JSON.stringify(input));
  validateInput(input);
  assert.deepStrictEqual(input, snapshot);
});

test('validateInput returns equivalent results on repeated calls', () => {
  const input = makeValidInput({ examCenterLevels: { L1: 'wrong' } });
  const r1 = validateInput(input);
  const r2 = validateInput(input);
  assert.deepStrictEqual(r1, r2);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
