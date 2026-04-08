# Data Integration / Master Data Management — Implementation Plan (v2 — Extensible)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build three coordinated layers — NameResolver, CrossSourceValidator, DataSourceRegistry + Import Status Panel — as **independent files** (not stuffed into utils.js), forming a clean foundation that can evolve into a full MasterData architecture later with minimal friction.

**Architecture:** Each class lives in its own file under `js/`. Scripts are loaded via `<script defer>` in HTML pages that need them. The three files are designed as the nucleus of a future `js/master-data.js` — adding that file later requires zero rewrites. `settings-imports.js` (3346 lines) is NOT restructured; only hook calls are added at the end of each `importXxx()`.

**Tech Stack:** Vanilla JS (no bundler), better-sqlite3, Electron IPC via contextBridge, existing Message System (`showToast`, `showConfirm`), Tailwind CSS v4 utility classes + `@layer components`.

**Spec:** `docs/superpowers/specs/2026-04-07-data-integration-master-data-management.md`

**Future path to Master Data Architecture:**
```
js/name-resolver.js          ← built now
js/data-source-registry.js   ← built now
js/cross-source-validator.js ← built now
         ↓  later, one file added:
js/master-data.js            ← imports the three above, adds MasterData class
                                + js/importers/ splits settings-imports.js
```

---

## Files Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `main/db/migrations.js` | Add migration `2026-04-042-name-aliases` |
| Modify | `main/ipc/staff.js` | Add `teachers:saveNameAlias`, `teachers:getNameAliases`, `teachers:deleteNameAlias` |
| Modify | `preload.js` | Expose three new channels under `window.api.teachers` |
| **Create** | `js/name-resolver.js` | `NameResolver` class — standalone, no deps |
| **Create** | `js/data-source-registry.js` | `DataSourceRegistry` class — localStorage-backed |
| **Create** | `js/cross-source-validator.js` | `CrossSourceValidator` class — depends on NameResolver |
| Modify | `js/pages/settings-imports.js` | Call validator + registry after each `importXxx()` |
| Modify | `settings-imports.html` | Load 3 new scripts + add Import Status Panel HTML |
| Modify | `css/tailwind-input.css` | Add `.import-status-*` component styles |

---

## Task 1: DB Migration — `name_aliases` table

**Files:**
- Modify: `main/db/migrations.js`

- [ ] **Step 1: Add the migration at the end of the MIGRATIONS array**

In `main/db/migrations.js`, find the closing `}` of the last migration (`2026-04-041-compensation-tracking-reason-notes`) and append:

```js
    {
        version: '2026-04-042-name-aliases',
        up: () => {
            const db = getDb();
            db.exec(`
                CREATE TABLE IF NOT EXISTS name_aliases (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_type       TEXT NOT NULL,
                    canonical_id      INTEGER NOT NULL,
                    alias_text        TEXT NOT NULL,
                    alias_normalized  TEXT NOT NULL,
                    source            TEXT NOT NULL,
                    school_year       TEXT,
                    confidence        REAL DEFAULT 1.0,
                    created_at        TEXT DEFAULT (datetime('now')),
                    UNIQUE(entity_type, alias_normalized, school_year)
                );
                CREATE INDEX IF NOT EXISTS idx_name_aliases_lookup
                    ON name_aliases(entity_type, alias_normalized, school_year);
            `);
        }
    }
```

- [ ] **Step 2: Start the app and verify the migration runs**

Run: `npm run start`
Open DevTools console. Expected: no migration error, app starts normally. Quit the app.

- [ ] **Step 3: Commit**

```bash
git add main/db/migrations.js
git commit -m "feat: add name_aliases migration for master data management"
```

---

## Task 2: IPC handlers — save / get / delete name alias

**Files:**
- Modify: `main/ipc/staff.js`
- Modify: `preload.js`

- [ ] **Step 1: Add three handlers at the end of `registerStaffIpc` in `main/ipc/staff.js`**

Find the final closing `};` of `registerStaffIpc` and insert before it:

