# Tasks: AWS Infrastructure for DynamoDB Sync

**Input**: Design documents from `/specs/002-aws-infrastructure/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested — test tasks included only for CDK template assertions and Lambda unit tests as specified in plan.md.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Reference Documents

Before implementing, read these files for exact specifications:

| Document                                                    | What it contains                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `specs/002-aws-infrastructure/data-model.md`                | DynamoDB table keys, GSI, item envelope, TTL strategy, Cognito config, IAM roles |
| `specs/002-aws-infrastructure/contracts/auth-lambda-api.md` | Auth Lambda request/response contract with exact JSON shapes                     |
| `specs/002-aws-infrastructure/contracts/dynamodb-schema.md` | DynamoDB write/read contracts, sort key registry for all 17 entity types         |
| `specs/002-aws-infrastructure/contracts/iam-permissions.md` | Exact IAM trust and permissions policy JSON                                      |
| `specs/002-aws-infrastructure/research.md`                  | Design decisions and rationale                                                   |
| `specs/002-aws-infrastructure/quickstart.md`                | Deployment and testing guide                                                     |
| `main/licensing/offlineKey.js`                              | Source code to port for license validation in Lambda                             |

---

## Phase 1: Setup (CDK Project Initialization)

**Purpose**: Create the `infra/` directory with a working CDK TypeScript project that can synthesize and deploy an empty stack.

- [x] T001 Create CDK project directory structure at `infra/` with subdirectories: `bin/`, `lib/`, `lib/auth-lambda/`, `test/`

    **Exact steps**:
    1. Create directory `infra/` at the repo root
    2. Create subdirectories: `infra/bin/`, `infra/lib/`, `infra/lib/auth-lambda/`, `infra/test/`
    3. Do NOT run `cdk init` — we will create files manually for full control

- [x] T002 Create `infra/package.json` with CDK and AWS SDK dependencies

    **Exact content**: Create a `package.json` with these dependencies:

    ```json
    {
        "name": "pencil2-sync-infra",
        "version": "1.0.0",
        "private": true,
        "scripts": {
            "build": "tsc",
            "synth": "cdk synth",
            "deploy": "cdk deploy",
            "destroy": "cdk destroy",
            "test": "jest"
        },
        "devDependencies": {
            "aws-cdk": "^2",
            "aws-cdk-lib": "^2",
            "constructs": "^10",
            "typescript": "^5",
            "@types/node": "^18",
            "jest": "^29",
            "@types/jest": "^29",
            "ts-jest": "^29"
        },
        "dependencies": {
            "@aws-sdk/client-cognito-identity": "^3",
            "@aws-sdk/client-secrets-manager": "^3"
        }
    }
    ```

- [x] T003 [P] Create `infra/tsconfig.json` for CDK TypeScript compilation

    **Exact content**:

    ```json
    {
        "compilerOptions": {
            "target": "ES2020",
            "module": "commonjs",
            "lib": ["es2020"],
            "declaration": true,
            "strict": true,
            "noImplicitAny": true,
            "strictNullChecks": true,
            "noImplicitThis": true,
            "alwaysStrict": true,
            "noUnusedLocals": false,
            "noUnusedParameters": false,
            "noImplicitReturns": true,
            "noFallthroughCasesInSwitch": false,
            "inlineSourceMap": true,
            "inlineSources": true,
            "experimentalDecorators": true,
            "strictPropertyInitialization": false,
            "outDir": "./cdk.out",
            "rootDir": "."
        },
        "exclude": ["node_modules", "cdk.out", "test"]
    }
    ```

- [x] T004 [P] Create `infra/cdk.json` CDK configuration file

    **Exact content**:

    ```json
    {
        "app": "npx ts-node --prefer-ts-exts bin/app.ts",
        "watch": {
            "include": ["**"],
            "exclude": ["node_modules", "cdk.out", "**/*.js", "**/*.d.ts"]
        },
        "context": {
            "@aws-cdk/core:stackRelativeExports": true
        }
    }
    ```

- [x] T005 Create `infra/bin/app.ts` — CDK app entry point with stack instantiation

    **Exact behavior**:
    1. Import `App` from `aws-cdk-lib` and the `PencilSyncStack` from `../lib/sync-stack`
    2. Create a new `App()`
    3. Instantiate `PencilSyncStack` with stack name `PencilSyncStack`
    4. Accept an `Environment` context parameter (default: `dev`) for resource tagging
    5. Call `app.synth()`

    **File**: `infra/bin/app.ts`

- [x] T006 Create minimal `infra/lib/sync-stack.ts` — empty CDK stack that compiles and synthesizes

    **Exact behavior**:
    1. Import `Stack`, `StackProps`, `CfnParameter` from `aws-cdk-lib`
    2. Create class `PencilSyncStack extends Stack`
    3. Add a `CfnParameter` named `Environment` with allowed values `['dev', 'staging', 'prod']` and default `'dev'`
    4. Constructor should accept `scope: Construct` and `id: string` and optional `props?: StackProps`
    5. Leave body empty for now — resources will be added in later tasks

    **File**: `infra/lib/sync-stack.ts`

**Checkpoint**: After T006, run `cd infra && npm install && npx cdk synth` — should produce a valid empty CloudFormation template with no errors.

---

## Phase 2: Foundational (Auth Lambda — Blocking Prerequisite)

**Purpose**: Port the license key validation logic from the Electron app to a standalone Lambda-compatible module. This MUST be complete before the CDK stack can wire up the Lambda function.

**⚠️ CRITICAL**: The Auth Lambda code must work without Electron dependencies (no `require('electron')`, no `app.getPath()`). It uses only Node.js built-in `crypto` module.

- [x] T007 Create `infra/lib/auth-lambda/license-validator.js` — port license key validation from `main/licensing/offlineKey.js`

    **Source to port**: Read `main/licensing/offlineKey.js` (lines 1–190) for the exact algorithm.

    **Exact behavior**:
    1. Export a function `validateLicenseKey(rawKey, signingSecret)` that takes the raw license key string and the HMAC signing secret as parameters
    2. Port the following logic from `main/licensing/offlineKey.js`:
        - `KEY_PREFIX = 'GSLK-'`
        - `ALLOWED_PLANS = new Set(['basic', 'pro', 'business'])`
        - Normalize the key (trim, remove whitespace)
        - Verify prefix is `GSLK-`
        - Split on `.` — must yield exactly 2 non-empty parts
        - Recompute HMAC-SHA256: `crypto.createHmac('sha256', signingSecret).update(payloadBase64).digest('base64url')`
        - Compare signatures using `crypto.timingSafeEqual` (handle different-length buffers by returning false)
        - Base64url-decode and JSON-parse the payload
        - Validate: plan must be in `ALLOWED_PLANS`, `exp` must be a valid date if present, `dc` must match `/^[a-f0-9]{64}$/` if present
    3. Return on success: `{ ok: true, payload: { planCode, expiresAt, customerRef, deviceCode, issuedAt, nonce } }`
    4. Return on failure: `{ ok: false, error: '<reason>' }`
    5. **IMPORTANT DIFFERENCES from the Electron version**:
        - Do NOT import `electron` or `fs` or `path`
        - Do NOT read from `.license-secret` file
        - The signing secret is passed as a function parameter (it comes from Secrets Manager at runtime)
        - No fallback secret logic — Lambda uses exactly one secret
    6. Also export a function `isExpired(expiresAtISO)` that checks if the expiration date is in the past
    7. Use only `const crypto = require('crypto');` — no other imports

    **File**: `infra/lib/auth-lambda/license-validator.js`

- [x] T008 Create `infra/lib/auth-lambda/index.js` — Lambda handler for authentication

    **Exact behavior** (read `specs/002-aws-infrastructure/contracts/auth-lambda-api.md` for the full contract):
    1. Import `license-validator.js` (local require: `./license-validator`)
    2. Import `@aws-sdk/client-cognito-identity` for `CognitoIdentityClient` and `GetOpenIdTokenForDeveloperIdentityCommand`
    3. Import `@aws-sdk/client-secrets-manager` for `SecretsManagerClient` and `GetSecretValueCommand`
    4. Read environment variables: `GESTION_LICENSE_SECRET` (fallback), `COGNITO_IDENTITY_POOL_ID`, `DEVELOPER_PROVIDER_NAME` (default: `login.pencil.school`), `SECRET_ARN` (Secrets Manager ARN)
    5. Cache the signing secret in a module-level variable (fetched from Secrets Manager on cold start, reused on warm invocations)
    6. Export `handler` async function that:
       a. Parses the event body (Lambda Function URL sends JSON body as `event.body` string; if already parsed, use directly)
       b. Validates request: `licenseKey` (string, required), `deviceHash` (string, required, must match `/^[a-f0-9]{64}$/`)
       c. On validation failure: return `{ statusCode: 400, body: JSON.stringify({ error: 'MALFORMED_REQUEST', message: '<specific reason>' }) }`
       d. Fetch signing secret from Secrets Manager if not cached (use `SECRET_ARN` env var)
       e. Call `validateLicenseKey(licenseKey, signingSecret)`
       f. If validation fails: return `{ statusCode: 401, body: JSON.stringify({ error: 'INVALID_KEY', message: result.error }) }`
       g. Check expiration with `isExpired(result.payload.expiresAt)`. If expired: return `{ statusCode: 401, body: JSON.stringify({ error: 'EXPIRED_KEY', message: 'License key expired on ' + result.payload.expiresAt }) }`
       h. Extract `customerRef` from the validated payload — this is the school ID
       i. Call Cognito `GetOpenIdTokenForDeveloperIdentity` with:
        - `IdentityPoolId`: from env var `COGNITO_IDENTITY_POOL_ID`
        - `Logins`: `{ [DEVELOPER_PROVIDER_NAME]: customerRef }`
          j. Return `{ statusCode: 200, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }, body: JSON.stringify({ identityId, token, schoolId: customerRef, expiresAt: Math.floor(Date.now() / 1000) + 900 }) }`
          k. Wrap everything in try/catch — on unexpected errors return `{ statusCode: 500, body: JSON.stringify({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }) }`

    **File**: `infra/lib/auth-lambda/index.js`

- [x] T009 Create `infra/test/auth-lambda.test.js` — unit tests for the license validator and Lambda handler

    **Exact test cases** (use Jest):
    1. `license-validator.js` tests:
        - Valid key with known secret returns `{ ok: true }` with correct `customerRef`
        - Invalid signature returns `{ ok: false, error: 'Invalid license signature' }`
        - Missing `GSLK-` prefix returns `{ ok: false }`
        - Malformed key (no `.` separator) returns `{ ok: false }`
        - Unsupported plan code returns `{ ok: false }`
        - `isExpired()` returns `true` for past dates, `false` for future dates, `false` for null
    2. `index.js` handler tests (mock Cognito and Secrets Manager):
        - Valid request returns 200 with `identityId`, `token`, `schoolId`, `expiresAt`
        - Missing `licenseKey` returns 400 with `MALFORMED_REQUEST`
        - Invalid `deviceHash` format returns 400 with `MALFORMED_REQUEST`
        - Invalid license key returns 401 with `INVALID_KEY`
        - Expired license key returns 401 with `EXPIRED_KEY`
        - Cognito error returns 500 with `INTERNAL_ERROR`
    3. To generate a valid test key, replicate the signing logic:
        ```javascript
        const crypto = require('crypto');
        const TEST_SECRET = 'test-secret-for-unit-tests';
        const payload = {
            plan: 'pro',
            exp: '2030-01-01T00:00:00.000Z',
            customer: 'TEST-SCHOOL',
            ov: false,
            dc: '',
            iat: new Date().toISOString(),
            nonce: 'abcdef0123456789'
        };
        const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signature = crypto.createHmac('sha256', TEST_SECRET).update(payloadBase64).digest('base64url');
        const testKey = `GSLK-${payloadBase64}.${signature}`;
        ```

    **File**: `infra/test/auth-lambda.test.js`

**Checkpoint**: After T009, run `cd infra && npx jest test/auth-lambda.test.js` — all tests should pass.

---

## Phase 3: User Story 1 — Deploy Cloud Infrastructure from Template (Priority: P1) 🎯 MVP

**Goal**: A single `cdk deploy` command provisions the DynamoDB table, Cognito Identity Pool, Auth Lambda, and IAM roles.

**Independent Test**: Deploy to a fresh AWS account, then run `aws dynamodb describe-table --table-name pencil2-sync` and `aws cognito-identity list-identity-pools --max-results 10` to verify resources exist.

### Implementation for User Story 1

- [x] T010 [US1] Add DynamoDB table `pencil2-sync` to CDK stack in `infra/lib/sync-stack.ts`

    **Exact specification** (read `specs/002-aws-infrastructure/data-model.md` for full details):
    1. Import `aws_dynamodb as dynamodb` from `aws-cdk-lib`
    2. Create a `dynamodb.Table` with:
        - `tableName`: `'pencil2-sync'`
        - `partitionKey`: `{ name: 'PK', type: dynamodb.AttributeType.STRING }`
        - `sortKey`: `{ name: 'SK', type: dynamodb.AttributeType.STRING }`
        - `billingMode`: `dynamodb.BillingMode.PAY_PER_REQUEST` (on-demand)
        - `timeToLiveAttribute`: `'expiresAt'`
        - `pointInTimeRecovery`: `true`
        - `deletionProtection`: `true` (set to `false` for dev via a condition on the Environment parameter)
        - `removalPolicy`: `RemovalPolicy.RETAIN`
    3. Add a Global Secondary Index `SyncGSI`:
        - `indexName`: `'SyncGSI'`
        - `partitionKey`: `{ name: 'GSI1PK', type: dynamodb.AttributeType.STRING }`
        - `sortKey`: `{ name: 'GSI1SK', type: dynamodb.AttributeType.STRING }`
        - `projectionType`: `dynamodb.ProjectionType.ALL`
    4. Apply tags (use `cdk.Tags.of(table).add()`):
        - `Project`: `pencil2`
        - `Feature`: `sync`
        - `Phase`: `2-infrastructure`
        - `Environment`: value from the `Environment` CfnParameter
        - `ManagedBy`: `cdk`

    **File**: `infra/lib/sync-stack.ts`

- [x] T011 [US1] Add Cognito Identity Pool to CDK stack in `infra/lib/sync-stack.ts`

    **Exact specification** (read `specs/002-aws-infrastructure/data-model.md` — Cognito section):
    1. Import `aws_cognito as cognito` from `aws-cdk-lib` — note: for Identity Pools, use `CfnIdentityPool` (L1 construct)
    2. Create a `cognito.CfnIdentityPool` with:
        - `identityPoolName`: `'PencilSyncPool'`
        - `allowUnauthenticatedIdentities`: `false`
        - `developerProviderName`: `'login.pencil.school'`
    3. Apply the same tags as the DynamoDB table
    4. Store the Identity Pool `ref` for use in IAM role creation (next task)

    **File**: `infra/lib/sync-stack.ts`

- [x] T012 [US1] Add IAM roles for Cognito authenticated access to CDK stack in `infra/lib/sync-stack.ts`

    **Exact specification** (read `specs/002-aws-infrastructure/contracts/iam-permissions.md` for the full policy JSON):
    1. Import `aws_iam as iam` from `aws-cdk-lib`
    2. Create the authenticated role `PencilSyncAuthRole`:
        - Trust policy: federated principal `cognito-identity.amazonaws.com`
        - Conditions:
            - `StringEquals`: `cognito-identity.amazonaws.com:aud` = Identity Pool ID (use `identityPool.ref`)
            - `ForAnyValue:StringLike`: `cognito-identity.amazonaws.com:amr` = `authenticated`
        - Action: `sts:AssumeRoleWithWebIdentity`
    3. Add permissions policy with 3 statements:
        - **AllowDynamoDBBaseTable**: Allow `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `BatchGetItem`, `BatchWriteItem` on the table ARN, with condition `ForAllValues:StringEquals` on `dynamodb:LeadingKeys` = `["SCHOOL#${cognito-identity.amazonaws.com:sub}"]`
        - **AllowDynamoDBGSIQuery**: Allow `Query` on the GSI ARN (`table/pencil2-sync/index/SyncGSI`), same `LeadingKeys` condition
        - **DenyScan**: Explicit `Deny` on `dynamodb:Scan` for `table/pencil2-sync*` (wildcard covers table + all indexes)
    4. Create `CfnIdentityPoolRoleAttachment`:
        - `identityPoolId`: `identityPool.ref`
        - `roles`: `{ authenticated: authenticatedRole.roleArn }`

    **File**: `infra/lib/sync-stack.ts`

