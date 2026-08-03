'use strict';

/**
 * Stage-rules apply hooks (029-stage-rules-management + S4 cycle profiles).
 * Registers the pull-side revision downgrade guard on the canonical registry and
 * provides the S4 profile/assignment consistency revalidation used by the sync
 * engine before a pulled row is written.
 * Called once at sync engine load (main/sync/engine/index.js).
 *
 * Hook contract (main/sync/engine/apply.js — applySingleItem):
 *   beforePut(db, item, ctx) may mutate item.data or signal:
 *     - null            -> proceed with apply
 *     - { defer: true } -> skip silently (no write, no failure recorded)
 *     - { fail, extra } -> record a pull apply failure
 * A falsy hook return is treated as "proceed" by the engine, so the downgrade
 * guard signals the skip with { defer: true }.
 */

const { setApplyHooks } = require('./entity-registry');
const { isKnownCycleCode } = require('../../js/shared/education/cycles');

function guardStageRuleRevisionBeforePut(db, item) {
    const data = item.data || {};
    const schoolYear = String(data.school_year || '').trim();
    const incomingRevision = Number(data.revision || 0);
    if (!schoolYear || !Number.isFinite(incomingRevision)) return null;

    let localRow = null;
    try {
        localRow = db
            .prepare('SELECT revision FROM stage_rule_sets WHERE school_year = ? ORDER BY revision DESC LIMIT 1')
            .get(schoolYear);
    } catch {
        return null;
    }

    if (localRow && incomingRevision <= Number(localRow.revision)) {
        return { defer: true };
    }
    if (localRow && incomingRevision > Number(localRow.revision)) {
        // The parent row arrives before its FK children. Close the old active
        // revision first so the partial unique index permits the new one.
        db.prepare(
            `UPDATE stage_rule_sets SET status = 'closed'
             WHERE school_year = ? AND status = 'active' AND revision < ?`
        ).run(schoolYear, incomingRevision);
    }
    return null;
}

/**
 * S4 sync-apply revalidation (plan row 113) — mirrors the repository transaction
 * checks so a pulled profile/assignment cannot bypass them:
 *   - cycle_profiles: cycle_code/profile_version present, cycle known to the catalog,
 *     and content-immutable — an existing row whose content differs is refused
 *     (a new official file must ship as a NEW profile_version row);
 *   - cycle_profile_assignments: key present, cycle known, profile exists locally,
 *     rule_set_id nullability matches the profile's uses_coefficients, and the
 *     referenced rule set belongs to the same school year.
 * Returns null when the row is consistent, or { reason, extra } to be routed to
 * recordPullQuarantine by the engine (the row is refused and replayed once the
 * prerequisite rows exist — never written half-consistent).
 */
function checkCycleProfileConsistency(db, item) {
    const data = item.data || {};
    if (item.tableName === 'cycle_profiles') {
        const cycleCode = String(data.cycle_code || '').trim();
        const profileVersion = String(data.profile_version || '').trim();
        if (!cycleCode || !profileVersion) {
            return { reason: 'cycle_profile is missing cycle_code/profile_version' };
        }
        if (!isKnownCycleCode(cycleCode)) {
            return { reason: `cycle_profile references unknown cycle ${cycleCode}` };
        }
        // Immutability (plan row 109): a given (cycle_code, profile_version) is an
        // official, immutable profile — its content never changes; a new official
        // file ships as a NEW version row. A pulled PUT whose content differs from
        // the local row is refused; identical content (idempotent re-pull) passes.
        let existing = null;
        try {
            existing = db
                .prepare(
                    `SELECT uses_coefficients, assessment_model FROM cycle_profiles
                     WHERE cycle_code = ? AND profile_version = ?`
                )
                .get(cycleCode, profileVersion);
        } catch {
            return { reason: `cycle_profile ${cycleCode}/${profileVersion}: cycle_profiles table is missing locally` };
        }
        if (existing) {
            const incomingUses = data.uses_coefficients == null ? null : Number(data.uses_coefficients);
            const incomingModel = data.assessment_model == null ? null : String(data.assessment_model).trim();
            const contentChanged =
                (incomingUses != null && incomingUses !== Number(existing.uses_coefficients)) ||
                (incomingModel !== null && incomingModel !== String(existing.assessment_model).trim());
            if (contentChanged) {
                return {
                    reason: `cycle_profile ${cycleCode}/${profileVersion} already exists locally with different content (official profiles are immutable)`
                };
            }
        }
        return null;
    }
    if (item.tableName === 'cycle_profile_assignments') {
        const schoolYear = String(data.school_year || '').trim();
        const cycleCode = String(data.cycle_code || '').trim();
        const profileVersion = String(data.profile_version || '').trim();
        const ruleSetId = data.rule_set_id == null ? null : Number(data.rule_set_id);
        if (!schoolYear || !cycleCode || !profileVersion) {
            return { reason: 'cycle_profile_assignment is missing school_year/cycle_code/profile_version' };
        }
        if (!isKnownCycleCode(cycleCode)) {
            return { reason: `cycle_profile_assignment references unknown cycle ${cycleCode}` };
        }
        let profile = null;
        try {
            profile = db
                .prepare(
                    `SELECT uses_coefficients FROM cycle_profiles
                     WHERE cycle_code = ? AND profile_version = ?`
                )
                .get(cycleCode, profileVersion);
        } catch {
            return { reason: `assignment ${cycleCode}/${profileVersion}: cycle_profiles table is missing locally` };
        }
        if (!profile) {
            return { reason: `assignment references profile ${cycleCode}/${profileVersion} that does not exist locally` };
        }
        const usesCoefficients = Number(profile.uses_coefficients) !== 0;
        if (usesCoefficients && ruleSetId == null) {
            return { reason: `assignment for coefficient cycle ${cycleCode} has no rule_set_id` };
        }
        if (!usesCoefficients && ruleSetId != null) {
            return { reason: `assignment for continuous cycle ${cycleCode} must not reference a rule set` };
        }
        if (ruleSetId != null) {
            let ruleSet = null;
            try {
                ruleSet = db.prepare('SELECT school_year FROM stage_rule_sets WHERE id = ?').get(ruleSetId);
            } catch {
                return { reason: `assignment references rule set ${ruleSetId}: stage_rule_sets is missing locally` };
            }
            if (!ruleSet) return { reason: `assignment references rule set ${ruleSetId} that does not exist locally` };
            if (String(ruleSet.school_year) !== schoolYear) {
                return {
                    reason: `assignment rule set ${ruleSetId} belongs to ${ruleSet.school_year}, not ${schoolYear}`
                };
            }
        }
        return null;
    }
    return null;
}

function registerStageRulesApplyHooks() {
    setApplyHooks('stage_rule_sets', { beforePut: guardStageRuleRevisionBeforePut });
}

module.exports = {
    registerStageRulesApplyHooks,
    guardStageRuleRevisionBeforePut,
    checkCycleProfileConsistency
};
