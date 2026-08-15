'use strict';

const { getMessage } = require('../../js/shared/errors/stage-rules-error-contract');
const { captureResolvedRows, notifyCaptureCommitted } = require('./capture-port');
const { getOfficialCoefficientRows } = require('../db/education-catalogs/qualifiant-coefficients');
const { getOfficialSubjectWeightRows } = require('../db/education-catalogs/subject-weights');
const { mapSubjectToCode } = require('../db/education-catalogs/subject-catalog');
const { DEFAULT_EXAM_COUNTS } = require('../db/exam-count-defaults');
const { QUALIFIANT_CYCLE } = require('../../js/shared/education/cycles');

function stageRulesError(code, message) {
    const error = new Error(message || getMessage(code) || code);
    error.code = code;
    return error;
}

function requireReason(reason) {
    const normalized = String(reason || '').trim();
    if (!normalized || normalized.length > 500) throw stageRulesError('REASON_REQUIRED');
    return normalized;
}

function normalizeCoefficientEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map((entry) => {
        const cycleCode = String(entry?.cycleCode || '').trim();
        const levelCode = String(entry?.levelCode || '').trim();
        const streamCode = String(entry?.streamCode || '').trim();
        const subjectCode = String(entry?.subjectCode || '').trim();
        const coefficient = Number(entry?.coefficient);
        if (!cycleCode || !levelCode || !streamCode || !subjectCode) {
            throw stageRulesError('RULES_INPUT_INVALID', 'المدخل غير مكتمل: يجب تحديد السلك والمستوى والشعبة والمادة');
        }
        if (!Number.isInteger(coefficient) || coefficient < 1 || coefficient > 20) {
            throw stageRulesError('COEFFICIENT_OUT_OF_RANGE');
        }
        return { cycle_code: cycleCode, level_code: levelCode, stream_code: streamCode, subject_code: subjectCode, coefficient };
    });
}

function normalizeExamCountEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map((entry) => {
        const cycleCode = String(entry?.cycleCode || '').trim();
        const levelCode = String(entry?.levelCode || '').trim();
        const subjectCode = String(entry?.subjectCode || '').trim();
        const examCount = Number(entry?.examCount);
        if (!cycleCode || !levelCode || !subjectCode) {
            throw stageRulesError('RULES_INPUT_INVALID', 'المدخل غير مكتمل: يجب تحديد السلك والمستوى والمادة');
        }
        if (!Number.isInteger(examCount) || examCount < 1 || examCount > 12) {
            throw stageRulesError('EXAM_COUNT_OUT_OF_RANGE');
        }
        return { cycle_code: cycleCode, level_code: levelCode, subject_code: subjectCode, exam_count: examCount };
    });
}

function normalizeWeightEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map((entry) => {
        const cycleCode = String(entry?.cycleCode || '').trim();
        const subjectCode = String(entry?.subjectCode || '').trim();
        const examWeightBps = Number(entry?.examWeightBps);
        const activityWeightBps = Number(entry?.activityWeightBps);
        if (!cycleCode || !subjectCode) {
            throw stageRulesError('RULES_INPUT_INVALID', 'المدخل غير مكتمل: يجب تحديد السلك والمادة');
        }
        if (
            !Number.isInteger(examWeightBps) ||
            !Number.isInteger(activityWeightBps) ||
            examWeightBps < 0 ||
            examWeightBps > 10000 ||
            activityWeightBps < 0 ||
            activityWeightBps > 10000 ||
            examWeightBps + activityWeightBps !== 10000
        ) {
            throw stageRulesError('SUBJECT_WEIGHT_OUT_OF_RANGE');
        }
        return { cycle_code: cycleCode, subject_code: subjectCode, exam_weight_bps: examWeightBps, activity_weight_bps: activityWeightBps };
    });
}

/**
 * Resolve the current official profile of a cycle (S4 effectivity spine).
 * A missing table OR a missing row is RULES_UNAVAILABLE — never a guessed
 * `uses_coefficients` (plan row 114: «غياب الجدول أو الصف يرجع RULES_UNAVAILABLE
 * ولا يختار uses_coefficients بالتخمين»).
 */
function resolveProfileForCycle(db, cycleCode) {
    let profile;
    try {
        profile = db
            .prepare(
                `SELECT * FROM cycle_profiles
                 WHERE cycle_code = ? ORDER BY profile_version DESC LIMIT 1`
            )
            .get(cycleCode);
    } catch {
        throw stageRulesError('RULES_UNAVAILABLE', 'ملف المرحلة غير متوفر في قاعدة البيانات.');
    }
    if (!profile) {
        throw stageRulesError('RULES_UNAVAILABLE', `لا يتوفر ملف مرحلة للسلك ${cycleCode}.`);
    }
    return profile;
}

function cycleUsesCoefficients(db, cycleCode) {
    return Number(resolveProfileForCycle(db, cycleCode).uses_coefficients) !== 0;
}

/**
 * S4 runtime-authoritative profile resolver (plan rows 110-111): returns the
 * profile the assignment for (school_year, cycle_code) POINTS AT — never the
 * newest profile of the cycle. A missing assignment, or an assignment whose
 * profile_version no longer exists in cycle_profiles, is RULES_UNAVAILABLE —
 * never a guess, never a silent re-pin to the latest profile (row 114).
 */
function getActiveProfileForCycle(db, schoolYear, cycleCode) {
    const assignment = db
        .prepare(`SELECT * FROM cycle_profile_assignments WHERE school_year = ? AND cycle_code = ?`)
        .get(schoolYear, cycleCode);
    if (!assignment) throw stageRulesError('RULES_UNAVAILABLE', 'لا يوجد تعيين ملف مرحلة لهذه السنة.');
    const profile = db
        .prepare(`SELECT * FROM cycle_profiles WHERE cycle_code = ? AND profile_version = ?`)
        .get(cycleCode, assignment.profile_version);
    if (!profile) {
        throw stageRulesError(
            'RULES_UNAVAILABLE',
            `ملف المرحلة المعيّن (${cycleCode}/${assignment.profile_version}) غير متوفر.`
        );
    }
    return profile;
}

