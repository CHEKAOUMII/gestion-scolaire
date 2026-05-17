'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function extractFunctionBody(source, pattern) {
  const match = pattern.exec(source);
  assert.ok(match, 'buildV2Input function should exist');
  const bodyStart = match.index + match[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    i++;
  }
  assert.strictEqual(depth, 0, 'buildV2Input body should have balanced braces');
  return source.slice(bodyStart, i - 1);
}

function deriveReservesConfig(examCenterConfig, rules) {
  examCenterConfig = examCenterConfig || {};
  rules = rules || {};
  return examCenterConfig.max_reserves_mode
    ? {
      mode: examCenterConfig.max_reserves_mode === 'percent' ? 'percent' : 'fixed',
      fixed: Math.max(0, Number(examCenterConfig.max_reserves) || 0),
      percent: Math.max(0, Math.min(100, Number(examCenterConfig.max_reserves_percent) || 0))
    }
    : {
      mode: 'fixed',
      fixed: Math.max(0, Number(rules.reservesPerSession) || 0),
      percent: 0
    };
}

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log('  [pass] ' + name);
    passed++;
  } catch (e) {
    console.log('  [FAIL] ' + name + ': ' + e.message);
    failed++;
  }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'exams-proctors.html'), 'utf8');
const buildV2InputBody = extractFunctionBody(html, /async\s+function\s+buildV2Input\s*\(\s*\)\s*\{/);

console.log('[test] exams-proctors buildV2Input reservesConfig plumbing');

runTest('buildV2Input reads max_reserves_mode fields and returns reservesConfig', function () {
  assert.ok(/max_reserves_mode/.test(buildV2InputBody));
  assert.ok(/max_reserves/.test(buildV2InputBody));
  assert.ok(/max_reserves_percent/.test(buildV2InputBody));
  assert.ok(/reservesConfig\s*:\s*reservesConfig/.test(buildV2InputBody));
});

runTest('buildV2Input passes D_expected from expected_duty_tasks', function () {
  assert.ok(/expected_duty_tasks/.test(buildV2InputBody));
  assert.ok(/D_expected\s*:/.test(buildV2InputBody));
});

runTest('max_reserves_mode percent propagates percent config', function () {
  const cfg = deriveReservesConfig({
    max_reserves_mode: 'percent',
    max_reserves: 9,
    max_reserves_percent: 25
  }, { reservesPerSession: 0 });
  assert.deepStrictEqual(cfg, { mode: 'percent', fixed: 9, percent: 25 });
});

runTest('absent max_reserves_mode falls back to legacy reservesPerSession', function () {
  const cfg = deriveReservesConfig({}, { reservesPerSession: 3 });
  assert.deepStrictEqual(cfg, { mode: 'fixed', fixed: 3, percent: 0 });
});

runTest('max_reserves_mode fixed with max_reserves zero propagates fixed zero', function () {
  const cfg = deriveReservesConfig({
    max_reserves_mode: 'fixed',
    max_reserves: 0,
    max_reserves_percent: 80
  }, { reservesPerSession: 5 });
  assert.deepStrictEqual(cfg, { mode: 'fixed', fixed: 0, percent: 80 });
});

console.log('\n[test] exams-proctors buildV2Input: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}
