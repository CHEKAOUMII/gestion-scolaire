# Proctor V2 — Singleton Eligibility Class Bounds Bug

**Discovered:** 2026-05-16 during execution of `proctor-v2-phase2-75-multi-step-repair` spec.
**Status:** Open — needs new spec.
**Severity:** Medium-High — same proctors affected as the parent spec (1 zero-load proctor on production fixture + 5 false-positive uncovered proctors).
**Suggested spec name:** `proctor-v2-singleton-class-bounds` or `proctor-v2-impossible-class-bounds-fix`

---

## TL;DR

The earlier spec `proctor-v2-phase2-75-multi-step-repair` diagnosed the
production-fixture `min=0` regression as a single-swap-per-round limitation
in `phase2_75CoverageRepair`. **That diagnosis was incomplete.** The spec's
implementation (inner repair loop + diagnostics shape migration) is structurally
correct and useful — it actually surfaced the real root cause via the new
structured warnings. But it does not resolve the regression because the real
bug is one layer earlier, in `computeClassBounds`.

The real bug: `computeClassBounds` produces `classLowerBound > total_slots / total_proctors`
for **singleton (and small) eligibility classes** in the multi-class fallback
path, demanding loads that are mathematically impossible for any algorithm to
satisfy.

---

## Bug Statement

`computeEligibilityClasses` in `js/algorithms/proctor-distribution-v2.js`
(≈ line 494) constructs `classId = eligible.join(',') + '|' + baselineDuty`.
Any proctor with a unique exemption/duty pattern lands in a **singleton class**
(class with exactly one member). `computeClassBounds` (≈ line 542) then enters
the multi-class fallback branch (`classIds.length > 1`) and computes:

```js
var bSize = Math.max(1, (bClass.members || []).length);   // = 1 for singleton
var bTotal = bG + bD;                                     // ≈ G_class
classLowerBound: Math.floor(bTotal / bSize),              // = bTotal entirely
classUpperBound: Math.ceil(bTotal / bSize)
```

For a singleton class, `bSize = 1` so `classLowerBound = bTotal`. That value
is the entire `G_class` (the count of guard slots reachable by the singleton's
eligibility set), which on production fixtures is 294-352 — astronomical. No
algorithm can place a single proctor in 350+ slots when the entire fixture only
has 382 slots total and one proctor can occupy at most one slot per row.

---

## Witness on `tests/fixtures/45454.json`

Post-`proctor-v2-phase2-75-multi-step-repair` Tasks 5.2 + 6.1–6.4 run, the
structured `coverageRepairWarnings` map reveals:

```
"__idx_98":  classLowerBound:352, initialLoad:1, finalLoad:1   ← طارق الشعابتي
"__idx_62":  classLowerBound:342, initialLoad:3, finalLoad:3
"__idx_28":  classLowerBound:342, initialLoad:3, finalLoad:3
"__idx_133": classLowerBound:318, initialLoad:3, finalLoad:3
"__idx_109": classLowerBound:294, initialLoad:3, finalLoad:3
"__idx_21":  classLowerBound:352, initialLoad:3, finalLoad:3
```

Six proctors flagged as "uncovered" with mathematically impossible targets.
Five of them are at `load=3` (= `globalUpperBound`); the inner repair loop
correctly determines no donor can be found (every donor would exceed `globalUpperBound`)
so it emits `no_swappable_peer` per the post-fix contract. They are NOT
genuine deficits — they are false positives from `computeClassBounds`.

The sixth (طارق, idx=98) is at `load=1` after the inner loop fired one swap
for him; he stays at `min=0` if the swap is rejected by Phase 3 or another
constraint, otherwise at `load=1`. Either way, `min < globalLowerBound = 2`,
which is the empirical regression that motivated the parent spec.

---

## How This Was Hidden Before

Pre-`proctor-v2-key-shape-unification` (closed 2026-05-16):
- Dual-identity bug let Phase 2 over-assign affected proctors.
- Their guard counts were inflated above their own `classLowerBound` accidentally.
- The impossible singleton-class bounds were never tested because the proctors
  appeared to satisfy them.

Pre-`proctor-v2-phase2-75-multi-step-repair` Tasks 5.2 + 6.1:
- `coverageRepairWarnings: Array<{proctorKey, reason}>` was unstructured.
- The diagnostic only said `no_swappable_peer` — no `classLowerBound` field.
- The 6 affected proctors looked like "could not find a donor in any row",
  which is consistent with the (wrong) single-swap-per-round hypothesis.

