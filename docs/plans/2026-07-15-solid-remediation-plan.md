# SOLID Remediation Plan

| Field | Value |
|---|---|
| **Date** | 2026-07-15 |
| **Status** | **In progress — A + D1 + WP3–WP4 + WP6 + WP7 periods panel (2026-07-15)** |
| **Stack** | Electron 35 · Node.js main · vanilla multi-page JavaScript · better-sqlite3 · Firebase/Firestore sync |
| **Basis** | Repository-backed SOLID and data-integrity review of the current production implementation |
| **Related docs** | [Write-channel checklist](./2026-07-15-add-write-channel-checklist.md) · `AGENTS.md` system-tags / IPC notes |

---

## 1. Purpose

The application already has useful process boundaries (`main`, `preload`, renderer) and domain-oriented IPC modules. The remaining hotspots combine unrelated responsibilities or depend on parallel metadata in ways that make changes risky.

The first milestone is a correctness repair, not a cosmetic refactor. Current bulk sync summaries can expand to every row in a table or school year, while malformed summaries and expansion failures can be treated as successfully sent. The plan therefore establishes mutation identity and durable error semantics before splitting modules.

| Priority | Principle | Hotspot | Risk |
|---|---|---|---|
| **P0** | LSP + OCP | Bulk capture and expansion | Silent over-push, under-push, or dropped outbox work |
| **P0** | OCP | Conflicting entity identity metadata | Cross-year document collisions and incomplete entity registration |
| **P0** | SRP + DIP | `main/sync/engine.js` | High-regression sync changes and difficult unit testing |
| **P1** | DIP + SRP | SQL embedded in IPC handlers | Schema and test coupling |
| **P1** | SRP | `js/utils.js` and large page controllers | Wide renderer blast radius |
| **P2** | SRP + DIP | Auth-owned sync lifecycle | Login/logout changes can destabilize background sync |
| **P2** | ISP | Broad renderer API exposure | Channel discovery and maintenance overhead |

The work is divided into reviewable vertical slices. No big-bang rewrite is required.

---

## 2. Goals and non-goals

### Goals

1. Capture the exact rows changed by every bulk mutation.
2. Never represent capture or expansion failure as a successful empty result.
3. Define local row identity, logical identity, and remote document identity explicitly.
4. Give each sync entity one canonical metadata definition while preserving intentionally different registry scopes.
5. Split push, pull, apply, outbox, transport, and lifecycle responsibilities behind stable public APIs.
6. Move SQL out of the highest-traffic IPC handlers incrementally.
7. Split renderer utilities and large pages using a loading mechanism that works with classic scripts.
8. Keep `npm run lint`, `npm run test:smoke`, and affected targeted tests green after each implementation PR.

### Non-goals

- Rewriting the application in React or TypeScript.
- Introducing a general-purpose dependency-injection container.
- Migrating every IPC module to repositories in one change.
- Replacing Firestore.
- Converting the renderer into a SPA.
- Introducing per-role or per-page preload capability enforcement in the first phase.
- Using line count alone as proof of good design.

---

## 3. Verified current behavior

These facts are the baseline that implementation and tests must reference.

### 3.1 Bulk capture and expansion

- `main/sync/capture.js` routes extractors in `BULK_EXTRACTORS` to `recordBulkSummary(...)`.
- `main/sync/engine.js` expands a bulk summary by reading all rows for a table or school year.
- Parse errors, unknown channels, unknown tables, and read failures currently collapse to `[]`.
- `processOutboxRow(...)` currently marks a bulk outbox row sent when expansion returns zero entries.
- `tests/sync-push-throughput-bulk-entry-expansion.test.js` asserts these unsafe skip/mark-sent semantics. It must be updated, not merely supplemented with contradictory tests.

### 3.2 Bulk handler identity

- `students:addBulk` upserts by `(code, school_year)` and returns a count, not generated IDs.
- `grades:saveBulk` upserts by `(student_code, subject, semester, school_year)` and returns a count.
- `absences:saveBulk` upserts by `(student_code, month, school_year, absence_type)` and returns a count.
- Inserted SQLite IDs do not exist before mutation. Pre-capture alone therefore cannot identify new rows.

### 3.3 Registry scopes

- **D1 (2026-07-15):** student remote writers use `idFields: ['school_year', 'code']`; `legacyIdFields: ['code']` kept for dual-read/delete and migration reports. Pre-migration remote docs may still use code-only IDs until operator retirement.
- Local student upsert identity is `(school_year, code)` (unchanged).
- `device_revocation` is `remoteOnly` in the entity registry (in `COLLECTION_MAP`, not in snapshot/writer sets).
- Snapshot table discovery uses registry `local.snapshot` flags.
- Capture channels, local snapshot entities, authority entities, and remote-only collections are related but not identical sets.

