'use strict';

// Feature: exemptions-duty-matrix-grid, Task 11.5: empty-state messages, identity order, unrecognized marker
//
// UNIT tests (no fast-check) for renderMatrixGrid() in
// js/pages/exams-proctors.js. Covers:
//   1. No rows                -> data-ed-empty="no-proctors" + "add proctors first" msg, no table
//   2. Rows but no sessions   -> data-ed-empty="no-sessions"
//   3. Both empty (precedence)-> only "no-proctors", never "no-sessions"   (Req 1.7)
//   4. Identity column order  -> order, name, registration, institution, specialty (Req 2.1)
//   5. Unrecognized status    -> ed-cell-unrecognized + '؟', none of the four codes (Req 3.4)
//
// _Requirements: 1.5, 1.6, 1.7, 2.1, 3.4_
//
// Strategy (standalone Node, no jsdom): read js/pages/exams-proctors.js, extract
// the const block + edMatrixCellStatus + renderMatrixGrid via string slicing +
// brace matching, evaluate it in a Node `vm` context with the canonical
// escapeHtml from js/utils.js and window.EdMatrixLogic = require(...).
// renderMatrixGrid is called with an explicit targetContainer { innerHTML: '' }
// and we inspect the produced HTML string.
//
//   node tests/ed-matrix-render-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EdMatrixLogic = require('../js/exams/ed-matrix-logic.js');

// ---------------------------------------------------------------------------
// Extract renderMatrixGrid (+ its const/helper deps) from exams-proctors page JS.
// ---------------------------------------------------------------------------

const PAGE_PATH = path.join(__dirname, '..', 'js', 'pages', 'exams-proctors.js');
const pageSource = fs.readFileSync(PAGE_PATH, 'utf8');

// CH1: load canonical escapeHtml from js/utils.js (not a local copy).
function loadCanonicalEscapeHtml() {
    const utilsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'utils.js'), 'utf8');
    const m = utilsSrc.match(/function escapeHtml\(text\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'escapeHtml must exist in js/utils.js');
    return new Function(m[0] + '\nreturn escapeHtml;')();
}
const escapeHtml = loadCanonicalEscapeHtml();

// Find the matching close brace for the `{` that starts at openBraceIndex.
function matchBrace(source, openBraceIndex) {
    let depth = 0;
    for (let i = openBraceIndex; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return i; // index of the matching close brace
        }
    }
    throw new Error('Unbalanced braces while extracting renderMatrixGrid');
}

