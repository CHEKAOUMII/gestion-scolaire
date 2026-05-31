// Proctor Distribution V3 — orchestrator.
//
// Wires up the full V3 phase pipeline:
//   Phase 0  → validate input
//   Phase 1  → normalize keys
//   Phase 1b → build rooms and empty result rows
//   Phase 2  → derive eligibility classes
//   Phase 3  → compute bounds
//   Phase 4  → place guards (CP solver)
//   Phase 5  → multi-step coverage repair
//   Phase 6  → same-day infeasibility detection (pure inspection)
//   pre-check → conditional relaxed-mode pre-check (orchestrator-level, not
//               inside Phase 6 — preserves Phase 6 purity, see design.md §4)
//   Phase 7  → bimodal repair (local search)
//   Phase 8  → AM/PM balance (local search)
//   Phase 9  → place reserves
//   Phase 10 → finalize (softViolations + diagnostics + JSON-safety)
//
// Acceptance Criteria covered:
//   - 1.1, 1.2, 1.3, 1.4, 1.14 : public envelope + idempotent re-run + V2-shape
//   - 4.2, 4.2a, 4.2b          : conditional same-day relaxation pre-check
//   - 9.1, 9.2, 9.7, 9.8       : diagnostics envelope + structured errors
//   - 12.1, 12.2, 12.3         : phase pipeline architecture
//   - 12.4                     : post-placement guards live in phases 5/7/8
//   - 12.5                     : try/catch around each phase
//   - 12.6                     : global 30s budget + per-phase budgets
//
// V2 pitfalls explicitly avoided (per tasks.md task 23):
//   1. NO module-level mutable state for re-entrancy. Every per-run
//      variable lives inside `runOrchestrator` (closure-local). Re-entrant
//      callers see no shared state between invocations.
//   2. Distinct orchestrator states: 'COMPLETED' | 'DEGRADED' | 'TIMEOUT'
//      | 'ERROR'. We ALSO emit a fifth state, 'INVALID_INPUT', when
//      Phase 0 rejects the input — this is structurally distinct from
//      the other four because no pipeline ran. (The four states from
//      tasks.md are all post-Phase-0 states.)
//   3. `diagnostics.errors` is an array of structured objects:
//          { type, message, phase?, details? }
//      NOT an array of strings.

'use strict';

var path = require('path');

var phase00 = require(path.join(__dirname, 'phases', '00-validate.js'));
var phase01 = require(path.join(__dirname, 'phases', '01-normalize-keys.js'));
var phase01b = require(path.join(__dirname, 'phases', '01b-build-rooms-and-rows.js'));
var phase02 = require(path.join(__dirname, 'phases', '02-eligibility-classes.js'));
var phase03 = require(path.join(__dirname, 'phases', '03-bounds.js'));
var phase04 = require(path.join(__dirname, 'phases', '04-place-guards.js'));
var phase05 = require(path.join(__dirname, 'phases', '05-coverage-repair.js'));
var phase06 = require(path.join(__dirname, 'phases', '06-same-day-detect.js'));
var phase07 = require(path.join(__dirname, 'phases', '07-bimodal-repair.js'));
var phase08 = require(path.join(__dirname, 'phases', '08-ampm-balance.js'));
var phase09 = require(path.join(__dirname, 'phases', '09-place-reserves.js'));
var phase10 = require(path.join(__dirname, 'phases', '10-finalize.js'));

var loadStateUtils = require(path.join(__dirname, 'utils', 'load-state.js'));
var prngUtils = require(path.join(__dirname, 'utils', 'prng.js'));
var diagnosticsModule = require(path.join(__dirname, 'diagnostics.js'));

var validateInput = phase00.validateInput;
var normalizeKeys = phase01.normalizeKeys;
var buildRoomsAndRows = phase01b.buildRoomsAndRows;
var deriveEligibilityClasses = phase02.deriveEligibilityClasses;
var computeBounds = phase03.computeBounds;
var placeGuards = phase04.placeGuards;
var multiStepCoverageRepair = phase05.multiStepCoverageRepair;
var detectSameDayInfeasibility = phase06.detectSameDayInfeasibility;
var bimodalRepair = phase07.bimodalRepair;
var ampmBalance = phase08.ampmBalance;
var placeReserves = phase09.placeReserves;
var finalize = phase10.finalize;

