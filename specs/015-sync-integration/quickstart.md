# Quickstart: Sync Integration (Phase 7.8)

**Feature**: 015-sync-integration
**Date**: 2026-03-23

## What This Feature Does

Phase 7.8 wires the MASSAR code (institution identity) into the sync engine so that:
1. The MASSAR code becomes the canonical school identifier for all cloud sync operations
2. Newly linked devices get sync auto-configured (zero manual steps)
3. Each sync cycle updates the device's "last seen" heartbeat
4. Revoked devices are blocked from syncing via cloud-side enforcement

## Prerequisites

- Phases 7.1–7.7 must be complete (institution schema, OTP, LAN discovery, server OTP, setup page, IPC layer, device management UI)
- Phases 1–6 sync engine (push, pull, conflict resolution, snapshot, settings UI) must be functional

## Key Files to Modify

| File | Change |
|------|--------|
| `main/sync/engine.js` | Add heartbeat update after push/pull; add revocation push/pull logic |
| `main/sync/authority.js` | Register `device_revocation` entity type |
| `main/ipc/linking.js` | Add origin device protection to `revokeDevice`; handle re-linking of revoked devices |
| `main/db/migrations.js` | Add migration to ensure `sync_config.school_id` matches `institution_config.massar_code` |
| `main/sync/capture.js` | Add `device_revocation` to `CHANNEL_REGISTRY` (excluded from outbox capture) |
| `main.js` | Add startup MASSAR-to-schoolId sync check |

## No New Files

Phase 7.8 modifies existing files only. No new source files are created.

## Development Workflow

```bash
# 1. Run CSS build (required before dev)
npm run css:build

# 2. Start dev mode
npm run dev

# 3. Test: First-run setup → verify sync_config.school_id = massar_code
#    - Delete institution_config row → restart app → complete setup
#    - Check sync_config via DevTools console

# 4. Test: Device linking → verify auto-config
#    - Device 1: configure sync settings, generate OTP
#    - Device 2: link via OTP → verify sync settings match

# 5. Test: Heartbeat → trigger sync → check linked_devices.last_seen_at

# 6. Test: Revocation → revoke device → push → pull on revoked device

# 7. Validate
npm run lint
npm run test:smoke
```

## Smoke Test Impact

The smoke test channel count should NOT change — no new IPC channels are added in Phase 7.8. All changes are internal to existing handlers and the sync engine.

## Key Architectural Decisions

1. **No new IPC channels** — all integration happens within existing module internals
2. **Revocation via DynamoDB** — treated as a new entity type in the existing sync data model, not a separate mechanism
3. **Heartbeat is local-only** — updates `linked_devices.last_seen_at` in SQLite, not pushed to cloud
4. **Point-in-time config snapshot** — sync config is copied to Device 2 at link time; no ongoing propagation
5. **Origin device cannot be revoked** — guarded by `institution_config.setup_device_hash` check
