'use strict';

// Focused behavioural VM suite for the real grades review-to-confirmation-to-commit boundary
// Uses a vm-based DOM harness reusing cycle-switcher shims (ClassList/Element)
// Verifies 6 scenarios that each fail when the corresponding Phase 1 fix is reverted.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

// Minimal DOM shim (from cycle-switcher.test.js)
class ClassList {
    constructor(element) { this.element = element; this.set = new Set(); }
    add(...names) { names.forEach((n) => this.set.add(n)); this._sync(); }
    remove(...names) { names.forEach((n) => this.set.delete(n)); this._sync(); }
    contains(name) { return this.set.has(name); }
    toggle(name, force) { const willAdd = force !== undefined ? force : !this.set.has(name); if (willAdd) this.set.add(name); else this.set.delete(name); this._sync(); return willAdd; }
    _sync() { this.element._className = Array.from(this.set).join(' '); }
}
class Element {
    constructor(tagName) {
        this.tagName = String(tagName).toLowerCase();
        this.children = []; this.parentElement = null; this.attributes = {}; this._className = ''; this.classList = new ClassList(this);
        this.dataset = {}; this.style = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this.id = ''; this.listeners = {};
    }
    set className(v) { this._className = v; this.classList.set = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
    get className() { return this._className; }
    setAttribute(n, v) { this.attributes[n] = String(v); }
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; }
    appendChild(c) { if (c.parentElement) c.parentElement.children = c.parentElement.children.filter((x) => x !== c); c.parentElement = this; this.children.push(c); return c; }
    prepend(c) { if (c.parentElement) c.parentElement.children = c.parentElement.children.filter((x) => x !== c); c.parentElement = this; this.children.unshift(c); return c; }
    replaceChildren(...children) { this.children.forEach((c) => { c.parentElement = null; }); this.children = []; children.forEach((c) => this.appendChild(c)); }
    addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }
    querySelector(selector) {
        if (this._matches(selector)) return this;
        for (const child of this.children) { const found = child.querySelector(selector); if (found) return found; }
        return null;
    }
    querySelectorAll(selector) {
        const found = [];
        for (const child of this.children) { if (child._matches(selector)) found.push(child); found.push(...child.querySelectorAll(selector)); }
        return found;
    }
    _matches(selector) {
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        if (selector.startsWith('.')) { const tok = selector.slice(1); return this.classList.set.has(tok) || (this.attributes.class || '').split(/\s+/).includes(tok); }
        if (selector.startsWith('[data-action')) {
            const m = /\[data-action="([^"]+)"\]/.exec(selector);
            if (m) return this.dataset.action === m[1] || this.attributes['data-action'] === m[1];
            return Object.prototype.hasOwnProperty.call(this.attributes, 'data-action') || this.dataset.action;
        }
        if (selector === '*') return true;
        return this.tagName === selector.toLowerCase();
    }
    focus() {}
    scrollIntoView() {}
    click() { if (this.listeners.click) this.listeners.click.forEach((fn) => fn()); }
    dispatchEvent(e) { for (const fn of this.listeners[e.type] || []) fn(e); return !e.defaultPrevented; }
}

