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
const SCHOOL_ADMIN_ROLES = new Set(['principal']);
const SCHOOL_USER_ROLES = new Set([
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

function normalizeSchoolUserRole(value, fallback = 'viewer') {
    const role = String(value || fallback).trim();
    if (!SCHOOL_USER_ROLES.has(role)) {
        const err = new Error('INVALID_ROLE');
        err.status = 400;
        throw err;
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
    if (!schoolId || !SCHOOL_ADMIN_ROLES.has(role)) {
        const err = new Error('ADMIN_REQUIRED');
        err.status = 403;
        throw err;
    }

    const profileSnap = await db.doc(`schools/${schoolId}/users/${decoded.uid}`).get();
    if (!profileSnap.exists || profileSnap.get('status') === 'disabled') {
        const err = new Error('USER_DISABLED');
        err.status = 403;
        throw err;
    }

    return { decoded, schoolId, role, uid: decoded.uid };
}

async function requirePrincipalAuth(idToken) {
    if (!idToken) {
        const err = new Error('MISSING_ID_TOKEN');
        err.status = 401;
        throw err;
    }

    const decoded = await auth.verifyIdToken(idToken);
    const schoolId = normalizeSchoolId(decoded.schoolId);
    const role = String(decoded.role || '').trim();
    if (!schoolId || !['principal', 'developer'].includes(role)) {
        const err = new Error('FORBIDDEN');
        err.status = 403;
        throw err;
    }

    const profileSnap = await db.doc(`schools/${schoolId}/users/${decoded.uid}`).get();
    if (profileSnap.exists && profileSnap.get('status') === 'disabled') {
        const err = new Error('USER_DISABLED');
        err.status = 403;
        throw err;
    }

    return { decoded, schoolId, role, uid: decoded.uid, email: decoded.email || '' };
}

const APP_ADMIN_ROLES = new Set(['admin', 'developer']);

async function requireAppAdmin(idToken) {
    if (!idToken) {
        const err = new Error('MISSING_ID_TOKEN');
        err.status = 401;
        throw err;
    }

    const decoded = await auth.verifyIdToken(idToken);
    const role = String(decoded.role || '').trim();
    if (!APP_ADMIN_ROLES.has(role)) {
        const err = new Error('FORBIDDEN');
        err.status = 403;
        throw err;
    }

    return { decoded, role, uid: decoded.uid, email: decoded.email || '' };
}

async function resolveSchoolStaffTarget({ idToken, requestedSchoolId }) {
    const normalizedTarget = normalizeSchoolId(requestedSchoolId);
    try {
        const appAdmin = await requireAppAdmin(idToken);
        if (!normalizedTarget) {
            const err = new Error('MISSING_SCHOOL_ID');
            err.status = 400;
            throw err;
        }
        const schoolSnap = await db.doc(`schools/${normalizedTarget}`).get();
        if (!schoolSnap.exists) {
            const err = new Error('SCHOOL_NOT_FOUND');
            err.status = 404;
            throw err;
        }
        return { ...appAdmin, schoolId: normalizedTarget, appAdmin: true };
    } catch (err) {
        if (err.message !== 'FORBIDDEN') {
            throw err;
        }
    }

    if (normalizedTarget) {
        const decoded = await auth.verifyIdToken(idToken);
        const claimSchoolId = normalizeSchoolId(decoded.schoolId);
        if (claimSchoolId && claimSchoolId !== normalizedTarget) {
            const err = new Error('SCHOOL_MISMATCH');
            err.status = 403;
            throw err;
        }
    }
    return requireSchoolAdmin(idToken);
}

const SCHOOL_ID_REGEX = /^\d+[A-Za-z]{1,2}$/;

function functionError(res, err) {
    const code = err.message || 'INTERNAL_ERROR';
    const status = Number(err.status) || (
        code === 'INVALID_ROLE' || code === 'INVALID_REQUEST' || code === 'INVALID_SCHOOL_ID' ||
        code === 'MISSING_SCHOOL_ID' ? 400 :
        code === 'MISSING_ID_TOKEN' ? 401 :
        code === 'BOOTSTRAP_SECRET_NOT_CONFIGURED' ? 500 :
        code === 'BOOTSTRAP_UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'ADMIN_REQUIRED' ||
        code === 'USER_DISABLED' || code === 'SCHOOL_MISMATCH' || code === 'FORBIDDEN_ROLE' ? 403 :
        code === 'SCHOOL_EXISTS' || code === 'EMAIL_IN_USE_DIFFERENT_SCHOOL' ||
        code === 'TARGET_SCHOOL_EXISTS' || code === 'PENDING_REQUEST_EXISTS' ||
        code === 'REQUEST_ALREADY_REVIEWED' ? 409 :
        code === 'REQUEST_NOT_FOUND' || code === 'SCHOOL_NOT_FOUND' ? 404 :
        500
    );
    return res.status(status).json({ error: code, code });
}

async function copyCollectionTree(sourceCollectionRef, targetCollectionRef, transformData = (data) => data) {
    const snapshot = await sourceCollectionRef.get();
    const docRefs = [];
    let batch = db.batch();
    let count = 0;

    for (const docSnap of snapshot.docs) {
        const targetDocRef = targetCollectionRef.doc(docSnap.id);
        const data = transformData({ ...docSnap.data() }, docSnap.ref, targetDocRef) || {};
        batch.set(targetDocRef, data);
        docRefs.push({ sourceRef: docSnap.ref, targetRef: targetDocRef });
        count++;

        if (count >= 450) {
            await batch.commit();
            batch = db.batch();
            count = 0;
        }
    }

    if (count > 0) {
        await batch.commit();
    }

    for (const { sourceRef, targetRef } of docRefs) {
        const subcollections = await sourceRef.listCollections();
        for (const subcollection of subcollections) {
            await copyCollectionTree(
                subcollection,
                targetRef.collection(subcollection.id),
                transformData
            );
        }
    }
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

        if (!schoolId || !SCHOOL_ID_REGEX.test(schoolId) || !schoolName || !email || !adminPassword || !name) {
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
            schoolId: rawSchoolId,
            targetSchoolId,
            tempPassword,
            temporaryPassword,
            mustChangePassword,
            createInvite,
            disabled
        } = req.body || {};
        const caller = await resolveSchoolStaffTarget({ idToken, requestedSchoolId: rawSchoolId || targetSchoolId });
        const email = normalizeEmail(rawEmail);
        const name = String(rawName || '').trim();
        const role = normalizeSchoolUserRole(rawRole);
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
        const { idToken, targetUid, uid, schoolId: rawSchoolId, targetSchoolId, newRole, role: rawRole } = req.body || {};
        const caller = await resolveSchoolStaffTarget({ idToken, requestedSchoolId: rawSchoolId || targetSchoolId });
        const targetUserId = String(targetUid || uid || '').trim();
        const role = normalizeSchoolUserRole(newRole || rawRole);
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
        if (!SCHOOL_USER_ROLES.has(String(targetClaims.role || '').trim())) {
            const err = new Error('FORBIDDEN_ROLE');
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
        const { idToken, targetUid, uid, schoolId: rawSchoolId, targetSchoolId, disabled } = req.body || {};
        const caller = await resolveSchoolStaffTarget({ idToken, requestedSchoolId: rawSchoolId || targetSchoolId });
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
        if (!SCHOOL_USER_ROLES.has(String(targetClaims.role || '').trim())) {
            const err = new Error('FORBIDDEN_ROLE');
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

/**
 * POST /submitLinkRequest
 * Legacy user (has Firebase Auth but no schoolId claim) requests to be linked to a school.
 * Does NOT require admin — the caller proves identity via their own idToken.
 */
exports.submitLinkRequest = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const { idToken, schoolCode: rawSchoolCode, deviceName } = req.body || {};
        if (!idToken || !rawSchoolCode) {
            const err = new Error('INVALID_REQUEST');
            err.status = 400;
            throw err;
        }

        const decoded = await auth.verifyIdToken(idToken);
        const existingSchoolId = normalizeSchoolId(decoded.schoolId);
        if (existingSchoolId) {
            return res.status(409).json({ error: 'ALREADY_LINKED', schoolId: existingSchoolId });
        }

        const schoolCode = normalizeSchoolId(rawSchoolCode);
        if (!schoolCode) {
            const err = new Error('INVALID_REQUEST');
            err.status = 400;
            throw err;
        }

        const schoolSnap = await db.doc(`schools/${schoolCode}`).get();
        if (!schoolSnap.exists) {
            const err = new Error('SCHOOL_NOT_FOUND');
            err.status = 404;
            throw err;
        }

        const existingRequest = await db.doc(`schools/${schoolCode}/linkRequests/${decoded.uid}`).get();
        if (existingRequest.exists && existingRequest.get('status') === 'pending') {
            return res.status(200).json({ success: true, alreadyPending: true });
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        await db.doc(`schools/${schoolCode}/linkRequests/${decoded.uid}`).set({
            uid: decoded.uid,
            email: decoded.email || '',
            name: decoded.name || decoded.email || '',
            schoolCode,
            deviceName: String(deviceName || '').trim() || null,
            status: 'pending',
            createdAt: now,
            updatedAt: now
        });

        return res.status(200).json({ success: true });
    } catch (err) {
        return functionError(res, err);
    }
});

/**
 * POST /listLinkRequests
 * Admin-only: returns pending link requests for the caller's school.
 */
exports.listLinkRequests = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const { idToken, schoolId: rawSchoolId, targetSchoolId } = req.body || {};
        const caller = await resolveSchoolStaffTarget({ idToken, requestedSchoolId: rawSchoolId || targetSchoolId });

        const snapshot = await db
            .collection(`schools/${caller.schoolId}/linkRequests`)
            .where('status', '==', 'pending')
            .orderBy('createdAt', 'desc')
            .get();

        const requests = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            requests.push({
                uid: doc.id,
                email: data.email || '',
                name: data.name || '',
                schoolCode: data.schoolCode || '',
                deviceName: data.deviceName || null,
                status: data.status,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || null
            });
        });

        return res.status(200).json({ success: true, requests });
    } catch (err) {
        return functionError(res, err);
    }
});

