# Quickstart: Verify 027-layering-remediation

**Branch**: `027-layering-remediation`  
**Goal**: Confirm layering slices without breaking school workflows.

## Prerequisites

- Node/npm install at repo root (`npm ci` if clean machine)
- Dev app can launch: `npm run dev` or `npm start` (Windows)
- Optional: sync-enabled school for push check

## 1. Automated gates (every slice)

```bash
npm run lint
npm run test:smoke
```

After capture-port and repo work, also run domain tests (add as implemented):

```bash
node tests/repos-capture-port.test.js
node tests/repos-domain-key-fields.test.js
node tests/sync-exact-bulk-capture.test.js
node tests/repos-exams.test.js
node tests/repos-staff.test.js
node tests/repos-orientation.test.js
node tests/auth-lockout-policy.test.js
node tests/auth-session-policy.test.js
```

All domain tests must complete **without** opening an Electron window.

## 2. Manual regression checklist (SC-001)

Use a non-production school dataset when possible.

| # | Path | Steps | Pass criteria |
|---|------|-------|----------------|
| 1 | Login | Valid user login | Same role/home as before; no raw English stack traces |
| 2 | Lockout | Fail password until lockout | Clear Arabic/user message; retry blocked until schedule |
| 3 | Exams write | Create or edit an exam (or save proctor/room as you usually do) | Row persists after restart |
| 4 | Staff write | Add/update teacher or run bulk import path you use | Data correct; no error toast with internal SQL text |
| 5 | Orientation | Import or edit orientation row / clear only on test year | Data matches pre-change behavior |
| 6 | Students (control) | Existing student list/update still works | No regression on already-extracted domain |
| 7 | Sync push | With sync on, perform a tracked write; trigger/wait push | Outbox drains or status shows success; no silent drop |

## 3. Sanitized errors (SC-007)

Force one failure (e.g. invalid payload or wrong password). Confirm UI shows sanitized message / toast, not `SQLITE_*` or file paths.

## 4. Docs guardrails (SC-006)

Open:

- `docs/plans/2026-07-15-add-write-channel-checklist.md`
- `Agents.md` (manual layering rule)

Confirm “no new domain SQL in `main/ipc`” and pointer to capture-port / explicit bulk are present.

## 5. Suggested local workflow per slice

1. Implement slice (see plan.md slices 0–5).
2. Run lint + smoke + new unit tests for that slice.
3. Spot-check the manual row(s) for that domain.
4. Commit slice independently when green.

## 6. Out of scope for verification

- Full rewrite of remaining IPC modules
- Institution linking/setup
- Renderer page refactors
- Firebase project configuration changes

## Next

After plan review, generate tasks with `/speckit.tasks`.
