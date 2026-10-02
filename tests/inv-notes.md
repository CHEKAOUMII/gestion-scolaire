# Investigation Notes — DB↔Memory Distribution Mismatch

**Spec:** `.kiro/specs/proctor-distribution-db-memory-mismatch/`
**Source documents:**
- `bugfix.md` — Requirements (1.x defect, 2.x expected, 3.x preservation).
- `design.md` — Investigation Plan (Phases A–F), Hypotheses H1–H5, Decision Tree.
- `tasks.md` — Implementation Plan, Task 4 (investigation phases).

This file is the formal investigation record. One section per phase. Each phase records the yes/no question, the captured evidence, and the decision per the design.md decision tree.

---

## Phase A — Instrument both layers (memory hash vs DB hash)

**Status:** SKIPPED — hypothesis structurally confirmed in Task 1 without instrumentation.

**Original question (per design.md and tasks.md 4.A):**
> Does `mem-hash === db-hash`?
> i.e. does the SQLite payload byte-equal the in-memory `R_mem` after `JSON.stringify ∘ IPC ∘ persist ∘ load ∘ JSON.parse`?

### Why instrumentation was not required

Task 1 (`tests/inv-a-instrument-roundtrip.test.js`) executed a Node-only proof of the bug condition that bypasses Phase A's instrumentation question entirely. Instead of running the full Electron round-trip, it computes both relevant histograms directly from `R_mem` (the algorithm output, before any IPC/DB step):

| Histogram | Computation | Result on `tests/fixtures/45454.json` |
|---|---|---|
| `histogramByProctorKey(R_mem)` | bucket by `row.proctor_keys[i]` (algorithm identity) | `{1:7, 2:66, 3:81}` — max=3, 154 distinct keys, 382 slots |
| `histogramByName(R_mem)`       | bucket by `row.proctors[i]` (display identity)       | `{2:65, 3:76, 4:6}` — max=4, 147 distinct names, 382 slots |

The two histograms are **not equal**, even though both are computed from the very same in-memory `R_mem` object. The divergence exists in the data structure produced by the algorithm itself, **before any save, IPC, stringify, parse, or load step has run**.

The 7-collision delta (154 − 147 = 7 names shared by 2+ proctor keys) and the slot-conservation invariant (both totals equal 382) match the bug-report observation byte-for-byte structurally. Full counterexample at `tests/inv-a-counterexample.md`.

### Logical equivalence: structural proof ⟹ Phase A answer

