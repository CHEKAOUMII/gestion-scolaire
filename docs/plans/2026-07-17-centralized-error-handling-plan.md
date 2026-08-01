# Hybrid Error-Handling Architecture Plan (Orientation Domain)

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Status** | Proposed |
| **Scope** | Student-orientation import + display flows; a reusable contract pattern for future domains |
| **Change type** | Plan only — no application code is modified by this task |
| **Stack** | Electron 35 · vanilla multi-page renderer · `better-sqlite3` · existing IPC/repo/sync layers |
| **Related** | `AGENTS.md` (main-process layering 027) · `docs/plans/2026-07-15-add-write-channel-checklist.md` · `docs/plans/2026-07-16-student-orientation-import-plan.md` · sibling renderer plan `docs/plans/2026-07-17-centralize-error-handling-plan.md` |

> **Naming note:** A separate, differently-scoped plan already lives at
> `docs/plans/2026-07-17-centralize-error-handling-plan.md` (note: *centralize*, not *centralized*).
> That document proposes an app-wide renderer `js/shared/ipc-result.js` helper for interpreting
> IPC results across every page. **This** document is narrower: it defines the shared *error
> vocabulary/contract* for the orientation domain. The two are complementary layers of the same
> concern (contract = "what an error means"; ipc-result helper = "how a page reacts"). Neither
> supersedes the other. Section 12 explains how they compose.

---

## 1. Objective

Establish a **hybrid** error-handling architecture for the orientation domain:

- **Centralize** the stable error *vocabulary*: codes, safe default Arabic messages, severity, retryability, safe-detail rules, and the normalization used by both the main process and the renderer pages.
- **Keep page-specific** validation, loading states, recovery actions, retry behavior, stale-response protection, and partial-result presentation local to each page.
- **Remove the duplicated orientation catalogs** (three today) without creating a single global handler that cannot understand page state.
- **Preserve the existing Electron layering** enforced by `AGENTS.md` (027): IPC handlers do auth + boundary validation, repositories own domain SQL + transactions, renderer pages own user-facing interaction state.

The target is **not** a single global error screen. It is **one shared error vocabulary** with **local UI decisions**.

---

## 2. Verified current state (read before trusting older notes)

All statements below were confirmed by reading the source on 2026-07-17. Line-level facts are cited by file.

### 2.1 IPC infrastructure — `main/ipc/ipc-helpers.js`

Exports actually present:
`authErrorResponse`, `ipcErrorResponse`, `SOFT_AUTH_NO_SESSION_CHANNELS`, `getDefaultYear`, `normalizeYear`, `requireSchoolYear`, `handleRead`, `handleWrite`, `handleWriteSoftAuth`, `writeChannels`.

Internal (module-private, **not exported**): `looksLikeInternalErrorMessage`, `sanitizeIpcErrorMessage`, `computeDefaultYear`.

`authErrorResponse(err)` / `ipcErrorResponse(err)` produce the **lean** shape:

```js
{ success: false, code: 'UNAUTHENTICATED'|'FORBIDDEN'|'SESSION_LOCKED'|'INTERNAL_ERROR', error: '<arabic-safe>' }
```

Sanitization: Arabic messages that are not internal-looking pass through; anything matching `SQLITE|ENOENT|.js:\d+|Error:` etc. becomes `'حدث خطأ داخلي'`. Auth codes keep their own message. `handleRead`, `handleWrite`, `handleWriteSoftAuth` all log via `main/diagnostics/error-log.js` in their `catch`, then return `ipcErrorResponse`/`authErrorResponse`.

### 2.2 Orientation IPC — `main/ipc/orientation.js`

Registers exactly five channels: `orientation:list` (`handleRead`), `orientation:stats` (`handleRead`), `orientation:bulkUpsert` (`handleWriteSoftAuth`, `{ allowNoSession: true }`), `orientation:clearYear` (`handleWrite`), `orientation:delete` (`handleWrite`). Write roles = `ALLOWED_ROLES` minus `viewer`.

`toOrientationErrorResponse(err, fallbackCode)` produces the **rich** shape:

