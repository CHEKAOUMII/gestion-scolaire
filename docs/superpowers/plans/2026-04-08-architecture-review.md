# Architecture Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perform a comprehensive, systematic architecture review of the gestionScholaire Electron app, producing a written findings report with severity-tagged issues and concrete remediation steps.

**Architecture:** The app is a multi-page Electron desktop app (no bundler). The review walks each architectural layer in isolation — process boundary, IPC layer, DB layer, renderer utilities, CSS/styling — then cross-cuts for security and consistency. Each task produces a section of the final report.

**Tech Stack:** Electron, better-sqlite3, Tailwind CSS v4, vanilla JS (no framework), ESLint flat config v9, Prettier, electron-updater, AWS SDK (DynamoDB/Cognito).

---

## File Structure

| File | Role in this plan |
|---|---|
| `docs/superpowers/plans/2026-04-08-architecture-review.md` | This plan |
| `docs/architecture-review-report.md` | **Output** — the findings report written task by task |
| `preload.js` | Read in Task 1 (process boundary) |
| `main.js` | Read in Task 1 |
| `main/ipc/registerAll.js` | Read in Task 2 (IPC parity) |
| `main/ipc/ipc-helpers.js` | Read in Task 2 |
| `main/ipc/*.js` (19 files) | Read in Task 2 |
| `main/db/schema.js` | Read in Task 3 (DB layer) |
| `main/db/migrations.js` | Read in Task 3 |
| `main/db/init.js` | Read in Task 3 |
| `main/db/context.js` | Read in Task 3 |
| `main/auth/password.js` | Read in Task 4 (auth/security) |
| `main/licensing/service.js` | Read in Task 4 |
| `main/licensing/deviceFingerprint.js` | Read in Task 4 |
| `main/licensing/offlineKey.js` | Read in Task 4 |
| `js/utils.js` | Read in Task 5 (renderer utilities) |
| `js/message-system.js` | Read in Task 5 |
| `js/pages/*.js` (22 files) | Read in Task 5 |
| `js/backup.js` | Read in Task 5 |
| `css/tailwind-input.css` | Read in Task 6 (CSS) |
| `tests/smoke.js` | Read in Task 7 (test coverage) |
| `main/reports/engine.js` | Read in Task 8 (reports) |
| `main/notifications/dispatcher.js` | Read in Task 8 (notifications) |

---

## Task 1: Process Boundary & Electron Security

**Files:**
- Read: `main.js`
- Read: `preload.js`
- Write: `docs/architecture-review-report.md` (create with section 1)

- [ ] **Step 1: Read `main.js`**

Open and read the entire file. Note:
- BrowserWindow creation options (`contextIsolation`, `nodeIntegration`, `webSecurity`, `sandbox`)
- How `preload.js` is referenced
- Whether `devTools` is enabled in production builds
- Any `shell.openExternal()` calls and whether input is sanitized

- [ ] **Step 2: Read `preload.js`**

Open and read the entire file. Note:
- Every channel exposed via `contextBridge.exposeInMainWorld`
- Whether any raw Node/Electron APIs are exposed directly (e.g. `require`, `fs`, `shell`)
- Whether all exposed methods validate or sanitize their arguments before passing to IPC
- Count total channels declared

- [ ] **Step 3: Write Section 1 of the report**

Create `docs/architecture-review-report.md` with this exact structure, filling in your findings:

