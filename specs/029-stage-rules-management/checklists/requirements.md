# Requirements Checklist: Stage Rules Management

**Purpose**: Validates that the feature specification covers all requirements from `docs/plans/2026-08-01-stage-rules-management.md` — user journeys, functional requirements, entities, edge cases, and measurable success criteria.
**Created**: 2026-08-01
**Feature**: [spec.md](./spec.md)

**Note**: This checklist is generated based on feature context and requirements. Each item was validated against the spec; see Validation Results below.

## User Journeys & Priorities

- [x] US-001 All user stories are prioritized (P1/P2/P3) and ordered by importance (P1 first)
- [x] US-002 Each story is independently testable and delivers standalone value
- [x] US-003 Core value (editing coefficients/exam counts with versioning) is P1
- [x] US-004 Result-integrity story (missing rules block export, no silent fallback) is P1
- [x] US-005 Official-update-preserves-overrides story is P2 and covers old-device regression protection
- [x] US-006 Restore-official story is P2 and covers both per-row and bulk (with confirmation)
- [x] US-007 Audit-trail story is P3

## Functional Requirements Coverage

- [x] FR-001 Editor exists and is admin/principal accessible (settings «قواعد المرحلة»)
- [x] FR-002 Cycle authorization scoping (principal: values only; admin: + catalog)
- [x] FR-003 Editable coefficient (1–20) and exam count (1–12) values
- [x] FR-004 Mandatory reason + audit record (actor, before/after, timestamp, version) on every change
- [x] FR-005 Saving creates a new version; prior version frozen and governs historical results
- [x] FR-006 School-year scoping with at most one active version per year
- [x] FR-007 Official rules ship with app and refresh on upgrade; custom overrides carry forward
- [x] FR-008 Sync prevents older app versions from overwriting newer official rules
- [x] FR-009 Restore-to-official per row and bulk with confirmation
- [x] FR-010 Calculations use active version; missing rules mark results incomplete and block export
- [x] FR-011 Primary cycle has no coefficients; controls hidden
- [x] FR-012 Legacy overrides migrate as custom rows; unmappable entries reported, never guessed
- [x] FR-013 Changes appear in activity log under legacy filter, read-only
- [x] FR-014 Rules reference catalog subjects/levels; no free-text subject names

## Key Entities & Data

- [x] ENT-001 School Year entity defined with one-active-version constraint
- [x] ENT-002 Rule Version entity defined (draft/active/closed + revision ordering)
- [x] ENT-003 Subject Coefficient Rule entity defined (resolution scope + official/custom source)
- [x] ENT-004 Exam Count Rule entity defined (official/custom source)
- [x] ENT-005 Subject/Level Catalog entities defined as the reference source for rules
- [x] ENT-006 Audit Entry entity defined (actor, reason, before/after, version, timestamp)

## Edge Cases & Error Handling

- [x] EC-001 Unauthorized cycle access rejected
- [x] EC-002 Empty/oversized reason rejected
- [x] EC-003 Out-of-range coefficient (1–20) or exam count (1–12) rejected inline
- [x] EC-004 Subject with no rule in active version → incomplete results, export blocked
- [x] EC-005 Concurrent edits from two devices → conflict notice, no silent data loss
- [x] EC-006 New school year startup behavior defined
- [x] EC-007 Legacy migration with unmappable subject names reported explicitly
- [x] EC-008 Official update against a closed version leaves the closed version intact
- [x] EC-009 Editing a closed version is blocked with an explanation

## Success Criteria

- [x] SC-001 Locate-and-edit a rule in under 1 minute
- [x] SC-002 100% of changes carry reason + actor; trail reconstructs every version
- [x] SC-003 100% of published results unchanged by later edits
- [x] SC-004 100% of custom overrides survive official updates
- [x] SC-005 Rule changes propagate to other devices after sync
- [x] SC-006 Missing rules block export 100% of the time (zero silent fallbacks)
- [x] SC-007 Migration preserves 100% of legacy overrides; none silently dropped
- [x] SC-008 Rule changes visible in activity log within the same session

## Scope Discipline

- [x] SC-009 Out-of-scope items stated (weights deferred; theming excluded; legacy-year settings untouched)
- [x] SC-010 No [NEEDS CLARIFICATION] markers remain (plan documents defaults for all open points)
- [x] SC-011 Spec is technology-agnostic — no implementation details (table names, IPC, file paths)

## Validation Results

| Item | Result | Evidence |
|------|--------|----------|
| All 7 user stories present with priorities | PASS | spec.md «User Scenarios & Testing» |
| All 14 functional requirements present | PASS | spec.md «Functional Requirements» |
| All 6 entity definitions present | PASS | spec.md «Key Entities» |
| All 9 edge cases present | PASS | spec.md «Edge Cases» |
| All 8 success criteria present and measurable | PASS | spec.md «Success Criteria» |
| Out-of-scope documented | PASS | spec.md «Non-Goals / Out of Scope» |
| No NEEDS CLARIFICATION markers | PASS | full-spec scan |
| No implementation details leaked into spec | PASS | full-spec scan (SQL/IPC/file names absent) |

**Validation outcome**: 8/8 checks PASS. The spec fully reflects the plan's agreed decisions (decisions 4–6, M1–M4, §5–§7). No failures to resolve; the feature is ready for `/speckit.plan`.

## Notes

- Spec written from the revised plan after review: versioning via immutable rule versions, official/custom coexistence, no older-revision overwrite, weights deferred, precedence contract, RULES_UNAVAILABLE behavior.
- Repository layer decisions (entity registry, `id` + logical UNIQUE keys, migration shape) are implementation details intentionally kept out of the spec.
