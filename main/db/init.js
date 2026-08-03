const Database = require('better-sqlite3');
const { setDb, getDbPath, applyConnectionPragmas } = require('./context');
const { createTables } = require('./schema');
const { runMigrations } = require('./migrations');
const { QUALIFIANT_CYCLE } = require('../../js/shared/education/cycles');

/**
 * Version of the official rule-seed data shipped with this build (US-3, T025).
 * The stage-rules migration seeds revision 1 ("Official seed rules"); when a
 * future build ships newer official coefficients it bumps this constant AND
 * buildOfficialSeedData(), and every device refreshes its active rule sets on
 * next startup. Devices whose max revision is already >= the shipped revision
 * are skipped, so the upgrade is idempotent.
 */
const OFFICIAL_RULES_SEED_REVISION = 1;
const OFFICIAL_RULES_UPGRADE_REASON = 'تحديث القواعد الرسمية المرفقة مع التطبيق';

/**
 * Build the seedData contract for applyOfficialRuleSet(db, seedData, reason):
 * official coefficient rows from the qualifiant catalog (rule_set_id stripped —
 * the repo binds the new revision's id) plus the default exam counts.
 * Pure, synchronous, and cheap; requires no DB access.
 */
function buildOfficialSeedData(schoolYear) {
    const { getOfficialCoefficientRows } = require('./education-catalogs/qualifiant-coefficients');
    const { DEFAULT_EXAM_COUNTS } = require('./exam-count-defaults');
    const { mapSubjectToCode } = require('./education-catalogs/subject-catalog');
    const { getOfficialSubjectWeightRows } = require('./education-catalogs/subject-weights');

    const coefficients = getOfficialCoefficientRows({ ruleSetId: 1, cycleCode: QUALIFIANT_CYCLE }).map((row) => ({
        cycle_code: row.cycle_code,
        level_code: row.level_code,
        stream_code: row.stream_code,
        subject_code: row.subject_code,
        coefficient: row.coefficient,
        source: row.source
    }));
    const examCounts = [];
    for (const [subject, examCount] of DEFAULT_EXAM_COUNTS) {
        const subjectCode = mapSubjectToCode(subject);
        if (!subjectCode) continue;
        examCounts.push({
            cycle_code: QUALIFIANT_CYCLE,
            level_code: '*',
            subject_code: subjectCode,
            exam_count: examCount,
            source: 'official'
        });
    }
    const weights = getOfficialSubjectWeightRows({ ruleSetId: 1, cycleCode: QUALIFIANT_CYCLE }).map((row) => ({
        cycle_code: row.cycle_code,
        subject_code: row.subject_code,
        exam_weight_bps: row.exam_weight_bps,
        activity_weight_bps: row.activity_weight_bps,
        source: row.source
    }));
    return {
        revision: OFFICIAL_RULES_SEED_REVISION,
        schoolYear,
        cycleCode: QUALIFIANT_CYCLE,
        coefficients,
        examCounts,
        weights
    };
}

/**
 * Refresh every school year whose active rule set predates the shipped official
 * seed. Runs after migrations on app start: synchronous, zero outbox, and it
 * never throws — a missing table, a broken catalog, or an unexpected DB state
 * only logs a warning so startup is never blocked by the upgrade path.
 * @param {object} db
 * @param {number} [seedRevision] test seam — defaults to the shipped constant
 */
function maybeApplyOfficialRuleSets(db, seedRevision = OFFICIAL_RULES_SEED_REVISION) {
    try {
        if (!db) return;
        const { applyOfficialRuleSet } = require('../repos/stage-rules');
        const years = db
            .prepare(`SELECT DISTINCT school_year FROM stage_rule_sets WHERE status = 'active'`)
            .all();
        for (const { school_year: schoolYear } of years) {
            const maxRow = db
                .prepare(`SELECT MAX(revision) AS max FROM stage_rule_sets WHERE school_year = ?`)
                .get(schoolYear);
            if (maxRow && Number(maxRow.max) >= Number(seedRevision)) continue;
            applyOfficialRuleSet(db, buildOfficialSeedData(schoolYear), OFFICIAL_RULES_UPGRADE_REASON);
        }
        // Collegial official file (2026-08-084): refresh collegial rows + the
        // per-year assignment into every active revision, including years created
        // after the collegial migration. Local seed data — zero outbox, zero capture.
        const { ensureCollegialForActiveRevisions } = require('./education-catalogs/collegial-rules');
        ensureCollegialForActiveRevisions(db);
    } catch (error) {
        console.warn('[db] Official rule-set upgrade skipped:', error?.message || error);
    }
}

function initDatabase() {
    const dbPath = getDbPath();
    let db = null;

    try {
        db = new Database(dbPath);

        // Connection tuning: WAL, FK enforcement, busy_timeout, synchronous=NORMAL,
        // wal_autocheckpoint (R3). Centralized so restore paths stay in sync.
        applyConnectionPragmas(db);

        setDb(db);
        console.log('[db] Database opened at:', dbPath);

        createTables();
        runMigrations();
        maybeApplyOfficialRuleSets(db);
        return db;
    } catch (error) {
        console.error('[db] Failed to initialize database at:', dbPath, error);

        if (db) {
            try {
                db.close();
            } catch (closeError) {
                console.warn('[db] Failed to close database after init error:', closeError?.message || closeError);
            }
        }

        try {
            setDb(null);
        } catch {
            // Ignore state reset failures during startup recovery.
        }

        throw error;
    }
}

module.exports = { initDatabase, maybeApplyOfficialRuleSets, buildOfficialSeedData, OFFICIAL_RULES_SEED_REVISION };
