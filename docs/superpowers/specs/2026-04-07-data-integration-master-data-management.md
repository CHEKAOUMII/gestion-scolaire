# Data Integration / Master Data Management — Design Spec

**Date:** 2026-04-07  
**Status:** Approved  
**Related Plan:** `docs/superpowers/plans/2026-03-31-message-system.md`

---

## Problem Statement

The application imports data from 6 independent sources:

| Source | Format | Key Entities |
|--------|--------|--------------|
| لائحة التلاميذ | Excel (.xlsx/.xls/.csv) | students, sections |
| النقط | Excel (multi-file) | grades, subjects, sections |
| الغياب | Excel (multi-file) | absences, student codes |
| FET (tafwij) | XML (`_teachers.xml`) | teachers, timetable |
| ملف الوزارة | XML (agent) | teachers, PPR |
| الوضعيات الدراسية | Excel | student statuses |

Today these sources operate in isolation. Three cascading problems result:

1. **أسماء الأقسام متعارضة** — "2BACSH-7" في ملف النقط ≠ "2BAC-SH7" في لائحة التلاميذ → روابط مكسورة
2. **أسماء الأساتذة متعارضة** — "بنعلي محمد" (tafwij) ≠ "BENALI Mohamed" (ملف الوزارة) ≠ "م. بنعلي" (Excel) → إحصائيات ضائعة
3. **ترتيب الاستيراد غير موجَّه** — المستخدم يستورد النقط قبل التلاميذ فلا يعرف لماذا الروابط مكسورة

---

## Solution Overview

Three layers built in dependency order:

```
Layer 3 — Import Status Panel (UI)       settings-imports.html
           DataSourceRegistry             js/utils.js
              ↑ reads
Layer 2 — Cross-source Validator          js/utils.js
              ↑ uses
Layer 1 — NameResolver ← built first     js/utils.js
              ↑ persists to
DB        — name_aliases (new migration)  main/db/migrations.js
            tafwij_teacher_aliases (existing, unchanged)
```

**Constraint:** `settings-imports.js` (3346 lines) is NOT restructured. The three layers are added as new classes in `js/utils.js` and called from targeted insertion points in the existing import functions.

**UI feedback:** All user-facing messages use the existing Message System (`showConfirm`, `showToast`, `showToast.loading`) — no new dialog patterns.

---

## Layer 1: NameResolver

### Purpose
Resolve a raw name from any source to a canonical entity ID + confidence score.

### Resolution Pipeline (first match wins)

```
Step 1 — Direct match after normalization
         normalize(input) === normalize(candidate)
         → confidence: 1.0, matchType: 'exact'

Step 2 — Name/family order swap
         "محمد بنعلي" ↔ "بنعلي محمد"
         → confidence: 0.97, matchType: 'swapped'

Step 3 — Strip titles and abbreviations
         "م." "الأستاذ" "Pr." "Mme" "M." removed, then re-run steps 1-2
         → confidence: 0.93, matchType: 'stripped'

Step 4 — Arabic↔Latin transliteration
         normalize Arabic → Latin skeleton, compare
         "بنعلي" → "bnʕly" ≈ "benali"
         → confidence: 0.88, matchType: 'transliterated'

Step 5 — Fuzzy (Levenshtein distance)
         threshold: 85% similarity
         May return multiple candidates ranked by score
         → confidence: 0.85–0.95, matchType: 'fuzzy'

Step 6 — Stored aliases lookup
         Query name_aliases WHERE alias_normalized = normalize(input)
         Also query tafwij_teacher_aliases (read-only, backward compat)
         → confidence: 1.0, matchType: 'alias'
```

### Return value

```js
// Single confident match
{ candidateId: 42, confidence: 0.93, matchType: 'stripped', normalizedName: 'بنعلي محمد' }

// Multiple candidates (fuzzy, needs user review)
{ candidates: [
    { candidateId: 42, confidence: 0.91, name: 'بنعلي محمد' },
    { candidateId: 17, confidence: 0.87, name: 'بنعلي عبد المالك' }
  ], matchType: 'fuzzy', needsReview: true }

// No match
{ candidateId: null, confidence: 0, matchType: 'unmatched', needsReview: true }
```

### Normalization function (`normalizeName`)

```js
// Applied before every comparison step:
// 1. lowercase
// 2. remove Arabic diacritics (tashkeel: \u0610-\u061A, \u064B-\u065F)
// 3. normalize Arabic letters: أإآ→ا, ة→ه, ى→ي
// 4. remove punctuation except spaces
// 5. collapse multiple spaces
// 6. trim
```

### API (class in `js/utils.js`)

```js
class NameResolver {
    constructor(candidates)          // candidates: [{ id, name }]
    resolve(rawName)                 // → resolution object (sync, pure)
    resolveAsync(rawName, schoolYear) // → same + checks DB aliases via window.api
    static normalizeName(str)        // exported utility
}
```

