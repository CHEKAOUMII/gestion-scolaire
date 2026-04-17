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

### Timetable Data Structure (localStorage `timetableData`)

The timetable is stored in `localStorage` under the key `timetableData` as a JSON object. Its structure is:

```
{
  teachers: [...],
  subjects: [...],
  classes: [...],
  timetables: {
    "teacherName": {
      "الاثنين": {
        morning:   { H1: {subject, students, room}, H2: {...}, H3: {...}, H4: {...} },
        afternoon: { H1: {subject, students, room}, H2: {...}, H3: {...}, H4: {...} }
      },
      "الثلاثاء": { morning: {...}, afternoon: {...} },
      ...
    }
  },
  teacherMetaByKey: {...}
}
```

**Critical rules:**

- **Period separation is at the `morning`/`afternoon` key level**, NOT at the hour-key level. The keys `H1`, `H2`, `H3`, `H4` repeat identically inside both `morning` and `afternoon`.
- **Never assume `h1-h4` = morning and `h5-h8` = afternoon.** The FET import uses `_m`/`_s` suffixes on day names for period detection, and hours are always `H1-H4` within each period.
- **Time mapping depends on the period context:**
  - Morning: `H1` → 08:30-09:30, `H2` → 09:30-10:30, `H3` → 10:30-11:30, `H4` → 11:30-12:30
  - Afternoon: `H1` → 14:30-15:30, `H2` → 15:30-16:30, `H3` → 16:30-17:30, `H4` → 17:30-18:30
- **Day names are Arabic:** الاثنين, الثلاثاء, الأربعاء, الخميس, الجمعة, السبت (Monday–Saturday). Note: الاثنين uses plain alef (not hamza إ).
- **Teacher keys** may be tafwij-prefixed (`tafwij:name`) or plain names. Use `resolveTeacherTimetableKeys()` for matching.

### Timetable Schedule Utilities (mandatory — `js/utils.js`)

Shared functions and constants for converting period slot labels (H1, H2, etc.) to actual time strings. **Always use these instead of creating local copies.**

**Available globals** (loaded via `js/utils.js` on every page):

- **`PERIOD_MAP`** — Maps all slot keys (`h1`-`h8`, `H1`-`H8`) to absolute time strings. Use for flat slot-to-time lookup (e.g. in compensation tracking where slots are `h1`-`h8`).
  ```js
  PERIOD_MAP['h1']  // '08:30-09:30'
  PERIOD_MAP['H5']  // '14:30-15:30'
  ```

- **`MORNING_HOUR_MAP`** — Maps `H1`-`H4` to morning times. Use when you know the period is `morning` (from timetable data).
  ```js
  MORNING_HOUR_MAP['H2']  // '09:30-10:30'
  ```

- **`AFTERNOON_HOUR_MAP`** — Maps `H1`-`H4` to afternoon times. Use when you know the period is `afternoon`.
  ```js
  AFTERNOON_HOUR_MAP['H2']  // '15:30-16:30'
  ```

- **`CONSECUTIVE_SLOT_MAP`** — Maps each slot to its next consecutive slot: `{ h1:'h2', h2:'h3', h3:'h4', h5:'h6', h6:'h7', h7:'h8' }`.

- **`resolveSlotTime(slot, fallbackTime)`** — Converts a slot label (e.g. `'H2'`) to an actual time string via `PERIOD_MAP`. Falls back to `fallbackTime` if it contains `:`. Use this when displaying stored records that may have slot labels instead of time strings.
  ```js
  resolveSlotTime('H2', null)       // '09:30-10:30'
  resolveSlotTime('H2', 'H2')       // '09:30-10:30'  (fallback is not a time)
  resolveSlotTime('', '10:30-11:30') // '10:30-11:30'  (uses fallback)
  ```

