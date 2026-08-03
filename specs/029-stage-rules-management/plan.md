# Implementation Plan: Stage Rules Management

**Branch**: `029-stage-rules-management` | **Date**: 2026-08-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/029-stage-rules-management/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Stage grading rules (subject coefficients + exam counts) are hardcoded or legacy-blob based today. This feature turns them into versioned, editable, synced institutional catalogs: admin/principal edit values per school year, every save creates a new immutable rule version (revision), official rules ship with app upgrades while custom overrides survive, all changes are reason-required and audited (`STAGE_RULE_OVERRIDE`), missing rules block official export (`RULES_UNAVAILABLE`/`MISSING_RULE`) with no silent fallback. Technical approach (research D1–D7): explicit outbox sync capture for three rule tables (`stage_rule_sets`, rebuilt `subject_coefficients`, rebuilt `exam_count_rules`), a `stage_rule_sets` apply-hook revision guard, migration `2026-08-001-stage-rules-management` (rebuild + backfill + unmappable logging), renderer-side 4-step precedence resolver, and a new dual-export error contract. Weights (`subject_weights`) deferred; depends on sibling `primary-stage-catalogs` (catalogs + `cycle_profiles.uses_coefficients`).

## Technical Context

**Language/Version**: JavaScript (CommonJS) on Electron 35 / Node.js runtime; vanilla renderer scripts
**Primary Dependencies**: `better-sqlite3`; existing modules: `main/repos/capture-port.js`, `main/sync/capture.js`, `main/sync/entity-registry.js`, `main/sync/engine/*`, `main/ipc/ipc-helpers.js` (`handleAuthedRead`, `handleWriteSoftAuth`, `resolveCycleForRequest`), `main/db/schema.js` (`ensureColumn`, `rebuildTableWithConstraints`, `ensureCycleReferenceSchema` pattern), `js/shared/errors/*` (028 dual-export pattern)
**Storage**: SQLite via better-sqlite3; new migration `2026-08-001-stage-rules-management`; canonical DDL helper `ensureStageRulesSchema(db)` in `schema.js`
**Testing**: `npm test` (incl. `sync-entity-registry.test.js`, `sync-bulk-channels-explicit.test.js`, `cc-rules-coefficient-golden.test.js`), `npm run test:smoke` (CI gate), `npm run lint`
**Target Platform**: Electron desktop (Windows), multi-page HTML, `contextIsolation: true`, preload bridge
**Project Type**: Desktop app (Electron); layered main-process (repos/IPC per 027), renderer pages per `js/pages/*.js`
**Performance Goals**: rules tables are small (hundreds of rows); resolver loads the active set once per page (cached); no full-table scans; report/export latency budget unchanged (<5s single / <30s class batch)
**Constraints**: RTL-first Arabic UI (logical CSS properties, `dir="rtl" lang="ar"`); dark mode via `@variant dark`; no bundlers/CDN; smoke-test IPC parity (three-file rule); migrations forward-only/idempotent (`ensureColumn`, `INSERT OR IGNORE`, no duplicate DDL); sync revision ordering — old devices must never downgrade official rules
**Scale/Scope**: ~15 qualifiant branches, 42 level codes, 15 default subjects; rule tables ≈ 500–1000 rows total; multi-device sync per institution

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence |
|---|---|---|---|
| I-1 | Formatting: Prettier, single quotes, 4-space, 120 chars | ✅ planned | all new files authored to this style; `npm run format` gate in tasks |
| I-2 | Naming: camelCase vars, snake_case columns, kebab-case IPC channels | ✅ planned | `stageRuleSet`/`subject_coefficients`/`stageRules:getActive` |
| II-1 | Smoke parity: preload ↔ handlers | ✅ planned | three-file rule: `main/ipc/stage-rules.js` + `registerAll.js` + `preload.js` (D0 plan) |
| II-2 | Migration idempotency: `ensureColumn`, no duplicate DDL | ✅ planned | `ensureStageRulesSchema` helper called by migration; `rebuildTableWithConstraints` for exam_count_rules rebuild |
| III-1 | RTL-first Arabic UI | ✅ planned | new «قواعد المرحلة» tab; logical properties; Arabic strings |
| III-2 | Dark mode + accessibility | ✅ planned | tab follows `@variant dark`; labels/keyboard nav |
| IV-1 | Handler wrappers only (`handleAuthedRead`/`handleWriteSoftAuth`) | ✅ planned | all four new channels wrapped; no raw `ipcMain.handle` |
| IV-2 | DB discipline: FK ON, school_year filtering, UNIQUE coercion | ✅ planned | `rule_set_id` FK; year via rule set; logical UNIQUEs with non-NULL dims |
| IV-3 | No bundler / no CDN | ✅ no change | vanilla JS; error contract is dual-export IIFE |
| V-1 | No full scans on partitioned tables | ✅ planned | rule tables are reference-sized; index on `stage_rule_sets(school_year)`, `*_rules(rule_set_id)` |
| SEC-1 | Write auth roles; session-based actor | ✅ planned | admin+principal; `withContext: true`; audit via session |
| WF-1 | Branch discipline | ✅ satisfied | on `029-stage-rules-management` |

