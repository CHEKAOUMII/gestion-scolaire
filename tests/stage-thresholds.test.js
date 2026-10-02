'use strict';

/**
 * Per-stage threshold tables (Slice 2 remainder).
 *
 *   node tests/stage-thresholds.test.js
 *
 * Pins the extracted qualifiant mention/grade-comment scales byte-for-byte
 * (labels AND cut semantics incl. boundary values), the system-wide pass
 * mark, and the fail-closed contract: unseeded stages (collegial, primary,
 * unknown) → MISSING_RULE, missing cycle → RULES_UNAVAILABLE, bad average →
 * INVALID_AVERAGE. Pages must render without mention words on !ok — never
 * another stage's vocabulary.
 */

const assert = require('assert');
const thresholds = require('../js/shared/education/stage-thresholds');

const QUALIFIANT = 'secondary_qualifiant';
const COLLEGIAL = 'secondary_collegial';

function labelOf(resolution) {
    assert.strictEqual(resolution.ok, true, `expected ok, got ${resolution.code}`);
    return resolution.label;
}

async function main() {
    console.log('[test] stage thresholds');

    // 1. Mention goldens: exact labels (note 'حسن جدا' without hamza — the
    // analytics/reports-schedule wording) and cut semantics incl. edges.
    {
        const cases = [
            [20, 'ممتاز'],
            [16, 'ممتاز'],
            [15.99, 'حسن جدا'],
            [14, 'حسن جدا'],
            [13.5, 'حسن'],
            [12, 'حسن'],
            [11.99, 'مقبول'],
            [10, 'مقبول'],
            [9.99, 'ضعيف'],
            [0, 'ضعيف']
        ];
        for (const [average, expected] of cases) {
            assert.strictEqual(labelOf(thresholds.resolveMentionBand(average, QUALIFIANT)), expected, `mention(${average})`);
        }
        const bands = thresholds.resolveMentionBands(QUALIFIANT);
        assert.strictEqual(bands.ok, true);
        assert.deepStrictEqual(
            bands.bands.map((b) => b.key),
            ['excellent', 'veryGood', 'good', 'acceptable', 'weak']
        );
        assert.ok(Object.isFrozen(bands.bands));
        console.log('  [ok] qualifiant mention goldens (labels + cuts + edges)');
    }

    // 2. Grade-comment goldens: the class-report 6-band wording (note 'حسن جداً'
    // WITH hamza and the متوسط/دون المتوسط split — intentionally not unified
    // with the mention scale; see the module header).
    {
        const cases = [
            [20, 'ممتاز'],
            [16, 'ممتاز'],
            [14, 'حسن جداً'],
            [12, 'حسن'],
            [10, 'متوسط'],
            [9.99, 'دون المتوسط'],
            [8, 'دون المتوسط'],
            [7.99, 'ضعيف'],
            [0, 'ضعيف']
        ];
        for (const [average, expected] of cases) {
            assert.strictEqual(labelOf(thresholds.resolveGradeComment(average, QUALIFIANT)), expected, `comment(${average})`);
        }
        console.log('  [ok] qualifiant grade-comment goldens (labels + cuts + edges)');
    }

    // 3. Fail-closed: unseeded stages never borrow qualifiant words.
    {
        for (const cycle of [COLLEGIAL, 'primary', 'unknown_stage']) {
            assert.strictEqual(thresholds.resolveMentionBand(12, cycle).code, 'MISSING_RULE', `mention ${cycle}`);
            assert.strictEqual(thresholds.resolveGradeComment(12, cycle).code, 'MISSING_RULE', `comment ${cycle}`);
            assert.strictEqual(thresholds.resolveMentionBands(cycle).code, 'MISSING_RULE', `bands ${cycle}`);
        }
        for (const cycle of [null, undefined, '']) {
            assert.strictEqual(thresholds.resolveMentionBand(12, cycle).code, 'RULES_UNAVAILABLE', 'mention no-cycle');
            assert.strictEqual(thresholds.resolveGradeComment(12, cycle).code, 'RULES_UNAVAILABLE', 'comment no-cycle');
        }
        console.log('  [ok] unseeded stages fail closed (MISSING_RULE / RULES_UNAVAILABLE)');
    }

    // 4. Invalid averages fail closed; pass mark stays system-wide.
    {
        for (const bad of [NaN, Infinity, -1, 20.01, '12', null]) {
            assert.strictEqual(
                thresholds.resolveMentionBand(bad, QUALIFIANT).code,
                'INVALID_AVERAGE',
                `mention(${String(bad)})`
            );
        }
        assert.strictEqual(thresholds.PASS_MARK, 10);
        assert.strictEqual(thresholds.isPassingAverage(10), true);
        assert.strictEqual(thresholds.isPassingAverage(9.99), false);
        assert.strictEqual(thresholds.isPassingAverage(NaN), false);
        assert.strictEqual(thresholds.isPassingAverage(null), false);
        console.log('  [ok] invalid averages fail closed; pass mark is system-wide');
    }

    // 5. Wiring: every mention consumer loads the module and calls it.
    // (Mirrors the collegial-levels wiring guard in cc-rules-collegial-golden.)
    {
        const fs = require('fs');
        const path = require('path');
        const root = path.join(__dirname, '..');
        const TAG = '<script src="js/shared/education/stage-thresholds.js"';
        const pages = {
            'analytics.html': ['refreshGradeBandsForStage', 'ANALYTICS_BAND_COLORS'],
            'results-hub.html': ['resolveMentionBand', 'MENTION_UNAVAILABLE_NOTICE'],
            'reports-semester.html': ['refreshReportBands', 'mentionBandsUnavailable'],
            'grades-results.html': ['resolveGradeComment', 'MENTION_UNAVAILABLE_NOTICE']
        };
        for (const htmlFile of Object.keys(pages)) {
            const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
            assert.ok(html.includes(TAG), `${htmlFile} must load stage-thresholds.js`);
        }
        const sources = {
            'analytics.html': 'js/pages/analytics.js',
            'results-hub.html': 'js/pages/results-hub.js',
            'reports-semester.html': 'reports-semester.html',
            'grades-results.html': 'grades-results.html'
        };
        for (const [htmlFile, markers] of Object.entries(pages)) {
            const src = fs.readFileSync(path.join(root, sources[htmlFile]), 'utf8');
            for (const marker of markers) {
                assert.ok(src.includes(marker), `${sources[htmlFile]} must reference ${marker}`);
            }
        }
        assert.strictEqual(typeof thresholds.MENTION_UNAVAILABLE_NOTICE, 'string');
        assert.ok(thresholds.MENTION_UNAVAILABLE_NOTICE.length > 10);
        console.log('  [ok] all 4 consumers load the module and reference its API');
    }

    // 6. Partition property: both qualifiant scales cover [0, 20] contiguously
    // (no holes), and the dashboard cutoffs used by the semester report are
    // exactly the band unions (v >= 12 <=> top-3 mention bands, v < 10 <=> weak).
    {
        const GOOD_PLUS = new Set(['excellent', 'veryGood', 'good']);
        for (let hundredths = 0; hundredths <= 2000; hundredths += 25) {
            const v = hundredths / 100;
            const mention = thresholds.resolveMentionBand(v, QUALIFIANT);
            assert.strictEqual(mention.ok, true, `mention resolves at ${v}`);
            assert.strictEqual(GOOD_PLUS.has(mention.key), v >= 12, `good-plus <=> v>=12 at ${v}`);
            assert.strictEqual(mention.key === 'weak', v < 10, `weak <=> v<10 at ${v}`);
            const comment = thresholds.resolveGradeComment(v, QUALIFIANT);
            assert.strictEqual(comment.ok, true, `comment resolves at ${v}`);
        }
        console.log('  [ok] scales partition [0, 20] and match the numeric cutoffs');
    }

    console.log('[test] stage thresholds: all checks passed');
}

main().catch((err) => {
    console.error('FAIL: stage thresholds — ' + (err && err.message ? err.message : err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
});