/**
 * Bind the effective profile of (school_year, cycle) to a rule set — the S4
 * effectivity spine (plan row 109/111). One row per (school_year, cycle_code);
 * the rule_set_id must be non-null exactly when the profile uses coefficients,
 * and must point at a stage_rule_sets revision of the SAME school year. Any
 * contradictory combination refuses the whole operation.
 */
function resolveAssignmentProfile(db, schoolYear, cycleCode, preferredProfileVersion) {
    if (preferredProfileVersion) {
        const profile = db
            .prepare(`SELECT * FROM cycle_profiles WHERE cycle_code = ? AND profile_version = ?`)
            .get(cycleCode, preferredProfileVersion);
        if (!profile) throw stageRulesError('RULES_UNAVAILABLE', 'ملف المرحلة المشار إليه غير متوفر.');
        return profile;
    }
    const assignment = db
        .prepare(`SELECT profile_version FROM cycle_profile_assignments WHERE school_year = ? AND cycle_code = ?`)
        .get(schoolYear, cycleCode);
    if (!assignment) return resolveProfileForCycle(db, cycleCode);
    const profile = db
        .prepare(`SELECT * FROM cycle_profiles WHERE cycle_code = ? AND profile_version = ?`)
        .get(cycleCode, assignment.profile_version);
    if (!profile) throw stageRulesError('RULES_UNAVAILABLE', 'ملف المرحلة المعيّن غير متوفر.');
    return profile;
}

function assignActiveProfile(db, schoolYear, cycleCode, options) {
    const { ruleSetId, profileVersion } = options;
    const profile = resolveAssignmentProfile(db, schoolYear, cycleCode, profileVersion);
    const usesCoefficients = Number(profile.uses_coefficients) !== 0;
    if (usesCoefficients && ruleSetId == null) {
        throw stageRulesError('RULES_UNAVAILABLE', 'ملف المرحلة يتطلب مجموعة قواعد نشطة لهذه السنة.');
    }
    if (!usesCoefficients && ruleSetId != null) {
        throw stageRulesError('RULES_UNAVAILABLE', 'ملف التقويم المستمر لا يقبل ربطاً بمجموعة قواعد.');
    }
    if (ruleSetId != null) {
        const ruleSet = db.prepare(`SELECT school_year FROM stage_rule_sets WHERE id = ?`).get(ruleSetId);
        if (!ruleSet) throw stageRulesError('RULES_UNAVAILABLE', 'مجموعة القواعد المشار إليها غير متوفرة.');
        if (String(ruleSet.school_year) !== String(schoolYear)) {
            throw stageRulesError(
                'RULES_UNAVAILABLE',
                'مجموعة القواعد لا تنتمي إلى نفس السنة الدراسية للملف.'
            );
        }
    }
    db.prepare(
        `INSERT INTO cycle_profile_assignments(
            school_year, cycle_code, profile_version, rule_set_id
         ) VALUES(?, ?, ?, ?)
         ON CONFLICT(school_year, cycle_code) DO UPDATE SET
            profile_version = excluded.profile_version,
            rule_set_id = excluded.rule_set_id`
    ).run(schoolYear, cycleCode, profile.profile_version, ruleSetId == null ? null : ruleSetId);
}

function requireCyclesEditable(db, cycleCodes) {
    for (const cycleCode of cycleCodes) {
        if (!cycleUsesCoefficients(db, cycleCode)) {
            throw stageRulesError('FORBIDDEN', 'لا تسمح مرحلة التقويم المستمر بتعديل المعاملات.');
        }
    }
}

function requireQualifiantCycles(cycleCodes) {
    if (cycleCodes.some((cycleCode) => cycleCode !== QUALIFIANT_CYCLE)) {
        throw stageRulesError('FORBIDDEN', 'تعديل قواعد النتائج متاح فقط للسلك الثانوي التأهيلي.');
    }
}

function getActiveRuleSet(db, schoolYear) {
    return (
        db
            .prepare(
                `SELECT * FROM stage_rule_sets
                 WHERE school_year = ? AND status = 'active'
                 ORDER BY revision DESC LIMIT 1`
            )
            .get(schoolYear) || null
    );
}

/**
 * S4 runtime-authoritative resolver (plan rows 110-111): reads the effectivity
 * assignment for (school_year, cycle_code) and returns the rule set it points at.
 * Missing assignment / missing rule set / non-null rule_set_id on a continuous
 * profile are all RULES_UNAVAILABLE — CYCLE_CATALOG.seedProfileVersionHint is never used
 * to second-guess the assignment. The assignment's profile_version must itself
 * resolve to a real cycle_profiles row, otherwise the spine is broken and the
 * call refuses instead of guessing.
 */
function getActiveRuleSetForCycle(db, schoolYear, cycleCode) {
    const assignment = db
        .prepare(`SELECT * FROM cycle_profile_assignments WHERE school_year = ? AND cycle_code = ?`)
        .get(schoolYear, cycleCode);
    if (!assignment) throw stageRulesError('RULES_UNAVAILABLE', 'لا يوجد تعيين ملف مرحلة لهذه السنة.');
    if (assignment.rule_set_id == null) {
        throw stageRulesError('RULES_UNAVAILABLE', 'ملف المرحلة لا يشير إلى مجموعة قواعد.');
    }
    const profile = db
        .prepare(`SELECT 1 FROM cycle_profiles WHERE cycle_code = ? AND profile_version = ?`)
        .get(cycleCode, assignment.profile_version);
    if (!profile) {
        throw stageRulesError(
            'RULES_UNAVAILABLE',
            `ملف المرحلة المعيّن (${cycleCode}/${assignment.profile_version}) غير متوفر.`
        );
    }
    const profileDetails = db
        .prepare(`SELECT uses_coefficients FROM cycle_profiles WHERE cycle_code = ? AND profile_version = ?`)
        .get(cycleCode, assignment.profile_version);
    if (!profileDetails) {
        throw stageRulesError('RULES_UNAVAILABLE', 'ملف المرحلة المعيّن غير متوفر.');
    }
    if (Number(profileDetails.uses_coefficients) === 0) {
        throw stageRulesError('RULES_UNAVAILABLE', 'ملف التقويم المستمر لا يقبل ربطاً بمجموعة قواعد.');
    }
    const setRow = db
        .prepare(`SELECT * FROM stage_rule_sets WHERE id = ? AND school_year = ? AND status = 'active'`)
        .get(assignment.rule_set_id, schoolYear);
    if (!setRow) throw stageRulesError('RULES_UNAVAILABLE', 'مجموعة القواعد المشار إليها غير متوفرة.');
    return setRow;
}

