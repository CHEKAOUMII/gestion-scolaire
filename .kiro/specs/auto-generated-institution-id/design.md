# Design Document

## Overview

This design implements the hybrid tenant-identity model described in
`requirements.md`: an opaque, server-generated `schoolId` (surrogate key) decoupled from a
freely-editable, descriptive `massarCode`. It covers the Cloud Functions layer
(`firebase/functions/index.js`), the Electron IPC layer (`main/ipc/institution.js`), local
SQLite schema (`main/db/schema.js`, `main/db/migrations.js`), the sync engine's read of the
tenant key (`main/sync/engine.js`, `main/sync/snapshot.js`), and the Setup_Client UI
(`setup.html`, `js/pages/setup.js`).

The current implementation is the inverse of the target: `bootstrapInstitution` accepts a
client-supplied `schoolId` (defaulted to the Massar code) and does a single existence check;
`institution:setup-new` actively **rejects** any case where the server's returned `schoolId`
differs from the entered Massar code (`MASSAR_MISMATCH`); `institution:relink` never queries
Firestore; and `institution_config` has no real `massar_code` column (writes to it are
wrapped in a silent `try/catch`). This design replaces those code paths while preserving
exact backward compatibility for institutions already provisioned under the old model.

## Goals / Non-Goals

**Goals:** implement Requirements 1–10 exactly as written; keep legacy institutions working
unmodified; keep the rollout safe before/after `firebase deploy`.

**Non-goals:** migrating already-provisioned institutions to opaque ids (Req 7 explicitly
keeps them on their existing `schoolId`); enforcing uniqueness of `massarCode` across
institutions (Req 6.4 explicitly anticipates and handles ambiguous matches, so duplicates are
allowed to exist); UI redesign beyond the Massar-code field and confirmation messaging.

## Data Model Changes

### Firestore: `schools/{schoolId}`

Add a `massarCode` field (string, may be empty), distinct from `schoolId`/`gresaCode`:

```jsonc
// schools/{schoolId}
{
  "schoolId": "k3F9q...",        // opaque, unchanged after creation
  "gresaCode": "k3F9q...",       // legacy alias, kept equal to schoolId (existing code reads it)
  "massarCode": "12345A",        // NEW — descriptive, editable, may be ""
  "institutionName": "...",
  "status": "active",
  "createdAt": ..., "updatedAt": ...
}
```

A single-field index on `massarCode` is auto-created by Firestore (simple equality query,
no composite index needed) and is used by the new relink-lookup function.

### SQLite: `institution_config`

Add a real migration (not a `try/catch` write) for a `massar_code` column:

```js
// main/db/migrations.js — new migration, e.g. '2026-07-050-massar-code-column'
ensureColumn('institution_config', 'massar_code', 'TEXT');
// Backfill: legacy rows have no massar_code yet, so Req 7.5's display fallback
// (massar_code -> code_etablissement -> sync_config.school_id) handles them without
// a data backfill being necessary. No UPDATE statement required.
```

`code_etablissement` is kept as-is (legacy alias, still mirrors the technical id for any
code that still reads it) — it is **not** repurposed as the descriptive field. `massar_code`
is the new, single source of truth for the descriptive value going forward.

### SQLite: `sync_config`

No schema change. `sync_config.school_id` remains the column holding the technical tenant
key / sync key (Req 4.5, Req 7.1–7.3). This preserves every existing reader of
`sync_config.school_id` without modification.

## Cloud Function Design

### `bootstrapInstitution` rewrite (Req 1, 2)

```js
// Uppercase-only + digits: several existing code paths (main/ipc/institution.js's
// normalizeMassarCode, main/firebase/config.js's readSchoolId) call .toUpperCase() on any
// identifier they read. If the generated id could contain lowercase characters, those call
// sites would silently mutate it before use, breaking exact-value comparisons against
// Firestore doc IDs and auth custom claims. Restricting the alphabet to uppercase avoids
// touching every normalization call site.
const SCHOOL_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateSchoolIdCandidate() {
    const length = 20 + crypto.randomInt(11); // 20..30 inclusive
    let out = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        out += SCHOOL_ID_ALPHABET[bytes[i] % SCHOOL_ID_ALPHABET.length];
    }
    return out;
}

async function generateUniqueSchoolId() {
    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const candidate = generateSchoolIdCandidate();
        const snap = await db.doc(`schools/${candidate}`).get();
        if (!snap.exists) return candidate;
    }
    const err = new Error('SCHOOL_ID_GENERATION_FAILED');
    err.status = 500;
    throw err;
}
```

