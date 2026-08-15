'use strict';

/**
 * Student orientation domain repository (027-layering-remediation).
 *
 * Cycle ownership: `student_orientation` is institution-wide by design (multi-stage
 * plan §2 G8 / §3 S0) — its reads/writes are NOT scoped to the session's active
 * cycle. Since S3 (migration 2026-08-081) it carries `cycle_code` as a historical
 * snapshot derived here in main from the students table at write time: never
 * renderer-supplied, immutable once written (updates preserve it even when the
 * student's cycle changes later). The institution-wide read exception closes in
 * S6, not here — do not add cycle filtering without updating
 * tests/s0-cycle-gate.test.js and the plan.
 */

const {
    captureInputUpserts,
    captureDeletesFromRows,
    notifyCaptureCommitted
} = require('./capture-port');

/** Soft cap so IPC replies stay small; totals remain authoritative. */
const MAX_DETAILS = 80;

/** Schema probe: unit-test fixtures may pre-date the S3 column additions. */
function tableHasColumn(db, tableName, columnName) {
    return db.pragma(`table_info(${tableName})`).some((col) => col.name === columnName);
}

const MERGE_TEXT_FIELDS = [
    'full_name',
    'gender',
    'section',
    'level',
    'origin_stream',
    'choice_1',
    'choice_2',
    'choice_3',
    'assigned_stream',
    'decision_status',
    'notes'
];

const MERGE_NUM_FIELDS = ['average', 'rank_num'];

function normalizeText(value) {
    if (value == null) return null;
    const s = String(value).trim();
    return s || null;
}

function normalizeCode(value) {
    const s = normalizeText(value);
    return s ? s.toUpperCase() : null;
}

function toNumberOrNull(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const n = Number(
        String(value)
            .replace(/\s+/g, '')
            .replace(',', '.')
            .trim()
    );
    return Number.isFinite(n) ? n : null;
}

function mapRow(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            student_code: null,
            full_name: null,
            gender: null,
            section: null,
            level: null,
            origin_stream: null,
            choice_1: null,
            choice_2: null,
            choice_3: null,
            assigned_stream: null,
            decision_status: null,
            average: null,
            rank_num: null,
            notes: null,
            school_year: null
        };
    }

    let c1 = raw.choice_1 || raw.choix1 || raw.choice1;
    let c2 = raw.choice_2 || raw.choix2 || raw.choice2;
    let c3 = raw.choice_3 || raw.choix3 || raw.choice3;
    if (Array.isArray(raw.choices) && raw.choices.length) {
        const sorted = raw.choices.slice().sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0));
        const levels = sorted
            .map((c) => normalizeText(c?.targetLevel || c?.target_level || c?.level || c?.filiere))
            .filter(Boolean);
        if (!c1 && levels[0]) c1 = levels[0];
        if (!c2 && levels[1]) c2 = levels[1];
        if (!c3 && levels[2]) c3 = levels[2];
    }

    return {
        student_code: normalizeCode(
            raw.student_code ||
                raw.studentCode ||
                raw.code ||
                raw.massar_code ||
                raw.massar ||
                raw.CodeEleve ||
                raw.Code ||
                raw.CODE
        ),
        full_name: normalizeText(
            raw.full_name ||
                raw.fullName ||
                raw.name ||
                raw.student_name ||
                raw.nom_complet ||
                raw.NomComplet ||
                [raw.lastName || raw.family_name, raw.firstName || raw.first_name].filter(Boolean).join(' ')
        ),
        gender: normalizeText(raw.gender || raw.sexe),
        section: normalizeText(raw.section || raw.className || raw.class_name || raw.class || raw.classe),
        level: normalizeText(raw.level || raw.niveau || raw.currentLevel || raw.current_level),
        origin_stream: normalizeText(
            raw.origin_stream ||
                raw.currentLevel ||
                raw.current_level ||
                raw.filiere_origine ||
                raw.stream_origin ||
                raw.filiere ||
                raw.stream
        ),
        choice_1: normalizeText(c1),
        choice_2: normalizeText(c2),
        choice_3: normalizeText(c3),
        assigned_stream: normalizeText(
            raw.assigned_stream ||
                raw.assignedLevel ||
                raw.assigned_level ||
                raw.affectation ||
                raw.decision ||
                raw.Affectation
        ),
        decision_status: normalizeText(
            raw.decision_status ||
                raw.result ||
                raw.resultCategory ||
                raw.result_category ||
                raw.statut ||
                raw.status ||
                raw.Etat
        ),
        average: toNumberOrNull(raw.average ?? raw.moyenne ?? raw.avg),
        rank_num: toNumberOrNull(raw.rank_num ?? raw.rank ?? raw.rang),
        notes: normalizeText(raw.notes || raw.remarques || raw.justification),
        school_year: normalizeText(raw.school_year || raw.schoolYear)
    };
}

