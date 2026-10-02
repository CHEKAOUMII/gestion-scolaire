# Import Center — Durable Session Decision

**Feature:** `smart-central-import-center`  
**Package:** 7.2  
**Decision date:** 2026-07-15  
**Maps to requirements:** 12.1–12.5 (renderer-memory default; no Jobs while unproven)

## Decision

**Default remains renderer-memory-only `ImportSession`.**

The center does **not** create:

- `import_jobs`
- `import_files`
- `import_errors`
- or any equivalent durable Job/session tables

Incomplete sessions are **not** restored after page reload. Transient `File` objects and raw samples stay in memory only.

## Why memory-first stays the default

1. **Privacy** — Import files often contain student PII; durable queue storage needs retention, access control, and purge rules that do not exist yet.
2. **Scope proven without Jobs** — Classification, preflight, review, serial orchestration, partial success, and compact logging work without a Job database.
3. **Existing stores already cover post-success needs** — `DataSourceRegistry` (readiness), `systemLogs` (compact summaries), SQLite business tables (written data). Duplicating lifecycle into Jobs adds complexity without proven resume value.
4. **Atomicity limits** — Outcomes are per file/type; there is no supported cross-type rollback. Durable “resume mid-batch” would require clearer recovery semantics first (see `atomicity-matrix.md`).
5. **Requirement 12** — Explicitly defers durable session design until need for resume/audit is documented and approved.

## What is allowed today (not session storage)

| Store | Role | Not a session store because |
|---|---|---|
| Renderer `ImportSession` | Active queue/review/execute | Lost on reload |
| `DataSourceRegistry` | Successful source readiness by year | Metadata only; no file queue |
| `systemLogs` / `logImport` | Compact operation summaries | No per-file lifecycle restore |
| SQLite domain tables | Business data after write | Not import job state |
| `BackupManager` | Full backup/restore | Separate from import DAG |

## Evidence required before any durable Jobs design

A **separately approved** design must answer all of the following before schema work:

1. **Resume use case** — Who needs to resume incomplete multi-file imports, and how often?
2. **Retention** — Max age of incomplete jobs; purge policy; school-year boundaries.
3. **Privacy** — Whether fingerprints/names/samples may be stored; encryption at rest; who can read jobs.
4. **Scope of durability** — Metadata-only vs payload; never store raw `File` blobs by default.
5. **Failure/recovery model** — Interaction with partial success, blocked dependents, and absence `replaceByYear` limits.
6. **Sync** — Whether jobs sync multi-device and how that interacts with outbox/authority.
7. **UX** — What reload shows; conflict if user starts a new session while an old job exists.
8. **Migration** — Versioned DDL, no silent expansion of attack surface, rollback plan for the feature flag.

Until that approval exists, agents must **not** add Job tables or durable incomplete-session IPC.

## Explicit non-goals

- Automatic backup on import failure (user uses backup section deliberately).
- Reconstructing the queue from system logs.
- Replacing `DataSourceRegistry` with a Job store.

## Related docs

- `docs/import-center/contracts.md`
- `docs/import-center/atomicity-matrix.md`
- `docs/import-center/migration-notes.md`
- Requirements 12.1–12.5 in `.kiro/specs/smart-central-import-center/requirements.md`