- [x] T013 [US1] Add Secrets Manager secret reference and Auth Lambda to CDK stack in `infra/lib/sync-stack.ts`

    **Exact specification**:
    1. Import `aws_lambda as lambda`, `aws_secretsmanager as secretsmanager` from `aws-cdk-lib`
    2. Reference an existing Secrets Manager secret by name (do NOT create a new secret — it must be pre-created by the deployer):
        - Use `secretsmanager.Secret.fromSecretNameV2(this, 'LicenseSecret', 'pencil2/license-secret')`
    3. Create the Auth Lambda function:
        - Use `lambda.Function` (NOT `NodejsFunction` — the handler is plain JS, no TypeScript/bundling needed)
        - `functionName`: `'pencil2-sync-auth'`
        - `runtime`: `lambda.Runtime.NODEJS_18_X`
        - `handler`: `'index.handler'`
        - `code`: `lambda.Code.fromAsset(path.join(__dirname, 'auth-lambda'))` — this bundles the `auth-lambda/` directory
        - `timeout`: `cdk.Duration.seconds(10)`
        - `memorySize`: `256`
        - `environment`:
            - `COGNITO_IDENTITY_POOL_ID`: `identityPool.ref`
            - `DEVELOPER_PROVIDER_NAME`: `'login.pencil.school'`
            - `SECRET_ARN`: `licenseSecret.secretArn`
    4. Grant the Lambda permission to read the secret: `licenseSecret.grantRead(authLambda)`
    5. Grant the Lambda permission to call Cognito `GetOpenIdTokenForDeveloperIdentity`:
        - Add an inline policy with `cognito-identity:GetOpenIdTokenForDeveloperIdentity` and `cognito-identity:LookupDeveloperIdentity` on the Identity Pool ARN
    6. Add a Lambda Function URL for HTTPS access:
        - `authUrl = authLambda.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE })` (public endpoint — auth is via license key validation)
    7. Apply tags to the Lambda function
    8. Output the Function URL: `new cdk.CfnOutput(this, 'AuthLambdaUrl', { value: authUrl.url })`
    9. Output the Identity Pool ID: `new cdk.CfnOutput(this, 'IdentityPoolId', { value: identityPool.ref })`
    10. Output the DynamoDB table name: `new cdk.CfnOutput(this, 'SyncTableName', { value: table.tableName })`

    **File**: `infra/lib/sync-stack.ts`

