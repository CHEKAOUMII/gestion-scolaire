# Tasks: Server-Side OTP (Lambda + DynamoDB)

**Input**: Design documents from `/specs/011-server-otp/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted.

**Organization**: Tasks are grouped by user story. US4 (Encryption) is implemented first as a foundational prerequisite since US1 and US2 both depend on the encryption helpers.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add OTP key constants and grant the Lambda DynamoDB permissions for OTP items.

- [x] T001 [P] Add OTP key constants to `infra/lib/auth-lambda/schema-constants.js`

    **What to do**: Add two new constants to the existing file and export them.

    **Open the file** `infra/lib/auth-lambda/schema-constants.js`. It currently exports `ENTITY_SK_PREFIX`, `GSI_NAME`, `SCHOOL_PK_PREFIX`, `TABLE_NAME`.

    **Add these two lines** after line 23 (`const TABLE_NAME = 'pencil2-sync';`):

    ```js
    const OTP_PK_PREFIX = 'OTP#';
    const OTP_SK_ACTIVE = 'ACTIVE';
    ```

    **Update the `module.exports`** block (line 25-30) to include the new constants:

    ```js
    module.exports = {
        ENTITY_SK_PREFIX,
        GSI_NAME,
        OTP_PK_PREFIX,
        OTP_SK_ACTIVE,
        SCHOOL_PK_PREFIX,
        TABLE_NAME
    };
    ```

    **Done when**: The file exports exactly 6 named constants including `OTP_PK_PREFIX` and `OTP_SK_ACTIVE`.

- [x] T002 [P] Grant Lambda DynamoDB permissions for OTP items in `infra/lib/sync-stack.ts`

    **What to do**: Add an IAM policy statement to the existing `authLambda` function so it can read/write OTP items in the `pencil2-sync` DynamoDB table, scoped to partition keys starting with `OTP#`.

    **Open the file** `infra/lib/sync-stack.ts`. Find the existing `authLambda.addToRolePolicy(...)` call at line 194-204 (the `CognitoDevAuth` statement).

    **Add a NEW `addToRolePolicy` call** immediately AFTER the existing one (after line 204, before `applyResourceTags(authLambda, ...)`). Insert this:

    ```ts
    authLambda.addToRolePolicy(
        new iam.PolicyStatement({
            sid: 'AllowDynamoDBOtpItems',
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
            resources: [table.tableArn],
            conditions: {
                'ForAllValues:StringLike': {
                    'dynamodb:LeadingKeys': ['OTP#*']
                }
            }
        })
    );
    ```

    **Also add** a `SYNC_TABLE_NAME` environment variable to the Lambda's `environment` block (line 178-182). Add this line inside the `environment` object:

    ```ts
    SYNC_TABLE_NAME: table.tableName,
    ```

    So the environment block becomes:

    ```ts
    environment: {
        COGNITO_IDENTITY_POOL_ID: identityPool.ref,
        DEVELOPER_PROVIDER_NAME: 'login.pencil.school',
        SECRET_ARN: 'pencil2/license-secret',
        SYNC_TABLE_NAME: table.tableName
    }
    ```

    **Done when**: The CDK stack grants the Lambda 4 DynamoDB actions scoped to `OTP#*` leading keys, and passes `SYNC_TABLE_NAME` as an environment variable.

---

## Phase 2: Foundational — Lambda Path-Based Routing

**Purpose**: Refactor the existing single-route Lambda handler to support path-based routing without changing existing behavior.

**CRITICAL**: No user story work can begin until this phase is complete. The existing credential-exchange at `POST /` MUST continue to work identically.

