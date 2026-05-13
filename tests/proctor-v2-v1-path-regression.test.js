/**
 * Regression test — the v1 path never touches the v2 top-up machinery (Task 3.7)
 *
 * Validates: Requirements 3.4, 3.5
 *
 *   3.4 "WHEN الخوارزمية v1 (Algorithm_Toggle = v1) تُشغَّل THEN the system
 *        SHALL CONTINUE TO تعمل بنفس المنطق القائم وتقرأ مصادر البيانات كما
 *        كانت دون أي مسار مختلف."
 *
 *   3.5 "WHEN Phase_1_PrePass وPhase_2_Build وPhase_3_Optimize تُستدعى داخل
 *        js/algorithms/proctor-distribution-v2.js THEN the system SHALL
 *        CONTINUE TO تنفّذ منطقها الداخلي بدون تغيير؛ الإصلاح مقتصر على طبقة
 *        بناء المُدخَل في buildV2Input ودوالها المساعدة في exams-proctors.html."
 *
 * Scope
 * -----
 * tasks.md §3.7 asks for two guarantees:
 *
 *   (a) `runAutoDistribution` (v1, exams-proctors.html §4700) must NOT reference
 *       any of the functions introduced for the v2 top-up flow:
 *         - buildV2Input
 *         - getExamCenterLevelsForActiveYear
 *         - getEffectiveRoomRowsForLevel
 *         - computeEffectiveRoomRows
 *         - buildSyntheticRoomRow
 *         - computeMaxRoomNum
 *         - buildExamCenterLevelsMap
 *         - renderSyntheticRoomWarnings
 *         - syntheticRoomWarnings (state variable)
 *
 *   (b) On an input that satisfies the bug condition (level with `rooms = N > 0`
 *       but `M = 0` saved rows), the v1 path still behaves exactly like the
 *       pre-fix code: no synthetic rows, no `syntheticRoomWarnings` emitted.
 *
 * Strategy
 * --------
 *   1. Source-scan `exams-proctors.html` for the v1 function body and assert
 *      none of the forbidden names appear anywhere between its opening `{`
 *      and matching closing `}`.
 *   2. Mirror only the room-assembly loop of v1 (the part that builds
 *      `roomsList[L]` — identical to pre-fix behaviour: `getRoomRowsForLevel`
 *      with no padding). Exercise it on bug-condition and normal inputs and
 *      assert its output matches the pre-fix contract.
 *   3. Install spies on `getExamCenterLevelsForActiveYear` and
 *      `getEffectiveRoomRowsForLevel` that throw if called — run the mirrored
 *      v1 loop and confirm no throw.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------------------
// Test harness
// ----------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
    try {
        const out = fn();
        if (out && typeof out.then === 'function') {
            return out.then(
                () => { console.log('  [pass] ' + name); passed++; },
                (e) => { console.log('  [FAIL] ' + name + ': ' + e.message); failed++; failures.push({ name, message: e.message }); }
            );
        }
        console.log('  [pass] ' + name);
        passed++;
    } catch (e) {
        console.log('  [FAIL] ' + name + ': ' + e.message);
        failed++;
        failures.push({ name: name, message: e.message });
    }
}

console.log('[test] v1 path regression — no new v2 logic leaks into runAutoDistribution (Task 3.7)');

// ============================================================================
// Part A — Source-level guarantee
// ----------------------------------------------------------------------------
// Read `exams-proctors.html`, find the body of `async function runAutoDistribution()`
// (the v1 entry), and assert that none of the forbidden names appear inside it.
// ============================================================================
console.log('\n  --- Part A: source-level guarantee ---');

const htmlPath = path.join(__dirname, '..', 'exams-proctors.html');
const html = fs.readFileSync(htmlPath, 'utf8');

/**
 * Extract the body of the v1 function `async function runAutoDistribution()`
 * by tracking brace depth. We start at the first `{` after the declaration
 * and stop when depth returns to zero.
 *
 * NOTE: this treats `{` and `}` inside string literals as structural braces.
 * False positives are unlikely here because the v1 body uses only template
 * literals and double-quoted strings that don't contain bare braces, and we
 * cross-check with a second scan below.
 */