- **`mergeConsecutivePeriods(slots)`** — Merges consecutive time periods into continuous blocks, but **only when they belong to the same section (class)**. Accepts either an array of time strings or objects with `{time, section}`. Returns an array of merged time strings.
  ```js
  // Simple strings (no section awareness):
  mergeConsecutivePeriods(['09:30-10:30', '10:30-11:30'])
  // → ['09:30-11:30']

  // With section awareness:
  mergeConsecutivePeriods([
      { time: '09:30-10:30', section: '1BACSH-7' },
      { time: '10:30-11:30', section: '1BACSH-7' },
      { time: '11:30-12:30', section: 'TCSF-4' }
  ])
  // → ['09:30-11:30', '11:30-12:30']  (different sections NOT merged)
  ```

**Rules:**
- **Never create local `PERIOD_MAP` or hour maps** — they are already in `utils.js`.
- **Always use `MORNING_HOUR_MAP` / `AFTERNOON_HOUR_MAP`** when working with timetable data (because `H1-H4` repeat in both morning and afternoon blocks).
- **Always use `PERIOD_MAP`** when working with flat slot names like `h1-h8` from the compensation/attendance DB tables.
- **Always use `resolveSlotTime()`** before displaying any `period_time` or `period_slot` value from the database — stored values may be slot labels instead of actual times.
- **Always use `mergeConsecutivePeriods()`** when displaying teacher/student/room schedules — pass `{time, section}` objects to prevent incorrect merging across different classes.

### FilterManager (mandatory for all filtering and dropdowns)

Whenever you create a new page, update an existing one, or implement dropdown filters for levels, classes (sections), subjects, or teachers, you MUST use the unified `FilterManager` class from `js/utils.js`.

**Why?** To ensure a **single source of truth** across the entire application. Previously, pages parsed local storage, FET data, or implemented custom manual logic to get classes and subjects. Now, `FilterManager` acts as the standard, fetching from the unified database via `window.api.classes.getAll()` and `window.api.subjects.getAll()`.

**Usage Pattern:**
```js
// 1. Ensure you have HTML selects with appropriate IDs
// <select id="level-filter"></select>
// <select id="class-filter"></select>

// 2. Initialize in your JS file
let fm = new FilterManager({
    selectors: {
        level: 'level-filter',
        class: 'class-filter',
        subject: 'subject-filter', // omit if not needed on this page
        teacher: 'teacher-filter'  // omit if not needed
    },
    placeholders: {
        level: 'كل المستويات',
        class: 'كل الأقسام'
    },
    // Useful for results/analytics: if true, fetch subjects only from grades, not subjects API
    // subjectsFromGrades: true,
    onChange: (values) => {
        // Automatically called when any dropdown changes.
        // values = { level: '...', class: '...', subject: '...', teacher: '...' }
        loadDataOrRenderTable(); 
    }
});
await fm.init();
```

**Critical Rules:**
- NEVER write manual `classSelect.innerHTML = ...` loops.
- NEVER parse `localStorage.getItem('timetableData')` just to build a list of sections or subjects.
- ALWAYS use `FilterManager` for Level → Section cascading logic.

### Environment Variables

`.env` is gitignored. Required values:

- `GH_TOKEN` — auto-updater GitHub Releases
- `OWNER_SYNC_WRITE_TOKEN` / `OWNER_SYNC_READ_TOKEN` — telemetry server
- `FIREBASE_API_KEY` — Firebase client SDK key
- `FIREBASE_AUTH_DOMAIN` — e.g. `gestionscholaire.firebaseapp.com`
- `FIREBASE_PROJECT_ID` — Firebase project ID (e.g. `gestionscholaire`)
- `FIREBASE_STORAGE_BUCKET` — e.g. `gestionscholaire.firebasestorage.app`
- `FIREBASE_MESSAGING_SENDER_ID` — Firebase sender ID
- `FIREBASE_APP_ID` — Firebase app ID
- `FIREBASE_FUNCTIONS_URL` — deployed Cloud Functions base URL (e.g. `https://us-central1-gestionscholaire.cloudfunctions.net`)
- `FIREBASE_SERVICE_ACCOUNT_PATH` — path to service account JSON (main process only, never bundled into the installer)
- `GESTION_LICENSE_SECRET` — HMAC secret for license key validation; set via Firebase Secrets Manager (`firebase functions:secrets:set GESTION_LICENSE_SECRET`), not in `.env`

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

