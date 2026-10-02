// Proctor Distribution V3 — public API entry point.
//
// This module is the single public surface of the V3 algorithm. Consumers
// (renderer, IPC layer, CLI tests, end users) SHALL ONLY call `run`. The
// `_internals` namespace is exported for white-box testing and is not part
// of the public contract.
//
// Acceptance Criteria covered:
//   - 1.1   : single public function `run(input)` returning the standard envelope
//   - 1.2   : runnable in pure Node (no `window`/`document`/`electron` required)
//   - 17.2  : public API exposed via `module.exports` (Node-first), with
//             secondary `window.ProctorDistributionV3` attachment for the
//             Electron renderer
//
// V2 pitfall explicitly avoided (per tasks.md task 24):
//   V2 used `window.ProctorDistributionV2 = { ... }` ONLY, which made
//   CLI/Node testing impossible (the file threw on load under Node because
//   `window` was undefined). V3 primarily uses `module.exports`; the
//   `window` attachment is a secondary convenience for the renderer and
//   is guarded by a `typeof window !== 'undefined'` check.

'use strict';

var path = require('path');

var orchestratorModule = require(path.join(__dirname, 'orchestrator.js'));
var canonicalKeyModule = require(path.join(__dirname, 'canonical-key.js'));
var diagnosticsModule = require(path.join(__dirname, 'diagnostics.js'));
var prngModule = require(path.join(__dirname, 'utils', 'prng.js'));

var runOrchestrator = orchestratorModule.runOrchestrator;

/**
 * Run the V3 proctor distribution algorithm.
 *
 * @param {Object} input - GS3_Input_Contract object. See requirements.md
 *                         glossary for the full schema.
 * @param {Object} [options] - optional runtime tuning.
 * @param {number} [options.totalBudgetMs=30000] - global wall-clock budget.
 * @returns {{
 *   result: Array,                 // ResultRow[] (V2-shape compatible)
 *   diagnostics: Object,           // DiagnosticsV3
 *   algorithmVersion: 'v3',
 *   orchestratorState: 'COMPLETED'|'DEGRADED'|'TIMEOUT'|'ERROR'|'INVALID_INPUT'
 * }}
 */
function run(input, options) {
    return runOrchestrator(input, options);
}

// ---------------------------------------------------------------------------
// _internals — testing-only exports.
//
// Exposes the helpers required by the spec (`canonicalProctorKey`,
// `buildKeyAdapter`, `computeHistogram`) plus a small set of additional
// utilities that downstream PBT and integration tests have already
// adopted. None of these are part of the public contract; consumers that
// reach into `_internals` accept that the surface may change without
// notice.
// ---------------------------------------------------------------------------
var _internals = {
    // Canonical key (Requirement 2).
    canonicalProctorKey: canonicalKeyModule.canonicalProctorKey,
    buildKeyAdapter: canonicalKeyModule.buildKeyAdapter,
    toCanonical: canonicalKeyModule.toCanonical,

    // Histogram (Requirement 9.3 / 9.3a). Task 24 calls out
    // `computeHistogram` specifically — we expose the canonical
    // slot-based variant under that name AND keep both explicit names
    // available for tests that need to disambiguate.
    computeHistogram: diagnosticsModule.computeHistogramByGuardCount,
    computeHistogramByGuardCount: diagnosticsModule.computeHistogramByGuardCount,
    computeHistogramByPrimaryLoad: diagnosticsModule.computeHistogramByPrimaryLoad,

    // Orchestrator + PRNG (used by integration / determinism PBTs).
    runOrchestrator: runOrchestrator,
    createPRNG: prngModule.createPRNG
};

module.exports = { run: run, _internals: _internals };

// Secondary: attach to window when running inside a renderer / browser-like
// host. Guarded so this file remains require-able from pure Node (CLI tests,
// `verify:v3` script, Section 7 PBT suite).
if (typeof window !== 'undefined') {
    window.ProctorDistributionV3 = { run: run, _internals: _internals };
}
