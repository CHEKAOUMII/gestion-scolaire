# Research: First-Run Setup Page

**Feature**: 012-first-run-setup
**Date**: 2026-03-22

## R-001: Startup Redirect Pattern

**Decision**: Check `institution_config.setup_completed` in `main.js` before `window.loadFile()`, routing to `setup.html` or `index.html`.

**Rationale**: The database is fully initialized before the window is created (`initDatabase()` → `registerAllIpcHandlers()` → `createWindow()`), so a synchronous DB query at line 158 of `main.js` is safe and deterministic. The `institution_config` table is a singleton (id=1) with a `setup_completed INTEGER DEFAULT 0` flag — querying it is trivial.

**Alternatives considered**:
- File-based flag (e.g., `.setup-complete` in userData): Rejected — adds a second source of truth outside the DB.
- Query on renderer side and redirect via JS: Rejected — causes a visible flash of the wrong page before redirect.

## R-002: IPC Handler Pattern for Pre-Auth Operations

**Decision**: Use `handleWriteNoAuth` from `ipc-helpers.js` for setup channels, since setup occurs before any user login.

**Rationale**: The existing codebase uses three IPC wrapper tiers: `handleRead` (no auth, read-only), `handleWrite` (role-based auth), and `handleWriteNoAuth` (no auth, write-enabled). Setup operations are pre-login by definition, and `handleWriteNoAuth` is specifically designed for this — it's already used for bulk import operations that happen before authentication. Raw `ipcMain.handle()` is prohibited by the constitution (Principle IV).

**Alternatives considered**:
- Raw `ipcMain.handle()`: Rejected — violates constitution Principle IV (handler wrappers required).
- `handleWrite` with a special bypass role: Rejected — overcomplicates auth logic for a pre-login flow.

## R-003: Admin Account Creation During Setup

**Decision**: Update the auto-seeded admin row (id=1) rather than inserting a new user.

**Rationale**: `createTables()` in `schema.js` already seeds a default admin user with id=1, a random password, and `must_change_password=1`. The setup page should UPDATE this row with the user's chosen name and password (and set `must_change_password=0`), not INSERT a duplicate. This avoids conflicts with the existing seeding logic and ensures the admin account always has id=1.

**Alternatives considered**:
- DELETE + INSERT new admin: Rejected — breaks referential integrity if any FK references user id=1.
- INSERT with id=2: Rejected — two admin rows is confusing and breaks the singleton admin assumption.

## R-004: HTML Page Structure for Setup Page

**Decision**: Create `setup.html` as a minimal full-screen page — same `<head>` pattern (fonts, FontAwesome, tailwind-output.css) but NO sidebar, NO quick-nav, NO shortcuts modal. Include `js/notifications.js` for toast support and `js/pages/setup.js` for page logic.

**Rationale**: The setup page is a pre-auth, full-screen wizard. Including sidebar/nav components would be incorrect (user isn't logged in) and would pull in auth-dependent JS. The `showToast()` function from `js/notifications.js` is needed for validation error feedback. Dark mode support comes automatically via `css/tailwind-output.css` and the `@variant dark` system.

**Alternatives considered**:
- Reuse the login page (`index.html`) with conditional sections: Rejected — the flows are too different; index.html has login-specific logic that would clash.
- Inline styles instead of Tailwind: Rejected — violates constitution (CSS architecture uses Tailwind).

## R-005: OTP Input UX Pattern

**Decision**: Implement 6 individual `<input>` boxes (one per digit), each accepting a single numeric character. Auto-advance focus on input, auto-submit when all 6 digits are filled.

**Rationale**: This is the standard pattern for OTP entry in modern applications. It's accessible (each input can be labeled), clear to the user (they see exactly how many digits are expected), and prevents format errors (numeric-only validation per box). The pattern is well-established in banking, two-factor auth, and device-linking UIs.

**Alternatives considered**:
- Single text input with maxlength=6: Rejected — less intuitive, harder to see progress, no auto-advance UX.
- Paste-friendly single input with visual segments: More complex to implement with no significant UX benefit for a 6-digit code.

## R-006: LAN Discovery + Server Fallback Strategy

**Decision**: On OTP submission, attempt LAN discovery for 5 seconds. If an admin device is found on the same network, verify via LAN HTTP. If not found, fall back to server (Lambda) verification. Show progress text to the user throughout.

**Rationale**: This follows the hybrid verification strategy defined in Phase 7.4 of the plan. The setup page renderer calls a single IPC channel (`linking:verifyAndLink`) which handles the LAN→server fallback internally in the main process. The renderer only needs to show progress messages and handle success/failure.

**Alternatives considered**:
- LAN-only (no server fallback): Rejected — breaks for off-site devices or different networks.
- Server-only (no LAN): Rejected — unnecessarily slow and internet-dependent when devices are co-located.

## R-007: MASSAR Code Validation

**Decision**: Validate MASSAR code as alphanumeric, trimmed, non-empty. Accept the Ministry's format (typically a letter prefix followed by digits, e.g., "M320456"). Validation is client-side (renderer) for immediate feedback, with server-side validation in the IPC handler as a safety net.

**Rationale**: The MASSAR code is a Ministry-assigned school identifier. While the exact format may vary, the plan document uses "M320456" as an example. A reasonable regex like `/^[A-Za-z]\d{4,8}$/` captures the pattern without being overly restrictive. Trimming whitespace prevents copy-paste errors.

**Alternatives considered**:
- No validation (accept any string): Rejected — would allow empty or obviously wrong codes, causing sync issues downstream.
- Strict regex from Ministry documentation: Would be ideal but we don't have the official spec; the flexible pattern is a safe default.