```markdown
# gestionScholaire — Architecture Review Report
**Date:** 2026-04-08
**Reviewer:** Architecture Review Plan (automated)
**Scope:** Full codebase — process boundary, IPC, DB, auth, renderer, CSS, tests, reports, notifications

---

## Severity Legend
| Level | Meaning |
|---|---|
| 🔴 Critical | Security vulnerability or data loss risk — fix before any release |
| 🟠 Important | Structural violation that will cause bugs — fix before merge |
| 🟡 Minor | Code quality degradation — schedule for cleanup sprint |
| 🟢 Good | Explicitly noteworthy positive pattern |

---

## 1. Process Boundary & Electron Security

### Findings

[List each finding with its severity tag, the file:line reference, and a one-sentence explanation]

### Checklist
- [ ] `contextIsolation: true` — **[PASS/FAIL]**
- [ ] `nodeIntegration: false` — **[PASS/FAIL]**
- [ ] `webSecurity: true` (not disabled) — **[PASS/FAIL]**
- [ ] `sandbox: true` — **[PASS/FAIL]**
- [ ] No raw `require`/`fs`/`shell` exposed in preload — **[PASS/FAIL]**
- [ ] `devTools` disabled in production — **[PASS/FAIL]**
- [ ] `shell.openExternal()` inputs sanitized — **[PASS/FAIL / N/A]**

### Summary
[1-2 sentences on the overall health of this layer]
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture-review-report.md
git commit -m "docs: start architecture review — section 1 process boundary"
```

---

## Task 2: IPC Layer — Parity, Helpers, Auth Guards

**Files:**
- Read: `main/ipc/registerAll.js`
- Read: `main/ipc/ipc-helpers.js`
- Read: all 19 files in `main/ipc/`
- Modify: `docs/architecture-review-report.md` (append section 2)

- [ ] **Step 1: Read `registerAll.js` and `ipc-helpers.js`**

From `registerAll.js`, extract the complete list of registered modules.
From `ipc-helpers.js`, note the three wrappers (`handleRead`, `handleWrite`, `handleWriteNoAuth`) and their contracts.

- [ ] **Step 2: Audit each IPC handler file**

For each file in `main/ipc/`, check:
1. Does it use `handleRead`/`handleWrite`/`handleWriteNoAuth` exclusively, or does it call raw `ipcMain.handle()`?
2. Does every write operation that should be auth-gated use `handleWrite` (not `handleWriteNoAuth`)?
3. Does every channel name in the file appear in `preload.js`? (cross-reference your list from Task 1)
4. Is `getDb()` called inside the handler (injected by helper), or is the DB imported directly at module top?
5. Are there any handlers doing unbounded queries (no `LIMIT`, no `school_year` filter)?

Build a table:

```
| Handler file | Raw ipcMain? | Misused NoAuth? | Missing in preload? | Direct DB import? | Unbounded query? |
```

- [ ] **Step 3: Append Section 2 to the report**

```markdown
## 2. IPC Layer

### Channel Parity
- Total channels in `preload.js`: [N]
- Total handlers registered in `registerAll.js`: [N]
- Mismatches: [list any, or "None"]

### Handler Audit Table
[Paste the table from Step 2]

### Findings
[List each finding with severity tag and file:line]

### Checklist
- [ ] No raw `ipcMain.handle()` calls — **[PASS/FAIL]**
- [ ] All write ops use `handleWrite` or justified `handleWriteNoAuth` — **[PASS/FAIL]**
- [ ] All channels have matching preload entries — **[PASS/FAIL]**
- [ ] No direct DB imports in handler files — **[PASS/FAIL]**
- [ ] All queries filter by `school_year` — **[PASS/FAIL]**

### Summary
[1-2 sentences]
```

- [ ] **Step 4: Run smoke test to confirm IPC parity mechanically**

```bash
npm run test:smoke
```

Expected: all tests pass. If any fail, note the failure in the report as 🔴 Critical.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture-review-report.md
git commit -m "docs: architecture review — section 2 IPC layer"
```

---

## Task 3: Database Layer — Schema, Migrations, Constraints

**Files:**
- Read: `main/db/schema.js`
- Read: `main/db/migrations.js`
- Read: `main/db/init.js`
- Read: `main/db/context.js`
- Modify: `docs/architecture-review-report.md` (append section 3)

- [ ] **Step 1: Read all four DB files**

From `schema.js`, extract:
- All table names and their columns
- Which tables have a `school_year` column
- UNIQUE constraints — especially `grades` and `absences`
- Whether `school_year` is part of every composite index

From `migrations.js`, check:
- Are all `ALTER TABLE` ops wrapped in `ensureColumn()` (idempotent)?
- Is any DDL duplicated between `schema.js` and `migrations.js`?
- Are migration version strings unique and forward-only?
- Total migration count

From `init.js`, check:
- Is `journal_mode = WAL` set?
- Is `foreign_keys = ON` set?
- Is init order: `createTables()` → `runMigrations()`?

From `context.js`, check:
- Is there a true singleton (one DB connection shared across all modules)?
- Is the DB file path resolved using Electron's `userData` dir?

- [ ] **Step 2: Append Section 3 to the report**

```markdown
## 3. Database Layer

