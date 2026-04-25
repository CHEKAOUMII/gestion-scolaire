# DynamoDB → Firebase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AWS DynamoDB + Cognito with Firebase Firestore + Firebase Auth for cloud sync, while preserving the existing SQLite-first offline architecture and all sync behaviors (push, pull, three-way merge, device revocation, OTP linking).

**Architecture:** The Electron app uses SQLite as its primary local database. The cloud sync layer (push outbox → remote, pull remote → local) currently targets DynamoDB via AWS SDK with Cognito-issued temporary credentials. This migration replaces that cloud layer with Firestore, replaces Cognito auth with Firebase Auth (custom tokens via a Cloud Function), and replaces the auth Lambda with equivalent Firebase Cloud Functions. The local SQLite layer, outbox/capture system, merge logic, and snapshot system remain unchanged.

**Tech Stack:** Firebase Client SDK (browser build for renderer, `firebase-admin` for main process privileged ops), Firebase Cloud Functions (replaces auth Lambda), Firestore (replaces DynamoDB), Firebase Auth with custom tokens (replaces Cognito Identity).

---

## Codebase Verification Report

Before planning, all file paths from the original migration plan were verified against the actual codebase. Key findings:

### Files That Exist (confirmed)
| File | Lines | AWS SDK Used |
|---|---|---|
| `main/sync/engine.js` | 1,234 | `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` (DynamoDBClient, BatchWriteCommand, PutCommand, QueryCommand) |
| `main/sync/credentials.js` | 195 | `@aws-sdk/client-cognito-identity` (CognitoIdentityClient, GetCredentialsForIdentityCommand) |
| `main/sync/authority.js` | 94 | None (defines DynamoDB sort-key schema only) |
| `main/sync/capture.js` | 664 | None (pure SQLite outbox capture) |
| `main/sync/defaults.js` | 75 | None (reads env vars for auth_lambda_url, aws_region) |
| `main/sync/merge.js` | ~100 | None (pure merge logic) |
| `main/sync/snapshot.js` | ~150 | None (drift detection via checksums) |
| `main/ipc/sync.js` | 282 | None (IPC handlers calling engine/credentials) |
| `main/ipc/linking.js` | 937 | None (OTP generation, LAN/server verification) |
| `main/linking/server.js` | ~200 | None (calls auth Lambda endpoints for OTP publish/verify) |
| `main/linking/otp.js` | ~150 | None (local OTP generation/verification) |
| `main/linking/lan.js` | ~300 | None (LAN discovery, bootstrap payload) |
| `main/auth/password.js` | ~50 | None (scrypt hashing) |
| `main/auth/permissions.js` | ~100 | None (role/page access control) |
| `preload.js` | 355 | None (IPC bridge) |
| `infra/lib/sync-stack.ts` | 239 | CDK stack (DynamoDB table, Cognito pool, auth Lambda, IAM) |
| `infra/lib/auth-lambda/index.js` | 487 | Cognito Identity SDK, DynamoDB SDK (OTP read/write) |
| `infra/lib/auth-lambda/schema-constants.js` | 34 | None (entity SK prefixes, table name) |

### Files That Do NOT Exist (original plan errors)
| Claimed Path | Reality |
|---|---|
| `main/sync/constants.js` | Does NOT exist. Constants are inline in `engine.js` (`SYNC_TABLE_NAME`, `TOPO_ORDER_PUT/DEL`) and `capture.js` (`SENSITIVE_FIELDS`) |
| `main/auth/` (as a directory for Firebase auth) | Auth lives in `main/ipc/auth.js` + `main/auth/password.js` + `main/auth/permissions.js` |

### Critical Flows Not Covered in Original Plan
1. **Linking/OTP flow** — `main/linking/server.js` calls Lambda endpoints (`/link/publish-otp`, `/link/verify-otp`) with encrypted payloads. This must be migrated to Firebase Cloud Functions.
2. **LAN linking** — `main/linking/lan.js` builds a bootstrap payload with sync config (auth_lambda_url, license_key, etc.). The payload structure must be updated for Firebase config.
3. **Credential caching** — `credentials.js` caches Cognito credentials with a 600s buffer. Firebase Auth tokens have different refresh semantics.
4. **`sync_config` table** — stores `auth_lambda_url`, `aws_region`, `license_key`, `school_id`. These DB columns must be updated/replaced for Firebase config.
5. **`main/sync/defaults.js`** — reads env vars `AUTH_LAMBDA_URL`, `AWS_REGION` etc. Must be updated for Firebase config.

---

## File Structure

### New Files to Create

| File | Responsibility |
|---|---|
| `main/firebase/config.js` | Firebase app initialization (client SDK), Firestore + Auth instances, emulator support |
| `main/firebase/admin.js` | `firebase-admin` initialization for privileged operations (custom token minting if needed locally) |
| `main/firebase/collections.js` | Firestore collection path constants and document ID builders (replaces DynamoDB key schema in `authority.js`) |
| `main/firebase/sync-log.js` | SyncLog write/query helpers (replaces DynamoDB GSI-based pull queries) |
| `firebase/functions/index.js` | Cloud Functions: credential exchange, OTP publish, OTP verify (replaces `infra/lib/auth-lambda/index.js`) |
| `firebase/firestore.rules` | Security rules for tenant isolation |
| `firebase/firestore.indexes.json` | Composite indexes for sync queries |
| `firebase/.firebaserc` | Firebase project config |
| `firebase/firebase.json` | Firebase project setup (functions, firestore, hosting) |
| `scripts/export-dynamodb.js` | One-time DynamoDB data export script |
| `scripts/import-firestore.js` | One-time Firestore data import script |
| `scripts/verify-migration.js` | Post-migration verification script (checksums, counts) |

### Files to Modify

| File | Changes |
|---|---|
| `main/sync/engine.js` | Replace `DynamoDBClient`/`BatchWriteCommand`/`PutCommand`/`QueryCommand` with Firestore SDK calls. Replace `getDynamoClient()` with `getFirestoreDb()`. Replace `buildDynamoItem()` with `buildFirestoreDoc()`. Replace `writeBatchToDynamo()` with `writeBatchToFirestore()`. Replace `writeItemWithCondition()` with `writeItemWithVersionCheck()`. Replace DynamoDB GSI query in `pullRemoteChanges()` with syncLog query. |
| `main/sync/credentials.js` | Replace Cognito flow with Firebase Auth. Replace `CognitoIdentityClient` + `GetCredentialsForIdentityCommand` with Firebase `signInWithCustomToken()`. Replace credential caching (no more AWS temp creds — Firebase handles token refresh). Replace `testConnection()` DynamoDB ping with Firestore ping. |
| `main/sync/authority.js` | Replace `buildSortKey()` with `buildDocumentId()`. Replace `ENTITY_TYPE_REGISTRY` `skPrefix`/`keyFields` with Firestore collection names and doc ID builders. Keep `WRITER_AUTHORITY`, `canPush()`, `getEntityType()` unchanged. |
| `main/sync/defaults.js` | Replace `AUTH_LAMBDA_URL` / `AWS_REGION` env vars with Firebase config env vars (`FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_FUNCTIONS_URL`). Update `applySyncDefaults()` and `seedSyncDefaults()`. |
| `main/sync/snapshot.js` | No changes needed (pure SQLite checksumming, no AWS SDK dependency). |
| `main/sync/merge.js` | No changes needed (pure merge logic). |
| `main/sync/capture.js` | No changes needed (pure SQLite outbox capture). |
| `main/ipc/sync.js` | Update `sync:setConfig` field map: replace `awsRegion`→`firebaseProjectId`, `authLambdaUrl`→`firebaseFunctionsUrl`. Update `sync:getConfig` response shape. |
| `main/ipc/linking.js` | Update `getAuthLambdaUrl()` → `getFirebaseFunctionsUrl()`. Update `normalizeSyncConfig()` to handle Firebase fields instead of AWS. Update `upsertSyncConfig()` column names. |
| `main/linking/server.js` | Replace `POST {authLambdaUrl}/link/publish-otp` and `POST {authLambdaUrl}/link/verify-otp` with Firebase Cloud Function URLs. |
| `main/linking/lan.js` | Update `buildLinkBootstrapPayload()` — replace `awsRegion`/`authLambdaUrl` with Firebase config fields in the syncConfig payload. |
| `preload.js` | No changes needed (IPC channel names stay the same — only backend implementations change). |
| `package.json` | Remove `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-cognito-identity`. Add `firebase` (client SDK). Add `firebase-admin` (for admin operations). |

