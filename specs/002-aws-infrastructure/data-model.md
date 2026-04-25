# Data Model: AWS Infrastructure for DynamoDB Sync

**Feature**: 002-aws-infrastructure
**Date**: 2026-03-21

## DynamoDB Table: `pencil2-sync`

### Primary Key Design

| Attribute | Type | Role | Example |
|-----------|------|------|---------|
| `PK` | String | Partition key (school isolation) | `SCHOOL#SCHOOL-001` |
| `SK` | String | Sort key (entity type + identity) | `STUDENT#stu-001` |

### Global Secondary Index: `SyncGSI`

| Attribute | Type | Role | Example |
|-----------|------|------|---------|
| `GSI1PK` | String | GSI partition key (same as PK) | `SCHOOL#SCHOOL-001` |
| `GSI1SK` | String | GSI sort key (timestamp + type + id) | `1710000000#student#stu-001` |

**Projection**: ALL (full item copy in GSI for single-query pull sync)

### Item Envelope (all entity types)

Every item in the table follows this consistent structure:

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| `PK` | String | Yes | `SCHOOL#<customerRef>` — partition key |
| `SK` | String | Yes | `<ENTITY_TYPE>#<compositeId>` — sort key |
| `GSI1PK` | String | Yes | Same as `PK` |
| `GSI1SK` | String | Yes | `<updatedAt>#<entityType>#<entityId>` |
| `entityType` | String | Yes | Discriminator: `student`, `grade`, `absence`, `teacher`, `exam`, `settings`, etc. |
| `schoolYear` | String | Yes | Partition year: `2025/2026` |
| `updatedAt` | Number | Yes | Unix epoch seconds of last modification |
| `version` | Number | Yes | Optimistic locking counter, starts at 1 |
| `operation` | String | Yes | `PUT` or `DEL` |
| `rowSyncId` | String | Yes | Phase 1 sync ID: `{deviceHash}:{table_name}:{local_id}` |
| `deviceHash` | String | Yes | Originating device fingerprint (first 16 chars) |
| `data` | Map | Conditional | Full row payload (JSON object); NULL/omitted for `DEL` operations |
| `expiresAt` | Number | Conditional | TTL: Unix epoch seconds. Omitted for items that should not expire |

### Sort Key Patterns by Entity Type

| Entity Type | Sort Key Pattern | Example |
|-------------|-----------------|---------|
| `student` | `STUDENT#<studentCode>` | `STUDENT#stu-001` |
| `grade` | `GRADE#<studentCode>#<subject>#<semester>#<schoolYear>` | `GRADE#stu-001#math#S1#2025/2026` |
| `absence` | `ABSENCE#<studentCode>#<month>#<schoolYear>#<absenceType>` | `ABSENCE#stu-001#2026-01#2025/2026#unjustified` |
| `teacher` | `TEACHER#<teacherId>` | `TEACHER#tch-042` |
| `teacher_alias` | `TEACHER_ALIAS#<aliasId>` | `TEACHER_ALIAS#12` |
| `staff_attendance` | `STAFF_ATTENDANCE#<teacherId>#<date>` | `STAFF_ATTENDANCE#tch-042#2026-03-21` |
| `teacher_absence` | `TEACHER_ABSENCE#<teacherId>#<date>` | `TEACHER_ABSENCE#tch-042#2026-03-15` |
| `exam` | `EXAM#<examId>` | `EXAM#ex-100` |
| `exam_proctor` | `EXAM_PROCTOR#<examId>#<teacherId>` | `EXAM_PROCTOR#ex-100#tch-042` |
| `exam_room` | `EXAM_ROOM#<examId>#<roomId>` | `EXAM_ROOM#ex-100#room-A` |
| `test` | `TEST#<testId>` | `TEST#tst-050` |
| `correspondence` | `CORRESPONDENCE#<correspondenceId>` | `CORRESPONDENCE#cor-200` |
| `student_file` | `STUDENT_FILE#<studentCode>#<fileId>` | `STUDENT_FILE#stu-001#file-10` |
| `student_movement` | `STUDENT_MOVEMENT#<movementId>` | `STUDENT_MOVEMENT#mv-300` |
| `compensation` | `COMPENSATION#<trackingId>` | `COMPENSATION#comp-50` |
| `settings` | `SETTINGS#<settingKey>` | `SETTINGS#currentSchoolYear` |
| `page_visibility` | `PAGE_VISIBILITY#<pageKey>` | `PAGE_VISIBILITY#grades` |