- [x] T003 Refactor Lambda handler to add path-based routing in `infra/lib/auth-lambda/index.js`

    **What to do**: Restructure the existing `handler()` function to dispatch requests based on the URL path. The existing credential-exchange logic moves into a dedicated function. Two new route placeholders are added.

    **Open the file** `infra/lib/auth-lambda/index.js` (174 lines currently).

    **Step 1 — Add new imports at the top of the file** (after line 6, before line 8):

    ```js
    const crypto = require('crypto');
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    const { OTP_PK_PREFIX, OTP_SK_ACTIVE, TABLE_NAME } = require('./schema-constants');
    ```

    **Step 2 — Add DynamoDB client initialization** (after `let cachedSecret = null;` on line 16):

    ```js
    const dynamoClient = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(dynamoClient, {
        marshallOptions: { removeUndefinedValues: true }
    });
    ```

    **Step 3 — Add a helper function to extract the request path** (add after `parseBody()`, before `validateRequest()`):

    ```js
    function getRequestPath(event) {
        if (event && event.requestContext && event.requestContext.http) {
            return event.requestContext.http.path || '/';
        }
        if (event && event.rawPath) {
            return event.rawPath;
        }
        return '/';
    }
    ```

    **Step 4 — Rename the existing `handler()` function** from `handler` to `handleCredentialExchange`. Change line 108 from:

    ```js
    async function handler(event) {
    ```

    to:

    ```js
    async function handleCredentialExchange(event) {
    ```

    **Step 5 — Create the new `handler()` function** (add BEFORE `module.exports`):

    ```js
    async function handler(event) {
        try {
            const path = getRequestPath(event);

            if (path === '/' || path === '') {
                return handleCredentialExchange(event);
            }

            if (path === '/link/publish-otp') {
                return handlePublishOtp(event);
            }

            if (path === '/link/verify-otp') {
                return handleVerifyOtp(event);
            }

            return jsonResponse(404, {
                error: 'NOT_FOUND',
                message: 'Unknown endpoint: ' + path
            });
        } catch (error) {
            if (error && error.statusCode && error.code) {
                return jsonResponse(error.statusCode, {
                    error: error.code,
                    message: error.message
                });
            }

            return jsonResponse(500, {
                error: 'INTERNAL_ERROR',
                message: 'An unexpected error occurred'
            });
        }
    }
    ```

    **Step 6 — Add placeholder route handlers** (add before the new `handler()` function):

    ```js
    async function handlePublishOtp(_event) {
        return jsonResponse(501, {
            error: 'NOT_IMPLEMENTED',
            message: 'Publish OTP endpoint not yet implemented'
        });
    }

    async function handleVerifyOtp(_event) {
        return jsonResponse(501, {
            error: 'NOT_IMPLEMENTED',
            message: 'Verify OTP endpoint not yet implemented'
        });
    }
    ```

    **Step 7 — Update `module.exports`** to export the new handler (the one with routing):

    ```js
    module.exports = {
        getSigningSecret,
        handler
    };
    ```

    **IMPORTANT**: The `handleCredentialExchange` function retains its ENTIRE existing try/catch block from the original `handler()`. Do NOT remove or modify its internal logic. The existing error handling inside `handleCredentialExchange` stays as-is. The new outer `handler()` has its OWN try/catch for routing-level errors.

    **Done when**: `POST /` still returns the same credential-exchange response as before. `POST /link/publish-otp` and `POST /link/verify-otp` return 501. `POST /anything-else` returns 404.

**Checkpoint**: Foundation ready — the Lambda now routes requests by path. Existing credential exchange at `POST /` is unchanged.

---

## Phase 3: User Story 4 — Encrypted Config Payload (Priority: P1) 🎯 MVP

**Goal**: Implement the encryption/decryption helpers that both US1 (publish) and US2 (verify) depend on. This is the client-side `main/linking/server.js` module's crypto layer.

**Independent Test**: Call `deriveEncryptionKey()` with a known OTP, encrypt a known JSON payload, then decrypt it with the same OTP and confirm the output matches the input exactly.

### Implementation for User Story 4

