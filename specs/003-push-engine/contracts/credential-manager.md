# Contract: Credential Manager

**Feature**: 003-push-engine
**Type**: Internal Node.js module (`main/sync/credentials.js`)

## Interface

### `getCredentials()` → `Promise<CredentialSet | null>`

Returns cached credentials if valid (more than 10 minutes remaining), otherwise refreshes them. Returns `null` if authentication fails.

**CredentialSet shape**:
```js
{
    accessKeyId:     string,   // AWS temporary access key
    secretAccessKey: string,   // AWS temporary secret key
    sessionToken:    string,   // AWS session token
    expiresAt:       number,   // Unix epoch seconds
    identityId:      string,   // Cognito Identity ID
    schoolId:        string    // customerRef from license key
}
```

**Behavior**:
- First call: fetches fresh credentials via Auth Lambda + Cognito exchange
- Subsequent calls within validity window: returns cached credentials (no network call)
- When cached credentials have ≤ 10 minutes remaining: refreshes automatically
- On auth failure (invalid key, network error): logs error, returns `null`
- Thread-safe: concurrent calls during refresh return the same pending promise

### `clearCredentials()` → `void`

Clears the in-memory credential cache. Used on logout, config changes, or when credentials are explicitly invalidated.

### `isAuthenticated()` → `boolean`

Returns `true` if cached credentials exist and have more than 10 minutes remaining.

## Auth Flow (2-step)

```
Step 1: Electron → Auth Lambda
   POST <auth_lambda_url>/auth
   Body: { "licenseKey": "<raw-key>", "deviceHash": "<64-char-hex>" }
   Response: { "identityId", "token", "schoolId", "expiresAt" }

Step 2: Electron → Cognito
   CognitoIdentityClient.getCredentialsForIdentity({
       IdentityId: identityId,
       Logins: { "login.pencil.school": token }
   })
   Response: { Credentials: { AccessKeyId, SecretKey, SessionToken, Expiration } }
```

## Data Sources

| Data | Source |
|------|--------|
| `licenseKey` | Read from `licenses` table (most recent active license) |
| `deviceHash` | `getDeviceHash()` from `main/sync/capture.js` |
| `auth_lambda_url` | `sync_config.auth_lambda_url` |
| `aws_region` | `sync_config.aws_region` |

## Error Handling

| Error Condition | Behavior |
|----------------|----------|
| Auth Lambda returns `INVALID_KEY` | Log warning, return `null`, do not retry until next flush cycle |
| Auth Lambda returns `EXPIRED_KEY` | Log warning, return `null` |
| Network timeout / DNS failure | Log warning, return `null`, retry on next cycle |
| Cognito `getCredentialsForIdentity` fails | Log warning, return `null` |
| No license key in database | Return `null` immediately (no network call) |
| `auth_lambda_url` not configured | Return `null` immediately |