Post-Tasks 5.2 + 6.1:
- `coverageRepairWarnings` is now `Object<proctorKey, {reason, initialLoad, finalLoad, classLowerBound, attemptedSwaps}>`.
- The `classLowerBound: 352` field is now visible.
- The bug is unmasked.

So the earlier spec's implementation is **observationally useful** even though
it does not fix the regression: it migrated the diagnostics shape that revealed
the deeper bug.

---

## Why The Earlier Spec's Diagnosis Was Wrong

The original investigation document (`.agent/proctor-v2-phase2-75-multi-step-repair.md`)
read the production fixture's symptoms — `min=0`, `coverageRepairUnresolved=6`,
طارق at load=0 — and inferred a "single-swap-per-round structural cap" in
`phase2_75CoverageRepair`. The inference was plausible because:

1. Symptoms matched the typical multi-step-deficit failure mode (proctor stuck
   at `lowerBound − 1` after one swap).
2. The closed `proctor-v2-fairness-undercovered-fix` spec had established the
   `min ≥ classLowerBound` invariant globally, so the unfixed code's
   coverageRepairUnresolved=6 looked like incomplete repair attempts.
3. The dominant `coverageRepairWarnings` reason was `no_swappable_peer`, which
   in the absence of structured payload looks like "I couldn't find a peer to
   donate" — consistent with both root-cause hypotheses.

The miss was in **what `classLowerBound` actually meant for the affected
proctors**. The earlier investigation interpreted `classLowerBound` as the
GLOBAL fairness lower bound (= 2 on the fixture, derived from
`floor(382/147) ≈ 2.6` then floored). The actual implementation computes
PER-CLASS bounds, and for singleton classes those bounds equal `G_class`
(all reachable slots) — a fundamentally different quantity from the global
fairness lower bound.

---

## What Was Implemented (To Be Preserved)

In `js/algorithms/proctor-distribution-v2.js`:

1. **Inner repair loop** in `phase2_75CoverageRepair` (≈ lines 3098–3190):
   `WHILE getPrimaryLoad(loadState, uncov.key) < bounds.classLowerBound DO ...`.
   Multi-step swap support per uncovered proctor. Correctly closes deficits
   when reachable donors exist.

2. **Diagnostics shape migration** (≈ lines 3079, 3115–3140, 3180–3190):
   `coverageRepairWarnings: []` → `coverageRepairWarnings: {}` keyed by canonical
   proctorKey, with structured payload `{reason, initialLoad, finalLoad, classLowerBound, attemptedSwaps}`.

3. **`__pass__` synthetic key** in catch path (≈ line 3210):
   `return { swaps: 0, unresolved: 0, durationMs: 0, warnings: { '__pass__': { reason: 'pass_threw', error } } };`

4. **Post-condition check** at end of `phase2_75CoverageRepair` (≈ lines 3194–3204):
   Asserts `unresolved === |Object.keys(warnings).filter(k => k !== '__pass__')|`,
   logs `console.warn` on mismatch, does not throw.

5. **Orchestrator default + catch + aggregation fallbacks** (≈ lines 4383, 4396, 4435):
   `warnings: []` → `warnings: {}`, with `__pass__` synthetic key in catch.

These changes are correct and they ENABLE the new spec's investigation. They
should be preserved as-is.

---

## What Was Implemented (Tests — Mixed Pass/Fail)

Pre-existing test files added by the parent spec, post-Tasks 5.2 + 6.1–6.4:

- `tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js` ✅ 6/6 cases pass
- `tests/proctor-v2-phase2-75-multi-step-determinism.test.js` ✅ pass
- `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js` ⚠️ snapshot needs re-capture (the additive `[]` → `{}` shape change is a permitted observable migration; the existing snapshot in `tests/fixtures/proctor-v2-phase2-75-multi-step-preservation-snapshot.json` is pre-fix)
- `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` ❌ still fails — surfaces 5 counterexamples that are now consequences of the singleton-bounds bug
- `tests/proctor-v2-phase2-75-multi-step-fix.test.js` ❌ still fails — same root cause

The exploration test is the most valuable artifact: it uses the new structured
warnings to surface `classLowerBound: 352` and similar impossible values.

---

## Hypothesized Fix (Sketch — Detailed Design Belongs in New Spec)

**Goal:** `classLowerBound` MUST never exceed the global fairness lower bound
for any proctor in any class. The semantics intended by the closed
`proctor-v2-fairness-undercovered-fix` spec was per-class fairness, not
per-class infeasibility.