function getCycleProfiles(db) {
    try {
        return db
            .prepare(`SELECT * FROM cycle_profiles ORDER BY cycle_code, profile_version`)
            .all();
    } catch {
        return [];
    }
}

function getActiveAssignments(db, schoolYear) {
    try {
        return db
            .prepare(
                `SELECT * FROM cycle_profile_assignments
                 WHERE school_year = ? ORDER BY cycle_code`
            )
            .all(schoolYear);
    } catch {
        return [];
    }
}

function requireEditableState(db, schoolYear) {
    const active = getActiveRuleSet(db, schoolYear);
    if (active) return active;
    const exists = db
        .prepare(`SELECT 1 FROM stage_rule_sets WHERE school_year = ? LIMIT 1`)
        .get(schoolYear);
    if (exists) throw stageRulesError('INVALID_RULE_VERSION');
    return null;
}

function getRuleSetRows(db, ruleSetId) {
    return {
        coefficients: db
            .prepare(`SELECT * FROM subject_coefficients WHERE rule_set_id = ? ORDER BY id`)
            .all(ruleSetId),
        examCounts: db
            .prepare(`SELECT * FROM exam_count_rules WHERE rule_set_id = ? ORDER BY id`)
            .all(ruleSetId),
        weights: db
            .prepare(`SELECT * FROM subject_weight_rules WHERE rule_set_id = ? ORDER BY id`)
            .all(ruleSetId)
    };
}

function seedFirstRevision(db, ruleSetId) {
    const insertCoefficient = db.prepare(
        `INSERT OR IGNORE INTO subject_coefficients(
            rule_set_id, cycle_code, level_code, stream_code, subject_code, coefficient, source
         ) VALUES(
            @rule_set_id, @cycle_code, @level_code, @stream_code, @subject_code, @coefficient, @source
         )`
    );
    for (const row of getOfficialCoefficientRows({ ruleSetId, cycleCode: QUALIFIANT_CYCLE })) {
        insertCoefficient.run(row);
    }
    const insertExamCount = db.prepare(
        `INSERT OR IGNORE INTO exam_count_rules(
            rule_set_id, cycle_code, level_code, subject_code, exam_count, source
         ) VALUES(?, ?, '*', ?, ?, 'official')`
    );
    for (const [subject, examCount] of DEFAULT_EXAM_COUNTS) {
        const subjectCode = mapSubjectToCode(subject);
        if (subjectCode) insertExamCount.run(ruleSetId, QUALIFIANT_CYCLE, subjectCode, examCount);
    }
    const insertWeight = db.prepare(
        `INSERT OR IGNORE INTO subject_weight_rules(
            rule_set_id, cycle_code, subject_code, exam_weight_bps, activity_weight_bps, source
         ) VALUES(?, ?, ?, ?, ?, 'official')`
    );
    for (const row of getOfficialSubjectWeightRows({ ruleSetId, cycleCode: QUALIFIANT_CYCLE })) {
        insertWeight.run(ruleSetId, row.cycle_code, row.subject_code, row.exam_weight_bps, row.activity_weight_bps);
    }
}

