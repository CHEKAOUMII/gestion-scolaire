# Data Model: Hide License Key Field from Sync Settings UI

**Feature**: `018-hide-sync-license-field`
**Date**: 2026-03-26

## Overview

This feature introduces **no data model changes**. The `sync_config` table and its `license_key` column remain unchanged. The only change is that the UI no longer reads from or writes to this column via the form save operation.

## Existing Entity (unchanged)

### sync_config

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | Primary key (always 1, singleton row) |
| enabled | INTEGER | 0 or 1 |
| school_id | TEXT | School identifier |
| auth_lambda_url | TEXT | Auth endpoint URL |
| aws_region | TEXT | AWS region (default: us-east-1) |
| sync_interval_minutes | INTEGER | Sync frequency |
| push_batch_size | INTEGER | Batch size for push operations |
| max_retries | INTEGER | Max retry count |
| retention_days | INTEGER | Data retention period |
| snapshot_interval_minutes | INTEGER | Snapshot frequency |
| license_key | TEXT, nullable | **Auto-managed** — no longer editable via UI |

## Data Flow Change

**Before**: `loadConfig()` reads `license_key` → populates form field → admin may edit → `initConfigForm()` submit reads field → sends `licenseKey` in save payload → backend writes to DB.

**After**: `loadConfig()` reads `license_key` → populates hidden form field (harmless) → `initConfigForm()` submit does NOT read or send `licenseKey` → backend never receives `licenseKey` from form → existing auto-managed value preserved.
