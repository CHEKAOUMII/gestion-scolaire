# US1 baseline verification note

**Date:** 2026-07-17  
**Feature:** 027-layering-remediation

Automated gates after Phase 2–6 implementation:

- [x] `npm run test:smoke` — passed (225 channels, sync registry OK)
- [x] Unit: `tests/repos-capture-port.test.js`
- [x] Unit: `tests/sync-exact-bulk-capture.test.js`
- [x] Unit: `tests/repos-domain-key-fields.test.js`
- [x] Unit: `tests/auth-lockout-policy.test.js`, `tests/auth-session-policy.test.js`
- [x] Domain repo tests present (exams/staff/orientation; SQL paths skip when better-sqlite3 ABI mismatches system Node — Electron rebuild still used for app runtime)

Manual UI regression (login, exams write, staff write, orientation write, sync push) should be run on a school dataset before release (`specs/027-layering-remediation/quickstart.md`).