/**
 * POST /resolveLinkRequest
 * Admin-only: approve or reject a pending link request.
 * On approve, sets schoolId + role claims and creates the Firestore user profile.
 */
exports.resolveLinkRequest = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const { idToken, targetUid, action, role: rawRole, schoolId: rawSchoolId, targetSchoolId } = req.body || {};
        const caller = await resolveSchoolStaffTarget({ idToken, requestedSchoolId: rawSchoolId || targetSchoolId });
        const uid = String(targetUid || '').trim();

        if (!uid || (action !== 'approve' && action !== 'reject')) {
            const err = new Error('INVALID_REQUEST');
            err.status = 400;
            throw err;
        }

        const requestRef = db.doc(`schools/${caller.schoolId}/linkRequests/${uid}`);
        const requestSnap = await requestRef.get();
        if (!requestSnap.exists) {
            const err = new Error('REQUEST_NOT_FOUND');
            err.status = 404;
            throw err;
        }
        if (requestSnap.get('status') !== 'pending') {
            const err = new Error('REQUEST_ALREADY_RESOLVED');
            err.status = 409;
            throw err;
        }

        const now = admin.firestore.FieldValue.serverTimestamp();

        if (action === 'reject') {
            await requestRef.update({
                status: 'rejected',
                rejectedBy: caller.uid,
                resolvedAt: now,
                updatedAt: now
            });
            return res.status(200).json({ success: true, action: 'rejected', uid });
        }

        const role = normalizeSchoolUserRole(rawRole, 'viewer');
        const requestData = requestSnap.data();

        await createOrUpdateSchoolUser({
            schoolId: caller.schoolId,
            email: requestData.email,
            name: requestData.name,
            role,
            mustChangePassword: false,
            createdBy: caller.uid
        });

        await requestRef.update({
            status: 'approved',
            approvedRole: role,
            approvedBy: caller.uid,
            resolvedAt: now,
            updatedAt: now
        });

        return res.status(200).json({ success: true, action: 'approved', uid, role, schoolId: caller.schoolId });
    } catch (err) {
        return functionError(res, err);
    }
});

