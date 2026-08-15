'use strict';
// Review probe: does a preflight-invalid NON-grades file still block the batch?
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

function makeSandbox() {
    const sandbox = {
        console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        window: {},
        document: {
            readyState: 'complete',
            addEventListener() {},
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            createElement() { return { classList: { add() {}, remove() {} }, appendChild() {}, replaceChildren() {}, style: {}, dataset: {} }; },
            body: { appendChild() {} }
        },
        navigator: {},
        location: { search: '' },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        ImportContext: require('./js/import-center/import-context.js'),
        ImportResultContract: require('./js/import-center/import-result-contract.js'),
        ImportReaders: require('./js/import-center/import-readers.js'),
        ImportCenterDiagnostics: require('./js/import-center/import-diagnostics-codes.js'),
        ImportCenterNormalize: require('./js/import-center/normalize.js'),
        StudentImportParser: require('./js/import-center/students-import-parser.js'),
        GradesImportParser: require('./js/import-center/grades-import-parser.js'),
        showToast() {}, showConfirm: async () => ({ confirmed: true }),
        escapeHtml: (s) => String(s || '')
    };
    sandbox.window.document = sandbox.document;
    sandbox.globalThis = sandbox;
    sandbox.window.api = {
        reports: { getIdentity: async () => ({ school_code: '10401E', school_name: 'ثانوية' }) },
        cycles: { getActive: async () => ({ cycle: { cycle_code: 'secondary_qualifiant' }, context: { cycleCode: 'secondary_qualifiant' } }) },
        students: { getAll: async () => [{ id: 1, code: 'S0001001', section: 'TCSF-1' }] },
        teachers: { getAll: async () => [{ id: 1, name: 'أستاذ' }] }
    };
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(ROOT, 'js', 'pages', 'settings-imports.js'), 'utf8');
    try { vm.runInContext(src, sandbox, { filename: 'settings-imports.js' }); }
    catch (e) { console.error('load warn:', e.message); }
    return sandbox;
}

(async () => {
    const sandbox = makeSandbox();

    // Force a known school year
    vm.runInContext('getCurrentSchoolYear = () => "2025/2026";', sandbox);
    // Neutralize type check + workbook parsing; feed a controlled preflight verdict
    vm.runInContext('ImportTypeCheck = undefined;', sandbox);
    vm.runInContext(`
        getWorkbookForImport = async () => ({ SheetNames: ['S1'] });
        getSheetRows = () => [];
        importWorkbookCache = null;
        importFilePreflightCache = null;
        applyDetectedSemesterForSingleGradeFile = () => false;
    `, sandbox);

    // ---- PROBE 1: non-grades action, preflight invalid (no context mismatch) ----
    vm.runInContext(`
        runManualImportPreflight = async () => createImportPreflightResult({
            valid: false, executable: false, recordEstimate: 0,
            errors: [{ code: 'EMPTY_FILE', message: 'الملف فارغ' }]
        });
        ImportContext.extractContext = () => ({
            sourceType: 'students', fileName: 'f.xlsx',
            schoolYear: '2025/2026', schoolYearSource: 'explicit',
            institutionCode: '10401E', institutionName: 'ثانوية',
            cycleCode: 'secondary_qualifiant', cycleConfidence: 'high',
            levels: [], streams: [], sections: [], metadataFound: {}, evidence: {}
        });
    `, sandbox);

    const studentsReview = await vm.runInContext(
        `prepareImportContextReview('students', [{ name: 'empty.xlsx', size: 0 }])`,
        sandbox
    );
    console.log('\n=== PROBE 1: students action, preflight-invalid file ===');
    console.log('status        :', studentsReview.status);
    console.log('canProceed    :', studentsReview.canProceed);
    console.log('blockingCount :', studentsReview.blockingCount);
    console.log('file.executable:', studentsReview.files[0].executable);
    console.log('EXPECTED (pre-change): canProceed=false, status=blocked');

    // ---- PROBE 2: grades, mixed batch (one good, one preflight-invalid) ----
    vm.runInContext(`
        let __n = 0;
        runManualImportPreflight = async () => {
            __n++;
            return __n === 1
                ? createImportPreflightResult({ valid: true, executable: true, recordEstimate: 10, errors: [], warnings: [], metadata: {} })
                : createImportPreflightResult({ valid: false, executable: false, recordEstimate: 0, errors: [{ code: 'EMPTY_FILE', message: 'الملف فارغ' }] });
        };
        ImportContext.extractContext = () => ({
            sourceType: 'grades', fileName: 'g.xlsx',
            schoolYear: '2025/2026', schoolYearSource: 'explicit',
            institutionCode: '10401E', institutionName: 'ثانوية',
            cycleCode: 'secondary_qualifiant', cycleConfidence: 'high',
            levels: [], streams: [], sections: [], semester: 1, metadataFound: {}, evidence: {}
        });
    `, sandbox);

    const mixed = await vm.runInContext(
        `prepareImportContextReview('grades', [{ name: 'good.xlsx', size: 100 }, { name: 'bad.xlsx', size: 0 }])`,
        sandbox
    );
    console.log('\n=== PROBE 2: grades mixed batch ===');
    console.log('status           :', mixed.status);
    console.log('canProceed       :', mixed.canProceed);
    console.log('executableCount  :', mixed.executableCount);
    console.log('blockedFileCount :', mixed.blockedFileCount);
    console.log('partial          :', mixed.canProceedPartially);
    console.log('indexes          :', mixed.files.map((f) => f.index));
    console.log('executables      :', mixed.files.map((f) => f.executable));
    console.log('blockedReasons   :', JSON.stringify(mixed.files.map((f) => f.blockedReason)));

    // ---- PROBE 3: grades, context-blocked file (school-year mismatch) ----
    vm.runInContext(`
        runManualImportPreflight = async () => createImportPreflightResult({
            valid: true, executable: true, recordEstimate: 10, errors: [], warnings: [], metadata: {}
        });
        ImportContext.extractContext = () => ({
            sourceType: 'grades', fileName: 'g.xlsx',
            schoolYear: '2019/2020', schoolYearSource: 'explicit',
            institutionCode: '10401E', institutionName: 'ثانوية',
            cycleCode: 'secondary_qualifiant', cycleConfidence: 'high',
            levels: [], streams: [], sections: [], semester: 1, metadataFound: {}, evidence: {}
        });
    `, sandbox);
    const yearBlocked = await vm.runInContext(
        `prepareImportContextReview('grades', [{ name: 'oldyear.xlsx', size: 100 }])`,
        sandbox
    );
    console.log('\n=== PROBE 3: grades, school-year mismatch ===');
    console.log('canProceed     :', yearBlocked.canProceed);
    console.log('executable     :', yearBlocked.files[0].executable);
    console.log('blockedReason  :', JSON.stringify(yearBlocked.files[0].blockedReason));
    console.log('EXPECTED: executable=false, blockedReason=SCHOOL_YEAR_MISMATCH');
})().catch((e) => { console.error('PROBE FAILED:', e); process.exitCode = 1; });
