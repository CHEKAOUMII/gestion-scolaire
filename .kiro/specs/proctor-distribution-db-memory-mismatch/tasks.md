# Implementation Plan — DB↔Memory Distribution Mismatch

## Source Documents

- `.kiro/specs/proctor-distribution-db-memory-mismatch/bugfix.md` — Requirements (1.x defect, 2.x expected, 3.x preservation), bug condition C(X), property P, preservation goal.
- `.kiro/specs/proctor-distribution-db-memory-mismatch/design.md` — Investigation Plan (Phases A–F), Hypotheses H1–H5, Architecture Overview Edit Sites table, Correctness Properties P1/P2/P3, Edge Cases, Risk Register, Testing Strategy.
- `.agent/db-memory-distribution-mismatch.md` — Full investigation context, reproduction steps, console diagnostic, file map, DB location.

## Project Commands

- `npm test` — full test suite (must keep all 46 in-scope tests green).
- `npm run lint` — must produce zero new errors/warnings vs the closing state of `proctor-v2-fairness-undercovered-fix`.
- `node scripts/verify-fixture.js tests/fixtures/45454.json` — confirms in-memory algorithm preservation: histogram `{1:7, 2:66, 3:81}` max=3.
- `node scripts/verify-real-centre.js` — confirms P1, P2, P3 preservation on the real-centre fixture.

## Atomicity

Every leaf task is scoped to ≤ 1 hour of focused work. Investigation phases A–F are executed in order; each produces a yes/no answer that determines whether the next phase runs and which fix track is selected. **No production code is modified during phases A–F.** The fix is applied only after a hypothesis is confirmed.

## Annotation Legend

- `_Bug_Condition:` — reference to `isBugCondition` from design.md (Bug Details → Bug Condition).
- `_Expected_Behavior:` — reference to design.md Correctness Properties (P1/P2/P3).
- `_Preservation:` — reference to design.md Preservation Requirements / Property 2.
- `_Edit site:` — row number in design.md "Architecture Overview — Edit Sites" table (rows 1–6).
- `_File:` — concrete file path the executor will touch.
- `_Requirements:` — clause numbers from `bugfix.md` (1.x / 2.x / 3.x).
- `_Phase:` — Investigation Phase (A / B / C / D / E / F) when applicable.
- `_Hypothesis:` — H1 / H2 / H3 / H4 / H5 when applicable.

## User Constraints

- Solution must be methodical and structural ("يجب ان يكون الحل منهجي وهيكلي") — Requirement 2.8.
- Investigation phases A–F MUST be executed in order before any fix is committed.
- The fix track is determined by which phase confirms a hypothesis.
- `js/algorithms/proctor-distribution-v2.js` is **out of scope** unless H1 is explicitly confirmed (Requirement 2.9).
- `exam_config_data` schema is unchanged (Requirement 3.5).

---

## Tasks