```js
{ success: false, code, error: '<msg>', message: '<msg>', details: <obj|null>, retryable: <bool> }
```

`ORIENTATION_ERROR_CATALOG` here has **8** codes (all messages Arabic):

| Code | Message (verbatim) | retryable |
|------|--------------------|:---------:|
| `INVALID_SCHOOL_YEAR` | الموسم الدراسي غير صالح. الصيغة المتوقعة: YYYY/YYYY. | false |
| `INVALID_RECORD` | لا توجد صفوف صالحة للاستيراد. | false |
| `DATABASE_ERROR` | تعذر حفظ أو قراءة سجلات التوجيه من قاعدة البيانات. | true |
| `IMPORT_ROLLBACK` | تم التراجع عن عملية الاستيراد بسبب خطأ. لم تُطبَّق تغييرات هذه الدفعة. | true |
| `LIST_LOAD_ERROR` | تعذر تحميل قائمة التوجيه. | true |
| `STATS_LOAD_ERROR` | تعذر تحميل إحصائيات التوجيه. | true |
| `SYNC_ERROR` | تعذر تسجيل تغييرات التوجيه للمزامنة. لم تُحفظ الدفعة. | true |
| `SCHOOL_YEAR_MISMATCH` | سنة أحد الصفوف لا تطابق سنة الطلب. | false |

Also present: a **local** `looksLikeInternalMessage` (a near-duplicate of the unexported `looksLikeInternalErrorMessage` in `ipc-helpers.js`, plus a `[sync:capture]` rule), `inferOrientationErrorCode`, `coerceSchoolYearStrict`, `prepareBulkUpsertPayload`, `handleBulkUpsert`.

Important nuances confirmed:
- `inferOrientationErrorCode` **never returns `SCHOOL_YEAR_MISMATCH`**. Per-row year mismatches surface inside the success payload as `details[].reason === 'year_mismatch'`, not as a top-level code. `SCHOOL_YEAR_MISMATCH` in the main catalog is therefore effectively dead at the IPC top level.
- `handleBulkUpsert` returns `success: true` (not an error) when all rows are pre-skipped — "nothing valid to write" is not a DB error.
- The `bulkUpsert` catch remaps SQLITE/constraint/transaction failures from `DATABASE_ERROR` to `IMPORT_ROLLBACK`; `SYNC_ERROR` and `INVALID_RECORD` are detected first.

### 2.3 Persistence — `main/repos/orientation.js`

Owns all SQL. `bulkUpsert` runs the **entire batch in one `db.transaction`**; merge key is strictly `(student_code, school_year)`; `UPDATE` never rewrites `student_code`/`school_year`; unchanged rows skip `UPDATE`. Sync capture happens **inside** the same transaction via `captureInputUpserts(db, { tableName: 'student_orientation', keyFields: ['school_year','student_code'], items, operation: 'PUT' })`, and `notifyCaptureCommitted()` fires only after commit. A capture throw rolls the whole batch back → mapped to `SYNC_ERROR`/`IMPORT_ROLLBACK` upstream. `clearYear` and `deleteById` are separate. No repo file imports `../sync/capture` directly; it uses `./capture-port` (027 rule).

### 2.4 Import renderer — `js/pages/settings-imports.js`

Defines its own `ORIENTATION_ERROR_CATALOG` with **18** codes plus `createOrientationError`, `isOrientationError`, `orientationUserMessage`. Owns file read, JSON/CSV/XLSX parsing, structural + row-level validation, dedupe (by normalized `student_code`, last wins), `duplicatesInFile` counting, batching (500/batch) through `window.api.orientation.bulkUpsert`, and the final Arabic summary (`formatOrientationImportSummary`). Distinguishes an **IPC throw** from an **`success:false` payload**, and, when partial rows were already written, raises `IMPORT_ROLLBACK` with `noRecordsSaved: false` (never claims committed rows falsely). Enforces a **hard** year match (`assertOrientationSchoolYearMatch`) before any write and never calls `orientation:clearYear` on the normal path. The 18 codes:

