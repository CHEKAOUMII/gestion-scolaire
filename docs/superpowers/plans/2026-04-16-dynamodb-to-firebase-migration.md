# DynamoDB → Firebase Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AWS DynamoDB + Cognito cloud sync layer with Firebase Firestore + Firebase Auth custom tokens, keeping the local-first SQLite architecture intact.

**Architecture:** SQLite remains the primary data store. Firestore is the new cloud sync target. Firebase Auth custom tokens (minted by a Cloud Function) replace Cognito temporary credentials.

**Tech Stack:** Firebase JS SDK v11 (client), firebase-admin v13 (Cloud Functions), Firestore, Firebase Auth, better-sqlite3 (unchanged)

**Firebase Project:** `gestionscholaire`
**Service Account Key:** `firebase/gestionscholaire-firebase-adminsdk-fbsvc-d818682f4a.json`
**Firebase Client Config:**
```js
{
  apiKey: "AIzaSyCdhGx_UNgo3Ynx2__7xYNHThN68U0Hnak",
  authDomain: "gestionscholaire.firebaseapp.com",
  projectId: "gestionscholaire",
  storageBucket: "gestionscholaire.firebasestorage.app",
  messagingSenderId: "862487537433",
  appId: "1:862487537433:web:5e3a1d0df97c14b8c8b0c4"
}
```

**Branch:** `feature/firebase-migration` in worktree `.worktrees/firebase-migration`

---

## CHECKPOINT — 2026-04-17

**Phases 1–5 are COMPLETE. Phases 6–9 are PENDING.**

All 16 migration commits are on `feature/firebase-migration`. Smoke tests pass: `npm run test:smoke → All smoke checks passed`.

### Commit log (migration commits only, newest first)

```
d6732fe refactor(linking): update bootstrap payload for Firebase config
747596d refactor(linking): update server.js OTP endpoints to Firebase Cloud Functions
0b5be01 refactor(linking): update linking IPC for Firebase config fields
68fd4fa refactor(linking): update linking IPC for Firebase config fields
4c36db5 refactor(ipc): update sync IPC handlers for Firebase config fields
036ef6e refactor(sync): update defaults.js — replace AWS env vars with Firebase config
834cd11 feat(sync): rewrite engine.js — replace DynamoDB with Firestore for push/pull sync
d31cce6 refactor(sync): rewrite authority.js — replace DynamoDB sort keys with Firestore document IDs
cc2e24c refactor(sync): rewrite authority.js — (original, followed by quality fix above)
f6a3491 feat(sync): rewrite credentials.js — replace Cognito with Firebase Auth custom tokens
399aafa feat(firebase): add Cloud Functions replacing auth Lambda (authExchange, publishOtp, verifyOtp)
61c53e4 feat(firebase): add syncLog module for timestamp-based pull queries
079ae48 feat(firebase): add Firestore collections module with document ID builders
6704a65 feat(firebase): add firebase-admin module for privileged operations
c8af05e feat(firebase): add Firebase configuration module
720fd60 chore: replace AWS SDK with Firebase dependencies, init Firebase project
```

---

## Key Architecture Decisions

### Firestore document structure
```
schools/{schoolId}/{collection}/{documentId}
```
- `schoolId` = normalized massar code (e.g. `S123456`)
- Collections match SQLite table names: `students`, `grades`, `absences`, `teachers`, etc.
- Composite document IDs use `__` separator: `student_code__subject__semester__school_year`
  - Example: `12345__math__S1__2025/2026`

### syncLog collection (replaces DynamoDB GSI)
```
syncLog/{schoolId}/changes/{updatedAt}_{version}_{entityType}_{rowSyncId}
```
- Pull queries use: `where('updatedAt', '>', cursor)` + `orderBy('updatedAt')` + `limit(500)`
- Cursor advances by `updatedAt` timestamp (was `GSI1SK` string)

