# IPC Contracts: Stage Rules

Three-file rule: `main/ipc/stage-rules.js` + `main/ipc/registerAll.js` + `preload.js` (`window.api.stageRules`).

## Channels

### `stageRules:getActive` — read
- **Wrapper**: `handleAuthedRead` (requires session)
- **Args**: `(schoolYear)`
- **Returns**: `{ ruleSet: { id, school_year, revision, status, created_by, reason, created_at }, rows: { coefficients: [...], examCounts: [...] } }` — full active set for the year, or `{ ruleSet: null, rows: { coefficients: [], examCounts: [] } }` when no active version exists.
- **Errors**: `UNAUTHENTICATED`; `INVALID_SCHOOL_YEAR`
- Repo: `main/repos/stage-rules.js` — `getActiveRuleSet(db, schoolYear)` + `getRuleSetRows(db, ruleSetId)` (returns rows for both tables).

### `stageRules:saveCoefficients` — write
- **Wrapper**: `handleWriteSoftAuth(ipcMain, channel, ['admin','principal'], handler, { withContext: true })`
- **Args**: `({ schoolYear, entries: [{ cycleCode, levelCode, streamCode, subjectCode, coefficient }], reason })`
- **Behavior**:
  - Cycle authorization: resolve via session `resolveCycleForRequest`-style check + `user_cycle_access` for non-full roles (principal may edit values only — scope = coefficients/exam counts, never catalog).
  - Validation: coefficient 1–20, subject/level/stream present, `reason` mandatory (bounded, e.g. ≤ 500 chars), target year must have an `active` version (or creates the first).
  - Creates new revision: copies official + custom rows of the previous active set, applies `custom` upserts, marks new set `active` and previous `closed`. `custom` wins by construction (it is the only source written).
  - Audit: one `STAGE_RULE_OVERRIDE` row per save (actor from session, reason, revision, changed keys).
  - Sync: explicit outbox capture inside the repo transaction via `capture-port.js` (D1).
- **Errors**: `UNAUTHENTICATED`, `FORBIDDEN` (cycle), `INVALID_RULE_VERSION` (target not active), `MISSING_RULE` inputs, `REASON_REQUIRED`, `COEFFICIENT_OUT_OF_RANGE`, `RULES_UNAVAILABLE` (no active version for year — informational for creation path)
- Preload: `window.api.stageRules.saveCoefficients(payload)`

### `stageRules:saveExamCounts` — write
- **Wrapper**: `handleWriteSoftAuth(..., ['admin','principal'], ..., { withContext: true })`
- **Args**: `({ schoolYear, entries: [{ cycleCode, levelCode, subjectCode, examCount }], reason })`
- **Behavior**: same version-copy semantics as `saveCoefficients`; replaces legacy `appDefaults:saveExamCounts` for rule-set-backed writes (legacy channel stays read-compatible during transition).
- **Errors**: as above with `EXAM_COUNT_OUT_OF_RANGE` (1–12)

### `stageRules:resetToOfficial` — write
- **Wrapper**: `handleWriteSoftAuth(..., ['admin','principal'], ..., { withContext: true })`
- **Args**: `({ schoolYear, scope: 'row' | 'bulk', keys?: [{ cycleCode, levelCode, streamCode, subjectCode }], confirm?: boolean, reason })`
- **Behavior**:
  - `row`: new revision with the given custom row removed (official row for the key remains).
  - `bulk`: requires `confirm === true`; new revision with **all** custom rows removed.
  - Every reset = new revision + audit `STAGE_RULE_OVERRIDE` + explicit capture.
- **Errors**: `CONFIRM_REQUIRED` (bulk without confirm), `INVALID_RULE_VERSION`, `REASON_REQUIRED`, `FORBIDDEN`

## Read compatibility (no change)

- `appDefaults:getExamCounts` / `getExamCount` — now backed by the active rule set (`lookupExamCount` reads rule-set rows: exact level → `'*'` → default). `appDefaults:listLevels` unchanged.
- `subjectCoefficients:getAll` / `subjectCoefficients:override` — **retired** (rollback-only after migration; `settings` key `subjectCoefficientMappings:v1` no longer read or written). `grades-results.html` coefficient UI moves to the rules tab.

## Channel registry (sync) — all three write channels

| Channel | captureMode | exclude | tables |
|---|---|---|---|
| `stageRules:saveCoefficients` | `explicit` | `true` | `stage_rule_sets`, `subject_coefficients` |
| `stageRules:saveExamCounts` | `explicit` | `true` | `stage_rule_sets`, `exam_count_rules` |
| `stageRules:resetToOfficial` | `explicit` | `true` | `stage_rule_sets`, `subject_coefficients`, `exam_count_rules` |

(`tests/sync-bulk-channels-explicit.test.js` requires explicit+exclude for bulk channels.)
