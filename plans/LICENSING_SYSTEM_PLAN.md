# Licensing System Implementation Plan

Created: 2026-05-04  
Source documents: `plans/ACTIVATION_PROPOSAL.md`, `plans/ACTIVATION_PROPOSAL_2.md`

## 1. Recommendation

Use a **Hybrid School Subscription** model:

- Sell the license to a school/institution, not to individual users.
- Keep local offline operation as the primary mode.
- Bind each license to a maximum number of activated devices.
- Allow periodic online validation only for cloud-enabled plans.
- When a subscription expires, downgrade features instead of blocking access to school data.

This is stronger than a strict machine-only license because Moroccan school deployments often need reinstall tolerance, device replacement, and unreliable internet support. It is also stronger than cloud-only subscription because the product is already Electron + SQLite + offline-first.

## 2. Current State

The repo already contains most of the licensing foundation:

- Offline serial keys in `main/licensing/offlineKey.js`.
- Device fingerprinting and fuzzy reinstall matching in `main/licensing/deviceFingerprint.js`.
- Trial service in `main/licensing/trialService.js`.
- License lifecycle and device activation in `main/licensing/service.js`.
- SQLite tables for `license_plans`, `licenses`, `license_activations`, and `license_events`.
- Owner telemetry and heartbeat in `main/licensing/ownerSync.js`, `main/ipc/ownerTelemetry.js`, and `server/index.js`.
- Admin UI in `settings-license.html` and `js/pages/settings-license.js`.

Important gaps found while reading the current code:

- Enforcement is disabled by `LICENSING_ENFORCEMENT_DISABLED = true` in `main/licensing/service.js`.
- `window.api.licensing.generateSerial()` is used by the UI but is not exposed in `preload.js` and has no IPC handler.
- `window.api.licensing.activate()` is used by `js/pages/settings-license.js`, while preload exposes `activatePublic()`.
- `window.api.ownerTelemetry.saveConfig()` and `testConnection()` are used by the UI but are not exposed in preload and have no IPC handlers.
- Trial defaults to `6months`; the proposal recommends 30 days.
- Existing plan codes are only `basic`, `pro`, and `business`.
- HMAC licensing uses a shared secret model. Any secret embedded in the app can eventually be extracted and used to generate valid keys.

## 3. Better Proposal

Adopt this improved model instead of the raw proposals exactly as written:

### Commercial Model

Use school-friendly plan labels, while keeping stable internal codes for backward compatibility.

| Internal code | Display name | Devices | Sync | Best use |
| --- | --- | ---: | --- | --- |
| `free` | Free | 1 | No | Expired subscriptions, limited evaluation |
| `basic` | School Standard | 2 | No | Single school, local administration |
| `pro` | School Plus | 5 | Yes | School with several administrative devices |
| `business` | Multi-School | 10 | Yes | Larger deployment or owner-managed installs |
| `enterprise` | Enterprise | Custom/15+ | Yes | Academy, custom support, multi-school contracts |

Reason: changing all existing codes now creates avoidable migration risk. The UI can show better names while the database and old keys keep working.

### Security Model

Move new licenses from HMAC to asymmetric signatures:

- Current format: `GSLK-...` verified with HMAC secret.
- New format: `GSLK2-...` signed with Ed25519 private key.
- Electron app includes only the Ed25519 public key.
- CLI/Firebase/owner tools keep the private key.
- Keep `GSLK-` decode support temporarily for existing licenses.

Important correction to the first proposal: a separate HMAC "verify secret" is not enough if the app can compute valid signatures with it. HMAC is symmetric. The clean solution is public-key verification.

### Expiry Behavior

Never lock users out of their local data. On expiry:

- Read access stays available.
- Core identity, students, attendance, and local data browsing remain available.
- Premium writes/exports/sync are downgraded based on feature gates.
- The app shows renewal warnings 30, 14, 7, and 1 day before expiry.
- After expiry + grace period, the effective plan becomes `free`.

## 4. Target Architecture

### License Status Flow

1. App starts.
2. `getPublicActivationStatus()` checks local license, current device, expiration, and grace period.
3. If no valid license exists, trial status is checked.
4. If trial is active, the effective plan is `trial`.
5. If trial is expired, the effective plan is `free`.
6. If license is valid, the effective plan is the license plan.
7. For sync-enabled plans, online validation runs periodically and updates `last_validated_at`.

### Feature Gates

Add `main/licensing/featureGates.js` as the single source of truth.

