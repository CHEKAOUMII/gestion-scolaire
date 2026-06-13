'use strict';

/**
 * Student Dropout-Risk Index — pure computation layer.
 * مؤشر خطر الانقطاع — طبقة الحساب النقية.
 *
 * Single source of truth for the "مؤشر الخطر" tab on the student profile page.
 * Implements the official methodology documented in
 *   .kiro/مؤشر_الخطر_دليل_الحساب.md
 *
 * The methodology has TWO layers and the final classification is the WORST of
 * the two (القاعدة: "الأسوأ يفوز"):
 *
 *   • Layer 1 — individual alert criteria. Each axis is classified into one of
 *     three levels (0 = عادي, 1 = خطر, 2 = حرج). The layer-1 level is the MAX
 *     across every criterion that has data. A single "حرج" criterion is enough
 *     to make the whole file "حرج".
 *
 *   • Layer 2 — a weighted composite index in [0, 100] used for the gauge and
 *     for ranking flagged students by priority:
 *         index = 0.30·A + 0.30·B + 0.15·C + 0.15·D + 0.10·E
 *     classified as: 0–30 عادي, 31–60 خطر, 61–100 حرج.
 *
 *   • Final level = max(layer1.level, layer2.level).
 *
 * Like js/student-averages.js this module is PURE: no DOM, no IPC. It can be
 * exercised by the Node test runner and is attached to the renderer as a
 * browser global (`window.GS2.StudentRisk` + a `computeStudentRisk` shortcut).
 *
 * ── Data-availability notes (read before tuning) ────────────────────────────
 *  - The guide's absence criterion is the *unjustified absence RATE* (% of
 *    scheduled hours). The app currently records absence HOURS only, with no
 *    scheduled-hours denominator. So:
 *       · if `inputs.scheduledHours` is provided we compute a true rate;
 *       · otherwise we approximate from accumulated unjustified hours using a
 *         saturating curve (CONFIG.absence.saturationHours). This is flagged in
 *         the returned `axes.B.detail` so the UI can show it is an estimate.
 *  - The guide's "عدد العقوبات التأديبية" (disciplinary penalties) is not yet
 *    tracked as a structured count, so it defaults to 0 unless the caller
 *    passes `inputs.disciplinePenalties`.
 * All thresholds / weights / catalog sizes live in CONFIG and are overridable.
 */
