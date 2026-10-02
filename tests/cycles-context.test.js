'use strict';

const assert = require('assert');
const { CYCLE_CATALOG, getCycleDefinition } = require('../js/shared/education/cycles');
const { validateInstitutionCycleBeforePut } = require('../main/sync/apply-hooks');
const {
    getContext,
    setContext,
    clearContextForSender,
    clearContextsForCycle
} = require('../main/auth/active-cycle-context');

console.log('[test] education cycles and active contexts');

assert.strictEqual(CYCLE_CATALOG.length, 3);
assert.strictEqual(getCycleDefinition('secondary_qualifiant').capability, 'supported');
assert.strictEqual(getCycleDefinition('secondary_collegial').capability, 'supported');
assert.strictEqual(getCycleDefinition('primary').capability, 'preview');
assert.strictEqual(getCycleDefinition('primary').sortOrder, 5);
assert.strictEqual(getCycleDefinition('unknown'), null);
console.log('  [ok] cycle capability catalog is closed');

const remoteCycle = { data: { cycle_code: 'secondary_collegial', is_active: true, seed_profile_version_hint: 'tampered' } };
assert.strictEqual(validateInstitutionCycleBeforePut(null, remoteCycle), null);
assert.strictEqual(remoteCycle.data.seed_profile_version_hint, 'collegial-2026-v1');
assert.ok(validateInstitutionCycleBeforePut(null, { data: { cycle_code: 'unknown' } }).fail);
console.log('  [ok] synced cycle rows are validated against the catalog');

const firstWindow = { sender: { id: 101 } };
const secondWindow = { sender: { id: 202 } };
const firstContext = getContext(firstWindow, 11, '2025/2026', 'secondary_qualifiant');
const secondContext = setContext(secondWindow, 22, 'secondary_collegial', '2025/2026');
assert.strictEqual(firstContext.cycleCode, 'secondary_qualifiant');
assert.strictEqual(secondContext.cycleCode, 'secondary_collegial');
assert.notStrictEqual(firstContext.userId, secondContext.userId);
console.log('  [ok] sender contexts remain independent');

const refreshedYear = getContext(firstWindow, 11, '2026/2027', 'secondary_qualifiant');
assert.strictEqual(refreshedYear.schoolYear, '2026/2027');
assert.notStrictEqual(refreshedYear, firstContext);
console.log('  [ok] school-year changes rebuild cached context');

clearContextsForCycle('secondary_collegial');
const resetSecondContext = getContext(secondWindow, 22, '2025/2026', 'secondary_qualifiant');
assert.strictEqual(resetSecondContext.cycleCode, 'secondary_qualifiant');
clearContextForSender(firstWindow.sender.id);
clearContextForSender(secondWindow.sender.id);
console.log('  [ok] disabled-cycle contexts are invalidated');