/**
 * POST /submitInstitutionIdentityChangeRequest
 * Principal-only: submits a request to change institution code and/or name.
 * Stored in top-level collection institutionIdentityRequests.
 */
exports.submitInstitutionIdentityChangeRequest = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const { idToken, newSchoolId: rawNewSchoolId, institutionName, reason, syncSchoolIdentity } = req.body || {};
        const caller = await requirePrincipalAuth(idToken);

        const newSchoolId = rawNewSchoolId ? normalizeSchoolId(rawNewSchoolId) : null;
        const newName = institutionName ? String(institutionName).trim() : null;

        if (newSchoolId && !SCHOOL_ID_REGEX.test(newSchoolId)) {
            const err = new Error('INVALID_SCHOOL_ID');
            err.status = 400;
            throw err;
        }

        const schoolSnap = await db.doc(`schools/${caller.schoolId}`).get();
        if (!schoolSnap.exists) {
            const err = new Error('SCHOOL_NOT_FOUND');
            err.status = 404;
            throw err;
        }
        const currentData = schoolSnap.data();
        const oldName = currentData.institutionName || '';

        const codeChanged = newSchoolId && newSchoolId !== caller.schoolId;
        const nameChanged = newName && newName !== oldName;
        if (!codeChanged && !nameChanged) {
            const err = new Error('INVALID_REQUEST');
            err.status = 400;
            throw err;
        }

        const pendingSnap = await db.collection('institutionIdentityRequests')
            .where('oldSchoolId', '==', caller.schoolId)
            .where('status', '==', 'pending')
            .limit(1)
            .get();
        if (!pendingSnap.empty) {
            const err = new Error('PENDING_REQUEST_EXISTS');
            err.status = 409;
            throw err;
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        const requestRef = db.collection('institutionIdentityRequests').doc();
        await requestRef.set({
            status: 'pending',
            oldSchoolId: caller.schoolId,
            newSchoolId: codeChanged ? newSchoolId : caller.schoolId,
            oldInstitutionName: oldName,
            newInstitutionName: nameChanged ? newName : oldName,
            codeChanged: !!codeChanged,
            nameChanged: !!nameChanged,
            syncSchoolIdentity: !!syncSchoolIdentity,
            requestedByUid: caller.uid,
            requestedByEmail: caller.email,
            requestedByRole: caller.role,
            reason: String(reason || '').trim() || null,
            createdAt: now,
            updatedAt: now
        });

        return res.status(200).json({
            success: true,
            requestId: requestRef.id,
            status: 'pending'
        });
    } catch (err) {
        return functionError(res, err);
    }
});

