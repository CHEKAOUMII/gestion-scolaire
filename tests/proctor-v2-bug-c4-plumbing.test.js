'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildC4Input } = require('./fixtures/proctor-v2-bug-fixtures');

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
  assert.strictEqual(depth, 0, 'buildV2Input body should parse with balanced braces');
  return source.slice(bodyStart, i - 1);
}

const fixture = buildC4Input();
const html = fs.readFileSync(path.join(__dirname, '..', 'exams-proctors.html'), 'utf8');
const body = extractFunctionBody(html, /async\s+function\s+buildV2Input\s*\(\s*\)\s*\{/);

assert.ok(/max_reserves_mode/.test(body),
  'Fixed buildV2Input must read examCenterConfig.max_reserves_mode');
assert.ok(/max_reserves_percent/.test(body),
  'Fixed buildV2Input must read examCenterConfig.max_reserves_percent');
assert.ok(/reservesConfig/.test(body),
  'Fixed buildV2Input must attach reservesConfig to the v2 input');
assert.strictEqual(fixture.examCenterConfig.max_reserves_mode, 'percent');
assert.strictEqual(fixture.examDistributionRules.reservesPerSession, 0);

console.log('[pass] C4 plumbing guard: buildV2Input now reads max_reserves_mode and emits reservesConfig');