### DB: `name_aliases` (new migration)

```sql
CREATE TABLE IF NOT EXISTS name_aliases (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type       TEXT NOT NULL,        -- 'teacher' | 'class'
    canonical_id      INTEGER NOT NULL,     -- id in teachers or classes table
    alias_text        TEXT NOT NULL,        -- raw name from source
    alias_normalized  TEXT NOT NULL,        -- after normalizeName()
    source            TEXT NOT NULL,        -- 'tafwij' | 'agent_xml' | 'manual'
    school_year       TEXT,                 -- NULL = applies to all years
    confidence        REAL DEFAULT 1.0,
    created_at        TEXT DEFAULT (datetime('now')),
    UNIQUE(entity_type, alias_normalized, school_year)
);
CREATE INDEX IF NOT EXISTS idx_name_aliases_lookup
    ON name_aliases(entity_type, alias_normalized, school_year);
```

`tafwij_teacher_aliases` is **not modified** — NameResolver reads from both tables.

### IPC channels (new, added to `main/ipc/staff.js`)

```
staff:saveNameAlias    — save a manual match { entity_type, canonical_id, alias_text, source, school_year }
staff:getNameAliases   — get all aliases for entity_type + school_year
staff:deleteNameAlias  — remove a stored alias by id
```

---

## Layer 2: Cross-source Validator

### Purpose
After each import, detect cross-source inconsistencies and return a warnings list. Never blocks the import — only informs.

### Validation rules by import type

| Import | Check | Warning if |
|--------|-------|-----------|
| **النقط** | Every section name in grades file exists in `students` DB for this year | Section not found → `SECTION_NOT_FOUND` "قسم X غير موجود في لائحة التلاميذ" |
| **النقط** | Teacher name extracted from file metadata resolves via NameResolver to a `teachers` DB record | Unresolved → `TEACHER_IN_GRADES_UNRESOLVED` "أستاذ X في ملف النقط غير معروف" |
| **النقط** | Level extracted from file metadata matches the level implied by the section in `students` DB | Mismatch → `LEVEL_SECTION_MISMATCH` "المستوى في الملف لا يتطابق مع القسم X" |
| **الغياب** | Every student code in absences file exists in `students` DB | Code not found → `STUDENT_CODE_NOT_FOUND` "رمز مسار X غير موجود" |
| **FET XML** | Every teacher name resolves via NameResolver to a `teachers` DB record | `needsReview: true` → `TEACHER_FET_UNRESOLVED` "أستاذ Y لم يتم ربطه بملف الوزارة" |
| **agent XML** | No PPR conflict across years; teacher count matches expectation | Duplicate PPR → `DUPLICATE_PPR` "رقم PPR Z موجود لسنة مختلفة" |
| **الغياب** after FET | Absent teacher name resolves to a known teacher | Unresolved → `TEACHER_IN_ABSENCES_UNRESOLVED` "اسم الأستاذ غير معروف في سجل الغياب" |

**ملاحظة:** ملف النقط يحتوي على metadata ضمنية (أستاذ، قسم، مادة، مستوى) يستخرجها `importGrades()` حالياً عبر `findTeacherNameFromMeta()` و `findMetaValue()`. هذه البيانات لا تُحفظ كـ master data — يستغلها الـ Validator فقط للتحقق الفوري أثناء الاستيراد. المواد المستخرجة تُضاف إلى `DataSourceRegistry.grades.subjects` للعرض في Status Panel.

### Return shape

```js
{
  valid: false,
  warnings: [
    { level: 'error',   code: 'SECTION_NOT_FOUND', message: 'قسم "2BACL-3" غير موجود في لائحة التلاميذ', count: 14 },
    { level: 'warning', code: 'TEACHER_UNRESOLVED', message: 'أستاذ "م. العلوي" لم يُربط بعد', count: 3 }
  ]
}
```

`level: 'error'` — cross-source link is broken (data will be orphaned)  
`level: 'warning'` — resolvable, user action recommended

### API

```js
class CrossSourceValidator {
    constructor(schoolYear)
    async validateAfterImport(importType, importedData)  // → { valid, warnings }
}
```

Called once at the end of each `importXxx()` function in `settings-imports.js`. Results are passed to `DataSourceRegistry.update()` and displayed in the Status Panel.

---

## Layer 3: DataSourceRegistry + Import Status Panel

### DataSourceRegistry (js/utils.js)

Persists import state per school year in `localStorage` under key `dataSourceRegistry`.

```js
// Shape
{
  "2024-2025": {
    students:  { importedAt: "2026-01-10T09:00Z", count: 342, sections: ["1BACSH-1", ...] },
    grades:    { importedAt: "2026-01-12T14:30Z", count: 5820, subjects: ["الرياضيات", ...] },
    absences:  { importedAt: "2026-01-15T10:00Z", count: 1240 },
    fet:       { importedAt: "2026-01-10T11:00Z", teachers: ["بنعلي محمد", ...] },
    agent_xml: { importedAt: "2026-01-10T11:30Z", teachers: ["BENALI Mohamed", ...], pprList: [...] },
    status:    { importedAt: null, count: 0 },
    warnings:  [ ...last validator output ]
  }
}
```