/**
 * POST /getInstitutionIdentityChangeRequestsForSchool
 * Principal-only: returns identity change requests for the caller's school.
 */
exports.getInstitutionIdentityChangeRequestsForSchool = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const { idToken } = req.body || {};
        const caller = await requirePrincipalAuth(idToken);

        const snapshot = await db.collection('institutionIdentityRequests')
            .where('oldSchoolId', '==', caller.schoolId)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();

        const byId = new Map();
        snapshot.forEach((doc) => {
            const data = doc.data();
            byId.set(doc.id, {
                requestId: doc.id,
                status: data.status,
                oldSchoolId: data.oldSchoolId,
                newSchoolId: data.newSchoolId,
                oldInstitutionName: data.oldInstitutionName || '',
                newInstitutionName: data.newInstitutionName || '',
                codeChanged: !!data.codeChanged,
                nameChanged: !!data.nameChanged,
                syncSchoolIdentity: !!data.syncSchoolIdentity,
                reason: data.reason || null,
                rejectionReason: data.rejectionReason || null,
                requiresLocalApply: !!data.requiresLocalApply,
                requiresRelogin: !!data.requiresRelogin,
                resultSchoolId: data.resultSchoolId || null,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
                reviewedAt: data.reviewedAt?.toDate?.()?.toISOString() || null
            });
        });

        const resultSnapshot = await db.collection('institutionIdentityRequests')
            .where('resultSchoolId', '==', caller.schoolId)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();

        resultSnapshot.forEach((doc) => {
            if (byId.has(doc.id)) return;
            const data = doc.data();
            byId.set(doc.id, {
                requestId: doc.id,
                status: data.status,
                oldSchoolId: data.oldSchoolId,
                newSchoolId: data.newSchoolId,
                oldInstitutionName: data.oldInstitutionName || '',
                newInstitutionName: data.newInstitutionName || '',
                codeChanged: !!data.codeChanged,
                nameChanged: !!data.nameChanged,
                syncSchoolIdentity: !!data.syncSchoolIdentity,
                reason: data.reason || null,
                rejectionReason: data.rejectionReason || null,
                requiresLocalApply: !!data.requiresLocalApply,
                requiresRelogin: !!data.requiresRelogin,
                resultSchoolId: data.resultSchoolId || null,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
                reviewedAt: data.reviewedAt?.toDate?.()?.toISOString() || null
            });
        });

        const requests = Array.from(byId.values())
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .slice(0, 20);

        return res.status(200).json({ success: true, requests });
    } catch (err) {
        return functionError(res, err);
    }
});

/**
 * POST /listInstitutionIdentityChangeRequests
 * App-admin only: returns identity change requests from all schools.
 */
