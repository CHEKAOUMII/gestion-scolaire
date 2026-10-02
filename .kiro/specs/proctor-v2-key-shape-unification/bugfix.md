# Bugfix Requirements Document

## Introduction

The proctor distribution algorithm v2 (`js/algorithms/proctor-distribution-v2.js`) carries two distinct, non-equivalent functions for computing a proctor's identity key — `getProctorKey(proc, idx)` and `getProctorExemptionKey(proc, idx)` — and applies them inconsistently across the algorithm's internal state and outputs. For proctors whose `cin` is empty but whose `som` is non-empty (the production case on `tests/fixtures/45454.json`, where 147 proctors all have empty `cin` and non-empty `som`), the two functions return different strings for the same proctor. As a result, the algorithm's output state ends up keyed under both shapes simultaneously: the same physical proctor is split into two separate identity buckets, and neither bucket alone reflects that proctor's true total assigned load.

On the production fixture, this manifests as **6 proctors silently carrying a load of 4 guard slots while the algorithm reports `max=3`**. Each of the 6 proctors appears in `R_mem.proctor_keys` under two different keys: a `__idx_N` key (3 occurrences) emitted by Phase 2 guard placement, plus a separate `som`-shaped key (1 occurrence) introduced by `phase2_5PopulateReserves` and then promoted into `proctor_keys` by `applyReserveSwap` in Phase 3. The dual-identity totals to 4 slots per affected proctor, but no single key in the result reflects this.

The full investigation context, devtools-confirmed evidence (3 confirming scripts run in the production renderer), root-cause trace through the 3 sites in `v2.js`, files most affected, and rationale for opening a new spec are recorded in:

- `/home/chekaoumi/Desktop/gestionScholaire2/.agent/proctor-v2-key-shape-bug.md`

This bug existed since the v1→v2 migration but was masked by the display-layer aggregation defect addressed (and now fixed) by spec `proctor-distribution-db-memory-mismatch` (closed 2026-05-16). With the display layer correctly aggregating by `proctor_keys`, the dual-identity has become directly observable and the published `max=3` claim is now demonstrably false on the production fixture.

### Relation to closed specs

| Spec | Status | Relation to this bug |
|---|---|---|
| `proctor-v2-fairness-undercovered-fix` | Closed 2026-05-16 | Established the fairness invariant that the algorithm SHALL produce `max=3` on `tests/fixtures/45454.json`. This bug invalidates that claim for the production fixture: 6 proctors actually carry max=4. The fix in this spec SHALL restore the truth of the closed spec's claim. |
| `proctor-distribution-db-memory-mismatch` | Closed 2026-05-16 | Fixed the display-layer aggregator so that `buildSummaryRows` and related helpers count by `proctor_keys` rather than by name. The display fix is correct. This new spec sits one layer below: the keys themselves carried by `proctor_keys` are inconsistent in shape, and that is a pure-algorithm defect requiring `v2.js` modifications. |
| `proctor-v2-strict-fairness-coverage` | In progress | Operates on the same algorithm but on a different invariant axis (strict fairness coverage). Scope-disjoint from this spec at the requirement level; integration must be verified during design. |

### Scope discipline (v2.js modifications are in-scope)

The closed spec `proctor-distribution-db-memory-mismatch` placed `v2.js` out-of-scope for modification (its Requirement 2.9) on the basis that the corruption observed there was a display-layer artifact. That scope rule applied to that spec only. The defect described in this spec is structurally inside the algorithm (mixed key shape across `loadState` writes, `reserve_keys` writes, and `proctor_keys` swap-promotion), so `v2.js` modifications **ARE in-scope** for this spec.

The user's constraint — "يجب ان يكون الحل منهجي وهيكلي" (the solution must be methodical and structural, not a localized patch) — applies fully: the design phase SHALL select one canonical key shape and unify every read/write site consistently, rather than applying a single-line replacement at one of the three known leak points.

