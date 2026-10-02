'use strict';

// Feature: exemptions-duty-matrix-grid, Property 4: Missing identity fields render an identical placeholder
//
// Validates: Requirements 2.2
//
// Property 4 (design.md): For any proctor and any Identity_Column field that is
// empty or null, the rendered identity cell shows one fixed placeholder marker,
// and that marker is identical across all missing Identity_Column fields.
//
// ---------------------------------------------------------------------------
// Approach — guard the REAL renderer.
// ---------------------------------------------------------------------------
// `renderMatrixGrid()` lives in `js/pages/exams-proctors.js` (not a requirable
// module). To exercise the production function rather than a re-implementation,
// this test EXTRACTS the contiguous source block that spans the module-level
// matrix constants (ED_MATRIX_IDENTITY_COLS, ED_MATRIX_SUMMARY_COLS,
// ED_IDENTITY_PLACEHOLDER, ED_UNRECOGNIZED_MARKER), the `edMatrixCellStatus`
// helper, and `renderMatrixGrid` itself — by string slicing from
// `const ED_MATRIX_IDENTITY_COLS` to the brace-matched end of
// `renderMatrixGrid` — and evaluates it with Node's `vm` in a context that
// supplies its dependencies:
//   - escapeHtml         : canonical from js/utils.js (CH1)
//   - window             : { EdMatrixLogic: require('../js/exams/ed-matrix-logic.js') }
//   - document           : a stub (never used — we always pass an explicit target)
//   - Map/Object/...     : Node's own intrinsics, so `cells instanceof Map`
//                          works across the realm boundary (the model's cells
//                          are Node Maps built by the required logic module).
//
// `renderMatrixGrid(model, null, container)` only ever sets `container.innerHTML`
// and returns the container, so the target can be a plain object
// `{ innerHTML: '' }`; we then inspect the produced HTML string.
//
// The MatrixModel is built with the REAL logic:
//   EdMatrixLogic.buildMatrixModel(proctors, buildSessionColumns(schedule), store)
// using generated proctors that carry a mix of empty/null and present identity
// fields (at least one present so the row is not omitted per Req 2.3) and at
// least one schedule entry (so sessions and rows are both non-empty).
//
// Standalone Node script (run-all.js discovers top-level tests/*.test.js):
//   node tests/ed-matrix-property-4-identical-placeholder.test.js
// Exits non-zero on any failure.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fc = require('fast-check');

const L = require('../js/exams/ed-matrix-logic.js');

const MIN_CASES = 100;

// ---------------------------------------------------------------------------
// 1) Extract renderMatrixGrid + its module-level deps from exams-proctors page JS.
// ---------------------------------------------------------------------------

const PAGE_PATH = path.join(__dirname, '..', 'js', 'pages', 'exams-proctors.js');
const source = fs.readFileSync(PAGE_PATH, 'utf8');