### Files to Delete (post-migration, Phase 8)

| File | Reason |
|---|---|
| `infra/lib/sync-stack.ts` | CDK stack — replaced by Firebase project |
| `infra/lib/auth-lambda/index.js` | Auth Lambda — replaced by Cloud Functions |
| `infra/lib/auth-lambda/schema-constants.js` | Schema constants — replaced by `main/firebase/collections.js` |
| `infra/` (entire directory, eventually) | CDK project — no longer needed |

### Files That Stay Unchanged

| File | Reason |
|---|---|
| `main/sync/merge.js` | Pure logic, no cloud dependency |
| `main/sync/snapshot.js` | Pure SQLite checksumming |
| `main/sync/capture.js` | Pure SQLite outbox capture |
| `main/ipc/auth.js` | Local auth (in-memory sessions, not related to cloud auth) |
| `main/auth/password.js` | Scrypt hashing (used by local auth + OTP) |
| `main/auth/permissions.js` | Role/page access control |
| `main/linking/otp.js` | Local OTP generation (SQLite-only) |
| `main/db/*` | SQLite database layer |

---

## Firestore Data Model

### Collection Structure

```
schools/{schoolId}/
  ├── students/{studentCode}
  ├── grades/{studentCode}__{subject}__{semester}__{schoolYear}
  ├── absences/{studentCode}__{month}__{schoolYear}__{absenceType}
  ├── teachers/{teacherId}
  ├── teacherAliases/{aliasId}
  ├── staffAttendance/{teacherId}__{date}
  ├── teacherAbsences/{teacherId}__{date}
  ├── exams/{examId}
  ├── examProctors/{examId}__{teacherId}
  ├── examRooms/{examId}__{roomId}
  ├── tests/{testId}
  ├── correspondence/{correspondenceId}
  ├── studentFiles/{studentCode}__{fileId}
  ├── studentMovements/{movementId}
  ├── compensation/{trackingId}
  ├── settings/{settingKey}
  ├── pageVisibility/{pageKey}
  └── deviceRevocations/{revokedDeviceHash}

syncLog/{schoolId}/changes/{updatedAt}_{version}_{entityType}_{entityId}

otpCodes/{massarCode}
```

### Document ID Mapping (DynamoDB SK → Firestore Doc ID)

The `__` separator replaces `#` from DynamoDB sort keys. The entity type prefix is dropped (it becomes the collection name).

---

## Phase 1: Firebase Project Setup & Configuration (Day 1)

### Task 1: Create Firebase Project and Install Dependencies

**Files:**
- Modify: `package.json`
- Create: `firebase/firebase.json`
- Create: `firebase/.firebaserc`

- [ ] **Step 1: Create Firebase project via Firebase Console**

Go to https://console.firebase.google.com, create project (e.g., `pencil2-sync`). Enable:
- Cloud Firestore (production mode)
- Firebase Authentication (enable "Anonymous" and "Custom" providers)
- Cloud Functions (Blaze plan required)

- [ ] **Step 2: Download service account key**

Firebase Console → Project Settings → Service Accounts → Generate New Private Key.
Save as `firebase/service-account.json` (gitignored).

- [ ] **Step 3: Install Firebase CLI globally**

```bash
npm install -g firebase-tools
firebase login
```

- [ ] **Step 4: Remove AWS SDK dependencies and add Firebase**

```bash
npm uninstall @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cognito-identity
npm install firebase firebase-admin
```

Run: `npm ls firebase firebase-admin`
Expected: Both packages listed under dependencies.

- [ ] **Step 5: Initialize Firebase project files**

```bash
mkdir -p firebase/functions
```

Create `firebase/firebase.json`:
```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "functions": {
    "source": "functions",
    "runtime": "nodejs22"
  }
}
```

Create `firebase/.firebaserc`:
```json
{
  "projects": {
    "default": "pencil2-sync"
  }
}
```

- [ ] **Step 6: Add firebase files to .gitignore**

Append to `.gitignore`:
```
firebase/service-account.json
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json firebase/firebase.json firebase/.firebaserc .gitignore
git commit -m "chore: replace AWS SDK with Firebase dependencies, init Firebase project"
```

---

### Task 2: Create Firebase Configuration Module

**Files:**
- Create: `main/firebase/config.js`

- [ ] **Step 1: Write the Firebase config module**

```javascript
'use strict';

const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator } = require('firebase/firestore');
const { getAuth, connectAuthEmulator } = require('firebase/auth');

let _app = null;
let _db = null;
let _auth = null;

function getFirebaseConfig() {
    return {
        apiKey: process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.FIREBASE_APP_ID || ''
    };
}

function initFirebase() {
    if (_app) return { app: _app, db: _db, auth: _auth };

    const config = getFirebaseConfig();
    if (!config.projectId) {
        console.warn('[firebase] No FIREBASE_PROJECT_ID — Firebase not initialized');
        return { app: null, db: null, auth: null };
    }

    _app = initializeApp(config);
    _db = getFirestore(_app);
    _auth = getAuth(_app);

    if (process.env.FIRESTORE_EMULATOR_HOST) {
        const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
        connectFirestoreEmulator(_db, host, parseInt(port, 10));
    }
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        connectAuthEmulator(_auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
    }

    console.log(`[firebase] Initialized for project: ${config.projectId}`);
    return { app: _app, db: _db, auth: _auth };
}

function getFirestoreDb() {
    if (!_db) initFirebase();
    return _db;
}

function getFirebaseAuth() {
    if (!_auth) initFirebase();
    return _auth;
}

module.exports = { initFirebase, getFirestoreDb, getFirebaseAuth, getFirebaseConfig };
```

- [ ] **Step 2: Verify the module loads without errors**

```bash
node -e "require('./main/firebase/config.js'); console.log('OK')"
```

Expected: `[firebase] No FIREBASE_PROJECT_ID — Firebase not initialized` then `OK` (no crash).

- [ ] **Step 3: Commit**

```bash
git add main/firebase/config.js
git commit -m "feat(firebase): add Firebase configuration module"
```

---

### Task 3: Create Firebase Admin Module

**Files:**
- Create: `main/firebase/admin.js`

- [ ] **Step 1: Write the admin SDK module**

```javascript
'use strict';

const admin = require('firebase-admin');
const path = require('path');

let _adminApp = null;

function initAdmin() {
    if (_adminApp) return _adminApp;

    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '';

    if (serviceAccountPath) {
        const serviceAccount = require(path.resolve(serviceAccountPath));
        _adminApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } else if (process.env.FIREBASE_PROJECT_ID) {
        // Application Default Credentials (for Cloud Functions environment)
        _adminApp = admin.initializeApp({
            projectId: process.env.FIREBASE_PROJECT_ID
        });
    } else {
        console.warn('[firebase-admin] No credentials configured');
        return null;
    }

    console.log('[firebase-admin] Initialized');
    return _adminApp;
}

function getAdminFirestore() {
    const app = initAdmin();
    return app ? admin.firestore(app) : null;
}

function getAdminAuth() {
    const app = initAdmin();
    return app ? admin.auth(app) : null;
}

module.exports = { initAdmin, getAdminFirestore, getAdminAuth };
```

- [ ] **Step 2: Commit**

```bash
git add main/firebase/admin.js
git commit -m "feat(firebase): add firebase-admin module for privileged operations"
```

---

### Task 4: Create Firestore Collections Module

**Files:**
- Create: `main/firebase/collections.js`

This module replaces the DynamoDB key schema in `authority.js` with Firestore collection paths and document ID builders.

- [ ] **Step 1: Write the collections module**

