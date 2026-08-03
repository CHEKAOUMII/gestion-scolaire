# Resolver & Error Contracts: Stage Rules

## Resolution precedence (per plan §2 contract)

Given a request `(cycleCode, levelCode, streamCode, subjectCode, schoolYear)` against the **active rule set** of `schoolYear`:

1. **Exact**: `(cycle, level, stream, subject)` — any source; **custom beats official** when both exist for the same key.
2. **Stream wildcard**: `(cycle, level, stream='*', subject)`.
3. **Level wildcard**: `(cycle, level='*', stream, subject)` then `(cycle, level='*', stream='*', subject)`.
4. **Cycle default**: `(cycle, level='*', stream='*', subject)` with `cycle_code='*'` fallback row if present.
5. **Missing**: no row in any step → **`MISSING_RULE`** domain error (result marked incomplete, `officialExportBlocked: true`).

**No silent fallback to hardcoded constants** at any point.

## Renderer integration (`js/cc-rules.js`)

- `ensureStageRuleSet(schoolYear)` — async load via `window.api.stageRules.getActive(schoolYear)`; replaces `ensureSubjectCoefficientMappings()` (cc-rules.js:897-912). Cache per page.
- `resolveSubjectCoefficient(subjectName, branch, context)` (cc-rules.js:771-796) extended to the 5-step precedence; context gains `ruleSet` + `schoolYear`; level inferred via `inferQualifiantLevel(branch)` when absent (today's callers pass only `{schoolYear, streamCode}` — gap documented in research D5; `grades-results.html` already passes `cycleCode`).
- `computeSubjectAverage` / `computeWeightedGeneralAverageResult` unchanged in signature; missing coefficients already produce `{ok:false, incomplete:true, ...}` — now with rule-set data instead of the legacy override list.

## Error contract (`js/shared/errors/stage-rules-error-contract.js`)

Dual-export IIFE (CommonJS + browser global `StageRulesErrorContract`), mirroring `subject-coefficient-error-contract.js` (112-line pattern) and the 028 dual-export convention.

| Code | Severity | Meaning |
|---|---|---|
| `RULES_UNAVAILABLE` | error | No active rule set for the school year (or IPC load failed). `officialExportBlocked: true` |
| `MISSING_RULE` | error | No rule at any precedence step for a subject. `officialExportBlocked: true`, `missingCoefficient: true` |
| `INVALID_RULE_VERSION` | error | Write targeted a `closed`/non-active version |

Helpers: `createIncompleteResultMetadata(...)` (status `incomplete`, `officialExportBlocked: true`), `isOfficialExportAllowed(result)` — same shape as the existing contract so existing gates keep working.

## Export gates

- **Reuse existing**: `grades-results.html:568` and `student-profile.js:3219` already gate on `isOfficialExportAllowed` / `officialExportBlocked` — they now see rule-set-based metadata with zero changes to the gate logic.
- **Deferred**: main-side gate at `reports:printDocument` (`main/ipc/reports.js:40`) — requires renderer-supplied metadata; follow-up in M3/M4, not v1 blocking.
- Legacy audit filter (`SUBJECT_COEFFICIENT_ADMIN_OVERRIDE`) stays read-only.
