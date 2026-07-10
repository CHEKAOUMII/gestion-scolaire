'use strict';

/**
 * BM Scoring — pure Tab_Score computation layer.
 *
 * Spec: .kiro/specs/student-profile-bm-scoring/
 * Task 1 (scaffold): scoring tables, shared helpers, four axis stubs,
 *                    computeBmScore dispatcher, UMD export.
 *
 * This module is a pure logic layer with NO DOM and NO IPC, so it can be
 * exercised by the Node test runner (`npm test`, fast-check) without booting
 * Electron, and attached to the renderer as a browser global.
 *
 * Loaded via `<script src="js/bm-scoring.js"></script>` in the renderer,
 * and `require`-able from Node tests.
 *
 * @see .kiro/specs/student-profile-bm-scoring/design.md
 */
(function () {

    // -----------------------------------------------------------------------
    // Scoring tables
    // -----------------------------------------------------------------------

    /** @type {{ eco_status: Object, income_source: Object }} */
    var ECO_TABLE = {
        eco_status:    { good: 0, avg: 15, poor: 30, vpoor: 40 },
        income_source: { stable: 0, unstable: 10, none: 20 }
    };

    /** @type {{ family_status, parents_edu, housing, study_place, teachers_rel, peers_rel }} */
    var SOC_TABLE = {
        family_status: { complete: 0, divorced: 15, widow: 10, absent: 15 },
        parents_edu:   { high: 0, mid: 5, low: 10, none: 15 },
        housing:       { good: 0, crowded: 10, bad: 20 },
        study_place:   { yes: 0, partial: 5, no: 10 },
        teachers_rel:  { good: 0, neutral: 5, bad: 10 },
        peers_rel:     { good: 0, neutral: 5, bad: 10 }
    };

    /** @type {{ health_gen, disability, sleep, nutrition, psych_referral }} */
    var HEALTH_TABLE = {
        health_gen:     { good: 0, avg: 10, bad: 20 },
        disability:     { none: 0, yes: 15 },
        sleep:          { good: 0, avg: 5, bad: 10 },
        nutrition:      { good: 0, avg: 5, bad: 10 },
        psych_referral: { no: 0, maybe: 5, yes: 10 }
    };

    /**
     * Red-flagged psych symptoms — each scores 12 pts instead of 5.
     * @type {string[]}
     */
    var HEALTH_REDFLAG_SYMPTOMS = [
        'self_harm',          // إيذاء النفس
        'suicidal_ideation',  // أفكار انتحارية
        'psychosis',          // أعراض ذهانية
        'dissociation'        // تفارق / انفصال
    ];

    // Scale tables (1-indexed; index 0 is a placeholder for "no selection").
    // Higher self-reported wellbeing → fewer risk points.
    /** mood scale: 1→15, 2→10, 3→5, 4→2, 5→0 */
    var MOOD_POINTS  = [0, 15, 10, 5, 2, 0];
    /** motivation scale: 1→10, 2→7, 3→4, 4→1, 5→0 */
    var MOTIV_POINTS = [0, 10, 7, 4, 1, 0];
    /** confidence scale: 1→10, 2→7, 3→4, 4→1, 5→0 (mirrors motivation) */
    var CONF_POINTS  = [0, 10, 7, 4, 1, 0];

    // -----------------------------------------------------------------------
    // Capped / fixed contributions (single source of truth for the divisors)
    // -----------------------------------------------------------------------

    /** Economic: distance > 10km adds this many points (its max contribution). */
    var ECO_DISTANCE_MAX     = 5;
    /** Economic: unmet_needs caps at this many points. */
    var ECO_UNMET_NEEDS_CAP  = 20;

    /** Social: social_risks caps at this many points. */
    var SOC_RISKS_CAP        = 25;

    /** Health: learning_disorders caps at this many points. */
    var HEALTH_DISORDERS_CAP  = 24;
    /** Health: substances caps at this many points. */
    var HEALTH_SUBSTANCES_CAP = 20;
    /** Health: psych_symptoms caps at this many points. */
    var HEALTH_PSYCH_CAP      = 30;

    /** Followup: max contact penalty (0 contacts → 25). */
    var FOLLOWUP_CONTACTS_MAX = 25;
    /** Followup: action-penalty base (0 actions → 50). */
    var FOLLOWUP_ACTIONS_BASE = 50;
    /** Followup: penalty when no next_date is set. */
    var FOLLOWUP_NEXT_DATE_PTS = 10;
    /** Followup: penalty when no guardian_phone is set. */
    var FOLLOWUP_PHONE_PTS     = 10;

    // -----------------------------------------------------------------------
    // Divisors — derived programmatically at module load from the points
    // tables plus the capped/fixed array contributions above. This keeps the
    // theoretical maximum in lock-step with the scoring rules (no magic numbers).
    // -----------------------------------------------------------------------

    /**
     * Largest point value contained in a {key: points} table.
     * @param {Object<string, number>} table
     * @returns {number}
     */
    function maxOf(table) {
        var m = 0;
        for (var k in table) {
            if (Object.prototype.hasOwnProperty.call(table, k) && table[k] > m) {
                m = table[k];
            }
        }
        return m;
    }

    /**
     * Sum of the per-field maxima across every radio table in a group.
     * @param {Object<string, Object>} group
     * @returns {number}
     */
    function sumOfMaxes(group) {
        var total = 0;
        for (var field in group) {
            if (Object.prototype.hasOwnProperty.call(group, field)) {
                total += maxOf(group[field]);
            }
        }
        return total;
    }

    /** Largest value in a numeric array (used for the 1–5 scale tables). */
    function maxOfArray(a) {
        return Math.max.apply(null, a);
    }

    /**
     * Economic max = eco_status max + income_source max + distance max + unmet_needs cap.
     * (support_programs only reduces, so it never raises the max.)
     */
    var ECO_DIVISOR = sumOfMaxes(ECO_TABLE) + ECO_DISTANCE_MAX + ECO_UNMET_NEEDS_CAP;

    /** Social max = sum of each radio field max + social_risks cap. */
    var SOC_DIVISOR = sumOfMaxes(SOC_TABLE) + SOC_RISKS_CAP;

    /**
     * Health max = sum of radio maxes + learning_disorders cap + substances cap
     * + psych_symptoms cap + mood max + motivation max + confidence max.
     */
    var HEALTH_DIVISOR = sumOfMaxes(HEALTH_TABLE)
        + HEALTH_DISORDERS_CAP
        + HEALTH_SUBSTANCES_CAP
        + HEALTH_PSYCH_CAP
        + maxOfArray(MOOD_POINTS)
        + maxOfArray(MOTIV_POINTS)
        + maxOfArray(CONF_POINTS);

    /** Followup max = contacts max + actions base + next_date + guardian_phone. */
    var FOLLOWUP_DIVISOR = FOLLOWUP_CONTACTS_MAX
        + FOLLOWUP_ACTIONS_BASE
        + FOLLOWUP_NEXT_DATE_PTS
        + FOLLOWUP_PHONE_PTS;

    // -----------------------------------------------------------------------
    // Shared helpers
    // -----------------------------------------------------------------------

    /**
     * Map a numeric score to its Arabic level label.
     * @param {number} score  0–100
     * @returns {'منخفض'|'متوسط'|'مرتفع'}
     */
    function levelLabel(score) {
        if (score < 40) return 'منخفض';
        if (score < 70) return 'متوسط';
        return 'مرتفع';
    }

    /**
     * Clamp a value to [0, 100].
     * @param {number} x
     * @returns {number}
     */
    function clamp100(x) {
        return Math.min(Math.max(x, 0), 100);
    }

    /**
     * Round a number to 2 decimal places.
     * @param {number} x
     * @returns {number}
     */
    function round2(x) {
        return Math.round(x * 100) / 100;
    }

    /**
     * Coerce a value to an array.
     * - Already an array → returned as-is.
     * - null / undefined → empty array.
     * - Any other value  → single-element array.
     * @param {*} v
     * @returns {Array}
     */
    function arr(v) {
        return Array.isArray(v) ? v : (v == null ? [] : [v]);
    }

    // -----------------------------------------------------------------------
    // Axis scorer functions (stubs — full implementations added by task 2)
    // -----------------------------------------------------------------------

    /**
     * Compute the economic tab score.
     *
     * @param {{ eco_status?: string, income_source?: string, distance_km?: number|string,
     *           support_programs?: string[], unmet_needs?: string[] }} data
     * @returns {{ score: number|null, level: string|null, subScores: object }}
     */
    function computeEconomicScore(data) {
        var hasAny = false;
        var raw = 0;
        var subs = {};

        // eco_status
        if (data.eco_status != null) {
            hasAny = true;
            var ecoStatusPts = ECO_TABLE.eco_status[data.eco_status] || 0;
            raw += ecoStatusPts;
            subs.eco_status = ecoStatusPts;
        }

        // income_source
        if (data.income_source != null) {
            hasAny = true;
            var incomePts = ECO_TABLE.income_source[data.income_source] || 0;
            raw += incomePts;
            subs.income_source = incomePts;
        }

        // distance_km — contributes only when finite and > 0
        var km = Number(data.distance_km);
        if (isFinite(km) && km > 0) {
            hasAny = true;
            var distPts = (km > 10) ? ECO_DISTANCE_MAX : 0;
            raw += distPts;
            subs.distance_km = distPts;
        }

        // support_programs — each active entry reduces score by 5 (floor 0)
        var programs = arr(data.support_programs).filter(Boolean);
        if (programs.length > 0) {
            hasAny = true;
            var reduction = programs.length * 5;
            raw = Math.max(0, raw - reduction);
            subs.support_programs = -reduction;
        }

        // unmet_needs — each +5, max 20
        var needs = arr(data.unmet_needs).filter(Boolean);
        if (needs.length > 0) {
            hasAny = true;
            var needsPts = Math.min(needs.length * 5, ECO_UNMET_NEEDS_CAP);
            raw += needsPts;
            subs.unmet_needs = needsPts;
        }

        if (!hasAny) {
            return { score: null, level: null, subScores: {} };
        }

        var score = clamp100(raw / ECO_DIVISOR * 100);
        return { score: round2(score), level: levelLabel(score), subScores: subs };
    }

    /**
     * Compute the social tab score.
     *
     * @param {{ family_status?: string, parents_edu?: string, housing?: string,
     *           study_place?: string, teachers_rel?: string, peers_rel?: string,
     *           social_risks?: string[] }} data
     * @returns {{ score: number|null, level: string|null, subScores: object }}
     */
    function computeSocialScore(data) {
        var hasAny = false;
        var raw = 0;
        var subs = {};

        var radioFields = ['family_status', 'parents_edu', 'housing', 'study_place', 'teachers_rel', 'peers_rel'];

        for (var i = 0; i < radioFields.length; i++) {
            var field = radioFields[i];
            var val = data[field];
            if (val != null && val !== '') {
                hasAny = true;
                var pts = (SOC_TABLE[field] && SOC_TABLE[field][val] != null)
                    ? SOC_TABLE[field][val]
                    : 0;
                raw += pts;
                subs[field] = pts;
            }
        }

        var risks = arr(data.social_risks).filter(Boolean);
        if (risks.length > 0) {
            hasAny = true;
            var riskPts = Math.min(risks.length * 5, SOC_RISKS_CAP);
            raw += riskPts;
            subs.social_risks = riskPts;
        }

        if (!hasAny) {
            return { score: null, level: null, subScores: {} };
        }

        var score = clamp100(raw / SOC_DIVISOR * 100);
        return { score: round2(score), level: levelLabel(score), subScores: subs };
    }

    /**
     * Compute the health/psych tab score.
     *
     * @param {{ health_gen?: string, disability?: string, learning_disorders?: string[],
     *           sleep?: string, nutrition?: string, substances?: string[],
     *           psych_symptoms?: string[], mood?: number, motivation?: number,
     *           confidence?: number, psych_referral?: string }} data
     * @returns {{ score: number|null, level: string|null, subScores: object }}
     */
    function computeHealthScore(data) {
        var hasAny = false;
        var raw = 0;
        var subs = {};

        // Five radio fields via HEALTH_TABLE
        var radioFields = ['health_gen', 'disability', 'sleep', 'nutrition', 'psych_referral'];
        for (var i = 0; i < radioFields.length; i++) {
            var field = radioFields[i];
            var val = data[field];
            if (val != null && val !== '') {
                hasAny = true;
                var pts = (HEALTH_TABLE[field] && HEALTH_TABLE[field][val] != null)
                    ? HEALTH_TABLE[field][val]
                    : 0;
                raw += pts;
                subs[field] = pts;
            }
        }

        // learning_disorders[]: each +8, capped
        var disorders = arr(data.learning_disorders).filter(Boolean);
        if (disorders.length > 0) {
            hasAny = true;
            var disorderPts = Math.min(disorders.length * 8, HEALTH_DISORDERS_CAP);
            raw += disorderPts;
            subs.learning_disorders = disorderPts;
        }

        // substances[]: each +10, capped
        var subsList = arr(data.substances).filter(Boolean);
        if (subsList.length > 0) {
            hasAny = true;
            var substancePts = Math.min(subsList.length * 10, HEALTH_SUBSTANCES_CAP);
            raw += substancePts;
            subs.substances = substancePts;
        }

        // psych_symptoms[]: red-flag 12, other 5, total capped
        var symptoms = arr(data.psych_symptoms).filter(Boolean);
        if (symptoms.length > 0) {
            hasAny = true;
            var psychPts = 0;
            for (var j = 0; j < symptoms.length; j++) {
                psychPts += (HEALTH_REDFLAG_SYMPTOMS.indexOf(symptoms[j]) !== -1) ? 12 : 5;
            }
            psychPts = Math.min(psychPts, HEALTH_PSYCH_CAP);
            raw += psychPts;
            subs.psych_symptoms = psychPts;
        }

        // mood scale: 1→15, 2→10, 3→5, 4→2, 5→0 (1-indexed)
        if (data.mood != null) {
            hasAny = true;
            var moodPts = MOOD_POINTS[data.mood] || 0;
            raw += moodPts;
            subs.mood = moodPts;
        }

        // motivation scale: 1→10, 2→7, 3→4, 4→1, 5→0 (1-indexed)
        if (data.motivation != null) {
            hasAny = true;
            var motivPts = MOTIV_POINTS[data.motivation] || 0;
            raw += motivPts;
            subs.motivation = motivPts;
        }

        // confidence scale: 1→10, 2→7, 3→4, 4→1, 5→0 (1-indexed; mirrors motivation)
        if (data.confidence != null) {
            hasAny = true;
            var confPts = CONF_POINTS[data.confidence] || 0;
            raw += confPts;
            subs.confidence = confPts;
        }

        if (!hasAny) {
            return { score: null, level: null, subScores: {} };
        }

        var score = clamp100(raw / HEALTH_DIVISOR * 100);
        return { score: round2(score), level: levelLabel(score), subScores: subs };
    }

    /**
     * Compute the followup/intervention tab score (inverse-scored: good followup → low score).
     *
     * @param {{ calls_count?: number|string, meetings_count?: number|string,
     *           actions_taken?: string[], next_date?: string,
     *           guardian_phone?: string }} data
     * @returns {{ score: number|null, level: string|null, subScores: object }}
     */
    function computeFollowupScore(data) {
        var calls    = Math.max(0, Number(data.calls_count) || 0);
        var meetings = Math.max(0, Number(data.meetings_count) || 0);
        var actions  = arr(data.actions_taken).filter(Boolean);

        // Null-detection: all scored fields must be truly absent
        var callsAbsent    = data.calls_count == null || data.calls_count === '';
        var meetingsAbsent = data.meetings_count == null || data.meetings_count === '';
        var noActions      = actions.length === 0;
        var noNextDate     = data.next_date == null || data.next_date === '';
        var noPhone        = data.guardian_phone == null || data.guardian_phone === '';

        if (callsAbsent && meetingsAbsent && noActions && noNextDate && noPhone) {
            return { score: null, level: null, subScores: {} };
        }

        var raw  = 0;
        var subs = {};

        // contacts combined: 0→25, 1-2→15, 3+→5
        var totalContacts = calls + meetings;
        var contactPts = totalContacts === 0 ? FOLLOWUP_CONTACTS_MAX : totalContacts <= 2 ? 15 : 5;
        raw += contactPts;
        subs.contacts = contactPts;

        // actions_taken: base 50 − 5×count (floor 0)
        var actionPts = Math.max(0, FOLLOWUP_ACTIONS_BASE - actions.length * 5);
        raw += actionPts;
        subs.actions_taken = actionPts;

        // next_date: empty/null → +10, set → 0
        var datePts = noNextDate ? FOLLOWUP_NEXT_DATE_PTS : 0;
        raw += datePts;
        subs.next_date = datePts;

        // guardian_phone: empty/null → +10, set → 0
        var phonePts = noPhone ? FOLLOWUP_PHONE_PTS : 0;
        raw += phonePts;
        subs.guardian_phone = phonePts;

        var score = clamp100(raw / FOLLOWUP_DIVISOR * 100);
        return { score: round2(score), level: levelLabel(score), subScores: subs };
    }

    // -----------------------------------------------------------------------
    // computeBmScore(axis, data) — convenience dispatcher
    // -----------------------------------------------------------------------

    /**
     * Dispatch to the appropriate axis scorer.
     *
     * @param {'economic'|'social'|'health'|'followup'} axis
     * @param {object} data  Raw field values for that axis.
     * @returns {{ score: number|null, level: string|null, subScores: object }}
     */
    function computeBmScore(axis, data) {
        switch (axis) {
            case 'economic': return computeEconomicScore(data);
            case 'social':   return computeSocialScore(data);
            case 'health':   return computeHealthScore(data);
            case 'followup': return computeFollowupScore(data);
            default:
                return { score: null, level: null, subScores: {} };
        }
    }

    // -----------------------------------------------------------------------
    // Public API (UMD-style export guard — mirrors js/student-averages.js)
    // -----------------------------------------------------------------------

    var api = {
        computeEconomicScore:    computeEconomicScore,
        computeSocialScore:      computeSocialScore,
        computeHealthScore:      computeHealthScore,
        computeFollowupScore:    computeFollowupScore,
        computeBmScore:          computeBmScore,
        // Expose constants for test inspection and renderer use
        ECO_DIVISOR:             ECO_DIVISOR,
        SOC_DIVISOR:             SOC_DIVISOR,
        HEALTH_DIVISOR:          HEALTH_DIVISOR,
        FOLLOWUP_DIVISOR:        FOLLOWUP_DIVISOR,
        HEALTH_REDFLAG_SYMPTOMS: HEALTH_REDFLAG_SYMPTOMS,
        CONF_POINTS:             CONF_POINTS,
        // Expose shared helpers so tests can call them directly if needed
        levelLabel:              levelLabel,
        clamp100:                clamp100,
        round2:                  round2,
        arr:                     arr
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.GS2 = window.GS2 || {};
        window.GS2.BmScoring = api;
        window.computeBmScore = computeBmScore;
    }
})();
