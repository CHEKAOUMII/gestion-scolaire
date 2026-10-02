'use strict';

/**
 * Institution repository.
 * Owns SQL for `institution_config` (device provisioning + school identity
 * fields), the `sync_config` row written during setup/relink, and the
 * `school_identity` seeds applied by setup. The Firebase Functions network
 * orchestration stays in the IPC layer.
 */

const { ensureSchoolIdentitySchema } = require('../db/schema');
const usersRepo = require('./users');

// Pre-refactor Massar/GRESA codes always matched this digits-then-1-2-letters shape (e.g.
// "12345A"). It is used ONLY to tell a genuine legacy code — safe to display — apart from a
// new server-generated opaque School_Id (20–30 random [A-Z0-9] chars, which never matches
// this shape) when deriving a display Massar_Code for rows that have no explicit massar_code.
// setup_mode cannot be used for this: the old setup flow also stamped 'firebase-new'.
const LEGACY_MASSAR_CODE_SHAPE = /^\d+[A-Za-z]{1,2}$/;

function normalizeMassarCode(value) {
    return String(value || '').trim().toUpperCase();
}

function looksLikeLegacyMassarCode(value) {
    return LEGACY_MASSAR_CODE_SHAPE.test(normalizeMassarCode(value));
}

function getStatusRecord(db) {
    const institutionRow = db
        .prepare(
            'SELECT setup_completed, code_etablissement, massar_code, institution_name FROM institution_config WHERE id = 1'
        )
        .get();
    const syncRow = db.prepare('SELECT school_id FROM sync_config WHERE id = 1').get();

    const explicitMassar = normalizeMassarCode(institutionRow?.massar_code);
    const legacyCode = normalizeMassarCode(institutionRow?.code_etablissement);
    const legacySchoolId = normalizeMassarCode(syncRow?.school_id);

    // Displayed Massar_Code: the explicit value always wins. Only when it is empty do we fall
    // back to code_etablissement / school_id, and then ONLY if that value is a genuine legacy
    // Massar code. Under the new scheme those columns hold the opaque server-generated
    // School_Id (the tenant key), which must never be shown to the user as a Massar_Code —
    // so an institution set up without a Massar_Code correctly reports none (Req 3.3, 3.5).
    const massarCode =
        explicitMassar ||
        (looksLikeLegacyMassarCode(legacyCode) ? legacyCode : '') ||
        (looksLikeLegacyMassarCode(legacySchoolId) ? legacySchoolId : '') ||
        null;

    const institutionName = String(institutionRow?.institution_name || '').trim() || null;

    // setupCompleted reflects provisioning state, NOT whether a displayable Massar_Code exists
    // (a new institution may legitimately have none). Detect it from the presence of any stored
    // identifier — including the opaque School_Id — mirroring the original completion logic.
    const anyIdentifier = explicitMassar || legacyCode || legacySchoolId;
    const setupCompleted =
        !!anyIdentifier &&
        (!!Number(institutionRow?.setup_completed) || !!legacyCode || !institutionRow);

    return {
        setupCompleted,
        massarCode,
        institutionName
    };
}

function getSyncConfigRow(db) {
    return db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
}

/**
 * Raw technical code read (may be the opaque server-generated School_Id — the tenant
 * key used for Firebase provisioning and link requests). This is deliberately NOT
 * getStatusRecord's massarCode, which is the display value that hides opaque ids.
 * Column-existence tolerant, mirroring the pre-refactor guarded read.
 */
function getCodeEtablissement(db) {
    try {
        const columns = new Set(db.prepare('PRAGMA table_info(institution_config)').all().map((column) => column.name));
        if (!columns.has('code_etablissement')) return '';
        const row = db.prepare('SELECT code_etablissement FROM institution_config WHERE id = 1').get() || {};
        return String(row.code_etablissement || '');
    } catch {
        return '';
    }
}

