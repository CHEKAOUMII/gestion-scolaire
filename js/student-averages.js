'use strict';

/**
 * Student Profile Term Averages — pure computation & formatting layer.
 *
 * Spec: .kiro/specs/student-profile-term-averages/
 * Task 1.1 (foundation): shared constants + `computeTermAverage`.
 *
 * This module is the single source of truth for the per-term and general
 * average computation that powers the "إحصائيات سريعة" quick-stats card and
 * the grades-tab KPIs row on the student profile page. It is a pure logic
 * layer with NO DOM and NO IPC, so it can be exercised by the Node test
 * runner (`npm test`, fast-check) without booting Electron, and attached to
 * the renderer as a browser global.
 *
 * It deliberately REUSES the existing helpers from `js/cc-rules.js`
 * (`computeSubjectAverage`, `computeWeightedGeneralAverage`, `detectBranch`,
 * `ccBaseSubject`) and `normalizeSubjectName` rather than reimplementing any
 * math, mirroring the grouping logic currently inlined in
 * `js/pages/student-profile.js` (`renderMiniStats` / `renderGradesTab`).
 *
 * Loaded via `<script src="js/student-averages.js"></script>` in the renderer
 * (after `js/cc-rules.js`), and `require`-able from Node tests.
 *
 * @see .kiro/specs/student-profile-term-averages/design.md
 */
