# Migration Plan: DynamoDB → Firebase

**Date:** 2026-04-16
**Status:** Planned
**Estimated Duration:** 9-15 days
**Risk Level:** Medium

---

## Executive Summary

**Goal:** Replace AWS DynamoDB + Cognito with Firebase Firestore + Firebase Auth for your offline-first Electron app's cloud sync backend.

**Current Architecture:**

```
Electron App → SQLite (local) → DynamoDB (cloud) + Cognito (auth)
```

**Target Architecture:**

```
Electron App → SQLite (local) → Firestore (cloud) + Firebase Auth
```

**Key Changes:**

- Remove `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`
- Add `firebase` (client SDK) + `firebase-admin` (server operations)
- Replace Cognito auth with Firebase Auth
- Rewrite sync engine (`main/sync/engine.js`, `credentials.js`)
- Migrate 17 entity types to Firestore collections

---

## Current DynamoDB Architecture

### Single-Table Design: `pencil2-sync`

| Attribute   | Type   | Key Type             | Description                               |
| ----------- | ------ | -------------------- | ----------------------------------------- |
| `PK`        | String | Partition Key (HASH) | `SCHOOL#<customerRef>` - Tenant isolation |
| `SK`        | String | Sort Key (RANGE)     | `<ENTITY_TYPE>#<compositeId>`             |
| `GSI1PK`    | String | GSI Partition Key    | Same as PK for pull queries               |
| `GSI1SK`    | String | GSI Sort Key         | `<updatedAt>#<entityType>#<entityId>`     |
| `expiresAt` | Number | TTL attribute        | Auto-delete after expiration              |

**Billing Mode:** PAY_PER_REQUEST (on-demand)
**Point-in-Time Recovery:** Enabled
**Deletion Protection:** Enabled in prod, DESTROY in dev

### Global Secondary Index: SyncGSI

- **Partition Key:** `GSI1PK` (String)
- **Sort Key:** `GSI1SK` (String)
- **Projection:** ALL attributes

### Entity Types and Sort Key Patterns

| Entity Type         | SK Pattern                                                 | Source Table            |
| ------------------- | ---------------------------------------------------------- | ----------------------- |
| `student`           | `STUDENT#<studentCode>`                                    | `students`              |
| `grade`             | `GRADE#<studentCode>#<subject>#<semester>#<schoolYear>`    | `grades`                |
| `absence`           | `ABSENCE#<studentCode>#<month>#<schoolYear>#<absenceType>` | `absences`              |
| `teacher`           | `TEACHER#<teacherId>`                                      | `teachers`              |
| `teacher_alias`     | `TEACHER_ALIAS#<aliasId>`                                  | `teacher_aliases`       |
| `staff_attendance`  | `STAFF_ATTENDANCE#<teacherId>#<date>`                      | `staff_attendance`      |
| `teacher_absence`   | `TEACHER_ABSENCE#<teacherId>#<date>`                       | `teacher_absences`      |
| `exam`              | `EXAM#<examId>`                                            | `exams`                 |
| `exam_proctor`      | `EXAM_PROCTOR#<examId>#<teacherId>`                        | `exam_proctors`         |
| `exam_room`         | `EXAM_ROOM#<examId>#<roomId>`                              | `exam_rooms`            |
| `test`              | `TEST#<testId>`                                            | `tests`                 |
| `correspondence`    | `CORRESPONDENCE#<correspondenceId>`                        | `correspondence`        |
| `student_file`      | `STUDENT_FILE#<studentCode>#<fileId>`                      | `student_files`         |
| `student_movement`  | `STUDENT_MOVEMENT#<movementId>`                            | `student_movements`     |
| `compensation`      | `COMPENSATION#<trackingId>`                                | `compensation_tracking` |
| `settings`          | `SETTINGS#<settingKey>`                                    | `settings`              |
| `page_visibility`   | `PAGE_VISIBILITY#<pageKey>`                                | `page_visibility`       |
| `device_revocation` | `REVOCATION#<revokedDeviceHash>`                           | N/A (DynamoDB-only)     |

### Write Contract (Push)

Every item written includes:

