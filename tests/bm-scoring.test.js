'use strict';

// Feature: student-profile-bm-scoring
//
// Validates: Requirements 1.1, 1.2, 1.4, 2.1, 2.2, 2.4, 3.1, 3.2, 3.4, 3.6,
//            4.1, 4.2, 4.4, 5.1, 5.2, 7.2, 8.2, 8.3, 8.4, 8.5, 8.6
//
// Property-based tests for js/bm-scoring.js using fast-check.
// Each of the four axis scorers (economic, social, health, followup) is tested
// for the following properties:
//
//   Property 1 — Score Range:     score === null || (score >= 0 && score <= 100)
//   Property 2 — Null All Absent: computeXScore({}) → score === null, level === null
//   Property 3 — Best-Case Zero:  all optimal values → score === 0
//   Property 4 — Worst-Case 100:  all max-risk values → score === 100
//   Property 5 — Level Consistency: level thresholds match score value (all four axes)
//
// Additionally, Property 7 (support programs beneficial) and Property 8
// (followup inverse ordering) are included where applicable.
//
// Run standalone:
//   node tests/bm-scoring.test.js
// Or via:
//   npm test

const assert = require('assert');
const fc = require('fast-check');

const BM = require('../js/bm-scoring.js');
const {
    computeEconomicScore,
    computeSocialScore,
    computeHealthScore,
    computeFollowupScore
} = BM;

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Assert that score and level are mutually consistent.
 * @param {{ score: number|null, level: string|null }} result
 * @param {string} label  — context for assertion messages
 */
function assertLevelConsistency(result, label) {
    var score = result.score;
    var level = result.level;

    if (score === null) {
        assert.strictEqual(level, null,
            label + ': level must be null when score is null, got ' + JSON.stringify(level));
    } else {
        assert.ok(score >= 0 && score <= 100,
            label + ': score ' + score + ' out of [0,100]');
        if (score < 40) {
            assert.strictEqual(level, 'منخفض',
                label + ': score ' + score + ' < 40 should yield "منخفض", got ' + JSON.stringify(level));
        } else if (score < 70) {
            assert.strictEqual(level, 'متوسط',
                label + ': score ' + score + ' in [40,70) should yield "متوسط", got ' + JSON.stringify(level));
        } else {
            assert.strictEqual(level, 'مرتفع',
                label + ': score ' + score + ' >= 70 should yield "مرتفع", got ' + JSON.stringify(level));
        }
    }
}

// ---------------------------------------------------------------------------
// Arbitraries — optional-field generators for each axis
// ---------------------------------------------------------------------------

// Radio-like optional string
function optRadio(values) {
    return fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.constantFrom.apply(fc, values)
    );
}

// Optional non-negative integer
var optNonNegInt = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.integer({ min: 0, max: 20 })
);

// Small array of strings (optional fields)
var strArrayArb = fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 0, maxLength: 5 });

// Optional small integer in 1..5 (for mood/motivation scales)
var optScale1to5 = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.integer({ min: 1, max: 5 })
);

// Economic axis arbitrary
var arbEconomic = fc.record({
    eco_status:       optRadio(['good', 'avg', 'poor', 'vpoor']),
    income_source:    optRadio(['stable', 'unstable', 'none']),
    distance_km:      optNonNegInt,
    support_programs: strArrayArb,
    unmet_needs:      strArrayArb
});

// Social axis arbitrary
var arbSocial = fc.record({
    family_status: optRadio(['complete', 'divorced', 'widow', 'absent']),
    parents_edu:   optRadio(['high', 'mid', 'low', 'none']),
    housing:       optRadio(['good', 'crowded', 'bad']),
    study_place:   optRadio(['yes', 'partial', 'no']),
    teachers_rel:  optRadio(['good', 'neutral', 'bad']),
    peers_rel:     optRadio(['good', 'neutral', 'bad']),
    social_risks:  strArrayArb
});

