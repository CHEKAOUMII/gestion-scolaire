# Feature Specification: Stage Rules Management

**Feature Branch**: `029-stage-rules-management`
**Created**: 2026-08-01
**Status**: Draft
**Input**: `docs/plans/2026-08-01-stage-rules-management.md`

## Summary

Stage grading rules — subject coefficients, integrated-activity weights, and exam counts — are currently hardcoded in the application. This feature makes them editable institutional catalogs: administrators and principals can view and change the rules that apply to the active school year, every change is versioned, explained, and audited, and custom changes survive official rule updates shipped with application upgrades. The first release covers **subject coefficients and exam counts**; integrated-activity weights are explicitly deferred to a later release.

## User Scenarios & Testing

### User Story 1 - Edit stage rules for the current school year (Priority: P1)

An authorized admin or principal opens the stage rules editor (the «قواعد المرحلة» tab in settings), selects a school year, cycle, level, stream, and subject, and changes a coefficient or exam count. The change is applied to a **new rule version**; the previous version stays frozen and keeps governing already-published results. Every save requires the user to state a reason.

**Why this priority**: This is the core value — schools must be able to adjust grading rules without a developer. Everything else (versioning, sync, restore) protects this capability.

**Independent Test**: Can be fully tested by opening the editor as an admin, editing one coefficient for a known subject, and confirming the new value is used in a student's average while the previous version remains visible and frozen.

**Acceptance Scenarios**:

1. **Given** an authenticated admin on a school year with an active rule version, **When** they change a coefficient with a reason and save, **Then** a new version becomes active, the change takes effect, and a frozen version history exists.
2. **Given** the editor open on a closed (frozen) version, **When** the user attempts to edit a value, **Then** editing is blocked with an explanatory message.
3. **Given** the user tries to save without a reason, **When** they submit, **Then** the save is rejected and the reason is requested.
4. **Given** a primary-stage cycle (no coefficients), **When** the user opens its rules, **Then** coefficient controls are hidden; only exam counts appear.

---

### User Story 2 - Rules govern grade results; missing rules never silently change grades (Priority: P1)

All grade calculations for a school year use the active rule version. If rules are missing or unavailable (e.g., no active version exists), results are marked incomplete and official exports are blocked with a clear, actionable message instead of falling back to a silent default.

**Why this priority**: Trust in published results is the foundation; a silent fallback would corrupt results with no trace.

**Independent Test**: Can be fully tested by deleting/missing a rule for one subject and confirming the subject's results are flagged incomplete and official export is refused with the explanatory message.

**Acceptance Scenarios**:

1. **Given** a school year with an active rule version, **When** a student's average is calculated, **Then** the value matches the rules of the active version.
2. **Given** a subject whose rule is missing in both official and custom rules, **When** a result is produced, **Then** it is marked incomplete and official export is blocked with an explanation.
3. **Given** no active rule version for a school year, **When** official export is attempted, **Then** it is blocked and the user is told how to resolve the situation.

---

### User Story 3 - Official rule updates preserve custom overrides (Priority: P2)

Official rules ship with the application and are refreshed on upgrades. When an official update arrives, all custom (user-made) overrides carry forward unchanged and remain editable; the admin can see which rows are custom versus official. A device running an older application version must never push stale official rules over newer ones.

**Why this priority**: This is what makes the system safe to upgrade and is required before the first official refresh is ever shipped.

**Independent Test**: Can be fully tested by applying a newer official rule set, then confirming every custom override from the previous version is still present and unchanged, and that the official row values updated only where custom overrides do not exist.

**Acceptance Scenarios**:

1. **Given** a custom override for subject X in the current school year, **When** a new official rule version is applied, **Then** the custom override remains and the official row behind it updates.
2. **Given** a device running an older app version syncing into a device with a newer active official version, **When** sync happens, **Then** the newer official rules are not overwritten (revision ordering prevents regressions).
3. **Given** the rules editor, **When** a custom row is shown, **Then** it is visually distinguished from an official row.

---

### User Story 4 - Restore official default values (Priority: P2)

An admin can restore a single rule to its official default, or restore every custom rule in the scope back to official in bulk. Bulk restore requires an explicit confirmation step and a reason, and the action is versioned and audited like any other change.

**Why this priority**: Lets schools undo mistakes cleanly; the bulk path saves significant time when reverting a poorly-tuned year.

**Independent Test**: Can be fully tested by creating two custom rules, restoring one per-row, then restoring the rest in bulk with confirmation, and confirming both the values and the audit entries.

**Acceptance Scenarios**:

1. **Given** a custom rule with a modified value, **When** the user restores it to official, **Then** the value returns to the official value and a new version records the change.
2. **Given** multiple custom rules, **When** bulk restore is confirmed with a reason, **Then** all are reset to official and the action appears in the audit trail.
3. **Given** bulk restore, **When** the confirmation step is declined, **Then** nothing changes.

---

### User Story 5 - Audit trail for every rule change (Priority: P3)

Every rule change is recorded in the activity log with the actor, the reason, the before/after values, and the version involved. The existing audit filter shows these entries read-only.

**Why this priority**: Accountability is required by school governance but is not blocking the core edit flow.

