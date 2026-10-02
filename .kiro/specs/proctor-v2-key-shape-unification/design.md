# Proctor V2 Key-Shape Unification — Bugfix Design

## Overview

The proctor distribution algorithm v2 (`js/algorithms/proctor-distribution-v2.js`) carries
two distinct identity functions for the same physical proctor — `getProctorKey(proc, idx)`
which returns `cin || '__idx_' + idx` (the **algo shape**) and
`getProctorExemptionKey(proc, idx)` which returns `cin || som || 'idx_' + idx` (the
**exemption shape**) — and applies them inconsistently across the algorithm's internal
state (`loadState`) and outputs (`proctor_keys`, `reserve_keys`). For proctors with
empty `cin` and non-empty `som` (the production case on `tests/fixtures/45454.json`),
these two functions return different strings, so the same physical proctor ends up
keyed under two distinct strings simultaneously and neither bucket alone reflects that
proctor's true assigned load.

The fix is **methodical and structural**, per the user's constraint
("يجب ان يكون الحل منهجي وهيكلي"): rather than patching the three currently-known
leak sites in isolation, the design

1. selects **one canonical key shape** as the single source of truth for proctor
   identity inside the algorithm,
2. enumerates **every** read/write site of either identity function and classifies it
   as canonical-source / canonical-consumer / boundary-adapter,
3. introduces a **boundary adapter** (`buildKeyAdapter`) that translates external keys
   (read from `examDutyTeachersData`, `examExemptionsData`, `meAssignments`,
   `examMorningEveningData`) into canonical shape at the point of ingestion, so that
   no exemption-shape key ever flows past the boundary into internal state, and
4. preserves all currently-passing tests, the IPC contract, and the DB schema.

This is a pure-algorithm change confined to `js/algorithms/proctor-distribution-v2.js`
plus three new test files that lock in the post-fix invariants. No DB schema migration,
no IPC contract change, no display-layer change.

## Glossary

- **C (Bug Condition)**: There exists a proctor index `i` such that two distinct strings
  — `K1 = getProctorKey(proc_i, i)` and `K2 = getProctorExemptionKey(proc_i, i)` —
  both appear as keys in `R_mem.proctor_keys ∪ R_mem.reserve_keys`, splitting the
  proctor's true load across two buckets.
- **P (Property)**: After the fix, every physical proctor is represented under exactly
  one canonical key shape across `loadState`, `proctor_keys`, and `reserve_keys`, and
  the histogram-by-canonical-key reflects each proctor's true total slot count.
- **Preservation**: For inputs where `NOT C(X)` (no dual-identity-triggering proctor),
  `V2'(X).result` equals `V2(X).result` modulo only canonical key string substitutions
  documented here.
- **Algo shape**: The string produced by `getProctorKey(proc, idx)`, i.e.
  `cin || '__idx_' + idx`. Never empty, never collides, deterministic by index.
- **Exemption shape**: The string produced by `getProctorExemptionKey(proc, idx)`, i.e.
  `cin || som || 'idx_' + idx`. Used as the **external** key shape by the data layer
  in `examDutyTeachersData`, `examExemptionsData`, and (legacy) `meAssignments` rows.
- **Canonical shape**: The shape selected by this design as the single internal
  identity. **Chosen: algo shape (`cin || '__idx_' + idx`)** — see §"Phase C: Canonical
  Shape Selection".
- **Boundary**: The edge where external data (`examDutyTeachersData`, `examExemptionsData`,
  `meAssignments`, `examMorningEveningData`) is consumed by the algorithm. Boundary
  reads are allowed to use exemption shape because external data is exemption-shaped;
  the adapter translates them to canonical at the point of consumption.
- **Leak site**: A code site that lets an exemption-shape key escape past the boundary
  into internal state (`loadState`, `proctor_keys`, `reserve_keys`).
- **Key adapter (`buildKeyAdapter`)**: A function constructed once per `run` invocation
  that returns a string→string map from any of `{cin, som, __idx_N, idx_N}` to the
  canonical key for that proctor. The adapter is the **only** code path through which
  external keys cross into internal state.
- **proctorMeta**: The pre-built array (≈line 1722) that already carries `meta.key =
  getProctorKey(proc, pi)`. This is the existing single source of truth for canonical
  identity; the fix extends rather than replaces it.
- **F (original)**: `js/algorithms/proctor-distribution-v2.js` before the fix.
- **F' (fixed)**: `js/algorithms/proctor-distribution-v2.js` after the fix.

## Bug Details

### Bug Condition

The bug manifests whenever the input contains a proctor `proc_i` with `proc_i.cin === ""`
AND `proc_i.som !== ""` AND any external entry (in `examDutyTeachersData`,
`examExemptionsData`, or `meAssignments`) is keyed by `proc_i.som`. The duty pre-pass
writes a duty-load entry into `loadState` under the **exemption-shape** key
(`proc_i.som`), then `phase2_5PopulateReserves` derives candidate reserve keys via
`getProctorExemptionKey` and pushes the exemption-shape string into the shared
`reserve_keys` array. `applyReserveSwap` later copies that exemption-shape string into
`guardRow.proctor_keys[gs]`. The same physical proctor is therefore present in
`R_mem.proctor_keys` under two strings — the algo-shape `__idx_N` (3 occurrences,
emitted by Phase 2 guard placement) and the exemption-shape `som` (1 occurrence,
promoted by the swap) — totalling 4 slots while the histogram-by-key reports `max=3`.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT:  input = (proctorsList, examDutyTeachersData, examExemptionsData, ...)
  OUTPUT: boolean

  R_mem ← ProctorDistributionV2.run(input).result

  FOR EACH proc, idx IN input.proctorsList DO
    K1 ← getProctorKey(proc, idx)            // 'cin' or '__idx_' + idx
    K2 ← getProctorExemptionKey(proc, idx)   // 'cin' or 'som' or 'idx_' + idx
    IF K1 = K2 THEN CONTINUE                  // not a candidate

    n1 ← occurrencesIn(R_mem.proctor_keys, K1) + occurrencesIn(R_mem.reserve_keys, K1)
    n2 ← occurrencesIn(R_mem.proctor_keys, K2) + occurrencesIn(R_mem.reserve_keys, K2)

    IF n1 > 0 AND n2 > 0 THEN RETURN true     // dual-identity realised
  END FOR

  RETURN false
