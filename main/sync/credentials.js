const { CognitoIdentityClient, GetCredentialsForIdentityCommand } = require('@aws-sdk/client-cognito-identity');
const { getDb } = require('../db/context');
const { getDeviceHash } = require('./capture');

let _cachedCredentials = null;
let _refreshPromise = null;

function readSyncConfig(db) {
    return db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
}

function readLicenseKey(db) {
    const config = readSyncConfig(db);
    return config.license_key ? String(config.license_key).trim() || null : null;
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
                Logins: { 'cognito-identity.amazonaws.com': token }
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

async function testConnection() {
    const db = getDb();
    const config = readSyncConfig(db);

    const authLambdaUrl = String(config.auth_lambda_url || '')
        .trim()
        .replace(/\/+$/, '');
    const awsRegion = String(config.aws_region || 'us-east-1').trim() || 'us-east-1';
    const licenseKey = readLicenseKey(db);

    if (!authLambdaUrl) {
        return { success: false, error: 'لم يتم تحديد رابط Lambda بعد' };
    }
    if (!licenseKey) {
        return { success: false, error: 'لم يتم إدخال مفتاح الترخيص' };
    }

    // Step 1: Lambda auth
    let identityId, token, schoolId;
    try {
        const deviceHash = getDeviceHash();
        const authRes = await fetch(`${authLambdaUrl}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey, deviceHash })
        });
        if (!authRes.ok) {
            let body = {};
            try {
                body = await authRes.json();
            } catch {
                /**/
            }
            return { success: false, step: 'lambda', error: body.error || `HTTP ${authRes.status}` };
        }
        ({ identityId, token, schoolId } = await authRes.json());
    } catch (err) {
        return { success: false, step: 'lambda', error: err.message };
    }

    // Step 2: Cognito credentials
    let creds;
    try {
        const cognitoClient = new CognitoIdentityClient({ region: awsRegion });
        const credResult = await cognitoClient.send(
            new GetCredentialsForIdentityCommand({
                IdentityId: identityId,
                Logins: { 'cognito-identity.amazonaws.com': token }
            })
        );
        if (!credResult?.Credentials?.AccessKeyId) {
            return { success: false, step: 'cognito', error: 'لم يتم الحصول على بيانات الاعتماد' };
        }
        creds = {
            accessKeyId: credResult.Credentials.AccessKeyId,
            secretAccessKey: credResult.Credentials.SecretKey,
            sessionToken: credResult.Credentials.SessionToken
        };
    } catch (err) {
        return { success: false, step: 'cognito', error: err.message };
    }

    // Step 3: DynamoDB ping — use Query (allowed by IAM) instead of ListTables (not allowed)
    try {
        const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
        const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
        const dynamo = DynamoDBDocumentClient.from(
            new DynamoDBClient({ region: awsRegion, credentials: creds })
        );
        await dynamo.send(new QueryCommand({
            TableName: 'pencil2-sync',
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: { ':pk': `SCHOOL#${schoolId}` },
            Limit: 1
        }));
    } catch (err) {
        return { success: false, step: 'dynamodb', error: err.message };
    }

    return { success: true, schoolId };
}

module.exports = { getCredentials, clearCredentials, isAuthenticated, testConnection };