### Bug Condition C(X)

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X = (proctorsList, examDutyTeachersData, examExemptionsData, ...)
          — the full input object consumed by ProctorDistributionV2.run
  OUTPUT: boolean

  // 1. Run the algorithm in-memory (no IPC, no DB)
  R_mem ← ProctorDistributionV2.run(X).result   // array of result rows

  // 2. Build the two distinct identity functions used by the algorithm
  //    F1: getProctorKey            → proc.cin || ('__idx_' + idx)
  //    F2: getProctorExemptionKey   → proc.cin || proc.som || ('idx_' + idx)
  // For any proctor with proc.cin === '' AND proc.som !== '', F1 ≠ F2.

  // 3. Detect whether at least one proctor i has both keys present in the
  //    output, splitting that proctor's true load across two buckets.
  FOR EACH proc, idx IN X.proctorsList DO
    K1 ← getProctorKey(proc, idx)              // e.g. '__idx_43'
    K2 ← getProctorExemptionKey(proc, idx)     // e.g. '1909564' (som)

    IF K1 = K2 THEN CONTINUE                    // not a candidate

    count_K1 ← occurrencesIn(R_mem.proctor_keys, K1)
              + occurrencesIn(R_mem.reserve_keys, K1)
    count_K2 ← occurrencesIn(R_mem.proctor_keys, K2)
              + occurrencesIn(R_mem.reserve_keys, K2)

    // Both keys appear independently for the same physical proctor:
    // dual-identity is realised in the algorithm output.
    IF count_K1 > 0 AND count_K2 > 0 THEN
      RETURN true
    END IF
  END FOR

  RETURN false
