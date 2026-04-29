'use strict';
// redeploy: 2026-04-26
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { verifyPassword } = require('./password-utils');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

const ALLOWED_ROLES = new Set([
    'admin',
    'principal',
    'supervisor',
    'external-guardian',
    'internal-guardian',
    'admin-assistant',
    'educational-specialist',
    'social-specialist',
    'teacher',
    'viewer'
]);
const ADMIN_ROLES = new Set(['admin', 'developer']);

function requirePost(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return false;
    }
    return true;
}

function normalizeSchoolId(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeRole(value, fallback = 'viewer') {
    const role = String(value || fallback).trim();
    if (!ALLOWED_ROLES.has(role)) {
        throw new Error('INVALID_ROLE');
    }
    return role;
}

function publicUserProfile(data) {
    return {
        uid: data.uid,
        email: data.email,
        name: data.name,
        role: data.role,
        status: data.status,
        mustChangePassword: !!data.mustChangePassword
    };
}

async function requireSchoolAdmin(idToken) {
    if (!idToken) {
        const err = new Error('MISSING_ID_TOKEN');
        err.status = 401;
        throw err;
    }

    const decoded = await auth.verifyIdToken(idToken);
    const schoolId = normalizeSchoolId(decoded.schoolId);
    const role = String(decoded.role || '').trim();
    if (!schoolId || !ADMIN_ROLES.has(role)) {
        const err = new Error('ADMIN_REQUIRED');
        err.status = 403;
        throw err;
    }

    const profileSnap = await db.doc(`schools/${schoolId}/users/${decoded.uid}`).get();
    if (profileSnap.exists && profileSnap.get('status') === 'disabled') {
        const err = new Error('USER_DISABLED');
        err.status = 403;
        throw err;
    }

    return { decoded, schoolId, role, uid: decoded.uid };
}

function functionError(res, err) {
    const code = err.message || 'INTERNAL_ERROR';
    const status = Number(err.status) || (
        code === 'INVALID_ROLE' || code === 'INVALID_REQUEST' ? 400 :
        code === 'BOOTSTRAP_SECRET_NOT_CONFIGURED' ? 500 :
        code === 'BOOTSTRAP_UNAUTHORIZED' ? 403 :
        code === 'SCHOOL_EXISTS' || code === 'EMAIL_IN_USE_DIFFERENT_SCHOOL' ? 409 :
        500
    );
    return res.status(status).json({ error: code, code });
}

function requireBootstrapAuthorization(req) {
    const expectedSecret = String(process.env.GESTION_BOOTSTRAP_SECRET || '').trim();
    if (!expectedSecret) {
        const err = new Error('BOOTSTRAP_SECRET_NOT_CONFIGURED');
        err.status = 500;
        throw err;
    }

    const suppliedSecret = String(req.get('x-bootstrap-secret') || req.body?.bootstrapSecret || '').trim();
    const expected = Buffer.from(expectedSecret);
    const supplied = Buffer.from(suppliedSecret);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
        const err = new Error('BOOTSTRAP_UNAUTHORIZED');
        err.status = 403;
        throw err;
    }
}

function getPublicFirebaseConfig() {
    const projectId =
        process.env.FIREBASE_PROJECT_ID ||
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        '';

    return {
        apiKey: process.env.FIREBASE_API_KEY || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
        projectId,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.FIREBASE_APP_ID || ''
    };
}

function buildInviteId(email, uid) {
    return crypto.createHash('sha256').update(`${email}:${uid}`).digest('hex').slice(0, 24);
}

function generateTemporaryPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(14);
    let password = 'P2!';
    for (const byte of bytes) {
        password += alphabet[byte % alphabet.length];
    }
    return password;
}

function publicInvite(invite) {
    if (!invite) return null;
    return {
        id: invite.id,
        uid: invite.uid,
        email: invite.email,
        name: invite.name,
        role: invite.role,
        status: invite.status,
        createdBy: invite.createdBy
    };
}

async function createOrUpdateSchoolUser({ schoolId, email, password, name, role, mustChangePassword, createdBy, disabled }) {
    let userRecord;
    try {
        userRecord = await auth.getUserByEmail(email);
        const existingClaims = userRecord.customClaims || {};
        if (existingClaims.schoolId && normalizeSchoolId(existingClaims.schoolId) !== schoolId) {
            const err = new Error('EMAIL_IN_USE_DIFFERENT_SCHOOL');
            err.status = 409;
            throw err;
        }

        const authUpdate = {
            displayName: name,
            disabled: !!disabled
        };
        if (password) authUpdate.password = password;
        userRecord = await auth.updateUser(userRecord.uid, authUpdate);
    } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
        userRecord = await auth.createUser({
            email,
            password,
            displayName: name,
            disabled: !!disabled
        });
    }

    await auth.setCustomUserClaims(userRecord.uid, { schoolId, role });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const profile = {
        uid: userRecord.uid,
        name,
        email,
        role,
        status: disabled ? 'disabled' : 'active',
        mustChangePassword: !!mustChangePassword,
        schoolId,
        updatedAt: now
    };

    const profileRef = db.doc(`schools/${schoolId}/users/${userRecord.uid}`);
    const profileSnap = await profileRef.get();
    await profileRef.set({
        ...profile,
        createdAt: profileSnap.exists ? profileSnap.get('createdAt') || now : now,
        createdBy: profileSnap.exists ? profileSnap.get('createdBy') || createdBy || null : createdBy || null
    }, { merge: true });

    return { userRecord, profile };
}

