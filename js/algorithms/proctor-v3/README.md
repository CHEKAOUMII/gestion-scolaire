# Proctor Distribution V3

V3 is the rewrite of the proctor distribution algorithm, designed from a unified constraint specification rather than the incremental patches that accreted on V2 (`js/algorithms/proctor-distribution-v2.js`). It runs as a pure Node module — no Electron, no DOM, no `better-sqlite3` — so it can be exercised from CLI tests, the `verify:v3` script, and the renderer alike. V2 is left untouched and is selected at runtime via an `algorithmVersion` flag in `exams-proctors.html`.

For the full motivation, constraint catalog, and acceptance criteria see (paths are relative to this README at `js/algorithms/proctor-v3/`):

- [`../../../.kiro/specs/proctor-distribution-v3/requirements.md`](../../../.kiro/specs/proctor-distribution-v3/requirements.md) — what V3 must do (Constraint Catalog + glossary)
- [`../../../.kiro/specs/proctor-distribution-v3/design.md`](../../../.kiro/specs/proctor-distribution-v3/design.md) — how it is structured (Constraint Matrix in §6)
- [`../../../.kiro/specs/proctor-distribution-v3/tasks.md`](../../../.kiro/specs/proctor-distribution-v3/tasks.md) — implementation plan
- [`../../../.kiro/specs/proctor-distribution-v3/v2-review.md`](../../../.kiro/specs/proctor-distribution-v3/v2-review.md) — V2 pitfalls avoided

## Public API

The module exposes a single public function `run` plus a testing-only `_internals` namespace.

```js
const { run } = require('./js/algorithms/proctor-v3'); // resolves to index.js

const { result, diagnostics, algorithmVersion, orchestratorState } = run(input);
```

### `run(input, options?) → V3Output`

Executes the full V3 phase pipeline (`Phase 0 → Phase 10`) and returns the standardized envelope below. The function is deterministic given identical `input.randomSeed` (Acceptance Criterion 8.4) and re-entrant: every per-run variable lives in closure-local state, so concurrent calls do not interfere.

#### Parameters

- `input` (`Object`, required) — the `GS3_Input_Contract` documented in the [requirements glossary](../../../.kiro/specs/proctor-distribution-v3/requirements.md). Briefly:
  - `proctorsList: Proctor[]`
  - `scheduleEntries: ScheduleEntry[]`
  - `examDistributionRules: { proctorsPerRoom, reservesPerSession?, allowSameDayBothHalfdays? }`
  - `dutyData`, `exemptionsData`, `meAssignments` — keyed by any external proctor identifier (cin, som, idx_N); the V3 Key Adapter resolves them to canonical keys.
  - `examCenterConfig`, `examCenterLevels`, `examCenterRoomsData`
  - `randomSeed?: number` — when present, the run is byte-deterministic.

- `options` (`Object`, optional)
  - `totalBudgetMs` (`number`, default `30000`) — global wall-clock budget. The pipeline returns the best-effort partial result if it exhausts the budget.

#### Returns

```ts
interface V3Output {
  result: ResultRow[];            // shape-compatible with V2 (Acceptance Criterion 1.4)
  diagnostics: DiagnosticsV3;     // see requirements.md §9 (Diagnostics)
  algorithmVersion: 'v3';
  orchestratorState: 'COMPLETED' | 'DEGRADED' | 'TIMEOUT' | 'ERROR' | 'INVALID_INPUT';
}
```

The three documented fields are always present on return. `algorithmVersion` is the literal string `'v3'`, letting the renderer and downstream display code branch without sniffing the shape. `result` is an array of `ResultRow` objects (one per `session × room`); on `INVALID_INPUT` it is an empty array. `diagnostics` is the `DiagnosticsV3` envelope aggregated by Phase 10 (`phases/10-finalize.js`) — two histograms (`histogramByGuardCount`, `histogramByPrimaryLoad`), `min`/`max`/`distinctCount`, global and per-class bounds, `unresolvedSlots`, structured `warnings`/`errors`, and timing (`totalDurationMs`, `phaseDurations`, `seedUsed`). `orchestratorState` summarizes the run:

| State | Meaning |
| --- | --- |
| `COMPLETED` | clean run, no errors, every slot covered |
| `DEGRADED` | finished but `diagnostics.errors` non-empty or `unresolvedSlots.length > 0` |
| `TIMEOUT` | global budget exhausted at some point |
| `ERROR` | fatal exception prevented building diagnostics |
| `INVALID_INPUT` | Phase 0 rejected the input; pipeline did not run |

`diagnostics.errors` is always an array of structured objects `{ type, message, phase?, details? }` — never bare strings (V3 fixes this V2 pitfall explicitly).

### `_internals`

