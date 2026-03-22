# API Contract: Server-Side OTP Endpoints

**Feature**: 011-server-otp | **Date**: 2026-03-22
**Base URL**: `<auth_lambda_url>` (Lambda Function URL from `sync_config.auth_lambda_url`)

## Route Dispatching

The Lambda Function URL serves all routes. Path routing is determined by `event.requestContext.http.path`:

| Path | Method | Auth | Handler |
|------|--------|------|---------|
| `/` | POST | License key | Existing credential exchange (unchanged) |
| `/link/publish-otp` | POST | License key | Publish OTP hash + encrypted config |
| `/link/verify-otp` | POST | None (OTP is auth) | Verify OTP, return encrypted config |
| `*` (anything else) | Any | — | 404 NOT_FOUND |

---

## `POST /link/publish-otp`

Publishes an OTP hash and encrypted sync config to DynamoDB for server-side verification.

### Request

**Headers**: `Content-Type: application/json`

**Body**:
```json
{
    "licenseKey": "GSLK-<base64url_payload>.<base64url_signature>",
    "deviceHash": "a1b2c3...64chars",
    "massar": "M320456",
    "otpHash": "scrypt$<saltHex>$<hashHex>",
    "encryptedPayload": "<base64>",
    "iv": "<base64>",
    "authTag": "<base64>"
}
```

| Field | Type | Validation | Required |
|-------|------|-----------|----------|
| `licenseKey` | string | Must pass license-validator | Yes |
| `deviceHash` | string | `/^[a-f0-9]{64}$/` | Yes |
| `massar` | string | `/^[A-Za-z0-9]{5,10}$/`, must match license `customerRef` | Yes |
| `otpHash` | string | Must start with `scrypt$`, contain 3 `$`-separated parts | Yes |
| `encryptedPayload` | string | Valid base64, max 300KB decoded | Yes |
| `iv` | string | Valid base64, 12 bytes decoded | Yes |
| `authTag` | string | Valid base64, 16 bytes decoded | Yes |

### Responses

**200 OK** — OTP published successfully:
```json
{
    "success": true,
    "expiresAt": 1711234567
}
```

**400 MALFORMED_REQUEST** — Missing or invalid fields:
```json
{
    "error": "MALFORMED_REQUEST",
    "message": "Missing required field: massar"
}
```

**400 MASSAR_MISMATCH** — MASSAR code does not match license:
```json
{
    "error": "MASSAR_MISMATCH",
    "message": "MASSAR code does not match license customerRef"
}
```

**400 PAYLOAD_TOO_LARGE** — Encrypted payload exceeds 300KB:
```json
{
    "error": "PAYLOAD_TOO_LARGE",
    "message": "Encrypted payload exceeds maximum size of 300KB"
}
```

**401 INVALID_KEY** — License validation failed:
```json
{
    "error": "INVALID_KEY",
    "message": "Invalid license signature"
}
```

**401 EXPIRED_KEY** — License expired:
```json
{
    "error": "EXPIRED_KEY",
    "message": "License key expired on 2026-01-01T00:00:00.000Z"
}
```

**500 INTERNAL_ERROR** — Unexpected server error:
```json
{
    "error": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
}
```

### DynamoDB Effect

PutItem with unconditional overwrite:
```
PK: OTP#M320456
SK: ACTIVE
otpHash: scrypt$<salt>$<hash>
encryptedPayload: <base64>
iv: <base64>
authTag: <base64>
schoolId: M320456
publishedBy: <deviceHash>
failureCount: 0
status: active
expiresAt: <unix_epoch_seconds>  (now + 600)
createdAt: <ISO 8601>
```

---

## `POST /link/verify-otp`

Verifies an OTP and returns the encrypted sync config payload.

### Request

**Headers**: `Content-Type: application/json`

**Body**:
```json
{
    "massar": "M320456",
    "otp": "482917"
}
```