**Pre-research result: PASS — no violations.**
**Post-design result: PASS** (see Complexity Tracking: none required — the plan introduces no new architectures beyond established 027/repo/sync conventions; the only new sync-layer code is the single `stage_rule_sets` apply hook, which is the registry's existing extension point, not a new pattern).

## Project Structure

### Documentation (this feature)

```text
specs/029-stage-rules-management/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # /speckit.specify output
├── research.md          # Phase 0 output — decisions D1–D7
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── stage-rules.ipc.md    # IPC channels + auth + registry entries
│   ├── sync-entities.md      # entity-registry entries, guards, contractVersion
│   └── resolver.md           # precedence + error contract + export gates
├── checklists/requirements.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
main/
├── db/
│   ├── schema.js                      # ensureStageRulesSchema() canonical DDL (new)
│   ├── migrations.js                  # 2026-08-001-stage-rules-management (new)
│   └── education-catalogs/            # seed modules extracted from CC_BRANCH_COEFFICIENTS (new)
│       ├── qualifiant-coefficients.js
│       └── subject-aliases.js
├── repos/
│   ├── stage-rules.js                 # active-set read, save/reset (new; explicit capture)
│   └── subject-coefficients.js        # legacy JSON path retired → rollback-only
├── ipc/
│   ├── stage-rules.js                 # 4 channels (new)
│   ├── registerAll.js                 # registration (edit)
│   └── appDefaults.js                 # lookupExamCount reads active rule set (edit)
├── sync/
│   ├── entity-registry.js             # 3 entries + revisionGuard apply hook (edit)
│   ├── capture.js                     # 3 channel entries, explicit+exclude (edit)
│   └── engine/helpers.js              # TOPO_ORDER_PUT additions (edit)

preload.js                             # window.api.stageRules (edit)

js/
├── shared/errors/
│   └── stage-rules-error-contract.js  # dual-export contract (new)
├── cc-rules.js                        # resolver: 5-step precedence + rule-set load (edit)
├── data/education-catalogs.js         # canonical codes/labels source for renderer (new, thin)
└── pages/
    ├── settings-defaults.js           # «قواعد المرحلة» tab logic (edit)
    └── settings-logs.js               # STAGE_RULE_OVERRIDE filter (edit)

settings-defaults.html                 # new tab (edit; dir="rtl" lang="ar")
settings-logs.html                     # audit filter read-only (edit)

tests/
├── sync-entity-registry.test.js       # 3 new entries (edit)
├── sync-bulk-channels-explicit.test.js# stays green (edit)
├── stage-rules-migration.test.js      # backfill/unmappable/zero-outbox (new)
├── stage-rules-repo.test.js           # version-copy, closed-immutable, custom>official (new)
├── stage-rules-resolver.test.js       # precedence branches + RULES_UNAVAILABLE (new)
└── cc-rules-coefficient-golden.test.js# updated contexts (edit)
```

**Structure Decision**: single project (existing repo layout). Feature follows the established main-process layering (027): domain SQL in `main/repos/stage-rules.js`, IPC handlers thin (auth/validate/call/map), change-tracking via `main/repos/capture-port.js`, frontend in `js/pages/settings-defaults.js` + the new tab in `settings-defaults.html`. No new directories beyond `main/db/education-catalogs/` (seed modules) and the shared error contract alongside the existing 028 contracts.

## Complexity Tracking

> Not required — Constitution Check passed both gates with no violations (see Constitution Check).