```js
    handleRead(ipcMain, 'teachers:getNameAliases', (db, entityType, schoolYear) => {
        return db
            .prepare(
                `SELECT * FROM name_aliases
                 WHERE entity_type = ?
                   AND (school_year = ? OR school_year IS NULL)
                 ORDER BY created_at DESC`
            )
            .all(entityType, schoolYear || null);
    });

    handleWrite(ipcMain, 'teachers:saveNameAlias', ['admin', 'staff'], (db, _event, payload) => {
        const { entity_type, canonical_id, alias_text, alias_normalized, source, school_year, confidence } = payload;
        db.prepare(
            `INSERT INTO name_aliases
                (entity_type, canonical_id, alias_text, alias_normalized, source, school_year, confidence)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(entity_type, alias_normalized, school_year) DO UPDATE SET
                canonical_id = excluded.canonical_id,
                alias_text   = excluded.alias_text,
                source       = excluded.source,
                confidence   = excluded.confidence`
        ).run(entity_type, canonical_id, alias_text, alias_normalized, source, school_year || null, confidence ?? 1.0);
        return { success: true };
    });

    handleWrite(ipcMain, 'teachers:deleteNameAlias', ['admin', 'staff'], (db, _event, id) => {
        db.prepare('DELETE FROM name_aliases WHERE id = ?').run(id);
        return { success: true };
    });
```

- [ ] **Step 2: Expose the channels in `preload.js`**

Inside the `teachers: { ... }` block (after the `saveTafwijAliases` line), add:

```js
        getNameAliases: (entityType, schoolYear) =>
            ipcRenderer.invoke('teachers:getNameAliases', entityType, schoolYear),
        saveNameAlias: (payload) => ipcRenderer.invoke('teachers:saveNameAlias', payload),
        deleteNameAlias: (id) => ipcRenderer.invoke('teachers:deleteNameAlias', id),
```

- [ ] **Step 3: Run smoke test**

```bash
npm run test:smoke
```

Expected: all checks pass (IPC parity validated — channels in preload.js match handlers in staff.js).

- [ ] **Step 4: Commit**

```bash
git add main/ipc/staff.js preload.js
git commit -m "feat: add name alias IPC handlers (save/get/delete)"
```

---

## Task 3: Create `js/name-resolver.js`

**Files:**
- Create: `js/name-resolver.js`

This file is self-contained — no imports, no deps on other app files. It exposes `NameResolver` as a global (browser script tag pattern, no bundler).

- [ ] **Step 1: Create the file**