var createLoadState = loadStateUtils.createLoadState;
var addDutyLoad = loadStateUtils.addDutyLoad;
var createPRNG = prngUtils.createPRNG;
var buildDiagnostics = diagnosticsModule.buildDiagnostics;

// Global wall-clock budget for one full pipeline run (AC 12.6).
var DEFAULT_TOTAL_BUDGET_MS = 30000;

// Pre-check guard: skip the relaxed-mode pre-check if remaining budget
// is below this threshold (design.md §4 Phase 6 + §9 Time Budget).
var PRECHECK_MIN_REMAINING_MS = 7000;

// Pre-check sub-budgets (design.md §4 Phase 6).
var DEFAULT_PRECHECK_PHASE4_BUDGET_MS = 5000;
var DEFAULT_PRECHECK_PHASE5_BUDGET_MS = 2000;

// ---------------------------------------------------------------------------
// Internal helpers (pure, stateless)
// ---------------------------------------------------------------------------

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    return true;
}

function shallowCopyState(state) {
    var out = {};
    var keys = Object.keys(state);
    for (var i = 0; i < keys.length; i += 1) {
        out[keys[i]] = state[keys[i]];
    }
    return out;
}

function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

function nowMs() {
    return Date.now();
}

/**
 * Produce a deterministic-ish seed when `randomSeed` is absent (AC 8.3).
 * We use the same source the tests expect (Date.now()), but constrained
 * to a 32-bit unsigned integer so mulberry32 ingests it cleanly.
 */
function deriveSeedFromClock() {
    return Date.now() >>> 0;
}

/**
 * Build an empty diagnostics shell with all required arrays present so
 * each phase can `slice()` them safely.
 */
function freshDiagnostics() {
    return {
        warnings: [],
        errors: [],
        unresolvedSlots: [],
        coverageWarnings: [],
        coverageRepairSwaps: 0,
        coverageRepairUnresolved: 0
    };
}

/**
 * Pre-load the load-state with duty counts. Phase 4 + Phase 5 expect this
 * (per tests/proctor-v3/coverage-repair.test.js seeding pattern).
 *
 * The load-state is keyed by canonical proctor key. Duty entries come
 * from `state.normalizedDutyData` (Phase 1 output): an object keyed by
 * `halfday_key`, each value an inner object whose keys are canonical
 * proctor keys.
 */
function seedLoadStateWithDuty(state) {
    var input = state.input;
    var canonicalKeys = [];
    if (Array.isArray(input.proctorsList)) {
        for (var i = 0; i < input.proctorsList.length; i += 1) {
            canonicalKeys.push(canonicalKeyOf(input.proctorsList[i], i));
        }
    }
    var ls = createLoadState(canonicalKeys);

    var nd = isPlainObject(state.normalizedDutyData) ? state.normalizedDutyData : null;
    if (nd) {
        var hdKeys = Object.keys(nd);
        for (var h = 0; h < hdKeys.length; h += 1) {
            var hd = hdKeys[h];
            var inner = nd[hd];
            if (!isPlainObject(inner)) continue;
            var procKeys = Object.keys(inner);
            for (var p = 0; p < procKeys.length; p += 1) {
                addDutyLoad(ls, procKeys[p], hd);
            }
        }
    }
    return ls;
}

/**
 * Build a fresh, isolated relaxed state for the same-day pre-check by
 * re-running Phases 1..3 on a clone of the input with
 * `allowSameDayBothHalfdays: true`. The relaxed state shares no mutable
 * references with the strict state.
 *
 * Used by the orchestrator's conditional same-day relaxation pre-check.
 *
 * Exported via _internals for tests (orchestrator-precheck.test.js).
 */
