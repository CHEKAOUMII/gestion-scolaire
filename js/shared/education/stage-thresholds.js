(function (global) {
    'use strict';

    /**
     * Per-stage academic threshold tables (isolation plan Slice 2 remainder).
     *
     * Single source of truth for stage-official mention vocabulary:
     *  - MENTION bands: the 5-band التقدير scale used by dashboards and
     *    semester reports (extracted verbatim from analytics.js /
     *    reports-semester.html / results-hub.js, including the 'حسن جدا'
     *    spelling without hamza).
     *  - GRADE-COMMENT bands: the 6-band ملاحظات scale of the official class
     *    report (extracted verbatim from grades-results.html, including the
     *    'حسن جداً' spelling with hamza and the متوسط/دون المتوسط split).
     * The two contexts are intentionally NOT unified: the class report and
     * the dashboards use different official wordings today, and changing an
     * official document needs a product decision. Centralizing them here
     * makes that future unification a one-spot change.
     *
     * Fail-closed contract (mirrors the stage-rules error codes):
     *  - missing/empty cycle → { ok: false, code: 'RULES_UNAVAILABLE' }
     *  - stage without an official source (collegial: bulletin pending;
     *    primary: continuous assessment has no mention scale) →
     *    { ok: false, code: 'MISSING_RULE' } — never another stage's words.
     *  - non-finite or out-of-range average → INVALID_AVERAGE.
     * Pages must treat !ok as "render without mention labels" (averages and
     * counts stay; words go) plus one explicit notice — never silently fall
     * back to another stage's vocabulary.
     *
     * Deliberately OUT of scope (uniform ops policy, not stage data):
     *  - PASS_MARK (10/20): the 0-20 scale and pass mark are system-wide
     *    (grade validation already enforces 0-20 for every stage), so
     *    isPassingAverage takes no cycle.
     *  - absence-analytics WARNING/DANGER cutoffs, teacher-performance
     *    tiers, student-risk model weights: analytics alert policy shared
     *    by all stages.
     *
     * Cycle codes below mirror js/shared/education/cycles.js (kept as
     * literals: this module is dependency-free by design, like its
     * collegial-levels.js sibling).
     */
    var QUALIFIANT_CYCLE = 'secondary_qualifiant';
    var COLLEGIAL_CYCLE = 'secondary_collegial';
    var PRIMARY_CYCLE = 'primary';

    // 5-band mention scale (min inclusive, max exclusive, 20 inclusive).
    var MENTION_BANDS_QUALIFIANT = Object.freeze([
        Object.freeze({ key: 'excellent', label: 'ممتاز', min: 16, max: 20 }),
        Object.freeze({ key: 'veryGood', label: 'حسن جدا', min: 14, max: 16 }),
        Object.freeze({ key: 'good', label: 'حسن', min: 12, max: 14 }),
        Object.freeze({ key: 'acceptable', label: 'مقبول', min: 10, max: 12 }),
        Object.freeze({ key: 'weak', label: 'ضعيف', min: 0, max: 10 })
    ]);

    // 6-band class-report comment scale (first match wins, top-down).
    var GRADE_COMMENT_BANDS_QUALIFIANT = Object.freeze([
        Object.freeze({ key: 'excellent', label: 'ممتاز', min: 16, max: 20 }),
        Object.freeze({ key: 'veryGood', label: 'حسن جداً', min: 14, max: 16 }),
        Object.freeze({ key: 'good', label: 'حسن', min: 12, max: 14 }),
        Object.freeze({ key: 'average', label: 'متوسط', min: 10, max: 12 }),
        Object.freeze({ key: 'belowAverage', label: 'دون المتوسط', min: 8, max: 10 }),
        Object.freeze({ key: 'weak', label: 'ضعيف', min: 0, max: 8 })
    ]);

    // System-wide 0-20 pass mark (see header: not stage data).
    var PASS_MARK = 10;

    // Fail-closed display notice shared by every mention consumer.
    var MENTION_UNAVAILABLE_NOTICE = 'التقديرات غير متوفرة لهذا السلك بعد — تُعرض المعدلات بدون تقدير';

    // Per-stage threshold registry. `null` = no official source: resolvers
    // fail closed for that stage instead of borrowing another stage's words.
    var STAGE_THRESHOLDS = Object.freeze({
        secondary_qualifiant: Object.freeze({
            mentionBands: MENTION_BANDS_QUALIFIANT,
            gradeCommentBands: GRADE_COMMENT_BANDS_QUALIFIANT
        }),
        // Collegial bulletin vocabulary pending an official source.
        secondary_collegial: null,
        // Primary uses continuous assessment: no mention scale by design.
        primary: null
    });

    function normalizeCycle(cycleCode) {
        return cycleCode === null || cycleCode === undefined ? '' : String(cycleCode).trim();
    }

    function isValidAverage(value) {
        return typeof value === 'number' && isFinite(value) && value >= 0 && value <= 20;
    }

    function matchBand(bands, value) {
        for (var i = 0; i < bands.length; i += 1) {
            var band = bands[i];
            if (value >= band.min && (value < band.max || (band.max === 20 && value <= 20))) return band;
        }
        return null;
    }

    function resolveStageSet(cycleCode) {
        var cycle = normalizeCycle(cycleCode);
        if (!cycle) return { ok: false, code: 'RULES_UNAVAILABLE', stage: cycleCode };
        var set = Object.prototype.hasOwnProperty.call(STAGE_THRESHOLDS, cycle)
            ? STAGE_THRESHOLDS[cycle]
            : undefined;
        if (!set) return { ok: false, code: 'MISSING_RULE', stage: cycle };
        return { ok: true, set: set, stage: cycle };
    }

    function resolveMentionBands(cycleCode) {
        var resolved = resolveStageSet(cycleCode);
        if (!resolved.ok) return resolved;
        return { ok: true, stage: resolved.stage, bands: resolved.set.mentionBands };
    }

    function resolveMentionBand(average, cycleCode) {
        var resolved = resolveStageSet(cycleCode);
        if (!resolved.ok) return resolved;
        if (!isValidAverage(average)) return { ok: false, code: 'INVALID_AVERAGE', stage: resolved.stage };
        var band = matchBand(resolved.set.mentionBands, average);
        if (!band) return { ok: false, code: 'INVALID_AVERAGE', stage: resolved.stage };
        return { ok: true, stage: resolved.stage, key: band.key, label: band.label, min: band.min, max: band.max };
    }

    function resolveGradeCommentBands(cycleCode) {
        var resolved = resolveStageSet(cycleCode);
        if (!resolved.ok) return resolved;
        return { ok: true, stage: resolved.stage, bands: resolved.set.gradeCommentBands };
    }

    function resolveGradeComment(average, cycleCode) {
        var resolved = resolveStageSet(cycleCode);
        if (!resolved.ok) return resolved;
        if (!isValidAverage(average)) return { ok: false, code: 'INVALID_AVERAGE', stage: resolved.stage };
        var band = matchBand(resolved.set.gradeCommentBands, average);
        if (!band) return { ok: false, code: 'INVALID_AVERAGE', stage: resolved.stage };
        return { ok: true, stage: resolved.stage, key: band.key, label: band.label, min: band.min, max: band.max };
    }

    function isPassingAverage(average) {
        return typeof average === 'number' && isFinite(average) && average >= PASS_MARK;
    }

    var api = Object.freeze({
        QUALIFIANT_CYCLE: QUALIFIANT_CYCLE,
        COLLEGIAL_CYCLE: COLLEGIAL_CYCLE,
        PRIMARY_CYCLE: PRIMARY_CYCLE,
        MENTION_BANDS_QUALIFIANT: MENTION_BANDS_QUALIFIANT,
        GRADE_COMMENT_BANDS_QUALIFIANT: GRADE_COMMENT_BANDS_QUALIFIANT,
        PASS_MARK: PASS_MARK,
        MENTION_UNAVAILABLE_NOTICE: MENTION_UNAVAILABLE_NOTICE,
        resolveMentionBands: resolveMentionBands,
        resolveMentionBand: resolveMentionBand,
        resolveGradeCommentBands: resolveGradeCommentBands,
        resolveGradeComment: resolveGradeComment,
        isPassingAverage: isPassingAverage
    });
    global.EducationStageThresholds = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
