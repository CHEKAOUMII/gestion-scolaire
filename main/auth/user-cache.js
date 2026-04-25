'use strict';

const { getDb } = require('../db/context');
const { ALLOWED_ROLES, resolveRole } = require('./permissions');

function normalizeEmail(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function normalizeRole(value) {
    const role = resolveRole(String(value || '').trim().toLowerCase());
    return ALLOWED_ROLES.includes(role) ? role : 'principal';
}

function normalizeInviteStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    return status || 'active';
}

function findCachedUserByFirebaseUid(firebaseUid) {
    const uid = String(firebaseUid || '').trim();
    if (!uid) return null;

    return (
        getDb()
            .prepare(
                `
                SELECT *
                FROM users
                WHERE firebase_uid = ?
                LIMIT 1
            `
            )
            .get(uid) || null
    );
}

function findCachedUserByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return null;

    return (
        getDb()
            .prepare(
                `
                SELECT *
                FROM users
                WHERE lower(email) = ?
                LIMIT 1
            `
            )
            .get(normalizedEmail) || null
    );
}

function upsertCachedFirebaseUser(profile = {}) {
    const db = getDb();
    const firebaseUid = String(profile.firebaseUid || profile.firebase_uid || profile.uid || '').trim();
    const email = normalizeEmail(profile.email);

    if (!firebaseUid) {
        throw new Error('firebaseUid is required to cache a Firebase user');
    }
    if (!email) {
        throw new Error('email is required to cache a Firebase user');
    }

    const name = String(profile.name || profile.displayName || email).trim();
    const role = normalizeRole(profile.role);
    const emailVerified = (profile.emailVerified ?? profile.email_verified) ? 1 : 0;
    const inviteStatus = normalizeInviteStatus(profile.inviteStatus || profile.invite_status);
    const disabled = profile.disabled ? 1 : 0;
    const existingByUid = findCachedUserByFirebaseUid(firebaseUid);

    if (existingByUid) {
        db.prepare(
            `
            UPDATE users
            SET
                name = ?,
                email = ?,
                role = ?,
                auth_source = 'firebase',
                email_verified = ?,
                invite_status = ?,
                disabled = ?
            WHERE firebase_uid = ?
        `
        ).run(name, email, role, emailVerified, inviteStatus, disabled, firebaseUid);

        return findCachedUserByFirebaseUid(firebaseUid);
    }

    db.prepare(
        `
            INSERT INTO users (
                name,
                email,
                role,
                firebase_uid,
                auth_source,
                email_verified,
                invite_status,
                disabled,
                must_change_password
            )
            VALUES (?, ?, ?, ?, 'firebase', ?, ?, ?, 0)
            ON CONFLICT(email) DO UPDATE SET
                name = excluded.name,
                role = excluded.role,
                firebase_uid = excluded.firebase_uid,
                auth_source = 'firebase',
                email_verified = excluded.email_verified,
                invite_status = excluded.invite_status,
                disabled = excluded.disabled
        `
    ).run(name, email, role, firebaseUid, emailVerified, inviteStatus, disabled);

    return findCachedUserByFirebaseUid(firebaseUid) || findCachedUserByEmail(email);
}

function recordCachedUserLogin(userId, authMode) {
    const id = Number(userId || 0);
    const mode = String(authMode || '').trim();
    if (!id) return null;

    getDb()
        .prepare(
            `
            UPDATE users
            SET
                last_login_at = CURRENT_TIMESTAMP,
                last_auth_mode = ?
            WHERE id = ?
        `
        )
        .run(mode || null, id);

    return (
        getDb()
            .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
            .get(id) || null
    );
}

module.exports = {
    normalizeEmail,
    findCachedUserByFirebaseUid,
    findCachedUserByEmail,
    upsertCachedFirebaseUser,
    recordCachedUserLogin
};
