# Design Document — Proctor Distribution V3

## Overview

تُحدّد هذه الوثيقة **التصميم التقني الكامل** لخوارزمية V3، ابتداءً من قرار اختيار الـ solver وانتهاءً بمصفوفة الـ traceability التي تربط كل acceptance criterion بمكوّن واحد محدّد في الكود.

**فلسفة التصميم**:
- **Constraints first, optimization second**: ابنِ النموذج رياضياً من القيود الصلبة قبل إضافة دوال الكلفة.
- **Pure functions, no shared module state**: كل phase تأخذ `stateIn` وتُرجِع `stateOut`. الحقول `errors`/`warnings`/`unresolvedSlots` هي **جزء من الـ state**، يُمَرَّر بين الـ phases بدلاً من أن يكون متغيّر module-level. الـ orchestrator يَدمج `stateOut` من phase كـ `stateIn` للـ phase التالية.

> **Pure-function contract — توضيح عملي**: المقصود بـ "pure" هنا هو **عدم وجود module-level أو cross-phase shared mutable state**. داخل phase واحدة، يُسمَح بـ local mutation على الـ `stateOut` المحلي قبل إرجاعه (للأداء، لتجنّب deep-clones غير ضرورية على بنى البيانات الكبيرة). ما يُمنَع تماماً:
> - تعديل `stateIn` في مكانه (يجب نسخه أو تكوين object جديد)
> - الاحتفاظ بمتغيّرات module-level بين استدعاءات `run(input)`
> - الاعتماد على ترتيب iteration غير محدّد (يجب sort صريح على keys)
>
> snippets الكود في هذه الوثيقة تستخدم أحياناً `state.diagnostics.warnings.push(...)` كاختصار — هذا مقبول داخل phase واحدة بعد نسخ `stateIn` إلى `stateOut`. التطبيق يجب أن يضمن أن `stateIn` غير معدَّل عند رجوع الدالة.
- **Fail loud, never silently**: أيّ violation للقيود الصلبة → `unresolvedSlots` + diagnostics واضحة.
- **Single canonical key**: نقطة دخول واحدة لتحويل أي مفتاح خارجي إلى `Canonical_Proctor_Key`.

**ما تُجيب عنه هذه الوثيقة**:
1. أي solver نستخدم ولماذا
2. كيف نقسّم الخوارزمية إلى phases
3. كيف يتدفّق الـ state بين الـ phases
4. كيف يُترجَم كل قيد إلى constraint رياضي
5. كيف نضمن الـ determinism
6. كيف يُختبَر كل acceptance criterion

**ما لا تُجيب عنه**: ترتيب الـ tasks (هذا في `tasks.md`).

---

## 1. Solver Choice — لماذا CP/Local-Search hybrid

### الخيارات المُقيَّمة

| الخيار | المزايا | العيوب | الحكم |
|--------|---------|--------|-------|
| **Hungarian Algorithm** (V2 الحالي) | سريع O(n³)، deterministic | لا يدعم حدود (bounds) متعدّدة، لا يصلح لـ multi-phase fairness | ❌ ثبت أنه غير كافٍ في V2 |
| **ILP (Integer Linear Programming)** عبر `glpk.js` | حلول مثلى، يحترم كل القيود الصلبة | إضافة dependency، تعقيد modeling، احتمال timeout على inputs كبيرة | ❌ يضيف dependency، التعقيد لا يبرّره |
| **MCMF (Min-Cost Max-Flow)** | كفؤ لمسائل assignment، deterministic | لا يعالج F3 (strict bimodal) مباشرةً، يحتاج post-processing مكلّف | ⚠️ ممكن لكن ليس الأنسب |
| **CP (Constraint Propagation) + Local Search** | يدمج القيود الصلبة طبيعياً، سهل التعديل، يعطي تحكّم كامل في cost function | يحتاج هندسة دقيقة لتجنّب الـ exponential blowup | ✅ **المُختار** |

### قرار: **CP + Local Search hybrid**

السبب:
- **القيود غير متجانسة**: عندنا 8 قيود صلبة + 4 لينة + bimodal histogram + per-class bounds. ILP modeling لها معقّد بشكل غير متناسب مع الفائدة.
- **حجم الـ input صغير-متوسط**: 147 مراقب × 30 جلسة = ~4400 متغيّر. CP propagation كافٍ لتقليصه إلى دقائق معقولة.
- **Time budget = 30s**: يسمح بـ Local Search post-CP لتحسين الـ soft constraints.
- **بدون dependency جديدة**: CP يُنفَّذ من الصفر في JavaScript نقي.

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Orchestrator_V3.run(input)                                   │
│                                                                │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Phase 0 │→ │ Phase 1  │→ │ Phase 2  │→ │  Phase 3     │  │
│  │ Validate│  │ Normalize│  │ Classify │  │ Compute      │  │
│  │ Input   │  │  Keys    │  │ Eligibil.│  │ Bounds       │  │
│  └─────────┘  └──────────┘  └──────────┘  └──────────────┘  │
│                                                  ↓            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Phase 4     │← │  Phase 5     │← │  Phase 6         │   │
│  │  Place       │  │  Multi-Step  │  │  Same-Day        │   │
│  │  Guards (CP) │  │  Coverage    │  │  Infeasibility   │   │
│  │              │  │  Repair      │  │  Detection       │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│         ↓                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  Phase 7     │→ │  Phase 8     │→ │  Phase 9         │   │
│  │  Bimodal     │  │  AM/PM       │  │  Place           │   │
│  │  Repair (LS) │  │  Balance LS  │  │  Reserves        │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│                                              ↓                │
│                              ┌──────────────────────────────┐ │
│                              │  Phase 10: Finalize          │ │
│                              │  - softViolations tagging    │ │
│                              │  - diagnostics aggregation   │ │
│                              │  - JSON serialization check  │ │
│                              └──────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

كل phase: **pure function** بتوقيع `phaseN(stateIn, ctx) → stateOut`.

---

## 2. Module Structure

