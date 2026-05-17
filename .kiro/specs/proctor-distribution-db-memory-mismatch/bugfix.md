# Bugfix Requirements Document

## Introduction

After running auto-distribution in `exams-proctors.html`, the in-memory algorithm output and the DB-saved/DB-loaded distribution show different per-proctor load histograms for the same algorithm output, on the same fixture, with no user-initiated mutations between the run and the read. Concretely, on the production fixture used for verification:

| Source | Histogram (load → count of proctors) | Max load | Total slots filled | Proctors counted |
|---|---|---|---|---|
| Memory (immediately after `V2.run()` returns) | `{1:7, 2:66, 3:81}` | 3 | 382 | 154 |
| DB (after auto-save, then re-read) | `{2:61, 3:84, 4:2}` | 4 | 382 | 147 |

Total slots agree (382), but seven proctor keys show `db_count = memory_count + 1`, and the per-proctor distribution is therefore corrupted in storage. As a result, the UI presents `max=4` to the user even though the algorithm produced `max=3` in memory, undermining the fairness guarantees delivered by the closed spec `proctor-v2-fairness-undercovered-fix` (closed 2026-05-16).

The full investigation context, reproduction steps, suspected root causes, file map, and DB location are documented in:

- `/home/chekaoumi/Desktop/gestionScholaire2/.agent/db-memory-distribution-mismatch.md`

This bugfix targets the storage/IPC/display path. The algorithm in `js/algorithms/proctor-distribution-v2.js` is confirmed correct in memory (P1, P2, P3 PASS on the fixture and synthetic suite) and is **out of scope** for code modification unless investigation phase proves it the root cause. The fix must be methodical and structural — no opportunistic patches.

### Bug Condition C(X)

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X = (fixture, schoolYear) loaded into exams-proctors.html
  OUTPUT: boolean

  // Run the V2 algorithm in-renderer and capture the in-memory result
  memoryResult ← runV2InMemory(X)

  // Persist the result through the production save path
  // (auto-save on line ~2749 of exams-proctors.html, IPC channel that writes
  //  the examAutoDistributionData key into table exam_config_data)
  persistViaProductionPath(memoryResult)

  // Re-read the persisted result through the production load path
  // (the same path used by exams-rooms.html buildSummaryRows())
  dbResult ← loadViaProductionPath(X)

  memoryHist ← histogramByProctorKey(memoryResult)   // key → count
  dbHist     ← histogramByProctorKey(dbResult)

  // Bug fires when the per-proctor count differs for at least one key,
  // i.e. the round-trip is not the identity on the proctor-key histogram.
  RETURN EXISTS K SUCH THAT memoryHist[K] ≠ dbHist[K]
