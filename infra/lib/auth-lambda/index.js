const {
    CognitoIdentityClient,
    GetOpenIdTokenForDeveloperIdentityCommand
} = require('@aws-sdk/client-cognito-identity');
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { isExpired, validateLicenseKey } = require('./license-validator');
const { OTP_PK_PREFIX, OTP_SK_ACTIVE, TABLE_NAME } = require('./schema-constants');

const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
};

const cognitoClient = new CognitoIdentityClient({});
const secretsClient = new SecretsManagerClient({});

let cachedSecret = null;

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true }
});

function createHttpError(statusCode, error, message) {
    const httpError = new Error(message);
    httpError.statusCode = statusCode;
    httpError.code = error;
    return httpError;
}

function jsonResponse(statusCode, payload) {
    return {
        statusCode,
        headers: JSON_HEADERS,
        body: JSON.stringify(payload)
    };
}

function parseBody(event) {
    const rawBody = event && Object.prototype.hasOwnProperty.call(event, 'body') ? event.body : event;

    if (rawBody == null || rawBody === '') {
        return {};
    }

    if (typeof rawBody === 'string') {
        try {
            return JSON.parse(rawBody);
        } catch (_error) {
            throw createHttpError(400, 'MALFORMED_REQUEST', 'Invalid JSON in request body');
        }
    }

    if (typeof rawBody === 'object' && !Array.isArray(rawBody)) {
        return rawBody;
    }

    throw createHttpError(400, 'MALFORMED_REQUEST', 'Request body must be a JSON object');
}

function getRequestPath(event) {
    if (event && event.requestContext && event.requestContext.http) {
        return event.requestContext.http.path || '/';
    }

    if (event && event.rawPath) {
        return event.rawPath;
    }

    return '/';
}

function decodeBase64Field(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) {
        return null;
    }

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        return null;
    }

    const buffer = Buffer.from(value, 'base64');
    if (buffer.length === 0 || buffer.toString('base64') !== value) {
        return null;
    }

    return buffer;
}

function verifyScryptHash(plaintext, storedHash) {
    if (!storedHash || typeof storedHash !== 'string') {
        return false;
    }

    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') {
        return false;
    }

    const salt = parts[1];
    const expectedHex = parts[2];
    const computedHex = crypto.scryptSync(String(plaintext || ''), salt, 64).toString('hex');

    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(computedHex, 'hex');

    if (a.length !== b.length) {
        return false;
    }

    return crypto.timingSafeEqual(a, b);
}

function validateRequest(body) {
    const { licenseKey, deviceHash } = body;

    if (licenseKey == null || (typeof licenseKey === 'string' && licenseKey.trim() === '')) {
        return 'Missing required field: licenseKey';
    }

    if (typeof licenseKey !== 'string') {
        return 'licenseKey must be a string';
    }

    if (deviceHash == null || (typeof deviceHash === 'string' && deviceHash.trim() === '')) {
        return 'Missing required field: deviceHash';
    }

    if (typeof deviceHash !== 'string' || !/^[a-f0-9]{64}$/.test(deviceHash)) {
        return 'deviceHash must be a 64-character lowercase hex string';
    }

    return null;
}

async function getSigningSecret() {
    if (cachedSecret !== null) {
        return cachedSecret;
    }

    const fallbackSecret = String(process.env.GESTION_LICENSE_SECRET || '').trim();
    if (fallbackSecret) {
        cachedSecret = fallbackSecret;
        return cachedSecret;
    }

    const secretArn = String(process.env.SECRET_ARN || '').trim();
    if (!secretArn) {
        throw new Error('SECRET_ARN is required');
    }

    const response = await secretsClient.send(
        new GetSecretValueCommand({
            SecretId: secretArn
        })
    );

    const secretString = String(response.SecretString || '').trim();
    if (!secretString) {
        throw new Error('SecretString is empty');
    }

    cachedSecret = secretString;
    return cachedSecret;
}