```
js/algorithms/proctor-v3/
├── index.js                       # Public API: run(input) → output
├── README.md                      # Public API documentation
├── orchestrator.js                # Phase pipeline orchestration
├── canonical-key.js               # Canonical_Proctor_Key + Key_Adapter
├── constraints/
│   ├── hard-constraints.js        # C1, C-EXEMPT, C-DUTY, C-ME, etc.
│   ├── soft-constraints.js        # S-OWN-SUBJECT, S-AM-PM, etc.
│   └── bounds.js                  # Class_Lower_Bound / Class_Upper_Bound
├── phases/
│   ├── 00-validate.js
│   ├── 01-normalize-keys.js
│   ├── 02-eligibility-classes.js
│   ├── 03-bounds.js
│   ├── 04-place-guards.js         # CP solver
│   ├── 05-coverage-repair.js      # Multi-step repair
│   ├── 06-same-day-detect.js
│   ├── 07-bimodal-repair.js       # Local Search
│   ├── 08-ampm-balance.js         # Local Search
│   ├── 09-place-reserves.js
│   └── 10-finalize.js
├── solver/
│   ├── cp-solver.js               # Constraint propagation engine
│   ├── domain.js                  # Domain object (set of allowed values per var)
│   └── propagators.js             # AC-3 + custom propagators
├── search/
│   ├── local-search.js            # Generic local search (swap-based)
│   └── neighborhoods.js           # Swap neighborhood generators
├── utils/
│   ├── prng.js                    # Seeded PRNG (xorshift32 or mulberry32)
│   ├── histogram.js               # Histogram computation utilities
│   └── load-state.js              # Load state operations
└── diagnostics.js                 # Diagnostics aggregation

tests/
├── fixtures/
│   └── 45454.json                 # Production fixture (existing)
└── proctor-v3/
    ├── canonical-key.test.js      # Property tests for Req 2
    ├── hard-constraints.test.js   # Property tests for Req 3
    ├── bounds.test.js             # Property tests for Req 5
    ├── soft-constraints.test.js   # Property tests for Req 6
    ├── reserves.test.js           # Property tests for Req 7
    ├── determinism.test.js        # Property tests for Req 8
    ├── round-trip.test.js         # Property tests for Req 10
    ├── exam-center-levels.test.js # Property tests for Req 11
    ├── production-fixture.test.js # Acceptance for Req 15
    └── pbt-helpers.js             # Arbitrary generators
```

**حجم متوقع**: ~3000 سطر JS موزّعة على 25 ملف، أصغر من V2 (4788 سطر في ملف واحد) رغم زيادة الميزات.

---

## 3. Data Flow & State Schema

### 3.1 Input (GS3_Input_Contract)

نفس عقد V2 بالضبط:
```typescript
interface GS3Input {
  proctorsList: Proctor[];
  scheduleEntries: ScheduleEntry[];
  exemptionsData: { [sessionKey: string]: { [proctorKey: string]: 'no' } };
  dutyData: { [dutyKey: string]: { [proctorKey: string]: true } };
  meAssignments: { [groupId: string]: { [proctorKey: string]: true } };
  examDistributionRules: {
    proctorsPerRoom: number;
    reservesPerSession?: number;
    allowSameDayBothHalfdays?: boolean;  // Same_Day_Allowance_Flag
  };
  reservesConfig?: { mode: 'fixed' | 'percent'; fixed?: number; percent?: number };  // legacy/optional; if present, takes precedence over examCenterConfig.max_reserves*
  examCenterConfig: {
    expected_duty_tasks?: number;
    max_reserves_mode?: 'fixed' | 'percent';
    max_reserves?: number;
    max_reserves_percent?: number;
  };
  examCenterLevels: { [levelName: string]: { rooms: number; sessions: number } };
  examCenterRoomsData: { [levelName: string]: RoomRow[] };
  randomSeed?: number;
  weightsPreset?: string;
  customWeights?: WeightOverrides;
  options?: Object;
}
```

### 3.2 Internal State (passed between phases)

```typescript
interface PipelineState {
  // Immutable inputs (frozen after Phase 1)
  input: GS3Input;
  rng: SeededPRNG;
  
  // Computed in Phase 1
  proctors: NormalizedProctor[];          // with canonicalKey
  keyAdapter: { [externalKey]: canonicalKey | null };
  orphanInputKeys: string[];
  
  // Computed in Phase 2
  classes: EligibilityClass[];
  classByProctorKey: { [canonicalKey: string]: classId };
  
  // Computed in Phase 3
  globalLowerBound: number;
  globalUpperBound: number;
  classBounds: { [classId: string]: { lower: number; upper: number; size: number } };
  
  // Computed/mutated in Phases 4–8
  rows: ResultRow[];                       // session×room rows
  loadState: { [canonicalKey: string]: { 
    guardCount: number; 
    reserveCount: number; 
    dutyCount: number;
    guardHalfdays: Set<halfdayKey>;
    guardDays: Set<dayKey>;
    guardSessions: Set<sessionKey>;
    amCount: number;
    pmCount: number;
  }};
  
  // Phase 9 reserves
  // (mutates rows[i].reserve_keys and rows[i].reserves)
  
  // Phase 10 diagnostics
  diagnostics: DiagnosticsV3;
}
```

### 3.3 Output

```typescript
interface V3Output {
  result: ResultRow[];
  diagnostics: DiagnosticsV3;
  algorithmVersion: 'v3';
}

interface ResultRow {
  session_key: string;
  halfday_key: string;
  day_key: string;
  room_key: string;
  room_name: string;
  proctors: string[];          // display names, fresh array
  proctor_keys: (string|null)[]; // canonical keys, fresh array
  reserves: string[];           // fresh array
  reserve_keys: string[];       // fresh array
  duty_teachers: string[];      // fresh array
  softViolations: string[];     // tokens
  notes: string;
}
```

---

## 4. Phase-by-Phase Design

### Phase 0: Validate Input
**File**: `phases/00-validate.js`
**Pure**: ✅
**Time budget**: 100ms

**Responsibilities**:
- Check required fields exist (`proctorsList`, `scheduleEntries`, etc.)
- Validate types (arrays, objects, numbers)
- Check for empty `proctorsList` or `scheduleEntries` (return early with error)
- Validate `examCenterLevels` structure

**Output**: validated input or early error in `diagnostics.errors`.

**Acceptance criteria covered**: 1.3, 9.7

---

### Phase 1: Normalize Keys
**File**: `phases/01-normalize-keys.js`, `canonical-key.js`
**Pure**: ✅
**Time budget**: 200ms

