<!--
  Sync Impact Report
  ==================
  Version change: 1.0.0 → 1.1.0

  Modified principles:
    - III. User Experience Consistency — expanded with RTL
      content-creation rules (new bullet: "RTL content authoring")

  Added sections: None
  Removed sections: None

  Templates checked:
    ✅ .specify/templates/plan-template.md — Constitution Check section
       aligns; no changes needed
    ✅ .specify/templates/spec-template.md — User scenarios and
       requirements sections compatible; no changes needed
    ✅ .specify/templates/tasks-template.md — Phase structure unchanged;
       no changes needed

  Follow-up TODOs: None
-->

# Gestion Scolaire (Pencil2) Constitution

## Core Principles

### I. Code Quality & Consistency

All code MUST conform to the project's established style and
structural conventions. This is non-negotiable.

- **Formatting**: Prettier enforced — single quotes, no trailing
  commas, 4-space indent, 120-char line width, semicolons.
  All code MUST pass `npm run format` without changes.
- **Linting**: ESLint flat config (v9) MUST pass with zero errors.
  `no-unused-vars` warnings MUST be resolved before merge for
  main-process code. Renderer code follows relaxed rules per
  `eslint.config.mjs`.
- **Naming**: Variables and functions MUST use camelCase. Database
  columns MUST use snake_case. IPC channel names MUST use
  kebab-case with domain prefix (e.g., `students:get-list`).
- **No dead code**: Unused functions, commented-out blocks, and
  orphaned files MUST be removed, not left for "later."
- **Single responsibility**: Each IPC module handles one domain.
  Each `js/pages/*.js` file serves exactly one HTML page. Shared
  utilities belong in `js/utils.js` or `js/ux-enhancements.js`.

### II. Testing Standards

Every change MUST be validated before merge. The smoke test suite
is the minimum quality gate.

- **CI gate**: `npm run test:smoke` MUST pass. CI runs:
  `npm ci` → `npm run css:build` → `npm run lint` →
  `npm run test:smoke`. A failing CI blocks all merges.
- **IPC parity**: The smoke test validates that channels declared
  in `preload.js` exactly match handlers registered in
  `main/ipc/*.js`. Any mismatch MUST be fixed before commit.
- **No CDN references**: All vendor libraries MUST be bundled
  in `vendor/`. The smoke test enforces zero external CDN
  references. No exceptions.
- **Migration idempotency**: Database migrations MUST use
  `ensureColumn()` for `ALTER TABLE` additions. Migrations
  MUST NOT duplicate DDL already present in `createTables()`.
- **Manual verification**: For UI changes, the developer MUST
  launch the app (`npm run dev`) and visually confirm the
  change renders correctly in both LTR debug and RTL Arabic
  modes before committing.

### III. User Experience Consistency

The application serves Arabic-speaking school administrators in
Morocco. Every UI decision MUST respect this context.

