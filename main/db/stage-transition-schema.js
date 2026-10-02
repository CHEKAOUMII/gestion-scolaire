'use strict';

/**
 * Slice 6 transition-seam DDL (docs/plans/2026-09-27-isolation-principle-stage-separation(1).md §Slice 6).
 *
 * `student_stage_transitions` is the dedicated audit record for the single intentional
 * cross-stage path. `student_movements` cannot serve this role: it carries only one
 * `cycle_code` and has no from/to cycle columns or persisted idempotency key.
 *
 * Idempotent: safe to call on every boot (main/db/init.js) and from the numbered
 * migration registry entry (parent-wired at merge). Creates local data structures
 * only — zero outbox rows, like every other migration seed path.
 */

const STAGE_TRANSITION_TABLE = 'student_stage_transitions';

const STAGE_TRANSITION_TYPES = Object.freeze(['inter_year_progression', 'intra_year_reclassification']);

function ensureStageTransitionSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS student_stage_transitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL REFERENCES students(id),
            student_code TEXT NOT NULL,
            from_school_year TEXT NOT NULL,
            to_school_year TEXT NOT NULL,
            from_cycle_code TEXT NOT NULL,
            to_cycle_code TEXT NOT NULL,
            transition_type TEXT NOT NULL
                CHECK(transition_type IN ('inter_year_progression', 'intra_year_reclassification')),
            idempotency_key TEXT NOT NULL UNIQUE,
            effective_date DATE NOT NULL,
            reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_stage_transitions_student
            ON student_stage_transitions(student_code, to_school_year);
    `);
}

module.exports = { ensureStageTransitionSchema, STAGE_TRANSITION_TABLE, STAGE_TRANSITION_TYPES };