- [x] T004 [US4] Create client module with encryption helpers in `main/linking/server.js`

    **What to do**: Create a NEW file `main/linking/server.js` with three internal helper functions and two exported stub functions. This task implements ONLY the encryption/decryption layer. The `publishOtpToServer()` and `verifyOtpViaServer()` functions will be implemented in later tasks.

    **Create the file** `main/linking/server.js` with this content:

    ```js
    'use strict';

    const crypto = require('crypto');
    const { hashPassword } = require('../auth/password');

    // Encryption constants (must match between Device 1 and Device 2)
    const HKDF_SALT = 'pencil2-link-v1';
    const HKDF_INFO = 'otp-payload-key';
    const HKDF_KEY_LENGTH = 32; // AES-256
    const GCM_IV_LENGTH = 12;
    const MAX_PAYLOAD_BYTES = 300 * 1024; // 300KB

    function deriveEncryptionKey(otpPlaintext) {
        const keyMaterial = Buffer.from(
            crypto.hkdfSync('sha256', String(otpPlaintext), HKDF_SALT, HKDF_INFO, HKDF_KEY_LENGTH)
        );
        return keyMaterial;
    }

    function encryptPayload(key, plaintextObj) {
        const plaintext = JSON.stringify(plaintextObj);
        const iv = crypto.randomBytes(GCM_IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(plaintext, 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        const authTag = cipher.getAuthTag();
        return {
            ciphertext: encrypted,
            iv,
            authTag
        };
    }

    function decryptPayload(key, ciphertextBuf, ivBuf, authTagBuf) {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
        decipher.setAuthTag(authTagBuf);
        let decrypted = decipher.update(ciphertextBuf);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return JSON.parse(decrypted.toString('utf8'));
    }

    async function publishOtpToServer(authLambdaUrl, licenseKey, deviceHash, massar, otpPlaintext, configPayload) {
        // Implemented in T005
        void authLambdaUrl;
        void licenseKey;
        void deviceHash;
        void massar;
        void otpPlaintext;
        void configPayload;
        return { success: false, error: 'Not yet implemented', code: 'NOT_IMPLEMENTED' };
    }

    async function verifyOtpViaServer(authLambdaUrl, massar, otpPlaintext) {
        // Implemented in T008
        void authLambdaUrl;
        void massar;
        void otpPlaintext;
        return { success: false, error: 'Not yet implemented', code: 'NOT_IMPLEMENTED' };
    }

    module.exports = {
        publishOtpToServer,
        verifyOtpViaServer
    };
    ```

    **Style rules**: Single quotes, 4-space indent, semicolons, no trailing commas. Follow Prettier config.

    **Done when**: The file exists, exports `publishOtpToServer` and `verifyOtpViaServer`, and `npm run lint` passes for this file. Internal helpers `deriveEncryptionKey`, `encryptPayload`, `decryptPayload` are defined and used by the exported functions in later tasks.

**Checkpoint**: Encryption helpers are ready. `deriveEncryptionKey('123456')` returns a 32-byte Buffer. `encryptPayload(key, obj)` → `decryptPayload(key, ...)` round-trips correctly.

---

## Phase 4: User Story 1 — Admin Publishes OTP to Server (Priority: P1)

**Goal**: Device 1 (admin) can publish an OTP hash + encrypted sync config to DynamoDB via the Lambda, making it available for remote verification by Device 2.

**Independent Test**: Call `publishOtpToServer()` with a valid license key, MASSAR code, OTP, and sync config. Confirm DynamoDB receives an item with `PK: OTP#<massar>`, `SK: ACTIVE`, correct TTL, and the encrypted payload. Confirm a second publish for the same MASSAR overwrites the first.

### Implementation for User Story 1

- [x] T005 [US1] Implement `publishOtpToServer()` in `main/linking/server.js`

    **What to do**: Replace the stub `publishOtpToServer()` function with the real implementation. This function: (a) derives an AES-256 key from the OTP, (b) encrypts the config payload, (c) hashes the OTP with scrypt, (d) POSTs everything to the Lambda's `/link/publish-otp` endpoint.

    **Replace the existing `publishOtpToServer` function** in `main/linking/server.js` with:

    ```js
    async function publishOtpToServer(authLambdaUrl, licenseKey, deviceHash, massar, otpPlaintext, configPayload) {
        try {
            const key = deriveEncryptionKey(otpPlaintext);
            const { ciphertext, iv, authTag } = encryptPayload(key, configPayload);

            const encPayloadBase64 = ciphertext.toString('base64');
            if (Buffer.byteLength(encPayloadBase64, 'utf8') > MAX_PAYLOAD_BYTES) {
                return { success: false, error: 'Config payload too large', code: 'PAYLOAD_TOO_LARGE' };
            }

            const otpHash = hashPassword(String(otpPlaintext));

            const url = String(authLambdaUrl).replace(/\/+$/, '') + '/link/publish-otp';
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    licenseKey,
                    deviceHash,
                    massar: String(massar).trim().toUpperCase(),
                    otpHash,
                    encryptedPayload: encPayloadBase64,
                    iv: iv.toString('base64'),
                    authTag: authTag.toString('base64')
                })
            });

            const data = await response.json();
            if (!response.ok) {
                return {
                    success: false,
                    error: data.message || 'Server rejected the request',
                    code: data.error || 'SERVER_ERROR'
                };
            }

            return { success: true, expiresAt: data.expiresAt };
        } catch (err) {
            return {
                success: false,
                error: 'Failed to publish OTP to server: ' + err.message,
                code: 'NETWORK_ERROR'
            };
        }
    }
    ```

    **Done when**: Calling `publishOtpToServer(url, key, hash, 'M320456', '123456', { syncConfig: {...} })` makes a POST request to `<url>/link/publish-otp` with the correct body shape. Network errors return `{ success: false, code: 'NETWORK_ERROR' }`.

