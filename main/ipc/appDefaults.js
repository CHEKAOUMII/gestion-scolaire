// main/ipc/appDefaults.js
// App default settings: exam counts per level, and page role access matrix.

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { handleRead, handleWrite, handleWriteSoftAuth, getDefaultYear } = require('./ipc-helpers');
const {
    DEFAULT_EXAM_COUNTS,
    LEVEL_CODES,
    PAGE_LABELS,
    EXCLUDED_HTML_PAGES
} = require('../db/exam-count-defaults');
const { mapSubjectToCode, SUBJECT_CATALOG } = require('../db/education-catalogs/subject-catalog');
const {
    PRIMARY_CYCLE,
    COLLEGIAL_CYCLE,
    QUALIFIANT_CYCLE
} = require('../../js/shared/education/cycles');

/** Lazy require: repos are loaded at call time, never at module registration. */
function getStageRulesRepo() {
    return require('../repos/stage-rules');
}
const {
    PAGE_PERMISSIONS,
    ROLE_LABELS,
    ALLOWED_ROLES,
    clearPageAccessCache
} = require('../auth/permissions');

const INSTITUTION_ROLES = ALLOWED_ROLES.filter((r) => r !== 'admin');

// Reserved marker keeps an explicit deny-all override distinguishable from no override.
const PAGE_ACCESS_OVERRIDE_MARKER = '__override__';

// Push a "page access changed" signal to every open window so already-open pages
// re-run their access guard live (redirect off a now-forbidden page, refresh the
// sidebar) without waiting for a manual reload. Mirrors the notifications channel
// broadcast pattern (main/notifications/channels/*). Best-effort: never throws.
function broadcastPageAccessChanged() {
    try {
        for (const win of BrowserWindow.getAllWindows()) {
            if (win.isDestroyed()) continue;
            win.webContents.send('appDefaults:pageAccessChanged');
        }
    } catch {
        // Broadcasting must never break the save response.
    }
}

function normalizeLevelCode(value) {
    const raw = String(value || '').trim();
    if (!raw) return '*';
    if (raw === '*') return '*';
    return raw.toUpperCase();
}

function normalizeSubject(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizePageKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const clean = raw.split('#')[0].split('?')[0].replace(/\\/g, '/');
    const fileName = clean.split('/').pop() || '';
    if (/^[a-zA-Z0-9._-]+\.html$/i.test(fileName)) {
        return fileName.replace(/\.html$/i, '').toLowerCase();
    }
    if (/^[a-zA-Z0-9._-]+$/i.test(fileName)) {
        return fileName.toLowerCase();
    }
    return '';
}