END FUNCTION
```

Equivalent observable form of C(X): there exists a proctor index `i` such that two distinct strings — `K1 = getProctorKey(proc_i, i)` and `K2 = getProctorExemptionKey(proc_i, i)` — both appear as keys in `R_mem.proctor_keys` (or `R_mem.reserve_keys`) for the same physical proctor, and the proctor's true assigned slot count is therefore `count(K1) + count(K2)` rather than the count under any single key.

Concrete witness on `tests/fixtures/45454.json`:

| Proctor (teacher_name) | idx | K1 = `__idx_idx` count | K2 = `som` count | True total | Algorithm-reported max |
|---|---|---|---|---|---|
| ايت حدو فؤاد | 43 | 3 | 1 (som=1909564) | **4** | 3 |
| السعدوي عمر | 78 | 3 | 1 (som=2367149) | **4** | 3 |
| تيكوردي إشراق | 66 | 3 | 1 (som=1910812) | **4** | 3 |
| ايمان تنون | 92 | 3 | 1 (som=2158781) | **4** | 3 |
| المكاني محمد | 50 | 3 | 1 (som=1545317) | **4** | 3 |
| وردية بوعادي | 47 | 3 | 1 (som=1177902) | **4** | 3 |

### Property P (Fix Checking)

```pascal
// Property: Fix Checking — every proctor has exactly one canonical identity in the output
FOR ALL X WHERE isBugCondition_pre_fix(X) DO
  R_mem' ← V2'.run(X).result    // V2' is the fixed algorithm

  // (P-1) Single-identity: for every proctor index i, at most ONE of
  //       {getProctorKey(proc_i,i), getProctorExemptionKey(proc_i,i)}
  //       appears as a key anywhere in R_mem'.proctor_keys ∪ R_mem'.reserve_keys.
  FOR EACH proc, idx IN X.proctorsList DO
    K1 ← getProctorKey(proc, idx)
    K2 ← getProctorExemptionKey(proc, idx)
    n1 ← occurrencesIn(R_mem'.proctor_keys, K1)
        + occurrencesIn(R_mem'.reserve_keys, K1)
    n2 ← occurrencesIn(R_mem'.proctor_keys, K2)
        + occurrencesIn(R_mem'.reserve_keys, K2)
    IF K1 ≠ K2 THEN
      ASSERT (n1 = 0) OR (n2 = 0)   // never both present
    END IF
  END FOR

  // (P-2) Truthful max: the histogram-by-canonical-key reports the true
  //       per-proctor load, with no hidden dual-identity inflation.
  hist  ← histogramByCanonicalKey(R_mem')
  ASSERT max(hist) = trueMaxLoad(X, R_mem')
        // where trueMaxLoad sums occurrences across BOTH possible key shapes
        // for each proctor — the result must agree with the single canonical
        // bucket because dual-identity has been eliminated.

  // (P-3) Canonical-shape closure: every key written to proctor_keys,
  //       reserve_keys, and every loadState bucket uses the SAME canonical
  //       shape for the same proctor index — chosen by the design phase.
  FOR EACH key IN keysOf(R_mem'.proctor_keys ∪ R_mem'.reserve_keys ∪ R_mem'.loadState) DO
    ASSERT key = canonicalKeyShape(proctorOf(key), indexOf(key))
  END FOR

  // (P-4) On the production fixture specifically, the closed-spec claim
  //       max=3 is restored to truth.
  IF X = load('tests/fixtures/45454.json') THEN
    ASSERT max(histogramByCanonicalKey(R_mem')) = 3
    ASSERT noProctorHasHiddenLoad(X, R_mem')
  END IF
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking — non-buggy paths are unchanged pre/post fix
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT V2(X).result  ≡  V2'(X).result   // observationally equivalent
        // modulo any intentional canonicalization recorded in design.md
END FOR

// Test-suite preservation: every currently-passing test continues to pass.
ASSERT every test in
   { tests/proctor-v2-*.test.js,
     tests/inv-h5-*.test.js,
     tests/preservation-config-roundtrip.pbt.test.js }
that PASSES against V2 also PASSES against V2'.

// Script-level preservation: the Node-only verify scripts produce
// identical reports pre/post fix.
ASSERT scripts/verify-fixture.js     produces P1/P2/P3 PASS pre and post fix.
ASSERT scripts/verify-real-centre.js produces P1/P2/P3 PASS pre and post fix.
```

Where `V2` is the algorithm before the fix and `V2'` is the algorithm after the fix.

## Bug Analysis

### Current Behavior (Defect)

What currently happens when the bug is triggered.

1.1 WHEN the input `X` contains at least one proctor `proc_i` with `proc_i.cin === ""` AND `proc_i.som !== ""` AND `examDutyTeachersData` contains at least one entry keyed by `proc_i.som` THEN `ProctorDistributionV2.run(X)` returns a result `R_mem` in which the same physical proctor `proc_i` is represented under TWO distinct strings: `K1 = getProctorKey(proc_i, i) = "__idx_i"` and `K2 = getProctorExemptionKey(proc_i, i) = proc_i.som`, and both keys appear independently in `R_mem.proctor_keys`.

1.2 WHEN the algorithm executes the duty pre-pass at approximately line 1762 of `js/algorithms/proctor-distribution-v2.js` THEN it writes duty load entries into `loadState` keyed by `getProctorExemptionKey(proc, idx)` (the `cin || som || idx_N` shape).

1.3 WHEN Phase 2 guard placement assigns a proctor to a guard slot THEN it writes the assigned proctor's key into `row.proctor_keys` and into `loadState` using `getProctorKey(proc, idx)` (the `cin || __idx_N` shape), which for proctors with empty `cin` but non-empty `som` differs from the key written by the duty pre-pass for the same proctor.

1.4 WHEN `phase2_5PopulateReserves` runs at approximately line 2643 of `js/algorithms/proctor-distribution-v2.js` THEN it derives the candidate's `key` via `getProctorExemptionKey(proc, pi)` and pushes that som-shaped string into the shared `reserve_keys` array, even though `proctor_keys` for the same proctor in the same row uses the `__idx_N` shape.

1.5 WHEN Phase 3 swap logic in `applyReserveSwap` (approximately line 3636 of `js/algorithms/proctor-distribution-v2.js`) promotes a reserve into a guard slot THEN it copies the som-shaped `reserveKey` directly into `guardRow.proctor_keys[gs]`, leaking the exemption-shaped key into the proctor-keys output array.

1.6 WHEN the resulting `R_mem` is histogrammed by raw key (counting each distinct string in `proctor_keys`) on `tests/fixtures/45454.json` THEN 6 proctors appear in TWO buckets each: one bucket of 3 occurrences under `__idx_N`, plus a second bucket of 1 occurrence under the proctor's `som` value. The proctor's true total slot count is 4, but no single key in `R_mem` reflects this total.

1.7 WHEN `scripts/verify-fixture.js` (and `scripts/verify-real-centre.js`) computes `maxLoad(R_mem)` THEN it reports `max=3` because each individual key bucket has at most 3 entries; the dual-identity inflation is invisible to the per-key max reduction.

1.8 WHEN the user's devtools script "Detect dual-identity proctors" runs in the production renderer against the live DB row for `examAutoDistributionData` THEN it reports 6 ghost CIN keys (`1909564, 2367149, 1910812, 2158781, 1545317, 1177902`) — one per affected proctor — that are present in `R_mem.proctor_keys` but absent from the valid-key set built from `getProctorKey(p, i)` over `proctorsList`.

1.9 WHEN the closed spec `proctor-v2-fairness-undercovered-fix` claimed `max=3` on the production fixture as a fairness invariant THEN that claim is presently false on the production fixture: 6 of 147 proctors actually carry a true load of 4 slots, hidden by dual-identity in the algorithm's output state.

1.10 WHEN the bug is triggered THEN it occurs entirely inside `js/algorithms/proctor-distribution-v2.js`. The display layer (`exams-rooms.html` `buildSummaryRows`, post-H5 fix), the IPC layer (`main/ipc/exam-config-data.js`), and the persistence layer (`exam_config_data` table) all faithfully transmit the corrupted state without introducing additional corruption.

### Expected Behavior (Correct)

What should happen instead.

2.1 WHEN the input `X` contains proctors with empty `cin` and non-empty `som` THEN `ProctorDistributionV2'.run(X)` SHALL produce a result `R_mem'` in which every physical proctor is represented under exactly **one canonical key shape**, and no proctor SHALL appear under two distinct keys in `R_mem'.proctor_keys`, `R_mem'.reserve_keys`, or `R_mem'.loadState`.

2.2 WHEN any internal data structure of the algorithm (the duty pre-pass `loadState` writes, Phase 2 guard placement `loadState` and `proctor_keys` writes, Phase 2.5 reserve population `reserve_keys` writes, Phase 3 swap `proctor_keys` writes, exemption filtering reads, duty filtering reads, AC-3 propagation, and any fairness-report aggregation) reads or writes a proctor identity THEN it SHALL use **the same canonical key shape** for the same `(proctor, index)` pair.

2.3 WHEN the design phase of this spec selects the canonical key shape THEN it SHALL choose exactly one of the existing identity functions (or define a single new unified function) and SHALL document the choice in `design.md` along with the migration path for every read/write site that previously used the alternate shape. The requirements phase intentionally does NOT prescribe which shape (Option A `__idx_N` from `getProctorKey`, Option B `som`-aware from `getProctorExemptionKey`, or Option C a new unified function); that is a design decision driven by trade-offs documented in `.agent/proctor-v2-key-shape-bug.md`.

2.4 WHEN the canonical key shape is applied at every site listed in clause 2.2 THEN there SHALL exist exactly one canonical-shape function — call it `canonicalProctorKey(proc, idx)` — that is the **single source of truth** for proctor identity inside the algorithm, and the alternate identity function (whichever is not chosen as canonical) SHALL either be removed, or its remaining call sites SHALL be reduced to pure adapters whose responsibility is documented as "translate external/legacy data into the canonical shape at the boundary."

2.5 WHEN the algorithm runs against `tests/fixtures/45454.json` after the fix THEN `R_mem'.proctor_keys` SHALL contain only keys produced by `canonicalProctorKey(proc, idx)` for `proc ∈ proctorsList`, with zero ghost CIN keys (the 6 currently-observed `som`-shaped strings `1909564, 2367149, 1910812, 2158781, 1545317, 1177902` SHALL be absent from the post-fix output unless those values are also the canonical key for their respective proctors).

2.6 WHEN the histogram of `R_mem'` is computed by canonical key on the production fixture THEN it SHALL satisfy `max ≤ 3` for `tests/fixtures/45454.json`, and the previously-observed 6 proctors with hidden dual-identity load SHALL each carry a single canonical-key count equal to their TRUE total load (which, after the fix, must be `≤ 3` to honor the closed spec's fairness invariant).

2.7 WHEN the bug condition fires for any input `X` (any proctor configuration with `cin === "" AND som !== ""` plus duty data keyed by `som`) THEN the post-fix algorithm SHALL produce a result for which Property P-1 (single-identity), P-2 (truthful max), and P-3 (canonical-shape closure) hold for every proctor in `X.proctorsList`.

2.8 WHEN the investigation into the root cause is performed THEN it SHALL proceed **methodically and structurally**: the design phase SHALL identify every read/write site of either identity function inside `js/algorithms/proctor-distribution-v2.js`, classify each site as canonical-source / canonical-consumer / boundary-adapter, and specify the change at each site. The fix SHALL NOT be a single-line replacement at one of the three currently-known leak sites (lines ≈1762, ≈2643, ≈3636) without auditing every other site that touches proctor identity.

2.9 WHEN the design phase enumerates change sites THEN it SHALL include at minimum: (a) the duty pre-pass `addDutyLoad` call site (≈line 1762) where `loadState` is first populated; (b) `phase2_5PopulateReserves` (≈line 2643) where `reserve_keys` is written; (c) `applyReserveSwap` (≈line 3636) where `reserve_keys` is copied into `proctor_keys`; (d) all `loadState[exKey]` write sites; (e) all `loadState[exKey]` read sites including exemption filtering (`isProctorExemptForEntry`, ≈line 728), duty filtering (`isDutyTeacherForEntry`, ≈line 801), and the swap-eligibility lookups in Phase 3.

2.10 WHEN `examDutyTeachersData` is consumed during the duty pre-pass THEN the algorithm SHALL convert each external duty key (which is supplied in `cin || som` shape by the data layer) into the canonical shape via a documented boundary adapter at the point of ingestion, so that no `som`-shaped key ever flows past the boundary into the algorithm's internal state.

2.11 WHEN the fix is applied THEN it SHALL be additive and structural — no DB schema changes, no IPC contract changes, no display-layer changes — confined to `js/algorithms/proctor-distribution-v2.js` and to the test files that assert the new invariants.

2.12 WHEN the design phase is complete THEN it SHALL specify the new test files that lock in the post-fix invariants. At minimum these SHALL include: (i) a unity test asserting that for every proctor, only ONE of the two pre-fix key shapes appears in `R_mem.proctor_keys ∪ R_mem.reserve_keys`; (ii) a reserve-key consistency test asserting every key in `reserve_keys` is canonical-shape; (iii) a regression test on `tests/fixtures/45454.json` asserting the absence of the 6 specific ghost CIN keys.

### Unchanged Behavior (Regression Prevention)

Existing behavior that must be preserved.

3.1 WHEN any test in `tests/proctor-v2-*.test.js` is executed against the post-fix algorithm THEN it SHALL CONTINUE TO pass with no new failures and no new warnings, including (but not limited to): `proctor-v2-property-4-save-stability.test.js`, `proctor-v2-property-p5-eligibility.test.js`, `proctor-v2-property-p4-percent.test.js`, `proctor-v2-strict-bug-c2-uncovered.test.js`, `proctor-v2-bug-c1-fairness.test.js`, `proctor-v2-bug-c2-duty.test.js`, `proctor-v2-strict-bug-c1-fairness.test.js`, `proctor-v2-session-notes-integration.test.js`, `proctor-v2-slot-metric-add-guard-load.test.js`, `proctor-v2-slot-metric-reserve-sort.test.js`.

3.2 WHEN any test in `tests/inv-h5-*.test.js` is executed against the post-fix algorithm THEN it SHALL CONTINUE TO pass, including `tests/inv-h5-cross-page-consistency.test.js` and any associated checklist-driven assertions.

3.3 WHEN `tests/preservation-config-roundtrip.pbt.test.js` is executed against the post-fix code THEN it SHALL CONTINUE TO pass for every config key (including `examAutoDistributionData` and the 12 other keys), with the round-trip property preserved.

3.4 WHEN `scripts/verify-fixture.js` is executed against the post-fix algorithm on `tests/fixtures/45454.json` THEN it SHALL CONTINUE TO report P1/P2/P3 PASS, and the algorithm output SHALL CONTINUE TO satisfy the closed spec `proctor-v2-fairness-undercovered-fix`'s fairness invariant `max ≤ 3`. (The fix MAKES this invariant truthful where it was previously false on the production fixture due to dual-identity hiding load=4 proctors.)

3.5 WHEN `scripts/verify-real-centre.js` is executed against the post-fix algorithm THEN it SHALL CONTINUE TO report P1/P2/P3 PASS on the real-centre fixture.

3.6 WHEN the input `X` contains only proctors with non-empty `cin` (so that `getProctorKey(proc, idx) === getProctorExemptionKey(proc, idx)` for every proctor) THEN the post-fix algorithm SHALL produce a result observationally identical to the pre-fix algorithm for that input, because the bug condition does not fire and the canonical shape resolves to the same string under either identity function.

3.7 WHEN the input `X` contains only proctors with empty `cin` and empty `som` (so that `getProctorKey` returns `__idx_N` and `getProctorExemptionKey` returns `idx_N` — note the missing leading underscores) THEN the post-fix algorithm SHALL produce a result that is consistent under the chosen canonical shape; the design phase SHALL document how `idx_N`-vs-`__idx_N` divergence is resolved without breaking any existing test.

3.8 WHEN the closed spec `proctor-v2-fairness-undercovered-fix` (closed 2026-05-16) is re-validated against the post-fix algorithm THEN every guarantee it published — including the fairness invariant `max ≤ 3` on `tests/fixtures/45454.json`, the P1/P2/P3 properties, and the 46 in-scope test outcomes — SHALL CONTINUE TO hold. This bugfix's effect on that spec is to RESTORE the truth of its claims on the production fixture, not to weaken or invalidate them.

3.9 WHEN the closed spec `proctor-distribution-db-memory-mismatch` (closed 2026-05-16) is re-validated against the post-fix algorithm THEN its display-layer fix in `exams-rooms.html` `buildSummaryRows`, its precondition `await` on the auto-save in `exams-proctors.html`, its `js/data/proctor-key-resolver.js` helper, and its histogram-round-trip property SHALL CONTINUE TO hold. The display-layer aggregation by `proctor_keys` continues to be correct; this spec only changes the SHAPE of the keys carried in `proctor_keys`, not the aggregation strategy that consumes them.

3.10 WHEN `npm run lint` is executed after the fix THEN it SHALL CONTINUE TO produce zero new errors and zero new warnings relative to the closing state of `proctor-distribution-db-memory-mismatch`.

3.11 WHEN `npm test` is executed after the fix THEN every previously-passing test SHALL CONTINUE TO pass, and any tests added by this spec to lock in the canonical-shape invariants SHALL also pass deterministically (no flakes under the existing seed/randomness contract).

3.12 WHEN `main/db/migrations.js` is inspected after the fix THEN the `exam_config_data` table schema SHALL CONTINUE TO be unchanged (no new migration introduced by this spec).

3.13 WHEN `main/ipc/exam-config-data.js` is inspected after the fix THEN its IPC contract for `examConfigData:save` and `examConfigData:get` SHALL CONTINUE TO be unchanged (no parameter, return-shape, or auth-policy changes introduced by this spec).

3.14 WHEN previously-saved DB rows for `examAutoDistributionData` (rows persisted under the buggy pre-fix algorithm and therefore containing `som`-shaped ghost keys in `proctor_keys` / `reserve_keys`) are loaded by `exams-rooms.html` after the fix THEN the load path SHALL CONTINUE TO render those rows without error. The display-layer resolver from spec `proctor-distribution-db-memory-mismatch` MAY still resolve unknown keys to fallback names; this spec does NOT mandate a silent rewrite of legacy DB rows. (Any active normalization of legacy rows MUST be specified explicitly in `design.md` if the design phase chooses to introduce one, and SHALL be additive.)

3.15 WHEN any input `X` for which `NOT isBugCondition(X)` (no proctor has the dual-identity-triggering combination of empty `cin`, non-empty `som`, and a duty entry keyed by `som`) is run through the post-fix algorithm THEN `V2'(X).result` SHALL equal `V2(X).result` modulo only the canonical key string substitutions documented in `design.md`. In particular, the proctor-keys multiset, the reserves multiset, the assignments graph, the swap moves, the diagnostics object, and the per-row metadata SHALL be observationally equivalent.