### Firebase Auth (replaces Cognito)
- Cloud Function `authExchange` validates HMAC license key → creates Firebase user with `schoolId` claim → mints custom token
- Client calls `signInWithCustomToken(auth, customToken)`
- Firebase SDK handles token refresh automatically (was Cognito 1-hour credentials)

### Backward compatibility
- All AWS field names kept as aliases: `authLambdaUrl`, `awsRegion`, `auth_lambda_url`
- New Firebase fields: `firebaseFunctionsUrl`, `firebaseProjectId`, `firebase_functions_url`, `firebase_project_id`
- `firebase_functions_url` DB column writes are wrapped in try/catch until Phase 6 migration runs

---

## Files Created/Modified

### New files (created)
| File | Purpose |
|------|---------|
| `firebase/firebase.json` | Firebase project config |
| `firebase/.firebaserc` | Project alias (`gestionscholaire`) |
| `firebase/firestore.rules` | Security rules — tenant isolation via `schoolId` claim |
| `firebase/firestore.indexes.json` | Composite index on `changes.updatedAt` + grade/absence indexes |
| `firebase/functions/index.js` | Cloud Functions: `authExchange`, `publishOtp`, `verifyOtp` |
| `firebase/functions/password-utils.js` | `verifyPassword()` — scrypt hash comparison |
| `firebase/functions/package.json` | Standalone package: firebase-admin + firebase-functions |
| `main/firebase/config.js` | Client SDK singleton: `initFirebase`, `getFirestoreDb`, `getFirebaseAuth` |
| `main/firebase/admin.js` | Admin SDK singleton: `initAdmin`, `getAdminFirestore`, `getAdminAuth` |
| `main/firebase/collections.js` | `COLLECTION_MAP`, `buildDocumentId()`, `getCollectionPath()` |
| `main/firebase/sync-log.js` | `logChange()`, `logChangeBatch()`, `pullChanges()` |

### Modified files (rewritten)
| File | Change |
|------|--------|
| `package.json` | Removed AWS SDKs; added `firebase ^11`, `firebase-admin ^13`; excluded `firebase/` from NSIS installer |
| `main/sync/credentials.js` | Removed Cognito; uses `signInWithCustomToken`; `getFunctionsUrl()` |
| `main/sync/authority.js` | Removed `skPrefix`/`keyFields`; `buildDocumentId()` delegates to `collections.js` |
| `main/sync/engine.js` | `writeBatchToFirestore()`, `writeItemWithVersionCheck()`, `pullRemoteChanges()` via syncLog |
| `main/sync/defaults.js` | `DEFAULT_FIREBASE_PROJECT_ID`; `getAppSyncDefaults()` reads Firebase env vars |
| `main/ipc/sync.js` | Returns `firebaseFunctionsUrl`/`firebaseProjectId` as primary; old names as aliases |
| `main/ipc/linking.js` | `getFirebaseFunctionsUrl()`; `normalizeSyncConfig()` includes Firebase fields; added `'use strict'` |
| `main/linking/server.js` | OTP endpoints updated: `/publishOtp`, `/verifyOtp` |
| `main/linking/lan.js` | `buildLinkBootstrapPayload()` includes `firebaseFunctionsUrl`/`firebaseProjectId` |

### Unchanged files (pure logic, untouched)
- `main/sync/merge.js` — three-way merge
- `main/sync/snapshot.js` — drift detection / SQLite checksumming
- `main/sync/capture.js` — outbox capture

---

## Phase Status

### ✅ Phase 1 — Firebase Project Setup & Dependencies (Task 1)
- `package.json` updated: AWS SDKs removed, `firebase ^11` + `firebase-admin ^13` added
- `firebase/` directory excluded from Electron NSIS installer
- `firebase/firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json` created