`FILE_READ_ERROR`(t), `EMPTY_FILE`(f), `UNSUPPORTED_FORMAT`(f), `INVALID_FILE_STRUCTURE`(f), `MISSING_STUDENT_CODE`(f), `MISSING_ORIGIN_STREAM`(f), `INVALID_NUMERIC_VALUE`(f), `SCHOOL_YEAR_MISMATCH`(f), `INVALID_SCHOOL_YEAR`(f), `INVALID_RECORD`(f), `DATABASE_ERROR`(t), `IMPORT_ROLLBACK`(t), `LIST_LOAD_ERROR`(t), `STATS_LOAD_ERROR`(t), `YEAR_RESPONSE_MISMATCH`(t), `STALE_RESPONSE`(t), `CHART_RENDER_ERROR`(t), `SYNC_ERROR`(t).

### 2.5 Display renderer — `js/pages/students-orientation.js`

Defines its own `ORIENTATION_DISPLAY_ERRORS` with **6** codes plus `createDisplayError`, `displayUserMessage`, `ensureOk`, `loadAll`. Owns selected-year state, a monotonic `loadGeneration` token for stale-response discard, KPI/board/matrix/table rendering, independent recovery of list vs stats vs charts, and legitimate empty states. Charts are isolated: a chart failure only appends `CHART_RENDER_ERROR` text to the status line and never removes loaded tables/KPIs. The 6 codes:

`LIST_LOAD_ERROR`(t), `STATS_LOAD_ERROR`(t), `YEAR_RESPONSE_MISMATCH`(t), `STALE_RESPONSE`(t), `CHART_RENDER_ERROR`(t), `INVALID_SCHOOL_YEAR`(f).

### 2.6 Preload — `preload.js`

`window.api.orientation = { list, stats, bulkUpsert, clearYear, delete }`, each a thin `ipcRenderer.invoke`. No transformation of the response shape — pages receive the raw flat object.

### 2.7 Sync capture — `main/sync/capture.js`

`orientation:bulkUpsert` → `{ captureMode: 'explicit', exclude: true, localKeyFields: ['school_year','student_code'] }`; `orientation:clearYear` → `{ operation: 'DEL', exclude: true }`; `orientation:delete` → normal `argId` wrapper capture. Because bulkUpsert is `exclude`/`explicit`, `wrapWithSyncCapture` returns the handler **unwrapped** — so the `captureWarning`/`captureError` fields it injects for wrapper-mode channels **do not** appear on orientation responses. (Relevant only if the contract is later generalized to wrapper-mode domains.)

### 2.8 Catalog drift (the actual problem)

Same code, different meaning/wording across the three catalogs:

| Code | main/ipc/orientation.js | settings-imports.js | students-orientation.js |
|------|-------------------------|---------------------|-------------------------|
| `INVALID_SCHOOL_YEAR` | "...YYYY/YYYY." | "...YYYY/YYYY (مثال: 2025/2026)." | "الموسم الدراسي غير محدد أو غير صالح." |
| `INVALID_RECORD` | "لا توجد صفوف صالحة للاستيراد." | "سجل توجيه غير صالح وتم تجاوزه." | — |
| `IMPORT_ROLLBACK` | "تم التراجع عن عملية الاستيراد..." | "فشل الاستيراد بعد كتابة جزئية. أعد الاستيراد..." | — |
| `SCHOOL_YEAR_MISMATCH` | "سنة أحد الصفوف لا تطابق سنة الطلب." | "الموسم الدراسي في الملف لا يطابق الموسم المختار..." | — |
| `LIST_LOAD_ERROR` / `STATS_LOAD_ERROR` / `SYNC_ERROR` | identical | identical | identical (subset) |

Only **8** codes actually cross the IPC boundary (§2.2). The renderer's remaining codes are **file/parse-only** (`FILE_READ_ERROR`, `EMPTY_FILE`, `UNSUPPORTED_FORMAT`, `INVALID_FILE_STRUCTURE`, `MISSING_STUDENT_CODE`, `MISSING_ORIGIN_STREAM`, `INVALID_NUMERIC_VALUE`) or **display-only** (`YEAR_RESPONSE_MISMATCH`, `STALE_RESPONSE`, `CHART_RENDER_ERROR`) — they are created and consumed entirely renderer-side and never traverse `preload`.

