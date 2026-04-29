'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FIREBASE_PROJECT_ID = 'gestionscholaire';
const DEFAULT_FIREBASE_FUNCTIONS_REGION = 'us-central1';

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

function readFirebaseRcProjectId() {
    try {
        // Try __dirname-relative path (works in dev), then app root (works in packaged builds)
        const candidates = [
            path.join(__dirname, '..', '..', '.firebaserc'),
        ];
        try {
            const { app } = require('electron');
            candidates.push(path.join(app.getAppPath(), '.firebaserc'));
        } catch {
            // electron not available (e.g. running in tests)
        }
        for (const rcPath of candidates) {
            try {
                const data = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
                const projectId = firstNonEmptyString(data?.projects?.default);
                if (projectId) return projectId;
            } catch {
                // file not found or invalid — try next candidate
            }
        }
        return '';
    } catch {
        return '';
    }
}

function normalizeEmulatorHost(value) {
    const host = String(value || '').trim();
    if (!host) return '';
    return /^https?:\/\//i.test(host) ? host.replace(/\/+$/, '') : `http://${host.replace(/\/+$/, '')}`;
}

function deriveFirebaseFunctionsUrl(projectId, env = process.env) {
    const emulatorHost = normalizeEmulatorHost(env.FUNCTIONS_EMULATOR_HOST);
    const region = firstNonEmptyString(env.FIREBASE_FUNCTIONS_REGION, env.FUNCTIONS_REGION) || DEFAULT_FIREBASE_FUNCTIONS_REGION;
    const project = firstNonEmptyString(projectId);
    if (!project) return null;
    if (emulatorHost) {
        return `${emulatorHost}/${project}/${region}`;
    }
    return `https://${region}-${project}.cloudfunctions.net`;
}

function getAppSyncDefaults(env = process.env) {
    const firebaseProjectId =
        firstNonEmptyString(env.FIREBASE_PROJECT_ID, readFirebaseRcProjectId()) || DEFAULT_FIREBASE_PROJECT_ID;
    const firebaseFunctionsUrl = normalizeFunctionsUrl(
        firstNonEmptyString(env.FIREBASE_FUNCTIONS_URL, deriveFirebaseFunctionsUrl(firebaseProjectId, env))
    );
    const legacyAuthLambdaUrl = normalizeFunctionsUrl(firstNonEmptyString(env.AUTH_LAMBDA_URL));
    return {
        firebaseFunctionsUrl,
        firebaseProjectId,
        authLambdaUrl: firebaseFunctionsUrl || legacyAuthLambdaUrl,
        legacyAuthLambdaUrl,
        awsRegion: firstNonEmptyString(env.AWS_REGION)
    };
}

function applySyncDefaults(syncConfig, env = process.env) {
    const config = syncConfig && typeof syncConfig === 'object' ? syncConfig : {};
    const defaults = getAppSyncDefaults(env);

    const functionsUrl = normalizeFunctionsUrl(
        firstNonEmptyString(
            config.firebase_functions_url,
            config.firebaseFunctionsUrl,
            defaults.firebaseFunctionsUrl
        )
    );
    const hasExplicitFirebaseFunctionsUrl = !!firstNonEmptyString(
        config.firebase_functions_url,
        config.firebaseFunctionsUrl,
        env.FIREBASE_FUNCTIONS_URL
    );
    const configuredAuthLambdaUrl = normalizeFunctionsUrl(
        firstNonEmptyString(config.auth_lambda_url, config.authLambdaUrl, defaults.legacyAuthLambdaUrl)
    );
    const authLambdaUrl = hasExplicitFirebaseFunctionsUrl
        ? functionsUrl
        : configuredAuthLambdaUrl || functionsUrl || defaults.authLambdaUrl;

    return {
        firebaseFunctionsUrl: functionsUrl,
        firebaseProjectId:
            firstNonEmptyString(config.firebase_project_id, config.firebaseProjectId, defaults.firebaseProjectId) ||
            DEFAULT_FIREBASE_PROJECT_ID,
        authLambdaUrl,
        awsRegion: firstNonEmptyString(config.aws_region, config.awsRegion, defaults.awsRegion)
    };
}

function seedSyncDefaults(db, env = process.env) {
    const defaults = getAppSyncDefaults(env);

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
    DEFAULT_FIREBASE_FUNCTIONS_REGION,
    applySyncDefaults,
    deriveFirebaseFunctionsUrl,
    getAppSyncDefaults,
    normalizeFunctionsUrl,
    seedSyncDefaults
};