**Responsibilities**:
1. Compute `canonicalKey` for each proctor: `proc.cin?.trim() || '__idx_' + idx`
2. Build `keyAdapter` mapping every external key (`cin`, `som`, `idx_N`, `__idx_N`) to its canonical form
3. Translate all entries in `dutyData`, `exemptionsData`, `meAssignments` to canonical keys
4. Drop unresolvable keys → `orphanInputKeys`

**Single Identity Function** (Acceptance Criterion 2.1):
```javascript
function canonicalProctorKey(proc, idx) {
  const cin = (proc?.cin ?? '').trim();
  return cin || '__idx_' + idx;
}
```

**Key Adapter** (Acceptance Criterion 2.3):
```javascript
function buildKeyAdapter(proctorsList) {
  const map = {};
  proctorsList.forEach((proc, idx) => {
    const canonical = canonicalProctorKey(proc, idx);
    if (proc.cin?.trim()) map[proc.cin.trim()] = canonical;
    if (proc.som?.trim()) map[proc.som.trim()] = canonical;
    map['idx_' + idx] = canonical;
    map['__idx_' + idx] = canonical;
    map[canonical] = canonical; // identity
  });
  return map;
}

function toCanonical(adapter, externalKey) {
  return adapter[externalKey?.trim()] ?? null;
}
```

**Acceptance criteria covered**: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7

---

### Phase 1b: Build Rooms and Empty Result Rows
**File**: `phases/01b-build-rooms-and-rows.js`
**Pure**: ✅
**Time budget**: 200ms

**Responsibilities**:
1. For each level `L` referenced in `scheduleEntries`, derive `rooms_count(L)` primarily from `examCenterLevels[L].rooms`, falling back to `examCenterRoomsData[L]` rows.
2. WHEN `examCenterLevels[L].rooms = N > examCenterRoomsData[L].length = M`, synthesize `(N − M)` in-memory placeholder room objects numbered sequentially. Record `{ type: 'synthetic_rooms', level: L, addedCount: N − M }` in `diagnostics.warnings`.
3. WHEN `examCenterLevels` is absent, fall back to `examCenterRoomsData` with `{ type: 'exam_center_levels_missing' }` warning.
4. For each `(scheduleEntry, room)` pair, construct an **empty Result_Row** with: `session_key, halfday_key, day_key, room_key, room_name`, AND `proctor_keys` = array of length `proctorsPerRoom` filled with `null`, AND empty `proctors`, `reserves`, `reserve_keys`, `duty_teachers`, `softViolations`.
5. Validate that total guard slots match `Σ rooms_count(L) × sessions_count(L) × proctorsPerRoom`; emit `level_slot_mismatch` warning otherwise.
6. Synthesized rooms SHALL NEVER be persisted.

**Why a separate phase?** Phase 4 (CP solver) and downstream phases consume `state.rows`. Building the rows in Phase 1b lets the CP solver treat `state.rows[i].proctor_keys[j]` as the variable space directly. An earlier draft buried this in Phase 1, but mixing key-translation with row-construction obscured the data flow.

**Acceptance criteria covered**: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6

---

### Phase 2: Eligibility Classes
**File**: `phases/02-eligibility-classes.js`
**Pure**: ✅
**Time budget**: 500ms

**Responsibilities**:
1. For each proctor `T`, compute the set:
   - `eligibleSessions(T)`: sessions where T is not exempt, not on duty, not ME-blocked
   - `dutyHalfdays(T)`: halfdays where T has duty
   - `meGroup(T)`: ME group assignment if any
2. Two proctors `T1`, `T2` are in the **same class** iff their tuple `(eligibleSessions, dutyHalfdays, meGroup)` is bitwise equal
3. Build `classes[]` array and `classByProctorKey` map

**Implementation**: hash each tuple as a stable string, group proctors by hash.

**Acceptance criteria covered**: 5.3, 5.4, 5.5, 5.14 (classBoundsByProctorKey)

---

### Phase 3: Compute Bounds
**File**: `phases/03-bounds.js`, `constraints/bounds.js`
**Pure**: ✅
**Time budget**: 100ms

**Responsibilities**:
1. Compute `G_Total_Slots = Σ scheduleEntries[i].rooms_count × proctorsPerRoom`
2. Compute `D_Expected = examCenterConfig.expected_duty_tasks ?? 0`
3. Compute `N_Eligible = |eligible proctors|`
4. Compute `Global_Lower_Bound = floor((G_Total_Slots + D_Expected) / N_Eligible)`
5. Compute `Global_Upper_Bound = Global_Lower_Bound + 1`
6. For each class `c`, compute `Class_Lower_Bound(c)` and `Class_Upper_Bound(c)` capped at globals (with monotonicity guard from Acceptance Criterion 5.5)

**Class Bound Algorithm**:
```javascript
function computeClassBounds(classes, globalLower, globalUpper, dutyByClass, slotsByClass) {
  const bounds = {};
  for (const c of classes) {
    const G_class = slotsByClass[c.id];           // sessions × rooms × proctorsPerRoom restricted to c
    const D_class = dutyByClass[c.id];             // total duty in c
    const total = G_class + D_class;
    const naturalLower = Math.floor(total / c.size);
    const naturalUpper = Math.ceil(total / c.size);
    
    // Monotonicity guard (Acceptance Criterion 5.5)
    if (total <= globalLower) {
      bounds[c.id] = {
        lower: total,           // singleton or very small class with low total
        upper: Math.min(naturalUpper, globalUpper + 1),
        size: c.size,
      };
    } else {
      bounds[c.id] = {
        lower: Math.min(naturalLower, globalUpper),
        upper: Math.min(naturalUpper, globalUpper + 1),
        size: c.size,
      };
    }
  }
  return bounds;
}
```

**Acceptance criteria covered**: 5.2, 5.3, 5.4, 5.5

---

### Phase 4: Place Guards (CP Solver)
**File**: `phases/04-place-guards.js`, `solver/cp-solver.js`, `solver/propagators.js`
**Pure**: ✅
**Time budget**: 15 seconds (largest budget — heart of the algorithm)

