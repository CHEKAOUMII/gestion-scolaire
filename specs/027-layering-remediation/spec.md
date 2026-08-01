# Feature Specification: Main-Process Layering Remediation

**Feature Branch**: `027-layering-remediation`  
**Created**: 2026-07-17  
**Status**: Draft  
**Input**: User description: "docs/plans/2026-07-17-layering-architecture-review-plan.md — remediate collapsed main-process layers (fat IPC, missing services, data→sync coupling, auth multi-stack path) without big-bang rewrite; preserve school-facing behavior"

**Source plan**: `docs/plans/2026-07-17-layering-architecture-review-plan.md`

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve school operations after internal restructuring (Priority: P1)

School staff and administrators continue to use the same product features—login and session, student/grade/absence data paths already structured, and high-churn academic operations (exams, staff/teachers, orientation)—without learning new screens or losing data or sync behavior.

**Why this priority**: Architecture work has zero value if it breaks daily school workflows. Behavioral parity is the acceptance gate for every extraction.

**Independent Test**: Run the existing smoke suite and manual regression for login, one bulk student import (or existing student path), one exam write, one staff write, one orientation write, and one sync push cycle; outcomes match pre-change behavior.

**Acceptance Scenarios**:

1. **Given** a working installation with real school data, **When** a user logs in with valid credentials, **Then** they reach the app with the same role and session behavior as before the change.
2. **Given** a locked or failed-login state, **When** the user retries incorrectly, **Then** lockout timing and user-facing messages remain clear and do not expose internal system details.
3. **Given** authorized staff, **When** they create, update, or bulk-import data for exams, staff/teachers, or orientation (as previously supported), **Then** data is stored correctly and remains available after restart.
4. **Given** sync-enabled configuration, **When** a successful local write completes for a migrated domain, **Then** the change is still eligible for outbound sync (no silent drop of capture for that write).

---

### User Story 2 - Verify high-churn domain data rules without launching the full desktop UI (Priority: P1)

Product engineers can validate create/update/delete and bulk rules for the highest-churn school domains (exams, staff/teachers, orientation) using automated checks that do not require opening the desktop application window.

**Why this priority**: Today those rules live inside the communication layer with storage access, so every change is expensive and regression-prone. Unlocking independent verification is the main delivery of this feature.

**Independent Test**: Automated tests exercise the extracted data-access behaviors for exams, staff, and orientation against a temporary local store and pass without starting the desktop shell.

**Acceptance Scenarios**:

1. **Given** the extracted data-access behaviors for exams, **When** engineers run the dedicated automated tests, **Then** CRUD/bulk success and validation failure cases are asserted without launching the desktop UI.
2. **Given** the extracted data-access behaviors for staff/teachers, **When** engineers run the dedicated automated tests, **Then** write and read outcomes are asserted independently of the UI process.
3. **Given** the extracted data-access behaviors for orientation, **When** engineers run the dedicated automated tests, **Then** merge/write rules covered by tests are verified without the UI process.
4. **Given** a contributor implements a change only in data-access for one of these domains, **When** they run the domain’s automated tests, **Then** they get a pass/fail signal before manual UI smoke.

---

### User Story 3 - Test authentication policy without the full remote identity stack (Priority: P2)

Engineers can verify login lockout, session lifetime policy, and related pure authentication rules in isolation, while remote identity and local user storage remain replaceable adapters. End users still see stable success/error outcomes.

**Why this priority**: Login is the riskiest daily path and currently mixes policy, local storage, and remote identity in one vertical stack, making safe changes slow.

**Independent Test**: Automated tests cover lockout schedule and session TTL/policy decisions with fixed inputs and expected outputs; manual login still works end-to-end.

**Acceptance Scenarios**:

1. **Given** a pure lockout/session policy module, **When** tests supply attempt counts and timestamps, **Then** lockout windows and allow/deny decisions match the documented policy.
2. **Given** a failed remote identity service, **When** a user attempts login, **Then** the user receives a clear, non-technical failure outcome and no partial corrupt session is left usable.
3. **Given** successful login, **When** session TTL rules apply, **Then** session validity matches prior product behavior (including multi-hour reopen expectations already established for the product).

