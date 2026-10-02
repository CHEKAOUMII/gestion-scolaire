# DB↔Memory Distribution Mismatch — Bugfix Design

## Overview

After the V2 distribution algorithm runs in `exams-proctors.html`, the in-memory result `R_mem` and the DB-loaded result `R_db` for the same `(fixture, schoolYear)` show different per-proctor load histograms even though both report the same total slot count (382). On the production fixture (`tests/fixtures/45454.json`, 147 proctors, 191 rows), `R_mem` reports `{1:7, 2:66, 3:81}` (max=3, 154 distinct proctor counts) while `R_db` reports `{2:61, 3:84, 4:2}` (max=4, 147 distinct proctor counts). The algorithm is verified correct in memory by `scripts/verify-fixture.js` (no IPC, no DB), so the corruption is introduced somewhere along the persistence + display path.

The user constraint is explicit: **the solution must be methodical and structural, not a localized patch** ("يجب ان يكون الحل منهجي وهيكلي"). Therefore the design phase does not commit to a single fix. Instead, it lays out a six-phase investigation plan that instruments both layers, bisects the round-trip, and only then specifies the change site. Each hypothesis (H1–H5) has a discriminating standalone test that confirms or refutes it before any code is touched. The algorithm in `js/algorithms/proctor-distribution-v2.js` is **out of scope for modification** unless the investigation explicitly elevates it as the proven root cause.

The structural framing of the bug condition is: the round-trip `histogramByProctorKey ∘ load ∘ save ∘ run` should equal `histogramByProctorKey ∘ run` for any `(fixture, schoolYear)`. The bug fires when this composition is not the identity on the histogram.

## Glossary

- **Bug_Condition (C)**: `histogramByProctorKey(R_mem) ≠ histogramByProctorKey(R_db)` for the same `(fixture, schoolYear)` after `R_mem ← V2.run(input)` then `persistViaProductionPath(R_mem)` then `R_db ← loadViaProductionPath(year, 'examAutoDistributionData')` with no user-initiated mutations between save and load.
- **Property (P)**: For every proctor key `K`, `count_mem(K) = count_db(K)`; equivalently `histogramByProctorKey(R_mem) = histogramByProctorKey(R_db)`, `maxLoad(R_mem) = maxLoad(R_db)`, `totalSlotsFilled(R_mem) = totalSlotsFilled(R_db)`, `proctorsCounted(R_mem) = proctorsCounted(R_db)`.
- **Preservation**: For every `(year, key)` where `NOT isBugCondition`, the bytes persisted by the post-fix code equal the bytes persisted by the pre-fix code (modulo intentional canonicalization), and the load path returns the same JS value.
- **F**: The pre-fix storage/IPC/display pipeline (currently corrupting per-proctor histograms).
- **F'**: The post-fix pipeline (round-trip is the identity on the histogram).
- **R_mem**: `output.result` returned by `window.ProctorDistributionV2.run(input)` in the renderer.
- **R_db**: The JS value returned by `window.api.examConfig.get(year, 'examAutoDistributionData')` after the renderer auto-save call has completed.
- **getProctorKey**: The function in `js/algorithms/proctor-distribution-v2.js` (≈line 649) returning `proc.cin || ('__idx_' + idx)`. With 147 proctors all having empty `cin`, it returns `'__idx_0' … '__idx_146'`.
- **proctor_keys[]**: Array on each result row holding stable `__idx_N` keys (single source of identity used by the algorithm and the loadState).
- **proctors[]**: Array on each result row holding `teacher_name` strings (display-only).
- **examAutoDistributionData**: The single `config_key` in `exam_config_data` that stores the algorithm output; payload shape is `{ rows: [...], algorithmVersion: 'v2', diagnostics: {...} }`.
- **Auto-save (line ~2749)**: Unconditional call to `saveV2ResultToLocalStorage(output)` inside `runAutoDistributionV2`, despite the function name it persists to the SQLite DB via `window.api.examConfig.save`. The user reported this auto-save was unintended — they expect data to persist only on حفظ النتيجة click.
- **buildSummaryRows()**: Aggregator in `exams-rooms.html` (≈line 821) reading from DB and accumulating per-teacher counts. It currently keys teachers by `name` (`row.proctors[i]`), not by `proctor_keys[i]`.
- **Shared-reference invariant**: `phase2_5PopulateReserves` (≈line 2518) and Phase 3 swap moves rely on every row of a session sharing the same `reserves` / `reserve_keys` array reference, so that one mutation propagates across the session. `JSON.stringify` flattens this aliasing — after load each row holds an independent copy.

## Bug Details

### Bug Condition

The bug manifests when the auto-distribution result is round-tripped through the production save+load path: the DB-loaded payload reports a different per-proctor load count than the in-memory output for at least one proctor key, even though the total slot count is preserved. The aggregate-conservation-but-per-key-divergence pattern points at a transformation that re-bucketizes proctors during save, write, read, parse, or aggregation.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input = (fixture, schoolYear) — the exact contract consumed by ProctorDistributionV2.run
  OUTPUT: boolean

  R_mem := V2.run(input).result          // in-memory algorithm output
  persistViaProductionPath(R_mem,         // save through window.api.examConfig.save
                           schoolYear,
                           'examAutoDistributionData')
  R_db  := loadViaProductionPath(schoolYear, 'examAutoDistributionData')

  H_mem := histogramByProctorKey(R_mem)  // key → guard slot count
  H_db  := histogramByProctorKey(R_db)

  RETURN EXISTS K SUCH THAT H_mem[K] ≠ H_db[K]