### Tables Inventory
| Table | Has school_year | UNIQUE constraint | school_year in index |
|---|---|---|---|
[fill in one row per table]

### Migration Health
- Total migrations: [N]
- All use `ensureColumn()`: **[YES/NO — list exceptions]**
- DDL duplicated from schema.js: **[YES/NO — list]**
- Version strings unique: **[YES/NO]**

### Init Checklist
- [ ] `journal_mode = WAL` — **[PASS/FAIL]**
- [ ] `foreign_keys = ON` — **[PASS/FAIL]**
- [ ] Init order `createTables()` → `runMigrations()` — **[PASS/FAIL]**
- [ ] True DB singleton — **[PASS/FAIL]**
- [ ] DB path uses `userData` — **[PASS/FAIL]**

### Findings
[List each finding with severity and file:line]

### Summary
[1-2 sentences]
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture-review-report.md
git commit -m "docs: architecture review — section 3 database layer"
```

---

## Task 4: Auth & Licensing Security

**Files:**
- Read: `main/auth/password.js`
- Read: `main/licensing/service.js`
- Read: `main/licensing/offlineKey.js`
- Read: `main/licensing/deviceFingerprint.js`
- Read: `main/licensing/ownerSync.js`
- Modify: `docs/architecture-review-report.md` (append section 4)

- [ ] **Step 1: Review `password.js`**

Check:
- Hashing algorithm: should be `crypto.scryptSync` with format `scrypt$<salt>$<hash>`
- Salt generation: should be `crypto.randomBytes()`, never a static salt
- Comparison: must use `timingSafeEqual` — any `===` comparison of hashes is a 🔴 Critical finding
- Password complexity: is there any length/complexity enforcement?

- [ ] **Step 2: Review licensing files**

From `offlineKey.js`:
- How is the key signed/verified? Is there a HMAC or RSA signature?
- Can a key be tampered with and still validate? (e.g. if it's just base64 decoded JSON with no signature)
- Is the secret/signing key hardcoded in source? (🔴 Critical if yes)

From `deviceFingerprint.js`:
- What hardware attributes are used for fingerprinting?
- Is the fingerprint stable across reboots and minor hardware changes?

From `service.js`:
- Is license validation done on every restricted IPC call, or only at startup?
- Can a renderer page bypass license checks by calling a different channel?

From `ownerSync.js`:
- Are AWS credentials read from environment variables / `.env`, never hardcoded?
- Is there any retry/backoff logic for failed sync?

- [ ] **Step 3: Append Section 4 to the report**

```markdown
## 4. Auth & Licensing Security

### Password Hashing
- Algorithm: [scryptSync / bcrypt / other]
- Salt: [random per-password / static / none]
- Timing-safe comparison: **[YES/NO]**

### License Key Integrity
- Signing mechanism: [HMAC / RSA / none / base64 only]
- Secret hardcoded in source: **[YES/NO]**
- Validated per-call or only at startup: **[per-call / startup-only]**

### Device Fingerprint
- Attributes used: [list]
- Stable across reboots: **[YES/NO/UNKNOWN]**

### AWS Credentials
- Sourced from env vars: **[YES/NO]**
- Never hardcoded: **[YES/NO]**

### Findings
[List with severity and file:line]