- [x] T014 [US1] Create CDK template assertion tests in `infra/test/sync-stack.test.ts`

    **Exact test cases** (use `aws-cdk-lib/assertions`):
    1. Test that the synthesized template contains a DynamoDB table with:
        - `TableName`: `pencil2-sync`
        - `BillingMode`: `PAY_PER_REQUEST`
        - `KeySchema` includes `PK` (HASH) and `SK` (RANGE)
        - `TimeToLiveSpecification.AttributeName`: `expiresAt`
        - `PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled`: `true`
    2. Test that the template contains a GSI named `SyncGSI` with `GSI1PK` (HASH) and `GSI1SK` (RANGE)
    3. Test that the template contains a `CfnIdentityPool` with `AllowUnauthenticatedIdentities`: `false` and `DeveloperProviderName`: `login.pencil.school`
    4. Test that the template contains a Lambda function with runtime `nodejs18.x`
    5. Test that the template contains an IAM role with a policy that includes `dynamodb:LeadingKeys` condition
    6. Test that the template contains a Deny statement for `dynamodb:Scan`
    7. Test that a `CfnIdentityPoolRoleAttachment` exists
    8. Test that there are 3 `CfnOutput` resources (AuthLambdaUrl, IdentityPoolId, SyncTableName)

    **File**: `infra/test/sync-stack.test.ts`