### ✅ Phase 2 — Firebase Core Modules (Tasks 2–6)
- `main/firebase/config.js` — client SDK singleton with emulator support
- `main/firebase/admin.js` — admin SDK singleton
- `main/firebase/collections.js` — `COLLECTION_MAP` for 18 tables, `buildDocumentId()`, `getCollectionPath()`
- `main/firebase/sync-log.js` — `logChange()`, `pullChanges()`

### ✅ Phase 3 — Cloud Functions (Tasks 7–8)
- `firebase/functions/index.js` — `authExchange`: HMAC license validation → custom token; `publishOtp` + `verifyOtp`: OTP lifecycle
- `firebase/functions/password-utils.js` — scrypt hash verification
- `firebase/functions/package.json` — standalone function package

**⚠️ REQUIRED before deploying functions:**
```bash
cd firebase
firebase functions:secrets:set GESTION_LICENSE_SECRET
# Enter the license secret when prompted
firebase deploy --only functions
```

### ✅ Phase 4 — Sync Engine Rewrite (Tasks 9–12)
- `main/sync/credentials.js` — Cognito replaced with Firebase Auth custom tokens
- `main/sync/authority.js` — DynamoDB sort key patterns replaced with Firestore document IDs
- `main/sync/engine.js` — full rewrite: `writeBatchToFirestore()` (500-item batches), `writeItemWithVersionCheck()` (getDoc → setDoc), `pullRemoteChanges()` via syncLog
- `main/sync/defaults.js` — AWS env vars replaced with Firebase equivalents

### ✅ Phase 5 — IPC & Linking Layer Updates (Tasks 13–16)
- `main/ipc/sync.js` — `sync:getConfig` / `sync:setConfig` updated for Firebase fields
- `main/ipc/linking.js` — `getFirebaseFunctionsUrl()`, `normalizeSyncConfig()`, `upsertSyncConfig()` updated
- `main/linking/server.js` — OTP publish/verify endpoints updated to Cloud Functions paths
- `main/linking/lan.js` — bootstrap payload includes Firebase config fields

---

## PENDING PHASES

### Phase 6 — SQLite Schema Migration (Task 17)

**File:** `main/db/migrations.js`

Add this migration object to the `MIGRATIONS` array at the end, just before the closing `];`:

```javascript
{
    version: '2026-04-17-firebase-sync-config',
    up() {
        const db = getDb();
        ensureColumn(db, 'sync_config', 'firebase_functions_url', "TEXT DEFAULT ''");
        ensureColumn(db, 'sync_config', 'firebase_project_id', "TEXT DEFAULT ''");
    }
}
```

**Why this matters:** `linking.js`, `defaults.js`, and `ipc/sync.js` all write to `firebase_functions_url` and `firebase_project_id` inside try/catch blocks waiting for this column to exist. Once this migration runs, those try/caches become unnecessary but safe to leave.

**After adding the migration:**
```bash
npm run lint
npm run test:smoke
git add main/db/migrations.js
git commit -m "feat(db): migration v20 — add firebase_functions_url and firebase_project_id to sync_config"
```

---

### Phase 7 — Data Migration Scripts (Tasks 18–20)

These scripts are one-time utilities for migrating existing DynamoDB data to Firestore. They live in `scripts/` and are NOT bundled into the Electron app.

#### Task 18: `scripts/export-dynamodb.js`

Reads all records from the `pencil2-sync` DynamoDB table and writes them to a JSON file.

```javascript
// scripts/export-dynamodb.js
'use strict';

require('dotenv').config();
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');

const TABLE_NAME = process.env.DYNAMO_TABLE || 'pencil2-sync';
const OUTPUT_FILE = process.argv[2] || 'dynamo-export.json';

async function exportAll() {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-west-1' }));
    const items = [];
    let lastKey;

    do {
        const resp = await client.send(new ScanCommand({
            TableName: TABLE_NAME,
            ExclusiveStartKey: lastKey
        }));
        items.push(...(resp.Items || []));
        lastKey = resp.LastEvaluatedKey;
        console.log(`Scanned ${items.length} items so far...`);
    } while (lastKey);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(items, null, 2));
    console.log(`Exported ${items.length} items to ${OUTPUT_FILE}`);
}

exportAll().catch(console.error);
```

