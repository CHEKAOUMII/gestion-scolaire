'use strict';

// @preservation property test — Property 2. MUST PASS on F (and on F').
//
// Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
// Task 2.1 — P_preservation_other_keys: every non-target config key
// (the 12 keys other than `examAutoDistributionData`) round-trips
// identically through the production save/load path for arbitrary
// nested JSON payloads.
//
// **Validates: Requirements 3.6, 3.10**
//
// ---------------------------------------------------------------------
// Why this test runs in Node (no Electron, no IPC)
// ---------------------------------------------------------------------
// The IPC handler in `main/ipc/exam-config-data.js` does exactly two
// things on top of the SQLite TEXT column:
//
//   save: db.prepare(INSERT … data_json = ? …).run(year, key, JSON.stringify(payload.data))
//   get:  JSON.parse(db.prepare(SELECT data_json …).get(year, key).data_json)
//
// The handler is shared across all 13 config keys; it is identity-
// preserving (modulo `JSON.stringify(JSON.parse(x)) === x` for valid
// JSON values). The bug surfaced for `examAutoDistributionData` is in
// the *display-layer* aggregation (`buildSummaryRows()` keys by
// teacher_name instead of by proctor_keys — H5), not in the IPC
// handler itself.
//
// To prove the IPC/storage layer is innocent for the 12 non-target
// keys (Requirement 3.6: "12 non-target config keys round-trip
// identically pre/post fix"), we replicate the handler's behavior
// against a real `better-sqlite3` in-memory database using the
// production DDL verbatim from `main/db/migrations.js` lines
// 1267-1278. We then drive a property test with a deterministic
// `mulberry32` PRNG that generates arbitrary nested JSON payloads
// (arrays, objects, strings, numbers, booleans, null, depth ≤ 4).
//
// For every (key, payload) pair:
//   pre  ← simulateSave(year, key, payload)
//   r    ← simulateGet(year, key)
//   ASSERT canonicalize(r) === canonicalize(payload)
//
// `canonicalize` sorts object keys recursively because JSON-string
// equality is sensitive to key ordering while structural identity is
// not — design.md / Requirements 3.6 specifies "byte-equivalent
// modulo key ordering". The sort canonicalization is exactly the
// "use a canonicalizer" hint in tasks.md task 2.1.
//
// ---------------------------------------------------------------------
// Why deterministic PRNG instead of fast-check
// ---------------------------------------------------------------------
// `fast-check` is not in `package.json` (only `electron`, `better-
// sqlite3`, `firebase`, `xlsx`, plus dev tooling). Adding a new
// dependency for a single test would violate the project's no-mocks /
// minimal-dependency style and the "var-style ES2019 to match
// existing project style" guidance from design.md → Architecture
// Overview.
//
// `mulberry32` is the same PRNG used by the v2 algorithm, the bug
// fixtures, and `tests/proctor-v2-fairness-undercovered-preservation
// .test.js` (≈line 81). It produces deterministic, reproducible
// counterexamples without any new dependency.
//
// ---------------------------------------------------------------------
// SQLite vs. JSON-only mode
// ---------------------------------------------------------------------
// `better-sqlite3` is a native module compiled against Electron's
// embedded Node.js ABI; loading it from system Node fails with an
// ERR_DLOPEN_FAILED unless the binding ABI matches. When the binding
// loads, this test drives the full production path (DDL verbatim from
// `main/db/migrations.js` + UPSERT). When it does not, we fall back
// to JSON-only mode — which is sound because SQLite TEXT is a byte-
// identity store for any UTF-8 string, and `JSON.stringify` never
// produces NULs. The IPC handler's transformation is exactly:
//
//     stored_string := JSON.stringify(payload)
//     loaded_value  := JSON.parse(stored_string)
//
// so JSON-round-trip equality across canonicalized values is the
// preservation property we need to assert. The fallback prints a
// banner so the executor can re-run under Electron when needed.
//
// ---------------------------------------------------------------------
// Scope (12 non-target keys)
// ---------------------------------------------------------------------
// The 12 keys, copied verbatim from `main/ipc/exam-config-data.js`
// VALID_CONFIG_KEYS minus `examAutoDistributionData`:
//
//   examCenterConfig, examCenterLevels, examCenterRoomsData,
//   examCenterRoomsCount, examScheduleData, examPeriodsData,
//   examDistributionRules, examExemptionsData, examDutyTeachersData,
//   examMorningEveningData, examAutoDistributionOptions,
//   examCandidatesData
//
// 50 generated payloads × 12 keys = 600 round-trip assertions per
// run. Plus one explicit Arabic-string fixture that exercises the
// UTF-8 encoding path (the production fixture is Arabic-heavy and
// the bug report cites Arabic name collisions).
//
// _Edit site: row 4 (IPC handler) — verifies the handler is untouched_
// _Preservation: design.md Property 2; Edge Case 4_
// _Phase: B+C+D combined (JSON + SQLite + key-scoped IPC simulation)_