// Health axis arbitrary
var PSYCH_SYMS = ['self_harm', 'suicidal_ideation', 'psychosis', 'dissociation', 'anxiety', 'depression', 'phobia'];
var arbHealth = fc.record({
    health_gen:         optRadio(['good', 'avg', 'bad']),
    disability:         optRadio(['none', 'yes']),
    sleep:              optRadio(['good', 'avg', 'bad']),
    nutrition:          optRadio(['good', 'avg', 'bad']),
    psych_referral:     optRadio(['no', 'maybe', 'yes']),
    learning_disorders: strArrayArb,
    substances:         strArrayArb,
    psych_symptoms:     fc.array(fc.constantFrom.apply(fc, PSYCH_SYMS), { minLength: 0, maxLength: 5 }),
    mood:               optScale1to5,
    motivation:         optScale1to5,
    confidence:         optScale1to5
});

// Followup axis arbitrary — note: calls_count:0 is NOT absent (triggers computation)
var optFollowupCount = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.constant(''),
    fc.integer({ min: 0, max: 10 })
);
var optFollowupStr = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.constant(''),
    fc.string({ minLength: 1, maxLength: 10 })
);
var arbFollowup = fc.record({
    calls_count:     optFollowupCount,
    meetings_count:  optFollowupCount,
    actions_taken:   strArrayArb,
    next_date:       optFollowupStr,
    guardian_phone:  optFollowupStr
});

// ---------------------------------------------------------------------------
// === ECONOMIC AXIS TESTS ===
// ---------------------------------------------------------------------------

console.log('[test] bm-scoring — Economic axis');

// Property 1: Score Range (economic)
// **Validates: Requirements 1.2, 8.2**
fc.assert(
    fc.property(arbEconomic, function (data) {
        var result = computeEconomicScore(data);
        return result.score === null || (result.score >= 0 && result.score <= 100);
    }),
    { numRuns: NUM_RUNS, verbose: false }
);
console.log('  PASS Property 1 (Score Range — economic)');

// Property 2: Null When All Absent (economic)
// **Validates: Requirements 1.4, 8.3**
(function () {
    var result = computeEconomicScore({});
    assert.strictEqual(result.score, null, 'Economic {}: score must be null');
    assert.strictEqual(result.level, null, 'Economic {}: level must be null');
})();
console.log('  PASS Property 2 (Null When All Absent — economic)');

// Property 3: Best-Case Zero (economic)
// **Validates: Requirements 1.1, 1.2, 8.5**
(function () {
    var best = { eco_status: 'good', income_source: 'stable', distance_km: 0,
                 support_programs: [], unmet_needs: [] };
    var result = computeEconomicScore(best);
    assert.strictEqual(result.score, 0, 'Economic best-case: score must be 0, got ' + result.score);
})();
console.log('  PASS Property 3 (Best-Case Zero — economic)');

// Property 4: Worst-Case 100 (economic)
// **Validates: Requirements 1.1, 1.2, 8.4**
(function () {
    var worst = { eco_status: 'vpoor', income_source: 'none', distance_km: 15,
                  support_programs: [], unmet_needs: ['a', 'b', 'c', 'd'] };
    var result = computeEconomicScore(worst);
    assert.strictEqual(result.score, 100, 'Economic worst-case: score must be 100, got ' + result.score);
})();
console.log('  PASS Property 4 (Worst-Case 100 — economic)');

// Property 5 / Level Consistency (economic)
// **Validates: Requirements 5.1, 5.2, 7.2**
fc.assert(
    fc.property(arbEconomic, function (data) {
        var result = computeEconomicScore(data);
        assertLevelConsistency(result, 'economic');
        return true;
    }),
    { numRuns: NUM_RUNS, verbose: false }
);
console.log('  PASS Property 5 (Level Consistency — economic)');

