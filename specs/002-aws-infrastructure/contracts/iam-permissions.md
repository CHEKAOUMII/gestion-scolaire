# Contract: IAM Permissions

**Feature**: 002-aws-infrastructure
**Type**: AWS IAM policy for DynamoDB partition isolation

## Authenticated Role: `PencilSyncAuthRole`

### Trust Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "cognito-identity.amazonaws.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "cognito-identity.amazonaws.com:aud": "<identity-pool-id>"
        },
        "ForAnyValue:StringLike": {
          "cognito-identity.amazonaws.com:amr": "authenticated"
        }
      }
    }
  ]
}
```

### Permissions Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowDynamoDBBaseTable",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": "arn:aws:dynamodb:<region>:<account>:table/pencil2-sync",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": ["SCHOOL#${cognito-identity.amazonaws.com:sub}"]
        }
      }
    },
    {
      "Sid": "AllowDynamoDBGSIQuery",
      "Effect": "Allow",
      "Action": ["dynamodb:Query"],
      "Resource": "arn:aws:dynamodb:<region>:<account>:table/pencil2-sync/index/SyncGSI",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": ["SCHOOL#${cognito-identity.amazonaws.com:sub}"]
        }
      }
    },
    {
      "Sid": "DenyScan",
      "Effect": "Deny",
      "Action": ["dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:<region>:<account>:table/pencil2-sync*"
    }
  ]
}
```

### Isolation Guarantee

- `dynamodb:LeadingKeys` ensures every item's partition key matches `SCHOOL#<identityId>`
- `ForAllValues:StringEquals` means ALL items in a batch request must satisfy the condition
- Explicit `Deny` on `Scan` prevents bypassing partition isolation
- Works for base table operations AND GSI queries (separate Resource ARNs)

### Auth Lambda Execution Role: `PencilSyncAuthLambdaRole`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CognitoDevAuth",
      "Effect": "Allow",
      "Action": [
        "cognito-identity:GetOpenIdTokenForDeveloperIdentity",
        "cognito-identity:LookupDeveloperIdentity"
      ],
      "Resource": "arn:aws:cognito-identity:<region>:<account>:identitypool/<pool-id>"
    },
    {
      "Sid": "SecretsAccess",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:<region>:<account>:secret:pencil2/license-secret-*"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:<region>:<account>:log-group:/aws/lambda/pencil2-sync-auth:*"
    }
  ]
}
```
