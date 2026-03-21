# Quickstart: AWS Infrastructure for DynamoDB Sync

**Feature**: 002-aws-infrastructure
**Date**: 2026-03-21

## Prerequisites

1. **Node.js 18+** — required for AWS CDK CLI and Lambda runtime
2. **AWS CLI v2** — configured with credentials that have admin permissions
3. **AWS CDK CLI** — `npm install -g aws-cdk`
4. **AWS Account** — with billing enabled and sufficient permissions to create DynamoDB, Cognito, Lambda, and IAM resources
5. **Phase 1 complete** — sync tables (`sync_outbox`, `sync_id_map`, `sync_config`, `sync_pull_state`) exist in the local SQLite database

## Project Setup

```bash
# From repo root
cd infra/

# Install CDK dependencies
npm install

# Bootstrap CDK in your AWS account (first time only)
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>

# Store the license signing secret in Secrets Manager
aws secretsmanager create-secret \
  --name pencil2/license-secret \
  --secret-string "<your-GESTION_LICENSE_SECRET-value>"
```

## Deploy

```bash
# Synthesize CloudFormation template (dry run)
cdk synth

# Deploy all resources
cdk deploy --parameters Environment=dev

# Verify deployment
aws dynamodb describe-table --table-name pencil2-sync
aws cognito-identity list-identity-pools --max-results 10
aws lambda get-function --function-name pencil2-sync-auth
```

## Test Authentication Flow

```bash
# Generate a test license key (from repo root)
npm run license:key -- --plan=pro --days=365 --customer=TEST-SCHOOL-001

# Invoke the Auth Lambda with the test key
aws lambda invoke \
  --function-name pencil2-sync-auth \
  --payload '{"licenseKey":"GSLK-<key>","deviceHash":"<64-char-hex>"}' \
  response.json

cat response.json
# Expected: { "identityId": "...", "token": "...", "schoolId": "TEST-SCHOOL-001", "expiresAt": ... }
```

## Test Partition Isolation

```bash
# Using the credentials from the auth response, attempt to write to the correct partition
aws dynamodb put-item \
  --table-name pencil2-sync \
  --item '{"PK":{"S":"SCHOOL#TEST-SCHOOL-001"},"SK":{"S":"STUDENT#test-001"},...}'
# Expected: Success

# Attempt to write to a different school's partition
aws dynamodb put-item \
  --table-name pencil2-sync \
  --item '{"PK":{"S":"SCHOOL#OTHER-SCHOOL"},"SK":{"S":"STUDENT#test-001"},...}'
# Expected: AccessDeniedException
```

## Tear Down (Dev/Test)

```bash
cd infra/
cdk destroy
```

## Key Files

| File | Purpose |
|------|---------|
| `infra/lib/sync-stack.ts` | CDK stack: DynamoDB table, Cognito pool, IAM roles |
| `infra/lib/auth-lambda/index.js` | Auth Lambda handler: license validation + Cognito token issuance |
| `infra/bin/app.ts` | CDK app entry point |
| `infra/cdk.json` | CDK configuration |
| `infra/package.json` | CDK dependencies |