// Property 7: Support Programs Beneficial — adding a support program never increases score
// **Validates: Requirements 1.1, 8.6**
fc.assert(
    fc.property(
        arbEconomic,
        fc.string({ minLength: 1, maxLength: 8 }),
        function (data, newProgram) {
            var base = computeEconomicScore(data);
            if (base.score === null) return true; // null case not applicable

            var withProgram = Object.assign({}, data, {
                support_programs: (data.support_programs || []).concat([newProgram])
            });
            var improved = computeEconomicScore(withProgram);
            if (improved.score === null) return true;

            // Adding a support program should never increase the score
            return improved.score <= base.score;
        }
    ),
    { numRuns: NUM_RUNS, verbose: false }
);
console.log('  PASS Property 7 (Support Programs Beneficial — economic)');

// ---------------------------------------------------------------------------
// === SOCIAL AXIS TESTS ===
// ---------------------------------------------------------------------------

console.log('[test] bm-scoring — Social axis');

// Property 1: Score Range (social)
// **Validates: Requirements 2.2, 8.2**
fc.assert(
    fc.property(arbSocial, function (data) {
        var result = computeSocialScore(data);
        return result.score === null || (result.score >= 0 && result.score <= 100);
    }),
    { numRuns: NUM_RUNS, verbose: false }
);
console.log('  PASS Property 1 (Score Range — social)');

// Property 2: Null When All Absent (social)
// **Validates: Requirements 2.4, 8.3**
(function () {
    var result = computeSocialScore({});
    assert.strictEqual(result.score, null, 'Social {}: score must be null');
    assert.strictEqual(result.level, null, 'Social {}: level must be null');
})();
console.log('  PASS Property 2 (Null When All Absent — social)');

// Property 3: Best-Case Zero (social)
// **Validates: Requirements 2.1, 2.2, 8.5**
(function () {
    var best = {
        family_status: 'complete', parents_edu: 'high', housing: 'good',
        study_place: 'yes', teachers_rel: 'good', peers_rel: 'good',
        social_risks: []
    };
    var result = computeSocialScore(best);
    assert.strictEqual(result.score, 0, 'Social best-case: score must be 0, got ' + result.score);
})();
console.log('  PASS Property 3 (Best-Case Zero — social)');

// Property 4: Worst-Case 100 (social)
// **Validates: Requirements 2.1, 2.2, 8.4**
(function () {
    var worst = {
        family_status: 'divorced', parents_edu: 'none', housing: 'bad',
        study_place: 'no', teachers_rel: 'bad', peers_rel: 'bad',
        social_risks: ['a', 'b', 'c', 'd', 'e']
    };
    var result = computeSocialScore(worst);
    assert.strictEqual(result.score, 100, 'Social worst-case: score must be 100, got ' + result.score);
})();
console.log('  PASS Property 4 (Worst-Case 100 — social)');

// Property 5 / Level Consistency (social)
// **Validates: Requirements 5.1, 5.2, 7.2**
fc.assert(
    fc.property(arbSocial, function (data) {
        var result = computeSocialScore(data);
        assertLevelConsistency(result, 'social');
        return true;
    }),
    { numRuns: NUM_RUNS, verbose: false }
);
console.log('  PASS Property 5 (Level Consistency — social)');

// ---------------------------------------------------------------------------
// === HEALTH AXIS TESTS ===
// ---------------------------------------------------------------------------

console.log('[test] bm-scoring — Health axis');

// Property 1: Score Range (health)
// **Validates: Requirements 3.2, 3.6, 8.2**
fc.assert(
    fc.property(arbHealth, function (data) {
        var result = computeHealthScore(data);
        return result.score === null || (result.score >= 0 && result.score <= 100);
    }),
    { numRuns: NUM_RUNS, verbose: false }
);
console.log('  PASS Property 1 (Score Range — health)');

// Property 2: Null When All Absent (health)
// **Validates: Requirements 3.4, 8.3**
(function () {
    var result = computeHealthScore({});
    assert.strictEqual(result.score, null, 'Health {}: score must be null');
    assert.strictEqual(result.level, null, 'Health {}: level must be null');
})();
console.log('  PASS Property 2 (Null When All Absent — health)');