function pickText(existing, incoming) {
    const next = normalizeText(incoming);
    if (next != null) return next;
    return normalizeText(existing);
}

function pickNum(existing, incoming) {
    if (incoming != null && incoming !== '' && Number.isFinite(Number(incoming))) {
        return Number(incoming);
    }
    if (existing != null && existing !== '' && Number.isFinite(Number(existing))) {
        return Number(existing);
    }
    return null;
}

function numEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Number(a) === Number(b);
}

function textEqual(a, b) {
    return normalizeText(a) === normalizeText(b);
}

/**
 * Non-destructive field merge.
 * Merge key is only (student_code, school_year) — never name/section/level.
 * On update, student_code is taken from the existing row and must not change.
 * NULL / empty / whitespace-only incoming values do not erase existing values.
 * Numeric 0 is a valid value for average/rank_num.
 */
function mergeOrientationRow(existing, incoming) {
    const base = existing || {};
    const code = existing
        ? normalizeCode(existing.student_code)
        : normalizeCode(incoming && incoming.student_code);

    const merged = {
        // Immutable on update: always prefer the persisted code
        student_code: code,
        full_name: pickText(base.full_name, incoming && incoming.full_name),
        gender: pickText(base.gender, incoming && incoming.gender),
        section: pickText(base.section, incoming && incoming.section),
        level: pickText(base.level, incoming && incoming.level),
        origin_stream: pickText(base.origin_stream, incoming && incoming.origin_stream),
        choice_1: pickText(base.choice_1, incoming && incoming.choice_1),
        choice_2: pickText(base.choice_2, incoming && incoming.choice_2),
        choice_3: pickText(base.choice_3, incoming && incoming.choice_3),
        assigned_stream: pickText(base.assigned_stream, incoming && incoming.assigned_stream),
        decision_status: pickText(base.decision_status, incoming && incoming.decision_status),
        average: pickNum(base.average, incoming && incoming.average),
        rank_num: pickNum(base.rank_num, incoming && incoming.rank_num),
        notes: pickText(base.notes, incoming && incoming.notes)
    };

    if (!merged.origin_stream) {
        merged.origin_stream =
            normalizeText(base.origin_stream) || normalizeText(incoming && incoming.origin_stream);
    }

    const changedFields = [];
    if (!existing) {
        return { merged, changedFields: ['*'] };
    }

    for (const f of MERGE_TEXT_FIELDS) {
        if (!textEqual(base[f], merged[f])) changedFields.push(f);
    }
    for (const f of MERGE_NUM_FIELDS) {
        if (!numEqual(base[f], merged[f])) changedFields.push(f);
    }

    return { merged, changedFields };
}

function pushDetail(details, entry) {
    if (details.length < MAX_DETAILS) details.push(entry);
}

const EFFECTIVE_GENDER_SQL = `COALESCE(NULLIF(trim(o.gender), ''), NULLIF(trim(s.gender), ''))`;
const MALE_GENDER_SQL = `('ذكر','M','m','male','Male','1')`;
const FEMALE_GENDER_SQL = `('أنثى','F','f','female','Female','2')`;