function ensureExamCountTables(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS page_role_access (
            page_key TEXT NOT NULL,
            role TEXT NOT NULL,
            allowed INTEGER NOT NULL DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (page_key, role)
        );
    `);
}

function seedExamCountsIfEmpty(db) {
    // Exam counts are seeded and versioned by the stage-rules migration.
    // This legacy helper remains as a no-op for listLevels compatibility.
    ensureExamCountTables(db);
}

/**
 * Resolve an exam-count row for a subject code against the active rule-set rows.
 * Precedence per specs/029-stage-rules-management/contracts/resolver.md
 * (exam-count variant): exact level → level '*' → cycle default. Key precedence
 * comes first; within the same key, custom beats official.
 *
 * Cycle-aware (2026-08-02-multi-stage-school-architecture.md, S2-3): the
 * requested cycle defaults to qualifiant so legacy call sites are unchanged.
 * Non-qualifiant cycles have no seeded rows, so the lookups fail closed (null).
 */
function resolveExamCountRow(rows, subjectCode, level, cycleCode = QUALIFIANT_CYCLE) {
    const forKey = (cycle, levelCode) => {
        const matches = rows.filter(
            (row) =>
                String(row.cycle_code) === cycle &&
                String(row.level_code) === levelCode &&
                String(row.subject_code) === subjectCode
        );
        if (!matches.length) return null;
        return matches.find((row) => row.source === 'custom') || matches[0];
    };
    return forKey(cycleCode, level) || forKey(cycleCode, '*') || forKey('*', '*') || null;
}

/** Map a resolved rule-set row back to the legacy source labels (seed/level/default). */
function examCountSource(row, level, cycleCode = QUALIFIANT_CYCLE) {
    if (String(row.level_code) === level && String(row.cycle_code) === cycleCode) return 'level';
    if (level === '*' && String(row.level_code) === '*' && String(row.cycle_code) === cycleCode) {
        return 'level';
    }
    return 'default';
}

function lookupExamCount(db, levelCode, subject, cycleCode = QUALIFIANT_CYCLE) {
    const level = normalizeLevelCode(levelCode);
    const subj = normalizeSubject(subject);
    if (!subj) return null;

    const ruleSet = getStageRulesRepo().getActiveRuleSet(db, getDefaultYear());
    if (!ruleSet) return null;

    const rows = getStageRulesRepo().getRuleSetRows(db, ruleSet.id).examCounts;
    const subjectCode = mapSubjectToCode(subj);
    if (subjectCode) {
        const row = resolveExamCountRow(rows, subjectCode, level, cycleCode);
        if (row) return Number(row.exam_count);
    }

    // Fuzzy match against known subjects (catalog labels of codes present in the rule set).
    const lower = subj.toLowerCase();
    for (const row of rows) {
        const label = String(SUBJECT_CATALOG[row.subject_code]?.labelAr || '').toLowerCase();
        if (label && (lower.includes(label) || label.includes(lower))) {
            const matched = resolveExamCountRow(rows, row.subject_code, level, cycleCode);
            if (matched) return Number(matched.exam_count);
        }
    }
    return null;
}

function listHtmlPages() {
    let root;
    try {
        root = app.getAppPath();
    } catch {
        root = path.join(__dirname, '..', '..');
    }

    let files = [];
    try {
        files = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith('.html'));
    } catch {
        files = Object.keys(PAGE_LABELS);
    }

    const pages = [];
    for (const file of files) {
        const lower = file.toLowerCase();
        if (EXCLUDED_HTML_PAGES.has(lower)) continue;
        if (!/^[a-zA-Z0-9._-]+\.html$/i.test(file)) continue;

        const labels = PAGE_LABELS[lower] || PAGE_LABELS[file] || null;
        const pageKey = lower.replace(/\.html$/i, '');
        pages.push({
            page: lower,
            pageKey,
            title: labels?.title || file,
            group: labels?.group || 'أخرى'
        });
    }

    // Ensure known catalog pages appear even if missing from disk (packaged edge cases)
    for (const [file, labels] of Object.entries(PAGE_LABELS)) {
        if (EXCLUDED_HTML_PAGES.has(file)) continue;
        if (pages.some((p) => p.page === file)) continue;
        pages.push({
            page: file,
            pageKey: file.replace(/\.html$/i, ''),
            title: labels.title,
            group: labels.group
        });
    }

    pages.sort((a, b) => {
        const g = String(a.group).localeCompare(String(b.group), 'ar');
        if (g !== 0) return g;
        return String(a.title).localeCompare(String(b.title), 'ar');
    });
    return pages;
}

function loadDbRoleMap(db) {
    ensureExamCountTables(db);
    const rows = db.prepare('SELECT page_key, role, allowed FROM page_role_access').all();
    const map = {};
    const pagesWithRows = new Set();
    for (const row of rows) {
        const key = normalizePageKey(row.page_key);
        if (!key) continue;
        pagesWithRows.add(key);
        if (!map[key]) map[key] = [];
        if (Number(row.allowed) === 1) {
            map[key].push(String(row.role));
        }
    }
    return { map, pagesWithRows };
}

// Legacy "all levels" adapter row: LEVEL_CODES no longer carries the '*' marker
// (S2-2 single-source dedup), but the listLevels API keeps it for compatibility.
const LEGACY_ALL_LEVELS_ROW = Object.freeze({ code: '*', name: 'الافتراضي (كل المستويات)', order: 0 });

function registerAppDefaultsIpc(ipcMain) {
    handleRead(ipcMain, 'appDefaults:listLevels', (db, payload) => {
        seedExamCountsIfEmpty(db);
        // Cycle-aware extension (2026-08-01-primary-stage-catalogs.md, S3/S5):
        // without a cycle the legacy qualifiant shape is returned unchanged.
        const cycleCode = String(payload?.cycleCode ?? payload ?? '').trim();
        const withLegacyAllRow = (levels) => [LEGACY_ALL_LEVELS_ROW, ...levels];
        if (!cycleCode) {
            return { success: true, levels: withLegacyAllRow(LEVEL_CODES) };
        }
        const { PRIMARY_LEVEL_CODES, COLLEGIAL_LEVEL_CODES } = require('../db/education-catalogs/primary-levels');
        const levelCatalogs = {
            [PRIMARY_CYCLE]: PRIMARY_LEVEL_CODES,
            [COLLEGIAL_CYCLE]: COLLEGIAL_LEVEL_CODES,
            [QUALIFIANT_CYCLE]: withLegacyAllRow(LEVEL_CODES)
        };
        if (!levelCatalogs[cycleCode]) {
            return { success: false, code: 'UNKNOWN_CYCLE', cycleCode, error: 'السلك التعليمي غير معروف' };
        }
        return { success: true, cycleCode, levels: levelCatalogs[cycleCode] };
    });

    handleRead(ipcMain, 'appDefaults:getExamCounts', (db, ...args) => {
        const raw = args[0];
        const payload = raw && typeof raw === 'object' ? raw : null;
        const level = normalizeLevelCode(payload ? payload.levelCode ?? payload.level ?? '*' : raw ?? '*');
        const cycleCode = String(payload?.cycleCode ?? payload?.cycle_code ?? '').trim() || QUALIFIANT_CYCLE;

        // Cycle-aware extension (2026-08-02-multi-stage-school-architecture.md, S2-3):
        // without a cycle the legacy qualifiant shape is returned unchanged.
        const { getCycleDefinition } = require('../../js/shared/education/cycles');
        const cycleDefinition = getCycleDefinition(cycleCode);
        if (!cycleDefinition) {
            return { success: false, code: 'UNKNOWN_CYCLE', cycleCode, error: 'السلك التعليمي غير معروف' };
        }
        const assessmentModel = cycleDefinition.assessmentModel ?? null;
        if (cycleCode === PRIMARY_CYCLE) {
            // Primary subjects come from the primary catalog (single source of
            // truth) — never hardcoded here. No exam_count_rules rows exist for
            // primary (CHECK 1..12 cannot express zero exams), so every entry is
            // null/'missing' (fail-closed read, no silent fallback to qualifiant).
            const { PRIMARY_SUBJECTS } = require('../db/education-catalogs/primary-subjects');
            const subjects = Object.keys(PRIMARY_SUBJECTS)
                .map((code) => ({
                    subject: PRIMARY_SUBJECTS[code].labelAr,
                    examCount: null,
                    source: 'missing'
                }))
                .sort((a, b) => String(a.subject).localeCompare(String(b.subject), 'ar'));
            return { success: true, cycleCode, assessmentModel, levelCode: level, subjects };
        }
        if (cycleCode === COLLEGIAL_CYCLE) {
            // Collegial subjects come from the collegial catalog (single source of
            // truth — never hardcoded here); exam counts resolve from the ACTIVE
            // rule set's collegial rows (fail-closed null/'missing' when absent —
            // no silent fallback to qualifiant counts).
            const { COLLEGIAL_SUBJECTS } = require('../db/education-catalogs/collegial-subjects');
            const ruleSet = getStageRulesRepo().getActiveRuleSet(db, getDefaultYear());
            const rows = ruleSet ? getStageRulesRepo().getRuleSetRows(db, ruleSet.id).examCounts : [];
            const subjects = Object.keys(COLLEGIAL_SUBJECTS)
                .map((code) => {
                    const row = resolveExamCountRow(rows, code, level, cycleCode);
                    return {
                        subject: COLLEGIAL_SUBJECTS[code].labelAr,
                        examCount: row ? Number(row.exam_count) : null,
                        source: !row ? 'missing' : examCountSource(row, level, cycleCode)
                    };
                })
                .sort((a, b) => String(a.subject).localeCompare(String(b.subject), 'ar'));
            return { success: true, cycleCode, assessmentModel, levelCode: level, subjects };
        }

        const ruleSet = getStageRulesRepo().getActiveRuleSet(db, getDefaultYear());
        if (!ruleSet) {
            return {
                success: false,
                code: 'RULES_UNAVAILABLE',
                error: 'لا تتوفر نسخة قواعد فعالة لهذه السنة الدراسية'
            };
        }
        const rows = getStageRulesRepo().getRuleSetRows(db, ruleSet.id).examCounts;

        const bySubject = new Map();
        const coveredCodes = new Set();
        for (const [subject] of DEFAULT_EXAM_COUNTS) {
            const subjectCode = mapSubjectToCode(subject);
            if (subjectCode) coveredCodes.add(subjectCode);
            const row = subjectCode ? resolveExamCountRow(rows, subjectCode, level, cycleCode) : null;
            bySubject.set(subject, {
                subject,
                examCount: row ? Number(row.exam_count) : null,
                source: !row ? 'missing' : examCountSource(row, level, cycleCode)
            });
        }
        for (const row of rows) {
            const code = String(row.subject_code || '');
            if (!code || coveredCodes.has(code)) continue;
            coveredCodes.add(code);
            const resolved = resolveExamCountRow(rows, code, level, cycleCode);
            if (!resolved) continue;
            const label = SUBJECT_CATALOG[code]?.labelAr || code;
            bySubject.set(label, {
                subject: label,
                examCount: Number(resolved.exam_count),
                source: examCountSource(resolved, level, cycleCode)
            });
        }

        return {
            success: true,
            cycleCode,
            assessmentModel,
            levelCode: level,
            subjects: Array.from(bySubject.values()).sort((a, b) =>
                String(a.subject).localeCompare(String(b.subject), 'ar')
            )
        };
    });

    handleRead(ipcMain, 'appDefaults:getExamCount', (db, payload) => {
        const levelCode = payload?.levelCode ?? payload?.level ?? '*';
        const subject = payload?.subject ?? '';
        const cycleCode = String(payload?.cycleCode ?? payload?.cycle_code ?? '').trim() || QUALIFIANT_CYCLE;
        const count = lookupExamCount(db, levelCode, subject, cycleCode);
        if (count == null) {
            return {
                success: false,
                code: 'MISSING_RULE',
                count: null,
                levelCode: normalizeLevelCode(levelCode),
                subject: normalizeSubject(subject)
            };
        }
        return { success: true, count, levelCode: normalizeLevelCode(levelCode), subject: normalizeSubject(subject) };
    });

    handleWriteSoftAuth(
        ipcMain,
        'appDefaults:saveExamCounts',
        ['admin', 'principal', 'developer'],
        ({ db, session }, payload) => {
        const level = normalizeLevelCode(payload?.levelCode);
        const subjects = Array.isArray(payload?.subjects) ? payload.subjects : [];
        if (!subjects.length) {
            return { success: false, code: 'INVALID_PAYLOAD', error: 'قائمة المواد فارغة' };
        }

        // Cycle-aware (S2-3): absent cycle keeps the legacy qualifiant behavior.
        // The cycle code rides on every entry so the existing repo guard
        // (requireQualifiantCycles in main/repos/stage-rules.js) rejects any
        // non-qualifiant write — this IPC layer never weakens that guard.
        const cycleCode = String(payload?.cycleCode ?? payload?.cycle_code ?? '').trim() || QUALIFIANT_CYCLE;

        const entries = subjects.reduce((result, item) => {
            const subject = normalizeSubject(item?.subject ?? item?.name);
            const subjectCode = mapSubjectToCode(subject);
            const examCount = Number(item?.examCount ?? item?.count);
            if (!subjectCode || !Number.isInteger(examCount) || examCount < 1 || examCount > 12) return result;
            result.push({
                cycleCode,
                levelCode: level,
                subjectCode,
                examCount
            });
            return result;
        }, []);
        if (!entries.length) {
            return { success: false, code: 'INVALID_PAYLOAD', error: 'لا توجد قواعد فروض قابلة للحفظ' };
        }

        const result = getStageRulesRepo().saveExamCounts(db, {
            schoolYear: payload?.schoolYear || getDefaultYear(),
            entries,
            reason: payload?.reason || 'تحديث عدد الفروض من إعدادات التطبيق',
            actor: session
        });
        return { success: true, levelCode: level, saved: entries.length, ...(result || {}) };
    },
        { withContext: true }
    );

    handleRead(ipcMain, 'appDefaults:listPages', (db) => {
        ensureExamCountTables(db);
        const pages = listHtmlPages();
        const roles = INSTITUTION_ROLES.map((role) => ({
            role,
            label: ROLE_LABELS[role] || role
        }));

        const { map, pagesWithRows } = loadDbRoleMap(db);
        const result = pages.map((p) => {
            const effectiveRoles = pagesWithRows.has(p.pageKey)
                ? map[p.pageKey] || []
                : PAGE_PERMISSIONS[p.pageKey] || [];
            return {
                ...p,
                roles: INSTITUTION_ROLES.map((role) => ({
                    role,
                    allowed: effectiveRoles.includes(role)
                })),
                hasDbOverride: pagesWithRows.has(p.pageKey)
            };
        });

        return { success: true, pages: result, roles };
    });

    handleRead(ipcMain, 'appDefaults:getPageAccessMap', (db) => {
        ensureExamCountTables(db);
        const { map, pagesWithRows } = loadDbRoleMap(db);
        const full = {};
        for (const page of listHtmlPages()) {
            if (pagesWithRows.has(page.pageKey)) {
                full[page.pageKey] = map[page.pageKey] || [];
            } else {
                full[page.pageKey] = PAGE_PERMISSIONS[page.pageKey] || [];
            }
        }
        return { success: true, map: full, overriddenPages: Array.from(pagesWithRows) };
    });

    handleWrite(ipcMain, 'appDefaults:savePageAccess', ['admin', 'developer'], (db, _event, payload) => {
        ensureExamCountTables(db);
        const pages = Array.isArray(payload?.pages) ? payload.pages : [];
        if (!pages.length) {
            return { success: false, code: 'INVALID_PAYLOAD', error: 'لا توجد صفحات للحفظ' };
        }

        const deleteStmt = db.prepare('DELETE FROM page_role_access WHERE page_key = ?');
        const markerStmt = db.prepare(`
            INSERT INTO page_role_access(page_key, role, allowed, updated_at)
            VALUES(?, ?, 0, CURRENT_TIMESTAMP)
        `);
        const insertStmt = db.prepare(`
            INSERT INTO page_role_access(page_key, role, allowed, updated_at)
            VALUES(?, ?, 1, CURRENT_TIMESTAMP)
        `);

        const tx = db.transaction(() => {
            for (const item of pages) {
                const pageKey = normalizePageKey(item?.pageKey ?? item?.page);
                if (!pageKey) continue;
                deleteStmt.run(pageKey);
                markerStmt.run(pageKey, PAGE_ACCESS_OVERRIDE_MARKER);
                const roles = Array.isArray(item?.roles) ? item.roles : [];
                for (const role of roles) {
                    const r = String(role || '').trim().toLowerCase();
                    if (!INSTITUTION_ROLES.includes(r)) continue;
                    insertStmt.run(pageKey, r);
                }
            }
        });
        tx();

        clearPageAccessCache();
        broadcastPageAccessChanged();
        return { success: true, saved: pages.length };
    });
}

module.exports = {
    registerAppDefaultsIpc,
    seedExamCountsIfEmpty,
    ensureExamCountTables,
    lookupExamCount,
    normalizePageKey
};
