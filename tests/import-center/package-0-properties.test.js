'use strict';

// node tests/import-center/package-0-properties.test.js
// Property 7 — confidence and ambiguity policy
// Property 8 — signatures, fixtures, and contracts

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fc = require('fast-check');

const Contracts = require('../../js/import-center/import-contracts.js');
const Signatures = require('../../js/import-center/import-signatures.js');

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'import-center');
const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'manifest.json'), 'utf8'));

// ── Property 7 ──────────────────────────────────────────────
fc.assert(
    fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
        (top, second) => {
            const policy = Contracts.applyConfidencePolicy(top, second);
            assert.strictEqual(policy.readyEligibleFromClassification, false);

            if (top >= 0.85) assert.strictEqual(policy.band, 'high');
            else if (top >= 0.6) assert.strictEqual(policy.band, 'medium');
            else assert.strictEqual(policy.band, 'low');

            if (second != null && top - second < 0.1) {
                assert.strictEqual(policy.ambiguous, true);
                assert.strictEqual(policy.needsReview, true);
            }

            if (policy.band === 'low' || policy.band === 'medium' || policy.ambiguous) {
                assert.strictEqual(policy.needsReview, true);
                assert.strictEqual(policy.proposedReadyAfterPreflight, false);
            }

            // Ambiguous or low/medium never become ready solely from classification
            if (policy.needsReview) {
                assert.notStrictEqual(policy.readyEligibleFromClassification, true);
            }
            return true;
        }
    ),
    { numRuns: 100 }
);

// Explicit boundary cases
{
    const high = Contracts.applyConfidencePolicy(0.85, 0.5);
    assert.strictEqual(high.band, 'high');
    assert.strictEqual(high.readyEligibleFromClassification, false);

    const med = Contracts.applyConfidencePolicy(0.7, 0.4);
    assert.strictEqual(med.band, 'medium');
    assert.ok(med.needsReview);

    const low = Contracts.applyConfidencePolicy(0.4, 0.1);
    assert.strictEqual(low.band, 'low');
    assert.ok(low.needsReview);

    const amb = Contracts.applyConfidencePolicy(0.9, 0.85);
    assert.ok(amb.ambiguous);
    assert.ok(amb.needsReview);
    assert.strictEqual(amb.readyEligibleFromClassification, false);
}

// ── Property 8 ──────────────────────────────────────────────
const allSources = Contracts.REGISTERED_SOURCE_TYPES.concat(['generic_csv_xlsx']);

fc.assert(
    fc.property(fc.constantFrom(...allSources), (source) => {
        const sig = Signatures.getSignature(source);
        assert.ok(sig, `signature for ${source}`);
        assert.strictEqual(sig.type, source);

        const entry = manifest.types[source];
        assert.ok(entry, `fixture entry for ${source}`);
        assert.ok(entry.valid.length >= 2, `two valid fixtures for ${source}`);
        for (const rel of entry.valid) {
            assert.ok(fs.existsSync(path.join(FIXTURE_ROOT, rel)), rel);
        }
        // failure cases where applicable
        if (entry.failure) {
            for (const rel of entry.failure) {
                assert.ok(fs.existsSync(path.join(FIXTURE_ROOT, rel)), rel);
            }
        }

        // Unified contract exists; write behavior unchanged
        assert.strictEqual(Contracts.PHASE_ONE.writesAllowed, false);
        assert.ok(Contracts.PHASE_ONE.analyzeOnly);

        // Fixture not marked sensitive
        assert.strictEqual(manifest.sensitive, false);
        return true;
    }),
    { numRuns: allSources.length * 3 }
);

// Calibration constants fixed
const cal = Signatures.getCalibration();
assert.strictEqual(cal.high, Contracts.CONFIDENCE.HIGH);
assert.strictEqual(cal.medium, Contracts.CONFIDENCE.MEDIUM);
assert.strictEqual(cal.ambiguityGap, Contracts.CONFIDENCE.AMBIGUITY_GAP);

console.log('package-0-properties: OK');
