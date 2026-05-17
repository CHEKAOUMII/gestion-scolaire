/**
 * Proctor Distribution Algorithm v2
 * Hybrid three-phase algorithm: CSP Pre-pass → Hungarian per half-day → Simulated Annealing
 *
 * File: js/algorithms/proctor-distribution-v2.js
 * No external dependencies — vanilla ES2019+ for Electron 35
 */
(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const INFINITY_SENTINEL = 1e9;

  // Default Phase 2 timeout budget (ms). Used by phase2Build when the caller
  // does not supply a positive override via input.options.phase2TimeoutMs.
  // Replaces the legacy hard-coded 1500 ms budget that starved larger centres.
  var DEFAULT_PHASE2_TIMEOUT_MS = 5000;

  const SA_DEFAULTS = {
    T0: 1.0,
    T_min: 0.01,
    coolingRate: 0.95,
    maxIterations: 1000,
    maxDurationMs: 500,
    stagnationLimit: 100
  };

  const WEIGHTS_PRESETS = {
    'توازن': { alpha: 3, beta: 1, gamma: 2 },
    'احترام المجموعات': { alpha: 1, beta: 1, gamma: 5 },
    'تنوع القاعات': { alpha: 1, beta: 4, gamma: 1 }
  };

  // ============================================================
  // RE-ENTRANCY GUARD
  // ============================================================

  let _isRunning = false;

  // ============================================================
  // SEEDED PRNG — Mulberry32
  // ============================================================

  /**
   * Builds a seeded pseudo-random number generator (Mulberry32).
   * @param {number} seed - Integer seed value (must be a finite number)
   * @returns {function(): number} - Returns values in [0, 1)
   * @throws {Error} If seed is not a finite number
   */
  function buildSeededPRNG(seed) {
    if (typeof seed !== 'number' || !isFinite(seed)) {
      throw new Error(
        'Invalid PRNG seed: expected a finite number, got ' +
        typeof seed + ' (' + String(seed) + ')'
      );
    }
    let t = (seed >>> 0) || 1;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ============================================================
  // INPUT VALIDATION
  // ============================================================

  /**
   * Validates the GS2_Input_Contract fields. Throws descriptive error on failure.
   *
   * Optional `input.reservesConfig` is validated when present and defaulted in place
   * to `{ mode: 'fixed', fixed: 0, percent: 0 }` when absent so older callers and
   * existing fixtures keep working (Requirements 2.8, 3.10).
   *
   * @param {Object} input
   * @throws {Error} If any required field is missing or invalid
   */
  function validateInput(input) {
    if (!input || typeof input !== 'object') {
      throw new Error('GS2_Input_Contract: input must be a non-null object');
    }

    // Required non-empty array fields
    const requiredArrays = ['proctorsList', 'scheduleEntries'];
    for (let i = 0; i < requiredArrays.length; i++) {
      const field = requiredArrays[i];
      if (!Array.isArray(input[field]) || input[field].length === 0) {
        throw new Error(
          'GS2_Input_Contract: "' + field + '" must be a non-empty array'
        );
      }
    }

    // Required object fields (non-null, non-undefined, typeof object)
    const requiredObjects = [
      'exemptionsData', 'dutyData', 'meAssignments', 'examDistributionRules'
    ];
    for (let j = 0; j < requiredObjects.length; j++) {
      const field = requiredObjects[j];
      if (input[field] === null || input[field] === undefined) {
        throw new Error(
          'GS2_Input_Contract: "' + field + '" is required and cannot be null/undefined'
        );
      }
      if (typeof input[field] !== 'object') {
        throw new Error(
          'GS2_Input_Contract: "' + field + '" must be an object'
        );
      }
    }

    // Validate randomSeed if provided
    if (input.randomSeed !== null && input.randomSeed !== undefined) {
      if (typeof input.randomSeed !== 'number' || !isFinite(input.randomSeed)) {
        throw new Error(
          'GS2_Input_Contract: "randomSeed" must be a finite number when provided, got ' +
          typeof input.randomSeed + ' (' + String(input.randomSeed) + ')'
        );
      }
    }

    // Validate reservesConfig if provided; default in place when absent so legacy
    // callers and existing fixtures keep working (Requirements 2.8, 3.10).
    // The field is intentionally OPTIONAL — never required, never throws for legacy fixtures.
    if (input.reservesConfig === null || input.reservesConfig === undefined) {
      input.reservesConfig = { mode: 'fixed', fixed: 0, percent: 0 };
    } else {
      const cfg = input.reservesConfig;
      if (typeof cfg !== 'object') {
        throw new Error(
          'GS2_Input_Contract: "reservesConfig" must be an object when provided, got ' +
          typeof cfg
        );
      }
      if (cfg.mode !== 'fixed' && cfg.mode !== 'percent') {
        throw new Error(
          'GS2_Input_Contract: "reservesConfig.mode" must be one of "fixed" or "percent", got ' +
          String(cfg.mode)
        );
      }
      if (typeof cfg.fixed !== 'number' || !isFinite(cfg.fixed) || cfg.fixed < 0) {
        throw new Error(
          'GS2_Input_Contract: "reservesConfig.fixed" must be a finite number >= 0, got ' +
          String(cfg.fixed)
        );
      }
      if (
        typeof cfg.percent !== 'number' ||
        !isFinite(cfg.percent) ||
        cfg.percent < 0 ||
        cfg.percent > 100
      ) {
        throw new Error(
          'GS2_Input_Contract: "reservesConfig.percent" must be a finite number in [0, 100], got ' +
          String(cfg.percent)
        );
      }
    }

    if (input.D_expected === null || input.D_expected === undefined) {
      input.D_expected = 0;
    } else if (
      typeof input.D_expected !== 'number' ||
      !isFinite(input.D_expected) ||
      input.D_expected < 0
    ) {
      throw new Error(
        'GS2_Input_Contract: "D_expected" must be a finite number >= 0 when provided, got ' +
        String(input.D_expected)
      );
    }
  }

  // ============================================================
  // HALFDAY KEY COMPUTATION (matching v1 format)
  // ============================================================

  /**
   * Computes the date key from a schedule entry in YYYY-MM-DD format.
   * @param {Object} scheduleEntry
   * @returns {string}
   */
  function getScheduleDateKey(scheduleEntry) {
    const year = scheduleEntry.date_year || '';
    const month = scheduleEntry.date_month
      ? String(scheduleEntry.date_month).padStart(2, '0')
      : '';
    const day = scheduleEntry.date_day
      ? String(scheduleEntry.date_day).padStart(2, '0')
      : '';
    return [year, month, day].filter(Boolean).join('-');
  }

  /**
   * Computes the halfday key for a schedule entry.
   * Format: `${YYYY-MM-DD}|${period}` where period = "صباحا"|"مساء"
   * @param {Object} scheduleEntry
   * @returns {string}
   */
  function computeHalfdayKey(scheduleEntry) {
    return [getScheduleDateKey(scheduleEntry), scheduleEntry.period || 'صباحا'].join('|');
  }

  /**
   * Determines if a halfday key represents a morning period.
   * @param {string} halfdayKey - Format: "YYYY-MM-DD|period"
   * @returns {boolean}
   */
  function isMorningHalfday(halfdayKey) {
    const parts = halfdayKey.split('|');
    return (parts[1] || '') === 'صباحا';
  }

  // ============================================================
  // COMPUTE BOUNDS
  // ============================================================

  /**
   * Computes the lower and upper bounds for proctor load balancing.
   *
   * lowerBound = floor((totalTasks - fixedReservedTasks) / numEligibleTeachers)
   * upperBound = lowerBound + 1
   *
   * @param {number} totalTasks
   * @param {number} fixedReservedTasks
   * @param {number} numEligibleTeachers
   * @returns {{ lowerBound: number, upperBound: number }}
   */
  function computeBounds(totalTasks, fixedReservedTasks, numEligibleTeachers) {
    if (numEligibleTeachers <= 0) {
      return { lowerBound: 0, upperBound: 1 };
    }
    const lowerBound = Math.floor(
      (totalTasks - fixedReservedTasks) / numEligibleTeachers
    );
    return { lowerBound: lowerBound, upperBound: lowerBound + 1 };
  }

  // ============================================================
  // LOAD STATE MANAGEMENT
  // ============================================================

  /**
   * Creates an empty LoadState object.
   * @returns {Object.<string, Object>}
   */
  function createLoadState() {
    return {};
  }

  /**
   * Gets or creates a TeacherLoad entry for a given proctor key.
   * @param {Object} loadState
   * @param {string} proctorKey
   * @returns {Object}
   */
  function getTeacherLoad(loadState, proctorKey) {
    if (!loadState[proctorKey]) {
      loadState[proctorKey] = {
        teacherName: '',
        guardCount: 0,
        reserveCount: 0,
        dutyCount: 0,
        guardHalfdays: new Set(),
        reserveHalfdays: new Set(),
        dutyHalfdays: new Set(),
        morningCount: 0,
        afternoonCount: 0
      };
    }
    return loadState[proctorKey];
  }

  /**
   * Adds a guard load entry for a proctor.
   *
   * Post slot-metric switch (spec proctor-v2-slot-metric-reserves-affinity):
   * `entry.guardCount` is now SLOT-BASED. Every call increments it by 1,
   * regardless of whether `halfdayKey` was already present in
   * `entry.guardHalfdays`. The Set is retained — it is still consumed by
   * `filterAvailableProctors` and by `phase2_5PopulateReserves`'s
   * halfday-reuse check (semantics unchanged: idempotent membership test).
   *
   * Returns `true` whenever the function actually incremented (i.e. on every
   * non-empty call). Returns `false` only on the early
   * `(!proctorKey || !halfdayKey)` guard. Callers that previously read the
   * boolean as a "first-of-halfday" signal — none exist in the current
   * codebase; the value is consumed only as a void return — are unaffected.
   *
   * @param {Object} loadState
   * @param {string} proctorKey
   * @param {string} halfdayKey
   * @param {string} teacherName
   * @returns {boolean} true on increment, false only on the early guard
   */
  function addGuardLoad(loadState, proctorKey, halfdayKey, teacherName) {
    if (!proctorKey || !halfdayKey) return false;
    const entry = getTeacherLoad(loadState, proctorKey);
    if (teacherName && !entry.teacherName) entry.teacherName = teacherName;
    // Slot-based: increment on EVERY call.
    entry.guardCount++;
    // Halfday-tracking Set retained for halfday-reuse rule semantics.
    entry.guardHalfdays.add(halfdayKey);
    // M/E counters now slot-based too, matching the new fairness axis.
    if (isMorningHalfday(halfdayKey)) {
      entry.morningCount++;
    } else {
      entry.afternoonCount++;
    }
    return true;
  }

  /**
   * Adds a reserve load entry for a proctor.
   * @param {Object} loadState
   * @param {string} proctorKey
   * @param {string} halfdayKey
   * @param {string} teacherName
   * @returns {boolean}
   */
  function addReserveLoad(loadState, proctorKey, halfdayKey, teacherName) {
    if (!proctorKey || !halfdayKey) return false;
    const entry = getTeacherLoad(loadState, proctorKey);
    if (teacherName && !entry.teacherName) entry.teacherName = teacherName;
    const before = entry.reserveHalfdays.size;
    entry.reserveHalfdays.add(halfdayKey);
    if (entry.reserveHalfdays.size > before) {
      entry.reserveCount++;
      return true;
    }
    return false;
  }

  /**
   * Adds a duty load entry for a proctor.
   * @param {Object} loadState
   * @param {string} proctorKey
   * @param {string} halfdayKey
   * @param {string} teacherName
   * @returns {boolean}
   */
  function addDutyLoad(loadState, proctorKey, halfdayKey, teacherName) {
    if (!proctorKey || !halfdayKey) return false;
    const entry = getTeacherLoad(loadState, proctorKey);
    if (teacherName && !entry.teacherName) entry.teacherName = teacherName;
    const before = entry.dutyHalfdays.size;
    entry.dutyHalfdays.add(halfdayKey);
    if (entry.dutyHalfdays.size > before) {
      entry.dutyCount++;
      return true;
    }
    return false;
  }

  /**
   * Gets the guard count for a proctor.
   * @param {Object} loadState
   * @param {string} proctorKey
   * @returns {number}
   */
  function getGuardCount(loadState, proctorKey) {
    return getTeacherLoad(loadState, proctorKey).guardCount;
  }

  /**
   * Gets the primary load (guardSlotCount + dutyCount) for a proctor.
   *
   * Post slot-metric switch (spec proctor-v2-slot-metric-reserves-affinity):
   * `entry.guardCount` is slot-based — see `addGuardLoad`. This function
   * therefore returns `guardSlotCount + dutyCount`. No signature change.
   * Every consumer (costFunction hard cap, per-class fairness invariant,
   * phase2_75CoverageRepair peer eligibility, objectiveFunction primary-load
   * aggregation, orchestrator diagnostics) inherits slot semantics
   * automatically.
   *
   * @param {Object} loadState
   * @param {string} proctorKey
   * @returns {number}
   */
  function getPrimaryLoad(loadState, proctorKey) {
    const entry = getTeacherLoad(loadState, proctorKey);
    return entry.guardCount + entry.dutyCount;
  }

  /**
   * Gets the final load (guardSlotCount + reserveCount + dutyCount) for a proctor.
   *
   * Post slot-metric switch (spec proctor-v2-slot-metric-reserves-affinity):
   * `entry.guardCount` is slot-based — see `addGuardLoad`. This function
   * therefore returns `guardSlotCount + reserveCount + dutyCount`. Consumed
   * by `phase2_5PopulateReserves`'s candidate sort key (the third lex term,
   * `finalLoad`).
   *
   * @param {Object} loadState
   * @param {string} proctorKey
   * @returns {number}
   */
  function getFinalLoad(loadState, proctorKey) {
    const entry = getTeacherLoad(loadState, proctorKey);
    return entry.guardCount + entry.reserveCount + entry.dutyCount;
  }

  /**
   * Computes the target number of reserves for a session given the reserves
   * configuration and the number of guards already placed in that session.
   *
   * Pseudocode (design.md §3 helper):
   *   IF cfg.mode === 'percent' THEN ceil(cfg.percent * guardCount / 100)
   *   ELSE cfg.fixed
   *
   * Defensive: when `cfg` is null/undefined the helper returns 0 (matches the
   * §3 edge-case row "cfg undefined") so callers never crash on legacy inputs
   * that bypassed `validateInput` defaulting.
   *
   * Used by `phase2_5PopulateReserves` and exposed on `_internals` for unit
   * tests.
   *
   * @param {Object|null|undefined} cfg - reservesConfig object
   *   { mode: 'fixed'|'percent', fixed: int, percent: int (0..100) }
   * @param {number} guardCount - number of guards already placed in the session
   * @returns {number} non-negative integer target count
   */
  function computeReserveTarget(cfg, guardCount) {
    if (cfg == null) return 0;
    if (cfg.mode === 'percent') {
      return Math.ceil((cfg.percent * guardCount) / 100);
    }
    return cfg.fixed;
  }

  /**
   * Computes load balance statistics from the load state.
   * @param {Object} loadState
   * @returns {{ std: number, min: number, max: number, giniCoefficient: number }}
   */
  function computeLoadStats(loadState) {
    const keys = Object.keys(loadState);
    if (keys.length === 0) {
      return { std: 0, min: 0, max: 0, giniCoefficient: 0 };
    }

    const loads = keys.map(function (key) { return loadState[key].guardCount; });
    const n = loads.length;

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (loads[i] < min) min = loads[i];
      if (loads[i] > max) max = loads[i];
      sum += loads[i];
    }
    const mean = sum / n;

    // Standard deviation (population)
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const diff = loads[i] - mean;
      variance += diff * diff;
    }
    variance /= n;
    const std = Math.sqrt(variance);

    // Gini coefficient
    let giniNumerator = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        giniNumerator += Math.abs(loads[i] - loads[j]);
      }
    }
    const giniCoefficient = mean > 0 ? giniNumerator / (2 * n * n * mean) : 0;

    return { std: std, min: min, max: max, giniCoefficient: giniCoefficient };
  }

  function getLoadSetSize(loadState, proctorKey, setName) {
    var entry = loadState && loadState[proctorKey];
    var set = entry && entry[setName];
    return set && typeof set.size === 'number' ? set.size : 0;
  }

  function isOnDutyDuringHalfday(proctorKey, halfdayKey, loadState) {
    var entry = loadState && loadState[proctorKey];
    return Boolean(entry && entry.dutyHalfdays && entry.dutyHalfdays.has(halfdayKey));
  }

  function computeEligibilityClasses(proctorsList, scheduleEntries, exemptionsData, dutyData, loadState) {
    var classes = new Map();
    var list = proctorsList || [];
    var entries = scheduleEntries || [];
    for (var pi = 0; pi < list.length; pi++) {
      var proc = list[pi];
      var key = getProctorKey(proc, pi);
      var eligible = [];
      for (var ei = 0; ei < entries.length; ei++) {
        var entry = entries[ei];
        var halfdayKey = computeHalfdayKey(entry);
        if (
          !isProctorExemptForEntry(proc, pi, entry, exemptionsData || {}) &&
          !isOnDutyDuringHalfday(key, halfdayKey, loadState)
        ) {
          eligible.push(ei);
        }
      }
      if (eligible.length === 0) continue;
      var baselineDuty = getLoadSetSize(loadState, key, 'dutyHalfdays');
      var classId = eligible.join(',') + '|' + baselineDuty;
      var cls = classes.get(classId);
      if (!cls) {
        cls = {
          id: classId,
          members: [],
          reachableSessionIndices: eligible.slice(),
          baselineDutyCount: baselineDuty
        };
        classes.set(classId, cls);
      }
      cls.members.push({ key: key, proc: proc, idx: pi, classId: classId });
    }
    return classes;
  }

  function getGuardSlotsForScheduleIndex(scheduleEntries, index, proctorsPerRoom, guardSlotsByIndex) {
    if (guardSlotsByIndex && guardSlotsByIndex[index] !== undefined) {
      return Math.max(0, Number(guardSlotsByIndex[index]) || 0);
    }
    var entry = scheduleEntries && scheduleEntries[index];
    if (entry && entry._strictFairnessGuardSlots !== undefined) {
      return Math.max(0, Number(entry._strictFairnessGuardSlots) || 0);
    }
    var roomsCount = entry && entry.roomsCount !== undefined ? Number(entry.roomsCount) : 1;
    return Math.max(0, roomsCount || 0) * Math.max(0, Number(proctorsPerRoom) || 0);
  }

  function computeClassBounds(classes, scheduleEntries, proctorsPerRoom, D_expected, N, guardSlotsByIndex) {
    var bounds = new Map();
    var classIds = Array.from(classes ? classes.keys() : []).sort();
    var expectedDuty = Math.max(0, Math.floor(Number(D_expected) || 0));
    var eligibleCount = Math.max(0, Number(N) || 0);
    if (classIds.length === 0) return bounds;

    var gById = new Map();
    for (var gi = 0; gi < classIds.length; gi++) {
      var gId = classIds[gi];
      var clsForG = classes.get(gId);
      var reachable = (clsForG && clsForG.reachableSessionIndices) || [];
      var gClass = 0;
      for (var ri = 0; ri < reachable.length; ri++) {
        gClass += getGuardSlotsForScheduleIndex(scheduleEntries, reachable[ri], proctorsPerRoom, guardSlotsByIndex);
      }
      gById.set(gId, gClass);
    }

    if (classIds.length === 1) {
      var onlyId = classIds[0];
      var onlyClass = classes.get(onlyId);
      var onlySize = Math.max(1, (onlyClass.members || []).length);
      var onlyG = gById.get(onlyId) || 0;
      var onlyTotal = onlyG + expectedDuty;
      bounds.set(onlyId, {
        classLowerBound: Math.floor(onlyTotal / onlySize),
        classUpperBound: Math.ceil(onlyTotal / onlySize),
        G_class: onlyG,
        D_expected_class: expectedDuty
      });
      return bounds;
    }

    var dShareById = new Map();
    var assigned = 0;
    for (var di = 0; di < classIds.length; di++) {
      var dId = classIds[di];
      var dClass = classes.get(dId);
      var size = (dClass.members || []).length;
      var share = eligibleCount > 0 ? Math.floor(expectedDuty * size / eligibleCount) : 0;
      dShareById.set(dId, share);
      assigned += share;
    }

    var residual = expectedDuty - assigned;
    var residualOrder = classIds.slice().sort(function (a, b) {
      var sizeA = ((classes.get(a) || {}).members || []).length;
      var sizeB = ((classes.get(b) || {}).members || []).length;
      if (sizeA !== sizeB) return sizeB - sizeA;
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
    for (var ro = 0; ro < residualOrder.length && residual > 0; ro++) {
      var rid = residualOrder[ro];
      dShareById.set(rid, (dShareById.get(rid) || 0) + 1);
      residual--;
      if (ro === residualOrder.length - 1 && residual > 0) ro = -1;
    }

    for (var bi = 0; bi < classIds.length; bi++) {
      var bId = classIds[bi];
      var bClass = classes.get(bId);
      var bSize = Math.max(1, (bClass.members || []).length);
      var bG = gById.get(bId) || 0;
      var bD = dShareById.get(bId) || 0;
      var bTotal = bG + bD;
      bounds.set(bId, {
        classLowerBound: Math.floor(bTotal / bSize),
        classUpperBound: Math.ceil(bTotal / bSize),
        G_class: bG,
        D_expected_class: bD
      });
    }
    return bounds;
  }

  function serializeClassBounds(classBounds) {
    var out = {};
    if (!classBounds) return out;
    classBounds.forEach(function (value, key) {
      out[key] = {
        classLowerBound: value.classLowerBound,
        classUpperBound: value.classUpperBound,
        G_class: value.G_class,
        D_expected_class: value.D_expected_class
      };
    });
    return out;
  }

  // ============================================================
  // PHASE 1: CSP PRE-PASS — STUBS
  // ============================================================

  // ============================================================
  // CSP HELPER FUNCTIONS
  // ============================================================

  /**
   * Generates a unique key for a proctor.
   * MUST match v1's getProctorKey format for meAssignments compatibility.
   * v1 uses: proc.cin ? proc.cin : '__idx_' + idx
   * @param {Object} proctor
   * @param {number} index
   * @returns {string}
   */
  function getProctorKey(proctor, index) {
    return proctor.cin ? proctor.cin : ('__idx_' + index);
  }

  /**
   * Generates the exemption/duty key for a proctor.
   * MUST match v1's getProctorExemptionKey format.
   * v1 uses: proc.cin || proc.som || ('idx_' + idx)
   * Used for: exemptions, duty lookups, load state tracking.
   * @param {Object} proctor
   * @param {number} index
   * @returns {string}
   */
  function getProctorExemptionKey(proctor, index) {
    return proctor.cin || proctor.som || ('idx_' + index);
  }

  /**
   * Builds a string→string map from any external key shape to the canonical
   * key shape (algo: `cin || '__idx_' + idx`) for each proctor in
   * `proctorsList`.
   *
   * Spec: proctor-v2-key-shape-unification (Boundary Adapter, Edit Site rows
   * #11 and #10). Constructed once per `orchestrator(input)` invocation,
   * immediately after input validation. Used by:
   *   - duty pre-pass (≈line 1762, Edit Site #11): translates exemption-shape
   *     external keys from `examDutyTeachersData` into canonical algo-shape
   *     before `addDutyLoad` writes to `loadState`.
   *   - meAssignmentsMap build (≈line 1741, Edit Site #10): defensive
   *     adapter for legacy DB rows that may carry exemption-shape keys.
   *
   * Recognized external shapes per proctor at index `i`:
   *   - getProctorKey(proc, i)           → canonical (identity)
   *   - getProctorExemptionKey(proc, i)  → canonical (cross-shape)
   *   - proc.cin (if non-empty)          → canonical (always identity, since
   *                                        cin is the prefix of both functions)
   *   - proc.som (if non-empty AND cin = "") → canonical (the production case)
   *
   * The adapter is read-only after construction. Multiple registrations of
   * the same external key under different proctors can occur for `som` if
   * two proctors share a som (Risk Register R5) — last-write-wins matches
   * v1 `Object.keys` iteration semantics.
   *
   * @param {Array<Object>} proctorsList
   * @returns {Object} prototype-less map (Object.create(null))
   */
  function buildKeyAdapter(proctorsList) {
    var map = Object.create(null);
    var list = proctorsList || [];
    for (var i = 0; i < list.length; i++) {
      var proc = list[i] || {};
      var canonical = getProctorKey(proc, i);
      var exempt = getProctorExemptionKey(proc, i);
      map[canonical] = canonical;
      if (exempt !== canonical) map[exempt] = canonical;
      if (proc.cin && proc.cin !== canonical) map[proc.cin] = canonical;
      if (proc.som && !proc.cin) map[proc.som] = canonical;
    }
    return map;
  }

  /**
   * Translates an external key (exemption-shape or canonical) into the
   * canonical key shape via a pre-built `keyAdapter`. Returns `null` for
   * unknown / empty / null external keys so callers can count and skip
   * orphans via `diagnostics.orphanDutyKeys` / `orphanMeAssignments`.
   *
   * @param {Object} keyAdapter - map produced by buildKeyAdapter
   * @param {string} externalKey
   * @returns {string|null} canonical key, or null on orphan/empty/null
   */
  function toCanonicalKey(keyAdapter, externalKey) {
    if (!externalKey) return null;
    return keyAdapter[externalKey] || null;
  }


  /**
   * Computes the session key for a schedule entry (matches v1 getAutoDistributionSessionKey).
   * Format: `${YYYY-MM-DD}|${period}|${session}`
   * @param {Object} scheduleEntry
   * @returns {string}
   */
  function getSessionKey(scheduleEntry) {
    return [
      getScheduleDateKey(scheduleEntry),
      scheduleEntry.period || 'صباحا',
      scheduleEntry.session || 'الحصة الأولى'
    ].join('|');
  }

  /**
   * Computes the day key for a schedule entry (matches v1 getAutoDistributionDayKey).
   * @param {Object} scheduleEntry
   * @returns {string}
   */
  function getDayKey(scheduleEntry) {
    return getScheduleDateKey(scheduleEntry) || scheduleEntry.day || '';
  }

  /**
   * Computes the schedule session key used for duty lookups (matches v1 getScheduleSessionKey).
   * Format: `${YYYY-MM-DD}|${day}|${period}|${session}`
   * @param {Object} scheduleEntry
   * @returns {string}
   */
  function getScheduleSessionKeyForDuty(scheduleEntry) {
    return [
      getScheduleDateKey(scheduleEntry),
      scheduleEntry.day || 'الأول',
      scheduleEntry.period || 'صباحا',
      scheduleEntry.session || 'الحصة الأولى'
    ].join('|');
  }

  /**
   * Computes the legacy schedule session key for duty lookups (matches v1 getLegacyScheduleSessionKey).
   * Format: `${day}|${period}|${session}`
   * @param {Object} scheduleEntry
   * @returns {string}
   */
  function getLegacyScheduleSessionKey(scheduleEntry) {
    return [
      scheduleEntry.day || 'الأول',
      scheduleEntry.period || 'صباحا',
      scheduleEntry.session || 'الحصة الأولى'
    ].join('|');
  }

  /**
   * Checks if a proctor is exempt for a given schedule entry.
   * Matches v1 isProctorExemptForSchedule logic.
   * @param {Object} proctor
   * @param {number} proctorIdx
   * @param {Object} scheduleEntry
   * @param {Object} exemptionsData
   * @returns {boolean}
   */
  function isProctorExemptForEntry(proctor, proctorIdx, scheduleEntry, exemptionsData) {
    var key = getProctorExemptionKey(proctor, proctorIdx);
    var day = scheduleEntry.day || 'الأول';
    var period = scheduleEntry.period || 'صباحا';
    var session = scheduleEntry.session || 'الحصة الأولى';
    var scopes = [
      ['session', day, period, session].join('|'),
      ['period', day, period].join('|'),
      ['day', day].join('|')
    ];
    for (var i = 0; i < scopes.length; i++) {
      var scopeKey = scopes[i];
      if (exemptionsData[scopeKey] && exemptionsData[scopeKey][key] === 'no') {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks whether a proctor is exempt for ANY row in a session.
   *
   * Used by `phase2_5PopulateReserves` to filter the reserve candidate pool
   * (design.md §3 candidate pool step). A reserve is rejected if it is exempt
   * for at least one row's schedule entry — matching v1's per-row exemption
   * semantics so reserves placed at the session level still respect per-entry
   * exemptions.
   *
   * Each row carries `schedule_entry` (populated by `phase2Build`); when it is
   * absent the function reconstructs a minimal entry from `day`, `period`,
   * `session`, `subject_name`, and `level_name` so legacy/synthetic rows still
   * resolve. Falsy rows are skipped.
   *
   * @param {Object} proctor
   * @param {number} proctorIdx
   * @param {Array<Object>} rows - assignment rows belonging to one session
   * @param {Object} exemptionsData
   * @returns {boolean}
   */
  function isExemptForAnyRow(proctor, proctorIdx, rows, exemptionsData) {
    if (!rows || !rows.length) return false;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row) continue;
      var entry = row.schedule_entry;
      if (!entry) {
        // Reconstruct a minimal schedule entry from row fields. The exemption
        // check only looks at day/period/session, so the other fields can be
        // best-effort.
        entry = {
          day: row.day || '',
          period: row.period || '',
          session: row.session || '',
          subject_name: row.subject_name || '',
          level_name: row.level_name || ''
        };
      }
      if (isProctorExemptForEntry(proctor, proctorIdx, entry, exemptionsData)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if a proctor is a duty teacher for a given schedule entry's subject.
   * Matches v1 isDutyTeacherForSchedule logic.
   * @param {Object} proctor
   * @param {number} proctorIdx
   * @param {Object} scheduleEntry
   * @param {Object} dutyData
   * @returns {boolean}
   */
  function isDutyTeacherForEntry(proctor, proctorIdx, scheduleEntry, dutyData) {
    var key = getProctorExemptionKey(proctor, proctorIdx);
    var dutyKey = getScheduleSessionKeyForDuty(scheduleEntry) + '|' + (scheduleEntry.subject_name || '');
    var legacyDutyKey = getLegacyScheduleSessionKey(scheduleEntry) + '|' + (scheduleEntry.subject_name || '');
    return Boolean(
      (dutyData[dutyKey] && dutyData[dutyKey][key]) ||
      (dutyData[legacyDutyKey] && dutyData[legacyDutyKey][key])
    );
  }

  /**
   * Computes a unique schedule entry ID from its fields.
   * Format: `${level_name}|${subject_name}|${computeHalfdayKey(entry)}|${session}`
   * @param {Object} scheduleEntry
   * @param {number} entryIndex
   * @returns {string}
   */
  function getScheduleEntryId(scheduleEntry, entryIndex) {
    return [
      scheduleEntry.level_name || '',
      scheduleEntry.subject_name || '',
      computeHalfdayKey(scheduleEntry),
      scheduleEntry.session || 'الحصة الأولى'
    ].join('|');
  }

  /**
   * Gets the room constraint key (matches v1 getRoomConstraintKey).
   * @param {Object} room
   * @returns {string}
   */
  function getRoomConstraintKey(room) {
    return String(room && (room.key || room.room_num || room.roomName) || '').trim();
  }

  // ============================================================
  // PHASE 1: CSP PRE-PASS — buildCSPModel
  // ============================================================

  /**
   * Builds a CSP model from the input data.
   *
   * Variables: triples (scheduleEntryId, roomKey, slotIndex) — one per proctor slot per room per entry.
   * Domains: Map<varId, Set<proctorKey>> — initial domain = all proctors NOT exempt AND NOT duty teacher.
   * Constraints: unary (exemption, duty) and binary (same-session, halfday, day reuse).
   *
   * @param {Array} scheduleEntries
   * @param {Array} proctorsList
   * @param {Object} exemptionsData
   * @param {Object} dutyData
   * @param {Object} rules - { proctorsPerRoom, reservesPerSession }
   * @param {Object} options - includes allowHalfdayReuse, allowDayReuse, roomsList
   * @returns {Object} CSPModel { variables, domains, constraints }
   */
  function buildCSPModel(scheduleEntries, proctorsList, exemptionsData, dutyData, rules, options) {
    var variables = [];
    var domains = new Map();
    var constraints = [];
    var proctorsPerRoom = (rules && rules.proctorsPerRoom) || 1;
    var roomsList = (options && options.roomsList) || [];
    var allowHalfdayReuse = !!(options && options.allowHalfdayReuse);
    var allowDayReuse = !!(options && options.allowDayReuse);

    // Helper: get rooms for a given level
    // roomsList can be:
    //   1. An object/Map keyed by level_name → array of room objects
    //   2. A flat array of room objects (optionally with level_name field)
    function getRoomsForEntry(scheduleEntry) {
      var levelName = scheduleEntry.level_name || '';

      // Case 1: roomsList is an object keyed by level_name
      if (roomsList && typeof roomsList === 'object' && !Array.isArray(roomsList)) {
        var levelRooms = roomsList[levelName];
        if (Array.isArray(levelRooms) && levelRooms.length > 0) {
          return levelRooms;
        }
        // If level not found in map, return empty (no rooms for this level)
        return [];
      }

      // Case 2: roomsList is a flat array
      if (Array.isArray(roomsList) && roomsList.length > 0) {
        // Filter by level if possible
        var filtered = roomsList.filter(function (r) {
          return (r.level_name || '') === levelName;
        });
        return filtered.length > 0 ? filtered : roomsList;
      }

      return [];
    }

    // Pre-compute proctor keys and eligibility per entry
    var proctorKeys = [];
    for (var pi = 0; pi < proctorsList.length; pi++) {
      proctorKeys.push(getProctorKey(proctorsList[pi], pi));
    }

    // Build variables and domains
    // Track which variables share the same session, halfday, and day for binary constraints
    var sessionVarGroups = {}; // sessionKey → [varId, ...]
    var halfdayVarGroups = {}; // halfdayKey → [varId, ...]
    var dayVarGroups = {}; // dayKey → [varId, ...]

    for (var ei = 0; ei < scheduleEntries.length; ei++) {
      var entry = scheduleEntries[ei];
      var entryId = getScheduleEntryId(entry, ei);
      var rooms = getRoomsForEntry(entry);
      var sessionK = getSessionKey(entry);
      var halfdayK = computeHalfdayKey(entry);
      var dayK = getDayKey(entry);

      // Compute eligible proctors for this entry (filtering exemptions and duty)
      var eligibleForEntry = new Set();
      for (var p = 0; p < proctorsList.length; p++) {
        if (!isProctorExemptForEntry(proctorsList[p], p, entry, exemptionsData) &&
            !isDutyTeacherForEntry(proctorsList[p], p, entry, dutyData)) {
          eligibleForEntry.add(proctorKeys[p]);
        }
      }

      for (var ri = 0; ri < rooms.length; ri++) {
        var roomKey = getRoomConstraintKey(rooms[ri]);
        for (var si = 0; si < proctorsPerRoom; si++) {
          var varId = entryId + '|' + roomKey + '|' + si;
          var variable = {
            id: varId,
            scheduleEntryId: entryId,
            roomKey: roomKey,
            slotIndex: si,
            _sessionKey: sessionK,
            _halfdayKey: halfdayK,
            _dayKey: dayK,
            _entryIndex: ei
          };
          variables.push(variable);

          // Domain: copy of eligible proctors for this entry
          domains.set(varId, new Set(eligibleForEntry));

          // Track groupings for binary constraints
          if (!sessionVarGroups[sessionK]) sessionVarGroups[sessionK] = [];
          sessionVarGroups[sessionK].push(varId);

          if (!halfdayVarGroups[halfdayK]) halfdayVarGroups[halfdayK] = [];
          halfdayVarGroups[halfdayK].push(varId);

          if (!dayVarGroups[dayK]) dayVarGroups[dayK] = [];
          dayVarGroups[dayK].push(varId);
        }
      }
    }

    // Build unary constraints (exemption and duty checks)
    // These are already applied during domain construction, but we record them
    // for completeness and for AC-3 to use
    for (var vi = 0; vi < variables.length; vi++) {
      var v = variables[vi];
      var entryIdx = v._entryIndex;
      var entryForConstraint = scheduleEntries[entryIdx];

      // Unary: exemption constraint
      constraints.push({
        type: 'unary',
        scope: [v.id],
        check: (function (entryRef, exemptions) {
          return function (value) {
            // Find proctor index by key
            for (var k = 0; k < proctorKeys.length; k++) {
              if (proctorKeys[k] === value) {
                return !isProctorExemptForEntry(proctorsList[k], k, entryRef, exemptions);
              }
            }
            return false; // unknown proctor key
          };
        })(entryForConstraint, exemptionsData)
      });

      // Unary: duty constraint
      constraints.push({
        type: 'unary',
        scope: [v.id],
        check: (function (entryRef, duty) {
          return function (value) {
            for (var k = 0; k < proctorKeys.length; k++) {
              if (proctorKeys[k] === value) {
                return !isDutyTeacherForEntry(proctorsList[k], k, entryRef, duty);
              }
            }
            return false;
          };
        })(entryForConstraint, dutyData)
      });
    }

    // Build binary constraints

    // 1. No same proctor in same session
    var sessionKeys = Object.keys(sessionVarGroups);
    for (var ski = 0; ski < sessionKeys.length; ski++) {
      var group = sessionVarGroups[sessionKeys[ski]];
      for (var a = 0; a < group.length; a++) {
        for (var b = a + 1; b < group.length; b++) {
          constraints.push({
            type: 'binary',
            scope: [group[a], group[b]],
            check: function (val1, val2) {
              return val1 !== val2;
            }
          });
        }
      }
    }

    // 2. No same proctor in same halfday (if allowHalfdayReuse is disabled)
    if (!allowHalfdayReuse) {
      var halfdayKeys = Object.keys(halfdayVarGroups);
      for (var hki = 0; hki < halfdayKeys.length; hki++) {
        var hGroup = halfdayVarGroups[halfdayKeys[hki]];
        for (var ha = 0; ha < hGroup.length; ha++) {
          for (var hb = ha + 1; hb < hGroup.length; hb++) {
            constraints.push({
              type: 'binary',
              scope: [hGroup[ha], hGroup[hb]],
              check: function (val1, val2) {
                return val1 !== val2;
              }
            });
          }
        }
      }
    }

    // 3. No same proctor in same day (if allowDayReuse is disabled)
    if (!allowDayReuse) {
      var dayKeys = Object.keys(dayVarGroups);
      for (var dki = 0; dki < dayKeys.length; dki++) {
        var dGroup = dayVarGroups[dayKeys[dki]];
        for (var da = 0; da < dGroup.length; da++) {
          for (var db = da + 1; db < dGroup.length; db++) {
            constraints.push({
              type: 'binary',
              scope: [dGroup[da], dGroup[db]],
              check: function (val1, val2) {
                return val1 !== val2;
              }
            });
          }
        }
      }
    }

    return { variables: variables, domains: domains, constraints: constraints };
  }

  /**
   * Runs AC-3 arc consistency propagation on the CSP model.
   * @param {Object} cspModel
   * @param {number} [maxIterations=1000]
   * @returns {{ stable: boolean, iterations: number, emptyDomains: string[] }}
   */
  function runAC3(cspModel, maxIterations) {
    if (maxIterations === undefined || maxIterations === null) {
      maxIterations = 1000;
    }

    var domains = cspModel.domains;
    var constraints = cspModel.constraints;
    var emptyDomains = [];

    // Build adjacency: for each variable, which other variables share a binary constraint
    // and which constraint applies between them
    // arcs: array of { xi: varId, xj: varId, check: function(val1, val2) }
    var queue = [];
    var neighborMap = {}; // varId → Set of { neighbor: varId, check: fn }

    // Initialize queue with all arcs from binary constraints
    for (var ci = 0; ci < constraints.length; ci++) {
      var constraint = constraints[ci];
      if (constraint.type !== 'binary') continue;

      var xi = constraint.scope[0];
      var xj = constraint.scope[1];
      var check = constraint.check;

      // Add both directions: (Xi, Xj) and (Xj, Xi)
      queue.push({ xi: xi, xj: xj, check: check });
      queue.push({ xi: xj, xj: xi, check: check });

      // Build neighbor map
      if (!neighborMap[xi]) neighborMap[xi] = [];
      neighborMap[xi].push({ neighbor: xj, check: check });

      if (!neighborMap[xj]) neighborMap[xj] = [];
      neighborMap[xj].push({ neighbor: xi, check: check });
    }

    var iterations = 0;

    while (queue.length > 0 && iterations < maxIterations) {
      iterations++;
      var arc = queue.shift();
      var arcXi = arc.xi;
      var arcXj = arc.xj;
      var arcCheck = arc.check;

      if (revise(domains, arcXi, arcXj, arcCheck)) {
        var domainXi = domains.get(arcXi);

        if (!domainXi || domainXi.size === 0) {
          // Record infeasibility but don't halt
          emptyDomains.push(arcXi);
          continue;
        }

        // Enqueue all arcs (Xk, Xi) where Xk is a neighbor of Xi and Xk ≠ Xj
        var neighbors = neighborMap[arcXi];
        if (neighbors) {
          for (var ni = 0; ni < neighbors.length; ni++) {
            var neighborEntry = neighbors[ni];
            if (neighborEntry.neighbor !== arcXj) {
              queue.push({
                xi: neighborEntry.neighbor,
                xj: arcXi,
                check: neighborEntry.check
              });
            }
          }
        }
      }
    }

    // Log warning if max iterations exceeded before stability
    if (queue.length > 0 && iterations >= maxIterations) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[ProctorDistributionV2] AC-3: max iterations (' + maxIterations +
          ') reached before stability. Remaining arcs in queue: ' + queue.length
        );
      }
    }

    return {
      stable: queue.length === 0,
      iterations: iterations,
      emptyDomains: emptyDomains
    };
  }

  /**
   * Revises the domain of Xi with respect to Xj.
   * Removes values from domain(Xi) that have no support in domain(Xj).
   * @param {Map<string, Set<string>>} domains
   * @param {string} xi - Variable ID
   * @param {string} xj - Variable ID
   * @param {Function} check - Binary constraint check(val_xi, val_xj) → boolean
   * @returns {boolean} true if domain(Xi) was revised (at least one value removed)
   */
  function revise(domains, xi, xj, check) {
    var domainXi = domains.get(xi);
    var domainXj = domains.get(xj);

    // If either domain is missing or empty, nothing to revise
    if (!domainXi || domainXi.size === 0) return false;
    if (!domainXj || domainXj.size === 0) return false;

    var revised = false;
    var toRemove = [];

    domainXi.forEach(function (valX) {
      var hasSupport = false;
      domainXj.forEach(function (valY) {
        if (hasSupport) return; // short-circuit (forEach doesn't break, but we skip work)
        if (check(valX, valY)) {
          hasSupport = true;
        }
      });
      if (!hasSupport) {
        toRemove.push(valX);
      }
    });

    for (var i = 0; i < toRemove.length; i++) {
      domainXi.delete(toRemove[i]);
      revised = true;
    }

    return revised;
  }

  /**
   * Extracts singleton assignments (domains of size 1).
   * @param {Map<string, Set<string>>} domains
   * @returns {Map<string, string>} varId → proctorKey
   */
  function extractSingletons(domains) {
    var singletons = new Map();
    domains.forEach(function (domainSet, varId) {
      if (domainSet.size === 1) {
        // Get the single element from the Set
        var proctorKey;
        domainSet.forEach(function (val) { proctorKey = val; });
        singletons.set(varId, proctorKey);
      }
    });
    return singletons;
  }

  /**
   * Phase 1 Pre-pass: builds CSP, runs AC-3, extracts singletons, computes bounds.
   * @param {Object} input - GS2_Input_Contract
   * @returns {Object} Phase1Result
   */
  function phase1PrePass(input) {
    var startTime = Date.now();

    // Build CSP model
    var cspModel = buildCSPModel(
      input.scheduleEntries,
      input.proctorsList,
      input.exemptionsData,
      input.dutyData,
      input.examDistributionRules,
      input.options
    );

    // Record initial domain sizes for reduction calculation
    var initialDomainTotal = 0;
    cspModel.domains.forEach(function (domainSet) {
      initialDomainTotal += domainSet.size;
    });

    // Run AC-3
    var ac3Result = runAC3(cspModel, 1000);

    // Record final domain sizes
    var finalDomainTotal = 0;
    cspModel.domains.forEach(function (domainSet) {
      finalDomainTotal += domainSet.size;
    });
    var domainReductionPercent = initialDomainTotal > 0
      ? ((initialDomainTotal - finalDomainTotal) / initialDomainTotal) * 100
      : 0;

    // Extract singletons (only source of prefixed_assignments per requirement 2.4.1)
    var singletons = extractSingletons(cspModel.domains);

    // Compute bounds
    var totalTasks = cspModel.variables.length;
    var fixedReservedTasks = singletons.size;

    // numEligibleTeachers: count distinct proctorKeys that appear in at least one non-empty domain after AC-3
    var eligibleProctorSet = new Set();
    cspModel.domains.forEach(function (domainSet) {
      if (domainSet.size > 0) {
        domainSet.forEach(function (proctorKey) {
          eligibleProctorSet.add(proctorKey);
        });
      }
    });
    var numEligibleTeachers = eligibleProctorSet.size;

    var bounds = computeBounds(totalTasks, fixedReservedTasks, numEligibleTeachers);

    // Assemble diagnostics
    var phase1DurationMs = Date.now() - startTime;

    return {
      cspModel: cspModel,
      prefixedAssignments: singletons,
      lowerBound: bounds.lowerBound,
      upperBound: bounds.upperBound,
      diagnostics: {
        phase1DurationMs: phase1DurationMs,
        lowerBound: bounds.lowerBound,
        upperBound: bounds.upperBound,
        singletonCount: singletons.size,
        domainReductionPercent: Math.round(domainReductionPercent * 100) / 100,
        infeasibilities: ac3Result.emptyDomains.map(function (varId) {
          return { variable: varId, reason: 'empty domain after AC-3' };
        }),
        warnings: ac3Result.stable ? [] : ['AC-3 did not stabilize within 1000 iterations']
      }
    };
  }

  // ============================================================
  // PHASE 2: HUNGARIAN BUILD — STUBS
  // ============================================================

  /**
   * Builds a square cost matrix for a set of tasks and available proctors.
   * Rows = tasks, Cols = available proctors.
   * Pads with dummy columns (cost INFINITY_SENTINEL) when proctors < tasks.
   * Makes the matrix square by padding the smaller dimension.
   *
   * @param {Array} tasks - Array of task objects for costFunction
   * @param {Array} availableProctors - Array of { key, name, gender, ... }
   * @param {Object} loadState
   * @param {Object} options - Options for costFunction
   * @param {Object} weights - { alpha, beta, gamma }
   * @param {number} lowerBound
   * @returns {number[][]} Square cost matrix (n×n)
   */
  function buildCostMatrix(tasks, availableProctors, loadState, options, weights, lowerBound) {
    var nRows = tasks.length;
    var nCols = availableProctors.length;
    var n = Math.max(nRows, nCols);

    // Build n×n matrix filled with INFINITY_SENTINEL
    var matrix = new Array(n);
    for (var i = 0; i < n; i++) {
      matrix[i] = new Array(n);
      for (var j = 0; j < n; j++) {
        matrix[i][j] = INFINITY_SENTINEL;
      }
    }

    // Fill real cells: row i (task), col j (proctor)
    for (var ri = 0; ri < nRows; ri++) {
      for (var ci = 0; ci < nCols; ci++) {
        matrix[ri][ci] = costFunction(
          availableProctors[ci].key,
          tasks[ri],
          loadState,
          options,
          weights,
          lowerBound
        );
      }
    }

    return matrix;
  }

  /**
   * Hungarian/Munkres O(n³) algorithm for optimal assignment.
   * Potential-based implementation that finds the minimum-cost perfect matching
   * in a square cost matrix.
   *
   * @param {number[][]} costMatrix - Square cost matrix (n×n) with finite numeric values
   * @returns {number[]} assignment - assignment[row] = column index (0-based)
   * @throws {Error} If matrix is not square, empty rows exist, or contains invalid values
   */
  function hungarianSolver(costMatrix) {
    // Edge case: empty matrix
    if (!Array.isArray(costMatrix) || costMatrix.length === 0) {
      return [];
    }

    var n = costMatrix.length;

    // Edge case: 1×1 matrix
    if (n === 1) {
      if (!Array.isArray(costMatrix[0]) || costMatrix[0].length !== 1) {
        throw new Error('hungarianSolver: matrix is not square (row 0 has ' +
          (Array.isArray(costMatrix[0]) ? costMatrix[0].length : 0) + ' cols, expected 1)');
      }
      if (typeof costMatrix[0][0] !== 'number' || !isFinite(costMatrix[0][0])) {
        throw new Error('hungarianSolver: invalid value at [0][0]: ' + costMatrix[0][0]);
      }
      return [0];
    }

    // Validate square matrix and numeric values
    for (var row = 0; row < n; row++) {
      if (!Array.isArray(costMatrix[row])) {
        throw new Error('hungarianSolver: row ' + row + ' is not an array');
      }
      if (costMatrix[row].length !== n) {
        throw new Error('hungarianSolver: matrix is not square (row ' + row +
          ' has ' + costMatrix[row].length + ' cols, expected ' + n + ')');
      }
      for (var col = 0; col < n; col++) {
        if (typeof costMatrix[row][col] !== 'number' || isNaN(costMatrix[row][col])) {
          throw new Error('hungarianSolver: invalid value at [' + row + '][' + col + ']: ' +
            costMatrix[row][col]);
        }
      }
    }

    // Potential-based O(n³) Hungarian algorithm
    // Uses 1-based indexing internally; u[0] and v[0] are unused sentinels
    var u = new Array(n + 1);   // row potentials
    var v = new Array(n + 1);   // col potentials
    var p = new Array(n + 1);   // p[j] = row assigned to column j (1-based rows)
    var way = new Array(n + 1); // way[j] = previous column in augmenting path

    for (var idx = 0; idx <= n; idx++) {
      u[idx] = 0;
      v[idx] = 0;
      p[idx] = 0;
      way[idx] = 0;
    }

    for (var i = 1; i <= n; i++) {
      p[0] = i;
      var j0 = 0;

      var minv = new Array(n + 1);
      var used = new Array(n + 1);
      for (var k = 0; k <= n; k++) {
        minv[k] = Infinity;
        used[k] = false;
      }

      // Find augmenting path
      do {
        used[j0] = true;
        var i0 = p[j0];
        var delta = Infinity;
        var j1 = -1;

        for (var j = 1; j <= n; j++) {
          if (!used[j]) {
            var cur = costMatrix[i0 - 1][j - 1] - u[i0] - v[j];
            if (cur < minv[j]) {
              minv[j] = cur;
              way[j] = j0;
            }
            if (minv[j] < delta) {
              delta = minv[j];
              j1 = j;
            }
          }
        }

        // Update potentials
        for (var j = 0; j <= n; j++) {
          if (used[j]) {
            u[p[j]] += delta;
            v[j] -= delta;
          } else {
            minv[j] -= delta;
          }
        }

        j0 = j1;
      } while (p[j0] !== 0);

      // Trace back augmenting path
      while (j0 !== 0) {
        p[j0] = p[way[j0]];
        j0 = way[j0];
      }
    }

    // Build result: result[row] = assigned column (0-based)
    var result = new Array(n);
    for (var j = 1; j <= n; j++) {
      result[p[j] - 1] = j - 1;
    }

    return result;
  }

  /**
   * Computes the cost of assigning a proctor to a task.
   *
   * Hard constraints (return INFINITY_SENTINEL = 1e9):
   *   1. Proctor already used in this session (task.usedInSession.has(proctorKey))
   *
   * Soft constraint penalties:
   *   - 5 × group mismatch (proctor's group ≠ task.expectedGroup when respectMorningEvening)
   *   - 3 × same room repeat (proctor already assigned to this room previously)
   *   - 2 × subject specialty (proctor's specialty matches the exam subject)
   *   - 1 × no gender pair (same gender as first proctor in dual-proctor room)
   *
   * Load balancing penalty (fix C1+C2):
   *   - floor       = max(lowerBound, sessionMaxPrimaryLoad − 1)
   *   - loadPenalty = max(0, primaryLoad − floor)
   *   - cost += 4 × loadPenalty
   *     where primaryLoad = guardCount + dutyCount (duty-aware, fix C2)
   *     and sessionMaxPrimaryLoad is supplied via options (fix C1).
   *
   * Freshness bonus (fix C1):
   *   - cost += primaryLoad > 0 ? 0.5 : 0
   *     Half-point penalty on any teacher already used. Invariant: 0.5 < min(softPenalty) = 1
   *     so it never overrides a soft-constraint preference but breaks ties in favour of
   *     unused peers when soft penalties match (per design §1 (B)).
   *
   * @param {string} proctorKey
   * @param {Object} task - { scheduleEntry, roomKey, slotIndex, halfdayKey, sessionKey,
   *                          subjectName, expectedGroup, firstProctorGender, roomUseMap, usedInSession }
   * @param {Object} loadState
   * @param {Object} options - { respectMorningEvening, preferMixedGenderPair, noRoomRepeat,
   *                             avoidSpecialty, meAssignments, proctorSpecialties, proctorGenders,
   *                             sessionMaxPrimaryLoad }
   * @param {Object} weights - { alpha, beta, gamma } (passed for consistency, not directly used here)
   * @param {number} lowerBound - computed lower bound for load balancing
   * @returns {number}
   */
  function costFunction(proctorKey, task, loadState, options, weights, lowerBound) {
    // === Hard Constraint Checks ===

    // 1. Proctor already used in this session
    if (task.usedInSession && task.usedInSession.has(proctorKey)) {
      return INFINITY_SENTINEL;
    }

    // Post slot-metric switch (spec proctor-v2-slot-metric-reserves-affinity):
    // `getPrimaryLoad` returns slot-based primaryLoad (= guardSlotCount + dutyCount).
    // The per-class hard cap therefore bounds slot-level work — the user's
    // intended fairness axis (Requirement 2.7), not halfday-deduplicated work
    // as before. No source change here; the switch propagates through the read
    // path. The cap remains inactive when `options.classBoundsByProctorKey` is
    // absent (legacy callers / fixtures) and when `options.skipClassCap` is set
    // (last-resort unconstrained-pass fallback).
    if (options && options.classBoundsByProctorKey && !options.skipClassCap) {
      var classBounds = options.classBoundsByProctorKey[proctorKey];
      if (classBounds) {
        var postAssignmentPrimary = getPrimaryLoad(loadState, proctorKey) + 1;
        if (postAssignmentPrimary > classBounds.classUpperBound) {
          return INFINITY_SENTINEL;
        }
      }
    }

    // === Soft Constraint Penalties ===
    var cost = 0;

    // 1. Group mismatch (penalty: 5)
    if (options.respectMorningEvening && task.expectedGroup) {
      var proctorGroup = options.meAssignments && options.meAssignments[proctorKey];
      if (proctorGroup && proctorGroup !== task.expectedGroup) {
        cost += 5;
      }
    }

    // 2. Same room repeat (penalty: 3)
    if (options.noRoomRepeat && task.roomUseMap && task.roomKey) {
      var roomProctors = task.roomUseMap[task.roomKey];
      if (roomProctors) {
        // roomProctors can be a Set or an Array
        var hasProctor = (roomProctors instanceof Set)
          ? roomProctors.has(proctorKey)
          : (Array.isArray(roomProctors) && roomProctors.indexOf(proctorKey) !== -1);
        if (hasProctor) {
          cost += 3;
        }
      }
    }

    // 3. Subject specialty (penalty: 2)
    if (options.avoidSpecialty && task.subjectName) {
      var proctorSpecialty = options.proctorSpecialties && options.proctorSpecialties[proctorKey];
      if (proctorSpecialty && proctorSpecialty === task.subjectName) {
        cost += 2;
      }
    }

    // 4. No gender pair (penalty: 1)
    if (options.preferMixedGenderPair && task.slotIndex > 0 && task.firstProctorGender) {
      var proctorGender = options.proctorGenders && options.proctorGenders[proctorKey];
      if (proctorGender && proctorGender === task.firstProctorGender) {
        cost += 1;
      }
    }

    // === Load Balancing Penalty ===
    // Use primary load (guardCount + dutyCount) so the Hungarian cost is duty-aware.
    // loadState.dutyCount is populated by addDutyLoad during Phase 1 pre-pass, before Phase 2.
    //
    // Fix C1 (design §1 (B)): anchor the load penalty against the running session-wide max
    // primary load so that, even when lowerBound = 0, already-used teachers don't beat
    // unused peers on ties. The floor backs off by 1 from the current max so that the
    // first teacher to reach the new max is "free" to be picked, but the next pick should
    // prefer a fresh teacher.
    var primaryLoad = getPrimaryLoad(loadState, proctorKey);
    var sessionMaxPrimaryLoad = (options && typeof options.sessionMaxPrimaryLoad === 'number')
      ? options.sessionMaxPrimaryLoad
      : 0;
    var floor = Math.max(lowerBound, sessionMaxPrimaryLoad - 1);
    var loadPenalty = Math.max(0, primaryLoad - floor);
    cost += 4 * loadPenalty;

    // Uniform freshness bonus: any teacher already used pays a half-point.
    // Invariant: 0.5 < min(softPenalty) = 1, so this never overrides a soft-constraint
    // preference but breaks ties in favour of unused peers (design §1 (B)).
    cost += primaryLoad > 0 ? 0.5 : 0;

    return cost;
  }

  /**
   * Greedy fallback assignment (adapted from v1 logic).
   * For each task, picks the best available proctor based on costFunction scoring.
   * Leaves slots empty rather than violating hard constraints.
   *
   * @param {Array} tasks - Array of task objects to assign (unresolved tasks only)
   * @param {Array} availableProctors - Array of { key, proc, idx } objects
   * @param {Object} loadState - Current load state
   * @param {Object} options - Distribution options
   * @param {Object} weights - { alpha, beta, gamma }
   * @param {number} lowerBound - Load lower bound
   * @returns {{ assignments: Array<{taskIndex: number, proctorKey: string|null}>, shortages: number }}
   */
  function greedyFallback(tasks, availableProctors, loadState, options, weights, lowerBound) {
    var assignments = [];
    var shortages = 0;

    for (var ti = 0; ti < tasks.length; ti++) {
      var task = tasks[ti];
      var bestProctor = null;
      var bestCost = INFINITY_SENTINEL;

      for (var pi = 0; pi < availableProctors.length; pi++) {
        var proctor = availableProctors[pi];
        var cost = costFunction(proctor.key, task, loadState, options, weights, lowerBound);

        // Strict ordering: keep first finite candidate even when bestCost
        // started at INFINITY_SENTINEL so we never silently admit an
        // over-cap candidate via the `<` comparison alone.
        if (cost < bestCost) {
          bestCost = cost;
          bestProctor = proctor;
        }
      }

      // Defect 1 fix: if every available proctor scored INFINITY_SENTINEL
      // (e.g., over class cap, already used in session), leave the slot
      // empty rather than admitting a hard-constraint violation. Matches
      // Hungarian's dummy-row semantics so phase 2.75 can repair coverage
      // by swapping rather than inheriting an over-cap assignment.
      if (bestProctor !== null && bestCost < INFINITY_SENTINEL) {
        // Assign the best proctor to this task
        assignments.push({ taskIndex: ti, proctorKey: bestProctor.key });

        // Update load state
        var halfdayKey = task.halfdayKey || '';
        var teacherName = bestProctor.proc ? (bestProctor.proc.teacher_name || '') : '';
        addGuardLoad(loadState, bestProctor.key, halfdayKey, teacherName);

        // Mark proctor as used in this session to prevent same-session reuse
        if (task.usedInSession) {
          task.usedInSession.add(bestProctor.key);
        }
      } else {
        // Leave slot empty — cannot assign without violating hard constraints
        assignments.push({ taskIndex: ti, proctorKey: null });
        shortages++;
      }
    }

    return { assignments: assignments, shortages: shortages };
  }

  /**
   * Normalizes gender string to a consistent format.
   * @param {string} gender
   * @returns {string} 'M' or 'F' or ''
   */
  function normalizeGender(gender) {
    if (!gender) return '';
    var g = String(gender).trim();
    if (g === 'ذكر' || g === 'M' || g === 'm' || g === 'male') return 'M';
    if (g === 'أنثى' || g === 'F' || g === 'f' || g === 'female') return 'F';
    return g;
  }

  /**
   * Phase 2 Build: assigns proctors per half-day using Hungarian + Greedy Fallback.
   *
   * For each half-day group:
   *   1. Filter available proctors (not exempt, not duty, respecting reuse rules)
   *   2. Build tasks for each room slot
   *   3. For dual-proctor rooms: run Hungarian twice (pass 1 = primary, pass 2 = complement with gender preference)
   *   4. Check for dummy assignments -> invoke greedyFallback for unresolved tasks
   *   5. Enforce 1500ms timeout
   *
   * @param {Object} phase1Result - Result from phase1PrePass
   * @param {Object} input - GS2_Input_Contract
   * @param {function} rng - Seeded PRNG function
   * @returns {Object} Phase2Result { assignments, loadState, diagnostics }
   */
  function phase2Build(phase1Result, input, rng) {
    var startTime = Date.now();

    // Resolve the Phase 2 budget once at function entry. Honour
    // input.options.phase2TimeoutMs only when it coerces to a positive
    // number; everything else (undefined, 0, negative, NaN) falls back to
    // the module-level DEFAULT_PHASE2_TIMEOUT_MS. Infinity is allowed and
    // simply means the timeout guard never fires.
    var optionsBag   = input.options || {};
    var rawOverride  = Number(optionsBag.phase2TimeoutMs);
    var TIMEOUT_MS   = (rawOverride > 0) ? rawOverride : DEFAULT_PHASE2_TIMEOUT_MS;
    var timedOutFlag = false;

    var loadState = createLoadState();
    var result = [];
    var fallbackCount = 0;
    var fallbackHalfdays = [];
    var totalCost = 0;
    var totalAssignments = 0;

    var proctorsList = input.proctorsList;
    var scheduleEntries = input.scheduleEntries;
    var exemptionsData = input.exemptionsData || {};
    var dutyData = input.dutyData || {};
    var meAssignments = input.meAssignments || {};
    var rules = input.examDistributionRules || {};
    var options = input.options || {};
    var proctorsPerRoom = (rules && rules.proctorsPerRoom) || 1;
    var roomsList = (options && options.roomsList) || [];
    var allowHalfdayReuse = !!(options && options.allowHalfdayReuse);
    var allowDayReuse = !!(options && options.allowDayReuse);

    // Resolve weights
    var weights = { alpha: 3, beta: 1, gamma: 2 };
    if (input.customWeights && typeof input.customWeights === 'object' &&
        typeof input.customWeights.alpha === 'number') {
      weights = input.customWeights;
    } else if (input.weightsPreset && WEIGHTS_PRESETS[input.weightsPreset]) {
      weights = WEIGHTS_PRESETS[input.weightsPreset];
    }

    var lowerBound = (phase1Result && phase1Result.lowerBound) || 0;

    // Pre-compute proctor metadata
    var proctorMeta = [];
    for (var pi = 0; pi < proctorsList.length; pi++) {
      var proc = proctorsList[pi];
      proctorMeta.push({
        key: getProctorKey(proc, pi),
        name: proc.teacher_name || proc.teacher_name_fr || '',
        gender: normalizeGender(proc.gender),
        specialty: proc.specialty || '',
        index: pi,
        proc: proc
      });
    }

    // Build proctor lookup maps for costFunction options
    var proctorGenders = {};
    var proctorSpecialties = {};
    var meAssignmentsMap = {};
    for (var mi = 0; mi < proctorMeta.length; mi++) {
      proctorGenders[proctorMeta[mi].key] = proctorMeta[mi].gender;
      proctorSpecialties[proctorMeta[mi].key] = proctorMeta[mi].specialty;
    }

    // Boundary adapter (proctor-v2-key-shape-unification, Phase 1 init).
    // Built once per phase2Build invocation from `proctorsList`. Used at:
    //   - meAssignmentsMap build below (Edit Site #10, defensive — Task 7)
    //   - duty pre-pass below (Edit Site #11, Task 5 — CRITICAL)
    // External keys (cin, som, idx_N, __idx_N) all map to the canonical
    // algo-shape `cin || '__idx_' + idx` so internal `loadState` is closed
    // under one shape. See design.md §"Boundary Adapter Design".
    var keyAdapter = buildKeyAdapter(proctorsList);

    // Counter for orphan duty keys (external duty entries whose key matches
    // no proctor in proctorsList). Reported in phase2Result.diagnostics.
    var orphanDutyKeysCount = 0;
    // Counter for orphan meAssignments keys (defensive; Edit Site #10 Task 7).
    var orphanMeAssignmentsCount = 0;

    if (meAssignments && typeof meAssignments === 'object') {
      var meKeys = Object.keys(meAssignments);
      for (var mk = 0; mk < meKeys.length; mk++) {
        // Edit Site #10 (proctor-v2-key-shape-unification DEFENSIVE):
        // meAssignments is keyed by algo shape per v1 contract; the
        // adapter is identity for well-formed input. Defends against
        // legacy DB rows that may carry exemption-shape keys here (R3
        // from Risk Register).
        var canonicalMeKey = toCanonicalKey(keyAdapter, meKeys[mk]);
        if (canonicalMeKey) {
          meAssignmentsMap[canonicalMeKey] = meAssignments[meKeys[mk]];
        } else {
          orphanMeAssignmentsCount++;
        }
      }
    }

    // Pre-load duty into loadState
    var dutyDataKeys = Object.keys(dutyData);
    for (var dki = 0; dki < dutyDataKeys.length; dki++) {
      var dutyEntry = dutyData[dutyDataKeys[dki]];
      if (dutyEntry && typeof dutyEntry === 'object') {
        var dutyProctorKeys = Object.keys(dutyEntry);
        for (var dpi = 0; dpi < dutyProctorKeys.length; dpi++) {
          if (dutyEntry[dutyProctorKeys[dpi]]) {
            // Extract halfday from duty key: format "date|day|period|session|subject"
            var dutyParts = dutyDataKeys[dki].split('|');
            var dutyHdKey = '';
            if (dutyParts.length >= 3) {
              dutyHdKey = dutyParts[0] + '|' + (dutyParts[2] || 'صباحا');
            }
            if (dutyHdKey) {
              // Edit Site #11 (proctor-v2-key-shape-unification CRITICAL):
              // translate exemption-shape external duty key to canonical
              // shape before crossing the boundary into loadState. Orphan
              // keys (external entries that match no proctor in
              // proctorsList) are skipped and counted in diagnostics.
              var canonicalDutyKey = toCanonicalKey(keyAdapter, dutyProctorKeys[dpi]);
              if (canonicalDutyKey) {
                addDutyLoad(loadState, canonicalDutyKey, dutyHdKey, '');
              } else {
                orphanDutyKeysCount++;
              }
            }
          }
        }
      }
    }

    // Track room usage across all halfdays for "no room repeat" soft constraint
    var globalRoomUseMap = {};

    // Track all proctor keys placed by Phase 2 so far (across all halfdays/sessions).
    // Used to derive `sessionMaxPrimaryLoad`, the freshness-anchor consumed by
    // costFunction (see design.md §1 (B) and task 7). The Set is populated alongside
    // every successful guard placement (Hungarian pass 1, Hungarian pass 2, and the
    // greedy fallback).
    var phase2PlacedKeys = new Set();

    // Helper: compute max getPrimaryLoad over teachers already placed in Phase 2.
    // Returns 0 when no proctor has been placed yet (initial Hungarian invocation).
    // Recomputed once per Hungarian / greedyFallback invocation so the floor in
    // costFunction reflects the most recent state of `loadState` (which is mutated
    // in place by addGuardLoad).
    function computeSessionMaxPrimaryLoad() {
      var maxLoad = 0;
      phase2PlacedKeys.forEach(function (k) {
        var pl = getPrimaryLoad(loadState, k);
        if (pl > maxLoad) maxLoad = pl;
      });
      return maxLoad;
    }

    // Group schedule entries by halfday
    var halfdayGroups = {};
    for (var ei = 0; ei < scheduleEntries.length; ei++) {
      var entry = scheduleEntries[ei];
      var hdKey = computeHalfdayKey(entry);
      if (!halfdayGroups[hdKey]) {
        halfdayGroups[hdKey] = [];
      }
      halfdayGroups[hdKey].push({ entry: entry, entryIndex: ei });
    }

    // Sort halfday keys chronologically
    var halfdayKeysSorted = Object.keys(halfdayGroups).sort();

    // Helper: get rooms for a given entry (same logic as buildCSPModel)
    function getRoomsForEntry(scheduleEntry) {
      var levelName = scheduleEntry.level_name || '';
      if (roomsList && typeof roomsList === 'object' && !Array.isArray(roomsList)) {
        var levelRooms = roomsList[levelName];
        if (Array.isArray(levelRooms) && levelRooms.length > 0) {
          return levelRooms;
        }
        return [];
      }
      if (Array.isArray(roomsList) && roomsList.length > 0) {
        var filtered = roomsList.filter(function (r) {
          return (r.level_name || '') === levelName;
        });
        return filtered.length > 0 ? filtered : roomsList;
      }
      return [];
    }

    var guardSlotsByIndex = {};
    for (var gsi = 0; gsi < scheduleEntries.length; gsi++) {
      guardSlotsByIndex[gsi] = getRoomsForEntry(scheduleEntries[gsi]).length * proctorsPerRoom;
    }
    var eligibilityClasses = computeEligibilityClasses(
      proctorsList,
      scheduleEntries,
      exemptionsData,
      dutyData,
      loadState
    );
    var eligibleCountForBounds = 0;
    eligibilityClasses.forEach(function (cls) {
      eligibleCountForBounds += (cls.members || []).length;
    });
    var classBounds = computeClassBounds(
      eligibilityClasses,
      scheduleEntries,
      proctorsPerRoom,
      Number(input.D_expected) || 0,
      eligibleCountForBounds,
      guardSlotsByIndex
    );
    var classBoundsByProctorKey = {};
    var classIdByProctorKey = {};
    eligibilityClasses.forEach(function (cls, classId) {
      var bounds = classBounds.get(classId);
      for (var cm = 0; cm < (cls.members || []).length; cm++) {
        var member = cls.members[cm];
        classBoundsByProctorKey[member.key] = bounds;
        classIdByProctorKey[member.key] = classId;
      }
    });

    // Helper: get duty teachers for a schedule entry
    function getDutyTeachersForEntry(entryObj) {
      var dutyTeachers = [];
      var dutyTeacherKeys = [];
      var sessionDutyKey = getScheduleSessionKeyForDuty(entryObj) + '|' + (entryObj.subject_name || '');
      var legacyDutyKey = getLegacyScheduleSessionKey(entryObj) + '|' + (entryObj.subject_name || '');
      var dutyObj = dutyData[sessionDutyKey] || dutyData[legacyDutyKey];
      if (dutyObj && typeof dutyObj === 'object') {
        var dKeys = Object.keys(dutyObj);
        for (var d = 0; d < dKeys.length; d++) {
          if (dutyObj[dKeys[d]]) {
            dutyTeacherKeys.push(dKeys[d]);
            for (var tp = 0; tp < proctorMeta.length; tp++) {
              if (proctorMeta[tp].key === dKeys[d]) {
                dutyTeachers.push(proctorMeta[tp].name);
                break;
              }
            }
          }
        }
      }
      return { dutyTeachers: dutyTeachers, dutyTeacherKeys: dutyTeacherKeys };
    }

    // Helper: filter available proctors for a specific SESSION within a halfday.
    // Sessions within the same halfday are SEQUENTIAL (not concurrent),
    // so allowHalfdayReuse does NOT apply between sessions.
    // Only exclude proctors who are:
    // 1. Exempt for this specific session's entries
    // 2. Duty teacher for this specific session's entries
    // 3. Already assigned in a PREVIOUS halfday (if allowHalfdayReuse disabled) — 
    //    but NOT in the current halfday (since sessions are sequential)
    // 4. Already assigned today in a different halfday (if allowDayReuse disabled)
    function filterAvailableProctors(entries, halfdayKey) {
      var unavailableKeys = new Set();

      // Exclude proctors exempt or on duty for ANY entry in this session group
      for (var e = 0; e < entries.length; e++) {
        var ent = entries[e].entry;
        for (var p = 0; p < proctorMeta.length; p++) {
          var pKey = proctorMeta[p].key;
          if (unavailableKeys.has(pKey)) continue;
          if (isProctorExemptForEntry(proctorsList[p], p, ent, exemptionsData)) {
            unavailableKeys.add(pKey);
          } else if (isDutyTeacherForEntry(proctorsList[p], p, ent, dutyData)) {
            unavailableKeys.add(pKey);
          }
        }
      }

      // Exclude proctors already assigned in a DIFFERENT halfday today (if allowDayReuse disabled)
      // NOTE: We do NOT exclude proctors assigned in the CURRENT halfday,
      // because sessions within the same halfday are sequential and reuse is allowed.
      if (!allowDayReuse) {
        var dayPart = halfdayKey.split('|')[0];
        for (var lk2 in loadState) {
          if (loadState[lk2] && loadState[lk2].guardHalfdays) {
            var hasOtherHalfdayToday = false;
            loadState[lk2].guardHalfdays.forEach(function (hk) {
              if (hk.split('|')[0] === dayPart && hk !== halfdayKey) {
                hasOtherHalfdayToday = true;
              }
            });
            if (hasOtherHalfdayToday) unavailableKeys.add(lk2);
          }
        }
      }

      var available = [];
      for (var ap = 0; ap < proctorMeta.length; ap++) {
        if (!unavailableKeys.has(proctorMeta[ap].key)) {
          available.push(proctorMeta[ap]);
        }
      }
      return available;
    }

    // Process each halfday group
    for (var hdi = 0; hdi < halfdayKeysSorted.length; hdi++) {
      var currentHalfdayKey = halfdayKeysSorted[hdi];
      var halfdayEntries = halfdayGroups[currentHalfdayKey];

      // Check timeout (1500ms)
      if (Date.now() - startTime > TIMEOUT_MS) {
        timedOutFlag = true;
        break;
      }

      var expectedGroup = isMorningHalfday(currentHalfdayKey) ? 1 : 2;

      // Available proctors will be computed per-session inside the session loop
      // (since sessions are sequential, proctors can be reused between sessions)

      // Build tasks for this halfday — GROUP BY SESSION for sequential processing
      // Sessions within the same halfday are SEQUENTIAL (not concurrent),
      // so the same proctor CAN be assigned to multiple sessions.
      // We process each session separately with its own Hungarian pass.
      var sessionGroups = {};
      for (var he = 0; he < halfdayEntries.length; he++) {
        var halfdayEntry = halfdayEntries[he].entry;
        var halfdayEntryIndex = halfdayEntries[he].entryIndex;
        var entrySessionKey = getSessionKey(halfdayEntry);
        if (!sessionGroups[entrySessionKey]) {
          sessionGroups[entrySessionKey] = [];
        }
        sessionGroups[entrySessionKey].push({ entry: halfdayEntry, entryIndex: halfdayEntryIndex });
      }

      var sessionKeys = Object.keys(sessionGroups).sort();
      var allFirstSlotTasks = [];
      var allSecondSlotTasks = [];
      var allTaskMetadata = [];
      var allSecondSlotMetadata = [];
      var allPass1Assignments = {};
      var allPass2Assignments = {};
      var taskOffset = 0;
      var secondTaskOffset = 0;

      // Track which proctors are used in each session within this halfday
      var sessionUsedMap = {};

      // Process each session SEQUENTIALLY within the halfday
      for (var ski = 0; ski < sessionKeys.length; ski++) {
        var currentSessionKey = sessionKeys[ski];
        var sessionEntries = sessionGroups[currentSessionKey];

        if (!sessionUsedMap[currentSessionKey]) {
          sessionUsedMap[currentSessionKey] = new Set();
        }

        // Compute available proctors for THIS session
        // (proctors used in previous sessions of the same halfday remain available)
        var availableProctors = filterAvailableProctors(sessionEntries, currentHalfdayKey);

        var firstSlotTasks = [];
        var secondSlotTasks = [];
        var taskMetadata = [];
        var secondSlotMetadata = [];

        for (var se = 0; se < sessionEntries.length; se++) {
          var sessEntry = sessionEntries[se].entry;
          var sessEntryIndex = sessionEntries[se].entryIndex;
          var rooms = getRoomsForEntry(sessEntry);

          for (var ri = 0; ri < rooms.length; ri++) {
            var room = rooms[ri];
            var roomKey = getRoomConstraintKey(room);

            // First proctor slot (slotIndex = 0)
            firstSlotTasks.push({
              scheduleEntry: sessEntry,
              roomKey: roomKey,
              room: room,
              slotIndex: 0,
              halfdayKey: currentHalfdayKey,
              sessionKey: currentSessionKey,
              subjectName: sessEntry.subject_name || '',
              expectedGroup: expectedGroup,
              firstProctorGender: null,
              roomUseMap: globalRoomUseMap,
              usedInSession: sessionUsedMap[currentSessionKey]
            });
            taskMetadata.push({
              entry: sessEntry,
              room: room,
              entryIndex: sessEntryIndex,
              sessionKey: currentSessionKey
            });

            // Second proctor slot (slotIndex = 1) if proctorsPerRoom >= 2
            if (proctorsPerRoom >= 2) {
              secondSlotTasks.push({
                scheduleEntry: sessEntry,
                roomKey: roomKey,
                room: room,
                slotIndex: 1,
                halfdayKey: currentHalfdayKey,
                sessionKey: currentSessionKey,
                subjectName: sessEntry.subject_name || '',
                expectedGroup: expectedGroup,
                firstProctorGender: null,
                roomUseMap: globalRoomUseMap,
                usedInSession: sessionUsedMap[currentSessionKey]
              });
              secondSlotMetadata.push({
                entry: sessEntry,
                room: room,
                entryIndex: sessEntryIndex,
                sessionKey: currentSessionKey
              });
            }
          }
        }

        // Build costFunction options for this session
        var costOptions = {
          respectMorningEvening: !!(options.respectMorningEvening !== false && Object.keys(meAssignmentsMap).length > 0),
          preferMixedGenderPair: options.preferMixedGenderPair !== false,
          noRoomRepeat: options.noRoomRepeat !== false,
          avoidSpecialty: options.avoidSpecialty !== false,
          meAssignments: meAssignmentsMap,
          proctorSpecialties: proctorSpecialties,
          proctorGenders: proctorGenders,
          classBoundsByProctorKey: classBoundsByProctorKey,
          // sessionMaxPrimaryLoad is updated per Hungarian invocation below
          // (see costFunction floor / freshness term — design.md §1 (B)).
          sessionMaxPrimaryLoad: 0
        };

        // ===== PASS 1: First proctor slot (per session) =====
        var pass1Assignments = {};
        var unresolvedFirstSlot = [];

        if (firstSlotTasks.length > 0 && availableProctors.length > 0) {
          // Recompute right before Hungarian so the floor reflects the latest loadState.
          costOptions.sessionMaxPrimaryLoad = computeSessionMaxPrimaryLoad();
          var costMatrix1 = buildCostMatrix(firstSlotTasks, availableProctors, loadState, costOptions, weights, lowerBound);

          try {
            var assignment1 = hungarianSolver(costMatrix1);

            for (var ti = 0; ti < firstSlotTasks.length; ti++) {
              var assignedCol = assignment1[ti];
              if (assignedCol === undefined || assignedCol >= availableProctors.length ||
                  costMatrix1[ti][assignedCol] >= INFINITY_SENTINEL) {
                unresolvedFirstSlot.push(ti);
              } else {
                var assignedProctor = availableProctors[assignedCol];
                pass1Assignments[ti] = assignedProctor;

                addGuardLoad(loadState, assignedProctor.key, currentHalfdayKey, assignedProctor.name);
                sessionUsedMap[currentSessionKey].add(assignedProctor.key);
                phase2PlacedKeys.add(assignedProctor.key);

                if (!globalRoomUseMap[firstSlotTasks[ti].roomKey]) {
                  globalRoomUseMap[firstSlotTasks[ti].roomKey] = new Set();
                }
                globalRoomUseMap[firstSlotTasks[ti].roomKey].add(assignedProctor.key);

                totalCost += costMatrix1[ti][assignedCol];
                totalAssignments++;
              }
            }
          } catch (e) {
            // Hungarian failed -> use greedy fallback for this session
            fallbackCount++;
            fallbackHalfdays.push(currentHalfdayKey);
            for (var uf = 0; uf < firstSlotTasks.length; uf++) {
              unresolvedFirstSlot.push(uf);
            }
          }
        } else if (firstSlotTasks.length > 0) {
          for (var na = 0; na < firstSlotTasks.length; na++) {
            unresolvedFirstSlot.push(na);
          }
        }

        // Handle unresolved first slot tasks with greedyFallback
        if (unresolvedFirstSlot.length > 0) {
          if (fallbackHalfdays.indexOf(currentHalfdayKey) === -1) {
            fallbackCount++;
            fallbackHalfdays.push(currentHalfdayKey);
          }
          var unresolvedTasks1 = [];
          for (var ut1 = 0; ut1 < unresolvedFirstSlot.length; ut1++) {
            unresolvedTasks1.push(firstSlotTasks[unresolvedFirstSlot[ut1]]);
          }
          // Refresh anchor before greedy fallback so it sees the same floor as Hungarian.
          costOptions.sessionMaxPrimaryLoad = computeSessionMaxPrimaryLoad();
          var fallbackResult1 = greedyFallback(unresolvedTasks1, availableProctors, loadState, costOptions, weights, lowerBound);
          var fbAssignments1 = fallbackResult1.assignments || fallbackResult1;
          if (Array.isArray(fbAssignments1)) {
            for (var fr1 = 0; fr1 < fbAssignments1.length; fr1++) {
              var fbA1 = fbAssignments1[fr1];
              if (fbA1 && fbA1.proctorKey) {
                var origIdx1 = unresolvedFirstSlot[fr1];
                // Find proctor meta for this key
                var fbProctor1 = null;
                for (var fp1 = 0; fp1 < proctorMeta.length; fp1++) {
                  if (proctorMeta[fp1].key === fbA1.proctorKey) {
                    fbProctor1 = proctorMeta[fp1];
                    break;
                  }
                }
                if (fbProctor1) {
                  pass1Assignments[origIdx1] = fbProctor1;
                  sessionUsedMap[currentSessionKey].add(fbProctor1.key);
                  phase2PlacedKeys.add(fbProctor1.key);
                  if (!globalRoomUseMap[firstSlotTasks[origIdx1].roomKey]) {
                    globalRoomUseMap[firstSlotTasks[origIdx1].roomKey] = new Set();
                  }
                  globalRoomUseMap[firstSlotTasks[origIdx1].roomKey].add(fbProctor1.key);
                  totalAssignments++;
                }
              }
            }
          }
        }

        // ===== PASS 2: Second proctor slot (per session, if proctorsPerRoom >= 2) =====
        var pass2Assignments = {};
        var unresolvedSecondSlot = [];

        if (secondSlotTasks.length > 0) {
          // Update second slot tasks with first proctor's gender
          for (var s2i = 0; s2i < secondSlotTasks.length; s2i++) {
            var firstAssignment = pass1Assignments[s2i];
            if (firstAssignment) {
              secondSlotTasks[s2i].firstProctorGender = firstAssignment.gender || null;
            }
          }

          // All proctors remain available for pass 2.
          // The costFunction's hard constraint (usedInSession.has(key)) prevents
          // assigning the same proctor to two rooms in the same session.
          var pass2Available = [];
          for (var p2a = 0; p2a < availableProctors.length; p2a++) {
            pass2Available.push(availableProctors[p2a]);
          }

          if (pass2Available.length > 0) {
            // Refresh anchor before Hungarian pass 2 (loadState may have advanced via pass 1).
            costOptions.sessionMaxPrimaryLoad = computeSessionMaxPrimaryLoad();
            var costMatrix2 = buildCostMatrix(secondSlotTasks, pass2Available, loadState, costOptions, weights, lowerBound);

            try {
              var assignment2 = hungarianSolver(costMatrix2);

              for (var t2i = 0; t2i < secondSlotTasks.length; t2i++) {
                var assignedCol2 = assignment2[t2i];
                if (assignedCol2 === undefined || assignedCol2 >= pass2Available.length ||
                    costMatrix2[t2i][assignedCol2] >= INFINITY_SENTINEL) {
                  unresolvedSecondSlot.push(t2i);
                } else {
                  var assignedProctor2 = pass2Available[assignedCol2];
                  pass2Assignments[t2i] = assignedProctor2;

                  addGuardLoad(loadState, assignedProctor2.key, currentHalfdayKey, assignedProctor2.name);
                  sessionUsedMap[currentSessionKey].add(assignedProctor2.key);
                  phase2PlacedKeys.add(assignedProctor2.key);

                  if (!globalRoomUseMap[secondSlotTasks[t2i].roomKey]) {
                    globalRoomUseMap[secondSlotTasks[t2i].roomKey] = new Set();
                  }
                  globalRoomUseMap[secondSlotTasks[t2i].roomKey].add(assignedProctor2.key);

                  totalCost += costMatrix2[t2i][assignedCol2];
                  totalAssignments++;
                }
              }
            } catch (e) {
              // Hungarian failed for pass 2
              if (fallbackHalfdays.indexOf(currentHalfdayKey) === -1) {
                fallbackCount++;
                fallbackHalfdays.push(currentHalfdayKey);
              }
              for (var uf2 = 0; uf2 < secondSlotTasks.length; uf2++) {
                unresolvedSecondSlot.push(uf2);
              }
            }
          } else {
            for (var na2 = 0; na2 < secondSlotTasks.length; na2++) {
              unresolvedSecondSlot.push(na2);
            }
          }

          // Handle unresolved second slot tasks with greedyFallback
          if (unresolvedSecondSlot.length > 0) {
            if (fallbackHalfdays.indexOf(currentHalfdayKey) === -1) {
              fallbackCount++;
              fallbackHalfdays.push(currentHalfdayKey);
            }
            var unresolvedTasks2 = [];
            for (var ut2 = 0; ut2 < unresolvedSecondSlot.length; ut2++) {
              unresolvedTasks2.push(secondSlotTasks[unresolvedSecondSlot[ut2]]);
            }
            var pass2AvailForFb = [];
            for (var p2fb = 0; p2fb < availableProctors.length; p2fb++) {
              pass2AvailForFb.push(availableProctors[p2fb]);
            }
            // Refresh anchor before greedy fallback for pass 2.
            costOptions.sessionMaxPrimaryLoad = computeSessionMaxPrimaryLoad();
            var fallbackResult2 = greedyFallback(unresolvedTasks2, pass2AvailForFb, loadState, costOptions, weights, lowerBound);
            var fbAssignments2 = fallbackResult2.assignments || fallbackResult2;
            if (Array.isArray(fbAssignments2)) {
              for (var fr2 = 0; fr2 < fbAssignments2.length; fr2++) {
                var fbA2 = fbAssignments2[fr2];
                if (fbA2 && fbA2.proctorKey) {
                  var origIdx2 = unresolvedSecondSlot[fr2];
                  var fbProctor2 = null;
                  for (var fp2 = 0; fp2 < proctorMeta.length; fp2++) {
                    if (proctorMeta[fp2].key === fbA2.proctorKey) {
                      fbProctor2 = proctorMeta[fp2];
                      break;
                    }
                  }
                  if (fbProctor2) {
                    pass2Assignments[origIdx2] = fbProctor2;
                    sessionUsedMap[currentSessionKey].add(fbProctor2.key);
                    phase2PlacedKeys.add(fbProctor2.key);
                    if (!globalRoomUseMap[secondSlotTasks[origIdx2].roomKey]) {
                      globalRoomUseMap[secondSlotTasks[origIdx2].roomKey] = new Set();
                    }
                    globalRoomUseMap[secondSlotTasks[origIdx2].roomKey].add(fbProctor2.key);
                    totalAssignments++;
                  }
                }
              }
            }
          }
        }

        // Accumulate this session's results into the halfday-level accumulators
        for (var acc1 = 0; acc1 < firstSlotTasks.length; acc1++) {
          allFirstSlotTasks.push(firstSlotTasks[acc1]);
          allTaskMetadata.push(taskMetadata[acc1]);
          if (pass1Assignments[acc1]) {
            allPass1Assignments[taskOffset + acc1] = pass1Assignments[acc1];
          }
        }
        for (var acc2 = 0; acc2 < secondSlotTasks.length; acc2++) {
          allSecondSlotTasks.push(secondSlotTasks[acc2]);
          allSecondSlotMetadata.push(secondSlotMetadata[acc2]);
          if (pass2Assignments[acc2]) {
            allPass2Assignments[secondTaskOffset + acc2] = pass2Assignments[acc2];
          }
        }
        taskOffset += firstSlotTasks.length;
        secondTaskOffset += secondSlotTasks.length;

      } // END of session loop (ski)

      // ===== Build AssignmentRow objects for this halfday (from accumulated results) =====
      for (var ari = 0; ari < allFirstSlotTasks.length; ari++) {
        var taskEntry = allTaskMetadata[ari].entry;
        var taskRoom = allTaskMetadata[ari].room;
        var taskEntrySessionKey = allTaskMetadata[ari].sessionKey;
        var dutyInfo = getDutyTeachersForEntry(taskEntry);

        var proctorNames = [];
        var proctorKeysList = [];
        var proctorGroupLabels = [];

        // First proctor
        var firstProctor = allPass1Assignments[ari];
        if (firstProctor) {
          proctorNames.push(firstProctor.name || '');
          proctorKeysList.push(firstProctor.key || '');
          var fpGroup = meAssignmentsMap[firstProctor.key];
          proctorGroupLabels.push(fpGroup ? ('G' + fpGroup) : '');
        }

        // Second proctor (if dual-proctor room)
        if (proctorsPerRoom >= 2) {
          var secondProctor = allPass2Assignments[ari];
          if (secondProctor) {
            proctorNames.push(secondProctor.name || '');
            proctorKeysList.push(secondProctor.key || '');
            var spGroup = meAssignmentsMap[secondProctor.key];
            proctorGroupLabels.push(spGroup ? ('G' + spGroup) : '');
          }
        }

        // Compute group number and label
        var groupNumber = expectedGroup;
        var groupLabel = expectedGroup === 1 ? 'G1' : (expectedGroup === 2 ? 'G2' : '');

        // Build session label
        var sessionLabel = [
          taskEntry.day || '',
          taskEntry.period || '',
          taskEntry.session || ''
        ].filter(Boolean).join(' - ');

        var assignmentRow = {
          session_key: taskEntrySessionKey,
          session_label: sessionLabel,
          halfday_key: currentHalfdayKey,
          group_number: groupNumber,
          group_label: groupLabel,
          day: taskEntry.day || '',
          period: taskEntry.period || '',
          session: taskEntry.session || '',
          schedule_entry: taskEntry,
          level_name: taskEntry.level_name || '',
          subject_name: taskEntry.subject_name || '',
          duty_teachers: dutyInfo.dutyTeachers,
          duty_teacher_keys: dutyInfo.dutyTeacherKeys,
          room_name: taskRoom.roomName || taskRoom.room_name || '',
          room_number: taskRoom.room_num || taskRoom.room_number || '',
          room_key: getRoomConstraintKey(taskRoom),
          room_place: taskRoom.place || taskRoom.room_place || '',
          proctors: proctorNames,
          proctor_keys: proctorKeysList,
          proctor_groups: proctorGroupLabels,
          reserves: [],
          reserve_keys: [],
          notes: '',
          softViolations: []
        };

        result.push(assignmentRow);
      }
    }

    // Compute diagnostics
    var phase2DurationMs = Date.now() - startTime;
    var averageCostPerAssignment = totalAssignments > 0 ? totalCost / totalAssignments : 0;

    return {
      assignments: result,
      loadState: loadState,
      classBoundsByProctorKey: classBoundsByProctorKey,
      classIdByProctorKey: classIdByProctorKey,
      diagnostics: {
        phase2DurationMs: phase2DurationMs,
        phase2TimedOut: timedOutFlag,
        phase2TimeoutMs: TIMEOUT_MS,
        fallbackCount: fallbackCount,
        totalHalfdaysProcessed: halfdayKeysSorted.length,
        averageCostPerAssignment: Math.round(averageCostPerAssignment * 100) / 100,
        fallbackHalfdays: fallbackHalfdays,
        eligibilityClassCount: eligibilityClasses.size,
        classBounds: serializeClassBounds(classBounds),
        // Boundary adapter counters (proctor-v2-key-shape-unification).
        // Both 0 on well-formed input; non-zero indicates external data
        // (examDutyTeachersData, meAssignments) referenced a key that did
        // not match any proctor in proctorsList — orphans are skipped.
        orphanDutyKeys: orphanDutyKeysCount,
        orphanMeAssignments: orphanMeAssignmentsCount
      }
    };
  }

  // ============================================================
  // PHASE 2.5: RESERVE POPULATION
  // ============================================================

  /**
   * Enumerates the sessions belonging to a single halfday and returns them in
   * ascending order of (startTime, sessionKey).
   *
   * Co-located with `phase2_5PopulateReserves` — used by `computeAffinityRank`
   * to identify the "first" and "second" session of a halfday so the reserve
   * sort can prefer guards of the first session when filling the second
   * session's reserves (spec proctor-v2-slot-metric-reserves-affinity §4).
   *
   * `startTime` is read defensively from `row.schedule_entry.time_from` (the
   * canonical input field) and falls back to `row.time_from`, then finally to
   * the sessionKey itself so the sort still produces a stable total order on
   * legacy fixtures that omit time fields.
   *
   * @param {string} halfdayKey
   * @param {Object<string, Array>} sessionsBySessionKey
   * @returns {Array<{sessionKey: string, startTime: string}>}
   */
  function collectSessionsInHalfday(halfdayKey, sessionsBySessionKey) {
    var result = [];
    if (!halfdayKey || !sessionsBySessionKey) return result;
    var keys = Object.keys(sessionsBySessionKey);
    for (var i = 0; i < keys.length; i++) {
      var sk = keys[i];
      var rows = sessionsBySessionKey[sk];
      if (!rows || rows.length === 0) continue;
      var firstRow = rows[0];
      var rowHalfday = firstRow.halfday_key || '';
      if (rowHalfday !== halfdayKey) continue;
      var startTime = '';
      if (firstRow.schedule_entry && firstRow.schedule_entry.time_from) {
        startTime = firstRow.schedule_entry.time_from;
      } else if (firstRow.time_from) {
        startTime = firstRow.time_from;
      } else {
        startTime = sk;
      }
      result.push({ sessionKey: sk, startTime: startTime });
    }
    result.sort(function (a, b) {
      if (a.startTime < b.startTime) return -1;
      if (a.startTime > b.startTime) return 1;
      if (a.sessionKey < b.sessionKey) return -1;
      if (a.sessionKey > b.sessionKey) return 1;
      return 0;
    });
    return result;
  }

  /**
   * Computes the reserve-affinity rank for a candidate proctor in
   * `phase2_5PopulateReserves`'s candidate sort key. Returns `0` (preferred)
   * iff the current session is the SECOND session of its halfday AND the
   * candidate guarded at least one slot of the FIRST session of that halfday.
   * Returns `1` otherwise (affinity inapplicable or candidate not in S1).
   *
   * The reserve sort is `(reserveCount ASC, affinityRank ASC, finalLoad ASC,
   * tiebreak ASC)`, so spread dominates affinity, affinity dominates balance.
   * See spec proctor-v2-slot-metric-reserves-affinity §4.
   *
   * Edge cases:
   *   - halfday holds < 2 sessions → return 1 for everyone.
   *   - sessionKey is the first session → return 1 for everyone.
   *   - halfday > 2 sessions (data anomaly) → only second-by-startTime
   *     receives affinity; later sessions return 1.
   *   - missing firstSessionRows → log warning, return 1 (defensive).
   *   - falsy `proctor_keys` cells → ignored by the inner `IF k AND k = ...`.
   *
   * @param {string} candidateKey
   * @param {string} sessionKey
   * @param {string} halfdayKey
   * @param {Object<string, Array>} sessionsBySessionKey
   * @returns {number} 0 (preferred) or 1 (default)
   */
  function computeAffinityRank(candidateKey, sessionKey, halfdayKey, sessionsBySessionKey) {
    var halfdaySessions = collectSessionsInHalfday(halfdayKey, sessionsBySessionKey);
    if (halfdaySessions.length < 2) return 1;
    if (sessionKey !== halfdaySessions[1].sessionKey) return 1;
    var firstSessionKey = halfdaySessions[0].sessionKey;
    var firstSessionRows = sessionsBySessionKey ? sessionsBySessionKey[firstSessionKey] : null;
    if (!firstSessionRows) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[V2] computeAffinityRank: missing first-session rows for halfday ' + halfdayKey);
      }
      return 1;
    }
    for (var i = 0; i < firstSessionRows.length; i++) {
      var keys = firstSessionRows[i].proctor_keys || [];
      for (var j = 0; j < keys.length; j++) {
        var k = keys[j];
        if (k && k === candidateKey) return 0;
      }
    }
    return 1;
  }

  /**
   * Phase 2.5 Populate Reserves: fills `reserves` / `reserve_keys` per session,
   * honouring the v1 shared-reference invariant (all rows of the same session
   * carry the SAME array instance for both `reserves` and `reserve_keys`).
   *
   * Skeleton only — task 9. Subsequent tasks (10–13) will fill in:
   *   - target computation + zero short-circuit (task 10)
   *   - candidate pool with hard-constraint filters (task 11)
   *   - sort + slice + shared-reference assignment (task 12)
   *   - loadState updates via addReserveLoad (task 13)
   *
   * Task 14 (shortage handling) appends the v1-style shortage note
   * 'خصاص N احتياطي للحصة' to the first row of any session where
   * `chosen.length < target`, increments `sessionsWithShortage`, and never
   * throws or pads.
   *
   * Inputs/Outputs match design.md §3:
   *   - phase2Result: { assignments, loadState, diagnostics }
   *   - input:        GS2_Input_Contract (reads input.reservesConfig, input.proctorsList,
   *                   input.exemptionsData, input.dutyData, input.options)
   *   - rng:          seeded PRNG function (used for tie-breaks in later tasks)
   *
   * Mutates each row's `reserves` / `reserve_keys` in place (shared reference per
   * session). Mutates `loadState` via `addReserveLoad`.
   *
   * @param {Object} phase2Result - Result from phase2Build
   * @param {Object} input - GS2_Input_Contract
   * @param {function} rng - Seeded PRNG function
   * @returns {Object} Phase2_5Diagnostics
   */
  function phase2_5PopulateReserves(phase2Result, input, rng) {
    var startTime = Date.now();

    var assignments = (phase2Result && phase2Result.assignments) || [];

    // Group rows by session_key, preserving the v1 shared-reference invariant
    // (every row of a session will receive the SAME array reference for
    // `reserves` and `reserve_keys` once tasks 10–14 are implemented).
    var sessionsBySessionKey = Object.create(null);
    for (var i = 0; i < assignments.length; i++) {
      var row = assignments[i];
      var sessionKey = row.session_key;
      if (!sessionsBySessionKey[sessionKey]) {
        sessionsBySessionKey[sessionKey] = [];
      }
      sessionsBySessionKey[sessionKey].push(row);
    }

    // Build the iteration order: halfdayKey ASC then sessionKey ASC.
    var orderedSessionKeys = Object.keys(sessionsBySessionKey);
    orderedSessionKeys.sort(function (a, b) {
      var rowsA = sessionsBySessionKey[a];
      var rowsB = sessionsBySessionKey[b];
      var halfdayA = (rowsA[0] && rowsA[0].halfday_key) || '';
      var halfdayB = (rowsB[0] && rowsB[0].halfday_key) || '';
      if (halfdayA < halfdayB) return -1;
      if (halfdayA > halfdayB) return 1;
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

    // Diagnostics — populated incrementally by tasks 10–14.
    var diagnostics = {
      phase2_5DurationMs: 0,
      sessionsProcessed: 0,
      totalReservesPlaced: 0,
      sessionsWithShortage: 0,
      percentRoundedToZero: 0
    };

    var cfg = input && input.reservesConfig;

    // Resolve halfday/day reuse flags exactly like guard placement
    // (see filterAvailableProctors at line ≈1582 and violatesHardConstraints
    // at line ≈2387). Reserves must honour the same flags per Requirement 3.6.
    var phase2_5Options = (input && input.options) || {};
    var allowHalfdayReuse = !!phase2_5Options.allowHalfdayReuse;
    var allowDayReuse = !!phase2_5Options.allowDayReuse;

    var loadStateForReserves =
      (phase2Result && phase2Result.loadState) || {};
    var proctorsList = (input && input.proctorsList) || [];
    var exemptionsData = (input && input.exemptionsData) || {};

    for (var s = 0; s < orderedSessionKeys.length; s++) {
      var currentSessionKey = orderedSessionKeys[s];
      var sessionRows = sessionsBySessionKey[currentSessionKey];

      // Compute sessionGuards: unique array of proctor keys (strings) flattened
      // from all rows' `proctor_keys`, filtering out falsy values. Used both
      // for the percent-mode target denominator and (in task 11) to skip
      // already-assigned guards from the candidate pool.
      var sessionGuards = [];
      var seenGuardKeys = Object.create(null);
      for (var r = 0; r < sessionRows.length; r++) {
        var rowKeys = sessionRows[r].proctor_keys || [];
        for (var k = 0; k < rowKeys.length; k++) {
          var gKey = rowKeys[k];
          if (!gKey) continue;
          if (seenGuardKeys[gKey]) continue;
          seenGuardKeys[gKey] = true;
          sessionGuards.push(gKey);
        }
      }

      // 1. Compute target.
      var target = computeReserveTarget(cfg, sessionGuards.length);

      // Track percent-mode roundings to zero when guards exist (cfg.percent === 0
      // or percent × guards rounds to 0). Matches design.md §3 edge-case table.
      if (
        cfg &&
        cfg.mode === 'percent' &&
        sessionGuards.length > 0 &&
        target === 0
      ) {
        diagnostics.percentRoundedToZero++;
      }

      // Zero short-circuit: every row of this session gets the SAME empty array
      // references for reserves / reserve_keys (preserves the v1 shared-reference
      // invariant from design.md §"Data contract changes").
      if (target === 0) {
        var sharedEmptyReserves = [];
        var sharedEmptyReserveKeys = [];
        for (var rr = 0; rr < sessionRows.length; rr++) {
          sessionRows[rr].reserves = sharedEmptyReserves;
          sessionRows[rr].reserve_keys = sharedEmptyReserveKeys;
        }
        diagnostics.sessionsProcessed++;
        continue;
      }

      // Resolve the session's halfdayKey (every row in the same session shares
      // it; phase2Build sets it on every row). Used for duty / halfday-reuse /
      // day-reuse checks below.
      var halfdayKey = (sessionRows[0] && sessionRows[0].halfday_key) || '';
      var dayPart = halfdayKey.split('|')[0];

      // Build sessionGuards as a Set for O(1) membership tests in the candidate
      // filter below (we already iterated proctor_keys above to build the array
      // form for `target` computation).
      var sessionGuardSet = new Set(sessionGuards);

      // Build candidate pool with all four hard-constraint filters
      // (design.md §3 candidate pool step):
      //   1. Skip if proctor key is already a guard in the session.
      //   2. Skip if proctor is exempt for any row in the session.
      //   3. Skip if proctor is on duty during this halfday.
      //   4. Skip if halfday/day reuse is disabled and the proctor was already
      //      placed (as guard or reserve) in the relevant scope.
      var candidates = [];
      for (var pi = 0; pi < proctorsList.length; pi++) {
        var proc = proctorsList[pi];
        // Edit Site #17 (proctor-v2-key-shape-unification CRITICAL):
        // canonical-shape key for reserve candidates. Boundary lookups
        // against external exemption-shape data still happen INSIDE
        // isExemptForAnyRow / isDutyTeacherForEntry — they receive
        // (proc, pi) and rebuild the exemption key locally; they never
        // touch loadState. With this change, every key written to
        // sharedReserveKeys, addReserveLoad, and computeAffinityRank is
        // canonical-shape, closing the leak vector that surfaced as 6
        // ghost CIN keys in proctor_keys on tests/fixtures/45454.json.
        var key = getProctorKey(proc, pi);

        // (1) Already a guard in this session.
        if (sessionGuardSet.has(key)) continue;

        // (2) Exempt for any row in the session.
        if (isExemptForAnyRow(proc, pi, sessionRows, exemptionsData)) continue;

        var teacherLoad = loadStateForReserves[key];

        // (3) On duty during this halfday — `addDutyLoad` populates
        //     `dutyHalfdays` before Phase 2 (line ≈1471), so an O(1) Set lookup
        //     is sufficient.
        if (
          halfdayKey &&
          teacherLoad &&
          teacherLoad.dutyHalfdays &&
          teacherLoad.dutyHalfdays.has(halfdayKey)
        ) {
          continue;
        }

        // (4) Halfday / day reuse — match guard-placement semantics from
        //     filterAvailableProctors (line ≈1582). When `allowHalfdayReuse`
        //     is OFF, reject if the proctor is already used (guard or reserve)
        //     in this halfday. When `allowDayReuse` is OFF, reject if the
        //     proctor has any guard/reserve halfday whose date matches today.
        if (teacherLoad) {
          if (!allowHalfdayReuse && halfdayKey) {
            if (
              (teacherLoad.guardHalfdays && teacherLoad.guardHalfdays.has(halfdayKey)) ||
              (teacherLoad.reserveHalfdays && teacherLoad.reserveHalfdays.has(halfdayKey))
            ) {
              continue;
            }
          }
          if (!allowDayReuse && dayPart) {
            var dayConflict = false;
            if (teacherLoad.guardHalfdays) {
              teacherLoad.guardHalfdays.forEach(function (hk) {
                if (!dayConflict && hk && hk.split('|')[0] === dayPart) {
                  dayConflict = true;
                }
              });
            }
            if (!dayConflict && teacherLoad.reserveHalfdays) {
              teacherLoad.reserveHalfdays.forEach(function (hk) {
                if (!dayConflict && hk && hk.split('|')[0] === dayPart) {
                  dayConflict = true;
                }
              });
            }
            if (dayConflict) continue;
          }
        }

        var reserveCount =
          (teacherLoad && teacherLoad.reserveCount) || 0;
        var affinityRank = computeAffinityRank(
          key,
          currentSessionKey,
          halfdayKey,
          sessionsBySessionKey
        );
        candidates.push({
          key: key,
          proc: proc,
          idx: pi,
          reserveCount: reserveCount,
          affinityRank: affinityRank,
          finalLoad: getFinalLoad(loadStateForReserves, key),
          tiebreak: rng()
        });
      }

      // Sort candidates deterministically with the lexicographic key
      // (reserveCount ASC, affinityRank ASC, finalLoad ASC, tiebreak ASC).
      // Spec proctor-v2-slot-metric-reserves-affinity §5: spread dominates
      // affinity, affinity dominates balance, balance dominates the existing
      // random tiebreak. Fall-through across spread rings (reserveCount = 0
      // → 1 → 2 …) is implicit — no explicit ring loop needed.
      // The `tiebreak = rng()` snapshot is taken at candidate-build time
      // above so the same `randomSeed` reproduces the same reserve choices;
      // calling `rng()` from inside the comparator would yield inconsistent
      // results because JavaScript's sort calls comparators multiple times.
      candidates.sort(function (a, b) {
        if (a.reserveCount !== b.reserveCount) return a.reserveCount - b.reserveCount;
        if (a.affinityRank !== b.affinityRank) return a.affinityRank - b.affinityRank;
        if (a.finalLoad !== b.finalLoad) return a.finalLoad - b.finalLoad;
        return a.tiebreak - b.tiebreak;
      });

      // Slice to the configured target, capped by the number of eligible
      // candidates (no padding; shortage is detected in task 14).
      var sliceCount = target < candidates.length ? target : candidates.length;
      var chosen = candidates.slice(0, sliceCount);

      // Build the SHARED arrays once per session and assign the SAME references
      // to every row's `reserves` / `reserve_keys`. This invariant is required
      // by Phase 3's `applyReserveSwap` so a single swap propagates across all
      // rows of the session — see design.md §"Data contract changes" and the
      // High-impact "Shared-reference invariant" risk in §"Risk Register".
      var sharedReserves = [];
      var sharedReserveKeys = [];
      for (var ci = 0; ci < chosen.length; ci++) {
        var chosenProc = chosen[ci].proc || {};
        sharedReserves.push(chosenProc.teacher_name || '');
        sharedReserveKeys.push(chosen[ci].key);
      }
      for (var rrr = 0; rrr < sessionRows.length; rrr++) {
        sessionRows[rrr].reserves = sharedReserves;
        sessionRows[rrr].reserve_keys = sharedReserveKeys;
      }

      // Update loadState via addReserveLoad for every chosen reserve
      // (design.md §3 step 5). This keeps `reserveCount` / `reserveHalfdays`
      // consistent so that later sessions in the iteration order see the
      // up-to-date `getFinalLoad` and halfday-reuse state.
      for (var li = 0; li < chosen.length; li++) {
        var chosenForLoad = chosen[li];
        var chosenName =
          (chosenForLoad.proc && chosenForLoad.proc.teacher_name) || '';
        addReserveLoad(
          loadStateForReserves,
          chosenForLoad.key,
          halfdayKey,
          chosenName
        );
      }
      diagnostics.totalReservesPlaced += chosen.length;

      // Shortage handling (design.md §3 edge-case row "eligibleAvailable < target"):
      // if fewer candidates were eligible than the configured target, do NOT
      // throw and do NOT pad — just record the shortage and append the v1-style
      // note to the first row of the session. The exact note string and join
      // separator ('، ') match v1's reserve-population pass in
      // `exams-proctors.html` (line ≈4860 / 4868) so saved blobs round-trip.
      if (chosen.length < target) {
        diagnostics.sessionsWithShortage++;
        var firstRow = sessionRows[0];
        if (firstRow) {
          var missingReserves = target - chosen.length;
          var shortageNote = 'خصاص ' + missingReserves + ' احتياطي للحصة';
          var existingNotes = firstRow.notes || '';
          firstRow.notes = existingNotes
            ? existingNotes + '، ' + shortageNote
            : shortageNote;
        }
      }

      diagnostics.sessionsProcessed++;
    }

    diagnostics.phase2_5DurationMs = Date.now() - startTime;
    return diagnostics;
  }

  // Bound-aware predicate (proctor-v2-fairness-undercovered-fix):
  // include any proctor whose primary load is strictly below their
  // classLowerBound, not only the strictly zero-load case.
  function collectUncovered(proctorsList, classBoundsByProctorKey, loadState) {
    var result = [];
    var list = proctorsList || [];
    for (var i = 0; i < list.length; i++) {
      var key = getProctorKey(list[i], i);
      var bounds = classBoundsByProctorKey && classBoundsByProctorKey[key];
      if (bounds && getPrimaryLoad(loadState, key) < bounds.classLowerBound) {
        result.push({ key: key, proc: list[i], idx: i });
      }
    }
    return result;
  }

  function getProctorLookup(proctorsList) {
    var lookup = {};
    var list = proctorsList || [];
    for (var i = 0; i < list.length; i++) {
      lookup[getProctorKey(list[i], i)] = { key: getProctorKey(list[i], i), proc: list[i], idx: i };
    }
    return lookup;
  }

  function rowHasKeyOutsideSlot(row, slotIndex, key) {
    var keys = (row && row.proctor_keys) || [];
    for (var i = 0; i < keys.length; i++) {
      if (i !== slotIndex && keys[i] === key) return true;
    }
    return false;
  }

  function isKeyUsedInHalfday(rows, halfdayKey, key, excludeRow, excludeSlot) {
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.halfday_key !== halfdayKey) continue;
      var keys = row.proctor_keys || [];
      for (var k = 0; k < keys.length; k++) {
        if (row === excludeRow && k === excludeSlot) continue;
        if (keys[k] === key) return true;
      }
    }
    return false;
  }

  function isKeyUsedInDay(rows, dayKey, key, excludeRow, excludeSlot) {
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || ((row.halfday_key || '').split('|')[0]) !== dayKey) continue;
      var keys = row.proctor_keys || [];
      for (var k = 0; k < keys.length; k++) {
        if (row === excludeRow && k === excludeSlot) continue;
        if (keys[k] === key) return true;
      }
    }
    return false;
  }

  function swapPreservesHardConstraints(rows, row, slotIndex, T_uncov, loadState, input) {
    var entry = row.schedule_entry || {
      day: row.day || '',
      period: row.period || '',
      session: row.session || '',
      subject_name: row.subject_name || '',
      level_name: row.level_name || ''
    };
    if (isProctorExemptForEntry(T_uncov.proc, T_uncov.idx, entry, input.exemptionsData || {})) return false;
    if (isOnDutyDuringHalfday(T_uncov.key, row.halfday_key, loadState)) return false;
    if (rowHasKeyOutsideSlot(row, slotIndex, T_uncov.key)) return false;
    var options = (input && input.options) || {};
    if (!options.allowHalfdayReuse && isKeyUsedInHalfday(rows, row.halfday_key, T_uncov.key, row, slotIndex)) return false;
    var dayKey = (row.halfday_key || '').split('|')[0];
    if (!options.allowDayReuse && isKeyUsedInDay(rows, dayKey, T_uncov.key, row, slotIndex)) return false;
    return true;
  }

  function removeGuardLoad(loadState, key, halfdayKey, rows) {
    var entry = getTeacherLoad(loadState, key);
    if (entry.guardHalfdays && entry.guardHalfdays.has(halfdayKey)) {
      var stillUsed = false;
      for (var i = 0; i < (rows || []).length; i++) {
        var row = rows[i];
        if (!row || row.halfday_key !== halfdayKey) continue;
        var keys = row.proctor_keys || [];
        for (var k = 0; k < keys.length; k++) {
          if (keys[k] === key) {
            stillUsed = true;
            break;
          }
        }
        if (stillUsed) break;
      }
      if (!stillUsed) {
        if (entry.guardCount > 0) entry.guardCount--;
        entry.guardHalfdays.delete(halfdayKey);
        if (isMorningHalfday(halfdayKey)) {
          if (entry.morningCount > 0) entry.morningCount--;
        } else if (entry.afternoonCount > 0) {
          entry.afternoonCount--;
        }
      }
    }
  }

  function applyCoverageSwap(row, slotIndex, T_uncov, T_over, loadState, rows) {
    row.proctor_keys[slotIndex] = T_uncov.key;
    row.proctors[slotIndex] = T_uncov.proc.teacher_name || T_uncov.proc.teacher_name_fr || '';
    if (row.proctor_groups && row.proctor_groups.length > slotIndex) row.proctor_groups[slotIndex] = '';
    removeGuardLoad(loadState, T_over.key, row.halfday_key, rows);
    addGuardLoad(loadState, T_uncov.key, row.halfday_key, T_uncov.proc.teacher_name || T_uncov.proc.teacher_name_fr || '');
  }

  // Post slot-metric switch (spec proctor-v2-slot-metric-reserves-affinity):
  // The peer-eligibility filter inside `buildSwapCandidates` reads
  // `getPrimaryLoad(loadState, T_over_key)` (slot-based after Phase A) and
  // compares against the relaxation threshold (`classUB+1`, `classUB`, or
  // `classLB+1`). The metric switch makes the swap-eligibility decision bind
  // the new metric automatically — no source change. The three-tier
  // relaxation strategy from `proctor-v2-strict-fairness-coverage`
  // (`>= classUB+1`, then `>= classUB`, then `>= classLB+1`) is preserved
  // verbatim (Requirement 3.4, 3.9).
  function buildSwapCandidates(rows, T_uncov, classId, loadState, threshold, input, classIdByProctorKey, proctorLookup) {
    var candidates = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var keys = (row && row.proctor_keys) || [];
      for (var slot = 0; slot < keys.length; slot++) {
        var overKey = keys[slot];
        if (!overKey) continue;
        if (classIdByProctorKey[overKey] !== classId) continue;
        if (getPrimaryLoad(loadState, overKey) < threshold) continue;
        var over = proctorLookup[overKey] || { key: overKey, proc: { teacher_name: row.proctors && row.proctors[slot] || '' }, idx: -1 };
        if (!swapPreservesHardConstraints(rows, row, slot, T_uncov, loadState, input)) continue;
        candidates.push({ row: row, rowIndex: i, slotIndex: slot, T_over: over });
      }
    }
    return candidates;
  }

  // Spec: proctor-v2-fairness-undercovered-fix (task 4.1 extension)
  //
  // The repair pass is wrapped in a fixed-point outer loop. Each round
  // re-collects under-bound proctors via `collectUncovered` and performs at
  // most one swap per pending proctor. After a proctor is lifted from
  // load=0 to load=1 (still below classLowerBound=2 in the real-centre
  // case), the next round picks them up again and tries to lift them
  // further. Convergence is reached when either:
  //   (a) `collectUncovered` returns an empty list (after filtering keys
  //       previously marked unresolved, which we do not retry), OR
  //   (b) a round makes zero swaps (stuck — every pending key has been
  //       marked unresolved with an appropriate reason), OR
  //   (c) the 50 ms time budget elapses, OR
  //   (d) the safety cap of 10 rounds is reached (in practice 2-3 suffice).
  //
  // `seenUnresolvedKeys` dedupes the unresolved diagnostics across rounds
  // so a key flagged in round N (e.g. `no_swappable_peer`) is not retried
  // and not re-counted in subsequent rounds.
  function phase2_75CoverageRepair(phase2Result, phase2_5Diagnostics, classBoundsByProctorKey, input, rng) {
    var startTime = Date.now();
    var TIME_BUDGET_MS = 50;
    var MAX_ROUNDS = 10;
    try {
      var rows = (phase2Result && phase2Result.assignments) || [];
      var loadState = (phase2Result && phase2Result.loadState) || {};
      var classIds = (phase2Result && phase2Result.classIdByProctorKey) || {};
      // diagnostics.warnings is a per-proctor Object map keyed by canonical
      // proctorKey. Each value carries the structured payload
      // { reason, initialLoad, finalLoad, classLowerBound, attemptedSwaps }.
      // The synthetic key '__pass__' (see catch-path return below) signals
      // "the entire pass threw" rather than "a specific proctor failed", so
      // consumers MUST exclude '__pass__' when counting per-proctor failures.
      var diagnostics = { swaps: 0, unresolved: 0, durationMs: 0, warnings: {} };
      var lookup = getProctorLookup(input.proctorsList || []);
      var seenUnresolvedKeys = {};
      for (var round = 0; round < MAX_ROUNDS; round++) {
        if (Date.now() - startTime > TIME_BUDGET_MS) break;
        var uncovered = collectUncovered(input.proctorsList || [], classBoundsByProctorKey || {}, loadState);
        var pending = [];
        for (var u = 0; u < uncovered.length; u++) {
          if (!seenUnresolvedKeys[uncovered[u].key]) pending.push(uncovered[u]);
        }
        if (pending.length === 0) break;
        var tiebreak = {};
        for (var t = 0; t < pending.length; t++) tiebreak[pending[t].key] = rng ? rng() : 0;
        pending.sort(function (a, b) {
          var ca = classIds[a.key] || '';
          var cb = classIds[b.key] || '';
          if (ca < cb) return -1;
          if (ca > cb) return 1;
          return (tiebreak[a.key] || 0) - (tiebreak[b.key] || 0);
        });
        var roundSwaps = 0;
        for (var i = 0; i < pending.length; i++) {
          if (Date.now() - startTime > TIME_BUDGET_MS) {
            for (var rem = i; rem < pending.length; rem++) {
              if (!seenUnresolvedKeys[pending[rem].key]) {
                var remBounds = classBoundsByProctorKey && classBoundsByProctorKey[pending[rem].key];
                var remLoad = getPrimaryLoad(loadState, pending[rem].key);
                diagnostics.unresolved++;
                // Best-effort payload — for time-budget bail we may not have
                // computed initialLoad/etc. for these proctors yet.
                diagnostics.warnings[pending[rem].key] = {
                  reason: 'time_budget',
                  initialLoad: remLoad,
                  finalLoad: remLoad,
                  classLowerBound: (remBounds && remBounds.classLowerBound) || 0,
                  attemptedSwaps: 0
                };
                seenUnresolvedKeys[pending[rem].key] = true;
              }
            }
            break;
          }
          var uncov = pending[i];
          var bounds = classBoundsByProctorKey && classBoundsByProctorKey[uncov.key];
          var classId = classIds[uncov.key];
          if (!bounds || !classId) {
            var ncbLoad = getPrimaryLoad(loadState, uncov.key);
            diagnostics.unresolved++;
            diagnostics.warnings[uncov.key] = {
              reason: 'no_class_bounds',
              initialLoad: ncbLoad,
              finalLoad: ncbLoad,
              classLowerBound: 0,
              attemptedSwaps: 0
            };
            seenUnresolvedKeys[uncov.key] = true;
            continue;
          }

          // === INNER REPAIR LOOP (Option A — primary fix, change site #1) ===
          // Re-target the same uncovered proctor until they reach
          // bounds.classLowerBound or no candidate is returned. Each successful
          // applyCoverageSwap mutates loadState, so candidates MUST be rebuilt
          // inside the WHILE against current loadState (no caching).
          var initialLoad = getPrimaryLoad(loadState, uncov.key);
          var attemptedSwaps = 0;
          var successfulSwaps = 0;
          while (getPrimaryLoad(loadState, uncov.key) < bounds.classLowerBound) {
            if (Date.now() - startTime > TIME_BUDGET_MS) break;
            var candidates = buildSwapCandidates(rows, uncov, classId, loadState, bounds.classUpperBound + 1, input, classIds, lookup);
            if (candidates.length === 0) {
              candidates = buildSwapCandidates(rows, uncov, classId, loadState, bounds.classUpperBound, input, classIds, lookup);
            }
            if (candidates.length === 0) break;
            // Count actual swap attempts (a non-empty candidate set was found
            // and applyCoverageSwap is about to be called), NOT WHILE-iteration
            // entries. This makes the reason boundary
            //   (attemptedSwaps === 0 ? 'no_swappable_peer' : 'no_eligible_donor')
            // meaningful: attemptedSwaps === 0 ⇔ no candidate was ever returned
            // for this uncovered proctor.
            attemptedSwaps++;
            candidates.sort(function (a, b) {
              var la = getPrimaryLoad(loadState, a.T_over.key);
              var lb = getPrimaryLoad(loadState, b.T_over.key);
              if (la !== lb) return lb - la;
              if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
              return a.slotIndex - b.slotIndex;
            });
            applyCoverageSwap(candidates[0].row, candidates[0].slotIndex, uncov, candidates[0].T_over, loadState, rows);
            diagnostics.swaps++;
            successfulSwaps++;
            roundSwaps++;
          }

          var finalLoad = getPrimaryLoad(loadState, uncov.key);
          if (finalLoad < bounds.classLowerBound) {
            diagnostics.unresolved++;
            diagnostics.warnings[uncov.key] = {
              reason: (attemptedSwaps === 0 ? 'no_swappable_peer' : 'no_eligible_donor'),
              initialLoad: initialLoad,
              finalLoad: finalLoad,
              classLowerBound: bounds.classLowerBound,
              attemptedSwaps: attemptedSwaps
            };
            seenUnresolvedKeys[uncov.key] = true;
          }
        }
        if (roundSwaps === 0) break;
      }
      // Post-condition: diagnostics.unresolved must equal the number of
      // non-__pass__ keys in diagnostics.warnings. The per-proctor map
      // shape from Task 6.1 enforces this by construction (each unresolved
      // proctor produces exactly one map entry). The defensive check below
      // surfaces diagnostics regressions in tests (e.g. a future change
      // that decrements unresolved or removes a warning entry without
      // keeping them in sync). It does NOT throw — production keeps
      // running with whatever counter/map drift exists.
      var __unresolvedCheckKeys = Object.keys(diagnostics.warnings || {}).filter(function (k) {
        return k !== '__pass__';
      });
      if (diagnostics.unresolved !== __unresolvedCheckKeys.length) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn(
            '[V2] phase2_75CoverageRepair post-condition violated: ' +
            'diagnostics.unresolved=' + diagnostics.unresolved +
            ' but |non-__pass__ warnings|=' + __unresolvedCheckKeys.length +
            ' (warnings keys=' + JSON.stringify(Object.keys(diagnostics.warnings || {})) + ')'
          );
        }
      }
      diagnostics.durationMs = Date.now() - startTime;
      return diagnostics;
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[V2] phase2_75CoverageRepair internal error:', err);
      }
      // Pass-level catch: the entire repair pass threw before completion.
      // We use the synthetic key '__pass__' (not a valid canonical proctor
      // key — '__' prefix is reserved by the algorithm) so consumers can
      // distinguish "the pass threw" from "a specific proctor failed".
      // Consumers MUST exclude '__pass__' when counting per-proctor failures.
      return { swaps: 0, unresolved: 0, durationMs: 0, warnings: { '__pass__': { reason: 'pass_threw', error: String(err && err.message || err) } } };
    }
  }

  function computeMaxGapWithinClass(classIdByProctorKey, loadState) {
    var grouped = {};
    var keys = Object.keys(classIdByProctorKey || {});
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var classId = classIdByProctorKey[key];
      if (!grouped[classId]) grouped[classId] = [];
      grouped[classId].push(getPrimaryLoad(loadState, key));
    }
    var maxGap = 0;
    var classIds = Object.keys(grouped);
    for (var c = 0; c < classIds.length; c++) {
      var values = grouped[classIds[c]];
      if (!values.length) continue;
      var min = values[0];
      var max = values[0];
      for (var v = 1; v < values.length; v++) {
        if (values[v] < min) min = values[v];
        if (values[v] > max) max = values[v];
      }
      if (max - min > maxGap) maxGap = max - min;
    }
    return maxGap;
  }

  function computeActualDutyPairs(proctorsList, classBoundsByProctorKey, loadState) {
    var total = 0;
    var list = proctorsList || [];
    for (var i = 0; i < list.length; i++) {
      var key = getProctorKey(list[i], i);
      if (!classBoundsByProctorKey || !classBoundsByProctorKey[key]) continue;
      var entry = loadState && loadState[key];
      total += entry && typeof entry.dutyCount === 'number' ? entry.dutyCount : 0;
    }
    return total;
  }

  // ============================================================
  // PHASE 3: SIMULATED ANNEALING
  // ============================================================

  /**
   * Computes the objective function for SA optimization.
   * f(solution) = α × std(combinedLoads) + β × totalSoftViolations + γ × morningEveningImbalance
   *
   * Where:
   * - std(combinedLoads) = population standard deviation of (guardAppearances + reserveHalfdays)
   *   per proctor across all rows. Guard appearances are counted per row (multiple rooms in the
   *   same halfday count separately), matching guard placement semantics. Reserves are counted
   *   per UNIQUE halfday per proctor — because Phase 2.5 gives every row of a session the same
   *   `reserve_keys` array reference (v1 shared-reference invariant), a naive per-row walk
   *   would multiply each reserve assignment by the number of rows in the session. Tracking
   *   unique halfdays mirrors `addReserveLoad`/`getFinalLoad` semantics. Duty is not visible
   *   in row data here; it is incorporated upstream via Phase 2's `costFunction` (which uses
   *   `getPrimaryLoad`) and via the `loadState` that the SA may consult elsewhere.
   * - totalSoftViolations = sum of softViolations array lengths across all rows
   * - morningEveningImbalance = Σ |morningCount_i - afternoonCount_i| for each proctor i
   *   that has assignments (morning = halfday_key ends with |صباحا, afternoon = |مساء)
   *
   * @param {Array} assignments - Array of AssignmentRow objects
   * @param {Object} weights - { alpha, beta, gamma }
   * @param {Object} input - GS2_Input_Contract (for proctor list, meAssignments, etc.)
   * @returns {number} objective value (lower is better)
   */
  function objectiveFunction(assignments, weights, input) {
    if (!assignments || assignments.length === 0) return 0;

    var alpha = weights.alpha || 0;
    var beta = weights.beta || 0;
    var gamma = weights.gamma || 0;

    // Compute combined loads per proctor:
    // - guardCount: number of appearances in `proctor_keys` across all rows
    // - reserveHalfdays: set (object) of unique halfday_keys where the proctor appears in
    //   `reserve_keys`. Reserves arrays are shared across rows of the same session, so we
    //   deduplicate by halfdayKey to avoid inflating reserve count by the session's row fan-out.
    var proctorLoads = {};  // proctorKey -> { guardCount, reserveHalfdays, morningHalfdays, afternoonHalfdays }

    for (var i = 0; i < assignments.length; i++) {
      var row = assignments[i];
      var keys = row.proctor_keys || [];
      var reserveKeys = row.reserve_keys || [];
      var halfdayKey = row.halfday_key || '';
      var isMorning = isMorningHalfday(halfdayKey);

      for (var k = 0; k < keys.length; k++) {
        var pKey = keys[k];
        if (!pKey) continue;
        if (!proctorLoads[pKey]) {
          proctorLoads[pKey] = { guardCount: 0, reserveHalfdays: {}, morningHalfdays: {}, afternoonHalfdays: {} };
        }
        // Count each appearance in proctors arrays (not unique halfdays)
        proctorLoads[pKey].guardCount++;
        // Track unique halfdays for morning/evening imbalance
        if (isMorning) {
          proctorLoads[pKey].morningHalfdays[halfdayKey] = true;
        } else {
          proctorLoads[pKey].afternoonHalfdays[halfdayKey] = true;
        }
      }

      // Walk reserves: dedupe by halfdayKey per proctor (shared-reference invariant from Phase 2.5).
      for (var rk = 0; rk < reserveKeys.length; rk++) {
        var rKey = reserveKeys[rk];
        if (!rKey) continue;
        if (!proctorLoads[rKey]) {
          proctorLoads[rKey] = { guardCount: 0, reserveHalfdays: {}, morningHalfdays: {}, afternoonHalfdays: {} };
        }
        if (halfdayKey) {
          proctorLoads[rKey].reserveHalfdays[halfdayKey] = true;
        }
      }
    }

    // Component 1: std(combinedLoads) — population std on (guardAppearances + uniqueReserveHalfdays).
    // Matches getFinalLoad semantics modulo duty (duty isn't carried on assignment rows).
    var proctorKeys = Object.keys(proctorLoads);
    var stdGuardLoads = 0;
    if (proctorKeys.length > 0) {
      var loads = [];
      var sum = 0;
      for (var pi = 0; pi < proctorKeys.length; pi++) {
        var pl = proctorLoads[proctorKeys[pi]];
        var load = pl.guardCount + Object.keys(pl.reserveHalfdays).length;
        loads.push(load);
        sum += load;
      }
      var mean = sum / loads.length;
      var variance = 0;
      for (var vi = 0; vi < loads.length; vi++) {
        var diff = loads[vi] - mean;
        variance += diff * diff;
      }
      variance /= loads.length;
      stdGuardLoads = Math.sqrt(variance);
    }

    // Component 2: totalSoftViolations - sum of softViolations array lengths
    var totalSoftViolations = 0;
    for (var si = 0; si < assignments.length; si++) {
      var sv = assignments[si].softViolations;
      if (sv && Array.isArray(sv)) {
        totalSoftViolations += sv.length;
      }
    }

    // Component 3: morningEveningImbalance = Σ |morningCount_i - afternoonCount_i|
    // For each proctor, count how many morning halfdays vs afternoon halfdays they're assigned to
    var morningEveningImbalance = 0;
    for (var mi = 0; mi < proctorKeys.length; mi++) {
      var pLoad = proctorLoads[proctorKeys[mi]];
      var morningCount = Object.keys(pLoad.morningHalfdays).length;
      var afternoonCount = Object.keys(pLoad.afternoonHalfdays).length;
      morningEveningImbalance += Math.abs(morningCount - afternoonCount);
    }

    return alpha * stdGuardLoads + beta * totalSoftViolations + gamma * morningEveningImbalance;
  }

  /**
   * Resolves the weights to use for the objective function.
   * Supports three presets and custom override.
   * @param {Object} input - GS2_Input_Contract
   * @returns {{ weights: Object, presetName: string }}
   */
  function resolveWeights(input) {
    if (input.customWeights && typeof input.customWeights === 'object' &&
        typeof input.customWeights.alpha === 'number' &&
        typeof input.customWeights.beta === 'number' &&
        typeof input.customWeights.gamma === 'number') {
      return {
        weights: { alpha: input.customWeights.alpha, beta: input.customWeights.beta, gamma: input.customWeights.gamma },
        presetName: 'custom'
      };
    }
    if (input.weightsPreset && WEIGHTS_PRESETS[input.weightsPreset]) {
      return {
        weights: WEIGHTS_PRESETS[input.weightsPreset],
        presetName: input.weightsPreset
      };
    }
    // Default: "توازن"
    return {
      weights: WEIGHTS_PRESETS['توازن'],
      presetName: 'توازن'
    };
  }

  /**
   * Deep copies an array of assignment rows for SA manipulation.
   * @param {Array} assignments
   * @returns {Array}
   */
  function deepCopyAssignments(assignments) {
    var copy = new Array(assignments.length);
    for (var i = 0; i < assignments.length; i++) {
      var row = assignments[i];
      copy[i] = {
        session_key: row.session_key,
        session_label: row.session_label,
        halfday_key: row.halfday_key,
        group_number: row.group_number,
        group_label: row.group_label,
        day: row.day,
        period: row.period,
        session: row.session,
        schedule_entry: row.schedule_entry,
        level_name: row.level_name,
        subject_name: row.subject_name,
        duty_teachers: row.duty_teachers ? row.duty_teachers.slice() : [],
        duty_teacher_keys: row.duty_teacher_keys ? row.duty_teacher_keys.slice() : [],
        room_name: row.room_name,
        room_number: row.room_number,
        room_key: row.room_key,
        room_place: row.room_place,
        proctors: row.proctors ? row.proctors.slice() : [],
        proctor_keys: row.proctor_keys ? row.proctor_keys.slice() : [],
        proctor_groups: row.proctor_groups ? row.proctor_groups.slice() : [],
        reserves: row.reserves ? row.reserves.slice() : [],
        reserve_keys: row.reserve_keys ? row.reserve_keys.slice() : [],
        notes: row.notes || '',
        softViolations: row.softViolations ? row.softViolations.slice() : []
      };
    }
    return copy;
  }

  /**
   * Checks if a move violates hard constraints.
   * Hard constraints:
   *   - No proctor appears twice in same session
   *   - No exempt proctor assigned
   *   - No duty teacher assigned to their subject
   *   - Halfday/day reuse rules respected
   *
   * @param {Array} assignments - Current solution
   * @param {Object} input - GS2_Input_Contract
   * @returns {boolean} true if any hard constraint is violated
   */
  function violatesHardConstraints(assignments, input) {
    var options = input.options || {};
    var allowHalfdayReuse = !!(options.allowHalfdayReuse);
    var allowDayReuse = !!(options.allowDayReuse);

    // Build session -> proctor keys map
    var sessionProctors = {};
    // Build halfday -> proctor keys map
    var halfdayProctors = {};
    // Build day -> proctor keys map
    var dayProctors = {};

    for (var i = 0; i < assignments.length; i++) {
      var row = assignments[i];
      var sessionKey = row.session_key || '';
      var halfdayKey = row.halfday_key || '';
      var dayKey = halfdayKey.split('|')[0] || '';
      var keys = row.proctor_keys || [];

      for (var k = 0; k < keys.length; k++) {
        var pKey = keys[k];
        if (!pKey) continue;

        // Check same-session duplicate
        if (!sessionProctors[sessionKey]) sessionProctors[sessionKey] = {};
        if (sessionProctors[sessionKey][pKey]) return true;
        sessionProctors[sessionKey][pKey] = true;

        // Check halfday reuse
        if (!allowHalfdayReuse) {
          if (!halfdayProctors[halfdayKey]) halfdayProctors[halfdayKey] = {};
          if (halfdayProctors[halfdayKey][pKey]) return true;
          halfdayProctors[halfdayKey][pKey] = true;
        }

        // Check day reuse
        if (!allowDayReuse) {
          if (!dayProctors[dayKey]) dayProctors[dayKey] = {};
          if (dayProctors[dayKey][pKey]) return true;
          dayProctors[dayKey][pKey] = true;
        }
      }
    }

    // Check exemptions and duty
    var exemptionsData = input.exemptionsData || {};
    var dutyData = input.dutyData || {};
    var proctorsList = input.proctorsList || [];
    var proctorKeyMap = {};
    for (var pi = 0; pi < proctorsList.length; pi++) {
      proctorKeyMap[getProctorKey(proctorsList[pi], pi)] = { proc: proctorsList[pi], idx: pi };
    }

    for (var ai = 0; ai < assignments.length; ai++) {
      var aRow = assignments[ai];
      var aKeys = aRow.proctor_keys || [];
      var schedEntry = aRow.schedule_entry;
      if (!schedEntry) continue;

      for (var ak = 0; ak < aKeys.length; ak++) {
        var aKey = aKeys[ak];
        if (!aKey) continue;
        var pInfo = proctorKeyMap[aKey];
        if (!pInfo) continue;

        // Check exemption
        if (isProctorExemptForEntry(pInfo.proc, pInfo.idx, schedEntry, exemptionsData)) {
          return true;
        }
        // Check duty
        if (isDutyTeacherForEntry(pInfo.proc, pInfo.idx, schedEntry, dutyData)) {
          return true;
        }
      }
    }

    // Lower-bound protection (proctor-v2-fairness-undercovered-fix Phase 3 extension).
    // C3: Phase 2.75 lifts every undercovered proctor to classLowerBound; Phase 3
    // must not undo that, AND must not push anyone above classUpperBound either.
    // Reject any move that drops a proctor's primary guard count strictly below
    // their classLowerBound OR pushes it strictly above their classUpperBound.
    // No-op when classBoundsByProctorKey is absent (legacy callers
    // pre-Phase-2 invocations).
    var classBounds = input.classBoundsByProctorKey
      || (input.options && input.options.classBoundsByProctorKey)
      || null;
    if (classBounds) {
      var guardCounts = {};
      for (var li = 0; li < assignments.length; li++) {
        var lkeys = assignments[li].proctor_keys || [];
        for (var lk = 0; lk < lkeys.length; lk++) {
          var lpKey = lkeys[lk];
          if (!lpKey) continue;
          guardCounts[lpKey] = (guardCounts[lpKey] || 0) + 1;
        }
      }
      var boundedKeys = Object.keys(classBounds);
      for (var bki = 0; bki < boundedKeys.length; bki++) {
        var bKey = boundedKeys[bki];
        var bBounds = classBounds[bKey];
        if (!bBounds) continue;
        var gCount = guardCounts[bKey] || 0;
        if (gCount < bBounds.classLowerBound) {
          return true;
        }
        if (gCount > bBounds.classUpperBound) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Generates a swap_guards move: swap two guards between rooms in the same session.
   * @param {Array} assignments
   * @param {function} rng
   * @returns {Object|null} move descriptor or null if no valid move found
   */
  function generateSwapGuards(assignments, rng) {
    if (assignments.length < 2) return null;

    // Group assignments by session_key
    var sessionGroups = {};
    for (var i = 0; i < assignments.length; i++) {
      var sk = assignments[i].session_key || '';
      if (!sessionGroups[sk]) sessionGroups[sk] = [];
      sessionGroups[sk].push(i);
    }

    var sessionKeys = Object.keys(sessionGroups);
    if (sessionKeys.length === 0) return null;

    // Pick a random session with at least 2 assignments that have proctors
    var attempts = 0;
    while (attempts < 10) {
      attempts++;
      var randSession = sessionKeys[Math.floor(rng() * sessionKeys.length)];
      var indices = sessionGroups[randSession];
      if (indices.length < 2) continue;

      // Find two assignments with proctors
      var withProctors = [];
      for (var wi = 0; wi < indices.length; wi++) {
        if (assignments[indices[wi]].proctor_keys && assignments[indices[wi]].proctor_keys.length > 0 &&
            assignments[indices[wi]].proctor_keys[0]) {
          withProctors.push(indices[wi]);
        }
      }
      if (withProctors.length < 2) continue;

      // Pick two random distinct indices
      var idx1 = Math.floor(rng() * withProctors.length);
      var idx2 = Math.floor(rng() * (withProctors.length - 1));
      if (idx2 >= idx1) idx2++;

      var rowIdx1 = withProctors[idx1];
      var rowIdx2 = withProctors[idx2];

      // Pick a random slot (0 = primary proctor, or 1 for dual-proctor rooms if available)
      var slot = 0;
      var row1Keys = assignments[rowIdx1].proctor_keys || [];
      var row2Keys = assignments[rowIdx2].proctor_keys || [];
      if (row1Keys.length > 1 && row2Keys.length > 1 && rng() > 0.5) {
        slot = 1;
      }

      return {
        type: 'swap_guards',
        row1: rowIdx1,
        row2: rowIdx2,
        slot1: slot,
        slot2: slot
      };
    }
    return null;
  }

  /**
   * Generates a swap_roles move: swap a guard and a reserve in the same half-day.
   * Relies on the v1 shared-reference invariant established by phase2_5PopulateReserves
   * (see design.md §"Data contract changes"): all rows of a session share the same
   * reserve_keys/reserves array, so writing reserveRow.reserve_keys[rs] in applyMove
   * propagates the swap to every sibling row of the session automatically.
   * @param {Array} assignments
   * @param {function} rng
   * @returns {Object|null} move descriptor or null if no valid move found
   */
  function generateSwapRoles(assignments, rng) {
    if (assignments.length === 0) return null;

    // Group by halfday_key
    var halfdayGroups = {};
    for (var i = 0; i < assignments.length; i++) {
      var hk = assignments[i].halfday_key || '';
      if (!halfdayGroups[hk]) halfdayGroups[hk] = [];
      halfdayGroups[hk].push(i);
    }

    var halfdayKeys = Object.keys(halfdayGroups);
    if (halfdayKeys.length === 0) return null;

    var attempts = 0;
    while (attempts < 10) {
      attempts++;
      var randHalfday = halfdayKeys[Math.floor(rng() * halfdayKeys.length)];
      var indices = halfdayGroups[randHalfday];

      // Find assignments with guards and assignments with reserves
      var withGuards = [];
      var withReserves = [];
      for (var gi = 0; gi < indices.length; gi++) {
        var row = assignments[indices[gi]];
        if (row.proctor_keys && row.proctor_keys.length > 0 && row.proctor_keys[0]) {
          withGuards.push(indices[gi]);
        }
        if (row.reserve_keys && row.reserve_keys.length > 0 && row.reserve_keys[0]) {
          withReserves.push(indices[gi]);
        }
      }

      if (withGuards.length === 0 || withReserves.length === 0) continue;

      var guardRowIdx = withGuards[Math.floor(rng() * withGuards.length)];
      var reserveRowIdx = withReserves[Math.floor(rng() * withReserves.length)];

      return {
        type: 'swap_roles',
        guardRow: guardRowIdx,
        reserveRow: reserveRowIdx,
        guardSlot: 0,
        reserveSlot: 0
      };
    }
    return null;
  }

  /**
   * Generates a reassign_reserve move: move a reserve to a different session.
   * Relies on the v1 shared-reference invariant established by phase2_5PopulateReserves
   * (see design.md §"Data contract changes" Phase 3 caveat): rows within one session
   * share their reserve_keys/reserves arrays, while distinct sessions hold distinct
   * references. The applyMove splice on src and push on tgt therefore propagate within
   * each session and never leak across sessions.
   * @param {Array} assignments
   * @param {function} rng
   * @returns {Object|null} move descriptor or null if no valid move found
   */
  function generateReassignReserve(assignments, rng) {
    if (assignments.length < 2) return null;

    // Group rows by halfday_key, tracking which have reserves
    var halfdayGroups = {}; // halfdayKey -> { withReserves: [idx], withoutReserves: [idx] }
    for (var i = 0; i < assignments.length; i++) {
      var hk = assignments[i].halfday_key || '';
      if (!halfdayGroups[hk]) halfdayGroups[hk] = { withReserves: [], withoutReserves: [] };
      if (assignments[i].reserve_keys && assignments[i].reserve_keys.length > 0 && assignments[i].reserve_keys[0]) {
        halfdayGroups[hk].withReserves.push(i);
      } else {
        halfdayGroups[hk].withoutReserves.push(i);
      }
    }

    // Find halfdays that have both reserves and available targets
    var validHalfdays = [];
    var halfdayKeys = Object.keys(halfdayGroups);
    for (var hi = 0; hi < halfdayKeys.length; hi++) {
      var group = halfdayGroups[halfdayKeys[hi]];
      if (group.withReserves.length > 0 && group.withoutReserves.length > 0) {
        validHalfdays.push(halfdayKeys[hi]);
      }
    }

    if (validHalfdays.length === 0) return null;

    var attempts = 0;
    while (attempts < 10) {
      attempts++;
      var randHalfday = validHalfdays[Math.floor(rng() * validHalfdays.length)];
      var grp = halfdayGroups[randHalfday];

      var sourceIdx = grp.withReserves[Math.floor(rng() * grp.withReserves.length)];
      var targetIdx = grp.withoutReserves[Math.floor(rng() * grp.withoutReserves.length)];

      // Ensure different sessions
      if (assignments[sourceIdx].session_key === assignments[targetIdx].session_key) continue;

      // Ensure the reserve person isn't already assigned in the target session
      var reserveKey = assignments[sourceIdx].reserve_keys[0];
      var targetProctorKeys = assignments[targetIdx].proctor_keys || [];
      var targetReserveKeys = assignments[targetIdx].reserve_keys || [];
      var alreadyAssigned = false;
      for (var tk = 0; tk < targetProctorKeys.length; tk++) {
        if (targetProctorKeys[tk] === reserveKey) { alreadyAssigned = true; break; }
      }
      if (!alreadyAssigned) {
        for (var rk = 0; rk < targetReserveKeys.length; rk++) {
          if (targetReserveKeys[rk] === reserveKey) { alreadyAssigned = true; break; }
        }
      }
      if (alreadyAssigned) continue;

      return {
        type: 'reassign_reserve',
        sourceRow: sourceIdx,
        targetRow: targetIdx,
        reserveSlot: 0
      };
    }
    return null;
  }

  /**
   * Applies a move to the solution (mutates assignments in place).
   * @param {Object} move
   * @param {Array} assignments
   */
  function applyMove(move, assignments) {
    if (move.type === 'swap_guards') {
      // Swap proctor at slot between two rows
      var row1 = assignments[move.row1];
      var row2 = assignments[move.row2];
      var s1 = move.slot1;
      var s2 = move.slot2;

      var tmpKey = row1.proctor_keys[s1];
      var tmpName = row1.proctors[s1];
      var tmpGroup = row1.proctor_groups[s1];

      row1.proctor_keys[s1] = row2.proctor_keys[s2];
      row1.proctors[s1] = row2.proctors[s2];
      row1.proctor_groups[s1] = row2.proctor_groups[s2];

      row2.proctor_keys[s2] = tmpKey;
      row2.proctors[s2] = tmpName;
      row2.proctor_groups[s2] = tmpGroup;

    } else if (move.type === 'swap_roles') {
      // Swap a guard and a reserve
      var guardRow = assignments[move.guardRow];
      var reserveRow = assignments[move.reserveRow];
      var gs = move.guardSlot;
      var rs = move.reserveSlot;

      var guardKey = guardRow.proctor_keys[gs];
      var guardName = guardRow.proctors[gs];
      var guardGroup = guardRow.proctor_groups[gs];

      var reserveKey = reserveRow.reserve_keys[rs];
      var reserveName = reserveRow.reserves[rs];

      // Guard becomes reserve in reserveRow
      reserveRow.reserve_keys[rs] = guardKey;
      reserveRow.reserves[rs] = guardName;

      // Reserve becomes guard in guardRow
      guardRow.proctor_keys[gs] = reserveKey;
      guardRow.proctors[gs] = reserveName;
      guardRow.proctor_groups[gs] = guardGroup; // keep group label placeholder

    } else if (move.type === 'reassign_reserve') {
      // Move reserve from source to target
      var srcRow = assignments[move.sourceRow];
      var tgtRow = assignments[move.targetRow];
      var rSlot = move.reserveSlot;

      var rKey = srcRow.reserve_keys[rSlot];
      var rName = srcRow.reserves[rSlot];

      // Remove from source
      srcRow.reserve_keys.splice(rSlot, 1);
      srcRow.reserves.splice(rSlot, 1);

      // Add to target
      if (!tgtRow.reserve_keys) tgtRow.reserve_keys = [];
      if (!tgtRow.reserves) tgtRow.reserves = [];
      tgtRow.reserve_keys.push(rKey);
      tgtRow.reserves.push(rName);
    }
  }

  /**
   * Undoes a move (reverse of applyMove).
   * @param {Object} move
   * @param {Array} assignments
   */
  function undoMove(move, assignments) {
    if (move.type === 'swap_guards') {
      // Swap back
      applyMove(move, assignments);

    } else if (move.type === 'swap_roles') {
      // Swap back
      applyMove(move, assignments);

    } else if (move.type === 'reassign_reserve') {
      // Reverse: move reserve from target back to source
      var srcRow = assignments[move.sourceRow];
      var tgtRow = assignments[move.targetRow];

      // Find the reserve in target (it was pushed to end)
      var lastIdx = tgtRow.reserve_keys.length - 1;
      if (lastIdx < 0) return;

      var rKey = tgtRow.reserve_keys[lastIdx];
      var rName = tgtRow.reserves[lastIdx];

      // Remove from target
      tgtRow.reserve_keys.splice(lastIdx, 1);
      tgtRow.reserves.splice(lastIdx, 1);

      // Re-insert into source at original slot
      srcRow.reserve_keys.splice(move.reserveSlot, 0, rKey);
      srcRow.reserves.splice(move.reserveSlot, 0, rName);
    }
  }

  /**
   * Phase 3 Optimize: refines Phase 2 solution via Simulated Annealing.
   *
   * @param {Object} phase2Result - { assignments, loadState, diagnostics }
   * @param {Object} input - GS2_Input_Contract
   * @param {function} rng - Seeded PRNG function
   * @param {Object} config - SA configuration (T0, T_min, coolingRate, maxIterations, maxDurationMs, stagnationLimit)
   * @returns {Object} Phase3Result { assignments, diagnostics }
   */
  function phase3Optimize(phase2Result, input, rng, config) {
    var startTime = Date.now();

    // Resolve weights
    var resolved = resolveWeights(input);
    var weights = resolved.weights;
    var presetName = resolved.presetName;

    // Check if phase3 is disabled
    if (input.enablePhase3 === false) {
      return {
        assignments: phase2Result.assignments,
        diagnostics: {
          phase3DurationMs: Date.now() - startTime,
          iterationsExecuted: 0,
          acceptedMoves: 0,
          rejectedMoves: 0,
          earlyStop: false,
          initialObjective: 0,
          finalObjective: 0,
          preset: presetName,
          phase3Skipped: true,
          weightsUsed: presetName,
          weightValues: { alpha: weights.alpha, beta: weights.beta, gamma: weights.gamma }
        }
      };
    }

    // SA parameters (use explicit undefined/null checks to handle falsy values like 0 correctly)
    var T0 = (config && config.T0 !== undefined && config.T0 !== null) ? config.T0 : SA_DEFAULTS.T0;
    var T_min = (config && config.T_min !== undefined && config.T_min !== null) ? config.T_min : SA_DEFAULTS.T_min;
    var coolingRate = (config && config.coolingRate !== undefined && config.coolingRate !== null) ? config.coolingRate : SA_DEFAULTS.coolingRate;
    var maxIterations = (config && config.maxIterations !== undefined && config.maxIterations !== null) ? config.maxIterations : SA_DEFAULTS.maxIterations;
    var maxDurationMs = (config && config.maxDurationMs !== undefined && config.maxDurationMs !== null) ? config.maxDurationMs : SA_DEFAULTS.maxDurationMs;
    var stagnationLimit = (config && config.stagnationLimit !== undefined && config.stagnationLimit !== null) ? config.stagnationLimit : SA_DEFAULTS.stagnationLimit;

    // Deep copy the solution
    var solution = deepCopyAssignments(phase2Result.assignments);

    // Compute initial objective
    var T = T0;
    var initialObjective = objectiveFunction(solution, weights, input);
    var currentObjective = initialObjective;
    var bestObjective = currentObjective;
    var stagnation = 0;
    var accepted = 0;
    var rejected = 0;
    var iterations = 0;
    var earlyStop = false;

    // Move type options
    var moveTypes = ['swap_guards', 'swap_roles', 'reassign_reserve'];

    // SA main loop
    while (T > T_min && iterations < maxIterations && (Date.now() - startTime) < maxDurationMs) {
      iterations++;

      // Pick random move type
      var moveTypeIdx = Math.floor(rng() * moveTypes.length);
      var moveType = moveTypes[moveTypeIdx];

      // Generate move
      var move = null;
      if (moveType === 'swap_guards') {
        move = generateSwapGuards(solution, rng);
      } else if (moveType === 'swap_roles') {
        move = generateSwapRoles(solution, rng);
      } else {
        move = generateReassignReserve(solution, rng);
      }

      if (move === null) {
        // Move was invalid (no valid target found)
        rejected++;
        stagnation++;
        if (stagnation >= stagnationLimit) {
          earlyStop = true;
          break;
        }
        continue;
      }

      // Apply move temporarily
      applyMove(move, solution);

      // Reject moves that violate hard constraints without computing cost
      if (violatesHardConstraints(solution, input)) {
        // Undo and reject
        undoMove(move, solution);
        rejected++;
        stagnation++;
      } else {
        // Compute new objective
        var newObjective = objectiveFunction(solution, weights, input);
        var deltaE = newObjective - currentObjective;

        if (deltaE <= 0) {
          // Improvement — always accept
          currentObjective = newObjective;
          accepted++;
          stagnation = 0;
        } else {
          // Worsening — accept with probability exp(-deltaE / T)
          if (rng() < Math.exp(-deltaE / T)) {
            currentObjective = newObjective;
            accepted++;
            stagnation = 0;
          } else {
            // Reject: undo move
            undoMove(move, solution);
            rejected++;
            stagnation++;
          }
        }

        // Track best objective found
        if (currentObjective < bestObjective) {
          bestObjective = currentObjective;
        }
      }

      // Early stop check
      if (stagnation >= stagnationLimit) {
        earlyStop = true;
        break;
      }

      // Cool down
      T *= coolingRate;
    }

    var phase3DurationMs = Date.now() - startTime;

    return {
      assignments: solution,
      diagnostics: {
        phase3DurationMs: phase3DurationMs,
        iterationsExecuted: iterations,
        acceptedMoves: accepted,
        rejectedMoves: rejected,
        earlyStop: earlyStop,
        initialObjective: initialObjective,
        finalObjective: currentObjective,
        preset: presetName,
        phase3Skipped: false,
        weightsUsed: presetName,
        weightValues: { alpha: weights.alpha, beta: weights.beta, gamma: weights.gamma }
      }
    };
  }

  // ============================================================
  // ORCHESTRATOR
  // ============================================================

  /**
   * Computes soft violations for a single AssignmentRow.
   * Returns an array of violation type strings.
   *
   * @param {Object} row - AssignmentRow
   * @param {Object} input - GS2_Input_Contract
   * @param {Object} globalRoomUsageMap - roomKey → Set of proctorKeys assigned previously
   * @returns {string[]}
   */
  function computeRowSoftViolations(row, input, globalRoomUsageMap) {
    var violations = [];
    var options = input.options || {};
    var meAssignments = input.meAssignments || {};
    var proctorsList = input.proctorsList || [];

    // Build proctor key → proctor lookup
    var proctorKeyMap = {};
    for (var pi = 0; pi < proctorsList.length; pi++) {
      proctorKeyMap[getProctorKey(proctorsList[pi], pi)] = proctorsList[pi];
    }

    var proctorKeys = row.proctor_keys || [];
    var roomKey = row.room_key || '';
    var subjectName = row.subject_name || '';
    var halfdayKey = row.halfday_key || '';
    var isMorning = isMorningHalfday(halfdayKey);
    var expectedGroup = isMorning ? 1 : 2;

    for (var k = 0; k < proctorKeys.length; k++) {
      var pKey = proctorKeys[k];
      if (!pKey) continue;
      var proctor = proctorKeyMap[pKey];

      // 1. Same room repeat
      if (options.noRoomRepeat !== false && globalRoomUsageMap && roomKey) {
        var roomProctors = globalRoomUsageMap[roomKey];
        if (roomProctors && roomProctors.has(pKey)) {
          violations.push('sameRoomRepeat');
        }
      }

      // 2. Subject specialty conflict
      if (options.avoidSpecialty !== false && proctor && subjectName) {
        var specialty = proctor.specialty || '';
        if (specialty && specialty === subjectName) {
          violations.push('subjectConflict');
        }
      }

      // 3. Group mismatch
      if (options.respectMorningEvening !== false && meAssignments) {
        var proctorGroup = meAssignments[pKey];
        if (proctorGroup && proctorGroup !== expectedGroup) {
          violations.push('groupMismatch');
        }
      }

      // 4. Gender imbalance (for dual-proctor rooms, check if same gender)
      if (options.preferMixedGenderPair !== false && proctorKeys.length >= 2 && k === 1) {
        var firstKey = proctorKeys[0];
        var firstProctor = proctorKeyMap[firstKey];
        if (firstProctor && proctor) {
          var g1 = normalizeGender(firstProctor.gender);
          var g2 = normalizeGender(proctor.gender);
          if (g1 && g2 && g1 === g2) {
            violations.push('genderImbalance');
          }
        }
      }
    }

    return violations;
  }

  /**
   * Validates proctor references in the input and logs warnings for non-existent ones.
   * Returns an array of warning strings.
   *
   * @param {Object} input - GS2_Input_Contract
   * @returns {string[]} warnings
   */
  function validateProctorReferences(input) {
    var warnings = [];
    var proctorsList = input.proctorsList || [];
    var validMeKeys = new Set(); // Keys used in meAssignments (getProctorKey format)
    var validExKeys = new Set(); // Keys used in exemptions/duty (getProctorExemptionKey format)
    for (var pi = 0; pi < proctorsList.length; pi++) {
      validMeKeys.add(getProctorKey(proctorsList[pi], pi));
      validExKeys.add(getProctorExemptionKey(proctorsList[pi], pi));
    }

    // Check meAssignments for non-existent proctor references
    var meAssignments = input.meAssignments || {};
    var meKeys = Object.keys(meAssignments);
    for (var mi = 0; mi < meKeys.length; mi++) {
      if (!validMeKeys.has(meKeys[mi])) {
        warnings.push('Non-existent proctor reference in meAssignments: ' + meKeys[mi]);
      }
    }

    // Check exemptionsData for non-existent proctor references
    var exemptionsData = input.exemptionsData || {};
    var exemptionScopes = Object.keys(exemptionsData);
    for (var ei = 0; ei < exemptionScopes.length; ei++) {
      var scopeData = exemptionsData[exemptionScopes[ei]];
      if (scopeData && typeof scopeData === 'object') {
        var scopeKeys = Object.keys(scopeData);
        for (var sk = 0; sk < scopeKeys.length; sk++) {
          if (!validExKeys.has(scopeKeys[sk])) {
            warnings.push('Non-existent proctor reference in exemptionsData: ' + scopeKeys[sk]);
          }
        }
      }
    }

    return warnings;
  }

  /**
   * Main entry point for the v2 proctor distribution algorithm.
   * Validates input, initializes PRNG, runs Phase 1 → Phase 2 → Phase 3.
   * Robust error handling: if any phase throws, produces a usable (possibly degraded) result.
   *
   * @param {Object} input - GS2_Input_Contract
   * @returns {{ result: Array, diagnostics: Object } | null} null if re-entrant call
   */
  function orchestrator(input) {
    // Re-entrancy guard: ignore concurrent calls
    if (_isRunning) {
      return null;
    }

    _isRunning = true;
    var startTime = Date.now();

    var diagnostics = {
      orchestratorState: 'ERROR',
      seedUsed: 0,
      weightsUsed: '',
      weightValues: { alpha: 0, beta: 0, gamma: 0 },
      // Phase 1
      phase1DurationMs: 0,
      lowerBound: 0,
      upperBound: 0,
      singletonCount: 0,
      domainReductionPercent: 0,
      infeasibilities: [],
      warnings: [],
      // Phase 2
      phase2DurationMs: 0,
      phase2TimedOut: false,
      phase2TimeoutMs: 0,
      fallbackCount: 0,
      totalHalfdaysProcessed: 0,
      averageCostPerAssignment: 0,
      fallbackHalfdays: [],
      // Phase 2.5
      phase2_5DurationMs: 0,
      totalReservesPlaced: 0,
      sessionsWithShortage: 0,
      percentRoundedToZero: 0,
      // Phase 3
      phase3DurationMs: 0,
      iterationsExecuted: 0,
      acceptedMoves: 0,
      rejectedMoves: 0,
      earlyStop: false,
      initialObjective: 0,
      finalObjective: 0,
      preset: '',
      phase3Skipped: false,
      // Summary
      totalDurationMs: 0,
      loadBalance: { std: 0, min: 0, max: 0, giniCoefficient: 0 },
      softViolationsByType: {
        sameRoomRepeats: 0,
        subjectConflicts: 0,
        groupMismatches: 0,
        genderImbalances: 0
      },
      shortages: [],
      totalInfeasibleSlots: 0,
      errors: []
    };

    try {
      // Step 1: Validate input (fail fast with descriptive error)
      validateInput(input);

      // Step 2: Initialize seeded PRNG
      var seed;
      if (input.randomSeed !== null && input.randomSeed !== undefined) {
        seed = input.randomSeed;
      } else {
        seed = Date.now();
      }

      var rng;
      try {
        rng = buildSeededPRNG(seed);
      } catch (e) {
        diagnostics.errors.push('PRNG initialization failed: ' + e.message);
        diagnostics.totalDurationMs = Date.now() - startTime;
        _isRunning = false;
        throw new Error('PRNG seeding failed: ' + e.message);
      }
      diagnostics.seedUsed = seed;

      // Step 3: Resolve weights
      var weights;
      if (
        input.customWeights &&
        typeof input.customWeights === 'object' &&
        typeof input.customWeights.alpha === 'number' &&
        typeof input.customWeights.beta === 'number' &&
        typeof input.customWeights.gamma === 'number'
      ) {
        weights = {
          alpha: input.customWeights.alpha,
          beta: input.customWeights.beta,
          gamma: input.customWeights.gamma
        };
        diagnostics.weightsUsed = 'custom';
      } else if (input.weightsPreset && WEIGHTS_PRESETS[input.weightsPreset]) {
        weights = WEIGHTS_PRESETS[input.weightsPreset];
        diagnostics.weightsUsed = input.weightsPreset;
      } else {
        weights = WEIGHTS_PRESETS['توازن'];
        diagnostics.weightsUsed = 'توازن';
      }
      diagnostics.weightValues = {
        alpha: weights.alpha,
        beta: weights.beta,
        gamma: weights.gamma
      };

      // Step 3.5: Validate proctor references — ignore non-existent, log warnings
      var refWarnings = validateProctorReferences(input);
      if (refWarnings.length > 0) {
        diagnostics.warnings = diagnostics.warnings.concat(refWarnings);
        if (typeof console !== 'undefined' && console.warn) {
          for (var rw = 0; rw < refWarnings.length; rw++) {
            console.warn('[ProctorDistributionV2] ' + refWarnings[rw]);
          }
        }
      }

      // Step 4: Phase 1 — Pre-pass (CSP + AC-3)
      // Errors in Phase 1: log warning, continue with empty CSP result
      var phase1Result = null;
      try {
        phase1Result = phase1PrePass(input);
        diagnostics.phase1DurationMs = phase1Result.diagnostics.phase1DurationMs;
        diagnostics.lowerBound = phase1Result.diagnostics.lowerBound;
        diagnostics.upperBound = phase1Result.diagnostics.upperBound;
        diagnostics.singletonCount = phase1Result.diagnostics.singletonCount;
        diagnostics.domainReductionPercent = phase1Result.diagnostics.domainReductionPercent;
        diagnostics.infeasibilities = phase1Result.diagnostics.infeasibilities || [];
        if (phase1Result.diagnostics.warnings) {
          diagnostics.warnings = diagnostics.warnings.concat(phase1Result.diagnostics.warnings);
        }
      } catch (phase1Error) {
        // Phase 1 error: log warning, continue with empty/default CSP result
        diagnostics.warnings.push('Phase 1 error (continuing with empty CSP): ' + phase1Error.message);
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ProctorDistributionV2] Phase 1 error:', phase1Error.message);
        }
        phase1Result = {
          cspModel: { variables: [], domains: new Map(), constraints: [] },
          prefixedAssignments: new Map(),
          lowerBound: 0,
          upperBound: 1,
          diagnostics: {
            phase1DurationMs: Date.now() - startTime,
            lowerBound: 0,
            upperBound: 1,
            singletonCount: 0,
            domainReductionPercent: 0,
            infeasibilities: [],
            warnings: ['Phase 1 failed: ' + phase1Error.message]
          }
        };
        diagnostics.phase1DurationMs = phase1Result.diagnostics.phase1DurationMs;
      }

      // Step 5: Phase 2 — Build (Hungarian per half-day + Greedy Fallback)
      // Errors in Phase 2: catch, use greedyFallback for entire input
      var phase2Result = null;
      var phase2TimedOut = false;
      try {
        phase2Result = phase2Build(phase1Result, input, rng);
        diagnostics.phase2DurationMs = phase2Result.diagnostics.phase2DurationMs;
        diagnostics.phase2TimedOut = !!phase2Result.diagnostics.phase2TimedOut;
        diagnostics.phase2TimeoutMs = phase2Result.diagnostics.phase2TimeoutMs || DEFAULT_PHASE2_TIMEOUT_MS;
        diagnostics.fallbackCount = phase2Result.diagnostics.fallbackCount;
        diagnostics.totalHalfdaysProcessed = phase2Result.diagnostics.totalHalfdaysProcessed;
        diagnostics.averageCostPerAssignment = phase2Result.diagnostics.averageCostPerAssignment;
        diagnostics.fallbackHalfdays = phase2Result.diagnostics.fallbackHalfdays || [];
        diagnostics.eligibilityClassCount = phase2Result.diagnostics.eligibilityClassCount || 0;
        diagnostics.classBounds = phase2Result.diagnostics.classBounds || {};

        // Read phase2TimedOut directly from the diagnostic flag (was a fragile
        // duration-based heuristic before spec proctor-v2-phase2-timeout-and-greedy-cap).
        if (phase2Result.diagnostics.phase2TimedOut) {
          phase2TimedOut = true;
          var actualTimeoutMs = phase2Result.diagnostics.phase2TimeoutMs || DEFAULT_PHASE2_TIMEOUT_MS;
          diagnostics.warnings.push('Phase 2 timeout exceeded (' + actualTimeoutMs + 'ms)');
        }
      } catch (phase2Error) {
        // Phase 2 error: use greedyFallback for entire input per half-day
        diagnostics.errors.push('Phase 2 error (using greedy fallback): ' + phase2Error.message);
        if (typeof console !== 'undefined' && console.error) {
          console.error('[ProctorDistributionV2] Phase 2 error:', phase2Error.message);
        }

        // Build a minimal phase2Result using greedy fallback approach
        var fallbackStartTime = Date.now();
        try {
          // Create a minimal phase1Result for phase2Build if needed
          var fallbackPhase1 = phase1Result || {
            cspModel: { variables: [], domains: new Map(), constraints: [] },
            prefixedAssignments: new Map(),
            lowerBound: 0,
            upperBound: 1,
            diagnostics: { phase1DurationMs: 0, lowerBound: 0, upperBound: 1, singletonCount: 0, domainReductionPercent: 0, infeasibilities: [], warnings: [] }
          };
          // Attempt phase2Build again with a fresh state (it has internal greedy fallback)
          phase2Result = phase2Build(fallbackPhase1, input, rng);
        } catch (fallbackError) {
          // Even fallback failed — produce empty result
          diagnostics.errors.push('Greedy fallback also failed: ' + fallbackError.message);
          phase2Result = {
            assignments: [],
            loadState: createLoadState(),
            diagnostics: {
              phase2DurationMs: Date.now() - fallbackStartTime,
              fallbackCount: 0,
              totalHalfdaysProcessed: 0,
              averageCostPerAssignment: 0,
              fallbackHalfdays: []
            }
          };
        }
        diagnostics.phase2DurationMs = phase2Result.diagnostics.phase2DurationMs;
        diagnostics.fallbackCount = phase2Result.diagnostics.fallbackCount;
        diagnostics.totalHalfdaysProcessed = phase2Result.diagnostics.totalHalfdaysProcessed;
        diagnostics.averageCostPerAssignment = phase2Result.diagnostics.averageCostPerAssignment;
        diagnostics.fallbackHalfdays = phase2Result.diagnostics.fallbackHalfdays || [];
        diagnostics.eligibilityClassCount = phase2Result.diagnostics.eligibilityClassCount || 0;
        diagnostics.classBounds = phase2Result.diagnostics.classBounds || {};
      }

      // Step 5.5: Phase 2.5 — Populate Reserves
      // Errors in Phase 2.5: log warning and continue (reserves will be empty, run must not fail)
      var phase2_5Diagnostics = { phase2_5DurationMs: 0, totalReservesPlaced: 0, sessionsWithShortage: 0, percentRoundedToZero: 0 };
      try {
        phase2_5Diagnostics = phase2_5PopulateReserves(phase2Result, input, rng);
        diagnostics.phase2_5DurationMs   = phase2_5Diagnostics.phase2_5DurationMs;
        diagnostics.totalReservesPlaced  = phase2_5Diagnostics.totalReservesPlaced;
        diagnostics.sessionsWithShortage = phase2_5Diagnostics.sessionsWithShortage;
        diagnostics.percentRoundedToZero = phase2_5Diagnostics.percentRoundedToZero;
      } catch (phase2_5Error) {
        diagnostics.warnings.push('Phase 2.5 error (reserves will be empty): ' + phase2_5Error.message);
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ProctorDistributionV2] Phase 2.5 error:', phase2_5Error.message);
        }
      }

      var phase2_75Diagnostics = { swaps: 0, unresolved: 0, durationMs: 0, warnings: {} };
      try {
        phase2_75Diagnostics = phase2_75CoverageRepair(
          phase2Result,
          phase2_5Diagnostics,
          phase2Result.classBoundsByProctorKey,
          input,
          rng
        );
      } catch (phase2_75Error) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ProctorDistributionV2] Phase 2.75 error:', phase2_75Error.message);
        }
        phase2_75Diagnostics = { swaps: 0, unresolved: 0, durationMs: 0, warnings: { '__pass__': { reason: 'pass_threw' } } };
      }
      diagnostics.coverageRepairSwaps = phase2_75Diagnostics.swaps || 0;
      diagnostics.coverageRepairUnresolved = phase2_75Diagnostics.unresolved || 0;
      diagnostics.coverageRepairDurationMs = phase2_75Diagnostics.durationMs || 0;
      diagnostics.coverageRepairWarnings = phase2_75Diagnostics.warnings || {};

      // Step 6: Phase 3 — Optimize (skip if disabled)
      // Errors in Phase 3: catch, return Phase 2 result unchanged
      var enablePhase3 = input.enablePhase3 !== false;
      var phase3Result = null;

      if (enablePhase3) {
        try {
          // Plumb classBoundsByProctorKey onto input so violatesHardConstraints
          // can enforce the per-class lower-bound during Phase 3
          // (proctor-v2-fairness-undercovered-fix Phase 3 extension).
          // Additive — no schema change. Idempotent on re-runs.
          input.classBoundsByProctorKey = phase2Result.classBoundsByProctorKey;
          var saConfig = {
            T0: SA_DEFAULTS.T0,
            T_min: SA_DEFAULTS.T_min,
            coolingRate: SA_DEFAULTS.coolingRate,
            maxIterations: SA_DEFAULTS.maxIterations,
            maxDurationMs: SA_DEFAULTS.maxDurationMs,
            stagnationLimit: SA_DEFAULTS.stagnationLimit
          };
          phase3Result = phase3Optimize(phase2Result, input, rng, saConfig);
        } catch (phase3Error) {
          // Phase 3 error: return Phase 2 result unchanged, log error
          diagnostics.errors.push('Phase 3 error (returning Phase 2 result): ' + phase3Error.message);
          if (typeof console !== 'undefined' && console.error) {
            console.error('[ProctorDistributionV2] Phase 3 error:', phase3Error.message);
          }
          phase3Result = {
            assignments: phase2Result.assignments,
            diagnostics: {
              phase3DurationMs: 0,
              iterationsExecuted: 0,
              acceptedMoves: 0,
              rejectedMoves: 0,
              earlyStop: false,
              initialObjective: 0,
              finalObjective: 0,
              preset: diagnostics.weightsUsed,
              phase3Skipped: false,
              weightsUsed: diagnostics.weightsUsed,
              weightValues: diagnostics.weightValues
            }
          };
        }
      } else {
        phase3Result = {
          assignments: phase2Result.assignments,
          diagnostics: {
            phase3DurationMs: 0,
            iterationsExecuted: 0,
            acceptedMoves: 0,
            rejectedMoves: 0,
            earlyStop: false,
            initialObjective: 0,
            finalObjective: 0,
            preset: diagnostics.weightsUsed,
            phase3Skipped: true,
            weightsUsed: diagnostics.weightsUsed,
            weightValues: diagnostics.weightValues
          }
        };
      }

      diagnostics.phase3DurationMs = phase3Result.diagnostics.phase3DurationMs;
      diagnostics.iterationsExecuted = phase3Result.diagnostics.iterationsExecuted;
      diagnostics.acceptedMoves = phase3Result.diagnostics.acceptedMoves;
      diagnostics.rejectedMoves = phase3Result.diagnostics.rejectedMoves;
      diagnostics.earlyStop = phase3Result.diagnostics.earlyStop;
      diagnostics.initialObjective = phase3Result.diagnostics.initialObjective;
      diagnostics.finalObjective = phase3Result.diagnostics.finalObjective;
      diagnostics.preset = phase3Result.diagnostics.preset || diagnostics.weightsUsed;
      diagnostics.phase3Skipped = phase3Result.diagnostics.phase3Skipped || false;

      // Step 7: Finalize result — ensure softViolations on every row, compute stats
      var finalAssignments = phase3Result.assignments || [];
      var proctorsPerRoom = (input.examDistributionRules && input.examDistributionRules.proctorsPerRoom) || 1;

      // Build global room usage map for soft violation computation
      // Track which proctors have been assigned to which rooms across all rows
      var globalRoomUsageForViolations = {};
      var totalInfeasibleSlots = 0;
      var shortagesMap = {}; // halfdayKey → count

      for (var ri = 0; ri < finalAssignments.length; ri++) {
        var row = finalAssignments[ri];

        // Ensure softViolations array exists on every row
        if (!row.softViolations) {
          row.softViolations = [];
        }

        // Compute soft violations for this row
        var rowViolations = computeRowSoftViolations(row, input, globalRoomUsageForViolations);
        row.softViolations = rowViolations;

        // Update global room usage map after computing violations for this row
        var rowRoomKey = row.room_key || '';
        var rowProctorKeys = row.proctor_keys || [];
        if (rowRoomKey) {
          if (!globalRoomUsageForViolations[rowRoomKey]) {
            globalRoomUsageForViolations[rowRoomKey] = new Set();
          }
          for (var rpk = 0; rpk < rowProctorKeys.length; rpk++) {
            if (rowProctorKeys[rpk]) {
              globalRoomUsageForViolations[rowRoomKey].add(rowProctorKeys[rpk]);
            }
          }
        }

        // Count infeasible slots: rows where proctors array is empty or shorter than expected
        var actualProctorCount = 0;
        for (var pc = 0; pc < rowProctorKeys.length; pc++) {
          if (rowProctorKeys[pc]) actualProctorCount++;
        }
        if (actualProctorCount < proctorsPerRoom) {
          var shortage = proctorsPerRoom - actualProctorCount;
          totalInfeasibleSlots += shortage;
          var rowHdKey = row.halfday_key || 'unknown';
          if (!shortagesMap[rowHdKey]) shortagesMap[rowHdKey] = 0;
          shortagesMap[rowHdKey] += shortage;
        }
      }

      diagnostics.totalInfeasibleSlots = totalInfeasibleSlots;

      // Build shortages array from map
      var shortagesKeys = Object.keys(shortagesMap);
      for (var si = 0; si < shortagesKeys.length; si++) {
        diagnostics.shortages.push({
          halfdayKey: shortagesKeys[si],
          count: shortagesMap[shortagesKeys[si]]
        });
      }

      // Step 8: Compute softViolationsByType from all rows
      var svByType = { sameRoomRepeats: 0, subjectConflicts: 0, groupMismatches: 0, genderImbalances: 0 };
      for (var svi = 0; svi < finalAssignments.length; svi++) {
        var sv = finalAssignments[svi].softViolations || [];
        for (var svj = 0; svj < sv.length; svj++) {
          var vType = sv[svj];
          if (vType === 'sameRoomRepeat') svByType.sameRoomRepeats++;
          else if (vType === 'subjectConflict') svByType.subjectConflicts++;
          else if (vType === 'groupMismatch') svByType.groupMismatches++;
          else if (vType === 'genderImbalance') svByType.genderImbalances++;
        }
      }
      diagnostics.softViolationsByType = svByType;

      // Step 9: Compute load balance stats
      if (phase2Result.loadState) {
        diagnostics.loadBalance = computeLoadStats(phase2Result.loadState);
      }
      diagnostics.maxPrimaryLoadGapWithinClass = computeMaxGapWithinClass(
        phase2Result.classIdByProctorKey || {},
        phase2Result.loadState || {}
      );
      var actualDutyPairs = computeActualDutyPairs(
        input.proctorsList || [],
        phase2Result.classBoundsByProctorKey || {},
        phase2Result.loadState || {}
      );
      var expectedDuty = Math.max(0, Number(input.D_expected) || 0);
      var expectedDutyDiff = Math.abs(expectedDuty - actualDutyPairs);
      if (expectedDuty > 0 && expectedDutyDiff / Math.max(expectedDuty, 1) > 0.2) {
        diagnostics.warnings.push({
          type: 'd_expected_divergence',
          expected: expectedDuty,
          actual: actualDutyPairs,
          message: 'D_expected = ' + expectedDuty + '، لكن عدد أزواج المداومة الفعلي = ' + actualDutyPairs + '؛ قد تكون حدود العدالة المعروضة غير محدّثة.'
        });
      }

      // Step 10: Set orchestratorState
      if (phase2TimedOut) {
        diagnostics.orchestratorState = 'TIMEOUT';
      } else if (diagnostics.errors.length > 0) {
        // Errors occurred but we still produced a result (degraded)
        diagnostics.orchestratorState = 'COMPLETED';
      } else {
        diagnostics.orchestratorState = 'COMPLETED';
      }
      diagnostics.totalDurationMs = Date.now() - startTime;

      _isRunning = false;
      return { result: finalAssignments, diagnostics: diagnostics };

    } catch (e) {
      diagnostics.totalDurationMs = Date.now() - startTime;
      if (diagnostics.errors.indexOf(e.message) === -1) {
        diagnostics.errors.push(e.message);
      }
      diagnostics.orchestratorState = 'ERROR';
      _isRunning = false;
      throw e;
    }
  }
  // MODULE EXPORT
  // ============================================================

  window.ProctorDistributionV2 = {
    run: orchestrator,
    // Expose internals for testing
    _internals: {
      buildSeededPRNG: buildSeededPRNG,
      validateInput: validateInput,
      computeHalfdayKey: computeHalfdayKey,
      getScheduleDateKey: getScheduleDateKey,
      computeBounds: computeBounds,
      createLoadState: createLoadState,
      getTeacherLoad: getTeacherLoad,
      addGuardLoad: addGuardLoad,
      addReserveLoad: addReserveLoad,
      addDutyLoad: addDutyLoad,
      getGuardCount: getGuardCount,
      getPrimaryLoad: getPrimaryLoad,
      getFinalLoad: getFinalLoad,
      computeReserveTarget: computeReserveTarget,
      computeLoadStats: computeLoadStats,
      computeEligibilityClasses: computeEligibilityClasses,
      computeClassBounds: computeClassBounds,
      serializeClassBounds: serializeClassBounds,
      collectUncovered: collectUncovered,
      phase2_75CoverageRepair: phase2_75CoverageRepair,
      computeMaxGapWithinClass: computeMaxGapWithinClass,
      computeActualDutyPairs: computeActualDutyPairs,
      isMorningHalfday: isMorningHalfday,
      INFINITY_SENTINEL: INFINITY_SENTINEL,
      SA_DEFAULTS: SA_DEFAULTS,
      WEIGHTS_PRESETS: WEIGHTS_PRESETS,
      // CSP helpers
      getProctorKey: getProctorKey,
      getProctorExemptionKey: getProctorExemptionKey,
      buildKeyAdapter: buildKeyAdapter,
      toCanonicalKey: toCanonicalKey,
      getSessionKey: getSessionKey,
      getDayKey: getDayKey,
      getScheduleSessionKeyForDuty: getScheduleSessionKeyForDuty,
      getLegacyScheduleSessionKey: getLegacyScheduleSessionKey,
      isProctorExemptForEntry: isProctorExemptForEntry,
      isDutyTeacherForEntry: isDutyTeacherForEntry,
      isExemptForAnyRow: isExemptForAnyRow,
      getScheduleEntryId: getScheduleEntryId,
      getRoomConstraintKey: getRoomConstraintKey,
      // Phase functions
      phase1PrePass: phase1PrePass,
      phase2Build: phase2Build,
      phase2_5PopulateReserves: phase2_5PopulateReserves,
      computeAffinityRank: computeAffinityRank,
      collectSessionsInHalfday: collectSessionsInHalfday,
      phase3Optimize: phase3Optimize,
      hungarianSolver: hungarianSolver,
      costFunction: costFunction,
      greedyFallback: greedyFallback,
      buildCSPModel: buildCSPModel,
      runAC3: runAC3,
      revise: revise,
      extractSingletons: extractSingletons,
      buildCostMatrix: buildCostMatrix,
      normalizeGender: normalizeGender,
      // Phase 3 helpers
      objectiveFunction: objectiveFunction,
      resolveWeights: resolveWeights,
      deepCopyAssignments: deepCopyAssignments,
      violatesHardConstraints: violatesHardConstraints,
      generateSwapGuards: generateSwapGuards,
      generateSwapRoles: generateSwapRoles,
      generateReassignReserve: generateReassignReserve,
      applyMove: applyMove,
      undoMove: undoMove,
      // Orchestrator helpers
      computeRowSoftViolations: computeRowSoftViolations,
      validateProctorReferences: validateProctorReferences
    }
  };

})();
