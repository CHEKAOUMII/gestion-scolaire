# Resolver & Error Contracts: Stage Rules

## Resolution precedence (per plan §2 contract, Slice 2 revision)

Given a request `(cycleCode, levelCode, streamCode, subjectCode, schoolYear)` against the **active rule set** of `schoolYear`:

1. **Exact**: `(cycle, level, stream, subject)` — any source; **custom beats official** when both exist for the same key.
2. **Stream wildcard**: `(cycle, level, stream='*', subject)`.
3. **Level wildcard**: `(cycle, level='*', stream, subject)` then `(cycle, level='*', stream='*', subject)`.
4. **Missing**: no row in any step → **`MISSING_RULE`** domain error (result marked incomplete, `officialExportBlocked: true`).

The former cycle-default step (`cycle_code='*'`) was **deleted in Slice 2** (isolation plan): a `cycle_code: '*'` row never matches in coefficients, exam counts, or weights. Cross-cycle reads fail closed instead of resolving another stage's rules.

**No silent fallback to hardcoded constants** at any point. A missing cycle context on any authoritative path fails closed with **`RULES_UNAVAILABLE`** (never a qualifiant default).

## Context derivation (`js/cc-rules.js`)

- `buildCoefficientContext` dispatches on a minimal stage-keyed config (`STAGE_GRADING_POLICIES`), not a `StageGradingPolicy` interface: both stages share the exact same resolution machinery and differ only in derivation — level source, stream default, cycle label. A 4-method per-stage interface would duplicate identical resolvers.
- **Collegial** (`secondary_collegial`): level derived from the section via `EdCollegialLevels.matchLevelFromSection` (`js/shared/education/collegial-levels.js`); `streamCode` defaults to `'*'` (no stream dimension; official rows are seeded with `stream_code='*'`). `detectBranch` returns `null` for collegial sections, so branch inference can never supply the level here.
- **Qualifiant** (`secondary_qualifiant`): unchanged — branch + `inferQualifiantLevel` (official qualifiant rows are keyed at coarse `2BAC`/`1BAC`/`TC` level codes with branch stream codes).
- Explicit context fields always win over derivation.

## Renderer integration (`js/cc-rules.js`)

- `ensureStageRuleSet(schoolYear, cycleCode?)` — async load via `window.api.stageRules.getActive(schoolYear)`; replaces `ensureSubjectCoefficientMappings()`. Cache per page, keyed by **`(schoolYear, cycleCode)`**; a payload cached for one stage is never served to another stage's context (`getActiveRuleSetPayload` returns null → callers fail closed with `RULES_UNAVAILABLE`). `clearStageRuleSetCache()` invalidates the cache and any in-flight load; the stage switch path calls it defensively on `cycles.setActive` / `app:beforeCycleChange`. The `cycleCode` argument stays optional while pages migrate; unkeyed loads keep serving until cleared.
- `resolveSubjectCoefficient(subjectName, branch, context)` — 4-step precedence; context gains `ruleSet` + `schoolYear`; missing cycle → `RULES_UNAVAILABLE`.
- `resolveExamCount(subjectName, branch, context)` — exact level → level wildcard (`'*'`); missing cycle → `RULES_UNAVAILABLE`.
- `resolveSubjectWeights(subjectName, context)` — exact `(cycle, subject)` match only (no `'*'` fallback); missing cycle → `RULES_UNAVAILABLE`, unseeded subject (e.g. collegial TECHNOLOGY) → `MISSING_RULE`.
- `computeSubjectAverage` / `computeWeightedGeneralAverageResult` unchanged in signature; missing coefficients already produce `{ok:false, incomplete:true, ...}` — now with rule-set data instead of the legacy override list. The average preflights cycle context and rule-set availability with `RULES_UNAVAILABLE`.
- Legacy `CC_BRANCH_COEFFICIENTS` table: deprecated, rollback-only. Authoritative resolution never reads it; the sole accessor is the explicit non-authoritative `resolveProvisionalBranchCoefficient()` helper (`isAuthoritative: false`, `provisional: true`, `officialExportBlocked: true`) for legacy display widgets only — `isOfficialExportAllowed` keeps blocking official output for its results.

## Error contract (`js/shared/errors/stage-rules-error-contract.js`)

Dual-export IIFE (CommonJS + browser global `StageRulesErrorContract`), mirroring `subject-coefficient-error-contract.js` (112-line pattern) and the 028 dual-export convention.

| Code | Severity | Meaning |
|---|---|---|
| `RULES_UNAVAILABLE` | error | No active rule set for the school year (or IPC load failed), no cycle context, or cross-stage cache read. `officialExportBlocked: true` |
| `MISSING_RULE` | error | No rule at any precedence step for a subject. `officialExportBlocked: true`, `missingCoefficient: true` |
| `INVALID_RULE_VERSION` | error | Write targeted a `closed`/non-active version |

Helpers: `createIncompleteResultMetadata(...)` (status `incomplete`, `officialExportBlocked: true`), `isOfficialExportAllowed(result)` — same shape as the existing contract so existing gates keep working.

## Export gates

- **Reuse existing**: `grades-results.html:568` and `student-profile.js:3219` already gate on `isOfficialExportAllowed` / `officialExportBlocked` — they now see rule-set-based metadata with zero changes to the gate logic.
- **Deferred**: main-side gate at `reports:printDocument` (`main/ipc/reports.js:40`) — requires renderer-supplied metadata; follow-up in M3/M4, not v1 blocking.
- Legacy audit filter (`SUBJECT_COEFFICIENT_ADMIN_OVERRIDE`) stays read-only.

## Golden coverage

- Qualifiant: `tests/cc-rules-coefficient-golden.test.js` (full-context paths unchanged).
- Collegial: `tests/cc-rules-collegial-golden.test.js` (1APIC/2APIC Σ=29, 3APIC CC=1, stream `'*'`, TECHNOLOGY weights `MISSING_RULE`, `'*'`-row regression, missing-cycle `RULES_UNAVAILABLE`, provisional helper).
- Cache isolation: `tests/cc-rules-stage-cache.test.js` (`(schoolYear, cycleCode)` keying, cross-cycle fail-closed, `clearStageRuleSetCache()`).