### Conclusion

Error handling is neither fully centralized nor fully page-local:
- **Centralized today:** IPC try/catch wrapping, auth/role checks, internal-message sanitization, diagnostic logging, and sync-capture registration.
- **Page-local today (correctly):** file parsing, row-level validation, load orchestration, stale-year protection, chart/table/KPI recovery.
- **Not centralized enough:** stable codes, code metadata (severity/retryability), default safe messages, safe-detail rules, and the normalization shared by all three catalogs — which is why the drift in §2.8 exists.

---

## 3. Target architecture

```text
                     Shared contract (data + pure fns)
        codes · default safe messages · severity · retryable · detail rules
                        /                         \
             Main-process adapter            Renderer adapters
        (ipc-helpers + orientation.js)   (settings-imports + students-orientation)
                        |                         |
                orientation repo            page state + recovery UX
              (transaction + SQL +
               capture-port)
```

### 3.1 Shared contract module

Create a dependency-free module following the repo's existing `js/shared/*` convention:

```text
js/shared/errors/orientation-error-contract.js
```

**Runtime-dual export** — must match the UMD/IIFE idiom already used by `js/shared/gender.js` so it works in both the CommonJS main process and the browser renderer:

```js
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) {
        root.OrientationErrorContract = api;      // browser global
        // plus any convenience globals the pages need
    }
})(typeof window !== 'undefined' ? window
   : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    // pure data + pure functions only
    return { /* ... */ };
});
```

Constraints:
- **No** `require('electron')`, no `better-sqlite3`, no `fs`, no DOM, no `showToast`. Portable data + pure functions only (mirrors `gender.js`, `csv.js`, `chart-theme.js`).
- Owns: stable codes; default safe Arabic messages; `severity` (`info|warning|error`); `retryable` (bool); `classification` (`validation | domain | infrastructure | transport | display`); whether a code is expected to carry row-level `details`; a `normalize(response)` that maps any orientation-like object into the **existing flat shape** (see §4); an `unknownCode` fallback.

### 3.2 Preserve the existing flat response shape

The contract's `normalize` **must** emit the flat shape the renderer already reads via `ensureOk`/`orientationUserMessage`/`handleIpcResult`. Do **not** introduce a nested `error: { code, message }` object — it would break `settings-imports.js` and `students-orientation.js`.

Canonical shapes to preserve:

```js
// Rich (domain) — from toOrientationErrorResponse
{ success: false, code, error, message, details, retryable }

// Lean (auth/read internal) — from authErrorResponse / ipcErrorResponse
{ success: false, code, error }        // no message/details/retryable
```

`normalize` must accept **both** and return a predictable superset (filling `message` from `error`, defaulting `retryable`/`severity` from contract metadata, `details = null` when absent). The renderer already tolerates both today — the contract just makes that tolerance explicit and testable.

### 3.3 Main-process adapter (unchanged responsibilities)

- `main/ipc/ipc-helpers.js`: keep auth/role enforcement, year/required-field validation, internal-message sanitization, diagnostic logging. Optionally **export** the sanitization helper (`looksLikeInternalErrorMessage`) so `orientation.js` stops keeping its own near-duplicate `looksLikeInternalMessage` (see §2.2). Add only *generic* normalization if the current helpers cannot express the contract.
- `main/ipc/orientation.js`: `require('../../js/shared/errors/orientation-error-contract')` (or the resolved relative path), replace the inline `ORIENTATION_ERROR_CATALOG` with the contract, keep `toOrientationErrorResponse` as the **security boundary** that strips unsafe details, keep `inferOrientationErrorCode` as a thin adapter, preserve all five channel registrations and the `IMPORT_ROLLBACK` remap.
- `main/repos/orientation.js`: unchanged. Keep SQL + single-transaction semantics + `capture-port`. Never adopt renderer wording.

The main process must never send raw exception text, stacks, SQL, filesystem paths, credentials, or full payloads to a renderer.

