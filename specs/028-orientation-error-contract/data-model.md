# Data Model: Orientation Error Contract

**Feature**: `028-orientation-error-contract`  
**Date**: 2026-07-17  
**Note**: No SQLite schema changes. This model describes the **in-memory / on-the-wire error vocabulary**, not school domain tables.

---

## 1. ErrorCodeDefinition

Stable entry in the vocabulary.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | yes | Unique identifier (SCREAMING_SNAKE) |
| `message` | string | yes | Default safe Arabic user message |
| `severity` | enum | yes | `info` \| `warning` \| `error` |
| `retryable` | boolean | yes | Whether user/system retry is appropriate |
| `classification` | enum | yes | `validation` \| `domain` \| `infrastructure` \| `transport` \| `display` |
| `section` | enum | yes | `shared` \| `pageOnly` |
| `expectsDetails` | boolean | yes | Whether row/count details are normally attached |
| `aliases` | string[] | no | Deprecated former codes that map here (empty at launch unless needed) |

### Validation rules

- `code` unique across **both** sections (no shared/page-only collision).
- `message` must be Arabic-safe product text (no SQL/stack/path patterns).
- Unknown runtime codes never invent a new definition; they map to **UnknownFallback**.

---

## 2. Shared section inventory (compatibility-locked)

| Code | severity | retryable | classification | expectsDetails | Default message (canonical = main IPC baseline) |
|------|----------|-----------|----------------|----------------|--------------------------------------------------|
| `INVALID_SCHOOL_YEAR` | warning | false | validation | optional | الموسم الدراسي غير صالح. الصيغة المتوقعة: YYYY/YYYY. |
| `INVALID_RECORD` | warning | false | validation | optional | لا توجد صفوف صالحة للاستيراد. |
| `DATABASE_ERROR` | error | true | infrastructure | optional | تعذر حفظ أو قراءة سجلات التوجيه من قاعدة البيانات. |
| `IMPORT_ROLLBACK` | error | true | domain | optional | تم التراجع عن عملية الاستيراد بسبب خطأ. لم تُطبَّق تغييرات هذه الدفعة. |
| `LIST_LOAD_ERROR` | error | true | infrastructure | optional | تعذر تحميل قائمة التوجيه. |
| `STATS_LOAD_ERROR` | error | true | infrastructure | optional | تعذر تحميل إحصائيات التوجيه. |
| `SYNC_ERROR` | error | true | infrastructure | optional | تعذر تسجيل تغييرات التوجيه للمزامنة. لم تُحفظ الدفعة. |
| `SCHOOL_YEAR_MISMATCH` | warning | false | validation | optional | سنة أحد الصفوف لا تطابق سنة الطلب. |

**Locked**: These codes MUST remain recognized (FR-013). Renames require explicit alias + tests.

**Semantic notes**:

- `INVALID_RECORD` at top-level = no valid rows for the operation (batch).
- `IMPORT_ROLLBACK` = transactional unit of work did not permanently apply for **that batch**.
- `SCHOOL_YEAR_MISMATCH` also used for **file-level hard-stop** on import (same code, presentation context may clarify file vs row); per-row year issues primarily use skip `reason: year_mismatch` on success paths.

---

## 3. Page-only section inventory

| Code | severity | retryable | classification | Primary consumer | Default message source |
|------|----------|-----------|----------------|------------------|------------------------|
| `FILE_READ_ERROR` | error | true | transport | import | settings-imports |
| `EMPTY_FILE` | warning | false | validation | import | settings-imports |
| `UNSUPPORTED_FORMAT` | warning | false | validation | import | settings-imports |
| `INVALID_FILE_STRUCTURE` | warning | false | validation | import | settings-imports |
| `MISSING_STUDENT_CODE` | warning | false | validation | import | settings-imports |
| `MISSING_ORIGIN_STREAM` | warning | false | validation | import | settings-imports |
| `INVALID_NUMERIC_VALUE` | warning | false | validation | import | settings-imports |
| `YEAR_RESPONSE_MISMATCH` | warning | true | display | display | students-orientation / import if present |
| `STALE_RESPONSE` | info | true | display | display | students-orientation |
| `CHART_RENDER_ERROR` | warning | true | display | display | students-orientation |

