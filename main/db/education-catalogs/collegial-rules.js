'use strict';

/**
 * Official collegial-cycle rule data (secondary_collegial).
 *
 * Source of truth: the school dossier at `D:\secondaire\` —
 *   - `معاملات المواد -نتاءئج مدرسية.md`: بيان النتائج الدراسية (report cards) for 1APIC-1, 2APIC-1,
 *     3APIC-1 — the applied معاملات per level (verified against the printed
 *     «مجموع ن×م» / «معدل الدورة»: 1APIC Σ=29 → 161,05/29 = 5,55 ✓,
 *     2APIC Σ=29 → 271,87/29 = 9,37 ✓);
 *   - `نسبة_الأنشطة_المندمجة_الشامل.md`: exam counts per level + the empirically
 *     measured integrated-activities ratio (نسبة الأنشطة المندمجة) per subject.
 *
 * Representation decisions:
 *   - Collegial uses an exams + integrated-activities hybrid: subject average =
 *     (متوسط الفروض × (1−ن)) + (نقطة الأنشطة المندمجة × ن) — expressed by the
 *     existing subject_weight_rules (exam_weight_bps + activity_weight_bps = 10000)
 *     exactly as the qualifiant CC weights already work.
 *   - stream_code = '*' — collegial has no branch/stream dimension in the resolver.
 *   - 3APIC adds a local unified exam (الامتحان الموحد المحلي) whose coefficient
 *     table (عربية/فرنسية/رياضيات = 3, الباقي = 1) has NO representable dimension
 *     in subject_coefficients today. The المراقبة المستمرة part (معامل 1 لكل مادة)
 *     IS seeded; the local-exam dimension is documented as a known modeling gap
 *     (never merged into the CC coefficient — no silent guess).
 *   - TECHNOLOGY has no measured activity ratio yet → its weight row is NOT seeded
 *     (resolution = MISSING_RULE fail-closed, never a guessed ratio).
 */

const { COLLEGIAL_CYCLE } = require('../../../js/shared/education/cycles');

/**
 * Official coefficients per level (from markdown22.md).
 * 1APIC and 2APIC share the same matrix; 3APIC's المراقبة المستمرة uses معامل 1
 * for every subject (the local-exam dimension is separate — see module header).
 */
