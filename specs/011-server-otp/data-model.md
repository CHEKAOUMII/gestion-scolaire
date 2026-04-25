# Data Model: Server-Side OTP (Lambda + DynamoDB)

**Feature**: 011-server-otp | **Date**: 2026-03-22

## Entities

### 1. Server OTP Item (DynamoDB)

Stored in the existing `pencil2-sync` DynamoDB table. One item per institution (MASSAR code) at a time.

**Key Schema**:

| Attribute | Type | Value | Purpose |
|-----------|------|-------|---------|
| `PK` | String (Partition Key) | `OTP#<MASSAR>` | Groups by institution, e.g. `OTP#M320456` |
| `SK` | String (Sort Key) | `ACTIVE` | Fixed value — only one active OTP per institution |

**Attributes**:

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `otpHash` | String | Yes | Scrypt hash in format `scrypt$<saltHex>$<hashHex>` (same as `password.js`) |
| `encryptedPayload` | String | Yes | Base64-encoded AES-256-GCM ciphertext of sync config JSON |
| `iv` | String | Yes | Base64-encoded 12-byte initialization vector |
| `authTag` | String | Yes | Base64-encoded 16-byte GCM authentication tag |
| `schoolId` | String | Yes | `customerRef` from license key (should match MASSAR code) |
| `publishedBy` | String | Yes | Device hash (64-char hex) of the publishing admin device |
| `failureCount` | Number | No | Defaults to 0. Incremented on failed verify attempts. Max 5. |
| `status` | String | Yes | `active` or `used`. Initial: `active` |
| `usedAt` | String | No | ISO 8601 timestamp, set when OTP is consumed |
| `expiresAt` | Number | Yes | Unix epoch seconds. DynamoDB TTL attribute. Set to `now + 600` (10 min) |
| `createdAt` | String | Yes | ISO 8601 timestamp of creation |

**State Transitions**:

```
[Published] ──verify success──► [Used]     (status: active → used, usedAt set)
     │                                      Item eventually TTL-cleaned
     ├──────TTL expires────────► [Expired]  (item still exists up to 48h, app checks expiresAt)
     │
     ├──────5 failures─────────► [Rate-Limited] (failureCount >= 5, still status: active)
     │
     └──────new publish────────► [Replaced] (PutItem overwrites, new OTP active)
```

**Access Patterns**:

| Operation | DynamoDB API | Key | Condition |
|-----------|-------------|-----|-----------|
| Publish OTP | PutItem | `PK=OTP#<massar>, SK=ACTIVE` | None (unconditional overwrite) |
| Lookup OTP | GetItem | `PK=OTP#<massar>, SK=ACTIVE` | App checks `expiresAt > now` |
| Increment failures | UpdateItem | `PK=OTP#<massar>, SK=ACTIVE` | `failureCount < 5` (ConditionExpression) |
| Mark used | UpdateItem | `PK=OTP#<massar>, SK=ACTIVE` | Sets `status=used`, `usedAt` |
| Delete consumed | DeleteItem | `PK=OTP#<massar>, SK=ACTIVE` | Optional post-consumption cleanup |

### 2. Encrypted Config Payload (Transit Object)

Not stored directly — it is the plaintext that gets encrypted into `encryptedPayload`. This structure is shared with Phase 7.3 (LAN verification response) for consistency.

| Field | Type | Source Table | Description |
|-------|------|-------------|-------------|
| `syncConfig.school_id` | String | `sync_config` | Same as MASSAR code |
| `syncConfig.aws_region` | String | `sync_config` | e.g. `eu-west-1` |
| `syncConfig.auth_lambda_url` | String | `sync_config` | Lambda Function URL |
| `syncConfig.sync_interval_minutes` | Number | `sync_config` | Default 15 |
| `syncConfig.enabled` | Boolean | `sync_config` | Sync enabled flag |
| `institution.massar_code` | String | `institution_config` | e.g. `M320456` |
| `institution.institution_name` | String | `institution_config` | Arabic school name |
| `users[]` | Array | `users` | User accounts for import |
| `users[].name` | String | `users` | User display name |
| `users[].email` | String | `users` | User email (nullable) |
| `users[].role` | String | `users` | `admin`, `teacher`, etc. |
| `users[].password_hash` | String | `users` | Scrypt hash (transferred as-is) |
| `users[].pin_hash` | String | `users` | PIN hash (nullable) |
| `users[].must_change_password` | Number | `users` | 0 or 1 |

**Estimated size**: 8-14 KB (20 users), max ~60 KB (100 users). Well under 300KB limit.

### 3. Encryption Key Derivation (Runtime)

Not stored — derived at runtime on both devices using the OTP plaintext.

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Algorithm | HKDF-SHA256 | RFC 5869 key derivation |
| IKM | OTP plaintext (6-digit string) | Input keying material |
| Salt | `pencil2-link-v1` (fixed string) | Application-specific salt |
| Info | `otp-payload-key` (fixed string) | Context separation |
| Output Length | 32 bytes | AES-256 key |

**Encryption parameters**:

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM |
| Key | 32 bytes from HKDF |
| IV | 12 bytes, `crypto.randomBytes(12)` per encryption |
| Auth Tag | 16 bytes (GCM default) |

## Validation Rules

### MASSAR Code
- Regex: `/^[A-Za-z0-9]{5,10}$/`
- Normalized to uppercase before use as PK component
- Must match `customerRef` from license key on publish

### OTP Plaintext
- 6-digit numeric string: `/^\d{6}$/`
- Range: 100000–999999

### Device Hash
- 64-character lowercase hex: `/^[a-f0-9]{64}$/`

### Encrypted Payload
- Max size: 300KB (base64-encoded)
- Must be valid base64

### IV
- Must be valid base64
- Decoded length: exactly 12 bytes

### Auth Tag
- Must be valid base64
- Decoded length: exactly 16 bytes

## Relationships

```
Server OTP Item
    ├── references → License Key (via schoolId = customerRef)
    ├── contains  → Encrypted Config Payload (opaque to server)
    └── verified by → OTP plaintext (never stored on server)

Encrypted Config Payload (decrypted on Device 2)
    ├── sync_config → populates Device 2's sync_config table
    ├── institution → populates Device 2's institution_config table
    └── users[]    → imports into Device 2's users table
```
