# Contract: Orientation Error Vocabulary

**Feature**: `028-orientation-error-contract`  
**Module path**: `js/shared/errors/orientation-error-contract.js`  
**Consumers**: `main/ipc/orientation.js`, `js/pages/settings-imports.js`, `js/pages/students-orientation.js`  
**Load**:

- **Node / main**: `require('../../js/shared/errors/orientation-error-contract')` (path relative to IPC file)
- **Renderer**: `<script src="js/shared/errors/orientation-error-contract.js" defer></script>` before page script; global `OrientationErrorContract`

---

## 1. Public API (stable)

```js
OrientationErrorContract = {
  // Sections
  SHARED_CODES,          // readonly map code → ErrorCodeDefinition fields
  PAGE_ONLY_CODES,       // readonly map
  ALL_CODES,             // union map (or getter)

  // Lookups
  getDefinition(code),   // definition | null
  isShared(code),
  isPageOnly(code),
  isRetryable(code),
  getSeverity(code),
  getDefaultMessage(code),

  // Pure transforms
  normalize(responseOrErr),   // → NormalizedFailure | success passthrough object
  unknownFallback(),          // → NormalizedFailure for unknown
  safeDetails(details, opts), // → filtered object | null
  userMessage(errOrCode, presentationContext?), // baseline + optional context string

  // Constants
  LOCKED_SHARED_CODES,   // string[] compatibility lock
  MAX_SKIP_REASONS       // number (default 40)
}
```

Exact export names may use camelCase consistent with Prettier/project style; this document is the behavioral contract.

---

## 2. Failure response shapes (IPC wire — unchanged)

### 2.1 Rich domain failure (orientation IPC)

```json
{
  "success": false,
  "code": "IMPORT_ROLLBACK",
  "error": "<arabic-safe>",
  "message": "<arabic-safe>",
  "details": null,
  "retryable": true
}
```

Produced by `toOrientationErrorResponse` using **shared** section only.

### 2.2 Lean failure (auth / generic ipc-helpers)

```json
{
  "success": false,
  "code": "UNAUTHENTICATED",
  "error": "<arabic-safe>"
}
```

Orientation pages MUST still handle lean failures without treating them as orientation domain codes that imply validation issues.

### 2.3 Success (bulk example — not redesigned)

```json
{
  "success": true,
  "schoolYear": "2025/2026",
  "inserted": 0,
  "updated": 0,
  "unchanged": 0,
  "skipped": 0,
  "details": []
}
```

Contract `normalize` does not rewrite success payloads beyond recognizing `success: true`.

---

## 3. Channels (unchanged names)

| Channel | Handler style | Failure path |
|---------|---------------|--------------|
| `orientation:list` | `handleRead` | rich via `toOrientationErrorResponse` → `LIST_LOAD_ERROR` fallback |
| `orientation:stats` | `handleRead` | rich → `STATS_LOAD_ERROR` |
| `orientation:bulkUpsert` | `handleWriteSoftAuth` (`allowNoSession`) | rich; remap DB/tx → `IMPORT_ROLLBACK`; capture → `SYNC_ERROR` |
| `orientation:clearYear` | `handleWrite` | rich → `DATABASE_ERROR` fallback |
| `orientation:delete` | `handleWrite` | rich → `DATABASE_ERROR` fallback |

Preload: `window.api.orientation.{list,stats,bulkUpsert,clearYear,delete}` — **no transform**.

---

## 4. Security boundary rules

`toOrientationErrorResponse` (main) remains responsible for:

1. Infer code via `inferOrientationErrorCode` (catalog membership from **shared** section).
2. Choose safe message: Arabic non-internal raw message OR catalog default.
3. Attach `details` only after allowlist / existing trust of `err.details` shape (prefer `safeDetails`).
4. Never send stacks, SQL, paths, credentials, full files.

Contract module assists with catalog + pure filter; it is **not** a substitute for the IPC boundary.

---

## 5. Renderer presentation rules

| Rule | Behavior |
|------|----------|
| Core message | Vocabulary default for code |
| Context | Optional prefix/suffix (step, counts, retry hint) — FR-002a |
| Competing catalog | Forbidden for shared and page-only codes |
| Multi-batch fail | Partial progress summary + failed-batch failure |
| Stale | Silent discard (`STALE_RESPONSE`) |
| Wrong-year | Visible non-blocking notice (`YEAR_RESPONSE_MISMATCH`) |
| Chart fail | Non-destructive notice (`CHART_RENDER_ERROR`) |

---

## 6. Compatibility lock

Implementations MUST keep recognizing:

```text
INVALID_SCHOOL_YEAR
INVALID_RECORD
DATABASE_ERROR
IMPORT_ROLLBACK
LIST_LOAD_ERROR
STATS_LOAD_ERROR
SYNC_ERROR
SCHOOL_YEAR_MISMATCH
```

Plus all page-only codes listed in [data-model.md](../data-model.md).

Silent renames are forbidden without alias entries + tests.

---

## 7. Non-goals (contract)

- Auth catalog ownership (`UNAUTHENTICATED`, …) stays in ipc-helpers.
- Nested `{ error: { code, message } }` envelope.
- App-wide `handleIpcResult` (sibling plan).
- DB migrations or new orientation channels.
