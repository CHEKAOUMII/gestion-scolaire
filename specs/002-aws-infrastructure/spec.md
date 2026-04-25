# Feature Specification: AWS Infrastructure for DynamoDB Sync

**Feature Branch**: `002-aws-infrastructure`
**Created**: 2026-03-21
**Status**: Draft
**Input**: User description: "Phase 2 — AWS Infrastructure: Set up the cloud backend for the Pencil2 DynamoDB sync system"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deploy Cloud Infrastructure from Template (Priority: P1)

A developer or DevOps engineer runs a single infrastructure-as-code template to provision all required AWS resources (DynamoDB table, Cognito Identity Pool, Auth Lambda, IAM roles) in one deployment. After deployment, all resources are correctly configured and ready for the sync engine to connect.

**Why this priority**: Without the infrastructure standing up correctly, no other sync functionality can operate. This is the foundational deliverable of the entire phase.

**Independent Test**: Can be fully tested by deploying the template to an AWS account and verifying all resources exist with correct configurations. Delivers a ready-to-use cloud backend.

**Acceptance Scenarios**:

1. **Given** a fresh AWS account with appropriate permissions, **When** the infrastructure template is deployed, **Then** a DynamoDB table named `pencil2-sync` is created with the correct partition key, sort key, and GSI
2. **Given** a fresh AWS account with appropriate permissions, **When** the infrastructure template is deployed, **Then** a Cognito Identity Pool is created and configured for custom authentication
3. **Given** a fresh AWS account with appropriate permissions, **When** the infrastructure template is deployed, **Then** an Auth Lambda function is created and linked to the Cognito Identity Pool
4. **Given** a fresh AWS account with appropriate permissions, **When** the infrastructure template is deployed, **Then** IAM roles are created that scope each school's access to its own data partition only
5. **Given** a previously deployed stack, **When** the template is redeployed with no changes, **Then** no resources are modified or recreated (idempotent deployment)

---

### User Story 2 - School Authenticates and Receives Scoped Credentials (Priority: P1)

A Pencil2 app instance presents its license key to the Auth Lambda. The Lambda validates the license, identifies the school, and returns temporary AWS credentials scoped to that school's data partition. The credentials allow read/write access only to that school's DynamoDB items.

**Why this priority**: Authentication is equally critical to infrastructure provisioning — the sync engine cannot push or pull data without valid, scoped credentials.

**Independent Test**: Can be tested by invoking the Auth Lambda with a valid license key and verifying the returned credentials can only access the expected school partition in DynamoDB.

**Acceptance Scenarios**:

1. **Given** a valid Pencil2 license key, **When** the Auth Lambda is invoked with that key, **Then** temporary AWS credentials are returned with a 60-minute expiry
2. **Given** a valid license key for school "SCHOOL-001", **When** the returned credentials are used to write to DynamoDB, **Then** writes succeed only for items with partition key prefix `SCHOOL-001`
3. **Given** a valid license key for school "SCHOOL-001", **When** the returned credentials are used to read from DynamoDB, **Then** reads succeed only for items within the `SCHOOL-001` partition
4. **Given** an invalid or expired license key, **When** the Auth Lambda is invoked, **Then** the request is rejected with a clear error message and no credentials are issued
5. **Given** a revoked license key, **When** the Auth Lambda is invoked, **Then** authentication fails and no credentials are returned

---

### User Story 3 - DynamoDB Table Supports Sync Operations (Priority: P1)

The DynamoDB table `pencil2-sync` is structured to support both push (write) and pull (query) operations required by the sync engine. The partition key isolates each school's data, the sort key allows ordered retrieval of records, and the GSI enables efficient pull queries by timestamp.

**Why this priority**: The table schema directly determines whether phases 3 and 4 (push/pull engines) can function correctly. An incorrect schema would require destructive migration later.

**Independent Test**: Can be tested by writing sample sync records and querying them via the GSI to verify ordering, scoping, and retrieval performance.

**Acceptance Scenarios**:

1. **Given** the DynamoDB table is deployed, **When** a sync record is written with a school ID and entity key, **Then** the record is stored with the correct partition isolation
2. **Given** multiple sync records exist for a school, **When** a pull query is made via the GSI filtered by timestamp, **Then** only records newer than the specified timestamp are returned in chronological order
3. **Given** records from multiple schools exist, **When** a pull query is made with school "SCHOOL-001" credentials, **Then** only records belonging to "SCHOOL-001" are returned
4. **Given** the table is under normal school workload (100 writes/minute), **When** concurrent read and write operations occur, **Then** all operations succeed without throttling under on-demand capacity mode

---

### User Story 4 - Infrastructure Costs Remain Predictable (Priority: P2)

AWS resources are configured with cost-control mechanisms to prevent unexpected charges. DynamoDB uses on-demand capacity mode (no over-provisioning), items have TTL configured for automatic cleanup of old sync records, and the Cognito Identity Pool stays within the free tier for the expected user volume.

**Why this priority**: Cost predictability is important but secondary to functional correctness. Schools operate on tight budgets and unexpected cloud bills would jeopardize adoption.

**Independent Test**: Can be tested by simulating a 10-school deployment workload for one month and verifying AWS billing stays under $10/month.

**Acceptance Scenarios**:

1. **Given** the DynamoDB table is configured with on-demand capacity, **When** normal school workload flows through the table, **Then** monthly costs remain under $5 for a 10-school deployment
2. **Given** sync records older than the configured TTL, **When** the TTL expiry is reached, **Then** those records are automatically deleted by DynamoDB without manual intervention
3. **Given** the Cognito Identity Pool processes authentication for 30 schools (each with 3 PCs), **When** monthly usage is calculated, **Then** it remains within the Cognito free tier (under 50,000 MAU)