(function () {
    // -----------------------------------------------------------------------
    // Levels & labels
    // -----------------------------------------------------------------------

    var LEVEL = { NORMAL: 0, RISK: 1, CRITICAL: 2 };
    var LEVEL_LABEL = ['عادي', 'خطر', 'حرج'];

    // -----------------------------------------------------------------------
    // Default configuration (every value is overridable per call)
    // -----------------------------------------------------------------------

    var DEFAULT_CONFIG = {
        // Layer-2 axis weights. Must sum to 1.
        weights: { A: 0.30, B: 0.30, C: 0.15, D: 0.15, E: 0.10 },

        // Composite-index classification cut-offs (Layer 2).
        composite: { riskFrom: 31, criticalFrom: 61 },

        academic: {
            // General-average thresholds /20.
            avgRisk: 10, // avg < 10  → at least خطر
            avgCritical: 5, // avg < 5   → حرج
            // Share of subjects below 10/20 (Layer-1 percentages).
            subjPassMark: 10,
            subjPctRisk: 30, // [30, 70]  → خطر
            subjPctCritical: 70 // > 70      → حرج
        },

        absence: {
            // Layer-1 thresholds on cumulative UNJUSTIFIED hours.
            riskHours: 8, // >= 8h  → خطر
            criticalHours: 24, // >= 24h → حرج
            // Layer-2: unjustified hours that map to a 100/100 sub-score when
            // no scheduled-hours denominator is available.
            saturationHours: 24,
            // Layer-2 (when scheduledHours is provided): rate(%) × rateGain,
            // capped at 100. rate of 20% → 100 with the default gain of 5.
            rateGain: 5,
            // Split inside axis B between absence and discipline.
            absenceWeight: 0.6,
            disciplineWeight: 0.4,
            // Discipline-penalty count → 100 saturation (penalties × gain).
            disciplineGain: 20
        },

        social: {
            // Number of catalogued social risk factors (Layer-2 denominator).
            catalogSize: 10,
            // Family statuses considered a risk factor.
            riskFamilyStatuses: ['divorced', 'widow', 'absent'],
            // Distance (km) beyond which remoteness counts as a factor.
            farDistanceKm: 10,
            riskFrom: 1, // 1–2 factors → خطر
            criticalFrom: 3 // >= 3 factors → حرج
        },

        economic: {
            catalogSize: 6,
            fragileStatuses: ['poor', 'vpoor'],
            // Programs that count as "social support" per the guide (تيسير/منحة…).
            supportPrograms: ['tayssir', 'scholarship', 'boarding', 'meal', 'transport']
        },

        health: {
            catalogSize: 8,
            // How many psych symptoms / learning disorders count as "a problem".
            psychSymptomsForProblem: 2,
            learningDisordersForProblem: 1
        }
    };

    // -----------------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------------

    function round2(x) { return Math.round(x * 100) / 100; }
    function clamp100(x) { return Math.max(0, Math.min(100, x)); }
    function isNum(x) { return typeof x === 'number' && isFinite(x); }
    function arr(x) { return Array.isArray(x) ? x : []; }

    // Deep-ish merge of a caller config over the defaults (one level of nesting).
    function mergeConfig(override) {
        if (!override) return DEFAULT_CONFIG;
        var out = {};
        Object.keys(DEFAULT_CONFIG).forEach(function (k) {
            var base = DEFAULT_CONFIG[k];
            var ov = override[k];
            if (base && typeof base === 'object' && !Array.isArray(base) && ov && typeof ov === 'object') {
                out[k] = Object.assign({}, base, ov);
            } else {
                out[k] = (ov !== undefined) ? ov : base;
            }
        });
        return out;
    }

    function levelFromComposite(score, cfg) {
        if (score >= cfg.composite.criticalFrom) return LEVEL.CRITICAL;
        if (score >= cfg.composite.riskFrom) return LEVEL.RISK;
        return LEVEL.NORMAL;
    }

    // =======================================================================
    // Axis computations — each returns { level, score, detail } where:
    //   level : 0/1/2 or null when there is no data to judge the axis
    //   score : 0–100 contribution for the Layer-2 composite (0 when no data)
    //   detail: human-readable Arabic note for the UI breakdown
    // =======================================================================

    // ── Axis A: academic (general average + share of subjects below pass mark)
    function computeAcademic(inputs, cfg) {
        var avg = isNum(inputs.generalAverage) ? inputs.generalAverage : null;
        var subjects = arr(inputs.subjectAverages).filter(isNum);

        // Layer-1 sub-levels.
        var avgLevel = null;
        var avgScore = null; // 0–100
        if (avg != null) {
            if (avg < cfg.academic.avgCritical) avgLevel = LEVEL.CRITICAL;
            else if (avg < cfg.academic.avgRisk) avgLevel = LEVEL.RISK;
            else avgLevel = LEVEL.NORMAL;
            avgScore = avg >= cfg.academic.avgRisk ? 0 : clamp100((cfg.academic.avgRisk - avg) / cfg.academic.avgRisk * 100);
        }

        var pct = null;
        var pctLevel = null;
        if (subjects.length) {
            var below = subjects.filter(function (a) { return a < cfg.academic.subjPassMark; }).length;
            pct = below / subjects.length * 100;
            if (pct > cfg.academic.subjPctCritical) pctLevel = LEVEL.CRITICAL;
            else if (pct >= cfg.academic.subjPctRisk) pctLevel = LEVEL.RISK;
            else pctLevel = LEVEL.NORMAL;
        }

        // Layer-1 academic level = worst of the two sub-criteria.
        var levels = [avgLevel, pctLevel].filter(function (l) { return l != null; });
        var level = levels.length ? Math.max.apply(null, levels) : null;

        // Layer-2 A score = mean of the available sub-scores.
        var parts = [];
        if (avgScore != null) parts.push(avgScore);
        if (pct != null) parts.push(pct); // pct already 0–100
        var score = parts.length ? parts.reduce(function (a, b) { return a + b; }, 0) / parts.length : 0;

        var detail = avg != null ? ('المعدل ' + round2(avg)) : 'لا معدل';
        if (pct != null) detail += ' · مواد دون ' + cfg.academic.subjPassMark + ': ' + Math.round(pct) + '%';

        return { level: level, score: clamp100(score), detail: detail };
    }

    // ── Axis B: absence + citizenship (discipline)
    function computeAbsence(inputs, cfg) {
        var unjustified = isNum(inputs.unjustifiedHours) ? Math.max(0, inputs.unjustifiedHours) : 0;
        var penalties = isNum(inputs.disciplinePenalties) ? Math.max(0, inputs.disciplinePenalties) : 0;
        var scheduled = isNum(inputs.scheduledHours) && inputs.scheduledHours > 0 ? inputs.scheduledHours : null;

        // Absence sub-score (0–100).
        var absScore;
        var rateNote;
        if (scheduled != null) {
            var rate = unjustified / scheduled * 100;
            absScore = clamp100(rate * cfg.absence.rateGain);
            rateNote = 'نسبة غياب غير مبرر ' + round2(rate) + '%';
        } else {
            absScore = clamp100(unjustified / cfg.absence.saturationHours * 100);
            rateNote = unjustified + ' ساعة غير مبررة (تقدير)';
        }

        var discScore = clamp100(penalties * cfg.absence.disciplineGain);

        var score = cfg.absence.absenceWeight * absScore + cfg.absence.disciplineWeight * discScore;

        // Layer-1 levels.
        var absLevel;
        if (unjustified >= cfg.absence.criticalHours) absLevel = LEVEL.CRITICAL;
        else if (unjustified >= cfg.absence.riskHours) absLevel = LEVEL.RISK;
        else absLevel = LEVEL.NORMAL;

        var discLevel;
        if (penalties >= 3) discLevel = LEVEL.CRITICAL;
        else if (penalties >= 1) discLevel = LEVEL.RISK;
        else discLevel = LEVEL.NORMAL;

        var level = Math.max(absLevel, discLevel);
        var detail = rateNote + (penalties ? (' · ' + penalties + ' عقوبات') : '');

        return { level: level, score: clamp100(score), detail: detail };
    }

    // ── Generic ratio axis: present factors / catalog size → 0–100, with the
    //    guide's individual thresholds (1–2 → خطر, ≥3 → حرج) applied on count.
    function ratioAxis(presentCount, catalogSize, cfg) {
        var count = Math.max(0, presentCount | 0);
        var size = Math.max(1, catalogSize | 0);
        var score = clamp100(count / size * 100);
        var level;
        if (count >= (cfg.social.criticalFrom)) level = LEVEL.CRITICAL;
        else if (count >= (cfg.social.riskFrom)) level = LEVEL.RISK;
        else level = LEVEL.NORMAL;
        return { count: count, score: score, level: level };
    }

    // ── Axis C: social
    function computeSocial(inputs, cfg) {
        var s = inputs.social || {};
        var factors = [];
        arr(s.risks).forEach(function (r) { factors.push(r); });
        if (cfg.social.riskFamilyStatuses.indexOf(s.familyStatus) !== -1) factors.push('family_status');
        if (isNum(s.distanceKm) && s.distanceKm > cfg.social.farDistanceKm) factors.push('far_distance');

        var r = ratioAxis(factors.length, cfg.social.catalogSize, cfg);
        return {
            level: r.level,
            score: r.score,
            detail: factors.length ? (factors.length + ' عوامل اجتماعية') : 'لا عوامل مسجلة'
        };
    }

    // ── Axis D: economic
    function computeEconomic(inputs, cfg) {
        var e = inputs.economic || {};
        var fragile = cfg.economic.fragileStatuses.indexOf(e.status) !== -1;
        var support = arr(e.supportPrograms).some(function (p) {
            return cfg.economic.supportPrograms.indexOf(p) !== -1;
        });
        var unmet = arr(e.unmetNeeds).length;

        // Layer-1: fragile without any support → حرج (per guide); fragile but
        // supported → خطر; otherwise → عادي.
        var level;
        if (fragile && !support) level = LEVEL.CRITICAL;
        else if (fragile && support) level = LEVEL.RISK;
        else level = LEVEL.NORMAL;

        // Layer-2 factor count: fragile, no-support-while-fragile, unmet needs,
        // income 'none'.
        var factors = 0;
        if (fragile) factors++;
        if (fragile && !support) factors++;
        if (e.incomeSource === 'none') factors++;
        factors += Math.min(unmet, 3);

        var score = clamp100(factors / cfg.economic.catalogSize * 100);
        var detail = fragile
            ? ('وضع هش' + (support ? ' مع دعم' : ' بدون دعم'))
            : 'وضع اقتصادي عادي';
        if (unmet) detail += ' · ' + unmet + ' احتياجات غير مغطاة';

        return { level: level, score: score, detail: detail };
    }

    // ── Axis E: health / psychological
    function computeHealth(inputs, cfg) {
        var h = inputs.health || {};
        var psych = arr(h.psychSymptoms).length;
        var disorders = arr(h.learningDisorders).length;
        var substances = arr(h.substances).length;
        var badHealth = h.healthGen === 'bad';
        var disabled = h.disability === 'yes';

        var hasProblem =
            badHealth ||
            disabled ||
            substances > 0 ||
            psych >= cfg.health.psychSymptomsForProblem ||
            disorders >= cfg.health.learningDisordersForProblem;

        var monitored = h.treatment === 'yes' || h.psychSupport === 'yes';

        var level;
        if (hasProblem && !monitored) level = LEVEL.CRITICAL;
        else if (hasProblem && monitored) level = LEVEL.RISK;
        else level = LEVEL.NORMAL;

        // Layer-2 factor count.
        var factors = 0;
        if (badHealth) factors++;
        if (disabled) factors++;
        if (substances > 0) factors++;
        factors += Math.min(psych, 3);
        if (disorders > 0) factors++;
        if (h.psychReferral === 'yes') factors++;

        var score = clamp100(factors / cfg.health.catalogSize * 100);
        var detail = hasProblem
            ? ('مشكل صحي/نفسي' + (monitored ? ' متابَع' : ' بدون متابعة'))
            : 'لا مشاكل صحية مؤثرة';

        return { level: level, score: score, detail: detail };
    }

    // -----------------------------------------------------------------------
    // Recommendation text per final level (reuses the prototype wording).
    // -----------------------------------------------------------------------

    function recommendationFor(level) {
        if (level === LEVEL.CRITICAL) {
            return 'تدخل فوري مطلوب: اجتماع عاجل مع الأسرة، إحالة للمرشد التربوي والأخصائي النفسي، ووضع خطة فردية للدعم.';
        }
        if (level === LEVEL.RISK) {
            return 'متابعة أسبوعية، التواصل مع الأسرة، تفعيل دعم تربوي داخل المؤسسة، ورصد التطورات.';
        }
        return 'الوضع تحت السيطرة. متابعة دورية شهرية مع تعزيز الإيجابيات.';
    }

    // =======================================================================
    // Public entry point
    // =======================================================================

    /**
     * Compute the full two-layer dropout-risk assessment for one student.
     *
     * @param {object} inputs
     *   @param {number|null} inputs.generalAverage   General average /20.
     *   @param {number[]}    inputs.subjectAverages  Per-subject averages /20.
     *   @param {number}      inputs.unjustifiedHours Cumulative unjustified hours.
     *   @param {number}     [inputs.justifiedHours]  Cumulative justified hours.
     *   @param {number}     [inputs.scheduledHours]  Scheduled hours (enables a
     *                                                 true unjustified-rate calc).
     *   @param {number}     [inputs.disciplinePenalties] Disciplinary count.
     *   @param {object}     [inputs.social]    { risks[], familyStatus, distanceKm }
     *   @param {object}     [inputs.economic]  { status, supportPrograms[], unmetNeeds[], incomeSource }
     *   @param {object}     [inputs.health]    { healthGen, disability, learningDisorders[],
     *                                            psychSymptoms[], substances[], treatment,
     *                                            psychSupport, psychReferral }
     * @param {object} [configOverride] Partial CONFIG override.
     * @returns {{
     *   layer1: { level:number, label:string, criteria: Array<{key,label,level,detail}> },
     *   layer2: { composite:number, level:number, label:string,
     *             axes: { A:object, B:object, C:object, D:object, E:object } },
     *   final:  { level:number, label:string, score:number },
     *   recommendation: string
     * }}
     */
    function computeStudentRisk(inputs, configOverride) {
        inputs = inputs || {};
        var cfg = mergeConfig(configOverride);

        var A = computeAcademic(inputs, cfg);
        var B = computeAbsence(inputs, cfg);
        var C = computeSocial(inputs, cfg);
        var D = computeEconomic(inputs, cfg);
        var E = computeHealth(inputs, cfg);

        // ── Layer 1: worst-wins across criteria that have data ──
        var criteria = [
            { key: 'A', label: 'النتائج الدراسية', level: A.level, detail: A.detail },
            { key: 'B', label: 'الغياب والمواظبة', level: B.level, detail: B.detail },
            { key: 'C', label: 'الجانب الاجتماعي', level: C.level, detail: C.detail },
            { key: 'D', label: 'الجانب الاقتصادي', level: D.level, detail: D.detail },
            { key: 'E', label: 'الصحي والنفسي', level: E.level, detail: E.detail }
        ];
        var presentLevels = criteria
            .map(function (c) { return c.level; })
            .filter(function (l) { return l != null; });
        var layer1Level = presentLevels.length ? Math.max.apply(null, presentLevels) : LEVEL.NORMAL;

        // ── Layer 2: weighted composite ──
        var w = cfg.weights;
        var composite = round2(
            w.A * A.score + w.B * B.score + w.C * C.score + w.D * D.score + w.E * E.score
        );
        var layer2Level = levelFromComposite(composite, cfg);

        // ── Final = worst of the two layers ──
        var finalLevel = Math.max(layer1Level, layer2Level);

        var withWeight = function (axis, key) {
            return {
                score: round2(axis.score),
                weight: w[key],
                level: axis.level,
                detail: axis.detail
            };
        };

        return {
            layer1: { level: layer1Level, label: LEVEL_LABEL[layer1Level], criteria: criteria },
            layer2: {
                composite: composite,
                level: layer2Level,
                label: LEVEL_LABEL[layer2Level],
                axes: {
                    A: withWeight(A, 'A'),
                    B: withWeight(B, 'B'),
                    C: withWeight(C, 'C'),
                    D: withWeight(D, 'D'),
                    E: withWeight(E, 'E')
                }
            },
            final: { level: finalLevel, label: LEVEL_LABEL[finalLevel], score: composite },
            recommendation: recommendationFor(finalLevel)
        };
    }

    // -----------------------------------------------------------------------
    // Public API (UMD-style export guard, mirrors js/student-averages.js)
    // -----------------------------------------------------------------------

    var api = {
        LEVEL: LEVEL,
        LEVEL_LABEL: LEVEL_LABEL,
        DEFAULT_CONFIG: DEFAULT_CONFIG,
        computeStudentRisk: computeStudentRisk
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.GS2 = window.GS2 || {};
        window.GS2.StudentRisk = api;
        window.computeStudentRisk = computeStudentRisk;
    }
})();