Run: `node scripts/export-dynamodb.js dynamo-export.json`

#### Task 19: `scripts/import-firestore.js`

Reads the JSON export from Task 18 and writes each record into the correct Firestore collection.

```javascript
// scripts/import-firestore.js
'use strict';

require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');

const INPUT_FILE = process.argv[2] || 'dynamo-export.json';
const SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || 'firebase/gestionscholaire-firebase-adminsdk-fbsvc-d818682f4a.json';

// Map DynamoDB entity types to Firestore collections
const ENTITY_TO_COLLECTION = {
    student: 'students', grade: 'grades', absence: 'absences',
    teacher: 'teachers', teacher_alias: 'teacher_aliases',
    staff_attendance: 'staff_attendance', teacher_absence: 'teacher_absences',
    exam: 'exams', exam_proctor: 'exam_proctors', exam_room: 'exam_rooms',
    test: 'tests', correspondence: 'correspondence', student_file: 'student_files',
    student_movement: 'student_movements', compensation: 'compensation_tracking',
    settings: 'settings', page_visibility: 'page_visibility', device_revocation: 'device_revocation'
};

admin.initializeApp({ credential: admin.credential.cert(SERVICE_ACCOUNT) });
const db = admin.firestore();

function extractSchoolId(pk) {
    // PK format: SCHOOL#<schoolId>
    return pk.replace(/^SCHOOL#/, '');
}

function extractDocId(sk) {
    // SK format: ENTITY_TYPE#field1#field2#...  → remove prefix, replace # with __
    return sk.replace(/^[A-Z_]+#/, '').replace(/#/g, '__');
}

async function importAll() {
    const items = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
    console.log(`Importing ${items.length} items...`);

    // Process in batches of 500 (Firestore limit)
    const BATCH_SIZE = 450;
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const slice = items.slice(i, i + BATCH_SIZE);

        for (const item of slice) {
            const schoolId = extractSchoolId(item.PK || item.pk || '');
            const entityType = item.entityType || item.entity_type || '';
            const collection = ENTITY_TO_COLLECTION[entityType];

            if (!schoolId || !collection) {
                skipped++;
                continue;
            }

            const docId = extractDocId(item.SK || item.sk || '');
            const docRef = db.doc(`schools/${schoolId}/${collection}/${docId}`);

            // Strip DynamoDB-specific fields, keep data fields
            const { PK, SK, pk, sk, GSI1PK, GSI1SK, ...data } = item;
            batch.set(docRef, {
                ...data,
                updatedAt: data.updatedAt || Date.now(),
                version: data.version || 1
            }, { merge: true });
        }

        await batch.commit();
        imported += slice.length - skipped;
        console.log(`Committed batch ${Math.floor(i / BATCH_SIZE) + 1}: ${imported} imported, ${skipped} skipped`);
    }

    console.log(`Done. ${imported} imported, ${skipped} skipped.`);
}

importAll().catch(console.error);
```

Run: `node scripts/import-firestore.js dynamo-export.json`

#### Task 20: `scripts/verify-migration.js`

Verifies record counts match between DynamoDB export and Firestore.