---

### Edge Cases

- What happens when the infrastructure template is deployed to a region that doesn't support all required services? The template should validate region compatibility and fail with a clear error before creating partial resources.
- What happens when the Auth Lambda receives a malformed request (missing fields, wrong format)? The Lambda should return a structured error response without exposing internal details.
- What happens when multiple PCs from the same school authenticate simultaneously? Each authentication request is independent and returns separate credential sets, all scoped to the same school partition — no conflicts arise.
- What happens when the IAM policy is misconfigured and a school gains access to another school's data? Conditional expressions on the partition key in the IAM policy prevent cross-school access; the infrastructure template should include integration tests that verify this boundary.
- What happens when the Auth Lambda cold-starts after a period of inactivity? Cold start latency should remain within the 3-second authentication SLA defined in the success criteria.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provision a DynamoDB table named `pencil2-sync` with a composite primary key (partition key for school isolation, sort key for entity identification)
- **FR-002**: System MUST create a Global Secondary Index (GSI) on the DynamoDB table that enables efficient querying of records by school ID and last-modified timestamp
- **FR-003**: System MUST configure DynamoDB with on-demand (pay-per-request) capacity mode to match the variable and low-volume school workload pattern
- **FR-004**: System MUST enable Time-to-Live (TTL) on the DynamoDB table to automatically expire and delete old sync records after a configurable retention period
- **FR-005**: System MUST provision a Cognito Identity Pool that issues temporary AWS credentials after successful custom authentication
- **FR-006**: System MUST deploy an Auth Lambda function that validates Pencil2 license keys and returns an identity token to Cognito for credential issuance
- **FR-007**: Auth Lambda MUST validate license keys against the existing Pencil2 licensing format (same algorithm as the app's offline key verification)
- **FR-008**: System MUST create IAM roles that restrict each authenticated school to read/write only its own data partition in DynamoDB — no cross-school access is permitted
- **FR-009**: Temporary credentials issued by Cognito MUST expire after 60 minutes, requiring re-authentication for continued access
- **FR-010**: System MUST provide the entire infrastructure as a single deployable template (Infrastructure-as-Code) that creates all resources in one operation
- **FR-011**: Infrastructure deployment MUST be idempotent — redeploying the same template with no changes must not modify or recreate existing resources
- **FR-012**: Auth Lambda MUST return structured error responses for invalid, expired, or malformed authentication requests without exposing internal system details
- **FR-013**: System MUST tag all AWS resources with project identifiers (project name, environment, phase) for cost tracking and resource management
- **FR-014**: The DynamoDB table sort key structure MUST support storing records for all sync domains (students, teachers, grades, exams, absences, settings, etc.) within a single table

### Key Entities

- **Sync Record**: A single data change captured by the sync engine — represents one insert, update, or delete operation. Key attributes: school identifier, entity type, entity key, operation type, payload, version, timestamp
- **School Partition**: A logical isolation boundary within DynamoDB that ensures all data belonging to one school is grouped under a single partition key value. Each school's data is completely isolated from other schools
- **Temporary Credential**: A short-lived AWS credential set (access key, secret key, session token) issued by Cognito after successful authentication. Scoped by IAM policy to a single school's partition. Expires after 60 minutes
- **Auth Token**: The identity token returned by the Auth Lambda to Cognito, containing the authenticated school's identity and allowed permissions. Used by Cognito to assume the appropriately scoped IAM role

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All AWS resources (DynamoDB table, Cognito Identity Pool, Auth Lambda, IAM roles) are provisioned from a single template deployment in under 10 minutes
- **SC-002**: A valid license key authentication flow completes (license validation to credential issuance) in under 3 seconds
- **SC-003**: Returned credentials successfully read and write only to the authenticated school's partition — cross-school access attempts are rejected 100% of the time
- **SC-004**: Invalid license key authentication attempts are rejected with a clear error within 2 seconds
- **SC-005**: Monthly infrastructure cost for a 10-school, 30-PC deployment remains under $10
- **SC-006**: DynamoDB GSI pull queries return all records newer than a given timestamp for a school in under 1 second for datasets up to 100,000 records
- **SC-007**: Infrastructure template redeployment (with no changes) completes without modifying any existing resources
- **SC-008**: TTL-expired sync records are automatically removed from DynamoDB within 48 hours of expiry (per DynamoDB's TTL deletion SLA)

## Assumptions

- The existing Pencil2 license key format and validation algorithm is stable and will not change during this phase
- Each school has a unique identifier derivable from its license key that can serve as the DynamoDB partition key
- The target AWS region supports all required services (DynamoDB, Cognito, Lambda, IAM)
- The deploying user/role has sufficient AWS permissions to create all resources defined in the template
- On-demand DynamoDB capacity mode is sufficient for school workloads — there is no need for provisioned capacity
- The 60-minute credential expiry window is appropriate given the sync interval of 5–15 minutes (credentials will be refreshed well before expiry in Phase 3)
- Single-table DynamoDB design is the correct approach for this workload — no need for separate tables per domain

## Dependencies

- **Phase 1 (Sync Foundation)**: The local sync tables and capture layer must be in place. The DynamoDB table schema must align with the outbox record format defined in Phase 1
- **Pencil2 Licensing System**: The Auth Lambda depends on the existing license key format for validation. Changes to the licensing module would require corresponding Auth Lambda updates
- **AWS Account**: A configured AWS account with billing enabled is required for deployment and testing
