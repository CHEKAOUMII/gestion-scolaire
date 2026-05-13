# Session Notes — proctor-v2-use-exam-center-levels

## 2026-03-23 — Task 3.6 regression check

### Scope verified

Task 3.6 was a **read-only verification** confirming that every display-oriented
caller of `getRoomRowsForLevel` in `exams-proctors.html` stayed on the
**original** helper and that `getSummaryCandidateCountForLevel` never sees
synthetic rows.

Callers audited (six in total, same count as before task 3.3):

| Line  | Caller                          | Purpose                 | Reads via                       | Correct for 3.6? |
|-------|---------------------------------|-------------------------|---------------------------------|------------------|
| 1440  | `getReadinessHalfdayRows`       | readiness display       | `getRoomRowsForLevel`           | ✅ display-only   |
| 3230  | `getAutoSessionNeedStats`       | session-need display    | `getRoomRowsForLevel`           | ✅ display-only   |
| 3467  | `getEffectiveRoomRowsForLevel`  | top-up wrapper (self)   | `getRoomRowsForLevel`           | ✅ intentional    |
| 4031  | `buildGuardQuota`               | compute quota needs     | `getRoomRowsForLevel`           | ⚠️ see below      |
| 4063  | `buildPerTeacherQuota`          | compute per-teacher cap | `getRoomRowsForLevel`           | ⚠️ see below      |
| 4742  | `runAutoDistribution` (v1 path) | v1 algorithm loop       | `getRoomRowsForLevel`           | ✅ v1 isolation   |

Only `buildV2Input` (line 2616) calls `getEffectiveRoomRowsForLevel`.
`getSummaryCandidateCountForLevel` (line 6171) reads `examCenterRoomsData`
directly, not via `getRoomRowsForLevel` — synthetic rows never reach it.

### Regression test added

`tests/proctor-v2-display-functions-regression.test.js` — 12 cases, all passing.

Key assertion (from task 3.6): a level with `examCenterLevels[L].rooms = 2` and
`M = 0` stored rows returns `0` from `getSummaryCandidateCountForLevel(L)`,
never `2`. The display count reads `examCenterRoomsData` only; it is orthogonal
to the expected-rooms count used by v2 input construction.

### ⚠️ Open tension between design.md and tasks.md — NOT addressed here

design.md §"Control Flow" states:

> الدوال `buildGuardQuota`, `buildPerTeacherQuota`, `getPlanningReadiness` تستدعي
> `getRoomRowsForLevel` لحساب `totalGuardTasks`. لكي يتطابق مجموع الحاجيات مع
> `roomsList` الممرَّر إلى الخوارزمية، هذه الدوال يجب أن تستعمل نفس منطق التكميل.

But tasks.md does **not** schedule any subtask that updates those three
functions. Task 3.6 explicitly scopes itself to "regression check — display
functions stay on the original", and it explicitly lists
`getSummaryCandidateCountForLevel` as display-only (correct). Tasks 3.4 updates
only `buildV2Input`. There is no task 3.x that touches `buildGuardQuota` /
`buildPerTeacherQuota` / `getPlanningReadiness`.

**Consequence today:**
- v2's `roomsList[L]` is topped up to `examCenterLevels[L].rooms` (Property 1
  passes).
- But quota-side helpers still count only the *actual* saved rows, so the
  displayed "total guard tasks" and the per-teacher cap can be smaller than
  the tasks actually produced by Phase_2_Build.
- If the user adds many synthetic rows across many levels, the quota under-
  estimates demand and may trigger fairness false positives in the diagnostics
  panel.

**Why we did NOT fix it in task 3.6:**

1. The task is explicitly scoped to verification ("تحقّق ... regression check")
   plus one unit test. It forbids code changes.
2. The candidate fix (swap the three helpers over to
   `getEffectiveRoomRowsForLevel`) is a real design change that needs its own
   task, acceptance criteria, and tests for v1 isolation and for save-format
   invariance.
3. `runAutoDistribution` at line 4742 **must stay** on `getRoomRowsForLevel` —
   per design.md §"Preservation Requirements" the v1 path is off-limits. Any
   future task that rewrites the three quota helpers must guard against v1
   accidentally reaching into `examCenterLevelsMap`.

**Recommended follow-up (next session):**

Add a new sibling task under 3 (e.g. **3.10 Align quota helpers with effective
room rows**) that:

