'use strict';

/**
 * Collegial golden tests for the stage-rules resolver (Slice 2 business rules).
 *
 *   node tests/cc-rules-collegial-golden.test.js
 *
 * Pins the official collegial file (secondary_collegial / collegial-2026-v1,
 * seeded by migration 2026-08-084 from main/db/education-catalogs/collegial-rules.js):
 * 1APIC/2APIC coefficient sum = 29, 3APIC CC coefficient = 1 for every subject,
 * stream_code '*' (collegial has no stream dimension), and the two documented
 * modeling boundaries — TECHNOLOGY weights unseeded (MISSING_RULE) and the
 * 3APIC local unified exam unmodeled (never merged into the CC coefficient).
 *
 * Also pins the Slice 2 fail-closed rules: no cycle_code '*' wildcard row ever
 * matches, and authoritative paths with no cycle context fail closed with
 * RULES_UNAVAILABLE (never a qualifiant default, never a constant).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const StageRulesErrorContract = require('../js/shared/errors/stage-rules-error-contract');
const { COLLEGIAL_CYCLE, QUALIFIANT_CYCLE } = require('../js/shared/education/cycles');
const collegialRules = require('../main/db/education-catalogs/collegial-rules');

const SCHOOL_YEAR = '2025/2026';

function ruleSetPayload() {
    return {
        ruleSet: {
            id: 1,
            school_year: SCHOOL_YEAR,
            revision: 2,
            status: 'active',
            created_by: 'official-seed',
            reason: 'collegial golden fixture',
            created_at: '2026-08-01 00:00:00'
        },
        rows: {
            coefficients: collegialRules.getOfficialCollegialCoefficientRows({ ruleSetId: 1 }),
            examCounts: collegialRules.getOfficialCollegialExamCountRows({ ruleSetId: 1 }),
            weights: collegialRules.getOfficialCollegialWeightRows({ ruleSetId: 1 })
        }
    };
}

function loadCcRules(getActive) {
    const sandbox = { console, StageRulesErrorContract };
    sandbox.window = { api: { stageRules: { getActive } } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cc-rules.js'), 'utf8'), sandbox);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'education', 'collegial-levels.js'), 'utf8'),
        sandbox
    );
    return sandbox;
}

async function loadWithCollegial() {
    const cc = loadCcRules(async () => ruleSetPayload());
    await cc.ensureStageRuleSet(SCHOOL_YEAR, COLLEGIAL_CYCLE);
    return cc;
}

function collegialContext(overrides) {
    return Object.assign(
        {
            cycleCode: COLLEGIAL_CYCLE,
            cycleLabel: 'الثانوي الإعدادي',
            levelCode: '1APIC',
            levelLabel: 'الأولى إعدادي مسار دولي',
            streamCode: '*',
            streamLabel: '*',
            schoolYear: SCHOOL_YEAR
        },
        overrides
    );
}

// The 10 seeded collegial subjects with their canonical Arabic labels.
const COLLEGIAL_SUBJECTS = [
    'اللغة العربية',
    'اللغة الفرنسية',
    'الرياضيات',
    'الاجتماعيات',
    'علوم الحياة والأرض',
    'الفيزياء والكيمياء',
    'التربية الإسلامية',
    'التربية البدنية',
    'اللغة الإنجليزية',
    'المعلوميات'
];

async function main() {
    console.log('[test] cc-rules collegial golden contract');

    // 1APIC and 2APIC share the official matrix; Σ must equal the report-card
    // verified total of 29 (collegial-rules.js header).
    for (const level of ['1APIC', '2APIC']) {
        const cc = await loadWithCollegial();
        const context = collegialContext({ levelCode: level });
        let sum = 0;
        for (const subject of COLLEGIAL_SUBJECTS) {
            const res = cc.resolveSubjectCoefficient(subject, null, context);
            assert.strictEqual(res.ok, true, `${level} ${subject} must resolve (got ${res.code || 'ok=false'})`);
            assert.strictEqual(res.source, 'rule');
            sum += res.coefficient;
        }
        assert.strictEqual(sum, 29, `${level} coefficient sum must be 29 (got ${sum})`);

        const average = cc.computeWeightedGeneralAverageResult(
            COLLEGIAL_SUBJECTS.map((subject) => ({ subject, avg: 10 })),
            null,
            context
        );
        assert.strictEqual(average.ok, true);
        assert.strictEqual(average.value, 10);
        assert.strictEqual(average.incomplete, false);
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(average), true);
        console.log(`  [ok] ${level} official matrix Σ=29 and weighted average resolves`);
    }

    // 3APIC المراقبة المستمرة: coefficient 1 for every subject. The 3APIC
    // matrix swaps COMPUTER_SCIENCE for TECHNOLOGY (its coefficient IS
    // seeded; only its weight ratio is missing).
    {
        const cc = await loadWithCollegial();
        const context = collegialContext({ levelCode: '3APIC' });
        const subjects3apic = COLLEGIAL_SUBJECTS.filter((subject) => subject !== 'المعلوميات').concat([
            'التكنولوجيا'
        ]);
        assert.strictEqual(subjects3apic.length, 10);
        for (const subject of subjects3apic) {
            const res = cc.resolveSubjectCoefficient(subject, null, context);
            assert.strictEqual(res.ok, true, `3APIC ${subject} must resolve`);
            assert.strictEqual(res.coefficient, 1, `3APIC ${subject} CC coefficient must be 1`);
        }
        console.log('  [ok] 3APIC CC coefficient is 1 for every subject');
    }

    // Collegial has no stream dimension: stream '*' resolves, and the context
    // derivation supplies stream '*' + the collegial level from the section
    // (detectBranch returns null for collegial sections, so branch inference
    // alone would yield levelCode null → MISSING_RULE).
    {
        const cc = await loadWithCollegial();
        assert.strictEqual(cc.detectBranch('1APIC-3'), null);
        assert.strictEqual(cc.detectBranch('3APIC-7'), null);

        const derived = cc.resolveSubjectCoefficient('الرياضيات', null, {
            cycleCode: COLLEGIAL_CYCLE,
            section: '1APIC-3',
            schoolYear: SCHOOL_YEAR
        });
        assert.strictEqual(derived.ok, true, 'section-derived collegial context must resolve');
        assert.strictEqual(derived.coefficient, 5);

        const details = cc.buildCoefficientContext('x', 'x', null, {
            cycleCode: COLLEGIAL_CYCLE,
            section: '2APIC-5',
            schoolYear: SCHOOL_YEAR
        });
        assert.strictEqual(details.levelCode, '2APIC');
        assert.strictEqual(details.streamCode, '*');
        assert.strictEqual(details.cycleLabel, 'الثانوي الإعدادي');
        console.log('  [ok] collegial level derived from section, stream defaults to *');
    }

    // Page call-site shape (results-hub, analytics, students-list, student-profile,
    // grades-results): the page computes levelInfo via deriveStageLevel and passes
    // levelCode/streamCode (null branch) in the context. Before deriveStageLevel the
    // pages called inferQualifiantLevel(null) -> levelCode null -> MISSING_RULE for
    // every collegial student in the live app.
    {
        const cc = await loadWithCollegial();
        const branch = cc.detectBranch('3APIC-2');
        assert.strictEqual(branch, null);
        assert.strictEqual(cc.inferQualifiantLevel(branch).code, null, 'legacy qualifiant inference is blind to collegial');
        const levelInfo = cc.deriveStageLevel(COLLEGIAL_CYCLE, branch, '3APIC-2');
        assert.strictEqual(levelInfo.code, '3APIC');
        const pageContext = {
            schoolYear: SCHOOL_YEAR,
            streamCode: branch,
            cycleCode: COLLEGIAL_CYCLE,
            levelCode: levelInfo.code,
            levelLabel: levelInfo.label
        };
        const coefficient = cc.resolveSubjectCoefficient('الرياضيات', branch, pageContext);
        assert.strictEqual(coefficient.ok, true, 'page-shaped collegial context must resolve');
        assert.strictEqual(coefficient.coefficient, 1);
        const average = cc.computeWeightedGeneralAverageResult(
            [{ subject: 'الرياضيات', avg: 12 }, { subject: 'اللغة العربية', avg: 14 }],
            branch,
            pageContext
        );
        assert.strictEqual(average.ok, true, 'collegial general average must compute from the page contract');
        // Qualifiant stays on its branch inference; missing/unknown cycle never defaults to it.
        assert.strictEqual(cc.deriveStageLevel(QUALIFIANT_CYCLE, '2BACSMA', '2BACSMA-1').code, '2BAC');
        assert.strictEqual(cc.deriveStageLevel(COLLEGIAL_CYCLE, null, '').code, null);
        console.log('  [ok] page call-site shape resolves for collegial via deriveStageLevel');
    }

    // Wiring guard: every page that loads cc-rules.js must also load the collegial
    // level catalog (else deriveCollegialLevelFromSection silently returns null),
    // and no page call site may use the qualifiant-only inferQualifiantLevel directly.
    {
        const root = path.join(__dirname, '..');
        const htmlFiles = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
        const loadsCc = htmlFiles.filter((f) => /<script src="js\/cc-rules\.js"/.test(fs.readFileSync(path.join(root, f), 'utf8')));
        assert.ok(loadsCc.length >= 7, 'expected the grading pages to load cc-rules.js');
        for (const f of loadsCc) {
            assert.ok(
                /<script src="js\/shared\/education\/collegial-levels\.js"/.test(fs.readFileSync(path.join(root, f), 'utf8')),
                f + ' loads cc-rules.js without collegial-levels.js'
            );
        }
        const callSites = [...htmlFiles, 'js/pages/analytics.js', 'js/pages/results-hub.js', 'js/pages/student-profile.js', 'js/pages/students-list.js'];
        for (const f of callSites) {
            const src = fs.readFileSync(path.join(root, f), 'utf8');
            assert.ok(!/inferQualifiantLevel\s*\(/.test(src), f + ' must use deriveStageLevel, not inferQualifiantLevel');
        }
        console.log('  [ok] grading pages load collegial-levels.js and use deriveStageLevel');
    }

    // Explicit level + stream '*' resolves even when the section is absent
    // (callers that already derived the level keep working).
    {
        const cc = await loadWithCollegial();
        const res = cc.resolveSubjectCoefficient(
            'الرياضيات',
            null,
            collegialContext({ levelCode: '2APIC', streamCode: '*' })
        );
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.coefficient, 5);
        console.log('  [ok] explicit (level, stream *) context resolves');
    }

    // Official exam counts, including the documented level variation for
    // الاجتماعيات (3 in 1APIC/2APIC, 2 in 3APIC) and 2APIC-only TECHNOLOGY.
    {
        const cc = await loadWithCollegial();
        const count = (subject, level) =>
            cc.resolveExamCount(subject, null, collegialContext({ levelCode: level })).examCount;
        assert.strictEqual(count('اللغة الفرنسية', '1APIC'), 4);
        assert.strictEqual(count('الاجتماعيات', '1APIC'), 3);
        assert.strictEqual(count('الاجتماعيات', '3APIC'), 2);
        assert.strictEqual(count('التكنولوجيا', '2APIC'), 2);
        assert.strictEqual(count('الرياضيات', '3APIC'), 3);
        console.log('  [ok] collegial exam-count goldens');
    }

    // Official subject weights from the measured integrated-activities ratio.
    // (Field-wise asserts: values cross the vm boundary, so deepStrictEqual
    // would compare foreign prototypes.)
    {
        const cc = await loadWithCollegial();
        const context = collegialContext();
        const expectWeights = (subject, examWeight, activityWeight) => {
            const res = cc.resolveSubjectWeights(subject, context);
            assert.strictEqual(res.ok, true);
            assert.strictEqual(res.source, 'rule');
            assert.strictEqual(res.examWeight, examWeight);
            assert.strictEqual(res.activityWeight, activityWeight);
        };
        expectWeights('الرياضيات', 1, 0);
        expectWeights('اللغة الفرنسية', 0.8, 0.2);
        expectWeights('اللغة الإنجليزية', 0.6667, 0.3333);
        console.log('  [ok] collegial subject-weight goldens');
    }

    // TECHNOLOGY has no measured activity ratio: its weight row is unseeded by
    // design and resolution fails closed — never a guessed ratio.
    {
        const cc = await loadWithCollegial();
        const missing = cc.resolveSubjectWeights('التكنولوجيا', collegialContext());
        assert.strictEqual(missing.ok, false);
        assert.strictEqual(missing.code, 'MISSING_RULE');
        console.log('  [ok] TECHNOLOGY weights → MISSING_RULE (no guessed ratio)');
    }

    // Cross-cycle wildcard regression: a cycle_code '*' row must NEVER match,
    // in coefficients, exam counts, or weights.
    {
        const poisoned = ruleSetPayload();
        poisoned.rows.coefficients = [
            {
                cycle_code: '*',
                level_code: '*',
                stream_code: '*',
                subject_code: 'MATH',
                coefficient: 99,
                source: 'official'
            }
        ];
        poisoned.rows.examCounts = [
            { cycle_code: '*', level_code: '*', subject_code: 'MATH', exam_count: 9, source: 'official' }
        ];
        poisoned.rows.weights = [
            {
                cycle_code: '*',
                subject_code: 'MATH',
                exam_weight_bps: 1000,
                activity_weight_bps: 9000,
                source: 'official'
            }
        ];
        const cc = loadCcRules(async () => poisoned);
        await cc.ensureStageRuleSet(SCHOOL_YEAR, COLLEGIAL_CYCLE);
        const context = collegialContext({ levelCode: '1APIC' });
        const coefficient = cc.resolveSubjectCoefficient('الرياضيات', null, context);
        assert.strictEqual(coefficient.ok, false);
        assert.strictEqual(coefficient.code, 'MISSING_RULE');
        const examCount = cc.resolveExamCount('الرياضيات', null, context);
        assert.strictEqual(examCount.ok, false);
        assert.strictEqual(examCount.code, 'MISSING_RULE');
        const weights = cc.resolveSubjectWeights('الرياضيات', context);
        assert.strictEqual(weights.ok, false);
        assert.strictEqual(weights.code, 'MISSING_RULE');
        console.log('  [ok] cycle_code * rows never match (coefficients, exam counts, weights)');
    }

    // Missing/ambiguous cycle context on authoritative paths fails closed with
    // RULES_UNAVAILABLE — never a qualifiant default, never a constant.
    {
        const cc = await loadWithCollegial();
        const payload = ruleSetPayload();
        const noCycle = { schoolYear: SCHOOL_YEAR, ruleSet: payload };
        const coefficient = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', noCycle);
        assert.strictEqual(coefficient.ok, false);
        assert.strictEqual(coefficient.code, 'RULES_UNAVAILABLE');
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(coefficient), false);
        const examCount = cc.resolveExamCount('الرياضيات', '2BACSMA', noCycle);
        assert.strictEqual(examCount.ok, false);
        assert.strictEqual(examCount.code, 'RULES_UNAVAILABLE');
        const average = cc.computeWeightedGeneralAverageResult([{ subject: 'الرياضيات', avg: 16 }], '2BACSMA', noCycle);
        assert.strictEqual(average.ok, false);
        assert.strictEqual(average.code, 'RULES_UNAVAILABLE');
        assert.strictEqual(average.metadata.officialExportBlocked, true);
        console.log('  [ok] missing cycle context → RULES_UNAVAILABLE on authoritative paths');
    }

    // Stage isolation: collegial rows never resolve for a qualifiant context
    // and qualifiant rows never resolve for a collegial context. The payload
    // is injected explicitly so this pins lookup-level isolation (the
    // cycle-keyed cache refuses cross-cycle reads one layer earlier with
    // RULES_UNAVAILABLE — pinned in cc-rules-stage-cache.test.js).
    {
        const cc = await loadWithCollegial();
        const qualifiantContext = {
            cycleCode: QUALIFIANT_CYCLE,
            cycleLabel: 'الثانوي التأهيلي',
            levelCode: '2BAC',
            levelLabel: 'السنة الثانية بكالوريا',
            streamCode: '2BACSMA',
            streamLabel: 'علوم رياضية أ',
            schoolYear: SCHOOL_YEAR,
            ruleSet: ruleSetPayload()
        };
        const cross = cc.resolveSubjectCoefficient('الرياضيات', '2BACSMA', qualifiantContext);
        assert.strictEqual(cross.ok, false);
        assert.strictEqual(cross.code, 'MISSING_RULE');
        assert.strictEqual(cross.details.cycleCode, QUALIFIANT_CYCLE);
        console.log('  [ok] collegial rows never resolve for a qualifiant context');
    }

    // Legacy branch table stays available ONLY through the explicit
    // non-authoritative helper: provisional, never authoritative, and always
    // blocking official export.
    {
        const cc = await loadWithCollegial();
        const provisional = cc.resolveProvisionalBranchCoefficient('الرياضيات', '2BACSMA');
        assert.strictEqual(provisional.ok, true);
        assert.strictEqual(provisional.coefficient, 9);
        assert.strictEqual(provisional.isAuthoritative, false);
        assert.strictEqual(provisional.provisional, true);
        assert.strictEqual(provisional.officialExportBlocked, true);
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(provisional), false);
        const unknown = cc.resolveProvisionalBranchCoefficient('مادة مجهولة', '2BACSMA');
        assert.strictEqual(unknown.ok, false);
        assert.strictEqual(unknown.isAuthoritative, false);
        assert.strictEqual(StageRulesErrorContract.isOfficialExportAllowed(unknown), false);
        console.log('  [ok] legacy branch fallback is provisional-only and export-blocked');
    }

    console.log('[test] cc-rules collegial golden contract: all checks passed');
}

main().catch((err) => {
    console.error('FAIL: cc-rules collegial golden contract — ' + (err && err.message ? err.message : err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
});