const ORIENTATION_LIST_SELECT = `
    o.id,
    o.student_code,
    o.cycle_code,
    COALESCE(NULLIF(trim(o.full_name), ''), s.full_name) AS full_name,
    ${EFFECTIVE_GENDER_SQL} AS gender,
    COALESCE(NULLIF(trim(o.section), ''), s.section) AS section,
    o.level,
    o.origin_stream,
    o.choice_1,
    o.choice_2,
    o.choice_3,
    o.assigned_stream,
    o.decision_status,
    o.average,
    o.rank_num,
    o.notes,
    o.school_year,
    o.created_at,
    o.updated_at,
    s.id AS student_id
`;

const ORIENTATION_FROM_JOIN = `
    FROM student_orientation o
    LEFT JOIN students s
      ON s.school_year = o.school_year
     AND UPPER(TRIM(s.code)) = UPPER(TRIM(o.student_code))
`;

function list(db, year, filters = {}) {
    // Production always has the column after 2026-08-081; pre-migration unit-test
    // fixtures may not, in which case the row shape is preserved via a NULL alias.
    const selectFields = tableHasColumn(db, 'student_orientation', 'cycle_code')
        ? ORIENTATION_LIST_SELECT
        : ORIENTATION_LIST_SELECT.replace('o.cycle_code,', 'NULL AS cycle_code,');
    let sql = `
            SELECT ${selectFields}
            ${ORIENTATION_FROM_JOIN}
            WHERE o.school_year = ?
        `;
    const params = [year];

    if (filters.originStream || filters.origin_stream) {
        sql += ' AND o.origin_stream = ?';
        params.push(String(filters.originStream || filters.origin_stream).trim());
    }
    if (filters.section) {
        sql += " AND COALESCE(NULLIF(trim(o.section), ''), s.section) = ?";
        params.push(String(filters.section).trim());
    }
    if (filters.level) {
        sql += ' AND o.level = ?';
        params.push(String(filters.level).trim());
    }
    if (filters.choice1 || filters.choice_1) {
        sql += ' AND o.choice_1 = ?';
        params.push(String(filters.choice1 || filters.choice_1).trim());
    }
    if (filters.assignedStream || filters.assigned_stream) {
        sql += ' AND o.assigned_stream = ?';
        params.push(String(filters.assignedStream || filters.assigned_stream).trim());
    }
    if (filters.searchTerm || filters.search) {
        const q = `%${String(filters.searchTerm || filters.search).trim()}%`;
        sql += ` AND (
                o.student_code LIKE ?
                OR COALESCE(NULLIF(trim(o.full_name), ''), s.full_name) LIKE ?
                OR COALESCE(NULLIF(trim(o.section), ''), s.section) LIKE ?
            )`;
        params.push(q, q, q);
    }

    sql += ' ORDER BY o.origin_stream COLLATE NOCASE, full_name COLLATE NOCASE, o.student_code';
    return { success: true, rows: db.prepare(sql).all(...params), schoolYear: year };
}