Exported for white-box testing only. Not part of the public contract.

| Name | Purpose |
| --- | --- |
| `canonicalProctorKey(proc, idx)` | Single identity function for a proctor (Requirement 2.1). |
| `buildKeyAdapter(proctorsList)` | Boundary translator from external keys → canonical (Requirement 2.3). |
| `toCanonical(adapter, externalKey)` | Lookup helper used by Phase 1. |
| `computeHistogram(rows)` | Slot-based histogram from `proctor_keys` (alias of `computeHistogramByGuardCount`, Acceptance Criterion 9.3). |
| `computeHistogramByGuardCount(rows)` | Same as above, explicit name. |
| `computeHistogramByPrimaryLoad(loadState, classByProctorKey)` | Primary_Load histogram used by the bimodal check (Acceptance Criterion 9.3a). |
| `runOrchestrator(input, options)` | Direct orchestrator entry point — equivalent to `run`; useful when a test wants to bypass `index.js`. |
| `createPRNG(seed)` | Seeded PRNG (mulberry32) used by every phase. |

Reaching into `_internals` is acceptable inside `tests/proctor-v3/`; production code SHALL stay on `run`.

## Example usage

```js
const { run } = require('./js/algorithms/proctor-v3');

const input = {
    proctorsList: [
        { cin: 'P0001', name: 'Proctor One',   subject: 'Math',    gender: 'M' },
        { cin: 'P0002', name: 'Proctor Two',   subject: 'Physics', gender: 'F' },
        { cin: 'P0003', name: 'Proctor Three', subject: 'Chem',    gender: 'M' },
        { cin: 'P0004', name: 'Proctor Four',  subject: 'Bio',     gender: 'F' }
    ],
    scheduleEntries: [
        { date: '2026-06-01', period: 'صباحا', day: 'الأول', session_label: 'الحصة الأولى', subject_name: 'Math', level: 'L1' },
        { date: '2026-06-01', period: 'مساء',  day: 'الأول', session_label: 'الحصة الأولى', subject_name: 'Physics', level: 'L1' }
    ],
    dutyData: {},
    exemptionsData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 2, reservesPerSession: 0, allowSameDayBothHalfdays: false },
    examCenterConfig: { expected_duty_tasks: 0 },
    examCenterLevels: { L1: { rooms: 1, sessions: 2 } },
    examCenterRoomsData: { L1: [{ room_name: 'Room 1' }] },
    randomSeed: 42
};

const { result, diagnostics, algorithmVersion, orchestratorState } = run(input);

console.log(orchestratorState);                       // 'COMPLETED'
console.log(algorithmVersion);                        // 'v3'
console.log(result.length);                           // 2 rows (1 room × 2 sessions)
console.log(diagnostics.histogramByPrimaryLoad);      // strict bimodal { 1: 4 }
```

A second invocation with the same input and `randomSeed: 42` produces a byte-identical `result` and an identical `diagnostics.histogramByPrimaryLoad`; only the timing fields (`totalDurationMs`, `phaseDurations`) may differ (Acceptance Criterion 8.4).

## Module layout

```
js/algorithms/proctor-v3/
├── index.js              # public API (run, _internals)
├── orchestrator.js       # phase pipeline driver (closure-local state)
├── canonical-key.js      # single canonical proctor identity + adapter
├── diagnostics.js        # diagnostics aggregation
├── constraints/          # hard + soft constraint predicates, bounds
├── phases/               # 00-validate … 10-finalize
├── solver/               # CP solver (domain, propagators, search)
├── search/               # local search neighborhoods
└── utils/                # PRNG, histogram, load-state
```

Tests live in `tests/proctor-v3/`. The `verify:v3` script (Task 33) runs the production fixture acceptance test (`tests/proctor-v3/production-fixture.test.js`).

## Renderer integration