```json
{
  "PK": "SCHOOL#<customerRef>",
  "SK": "<ENTITY_TYPE>#<compositeId>",
  "GSI1PK": "SCHOOL#<customerRef>",
  "GSI1SK": "<updatedAt>#<entityType>#<entityId>",
  "entityType": "<lowercase-entity-name>",
  "schoolYear": "<year/year>",
  "updatedAt": 1710000000,
  "version": 1,
  "operation": "PUT|DEL",
  "rowSyncId": "<deviceHash>:<table_name>:<local_id>",
  "deviceHash": "<first-16-chars-of-device-hash>",
  "data": { ... },
  "expiresAt": 1712592000
}
```

### Read Contract (Pull via GSI)

```
Query SyncGSI
  KeyConditionExpression: GSI1PK = :schoolPk AND GSI1SK > :lastSyncTimestamp
  Limit: 500
  ScanIndexForward: true
```

### Conditional Write (Conflict Prevention)

```
ConditionExpression: attribute_not_exists(version) OR version < :newVersion
```

---

## Firestore Collection Structure

### Design Principles

1. **Tenant Isolation:** Use `schools/{schoolId}` as the path prefix
2. **Composite SK Patterns:** Flatten into document IDs using `__` separators
3. **Timestamp-based Sync:** Dedicated `syncLog` collection with timestamp ordering
4. **Version-based Conflict Resolution:** `version` field with conditional writes
5. **TTL/Expiration:** `ttl` field (Firestore TTL feature)

### Collection Structure by Entity Type

#### 1. students → `schools/{schoolId}/students/{studentCode}`

| DynamoDB                  | Firestore                                 |
| ------------------------- | ----------------------------------------- |
| PK: SCHOOL#<customerRef>  | Collection: `schools/{schoolId}/students` |
| SK: STUDENT#<studentCode> | Document ID: `{studentCode}`              |

**Document Structure:**

```json
{
    "_id": "12345",
    "studentCode": "12345",
    "firstName": "...",
    "lastName": "...",
    "massarCode": "M123456",
    "schoolYear": "2025/2026",
    "status": "active",
    "createdAt": "2025-01-15T08:00:00Z",
    "updatedAt": "2025-03-20T14:30:00Z",
    "version": 5,
    "syncId": "deviceHash:students:12345"
}
```

---

#### 2. grades → `schools/{schoolId}/grades/{studentCode}__{subject}__{semester}__{schoolYear}`

| DynamoDB                                                  | Firestore                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| SK: GRADE#<studentCode>#<subject>#<semester>#<schoolYear> | Document ID: `{studentCode}__{subject}__{semester}__{schoolYear}` |

**Document Structure:**

```json
{
    "_id": "12345__math__S1__2025/2026",
    "studentCode": "12345",
    "subject": "math",
    "semester": "S1",
    "schoolYear": "2025/2026",
    "grade": 85,
    "teacherId": "t-001",
    "updatedAt": "...",
    "version": 2,
    "syncId": "deviceHash:grades:567"
}
```

---

#### 3. absences → `schools/{schoolId}/absences/{studentCode}__{month}__{schoolYear}__{absenceType}`

| DynamoDB                                                     | Firestore                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| SK: ABSENCE#<studentCode>#<month>#<schoolYear>#<absenceType> | Document ID: `{studentCode}__{month}__{schoolYear}__{absenceType}` |

---

#### 4. teachers → `schools/{schoolId}/teachers/{teacherId}`

| DynamoDB                | Firestore                  |
| ----------------------- | -------------------------- |
| SK: TEACHER#<teacherId> | Document ID: `{teacherId}` |

---

#### 5. teacher_aliases → `schools/{schoolId}/teacherAliases/{aliasId}`

| DynamoDB                    | Firestore                |
| --------------------------- | ------------------------ |
| SK: TEACHER_ALIAS#<aliasId> | Document ID: `{aliasId}` |

---

#### 6. staff_attendance → `schools/{schoolId}/staffAttendance/{teacherId}__{date}`

| DynamoDB                                | Firestore                          |
| --------------------------------------- | ---------------------------------- |
| SK: STAFF_ATTENDANCE#<teacherId>#<date> | Document ID: `{teacherId}__{date}` |

---

#### 7. teacher_absences → `schools/{schoolId}/teacherAbsences/{teacherId}__{date}`

| DynamoDB                               | Firestore                          |
| -------------------------------------- | ---------------------------------- |
| SK: TEACHER_ABSENCE#<teacherId>#<date> | Document ID: `{teacherId}__{date}` |