```javascript
'use strict';

/**
 * Firestore collection path constants and document ID builders.
 * Replaces DynamoDB sort-key construction from authority.js.
 *
 * Convention: composite document IDs use '__' as separator
 * (replacing '#' from DynamoDB sort keys, minus the entity type prefix).
 */

const COLLECTION_MAP = {
    students:              { collection: 'students',           idFields: ['code'] },
    grades:                { collection: 'grades',             idFields: ['student_code', 'subject', 'semester', 'school_year'] },
    absences:              { collection: 'absences',           idFields: ['student_code', 'month', 'school_year', 'absence_type'] },
    teachers:              { collection: 'teachers',           idFields: ['id'] },
    teacher_aliases:       { collection: 'teacherAliases',     idFields: ['id'] },
    staff_attendance:      { collection: 'staffAttendance',    idFields: ['teacher_id', 'date'] },
    teacher_absences:      { collection: 'teacherAbsences',    idFields: ['teacher_id', 'date'] },
    exams:                 { collection: 'exams',              idFields: ['id'] },
    exam_proctors:         { collection: 'examProctors',       idFields: ['exam_id', 'teacher_id'] },
    exam_rooms:            { collection: 'examRooms',          idFields: ['exam_id', 'room_id'] },
    tests:                 { collection: 'tests',              idFields: ['id'] },
    correspondence:        { collection: 'correspondence',     idFields: ['id'] },
    student_files:         { collection: 'studentFiles',       idFields: ['student_code', 'file_id'] },
    student_movements:     { collection: 'studentMovements',   idFields: ['id'] },
    compensation_tracking: { collection: 'compensation',       idFields: ['id'] },
    settings:              { collection: 'settings',           idFields: ['key'] },
    page_visibility:       { collection: 'pageVisibility',     idFields: ['page_key'] },
    device_revocation:     { collection: 'deviceRevocations',  idFields: ['revokedDeviceHash'] }
};

const SCHOOL_PREFIX = 'schools';

function getCollectionPath(schoolId, tableName) {
    const mapping = COLLECTION_MAP[tableName];
    if (!mapping) return null;
    return `${SCHOOL_PREFIX}/${schoolId}/${mapping.collection}`;
}

function buildDocumentId(tableName, rowData) {
    const mapping = COLLECTION_MAP[tableName];
    if (!mapping) return null;

    const parts = [];
    for (const field of mapping.idFields) {
        const value = rowData[field];
        if (value == null || String(value).trim() === '') return null;
        parts.push(String(value).trim());
    }

    return parts.join('__');
}

function getCollectionName(tableName) {
    const mapping = COLLECTION_MAP[tableName];
    return mapping ? mapping.collection : null;
}

module.exports = {
    COLLECTION_MAP,
    SCHOOL_PREFIX,
    getCollectionPath,
    buildDocumentId,
    getCollectionName
};
```

- [ ] **Step 2: Verify document ID building matches DynamoDB sort key patterns**

```bash
node -e "
const { buildDocumentId } = require('./main/firebase/collections.js');
console.log(buildDocumentId('grades', { student_code: '12345', subject: 'math', semester: 'S1', school_year: '2025/2026' }));
// Expected: '12345__math__S1__2025/2026'
console.log(buildDocumentId('students', { code: '12345' }));
// Expected: '12345'
console.log(buildDocumentId('staff_attendance', { teacher_id: 't1', date: '2025-03-20' }));
// Expected: 't1__2025-03-20'
"
```

- [ ] **Step 3: Commit**

```bash
git add main/firebase/collections.js
git commit -m "feat(firebase): add Firestore collections module with document ID builders"
```

---

### Task 5: Create SyncLog Module

**Files:**
- Create: `main/firebase/sync-log.js`

The syncLog replaces DynamoDB's GSI (`SyncGSI`) for timestamp-based pull queries.

- [ ] **Step 1: Write the syncLog module**

```javascript
'use strict';

const {
    collection, doc, setDoc, getDocs,
    query, where, orderBy, limit,
    Timestamp, writeBatch
} = require('firebase/firestore');

/**
 * Writes a sync log entry when a document is pushed to Firestore.
 * Path: syncLog/{schoolId}/changes/{changeId}
 */
async function logChange(db, schoolId, entityType, entityId, operation, data, version, deviceHash, rowSyncId, schoolYear) {
    const updatedAt = Math.floor(Date.now() / 1000);
    const changeId = `${updatedAt}_${version}_${entityType}_${rowSyncId}`;

    const changeRef = doc(db, 'syncLog', schoolId, 'changes', changeId);
    await setDoc(changeRef, {
        entityType,
        entityId,
        operation,
        data: data || {},
        version,
        deviceHash: String(deviceHash || '').substring(0, 16),
        rowSyncId: rowSyncId || '',
        schoolYear: schoolYear || '',
        updatedAt,
        ttl: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
    });

    return changeId;
}

/**
 * Batch-writes multiple sync log entries.
 */
async function logChangeBatch(db, schoolId, entries) {
    const batch = writeBatch(db);

    for (const entry of entries) {
        const updatedAt = entry.updatedAt || Math.floor(Date.now() / 1000);
        const changeId = `${updatedAt}_${entry.version}_${entry.entityType}_${entry.rowSyncId}`;
        const changeRef = doc(db, 'syncLog', schoolId, 'changes', changeId);

        batch.set(changeRef, {
            entityType: entry.entityType,
            entityId: entry.entityId || '',
            operation: entry.operation,
            data: entry.data || {},
            version: entry.version,
            deviceHash: String(entry.deviceHash || '').substring(0, 16),
            rowSyncId: entry.rowSyncId || '',
            schoolYear: entry.schoolYear || '',
            updatedAt,
            ttl: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
        });
    }

    await batch.commit();
}

/**
 * Pull changes since a cursor timestamp.
 * Equivalent to: GSI1PK = :schoolPk AND GSI1SK > :cursor
 */
async function pullChanges(db, schoolId, cursorTimestamp, maxResults = 500) {
    const changesRef = collection(db, 'syncLog', schoolId, 'changes');
    const cursor = Number(cursorTimestamp) || 0;

    const q = query(
        changesRef,
        where('updatedAt', '>', cursor),
        orderBy('updatedAt'),
        limit(maxResults)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

module.exports = { logChange, logChangeBatch, pullChanges };
```

- [ ] **Step 2: Commit**

```bash
git add main/firebase/sync-log.js
git commit -m "feat(firebase): add syncLog module for timestamp-based pull queries"
```

---

## Phase 2: Firestore Security Rules & Indexes (Day 1-2)

### Task 6: Create Firestore Security Rules

**Files:**
- Create: `firebase/firestore.rules`