- [x] T006 [US1] Implement `handlePublishOtp()` Lambda handler in `infra/lib/auth-lambda/index.js`

    **What to do**: Replace the placeholder `handlePublishOtp()` function (from T003) with the real implementation that validates the request, authenticates the license key, validates MASSAR match, and writes the OTP item to DynamoDB.

    **Replace the `handlePublishOtp` function** with:

    ```js
    async function handlePublishOtp(event) {
        const body = parseBody(event);

        // License key auth (same as credential exchange)
        const authError = validateRequest(body);
        if (authError) {
            return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: authError });
        }

        const signingSecret = await getSigningSecret();
        const licenseResult = validateLicenseKey(body.licenseKey, signingSecret);
        if (!licenseResult.ok) {
            return jsonResponse(401, { error: 'INVALID_KEY', message: licenseResult.error });
        }

        if (isExpired(licenseResult.payload.expiresAt)) {
            return jsonResponse(401, {
                error: 'EXPIRED_KEY',
                message: 'License key expired on ' + licenseResult.payload.expiresAt
            });
        }

        // Validate OTP-specific fields
        const { massar, otpHash, encryptedPayload, iv, authTag } = body;

        if (!massar || typeof massar !== 'string' || !/^[A-Za-z0-9]{5,10}$/.test(massar.trim())) {
            return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid MASSAR code format' });
        }

        const normalizedMassar = massar.trim().toUpperCase();
        const customerRef = licenseResult.payload.customerRef;

        if (normalizedMassar !== String(customerRef).trim().toUpperCase()) {
            return jsonResponse(400, {
                error: 'MASSAR_MISMATCH',
                message: 'MASSAR code does not match license customerRef'
            });
        }

        if (!otpHash || typeof otpHash !== 'string' || !otpHash.startsWith('scrypt$')) {
            return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid otpHash format' });
        }

        const hashParts = otpHash.split('$');
        if (hashParts.length !== 3 || !hashParts[1] || !hashParts[2]) {
            return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid otpHash structure' });
        }

        if (!encryptedPayload || typeof encryptedPayload !== 'string') {
            return jsonResponse(400, {
                error: 'MALFORMED_REQUEST',
                message: 'Missing required field: encryptedPayload'
            });
        }

        if (Buffer.byteLength(encryptedPayload, 'utf8') > 300 * 1024) {
            return jsonResponse(400, {
                error: 'PAYLOAD_TOO_LARGE',
                message: 'Encrypted payload exceeds maximum size of 300KB'
            });
        }

        if (!iv || typeof iv !== 'string') {
            return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Missing required field: iv' });
        }

        if (!authTag || typeof authTag !== 'string') {
            return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Missing required field: authTag' });
        }

        // Write to DynamoDB (unconditional overwrite)
        const nowSeconds = Math.floor(Date.now() / 1000);
        const tableName = process.env.SYNC_TABLE_NAME || TABLE_NAME;

        await docClient.send(
            new PutCommand({
                TableName: tableName,
                Item: {
                    PK: OTP_PK_PREFIX + normalizedMassar,
                    SK: OTP_SK_ACTIVE,
                    otpHash,
                    encryptedPayload,
                    iv,
                    authTag,
                    schoolId: normalizedMassar,
                    publishedBy: body.deviceHash,
                    failureCount: 0,
                    status: 'active',
                    expiresAt: nowSeconds + 600,
                    createdAt: new Date().toISOString()
                }
            })
        );

        return jsonResponse(200, {
            success: true,
            expiresAt: nowSeconds + 600
        });
    }
    ```

    **Done when**: `POST /link/publish-otp` with a valid license key, matching MASSAR, and valid OTP hash stores a DynamoDB item and returns `{ success: true, expiresAt }`. Invalid requests return appropriate 400/401 errors.