```js
// js/name-resolver.js
// Standalone — no dependencies. Load before any script that uses NameResolver.
// Future: will be imported by js/master-data.js

'use strict';

const _NR_TITLES = [
    'الأستاذ', 'الأستاذة', 'أستاذ', 'أستاذة',
    'م', 'د', 'دكتور', 'دكتورة',
    'mr', 'mme', 'mme.', 'mr.', 'pr', 'pr.', 'm.'
];

class NameResolver {
    /**
     * @param {Array<{id: number|null, name: string}>} candidates
     */
    constructor(candidates) {
        this._candidates = (candidates || []).filter((c) => c && c.name);
        this._normalized = this._candidates.map((c) => ({
            ...c,
            _norm: NameResolver.normalizeName(c.name)
        }));
    }

    /**
     * Normalize a name string for comparison.
     * Removes diacritics, normalizes Arabic letter variants, collapses whitespace.
     * @param {string} str
     * @returns {string}
     */
    static normalizeName(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .replace(/[\u0610-\u061A\u064B-\u065F]/g, '')   // Arabic diacritics
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي')
            .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')      // keep Arabic + latin + digits
            .replace(/\s+/g, ' ')
            .trim();
    }

    static _stripTitles(norm) {
        let result = norm;
        for (const t of _NR_TITLES) {
            const pattern = new RegExp(
                `(^|\\s)${NameResolver.normalizeName(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`,
                'g'
            );
            result = result.replace(pattern, ' ');
        }
        return result.replace(/\s+/g, ' ').trim();
    }

    static _levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) =>
            Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
        );
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        return dp[m][n];
    }

    static _similarity(a, b) {
        if (!a && !b) return 1;
        if (!a || !b) return 0;
        const dist = NameResolver._levenshtein(a, b);
        return 1 - dist / Math.max(a.length, b.length);
    }

    /** Arabic-to-Latin phonetic skeleton for transliteration comparison. */
    static _latinSkeleton(norm) {
        const map = {
            'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh',
            'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's',
            'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
            'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y'
        };
        return norm.split('').map((c) => map[c] ?? c).join('').replace(/\s+/g, ' ').trim();
    }

    /**
     * Synchronous resolution — steps 1-5 only (no DB).
     * @param {string} rawName
     * @returns {{ candidateId: number|null, confidence: number, matchType: string, normalizedName?: string, needsReview?: boolean, candidates?: Array }}
     */
    resolve(rawName) {
        if (!rawName) return { candidateId: null, confidence: 0, matchType: 'unmatched', needsReview: true };

        const norm = NameResolver.normalizeName(rawName);

        // Step 1 — exact match after normalization
        for (const c of this._normalized) {
            if (c._norm === norm)
                return { candidateId: c.id, confidence: 1.0, matchType: 'exact', normalizedName: c.name };
        }

        // Step 2 — swap first/family name order
        const parts = norm.split(/\s+/).filter(Boolean);
        if (parts.length === 2) {
            const swapped = `${parts[1]} ${parts[0]}`;
            for (const c of this._normalized) {
                if (c._norm === swapped)
                    return { candidateId: c.id, confidence: 0.97, matchType: 'swapped', normalizedName: c.name };
            }
        }

        // Step 3 — strip honorific titles, then re-run steps 1-2
        const stripped = NameResolver._stripTitles(norm);
        if (stripped && stripped !== norm) {
            const inner = new NameResolver(this._candidates).resolve(stripped);
            if (inner.matchType === 'exact' || inner.matchType === 'swapped') {
                return { ...inner, confidence: Math.min(inner.confidence, 0.93), matchType: 'stripped' };
            }
        }

        // Step 4 — Arabic↔Latin transliteration skeleton
        const inputSkeleton = NameResolver._latinSkeleton(norm);
        for (const c of this._normalized) {
            const cSkeleton = NameResolver._latinSkeleton(c._norm);
            if (inputSkeleton && cSkeleton && NameResolver._similarity(inputSkeleton, cSkeleton) >= 0.88) {
                return { candidateId: c.id, confidence: 0.88, matchType: 'transliterated', normalizedName: c.name };
            }
        }

        // Step 5 — fuzzy Levenshtein ≥ 85%
        const fuzzyMatches = this._normalized
            .map((c) => ({ ...c, score: NameResolver._similarity(norm, c._norm) }))
            .filter((c) => c.score >= 0.85)
            .sort((a, b) => b.score - a.score);

        if (fuzzyMatches.length === 1)
            return { candidateId: fuzzyMatches[0].id, confidence: fuzzyMatches[0].score, matchType: 'fuzzy', normalizedName: fuzzyMatches[0].name };

        if (fuzzyMatches.length > 1)
            return {
                candidates: fuzzyMatches.map((c) => ({ candidateId: c.id, confidence: c.score, name: c.name })),
                matchType: 'fuzzy',
                needsReview: true
            };

        return { candidateId: null, confidence: 0, matchType: 'unmatched', needsReview: true };
    }

    /**
     * Async resolution — step 6: checks DB aliases first, then falls back to resolve().
     * @param {string} rawName
     * @param {string} schoolYear
     * @returns {Promise<object>}
     */
    async resolveAsync(rawName, schoolYear) {
        if (window.api?.teachers?.getNameAliases) {
            try {
                const aliases = await window.api.teachers.getNameAliases('teacher', schoolYear);
                const normInput = NameResolver.normalizeName(rawName);
                const match = (aliases || []).find((a) => a.alias_normalized === normInput);
                if (match) {
                    const candidate = this._candidates.find((c) => c.id === match.canonical_id);
                    return {
                        candidateId: match.canonical_id,
                        confidence: 1.0,
                        matchType: 'alias',
                        normalizedName: candidate?.name || rawName
                    };
                }
            } catch (_) { /* fall through */ }
        }
        return this.resolve(rawName);
    }
}
```

- [ ] **Step 2: Verify in DevTools (open any page, inject manually)**

Run: `npm run start`, open DevTools console on any page, paste:

```js
const r = new NameResolver([{ id: 1, name: 'بنعلي محمد' }]);

console.assert(r.resolve('بنعلي محمد').matchType === 'exact', 'exact failed');
console.assert(r.resolve('محمد بنعلي').matchType === 'swapped', 'swap failed');
console.assert(r.resolve('م. بنعلي').matchType === 'stripped', 'strip failed');
console.assert(r.resolve('BENALI Mohamed').matchType === 'transliterated', 'transliteration failed');
console.log('NameResolver: all assertions passed');
```

Expected: `NameResolver: all assertions passed`

- [ ] **Step 3: Commit**

```bash
git add js/name-resolver.js
git commit -m "feat: add NameResolver standalone class (js/name-resolver.js)"
```

---

## Task 4: Create `js/data-source-registry.js`

**Files:**
- Create: `js/data-source-registry.js`

Self-contained, depends only on `localStorage`. No other app files needed.

- [ ] **Step 1: Create the file**

```js
// js/data-source-registry.js
// Standalone — depends only on localStorage.
// Future: will be imported by js/master-data.js

'use strict';

const _DSR_STORAGE_KEY = 'dataSourceRegistry';

class DataSourceRegistry {
    static _load() {
        try {
            return JSON.parse(localStorage.getItem(_DSR_STORAGE_KEY) || '{}');
        } catch (_) {
            return {};
        }
    }

    static _save(data) {
        localStorage.setItem(_DSR_STORAGE_KEY, JSON.stringify(data));
    }

    /**
     * Record a successful import for a source.
     * @param {string} source      — 'students' | 'grades' | 'absences' | 'fet' | 'agent_xml' | 'status'
     * @param {string} schoolYear
     * @param {object} meta        — { count?, sections?, subjects?, teachers?, pprList? }
     * @param {Array}  warnings    — CrossSourceValidator warnings for this source
     */
    static update(source, schoolYear, meta = {}, warnings = []) {
        const data = DataSourceRegistry._load();
        if (!data[schoolYear]) data[schoolYear] = {};
        data[schoolYear][source] = { importedAt: new Date().toISOString(), ...meta };
        // replace warnings for this source, keep others
        data[schoolYear].warnings = [
            ...(data[schoolYear].warnings || []).filter((w) => w.source !== source),
            ...warnings.map((w) => ({ ...w, source }))
        ];
        DataSourceRegistry._save(data);
    }

    /**
     * Get full state for a school year.
     * @param {string} schoolYear
     * @returns {object}
     */
    static getYear(schoolYear) {
        return DataSourceRegistry._load()[schoolYear] || {};
    }

    /**
     * Clear a source entry (call when data is deleted).
     * @param {string} source
     * @param {string} schoolYear
     */
    static clear(source, schoolYear) {
        const data = DataSourceRegistry._load();
        if (data[schoolYear]) {
            delete data[schoolYear][source];
            data[schoolYear].warnings = (data[schoolYear].warnings || []).filter(
                (w) => w.source !== source
            );
        }
        DataSourceRegistry._save(data);
    }
}
```

- [ ] **Step 2: Verify in DevTools**

```js
DataSourceRegistry.update('students', '2024-2025', { count: 342, sections: ['1BACSH-1', '2BACL-3'] }, []);
const s = DataSourceRegistry.getYear('2024-2025');
console.assert(s.students.count === 342, 'count wrong');
console.assert(s.students.sections.length === 2, 'sections wrong');
console.assert(Array.isArray(s.warnings), 'warnings not array');
console.log('DataSourceRegistry: all assertions passed');
```

- [ ] **Step 3: Commit**

```bash
git add js/data-source-registry.js
git commit -m "feat: add DataSourceRegistry standalone class (js/data-source-registry.js)"
```

---

## Task 5: Create `js/cross-source-validator.js`

**Files:**
- Create: `js/cross-source-validator.js`

Depends on `NameResolver` (must be loaded first). Communicates with DB via `window.api`.

- [ ] **Step 1: Create the file**

```js
// js/cross-source-validator.js
// Depends on: js/name-resolver.js (must load first)
// Future: will be imported by js/master-data.js

'use strict';

class CrossSourceValidator {
    /**
     * @param {string} schoolYear
     */
    constructor(schoolYear) {
        this._year = schoolYear;
    }

    /**
     * Run consistency checks after an import completes.
     * Never throws — returns warnings list instead.
     * @param {'students'|'grades'|'absences'|'fet'|'agent_xml'|'status'} importType
     * @param {object} importedData
     * @returns {Promise<{ valid: boolean, warnings: Array }>}
     */
    async validateAfterImport(importType, importedData) {
        const warnings = [];
        try {
            if (importType === 'grades')    await this._validateGrades(importedData, warnings);
            if (importType === 'absences')  await this._validateAbsences(importedData, warnings);
            if (importType === 'fet')       await this._validateFet(importedData, warnings);
            if (importType === 'agent_xml') await this._validateAgentXml(importedData, warnings);
        } catch (_) { /* validation errors should never crash the import */ }
        return { valid: warnings.filter((w) => w.level === 'error').length === 0, warnings };
    }

    // ── internal: build a NameResolver with DB teachers + timetable teachers ──
    async _buildResolver() {
        const dbTeachers = await window.api.teachers.getAll(this._year).catch(() => []);
        let timetableTeachers = [];
        try {
            const td = JSON.parse(localStorage.getItem('timetableData') || '{}');
            timetableTeachers = (td.teachers || []).map((name) => ({ id: null, name }));
        } catch (_) { /* ignore */ }
        return new NameResolver([...dbTeachers, ...timetableTeachers]);
    }

    async _validateGrades(data, warnings) {
        // data: { sections: string[], teacherNames: string[], levels: {section, level}[] }
        const students = await window.api.students.getAll(this._year).catch(() => []);
        const knownSections = new Set((students || []).map((s) => String(s.section || '').trim()));

        const unknownSections = (data.sections || []).filter((sec) => sec && !knownSections.has(sec));
        if (unknownSections.length) {
            warnings.push({
                level: 'error',
                code: 'SECTION_NOT_FOUND',
                message: `${unknownSections.length} قسم في ملف النقط غير موجود في لائحة التلاميذ: ${unknownSections.slice(0, 3).join('، ')}${unknownSections.length > 3 ? '...' : ''}`,
                count: unknownSections.length
            });
        }

        const resolver = await this._buildResolver();
        for (const name of (data.teacherNames || [])) {
            if (!name) continue;
            const result = await resolver.resolveAsync(name, this._year);
            if (result.needsReview || result.matchType === 'unmatched') {
                warnings.push({
                    level: 'warning',
                    code: 'TEACHER_IN_GRADES_UNRESOLVED',
                    message: `أستاذ "${name}" في ملف النقط غير معروف`,
                    count: 1
                });
            }
        }

        for (const { section, level } of (data.levels || [])) {
            if (!section || !level) continue;
            const derivedLevel = section.match(/^(\d[A-Za-z]+)/)?.[1] || '';
            const normLevel   = NameResolver.normalizeName(level);
            const normDerived = NameResolver.normalizeName(derivedLevel);
            if (normDerived && normLevel && !normDerived.includes(normLevel) && !normLevel.includes(normDerived)) {
                warnings.push({
                    level: 'warning',
                    code: 'LEVEL_SECTION_MISMATCH',
                    message: `المستوى "${level}" في الملف قد لا يتطابق مع القسم "${section}"`,
                    count: 1
                });
            }
        }
    }

    async _validateAbsences(data, warnings) {
        // data: { studentCodes: string[], teacherNames: string[] }
        const students = await window.api.students.getAll(this._year).catch(() => []);
        const knownCodes = new Set((students || []).map((s) => String(s.code || '').trim()));

        const unknownCodes = (data.studentCodes || []).filter((c) => c && !knownCodes.has(c));
        if (unknownCodes.length) {
            warnings.push({
                level: 'error',
                code: 'STUDENT_CODE_NOT_FOUND',
                message: `${unknownCodes.length} رمز مسار في ملف الغياب غير موجود في لائحة التلاميذ`,
                count: unknownCodes.length
            });
        }

        const resolver = await this._buildResolver();
        for (const name of (data.teacherNames || [])) {
            if (!name) continue;
            const result = await resolver.resolveAsync(name, this._year);
            if (result.needsReview || result.matchType === 'unmatched') {
                warnings.push({
                    level: 'warning',
                    code: 'TEACHER_IN_ABSENCES_UNRESOLVED',
                    message: `اسم الأستاذ "${name}" غير معروف في سجل الغياب`,
                    count: 1
                });
            }
        }
    }

    async _validateFet(data, warnings) {
        // data: { teacherNames: string[] }
        const resolver = await this._buildResolver();
        const unresolved = [];
        for (const name of (data.teacherNames || [])) {
            if (!name) continue;
            const result = await resolver.resolveAsync(name, this._year);
            if (result.needsReview || result.matchType === 'unmatched') unresolved.push(name);
        }
        if (unresolved.length) {
            warnings.push({
                level: 'warning',
                code: 'TEACHER_FET_UNRESOLVED',
                message: `${unresolved.length} أستاذ في FET لم يُربط بملف الوزارة: ${unresolved.slice(0, 3).join('، ')}${unresolved.length > 3 ? '...' : ''}`,
                count: unresolved.length,
                names: unresolved
            });
        }
    }

    async _validateAgentXml(data, warnings) {
        // data: { pprList: string[] }
        const pprSet = new Set();
        const duplicates = [];
        for (const ppr of (data.pprList || [])) {
            if (!ppr) continue;
            if (pprSet.has(ppr)) duplicates.push(ppr);
            else pprSet.add(ppr);
        }
        if (duplicates.length) {
            warnings.push({
                level: 'warning',
                code: 'DUPLICATE_PPR',
                message: `${duplicates.length} رقم PPR مكرر في ملف الوزارة`,
                count: duplicates.length
            });
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add js/cross-source-validator.js
git commit -m "feat: add CrossSourceValidator standalone class (js/cross-source-validator.js)"
```

---

## Task 6: Load new scripts in `settings-imports.html`

**Files:**
- Modify: `settings-imports.html`

- [ ] **Step 1: Add the three script tags before `js/pages/settings-imports.js`**

Find these two lines at the bottom of `settings-imports.html`:
```html
        <script src="js/backup.js" defer></script>
        <script src="js/pages/settings-imports.js" defer></script>
```

Replace with:
```html
        <script src="js/backup.js" defer></script>
        <script src="js/name-resolver.js" defer></script>
        <script src="js/data-source-registry.js" defer></script>
        <script src="js/cross-source-validator.js" defer></script>
        <script src="js/pages/settings-imports.js" defer></script>
```

- [ ] **Step 2: Add the Import Status Panel HTML above `<!-- Import Center -->`**

Find the comment `<!-- Import Center -->` and insert before it:

```html
<!-- Import Status Panel -->
<div class="students-results" id="import-status-panel-section">
    <h3>
        <i class="fas fa-link"></i> حالة ربط البيانات
        <span class="me-1.5 text-[13px] font-normal opacity-70" id="status-panel-year-label"></span>
    </h3>
    <div class="import-status-panel" id="import-status-panel">
        <div class="import-status-row status-pending" data-source="students">
            <span class="import-status-icon"><i class="fas fa-clock"></i></span>
            <span class="import-status-label">التلاميذ</span>
            <span class="import-status-detail">لم يُستورد بعد</span>
            <span class="import-status-action"></span>
        </div>
        <div class="import-status-row status-pending" data-source="agent_xml">
            <span class="import-status-icon"><i class="fas fa-clock"></i></span>
            <span class="import-status-label">ملف الوزارة</span>
            <span class="import-status-detail">لم يُستورد بعد</span>
            <span class="import-status-action"></span>
        </div>
        <div class="import-status-row status-pending" data-source="fet">
            <span class="import-status-icon"><i class="fas fa-clock"></i></span>
            <span class="import-status-label">FET (جدول)</span>
            <span class="import-status-detail">لم يُستورد بعد</span>
            <span class="import-status-action"></span>
        </div>
        <div class="import-status-row status-pending" data-source="grades">
            <span class="import-status-icon"><i class="fas fa-clock"></i></span>
            <span class="import-status-label">النقط</span>
            <span class="import-status-detail">لم يُستورد بعد</span>
            <span class="import-status-action"></span>
        </div>
        <div class="import-status-row status-pending" data-source="absences">
            <span class="import-status-icon"><i class="fas fa-clock"></i></span>
            <span class="import-status-label">الغياب</span>
            <span class="import-status-detail">لم يُستورد بعد</span>
            <span class="import-status-action"></span>
        </div>
        <div class="import-status-row" data-source="status">
            <span class="import-status-icon"><i class="fas fa-minus-circle"></i></span>
            <span class="import-status-label">الوضعيات</span>
            <span class="import-status-detail">اختياري</span>
            <span class="import-status-action"></span>
        </div>
    </div>
    <p class="mt-2 text-[0.8rem] text-[var(--color-text-muted)]">
        <i class="fas fa-info-circle"></i>
        الترتيب الموصى به: التلاميذ ← ملف الوزارة ← FET ← النقط ← الغياب
    </p>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add settings-imports.html
git commit -m "feat: load name-resolver, data-source-registry, cross-source-validator scripts + add Status Panel HTML"
```

---

## Task 7: CSS — Import Status Panel styles

**Files:**
- Modify: `css/tailwind-input.css`

- [ ] **Step 1: Add styles inside `@layer components {}`**

At the end of the `@layer components {}` block, add:

```css
/* ============================
   Import Status Panel
   ============================ */
.import-status-panel {
    display: grid;
    gap: 0.5rem;
}

.import-status-row {
    display: grid;
    grid-template-columns: 1.5rem 8rem 1fr auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-sm);
    background: var(--color-bg-card);
    border: 1px solid var(--color-border-subtle);
    font-size: 0.875rem;
}

.import-status-row.status-ok    { border-color: var(--color-success-border); background: var(--color-success-surface); }
.import-status-row.status-warn  { border-color: var(--color-warning-border); background: var(--color-warning-surface); }
.import-status-row.status-error { border-color: var(--color-danger-border);  background: var(--color-danger-surface);  }
.import-status-row.status-pending { opacity: 0.6; }

.import-status-icon  { font-size: 1rem; text-align: center; }
.import-status-label { font-weight: 600; color: var(--color-text-main); }
.import-status-detail {
    color: var(--color-text-muted);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.import-status-action { flex-shrink: 0; }
```

- [ ] **Step 2: Rebuild CSS**

```bash
npm run css:build
```

Expected: no errors, `css/tailwind-output.css` updated.

- [ ] **Step 3: Commit**

```bash
git add css/tailwind-input.css css/tailwind-output.css
git commit -m "feat: add import-status-panel CSS component"
```

---

## Task 8: Hook validator + registry into `settings-imports.js`

**Files:**
- Modify: `js/pages/settings-imports.js`

- [ ] **Step 1: Hook `importStudents()` — registry update**

Find `return { importedCount: deduped.length, departedStudents };` inside `importStudents()` and replace with:

```js
    const sections = [...new Set(deduped.map((s) => s.section).filter(Boolean))];
    DataSourceRegistry.update('students', schoolYear, { count: deduped.length, sections }, []);
    return { importedCount: deduped.length, departedStudents };
```

- [ ] **Step 2: Hook `importGrades()` — validator + registry**

Find `const res = await window.api.grades.saveBulk(deduped);` in `importGrades()`.
After the guard `if (!res || res.success === false) throw new Error(...)`, add:

```js
    const gradeSections  = [...new Set(grades.map((g) => g.section).filter(Boolean))];
    const gradeTeachers  = [...new Set(grades.map((g) => g._teacher).filter(Boolean))];
    const gradeLevels    = grades.filter((g) => g._level && g.section).map((g) => ({ section: g.section, level: g._level }));
    const gradeSubjects  = [...new Set(grades.map((g) => g.subject).filter(Boolean))];
    const gradeValidator = new CrossSourceValidator(schoolYear);
    const { warnings: gradeWarnings } = await gradeValidator.validateAfterImport('grades', {
        sections: gradeSections, teacherNames: gradeTeachers, levels: gradeLevels
    });
    DataSourceRegistry.update('grades', schoolYear, { count: deduped.length, subjects: gradeSubjects }, gradeWarnings);
```

- [ ] **Step 3: Hook `importAbsences()` — validator + registry**

Find the final `return` in `importAbsences()` and before it add:

```js
    const absCodes      = [...new Set(absences.map((a) => a.student_code).filter(Boolean))];
    const absTeachers   = [...new Set(absences.map((a) => a.teacher_name).filter(Boolean))];
    const absValidator  = new CrossSourceValidator(schoolYear);
    const { warnings: absWarnings } = await absValidator.validateAfterImport('absences', {
        studentCodes: absCodes, teacherNames: absTeachers
    });
    DataSourceRegistry.update('absences', schoolYear, { count: absences.length }, absWarnings);
```

- [ ] **Step 4: Hook `importFetXml()` — validator + registry**

Find the final `return` in `importFetXml()` and before it add:

```js
    const fetNames      = (teachers || []).map((t) => t.name || t.teacherName || '').filter(Boolean);
    const fetValidator  = new CrossSourceValidator(getCurrentSchoolYear());
    const { warnings: fetWarnings } = await fetValidator.validateAfterImport('fet', { teacherNames: fetNames });
    DataSourceRegistry.update('fet', getCurrentSchoolYear(), { teachers: fetNames }, fetWarnings);
```

- [ ] **Step 5: Hook `importAgentXml()` — validator + registry**

Find the final `return` in `importAgentXml()` and before it add:

```js
    const agentPpr      = (teachers || []).map((t) => t.ppr || '').filter(Boolean);
    const agentNames    = (teachers || []).map((t) => t.name || '').filter(Boolean);
    const agentValidator = new CrossSourceValidator(getCurrentSchoolYear());
    const { warnings: agentWarnings } = await agentValidator.validateAfterImport('agent_xml', { pprList: agentPpr });
    DataSourceRegistry.update('agent_xml', getCurrentSchoolYear(), { teachers: agentNames, pprList: agentPpr }, agentWarnings);
```

- [ ] **Step 6: Hook `clearData()` — registry clear**

Inside `clearData(type)`, after each successful delete IPC call add the matching `DataSourceRegistry.clear()`:

```js
// after students delete:   DataSourceRegistry.clear('students', schoolYear);
// after grades delete:     DataSourceRegistry.clear('grades', schoolYear);
// after absences delete:   DataSourceRegistry.clear('absences', schoolYear);
// after timetable delete:  DataSourceRegistry.clear('fet', schoolYear);
// after status clear:      DataSourceRegistry.clear('status', schoolYear);
// after teachers delete:   DataSourceRegistry.clear('agent_xml', schoolYear);
```

- [ ] **Step 7: Add `renderImportStatusPanel()` function**

Add this function near the top of `settings-imports.js` (after the constants block):

```js
function renderImportStatusPanel(schoolYear) {
    const panel   = document.getElementById('import-status-panel');
    const yearLbl = document.getElementById('status-panel-year-label');
    if (!panel) return;
    if (yearLbl) yearLbl.textContent = schoolYear || '';

    const state    = DataSourceRegistry.getYear(schoolYear);
    const warnings = state.warnings || [];

    const SOURCES = [
        { key: 'students',  label: 'التلاميذ',    optional: false },
        { key: 'agent_xml', label: 'ملف الوزارة', optional: false },
        { key: 'fet',       label: 'FET (جدول)', optional: false },
        { key: 'grades',    label: 'النقط',       optional: false },
        { key: 'absences',  label: 'الغياب',      optional: false },
        { key: 'status',    label: 'الوضعيات',   optional: true  }
    ];

    SOURCES.forEach(({ key, optional }) => {
        const row = panel.querySelector(`[data-source="${key}"]`);
        if (!row) return;

        const src      = state[key];
        const srcWarns = warnings.filter((w) => w.source === key);
        const hasError = srcWarns.some((w) => w.level === 'error');
        const hasWarn  = srcWarns.some((w) => w.level === 'warning');

        row.className = 'import-status-row ' + (
            !src?.importedAt ? (optional ? '' : 'status-pending')
            : hasError       ? 'status-error'
            : hasWarn        ? 'status-warn'
            :                  'status-ok'
        );

        const iconEl   = row.querySelector('.import-status-icon');
        const detailEl = row.querySelector('.import-status-detail');
        const actionEl = row.querySelector('.import-status-action');

        if (iconEl) {
            const ic = !src?.importedAt
                ? (optional ? 'fa-minus-circle' : 'fa-clock')
                : hasError  ? 'fa-exclamation-circle'
                : hasWarn   ? 'fa-exclamation-triangle'
                :             'fa-check-circle';
            iconEl.innerHTML = `<i class="fas ${ic}"></i>`;
        }

        if (detailEl) {
            if (!src?.importedAt) {
                detailEl.textContent = optional ? 'اختياري' : 'لم يُستورد بعد';
            } else {
                const parts = [];
                if (src.count    != null)  parts.push(`${src.count.toLocaleString('ar-MA')} سجل`);
                if (src.sections?.length)  parts.push(`${src.sections.length} قسم`);
                if (src.teachers?.length)  parts.push(`${src.teachers.length} أستاذ`);
                if (src.subjects?.length)  parts.push(`${src.subjects.length} مادة`);
                if (srcWarns.length)       parts.push(srcWarns.map((w) => w.message).join(' · '));
                detailEl.textContent = parts.join(' · ') || 'مستورد';
            }
        }

        if (actionEl) {
            actionEl.innerHTML = '';
            if (hasWarn && key === 'fet') {
                const btn = document.createElement('button');
                btn.className = 'btn btn-secondary min-h-0 px-2.5 py-1 text-[12px]';
                btn.type = 'button';
                btn.innerHTML = '<i class="fas fa-link"></i> مراجعة';
                btn.addEventListener('click', () =>
                    document.getElementById('tafwij-matching-panel')?.classList.remove('hidden')
                );
                actionEl.appendChild(btn);
            }
        }
    });
}
```

- [ ] **Step 8: Call `renderImportStatusPanel()` in two places**

1. At end of `loadDataStats()`:
```js
renderImportStatusPanel(getCurrentSchoolYear());
```

2. At end of `handleImport()` success path (after `await loadDataStats()`):
```js
renderImportStatusPanel(getCurrentSchoolYear());
```

- [ ] **Step 9: Manual test**

Run: `npm run start`, go to `settings-imports.html`.

1. Status Panel displays with ⏳ for all non-optional sources
2. Import a students file → التلاميذ row turns ✅ with count + sections
3. Import a grades file with a mis-spelled section → النقط row turns 🔴 with error message
4. Import FET XML → FET row shows ⚠️ + [مراجعة] button if unresolved teachers
5. Click [مراجعة] → existing `tafwij-matching-panel` opens

- [ ] **Step 10: Commit**

```bash
git add js/pages/settings-imports.js
git commit -m "feat: hook CrossSourceValidator and DataSourceRegistry into import pipeline"
```

---

## Task 9: Smoke test + lint + final push

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: 0 errors.

- [ ] **Step 2: Run smoke test**

```bash
npm run test:smoke
```

Expected: all checks pass.

- [ ] **Step 3: Final push**

```bash
git push origin main
```

---

## Path to Master Data Architecture (future reference)

When ready to migrate to full Master Data, the steps will be:

```
1. Create js/master-data.js
   — imports NameResolver, DataSourceRegistry, CrossSourceValidator
   — adds MasterData class that orchestrates all three

2. Create js/importers/ directory
   — split settings-imports.js into per-source modules
   — each module uses MasterData instead of inline logic

3. Update HTML pages
   — replace settings-imports.js with importers/*.js + master-data.js
```

Zero rewrites of the three files built in this plan. They become the foundation.