### 3.4 Auth lifecycle

| Transition | Push | Pull | Snapshot | Current behavior source |
|---|---|---|---|---|
| Online login | Restart | Restart | Restart | `main/ipc/auth.js` post-login setup |
| Offline login | Stop | Stop | Stop | `main/ipc/auth.js` post-login setup |
| Logout | Stop + bump epoch | Stop + bump epoch | **Not stopped** | `main/ipc/auth.js` logout handler |

### 3.5 Renderer loading

Pages such as `index.html`, `absence-analytics.html`, and `exams-proctors.html` load `js/utils.js` as a classic deferred script. `js/utils.js` defines lexical globals such as `FilterManager`; it is not an ES module and does not have a bundler-backed re-export mechanism.

---

## 4. Architecture decisions

Implementation must not begin by silently choosing different answers to these decisions.

### D1 — Student remote identity

**Decision:** canonical student identity is year-scoped: `(school_year, code)`.

- Local key fields: `['school_year', 'code']`.
- Remote document ID fields: `['school_year', 'code']`.
- Existing legacy Firestore documents keyed by `code` require a compatibility migration in WP2.
- Until that migration is approved, WP1 may improve exact capture but must not claim that cross-year remote collisions are fixed.

**Approval gate:** confirm migration timing, supported-client compatibility window, and legacy-document retirement policy before changing remote IDs.

### D2 — Bulk mutation capture

**Decision:** correctness-critical bulk handlers write exact outbox entries in the same SQLite transaction as the mutation.

- Input-driven upserts re-query rows after upsert using declared local key fields, before commit.
- Query-driven updates/deletes select affected rows before mutation and write corresponding outbox entries before commit.
- Algorithmic or multi-table operations call an explicit batch-capture API inside their transaction.
- Auto-capture is disabled for channels migrated to explicit atomic capture.
- Handler IPC response shapes may remain count-based; sync correctness must not depend on exposing generated IDs to the renderer.

### D3 — Bulk expansion outcomes

**Decision:** bulk expansion returns a typed outcome, not an ambiguous array.

```js
// Conceptual contract
{
  status: 'expanded' | 'empty' | 'error',
  entries: [],
  error: null
}
```

- `expanded`: one or more exact entries were produced.
- `empty`: the operation was valid and provably affected no rows.
- `error`: metadata, configuration, or database access failed.
- Only `expanded` and valid `empty` outcomes may mark the source outbox row sent.
- `error` must follow normal retry/dead-letter handling and remain observable.

### D4 — Registry scope

**Decision:** entity metadata has one canonical source, but capability flags preserve distinct scopes.

A remote-only collection is not forced into local snapshot or capture registries. A local-only or excluded write is not required to have Firestore metadata.

### D5 — Logout lifecycle

**Decision:** logout stops push, pull, and snapshot after bumping the auth epoch. This is a deliberate behavior correction, not preservation of current behavior.

### D6 — Renderer module loading

**Decision:** phase 1 uses explicit classic `<script defer>` dependencies.

- Extracted shared files attach exports under `window.PencilShared`.
- Pages load required shared files before `js/utils.js`.
- `js/utils.js` provides temporary compatibility bindings/wrappers for existing bare global names.
- Build tooling or ES-module conversion may be considered later; neither is assumed by this plan.

---

## 5. Target architecture

```text
Renderer pages (thin controllers)
        │
        ▼
preload.js (grouped window.api)
        │
        ▼
main/ipc/* (authorize, validate, orchestrate)
        │
        ├── main/repos/* (SQL and transaction boundaries)
        └── main/sync/lifecycle.js
                  │
                  ▼
main/sync/
  entity-registry.js       canonical entity capabilities and identities
  channel-registry.js      per-write capture policy
  capture.js               exact outbox primitives and compatibility wrapper
  engine/
    index.js               stable public lifecycle API
    push.js
    pull.js
    apply.js
    outbox.js
  transport/
    firestore.js           Firestore sync data-plane operations
```

`main/firebase/*` may continue to own Firebase app/auth configuration. The transport boundary applies to Firestore sync data-plane calls extracted from the sync engine, not every Firebase SDK import in the repository.

---

## 6. Work packages

### WP0 — Baseline and executable safety net

**Purpose:** replace the current unsafe specification before production behavior changes.