function stats(db, year) {
    const summary = db
        .prepare(
            `
                    SELECT
                        COUNT(*) AS total,
                        COUNT(DISTINCT o.origin_stream) AS origin_count,
                        COUNT(DISTINCT o.choice_1) AS choice1_distinct,
                        COUNT(DISTINCT o.assigned_stream) AS assigned_distinct,
                        SUM(CASE WHEN o.assigned_stream IS NOT NULL AND trim(o.assigned_stream) != '' THEN 1 ELSE 0 END) AS assigned_count,
                        SUM(CASE WHEN o.choice_1 IS NOT NULL AND trim(o.choice_1) != '' THEN 1 ELSE 0 END) AS with_choice1,
                        SUM(CASE WHEN ${EFFECTIVE_GENDER_SQL} IN ${FEMALE_GENDER_SQL} THEN 1 ELSE 0 END) AS female_count,
                        SUM(CASE WHEN ${EFFECTIVE_GENDER_SQL} IN ${MALE_GENDER_SQL} THEN 1 ELSE 0 END) AS male_count
                    ${ORIENTATION_FROM_JOIN}
                    WHERE o.school_year = ?
                `
        )
        .get(year);

    const byOrigin = db
        .prepare(
            `
                    SELECT o.origin_stream AS key, COUNT(*) AS count
                    ${ORIENTATION_FROM_JOIN}
                    WHERE o.school_year = ?
                    GROUP BY o.origin_stream
                    ORDER BY count DESC, o.origin_stream COLLATE NOCASE
                `
        )
        .all(year);

    const byChoice1 = db
        .prepare(
            `
                    SELECT COALESCE(NULLIF(trim(o.choice_1), ''), '—') AS key, COUNT(*) AS count
                    ${ORIENTATION_FROM_JOIN}
                    WHERE o.school_year = ?
                    GROUP BY COALESCE(NULLIF(trim(o.choice_1), ''), '—')
                    ORDER BY count DESC, key COLLATE NOCASE
                `
        )
        .all(year);

    const byAssigned = db
        .prepare(
            `
                    SELECT COALESCE(NULLIF(trim(o.assigned_stream), ''), 'غير مسند') AS key, COUNT(*) AS count
                    ${ORIENTATION_FROM_JOIN}
                    WHERE o.school_year = ?
                    GROUP BY COALESCE(NULLIF(trim(o.assigned_stream), ''), 'غير مسند')
                    ORDER BY count DESC, key COLLATE NOCASE
                `
        )
        .all(year);

    const matrixRows = db
        .prepare(
            `
                    SELECT
                        o.origin_stream AS origin,
                        COALESCE(NULLIF(trim(o.choice_1), ''), '—') AS choice,
                        COUNT(*) AS count
                    ${ORIENTATION_FROM_JOIN}
                    WHERE o.school_year = ?
                    GROUP BY o.origin_stream, COALESCE(NULLIF(trim(o.choice_1), ''), '—')
                    ORDER BY origin COLLATE NOCASE, count DESC
                `
        )
        .all(year);

    const originKeys = [...new Set(matrixRows.map((r) => r.origin))];
    const choiceKeys = [...new Set(matrixRows.map((r) => r.choice))];
    const matrix = {};
    for (const row of matrixRows) {
        if (!matrix[row.origin]) matrix[row.origin] = {};
        matrix[row.origin][row.choice] = row.count;
    }

    return {
        success: true,
        schoolYear: year,
        summary: summary || {
            total: 0,
            origin_count: 0,
            choice1_distinct: 0,
            assigned_distinct: 0,
            assigned_count: 0,
            with_choice1: 0,
            female_count: 0,
            male_count: 0
        },
        byOrigin,
        byChoice1,
        byAssigned,
        matrix: { origins: originKeys, choices: choiceKeys, cells: matrix }
    };
}

/**
 * Bulk insert/update for student_orientation.
 *
 * Safety rules:
 * - Entire batch runs inside one SQLite transaction (atomic commit / full rollback).
 * - Merge key is ONLY (student_code, school_year) — never name, section, or level.
 * - UPDATE never changes student_code, school_year, or cycle_code columns.
 * - cycle_code is a main-derived historical snapshot: renderer values are stripped,
 *   inserts take it from the students roster, updates keep the existing value, and
 *   unresolvable inserts are written NULL and reported in `unresolvedCycle`. On the
 *   production schema (students carries cycle_code, post 2026-08-081) an insert
 *   whose student has no roster match is REJECTED — plan row 132 refuses history
 *   for a student the institution does not know; pre-081 fixtures keep the
 *   NULL-write fallback so legacy shapes stay importable.
 * - Non-destructive field merge (empty/NULL does not wipe existing values).
 * - Unchanged rows skip the UPDATE statement.
 * - Does NOT call clearYear / year-wide DELETE.
 * - Invalid rows are skipped with a reason; unexpected DB errors abort the whole batch.
 *
 * @param {object} db
 * @param {object|array} payload
 * @param {string} schoolYear - already validated (YYYY/YYYY)
 * @param {(y: string) => string} normalizeYearFn
 * @param {{ duplicatesInFile?: number }} [options]
 */