function buildRelaxedState(strictInput, options) {
    var relaxedRules = isPlainObject(strictInput.examDistributionRules)
        ? Object.assign({}, strictInput.examDistributionRules) : {};
    relaxedRules.allowSameDayBothHalfdays = true;

    var relaxedInput = Object.assign({}, strictInput);
    relaxedInput.examDistributionRules = relaxedRules;

    var relaxedState = { input: relaxedInput, options: options || {} };

    relaxedState = normalizeKeys(relaxedState);
    relaxedState = buildRoomsAndRows(relaxedState);
    relaxedState = deriveEligibilityClasses(relaxedState);
    relaxedState = computeBounds(relaxedState);
    relaxedState.loadState = seedLoadStateWithDuty(relaxedState);
    return relaxedState;
}

// ---------------------------------------------------------------------------
// runSameDayPreCheck — orchestrator-level conditional helper
// ---------------------------------------------------------------------------

/**
 * Perform the relaxed-mode pre-check and emit the appropriate warning into
 * a NEW state with cloned diagnostics. The strict state itself is NOT
 * mutated (purity is preserved at the orchestrator level too).
 *
 * Pre-conditions:
 *   - `state.diagnostics.preCheckRequired === true` (set by Phase 6).
 *
 * If `preCheckRequired` is falsy, this function returns the input state
 * shallow-cloned with no warning emitted (defensive no-op — keeps callers
 * simple).
 *
 * @param {Object} state - strict-run state after Phase 6.
 * @param {Object} [options]
 * @param {number} [options.phase4BudgetMs=5000]
 * @param {number} [options.phase5BudgetMs=2000]
 * @returns {Object} new state with `state.diagnostics.warnings` extended.
 */
function runSameDayPreCheck(state, options) {
    if (state === null || state === undefined) {
        throw new TypeError('runSameDayPreCheck: state must be an object');
    }
    if (!isPlainObject(state.input)) {
        throw new TypeError('runSameDayPreCheck: state.input must be a plain object');
    }
    var diag = isPlainObject(state.diagnostics) ? state.diagnostics : {};
    var opts = isPlainObject(options) ? options : {};

    if (!diag.preCheckRequired) {
        var ns0 = shallowCopyState(state);
        ns0.diagnostics = Object.assign({}, diag, {
            warnings: Array.isArray(diag.warnings) ? diag.warnings.slice() : [],
            errors: Array.isArray(diag.errors) ? diag.errors.slice() : [],
            unresolvedSlots: Array.isArray(diag.unresolvedSlots)
                ? diag.unresolvedSlots.slice() : []
        });
        return ns0;
    }

    var phase4Budget = (typeof opts.phase4BudgetMs === 'number' && opts.phase4BudgetMs >= 0)
        ? opts.phase4BudgetMs : DEFAULT_PRECHECK_PHASE4_BUDGET_MS;
    var phase5Budget = (typeof opts.phase5BudgetMs === 'number' && opts.phase5BudgetMs >= 0)
        ? opts.phase5BudgetMs : DEFAULT_PRECHECK_PHASE5_BUDGET_MS;

    var preCheckOptions = {
        phase4TimeBudgetMs: phase4Budget,
        phase5TimeBudgetMs: phase5Budget
    };

    var relaxedState = buildRelaxedState(state.input, preCheckOptions);
    relaxedState = placeGuards(relaxedState);
    relaxedState = multiStepCoverageRepair(relaxedState);

    var relaxedDiag = isPlainObject(relaxedState.diagnostics)
        ? relaxedState.diagnostics : {};
    var relaxedUnresolvedCount = Array.isArray(relaxedDiag.unresolvedSlots)
        ? relaxedDiag.unresolvedSlots.length : 0;

    var impactedSlotsCount = (typeof diag.preCheckUnresolvedCount === 'number')
        ? diag.preCheckUnresolvedCount
        : (Array.isArray(diag.unresolvedSlots) ? diag.unresolvedSlots.length : 0);

    var warning;
    if (relaxedUnresolvedCount === 0) {
        // AC 4.2 — strict failed but relaxed succeeded → same-day is the cause.
        warning = {
            type: 'same_day_relaxation_suggested',
            impactedSlotsCount: impactedSlotsCount,
            message: 'غير ممكن التغطية بدون السماح بحراسة نفس الأستاذ صباحاً ومساءً في نفس اليوم. هل تريد تفعيل هذا الخيار؟'
        };
    } else {
        // AC 4.2a — both runs failed → root cause is structural.
        warning = {
            type: 'coverage_infeasible_regardless',
            impactedSlotsCount: impactedSlotsCount,
            message: 'التغطية الكاملة غير ممكنة حتى مع تفعيل السماح بنفس اليوم — راجع عدد الأساتذة أو الإعفاءات.'
        };
    }

    var nextWarnings = Array.isArray(diag.warnings) ? diag.warnings.slice() : [];
    nextWarnings.push(warning);

    var nextDiag = Object.assign({}, diag, {
        warnings: nextWarnings,
        errors: Array.isArray(diag.errors) ? diag.errors.slice() : [],
        unresolvedSlots: Array.isArray(diag.unresolvedSlots)
            ? diag.unresolvedSlots.slice() : [],
        preCheckRelaxedUnresolvedCount: relaxedUnresolvedCount
    });

    var ns = shallowCopyState(state);
    ns.diagnostics = nextDiag;
    return ns;
}