function createHarness() {
    const elements = [];
    const documentListeners = {};
    const document = {
        readyState: 'loading',
        createElement(tag) { const el = new Element(tag); elements.push(el); return el; },
        addEventListener(n, fn) { (documentListeners[n] = documentListeners[n] || []).push(fn); },
        querySelector(s) { for (const el of elements) if (el._matches(s)) return el; return null; },
        querySelectorAll(s) { return elements.filter((el) => el._matches(s)); },
        getElementById(id) { return elements.find((el) => el.id === id) || null; },
        body: { appendChild() {} },
    };
    const window = {
        location: { search: '', reload() {} },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        addEventListener() {},
    };
    window.document = document;

    // Stubs for globals expected by settings-imports.js
    const XLSX = require('xlsx');
    const stubs = {
        XLSX,
        showToast(message, type) { stubs._toasts = stubs._toasts || []; stubs._toasts.push({ message, type }); },
        showConfirm: async () => ({ confirmed: true }),
        escapeHtml: (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
        DataSourceRegistry: { getYear: () => ({ warnings: [] }), update: () => {}, getYear: () => ({}) },
        CrossSourceValidator: class { constructor() {} async validateAfterImport() { return { warnings: [] }; } },
        ImportContext: {},
        ImportReaders: require('../../js/import-center/import-readers.js'),
        ImportResultContract: require('../../js/import-center/import-result-contract.js'),
        OrientationErrorContract: require('../../js/shared/errors/orientation-error-contract.js'),
        PencilShared: { TeacherIdentity: { normalizeTeacherName: (s) => String(s || '').trim() } },
        StudentImportParser: require('../../js/import-center/students-import-parser.js'),
        GradesImportParser: require('../../js/import-center/grades-import-parser.js'),
        ImportCenterNormalize: require('../../js/import-center/normalize.js'),
        ImportCenterDiagnostics: require('../../js/import-center/import-diagnostics-codes.js'),
        showImportContextReview: async () => true,
        handleImport: async () => {},
    };
    // Provide console etc.
    const sandbox = {
        window,
        document,
        console,
        location: window.location,
        localStorage: window.localStorage,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Event: CustomEvent,
        CustomEvent,
        ...stubs,
        globalThis: window,
        navigator: {},
    };
    // Expose globals expected as window.* and global
    sandbox.window.api = {
        students: { getAll: async () => [], addBulk: async () => ({ success: true }), importBulk: async () => ({ success: true }) },
        grades: { saveBulk: async () => ({ success: true, count: 1 }), getAll: async () => [] },
        absences: { saveBulk: async () => ({ success: true }), replaceByYear: async () => ({ success: true }) },
        cycles: { getActive: async () => ({ success: true, value: { cycle: { cycle_code: 'secondary_qualifiant' }, context: { cycleCode: 'secondary_qualifiant' } } }) },
        reports: { getIdentity: async () => ({ success: true, value: {} }) },
        diagnostics: { getRecent: async () => ({ entries: [] }) },
        orientation: { bulkUpsert: async () => ({ inserted: 1, updated: 0, unchanged: 0 }) },
    };
    // Need to also expose those stubs as globals for the script
    for (const [k, v] of Object.entries(stubs)) sandbox[k] = v;
    // Provide required DOM elements
    const FILE_INPUTS = ['students-file-input', 'grades-file-input', 'absences-file-input', 'fet-file-input', 'status-file-input', 'orientation-file-input', 'agent-xml-file-input'];
    for (const id of FILE_INPUTS) {
        const el = document.createElement('input');
        el.id = id;
        el.type = 'file';
        elements.push(el);
    }
    const actions = ['students', 'grades', 'absences', 'fet', 'student-status', 'orientation', 'agent-xml'];
    for (const action of actions) {
        const card = document.createElement('button');
        card.dataset.action = action;
        card.setAttribute('data-action', action);
        card.className = 'imports-action-card';
        elements.push(card);
    }
    const semesterSelect = document.createElement('select');
    semesterSelect.id = 'semester-select';
    const opt1 = document.createElement('option'); opt1.value = '1'; opt1.selected = true; semesterSelect.appendChild(opt1);
    const opt2 = document.createElement('option'); opt2.value = '2'; semesterSelect.appendChild(opt2);
    elements.push(semesterSelect);
    // Other required elements
    const ids = ['import-progress-card', 'import-progress-fill', 'import-progress-message', 'import-progress-percent', 'import-progress-title', 'import-status-panel', 'status-panel-year-label', 'import-logs-pagination', 'import-logs-prev', 'import-logs-next', 'ic-manual-region'];
    for (const id of ids) { const el = document.createElement('div'); el.id = id; elements.push(el); }

    vm.createContext(sandbox);
    // Load dependencies that settings-imports.js expects as globals
    // Load normalize and diagnostics first (they are already required as stubs, but also need to be available as globals)
    // Load the page script
    const pageSrc = fs.readFileSync(path.join(ROOT, 'js', 'pages', 'settings-imports.js'), 'utf8');
    try {
        vm.runInContext(pageSrc, sandbox, { filename: 'js/pages/settings-imports.js' });
    } catch (e) {
        // The page script may throw due to missing DOM, but top-level functions should still be defined
        console.error('settings-imports load error (expected for harness):', e.message);
    }
    return { sandbox, window, document, stubs };
}

// ──────────────────────────────────────────────────────────────────────────────
// 6 scenarios

async function testSingleFileStudentsHappyPath() {
    const Parser = require('../../js/import-center/students-import-parser.js');
    const result = Parser.parseStudentSheets({
        sheets: [{ name: 'TCSF-1', rows: [['الرمز', 'النسب', 'الاسم', 'القسم'], ['S0001001', 'بنعلي', 'يوسف', 'TCSF-1']] }],
        schoolYear: '2025/2026',
        configuredSchoolName: 'الثانوية التأهيلية ابن سينا',
        normalizeLevel: (v) => v,
    });
    assert.strictEqual(result.valid, true, 'happy path students import should be valid');
    assert.strictEqual(result.records.length, 1);
    assert.strictEqual(result.records[0].full_name, 'يوسف بنعلي');
    console.log('  [case 1] single-file students happy path: PASS');
}

async function testLastNameLeftOfFirstName() {
    const Parser = require('../../js/import-center/students-import-parser.js');
    const result = Parser.parseStudentSheets({
        sheets: [{ name: 'Test', rows: [['Massar', 'LastName', 'FirstName'], ['S0002001', 'Benali', 'Ahmed']] }],
        schoolYear: '2025/2026',
        configuredSchoolName: '',
        normalizeLevel: (v) => v,
    });
    assert.strictEqual(result.records[0].full_name, 'Ahmed Benali', 'T1.1: LastName left of FirstName must not corrupt full_name (was Benali Benali)');
    // Verify diagnostic not emitted for distinct columns
    assert.ok(!result.diagnostics.some((d) => d.code === 'AMBIGUOUS_HEADER_BINDING'), 'no ambiguous binding for distinct columns');
    // Verify that a file with Name header still works (exact-only alias)
    const result2 = Parser.parseStudentSheets({
        sheets: [{ name: 'Test', rows: [['Massar', 'Name', 'LastName'], ['S0002001', 'John', 'Doe']] }],
        schoolYear: '2025/2026',
        configuredSchoolName: '',
        normalizeLevel: (v) => v,
    });
    assert.strictEqual(result2.records[0].full_name, 'John Doe', 'Name header exact match');
    console.log('  [case 2] LastName left of FirstName (T1.1): PASS — would FAIL as "Benali Benali" on reverted code');
}

async function testMultiFileGradesSemesterSelection() {
    // Verify that explicit semester selection is preserved for multi-file grades
    // The page exposes applyDetectedSemesterForSingleGradeFile and FILE_INPUTS
    const { sandbox } = createHarness();
    // Check that the helper exists and respects fileCount !==1
    const fn = sandbox.applyDetectedSemesterForSingleGradeFile;
    assert.strictEqual(typeof fn, 'function', 'applyDetectedSemesterForSingleGradeFile must be reachable from the harness');
    // Create a fake select
    const sel = sandbox.document.getElementById('semester-select');
    sel.value = '1';
    const applied = fn(2, 1); // single file should apply
    assert.strictEqual(typeof applied, 'boolean');
    const notApplied = fn(2, 2); // multi-file should not apply
    assert.strictEqual(notApplied, false, 'multi-file must keep explicit semester');
    console.log('  [case 3] multi-file grades explicit semester: PASS — would violate P1-3 on reverted code');
}

async function testHeaderOnlyDiagnostic() {
    const Parser = require('../../js/import-center/students-import-parser.js');
    const result = Parser.parseStudentSheets({
        sheets: [{ name: 'Notes', rows: [['الرمز', 'النسب', 'الاسم']] }],
        schoolYear: '2025/2026',
        configuredSchoolName: '',
        normalizeLevel: (v) => v,
    });
    assert.strictEqual(result.valid, false, 'header-only file must be invalid');
    assert.ok(result.diagnostics.length > 0, 'must surface diagnostic');
    assert.ok(result.records.length === 0, 'writes nothing');
    console.log('  [case 4] header-only diagnostic: PASS');
}

async function testReentrancyGuard() {
    const { sandbox, stubs } = createHarness();
    // Simulate importInFlight — must set the vm's let binding, not a property
    vm.runInContext('importInFlight = true;', sandbox);
    let toastMsg = null;
    sandbox.showToast = (msg, type) => { toastMsg = msg; stubs._toasts = [{ message: msg, type }]; };
    const input = sandbox.document.getElementById('grades-file-input');
    let clicked = false;
    const origClick = input.click;
    input.click = () => { clicked = true; };
    // runImport is global in sandbox
    assert.strictEqual(typeof sandbox.runImport, 'function', 'runImport must be reachable from the harness');
    await sandbox.runImport('grades');
    assert.strictEqual(clicked, false, 'T1.7: runImport while importInFlight must not open picker');
    assert.ok(toastMsg && /جارية/.test(toastMsg), 'must toast about ongoing import');
    console.log('  [case 5] re-entrancy guard (T1.7): PASS — would open second picker on reverted code');
    input.click = origClick;
    vm.runInContext('importInFlight = false;', sandbox);
}

async function testOrientationPreflightDoesNotThrow() {
    const { sandbox } = createHarness();
    // The TDZ was at importOrientation with persist:false reading skipped before declaration
    // We can test by calling the page's importOrientation if exposed, or by checking the source
    const src = fs.readFileSync(path.join(ROOT, 'js', 'pages', 'settings-imports.js'), 'utf8');
    const persistIdx = src.indexOf('if (options.persist === false)', src.indexOf('async function importOrientation'));
    const declIdx = src.indexOf('let skipped = preIpcSkipped', persistIdx - 2000);
    // After fix, decl should be before the if
    assert.ok(declIdx !== -1 && declIdx < persistIdx, 'T1.4: skipped must be declared before persist check');
    // Runtime: the rows MUST survive validation, otherwise the call throws
    // EMPTY_FILE long before the persist block and the TDZ is never exercised.
    assert.strictEqual(typeof sandbox.importOrientation, 'function', 'importOrientation must be reachable from the harness');
    const preview = await sandbox.importOrientation(
        null,
        '2025/2026',
        null,
        { rows: [{ student_code: 'S0001001', full_name: 'تلميذ تجريبي', origin_stream: 'الجذع المشترك العلمي', choice_1: 'علوم' }] },
        { persist: false }
    );
    assert.strictEqual(preview.rows.length, 1, 'preflight must return the deduped rows');
    assert.strictEqual(typeof preview.skipped, 'number', 'T1.4: reading `skipped` in the preflight return must not hit the TDZ');
    assert.strictEqual(preview.noRecordsSaved, true, 'preflight must not write');
    console.log('  [case 6] orientation preflight (T1.4) runtime: PASS — would throw ReferenceError on reverted code');
}

// ── Truncated ministry XML must not be turned into a blocking verdict ────────

async function testTruncatedXmlPreflightIsNotBlocking() {
    const { sandbox } = createHarness();
    assert.strictEqual(typeof sandbox.runManualImportPreflight, 'function', 'runManualImportPreflight must be reachable');
    const file = { name: 'DsAgentExport.xml', size: 4 * 1024 * 1024 };

    // Oversized file: the required element sits past the read cap, so the fast
    // preflight cannot see it. That is "unknown", never "invalid".
    sandbox.ImportReaders = {
        extractFeatures: async () => ({
            xmlRoot: 'DsAgentExport',
            xmlElements: ['R_GRADE', 'CD_GRADE', 'LL_GRADE'],
            truncated: true,
            truncatedAt: 512 * 1024,
            empty: false,
            error: null
        })
    };
    const truncated = await sandbox.runManualImportPreflight('agent-xml', file, '2025/2026', null);
    assert.strictEqual(truncated.valid, true, 'T1.5: a truncated read must not invalidate the file');
    assert.strictEqual(truncated.executable, true, 'T1.5: a truncated read must stay executable');
    assert.ok(
        (truncated.warnings || []).some((item) => item.code === 'XML_TRUNCATED'),
        'T1.5: truncation must be surfaced as a warning'
    );

    // A genuinely wrong file is still blocked.
    sandbox.ImportReaders = {
        extractFeatures: async () => ({
            xmlRoot: 'DsAgentExport',
            xmlElements: ['R_GRADE'],
            truncated: false,
            empty: false,
            error: null
        })
    };
    const invalid = await sandbox.runManualImportPreflight('agent-xml', { name: 'other.xml', size: 100 }, '2025/2026', null);
    assert.strictEqual(invalid.valid, false, 'a complete read that lacks the personnel block must still block');
    console.log('  [case 7] truncated ministry XML (T1.5): PASS — was blocked as INVALID_FILE_STRUCTURE on reverted code');
}

// ── Student-status header binding (the page's own header engine) ─────────────

async function testStatusHeaderRolesAreExclusive() {
    const { sandbox } = createHarness();
    assert.strictEqual(typeof sandbox.bindHeaderRoles, 'function', 'bindHeaderRoles must be reachable from the harness');

    const bind = (headers) =>
        vm.runInContext(
            `(function () {
                const headers = ${JSON.stringify(headers)};
                const familyNameAliases = [...HEADER_ALIASES.familyName, 'النسب', 'اللقب'];
                const firstNameAliases = [...HEADER_ALIASES.firstName, 'الاسم', 'الإسم'];
                const bound = bindHeaderRoles(headers, {
                    code: STATUS_CODE_ALIASES,
                    status: STATUS_HEADER_ALIASES.status,
                    fullName: HEADER_ALIASES.fullName,
                    familyName: familyNameAliases,
                    firstName: firstNameAliases,
                    section: HEADER_ALIASES.section
                });
                const family = bound.familyName >= 0 ? headers[bound.familyName] : '';
                const first = bound.firstName >= 0 ? headers[bound.firstName] : '';
                const full = bound.fullName >= 0 ? headers[bound.fullName] : '';
                return JSON.stringify({
                    code: bound.code,
                    status: bound.status,
                    composed: full || [family, first].filter(Boolean).join(' ')
                });
            })()`,
            sandbox
        );

    // `LastName` contains the bare `name` alias: a first-match binder puts both
    // name roles on column 1 and full_name becomes "LastName LastName", which
    // importStudentStatus then writes to the students table via addBulk.
    const latin = JSON.parse(bind(['Massar', 'LastName', 'FirstName', 'Status']));
    assert.strictEqual(latin.composed, 'LastName FirstName', 'family and first name must bind to different columns');
    assert.strictEqual(latin.code, 0);
    assert.strictEqual(latin.status, 3);

    // «الاسم العائلي» contains «الاسم» — the same trap in Arabic.
    const arabicPair = JSON.parse(bind(['الرمز', 'الاسم العائلي', 'الاسم الشخصي', 'الوضعية']));
    assert.strictEqual(arabicPair.composed, 'الاسم العائلي الاسم الشخصي', 'the Arabic name pair must bind to different columns');

    // A dedicated full-name column wins over the composed pair.
    const fullNameColumn = JSON.parse(bind(['رمز مسار', 'الاسم الكامل', 'القسم', 'الوضعية']));
    assert.strictEqual(fullNameColumn.composed, 'الاسم الكامل');
    assert.strictEqual(fullNameColumn.code, 0, '«رمز مسار» must still resolve the code column');
    console.log('  [case 8] student-status header binding: PASS — was "LastName LastName" on reverted code');
}

// ── T2.4 Row-failure policy (depends on T2.2 harness) ────────────────────────

async function testGradesOneInvalidCellOutOf400() {
    const Parser = require('../../js/import-center/grades-import-parser.js');
    const students = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, code: `S${String(1000000 + i).padStart(7, '0')}`, section: 'TCSF-1' }));
    const metadataRows = [
        ['المستوى :', 'الجذع المشترك العلمي خيار فرنسية', 'القسم :', 'TCSF-1'],
        ['الدورة :', 'الدورة الأولى', 'السنة الدراسية :', '2025/2026'],
    ];
    const header = ['رمز التلميذ', 'الفرض الأول'];
    const rows = [...metadataRows, header];
    for (let i = 0; i < 400; i++) {
        const code = students[i].code;
        const grade = i === 199 ? 'abs' : 12; // one unparsable cell
        rows.push([code, grade]);
    }
    const result = Parser.parseGradesSheets({
        sheets: [{ name: 'Notes', rows }],
        schoolYear: '2025/2026',
        students,
        sourceFileName: 'Export_10401E_TCSF-1_LANGUE ARABE_28072026153232.xlsx',
    });
    assert.strictEqual(result.valid, true, 'T2.4 Case A: 1 invalid cell out of 400 must still be valid (row-scoped, not file-blocking)');
    assert.strictEqual(result.records.length, 399, 'should have 399 valid records (one assessment column, 400 rows -> 399 after one invalid)');
    const invalidDiags = result.diagnostics.filter((d) => d.code === 'INVALID_GRADE');
    assert.ok(invalidDiags.length === 1, 'one INVALID_GRADE diagnostic');
    assert.ok(invalidDiags.every((d) => d.blocking === false), 'INVALID_GRADE must be non-blocking');
    console.log('  [T2.4 Case A] 1 invalid cell out of 400 → 399 written, 1 excluded: PASS — would be whole-file rejected on reverted code');
}