### TTL Strategy

| Record Type | `expiresAt` Value | Rationale |
|-------------|-------------------|-----------|
| `PUT` operations | `updatedAt + (retentionDays * 86400)` | Default retention: 30 days |
| `DEL` operations (tombstones) | `updatedAt + 259200` (72 hours) | Enough time for all PCs to pull the deletion |
| Settings records | Omitted (no expiry) | Settings are long-lived configuration |

### DynamoDB Table Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Capacity mode | On-demand (PAY_PER_REQUEST) | Variable, low-volume school workloads |
| TTL attribute | `expiresAt` | Automatic cleanup of old sync records |
| Point-in-time recovery | Enabled | Data safety for school records |
| Encryption | AWS-managed key (SSE-S3) | Default encryption at rest |
| Deletion protection | Enabled | Prevent accidental table deletion |

---

## Cognito Identity Pool: `PencilSyncPool`

### Configuration

| Setting | Value |
|---------|-------|
| Allow unauthenticated identities | No |
| Developer provider name | `login.pencil.school` |
| Authentication flow | Developer Authenticated Identities |
| Token duration | 60 minutes |

### Role Mapping

| Identity State | IAM Role | Permissions |
|----------------|----------|-------------|
| Authenticated | `PencilSyncAuthRole` | DynamoDB read/write scoped to `SCHOOL#<identityId>` partition |
| Unauthenticated | None (disabled) | N/A |

---

## Auth Lambda: `pencil2-sync-auth`

### Input (request payload)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `licenseKey` | String | Yes | Full Pencil2 license key (`GSLK-<payload>.<signature>`) |
| `deviceHash` | String | Yes | Device fingerprint hash (64-char hex) |

### Output (success response)

| Field | Type | Description |
|-------|------|-------------|
| `identityId` | String | Cognito Identity ID |
| `token` | String | OIDC token for `getCredentialsForIdentity()` |
| `schoolId` | String | Extracted `customerRef` for client-side use |
| `expiresAt` | Number | Token expiry (Unix epoch seconds) |

### Output (error response)

| Field | Type | Description |
|-------|------|-------------|
| `error` | String | Error code: `INVALID_KEY`, `EXPIRED_KEY`, `MALFORMED_REQUEST` |
| `message` | String | Human-readable error description |

### Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `GESTION_LICENSE_SECRET` | AWS Secrets Manager | HMAC signing secret for license key validation |
| `COGNITO_IDENTITY_POOL_ID` | CloudFormation output | Identity pool ARN |
| `DEVELOPER_PROVIDER_NAME` | Hardcoded | `login.pencil.school` |

---

## IAM Role: `PencilSyncAuthRole`

### Trust Policy

Federated principal: `cognito-identity.amazonaws.com`
Conditions:
- `StringEquals`: `cognito-identity.amazonaws.com:aud` = Identity Pool ID
- `ForAnyValue:StringLike`: `cognito-identity.amazonaws.com:amr` = `authenticated`
- Action: `sts:AssumeRoleWithWebIdentity`

### Permissions Policy

DynamoDB actions allowed on base table and GSI:
- `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`, `BatchGetItem`, `BatchWriteItem`

Condition: `ForAllValues:StringEquals` on `dynamodb:LeadingKeys` = `SCHOOL#${cognito-identity.amazonaws.com:sub}`

**Explicitly denied**: `dynamodb:Scan` (prevents bypassing partition isolation)

---

## Resource Tagging

All AWS resources receive these tags:

| Tag Key | Tag Value |
|---------|-----------|
| `Project` | `pencil2` |
| `Feature` | `sync` |
| `Phase` | `2-infrastructure` |
| `Environment` | Parameter: `dev`, `staging`, or `prod` |
| `ManagedBy` | `cdk` |