**Checkpoint**: After T014, run `cd infra && npm run build && npx cdk synth` — should produce a complete CloudFormation template. Run `npx jest test/sync-stack.test.ts` — all assertion tests should pass.

---

## Phase 4: User Story 2 — School Authenticates and Receives Scoped Credentials (Priority: P1)

**Goal**: The Auth Lambda validates a Pencil2 license key and returns temporary AWS credentials scoped to that school's DynamoDB partition.

**Independent Test**: Invoke the Auth Lambda with a test license key and verify the response contains `identityId`, `token`, and `schoolId`. Then use the returned credentials to verify DynamoDB access is partition-scoped.

**Note**: The implementation for this story was completed in Phase 2 (T007, T008, T009) — the Lambda handler and license validator are already written and tested. This phase validates the end-to-end flow after deployment.

### Implementation for User Story 2

- [x] T015 [US2] Add request input validation with detailed error messages to `infra/lib/auth-lambda/index.js`

    **Exact behavior** (enhance the handler from T008):
    1. If `event.body` is a string, `JSON.parse()` it; if parsing fails, return 400 `MALFORMED_REQUEST` with message `'Invalid JSON in request body'`
    2. Validate `licenseKey`:
        - Missing or empty: return 400 `'Missing required field: licenseKey'`
        - Not a string: return 400 `'licenseKey must be a string'`
    3. Validate `deviceHash`:
        - Missing or empty: return 400 `'Missing required field: deviceHash'`
        - Does not match `/^[a-f0-9]{64}$/`: return 400 `'deviceHash must be a 64-character lowercase hex string'`
    4. Add response headers to ALL responses: `{ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }`

    **File**: `infra/lib/auth-lambda/index.js`