function upsertSyncConfig(db, syncConfig) {
    const currentConfig = db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
    const firebaseFunctionsUrl =
        syncConfig.firebaseFunctionsUrl ||
        currentConfig.firebase_functions_url ||
        null;
    const mergedConfig = {
        schoolId: syncConfig.schoolId || currentConfig.school_id || null,
        firebaseFunctionsUrl,
        firebaseProjectId: syncConfig.firebaseProjectId || currentConfig.firebase_project_id || null,
        firebaseApiKey: syncConfig.firebaseApiKey || currentConfig.firebase_api_key || null,
        firebaseAuthDomain: syncConfig.firebaseAuthDomain || currentConfig.firebase_auth_domain || null,
        firebaseAppId: syncConfig.firebaseAppId || currentConfig.firebase_app_id || null,
        firebaseStorageBucket: syncConfig.firebaseStorageBucket || currentConfig.firebase_storage_bucket || null,
        firebaseMessagingSenderId:
            syncConfig.firebaseMessagingSenderId || currentConfig.firebase_messaging_sender_id || null,
        syncIntervalMinutes: syncConfig.syncIntervalMinutes || Number(currentConfig.sync_interval_minutes) || 10,
        enabled: 1
    };

    db.prepare(
        `
            INSERT INTO sync_config (
                id,
                school_id,
                firebase_functions_url,
                firebase_project_id,
                firebase_api_key,
                firebase_auth_domain,
                firebase_app_id,
                firebase_storage_bucket,
                firebase_messaging_sender_id,
                sync_interval_minutes,
                enabled,
                updated_at
            )
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                school_id = excluded.school_id,
                firebase_functions_url = excluded.firebase_functions_url,
                firebase_project_id = excluded.firebase_project_id,
                firebase_api_key = excluded.firebase_api_key,
                firebase_auth_domain = excluded.firebase_auth_domain,
                firebase_app_id = excluded.firebase_app_id,
                firebase_storage_bucket = excluded.firebase_storage_bucket,
                firebase_messaging_sender_id = excluded.firebase_messaging_sender_id,
                sync_interval_minutes = excluded.sync_interval_minutes,
                enabled = excluded.enabled,
                updated_at = CURRENT_TIMESTAMP
        `
    ).run(
        mergedConfig.schoolId,
        mergedConfig.firebaseFunctionsUrl,
        mergedConfig.firebaseProjectId,
        mergedConfig.firebaseApiKey,
        mergedConfig.firebaseAuthDomain,
        mergedConfig.firebaseAppId,
        mergedConfig.firebaseStorageBucket,
        mergedConfig.firebaseMessagingSenderId,
        mergedConfig.syncIntervalMinutes,
        mergedConfig.enabled
    );

    try {
        if (mergedConfig.firebaseFunctionsUrl) {
            const url = mergedConfig.firebaseFunctionsUrl;
            db.prepare('UPDATE sync_config SET firebase_functions_url = ? WHERE id = 1').run(url);
        }
    } catch {
        // Column not yet added by migration — safe to ignore
    }
}

function applyRelink(db, schoolId, massarCode) {
    const transaction = db.transaction(() => {
        db.prepare(
            `INSERT INTO institution_config (id, code_etablissement, massar_code, setup_completed, setup_mode, updated_at)
             VALUES (1, ?, ?, 0, NULL, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET
                 code_etablissement = excluded.code_etablissement,
                 massar_code = excluded.massar_code,
                 setup_completed = 0,
                 setup_mode = NULL,
                 updated_at = CURRENT_TIMESTAMP`
        ).run(schoolId, massarCode);

        db.prepare(
            'UPDATE sync_config SET school_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        ).run(schoolId);
    });
    transaction();
}

function applyBootstrap(db, { bootstrap, passwordHash, deviceHash, academy, directorate }) {
    const transaction = db.transaction(() => {
        db.prepare(
            `
                    INSERT INTO institution_config (
                        id,
                        code_etablissement,
                        massar_code,
                        institution_name,
                        setup_completed,
                        setup_mode,
                        setup_device_hash,
                        onboarding_version,
                        onboarding_completed_at,
                        updated_at
                    )
                    VALUES (1, ?, ?, ?, 1, 'firebase-new', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO UPDATE SET
                        code_etablissement = excluded.code_etablissement,
                        massar_code = excluded.massar_code,
                        institution_name = excluded.institution_name,
                        setup_completed = 1,
                        setup_mode = 'firebase-new',
                        setup_device_hash = excluded.setup_device_hash,
                        onboarding_version = 1,
                        onboarding_completed_at = COALESCE(onboarding_completed_at, CURRENT_TIMESTAMP),
                        updated_at = CURRENT_TIMESTAMP
                `
        ).run(bootstrap.schoolId, null, bootstrap.institutionName, deviceHash);

        upsertSyncConfig(db, bootstrap.syncConfig);
        usersRepo.upsertFirebaseCachedUser(db, { ...bootstrap.user, role: 'principal' }, passwordHash, 'principal');

        // Seed the region into school_identity when provided. Uses an upsert on the
        // key/value schema (INSERT OR IGNORE default-seeding elsewhere would no-op once
        // the keys exist, so it cannot fill them — see the plan's empty-seed note). Only
        // non-empty values are written, so blanks never clobber later user edits.
        if (academy || directorate) {
            ensureSchoolIdentitySchema(db);
            const upsertIdentity = db.prepare(
                `INSERT INTO school_identity (key, value, updated_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
            );
            const identityTs = Date.now();
            if (academy) upsertIdentity.run('academy', academy, identityTs);
            if (directorate) upsertIdentity.run('directorate', directorate, identityTs);
        }
    });
    transaction();
}

function setMassarCode(db, massarCode) {
    db.prepare('UPDATE institution_config SET massar_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(massarCode);
}

function applyInstitutionName(db, newName) {
    const transaction = db.transaction(() => {
        if (newName) {
            db.prepare(
                'UPDATE institution_config SET institution_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
            ).run(newName);

            try {
                db.prepare(
                    'UPDATE school_identity SET school_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
                ).run(newName);
            } catch {
                // school_identity table may not exist
            }
        }
    });
    transaction();
}

module.exports = {
    normalizeMassarCode,
    looksLikeLegacyMassarCode,
    getStatusRecord,
    getSyncConfigRow,
    getCodeEtablissement,
    upsertSyncConfig,
    applyRelink,
    applyBootstrap,
    setMassarCode,
    applyInstitutionName
};