**Write ordering and rollback.** Required fields (`institutionName`, `adminEmail`,
`adminPassword`, `adminName`) are validated before any Firestore/Auth write, unchanged from
today. The generated id is then *reserved* first — a transaction re-checks
`schools/{candidate}` and writes a minimal placeholder (`{ schoolId, status: 'provisioning',
createdAt }`) — before the Auth user is created, because the id no longer depends on any
value derived from the admin user. The admin Auth user is created next via
`createOrUpdateSchoolUser`, using the reserved `schoolId` for its profile path
(`schools/{schoolId}/users/{uid}`) and for the custom claim (`auth.setCustomUserClaims(uid, {
schoolId, role: 'principal' })`) and custom token (`auth.createCustomToken(uid, { schoolId,
role: 'principal' })`) exactly as today. Finally the placeholder document (and its
`meta/institution` doc) is updated in place with the full institution data
(`institutionName`, `massarCode`, `adminUid`, `adminEmail`, `status: 'active'`). If Auth user
creation or the finalize write fails after the id was reserved, the function best-effort
deletes the placeholder `schools/{schoolId}` document in a `catch` block before returning
`INTERNAL_ERROR`, so the (extremely unlikely) collision slot is not left permanently
occupied by an incomplete record.

Request handling changes:

- The request body's `schoolId`/`gresaCode` fields are **ignored entirely** for id purposes
  (Req 1.2). Only `massarCode` is read, and it is now optional (Req 5.5): empty/whitespace
  is normalized to `""` and passes validation (no `SCHOOL_ID_REGEX` check applied to it —
  that regex now only governs the descriptive `massarCode` when non-empty, mirrored from the
  client-side rule in Req 5.3).
