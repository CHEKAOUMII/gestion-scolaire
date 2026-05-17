'use strict';
/**
 * Real-centre verification script.
 *
 * Loads the user's actual centre data exported from the live page
 * (tests/fixtures/proctor-v2-real-centre-data.json) and runs the v2
 * algorithm against it. Reports the same four invariants as
 * scripts/verify-end-to-end.js (P1, P2, P3, Coverage) plus a richer
 * histogram and class-bound diagnostics.
 *
 * Run:  node scripts/verify-real-centre.js
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// 1) Load the production v2 module via VM sandbox (no IPC, no DOM).
const src = fs.readFileSync(path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'), 'utf8');
const sb = { console, Date, Math, Number, Object, Array, Set, Map, JSON, isFinite, isNaN, Infinity, parseInt };
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
const V2 = sb.ProctorDistributionV2 || sb.window.ProctorDistributionV2;

// 2) Load real centre input.
const input = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests/fixtures/proctor-v2-real-centre-data.json'), 'utf8')
);

console.log('═══ REAL CENTRE INPUT ═══');
console.log('Proctors:', input.proctorsList.length);
console.log('Schedule entries:', input.scheduleEntries.length);
console.log('Duty entries:', Object.keys(input.dutyData || {}).length);
console.log('meAssignments:', Object.keys(input.meAssignments || {}).length);
console.log('Exemptions:', Object.keys(input.exemptionsData || {}).length);
console.log('Rooms config keys:', Object.keys(input.options.roomsList || {}).length);
console.log('proctorsPerRoom (rules):', input.examDistributionRules.proctorsPerRoom);
console.log('reservesConfig:', input.reservesConfig);
console.log('D_expected:', input.D_expected);

// 3) Run.
const t0 = Date.now();
const out = V2.run(input);
const t1 = Date.now();

if (!out || !out.result) {
  console.error('❌ Run failed.');
  process.exit(1);
}

console.log('\n═══ DIAGNOSTICS ═══');
const d = out.diagnostics;
console.log('totalDurationMs:', d.totalDurationMs, '(wall:', t1 - t0, 'ms)');
console.log('phase1DurationMs:', d.phase1DurationMs);
console.log('phase2DurationMs:', d.phase2DurationMs);
console.log('phase2TimedOut:', d.phase2TimedOut);
console.log('phase2_5DurationMs:', d.phase2_5DurationMs);
console.log('phase3DurationMs:', d.phase3DurationMs);
console.log('coverageRepairDurationMs:', d.coverageRepairDurationMs);
console.log('coverageRepairSwaps:', d.coverageRepairSwaps);
console.log('coverageRepairUnresolved:', d.coverageRepairUnresolved);
console.log('coverageRepairWarnings:', d.coverageRepairWarnings);
console.log('lowerBound / upperBound:', d.lowerBound, '/', d.upperBound);
console.log('eligibilityClassCount:', d.eligibilityClassCount);
console.log('maxPrimaryLoadGapWithinClass:', d.maxPrimaryLoadGapWithinClass);
console.log('singletonCount:', d.singletonCount);
console.log('domainReductionPercent:', d.domainReductionPercent);
console.log('fallbackCount:', d.fallbackCount);
console.log('shortages:', d.shortages);
console.log('sessionsWithShortage:', d.sessionsWithShortage);
console.log('initialObjective:', d.initialObjective);
console.log('finalObjective:', d.finalObjective);
console.log('acceptedMoves:', d.acceptedMoves, '/ iterations:', d.iterationsExecuted);
console.log('warnings:', d.warnings);
console.log('errors:', d.errors);

// 4) Reconstruct slot loads using __idx_N keys (same approach as the
//    debug session in DevTools).
const slotCount = {};
out.result.forEach(row => {
  (row.proctor_keys || []).forEach(k => {
    if (k) slotCount[k] = (slotCount[k] || 0) + 1;
  });
});

const totalProctors = input.proctorsList.length;
const loads = [];
for (let i = 0; i < totalProctors; i++) {
  const k = '__idx_' + i;
  const load = slotCount[k] || 0;
  loads.push({ idx: i, name: input.proctorsList[i].teacher_name, load });
}

const guardCounts = loads.map(l => l.load);
const sum = guardCounts.reduce((a, b) => a + b, 0);
const min = Math.min(...guardCounts);
const max = Math.max(...guardCounts);
const avg = sum / totalProctors;

const hist = {};
guardCounts.forEach(c => (hist[c] = (hist[c] || 0) + 1));

console.log('\n═══ GUARD LOAD HISTOGRAM ═══');
Object.keys(hist).sort((a, b) => +a - +b).forEach(k => {
  console.log('  load=' + k + ' → ' + hist[k] + ' proctor(s)');
});

console.log('\nMin:', min, '| Max:', max, '| Avg:', avg.toFixed(2), '| Sum:', sum);

const filledSlots = sum;
const totalSlotsExpected = out.result.length * (input.examDistributionRules.proctorsPerRoom || 2);

console.log('Total filled slots:', filledSlots, '/ expected:', totalSlotsExpected);

// 5) Verdict.
const lower = d.lowerBound;
const upper = d.upperBound;

const p1 = max - min <= 1;
const p2 = max <= upper;
const p3 = min >= lower;
const coverage = filledSlots === totalSlotsExpected;

console.log('\n═══ VERDICT ═══');
console.log('P1 (max-min ≤ 1):     ', p1 ? 'PASS' : 'FAIL', '(diff=' + (max - min) + ')');
console.log('P2 (max ≤ upperBound):', p2 ? 'PASS' : 'FAIL', '(max=' + max + ', upper=' + upper + ')');
console.log('P3 (min ≥ lowerBound):', p3 ? 'PASS' : 'FAIL', '(min=' + min + ', lower=' + lower + ')');
console.log('Coverage (filled=expected):', coverage ? 'PASS' : 'FAIL',
  '(' + filledSlots + '/' + totalSlotsExpected + ')');

if (!p3) {
  const under = loads.filter(l => l.load < lower);
  console.log('\n⚠️ ' + under.length + ' proctor(s) BELOW lowerBound (' + lower + '):');
  under.slice(0, 20).forEach(l =>
    console.log('  idx=' + l.idx + ' load=' + l.load + ' | ' + l.name)
  );
}

if (!p2) {
  const over = loads.filter(l => l.load > upper);
  console.log('\n⚠️ ' + over.length + ' proctor(s) ABOVE upperBound (' + upper + '):');
  over.slice(0, 20).forEach(l =>
    console.log('  idx=' + l.idx + ' load=' + l.load + ' | ' + l.name)
  );
}

process.exit((p1 && p2 && p3 && coverage) ? 0 : 1);
