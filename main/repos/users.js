'use strict';

/**
 * Users / login_attempts / app session settings data access.
 */

const APP_SESSION_SETTINGS_KEY = 'app_auth_session';

function getLoginAttempt(db, emailNormalized) {
    return db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(emailNormalized) || null;
}

function upsertLoginAttempt(db, emailNormalized, { attempts, locked_until, updated_at }) {
    db.prepare(
        `INSERT INTO login_attempts(email, attempts, locked_until, updated_at)
             VALUES(?, ?, ?, ?)
             ON CONFLICT(email) DO UPDATE SET attempts = ?, locked_until = ?, updated_at = ?`
    ).run(emailNormalized, attempts, locked_until, updated_at, attempts, locked_until, updated_at);
}

function clearLoginAttempt(db, emailNormalized) {
    db.prepare('DELETE FROM login_attempts WHERE email = ?').run(emailNormalized);
}

function cleanupStaleLoginAttempts(db, cutoffMs) {
    db.prepare('DELETE FROM login_attempts WHERE updated_at < ?').run(cutoffMs);
}

function getUserById(db, id) {
    return (
        db
            .prepare(
                `
                SELECT *
                FROM users
                WHERE id = ?
                LIMIT 1
            `
            )
            .get(Number(id)) || null
    );
}

function getUserByEmail(db, emailNormalized) {
    return (
        db
            .prepare(
                `
                SELECT *
                FROM users
                WHERE lower(email) = ?
                LIMIT 1
            `
            )
            .get(String(emailNormalized || '').toLowerCase()) || null
    );
}

function readAppSessionSettings(db) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(APP_SESSION_SETTINGS_KEY);
    return row?.value || null;
}

function writeAppSessionSettings(db, payloadJson) {
    db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)').run(
        APP_SESSION_SETTINGS_KEY,
        payloadJson
    );
}

function clearAppSessionSettings(db) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(APP_SESSION_SETTINGS_KEY);
}

function upsertFirebaseCachedUser(db, user, passwordHash, fallbackRole) {
    const name = String(user?.name || '').trim();
    const email = String(user?.email || '').trim().toLowerCase();
    const firebaseUid = String(user?.uid || '').trim();
    const role = String(user?.role || fallbackRole || 'viewer').trim();
    const emailVerified = Number(user?.emailVerified || 0) ? 1 : 0;
    const mustChangePassword = Number(user?.mustChangePassword || 0) ? 1 : 0;

    if (!name || !email) {
        throw new Error('Missing local user cache name/email');
    }

    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ? LIMIT 1').get(email);
    if (existing) {
        db.prepare(
            `
                UPDATE users
                SET
                    name = ?,
                    role = ?,
                    password_hash = ?,
                    firebase_uid = COALESCE(NULLIF(?, ''), firebase_uid),
                    auth_source = ?,
                    email_verified = ?,
                    invite_status = 'active',
                    must_change_password = ?,
                    disabled = 0,
                    last_login_at = CURRENT_TIMESTAMP,
                    last_auth_mode = 'online'
                WHERE id = ?
            `
        ).run(
            name,
            role,
            passwordHash,
            firebaseUid,
            firebaseUid ? 'firebase' : 'local',
            emailVerified,
            mustChangePassword,
            existing.id
        );
        return existing.id;
    }

    const result = db
        .prepare(
            `
                INSERT INTO users (
                    name,
                    email,
                    role,
                    password_hash,
                    firebase_uid,
                    auth_source,
                    email_verified,
                    invite_status,
                    must_change_password,
                    disabled,
                    last_login_at,
                    last_auth_mode
                )
                VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, 'active', ?, 0, CURRENT_TIMESTAMP, 'online')
            `
        )
        .run(name, email, role, passwordHash, firebaseUid, firebaseUid ? 'firebase' : 'local', emailVerified, mustChangePassword);

    return result.lastInsertRowid;
}

module.exports = {
    APP_SESSION_SETTINGS_KEY,
    getLoginAttempt,
    upsertLoginAttempt,
    clearLoginAttempt,
    cleanupStaleLoginAttempts,
    getUserById,
    getUserByEmail,
    readAppSessionSettings,
    writeAppSessionSettings,
    clearAppSessionSettings,
    upsertFirebaseCachedUser
};