**Model**:
- **Variables**: `X[entry_idx][room_idx][slot_idx]` for each guard slot. Domain = subset of canonical keys.
- **Constraints**:
  - **Eligibility** (C-EXEMPT, C-DUTY, C-ME): only proctors satisfying these may appear in domain
  - **C-NO-DOUBLE**: AllDifferent on `proctor_keys` within a row, and across rows of same `session_key`
  - **C-NO-SAME-DAY**: pairwise constraint on (X[entry1], X[entry2]) when entries share `day_key` and `Same_Day_Allowance_Flag === false`
  - **Class upper bound** (slot-based on guards only): for each canonical key K, the count of K across all X variables SHALL be `≤ Class_Upper_Bound(class(K)) − Duty_Count(K)` — because `Primary_Load = Guard_Count + Duty_Count` and Duty_Count is fixed before Phase 4. **NOT** simply `count ≤ Class_Upper_Bound`.
  - **Per-class lower bound** (best-effort): count of canonical key K across all X variables ≥ `Class_Lower_Bound(class(K)) − Duty_Count(K)` (because Primary_Load includes duty)

**Solver**: AC-3 propagation + DFS with smallest-domain-first heuristic + value ordering (least-constrained-value).

**Cost function** (for tie-breaking among feasible assignments):
```
cost(assignment) = Σ_assignment [
  W_OWN_SUBJECT × (proctor.subject == entry.subject_name ? 1 : 0) +
  W_ROOM_REPEAT × (proctor already used this room? 1 : 0) +
  W_GENDER × (gender pair imbalance) +
  W_AM_PM × (AM_PM_Imbalance(proctor) updated)
]
```

Default weights: `W_OWN_SUBJECT=100, W_ROOM_REPEAT=30, W_GENDER=20, W_AM_PM=50`.

**Output**: `rows[]` with `proctor_keys` filled (or `null` for unresolved slots). `loadState` updated.

**Acceptance criteria covered**: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.10, 5.6, 5.7 (initial), 5.9, 6.1, 6.4, 6.7, 6.8

---

### Phase 5: Multi-Step Coverage Repair
**File**: `phases/05-coverage-repair.js`
**Pure**: ✅
**Time budget**: 5 seconds

**Algorithm**:
```javascript
function multiStepCoverageRepair(state) {
  let totalSwaps = 0;
  const unresolved = [];
  
  // Sort uncovered proctors deterministically by canonicalKey
  const uncovered = Object.entries(state.loadState)
    .filter(([k, ld]) => primaryLoad(ld) < state.classBounds[state.classByProctorKey[k]].lower)
    .sort(([k1], [k2]) => (k1 < k2 ? -1 : k1 > k2 ? 1 : 0))  // pure code-point order, locale-independent
    .map(([k]) => k);
  
  for (const uKey of uncovered) {
    const targetLoad = state.classBounds[state.classByProctorKey[uKey]].lower;
    let attempts = 0;
    const maxAttempts = targetLoad - primaryLoad(state.loadState[uKey]) + 5; // safety margin
    
    while (primaryLoad(state.loadState[uKey]) < targetLoad && attempts++ < maxAttempts) {
      const swap = findSwap(state, uKey);
      if (!swap) break;
      applySwap(state, swap);
      totalSwaps++;
    }
    
    if (primaryLoad(state.loadState[uKey]) < targetLoad) {
      unresolved.push({ canonicalKey: uKey, ... });
    }
  }
  
  return { totalSwaps, unresolved };
}

function findSwap(state, uncoveredKey) {
  // Find (row, slot) where:
  //   - row.proctor_keys[slot] = donorKey, donor is overloaded (current load > donor's class lower)
  //   - uncoveredKey is eligible for this row's session and not currently in row
  //   - swap respects all hard constraints (incl. C-NO-SAME-DAY, AllDifferent)
  //   - swap respects donor's lower bound (Acceptance Criterion 5.12)
  for (const row of state.rows) {
    for (let slot = 0; slot < row.proctor_keys.length; slot++) {
      const donorKey = row.proctor_keys[slot];
      if (!donorKey) continue;
      if (canSwap(state, row, slot, donorKey, uncoveredKey)) {
        return { row, slot, donorKey, recipientKey: uncoveredKey };
      }
    }
  }
  return null;
}
```

**Critical guard**: `canSwap` MUST check that demoting the donor doesn't push them below `Class_Lower_Bound`.

**Acceptance criteria covered**: 5.11, 5.12, 5.13

---

### Phase 6: Same-Day Infeasibility Detection
**File**: `phases/06-same-day-detect.js`
**Pure**: ⚠️ **Conditionally Pure** — see note below
**Time budget**: 200ms (inspection) + up to 7s (CONDITIONAL pre-check, only when triggered)

**Note on purity**: The inspection portion is a pure function `inspectUnresolvedSlots(state) → state'`. The conditional pre-check, however, requires re-running Phases 4 and 5. To preserve the pure-function contract for individual phases, the **pre-check is invoked by the Orchestrator, not by Phase 6 itself**. Phase 6 only **decides whether** the pre-check is needed and exposes that decision in `state.diagnostics.preCheckRequired`. The Orchestrator reads this flag and, if true, executes the pre-check sub-pipeline (Phase 4 + Phase 5 with `allowSameDayBothHalfdays: true`) and merges the resulting diagnostics back. This keeps every phase a pure transformation while allowing the orchestrator to compose the conditional logic.

**Pseudocode (Phase 6 alone — pure)**:
```javascript
function detectSameDayInfeasibility(state, ctx) {
  const stateOut = { ...state, diagnostics: { ...state.diagnostics } };
  
  // If flag already enabled, no pre-check ever needed (AC 4.2b)
  if (state.input.examDistributionRules.allowSameDayBothHalfdays) {
    stateOut.diagnostics.preCheckRequired = false;
    return stateOut;
  }
  
  // If full coverage achieved, no pre-check needed
  if (state.diagnostics.unresolvedSlots.length === 0) {
    stateOut.diagnostics.preCheckRequired = false;
    return stateOut;
  }
  
  // Mark for pre-check; Orchestrator will perform it if budget allows
  stateOut.diagnostics.preCheckRequired = true;
  stateOut.diagnostics.preCheckUnresolvedCount = state.diagnostics.unresolvedSlots.length;
  return stateOut;
}
```