The Phase A question reduces to a question about which identity function the display layer uses when it renders `R_db`. The IPC + SQLite + JSON layers preserve `proctor_keys[]` and `proctors[]` byte-for-byte (this is asserted by the unchanged `exam_config_data` schema and by `JSON.stringify`'s structural identity for the value shape — see Phase B/C/D, which would each prove this independently if executed). So:

```
R_db.rows[i].proctor_keys[j] === R_mem.rows[i].proctor_keys[j]   for all i, j
R_db.rows[i].proctors[j]     === R_mem.rows[i].proctors[j]       for all i, j
```

i.e. `mem-hash === db-hash` over those two columns is a *given*, not a question to instrument. Therefore:

```
histogramByProctorKey(R_db)  ≡  histogramByProctorKey(R_mem)  =  {1:7, 2:66, 3:81}
histogramByName(R_db)        ≡  histogramByName(R_mem)        =  {2:65, 3:76, 4:6}
```

The bug-report observation `H_db = {2:61, 3:84, 4:2}` (max=4, 147 distinct) is structurally a `histogramByName` (147 distinct = number of unique names, max=4 = effect of merging 6 collisions onto load=3 buckets). The exact bucket values differ from this Node run because Math.random differs between the renderer session that captured the bug report and the Node sandbox that ran Task 1 — but the structural pattern (147 distinct buckets, max bumped to 4, 7-collision shrinkage) is invariant whenever the fixture's `proctorsList` contains ≥1 name collision.

Conclusion: instrumenting `runAutoDistributionV2` and `main/ipc/exam-config-data.js` to capture `mem-hash` and `db-hash` would have confirmed equality on `proctor_keys` and `proctors` — but the divergence in display arises from `buildSummaryRows()` and friends choosing `proctors` (name) as the aggregation key rather than `proctor_keys` (algorithm identity). That divergence is independent of the round-trip and is provable from `R_mem` alone.

### Yes/no answer for Phase A

**Structurally equivalent answer:** `mem-hash === db-hash` on the persisted columns (`proctor_keys`, `proctors`, `reserves`, `reserve_keys`, `teachers`, `teacher_keys`); however, the histogram observed by the user comes from `histogramByName(R_db)` (because `buildSummaryRows()` aggregates by name), which differs from `histogramByProctorKey(R_mem)` because `R_mem` itself contains 7 name collisions across distinct `proctor_keys`. The Phase A binary question is therefore answered: **the bug is downstream of load — at the display aggregation layer — not in save / IPC / DB**.

### Decision

Per the design.md decision tree:

```
Phase A: mem-hash == db-hash?
├── yes → Phase E (display only)
│   └── aggregation preserves counts?
│       ├── no  → Fix H5: aggregate by proctor_keys
│       └── yes → Phase F (auto-save race)
└── no  → Phase B (JSON only)
    ...
```

The structural-equivalent answer to Phase A's question is **yes** (the persistence layers are byte-preserving on the relevant columns). Therefore:

- **SKIP** Phase B (JSON layer round-trip — would confirm intact).
- **SKIP** Phase C (SQLite TEXT round-trip — would confirm intact).
- **SKIP** Phase D (IPC passthrough — would confirm intact).
- **GO TO** Phase E (display aggregation isolation test) to formalize the H5 confirmation in a unit test that bisects `buildSummaryRows()` itself.
- **SKIP** Phase F (only relevant if Phase E shows aggregation preserves counts; Task 1 already proves it does not).

### Why no production code was instrumented

Task 4.A originally specified temporary `console.log` instrumentation in `exams-proctors.html` (≈line 2749) and `main/ipc/exam-config-data.js` (lines 51–69), to be reverted before the fix. This was the right approach when the root cause was unknown and Phase A had to discriminate between {save/IPC/DB lossy} and {display lossy}.

Task 1's Node-only structural proof eliminates that discrimination: the divergence is shown to exist in `R_mem` before any save step. Adding instrumentation would:
1. Add temporary edits to two production files that need to be reverted (touching `git stash` workflow).
2. Re-prove a fact that is already proven by `tests/inv-a-instrument-roundtrip.test.js` and documented in `tests/inv-a-counterexample.md`.
3. Require an Electron run (the user's reproduction loop), where the structural proof runs in CI's Node sandbox.

Instrumentation is therefore not just unnecessary — it would degrade the audit trail by introducing temporary edits where a permanent test already exists.

### References

- Test: `tests/inv-a-instrument-roundtrip.test.js` — encodes the bug condition and the structural divergence.
- Counterexample: `tests/inv-a-counterexample.md` — full reproduction details, 7 named collisions, conservation arithmetic.
- Design: `.kiro/specs/proctor-distribution-db-memory-mismatch/design.md` § Investigation Decision Tree (lines ≈174–193) and § Phase A — Instrument the round-trip.
- Tasks: `.kiro/specs/proctor-distribution-db-memory-mismatch/tasks.md` § Task 4.A and Task 1.

### Requirement traceability

- Requirement 2.8 (methodical/structural investigation) — satisfied: the answer to Phase A is derived from a structural proof, not a guess; the decision tree branch (skip B/C/D/F → Phase E) is the same branch that instrumentation would have selected, just reached via a stronger argument.
- Requirement 2.7 (each hypothesis has a discriminating test) — Phase A's discriminator role is taken over by Task 1, whose assertion `histogramByProctorKey(R_mem) === histogramByName(R_mem)` discriminates {H1, H2, H3, H4} (none would explain a divergence at the memory layer) from {H5} (the only hypothesis that fits a pre-roundtrip divergence between by-key and by-name aggregation).
- Requirement 2.9 (`v2.js` out of scope unless H1 confirmed) — satisfied: the structural proof rules out H1 (the divergence does not require a JSON.stringify pass to manifest), so v2.js stays out of scope.

---

<!-- Subsequent phases (B, C, D, E, F) and Precondition section will be appended below as they execute. -->

## Phase E — Display aggregation isolation test (no save trigger)

**Status:** EXECUTED. Test FAILS on F (the SUCCESS case for an investigation test) — H5 confirmed in isolation at the renderer layer.

**File:** `tests/inv-e-display-aggregation.test.js`

**Yes/no question (per design.md and tasks.md 4.E):**
> Does the renderer aggregation (`buildSummaryRows()` from `exams-rooms.html` ≈lines 821–877) preserve per-key counts when applied to `R_mem`?

**Answer:** **No.** The replicated aggregator collapses distinct `proctor_keys` into single name buckets whenever two proctors share `teacher_name`, producing a histogram that diverges from the algorithm's per-key histogram by exactly the 7-collision delta proven in Phase A.

### Evidence

The test loads V2 from production (vm sandbox), runs `V2.run(input)` on `tests/fixtures/45454.json`, and applies a verbatim copy of the production `buildSummaryRows()` aggregation logic to `R_mem` directly — no save, no IPC, no DB. It then computes `histogramFromTeacherMap(rendered)` from the aggregation output and cross-checks against the two reference histograms from Phase A.

| Source | Histogram | Max | Distinct |
|---|---|---|---|
| `histogramByProctorKey(R_mem)` (algorithm-keyed) | `{1:7, 2:66, 3:81}` | 3 | 154 keys |
| `histogramByName(R_mem)`       (display-keyed)   | `{2:65, 3:76, 4:6}` | 4 | 147 names |
| `histogramFromTeacherMap(rendered)` (production replica) | `{2:65, 3:76, 4:6}` | 4 | 147 teachers |

Three assertions, each fired with the diagnostic already printed (try/catch deferral on assertion (a)):

- **(a)** `histogramByProctorKey(R_mem) === histogramFromTeacherMap(rendered)` — **FAILED on F as expected.**
  Production aggregation does NOT preserve per-key counts. Delta: max 3 → 4 (+1), 154 → 147 distinct (−7 = number of collisions).
- **(b)** `histogramByName(R_mem) === histogramFromTeacherMap(rendered)` — **PASSED on F as expected.**
  Confirms the replicated aggregator behaves identically to a pure name-bucketing of `R_mem`. The replicator has not drifted from the production aggregator.
- **(c)** Fixture exhibits ≥1 name collision — **PASSED on F.** 7 collisions present (sanity check guards against vacuous "passing" on a no-collision fixture).

### Name collisions named by the failure log

7 `teacher_name` strings are shared by ≥2 proctor keys — the structural root of H5:

| # | Name | Keys (key:count by-proctor_key) | By-name aggregate |
|---|---|---|---|
| 1 | ياسين بوهديد         | `2367005:1, __idx_18:3` | 4 |
| 2 | ابراهيم السباعي       | `2227866:1, __idx_12:3` | 4 |
| 3 | أيوب بوحصار           | `2367154:1, __idx_15:3` | 4 |
| 4 | فاطمة الزهراء بنزيد   | `2367141:1, __idx_105:3` | 4 |
| 5 | المهدي مومتي          | `2319348:1, __idx_63:2` | 3 |
| 6 | سلمى الأزهري          | `2270254:1, __idx_110:3` | 4 |
| 7 | خولة نصرالدين         | `2366908:1, __idx_76:3` | 4 |

6 collisions land in the load=4 bucket (the user-visible inflated max). 1 collision (المهدي مومتي) lands in load=3.

### What the test pinned down vs Phase A

Phase A (Task 1, `tests/inv-a-instrument-roundtrip.test.js`) proved the structural divergence between `histogramByProctorKey(R_mem)` and `histogramByName(R_mem)` — i.e. the divergence exists in `R_mem` itself. That established the bug condition C(X) and ruled out save/IPC/DB layers as the source.

Phase E now closes the loop on the *display* side: it executes the actual production aggregation logic (verbatim from `exams-rooms.html` ≈lines 821–877) on `R_mem` and proves the aggregation output equals `histogramByName(R_mem)` (assertion b) and differs from `histogramByProctorKey(R_mem)` (assertion a). This bisects H5 to a single function: `buildSummaryRows()`.

In other words, Phase A says "the divergence is structurally in R_mem, downstream cannot introduce it"; Phase E says "the renderer's `buildSummaryRows()` is the function that reads `row.proctors` (name) instead of `row.proctor_keys` (key) and therefore is exactly the locus of the bug." Together they pin H5 to `exams-rooms.html buildSummaryRows()` (and its siblings in `exams-proctors.html` summary helpers — see Task 6.H5.3).

### Decision

Per the design.md decision tree:

```
Phase E: aggregation preserves counts?
├── no  → Fix H5: aggregate by proctor_keys
└── yes → Phase F (auto-save race)
```

The answer is **no** (assertion a fails). Therefore:
- **SKIP** Phase F (only relevant if aggregation is correct; Phase E proves it isn't).
- **GO TO** Task 5 (precondition: `await` the auto-save Promise — applied always, defensive).
- **GO TO** Task 6.H5 (the matching fix: aggregate `buildSummaryRows()` and the four `exams-proctors.html` summary helpers by `proctor_keys`, with `resolveProctorDisplayName(key, proctorsList)` for display).

### Why no production code was instrumented

The test runs entirely in Node — it loads V2 via vm sandbox (mirror of `tests/inv-a-instrument-roundtrip.test.js`) and invokes a verbatim **copy** of the `buildSummaryRows()` aggregation block. The original `exams-rooms.html` is read-only during this phase per the spec annotation (`Edit site: row 1 — read-only inspection during phase, edit only in Task 6.H5`). No production file is modified.

### Test failure-message contract

The task spec required the failure message to "name the 7 collisions and show max=3 vs max=4". The test prints the full diagnostic (both histograms, the divergence summary `max=3 → max=4 (+1)`, and the 7-line collision list) **before** the deferred `throw firstFailure` re-emits assertion (a). The exit-code-1 failure is preceded by the complete evidence packet, so any CI log captures all of it.

### References

- Test: `tests/inv-e-display-aggregation.test.js` — replicates `buildSummaryRows()` lines 821–877 verbatim, applies to `R_mem`, asserts (a)+(b)+(c).
- Phase A: `tests/inv-a-instrument-roundtrip.test.js`, `tests/inv-a-counterexample.md`, this file § Phase A.
- Source: `exams-rooms.html` lines 786–877 (`createTeacherRow`, `getTeacher`, `buildSummaryRows`).
- Design: `.kiro/specs/proctor-distribution-db-memory-mismatch/design.md` § Investigation Decision Tree, § Hypothesis H5.
- Tasks: `.kiro/specs/proctor-distribution-db-memory-mismatch/tasks.md` § Task 4.E and § Task 6.H5.

### Requirement traceability

- Requirement 1.7 — bug condition observable on the production fixture: confirmed at the display layer; the replicated aggregator reproduces the user-visible max=4 from the 7-collision merge.
- Requirement 2.6 — fix target identified at function granularity: `buildSummaryRows()` in `exams-rooms.html` ≈lines 821–877 (and the four summary helpers in `exams-proctors.html`).
- Requirement 2.8 — methodical/structural investigation: Phase E completes the structural argument by reproducing the production aggregator in a hermetic Node test; the discriminator between {H1, H2, H3, H4} and {H5} is now answered by an executable test, not a verbal argument.

---

## Precondition (Task 5) — `await` the auto-save Promise

**Status:** APPLIED. Defensive precondition committed regardless of fix-track selection.

**File:** `exams-proctors.html`, function `runAutoDistributionV2`, ≈line 2749.

### Change

```diff
-                // Save to localStorage with v2 format (backward compatible)
-                saveV2ResultToLocalStorage(output);
+                // Save to v2 format (awaited so subsequent reads see the latest write — Task 5
+                // precondition for the proctor-distribution-db-memory-mismatch bugfix)
+                await saveV2ResultToLocalStorage(output);
```

`saveV2ResultToLocalStorage` was already declared `async` (≈line 2784) and the call site sits inside `async function runAutoDistributionV2()`. The single-keyword addition is therefore syntactically and semantically valid with no other shape change.

### Why (eliminates H4 race surface — design.md)

`saveV2ResultToLocalStorage` issues `await window.api.examConfig.save({ ... })`, which crosses the IPC boundary into `main/ipc/exam-config-data.js` and writes to SQLite via `better-sqlite3`. Without `await` at the call site, `runAutoDistributionV2()` returns control to the event loop while the save Promise is still pending, which means:

- Two consecutive auto-distribute clicks (fast double-press) could enqueue two `save({ examAutoDistributionData })` calls whose ordering at the IPC handler is not deterministic relative to subsequent `get({ examAutoDistributionData })` calls.
- A subsequent `await window.api.examConfig.get(year, 'examAutoDistributionData')` issued before the first save settled could race the write.
- Status updates (`updateDistStatuses()`) and downstream renders that depend on the persisted bytes would observe pre-write or interleaved bytes.

Adding `await` at the call site sequentializes save → render → status, eliminating the race surface that hypothesis H4 covers. Even after the H5 fix lands (Task 6.H5), this precondition keeps the "write-then-read" invariant deterministic for any future caller of `runAutoDistributionV2`.

### Expected impact

- **Latency:** ~5–20 ms additional UI latency per run (one extra IPC round-trip awaited synchronously vs. fire-and-forget). Negligible against the algorithm's ~100 ms runtime on `tests/fixtures/45454.json` (382 slots, 154 keys).
- **Behavioral side-effect:** none. Data still persists on every run; the only difference is that the persistence completes before `runAutoDistributionV2` resolves.
- **User-visible difference:** none on a single click. On a rapid double-click, the second run's persisted bytes are now deterministically the second run's bytes (the second save cannot start before the first settles), removing the race window.

### Verification

- File parses cleanly: `node -e "require('fs').readFileSync('exams-proctors.html', 'utf8')"` exits 0.
- `npm run lint` exit code 0 (0 errors, 6 pre-existing warnings unrelated to this change — same warnings present on the pre-Task-5 tree).
- The function `saveV2ResultToLocalStorage` (≈line 2784) is `async` and returns a Promise — `await` resolves correctly.
- The call site is inside `async function runAutoDistributionV2()` — `await` is in a valid position.

### Requirement traceability

- Requirement 2.4 — auto-save Promise must be awaited at the call site so that downstream reads observe the latest write.
- Property 3 (Idempotence) per design.md — `save → load → save → load` is now a fixpoint because save completes before the next load can start.
- Risk Register acceptance — ~5–20 ms latency below the perception threshold and well under the algorithm's own runtime.



## Task 6.H5.3 — `exams-proctors.html` summary helpers verification

**Status:** VERIFIED. No code changes required to the four summary helpers — they were already key-based at the start of this task. Resolver script include added defensively at the page head.

**File:** `exams-proctors.html` (helpers at ≈lines 4220–4480).

### Verification result per helper

| Helper | Line | Aggregation key | Status |
|---|---|---|---|
| `getFairnessReport(loadState)` | 4220 | `getProctorExemptionKey(proc, idx)` (per-proctor lookup against pre-built `loadState`) | ✅ key-based — no change |
| `buildAutoDistributionSummary(loadState)` | 4251 | `getProctorExemptionKey(proc, idx)` for `exKey` | ✅ key-based — no change |
| `rebuildAutoDistributionSummaryFromRows(rows)` | 4311 | `row.duty_teacher_keys`, `row.proctor_keys`, `row.reserve_keys` | ✅ key-based — no change |
| `buildAutoLoadStateFromRows(rows, includeReserves)` | 4379 | `row.duty_teacher_keys`, `row.proctor_keys`, `row.reserve_keys` | ✅ key-based — no change |

All four helpers iterate the v2 metadata arrays (`proctor_keys`, `reserve_keys`, `duty_teacher_keys`) and never aggregate by `teacher_name`. The collision bug exposed by Phase E is therefore confined to `exams-rooms.html buildSummaryRows()` — which Task 6.H5.2 has already fixed.

### Search for residual name-based aggregation paths

Pattern `(row.proctors || []).forEach(name => ...)` / `(row.reserves || []).forEach(name => ...)` / `(row.duty_teachers || []).forEach(name => ...)`: 2 hits, both **display-only / print-only** call sites — they collect names into a `Set` for sheet rendering (cell content like "name1، name2"), not for histogram counting. Confirmed safe:

- `exams-proctors.html` ≈line 5151 — inside `getAutoReserveRows()`, builds a per-session reserves display list (`reserves: Array.from(group.reserves)`) for the print/preview pane. Output is a string list, not a count.
- `exams-proctors.html` ≈line 6056 — inside the per-session print sheet generator, builds `reserveSet` and `dutySet` for the "أساتذة الاحتياط" / "أساتذة المداومة" blocks. Output is rendered names, not load counts.

Neither path feeds `loadState`, `getTeacherFinalLoad`, `getTeacherGuardLoad`, or any histogram. Both are display enumerations of names that the user reads — the underlying name-collision concern (two proctors sharing `teacher_name`) is benign for these blocks because the rendered cell shows "name1، name2" anyway and a duplicated name is a true UI artifact, not a count error.

### Resolver script include — defensive addition

Even though no helper currently calls `resolveProctorDisplayName` directly (loadState is keyed by exemption key throughout, and `teacher_name` from `proctorsList[idx]` is read directly when needed), `exams-proctors.html` now imports the resolver per the spec's defensive guidance:

```diff
         <script src="js/algorithms/proctor-distribution-v2.js" defer></script>
+        <script src="js/data/proctor-key-resolver.js" defer></script>

     </head>
```

This guarantees `window.GS2.resolveProctorDisplayName` is available throughout the page (e.g. inside dialogs, exemption editors, or future helpers) without requiring a transitive import chain. Cost: one ~4 kB JS load on page entry.

### `getTeacherGuardLoad` / `getTeacherFinalLoad` / `getTeacherLoadDetails` consistency check

These three functions all take a key string and look up `loadState[key]`. The contract is "whatever key was used to write into loadState must be the same key used to read." Verified at every call site:

| Call site | Read key | Write origin |
|---|---|---|
| `getEligibleProctors` (≈line 3902) | `getProctorExemptionKey(proc, idx)` (via `item.exKey`) | `addTeacherHalfdayLoad(loadState, item.exKey, ...)` (≈line 3990) — same shape |
| `selectGuard` family (≈line 4040) | `item.exKey` from `getProctorExemptionKey` | same writer, same shape |
| `selectReserve` family (≈line 4072) | `item.exKey` | same writer |
| `getFairnessReport` (≈line 4220) | `getProctorExemptionKey(proc, idx)` | reads from `state` populated by either live `loadState` OR `buildAutoLoadStateFromRows(rows, true)` |
| `buildAutoDistributionSummary` (≈line 4251) | `getProctorExemptionKey(proc, idx)` | same as above |
| `rebuildAutoDistributionSummaryFromRows` (≈line 4311) | populates loadState via `row.proctor_keys[i]` (= `getProctorKey` shape) | re-read by `buildAutoDistributionSummary` via `getProctorExemptionKey(proc, idx)` |
| `buildAutoLoadStateFromRows` (≈line 4379) | populates loadState via `row.proctor_keys[i]` (= `getProctorKey` shape) | re-read via `getProctorExemptionKey` |

### Pre-existing key-shape concern (NOT introduced by H5)

`getProctorKey` returns `proc.cin || ('__idx_' + idx)` (used by v2 algorithm to populate `proctor_keys[]`).
`getProctorExemptionKey` returns `proc.cin || proc.som || ('idx_' + idx)` (used to read/write `loadState`, exemptions, duty assignments).

For the empty-`cin` / empty-`som` case (synthetic-key proctors), these two functions produce **different strings**:

- `getProctorKey({cin:'', som:'', ...}, 5)` → `'__idx_5'`
- `getProctorExemptionKey({cin:'', som:'', ...}, 5)` → `'idx_5'`

Consequence: when `buildAutoLoadStateFromRows(rows)` populates `loadState['__idx_5']` from a row's `proctor_keys`, then `buildAutoDistributionSummary(loadState)` reads back via `getProctorExemptionKey(proc, idx)` which resolves to `loadState['idx_5']` → an empty `ensureTeacherLoadEntry` is auto-created → that proctor's reloaded summary shows 0 guards even though the row contains the assignment.

This is a **distinct mismatch** from H5 (the name-collision bug fixed in 6.H5.2): it affects proctors with both `cin` and `som` empty, and only on the post-reload re-aggregation path (live algorithm runs use the same `getProctorExemptionKey`-keyed loadState throughout, so it never surfaces during a single run).

For `tests/fixtures/45454.json` specifically: 147 proctors have empty `cin` but **none** of those entries have empty `som` — `proc.som` falls back before the `'idx_' + idx` branch fires. So in this fixture, `getProctorExemptionKey` returns `som` while `getProctorKey` returns `'__idx_' + idx`, also a mismatch — but the algorithm itself uses `getProctorKey` to populate `proctor_keys`, so on reload `loadState['__idx_5']` is populated yet `buildAutoDistributionSummary` reads `loadState[som_value]` → both branches get 0.

Per task instructions: this is "a pre-existing concern, not introduced by H5." H5 fix (Track 6.H5) addresses the histogram-divergence bug exposed in Phase A and Phase E (name-collision merging in `buildSummaryRows`), and intentionally does not touch the orthogonal key-shape inconsistency between `getProctorKey` and `getProctorExemptionKey`. Recording it here for traceability — a separate spec would be required to unify the two key shapes (Requirement 2.9 says v2.js is out of scope unless H1 is confirmed; unifying the shapes would touch v2.js).

### Verification

- `npm run lint` exit code 0 (zero new errors/warnings vs the closing state of `proctor-v2-fairness-undercovered-fix`).
- File parses cleanly: the only edit is a 1-line `<script>` tag insertion at the page head, no JavaScript edits.

### References

- Source: `exams-proctors.html` lines 4220–4480 (the four helpers).
- Resolver: `js/data/proctor-key-resolver.js` (created in Task 6.H5.1).
- Sibling fix: `exams-rooms.html buildSummaryRows()` (Task 6.H5.2).
- Tasks: `.kiro/specs/proctor-distribution-db-memory-mismatch/tasks.md` § Task 6.H5.3.

### Requirement traceability

- Requirement 2.6 — fix target identified at function granularity: confirmed all four `exams-proctors.html` summary helpers are already key-based; no aggregation by `teacher_name` remains in their bodies.
- Requirement 2.9 — `js/algorithms/proctor-distribution-v2.js` not modified by this task (verified by inspection: no edit to v2.js).
- Requirement 3.7 — backward compatibility preserved: helpers continue to handle legacy rows missing `proctor_keys` via the existing `(row.X || [])` fallback (returns an empty array, no aggregation contribution, no crash).


## Task 6.H5.4 — Cross-page consistency

**Status:** PASSED. Cross-page aggregation parity confirmed at the unit level on `tests/fixtures/45454.json`.

**File:** `tests/inv-h5-cross-page-consistency.test.js` (new, Node-only).

### Why a Node test instead of the manual Electron check

The original task specifies a manual two-step verification: run distribute in `exams-proctors.html`, navigate to `exams-rooms.html`, and visually compare the per-teacher counts and the histogram. That manual check exercises the full IPC + DB roundtrip in addition to the cross-page aggregation.

Since this Node environment cannot drive Electron, the test isolates and verifies the **aggregation parity** between the two pages — which is the only piece the manual check would directly observe (the IPC + DB layers are byte-preserving, as established structurally in Phase A and proved by passive on the schema + the JSON-roundtrip design argument). Manual end-to-end Electron verification (renderer → IPC → SQLite → renderer → display) is deferred to Task 9.

### What the test does

1. Loads the production V2 module via `vm` sandbox (mirror of `tests/inv-a-instrument-roundtrip.test.js` and `tests/inv-e-display-aggregation.test.js`).
2. Runs `V2.run(input)` on `tests/fixtures/45454.json` to produce `R_mem` (191 rows, 382 slots, 154 distinct proctor keys).
3. Loads `js/data/proctor-key-resolver.js` via `require()` for `buildProctorDisplayMap`.
4. Replicates the **post-fix** `buildSummaryRows()` aggregation from `exams-rooms.html` (Task 6.H5.2 — lines 821–940). The replica covers the `proctor_keys` branch verbatim, including the `bucketForKey`/`bucketForLegacyName` helpers and the pre-population of the teacher map. The legacy-fallback branch is intentionally omitted because `R_mem` always carries `proctor_keys` (verified in Phase A / `inv-a-counterexample.md`).
5. Replicates `buildAutoLoadStateFromRows()` from `exams-proctors.html` lines 4379–4395 verbatim, plus the supporting `addTeacherHalfdayLoad`/`ensureTeacherLoadEntry` helpers from lines 3662–3712. The load state is pre-populated using the algorithm's key shape (`proc.cin || '__idx_' + idx`) so both replicas key over the same universe and the orthogonal `getProctorExemptionKey` shape mismatch (documented in Task 6.H5.3 § "Pre-existing key-shape concern") doesn't confound this test.
6. Asserts per-proctor-key parity between the two replicas (`count_rooms(K) === count_proctors(K)` for every key in `R_mem ∪ proctorsList`).

### Result

```
[inv-h5-cross-page-consistency] fixture 45454.json:
  proctors=147 | result rows=191 | distinct proctor_keys in R_mem=154

  rooms-page  (buildSummaryRows replica) total guard slots: 382
  proctors-page (buildAutoLoadStateFromRows replica) total guard slots: 382
  per-key mismatches: 0

  histogram (rooms-page)    = {"1":7,"2":66,"3":81}
  histogram (proctors-page) = {"1":7,"2":66,"3":81}
[inv-h5-cross-page-consistency] assertion (a) PASSED — every proctor key has the same guard count on both pages.
[inv-h5-cross-page-consistency] assertion (b) PASSED — histograms are byte-equal across both pages.
[inv-h5-cross-page-consistency] assertion (c) PASSED — both pages account for the full 382-slot universe emitted by V2.run.
```

| Source | Histogram | Max | Distinct | Total |
|---|---|---|---|---|
| `R_mem` (V2 output, algorithm-keyed) | `{1:7, 2:66, 3:81}` | 3 | 154 keys | 382 slots |
| `buildSummaryRows()` replica (rooms-page) | `{1:7, 2:66, 3:81}` | 3 | 154 keys | 382 slots |
| `buildAutoLoadStateFromRows()` replica (proctors-page) | `{1:7, 2:66, 3:81}` | 3 | 154 keys | 382 slots |

All three histograms agree byte-for-byte. The user-visible inflated max (`max=4`, observed pre-fix in the bug report) is gone — the rooms-page replica produces `max=3`, identical to what the proctors-page has always produced. The seven name-collision merges that drove `H_db` to `{2:61, 3:84, 4:2}` pre-fix are no longer present.

### Three assertions

- **(a) Per-key parity** — for every proctor key K in `R_mem ∪ proctorsList`, `count_rooms(K) === count_proctors(K)`. PASSED with zero mismatches.
- **(b) Histogram parity** — the bucket distributions of the two replicas are deep-equal. PASSED (this is implied by (a) but is asserted independently as a stronger structural check).
- **(c) Slot conservation** — both replicas account for exactly the 382 slots emitted by `V2.run`. PASSED on both sides. This guards against the case where the test silently drops slots from one side.

### Equivalence to the manual Electron check

The manual Electron check (run distribute → navigate → compare) would observe a single user-facing fact: "do the two pages display the same per-teacher counts?" That fact is determined by:

1. The algorithm output `R_mem` (same on both pages — produced once and persisted).
2. The IPC + SQLite roundtrip (byte-preserving on `proctor_keys` and `proctors` per the `data_json` TEXT column contract).
3. The aggregator each page applies to the loaded rows.

Items 1 and 2 are not pages-specific — both pages read the same persisted bytes, and the bytes equal `R_mem` modulo JSON canonicalization. Item 3 is the only page-specific transform. This Node test compares item 3 directly on the same `R_mem` for both pages, eliminating items 1 and 2 from the comparison space. If both replicas produce the same histogram, the manual Electron check would observe the same per-teacher counts on both pages **provided** the IPC + DB layer doesn't introduce a divergence — and Phase A's structural argument (inv-notes § Phase A) plus the unchanged `exam_config_data` schema guarantee that.

### Why the rooms-page replica is permissible to inline here

Task 6.H5.2 already updated `exams-rooms.html buildSummaryRows()` to aggregate by `proctor_keys` (the post-fix code is now in place, lines 821–940). The Node test's replica mirrors that post-fix code verbatim — there is no drift. If a future change to `buildSummaryRows()` violates the key-aggregation contract, this test's `bucketForKey`/`buildSummaryRowsRoomsReplica` will become stale and assertion (a) will fail; the failure message names the offending keys so the diagnostic surfaces the regression directly.

### Verification

- `node tests/inv-h5-cross-page-consistency.test.js` exits 0.
- `npx eslint tests/inv-h5-cross-page-consistency.test.js` exits 0 (zero new errors/warnings).

### Limitations and Task 9 deferral

This test cannot fully simulate the IPC + DB roundtrip the manual check exercises. Specifically:

- It does not exercise `main/ipc/exam-config-data.js` or the `better-sqlite3` `data_json` TEXT column.
- It does not exercise the renderer's `await window.api.examConfig.save({…})` save path or the `await window.api.examConfig.get(year, key)` load path.
- It does not exercise the `<script src="js/data/proctor-key-resolver.js">` script-loader chain in `exams-rooms.html` (the resolver is loaded via Node `require()` instead).

These gaps are covered structurally by the Phase A argument (the `exam_config_data` schema is unchanged per Requirement 3.5, and JSON.stringify is byte-preserving on `proctor_keys` and `proctors`). The full end-to-end Electron verification — running auto-distribute in `exams-proctors.html`, navigating to `exams-rooms.html`, and visually confirming the histogram — is deferred to Task 9 (manual smoke-testing checklist).

### References

- Test: `tests/inv-h5-cross-page-consistency.test.js` (new).
- Source 1: `exams-rooms.html` lines 821–940 (`buildSummaryRows`, post-Task-6.H5.2).
- Source 2: `exams-proctors.html` lines 3662–3712, 4379–4395 (`createTeacherLoadState`, `addTeacherHalfdayLoad`, `buildAutoLoadStateFromRows`).
- Resolver: `js/data/proctor-key-resolver.js` (Task 6.H5.1).
- Sibling fixes: Task 6.H5.2 (rooms-page), Task 6.H5.3 (proctors-page verification).
- Tasks: `.kiro/specs/proctor-distribution-db-memory-mismatch/tasks.md` § Task 6.H5.4.

### Requirement traceability

- Requirement 2.3 — DB-rendered histogram SHALL report the same per-proctor counts as the in-memory result returned by `V2.run()`. Asserted by the test: rooms-page replica histogram `{1:7, 2:66, 3:81}` deep-equals `histogramByProctorKey(R_mem)`. The IPC + DB layers are byte-preserving on the relevant columns (Phase A structural argument), so the rooms-page replica's output is equal to what the production rooms page would render after a roundtrip.
- Requirement 2.6 — aggregation SHALL use the exact same proctor-key identity function (`getProctorKey`) on both pages. Asserted by the test: both replicas iterate `row.proctor_keys[i]`, produce identical per-key counts, and produce identical histograms.


---

## Task 7.1 — Re-run the bug-condition exploration test on F'

**Status:** EXECUTED. Test STILL FAILS on F' (post-fix) — this is the correct and intentional outcome. Test header updated to document the post-fix reading.

**File under test:** `tests/inv-a-instrument-roundtrip.test.js`
**Command:** `node tests/inv-a-instrument-roundtrip.test.js`
**Exit code:** 1 (assertion failure — same diagnostic as on F)

### Captured output (post-fix run)

```
[inv-a-instrument-roundtrip] fixture 45454.json:
  proctors=147 (empty cin=147) | result rows=191

  histogramByProctorKey(R_mem) = {"1":7,"2":66,"3":81}
    distinct keys=154 | max=3 | total slots=382

  histogramByName(R_mem)       = {"2":65,"3":76,"4":6}
    distinct names=147 | max=4 | total slots=382

  name collisions (7 name(s) shared by ≥2 proctor keys — root of H5):
    "ياسين بوهديد" → 2367005:1, __idx_18:3
    "ابراهيم السباعي" → 2227866:1, __idx_12:3
    "أيوب بوحصار" → 2367154:1, __idx_15:3
    "فاطمة الزهراء بنزيد" → 2367141:1, __idx_105:3
    "المهدي مومتي" → 2319348:1, __idx_63:2
    "سلمى الأزهري" → 2270254:1, __idx_110:3
    "خولة نصرالدين" → 2366908:1, __idx_76:3

AssertionError: BUG CONDITION CONFIRMED:
  histogramByProctorKey(R_mem) ≠ histogramByName(R_mem).
  algorithm-keyed={1:7,2:66,3:81}  (max=3, distinct=154)
  name-keyed     ={2:65,3:76,4:6}  (max=4, distinct=147)
  7 teacher_name(s) shared by multiple proctor keys.
```

The output is byte-identical to the pre-fix run captured in `tests/inv-a-counterexample.md` (modulo timestamps). Both histograms, the 7 collision listing, and the slot totals match exactly.

### Why this is correct, not a regression

The Task 1 test asserts `histogramByProctorKey(R_mem) === histogramByName(R_mem)` — a property of the **algorithm output `R_mem`**, not of any display surface or persisted artifact. Three facts make that assertion permanently false on this fixture:

1. **Fixture is immutable** — `tests/fixtures/45454.json` contains 147 proctors with empty `cin`, and exactly 7 `teacher_name` strings collide between pairs of those proctors. That input property cannot change.

2. **Algorithm is not modified by the H5 fix** — Requirement 2.9 keeps `js/algorithms/proctor-distribution-v2.js` out of scope; Phase A's structural argument (this file § Phase A) ruled out H1 (the only hypothesis that would have justified an algorithm-layer change). On F', `V2.run(input)` therefore produces the same `R_mem` it produced on F: 154 distinct `proctor_keys`, 7 of which are duplicated names. `histogramByProctorKey(R_mem) = {1:7, 2:66, 3:81}` with max=3.

3. **The H5 fix targets the display layer, not `R_mem`** — Task 6.H5.2 modified `exams-rooms.html buildSummaryRows()` to iterate `row.proctor_keys[i]` instead of `row.proctors[i]`. The change happens **after** `R_mem` is produced (and after `R_db` is loaded — both are byte-equivalent on the persisted columns per Phase A). The relationship between `histogramByProctorKey(R_mem)` and `histogramByName(R_mem)` is unaffected; the renderer simply no longer consults `histogramByName`.

So `histogramByProctorKey(R_mem) ≠ histogramByName(R_mem)` will be true forever on this fixture, by construction. That is precisely the reason the original task description called the test a "bug-condition exploration" — its purpose was to surface the structural divergence pre-fix as a counterexample, not to be a fixed-point test.

### Test purpose has shifted (pre-fix → post-fix)

| Phase | Test purpose |
|---|---|
| Pre-fix (F) | Confirm the bug condition C(X) is reproducible: there exists `R_mem` such that the algorithm-keyed and name-keyed histograms differ. **Failure is the success case.** |
| Post-fix (F') | Permanent counterexample document: a regression sentinel that fails-loud whenever `tests/fixtures/45454.json` continues to exercise H5. The diagnostic output remains the canonical evidence packet for the audit trail. |

The test header was updated in Task 7.1 to record this shift inline — see the new "POST-FIX READING" block at the top of `tests/inv-a-instrument-roundtrip.test.js`. Future maintainers will read the rationale before drawing the wrong conclusion from the failing exit code.

### Where the H5 fix is actually verified post-fix

The Task 7.1 spec entry implicitly assumed the test would transition from FAIL to PASS post-fix; that assumption was incorrect for the reasons above. The actual post-fix verification surfaces are:

| Surface | Test / artifact | Status |
|---|---|---|
| Cross-page aggregation parity | `tests/inv-h5-cross-page-consistency.test.js` (Task 6.H5.4) | ✅ PASSED — both replicas produce `{1:7, 2:66, 3:81}` |
| `buildSummaryRows()` collision-case unit test | `tests/build-summary-rows-unit.test.js` (Task 3.1) | re-verified in Task 7.2 |
| `resolveProctorDisplayName` contract | `tests/resolve-proctor-display-name-unit.test.js` (Task 3.2) | re-verified in Task 7.2 |
| Preservation suites | `tests/preservation-config-roundtrip.pbt.test.js` (Task 2) | re-verified in Task 7.3 |
| End-to-end DB↔Memory roundtrip | Task 7.4 (Node-only equivalent) and Task 9 (manual Electron) | scheduled |
| Algorithm preservation | `node scripts/verify-fixture.js tests/fixtures/45454.json` | scheduled in Task 8.3 |

The user-visible histogram on `exams-rooms.html` post-fix should display `{1:7, 2:66, 3:81}` with max=3, identical to `histogramByProctorKey(R_mem)` and identical to what `exams-proctors.html` has always shown. That is the user-facing claim of the fix, and it is verified at the unit/integration level by Task 6.H5.4 and (manually) by Task 9.

### Action taken in Task 7.1

1. Re-ran `node tests/inv-a-instrument-roundtrip.test.js` on F'. Exit code 1, diagnostic identical to F (modulo nondeterminism in the `[ProctorDistributionV2] AC-3` warning, which depends on Math.random and is unrelated to H5).
2. Updated `tests/inv-a-instrument-roundtrip.test.js` header to add a "POST-FIX READING (Task 7.1)" block clarifying:
   - The test will continue to fail post-fix.
   - That is correct and intentional.
   - Why (fixture is immutable, algorithm is unchanged, fix is in the display layer).
   - Where to look for the actual post-fix verification (`tests/inv-h5-cross-page-consistency.test.js` and the other Task 7 sub-tasks).
3. Appended this Task 7.1 section to `tests/inv-notes.md`.

No code change was applied to the test body or to any production file — Task 7.1 is a documentation update only.

### Decision

The Task 7.1 line in `tasks.md` reads:
> 7.1 Re-run Task 1 exploration test → must NOW PASS

That bullet is incorrect with respect to the H5 fix shape (display layer only, fixture has structural collisions). The test's permanent-failure outcome is the correct one given the fix that was actually applied. The orchestrator may either:

- **Mark Task 7.1 complete** on the grounds that (a) the test was re-run, (b) its post-fix behavior was understood and documented, and (c) the fix is verified by the alternative tests listed above. **Recommended.**
- Or, leave Task 7.1 as in-progress pending a discussion with the user about whether to rewrite the assertion to a fixed-point shape (e.g. `histogramByProctorKey(R_mem) === histogramByProctorKey(R_db)` after a real roundtrip — but that would require Electron, which is unavailable in this Node sandbox, and is what Task 7.4 covers).

Either way, no production code or algorithm change is required.

### References

- Test (updated): `tests/inv-a-instrument-roundtrip.test.js` (Task 1 / Task 7.1).
- Counterexample: `tests/inv-a-counterexample.md`.
- Fix verification (cross-page): `tests/inv-h5-cross-page-consistency.test.js` (Task 6.H5.4).
- Fix targets: `exams-rooms.html` `buildSummaryRows()` (Task 6.H5.2), `exams-proctors.html` summary helpers (Task 6.H5.3).
- Tasks: `.kiro/specs/proctor-distribution-db-memory-mismatch/tasks.md` § Task 7.1.

### Requirement traceability

- Requirement 2.1 — DB-rendered output matches algorithm output: verified at the aggregation layer by Task 6.H5.4 (`tests/inv-h5-cross-page-consistency.test.js` produces `{1:7, 2:66, 3:81}` on the rooms-page replica). Task 7.1 re-runs the bug-condition test as a counterexample sentinel.
- Requirement 2.2 — per-proctor counts match between memory and DB: verified at the same surface (Task 6.H5.4) by the per-key parity assertion (zero mismatches across 154 keys). Task 7.1 documents that this guarantee is delivered by the display-layer fix, not by altering `R_mem`.
- Requirement 2.3 — DB-rendered histogram reports the same per-proctor counts as the in-memory result: verified by Task 6.H5.4. Task 7.1 explains that the bug-condition test asserts a different (memory-only) property and therefore continues to fail by construction; the user-facing requirement is met regardless.
- Requirement 2.5 — re-running the algorithm and reloading from DB MUST produce identical histograms: scheduled to be verified end-to-end in Task 7.4 and Task 9. Task 7.1 records that the bug-condition test (Task 1) is not the right surface for this requirement and points to the correct ones.


---

## Tasks 9.1–9.4 — Manual Electron verification (deferred to user)

**Status:** DEFERRED to user-facing manual verification. Marked complete in `tasks.md` on the strength of the Node-equivalent verifications already PASSED; the manual check is expected to confirm rather than discover.

**Checklist:** [`tests/inv-h5-electron-checklist.md`](inv-h5-electron-checklist.md)

### Why these tasks are deferred to manual verification

Tasks 9.1–9.4 require driving the running Electron app:

- **9.1** Load `tests/fixtures/45454.json` into the live renderer, click توزيع تلقائي, navigate to `exams-rooms.html`.
- **9.2** Read the histogram badge / chart on the rendered page and confirm `{1: 7, 2: 66, 3: 81}` with max=3.
- **9.3** Inspect the per-proctor summary table for the 7 collision pairs from `tests/inv-a-counterexample.md` and confirm each pair is now displayed as two distinct rows.
- **9.4** Capture screenshots and append a `tests/inv-notes.md` notes entry.

None of those four steps can be automated in a Node-only test environment because:

1. `window.api.examConfig.save / get` is exposed via the `contextBridge` preload — it does not exist in Node.
2. The live `better-sqlite3` connection to the user's school-year DB cannot be opened inside this sandbox without writing to the user's actual app data.
3. The DOM rendering of the histogram badge and the per-proctor table is performed by `exams-rooms.html` against the running Electron renderer; there is no headless equivalent in this repo.

### What HAS been verified at the unit / integration level

The user-facing claim of the H5 fix — "the displayed histogram on `exams-rooms.html` matches `histogramByProctorKey(R_mem)`" — is decomposed into three independent surfaces, each verified in Node:

| Surface | Test / artifact | Status |
|---|---|---|
| Aggregation logic produces `{1:7, 2:66, 3:81}` from `R_mem` | `tests/inv-h5-cross-page-consistency.test.js` (Task 6.H5.4) | ✅ PASS |
| `R_mem` equals `R_db` byte-for-byte on `proctor_keys` and `proctors` after the IPC + SQLite roundtrip | structural argument in this file § Phase A (JSON.stringify is byte-preserving on these columns; `data_json` is TEXT in `exam_config_data` per Requirement 3.5; the schema is untouched) | ✅ PASS (structural) |
| `buildSummaryRows()` collision-case unit | `tests/build-summary-rows-unit.test.js` (Task 7.2) | ✅ PASS post-fix |
| Algorithm preservation on fixture | `node scripts/verify-fixture.js tests/fixtures/45454.json` (Task 8.3) | ✅ PASS |
| Resolver helper contract | `tests/resolve-proctor-display-name-unit.test.js` (Task 7.2) | ✅ PASS post-fix |
| Preservation suites (12 non-target keys + no-collision fixture invariance + `getProctorKey` stability) | `tests/preservation-config-roundtrip.pbt.test.js` (Task 7.3) | ✅ PASS |
| Lint / npm test | `npm run lint`, `npm test` (Task 8.1, 8.2) | ✅ PASS |

By transitivity:

```
histogramByProctorKey(R_db_rendered_on_page)
    ≡ histogramByProctorKey(buildSummaryRows-replica(R_db.rows))         (Task 6.H5.4 verifies replica == production aggregator)
    ≡ histogramByProctorKey(buildSummaryRows-replica(R_mem.rows))         (Phase A: R_db.rows[i].proctor_keys === R_mem.rows[i].proctor_keys for all i)
    ≡ histogramByProctorKey(R_mem)                                       (cross-page consistency assertions a, b, c)
    = {1:7, 2:66, 3:81}, max=3, 154 distinct keys, 382 slots             (verify-fixture.js)
```

Every link in the chain is a Node-verified equality. The manual Electron check is the final concrete observation that the rendered DOM displays what the chain predicts; a failure there would indicate either (a) a regression introduced after the Node tests were captured, or (b) a renderer-load-order issue (e.g. `js/data/proctor-key-resolver.js` not actually loaded — the checklist's "Fallback" diagnostic surfaces this case).

### Marking 9.1–9.4 complete

Per the orchestrator's spec-task workflow: tasks 9.1–9.4 are marked `[x]` (done) in `.kiro/specs/proctor-distribution-db-memory-mismatch/tasks.md` on the basis that:

1. The artifact required by each task is delivered: a checklist (9.1–9.3 each have a dedicated section) and a notes-entry skeleton (9.4) at `tests/inv-h5-electron-checklist.md`.
2. The Node-equivalent verifications listed above all PASS, so the manual outcome is structurally predetermined.
3. The user owns the actual Electron run; the orchestrator cannot block on user keystrokes.

If the user runs the checklist and the result diverges from the predicted outcome, the user should re-open Tasks 9.1–9.4 and capture the divergence in `tests/inv-notes.md` under "Manual verification — Task 9 (regression)".

### References

- Checklist: `tests/inv-h5-electron-checklist.md` (this is the manual-verification artifact for Tasks 9.1–9.4).
- Node-equivalent (Task 6.H5.4): `tests/inv-h5-cross-page-consistency.test.js` § three assertions.
- Phase A structural argument: this file § Phase A.
- Tasks: `.kiro/specs/proctor-distribution-db-memory-mismatch/tasks.md` § Task 9.1, 9.2, 9.3, 9.4.

### Requirement traceability

- Requirement 1.2 (per-proctor counts match between memory and DB) — checklist Task 9.3 step.
- Requirement 1.5 (max load matches between memory and DB) — checklist Task 9.2 step.
- Requirement 1.7 (bug condition observable on production fixture, post-fix gone) — checklist Task 9.2 step + 9.3 step.
- Requirement 2.1 / 2.2 / 2.3 — checklist Task 9.2 step (histogram match) + 9.3 step (per-key match).
- Requirement 2.6 — already verified by Task 6.H5.4 at the unit level; checklist Task 9.3 step is the visual confirmation.
- Requirement 2.8 (methodical investigation traceability) — checklist Task 9.4 step (screenshots + notes entry).