END FUNCTION
```

Equivalent observable form of C(X): `loadHistogram(memoryResult) ≠ loadHistogram(dbResult)` for the same `(fixture, schoolYear)` with no user-initiated mutations between save and load.

### Property P (Fix Checking)

```pascal
// Property: Fix Checking — DB↔Memory distribution round-trip is lossless
FOR ALL X WHERE isBugCondition_pre_fix(X) DO
  memoryResult ← runV2InMemory(X)
  persistViaProductionPath(memoryResult)
  dbResult     ← loadViaProductionPath(X)

  ASSERT histogramByProctorKey(memoryResult) = histogramByProctorKey(dbResult)
  ASSERT maxLoad(memoryResult)               = maxLoad(dbResult)
  ASSERT totalSlotsFilled(memoryResult)      = totalSlotsFilled(dbResult)
  ASSERT proctorsCounted(memoryResult)       = proctorsCounted(dbResult)

  // Stronger structural identity (canonical form, see clause 2.5):
  ASSERT canonical(memoryResult.rows) = canonical(dbResult.rows)
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking — non-buggy paths are identical pre/post fix
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X)  = F'(X)   // load path returns same data
  ASSERT save_then_load(F, X) = save_then_load(F', X)
END FOR
```

Where `F` is the storage/IPC/display pipeline before the fix and `F'` is the same pipeline after the fix.

## Bug Analysis

### Current Behavior (Defect)

What currently happens when the bug is triggered.

1.1 WHEN the V2 algorithm produces an in-memory result `R_mem` with histogram `{1:7, 2:66, 3:81}` (max=3) and the renderer follows the production auto-save path THEN the DB row for key `examAutoDistributionData` stores a result `R_db` whose histogram is `{2:61, 3:84, 4:2}` (max=4) for the same `(fixture, schoolYear)` with no user-initiated mutations between save and read.

1.2 WHEN `R_mem` and `R_db` are compared per proctor key after the round-trip THEN the system reports at least one proctor key `K` for which `count_db(K) ≠ count_mem(K)` (observed: 7 keys with `count_db(K) = count_mem(K) + 1`).

1.3 WHEN the total slot count is computed from `R_mem` and from `R_db` THEN the totals agree (both 382), yet the per-proctor distribution differs, indicating that the round-trip preserves aggregate sums while corrupting per-proctor identity.

1.4 WHEN the user runs auto-distribute in `exams-proctors.html` without clicking حفظ النتيجة (save) THEN the renderer still writes the result to persistent DB storage via the auto-save call near line 2749, and that auto-save runs unconditionally on every algorithm run.

1.5 WHEN the user navigates to `exams-rooms.html` (or refreshes `exams-proctors.html`) THEN `buildSummaryRows()` reads from DB and renders a histogram with `max=4`, even though the most recent in-memory algorithm output had `max=3`.

1.6 WHEN the same fixture is run through `scripts/verify-fixture.js` (no IPC, no DB) THEN the algorithm produces `max=3` correctly, confirming the discrepancy is introduced by the storage/IPC/display path and not by the algorithm itself.

1.7 WHEN diagnostic output is examined THEN the DB-rendered result is observed to count 147 distinct proctor keys while the in-memory result counts 154, even though both sum to 382 slots, indicating that some proctor keys present in memory are absent from (or merged in) the DB-loaded view.

### Expected Behavior (Correct)

What should happen instead.

2.1 WHEN the V2 algorithm produces an in-memory result `R_mem` and the renderer follows the production save path THEN the DB-loaded result `R_db` SHALL be observationally equivalent to `R_mem` on the proctor-key histogram, i.e. `histogramByProctorKey(R_mem) = histogramByProctorKey(R_db)`.

2.2 WHEN `R_mem` and `R_db` are compared after the round-trip THEN the system SHALL satisfy `count_db(K) = count_mem(K)` for every proctor key `K`, with zero mismatches.

2.3 WHEN the same `(fixture, schoolYear)` is auto-distributed and persisted THEN the DB-rendered histogram SHALL report the same `max load`, the same total slot count, and the same total distinct proctor count as the in-memory result returned by `V2.run()`.

2.4 WHEN the user runs auto-distribute in `exams-proctors.html` THEN the renderer SHALL persist the result through a single, deterministic, well-defined save path whose semantics are documented; the auto-save behavior on line ~2749 SHALL be made explicit (either disabled in favor of the existing حفظ النتيجة button, or made deterministic, idempotent, and free of races with subsequent reads). The chosen option SHALL be selected during the design phase of this spec.

2.5 WHEN `R_mem` is serialized for DB storage and re-deserialized on load THEN the round-trip SHALL preserve a canonical structural representation of the result rows. Specifically, for every result row, the multiset of `proctor_keys` (and any equivalent representation such as `proctors` / `reserves` arrays used by display code) SHALL be byte-equal after `JSON.stringify` → DB column write → DB column read → `JSON.parse`, modulo only key ordering inside objects.

2.6 WHEN `exams-rooms.html` calls `buildSummaryRows()` to aggregate the DB-loaded result THEN aggregation SHALL use the exact same proctor-key identity function (`getProctorKey`) used by the algorithm and the save path, so that no proctor key is split, merged, or attributed to a different bucket between the algorithm output and the displayed histogram.

2.7 WHEN the algorithm output contains shared array references across rows (e.g. `phase2_5PopulateReserves` outputs sharing `proctors` / `reserves` arrays) THEN the save path SHALL deep-clone or otherwise normalize the data before persistence so that no later in-memory mutation, no key-collision in serialization, and no aliasing artifact can change `R_db` relative to `R_mem`.

2.8 WHEN the bug is investigated THEN the investigation SHALL proceed methodically and structurally as a sequence of phases (instrument → hash-compare → isolate → fix), and the fix SHALL be applied at the structural root cause identified by the investigation, not as a localized symptom-suppressing patch. (User constraint: "يجب ان يكون الحل منهجي وهيكلي".)

2.9 WHEN the investigation localizes the divergence THEN the fix SHALL be applied to the smallest set of files among the suspected scope: `main/ipc/exam-config-data.js`, `exams-proctors.html` (auto-save trigger near line 2749), and/or `exams-rooms.html` (`buildSummaryRows` aggregation). The file `js/algorithms/proctor-distribution-v2.js` SHALL NOT be modified by this spec unless the investigation phase explicitly proves it is the root cause and that finding is recorded in the design document.

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved.

3.1 WHEN the V2 algorithm runs against `tests/fixtures/45454.json` via `scripts/verify-fixture.js` (no IPC, no DB) THEN the system SHALL CONTINUE TO produce the same in-memory result as before the fix: histogram `{1:7, 2:66, 3:81}`, max=3, P1/P2/P3 PASS.

3.2 WHEN `scripts/verify-real-centre.js` is executed THEN the system SHALL CONTINUE TO PASS P1, P2, and P3 on the real-centre fixture.

3.3 WHEN any of the existing v2 tests are run (`tests/proctor-v2-fairness-undercovered-exploration.test.js`, `tests/proctor-v2-fairness-undercovered-preservation.test.js`, `tests/proctor-v2-fairness-undercovered-collect-unit.test.js`, and the 46 in-scope tests from the closed spec) THEN they SHALL CONTINUE TO PASS.

3.4 WHEN the user clicks حفظ النتيجة (the explicit save button, distinct from auto-save) THEN the system SHALL CONTINUE TO persist the latest in-memory result to DB and SHALL CONTINUE TO be visible to `exams-rooms.html` after navigation.

3.5 WHEN the DB schema for `exam_config_data` (columns `school_year`, `config_key`, `data_json`) is inspected after the fix THEN it SHALL CONTINUE TO match the existing schema; this bugfix SHALL NOT introduce a migration unless the design phase explicitly determines a migration is required, and in that case the migration SHALL be additive (no destructive column changes).

3.6 WHEN any existing config key other than `examAutoDistributionData` is written or read through `main/ipc/exam-config-data.js` THEN the round-trip behavior for those keys SHALL CONTINUE TO be identical pre-fix and post-fix (preservation: `F(X) = F'(X)` for `NOT isBugCondition(X)`).

3.7 WHEN a user has a previously-saved (pre-fix) `examAutoDistributionData` row in the DB and opens `exams-rooms.html` after the fix THEN the load path SHALL CONTINUE TO display the saved data without erroring, even if that data was saved under the buggy save path; the fix MAY normalize on read but SHALL NOT silently rewrite or delete previously stored rows.

3.8 WHEN the renderer runs auto-distribute on a fixture for which the in-memory and DB results would have agreed pre-fix (no proctor-key mismatch on round-trip) THEN the post-fix system SHALL CONTINUE TO produce the same persisted bytes for that fixture (modulo intentional canonicalization), and the displayed histogram in `exams-rooms.html` SHALL be unchanged for that fixture.

3.9 WHEN proctor identity is resolved through `getProctorKey` for proctors with empty `cin` (using `__idx_N` synthetic keys, as in the user's environment of 147 proctors) THEN the system SHALL CONTINUE TO produce stable, deterministic keys across save/load, and SHALL CONTINUE TO support the existing 147-proctor / 191-row / 382-slot configuration without changing the meaning of those keys.

3.10 WHEN linting and tests are executed (`npm run lint`, `npm test`) after the fix THEN they SHALL CONTINUE TO produce zero new errors and zero new warnings relative to the closing state of `proctor-v2-fairness-undercovered-fix`.
