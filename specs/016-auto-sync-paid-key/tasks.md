# Tasks: Save License Key on Paid Activation

**Input**: Design documents from `/specs/016-auto-sync-paid-key/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md

**Tests**: Not requested in the feature specification — test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: No project initialization needed — this feature modifies a single existing file with no new dependencies, migrations, or project structure changes.

*Phase skipped — nothing to set up.*

---

## Phase 2: Foundational

**Purpose**: No blocking prerequisites — the `sync_config` table and `license_key` column already exist (migration `2026-03-034`). The `activateLicense()` function already has access to `db` and `decoded.normalizedKey`.

*Phase skipped — all prerequisites already exist in the codebase.*

---

## Phase 3: User Story 1 - Paid license activation auto-populates sync key (Priority: P1) 🎯 MVP

**Goal**: When a paid license is activated via `activateLicense()`, automatically save the original (pre-hash) normalized key into `sync_config.license_key` so the sync system can authenticate without manual key entry.

**Independent Test**: Activate a valid paid license key → query `sync_config` table → verify `license_key` column contains the normalized key. Also verify activation still succeeds when `sync_config` table is unavailable.

### Implementation for User Story 1

- [x] T001 [US1] Add try/catch-wrapped `UPDATE sync_config SET license_key = ?` using `decoded.normalizedKey` after the license insert/update block (after line 410, before line 412) in `main/licensing/service.js`

  **Details**: Insert the following block between the end of the license INSERT/UPDATE block (line 410: closing `}` of the else branch) and the device activation query (line 412: `const activeRows = db`):

  ```javascript
  // Save the license key for sync authentication
  try {
      db.prepare('UPDATE sync_config SET license_key = ? WHERE id = 1').run(decoded.normalizedKey);
  } catch {
      // sync_config table may not exist yet (pre-migration) — safe to ignore
  }
  ```

  This single insertion point covers all three success paths (new activation at L535, re-activation at L464, reinstall merge at L464) because it executes before the activation path branches.

**Checkpoint**: At this point, User Story 1 should be fully functional — any successful `activateLicense()` call saves the key to `sync_config`.

---

## Phase 4: User Story 2 - Re-activation preserves sync key consistency (Priority: P2)

**Goal**: When re-activating the same license key (exact match or fuzzy device match), the sync configuration retains the correct license key.

**Independent Test**: Activate a license key, verify sync key is saved, then re-activate the same key and verify the sync key remains correct and unchanged.

### Implementation for User Story 2

*No additional code changes needed.* The T001 insertion point (after line 410) is executed on every activation — including re-activations and reinstall merges — because those paths all flow through the license INSERT/UPDATE block before branching at line 412. The UPDATE statement is idempotent: re-writing the same `decoded.normalizedKey` value produces no change.

**Checkpoint**: User Story 2 is automatically satisfied by the T001 implementation. Verify by re-activating a key and confirming `sync_config.license_key` is still correct.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validation that the change meets all quality gates.

- [x] T002 Run `npm run lint` and fix any linting errors in `main/licensing/service.js`
- [x] T003 Run `npm run test:smoke` and verify all smoke tests pass (IPC parity, module integrity, no CDN refs)
- [ ] T004 Run quickstart.md validation: generate a test license key with `npm run license:key -- --plan=pro --days=365 --customer=TEST-001`, launch app with `npm run dev`, activate the key, and verify `sync_config.license_key` is populated

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Skipped — no setup needed
- **Foundational (Phase 2)**: Skipped — prerequisites already exist
- **User Story 1 (Phase 3)**: Can start immediately — single code change in `main/licensing/service.js`
- **User Story 2 (Phase 4)**: No additional code — automatically satisfied by US1
- **Polish (Phase 5)**: Depends on T001 completion

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies — can start immediately
- **User Story 2 (P2)**: Automatically satisfied by US1 implementation — no additional work

### Within Each User Story

- T001 is the only implementation task
- T002, T003, T004 are sequential validation tasks that depend on T001

### Parallel Opportunities

- T002 and T003 can run in parallel (lint and smoke tests are independent)
- T004 requires manual app interaction and must run after T002/T003 pass

---

## Parallel Example: Polish Phase

```bash
# Launch lint and smoke tests in parallel after T001:
Task: "Run npm run lint in main/licensing/service.js"
Task: "Run npm run test:smoke"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete T001: Add the try/catch UPDATE block in `main/licensing/service.js`
2. Complete T002 + T003: Run lint and smoke tests
3. **STOP and VALIDATE**: Test manually per T004
4. Ready to merge

### Incremental Delivery

This feature is a single atomic change — there is no incremental delivery path. T001 is the entire implementation. US2 requires no additional code.

---

## Notes

- This is an unusually small feature: 1 implementation task, 3 validation tasks
- The single insertion point (after line 410) was chosen per research.md decision R1 to avoid code duplication
- The try/catch with empty catch was chosen per research.md decision R2 — ESLint allows empty catch blocks
- The key format requires no transformation per research.md decision R3 — `decoded.normalizedKey` is exactly what `readLicenseKey()` expects
- No new files, no new IPC channels, no UI changes, no migration changes