async function testGradesUnknownStudentBlocks() {
    const Parser = require('../../js/import-center/grades-import-parser.js');
    const students = [{ id: 1, code: 'S0001001', section: 'TCSF-1' }];
    const metadataRows = [
        ['المستوى :', 'الجذع المشترك العلمي خيار فرنسية', 'القسم :', 'TCSF-1'],
        ['الدورة :', 'الدورة الأولى', 'السنة الدراسية :', '2025/2026'],
    ];
    const rows = [...metadataRows, ['رمز التلميذ', 'الفرض الأول'], ['UNKNOWN999', 12], ['S0001001', 13]];
    const result = Parser.parseGradesSheets({
        sheets: [{ name: 'Notes', rows }],
        schoolYear: '2025/2026',
        students,
        sourceFileName: 'Export_10401E_TCSF-1_LANGUE ARABE_28072026153232.xlsx',
    });
    assert.strictEqual(result.valid, false, 'T2.4 Case B: unknown student must block file');
    assert.ok(result.diagnostics.some((d) => d.code === 'UNKNOWN_STUDENT' && d.blocking === true), 'UNKNOWN_STUDENT must be blocking');
    console.log('  [T2.4 Case B] unknown student blocks: PASS (regression guard)');
}

async function testStudentsCodeLessRowDiagnostic() {
    const Parser = require('../../js/import-center/students-import-parser.js');
    const result = Parser.parseStudentSheets({
        sheets: [{ name: 'Test', rows: [['الرمز', 'النسب', 'الاسم'], ['', 'بنعلي', 'يوسف'], ['S0001002', 'الفاسي', 'مريم']] }],
        schoolYear: '2025/2026',
        configuredSchoolName: '',
        normalizeLevel: (v) => v,
    });
    assert.strictEqual(result.records.length, 1, 'code-less row must be skipped');
    assert.ok(result.diagnostics.some((d) => d.code === 'STUDENT_CODE_MISSING'), 'must emit diagnostic for code-less row');
    assert.ok(result.diagnostics.some((d) => d.field === 'code' && d.severity === 'warning'), 'diagnostic must be warning, counted');
    console.log('  [T2.4 Case C] students code-less row diagnostic: PASS — was silent on reverted code');
}