```js
const FEATURE_GATES = {
    free: {
        maxStudents: 200,
        grades: false,
        reports: false,
        backup: false,
        firebaseSync: false,
        advancedAnalytics: false,
        multiSchool: false,
        autoUpdate: false
    },
    basic: {
        maxStudents: Infinity,
        grades: true,
        reports: true,
        backup: true,
        firebaseSync: false,
        advancedAnalytics: false,
        multiSchool: false,
        autoUpdate: true
    },
    pro: {
        maxStudents: Infinity,
        grades: true,
        reports: true,
        backup: true,
        firebaseSync: true,
        advancedAnalytics: true,
        multiSchool: false,
        autoUpdate: true
    },
    business: {
        maxStudents: Infinity,
        grades: true,
        reports: true,
        backup: true,
        firebaseSync: true,
        advancedAnalytics: true,
        multiSchool: true,
        autoUpdate: true
    },
    enterprise: {
        maxStudents: Infinity,
        grades: true,
        reports: true,
        backup: true,
        firebaseSync: true,
        advancedAnalytics: true,
        multiSchool: true,
        autoUpdate: true
    }
};
```

Protected feature groups:

| Feature gate | Protects |
| --- | --- |
| `grades` | Grades entry, exam results, semester results |
| `reports` | Official report generation and bulk printing |
| `backup` | Scheduled backup and cloud backup features |
| `firebaseSync` | Firebase sync setup, push, pull, auth exchange |
| `advancedAnalytics` | Dashboards beyond basic counts |
| `multiSchool` | Owner/admin multi-school workflows |
| `autoUpdate` | Automatic app updates after subscription expiry |

## 5. Implementation Phases

### Phase 0: Baseline Fixes

Goal: make the existing UI and IPC contracts coherent before adding enforcement.

- Add `generateSerialKey` IPC handler in `main/ipc/licensing.js`.
- Expose `licensing.generateSerial()` in `preload.js`.
- Either expose `licensing.activate()` as an alias or update `js/pages/settings-license.js` to call `activatePublic()`.
- Implement and expose owner telemetry `saveConfig()` and `testConnection()`.
- Reduce default trial duration from `6months` to `1month`.
- Add tests or smoke checks for activation request, serial generation, activation, device listing, owner telemetry config save, and trial status.

### Phase 1: Plan Model and Migrations

Goal: support the final commercial plan set without breaking existing installs.

- Update `ensureLicensingSchema()` to seed `free`, `basic`, `pro`, `business`, and `enterprise`.
- Set recommended device limits: `free=1`, `basic=2`, `pro=5`, `business=10`, `enterprise=15`.
- Keep old `business` plan code as the internal code for "Multi-School".
- Update `offlineKey.js` and `generateSerialKey()` allowed plans.
- Update `settings-license.html` plan dropdown labels.
- Add plan metadata in code, not scattered UI strings.

### Phase 2: Feature Gate Service

Goal: centralize plan-to-feature decisions.

- Add `main/licensing/featureGates.js`.
- Add `getEffectiveLicenseContext()` in `main/licensing/service.js`.
- Add `checkFeature(featureKey, options)` returning `{ allowed, reason, effectivePlan, limits }`.
- Add IPC channel `licensing:checkFeature` for renderer guards.
- Expose `window.api.licensing.checkFeature(featureKey, options)` in `preload.js`.
- Return consistent errors: `UPGRADE_REQUIRED`, `TRIAL_EXPIRED`, `LICENSE_EXPIRED`, `DEVICE_NOT_ACTIVATED`, `SYNC_NOT_INCLUDED`.

### Phase 3: Enforcement Integration

Goal: enforce only high-value operations first, while keeping data visible.

- Gate Firebase sync setup and sync start with `firebaseSync`.
- Gate grades write/import/export with `grades`.
- Gate official report generation and bulk print with `reports`.
- Gate scheduled backup with `backup`.
- Gate advanced dashboards with `advancedAnalytics`.
- Gate auto-update checks with `autoUpdate`.
- Keep student list, attendance viewing, school identity, local login, and settings access available.

Do not place feature logic directly inside renderers. Renderers may hide buttons for UX, but the main-process IPC handlers must enforce the gate.

### Phase 4: Expiry and Grace Period

Goal: convert licensing from "app locked" to "effective plan downgraded".

- Keep `expires_at` as the subscription end date.
- Add `effectivePlanCode` to public and admin status responses.
- For active trial: `effectivePlanCode = trial`.
- For expired license after grace: `effectivePlanCode = free`.
- For expired license inside grace: keep licensed plan but add `expiryWarning`.
- Add notification/status messages for 30/14/7/1 days remaining.
- Add a sidebar status badge showing plan, expiry, and device usage.

### Phase 5: Online Validation and Firebase Claims

Goal: make cloud features available only for eligible paid plans.