- [x] T016 [US2] Add Secrets Manager caching with cold-start optimization to `infra/lib/auth-lambda/index.js`

    **Exact behavior**:
    1. Declare a module-level variable: `let cachedSecret = null;`
    2. Create an async function `getSigningSecret()`:
        - If `cachedSecret` is not null, return it immediately (warm invocation)
        - Otherwise, create a `SecretsManagerClient` and call `GetSecretValueCommand({ SecretId: process.env.SECRET_ARN })`
        - Store the result's `SecretString` in `cachedSecret`
        - Return `cachedSecret`
    3. The handler calls `await getSigningSecret()` before validating the license key
    4. If Secrets Manager call fails, return 500 `INTERNAL_ERROR` — do NOT expose the error details

    **File**: `infra/lib/auth-lambda/index.js`

**Checkpoint**: After T016, the Auth Lambda handler is complete with full validation, caching, and error handling. All unit tests from T009 should still pass.

---

## Phase 5: User Story 3 — DynamoDB Table Supports Sync Operations (Priority: P1)

**Goal**: The DynamoDB table schema supports push writes and pull queries for all 17 entity types used by the sync engine.

**Independent Test**: Deploy the stack, then manually write sample items using the AWS CLI with different entity types and query the GSI to verify chronological ordering.

