const crypto = require('crypto');
const { isExpired, validateLicenseKey } = require('../lib/auth-lambda/license-validator');

const cognitoSendMock = jest.fn();
const secretsSendMock = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity', () => ({
    CognitoIdentityClient: jest.fn(() => ({
        send: cognitoSendMock
    })),
    GetOpenIdTokenForDeveloperIdentityCommand: jest.fn((input) => ({ input }))
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: jest.fn(() => ({
        send: secretsSendMock
    })),
    GetSecretValueCommand: jest.fn((input) => ({ input }))
}));

const TEST_SECRET = 'test-secret-for-unit-tests';
const TEST_DEVICE_HASH = 'a'.repeat(64);

function createTestKey(overrides = {}, signingSecret = TEST_SECRET) {
    const payload = {
        plan: 'pro',
        exp: '2030-01-01T00:00:00.000Z',
        customer: 'TEST-SCHOOL',
        ov: false,
        dc: '',
        iat: '2026-03-21T00:00:00.000Z',
        nonce: 'abcdef0123456789',
        ...overrides
    };

    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', signingSecret).update(payloadBase64).digest('base64url');
    return `GSLK-${payloadBase64}.${signature}`;
}

function parseResponse(response) {
    return {
        ...response,
        body: JSON.parse(response.body)
    };
}

function loadHandler() {
    jest.resetModules();
    return require('../lib/auth-lambda/index').handler;
}

describe('license-validator', () => {
    test('accepts a valid key and returns the customer reference', () => {
        const result = validateLicenseKey(createTestKey(), TEST_SECRET);

        expect(result.ok).toBe(true);
        expect(result.payload.customerRef).toBe('TEST-SCHOOL');
    });

    test('rejects an invalid signature', () => {
        const result = validateLicenseKey(createTestKey({}, 'different-secret'), TEST_SECRET);

        expect(result).toEqual({
            ok: false,
            error: 'Invalid license signature'
        });
    });

    test('rejects a missing GSLK prefix', () => {
        const result = validateLicenseKey('bad-prefix', TEST_SECRET);

        expect(result.ok).toBe(false);
    });

    test('rejects a malformed key', () => {
        const result = validateLicenseKey('GSLK-invalidkey', TEST_SECRET);

        expect(result.ok).toBe(false);
    });

    test('rejects an unsupported plan', () => {
        const result = validateLicenseKey(createTestKey({ plan: 'enterprise' }), TEST_SECRET);

        expect(result.ok).toBe(false);
    });

    test('detects expiration dates correctly', () => {
        expect(isExpired('2000-01-01T00:00:00.000Z')).toBe(true);
        expect(isExpired('2999-01-01T00:00:00.000Z')).toBe(false);
        expect(isExpired(null)).toBe(false);
    });
});

describe('auth lambda handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.COGNITO_IDENTITY_POOL_ID = 'us-east-1:test-pool';
        process.env.DEVELOPER_PROVIDER_NAME = 'login.pencil.school';
        process.env.SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:pencil2/license-secret';
        delete process.env.GESTION_LICENSE_SECRET;
    });

    afterEach(() => {
        delete process.env.COGNITO_IDENTITY_POOL_ID;
        delete process.env.DEVELOPER_PROVIDER_NAME;
        delete process.env.SECRET_ARN;
        delete process.env.GESTION_LICENSE_SECRET;
    });

    test('returns scoped credentials for a valid request', async () => {
        secretsSendMock.mockResolvedValue({ SecretString: TEST_SECRET });
        cognitoSendMock.mockResolvedValue({
            IdentityId: 'us-east-1:identity-id',
            Token: 'oidc-token'
        });

        const handler = loadHandler();
        const response = parseResponse(
            await handler({
                body: JSON.stringify({
                    licenseKey: createTestKey(),
                    deviceHash: TEST_DEVICE_HASH
                })
            })
        );

        expect(response.statusCode).toBe(200);
        expect(response.headers).toEqual({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        });
        expect(response.body).toMatchObject({
            identityId: 'us-east-1:identity-id',
            token: 'oidc-token',
            schoolId: 'TEST-SCHOOL'
        });
        expect(response.body.expiresAt).toEqual(expect.any(Number));
        expect(secretsSendMock).toHaveBeenCalledTimes(1);
        expect(cognitoSendMock).toHaveBeenCalledTimes(1);
    });

    test('rejects a missing licenseKey', async () => {
        const handler = loadHandler();
        const response = parseResponse(
            await handler({
                body: JSON.stringify({
                    deviceHash: TEST_DEVICE_HASH
                })
            })
        );

        expect(response.statusCode).toBe(400);
        expect(response.body.error).toBe('MALFORMED_REQUEST');
    });

    test('rejects an invalid deviceHash format', async () => {
        const handler = loadHandler();
        const response = parseResponse(
            await handler({
                body: JSON.stringify({
                    licenseKey: createTestKey(),
                    deviceHash: 'invalid-hash'
                })
            })
        );

        expect(response.statusCode).toBe(400);
        expect(response.body.error).toBe('MALFORMED_REQUEST');
    });

    test('does not treat request body statusCode as a prebuilt response', async () => {
        const handler = loadHandler();
        const response = parseResponse(
            await handler({
                statusCode: 200
            })
        );

        expect(response.statusCode).toBe(400);
        expect(response.headers).toEqual({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        });
        expect(response.body).toEqual({
            error: 'MALFORMED_REQUEST',
            message: 'Missing required field: licenseKey'
        });
    });

    test('rejects an invalid license key', async () => {
        secretsSendMock.mockResolvedValue({ SecretString: TEST_SECRET });

        const handler = loadHandler();
        const response = parseResponse(
            await handler({
                body: JSON.stringify({
                    licenseKey: 'GSLK-invalid.payload',
                    deviceHash: TEST_DEVICE_HASH
                })
            })
        );

        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('INVALID_KEY');
    });

    test('rejects an expired license key', async () => {
        secretsSendMock.mockResolvedValue({ SecretString: TEST_SECRET });

        const handler = loadHandler();
        const response = parseResponse(
            await handler({
                body: JSON.stringify({
                    licenseKey: createTestKey({ exp: '2000-01-01T00:00:00.000Z' }),
                    deviceHash: TEST_DEVICE_HASH
                })
            })
        );

        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('EXPIRED_KEY');
    });

    test('returns a generic internal error when Cognito fails', async () => {
        secretsSendMock.mockResolvedValue({ SecretString: TEST_SECRET });
        cognitoSendMock.mockRejectedValue(new Error('boom'));

        const handler = loadHandler();
        const response = parseResponse(
            await handler({
                body: JSON.stringify({
                    licenseKey: createTestKey(),
                    deviceHash: TEST_DEVICE_HASH
                })
            })
        );

        expect(response.statusCode).toBe(500);
        expect(response.body).toEqual({
            error: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred'
        });
    });
});