const COLLEGIAL_COEFFICIENTS = [
    // 1APIC / 2APIC — verified Σ=29 (report cards).
    { level_code: '1APIC', stream_code: '*', subject_code: 'ARABIC', coefficient: 5 },
    { level_code: '1APIC', stream_code: '*', subject_code: 'FRENCH', coefficient: 5 },
    { level_code: '1APIC', stream_code: '*', subject_code: 'MATH', coefficient: 5 },
    { level_code: '1APIC', stream_code: '*', subject_code: 'SOCIAL_STUDIES', coefficient: 3 },
    { level_code: '1APIC', stream_code: '*', subject_code: 'EARTH_SCIENCES', coefficient: 3 },
    { level_code: '1APIC', stream_code: '*', subject_code: 'PHYSICS_CHEMISTRY', coefficient: 2 },
    { level_code: '1APIC', stream_code: '*', subject_code: 'ISLAMIC_EDUCATION', coefficient: 2 },
    { level_code: '1APIC', stream_code: '*', subject_code: 'PHYSICAL_EDUCATION', coefficient: 2 },
    { level_code: '1APIC', stream_code: '*', subject_code: 'ENGLISH', coefficient: 1 },
    { level_code: '1APIC', stream_code: '*', subject_code: 'COMPUTER_SCIENCE', coefficient: 1 },

    { level_code: '2APIC', stream_code: '*', subject_code: 'ARABIC', coefficient: 5 },
    { level_code: '2APIC', stream_code: '*', subject_code: 'FRENCH', coefficient: 5 },
    { level_code: '2APIC', stream_code: '*', subject_code: 'MATH', coefficient: 5 },
    { level_code: '2APIC', stream_code: '*', subject_code: 'SOCIAL_STUDIES', coefficient: 3 },
    { level_code: '2APIC', stream_code: '*', subject_code: 'EARTH_SCIENCES', coefficient: 3 },
    { level_code: '2APIC', stream_code: '*', subject_code: 'PHYSICS_CHEMISTRY', coefficient: 2 },
    { level_code: '2APIC', stream_code: '*', subject_code: 'ISLAMIC_EDUCATION', coefficient: 2 },
    { level_code: '2APIC', stream_code: '*', subject_code: 'PHYSICAL_EDUCATION', coefficient: 2 },
    { level_code: '2APIC', stream_code: '*', subject_code: 'ENGLISH', coefficient: 1 },
    { level_code: '2APIC', stream_code: '*', subject_code: 'COMPUTER_SCIENCE', coefficient: 1 },

    // 3APIC — المراقبة المستمرة (كل المواد معامل 1). Local-exam dimension deferred.
    { level_code: '3APIC', stream_code: '*', subject_code: 'ARABIC', coefficient: 1 },
    { level_code: '3APIC', stream_code: '*', subject_code: 'FRENCH', coefficient: 1 },
    { level_code: '3APIC', stream_code: '*', subject_code: 'MATH', coefficient: 1 },
    { level_code: '3APIC', stream_code: '*', subject_code: 'SOCIAL_STUDIES', coefficient: 1 },
    { level_code: '3APIC', stream_code: '*', subject_code: 'EARTH_SCIENCES', coefficient: 1 },
    { level_code: '3APIC', stream_code: '*', subject_code: 'PHYSICS_CHEMISTRY', coefficient: 1 },
    { level_code: '3APIC', stream_code: '*', subject_code: 'ISLAMIC_EDUCATION', coefficient: 1 },
    { level_code: '3APIC', stream_code: '*', subject_code: 'PHYSICAL_EDUCATION', coefficient: 1 },
    { level_code: '3APIC', stream_code: '*', subject_code: 'ENGLISH', coefficient: 1 },
    { level_code: '3APIC', stream_code: '*', subject_code: 'TECHNOLOGY', coefficient: 1 }
];


/**
 * Official exam counts per level (from نسبة_الأنشطة_المندمجة_الشامل.md).
 * Note: الاجتماعيات has 3 فروض in 1APIC/2APIC but 2 in 3APIC (the source's own
 * documented level variation); التكنولوجيا appears in 2APIC only.
 */
const COLLEGIAL_EXAM_COUNTS = [
    { level_code: '1APIC', subject_code: 'ARABIC', exam_count: 2 },
    { level_code: '1APIC', subject_code: 'FRENCH', exam_count: 4 },
    { level_code: '1APIC', subject_code: 'ENGLISH', exam_count: 2 },
    { level_code: '1APIC', subject_code: 'SOCIAL_STUDIES', exam_count: 3 },
    { level_code: '1APIC', subject_code: 'EARTH_SCIENCES', exam_count: 2 },
    { level_code: '1APIC', subject_code: 'PHYSICS_CHEMISTRY', exam_count: 3 },
    { level_code: '1APIC', subject_code: 'ISLAMIC_EDUCATION', exam_count: 2 },
    { level_code: '1APIC', subject_code: 'COMPUTER_SCIENCE', exam_count: 3 },
    { level_code: '1APIC', subject_code: 'MATH', exam_count: 3 },
    { level_code: '1APIC', subject_code: 'PHYSICAL_EDUCATION', exam_count: 3 },

    { level_code: '2APIC', subject_code: 'ARABIC', exam_count: 2 },
    { level_code: '2APIC', subject_code: 'FRENCH', exam_count: 4 },
    { level_code: '2APIC', subject_code: 'ENGLISH', exam_count: 2 },
    { level_code: '2APIC', subject_code: 'SOCIAL_STUDIES', exam_count: 3 },
    { level_code: '2APIC', subject_code: 'EARTH_SCIENCES', exam_count: 2 },
    { level_code: '2APIC', subject_code: 'PHYSICS_CHEMISTRY', exam_count: 3 },
    { level_code: '2APIC', subject_code: 'ISLAMIC_EDUCATION', exam_count: 2 },
    { level_code: '2APIC', subject_code: 'COMPUTER_SCIENCE', exam_count: 3 },
    { level_code: '2APIC', subject_code: 'MATH', exam_count: 3 },
    { level_code: '2APIC', subject_code: 'PHYSICAL_EDUCATION', exam_count: 3 },
    { level_code: '2APIC', subject_code: 'TECHNOLOGY', exam_count: 2 },

    { level_code: '3APIC', subject_code: 'ARABIC', exam_count: 2 },
    { level_code: '3APIC', subject_code: 'FRENCH', exam_count: 4 },
    { level_code: '3APIC', subject_code: 'ENGLISH', exam_count: 2 },
    { level_code: '3APIC', subject_code: 'SOCIAL_STUDIES', exam_count: 2 },
    { level_code: '3APIC', subject_code: 'EARTH_SCIENCES', exam_count: 2 },
    { level_code: '3APIC', subject_code: 'PHYSICS_CHEMISTRY', exam_count: 3 },
    { level_code: '3APIC', subject_code: 'ISLAMIC_EDUCATION', exam_count: 2 },
    { level_code: '3APIC', subject_code: 'COMPUTER_SCIENCE', exam_count: 3 },
    { level_code: '3APIC', subject_code: 'MATH', exam_count: 3 },
    { level_code: '3APIC', subject_code: 'PHYSICAL_EDUCATION', exam_count: 3 }
];


