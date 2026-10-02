# Implementation Plan

Tasks are ordered to match the rollout sequencing in `design.md` (client/local changes are
backward-compatible and safe to ship before the Cloud Function deploy; Cloud Functions ship
last). Each task references the requirement(s) it satisfies.

- [x] 1. Add the `institution_config.massar_code` migration
  - Add a new versioned migration in `main/db/migrations.js` (e.g.
    `2026-07-050-massar-code-column`) that calls `ensureColumn('institution_config',
    'massar_code', 'TEXT')`.
  - No backfill `UPDATE` needed — legacy rows rely on the display-fallback chain (Task 5).
  - _Requirements: 4.4, 7.5_

- [x] 2. Fix `getInstitutionStatusRecord` display fallback
  - In `main/ipc/institution.js`, change the `massarCode` derivation to prefer
    `institutionRow.massar_code`, then fall back to `institutionRow.code_etablissement`,
    then `syncRow.school_id`.
  - Remove the current try/catch-based dual-query fallback for `code_etablissement` vs
    `massar_code` now that the column is guaranteed to exist via migration.
  - _Requirements: 7.5_

- [x] 3. Add request-timeout handling to `postFirebaseFunction`
  - In `main/ipc/institution.js`, wrap the `fetch` call with an `AbortController` and a
    30-second timer; on abort, return `fail('BOOTSTRAP_TIMEOUT', ...)`.
  - Add `BOOTSTRAP_TIMEOUT` to `ERROR_MESSAGES` and to `mapFailureCode`.
  - _Requirements: 10.2_

- [x] 4. Update `institution:setup-new` to stop requiring/blocking on Massar code
  - In `main/ipc/institution.js`, rename `INSTITUTION_CODE_REGEX` and relax its value from
    `/^\d+[A-Za-z]{1,2}$/` to `/^[A-Z0-9]+$/` — the Massar code is now treated as ordinary
    descriptive institution information (like the institution name), so it is no longer
    forced into the old digits-then-letters shape; the only remaining constraint is its
    character set (uppercase letters and digits) plus the existing 20-character max length.
  - Change the Massar validation so an empty/whitespace value is allowed to proceed; only run
    `isValidMassarCode` when the trimmed value is non-empty.
  - Stop sending `schoolId`/`gresaCode: massarCode` in the `bootstrapInstitution` request
    body — send only `massarCode` (may be `''`).
  - _Requirements: 5.3, 5.5, 1.2_

- [x] 5. Replace the `MASSAR_MISMATCH` rejection with returned-id validation
  - In `main/ipc/institution.js`, delete the
    `if (!bootstrap.schoolId || bootstrap.schoolId !== massarCode) return fail('MASSAR_MISMATCH')`
    check.
  - Replace it with: reject via `fail('INVALID_BOOTSTRAP_RESPONSE', ...)` only when
    `bootstrap.schoolId` is missing, empty, or longer than 64 characters.
  - Remove `MASSAR_MISMATCH` from `ERROR_MESSAGES`/`mapFailureCode` (or keep the message but
    stop emitting the code) once no code path returns it.
  - _Requirements: 3.2, 4.2, 4.3, 10.3, 10.4_

- [x] 6. Persist Massar code as a separate field during setup
  - In the `institution:setup-new` transaction in `main/ipc/institution.js`, add a write of
    the entered `massarCode` (trimmed, may be empty) to `institution_config.massar_code`,
    alongside the existing `code_etablissement`/`sync_config.school_id` writes — same
    `db.transaction()` so there is no partial-write path on failure.
  - Update `normalizeBootstrapResponse` so `schoolId` is derived only from
    `payload.schoolId`/`institution.schoolId` (never from `payload.massarCode`), and add a
    separate `massarCode` field to its return value read from `payload.massarCode`.
  - Add `massarCodeDiffersFromSchoolId` and `massarCode` to the success response of
    `institution:setup-new`.
  - _Requirements: 4.1, 4.4, 4.6, 4.7_