| Field | Type | Validation | Required |
|-------|------|-----------|----------|
| `massar` | string | `/^[A-Za-z0-9]{5,10}$/` | Yes |
| `otp` | string | `/^\d{6}$/` | Yes |

### Responses

**200 OK** — OTP verified, encrypted config returned:
```json
{
    "success": true,
    "encryptedPayload": "<base64>",
    "iv": "<base64>",
    "authTag": "<base64>"
}
```

**400 MALFORMED_REQUEST** — Missing or invalid fields:
```json
{
    "error": "MALFORMED_REQUEST",
    "message": "Missing required field: otp"
}
```

**404 NOT_FOUND** — No active OTP for this MASSAR code:
```json
{
    "error": "NOT_FOUND",
    "message": "No active OTP found for this institution"
}
```

**401 INVALID_OTP** — OTP verification failed:
```json
{
    "error": "INVALID_OTP",
    "message": "Invalid OTP code"
}
```

**410 OTP_EXPIRED** — OTP exists but TTL has passed:
```json
{
    "error": "OTP_EXPIRED",
    "message": "OTP has expired"
}
```

**410 OTP_USED** — OTP was already consumed:
```json
{
    "error": "OTP_USED",
    "message": "OTP has already been used"
}
```

**429 RATE_LIMITED** — Too many failed attempts (>= 5):
```json
{
    "error": "RATE_LIMITED",
    "message": "Too many failed attempts. Request a new OTP."
}
```

**500 INTERNAL_ERROR** — Unexpected server error:
```json
{
    "error": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
}
```

### DynamoDB Effect

**On failed verify**: Atomic UpdateItem increments `failureCount`:
```
UpdateExpression: SET failureCount = if_not_exists(failureCount, :zero) + :one
ConditionExpression: attribute_not_exists(failureCount) OR failureCount < :max
```
Throws `ConditionalCheckFailedException` if rate-limited → returns 429.

**On successful verify**: UpdateItem sets `status: used`, `usedAt: <ISO 8601>`.

---

## `POST /` (Existing — Unchanged)

The existing credential-exchange endpoint. No changes to request/response format.

### Request
```json
{
    "licenseKey": "GSLK-<payload>.<signature>",
    "deviceHash": "<64-char hex>"
}
```

### Response (200)
```json
{
    "identityId": "<cognito-identity-id>",
    "token": "<openid-token>",
    "schoolId": "<customerRef>",
    "expiresAt": 1711234567
}
```

All existing error responses (400, 401, 500) remain unchanged.

---

## Client Module Contract (`main/linking/server.js`)

### `publishOtpToServer(authLambdaUrl, licenseKey, deviceHash, massar, otpPlaintext, configPayload)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `authLambdaUrl` | string | Lambda Function URL (trailing slash stripped) |
| `licenseKey` | string | License key from `sync_config` |
| `deviceHash` | string | Current device hash (64-char hex) |
| `massar` | string | MASSAR code (uppercase) |
| `otpPlaintext` | string | 6-digit OTP (used for encryption key derivation + hashing) |
| `configPayload` | object | `{ syncConfig, institution, users }` — the plaintext to encrypt |

**Returns**: `Promise<{ success: true, expiresAt: number } | { success: false, error: string, code: string }>`

### `verifyOtpViaServer(authLambdaUrl, massar, otpPlaintext)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `authLambdaUrl` | string | Lambda Function URL |
| `massar` | string | MASSAR code |
| `otpPlaintext` | string | 6-digit OTP (used for verification + decryption key derivation) |

**Returns**: `Promise<{ success: true, configPayload: object } | { success: false, error: string, code: string }>`

### Internal Helpers (not exported)

- `deriveEncryptionKey(otpPlaintext)` → 32-byte Buffer (HKDF-SHA256)
- `encryptPayload(key, plaintext)` → `{ ciphertext, iv, authTag }` (all Buffers)
- `decryptPayload(key, ciphertext, iv, authTag)` → plaintext string