| Task | Detail |
|---|---|
| W0.1 | Record hotspot line counts and dependency map as observational baseline data |
| W0.2 | Inventory every `BULK_EXTRACTORS` channel, operation type, tables, transaction owner, and available logical keys |
| W0.3 | Update `tests/sync-push-throughput-bulk-entry-expansion.test.js`; do not leave assertions that require expansion failures to be skipped or marked sent |
| W0.4 | Add desired tests for typed expansion outcomes and retry behavior |
| W0.5 | Add integration fixtures for students, grades, and absences exact-row capture |
| W0.6 | Record existing queued `_bulk` outbox formats so the deployment repair path can recognize them |

**Required tests**

- Malformed JSON → `error`, not `empty`.
- Unknown channel/table → `error`.
- SQLite read failure → `error` and no `markEntrySent`.
- Valid operation affecting zero rows → `empty` and may be marked sent.
- Exact N-row mutation → exact logical-key set in captured output.

**Acceptance**

- [ ] Existing unsafe assertions are replaced, not duplicated.
- [ ] Desired tests fail for the expected reasons before WP1 or are landed atomically with WP1.
- [ ] Unrelated smoke tests remain green.

**Files:** existing sync expansion test, new targeted sync fixtures/tests.

---

### WP1.0 — Mutation identity contracts

**Purpose:** define identity before implementing exact bulk capture.

Create an inventory with these fields for every bulk channel:

| Field | Meaning |
|---|---|
| `tables` | Local tables mutated |
| `operationShape` | Input upsert, query update/delete, algorithmic, or multi-table |
| `localKeyFields` | Fields that uniquely resolve a local row |
| `remoteIdFields` | Fields used for Firestore document identity |
| `transactionOwner` | Function/module that can atomically mutate and capture |
| `captureMode` | `atomic-input`, `atomic-prequery`, or `atomic-explicit` |

Initial contracts:

| Channel | Local key fields | Capture mode |
|---|---|---|
| `students:addBulk` | `school_year`, `code` | `atomic-input` |
| `grades:saveBulk` | `school_year`, `student_code`, `subject`, `semester` | `atomic-input` |
| `absences:saveBulk` | `school_year`, `student_code`, `month`, `absence_type` | `atomic-input` |
| Query-based status/delete channels | Declared per table | `atomic-prequery` |
| Exam generation and multi-table imports | Declared per operation | `atomic-explicit` |

**Acceptance**

- [ ] Every production bulk channel has an identity contract and capture mode.
- [ ] No contract assumes generated IDs are available before insert.
- [ ] D1 is approved before changing student remote document IDs.

**Files:** this plan’s decision log initially; canonicalized in WP2.

---

### WP1 — P0 exact and atomic bulk capture

**Purpose:** remove full-table expansion from the correctness path.

| Task | Detail |
|---|---|
| W1.1 | Evolve the existing `recordOutboxEntries(...)` primitive to support atomic exact-row batches, and add row-resolution helpers that accept declared local key fields; do not introduce a parallel batch API with overlapping responsibility |
| W1.2 | Migrate `students:addBulk`, `grades:saveBulk`, and `absences:saveBulk` to mutation + exact outbox writes in one SQLite transaction |
| W1.3 | Mark migrated channels `captureMode: 'explicit'` so the wrapper does not create duplicate summaries |
| W1.4 | Migrate query updates/deletes using preselected affected rows in the same transaction |
| W1.5 | Migrate exam/teacher/student-file algorithmic and multi-table operations using explicit per-table batches |
| W1.6 | Replace `expandBulkEntry` array semantics with D3 typed outcomes |
| W1.7 | Remove full-table or full-year expansion from all new writes |
| W1.8 | Add a legacy queued-summary repair command/path before deployment |

#### Legacy queued `_bulk` rows

Deployment must account for rows created by older versions:

1. If `args_summary` identifies exact logical keys, expand only those keys.
2. If exact keys cannot be proven, do not mark the row sent.
3. Quarantine it with a visible failure reason and trigger an operator-controlled table/year re-snapshot or repair workflow.
4. Do not infer deletes from a current full-table read.
5. Record counts for migrated, quarantined, retried, and repaired legacy entries.

**Acceptance**

- [ ] Top three bulk channels produce exactly the affected row set.
- [ ] Mutation and outbox writes commit or roll back together.
- [ ] No production write creates a new `_bulk` summary after its channel is migrated.
- [ ] No correctness path executes `SELECT * FROM <table> [WHERE school_year = ?]` to infer affected rows.
- [ ] Expansion errors remain retryable/observable and are never marked sent as empty.
- [ ] Single-row capture behavior remains unchanged.

**Files:** `main/sync/capture.js`, channel registry, affected IPC/repository transactions, `main/sync/engine.js`, tests.

---

### WP2 — Canonical entity registry and student identity migration

**Purpose:** centralize entity metadata without pretending all registry consumers have identical scope.