- [x] 7. Implement real Massar-code lookup in `institution:relink`
  - In `main/ipc/institution.js`, replace the current local-only write with: validate
    non-empty + pattern (return `fail('INVALID_MASSAR')` for empty/whitespace per 6.6, and for
    non-matching pattern per 6.7), then call the new `lookupInstitutionBySchoolMassarCode`
    Cloud Function via `postFirebaseFunction`.
  - **The call MUST explicitly include `bootstrapSecret: process.env.GESTION_BOOTSTRAP_SECRET
    || ''` in the request body** — `postFirebaseFunction` only forwards whatever body it is
    given, it does not attach this secret automatically the way `institution:setup-new` does
    for `bootstrapInstitution`. Omitting it will make every relink attempt fail authorization
    once the function is deployed.
  - Map the function's `MASSAR_NOT_FOUND` / `MASSAR_AMBIGUOUS` codes through
    `mapFailureCode` (add passthrough entries) into IPC failures that leave
    `sync_config.school_id` unchanged (Req 6.3, 6.4).
  - On a single match, write the returned `schoolId` (not the entered Massar code) to
    `sync_config.school_id`, and the entered Massar code to `institution_config.massar_code`,
    in one transaction.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 8. Add the `institution:updateMassarCode` IPC handler
  - In `main/ipc/institution.js`, add a new `handleWrite(..., ['principal'], ...)` handler
    that validates the submitted Massar code (non-empty, ≤20 chars, pattern match), calls a
    new `updateInstitutionMassarCode` Cloud Function with the caller's id token, and on
    success updates `institution_config.massar_code` locally.
  - Return validation failures for empty (Req 8.4) and invalid-format/too-long (Req 8.3)
    values without calling the Cloud Function.
  - Return an error (not a partial update) if the Cloud Function call fails (Req 8.6).
  - **If the Cloud Function call succeeds but the local `institution_config.massar_code`
    write throws**, retry the local write once (it is a plain idempotent `UPDATE`); if the
    retry also fails, return a success response flagged `localCacheStale: true` rather than a
    generic error — the remote value is authoritative and already changed, so a generic error
    would be misleading (Req 8.8).
  - Expose it in `preload.js` as `window.api.institution.updateMassarCode(payload)`.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [x] 9. Narrow `institution:submitIdentityChangeRequest` to name-only
  - In `main/ipc/institution.js`, remove the `codeEtablissement`/`newSchoolId` input handling
    and the associated `codeChanged` branch (including the `sync_outbox`/`sync_conflicts`
    pending-check gating that only existed for code changes).
  - If the caller supplies a code-change field, return
    `fail('SCHOOL_ID_IMMUTABLE', ...)` without contacting the Cloud Function.
  - _Requirements: 9.1, 9.3, 9.4_

- [x] 10. Narrow `institution:applyApprovedIdentityChange` to name-only
  - In `main/ipc/institution.js`, remove the `codeChanged`/`newSchoolId` branch from the
    local-DB transaction (no more `sync_config.school_id` rewrite, no `clearCredentials()` /
    sync-restart calls triggered by a code change) — only the `institutionName` update
    remains.
  - _Requirements: 9.2_

- [x] 11. Add the sync-key fallback helper and wire it into the sync engine
  - Add a small `resolveSyncSchoolId(config, credentials)` helper (new export from
    `main/sync/credentials.js` or an existing shared sync module) implementing:
    `credentials.schoolId || config.school_id || config.massar_code || null`.
  - Update the ~7 call sites in `main/sync/engine.js` and `main/sync/snapshot.js` that
    currently gate on `config.school_id` truthiness to use `resolveSyncSchoolId(...)`
    instead, aborting only when both `school_id` and `massar_code` are empty/missing.
  - Ensure wherever `config` is loaded in these modules, `institution_config.massar_code` is
    selected alongside `sync_config.school_id` so the fallback has data to read.
  - _Requirements: 7.6, 7.7_

