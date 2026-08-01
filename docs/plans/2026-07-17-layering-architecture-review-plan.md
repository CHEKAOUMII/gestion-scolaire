# Layering Architecture Review & Remediation Plan

**Date:** 2026-07-17  
**Type:** Architecture review + phased fix plan  
**Scope:** Dependency direction and layer responsibility (Electron + SQLite + Firebase sync)  
**Not in scope:** Naming, formatting, style, full security audit, big-bang rewrite

---

## 1. Context

This document records a layering review of the codebase and a prioritized remediation plan. A layering “violation” is only worth fixing if it causes real pain later: harder testing, harder swapping of SQLite/Firebase, or tangled debugging.

**Expected layers (adapted to this app):**

| Layer | Responsibility |
|---|---|
| Renderer / UI | Views, forms, page controllers. Talks only through `window.api`. |
| IPC bridge | `preload.js` + thin `ipcMain` handlers. Whitelisted contract; no domain SQL/rules. |
| Business logic / services | Rules (attendance, merge, lockout, validation). Framework-agnostic when pure. |
| Data access | All SQL behind repository-style functions. |
| Sync engine | Outbox, push/pull, conflict, Firestore transport. Isolated from pure domain rules. |

---

## 2. How the codebase actually maps

The five-layer model fits **only after remapping**. There is **no** first-class `main/services/` package.

| Expected layer | Actual location | Health |
|---|---|---|
| **Renderer / UI** | `*.html`, `js/pages/*`, `js/shared/*`, `app.js` | Strong process boundary |
| **IPC bridge** | **Thin contract:** `preload.js`. **Fat handlers:** most of `main/ipc/*.js` | Contract OK; handlers too thick |
| **Business logic** | (1) pure `js/*` modules, (2) rules inside IPC, (3) bits in auth/licensing/reports | No unified main service layer |
| **Data access** | Only `main/repos/{students,grades,absences}.js`; rest of SQL in IPC | Incomplete |
| **Sync (remote)** | `main/sync/*` (engine split), `capture.js`, `main/firebase/*` | Engine modularized; capture still central |

**Important:** Treat most of `main/ipc/*` as **IPC + ad-hoc service + ad-hoc repository**—not as a pure bridge. `Architecture.md` already states this: domain logic is “grouped behind IPC modules that mostly talk directly to SQLite.”

### Metrics snapshot (at review time)

| Signal | Value |
|---|---|
| IPC files with `.prepare()` SQL | ~26 of 37 |
| Domains with dedicated repos | 3 (students, grades, absences) |
| `main/services/` exists | No |
| Largest fat IPC | `auth.js` (~827), `institution.js` (~765), `orientation.js` (~611), `exams.js` (~539) |
| Capture choke point | `main/sync/capture.js` (~1000 lines) |
| Sync engine | Already split (`push` / `pull` / `apply` / `outbox` / `transport`) |

---

## 3. Findings

