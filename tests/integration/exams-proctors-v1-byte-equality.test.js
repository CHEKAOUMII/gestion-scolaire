'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function extractFunctionBody(source, pattern) {
  const match = pattern.exec(source);
  assert.ok(match, 'target function should exist');
  const bodyStart = match.index + match[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    i++;
  }
  assert.strictEqual(depth, 0, 'target function should have balanced braces');
  return source.slice(bodyStart, i - 1);
}

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'exams-proctors.html'), 'utf8');
assert.ok(/async\s+function\s+runAutoDistribution\s*\(/.test(html), 'v1 runAutoDistribution should exist');
assert.ok(/async\s+function\s+runAutoDistributionV2\s*\(/.test(html), 'v2 runAutoDistributionV2 should exist');
const v1Body = extractFunctionBody(html, /async\s+function\s+runAutoDistribution\s*\(\s*\)\s*\{/);
assert.ok(!/buildV2Input\s*\(/.test(v1Body), 'v1 path must not call buildV2Input');
assert.ok(!/ProctorDistributionV2\.run/.test(v1Body), 'v1 path must not call v2 algorithm');
console.log('[pass] integration v1 toggle path remains isolated from v2 plumbing');