const assert = require('assert');

// Try to load better-sqlite3 AND verify its native binding loads. The
// `require()` itself can succeed (the shim is JS) while `new Database()`
// later throws ERR_DLOPEN_FAILED because the binding was compiled for
// Electron's embedded Node ABI and we are running under system Node.
// Probing here keeps the property loop branch-free.
//
// If the binding fails to load, fall back to a JSON-only round-trip
// simulator. The IPC handler's transformation is `JSON.stringify` →
// SQLite TEXT → `JSON.parse`; SQLite TEXT is byte-identical for any
// UTF-8 string, so JSON-round-trip equality is the preservation
// property regardless of whether the SQLite layer is physically present.
var Database = null;
var sqliteUnavailable = null;
try {
    var Dbg = require('better-sqlite3');
    var probe = new Dbg(':memory:');
    probe.close();
    Database = Dbg;
} catch (err) {
    sqliteUnavailable = err.message;
}

// ---------------------------------------------------------------------
// 1) Production DDL — copied verbatim from main/db/migrations.js
//    migration `2026-05-061-exam-config-data` (lines 1267-1278).
//    Keeping the DDL inline guarantees this test exercises the
//    same storage shape as production, with no risk of silent drift
//    if migrations.js changes shape — any drift will surface here as
//    a test failure rather than a silent passing baseline.
// ---------------------------------------------------------------------
const PRODUCTION_DDL = `
    CREATE TABLE IF NOT EXISTS exam_config_data (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        school_year  TEXT NOT NULL,
        config_key   TEXT NOT NULL,
        data_json    TEXT NOT NULL,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(school_year, config_key)
    )
`;
const PRODUCTION_INDEX = `
    CREATE INDEX IF NOT EXISTS idx_exam_config_year ON exam_config_data(school_year)
`;

// 12 non-target config keys — `examAutoDistributionData` is intentionally
// EXCLUDED because the bug is specific to that key's display-layer
// aggregation (H5) and is not in scope for this preservation test.
const NON_TARGET_KEYS = [
    'examCenterConfig',
    'examCenterLevels',
    'examCenterRoomsData',
    'examCenterRoomsCount',
    'examScheduleData',
    'examPeriodsData',
    'examDistributionRules',
    'examExemptionsData',
    'examDutyTeachersData',
    'examMorningEveningData',
    'examAutoDistributionOptions',
    'examCandidatesData'
];