---

#### 8. exams → `schools/{schoolId}/exams/{examId}`

| DynamoDB          | Firestore               |
| ----------------- | ----------------------- |
| SK: EXAM#<examId> | Document ID: `{examId}` |

---

#### 9. exam_proctors → `schools/{schoolId}/examProctors/{examId}__{teacherId}`

| DynamoDB                              | Firestore                            |
| ------------------------------------- | ------------------------------------ |
| SK: EXAM_PROCTOR#<examId>#<teacherId> | Document ID: `{examId}__{teacherId}` |

---

#### 10. exam_rooms → `schools/{schoolId}/examRooms/{examId}__{roomId}`

| DynamoDB                        | Firestore                         |
| ------------------------------- | --------------------------------- |
| SK: EXAM_ROOM#<examId>#<roomId> | Document ID: `{examId}__{roomId}` |

---

#### 11. tests → `schools/{schoolId}/tests/{testId}`

| DynamoDB          | Firestore               |
| ----------------- | ----------------------- |
| SK: TEST#<testId> | Document ID: `{testId}` |

---

#### 12. correspondence → `schools/{schoolId}/correspondence/{correspondenceId}`

| DynamoDB                              | Firestore                         |
| ------------------------------------- | --------------------------------- |
| SK: CORRESPONDENCE#<correspondenceId> | Document ID: `{correspondenceId}` |

---

#### 13. student_files → `schools/{schoolId}/studentFiles/{studentCode}__{fileId}`

| DynamoDB                                | Firestore                              |
| --------------------------------------- | -------------------------------------- |
| SK: STUDENT_FILE#<studentCode>#<fileId> | Document ID: `{studentCode}__{fileId}` |

---

#### 14. student_movements → `schools/{schoolId}/studentMovements/{movementId}`

| DynamoDB                          | Firestore                   |
| --------------------------------- | --------------------------- |
| SK: STUDENT_MOVEMENT#<movementId> | Document ID: `{movementId}` |

---

#### 15. compensation_tracking → `schools/{schoolId}/compensation/{trackingId}`

| DynamoDB                      | Firestore                   |
| ----------------------------- | --------------------------- |
| SK: COMPENSATION#<trackingId> | Document ID: `{trackingId}` |

---

#### 16. settings → `schools/{schoolId}/settings/{settingKey}`

| DynamoDB                  | Firestore                   |
| ------------------------- | --------------------------- |
| SK: SETTINGS#<settingKey> | Document ID: `{settingKey}` |

---

#### 17. page_visibility → `schools/{schoolId}/pageVisibility/{pageKey}`

| DynamoDB                      | Firestore                |
| ----------------------------- | ------------------------ |
| SK: PAGE_VISIBILITY#<pageKey> | Document ID: `{pageKey}` |

---

#### 18. device_revocation → `schools/{schoolId}/deviceRevocations/{revokedDeviceHash}`

| DynamoDB                           | Firestore                          |
| ---------------------------------- | ---------------------------------- |
| SK: REVOCATION#<revokedDeviceHash> | Document ID: `{revokedDeviceHash}` |

---

#### 19. OTP → `otpCodes/{massarCode}`

**DynamoDB:** PK: `OTP#<massar>`, SK: `ACTIVE`
**Firestore:** Root-level collection (OTP is institution-wide, not school-specific)

**Document Structure:**

```json
{
    "_id": "SCHOOL123",
    "massarCode": "SCHOOL123",
    "otpHash": "scrypt_hash...",
    "encryptedPayload": "...",
    "iv": "...",
    "authTag": "...",
    "status": "active",
    "failureCount": 0,
    "publishedBy": "device_hash...",
    "expiresAt": "2025-09-20T10:10:00Z",
    "createdAt": "2025-09-20T10:00:00Z"
}
```

---

## SyncLog Collection (Equivalent to GSI1SK Range Query)

