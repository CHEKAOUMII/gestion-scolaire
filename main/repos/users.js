'use strict';

/**
 * Users, login attempts, app session settings, and user management repository.
 * Owns SQL for `users`, `login_attempts`, and user settings; IPC handles
 * session management, role verification, password hashing, and Firebase provisioning.
 */

const APP_SESSION_SETTINGS_KEY = 'app_auth_session';

function getTableColumns(db, tableName) {
    try {
        return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
    } catch {
        return new Set();
    }
}

function columnExpr(columns, columnName, fallbackSql = 'NULL') {
    return columns.has(columnName) ? columnName : `${fallbackSql} AS ${columnName}`;
}

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

function listUsers(db) {
    const columns = getTableColumns(db, 'users');
    return db
        .prepare(
            `
            SELECT
                id,
                name,
                email,
                role,
                disabled,
                must_change_password,
                created_at,
                ${columnExpr(columns, 'firebase_uid')},
                ${columnExpr(columns, 'auth_source', "'local'")},
                ${columnExpr(columns, 'email_verified', '0')},
                ${columnExpr(columns, 'invite_status', "'active'")}
            FROM users
            ORDER BY created_at DESC
        `
        )
        .all();
}

function insertUser(db, { name, email, role, passwordHash, disabled, mustChangePassword, firebaseUid, emailVerified, inviteStatus }) {
    const columns = getTableColumns(db, 'users');
    const insertColumns = ['name', 'email', 'role', 'password_hash', 'disabled', 'must_change_password'];
    const insertValues = [
        name,
        email,
        role,
        passwordHash,
        disabled ? 1 : 0,
        mustChangePassword ? 1 : 0
    ];

    if (columns.has('firebase_uid')) {
        insertColumns.push('firebase_uid');
        insertValues.push(firebaseUid || null);
    }
    if (columns.has('auth_source')) {
        insertColumns.push('auth_source');
        insertValues.push(firebaseUid ? 'firebase' : 'local');
    }
    if (columns.has('email_verified')) {
        insertColumns.push('email_verified');
        insertValues.push(emailVerified ? 1 : 0);
    }
    if (columns.has('invite_status')) {
        insertColumns.push('invite_status');
        insertValues.push(inviteStatus || (disabled ? 'disabled' : 'active'));
    }

    const placeholders = insertColumns.map(() => '?').join(', ');
    return db.prepare(`INSERT INTO users(${insertColumns.join(', ')}) VALUES(${placeholders})`).run(...insertValues);
}

function getUserWithFirebaseUid(db, id) {
    const columns = getTableColumns(db, 'users');
    return db
        .prepare(
            `
            SELECT id, name, email, role, disabled, ${columnExpr(columns, 'firebase_uid')}
            FROM users
            WHERE id = ?
        `
        )
        .get(id);
}

function updateUserRole(db, id, role) {
    return db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

function updateUserDisabled(db, id, disabled) {
    const columns = getTableColumns(db, 'users');
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
    if (columns.has('invite_status')) {
        db.prepare('UPDATE users SET invite_status = ? WHERE id = ?').run(disabled ? 'disabled' : 'active', id);
    }
}

function getAdminUser(db) {
    return db.prepare("SELECT id FROM users WHERE lower(email) = 'admin@school.local'").get();
}

function resetAdminPassword(db, passwordHash) {
    return db.prepare(
        "UPDATE users SET password_hash = ?, role = 'developer', disabled = 0, must_change_password = 0 WHERE lower(email) = 'admin@school.local'"
    ).run(passwordHash);
}

function createDeveloperUser(db, passwordHash) {
    return db.prepare(`
        INSERT INTO users(name, email, role, password_hash, disabled, must_change_password)
        VALUES('المشرف', 'admin@school.local', 'developer', ?, 0, 0)
    `).run(passwordHash);
}

function getUserPasswordHash(db, id) {
    return db.prepare('SELECT id, email, password_hash FROM users WHERE id = ?').get(id);
}

function updateUserPassword(db, id, passwordHash) {
    return db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash, id);
}

function setupPin(db, userId, pinHash) {
    return db.prepare('UPDATE users SET pin_hash = ?, pin_failed_attempts = 0 WHERE id = ?').run(pinHash, userId);
}

function getPinInfo(db, userId) {
    return db.prepare('SELECT id, pin_hash, pin_failed_attempts FROM users WHERE id = ?').get(userId);
}

function updatePinFailedAttempts(db, userId, count) {
    return db.prepare('UPDATE users SET pin_failed_attempts = ? WHERE id = ?').run(count, userId);
}

function clearPin(db, userId) {
    return db.prepare('UPDATE users SET pin_hash = NULL, pin_failed_attempts = 0 WHERE id = ?').run(userId);
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
    upsertFirebaseCachedUser,
    listUsers,
    insertUser,
    getUserWithFirebaseUid,
    updateUserRole,
    updateUserDisabled,
    getAdminUser,
    resetAdminPassword,
    createDeveloperUser,
    getUserPasswordHash,
    updateUserPassword,
    setupPin,
    getPinInfo,
    updatePinFailedAttempts,
    clearPin,
    getTableColumns
};