/**
 * Validates a license key signed with HMAC-SHA256.
 * Key format: base64url(payload).signatureHex.version
 */
function validateLicenseKey(licenseKey, secret) {
    if (!secret) throw new Error('License validation secret not configured');

    const parts = String(licenseKey || '').split('.');
    if (parts.length !== 3) throw new Error('Invalid license key format');

    const [payloadB64, signatureHex] = parts;

    let expectedSig;
    try {
        expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
    } catch {
        throw new Error('Failed to compute license signature');
    }

    if (signatureHex.length !== expectedSig.length) throw new Error('Invalid license key signature');

    try {
        if (!crypto.timingSafeEqual(Buffer.from(signatureHex, 'hex'), Buffer.from(expectedSig, 'hex'))) {
            throw new Error('Invalid license key signature');
        }
    } catch {
        throw new Error('Invalid license key signature');
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return {
        customerRef: payload.customerRef || payload.customer,
        plan: payload.plan,
        expiresAt: payload.expiresAt || payload.exp || null
    };
}

/**
 * POST /authExchange
 * Validates licenseKey + deviceHash, mints a Firebase custom token with schoolId claim.
 * Replaces: Cognito GetOpenIdTokenForDeveloperIdentity
 */
exports.authExchange = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    const { licenseKey, deviceHash } = req.body || {};
    if (!licenseKey || !deviceHash) return res.status(400).json({ error: 'Missing licenseKey or deviceHash' });

    const secret = process.env.GESTION_LICENSE_SECRET || '';
    let customerRef, expiresAt;
    try {
        const result = validateLicenseKey(licenseKey, secret);
        customerRef = result.customerRef;
        expiresAt = result.expiresAt;
    } catch (err) {
        return res.status(401).json({ error: err.message });
    }

    if (expiresAt && expiresAt < Math.floor(Date.now() / 1000)) {
        return res.status(401).json({ error: 'License expired' });
    }

    const uid = `device_${deviceHash}`;
    try {
        await auth.getUser(uid);
    } catch {
        await auth.createUser({ uid, displayName: `Device ${String(deviceHash).substring(0, 8)}` });
    }

    await auth.setCustomUserClaims(uid, { schoolId: customerRef });
    const customToken = await auth.createCustomToken(uid, { schoolId: customerRef });

    return res.status(200).json({ customToken, schoolId: customerRef, expiresAt: expiresAt || null });
});

/**
 * POST /bootstrapInstitution
 * Creates a school, its institution metadata, and the first admin Firebase user.
 */
exports.bootstrapInstitution = onRequest({ cors: true, secrets: ['GESTION_BOOTSTRAP_SECRET'] }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        requireBootstrapAuthorization(req);
        const {
            gresaCode,
            schoolId: rawSchoolId,
            massarCode,
            institutionName,
            adminEmail,
            adminPassword,
            adminName
        } = req.body || {};
        const schoolId = normalizeSchoolId(gresaCode || rawSchoolId || massarCode);
        const email = normalizeEmail(adminEmail);
        const name = String(adminName || '').trim();
        const schoolName = String(institutionName || '').trim() || schoolId;

        if (!schoolId || !schoolName || !email || !adminPassword || !name) {
            const err = new Error('INVALID_REQUEST');
            err.status = 400;
            throw err;
        }

        const schoolRef = db.doc(`schools/${schoolId}`);
        const schoolSnap = await schoolRef.get();
        if (schoolSnap.exists) {
            const err = new Error('SCHOOL_EXISTS');
            err.status = 409;
            throw err;
        }

        const { userRecord, profile } = await createOrUpdateSchoolUser({
            schoolId,
            email,
            password: adminPassword,
            name,
            role: 'principal',
            mustChangePassword: false,
            createdBy: 'bootstrap'
        });

        const now = admin.firestore.FieldValue.serverTimestamp();
        const institution = {
            schoolId,
            gresaCode: schoolId,
            institutionName: schoolName,
            adminUid: userRecord.uid,
            adminEmail: email,
            onboardingVersion: 1,
            status: 'active',
            createdAt: now,
            updatedAt: now
        };
        const publicInstitution = {
            schoolId,
            gresaCode: schoolId,
            institutionName: schoolName,
            adminUid: userRecord.uid,
            adminEmail: email,
            onboardingVersion: 1,
            status: 'active'
        };

        await db.batch()
            .set(schoolRef, {
                schoolId,
                gresaCode: schoolId,
                institutionName: schoolName,
                status: 'active',
                createdAt: now,
                updatedAt: now
            })
            .set(db.doc(`schools/${schoolId}/meta/institution`), institution, { merge: true })
            .commit();

        const customToken = await auth.createCustomToken(userRecord.uid, { schoolId, role: 'principal' });
        return res.status(200).json({
            success: true,
            customToken,
            uid: userRecord.uid,
            schoolId,
            firebaseConfig: getPublicFirebaseConfig(),
            profile: publicUserProfile(profile),
            institution: publicInstitution
        });
    } catch (err) {
        return functionError(res, err);
    }
});