### 3.4 Renderer / page adapters (keep local logic)

- `settings-imports.js`: drop the duplicate 18-code catalog; consume the shared contract for the **cross-process + shared** codes; **keep** file/parse-only codes (`FILE_READ_ERROR`, `EMPTY_FILE`, …) and all row/field/summary detail locally (they may live in the same shared module under a "page-only" section for consistency, but must not be *required* by the main process). Keep dedupe, batching, `duplicatesInFile`, `IMPORT_ROLLBACK`-vs-validation distinction, and the partial-write guard.
- `students-orientation.js`: drop the duplicate 6-code catalog; use shared codes for underlying failures; **keep** `loadGeneration` stale-discard, `YEAR_RESPONSE_MISMATCH`, independent list/stats/chart recovery, and legitimate empty states.

A page may add local presentation context but must not redefine a code's stable meaning, severity, retryability, or security classification.

---

## 4. Shared contract details

### 4.1 Code ownership rules

1. A stable code is defined **once** in the contract.
2. Main-process code may *infer/translate* an implementation error into a code (`inferOrientationErrorCode`).
3. Renderer code may add page context but must not create a competing code with the same meaning.
4. Default wording is centralized; a page may override presentation while preserving the code.
5. Existing codes are **preserved or aliased** — never silently renamed (logs, tests, and renderer branches depend on them; `IMPORT_ROLLBACK` especially).
6. Unknown codes normalize to a generic safe infrastructure error, never displayed verbatim.

### 4.2 Categories (map the audited codes)

| Category | Codes (current) | Boundary | Default retryable |
|----------|-----------------|----------|:-----------------:|
| Input/read | `FILE_READ_ERROR`, `EMPTY_FILE`, `UNSUPPORTED_FORMAT`, `INVALID_FILE_STRUCTURE` | renderer-only | mostly no |
| Validation | `MISSING_STUDENT_CODE`, `MISSING_ORIGIN_STREAM`, `INVALID_NUMERIC_VALUE`, `INVALID_SCHOOL_YEAR`, `INVALID_RECORD` | renderer + IPC (`INVALID_*`) | no |
| Year guard | `SCHOOL_YEAR_MISMATCH` | renderer (hard-stop) + IPC row detail (`year_mismatch`) | no |
| Persistence | `DATABASE_ERROR` | IPC | yes |
| Rollback | `IMPORT_ROLLBACK` | IPC + renderer | yes |
| Sync | `SYNC_ERROR` | IPC | yes |
| Load | `LIST_LOAD_ERROR`, `STATS_LOAD_ERROR` | IPC + display | yes |
| Display | `YEAR_RESPONSE_MISMATCH`, `STALE_RESPONSE`, `CHART_RENDER_ERROR` | display-only | mixed |

`IMPORT_ROLLBACK` and every cross-IPC code (§2.2) are **compatibility-locked** unless an explicit alias migration is documented.

### 4.3 Safe details (allowlist)

Allowed: selected school year; a field name from an allowlist; row number/count; duplicate count; accepted/rejected/skipped counts; a retry hint; the operation name (`list`/`stats`/`bulkUpsert`); a bounded skip-reason list (already capped at 40/80 in code).

Never: full file contents; student PII in diagnostics; raw DB errors; SQL/parameters; absolute paths; tokens/license/sync credentials; unbounded rejected-row arrays.

---

## 5. Error-handling flows (verified, keep)

### 5.1 Import (`settings-imports.js` → `orientation:bulkUpsert`)
1. Read file locally; file-read failures → local `FILE_READ_ERROR` recovery.
2. Parse + structurally validate before IPC.
3. Hard year match (`assertOrientationSchoolYearMatch`) — no silent substitution.
4. Dedupe by normalized `student_code`; record `duplicatesInFile`.
5. Send validated batches (500/batch); IPC re-validates (renderer validation is not a security boundary).
6. Repo writes in one transaction (§2.3).
7. Success → show inserted/updated/unchanged/skipped/duplicates.
8. `success:false` payload **or** IPC throw with prior partial writes → `IMPORT_ROLLBACK` (`noRecordsSaved:false`); never claim committed rows falsely.
9. Normal path never calls `orientation:clearYear`.
10. Retry is safe/idempotent because the repo merge key + non-destructive merge prevent duplicates.

