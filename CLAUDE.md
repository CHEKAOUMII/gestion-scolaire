# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run css:build      # Compile css/tailwind-input.css -> css/tailwind-output.css
npm run css:watch      # Watch and rebuild Tailwind CSS during development
npm run dev            # Run css:watch and Electron together
npm run start          # Launch the Electron app in development mode (Windows only)
npm run build          # Package to Windows NSIS installer in dist/
npm run lint           # ESLint on main/**/*.js, preload.js, js/backup.js, js/pages/*.js, tests/**/*.js
npm run format         # Prettier --write on all JS, tests, workflows, and README
npm run test:smoke     # Smoke test: IPC parity, module integrity, no CDN refs, Tailwind output, legacy CSS cleanup
npm run license:key    # Generate an offline license key (e.g. -- --plan=pro --days=365 --customer=SCHOOL-001)
npm run owner:server   # Start the standalone telemetry HTTP server
```

CI runs: `npm ci` → `npm run css:build` → `npm run lint` → `npm run test:smoke`

## Architecture

**Electron desktop app** (Arabic-language school management system for Moroccan high schools). No bundler — multi-page HTML with vanilla JS. Each HTML page is a self-contained file loaded directly by Electron.

### Process Boundary

```
Main Process (Node.js)          Renderer Process (Browser)
  main.js                         [page].html + js/pages/[page].js
  main/db/        ←─ IPC ──→     window.api  (exposed via preload.js contextBridge)
  main/ipc/
  main/auth/
  main/licensing/
  main/updater.js