- Update `firebase/functions/index.js` `authExchange` to reject `free` and `basic` if cloud sync is not included.
- Include `planCode`, `expiresAt`, `maxDevices`, and `syncEnabled` in custom token claims where appropriate.
- Store a server-side license document per school/customer for optional revocation and device inventory.
- Do not require internet for every app launch.
- Use owner telemetry for monitoring and support, not as the only enforcement mechanism.

### Phase 6: License Key Security Upgrade

Goal: stop shipping a signing secret inside the Electron app.

- Add `main/licensing/licenseKeyV2.js` for Ed25519 verification.
- Add `scripts/generate-license-key-v2.js` for private-key signing.
- Introduce `GSLK2-` keys.
- Keep legacy `GSLK-` HMAC verification for a migration period.
- Remove local per-installation secret generation from new license verification paths.
- Document private key storage and rotation.

### Phase 7: Admin UX

Goal: make licensing understandable for the school admin.

- Update `settings-license.html` to show current plan, effective plan, expiry, grace days, and device usage.
- Show feature availability by plan.
- Add renewal key flow that updates license metadata without deleting existing device activations when customer reference matches.
- Add device slot management with clear current-device protection.
- Add Arabic messages for expired, grace, upgrade required, device limit, and device mismatch states.

### Phase 8: Enforcement Switch

Goal: enable enforcement after tests pass.

- Replace `LICENSING_ENFORCEMENT_DISABLED = true` with environment/config-controlled behavior.
- Default production builds to enforcement enabled.
- Keep development override explicit, for example `GESTION_DISABLE_LICENSING=1`.
- Add smoke test coverage before flipping production behavior.

## 6. File Impact Map

| File | Planned change |
| --- | --- |
| `main/licensing/service.js` | Effective plan, checkFeature, expiry downgrade, enforcement flag |
| `main/licensing/offlineKey.js` | Add plans, keep legacy HMAC decode |
| `main/licensing/licenseKeyV2.js` | New Ed25519 verification |
| `main/licensing/featureGates.js` | New feature gate matrix |
| `main/licensing/trialService.js` | Default trial = 30 days |
| `main/db/schema.js` | Seed new/updated plans |
| `main/ipc/licensing.js` | Generate serial IPC, checkFeature IPC |
| `main/ipc/ownerTelemetry.js` | Save config and test connection IPC |
| `preload.js` | Expose missing licensing and owner telemetry APIs |
| `settings-license.html` | Plan labels, status, device usage, renewal UX |
| `js/pages/settings-license.js` | Align API names, render new plan/status fields |
| `main/ipc/sync.js` | Gate sync operations |
| `main/ipc/reports.js` | Gate protected report generation |
| `main/ipc/exams.js` | Gate grades/exams if applicable |
| `main/updater.js` | Gate auto updates after expiry |
| `firebase/functions/index.js` | Cloud sync eligibility and license claims |
| `scripts/generate-license-key.js` | Legacy support only |
| `scripts/generate-license-key-v2.js` | New signing CLI |

## 7. Acceptance Criteria

- A fresh install starts a 30-day full trial.
- After trial expiry, the app remains usable in `free` mode.
- A valid `basic` key activates offline and allows two devices.
- A valid `pro` key enables Firebase sync and allows five devices.
- A `basic` or `free` license cannot start Firebase sync.
- Expired paid licenses downgrade to `free` after grace without deleting data.
- Existing `GSLK-` keys continue to work during migration.
- New `GSLK2-` keys verify using only a public key in the app.
- Device reinstall fuzzy matching still preserves a device slot.
- Device limit errors show active devices so the admin can revoke old slots.
- Production enforcement can be enabled without changing source code again.

## 8. Risks and Decisions

- Feature gating must be enforced in main-process IPC, because renderer-only hiding is not security.
- Report and grade gates should avoid blocking read-only access to old data.
- `business` should remain as an internal code until all existing keys are migrated.
- Owner telemetry should help support and revocation decisions, but offline licenses must still work when the owner server is down.
- Ed25519 migration should be done before serious commercial rollout, because HMAC secrets inside desktop apps are not durable protection.
- Pricing should remain outside code. Code should know plans and capabilities, not MAD prices.

## 9. Suggested Build Order

1. Fix missing IPC/preload mismatches.
2. Add plan seeding and feature gate matrix.
3. Add main-process `checkFeature()` and use it in sync, reports, grades, and backup.
4. Add effective-plan downgrade behavior.
5. Improve licensing UI and Arabic messages.
6. Add `GSLK2` Ed25519 signing and verification.
7. Update Firebase `authExchange` for cloud plan eligibility.
8. Run full smoke tests and enable production enforcement.