### 5.2 Display (`students-orientation.js` → `orientation:list` + `orientation:stats`)
1. Capture year; increment `loadGeneration`.
2. Fetch list, then stats.
3. Validate structured result **and** returned school year on each response.
4. Stale/older-generation or wrong-year → discard silently (`STALE_RESPONSE`) — do not overwrite current content.
5. List vs stats failures are independent; stats failure keeps the table.
6. Chart failure is isolated (`CHART_RENDER_ERROR`) — KPIs/tables remain.
7. All-unavailable → page-level empty/error + retry.
8. Wrong-year (`YEAR_RESPONSE_MISMATCH`) is a consistency failure, not valid empty data.
9. A newer request must not have its loading state cleared by an older response.

### 5.3 Destructive clear-year (`orientation:clearYear`, `handleWrite` hard auth)
Separate, explicit, confirmed, shows target year, reports commit/fail, refreshes only on success, never used as an import shortcut.

---

## 6. Logging & privacy (keep)

Log at the main boundary (`error-log.js`): code, channel, safe role/year, category, retryability, sanitized counts. Never log full files, PII, tokens, raw SQL, or renderer-visible stacks. User messages: plain-language + next step; no internals; preserve the distinction between "correct the input," "retry," and "stale — ignore." If a correlation id is added, generate it in the main process and expose only a short safe reference.

---

## 7. Proposed file changes (for a later coding task — not done here)

### New
| File | Purpose |
|------|---------|
| `js/shared/errors/orientation-error-contract.js` | Dual-export (UMD like `gender.js`) stable codes + default metadata + pure `normalize`/`unknownCode`/`isRetryable`/`safeDetails`. |
| `tests/orientation/error-contract-unit.test.js` | Node unit tests (matches existing `tests/orientation/*.test.js`). |

### Modify
| File | Planned change |
|------|----------------|
| `main/ipc/ipc-helpers.js` | Optionally export `looksLikeInternalErrorMessage`; add generic normalization only if needed. Keep auth/sanitize behavior. |
| `main/ipc/orientation.js` | Consume the contract; drop the inline catalog; keep `toOrientationErrorResponse` boundary, `inferOrientationErrorCode`, five channels, `IMPORT_ROLLBACK` remap; remove the local `looksLikeInternalMessage` duplicate. |
| `main/repos/orientation.js` | No functional change; confirm capture-port + transaction untouched. |
| `js/pages/settings-imports.js` | Remove duplicate catalog; use contract; keep parse/summary/rollback logic and page-only codes. |
| `js/pages/students-orientation.js` | Remove duplicate catalog; use contract; keep `loadGeneration`, stale/year-mismatch, isolated chart recovery. |
| `settings-imports.html` | Add `<script src="js/shared/errors/orientation-error-contract.js" defer></script>` among the other `js/shared/*` entries (they load deferred, in order, before `js/pages/settings-imports.js` which is last — see below). |
| `students-orientation.html` | Same: add the contract script alongside `js/shared/dom-helpers.js` etc., before the page logic. |
| `preload.js` | No change (namespace + raw pass-through stay). |
| `main/sync/capture.js` | No change; orientation stays `exclude`/`explicit`. |
| `docs/plans/2026-07-15-add-write-channel-checklist.md` | Add a "consume shared error contract" renderer step. |

**Verified script order.** In `settings-imports.html` the deferred shared scripts load first (`js/shared/dom-helpers.js`, `auth-session.js`, `filter-manager.js`, later `js/shared/fet-import.js`) and `js/pages/settings-imports.js` is the **last** script. In `students-orientation.html` the head loads `js/shared/dom-helpers.js`, `auth-session.js`, `filter-manager.js`, `gender.js`, then `js/utils.js`, etc. Because `defer` preserves document order, placing the contract with the other `js/shared/*` tags guarantees it is defined before either page script runs.

No database migration is introduced by this architecture.

---