**Service boundary MUST NOT require these codes** to build IPC responses.

**UX rules tied to codes**:

- `STALE_RESPONSE` → silent discard (no toast/status spam).
- `YEAR_RESPONSE_MISMATCH` → visible non-blocking notice; not empty success; not full-page wipe.
- `CHART_RENDER_ERROR` → non-destructive; tables/KPIs remain.

---

## 4. UnknownFallback

| Field | Value |
|-------|--------|
| Effective code | `INTERNAL_ERROR` or contract key `UNKNOWN` mapped to safe infrastructure |
| message | Safe Arabic generic (align with existing product: e.g. حدث خطأ داخلي / orientation-safe equivalent) |
| severity | `error` |
| retryable | `true` |
| classification | `infrastructure` |
| section | `unknown` |

User-primary text never equals the raw unknown code string.

---

## 5. NormalizedFailure (wire + page)

Flat object after `normalize` (failure path):

| Field | Type | Source |
|-------|------|--------|
| `success` | `false` | always |
| `code` | string | inferred / catalog |
| `error` | string | safe message |
| `message` | string | same as `error` if omitted on input |
| `details` | object \| null | after `safeDetails` |
| `retryable` | boolean | catalog default unless explicit bool on rich input |
| `severity` | enum | catalog |
| `classification` | string | catalog |
| `section` | string | catalog / unknown |

### Lean input (auth / generic IPC)

`{ success: false, code, error }` → fill `message`, `retryable`, `severity`, `classification`, `details: null`.

### Rich input (orientation domain)

`{ success: false, code, error, message?, details?, retryable? }` → preserve known fields; fill gaps from catalog; filter details.

### Success input

`{ success: true, ... }` → not a failure; normalize MUST NOT convert success into failure. Consumers use `success` first.

---

## 6. SafeDetailPayload

Allowlisted keys only (see research R5). Relationships:

- Optional child of `NormalizedFailure.details`.
- Skip-reason lists bounded (default 40, hard max 80).
- Never contains full file, tokens, SQL, stacks, unbounded student PII arrays.

---

## 7. ImportRunOutcome (page-level, not persisted)

Logical aggregation for multi-batch import (FR-011a):

| Field | Description |
|-------|-------------|
| `committedSummary` | Counts from successful batches (inserted/updated/unchanged/skipped/duplicates) |
| `failedBatch` | Optional `NormalizedFailure` for the batch that failed |
| `overall` | `success` \| `partial` \| `failed` — `partial` when committedSummary non-empty and failedBatch present |

**State transitions (import run)**:

```text
idle → validating → writing_batches → success
                  ↘ failed_validation (page-only or INVALID_*)
writing_batches → partial (some batches ok + one failed) → idle
writing_batches → failed (first/only batch fails, nothing committed)
```

Never transition to “success” if failed batch claimed permanent save incorrectly.

---

## 8. DisplayLoadState (page-level, not persisted)

| Field | Description |
|-------|-------------|
| `selectedYear` | Active school year |
| `loadGeneration` | Monotonic token |
| `list` | data \| error \| empty |
| `stats` | data \| error \| independent of list |
| `charts` | ok \| `CHART_RENDER_ERROR` without clearing list/stats |

**Stale**: response generation < current → discard silently.  
**Wrong-year**: response year ≠ selected → consistency failure + visible notice.

---

## 9. Relationships

```text
ErrorCodeDefinition (shared | pageOnly)
        │
        ▼
NormalizedFailure ──details──► SafeDetailPayload
        │
        ├── used by main/ipc/orientation.js (shared section only)
        ├── used by settings-imports.js (shared + page-only import codes)
        └── used by students-orientation.js (shared load codes + page-only display codes)

ImportRunOutcome aggregates batch results + optional NormalizedFailure
DisplayLoadState applies STALE_RESPONSE / YEAR_RESPONSE_MISMATCH rules
```

---

## 10. Out of model scope

- `student_orientation` table columns (unchanged).
- Sync outbox rows (unchanged capture modes).
- Auth lean codes (`UNAUTHENTICATED`, `FORBIDDEN`, …) — live in ipc-helpers; normalize may accept them as lean inputs without redefining auth catalog ownership.
