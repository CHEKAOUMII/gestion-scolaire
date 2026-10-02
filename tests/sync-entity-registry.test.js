'use strict';

const assert = require('assert');
const {
    ENTITY_REGISTRY,
    validateEntityRegistry,
    buildCollectionMap,
    buildWriterAuthority,
    buildEntityTypeRegistry,
    getSnapshotTables,
    getLocalKeyFields,
    isKnownSyncTable
} = require('../main/sync/entity-registry');
const { COLLECTION_MAP } = require('../main/firebase/collections');
const { WRITER_AUTHORITY, ENTITY_TYPE_REGISTRY } = require('../main/sync/authority');

console.log('[test] entity registry SSOT');

const errors = validateEntityRegistry();
assert.deepStrictEqual(errors, [], 'registry schema must validate: ' + errors.join('; '));
console.log('  [ok] validateEntityRegistry');

assert.ok(ENTITY_REGISTRY.students);
assert.deepStrictEqual(getLocalKeyFields('students'), ['school_year', 'code']);
assert.deepStrictEqual(ENTITY_REGISTRY.students.remote.idFields, ['school_year', 'code']);
assert.deepStrictEqual(ENTITY_REGISTRY.students.remote.legacyIdFields, ['code']);
assert.ok(isKnownSyncTable('students'));
assert.ok(isKnownSyncTable('institution_cycles'));
assert.deepStrictEqual(getLocalKeyFields('institution_cycles'), ['cycle_code']);
assert.deepStrictEqual(ENTITY_REGISTRY.institution_cycles.remote.idFields, ['cycle_code']);
assert.ok(!isKnownSyncTable('device_revocation'), 'remote-only not a local sync table');
console.log('  [ok] students local keys + D1 remote idFields + remoteOnly');

const derivedCollections = buildCollectionMap();
assert.strictEqual(derivedCollections.students.collection, COLLECTION_MAP.students.collection);
assert.deepStrictEqual(derivedCollections.students.idFields, COLLECTION_MAP.students.idFields);
assert.deepStrictEqual(derivedCollections.students.idFields, ['school_year', 'code']);
assert.deepStrictEqual(derivedCollections.students.legacyIdFields, ['code']);
assert.ok(COLLECTION_MAP.device_revocation, 'remote-only device_revocation in collections');
console.log('  [ok] COLLECTION_MAP derives from registry');

const writers = buildWriterAuthority();
assert.ok(writers.students);
assert.ok(!writers.device_revocation, 'remote-only not in writer authority');
assert.deepStrictEqual(Object.keys(writers).sort(), Object.keys(WRITER_AUTHORITY).sort());
console.log('  [ok] WRITER_AUTHORITY derives from registry');

const types = buildEntityTypeRegistry();
assert.strictEqual(types.students.entityType, 'student');
assert.deepStrictEqual(Object.keys(types).sort(), Object.keys(ENTITY_TYPE_REGISTRY).sort());
console.log('  [ok] ENTITY_TYPE_REGISTRY derives from registry');

const snap = getSnapshotTables();
assert.ok(snap.includes('students'));
assert.ok(!snap.includes('device_revocation'));
console.log('  [ok] snapshot tables exclude remoteOnly');

for (const table of ['stage_rule_sets', 'subject_coefficients', 'exam_count_rules', 'subject_weight_rules']) {
    const entry = ENTITY_REGISTRY[table];
    assert.ok(entry, table + ' must be in ENTITY_REGISTRY');
    assert.strictEqual(entry.local.snapshot, false, table + ' must be excluded from snapshots');
    assert.ok([1, 2].includes(entry.local.contractVersion), table + ' must use a declared contract version');
    assert.ok(!snap.includes(table), table + ' must not be a snapshot table');
    assert.ok(entry.local.keyFields.length > 0, table + ' must define keyFields');
    assert.ok(entry.remote && entry.remote.idFields.length > 0, table + ' must define remote idFields');
}
assert.deepStrictEqual(ENTITY_REGISTRY.stage_rule_sets.local.keyFields, ['school_year', 'revision']);
assert.deepStrictEqual(ENTITY_REGISTRY.stage_rule_sets.remote.idFields, ['school_year', 'revision']);
for (const table of ['subject_coefficients', 'exam_count_rules', 'subject_weight_rules']) {
    assert.ok(
        ENTITY_REGISTRY[table].remote.idFields.includes('rule_set_id'),
        table + ' must be rule_set_id-scoped'
    );
}
console.log('  [ok] stage-rules tables snapshot:false + rule_set_id scoping');

console.log('[test] entity registry SSOT OK');
