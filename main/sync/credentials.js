const { CognitoIdentityClient, GetCredentialsForIdentityCommand } = require('@aws-sdk/client-cognito-identity');
const { getDb } = require('../db/context');
const { getDeviceHash } = require('./capture');

let _cachedCredentials = null;
let _refreshPromise = null;

function readSyncConfig(db) {
    return db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
}

function readLicenseKey(db) {
    const row = db.prepare("SELECT license_key FROM licenses WHERE status != 'revoked' ORDER BY id DESC LIMIT 1").get();
    return row ? row.license_key : null;
}

async function refreshCredentials() {
    try {
        const db = getDb();
        const config = readSyncConfig(db);
        const authLambdaUrl = String(config.auth_lambda_url || '')
            .trim()
            .replace(/\/+$/, '');
        const awsRegion = String(config.aws_region || 'us-east-1').trim() || 'us-east-1';

        if (!authLambdaUrl) {
            return null;
        }

        const licenseKey = readLicenseKey(db);
        if (!licenseKey) {
            return null;
        }

        const deviceHash = getDeviceHash();
        const authResponse = await fetch(`${authLambdaUrl}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, deviceHash })
        });

        if (!authResponse.ok) {
            let errorBody = {};
            try {
                errorBody = await authResponse.json();
            } catch {
                errorBody = {};
            }
            console.warn('[sync:credentials] Auth failed:', errorBody.error || authResponse.status);
            return null;
        }

        const { identityId, token, schoolId } = await authResponse.json();
        const cognitoClient = new CognitoIdentityClient({ region: awsRegion });
        const credResult = await cognitoClient.send(
            new GetCredentialsForIdentityCommand({
                IdentityId: identityId,
                Logins: { 'login.pencil.school': token }
            })
        );

        if (
            !credResult?.Credentials?.AccessKeyId ||
            !credResult.Credentials.SecretKey ||
            !credResult.Credentials.Expiration
        ) {
            return null;
        }

        _cachedCredentials = {
            accessKeyId: credResult.Credentials.AccessKeyId,
            secretAccessKey: credResult.Credentials.SecretKey,
            sessionToken: credResult.Credentials.SessionToken,
            expiresAt: Math.floor(credResult.Credentials.Expiration.getTime() / 1000),
            identityId,
            schoolId
        };

        return _cachedCredentials;
    } catch (err) {
        console.warn('[sync:credentials] Credential refresh failed:', err.message);
        return null;
    }
}

async function getCredentials() {
    if (_cachedCredentials && _cachedCredentials.expiresAt - Math.floor(Date.now() / 1000) > 600) {
        return _cachedCredentials;
    }

    if (_refreshPromise) {
        return _refreshPromise;
    }

    _refreshPromise = refreshCredentials();

    try {
        return await _refreshPromise;
    } finally {
        _refreshPromise = null;
    }
}

function clearCredentials() {
    _cachedCredentials = null;
    _refreshPromise = null;
}

function isAuthenticated() {
    return _cachedCredentials !== null && _cachedCredentials.expiresAt - Math.floor(Date.now() / 1000) > 600;
}

module.exports = { getCredentials, clearCredentials, isAuthenticated };