(function () {
    // -----------------------------------------------------------------------
    // Shared constants
    // -----------------------------------------------------------------------

    /**
     * The single placeholder character shown when an average is unavailable.
     * Used identically by both views to satisfy the cross-view consistency
     * requirement (R6.4). Parses to `NaN` for the existing print/risk
     * consumer, preserving the no-numeric-average fallback behavior.
     */
    var AVG_PLACEHOLDER = '\u2014'; // em dash "—"

    /**
     * Round a number to 2 decimal places.
     * @param {number} x
     * @returns {number}
     */
    function round2(x) {
        return Math.round(x * 100) / 100;
    }

    /**
     * Discriminate an *entered* grade value from a *not-entered* placeholder by
     * inspecting the RAW value BEFORE any numeric coercion. This is the single
     * source of truth shared by the renderer, the pure averaging layers
     * (`computeTermAverage`, `computeSubjectAverage`) and the tests.
     *
     * Returns `true` only when the raw value is a real, deliberately-recorded
     * mark — a finite number (including a genuine `0`) or a numeric string
     * (including `'0'`). Returns `false` for not-entered placeholders:
     * `null`, `undefined`, empty/whitespace-only strings, and any non-numeric
     * value (e.g. `'x'`, `'—'`, `NaN`, `Infinity`).
     *
     * NOTE: a genuine numeric `0` / `'0'` (exam absence/cheating) is ENTERED
     * and must keep counting in averages and KPIs.
     *
     * @param {*} raw  The raw grade value as delivered (pre-coercion).
     * @returns {boolean}
     */
    function isGradeEntered(raw) {
        if (raw === null || raw === undefined) return false;
        if (typeof raw === 'number') return isFinite(raw);
        if (typeof raw === 'string') {
            var trimmed = raw.trim();
            if (trimmed === '') return false;
            return isFinite(Number(trimmed));
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // Dependency resolution
    //
    // In the browser, the cc-rules.js / utils.js helpers are plain function
    // declarations that live on the global scope, so we read them from there.
    // In Node, we additionally attempt a `require` so test files can exercise
    // the module. Every lookup is guarded with `typeof fn === 'function'` so a
    // missing helper degrades gracefully (the module falls back to a simple
    // mean) instead of throwing.
    // -----------------------------------------------------------------------

    var _root = (typeof globalThis !== 'undefined')
        ? globalThis
        : (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {}));

    /**
     * Resolve a named helper function.
     *
     * Resolution order:
     *   1. A function already present on the global scope (browser + Node global).
     *   2. A named export from one of the candidate Node modules (Node only).
     *
     * @param {string} name             The function name to resolve.
     * @param {string[]} [modulePaths]   Optional Node module paths to probe.
     * @returns {Function|null}
     */
    function resolveFn(name, modulePaths) {
        // 1. Global scope (browser vanilla-script convention).
        if (typeof _root[name] === 'function') return _root[name];

        // 2. Node `require` fallback.
        if (typeof module !== 'undefined' && module.exports && typeof require === 'function' && modulePaths) {
            for (var i = 0; i < modulePaths.length; i++) {
                try {
                    var mod = require(modulePaths[i]);
                    if (mod && typeof mod[name] === 'function') return mod[name];
                    if (typeof mod === 'function' && mod.name === name) return mod;
                } catch (e) {
                    // Module not resolvable in this environment — keep degrading.
                }
            }
        }
        return null;
    }

    function getCcBaseSubject() { return resolveFn('ccBaseSubject', ['./cc-rules.js', './cc-rules']); }
    function getNormalizeSubjectName() {
        return resolveFn('normalizeSubjectName', ['./data/ma-education-labels.js', './utils.js']);
    }
    function getComputeSubjectAverage() { return resolveFn('computeSubjectAverage', ['./cc-rules.js', './cc-rules']); }
    function getComputeWeightedGeneralAverageResult() {
        return resolveFn('computeWeightedGeneralAverageResult', ['./cc-rules.js', './cc-rules']);
    }
    function getGradeHex() { return resolveFn('gradeHex', ['./cc-rules.js', './cc-rules']); }

    // -----------------------------------------------------------------------
    // computeTermAverage(termGrades, branch)
    // -----------------------------------------------------------------------

    /**
     * Compute the weighted general average for a single term's grade records.
     *
     * Mirrors the existing grouping logic from `student-profile.js`:
     *   1. Dedup records by `subject||semester`.
     *   2. Group by base subject via `ccBaseSubject(normalizeSubjectName(subject))`.
     *   3. Build `subjectAvgsArr` with `computeSubjectAverage`.
     *   4. Combine with `computeWeightedGeneralAverage(subjectAvgsArr, branch)`.
     *
     * @param {Array<{subject: string, grade: number, semester?: *}>} termGrades
     *        Grade records already filtered to a single term.
     * @param {string|null} branch  Branch code from `detectBranch` (may be null).
     * @returns {number|null}  `round2` of the weighted average, or `null` when
     *          `termGrades` is empty or yields no usable subject averages.
     */
     function buildTermSubjectAverages(enteredGrades, context) {
        var ccBaseSubjectFn = getCcBaseSubject();
        var normalizeSubjectNameFn = getNormalizeSubjectName();
        var computeSubjectAverageFn = getComputeSubjectAverage();
        var dedup = {};
        enteredGrades.forEach(function (g) {
            var key = String((g && g.subject) || '').trim() + '||' + ((g && g.semester) || '');
            dedup[key] = g;
        });

        var bySubject = {};
        Object.values(dedup).forEach(function (g) {
            var rawSubject = g && g.subject;
            var normalized = typeof normalizeSubjectNameFn === 'function' ? normalizeSubjectNameFn(rawSubject) : rawSubject;
            var subject = typeof ccBaseSubjectFn === 'function' ? ccBaseSubjectFn(normalized) : normalized;
            var baseSubject = subject || 'غير محدد';
            if (!bySubject[baseSubject]) bySubject[baseSubject] = [];
            bySubject[baseSubject].push(g);
        });

        return Object.keys(bySubject).map(function (subject) {
            var grades = bySubject[subject];
            var average = typeof computeSubjectAverageFn === 'function'
                 ? computeSubjectAverageFn(subject, grades, context)
                : grades.reduce(function (sum, grade) { return sum + Number(grade.grade); }, 0) / grades.length;
            return { subject: subject, avg: average };
        });
    }

    function computeTermAverageResult(termGrades, branch, context) {
        if (!termGrades || !termGrades.length) return { ok: true, value: null, incomplete: false };
        var enteredGrades = termGrades.filter(function (g) { return isGradeEntered(g && g.grade); });
        if (!enteredGrades.length) return { ok: true, value: null, incomplete: false };

         var subjectAverages = buildTermSubjectAverages(enteredGrades, context);
        if (!subjectAverages.length) return { ok: true, value: null, incomplete: false };
        var resolveAverage = getComputeWeightedGeneralAverageResult();
        if (typeof resolveAverage !== 'function') {
            return { ok: false, value: null, incomplete: true, code: 'MISSING_AVERAGE_ENGINE' };
        }

        var resolution = resolveAverage(subjectAverages, branch, context);
        if (!resolution.ok) {
            return {
                ok: false,
                value: null,
                incomplete: true,
                code: resolution.code,
                missingCoefficients: resolution.missingCoefficients,
                metadata: resolution.metadata
            };
        }
        return { ok: true, value: round2(resolution.value), incomplete: false };
    }

    function computeTermAverage(termGrades, branch, context) {
        return computeTermAverageResult(termGrades, branch, context).value;
    }

    // -----------------------------------------------------------------------
    // computeStudentAverages(grades, branch)
    // -----------------------------------------------------------------------

    /**
     * Top-level entry point used by both render paths (quick-stats card and
     * grades-tab KPIs). Partitions the student's grade records by term,
     * computes each term average, and derives the overall general average.
     *
     * Partition rule (R1.4, R2.4, R3.5): a record belongs to Term 1 iff
     * `Number(semester) === 1` and to Term 2 iff `Number(semester) === 2`.
     * Every other value (`0`, `null`, `undefined`, `''`, `NaN`, `3`, `"x"`, …)
     * is excluded from BOTH terms and from the general average.
     *
     * General-average rule (resolves the R2.5 / R3.2 conflict in favor of R3):
     *   - both terms non-null  → `round2((term1 + term2) / 2)`   (R3.1)
     *   - exactly one non-null → `round2` of the available term  (R3.2)
     *   - both null            → `null`                          (R3.3)
     *   - then any `general` outside `[0, 20]` is nulled out      (R3.6)
     *
     * @param {Array<{subject: string, grade: number, semester?: *}>} grades
     *        All of the student's grade records.
     * @param {string|null} branch  Branch code from `detectBranch` (may be null).
     * @returns {{term1: number|null, term2: number|null, general: number|null}}
     */
    function computeStudentAverages(grades, branch, context) {
        var all = Array.isArray(grades) ? grades : [];
        var term1Grades = [];
        var term2Grades = [];
        all.forEach(function (g) {
            var sem = Number(g && g.semester);
            if (sem === 1) term1Grades.push(g);
            else if (sem === 2) term2Grades.push(g);
        });

        var term1Result = computeTermAverageResult(term1Grades, branch, context);
        var term2Result = computeTermAverageResult(term2Grades, branch, context);
        var term1 = term1Result.value;
        var term2 = term2Result.value;
        var general = null;
        if (term1 != null && term2 != null) general = round2((term1 + term2) / 2);
        else if (term1 != null) general = round2(term1);
        else if (term2 != null) general = round2(term2);
        if (general != null && (!isFinite(general) || general < 0 || general > 20)) general = null;

        var incompleteResults = [term1Result, term2Result].filter(function (result) { return result.incomplete; });
        var missingCoefficients = incompleteResults.reduce(function (allMissing, result) {
            return allMissing.concat(result.missingCoefficients || []);
        }, []);
        return {
            term1: term1,
            term2: term2,
            general: general,
            incomplete: incompleteResults.length > 0,
            metadata: incompleteResults.length
                ? Object.assign({}, incompleteResults[0].metadata || {}, {
                      status: 'incomplete',
                      officialExportBlocked: true,
                      missingCoefficients: missingCoefficients
                  })
                : { status: 'complete', officialExportBlocked: false, missingCoefficients: [] }
        };
    }

    // -----------------------------------------------------------------------
    // formatAverage(value)
    // -----------------------------------------------------------------------

    /**
     * Map an average value to its display representation, centralizing the
     * null/range/placeholder/color rules (R4.4–4.7, 5.4–5.5, 5.7, 6.3).
     *
     * Because `gradeHex` has NO guard for null/undefined or out-of-range
     * values (it would resolve to the lowest-tier red), color application is
     * gated HERE so callers never apply a grade color to a placeholder.
     *
     *   - `value` is a finite number within `[0, 20]`:
     *       → `{ text: value.toFixed(2), color: gradeHex(value) }`
     *   - otherwise (null, undefined, non-finite, or out of range):
     *       → `{ text: AVG_PLACEHOLDER, color: null }`
     *
     * @param {number|null|undefined} value
     * @returns {{text: string, color: string|null}}
     */
    function formatAverage(value) {
        if (typeof value === 'number' && isFinite(value) && value >= 0 && value <= 20) {
            var gradeHexFn = getGradeHex();
            var color = (typeof gradeHexFn === 'function') ? gradeHexFn(value) : null;
            return { text: value.toFixed(2), color: color };
        }
        return { text: AVG_PLACEHOLDER, color: null };
    }

    // -----------------------------------------------------------------------
    // Public API (UMD-style export guard)
    // -----------------------------------------------------------------------

    var api = {
        AVG_PLACEHOLDER: AVG_PLACEHOLDER,
        round2: round2,
        isGradeEntered: isGradeEntered,
        computeTermAverage: computeTermAverage,
        computeTermAverageResult: computeTermAverageResult,
        computeStudentAverages: computeStudentAverages,
        formatAverage: formatAverage
    };

    // Bare global (browser window + Node/VM global scope) so the renderer,
    // `js/cc-rules.js` and the tests all share one `isGradeEntered` definition.
    _root.isGradeEntered = isGradeEntered;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.GS2 = window.GS2 || {};
        window.GS2.StudentAverages = api;
        // Convenience direct globals for the renderer (vanilla-script convention).
        window.AVG_PLACEHOLDER = AVG_PLACEHOLDER;
        window.isGradeEntered = isGradeEntered;
        window.computeTermAverage = computeTermAverage;
        window.computeStudentAverages = computeStudentAverages;
        window.formatAverage = formatAverage;
    }
})();