// ---------------------------------------------------------------------------
// runOrchestrator — full V3 pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full V3 distribution pipeline.
 *
 * @param {Object} input  - GS3 input contract.
 * @param {Object} [options]
 * @param {number} [options.totalBudgetMs=30000] - global wall-clock budget.
 * @returns {{
 *   result: Array,                 // ResultRow[] (V2-shape compatible)
 *   diagnostics: Object,           // DiagnosticsV3
 *   algorithmVersion: 'v3',
 *   orchestratorState: 'COMPLETED'|'DEGRADED'|'TIMEOUT'|'ERROR'|'INVALID_INPUT'
 * }}
 */
function runOrchestrator(input, options) {
    // -----------------------------------------------------------------------
    // CLOSURE-LOCAL state. NO module-level mutable variables (V2 had a
    // module-level `_isRunning` flag for re-entrancy — we do not).
    // -----------------------------------------------------------------------
    var startTime = nowMs();
    var opts = isPlainObject(options) ? options : {};
    var totalBudgetMs = (typeof opts.totalBudgetMs === 'number' && opts.totalBudgetMs > 0)
        ? opts.totalBudgetMs
        : DEFAULT_TOTAL_BUDGET_MS;

    var phaseDurations = {};
    var orchestratorErrors = [];   // structured errors collected by the orchestrator wrapper
    var orchestratorWarnings = []; // structured warnings (e.g. phase_timeout)
    var timedOut = false;
    var fatalError = null;

    function remainingBudget() {
        var elapsed = nowMs() - startTime;
        return Math.max(0, totalBudgetMs - elapsed);
    }

    function isOverBudget() {
        return remainingBudget() <= 0;
    }

    /**
     * Run a single phase wrapped in try/catch + timing + budget enforcement.
     *
     * - On exception: record a structured error in `orchestratorErrors`
     *   and return `prevState` UNCHANGED so the next phase can still run.
     *   (AC 12.5 — "continue with successor state".)
     * - On budget exhaustion BEFORE invocation: skip the phase and record
     *   a `phase_timeout` warning. (AC 12.6.)
     * - Records elapsed time in `phaseDurations[phaseName]`.
     */
    function runPhase(phaseName, phaseFn, prevState) {
        if (isOverBudget()) {
            timedOut = true;
            orchestratorWarnings.push({
                type: 'phase_timeout',
                phase: phaseName,
                durationMs: 0,
                message: 'Phase ' + phaseName + ' skipped — global time budget exhausted before invocation.'
            });
            return prevState;
        }
        var t0 = nowMs();
        try {
            var nextState = phaseFn(prevState);
            phaseDurations[phaseName] = nowMs() - t0;
            // If the phase exhausted the budget mid-run, mark it but
            // keep the produced state — the phase's own internal
            // budget handling will have already returned a partial.
            if (isOverBudget()) {
                timedOut = true;
                orchestratorWarnings.push({
                    type: 'phase_timeout',
                    phase: phaseName,
                    durationMs: phaseDurations[phaseName],
                    message: 'Phase ' + phaseName + ' completed but global time budget is now exhausted.'
                });
            }
            return nextState;
        } catch (err) {
            phaseDurations[phaseName] = nowMs() - t0;
            orchestratorErrors.push({
                type: 'phase_exception',
                phase: phaseName,
                message: err && err.message ? String(err.message) : String(err),
                details: {
                    name: err && err.name ? String(err.name) : 'Error',
                    stack: err && err.stack ? String(err.stack) : null
                }
            });
            // Per AC 12.5 — continue with successor state. Returning
            // `prevState` lets later phases at least see a consistent view.
            return prevState;
        }
    }

    // -----------------------------------------------------------------------
    // Phase 0 — Validate input. If invalid, short-circuit with a structured
    // result and orchestrator state 'INVALID_INPUT'.
    // -----------------------------------------------------------------------
    var validation;
    try {
        validation = validateInput(input);
    } catch (err) {
        validation = {
            valid: false,
            errors: [{
                type: 'validate_input_exception',
                message: err && err.message ? String(err.message) : String(err)
            }]
        };
    }

    if (!validation || !validation.valid) {
        // Short-circuit: nothing else can run safely.
        var validationErrors = (validation && Array.isArray(validation.errors))
            ? validation.errors.slice()
            : [{ type: 'invalid_input', message: 'validateInput returned invalid result' }];

        // Normalize each error to the structured-object shape expected by
        // V3's diagnostics contract (V2 used strings — we explicitly do not).
        for (var ve = 0; ve < validationErrors.length; ve += 1) {
            if (typeof validationErrors[ve] === 'string') {
                validationErrors[ve] = {
                    type: 'invalid_input',
                    message: validationErrors[ve],
                    phase: 'validate'
                };
            } else if (isPlainObject(validationErrors[ve])) {
                if (!validationErrors[ve].phase) {
                    validationErrors[ve] = Object.assign(
                        { phase: 'validate' },
                        validationErrors[ve]
                    );
                }
            }
        }

        var invalidDiag = {
            algorithmVersion: 'v3',
            seedUsed: 0,
            totalDurationMs: nowMs() - startTime,
            phaseDurations: { validate: 0 },
            histogramByGuardCount: {},
            histogramByPrimaryLoad: {},
            min: 0,
            max: 0,
            distinctCount: 0,
            globalLowerBound: 0,
            globalUpperBound: 0,
            classBoundsByProctorKey: {},
            unresolvedSlots: [],
            coverageWarnings: [],
            coverageRepairSwaps: 0,
            coverageRepairUnresolved: 0,
            orphanInputKeys: [],
            amPmImbalanceByProctorKey: {},
            zeroLoadProctors: [],
            reserveImbalances: [],
            finalLoadOverflows: [],
            warnings: [],
            errors: validationErrors,
            preCheckRequired: false
        };

        return {
            result: [],
            diagnostics: invalidDiag,
            algorithmVersion: 'v3',
            orchestratorState: 'INVALID_INPUT'
        };
    }

    // -----------------------------------------------------------------------
    // Pipeline state initialization. Closure-local — never module-level.
    // -----------------------------------------------------------------------
    var seedUsed;
    if (isPlainObject(input) && Number.isFinite(input.randomSeed)) {
        seedUsed = input.randomSeed;
    } else {
        seedUsed = deriveSeedFromClock();
    }

    var rng;
    try {
        rng = createPRNG(seedUsed);
    } catch (err) {
        // Defensive: fall back to clock-derived seed if input.randomSeed
        // was non-finite for some pathological reason.
        seedUsed = deriveSeedFromClock();
        rng = createPRNG(seedUsed);
    }

    var state = {
        input: input,
        options: opts,
        rng: rng,
        startTime: startTime,
        diagnostics: freshDiagnostics()
    };

    // -----------------------------------------------------------------------
    // Phases 1 → 1b → 2 → 3
    // -----------------------------------------------------------------------
    state = runPhase('normalizeKeys', normalizeKeys, state);
    state = runPhase('buildRoomsAndRows', buildRoomsAndRows, state);
    state = runPhase('eligibilityClasses', deriveEligibilityClasses, state);
    state = runPhase('bounds', computeBounds, state);

    // Pre-load duty into loadState before Phase 4. Wrapped in try/catch so
    // a malformed normalizedDutyData doesn't abort the pipeline.
    try {
        if (!state.loadState) {
            state.loadState = seedLoadStateWithDuty(state);
        }
    } catch (err) {
        orchestratorErrors.push({
            type: 'phase_exception',
            phase: 'seedLoadState',
            message: err && err.message ? String(err.message) : String(err)
        });
        // Provide an empty loadState so phase 4 doesn't crash on undefined.
        state.loadState = createLoadState([]);
    }

    // -----------------------------------------------------------------------
    // Phase 4 — Place Guards (heart of the algorithm).
    // -----------------------------------------------------------------------
    state = runPhase('placeGuards', placeGuards, state);

    // -----------------------------------------------------------------------
    // Phase 5 — Multi-Step Coverage Repair.
    // -----------------------------------------------------------------------
    state = runPhase('coverageRepair', multiStepCoverageRepair, state);

    // -----------------------------------------------------------------------
    // Phase 6 — Same-Day Infeasibility Detection (pure inspection).
    // -----------------------------------------------------------------------
    state = runPhase('sameDayDetect', detectSameDayInfeasibility, state);

    // -----------------------------------------------------------------------
    // Conditional pre-check (orchestrator-level — NOT inside Phase 6).
    // Triggered by `state.diagnostics.preCheckRequired === true` AND a
    // remaining budget of at least 7s (design.md §4 Phase 6 + §9).
    // -----------------------------------------------------------------------
    var diagAfterPhase6 = isPlainObject(state.diagnostics) ? state.diagnostics : {};
    if (diagAfterPhase6.preCheckRequired === true) {
        if (remainingBudget() >= PRECHECK_MIN_REMAINING_MS) {
            state = runPhase('sameDayPreCheck', function (s) {
                return runSameDayPreCheck(s, {
                    phase4BudgetMs: DEFAULT_PRECHECK_PHASE4_BUDGET_MS,
                    phase5BudgetMs: DEFAULT_PRECHECK_PHASE5_BUDGET_MS
                });
            }, state);
        } else {
            // Skip the pre-check but record why so consumers can tell
            // the difference between "not needed" and "skipped due to budget".
            orchestratorWarnings.push({
                type: 'precheck_skipped',
                phase: 'sameDayPreCheck',
                remainingMs: remainingBudget(),
                message: 'Same-day pre-check skipped — remaining budget below 7s threshold.'
            });
        }
    }

    // -----------------------------------------------------------------------
    // Phases 7 → 8 → 9
    // -----------------------------------------------------------------------
    state = runPhase('bimodalRepair', bimodalRepair, state);
    state = runPhase('ampmBalance', ampmBalance, state);
    state = runPhase('placeReserves', placeReserves, state);

    // -----------------------------------------------------------------------
    // Phase 10 — Finalize. Done even if previous phases erred so the user
    // gets the best-effort result with diagnostics.
    // -----------------------------------------------------------------------
    state = runPhase('finalize', finalize, state);

    // -----------------------------------------------------------------------
    // Merge orchestrator-level errors/warnings into final diagnostics.
    // Phase 10 (finalize) emits a fully-formed DiagnosticsV3 — we extend
    // its `errors` and `warnings` with any orchestrator-level entries.
    // -----------------------------------------------------------------------
    var finalDiag;
    if (isPlainObject(state.diagnostics)
        && state.diagnostics.algorithmVersion === 'v3') {
        // Phase 10 produced a full diagnostics envelope.
        finalDiag = state.diagnostics;
    } else {
        // Phase 10 was skipped or errored. Build a fallback envelope from
        // whatever state we have. `buildDiagnostics` is defensive and will
        // produce a usable object even with a partial state.
        try {
            finalDiag = buildDiagnostics(state);
        } catch (err) {
            orchestratorErrors.push({
                type: 'diagnostics_build_failure',
                phase: 'finalize',
                message: err && err.message ? String(err.message) : String(err)
            });
            finalDiag = {
                algorithmVersion: 'v3',
                seedUsed: seedUsed,
                totalDurationMs: nowMs() - startTime,
                phaseDurations: phaseDurations,
                histogramByGuardCount: {},
                histogramByPrimaryLoad: {},
                min: 0,
                max: 0,
                distinctCount: 0,
                globalLowerBound: 0,
                globalUpperBound: 0,
                classBoundsByProctorKey: {},
                unresolvedSlots: [],
                coverageWarnings: [],
                coverageRepairSwaps: 0,
                coverageRepairUnresolved: 0,
                orphanInputKeys: [],
                amPmImbalanceByProctorKey: {},
                zeroLoadProctors: [],
                reserveImbalances: [],
                finalLoadOverflows: [],
                warnings: [],
                errors: []
            };
            fatalError = err;
        }
    }

    // Extend with orchestrator-level errors/warnings. Always produce fresh
    // arrays so we never mutate diagnostics state we received.
    var mergedErrors = Array.isArray(finalDiag.errors) ? finalDiag.errors.slice() : [];
    var mergedWarnings = Array.isArray(finalDiag.warnings) ? finalDiag.warnings.slice() : [];
    for (var oe = 0; oe < orchestratorErrors.length; oe += 1) {
        mergedErrors.push(orchestratorErrors[oe]);
    }
    for (var ow = 0; ow < orchestratorWarnings.length; ow += 1) {
        mergedWarnings.push(orchestratorWarnings[ow]);
    }

    // Refresh the diagnostics with merged collections + canonical
    // phaseDurations / totalDurationMs computed at orchestrator level
    // (covers phases that ran in try/catch and never updated state).
    var totalDurationMs = nowMs() - startTime;
    finalDiag = Object.assign({}, finalDiag, {
        errors: mergedErrors,
        warnings: mergedWarnings,
        phaseDurations: Object.assign({}, finalDiag.phaseDurations || {}, phaseDurations),
        totalDurationMs: totalDurationMs,
        seedUsed: seedUsed
    });

    // -----------------------------------------------------------------------
    // Determine orchestratorState (V2 had a dead branch — V3 must emit
    // distinct states).
    //
    //   ERROR     → fatal exception that prevented even building diagnostics
    //   TIMEOUT   → global budget exhausted at any point
    //   DEGRADED  → completed but errors[] non-empty (or unresolvedSlots > 0)
    //   COMPLETED → clean run with no errors and no unresolved slots
    // -----------------------------------------------------------------------
    var rows = Array.isArray(state.result)
        ? state.result
        : (Array.isArray(state.rows) ? state.rows : []);

    var orchestratorState;
    if (fatalError) {
        orchestratorState = 'ERROR';
    } else if (timedOut) {
        orchestratorState = 'TIMEOUT';
    } else if (mergedErrors.length > 0
        || (Array.isArray(finalDiag.unresolvedSlots) && finalDiag.unresolvedSlots.length > 0)) {
        orchestratorState = 'DEGRADED';
    } else {
        orchestratorState = 'COMPLETED';
    }

    return {
        result: rows,
        diagnostics: finalDiag,
        algorithmVersion: 'v3',
        orchestratorState: orchestratorState
    };
}

module.exports = {
    runOrchestrator: runOrchestrator,
    runSameDayPreCheck: runSameDayPreCheck,
    _internals: {
        buildRelaxedState: buildRelaxedState,
        seedLoadStateWithDuty: seedLoadStateWithDuty,
        DEFAULT_TOTAL_BUDGET_MS: DEFAULT_TOTAL_BUDGET_MS,
        DEFAULT_PRECHECK_PHASE4_BUDGET_MS: DEFAULT_PRECHECK_PHASE4_BUDGET_MS,
        DEFAULT_PRECHECK_PHASE5_BUDGET_MS: DEFAULT_PRECHECK_PHASE5_BUDGET_MS,
        PRECHECK_MIN_REMAINING_MS: PRECHECK_MIN_REMAINING_MS
    }
};
