'use strict';

// Proctor v3: phases/orchestrator/hard-constraints must not re-implement key rule
//
//   node tests/proctor-canonical-ssot-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { canonicalProctorKey } = require('../js/algorithms/proctor-v3/canonical-key.js');
assert.strictEqual(canonicalProctorKey({ cin: '  X ' }, 3), 'X');
assert.strictEqual(canonicalProctorKey({}, 3), '__idx_3');

const files = [
    'js/algorithms/proctor-v3/phases/04-place-guards.js',
    'js/algorithms/proctor-v3/phases/05-coverage-repair.js',
    'js/algorithms/proctor-v3/phases/07-bimodal-repair.js',
    'js/algorithms/proctor-v3/phases/08-ampm-balance.js',
    'js/algorithms/proctor-v3/phases/09-place-reserves.js',
    'js/algorithms/proctor-v3/phases/10-finalize.js',
    'js/algorithms/proctor-v3/orchestrator.js',
    'js/algorithms/proctor-v3/constraints/hard-constraints.js'
];

for (const rel of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(/canonicalProctorKey/.test(src), rel + ' must reference canonicalProctorKey');
    assert.ok(
        !/return '__idx_' \+ idx/.test(src) || /canonicalProctorKey\(proctor, idx\)/.test(src),
        rel + ' must not keep full local key implementation alone'
    );
    // Thin wrapper OK
    assert.ok(/function canonicalKeyOf\(proctor, idx\)/.test(src), rel + ' may keep alias canonicalKeyOf');
    assert.ok(/return canonicalProctorKey\(proctor, idx\)/.test(src), rel + ' alias must delegate');
}

console.log('proctor-canonical-ssot-unit: OK');