**Note**: The DynamoDB table was already defined in T010 with correct keys, GSI, TTL, and capacity mode. This phase adds documentation and validation artifacts that confirm schema correctness.

### Implementation for User Story 3

- [x] T017 [P] [US3] Create `infra/lib/auth-lambda/schema-constants.js` — export DynamoDB key patterns for all 17 entity types

    **Exact content**: Create a module that exports constants used by the sync engine (Phases 3–4) for constructing DynamoDB keys:

    ```javascript
    // Sort key prefix constants for all synced entity types
    // These MUST match the patterns in specs/002-aws-infrastructure/contracts/dynamodb-schema.md
    const ENTITY_SK_PREFIX = {
        student: 'STUDENT',
        grade: 'GRADE',
        absence: 'ABSENCE',
        teacher: 'TEACHER',
        teacher_alias: 'TEACHER_ALIAS',
        staff_attendance: 'STAFF_ATTENDANCE',
        teacher_absence: 'TEACHER_ABSENCE',
        exam: 'EXAM',
        exam_proctor: 'EXAM_PROCTOR',
        exam_room: 'EXAM_ROOM',
        test: 'TEST',
        correspondence: 'CORRESPONDENCE',
        student_file: 'STUDENT_FILE',
        student_movement: 'STUDENT_MOVEMENT',
        compensation: 'COMPENSATION',
        settings: 'SETTINGS',
        page_visibility: 'PAGE_VISIBILITY'
    };

    const SCHOOL_PK_PREFIX = 'SCHOOL#';
    const GSI_NAME = 'SyncGSI';
    const TABLE_NAME = 'pencil2-sync';

    module.exports = { ENTITY_SK_PREFIX, SCHOOL_PK_PREFIX, GSI_NAME, TABLE_NAME };
    ```

    **File**: `infra/lib/auth-lambda/schema-constants.js`

