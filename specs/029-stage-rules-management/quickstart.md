# Quickstart: Stage Rules Management

**Branch**: `029-stage-rules-management` | **Date**: 2026-08-01

## Commands

```powershell
npm install            # first time (Electron 35 + better-sqlite3 prebuilt)
npm run dev            # launch the app (manual RTL verification — mandatory for UI changes)
npm run css:build      # Tailwind compile (must be <10s)
npm run lint           # ESLint flat config, zero errors
npm test               # full suite (includes sync-entity-registry, sync-bulk-channels-explicit)
npm run test:smoke     # CI gate: preload/IPC parity, no CDN refs
```

## Verify the feature (manual smoke)

1. `npm run dev` → settings → «قواعد المرحلة» tab appears (RTL Arabic, dark-mode aware).
2. As admin: pick current school year → cycle → level/stream → subject → change coefficient (1–20) with a reason → save → version badge increments (revision N+1), previous version shows `closed`.
3. As principal: same flow works; catalog controls (subjects/levels) hidden.
4. Save without a reason → rejected with inline message.
5. Try editing a `closed` version → blocked with explanation.
6. Grades pages (`grades-results.html`, results-hub, student profile): averages reflect the new coefficient; missing rule → results flagged incomplete, export button disabled (official export blocked).
7. Two devices: change a coefficient on A → sync → B shows the new version; an old app version cannot push its stale rules over the new ones.

## Migration check

- `2026-08-001-stage-rules-management` runs on upgrade: legacy `subjectCoefficientMappings:v1` rows become `custom` rows in the year's active rule set; unmappable subjects logged in `system_logs` (not guessed); `exam_count_rules` rebuilt with `id`/`rule_set_id`/`cycle_code`/`subject_code`/`source`; zero outbox rows created.

## Validation status (2026-08-02)

| Step | Status |
|---|---|
| `npm run css:build` | ✅ clean |
| `npm run lint` | ✅ 0 errors (55 pre-existing warnings) |
| `npm test` | ✅ 241/241 (includes `stage-rules-{repo,migration,resolver,upgrade}`, rewritten golden/subject-coefficient tests) |
| `npm run test:smoke` | ✅ all checks passed (IPC parity 241 channels) |
| Migration check | ✅ automated in `tests/stage-rules-migration.test.js` (upgrade + fresh install, idempotent re-run, zero outbox) |
| Steps 4–5 (reason required, closed-version lock) | ✅ repo tests (`REASON_REQUIRED`, `INVALID_RULE_VERSION`) + resolver/IPC error mapping |
| Step 6 (no silent fallback, export blocked) | ✅ `tests/stage-rules-resolver.test.js` (MISSING_RULE / RULES_UNAVAILABLE, officialExportBlocked) + gates migrated in T021 |
| Step 7 old-device downgrade guard | ✅ `tests/stage-rules-upgrade.test.js` (`revisionGuard` defers stale PUTs) + explicit outbox capture of new revisions |
| Steps 1–3 (interactive UI, two-device sync over network) | ⏳ manual — requires `npm run dev` + two running instances (static checks: tab exists with `dir="rtl" lang="ar"`, dark-mode classes, all controls wired) |

## Dependencies

- Sibling feature `primary-stage-catalogs` must land first (catalogs + `cycle_profiles.uses_coefficients`).
- See `research.md` D1–D7 for the decisions backing these steps.
