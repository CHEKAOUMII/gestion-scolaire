'use strict';

/**
 * Student orientation domain repository (027-layering-remediation).
 */

const { captureInputUpserts, notifyCaptureCommitted } = require('./capture-port');

/** Soft cap so IPC replies stay small; totals remain authoritative. */
const MAX_DETAILS = 80;

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
    let sql = `
            SELECT ${ORIENTATION_LIST_SELECT}
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
 * - UPDATE never changes student_code or school_year columns.
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
    const selectStudentByCode = db.prepare(`
                SELECT gender, full_name, section
                FROM students
                WHERE school_year = ? AND UPPER(TRIM(code)) = ?
                LIMIT 1
            `);
    const insertStmt = db.prepare(`
                INSERT INTO student_orientation (
                    student_code, full_name, gender, section, level,
                    origin_stream, choice_1, choice_2, choice_3,
                    assigned_stream, decision_status, average, rank_num, notes, school_year, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
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
    const captureItems = [];

    // One transaction: any unexpected throw rolls back every write in this batch.
    // Per-row validation failures only skip that row (no partial commit of errors).
    const run = db.transaction((list) => {
        for (const raw of list) {
            const incoming = mapRow(raw);

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

            if (!existing) {
                insertStmt.run(
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
                    merged.notes,
                    schoolYear
                );
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
        details,
        detailsTruncated: inserted + updated + unchanged + skipped > details.length
    };
}

function clearYear(db, year) {
    const result = db.prepare('DELETE FROM student_orientation WHERE school_year = ?').run(year);
    return { success: true, deleted: result.changes, schoolYear: year };
}

function deleteById(db, id) {
    const numId = Number(id);
    if (!Number.isFinite(numId) || numId <= 0) {
        throw new Error('معرّف غير صالح');
    }
    db.prepare('DELETE FROM student_orientation WHERE id = ?').run(numId);
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
