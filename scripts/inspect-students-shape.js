'use strict';

/**
 * inspect-students-shape.js  (read-only)
 *
 * Diagnoses WHY pull is failing with "NOT NULL constraint failed: students.full_name"
 * and WHY the students collection is doubled (e.g. 1327 -> 2654).
 *
 * For a given school code it reports, WITHOUT writing anything:
 *   1. students/ collection: how many docs, how many distinct `code` values,
 *      and a breakdown of docs by their "field signature" (the sorted set of
 *      top-level keys). This reveals if two differently-shaped datasets coexist.
 *   2. Which docs lack a usable `full_name` (the field the local schema requires).
 *   3. syncLog changes for entityType=student: doc-id pattern (numeric vs hash),
 *      and the `data` payload shape — so we can see where the code-only entries
 *      (changeId=1,10,100…) come from.
 *
 * Usage:
 *   node scripts/inspect-students-shape.js 11111O
 *   node scripts/inspect-students-shape.js 11111O --samples=5 --limit=4000
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

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
const SAMPLES = Number(OPT.samples) || 4;
const SCAN_LIMIT = Number(OPT.limit) || 6000;

// Field names the local `students` table actually has (schema.js + migrations).
const LOCAL_STUDENT_COLUMNS = new Set([
    'id', 'code', 'full_name', 'family_name', 'birth_date', 'birth_place', 'gender',
    'section', 'school_year', 'status', 'registration_type', 'created_at'
]);

const SYNC_METADATA_KEYS = new Set(['version', 'operation', 'rowSyncId', 'deviceHash', 'schoolYear', 'updatedAt', 'ttl']);

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

function payloadColumns(raw) {
    // Mimic the pull mapping: drop sync metadata, then keep only keys the local
    // students table recognizes. This is what would actually get INSERTed.
    const keys = Object.keys(raw).filter((k) => !SYNC_METADATA_KEYS.has(k));
    return keys.filter((k) => LOCAL_STUDENT_COLUMNS.has(k));
}

function shortVal(v) {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
    return String(v).slice(0, 40);
}

async function inspectStudentsCollection(db, code) {
    console.log(`\n── students/ collection (scanning up to ${SCAN_LIMIT}) ──`);
    const colRef = db.collection('schools').doc(code).collection('students');

    let total = 0;
    let missingFullName = 0;
    let codeOnly = 0;
    const distinctCodes = new Set();
    const dupCodes = new Map(); // code -> count
    const signatures = new Map(); // "keyA,keyB" -> { count, sampleDocIds: [] }

    let lastDoc = null;
    while (total < SCAN_LIMIT) {
        let q = colRef.orderBy(admin.firestore.FieldPath.documentId()).limit(500);
        if (lastDoc) q = q.startAfter(lastDoc);
        const snap = await q.get();
        if (snap.empty) break;

        for (const d of snap.docs) {
            total += 1;
            const raw = d.data() || {};
            const validCols = payloadColumns(raw);
            const sig = validCols.slice().sort().join(',') || '(none)';
            const bucket = signatures.get(sig) || { count: 0, sampleDocIds: [], sampleRaw: null };
            bucket.count += 1;
            if (bucket.sampleDocIds.length < SAMPLES) {
                bucket.sampleDocIds.push(d.id);
                if (!bucket.sampleRaw) bucket.sampleRaw = raw;
            }
            signatures.set(sig, bucket);

            const codeVal = String(raw.code ?? '').trim() || `(docid:${d.id})`;
            distinctCodes.add(codeVal);
            dupCodes.set(codeVal, (dupCodes.get(codeVal) || 0) + 1);

            if (!String(raw.full_name ?? '').trim()) missingFullName += 1;
            if (validCols.length === 1 && validCols[0] === 'code') codeOnly += 1;
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < 500) break;
    }

    console.log(`   total docs scanned : ${total}`);
    console.log(`   distinct code values: ${distinctCodes.size}`);
    console.log(`   docs missing full_name: ${missingFullName}`);
    console.log(`   docs mapping to ONLY [code]: ${codeOnly}`);

    const dups = [...dupCodes.entries()].filter(([, n]) => n > 1);
    console.log(`   codes appearing in >1 doc: ${dups.length}`);
    if (dups.length) {
        console.log(`     e.g. ${dups.slice(0, 8).map(([c, n]) => `${c}×${n}`).join(', ')}`);
    }

    console.log(`\n   field signatures (what maps into local columns):`);
    const sorted = [...signatures.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [sig, info] of sorted) {
        console.log(`     [${info.count.toString().padStart(6)}]  ${sig}`);
        console.log(`               docIds: ${info.sampleDocIds.join(', ')}`);
        if (info.sampleRaw) {
            const allKeys = Object.keys(info.sampleRaw);
            console.log(`               raw keys: ${allKeys.join(', ')}`);
            const preview = allKeys.slice(0, 8).map((k) => `${k}=${shortVal(info.sampleRaw[k])}`);
            console.log(`               sample : ${preview.join('  ')}`);
        }
    }
}

async function inspectStudentChanges(db, code) {
    console.log(`\n── syncLog/${code}/changes (entityType=student sample) ──`);
    const changesRef = db.collection('syncLog').doc(code).collection('changes');
    let snap;
    try {
        snap = await changesRef.where('entityType', '==', 'student').limit(400).get();
    } catch (e) {
        console.log(`   (query failed: ${e.message}) — trying unfiltered tail`);
        snap = await changesRef.limit(400).get();
    }

    let numericId = 0;
    let hashId = 0;
    let missingFullName = 0;
    const sigs = new Map();
    const samples = [];

    snap.forEach((d) => {
        const raw = d.data() || {};
        if (raw.entityType && raw.entityType !== 'student') return;
        if (/^\d+$/.test(d.id)) numericId += 1;
        else hashId += 1;

        const data = raw.data || {};
        const validCols = payloadColumns(data);
        const sig = validCols.slice().sort().join(',') || '(none)';
        sigs.set(sig, (sigs.get(sig) || 0) + 1);
        if (!String(data.full_name ?? '').trim()) missingFullName += 1;

        if (samples.length < SAMPLES) {
            samples.push({
                docId: d.id,
                rowSyncId: raw.rowSyncId,
                op: raw.operation,
                dataKeys: Object.keys(data).join(','),
                fullName: shortVal(data.full_name)
            });
        }
    });

    console.log(`   student change docs sampled: ${snap.size}`);
    console.log(`   doc-id numeric (1,10,100…): ${numericId}   hash-id: ${hashId}`);
    console.log(`   change payloads missing full_name: ${missingFullName}`);
    console.log(`   payload signatures:`);
    for (const [sig, n] of [...sigs.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`     [${n.toString().padStart(5)}]  ${sig}`);
    }
    console.log(`   samples:`);
    for (const s of samples) {
        console.log(`     • docId=${s.docId}  op=${s.op}  rowSyncId=${s.rowSyncId}`);
        console.log(`         dataKeys=[${s.dataKeys}]  full_name=${s.fullName}`);
    }
}

async function main() {
    if (!CODES.length) {
        console.error('Usage: node scripts/inspect-students-shape.js <SCHOOL_CODE> [--samples=N] [--limit=N]');
        process.exit(1);
    }
    const db = initDb();
    for (const code of CODES) {
        console.log(`\n══════════════════════════════════════════════════════════`);
        console.log(`  schools/${code}`);
        console.log(`══════════════════════════════════════════════════════════`);
        await inspectStudentsCollection(db, code);
        await inspectStudentChanges(db, code);
    }
    console.log('');
    process.exit(0);
}

main().catch((err) => {
    console.error('\n[!] Failed:', err && err.message ? err.message : err);
    process.exit(1);
});