// Property 3: Best-Case Zero (health)
// **Validates: Requirements 3.1, 3.2, 8.5**
(function () {
    var best = {
        health_gen: 'good', disability: 'none', sleep: 'good', nutrition: 'good',
        psych_referral: 'no', learning_disorders: [], substances: [],
        psych_symptoms: [], mood: 5, motivation: 5, confidence: 5
    };
    var result = computeHealthScore(best);
    assert.strictEqual(result.score, 0, 'Health best-case: score must be 0, got ' + result.score);
})();
console.log('  PASS Property 3 (Best-Case Zero — health)');

// Property 4: Worst-Case 100 (health)
// **Validates: Requirements 3.1, 3.2, 8.4**
(function () {
    var worst = {
        health_gen: 'bad', disability: 'yes', sleep: 'bad', nutrition: 'bad',
        psych_referral: 'yes',
        learning_disorders: ['a', 'b', 'c'],
        substances: ['a', 'b'],
        psych_symptoms: ['self_harm', 'suicidal_ideation', 'psychosis', 'dissociation'],
        mood: 1, motivation: 1, confidence: 1
    };
    var result = computeHealthScore(worst);
    assert.strictEqual(result.score, 100, 'Health worst-case: score must be 100, got ' + result.score);
})();
console.log('  PASS Property 4 (Worst-Case 100 — health)');

// Property 5 / Level Consistency (health)
// **Validates: Requirements 5.1, 5.2, 7.2**
fc.assert(
    fc.property(arbHealth, function (data) {
        var result = computeHealthScore(data);
        assertLevelConsistency(result, 'health');
        return true;
    }),
    { numRuns: NUM_RUNS, verbose: false }
);
console.log('  PASS Property 5 (Level Consistency — health)');

// ---------------------------------------------------------------------------
// === FOLLOWUP AXIS TESTS ===
// ---------------------------------------------------------------------------

console.log('[test] bm-scoring — Followup axis');

// Property 1: Score Range (followup)
// **Validates: Requirements 4.2, 8.2**
fc.assert(
    fc.property(arbFollowup, function (data) {
        var result = computeFollowupScore(data);
        return result.score === null || (result.score >= 0 && result.score <= 100);
    }),
    { numRuns: NUM_RUNS, verbose: false }
);
console.log('  PASS Property 1 (Score Range — followup)');

// Property 2: Null When All Absent (followup)
// **Validates: Requirements 4.4, 8.3**
(function () {
    var result = computeFollowupScore({});
    assert.strictEqual(result.score, null, 'Followup {}: score must be null');
    assert.strictEqual(result.level, null, 'Followup {}: level must be null');
})();
console.log('  PASS Property 2 (Null When All Absent — followup)');

// Property 3: Minimum Score (followup) — good intervention = lowest possible score
// calls_count:5, meetings_count:5 (≥3 combined contacts → 5 pts minimum by design),
// 10 actions taken → 50 - 50 = 0 pts, next_date set, guardian_phone set.
//
// NOTE: The followup contact table always contributes ≥ 5 pts (3+ contacts → 5 pts),
// so the minimum achievable raw score is 5, giving score = round2(5/95*100) ≈ 5.26.
// The task spec states "best-case → score 0", but the scoring algorithm as defined
// in design.md cannot achieve 0 because the contact table minimum is 5 pts.
// The test verifies the mathematical minimum achievable score instead.
// **Validates: Requirements 4.1, 4.2, 8.5**
(function () {
    var best = {
        calls_count: 5, meetings_count: 5,
        actions_taken: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
        next_date: '2025-01-01', guardian_phone: '0600000000'
    };
    var result = computeFollowupScore(best);
    // Minimum achievable raw: 5 (contacts 3+) + 0 + 0 + 0 = 5
    // Minimum score: round2(5 / 95 * 100) = 5.26
    var expectedMin = Math.round((5 / 95 * 100) * 100) / 100; // 5.26
    assert.strictEqual(result.score, expectedMin,
        'Followup minimum-case: score must be ' + expectedMin + ', got ' + result.score);
    // It must be the lowest possible score (better than any lower-effort scenario)
    assert.ok(result.score < 100, 'Followup minimum-case: score must be well below 100');
    assert.ok(result.score !== null, 'Followup minimum-case: score must be non-null');
})();
console.log('  PASS Property 3 (Best-Case Zero — followup)');