exports.listInstitutionIdentityChangeRequests = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const { idToken, status: filterStatus, limit: rawLimit } = req.body || {};
        await requireAppAdmin(idToken);

        const pageLimit = Math.min(Math.max(Number(rawLimit) || 50, 1), 100);
        let query = db.collection('institutionIdentityRequests')
            .orderBy('createdAt', 'desc')
            .limit(pageLimit);

        if (filterStatus && ['pending', 'approved', 'rejected', 'failed'].includes(filterStatus)) {
            query = query.where('status', '==', filterStatus);
        }

        const snapshot = await query.get();
        const requests = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            requests.push({
                requestId: doc.id,
                status: data.status,
                oldSchoolId: data.oldSchoolId,
                newSchoolId: data.newSchoolId,
                oldInstitutionName: data.oldInstitutionName || '',
                newInstitutionName: data.newInstitutionName || '',
                codeChanged: !!data.codeChanged,
                nameChanged: !!data.nameChanged,
                syncSchoolIdentity: !!data.syncSchoolIdentity,
                requestedByEmail: data.requestedByEmail || '',
                requestedByRole: data.requestedByRole || '',
                reason: data.reason || null,
                rejectionReason: data.rejectionReason || null,
                reviewedByEmail: data.reviewedByEmail || null,
                requiresLocalApply: !!data.requiresLocalApply,
                requiresRelogin: !!data.requiresRelogin,
                resultSchoolId: data.resultSchoolId || null,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
                reviewedAt: data.reviewedAt?.toDate?.()?.toISOString() || null
            });
        });

        return res.status(200).json({ success: true, requests });
    } catch (err) {
        return functionError(res, err);
    }
});

/**
 * POST /rejectInstitutionIdentityChangeRequest
 * App-admin only: rejects a pending identity change request.
 */