```javascript
// scripts/verify-migration.js
'use strict';

require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');

const INPUT_FILE = process.argv[2] || 'dynamo-export.json';
const SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || 'firebase/gestionscholaire-firebase-adminsdk-fbsvc-d818682f4a.json';

admin.initializeApp({ credential: admin.credential.cert(SERVICE_ACCOUNT) });
const db = admin.firestore();

async function verify() {
    const items = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

    // Count by entityType in export
    const exportCounts = {};
    for (const item of items) {
        const et = item.entityType || item.entity_type || 'unknown';
        exportCounts[et] = (exportCounts[et] || 0) + 1;
    }

    console.log('--- DynamoDB export counts ---');
    for (const [et, count] of Object.entries(exportCounts)) {
        console.log(`  ${et}: ${count}`);
    }

    // Sample Firestore counts for first schoolId found
    const schoolIds = [...new Set(items.map(i => (i.PK || '').replace(/^SCHOOL#/, '')).filter(Boolean))];
    if (!schoolIds.length) {
        console.log('No school IDs found in export.');
        return;
    }

    const schoolId = schoolIds[0];
    console.log(`\n--- Firestore counts for school ${schoolId} ---`);

    const collections = ['students', 'grades', 'absences', 'teachers', 'exams', 'tests'];
    for (const col of collections) {
        const snap = await db.collection(`schools/${schoolId}/${col}`).count().get();
        console.log(`  ${col}: ${snap.data().count}`);
    }
}

verify().catch(console.error);
```

Run: `node scripts/verify-migration.js dynamo-export.json`

Commit for Phase 7:
```bash
git add scripts/export-dynamodb.js scripts/import-firestore.js scripts/verify-migration.js
git commit -m "feat(scripts): add DynamoDB → Firestore data migration and verification scripts"
```

---

### Phase 8 — Integration Testing (Tasks 21–22)

#### Task 21: Firebase Emulator Suite setup

Install Firebase tools and start the emulator:

```bash
npm install -g firebase-tools

# In the firebase/ directory:
cd firebase
firebase emulators:start --only firestore,auth,functions
```

The emulator runs at:
- Firestore: `localhost:8080`
- Auth: `localhost:9099`
- Functions: `localhost:5001`

The app picks up emulators via env vars (already wired in `main/firebase/config.js`):
```
FIRESTORE_EMULATOR_HOST=localhost:8080
FIREBASE_AUTH_EMULATOR_HOST=http://localhost:9099
```

#### Task 22: Manual verification checklist

With emulator running, launch the app and verify:

- [ ] **Auth exchange**: Settings → Sync → enter any license key → "Test Connection" button succeeds
- [ ] **Push cycle**: Add a student record → verify it appears in Firestore Emulator UI at `schools/{schoolId}/students`
- [ ] **Pull cycle**: Modify a record directly in Emulator UI → trigger sync pull → verify local DB updates
- [ ] **OTP linking**: On device A, generate OTP → on device B, enter OTP → verify linking succeeds
- [ ] **Device revocation**: Revoke a device → verify it can no longer sync
- [ ] **Conflict resolution**: Create a record on two devices offline → bring online → verify merge.js resolves correctly
- [ ] **Connection test**: `window.api.sync.testConnection()` returns `{ success: true }`
- [ ] **Backward compat**: Old `authLambdaUrl` field in sync config still works as alias for `firebaseFunctionsUrl`

No automated test files are required — the existing smoke test (`tests/smoke.js`) continues to validate IPC parity and module integrity.

---

### Phase 9 — Cleanup (Tasks 23–24)

#### Task 23: Delete AWS infrastructure files

```bash
# Only delete if these files exist:
rm -f infra/lib/sync-stack.ts
rm -f infra/lib/auth-lambda/index.js
rm -f infra/lib/auth-lambda/schema-constants.js

git add -A
git commit -m "chore: remove AWS CDK sync stack and auth Lambda"
```

#### Task 24: Update CLAUDE.md environment variables section

In `CLAUDE.md`, find the `### Environment Variables` section and update it:

**Remove:**
```
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (sync credentials — managed via Cognito)
AUTH_LAMBDA_URL (legacy — URL of auth Lambda function)
```

