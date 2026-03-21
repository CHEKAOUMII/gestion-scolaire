# Research: AWS Infrastructure for DynamoDB Sync

**Feature**: 002-aws-infrastructure
**Date**: 2026-03-21

## R1: DynamoDB Single-Table Design for Multi-Tenant Sync

**Decision**: Single-table design with `PK = SCHOOL#<schoolId>`, `SK = <ENTITY_TYPE>#<compositeId>`

**Rationale**:
- School-level partition isolation is automatic — all items for one school share a PK
- Sort key hierarchy enables efficient queries by entity type via `begins_with()`
- IAM `dynamodb:LeadingKeys` condition enforces partition-level tenant isolation at the AWS level
- Hot partition risk is negligible — school workloads are low-volume (tens of writes/minute, not thousands)
- Single-table reduces operational overhead (one set of alarms, backups, TTL config)

**Alternatives considered**:
- Multi-table (one per entity type): Rejected — increases operational overhead, complicates cross-entity sync queries, no benefit at this scale
- Time-bucketed partitions (`SCHOOL#xyz#2026-03`): Rejected — unnecessary complexity for this workload, requires multi-bucket queries across month boundaries

## R2: GSI Design for Pull Queries

**Decision**: Single GSI named `SyncGSI` with `GSI1PK = SCHOOL#<schoolId>`, `GSI1SK = <updatedAt>#<entityType>#<entityId>`

**Rationale**:
- Enables efficient pull queries: "give me everything changed after timestamp X for school Y"
- Sort key ordering ensures chronological retrieval
- Same PK prefix as base table, so `dynamodb:LeadingKeys` IAM condition works on the GSI too
- No hot partition risk — each school is its own GSI partition

**Alternatives considered**:
- Cross-tenant GSI with sharded PK (`SYNC_SHARD#0-9`): Rejected — not needed; each school pulls only its own data
- No GSI (scan + filter on base table): Rejected — full table scan is expensive and slow at scale

## R3: Infrastructure-as-Code Tool

**Decision**: AWS CDK (TypeScript)

**Rationale**:
- Same language as the Electron app (JavaScript/Node.js ecosystem)
- First-class Cognito support with same-day feature availability
- `grant*()` methods auto-generate least-privilege IAM policies
- No external state file management — CloudFormation stacks are stored in the AWS account
- `NodejsFunction` construct handles Lambda bundling with esbuild
- Type-safe configuration reduces deployment errors

**Alternatives considered**:
- Raw CloudFormation YAML: Rejected — verbose, no type safety, error-prone for complex IAM policies
- Terraform: Rejected — requires learning HCL, managing state files (S3 + DynamoDB lock table), and Cognito feature parity sometimes lags

## R4: Authentication Flow

**Decision**: Cognito Identity Pool with Developer Authenticated Identities

**Flow**:
1. Electron app sends license key to Auth Lambda (via HTTPS)
2. Auth Lambda validates license key using the same HMAC-SHA256 algorithm as `main/licensing/offlineKey.js`
3. Auth Lambda extracts `customerRef` (school ID) from the license payload
4. Auth Lambda calls `CognitoIdentity.getOpenIdTokenForDeveloperIdentity()` with school ID as the developer identity
5. Cognito returns an `IdentityId` + OIDC token
6. Auth Lambda returns the token to the Electron app
7. Electron app calls `CognitoIdentity.getCredentialsForIdentity()` with the token
8. Cognito returns temporary AWS credentials (AccessKey, SecretKey, SessionToken) scoped by the authenticated IAM role

**Rationale**:
- No Cognito User Pool needed — the app already has its own auth system (scrypt password hashing)
- License key is the natural credential — no additional username/password for sync
- `customerRef` field in the license key payload provides the school identifier
- Temporary credentials expire after 60 minutes, aligning with security requirements

**Alternatives considered**:
- Cognito User Pool + App Client: Rejected — would require creating user accounts in Cognito, duplicating the existing auth system
- API Gateway with API keys: Rejected — no fine-grained DynamoDB partition isolation, would need a proxy layer
- Direct STS AssumeRole: Rejected — requires pre-provisioned IAM users per school, not scalable

## R5: License Key Validation in Lambda

**Decision**: Port the HMAC-SHA256 verification logic from `main/licensing/offlineKey.js` to the Auth Lambda

**Key findings from licensing system research**:
- License key format: `GSLK-<payloadBase64url>.<signatureBase64url>`
- Payload contains: `plan`, `exp`, `customer` (school ID), `ov`, `dc`, `iat`, `nonce`
- Validation: recompute HMAC-SHA256 over the payload using the signing secret, compare with `timingSafeEqual`
- The `customer` field maps directly to the DynamoDB partition key prefix
- No asymmetric crypto — the Lambda needs the same `GESTION_LICENSE_SECRET` env var

**Security consideration**: The signing secret must be stored in AWS Secrets Manager or Lambda environment variables (encrypted). It must NOT be hardcoded in the Lambda source code.

## R6: TTL Strategy

**Decision**: `expiresAt` attribute (Unix epoch seconds) on all sync records

**Rationale**:
- DynamoDB supports exactly one TTL attribute per table
- `expiresAt` is self-documenting (it's a timestamp, not a duration)
- Tombstone records (DEL operations) set `expiresAt = deletedAt + 259200` (72 hours) — enough time for all PCs to pull the deletion
- Regular sync records set `expiresAt` based on the configurable retention period (default: 30 days)
- Items without expiry omit the attribute entirely

**Important caveat**: DynamoDB TTL deletion is best-effort, typically within 48 hours of expiry. Application-layer queries must filter out expired items: `expiresAt > :now OR attribute_not_exists(expiresAt)`.

## R7: Partition Key Derivation from License Key

**Decision**: Use `customerRef` from the license key payload as the school partition identifier

**Mapping**: `SCHOOL#<customerRef>` becomes the DynamoDB partition key value.

**Rationale**:
- `customerRef` is set at key generation time (e.g., `--customer=SCHOOL-001`)
- It is cryptographically bound to the license key via the HMAC signature — tampering invalidates the key
- It is stored locally in `licenses.metadata` as `customerRef` after activation
- It is stable and unique per school

## R8: Alignment with Phase 1 Outbox Format

**Key findings from Phase 1 sync foundation research**:

| Phase 1 Outbox Column | DynamoDB Mapping |
|---|---|
| `table_name` | Encoded in sort key entity type prefix (e.g., `STUDENT#`, `GRADE#`) |
| `row_sync_id` | Format: `{deviceHash}:{table_name}:{local_id}` — stored as a DynamoDB attribute |
| `operation` | `PUT` or `DEL` — stored as `operation` attribute |
| `row_data` | JSON payload — stored as DynamoDB map attribute `data` |
| `school_year` | Stored as `schoolYear` attribute on every item |

**Phase 1 `sync_config.school_id_hash`** is the designated DynamoDB partition key field. This aligns with our `SCHOOL#<customerRef>` design — Phase 1 populates `school_id_hash` from the license key's `customerRef`.

**Phase 1 tracked domains** (15 tables across 47 channels): `students`, `grades`, `absences`, `correspondence`, `student_files`, `student_movements`, `teachers`, `teacher_aliases`, `staff_attendance`, `exam_proctors`, `compensation_tracking`, `teacher_absences`, `exams`, `exam_rooms`, `tests`, `settings`, `page_visibility`
