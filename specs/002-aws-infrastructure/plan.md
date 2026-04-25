# Implementation Plan: AWS Infrastructure for DynamoDB Sync

**Branch**: `002-aws-infrastructure` | **Date**: 2026-03-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-aws-infrastructure/spec.md`

## Summary

Set up the AWS cloud backend for Pencil2's DynamoDB sync system. This phase provisions a single DynamoDB table (`pencil2-sync`) with single-table design, a Cognito Identity Pool with Developer Authenticated Identities, an Auth Lambda that validates Pencil2 license keys via HMAC-SHA256, and IAM roles that enforce per-school partition isolation using `dynamodb:LeadingKeys`. All resources are defined in an AWS CDK (TypeScript) stack for idempotent, single-command deployment.

## Technical Context

**Language/Version**: TypeScript (CDK stack), JavaScript/Node.js 18 (Auth Lambda runtime)
**Primary Dependencies**: AWS CDK v2, `@aws-sdk/client-cognito-identity`, `@aws-sdk/client-secrets-manager`, Node.js built-in `crypto`
**Storage**: AWS DynamoDB (single-table `pencil2-sync`, on-demand capacity, TTL-enabled)
**Testing**: CDK `assertions` module for template validation, AWS CLI for integration testing, Jest for Lambda unit tests
**Target Platform**: AWS (DynamoDB, Cognito, Lambda, IAM) — deployed from any environment with AWS CLI + CDK
**Project Type**: Infrastructure-as-code + serverless function
**Performance Goals**: Auth flow < 3 seconds, GSI pull queries < 1 second for 100k records
**Constraints**: Monthly cost < $10 for 10-school deployment, 60-minute credential expiry, zero cross-school data access
**Scale/Scope**: 10–30 schools, 3 PCs per school, ~100 writes/minute aggregate

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Code Quality** | PASS | CDK TypeScript follows Prettier formatting. Lambda JS follows project ESLint config. IPC naming conventions N/A (no IPC changes in this phase) |
| **II. Testing Standards** | PASS | CDK template assertions validate resource creation. Auth Lambda has unit tests. Smoke tests unaffected (no IPC changes). No migrations in this phase |
| **III. User Experience** | N/A | No UI changes in this phase. RTL/Arabic/dark mode not applicable to cloud infrastructure |
| **IV. Good Practices** | PASS | No changes to Electron process boundary. No IPC additions. No bundler introduced. CDK infra lives in a separate `infra/` directory, cleanly isolated from main app code |
| **V. Performance** | PASS | No impact on app startup, memory, or CSS build. Lambda cold start within 3-second auth SLA. DynamoDB on-demand prevents throttling |
| **Security** | PASS | License signing secret stored in Secrets Manager (never in code). `timingSafeEqual` for signature comparison. IAM `LeadingKeys` enforces partition isolation. No secrets committed to git |
| **Workflow** | PASS | Feature work on dedicated `002-aws-infrastructure` branch. CDK is a new dependency but justified — it's the IaC tool for all AWS resources |

**Post-Phase 1 re-check**: All gates still PASS. The CDK introduction is justified (see Complexity Tracking). No constitution violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-aws-infrastructure/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research decisions
├── data-model.md        # Phase 1: DynamoDB table schema, Cognito config, IAM roles
├── quickstart.md        # Phase 1: deployment and testing guide
├── contracts/
│   ├── auth-lambda-api.md    # Auth Lambda request/response contract
│   ├── dynamodb-schema.md    # DynamoDB table keys, GSI, item envelope
│   └── iam-permissions.md    # IAM trust and permissions policies
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
infra/
├── bin/
│   └── app.ts                    # CDK app entry point
├── lib/
│   ├── sync-stack.ts             # Main CDK stack: DynamoDB, Cognito, IAM, Lambda
│   └── auth-lambda/
│       ├── index.js              # Auth Lambda handler
│       └── license-validator.js  # License key HMAC-SHA256 validation (ported from main/licensing/offlineKey.js)
├── test/
│   ├── sync-stack.test.ts        # CDK template assertion tests
│   └── auth-lambda.test.js       # Lambda handler unit tests
├── cdk.json                      # CDK configuration
├── package.json                  # CDK + Lambda dependencies
└── tsconfig.json                 # TypeScript config for CDK
```

**Structure Decision**: A new `infra/` directory at the repo root houses all AWS CDK code. This is cleanly separated from the Electron app (`main/`, `js/`, `preload.js`). The Auth Lambda source lives within the CDK project (`infra/lib/auth-lambda/`) since CDK's `NodejsFunction` construct bundles it during deployment. No changes to the existing Electron app structure are required in this phase.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| New `infra/` directory with TypeScript CDK project | AWS resources require infrastructure-as-code for repeatable, idempotent deployment. CDK provides type-safe resource definitions, auto-generated IAM policies, and Lambda bundling | Raw CloudFormation YAML is error-prone for complex IAM conditions; manual AWS Console setup is not reproducible; Terraform requires HCL and state file management |
| New npm dependency: `aws-cdk` | CDK is the IaC tool — it runs only in development/deployment, not in the Electron app at runtime | No simpler alternative exists for defining AWS infrastructure programmatically in the JS/TS ecosystem |