### Recommended import order (displayed in Status Panel)

```
1. لائحة التلاميذ  ← defines sections and student codes
2. ملف الوزارة     ← defines canonical teacher names + PPR
3. FET XML         ← links timetable teachers to canonical teachers
4. النقط           ← requires sections from step 1
5. الغياب          ← requires student codes from step 1
6. الوضعيات        ← optional, any time
```

### Import Status Panel (UI — settings-imports.html)

New section inserted **above** the existing "مركز الاستيراد" section:

```
┌─────────────────────────────────────────────────────────┐
│  حالة ربط البيانات — 2024-2025                         │
├──────────────┬─────────────────────────────────────────┤
│ ✅ التلاميذ  │ 342 تلميذ · 12 قسم · منذ 10 يناير     │
│ ✅ الوزارة  │ 31 أستاذ                               │
│ ⚠️ FET      │ 28 أستاذ · 3 لم يُربطوا → [مراجعة]    │
│ ⚠️ النقط    │ قسم "2BACL-3" غير معروف (14 نقطة)     │
│ ⏳ الغياب   │ لم يُستورد بعد                         │
│ — الوضعيات │ غير مطلوب                              │
└──────────────┴─────────────────────────────────────────┘
```

- **✅ green** — imported, no warnings
- **⚠️ amber** — imported with resolvable warnings
- **🔴 red** — imported with broken links (cross-source errors)
- **⏳ grey** — not yet imported
- **[مراجعة]** button opens existing `tafwij-matching-panel` (reused) or new `name-aliases-panel` for agent_xml conflicts

---

## What is NOT changed

- `settings-imports.js` parse and save logic — untouched
- `tafwij_teacher_aliases` table and its IPC channels — untouched
- `tafwij-matching-panel` HTML/JS — reused, not replaced
- `FilterManager` — NameResolver reads from the same `window.api.teachers.getAll()` source; no overlap
- Main process import handlers (`students.addBulk`, `grades.saveBulk`, etc.) — untouched

---

## Message System Integration

All user-facing messages in the new layers use the existing Message System:

| Situation | API used |
|-----------|---------|
| Saving a manual name alias | `showToast.loading()` → `handle.success()` / `handle.error()` |
| Validator finds broken links | Warning banner (existing `.validation-message.warning` pattern) |
| Unresolvable teacher name needs review | `showConfirm()` offer to open matching panel |
| Status Panel loads | No dialog — silent read from localStorage |

---

## Files to Create / Modify

| Action | File | What changes |
|--------|------|-------------|
| **New migration** | `main/db/migrations.js` | Add `name_aliases` table + index |
| **New IPC handlers** | `main/ipc/staff.js` | Add `saveNameAlias`, `getNameAliases`, `deleteNameAlias` |
| **Expose** | `preload.js` | Add `window.api.staff.saveNameAlias` etc. |
| **New classes** | `js/utils.js` | `NameResolver`, `CrossSourceValidator`, `DataSourceRegistry` |
| **Modify** | `js/pages/settings-imports.js` | Call validator at end of each `importXxx()`; call `DataSourceRegistry.update()` |
| **Modify** | `settings-imports.html` | Add Status Panel section above Import Center |
| **Add CSS** | `css/tailwind-input.css` | Status Panel styles (status icons, grid) |

---

## Timetable Data (localStorage) — Decision

Timetable data is stored in `localStorage` under `timetableData` (not in SQLite). This is intentional and **not changed in this spec**.

However, `NameResolver` must be aware of both teacher sources to be useful. The constructor accepts a merged candidates list:

```js
const teachersFromDB = await window.api.teachers.getAll(schoolYear);
const timetableData = JSON.parse(localStorage.getItem('timetableData') || '{}');
const teachersFromTimetable = (timetableData.teachers || []).map((name) => ({ id: null, name }));

const resolver = new NameResolver([...teachersFromDB, ...teachersFromTimetable]);
```

- Teachers resolved to a DB record (`id !== null`) → full linking available
- Teachers resolved only from timetable (`id: null`) → partial match, flagged as `source: 'timetable_only'`

**Migrating timetable data to SQLite is explicitly out of scope** — it is a separate architectural project touching all timetable pages, IPC channels, and the DB schema.

---

## Out of Scope

- Class name conflict resolution (sections) — NameResolver targets teachers only in v1; sections use exact normalization only
- Automatic import ordering enforcement — the panel recommends, does not block
- Migration of existing `tafwij_teacher_aliases` data into `name_aliases` — both coexist
- Migration of timetable data from `localStorage` to SQLite — separate project
- Server-side / main-process validation — all validation is renderer-side at import time
