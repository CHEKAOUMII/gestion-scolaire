'use strict';

const DEFAULT_AWS_REGION = 'us-east-1';

function firstNonEmptyString(...values) {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

function normalizeAuthLambdaUrl(value) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.replace(/\/+$/, '') : null;
}

function getAppSyncDefaults(env = process.env) {
    return {
        authLambdaUrl: normalizeAuthLambdaUrl(
            firstNonEmptyString(env.AUTH_LAMBDA_URL, env.SYNC_AUTH_LAMBDA_URL, env.GESTION_AUTH_LAMBDA_URL)
        ),
        awsRegion:
            firstNonEmptyString(env.AWS_REGION, env.AWS_DEFAULT_REGION, env.SYNC_AWS_REGION) || DEFAULT_AWS_REGION
    };
}

function applySyncDefaults(syncConfig, env = process.env) {
    const config = syncConfig && typeof syncConfig === 'object' ? syncConfig : {};
    const defaults = getAppSyncDefaults(env);

    return {
        authLambdaUrl: normalizeAuthLambdaUrl(
            firstNonEmptyString(config.authLambdaUrl, config.auth_lambda_url, defaults.authLambdaUrl)
        ),
        awsRegion: firstNonEmptyString(config.awsRegion, config.aws_region, defaults.awsRegion) || DEFAULT_AWS_REGION
    };
}

function seedSyncDefaults(db, env = process.env) {
    const defaults = getAppSyncDefaults(env);
    db.prepare(
        `
            UPDATE sync_config
            SET
                auth_lambda_url = CASE
                    WHEN COALESCE(trim(auth_lambda_url), '') = '' AND ? IS NOT NULL THEN ?
                    ELSE auth_lambda_url
                END,
                aws_region = CASE
                    WHEN COALESCE(trim(aws_region), '') = '' THEN ?
                    ELSE aws_region
                END,
                updated_at = CASE
                    WHEN (COALESCE(trim(auth_lambda_url), '') = '' AND ? IS NOT NULL)
                        OR COALESCE(trim(aws_region), '') = ''
                    THEN CURRENT_TIMESTAMP
                    ELSE updated_at
                END
            WHERE id = 1
        `
    ).run(defaults.authLambdaUrl, defaults.authLambdaUrl, defaults.awsRegion, defaults.authLambdaUrl);

    return defaults;
}

module.exports = {
    DEFAULT_AWS_REGION,
    applySyncDefaults,
    getAppSyncDefaults,
    normalizeAuthLambdaUrl,
    seedSyncDefaults
};