`exams-proctors.html` is the only frontend that should call `run` directly. The renderer runs **fully sandboxed** (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` — see `main.js`), so `require()` is **not** available there. The multi-file `require()`-based V3 module therefore cannot be loaded with a bare `<script src>` tag the way single-file V2 is.

To bridge this, a small build step bundles the V3 module (all files VERBATIM, wrapped in a CommonJS shim that provides `require`/`module`/`exports` + a pure-JS `path.join`) into a single browser-loadable file that exposes `window.ProctorDistributionV3`:

```sh
node scripts/build-proctor-v3-bundle.js   # or: npm run build:v3-bundle
# → writes js/algorithms/proctor-v3.bundle.js
```

The bundle is deterministic (sorted module order) and regenerable; the V3 source files are never edited for the browser. `exams-proctors.html` loads it via:

```html
<script src="js/algorithms/proctor-v3.bundle.js" defer></script>
```

The renderer then routes to V3 when the toggle selects it, keeping legacy V2 behavior the default when `examDistributionRules.algorithmVersion` is absent (Acceptance Criterion 1.8):

```js
// in exams-proctors.html — window.ProctorDistributionV3 comes from the bundle
const useV3 = getSelectedAlgorithmVersion() === 'v3';
if (useV3) {
    const { result, diagnostics, orchestratorState } =
        window.ProctorDistributionV3.run(buildV3Input());
}
```

For pure-Node consumers (CLI tests, `verify:v3`, the PBT suite) the canonical entry point remains `require('./js/algorithms/proctor-v3')` — `module.exports` is primary and the `window.ProctorDistributionV3` attachment (inside `index.js`) is the secondary convenience. The browser bundle is purely a packaging artifact for the sandboxed renderer; **regenerate it whenever any V3 source file changes**.

> **Maintenance note:** `js/algorithms/proctor-v3.bundle.js` is auto-generated. Do not edit it by hand. Run `npm run build:v3-bundle` after changing any file under `js/algorithms/proctor-v3/` (or `js/data/proctor-key-resolver.js`, which the finalize phase requires).

## Roadmap

| Section | Tasks | Goal |
|---------|-------|------|
| Foundation | 1–8 | Module skeleton, PRNG, canonical key, validation, normalization, eligibility classes, bounds, load state |
| Hard constraints | 9–10 | Constraint predicates and PBT helpers |
| CP solver | 11–14 | Domain, propagators, solver core, guard placement |
| Repair phases | 15–18 | Coverage repair, same-day detection, bimodal repair, AM/PM balance |
| Reserves & finalize | 19–22 | Reserves, room synthesis, diagnostics, finalize |
| Public API | 23–24 | Orchestrator and `index.js` |
| PBT suite | 25–31 | Property-based tests for every key requirement |
| Acceptance | 32–33 | Production fixture test + `verify:v3` script |
| Renderer | 34–36 | V2/V3 toggle in `exams-proctors.html` |
| Closure | 37–38 | Final docs and close-out checks |

A "How to add a new constraint" guide is below.

## How to add a new constraint

V3 keeps constraint logic out of the orchestrator and inside a small **constraint matrix**: each constraint is a named, pure predicate (hard) or a weighted penalty term (soft), and the phases compose them. This is the single most important extension point in the module — adding a constraint should never require editing `orchestrator.js` or `index.js`. The pattern differs by constraint kind.

Before writing any code, give the constraint a stable token (the catalog uses `C-` for hard constraints and `S-` for soft ones, e.g. `C-NO-SAME-DAY`, `S-OWN-SUBJECT`). Add it to the **Constraint Catalog** in [`requirements.md`](../../../.kiro/specs/proctor-distribution-v3/requirements.md) §3 with an acceptance criterion, then to the **Constraint Matrix** in [`design.md`](../../../.kiro/specs/proctor-distribution-v3/design.md) §6 (mapping the criterion → enforcing file → phase). The matrix is the contract; the code below is its implementation.

### 1. Hard constraint (a placement is forbidden)

A hard constraint answers a yes/no "would assigning this proctor to this slot violate the rule?" question. These live in [`constraints/hard-constraints.js`](constraints/hard-constraints.js) as **pure, stateless `would*`/`is*` predicates**.

1. **Write the predicate.** Add a function alongside `isExempt`, `isOnDuty`, `wouldDoubleBookSession`, `wouldViolateSameDay`, and `wouldExceedClassUpper`. Follow the module conventions exactly:
   - Be defensive — return `false` (no evidence of violation) for malformed/missing inputs rather than throwing.
   - Look up proctors by **canonical key only**. The `(proctor, idx)`-style predicates derive the key inline via `canonicalKeyOf`; the load-state predicates take an already-canonical `key`.
   - Read normalized (canonical-keyed) Phase 1 maps (`state.normalizedExemptionsData`, `state.normalizedDutyData`, `state.normalizedMEAssignments`) — never the raw input maps.
   - If the constraint needs to know what a proctor already occupies, consult the per-entry occupancy `Set`s (`guardSessions`, `guardHalfdays`, `reserveSessions`, `reserveHalfdays`) maintained by `recordGuardOccupancy` / `recordReserveOccupancy`.
   - Export it from the module's `module.exports`.

2. **Enforce it in placement.** In [`phases/04-place-guards.js`](phases/04-place-guards.js), the constructive placer screens every candidate inside the slot loop with a chain of `continue` guards:

   ```js
   if (wouldDoubleBookSession(loadState, cand, sessionKey)) continue;
   if (wouldViolateSameDay(loadState, cand, halfdayKey, allowSameDay)) continue;
   if (wouldExceedClassUpper(loadState, cand, classBoundsForPropagator, classByProctorKey)) continue;
   // add your predicate here:
   if (wouldViolateMyNewRule(loadState, cand, /* … */)) continue;
   ```

   If your constraint is purely about per-proctor *eligibility* for a session/halfday (like exemption or duty), add the check to `eligibleKeysForRow` instead so the candidate never enters the domain.

3. **(Optional) Add a CP propagator.** The retained CP solver in [`solver/propagators.js`](solver/propagators.js) prunes domains before search (`propagateAllDifferent` for C-NO-DOUBLE, `propagateUpperBound` for class bounds, plus the custom same-day `revise` built in Phase 4). If your constraint benefits from domain pruning, add a propagator returning the standard shape `{ ok: true, changed }` or `{ ok: false, conflict }` and register it as a constraint record (`{ type, varGroup, … }` or a `{ revise }` callback) consumed by `propagateAC3`. This is optional — the constructive placer's `continue` guard is sufficient for correctness; a propagator is purely a performance optimization.

4. **Repair phases.** If a constraint can be *broken* by later swap-based repair, make the repair predicates honor it too. The coverage-repair (`phases/05-coverage-repair.js`), bimodal-repair (`phases/07-bimodal-repair.js`), and AM/PM-balance (`phases/08-ampm-balance.js`) phases compose the same hard-constraint predicates inside their `canSwap`-style checks, and reserves (`phases/09-place-reserves.js`) screens its candidate pool. Reuse the predicate so a swap can never reintroduce a violation.

5. **Unresolvable slots fail loud.** When no candidate survives the guards, the placer leaves the slot `null` and pushes `{ rowIndex, slotIndex, session_key, room_key, reason }` into `diagnostics.unresolvedSlots` — it must never silently drop coverage (Acceptance Criterion 3.12).

### 2. Soft constraint (a placement is discouraged, not forbidden)

A soft constraint is a weighted penalty used only as a **tiebreaker** among feasible candidates of equal Primary_Load, so it never perturbs the fairness distribution. The placement-time soft costs live in the cost function inside [`phases/04-place-guards.js`](phases/04-place-guards.js) (`softPenaltyFor`, mirrored by `buildCostFn` for the CP path).

1. **Add a weight constant** next to the existing ones at the top of `phases/04-place-guards.js`:

   ```js
   var W_OWN_SUBJECT = 100;   // S-OWN-SUBJECT
   var W_ROOM_REPEAT = 30;    // S-NO-ROOM-REPEAT
   var W_GENDER      = 20;    // S-GENDER
   var W_AM_PM       = 50;    // S-AM-PM
   var W_MY_NEW_RULE = 40;    // S-MY-NEW-RULE  ← new
   ```

2. **Add a penalty term** inside `softPenaltyFor(k, row, assignedKeysThisRow)` (and the equivalent accumulation in `buildCostFn`), accumulating `pen += W_MY_NEW_RULE * <severity>`. Keep it pure — read from `loadState`/`proctorByKey`/the row, mutate nothing.

3. **Tag violations for the UI.** Phase 10 (`phases/10-finalize.js`) inspects the final assignment and writes soft-violation tokens onto each row's `softViolations` array (Acceptance Criteria 6.9–6.10). Add your token there so the renderer can surface it.

4. **Dedicated balancing phase (optional).** Some soft goals are better served by a post-placement local-search phase rather than a per-slot penalty — `S-AM-PM` works this way via `phases/08-ampm-balance.js`. If your constraint needs global rebalancing, model it after that phase: a pure `stateIn → stateOut` transform that performs hard-constraint-respecting swaps and never breaks the bimodal invariant.

### 3. Register and document it

- Export any new predicate from `constraints/hard-constraints.js`.
- Update the **Constraint Catalog** in [`requirements.md`](../../../.kiro/specs/proctor-distribution-v3/requirements.md) §3 and the **Constraint Matrix** in [`design.md`](../../../.kiro/specs/proctor-distribution-v3/design.md) §6 so the new token maps to its enforcing file and phase.
- Add a property test under `tests/proctor-v3/` (hard constraints → extend `hard-constraints.test.js`; soft constraints → `soft-constraints.test.js`) asserting no result row violates the rule, annotated with the requirement it validates.
- Determinism still holds: any new comparator or candidate ordering MUST end with a canonical-key tiebreaker (`cand < bestKey`) and any iteration over object keys MUST be sorted (Acceptance Criteria 8.4–8.6).
- If you change any source file under `js/algorithms/proctor-v3/`, regenerate the browser bundle: `npm run build:v3-bundle`.

> **Boundary rule:** V2 (`js/algorithms/proctor-distribution-v2.js`) is frozen. New constraints land in V3 only (Acceptance Criterion 17.3). Never back-port a constraint into V2.