function bulkUpsert(db, payload, schoolYear, normalizeYearFn, options = {}) {
    const rows = Array.isArray(payload) ? payload : payload?.rows;
    const duplicatesInFile = Math.max(
        0,
        Number(options.duplicatesInFile != null ? options.duplicatesInFile : payload?.duplicatesInFile) || 0
    );

    if (!Array.isArray(rows) || rows.length === 0) {
        const err = new Error('لا توجد صفوف للاستيراد');
        err.code = 'INVALID_RECORD';
        throw err;
    }

    // Lookup / write keyed strictly by student_code + school_year
    const selectExisting = db.prepare(
        `SELECT * FROM student_orientation WHERE student_code = ? AND school_year = ?`
    );
    // cycle_code columns exist in production (2026-08-081 / students table); older
    // unit-test fixtures without them degrade gracefully to the legacy shape.
    const hasCycleColumn = tableHasColumn(db, 'student_orientation', 'cycle_code');
    const hasStudentCycleCode = tableHasColumn(db, 'students', 'cycle_code');
    const selectStudentByCode = db.prepare(`
                SELECT gender, full_name, section${hasStudentCycleCode ? ', cycle_code' : ''}
                FROM students
                WHERE school_year = ? AND UPPER(TRIM(code)) = ?
                LIMIT 1
            `);
    const insertStmt = db.prepare(
        hasCycleColumn
            ? `INSERT INTO student_orientation (
                    student_code, full_name, gender, section, level,
                    origin_stream, choice_1, choice_2, choice_3,
                    assigned_stream, decision_status, average, rank_num, notes,
                    cycle_code, school_year, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
            : `INSERT INTO student_orientation (
                    student_code, full_name, gender, section, level,
                    origin_stream, choice_1, choice_2, choice_3,
                    assigned_stream, decision_status, average, rank_num, notes,
                    school_year, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    );
    // NOTE: student_code and school_year are intentionally absent from SET
    const updateStmt = db.prepare(`
                UPDATE student_orientation SET
                    full_name = ?,
                    gender = ?,
                    section = ?,
                    level = ?,
                    origin_stream = ?,
                    choice_1 = ?,
                    choice_2 = ?,
                    choice_3 = ?,
                    assigned_stream = ?,
                    decision_status = ?,
                    average = ?,
                    rank_num = ?,
                    notes = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE student_code = ? AND school_year = ?
            `);

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    const details = [];
    const unresolvedCycle = [];
    const captureItems = [];

    // One transaction: any unexpected throw rolls back every write in this batch.
    // Per-row validation failures only skip that row (no partial commit of errors).
    const run = db.transaction((list) => {
        for (const raw of list) {
            const incoming = mapRow(raw);

            // cycle_code is a main-derived historical snapshot — never renderer-supplied
            delete incoming.cycle_code;
            delete incoming.cycleCode;

            // Row school year must match the request year when present
            if (incoming.school_year) {
                const rawYear = String(incoming.school_year).trim();
                let rowYear = null;
                if (/^\d{4}\/\d{4}$/.test(rawYear)) {
                    rowYear = rawYear;
                } else if (typeof normalizeYearFn === 'function') {
                    const n = normalizeYearFn(rawYear);
                    if (n && n === schoolYear) rowYear = n;
                }
                if (rowYear !== schoolYear) {
                    skipped += 1;
                    pushDetail(details, {
                        student_code: incoming.student_code || null,
                        outcome: 'skipped',
                        reason: 'year_mismatch',
                        message: 'سنة الصف لا تطابق سنة الطلب'
                    });
                    continue;
                }
            }

            if (!incoming.student_code) {
                skipped += 1;
                pushDetail(details, {
                    student_code: null,
                    outcome: 'skipped',
                    reason: 'missing_code',
                    message: 'رمز التلميذ مفقود'
                });
                continue;
            }

            // Soft-fill display fields from students roster (not used as merge key)
            const roster = selectStudentByCode.get(schoolYear, incoming.student_code);
            if (roster) {
                if (!incoming.gender && roster.gender) {
                    incoming.gender = normalizeText(roster.gender);
                }
                if (!incoming.full_name && roster.full_name) {
                    incoming.full_name = normalizeText(roster.full_name);
                }
                if (!incoming.section && roster.section) {
                    incoming.section = normalizeText(roster.section);
                }
            }
            // Cycle snapshot source for the INSERT path (NULL when unresolvable).
            const derivedCycleCode = roster && hasStudentCycleCode ? normalizeText(roster.cycle_code) : null;

            // origin_stream required for insert; for update may keep existing
            if (!incoming.origin_stream) {
                const existingProbe = selectExisting.get(incoming.student_code, schoolYear);
                if (!existingProbe || !normalizeText(existingProbe.origin_stream)) {
                    skipped += 1;
                    pushDetail(details, {
                        student_code: incoming.student_code,
                        outcome: 'skipped',
                        reason: 'missing_origin_stream',
                        message: 'الشعبة الأصلية مفقودة'
                    });
                    continue;
                }
            }

            const existing = selectExisting.get(incoming.student_code, schoolYear);
            const { merged, changedFields } = mergeOrientationRow(existing, incoming);

            if (!merged.origin_stream) {
                skipped += 1;
                pushDetail(details, {
                    student_code: incoming.student_code,
                    outcome: 'skipped',
                    reason: 'missing_origin_stream',
                    message: 'الشعبة الأصلية مفقودة'
                });
                continue;
            }

            // Force immutable identity on every write path
            const code = existing ? normalizeCode(existing.student_code) : merged.student_code;
            if (!code) {
                skipped += 1;
                pushDetail(details, {
                    student_code: null,
                    outcome: 'skipped',
                    reason: 'missing_code',
                    message: 'رمز التلميذ مفقود'
                });
                continue;
            }
            merged.student_code = code;

            // Historical cycle snapshot (S3/S6, plan row 132): derived in main from
            // the students roster on insert, preserved verbatim on update — it never
            // changes even if the student's cycle does later. On the production
            // schema (students carries cycle_code) an insert with no roster match is
            // REJECTED: history may not be filed for a student the institution does
            // not know. Pre-081 fixtures keep the legacy fallback — unresolvable
            // inserts are written NULL (never guessed, never defaulted) and reported
            // for review in the response.
            if (existing) {
                merged.cycle_code = existing.cycle_code != null ? normalizeText(existing.cycle_code) : null;
            } else {
                if (hasStudentCycleCode && !roster) {
                    skipped += 1;
                    pushDetail(details, {
                        student_code: merged.student_code,
                        outcome: 'skipped',
                        reason: 'no_matching_student',
                        message: 'رمز التلميذ غير موجود في سجل التلاميذ'
                    });
                    unresolvedCycle.push({ student_code: merged.student_code, reason: 'no_matching_student' });
                    continue;
                }
                merged.cycle_code = derivedCycleCode;
                if (!merged.cycle_code) {
                    unresolvedCycle.push({
                        student_code: merged.student_code,
                        reason: roster ? 'student_cycle_empty' : 'no_matching_student'
                    });
                }
            }

            if (!existing) {
                const insertArgs = [
                    merged.student_code,
                    merged.full_name,
                    merged.gender,
                    merged.section,
                    merged.level,
                    merged.origin_stream,
                    merged.choice_1,
                    merged.choice_2,
                    merged.choice_3,
                    merged.assigned_stream,
                    merged.decision_status,
                    merged.average,
                    merged.rank_num,
                    merged.notes
                ];
                if (hasCycleColumn) insertArgs.push(merged.cycle_code);
                insertArgs.push(schoolYear);
                insertStmt.run(...insertArgs);
                inserted += 1;
                captureItems.push({ student_code: merged.student_code, school_year: schoolYear });
                pushDetail(details, {
                    student_code: merged.student_code,
                    outcome: 'inserted'
                });
                continue;
            }

            if (!changedFields.length) {
                // Avoid UPDATE when nothing valid changed
                unchanged += 1;
                pushDetail(details, {
                    student_code: merged.student_code,
                    outcome: 'unchanged'
                });
                continue;
            }

            // WHERE uses existing code + request school_year — identity never rewritten
            updateStmt.run(
                merged.full_name,
                merged.gender,
                merged.section,
                merged.level,
                merged.origin_stream,
                merged.choice_1,
                merged.choice_2,
                merged.choice_3,
                merged.assigned_stream,
                merged.decision_status,
                merged.average,
                merged.rank_num,
                merged.notes,
                existing.student_code,
                schoolYear
            );
            updated += 1;
            captureItems.push({
                student_code: normalizeCode(existing.student_code),
                school_year: schoolYear
            });
            pushDetail(details, {
                student_code: normalizeCode(existing.student_code),
                outcome: 'updated',
                changedFields
            });
        }

        if (captureItems.length) {
            captureInputUpserts(db, {
                tableName: 'student_orientation',
                keyFields: ['school_year', 'student_code'],
                items: captureItems,
                operation: 'PUT'
            });
        }
        if (typeof options.audit === 'function') {
            options.audit({
                success: true,
                inserted,
                updated,
                unchanged,
                skipped,
                unresolvedCycle
            });
        }
    });

    run(rows);
    if (captureItems.length) {
        notifyCaptureCommitted();
    }

    const imported = inserted + updated;
    return {
        success: true,
        schoolYear,
        inserted,
        updated,
        unchanged,
        skipped,
        duplicatesInFile,
        imported,
        unresolvedCycle,
        details,
        detailsTruncated: inserted + updated + unchanged + skipped > details.length
    };
}

function clearYear(db, year) {
    const run = db.transaction((targetYear) => {
        const rows = db.prepare('SELECT * FROM student_orientation WHERE school_year = ?').all(targetYear);
        captureDeletesFromRows(db, 'student_orientation', rows);
        return db.prepare('DELETE FROM student_orientation WHERE school_year = ?').run(targetYear).changes;
    });
    const deleted = run(year);
    if (deleted > 0) notifyCaptureCommitted();
    return { success: true, deleted, schoolYear: year };
}

function deleteById(db, id) {
    const numId = Number(id);
    if (!Number.isFinite(numId) || numId <= 0) {
        throw new Error('معرّف غير صالح');
    }
    // Tombstone written here, inside the transaction (CHANNEL_REGISTRY
    // 'orientation:delete' is captureMode 'explicit') — the IPC wrapper no
    // longer captures, so a mid-capture failure rolls the delete back.
    const run = db.transaction(() => {
        const rows = db.prepare('SELECT * FROM student_orientation WHERE id = ?').all(numId);
        captureDeletesFromRows(db, 'student_orientation', rows);
        return db.prepare('DELETE FROM student_orientation WHERE id = ?').run(numId).changes;
    });
    const deleted = run();
    if (deleted > 0) notifyCaptureCommitted();
    return { success: true };
}

module.exports = {
    list,
    stats,
    bulkUpsert,
    clearYear,
    deleteById,
    mapRow,
    mergeOrientationRow,
    pickText,
    pickNum,
    toNumberOrNull,
    normalizeCode,
    normalizeText
};
