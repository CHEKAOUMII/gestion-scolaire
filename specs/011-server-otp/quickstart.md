# Quickstart: Server-Side OTP (Lambda + DynamoDB)

**Feature**: 011-server-otp | **Date**: 2026-03-22

## What This Feature Does

Adds server-side OTP verification as a fallback for device linking when devices are NOT on the same LAN. Device 1 (admin) publishes an encrypted sync config to the cloud via the existing Lambda. Device 2 (linking) verifies the OTP via the cloud and decrypts the config locally.

## Prerequisites

1. Phase 7.1 (DB Schema) — `institution_config`, `sync_config`, `users` tables exist
2. Phase 7.2 (OTP Module) — `main/linking/otp.js` is complete, `generateOtp()` works
3. AWS infrastructure deployed — `pencil2-sync` DynamoDB table + `pencil2-sync-auth` Lambda
4. Valid license key configured in `sync_config`

## Files Overview

| File | Role |
|------|------|
| `main/linking/server.js` | **NEW** — Client module: publish + verify + encrypt/decrypt |
| `infra/lib/auth-lambda/index.js` | **MODIFIED** — Add path routing + 2 new handlers |
| `infra/lib/auth-lambda/schema-constants.js` | **MODIFIED** — Add OTP key constants |
| `infra/lib/sync-stack.ts` | **MODIFIED** — Grant Lambda DynamoDB permissions for OTP items |

## How It Works

### Publish Flow (Device 1 → Server)

```
Device 1                          Lambda                    DynamoDB
   │                                │                         │
   ├─ generateOtp() ──► otpPlain    │                         │
   ├─ deriveKey(otpPlain) ──► key   │                         │
   ├─ encrypt(config, key) ──► enc  │                         │
   │                                │                         │
   ├─ POST /link/publish-otp ──────►│                         │
   │  {licenseKey, deviceHash,      │                         │
   │   massar, otpHash, enc, iv,    │                         │
   │   authTag}                     │                         │
   │                                ├─ validateLicense ──►ok  │
   │                                ├─ checkMassarMatch ──►ok │
   │                                ├─ PutItem ──────────────►│
   │                                │  PK=OTP#M320456         │
   │                                │  SK=ACTIVE              │
   │                                │  expiresAt=now+600      │
   │◄── {success, expiresAt} ──────┤                         │
```

### Verify Flow (Device 2 → Server)

```
Device 2                          Lambda                    DynamoDB
   │                                │                         │
   ├─ POST /link/verify-otp ──────►│                         │
   │  {massar, otp}                 │                         │
   │                                ├─ GetItem ◄─────────────┤
   │                                │  PK=OTP#M320456         │
   │                                │  SK=ACTIVE              │
   │                                ├─ checkExpiry ──►ok      │
   │                                ├─ checkRateLimit ──►ok   │
   │                                ├─ scryptVerify ──►ok     │
   │                                ├─ markUsed ─────────────►│
   │◄── {enc, iv, authTag} ────────┤                         │
   │                                │                         │
   ├─ deriveKey(otpPlain) ──► key   │                         │
   ├─ decrypt(enc, key) ──► config  │                         │
   └─ importConfig(config)          │                         │
```

## Key Design Decisions

1. **End-to-end encryption**: Lambda never sees sync config plaintext. OTP is the key material.
2. **HKDF key derivation**: `crypto.hkdfSync('sha256', otp, 'pencil2-link-v1', 'otp-payload-key', 32)`
3. **Scrypt in Lambda**: 8 lines of verification logic duplicated from `password.js` (not imported).
4. **Rate limiting**: Atomic DynamoDB UpdateItem with ConditionExpression (5 failures max).
5. **TTL**: Explicit `expiresAt` check in code — DynamoDB TTL is eventual (up to 48h lag).
6. **IAM scoping**: Lambda can only touch `OTP#*` items via `dynamodb:LeadingKeys` condition.

## Testing Approach

1. **Lambda unit tests**: Mock DynamoDB, test routing, publish, verify, rate limiting, expiry
2. **Client unit tests**: Test encryption/decryption round-trip, error handling
3. **Integration test**: Publish from one device, verify from another (requires deployed Lambda)
4. **Smoke test**: `npm run test:smoke` — no IPC changes in this phase, channel count unchanged
5. **Lint**: `npm run lint` for `main/linking/server.js`

## Common Pitfalls

- `hkdfSync` returns `ArrayBuffer`, not `Buffer` — wrap with `Buffer.from(...)`
- DynamoDB `expiresAt` must be a Number (Unix seconds), not a String (ISO 8601)
- The Lambda Function URL path is in `event.requestContext.http.path`, not `event.path`
- Scrypt options must match defaults (N=16384, r=8, p=1) — don't pass custom options
- `authLambdaUrl` may have a trailing slash — strip it before appending `/link/...`