/**
 * Official subject weights (exam/activity basis points) from the measured
 * integrated-activities ratio in نسبة_الأنشطة_المندمجة_الشامل.md.
 * TECHNOLOGY is deliberately absent — no measured ratio (fail-closed MISSING_RULE).
 */
const COLLEGIAL_WEIGHTS = [
    { subject_code: 'ARABIC', exam_weight_bps: 7500, activity_weight_bps: 2500 },
    { subject_code: 'FRENCH', exam_weight_bps: 8000, activity_weight_bps: 2000 },
    { subject_code: 'ENGLISH', exam_weight_bps: 6667, activity_weight_bps: 3333 },
    { subject_code: 'SOCIAL_STUDIES', exam_weight_bps: 7500, activity_weight_bps: 2500 },
    { subject_code: 'EARTH_SCIENCES', exam_weight_bps: 7500, activity_weight_bps: 2500 },
    { subject_code: 'PHYSICS_CHEMISTRY', exam_weight_bps: 7500, activity_weight_bps: 2500 },
    { subject_code: 'ISLAMIC_EDUCATION', exam_weight_bps: 6667, activity_weight_bps: 3333 },
    { subject_code: 'COMPUTER_SCIENCE', exam_weight_bps: 8000, activity_weight_bps: 2000 },
    { subject_code: 'MATH', exam_weight_bps: 10000, activity_weight_bps: 0 },
    { subject_code: 'PHYSICAL_EDUCATION', exam_weight_bps: 10000, activity_weight_bps: 0 }
];

/** Validate every seeded weight sums to exactly 10000 basis points. */
(function _validateWeights() {
    for (const row of COLLEGIAL_WEIGHTS) {
        if (row.exam_weight_bps + row.activity_weight_bps !== 10000) {
            throw new Error(`collegial-rules: invalid weight for ${row.subject_code}`);
        }
    }
})();

/** Build official coefficient rows for a rule set (rule_set_id bound by caller). */
function getOfficialCollegialCoefficientRows({ ruleSetId, cycleCode = COLLEGIAL_CYCLE }) {
    if (!ruleSetId) throw new Error('getOfficialCollegialCoefficientRows: ruleSetId required');
    return COLLEGIAL_COEFFICIENTS.map((row) => ({
        rule_set_id: ruleSetId,
        cycle_code: cycleCode,
        level_code: row.level_code,
        stream_code: row.stream_code,
        subject_code: row.subject_code,
        coefficient: row.coefficient,
        source: 'official'
    }));
}

/** Build official exam-count rows for a rule set. */
function getOfficialCollegialExamCountRows({ ruleSetId, cycleCode = COLLEGIAL_CYCLE }) {
    if (!ruleSetId) throw new Error('getOfficialCollegialExamCountRows: ruleSetId required');
    return COLLEGIAL_EXAM_COUNTS.map((row) => ({
        rule_set_id: ruleSetId,
        cycle_code: cycleCode,
        level_code: row.level_code,
        subject_code: row.subject_code,
        exam_count: row.exam_count,
        source: 'official'
    }));
}