- [x] T018 [P] [US3] Add schema validation tests to `infra/test/sync-stack.test.ts` — verify GSI projection and key types

    **Exact test cases** (append to existing file from T014):
    1. Test that the GSI `SyncGSI` has `ProjectionType: ALL`
    2. Test that the GSI key schema has `GSI1PK` as HASH and `GSI1SK` as RANGE
    3. Test that `AttributeDefinitions` includes all 4 key attributes: `PK` (S), `SK` (S), `GSI1PK` (S), `GSI1SK` (S)
    4. Test that `TimeToLiveSpecification` is enabled with `AttributeName: expiresAt`

    **File**: `infra/test/sync-stack.test.ts`

**Checkpoint**: After T018, all CDK assertion tests pass, confirming the table schema matches the spec.

---

## Phase 6: User Story 4 — Infrastructure Costs Remain Predictable (Priority: P2)

**Goal**: AWS resources are configured with cost-control mechanisms to stay under $10/month for a 10-school deployment.

**Independent Test**: Review the synthesized CloudFormation template and verify: on-demand capacity (no provisioned WCU/RCU), TTL enabled, no unnecessary resources.

### Implementation for User Story 4

- [x] T019 [US4] Add deletion protection toggle based on Environment parameter in `infra/lib/sync-stack.ts`

    **Exact behavior**:
    1. Read the `Environment` parameter value
    2. Create a `CfnCondition` named `IsProd`:
        - Condition: `Environment` parameter equals `'prod'`
    3. Set the DynamoDB table's `deletionProtection` property:
        - Use `cdk.Fn.conditionIf()` or set it directly based on environment
        - In `dev`/`staging`: `deletionProtection: false` (allows easy teardown)
        - In `prod`: `deletionProtection: true`
    4. Set the DynamoDB table's `removalPolicy`:
        - In `dev`: `RemovalPolicy.DESTROY` (table deleted when stack is destroyed)
        - In `prod`/`staging`: `RemovalPolicy.RETAIN` (table preserved even if stack is destroyed)

    **File**: `infra/lib/sync-stack.ts`

- [x] T020 [US4] Add cost-related assertion tests to `infra/test/sync-stack.test.ts`

    **Exact test cases** (append to existing file):
    1. Test that the DynamoDB table uses `PAY_PER_REQUEST` (not `PROVISIONED`) billing mode
    2. Test that TTL is enabled (already tested in T018 — just confirm no regression)
    3. Test that there is no `ProvisionedThroughput` property set on the table
    4. Test that there is no `ProvisionedThroughput` on the GSI

    **File**: `infra/test/sync-stack.test.ts`

**Checkpoint**: After T020, all tests pass. The stack is configured for cost-effective deployment.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, and cleanup.

- [x] T021 [P] Add `.gitignore` entries for CDK build artifacts in `infra/.gitignore`

    **Exact content**:

    ```
    node_modules/
    cdk.out/
    *.js
    !lib/auth-lambda/*.js
    !test/*.js
    *.d.ts
    ```

    **File**: `infra/.gitignore`

