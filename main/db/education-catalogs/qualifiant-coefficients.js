/**
 * Official branch coefficients for the qualifiant cycle (029-stage-rules-management).
 * Reference data extracted verbatim from CC_BRANCH_COEFFICIENTS
 * (js/cc-rules.js, ministry note 142). Text keys are mapped to subject codes
 * through the subject catalog; unmappable keys are collected instead of being
 * guessed. Level codes are derived from the branch prefix and every branch is
 * cross-checked against LEVEL_CODES (main/db/exam-count-defaults.js).
 */

const { LEVEL_CODES } = require('../exam-count-defaults');
const { mapSubjectToCode } = require('./subject-catalog');
const { QUALIFIANT_CYCLE } = require('../../../js/shared/education/cycles');

const CC_BRANCH_COEFFICIENTS_SOURCE = {
    '2BACSMA': {
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'الرياضيات': 9,
        'الفيزياء والكيمياء': 7,
        'الفيزياء': 7,
        'علوم الحياة والأرض': 3,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '2BACSMB': {
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'الرياضيات': 9,
        'الفيزياء والكيمياء': 7,
        'الفيزياء': 7,
        'علوم المهندس': 5,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '2BACSP': {
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'الرياضيات': 7,
        'الفيزياء والكيمياء': 7,
        'الفيزياء': 7,
        'علوم الحياة والأرض': 5,
        'التربية البدنية': 4,
        'التربية البدنية والرياضية': 4
    },
    '2BACSVT': {
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'الرياضيات': 5,
        'الفيزياء والكيمياء': 5,
        'الفيزياء': 5,
        'علوم الحياة والأرض': 9,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '2BACSEC': {
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 3,
        'اللغة الفرنسية': 3,
        'الفرنسية': 3,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'الرياضيات': 4,
        'الاقتصاد العام والإحصاء': 6,
        'الاقتصاد': 6,
        'الاقتصاد والتنظيم الإداري للمقاولات': 3,
        'الاقتصاد والتنظيم الإداري': 3,
        'المحاسبة والرياضيات المالية': 4,
        'المحاسبة': 4,
        'القانون': 4,
        'معلوميات التدبير': 4,
        'المعلوميات': 4,
        'الاجتماعيات': 3,
        'التاريخ والجغرافيا': 3,
        'التربية البدنية': 4,
        'التربية البدنية والرياضية': 4
    },
    '2BACSGC': {
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'الرياضيات': 5,
        'المحاسبة المعمقة': 9,
        'المحاسبة': 9,
        'الاقتصاد والتنظيم الإداري': 5,
        'الاقتصاد': 5,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '2BACLET': {
        'اللغة العربية': 4,
        'التربية الإسلامية': 2,
        'الفلسفة': 3,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'التاريخ والجغرافيا': 3,
        'الاجتماعيات': 3,
        'الرياضيات': 2,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '2BACSH': {
        'اللغة العربية': 3,
        'التربية الإسلامية': 2,
        'الفلسفة': 4,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 3,
        'الإنجليزية': 3,
        'الانجليزية': 3,
        'اللغة الإنجليزية': 3,
        'اللغة الانجليزية': 3,
        'التاريخ': 4,
        'الجغرافيا': 4,
        'التاريخ والجغرافيا': 4,
        'الاجتماعيات': 4,
        'الرياضيات': 1,
        'التربية البدنية': 4,
        'التربية البدنية والرياضية': 4
    },
    '2BACAO': {
        'اللغة العربية': 3,
        'علوم القرآن والحديث': 5,
        'الفقه وأصوله': 5,
        'التوحيد والفكر الإسلامي': 4,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 2,
        'اللغة الفرنسية': 2,
        'الفرنسية': 2,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'الرياضيات': 2,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '1BACSM': {
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'الرياضيات': 9,
        'الفيزياء والكيمياء': 7,
        'الفيزياء': 7,
        'علوم الحياة والأرض': 3,
        'الاجتماعيات': 2,
        'التاريخ والجغرافيا': 2,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '1BACSE': {
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'الرياضيات': 7,
        'الفيزياء والكيمياء': 7,
        'الفيزياء': 7,
        'علوم الحياة والأرض': 7,
        'الاجتماعيات': 2,
        'التاريخ والجغرافيا': 2,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '1BACSH': {
        'اللغة العربية': 4,
        'التربية الإسلامية': 2,
        'الفلسفة': 4,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 4,
        'الإنجليزية': 4,
        'الانجليزية': 4,
        'اللغة الإنجليزية': 4,
        'اللغة الانجليزية': 4,
        'الرياضيات': 1,
        'الاجتماعيات': 4,
        'التاريخ والجغرافيا': 4,
        'علوم الحياة والأرض': 1,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    'TCS': {
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 3,
        'اللغة الفرنسية': 3,
        'الفرنسية': 3,
        'اللغة الأجنبية الثانية': 3,
        'الإنجليزية': 3,
        'الانجليزية': 3,
        'اللغة الإنجليزية': 3,
        'اللغة الانجليزية': 3,
        'الرياضيات': 4,
        'الفيزياء والكيمياء': 4,
        'الفيزياء': 4,
        'علوم الحياة والأرض': 4,
        'الاجتماعيات': 2,
        'التاريخ والجغرافيا': 2,
        'المعلوميات': 2,
        'التربية البدنية': 2,
        'التربية البدنية والرياضية': 2
    },
    'TCLSH': {
        'اللغة العربية': 4,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 3,
        'الإنجليزية': 3,
        'الانجليزية': 3,
        'اللغة الإنجليزية': 3,
        'اللغة الانجليزية': 3,
        'الرياضيات': 2,
        'الاجتماعيات': 4,
        'التاريخ والجغرافيا': 4,
        'علوم الحياة والأرض': 2,
        'المعلوميات': 2,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '1BACSEG': {
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 3,
        'اللغة الفرنسية': 3,
        'الفرنسية': 3,
        'اللغة الأجنبية الثانية': 2,
        'الإنجليزية': 2,
        'الانجليزية': 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'الرياضيات': 4,
        'الاقتصاد العام والإحصاء': 6,
        'الاقتصاد': 6,
        'الاقتصاد والتنظيم الإداري للمقاولات': 3,
        'الاقتصاد والتنظيم الإداري': 3,
        'المحاسبة والرياضيات المالية': 4,
        'المحاسبة': 4,
        'القانون': 1,
        'معلوميات التدبير': 1,
        'المعلوميات': 1,
        'الاجتماعيات': 3,
        'التاريخ والجغرافيا': 3,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    }
};

/**
 * Branch-level disambiguation for text keys that are ambiguous globally:
 * in 2BACSGC the bare 'الاقتصاد' key refers to the management-economics
 * subject (coefficient 5 matches 'الاقتصاد والتنظيم الإداري'), not to
 * الاقتصاد العام والإحصاء.
 */
const BRANCH_KEY_OVERRIDES = {
    '2BACSGC': {
        'الاقتصاد': 'ECONOMICS_MANAGEMENT'
    }
};

const _OFFICIAL_BUILD = _buildOfficialBranchCoefficients();
const OFFICIAL_BRANCH_COEFFICIENTS = Object.freeze(_OFFICIAL_BUILD.result);
const UNMAPPED_COEFFICIENT_SUBJECTS = Object.freeze(_OFFICIAL_BUILD.unmapped);

function _buildOfficialBranchCoefficients() {
    const result = {};
    const unmapped = [];
    for (const [branch, table] of Object.entries(CC_BRANCH_COEFFICIENTS_SOURCE)) {
        const branchOverrides = BRANCH_KEY_OVERRIDES[branch] || {};
        const branchCoefficients = {};
        for (const [subject, coefficient] of Object.entries(table)) {
            const code = branchOverrides[subject] || mapSubjectToCode(subject);
            if (!code) {
                unmapped.push({ branch, subject });
                continue;
            }
            if (!branchCoefficients[code]) branchCoefficients[code] = coefficient;
        }
        result[branch] = branchCoefficients;
    }
    return { result, unmapped };
}

/**
 * Derive the level code from a branch key: 2BAC* → '2BAC', 1BAC* → '1BAC',
 * TCS/TCLSH → 'TC'.
 */
function deriveLevelFromBranch(branch) {
    const b = String(branch || '');
    if (b.startsWith('2BAC')) return '2BAC';
    if (b.startsWith('1BAC')) return '1BAC';
    if (b === 'TCS' || b === 'TCLSH') return 'TC';
    return null;
}

(function _validateBranchLevels() {
    const knownLevels = new Set(LEVEL_CODES.map((level) => level.code));
    for (const branch of Object.keys(CC_BRANCH_COEFFICIENTS_SOURCE)) {
        if (!knownLevels.has(branch)) {
            throw new Error(`qualifiant-coefficients: branch "${branch}" missing from LEVEL_CODES`);
        }
        if (!deriveLevelFromBranch(branch)) {
            throw new Error(`qualifiant-coefficients: cannot derive level_code from branch "${branch}"`);
        }
    }
})();

/**
 * Build the official coefficient rows for a rule set.
 * @returns {Array<{rule_set_id: number, cycle_code: string, level_code: string,
 * stream_code: string, subject_code: string, coefficient: number, source: string}>}
 */
function getOfficialCoefficientRows({ ruleSetId, cycleCode }) {
    if (!ruleSetId) throw new Error('getOfficialCoefficientRows: ruleSetId required');
    const cycle = cycleCode || QUALIFIANT_CYCLE;
    const rows = [];
    for (const [branch, coefficients] of Object.entries(OFFICIAL_BRANCH_COEFFICIENTS)) {
        const levelCode = deriveLevelFromBranch(branch);
        for (const [subjectCode, coefficient] of Object.entries(coefficients)) {
            rows.push({
                rule_set_id: ruleSetId,
                cycle_code: cycle,
                level_code: levelCode,
                stream_code: branch,
                subject_code: subjectCode,
                coefficient,
                source: 'official'
            });
        }
    }
    return rows;
}

/**
 * Idempotent seed of the official coefficients into subject_coefficients.
 */
function seedOfficialCoefficients(db, ruleSetId, cycleCode) {
    const rows = getOfficialCoefficientRows({ ruleSetId, cycleCode });
    const insert = db.prepare(
        `INSERT OR IGNORE INTO subject_coefficients(
            rule_set_id, cycle_code, level_code, stream_code, subject_code, coefficient, source
         ) VALUES (@rule_set_id, @cycle_code, @level_code, @stream_code, @subject_code, @coefficient, @source)`
    );
    const seed = db.transaction(() => {
        for (const row of rows) insert.run(row);
    });
    seed();
}

module.exports = {
    CC_BRANCH_COEFFICIENTS_SOURCE,
    OFFICIAL_BRANCH_COEFFICIENTS,
    UNMAPPED_COEFFICIENT_SUBJECTS,
    deriveLevelFromBranch,
    getOfficialCoefficientRows,
    seedOfficialCoefficients
};