/** Build official weight rows for a rule set. */
function getOfficialCollegialWeightRows({ ruleSetId, cycleCode = COLLEGIAL_CYCLE }) {
    if (!ruleSetId) throw new Error('getOfficialCollegialWeightRows: ruleSetId required');
    return COLLEGIAL_WEIGHTS.map((row) => ({
        rule_set_id: ruleSetId,
        cycle_code: cycleCode,
        subject_code: row.subject_code,
        exam_weight_bps: row.exam_weight_bps,
        activity_weight_bps: row.activity_weight_bps,
        source: 'official'
    }));
}

/** Idempotent seed of all collegial rule rows into one rule set (INSERT OR IGNORE). */
function seedOfficialCollegialRows(db, ruleSetId, cycleCode = COLLEGIAL_CYCLE) {
    const insertCoefficient = db.prepare(
        `INSERT OR IGNORE INTO subject_coefficients(
            rule_set_id, cycle_code, level_code, stream_code, subject_code, coefficient, source
         ) VALUES (@rule_set_id, @cycle_code, @level_code, @stream_code, @subject_code, @coefficient, @source)`
    );
    const insertExamCount = db.prepare(
        `INSERT OR IGNORE INTO exam_count_rules(
            rule_set_id, cycle_code, level_code, subject_code, exam_count, source
         ) VALUES (@rule_set_id, @cycle_code, @level_code, @subject_code, @exam_count, @source)`
    );
    const insertWeight = db.prepare(
        `INSERT OR IGNORE INTO subject_weight_rules(
            rule_set_id, cycle_code, subject_code, exam_weight_bps, activity_weight_bps, source
         ) VALUES (@rule_set_id, @cycle_code, @subject_code, @exam_weight_bps, @activity_weight_bps, @source)`
    );
    const seed = db.transaction(() => {
        for (const row of getOfficialCollegialCoefficientRows({ ruleSetId, cycleCode })) insertCoefficient.run(row);
        for (const row of getOfficialCollegialExamCountRows({ ruleSetId, cycleCode })) insertExamCount.run(row);
        for (const row of getOfficialCollegialWeightRows({ ruleSetId, cycleCode })) insertWeight.run(row);
    });
    seed();
}

/**
 * Idempotent startup/upgrade helper (mirrors migration 2026-08-084 section c):
 * seeds the collegial official rows + the per-year assignment into every ACTIVE
 * stage_rule_sets revision. Runs after migrations on app start so school years
 * created after the collegial migration also receive their collegial official
 * rules without a new revision or any capture (local seed data, zero outbox).
 */
function ensureCollegialForActiveRevisions(db) {
    if (!db) return;
    const { ensureCycleProfilesSchema } = require('../schema');
    ensureCycleProfilesSchema(db);
    const hasAssignments = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cycle_profile_assignments'`)
        .get();
    if (!hasAssignments) return;
    const activeSets = db
        .prepare(`SELECT school_year, id FROM stage_rule_sets WHERE status = 'active'`)
        .all();
    const upsertAssignment = db.prepare(
        `INSERT INTO cycle_profile_assignments(
            school_year, cycle_code, profile_version, rule_set_id
         ) VALUES (?, ?, 'collegial-2026-v1', ?)
         ON CONFLICT(school_year, cycle_code) DO UPDATE SET
            profile_version = excluded.profile_version,
            rule_set_id = excluded.rule_set_id`
    );
    for (const set of activeSets) {
        seedOfficialCollegialRows(db, set.id);
        upsertAssignment.run(set.school_year, COLLEGIAL_CYCLE, set.id);
    }
}

module.exports = {
    COLLEGIAL_COEFFICIENTS,
    COLLEGIAL_EXAM_COUNTS,
    COLLEGIAL_WEIGHTS,
    getOfficialCollegialCoefficientRows,
    getOfficialCollegialExamCountRows,
    getOfficialCollegialWeightRows,
    seedOfficialCollegialRows,
    ensureCollegialForActiveRevisions
};