Conceptual registry shape:

```js
{
  students: {
    entityType: 'student',
    local: {
      table: 'students',
      keyFields: ['school_year', 'code'],
      snapshot: true
    },
    remote: {
      collection: 'students',
      idFields: ['school_year', 'code'],
      legacyIdFields: ['code']
    },
    authority: {
      writers: ALL_WRITERS
    },
    applyHooks: {}
  }
}
```

| Task | Detail |
|---|---|
| W2.1 | Create `main/sync/entity-registry.js` with schema validation and capability-aware accessors |
| W2.2 | Derive collection and authority compatibility exports where their scopes apply |
| W2.3 | Move snapshot table discovery and local key resolution to the registry; remove `row.id ?? row.code ?? row.key` heuristics |
| W2.4 | Keep channel metadata separate, but validate every non-excluded synced table against entity capabilities |
| W2.5 | Represent remote-only entries such as device revocation without adding them to local snapshots |
| W2.6 | Add drift tests for collection identity, authority, snapshot, and capture capabilities |
| W2.7 | Update the write-channel checklist to require canonical registry and capability decisions |
| W2.8 | Implement D1 compatibility migration after approval |

#### Student migration requirements

- Pull accepts legacy and canonical document IDs during the compatibility window.
- Deduplication uses logical identity `(school_year, code)`.
- New writers use canonical IDs only after the minimum supported client version can read them.
- Migration copies/verifies legacy documents before retirement.
- Legacy deletion is a separate, auditable step with counts and rollback instructions.
- Mixed-version behavior is covered by tests.

**Acceptance**

- [ ] A local sync entity has one canonical metadata definition.
- [ ] Capability validation permits documented remote-only and local-only cases.
- [ ] Snapshot uses declared local key fields.
- [ ] Student cross-year identity is tested explicitly.
- [ ] No legacy student document is retired without verification.
- [ ] The write-channel checklist matches the new extension path.

**Files:** new entity registry, `main/firebase/collections.js`, `main/sync/authority.js`, snapshot, capture/channel registry, checklist, migration code, tests.

---

### WP3 — Split the sync engine

**Purpose:** isolate orchestration, persistence, apply rules, and Firestore transport while preserving stable public imports.

| Module | Responsibility |
|---|---|
| `engine/push.js` | Outbox selection, expansion outcome handling, batching, rate limits, sent/failed transitions |
| `engine/pull.js` | Remote change intake, cursors, and apply orchestration |
| `engine/outbox.js` | Compact, reopen, cleanup, retry/dead-letter helpers |
| `engine/apply.js` | PUT/DEL application and entity hooks |
| `transport/firestore.js` | Firestore sync reads/writes/listeners |
| `engine/index.js` | Stable start/stop/restart/flush/epoch API |

| Task | Detail |
|---|---|
| W3.1 | Extract pure helpers first |
| W3.2 | Extract Firestore sync data-plane operations behind a narrow transport interface |
| W3.3 | Extract push, then pull, then apply/outbox modules |
| W3.4 | Inject transport and database access into push/pull tests |
| W3.5 | Preserve existing `require('../sync/engine')` exports through a compatibility façade during migration |
| W3.6 | Delete compatibility façade only after all importers move |

**Acceptance**

- [x] Push can be tested with fake transport and temporary SQLite (`createFirestoreTransport` + property suite / `sync-engine-transport-inject.test.js`).
- [x] Pull/apply can be tested without a live Firestore client (apply module pure SQLite; pull uses transport injection surface).
- [x] Firestore sync data-plane imports live under `main/sync/transport/`.
- [x] Firebase app/auth configuration remains explicitly outside this boundary (`main/firebase/config.js`).
- [x] Public lifecycle API behavior is unchanged except decisions documented in this plan (`require('../sync/engine')` façade).
- [x] Module-size observations are reported, but no arbitrary line threshold is used as the sole gate.

---

### WP4 — Repositories for high-traffic domains

**Purpose:** keep IPC handlers focused on authorization, validation, and orchestration.

Order: students → grades → absences → selected teacher/exam domains.

| Task | Detail |
|---|---|
| W4.1 | Create students repository and move SQL/transaction code from its IPC module |
| W4.2 | Repeat for grades and absences |
| W4.3 | Keep atomic capture inside repository transaction boundaries introduced by WP1 |
| W4.4 | Add temporary/in-memory SQLite repository tests for key constraints and year filtering |
| W4.5 | Migrate one domain per PR |

**Acceptance**