END FUNCTION
```

### Examples

- `tests/fixtures/45454.json` (147 proctors, all empty `cin`, 191 rows, 382 slots): `H_mem = {1:7, 2:66, 3:81}` (max=3, 154 distinct keys), `H_db = {2:61, 3:84, 4:2}` (max=4, 147 distinct keys). Total slots agree (382), but per-proctor counts diverge for 7 keys, all in the direction `count_db = count_mem + 1`.
- `diagAndCompare()` console diagnostic on the same fixture lists 7 specific name mismatches (سعدية ادراق, ياسين بوهديد, ابراهيم وسميح, سناء اكلاو, بوعسيل محمد, etc.); each is exactly +1 in DB.
- `7 missing keys × average duplicate-merge gain of 1` and `154 − 147 = 7` align with a name-bucketing collision, which is the H5 hypothesis tracked below.
- Edge case: when the fixture contains zero name collisions (all unique `teacher_name`), the bug should not fire under H5 — but may still fire under H1–H4. Discriminating across hypotheses is exactly the job of the investigation plan.

### Conservation arithmetic that constrains the root cause

For 7 mismatch keys with `count_db = count_mem + 1` summing to 7 extra slots in DB, and 7 fewer distinct keys in DB (`154 − 147`), the only transformations that fit all three conservation laws (total slots, total +1 deltas, distinct-key shrinkage) are: bucket-by-name aggregation, key→name remapping during save, or name-collision merging during load. A pure JSON byte loss would not preserve the total slot count. A column truncation would either produce a parse error or asymmetric loss (less likely to land at exactly 382). This is one of the strongest pre-investigation signals that H5 (aggregation by name) is the leading suspect.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The V2 algorithm output `R_mem` for `tests/fixtures/45454.json` continues to be `{1:7, 2:66, 3:81}` max=3, P1/P2/P3 PASS via `scripts/verify-fixture.js` (Node-only, no IPC, no DB).
- `scripts/verify-real-centre.js` continues to pass P1/P2/P3 on the real-centre fixture.
- The 12 config keys other than `examAutoDistributionData` (`examCenterConfig`, `examCenterLevels`, `examCenterRoomsData`, `examCenterRoomsCount`, `examScheduleData`, `examPeriodsData`, `examDistributionRules`, `examExemptionsData`, `examDutyTeachersData`, `examMorningEveningData`, `examAutoDistributionOptions`, `examCandidatesData`) round-trip identically pre/post fix through the same IPC handler.
- The `exam_config_data` table schema (columns `id`, `school_year`, `config_key`, `data_json`, `updated_at`, unique on `(school_year, config_key)`) is unchanged.
- `getProctorKey` continues to return `proc.cin || ('__idx_' + idx)` — same synthetic-key encoding for proctors with empty `cin`.
- The حفظ النتيجة (manual save) button continues to persist the latest in-memory result and is visible in `exams-rooms.html`.
- Existing pre-fix saved rows (rows that may already be corrupted under the buggy path) load post-fix without error, even if rendering is normalized.
- `npm run lint` and `npm test` produce zero new errors or warnings relative to the closing state of `proctor-v2-fairness-undercovered-fix`.

**Scope:**
All inputs that do NOT produce a histogram divergence (zero name collisions across distinct proctor keys, no aliasing artifacts that escape stringify) should be completely unaffected by this fix. This includes:
- Reads/writes for the 12 non-`examAutoDistributionData` config keys.
- The Node-only verify scripts which do not exercise the IPC or DB path at all.
- All existing v2 unit and property tests in `tests/proctor-v2-*.test.js`.

The scope of this bugfix is intentionally narrow: the storage/IPC/display path for `examAutoDistributionData` only. The IPC handler is shared across 13 keys, so any change to `main/ipc/exam-config-data.js` must be additive, key-scoped, and free of behavioral side-effects on the other 12 keys.

## Hypothesized Root Cause

The investigation context enumerates five suspects. Each is restated here with the evidence for and against, and a discriminating test that produces a yes/no answer in isolation.

1. **H1 — Shared array references in `phase2_5PopulateReserves` corrupted by `JSON.stringify`.** Reserves are deliberately shared across rows of a session (`sessionRows[rrr].reserves = sharedReserves`, ≈line 2734 of v2.js). After `JSON.stringify`, each row's `reserves` becomes an independent copy. After `JSON.parse`, what was shared is now independent. If any consumer (`buildSummaryRows`, fairness reports, swap moves) reads through the aliasing assumption, totals diverge. **Discriminator:** in Node, run `JSON.parse(JSON.stringify(out.result))` on the fixture and compare `histogramByProctorKey` against `out.result`'s. The histogram counts `proctor_keys`, not `reserves`, so if H1 alone caused the bug the histogram would be unchanged. Pre-investigation prior: low-medium (reserves are not what is being miscounted).

2. **H2 — IPC layer (Electron contextBridge / `ipcMain.invoke`) doing a structuredClone that drops or transforms data.** Electron 35's `contextBridge.exposeInMainWorld` and `ipcRenderer.invoke` pass arguments through `structuredClone` (or v8 serializer, depending on Electron build). `structuredClone` does not preserve shared references but does preserve all primitive content; it cannot create new keys. **Discriminator:** in Electron renderer, write a roundtrip harness that calls `window.api.examConfig.save({…, data: out.result})` then `window.api.examConfig.get(year, key)` and compare. Then compare against a Node-only `JSON.parse(JSON.stringify(out.result))` baseline. If IPC is lossless beyond stringify, both are identical. Pre-investigation prior: low (structuredClone is well-tested for this shape).

3. **H3 — SQLite TEXT column truncation or encoding issue.** `data_json` is TEXT; SQLite TEXT has no length limit, but a system codepath (encoding mismatch with Arabic strings, or BLOB↔TEXT coercion) could truncate. **Discriminator:** in Node with `better-sqlite3`, open the production DB at `~/.config/gestion-scolaire/gestion-scolaire.db`, read the `data_json` column for `examAutoDistributionData`, run `JSON.parse`, and compare its histogram to a Node-only stringify roundtrip. Also write a synthetic 50KB Arabic-heavy payload to a fresh test DB with the same column DDL and verify byte-identity on read. Pre-investigation prior: very low (SQLite TEXT is robust; the slot total is conserved which truncation would not preserve).

4. **H4 — Auto-save race**: line ~2749 calls `saveV2ResultToLocalStorage(output)` on every algorithm run. The function is `async`/`await` but its Promise is not awaited by `runAutoDistributionV2`. Two consecutive runs (or a refresh shortly after a run) can interleave: the second run's save raced with the first run's settle. The user already reported this symptom: data persists across navigation despite no manual save. **Discriminator:** instrument the auto-save to log `(timestamp, hash(R_mem))` and the load path to log `(timestamp, hash(R_db))`. Replay the user's reproduction; if the load returns a hash from a previous run rather than the most recent one, H4 is confirmed. Pre-investigation prior: medium (the symptom matches; but the same fixture run twice via the verify scripts produces the same `R_mem`, so the race could only explain the cross-run version skew, not the per-key histogram delta seen on a single run).

5. **H5 — `buildSummaryRows()` aggregates by `teacher_name`, not by `proctor_keys`.** Reading `exams-rooms.html` (≈line 821) confirms this directly: the function calls `getTeacher(teacherMap, name)` for every entry in `row.proctors`, where `name = row.proctors[i]`. Two proctors with empty `cin` and identical `teacher_name` (a real possibility in a 147-proctor pool, especially with common Arabic names) collide into a single bucket, summing their loads. The conservation arithmetic fits exactly: 7 collisions merge 7 extra distinct keys into existing buckets, sum 7 extra units of guard load into the surviving names, distinct count drops by 7 (154 → 147), and total stays at 382. **Discriminator:** in Node, take `R_mem` from the fixture, compute (a) `histogramByProctorKey(R_mem)` and (b) `histogramByName(R_mem)`. If `histogramByName(R_mem) === histogramByDB(R_db)` exactly, H5 is confirmed regardless of any IPC/DB behavior, and the fix is in the display layer alone. Pre-investigation prior: **high** (matches all conservation laws; 147 proctors with empty `cin` is an environment that exercises this exact collision path; the v1→v2 algorithm migration moved identity from name to key but the renderer aggregator was not updated).

The investigation plan tests H5 first because it is the cheapest discriminator and the highest-prior cause. If H5 is refuted, the plan proceeds inward through H1, H4, H2, H3 in declining order of likelihood.

## Investigation Plan (Phased Debugging)

The investigation runs entirely on `tests/fixtures/45454.json`, the smallest known reproducer (75 KB, real-centre data). Each phase is a single standalone script or harness with a single yes/no question. No production code is modified during phases A–F. The fix is specified only after the phase that confirms a hypothesis.

### Phase A — Instrument both layers (memory hash vs DB hash)

**Goal:** confirm the round-trip is lossy at the histogram level (independent of which layer is responsible).

**Mechanism:** add temporary `console.log` instrumentation to `runAutoDistributionV2` in `exams-proctors.html`:
- Immediately after `var output = window.ProctorDistributionV2.run(input);` log `('[INV-A1] mem-hash=', hashRows(output.result), 'mem-hist=', histogramByProctorKey(output.result))`.
- Immediately before the auto-save call, log `('[INV-A2] save-hash=', hashRows(dataToSave.rows))`.
- Inside `saveV2ResultToLocalStorage`, after `JSON.stringify(payload.data)` (in the IPC handler), log byte length.
- Add a renderer-side roundtrip that calls `await window.api.examConfig.get(year, 'examAutoDistributionData')` immediately after the save resolves, and log `('[INV-A3] db-hash=', hashRows(roundtrip.rows), 'db-hist=', histogramByProctorKey(roundtrip.rows))`.

**Yes/no question:** does `mem-hash === db-hash`?
- If **yes**, the bug is downstream of the load (display-layer only — H5).
- If **no**, the bug is in save/IPC/DB — proceed to Phase B.

### Phase B — Bisect: standalone JSON `stringify`/`parse` (no IPC, no DB)

**Goal:** test whether the loss is in the JSON layer alone.

**Mechanism:** new script `scripts/inv-roundtrip-json.js` that loads the fixture, runs `V2.run`, then computes `R2 = JSON.parse(JSON.stringify(out.result))`, then asserts `histogramByProctorKey(out.result) === histogramByProctorKey(R2)`.

**Yes/no question:** does the histogram survive a pure JSON roundtrip?
- If **no**, root cause is H1 (shared references producing accidental aliasing in algorithm output that JSON cannot represent). Proceed to design a deep-clone fix in v2.js.
- If **yes**, the JSON layer is innocent. Proceed to Phase C.

### Phase C — Standalone SQLite `data_json` round-trip (no IPC)

**Goal:** test whether the loss is in the DB layer alone.

**Mechanism:** new script `scripts/inv-roundtrip-sqlite.js` that opens a temporary DB with `better-sqlite3`, creates an `exam_config_data` table with the production DDL (verbatim from `main/db/migrations.js`), inserts `JSON.stringify(out.result)` into a row, reads it back, calls `JSON.parse`, and asserts histogram equality.

**Yes/no question:** does the histogram survive a SQLite TEXT round-trip?
- If **no**, root cause is H3 (SQLite truncation or encoding). Highly unlikely; if it fires, escalate to a schema migration design discussion.
- If **yes**, the DB layer is innocent. Proceed to Phase D.

### Phase D — Standalone IPC layer test (no DB)

**Goal:** test whether the loss is in `contextBridge` / `ipcMain.handle`.

**Mechanism:** new minimal Electron test (or a renderer-side harness on `exams-proctors.html`) that calls `window.api.examConfig.save({…, data: out.result})` for a temporary throwaway `config_key` (e.g., `examAutoDistributionOptions` cleared after the test), then calls `window.api.examConfig.get(year, 'examAutoDistributionOptions')`, then asserts histogram equality.

**Yes/no question:** does the histogram survive a real save+load cycle?
- If **no**, the bug is between `save` and `get` end-to-end — root cause is H2 or some interaction. Drill into the structuredClone behavior with a structural diff between input and output.
- If **yes**, the bug is not in the IPC+DB pipeline at all. Proceed to Phase E.

### Phase E — Display aggregation test (no save trigger)

**Goal:** test whether the loss is in `buildSummaryRows()`.

**Mechanism:** new test `tests/inv-display-aggregation.test.js` that:
- Runs `V2.run` on the fixture in Node (sandboxed).
- Hand-writes `R_mem` directly into a temporary in-memory representation.
- Invokes the same aggregation logic as `buildSummaryRows()` (extracted into a pure helper or replicated verbatim) on `R_mem`.
- Asserts `histogramByProctorKey(R_mem) === histogramFromTeacherMap(rendered)`.

**Yes/no question:** does the renderer aggregation preserve per-key counts?
- If **no**, root cause is H5 — the aggregation is lossy. Proceed to specify the fix in `exams-rooms.html` and `exams-proctors.html`'s summary helpers.
- If **yes**, the bug is exclusive to the auto-save race. Proceed to Phase F.

### Phase F — Auto-save race test

**Goal:** test whether the loss is a race between concurrent saves and reads.

**Mechanism:** in the renderer harness, disable the auto-save call at line ~2749 (comment it out for the test). Run the algorithm twice in succession on the same fixture. Click حفظ النتيجة manually. Compare DB after manual save against the most recent `R_mem`.

**Yes/no question:** does the discrepancy persist with auto-save disabled?
- If **no**, root cause is H4 (the auto-save races with the user's expected save semantics, persisting an older or partially-written payload).
- If **yes**, the investigation has eliminated all five hypotheses — escalate, hypothesize again, do not patch.

### Investigation Decision Tree

```
Phase A: mem-hash == db-hash?
├── yes → Phase E (display only)
│   └── aggregation preserves counts?
│       ├── no  → Fix H5: aggregate by proctor_keys
│       └── yes → Phase F (auto-save race)
└── no  → Phase B (JSON only)
    ├── histogram lost in JSON?  → Fix H1: deep-clone in algorithm output
    └── intact → Phase C (SQLite only)
        ├── histogram lost in SQLite? → Fix H3: schema/encoding
        └── intact → Phase D (IPC only)
            ├── histogram lost in IPC? → Fix H2: serialize before IPC
            └── intact → re-hypothesize (escalate)