```

All renderer→main communication goes through `window.api`, which is the sole IPC surface defined in `preload.js`. `contextIsolation: true` is enforced.

### Key Layers

- **`main/db/`** — `better-sqlite3` database: `context.js` (singleton `getDb()`), `schema.js` (DDL + indexes), `migrations.js` (19 versioned migrations), `init.js` (bootstrap: opens DB, sets WAL + FK pragmas, calls `createTables()` then `runMigrations()`)
- **`main/ipc/`** — One module per domain (13 modules: `auth`, `students`, `absences`, `schoolOps`, `staff`, `exams`, `system`, `licensing`, `ownerTelemetry`, `updater`, `pageVisibility`, `notifications`, `reports`). All registered via `registerAll.js`
- **`main/ipc/ipc-helpers.js`** — Three wrappers that replace raw `ipcMain.handle()`: `handleRead` (no auth, injects db), `handleWrite` (role-based auth, injects db), `handleWriteNoAuth` (skips auth for pre-login ops like bulk import). Also exports `normalizeYear()` for school-year fallback
- **`main/auth/`** — Password hashing with `crypto.scryptSync` (format: `scrypt$<salt>$<hash>`), timing-safe comparison via `timingSafeEqual`. Sessions are in-memory `Map<senderId, session>` — not persisted to DB
- **`main/licensing/`** — Offline key generation/verification (`offlineKey.js`), hardware device fingerprinting (`deviceFingerprint.js`), plan-tier service (`service.js`), background owner sync (`ownerSync.js`)
- **`main/reports/`** — Report engine: `engine.js` (PDF pipeline), `letterhead.js`, `footer.js`, `identity.js`, `security.js`; `channels/` (IPC handlers), `templates/` (body templates for admin forms, certificates, etc.)
- **`main/notifications/`** — Notification system: `dispatcher.js`, `router.js`, `delivery.js`, `store.js`, `schema.js`, `templates.js`; `channels/` (IPC handlers)
- **`main/print-window.js`** — Shared print preview window helper
- **`preload.js`** — Defines the entire IPC contract; the single source of truth for what renderer pages can call
- **`app.js`** — Dashboard renderer: stats, sidebar nav, Chart.js, XLSX import/export, school-year switching
- **`js/pages/*.js`** — One page-specific module per HTML page (dashboard-init, grades-sheets, reports-forms, settings-imports, students-list, teachers-performance)
- **`js/ux-enhancements.js`** — Shared renderer utilities: sidebar behavior, toast notifications, keyboard shortcut modal
- **`js/backup.js`** — Backup/restore UI (serializes localStorage + SQLite snapshot to a single JSON file)
- **`vendor/`** — Bundled Chart.js and XLSX libraries (no CDN references allowed — enforced by smoke test)

### IPC Pattern

Adding a new feature requires touching three places:

1. `main/ipc/[domain].js` — implement the handler using `getDb()` via `handleRead`/`handleWrite`/`handleWriteNoAuth` helpers
2. `main/ipc/registerAll.js` — register the new module
3. `preload.js` — expose the channel via `contextBridge`

The smoke test (`tests/smoke.js`) validates that channels declared in `preload.js` exactly match handlers registered in `main/ipc/*.js` — any mismatch will fail CI.

### Database

- **Engine:** `better-sqlite3` (synchronous, single-connection singleton)
- **File:** `gestion-scolaire.db` in Electron's `userData` directory
- **Pragmas:** `journal_mode = WAL`, `foreign_keys = ON` (set at boot in `init.js`)
- **Init order:** `createTables()` → `runMigrations()` — migrations must not duplicate DDL already in `createTables()`
- **Migration system:** Forward-only, version-string tracked in `schema_migrations` table. Uses `ensureColumn()` helper for idempotent `ALTER TABLE` additions. No rollback support
- **Multi-tenancy:** `school_year TEXT` column on every main table acts as a partition key. Almost every query filters by it; composite indexes lead with it
- **Key constraint:** `grades` has `UNIQUE(student_code, subject, semester, school_year)`; `absences` has `UNIQUE(student_code, month, school_year, absence_type)` — NULLs in these columns must be coerced to empty strings/defaults before insert

### ESLint Config (flat config, v9)

- `main/`, `preload.js`, `tests/`: Node globals, `no-unused-vars` warn (args `^_` exempt), `no-empty` error (empty catch allowed)
- `js/`: Browser globals, relaxed (`no-unused-vars` off, `no-undef` off) — accommodates globals like `XLSX`, `Chart`, `BackupManager`, `setupSidebar`, `showToast`, `closeShortcutsModal`

### Code Style (Prettier)

Single quotes, no trailing commas, 4-space indent, 120-char line width, semicolons.

### CSS Architecture (Tailwind CSS v4)

- **Source:** `css/tailwind-input.css` is the single source of truth for application CSS
- **Build:** `npm run css:build` compiles via PostCSS into `css/tailwind-output.css`
- **Watch/dev:** `npm run css:watch` rebuilds on change, and `npm run dev` runs CSS watch with Electron
- **Dark mode:** `@variant dark` targets `[data-theme="dark"]` on the document
- **Tokens:** design tokens live in the `@theme {}` block in `css/tailwind-input.css`
- **Components:** reusable classes live in `@layer components {}`
- **Carry-forward CSS:** legacy shared/page CSS that has not yet been re-expressed as utilities lives in documented carry-forward sections inside `css/tailwind-input.css`
- **RTL:** prefer logical properties/utilities (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`) over physical left/right utilities

### Environment Variables

`.env` is gitignored. Required values: `GH_TOKEN` (auto-updater GitHub Releases), `OWNER_SYNC_WRITE_TOKEN` / `OWNER_SYNC_READ_TOKEN` (telemetry server).

### Auto-updater

`main/updater.js` uses `electron-updater` publishing to GitHub Releases under `CHEKAOUMII/project6.2`. Requires `GH_TOKEN` at build time.

### Telemetry Server

`server/index.js` is a standalone Node.js HTTP server deployed separately (Railway/VPS) for tracking installed device heartbeats. Run independently of the Electron app.

### Message System (mandatory for all UI interactions)

Every page, tab, button, and user-facing action MUST use the unified message system. No ad-hoc patterns allowed.

**Available globals** (loaded via `js/message-system.js` on every page):

- **`showConfirm(config)`** — Promise-based confirmation dialog. Use for ALL destructive actions (delete, clear, overwrite) and any operation requiring user consent. Never use `window.confirm()`.
  ```js
  const { confirmed } = await showConfirm({
      title: 'حذف السجل',
      message: 'هل أنت متأكد؟',
      detail: 'لا يمكن التراجع عن هذا الإجراء.',  // optional
      type: 'danger',           // 'danger' | 'warning' | 'info'
      confirmText: 'حذف نهائي', // optional, defaults to 'تأكيد'
      cancelText: 'إلغاء',      // optional
  });
  if (!confirmed) return;
  ```

- **`showToast(message, type, duration)`** — Standard toast. Use for operation results (success/error/warning/info). Never show raw `alert()`.
  ```js
  showToast('تم الحفظ بنجاح', 'success');
  showToast('حدث خطأ', 'error');
  ```

- **`showToast.loading(message)`** — Loading toast for async operations. Returns a handle to transition state.
  ```js
  const handle = showToast.loading('جاري الحفظ...');
  try {
      await doWork();
      handle.success('تم الحفظ');
  } catch (e) {
      handle.error('فشل الحفظ');
  }
  ```

- **`showToast.action(message, { label, icon, onClick })`** — Toast with an undo/action button.
  ```js
  showToast.action('تم حذف السجل', { label: 'تراجع', icon: 'fa-undo', onClick: undoFn });
  ```

- **`setFieldValidation(field, message, type)`** — Inline validation on form fields. Use for form errors instead of alert-based validation.
  ```js
  setFieldValidation(inputEl, 'هذا الحقل مطلوب', 'error');   // 'error' | 'warning' | 'success'
  ```

- **`clearValidation(container)`** — Clear all validation messages within a form or container.

**Rules:**
- `window.confirm()` is **prohibited** — use `showConfirm()`.
- `alert()` is **prohibited** — use `showToast()`.
- Every delete/clear/reset button handler MUST `await showConfirm()` before proceeding.
- Every async operation (IPC call, import, export) MUST give feedback via `showToast` or `showToast.loading`.
- Form validation errors MUST use `setFieldValidation()`, not inline HTML manipulation.
- `js/message-system.js` is already included on all 44 HTML pages — do not add it again.

### Pagination (mandatory for all data tables)

Every page that displays a list or table of records MUST implement client-side pagination. No exceptions.

**Rules:**
- Default page size is **20 records per page**.
- Every newly created page with a table MUST include pagination controls from the start.
- Pagination state (`currentPage`, `pageSize`) must be reset to page 1 whenever the data set changes (filter, search, school-year switch).
- The pagination bar must show: previous button, page numbers (or `X / Y` counter), next button, and total record count.
- Use the following standard pattern for all pages:

```js
let currentPage = 1;
const PAGE_SIZE = 20;

function renderPage(data) {
    const total = data.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const slice = data.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    // … render slice into the table tbody …

    renderPaginationControls(total, totalPages);
}

function renderPaginationControls(total, totalPages) {
    // Update prev/next button disabled state, page counter text, and total count
}
```

- Pagination controls must be RTL-aware (previous = right arrow in Arabic layout).
- When the result set is empty, hide pagination controls entirely and show an empty-state message.
