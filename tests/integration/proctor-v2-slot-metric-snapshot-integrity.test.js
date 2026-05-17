'use strict';

// Integration meta-test — Phase D.4 task 28 of proctor-v2-slot-metric-reserves-affinity.
// Asserts the pre-fix snapshot owned by the prior spec is NOT modified.
// _Validates: P4 — Requirement 3.10_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SNAPSHOT_PATH = path.join(
  __dirname, '..', '__snapshots__',
  'proctor-v2-strict-fairness-coverage.pre-fix.js'
);

// Read mtime + sha256 BEFORE the snapshot module is required (some require()
// implementations open and close the file but should not mutate it). We then
// require it (exercising the test-time read path) and re-check.
const beforeStat = fs.statSync(SNAPSHOT_PATH);
const beforeBytes = fs.readFileSync(SNAPSHOT_PATH);
const beforeHash = crypto.createHash('sha256').update(beforeBytes).digest('hex');

// Touch the module — exercise the same code path used by exploratory tests.
require(SNAPSHOT_PATH);

const afterStat = fs.statSync(SNAPSHOT_PATH);
const afterBytes = fs.readFileSync(SNAPSHOT_PATH);
const afterHash = crypto.createHash('sha256').update(afterBytes).digest('hex');

assert.strictEqual(
  beforeStat.mtimeMs,
  afterStat.mtimeMs,
  'pre-fix snapshot mtime changed — file was modified during the suite'
);
assert.strictEqual(
  beforeHash,
  afterHash,
  'pre-fix snapshot SHA-256 changed — content was modified during the suite'
);

console.log('[pass] pre-fix snapshot integrity unchanged');
console.log('  mtime: ' + new Date(beforeStat.mtimeMs).toISOString());
console.log('  sha256: ' + beforeHash);