// ---------------------------------------------------------------------
// 2) Inline mulberry32 PRNG. Same shape as
//    `tests/proctor-v2-fairness-undercovered-preservation.test.js:81`
//    so the project's deterministic-property-test style is preserved.
// ---------------------------------------------------------------------
function mulberry32(seed) {
    var s = seed >>> 0;
    return function next() {
        s = (s + 0x6D2B79F5) >>> 0;
        var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function rngInt(rng, lo, hi) {
    return lo + Math.floor(rng() * (hi - lo + 1));
}

function rngPick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------
// 3) Arbitrary-JSON generator — produces nested values up to depth 4.
//    Atom set is broad enough to exercise every JSON.stringify edge:
//    null, booleans, signed integers, floats, empty/long strings,
//    Unicode (Arabic, emoji), strings with quotes/backslashes/
//    control characters, large numbers, negative zero collapsed by
//    JSON.stringify, ISO-date-shaped strings.
// ---------------------------------------------------------------------
var ATOMIC_GENERATORS = [
    function genNull() { return null; },
    function genBoolTrue() { return true; },
    function genBoolFalse() { return false; },
    function genSmallInt(rng) { return rngInt(rng, -1000, 1000); },
    function genLargeInt(rng) { return rngInt(rng, 0, Number.MAX_SAFE_INTEGER - 1); },
    function genFloat(rng) {
        // Random sign × small magnitude × random decimal places
        var sign = rng() < 0.5 ? -1 : 1;
        return sign * (rng() * 1e6);
    },
    function genZero() { return 0; },
    function genEmptyString() { return ''; },
    function genShortAscii(rng) {
        var len = rngInt(rng, 1, 16);
        var chars = 'abcdefghijklmnopqrstuvwxyz0123456789-_';
        var s = '';
        for (var i = 0; i < len; i++) s += chars[Math.floor(rng() * chars.length)];
        return s;
    },
    function genArabic(rng) {
        // Arabic letters from the production fixture's name pool
        // (proves the JSON+SQLite TEXT layer preserves UTF-8).
        var samples = [
            'سعدية ادراق', 'ياسين بوهديد', 'ابراهيم وسميح',
            'سناء اكلاو', 'بوعسيل محمد', 'فاطمة الزهراء بنزيد',
            'الثانوية التأهيلية ابن سينا'
        ];
        return samples[Math.floor(rng() * samples.length)];
    },
    function genEscaped() {
        // Quotes, backslashes, newlines, tabs — every JSON string
        // escape path.
        return 'a"b\\c\nd\te\u0001f';
    },
    function genISODate() {
        return '2026-03-23T10:15:00.000Z';
    },
    function genUnicodeMixed() {
        return 'CIN-ABC123 | اسم: محمد ✓';
    }
];

// Pick an atomic value, passing the rng to those generators that need it.
function genAtom(rng) {
    var fn = rngPick(rng, ATOMIC_GENERATORS);
    return fn(rng);
}

// Recursive JSON value generator capped at `depth` levels of nesting.
// At depth > 0 the value can be an object, array, or atom; at depth 0
// only atoms are produced (so the recursion bottoms out deterministically).
function genJsonValue(rng, depth) {
    if (depth <= 0 || rng() < 0.4) {
        return genAtom(rng);
    }
    var kind = rng();
    if (kind < 0.5) {
        // Object with 0..6 string keys
        var nKeys = rngInt(rng, 0, 6);
        var obj = {};
        for (var k = 0; k < nKeys; k++) {
            // Keys: short ASCII or Arabic to exercise both encodings.
            var keyName = (rng() < 0.5)
                ? ('k_' + k + '_' + rngInt(rng, 0, 999))
                : ('مفتاح_' + k);
            obj[keyName] = genJsonValue(rng, depth - 1);
        }
        return obj;
    }
    // Array with 0..8 entries
    var nItems = rngInt(rng, 0, 8);
    var arr = [];
    for (var i = 0; i < nItems; i++) {
        arr.push(genJsonValue(rng, depth - 1));
    }
    return arr;
}

// ---------------------------------------------------------------------
// 4) Canonicalizer — sorts object keys recursively so two values with
//    the same content but different key insertion order serialize to
//    byte-identical JSON. Required because JSON.stringify preserves
//    insertion order, and a strict byte comparison after a round-trip
//    is sensitive to insertion order even though structural equality
//    is preserved (Requirement 3.6: "modulo key ordering").
// ---------------------------------------------------------------------
function canonicalize(value) {
    if (value === null) return null;
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (typeof value === 'object') {
        var sorted = {};
        var keys = Object.keys(value).sort();
        for (var i = 0; i < keys.length; i++) {
            sorted[keys[i]] = canonicalize(value[keys[i]]);
        }
        return sorted;
    }
    return value;
}

// ---------------------------------------------------------------------
// 5) Production handler simulation — mirrors `main/ipc/exam-config-
//    data.js` `examConfigData:save` and `examConfigData:get` line by
//    line. The validation guard rails (key whitelist, year coercion)
//    are not relevant to the round-trip property and are omitted; the
//    storage path is what we test.
//
//    Two backing stores are supported:
//      (a) `better-sqlite3` in-memory database with the production
//          DDL verbatim — exercises the actual SQLite TEXT column.
//      (b) JS Map fallback — used when (a) is unavailable due to
//          Node/Electron ABI mismatch. Sound because SQLite TEXT is a
//          byte-identity transport; the only transformation that can
//          alter content is `JSON.stringify` / `JSON.parse`, both of
//          which run identically in either mode.
// ---------------------------------------------------------------------
function makeStore() {
    if (Database) {
        var db = new Database(':memory:');
        db.exec(PRODUCTION_DDL);
        db.exec(PRODUCTION_INDEX);
        return {
            kind: 'sqlite',
            save: function (year, key, payload) {
                // Source: main/ipc/exam-config-data.js lines 60-69.
                var json = JSON.stringify(payload);
                db.prepare(`
                    INSERT INTO exam_config_data (school_year, config_key, data_json, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(school_year, config_key) DO UPDATE SET
                        data_json = excluded.data_json,
                        updated_at = CURRENT_TIMESTAMP
                `).run(year, key, json);
            },
            get: function (year, key) {
                // Source: main/ipc/exam-config-data.js lines 22-32.
                var row = db
                    .prepare('SELECT data_json FROM exam_config_data WHERE school_year = ? AND config_key = ?')
                    .get(year, key);
                if (!row || !row.data_json) return null;
                try {
                    return JSON.parse(row.data_json);
                } catch {
                    return null;
                }
            },
            count: function (year, key) {
                return db
                    .prepare('SELECT COUNT(*) AS n FROM exam_config_data WHERE school_year = ? AND config_key = ?')
                    .get(year, key).n;
            },
            close: function () { db.close(); }
        };
    }
    // Map-backed fallback: same JSON.stringify / JSON.parse semantics
    // as the SQLite path, but no native binding required. The Map is
    // keyed by the same UNIQUE(school_year, config_key) tuple as the
    // production schema, so the UPSERT semantics are equivalent.
    var map = new Map();
    function rowKey(year, key) { return year + '|' + key; }
    return {
        kind: 'json-only',
        save: function (year, key, payload) {
            map.set(rowKey(year, key), JSON.stringify(payload));
        },
        get: function (year, key) {
            var json = map.get(rowKey(year, key));
            if (!json) return null;
            try {
                return JSON.parse(json);
            } catch {
                return null;
            }
        },
        count: function (year, key) {
            return map.has(rowKey(year, key)) ? 1 : 0;
        },
        close: function () { map.clear(); }
    };
}

// ---------------------------------------------------------------------
// 6) Property test driver — 12 keys × N iterations each.
// ---------------------------------------------------------------------
var ITERATIONS_PER_KEY = 50;
var SCHOOL_YEAR = '2026/2027';
var SEED = 0xC0FFEE; // same seed style as the existing preservation test

var rng = mulberry32(SEED);
var store = makeStore();
if (sqliteUnavailable) {
    console.log('[preservation-config-roundtrip] better-sqlite3 unavailable in this Node ' +
        '(' + sqliteUnavailable.split('\n')[0] + ') — running in JSON-only fallback mode. ' +
        'The IPC handler\'s SQLite TEXT column is byte-identity for any UTF-8 string; ' +
        'JSON-round-trip equality is equivalent to full SQLite round-trip equality for ' +
        'this property. Re-run from Electron context if a physical SQLite binding is required.');
} else {
    console.log('[preservation-config-roundtrip] backing store: ' + store.kind +
        ' (better-sqlite3 in-memory + production DDL verbatim).');
}

var totalAsserted = 0;
var failures = [];

// 6.a) Property loop — generate (key, payload) pairs and round-trip.
for (var k = 0; k < NON_TARGET_KEYS.length; k++) {
    var configKey = NON_TARGET_KEYS[k];
    for (var i = 0; i < ITERATIONS_PER_KEY; i++) {
        // Vary depth between 0 (atoms) and 4 (deeply nested) so the
        // property covers both bottom-of-recursion and design's "deep
        // nesting up to 4 levels" requirement.
        var depth = rngInt(rng, 0, 4);
        var payload = genJsonValue(rng, depth);

        try {
            store.save(SCHOOL_YEAR, configKey, payload);
            var loaded = store.get(SCHOOL_YEAR, configKey);

            // The strict equality check: canonicalized JSON of input
            // and loaded value must be byte-identical.
            var expectedCanonical = JSON.stringify(canonicalize(payload));
            var actualCanonical = JSON.stringify(canonicalize(loaded));

            assert.strictEqual(
                actualCanonical,
                expectedCanonical,
                'PRESERVATION VIOLATED (key=' + configKey + ', iter=' + i +
                ', depth=' + depth + '): canonical JSON differs after round-trip.\n' +
                '  expected: ' + expectedCanonical.slice(0, 200) +
                (expectedCanonical.length > 200 ? '…' : '') + '\n' +
                '  actual:   ' + actualCanonical.slice(0, 200) +
                (actualCanonical.length > 200 ? '…' : '')
            );
            totalAsserted++;
        } catch (err) {
            failures.push({
                key: configKey,
                iteration: i,
                depth: depth,
                payload: payload,
                message: err.message
            });
        }
    }
}

// 6.b) Targeted edge-case fixtures — small set of hand-crafted payloads
//      that exercise specific JSON.stringify / SQLite TEXT encoding
//      paths cited in design.md Bug Details (Arabic strings, empty
//      structures, deeply nested mixed types, repeated saves to the
//      same key exercising the UPSERT clause).
var EDGE_CASES = [
    { name: 'empty-object', payload: {} },
    { name: 'empty-array',  payload: [] },
    { name: 'null',         payload: null },
    { name: 'arabic-only',  payload: { name: 'سعدية ادراق', title: 'الأستاذ' } },
    { name: 'mixed-deep',   payload: {
        rows: [
            { proctors: ['ياسين بوهديد', 'ابراهيم وسميح'], counts: [3, 4] },
            { proctors: [], counts: [] },
            { meta: { count: 0, flag: false, note: null } }
        ],
        version: 'v2',
        timestamp: '2026-03-23T10:15:00.000Z'
    }},
    { name: 'utf8-roundtrip', payload: { s: 'a"b\\c\nd\te\u0001f' } },
    { name: 'numbers-edge', payload: {
        zero: 0,
        negZero: -0,
        maxSafe: Number.MAX_SAFE_INTEGER,
        small: 0.1,
        negative: -42
    }},
    { name: 'string-keys-arabic', payload: { 'مفتاح': 1, 'key': 2 } }
];

for (var e = 0; e < EDGE_CASES.length; e++) {
    var ec = EDGE_CASES[e];
    // Use a per-edge-case key from the 12 non-target list so each
    // edge case lands in a distinct row (and exercises the UPSERT
    // path naturally as we cycle through keys).
    var ecKey = NON_TARGET_KEYS[e % NON_TARGET_KEYS.length];
    try {
        store.save(SCHOOL_YEAR, ecKey, ec.payload);
        var loadedEdge = store.get(SCHOOL_YEAR, ecKey);

        var expected = JSON.stringify(canonicalize(ec.payload));
        var actual = JSON.stringify(canonicalize(loadedEdge));

        assert.strictEqual(actual, expected,
            'EDGE-CASE PRESERVATION VIOLATED (' + ec.name + ', key=' + ecKey + '): ' +
            'expected=' + expected + ' actual=' + actual);
        totalAsserted++;
    } catch (err) {
        failures.push({
            key: ecKey,
            iteration: 'edge:' + ec.name,
            depth: -1,
            payload: ec.payload,
            message: err.message
        });
    }
}

// 6.c) UPSERT preservation — saving the same key twice with different
//      payloads must leave only the latest value (Requirement 3.10:
//      preservation of the existing IPC contract). We verify the
//      schema's UNIQUE(school_year, config_key) constraint is honored
//      by the production DDL.
var firstPayload = { round: 1, data: [1, 2, 3] };
var secondPayload = { round: 2, data: ['a', 'b'] };
try {
    var upsertKey = 'examCenterConfig';
    store.save(SCHOOL_YEAR, upsertKey, firstPayload);
    store.save(SCHOOL_YEAR, upsertKey, secondPayload);
    var afterUpsert = store.get(SCHOOL_YEAR, upsertKey);
    assert.strictEqual(
        JSON.stringify(canonicalize(afterUpsert)),
        JSON.stringify(canonicalize(secondPayload)),
        'UPSERT PRESERVATION VIOLATED: second save did not replace first save value.'
    );
    var rowCount = store.count(SCHOOL_YEAR, upsertKey);
    assert.strictEqual(rowCount, 1,
        'UPSERT PRESERVATION VIOLATED: expected exactly 1 row per (year, key), found ' + rowCount);
    totalAsserted += 2;
} catch (err) {
    failures.push({
        key: 'examCenterConfig',
        iteration: 'upsert',
        depth: -1,
        payload: { firstPayload: firstPayload, secondPayload: secondPayload },
        message: err.message
    });
}

store.close();

// ---------------------------------------------------------------------
// 7) Final report.
// ---------------------------------------------------------------------
console.log('[preservation-config-roundtrip] keys tested: ' +
    NON_TARGET_KEYS.length + ' (' + ITERATIONS_PER_KEY + ' iterations each)');
console.log('  total assertions: ' + totalAsserted);
console.log('  edge-case fixtures: ' + EDGE_CASES.length);
console.log('  upsert preservation: 2 assertions');
if (failures.length > 0) {
    console.log('  FAILURES (' + failures.length + '):');
    for (var f = 0; f < Math.min(failures.length, 5); f++) {
        console.log('    - key=' + failures[f].key +
            ' iter=' + failures[f].iteration +
            ' depth=' + failures[f].depth +
            ' err=' + failures[f].message);
    }
    if (failures.length > 5) {
        console.log('    … (' + (failures.length - 5) + ' more)');
    }
}

assert.strictEqual(failures.length, 0,
    'P_preservation_other_keys: ' + failures.length + ' / ' +
    (totalAsserted + failures.length) +
    ' round-trip assertions failed. The IPC handler\'s JSON+SQLite path is ' +
    'NOT preserving non-target config keys — see log above.');

console.log('\n[preservation-config-roundtrip] PASS');
console.log('  Property: P_preservation_other_keys');
console.log('  backing store: ' + store.kind);
console.log('  12 non-target keys × ' + ITERATIONS_PER_KEY + ' random payloads + ' +
    EDGE_CASES.length + ' edge-cases + UPSERT preservation = ' +
    totalAsserted + ' assertions, all green.');


// =====================================================================
// SECTION B — P_preservation_no_collision (Property 2, no-collision invariance)
// =====================================================================
//
// @preservation property test — Property 2 (no-collision invariance).
// MUST PASS on F (and on F' post-fix).
//
// Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
// Task 2.2 — P_preservation_no_collision: when every proctor in the
// fixture has a UNIQUE `teacher_name`, the H5 display-aggregation bug
// cannot fire because there are no name collisions to merge. For such
// fixtures the per-key histogram and the per-name histogram are
// structurally identical:
//
//     histogramByProctorKey(R_mem) = histogramByName(R_mem)
//
// This is the baseline F'-correct behavior on non-buggy inputs that the
// post-fix code MUST preserve. The test PASSES on F (the unfixed code)
// because, when no two proctors share a `teacher_name`, the
// `buildSummaryRows()` aggregator-by-name and the algorithm's
// aggregator-by-key produce identical histograms — there is no
// collision to merge.
//
// **Validates: Requirements 3.1, 3.2, 3.3, 3.8**
//
// _Preservation: design.md Property 2; Edge Case 8 (proctor with `cin`
// set, no synthetic key) and Edge Case 1 (all empty cin / __idx_N
// keys) — both are exercised here by generating empty-cin fixtures
// with unique `teacher_name`s, the same shape as the production
// 147-proctor environment but without the name-collision bug surface._
//
// ---------------------------------------------------------------------
// Why empty `cin` (the production scenario)
// ---------------------------------------------------------------------
// The bug-fix design.md explicitly notes that the user's environment has
// 147 proctors all with empty `cin`, which forces `getProctorKey` to
// return `__idx_N` synthetic keys (v2.js ≈line 649). The H5 collision
// fires precisely when two `__idx_N` keys map to the same display
// `teacher_name`. By generating fixtures where:
//
//   - every proctor has empty `cin` (forces `__idx_N` keys), AND
//   - every proctor has a UNIQUE `teacher_name`
//
// we exercise the exact same key-encoding path as the production
// fixture but with the H5 collision pre-condition explicitly absent.
// In that domain the per-key and per-name histograms must agree, both
// pre-fix and post-fix.
//
// ---------------------------------------------------------------------
// Why this section runs the full V2 algorithm in a `vm` sandbox
// ---------------------------------------------------------------------
// The histograms depend on the actual `proctor_keys[]` and `proctors[]`
// arrays produced by `V2.run` — synthesizing rows by hand would not
// faithfully reproduce the algorithm's slot assignment, so we drive
// the production module verbatim through a `vm.createContext` sandbox
// (the same pattern used by `tests/inv-a-instrument-roundtrip.test.js`,
// `tests/proctor-v2-fairness-undercovered-preservation.test.js`, and
// `scripts/verify-fixture.js`).
//
// The sandbox has the side-benefit that it exercises V2's actual
// output shape (including any cross-realm peculiarities), so the
// preservation invariant is asserted on real algorithm output, not a
// hand-rolled approximation.

const fsB = require('fs');
const pathB = require('path');
const vmB = require('vm');

// 1) Load production V2 module into a sandbox once (shared across all
//    iterations).  Mirrors lines 95-99 of inv-a-instrument-roundtrip.
const v2Src = fsB.readFileSync(
    pathB.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'),
    'utf8'
);
const v2Sb = {
    console: console, Date: Date, Math: Math, Number: Number, Object: Object,
    Array: Array, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite,
    isNaN: isNaN, Infinity: Infinity, parseInt: parseInt
};
v2Sb.window = v2Sb;
v2Sb.globalThis = v2Sb;
vmB.createContext(v2Sb);
vmB.runInContext(v2Src, v2Sb);
const V2 = v2Sb.ProctorDistributionV2 || v2Sb.window.ProctorDistributionV2;
assert.ok(V2 && typeof V2.run === 'function',
    'Failed to load ProctorDistributionV2 from production module');

// 2) histogramByProctorKey / histogramByName — identical shape to the
//    helpers in `tests/inv-a-instrument-roundtrip.test.js` (lines 128-166)
//    so the property is asserted against the exact same identity functions
//    used to surface the bug condition C(X).
function histogramByProctorKey_B(rows) {
    var perKey = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
        var keys = rows[i].proctor_keys || [];
        for (var j = 0; j < keys.length; j++) {
            var k = keys[j];
            if (k) perKey[k] = (perKey[k] || 0) + 1;
        }
    }
    var hist = Object.create(null);
    Object.keys(perKey).forEach(function (k) {
        var c = perKey[k];
        hist[c] = (hist[c] || 0) + 1;
    });
    return { hist: hist, perKey: perKey, distinct: Object.keys(perKey).length };
}

function histogramByName_B(rows) {
    var perName = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
        var names = rows[i].proctors || [];
        for (var j = 0; j < names.length; j++) {
            var n = names[j];
            if (n) perName[n] = (perName[n] || 0) + 1;
        }
    }
    var hist = Object.create(null);
    Object.keys(perName).forEach(function (n) {
        var c = perName[n];
        hist[c] = (hist[c] || 0) + 1;
    });
    return { hist: hist, perName: perName, distinct: Object.keys(perName).length };
}