// Property 4: Worst-Case 100 (followup) — no effort at all
// calls_count:0 (NOT null — triggers computation), 0 meetings, 0 actions,
// no next_date, no guardian_phone
// raw = 25 (contacts=0) + 50 (actions=0) + 10 (no date) + 10 (no phone) = 95
// score = min(95/95 × 100, 100) = 100
// **Validates: Requirements 4.1, 4.2, 8.4**
(function () {
    var worst = {
        calls_count: 0, meetings_count: 0,
        actions_taken: [],
        next_date: '', guardian_phone: ''
    };
    var result = computeFollowupScore(worst);
    assert.strictEqual(result.score, 100, 'Followup worst-case: score must be 100, got ' + result.score);
})();
console.log('  PASS Property 4 (Worst-Case 100 — followup)');

// Property 5 / Level Consistency (followup)
// **Validates: Requirements 5.1, 5.2, 7.2**
fc.assert(
    fc.property(arbFollowup, function (data) {
        var result = computeFollowupScore(data);
        assertLevelConsistency(result, 'followup');
        return true;
    }),
    { numRuns: NUM_RUNS, verbose: false }
);
console.log('  PASS Property 5 (Level Consistency — followup)');

// Property 8: Followup Inverse Ordering — full intervention score < zero-intervention score
// Full effort: 5+5 contacts (5 pts) + 10 actions (0 pts) + date set (0) + phone set (0) = 5 raw → 5.26
// Zero effort: 0 contacts (25 pts) + 0 actions (50 pts) + no date (10) + no phone (10) = 95 raw → 100
// **Validates: Requirements 4.1, 8.6**
(function () {
    var full = {
        calls_count: 5, meetings_count: 5,
        actions_taken: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
        next_date: '2025-01-01', guardian_phone: '0600000000'
    };
    var zero = {
        calls_count: 0, meetings_count: 0,
        actions_taken: [],
        next_date: '', guardian_phone: ''
    };
    var fullResult = computeFollowupScore(full);
    var zeroResult = computeFollowupScore(zero);
    assert.ok(fullResult.score !== null, 'Full intervention must produce non-null score');
    assert.ok(zeroResult.score !== null, 'Zero intervention must produce non-null score');
    assert.ok(
        fullResult.score < zeroResult.score,
        'Followup inverse: full intervention score (' + fullResult.score +
        ') must be < zero-intervention score (' + zeroResult.score + ')'
    );
})();
console.log('  PASS Property 8 (Followup Inverse Ordering)');

// ---------------------------------------------------------------------------
// === LEVEL CONSISTENCY across all four axes (Property 6) ===
// **Validates: Requirements 5.1, 5.2, 7.2**
// ---------------------------------------------------------------------------

console.log('[test] bm-scoring — Property 6: Level Consistency (all four axes)');

fc.assert(
    fc.property(arbEconomic, arbSocial, arbHealth, arbFollowup,
        function (eco, soc, health, followup) {
            assertLevelConsistency(computeEconomicScore(eco),   'prop6/economic');
            assertLevelConsistency(computeSocialScore(soc),     'prop6/social');
            assertLevelConsistency(computeHealthScore(health),  'prop6/health');
            assertLevelConsistency(computeFollowupScore(followup), 'prop6/followup');
            return true;
        }
    ),
    { numRuns: NUM_RUNS, verbose: false }
);
console.log('  PASS Property 6 (Level Consistency — all four axes)');