**Checkpoint**: Admin can publish OTP to server. DynamoDB item is created with correct PK/SK pattern, TTL, and encrypted payload.

---

## Phase 5: User Story 2 — New Device Verifies OTP via Server (Priority: P1)

**Goal**: Device 2 can submit a MASSAR code + OTP plaintext to the Lambda, which verifies the hash against DynamoDB and returns the encrypted config payload. Device 2 decrypts the payload locally.

**Independent Test**: Publish an OTP (US1), then call `verifyOtpViaServer()` with the correct OTP. Confirm the decrypted config matches the original. Confirm incorrect OTP returns an error.

### Implementation for User Story 2

- [x] T007 [US2] Add scrypt verification helper to Lambda in `infra/lib/auth-lambda/index.js`

    **What to do**: Add a `verifyScryptHash()` function to the Lambda that verifies an OTP plaintext against a stored scrypt hash. This duplicates the 8-line verification logic from `main/auth/password.js` because that file is not deployed to Lambda.

    **Add this function** in `infra/lib/auth-lambda/index.js` after the `getRequestPath()` function (added in T003), before the `handleCredentialExchange()` function:

    ```js
    function verifyScryptHash(plaintext, storedHash) {
        if (!storedHash || typeof storedHash !== 'string') {
            return false;
        }

        const parts = storedHash.split('$');
        if (parts.length !== 3 || parts[0] !== 'scrypt') {
            return false;
        }

        const salt = parts[1];
        const expectedHex = parts[2];
        const computedHex = crypto.scryptSync(String(plaintext || ''), salt, 64).toString('hex');

        const a = Buffer.from(expectedHex, 'hex');
        const b = Buffer.from(computedHex, 'hex');

        if (a.length !== b.length) {
            return false;
        }

        return crypto.timingSafeEqual(a, b);
    }
    ```

    **Key details**:
    - Uses `crypto.scryptSync` with default options (N=16384, r=8, p=1) — MUST match the defaults used by `main/auth/password.js`.
    - Uses `crypto.timingSafeEqual` for constant-time comparison.
    - The `crypto` require was already added in T003.

    **Done when**: `verifyScryptHash('123456', hashPassword('123456'))` returns `true`, and `verifyScryptHash('wrong', hashPassword('123456'))` returns `false`.