### Summary
[1-2 sentences]
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture-review-report.md
git commit -m "docs: architecture review — section 4 auth and licensing"
```

---

## Task 5: Renderer Architecture — Utilities, Pages, Message System

**Files:**
- Read: `js/utils.js`
- Read: `js/message-system.js`
- Read: `js/ux-enhancements.js`
- Read: all 22 files in `js/pages/`
- Modify: `docs/architecture-review-report.md` (append section 5)

- [ ] **Step 1: Audit `js/utils.js`**

Confirm the following globals are exported and correctly implemented:
- `PERIOD_MAP` — maps `h1`-`h8` and `H1`-`H8` to time strings
- `MORNING_HOUR_MAP` / `AFTERNOON_HOUR_MAP` — maps `H1`-`H4` per period
- `CONSECUTIVE_SLOT_MAP`
- `resolveSlotTime(slot, fallback)`
- `mergeConsecutivePeriods(slots)` — must handle `{time, section}` objects
- `FilterManager` class — must fetch from `window.api.classes.getAll()` and `window.api.subjects.getAll()`

- [ ] **Step 2: Audit each page in `js/pages/`**

For each page JS file, check:

| Check | Look for violation |
|---|---|
| No local PERIOD_MAP copy | `const PERIOD_MAP` or `const hourMap` defined locally |
| No localStorage timetableData parse for dropdowns | `JSON.parse(localStorage.getItem('timetableData'))` used to populate selects |
| Uses FilterManager | Manual `innerHTML` loops for class/subject dropdowns |
| No `alert()` / `window.confirm()` | Raw `alert(` or `confirm(` calls |
| Uses showToast for async ops | Silent async calls with no user feedback |
| Uses showConfirm before delete | Delete handler without `await showConfirm(` |
| Has pagination (if table exists) | Table rendered without `currentPage`/`PAGE_SIZE` |
| Edit button alongside delete | Delete button without a sibling edit button |

Build a violation table:
```
| Page file | alert/confirm | No FilterManager | No pagination | PERIOD_MAP copy | No edit btn |
```

- [ ] **Step 3: Append Section 5 to the report**

```markdown
## 5. Renderer Architecture

### Utils.js Globals
- `PERIOD_MAP` present and correct: **[YES/NO]**
- `MORNING_HOUR_MAP` / `AFTERNOON_HOUR_MAP`: **[YES/NO]**
- `resolveSlotTime()`: **[YES/NO]**
- `mergeConsecutivePeriods()` supports {time, section}: **[YES/NO]**
- `FilterManager` fetches from API (not localStorage): **[YES/NO]**

### Page Violation Matrix
[Paste the violation table — every row is a page file]

### Findings
[List each violation with severity, file:line, and what rule it breaks]

### Summary
[1-2 sentences on overall renderer discipline]
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture-review-report.md
git commit -m "docs: architecture review — section 5 renderer architecture"
```

---

## Task 6: CSS Architecture — Tailwind, RTL, Inline Styles

**Files:**
- Read: `css/tailwind-input.css`
- Grep all HTML files for inline styles
- Grep all JS files for inline `style` assignments
- Modify: `docs/architecture-review-report.md` (append section 6)

- [ ] **Step 1: Read `tailwind-input.css`**

Check:
- Is the `@theme {}` block present with design tokens?
- Is the `@layer components {}` block used for reusable classes?
- Is `@variant dark` targeting `[data-theme="dark"]` (not `prefers-color-scheme`)?
- Are legacy carry-forward sections clearly documented?
- Are physical properties (`left`, `right`, `margin-left`, `padding-right`) present when logical equivalents exist?

- [ ] **Step 2: Grep for inline styles in HTML files**

Search pattern: `style="` across all `.html` files. Record count and offending files.

Expected: zero inline styles. Each occurrence is 🟠 Important.

- [ ] **Step 3: Grep for JS style mutations**

Search pattern: `\.style\.` across all `js/` files. Record count and context.

Expected: zero direct style mutations (should use class toggling instead). Each occurrence is 🟡 Minor unless it's overriding theme tokens.

- [ ] **Step 4: Verify build output is current**

```bash
npm run css:build
git diff css/tailwind-output.css
```

Expected: no diff. If the compiled output is stale (git shows changes), that's 🟠 Important — it means the committed output doesn't match the source.

- [ ] **Step 5: Append Section 6 to the report**

```markdown
## 6. CSS Architecture

### tailwind-input.css Health
- `@theme {}` tokens block: **[YES/NO]**
- `@layer components {}` used: **[YES/NO]**
- Dark mode via `[data-theme="dark"]`: **[YES/NO]**
- Physical properties used instead of logical: **[count instances]**

### Inline Style Violations
- HTML files with `style="`: [N files — list them]
- JS files with `.style.`: [N occurrences — list context]

### Build Output
- `tailwind-output.css` matches input (no stale diff): **[YES/NO]**

### Findings
[List with severity and file:line]

### Summary
[1-2 sentences]
```

- [ ] **Step 6: Commit**

```bash
git add docs/architecture-review-report.md
git commit -m "docs: architecture review — section 6 CSS architecture"
```

---

## Task 7: Test Coverage & CI Health

**Files:**
- Read: `tests/smoke.js`
- Read: `package.json` (scripts section)
- Modify: `docs/architecture-review-report.md` (append section 7)

- [ ] **Step 1: Read `tests/smoke.js`**

Inventory what the smoke test actually checks:
- IPC channel parity (preload vs handlers)
- Module integrity (all require'd files resolve)
- No CDN references in HTML
- Tailwind output file exists and is non-empty
- Legacy CSS cleanup

Note what it does NOT check (gaps):
- DB schema correctness
- Auth logic
- Migration idempotency
- Renderer globals (FilterManager, etc.)

- [ ] **Step 2: Run the smoke test**

```bash
npm run test:smoke
```

Expected: all assertions pass. Record actual output verbatim in the report.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: zero errors. Warnings are acceptable. Record any errors as 🟠 Important.

- [ ] **Step 4: Append Section 7 to the report**

```markdown
## 7. Test Coverage & CI Health

### Smoke Test — What It Covers
- IPC parity: **[YES/NO]**
- Module integrity: **[YES/NO]**
- No CDN refs: **[YES/NO]**
- Tailwind output: **[YES/NO]**
- Legacy CSS cleanup: **[YES/NO]**

### Smoke Test — Gaps (Not Covered)
- DB schema correctness: ❌ not tested
- Migration idempotency: ❌ not tested
- Auth password hashing: ❌ not tested
- Renderer globals (FilterManager, PERIOD_MAP): ❌ not tested
- [Add any others found]

### Smoke Test Result
```
[paste actual output of npm run test:smoke]
```

### Lint Result
```
[paste actual output of npm run lint]
```

### Findings
[List with severity — e.g. test gaps that hide known risk areas]

### Recommendations
- Add integration test: DB migration idempotency (run migrations twice, assert no error)
- Add integration test: password hash + timingSafeEqual round-trip
- Add smoke assertion: `FilterManager` class exported from `js/utils.js`
- Add smoke assertion: `showConfirm` exported from `js/message-system.js`

### Summary
[1-2 sentences on test health]
```

- [ ] **Step 5: Commit**

```bash
git add docs/architecture-review-report.md
git commit -m "docs: architecture review — section 7 test coverage"
```

---

## Task 8: Reports, Notifications & Supporting Subsystems

**Files:**
- Read: `main/reports/engine.js`
- Read: `main/reports/letterhead.js`
- Read: `main/reports/identity.js`
- Read: `main/notifications/dispatcher.js`
- Read: `main/notifications/store.js`
- Read: `main/notifications/templates.js`
- Read: `main/print-window.js`
- Modify: `docs/architecture-review-report.md` (append section 8)

- [ ] **Step 1: Audit the report engine**

From `engine.js` + supporting files:
- Is the PDF pipeline deterministic (same input → same output)?
- Does it use `print-window.js` correctly (one shared window, not spawning new windows per report)?
- Are report templates sanitizing user data before injecting into HTML (XSS risk)?
- Is there error handling if a report fails (does the print window get closed on error)?

- [ ] **Step 2: Audit the notification system**

From `dispatcher.js`, `store.js`, `templates.js`:
- Are notifications persisted to SQLite via `store.js` (not only in-memory)?
- Is there a schema migration for the notifications table, or is it only in `notifications/schema.js`?
- Are template strings interpolated safely (no raw `innerHTML` with user data)?
- Is there a read/unread state tracked in the DB?

- [ ] **Step 3: Append Section 8 to the report**

```markdown
## 8. Reports & Notifications

### Report Engine
- Uses shared print window (not per-report): **[YES/NO]**
- User data sanitized before HTML injection: **[YES/NO]**
- Error handling closes print window on failure: **[YES/NO]**

### Notification System
- Persisted to SQLite: **[YES/NO]**
- Notification schema in main migrations or own file: **[migrations.js / notifications/schema.js / both]**
- Template strings XSS-safe: **[YES/NO]**
- Read/unread state tracked: **[YES/NO]**

### Findings
[List with severity and file:line]

### Summary
[1-2 sentences]
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture-review-report.md
git commit -m "docs: architecture review — section 8 reports and notifications"
```

---

## Task 9: Final Summary & Prioritized Remediation

**Files:**
- Modify: `docs/architecture-review-report.md` (append final section)

- [ ] **Step 1: Tally all findings across all sections**

Count findings by severity:
- 🔴 Critical: N
- 🟠 Important: N
- 🟡 Minor: N
- 🟢 Good: N

- [ ] **Step 2: Write the prioritized remediation backlog**

Group findings into 3 sprints:

**Sprint 1 — Fix immediately (all 🔴 Critical):**
List each with: file:line, what to change, why it matters.

**Sprint 2 — Fix before next release (all 🟠 Important):**
List each with: file:line, what to change.

**Sprint 3 — Cleanup sprint (🟡 Minor):**
List as a bullet list, grouped by subsystem.

- [ ] **Step 3: Append the final section**

```markdown
---

## 9. Executive Summary

### Findings Tally
| Severity | Count |
|---|---|
| 🔴 Critical | N |
| 🟠 Important | N |
| 🟡 Minor | N |
| 🟢 Good | N |

### Overall Assessment
[2-3 sentences: What is the architectural health of this codebase? What are the strongest areas? What is the highest-priority risk?]

### Sprint 1 — Fix Immediately
[List all Critical findings with file:line and fix description]

### Sprint 2 — Fix Before Next Release
[List all Important findings with file:line and fix description]

### Sprint 3 — Cleanup Sprint
**IPC Layer:**
- [finding]

**Renderer:**
- [finding]

**CSS:**
- [finding]

**Tests:**
- [finding]

---
*Review completed: 2026-04-08*
*Plan: `docs/superpowers/plans/2026-04-08-architecture-review.md`*
```

- [ ] **Step 4: Final commit**

```bash
git add docs/architecture-review-report.md
git commit -m "docs: complete architecture review report"
```

---

## Self-Review

**Spec coverage check:**
- [x] Process boundary (Electron security) → Task 1
- [x] IPC parity + helper usage → Task 2
- [x] DB schema + migrations + pragmas → Task 3
- [x] Auth password hashing + timing-safe compare → Task 4
- [x] Licensing key integrity + AWS creds → Task 4
- [x] Renderer utilities (FilterManager, PERIOD_MAP, resolveSlotTime) → Task 5
- [x] Message system compliance (no alert/confirm, showToast, showConfirm) → Task 5
- [x] Pagination, CRUD completeness (edit + delete) → Task 5
- [x] CSS (inline styles, RTL, build output staleness) → Task 6
- [x] Smoke test coverage and gaps → Task 7
- [x] Lint health → Task 7
- [x] Report engine XSS + window lifecycle → Task 8
- [x] Notification persistence and template safety → Task 8
- [x] Prioritized remediation backlog → Task 9

**Placeholder scan:** No TBDs, no "implement laters", no "similar to Task N" references. Every step shows exact commands or exact structure to write.

**Type consistency:** No type signatures in this plan — it's a review plan, not a feature implementation. File references are consistent throughout.