| File / Module | Layer | Issue | Why it matters | Suggested fix |
|---|---|---|---|---|
| `main/ipc/*` (26/37 files use `.prepare()`; only students/grades/absences use repos) | IPC (acting as data + rules) | **Fat IPC is the default.** Handlers own SQL, validation, domain rules, and often sync-capture. Worst: `exams.js`, `staff.js`, `orientation.js`, `auth.js`, `institution.js`. | Unit-testing domain rules requires Electron IPC + real SQLite. Swapping storage or reusing rules outside Electron is expensive. | Keep the thin pattern from `students.js` → `repos/students.js`: IPC = auth + field validation + map response; all SQL in repos. Apply next to high-churn domains. |
| *(missing)* `main/services/` | Business logic | **No main-process service layer.** Login policy, orientation merge, exam generation, institution setup live in IPC files. | Rules cannot be unit-tested without the IPC surface; hard to share the same rule across channels. | Extract pure or db-injected services (e.g. `orientationService.mergeRows(db, …)`). IPC becomes a one-line orchestrator. |
| `main/repos/{students,grades,absences}.js` | Data access | **Repos depend upward on sync** (`require('../sync/capture')`, `entity-registry`). Atomic outbox writes are inlined in bulk methods. | Data layer cannot be tested without the sync capture stack. Dependency direction is **data → sync** (sideways/up). | Inject capture hooks (`onUpsert`, `onDelete`) or a small `OutboxWriter` port. Repos stay SQL-only; sync wires hooks at composition time. Keep same-transaction atomicity. |
| `main/ipc/auth.js` + `main/auth/firebase-auth-service.js` | IPC + auth + remote + data | **Auth is a multi-layer god path.** Session map, login throttle SQL, PIN/password, Firebase sign-in, Firestore profile, local `users`/`sync_config` writes, sync defaults. | Auth expiry vs network vs bad password vs local DB failures are hard to isolate. Regression tests need Firebase + SQLite + session maps. | Split: (1) pure lockout/session policy, (2) `users`/`login_attempts` repo, (3) Firebase auth adapter, (4) thin IPC that translates errors to stable codes. |
| `main/sync/capture.js` (~1000 lines) | Sync (cross-cutting) | **Capture is the write-path choke point:** giant `CHANNEL_REGISTRY` + outbox SQL + row resolution + retention + push debounce. | New write channels are high-risk (miss a registry entry → silent no-sync). Debugging missed sync requires registry + handler + repo + engine. | Shrink registry to metadata only; extend `captureMode: 'explicit'` for bulk; move retention/cleanup out of capture. |
| Large page controllers (`exams-proctors` ~5.6k, `student-profile` ~4.4k, `settings-imports` ~4.3k, `timetable` ~3k) | Renderer / UI | Pages accumulate orchestration + derived transforms. Proctor solver / risk / averages / import-center are correctly pure—pages still own too much wiring. | Hard to test without a browser; high merge-conflict risk; easy to re-inline pure logic. | Continue extraction pattern: pure modules under `js/` + thin page glue. Do not add more domain math into page files. |
| `main/db/context.js`, `main/licensing/offlineKey.js` | Data / licensing | **Electron `app.getPath('userData')` inside lower modules.** | Running repo/license tests in plain Node needs Electron mocks for paths. | Inject path/baseDir from bootstrap (`main.js`); keep modules free of `require('electron')` where possible. |
| `main/auth/permissions.js` | Business rules (mostly pure) | Static role maps are pure, but one path queries `page_role_access` via SQL when a `db` is passed. Mild leakage. | Role-override tests need SQLite. | Keep static maps pure; move “load overrides from DB” to a small repo or caller. |

### Intentionally not flagged

| Area | Why skip |
|---|---|
| `preload.js` size | Large but still a thin whitelist (`ipcRenderer.invoke` only). |
| Sync `engine/*` split (WP3) | Facade + push/pull/apply/outbox/transport with injectable deps is the right shape. |
| Pure renderer modules (`student-risk`, `student-averages`, `cc-rules`, `import-center/*`, proctor-v3) | Correct layering—framework-free, dual-export, unit-testable. |
| `ipc-helpers` error sanitization | Good boundary: strips `SQLITE_*`, stacks; returns Arabic / `INTERNAL_ERROR` to UI. |
| Process isolation | `contextIsolation`, no Node/SQLite/Firebase in renderer. |
| One-off `localStorage` timetable migration | Temporary bridge, not inverted architecture for new work. |

---

## 4. Dependency direction (summary)

**Renderer → IPC contract is healthy.** Pages call `window.api.*` only; they do not import `better-sqlite3`, Electron main modules, or Firebase SDKs.

**Main-process direction is inverted and collapsed for most domains:**

```
Ideal:   UI → preload → IPC (thin) → services (rules) → repos (SQL)
                                              ↘ sync (outbox / push / pull)

Actual:  UI → preload → IPC (SQL + rules + capture hooks)
                              ↘ repos (3 domains only) → sync/capture   ← upward dep
                              ↘ firebase-auth-service (SDK + SQL)
                              ↘ sync engine (OK when invoked from lifecycle / sync IPC)
```

There is **no consistent downward-only service layer**. The partial repo migration (students/grades/absences) shows the intended direction, but most write domains still put SQL in IPC. Sync capture is woven into data writes rather than sitting cleanly above/beside repositories. Auth is a vertical slice that crosses IPC, SQLite, Firebase Auth, and Firestore in one module family.

**Error flow is better than data flow:** `handleRead` / `handleWrite` catch, log, and sanitize before the renderer—raw driver errors generally do **not** reach the UI.

### Testability snapshot

| Kind of logic | Standalone unit test today? | Blocker |
|---|---|---|
| Grade averages / risk / CC rules / proctor solver / import graph | Yes | None (good) |
| Student bulk upsert SQL + uniqueness | Partial | Needs DB + capture mocks |
| Exam generation, staff writes, orientation merge | No | SQL + rules inside IPC |
| Login / lockout / PIN / Firebase-first login | No | Auth god path |
| Sync push/pull scheduling | Partial | Engine split helps; still DB + transport |