async function handleCredentialExchange(event) {
    try {
        const body = parseBody(event);

        const validationError = validateRequest(body);
        if (validationError) {
            return jsonResponse(400, {
                error: 'MALFORMED_REQUEST',
                message: validationError
            });
        }

        const signingSecret = await getSigningSecret();
        const result = validateLicenseKey(body.licenseKey, signingSecret);
        if (!result.ok) {
            return jsonResponse(401, {
                error: 'INVALID_KEY',
                message: result.error
            });
        }

        if (isExpired(result.payload.expiresAt)) {
            return jsonResponse(401, {
                error: 'EXPIRED_KEY',
                message: 'License key expired on ' + result.payload.expiresAt
            });
        }

        const customerRef = result.payload.customerRef;
        const identityPoolId = String(process.env.COGNITO_IDENTITY_POOL_ID || '').trim();
        const developerProviderName = String(process.env.DEVELOPER_PROVIDER_NAME || 'login.pencil.school').trim();

        const authResponse = await cognitoClient.send(
            new GetOpenIdTokenForDeveloperIdentityCommand({
                IdentityPoolId: identityPoolId,
                Logins: {
                    [developerProviderName]: customerRef
                }
            })
        );

        return jsonResponse(200, {
            identityId: authResponse.IdentityId,
            token: authResponse.Token,
            schoolId: customerRef,
            expiresAt: Math.floor(Date.now() / 1000) + 900
        });
    } catch (error) {
        if (error && error.statusCode && error.code) {
            return jsonResponse(error.statusCode, {
                error: error.code,
                message: error.message
            });
        }

        return jsonResponse(500, {
            error: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred'
        });
    }
}

async function handlePublishOtp(event) {
    const body = parseBody(event);

    const authError = validateRequest(body);
    if (authError) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: authError });
    }

    const signingSecret = await getSigningSecret();
    const licenseResult = validateLicenseKey(body.licenseKey, signingSecret);
    if (!licenseResult.ok) {
        return jsonResponse(401, { error: 'INVALID_KEY', message: licenseResult.error });
    }

    if (isExpired(licenseResult.payload.expiresAt)) {
        return jsonResponse(401, {
            error: 'EXPIRED_KEY',
            message: 'License key expired on ' + licenseResult.payload.expiresAt
        });
    }

    const { massar, otpHash, encryptedPayload, iv, authTag } = body;
    if (!massar || typeof massar !== 'string' || !/^[A-Za-z0-9]{5,10}$/.test(massar.trim())) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid MASSAR code format' });
    }

    const normalizedMassar = massar.trim().toUpperCase();
    const customerRef = licenseResult.payload.customerRef;
    if (normalizedMassar !== String(customerRef).trim().toUpperCase()) {
        return jsonResponse(400, {
            error: 'MASSAR_MISMATCH',
            message: 'MASSAR code does not match license customerRef'
        });
    }

    if (!otpHash || typeof otpHash !== 'string' || !otpHash.startsWith('scrypt$')) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid otpHash format' });
    }

    const hashParts = otpHash.split('$');
    if (hashParts.length !== 3 || !hashParts[1] || !hashParts[2]) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid otpHash structure' });
    }

    if (!encryptedPayload || typeof encryptedPayload !== 'string') {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Missing required field: encryptedPayload' });
    }

    if (Buffer.byteLength(encryptedPayload, 'utf8') > 300 * 1024) {
        return jsonResponse(400, {
            error: 'PAYLOAD_TOO_LARGE',
            message: 'Encrypted payload exceeds maximum size of 300KB'
        });
    }

    if (!decodeBase64Field(encryptedPayload)) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid encryptedPayload format' });
    }

    const ivBuffer = decodeBase64Field(iv);
    if (!ivBuffer) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid iv format' });
    }

    if (ivBuffer.length !== 12) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'iv must decode to 12 bytes' });
    }

    const authTagBuffer = decodeBase64Field(authTag);
    if (!authTagBuffer) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid authTag format' });
    }

    if (authTagBuffer.length !== 16) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'authTag must decode to 16 bytes' });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = nowSeconds + 600;
    const tableName = process.env.SYNC_TABLE_NAME || TABLE_NAME;

    await docClient.send(
        new PutCommand({
            TableName: tableName,
            Item: {
                PK: OTP_PK_PREFIX + normalizedMassar,
                SK: OTP_SK_ACTIVE,
                otpHash,
                encryptedPayload,
                iv,
                authTag,
                schoolId: normalizedMassar,
                publishedBy: body.deviceHash,
                failureCount: 0,
                status: 'active',
                expiresAt,
                createdAt: new Date().toISOString()
            }
        })
    );

    return jsonResponse(200, {
        success: true,
        expiresAt
    });
}