- [x] T008 [US2] Implement `handleVerifyOtp()` Lambda handler in `infra/lib/auth-lambda/index.js`

    **What to do**: Replace the placeholder `handleVerifyOtp()` function (from T003) with the real implementation. This handler: looks up the OTP item in DynamoDB, checks expiry and rate limit, verifies the OTP hash with scrypt, and on success returns the encrypted payload and marks the OTP as used.

    **Replace the `handleVerifyOtp` function** with:

    ```js
    async function handleVerifyOtp(event) {
        const body = parseBody(event);
        const { massar, otp } = body;

        // Validate inputs (no license key required)
        if (!massar || typeof massar !== 'string' || !/^[A-Za-z0-9]{5,10}$/.test(massar.trim())) {
            return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid MASSAR code format' });
        }

        if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
            return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'OTP must be a 6-digit code' });
        }

        const normalizedMassar = massar.trim().toUpperCase();
        const tableName = process.env.SYNC_TABLE_NAME || TABLE_NAME;

        // Look up OTP item
        const getResult = await docClient.send(
            new GetCommand({
                TableName: tableName,
                Key: {
                    PK: OTP_PK_PREFIX + normalizedMassar,
                    SK: OTP_SK_ACTIVE
                }
            })
        );

        const item = getResult.Item;
        if (!item) {
            return jsonResponse(404, { error: 'NOT_FOUND', message: 'No active OTP found for this institution' });
        }

        // Check if already used
        if (item.status === 'used') {
            return jsonResponse(410, { error: 'OTP_USED', message: 'OTP has already been used' });
        }

        // Check expiry (explicit check — DynamoDB TTL can lag up to 48h)
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (item.expiresAt <= nowSeconds) {
            return jsonResponse(410, { error: 'OTP_EXPIRED', message: 'OTP has expired' });
        }

        // Check rate limit
        if (item.failureCount >= 5) {
            return jsonResponse(429, {
                error: 'RATE_LIMITED',
                message: 'Too many failed attempts. Request a new OTP.'
            });
        }

        // Verify OTP with scrypt
        const isValid = verifyScryptHash(otp, item.otpHash);

        if (!isValid) {
            // Atomically increment failure count with rate limit check
            try {
                await docClient.send(
                    new UpdateCommand({
                        TableName: tableName,
                        Key: {
                            PK: OTP_PK_PREFIX + normalizedMassar,
                            SK: OTP_SK_ACTIVE
                        },
                        UpdateExpression: 'SET failureCount = if_not_exists(failureCount, :zero) + :one',
                        ConditionExpression: 'attribute_not_exists(failureCount) OR failureCount < :max',
                        ExpressionAttributeValues: {
                            ':zero': 0,
                            ':one': 1,
                            ':max': 5
                        }
                    })
                );
            } catch (condErr) {
                if (condErr.name === 'ConditionalCheckFailedException') {
                    return jsonResponse(429, {
                        error: 'RATE_LIMITED',
                        message: 'Too many failed attempts. Request a new OTP.'
                    });
                }
                throw condErr;
            }

            return jsonResponse(401, { error: 'INVALID_OTP', message: 'Invalid OTP code' });
        }

        // Success — mark as used
        await docClient.send(
            new UpdateCommand({
                TableName: tableName,
                Key: {
                    PK: OTP_PK_PREFIX + normalizedMassar,
                    SK: OTP_SK_ACTIVE
                },
                UpdateExpression: 'SET #st = :used, usedAt = :now',
                ExpressionAttributeNames: { '#st': 'status' },
                ExpressionAttributeValues: {
                    ':used': 'used',
                    ':now': new Date().toISOString()
                }
            })
        );

        return jsonResponse(200, {
            success: true,
            encryptedPayload: item.encryptedPayload,
            iv: item.iv,
            authTag: item.authTag
        });
    }
    ```

    **Key details**:
    - `status` is a DynamoDB reserved word, so use `ExpressionAttributeNames` with `#st`.
    - The rate-limit check happens BEFORE scrypt verification (to avoid wasting CPU on rate-limited requests).
    - The failure increment uses `ConditionExpression` for atomic check-and-increment.
    - On success, the encrypted payload is returned as-is (opaque blob — Lambda never decrypts it).

    **Done when**: `POST /link/verify-otp` with correct OTP returns `{ success: true, encryptedPayload, iv, authTag }` and marks the DynamoDB item as used. Incorrect OTP increments `failureCount`. Expired/used/rate-limited OTPs return appropriate error codes.

- [x] T009 [US2] Implement `verifyOtpViaServer()` in `main/linking/server.js`

    **What to do**: Replace the stub `verifyOtpViaServer()` function with the real implementation. This function: (a) calls `POST <authLambdaUrl>/link/verify-otp`, (b) on success decrypts the returned payload using the OTP-derived key, (c) returns the parsed config object.

    **Replace the existing `verifyOtpViaServer` function** in `main/linking/server.js` with:

    ```js
    async function verifyOtpViaServer(authLambdaUrl, massar, otpPlaintext) {
        try {
            const url = String(authLambdaUrl).replace(/\/+$/, '') + '/link/verify-otp';
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    massar: String(massar).trim().toUpperCase(),
                    otp: String(otpPlaintext)
                })
            });

            const data = await response.json();
            if (!response.ok) {
                return {
                    success: false,
                    error: data.message || 'Server rejected the request',
                    code: data.error || 'SERVER_ERROR'
                };
            }

            // Decrypt the payload
            const key = deriveEncryptionKey(otpPlaintext);
            const ciphertextBuf = Buffer.from(data.encryptedPayload, 'base64');
            const ivBuf = Buffer.from(data.iv, 'base64');
            const authTagBuf = Buffer.from(data.authTag, 'base64');

            const configPayload = decryptPayload(key, ciphertextBuf, ivBuf, authTagBuf);
            return { success: true, configPayload };
        } catch (err) {
            return {
                success: false,
                error: 'Failed to verify OTP via server: ' + err.message,
                code: 'NETWORK_ERROR'
            };
        }
    }
    ```

    **Done when**: Calling `verifyOtpViaServer(url, 'M320456', '123456')` makes a POST, decrypts the response, and returns `{ success: true, configPayload }`. Network/decryption errors return `{ success: false, code: 'NETWORK_ERROR' }`.