- plumbs `examCenterLevelsMap` through `buildGuardQuota`, `buildPerTeacherQuota`,
  `getPlanningReadiness`;
- keeps `getReadinessHalfdayRows` and `getAutoSessionNeedStats` on the raw
  helper (they are display surfaces, same rule as
  `getSummaryCandidateCountForLevel`);
- leaves `runAutoDistribution` (v1) untouched;
- adds a property test: for every scheduled input,
  `buildGuardQuota().total == Σ roomsList[L].length × proctorsPerRoom` where
  `roomsList` is the one fed to `ProctorDistributionV2.run`.

Until that task lands, treat quota numbers on the diagnostics panel as a lower
bound when synthetic rows are in play.


## 2026-03-23 — Task 3.7 regression check — v1 path stays clean

### Scope

Verification-only task: confirm that `runAutoDistribution` (v1, line 4700 in
`exams-proctors.html`) never touches any of the new v2 top-up helpers, and
that its behaviour on a bug-condition input is bit-for-bit identical to the
pre-fix contract (no synthetic rows, no `syntheticRoomWarnings`).

### How it was verified

Two complementary strategies, both inside
`tests/proctor-v2-v1-path-regression.test.js`:

**Part A — source-level scan.** The test reads `exams-proctors.html` as plain
text, uses a balanced-brace extractor to isolate the body of
`async function runAutoDistribution()` (the v1 entry), and asserts that
none of the 9 forbidden identifiers appear anywhere inside that body:

| # | Forbidden symbol                      | Where it belongs         |
|---|---------------------------------------|--------------------------|
| 1 | `buildV2Input`                        | exams-proctors.html §2577 |
| 2 | `getExamCenterLevelsForActiveYear`    | exams-proctors.html §3370 |
| 3 | `getEffectiveRoomRowsForLevel`        | exams-proctors.html §3466 |
| 4 | `computeEffectiveRoomRows`            | exams-proctors.html §3433 |
| 5 | `buildSyntheticRoomRow`               | exams-proctors.html §3386 |
| 6 | `computeMaxRoomNum`                   | exams-proctors.html §3404 |
| 7 | `buildExamCenterLevelsMap`            | exams-proctors.html §3370 region |
| 8 | `renderSyntheticRoomWarnings`         | exams-proctors.html §2858 |
| 9 | `syntheticRoomWarnings` (state var)   | buildV2Input local + diagnostics panel |

Cross-checks ensure the extractor grabbed the right slice: v1-only landmarks
(`hideDiagnosticsPanel()`, `schedulesByHalfday`) must be present, and
v2-only landmarks (`ProctorDistributionV2.run`) must be absent. Two
sanity-of-detector tests extract the v2 body and `buildV2Input` body and
assert that they DO reference some of the forbidden symbols — this protects
against a silent extraction bug that would otherwise make the v1 assertions
vacuously pass.

One additional positive assertion: v1 body must still call the raw
`getRoomRowsForLevel` helper (not the padded `getEffectiveRoomRowsForLevel`).
If this flipped, the v1 room source has been altered and 3.7 needs
re-review.

**Part B — behavioural mirror.** The test ships a byte-accurate mirror of
the v1 room-assembly loop (single line: `rooms = (await getRoomRowsForLevel(lvl)).slice()`).
Five scenarios exercise it:

1. Full bug condition (M=0, N=2): `roomsList[L]` is empty, `syntheticRoomWarnings` is `undefined`.
2. Partial bug condition (M=2, N=3): keeps exactly the M real rows, no row carries `_synthetic`.
3. Complete level (M==N=2): rooms preserved in order, no warnings.
4. Spy-based negative test: spy implementations of the four top-up helpers throw on call; the v1 loop runs without hitting any spy.
5. Two bug-condition levels simultaneously: both `roomsList` entries empty, `syntheticRoomWarnings` still `undefined`.

### Result

```
[test] v1 path regression: 20 passed, 0 failed
```

15 tests in Part A (extraction + 9 forbidden-name scans + 3 landmarks + 2
sanity-of-detector + buildV2Input wiring check) and 5 in Part B. All green.

### Why a source-scan test (not an end-to-end v1 run)