**Pseudocode (Orchestrator — composes Phase 6 + conditional pre-check)**:
```javascript
function runOrchestrator(input) {
  let state = initialState(input);
  state = phase0Validate(state);
  state = phase1NormalizeKeys(state);
  // ...
  state = phase4PlaceGuards(state);
  state = phase5CoverageRepair(state);
  state = phase6DetectSameDayInfeasibility(state);
  
  // Conditional pre-check at orchestrator level (NOT inside Phase 6)
  if (state.diagnostics.preCheckRequired && remainingBudget(ctx) >= 7000) {
    const relaxedInput = {
      ...state.input,
      examDistributionRules: { ...state.input.examDistributionRules, allowSameDayBothHalfdays: true }
    };
    let relaxedState = initialState(relaxedInput);
    relaxedState = phase1NormalizeKeys(relaxedState);
    // ... (run minimum required phases)
    relaxedState = phase4PlaceGuards(relaxedState, { timeBudget: 5000 });
    relaxedState = phase5CoverageRepair(relaxedState, { timeBudget: 2000 });
    
    if (relaxedState.diagnostics.unresolvedSlots.length === 0) {
      // Strict failed BUT relaxed succeeded → same-day is the cause (AC 4.2)
      state.diagnostics.warnings.push({
        type: 'same_day_relaxation_suggested',
        impactedSlotsCount: state.diagnostics.preCheckUnresolvedCount,
        message: 'غير ممكن التغطية بدون السماح بحراسة نفس الأستاذ صباحاً ومساءً في نفس اليوم. هل تريد تفعيل هذا الخيار؟'
      });
    } else {
      // Both strict AND relaxed failed (AC 4.2a)
      state.diagnostics.warnings.push({
        type: 'coverage_infeasible_regardless',
        impactedSlotsCount: state.diagnostics.preCheckUnresolvedCount,
        message: 'التغطية الكاملة غير ممكنة حتى مع تفعيل السماح بنفس اليوم — راجع عدد الأساتذة أو الإعفاءات.'
      });
    }
  }
  
  state = phase7BimodalRepair(state);
  state = phase8AmPmBalance(state);
  state = phase9PlaceReserves(state);
  state = phase10Finalize(state);
  return state.result;
}
```

The renderer in `exams-proctors.html` listens for warning type `same_day_relaxation_suggested` and shows the confirmation dialog.

**Acceptance criteria covered**: 4.1, 4.2, 4.2a, 4.2b, 4.6

---

### Phase 7: Bimodal Repair (Local Search)
**File**: `phases/07-bimodal-repair.js`, `search/local-search.js`
**Pure**: ✅
**Time budget**: 5 seconds

**Goal**: Enforce Acceptance Criterion 5.7 (strict bimodal histogram).

**Algorithm**:
```javascript
function bimodalRepair(state) {
  while (timeRemaining() && !isBimodal(state)) {
    const histogram = computeHistogramByPrimaryLoad(state.loadState, state.classByProctorKey);
    const violators = findHistogramViolators(histogram);  // proctors at extreme keys
    
    let improved = false;
    for (const violator of violators) {
      const swap = findRebalancingSwap(state, violator);
      if (swap) {
        applySwap(state, swap);
        improved = true;
        break;
      }
    }
    
    if (!improved) break; // local minimum, give up
  }
  
  if (!isBimodal(state)) {
    state.diagnostics.errors.push({
      type: 'fairness_violation',
      histogram: computeHistogramByPrimaryLoad(state.loadState, state.classByProctorKey),
      message: 'Histogram is not strict bimodal'
    });
  }
}

function isBimodal(state) {
  const histogram = computeHistogramByPrimaryLoad(state.loadState, state.classByProctorKey);
  const keys = Object.keys(histogram).map(Number).sort((a,b)=>a-b);
  if (keys.length === 0) return true; // empty
  if (keys.length === 1) return true; // {k: N}
  if (keys.length === 2) return keys[1] - keys[0] === 1; // {k, k+1}
  return false; // 3+ distinct keys: violates F3
}
```

**Acceptance criteria covered**: 5.7, 5.8

---

### Phase 8: AM/PM Balance (Local Search)
**File**: `phases/08-ampm-balance.js`
**Pure**: ✅
**Time budget**: 3 seconds

**Goal**: Reduce `AM_PM_Imbalance(T)` for proctors with `imbalance ≥ 2`, without breaking any hard constraint or bimodal invariant.

**Algorithm**: Greedy swap — for each proctor with high imbalance, find a swap that converts their AM slot to PM (or vice versa) by trading with another proctor.

**Acceptance criteria covered**: 6.4, 6.5, 6.6

---

### Phase 9: Place Reserves
**File**: `phases/09-place-reserves.js`
**Pure**: ✅
**Time budget**: 1 second

**Algorithm** (per Requirement 7):
1. For each session `S`, determine `target_reserves(S)` from `Reserves_Config`.
2. Build candidate pool: proctors not already guarding `S`, not exempt/duty/ME-blocked, satisfying C-NO-SAME-DAY.
3. Sort candidates by `(Reserve_Count(T) ASC, affinityRank ASC, Final_Load(T) ASC, canonicalKey ASC)`.
4. Pick top `target_reserves(S)` candidates.
5. Update `loadState` (increment `reserveCount`, add to `guardHalfdays`/`guardDays` for reuse-policy purposes).

**Acceptance criteria covered**: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9

---

### Phase 10: Finalize
**File**: `phases/10-finalize.js`, `diagnostics.js`
**Pure**: ✅
**Time budget**: 200ms

**Responsibilities**:
1. Tag `softViolations` on each row by inspecting final assignments
2. Build `proctors[]` and `reserves[]` display names from `proctor_keys` and `reserve_keys` via key resolver
3. Aggregate diagnostics (histogram, distinctCount, etc.)
4. Verify JSON-serializability (call `JSON.stringify(output)` and catch errors)
5. **Verify all rows have fresh non-shared array references** (Acceptance Criterion 10.2): structural deep-clone safety check