**Checkpoint**: Full publish→verify round-trip works. Admin publishes, new device verifies and decrypts config.

---

## Phase 6: User Story 3 — Brute-Force Protection on Server (Priority: P2)

**Goal**: The Lambda rejects verification attempts after 5 failures within an OTP's lifetime.

**Independent Test**: Publish an OTP, submit 5 wrong codes (each returns `INVALID_OTP`), then submit the correct code on the 6th attempt and confirm it returns `RATE_LIMITED`. Publish a new OTP and confirm rate limit resets.

### Implementation for User Story 3

- [x] T010 [US3] Verify rate limiting already works in `handleVerifyOtp()` — no additional code needed

    **What to do**: The rate limiting logic was already implemented in T008 as part of the `handleVerifyOtp()` function. This task is a **verification-only task** to confirm the behavior matches US3 acceptance scenarios.

    **Verify these behaviors are correct in the code from T008**:
    1. The handler checks `if (item.failureCount >= 5)` BEFORE attempting scrypt verification → returns 429 `RATE_LIMITED`. ✓ (implemented in T008)
    2. On failed OTP, `UpdateCommand` atomically increments `failureCount` with `ConditionExpression: failureCount < 5`. If the condition fails, returns 429. ✓ (implemented in T008)
    3. Publishing a new OTP (T006) overwrites the entire item via `PutItem` with `failureCount: 0`, which resets the rate limit. ✓ (implemented in T006)

    **Done when**: No code changes needed. Confirm by reading T006 and T008 that rate limiting is correctly implemented. If any of the three behaviors above are missing, fix them in `infra/lib/auth-lambda/index.js`.

**Checkpoint**: Rate limiting is verified. 5 failures block subsequent attempts. New OTP publish resets the counter.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Clean up, remove stubs, and validate the complete implementation.

- [x] T011 Remove unused stub code from `main/linking/server.js`

    **What to do**: After T005 and T009, the original stub functions should be gone. Verify there are no remaining `void` statements or `'Not yet implemented'` strings in the file. Remove the `hashPassword` import if it is no longer used directly in the final version (check: it IS used in `publishOtpToServer` to hash the OTP, so keep it).

    **Check that `module.exports`** only exports `publishOtpToServer` and `verifyOtpViaServer`. The internal helpers (`deriveEncryptionKey`, `encryptPayload`, `decryptPayload`) should NOT be exported.

    **Done when**: No stub code remains. The file is clean and exports exactly 2 functions.

- [x] T012 Run `npm run lint` and fix any issues in `main/linking/server.js`

    **What to do**: Run `npm run lint` from the project root. Fix any ESLint errors or warnings in `main/linking/server.js`. The file is in `main/` so it follows Node globals rules with `no-unused-vars` warn (args `^_` exempt) and `no-empty` error.

    **Common issues to check**:
    - Unused variables (prefix with `_` if intentionally unused)
    - Missing semicolons
    - Single quotes vs double quotes
    - Line length > 120 chars
    - Trailing commas (not allowed per Prettier config)

    **Done when**: `npm run lint` passes with zero errors for `main/linking/server.js`.