Attempting to invoke the real `runAutoDistribution` from a test file would
require mocking dozens of DOM globals, `window.api.examConfig`, schedule
entries, proctor state, and toast/diagnostics UI. The resulting harness
would be bigger than the test itself and would couple the regression proof
to DOM plumbing that is unrelated to Requirement 3.4. A static scan of the
v1 function body plus a mirrored loop is sharper: it fails the instant any
new identifier leaks in, and the mirror proves the behavioural contract
without any DOM dependency.

### Why no `const` / `let` arrow-function helpers were scanned

The nine forbidden identifiers cover every v2-only surface — all of them
are top-level `function` / `async function` declarations in the HTML (see
the `grep_search` results in this session's scratch). If future tasks add
arrow-function helpers (e.g. `const renderFoo = (...) => ...`), extend
`forbiddenNames` accordingly. The scan uses `\b` word boundaries so adding
a new name is a one-line change.

### Relationship to task 3.6 caveat

The open tension noted at the end of the task-3.6 entry (quota helpers
`buildGuardQuota` / `buildPerTeacherQuota` / `getPlanningReadiness` still
read raw rooms) is NOT touched by 3.7. Those helpers are called from both
v1 and v2 paths, so any change there must honour the v1 isolation proved
here. When the follow-up task lands, it must re-run this file.

### Files touched

- `tests/proctor-v2-v1-path-regression.test.js` — strengthened (added
  `buildExamCenterLevelsMap` to the forbidden list, added the
  raw-`getRoomRowsForLevel` positive assertion, added two detector-sanity
  checks against the v2 body, and one wiring check against `buildV2Input`).
- `exams-proctors.html` — **unchanged** (3.7 is verification-only).
- `js/algorithms/proctor-distribution-v2.js` — **unchanged**.


## 2026-03-23 — Task 7 Checkpoint — All tests green

### Test summary

| Suite | Files | Pass | Fail |
|-------|-------|------|------|
| Bugfix tests (`tests/proctor-v2-*.test.js`) | 12 | **145** | **0** |
| Pre-existing v2 tests (`tests/proctor-distribution-v2-*.test.js`) | 8 | 105 | 1 pre-existing |

### Pre-existing failure (NOT caused by this bugfix)

`tests/proctor-distribution-v2-csp.test.js::testProctorKeyUsesIndex` fails on
the unfixed-before-our-work main branch too. Confirmed via `git stash` →
re-run → same failure → `git stash pop`. Out of scope for this spec.

### Cleanup summary

- `grep "[V2 DEBUG]" exams-proctors.html` → **0 matches**
- `grep "[V2 WARN]" exams-proctors.html` → **5 matches** (all diagnostic value):
  - `examCenterLevels not available for active year — falling back to roomsData only`
  - `synthetic rooms added for level "…" — expected …, actual …, added …`
  - `Fuzzy match for "…" → found N rooms via "…"`
  - `No rooms found for level: "…"`
  - `Available levels in roomsData: […]`

### What this spec delivered

1. Fixed the silent drop of levels from Phase_2_Build when their rooms are
   unsaved (bugfix.md §1.1–1.3 → §2.1–2.7).
2. Added a Diagnostics Panel section + aggregated toast exposing the top-up
   (bugfix.md §2.2, 2.6).
3. Proved v1 path is fully isolated from the new logic (bugfix.md §3.4, 3.5).
4. Proved display functions never see synthetic rows (bugfix.md §3.6).
5. Proved persisted roomsData is never mutated by buildV2Input (bugfix.md §3.3).
6. Proved synthetic numbering never collides with actual rooms (bugfix.md §2.3).

### Files changed

- `exams-proctors.html` — added 7 helpers, updated `buildV2Input`, added
  `renderSyntheticRoomWarnings` + Diagnostics section, fixed missing `await`
  in `runAutoDistributionV2`, cleaned up `[V2 DEBUG]` logs, converted 3
  fuzzy-match logs to `[V2 WARN]`.
- `tests/proctor-v2-*.test.js` — 12 new test files, 145 total assertions.
- `.kiro/specs/proctor-v2-use-exam-center-levels/` — bugfix.md, design.md,
  tasks.md, SESSION-NOTES.md.

### Deferred follow-up (reiterated here for the next session)

Task 3.10 proposed in the Task 3.6 entry: align `buildGuardQuota`,
`buildPerTeacherQuota`, `getPlanningReadiness` with `getEffectiveRoomRowsForLevel`
so quota totals match the topped-up roomsList. Until that lands, quota numbers
in the diagnostics panel can underestimate demand when synthetic rows are in play.