exports.rejectInstitutionIdentityChangeRequest = onRequest({ cors: true }, async (req, res) => {
    if (!requirePost(req, res)) return;

    try {
        const { idToken, requestId, rejectionReason } = req.body || {};
        const caller = await requireAppAdmin(idToken);

        if (!requestId) {
            const err = new Error('INVALID_REQUEST');
            err.status = 400;
            throw err;
        }

        const requestRef = db.doc(`institutionIdentityRequests/${requestId}`);
        const requestSnap = await requestRef.get();
        if (!requestSnap.exists) {
            const err = new Error('REQUEST_NOT_FOUND');
            err.status = 404;
            throw err;
        }
        if (requestSnap.get('status') !== 'pending') {
            const err = new Error('REQUEST_ALREADY_REVIEWED');
            err.status = 409;
            throw err;
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        await requestRef.update({
            status: 'rejected',
            rejectionReason: String(rejectionReason || '').trim() || null,
            reviewedByUid: caller.uid,
            reviewedByEmail: caller.email,
            reviewedAt: now,
            updatedAt: now
        });

        return res.status(200).json({ success: true, requestId, status: 'rejected' });
    } catch (err) {
        return functionError(res, err);
    }
});

/**
 * POST /approveInstitutionIdentityChangeRequest
 * App-admin only: approves a pending identity change request.
 * For name-only changes: updates school doc and meta.
 * For code changes: copies school data to new path, updates Auth claims, marks old school as migrated.
 */
exports.approveInstitutionIdentityChangeRequest = onRequest(
    { cors: true, timeoutSeconds: 540, memory: '1GiB' },
    async (req, res) => {
        if (!requirePost(req, res)) return;

        try {
            const { idToken, requestId, dryRun } = req.body || {};
            const caller = await requireAppAdmin(idToken);

            if (!requestId) {
                const err = new Error('INVALID_REQUEST');
                err.status = 400;
                throw err;
            }

            const requestRef = db.doc(`institutionIdentityRequests/${requestId}`);
            const requestSnap = await requestRef.get();
            if (!requestSnap.exists) {
                const err = new Error('REQUEST_NOT_FOUND');
                err.status = 404;
                throw err;
            }

            const requestData = requestSnap.data();
            if (requestData.status !== 'pending') {
                const err = new Error('REQUEST_ALREADY_REVIEWED');
                err.status = 409;
                throw err;
            }

            const oldSchoolId = requestData.oldSchoolId;
            const newSchoolId = requestData.newSchoolId;
            const codeChanged = !!requestData.codeChanged;
            const newName = requestData.newInstitutionName;
            const targetSchoolId = codeChanged ? newSchoolId : oldSchoolId;

            const oldSchoolSnap = await db.doc(`schools/${oldSchoolId}`).get();
            if (!oldSchoolSnap.exists) {
                const err = new Error('SCHOOL_NOT_FOUND');
                err.status = 404;
                throw err;
            }

            if (codeChanged) {
                const newSchoolSnap = await db.doc(`schools/${newSchoolId}`).get();
                if (newSchoolSnap.exists) {
                    const err = new Error('TARGET_SCHOOL_EXISTS');
                    err.status = 409;
                    throw err;
                }
            }

            if (dryRun) {
                return res.status(200).json({
                    success: true,
                    dryRun: true,
                    requestId,
                    codeChanged,
                    oldSchoolId,
                    newSchoolId: targetSchoolId
                });
            }

            const now = admin.firestore.FieldValue.serverTimestamp();
            const migrationId = `mig_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

            if (codeChanged) {
                const oldSchoolData = oldSchoolSnap.data();
                await db.doc(`schools/${newSchoolId}`).set({
                    ...oldSchoolData,
                    schoolId: newSchoolId,
                    gresaCode: newSchoolId,
                    institutionName: newName,
                    migratedFrom: oldSchoolId,
                    updatedAt: now
                });

                const subcollections = await db.doc(`schools/${oldSchoolId}`).listCollections();
                for (const subcol of subcollections) {
                    await copyCollectionTree(
                        subcol,
                        db.collection(`schools/${newSchoolId}/${subcol.id}`),
                        (data, sourceRef) => {
                            if (sourceRef.parent.id === 'users' && data.schoolId) {
                                data.schoolId = newSchoolId;
                            }
                            return data;
                        }
                    );
                }

                await copyCollectionTree(
                    db.collection(`syncLog/${oldSchoolId}/changes`),
                    db.collection(`syncLog/${newSchoolId}/changes`)
                );

                const usersSnap = await db.collection(`schools/${newSchoolId}/users`).get();
                const claimFailures = [];
                const claimPromises = [];
                usersSnap.forEach((userDoc) => {
                    const uid = userDoc.id;
                    const role = userDoc.get('role') || 'viewer';
                    claimPromises.push(
                        auth.getUser(uid)
                            .then((u) => auth.setCustomUserClaims(uid, {
                                ...(u.customClaims || {}),
                                schoolId: newSchoolId,
                                role
                            }))
                            .catch((e) => {
                                console.warn(`[migration] claims update failed for ${uid}:`, e.message);
                                claimFailures.push({ uid, error: e.message });
                            })
                    );
                });
                await Promise.all(claimPromises);
                if (claimFailures.length > 0) {
                    const err = new Error('CLAIMS_UPDATE_FAILED');
                    err.status = 500;
                    err.claimFailures = claimFailures;
                    throw err;
                }

                await db.doc(`schools/${oldSchoolId}`).update({
                    status: 'migrated',
                    migratedTo: newSchoolId,
                    writesDisabled: true,
                    updatedAt: now
                });
            } else {
                await db.doc(`schools/${oldSchoolId}`).update({
                    institutionName: newName,
                    updatedAt: now
                });
            }

            const metaRef = db.doc(`schools/${targetSchoolId}/meta/institution`);
            const metaSnap = await metaRef.get();
            if (metaSnap.exists) {
                await metaRef.update({
                    institutionName: newName,
                    ...(codeChanged ? { schoolId: newSchoolId, gresaCode: newSchoolId } : {}),
                    updatedAt: now
                });
            }

            await requestRef.update({
                status: 'approved',
                approvedByUid: caller.uid,
                approvedByEmail: caller.email,
                approvedAt: now,
                migrationId,
                resultSchoolId: targetSchoolId,
                requiresLocalApply: true,
                requiresRelogin: codeChanged,
                updatedAt: now
            });

            return res.status(200).json({
                success: true,
                requestId,
                status: 'approved',
                migrationId,
                codeChanged,
                resultSchoolId: targetSchoolId,
                requiresRelogin: codeChanged
            });
        } catch (err) {
            const requestId = req.body?.requestId;
            if (requestId && !['REQUEST_NOT_FOUND', 'REQUEST_ALREADY_REVIEWED'].includes(err.message)) {
                try {
                    const requestRef = db.doc(`institutionIdentityRequests/${requestId}`);
                    const requestSnap = await requestRef.get();
                    if (requestSnap.exists && requestSnap.get('status') === 'pending') {
                        await requestRef.update({
                            status: 'failed',
                            error: err.message || 'INTERNAL_ERROR',
                            errorDetails: err.claimFailures || null,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                } catch (updateErr) {
                    console.warn('[identity-migration] failed to mark request failed:', updateErr.message);
                }
            }
            return functionError(res, err);
        }
    }
);
