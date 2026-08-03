'use strict';

const { SUBJECT_CATALOG } = require('./subject-catalog');
const { QUALIFIANT_CYCLE } = require('../../../js/shared/education/cycles');

const DEFAULT_EXAM_WEIGHT_BPS = 7500;
const DEFAULT_ACTIVITY_WEIGHT_BPS = 2500;

const OFFICIAL_WEIGHT_OVERRIDES = Object.freeze({
    MATH: [10000, 0],
    FRENCH: [8000, 2000],
    ENGLISH: [6000, 4000],
    SPANISH: [6000, 4000],
    GERMAN: [6000, 4000],
    ITALIAN: [6000, 4000],
    FOREIGN_LANGUAGE_2: [6000, 4000]
});

function getOfficialSubjectWeightRows({ ruleSetId, cycleCode = QUALIFIANT_CYCLE }) {
    if (!ruleSetId) throw new Error('getOfficialSubjectWeightRows: ruleSetId required');

    return Object.keys(SUBJECT_CATALOG).map((subjectCode) => {
        const [examWeightBps, activityWeightBps] =
            OFFICIAL_WEIGHT_OVERRIDES[subjectCode] || [DEFAULT_EXAM_WEIGHT_BPS, DEFAULT_ACTIVITY_WEIGHT_BPS];
        return {
            rule_set_id: ruleSetId,
            cycle_code: cycleCode,
            subject_code: subjectCode,
            exam_weight_bps: examWeightBps,
            activity_weight_bps: activityWeightBps,
            source: 'official'
        };
    });
}

function seedOfficialSubjectWeights(db, ruleSetId, cycleCode) {
    const rows = getOfficialSubjectWeightRows({ ruleSetId, cycleCode });
    const insert = db.prepare(
        `INSERT OR IGNORE INTO subject_weight_rules(
            rule_set_id, cycle_code, subject_code, exam_weight_bps, activity_weight_bps, source
         ) VALUES (@rule_set_id, @cycle_code, @subject_code, @exam_weight_bps, @activity_weight_bps, @source)`
    );
    const seed = db.transaction(() => {
        for (const row of rows) insert.run(row);
    });
    seed();
}

module.exports = {
    DEFAULT_EXAM_WEIGHT_BPS,
    DEFAULT_ACTIVITY_WEIGHT_BPS,
    OFFICIAL_WEIGHT_OVERRIDES,
    getOfficialSubjectWeightRows,
    seedOfficialSubjectWeights
};
