'use strict';

const assert = require('assert');
const Policy = require('../js/import-center/import-preflight-policy.js');

function decision(input) {
    return Policy.decide(Object.assign({ action: 'students', status: 'mismatch' }, input));
}

assert.strictEqual(decision({ key: 'schoolYear', source: 'explicit' }), Policy.DECISIONS.BLOCK);
assert.strictEqual(decision({ key: 'schoolYear', source: 'filename' }), Policy.DECISIONS.REQUIRE_REVIEW);
assert.strictEqual(decision({ key: 'institutionCode' }), Policy.DECISIONS.BLOCK);
assert.strictEqual(decision({ key: 'institutionName' }), Policy.DECISIONS.REQUIRE_REVIEW);
assert.strictEqual(decision({ key: 'cycle', confidence: 'high' }), Policy.DECISIONS.BLOCK);
assert.strictEqual(decision({ key: 'cycle', confidence: 'medium' }), Policy.DECISIONS.REQUIRE_REVIEW);
assert.strictEqual(decision({ action: 'grades', key: 'semester', status: 'missing' }), Policy.DECISIONS.BLOCK);
assert.strictEqual(decision({ action: 'grades', key: 'studentCodes', status: 'mismatch' }), Policy.DECISIONS.BLOCK);
assert.strictEqual(decision({ key: 'templateVersion', status: 'unknown' }), Policy.DECISIONS.BLOCK);
assert.strictEqual(decision({ key: 'scope', status: 'info' }), Policy.DECISIONS.ALLOW);

console.log('import-preflight-policy: OK');