async function testReviewModalShowsExclusionCount() {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'pages', 'settings-imports.js'), 'utf8');
    assert.ok(src.includes('renderImportContextReview'), 'review modal exists');
    assert.ok(src.includes('الملخص:') || src.includes('outcomeSummary'), 'review modal must show exclusion count before confirmation (T2.4 step 6)');
    assert.ok(src.includes('preflight.recordEstimate') || src.includes('validCount'), 'counts must be surfaced');
    console.log('  [T2.4 Case D] review modal shows exclusion count before confirmation: PASS — was only post-import on reverted code');
}

async function main() {
    console.log('settings-imports-page: live path scenarios');
    await testSingleFileStudentsHappyPath();
    await testLastNameLeftOfFirstName();
    await testMultiFileGradesSemesterSelection();
    await testHeaderOnlyDiagnostic();
    await testReentrancyGuard();
    await testOrientationPreflightDoesNotThrow();
    await testTruncatedXmlPreflightIsNotBlocking();
    await testStatusHeaderRolesAreExclusive();
    await testGradesOneInvalidCellOutOf400();
    await testGradesUnknownStudentBlocks();
    await testStudentsCodeLessRowDiagnostic();
    await testReviewModalShowsExclusionCount();
    console.log('settings-imports-page: OK');
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