- [x] 12. Update the Setup_Client UI to make Massar code optional
  - In `setup.html`, remove the `required` attribute and the `<span class="req">*</span>`
    marker on the Massar-code field; add an "اختياري" (optional) indicator.
  - In `js/pages/setup.js`, change the submit validation so it only runs the pattern/length
    check when the trimmed value is non-empty, and blocks submission only on an invalid
    non-empty value (not on an empty one). Enforce the 20-character max length.
  - On a successful `setupNew` response with `massarCodeDiffersFromSchoolId: true`, show a
    non-blocking informational message; do not prompt the user to change anything.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6_

- [x] 13. Make the institution-information page the home for direct Massar edits, and keep
      the identity-change panel name-only
  - In `settings-school.html`'s existing "هوية المؤسسة المرتبطة بالمزامنة" section (Section 0),
    change `#sync-inst-code` from `disabled` to a normal editable input (leave `#sync-inst-name`
    disabled — name changes still go through the Req 9 approval mechanism), and replace the
    `#sync-inst-link-wrap` "طلب تعديل هوية المؤسسة" link with a "حفظ" (save) button.
  - In `js/pages/settings-school.js`, wire that save button to
    `window.api.institution.updateMassarCode({ massarCode })` directly, showing the result via
    `showToast`/`setFieldValidation` — no request/approval step. Update the in-memory
    `status.massarCode` on success.
  - Do **not** touch the separate "رمز المؤسسة" field in Section 2 (`#id-school-code`) — that
    is an unrelated, local, print-only letterhead field and is out of scope.
  - In `settings-users.html`, remove the "الرمز الجديد (اختياري)" (`#ic-new-code`) input and
    its help text from the "Identity Change Requests" panel — that panel becomes name-only.
    Update its help copy so it no longer implies code changes require central approval.
  - In `js/pages/settings-users.js`'s `submitIdentityChangeRequest()`, stop reading
    `#ic-new-code` / sending `codeEtablissement` in the payload; update the requests-history
    table rendering if it currently displays `newSchoolId` as an editable/requestable column.
  - _Requirements: 3.3, 8.1, 8.7, 9.1, 9.3_

- [x] 13a. Remove the raw School_Id exposure from `settings-sync.html`
  - In `settings-sync.html`, remove the `#cfg-school-id` input and its label from the
    admin-only "إعدادات المزامنة" form entirely — an admin must never be able to view or type
    an arbitrary value into the raw tenant key.
  - In `js/pages/settings-sync.js`, stop populating (`setVal('cfg-school-id', ...)`) and
    reading (`document.getElementById('cfg-school-id')?.value`) that field; stop including a
    user-editable `schoolId` in the payload sent to `sync:saveConfig`.
  - In `main/ipc/sync.js`'s `sync:saveConfig` handler, ignore/drop any `schoolId` present in
    the incoming payload — `sync_config.school_id` may only ever be written by
    `institution:setup-new` and `institution:relink`.
  - Change the `testConnection()` success message in `js/pages/settings-sync.js` (currently
    interpolates `` `الاتصال ناجح — معرف المؤسسة: ${result.schoolId}` ``) to a generic
    "الاتصال ناجح" without exposing the raw id.
  - _Requirements: 3.3, 3.5_