```

The investigation phases A–F are themselves the structural backbone of the fix. The fix specification below covers the most likely outcome (H5 confirmed), with conditional alternates listed.

## Architecture Overview — Edit Sites

The table below enumerates every file the bugfix may touch, with the change scope determined by which hypothesis the investigation confirms. **Files marked v2.js are out-of-scope unless the investigation explicitly proves H1.**

| # | File | Function / Region | Lines (approx) | Change type | Triggered by |
|---|------|-------------------|----------------|-------------|--------------|
| 1 | `exams-rooms.html` | `buildSummaryRows()` | 821–877 | Aggregate by `proctor_keys` not by `proctors` (name); resolve back to display name via a key→name map built once from `proctorsList` | H5 |
| 2 | `exams-proctors.html` | `runAutoDistributionV2`, auto-save call | ~2749 | `await` the save Promise so subsequent reads see the latest write; or remove the auto-save and rely on the explicit حفظ button (decision in design) | H4, plus precondition for any fix |
| 3 | `exams-proctors.html` | `saveV2ResultToLocalStorage` | ~2790 | Optional: deep-clone `output.result` before passing to IPC to defang shared references in `reserves` | H1 (defensive only; the JSON.stringify performed by IPC already deep-clones) |
| 4 | `main/ipc/exam-config-data.js` | `examConfigData:save` | 51–69 | No change unless H2/H3 fires | H2 / H3 |
| 5 | `main/db/migrations.js` | exam_config_data table | 1267–1278 | No change (Requirement 3.5) | none |
| 6 | `js/algorithms/proctor-distribution-v2.js` | `phase2_5PopulateReserves` | 2518–2740 | No change unless H1 explicitly proven; if proven, replace shared array assignment with per-row deep copy at the boundary that produces `out.result` | H1 only |

All edits preserve var-style ES2019 to match existing project style. The `exam_config_data` schema is unchanged (Requirement 3.5). The fix is scoped to the keys and aggregation logic for `examAutoDistributionData`; the other 12 config keys do not flow through the same aggregator and so are unaffected by the H5 fix.

### Key→name resolution helper (H5 fix)

If H5 is confirmed, both `exams-rooms.html` (`buildSummaryRows`) and the related summary helpers in `exams-proctors.html` (`buildAutoLoadStateFromRows`, `buildAutoDistributionSummary`, `rebuildAutoDistributionSummaryFromRows`) must aggregate by `proctor_keys[i]` and resolve to a display name via a single helper:

```pascal
FUNCTION resolveProctorDisplayName(key, proctorsList)
  IF key matches /^__idx_(\d+)$/ THEN
    idx := parse integer
    RETURN proctorsList[idx]?.teacher_name OR key
  ELSE
    // CIN-keyed
    proc := proctorsList.find(p => p.cin === key)
    RETURN proc?.teacher_name OR key
  END