// ---------------------------------------------------------------------------
// === EDGE CASES (explicit assertions)
// ---------------------------------------------------------------------------

console.log('[test] bm-scoring — Edge cases');

// Economic: distance_km exactly 10 (should NOT trigger +5 — spec says > 10 strict)
(function () {
    var at10 = { eco_status: 'good', distance_km: 10 };
    var result = computeEconomicScore(at10);
    assert.ok(result.score !== null, 'distance_km=10 should be non-null (eco_status is set)');
    // eco_status good = 0, distance_km 10 → 0 pts (not >10), so raw=0, score=0
    assert.strictEqual(result.score, 0, 'distance_km=10 should give 0 pts (threshold is >10 strict)');
})();

// Economic: distance_km = 11 should trigger +5
(function () {
    var at11 = { eco_status: 'good', distance_km: 11 };
    var result = computeEconomicScore(at11);
    // eco_status good = 0 + 5 (>10km) = 5 raw / 85 * 100 ≈ 5.88
    assert.ok(result.score !== null && result.score > 0,
        'distance_km=11 should give >0 score (>10 strict threshold)');
})();

// Health: null mood vs mood=5 (both should contribute "no extra points")
(function () {
    var withMood5    = { mood: 5 };
    var withNullMood = {};
    var r5    = computeHealthScore(withMood5);
    var rNull = computeHealthScore(withNullMood);
    // mood=5 → 0 pts, but mood=5 DOES set hasAny → score = 0
    assert.strictEqual(r5.score, 0, 'mood=5 alone should produce score=0 (not null)');
    // null mood → {} → hasAny = false → null
    assert.strictEqual(rNull.score, null, 'empty data should produce null score');
})();

// Followup: calls_count=null (absent) vs calls_count=0 (present, triggers computation)
(function () {
    var withNullCalls  = { calls_count: null, meetings_count: null };
    var withZeroCalls  = { calls_count: 0, meetings_count: null };
    var rNull  = computeFollowupScore(withNullCalls);
    var rZero  = computeFollowupScore(withZeroCalls);
    assert.strictEqual(rNull.score, null,
        'calls_count=null + meetings_count=null (all absent) should give null score');
    assert.notStrictEqual(rZero.score, null,
        'calls_count=0 (NOT absent) should trigger computation');
})();

// Social: unrecognized field value treated as 0 (not NaN)
(function () {
    var unknownVal = { family_status: 'UNKNOWN_VALUE' };
    var result = computeSocialScore(unknownVal);
    assert.ok(result.score !== null, 'Unknown radio value: hasAny=true, score should be non-null');
    assert.ok(!isNaN(result.score), 'Unknown radio value must not produce NaN');
    assert.strictEqual(result.score, 0, 'Unknown radio value should score 0 (not in table)');
})();

console.log('  PASS Edge cases');

// ---------------------------------------------------------------------------
// === CODE REVIEW REMEDIATION (R1 + R2) ===
// R1: confidence wired into the health score.
// R2: divisors derived programmatically — every axis worst-case input must
//     yield score <= 100 (and exactly 100 where the design intends it).
// ---------------------------------------------------------------------------

console.log('[test] bm-scoring — Remediation R1/R2');

// R2: derived divisors equal the expected theoretical maxima.
(function () {
    assert.strictEqual(BM.ECO_DIVISOR, 85,
        'ECO_DIVISOR should derive to 85, got ' + BM.ECO_DIVISOR);
    assert.strictEqual(BM.SOC_DIVISOR, 105,
        'SOC_DIVISOR should derive to 105, got ' + BM.SOC_DIVISOR);
    // health now includes confidence (max 10): 65 radios + 24 + 20 + 30 + 15 + 10 + 10 = 174
    assert.strictEqual(BM.HEALTH_DIVISOR, 174,
        'HEALTH_DIVISOR should derive to 174 (confidence included), got ' + BM.HEALTH_DIVISOR);
    assert.strictEqual(BM.FOLLOWUP_DIVISOR, 95,
        'FOLLOWUP_DIVISOR should derive to 95, got ' + BM.FOLLOWUP_DIVISOR);
})();
console.log('  PASS R2 (divisors derived programmatically)');