- [x] 14. Rewrite `bootstrapInstitution` in `firebase/functions/index.js`
  - Add `generateSchoolIdCandidate()` using an **uppercase-letters-and-digits-only** alphabet
    (`ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789` — no lowercase) and 20–30 random characters via
    `crypto.randomBytes`. Avoiding lowercase prevents existing `.toUpperCase()` normalization
    call sites (`main/ipc/institution.js`'s `normalizeMassarCode`, `main/firebase/config.js`'s
    `readSchoolId`) from silently mutating the generated id before it's stored/compared.
  - Add `generateUniqueSchoolId()` (up to 5 total attempts: the initial candidate counts as
    attempt 1, at most 4 retries after a collision).
  - Ignore any client-supplied `schoolId`/`gresaCode` for id-generation purposes; only read
    `massarCode` from the request body, and make it optional (no pattern check when empty;
    when non-empty, validate against the existing pattern).
  - **Ordering:** reserve the generated id first — a transaction re-checks
    `schools/{candidate}` and writes a minimal placeholder (`{ schoolId, status:
    'provisioning', createdAt }`) — before creating the admin Auth user, since the id no
    longer depends on any value derived from that user. Create the Auth user next (using the
    reserved `schoolId` for the custom claim/custom token, unchanged from today). Then
    finalize the placeholder document (and its `meta/institution` doc) with the full
    institution data (`institutionName`, `massarCode`, `adminUid`, `adminEmail`, `status:
    'active'`).
  - **Rollback:** if Auth user creation or the finalize write fails after the id was
    reserved, best-effort delete the placeholder `schools/{schoolId}` document in a `catch`
    block before returning `INTERNAL_ERROR`.
  - On exhausting 5 generation attempts, respond with `SCHOOL_ID_GENERATION_FAILED` (500) and
    create nothing.
  - Response body includes `schoolId` (server-generated) and `massarCode` (echoed).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 15. Add `lookupInstitutionBySchoolMassarCode` Cloud Function
  - New `onRequest` function in `firebase/functions/index.js`, gated by
    `requireBootstrapAuthorization` (same shared secret as bootstrap, since relink happens
    pre-auth).
  - Rename the existing `SCHOOL_ID_REGEX` constant to `MASSAR_CODE_REGEX` and relax its value
    from `/^\d+[A-Za-z]{1,2}$/` to `/^[A-Z0-9]+$/` — the Massar code is now ordinary
    descriptive institution information (like the institution name), validated only by
    character set (uppercase letters and digits) plus a separate 20-character max length, not
    the old digits-then-letters shape. Update every usage site (`firebase/functions/index.js`
    lines ~188, ~457, ~881) to the renamed constant; the old schoolId-validation usage in
    bootstrap and the newSchoolId-validation usage in the identity-change function are being
    replaced by Tasks 14 and 17 respectively.
  - Validate the submitted `massarCode` (non-empty, matches `MASSAR_CODE_REGEX`); query
    `schools` where `massarCode == <value>` limited to 2 results.
  - **Legacy fallback:** if that query returns zero matches, fall back to a direct document
    read at `schools/{massarCode}` — pre-refactor institutions have `schoolId` (and
    `gresaCode`) literally equal to their old Massar code and were never given a `massarCode`
    field, so this is the only way relink can resolve them (Req 6.8).
  - Return `MASSAR_NOT_FOUND` (404) only if both the field query and the legacy direct lookup
    find nothing, `MASSAR_AMBIGUOUS` (409) for more than one field-query match, or
    `{ success: true, schoolId, institutionName }` otherwise.
  - Add `MASSAR_NOT_FOUND` → 404 and `MASSAR_AMBIGUOUS` → 409 to `functionError`'s status map.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.8_

- [x] 16. Add `updateInstitutionMassarCode` Cloud Function
  - New `onRequest` function, authenticated via `requirePrincipalAuth`.
  - Validate the submitted `massarCode` (non-empty, ≤20 chars, matches `MASSAR_CODE_REGEX`).
  - **Update both** the `massarCode` field on `schools/{caller.schoolId}` **and**, if it
    exists, `schools/{caller.schoolId}/meta/institution` in the same batch — bootstrap (Task
    14) writes `massarCode` to both documents, so updating only one would leave
    `meta/institution` stale. Never write `schoolId` itself.
  - Return a success confirmation with the updated `massarCode` on success, an error
    otherwise, without partial writes.
  - _Requirements: 8.1, 8.2, 8.5, 8.6_