END FUNCTION
```

The helper lives in a single location consumable from both renderer pages — either added to `js/data/system-tag-types.js` (no, wrong domain) or to a new `js/data/proctor-key-resolver.js` module. The chosen home is `js/data/proctor-key-resolver.js` to keep separation of concerns; `exams-rooms.html` already loads multiple `js/data/*.js` modules, so the loader path is well-trodden.

## Correctness Properties

Property 1: Bug Condition — DB↔Memory histogram round-trip is the identity

_For any_ input `(fixture, schoolYear)` where the bug condition holds (`isBugCondition` returns true on the pre-fix code), the post-fix system SHALL produce a DB-loaded result `R_db` whose per-proctor key histogram equals the in-memory histogram `H_mem`, with `count_db(K) = count_mem(K)` for every proctor key `K`, and with `maxLoad`, `totalSlotsFilled`, and `proctorsCounted` all equal across `R_mem` and `R_db`.

**Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 2.7**

Property 2: Preservation — Non-buggy paths and non-buggy keys are byte-equivalent

_For any_ input `(year, key, payload)` where the bug condition does NOT hold (either `key ≠ 'examAutoDistributionData'`, or the algorithm output contains zero proctor name collisions across distinct keys, or the input is the verify-fixture script that bypasses IPC/DB entirely), the post-fix code SHALL produce the same persisted bytes and the same loaded JS value as the pre-fix code, preserving:
- All 12 non-`examAutoDistributionData` config keys' round-trip behavior.
- The Node-only `verify-fixture.js` and `verify-real-centre.js` outputs.
- The existing `proctor-v2-*.test.js` test outcomes.
- The `exam_config_data` schema (no migration).
- The `getProctorKey` synthetic-key encoding for proctors with empty `cin`.
- Pre-fix saved DB rows' loadability (load path is backward compatible; no silent rewrite).

**Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

Property 3: Idempotence — save → load → save → load is fixpoint

_For any_ input `(fixture, schoolYear)`, the operation `loadViaProductionPath ∘ persistViaProductionPath` applied twice in succession to `R_mem` SHALL return a value equal (modulo canonical key ordering) to the value returned after one application; equivalently, the persisted bytes after the second save SHALL equal the persisted bytes after the first save.

**Validates: Requirement 2.4**

## Fix Implementation

Three implementation tracks are specified, one per likely hypothesis. Only the track that matches the investigation's confirmed root cause is executed. All tracks share the precondition that the auto-save Promise must be awaited (a low-risk hardening that benefits every downstream fix).

### Precondition (always applied) — Auto-save is awaited

**File**: `exams-proctors.html`

**Function**: `runAutoDistributionV2`

**Specific change**: line ~2749 currently calls `saveV2ResultToLocalStorage(output)` without `await`. Change to `await saveV2ResultToLocalStorage(output)`. The function is already `async`, the call site is already `async`. This eliminates the race surfaced by H4 even if the actual root cause is H5.

Risk: extends the run-to-rendered latency by one IPC round-trip (~5–20 ms). Benefit: load-after-save in `exams-rooms.html` now sees the latest write deterministically. No change to persistence shape.

### Track H5 (highest prior) — Display aggregator keys by `proctor_keys`

**File**: `exams-rooms.html`

**Function**: `buildSummaryRows()`

**Specific changes**:

1. Build a key→name resolver once at the top of `buildSummaryRows` from `await window.api.examProctors.getAll(getSchoolYear())`. The resolver maps `cin || ('__idx_' + idx)` to `teacher_full_name || teacher_name`.
2. Replace the iteration `(row.proctors || []).forEach(name => …)` with `(row.proctor_keys || []).forEach((key, slotIdx) => …)`. Resolve display name via the resolver. Aggregate `teacher.guardCount`, `teacher.guardHours`, `teacher.guard.push(…)` by **key**, not by name.
3. Apply the same key-based aggregation to the `reserves` block (use `row.reserve_keys`) and to the `duty_teachers` block (use `row.duty_teacher_keys` if present; otherwise fall back to name as before — this matches the pre-fix behavior for legacy rows that were saved before key fields were added).
4. Backward compatibility: if `row.proctor_keys` is missing or empty (pre-fix legacy row), fall back to the existing name-based aggregation. This preserves Requirement 3.7.

**File**: `exams-proctors.html`

**Functions**: `buildAutoLoadStateFromRows`, `buildAutoDistributionSummary`, `rebuildAutoDistributionSummaryFromRows`, `getFairnessReport`.

**Specific changes**: same key-based aggregation in each helper. The `loadState` returned by `buildAutoLoadStateFromRows` is already keyed by proctor key internally (it constructs the state from `proctor_keys`), but the summary builder converts back to names; verify whether it is the conversion site or the row-iteration site that mis-buckets.

**File**: `js/data/proctor-key-resolver.js` (new)

**Content**: pure function `resolveProctorDisplayName(key, proctorsList)` exported as `window.GS2.resolveProctorDisplayName` per the project's vanilla-renderer-script convention.

### Track H1 (only if investigation Phase B fails) — Deep-clone before output

**File**: `js/algorithms/proctor-distribution-v2.js`

**Function**: `run` (≈line 4470, just before returning the result object).

**Specific change**: before returning, deep-clone `result` rows to break shared `reserves` / `reserve_keys` aliasing. Use `JSON.parse(JSON.stringify(result))` (the simplest, project-style approach). This narrows the v2.js change to a single line at the output boundary, preserving the shared-reference invariant during Phase 3 swap moves but emitting independent rows downstream.

This is the only acceptable v2.js modification under Requirement 2.9.

### Track H2/H3/H4 (only if investigation explicitly proves)

If H2: serialize the result with `JSON.stringify` in the renderer before passing to IPC, ensuring the IPC layer sees a string (not a structured object). Adjust the IPC handler to accept either pre-stringified or object payload, dispatching on type.

If H3: escalate to a schema design discussion. Likely additive (e.g., switch `data_json` to `BLOB` with explicit UTF-8 encoding marker). Out of scope at design time.

If H4 alone: the precondition `await` on the auto-save eliminates the race; no further change.

## Edge Cases Handled

| # | Edge case | Behavior | Where addressed |
|---|-----------|----------|------------------|
| 1 | All 147 proctors have empty `cin` (production environment) | `getProctorKey` returns `__idx_N` deterministically; the H5 fix aggregates by these keys, eliminating name-merge collisions | Track H5 — `proctor-key-resolver.js`, `buildSummaryRows` |
| 2 | Pre-fix saved DB row (no `proctor_keys` field on rows) | `buildSummaryRows` falls back to name-based aggregation; no error, possibly some merging persists for that legacy row but no regression versus pre-fix display | Track H5 fallback branch in `buildSummaryRows` |
| 3 | Two distinct proctors share the same `teacher_name` | Track H5 splits them by `proctor_keys`; display label appends nothing (names are the same in UI) but counts no longer merge | Track H5 |
| 4 | Other 12 config keys (e.g., `examPeriodsData`) | Untouched by the fix; round-trip through `examConfigData:save/get` is unchanged | Scope guarantee in Architecture Overview |
| 5 | Race between auto-save and manual حفظ click | `await` on the auto-save serializes the saves; manual click cannot complete before the auto-save settles | Precondition |
| 6 | Shared array references (`reserves` aliased across rows) | `JSON.stringify` in IPC handler always materializes independent arrays on parse; the H5 fix aggregates by `proctor_keys` which are not aliased; even if `reserves` aliasing matters elsewhere, Phase A confirms it is not the histogram source | Track H5 (no v2.js touch); fallback to Track H1 if Phase B refutes |
| 7 | New proctor added between save and load (e.g., admin edits proctor list) | Resolver falls back to the raw `__idx_N` key as the display name, surfacing the data corruption to the user instead of silently merging | Track H5 — `resolveProctorDisplayName` |
| 8 | Proctor with `cin` set (production-like environment) | Key path is `cin`, no synthetic key; aggregation by key gives the same answer as aggregation by name in the absence of duplicate names; no behavioral change | Track H5 |
| 9 | Save called while a previous save is in-flight (rapid double-click of distribute) | `await` serializes; the second save's bytes are the second run's bytes | Precondition |
| 10 | DB row pre-existing under buggy save path | Load returns it; display falls back to name-aggregation for that row only; no rewrite, no migration | Track H5 fallback branch |

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Schema migration risk | Low | High (cross-feature DB lock) | Schema unchanged (Requirement 3.5); investigation Phase C explicitly tests the existing TEXT column with the production DDL; if H3 fires the design escalates before any migration is written |
| Breakage of other 12 config keys | Low | High (every exams page depends on these) | The H5 fix is in renderer aggregation only and is gated on `key === 'examAutoDistributionData'` (no IPC handler change); the H1 fix is in the algorithm output boundary, scoped to one return statement; the H2/H3 fixes (if forced) would be in the IPC handler and would need a per-key dispatch |
| Pre-existing buggy DB rows after fix | Medium | Medium | Load path is backward-compatible: `buildSummaryRows` falls back to name-aggregation when `proctor_keys` is missing on a row; no silent rewrite (Requirement 3.7) |
| Auto-save `await` introduces UI latency | Low | Low | One IPC round-trip is ~5–20 ms in Electron 35; user-visible impact is negligible compared to algorithm runtime (~100 ms) |
| Wrong root cause confirmed | Low | High | Investigation phases A–F are mutually exclusive yes/no questions on standalone harnesses; if the chosen track does not eliminate the bug condition on the fixture, the test in Track 1 of the test plan fails immediately and re-hypothesis is forced |
| Hidden v2.js dependency on shared references | Medium | High | If H1 forces a v2.js fix, the deep-clone is at the output boundary only (after Phase 3 completes); the in-algorithm shared-reference invariant remains intact for Phase 3 swap correctness |
| Renderer key-resolver lookup performance | Low | Low | `resolveProctorDisplayName` runs once per slot in 191 rows × ~2 slots = ~382 calls; the proctorsList Map can be precomputed once per `buildSummaryRows` invocation |
| New `js/data/proctor-key-resolver.js` not loaded on a page that needs it | Low | Medium | The resolver is referenced only from pages already updated as part of this fix (`exams-rooms.html`, `exams-proctors.html`); load-order verified at design review |
| User reverts auto-save expectation post-fix | Low | Low | The precondition only `await`s the existing call; it does not change the user-visible flow (data still persists on every run, just deterministically) |
| Sync outbox capture for `examConfigData:save` channel | Low | Medium | The channel name is unchanged; the payload shape is unchanged; the sync capture continues to capture a serialized JSON identical to today; no sync regression |

## Testing Strategy

### Validation Approach

Two-phase: surface counterexamples on the unfixed code via exploratory tests, then verify the fix preserves existing behavior via fix-checking and preservation property tests. The fixture `tests/fixtures/45454.json` is the primary input. A synthetic adversarial fixture (two proctors sharing a name) is added for the H5 path. The Electron renderer path is exercised via a dedicated harness file; the JSON layer and SQLite layer are exercised via Node-only scripts.

### Exploratory Bug Condition Checking

**Goal:** surface counterexamples that demonstrate the bug BEFORE implementing the fix; confirm or refute each hypothesis in turn.

**Test Plan:** create six investigation harnesses, one per phase A–F. Each is a minimal script that answers one yes/no question. They run in order; the first one to localize the divergence determines which fix track is executed.

**Test Cases:**
1. **Phase A — `tests/inv-a-instrument-roundtrip.test.js`** (Electron renderer test, will fail on unfixed code): runs the algorithm, hashes `R_mem`, hashes `R_db` after IPC roundtrip, asserts equality. Expected: hashes differ on unfixed code.
2. **Phase B — `scripts/inv-roundtrip-json.js`** (Node-only, may fail or pass): pure JSON.stringify/parse round-trip on `R_mem`. Expected: passes (refutes H1) — refutation moves us to Phase C.
3. **Phase C — `scripts/inv-roundtrip-sqlite.js`** (Node-only): writes `JSON.stringify(R_mem)` to a temporary `exam_config_data` table, reads back, parses, compares histogram. Expected: passes (refutes H3).
4. **Phase D — `tests/inv-d-ipc-passthrough.test.js`** (Electron test): saves `R_mem` under a throwaway key, loads, compares histogram. Expected: passes (refutes H2).
5. **Phase E — `tests/inv-e-display-aggregation.test.js`** (Node test): replicates `buildSummaryRows` aggregation on `R_mem`, asserts per-key histogram equality. Expected: **fails on unfixed code** — this is the H5 confirmation.
6. **Phase F — `tests/inv-f-autosave-race.test.js`** (Electron test, conditional on E passing): runs the algorithm twice with auto-save disabled, compares the second `R_mem` to the manual-save DB read. Expected: passes if H4 alone is the cause; otherwise inconclusive.

**Expected Counterexamples:**
- Phase A: `mem-hash ≠ db-hash` for the production fixture.
- Phase E: `histogramByName(R_mem) === histogramByDB(R_db)`, demonstrating that the display aggregator collapses keys into name buckets.
- Possible causes ruled out by phases B/C/D before Phase E fires: pure JSON loss, SQLite truncation, IPC structuredClone artifact.

### Fix Checking

**Goal:** verify that for all inputs where the bug condition holds on the unfixed code, the fixed code produces the expected behavior (`histogramByProctorKey` round-trip is the identity).

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition_pre_fix(X) DO
  R_mem := V2.run(X).result
  persistViaProductionPath(R_mem, X.schoolYear, 'examAutoDistributionData')
  R_db  := loadViaProductionPath(X.schoolYear, 'examAutoDistributionData')

  ASSERT histogramByProctorKey(R_mem) = histogramByProctorKey(R_db)
  ASSERT maxLoad(R_mem)               = maxLoad(R_db)
  ASSERT totalSlotsFilled(R_mem)      = totalSlotsFilled(R_db)
  ASSERT proctorsCounted(R_mem)       = proctorsCounted(R_db)
END FOR
```

The PBT generator yields fixtures with `proctorsList` built from random combinations of `cin` (sometimes empty), `teacher_name` (sometimes colliding), and `__idx_N` synthetic keys. The fixture domain spans both buggy (collisions present) and non-buggy (no collisions) inputs.

### Preservation Checking

**Goal:** verify that for all inputs where the bug condition does NOT hold, the post-fix pipeline produces the same DB-persisted bytes and the same loaded JS value as the pre-fix pipeline.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  pre_bytes  := persist_with_pre_fix(X)
  post_bytes := persist_with_post_fix(X)
  ASSERT canonical(pre_bytes)  = canonical(post_bytes)

  pre_js  := load_with_pre_fix(X)
  post_js := load_with_post_fix(X)
  ASSERT pre_js = post_js
END FOR
```

**Testing Approach:** Property-based testing with `fast-check` is recommended because:
- The 12 non-`examAutoDistributionData` keys carry arbitrary nested JSON shapes; property-based generation gets coverage across the shape space cheaply.
- Hand-written unit tests would miss interactions between specific shapes and the IPC handler's key validation logic.
- The preservation property is a strong "no behavioral change" guarantee that needs many witnesses across the input domain to be credible.

**Test Plan:** observe behavior on the **unfixed code** first for the 12 non-`examAutoDistributionData` keys (record persisted bytes for synthetic and real payloads), then write property-based tests that re-run the same payloads through the **post-fix code** and compare bytes verbatim. For the `examAutoDistributionData` key with no collisions in the input, do the same.

**Test Cases:**
1. **Other-config-keys preservation**: PBT generates `(year, key, payload)` triples with `key ∈ VALID_CONFIG_KEYS \ {'examAutoDistributionData'}` and arbitrary JSON payloads; asserts `save → load` is the identity pre/post.
2. **No-collision fixture preservation**: pre-fix bytes for `tests/fixtures/45454.json` after de-duplicating any colliding `teacher_name` (synthetically rename collisions away) match post-fix bytes.
3. **Pre-fix DB row loadability**: a hand-written legacy `data_json` (no `proctor_keys` on rows) loads without error post-fix and `buildSummaryRows` returns rows containing the same names as pre-fix.
4. **Schema preservation**: `PRAGMA table_info(exam_config_data)` returns the same DDL columns pre/post.
5. **`getProctorKey` stability**: for every proctor in the fixture, `getProctorKey(proc, idx)` pre-fix equals post-fix.
6. **Lint and test suite**: `npm run lint` and `npm test` produce zero new errors or warnings.

### Unit Tests

- `resolveProctorDisplayName` — table-driven cases for `cin`-keyed and `__idx_N`-keyed inputs, plus missing-proctor fallback.
- `buildSummaryRows` aggregation — fed a synthetic 3-row input with two proctors sharing a name, asserts counts split correctly.
- `buildAutoLoadStateFromRows` — same synthetic input, asserts `loadState` keys match `proctor_keys`.
- IPC handler boundary — given a payload with `proctor_keys` arrays, the round-trip preserves them byte-for-byte (smoke test, no regression).

### Property-Based Tests

- **P_roundtrip**: histogram(memory) === histogram(DB-after-load) for any randomly-generated fixture in the proctorsList × scheduleEntries × meAssignments × exemptionsData domain. Generator depth: ~50 cases of size 5–15 proctors, 2–6 schedule entries, runtime budget ~10s.
- **P_per_key**: count_db(K) === count_mem(K) for every key K in the union of memory and DB key sets.
- **P_idempotent**: save → load → save → load produces the same persisted bytes after the second save as after the first.
- **P_preservation_other_keys**: arbitrary `(year, key, payload)` for `key ≠ 'examAutoDistributionData'` round-trips identically.
- **P_preservation_no_collision**: for fixtures where `histogramByName` and `histogramByProctorKey` agree on `R_mem`, the persisted bytes are unchanged pre/post fix.
- **P_resolver_correctness**: for any `proctorsList` and any valid index `i`, `resolveProctorDisplayName(getProctorKey(proctorsList[i], i), proctorsList) === proctorsList[i].teacher_name` (or the appropriate fallback).

### Integration Tests

- **End-to-end real fixture**: load `tests/fixtures/45454.json` into a renderer harness, run the algorithm, auto-save (now `await`ed), navigate to `exams-rooms.html`, assert the displayed histogram matches `{1:7, 2:66, 3:81}` max=3.
- **Cross-page consistency**: after running auto-distribute in `exams-proctors.html`, the on-page summary table and the `exams-rooms.html` summary must show the same histogram and the same per-teacher counts.
- **Visual feedback**: after a successful save, the toast message is shown and the histogram badge updates without requiring a page refresh.
- **Pre-fix DB compatibility**: load a manually-crafted `data_json` row with the legacy shape (rows missing `proctor_keys`) and verify `exams-rooms.html` renders without errors.
- **Auto-save race**: rapid succession of two distribute runs followed by navigation to `exams-rooms.html`; the displayed histogram corresponds to the second run, not the first.