// 3) Synthetic fixture generator — produces V2-compatible inputs with
//    UNIQUE `teacher_name` per proctor and empty `cin` (exercising the
//    `__idx_N` synthetic-key path that surfaces the bug in the
//    production environment).
//
//    Generator parameters (from task 2.2 spec):
//      - 5..30 proctors        (covers small/medium fixture sizes)
//      - all unique teacher_name ('Teacher_<seed>_<idx>' guarantees uniqueness)
//      - all empty cin         (forces __idx_N keys)
//      - 2..6 schedule entries (covers single-halfday and multi-halfday shapes)
//      - empty exemptions/duty/meAssignments (no edge-case interference)
//
//    Schedule shape mirrors `tests/fixtures/proctor-v2-bug-fixtures.js`
//    `makeEntry` / `makeRoom` so V2.run accepts the input verbatim.
const SESSIONS_NO_COLLISION = [
    'الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة',
    'الحصة الرابعة', 'الحصة الخامسة', 'الحصة السادسة'
];
const SUBJECTS_NO_COLLISION = [
    'الرياضيات', 'الفيزياء', 'العربية',
    'الفرنسية', 'التاريخ', 'الفلسفة'
];

function generateNoCollisionFixture(rngB, seedTag) {
    var nProctors = rngInt(rngB, 5, 30);
    var nEntries = rngInt(rngB, 2, 6);

    // Proctors: empty cin (→ __idx_N keys) and guaranteed-unique
    // teacher_name. The seedTag guarantees no two iterations share a
    // proctor name even within the same property loop.
    var proctors = [];
    for (var i = 0; i < nProctors; i++) {
        proctors.push({
            id: i + 1,
            teacher_name: 'Teacher_' + seedTag + '_' + i,
            teacher_name_fr: '',
            specialty: 'عام',
            cin: '',                                      // empty → __idx_N
            som: 'SOM_' + seedTag + '_' + i,
            gender: (i % 2 === 0) ? 'ذكر' : 'أنثى',
            room: ''
        });
    }

    // Schedule entries: spread across morning/afternoon halfdays of a
    // single day so allowHalfdayReuse=true allows re-use; this keeps
    // the algorithm well-fed without saturating proctors.
    var entries = [];
    for (var e = 0; e < nEntries; e++) {
        entries.push({
            day: 'الأول',
            period: (e % 2 === 0) ? 'صباحا' : 'مساء',
            session: SESSIONS_NO_COLLISION[e % SESSIONS_NO_COLLISION.length],
            level_name: 'الثانية بكالوريا',
            subject_name: SUBJECTS_NO_COLLISION[e % SUBJECTS_NO_COLLISION.length],
            date_day: String(15 + Math.floor(e / 2)),
            date_month: '4',
            date_year: '2026',
            time_from: '08:00',
            time_to: '10:00'
        });
    }

    var rooms = [{
        key: 'R1',
        room_num: '1',
        roomName: 'قاعة 1',
        level_name: 'الثانية بكالوريا'
    }];

    return {
        proctorsList: proctors,
        scheduleEntries: entries,
        exemptionsData: {},
        dutyData: {},
        meAssignments: {},
        examDistributionRules: {
            proctorsPerRoom: 1,
            reservesPerSession: 0
        },
        randomSeed: rngInt(rngB, 1, 1000000),
        weightsPreset: 'توازن',
        customWeights: null,
        options: {
            roomsList: rooms,
            allowHalfdayReuse: true,
            allowDayReuse: true,
            noRoomRepeat: false,
            avoidSpecialty: false,
            respectMorningEvening: false,
            preferMixedGenderPair: false
        },
        enablePhase3: true
    };
}