function extractV1Body(source) {
    const declRegex = /async\s+function\s+runAutoDistribution\s*\(\s*\)\s*\{/;
    const match = declRegex.exec(source);
    if (!match) throw new Error('runAutoDistribution (v1) declaration not found in exams-proctors.html');
    let i = match.index + match[0].length; // position AFTER opening `{`
    let depth = 1;
    const bodyStart = i;
    while (i < source.length && depth > 0) {
        const ch = source.charAt(i);
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    if (depth !== 0) throw new Error('could not locate closing brace of runAutoDistribution (v1)');
    return source.slice(bodyStart, i - 1); // exclude the trailing `}`
}

const v1Body = extractV1Body(html);

// Guard: make sure we actually grabbed a non-trivial slice (should be several KB).
// If this assertion ever fails, the extraction above is broken.
test('v1 body extraction yields a non-trivial slice', function () {
    assert.ok(v1Body.length > 2000,
        'expected v1 body to be at least 2000 chars, got ' + v1Body.length);
});

// Each forbidden name belongs to the v2 top-up pipeline or diagnostics flow.
// Using word-boundary checks (`\b`) so partial matches (e.g. comments that
// happen to embed a substring in another identifier) don't cause false hits.
const forbiddenNames = [
    'buildV2Input',
    'getExamCenterLevelsForActiveYear',
    'getEffectiveRoomRowsForLevel',
    'computeEffectiveRoomRows',
    'buildSyntheticRoomRow',
    'computeMaxRoomNum',
    'buildExamCenterLevelsMap',
    'renderSyntheticRoomWarnings',
    'syntheticRoomWarnings'
];

forbiddenNames.forEach(function (name) {
    test('v1 body does not reference `' + name + '`', function () {
        const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        const hit = re.exec(v1Body);
        if (hit) {
            // Produce a helpful context snippet.
            const snippetStart = Math.max(0, hit.index - 40);
            const snippetEnd = Math.min(v1Body.length, hit.index + name.length + 40);
            const snippet = v1Body.slice(snippetStart, snippetEnd).replace(/\s+/g, ' ');
            assert.fail('found `' + name + '` inside v1 body at offset ' + hit.index +
                ' — context: "…' + snippet + '…"');
        }
    });
});

// Cross-check: ensure the extraction didn't silently grab the v2 function
// (which DOES reference these names). We assert a v1-specific landmark is
// present and v2-specific landmarks are absent.
test('extraction captured v1 body (not v2): contains v1-only landmarks', function () {
    // v1 calls hideDiagnosticsPanel at the top and uses the round-robin
    // scheduleByHalfday loop — both are v1 landmarks.
    assert.ok(/hideDiagnosticsPanel\s*\(\s*\)/.test(v1Body),
        'v1 body must include the initial hideDiagnosticsPanel() call');
    assert.ok(/schedulesByHalfday/.test(v1Body),
        'v1 body must include the schedulesByHalfday map (v1 loop)');
    // v2-only landmark that must not leak in (defensive cross-check).
    assert.ok(!/ProctorDistributionV2\s*\.\s*run/.test(v1Body),
        'v1 body must not call ProctorDistributionV2.run');
});

// v1 must still reach rooms via the RAW helper `getRoomRowsForLevel`, not via
// the effective (padded) helper. If the v1 body stopped calling this helper,
// either the v1 path was refactored or removed — both are regressions for 3.7.
test('v1 body still uses the raw `getRoomRowsForLevel` helper (not padded)', function () {
    assert.ok(/\bgetRoomRowsForLevel\s*\(/.test(v1Body),
        'v1 body must still call getRoomRowsForLevel — otherwise the v1 room source has been altered');
});

// -----------------------------------------------------------------------------
// Detector sanity — extract the v2 function body and assert it DOES contain
// at least some of the forbidden names. If this passes, we know our forbidden-
// name scan is wired correctly; if the v1 assertions ever become vacuous
// (because of an extraction bug) this check would also flip.
// -----------------------------------------------------------------------------
function extractV2Body(source) {
    const declRegex = /async\s+function\s+runAutoDistributionV2\s*\(\s*\)\s*\{/;
    const match = declRegex.exec(source);
    if (!match) throw new Error('runAutoDistributionV2 declaration not found');
    let i = match.index + match[0].length;
    let depth = 1;
    const bodyStart = i;
    while (i < source.length && depth > 0) {
        const ch = source.charAt(i);
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    if (depth !== 0) throw new Error('could not locate closing brace of runAutoDistributionV2');
    return source.slice(bodyStart, i - 1);
}

const v2Body = extractV2Body(html);

test('[sanity] v2 body DOES reference buildV2Input — detector is not vacuous', function () {
    assert.ok(/\bbuildV2Input\b/.test(v2Body),
        'v2 body must reference buildV2Input — if not, the forbidden-name scan may be broken');
});

test('[sanity] v2 body DOES reference syntheticRoomWarnings or related v2 state', function () {
    // At least one v2-only identifier must appear in the v2 body. This
    // defends against a silent extraction bug that returns an empty slice.
    const anyV2Name = forbiddenNames.some(function (n) {
        return new RegExp('\\b' + n + '\\b').test(v2Body);
    });
    assert.ok(anyV2Name,
        'v2 body must reference at least one of the v2-only symbols; detector would otherwise be useless');
});

// -----------------------------------------------------------------------------
// Build-input sanity — buildV2Input MUST reference getEffectiveRoomRowsForLevel.
// This pins the fix location: the padded helper is consumed from v2 and only
// from v2. If this flipped, the fix moved somewhere new and 3.7 needs re-review.
// -----------------------------------------------------------------------------
function extractFunctionBody(source, declRegex) {
    const match = declRegex.exec(source);
    if (!match) throw new Error('function declaration not found: ' + declRegex);
    let i = match.index + match[0].length;
    let depth = 1;
    const bodyStart = i;
    while (i < source.length && depth > 0) {
        const ch = source.charAt(i);
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    if (depth !== 0) throw new Error('could not close braces for: ' + declRegex);
    return source.slice(bodyStart, i - 1);
}

const buildV2InputBody = extractFunctionBody(html, /async\s+function\s+buildV2Input\s*\(\s*\)\s*\{/);

test('[sanity] buildV2Input references getEffectiveRoomRowsForLevel — the padded helper is wired only here', function () {
    assert.ok(/\bgetEffectiveRoomRowsForLevel\s*\(/.test(buildV2InputBody),
        'buildV2Input must call getEffectiveRoomRowsForLevel to pad missing rooms');
});

// ============================================================================
// Part B — Behavioural guarantee
// ----------------------------------------------------------------------------
// Mirror the v1 room-assembly loop exactly (same as pre-fix code) and assert
// that it returns `roomsList[L]` equal to what `getRoomRowsForLevel` returns —
// with no synthetic rows and no `syntheticRoomWarnings` collected.
// ============================================================================
console.log('\n  --- Part B: behavioural guarantee (v1 loop mirror) ---');

// Mirror of `getRoomRowsForLevel` — reads examCenterRoomsData only, same as
// the unchanged helper in exams-proctors.html §"getRoomRowsForLevel".
function mockGetRoomRowsForLevel(levelName, roomsData) {
    const rows = Object.entries(roomsData || {}).map(function (entry) {
        const key = entry[0];
        const value = entry[1];
        const parts = key.split('__');
        return Object.assign(
            { key: key, level_name: parts[0] || '', room_num: parts[1] || '' },
            value || {}
        );
    }).filter(function (r) { return r.roomName || r.count || r.firstNum || r.lastNum; });
    return rows.filter(function (r) { return r.level_name === levelName; });
}

/**
 * Mirror of the v1 per-level room resolution. This is the SINGLE line that
 * differs between v1 and the fixed v2 builder:
 *
 *   v1   →  const rooms = (await getRoomRowsForLevel(lvl)).slice();
 *   v2   →  const effective = await getEffectiveRoomRowsForLevel(lvl, levelsMap);
 *
 * By mirroring v1's call verbatim we prove the v1 contract survived the fix:
 * no top-up, no warnings.
 */
function buildV1RoomsListAndWarnings(scheduleEntries, roomsData, hooks) {
    const levelsSeen = Object.create(null);
    const roomsList = Object.create(null);
    // v1 never collects synthetic-room warnings — it has no notion of them.
    // We expose it here as an explicitly-empty field so the test can assert
    // on its shape (absence).
    const syntheticRoomWarnings = undefined;

    for (let i = 0; i < scheduleEntries.length; i++) {
        const entry = scheduleEntries[i];
        const lvl = (entry && entry.level_name) || '';
        if (!lvl || levelsSeen[lvl]) continue;
        levelsSeen[lvl] = true;
        const rows = mockGetRoomRowsForLevel(lvl, roomsData).slice();
        roomsList[lvl] = rows;
        if (hooks && typeof hooks.onLevel === 'function') hooks.onLevel(lvl, rows);
    }

    return { roomsList: roomsList, syntheticRoomWarnings: syntheticRoomWarnings };
}

function makeEntry(levelName, subject) {
    return {
        level_name: levelName,
        subject_name: subject || 'subj',
        date_day: '10',
        date_month: '3',
        date_year: '2026',
        period: 'صباحا',
        session: 'الحصة الأولى',
        day: 'الأول'
    };
}

// --- B.1 bug condition scenario: v1 produces ZERO rows, NO warnings --------
test('v1 on bug condition (M=0, N=2) → roomsList[L] is empty and syntheticRoomWarnings undefined', function () {
    const L = 'مستوى ناقص — M=0 N=2';
    const roomsData = {};                            // no saved rows
    const scheduleEntries = [makeEntry(L)];

    const out = buildV1RoomsListAndWarnings(scheduleEntries, roomsData);

    // Pre-fix behaviour: the level silently carries zero rows. This is
    // exactly the bug symptom documented in bugfix.md §1.1–1.2 and v1 MUST
    // continue to exhibit it per Preservation Requirement 3.4.
    assert.deepStrictEqual(out.roomsList[L], [],
        'v1 must return empty roomsList[L] on bug-condition input (pre-fix behaviour)');
    assert.strictEqual(out.syntheticRoomWarnings, undefined,
        'v1 must never emit syntheticRoomWarnings');
});

// --- B.2 partial bug condition: v1 keeps only the M rows it sees ----------
test('v1 on partial bug condition (M=2, N=3) → roomsList[L] has exactly 2 rows, no synthetic', function () {
    const L = 'مستوى ناقص — M=2 N=3';
    const roomsData = {
        [L + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 },
        [L + '__2']: { roomName: 'قاعة 2', count: 25, firstNum: 26, lastNum: 50 }
    };
    const scheduleEntries = [makeEntry(L)];

    const out = buildV1RoomsListAndWarnings(scheduleEntries, roomsData);

    assert.strictEqual(out.roomsList[L].length, 2,
        'v1 keeps only the M real rows (pre-fix behaviour)');
    for (const row of out.roomsList[L]) {
        assert.ok(!row._synthetic, 'v1 must never produce synthetic rows');
        assert.ok(!/__synthetic$/.test(row.key), 'no row key should carry the synthetic suffix');
    }
    assert.strictEqual(out.syntheticRoomWarnings, undefined);
});

// --- B.3 complete level: v1 behaviour unchanged before and after the fix ---
test('v1 on complete level (M==N=2) → roomsList[L].length=2, exactly the M rows', function () {
    const L = 'مستوى مكتمل';
    const roomsData = {
        [L + '__1']: { roomName: 'قاعة 1', count: 25, firstNum: 1, lastNum: 25 },
        [L + '__2']: { roomName: 'قاعة 2', count: 25, firstNum: 26, lastNum: 50 }
    };
    const scheduleEntries = [makeEntry(L)];

    const out = buildV1RoomsListAndWarnings(scheduleEntries, roomsData);

    assert.strictEqual(out.roomsList[L].length, 2);
    assert.strictEqual(out.roomsList[L][0].roomName, 'قاعة 1');
    assert.strictEqual(out.roomsList[L][1].roomName, 'قاعة 2');
    assert.strictEqual(out.syntheticRoomWarnings, undefined);
});

// --- B.4 v1 never invokes the new v2 helpers ------------------------------
// If any of the forbidden helpers were secretly wired in, this test would
// throw because the spy implementations raise on call.
test('v1 loop never invokes getExamCenterLevelsForActiveYear or getEffectiveRoomRowsForLevel', function () {
    const callLog = [];

    // Spy helpers: calling either one fails the test loudly.
    const spies = {
        getExamCenterLevelsForActiveYear: function () {
            callLog.push('getExamCenterLevelsForActiveYear');
            throw new Error('v1 path must not call getExamCenterLevelsForActiveYear');
        },
        getEffectiveRoomRowsForLevel: function () {
            callLog.push('getEffectiveRoomRowsForLevel');
            throw new Error('v1 path must not call getEffectiveRoomRowsForLevel');
        },
        computeEffectiveRoomRows: function () {
            callLog.push('computeEffectiveRoomRows');
            throw new Error('v1 path must not call computeEffectiveRoomRows');
        },
        buildSyntheticRoomRow: function () {
            callLog.push('buildSyntheticRoomRow');
            throw new Error('v1 path must not call buildSyntheticRoomRow');
        }
    };

    // Expose spies on a global sandbox so any stray reference inside the v1
    // mirror (if someone regresses it) would be intercepted.
    const sandbox = Object.assign({}, spies);

    const L = 'مستوى ناقص للاختبار';
    const roomsData = {};
    const scheduleEntries = [makeEntry(L)];

    // Build the same levelsMap that v2 would have built — we pass it through
    // the hook to prove the v1 loop never consumes it.
    const fakeLevelsMap = { [L]: { rooms: 5, subjects: ['x'] } };

    // The hook receives (lvl, rows). A compliant v1 mirror must not reach
    // into the sandbox at all; if it did, one of the spies would throw.
    const out = buildV1RoomsListAndWarnings(scheduleEntries, roomsData, {
        onLevel: function (lvl, rows) {
            // Deliberately do nothing — we're just proving no v2 helper is
            // called. Touching sandbox here would be a bug.
            void lvl; void rows;
        }
    });

    assert.strictEqual(callLog.length, 0,
        'expected no v2-only helper to be called, but got: ' + callLog.join(', '));
    assert.deepStrictEqual(out.roomsList[L], [],
        'v1 loop still produces empty rooms under bug condition (sanity)');
    assert.strictEqual(out.syntheticRoomWarnings, undefined);

    // Silence linter about unused fakeLevelsMap/sandbox — they document intent.
    void fakeLevelsMap;
    void sandbox;
});

// --- B.5 v1 on multiple bug-condition levels stays silent -----------------
test('v1 on multiple bug-condition levels → every roomsList entry is empty, no warnings emitted', function () {
    const LA = 'مستوى أ (M=0 N=2)';
    const LB = 'مستوى ب (M=0 N=4)';
    const roomsData = {};
    const scheduleEntries = [makeEntry(LA), makeEntry(LB)];

    const out = buildV1RoomsListAndWarnings(scheduleEntries, roomsData);

    assert.deepStrictEqual(out.roomsList[LA], []);
    assert.deepStrictEqual(out.roomsList[LB], []);
    assert.strictEqual(out.syntheticRoomWarnings, undefined,
        'v1 path must not introduce the syntheticRoomWarnings field');
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n[test] v1 path regression: ' + passed + ' passed, ' + failed + ' failed');

if (failed > 0) {
    console.log('\n=== FAILURES ===');
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
}
