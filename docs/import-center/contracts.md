# Import Center Contracts

**Feature:** `smart-central-import-center`  
**Scope:** Packages 0–7 (implemented)  
**Status:** Authoritative contract notes for implementation  
**Related:** `migration-notes.md`, `persistence-decision.md`, `atomicity-matrix.md`, `signatures.md`

## Boundary

The center provides smart multi-file intake, classification, preflight, review, serial orchestration, and post-import hooks. It does **not**:

- remove manual write signatures (`importStudents`, `importGrades`, `importAbsences`, `importFetXml`, `importAgentXml`, `importStudentStatus`, `runImport`, `handleImport`);
- introduce `import_jobs` / `import_files` / `import_errors` tables (see `persistence-decision.md`);
- require serialization of a `File` object or raw file content to durable storage;
- allow silent import on select, drop, or contextual navigation (confirm first).

| Concern | Storage | Notes |
|---|---|---|
| `ImportSession` / queue | Renderer memory | Lost on reload |
| Transient `File` | In-memory reference only | Never `localStorage` / SQLite |
| Classification / diagnostics | Attached to session items | Analysis first |
| Preflight result shape | In-session | `decisionVersion` for invalidation |
| Business writes | Manual importers + guarded smart execute | Per-file/type unit; no cross-type rollback |
| Orchestrator | Renderer memory | Serial topo order; partial success |
| `DataSourceRegistry` | Existing readiness metadata | Not a Job/session store |
| System logs | Compact summaries | Not a session database |
| Backup/restore | Separate UI and API | Outside import DAG |

## Enumerations

Defined in `js/import-center/import-contracts.js`:

- **ImportSourceType:** `students` | `grades` | `absences` | `fet` | `agent_xml` | `student_status` | `generic_csv_xlsx` | `unknown`
- **ImportSessionStatus:** `collecting` | `analyzing` | `reviewing` | `ready` | `importing` | `completed` | `cancelled`
- **ImportFileStatus:** `queued` | `analyzing` | `needs_review` | `ready` | `importing` | `succeeded` | `failed` | `skipped` | `blocked`
- **DiagnosticStage:** `reading` | `classification` | `preflight` | `dependency` | `write`
- **DiagnosticSeverity:** `info` | `warning` | `error`

## Core shapes

### ImportSession

Transient only. Fields: `id`, `createdAt`, `expectedYear`, `sourceContext`, `status`, `files[]`, `dependencyGraph`, `totals`, `report`.

`sourceContext.mode`: `drop` | `file_picker` | `contextual_shortcut` | `manual`.  
Query `type` / `year` / `source` are **hints**, never auto-execute.

### ImportFileItem

Per-file independent state. Includes identity (`id`, `name`, `extension`, `size`), transient `file`, optional session-local `fingerprint`, `status`, classification (`detectedType`, `selectedType`, `confidence`, `evidence`, `alternatives`), metadata (`detectedYear`, `detectedTerm`, `sheetNames`, `recordEstimate`), `diagnostics`, `preflight`, `dependencies`, `progress`, `result`, `decisionVersion`, `retryCount`.

Serialization helpers (`serializeFileItemMeta`, `serializeSessionMeta`) **omit** `file` and raw content.

### ClassificationResult

```text
type, confidence, evidence[], alternatives[], metadata, needsReview, reviewReasons[]
```

Content evidence is primary. Filename / extension / context are auxiliary.

### Diagnostic

```text
code, severity, stage, message, fileId, sheet?, row?, field?, rule?, action
```

Actions: `inform` | `review` | `reanalyze` | `change_type` | `change_year` | `skip` | `retry` | `none`.

### PreflightResult

```text
valid, analyzedAt, selectedType, selectedYear, selectedTerm, sheetsRead, elementsRead,
recordEstimate, rowOutcomes[], warnings[], errors[], unresolvedNames[], unknownEntities[],
duplicates[], dependencies[], preview[], decisionVersion, executable?, zeroValidRows?
```

`analyze` is read-only. `execute` requires explicit confirmation + `allowExecute`.

### RowOutcome / FileImportResult / ImportSessionReport

Defined for unified reporting. Totals must equal item outcomes when execution completes.

## Confidence policy (fixed constants)

| Condition | Decision |
|---|---|
| score ≥ `0.85` | High confidence — proposed type; still needs preflight + confirmation before write |
| `0.60` ≤ score < `0.85` | Medium — needs review |
| score < `0.60` | Low — user must choose type/destination |
| top-two gap < `0.10` | Ambiguous — `needs_review` regardless of top score |

Classification alone **never** marks an item ready for production write without preflight/review rules.

## Manual compatibility

Preserved input IDs:

- `students-file-input`
- `grades-file-input`
- `absences-file-input`
- `fet-file-input`
- `status-file-input`
- `agent-xml-file-input`

Preserved functions remain callable on the page. Smart intake classifies and preflights; manual cards still use `runImport` / `handleImport`.

## Logging and readiness

- `logImport` / `window.api.systemLogs.add` — compact operation summaries (not session store).
- `DataSourceRegistry` — readiness by school year after successful import (existing boundary).
- `CrossSourceValidator.validateAfterImport` — post-import only; `{ valid, warnings }`.

## Package map

| Packages | Deliverable |
|---|---|
| 0 | Contracts, fixtures, signatures |
| 1 | Central UI structure |
| 2 | Session + classifier |
| 3 | Adapters + preflight + row validation |
| 4 | Orchestrator + partial success |
| 5 | Atomicity matrix + `absences:replaceByYear` + fingerprints |
| 6 | Contextual shortcuts + post-import integration |
| 7 | Cleanup (`initDropZone` removed) + persistence decision |
