# Implementation Plan: Auto-fill Sync License Key (Phased via Spec Kit)

## Context

The sync settings page (`settings-sync.html`) requires a `license_key` in the `sync_config` table to authenticate with the Auth Lambda. Currently this key must be entered manually by an admin. The goal is to auto-fill `sync_config.license_key` automatically — both for paid activations (store the original key) and trial users (generate a trial sync key). This eliminates manual intervention and enables seamless sync setup.

**Source plan:** `docs/plans/gentle-growing-moon.md`

## Approach: 4 Independent Spec Kit Features

Each of the 4 steps from the original plan becomes its own Spec Kit feature with its own branch, spec, plan, and tasks. They have a natural dependency order but each is independently testable and deployable.

---

### Feature 1: Save License Key on Paid Activation

**Spec Kit short-name:** `auto-sync-paid-key`

**Scope:** When `activateLicense()` is called with a paid license key, save the original (pre-hash) key into `sync_config.license_key`.

**Key file:** [main/licensing/service.js](main/licensing/service.js) — `activateLicense()` function (lines 318–540)

**What to specify:**
- After key validation succeeds and before hashing at line 342, insert an `UPDATE sync_config SET license_key = ? WHERE id = 1` using `decoded.normalizedKey`
- Wrap in try/catch since `sync_config` table may not exist yet (e.g., fresh install before sync migration runs)
- No new IPC channels needed — this is purely internal main-process logic

**Key entities:**
- `sync_config.license_key` (TEXT, nullable, added by migration `2026-03-034`)
- `decoded.normalizedKey` — the full `GSLK-<base64>.<sig>` string that `readLicenseKey()` in [main/sync/credentials.js](main/sync/credentials.js) expects

**Dependencies:** None — this is the foundation feature

**Verification:**
- Activate a paid license → verify `sync_config.license_key` is populated with the raw key
- `npm run lint` + `npm run test:smoke` pass

---

### Feature 2: Auto-Generate Trial Sync Key

**Spec Kit short-name:** `auto-sync-trial-key`

**Scope:** On app startup, if the license status is `trial` (active) and `sync_config.license_key` is empty, auto-generate a trial sync key using `createOfflineLicenseKey()`.

**Key files:**
- [main/licensing/service.js](main/licensing/service.js) — `getPublicActivationStatus()` (lines 204–265)
- [main/licensing/offlineKey.js](main/licensing/offlineKey.js) — `createOfflineLicenseKey()` (lines 85–112)
- [main/sync/credentials.js](main/sync/credentials.js) — `readSyncConfig()` / `readLicenseKey()`
- [main.js](main.js) — startup sequence (lines 185–206)

**What to specify:**
- New function `ensureTrialSyncKey(db)` that:
  1. Reads `sync_config.license_key` — if already set, return early
  2. Checks `getPublicActivationStatus()` — if `status === 'trial' && trialActive`
  3. Calls `createOfflineLicenseKey({ planCode: 'basic', expiresAt: trialEndDate, customerRef: 'TRIAL', requiresOnlineValidation: false })`
  4. Writes the generated key to `sync_config.license_key`
- Call point: in `main.js` startup sequence, after `initDatabase()` and before sync background tasks start (between lines 187 and 190)

**Security note:** The local signing secret (`userData/.license-secret`) must match the one in AWS Secrets Manager (`pencil2/license-secret`) for the generated key to be accepted by Auth Lambda.

**Dependencies:** Conceptually independent, but Feature 1 should land first so the pattern is established

**Verification:**
- Launch app with trial license → verify `sync_config.license_key` is auto-populated
- Launch app with existing key → verify key is NOT overwritten
- `npm run lint` + `npm run test:smoke` pass

---

### Feature 3: Hide License Key Field from Sync Settings UI

**Spec Kit short-name:** `hide-sync-license-field`

**Scope:** Hide the `cfg-license-key` input from the sync settings form since the key is now managed automatically. Keep the HTML element (hidden, not deleted) for potential future use.

**Key files:**
- [settings-sync.html](settings-sync.html) — license key input (lines 198–210)
- [js/pages/settings-sync.js](js/pages/settings-sync.js) — form load/save logic (lines 321, 345, 382)

**What to specify:**
- Hide the `<div>` wrapping `cfg-license-key` (add `hidden` attribute or Tailwind `hidden` class)
- Remove or skip the license key field from form save logic (line 345, 382)
- Keep `loadConfig()` populating the hidden field (harmless, maintains data flow)

**Dependencies:** Features 1 & 2 should land first (otherwise hiding the field removes the only way to set the key)

**Verification:**
- Open sync settings page → license key field is not visible
- Save sync settings → works without errors
- `npm run lint` + `npm run test:smoke` pass
- Manual RTL visual check

---

### Feature 4: Update Sync Key on License Status Change

**Spec Kit short-name:** `sync-key-license-change`

**Scope:** When the license status changes (trial→paid, paid→expired, reactivation), automatically update `sync_config.license_key` to match the new state.

**Key file:** [main/licensing/service.js](main/licensing/service.js)

**What to specify:**
- When activating a paid license over a trial: Feature 1's logic already handles this (overwrites with paid key)
- When a paid license expires: optionally clear `sync_config.license_key` or leave as-is (Auth Lambda will reject anyway)
- When deactivating a device (`deactivateCurrentDevice`): clear `sync_config.license_key`
- When a trial expires: the trial key naturally expires (embedded `exp` date) — no action needed, but could optionally clear the field

**Dependencies:** Features 1, 2, and 3

**Verification:**
- Activate paid over trial → key updates to paid key
- Deactivate device → key is cleared
- `npm run lint` + `npm run test:smoke` pass

---

## Execution Order

```
Feature 1 (paid key)  ──→  Feature 2 (trial key)  ──→  Feature 3 (hide UI)  ──→  Feature 4 (status change)
     └── foundation            └── auto-generate            └── UI cleanup           └── edge cases
```

## Spec Kit Workflow Per Feature

For each feature, run the full Spec Kit pipeline:
1. `/speckit.specify` — create the feature spec
2. `/speckit.clarify` — resolve any ambiguities
3. `/speckit.plan` — generate implementation plan
4. `/speckit.tasks` — generate task list
5. `/speckit.implement` — execute tasks
6. Verify: `npm run lint` + `npm run test:smoke`

## Files Summary

| File | Features |
|------|----------|
| `main/licensing/service.js` | 1, 2, 4 |
| `main/licensing/offlineKey.js` | 2 |
| `main/sync/credentials.js` | 2 |
| `main.js` | 2 |
| `settings-sync.html` | 3 |
| `js/pages/settings-sync.js` | 3 |

## Existing Functions to Reuse

- `createOfflineLicenseKey()` — [main/licensing/offlineKey.js](main/licensing/offlineKey.js):85 — key generation
- `getPublicActivationStatus()` — [main/licensing/service.js](main/licensing/service.js):204 — license/trial status
- `readSyncConfig()` — [main/sync/credentials.js](main/sync/credentials.js):8 — read sync config
- `readLicenseKey()` — [main/sync/credentials.js](main/sync/credentials.js):12 — read license key
- `getDb()` — [main/db/context.js](main/db/context.js) — database singleton
