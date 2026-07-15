/*
 * Unit tests for fairness utilities in js/pages/exams-proctors.js.
 * Approach: extract pure functions by name from the page source, evaluate
 * them in an isolated vm context, then exercise them.
 *
 * Run via: node tests/exam-fairness.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PAGE_PATH = path.join(__dirname, '..', 'js', 'pages', 'exams-proctors.js');
const source = fs.readFileSync(PAGE_PATH, 'utf8');

// --- Helper: extract a top-level `function NAME(...) { ... }` block by brace matching.
function extractFunction(name, src) {
    const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g');
    const m = re.exec(src);
    if (!m) throw new Error('Function not found in source: ' + name);
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    if (depth !== 0) throw new Error('Unbalanced braces while extracting: ' + name);
    return src.slice(m.index, i);
}

const ginySrc = extractFunction('computeGiniCoefficient', source);
const seedSrc = extractFunction('buildSeededRandom', source);
const quotaSrc = extractFunction('buildPerTeacherQuota', source);
const countSessionsSrc = extractFunction('countDistinctSessions', source);

// Sandbox for pure helpers (Gini + RNG)
const sandbox = vm.createContext({ Math, Number, JSON });
vm.runInContext(ginySrc + '\n' + seedSrc, sandbox);

const computeGini = sandbox.computeGiniCoefficient;
const buildSeededRandom = sandbox.buildSeededRandom;

// Sandbox for buildPerTeacherQuota with injected dependencies
function makeQuotaSandbox(proctorsList) {
    const ctx = {
        Math, Number, JSON, Set, Object,
        proctorsList,
        getProctorExemptionKey: (proc, idx) => proc.cin || proc.som || ('idx_' + idx),
        getRoomRowsForLevel: (_levelName) => {
            // mock: 3 rooms per level
            return [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
        },
        getAutoDistributionSessionKey: (entry) =>
            [entry.day, entry.period, entry.session].join('|'),
        computeReservesForSession: (guardNeed, rules) => {
            if (!rules) return 0;
            if (rules.reservesMode === 'percent') {
                return Math.max(0, Math.round((Number(guardNeed) || 0) * (Number(rules.reservesPercent) || 0) / 100));
            }
            return Math.max(0, Number(rules.reservesPerSession) || 0);
        },
        getTeacherLoadDetails: (loadState, exKey) => ({
            duty: (loadState && loadState[exKey] && loadState[exKey].duty) || 0
        })
    };
    vm.createContext(ctx);
    vm.runInContext(countSessionsSrc + '\n' + quotaSrc, ctx);
    return ctx;
}

// --- Tiny test harness ---
let pass = 0;
let fail = 0;
const failures = [];

function ok(label) {
    pass++;
    console.log('  \x1b[32m✓\x1b[0m ' + label);
}
function ko(label, detail) {
    fail++;
    failures.push({ label, detail });
    console.log('  \x1b[31m✗\x1b[0m ' + label + (detail ? ' — ' + detail : ''));
}
function eq(actual, expected, label) {
    if (actual === expected) ok(label);
    else ko(label, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function near(actual, expected, tol, label) {
    if (Math.abs(actual - expected) <= tol) ok(label);
    else ko(label, 'expected ' + expected + '±' + tol + ', got ' + actual);
}
function truthy(actual, label) {
    if (actual) ok(label);
    else ko(label, 'expected truthy, got ' + JSON.stringify(actual));
}

// =========== computeGiniCoefficient ===========
console.log('\n[computeGiniCoefficient]');

eq(computeGini([]), 0, 'empty input returns 0');
eq(computeGini(null), 0, 'null input returns 0');
eq(computeGini([0, 0, 0]), 0, 'all zeros returns 0');
eq(computeGini([5, 5, 5, 5]), 0, 'perfectly equal returns 0');

// G = (2*sum(i*x_i))/(n*sum) - (n+1)/n
// [0,0,0,10] sorted: 1*0+2*0+3*0+4*10 = 40 ; 2*40/(4*10) - 5/4 = 0.75
near(computeGini([0, 0, 0, 10]), 0.75, 1e-6, 'maximum inequality on n=4 → 0.75');

// [1,1,1,7]: sum=10, weighted=1+2+3+28=34 ; 68/40 - 1.25 = 0.45
near(computeGini([1, 1, 1, 7]), 0.45, 1e-6, 'one outlier high → 0.45');

// [4,4,5,5,6,6]: sum=30, weighted=4+8+15+20+30+36=113 ; 226/180 - 7/6 ≈ 0.0889
near(computeGini([4, 4, 5, 5, 6, 6]), 0.0889, 0.001, 'mild inequality → ~0.089');

// المرجع: لو كانت قيم final = [4,4,4,4] فإنّ Gini = 0 (الهدف بعد إصلاح الخطأ الأصلي)
eq(computeGini([4, 4, 4, 4, 4, 4]), 0, 'fairness target: all equal → 0');

// قيم سالبة تُتجاهَل
near(computeGini([-1, 0, 5, 5]), computeGini([0, 5, 5]), 1e-9, 'negatives are filtered out');

// قيم غير رقمية تُتجاهَل
near(computeGini([NaN, 3, 3, 3]), 0, 1e-9, 'NaN values filtered → equal remainder yields 0');

// monotonicity: increasing inequality should not decrease Gini
const giniA = computeGini([5, 5, 5, 5]);
const giniB = computeGini([4, 5, 5, 6]);
const giniC = computeGini([2, 5, 5, 8]);
const giniD = computeGini([0, 0, 0, 20]);
truthy(giniA <= giniB && giniB <= giniC && giniC <= giniD, 'monotonic w.r.t. spread');

// =========== buildSeededRandom ===========
console.log('\n[buildSeededRandom]');

const rngA1 = buildSeededRandom(42);
const rngA2 = buildSeededRandom(42);
const seqA1 = Array.from({ length: 10 }, () => rngA1());
const seqA2 = Array.from({ length: 10 }, () => rngA2());
eq(JSON.stringify(seqA1), JSON.stringify(seqA2), 'same seed → identical sequence');

const rngB = buildSeededRandom(43);
const seqB = Array.from({ length: 10 }, () => rngB());
truthy(JSON.stringify(seqB) !== JSON.stringify(seqA1), 'different seed → different sequence');

const rngStr = buildSeededRandom('42');
const seqStr = Array.from({ length: 10 }, () => rngStr());
eq(JSON.stringify(seqStr), JSON.stringify(seqA1), 'string seed coerces to number');

// Range check: [0, 1)
const rngRange = buildSeededRandom(123);
let allInRange = true;
for (let i = 0; i < 1000; i++) {
    const v = rngRange();
    if (!(v >= 0 && v < 1)) {
        allInRange = false;
        break;
    }
}
truthy(allInRange, '1000 draws all in [0, 1)');

// Null seed → falls back to Math.random (callable, non-throwing)
const fallback = buildSeededRandom(null);
truthy(typeof fallback === 'function', 'null seed → returns a callable');
const v = fallback();
truthy(v >= 0 && v < 1, 'fallback value in [0, 1)');

// Distribution sanity: mean of 5000 draws should be close to 0.5
const rngDist = buildSeededRandom(7);
let sum = 0;
const N = 5000;
for (let i = 0; i < N; i++) sum += rngDist();
near(sum / N, 0.5, 0.03, 'seeded mean close to 0.5 (n=5000)');

// =========== buildPerTeacherQuota ===========
console.log('\n[buildPerTeacherQuota]');

(async function () {

// Scenario 1: 4 teachers, 2 schedule entries, no duty pre-loaded
// rooms per entry = 3, proctorsPerRoom = 2 → totalGuard = 2 * 3 * 2 = 12
// reservesPerSession = 1, sessionsCount = 2 → totalReserve = 2
// totalDuty = 0 → totalFinal = 14, ceil(14/4) = 4
// reserveBudgetPerTeacher = ceil(2/4) = 1
// guardCap = 4 - 0 - 1 = 3 for everyone
{
    const proctors = [
        { cin: 'A', teacher_name: 'Alpha' },
        { cin: 'B', teacher_name: 'Beta' },
        { cin: 'C', teacher_name: 'Gamma' },
        { cin: 'D', teacher_name: 'Delta' }
    ];
    const ctx = makeQuotaSandbox(proctors);
    const entries = [
        { level_name: 'L1', day: '1', period: 'صباحا', session: 'الحصة الأولى' },
        { level_name: 'L1', day: '2', period: 'صباحا', session: 'الحصة الأولى' }
    ];
    const rules = { proctorsPerRoom: 2, reservesPerSession: 1 };
    const loadState = {};
    const result = await ctx.buildPerTeacherQuota(entries, rules, loadState);

    eq(result.totalGuard, 12, 'scenario1: totalGuard = 12');
    eq(result.totalReserve, 2, 'scenario1: totalReserve = 2');
    eq(result.totalDuty, 0, 'scenario1: totalDuty = 0');
    eq(result.totalFinal, 14, 'scenario1: totalFinal = 14');
    eq(result.fairFinalCeil, 4, 'scenario1: fairFinalCeil = 4');
    eq(result.quotas.A.guardCap, 3, 'scenario1: guardCap = 3 for unloaded teacher');
    eq(result.quotas.A.guardCapHard, 4, 'scenario1: guardCapHard = 4');
    eq(result.quotas.A.reserveBudget, 1, 'scenario1: reserveBudget = 1');
}

// Scenario 2: teacher with pre-loaded duty gets a smaller guardCap
// 4 teachers, 1 entry, 3 rooms, 2 proctors/room → totalGuard = 6
// reservesPerSession = 0 → totalReserve = 0, reserveBudget = 0
// teacher A has duty = 2, others = 0 → totalDuty = 2, totalFinal = 8, ceil(8/4) = 2
// A.guardCap = max(0, 2 - 2 - 0) = 0
// B.guardCap = max(0, 2 - 0 - 0) = 2
{
    const proctors = [
        { cin: 'A', teacher_name: 'Alpha' },
        { cin: 'B', teacher_name: 'Beta' },
        { cin: 'C', teacher_name: 'Gamma' },
        { cin: 'D', teacher_name: 'Delta' }
    ];
    const ctx = makeQuotaSandbox(proctors);
    const entries = [
        { level_name: 'L1', day: '1', period: 'صباحا', session: 'الحصة الأولى' }
    ];
    const rules = { proctorsPerRoom: 2, reservesPerSession: 0 };
    const loadState = { A: { duty: 2 } };
    const result = await ctx.buildPerTeacherQuota(entries, rules, loadState);

    eq(result.totalDuty, 2, 'scenario2: totalDuty = 2 (teacher A has pre-loaded duty)');
    eq(result.totalFinal, 8, 'scenario2: totalFinal = 8');
    eq(result.fairFinalCeil, 2, 'scenario2: fairFinalCeil = 2');
    eq(result.quotas.A.guardCap, 0, 'scenario2: heavy-duty teacher gets guardCap = 0');
    eq(result.quotas.B.guardCap, 2, 'scenario2: free teacher gets guardCap = 2');
    eq(result.quotas.A.guardCapHard, 0, 'scenario2: heavy-duty hard cap also 0');
    eq(result.quotas.B.guardCapHard, 2, 'scenario2: free teacher hard cap = 2');
}

// Scenario 3: backward compatibility — old fields total/min/max still present
{
    const proctors = [
        { cin: 'A', teacher_name: 'Alpha' },
        { cin: 'B', teacher_name: 'Beta' }
    ];
    const ctx = makeQuotaSandbox(proctors);
    const entries = [
        { level_name: 'L1', day: '1', period: 'صباحا', session: 'الحصة الأولى' }
    ];
    const rules = { proctorsPerRoom: 2, reservesPerSession: 0 };
    const result = await ctx.buildPerTeacherQuota(entries, rules, {});

    eq(result.total, 6, 'scenario3 backcompat: total field present (= totalGuard)');
    eq(result.min, 3, 'scenario3 backcompat: min = floor(6/2)');
    eq(result.max, 3, 'scenario3 backcompat: max = ceil(6/2)');
    truthy(typeof result.quotas === 'object', 'scenario3: quotas map present');
}

// Scenario 4: edge case — zero teachers should not divide by zero
{
    const ctx = makeQuotaSandbox([]);
    const result = await ctx.buildPerTeacherQuota([], { proctorsPerRoom: 2, reservesPerSession: 0 }, {});
    eq(result.totalGuard, 0, 'scenario4: empty proctors → totalGuard = 0');
    eq(result.totalFinal, 0, 'scenario4: empty proctors → totalFinal = 0');
    truthy(Number.isFinite(result.fairFinalCeil), 'scenario4: no NaN/Infinity in fair ceil');
}

// =========== Summary ===========
console.log('\n' + '─'.repeat(40));
if (fail === 0) {
    console.log('\x1b[32m' + pass + ' passed\x1b[0m, 0 failed');
    process.exit(0);
} else {
    console.log('\x1b[32m' + pass + ' passed\x1b[0m, \x1b[31m' + fail + ' failed\x1b[0m');
    failures.forEach(f => console.log('  - ' + f.label + (f.detail ? ' (' + f.detail + ')' : '')));
    process.exit(1);
}
})();
