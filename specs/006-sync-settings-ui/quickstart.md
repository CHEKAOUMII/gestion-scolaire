# Quickstart: Sync Settings UI

**Feature**: 006-sync-settings-ui
**Date**: 2026-03-21

## Prerequisites

- Node.js installed
- All npm dependencies installed (`npm ci`)
- Phases 1–5 of DynamoDB sync completed (sync engine backend fully operational)
- On branch `006-sync-settings-ui`

## Development Workflow

```bash
# 1. Start dev environment (CSS watch + Electron)
npm run dev

# 2. After changes, rebuild CSS if needed
npm run css:build

# 3. Lint all JS
npm run lint

# 4. Run smoke tests (must pass before commit)
npm run test:smoke
```

## Files to Create

| File | Purpose |
|------|---------|
| `settings-sync.html` | Sync settings page HTML |
| `js/pages/settings-sync.js` | Page logic: config form, status display, conflict log, manual sync |

## Files to Modify

| File | Change |
|------|--------|
| `js/sidebar.js` | Add "المزامنة السحابية" menu item under settings section |
| `js/ux-enhancements.js` | Add sync status indicator logic (poll `sync:getStatus`, update sidebar badge) |
| `css/tailwind-input.css` | Add sync indicator component classes (if needed beyond utility classes) |

## Key IPC Channels (all pre-existing)

```javascript
// Read (no auth required)
const config = await window.api.sync.getConfig();
const status = await window.api.sync.getStatus();
const conflicts = await window.api.sync.getConflictLog({ status: 'unresolved', limit: 50, offset: 0 });

// Write (admin only)
const saveResult = await window.api.sync.setConfig({ enabled: true, syncIntervalMinutes: 10 });
const syncResult = await window.api.sync.triggerNow();
const resolveResult = await window.api.sync.resolveConflict({ conflictId: 1, resolution: 'local' });
```

## Verification Checklist

1. `npm run lint` — zero errors
2. `npm run css:build` — succeeds
3. `npm run test:smoke` — passes (IPC parity, no CDN refs, no inline styles)
4. Manual check: page renders correctly in RTL Arabic mode
5. Manual check: dark mode toggle works on the sync settings page
6. Manual check: sidebar sync indicator appears on other pages (e.g., dashboard)
