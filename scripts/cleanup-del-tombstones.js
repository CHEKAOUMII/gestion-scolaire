'use strict';

/**
 * cleanup-del-tombstones.js
 *
 * Remediates the "soft-delete tombstone" pollution in the entity collections.
 *
 * Background: the push path historically mirrored DEL operations into the entity
 * collections as merge-tombstones ({ operation: 'DEL', ... }) instead of physically
 * deleting the document. Those tombstones:
 *   - double collection counts (e.g. students 1327 -> 2654),
 *   - break bootstrap pull (a students tombstone carries only `code`, so the INSERT
 *     fails with "NOT NULL constraint failed: students.full_name").
 *
 * The engine fix (deleteDoc on DEL + bootstrap skip) stops NEW tombstones and stops
 * them breaking pull. This script cleans up the ones ALREADY in Firestore.
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT. It only counts and samples unless you pass --apply.
 *   - It only ever deletes documents whose `operation` field === 'DEL'. Live rows
 *     (real students/grades) have no such field and are never touched.
 *   - The syncLog/{code}/changes collection is NOT touched (its DEL entries are
 *     legitimate change records with a TTL).
 *
 * Usage:
 *   node scripts/cleanup-del-tombstones.js 11111O                 # dry-run, all entity collections
 *   node scripts/cleanup-del-tombstones.js 11111O --only=students,grades
 *   node scripts/cleanup-del-tombstones.js 11111O --apply         # actually delete
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const { COLLECTION_MAP } = require('../main/firebase/collections');

const SERVICE_ACCOUNT_PATH =
    String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim() ||
    path.join(__dirname, '..', 'firebase', 'gestionscholaire-firebase-adminsdk-fbsvc-d818682f4a.json');

const ARGS = process.argv.slice(2);
const CODES = ARGS.filter((a) => !a.startsWith('--')).map((c) => c.trim().toUpperCase());
const OPT = Object.fromEntries(
    ARGS.filter((a) => a.startsWith('--')).map((a) => {
        const [k, v] = a.replace(/^--/, '').split('=');
        return [k, v === undefined ? true : v];
    })
);
const APPLY = OPT.apply === true || OPT.apply === 'true';
const PAGE = 400;

// The entity collections that mirror local tables (skip nothing — a DEL tombstone
// is junk in any of them). Sourced from COLLECTION_MAP so it can't drift.
const ONLY = OPT.only ? String(OPT.only).split(',').map((s) => s.trim()) : null;
const COLLECTIONS = Object.values(COLLECTION_MAP)
    .map((e) => e.collection)
    .filter((name, i, arr) => arr.indexOf(name) === i)
    .filter((name) => !ONLY || ONLY.includes(name));

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

async function cleanCollection(db, code, collectionName) {
    const colRef = db.collection('schools').doc(code).collection(collectionName);
    let scanned = 0;
    let deleted = 0;
    const samples = [];

    while (true) {
        const snap = await colRef.where('operation', '==', 'DEL').limit(PAGE).get();
        if (snap.empty) break;

        scanned += snap.size;
        for (const d of snap.docs) {
            if (samples.length < 5) samples.push(d.id);
        }

        if (!APPLY) {
            // Dry-run: we must not loop forever on the same page. Report the first
            // page's size as a lower bound and use an aggregate count for the total.
            break;
        }

        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;

        if (snap.size < PAGE) break;
    }

    let totalDel = null;
    try {
        const c = await colRef.where('operation', '==', 'DEL').count().get();
        totalDel = c.data().count;
    } catch (e) {
        totalDel = `(count error: ${e.message})`;
    }

    return { collectionName, totalDel, deleted, samples };
}

async function main() {
    if (!CODES.length) {
        console.error('Usage: node scripts/cleanup-del-tombstones.js <SCHOOL_CODE> [--only=a,b] [--apply]');
        process.exit(1);
    }
    const db = initDb();

    console.log(`\nMode: ${APPLY ? '*** APPLY (will delete) ***' : 'DRY-RUN (no writes)'}`);
    console.log(`Collections: ${COLLECTIONS.join(', ')}`);

    for (const code of CODES) {
        console.log(`\n══════════════════════════════════════════════════════════`);
        console.log(`  schools/${code}`);
        console.log(`══════════════════════════════════════════════════════════`);

        let grandDel = 0;
        let grandDeleted = 0;
        for (const collectionName of COLLECTIONS) {
            const r = await cleanCollection(db, code, collectionName);
            const totalNum = typeof r.totalDel === 'number' ? r.totalDel : 0;
            grandDel += totalNum;
            grandDeleted += r.deleted;
            if (totalNum > 0 || r.deleted > 0) {
                const action = APPLY ? `deleted ${r.deleted}, remaining ${r.totalDel}` : `${r.totalDel} tombstones`;
                console.log(`   ${collectionName.padEnd(16)}: ${action}`);
                if (r.samples.length) console.log(`     sample ids: ${r.samples.join(', ')}`);
            } else {
                console.log(`   ${collectionName.padEnd(16)}: clean`);
            }
        }

        console.log(`   ${'—'.repeat(40)}`);
        if (APPLY) {
            console.log(`   TOTAL deleted this run: ${grandDeleted}   remaining tombstones: ${grandDel}`);
        } else {
            console.log(`   TOTAL tombstones to delete: ${grandDel}`);
            console.log(`   Re-run with --apply to delete them.`);
        }
    }
    console.log('');
    process.exit(0);
}

main().catch((err) => {
    console.error('\n[!] Failed:', err && err.message ? err.message : err);
    process.exit(1);
});
