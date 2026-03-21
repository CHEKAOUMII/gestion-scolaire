const {
    CognitoIdentityClient,
    GetOpenIdTokenForDeveloperIdentityCommand
} = require('@aws-sdk/client-cognito-identity');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { isExpired, validateLicenseKey } = require('./license-validator');

const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
};

const cognitoClient = new CognitoIdentityClient({});
const secretsClient = new SecretsManagerClient({});

let cachedSecret = null;

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

async function handler(event) {
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

module.exports = {
    getSigningSecret,
    handler
};