### Print System (mandatory for all print/export actions)

Whenever a page needs to print or export to PDF, use **`PrintSystem`** from `js/print-system.js`. This is the single API for all print operations. Never call `openPrintPreview()`, `electronPrint()`, or `window.print()` directly — they are internal implementation details.

**Two methods only:**

- **`PrintSystem.preview(options)`** — For pages that print their own DOM content (analytics, absences, students, grades, etc.). Opens the preview modal, then prints or exports PDF.
  ```js
  await PrintSystem.preview({
      contentSelector: '#my-table',  // CSS selector for source element (optional, auto-detected)
      title: 'تقرير الغياب',         // shown in letterhead
      landscape: false,               // true for wide tables
      pageSize: 'A4',                 // default
      noHeader: false,                // skip school letterhead
      waitFor: somePromise,           // await before capturing (optional)
  });
  ```

- **`PrintSystem.window(options)`** — For pages that build their own HTML before printing (timetables, certificates, complex reports). Sends HTML to the main process via a hidden BrowserWindow.
  ```js
  await PrintSystem.window({
      htmlContent: builtHTML,         // REQUIRED — the HTML body content
      title: 'جدول الحصص',
      mode: 'pdf',                    // 'pdf' | 'print' | 'preview'
      landscape: true,
      pageSize: 'A4',
      defaultFileName: 'timetable',  // suggested PDF filename (optional)
      inlineStyles: '',               // extra CSS injected into the document (optional)
      skipAutoLetterhead: false,      // letterhead is added automatically unless true
  });
  ```

**Which method to use:**

| Situation | Method |
|-----------|--------|
| Page renders data in the DOM (tables, charts, KPI cards) | `PrintSystem.preview()` |
| Page builds an HTML string before printing (timetables, certificates) | `PrintSystem.window()` |

**Rules:**
- `window.print()` is **prohibited** — use `PrintSystem.preview()`.
- `openPrintPreview()` is **prohibited** — use `PrintSystem.preview()`.
- `electronPrint()` is **prohibited** — use `PrintSystem.window()`.
- `window.api.system.printHTML()` called directly is **prohibited** — use `PrintSystem.window()`.
- Every print button MUST show a loading state via `showToast.loading()` while the operation is in progress.
- `js/print-system.js` must be included via `<script src="js/print-system.js">` on every page that prints — do not add it to pages that don't need it.

**Architecture note (3 internal modes — do not replicate):**
`PrintSystem` hides three internal rendering contexts: `.ux-pp-sheet` (visual preview modal), `@media print` CSS rules (browser print engine), and `body.ux-printing-active #ux-print-root` (live DOM export container). These are implementation details of `js/print-system.js` and `css/print.css` — never reference or duplicate them in page code.

### CRUD Completeness (mandatory)

Whenever an **insert/add** (إضافة) feature is created for any entity, an **edit/update** (تعديل) feature MUST also be implemented alongside it. No entity should be add-only without the ability to correct mistakes.

**Rules:**
- Every table row with a delete button MUST also have an edit button next to it.
- Edit can be implemented as inline editing (converting the row to input fields) or via a modal — prefer inline for simple entities, modal for complex ones.
- The edit action must reuse the same backend `save` handler by passing the record `id` for update (upsert pattern).
- Edit buttons use the `.edit-btn` class with `fa-edit` icon, placed before the delete button inside an `.att-action-group` wrapper.
- Both edit and delete buttons must be hidden from print via the `no-print` class.
