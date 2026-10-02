# Research: 027-layering-remediation

**Date**: 2026-07-17  
**Purpose**: Resolve design choices for main-process layering remediation. No open NEEDS CLARIFICATION items remain.

---

## R1 — Capture dependency inversion

### Decision

Introduce `main/repos/capture-port.js` as the **only** module repos import for change-tracking side effects. It:

- Re-exports (or wraps) the capture functions actually used by repos today.
- Defaults to `require('../sync/capture')`.
- Supports `setRepoCapturePort(port)` and `createNoOpCapturePort()` for tests (mirrors existing `setCaptureGetDb` testability pattern in capture.js).

Production IPC registration does not need to inject anything; the default port is the real capture module.

### Rationale

- Spec FR-004 requires repos not hard-depend on sync implementation.
- Existing repos already call a small surface: `captureInputUpserts`, `captureResolvedRows`, `notifyCaptureCommitted`, `deleteBySchoolYearWithCapture`, and occasional helpers (`selectRowsBySchoolYear`, `captureDeletesFromRows`, `capturePutsByIds`).
- Full DIP factories per repo (`createStudentsRepo({capture})`) would churn call sites more than necessary for this codebase’s CommonJS style.

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Pass `capture` on every mutating method options bag | High call-site noise; easy to forget in new methods |
| Factory `createStudentsRepo(deps)` per domain | Cleaner DIP but large mechanical change; no current factory culture in repos |
| Keep direct `require('../sync/capture')` and mock via proxyquire | Fragile in plain Node tests; couples tests to module cache tricks |
| Move capture calls back into IPC after repo SQL | Restores fat IPC and splits atomicity across layers |

---

## R2 — Extraction order for high-churn domains

### Decision

Order: **capture-port (students/grades/absences first)** → **exams** → **staff** → **orientation** → **auth**.

### Rationale

- Capture-port is a prerequisite so new repos never import sync directly.
- Exams and staff are largest SQL density and highest regression risk; extract with copy-paste fidelity.
- Orientation has merge logic but fewer channel shapes; good third domain.
- Auth is cross-cutting and riskiest for users; do after domain repos so patterns are stable.

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Auth first | Highest user risk before patterns proven |
| Orientation first (smaller) | Less reuse of bulk-capture patterns than exams/staff |
| Extract all remaining 20+ IPC modules | Spec FR-010 out of scope |

---

## R3 — Where multi-step rules live (services package?)

### Decision

**Do not** create a global `main/services/` tree in this feature. Place:

- SQL + transactional domain rules in **repos**.
- Pure auth policy in **`main/auth/*-policy.js`**.
- Pure orientation normalize/merge helpers as **functions in the orientation repo file** (or `main/repos/orientation-helpers.js` if file size demands split)—still Node-testable, no Electron.

### Rationale

- Spec allows services but YAGNI for a single feature if rules are domain-local.
- Constitution prefers single-responsibility modules without inventing parallel packaging styles mid-refactor.
- Import-center and proctor pure logic already live under `js/` for renderer-side domains; main-side pure helpers can colocate with repos.

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| `main/services/orientationService.js` + thin repo | Extra hop without shared multi-domain consumers |
| Move orientation pure helpers to `js/` | Wrong process; orientation merge is main/SQL today |

---

## R4 — Auth layering boundaries

### Decision

Four layers:

1. **Pure policy** — `lockout-policy.js` (attempt limits, `LOCKOUT_SCHEDULE_MS`, allow/deny + next lock time); `session-policy.js` (`SESSION_TTL_MS`, expired?).
2. **Data access** — `main/repos/users.js` for `users`, `login_attempts`, and app session row in `settings`.
3. **Remote adapter** — keep `firebase-auth-service.js` as identity + profile fetch; avoid expanding its SQLite surface in this feature unless a one-line move is free.
4. **IPC** — `main/ipc/auth.js` composes the above, keeps in-memory `SESSION_BY_SENDER` map (process-local session store is not a repo concern).

### Rationale

- Matches FR-006/011 and mirrors “pure vs adapter” already used in renderer for risk/averages.
- Session map is tied to Electron `webContents` sender id — belongs at IPC/composition edge, not in users repo.

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Persist sessions in SQLite only | Already partially mirrored via settings; full redesign out of scope |
| Put lockout constants only in tests as magic numbers | Duplicates production rules; pure module is SSOT |
| Merge firebase-auth-service into ipc/auth | Worsens god path |

### Constants to preserve (golden tests)

From current `main/ipc/auth.js` (verify at implement time; do not change values):

- `MAX_ATTEMPTS_BEFORE_LOCK = 5`
- `LOCKOUT_SCHEDULE_MS = [5_000, 15_000, 30_000, 60_000, 120_000]`
- `ATTEMPT_TTL_MS = 30 * 60_000`
- `SESSION_TTL_MS = 1000 * 60 * 60 * 12`
- `MAX_PIN_ATTEMPTS = 5`

---

## R5 — Testing strategy

### Decision

- Use **temp SQLite file or in-memory** `better-sqlite3` with minimal schema subsets (CREATE TABLE as needed for domain under test), same pattern as existing repo/sync tests.
- Do **not** require Electron for unit tests.
- Keep **smoke** as the IPC contract gate; no new preload channels expected.
- Extend or keep `tests/sync-exact-bulk-capture.test.js` green after capture-port rewire.

### Rationale

- Matches SC-002–SC-005 and existing `tests/repos-domain-key-fields.test.js` approach.
- Minimal schema in tests avoids full migration runner unless already used by a fixture helper in repo.

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Full app integration tests only | Misses FR-011/012 unit-test goals |
| Electron spectron/playwright for every slice | Slow; not required for layering |

---

## R6 — Preload and channel stability

### Decision

**Zero intentional channel renames or payload shape changes.** Extraction is internal to main process.

### Rationale

- Smoke IPC parity and all renderer callers depend on stable names.
- Spec FR-001/FR-002.

### Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| Rename channels while extracting | Cascading renderer churn; fails smoke; no user value |

---

## R7 — Documentation / guardrails placement

### Decision

Update:

1. `docs/plans/2026-07-15-add-write-channel-checklist.md` — layering rule + capture-port.
2. `Agents.md` MANUAL ADDITIONS (and Claude.md architecture notes if present) — “no new `.prepare` in `main/ipc` for domain data.”

Optional later (out of scope): ESLint rule forbidding `.prepare(` under `main/ipc` — process/docs gate is enough for this feature (SC-006).

### Rationale

- Contributors already use the write-channel checklist; single place for sync + layering.
- Agents.md is the agent SSOT for this repo.

---

## Resolved clarifications

| Topic | Resolution |
|-------|------------|
| Schema migrations? | None planned |
| New IPC channels? | None planned |
| Scope of staff? | `main/ipc/staff.js` teachers + aliases (not teacher-absences file unless already inside staff) |
| Capture API freeze? | Port tracks used subset; expand port when new repo needs another capture helper |
| Services package? | Not in this feature |