To support timestamp-based sync queries (equivalent to DynamoDB's GSI1SK range query):

**Collection:** `syncLog/{schoolId}/changes`

**Document ID Format:** `{updatedAt}_{version}_{entityType}_{rowSyncId}`

**Document Structure:**

```json
{
    "_id": "1710000000_5_student_abc123:students:12345",
    "schoolId": "SCHOOL123",
    "entityType": "student",
    "entityId": "12345",
    "operation": "PUT",
    "rowSyncId": "abc123:students:12345",
    "deviceHash": "abc123",
    "updatedAt": 1710000000,
    "version": 5,
    "data": {
        /* entity data snapshot */
    },
    "ttl": "2025-04-25T00:00:00Z"
}
```

**Query Pattern for Sync:**

```javascript
// Equivalent to: GSI1PK = :schoolPk AND GSI1SK > :cursor
db.collection('syncLog')
    .doc(schoolId)
    .collection('changes')
    .where('updatedAt', '>', lastSyncTimestamp)
    .orderBy('updatedAt')
    .limit(500)
    .get();
```

---

## Composite ID Mapping Summary

| Entity Type       | DynamoDB SK Pattern                                        | Firestore Document ID                                 |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| student           | `STUDENT#<studentCode>`                                    | `{studentCode}`                                       |
| grade             | `GRADE#<studentCode>#<subject>#<semester>#<schoolYear>`    | `{studentCode}__{subject}__{semester}__{schoolYear}`  |
| absence           | `ABSENCE#<studentCode>#<month>#<schoolYear>#<absenceType>` | `{studentCode}__{month}__{schoolYear}__{absenceType}` |
| teacher           | `TEACHER#<teacherId>`                                      | `{teacherId}`                                         |
| teacher_alias     | `TEACHER_ALIAS#<aliasId>`                                  | `{aliasId}`                                           |
| staff_attendance  | `STAFF_ATTENDANCE#<teacherId>#<date>`                      | `{teacherId}__{date}`                                 |
| teacher_absence   | `TEACHER_ABSENCE#<teacherId>#<date>`                       | `{teacherId}__{date}`                                 |
| exam              | `EXAM#<examId>`                                            | `{examId}`                                            |
| exam_proctor      | `EXAM_PROCTOR#<examId>#<teacherId>`                        | `{examId}__{teacherId}`                               |
| exam_room         | `EXAM_ROOM#<examId>#<roomId>`                              | `{examId}__{roomId}`                                  |
| test              | `TEST#<testId>`                                            | `{testId}`                                            |
| correspondence    | `CORRESPONDENCE#<correspondenceId>`                        | `{correspondenceId}`                                  |
| student_file      | `STUDENT_FILE#<studentCode>#<fileId>`                      | `{studentCode}__{fileId}`                             |
| student_movement  | `STUDENT_MOVEMENT#<movementId>`                            | `{movementId}`                                        |
| compensation      | `COMPENSATION#<trackingId>`                                | `{trackingId}`                                        |
| settings          | `SETTINGS#<settingKey>`                                    | `{settingKey}`                                        |
| page_visibility   | `PAGE_VISIBILITY#<pageKey>`                                | `{pageKey}`                                           |
| device_revocation | `REVOCATION#<revokedDeviceHash>`                           | `{revokedDeviceHash}`                                 |
| OTP               | `OTP#<massar>` / SK: `ACTIVE`                              | `{massarCode}` (in `otpCodes` collection)             |

---

## Phase 1: Environment Setup & Firebase Configuration

### 1.1 Create Firebase Project

1. Create Firebase project via Firebase Console
2. Enable: Firestore, Firebase Auth, Hosting (optional)
3. Download service account key for admin SDK

### 1.2 Install Dependencies

```bash
npm uninstall @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cognito-identity
npm install firebase firebase-admin
```

### 1.3 Firebase Configuration

**New file:** `main/firebase/config.js`

```javascript
const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator } = require('firebase/firestore');
const { getAuth, connectAuthEmulator } = require('firebase/auth');

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

if (process.env.FIRESTORE_EMULATOR_HOST) {
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectAuthEmulator(auth, 'http://localhost:9099');
}

module.exports = { app, db, auth };
```

### 1.4 Environment Variables

**Remove:**

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- `COGNITO_IDENTITY_POOL_ID`
- `DEVELOPER_PROVIDER_NAME`
- `SYNC_TABLE_NAME`

**Add:**

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_SERVICE_ACCOUNT_PATH` (for admin SDK)

---

## Phase 2: Firestore Security Rules

Deploy security rules for tenant isolation:

```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() {
      return request.auth != null;
    }

    function belongsToSchool(schoolId) {
      return isAuthenticated() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.schoolId == schoolId;
    }

    function isNewerVersion() {
      return request.resource.data.version > resource.data.version;
    }

    match /schools/{schoolId} {
      allow read: if belongsToSchool(schoolId);

      match /students/{studentCode} {
        allow read, write: if belongsToSchool(schoolId) && (isNewerVersion() || !resource.exists);
      }
      // ... add rules for all subcollections

      match /grades/{docId} {
        allow read, write: if belongsToSchool(schoolId) && (isNewerVersion() || !resource.exists);
      }
      match /absences/{docId} {
        allow read, write: if belongsToSchool(schoolId) && (isNewerVersion() || !resource.exists);
      }
      match /teachers/{docId} {
        allow read, write: if belongsToSchool(schoolId) && (isNewerVersion() || !resource.exists);
      }
      // ... continue for all entity types
    }

    match /syncLog/{schoolId}/changes/{changeId} {
      allow read: if belongsToSchool(schoolId);
      allow write: if false; // Server-only
    }

    match /otpCodes/{massarCode} {
      allow read: if isAuthenticated();
      allow write: if false; // Via Cloud Function only
    }
  }
}
```

### Required Firestore Indexes

Create composite indexes for common query patterns:

| Collection                    | Fields                        |
| ----------------------------- | ----------------------------- |
| `schools/{schoolId}/grades`   | studentCode, schoolYear       |
| `schools/{schoolId}/grades`   | subject, semester, schoolYear |
| `schools/{schoolId}/absences` | studentCode, schoolYear       |
| `syncLog/{schoolId}/changes`  | updatedAt, entityType         |

---

## Phase 3: Code Migration by File

### 3.1 New Files to Create

| File                           | Purpose                                               |
| ------------------------------ | ----------------------------------------------------- |
| `main/firebase/config.js`      | Firebase initialization                               |
| `main/firebase/admin.js`       | firebase-admin setup for privileged ops               |
| `main/firebase/collections.js` | Collection path constants (mapping from authority.js) |
| `main/firebase/sync-log.js`    | SyncLog management for pull queries                   |
| `main/sync/firebase-engine.js` | New sync engine for Firestore                         |
| `main/auth/firebase-auth.js`   | Firebase Auth handlers                                |

### 3.2 Files to Modify

| File                       | Changes                                                   |
| -------------------------- | --------------------------------------------------------- |
| `main/sync/engine.js`      | Replace DynamoDB calls with Firestore SDK                 |
| `main/sync/credentials.js` | Replace Cognito auth with Firebase Auth                   |
| `main/sync/authority.js`   | Update collection paths, keep entity registry             |
| `main/sync/capture.js`     | Update channel registry, no changes to sync capture logic |
| `preload.js`               | Add Firebase Auth IPC handlers                            |
| `package.json`             | Remove AWS SDKs, add Firebase packages                    |

### 3.3 Files to Remove

- `infra/lib/sync-stack.ts` (CDK stack - no longer needed)
- `infra/lib/auth-lambda/index.js` (Auth Lambda - replaced by Firebase Auth)
- `infra/lib/auth-lambda/schema-constants.js` (replaced by `main/firebase/collections.js`)

---

## Phase 4: Sync Engine Mapping

### 4.1 DynamoDB → Firestore Operation Mapping

| DynamoDB Operation          | Firestore Equivalent                  |
| --------------------------- | ------------------------------------- |
| `BatchWriteCommand`         | `writeBatch()`                        |
| `PutCommand` with condition | `setDoc()` with `merge` + transaction |
| `QueryCommand` (GSI)        | `getDocs()` with query constraints    |
| `GetCommand`                | `getDoc()`                            |
| `UpdateCommand`             | `updateDoc()`                         |

### 4.2 Core Functions to Rewrite

| Function                   | New Implementation                 |
| -------------------------- | ---------------------------------- |
| `writeBatchToDynamo()`     | `writeBatchToFirestore()`          |
| `writeItemWithCondition()` | `writeItemWithVersionCheck()`      |
| `buildDynamoItem()`        | `buildFirestoreDoc()`              |
| `pullRemoteChanges()`      | `pullRemoteChangesFromFirestore()` |
| `testConnection()`         | `testFirestoreConnection()`        |

### 4.3 SyncLog Strategy

Since Firestore doesn't have native GSI equivalent, maintain a `syncLog` collection:

```javascript
// Write sync log entry when document changes
async function logChange(schoolId, entityType, entityId, operation, data, version) {
    const changeId = `${Date.now()}_${version}_${entityType}_${entityId}`;
    await setDoc(doc(db, 'syncLog', schoolId, 'changes', changeId), {
        entityType,
        entityId,
        operation,
        data,
        version,
        updatedAt: Timestamp.now(),
        ttl: addDays(new Date(), 30)
    });
}

