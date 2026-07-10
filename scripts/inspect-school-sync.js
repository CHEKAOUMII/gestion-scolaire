'use strict';

/**
 * inspect-school-sync.js  (read-only)
 *
 * Deep diagnostic for the two-machine sync problem. For each school (either the
 * codes passed as args, or the schools updated most recently), prints:
 *   - top-level school fields
 *   - the users/ subcollection (uid, email, role, status)   ← who may sync
 *   - document counts for the main sync collections
 *   - the tail of syncLog/{code}/changes                    ← what was written, when, by which device
 *
 * Usage:
 *   node scripts/inspect-school-sync.js                 # 5 most recently-updated schools
 *   node scripts/inspect-school-sync.js 25487K 53698L   # specific codes
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH =
    String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim() ||
    path.join(__dirname, '..', 'firebase', 'gestionscholaire-firebase-adminsdk-fbsvc-d818682f4a.json');

const CODES = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((c) => c.trim().toUpperCase());
const SYNC_COLLECTIONS = ['grades', 'teachers', 'staffAttendance', 'teacherAbsences', 'students', 'absences'];

function toIso(v) {
    if (v && typeof v.toDate === 'function') {
        try { return v.toDate().toISOString(); } catch { return String(v); }
    }
    if (typeof v === 'number') {
        // updatedAt is stored as epoch seconds by the sync engine
        return new Date((v < 1e12 ? v * 1000 : v)).toISOString();
    }
    return v === undefined ? '(unset)' : String(v);
}

function initDb() {
    const resolved = path.resolve(SERVICE_ACCOUNT_PATH);
    if (!fs.existsSync(resolved)) {
        console.error(`\n[!] Service account not found at ${resolved}\n`);
        process.exit(1);
    }
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(require(resolved)) });
    }
    return admin.firestore();
}

async function pickRecentSchools(db) {
    const snap = await db.collection('schools').orderBy('updatedAt', 'desc').limit(5).get();
    return snap.docs.map((d) => d.id);
}

async function inspect(db, code) {
    console.log(`\n══════════════════════════════════════════════════════════`);
    console.log(`  schools/${code}`);
    console.log(`══════════════════════════════════════════════════════════`);

    const schoolSnap = await db.collection('schools').doc(code).get();
    if (!schoolSnap.exists) {
        console.log('  (document does not exist)');
        return;
    }
    const data = schoolSnap.data() || {};
    for (const [k, v] of Object.entries(data)) {
        console.log(`    ${k.padEnd(14)}: ${toIso(v)}`);
    }

    // Users who may sync
    const users = await db.collection('schools').doc(code).collection('users').get();
    console.log(`\n    users/ (${users.size}):`);
    users.forEach((u) => {
        const d = u.data() || {};
        console.log(`      • ${u.id}  role=${d.role || '-'}  status=${d.status || '-'}  email=${d.email || '-'}`);
    });

    // Collection counts
    console.log(`\n    collection counts:`);
    for (const col of SYNC_COLLECTIONS) {
        try {
            const c = await db.collection('schools').doc(code).collection(col).count().get();
            console.log(`      ${col.padEnd(16)}: ${c.data().count}`);
        } catch (e) {
            console.log(`      ${col.padEnd(16)}: (error: ${e.message})`);
        }
    }

    // syncLog tail — what was actually written and when
    try {
        const log = await db.collection('syncLog').doc(code).collection('changes')
            .orderBy('updatedAt', 'desc').limit(6).get();
        console.log(`\n    syncLog tail (${log.size}, newest first):`);
        log.forEach((e) => {
            const d = e.data() || {};
            console.log(`      • ${toIso(d.updatedAt)}  ${String(d.operation || '?').padEnd(4)} ${String(d.entityType || d.tableName || '?').padEnd(16)} device=${String(d.deviceHash || '-').slice(0, 12)}`);
        });
    } catch (e) {
        console.log(`\n    syncLog: (error: ${e.message})`);
    }
}

async function main() {
    const db = initDb();
    const codes = CODES.length ? CODES : await pickRecentSchools(db);
    console.log(`Inspecting: ${codes.join(', ')}`);
    for (const code of codes) {
        await inspect(db, code);
    }
    console.log('');
    process.exit(0);
}

main().catch((err) => {
    console.error('\n[!] Failed:', err && err.message ? err.message : err);
    process.exit(1);
});
