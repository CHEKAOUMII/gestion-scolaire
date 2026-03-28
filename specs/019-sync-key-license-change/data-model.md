# Data Model: Update Sync Key on License Status Change

**Feature**: 019-sync-key-license-change
**Date**: 2026-03-26

## Existing Entities (No Schema Changes Required)

This feature does not introduce new database tables or columns. It operates on existing entities.

### sync_config (existing table)

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | INTEGER | NO | Primary key (always 1, single-row table) |
| license_key | TEXT | YES | Sync authentication key. Set by Features 1/2, cleared by this feature |
| school_id | TEXT | YES | School identifier for DynamoDB scoping |
| ... | ... | ... | Other sync configuration fields |

**Mutations by this feature**:
- `UPDATE sync_config SET license_key = NULL WHERE id = 1` — on deactivation, expiration, or invalid status
- No new columns, no new indexes, no migration needed

### licenses (existing table, read-only by this feature)

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| status | TEXT | DB-stored status: 'active', 'suspended', 'inactive', 'revoked' |
| expires_at | TEXT | ISO timestamp for license expiration |
| plan_code | TEXT | Plan tier: 'basic', 'pro', 'business' |
| grace_period_days | INTEGER | Days of grace after expiration |

### license_activations (existing table, read-only by this feature)

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| license_id | INTEGER | FK to licenses |
| revoked_at | TEXT | Set by deactivateCurrentDevice; NULL = active |

## State Transitions

```
sync_config.license_key lifecycle:

  NULL (initial)
    │
    ├─ activateLicense() ──────► "GSLK-<base64>.<sig>" (paid key)
    │                                │
    │                                ├─ deactivateCurrentDevice() ──► NULL
    │                                ├─ license expires ────────────► NULL
    │                                ├─ grace_expired ─────────────► NULL
    │                                ├─ suspended/inactive/revoked ► NULL
    │                                └─ re-activate ───────────────► new "GSLK-..." key
    │
    ├─ ensureTrialSyncKey() ───► "GSLK-<trial-key>"
    │                                │
    │                                ├─ activateLicense() (upgrade) ► "GSLK-<paid>" (replaced)
    │                                ├─ trial expires ─────────────► NULL
    │                                └─ deactivation ──────────────► NULL
    │
    └─ (stays NULL if no license and no trial)
```

## In-Memory State

### _cachedCredentials (in credentials.js)

| Field | Type | Description |
|-------|------|-------------|
| accessKeyId | string | AWS temporary access key |
| secretAccessKey | string | AWS temporary secret key |
| sessionToken | string | AWS session token |
| expiresAt | number | Credential expiry timestamp |
| identityId | string | Cognito identity ID |
| schoolId | string | School identifier from auth response |

**Cleared by**: `clearCredentials()` — sets `_cachedCredentials = null` and `_refreshPromise = null`

**TTL**: 600 seconds (10 minutes) buffer before actual AWS credential expiry. After `clearCredentials()`, the next `getCredentials()` call forces a full re-auth cycle (read license key from DB → POST to Auth Lambda → Cognito GetCredentialsForIdentity).
