# Research: Server-Side OTP (Lambda + DynamoDB)

**Feature**: 011-server-otp | **Date**: 2026-03-22

## R-001: Node.js 18 Crypto Capabilities in Lambda

**Decision**: Use built-in `node:crypto` for all cryptographic operations — zero npm dependencies needed in the Lambda.

**Rationale**: All four required crypto primitives are available in Node.js 18 (the Lambda runtime):

| API | Available Since | Use Case |
|-----|----------------|----------|
| `crypto.hkdfSync('sha256', ikm, salt, info, 32)` | v15.0.0 | Derive AES-256 key from OTP plaintext |
| `crypto.scryptSync(password, salt, 64)` | v10.5.0 | Verify OTP hash (same as `password.js`) |
| `crypto.timingSafeEqual(a, b)` | v6.6.0 | Constant-time hash comparison |
| `crypto.createCipheriv('aes-256-gcm', key, iv)` | v0.1.94 | Encrypt/decrypt sync config payload |

**Key detail**: `hkdfSync` returns an `ArrayBuffer`, not a `Buffer`. Must wrap with `Buffer.from(crypto.hkdfSync(...))` before use with other crypto APIs.

**Alternatives considered**:
- `crypto.pbkdf2Sync` for key derivation — rejected because HKDF is purpose-built for deriving keys from existing key material, while PBKDF2 is for passwords. OTP is already random, so HKDF is the correct primitive.
- External npm package for HKDF — rejected, Node.js 18 has it built-in.

## R-002: Scrypt Verification in Lambda

**Decision**: Duplicate the scrypt verification logic (8 lines) directly in the Lambda handler. Do not import from `main/auth/password.js`.

**Rationale**: `main/auth/password.js` is a main-process module not deployed to Lambda. The verification logic is minimal:

1. Split stored hash on `$` → `['scrypt', saltHex, hashHex]`
2. `crypto.scryptSync(submittedOtp, saltHex, 64).toString('hex')`
3. `crypto.timingSafeEqual(Buffer.from(hashHex, 'hex'), Buffer.from(computed, 'hex'))`

The default scrypt parameters (N=16384, r=8, p=1) are used by the project — no custom options, so the Lambda defaults will match exactly.

**Alternatives considered**:
- Shared module extracted from `password.js` — rejected because it would require restructuring deployed Lambda code for 8 lines of logic.
- Sending the OTP hash verification to a separate Lambda — over-engineered.

## R-003: DynamoDB IAM Scoping for OTP Items

**Decision**: Scope the Lambda's DynamoDB permissions to `OTP#*` leading keys using `ForAllValues:StringLike` condition.

**Rationale**: The existing CDK stack uses `ForAllValues:StringEquals` with `dynamodb:LeadingKeys` for Cognito-authenticated roles (exact `SCHOOL#<sub>` match). For the Lambda, the PK is `OTP#<massar>` where the MASSAR code varies, so `StringLike` with `OTP#*` wildcard is required.

**CDK implementation**:
```ts
authLambda.addToRolePolicy(new iam.PolicyStatement({
    sid: 'AllowDynamoDBOtpItems',
    effect: iam.Effect.ALLOW,
    actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
    resources: [table.tableArn],
    conditions: {
        'ForAllValues:StringLike': {
            'dynamodb:LeadingKeys': ['OTP#*']
        }
    }
}));
```

**Caveat**: `ForAllValues` returns true on empty key sets (e.g. Scan). Since we only grant item-level actions (no Query/Scan), this is safe.

**Alternatives considered**:
- Full table access (`table.grantReadWriteData(authLambda)`) — rejected for least-privilege principle. The Lambda should not touch sync data items.
- Separate DynamoDB table for OTPs — rejected, the existing `pencil2-sync` table already has TTL enabled and the OTP items are a natural fit.

## R-004: DynamoDB TTL Behavior

**Decision**: Always check `expiresAt` explicitly in application code. Never rely on DynamoDB TTL for security-critical expiration.

**Rationale**: DynamoDB TTL deletion is "best effort" — items are *typically* deleted within minutes but the SLA is up to **48 hours**. An expired item CAN still be returned by GetItem. For OTP security, the Lambda must explicitly check `if (item.expiresAt <= currentUnixSeconds) → reject as expired`.

DynamoDB TTL serves only as eventual garbage collection to prevent item accumulation.

**Alternatives considered**: None — this is the only correct approach per AWS documentation.

## R-005: DynamoDB Rate Limiting Pattern

**Decision**: Use atomic `UpdateItem` with combined `ConditionExpression` + `UpdateExpression` for rate limiting.

**Rationale**: Single round-trip, single WCU, no TOCTOU race condition:

```
UpdateExpression:    SET failureCount = if_not_exists(failureCount, :zero) + :one
ConditionExpression: attribute_not_exists(failureCount) OR failureCount < :max
```

If `failureCount >= 5`, the operation fails with `ConditionalCheckFailedException`. Otherwise, it atomically increments. Concurrent requests are serialized by DynamoDB — no lost updates.

**Alternatives considered**:
- In-memory rate limiting in Lambda — rejected because Lambda instances are stateless; concurrent instances wouldn't share state.
- Separate rate-limit table — over-engineered; the counter belongs on the OTP item itself.

## R-006: Encrypted Payload Size

**Decision**: Set max encrypted payload at 300KB. Realistic payloads are ~10-14KB.

**Rationale**: Estimated payload for a school with 20 user accounts:
- Sync config fields (URL, region, key, interval): ~200 bytes
- Institution info (MASSAR, name in Arabic UTF-8): ~160 bytes
- 20 user accounts × ~350 bytes each: ~7,000 bytes
- JSON overhead: ~500 bytes
- **Total unencrypted: ~8-10 KB**
- After AES-256-GCM + base64: **~11-14 KB**

Even with 100 users: ~50-60 KB. Well under the 300KB application limit and 400KB DynamoDB limit.

**Alternatives considered**: Compressing the payload before encryption — unnecessary, the sizes are trivially small.

## R-007: Lambda Path-Based Routing

**Decision**: Add path routing by inspecting `event.requestContext.http.path` in the Lambda handler, with a `routeRequest()` dispatcher function.

**Rationale**: The existing Lambda handler has no path routing — it handles all requests at the root. Lambda Function URLs provide the request path in `event.requestContext.http.path` (or `event.rawPath` as a shorthand). The handler will dispatch to:
- `/` or empty → existing credential-exchange logic (moved to a `handleCredentialExchange()` function)
- `/link/publish-otp` → new publish handler
- `/link/verify-otp` → new verify handler
- Anything else → 404

**Alternatives considered**:
- API Gateway with route-based Lambda integrations — rejected, the existing architecture uses a Lambda Function URL. Adding API Gateway would be a separate infrastructure change.
- Separate Lambda for OTP endpoints — rejected, single Lambda is simpler and shares the license validation logic.