function extractRenderBlock(source) {
    // Block starts at the identity-cols const that precedes edMatrixCellStatus
    // and renderMatrixGrid, and ends at the close of renderMatrixGrid.
    const startIdx = source.indexOf('const ED_MATRIX_IDENTITY_COLS');
    assert.ok(startIdx !== -1, 'ED_MATRIX_IDENTITY_COLS declaration must exist');

    const declRe = /function\s+renderMatrixGrid\s*\(\s*matrixModel\s*,\s*viewState\s*,\s*targetContainer\s*\)\s*\{/;
    const m = declRe.exec(source);
    assert.ok(m, 'renderMatrixGrid declaration must exist');
    const openBrace = source.indexOf('{', m.index + m[0].length - 1);
    const closeBrace = matchBrace(source, openBrace);

    return source.slice(startIdx, closeBrace + 1);
}

const renderBlock = extractRenderBlock(pageSource);

// Sandbox: provide escapeHtml (CH1 SSOT), a window with the real logic module,
// and a document stub (only used by renderMatrixGrid when no targetContainer is
// passed — we always pass one, but stub it so the `||` fallback never throws).
// Share the host `Map` so the model's cells (created by the Node-realm
// ed-matrix-logic.js) satisfy `instanceof Map` inside the vm — in the browser
// renderer everything runs in a single realm, so this mirrors production.
const sandbox = {
    escapeHtml: escapeHtml,
    Map: Map,
    window: { EdMatrixLogic: EdMatrixLogic },
    document: { getElementById: function () { return null; } },
    console: { log: function () {}, warn: function () {}, error: function () {} }
};
vm.createContext(sandbox);
vm.runInContext(renderBlock + '\nthis.__renderMatrixGrid = renderMatrixGrid;', sandbox);

const renderMatrixGrid = sandbox.__renderMatrixGrid;
assert.strictEqual(typeof renderMatrixGrid, 'function', 'renderMatrixGrid must be extracted as a function');

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const EMPTY_STORE = { exemptionsData: {}, dutyData: {}, reservesData: {} };

const SCHEDULE = [
    {
        date_year: '2025', date_month: '6', date_day: '10',
        day: 'الأول', period: 'صباحا', session: 'الحصة الأولى',
        subject_name: 'الرياضيات', order: 1
    }
];

const PROCTORS = [
    { cin: 'C1', teacher_name: 'أحمد', som: '12345', workplace: 'ثانوية النور', specialty: 'رياضيات' }
];

function fullModel() {
    const sessions = EdMatrixLogic.buildSessionColumns(SCHEDULE);
    return EdMatrixLogic.buildMatrixModel(PROCTORS, sessions, EMPTY_STORE);
}

function render(model) {
    const container = { innerHTML: '' };
    renderMatrixGrid(model, null, container);
    return container.innerHTML;
}

// Extract the inner text of the FIRST <td ...>...</td> whose opening tag
// contains `marker` (used to scope assertions to a single cell, excluding its
// attributes such as the title text).
function cellInnerByClass(htmlStr, marker) {
    const at = htmlStr.indexOf(marker);
    assert.ok(at !== -1, 'expected to find ' + marker + ' in rendered HTML');
    const tdStart = htmlStr.lastIndexOf('<td', at);
    const openEnd = htmlStr.indexOf('>', at);
    const closeIdx = htmlStr.indexOf('</td>', openEnd);
    assert.ok(tdStart !== -1 && openEnd !== -1 && closeIdx !== -1, 'malformed td around ' + marker);
    return {
        openingTag: htmlStr.slice(tdStart, openEnd + 1),
        inner: htmlStr.slice(openEnd + 1, closeIdx)
    };
}

// ---------------------------------------------------------------------------
// Cases.
// ---------------------------------------------------------------------------

const STATUS_CODES = ['ك', 'معفى', 'م', 'إح'];
let passed = 0;

function check(name, fn) {
    fn();
    passed++;
    console.log('  PASS: ' + name);
}

console.log('[test] exemptions-duty-matrix-grid — Task 11.5: empty states, identity order, unrecognized marker');

// Case 1: No rows -> "add proctors first" (no-proctors), and no matrix table.
check('Case 1: empty rows renders no-proctors message and no table (Req 1.5)', function () {
    const sessions = EdMatrixLogic.buildSessionColumns(SCHEDULE);
    const model = { sessions: sessions, dateGroups: EdMatrixLogic.buildDateGroups(sessions), rows: [], totalSessions: sessions.length };
    const out = render(model);
    assert.ok(out.indexOf('data-ed-empty="no-proctors"') !== -1, 'must contain no-proctors marker');
    assert.ok(out.indexOf('يرجى إضافة المراقبين أولا') !== -1, 'must contain the add-proctors-first message');
    assert.ok(out.indexOf('<table') === -1, 'must NOT render a matrix table when there are no rows');
});

// Case 2: Rows present, no sessions -> "no sessions available" (no-sessions).
check('Case 2: rows but no sessions renders no-sessions message (Req 1.6)', function () {
    const model = EdMatrixLogic.buildMatrixModel(PROCTORS, [], EMPTY_STORE);
    assert.ok(model.rows.length > 0, 'fixture must produce at least one identity-bearing row');
    assert.strictEqual(model.sessions.length, 0, 'fixture must have no sessions');
    const out = render(model);
    assert.ok(out.indexOf('data-ed-empty="no-sessions"') !== -1, 'must contain no-sessions marker');
    assert.ok(out.indexOf('لا توجد حصص متاحة للتعديل') !== -1, 'must contain the no-sessions message');
});

// Case 3: Both empty -> only no-proctors, precedence over no-sessions (Req 1.7).
check('Case 3: both empty shows only no-proctors, never no-sessions (Req 1.7)', function () {
    const model = EdMatrixLogic.buildMatrixModel([], [], EMPTY_STORE);
    assert.strictEqual(model.rows.length, 0, 'no rows expected');
    assert.strictEqual(model.sessions.length, 0, 'no sessions expected');
    const out = render(model);
    assert.ok(out.indexOf('data-ed-empty="no-proctors"') !== -1, 'must contain no-proctors marker');
    assert.ok(out.indexOf('data-ed-empty="no-sessions"') === -1, 'must NOT contain no-sessions marker (precedence)');
});

// Case 4: Identity column order (Req 2.1): order, name, registration, institution, specialty.
check('Case 4: identity columns render in RTL source order (Req 2.1)', function () {
    const out = render(fullModel());
    const idxOrder = out.indexOf('ed-identity-col-order');
    const idxName = out.indexOf('ed-identity-col-name');
    const idxReg = out.indexOf('ed-identity-col-registration');
    const idxInst = out.indexOf('ed-identity-col-institution');
    const idxSpec = out.indexOf('ed-identity-col-specialty');
    [idxOrder, idxName, idxReg, idxInst, idxSpec].forEach(function (i, n) {
        assert.ok(i !== -1, 'identity column #' + n + ' class must be present in output');
    });
    assert.ok(idxOrder < idxName, 'order must precede name');
    assert.ok(idxName < idxReg, 'name must precede registration');
    assert.ok(idxReg < idxInst, 'registration must precede institution');
    assert.ok(idxInst < idxSpec, 'institution must precede specialty');
});

// Case 5: Unrecognized status marker (Req 3.4).
check('Case 5: unrecognized status renders marker and no valid code (Req 3.4)', function () {
    const model = fullModel();
    const session = model.sessions[0];
    assert.ok(session, 'fixture must have a session column');
    // Inject a non-enum status into the row's cells Map.
    model.rows[0].cells.set(session.sessionKey, 'banana');
    const out = render(model);

    const cell = cellInnerByClass(out, 'ed-cell-unrecognized');
    assert.ok(cell.openingTag.indexOf('ed-cell-unrecognized') !== -1, 'cell must carry the unrecognized class');
    assert.ok(cell.openingTag.indexOf('data-status="banana"') !== -1, 'cell must record the raw unrecognized status');
    // Inner content is the explicit marker only.
    assert.strictEqual(cell.inner, '؟', 'unrecognized cell inner content must be the ؟ marker');
    // None of the four valid Status_Codes appear in the cell content.
    STATUS_CODES.forEach(function (code) {
        assert.ok(cell.inner.indexOf(code) === -1, 'unrecognized cell must not display the "' + code + '" status code');
    });
});

console.log('PASS: all ' + passed + ' Task 11.5 render unit cases');
process.exit(0);