## 8. Migration strategy

**Phase 0 — Inventory & compatibility.** Extract every key/message from the three catalogs (§2.8); grep each code before renaming; record the exact shapes returned by all five channels; identify tests/logs depending on codes; lock `IMPORT_ROLLBACK` and all §2.2 codes via aliases if needed.

**Phase 1 — Contract.** Implement the dual-export module (no Electron/SQLite/DOM/fs); add unknown-code fallback + safe-detail filtering + the both-shapes `normalize`; wire it into both HTML pages and `require` it in `orientation.js`. No behavior change yet beyond using the shared normalizer.

**Phase 2 — Main integration.** Replace the inline catalog in `orientation.js`; keep `toOrientationErrorResponse` as the security boundary until proven equivalent; remove the duplicate `looksLikeInternalMessage`; verify auth/year/sanitize/logging/capture unchanged; confirm bulk writes still roll back and never call `clearYear`.

**Phase 3 — Import renderer.** Replace the local catalog; keep parse/row-level details, summary, dedupe; preserve the `IMPORT_ROLLBACK`-vs-validation split and the no-false-partial-success guard.

**Phase 4 — Display renderer.** Replace `ORIENTATION_DISPLAY_ERRORS`; preserve `loadGeneration` stale-discard, `YEAR_RESPONSE_MISMATCH`, independent list/stats/chart recovery, valid empty states.

**Phase 5 — Cleanup & docs.** Remove obsolete catalogs after all references migrate; grep deleted names + aliases; update the write-channel checklist and this plan; add a short ownership note near the contract; run the full targeted suite.

---

## 9. Targeted validation & tests

Run via `npm test` (root `tests/run-all.js`); Node unit style, no Electron. Existing orientation coverage to extend: `tests/orientation/ipc-bulk-safety.test.js`, `tests/orientation/merge-and-map.test.js`, `tests/repos-orientation.test.js`.

**Contract unit** (`tests/orientation/error-contract-unit.test.js`): every code has message + severity + retryable; unknown code → safe fallback; unsafe detail keys stripped; allowed row/count/year details preserved and bounded; `IMPORT_ROLLBACK` + all §2.2 codes still recognized; `normalize` accepts both the rich and lean shapes and yields a distinguishable success vs failure; missing `showToast`/DOM never referenced.

**Main/IPC**: missing auth / insufficient role keep `authErrorResponse` (lean shape); missing/invalid year rejected; internal DB messages sanitized; transaction failure → `IMPORT_ROLLBACK`; a failed bulk import reports no committed rows; `bulkUpsert` never calls `clearYear`; sync capture stays `exclude`/`explicit` (no `captureWarning` on orientation).

**Import page**: unreadable/empty/malformed/missing-field/invalid-value/year-mismatch each yield an actionable local state; duplicates appear in the summary (not a backend failure); rollback offers retry with no false partial success; a successful retry yields one correct summary.

**Display page**: list vs stats failures shown independently; a stale/older-generation response cannot overwrite newer content; wrong-year rejected (not rendered as empty); chart failure never removes table/KPIs; a valid zero-match filter stays a valid empty result; retry preserves the selected year.

**Manual smoke**: valid import for selected year; deliberate validation error → no write; simulated transaction failure → rollback messaging; rapid year switch during in-flight list/stats → old response discarded; chart failure → tables/KPIs usable; toasts never expose raw internal text.

---

## 10. Acceptance criteria