- [ ] **Step 1: Write security rules**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthenticated() {
      return request.auth != null;
    }

    function getSchoolId() {
      return request.auth.token.schoolId;
    }

    function belongsToSchool(schoolId) {
      return isAuthenticated() && getSchoolId() == schoolId;
    }

    function isNewerVersion() {
      return !exists(resource) || request.resource.data.version > resource.data.version;
    }

    // All school subcollections follow the same pattern
    match /schools/{schoolId}/{entityCollection}/{docId} {
      allow read: if belongsToSchool(schoolId);
      allow create: if belongsToSchool(schoolId);
      allow update: if belongsToSchool(schoolId) && isNewerVersion();
      allow delete: if belongsToSchool(schoolId);
    }

    // SyncLog — read by clients, written only by Cloud Functions (server)
    match /syncLog/{schoolId}/changes/{changeId} {
      allow read: if belongsToSchool(schoolId);
      allow write: if belongsToSchool(schoolId);
    }

    // OTP codes — server-managed via Cloud Functions
    match /otpCodes/{massarCode} {
      allow read: if false;
      allow write: if false;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add firebase/firestore.rules
git commit -m "feat(firebase): add Firestore security rules for tenant isolation"
```

---

### Task 7: Create Firestore Indexes

**Files:**
- Create: `firebase/firestore.indexes.json`

- [ ] **Step 1: Write composite indexes**

```json
{
  "indexes": [
    {
      "collectionGroup": "changes",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "updatedAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "grades",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "student_code", "order": "ASCENDING" },
        { "fieldPath": "school_year", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "absences",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "student_code", "order": "ASCENDING" },
        { "fieldPath": "school_year", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 2: Commit**

```bash
git add firebase/firestore.indexes.json
git commit -m "feat(firebase): add Firestore composite indexes for sync queries"
```

---

## Phase 3: Cloud Functions — Auth Lambda Replacement (Day 2-4)

### Task 8: Create Cloud Function for Credential Exchange

**Files:**
- Create: `firebase/functions/package.json`
- Create: `firebase/functions/index.js`

This replaces `infra/lib/auth-lambda/index.js` handler for the `/` (credential exchange) route.

- [ ] **Step 1: Initialize Cloud Functions project**

```bash
cd firebase/functions
npm init -y
npm install firebase-admin firebase-functions
```

Update `firebase/functions/package.json` engines:
```json
{
  "engines": { "node": "22" },
  "main": "index.js"
}
```

- [ ] **Step 2: Write the Cloud Functions**

Create `firebase/functions/index.js`:

```javascript
'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

const SIGNING_SECRET = process.env.GESTION_LICENSE_SECRET || '';

/**
 * POST /auth — Credential exchange.
 * Validates licenseKey + deviceHash, mints a Firebase custom token
 * with schoolId claim. Replaces Cognito GetOpenIdTokenForDeveloperIdentity.
 */
exports.authExchange = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { licenseKey, deviceHash } = req.body || {};
    if (!licenseKey || !deviceHash) {
        return res.status(400).json({ error: 'Missing licenseKey or deviceHash' });
    }

    // Validate license key (same logic as auth-lambda/index.js validateLicenseKey)
    let customerRef, expiresAt;
    try {
        const result = validateLicenseKey(licenseKey, SIGNING_SECRET);
        customerRef = result.customerRef;
        expiresAt = result.expiresAt;
    } catch (err) {
        return res.status(401).json({ error: err.message });
    }

    if (expiresAt && expiresAt < Math.floor(Date.now() / 1000)) {
        return res.status(401).json({ error: 'License expired' });
    }

    // Create or get Firebase user for this device
    const uid = `device_${deviceHash}`;
    try {
        await auth.getUser(uid);
    } catch {
        await auth.createUser({ uid, displayName: `Device ${deviceHash.substring(0, 8)}` });
    }

    // Set custom claims with schoolId
    await auth.setCustomUserClaims(uid, { schoolId: customerRef });

    // Mint custom token
    const customToken = await auth.createCustomToken(uid, { schoolId: customerRef });

    return res.status(200).json({
        customToken,
        schoolId: customerRef,
        expiresAt: expiresAt || null
    });
});

/**
 * POST /link/publish-otp — Publish OTP for device linking.
 * Replaces DynamoDB PutItem for OTP#{massar}/ACTIVE.
 */
exports.publishOtp = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { licenseKey, deviceHash, massar, otpHash, encryptedPayload, iv, authTag } = req.body || {};

    if (!licenseKey || !deviceHash || !massar || !otpHash) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate license key
    let customerRef;
    try {
        const result = validateLicenseKey(licenseKey, SIGNING_SECRET);
        customerRef = result.customerRef;
    } catch (err) {
        return res.status(401).json({ error: err.message });
    }

    // Verify massar matches customerRef
    if (massar !== customerRef) {
        return res.status(403).json({ error: 'MASSAR_MISMATCH' });
    }

    // Validate otpHash format (scrypt)
    if (!otpHash.startsWith('scrypt$')) {
        return res.status(400).json({ error: 'Invalid OTP hash format' });
    }

    // Validate encrypted payload
    if (encryptedPayload) {
        const payloadBytes = Buffer.from(encryptedPayload, 'base64');
        if (payloadBytes.length > 300 * 1024) {
            return res.status(400).json({ error: 'Encrypted payload too large' });
        }
    }

    // Write OTP to Firestore
    const otpRef = db.collection('otpCodes').doc(massar);
    await otpRef.set({
        massarCode: massar,
        otpHash,
        encryptedPayload: encryptedPayload || null,
        iv: iv || null,
        authTag: authTag || null,
        status: 'active',
        failureCount: 0,
        publishedBy: deviceHash,
        expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: true });
});

/**
 * POST /link/verify-otp — Verify OTP for device linking.
 * Replaces DynamoDB GetItem + conditional UpdateItem for OTP verification.
 */
exports.verifyOtp = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { massar, otp } = req.body || {};
    if (!massar || !otp) {
        return res.status(400).json({ error: 'Missing massar or otp' });
    }

    const otpRef = db.collection('otpCodes').doc(massar);
    const otpDoc = await otpRef.get();

    if (!otpDoc.exists) {
        return res.status(404).json({ error: 'NOT_FOUND', code: 'NO_ACTIVE_OTP' });
    }

    const otpData = otpDoc.data();

    // Check expiry
    const now = Date.now();
    if (otpData.expiresAt && otpData.expiresAt.toDate().getTime() < now) {
        return res.status(401).json({ error: 'OTP_EXPIRED', code: 'OTP_EXPIRED' });
    }

    // Check status
    if (otpData.status !== 'active') {
        const code = otpData.status === 'used' ? 'OTP_USED' : 'OTP_CANCELLED';
        return res.status(401).json({ error: code, code });
    }

    // Check failure count
    if (otpData.failureCount >= 5) {
        return res.status(429).json({ error: 'RATE_LIMITED', code: 'RATE_LIMITED' });
    }

    // Verify scrypt hash
    const { verifyPassword } = require('./password-utils');
    const isValid = verifyPassword(otp, otpData.otpHash);

    if (!isValid) {
        await otpRef.update({
            failureCount: admin.firestore.FieldValue.increment(1)
        });
        return res.status(401).json({ error: 'INVALID_OTP', code: 'INVALID_OTP' });
    }

    // Mark as used
    await otpRef.update({ status: 'used' });

    return res.status(200).json({
        success: true,
        encryptedPayload: otpData.encryptedPayload,
        iv: otpData.iv,
        authTag: otpData.authTag
    });
});

/**
 * License key validation (ported from auth-lambda/index.js).
 */
function validateLicenseKey(licenseKey, secret) {
    if (!secret) {
        throw new Error('License validation secret not configured');
    }

    const parts = String(licenseKey).split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid license key format');
    }

    const [payloadB64, signatureHex, _version] = parts;
    const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(payloadB64)
        .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signatureHex, 'hex'), Buffer.from(expectedSig, 'hex'))) {
        throw new Error('Invalid license key signature');
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return {
        customerRef: payload.customerRef || payload.customer,
        plan: payload.plan,
        expiresAt: payload.expiresAt || payload.exp
    };
}
```

- [ ] **Step 3: Create password utilities for Cloud Functions**

Create `firebase/functions/password-utils.js`:

```javascript
'use strict';

const crypto = require('crypto');

function verifyPassword(password, storedHash) {
    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

    const salt = Buffer.from(parts[1], 'hex');
    const expectedHash = Buffer.from(parts[2], 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);

    return crypto.timingSafeEqual(derivedKey, expectedHash);
}

module.exports = { verifyPassword };
```

- [ ] **Step 4: Deploy Cloud Functions**

```bash
cd firebase
firebase deploy --only functions
```

Note the deployed function URLs — they will replace `auth_lambda_url` in sync config.

- [ ] **Step 5: Commit**

```bash
git add firebase/functions/
git commit -m "feat(firebase): add Cloud Functions replacing auth Lambda (credential exchange, OTP publish/verify)"
```

---

## Phase 4: Sync Engine Migration (Day 4-8)

This is the largest phase. It rewrites the core sync engine to use Firestore instead of DynamoDB.

### Task 9: Rewrite `main/sync/credentials.js` — Firebase Auth

**Files:**
- Modify: `main/sync/credentials.js`

Replace Cognito identity flow with Firebase Auth custom token flow.

- [ ] **Step 1: Rewrite credentials.js**

Replace the entire file content:

```javascript
'use strict';

const { signInWithCustomToken } = require('firebase/auth');
const { getFirebaseAuth, getFirestoreDb } = require('../firebase/config');
const { doc, getDoc } = require('firebase/firestore');
const { getDb } = require('../db/context');
const { getDeviceHash } = require('./capture');

let _cachedAuth = null;
let _refreshPromise = null;

function readSyncConfig(db) {
    return db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
}

function readLicenseKey(db) {
    const config = readSyncConfig(db);
    return config.license_key ? String(config.license_key).trim() || null : null;
}

async function refreshCredentials() {
    try {
        const db = getDb();
        const config = readSyncConfig(db);
        const functionsUrl = String(config.firebase_functions_url || process.env.FIREBASE_FUNCTIONS_URL || '')
            .trim()
            .replace(/\/+$/, '');

        if (!functionsUrl) return null;

        const licenseKey = readLicenseKey(db);
        if (!licenseKey) return null;

        const deviceHash = getDeviceHash();

        // Step 1: Call credential exchange Cloud Function
        const authResponse = await fetch(`${functionsUrl}/authExchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, deviceHash })
        });

        if (!authResponse.ok) {
            let errorBody = {};
            try { errorBody = await authResponse.json(); } catch { /* */ }
            console.warn('[sync:credentials] Auth exchange failed:', errorBody.error || authResponse.status);
            return null;
        }

        const { customToken, schoolId } = await authResponse.json();

        // Step 2: Sign in with custom token
        const auth = getFirebaseAuth();
        const userCredential = await signInWithCustomToken(auth, customToken);
        const idToken = await userCredential.user.getIdToken();

        _cachedAuth = {
            user: userCredential.user,
            idToken,
            schoolId,
            // Firebase ID tokens expire after 1 hour; the SDK auto-refreshes them
            expiresAt: Math.floor(Date.now() / 1000) + 3600
        };

        return _cachedAuth;
    } catch (err) {
        console.warn('[sync:credentials] Credential refresh failed:', err.message);
        return null;
    }
}