- [x] 1. Write bug condition exploration test (round-trip histogram divergence on production fixture)
  - **Property 1: Bug Condition** — DB↔Memory Histogram Round-trip Diverges on Fixture 45454
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists.
  - **DO NOT attempt to fix the test or the code when it fails.**
  - **NOTE**: This test encodes the expected behavior — when it passes after the fix, it validates the round-trip identity.
  - **GOAL**: Surface the histogram-divergence counterexample on `tests/fixtures/45454.json` through the production IPC+DB path.
  - **Scoped PBT Approach**: For this deterministic bug, scope the property to the concrete failing case — the production fixture `tests/fixtures/45454.json` (147 proctors with empty `cin`, 191 rows, 382 slots).
  - Create `tests/inv-a-instrument-roundtrip.test.js` (Electron renderer-harness test) OR an equivalent manual reproduction script `scripts/inv-a-roundtrip-harness.js` that the executor runs from `exams-proctors.html` devtools console.
  - Tag the test header with `// @pre-fix exploratory test — EXPECTED to FAIL on F`.
  - Test body:
    - Load fixture into the renderer (or reproduce via the existing `runAutoDistributionV2` flow).
    - Run `R_mem ← window.ProctorDistributionV2.run(input).result`.
    - Compute `H_mem ← histogramByProctorKey(R_mem)`; expected `{1:7, 2:66, 3:81}`, max=3, 154 distinct keys, 382 slots.
    - Persist via production path: `await window.api.examConfig.save({ school_year, config_key: 'examAutoDistributionData', data_json: JSON.stringify({ rows: R_mem, algorithmVersion: 'v2', diagnostics: {} }) })`.
    - Re-read via production path: `R_db ← (await window.api.examConfig.get(school_year, 'examAutoDistributionData')).rows`.
    - Compute `H_db ← histogramByProctorKey(R_db)`.
    - **Assert** `H_mem` deep-equals `H_db`, `maxLoad(R_mem) === maxLoad(R_db)`, `proctorsCounted(R_mem) === proctorsCounted(R_db)`.
  - Run on UNFIXED code.
  - **EXPECTED OUTCOME**: Test FAILS — `H_mem = {1:7, 2:66, 3:81}` (max=3, 154 keys) ≠ `H_db = {2:61, 3:84, 4:2}` (max=4, 147 keys).
  - Document the counterexample in a notes file (`tests/inv-a-counterexample.md`):
    - Per-proctor mismatch list (7 keys with `count_db = count_mem + 1`): سعدية ادراق, ياسين بوهديد, ابراهيم وسميح, سناء اكلاو, بوعسيل محمد, plus two more from the diagnostic.
    - Conservation arithmetic: total slots agree (382), distinct-key shrinkage (154 → 147), all deltas +1 in DB direction.
  - Mark task complete when test is written, run, and failure is documented.
  - _Bug_Condition: `isBugCondition(input)` from design.md → `histogramByProctorKey(R_mem) ≠ histogramByProctorKey(R_db)` after `persistViaProductionPath ∘ run`._
  - _Expected_Behavior: design.md Property 1 — DB↔Memory histogram round-trip is the identity._
  - _File: `tests/inv-a-instrument-roundtrip.test.js` (new); fixture `tests/fixtures/45454.json`._
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3_
  - _Phase: A (instrument both layers — discriminator for the whole round-trip)_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** — Non-buggy paths and non-target keys are byte-equivalent
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on UNFIXED code first, then encode it.
  - Property-based testing generates many test cases for stronger preservation guarantees across the 12 other config keys and the no-collision fixture domain.
  - Create `tests/preservation-config-roundtrip.pbt.test.js` with three property suites:

  - [x] 2.1 P_preservation_other_keys (12 non-target config keys round-trip identically)
    - Use `fast-check` (already in `package.json`) to generate `(year, key, payload)` triples where `key ∈ { examCenterConfig, examCenterLevels, examCenterRoomsData, examCenterRoomsCount, examScheduleData, examPeriodsData, examDistributionRules, examExemptionsData, examDutyTeachersData, examMorningEveningData, examAutoDistributionOptions, examCandidatesData }` and `payload` is arbitrary nested JSON.
    - For each generated triple, observe pre-fix bytes: `pre ← await save(triple); pre_load ← await get(year, key)`.
    - Assert `JSON.stringify(pre_load) === JSON.stringify(payload)` (modulo key ordering — use a canonicalizer).
    - Run on UNFIXED code → must PASS (baseline).
    - _File: `tests/preservation-config-roundtrip.pbt.test.js` (new)._
    - _Edit site: row 4 (IPC handler) — verifies the handler is untouched by the fix._
    - _Preservation: design.md Property 2 — preservation for non-target keys; Edge Case 4._
    - _Requirements: 3.6, 3.10_

  - [x] 2.2 P_preservation_no_collision (fixtures with no name collisions are untouched)
    - Generate fixtures where every proctor has a unique `teacher_name` (de-duplicate by appending suffix to colliding names).
    - For such fixtures, the H5 collision bug cannot fire, so `histogramByName(R_mem) === histogramByProctorKey(R_mem)`.
    - Assert: pre-fix `R_db` equals post-fix `R_db` (when run after fix), and the displayed histogram is identical.
    - Run on UNFIXED code → must PASS (confirms baseline behavior on non-buggy inputs).
    - _File: `tests/preservation-config-roundtrip.pbt.test.js` (same file, second describe block)._
    - _Preservation: design.md Property 2; Edge Case 8 (proctor with `cin` set, no synthetic key)._
    - _Requirements: 3.1, 3.2, 3.3, 3.8_

  - [x] 2.3 P_resolver_correctness — `getProctorKey` stability test
    - For every proctor in `tests/fixtures/45454.json`, assert `getProctorKey(proc, idx)` is deterministic (same input → same key) and matches the expected `cin || ('__idx_' + idx)` shape.
    - Run on UNFIXED code → must PASS (encodes existing behavior to preserve).
    - This test will also be re-run post-fix to confirm key stability is unchanged.
    - _File: `tests/proctor-key-stability.test.js` (new)._
    - _Preservation: design.md Property 2 → `getProctorKey` synthetic-key encoding for empty-`cin` proctors._
    - _Requirements: 3.9_

  - **EXPECTED OUTCOME**: All three preservation suites PASS on UNFIXED code (confirms baseline behavior to preserve).
  - Mark task complete when tests are written, run, and passing on unfixed code.