// Pull changes (equivalent to GSI query)
async function pullChanges(schoolId, lastSyncTimestamp) {
    const q = query(
        collection(db, 'syncLog', schoolId, 'changes'),
        where('updatedAt', '>', lastSyncTimestamp),
        orderBy('updatedAt'),
        limit(500)
    );
    return getDocs(q);
}
```

---

## Phase 5: Authentication Migration

### 5.1 Firebase Auth Setup

**Replace Cognito flow:**

```
Old: Cognito Identity Pool → Temporary AWS credentials → DynamoDB
New: Firebase Auth ID Token → Firestore Rules (validate schoolId)
```

### 5.2 Auth Flow Changes

**`main/sync/credentials.js` changes:**

- Replace `fromCognitoIdentity()` with Firebase Auth `signInWithEmailAndPassword()`
- Store Firebase ID token instead of AWS credentials
- Token refresh handled automatically by Firebase SDK

### 5.3 OTP Migration

**DynamoDB:** `PK: OTP#<massar>, SK: ACTIVE`
**Firestore:** `otpCodes/{massarCode}`

**Auth Lambda → Cloud Function:**

```javascript
// functions/otp/onPublishOTP.js
exports.onPublishOTP = functions.https.onCall(async (data, context) => {
    const { massarCode, otpHash, encryptedPayload } = data;
    await setDoc(doc(db, 'otpCodes', massarCode), {
        status: 'active',
        otpHash,
        encryptedPayload,
        expiresAt: Timestamp.fromDate(addMinutes(new Date(), 10)),
        failureCount: 0
    });
});
```