**Diagnostics builder**:
```javascript
function buildDiagnostics(state) {
  // Two distinct histograms (Acceptance Criteria 9.2, 9.3, 9.3a)
  const histogramByGuardCount = computeHistogramByGuardCount(state.rows);
  const histogramByPrimaryLoad = computeHistogramByPrimaryLoad(state.loadState, state.classByProctorKey);
  
  // min/max/distinct refer to histogramByPrimaryLoad (the fairness axis, AC 5.7)
  const primaryLoads = Object.entries(histogramByPrimaryLoad)
    .flatMap(([load, count]) => Array(count).fill(Number(load)));
  
  return {
    algorithmVersion: 'v3',
    seedUsed: state.rng.seed,
    totalDurationMs: now() - state.startTime,
    phaseDurations: state.phaseDurations,
    
    // Two histograms (AC 9.3, 9.3a, 9.3b)
    histogramByGuardCount,
    histogramByPrimaryLoad,
    
    // Stats over Primary_Load (the fairness axis)
    min: primaryLoads.length ? Math.min(...primaryLoads) : 0,
    max: primaryLoads.length ? Math.max(...primaryLoads) : 0,
    distinctCount: countDistinctProctors(state.rows),
    
    globalLowerBound: state.globalLowerBound,
    globalUpperBound: state.globalUpperBound,
    classBoundsByProctorKey: state.classBoundsByProctorKey,
    
    unresolvedSlots: state.unresolvedSlots,
    coverageWarnings: state.coverageWarnings,
    coverageRepairSwaps: state.coverageRepairSwaps,
    coverageRepairUnresolved: state.coverageRepairUnresolved,
    
    orphanInputKeys: state.orphanInputKeys,
    amPmImbalanceByProctorKey: computeAmPmImbalances(state.loadState),
    
    // Best-effort diagnostics (AC 5.10, AC 7.8)
    zeroLoadProctors: computeZeroLoadProctors(state.loadState, state.classByProctorKey),
    reserveImbalances: computeReserveImbalances(state.loadState, state.classByProctorKey),
    
    warnings: state.warnings,
    errors: state.errors,
  };
}
```

**Helper functions**:
- `computeHistogramByGuardCount(rows)` — counts canonical key occurrences in `proctor_keys` only (slot-based)
- `computeHistogramByPrimaryLoad(loadState, classByProctorKey)` — counts proctors at each Primary_Load value (Guard_Count + Duty_Count)
- `computeZeroLoadProctors(loadState, classByProctorKey)` — returns array of `{ canonicalKey, classId, reason }` for every eligible proctor with `Primary_Load === 0` (AC 5.10)
- `computeReserveImbalances(loadState, classByProctorKey)` — returns array of `{ overloadedKey, underloadedKey, deltaCount, blockingReason }` for reserve fairness deviations (AC 7.8)

**Acceptance criteria covered**: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 10.1, 10.2, 13.1–13.5

---

## 5. Determinism Strategy

### Sources of Non-Determinism (and their mitigations)

| Source | Mitigation |
|--------|-----------|
| `Object.keys()` order | All iterations sort keys explicitly: `Object.keys(obj).sort()` |
| `Math.random()` | Replaced by `state.rng.next()` (seeded mulberry32) |
| `Array.prototype.sort` (engine-dependent for ties) | Every comparator ends with a pure code-point comparison: `a < b ? -1 : a > b ? 1 : 0` over canonical key strings (NOT `localeCompare`, which is locale-dependent across Node versions and platforms) |
| `Date.now()` | Only used to seed PRNG when `randomSeed` absent (recorded in `diagnostics.seedUsed`) |
| `Set` / `Map` insertion order | Replaced by sorted arrays where iteration order matters |

### Seeded PRNG (mulberry32)

```javascript
function createPRNG(seed) {
  let state = seed >>> 0;
  return {
    seed,
    next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(n) {
      return Math.floor(this.next() * n);
    }
  };
}
```

**Acceptance criteria covered**: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6

---

## 6. Constraint Matrix (Requirements ↔ Components)

This table maps every Acceptance Criterion to the file(s) responsible for enforcing it.