async function handleVerifyOtp(event) {
    const body = parseBody(event);
    const { massar, otp } = body;

    if (!massar || typeof massar !== 'string' || !/^[A-Za-z0-9]{5,10}$/.test(massar.trim())) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'Invalid MASSAR code format' });
    }

    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
        return jsonResponse(400, { error: 'MALFORMED_REQUEST', message: 'OTP must be a 6-digit code' });
    }

    const normalizedMassar = massar.trim().toUpperCase();
    const tableName = process.env.SYNC_TABLE_NAME || TABLE_NAME;

    const getResult = await docClient.send(
        new GetCommand({
            TableName: tableName,
            Key: {
                PK: OTP_PK_PREFIX + normalizedMassar,
                SK: OTP_SK_ACTIVE
            }
        })
    );

    const item = getResult.Item;
    if (!item) {
        return jsonResponse(404, { error: 'NOT_FOUND', message: 'No active OTP found for this institution' });
    }

    if (item.status === 'used') {
        return jsonResponse(410, { error: 'OTP_USED', message: 'OTP has already been used' });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (item.expiresAt <= nowSeconds) {
        return jsonResponse(410, { error: 'OTP_EXPIRED', message: 'OTP has expired' });
    }

    if (item.failureCount >= 5) {
        return jsonResponse(429, { error: 'RATE_LIMITED', message: 'Too many failed attempts. Request a new OTP.' });
    }

    const isValid = verifyScryptHash(otp, item.otpHash);
    if (!isValid) {
        try {
            await docClient.send(
                new UpdateCommand({
                    TableName: tableName,
                    Key: {
                        PK: OTP_PK_PREFIX + normalizedMassar,
                        SK: OTP_SK_ACTIVE
                    },
                    UpdateExpression: 'SET failureCount = if_not_exists(failureCount, :zero) + :one',
                    ConditionExpression: 'attribute_not_exists(failureCount) OR failureCount < :max',
                    ExpressionAttributeValues: {
                        ':zero': 0,
                        ':one': 1,
                        ':max': 5
                    }
                })
            );
        } catch (condErr) {
            if (condErr.name === 'ConditionalCheckFailedException') {
                return jsonResponse(429, {
                    error: 'RATE_LIMITED',
                    message: 'Too many failed attempts. Request a new OTP.'
                });
            }

            throw condErr;
        }

        return jsonResponse(401, { error: 'INVALID_OTP', message: 'Invalid OTP code' });
    }

    try {
        await docClient.send(
            new UpdateCommand({
                TableName: tableName,
                Key: {
                    PK: OTP_PK_PREFIX + normalizedMassar,
                    SK: OTP_SK_ACTIVE
                },
                UpdateExpression: 'SET #st = :used, usedAt = :now',
                ConditionExpression: '#st <> :used',
                ExpressionAttributeNames: { '#st': 'status' },
                ExpressionAttributeValues: {
                    ':used': 'used',
                    ':now': new Date().toISOString()
                }
            })
        );
    } catch (condErr) {
        if (condErr.name === 'ConditionalCheckFailedException') {
            return jsonResponse(410, { error: 'OTP_USED', message: 'OTP has already been used' });
        }

        throw condErr;
    }

    return jsonResponse(200, {
        success: true,
        encryptedPayload: item.encryptedPayload,
        iv: item.iv,
        authTag: item.authTag
    });
}

async function handler(event) {
    try {
        const path = getRequestPath(event);

        if (path === '/' || path === '') {
            return handleCredentialExchange(event);
        }

        if (path === '/link/publish-otp') {
            return handlePublishOtp(event);
        }

        if (path === '/link/verify-otp') {
            return handleVerifyOtp(event);
        }

        return jsonResponse(404, {
            error: 'NOT_FOUND',
            message: 'Unknown endpoint: ' + path
        });
    } catch (error) {
        if (error && error.statusCode && error.code) {
            return jsonResponse(error.statusCode, {
                error: error.code,
                message: error.message
            });
        }

        return jsonResponse(500, {
            error: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred'
        });
    }
}

module.exports = {
    getSigningSecret,
    handler
};