---

## Phase 6: Data Migration Strategy

### 6.1 Option A: Big Bang Migration (Recommended)

1. Freeze writes to DynamoDB
2. Export all data to JSON
3. Transform to Firestore document format
4. Import to Firestore
5. Switch app to use Firestore
6. Delete DynamoDB table

**Pros:** Simple, no dual-write complexity
**Cons:** Requires downtime

### 6.2 Export Script

```javascript
// scripts/export-dynamodb.js
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

async function exportTable(tableName) {
    const client = new DynamoDBClient({ region: 'us-east-1' });
    const docClient = DynamoDBDocumentClient.from(client);
    const items = [];
    let lastEvaluatedKey = undefined;

    do {
        const result = await docClient.send(
            new ScanCommand({
                TableName: tableName,
                ExclusiveStartKey: lastEvaluatedKey
            })
        );
        items.push(...result.Items);
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items;
}
```

### 6.3 Transform & Import Script

```javascript
// scripts/import-firestore.js
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

async function importEntity(entityData) {
    const { PK, SK, data, version, updatedAt, expiresAt } = entityData;
    const [prefix, schoolId] = PK.split('#');
    const [entityType, ...compositeId] = SK.split('#');

    const collectionPath = getCollectionPath(schoolId, entityType);
    const docId = compositeId.join('__');

    await setDoc(doc(db, collectionPath, docId), {
        ...data,
        version,
        updatedAt: Timestamp.fromMillis(updatedAt * 1000),
        ttl: expiresAt ? Timestamp.fromMillis(expiresAt * 1000) : null
    });
}
```

---

## Phase 7: Testing Strategy

### 7.1 Unit Tests

- Mock Firestore SDK for sync engine tests
- Test version conflict resolution logic
- Test composite ID building

### 7.2 Integration Tests

- Use Firebase Emulator Suite (Firestore + Auth)
- Run full sync cycles: push/pull
- Test conflict scenarios

### 7.3 Test Checklist

- [ ] Sync a new student (push)
- [ ] Pull changes from another device
- [ ] Conflict resolution (version check)
- [ ] TTL expiration
- [ ] Auth token refresh
- [ ] Offline queue rehydration
- [ ] OTP flow

