# Security Review Report

**PR:** `f6cedb0..deb75ab` — Separate activation/licensing from auth/roles, add PIN lock-screen, student status page
**Date:** 2026-03-11
**Reviewer:** Automated security analysis

---

## Summary

**No high-confidence security vulnerabilities were identified in this PR.**

The changes introduce a well-structured separation of activation state from auth/role state, and a PIN-based lock screen feature. All findings were evaluated and scored below the confidence threshold for reporting.

---

## Scope of Changes

| File | Changes |
|---|---|
| `js/utils.js` | Major refactoring: separated `appAccessState` from `authRole`, added lock screen UI, PIN setup modal |
| `js/sidebar.js` | Wired lock/PIN buttons in sidebar auth section |
| `login.html` | Deduplicated `_computeSessionHash`, added PIN setup prompt after registration |
| `main/ipc/auth.js` | Added 6 PIN IPC handlers (setup, verify, remove, status, lock, unlock) |
| `main/db/schema.js` | Added `pin_hash` and `pin_failed_attempts` columns to `users` table |
| `main/db/migrations.js` | Added migration `2026-03-022-user-pin-support` |
| `preload.js` | Exposed 6 PIN channels + 2 student status channels |
| `main/ipc/students.js` | Added `getByStatus` and `updateStatusBulk` handlers |

---

## Findings Evaluated and Dismissed

### 1. Lock Screen Bypass (Server-Side Enforcement Gap)

- **Severity:** Low
- **Confidence:** 4/10 — Below threshold
- **Description:** `session.locked = true` is set in the main process in-memory session, but no IPC handler (`handleRead`/`handleWrite`) checks the `locked` flag before executing operations.
- **Why dismissed:** This is a defense-in-depth gap, not an exploitable vulnerability. The lock screen exists to deter casual physical access (passerby threat model). All viable bypass paths require DevTools access, and an attacker with DevTools + physical access has strictly more powerful options (direct filesystem access to SQLite, OS-level credential extraction). The lock screen overlay correctly covers the viewport at z-index 10200 with no pointer-events gaps.
- **Recommendation (best practice):** Consider adding a locked-state check to `requireAuth()` as a code quality improvement:
  ```js
  if (session.locked) {
      throw createAuthError('SESSION_LOCKED', '...');
  }
  ```

### 2. Weak Session Integrity Hash in localStorage

- **Severity:** Informational
- **Confidence:** 2/10 — Below threshold
- **Description:** `_computeSessionHash` uses a djb2-style hash with a hardcoded key. An attacker could forge the localStorage session to display admin UI.
- **Why dismissed:** The localStorage session is a **UI cache only**, not a security boundary. All authorization is enforced server-side via `SESSION_BY_SENDER` map, `requireAuth()`, and `requireRole()`. 30+ write handlers use `handleWrite` with explicit role lists. Forging `role: "admin"` in localStorage would render admin UI elements but every actual admin operation would fail with `FORBIDDEN` from the main process. The `auth:getSession` IPC call re-validates against the database and overwrites any stale localStorage data.

### 3. XSS in Lock Screen userName Display

- **Severity:** Informational
- **Confidence:** 2/10 — Below threshold
- **Description:** Lock screen uses `innerHTML` with user name from localStorage.
- **Why dismissed:** `escapeHtml()` is correctly applied at the interpolation point (line 1147), covering all five critical characters (`& < > " '`). The data source is localStorage, which is self-controlled — making this self-XSS at best. Additionally, `contextIsolation: true` neutralizes the blast radius even if script execution were achieved.

---

## Positive Security Observations

| Area | Assessment |
|---|---|
| **PIN hashing** | Uses the same `crypto.scryptSync` implementation as passwords (`scrypt$<salt>$<hash>` format) — appropriate strength |
| **PIN brute-force protection** | 5-attempt lockout (`MAX_PIN_ATTEMPTS = 5`) with password fallback — correctly implemented server-side in `auth:verifyPin` |
| **PIN handler authentication** | All 6 PIN IPC handlers check `getSessionByEvent(event)` before proceeding, returning `UNAUTHENTICATED` if no session |
| **SQL injection prevention** | All new queries in `students:getByStatus` and `students:updateStatusBulk` use parameterized statements (`?` placeholders) |
| **Input validation** | PIN format validated server-side (`/^\d{4,6}$/`); student status values validated against allowlist (`['active', 'dropout', 'expelled', 'not_enrolled']`); batch size capped at 500 |
| **XSS protection** | `escapeHtml()` correctly applied where user data is interpolated into innerHTML templates |
| **Authorization on writes** | `students:updateStatusBulk` uses `handleWrite` with `['admin', 'staff']` role restriction |
| **Session separation** | Clean separation of `appAccessState` (licensing) from `authRole` (user session) — activation never creates sessions, login never changes activation state |

---

## Pre-Existing Issues Noted (Not Introduced by This PR)

- `main/ipc/staffAttendance.js`: `save` and `delete` operations use `handleRead` instead of `handleWrite`, meaning they perform no authentication or role checks. This is a pre-existing bug and was **not modified** in this PR.

---

## Conclusion

This PR introduces no new security vulnerabilities. The PIN implementation follows security best practices (scrypt hashing, server-side attempt limiting, proper authentication guards). The state separation refactoring correctly maintains the existing server-side authorization model. All user inputs in new code paths are properly validated and parameterized.