---

## 5. Top 3 highest-leverage fixes

Ordered by impact on coupling and testability—not by file order.

### Fix 1 — Finish the repo pattern for high-churn domains

**Impact:** Highest immediate payoff; path already proven by students / grades / absences.

- Move SQL out of `main/ipc/exams.js`, `staff.js`, `orientation.js` (and similar) into `main/repos/*`.
- Leave IPC as: role check → `requireFields` / `requireSchoolYear` → repo call → DTO mapping.
- **Rule for new work:** no new `.prepare()` in `main/ipc/` except temporary shims.

**Unlocks:** unit tests for SQL and domain writes without spinning full IPC registration.

### Fix 2 — Invert capture dependency (repos must not import sync)

**Impact:** Unlocks true unit tests for data access; clarifies sync vs local DB ownership.

- Repos accept optional hooks or an `outbox` port: `captureUpserts(table, rows)`, `captureDeletes(...)`.
- Composition root (IPC registration or a thin service) injects real capture; tests inject no-ops or fakes.
- Keep **same-transaction** atomicity—hooks run *inside* `db.transaction`, not after IPC returns.

Without this, every repo extraction re-creates the “data depends on sync” knot.

### Fix 3 — Carve a real auth service out of IPC

**Impact:** Highest reduction of multi-dependency debugging pain on the riskiest daily path (login/session).

- Pure: lockout schedule, session TTL checks, role resolution (static).
- Adapter: Firebase Auth + Firestore profile.
- Repo: `users`, `login_attempts`, session persistence in `settings`.
- IPC: translate to stable `{ success, code, error }` only.

Same pattern later for `institution.js` linking/setup—but auth is the daily path.

---

## 6. Phased remediation plan

Do **not** rewrite the whole tree. Execute in order; each phase must leave the app green (`npm run test:smoke`, existing domain tests).

### Phase A — Guardrails (no behavior change)

| Task | Detail | Done when |
|---|---|---|
| A1 | Document layering rule in `Agents.md` / checklist: new write channels = repo SQL, no new IPC `.prepare()` | Checklist updated |
| A2 | Optional ESLint/smoke guard: fail or warn on new `.prepare(` under `main/ipc/` for touched files (or document review gate) | Team can enforce on PR |
| A3 | Inventory IPC modules by SQL density; pick next 3 domains after students/grades/absences | List checked into this plan (below) |

**Suggested extraction order (after the three existing repos):**

1. `exams` (+ exam proctors/rooms/attendance tables already in `exams.js`)
2. `staff` / teachers
3. `orientation`
4. `daily-report` / `system-tags` (smaller, good practice targets)
5. `auth` (policy + users repo—Phase C)

### Phase B — Repo extraction + capture ports

| Task | Detail | Done when |
|---|---|---|
| B1 | Introduce capture port interface (e.g. `createCaptureHooks()` / no-op for tests) | Interface exists; students/grades/absences refactored to use injection without behavior change |
| B2 | Extract `main/repos/exams.js` from `main/ipc/exams.js`; keep IPC thin | Smoke green; exams CRUD/import still works |
| B3 | Extract `main/repos/staff.js` (or teachers + absences as needed) | Smoke green |
| B4 | Extract orientation SQL/merge data access from `main/ipc/orientation.js` | Smoke green; orientation import still works |
| B5 | Unit tests: repo methods with temp SQLite + no-op capture | Tests run without Electron |

### Phase C — Auth vertical slice

| Task | Detail | Done when |
|---|---|---|
| C1 | Pure modules: lockout schedule, email normalize, session TTL helpers | Node unit tests, no DB |
| C2 | `main/repos/users.js` (or `auth-users.js`): login_attempts, users password/pin fields, session settings row | SQL isolated |
| C3 | Keep Firebase adapter thin in `firebase-auth-service.js` (or rename); remove school-id persistence sprawl into institution/sync helpers if easy | Clear module boundaries |
| C4 | Slim `main/ipc/auth.js` to composition + error translation | Login/PIN/password change manual QA green |

### Phase D — Capture registry hygiene (parallel / later)