**Add:**
```
FIREBASE_FUNCTIONS_URL — URL of deployed Firebase Cloud Functions (e.g. https://us-central1-gestionscholaire.cloudfunctions.net)
FIREBASE_PROJECT_ID — Firebase project ID (default: gestionscholaire)
FIREBASE_SERVICE_ACCOUNT_PATH — Path to service account key (main process only, never bundled)
GESTION_LICENSE_SECRET — Secret for HMAC license validation (set via Firebase Secrets Manager)
```

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md env vars for Firebase migration"
```

---

## Pre-Deployment Checklist

Before going live with the Cloud Functions, complete all of these:

- [ ] **Set the license secret:**
  ```bash
  cd firebase
  firebase functions:secrets:set GESTION_LICENSE_SECRET
  # Enter the secret value when prompted
  ```
- [ ] **Deploy Firestore rules:**
  ```bash
  firebase deploy --only firestore:rules
  ```
- [ ] **Deploy Firestore indexes:**
  ```bash
  firebase deploy --only firestore:indexes
  ```
- [ ] **Deploy Cloud Functions:**
  ```bash
  firebase deploy --only functions
  ```
- [ ] **Note the deployed functions URL** (shown in output) — it looks like:
  `https://us-central1-gestionscholaire.cloudfunctions.net`
- [ ] **Set this URL** in the app's Settings → Sync → Firebase Functions URL field
- [ ] **Verify** that `testConnection()` succeeds from a linked device

---

## Reference: Key Function Signatures

### `main/firebase/collections.js`
```javascript
buildDocumentId(tableName, rowData)
// 'grades', { student_code: '123', subject: 'math', semester: 'S1', school_year: '2025/2026' }
// → '123__math__S1__2025/2026'

getCollectionPath(schoolId, tableName)
// 'S123456', 'teachers' → 'schools/S123456/teachers'
```

### `main/firebase/sync-log.js`
```javascript
await logChange(firestoreDb, schoolId, entityType, docId, version, operation, rowSyncId, deviceHash, schoolYear)
await logChangeBatch(firestoreDb, schoolId, entries[])
await pullChanges(firestoreDb, schoolId, cursorTimestamp, maxResults=500)
// returns [{ id, entityType, collectionPath, documentId, updatedAt, version, ... }]
```

### `main/sync/credentials.js`
```javascript
await refreshCredentials(db)     // returns { user, schoolId, expiresAt }
await getCredentials(db)         // cached, auto-refreshes
await testConnection(db)         // 3-step: authExchange → signIn → Firestore read
getFunctionsUrl(db)              // reads firebase_functions_url → auth_lambda_url → env
```

### `main/sync/engine.js`
```javascript
await flushSyncOutbox(db)        // push: reads outbox → writeBatchToFirestore()
await pullRemoteChanges(db)      // pull: pullChanges() → apply to SQLite
await startSyncPushBackground(db)
await startSyncPullBackground(db)
```

### Cloud Functions (deployed at `FIREBASE_FUNCTIONS_URL`)
```
POST /authExchange
  Body: { licenseKey, deviceHash, schoolId }
  Returns: { customToken, schoolId }

POST /publishOtp
  Body: { licenseKey, deviceHash, massarCode, otp, payload }
  Returns: { success: true }

POST /verifyOtp
  Body: { massarCode, otp }
  Returns: { success: true, configPayload: { institution, syncConfig, users } }
  Errors: INVALID_OTP, OTP_EXPIRED, OTP_USED, RATE_LIMITED, NO_ACTIVE_OTP
```

---

## Resumption Instructions

To continue in the next session:

1. **Open the worktree:**
   ```bash
   cd D:\gestionScholaire\.worktrees\firebase-migration
   ```
2. **Verify branch and smoke tests:**
   ```bash
   git branch          # should be feature/firebase-migration
   npm run test:smoke  # should pass
   ```
3. **Next task is Phase 6, Task 17** — add the SQLite migration to `main/db/migrations.js` (see Phase 6 section above for exact code)
4. Then proceed through Phases 7 → 8 → 9 in order