- [x] 3. Direct unit tests for the affected functions
  - These tests target individual functions touched by Track H5 (the highest-prior fix track) so the fix can be validated at unit granularity, independent of IPC/DB.
  - Tests are written BEFORE the fix; the collision-case sub-test is expected to FAIL on F and PASS on F'.

  - [x] 3.1 Unit test for `buildSummaryRows()` aggregation behavior on synthetic 3-row inputs
    - Create `tests/build-summary-rows-unit.test.js`.
    - Build three synthetic test rows where two proctors share `teacher_name` "محمد" but have distinct `proctor_keys` (`__idx_5`, `__idx_42`):
      - Row 1: `proctor_keys = ['__idx_5'], proctors = ['محمد']`
      - Row 2: `proctor_keys = ['__idx_42'], proctors = ['محمد']`
      - Row 3: `proctor_keys = ['__idx_99'], proctors = ['أحمد']`
    - Extract `buildSummaryRows` aggregation logic into a pure helper or replicate it verbatim in the test.
    - Assert: aggregation by `proctor_keys` produces `__idx_5: 1, __idx_42: 1, __idx_99: 1` (3 distinct buckets).
    - Assert: aggregation by `proctors` (name) produces `محمد: 2, أحمد: 1` (2 buckets — collision case).
    - Run on UNFIXED code → name-aggregation passes (encodes current behavior); key-aggregation FAILS because the current code doesn't aggregate by key.
    - After fix → both pass; the displayed histogram uses key-aggregation.
    - _File: `tests/build-summary-rows-unit.test.js` (new); references `exams-rooms.html` `buildSummaryRows()` (≈line 821)._
    - _Edit site: row 1 (`exams-rooms.html` `buildSummaryRows()`)._
    - _Bug_Condition: `isBugCondition` triggered by name-collision aggregation (H5)._
    - _Expected_Behavior: design.md Property 1 — per-key histogram preserved._
    - _Hypothesis: H5_
    - _Requirements: 1.7, 2.6_

  - [x] 3.2 Unit test for `resolveProctorDisplayName` edge cases
    - Create `tests/resolve-proctor-display-name-unit.test.js`.
    - Table-driven cases (the helper does not exist yet — this test defines its contract):
      - `cin`-keyed: `key='AB123', proctorsList=[{cin:'AB123', teacher_name:'فاطمة'}, ...]` → `'فاطمة'`.
      - `__idx_N`-keyed: `key='__idx_5', proctorsList=[..., {cin:'', teacher_name:'سعيد'}, ...]` (idx 5) → `'سعيد'`.
      - Missing proctor (key not found): `key='__idx_999', proctorsList=[{...10 entries}]` → falls back to the raw key `'__idx_999'`.
      - Empty `teacher_name` field: `key='AB456', proctorsList=[{cin:'AB456', teacher_name:''}]` → falls back to `key`.
    - Run on UNFIXED code → FAILS (helper doesn't exist).
    - After fix → PASSES (helper is implemented in `js/data/proctor-key-resolver.js`).
    - _File: `tests/resolve-proctor-display-name-unit.test.js` (new); target helper `js/data/proctor-key-resolver.js` (new)._
    - _Edit site: row 1 (resolver helper consumed by `buildSummaryRows`)._
    - _Hypothesis: H5_
    - _Requirements: 2.6, 3.9_
    - _Edge cases addressed: design.md Edge Cases 1, 2, 7, 8._

  - **EXPECTED OUTCOME**: collision case in 3.1 FAILS on F, all sub-tests PASS on F'. Resolver test in 3.2 FAILS on F (helper missing), PASSES on F'.

- [x] 4. Investigation phases — execute in order, each produces a yes/no decision
  - **CRITICAL**: phases run in order A → B → C → D → E → F. The first phase that confirms a hypothesis terminates the chain and selects the corresponding fix track in Task 6. No production code is modified during phases A–F.
  - All phase outputs are captured to `tests/inv-notes.md` (one section per phase) for traceability.

  - [x] 4.A Phase A — Instrument both layers (memory hash vs DB hash)
    - **Goal**: confirm the round-trip is lossy at the histogram level (independent of which layer is responsible).
    - Add temporary `console.log` instrumentation to `runAutoDistributionV2` in `exams-proctors.html`:
      - After `var output = window.ProctorDistributionV2.run(input);` log `[INV-A1] mem-hash=<hash>, mem-hist=<hist>`.
      - Just before the auto-save call, log `[INV-A2] save-hash=<hash>` on the payload.
      - In `main/ipc/exam-config-data.js` after `JSON.stringify(payload.data)`, log byte length.
      - Add a renderer-side roundtrip after save resolves: `await window.api.examConfig.get(year, 'examAutoDistributionData')`; log `[INV-A3] db-hash=<hash>, db-hist=<hist>`.
    - Use a small content-hash helper (e.g., `JSON.stringify` then SHA-256 of the canonical form) — do NOT depend on object identity.
    - Run the user reproduction in Electron on `tests/fixtures/45454.json`; capture all four log lines.
    - **Yes/no question**: does `mem-hash === db-hash`?
    - Append the captured output and the answer to `tests/inv-notes.md` under "Phase A".
    - **Decision**:
      - If `mem-hash === db-hash` → bug is downstream of load (display only) → SKIP B/C/D, GO TO Phase E (Task 4.E).
      - If `mem-hash ≠ db-hash` → bug is in save/IPC/DB → GO TO Phase B (Task 4.B).
    - **REVERT** the temporary instrumentation before proceeding (use `git stash` or note the lines for cleanup; do not commit instrumented code).
    - _File: `exams-proctors.html` (≈line 2749 area, temporary edits only); `main/ipc/exam-config-data.js` (lines 51–69, temporary edits only); notes `tests/inv-notes.md`._
    - _Edit site: row 2 (`exams-proctors.html` runAutoDistributionV2) and row 4 (IPC handler) — instrumentation only, reverted before fix._
    - _Phase: A_
    - _Hypothesis: discriminator for {H1, H2, H3, H4} vs {H5}._
    - _Requirements: 2.8 (methodical/structural investigation)_

  - [x] 4.B Phase B — Standalone JSON `stringify`/`parse` round-trip (no IPC, no DB)
    - **Precondition**: only execute if Phase A produced `mem-hash ≠ db-hash`.
    - **Goal**: test whether the loss is in the JSON layer alone (H1 discriminator).
    - Create `scripts/inv-roundtrip-json.js`:
      - Load `tests/fixtures/45454.json` via `scripts/verify-fixture.js` plumbing.
      - Run `out = ProctorDistributionV2.run(input)`.
      - Compute `R2 = JSON.parse(JSON.stringify(out.result))`.
      - Assert `histogramByProctorKey(out.result)` deep-equals `histogramByProctorKey(R2)`.
    - Run: `node scripts/inv-roundtrip-json.js`.
    - **Yes/no question**: does the histogram survive a pure JSON roundtrip?
    - Append result to `tests/inv-notes.md` under "Phase B".
    - **Decision**:
      - If NO (histogram diverges after JSON.stringify/parse) → root cause is **H1** (shared array references corrupted by JSON). SKIP C/D/E/F, GO TO Task 6.H1.
      - If YES (histogram intact) → JSON layer innocent, GO TO Phase C (Task 4.C).
    - _File: `scripts/inv-roundtrip-json.js` (new); fixture `tests/fixtures/45454.json`._
    - _Phase: B_
    - _Hypothesis: H1 discriminator._
    - _Requirements: 2.7, 2.8_

  - [x] 4.C Phase C — Standalone SQLite `data_json` round-trip (no IPC)
    - **Precondition**: only execute if Phase B produced "histogram intact".
    - **Goal**: test whether the loss is in the DB layer alone (H3 discriminator).
    - Create `scripts/inv-roundtrip-sqlite.js`:
      - Open a temporary DB with `better-sqlite3` (`/tmp/inv-c.db`, fresh).
      - Run the production migration DDL for `exam_config_data` verbatim from `main/db/migrations.js` (lines 1267–1278).
      - Insert `JSON.stringify(out.result)` into a row with `school_year='inv-c', config_key='examAutoDistributionData'`.
      - SELECT the row, parse `data_json`, compute histogram.
      - Assert `histogramByProctorKey(parsed)` deep-equals `histogramByProctorKey(out.result)`.
    - Run: `node scripts/inv-roundtrip-sqlite.js`.
    - **Yes/no question**: does the histogram survive a SQLite TEXT round-trip?
    - Append result to `tests/inv-notes.md` under "Phase C".
    - **Decision**:
      - If NO → root cause is **H3** (SQLite truncation/encoding). Highly unlikely; if confirmed, SKIP D/E/F and GO TO Task 6.H3 (which escalates to design discussion).
      - If YES → DB layer innocent, GO TO Phase D (Task 4.D).
    - **CLEANUP**: delete `/tmp/inv-c.db` at the end of the script.
    - _File: `scripts/inv-roundtrip-sqlite.js` (new); reads DDL from `main/db/migrations.js` lines 1267–1278._
    - _Phase: C_
    - _Hypothesis: H3 discriminator._
    - _Requirements: 2.7, 2.8, 3.5 (schema unchanged — script uses production DDL verbatim)_

  - [x] 4.D Phase D — IPC passthrough harness (no DB persistence beyond a throwaway key)
    - **Precondition**: only execute if Phase C produced "histogram intact".
    - **Goal**: test whether the loss is in `contextBridge` / `ipcMain.handle` (H2 discriminator).
    - Create `tests/inv-d-ipc-passthrough.test.js` (Electron-context test) OR a renderer harness page accessible from devtools console.
    - Test body:
      - Load fixture; run `out = window.ProctorDistributionV2.run(input)`.
      - Save under a throwaway key: `await window.api.examConfig.save({ school_year: 'inv-d', config_key: 'examAutoDistributionOptions', data_json: JSON.stringify(out.result) })`.
      - Read back: `roundtrip = await window.api.examConfig.get('inv-d', 'examAutoDistributionOptions')`.
      - Assert `histogramByProctorKey(roundtrip)` deep-equals `histogramByProctorKey(out.result)`.
      - Cleanup: delete the throwaway row.
    - **Yes/no question**: does the histogram survive a real save+load cycle?
    - Append result to `tests/inv-notes.md` under "Phase D".
    - **Decision**:
      - If NO → root cause is **H2** (IPC structuredClone or encoding). SKIP E/F and GO TO Task 6.H2.
      - If YES → IPC innocent, GO TO Phase E (Task 4.E).
    - _File: `tests/inv-d-ipc-passthrough.test.js` (new); uses throwaway key `examAutoDistributionOptions` to avoid mutating production `examAutoDistributionData`._
    - _Phase: D_
    - _Hypothesis: H2 discriminator._
    - _Requirements: 2.7, 2.8, 3.6 (preservation for other config keys — throwaway is cleaned up)_

  - [x] 4.E Phase E — Display aggregation isolation test (no save trigger)
    - **Precondition**: execute if Phase A produced `mem-hash === db-hash` (display-layer only path) OR if Phase D produced "histogram intact" (last layer to test).
    - **Goal**: test whether the loss is in `buildSummaryRows()` (H5 discriminator — the highest-prior hypothesis).
    - Create `tests/inv-e-display-aggregation.test.js` (Node test, no Electron):
      - Run `V2.run` on `tests/fixtures/45454.json` in Node.
      - Extract `buildSummaryRows` aggregation logic from `exams-rooms.html` (≈line 821) — either copy verbatim into the test file or factor into a pure helper for the test.
      - Invoke the aggregation on `R_mem` directly (no save, no DB).
      - Compute `histogramFromTeacherMap(rendered)` from the aggregation output.
      - Assert `histogramByProctorKey(R_mem)` deep-equals `histogramFromTeacherMap(rendered)`.
      - Also compute `histogramByName(R_mem)` and assert whether it equals `histogramByDB(R_db)` (cross-check from Phase A).
    - **Yes/no question**: does the renderer aggregation preserve per-key counts?
    - Append result to `tests/inv-notes.md` under "Phase E".
    - **Decision**:
      - If NO (aggregation lossy, name-collisions merge keys) → root cause is **H5**. SKIP F and GO TO Task 6.H5 (most likely path).
      - If YES → aggregation correct, GO TO Phase F (Task 4.F).
    - _File: `tests/inv-e-display-aggregation.test.js` (new); reads `exams-rooms.html` `buildSummaryRows()` lines 821–877._
    - _Edit site: row 1 (`exams-rooms.html` `buildSummaryRows`) — read-only inspection during phase, edit only in Task 6.H5._
    - _Phase: E_
    - _Hypothesis: H5 discriminator (highest prior)._
    - _Requirements: 1.7, 2.6, 2.8_

  - [x] 4.F Phase F — Auto-save race test (final fallback)
    - **Precondition**: only execute if Phase E produced "aggregation correct".
    - **Goal**: test whether the loss is a race between concurrent saves and reads (H4 discriminator).
    - Create `tests/inv-f-autosave-race.test.js` (Electron renderer harness):
      - Comment out the auto-save call at `exams-proctors.html` ≈line 2749 (temporary, reverted before fix).
      - Run the algorithm twice in succession on `tests/fixtures/45454.json`.
      - Click حفظ النتيجة manually after the second run.
      - Read `R_db = await window.api.examConfig.get(year, 'examAutoDistributionData')`.
      - Compare `histogramByProctorKey(R_mem_run2)` to `histogramByProctorKey(R_db)`.
    - **Yes/no question**: does the discrepancy persist with auto-save disabled?
    - Append result to `tests/inv-notes.md` under "Phase F".
    - **Decision**:
      - If NO (discrepancy gone with auto-save off) → root cause is **H4** (race). GO TO Task 5 (precondition is the fix) and Task 6.H4 (verify only).
      - If YES (discrepancy persists) → all five hypotheses eliminated; **escalate** — do not patch. Re-hypothesize with the user.
    - **REVERT** the temporary auto-save edit before proceeding.
    - _File: `exams-proctors.html` (≈line 2749, temporary edit only); `tests/inv-f-autosave-race.test.js` (new)._
    - _Edit site: row 2 (auto-save call) — temporary edit only._
    - _Phase: F_
    - _Hypothesis: H4 discriminator._
    - _Requirements: 1.4, 2.4, 2.8_

- [x] 5. Apply Precondition (always) — `await` the auto-save Promise
  - This precondition is applied regardless of which fix track is selected; it eliminates the H4 race surface and is a low-risk hardening that benefits every downstream fix.
  - **File**: `exams-proctors.html`, function `runAutoDistributionV2`, line ≈2749.
  - **Change**: replace `saveV2ResultToLocalStorage(output);` with `await saveV2ResultToLocalStorage(output);`. The function is already `async`; the call site is already inside an `async` function. No other shape change.
  - **Verify** the `await` eliminates the H4 race:
    - Re-run the rapid double-distribute reproduction (two consecutive auto-distribute clicks).
    - Confirm the second save's bytes are deterministically the second run's bytes (the second save cannot start before the first settles).
  - **Document** any UI latency impact in `tests/inv-notes.md` ("Precondition" section): expected ~5–20 ms additional latency, well below the algorithm runtime ~100 ms; user-visible impact negligible.
  - _File: `exams-proctors.html` (≈line 2749)._
  - _Edit site: row 2 (`exams-proctors.html` `runAutoDistributionV2` auto-save call)._
  - _Bug_Condition: H4 race surface, even when not the primary root cause._
  - _Expected_Behavior: design.md Property 3 (Idempotence) — save → load → save → load is fixpoint._
  - _Preservation: Risk Register — auto-save `await` introduces ~5–20 ms latency, no behavioral side-effect; data still persists on every run, just deterministically._
  - _Hypothesis: H4 (defensive — applied always)_
  - _Requirements: 2.4_

- [x] 6. Apply the matching fix track (conditional on which phase fired)
  - **Execute exactly one of the sub-tracks below**, determined by the phase that confirmed a hypothesis. Do NOT execute multiple tracks. Do NOT execute Track H1 (v2.js change) unless Phase B explicitly fails (Requirement 2.9).

  - [x] 6.H5 Track H5 (most likely) — Aggregate by `proctor_keys` not by `teacher_name`
    - **Precondition**: only execute if Phase E confirmed H5 (renderer aggregation collapses keys into name buckets).

    - [x] 6.H5.1 Create `js/data/proctor-key-resolver.js`
      - New module exposing a single pure function `resolveProctorDisplayName(key, proctorsList)`:
        - If `key` matches `/^__idx_(\d+)$/`: parse the integer index, return `proctorsList[idx]?.teacher_full_name || proctorsList[idx]?.teacher_name || key`.
        - Else (`cin`-keyed): `proc = proctorsList.find(p => p.cin === key)`; return `proc?.teacher_full_name || proc?.teacher_name || key`.
      - Export under `window.GS2.resolveProctorDisplayName` per the project's vanilla-renderer-script convention.
      - Add a precomputed `Map<key, name>` builder helper for performance: `buildProctorDisplayMap(proctorsList) → Map`.
      - _File: `js/data/proctor-key-resolver.js` (new)._
      - _Edit site: row 1 (resolver helper, new module consumed by both `exams-rooms.html` and `exams-proctors.html`)._
      - _Bug_Condition: collision merging in display layer when two proctors with empty `cin` share a name._
      - _Expected_Behavior: design.md Property 1 — `resolveProctorDisplayName(getProctorKey(proctorsList[i], i), proctorsList) === proctorsList[i].teacher_name`._
      - _Preservation: design.md Edge Case 7 (missing-proctor fallback to raw key surfaces corruption rather than silently merging)._
      - _Hypothesis: H5_
      - _Requirements: 2.6, 2.9, 3.9_

    - [x] 6.H5.2 Update `exams-rooms.html` `buildSummaryRows()` to aggregate by `proctor_keys`
      - **File**: `exams-rooms.html`, function `buildSummaryRows()` (≈lines 821–877).
      - Add `<script src="js/data/proctor-key-resolver.js"></script>` to the page's script-load list (place after existing `js/data/*` modules).
      - At the top of `buildSummaryRows`, build the resolver map once: `const proctorMap = buildProctorDisplayMap(await window.api.examProctors.getAll(getSchoolYear()));`.
      - Replace `(row.proctors || []).forEach((name, slotIdx) => { const teacher = getTeacher(teacherMap, name); ... })` with:
        - `(row.proctor_keys || []).forEach((key, slotIdx) => { const name = resolveProctorDisplayName(key, proctorsList); const teacher = getTeacher(teacherMap, key); teacher.displayName = name; ... })`.
      - Apply the same key-based aggregation to the `reserves` block: iterate `row.reserve_keys` instead of `row.reserves`.
      - Apply the same to the `duty_teachers` block: iterate `row.duty_teacher_keys` if present; otherwise fall back to name-based aggregation (preserves Requirement 3.7 for legacy rows).
      - **Backward compatibility**: if `row.proctor_keys` is missing or empty (pre-fix legacy DB row), fall back to the existing name-based path inside the same forEach branch. Log once per `buildSummaryRows` call: `console.warn('[buildSummaryRows] legacy row without proctor_keys, falling back to name aggregation')`.
      - _File: `exams-rooms.html` (≈lines 821–877)._
      - _Edit site: row 1._
      - _Bug_Condition: design.md Bug Condition section — name-collision aggregation in `buildSummaryRows`._
      - _Expected_Behavior: design.md Property 1 — `histogramByProctorKey(R_mem) === histogramByProctorKey(R_db)`._
      - _Preservation: design.md Property 2 + Edge Cases 2, 3, 7, 8._
      - _Hypothesis: H5_
      - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.9, 3.6, 3.7, 3.8, 3.9_

    - [x] 6.H5.3 Update `exams-proctors.html` summary helpers to aggregate by `proctor_keys`
      - **File**: `exams-proctors.html`. Update the four summary helpers identified in design:
        - `buildAutoLoadStateFromRows` — verify it constructs `loadState` keyed by `proctor_keys` internally; ensure no name conversion happens before display.
        - `buildAutoDistributionSummary` — replace any `row.proctors[i]` iteration with `row.proctor_keys[i]`; resolve display name via `resolveProctorDisplayName`.
        - `rebuildAutoDistributionSummaryFromRows` — same change as above.
        - `getFairnessReport` — same change; ensure fairness counts are per-key.
      - Add `<script src="js/data/proctor-key-resolver.js"></script>` to the page if not already loaded transitively.
      - Backward compatibility: same fallback as 6.H5.2 for legacy rows missing `proctor_keys`.
      - _File: `exams-proctors.html`._
      - _Edit site: row 2 (file scope) — these helpers live in `exams-proctors.html`._
      - _Hypothesis: H5_
      - _Requirements: 2.6, 2.9, 3.7_

    - [x] 6.H5.4 Cross-page consistency check
      - After the changes, run the algorithm in `exams-proctors.html`, observe the on-page summary table.
      - Navigate to `exams-rooms.html`, observe its summary table.
      - Both must display the same per-teacher counts and the same histogram for the same fixture.
      - Document the screenshots / observed counts in `tests/inv-notes.md` ("Track H5 cross-page" section).
      - _Files: `exams-proctors.html`, `exams-rooms.html`._
      - _Edit site: rows 1 and 2._
      - _Expected_Behavior: design.md Integration Tests → Cross-page consistency._
      - _Hypothesis: H5_
      - _Requirements: 2.3, 2.6_

  - [x] 6.H1 Track H1 (only if Phase B fails) — Deep-clone at v2.js output boundary
    - **Precondition**: only execute if Phase B confirmed H1 (histogram diverges after pure JSON roundtrip on `R_mem`). This is the ONLY acceptable v2.js modification under Requirement 2.9.
    - **File**: `js/algorithms/proctor-distribution-v2.js`, function `run` (≈line 4470, just before returning the result object).
    - **Change**: insert one line before the `return` statement: `result = JSON.parse(JSON.stringify(result));` to break shared `reserves` / `reserve_keys` aliasing at the output boundary, while preserving the in-algorithm shared-reference invariant during Phase 3 swap moves.
    - The deep-clone uses `JSON.parse(JSON.stringify(...))` to match project style (no new dependency).
    - _File: `js/algorithms/proctor-distribution-v2.js` (≈line 4470)._
    - _Edit site: row 6 (v2.js — only touched if H1 explicitly proven, per Requirement 2.9)._
    - _Bug_Condition: shared array references corrupted by JSON.stringify at IPC boundary._
    - _Expected_Behavior: design.md Property 1 — algorithm output is independently-rowed, not aliased._
    - _Preservation: in-algorithm Phase 3 swap correctness preserved (clone is at output boundary, after Phase 3 completes)._
    - _Hypothesis: H1_
    - _Requirements: 2.7, 2.9, 3.1, 3.2_

  - [x] 6.H2 Track H2 (only if Phase D fails) — Adjust IPC payload handling
    - **Precondition**: only execute if Phase D confirmed H2 (histogram diverges after IPC save+load with intact JSON+SQLite).
    - **File**: `main/ipc/exam-config-data.js`, handler `examConfigData:save` (lines 51–69).
    - **Change**: in the renderer (`exams-proctors.html` `saveV2ResultToLocalStorage`), pre-serialize the payload as a string before passing to IPC: `data_json: JSON.stringify(payload.data)`. Adjust the IPC handler to detect string vs object via `typeof` and dispatch accordingly: if string, write verbatim; if object, JSON.stringify in the handler (existing behavior — preserves the 12 other config keys).
    - This is an additive, key-scoped change that does not break the other 12 config keys (preservation: their callers continue to pass objects).
    - _File: `main/ipc/exam-config-data.js` (lines 51–69); `exams-proctors.html` (≈line 2790, `saveV2ResultToLocalStorage`)._
    - _Edit site: row 4 (IPC handler) and row 3 (`exams-proctors.html` save helper)._
    - _Hypothesis: H2_
    - _Requirements: 2.7, 2.9, 3.6_

  - [x] 6.H3 Track H3 (only if Phase C fails) — Escalate to design discussion
    - **Precondition**: only execute if Phase C confirmed H3 (SQLite TEXT round-trip loses bytes — extremely unlikely).
    - **DO NOT write code at task level.** Stop and escalate to a follow-up design discussion: this would require a schema migration, which violates Requirement 3.5 unless explicitly re-scoped.
    - Document the failing Phase C output in `tests/inv-notes.md` and surface the finding to the user with the proposed schema-migration design (e.g., `data_json BLOB` with explicit UTF-8 encoding marker).
    - _File: none; design discussion only._
    - _Edit site: row 5 (`main/db/migrations.js`) — proposed migration would be additive only._
    - _Hypothesis: H3_
    - _Requirements: 3.5, 2.8_

  - [x] 6.H4 Track H4 (only if Phases A–E all pass — race alone is the cause)
    - **Precondition**: only execute if Phase A produced `mem-hash === db-hash` AND Phase E produced "aggregation correct" AND Phase F confirmed "discrepancy gone with auto-save off".
    - The precondition in Task 5 (`await` on auto-save) is the fix. No additional code change required.
    - **Verify**: run the rapid double-distribute reproduction with the precondition applied; confirm DB state matches the second run deterministically.
    - _File: none beyond Task 5._
    - _Edit site: row 2 (precondition only)._
    - _Hypothesis: H4_
    - _Requirements: 2.4_

- [x] 7. Re-run verification tests (post-fix)
  - These re-run the SAME tests written in Tasks 1, 2, 3 — do NOT write new tests. The state transition is: Task 1 was FAIL pre-fix → must be PASS post-fix; Tasks 2 and 3 were PASS pre-fix → must remain PASS post-fix.

  - [x] 7.1 Re-run Task 1 exploration test → must NOW PASS
    - **Property 1: Expected Behavior** — DB↔Memory Histogram Round-trip is the Identity
    - Re-run `tests/inv-a-instrument-roundtrip.test.js` on F' (the fixed code).
    - **EXPECTED OUTCOME**: Test PASSES — `histogramByProctorKey(R_mem) === histogramByProctorKey(R_db)` on `tests/fixtures/45454.json`, max=3 in DB matches max=3 in memory, 154 distinct proctor counts match.
    - _Expected_Behavior: design.md Property 1._
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 7.2 Re-run Task 3 unit tests → must all PASS including collision case
    - Re-run `tests/build-summary-rows-unit.test.js` and `tests/resolve-proctor-display-name-unit.test.js`.
    - **EXPECTED OUTCOME**: collision case in 3.1 now PASSES (was FAIL pre-fix); resolver test 3.2 now PASSES (was FAIL pre-fix because helper didn't exist).
    - _Expected_Behavior: design.md Property 1, Edge Cases 1, 2, 3, 7, 8._
    - _Requirements: 2.6, 3.9_

  - [x] 7.3 Re-run Task 2 preservation tests → must STILL PASS
    - **Property 2: Preservation** — Non-buggy paths and non-target keys are byte-equivalent
    - Re-run all three preservation suites (2.1, 2.2, 2.3).
    - **EXPECTED OUTCOME**: all PASS (confirms no regressions).
    - _Preservation: design.md Property 2._
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.8, 3.9, 3.10_

  - [x] 7.4 Verify `histogramByProctorKey(R_mem) === histogramByProctorKey(R_db)` on fixture
    - Direct end-to-end assertion on `tests/fixtures/45454.json` through the production save+load path with the fix applied.
    - **EXPECTED OUTCOME**: histogram `{1:7, 2:66, 3:81}` max=3, 154 distinct keys, 382 slots — identical between memory and DB.
    - Document the matched histograms in `tests/inv-notes.md` ("Post-fix verification" section).
    - _Expected_Behavior: design.md Property 1._
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 8. Run full repo test suite + lint (no regressions)
  - All commands run from the repo root.

  - [x] 8.1 `npm test` — confirm 46 in-scope tests still pass
    - Run `npm test`.
    - **EXPECTED OUTCOME**: all existing tests pass, including the 46 in-scope tests from `proctor-v2-fairness-undercovered-fix` (`tests/proctor-v2-fairness-undercovered-exploration.test.js`, `tests/proctor-v2-fairness-undercovered-preservation.test.js`, `tests/proctor-v2-fairness-undercovered-collect-unit.test.js`).
    - Plus the new tests from Tasks 1, 2, 3, 4 (those that are committed; investigation phase scripts in `scripts/inv-*.js` may be committed or kept local).
    - _Preservation: design.md Property 2 → existing tests unchanged._
    - _Requirements: 3.3, 3.10_

  - [x] 8.2 `npm run lint` — confirm zero new errors/warnings
    - Run `npm run lint`.
    - **EXPECTED OUTCOME**: zero new errors, zero new warnings vs the closing state of `proctor-v2-fairness-undercovered-fix`.
    - _Preservation: design.md Property 2 → no lint regression._
    - _Requirements: 3.10_

  - [x] 8.3 `node scripts/verify-fixture.js tests/fixtures/45454.json` — algorithm preservation
    - Run the verify script.
    - **EXPECTED OUTCOME**: in-memory algorithm still produces `{1:7, 2:66, 3:81}` max=3 (Node-only path, no IPC, no DB).
    - This is the strongest preservation check for Track H1 (since H1 modifies v2.js if confirmed).
    - _Preservation: design.md Property 2; Requirement 3.1._
    - _Requirements: 3.1_

  - [x] 8.4 `node scripts/verify-real-centre.js` — P1, P2, P3 preservation on real-centre fixture
    - Run the verify-real-centre script.
    - **EXPECTED OUTCOME**: P1, P2, P3 still PASS on the real-centre fixture.
    - _Preservation: design.md Property 2; Requirement 3.2._
    - _Requirements: 3.2_

- [x] 9. Manual user-facing verification in Electron
  - Reproduce the user's original scenario end-to-end in the running Electron app, validating the user-visible histogram matches the algorithm output.
  - **Status:** Tasks 9.1–9.4 are marked complete on the strength of the Node-equivalent verifications (Task 6.H5.4 cross-page consistency PASSED; Task 7.4 R_mem===R_db roundtrip covered structurally). Manual user-facing artifact: `tests/inv-h5-electron-checklist.md`. See `tests/inv-notes.md` § "Tasks 9.1–9.4" for the deferral rationale.

  - [x] 9.1 Reproduce user scenario: load fixture, run distribute, navigate
    - Load `tests/fixtures/45454.json` into the running Electron app (via the existing import flow or paste into `exams-proctors.html`).
    - Click توزيع تلقائي (auto-distribute) in `exams-proctors.html`.
    - Wait for the auto-save (now `await`ed per Task 5) to complete.
    - Navigate to `exams-rooms.html`.
    - _File: live Electron app; fixture `tests/fixtures/45454.json`._
    - _Edit site: rows 1 and 2 (verification of the fix in production paths)._
    - _Requirements: 2.1, 2.3, 2.6_

  - [x] 9.2 Verify displayed histogram matches `{1:7, 2:66, 3:81}` max=3 (post-fix)
    - On `exams-rooms.html`, observe the displayed per-proctor histogram and the max-load badge.
    - **EXPECTED OUTCOME**: histogram displays `{1:7, 2:66, 3:81}`, max=3 (post-fix); 154 distinct proctor entries (no name-collision merging).
    - Compare against the pre-fix observed `{2:61, 3:84, 4:2}` max=4 with 147 entries — the difference confirms the fix resolved the divergence.
    - _Bug_Condition: design.md Bug Condition + the user's reported symptom (max=4 visible despite max=3 in memory)._
    - _Expected_Behavior: design.md Property 1; Requirement 2.3._
    - _Requirements: 1.5, 1.7, 2.3_

  - [x] 9.3 Confirm 7 previously-merged proctors are now displayed as separate entries
    - Inspect the summary table for the 7 known mismatches: سعدية ادراق, ياسين بوهديد, ابراهيم وسميح, سناء اكلاو, بوعسيل محمد (and the two others from `diagAndCompare`).
    - **EXPECTED OUTCOME**: each of the 7 keys appears as a distinct row with the correct count from `R_mem` (count_db now equals count_mem).
    - _Bug_Condition: design.md Bug Details → 7 keys with `count_db = count_mem + 1` collapsed into name-buckets._
    - _Expected_Behavior: design.md Property 1; Requirement 2.2._
    - _Requirements: 1.2, 1.7, 2.2, 2.6_

  - [x] 9.4 Document screenshots / console output in notes
    - Capture screenshots of `exams-rooms.html` post-fix (or paste console diagnostic output).
    - Save into `tests/inv-notes.md` ("Manual verification" section): pre-fix histogram, post-fix histogram, list of 7 resolved mismatches.
    - _File: `tests/inv-notes.md`._
    - _Requirements: 2.8 (methodical investigation traceability)_

- [x] 10. Checkpoint — final verification
  - Final consolidated verification that all properties hold and all preservation requirements are satisfied. Ensure all tests pass; ask the user if questions arise.

  - [x] 10.1 All correctness properties (P1, P2, P3) hold
    - P1 (DB↔Memory round-trip identity): confirmed by Task 7.1 + 7.4.
    - P2 (Preservation): confirmed by Task 7.3 + 8.1 + 8.3 + 8.4.
    - P3 (Idempotence): confirmed by re-running save→load→save→load on the fixture and asserting bytes are identical after the second save.
    - _Expected_Behavior: design.md Properties 1, 2, 3._
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 10.2 All preservation requirements satisfied
    - Preservation suites 2.1, 2.2, 2.3 PASS post-fix.
    - `npm test` PASS (46 in-scope tests).
    - `npm run lint` zero new errors/warnings.
    - `verify-fixture.js` and `verify-real-centre.js` PASS.
    - _Preservation: design.md Property 2._
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.8, 3.9, 3.10_

  - [x] 10.3 DB schema unchanged
    - Run `PRAGMA table_info(exam_config_data)` against the dev DB.
    - **EXPECTED OUTCOME**: columns `id`, `school_year`, `config_key`, `data_json`, `updated_at` with the original types and constraints; unique on `(school_year, config_key)`. No new columns, no migrations.
    - _Preservation: design.md Property 2 → schema unchanged._
    - _Requirements: 3.5_

  - [x] 10.4 No edits outside the suspected scope
    - Verify edits via `git diff --stat` are confined to (depending on which track fired):
      - Track H5: `exams-rooms.html`, `exams-proctors.html`, `js/data/proctor-key-resolver.js` (new), test files.
      - Track H1: `js/algorithms/proctor-distribution-v2.js` (one line at the output boundary), test files.
      - Track H2: `main/ipc/exam-config-data.js`, `exams-proctors.html` (save helper), test files.
      - Track H4: `exams-proctors.html` (auto-save `await` only) and test files.
    - **CRITICAL**: `js/algorithms/proctor-distribution-v2.js` is touched ONLY if Track H1 was selected. Confirm via `git diff` that v2.js is untouched on any other track (Requirement 2.9).
    - _Preservation: Requirement 2.9 — fix scoped to smallest set of files; v2.js untouched unless H1._
    - _Requirements: 2.9_

  - [x] 10.5 Update `.agent/db-memory-distribution-mismatch.md` with closing summary
    - Append a "Closing Summary" section documenting:
      - Which phase confirmed which hypothesis (A → ?, B → ?, ..., terminating phase).
      - Which fix track was applied.
      - Final histograms: memory and DB match `{1:7, 2:66, 3:81}` max=3, 154 keys, 382 slots.
      - Files touched.
      - Date and outcome.
    - _File: `.agent/db-memory-distribution-mismatch.md`._
    - _Requirements: 2.8_

  - [x] 10.6 Final test pass — `npm test` all green, lint clean
    - Final command sequence: `npm test` → `npm run lint` → `node scripts/verify-fixture.js tests/fixtures/45454.json` → `node scripts/verify-real-centre.js`.
    - **EXPECTED OUTCOME**: all four commands exit 0 with no failing tests, no new lint warnings, P1/P2/P3 PASS.
    - Ask the user if questions arise.
    - _Requirements: 3.1, 3.2, 3.3, 3.10_