END FUNCTION
```

### Examples

Concrete witnesses on `tests/fixtures/45454.json` (147 proctors, all `cin === ""`,
all `som !== ""`):

| Proctor | idx | K1 (`__idx_N`) count | K2 (`som`) count | True total | Reported max |
|---|---|---|---|---|---|
| ايت حدو فؤاد | 43 | 3 | 1 (`1909564`) | **4** | 3 |
| السعدوي عمر | 78 | 3 | 1 (`2367149`) | **4** | 3 |
| تيكوردي إشراق | 66 | 3 | 1 (`1910812`) | **4** | 3 |
| ايمان تنون | 92 | 3 | 1 (`2158781`) | **4** | 3 |
| المكاني محمد | 50 | 3 | 1 (`1545317`) | **4** | 3 |
| وردية بوعادي | 47 | 3 | 1 (`1177902`) | **4** | 3 |

The 6 ghost CIN keys `1909564, 2367149, 1910812, 2158781, 1545317, 1177902` are present
in `R_mem.proctor_keys` but absent from the valid-canonical-key set
`{ getProctorKey(p, i) | (p, i) ∈ proctorsList }`.

Edge case (synthetic-only): a proctor with `cin === "" AND som === ""` produces
`getProctorKey → "__idx_N"` and `getProctorExemptionKey → "idx_N"` (note the missing
leading underscores). The bug condition still applies and the post-fix algorithm
must reduce both shapes to a single canonical string per proctor.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- `examDutyTeachersData` and `examExemptionsData` and `meAssignments` and
  `examMorningEveningData` — the **external** input objects — are NEVER mutated by
  the fix. They remain exemption-shape because the data layer that produces them
  (`exams-proctors.html` editor, DB rows) is exemption-shape. The algorithm only
  reads them and translates at the boundary.
- The IPC contract for `examConfigData:save` and `examConfigData:get` in
  `main/ipc/exam-config-data.js` is unchanged. No new channel, no parameter change,
  no return-shape change, no auth-policy change.
- The DB schema for `exam_config_data` in `main/db/migrations.js` is unchanged. No
  new migration is introduced.
- The display-layer aggregation in `exams-rooms.html buildSummaryRows` continues to
  count by `proctor_keys`. Its post-H5 fix is correct; this spec only changes the
  shape of strings carried in `proctor_keys`, not how they are consumed by display.
- The reserve shared-reference invariant from
  `proctor-v2-slot-metric-reserves-affinity` is preserved: every row in a session
  shares the SAME `reserves` and `reserve_keys` array references.
- The fairness invariants from `proctor-v2-fairness-undercovered-fix` (`max ≤ 3` on
  the production fixture) are preserved and **made truthful** for the first time on
  that fixture.
- All currently-passing tests in `tests/proctor-v2-*.test.js`, `tests/inv-h5-*.test.js`,
  and `tests/preservation-config-roundtrip.pbt.test.js` continue to pass without flake.
- Legacy DB rows (persisted under the buggy F containing exemption-shape ghost keys
  in `proctor_keys`) are NOT silently rewritten by this spec. The display-layer
  resolver from `proctor-distribution-db-memory-mismatch` may still resolve unknown
  keys to fallback names; the fix does not regress that path.

**Scope:**

All inputs that do NOT trigger the bug condition (`NOT C(X)`) — including any input
where every proctor has a non-empty `cin`, or any input where no external entry is
keyed by `som` — are completely unaffected. For such inputs `V2'(X).result` is
observationally equivalent to `V2(X).result` modulo only the canonical key string
substitutions documented here (which by construction are no-ops on those inputs).

The actual expected correct behavior under the bug condition is defined formally in
§"Correctness Properties" (Property 1).

## Hypothesized Root Cause

Based on the bug description and the existing v2.js code structure, the root cause
is a **structural omission**: the algorithm carries two key functions that produce
different strings for proctors with `cin === "" AND som !== ""`, and never fully
unifies them at the boundary between external data and internal state.

1. **Legacy v1 byte-equality requirement**: The two functions exist because v2 had to
   match v1's byte-level outputs for the `meAssignments` and `exemptionsData` round-trip
   compatibility (see comments at lines 643–665). v1 itself carried both functions.
   Removing either function outright would break round-trip equality with v1 saves.
   Therefore the canonical shape must be **chosen** rather than reduced.

2. **proctorMeta is the existing single source of truth — but it leaks**:
   `proctorMeta` (built at ≈line 1722) already canonicalizes every proctor under
   `getProctorKey`. Phase 2 guard placement uses `assignedProctor.key` from this array
   and writes algo-shape into `loadState` and `proctor_keys`. So far, internal state
   is consistent.

3. **The duty pre-pass leaks at the boundary** (≈line 1762): `dutyProctorKeys` is
   `Object.keys(dutyEntry)`, where `dutyEntry` was supplied externally as
   `examDutyTeachersData[scope]` — keyed by exemption shape. The pre-pass writes
   `addDutyLoad(loadState, dutyProctorKeys[dpi], dutyHdKey, '')` directly, so
   `loadState` ends up with exemption-shape keys for any proctor whose `som` is in
   the duty data. From this moment, `loadState` is mixed-shape.