| Requirement | Acceptance Criteria | File(s) | Phase |
|-------------|--------------------|---------|---------|
| **R1: Module Boundary** | 1.1, 1.2, 1.9, 1.10 | `index.js`, `package.json` | — |
| | 1.3, 1.4, 1.14 | `orchestrator.js` | All |
| | 1.5, 1.6, 1.7, 1.8 | `exams-proctors.html` (renderer) | — |
| | 1.11, 1.12, 1.13 | `package.json`, `tests/proctor-v3/*` | — |
| **R2: Canonical Key** | 2.1, 2.2 | `canonical-key.js` | Phase 1 |
| | 2.3, 2.4 | `canonical-key.js` (Key_Adapter) | Phase 1 |
| | 2.5, 2.6, 2.7, 2.8 | `phases/04-place-guards.js`, `phases/09-place-reserves.js` | Phase 4, 9 |
| | 2.9 (duplicate CIN detection) | `canonical-key.js` (Key_Adapter), `orchestrator.js` | Phase 1 |
| **R3: Hard Constraints** | 3.1 (C1) | `phases/04-place-guards.js` | Phase 4 |
| | 3.2 (C-EXEMPT) | `constraints/hard-constraints.js` | Phase 2, 4, 5, 9 |
| | 3.3 (C-DUTY) | `constraints/hard-constraints.js` | Phase 2, 4, 5, 9 |
| | 3.4 (C-ME) | `constraints/hard-constraints.js` | Phase 2, 4, 5, 9 |
| | 3.5, 3.6 (C-NO-DOUBLE) | `constraints/hard-constraints.js` (`wouldDoubleBookSession`, active), `solver/propagators.js` (`propagateAllDifferent`, retained) | Phase 4, 5, 9 |
| | 3.7, 3.7a, 3.8, 3.9, 3.10 (C-NO-SAME-DAY) | `constraints/hard-constraints.js` (`wouldViolateSameDay`), `phases/04-place-guards.js` (same-day revise) | Phase 4, 5, 9 |
| | 3.11 (C-RESERVES-SEPARATE) | `phases/09-place-reserves.js` | Phase 9 |
| | 3.12, 3.13 (failure handling) | `phases/04-place-guards.js`, `phases/05-coverage-repair.js`, `orchestrator.js`, `diagnostics.js` | Phase 4, 5, 10 |
| **R4: Same-Day Flag** | 4.1, 4.5 | `examDistributionRules` schema (no change) | — |
| | 4.2, 4.2a, 4.2b, 4.6 | `phases/06-same-day-detect.js` (pure inspection), `orchestrator.js` (conditional pre-check) | Phase 6 |
| | 4.3, 4.4 | `exams-proctors.html` (renderer) | — |
| **R5: Fairness** | 5.1 (Primary_Load) | `utils/load-state.js` | All |
| | 5.2, 5.3, 5.4, 5.5 (bounds) | `constraints/bounds.js`, `phases/03-bounds.js` | Phase 3 |
| | 5.6, 5.9 (bound enforcement) | `constraints/hard-constraints.js` (`wouldExceedClassUpper`, active), `solver/propagators.js` (`propagateUpperBound`, retained), `phases/04-place-guards.js` | Phase 4 |
| | 5.7, 5.8 (bimodal) | `phases/07-bimodal-repair.js` | Phase 7 |
| | 5.10 (baseline coverage / zero-load) | `phases/05-coverage-repair.js`, `diagnostics.js` (`computeZeroLoadProctors`) | Phase 5, 10 |
| | 5.11, 5.12 (multi-step repair) | `phases/05-coverage-repair.js` | Phase 5 |
| | 5.13, 5.14 (diagnostics) | `phases/05`, `diagnostics.js` | Phase 5, 10 |
| **R6: Soft Constraints** | 6.1, 6.2, 6.3 (S-OWN-SUBJECT) | `phases/04-place-guards.js` (cost fn), `phases/10-finalize.js` (6.2 tagging) | Phase 4, 10 |
| | 6.4, 6.5, 6.6 (S-AM-PM) | `phases/04-place-guards.js` (cost fn), `phases/08-ampm-balance.js` | Phase 4, 8 |
| | 6.7 (S-NO-ROOM-REPEAT) | `phases/04-place-guards.js` (cost fn) | Phase 4 |
| | 6.8 (S-GENDER) | `phases/04-place-guards.js` (cost fn) | Phase 4 |
| | 6.9, 6.10 (tagging) | `phases/10-finalize.js` | Phase 10 |
| **R7: Reserves** | 7.1, 7.2, 7.3 (config) | `phases/09-place-reserves.js` | Phase 9 |
| | 7.4, 7.4a, 7.5, 7.6, 7.7, 7.9 | `phases/09-place-reserves.js` | Phase 9 |
| | 7.8 (reserve-imbalance diagnostics) | `phases/09-place-reserves.js`, `diagnostics.js` (`computeReserveImbalances`) | Phase 9, 10 |
| **R8: Determinism** | 8.1, 8.2, 8.3 (seed) | `utils/prng.js`, `orchestrator.js` | All |
| | 8.4 (reproducibility) | All phases (sorted iteration, total-order sort) | All |
| | 8.5 (no Object.keys without sort) | All phases (lint rule? code review) | All |
| | 8.6 (stable sort) | All comparators end with canonicalKey | All |
| **R9: Diagnostics** | 9.1–9.8 | `diagnostics.js`, `phases/10-finalize.js` | Phase 10 |
| **R10: Round-Trip** | 10.1 (JSON-safe) | `phases/10-finalize.js` (verification step) | Phase 10 |
| | 10.2 (no shared refs) | `phases/10-finalize.js` (deep-clone check) | Phase 10 |
| | 10.3, 10.4, 10.5 | display layer compatibility (existing code) | — |
| **R11: Exam Center Levels** | 11.1, 11.2, 11.3, 11.4, 11.5, 11.6 | `phases/01b-build-rooms-and-rows.js` (room synthesis) | Phase 1b |
| **R12: Phase Structure** | 12.1, 12.2, 12.3 | `orchestrator.js` (architecture) | All |
| | 12.4 (post-placement guards) | `phases/05`, `phases/07`, `phases/08`, `phases/09` | Phase 5, 7, 8, 9 |
| | 12.5 (exception handling) | `orchestrator.js` (try/catch wrapper per phase) | All |
| | 12.6 (time budget) | `orchestrator.js` (global timer + per-phase timer) | All |
| **R13: Backward Compat** | 13.1–13.6 | `phases/10-finalize.js` (output shape) | Phase 10 |
| **R14: PBT Suite** | 14.1–14.10 | `tests/proctor-v3/*.test.js` | — |
| **R15: Production Fixture** | 15.1–15.9 | `tests/proctor-v3/production-fixture.test.js` | — |
| **R16: Migration** | 16.1–16.6 | `package.json`, `exams-proctors.html` (renderer) | — |
| **R17: Documentation** | 17.1–17.5 | `design.md`, `README.md`, `tasks.md` | — |

---

## 7. Test Surface (PBT Suite Mapping)

Each Acceptance Criterion in Requirement 14 is tested by exactly one property test. Each test is parametrized with at least 100 random inputs from `tests/proctor-v3/pbt-helpers.js`.

| Test File | Targets ACs | Property Tested |
|-----------|------------|-----------------|
| `canonical-key.test.js` | 2.1, 2.2, 2.5, 2.6, 2.7, 14.1 | Every key in result ∈ canonical key set |
| `hard-constraints.test.js` | 3.1–3.13, 14.2 | No row violates any hard constraint |
| `bounds.test.js` | 5.2–5.6, 5.9, 14.3 | `lower ≤ Primary_Load(T) ≤ upper` for every eligible T |
| `bimodal.test.js` | 5.7, 5.8, 14.4 | Histogram is strict bimodal OR errors recorded |
| `coverage-repair.test.js` | 5.10–5.13 | Multi-step repair converges or reports unresolved |
| `soft-constraints.test.js` | 6.1–6.10 | softViolations correctly tagged |
| `reserves.test.js` | 7.1–7.9 | Reserves balanced and config-respecting |
| `determinism.test.js` | 8.1–8.6, 14.5 | Same input + same seed → byte-identical output |
| `diagnostics.test.js` | 9.1–9.8 | All required diagnostic fields present |
| `round-trip.test.js` | 10.1, 10.2, 14.6, 14.8 | JSON round-trip + no shared array refs |
| `exam-center-levels.test.js` | 11.1–11.6 | Room synthesis correct |
| `production-fixture.test.js` | 15.1–15.9, 14.7 | Production fixture passes all invariants |

**PBT generators** (in `pbt-helpers.js`):
- `arbitraryProctorsList(n)`: generates `n` proctors with mixed cin/som/empty
- `arbitraryScheduleEntries(n, halfdays)`: generates `n` entries spread across `halfdays` halfdays
- `arbitraryDutyData(proctors, schedule)`: generates random duty assignments
- `arbitraryInput()`: composes the above into a valid GS3_Input_Contract

---

## 8. V2/V3 Boundary (Exclusive-OR Ownership)