- [x] 17. Narrow `submitInstitutionIdentityChangeRequest` / approval to name-only
  - In `firebase/functions/index.js`, reject any request body containing `newSchoolId` with
    `SCHOOL_ID_IMMUTABLE` (400) before any Firestore read/write.
  - Remove the code-migration branch from the approval function (the `copyCollectionTree`
    re-keying of `schools/{old}` → `schools/{new}`, the `syncLog` copy, the custom-claims
    rewrite loop, and the `schools/{old}` → `status: 'migrated'` update) — only the
    `institutionName` update path remains.
  - **Existing pending requests**: before approving/applying any request, check the stored
    request document's own `codeChanged` field (not just the incoming payload) — if
    `codeChanged === true` (submitted under the old workflow, pre-dating this feature), reject
    with `SCHOOL_ID_IMMUTABLE` and perform no migration.
  - Do not delete or modify any existing `institutionIdentityRequests` documents; keep
    `getInstitutionIdentityChangeRequestsForSchool` / `listInstitutionIdentityChangeRequests`
    reading historical records unchanged.
  - _Requirements: 9.2, 9.4, 9.5, 9.6_

- [ ] 18. Manual verification pass before `firebase deploy`
  - Run the app against the **undeployed** (old) Cloud Functions and confirm
    `institution:setup-new` still completes successfully now that `MASSAR_MISMATCH` no longer
    blocks a matching id (old function still echoes `schoolId === massarCode`).
  - Confirm that submitting an **empty** Massar code against the undeployed (old) Cloud
    Function surfaces a plain validation error from the server (the old function still
    requires a non-empty, pattern-matching value) without crashing, hanging, or retrying
    indefinitely — this is expected pre-deploy behavior (Req 10.6), not a regression.
  - Confirm an existing legacy `institution_config`/`sync_config` row (pre-migration) still
    reports `setupCompleted: true` and displays its Massar code correctly via
    `institution:get-status`.
  - Confirm sync continues to run for a legacy row with `sync_config.school_id` populated and
    `massar_code` empty.
  - Confirm `settings-sync.html`'s configuration form no longer displays or lets an admin
    submit a raw `schoolId` value, and that `settings-school.html`'s institution-information
    section shows only the Massar_Code (never the raw `schoolId`).
  - _Requirements: 3.3, 3.5, 7.1, 7.2, 7.3, 7.4, 10.5, 10.6_

- [ ] 19. Deploy and verify post-deploy behavior
  - Run `firebase deploy --only functions` from `firebase/`.
  - Run a fresh `institution:setup-new` with an empty Massar code and confirm a 20–30
    character opaque, uppercase-alphanumeric `schoolId` is generated and stored, with no
    Massar code required.
  - Run a fresh `institution:setup-new` with a non-empty Massar code and confirm the stored
    `schoolId` differs from the Massar code, the confirmation message is shown, and both
    values are stored distinctly.
  - Run `institution:relink` against the newly created institution's Massar code from a
    second device profile and confirm it resolves to the correct `schoolId`.
  - Run `institution:relink` against a **pre-existing legacy institution's old code** (its
    `schoolId`) and confirm the legacy direct-id fallback in
    `lookupInstitutionBySchoolMassarCode` resolves it correctly.
  - Run `institution:updateMassarCode` and confirm the Massar code changes on both
    `schools/{id}` and `schools/{id}/meta/institution` while `sync_config.school_id` stays
    constant.
  - Confirm `settings-users.html`'s identity-change panel no longer offers a code-change
    field, and that `settings-school.html`'s direct Massar-edit control works without an
    approval step and never displays the raw `schoolId`.
  - _Requirements: 1.1–1.6, 2.1–2.5, 3.3, 3.5, 4.1–4.7, 5.1–5.6, 6.1–6.8, 8.1–8.8, 9.1–9.6, 10.1–10.6_