**Option 1 — Cap classLowerBound by global average** (simplest, recommended for
new spec design phase):

```js
var globalAvg = Math.floor(totalSlots / totalEligibleProctors);
classLowerBound = Math.min(perClassFloor, globalAvg);
classUpperBound = Math.max(perClassCeil, globalAvg);
```

The fairness invariant `min ≥ classLowerBound` then degenerates to
`min ≥ globalAvg` for singleton classes — which is the actual user-facing
goal.

**Option 2 — Merge singleton classes into nearest-superset class** (more
invasive, changes class-id semantics):

```js
if (cls.members.length === 1) {
  var subset = findSupersetClass(classes, cls.eligibleSet);
  if (subset) mergeInto(subset, cls);
}
```

**Option 3 — Two-tier bounds (hard floor = global, soft target = perClass):**

```js
classBounds[id] = {
  hardLowerBound: globalLowerBound,         // never violate
  softTarget: Math.min(perClassFloor, ...), // aspirational
  classUpperBound: ...
};
```

`collectUncovered` and `phase2_75CoverageRepair` would consult `hardLowerBound`
for invariant checks and `softTarget` for fairness optimization.

The new spec's design.md should evaluate these and pick one with rationale.

---

## Property P For New Spec

**Bug Condition C(X):** ∃ class `c` with `classLowerBound(c) > floor(total_slots / total_eligible_proctors)`.

**Property P:** ∀ class `c`, `classLowerBound(c) ≤ floor(total_slots / total_eligible_proctors)`.

**Preservation:** every test that passes pre-fix continues to pass; the
existing inner-repair-loop and diagnostics-shape-migration changes from the
parent spec are not touched.

---

## Connection to Closed Specs

| Spec | Status | Relation |
|---|---|---|
| `proctor-v2-fairness-undercovered-fix` | Closed 2026-05-16 | Established `min ≥ classLowerBound` invariant. Its tests passed because no production input exhibited a singleton class with `G_class > globalAvg`. The new spec **restores truthful** invariant by capping classLowerBound. |
| `proctor-distribution-db-memory-mismatch` | Closed 2026-05-16 | Display layer, scope-disjoint. |
| `proctor-v2-key-shape-unification` | Closed 2026-05-16 | Made Phase 2 honest about duty constraints, exposing the singleton-class proctors that the new spec must handle. |
| `proctor-v2-phase2-75-multi-step-repair` | **PARTIALLY CLOSED — needs follow-up** | Inner repair loop + diagnostics shape migration are correct and merged. The fix-checking and exploration tests still fail because the deeper bug is in `computeClassBounds`, not in the repair pass. |

---

## Suggested Workflow for New Spec

**Type:** Bugfix
**Workflow:** Requirements-first
**Initial bug condition:** ∃ proctor `proc_i` whose canonical key `key_i`
satisfies `classBoundsByProctorKey[key_i].classLowerBound > floor(total_slots / total_eligible_proctors)`.

**Initial fix property:** ∀ proctor `proc_i`,
`classBoundsByProctorKey[key_i].classLowerBound ≤ floor(total_slots / total_eligible_proctors)`.

---

## Files To Read In New Session

1. `docs/agent-notes/proctor-v2-singleton-class-bounds.md` — this file
2. `.kiro/specs/proctor-v2-phase2-75-multi-step-repair/` — parent spec (for context)
3. `js/algorithms/proctor-distribution-v2.js` lines 478–530 (`computeEligibilityClasses`)
4. `js/algorithms/proctor-distribution-v2.js` lines 542–620 (`computeClassBounds` — the bug site)
5. `js/algorithms/proctor-distribution-v2.js` lines 3098–3210 (`phase2_75CoverageRepair` — the diagnostics that reveal the bug)
6. `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js` — counterexample harness using structured warnings
7. `tests/fixtures/45454.json` — production fixture
8. `scripts/inspect-fixture-state.js` — diagnostic tool

---

## Suggested Starting Message For New Session

> أريد فتح bugfix spec جديد لإصلاح السبب الجذري لـ `min=0` على fixture
> الإنتاج. السياق الكامل في `docs/agent-notes/proctor-v2-singleton-class-bounds.md`. الـ
> spec السابق `proctor-v2-phase2-75-multi-step-repair` نفّذ inner repair loop
> + diagnostics shape migration (تغييرات صحيحة هيكلياً) لكن لم يحلّ المشكلة
> الحقيقية: `computeClassBounds` ينتج `classLowerBound` مستحيلة (294–352) لـ
> singleton eligibility classes. افتح bugfix spec بالاسم
> `proctor-v2-singleton-class-bounds`.


