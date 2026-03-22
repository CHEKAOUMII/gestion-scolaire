# Contract: Auth Lambda API

**Feature**: 002-aws-infrastructure
**Type**: HTTPS Lambda Function URL / API Gateway endpoint

## Authentication Endpoint

### Request

```
POST /auth
Content-Type: application/json
```

```json
{
  "licenseKey": "GSLK-<base64url-payload>.<base64url-signature>",
  "deviceHash": "<64-char-hex-sha256>"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `licenseKey` | String | Yes | Must start with `GSLK-`, contain exactly one `.` separator, both parts non-empty |
| `deviceHash` | String | Yes | Must match `/^[a-f0-9]{64}$/` |

### Success Response (200)

```json
{
  "identityId": "us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "token": "<oidc-token-string>",
  "schoolId": "SCHOOL-001",
  "expiresAt": 1710003600
}
```

| Field | Type | Description |
|-------|------|-------------|
| `identityId` | String | Cognito Identity ID for this school |
| `token` | String | OIDC token — pass to `getCredentialsForIdentity()` |
| `schoolId` | String | Extracted `customerRef` from the license key payload |
| `expiresAt` | Number | Token expiry as Unix epoch seconds (~15 min from issuance) |

### Error Response (401 — invalid credentials)

```json
{
  "error": "INVALID_KEY",
  "message": "License key signature verification failed"
}
```

### Error Response (401 — expired key)

```json
{
  "error": "EXPIRED_KEY",
  "message": "License key expired on 2026-01-15T00:00:00.000Z"
}
```

### Error Response (400 — malformed request)

```json
{
  "error": "MALFORMED_REQUEST",
  "message": "Missing required field: licenseKey"
}
```

### Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `MALFORMED_REQUEST` | 400 | Missing or invalid fields in the request body |
| `INVALID_KEY` | 401 | License key signature does not match |
| `EXPIRED_KEY` | 401 | License key `exp` date is in the past |
| `INTERNAL_ERROR` | 500 | Unexpected server error (no internal details exposed) |

## Rate Limiting

No explicit rate limiting at the Lambda level. DynamoDB on-demand capacity and Cognito's built-in rate limits provide natural throttling. Expected traffic: < 100 auth requests/hour across all schools.

## Security

- The signing secret (`GESTION_LICENSE_SECRET`) is stored in AWS Secrets Manager, injected via Lambda environment variable (encrypted at rest)
- `timingSafeEqual` is used for signature comparison (prevents timing attacks)
- Error responses never expose the signing secret, internal stack traces, or Cognito pool details
- All responses include `Cache-Control: no-store` to prevent credential caching by intermediaries