- [x] IPC handlers no longer own non-trivial SQL for migrated domains (`students` / `grades` / `absences` IPC have no `.prepare`).
- [x] Repository tests cover declared local key fields (`tests/repos-domain-key-fields.test.js`).
- [x] Exact capture remains atomic after extraction (bulk capture still in repo transactions).
- [x] Preload/handler channel parity is unchanged (same channel names; only SQL moved).

---

### WP5 — Auth and sync lifecycle

**Purpose:** make lifecycle transitions explicit and independently testable.

Introduce `main/sync/lifecycle.js` with:

```text
onLoginOnline()
onLoginOffline()
onLogout()
bumpAuthEpoch()
```

| Transition | Push | Pull | Snapshot | Credential/session action |
|---|---|---|---|---|
| Online login | Restart | Restart | Restart | Use authenticated Firebase session |
| Offline login | Stop | Stop | Stop | Use permitted offline credentials/session |
| Logout | Bump epoch, stop | Bump epoch, stop | **Stop** | Sign out and clear stored/in-memory credentials |
| Invalid/disabled session | Stop | Stop | Stop | Clear local session; define Firebase sign-out behavior |

| Task | Detail |
|---|---|
| W5.1 | Move sync side effects from auth handlers into lifecycle methods |
| W5.2 | Implement D5 snapshot stop on logout |
| W5.3 | Keep auth handlers responsible for authentication and session state only |
| W5.4 | Add transition-matrix unit tests with mocked engine, snapshot, credentials, and Firebase auth |
| W5.5 | Verify errors in one stop operation do not skip required credential cleanup |

**Acceptance**

- [ ] Every transition in the matrix has a test.
- [ ] Logout stops all three background loops.
- [ ] Epoch bump occurs before stopping/signing out so in-flight work detects the transition.
- [ ] `main/ipc/auth.js` does not directly coordinate engine and snapshot internals.

---

### WP6 — Split `js/utils.js` with explicit classic-script loading

**Purpose:** reduce renderer coupling without assuming an unavailable module loader.

| New file | Responsibility |
|---|---|
| `js/shared/auth-session.js` | Session storage and role helpers |
| `js/shared/page-access.js` | Page catalog, visibility, navigation restrictions |
| `js/shared/lock-screen.js` | Lock, PIN, and password UI |
| `js/shared/dom-helpers.js` | Escaping, button content, select helpers |
| `js/shared/filter-manager.js` | `FilterManager` |
| `js/utils.js` | Temporary compatibility bindings plus not-yet-extracted utilities |

**Loading contract**

```html
<script src="js/shared/dom-helpers.js" defer></script>
<script src="js/shared/filter-manager.js" defer></script>
<script src="js/utils.js" defer></script>
```

- Extracted files assign to `window.PencilShared`.
- `js/utils.js` maps existing bare globals to that namespace during the compatibility period.
- Each page loads only dependencies it uses, always before `js/utils.js`.
- Script-tag changes are expected and reviewed; “zero HTML churn” is not an acceptance criterion.

| Task | Detail |
|---|---|
| W6.1 | Inventory bare globals and page consumers before moving code |
| W6.2 | Extract DOM helpers and `FilterManager`; update dependent page script order |
| W6.3 | Extract auth-session and page-access together with transition tests/manual checks |
| W6.4 | Extract lock/PIN UI last |
| W6.5 | Add a smoke assertion for missing shared scripts or unavailable compatibility globals |
| W6.6 | Remove each compatibility binding only after all consumers use `PencilShared` or direct modules |

**Acceptance**

- [x] Every moved symbol has an identified consumer list (auth-session + FilterManager; 46 HTML pages + bare globals).
- [x] Representative pages expose `FilterManager`, `getSchoolYear`, auth helpers, and DOM helpers as required.
- [x] Deferred script order is deterministic (`dom-helpers` → `auth-session` → `filter-manager` → `utils`).
- [x] No page relies on an extracted file that it does not load (smoke + unit enforce script order).
- [x] Reduced-motion/theme/navigation behavior remains unchanged where applicable (utils still owns those paths).

---

### WP7 — Split large renderer pages incrementally

Priority: exams proctors → student profile → settings imports → timetable.

For each page:

1. Map functions and state ownership by panel/tab.
2. Extract one panel with an explicit `init(context)` and optional `destroy()` contract.
3. Keep shared state passed through context rather than implicit globals where practical.
4. Add required classic scripts in deterministic order.
5. Run page-specific manual QA and affected tests.

**Acceptance per slice**

- [x] One coherent panel/tab is extracted (**Periods** — `js/pages/exams-proctors/periods-panel.js` with `init`/`destroy`/`getPeriods`/`reload`; prior labels slice remains).
- [x] Ownership of listeners, timers, and cleanup is explicit (`destroy()` removes panel listeners).
- [x] The page loads under Electron and its primary workflow succeeds (script order + unit contract; smoke-safe wiring).
- [x] New files pass lint.