---

## Update — 2026-05-17 (Kiro Cloud session, lost to context limit)

A separate Kiro Cloud session continued investigation on the `project6.2`
branch `spec/proctor-v2-multi-step-repair-and-singleton-bounds` and
established corrected numbers and a refined design recommendation before
hitting context limit. The session did not push any new files or specs;
its conclusions are recorded here so the next agent can resume directly.

### Corrected production-fixture numbers

The earlier `inspect-fixture-state.js` snapshot under-counted
`totalGuardSlots` because `phase1PrePass` writes
`_strictFairnessGuardSlots` directly onto schedule entries, overriding the
naive `rooms × proctorsPerRoom` calculation. Recomputed values for
`tests/fixtures/45454.json`:

| Variable | Earlier (wrong) | Actual |
|---|---|---|
| `totalGuardSlots` | 60 | 382 |
| `D_expected` | 1 | 13 |
| `globalLowerBound` | 0 | 2 |
| `globalUpperBound` | 1 | 3 |
| `feasibleCeiling` | 2 | 4 |
| `avgPeerSize` (Option D) | 141 | 141 |

The corrected numbers do NOT change the fact that singleton classes get
`classLowerBound = 294-352` (the bug is unchanged); they only affect the
choice of fix formula and the synthetic-input expectations.

### Option evaluation on production fixture

| Option | Formula | Result on 45454.json |
|---|---|---|
| C (global-fairness) | `LB = floor(totalGuardSlots + D_expected) / N` | LB=2, UB=3 |
| D (avgPeerSize=141) | `LB = floor(G_class + D_class) / avgPeerSize` | LB=2, UB=3 |

Both options agree exactly on the production fixture (LB=2, UB=3 — matches
the multi-member peer's bounds). The semantic differences appear only on
synthetic inputs.

### Synthetic A — 5 proctors, 1 multi-member size 4 + 1 singleton G=4

| Option | Singleton LB |
|---|---|
| C | `floor(20/5) = 4` |
| D | `floor(4/4) = 1` |

### Synthetic B — 3 proctors, all singletons

| Option | Outcome |
|---|---|
| C | `floor(G_singleton/3)` (varies per case) |
| D | Falls back to `N_global = 3` — same as C |

### Recommendation: Option C (global-fairness)

Kiro Cloud session's recommendation — preserved here verbatim:

1. **Mathematically simpler**: `globalLowerBound = floor((totalGuardSlots + D_expected) / N)` — one formula, no sub-condition counting multi-member classes.
2. **Semantically aligned** with the existing only-one-class branch
   (`computeClassBounds` lines 561-574). Singleton in multi-class mode
   becomes "as if merged into the global N" — clean and consistent.
3. **Determinism easier**: no extra scan to compute `avgPeerSize`.
4. **Monotonicity guard simpler**: `IF bTotal ≤ globalLowerBound THEN retain bTotal` — fixed criterion instead of `≤ avgPeerSize`.
5. **Same on production**: identical numerical result to Option D on the
   real 45454 fixture (LB=2, UB=3).
6. **Stronger degenerate-case behavior**: when `G_class = 0`, the
   monotonicity guard returns 0 even if `globalLowerBound > 0`.

**Trade-off**: Synthetic A gives `singleton_LB = 4` (higher than D's 1),
but 4 is not impossible — the singleton has G=4 and the system average is
4. This is fair, not buggy.

### Next-agent starting points

- Open the new bugfix spec named `proctor-v2-singleton-class-bounds`
  (Workflow: Requirements-first).
- Adopt Option C in `design.md` with rationale above.
- Use the corrected production-fixture numbers (`totalGuardSlots=382`,
  `globalLowerBound=2`, `feasibleCeiling=4`).
- Bug Condition: ∃ proctor with `classLowerBound > globalLowerBound`.
- Property P: ∀ proctor, `classLowerBound ≤ globalLowerBound + 1` (where
  `+1` accommodates the existing ceil/floor pair, matching the only-one-
  class branch of `computeClassBounds`).
- Preservation: every test that passes pre-fix continues to pass; the
  inner-loop and diagnostics-shape changes from
  `proctor-v2-phase2-75-multi-step-repair` are not touched.

The Kiro Cloud session's parting question was whether to update the
in-progress spec to migrate from Option D to Option C with corrected
numbers — that decision is now resolved: **adopt Option C as the design
choice from the start**.
