'use strict';

/**
 * Every bulk CHANNEL_REGISTRY entry must use explicit atomic capture
 * (no auto-summary bulk path for production writes).
 */
const assert = require('assert');
const { CHANNEL_REGISTRY } = require('../main/sync/capture');

console.log('[test] bulk channels explicit capture');

const bulkEntries = Object.entries(CHANNEL_REGISTRY).filter(([, e]) => e && e.bulk);
assert.ok(bulkEntries.length >= 20, `expected many bulk channels, got ${bulkEntries.length}`);

const incomplete = [];
for (const [channel, entry] of bulkEntries) {
    if (entry.captureMode !== 'explicit' || entry.exclude !== true) {
        incomplete.push(channel);
    }
}

assert.deepStrictEqual(
    incomplete,
    [],
    'bulk channels missing captureMode:explicit + exclude:true → ' + incomplete.join(', ')
);

// Spot-check high-risk channels
const required = [
    'students:addBulk',
    'grades:saveBulk',
    'absences:saveBulk',
    'studentFiles:upsertBulk',
    'teachers:importBulk',
    'examProctors:bulkImport',
    'examProctors:generateRoundRobin',
    'examAttendance:bulkUpsert',
    'compensation:saveBatch',
    'supportSessions:import',
    'systemTags:saveNote',
    'students:deleteByYear',
    'grades:deleteByYear',
    'teachers:deleteByYear'
];

for (const ch of required) {
    assert.ok(CHANNEL_REGISTRY[ch], `missing registry entry ${ch}`);
    assert.strictEqual(CHANNEL_REGISTRY[ch].captureMode, 'explicit', ch);
    assert.strictEqual(CHANNEL_REGISTRY[ch].exclude, true, ch);
}

console.log(`  [ok] ${bulkEntries.length} bulk channels are explicit`);
console.log('[test] bulk channels explicit capture OK');
