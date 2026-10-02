# ADR: Keep the 08-03 level-display mechanism (no route-by-active-cycle display)

- Date: 2026-10-01
- Status: Accepted
- Plan: `docs/plans/2026-09-27-isolation-principle-stage-separation(1).md`, Slice 0 decision gate 2
- Prior decision: `docs/plans/2026-08-03-collegial-level-normalization.md`

## Context

`getLevelFromSection` is qualifiant-only (`3APIC-1` resolves to
`{code:'other'}`). The 08-03 plan deliberately chose not to change it:
collegial levels display via official level names
(`appDefaults:listLevels` + `classes:getAll`, consumed by FilterManager).
The isolation plan needs collegial level/stream derivation for the
grading pipeline, which raised the question of whether display routing
should also become cycle-aware.

## Options considered

1. **Route level display by active cycle** (`EdCollegialLevels` vs
   `EdQualifiantLevels`), superseding the 08-03 decision.
2. **Keep the 08-03 mechanism** and scope level/stream derivation to the
   grading pipeline only.

## Decision

Keep the 08-03 mechanism. No route-by-active-cycle display routing is
implemented; `getLevelFromSection` stays qualifiant-only and untouched.

## Rationale

- Display is already correct via official level names; routing display by
  cycle would add a second mechanism plus supersede churn for zero
  user-visible gain.
- Grading derivation is isolated where stage context is authoritative:
  the collegial policy in `js/cc-rules.js`
  (`deriveCollegialLevelFromSection` via
  `js/shared/education/collegial-levels.js`, `streamCode = '*'`).
- The plan forbids implementing both mechanisms; one had to win.

## Consequences

- Never route display code by active cycle to work around
  `getLevelFromSection`; collegial display keeps flowing through
  `listLevels(cycleCode)` / official names.
- Revisit only if display genuinely needs stage-specific level
  presentation that official names cannot express.
- Same note lives in code at `js/pages/settings-defaults.js`
  (`stageLevelLabel`) and is pinned by
  `tests/stage-ui-isolation.test.js`.
