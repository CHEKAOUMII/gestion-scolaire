'use strict';

const DEFAULT_FIREBASE_PROJECT_ID = 'gestionscholaire';

function firstNonEmptyString(...values) {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

function normalizeFunctionsUrl(value) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.replace(/\/+$/, '') : null;
}

// Backward-compatible alias
const normalizeAuthLambdaUrl = normalizeFunctionsUrl;

function getAppSyncDefaults(env = process.env) {
    return {
        firebaseFunctionsUrl: normalizeFunctionsUrl(
            firstNonEmptyString(
                env.FIREBASE_FUNCTIONS_URL,
                env.AUTH_LAMBDA_URL,
                env.SYNC_AUTH_LAMBDA_URL,
                env.GESTION_AUTH_LAMBDA_URL
            )
        ),
        firebaseProjectId: firstNonEmptyString(env.FIREBASE_PROJECT_ID) || DEFAULT_FIREBASE_PROJECT_ID,
        // Backward compat aliases
        authLambdaUrl: normalizeFunctionsUrl(
            firstNonEmptyString(
                env.FIREBASE_FUNCTIONS_URL,
                env.AUTH_LAMBDA_URL,
                env.SYNC_AUTH_LAMBDA_URL,
                env.GESTION_AUTH_LAMBDA_URL
            )
        ),
        awsRegion: firstNonEmptyString(env.AWS_REGION, env.AWS_DEFAULT_REGION, env.SYNC_AWS_REGION) || null
    };
}

function applySyncDefaults(syncConfig, env = process.env) {
    const config = syncConfig && typeof syncConfig === 'object' ? syncConfig : {};
    const defaults = getAppSyncDefaults(env);

    const functionsUrl = normalizeFunctionsUrl(
        firstNonEmptyString(
            config.firebase_functions_url,
            config.firebaseFunctionsUrl,
            config.authLambdaUrl,
            config.auth_lambda_url,
            defaults.firebaseFunctionsUrl
        )
    );

    return {
        firebaseFunctionsUrl: functionsUrl,
        firebaseProjectId:
            firstNonEmptyString(config.firebase_project_id, config.firebaseProjectId, defaults.firebaseProjectId) ||
            DEFAULT_FIREBASE_PROJECT_ID,
        // Backward compat aliases
        authLambdaUrl: functionsUrl,
        awsRegion: firstNonEmptyString(config.awsRegion, config.aws_region, defaults.awsRegion) || null
    };
}

function seedSyncDefaults(db, env = process.env) {
    const defaults = getAppSyncDefaults(env);

    // Seed auth_lambda_url (existing column — always present)
    db.prepare(
        `
            UPDATE sync_config
            SET
                auth_lambda_url = CASE
                    WHEN COALESCE(trim(auth_lambda_url), '') = '' AND ? IS NOT NULL THEN ?
                    ELSE auth_lambda_url
                END,
                updated_at = CASE
                    WHEN COALESCE(trim(auth_lambda_url), '') = '' AND ? IS NOT NULL
                    THEN CURRENT_TIMESTAMP
                    ELSE updated_at
                END
            WHERE id = 1
        `
    ).run(defaults.firebaseFunctionsUrl, defaults.firebaseFunctionsUrl, defaults.firebaseFunctionsUrl);

    // Seed firebase_functions_url (new column — may not exist yet, ignore if missing)
    try {
        db.prepare(
            `
                UPDATE sync_config
                SET
                    firebase_functions_url = CASE
                        WHEN COALESCE(trim(firebase_functions_url), '') = '' AND ? IS NOT NULL THEN ?
                        ELSE firebase_functions_url
                    END
                WHERE id = 1
            `
        ).run(defaults.firebaseFunctionsUrl, defaults.firebaseFunctionsUrl);
    } catch {
        // Column not yet added by migration — safe to ignore
    }

    try {
        db.prepare(
            `
                UPDATE sync_config
                SET
                    firebase_project_id = CASE
                        WHEN COALESCE(trim(firebase_project_id), '') = '' AND ? IS NOT NULL THEN ?
                        ELSE firebase_project_id
                    END
                WHERE id = 1
            `
        ).run(defaults.firebaseProjectId, defaults.firebaseProjectId);
    } catch {
        // Column not yet added by migration - safe to ignore
    }

    return defaults;
}

module.exports = {
    DEFAULT_FIREBASE_PROJECT_ID,
    applySyncDefaults,
    getAppSyncDefaults,
    normalizeFunctionsUrl,
    normalizeAuthLambdaUrl,
    seedSyncDefaults
};
