# Quickstart: Sync Foundation

**Feature**: 001-sync-foundation
**Date**: 2026-03-21

## What This Feature Does

Adds a transparent change-capture layer to the Pencil2 application. Every data-modifying IPC operation (insert, update, delete) is automatically recorded in a local `sync_outbox` table. This outbox is the foundation for multi-PC synchronization in later phases — Phase 1 only captures; it does not push or pull data.

## Key Files (New)

| File                    | Purpose                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main/sync/capture.js`  | IPC interception layer: `wrapWithSyncCapture()`, channel-to-table registry, outbox writer, sync ID generator, sensitive field stripping, retention cleanup |
| `main/db/migrations.js` | New migration `2026-03-030-sync-foundation` creating 4 sync tables                                                                                         |

## Key Files (Modified)

| File                      | Change                                                                        |
| ------------------------- | ----------------------------------------------------------------------------- |
| `main/ipc/registerAll.js` | Import and apply capture wrappers after handler registration                  |
| `main/ipc/ipc-helpers.js` | Export channel tracking metadata so capture layer can identify write channels |
| `tests/smoke.js`          | New test section validating channel-to-table registry completeness            |

## How to Verify

```bash
# 1. Run smoke tests (includes new registry validation)
npm run test:smoke

# 2. Launch the app
npm run dev

# 3. Perform any write operation (e.g., add a student)

# 4. Check the outbox (in DevTools console or via SQLite browser)
# The sync_outbox table should contain a row for the operation
```

## Architecture at a Glance

```
Renderer → preload.js → ipcMain.handle()
                              │
                    ┌─────────▼──────────┐
                    │  handleWrite()      │
                    │  handleWriteSoftAuth│
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │ wrapWithSyncCapture │  ← NEW (transparent wrapper)
                    │                    │
                    │  1. Run original   │
                    │  2. On success:    │
                    │     → sync_outbox  │
                    │     → sync_id_map  │
                    └────────────────────┘
```

## Configuration

The `sync_config` table is seeded with defaults:

- `enabled = 0` (sync disabled — Phase 1 is capture-only)
- `retention_days = 7` (auto-cleanup outbox entries older than 7 days)
- `sync_interval_minutes = 10` (unused until Phase 3)

## What NOT to Touch

- Do not modify individual IPC handler files — the capture layer wraps them externally
- Do not add new IPC channels — sync IPC channels are deferred to Phase 4
- Do not add AWS SDK or any cloud dependencies — deferred to Phase 2