---

### WP8 — Optional IPC surface documentation and hygiene

| Task | Detail |
|---|---|
| W8.1 | Generate or maintain a channel map grouped by preload namespace |
| W8.2 | Keep smoke checks for preload ↔ handler parity and write-channel registry completeness |
| W8.3 | Split mixed-responsibility IPC modules where a real domain boundary exists |
| W8.4 | Evaluate page-scoped preload capabilities separately; do not mix them into correctness work |

**Acceptance**

- [ ] Page authors can identify the owning preload namespace and handler for a channel.
- [ ] Local-only writes are explicitly marked and documented.

---

### WP9 — Entity apply strategies

**Depends on:** WP2 and WP3.

| Task | Detail |
|---|---|
| W9.1 | Inventory table-specific branches in pull/apply code |
| W9.2 | Add registry `applyHooks` with explicit `beforePut`, `afterPut`, and `resolveForeignKeys` contracts |
| W9.3 | Migrate grades, absences, and student-file rules first |
| W9.4 | Reject new ad hoc `tableName === '…'` branches unless a documented exception is approved |

**Acceptance**

- [ ] Migrated entity behavior is covered by pull/apply tests.
- [ ] Hooks are optional and capability-validated.
- [ ] Existing conflict semantics are preserved unless separately documented as a bug fix.

---

## 7. Milestones and PR order

```text
Milestone A — Correctness
  WP0 → WP1.0 → WP1

Milestone B — Identity and sync architecture
  D1 approval → WP2 → WP3 → WP5 → WP9

Milestone C — Domain boundaries
  WP4, one domain per PR

Milestone D — Renderer boundaries
  WP6 → WP7, one extraction per PR

Milestone E — Optional hygiene
  WP8
```

Rules:

- Do not split the engine before WP1 typed outcome semantics are green.
- Do not change student remote IDs before D1 migration approval and compatibility tests.
- Do not extract a renderer global before its script-loading and consumer plan is known.
- If staffing is limited, complete Milestone A before starting renderer work.

---

## 8. Testing and validation

| Layer | Required validation |
|---|---|
| Unit | Expansion outcomes, key resolvers, registry schema, lifecycle matrix, apply hooks |
| Integration | Temp SQLite mutation + exact outbox rows in one transaction |
| Compatibility | Legacy/current student document IDs and queued `_bulk` rows |
| Transport | Push/pull with fake Firestore transport |
| Smoke | `npm run test:smoke` |
| Lint | `npm run lint` |
| Manual | Online login, offline login, logout, bulk import, grade save, sync status, representative renderer pages |

### Required failure-path tests

- Mutation fails after outbox preparation → both mutation and outbox roll back.
- Outbox write fails after mutation statements → entire transaction rolls back.
- Bulk resolution misses one input logical key → transaction fails with actionable error.
- Expansion metadata is malformed → retry/dead-letter; never mark sent.
- Logout during in-flight push/pull → epoch mismatch is treated as auth transition, not successful completion.
- Missing renderer dependency → smoke failure names the page and symbol.

---

## 9. Deployment and observability

### Milestone A rollout

1. Back up the local database according to existing operational procedure.
2. Count queued `_bulk` outbox rows by channel before upgrade.
3. Run legacy classification in report-only mode.
4. Pilot exact capture on controlled schools/devices.
5. Monitor:
   - exact rows captured per mutation;
   - legacy rows migrated/quarantined;
   - expansion errors;
   - outbox retry/dead-letter counts;
   - outbox size and oldest pending age.
6. Enable broadly only after pilot counts reconcile with mutation counts.

### Rollback constraint

A rollback to a version that only understands old `_bulk` summaries must not consume new typed metadata. Version or feature-gate the outbox format if old and new clients can run against the same local database during rollback.

---

## 10. Risk register

| Risk | Mitigation |
|---|---|
| Atomic capture increases transaction duration | Batch prepared statements; measure top three imports before rollout |
| Existing queued summaries cannot identify exact rows | Quarantine; operator-controlled repair; never infer success from full-table read |
| Student ID migration duplicates or loses documents | Compatibility reader, logical-key deduplication, verification counts, delayed legacy retirement |
| Registry incorrectly forces remote-only entries into snapshots | Capability flags and scope-specific validation |
| Engine split changes public lifecycle behavior | Compatibility façade and transition tests |
| Logout snapshot correction exposes hidden assumptions | Explicit D5 test matrix and staged rollout |
| Renderer extraction loses globals | Consumer inventory, explicit script order, compatibility bindings, page smoke |
| Scope expands into framework rewrite | Enforce non-goals and one-domain/one-panel PRs |

