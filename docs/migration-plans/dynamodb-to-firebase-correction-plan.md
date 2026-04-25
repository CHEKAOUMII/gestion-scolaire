# Correction Plan: DynamoDB to Firebase Migration

**Date:** 2026-04-18  
**Status:** Required before Firebase cutover  
**Priority:** High

---

## Purpose

This document corrects the gap between the planned Firebase migration and the current implementation.

The current codebase is still wired to:

- DynamoDB for push/pull sync
- Cognito for cloud credentials
- Lambda-style OTP endpoints for server linking
- AWS-shaped sync configuration fields in SQLite and IPC

Firebase cutover should **not** happen until the items below are completed and validated.

---

## Current Reality

### Confirmed gaps

- `package.json` still depends on `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, and `@aws-sdk/client-cognito-identity`.
- `main/sync/engine.js` still builds DynamoDB items, writes to `pencil2-sync`, and pulls from `SyncGSI`.
- `main/sync/credentials.js` still calls `/auth`, exchanges for Cognito credentials, and tests DynamoDB connectivity.
- `main/sync/defaults.js`, `main/ipc/sync.js`, `main/ipc/linking.js`, and `main/linking/lan.js` still use `auth_lambda_url` and `aws_region`.
- `main/linking/server.js` still posts to `/link/publish-otp` and `/link/verify-otp`.
- `main/db/migrations.js` does not yet add Firebase sync config columns.
- A Firebase admin service-account JSON exists in `firebase/` and is not ignored by `.gitignore`.

### Resulting risk

If the backend has already moved to Firebase while the app remains in this state:

- sync push will fail
- sync pull will fail
- connection tests will report the wrong backend behavior
- OTP server linking will fail
- linked-device bootstrap payloads will carry the wrong config fields
- credentials may be exposed accidentally if the service-account file is committed or packaged

---

## Correction Strategy

Work in this order:

1. Secure secrets and stop accidental leakage.
2. Add Firebase configuration support alongside existing data.
3. Replace auth and sync internals.
4. Replace OTP server-linking endpoints and payloads.
5. Validate with emulator and smoke checks.
6. Remove old AWS code only after Firebase is proven.

---

## Phase 1: Immediate Safety Fixes

### 1.1 Protect Firebase service-account credentials

- Add `firebase/service-account.json` and `firebase/*adminsdk*.json` to `.gitignore`.
- Remove any tracked service-account JSON from the repository history or at minimum from the current worktree.
- Verify Electron build inputs do not package service-account files.
- Prefer `FIREBASE_SERVICE_ACCOUNT_PATH` pointing outside the repo when possible.

### 1.2 Freeze misleading migration assumptions

- Mark the current Firebase migration as incomplete in docs.
- Do not remove AWS infra or DynamoDB dependencies yet.
- Do not switch production config defaults to Firebase until desktop sync and linking are tested end-to-end.

---

## Phase 2: SQLite and Config Shape Migration

### Goal

Allow the app to store and transport Firebase config without breaking existing installs.

### Required changes

- Add a new migration in `main/db/migrations.js`:
  - `firebase_functions_url TEXT DEFAULT ''`
  - `firebase_project_id TEXT DEFAULT ''`
- Keep legacy `auth_lambda_url` and `aws_region` temporarily during transition.
- Update `main/sync/defaults.js` to support:
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_FUNCTIONS_URL`
  - optionally `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID`
- Update `main/ipc/sync.js`:
  - read and write `firebaseProjectId`
  - read and write `firebaseFunctionsUrl`
  - stop presenting AWS-only config as the active shape
- Update `main/ipc/linking.js` normalization and upsert logic to prefer Firebase fields.
- Update `main/linking/lan.js` bootstrap payload so linked devices receive Firebase config.

### Acceptance criteria

- `sync:getConfig` returns Firebase fields.
- `sync:setConfig` persists Firebase fields.
- linking bootstrap payload includes Firebase fields.
- fresh and upgraded databases both work.

---

## Phase 3: Firebase Client and Admin Modules

### Goal

Introduce clean Firebase initialization before rewriting the sync engine.

### Required files

- `main/firebase/config.js`
- `main/firebase/admin.js`
- `main/firebase/collections.js`
- optionally `main/firebase/sync-log.js`

### Required behavior

- initialize Firebase app once
- expose Firestore and Firebase Auth instances
- support emulator env vars
- centralize collection names and Firestore document ID builders

### Acceptance criteria

- modules load without crashing when env vars are absent
- emulator mode works locally
- sync code can consume collection/doc builders instead of DynamoDB key builders

---

## Phase 4: Replace Cognito Auth With Firebase Auth

### Goal

Stop requesting Cognito credentials and authenticate against Firebase instead.

### Required changes in `main/sync/credentials.js`

- remove Cognito imports and temp-credential exchange
- replace `/auth` contract with Firebase-compatible sign-in flow
- if using custom tokens:
  - call Firebase Function
  - receive custom token
  - sign in with Firebase Auth
- replace DynamoDB ping in `testConnection()` with:
  - function reachability check
  - Firebase Auth success
  - Firestore read/write ping or read-only probe

### Acceptance criteria

- no `CognitoIdentityClient` usage remains
- no AWS credential cache remains
- `sync:testConnection` validates Firebase path only

---

## Phase 5: Rewrite Sync Engine for Firestore

### Goal

Replace the DynamoDB engine without changing the SQLite-first architecture.

### Required changes in `main/sync/engine.js`

- replace `DynamoDBClient` and document client with Firestore access
- replace `buildDynamoItem()` with Firestore doc payload builder
- replace `buildSortKey()` usage with Firestore document ID builders
- replace `writeBatchToDynamo()` with Firestore batch writes
- replace conditional `PutCommand` logic with transaction/version-check logic
- replace `SyncGSI` pull query with `syncLog/{schoolId}/changes`
- replace push/pull startup guards that currently require `auth_lambda_url`

### Important constraint

Do not change:

- outbox capture design
- merge logic
- snapshot logic
- conflict table semantics

### Acceptance criteria

- push writes entity documents and sync-log entries to Firestore
- pull reads sync-log entries and applies them locally
- device revocations still sync and disable revoked devices
- conflict handling still records into `sync_conflicts`

---

## Phase 6: Replace OTP Cloud Linking

### Goal

Move server-based OTP publish/verify from Lambda URLs to Firebase Functions.

### Required changes

- update `main/linking/server.js`
  - replace `/link/publish-otp` with Firebase Function endpoint
  - replace `/link/verify-otp` with Firebase Function endpoint
- update `main/ipc/linking.js`
  - replace `getAuthLambdaUrl()` with `getFirebaseFunctionsUrl()`
  - use Firebase field names through verification and OTP generation flows
- keep LAN linking intact
- keep encrypted payload behavior intact unless backend contract requires a change

### Acceptance criteria

- OTP publish succeeds against Firebase Functions
- OTP verify returns the expected payload
- linked device setup imports Firebase sync config successfully

---

## Phase 7: Package and Dependency Cleanup

### After Firebase path is proven

- remove AWS SDK dependencies from `package.json`
- add `firebase` and `firebase-admin`
- add Firebase project files:
  - `firebase/firebase.json`
  - `firebase/.firebaserc`
  - functions code if stored in repo
- remove old AWS-specific env references from docs and defaults

### Do not do yet

- do not delete `infra/`
- do not remove Lambda/Cognito assumptions from old data until validation passes

---

## Phase 8: Validation Plan

### Local verification

- `npm.cmd run lint`
- `npm.cmd run test:smoke`
- add or run Firebase emulator tests for:
  - push cycle
  - pull cycle
  - conflict resolution
  - device revocation
  - OTP publish
  - OTP verify
  - connection test

### Current known repo issue

`npm.cmd run test:smoke` currently fails for an unrelated existing issue:

- `staff-attendance.html` still contains an inline `<style>` block

That should be tracked separately so it does not confuse Firebase migration validation.

### Release gate

Do not declare migration complete until:

- sync push works against Firestore
- sync pull works against Firestore
- OTP linking works against Firebase Functions
- revocation works
- upgraded databases persist Firebase config correctly
- no service-account secret is tracked or packaged

---

## Task Checklist

- [ ] Ignore and remove Firebase service-account files from repo-managed paths
- [ ] Add SQLite migration for Firebase sync config columns
- [ ] Update sync defaults to Firebase env vars and field names
- [ ] Update sync IPC config shape to Firebase
- [ ] Update linking normalization, persistence, and bootstrap payload
- [ ] Add `main/firebase/config.js`
- [ ] Add `main/firebase/admin.js`
- [ ] Add `main/firebase/collections.js`
- [ ] Replace Cognito auth flow in `main/sync/credentials.js`
- [ ] Replace DynamoDB sync engine in `main/sync/engine.js`
- [ ] Replace OTP server endpoints in `main/linking/server.js`
- [ ] Update `main/ipc/linking.js` to use Firebase Functions URL
- [ ] Add Firebase dependencies and remove AWS SDK dependencies
- [ ] Validate with Firebase emulator
- [ ] Re-run lint and smoke checks
- [ ] Only then remove obsolete AWS infrastructure code

---

## Recommended Delivery Order

### PR 1

- secret handling
- `.gitignore`
- SQLite migration
- config shape updates

### PR 2

- Firebase init modules
- credentials rewrite
- sync engine rewrite

### PR 3

- OTP/linking migration
- emulator validation
- dependency cleanup

---

## Exit Condition

The migration is complete only when the app can be configured, linked, authenticated, synced, and revoked using Firebase-only infrastructure with no runtime dependency on DynamoDB, Cognito, or Lambda-style sync endpoints.