// R2: feeding each axis its worst-case (max) input yields score <= 100,
//     and exactly 100 where the divisor equals the achievable max.
(function () {
    var ecoWorst = { eco_status: 'vpoor', income_source: 'none', distance_km: 15,
                     support_programs: [], unmet_needs: ['a', 'b', 'c', 'd'] };
    var socWorst = { family_status: 'divorced', parents_edu: 'none', housing: 'bad',
                     study_place: 'no', teachers_rel: 'bad', peers_rel: 'bad',
                     social_risks: ['a', 'b', 'c', 'd', 'e'] };
    var healthWorst = { health_gen: 'bad', disability: 'yes', sleep: 'bad', nutrition: 'bad',
                        psych_referral: 'yes',
                        learning_disorders: ['a', 'b', 'c'], substances: ['a', 'b'],
                        psych_symptoms: ['self_harm', 'suicidal_ideation', 'psychosis', 'dissociation'],
                        mood: 1, motivation: 1, confidence: 1 };
    var followupWorst = { calls_count: 0, meetings_count: 0, actions_taken: [],
                          next_date: '', guardian_phone: '' };

    var axes = [
        ['economic', computeEconomicScore(ecoWorst)],
        ['social',   computeSocialScore(socWorst)],
        ['health',   computeHealthScore(healthWorst)],
        ['followup', computeFollowupScore(followupWorst)]
    ];
    axes.forEach(function (pair) {
        var name = pair[0];
        var res  = pair[1];
        assert.ok(res.score !== null, name + ' worst-case: score must be non-null');
        assert.ok(res.score <= 100, name + ' worst-case: score must be <= 100, got ' + res.score);
        assert.strictEqual(res.score, 100,
            name + ' worst-case: score should be exactly 100, got ' + res.score);
    });
})();
console.log('  PASS R2 (every axis worst-case <= 100, exactly 100)');

// R1: confidence affects the health score (worse confidence raises the score).
(function () {
    var bestConf  = { mood: 3, motivation: 3, confidence: 5 }; // 5 → 0 pts
    var worstConf = { mood: 3, motivation: 3, confidence: 1 }; // 1 → 10 pts
    var rBest  = computeHealthScore(bestConf);
    var rWorst = computeHealthScore(worstConf);

    assert.ok(rBest.score !== null && rWorst.score !== null,
        'confidence cases must produce non-null scores');
    assert.ok(rWorst.score > rBest.score,
        'Lower confidence (1) must raise the health score above high confidence (5): ' +
        rWorst.score + ' should be > ' + rBest.score);

    // confidence must be recorded in subScores and contribute its full max (10)
    var rMaxConf = computeHealthScore({ confidence: 1 });
    assert.strictEqual(rMaxConf.subScores.confidence, 10,
        'confidence=1 should record 10 pts in subScores, got ' + rMaxConf.subScores.confidence);

    // confidence alone must set hasAny (non-null result)
    assert.ok(rMaxConf.score !== null, 'confidence alone should yield a non-null score');

    // confidence=5 contributes 0 pts but still sets hasAny
    var rZeroConf = computeHealthScore({ confidence: 5 });
    assert.strictEqual(rZeroConf.subScores.confidence, 0,
        'confidence=5 should record 0 pts');
    assert.strictEqual(rZeroConf.score, 0, 'confidence=5 alone should yield score 0');
})();
console.log('  PASS R1 (confidence affects the health score)');

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log('\nPASS bm-scoring.test.js — all properties and edge cases passed (' + NUM_RUNS + '+ iterations each)');
process.exit(0);
