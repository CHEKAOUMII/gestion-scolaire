// main/ipc/appDefaults.js
// App default settings: exam counts per level, and page role access matrix.

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { handleRead, handleWrite } = require('./ipc-helpers');
const {
    DEFAULT_EXAM_COUNTS,
    LEVEL_CODES,
    PAGE_LABELS,
    EXCLUDED_HTML_PAGES
} = require('../db/exam-count-defaults');
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

function clampExamCount(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return 2;
    return Math.min(12, Math.max(1, Math.round(num)));
}

function ensureExamCountTables(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS exam_count_rules (
            level_code TEXT NOT NULL,
            subject TEXT NOT NULL,
            exam_count INTEGER NOT NULL CHECK (exam_count BETWEEN 1 AND 12),
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (level_code, subject)
        );
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
    ensureExamCountTables(db);
    const row = db.prepare('SELECT COUNT(*) AS c FROM exam_count_rules').get();
    if (Number(row?.c || 0) > 0) return;
    const insert = db.prepare(`
        INSERT INTO exam_count_rules(level_code, subject, exam_count, updated_at)
        VALUES(?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const tx = db.transaction(() => {
        for (const [subject, count] of DEFAULT_EXAM_COUNTS) {
            insert.run('*', subject, clampExamCount(count));
        }
    });
    tx();
}

function lookupExamCount(db, levelCode, subject) {
    const level = normalizeLevelCode(levelCode);
    const subj = normalizeSubject(subject);
    if (!subj) return 3;

    if (level !== '*') {
        const levelRow = db
            .prepare(
                'SELECT exam_count FROM exam_count_rules WHERE level_code = ? AND subject = ? COLLATE NOCASE'
            )
            .get(level, subj);
        if (levelRow) return Number(levelRow.exam_count);
    }

    const globalRow = db
        .prepare(
            "SELECT exam_count FROM exam_count_rules WHERE level_code = '*' AND subject = ? COLLATE NOCASE"
        )
        .get(subj);
    if (globalRow) return Number(globalRow.exam_count);

    // Fuzzy match against known subjects
    const all = db
        .prepare("SELECT subject, exam_count FROM exam_count_rules WHERE level_code = '*' OR level_code = ?")
        .all(level);
    const lower = subj.toLowerCase();
    for (const row of all) {
        const s = String(row.subject || '').toLowerCase();
        if (s && (lower.includes(s) || s.includes(lower))) {
            return Number(row.exam_count);
        }
    }
    return 3;
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

function registerAppDefaultsIpc(ipcMain) {
    handleRead(ipcMain, 'appDefaults:listLevels', (db) => {
        seedExamCountsIfEmpty(db);
        return { success: true, levels: LEVEL_CODES };
    });

    handleRead(ipcMain, 'appDefaults:getExamCounts', (db, levelCode) => {
        seedExamCountsIfEmpty(db);
        const level = normalizeLevelCode(levelCode);
        const levelRows = db
            .prepare('SELECT subject, exam_count FROM exam_count_rules WHERE level_code = ? ORDER BY subject')
            .all(level);
        const globalRows = db
            .prepare("SELECT subject, exam_count FROM exam_count_rules WHERE level_code = '*' ORDER BY subject")
            .all();

        const bySubject = new Map();
        for (const [subject, count] of DEFAULT_EXAM_COUNTS) {
            bySubject.set(subject, { subject, examCount: count, source: 'seed' });
        }
        for (const row of globalRows) {
            bySubject.set(row.subject, {
                subject: row.subject,
                examCount: Number(row.exam_count),
                source: level === '*' ? 'level' : 'default'
            });
        }
        if (level !== '*') {
            for (const row of levelRows) {
                bySubject.set(row.subject, {
                    subject: row.subject,
                    examCount: Number(row.exam_count),
                    source: 'level'
                });
            }
        }

        return {
            success: true,
            levelCode: level,
            subjects: Array.from(bySubject.values()).sort((a, b) =>
                String(a.subject).localeCompare(String(b.subject), 'ar')
            )
        };
    });

    handleRead(ipcMain, 'appDefaults:getExamCount', (db, payload) => {
        seedExamCountsIfEmpty(db);
        const levelCode = payload?.levelCode ?? payload?.level ?? '*';
        const subject = payload?.subject ?? '';
        const count = lookupExamCount(db, levelCode, subject);
        return { success: true, count, levelCode: normalizeLevelCode(levelCode), subject: normalizeSubject(subject) };
    });

    handleWrite(ipcMain, 'appDefaults:saveExamCounts', ['admin', 'developer'], (db, _event, payload) => {
        seedExamCountsIfEmpty(db);
        const level = normalizeLevelCode(payload?.levelCode);
        const subjects = Array.isArray(payload?.subjects) ? payload.subjects : [];
        if (!subjects.length) {
            return { success: false, code: 'INVALID_PAYLOAD', error: 'قائمة المواد فارغة' };
        }

        const upsert = db.prepare(`
            INSERT INTO exam_count_rules(level_code, subject, exam_count, updated_at)
            VALUES(?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(level_code, subject)
            DO UPDATE SET exam_count = excluded.exam_count, updated_at = CURRENT_TIMESTAMP
        `);

        const tx = db.transaction(() => {
            for (const item of subjects) {
                const subject = normalizeSubject(item?.subject ?? item?.name);
                if (!subject) continue;
                upsert.run(level, subject, clampExamCount(item?.examCount ?? item?.count));
            }
        });
        tx();

        return { success: true, levelCode: level, saved: subjects.length };
    });

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
