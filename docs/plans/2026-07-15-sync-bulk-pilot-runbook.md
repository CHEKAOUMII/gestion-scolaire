# Sync bulk-capture pilot runbook

| Field | Value |
|-------|-------|
| **Date** | 2026-07-15 |
| **Goal** | Deploy exact bulk capture safely; clear legacy `_bulk` outbox risk before broad rollout |
| **Related** | [SOLID remediation plan](./2026-07-15-solid-remediation-plan.md) |

---

## Background

Older builds could write **summary** outbox rows (`row_data` contains `"_bulk":true`) and later expand them by reading **all rows for a table/year**. That is unsafe.

New builds:

- Write **one outbox row per mutated row** for bulk channels.
- Treat legacy summaries without exact keys as **errors** (retry / quarantine), never full-table expand.

This runbook covers **ops pilot** steps only.

---

## Prerequisites

- School device has a local `gestion-scolaire.db` (Electron `userData`).
- Operator can run Node with `better-sqlite3` (same ABI as the app, or rebuild).
- Prefer **backup** of the DB before quarantine apply.

Typical Windows path:

```text
%APPDATA%\gestion-scolaire\gestion-scolaire.db
```

---

## Step 0 — Backup

Use the in-app backup/export if available, or copy the DB file while the app is closed:

```powershell
copy "%APPDATA%\gestion-scolaire\gestion-scolaire.db" "D:\backups\gestion-scolaire-pre-pilot.db"
```

---

## Step 1 — Baseline report (report-only)

On the pilot device (app can be closed for a clean read):

**Important:** use Electron’s Node (native `better-sqlite3` is built for Electron 35, not system Node).

```bash
npm run sync:pilot-report
```

Or explicit path:

```bash
npm run sync:pilot-report -- --db="%APPDATA%\gestion-scolaire\gestion-scolaire.db"
```

JSON for logging:

```bash
npm run sync:pilot-report -- --json > pilot-baseline.json
```

If you must call the file directly:

```bash
cross-env ELECTRON_RUN_AS_NODE=1 npx electron scripts/sync-legacy-bulk-pilot.js
```

### What to record

| Metric | Meaning |
|--------|---------|
| `pendingCount` | All pending outbox rows |
| `bulkPendingCount` | Pending legacy `_bulk` summaries |
| `failedCount` | Failed rows (includes prior errors) |
| `classification.exact` | Bulk rows with recoverable exact keys |
| `classification.empty` | Valid empty mutations |
| `classification.quarantine` | Cannot expand safely — need repair |
| `byChannel` / `byTable` | Where risk is concentrated |

**Exit codes**

| Code | Meaning |
|------|---------|
| 0 | Report OK and no pending bulk (or apply finished clean) |
| 3 | Report-only: pending legacy bulk still present |
| 1–2 | DB missing / native module failure |

---

## Step 2 — Install / upgrade pilot build

1. Install the build that contains exact bulk capture.
2. Restart the app; admin signs in **online** if cloud sync is used.
3. Confirm sync enabled and push/pull timers running (Settings → Sync).

---

## Step 3 — Exercise critical bulk paths (pilot checklist)

On the pilot school year, perform small real operations (or sandbox year):

| Action | Expected outbox |
|--------|-----------------|
| Student bulk import (few rows) | N `PUT` rows on `students`, **no** `_bulk` |
| Grades bulk import | N `PUT` on `grades`, no `_bulk` |
| Absences bulk import | N `PUT` on `absences`, no `_bulk` |
| Optional: teacher import, exam attendance bulk | Same rule |

Re-run:

```bash
node scripts/sync-legacy-bulk-pilot.js
```

**Pass criteria for new writes**

- `bulkPendingCount` does not increase from new bulk UI actions.
- New pending rows are ordinary row-level entries (inspect a sample `row_data` — should include entity fields / ids, not only `_bulk` + `args_summary`).

---

## Step 4 — Handle pre-existing legacy bulk

### 4a Exact / empty

- `exact`: next push cycle should expand by ids/keys and mark sent.
- `empty`: may be marked sent without remote writes.

Trigger a push (admin “Sync now” or wait for interval).

### 4b Quarantine needed

These cannot be expanded safely. Options:

1. **Re-snapshot** the affected table/year (in-app snapshot cycle if enabled), or  
2. **Re-import** the affected dataset so exact PUTs are enqueued, or  
3. Mark quarantine so they stop blocking forever:

```bash
# ONLY after review — mutates outbox
node scripts/sync-legacy-bulk-pilot.js --apply-quarantine
```

Quarantined rows get:

```text
status = failed
last_error = legacy_bulk_quarantine:<reason>
```

They will **not** push until repaired via re-snapshot / re-import.

---

## Step 5 — In-app monitoring (admin)

If the build exposes IPC:

| Call | Purpose |
|------|---------|
| `window.api.sync.getOutboxHealth()` | Live counters |
| `window.api.sync.classifyLegacyBulk()` | Report-only classification |
| `window.api.sync.quarantineLegacyBulk()` | Apply quarantine (admin write) |

`sync.getStatus()` also includes:

- `bulkPendingCount`
- `legacyQuarantineFailed`
- `pilotClean`

---

## Step 6 — Go / no-go for broader rollout

**Go** when for each pilot device:

- [ ] Baseline + post-upgrade reports archived  
- [ ] New bulk actions produce no new `_bulk` summaries  
- [ ] `bulkPendingCount == 0` or only documented quarantine residuals with repair plan  
- [ ] Multi-device sample: bulk import on A appears on B without wiping unrelated rows  
- [ ] No spike in unexplained `failed` rows unrelated to quarantine  

**No-go / hold** if:

- New `_bulk` rows appear after upgrade  
- Full-year data thrash after bulk import  
- Push marks failures as success (should not happen on this build)

---

## Rollback note

Rolling back to a build that only understands old `_bulk` summaries must not consume new per-row outbox formats incorrectly. Prefer:

1. Drain / clear outbox after backup, or  
2. Keep devices on the new build until the outbox is clean.

---

## Commands quick reference

```bash
# Safe report (via Electron Node — correct ABI)
npm run sync:pilot-report

# JSON for tickets / SIEM
npm run sync:pilot-report -- --json

# Explicit DB
npm run sync:pilot-report -- --db="D:\path\gestion-scolaire.db"

# Mutating quarantine (after review)
npm run sync:pilot-report -- --apply-quarantine
```
