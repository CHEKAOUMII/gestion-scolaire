# Research: Device Management UI

**Feature**: 014-device-management-ui
**Date**: 2026-03-23

## R1: IPC Architecture for Device Management

**Decision**: Create a new `main/ipc/linking.js` module with 6 post-auth channels using `handleWrite` (admin-only) and `handleRead` (public), plus leverage existing `setup:getInstitutionStatus` for institution context.

**Rationale**:
- The Phase 7.6 plan specifies a dedicated `linking` IPC namespace with 10 channels (4 pre-auth + 6 post-auth). The device management UI only needs the 6 post-auth channels.
- Pre-auth channels (`linking:getInstitutionStatus`, `linking:setupNewInstitution`, `linking:verifyAndLink`, `linking:discoverLanDevices`) already exist under the `setup:` namespace in `main/ipc/setup.js` — these serve the first-run setup page (Phase 7.5), not the device management UI.
- The 6 new post-auth channels needed: `linking:generateOtp`, `linking:cancelOtp`, `linking:getOtpStatus`, `linking:getLinkedDevices`, `linking:revokeDevice`, `linking:getCurrentDevice`.
- IPC helpers available: `handleWrite(ipcMain, channel, roles, handler)` for admin-only write operations, `handleRead(ipcMain, channel, handler)` for public reads. Note: `handleWriteNoAuth` does not exist — the codebase uses `handleWriteSoftAuth` for pre-login operations.

**Alternatives considered**:
- Extending `setup.js` with the admin channels — rejected because `setup.js` uses `handleWriteSoftAuth` (pre-login pattern) while device management channels require full admin auth via `handleWrite`.
- Using `sync.js` for device management — rejected because device management is a distinct domain from sync operations.

## R2: Settings Page HTML Structure

**Decision**: Add the device management section directly to the existing `settings-sync.html` page, inside a new `<div class="students-results">` card below the existing sync content.

**Rationale**:
- `settings-sync.html` already exists (322 lines) following the standard standalone page boilerplate (`<html lang="ar" dir="rtl">`, `standalone-page` main class, `unified-header`, `grades-container` content wrapper).
- The page already loads `js/pages/settings-sync.js` which has the `isAdmin` role check, `formatRelativeTime()` helper, and `showToast()` integration — all needed by device management.
- Adding sections to the existing page avoids creating a separate HTML file and JS module, keeping the feature cohesive with sync settings.

**Alternatives considered**:
- Creating a separate `settings-devices.html` + `js/pages/settings-devices.js` — rejected because the Phase 7.7 plan explicitly calls for adding to the existing sync settings page, and device management is conceptually part of sync infrastructure.

## R3: Admin-Only UI Visibility Pattern

**Decision**: Use the established two-layer pattern: (1) `document.body.classList.add('sync-readonly')` for non-admins, (2) `admin-only` CSS class on elements + conditional JS rendering.

**Rationale**:
- `settings-sync.js` already implements this exact pattern at line 1 of its `DOMContentLoaded` handler: reads `gsl_auth_session_v1` from localStorage, checks `sess.role === 'admin'`, adds `sync-readonly` class if not admin.
- The conflict resolution table uses `admin-only` class on `<td>` elements and conditional button injection in JS.
- Reusing the same pattern ensures visual and behavioral consistency.

**Alternatives considered**:
- Server-side role filtering (returning different data shapes per role) — rejected because the app already uses client-side role gating consistently, and the IPC layer enforces auth at the handler level anyway.

## R4: OTP Display and Countdown Timer

**Decision**: Use `setInterval` with 1-second ticks, computing remaining time from `expiresAt` ISO timestamp (not from a decrementing counter), to prevent drift.

**Rationale**:
- `getActiveOtp(db, massarCode)` returns `{ active: true, expiresAt: string, remainingSeconds: number }`. The `expiresAt` is an absolute ISO-8601 timestamp — the countdown should compute `Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000))` on each tick.
- This approach is drift-resistant: even if `setInterval` fires late, the displayed time is always correct relative to the wall clock.
- OTP TTL is 10 minutes (from `OTP_TTL_MS = 10 * 60_000` in `otp.js`).

**Alternatives considered**:
- Simple decrementing counter (`remainingSeconds--` each tick) — rejected because `setInterval` drift over 10 minutes can accumulate 1-3 seconds of error.

## R5: OTP Status Persistence Across Navigation

**Decision**: On page load, call `linking:getOtpStatus` to check for an active OTP. If active, restore the OTP display with the correct remaining countdown. The OTP plaintext digits are NOT stored — only the status and expiry are checked.

**Rationale**:
- `getActiveOtp()` returns `{ active, expiresAt, remainingSeconds }` — this is sufficient to show the countdown timer, but the actual 6-digit OTP is only returned at generation time and cannot be retrieved later (it's hashed in the DB).
- For persistence, the plaintext OTP can be held in a JS module-level variable and also stored in `sessionStorage` (cleared on app close). On page return, if `getOtpStatus` shows active and `sessionStorage` has the OTP, restore the full display. If the OTP digits are lost (app restart), show only the countdown with a "code was generated" state.

**Alternatives considered**:
- Storing OTP in localStorage — rejected because OTP is a security-sensitive value; sessionStorage is scoped to the window/tab lifetime which matches the OTP's 10-minute TTL appropriately.
- Re-generating OTP on page return — rejected because it would invalidate the OTP the admin already communicated to the other device.

## R6: Device Table Data Shape

**Decision**: Use `linking:getLinkedDevices` IPC channel returning rows from `linked_devices` table, mapped to display-friendly objects.

**Rationale**:
- The `linked_devices` table schema provides: `device_hash`, `device_name`, `os_platform`, `app_version`, `linked_by` (enum: `'setup_new'` | `'otp_lan'` | `'otp_server'`), `linked_at`, `last_seen_at`, `revoked_at`, `status` (enum: `'active'` | `'revoked'`).
- The UI will map `linked_by` values to Arabic labels: `'setup_new'` → `'إعداد جديد'`, `'otp_lan'` → `'ربط محلي'`, `'otp_server'` → `'ربط عبر السيرفر'`.
- The `last_seen_at` timestamp will be formatted using the existing `formatRelativeTime()` helper in `settings-sync.js`.
- The current device is identified by comparing each row's `device_hash` with the result of `linking:getCurrentDevice`.

## R7: LAN Server Lifecycle During OTP Generation

**Decision**: When admin generates OTP from the device management UI, the IPC handler should also start the LAN linking server (`startLinkingServer(db)`) so that nearby devices can discover and link via LAN automatically.

**Rationale**:
- `startLinkingServer(db)` from `lan.js` starts both the UDP beacon broadcaster (port 19877) and the HTTP verification server (port 19876). It auto-stops when the OTP expires.
- `stopLinkingServer()` is synchronous and idempotent — safe to call on cancel or cleanup.
- This means `linking:generateOtp` handler must call both `generateOtp()` from `otp.js` and `startLinkingServer()` from `lan.js`.
- Similarly, `linking:cancelOtp` must call both `cleanupExpiredOtps()` and `stopLinkingServer()`.

**Alternatives considered**:
- Starting LAN server separately via a dedicated button — rejected because the LAN server is only useful when an OTP is active, so coupling them simplifies the UX.
