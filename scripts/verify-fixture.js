'use strict';
/**
 * Generic fixture verification script.
 * Usage: node scripts/verify-fixture.js <fixture-file>
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const fixtureArg = process.argv[2];
if (!fixtureArg) {
  console.error('Usage: node scripts/verify-fixture.js <fixture-file>');
  process.exit(2);
}

const fixturePath = path.isAbsolute(fixtureArg)
  ? fixtureArg
  : path.join(ROOT, fixtureArg);

if (!fs.existsSync(fixturePath)) {
  console.error('Fixture not found:', fixturePath);
  process.exit(2);
}

const src = fs.readFileSync(path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'), 'utf8');
const sb = { console, Date, Math, Number, Object, Array, Set, Map, JSON, isFinite, isNaN, Infinity, parseInt };
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
const V2 = sb.ProctorDistributionV2 || sb.window.ProctorDistributionV2;

const input = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

console.log('═══ INPUT ═══');
console.log('Fixture:', fixturePath);
console.log('Proctors:', input.proctorsList.length);
console.log('Schedule entries:', input.scheduleEntries.length);
console.log('Duty entries:', Object.keys(input.dutyData || {}).length);
console.log('meAssignments:', Object.keys(input.meAssignments || {}).length);
console.log('Exemptions:', Object.keys(input.exemptionsData || {}).length);
console.log('proctorsPerRoom:', input.examDistributionRules?.proctorsPerRoom);
console.log('reservesConfig:', input.reservesConfig);
console.log('D_expected:', input.D_expected);

const t0 = Date.now();
const out = V2.run(input);
const t1 = Date.now();

if (!out || !out.result) {
  console.error('Run failed.');
  process.exit(1);
}

console.log('\n═══ DIAGNOSTICS ═══');
const d = out.diagnostics;
console.log('totalDurationMs:', d.totalDurationMs, '(wall:', t1 - t0, 'ms)');
console.log('phase2DurationMs:', d.phase2DurationMs, '| phase2TimedOut:', d.phase2TimedOut);
console.log('phase2_5DurationMs:', d.phase2_5DurationMs, '| phase3DurationMs:', d.phase3DurationMs);
console.log('coverageRepairSwaps:', d.coverageRepairSwaps);
console.log('coverageRepairUnresolved:', d.coverageRepairUnresolved);
console.log('coverageRepairWarnings:', JSON.stringify(d.coverageRepairWarnings || []));
console.log('lowerBound / upperBound:', d.lowerBound, '/', d.upperBound);
console.log('eligibilityClassCount:', d.eligibilityClassCount);
console.log('maxPrimaryLoadGapWithinClass:', d.maxPrimaryLoadGapWithinClass);
console.log('fallbackCount:', d.fallbackCount);
console.log('shortages:', d.shortages);
console.log('warnings:', d.warnings);

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

console.log('\n═══ HISTOGRAM ═══');
Object.keys(hist).sort((a, b) => +a - +b).forEach(k => {
  console.log('  load=' + k + ' → ' + hist[k] + ' proctor(s)');
});
console.log('\nMin:', min, '| Max:', max, '| Avg:', avg.toFixed(2), '| Sum:', sum);

const filledSlots = sum;
const totalSlotsExpected = out.result.length * (input.examDistributionRules.proctorsPerRoom || 2);
console.log('Total filled slots:', filledSlots, '/ expected:', totalSlotsExpected);

const lower = d.lowerBound;
const upper = d.upperBound;
const p1 = max - min <= 1;
const p2 = max <= upper;
const p3 = min >= lower;
const coverage = filledSlots === totalSlotsExpected;

console.log('\n═══ VERDICT ═══');
console.log('P1 (max-min ≤ 1):     ', p1 ? 'PASS' : 'FAIL', '(diff=' + (max - min) + ')');
console.log('P2 (max ≤ upperBound):', p2 ? 'PASS' : 'FAIL');
console.log('P3 (min ≥ lowerBound):', p3 ? 'PASS' : 'FAIL');
console.log('Coverage:', coverage ? 'PASS' : 'FAIL', '(' + filledSlots + '/' + totalSlotsExpected + ')');

if (!p3) {
  const under = loads.filter(l => l.load < lower);
  console.log('\nProctors below lowerBound (' + lower + '):', under.length);
  under.slice(0, 15).forEach(l => console.log('  idx=' + l.idx + ' load=' + l.load + ' | ' + l.name));
}
if (!p2) {
  const over = loads.filter(l => l.load > upper);
  console.log('\nProctors above upperBound (' + upper + '):', over.length);
  over.slice(0, 15).forEach(l => console.log('  idx=' + l.idx + ' load=' + l.load + ' | ' + l.name));
}

process.exit((p1 && p2 && p3) ? 0 : 1);