- One shared orientation error contract is the source of stable codes + default metadata.
- `main/ipc/orientation.js`, `settings-imports.js`, and `students-orientation.js` no longer maintain competing catalogs for the **shared** codes (page-only codes may remain, clearly separated).
- The flat response shape (both rich and lean variants) is preserved; no nested `error` object is introduced.
- IPC responses stay safe (no raw messages/stacks/SQL/paths).
- Page-specific validation, summaries, empty states, retries, chart recovery, and stale-response handling remain local and functional.
- `IMPORT_ROLLBACK` and all §2.2 codes remain compatible (or aliased + tested).
- Normal import never calls `orientation:clearYear`; a failed transactional import cannot be shown as committed partial success.
- List/stats/chart failures stay independent; wrong-year/stale responses are discarded before render.
- The duplicate `looksLikeInternalMessage` in `orientation.js` is removed in favor of one sanitizer.
- Targeted tests cover contract normalization, both response shapes, IPC mapping, rollback, stale responses, and isolated chart failure.
- No DB migration is introduced solely for this architecture.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Renaming a code breaks logs/renderer branches. | Inventory + grep first; preserve aliases; test compatibility. |
| Nested/normalized shape breaks `ensureOk`/`orientationUserMessage`. | Contract emits the **flat** shape; unit-test both rich and lean inputs. |
| Dual module behaves differently in CommonJS vs browser. | Copy the exact `gender.js` UMD idiom; add a load smoke test in both contexts. |
| A global handler hides page context. | Keep recovery in page adapters; centralize only vocabulary + transport. |
| Sanitized errors lose actionable info. | Bounded row/field/count allowlist (already capped in code). |
| Retry repeats a non-idempotent write. | Preserve repo merge key + transaction; test repeated `bulkUpsert`. |
| Partial-import messaging misleads after rollback. | Keep the committed-vs-rolled-back distinction already in `importOrientation`. |
| Stale responses overwrite current-year data. | Keep `loadGeneration`/year checks before every state update. |
| Over-centralization expands scope. | Orientation first; generalize only where reuse is proven. |

---

## 12. Relationship to the renderer `ipc-result` plan

`docs/plans/2026-07-17-centralize-error-handling-plan.md` proposes `js/shared/ipc-result.js` — an app-wide helper (`handleIpcResult` / `invokeIpc`) that decides *how a page reacts* to any IPC result (toast, loading close, auth handling). This document defines *what an orientation error means*. They compose cleanly:

- The **contract** (this plan) turns a raw response into a normalized `{ code, message, severity, retryable, details }`.
- The **ipc-result helper** (the sibling plan) consumes that normalization to drive toasts/loading/auth UX uniformly.

Recommended sequence if both proceed: land the contract first (stable vocabulary), then have `ipc-result.js` call the contract's `normalize` for orientation channels. Neither requires a preload or main-contract change.

---

## 13. Rejected alternatives

- **One global error handler.** Cannot understand parse stages, selected year, stale requests, partial summaries, or independent table/stats/chart sections.
- **Independent per-page catalogs (status quo).** Produces the §2.8 drift.
- **SQL or renderer wording inside the contract.** Violates 027 layering; couples the contract to a runtime/UI.
- **Nested `error: { code, message }` response shape.** Breaks the verified flat consumers (`ensureOk`, `orientationUserMessage`, `handleIpcResult`).
- **Clear-year-before-import.** Destructive; conflicts with the non-destructive merge; normal import must use the batch-write path only.

---

## 14. Implementation handoff checklist

- [ ] Re-read `AGENTS.md` (027 layering) and the write-channel checklist.
- [ ] Re-read `ipc-helpers.js`, `orientation.js`, `repos/orientation.js`, `preload.js`, `settings-imports.js`, `students-orientation.js`, `main/sync/capture.js`.
- [ ] Record exact current shapes + all three catalogs' keys/messages (§2.8).
- [ ] Confirm `npm test` / `tests/run-all.js` and the `tests/orientation/` location.
- [ ] Confirm deferred script order in both HTML pages (§7).
- [ ] Define aliases for any externally-observed code before renaming.
- [ ] Implement the dual-export contract before deleting any local catalog.
- [ ] Validate rollback + sync capture before generalizing to other domains.

## Final decision

Use a **hybrid architecture**. Centralize the *vocabulary* (codes, default safe Arabic messages, severity, retryability, safe-detail rules, and the both-shapes `normalize`) in one dependency-free dual-export module. Keep *page behavior* (file parsing, row-level validation, selected-year state, loading, stale-response discard, retries, summaries, empty states, chart/table recovery) local. This removes the three-way catalog drift without sacrificing the contextual recovery the orientation import and display pages require — and it composes with the sibling renderer `ipc-result` plan rather than competing with it.
