function normalizeTeacherName(value) {
    const raw = String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/[ؤ]/g, 'و')
        .replace(/[ئ]/g, 'ي')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    if (!raw) return '';
    return raw
        .replace(/(^|\s)ال/g, '$1')
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9\u0600-\u06FF ]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function listTeacherAliases(teacher = {}) {
    const aliases = new Set();
    for (const value of [teacher.full_name, teacher.full_name_fr, teacher.teacher_name, teacher.alias_name]) {
        const alias = String(value || '')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (alias) aliases.add(alias);
    }
    return Array.from(aliases);
}

function ensureTeacherAlias(db, payload = {}) {
    const teacherId = Number(payload.teacher_id);
    const schoolYear = String(payload.school_year || '').trim();
    const aliasName = String(payload.alias_name || '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const aliasNormalized = normalizeTeacherName(aliasName);
    if (!Number.isFinite(teacherId) || teacherId <= 0 || !schoolYear || !aliasName || !aliasNormalized) {
        return null;
    }

    db.prepare(
        `
            INSERT INTO teacher_aliases(teacher_id, alias_name, alias_normalized, source, school_year)
            VALUES(?, ?, ?, ?, ?)
            ON CONFLICT(teacher_id, school_year, alias_normalized) DO UPDATE SET
                alias_name = excluded.alias_name,
                source = COALESCE(excluded.source, teacher_aliases.source)
        `
    ).run(teacherId, aliasName, aliasNormalized, payload.source || null, schoolYear);

    return aliasNormalized;
}

function seedTeacherAliases(db, teacher = {}, source) {
    const teacherId = Number(teacher.id || teacher.teacher_id);
    const schoolYear = String(teacher.school_year || '').trim();
    if (!Number.isFinite(teacherId) || teacherId <= 0 || !schoolYear) return;
    for (const aliasName of listTeacherAliases(teacher)) {
        ensureTeacherAlias(db, {
            teacher_id: teacherId,
            alias_name: aliasName,
            school_year: schoolYear,
            source: source || teacher.source || null
        });
    }
}

function findTeacherByAliases(db, aliasNormalized, schoolYear) {
    if (!aliasNormalized || !schoolYear) return null;
    const aliasRows = db
        .prepare(
            `
            SELECT ta.teacher_id, t.full_name, t.subject
            FROM teacher_aliases ta
            JOIN teachers t ON t.id = ta.teacher_id
            WHERE ta.school_year = ? AND ta.alias_normalized = ?
            ORDER BY ta.teacher_id
        `
        )
        .all(schoolYear, aliasNormalized);
    const uniqueAliasTeacherIds = [...new Set(aliasRows.map((row) => Number(row.teacher_id)).filter((id) => id > 0))];
    if (uniqueAliasTeacherIds.length === 1) {
        return aliasRows.find((row) => Number(row.teacher_id) === uniqueAliasTeacherIds[0]) || null;
    }
    if (uniqueAliasTeacherIds.length > 1) {
        return { ambiguous: true, matches: aliasRows };
    }

    const teacherRows = db
        .prepare(
            `
            SELECT id as teacher_id, full_name, subject
            FROM teachers
            WHERE school_year = ?
            ORDER BY id
        `
        )
        .all(schoolYear);
    const exactMatches = teacherRows.filter((row) => normalizeTeacherName(row.full_name) === aliasNormalized);
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) return { ambiguous: true, matches: exactMatches };
    return null;
}

function resolveTeacherIdentity(db, payload = {}) {
    const schoolYear = String(payload.school_year || '').trim();
    const teacherId = Number(payload.teacher_id);
    const teacherName = String(payload.teacher_name || '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (Number.isFinite(teacherId) && teacherId > 0) {
        const row = db
            .prepare('SELECT id as teacher_id, full_name, subject FROM teachers WHERE id = ? AND school_year = ?')
            .get(teacherId, schoolYear);
        if (row) {
            if (teacherName) {
                ensureTeacherAlias(db, {
                    teacher_id: row.teacher_id,
                    alias_name: teacherName,
                    school_year: schoolYear,
                    source: payload.source || null
                });
            }
            return {
                teacher_id: row.teacher_id,
                teacher_name: row.full_name || teacherName || '',
                subject: row.subject || payload.subject || ''
            };
        }
    }

    const aliasNormalized = normalizeTeacherName(teacherName);
    if (!aliasNormalized || !schoolYear) {
        return {
            teacher_id: null,
            teacher_name: teacherName || null,
            subject: payload.subject || null
        };
    }

    const matched = findTeacherByAliases(db, aliasNormalized, schoolYear);
    if (!matched || matched.ambiguous) {
        return {
            teacher_id: null,
            teacher_name: teacherName || null,
            subject: payload.subject || null,
            ambiguous: Boolean(matched && matched.ambiguous)
        };
    }

    ensureTeacherAlias(db, {
        teacher_id: matched.teacher_id,
        alias_name: teacherName,
        school_year: schoolYear,
        source: payload.source || null
    });

    return {
        teacher_id: matched.teacher_id,
        teacher_name: matched.full_name || teacherName || null,
        subject: payload.subject || matched.subject || null
    };
}

// R6/R7 — return the given teacher_id only if it references a real teacher row,
// otherwise null. Side-effect-free (unlike resolveTeacherIdentity, which also
// registers aliases). Used by insert/upsert paths that now sit behind a
// teacher_id → teachers(id) foreign key so a stale id degrades to NULL (keeping
// the teacher_name snapshot) instead of failing the write.
function teacherIdOrNull(db, teacherId) {
    const n = Number(teacherId);
    if (!Number.isFinite(n) || n <= 0) return null;
    const row = db.prepare('SELECT 1 FROM teachers WHERE id = ?').get(n);
    return row ? n : null;
}

module.exports = {
    normalizeTeacherName,
    listTeacherAliases,
    ensureTeacherAlias,
    seedTeacherAliases,
    resolveTeacherIdentity,
    teacherIdOrNull
};
