# Codebase Review Remediation Plan

| | |
|---|---|
| **Date** | 2026-09-10 |
| **Status** | Proposed — ready for approval. No code changes made yet. |
| **Source** | Repo-wide review of `gestionScholaire3` @ `8efeb9b` (branch `029-stage-rules-management`), 2026-09-10. Findings were produced from a full static sweep plus four parallel deep-dives (main-process security, data/sync, renderer, tests/CI) and independently re-verified where marked ✅. |
| **Scope** | Security and data-integrity fixes, authorization completion, renderer hardening, CI/supply-chain, repo hygiene. |
| **Not in scope** | Feature work (`docs/plans/2026-08-26-exams-module-isolation-plan.md`), multi-stage roadmap, import-center redesign, licensing product decisions beyond the disabled-state note, Electron version migration execution (tracked in E3 only). |
| **Baseline** | `npm run lint` = 0 errors / 75 warnings · `npm test` = 261/261 ✅ · `npm run test:fairness` = 40/40 ✅ · CI `quality` structurally red (Node 20 vs `node:sqlite`) · full `npm audit` = 3 critical / 19 high / 3 moderate. |
| **Prior art** | `docs/code-review-report.md` (2026-07-21, same critical findings #5/#6/#8 — still open), `docs/reviews/2026-08-08-import-system-audit.md` (P2-28 outbox retention), `docs/plans/2026-07-15-add-write-channel-checklist.md`. |

> **One-line goal:** close the live security and data-loss holes first (unauthenticated admin reset, public PII hosting, unauthenticated backup/restore, pending-outbox purge), then finish the half-done authorization migration and repair the broken sync capture paths — each fix covered by a guard test so it cannot regress.

---

## 0. How to read this plan

### 0.1 Severity

| Tag | Meaning | SLA |
|---|---|---|
| 🔴 P0 | Exploitable now / live data exposure / silent data loss | Wave 0 — same working day |
| 🟠 P1 | High impact, requires a small change or a missing guard | Wave 1 — week 1 |
| 🟡 P2 | Real defect or contract drift, bounded impact | Wave 2 — weeks 2–3 |
| 🟢 P3 | Hygiene, duplication, quality | Wave 3 — backlog |

### 0.2 Task format

Each task has: **Problem**, **Evidence**, **Fix**, **Verification**, **Depends on**, **Estimate**. Estimate is engineering time (excluding review/QA).

### 0.3 Execution rules (from AGENTS.md — non-negotiable)

1. Domain SQL lives in `main/repos/*`; IPC handlers only auth → validation → repo → response. Documented exemptions: `system-backup.js`, `sync.js`, `settings-ipc.js`, `ipc-helpers.js`, `import-audit.js`, `app-admin.js` (`tests/ipc-layering-guard.test.js`).
2. Change-tracking goes through `main/repos/capture-port.js`; bulk/multi-row writes use `captureMode: 'explicit'` + `exclude: true` and write outbox rows inside the same SQLite transaction.
3. Every new write channel follows `docs/plans/2026-07-15-add-write-channel-checklist.md`.
4. Sync contract changes (tables, columns, remote keys, `contractVersion`, `minAppVersion`) are version-gated via `main/sync/entity-registry.js`; stale clients must keep working (pull-side downgrade guard).
5. No behavior change to page URLs, preload namespace names, or IPC channel names unless a task explicitly says so.
6. Every task lands with a test in the same commit series; `npm test` and `npm run lint` stay green.

### 0.4 Guard tests to be created by this plan

| Test file | Guards | Introduced by |
|---|---|---|
| `tests/ipc-auth-matrix.test.js` | every raw `ipcMain.handle` channel has an explicit auth decision | A4 |
| `tests/backup-restore-auth.test.js` | backup/restore role + session matrix | A3 |
| `tests/outbox-cleanup-retention.test.js` | pending/failed rows survive cleanup | B1 |
| `tests/sync-stage-rules-cross-device.test.js` | rule_set_id remap across diverged local ids | B2 |
| `tests/sync-upsert-capture.test.js` | upserts capture the real affected row | B3 |
| `tests/sync-bulk-channels-explicit.test.js` (extend) | no `BULK_EXTRACTORS` entry without explicit capture | B4 |
| `tests/sync-synclog-ordering.test.js` | entity never marked sent without its syncLog entry | B5 |
| `tests/sync-conflict-resolution-atomicity.test.js` | resolveConflict is all-or-nothing | B6 |
| `tests/backup-restore-integrity.test.js` | restore refuses FK violations | B7 |
| `tests/firebase-functions-client.test.js` | response-code mapping incl. `PENDING_REQUEST_EXISTS` | C6 |
| `tests/renderer-escape-guard.test.js` | priority pages contain no unescaped tainted interpolations | D1 |
| `tests/session-ttl.test.js` | expired in-memory session is rejected | C3 |
| `tests/firebase-config-guard.test.js` | hosting public dir is a dedicated folder; no secrets in its tree | A2/F1 |

---

## 1. Baseline evidence (verified 2026-09-10)

| Area | Evidence |
|---|---|
| Tests / lint | `npm test` → `[run-all] 261/261 passed in 46.88s`; `npm run lint` → `0 errors, 75 warnings` |
| CI | `.github/workflows/ci.yml:18,51` pin `node-version: 20`; 6 test files require `node:sqlite` at module scope (needs Node ≥ 22.5) |
| Orphan tests | `tests/orientation/*` (4), `tests/integration/*` (9), 13 files skipped by `isPreFixExploration` marker, `tools/tailwind-standardize/tests/*` (29) — none executed by `npm test` or CI |
| Hosting | `https://gestionscholaire.web.app/ListEleve_20251124.xlsx`, `/MoyenneCc_*.xlsx`, `/Bulletin_*.pdf`, URL-encoded `نتائج/…zip|.xlsx` all return HTTP 200 with no auth (HEAD only; no data downloaded). Cache: `.firebase/hosting..cache` (86 entries) |
| Root cause | `firebase.json:1-9` → `hosting.public: "."` with only `firebase.json`, `**/.*`, `**/node_modules/**` ignored |
| Critical IPC | `main/ipc/system.js:307-323` `users:resetAdminPassword` raw handler, no auth, returns plaintext password; exposed at `preload.js:343`; **no renderer caller** |
| Critical IPC | `main/ipc/system-backup.js:208-214, 264-270, 417-423` proceed with no session for full DB backup/restore |
| Data loss | `main/sync/capture.js:1102-1114` `DELETE FROM sync_outbox WHERE created_at < …` has no status filter; started at `main/ipc/registerAll.js:78`, runs at startup + every 6 h |
| Sync corruption | `main/sync/entity-registry.js:491-540` remote keys include local autoincrement `rule_set_id`; child tables have `applyHooks: {}` (`apply-hooks-stage-rules.js:160-162` registers only `stage_rule_sets`) |
| XSS | Eight page scripts (+ `app.js`) contain `innerHTML` templates over DB/import data with missing or incomplete escaping (list in D1) |
| Working tree | 368 files show as modified; only 11 differ beyond CRLF (`git diff --stat --ignore-cr-at-eol`); no `.gitattributes` |

---

## 2. Waves and ordering

| Wave | When | Tasks | Rationale |
|---|---|---|---|
| **0 — Stop the bleed** | Same day | A1, A2, A3, B1, E1 | Live exploit/data-loss paths and CI truth. All small, no migrations. |
| **1 — Mechanical hardening** | Week 1 | A4, C4, C5, C6, B3, B4, E3, E4 | Low-risk fixes with immediate guard tests; no sync contract change. |
| **2 — Contract & authorization** | Weeks 2–3 | B2, B5, B6, B7, C1, C2, C3, D1 | Sync contract change (needs version gate), auth migration, XSS sweep. |
| **3 — Resilience & hygiene** | Week 4+ | D2, D3, D4, D5, E2, E5, F1–F4, B8 | Backlog; parallelizable. |

Dependency notes:

- **B2 blocks nothing else** but must not be released before its `minAppVersion` gate is set. Old clients keep the old (broken) behavior; new clients must tolerate both payload shapes.
- **C1** must land before **C2** (role matrix only matters once reads are session-aware) and is a prerequisite for confidently removing `allowNoSession` channels (C4).
- **A2** (hosting) is independent and can be done out-of-band of the repo work.
- **F1** (line endings) must be resolved before any large cleanup commit to avoid an unreadable diff.

---

## 3. Track A — Security incident response

### A1 🔴 Remove `users:resetAdminPassword` (or gate it behind a real recovery flow)

**Problem.** A raw IPC handler resets `admin@school.local` to `role='developer', disabled=0, must_change_password=0` — or creates that account — and returns the plaintext password in the response. It has no session/role check and is exposed on `window.api`. With DevTools enabled (not disabled in `main.js:189-194`) and context isolation, any user at the device can promote themselves to developer. `preload.js:343` is the only call site anywhere in the repo (`js/`, `app.js`, HTML) — there is no UI consumer.

**Evidence.** `main/ipc/system.js:307-323`; `main/repos/users.js:244-254`; `main/auth/firebase-auth-service.js:353-459` (local fallback accepts `auth_source='local'`); `preload.js:343`; prior identification in `docs/code-review-report.md` §5.

**Fix (preferred).**
1. Delete the `ipcMain.handle('users:resetAdminPassword')` block and the `preload.js` entry.
2. Delete `usersRepo.getAdminUser` / `resetAdminPassword` / `createDeveloperUser` if no other caller (grep first).
3. If a recovery path is genuinely needed, replace it with an explicit support flow: write a one-time recovery token to a local file under `userData` (never returned over IPC), require an operator to read it, and require `developer` role for the reset. Never return/log a plaintext password.

**Verification.**
- `grep -rn "resetAdminPassword" main js preload.js app.js *.html` → only (updated) tests/docs remain.
- `tests/ipc-auth-matrix.test.js` (A4) asserts the channel no longer exists or is role-gated.
- New regression: a teacher session invoking the old channel name gets `UNAUTHENTICATED`/not-found.

**Depends on.** —
**Estimate.** 1 h.

### A2 🔴 Purge student PII from Firebase Hosting and fix the deploy config

**Problem.** The live default hosting site serves student rosters, averages, report cards, and grade-export archives without authentication. The local deploy cache proves these were published. Root `firebase.json` publishes the whole repo (`public: "."`), so the next `firebase deploy --only hosting` would also upload `firebase/gestionscholaire-firebase-adminsdk-*.json` (service-account private key; not dot-prefixed, therefore **not** matched by the `**/.*` ignore).

**Evidence.** HEAD checks (no data downloaded): `ListEleve_20251124.xlsx`, `MoyenneCc_639056686387748616.xlsx`, `Bulletin_639056745880634038.pdf`, `%D9%86%D8%AA%D8%A7%D8%A6%D8%AC/export_notesCC_501396.zip`, `%D9%86%D8%AA%D8%A7%D8%A6%D8%AC/export_notesCC_104838(1)/export_notesCC_1BACSMF-1_0024.xlsx` → all HTTP 200. `.firebase/hosting..cache` lists 86 published entries. `firebase/*adminsdk*.json` currently 404s, `.env` 404s.

**Fix.**
1. **Immediate (outside the repo):** deploy a neutral placeholder to the site so the data URLs return 404 —
   ```bash
   mkdir -p hosting-empty && printf '<!-- disabled -->' > hosting-empty/index.html
   npx firebase-tools deploy --only hosting --project gestionscholaire --public hosting-empty
   ```
   or disable hosting entirely (`npx firebase-tools hosting:disable --project gestionscholaire`) if it has no product purpose.
2. Re-check every URL from `.firebase/hosting..cache` returns 404 (script in Verification).
3. Change root `firebase.json`: either remove the `hosting` block or point it at a dedicated `hosting/` folder with an explicit allowlist; never `.`.
4. Ensure `firebase/*adminsdk*.json`, `.env*`, `*.db`, `*.xlsx`, `*.pdf`, `*.zip`, and `نتائج/` are excluded from any deploy (deploy-time ignore list + `firebase-config-guard` test).
5. Record the exposure window in `docs/security/incident-2026-09-hosting-pii.md` (files, dates from the cache, who was notified) and rotate the admin SDK key if there is any doubt it was ever uploaded (rotate regardless if the key predates the last deploy).
6. Provide the school administration a short notice draft (data protection).

**Verification.**
```bash
for p in "/ListEleve_20251124.xlsx" "/MoyenneCc_639056686387748616.xlsx" \
         "/Bulletin_639056745880634038.pdf" "/%D9%86%D8%AA%D8%A7%D8%A6%D8%AC/export_notesCC_501396.zip"; do
  curl -s -o /dev/null -w "%{http_code} $p\n" -I "https://gestionscholaire.web.app$p"
done   # expect 404/410 for all
```
- `tests/firebase-config-guard.test.js`: fails if `firebase.json` `hosting.public` is `.`/repo root, or if the hosting tree contains secret/PII patterns.

**Depends on.** —
**Estimate.** 2–4 h + school communication.

### A3 🔴 Require authentication and role for backup/restore

**Problem.** `system:backupDb`, `system:restoreDb`, `system:restoreDbContent` skip auth when no session exists ("settings-imports page is pre-login"). The justification is false: pre-login windows load only `setup.html`/`login.html`; `js/backup.js` is included only by `index.html` and `settings-imports.html`, both post-login. No-session behavior leaks the full DB and permits overwriting it (also an auth bypass via restored `users`).

**Evidence.** `main/ipc/system-backup.js:208-214, 264-270, 417-423`; callers `js/backup.js:123-125, 240-271`; page includes `grep -l js/backup.js *.html` → `index.html`, `settings-imports.html`.

**Fix.**
1. `system:backupDb`: require a session and role `['admin','principal']` (settings-imports audience); return `authErrorResponse` on failure.
2. `system:restoreDb` / `system:restoreDbContent`: require session + `['admin']`, plus a mandatory `confirm: true` for content restore, and take an automatic safety backup before replacing data.
3. Delete the "pre-login" comments.
4. Update `docs/plans/2026-07-15-add-write-channel-checklist.md` with a "no school-data channel may use `allowNoSession`" rule (already stated there; add the backup reference).

**Verification.** New `tests/backup-restore-auth.test.js`: no session → `UNAUTHENTICATED`; teacher → `FORBIDDEN`; principal → backup OK / restore `FORBIDDEN`; admin + confirm → OK. `tests/ipc-auth-matrix.test.js` pins the channel declarations. Manual: `settings-imports.html` backup/restore as principal/admin.

**Depends on.** —
**Estimate.** 3–4 h incl. tests.

### A4 🟠 Raw-handler auth audit + permanent guard

**Problem.** 50 direct `ipcMain.handle` registrations outside the four wrappers in `ipc-helpers.js` (54 total in `main/`) bypass `handleRead`/`handleWrite` helpers. Some intentionally public (`auth:*`, `licensing:getPublicStatus`, `licensing:activatePublic`, `diagnostics:reportRendererError`), some admin-gated manually (`ownerTelemetry:*` ✅), but several are unauthenticated or unclassified: `system:printCurrentWindow`, `system:printToPDF`, `system:printHTML`, `updater:checkForUpdates`, `updater:downloadUpdate`, `updater:installUpdate`, `app:quit`, `diagnostics:getRecent`, `diagnostics:exportLog`, `diagnostics:revealLog`.

**Evidence.** `grep -rn "ipcMain.handle(" main/` → 54 hits; 50 outside `ipc-helpers.js` (which contains the 4 wrapper registrations); files listed in Appendix B.2.

**Fix.**
1. For each raw channel, record the intended auth class in a table in `main/ipc/raw-channel-policy.js` (or a documented map in `ipc-helpers.js`): `public` | `session` | `role:admin` | `role:...`.
2. Apply the smallest correct check: session-gate `system:printToPDF`, `system:printHTML`, `diagnostics:exportLog`, `diagnostics:revealLog`; admin-gate `updater:downloadUpdate`/`updater:installUpdate`; keep `reportRendererError`, `getRecent`, `getPublicStatus`, `activatePublic` (rate-limited) public and documented.
3. Add `tests/ipc-auth-matrix.test.js`: parses every registrar source, extracts channel names, and asserts a policy entry exists; fails on a new unclassified channel.

**Verification.** Matrix test green; manual smoke of print/updater/log-export paths.

**Depends on.** —
**Estimate.** 1 day.

---

## 4. Track B — Data and sync integrity

### B1 🔴 Never purge pending/failed outbox rows

**Problem.** Retention cleanup deletes outbox rows purely by age. A device offline longer than `retention_days` (default 7) silently loses every queued change; for `snapshot:false` entities (stage rules, cycle profiles) there is no re-enqueue path at all.

**Evidence.** `main/sync/capture.js:1102-1114`; scheduler `capture.js:1150,1155-1178`; startup `main/ipc/registerAll.js:78`; already noted in `docs/reviews/2026-08-08-import-system-audit.md` P2-28.

**Fix.**
```sql
DELETE FROM sync_outbox
WHERE status IN ('sent','superseded')
  AND created_at < datetime('now', '-' || ? || ' days')
```
Keep `pending`/`failed` until an explicit operator action; add an admin-only "purge stale failed rows" channel only if the UI needs it (otherwise leave `failed` for the retry/health reports). Consider a warning log when pending rows exceed the retention window.

**Verification.** New `tests/outbox-cleanup-retention.test.js`: a 10-day-old `pending` row survives; `sent`/`superseded` rows are removed; `failed` survives; idempotent re-run.

**Depends on.** —
**Estimate.** 1–2 h.

### B2 🟠 Cross-device stage-rule remap (`rule_set_id`)

**Problem.** Child rule tables use the local autoincrement `rule_set_id` as their remote document key (`main/sync/entity-registry.js:491-540`) and carry it in the payload (`main/repos/stage-rules.js:425-458`). On another device the parent `stage_rule_sets` row gets a different local id, so children either bind to the wrong local rule set (silent wrong coefficients) or hit an FK error and stall the pull cursor. `cycle_profile_assignments` is validated but never remapped (`main/sync/apply-hooks-stage-rules.js:104-155`).

**Evidence.** Registry keys/idFields for `subject_coefficients`, `exam_count_rules`, `subject_weight_rules`; `applyHooks: {}`; engine `PULL_SOFT_FOREIGN_KEYS` (`main/sync/engine/apply.js:20-33`); reproduction probe in review (parent local `id=3`, child `rule_set_id=2` applied to another year).

**Fix.**
1. Make the remote identity of child rows independent of local ids: include `school_year` + `revision` (or the parent's `row_sync_id`) in the payload/remote key. Bump `contractVersion` for the three entities and `minAppVersion` for the app.
2. Add an apply hook for the three child tables + `cycle_profile_assignments` that resolves the local `rule_set_id` from `(school_year, revision)` via `sync_id_map`/`stage_rule_sets`, before write.
3. Compatibility: old remote docs (no `school_year`/`revision`) are quarantined with a typed reason rather than guessed; a source device running the new version re-pushes correct rows. Never fall back to assigning a raw foreign id.
4. Keep the existing `checkCycleProfileConsistency` checks after remapping.
5. Add `tests/sync-stage-rules-cross-device.test.js`: seed two "devices" with diverged rule-set ids, apply a pulled revision, assert children bind to the correct revision per year; missing-parent → quarantine (not cursor-holding failure).

**Depends on.** —
**Estimate.** 1.5–2 days.

### B3 🟠 Upsert capture must return the real affected row

**Problem.** `getLastInsertId` falls back to `SELECT last_insert_rowid()`. For `INSERT … ON CONFLICT DO UPDATE` (update branch) and `INSERT OR IGNORE` conflicts, SQLite returns the *previous* insert's rowid, so capture writes the wrong row id (or none). Concrete channels: `examInvitations:upsert`, `examAttendance:upsert`, `absences:save`, `teachers:add` (inserts teacher, then aliases, so the captured rowid points at an alias).

**Evidence.** `main/sync/capture.js:998-1011, 834-839`; registry entries `capture.js:55,124,135,179`; repos `main/repos/exams.js:584-612, 646-664`, `main/repos/staff.js:545-590`, `main/repos/absences.js:52-117`; probe results in review (`teachers:add` captured `teachers:4` with `row_data: null`; `examInvitations:upsert` captured invitation #2 for an edit of #1).

**Fix.**
1. Repos return the real id (`RETURNING id` on the upsert) and handlers pass it through; capture by logical key inside the repo transaction (`captureInputUpserts` pattern already used by grades/absences bulk).
2. For `teachers:add`, capture `teacher_aliases` explicitly inside the same transaction (or declare the alias capture as part of the channel).
3. Extend registry metadata/tests so upsert channels must not rely on `lastInsertRowid`.
4. New `tests/sync-upsert-capture.test.js` covering insert, update, and no-op conflict branches per channel.

**Depends on.** —
**Estimate.** 1 day.

### B4 🟠 Remove unexpandable `_bulk` placeholders

**Problem.** `studentMovements:add` and `teachers:delete` are registered without `captureMode:'explicit'`, so the generic bulk extractor writes `{_bulk:true, channel, args_summary}`. `expand-bulk` rejects exactly that shape, producing permanent failed outbox rows and polluted push health. Snapshots eventually heal the data, but the capture path is broken.

**Evidence.** `main/sync/capture.js:172-196, 912-918, 1054-1077`; `main/sync/engine/expand-bulk.js:88-93`; repos `main/repos/student-movements.js:43-85`, `main/repos/staff.js:652-667`; probe output in review.

**Fix.**
1. Convert both channels to `captureMode:'explicit'` + `exclude:true`; write outbox rows inside the repo transaction (movement insert + `students` update; teacher delete + cascade).
2. Extend `tests/sync-bulk-channels-explicit.test.js` to fail for **any** registry entry whose `idExtractor` is in `BULK_EXTRACTORS` without explicit capture — not just `bulk:true` entries.
3. New tests: one movement and one teacher delete → exactly the expected outbox rows, no `_bulk`.

**Depends on.** —
**Estimate.** 1 day.

### B5 🟠 Don't mark an entity sent before its `syncLog` entry exists

**Problem.** In `applyItemOutcome`, `markEntrySent` runs immediately after the entity write; the syncLog batch is written later, best-effort. If the log write fails after retries, the entity is marked sent and other devices (which pull from `syncLog` only) never receive it. The expanded-bulk path already does this correctly.

**Evidence.** `main/sync/engine/push.js:323-337, 452-455` vs correct pattern `push.js:655-664`; `writeSyncLogWithRetry` gives up after 3 attempts (`main/sync/transport/firestore.js:247-263`).

**Fix.** Defer `markEntrySent` until the syncLog write succeeds in the sequential/concurrent path (or persist a `sent_pending_log` marker replayed on next cycle). Surface `last_push_error` so health reports show the backlog.

**Verification.** New `tests/sync-synclog-ordering.test.js`: forced syncLog failure → entity not marked `sent` and is re-sent next cycle; success → sent once.

**Depends on.** —
**Estimate.** 0.5–1 day.

### B6 🟡 Make `sync:resolveConflict` atomic

**Problem.** Four dependent writes (conflict status, `resolved_data`, ancestor data, outbox insert) run without a transaction. A crash can mark a conflict resolved while losing the local change or the ancestor update.

**Evidence.** `main/ipc/sync.js:368-417`.

**Fix.** Move to `main/repos/sync-conflicts.js` and wrap all four writes in `db.transaction(...)`. (sync.js is layering-exempt, but this aligns with the AGENTS.md direction and makes the transaction possible.)

**Verification.** `tests/sync-conflict-resolution-atomicity.test.js`: inject a failure on write #3 → all four rolled back; happy path unchanged.

**Depends on.** —
**Estimate.** 3–4 h.

### B7 🟡 Validate FK integrity on restore

**Problem.** Content restore disables foreign keys and never runs `PRAGMA foreign_key_check`; a partial backup can silently leave orphan rows after FK is re-enabled (parents not in `CONTENT_RESTORE_TABLES`).

**Evidence.** `main/ipc/system-backup.js:27-56, 467-541` (content), `260-398` (full-file: only `quick_check`).

**Fix.** Run `PRAGMA foreign_key_check` inside the restore transaction; on rows returned, roll back and return a typed `BACKUP_INTEGRITY_FAILED` with the offending tables. Run the same check after full-file restore.

**Verification.** `tests/backup-restore-integrity.test.js`: restore a fixture with an orphan child → refused, DB unchanged; valid fixture → accepted.

**Depends on.**
**Estimate.** 3–4 h.

### B8 🟡 Decide `page_visibility` policy (synced vs device-local)

**Problem.** `main/repos/page-visibility.js:5-7` and AGENTS.md say page visibility is device-local, but `capture.js:460` captures it and `entity-registry.js:465-476` registers it `snapshot:true` — so it syncs across devices, while `appDefaults:savePageAccess` is deliberately excluded.

**Evidence.** Above; AGENTS.md "App Defaults and Page Access" section.

**Fix (recommended: device-local, matching docs).** `exclude:true` in `capture.js`, remove the entity-registry entry (or `snapshot:false` + no capture), keep local writes; add a test asserting zero outbox rows for a visibility toggle. If the product wants it synced, do the inverse and update docs/AGENTS.md. **Decision required before coding** (Open Decision #2).

**Depends on.** Product decision.
**Estimate.** 2–3 h + decision.

---

## 5. Track C — Authorization and identity

### C1 🟠 Finish `handleRead` → `handleAuthedRead` migration

**Problem.** ~30 read channels have no session: student orientation (`main/ipc/orientation.js:284,293`), teachers (`staff.js:16,132`), teacher notes (`system-tags.js:8,12`), exams (`exams.js:85,102,106`), compensation, inspectors, `exam-config-data.js:23,36`, `pageVisibility.js:14`, `sync.js:107`, `appDefaults.js:220,241,338,403,429`, `diagnostics.js:46`, `app-admin.js:22`. `settings:get` has no key allowlist (`settings-ipc.js:6-9`) and can expose `app_auth_session`.

**Evidence.** Security deep-dive; `tests/read-contract-coverage.test.js` already pins some `handleAuthedRead` usage.

**Fix.**
1. Migrate the channels above to `handleAuthedRead` (`({db, session, cycleContext}, ...)` shape), one domain per commit: orientation → staff/system-tags → exams/exam-config → compensation/inspectors → appDefaults/pageVisibility/sync/diagnostics/app-admin → settings.
2. `settings:get`: switch to session-aware read + allowlist keys (the write side already has `ALLOWED_SETTINGS_KEYS` at `settings-ipc.js:11-19`); never serve `app_auth_session`.
3. Public allowlist stays: `institution:get-status`, `cycles:*` catalog reads, `auth:*`, `licensing:getPublicStatus`, `diagnostics:reportRendererError`.
4. Add/extend `tests/read-contract-coverage.test.js` to fail when a sensitive channel still uses `handleRead`; keep a documented public list.

**Small risk:** `js/shared/auth-session.js:218`, `js/utils.js:464,2710`, `app.js:289,344`, and two performance pages read settings post-login only (verified: login/setup do not include those scripts). Confirm each page's load order during the migration.

**Depends on.** —
**Estimate.** 2–4 days (domain-by-domain).

### C2 🟠 Per-domain write roles (or implement `SCOPED_ROLES`)

**Problem.** Most handlers use `WRITE_ROLES = ALLOWED_ROLES.filter(r => r !== 'viewer')`, so teacher/supervisor/admin-assistant can call destructive channels their page permissions never grant (`grades:deleteByYear`, `absences:deleteByYear`, `orientation:clearYear`, `teachers:add`/`importBulk`, inspectors, schoolOps). `SCOPED_ROLES` exists but is never used.

**Evidence.** `main/auth/permissions.js:144-147`; representative handlers listed in the review; grep shows `SCOPED_ROLES` only in `permissions.js` + tests.

**Fix.**
1. Define per-domain role maps in each IPC file (the `stageRules`/`appDefaults`/`cycleAccess`/`sync` pattern) for all destructive/import channels: grades, absences, orientation, staff, inspectors, schoolOps, exams.
2. Either implement section-scoped teacher restrictions via `SCOPED_ROLES` + `user_cycle_access`/assignments, or delete `SCOPED_ROLES` and the misleading comment; document the decision.
3. Add `tests/ipc-role-matrix.test.js`: role × destructive channel, asserting `FORBIDDEN` for every role not explicitly allowed.

**Depends on.** C1 (recommended, not strictly required).
**Estimate.** 1.5–2 days.

### C3 🟡 Enforce session TTL on live sessions

**Problem.** `SESSION_TTL_MS` (12 h) is checked only when restoring the persisted session; in-memory sessions never expire until logout/lock.

**Evidence.** `main/auth/session-policy.js:8-19`; `main/ipc/auth.js:201-207, 248-257`.

**Fix.** Store `expiresAt` on the in-memory session; check in `getSessionByEvent`/`requireAuth` (and `handleWriteSoftAuth`); sliding renewal on activity if desired. Emit the existing lock/logout event for expired sessions so pages react uniformly.

**Verification.** `tests/session-ttl.test.js` with an injectable clock: expired session → `UNAUTHENTICATED`; just-before-expiry → allowed; renewal updates the deadline.

**Depends on.** —
**Estimate.** 4–6 h.

### C4 🟠 Fix `institution:relink` auth logic

**Problem.** `handleWriteSoftAuth(..., [], ..., { allowNoSession: true })`: logged-out callers pass, logged-in non-admins get `FORBIDDEN`. No `setupCompleted` check (unlike `setup-new`). No renderer caller today.

**Evidence.** `main/ipc/institution.js:187-229`; `handleWriteSoftAuth` semantics `main/ipc/ipc-helpers.js:242-267`.

**Fix.** Either delete the channel (no caller), or set roles `['admin','principal']`, remove `allowNoSession`, and require an already-completed setup. Keep the bootstrap-secret gate server-side regardless.

**Verification.** Matrix test additions; manual call with/without session.

**Depends on.** —
**Estimate.** 2–3 h.

### C5 🟠 Single Firestore rules source of truth

**Problem.** Root `firestore.rules` (deployed by root `firebase.json:10-13`) lacks the migrated-school write gate and identity-request deny present in `firebase/firestore.rules`. Two files, two behaviors.

**Evidence.** `diff -u firestore.rules firebase/firestore.rules`; `firebase.json` vs `firebase/firebase.json`.

**Fix.**
1. Adopt `firebase/firestore.rules` as canonical; point root `firebase.json` at it and delete the root copy.
2. Keep the emulator config from `firebase/firebase.json` and add the `emulators` block to the root config (needed by E2 anyway).
3. Document the deploy command in `README.md` / `docs/`.
4. `tests/firebase-config-guard.test.js`: asserts one rules file referenced by all configs; asserts the migrated-school write gate string exists.

**Depends on.** —
**Estimate.** 2–3 h.

### C6 🟠 Fix `firebase-functions-client` response mapping

**Problem.** `PENDING_REQUEST_EXISTS` is missing from `KNOWN_RAW_CODES`, so `institution.js:417-422` is dead code and users get a generic error; `fail()` prefers the raw `data.error` code (English) over the friendly mapped message.

**Evidence.** `main/ipc/firebase-functions-client.js:35-55, 95-101`; server emits the code at `firebase/functions/index.js:206-208, 1091`; `institution.js:417-422`.

**Fix.** Add the server business codes (`PENDING_REQUEST_EXISTS`, `REQUEST_ALREADY_REVIEWED`, `REQUEST_NOT_FOUND`, `TARGET_SCHOOL_EXISTS`, `SCHOOL_MISMATCH`, `FORBIDDEN`) to `KNOWN_RAW_CODES`; prefer `data.message || ERROR_MESSAGES[code] || data.error`; keep unknown codes collapsing to `SERVER_UNAVAILABLE` (no leak). New `tests/firebase-functions-client.test.js`: pure `mapFailureCode` cases + `global.fetch` stubs for non-JSON body, 404 bootstrap vs other, known/unknown code, `AbortError`, empty URL, success.

**Depends on.**
**Estimate.** 3–4 h.

---

## 6. Track D — Renderer hardening

### D1 🟠 Escape sweep for the remaining unescaped pages

**Problem.** Eight page scripts (plus `app.js`) interpolate DB/import data into HTML with missing or incomplete escaping — seven have zero `escapeHtml` in the file, `exams-rooms.js` escapes only apostrophes, and `exams-schedule.js` escapes the same value elsewhere but not at the listed site (verified samples: `support-sessions.js:399-424`, `students-status.js:261-271`).

**Evidence / file list.**

| File | Sites | Tainted data |
|---|---|---|
| `js/pages/support-sessions.js` | 399-424 | teacher_name, subject, section, room |
| `js/pages/students-status.js` | 261-271 | code, full_name, section, status_notes |
| `js/pages/timetable-students.js` | 357-372, 433-434 | subject, room, group, teacher |
| `js/pages/timetable-rooms.js` | 356-393 | teacher, subject, students, sections |
| `js/pages/timetable.js` | 1765-1768 | subject, class, room (`buildActivityCellInner`) |
| `js/pages/absence-weekly.js` | 324, 340, 349-350 | subject (also in `title="…"`), full_name, class, level |
| `js/pages/exams-rooms.js` | 1263-1280, 1293 | name (apostrophe-only escape, inline handler) |
| `js/pages/exams-schedule.js` | 837 | level.name (same file escapes it elsewhere) |
| `app.js` | 1525-1526 | searchName/searchFamily (reflected) |

**Fix.**
1. Use the global `escapeHtml` (`js/shared/dom-helpers.js`) for text and attribute contexts; never interpolate data into inline `on*` handlers — use `data-*` + delegated `addEventListener` (pattern: `students-list.js:300-360`).
2. Convert the highest-risk tables (`students-status`, `support-sessions`) to `createElement`/`textContent` row building.
3. `tests/renderer-escape-guard.test.js`: static scan of the priority files for tainted `${...}` in HTML template lines without `escapeHtml`; baseline the current count and ratchet to zero per file as it is fixed.

**Depends on.** —
**Estimate.** 2–3 days.

### D2 🟡 One success-check helper for every awaited IPC write

**Problem.** Writes toast success / mutate local state without checking `{success:false}`. Verified: `settings-school.js:439-451` (principal silently fails on admin-only `settings:set`), `compensation-tracking.js:749-758, 212`, `exams-schedule.js:1120-1156, 1563-1568`, `exams-proctors.js:539-545, 163-168, 5434-5444`, `staff-daily-report.js:886-910`.

**Fix.** Promote an `assertIpcSuccess(res, fallbackMsg)` into `js/shared/` (models already exist: `ensureIpcSuccess` in `support-sessions.js:136`, `throwImportFailure` in `settings-imports.js`); apply to the sites above and make "check success before toast/state mutation" a checklist line in `docs/plans/2026-07-15-add-write-channel-checklist.md` (renderer section). Optional static guard: a lint rule is not practical; a code-review checklist item is.

**Verification.** Manual: simulate failure responses (temporarily stub `window.api`) and confirm error toast + no state mutation.

**Depends on.**
**Estimate.** 1 day.

### D3 🟡 Guard page async init

**Problem.** Sequential awaits with no `try/catch` abort initialization silently mid-page (`exams-proctors.js:57-90`, `exams-schedule.js:281-309`, `students-status.js:72-77`, `teachers-list.js:11-19`, `compensation-tracking.js:223-232`); `support-sessions.js:567-577` can produce unhandled rejections on filter clicks.

**Fix.** Wrap page init in `try { … } catch (err) { notifySyncError/renderErrorState(err) }`; give async event listeners terminal catches. Use `students-list.js:177-237` as the reference shape.

**Depends on.** —
**Estimate.** 1 day.

### D4 🟡 Stop duplicate listener registration on proctors load

**Problem.** `loadProctors()` calls `initProctorsPanel()` which attaches 7+ listeners to static buttons and calls `initProcDropZone()` (7+ more). `loadProctors()` runs again after proctor bulk import, stacking duplicate handlers (double saves).

**Evidence.** `js/pages/exams-proctors.js:5324-5355, 5453, 5459-5465`.

**Fix.** Move wiring to a one-time init, or guard with `dataset.wired` (pattern: `settings-school.js:538-539`).

**Depends on.** —
**Estimate.** 3–4 h.

### D5 🟢 De-duplicate shared helpers

**Problem.** 9 escape helpers re-implementations (`app-admin.js:3`, `reports-certificates.js:22`, `settings-defaults.js:22`, `settings-logs.js:19`, `settings-users.js:56`, `settings-license.js:5`, `settings-imports.js:4030`, `student-profile.js:3672`, `results-hub.js:1000`, `exams-proctors.js:2401`); byte-identical stats/date blocks in `teachers-performance.js:345-386` and `tracking-teachers-performance.js:327-368`; 5 pagination implementations; `gradeColor` with three value systems.

**Fix.** Consolidate into `js/shared/dom-helpers.js` / `js/shared/date-utils` once, delete locals, and add a review-checklist line. Prioritize the escape helpers (D1 already touches those files).

**Depends on.** D1 (same files).
**Estimate.** 1 day.

---

## 7. Track E — CI, tests, supply chain

### E1 🔴 CI cannot pass: Node 20 vs `node:sqlite`

**Problem.** Both workflows pin Node 20; six test files require `node:sqlite` at module scope. `npm test` is therefore red in CI (locally it passes on Node 26.7.0).

**Evidence.** `.github/workflows/ci.yml:18,51`, `.github/workflows/build-windows.yml:23`; files: `tests/institution-registration.test.js:9`, `tests/migration-077-cycle-reference-schema.test.js:8`, `tests/primary-stage-catalogs.test.js:30`, `tests/qualifiant-level-catalog.test.js:88`, `tests/stage-rules-migration.test.js:8`, `tests/teacher-teaching-assignments.test.js:4`.

**Fix.**
1. Bump `ci.yml` and `build-windows.yml` to `node-version: 24` (LTS; Node 20 is EOL since April 2026).
2. Migrate the inline `node:sqlite` shims to `tests/fixtures/open-db.js` (ABI-tolerant: better-sqlite3 → node:sqlite fallback) so tests run on more Node lines; keep at least one direct `node:sqlite` test to pin the driver.
3. Add `"engines": { "node": ">=22.5" }` to `package.json` for documentation.
4. Re-run the full suite on Node 24 locally (nvm/npx) before merging.

**Verification.** CI `quality` green on a PR; `npm test` green on Node 24.

**Depends on.** —
**Estimate.** 2–4 h (plus any suite fixes the version bump surfaces).

### E2 🟠 Wire in orphaned tests and the Firebase emulator job

**Problem.** 26 test files under `tests/` never execute (9 `integration`, 4 `orientation`, 13 marker-skipped), plus 29 under `tools/`; the emulator CI job can never pass because no emulator is started (`firebase.json` has no `emulators` block, `firebase-tools` is not a dependency).

**Evidence.** `tests/run-all.js:81,83,112-132`; `.github/workflows/ci.yml:36-63`; `tests/RISK_REGISTER_COVERAGE.md` claims coverage from `tests/integration`.

**Fix.**
1. Add explicit plan groups for `tests/orientation` and `tests/integration` in `tests/run-all.js` (they currently pass: 4/4, 9/9 when run manually).
2. Replace the 1000-char `@pre-fix` magic skip with an explicit allowlist file (`tests/skipped-by-design.json`) or move those files to `tests/archive/`; ensure `proctor-v2-singleton-class-bounds-exploration` (marker at line 68) stays intentionally included.
3. Firebase job: add `firebase-tools` devDependency + `emulators` block (see C5), start emulators in the job, run `tests/integration/*` + `integration-firebase.js`, then flip `continue-on-error` to false.
4. Add `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` and `timeout-minutes: 30`.

**Depends on.** C5 (for the emulators block), E1.
**Estimate.** 1 day.

### E3 🟠 Dependency advisories

**Problem.** `xlsx@0.18.5` has prototype pollution + ReDoS with **no fix on npm** (SheetJS moved distribution to their CDN); `websocket-driver@0.7.4` (critical) comes via `firebase` → `faye-websocket`; `electron@35.7.5` has multiple high advisories (worker/nodeIntegration scoping, permission-handler origin). Full `npm audit`: 3 critical / 19 high / 3 moderate.

**Evidence.** `npm audit` output; `node_modules/xlsx` version; `npm ls websocket-driver electron`.

**Fix.**
1. **xlsx:** pin SheetJS ≥ 0.20.x from the official tarball (`https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz`) — add a project note because the npm registry version is stale. Re-run import-center xlsx fixtures.
2. **electron:** plan the upgrade 35 → current stable (test with `npm test` + `test:e2e` + a packaging dry run). Keep it as its own PR; do not bundle with P0 fixes.
3. **firebase/websocket-driver:** track upstream; if `firebase` exposes an override path, pin `websocket-driver` via `overrides` after smoke-testing auth/database.
4. Record triage in `docs/security/dependency-advisories.md` (audit date, versions, decision, owner).

**Depends on.** —
**Estimate.** 1–3 days (xlsx 0.5 day; Electron upgrade separate).

### E4 🟡 Test runner timeout

**Problem.** `spawnSync` has no timeout; one hung test blocks CI until the 6-hour default.

**Evidence.** `tests/run-all.js:147-151`.

**Fix.** Pass `timeout` (default 120 s, `RUN_ALL_TIMEOUT_MS` env override), report timed-out files as failures; add `timeout-minutes` to jobs (E2).

**Depends on.** —
**Estimate.** 2 h.

### E5 🟡 Windows test coverage

**Problem.** The product ships NSIS (`package.json:88-92`) but tests run only on `ubuntu-latest`; `build-windows.yml` runs no tests/lint.

**Fix.** Add a `windows-latest` job with `npm ci && npm run lint && npm test` (Node 24), and/or add lint+test steps to `build-windows.yml` before packaging.

**Depends on.** E1.
**Estimate.** 3–4 h + CI tuning.

---

## 8. Track F — Repo and build hygiene

### F1 🟡 Add `.gitattributes`, stop the CRLF churn

**Problem.** The working tree shows 368 modified files caused by line endings (index mixed LF/CRLF); no `.gitattributes`. A careless `git add -A` would destroy diffs/blame.

**Evidence.** `git diff --stat --ignore-cr-at-eol` (11 real files); `file` on worktree files = CRLF; `git show :file` mixed; no `.gitattributes`.

**Fix.**
1. Add `.gitattributes`: `* text=auto`, `*.js text eol=lf`, `*.html text eol=lf`, `*.css text eol=lf`, `*.md text eol=lf`, `*.yml text eol=lf`, binary declarations for `*.png`, `*.pdf`, `*.xlsx`, `*.ttf`, `*.woff2`.
2. `git add --renormalize .` in a **dedicated commit** that touches nothing else; then commit the 11 real files separately.
3. Update the repo's contributing note (README or AGENTS.md manual section) to never commit mixed endings.

**Verification.** `git status` clean after renormalize; `git diff` shows no CR-only changes.

**Depends on.** F4 sequencing (do F4 first so the cleanup commit doesn't include untracked artifacts).
**Estimate.** 1–2 h.

### F2 🟡 Fix `.gitignore` patterns and untrack ignored junk

**Problem.** `~$*                       # Office lock files …` uses an unsupported inline comment (the whole line becomes the pattern); `"نتائج/"` and `"**/نتائج/"` use literal quotes (never match). `.tmp.driveupload/` is now ignored but **502 files remain tracked** (ignore rules don't untrack); `.tmp.drivedownload/` is already untracked.

**Evidence.** Scratch `git check-ignore` reproduction (both patterns fail); `git ls-files .tmp.driveupload | wc -l` → 502; `git ls-files .tmp.drivedownload | wc -l` → 0.

**Fix.**
1. Move the comment to its own line; remove quotes from Arabic paths (`نتائج/`).
2. `git rm -r --cached .tmp.driveupload` (keep files on disk), then commit the deletion.
3. Verify: `git check-ignore -v '~$x.xlsx' 'نتائج/y'`.
4. Consider `git gc`/history note: the drive-upload junk stays in history; removing it from HEAD is enough for day-to-day hygiene (no history rewrite without owner approval).

**Depends on.** —
**Estimate.** 2–3 h.

### F3 🟡 Owner-telemetry server defaults

**Problem.** Predictable default token (`change-me-write-token`), binds all interfaces, read token accepted on write endpoints, non-constant-time comparisons, CORS `*`.

**Evidence.** `server/index.js:6-7, 90-107, 252-314`.

**Fix.** Refuse to start with a missing/default token; require distinct read/write tokens; bind `127.0.0.1` unless `OWNER_HOST` is set; `crypto.timingSafeEqual`; restrict CORS to configured origins or keep `*` only with a documented threat model. Update `server/README.md`.

**Depends on.** —
**Estimate.** 3–4 h.

### F4 🟢 Working-tree commit hygiene (do before F1)

**Problem.** The working tree mixes 11 real changes with ~360 CRLF-only edits and untracked files.

**Fix.** Commit only the real changes as focused commits:
1. `main/ipc/firebase-functions-client.js` + `institution.js`/`app-admin.js` refactor (+ C6 tests).
2. `main/db/schema.js` `massar_code`/`school_id` columns + fixture fixes.
3. `tests/appdefaults-*`, `tests/cycles-repo-ipc`, `tests/e2e/stage-pages`, `eslint.config.mjs`, `package.json`, `.github/workflows/ci.yml` (CI part folds into E1).
4. Leave `tests/institution-registration.test.js` until E1/A1 touch it.
5. Keep `docs/plans/2026-08-26-exams-module-isolation-plan.md` and this plan as docs commits.

**Depends on.** —
**Estimate.** 1–2 h.

---

## 9. Cross-cutting verification & definition of done

### 9.1 Per-PR gates

| Gate | Command | Pass condition |
|---|---|---|
| Lint | `npm run lint` | 0 errors (warnings ≤ baseline 75) |
| Unit/integration | `npm test` | all files pass |
| Fairness (CI-only suite) | `npm run test:fairness` | 40/40 |
| Layering | `tests/ipc-layering-guard.test.js` (inside `npm test`) | no new inline SQL outside exemptions |
| Write-channel checklist | `tests/smoke.js` (inside `npm test`) | registry ↔ channels complete |
| Sync contract | `tests/sync-multi-cycle-contracts.test.js` + new sync tests | contractVersion/minAppVersion consistent |
| Audit delta | `npm audit` | no new high/critical in direct prod deps |

### 9.2 Definition of done per track

- **A (security):** no unauthenticated admin/password path exists; no public URL serves app data; backup/restore has a role+session matrix test; `ipc-auth-matrix` enforces classification for every raw channel.
- **B (data/sync):** pending outbox rows survive cleanup (tested); cross-device stage rules bind by logical identity (tested); upserts capture the real row (tested); no `_bulk` placeholder can be captured by a non-explicit channel (guard extended); sent-marking is ordered after syncLog (tested).
- **C (auth):** sensitive reads require a session; per-domain write roles tested; live TTL enforced; one Firestore rules file; raw Firebase codes mapped and unit-tested.
- **D (renderer):** `tests/renderer-escape-guard.test.js` green for the priority files; no write reports success on failure in the listed sites; page init cannot silently abort.
- **E (CI):** `quality` green on Node 24; all discovered tests run; emulator job blocking; audit triaged.
- **F (hygiene):** `.gitattributes` + clean `git status`; broken ignore patterns fixed; tracked junk untracked.

### 9.3 Release/rollback notes

- None of the Wave-0/1 fixes require a DB migration; they are independently revertible.
- **B2 is a sync contract change.** Set `minAppVersion` accordingly; old clients keep the old keys, new clients quarantine unknown shapes instead of guessing; release only after B2 tests + a two-device manual pass.
- **C1/C2** are behavior changes on the renderer side only if a page relied on pre-login reads (none found; re-verify per domain).
- **A2** is destructive by design (removing public files); coordinate with the school before taking the site down.

---

## 10. Open decisions (needed before the associated task)

| # | Decision | Needed by | Recommendation |
|---|---|---|---|
| 1 | `users:resetAdminPassword`: delete vs gated support flow | A1 | **Delete** (no caller; safest). |
| 2 | `page_visibility`: device-local vs synced | B8 | **Device-local** (matches docs/AGENTS.md); remove sync entry. |
| 3 | Firebase Hosting: disable entirely vs dedicated empty `hosting/` dir | A2 | Disable unless there is a product reason; otherwise dedicated allowlisted dir. |
| 4 | Backup role audience: principal allowed (page audience) vs admin-only | A3 | Backup `admin+principal`, restore `admin` + confirm. |
| 5 | Electron upgrade timing (E3) | Week 1 triage | Separate PR after Wave 1; do not block P0s. |
| 6 | Licensing: keep hard-disabled or re-enable with a redesigned offline key | Backlog | Keep disabled; remove misleading UI until re-enabled (separate plan). |

---

## 11. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hosting purge breaks a link someone depends on | Low | Medium | Keep offline copies; check referrers/logs before disabling; communicate first. |
| C1 migration breaks a pre-login page | Low | High | Public allowlist + per-domain smoke of login/setup; keep `handleAuthedRead` fallback impossible-by-design. |
| B2 makes old clients stall | Medium | High | `minAppVersion` gate + quarantine unknown shapes; two-device staging test before release. |
| Node 24 bump surfaces test failures hidden on Node 26 | Medium | Medium | Run E1 on a branch first; fix per-file where driver-specific. |
| xlsx tarball install breaks CI reproducibility | Medium | Medium | Vendor the tarball or pin the exact CDN URL + integrity in `package-lock`; test import fixtures. |
| CRLF renormalize collides with in-flight work | Medium | Low | Freeze merges for the cleanup commit; announce in the repo channel. |
| `ipc-auth-matrix` creates a large allowlist that rots | Medium | Low | Keep the policy map in one file with a mandatory review comment; guard test fails on additions. |

---

## 12. Estimate summary

| Wave | Contains | Engineering |
|---|---|---|
| 0 | A1, A2, A3, B1, E1 | ~1.5–2 days |
| 1 | A4, C4, C5, C6, B3, B4, E3(xlsx), E4 | ~3.5–4.5 days |
| 2 | B2, B5, B6, B7, C1, C2, C3, D1 | ~9–13 days |
| 3 | D2–D5, E2, E5, F1–F4, B8 | ~6–8 days |
| **Total** | | **~20–27 engineering days** (parallelizable across 2 devs → ~2–3 calendar weeks for Waves 0–2) |

---

## Appendix A — Findings → tasks map

| Review finding (severity) | Task |
|---|---|
| `users:resetAdminPassword` unauthenticated 🔴 | A1 |
| Public hosting serves student PII 🔴 | A2 |
| Backup/restore without session 🔴 | A3 |
| 50 raw handlers without a policy 🟠 | A4 |
| Outbox cleanup deletes pending 🔴 | B1 |
| Stage-rule `rule_set_id` not remapped 🟠 | B2 |
| Upsert capture wrong row 🟠 | B3 |
| Unexpandable `_bulk` placeholders 🟠 | B4 |
| Sent before syncLog 🟠 | B5 |
| `resolveConflict` not atomic 🟡 | B6 |
| Restore no FK check 🟡 | B7 |
| `page_visibility` contradictory 🟡 | B8 |
| Unauthenticated PII reads / `settings:get` 🟠 | C1 |
| Coarse write roles / `SCOPED_ROLES` 🟠 | C2 |
| Session TTL not enforced 🟡 | C3 |
| `institution:relink` inverted auth 🟠 | C4 |
| Firestore rules drift 🟠 | C5 |
| Firebase client code mapping 🟡 | C6 |
| Stored XSS in 7+ pages 🟠 | D1 |
| Silent write failures 🟡 | D2 |
| Unguarded async init 🟡 | D3 |
| Duplicate proctor listeners 🟡 | D4 |
| Helper duplication 🟢 | D5 |
| CI Node 20 vs `node:sqlite` 🔴 | E1 |
| 26 orphan tests + dead emulator job 🟠 | E2 |
| xlsx/electron/websocket-driver advisories 🟠 | E3 |
| Runner has no timeout 🟡 | E4 |
| No Windows test coverage 🟡 | E5 |
| CRLF churn / no `.gitattributes` 🟡 | F1 |
| Broken ignore patterns + 502 tracked junk files 🟡 | F2 |
| Telemetry server defaults 🟡 | F3 |
| Working-tree commit hygiene 🟢 | F4 |

## Appendix B — Affected files index

**B.1 P0/P1 primary files:** `main/ipc/system.js`, `main/ipc/system-backup.js`, `main/ipc/institution.js`, `main/ipc/firebase-functions-client.js`, `main/ipc/ipc-helpers.js`, `main/ipc/registerAll.js`, `main/repos/users.js`, `main/repos/stage-rules.js`, `main/sync/capture.js`, `main/sync/entity-registry.js`, `main/sync/apply-hooks-stage-rules.js`, `main/sync/engine/{apply,push,expand-bulk}.js`, `firebase.json`, `firestore.rules`, `firebase/firestore.rules`, `.github/workflows/ci.yml`, `.github/workflows/build-windows.yml`.

**B.2 Raw `ipcMain.handle` files (A4 audit):** `main/ipc/auth.js`, `licensing.js`, `diagnostics.js`, `ownerTelemetry.js`, `system-backup.js`, `system-print.js`, `updater.js`, `reports.js`, `sync.js`, `registerAll.js` (verify).

**B.3 Renderer XSS files (D1):** `js/pages/{support-sessions,students-status,timetable-students,timetable-rooms,timetable,absence-weekly,exams-rooms,exams-schedule}.js`, `app.js`.

**B.4 Page files for D2–D3:** `js/pages/{settings-school,compensation-tracking,exams-schedule,exams-proctors,staff-daily-report,teachers-list}.js`.

**B.5 Hygiene:** `.gitignore`, `.gitattributes` (new), `.tmp.driveupload/**` (untrack), `server/index.js`, `package.json`, `package-lock.json`.

---

*This plan was generated from the 2026-09-10 codebase review. Update the Status row and append an execution log per task as work lands.*