---

### User Story 4 - Contributors cannot silently ship writes that skip outbound change tracking (Priority: P2)

When someone adds or changes a write operation for school data, project rules and checks make it explicit how that write participates in outbound change tracking, so multi-device schools do not lose updates because a channel was forgotten.

**Why this priority**: Missed change-tracking registration is a silent production failure mode called out in the architecture review.

**Independent Test**: Follow the project write-channel checklist for a sample write path; smoke/parity checks still enforce registration consistency for write channels.

**Acceptance Scenarios**:

1. **Given** a new or modified write operation in a migrated domain, **When** the contributor completes the write-channel checklist, **Then** capture/outbox participation is explicitly decided (wrapper vs explicit) and documented in the same place as other write channels.
2. **Given** the automated smoke/parity suite, **When** a write channel is registered without matching contract surface, **Then** the suite fails before release.
3. **Given** bulk or multi-row writes in migrated domains, **When** the write commits, **Then** change tracking for those rows remains atomic with the local commit (no committed local rows with zero outbox intent for tracked tables).

---

### User Story 5 - Guardrails for future work (Priority: P3)

The team has a written rule that new school-data write features put storage access behind data-access modules and keep the communication layer thin (auth, validation, response mapping only), so the architecture does not re-collapse.

**Why this priority**: Without guardrails, the next feature reintroduces fat communication-layer handlers.

**Independent Test**: Project contributor docs/checklists state the rule; a reviewer can reject a PR that adds new domain storage access directly in the communication layer for a new write feature.

**Acceptance Scenarios**:

1. **Given** the project’s agent/contributor guidance, **When** a developer starts a new write feature, **Then** they can find an explicit rule: storage access belongs in data-access modules, not in the communication layer.
2. **Given** the extraction order in the remediation plan, **When** the high-churn set (exams, staff, orientation) is done, **Then** remaining fat domains are listed for later work without blocking this feature’s completion.

---

### Edge Cases

- Bulk write partially invalid: valid rows must not leave the system in a half-synced state inconsistent with pre-change atomicity guarantees for that domain.
- Capture hooks failing mid-transaction: local write and change-tracking intent must remain all-or-nothing for explicitly tracked bulk paths.
- Login with missing remote configuration: user-facing error remains actionable; local-only fallback behavior (if any already exists) is preserved, not invented.
- Concurrent session/login attempts: lockout counters and session binding continue to behave as today.
- Domains not in scope (e.g. institution linking, full page-controller splits): remain unchanged; no forced rewrite in this feature.
- Regression of user-visible error language: internal driver/stack details must still never surface in the UI (existing sanitization behavior preserved).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST preserve existing end-user behavior for login, session, and school-year-scoped data operations in domains touched by remediation (exams, staff/teachers, orientation, and any auth paths refactored).
- **FR-002**: System MUST keep the renderer process communicating only through the existing public application bridge; school pages MUST NOT gain direct access to local storage engines or remote identity SDKs.
- **FR-003**: For exams, staff/teachers, and orientation, storage access currently mixed into the communication layer MUST be moved behind dedicated data-access modules so the communication layer only performs authorization, input validation, orchestration, and response mapping.
- **FR-004**: Data-access modules MUST NOT hard-depend on the outbound sync/capture implementation; change-tracking participation MUST be injectable or composed at the edges so data-access can be verified with a no-op tracker.
- **FR-005**: For bulk and multi-row writes in migrated domains, local commit and outbound change-tracking intent MUST remain atomic (same commit boundary as today for those paths).
- **FR-006**: Authentication MUST separate: (a) pure lockout/session policy, (b) local user/attempt persistence, (c) remote identity adapter, (d) thin communication entry that maps outcomes to stable user-facing success/error codes and messages.
- **FR-007**: User-facing failures for auth and domain writes MUST continue to avoid exposing internal storage or remote-stack diagnostics (preserve current sanitization quality).
- **FR-008**: Project documentation MUST state a standing rule that new write features place storage access in data-access modules, not in the communication layer, and MUST link the existing write-channel checklist for change-tracking registration.
- **FR-009**: Automated smoke/parity checks that protect bridge channel consistency and write-channel registration MUST remain green after each remediation slice.
- **FR-010**: Remediation MUST be incremental: completing exams, staff/teachers, orientation, capture-port inversion for existing student/grade/absence data-access, and auth split is sufficient for this feature; rewriting all remaining communication-layer domains is out of scope.
- **FR-011**: Pure authentication policy decisions (lockout windows, session TTL evaluation) MUST be verifiable with automated tests that do not require the remote identity service or the desktop UI.
- **FR-012**: Data-access behaviors for exams, staff/teachers, and orientation MUST be verifiable with automated tests against a temporary local store without launching the desktop UI.