function copyRowsFrom(db, table, previousSetId, newSetId) {
    const insert = db.prepare(
        `INSERT INTO ${table}(
            rule_set_id, cycle_code, level_code, stream_code, subject_code, coefficient, source
         ) VALUES(?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of db.prepare(`SELECT * FROM ${table} WHERE rule_set_id = ?`).all(previousSetId)) {
        insert.run(newSetId, row.cycle_code, row.level_code, row.stream_code, row.subject_code, row.coefficient, row.source);
    }
}

function copyExamRowsFrom(db, previousSetId, newSetId) {
    const insert = db.prepare(
        `INSERT INTO exam_count_rules(
            rule_set_id, cycle_code, level_code, subject_code, exam_count, source
         ) VALUES(?, ?, ?, ?, ?, ?)`
    );
    for (const row of db.prepare(`SELECT * FROM exam_count_rules WHERE rule_set_id = ?`).all(previousSetId)) {
        insert.run(newSetId, row.cycle_code, row.level_code, row.subject_code, row.exam_count, row.source);
    }
}

function copyWeightRowsFrom(db, previousSetId, newSetId) {
    const insert = db.prepare(
        `INSERT INTO subject_weight_rules(
            rule_set_id, cycle_code, subject_code, exam_weight_bps, activity_weight_bps, source
         ) VALUES(?, ?, ?, ?, ?, ?)`
    );
    for (const row of db.prepare(`SELECT * FROM subject_weight_rules WHERE rule_set_id = ?`).all(previousSetId)) {
        insert.run(
            newSetId,
            row.cycle_code,
            row.subject_code,
            row.exam_weight_bps,
            row.activity_weight_bps,
            row.source
        );
    }
}

function createNextRevision(db, schoolYear, previous, reason, actor, cycleCode) {
    if (previous) {
        db.prepare(`UPDATE stage_rule_sets SET status = 'closed' WHERE id = ? AND status = 'active'`).run(previous.id);
    }
    const revision = (previous?.revision || 0) + 1;
    const createdBy = String(actor?.name || actor?.userId || '');
    db.prepare(
        `INSERT INTO stage_rule_sets(school_year, revision, status, created_by, reason)
         VALUES(?, ?, 'active', ?, ?)`
    ).run(schoolYear, revision, createdBy, reason);
    const setRow = db
        .prepare(`SELECT * FROM stage_rule_sets WHERE school_year = ? AND revision = ?`)
        .get(schoolYear, revision);
    if (previous) {
        copyRowsFrom(db, 'subject_coefficients', previous.id, setRow.id);
        copyExamRowsFrom(db, previous.id, setRow.id);
        copyWeightRowsFrom(db, previous.id, setRow.id);
    } else {
        seedFirstRevision(db, setRow.id);
    }
    // S4: every new revision atomically re-binds the effectivity spine for its
    // cycle (plan row 111) — or refuses the whole operation.
    assignActiveProfile(db, schoolYear, cycleCode, { ruleSetId: setRow.id });
    return setRow;
}

function normalizeActor(actor) {
    return {
        userId: Number(actor?.userId || 0),
        name: String(actor?.name || ''),
        email: String(actor?.email || ''),
        role: String(actor?.role || '')
    };
}

function writeAudit(db, setRow, schoolYear, kind, reason, actor, details) {
    db.prepare(
        `INSERT INTO system_logs(action, details, entity_type, entity_id)
         VALUES('STAGE_RULE_OVERRIDE', ?, 'stage_rule_set', ?)`
    ).run(
        JSON.stringify({
            actor: normalizeActor(actor),
            reason,
            schoolYear,
            revision: setRow.revision,
            kind,
            ...(details || {})
        }),
        String(setRow.id)
    );
}

function captureRevisionRows(db, setRow, previousSetId = null) {
    const parentRows = previousSetId
        ? [
              db.prepare(`SELECT * FROM stage_rule_sets WHERE id = ?`).get(previousSetId),
              setRow
          ].filter(Boolean)
        : [setRow];
    captureResolvedRows(db, 'stage_rule_sets', parentRows, 'PUT');
    captureResolvedRows(
        db,
        'subject_coefficients',
        db.prepare(`SELECT * FROM subject_coefficients WHERE rule_set_id = ?`).all(setRow.id),
        'PUT'
    );
    captureResolvedRows(
        db,
        'exam_count_rules',
        db.prepare(`SELECT * FROM exam_count_rules WHERE rule_set_id = ?`).all(setRow.id),
        'PUT'
    );
    captureResolvedRows(
        db,
        'subject_weight_rules',
        db.prepare(`SELECT * FROM subject_weight_rules WHERE rule_set_id = ?`).all(setRow.id),
        'PUT'
    );
    // S4: the effectivity assignment travels with the revision that created it.
    captureResolvedRows(
        db,
        'cycle_profile_assignments',
        db.prepare(`SELECT * FROM cycle_profile_assignments WHERE rule_set_id = ?`).all(setRow.id),
        'PUT'
    );
}

function saveRules(db, { schoolYear, entries, reason, actor }, kind) {
    const normalizedReason = requireReason(reason);
    const items = kind === 'coefficients' ? normalizeCoefficientEntries(entries) : normalizeExamCountEntries(entries);
    requireQualifiantCycles(items.map((entry) => entry.cycle_code));
    requireCyclesEditable(db, items.map((entry) => entry.cycle_code));
    const previous = requireEditableState(db, schoolYear);

    const run = db.transaction(() => {
        const setRow = createNextRevision(db, schoolYear, previous, normalizedReason, actor, items[0].cycle_code);
        const updatedByName = normalizeActor(actor).name || null;
        const changedKeys = [];
        if (kind === 'coefficients') {
            const upsert = db.prepare(
                `INSERT INTO subject_coefficients(
                    rule_set_id, cycle_code, level_code, stream_code, subject_code, coefficient, source, updated_by, reason
                 ) VALUES(
                    @rule_set_id, @cycle_code, @level_code, @stream_code, @subject_code, @coefficient, 'custom', @updated_by, @reason
                 )
                 ON CONFLICT(rule_set_id, cycle_code, level_code, stream_code, subject_code, source)
                 DO UPDATE SET coefficient = excluded.coefficient, updated_by = excluded.updated_by, reason = excluded.reason`
            );
            const selectCustom = db.prepare(
                `SELECT coefficient FROM subject_coefficients
                 WHERE rule_set_id = ? AND cycle_code = ? AND level_code = ? AND stream_code = ?
                   AND subject_code = ? AND source = 'custom'`
            );
            for (const entry of items) {
                const before = selectCustom.get(
                    setRow.id,
                    entry.cycle_code,
                    entry.level_code,
                    entry.stream_code,
                    entry.subject_code
                );
                upsert.run({
                    rule_set_id: setRow.id,
                    cycle_code: entry.cycle_code,
                    level_code: entry.level_code,
                    stream_code: entry.stream_code,
                    subject_code: entry.subject_code,
                    coefficient: entry.coefficient,
                    updated_by: updatedByName,
                    reason: normalizedReason
                });
                changedKeys.push({
                    cycleCode: entry.cycle_code,
                    levelCode: entry.level_code,
                    streamCode: entry.stream_code,
                    subjectCode: entry.subject_code,
                    coefficient: entry.coefficient,
                    before: before ? Number(before.coefficient) : null
                });
            }
        } else {
            const upsert = db.prepare(
                `INSERT INTO exam_count_rules(
                    rule_set_id, cycle_code, level_code, subject_code, exam_count, source, updated_by, reason
                 ) VALUES(
                    @rule_set_id, @cycle_code, @level_code, @subject_code, @exam_count, 'custom', @updated_by, @reason
                 )
                 ON CONFLICT(rule_set_id, cycle_code, level_code, subject_code, source)
                 DO UPDATE SET exam_count = excluded.exam_count, updated_by = excluded.updated_by, reason = excluded.reason`
            );
            const selectCustom = db.prepare(
                `SELECT exam_count FROM exam_count_rules
                 WHERE rule_set_id = ? AND cycle_code = ? AND level_code = ? AND subject_code = ? AND source = 'custom'`
            );
            for (const entry of items) {
                const before = selectCustom.get(
                    setRow.id,
                    entry.cycle_code,
                    entry.level_code,
                    entry.subject_code
                );
                upsert.run({
                    rule_set_id: setRow.id,
                    cycle_code: entry.cycle_code,
                    level_code: entry.level_code,
                    subject_code: entry.subject_code,
                    exam_count: entry.exam_count,
                    updated_by: updatedByName,
                    reason: normalizedReason
                });
                changedKeys.push({
                    cycleCode: entry.cycle_code,
                    levelCode: entry.level_code,
                    subjectCode: entry.subject_code,
                    examCount: entry.exam_count,
                    before: before ? Number(before.exam_count) : null
                });
            }
        }
        writeAudit(db, setRow, schoolYear, kind, normalizedReason, actor, { changedKeys });
        captureRevisionRows(db, setRow, previous?.id);
        return setRow;
    });

    const setRow = run();
    notifyCaptureCommitted();
    return setRow;
}

function saveCoefficients(db, payload) {
    return saveRules(db, payload, 'coefficients');
}

function saveExamCounts(db, payload) {
    return saveRules(db, payload, 'examCounts');
}

function saveAllRules(db, payload) {
    const normalizedReason = requireReason(payload?.reason);
    const coefficientEntries = normalizeCoefficientEntries(payload?.coefficientEntries);
    const examCountEntries = normalizeExamCountEntries(payload?.examCountEntries);
    const weightEntries = normalizeWeightEntries(payload?.weightEntries);
    requireQualifiantCycles([
        ...coefficientEntries.map((entry) => entry.cycle_code),
        ...examCountEntries.map((entry) => entry.cycle_code),
        ...weightEntries.map((entry) => entry.cycle_code)
    ]);
    requireCyclesEditable(db, coefficientEntries.map((entry) => entry.cycle_code));
    requireCyclesEditable(db, weightEntries.map((entry) => entry.cycle_code));
    if (!coefficientEntries.length && !examCountEntries.length && !weightEntries.length) {
        throw stageRulesError('RULES_INPUT_INVALID', 'لا توجد قواعد للتعديل');
    }
    const previous = requireEditableState(db, payload.schoolYear);
    const cycleCode =
        (coefficientEntries[0] && coefficientEntries[0].cycle_code) ||
        (examCountEntries[0] && examCountEntries[0].cycle_code) ||
        (weightEntries[0] && weightEntries[0].cycle_code) ||
        QUALIFIANT_CYCLE;
    const run = db.transaction(() => {
        const setRow = createNextRevision(
            db,
            payload.schoolYear,
            previous,
            normalizedReason,
            payload.actor,
            cycleCode
        );
        const actorName = normalizeActor(payload.actor).name || null;
        const changedKeys = [];
        writeCustomCoefficients(db, setRow.id, coefficientEntries, actorName, normalizedReason, changedKeys);
        writeCustomExamCounts(db, setRow.id, examCountEntries, actorName, normalizedReason, changedKeys);
        writeCustomWeights(db, setRow.id, weightEntries, actorName, normalizedReason, changedKeys);
        writeAudit(db, setRow, payload.schoolYear, 'all', normalizedReason, payload.actor, { changedKeys });
        captureRevisionRows(db, setRow, previous?.id);
        return setRow;
    });
    const setRow = run();
    notifyCaptureCommitted();
    return setRow;
}

function writeCustomCoefficients(db, ruleSetId, entries, actorName, reason, changedKeys) {
    const upsert = db.prepare(
        `INSERT INTO subject_coefficients(
            rule_set_id, cycle_code, level_code, stream_code, subject_code, coefficient, source, updated_by, reason
         ) VALUES(?, ?, ?, ?, ?, ?, 'custom', ?, ?)
         ON CONFLICT(rule_set_id, cycle_code, level_code, stream_code, subject_code, source)
         DO UPDATE SET coefficient = excluded.coefficient, updated_by = excluded.updated_by, reason = excluded.reason`
    );
    const select = db.prepare(
        `SELECT coefficient FROM subject_coefficients
         WHERE rule_set_id = ? AND cycle_code = ? AND level_code = ? AND stream_code = ?
           AND subject_code = ? AND source = 'custom'`
    );
    for (const entry of entries) {
        const before = select.get(ruleSetId, entry.cycle_code, entry.level_code, entry.stream_code, entry.subject_code);
        upsert.run(
            ruleSetId,
            entry.cycle_code,
            entry.level_code,
            entry.stream_code,
            entry.subject_code,
            entry.coefficient,
            actorName,
            reason
        );
        changedKeys.push({ table: 'coefficients', ...entry, before: before ? Number(before.coefficient) : null });
    }
}

function writeCustomExamCounts(db, ruleSetId, entries, actorName, reason, changedKeys) {
    const upsert = db.prepare(
        `INSERT INTO exam_count_rules(
            rule_set_id, cycle_code, level_code, subject_code, exam_count, source, updated_by, reason
         ) VALUES(?, ?, ?, ?, ?, 'custom', ?, ?)
         ON CONFLICT(rule_set_id, cycle_code, level_code, subject_code, source)
         DO UPDATE SET exam_count = excluded.exam_count, updated_by = excluded.updated_by, reason = excluded.reason`
    );
    const select = db.prepare(
        `SELECT exam_count FROM exam_count_rules
         WHERE rule_set_id = ? AND cycle_code = ? AND level_code = ? AND subject_code = ? AND source = 'custom'`
    );
    for (const entry of entries) {
        const before = select.get(ruleSetId, entry.cycle_code, entry.level_code, entry.subject_code);
        upsert.run(
            ruleSetId,
            entry.cycle_code,
            entry.level_code,
            entry.subject_code,
            entry.exam_count,
            actorName,
            reason
        );
        changedKeys.push({ table: 'examCounts', ...entry, before: before ? Number(before.exam_count) : null });
    }
}

function writeCustomWeights(db, ruleSetId, entries, actorName, reason, changedKeys) {
    const upsert = db.prepare(
        `INSERT INTO subject_weight_rules(
            rule_set_id, cycle_code, subject_code, exam_weight_bps, activity_weight_bps, source, updated_by, reason
         ) VALUES(?, ?, ?, ?, ?, 'custom', ?, ?)
         ON CONFLICT(rule_set_id, cycle_code, subject_code, source)
         DO UPDATE SET exam_weight_bps = excluded.exam_weight_bps,
                       activity_weight_bps = excluded.activity_weight_bps,
                       updated_by = excluded.updated_by,
                       reason = excluded.reason`
    );
    const select = db.prepare(
        `SELECT exam_weight_bps, activity_weight_bps FROM subject_weight_rules
         WHERE rule_set_id = ? AND cycle_code = ? AND subject_code = ? AND source = 'custom'`
    );
    for (const entry of entries) {
        const before = select.get(ruleSetId, entry.cycle_code, entry.subject_code);
        upsert.run(
            ruleSetId,
            entry.cycle_code,
            entry.subject_code,
            entry.exam_weight_bps,
            entry.activity_weight_bps,
            actorName,
            reason
        );
        changedKeys.push({
            table: 'weights',
            ...entry,
            before: before
                ? { examWeightBps: Number(before.exam_weight_bps), activityWeightBps: Number(before.activity_weight_bps) }
                : null
        });
    }
}

/**
 * Official rule-set upgrade (US-3, T024).
 *
 * Refreshes the official rows of a school year from shipped seed data without
 * ever touching custom overrides. Creates a new revision (never ≤ max), copies
 * every row of the previous revision forward, then upserts the seeded official
 * rows on top. The ON CONFLICT target includes `source`, so a seed can only
 * collide with the copied official row — custom rows for the same logical key
 * are shadowed, never overwritten.
 *
 * This is the seed path: it MUST NOT capture (zero outbox rows, zero capture-port
 * calls) and MUST NOT write audit rows (the seed is a device-local refresh, not a
 * user action). seedData = { schoolYear?, cycleCode, coefficients, examCounts }.
 * Row objects carry the logical dims without rule_set_id (snake_case per the T023
 * fixtures; camelCase accepted as a fallback). When seedData carries no school
 * year, the sole existing rule-set year is used (throws when ambiguous).
 */
function applyOfficialRuleSet(db, seedData, reason) {
    const normalizedReason = requireReason(reason);
    const data = seedData && typeof seedData === 'object' ? seedData : {};
    const schoolYear = resolveSeedSchoolYear(db, data);
    const cycleCode = String(data.cycleCode || QUALIFIANT_CYCLE);
    const coefficientSeeds = normalizeOfficialCoefficientSeeds(data.coefficients, cycleCode);
    const examCountSeeds = normalizeOfficialExamCountSeeds(data.examCounts, cycleCode);
    const weightSeeds = normalizeOfficialWeightSeeds(data.weights, cycleCode);

    const maxRow = db
        .prepare(`SELECT MAX(revision) AS max FROM stage_rule_sets WHERE school_year = ?`)
        .get(schoolYear);
    const previous =
        maxRow && maxRow.max > 0
            ? db
                  .prepare(`SELECT * FROM stage_rule_sets WHERE school_year = ? AND revision = ?`)
                  .get(schoolYear, maxRow.max)
            : null;

    const run = db.transaction(() => {
        if (previous) {
            db.prepare(`UPDATE stage_rule_sets SET status = 'closed' WHERE id = ? AND status = 'active'`).run(previous.id);
        }
        const revision = (previous ? previous.revision : 0) + 1;
        db.prepare(
            `INSERT INTO stage_rule_sets(school_year, revision, status, created_by, reason)
             VALUES(?, ?, 'active', 'system', ?)`
        ).run(schoolYear, revision, normalizedReason);
        const setRow = db
            .prepare(`SELECT * FROM stage_rule_sets WHERE school_year = ? AND revision = ?`)
            .get(schoolYear, revision);
        if (previous) {
            copyRowsFrom(db, 'subject_coefficients', previous.id, setRow.id);
            copyExamRowsFrom(db, previous.id, setRow.id);
            copyWeightRowsFrom(db, previous.id, setRow.id);
        }
        upsertOfficialCoefficients(db, setRow.id, coefficientSeeds);
        upsertOfficialExamCounts(db, setRow.id, examCountSeeds);
        upsertOfficialWeights(db, setRow.id, weightSeeds);
        // S4 effectivity spine: the seed path refreshes the assignment in the same
        // transaction (local seed data — never captures, never audits).
        assignActiveProfile(db, schoolYear, cycleCode, {
            ruleSetId: setRow.id,
            profileVersion: resolveProfileForCycle(db, cycleCode).profile_version
        });
        return setRow;
    });

    return run();
}

function resolveSeedSchoolYear(db, seedData) {
    const explicit = String(seedData?.schoolYear || seedData?.school_year || '').trim();
    if (explicit) return explicit;
    const years = db
        .prepare(`SELECT DISTINCT school_year FROM stage_rule_sets ORDER BY school_year`)
        .all();
    if (years.length === 1) return years[0].school_year;
    throw stageRulesError(
        'RULES_UNAVAILABLE',
        'applyOfficialRuleSet: school year required when zero or multiple rule sets exist'
    );
}

function normalizeOfficialCoefficientSeeds(rows, cycleCode) {
    return (Array.isArray(rows) ? rows : []).reduce((out, raw) => {
        const row = raw && typeof raw === 'object' ? raw : {};
        const cycle_code = String(row.cycle_code || row.cycleCode || cycleCode).trim();
        const level_code = String(row.level_code || row.levelCode || '').trim();
        const stream_code = String(row.stream_code || row.streamCode || '').trim();
        const subject_code = String(row.subject_code || row.subjectCode || '').trim();
        const coefficient = Number(row.coefficient);
        if (!cycle_code || !level_code || !stream_code || !subject_code) return out;
        if (!Number.isInteger(coefficient) || coefficient < 1 || coefficient > 20) return out;
        out.push({ cycle_code, level_code, stream_code, subject_code, coefficient });
        return out;
    }, []);
}

function normalizeOfficialExamCountSeeds(rows, cycleCode) {
    return (Array.isArray(rows) ? rows : []).reduce((out, raw) => {
        const row = raw && typeof raw === 'object' ? raw : {};
        const cycle_code = String(row.cycle_code || row.cycleCode || cycleCode).trim();
        const level_code = String(row.level_code || row.levelCode || '').trim();
        const subject_code = String(row.subject_code || row.subjectCode || '').trim();
        const exam_count = Number(row.exam_count || row.examCount);
        if (!cycle_code || !level_code || !subject_code) return out;
        if (!Number.isInteger(exam_count) || exam_count < 1 || exam_count > 12) return out;
        out.push({ cycle_code, level_code, subject_code, exam_count });
        return out;
    }, []);
}

function normalizeOfficialWeightSeeds(rows, cycleCode) {
    return (Array.isArray(rows) ? rows : []).reduce((normalized, raw) => {
        const row = raw && typeof raw === 'object' ? raw : {};
        const cycle_code = String(row.cycle_code || row.cycleCode || cycleCode).trim();
        const subject_code = String(row.subject_code || row.subjectCode || '').trim();
        const exam_weight_bps = Number(row.exam_weight_bps ?? row.examWeightBps);
        const activity_weight_bps = Number(row.activity_weight_bps ?? row.activityWeightBps);
        if (!cycle_code || !subject_code) return normalized;
        if (
            !Number.isInteger(exam_weight_bps) ||
            !Number.isInteger(activity_weight_bps) ||
            exam_weight_bps < 0 ||
            activity_weight_bps < 0 ||
            exam_weight_bps > 10000 ||
            activity_weight_bps > 10000 ||
            exam_weight_bps + activity_weight_bps !== 10000
        ) {
            return normalized;
        }
        normalized.push({ cycle_code, subject_code, exam_weight_bps, activity_weight_bps });
        return normalized;
    }, []);
}

function upsertOfficialCoefficients(db, ruleSetId, seeds) {
    if (!seeds.length) return;
    const upsert = db.prepare(
        `INSERT INTO subject_coefficients(
            rule_set_id, cycle_code, level_code, stream_code, subject_code, coefficient, source
         ) VALUES(
            @rule_set_id, @cycle_code, @level_code, @stream_code, @subject_code, @coefficient, 'official'
         )
         ON CONFLICT(rule_set_id, cycle_code, level_code, stream_code, subject_code, source)
         DO UPDATE SET coefficient = excluded.coefficient`
    );
    for (const seed of seeds) {
        upsert.run({ rule_set_id: ruleSetId, ...seed });
    }
}

function upsertOfficialExamCounts(db, ruleSetId, seeds) {
    if (!seeds.length) return;
    const upsert = db.prepare(
        `INSERT INTO exam_count_rules(
            rule_set_id, cycle_code, level_code, subject_code, exam_count, source
         ) VALUES(
            @rule_set_id, @cycle_code, @level_code, @subject_code, @exam_count, 'official'
         )
         ON CONFLICT(rule_set_id, cycle_code, level_code, subject_code, source)
         DO UPDATE SET exam_count = excluded.exam_count`
    );
    for (const seed of seeds) {
        upsert.run({ rule_set_id: ruleSetId, ...seed });
    }
}

function upsertOfficialWeights(db, ruleSetId, seeds) {
    if (!seeds.length) return;
    const upsert = db.prepare(
        `INSERT INTO subject_weight_rules(
            rule_set_id, cycle_code, subject_code, exam_weight_bps, activity_weight_bps, source
         ) VALUES(@rule_set_id, @cycle_code, @subject_code, @exam_weight_bps, @activity_weight_bps, 'official')
         ON CONFLICT(rule_set_id, cycle_code, subject_code, source)
         DO UPDATE SET exam_weight_bps = excluded.exam_weight_bps,
                       activity_weight_bps = excluded.activity_weight_bps`
    );
    for (const seed of seeds) upsert.run({ rule_set_id: ruleSetId, ...seed });
}

/**
 * Restore custom overrides back to the official values (US-4, T028).
 * scope 'row':  new revision with the single target custom coefficient row removed
 *               (the official row for the same key remains, untouched).
 * scope 'bulk': requires confirm === true; new revision with ALL custom rows
 *               removed from both subject_coefficients and exam_count_rules.
 * Every reset: version-copy (new revision = max+1, previous active → closed),
 * one STAGE_RULE_OVERRIDE audit row with the removed keys and their before
 * values, and explicit outbox capture inside the transaction.
 */
function resetToOfficial(db, payload) {
    const normalizedReason = requireReason(payload?.reason);
    const scope = String(payload?.scope || '');
    if (scope !== 'row' && scope !== 'bulk') throw stageRulesError('RULES_INPUT_INVALID', 'نطاق الاستعادة يجب أن يكون "row" أو "bulk"');
    if (scope === 'bulk' && payload?.confirm !== true) throw stageRulesError('CONFIRM_REQUIRED');
    const keys =
        scope === 'row'
            ? (Array.isArray(payload?.keys) ? payload.keys : [payload?.keys]).map(normalizeResetKey)
            : [];
    if (scope === 'row') requireQualifiantCycles(keys.map((key) => key.cycle_code));
    const previous = requireEditableState(db, payload?.schoolYear);
    if (!previous) throw stageRulesError('RULES_UNAVAILABLE');
    const beforeRows = [];
    if (scope === 'row') {
        for (const key of keys) {
            if (key.rule_type === 'weight') {
                const weight = db
                    .prepare(
                        `SELECT * FROM subject_weight_rules
                         WHERE rule_set_id = ? AND cycle_code = ? AND subject_code = ? AND source = 'custom'`
                    )
                    .get(previous.id, key.cycle_code, key.subject_code);
                if (weight) beforeRows.push({ table: 'weights', key, row: weight });
                continue;
            }
            const coefficient = db
                .prepare(
                    `SELECT * FROM subject_coefficients
                     WHERE rule_set_id = ? AND cycle_code = ? AND level_code = ? AND stream_code = ?
                       AND subject_code = ? AND source = 'custom'`
                )
                .get(previous.id, key.cycle_code, key.level_code, key.stream_code, key.subject_code);
            const examCount = db
                .prepare(
                    `SELECT * FROM exam_count_rules
                     WHERE rule_set_id = ? AND cycle_code = ? AND level_code = ? AND subject_code = ?
                       AND source = 'custom'`
                )
                .get(previous.id, key.cycle_code, key.level_code, key.subject_code);
            if (coefficient) beforeRows.push({ table: 'coefficients', key, row: coefficient });
            if (examCount) beforeRows.push({ table: 'examCounts', key, row: examCount });
        }
        if (!beforeRows.length) throw stageRulesError('MISSING_RULE', 'لا توجد قاعدة مخصصة لاستعادتها لهذا المفتاح');
    }

    const run = db.transaction(() => {
        const setRow = createNextRevision(
            db,
            payload.schoolYear,
            previous,
            normalizedReason,
            payload?.actor,
            scope === 'row' ? keys[0].cycle_code : QUALIFIANT_CYCLE
        );
        const removedKeys = [];
        if (scope === 'row') {
            for (const { table, key, row } of beforeRows) {
                if (table === 'coefficients') {
                    db.prepare(
                        `DELETE FROM subject_coefficients
                         WHERE rule_set_id = ? AND cycle_code = ? AND level_code = ? AND stream_code = ?
                           AND subject_code = ? AND source = 'custom'`
                    ).run(setRow.id, key.cycle_code, key.level_code, key.stream_code, key.subject_code);
                } else if (table === 'examCounts') {
                    db.prepare(
                        `DELETE FROM exam_count_rules
                         WHERE rule_set_id = ? AND cycle_code = ? AND level_code = ? AND subject_code = ?
                           AND source = 'custom'`
                    ).run(setRow.id, key.cycle_code, key.level_code, key.subject_code);
                } else {
                    db.prepare(
                        `DELETE FROM subject_weight_rules
                         WHERE rule_set_id = ? AND cycle_code = ? AND subject_code = ? AND source = 'custom'`
                    ).run(setRow.id, key.cycle_code, key.subject_code);
                }
                removedKeys.push({
                    table,
                    cycleCode: key.cycle_code,
                    ...(table !== 'weights' ? { levelCode: key.level_code } : {}),
                    ...(table === 'coefficients' ? { streamCode: key.stream_code } : {}),
                    subjectCode: key.subject_code,
                    before:
                        table === 'coefficients'
                            ? Number(row.coefficient)
                            : table === 'examCounts'
                              ? Number(row.exam_count)
                              : {
                                    examWeightBps: Number(row.exam_weight_bps),
                                    activityWeightBps: Number(row.activity_weight_bps)
                                },
                    after: null
                });
            }
        } else {
            const customRows = db
                .prepare(`SELECT * FROM subject_coefficients WHERE rule_set_id = ? AND source = 'custom'`)
                .all(setRow.id);
            const customExams = db
                .prepare(`SELECT * FROM exam_count_rules WHERE rule_set_id = ? AND source = 'custom'`)
                .all(setRow.id);
            const customWeights = db
                .prepare(`SELECT * FROM subject_weight_rules WHERE rule_set_id = ? AND source = 'custom'`)
                .all(setRow.id);
            for (const row of customRows) {
                removedKeys.push({
                    table: 'coefficients',
                    cycleCode: row.cycle_code,
                    levelCode: row.level_code,
                    streamCode: row.stream_code,
                    subjectCode: row.subject_code,
                    before: Number(row.coefficient),
                    after: null
                });
            }
            for (const row of customExams) {
                removedKeys.push({
                    table: 'examCounts',
                    cycleCode: row.cycle_code,
                    levelCode: row.level_code,
                    subjectCode: row.subject_code,
                    before: Number(row.exam_count),
                    after: null
                });
            }
            for (const row of customWeights) {
                removedKeys.push({
                    table: 'weights',
                    cycleCode: row.cycle_code,
                    subjectCode: row.subject_code,
                    before: {
                        examWeightBps: Number(row.exam_weight_bps),
                        activityWeightBps: Number(row.activity_weight_bps)
                    },
                    after: null
                });
            }
            db.prepare(`DELETE FROM subject_coefficients WHERE rule_set_id = ? AND source = 'custom'`).run(setRow.id);
            db.prepare(`DELETE FROM exam_count_rules WHERE rule_set_id = ? AND source = 'custom'`).run(setRow.id);
            db.prepare(`DELETE FROM subject_weight_rules WHERE rule_set_id = ? AND source = 'custom'`).run(setRow.id);
        }
        writeAudit(db, setRow, payload.schoolYear, scope === 'row' ? 'resetRow' : 'resetBulk', normalizedReason, payload?.actor, {
            scope,
            removedKeys
        });
        captureRevisionRows(db, setRow, previous.id);
        return setRow;
    });

    const setRow = run();
    notifyCaptureCommitted();
    return setRow;
}

function normalizeResetKey(raw) {
    const key = raw && typeof raw === 'object' ? raw : {};
    const cycleCode = String(key.cycleCode || '').trim();
    const levelCode = String(key.levelCode || '').trim();
    const streamCode = String(key.streamCode || '').trim();
    const subjectCode = String(key.subjectCode || '').trim();
    const ruleType = String(key.ruleType || key.rule_type || '').trim();
    if (!cycleCode || !subjectCode) throw stageRulesError('RULES_INPUT_INVALID', 'مفتاح الاستعادة غير مكتمل: السلك والمادة مطلوبان');
    if (ruleType === 'weight') return { rule_type: ruleType, cycle_code: cycleCode, subject_code: subjectCode };
    if (!levelCode || !streamCode) throw stageRulesError('RULES_INPUT_INVALID', 'مفتاح الاستعادة غير مكتمل: المستوى والشعبة مطلوبان');
    return { rule_type: ruleType, cycle_code: cycleCode, level_code: levelCode, stream_code: streamCode, subject_code: subjectCode };
}

module.exports = {
    getActiveRuleSet,
    getActiveRuleSetForCycle,
    getActiveProfileForCycle,
    getCycleProfiles,
    getActiveAssignments,
    getRuleSetRows,
    saveCoefficients,
    saveExamCounts,
    saveAllRules,
    applyOfficialRuleSet,
    resetToOfficial
};
