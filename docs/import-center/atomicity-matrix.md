# Import Center — Atomicity Matrix

**Feature:** `smart-central-import-center`  
**Package:** 5.1  
**Audited against:** `js/pages/settings-imports.js`, `main/ipc/*`, `main/repos/*`, `preload.js`, `js/backup.js`, `js/shared/fet-import.js`  
**Date:** 2026-07-15

## Scope and non-claims

| Claim | Status |
|---|---|
| Cross-type distributed transaction for a mixed smart batch | **Not supported** — do not claim |
| Automatic full rollback of a mixed batch | **Not supported** |
| Per-file/type outcome as unit of success | **Supported** (Package 4 orchestrator) |
| Backup/restore as recovery for catastrophic failure | **Supported**, separate from import DAG (`js/backup.js` / `window.api.system`) |

Recovery default when a write fails after partial multi-file progress: re-import the failed type after backup if needed; successful siblings are **not** re-run by the orchestrator.

## Classification legend

| Class | Meaning |
|---|---|
| **append-only** | Inserts new rows; does not clear year/type first |
| **upsert-like** | Insert-or-update / replace by unique key within one call |
| **destructive replacement** | Deletes existing data for a scope, then writes |
| **transaction-protected** | SQLite `db.transaction` covers the multi-step mutation for that operation |

## Manual / adapter write boundaries

| Adapter / path | Manual function | Primary IPC / storage | Class | Notes / known limitation | Recovery |
|---|---|---|---|---|---|
| `students` | `importStudents` | `students:addBulk` | upsert-like, transaction-protected (bulk) | UPSERT by student code/year. Does not delete departed students automatically; may surface departed panel. | Re-run students import; correct departed statuses manually if needed |
| `grades` | `importGrades` | `grades:saveBulk` | upsert-like, transaction-protected (bulk) | `INSERT OR REPLACE` / upsert by student+subject+semester+year. Clear UI may use `grades:deleteBySemester` separately (data management, not import path). | Re-run grades file(s) for semester; optional semester delete only from data management with confirmation |
| `absences` | `importAbsences` + staged batch in `handleImport` | historically `absences:deleteByYear` then `absences:saveBulk` | **destructive replacement** split across **two IPC calls** | Proven gap: if delete succeeds and save fails, year absences are empty. Staged prep in memory is good; apply step was not atomic. | **Package 5.2:** use `absences:replaceByYear` (delete+save one transaction). Recovery: re-run absences import; restore from backup if needed |
| `fet` | `importFetXml` | `timetable:save` (+ local teacher matching) | upsert-like / replace timetable blob for year | Timetable stored as year document; overwrites prior FET data for year when saved. Name matching may remain partial. | Re-import FET; resolve tafwij matches; backup before large timetable changes |
| `agent_xml` | `importAgentXml` | `teachers:*` bulk paths (ministry staff) | upsert-like | Teachers/ministry metadata; not student grades. | Re-import agent XML; teachers `deleteByYear` only via data management |
| `student_status` | `importStudentStatus` | `students:addBulk` (status fields) | upsert-like | Updates status on existing/new students; not a full wipe. | Re-import status file; reset statuses via data management if required |

## Supporting operations (not smart-queue nodes)

| Operation | API | Class | Limitation | Recovery |
|---|---|---|---|---|
| Clear students (UI) | `students:deleteByYear` | destructive | Year-scoped delete | Backup then re-import students |
| Clear grades semester | `grades:deleteBySemester` | destructive | Semester-scoped | Re-import grades |
| Clear absences | `absences:deleteByYear` | destructive | Year-scoped | Re-import absences |
| Clear teachers | `teachers:deleteByYear` | destructive | Year-scoped | Re-import agent XML |
| Clear timetable | `timetable` save/clear | destructive/replace | Year timetable | Re-import FET |
| System log | `systemLogs:add` | append-only | Not a session store | N/A |
| Readiness | `DataSourceRegistry.update` | localStorage metadata | Not a Job DB | Re-import source to refresh |
| Backup/restore | `BackupManager` / `window.api.system` | full snapshot | Separate from import DAG; not auto-triggered | Restore snapshot |

## Staged absence path (detail)

1. **Read/parse** all absence files into `stagedAbsences` in renderer memory.  
2. **Abort apply** if any file failed validation (`failedFiles > 0`).  
3. **Apply (legacy):** `deleteByYear(year)` then `saveBulk(stagedAbsences)` — **not atomic across IPC**.  
4. **Apply (Package 5.2):** `absences:replaceByYear(year, stagedAbsences)` — single main-process transaction.

Limits even with 5.2:

- No cross-type rollback with students/grades/FET in the same smart batch.  
- Sync outbox capture runs inside the same SQLite transaction for replace; if process dies mid-transaction SQLite rolls back; if process dies after commit, data is consistent for that year.  
- Does not claim multi-device distributed atomicity.

## Sync capture notes

Write channels used by import must remain in `CHANNEL_REGISTRY` (`main/sync/capture.js`). Bulk/replace channels use `captureMode: 'explicit'` + `exclude: true` with repo-level capture.

## Decision for Package 5.2

| Gap | Proven? | Action |
|---|---|---|
| Absences delete-then-save across two IPC calls | **Yes** | Add `absences:replaceByYear` + preload + capture registry; route import apply through it when available |
| Cross-type smart batch transaction | No product requirement proven safe | **No new IPC** |
| Students/grades bulk already transactional per call | N/A | No new IPC |
| FET/agent paths | Year overwrite is intentional single-doc save | Document only; no new IPC |

## Explicit non-goals remaining

- No `import_jobs` / durable session tables.  
- No automatic backup on import failure.  
- No broad “undo import batch” API.