4. **`phase2_5PopulateReserves` propagates the leak** (≈line 2643): it derives
   `key = getProctorExemptionKey(proc, pi)` for every candidate, looks up
   `loadStateForReserves[key]` (which works for proctors that were duty-loaded by the
   pre-pass, but reads the WRONG bucket for proctors whose duty load was placed under
   algo shape via Phase 2's `addGuardLoad`), pushes `key` into `sharedReserveKeys`,
   and writes `loadStateForReserves[key]` via `addReserveLoad`. This creates a second
   bucket per affected proctor in `loadState`.

5. **`applyReserveSwap` promotes the leak into output** (≈line 3636): the
   `swap_roles` move copies `reserveRow.reserve_keys[rs]` (exemption shape) into
   `guardRow.proctor_keys[gs]` (which until then held only algo shape), so the
   exemption-shape string surfaces in the output array seen by the display layer
   and persisted to DB.

6. **Read-only consumers of `loadState` see different buckets depending on which key
   they query**: `collectUncovered` (≈line 2808), `computeActualDutyPairs` (≈line 3070),
   `isOnDutyDuringHalfday` callers (≈line 488, 506, 2868), and `costFunction`'s
   `classBoundsByProctorKey` lookup (≈line 1509) all use **algo shape** to query
   `loadState`. They miss the duty load that the pre-pass placed under exemption shape.
   **This is itself a silent bug**: per-class fairness bounds and uncovered-detection
   ignore duty load for som-only proctors. The fix corrects this side-effect for free.

The structural fix: every key crossing into `loadState`, `proctor_keys`, or
`reserve_keys` MUST come from `proctorMeta` or be translated via a single boundary
adapter (`buildKeyAdapter`). External boundary reads against `examDutyTeachersData`
and `examExemptionsData` continue to use exemption shape (because that is how the
data layer keys those objects); the adapter is invoked at the moment the external
key would otherwise enter internal state.

## Investigation Plan — Phased Decision Tree

### Phase A: Catalog every key read/write site in v2.js

A grep over `getProctorKey | getProctorExemptionKey | loadState | proctorMeta |
proctor_keys | reserve_keys` in `js/algorithms/proctor-distribution-v2.js` surfaces
the sites listed in the §"Edit Sites" table below. Each site is classified by:

- **kind**: producer (creates a key string), consumer (reads a key string), reader
  of external data (boundary), or writer to internal state.
- **source shape**: where the key string came from (proctorMeta, getProctorKey,
  getProctorExemptionKey, externally-supplied via `Object.keys`).
- **target shape**: where the key string is being written to (loadState bucket,
  `proctor_keys[]`, `reserve_keys[]`, or used purely for an external-data lookup
  and then discarded).

### Phase B: Classify each site by source

Five distinct external data sources flow keys into the algorithm:

| Source | Shape | Read at line(s) | Internal target |
|---|---|---|---|
| `proctorsList[i]` (positional iteration) | algo (via `getProctorKey`) | 499, 895, 1722, 2808, 3070, 3949 | proctorMeta, loadState, proctor_keys, fairness reports |
| `examDutyTeachersData` | exemption (`cin || som`) | 1762 (via `Object.keys(dutyEntry)`) | loadState (via `addDutyLoad`) |
| `examExemptionsData` | exemption (`cin || som`) | 728 (lookup), 3949 (validate) | NOT written to loadState directly; consumed via `isProctorExemptForEntry` |
| `meAssignments` | algo (legacy v1 contract used `getProctorKey`) | 1740, 2308, 2317, 3911, 3949, 1523 | `meAssignmentsMap` lookup map |
| `examMorningEveningData` | (consumed only via `meAssignments` derivation upstream) | n/a | n/a |

### Phase C: Canonical Shape Selection

| Option | Pros | Cons | Decision |
|---|---|---|---|
| **A. Algo shape (`getProctorKey` / `cin \|\| __idx_N`)** | Already used by `proctorMeta`, `proctor_keys`, `meAssignments`, `classBoundsByProctorKey`. Never empty. Deterministic. The vast majority of internal sites already use it. Smallest net code change. | Requires the boundary adapter to translate exemption-shape external entries into algo shape on ingestion. | **CHOSEN** |
| B. Exemption shape (`getProctorExemptionKey` / `cin \|\| som \|\| idx_N`) | Matches `examDutyTeachersData` and `examExemptionsData` external shape — fewer adapter translations. | Requires changing `proctorMeta`, `proctor_keys`, `meAssignments`, `classBoundsByProctorKey`, and every existing internal site. Massive blast radius. Breaks existing tests' byte-equality with v1 saves. Not deterministic when `som === ""` (collides with `idx_N` shape). | Rejected |
| C. New unified function (e.g. `canonicalProctorKey`) | Clean break. | All existing v1 byte-equality is lost. `meAssignments` round-trip with legacy DB rows breaks. Largest blast radius. Test churn is enormous. | Rejected |

**Decision: Option A (algo shape).** The justification:

1. `proctorMeta` already canonicalizes every proctor under `getProctorKey` — a
   pre-existing single source of truth.
2. `proctor_keys` (the public output array consumed by display, DB, sync) is already
   majority-algo-shape. The fix removes the minority exemption-shape contamination.
3. `meAssignments` is keyed by algo shape externally (v1 contract), so the boundary
   for `meAssignments` is identity (no translation needed).
4. `examDutyTeachersData` and `examExemptionsData` are keyed by exemption shape
   externally, so the boundary adapter performs `exemption → algo` translation at
   the two ingestion points. This is the only translation work the fix requires.
5. The `idx_N`-vs-`__idx_N` divergence (synthetic case `cin === "" AND som === ""`)
   is resolved by always preferring `__idx_N` (algo shape) for internal state. The
   adapter still maps `idx_N` to `__idx_N` for any external entry that may carry it.

### Phase D: Boundary Adapters

Three adapters are required, all built inside `orchestrator(input)` immediately after
input validation and before Phase 1:

1. **`keyAdapter` (one per run)**: a string→string map. Built once from `proctorsList`.
   For each `(proc, i)`, registers up to four entries that all map to the canonical
   `getProctorKey(proc, i)`:
   - `getProctorKey(proc, i)` → canonical (identity)
   - `getProctorExemptionKey(proc, i)` → canonical (the cross-shape translation)
   - `proc.cin` → canonical (only if non-empty)
   - `proc.som` → canonical (only if non-empty AND `proc.cin === ""`)

   Pseudocode:
   ```
   FUNCTION buildKeyAdapter(proctorsList)
     map ← Object.create(null)
     FOR i FROM 0 TO proctorsList.length - 1 DO
       proc        ← proctorsList[i]
       canonical   ← getProctorKey(proc, i)            // chosen canonical
       exempt      ← getProctorExemptionKey(proc, i)
       map[canonical] ← canonical                       // identity
       IF exempt ≠ canonical THEN map[exempt] ← canonical
       IF proc.cin AND proc.cin ≠ canonical THEN map[proc.cin] ← canonical
       IF proc.som AND proc.cin = "" THEN map[proc.som] ← canonical
     END FOR
     RETURN map
   END FUNCTION
   ```

2. **`toCanonicalKey(externalKey)` (helper)**: returns `keyAdapter[externalKey]` or
   `null` (orphan — see edge cases). Closes over `keyAdapter` and never mutates it.

3. **`canonicalDutyData` (lazy, optional)**: NOT used in the chosen design. Instead,
   the duty pre-pass translates each external duty key inline via `toCanonicalKey`
   at iteration time. The external `examDutyTeachersData` is never copied or mutated.

### Phase E: Test Plan

| Invariant | Test file | Status |
|---|---|---|
| Single-identity (Property 1) | `tests/proctor-v2-key-shape-unity.test.js` | NEW |
| No ghost CIN keys on production fixture | `tests/proctor-v2-no-ghost-keys.test.js` | NEW |
| `buildKeyAdapter` correctness | `tests/proctor-v2-key-adapter-unit.test.js` | NEW |
| Preservation: existing tests pass | `tests/proctor-v2-*.test.js` (full suite) | EXISTING |
| Preservation: H5 tests pass | `tests/inv-h5-cross-page-consistency.test.js` | EXISTING |
| Preservation: round-trip pass | `tests/preservation-config-roundtrip.pbt.test.js` | EXISTING |
| Preservation: lint clean | `npm run lint` | EXISTING |

## Correctness Properties

Property 1: Bug Condition — Canonical Single-Identity in Output

_For any_ input `X` where the bug condition holds (`isBugCondition(X) = true` against
the unfixed algorithm), the fixed algorithm `V2'.run(X).result` SHALL produce a result
in which every physical proctor `proc_i` is represented under exactly **one canonical
key string** — `canonicalProctorKey(proc_i, i) = getProctorKey(proc_i, i)` — across
`R_mem'.proctor_keys`, `R_mem'.reserve_keys`, and `R_mem'.loadState`. For every
`(proc_i, i)`, the count of `getProctorExemptionKey(proc_i, i)` in
`R_mem'.proctor_keys ∪ R_mem'.reserve_keys` SHALL be zero whenever
`getProctorKey(proc_i, i) ≠ getProctorExemptionKey(proc_i, i)`. Furthermore, the
histogram-by-canonical-key over `R_mem'.proctor_keys` SHALL equal the true total
slot count per proctor (no hidden dual-identity inflation), and on
`tests/fixtures/45454.json` specifically `max(histogram) = 3` SHALL hold truthfully
with zero ghost CIN keys (`1909564, 2367149, 1910812, 2158781, 1545317, 1177902`)
present in the output.

**Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.6, 2.7**

Property 2: Preservation — Non-Buggy Inputs Unchanged

_For any_ input `X` where the bug condition does NOT hold
(`isBugCondition(X) = false`), the fixed algorithm `V2'.run(X).result` SHALL produce
a result observationally equivalent to `V2.run(X).result` modulo only the canonical
key string substitutions documented in this design (which on `NOT C(X)` inputs are
no-ops because the two key functions agree). The proctor-keys multiset, the reserves
multiset, the assignments graph, the swap moves, the diagnostics object, and the
per-row metadata SHALL be observationally equivalent. All currently-passing tests in
`tests/proctor-v2-*.test.js`, `tests/inv-h5-*.test.js`, and
`tests/preservation-config-roundtrip.pbt.test.js` SHALL continue to pass without flake.
Neither `examDutyTeachersData` nor `examExemptionsData` nor `meAssignments` SHALL be
mutated by the fix; the IPC contract and the DB schema SHALL be unchanged.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15**

## Architecture Overview — Edit Sites Table

Every read/write site of either identity function in
`js/algorithms/proctor-distribution-v2.js`, classified and prescribed.

Legend for "Change needed" column: **NONE** (boundary read of external data, leave
as-is); **adapter** (translate external key via `toCanonicalKey` at this site);
**replace** (replace `getProctorExemptionKey` with `getProctorKey` here);
**inherits** (no direct change at this line; correctness follows from another change).

| # | Site (function) | Line | Kind | Source shape | Target | Change needed |
|---|---|---|---|---|---|---|
| 1 | `getProctorKey(proctor, index)` (definition) | 649 | producer | — | — | NONE — keep as canonical producer |
| 2 | `getProctorExemptionKey(proctor, index)` (definition) | 662 | producer | — | — | NONE — keep, but document as boundary-only |
| 3 | `isProctorExemptForEntry` lookup | 728 | consumer | exemption | reads `exemptionsData` | NONE — boundary read; external data is exemption-shape |
| 4 | `isExemptForAnyRow` (delegates to #3) | 759–774 | consumer | exemption | reads `exemptionsData` | NONE — inherits from #3 |
| 5 | `isDutyTeacherForEntry` lookup | 801 | consumer | exemption | reads `dutyData` | NONE — boundary read; external data is exemption-shape |
| 6 | `computeEligibilityClasses`: `key = getProctorKey(proc, pi)` then `isOnDutyDuringHalfday(key, hd, loadState)` | 499, 506 | producer + consumer | algo | reads loadState | inherits — once #11 is fixed (loadState is canonical-shape) the algo-shape lookup is correct |
| 7 | `proctorKeys.push(getProctorKey(...))` (Phase 1 fairness/coverage helper) | 895 | producer | algo | algo array | NONE — already canonical |
| 8 | `proctorMeta[i].key = getProctorKey(proc, pi)` | 1722 | producer (canonical source of truth) | algo | proctorMeta | NONE — already canonical |
| 9 | `proctorGenders[meta.key] = ...`, `proctorSpecialties[meta.key] = ...` | 1737–1739 | writer | algo (from proctorMeta) | maps keyed canonically | NONE |
| 10 | `meAssignmentsMap[meKeys[mk]] = ...` | 1741–1745 | writer | external `meAssignments` keys | meAssignmentsMap | **adapter** — translate via `toCanonicalKey` so meAssignmentsMap is canonical-keyed (defensive: meAssignments is algo-shape by v1 contract, so adapter is identity here, but the adapter call documents intent and protects against legacy rows) |
| 11 | Duty pre-pass: `addDutyLoad(loadState, dutyProctorKeys[dpi], dutyHdKey, '')` | 1762 | writer | exemption (from `Object.keys(examDutyTeachersData[scope])`) | loadState | **CRITICAL — adapter**: translate `dutyProctorKeys[dpi]` via `toCanonicalKey` before passing to `addDutyLoad`; if adapter returns null, skip with a `diagnostics.orphanDutyKeys++` counter |
| 12 | `costFunction`: `options.meAssignments[proctorKey]` | 1523 | consumer | algo (proctorKey from proctorMeta) | reads meAssignmentsMap | inherits from #10 — once meAssignmentsMap is canonical-keyed, lookup with canonical proctorKey works |
| 13 | `costFunction`: `options.classBoundsByProctorKey[proctorKey]` | 1509 | consumer | algo | reads classBoundsByProctorKey | NONE — already canonical (built from proctorMeta) |
| 14 | Phase 2 `addGuardLoad(loadState, assignedProctor.key, ...)` | ≈2089 | writer | algo (from proctorMeta) | loadState | NONE — already canonical |
| 15 | Phase 2 `sessionUsedMap[currentSessionKey].add(assignedProctor.key)`, `phase2PlacedKeys.add(assignedProctor.key)`, `globalRoomUseMap[...].add(assignedProctor.key)` | ≈2090–2098 | writer | algo | algo Sets | NONE |
| 16 | Phase 2 result row: `proctorKeysList.push(firstProctor.key)`, `meAssignmentsMap[firstProctor.key]`, etc. | 2308, 2317 | writer | algo | row.proctor_keys, row.proctor_groups | NONE — already canonical |
| 17 | `phase2_5PopulateReserves`: `var key = getProctorExemptionKey(proc, pi)` | 2643 | producer | exemption | candidate.key (then writes to sharedReserveKeys + loadStateForReserves) | **CRITICAL — replace** with `getProctorKey(proc, pi)` (canonical). All downstream sites in this function are inheriting consumers |
| 18 | `phase2_5PopulateReserves`: `if (sessionGuardSet.has(key)) continue` | 2648 | consumer | (depends on #17) | reads sessionGuards built from `row.proctor_keys` | inherits from #17 — sessionGuards is algo-shape (from proctor_keys), so the lookup works only after #17 is canonicalized |
| 19 | `phase2_5PopulateReserves`: `var teacherLoad = loadStateForReserves[key]` | 2651 | consumer | (depends on #17) | reads loadState | inherits from #17 — loadState is canonical-shape after #11 + #14 |
| 20 | `phase2_5PopulateReserves`: `sharedReserveKeys.push(chosen[ci].key)` | 2750 | writer | (depends on #17) | reserve_keys | inherits from #17 |
| 21 | `phase2_5PopulateReserves`: `addReserveLoad(loadStateForReserves, chosenForLoad.key, halfdayKey, ...)` | 2765 | writer | (depends on #17) | loadState | inherits from #17 |
| 22 | `phase2_5PopulateReserves`: `computeAffinityRank(key, ...)` | 2700 | consumer | (depends on #17) | session affinity computation | inherits from #17 |
| 23 | `Phase 3 violatesHardConstraints`: reads `proctor_keys`, `reserve_keys` strings | ≈3380–3500 | consumer | output keys (algo after fix) | hard-constraint checks | inherits — strings are now canonical, no change |
| 24 | `applyMove` `swap_roles`: `var reserveKey = reserveRow.reserve_keys[rs]; guardRow.proctor_keys[gs] = reserveKey;` | 3628, 3636 | writer | (depends on #17/#20) | proctor_keys | inherits from #17 — once reserve_keys are canonical, the swap propagates canonical strings |
| 25 | `Phase 3 SA objective`: walks `proctor_keys` and `reserve_keys` to build per-key load | 3120–3148 | consumer | output keys | SA cost | inherits — keys are now canonical |
| 26 | `collectUncovered`: `var key = getProctorKey(list[i], i); ... loadState[key]` | 2808–2810 | consumer | algo | reads loadState | inherits — loadState is canonical-shape after #11 + #14, so algo-shape lookup correctly finds duty load |
| 27 | `phase2_75CoverageRepair`: `isOnDutyDuringHalfday(T_uncov.key, halfday_key, loadState)`, `rowHasKeyOutsideSlot(row, slot, T_uncov.key)` | 2868, 2870 | consumer | algo | reads loadState, scans row keys | inherits |
| 28 | `computeActualDutyPairs`: `var key = getProctorKey(list[i], i); ... loadState[key].dutyCount` | 3070–3073 | consumer | algo | reads loadState dutyCount | inherits — once duty pre-pass is canonical-keyed, this lookup correctly returns dutyCount |
| 29 | `validateProctorReferences`: `validMeKeys.add(getProctorKey(...))`, `validExKeys.add(getProctorExemptionKey(...))` | 3949 | producer | both | validation sets | NONE — keep both validation sets to validate both external shapes; this is a boundary validator, not internal state |
| 30 | `validateProctorReferences`: warn on unknown `meAssignments` keys against `validMeKeys` | 3957 | consumer | algo | external validation | NONE — boundary validator |
| 31 | `validateProctorReferences`: warn on unknown `exemptionsData` keys against `validExKeys` | 3964 | consumer | exemption | external validation | NONE — boundary validator |

**Total sites: 31. Critical changes: 2 (rows #11 and #17). Defensive changes: 1 (#10). All other sites inherit correctness from the boundary-adapter at #11 and the canonicalization at #17, plus the existing canonical sources at #8, #14, #16.**

### Key Insight

External data (`examDutyTeachersData`, `examExemptionsData`) is keyed by `cin || som`
because the data layer that produces these objects (the user's editor in
`exams-proctors.html`) is shape-agnostic — it uses whichever identifier the user
typed. These are external boundary reads and stay as-is at sites #3, #5, #29, #31.

The bug is that **internal state** (`loadState`, `proctor_keys`, `reserve_keys`) is
mixed-shape. The fix introduces `keyAdapter` so every internal write either originates
from `proctorMeta` (already canonical) or is translated via `toCanonicalKey` at the
single boundary point. After the fix, internal state is closed under the canonical
shape; only the two external lookup sites (#3, #5) read external data using the
exemption-shape key derived from `(proc, idx)` directly via `getProctorExemptionKey`,
because that is the shape of those external objects.

## Boundary Adapter Design

### `buildKeyAdapter(proctorsList)`

Construct once per `orchestrator(input)` invocation, immediately after input validation
(line ≈3982 area). Closure over `keyAdapter` is sufficient; no need to plumb through
function parameters except where existing functions already accept `loadState`.

```javascript
/**
 * Builds a string→string map from any external key shape to the canonical key
 * shape (algo, i.e. cin || '__idx_' + idx) for each proctor in proctorsList.
 *
 * Recognized external shapes per proctor at index i:
 *   - getProctorKey(proc, i)            → canonical (identity)
 *   - getProctorExemptionKey(proc, i)   → canonical (cross-shape)
 *   - proc.cin (if non-empty)           → canonical (always identity, since cin
 *                                         is the prefix of both functions)
 *   - proc.som (if non-empty AND cin="") → canonical (the production case)
 *
 * The adapter is read-only after construction. Multiple registrations of the
 * same external key under different proctors are NOT possible by construction
 * for cin and the synthetic forms; they CAN occur for som if two proctors share
 * a som — that is logged as a warning and the LATER registration wins (matches
 * v1 behaviour in `Object.keys` iteration order).
 */
function buildKeyAdapter(proctorsList) {
  var map = Object.create(null);
  for (var i = 0; i < proctorsList.length; i++) {
    var proc = proctorsList[i] || {};
    var canonical = getProctorKey(proc, i);
    var exempt    = getProctorExemptionKey(proc, i);
    map[canonical] = canonical;
    if (exempt !== canonical) map[exempt] = canonical;
    if (proc.cin && proc.cin !== canonical) map[proc.cin] = canonical;
    if (proc.som && !proc.cin) map[proc.som] = canonical;
  }
  return map;
}

function toCanonicalKey(keyAdapter, externalKey) {
  if (!externalKey) return null;
  return keyAdapter[externalKey] || null;
}
```

### Wiring at the duty pre-pass (Edit Site #11, line ≈1762)

Before:
```javascript
for (var dpi = 0; dpi < dutyProctorKeys.length; dpi++) {
  if (dutyEntry[dutyProctorKeys[dpi]]) {
    var dutyParts = dutyDataKeys[dki].split('|');
    var dutyHdKey = '';
    if (dutyParts.length >= 3) {
      dutyHdKey = dutyParts[0] + '|' + (dutyParts[2] || 'صباحا');
    }
    if (dutyHdKey) {
      addDutyLoad(loadState, dutyProctorKeys[dpi], dutyHdKey, '');
    }
  }
}
```

After:
```javascript
for (var dpi = 0; dpi < dutyProctorKeys.length; dpi++) {
  if (dutyEntry[dutyProctorKeys[dpi]]) {
    var dutyParts = dutyDataKeys[dki].split('|');
    var dutyHdKey = '';
    if (dutyParts.length >= 3) {
      dutyHdKey = dutyParts[0] + '|' + (dutyParts[2] || 'صباحا');
    }
    if (dutyHdKey) {
      // Translate exemption-shape external key to canonical shape before
      // crossing the boundary into loadState. Orphan keys (external entries
      // that match no proctor in proctorsList) are skipped and counted.
      var canonicalDutyKey = toCanonicalKey(keyAdapter, dutyProctorKeys[dpi]);
      if (canonicalDutyKey) {
        addDutyLoad(loadState, canonicalDutyKey, dutyHdKey, '');
      } else {
        diagnostics.orphanDutyKeys = (diagnostics.orphanDutyKeys || 0) + 1;
      }
    }
  }
}
```

### Wiring at `phase2_5PopulateReserves` (Edit Site #17, line ≈2643)

Before:
```javascript
for (var pi = 0; pi < proctorsList.length; pi++) {
  var proc = proctorsList[pi];
  var key = getProctorExemptionKey(proc, pi);   // exemption shape
  if (sessionGuardSet.has(key)) continue;
  if (isExemptForAnyRow(proc, pi, sessionRows, exemptionsData)) continue;
  var teacherLoad = loadStateForReserves[key];
  // ...
}
```

After:
```javascript
for (var pi = 0; pi < proctorsList.length; pi++) {
  var proc = proctorsList[pi];
  var key = getProctorKey(proc, pi);             // canonical shape
  if (sessionGuardSet.has(key)) continue;
  if (isExemptForAnyRow(proc, pi, sessionRows, exemptionsData)) continue;
  // exemption-shape lookups against external data still happen INSIDE
  // isExemptForAnyRow / isDutyTeacherForEntry — they receive (proc, pi)
  // and rebuild the exemption key locally. They never touch loadState.
  var teacherLoad = loadStateForReserves[key];   // loadState is canonical
  // ...
}
```

The change is one identifier: `getProctorExemptionKey` → `getProctorKey`. All
downstream sites in this function (`sharedReserveKeys.push(chosen[ci].key)`,
`addReserveLoad(loadState, chosen.key, ...)`, `computeAffinityRank(key, ...)`)
inherit the canonical shape with no further code changes.

### Wiring at `meAssignmentsMap` build (Edit Site #10, line ≈1741, defensive)

Before:
```javascript
if (meAssignments && typeof meAssignments === 'object') {
  var meKeys = Object.keys(meAssignments);
  for (var mk = 0; mk < meKeys.length; mk++) {
    meAssignmentsMap[meKeys[mk]] = meAssignments[meKeys[mk]];
  }
}
```

After:
```javascript
if (meAssignments && typeof meAssignments === 'object') {
  var meKeys = Object.keys(meAssignments);
  for (var mk = 0; mk < meKeys.length; mk++) {
    // meAssignments is keyed by algo shape per v1 contract; translation is
    // identity for well-formed input. The adapter call defends against
    // legacy DB rows that may have leaked exemption-shape keys here.
    var canonicalMeKey = toCanonicalKey(keyAdapter, meKeys[mk]);
    if (canonicalMeKey) {
      meAssignmentsMap[canonicalMeKey] = meAssignments[meKeys[mk]];
    } else {
      diagnostics.orphanMeAssignments = (diagnostics.orphanMeAssignments || 0) + 1;
    }
  }
}
```

This is defensive — it does not fix any currently-known bug, but it closes a
parallel leak vector if `meAssignments` ever ends up exemption-keyed in a legacy
DB row. Removing the warning emitted by `validateProctorReferences` for such rows
is left for a future spec.

## Edge Cases

| Case | Description | Handling |
|---|---|---|
| All-cin proctors | Every `proc.cin !== ""`. Both functions return the same string for every proctor. | `keyAdapter[cin] = cin` (identity). All edit sites are no-ops on input shape. `V2'(X) = V2(X)`. |
| Synthetic-only (`cin === "" AND som === ""`) | `getProctorKey → __idx_N`, `getProctorExemptionKey → idx_N`. Two distinct strings, neither equal to a meaningful identifier. | Adapter registers `__idx_N → __idx_N` and `idx_N → __idx_N`. External data keyed by `idx_N` (unusual but possible) is translated to `__idx_N` at the boundary. Internal state is canonical. |
| Production case (`cin === "" AND som !== ""`) | The bug case. `getProctorKey → __idx_N`, `getProctorExemptionKey → som`. | Adapter registers `__idx_N → __idx_N` and `som → __idx_N`. The duty pre-pass at #11 translates `som`-keyed external entries to `__idx_N` before writing to `loadState`. `phase2_5PopulateReserves` at #17 produces `__idx_N` directly. Output is canonical. |
| Mixed (some `cin`, some `som`-only) | Mix of the above two cases in one input. | Each proctor's adapter entry is independent. Behaviour is the union of the two cases above. |
| Duty entry keyed by an unknown identifier (orphan) | `examDutyTeachersData[scope]` contains a key that matches no proctor in `proctorsList` (e.g. proctor was deleted but duty entry remained). | `toCanonicalKey` returns `null`. The pre-pass skips the entry and increments `diagnostics.orphanDutyKeys`. `loadState` is unchanged. No throw. |
| Exemption entry keyed by an unknown identifier (orphan) | Same as above for `examExemptionsData`. | Boundary read (#3) — the exemption key is computed from `(proc, idx)` for each proctor in `proctorsList`, then looked up in `exemptionsData`. Unknown external keys are simply never queried. No change needed; preexisting behaviour is correct. `validateProctorReferences` already warns about such entries. |
| Two proctors share the same `som` | Anomalous data. `keyAdapter[som]` registration order: later proctor wins. | Matches v1 `Object.keys` iteration semantics. The bug condition cannot occur for the loser (since `som` is now mapped away from them); no regression vs F. Future `validateProctorReferences` warning is in scope of a follow-up spec, not this one. |
| Empty `proctorsList` | `keyAdapter = {}`. | All `toCanonicalKey` calls return `null`. Pre-pass skips all duty entries. `phase2_5PopulateReserves` candidate loop runs zero iterations. Algorithm completes with empty result. No regression. |
| Legacy DB row contains exemption-shape ghost key in `proctor_keys` | A row persisted under the buggy F has e.g. `proctor_keys: [..., '1909564']`. | This row is read on **load** by display code, not by the algorithm. The display-layer resolver from `proctor-distribution-db-memory-mismatch` resolves `1909564` → fallback name. No silent rewrite — a re-run of the algorithm regenerates the row with canonical keys, and persistence then overwrites the ghost. |
| `dutyData[scope]` value is `false` / `null` / non-truthy | Existing pre-pass code already gates with `if (dutyEntry[dutyProctorKeys[dpi]])`. | No change — behaviour identical to F. |

## Fix Implementation

### Changes Required

**File**: `js/algorithms/proctor-distribution-v2.js`

The fix is confined to a single file. No other source file is modified. Test files
are added (three new files); existing test files are unchanged.

**Function-level changes**:

1. **`buildKeyAdapter(proctorsList)`** — NEW helper. Inserted near the existing key
   helpers (after `getProctorExemptionKey` at ≈line 665). Closure-free, pure function
   over `proctorsList`. Exposed on `_internals` for the unit test.

2. **`toCanonicalKey(keyAdapter, externalKey)`** — NEW helper. Inserted directly after
   `buildKeyAdapter`. One-liner. Returns `keyAdapter[externalKey] || null`.

3. **`orchestrator(input)` — initialization**: build `keyAdapter` once after input
   validation (line ≈3982 area), before Phase 1. Plumb into `phase2Build` (so the
   duty pre-pass can use it) by attaching to a closure-captured local or extending
   the existing `phase2Options` object (already passed through). The simplest plumbing
   is to capture `keyAdapter` in a closure scoped to `orchestrator` and reference it
   directly from `phase2Build` (which is a nested function — confirm nesting at
   implementation time). If `phase2Build` is module-level, attach via a parameter
   addition (additive only, last positional).

4. **`phase2Build` duty pre-pass (line ≈1762)** — Edit Site #11. Replace the direct
   `addDutyLoad(loadState, dutyProctorKeys[dpi], ...)` with a `toCanonicalKey`-mediated
   call; skip + count orphans.

5. **`phase2Build` `meAssignmentsMap` build (line ≈1741)** — Edit Site #10. Defensive
   adapter call on each external key. Identity for well-formed input.

6. **`phase2_5PopulateReserves` (line ≈2643)** — Edit Site #17. Single-token change:
   `getProctorExemptionKey` → `getProctorKey`.

7. **`diagnostics`** — additive: introduce two new counters, `orphanDutyKeys` and
   `orphanMeAssignments`, both initialized to 0. They surface in the orchestrator's
   diagnostics object for observability (no API contract change because the
   diagnostics object is an open dictionary; new keys are additive).

8. **No other source change**. All other sites inherit correctness via the
   structural argument in §"Architecture Overview".

**No changes** to: `getProctorKey` definition, `getProctorExemptionKey` definition
(retained as the authoritative function for boundary reads against external
exemption-shape data — `isProctorExemptForEntry`, `isDutyTeacherForEntry`, and the
validator), the `applyMove`/`undoMove` swap logic, the SA objective, the Hungarian
solver, Phase 1, Phase 3 SA loop, or `validateProctorReferences`.

### Implementation Order

1. Add `buildKeyAdapter` and `toCanonicalKey` helpers (no behaviour change yet).
2. Expose both on `_internals` for unit testing.
3. Write `tests/proctor-v2-key-adapter-unit.test.js`. It must pass at this point.
4. Wire `keyAdapter` into the duty pre-pass (#11). Run full test suite — no expected
   regressions because no internal site yet reads canonical-form duty entries
   differently. Run the new no-ghost-keys test — it should now pass on the production
   fixture (the duty pre-pass no longer leaks).
5. Replace `getProctorExemptionKey` → `getProctorKey` in `phase2_5PopulateReserves`
   (#17). Run full test suite. Run the new key-shape-unity test — it must pass.
6. Add the defensive `meAssignmentsMap` adapter call (#10). Run full suite.
7. Run lint. Run all preservation tests including `tests/preservation-config-roundtrip.pbt.test.js`.

### What is explicitly NOT changed

- `getProctorKey` and `getProctorExemptionKey` function bodies (line 649, 662) — they
  remain authoritative producers; v1 byte-equality with legacy `meAssignments` and
  `exemptionsData` is preserved.
- `isProctorExemptForEntry`, `isDutyTeacherForEntry`, `validateProctorReferences` —
  these are boundary readers against external exemption-shape data and remain
  exemption-shape internally.
- `main/db/migrations.js` — no schema change, no migration.
- `main/ipc/exam-config-data.js` — no IPC contract change.
- The display layer (`exams-rooms.html`, `exams-proctors.html`) — unchanged.
- `js/data/proctor-key-resolver.js` from the closed display-layer spec — unchanged.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **R1**: Changing `phase2_5PopulateReserves` key shape breaks v1 byte-equality on `meAssignments` round-trip | Low | High | The change at #17 only affects `reserve_keys` and `loadStateForReserves` (internal), not `meAssignments` or `exemptionsData` (external). v1 byte-equality is preserved because `getProctorKey`/`getProctorExemptionKey` definitions are untouched. The preservation property test `tests/preservation-config-roundtrip.pbt.test.js` enforces this. |
| **R2**: Legacy DB rows have exemption-shape keys in `proctor_keys` / `reserve_keys` | High (already exists in production) | Low | The display-layer resolver from `proctor-distribution-db-memory-mismatch` already handles unknown keys via fallback. A re-run of the algorithm regenerates rows with canonical keys; persistence overwrites the ghost. No silent rewrite is done by this spec. |
| **R3**: `meAssignments` is keyed by exemption shape in legacy DB rows (not just algo shape) | Medium | Medium | The defensive adapter at #10 absorbs this case: exemption-shape `meAssignments` keys are translated to canonical at ingestion. `validateProctorReferences` already warns about non-canonical `meAssignments` keys. |
| **R4**: A new external data source enters the algorithm in a future spec without going through `keyAdapter` | Medium (long-term) | Medium | Document the boundary invariant in the §"Glossary" "Boundary" entry. Add a code comment at `buildKeyAdapter` and at the two adapter call sites describing the contract. The unit test for `buildKeyAdapter` covers the four shape mappings explicitly. |
| **R5**: `keyAdapter` registration order conflict (two proctors share `som`) silently mismaps | Low | Low | Last-write-wins matches v1 `Object.keys` iteration semantics, so behaviour is unchanged. A future spec can promote this to a `validateProctorReferences` warning. |
| **R6**: Phase 3 SA produces a swap that introduces a non-canonical key into `proctor_keys` | Very low | High | The SA only swaps existing strings between `proctor_keys` slots (`applyMove` `swap_guards`, `swap_roles`, `reassign_reserve`). Once Phase 2 and Phase 2.5 are canonical-shape, the SA swap-set is closed under canonical shape. No code change needed in Phase 3. The new `proctor-v2-key-shape-unity.test.js` runs the FULL pipeline including SA. |
| **R7**: `phase2_75CoverageRepair` injects an exemption-shape key | Very low | Medium | `collectUncovered` already produces `getProctorKey(list[i], i)` (algo shape) at line 2808. The repair pass mutates `row.proctor_keys[slot] = uncov.key` with `uncov.key` algo-shape. No regression. Covered by the new key-shape-unity test. |
| **R8**: `examMorningEveningData` introduces a new key-shape entry point | Very low | Medium | `examMorningEveningData` is consumed by `meAssignments` derivation upstream of v2.js; v2.js receives only the already-derived `meAssignments` object. The defensive #10 adapter covers this path. |
| **R9**: Performance regression from per-key adapter lookup at the hot duty pre-pass | Very low | Low | The pre-pass runs `O(D × K_avg)` lookups where D = number of duty scopes and K = duty proctors per scope (small, typically <50 for production fixtures). One `Object.create(null)` map lookup is O(1). Negligible impact. |
| **R10**: `_internals` export of new helpers breaks tree-shaking or bundling assumptions | Very low | Low | `_internals` is already an open object on the module exports. Adding two more keys is additive. No bundler config affected. |

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach:

1. **Pre-fix exploratory checking**: confirm the bug condition fires on the production
   fixture and that the three currently-known leak sites are the actual cause.
   Re-run the user's verification script in a Node-only test harness.
2. **Post-fix correctness checking**: verify Property 1 holds for all inputs that
   triggered the bug pre-fix, and Property 2 (preservation) holds for inputs that did
   NOT trigger the bug.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the
fix. Confirm the root-cause analysis (3 leak sites) is exhaustive. If we find
additional leaks, re-hypothesize.

**Test Plan**: Run the unfixed algorithm against `tests/fixtures/45454.json` in a
Node-only harness and assert against the canonical-shape unity property. The tests
must FAIL on F and PASS on F'.

**Test Cases (run on F first, expect failures)**:

1. **Production fixture dual-identity test**: Run F on `tests/fixtures/45454.json`,
   collect `R_mem.proctor_keys`, assert that for the 6 known affected proctors
   (idx 43, 47, 50, 66, 78, 92) BOTH the algo-shape key and the exemption-shape key
   appear. **Expected on F: PASS (confirms bug)**. After fix, this test must FAIL
   (or be inverted into the unity test).
2. **Ghost CIN counter test**: Run F on the production fixture, assert that
   `proctor_keys` contains all 6 of `1909564, 2367149, 1910812, 2158781, 1545317,
   1177902`. **Expected on F: PASS (confirms bug)**.
3. **Synthetic dual-identity test**: Construct a minimal input with one proctor where
   `cin === ""` and `som === "S1"`, plus a duty entry keyed by `S1`. Run F. Assert
   that `R_mem.proctor_keys` contains both `__idx_0` and `S1`. **Expected on F: PASS
   (confirms bug)**.

**Expected Counterexamples**:

- 6 proctors carry hidden +1 load via exemption-shape keys.
- Possible causes (all confirmed by code inspection in §"Hypothesized Root Cause"):
  duty pre-pass writing exemption-shape keys to `loadState`,
  `phase2_5PopulateReserves` deriving exemption-shape keys, `applyReserveSwap`
  promoting exemption-shape keys into `proctor_keys`.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed
algorithm produces canonical single-identity output (Property 1).

**Pseudocode**:
```
FOR ALL input WHERE isBugCondition(input) DO
  R_mem' := V2'.run(input).result

  // (P-1) Single-identity
  FOR EACH proc, idx IN input.proctorsList DO
    K1 := getProctorKey(proc, idx)
    K2 := getProctorExemptionKey(proc, idx)
    IF K1 ≠ K2 THEN
      n1 := occurrencesIn(R_mem'.proctor_keys ∪ R_mem'.reserve_keys, K1)
      n2 := occurrencesIn(R_mem'.proctor_keys ∪ R_mem'.reserve_keys, K2)
      ASSERT (n1 = 0) OR (n2 = 0)   // never both present
    END IF
  END FOR

  // (P-2) Truthful max
  hist := histogramByCanonicalKey(R_mem')
  ASSERT max(hist) = trueMaxLoad(input, R_mem')

  // (P-3) Canonical-shape closure
  FOR EACH key IN keysOf(R_mem'.proctor_keys ∪ R_mem'.reserve_keys ∪ R_mem'.loadState) DO
    ASSERT key = getProctorKey(proctorOf(key), indexOf(key))
  END FOR

  // (P-4) Production-fixture invariant
  IF input = load('tests/fixtures/45454.json') THEN
    ASSERT max(histogramByCanonicalKey(R_mem')) = 3
    ASSERT noProctorHasHiddenLoad(input, R_mem')
    ASSERT { '1909564','2367149','1910812','2158781','1545317','1177902' }
           ∩ R_mem'.proctor_keys = ∅
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the
fixed algorithm produces the same result as the original.

**Pseudocode**:
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT V2(input).result ≡ V2'(input).result   // observationally equivalent
END FOR
```

**Testing Approach**: Property-based testing is well-suited for the preservation
property because:

- It generates many test cases automatically across the input domain (proctor counts,
  cin/som distributions, duty/exemption configurations).
- It catches edge cases that manual unit tests might miss (e.g. a proctor with a
  cin that happens to equal another proctor's som — adapter conflict).
- It provides strong guarantees that behaviour is unchanged for all non-buggy inputs,
  not only the inputs we thought to enumerate.

In practice, the preservation property is enforced primarily by **re-running the
existing test suite** (`tests/proctor-v2-*.test.js`, `tests/inv-h5-*.test.js`,
`tests/preservation-config-roundtrip.pbt.test.js`). Most of these tests use
all-cin proctors and therefore lie in `NOT C(X)`; their continued passing is the
preservation evidence.

**Test Plan**: Observe behaviour on F first for all-cin inputs (most existing
fixtures), then write the unity test capturing the post-fix invariant.

**Test Cases**:

1. **All-cin preservation**: Run V2 and V2' on a fixture where every proctor has a
   non-empty `cin`. Assert `V2(X).result ≡ V2'(X).result` byte-for-byte (modulo
   `diagnostics.orphanDutyKeys` and `diagnostics.orphanMeAssignments` which are
   additive new fields).
2. **Production fixture preservation**: Run V2 and V2' on
   `tests/fixtures/45454.json`. Assert that `V2'(X).result.proctor_keys` is the
   `keyAdapter`-translated form of `V2(X).result.proctor_keys` (i.e. every key
   either equals a key in V2(X) or is the canonical of a key in V2(X)).
3. **Existing test suite preservation**: Run `npm test`. Assert all currently-passing
   tests continue to pass.

### Unit Tests

- `tests/proctor-v2-key-adapter-unit.test.js` (NEW): Unit-test `buildKeyAdapter` for
  all four shape mappings:
  - Proctor with `cin = "C1"` and `som = "S1"`: registers `"C1" → "C1"`.
  - Proctor with `cin = ""` and `som = "S1"` at index 0: registers
    `"__idx_0" → "__idx_0"`, `"S1" → "__idx_0"`.
  - Proctor with `cin = ""` and `som = ""` at index 5: registers
    `"__idx_5" → "__idx_5"`, `"idx_5" → "__idx_5"`.
  - Empty `proctorsList`: returns `{}`.
  - Two proctors with the same `som`: last-wins.
  - `toCanonicalKey` returns `null` on unknown external keys.

### Property-Based Tests

- `tests/proctor-v2-key-shape-unity.test.js` (NEW): Generate proctor lists with mixed
  cin/som/empty proctors, run V2', and assert Property 1 (single-identity) for every
  proctor across `proctor_keys`, `reserve_keys`, and `loadState` keys. Use existing
  fast-check generators from the proctor-v2 PBT suite.
- `tests/proctor-v2-no-ghost-keys.test.js` (NEW): Hard-coded regression test —
  load `tests/fixtures/45454.json`, run V2', assert that the 6 known ghost CINs
  (`1909564, 2367149, 1910812, 2158781, 1545317, 1177902`) are absent from
  `R_mem'.proctor_keys` and `R_mem'.reserve_keys`. Also assert that
  `max(histogramByCanonicalKey(R_mem'))` equals 3 truthfully (no hidden load).

### Integration Tests

- The existing `tests/inv-h5-cross-page-consistency.test.js` already runs the full
  Phase 1 → Phase 2 → Phase 2.5 → Phase 2.75 → Phase 3 pipeline and compares
  rooms-page and proctors-page summaries. Re-run after the fix to confirm the H5
  invariant still holds.
- The existing `tests/preservation-config-roundtrip.pbt.test.js` exercises the IPC
  save/load path for `examAutoDistributionData`. Re-run after the fix to confirm
  round-trip stability with canonical-shape keys.
- The existing `tests/proctor-v2-property-4-save-stability.test.js` exercises
  successive runs producing stable saved blobs. Re-run to confirm stability under
  canonical shape.
- The existing `tests/proctor-v2-property-p5-eligibility.test.js` enforces the
  per-class eligibility invariant; canonical-shape `loadState` must continue to
  satisfy it.
- Manual end-to-end: re-run the user's devtools script "Detect dual-identity proctors"
  on the production fixture in the Electron renderer after the fix is deployed.
  Expected output: `ghost keys (in DB but not valid): 0` and the per-proctor lines
  list each of the 6 affected proctors with a single canonical key and a count
  matching their true total load.
