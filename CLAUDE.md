# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start          # Launch the Electron app in development mode
npm run build          # Package to Windows NSIS installer in dist/
npm run lint           # ESLint on main/**/*.js, preload.js, js/backup.js, js/pages/*.js, tests/**/*.js
npm run format         # Prettier --write on all JS and docs
npm run test:smoke     # Smoke test: validates IPC channel contract parity and module integrity
npm run license:key    # Generate an offline license key (e.g. -- --plan=pro --days=365 --customer=SCHOOL-001)
npm run owner:server   # Start the standalone telemetry HTTP server
```

CI runs: `npm ci` → `npm run lint` → `npm run test:smoke`

## Architecture

**Electron desktop app** (Arabic-language school management system for Moroccan high schools). No bundler — multi-page HTML with vanilla JS. Each HTML page is a self-contained file loaded directly by Electron.

### Process Boundary

```
Main Process (Node.js)          Renderer Process (Browser)
  main.js                         [page].html + js/pages/[page].js
  main/db/        ←─ IPC ──→     window.api  (exposed via preload.js contextBridge)
  main/ipc/
  main/licensing/
  main/updater.js
```

All renderer→main communication goes through `window.api`, which is the sole IPC surface defined in `preload.js`. `contextIsolation: true` is enforced.

### Key Layers

- **`main/db/`** — `better-sqlite3` database: `context.js` (singleton `getDb()`), `schema.js` (DDL), `migrations.js` (11 versioned migrations), `init.js` (bootstrap)
- **`main/ipc/`** — One module per domain (`students`, `absences`, `staff`, `exams`, `schoolOps`, `auth`, `licensing`, `system`, `ownerTelemetry`). All registered via `registerAll.js`
- **`main/licensing/`** — Offline key generation/verification (`offlineKey.js`), hardware device fingerprinting (`deviceFingerprint.js`), plan-tier service (`service.js`), background owner sync (`ownerSync.js`)
- **`preload.js`** — Defines the entire IPC contract; the single source of truth for what renderer pages can call
- **`app.js`** — Dashboard renderer: stats, sidebar nav, Chart.js, XLSX import/export, school-year switching
- **`js/pages/*.js`** — One page-specific module per HTML page
- **`js/ux-enhancements.js`** — Shared renderer utilities: sidebar behavior, toast notifications, keyboard shortcut modal
- **`js/backup.js`** — Backup/restore UI (serializes localStorage + SQLite snapshot to a single JSON file)

### IPC Pattern

Adding a new feature requires touching three places:
1. `main/ipc/[domain].js` — implement the handler using `getDb()`
2. `main/ipc/registerAll.js` — register the new module
3. `preload.js` — expose the channel via `contextBridge`

### ESLint Config (flat config, v9)
- `main/` and `preload.js`: Node globals, `no-unused-vars` warn, `no-empty` error
- `js/`: Browser globals, relaxed (`no-unused-vars` off, `no-undef` off) — accommodates globals like `XLSX`, `Chart`, `BackupManager`, `setupSidebar` injected from inline scripts

### Code Style (Prettier)
Single quotes, no trailing commas, 4-space indent, 120-char line width, semicolons.

### Environment Variables
`.env` is gitignored. Required values: `GH_TOKEN` (auto-updater GitHub Releases), `OWNER_SYNC_WRITE_TOKEN` / `OWNER_SYNC_READ_TOKEN` (telemetry server).

### Auto-updater
`main/updater.js` uses `electron-updater` publishing to GitHub Releases under `CHEKAOUMII/project6.2`. Requires `GH_TOKEN` at build time.

### Telemetry Server
`server/index.js` is a standalone Node.js HTTP server deployed separately (Railway/VPS) for tracking installed device heartbeats. Run independently of the Electron app.