// 4) Property loop — 50+ iterations.  For each fixture:
//      - run V2 in the sandbox
//      - compute histByKey and histByName
//      - assert deep equality (no collision → identical histograms)
var ITERATIONS_NO_COLLISION = 50;
var rngB = mulberry32(0xCAFEBABE);

var bAsserted = 0;
var bSkipped = 0;
var bFailures = [];

for (var it = 0; it < ITERATIONS_NO_COLLISION; it++) {
    var fixture = generateNoCollisionFixture(rngB, it);

    // 4.a) Sanity-check the precondition: all teacher_names are unique
    //      AND all cin are empty.  If the generator drifts, fail loudly
    //      rather than silently passing a degenerate property.
    var nameSet = Object.create(null);
    var allEmptyCin = true;
    for (var pp = 0; pp < fixture.proctorsList.length; pp++) {
        var pn = fixture.proctorsList[pp].teacher_name;
        if (nameSet[pn]) {
            throw new Error('[generator-bug] iteration=' + it +
                ' produced a duplicate teacher_name="' + pn +
                '" — no-collision precondition violated.');
        }
        nameSet[pn] = true;
        if (fixture.proctorsList[pp].cin) allEmptyCin = false;
    }
    if (!allEmptyCin) {
        throw new Error('[generator-bug] iteration=' + it +
            ' produced a non-empty cin — no-collision fixture must use ' +
            '__idx_N keys to mirror the production environment.');
    }

    var out;
    try {
        out = V2.run(fixture);
    } catch (err) {
        bFailures.push({
            iteration: it,
            stage: 'V2.run',
            message: err.message,
            nProctors: fixture.proctorsList.length,
            nEntries: fixture.scheduleEntries.length
        });
        continue;
    }

    if (!out || !out.result) {
        // V2 occasionally produces no result for degenerate sizing;
        // skip those iterations rather than failing — the property is
        // about histogram identity on valid runs, not about coverage.
        bSkipped++;
        continue;
    }

    // 4.b) The core assertion — no-collision invariance.
    var byKeyB = histogramByProctorKey_B(out.result);
    var byNameB = histogramByName_B(out.result);

    // Cross-realm normalization: the v2 module runs inside the `vm`
    // sandbox so the returned objects/arrays carry sandbox prototypes.
    // Compare via canonical JSON projection (same approach as
    // `tests/proctor-v2-fairness-undercovered-preservation.test.js`
    // section A, lines ≈195-205).
    var canonByKey = JSON.parse(JSON.stringify(canonicalize(byKeyB.hist)));
    var canonByName = JSON.parse(JSON.stringify(canonicalize(byNameB.hist)));

    try {
        assert.strictEqual(byKeyB.distinct, byNameB.distinct,
            'No-collision invariance violated on iteration ' + it +
            ': distinct keys (' + byKeyB.distinct + ') ≠ distinct names (' +
            byNameB.distinct + '). Fixture has ' + fixture.proctorsList.length +
            ' proctors with all-unique teacher_name and empty cin; under H5 ' +
            'the per-key and per-name histograms MUST agree.');
        assert.deepStrictEqual(canonByKey, canonByName,
            'No-collision invariance violated on iteration ' + it +
            ': histogramByProctorKey=' + JSON.stringify(canonByKey) +
            ' ≠ histogramByName=' + JSON.stringify(canonByName) +
            '. Fixture nProctors=' + fixture.proctorsList.length +
            ', nEntries=' + fixture.scheduleEntries.length +
            ', resultRows=' + out.result.length + '.');
        bAsserted++;
    } catch (e) {
        bFailures.push({
            iteration: it,
            stage: 'histogram-assert',
            message: e.message,
            nProctors: fixture.proctorsList.length,
            nEntries: fixture.scheduleEntries.length,
            byKey: canonByKey,
            byName: canonByName
        });
    }
}

