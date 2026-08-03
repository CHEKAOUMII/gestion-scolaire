# Sync Contracts: Stage Rules

Registration in `main/sync/entity-registry.js` + `main/sync/engine/helpers.js` `TOPO_ORDER_PUT`.

## Registry entries

```js
stage_rule_sets: {
  entityType: 'stage_rule_set',
  local: {
    table: 'stage_rule_sets',
    keyFields: ['school_year', 'revision'],
    localIdField: 'id',
    snapshot: false,
    contractVersion: 2,
    requiredColumns: ['status', 'reason']
  },
  remote: { collection: 'stageRuleSets', idFields: ['school_year', 'revision'] },
  authority: { writers: ALL_WRITERS },
  applyHooks: { put: revisionGuard }   // D2 — never downgrade revision
}

subject_coefficients: {
  entityType: 'subject_coefficient',
  local: {
    table: 'subject_coefficients',
    keyFields: ['rule_set_id', 'cycle_code', 'level_code', 'stream_code', 'subject_code', 'source'],
    localIdField: 'id',
    snapshot: false,
    contractVersion: 2,
    requiredColumns: ['rule_set_id', 'cycle_code', 'subject_code', 'source']
  },
  remote: { collection: 'subjectCoefficients', idFields: ['rule_set_id', 'cycle_code', 'level_code', 'stream_code', 'subject_code', 'source'] },
  authority: { writers: ALL_WRITERS },
  applyHooks: {}
}

exam_count_rules: {
  entityType: 'exam_count_rule',
  local: {
    table: 'exam_count_rules',
    keyFields: ['rule_set_id', 'cycle_code', 'level_code', 'subject_code', 'source'],
    localIdField: 'id',
    snapshot: false,           // CHANGED from snapshot: true
    contractVersion: 2,
    requiredColumns: ['rule_set_id', 'cycle_code', 'subject_code', 'source']
  },
  remote: { collection: 'examCountRules', idFields: ['rule_set_id', 'cycle_code', 'level_code', 'subject_code', 'source'] },
  authority: { writers: ALL_WRITERS },
  applyHooks: {}
}
```

## Ordering

`TOPO_ORDER_PUT` (helpers.js): `stage_rule_sets` **before** `subject_coefficients` and `exam_count_rules` (children reference `rule_set_id` FK).

## Guards

1. **Push side (exists)**: `writeItemWithVersionCheck` (`firestore.js:76`) — an older device can never overwrite a newer remote row (guard `remoteVersion >= item.version`). No change.
2. **Pull side (new)**: `revisionGuard` apply hook on `stage_rule_sets` — incoming PUT with `revision <=` local row's `revision` is skipped (treated as equivalent/stale) instead of written; quarantines nothing (data is fine, just older). This is the only new sync-layer code.
3. **Seed side**: official-upgrade path never writes `revision <= max(revision)` and never captures (migrations don't call repos — explicit model, D1).

## contractVersion bump

`contractVersion: 2` + `requiredColumns` (per `validateEntityRegistry`, `entity-registry.js:738-740`): older devices without the new columns **quarantine** those rows with the Arabic message at `apply.js:69-73` ("هذا الجهاز يحتاج تحديثاً…") and replay them after upgrade — schema-level protection, no corruption.

## Tests required (M4)

- `sync-bulk-channels-explicit.test.js` stays green (all three channels explicit+exclude).
- Migration creates **zero outbox rows** for seeds.
- Old device (older revision locally) cannot push its stale official set (firestore guard) and cannot apply a stale remote set (revisionGuard).
- `sync-entity-registry.test.js` passes with the three entries.
