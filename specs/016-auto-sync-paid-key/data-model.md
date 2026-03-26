# Data Model: Save License Key on Paid Activation

**Feature**: `016-auto-sync-paid-key`
**Date**: 2026-03-26

## Entities

### sync_config (existing table — no schema changes)

Single-row configuration table (`id = 1`). The `license_key` column already exists (added by migration `2026-03-034`).

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Always 1 (CHECK constraint) |
| license_key | TEXT (nullable) | **Target column** — stores the normalized key (`GSLK-<base64>.<signature>`) |
| enabled | INTEGER | Sync enabled flag |
| sync_interval_minutes | INTEGER | Sync polling interval |
| auth_lambda_url | TEXT | Auth Lambda endpoint |
| aws_region | TEXT | AWS region for Cognito |
| school_id | TEXT | School identifier |
| ... | ... | Other sync config columns |

### License Key Flow

```
User enters key
    ↓
activateLicense({ licenseKey })
    ↓
decodeOfflineLicenseKey(licenseKey)
    ↓
decoded.normalizedKey  ──→  sha256() ──→ licenses.license_key_hash
         │
         └──→ UPDATE sync_config SET license_key = ? WHERE id = 1
                         │
                         ↓
              readLicenseKey(db)  ──→  refreshCredentials()  ──→  Auth Lambda
```

## State Transitions

No state machine changes. The `sync_config.license_key` column transitions from:
- `NULL` → populated (first paid activation)
- populated → overwritten (new paid key activation)

## Validation Rules

- The key value stored must be the exact `decoded.normalizedKey` string (no trimming, no hashing)
- No length validation needed — the key format is controlled by `createOfflineLicenseKey()`
- NULL is a valid state (no key saved yet)