- `schoolId` is produced via `generateUniqueSchoolId()`.
- The existence-check-and-create sequence is wrapped in a single Firestore transaction
  (`db.runTransaction`) so the final `get` + `set` of the winning candidate is atomic,
  satisfying Req 2.5 ("create the institution document ... so the School_Id cannot be
  claimed by a concurrent request"). The prior per-candidate existence checks (attempts 1..4)
  remain outside the transaction (cheap reads to pick a likely-free candidate); only the
  final chosen candidate's existence re-check + create happens transactionally, with a retry
  of the whole `generateUniqueSchoolId` flow (bounded by the same 5-attempt budget) if the
  transaction detects a last-instant collision.
- Response shape gains `massarCode`:

```jsonc
{
  "success": true,
  "schoolId": "k3F9q...",   // server-generated, authoritative
  "massarCode": "12345A",   // echoed back, may be ""
  "customToken": "...", "uid": "...", "firebaseConfig": {...},
  "profile": {...}, "institution": {...}
}
```

- Missing required fields (`institutionName`, `adminEmail`, `adminPassword`, `adminName`)
  still reject with `INVALID_REQUEST` / 400 before any write (Req 1.6) — unchanged behavior,
  just no longer includes `schoolId`/Massar pattern in that required set.
- On exhausting 5 attempts: return `SCHOOL_ID_GENERATION_FAILED` / 500, no document created
  (Req 2.3).

### New Cloud Function: `lookupInstitutionBySchoolMassarCode` (Req 6)

Needed because the Electron client has no Firestore query access before it holds
per-school auth (relink happens pre-auth). Mirrors `bootstrapInstitution`'s
`requireBootstrapAuthorization` gate (shared `GESTION_BOOTSTRAP_SECRET`, sent by the caller
as `bootstrapSecret` in the request body — see the IPC snippet below) to avoid turning this
into a public institution-enumeration endpoint.

Legacy institutions (Req 7) predate the `massarCode` field and never had one written to
Firestore — their `schoolId`/`gresaCode` *is* their old Massar code. So the lookup falls back
to a direct document read by that literal value (Req 6.8) when the `massarCode` field query
finds nothing:

```js
const MASSAR_CODE_REGEX = /^[A-Z0-9]+$/; // renamed from SCHOOL_ID_REGEX and relaxed: the
// Massar_Code is now treated as ordinary descriptive institution information (like the
// institution name), so it is no longer forced into the old digits-then-letters shape
// (`^\d+[A-Za-z]{1,2}$`). The only remaining constraint is its character set — uppercase
// letters and digits — checked here and enforced client-side by the same-named constant in
// main/ipc/institution.js (rename INSTITUTION_CODE_REGEX's value there to match). Length
// (max 20 chars) is validated separately wherever this constant is used.

exports.lookupInstitutionBySchoolMassarCode = onRequest({ cors: true, secrets: ['GESTION_BOOTSTRAP_SECRET'] }, async (req, res) => {
    if (!requirePost(req, res)) return;
    try {
        requireBootstrapAuthorization(req);
        const massarCode = normalizeSchoolId(req.body?.massarCode); // trims + uppercases
        if (!massarCode || !MASSAR_CODE_REGEX.test(massarCode)) {
            const err = new Error('INVALID_MASSAR');
            err.status = 400;
            throw err;
        }

        const snap = await db.collection('schools').where('massarCode', '==', massarCode).limit(2).get();
        if (snap.size === 1) {
            const doc = snap.docs[0];
            return res.status(200).json({ success: true, schoolId: doc.id, institutionName: doc.get('institutionName') || '' });
        }
        if (snap.size > 1) {
            const err = new Error('MASSAR_AMBIGUOUS');
            err.status = 409;
            throw err;
        }

        // No institution has massarCode == value — fall back to legacy direct-id lookup
        // (Req 6.8): pre-refactor institutions have schoolId === their old Massar code.
        const legacySnap = await db.doc(`schools/${massarCode}`).get();
        if (legacySnap.exists) {
            return res.status(200).json({ success: true, schoolId: legacySnap.id, institutionName: legacySnap.get('institutionName') || '' });
        }

        const err = new Error('MASSAR_NOT_FOUND');
        err.status = 404;
        throw err;
    } catch (err) {
        return functionError(res, err);
    }
});
```

`functionError`'s status map needs two additions: `MASSAR_NOT_FOUND` → 404,
`MASSAR_AMBIGUOUS` → 409.

### New Cloud Function: `updateInstitutionMassarCode` (Req 8)

Principal-authenticated (reuses `requirePrincipalAuth`), updates `massarCode` — never
`schoolId` itself. Bootstrap writes `massarCode` to **both** `schools/{schoolId}` and
`schools/{schoolId}/meta/institution` (mirroring the existing dual-write pattern already used
for `institutionName` in the approval function), so this update must keep both copies in sync
to avoid stale data in `meta/institution`:

```js
exports.updateInstitutionMassarCode = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;
    try {
        const { idToken, massarCode: rawMassarCode } = req.body || {};
        const caller = await requirePrincipalAuth(idToken);
        const massarCode = normalizeSchoolId(rawMassarCode);
        if (!massarCode) {
            const err = new Error('INVALID_MASSAR'); err.status = 400; throw err;
        }
        if (massarCode.length > 20 || !MASSAR_CODE_REGEX.test(massarCode)) {
            const err = new Error('INVALID_MASSAR'); err.status = 400; throw err;
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        const batch = db.batch();
        batch.update(db.doc(`schools/${caller.schoolId}`), { massarCode, updatedAt: now });
        const metaRef = db.doc(`schools/${caller.schoolId}/meta/institution`);
        const metaSnap = await metaRef.get();
        if (metaSnap.exists) {
            batch.update(metaRef, { massarCode, updatedAt: now });
        }
        await batch.commit();
        return res.status(200).json({ success: true, massarCode });
    } catch (err) {
        return functionError(res, err);
    }
});
```

This is a direct field update with **no approval workflow** (Req 8.7, Req 9.1/9.3) and never
touches `schoolId`, auth claims, or the sync key (Req 8.2).

### Narrowing `submitInstitutionIdentityChangeRequest` (Req 9.2, 9.4)

Remove the `newSchoolId`/code-change branch entirely: reject with `SCHOOL_ID_IMMUTABLE` if
the request body includes `newSchoolId` (or the legacy `codeChanged` intent), and drop the
migration branch inside `reviewInstitutionIdentityChangeRequest`/approval (the
`copyCollectionTree` re-keying logic, custom-claim rewrite loop, and `schools/{old}` →
`migrated` status flip). The mechanism becomes name-only:

```js
if (rawNewSchoolId) {
    const err = new Error('SCHOOL_ID_IMMUTABLE');
    err.status = 400;
    throw err;
}
```

**Existing pending requests created before this feature shipped** may already have
`codeChanged: true` (submitted under the old workflow, awaiting app-admin approval). The
approval/apply function must check this flag on the *stored request document itself*, not
just on new submissions: if `requestSnap.get('codeChanged')` is `true`, reject the
approval/apply call with `SCHOOL_ID_IMMUTABLE` and perform no migration, rather than silently
honoring a pre-existing request that predates the immutability rule (Req 9.6).

Existing `institutionIdentityRequests` documents are left untouched (Req 9.5) —
`getInstitutionIdentityChangeRequestsForSchool` / `listInstitutionIdentityChangeRequests`
keep reading/returning them unchanged, including historical `codeChanged`/`resultSchoolId`
fields on old records, for audit/read purposes only.

### Firestore rules (Req 3)

No rule change is required for immutability: `schools/{schoolId}` already has
`allow create, update, delete: if false;` — all writes happen server-side via the Admin SDK
in Cloud Functions, which bypasses Security Rules entirely. Client apps (including the
Electron app's Firebase client SDK, if any is used beyond custom-token auth) can never write
`schoolId` directly today. This satisfies Req 3.3/3.4 structurally; the design only needs to
ensure the Cloud Functions themselves never accept a client-supplied `schoolId` for mutation
(handled above — no function other than `bootstrapInstitution`'s internal generator ever sets
the `schoolId` field of a `schools/{id}` document, and `bootstrapInstitution` only sets it once
at creation).

## IPC Layer Design (`main/ipc/institution.js`)

### `institution:setup-new` changes (Req 4, 5, 10)

1. Drop the required-Massar validation; accept empty Massar (Req 5.5):
   ```js
   const massarCode = normalizeMassarCode(payload?.massarCode); // may be ''
   if (massarCode && !isValidMassarCode(massarCode)) {
       return fail('INVALID_MASSAR');
   }
   ```
2. Stop sending `schoolId`/`gresaCode: massarCode` to the Cloud Function — only send
   `massarCode` (Req 1.2 mirrored client-side so the server-ignored fields aren't even sent):
   ```js
   const bootstrapResult = await postFirebaseFunction(functionsUrl, 'bootstrapInstitution', {
       massarCode, institutionName, adminName, adminEmail, adminPassword,
       role: 'principal', bootstrapSecret: ..., device: deviceContext
   });
   ```
3. Add a 30-second timeout to `postFirebaseFunction` (Req 10.2) via `AbortController`:
   ```js
   const controller = new AbortController();
   const timer = setTimeout(() => controller.abort(), 30_000);
   try {
       const response = await fetch(url, { ..., signal: controller.signal });
       ...
   } catch (err) {
       if (err.name === 'AbortError') return fail('BOOTSTRAP_TIMEOUT', 'انتهت مهلة الاتصال بالخادم');
       return fail('SERVER_UNAVAILABLE', ...);
   } finally {
       clearTimeout(timer);
   }
   ```
4. Replace the `MASSAR_MISMATCH` rejection with length/presence validation of the
   **returned** `schoolId` (Req 10.3/10.4), and stop comparing it to the entered Massar code:
   ```js
   if (!bootstrap.schoolId || bootstrap.schoolId.length < 1 || bootstrap.schoolId.length > 64) {
       return fail('INVALID_BOOTSTRAP_RESPONSE', 'استجابة الخادم لا تحتوي على معرّف مؤسسة صالح');
   }
   ```
5. Persist both fields distinctly (Req 4.4): `institution_config.code_etablissement` and
   `sync_config.school_id` continue to receive `bootstrap.schoolId` (technical id, unchanged
   plumbing); `institution_config.massar_code` receives the entered `massarCode` (may be
   `null`/empty) via the new column from the migration above — added to the same
   `db.transaction()` so there is no partial-write path (Req 4.7).
6. `normalizeBootstrapResponse` must stop deriving `schoolId` from
   `payload.massarCode`/`institution.massarCode` as a candidate value — only
   `payload.schoolId` (falling back to `institution.schoolId`) is treated as the School_Id;
   `payload.massarCode` is read into a separate `massarCode` field on the normalized result.
7. Success response includes an explicit flag so the Setup_Client can show the Req 4.6
   confirmation message without extra logic:
   ```js
   return ok({
       ...,
       schoolId: bootstrap.schoolId,
       massarCodeDiffersFromSchoolId: !!massarCode && massarCode !== bootstrap.schoolId,
       massarCode
   });
   ```

### `institution:relink` changes (Req 6)

Replace the local-only write with an actual lookup via the new Cloud Function:

```js
handleWriteSoftAuth(ipcMain, 'institution:relink', [], async (db, payload) => {
    const massarCode = normalizeMassarCode(payload?.massarCode);
    if (!massarCode) return fail('INVALID_MASSAR', 'رمز المؤسسة مطلوب'); // Req 6.6
    if (!isValidMassarCode(massarCode)) return fail('INVALID_MASSAR'); // Req 6.7

    const functionsUrl = getFirebaseFunctionsUrl(db);
    if (!functionsUrl) return fail('SERVER_UNAVAILABLE');

    const lookup = await postFirebaseFunction(functionsUrl, 'lookupInstitutionBySchoolMassarCode', {
        massarCode,
        // MUST be sent explicitly — postFirebaseFunction only forwards the body given to it,
        // it does not attach this secret automatically the way bootstrapInstitution's caller does.
        bootstrapSecret: process.env.GESTION_BOOTSTRAP_SECRET || ''
    });
    if (!lookup.success) {
        if (lookup.code === 'MASSAR_NOT_FOUND') return fail('MASSAR_NOT_FOUND', 'لم يتم العثور على مؤسسة بهذا الرمز'); // Req 6.3
        if (lookup.code === 'MASSAR_AMBIGUOUS') return fail('MASSAR_AMBIGUOUS', 'يوجد أكثر من مؤسسة بنفس الرمز'); // Req 6.4
        return lookup;
    }

    const resolvedSchoolId = String(lookup.data.schoolId || '').trim();
    // ... write resolvedSchoolId to sync_config.school_id and massarCode to institution_config.massar_code
    // in a single db.transaction(), leaving prior values untouched if any step throws (Req 6.2, 6.5)
});
```

`mapFailureCode` gains `MASSAR_NOT_FOUND` and `MASSAR_AMBIGUOUS` passthrough entries so they
aren't collapsed into the generic `SERVER_UNAVAILABLE` bucket.

### New handler: `institution:updateMassarCode` (Req 8)

```js
handleWrite(ipcMain, 'institution:updateMassarCode', ['principal'], async (db, event, payload) => {
    const status = getInstitutionStatusRecord(db);
    if (!status.setupCompleted) return fail('SETUP_REQUIRED');

    const massarCode = normalizeMassarCode(payload?.massarCode);
    if (!massarCode) return fail('INVALID_MASSAR', 'رمز المؤسسة مطلوب'); // Req 8.4
    if (massarCode.length > 20 || !isValidMassarCode(massarCode)) return fail('INVALID_MASSAR'); // Req 8.3

    const functionsUrl = getFirebaseFunctionsUrl(db);
    if (!functionsUrl) return fail('SERVER_UNAVAILABLE');
    const idToken = await getCurrentFirebaseIdToken(true).catch(() => null);
    if (!idToken) return fail('UNAUTHENTICATED');

    const result = await postFirebaseFunction(functionsUrl, 'updateInstitutionMassarCode', { idToken, massarCode });
    if (!result.success) return fail('INTERNAL_ERROR', 'فشل تحديث رمز المؤسسة'); // Req 8.6

    // The Cloud Function has already confirmed the remote write; it is authoritative from
    // this point on (Req 8.8). Retry the local cache write once before surfacing a
    // remote-succeeded-but-local-stale warning — retrying the same UPDATE is safe/idempotent.
    const persistLocally = () =>
        db.prepare('UPDATE institution_config SET massar_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(massarCode);
    try {
        persistLocally();
    } catch {
        try {
            persistLocally();
        } catch (retryErr) {
            return ok({
                massarCode,
                localCacheStale: true,
                message: 'تم تحديث رمز المؤسسة على الخادم، لكن تعذر تحديث النسخة المحلية. أعد المحاولة.',
                warning: retryErr.message
            });
        }
    }
    return ok({ massarCode, message: 'تم تحديث رمز المؤسسة بنجاح' }); // Req 8.5
});
```

Exposed in `preload.js` as `window.api.institution.updateMassarCode(payload)`.

### `institution:submitIdentityChangeRequest` narrowing (Req 9.1, 9.3, 9.4)

Strip the `codeEtablissement`/`newSchoolId` input path entirely — the handler only accepts
`institutionName`. If a caller supplies a code-change field, return
`fail('SCHOOL_ID_IMMUTABLE', 'لا يمكن تعديل رمز المؤسسة عبر آلية الموافقة؛ استخدم تعديل رمز ماسار المباشر')`.
`institution:applyApprovedIdentityChange` correspondingly drops the `codeChanged` branch
(no more `sync_config.school_id` rewrite, no `clearCredentials()`/sync-restart-on-code-change
path) — it only ever applies `newInstitutionName`.

### Principal Settings UI: direct Massar edit lives on the institution-information page (Req 8, 3, 5)

Two identifiers are shown to users, and they must not be conflated:

- **Massar_Code** — enterable at signup (Setup_Client) and, afterward, viewable/editable on
  the institution-information page, `settings-school.html`. This is the *only* identifier a
  user ever sees.
- **School_Id** — never entered, never displayed, anywhere (Req 3.3).

`settings-school.html` already has the right home for this: **Section 0 ("هوية المؤسسة
المرتبطة بالمزامنة")**, currently a `hidden`-by-default, disabled read-only display of
`status.massarCode` (populated in `js/pages/settings-school.js`'s `loadSyncInstitutionSection()`
from `institution:get-status`) with a link "طلب تعديل هوية المؤسسة" that sends the principal to
`settings-users.html`'s approval-workflow panel. That link is exactly the old
approval-required workflow Req 8 replaces. Changes needed:

- In `settings-school.html`, change `#sync-inst-code` from `disabled` to a normal editable
  input (keep `#sync-inst-name` disabled — institution name changes still go through the
  Req 9 approval mechanism), and replace the `#sync-inst-link-wrap` "طلب تعديل هوية المؤسسة"
  link with a "حفظ" (save) button.
- In `js/pages/settings-school.js`, wire that save button to
  `window.api.institution.updateMassarCode({ massarCode: value })` directly, showing the
  result via `showToast`/`setFieldValidation` — no request/approval step (Req 8.7). On
  success, update the in-memory `status.massarCode` so a subsequent save reflects the new
  value without a full page reload.
- Do **not** touch the general "رمز المؤسسة" field in Section 2 (`#id-school-code`, part of
  the local, unrelated `school_identity`/letterhead form) — that field is a separate,
  print-only concern (the code shown on official documents) and is out of scope for this
  feature.

### `settings-users.html` Identity Change panel stays name-only (Req 9.1, 9.3)

The existing "Identity Change Requests" panel currently also lets a principal submit a **new
code** alongside a new institution name, wired to `submitIdentityChangeRequest({
codeEtablissement, institutionName })`. Since Massar edits now happen directly on
`settings-school.html` (above), this panel is simplified to name-only:

- Remove the "الرمز الجديد (اختياري)" (`#ic-new-code`) input and its associated help text.
- Update the panel's help copy (`settings-users.html` line ~211, "يمكنك طلب تصحيح رمز المؤسسة
  أو اسمها...") to describe a name-only request, so principals are not led to believe code
  changes still require central approval.
- In `js/pages/settings-users.js`'s `submitIdentityChangeRequest()`, stop reading
  `#ic-new-code` / sending `codeEtablissement` in the payload.

### Closing the `settings-sync.html` School_Id exposure (Req 3.3, 3.5)

A real, pre-existing violation of the immutability/invisibility rule: the admin-only "إعدادات
المزامنة" form on `settings-sync.html` has a **required, freely-editable** text input,
`#cfg-school-id` (label "معرف المؤسسة"), directly bound to `sync_config.school_id`:
`js/pages/settings-sync.js` populates it from `config.schoolId` on load and reads
`document.getElementById('cfg-school-id')?.value?.trim()` on submit, sending it through to
`sync:saveConfig`. An admin can currently type an arbitrary value into this field and
overwrite the tenant key directly — exactly what Req 3.4 prohibits, and exactly the kind of
raw-id exposure Req 3.3/3.5 now explicitly forbid. Additionally, `testConnection()`'s success
message interpolates `result.schoolId` directly into the UI (`` `الاتصال ناجح — معرف المؤسسة:
${result.schoolId}` ``), a second exposure point.

Fixes:

- In `settings-sync.html`, remove the `#cfg-school-id` input (and its label) from the
  editable sync-configuration form entirely — it is not a value an admin should ever set or
  see.
- In `js/pages/settings-sync.js`, stop populating and reading `#cfg-school-id`; stop sending
  `schoolId` in the payload passed to `sync:saveConfig` (or, if the IPC layer requires the
  field, send the currently-stored value straight from the loaded config rather than from a
  user-editable input, so the form can never change it).
- In `sync:saveConfig` (`main/ipc/sync.js`), ignore/drop any `schoolId` present in the
  incoming payload rather than trusting it — `sync_config.school_id` may only ever be
  written by `institution:setup-new` and `institution:relink`.
- Change the `testConnection()` success message to a generic "الاتصال ناجح" without
  interpolating `result.schoolId`.

### `getInstitutionStatusRecord` display-fallback update (Req 7.5)

```js
const massarCode =
    normalizeMassarCode(institutionRow?.massar_code) ||       // NEW: preferred, explicit descriptive value
    normalizeMassarCode(institutionRow?.code_etablissement) || // legacy alias / display fallback
    normalizeMassarCode(syncRow?.school_id);                   // last-resort fallback
```

## Sync Engine Fallback (Req 7.6, 7.7)

Introduce one small helper reused at every gate point in `main/sync/engine.js` and
`main/sync/snapshot.js` (currently 7 call sites read `config.school_id` directly):

```js
// main/sync/credentials.js (or a small new shared module)
function resolveSyncSchoolId(config, credentials) {
    const primary = String(credentials?.schoolId || config?.school_id || '').trim();
    if (primary) return primary;
    const fallback = String(config?.massar_code || '').trim(); // legacy alternative key
    return fallback || null;
}
```

Each of the 7 call sites (`engine.js` lines ~965, ~1034, ~1372/1378, ~1396, ~1567/1572,
`snapshot.js` lines ~98, ~146) is updated from `config.school_id` truthiness checks to
`resolveSyncSchoolId(config, credentials)`, aborting sync with an explicit
`school_id_unavailable` error only when **both** are empty (Req 7.7). This requires
`sync_config`'s query in these modules to also select `massar_code` — since that column
lives on `institution_config`, not `sync_config`, the read helper joins/looks up
`institution_config.massar_code` alongside `sync_config.school_id` when building the
`config` object passed into these functions (small addition to whatever loader currently
does `SELECT * FROM sync_config WHERE id = 1`).

## Setup_Client UI (`setup.html`, `js/pages/setup.js`)

- [setup.html](../../../setup.html#L66): remove `required` and the `<span class="req">*</span>`
  marker on the Massar field; replace with an "اختياري" (optional) badge (Req 5.1).
- [setup.js](../../../js/pages/setup.js#L172): change the submit-blocking check to only run
  format validation **when non-empty**:
  ```js
  const trimmed = massarCode.trim();
  if (trimmed && (!isValidMassarCode(trimmed) || trimmed.length > 20)) {
      showFieldError('new-massar-error', '...');
      hasError = true; // only blocks on invalid non-empty input (Req 5.4)
  }
  ```
- After a successful `setupNew` call, if the response's `massarCodeDiffersFromSchoolId` is
  true, show a non-blocking informational toast/message (Req 4.6): "تم إعداد المؤسسة بمعرّف
  فريد؛ يمكنك متابعة استخدام رمز ماسار كما أدخلته للعرض والبحث" — the user is not asked to
  change anything.

## Error Code Catalog (new/changed)

| Code | Origin | Meaning |
|---|---|---|
| `SCHOOL_ID_GENERATION_FAILED` | Cloud Function | All 5 generation attempts collided (Req 2.3) |
| `INVALID_BOOTSTRAP_RESPONSE` | IPC | Returned `schoolId` missing/empty/>64 chars (Req 10.4) |
| `BOOTSTRAP_TIMEOUT` | IPC | Cloud Function call exceeded 30s (Req 10.2) |
| `MASSAR_NOT_FOUND` | Cloud Function + IPC | Relink lookup found no match (Req 6.3) |
| `MASSAR_AMBIGUOUS` | Cloud Function + IPC | Relink lookup found >1 match (Req 6.4) |
| `SCHOOL_ID_IMMUTABLE` | Cloud Function + IPC | Identity-change request attempted to alter `schoolId`/Massar via the approval mechanism (Req 9.4) |
| `MASSAR_MISMATCH` | *(removed)* | No longer returned by `institution:setup-new` |

## Migration / Rollout Sequencing (Req 10.5)

1. Ship the DB migration (`massar_code` column) and client-side changes first — they are
   backward compatible: `institution:setup-new` still works against the **old**, undeployed
   `bootstrapInstitution` (which still echoes back `schoolId === massarCode`), because the
   new code no longer requires a mismatch and simply accepts whatever is returned.
2. Deploy the new Cloud Functions (`bootstrapInstitution` rewrite,
   `lookupInstitutionBySchoolMassarCode`, `updateInstitutionMassarCode`, narrowed identity
   functions) via `firebase deploy --only functions`.
3. Until step 2 happens, every already-configured institution keeps operating on its existing
   `sync_config.school_id` untouched (Req 7.1–7.3, 10.5) — nothing in this design reads or
   rewrites that value for existing rows.
4. **Empty-Massar setup before deploy.** The old, undeployed `bootstrapInstitution` still
   requires a non-empty `schoolId`/`massarCode` matching the legacy pattern — it will reject an
   empty Massar code with `INVALID_REQUEST`/400 even though the updated client now allows
   submitting one. This is expected and acceptable (Req 10.6): the client simply surfaces that
   rejection as a normal validation error (no crash, no indefinite retry). Institutions that
   need an empty Massar code must wait until step 2 completes; institutions supplying a
   non-empty, pattern-valid Massar code can complete setup successfully both before and after
   deploy.

## Requirements Traceability

| Requirement | Design element |
|---|---|
| 1, 2 | `bootstrapInstitution` rewrite: generator + transactional collision-check-and-retry loop |
| 3, incl. 3.3, 3.5 | Firestore rules (`allow create, update, delete: if false`) + no function ever accepts a client `schoolId` for mutation + removal of the `settings-sync.html` `#cfg-school-id` exposure and the `testConnection()` message leak |
| 4 | `institution:setup-new`: drop `schoolId` from outbound payload, accept any returned id, write `massar_code` separately, transactional writes |
| 5 | `setup.html`/`setup.js` optional-field UX; `bootstrapInstitution` no longer requires Massar |
| 6, incl. 6.8 | New `lookupInstitutionBySchoolMassarCode` function (with legacy direct-id fallback) + rewritten `institution:relink`, explicit `bootstrapSecret` on the lookup call |
| 7 | No change to legacy rows; `resolveSyncSchoolId()` fallback chain; `getInstitutionStatusRecord` display fallback |
| 8, incl. 8.8 | New `updateInstitutionMassarCode` function (dual-write `schools/{id}` + `meta/institution`) + `institution:updateMassarCode` IPC handler with retry-once/local-cache-stale handling + Principal Settings UI update |
| 9, incl. 9.6 | Narrowed `submitInstitutionIdentityChangeRequest`/approval (name-only), rejection of code-change attempts on both new and pre-existing pending requests, untouched historical records, Principal Settings UI no longer offers code changes |
| 10, incl. 10.6 | 30s `AbortController` timeout, returned-id length validation, uppercase-only id alphabet (avoids case-normalization mutation), deploy-order independence with documented pre-deploy empty-Massar behavior |
