# Research: 028-orientation-error-contract

**Date**: 2026-07-17  
**Purpose**: Resolve design choices for the orientation hybrid error vocabulary. No open NEEDS CLARIFICATION items remain (spec clarifications session closed).

---

## R1 — Module shape and dual-export

### Decision

Implement `js/shared/errors/orientation-error-contract.js` as a **dependency-free** UMD/IIFE dual-export module, copying the exact runtime pattern of `js/shared/gender.js`:

- `module.exports = api` when CommonJS is available (main process + Node tests).
- Browser global: `root.OrientationErrorContract = api` (and optional convenience aliases only if pages need them).
- Factory body: pure data + pure functions only (no `electron`, `fs`, `better-sqlite3`, DOM, `showToast`).

### Rationale

- Spec FR-001 requires one vocabulary for main IPC and both pages.
- Project has no bundler; deferred script tags must define globals before page scripts.
- Main already can `require` paths under `js/shared/*` (same pattern as other dual modules).

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Main-only module + duplicate renderer copy | Reintroduces drift |
| ESM-only package | App is CommonJS + script tags |
| Nested `main/errors` + `js/errors` sync by hand | Two sources of truth |

---

## R2 — Shared vs page-only section membership

### Decision

**One module, two sections** (clarification Q1):

| Section | Codes |
|---------|--------|
| **Shared** (IPC + pages) | `INVALID_SCHOOL_YEAR`, `INVALID_RECORD`, `DATABASE_ERROR`, `IMPORT_ROLLBACK`, `LIST_LOAD_ERROR`, `STATS_LOAD_ERROR`, `SYNC_ERROR`, `SCHOOL_YEAR_MISMATCH` |
| **Page-only** (UI only) | `FILE_READ_ERROR`, `EMPTY_FILE`, `UNSUPPORTED_FORMAT`, `INVALID_FILE_STRUCTURE`, `MISSING_STUDENT_CODE`, `MISSING_ORIGIN_STREAM`, `INVALID_NUMERIC_VALUE`, `YEAR_RESPONSE_MISMATCH`, `STALE_RESPONSE`, `CHART_RENDER_ERROR` |

Notes:

- **File-level year hard-stop** on import uses code `SCHOOL_YEAR_MISMATCH` from the **shared** section (stable code, default message), even though the check is enforced in the renderer before IPC. Service boundary need not *require* emitting it; inventory shows it is effectively dead at top-level IPC today (`inferOrientationErrorCode` never returns it). Keep in shared for compatibility lock (FR-013) and single meaning.
- **Per-row year issues** continue as success-path skip details (`reason === 'year_mismatch'`), not a top-level shared error code.
- Service boundary **must not import or depend on page-only section** for response building (may ignore that export entirely).

### Rationale

- Spec FR-003 + clarification Q1.
- Keeps locked IPC codes in one place for SC-001/SC-008.
- Avoids promoting display-only codes into IPC responses.

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Local-only page codes | Clarification rejected A |
| Promote all 18 import codes to IPC | Expands attack surface and IPC noise |

---

## R3 — Canonical default Arabic messages (catalog drift)

### Decision

For **shared** codes, prefer **main/ipc/orientation.js** current messages as vocabulary defaults (they are the production security-boundary copy). Exceptions / reconciliations:

| Code | Default source | Notes |
|------|----------------|-------|
| `INVALID_SCHOOL_YEAR` | Main IPC | Drop import’s extra example text from *default*; pages may add example as presentation context (FR-002a) |
| `INVALID_RECORD` | Main IPC (“لا توجد صفوف صالحة للاستيراد.”) | Top-level batch meaning. Import **row-skip** UI may add context (“تم تجاوز السجل”) without a second catalog entry that redefines the code |
| `IMPORT_ROLLBACK` | Main IPC | Retry safety narrative may be appended by import page as presentation context (import’s longer “أعد الاستيراد…” text) |
| `DATABASE_ERROR`, `LIST_*`, `STATS_*`, `SYNC_ERROR`, `SCHOOL_YEAR_MISMATCH` | Main IPC | Align pages to these defaults |

For **page-only** codes, prefer current `settings-imports.js` / `students-orientation.js` messages (sole prior owners).

Severity defaults:

- `info` — reserved; not required for initial codes
- `warning` — validation / year mismatch / empty-file style non-retry or soft issues
- `error` — infrastructure, rollback, load failures, chart failure

Retryability: copy boolean from existing catalogs (main for shared; page for page-only).

### Rationale

- Clarification Q2: core fixed, context allowed.
- Main IPC messages are already sanitized outbound copy.
- Avoids inventing new Arabic without product review.

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Prefer import page wording for all shared codes | Import redefines `INVALID_RECORD` away from batch-level IPC meaning |
| Keep divergent messages permanently | Spec SC-001 fails |

---

## R4 — Normalized failure shape (flat, not nested)

### Decision

`normalize(input)` accepts:

```text
Lean:  { success: false, code, error }
Rich:  { success: false, code, error, message, details, retryable }
Thrown-like: { code, message, details, retryable } or Error-ish
Success: { success: true, ... } → pass-through success flag true, no failure fields forced
```

Emits a **flat superset** for failures:

```js
{
  success: false,
  code: string,           // known or UNKNOWN fallback key
  error: string,          // user-safe Arabic
  message: string,        // same as error if missing
  details: object|null,   // after safeDetails filter
  retryable: boolean,
  severity: 'info'|'warning'|'error',
  classification: string, // validation|domain|infrastructure|transport|display
  section: 'shared'|'pageOnly'|'unknown'
}
```

**Do not** introduce `{ error: { code, message } }`.

Unknown codes → safe infrastructure fallback message (`حدث خطأ داخلي` or orientation-safe equivalent already used in product), `retryable: true` unless catalog says otherwise, never surface raw code as primary user text.

### Rationale

- Spec FR-004/FR-005/FR-006.
- Existing `ensureOk` / `orientationUserMessage` / import IPC handlers read flat fields.

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Nested error object | Breaks verified consumers (source plan §13) |
| Different shapes for main vs renderer | Defeats shared normalize |

---

## R5 — Safe details allowlist

### Decision

`safeDetails(details, { maxSkipReasons })` allowlist keys (extend only deliberately):

- `schoolYear` / `school_year`
- `field` / `fieldName` (value must be allowlisted field names if string)
- `row` / `rowNumber` / `rowCount`
- `duplicateCount` / `duplicatesInFile`
- `accepted` / `rejected` / `skipped` / `inserted` / `updated` / `unchanged` (counts)
- `operation` (`list` | `stats` | `bulkUpsert` | `clearYear` | `delete`)
- `retryHint` (short string, length-capped)
- `reasons` / `details` arrays of skip-reason objects — **capped** (existing MAX_PRE_SKIP_DETAILS = 40; contract default 40, hard max 80)

Strip: full file contents, absolute paths, SQL, stacks, tokens, unbounded student arrays, raw DB driver fields.

IPC `toOrientationErrorResponse` continues to be the **final** strip before wire; contract helper is shared pure filter used by both sides when attaching details.

### Rationale

- Spec FR-007/FR-008.
- Matches existing bulk pre-skip caps in orientation IPC.

---

## R6 — Sanitizer deduplication

### Decision

Export `looksLikeInternalErrorMessage` from `main/ipc/ipc-helpers.js` (already module-private). Orientation IPC drops its local `looksLikeInternalMessage` and uses the shared helper.

If `[sync:capture]` is **not** already covered by the exported helper, either:

1. Add that rule to the shared helper (preferred — one place), or  
2. Keep a one-line orientation-only pre-check before calling the shared helper.

Do **not** weaken Arabic pass-through for non-internal messages.

### Rationale

- Spec FR-020.
- Source plan verified near-duplicate including extra `[sync:capture]` rule.

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Move full sanitize into contract module | Contract must stay free of IPC-only policy drift; sanitize is security boundary of main |
| Leave duplicate forever | Drift risk |

---

## R7 — Multi-batch import UX (partial progress)

### Decision

When client sends N batches and batches `1..k` succeed then batch `k+1` fails:

- Aggregate **success summary** from committed batches (inserted/updated/unchanged/skipped/duplicates).
- Surface failed batch via `IMPORT_ROLLBACK` (or mapped code) with `noRecordsSaved` reflecting **that batch**, not the whole run.
- User-facing: **partial progress + failed batch** (clarification Q3 / FR-011a).
- Do not call `orientation:clearYear`.
- Retry remains safe under merge key `(student_code, school_year)`.

### Rationale

- Matches current client-side batching + per-batch transactions.
- Avoids lying that earlier commits were rolled back.

---

## R8 — Display stale vs wrong-year

### Decision

| Case | Code | User notice |
|------|------|-------------|
| Older `loadGeneration` after year switch | `STALE_RESPONSE` (page-only) | **Silent discard** (clarification Q4 / FR-012a) |
| Response `school_year` ≠ requested year | `YEAR_RESPONSE_MISMATCH` (page-only) | **Visible non-blocking** toast and/or status (Q5 / FR-012b) |
| Chart paint fails | `CHART_RENDER_ERROR` | Status-line (or equivalent) only; keep tables/KPIs |
| List fails / stats fails | `LIST_LOAD_ERROR` / `STATS_LOAD_ERROR` | Independent recovery; retry path |

Do not use full-page hard error that wipes usable content for wrong-year.

### Rationale

- Spec clarifications Q4–Q5.
- Prevents toast spam on normal year switching while still signaling real consistency faults.

---

## R9 — Relationship to sibling `ipc-result` plan

### Decision

Out of scope for this feature. Contract’s `normalize` is the **stable input** a future `js/shared/ipc-result.js` may call for orientation channels. Sequence: land contract first.

### Rationale

- Spec out of scope + source plan §12.
- Avoids coupling vocabulary work to app-wide toast orchestration.

---

## R10 — Testing strategy

### Decision

1. **`tests/orientation/error-contract-unit.test.js`** (Node, no Electron): every code has message + severity + retryable + classification + section; unknown fallback; safeDetails strip/keep; normalize lean+rich; locked codes present.
2. Extend existing orientation IPC/repo tests only if catalog wiring breaks assertions.
3. Smoke: no preload/handler channel changes expected → parity stays green.
4. Manual: quickstart multi-batch, year switch, chart fail, validation fail.

### Rationale

- Spec FR-019, SC-005–SC-007.
- Matches project test style under `tests/orientation/`.

---

## Resolved unknowns

All Technical Context items are known from the monorepo and clarified spec. **No NEEDS CLARIFICATION** remain for planning.
