'use strict';

/**
 * fix-migrated-school.js
 *
 * Diagnose (and optionally repair) the "PERMISSION_DENIED on push, reads still work"
 * symptom. Firestore rules freeze ALL writes to a school whose top-level document
 * `schools/{schoolId}` has `status == 'migrated'` (see firebase/firestore.rules →
 * isMigratedSchool), while leaving reads open. That is exactly why the sync card shows
 * successful pulls but every push fails with PERMISSION_DENIED.
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_PATH (in .env) — the same admin credential the
 * telemetry/migration scripts use. Never bundled into the installer.
 *
 * Usage:
 *   node scripts/fix-migrated-school.js                    # inspect ALL schools (read-only)
 *   node scripts/fix-migrated-school.js <SCHOOL_CODE>      # inspect one school (read-only)
 *   node scripts/fix-migrated-school.js <SCHOOL_CODE> --unfreeze
 *                                                          # set status = 'active' (WRITE)
 *
 * The script writes nothing unless BOTH a school code AND --unfreeze are given.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

// Prefer the explicit env path; fall back to the bundled dev service account
// (same convention as scripts/verify-migration.js) so the script runs without
// extra .env wiring on the developer machine.
const SERVICE_ACCOUNT_PATH =
    String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim() ||
    path.join(__dirname, '..', 'firebase', 'gestionscholaire-firebase-adminsdk-fbsvc-d818682f4a.json');

function getAdminFirestore() {
    const resolved = path.resolve(SERVICE_ACCOUNT_PATH);
    if (!fs.existsSync(resolved)) {
        return null;
    }
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(require(resolved)) });
    }
    return admin.firestore();
}

const RAW_ARGS = process.argv.slice(2);
const UNFREEZE = RAW_ARGS.includes('--unfreeze') || RAW_ARGS.includes('--clear-migrated');
const SCHOOL_CODE = (RAW_ARGS.find((a) => !a.startsWith('--')) || '').trim().toUpperCase();

const FIELDS_OF_INTEREST = ['status', 'massarCode', 'massar_code', 'name', 'migratedTo', 'migratedFrom', 'updatedAt'];

function fmt(value) {
    if (value === undefined) return '(unset)';
    if (value === null) return '(null)';
    if (typeof value === 'object' && typeof value.toDate === 'function') {
        try {
            return value.toDate().toISOString();
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function printSchool(id, data) {
    const status = data?.status;
    const frozen = status === 'migrated';
    console.log(`\n  schools/${id}${frozen ? '   ← ⛔ MIGRATED — writes are FROZEN' : ''}`);
    for (const field of FIELDS_OF_INTEREST) {
        if (data && Object.prototype.hasOwnProperty.call(data, field)) {
            console.log(`      ${field.padEnd(13)}: ${fmt(data[field])}`);
        }
    }
    return frozen;
}

async function main() {
    const db = getAdminFirestore();
    if (!db) {
        console.error('\n[!] Firebase admin is not initialized.');
        console.error('    Set FIREBASE_SERVICE_ACCOUNT_PATH in .env to your service-account JSON, then retry.\n');
        process.exit(1);
    }

    // ── Repair mode ──────────────────────────────────────────────────────────
    if (UNFREEZE) {
        if (!SCHOOL_CODE) {
            console.error('\n[!] --unfreeze requires an explicit school code, e.g.:');
            console.error('    node scripts/fix-migrated-school.js 12345X --unfreeze\n');
            process.exit(1);
        }
        const ref = db.collection('schools').doc(SCHOOL_CODE);
        const snap = await ref.get();
        if (!snap.exists) {
            console.error(`\n[!] schools/${SCHOOL_CODE} does not exist. Run without arguments to list all schools.\n`);
            process.exit(1);
        }
        const before = snap.data() || {};
        console.log(`\nBefore:`);
        printSchool(SCHOOL_CODE, before);

        if (before.status !== 'migrated') {
            console.log(`\n[i] status is "${fmt(before.status)}", not "migrated" — nothing to unfreeze. No write performed.\n`);
            process.exit(0);
        }

        await ref.update({ status: 'active' });
        const after = (await ref.get()).data() || {};
        console.log(`\nAfter (status set to "active" — writes are now allowed):`);
        printSchool(SCHOOL_CODE, after);
        console.log('\n[✓] Done. Both machines should drain their pending changes on the next push cycle.');
        console.log('    (No app rebuild needed — this was a Firestore data flag, not a code bug.)\n');
        process.exit(0);
    }

    // ── Inspect mode (read-only) ─────────────────────────────────────────────
    if (SCHOOL_CODE) {
        const snap = await db.collection('schools').doc(SCHOOL_CODE).get();
        if (!snap.exists) {
            console.error(`\n[!] schools/${SCHOOL_CODE} does not exist. Run without arguments to list all schools.\n`);
            process.exit(1);
        }
        console.log('\n=== School inspection (read-only) ===');
        const frozen = printSchool(SCHOOL_CODE, snap.data() || {});
        if (frozen) {
            console.log(`\n[i] To unfreeze writes, run:`);
            console.log(`    node scripts/fix-migrated-school.js ${SCHOOL_CODE} --unfreeze\n`);
        } else {
            console.log('\n[i] This school is NOT migrated — PERMISSION_DENIED has a different cause.\n');
        }
        process.exit(0);
    }

    console.log('\n=== All schools (read-only) ===');
    const all = await db.collection('schools').get();
    if (all.empty) {
        console.log('\n[i] No documents under the schools/ collection.\n');
        process.exit(0);
    }
    const migrated = [];
    all.forEach((doc) => {
        if (printSchool(doc.id, doc.data() || {})) migrated.push(doc.id);
    });

    console.log(`\n--------------------------------------------------`);
    if (migrated.length === 0) {
        console.log('[i] No migrated (write-frozen) schools found. PERMISSION_DENIED has a different cause.\n');
    } else {
        console.log(`[⛔] Write-frozen (migrated) schools: ${migrated.join(', ')}`);
        console.log(`     To unfreeze one, run:`);
        console.log(`     node scripts/fix-migrated-school.js ${migrated[0]} --unfreeze\n`);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error('\n[!] Failed:', err && err.message ? err.message : err);
    process.exit(1);
});