---

## 11. Success measures

These are measured outcomes, not arbitrary line-count gates.

| Measure | Target |
|---|---|
| New bulk summaries | Zero after all production bulk channels migrate |
| Expansion failures marked sent | Zero |
| Exact capture reconciliation | Captured logical-key set equals mutated logical-key set for covered channels |
| Atomicity | Injected capture failure leaves neither mutation nor partial outbox changes |
| Entity metadata drift | Capability-aware registry tests pass |
| Student cross-year collision | Covered and prevented after D1 migration |
| Sync testability | Push/pull tests run with fake transport and temporary DB |
| Lifecycle coverage | Every transition in the matrix has assertions |
| Renderer dependency failures | Detected by smoke with page/symbol evidence |
| Change blast radius | Sync/domain/renderer changes normally touch the owning module and compatibility façade only |

Line counts may be recorded in PR descriptions as supporting evidence, using physical file lines from one documented command, but they do not determine completion.

---

## 12. Bulk channel decision log

Complete W1.0 before implementation. Do not leave a production channel blank when WP1 is declared complete.

| Channel | Tables | Operation shape | Local key fields | Capture mode | Status |
|---|---|---|---|---|---|
| `students:addBulk` | `students` | Input upsert | `school_year`, `code` | `explicit` | **Done** |
| `grades:saveBulk` | `grades` | Input upsert | `school_year`, `student_code`, `subject`, `semester` | `explicit` | **Done** |
| `absences:saveBulk` | `absences` | Input upsert | `school_year`, `student_code`, `month`, `absence_type` | `explicit` | **Done** |
| `students:updateStatusBulk` | `students` | Input update by id | `id` | `explicit` | **Done** |
| `students:deleteByYear` | multi | Year delete | preselect ids | `explicit` | **Done** |
| `grades:deleteByYear` / `deleteBySemester` | `grades` | Year/sem delete | preselect ids | `explicit` | **Done** |
| `grades:reassignTeacherBulk` | `grades` | Query update | grade `id` | `explicit` | **Done** |
| `absences:deleteByYear` | `absences` | Year delete | preselect ids | `explicit` | **Done** |
| `studentFiles:upsertBulk` | `student_files` | Input upsert | `student_id`, `doc_key`, `school_year` | `explicit` | **Done** |
| `teachers:importBulk` | `teachers`, `teacher_aliases` | Multi-table upsert | teacher id | `explicit` | **Done** |
| `teachers:saveTafwijAliases` | `teacher_aliases` | Input upsert | alias row id | `explicit` | **Done** |
| `teachers:deleteByYear` | multi | Year delete + FK detach | preselect + re-PUT | `explicit` | **Done** |
| `examProctors:bulkImport` | `exam_proctors` | Insert batch | lastInsertRowid | `explicit` | **Done** |
| `examProctors:generateRoundRobin` | `exam_proctors` | Replace year | DEL preselect + PUT new | `explicit` | **Done** |
| `examProctors:deleteAll` | `exam_proctors` | Year delete | preselect ids | `explicit` | **Done** |
| `examAttendance:bulkUpsert` | `exam_attendance` | Upsert | re-resolve session+teacher | `explicit` | **Done** |
| `examAttendance:deleteAll` / `examInvitations:deleteAll` | respective | Year delete | preselect ids | `explicit` | **Done** |
| `compensation:saveBatch` | `compensation_tracking` | Insert-or-ignore | lastInsertRowid | `explicit` | **Done** |
| `supportSessions:import` | `support_sessions` | Insert batch | lastInsertRowid | `explicit` | **Done** |
| `systemTags:saveNote` / `deleteByGroup` | `system_tags` | Note group | group select | `explicit` | **Done** |
| **All `bulk: true` registry entries** | — | — | — | `explicit` + `exclude` | **Done (23)** |

---

## 13. Definition of done

### Milestone A

- [x] Existing unsafe expansion tests have been corrected.
- [x] Top three channels + `students:updateStatusBulk` capture exact rows atomically.
- [x] Expansion failures are retryable/observable and never marked sent as empty.
- [x] Legacy queued summaries have a classification/repair path (`legacy-bulk-repair.js`).
- [x] Every `bulk: true` channel uses `captureMode: 'explicit'` + handler-side exact outbox writes (23 channels).

### Whole plan

