# Research: Update Sync Key on License Status Change

**Feature**: 019-sync-key-license-change
**Date**: 2026-03-26

## Research Task 1: How to clear sync_config.license_key from the database

**Decision**: Create a new helper function `clearSyncLicenseKey(db)` in `main/sync/credentials.js` that NULLs the `license_key` column and call it from `deactivateCurrentDevice()` and from a new expiration-check hook.

**Rationale**:
- Currently there is no function anywhere in the codebase that clears `sync_config.license_key` — all existing code only writes to it (lines 415 and 732 in `service.js`).
- The existing `clearCredentials()` in `credentials.js` only clears the in-memory `_cachedCredentials` and `_refreshPromise` — it does not touch the database.
- Adding a `clearSyncLicenseKey(db)` helper in `credentials.js` centralizes the DB clear operation and keeps it alongside the read functions (`readSyncConfig`, `readLicenseKey`).
- The helper should also call `clearCredentials()` internally to invalidate the in-memory cache in the same operation.

**Alternatives considered**:
- Inline the `UPDATE sync_config SET license_key = NULL` directly in each call site (as Feature 1 does for writes). Rejected because the operation needs to happen in multiple places (deactivation, expiration check, activation cache bust) and centralizing avoids duplication.
- Add the clear logic to `clearCredentials()` itself. Rejected because `clearCredentials()` is already called reactively on `AccessDeniedException` in `engine.js` (lines 226, 258, 1150), and we don't want those error-handling paths to also clear the database key — they should only clear the cache so a re-auth is attempted with the same DB key.

---

## Research Task 2: How to detect license expiration without a polling loop

**Decision**: Check license status at natural call points — specifically inside `getCredentials()` before refreshing, and inside `getPublicActivationStatus()` — and clear the sync key when an expired/grace_expired status is detected.

**Rationale**:
- The spec explicitly states: "License expiration detection does not require a dedicated background polling loop."
- `getCredentials()` in `credentials.js` is called by `engine.js` on every push (line 598) and pull (line 813) cycle. This is the ideal point to check: if the license has expired, clear the key and return null instead of attempting authentication.
- `getPublicActivationStatus()` is called by the renderer on page load and navigation. Adding a side-effect here would also catch expiration when the admin opens the app.
- The status is already computed on-the-fly by `getLicenseStatus()` — no new computation needed.

**Alternatives considered**:
- Add a `setInterval` polling loop in `main.js` that checks license status every N minutes. Rejected per spec constraint and because it adds unnecessary complexity for a condition that will be detected at the next sync attempt anyway.
- Add an Electron `powerMonitor` listener to check on resume from sleep. Rejected as over-engineering for this feature — sync operations will check on their next cycle.

---

## Research Task 3: How to invalidate cached credentials after key replacement (activation over trial)

**Decision**: Add a `clearCredentials()` call in `activateLicense()` immediately after the existing `sync_config.license_key` write (line 415 in `service.js`).

**Rationale**:
- Feature 1 already writes the new key to the database (line 415), but does NOT call `clearCredentials()`. This means the in-memory `_cachedCredentials` retains AWS credentials obtained using the old (trial) key.
- The cached credentials have a 10-minute TTL (600-second buffer in `getCredentials()` line 87), so without explicit invalidation, sync operations could continue using stale trial credentials for up to 10 minutes after paid activation.
- Calling `clearCredentials()` forces the next `getCredentials()` call to re-read the license key from the database and obtain fresh AWS credentials.

**Alternatives considered**:
- Rely on the TTL expiration (max 10 minutes). Rejected because users expect immediate effect after activation.
- Pass the new key directly to `refreshCredentials()`. Rejected because `refreshCredentials()` reads the key from the DB anyway, and the DB write already happens.

---

## Research Task 4: readLicenseKey export issue

**Decision**: Add `readLicenseKey` and `readSyncConfig` to the `module.exports` in `credentials.js`.

**Rationale**:
- `main/licensing/service.js` line 5 imports `readLicenseKey` from `../sync/credentials`, but `credentials.js` line 195 does not export it.
- This is a pre-existing bug — `readLicenseKey` resolves to `undefined` at runtime, which means `ensureTrialSyncKey()` (line 716) always sees a falsy value and may regenerate a trial key unnecessarily.
- Feature 4 also needs `readLicenseKey` to check current key state. Fixing the export is a prerequisite.
- `readSyncConfig` should also be exported since it's useful for reading the full sync config.

**Alternatives considered**:
- Duplicate the `readLicenseKey` logic in `service.js`. Rejected because it already exists in `credentials.js` and just needs to be exported.
- Move `readLicenseKey` to `service.js`. Rejected because reading sync config is logically a sync/credentials concern.

---

## Research Task 5: Where clearCredentials is currently called

**Decision**: Document current usage for reference — no changes needed to existing call sites.

**Findings**:
- `engine.js:226` — On `AccessDeniedException` in `batchWriteWithRetry` error handler
- `engine.js:258` — On `AccessDeniedException` in `writeItemWithCondition` error handler
- `engine.js:1150` — On `AccessDeniedException` in pull error handler

All three are reactive: they clear cached AWS credentials when DynamoDB rejects them, forcing a re-auth on the next attempt. This pattern is correct and should not be modified. Feature 4 adds proactive clearing at the licensing layer (deactivation, expiration), which is complementary.

---

## Research Task 6: Statuses that should trigger sync key clearing

**Decision**: Clear `sync_config.license_key` on these statuses: `expired`, `grace_expired`, `suspended`, `inactive`, `revoked`, `device_not_activated` (when triggered by deactivation action). Do NOT clear on `grace_warning`, `active`, `trial`, or `trial_expired` (trial key has its own embedded expiration).

**Rationale**:
- `expired` — License time-expired; key is no longer valid
- `grace_expired` — Grace period ended; key should be revoked
- `suspended` / `inactive` / `revoked` — Admin/server-side status changes; key should not be usable
- `device_not_activated` — After deactivation, device should lose sync access
- `grace_warning` — Still within grace period; sync should continue (FR-008)
- `active` — Obviously keep (FR-009)
- `trial` — Trial key is separately managed by Feature 2
- `trial_expired` — The trial key has an embedded `exp` date that the Auth Lambda will reject; however, for consistency we should also clear the key locally

**Revision**: After reconsideration, `trial_expired` SHOULD also trigger clearing (FR-006 requires it). Updated decision: clear on `expired`, `grace_expired`, `suspended`, `inactive`, `revoked`, `trial_expired`, and `device_not_activated` (from deactivation action).