- **RTL-first**: All layout MUST use logical CSS properties
  (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`).
  Physical `left`/`right` utilities are prohibited in new code.
- **Arabic typography**: Font stacks MUST include Arabic-capable
  typefaces. Text content MUST render correctly in Arabic
  without truncation or overflow.
- **Consistent interaction patterns**: Toast notifications use
  `showToast()`. Sidebar behavior uses `setupSidebar()`.
  Keyboard shortcuts use the shared modal from
  `js/ux-enhancements.js`. New UI patterns MUST NOT
  duplicate or bypass these shared utilities.
- **Dark mode support**: All new styles MUST work under both
  light and `[data-theme="dark"]` themes. The `@variant dark`
  system in `css/tailwind-input.css` is the single mechanism.
- **RTL content authoring**: All user-facing text content
  MUST be written in right-to-left order. HTML elements
  containing Arabic text MUST set `dir="rtl"`. Placeholder
  attributes, tooltip strings, error messages, confirmation
  dialogs, and report body text MUST be authored in Arabic
  RTL. String concatenation MUST NOT produce mixed-direction
  output — use Unicode bidi isolates (`\u2068`/`\u2069`) or
  `<bdi>` tags when embedding LTR fragments (numbers, codes)
  within Arabic text. New HTML pages MUST include
  `dir="rtl" lang="ar"` on the `<html>` element.
- **Accessibility**: Interactive elements MUST be keyboard
  navigable. Form inputs MUST have associated labels.
  Color contrast MUST meet WCAG 2.1 AA for both themes.

### IV. Good Practices & Architecture

The Electron main/renderer process boundary is sacred. Shortcuts
that blur this boundary create security vulnerabilities and
maintenance debt.

- **IPC contract**: All renderer→main communication goes through
  `window.api` (defined in `preload.js`).
  `contextIsolation: true` is enforced. Direct `require()` or
  `remote` module usage is prohibited.
- **Three-file rule**: Adding a new IPC feature requires changes
  in exactly three places: (1) `main/ipc/[domain].js` handler,
  (2) `main/ipc/registerAll.js` registration, (3) `preload.js`
  exposure. Skipping any step will fail the smoke test.
- **Handler wrappers**: All IPC handlers MUST use `handleRead`,
  `handleWrite`, or `handleWriteNoAuth` from `ipc-helpers.js`.
  Raw `ipcMain.handle()` is prohibited.
- **Database discipline**: `school_year` MUST be included as a
  filter in every query on partitioned tables. Foreign keys
  MUST remain enabled (`PRAGMA foreign_keys = ON`). Unique
  constraint columns MUST coerce NULLs to defaults before
  insert.
- **No bundler reliance**: The app uses multi-page HTML with
  vanilla JS. Do not introduce Webpack, Vite, or similar
  bundlers. Each HTML page is self-contained and loaded
  directly by Electron.
- **Vendor isolation**: Third-party libraries live in `vendor/`.
  They MUST NOT be loaded from CDNs. Updates to vendored
  libraries MUST be committed as explicit file replacements.

### V. Performance Requirements

The app runs on school administration hardware, which may be
modest. Performance constraints reflect real-world deployment.

- **Startup time**: The main window MUST render interactive
  content within 3 seconds on a machine with 4 GB RAM and
  an HDD.
- **Database queries**: All queries on tables with `school_year`
  partitioning MUST use composite indexes that lead with
  `school_year`. Full table scans on `students`, `grades`,
  or `absences` are prohibited.
- **Memory**: The app MUST NOT exceed 512 MB resident memory
  during normal operation (dashboard, grade entry, attendance
  tracking).
- **CSS build**: `npm run css:build` MUST complete in under
  10 seconds. Tailwind CSS is compiled from a single source
  file (`css/tailwind-input.css`). Avoid excessive custom
  utility generation.
- **Report generation**: PDF report rendering (via
  `main/reports/engine.js`) MUST complete within 5 seconds
  for a single student report and within 30 seconds for a
  full-class batch.

## Security & Data Integrity

Student data is sensitive. The application MUST treat data
protection as a first-class concern.

- **Authentication**: Passwords MUST be hashed with
  `crypto.scryptSync` using the established format
  (`scrypt$<salt>$<hash>`). Timing-safe comparison via
  `timingSafeEqual` is mandatory.
- **Session management**: Sessions are in-memory maps keyed by
  sender ID. Sessions MUST NOT be persisted to the database.
- **Write authorization**: All data-modifying IPC handlers MUST
  use `handleWrite` (role-based auth) or `handleWriteNoAuth`
  (pre-login operations only, such as bulk import). Read-only
  handlers use `handleRead`.
- **No secrets in code**: `.env` is gitignored. `GH_TOKEN`,
  `OWNER_SYNC_WRITE_TOKEN`, and `OWNER_SYNC_READ_TOKEN` MUST
  never appear in committed code.
- **Backup integrity**: `js/backup.js` serializes localStorage
  and SQLite snapshots into a single JSON file. Restore
  operations MUST validate backup structure before applying.

## Development Workflow & Quality Gates

- **Branch discipline**: Feature work MUST happen on a dedicated
  branch. Direct commits to `main` are prohibited for
  multi-file changes.
- **Pre-merge checklist**:
  1. `npm run lint` passes with zero errors.
  2. `npm run css:build` succeeds.
  3. `npm run test:smoke` passes.
  4. Manual RTL visual check for any UI changes.
- **Commit messages**: Use conventional commit format
  (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`).
  Include scope when touching a specific domain
  (e.g., `fix(grades): correct semester filter`).
- **Migration protocol**: New migrations append to the
  migration array in `main/db/migrations.js` with a unique
  version string. Migrations are forward-only with no
  rollback support. Test migrations on a copy of production
  data when possible.
- **Dependency management**: New npm dependencies require
  justification. Prefer Node.js built-ins and existing
  vendored libraries over adding new packages.

## Governance

This constitution is the authoritative source for development
standards in the Gestion Scolaire (Pencil2) project. It
supersedes ad-hoc conventions and informal agreements.

- **Authority**: Constitution principles override all other
  practices. When a conflict arises between this document
  and an implementation shortcut, the constitution wins.
- **Amendments**: Changes to this constitution MUST be
  documented with a version bump, rationale, and sync
  impact report. Amendments follow semantic versioning:
  MAJOR for principle removals/redefinitions, MINOR for
  new principles or material expansions, PATCH for
  clarifications and typo fixes.
- **Compliance review**: Every code review MUST verify
  adherence to the relevant principles. Reviewers SHOULD
  reference specific principle numbers (I–V) when flagging
  violations.
- **Runtime guidance**: `CLAUDE.md` at the project root
  provides supplementary runtime development guidance and
  MUST remain consistent with this constitution.

**Version**: 1.1.0 | **Ratified**: 2026-03-19 | **Last Amended**: 2026-03-19