- [x] T022 [P] Add Jest configuration for the infra project in `infra/package.json`

    **Exact addition** to `infra/package.json` — add a `jest` section:

    ```json
    "jest": {
      "testEnvironment": "node",
      "roots": ["<rootDir>/test"],
      "testMatch": ["**/*.test.ts", "**/*.test.js"],
      "transform": {
        "^.+\\.tsx?$": "ts-jest"
      }
    }
    ```

    **File**: `infra/package.json`

- [x] T023 Verify end-to-end: build, synth, and run all tests for the `infra/` project

    **Exact steps**:
    1. `cd infra && npm install`
    2. `npm run build` — TypeScript compilation should succeed with no errors
    3. `npx cdk synth` — should produce a valid CloudFormation template
    4. `npx jest` — all tests (Lambda unit tests + CDK assertion tests) should pass
    5. Review the synthesized template in `infra/cdk.out/` — verify it contains:
        - 1 DynamoDB table with 1 GSI
        - 1 Cognito Identity Pool
        - 1 Lambda function
        - 2 IAM roles (authenticated role + Lambda execution role)
        - 1 Identity Pool role attachment
        - 3 stack outputs

**Checkpoint**: All builds pass, all tests pass, the CDK template is ready for deployment.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion (T001–T006) — the CDK project must exist before Lambda code is written
- **User Story 1 (Phase 3)**: Depends on Phase 2 completion (T007–T009) — the Lambda code must exist before the CDK stack can reference it
- **User Story 2 (Phase 4)**: Depends on Phase 3 completion (T010–T014) — the CDK stack must define Cognito + Secrets Manager before Lambda can use them
- **User Story 3 (Phase 5)**: Can start after Phase 3 (T010) — only needs the DynamoDB table definition
- **User Story 4 (Phase 6)**: Can start after Phase 3 (T010) — only modifies DynamoDB table properties
- **Polish (Phase 7)**: Depends on all previous phases

### Within Each Phase

- Tasks marked [P] can run in parallel
- Sequential tasks depend on prior tasks in the same phase

### Parallel Opportunities

```
Phase 1:  T001 → T002 → [T003, T004] in parallel → T005 → T006
Phase 2:  T007 → T008 → T009
Phase 3:  T010 → T011 → T012 → T013 → T014
Phase 4:  [T015, T016] in parallel (both modify index.js but different sections)
Phase 5:  [T017, T018] in parallel (different files)
Phase 6:  T019 → T020
Phase 7:  [T021, T022] in parallel → T023
```

---

## Parallel Example: Phase 1 Setup

```
# These can run in parallel (different files):
T003: Create infra/tsconfig.json
T004: Create infra/cdk.json
```

## Parallel Example: Phase 5 Schema Validation

```
# These can run in parallel (different files):
T017: Create infra/lib/auth-lambda/schema-constants.js
T018: Add schema validation tests to infra/test/sync-stack.test.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T006)
2. Complete Phase 2: Foundational Lambda code (T007–T009)
3. Complete Phase 3: CDK stack with all resources (T010–T014)
4. **STOP and VALIDATE**: Run `npx cdk synth` and `npx jest` — everything should pass
5. Deploy with `npx cdk deploy` to verify real AWS resources

### Incremental Delivery

1. Setup + Foundational + US1 → Deployable infrastructure (MVP!)
2. Add US2 → Enhanced validation and caching
3. Add US3 → Schema constants for Phase 3/4 integration
4. Add US4 → Cost optimization toggles
5. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- The `infra/` directory is completely isolated from the Electron app — no changes to `main/`, `js/`, or `preload.js` are required
- The Auth Lambda uses plain JavaScript (not TypeScript) to avoid bundling complexity — CDK's `Code.fromAsset()` packages the directory as-is
- The signing secret (`GESTION_LICENSE_SECRET`) must be pre-stored in AWS Secrets Manager before deploying — this is a manual prerequisite, not automated by the CDK stack