### Key Entities

- **Communication layer (IPC bridge)**: The authorized boundary between the school UI and main-process capabilities; after remediation it remains thin for migrated domains.
- **Data-access module (repository)**: Owns read/write of one school domain’s persistent records; free of remote sync implementation imports.
- **Change-tracking intent (outbox/capture)**: Records that a local mutation should be pushed to peer devices; composed with data-access, not owned inside pure domain math.
- **Authentication policy**: Lockout schedule, attempt limits, session lifetime rules independent of remote identity and UI.
- **Remote identity adapter**: External sign-in/profile retrieval used by login; isolated from pure policy and from domain school-data repositories.
- **High-churn school domains**: Exams (including related proctor/room/attendance records owned by that communication module today), staff/teachers, student orientation—priority extraction targets.
- **Already-extracted domains**: Students, grades, absences—must adopt injectable change-tracking so they no longer reverse-depend on sync internals.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of manual regression checklist items for login, exams write path, staff write path, orientation write path, and one sync push cycle pass on a representative school dataset after remediation (no intentional product behavior change).
- **SC-002**: At least three high-churn domains (exams, staff/teachers, orientation) have automated data-access tests that run without launching the desktop UI, covering happy path plus at least one validation/failure path each.
- **SC-003**: Authentication lockout/session policy has automated tests covering at least the escalating lockout schedule and session validity decision, runnable without remote identity and without the desktop UI.
- **SC-004**: Existing student/grade/absence data-access no longer requires the real outbound sync module to execute unit tests (tests use a no-op or fake change tracker).
- **SC-005**: Project smoke/parity suite remains fully passing after each merged slice of the feature.
- **SC-006**: Contributor guidance includes an explicit “no new domain storage access in the communication layer” rule and a pointer to the write-channel checklist; a reviewer can cite it on a pull request within one minute of opening the docs.
- **SC-007**: No increase in user-visible internal error leakage: spot-check of failed auth and one forced domain write failure still shows sanitized messages only.

## Assumptions

- End-user feature set is unchanged; this work is internal quality/maintainability with a hard non-regression constraint.
- The three already-extracted domains (students, grades, absences) are the pattern to extend, not replace.
- Scope of this feature equals Phases A–C of the source plan (guardrails, high-churn extraction + capture ports, auth split). Phases D–E (capture registry hygiene, path injection, page-controller splits, institution setup) are follow-ups unless pulled in without expanding P1.
- “Staff” means the teachers/staff communication module and its tables as used today, not a new HR product area.
- Sync engine modularization already completed is left intact; this feature does not redesign push/pull transport.
- Arabic user-facing messaging and role model remain as currently shipped.

## Out of Scope

- Big-bang rewrite of all communication-layer modules that still contain storage access.
- Moving pure browser-side academic math (risk index, averages, proctor solver, import-center orchestration) into the main process.
- Replacing the remote identity provider or the local database product.
- Renaming for style only; full security audit; UI redesign of large page controllers (except incidental touch while preserving behavior).
- Institution linking/setup service extraction (listed as later optional work in the source plan).

## Dependencies

- Source architecture plan: `docs/plans/2026-07-17-layering-architecture-review-plan.md`
- Existing write-channel checklist: `docs/plans/2026-07-15-add-write-channel-checklist.md`
- Existing thin data-access pattern for students, grades, and absences
- Existing smoke/parity suite as release gate