function extractRendererSnippet(src) {
    // Start at the first matrix const; this block also contains edMatrixCellStatus
    // and renderMatrixGrid, in source order.
    const constStart = src.indexOf('const ED_MATRIX_IDENTITY_COLS');
    if (constStart === -1) {
        throw new Error('Could not locate const ED_MATRIX_IDENTITY_COLS in js/pages/exams-proctors.js');
    }

    // Find `function renderMatrixGrid(` after the const start, then brace-match.
    const re = /function\s+renderMatrixGrid\s*\(/g;
    re.lastIndex = constStart;
    const m = re.exec(src);
    if (!m) {
        throw new Error('Could not locate function renderMatrixGrid in js/pages/exams-proctors.js');
    }

    let i = src.indexOf('{', m.index);
    if (i === -1) {
        throw new Error('Malformed renderMatrixGrid declaration (no opening brace)');
    }
    let depth = 1;
    i++;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    if (depth !== 0) {
        throw new Error('Unbalanced braces while extracting renderMatrixGrid');
    }

    return src.slice(constStart, i);
}

// CH1: load canonical escapeHtml from js/utils.js (not a local copy).
function loadCanonicalEscapeHtml() {
    const utilsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
    const m = utilsSrc.match(/function escapeHtml\(text\) \{[\s\S]*?\n\}/);
    if (!m) throw new Error('escapeHtml must exist in js/utils.js');
    return new Function(m[0] + '\nreturn escapeHtml;')();
}
const escapeHtml = loadCanonicalEscapeHtml();

function buildRenderer() {
    const snippet = extractRendererSnippet(source);
    // Append an export hook so we can read the const-scoped bindings + functions.
    const wrapped = snippet +
        '\n;this.__EXPORTS__ = {' +
        ' renderMatrixGrid: renderMatrixGrid,' +
        ' edMatrixCellStatus: edMatrixCellStatus,' +
        ' ED_IDENTITY_PLACEHOLDER: ED_IDENTITY_PLACEHOLDER,' +
        ' ED_UNRECOGNIZED_MARKER: ED_UNRECOGNIZED_MARKER,' +
        ' ED_MATRIX_IDENTITY_COLS: ED_MATRIX_IDENTITY_COLS,' +
        ' ED_MATRIX_SUMMARY_COLS: ED_MATRIX_SUMMARY_COLS' +
        ' };';

    // Pass Node's own intrinsics so `cells instanceof Map` holds across realms
    // (the model's cells are Node Maps from the required logic module).
    const sandbox = {
        escapeHtml: escapeHtml,
        window: { EdMatrixLogic: L },
        document: { getElementById: function () { return null; } },
        Map: Map,
        Set: Set,
        Object: Object,
        Array: Array,
        String: String,
        Number: Number,
        Boolean: Boolean,
        JSON: JSON,
        Symbol: Symbol,
        console: console
    };
    vm.createContext(sandbox);
    vm.runInContext(wrapped, sandbox, { filename: 'js/pages/exams-proctors.js#renderMatrixGrid' });

    const exp = sandbox.__EXPORTS__;
    assert.ok(exp && typeof exp.renderMatrixGrid === 'function',
        'extraction failed: renderMatrixGrid was not produced');
    assert.ok(typeof exp.ED_IDENTITY_PLACEHOLDER === 'string' && exp.ED_IDENTITY_PLACEHOLDER.length > 0,
        'extraction failed: ED_IDENTITY_PLACEHOLDER must be a non-empty string');
    return exp;
}

const RENDERER = buildRenderer();
const renderMatrixGrid = RENDERER.renderMatrixGrid;
const PLACEHOLDER = RENDERER.ED_IDENTITY_PLACEHOLDER; // '—'

// ---------------------------------------------------------------------------
// 2) Generators.
// ---------------------------------------------------------------------------

// A "missing" identity value: null / undefined / empty / whitespace-only.
const missingArb = fc.constantFrom(null, undefined, '', '   ', '\t');

// A "present" identity value built from a safe charset so it can never
// accidentally contain HTML-significant chars or the marker class substring.
const safeChar = fc.constantFrom('a', 'b', 'c', 'M', 'N', '7', '9', 'م', 'ع', 'ف', 'ر', ' ');
const presentArb = fc.array(safeChar, { minLength: 1, maxLength: 8 })
    .map((a) => a.join(''))
    .filter((s) => s.trim() !== '');

const fieldArb = fc.oneof(missingArb, presentArb);

// A proctor with the four data Identity_Columns (name←teacher_name,
// registration←som, institution←workplace, specialty←specialty). At least one
// field is forced present so the row is not omitted (Req 2.3).
const proctorArb = fc.record({
    teacher_name: fieldArb,
    som: fieldArb,
    workplace: fieldArb,
    specialty: fieldArb
}).map((p) => {
    const present = [p.teacher_name, p.som, p.workplace, p.specialty]
        .some((v) => v != null && String(v).trim() !== '');
    if (!present) {
        p.teacher_name = 'مراقب';
    }
    return p;
});

const proctorsArb = fc.array(proctorArb, { minLength: 1, maxLength: 6 });

const scheduleArb = fc.array(
    fc.record({
        date_year: fc.constant('2025'),
        date_month: fc.integer({ min: 1, max: 12 }).map((n) => String(n)),
        date_day: fc.integer({ min: 1, max: 28 }).map((n) => String(n)),
        day: fc.constantFrom('الأول', 'الثاني'),
        period: fc.constantFrom('صباحا', 'زوالا'),
        session: fc.constantFrom('الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'),
        subject_name: fc.constantFrom('الرياضيات', 'الفيزياء', 'العربية')
    }),
    { minLength: 1, maxLength: 4 }
);

// ---------------------------------------------------------------------------
// 3) Helpers for the assertion.
// ---------------------------------------------------------------------------

// The four DATA identity fields (the order column is a derived display index
// and is never "missing").
const IDENTITY_FIELD_KEYS = ['name', 'registration', 'institution', 'specialty'];

// Expected number of missing identity cells across all visible rows = the count
// of null identity fields (buildProctorRows normalizes every empty/absent field
// to null).
function expectedMissingCount(model) {
    let count = 0;
    for (const row of model.rows) {
        const id = row.identity || {};
        for (const k of IDENTITY_FIELD_KEYS) {
            if (id[k] === null) count++;
        }
    }
    return count;
}

// Pull out the text content of every identity cell carrying the
// `ed-identity-missing` class.
function extractMissingMarkers(html) {
    const re = /class="[^"]*ed-identity-missing[^"]*"[^>]*>([^<]*)</g;
    const markers = [];
    let m;
    while ((m = re.exec(html)) !== null) {
        markers.push(m[1]);
    }
    return markers;
}

function countSubstring(haystack, needle) {
    return haystack.split(needle).length - 1;
}

function checkProperty4(proctors, schedule) {
    const sessionColumns = L.buildSessionColumns(schedule);
    const store = { exemptionsData: {}, dutyData: {}, reservesData: {} };
    const model = L.buildMatrixModel(proctors, sessionColumns, store);

    // Preconditions for a fully rendered grid (no empty-state early return).
    assert.ok(model.rows.length > 0, 'expected at least one visible row');
    assert.ok(model.sessions.length > 0, 'expected at least one session column');

    const container = { innerHTML: '' };
    const returned = renderMatrixGrid(model, null, container);
    assert.strictEqual(returned, container, 'renderMatrixGrid should return the target container');

    const html = container.innerHTML;
    const expected = expectedMissingCount(model);

    // (a) The number of rendered missing-identity cells equals the number of
    //     empty/null identity fields among non-omitted rows.
    const classOccurrences = countSubstring(html, 'ed-identity-missing');
    assert.strictEqual(
        classOccurrences,
        expected,
        'ed-identity-missing occurrences (' + classOccurrences + ') should equal the ' +
        'number of empty identity fields (' + expected + ')'
    );

    const markers = extractMissingMarkers(html);
    assert.strictEqual(
        markers.length,
        expected,
        'captured missing-cell markers (' + markers.length + ') should equal the ' +
        'number of empty identity fields (' + expected + ')'
    );

    // (b) Every missing identity cell shows EXACTLY the one fixed placeholder,
    //     and that marker is identical across all missing fields.
    for (const marker of markers) {
        assert.strictEqual(
            marker,
            PLACEHOLDER,
            'every missing identity cell must show the fixed placeholder ' +
            JSON.stringify(PLACEHOLDER) + ', got ' + JSON.stringify(marker)
        );
    }
    const distinct = new Set(markers);
    assert.ok(
        distinct.size <= 1,
        'the placeholder marker must be identical across all missing fields, found: ' +
        JSON.stringify(Array.from(distinct))
    );
}

// ---------------------------------------------------------------------------
// 4) Runner.
// ---------------------------------------------------------------------------

console.log('[test] exemptions-duty-matrix-grid — Property 4: missing identity fields render an identical placeholder');
console.log('       extracted renderMatrixGrid from js/pages/exams-proctors.js and evaluated it via vm; placeholder = ' + JSON.stringify(PLACEHOLDER));

try {
    // The single fixed placeholder is exactly the page's ED_IDENTITY_PLACEHOLDER.
    assert.strictEqual(PLACEHOLDER, '—', 'ED_IDENTITY_PLACEHOLDER should be the em dash placeholder');

    // Deterministic edge case: a row with three missing fields + one present.
    (function fixedEdgeCase() {
        const proctors = [{ teacher_name: 'علي', som: '', workplace: null, specialty: '   ' }];
        const schedule = [{
            date_year: '2025', date_month: '6', date_day: '10',
            day: 'الأول', period: 'صباحا', session: 'الحصة الأولى', subject_name: 'الرياضيات'
        }];
        const sessionColumns = L.buildSessionColumns(schedule);
        const model = L.buildMatrixModel(proctors, sessionColumns, { exemptionsData: {}, dutyData: {}, reservesData: {} });
        const container = { innerHTML: '' };
        renderMatrixGrid(model, null, container);
        const markers = extractMissingMarkers(container.innerHTML);
        assert.strictEqual(markers.length, 3, 'edge case: exactly three missing identity cells expected');
        markers.forEach((mk) => assert.strictEqual(mk, PLACEHOLDER, 'edge case: each missing cell shows the placeholder'));
    })();

    fc.assert(
        fc.property(proctorsArb, scheduleArb, (proctors, schedule) => {
            checkProperty4(proctors, schedule);
        }),
        { numRuns: MIN_CASES, verbose: true }
    );

    console.log('PASS ed-matrix Property 4: missing identity fields render an identical placeholder (' + MIN_CASES + '+ generated cases + edge case)');
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 4 violated');
    console.error(err && err.message ? err.message : err);
    if (err && err.counterexample) {
        console.error('Counterexample: ' + JSON.stringify(err.counterexample));
    }
    process.exit(1);
}