---

## Phase 8: Rollback Plan

### 8.1 Rollback Triggers

- Sync failures > 5% of operations
- Data integrity issues detected
- Auth failures preventing login

### 8.2 Rollback Steps

1. Revert app to previous version (use git tags)
2. Disable Firebase SDK in app
3. Re-enable DynamoDB table (restore from backup if needed)
4. Clear any Firestore-written data (if switching back)
5. Resume normal operations

### 8.3 Dual-Write Option (For Advanced Rollback)

```javascript
// Enable dual-write during transition
async function dualWrite(entity, data) {
    await writeToDynamo(entity, data);
    await writeToFirestore(entity, data);
}
```

---

## Timeline Estimation

| Phase                     | Effort        | Risk   |
| ------------------------- | ------------- | ------ |
| Phase 1-2: Setup          | 1-2 days      | Low    |
| Phase 3: Core sync engine | 3-5 days      | Medium |
| Phase 4: Auth migration   | 2-3 days      | Medium |
| Phase 5: Data migration   | 1-2 days      | High   |
| Phase 6-7: Testing        | 2-3 days      | Medium |
| **Total**                 | **9-15 days** |        |

---

## Risk Assessment

| Risk                                          | Likelihood | Impact | Mitigation                     |
| --------------------------------------------- | ---------- | ------ | ------------------------------ |
| Firestore query performance for sync          | Medium     | Medium | Index optimization, pagination |
| Auth token refresh issues                     | Low        | High   | Extensive testing              |
| Data transformation errors                    | Medium     | High   | Validate with checksum         |
| Firebase cost unexpected                      | Low        | Medium | Set budgets & alerts           |
| Offline persistence not supported in Electron | Known      | Low    | Already using SQLite locally   |

---

## Key Decision Points

1. **SyncLog collection:** Firestore has no native equivalent to GSI for timestamp range queries. The `syncLog` collection is the standard pattern. Performance is acceptable for typical sync volumes.

2. **Security rules vs. backend validation:** Using Firestore security rules for tenant isolation is sufficient. No backend middleware needed.

3. **Firebase Auth vs. Custom JWT:** Firebase Auth recommended for simplicity. Your existing Cognito auth can be phased out.

4. **OTP handling:** Move from DynamoDB TTL to Cloud Function + Firestore for OTP verification.

---

## Files Summary

### To Be Created

```
main/firebase/
  config.js           # Firebase initialization
  admin.js            # firebase-admin setup
  collections.js      # Collection path constants
  sync-log.js         # SyncLog management

main/sync/
  firebase-engine.js  # New Firestore sync engine

main/auth/
  firebase-auth.js    # Firebase Auth handlers

scripts/
  export-dynamodb.js  # Export data from DynamoDB
  import-firestore.js # Import data to Firestore
```

### To Be Modified

```
main/sync/
  engine.js           # Replace DynamoDB with Firestore SDK
  credentials.js      # Replace Cognito with Firebase Auth
  authority.js        # Update collection paths
  capture.js          # Update channel registry (minor changes)

preload.js            # Add Firebase Auth IPC handlers
package.json          # Update dependencies
```

### To Be Deleted

```
infra/lib/sync-stack.ts                  # CDK stack
infra/lib/auth-lambda/index.js           # Auth Lambda
infra/lib/auth-lambda/schema-constants.js
```

---

## Environment-Specific Notes

### Electron Integration

**Firebase SDK in Electron:**

- Use browser build of Firebase SDK in renderer process
- Use `firebase-admin` in main process for privileged operations
- Offline persistence is NOT supported in Electron (already using SQLite)
- Implement memory caching instead of IndexedDB persistence

```javascript
// Ensure browser build is used in webpack/renderer
module.exports = {
    target: 'web' // Not 'electron'
    // ...
};
```

### Known Issues

1. **Auth state persistence** - May need to re-authenticate after app restart
2. **Transactions** - Avoid large transactions, split into batch operations
3. **Query hanging** - Use appropriate pagination limits

---

## Post-Migration Cleanup

1. Remove DynamoDB table (after confirming Firestore is working)
2. Remove Cognito identity pool
3. Delete auth lambda function
4. Remove CDK stack
5. Update documentation with new architecture
6. Archive old AWS-related configs