| Task | Detail | Done when |
|---|---|---|
| D1 | Prefer `captureMode: 'explicit'` for all bulk/multi-table writes | Registry smaller for those channels |
| D2 | Split retention/cleanup out of `capture.js` | Capture file shrinks; cleanup still runs |
| D3 | Document write-channel checklist already at `docs/plans/2026-07-15-add-write-channel-checklist.md` — link layering rules | Contributors follow one checklist |

### Phase E — Optional cleanup (lower priority)

| Task | Detail |
|---|---|
| E1 | Inject DB path into `main/db/context.js` from `main.js` (Electron-free unit path) |
| E2 | Split DB override load out of `permissions.js` |
| E3 | Continue renderer extractions for god pages (proctors UI glue, student-profile tabs) — only when touching those features |
| E4 | Institution setup service extraction (same pattern as auth)—after Phase C |

---

## 7. Patterns to reuse (do not invent new styles)

| Pattern | Where |
|---|---|
| Thin IPC + repo | `main/ipc/students.js` + `main/repos/students.js` |
| Explicit capture for bulk | `capture.js` `captureMode: 'explicit'` + repo `addBulk` |
| Pure domain dual-export | `js/student-risk.js`, `js/import-center/*`, `js/algorithms/proctor-v3/` |
| IPC error boundary | `main/ipc/ipc-helpers.js` (`sanitizeIpcErrorMessage`, `authErrorResponse`) |
| Sync engine modularization + DI | `main/sync/engine/*`, `main/sync/transport/firestore.js` (`createFirestoreTransport(deps)`) |
| Preload as sole renderer contract | `preload.js` + smoke channel parity |
| Write-channel checklist | `docs/plans/2026-07-15-add-write-channel-checklist.md` |

---

## 8. Verification

### Per phase

1. **Smoke:** `npm run test:smoke` (IPC/preload/capture registry parity must stay green).
2. **Lint:** `npm run lint` on touched main/preload/tests paths.
3. **Unit (after B1/B5/C1):** plain Node tests with temp SQLite—no Electron window.
4. **Manual QA smoke:** login, bulk student import, one exam write, one staff write, one sync push cycle on a dev school (as relevant to the phase).

### Definition of done for the overall plan

- [ ] High-churn domains (exams, staff, orientation) have repos; IPC has no domain SQL
- [ ] Repos do not `require('../sync/capture')` directly; capture is injected
- [ ] Auth path has pure policy + users repo + thin IPC
- [ ] New-work rule documented: no new SQL in `main/ipc/`
- [ ] Smoke + critical unit suites green

---

## 9. Out of scope / non-goals

- Rewriting all 26 IPC modules in one PR
- Moving pure browser logic (`student-risk`, proctor-v3) into main process
- Replacing Firebase or SQLite
- Renaming for style consistency
- Breaking preload channel names (contract stability)

---

## 10. Bottom line

The **renderer/main process boundary is solid**. The **sync engine is modular enough**. The real layering debt is:

1. **Collapsed main-process layers** — IPC = service = repository for most domains  
2. **Data → sync coupling** in the few repos that exist  
3. **Auth as a vertical multi-SDK stack**

Execute Phases A → B → C; treat D/E as hygiene. That most reduces coupling and unlocks testing **without** a big-bang rewrite.

---

## 11. Implementation status (027-layering-remediation)

Spec/plan/tasks: `specs/027-layering-remediation/`

**Done in feature 027:**

- `main/repos/capture-port.js` + students/grades/absences rewired
- Repos extracted: `exams`, `staff`, `orientation`, `users`
- Pure auth: `main/auth/lockout-policy.js`, `main/auth/session-policy.js`
- Guardrails in `Agents.md` + write-channel checklist

**Remaining fat IPC (follow-up backlog — not blocking 027):**

- `main/ipc/daily-report.js`, `system-tags.js`, `institution.js`
- `main/ipc/appDefaults.js`, `compensation.js`, `system.js` / `system-backup.js`
- `main/ipc/schoolOps.js`, `teacher-absences.js`, `support-sessions.js`, others with inline SQL
- Optional: capture registry hygiene, Electron path injection for `db/context.js`, institution setup service

---

## Related docs

- `Architecture.md` — runtime component map  
- `docs/architecture-review-report.md` — earlier process/security-focused review  
- `docs/plans/2026-07-15-add-write-channel-checklist.md` — write IPC + capture checklist  
- `docs/plans/2026-07-15-solid-remediation-plan.md` — related SOLID/cleanup work (if overlapping)
- Speckit feature: `specs/027-layering-remediation/` (plan, contracts, quickstart, tasks)