**Independent Test**: Can be fully tested by making two rule changes and confirming both appear in the audit log with actor, reason, and before/after values.

**Acceptance Scenarios**:

1. **Given** a rule change saved with a reason, **When** the activity log is filtered for rule changes, **Then** the entry shows actor, reason, before/after values, and version.
2. **Given** the audit screen, **When** a user opens it, **Then** the legacy rule-change filter remains visible and read-only.

---

### Edge Cases

- User with no access to a cycle (no cycle authorization) attempts to edit that cycle's rules — the attempt is rejected.
- Reason field is empty or exceeds the maximum length — save is rejected with a clear message.
- Coefficient outside the allowed range (1–20) or exam count outside 1–12 — rejected on input with an inline error.
- A subject exists in grade data but has no rule in the active version (neither official nor custom) — results incomplete, export blocked (US-2).
- Two devices edit the same rule concurrently — the outcome is communicated clearly (a conflict notice), never silent data loss.
- New school year is created — it starts with the previous year's rules as a base or with the current official version (per the year-close default), and is editable before any results exist.
- Legacy stored overrides from the old system reference a subject that no longer exists in the catalog — the migration reports it explicitly instead of guessing; nothing is lost silently.
- Official update arrives for a school year that already has a frozen (closed) version — the closed version remains intact; the active version is the one refreshed.
- Exam-count rules for primary cycle (which has no coefficients) — only exam counts apply.

## Requirements

### Functional Requirements

- **FR-001**: The application MUST provide an admin/principal-accessible stage rules editor (settings «قواعد المرحلة») listing subjects, levels, and exam counts per cycle for a selected school year.
- **FR-002**: The editor MUST scope visible cycles to the user's cycle authorization (principals edit values only; admins may also manage the official catalog).
- **FR-003**: The user MUST be able to edit subject coefficients (range 1–20) and exam counts (range 1–12) for any level/stream/subject of an active school year.
- **FR-004**: Every rule change MUST require a mandatory reason (bounded length) and MUST record actor, before/after values, timestamp, and the rule version.
- **FR-005**: Saving a rule change MUST create a new rule version; the prior version MUST remain frozen and MUST keep governing historical results.
- **FR-006**: Rules MUST be scoped to a school year, with at most one active version per school year.
- **FR-007**: Official rules MUST ship with the application and refresh on upgrade; custom overrides MUST carry forward unchanged and remain editable.
- **FR-008**: Rule sync between devices MUST prevent an older application version from overwriting newer official rules.
- **FR-009**: The user MUST be able to restore a single rule to its official default, and MUST be able to bulk-restore with an explicit confirmation and reason.
- **FR-010**: Grade calculations MUST use the active rule version of the school year; a missing rule or missing active version MUST mark results incomplete and block official export with an explanatory message (no silent fallback).
- **FR-011**: The primary cycle MUST use no coefficients; its editor MUST hide coefficient controls.
- **FR-012**: Existing custom overrides stored by the legacy system MUST migrate into the new structure as custom rows; unmappable legacy entries MUST be reported explicitly, never guessed.
- **FR-013**: All rule changes MUST appear in the activity log under the legacy rule-change filter, read-only.
- **FR-014**: Subjects and levels in rules MUST come from the institutional catalogs; free-text subject names MUST NOT be used in rule definitions.

### Key Entities

- **School Year**: The period to which a rule version belongs; exactly one active rule version per school year.
- **Rule Version**: An immutable, frozen set of rules (status: draft / active / closed). Drafts are editable; active governs current calculations; closed versions are locked and keep producing historical results. Versions carry a revision number for ordering.
- **Subject Coefficient Rule**: The coefficient applied to a subject in a level/stream/cycle (cycle/level/stream/subject resolution), with a source of official or custom.
- **Exam Count Rule**: The number of exams per subject in a cycle/level for a school year, with a source of official or custom.
- **Subject / Level Catalog**: Canonical lists of subjects and levels that rules reference.
- **Audit Entry**: The record of a rule change: actor, reason, before/after values, version, timestamp.

## Success Criteria

### Measurable Outcomes

- **SC-001**: An authorized user can locate and edit a rule for any subject in under 1 minute without leaving the settings screen.
- **SC-002**: 100% of rule changes carry a recorded reason and actor; the audit trail reconstructs every version of every rule.
- **SC-003**: 100% of past published results remain unchanged after later rule edits (frozen versions never retroactively change).
- **SC-004**: 100% of custom overrides survive an official rules update in the same school year.
- **SC-005**: A rule change made on one device appears on other devices after sync without manual re-entry.
- **SC-006**: Missing or unavailable rules block official export 100% of the time with an explanatory message; zero silent fallbacks.
- **SC-007**: Legacy migration preserves 100% of existing custom overrides; every unmappable entry is reported, none are silently dropped.
- **SC-008**: All rules-related changes (save, restore, official refresh) are visible in the activity log within the same session.

## Non-Goals / Out of Scope

- Integrated-activity weights editing (deferred to a later release after versioning and freeze are proven in production).
- Visual theming of the application (a separate concern; the rules editor is a settings tab, not a theme).
- Changes to existing exam-count settings for years already published under the old system.