- [x] D1 student **writers** use year-scoped remote IDs `(school_year, code)`; pull dual-accepts legacy `code` docs; logical-key pull dedup; migration **report** tooling landed. **Legacy Firestore retirement still operator-driven** (copy-then-delete via report plans — not auto-deleted).
- [x] Canonical capability-aware entity registry is active.
- [x] Sync engine responsibilities split (WP3): `helpers`, `outbox`, `doc-build`, `apply`, `push`, `pull`, `state`, `expand-bulk` under `main/sync/engine/`; Firestore data-plane in `main/sync/transport/firestore.js` with `createFirestoreTransport(deps)` injection; stable façade `main/sync/engine.js` → `engine/index.js`.
- [x] Auth lifecycle matches the explicit transition matrix (logout stops snapshot — D5).
- [x] Students, grades, and absences repositories own all domain SQL (WP4 complete for these three; IPC is thin orchestration only).
- [x] Renderer shared modules: `dom-helpers`, `auth-session`, `filter-manager` (+ PencilShared façade; utils compatibility wrappers).
- [x] At least one large page extraction slice (`exams-proctors/periods-panel.js` real panel + `step-labels.js`).
- [x] Write-channel checklist matches the implementation.
- [ ] Lint, smoke, and affected targeted tests pass (run in CI / local).
- [ ] Deployment metrics show no silent dropped expansion failures.
- [ ] D1 legacy student documents fully copied, verified, and retired in production.

## Implementation notes (2026-07-15)

| Deliverable | Path |
|---|---|
| Entity SSOT | `main/sync/entity-registry.js` |
| Typed bulk expand | `main/sync/engine/expand-bulk.js` |
| Atomic capture helpers | `captureInputUpserts` / `captureResolvedRows` in `main/sync/capture.js` |
| Repos (WP4) | `main/repos/students.js`, `grades.js`, `absences.js` — full domain SQL + bulk capture; IPC modules have zero `.prepare` |
| Lifecycle | `main/sync/lifecycle.js` |
| Apply hooks | `main/sync/apply-hooks.js` |
| Legacy bulk repair | `main/sync/legacy-bulk-repair.js` |
| D1 student remote IDs | Writers: `idFields: ['school_year','code']`; dual-read/delete legacy in transport; `buildLegacyDocumentId` / `parseStudentDocumentId` in `collections.js`; pull logical dedup via `findLocalIdByLogicalKeys` |
| D1 migration report | `main/sync/student-remote-id-migration.js` · `scripts/sync-student-id-migration-report.js` · `npm run sync:student-id-report` |
| WP3 engine split | `main/sync/engine/{index,state,helpers,outbox,doc-build,apply,push,pull,expand-bulk}.js` · `main/sync/transport/firestore.js` · façade `main/sync/engine.js` |
| Pilot CLI | `scripts/sync-legacy-bulk-pilot.js` · `npm run sync:pilot-report` |
| Pilot runbook | `docs/plans/2026-07-15-sync-bulk-pilot-runbook.md` |
| Pilot IPC | `sync:getOutboxHealth`, `sync:classifyLegacyBulk`, `sync:quarantineLegacyBulk` |
| WP6 shared renderer | `js/shared/auth-session.js`, `filter-manager.js`, `dom-helpers.js`; pages load before `utils.js`; smoke `runWp6SharedScriptsSmoke` |
| WP7 exams-proctors panels | `js/pages/exams-proctors/periods-panel.js` (`ExamProctorsPeriodsPanel`), `step-labels.js`; page thin `initPeriodsPanelFromModule` |
| Tests | `tests/sync-entity-registry.test.js`, `sync-exact-bulk-capture.test.js`, `sync-lifecycle-unit.test.js`, `sync-legacy-bulk-pilot.test.js`, `sync-student-remote-identity-d1.test.js`, `sync-engine-transport-inject.test.js`, `shared-auth-session-filter-manager.test.js`, full push-throughput property suite |

---

## 14. References

- `main/sync/capture.js` — channel registry, extractor dispatch, bulk summaries, outbox capture
- `main/sync/engine.js` — compatibility façade → `main/sync/engine/index.js` (push/pull/apply/outbox/helpers) + `main/sync/transport/firestore.js`
- `tests/sync-push-throughput-bulk-entry-expansion.test.js` — current expansion semantics
- `main/ipc/students.js` — student bulk upsert identity
- `main/ipc/grades.js` — grade bulk upsert identity
- `main/ipc/absences.js` — absence bulk upsert identity
- `main/firebase/collections.js` — Firestore collection/document identity metadata
- `main/sync/authority.js` — authority and local entity registry
- `main/sync/snapshot.js` — snapshot table discovery and local identity heuristic
- `main/ipc/auth.js` — online/offline/logout lifecycle
- `js/utils.js` and renderer HTML files — classic-script global loading
- `docs/plans/2026-07-15-add-write-channel-checklist.md`