async function getCredentials() {
    // Firebase SDK auto-refreshes tokens, but we still cache the schoolId and user
    if (_cachedAuth && _cachedAuth.expiresAt - Math.floor(Date.now() / 1000) > 300) {
        return _cachedAuth;
    }

    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = refreshCredentials();
    try {
        return await _refreshPromise;
    } finally {
        _refreshPromise = null;
    }
}

function clearCredentials() {
    _cachedAuth = null;
    _refreshPromise = null;
}

function isAuthenticated() {
    return _cachedAuth !== null && _cachedAuth.expiresAt - Math.floor(Date.now() / 1000) > 300;
}

async function testConnection() {
    const db = getDb();
    const config = readSyncConfig(db);

    const functionsUrl = String(config.firebase_functions_url || process.env.FIREBASE_FUNCTIONS_URL || '')
        .trim()
        .replace(/\/+$/, '');
    const licenseKey = readLicenseKey(db);

    if (!functionsUrl) {
        return { success: false, error: 'لم يتم تحديد رابط Firebase Functions بعد' };
    }
    if (!licenseKey) {
        return { success: false, error: 'لم يتم إدخال مفتاح الترخيص' };
    }

    // Step 1: Test credential exchange
    let schoolId;
    try {
        const deviceHash = getDeviceHash();
        const authRes = await fetch(`${functionsUrl}/authExchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, deviceHash })
        });
        if (!authRes.ok) {
            let body = {};
            try { body = await authRes.json(); } catch { /* */ }
            return { success: false, step: 'auth', error: body.error || `HTTP ${authRes.status}` };
        }
        const result = await authRes.json();
        schoolId = result.schoolId;

        // Step 2: Sign in and test Firestore read
        const auth = getFirebaseAuth();
        const userCredential = await signInWithCustomToken(auth, result.customToken);

        const firestoreDb = getFirestoreDb();
        const testRef = doc(firestoreDb, 'schools', schoolId);
        await getDoc(testRef);

    } catch (err) {
        return { success: false, step: 'firestore', error: err.message };
    }

    return { success: true, schoolId };
}

module.exports = { getCredentials, clearCredentials, isAuthenticated, testConnection };
```

- [ ] **Step 2: Commit**

```bash
git add main/sync/credentials.js
git commit -m "feat(sync): rewrite credentials.js — replace Cognito with Firebase Auth custom tokens"
```

---

### Task 10: Rewrite `main/sync/authority.js` — Firestore Document IDs

**Files:**
- Modify: `main/sync/authority.js`

Keep `WRITER_AUTHORITY`, `canPush()`, `getEntityType()`, `getAuthorizedTables()`. Replace `buildSortKey()` with `buildDocumentId()` that delegates to the collections module.

- [ ] **Step 1: Rewrite authority.js**

```javascript
'use strict';

const { buildDocumentId: buildDocId, getCollectionName } = require('../firebase/collections');

const WRITER_AUTHORITY = {
    students:              ['admin'],
    grades:                ['admin', 'staff'],
    absences:              ['admin', 'staff'],
    teachers:              ['admin'],
    teacher_aliases:       ['admin'],
    staff_attendance:      ['admin'],
    teacher_absences:      ['admin'],
    exams:                 ['admin'],
    exam_proctors:         ['admin'],
    exam_rooms:            ['admin'],
    tests:                 ['admin'],
    correspondence:        ['admin'],
    student_files:         ['admin'],
    student_movements:     ['admin'],
    compensation_tracking: ['admin'],
    settings:              ['admin'],
    page_visibility:       ['admin'],
    device_revocation:     ['admin']
};

const ENTITY_TYPE_REGISTRY = {
    students:              { entityType: 'student' },
    grades:                { entityType: 'grade' },
    absences:              { entityType: 'absence' },
    teachers:              { entityType: 'teacher' },
    teacher_aliases:       { entityType: 'teacher_alias' },
    staff_attendance:      { entityType: 'staff_attendance' },
    teacher_absences:      { entityType: 'teacher_absence' },
    exams:                 { entityType: 'exam' },
    exam_proctors:         { entityType: 'exam_proctor' },
    exam_rooms:            { entityType: 'exam_room' },
    tests:                 { entityType: 'test' },
    correspondence:        { entityType: 'correspondence' },
    student_files:         { entityType: 'student_file' },
    student_movements:     { entityType: 'student_movement' },
    compensation_tracking: { entityType: 'compensation' },
    settings:              { entityType: 'settings' },
    page_visibility:       { entityType: 'page_visibility' },
    device_revocation:     { entityType: 'device_revocation' }
};

function canPush(tableName, role) {
    const allowed = WRITER_AUTHORITY[tableName];
    return allowed ? allowed.includes(role) : false;
}

function getAuthorizedTables(role) {
    return Object.keys(WRITER_AUTHORITY).filter((t) => WRITER_AUTHORITY[t].includes(role));
}

function buildDocumentId(tableName, rowData) {
    return buildDocId(tableName, rowData);
}

function getEntityType(tableName) {
    return ENTITY_TYPE_REGISTRY[tableName]?.entityType || null;
}

module.exports = {
    WRITER_AUTHORITY,
    ENTITY_TYPE_REGISTRY,
    canPush,
    getAuthorizedTables,
    buildDocumentId,
    getEntityType
};
```

- [ ] **Step 2: Commit**

```bash
git add main/sync/authority.js
git commit -m "refactor(sync): rewrite authority.js — replace DynamoDB sort keys with Firestore document IDs"
```

---

### Task 11: Rewrite `main/sync/engine.js` — Firestore Push/Pull

**Files:**
- Modify: `main/sync/engine.js`

This is the largest single task. Replace all DynamoDB SDK calls with Firestore SDK calls.

- [ ] **Step 1: Replace imports and constants at top of engine.js**

Remove lines 1-2 (DynamoDB imports). Replace with:

```javascript
const { doc, setDoc, getDoc, writeBatch } = require('firebase/firestore');
const { getFirestoreDb } = require('../firebase/config');
const { getCollectionPath, buildDocumentId: buildDocId } = require('../firebase/collections');
const { logChange, logChangeBatch, pullChanges } = require('../firebase/sync-log');
```

Remove lines 10, 16-17 (SYNC_TABLE_NAME, _dynamoClient, _lastAccessKeyId).

- [ ] **Step 2: Replace `getDynamoClient()` function**

Remove the `getDynamoClient()` function (lines 81-101). It's no longer needed — Firestore client comes from `getFirestoreDb()`.

- [ ] **Step 3: Replace `buildDynamoItem()` with `buildFirestoreDoc()`**

Replace `buildDynamoItem()` (lines 155-200) with:

```javascript
function buildFirestoreDoc(db, entry, schoolId, deviceHash) {
    let parsedRowData = {};
    try {
        parsedRowData = entry.row_data ? JSON.parse(entry.row_data) : {};
    } catch (err) {
        console.warn(`[sync:push] Failed to parse row_data for entry ${entry.id}:`, err.message);
        return null;
    }

    const rowData = stripSensitiveFields(parsedRowData) || {};
    const entityType = getEntityType(entry.table_name);
    if (!entityType) {
        console.warn(`[sync:push] Unknown entity type for table '${entry.table_name}'`);
        return null;
    }

    const normalizedData = normalizeSortKeyRowData(entry, rowData);
    const documentId = buildDocumentId(entry.table_name, normalizedData);
    if (!documentId) {
        console.warn(`[sync:push] Failed to build document ID for table '${entry.table_name}'`);
        return null;
    }

    const mapping = db.prepare('SELECT version FROM sync_id_map WHERE row_sync_id = ?').get(entry.row_sync_id);
    const currentVersion = Number(mapping?.version || 0);
    const newVersion = currentVersion + 1;
    const updatedAt = Math.floor(Date.now() / 1000);

    return {
        collectionPath: getCollectionPath(schoolId, entry.table_name),
        documentId,
        entityType,
        data: normalizedData,
        version: newVersion,
        operation: entry.operation,
        rowSyncId: entry.row_sync_id,
        deviceHash: String(deviceHash || '').substring(0, 16),
        schoolYear: entry.school_year || '',
        updatedAt
    };
}
```

- [ ] **Step 4: Replace `writeBatchToDynamo()` with `writeBatchToFirestore()`**

Replace `writeBatchToDynamo()` (lines 202-237) with:

```javascript
async function writeBatchToFirestore(firestoreDb, items) {
    if (!items.length) return { success: true, failedItems: [] };

    try {
        const batch = writeBatch(firestoreDb);

        for (const item of items) {
            const docRef = doc(firestoreDb, item.collectionPath, item.documentId);
            batch.set(docRef, {
                ...item.data,
                version: item.version,
                operation: item.operation,
                rowSyncId: item.rowSyncId,
                deviceHash: item.deviceHash,
                schoolYear: item.schoolYear,
                updatedAt: item.updatedAt
            }, { merge: true });
        }

        await batch.commit();
        return { success: true, failedItems: [], isAccessDenied: false };
    } catch (err) {
        const isAccessDenied = err.code === 'permission-denied';
        return {
            success: false,
            error: err.message,
            errorName: err.code,
            isAccessDenied,
            failedItems: items
        };
    }
}
```

- [ ] **Step 5: Replace `writeItemWithCondition()` with `writeItemWithVersionCheck()`**

Replace `writeItemWithCondition()` (lines 239-269) with:

```javascript
async function writeItemWithVersionCheck(firestoreDb, item) {
    try {
        const docRef = doc(firestoreDb, item.collectionPath, item.documentId);
        const existing = await getDoc(docRef);

        if (existing.exists() && existing.data().version >= item.version) {
            return { success: false, conflict: true, error: 'Version conflict', errorName: 'VERSION_CONFLICT' };
        }

        await setDoc(docRef, {
            ...item.data,
            version: item.version,
            operation: item.operation,
            rowSyncId: item.rowSyncId,
            deviceHash: item.deviceHash,
            schoolYear: item.schoolYear,
            updatedAt: item.updatedAt
        }, { merge: true });

        return { success: true };
    } catch (err) {
        const isAccessDenied = err.code === 'permission-denied';
        return {
            success: false,
            error: err.message,
            errorName: err.code,
            isAccessDenied,
            isThrottle: false
        };
    }
}
```

- [ ] **Step 6: Update `pushDeviceRevocations()` — replace DynamoDB writes**

In `pushDeviceRevocations()` (line 271), replace the `revocationItem` construction to use Firestore format instead of DynamoDB PK/SK/GSI keys. Build a Firestore doc with `collectionPath` and `documentId`.

- [ ] **Step 7: Update `flushPreparedItems()` — use Firestore write + syncLog**

After each successful write, also log the change to the syncLog collection using `logChange()`.

- [ ] **Step 8: Update `flushSyncOutbox()` — replace `getDynamoClient()` with `getFirestoreDb()`**

In `flushSyncOutbox()` (line 586), replace:
```javascript
const docClient = getDynamoClient(awsRegion, credentials);
```
with:
```javascript
const firestoreDb = getFirestoreDb();
```

Remove references to `awsRegion`. The `credentials` object is still needed for `schoolId`.

- [ ] **Step 9: Rewrite `pullRemoteChanges()` — use syncLog instead of DynamoDB GSI**

Replace the DynamoDB GSI query (lines 847-866) with:

```javascript
const firestoreDb = getFirestoreDb();
const cursor = config.pull_cursor || '0';
const allItems = await pullChanges(firestoreDb, schoolId, Number(cursor));
```

The rest of the pull logic (mapping, conflict detection, three-way merge, local application) stays the same since the item format from syncLog matches the expected structure.

- [ ] **Step 10: Update background timer functions**

In `startSyncPushBackground()` and `startSyncPullBackground()`, replace `config.auth_lambda_url` checks with `config.firebase_functions_url` checks.

- [ ] **Step 11: Commit**

```bash
git add main/sync/engine.js
git commit -m "feat(sync): rewrite engine.js — replace DynamoDB with Firestore for push/pull sync"
```

---

### Task 12: Update `main/sync/defaults.js` — Firebase Config Env Vars

**Files:**
- Modify: `main/sync/defaults.js`

- [ ] **Step 1: Replace AWS env var references with Firebase ones**

Replace `AUTH_LAMBDA_URL` / `AWS_REGION` env vars with:
- `FIREBASE_FUNCTIONS_URL` (replaces `AUTH_LAMBDA_URL`)
- `FIREBASE_PROJECT_ID` (replaces `AWS_REGION`)
- `FIREBASE_API_KEY`

Update `getAppSyncDefaults()`, `applySyncDefaults()`, and `seedSyncDefaults()` accordingly. Replace `awsRegion` field with `firebaseProjectId`, `authLambdaUrl` with `firebaseFunctionsUrl`.

- [ ] **Step 2: Commit**

```bash
git add main/sync/defaults.js
git commit -m "refactor(sync): update defaults.js — replace AWS env vars with Firebase config"
```

---

## Phase 5: IPC & Linking Layer Updates (Day 8-10)

### Task 13: Update `main/ipc/sync.js` — Firebase Config Fields

**Files:**
- Modify: `main/ipc/sync.js`

- [ ] **Step 1: Update field map in `sync:setConfig`**

In the `fieldMap` object (line 89), replace:
```javascript
awsRegion: 'aws_region',
authLambdaUrl: 'auth_lambda_url',
```
with:
```javascript
firebaseProjectId: 'firebase_project_id',
firebaseFunctionsUrl: 'firebase_functions_url',
```

- [ ] **Step 2: Update `sync:getConfig` response**

Replace `awsRegion` and `authLambdaUrl` in the response with Firebase equivalents.

- [ ] **Step 3: Update `startSyncPushBackground` check**

In `sync:setConfig` handler, the restart logic stays the same (calls `restartSyncPushBackground()` etc.).

- [ ] **Step 4: Commit**

```bash
git add main/ipc/sync.js
git commit -m "refactor(ipc): update sync IPC handlers for Firebase config fields"
```

---

### Task 14: Update `main/ipc/linking.js` — Firebase Config in Linking

**Files:**
- Modify: `main/ipc/linking.js`

- [ ] **Step 1: Replace `getAuthLambdaUrl()` with `getFirebaseFunctionsUrl()`**

At line 382, change:
```javascript
function getAuthLambdaUrl(db) {
    const row = db.prepare('SELECT auth_lambda_url FROM sync_config WHERE id = 1').get();
    return String(row?.auth_lambda_url || process.env.AUTH_LAMBDA_URL || '').trim() || null;
}
```
to:
```javascript
function getFirebaseFunctionsUrl(db) {
    const row = db.prepare('SELECT firebase_functions_url FROM sync_config WHERE id = 1').get();
    return String(row?.firebase_functions_url || process.env.FIREBASE_FUNCTIONS_URL || '').trim() || null;
}
```

- [ ] **Step 2: Update all callers of `getAuthLambdaUrl`**

In `linking:verify-and-link` handler (line 657), replace `getAuthLambdaUrl(db)` with `getFirebaseFunctionsUrl(db)`.

In `linking:generateOtp` handler (line 777), replace `bootstrapPayload?.syncConfig?.authLambdaUrl` with `bootstrapPayload?.syncConfig?.firebaseFunctionsUrl`.

- [ ] **Step 3: Update `normalizeSyncConfig()`**

Replace `auth_lambda_url`/`authLambdaUrl` and `aws_region`/`awsRegion` field references with Firebase equivalents.

- [ ] **Step 4: Update `upsertSyncConfig()`**

Replace column names `auth_lambda_url`, `aws_region` with `firebase_functions_url`, `firebase_project_id`.

- [ ] **Step 5: Commit**

```bash
git add main/ipc/linking.js
git commit -m "refactor(linking): update linking IPC for Firebase config fields"
```

---

### Task 15: Update `main/linking/server.js` — Firebase Cloud Function URLs

**Files:**
- Modify: `main/linking/server.js`

- [ ] **Step 1: Update OTP publish endpoint**

Replace `POST {authLambdaUrl}/link/publish-otp` with `POST {functionsUrl}/publishOtp`.

- [ ] **Step 2: Update OTP verify endpoint**

Replace `POST {authLambdaUrl}/link/verify-otp` with `POST {functionsUrl}/verifyOtp`.

- [ ] **Step 3: Commit**

```bash
git add main/linking/server.js
git commit -m "refactor(linking): update server.js OTP endpoints to Firebase Cloud Functions"
```

---

### Task 16: Update `main/linking/lan.js` — Bootstrap Payload

**Files:**
- Modify: `main/linking/lan.js`

- [ ] **Step 1: Update `buildLinkBootstrapPayload()`**

Replace `awsRegion`/`authLambdaUrl` fields in the syncConfig payload with `firebaseProjectId`/`firebaseFunctionsUrl`.

- [ ] **Step 2: Commit**

```bash
git add main/linking/lan.js
git commit -m "refactor(linking): update bootstrap payload for Firebase config"
```

---

## Phase 6: Database Schema Migration (Day 10)

### Task 17: Add SQLite Migration for sync_config Column Renames

**Files:**
- Modify: `main/db/migrations.js`

- [ ] **Step 1: Add a new migration to rename/add columns**

Add a new migration (version string like `v20`) that:

1. Adds `firebase_functions_url TEXT DEFAULT ''` column to `sync_config`
2. Adds `firebase_project_id TEXT DEFAULT ''` column to `sync_config`
3. Copies existing `auth_lambda_url` value into `firebase_functions_url` (if applicable — or leave blank for fresh starts)

Use the existing `ensureColumn()` helper for idempotent column additions.

```javascript
{
    version: 'v20-firebase-sync-config',
    up(db) {
        ensureColumn(db, 'sync_config', 'firebase_functions_url', 'TEXT DEFAULT \'\'');
        ensureColumn(db, 'sync_config', 'firebase_project_id', 'TEXT DEFAULT \'\'');
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add main/db/migrations.js
git commit -m "feat(db): add migration for Firebase sync config columns"
```

---

## Phase 7: Data Migration Scripts (Day 10-11)

### Task 18: Create DynamoDB Export Script

**Files:**
- Create: `scripts/export-dynamodb.js`

- [ ] **Step 1: Write export script**

```javascript
'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');

async function exportTable(tableName, region) {
    const client = new DynamoDBClient({ region });
    const docClient = DynamoDBDocumentClient.from(client);
    const items = [];
    let lastEvaluatedKey = undefined;
    let scanCount = 0;

    do {
        const result = await docClient.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey: lastEvaluatedKey
        }));
        items.push(...result.Items);
        lastEvaluatedKey = result.LastEvaluatedKey;
        scanCount++;
        console.log(`Scan page ${scanCount}: ${result.Items.length} items (total: ${items.length})`);
    } while (lastEvaluatedKey);

    return items;
}

async function main() {
    const tableName = process.env.SYNC_TABLE_NAME || 'pencil2-sync';
    const region = process.env.AWS_REGION || 'us-east-1';
    const outputFile = path.join(__dirname, 'dynamodb-export.json');

    console.log(`Exporting ${tableName} from ${region}...`);
    const items = await exportTable(tableName, region);
    console.log(`Exported ${items.length} items`);

    fs.writeFileSync(outputFile, JSON.stringify(items, null, 2));
    console.log(`Saved to ${outputFile}`);

    // Summary by entity type
    const counts = {};
    for (const item of items) {
        const type = item.entityType || 'unknown';
        counts[type] = (counts[type] || 0) + 1;
    }
    console.log('\nEntity type counts:');
    for (const [type, count] of Object.entries(counts).sort()) {
        console.log(`  ${type}: ${count}`);
    }
}

main().catch(err => {
    console.error('Export failed:', err);
    process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/export-dynamodb.js
git commit -m "chore: add DynamoDB export script for migration"
```

---

### Task 19: Create Firestore Import Script

**Files:**
- Create: `scripts/import-firestore.js`

- [ ] **Step 1: Write import script**

```javascript
'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) {
    console.error('Set FIREBASE_SERVICE_ACCOUNT_PATH env var');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(require(path.resolve(serviceAccountPath)))
});
const db = admin.firestore();

// Map DynamoDB entity types to Firestore collection paths
const COLLECTION_MAP = {
    student: 'students',
    grade: 'grades',
    absence: 'absences',
    teacher: 'teachers',
    teacher_alias: 'teacherAliases',
    staff_attendance: 'staffAttendance',
    teacher_absence: 'teacherAbsences',
    exam: 'exams',
    exam_proctor: 'examProctors',
    exam_room: 'examRooms',
    test: 'tests',
    correspondence: 'correspondence',
    student_file: 'studentFiles',
    student_movement: 'studentMovements',
    compensation: 'compensation',
    settings: 'settings',
    page_visibility: 'pageVisibility',
    device_revocation: 'deviceRevocations'
};

async function importItems(items) {
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    // Process in batches of 500 (Firestore batch limit)
    for (let i = 0; i < items.length; i += 500) {
        const batch = db.batch();
        const chunk = items.slice(i, i + 500);

        for (const item of chunk) {
            try {
                const schoolId = item.PK.replace('SCHOOL#', '');
                const entityType = item.entityType;
                const collectionName = COLLECTION_MAP[entityType];

                if (!collectionName) {
                    skipped++;
                    continue;
                }

                // Extract document ID from SK (remove entity prefix)
                const skParts = item.SK.split('#');
                skParts.shift(); // remove entity type prefix
                const docId = skParts.join('__');

                if (!docId) {
                    skipped++;
                    continue;
                }

                const docRef = db.collection('schools').doc(schoolId)
                    .collection(collectionName).doc(docId);

                batch.set(docRef, {
                    ...(item.data || {}),
                    version: item.version || 1,
                    updatedAt: item.updatedAt || Math.floor(Date.now() / 1000),
                    rowSyncId: item.rowSyncId || '',
                    deviceHash: item.deviceHash || '',
                    schoolYear: item.schoolYear || ''
                }, { merge: true });

                // Also write to syncLog
                const changeId = `${item.updatedAt || 0}_${item.version || 1}_${entityType}_${item.rowSyncId || docId}`;
                const syncLogRef = db.collection('syncLog').doc(schoolId)
                    .collection('changes').doc(changeId);
                batch.set(syncLogRef, {
                    entityType,
                    entityId: docId,
                    operation: item.operation || 'PUT',
                    data: item.data || {},
                    version: item.version || 1,
                    deviceHash: item.deviceHash || '',
                    rowSyncId: item.rowSyncId || '',
                    schoolYear: item.schoolYear || '',
                    updatedAt: item.updatedAt || 0
                });

                imported++;
            } catch (err) {
                console.error(`Failed to import item:`, err.message);
                failed++;
            }
        }

        await batch.commit();
        console.log(`Progress: ${i + chunk.length}/${items.length} (imported: ${imported}, skipped: ${skipped}, failed: ${failed})`);
    }

    return { imported, skipped, failed };
}

async function main() {
    const inputFile = path.join(__dirname, 'dynamodb-export.json');
    if (!fs.existsSync(inputFile)) {
        console.error(`Export file not found: ${inputFile}\nRun export-dynamodb.js first.`);
        process.exit(1);
    }

    const items = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    console.log(`Importing ${items.length} items to Firestore...`);

    const result = await importItems(items);
    console.log('\nImport complete:');
    console.log(`  Imported: ${result.imported}`);
    console.log(`  Skipped:  ${result.skipped}`);
    console.log(`  Failed:   ${result.failed}`);
}

main().catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/import-firestore.js
git commit -m "chore: add Firestore import script for migration"
```

---

### Task 20: Create Migration Verification Script

**Files:**
- Create: `scripts/verify-migration.js`

- [ ] **Step 1: Write verification script**

This script compares record counts between the DynamoDB export and Firestore to ensure data integrity.

```javascript
'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
admin.initializeApp({
    credential: admin.credential.cert(require(path.resolve(serviceAccountPath)))
});
const db = admin.firestore();

async function countCollection(schoolId, collectionName) {
    const snapshot = await db.collection('schools').doc(schoolId)
        .collection(collectionName).count().get();
    return snapshot.data().count;
}

async function main() {
    const inputFile = path.join(__dirname, 'dynamodb-export.json');
    const items = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

    // Count by entity type in export
    const exportCounts = {};
    const schoolIds = new Set();
    for (const item of items) {
        const type = item.entityType || 'unknown';
        exportCounts[type] = (exportCounts[type] || 0) + 1;
        schoolIds.add(item.PK.replace('SCHOOL#', ''));
    }

    // Collection name map
    const COLL = {
        student: 'students', grade: 'grades', absence: 'absences',
        teacher: 'teachers', teacher_alias: 'teacherAliases',
        staff_attendance: 'staffAttendance', teacher_absence: 'teacherAbsences',
        exam: 'exams', exam_proctor: 'examProctors', exam_room: 'examRooms',
        test: 'tests', correspondence: 'correspondence',
        student_file: 'studentFiles', student_movement: 'studentMovements',
        compensation: 'compensation', settings: 'settings',
        page_visibility: 'pageVisibility', device_revocation: 'deviceRevocations'
    };

    console.log('Verification Report');
    console.log('='.repeat(60));

    let allMatch = true;
    for (const schoolId of schoolIds) {
        console.log(`\nSchool: ${schoolId}`);
        for (const [entityType, collName] of Object.entries(COLL)) {
            const exported = exportCounts[entityType] || 0;
            const firestoreCount = await countCollection(schoolId, collName);
            const match = exported === firestoreCount ? 'OK' : 'MISMATCH';
            if (match !== 'OK') allMatch = false;
            console.log(`  ${entityType.padEnd(20)} Export: ${exported}  Firestore: ${firestoreCount}  ${match}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(allMatch ? 'ALL COUNTS MATCH' : 'MISMATCHES DETECTED — investigate before proceeding');
}

main().catch(console.error);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/verify-migration.js
git commit -m "chore: add migration verification script"
```

---

## Phase 8: Testing & Validation (Day 11-13)

### Task 21: Integration Testing with Firebase Emulator

- [ ] **Step 1: Install Firebase Emulator**

```bash
firebase init emulators
```

Select: Firestore, Authentication, Functions

- [ ] **Step 2: Test sync push cycle**

1. Start emulators: `firebase emulators:start`
2. Set `FIRESTORE_EMULATOR_HOST=localhost:8080`
3. Set `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`
4. Run the app, configure sync pointing to emulator
5. Create a student record → verify it appears in Firestore emulator UI
6. Verify syncLog entry is created

- [ ] **Step 3: Test sync pull cycle**

1. Manually insert a document in Firestore emulator
2. Insert corresponding syncLog entry
3. Trigger pull → verify the record appears in local SQLite

- [ ] **Step 4: Test conflict resolution**

1. Create a record on device A, push
2. Modify the same record locally on device B (simulated)
3. Push device B changes → should trigger version conflict
4. Verify three-way merge runs and conflict is logged in `sync_conflicts`

- [ ] **Step 5: Test OTP linking flow**

1. Generate OTP on device A → verify it's published to Firestore `otpCodes` collection
2. Enter OTP on device B → verify Cloud Function verifies and returns encrypted payload
3. Verify bootstrap config is applied on device B

- [ ] **Step 6: Test device revocation**

1. Revoke a device → verify revocation document appears in `deviceRevocations` collection
2. On revoked device, pull → verify sync is disabled

- [ ] **Step 7: Test connection test**

1. Run `sync:testConnection` → verify it reaches Cloud Function, signs in, and pings Firestore

---

### Task 22: Smoke Test Updates

- [ ] **Step 1: Update smoke test if needed**

The IPC channel names in `preload.js` are unchanged, so the existing smoke test should still pass. Verify:

```bash
npm run test:smoke
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Fix any ESLint issues in modified files.

- [ ] **Step 3: Commit fixes**

```bash
git add -A
git commit -m "test: verify smoke tests and lint pass after Firebase migration"
```

---

## Phase 9: Cleanup & Documentation (Day 13-15)

### Task 23: Remove AWS Infrastructure Files

**Only after migration is validated in production.**

- [ ] **Step 1: Remove CDK infra files**

```bash
rm -rf infra/lib/sync-stack.ts
rm -rf infra/lib/auth-lambda/
```

- [ ] **Step 2: Remove unused AWS config references**

Clean up any remaining references to `AWS_REGION`, `COGNITO_IDENTITY_POOL_ID`, etc. in the codebase.

```bash
grep -r "aws_region\|auth_lambda_url\|COGNITO\|dynamodb\|DynamoDB" main/ --include="*.js" -l
```

Fix any remaining references found.

- [ ] **Step 3: Update `.env.example` if it exists**

Remove AWS env vars, add Firebase env vars.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove AWS infrastructure files after Firebase migration"
```

---

### Task 24: Update Environment Documentation

- [ ] **Step 1: Update CLAUDE.md environment section**

Replace AWS env var references with Firebase env vars:

```
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_SERVICE_ACCOUNT_PATH (for admin SDK / migration scripts)
FIREBASE_FUNCTIONS_URL (replaces AUTH_LAMBDA_URL)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Firebase environment variables"
```

---

## Risk Assessment (Updated)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Firestore batch limit (500 writes) vs DynamoDB (25 items) | Low | Low | Batch size in engine.js already handles chunking; Firestore's 500 limit is more generous |
| Firebase Auth token refresh in Electron | Medium | Medium | Firebase SDK handles auto-refresh; test extensively with long sessions |
| Firestore write costs (vs DynamoDB on-demand) | Low | Medium | Monitor with Firebase Console; set billing alerts |
| SyncLog query performance at scale | Medium | Medium | Composite index on `updatedAt`; pagination with 500 limit |
| Cloud Function cold starts | Low | Low | Functions run Node.js 22 on Blaze plan; keep warm with scheduled pings if needed |
| Data migration data loss | Medium | High | Export → verify counts → import → verify counts → switch; keep DynamoDB backup for 30 days |
| OTP encrypted payload size in Firestore | Low | Low | Already validated <300KB in Lambda; Firestore doc limit is 1MB |
| Firestore offline persistence not supported in Electron | Known | None | App already uses SQLite for offline; Firestore is cloud-only |

---

## Rollback Plan

### Triggers
- Sync failures > 5% of operations after cutover
- Data integrity issues detected by verification script
- Auth failures preventing any device from syncing

### Steps
1. `git revert` to pre-migration commit (or `git checkout` tagged release)
2. Rebuild and deploy the reverted app
3. Restore `sync_config` auth_lambda_url and aws_region from backup
4. DynamoDB table is untouched during migration — no restore needed
5. Resume normal operations on DynamoDB

### Safety Net
- Keep DynamoDB table active for 30 days after cutover
- Keep auth Lambda deployed for 30 days after cutover
- Tag the last pre-migration release: `git tag pre-firebase-migration`

---

## Migration Execution Checklist

```
Pre-migration:
  [ ] Firebase project created and configured
  [ ] Cloud Functions deployed and tested
  [ ] Firestore security rules deployed
  [ ] Firestore indexes created
  [ ] All code changes committed and tested locally
  [ ] App built and tested against Firebase Emulator
  [ ] DynamoDB export completed and verified
  [ ] Tag pre-migration release

Migration day:
  [ ] Announce maintenance window to users
  [ ] Freeze DynamoDB writes (disable sync on all devices)
  [ ] Run export script → verify counts
  [ ] Run import script → verify counts
  [ ] Run verification script → all counts match
  [ ] Deploy updated app to users
  [ ] Verify sync push/pull works on test device
  [ ] Verify OTP linking works between two devices
  [ ] Monitor for 24 hours

Post-migration (Day +1 to +30):
  [ ] Monitor Firestore usage/costs
  [ ] Keep DynamoDB as read-only backup
  [ ] After 30 days: delete DynamoDB table and Cognito pool
  [ ] Remove infra/ directory
  [ ] Update all documentation
```