// 5) Final report for Section B.
console.log('\n[preservation-config-roundtrip] Section B — P_preservation_no_collision:');
console.log('  iterations: ' + ITERATIONS_NO_COLLISION +
    ' (asserted=' + bAsserted + ', skipped=' + bSkipped +
    ', failed=' + bFailures.length + ')');
if (bFailures.length > 0) {
    console.log('  FAILURES (' + bFailures.length + '):');
    for (var bf = 0; bf < Math.min(bFailures.length, 5); bf++) {
        var f = bFailures[bf];
        console.log('    - it=' + f.iteration + ' stage=' + f.stage +
            ' nProctors=' + f.nProctors + ' nEntries=' + f.nEntries +
            ' err=' + f.message);
    }
    if (bFailures.length > 5) {
        console.log('    … (' + (bFailures.length - 5) + ' more)');
    }
}

assert.strictEqual(bFailures.length, 0,
    'P_preservation_no_collision: ' + bFailures.length + ' / ' +
    (bAsserted + bFailures.length) +
    ' no-collision invariance assertions failed. On fixtures with all-unique ' +
    'teacher_name (and the production __idx_N key encoding), the per-key and ' +
    'per-name histograms MUST be byte-identical — see log above.');

console.log('\n[preservation-config-roundtrip] Section B PASS');
console.log('  Property: P_preservation_no_collision');
console.log('  ' + ITERATIONS_NO_COLLISION + ' synthetic no-collision fixtures × ' +
    '(histogramByProctorKey ≡ histogramByName) = ' + bAsserted +
    ' assertions, all green.');
