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

function normalizeUrl(value) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.replace(/\/+$/, '') : null;
}

function getAppSyncDefaults(env = process.env) {
    return {
        firebaseFunctionsUrl: normalizeUrl(
            firstNonEmptyString(
                env.FIREBASE_FUNCTIONS_URL,
                env.SYNC_FIREBASE_FUNCTIONS_URL,
                env.GESTION_FIREBASE_FUNCTIONS_URL
            )
        ),
        firebaseProjectId: firstNonEmptyString(
            env.FIREBASE_PROJECT_ID,
            env.SYNC_FIREBASE_PROJECT_ID,
            env.GESTION_FIREBASE_PROJECT_ID
        ),
        authLambdaUrl: normalizeUrl(
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
        firebaseFunctionsUrl: normalizeUrl(
            firstNonEmptyString(
                config.firebaseFunctionsUrl,
                config.firebase_functions_url,
                defaults.firebaseFunctionsUrl
            )
        ),
        firebaseProjectId: firstNonEmptyString(
            config.firebaseProjectId,
            config.firebase_project_id,
            defaults.firebaseProjectId
        ),
        authLambdaUrl: normalizeUrl(
            firstNonEmptyString(config.authLambdaUrl, config.auth_lambda_url, defaults.authLambdaUrl)
        ),
        awsRegion: firstNonEmptyString(config.awsRegion, config.aws_region, defaults.awsRegion) || DEFAULT_AWS_REGION
    };
}

function seedSyncDefaults(db, env = process.env) {
    const defaults = getAppSyncDefaults(env);
    const columns = new Set(db.pragma('table_info(sync_config)').map((column) => column.name));
    const setClauses = [];
    const setParams = [];
    const updateTriggers = [];
    const triggerParams = [];

    if (columns.has('firebase_functions_url')) {
        setClauses.push(`
            firebase_functions_url = CASE
                WHEN COALESCE(trim(firebase_functions_url), '') = '' AND ? IS NOT NULL THEN ?
                ELSE firebase_functions_url
            END
        `);
        setParams.push(defaults.firebaseFunctionsUrl, defaults.firebaseFunctionsUrl);
        updateTriggers.push("(COALESCE(trim(firebase_functions_url), '') = '' AND ? IS NOT NULL)");
        triggerParams.push(defaults.firebaseFunctionsUrl);
    }

    if (columns.has('firebase_project_id')) {
        setClauses.push(`
            firebase_project_id = CASE
                WHEN COALESCE(trim(firebase_project_id), '') = '' AND ? != '' THEN ?
                ELSE firebase_project_id
            END
        `);
        setParams.push(defaults.firebaseProjectId, defaults.firebaseProjectId);
        updateTriggers.push("(COALESCE(trim(firebase_project_id), '') = '' AND ? != '')");
        triggerParams.push(defaults.firebaseProjectId);
    }

    if (columns.has('auth_lambda_url')) {
        setClauses.push(`
            auth_lambda_url = CASE
                WHEN COALESCE(trim(auth_lambda_url), '') = '' AND ? IS NOT NULL THEN ?
                ELSE auth_lambda_url
            END
        `);
        setParams.push(defaults.authLambdaUrl, defaults.authLambdaUrl);
        updateTriggers.push("(COALESCE(trim(auth_lambda_url), '') = '' AND ? IS NOT NULL)");
        triggerParams.push(defaults.authLambdaUrl);
    }

    if (columns.has('aws_region')) {
        setClauses.push(`
            aws_region = CASE
                WHEN COALESCE(trim(aws_region), '') = '' THEN ?
                ELSE aws_region
            END
        `);
        setParams.push(defaults.awsRegion);
        updateTriggers.push("COALESCE(trim(aws_region), '') = ''");
    }

    if (setClauses.length > 0) {
        const updatedAtClause = updateTriggers.length
            ? `
                updated_at = CASE
                    WHEN ${updateTriggers.join(' OR ')}
                    THEN CURRENT_TIMESTAMP
                    ELSE updated_at
                END
            `
            : 'updated_at = updated_at';

        db.prepare(
            `
                UPDATE sync_config
                SET
                    ${setClauses.join(',\n                    ')},
                    ${updatedAtClause}
                WHERE id = 1
            `
        ).run(...setParams, ...triggerParams);
    }

    return defaults;
}

module.exports = {
    DEFAULT_AWS_REGION,
    applySyncDefaults,
    getAppSyncDefaults,
    normalizeUrl,
    seedSyncDefaults
};