| Concern | Owned By | Notes |
|---------|----------|-------|
| `js/algorithms/proctor-distribution-v2.js` | V2 | **Frozen** — no edits in V3 spec |
| `js/algorithms/proctor-v3/**` | V3 | New module |
| `tests/proctor-v3/**` | V3 | New tests |
| `tests/proctor-distribution-v2-*.js` | V2 | Existing tests untouched |
| `tests/fixtures/45454.json` | Both | Read-only fixture |
| `js/data/proctor-key-resolver.js` | Both | Helper used by display layer; unchanged |
| `main/ipc/exam-config-data.js` | Both | IPC layer; unchanged |
| `exams-proctors.html` | V2 + V3 toggle | Adds V3_Toggle UI; rest unchanged |
| `exams-rooms.html` | Both | Rendering; unchanged |
| `package.json` | Both | Adds `verify:v3` script and `fast-check` devDep |

**Rule for new constraints**: Land in V3 only. Do not modify V2 to add new behaviors.

---

## 9. Time Budget Allocation

Total budget: **30 seconds** (Acceptance Criterion 12.6). The orchestrator enforces a hard global cap; per-phase budgets are guidelines that respect the global cap.

### Standard run (no infeasibility detected)

| Phase | Budget | Justification |
|-------|--------|---------------|
| 0: Validate | 100ms | Input validation only |
| 1: Normalize Keys | 200ms | O(n) over inputs |
| 2: Eligibility Classes | 500ms | O(n × m) hashing |
| 3: Bounds | 100ms | O(c) where c = class count |
| 4: Place Guards (CP) | **10s** | Heart of the algorithm; reduced to leave room for pre-check |
| 5: Coverage Repair | 3s | Multi-step iteration |
| 6: Same-Day Detection | 200ms | Quick inspection of unresolved slots only (NO pre-check; pre-check is conditional) |
| 7: Bimodal Repair (LS) | 3s | Local search iteration |
| 8: AM/PM Balance (LS) | 2s | Local search iteration |
| 9: Place Reserves | 1s | Sort + greedy assign |
| 10: Finalize | 200ms | Aggregation + JSON check |
| **Standard total** | **~20.3s** | leaves ~9.7s headroom |

### Infeasibility pre-check (CONDITIONAL)

Triggered ONLY when Phase 6 detects unresolved slots AND `Same_Day_Allowance_Flag === false`. The pre-check re-runs Phases 4 and 5 with the relaxed flag using a **separate, smaller budget**:

| Sub-phase | Budget | Justification |
|-----------|--------|---------------|
| Pre-check Phase 4 (relaxed) | 5s | Reduced CP budget — diagnostic only, may return partial |
| Pre-check Phase 5 (relaxed) | 2s | Quick repair attempt |
| **Pre-check total** | **7s** | added ONLY when needed |

### Total worst-case

`20.3s (standard) + 7s (pre-check, conditional) = 27.3s`, fits within the 30s global cap.

### Timeout handling

If the global timer expires mid-phase, Orchestrator returns the best partial result and records `diagnostics.warnings` entry `{ type: 'phase_timeout', phase: <name>, durationMs: <num> }`. The pre-check is the FIRST sub-task to be skipped if remaining budget falls below 7s.

---

## 10. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| CP solver explodes on hard inputs | (1) AC-3 propagation cuts domains aggressively; (2) per-phase time budget; (3) fallback to greedy if CP timeout |
| Bimodal repair gets stuck in local minimum | Record `fairness_violation` in diagnostics, return best-so-far. Acceptance Criterion 5.8 explicitly allows reporting failure. |
| Multi-step repair causes new violations | Donor protection (5.12) checked before every swap. PBT suite asserts post-repair histogram still respects bounds. |
| Same-day infeasibility detection wrong-classifies cause | Clear taxonomy in `unresolvedSlots[].reason`: `'no_eligible_proctor_due_to_same_day'` is distinct from `'no_eligible_proctor_due_to_class_bounds'`. |
| Display layer breaks due to format drift | Acceptance Criterion 13.1–13.6 + round-trip test ensures Result_Row shape exactly matches V2's. |
| User loses trust in V3 | V2 remains opt-in alongside V3 (Requirement 16). User can revert in one click. |

---

## 11. Open Decisions Deferred to Implementation

The following choices are intentionally left to the implementing developer, with constraints:

1. **Specific CP propagator selection**: AC-3 is the baseline. Bound consistency may be added if profiling shows benefit.
2. **Local search neighborhood size**: 1-swap baseline; 2-swap if 1-swap fails to converge in budget.
3. **Tie-breaking for equal-cost CP assignments**: must end with `canonicalKey ASC` for determinism.
4. **Cross-class swap eligibility**: a swap may move a slot from class A's proctor to class B's proctor only if both classes' bounds are respected post-swap. No cross-class explicit rule beyond bounds-respect.
5. **Per-phase fallback strategies**: if CP times out, `phases/04` returns whatever partial assignments were made; subsequent phases handle holes.

---

## 12. Implementation Order Hint

For `tasks.md` to consume:

1. **Foundation** (Phase 1, 2, 3): canonical key + classes + bounds. Test extensively; without these correct, nothing works.
2. **CP Solver** (Phase 4): hardest piece. Start with AC-3 + DFS; profile; iterate.
3. **Repairs** (Phase 5, 7, 8): build on top of correct loadState.
4. **Reserves** (Phase 9): independent; can be built in parallel with Phase 5–8.
5. **Glue** (Phase 0, 6, 10): orchestrator + diagnostics + finalize.
6. **Testing**: PBT suite throughout, not at the end.
7. **Integration**: V3_Toggle in renderer last (after CLI verification passes).

---

## 13. Glossary Cross-Reference

All terms in `requirements.md` Glossary are used here with identical meanings. Specifically:
- `Canonical_Proctor_Key` is **defined** in `canonical-key.js` and **referenced** throughout
- `Primary_Load(T)` is **computed** in `utils/load-state.js`
- `Eligibility_Class` is **derived** in `phases/02-eligibility-classes.js`
- All other terms map 1-to-1 between `requirements.md` and this document

---

## 14. Methodology Note

This design is intentionally **conservative**:
- We use proven algorithms (AC-3, mulberry32, greedy reserves) rather than novel techniques
- We separate concerns clearly into 11 phases
- We prefer explicit data flow over implicit state
- We test invariants, not implementations

The goal is to produce code that is **boring, correct, and inspectable**, in contrast to V2's organic accumulation of patches.