- [x] T013 Run `npm run test:smoke` to verify no regressions

    **What to do**: Run `npm run test:smoke` from the project root. This phase does NOT add any IPC channels, so the smoke test channel count should be unchanged. Verify:
    - IPC parity check passes (preload.js channels match main/ipc/\*.js handlers)
    - No CDN references
    - Module integrity checks pass

    **Note**: If the smoke test fails, it is likely a pre-existing issue or a side effect from other phases. Do NOT modify `preload.js` or `main/ipc/registerAll.js` for this feature — Phase 7.4 has no IPC changes.

    **Done when**: `npm run test:smoke` passes.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T001 and T002 can start immediately and run in parallel
- **Foundational (Phase 2)**: T003 depends on T001 (needs the new constants). T002 is independent.
- **US4 Encryption (Phase 3)**: T004 has no dependencies on Lambda code — can run in parallel with Phase 2
- **US1 Publish (Phase 4)**: T005 depends on T004 (needs encryption helpers). T006 depends on T003 (needs routing).
- **US2 Verify (Phase 5)**: T007 depends on T003. T008 depends on T007. T009 depends on T004 and T008.
- **US3 Rate Limit (Phase 6)**: T010 depends on T006 and T008 (verification only)
- **Polish (Phase 7)**: T011-T013 depend on all previous tasks

### User Story Dependencies

- **US4 (Encryption)**: No story dependencies — foundational for US1 and US2
- **US1 (Publish)**: Depends on US4 (encryption helpers)
- **US2 (Verify)**: Depends on US1 (must have something published to verify against) and US4 (decryption)
- **US3 (Rate Limit)**: Depends on US2 (built into the verify handler)

### Within Each User Story

- Client code and Lambda code can be developed in parallel within the same story
- Lambda handler should be completed before client integration testing

### Parallel Opportunities

```
Phase 1: T001 ←→ T002  (parallel — different files)

Phase 2 + Phase 3:
  T003 (depends on T001) ←→ T004 (independent)  (parallel — Lambda vs client)

Phase 4:
  T005 (depends on T004) ←→ T006 (depends on T003)  (parallel — client vs Lambda)

Phase 5:
  T007 (depends on T003) → T008 (depends on T007) → T009 (depends on T004, T008)
```

---

## Parallel Example: Phase 1

```
# Launch both setup tasks together (different files):
Task T001: "Add OTP constants to infra/lib/auth-lambda/schema-constants.js"
Task T002: "Grant Lambda DynamoDB OTP permissions in infra/lib/sync-stack.ts"
```

## Parallel Example: Phase 2 + Phase 3

```
# Lambda routing and client encryption in parallel (different codebases):
Task T003: "Refactor Lambda handler for path routing in infra/lib/auth-lambda/index.js"
Task T004: "Create client module with encryption helpers in main/linking/server.js"
```

## Parallel Example: Phase 4

```
# Client publish and Lambda publish handler in parallel:
Task T005: "Implement publishOtpToServer() in main/linking/server.js"
Task T006: "Implement handlePublishOtp() Lambda handler in infra/lib/auth-lambda/index.js"
```

---

## Implementation Strategy

### MVP First (US4 + US1 Only)

1. Complete Phase 1: Setup (T001, T002)
2. Complete Phase 2: Lambda routing (T003)
3. Complete Phase 3: Encryption helpers (T004)
4. Complete Phase 4: US1 Publish (T005, T006)
5. **STOP and VALIDATE**: Publish an OTP and confirm DynamoDB item is created correctly

### Incremental Delivery

1. Setup + Routing + Encryption → Foundation ready
2. Add US1 Publish → Admin can push OTP to server (half the flow works)
3. Add US2 Verify → Full round-trip: publish + verify + decrypt (core flow complete!)
4. Add US3 Rate Limit → Security hardened (verification only — already implemented)
5. Polish → Lint, smoke test, cleanup

### Single Developer Execution Order

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- This feature has NO IPC changes — `preload.js` and `main/ipc/registerAll.js` are NOT modified
- This feature has NO UI changes — renderer pages are NOT modified
- Lambda code (`infra/lib/auth-lambda/`) is outside `npm run lint` scope — follow same style manually
- `npm run test:smoke` channel count should be UNCHANGED after this feature
- The `hashPassword` import in `main/linking/server.js` comes from `main/auth/password.js` (existing module)
- `fetch()` is available globally in Node.js 18 (both Lambda and Electron main process) — no import needed