/**
 * POST /provisionSchoolUser
 * Admin-only user provisioning for an existing school.
 */
exports.provisionSchoolUser = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const {
            idToken,
            email: rawEmail,
            name: rawName,
            role: rawRole,
            tempPassword,
            temporaryPassword,
            mustChangePassword,
            createInvite,
            disabled
        } = req.body || {};
        const caller = await requireSchoolAdmin(idToken);
        const email = normalizeEmail(rawEmail);
        const name = String(rawName || '').trim();
        const role = normalizeRole(rawRole);
        const password = String(tempPassword || temporaryPassword || generateTemporaryPassword()).trim();

        if (!email || !name) {
            const err = new Error('INVALID_REQUEST');
            err.status = 400;
            throw err;
        }

        const { userRecord, profile } = await createOrUpdateSchoolUser({
            schoolId: caller.schoolId,
            email,
            password,
            name,
            role,
            mustChangePassword: mustChangePassword !== false,
            createdBy: caller.uid,
            disabled: !!disabled
        });

        let invite = null;
        if (createInvite !== false) {
            const inviteId = buildInviteId(email, userRecord.uid);
            invite = {
                id: inviteId,
                uid: userRecord.uid,
                email,
                name,
                role,
                status: 'pending',
                createdBy: caller.uid,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            await db.doc(`schools/${caller.schoolId}/userInvites/${inviteId}`).set(invite, { merge: true });
        }

        return res.status(200).json({
            success: true,
            uid: userRecord.uid,
            schoolId: caller.schoolId,
            temporaryPassword: password,
            profile: publicUserProfile(profile),
            invite: publicInvite(invite)
        });
    } catch (err) {
        return functionError(res, err);
    }
});

/**
 * POST /updateSchoolUserRole
 * Admin-only role update reflected in Auth claims and Firestore profile.
 */
exports.updateSchoolUserRole = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const { idToken, targetUid, uid, newRole, role: rawRole } = req.body || {};
        const caller = await requireSchoolAdmin(idToken);
        const targetUserId = String(targetUid || uid || '').trim();
        const role = normalizeRole(newRole || rawRole);
        if (!targetUserId) {
            const err = new Error('INVALID_REQUEST');
            err.status = 400;
            throw err;
        }

        const targetUser = await auth.getUser(targetUserId);
        const targetClaims = targetUser.customClaims || {};
        if (normalizeSchoolId(targetClaims.schoolId) !== caller.schoolId) {
            const err = new Error('SCHOOL_MISMATCH');
            err.status = 403;
            throw err;
        }

        await auth.setCustomUserClaims(targetUserId, { ...targetClaims, schoolId: caller.schoolId, role });
        await db.doc(`schools/${caller.schoolId}/users/${targetUserId}`).set({
            uid: targetUserId,
            role,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: caller.uid
        }, { merge: true });

        return res.status(200).json({ success: true, uid: targetUserId, schoolId: caller.schoolId, role });
    } catch (err) {
        return functionError(res, err);
    }
});

/**
 * POST /setSchoolUserDisabled
 * Admin-only enable/disable reflected in Firebase Auth and Firestore profile.
 */
exports.setSchoolUserDisabled = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const { idToken, targetUid, uid, disabled } = req.body || {};
        const caller = await requireSchoolAdmin(idToken);
        const targetUserId = String(targetUid || uid || '').trim();
        if (!targetUserId || typeof disabled !== 'boolean') {
            const err = new Error('INVALID_REQUEST');
            err.status = 400;
            throw err;
        }

        const targetUser = await auth.getUser(targetUserId);
        const targetClaims = targetUser.customClaims || {};
        if (normalizeSchoolId(targetClaims.schoolId) !== caller.schoolId) {
            const err = new Error('SCHOOL_MISMATCH');
            err.status = 403;
            throw err;
        }

        await auth.updateUser(targetUserId, { disabled });
        await db.doc(`schools/${caller.schoolId}/users/${targetUserId}`).set({
            uid: targetUserId,
            status: disabled ? 'disabled' : 'active',
            disabled,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: caller.uid
        }, { merge: true });

        return res.status(200).json({
            success: true,
            uid: targetUserId,
            schoolId: caller.schoolId,
            disabled,
            status: disabled ? 'disabled' : 'active'
        });
    } catch (err) {
        return functionError(res, err);
    }
});
