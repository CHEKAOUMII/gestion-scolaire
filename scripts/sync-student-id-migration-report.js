'use strict';

/**
 * D1 student remote ID migration — report-only by default.
 *
 * Classifies Firestore `schools/{schoolId}/students` documents into:
 *   - canonical (school_year__code)
 *   - legacy (code only)
 *   - orphan_legacy (code only, no school_year in payload)
 *   - malformed
 *
 * Usage:
 *   npm run sync:student-id-report -- --schoolId=YOUR_SCHOOL
 *   npm run sync:student-id-report -- --schoolId=YOUR_SCHOOL --json
 *   npm run sync:student-id-report -- --fixture=path/to/docs.json
 *
 * Live Firestore mode requires Firebase env + credentials available to the
 * Electron-as-Node runtime (same as other sync scripts). Prefer --fixture for
 * offline classification of an exported dump.
 *
 * Apply copy/delete is intentionally NOT implemented in this CLI — use the
 * report to drive an operator-reviewed Cloud Console / Admin SDK pass, then
 * re-run the report to confirm counts.
 */

const fs = require('fs');
const path = require('path');

const ARGS = process.argv.slice(2);
const OPT = Object.fromEntries(
    ARGS.filter((a) => a.startsWith('--')).map((a) => {
        const eq = a.indexOf('=');
        if (eq === -1) return [a.replace(/^--/, ''), true];
        return [a.slice(2, eq), a.slice(eq + 1)];
    })
);

const AS_JSON = OPT.json === true || OPT.json === 'true';

function loadFixture(filePath) {
    const abs = path.resolve(String(filePath));
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.docs)) return raw.docs;
    if (Array.isArray(raw.students)) return raw.students;
    throw new Error('Fixture must be an array or { docs: [] } / { students: [] }');
}

async function loadFromFirestore(schoolId) {
    // Lazy require so fixture-only runs stay lightweight.
    const { collection, getDocs, orderBy, query, limit, startAfter, documentId } = require('firebase/firestore');
    const { getFirestoreDb } = require('../main/firebase/config');

    const firestoreDb = getFirestoreDb();
    if (!firestoreDb) {
        throw new Error('Firestore client unavailable — check Firebase env / login');
    }

    const colPath = `schools/${schoolId}/students`;
    const colRef = collection(firestoreDb, colPath);
    const docs = [];
    let lastDoc = null;
    const pageSize = 500;

    while (true) {
        const clauses = [orderBy(documentId()), limit(pageSize)];
        if (lastDoc) clauses.splice(1, 0, startAfter(lastDoc));
        const snapshot = await getDocs(query(colRef, ...clauses));
        if (snapshot.empty) break;
        for (const snap of snapshot.docs) {
            docs.push({ id: snap.id, data: snap.data() || {} });
        }
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.docs.length < pageSize) break;
    }

    return docs;
}

async function main() {
    const { formatMigrationReport } = require('../main/sync/student-remote-id-migration');

    let docs;
    if (OPT.fixture) {
        docs = loadFixture(OPT.fixture);
        console.error(`[i] Loaded ${docs.length} docs from fixture ${OPT.fixture}`);
    } else if (OPT.schoolId) {
        docs = await loadFromFirestore(String(OPT.schoolId));
        console.error(`[i] Fetched ${docs.length} docs from schools/${OPT.schoolId}/students`);
    } else {
        console.error('Usage:');
        console.error('  npm run sync:student-id-report -- --fixture=docs.json');
        console.error('  npm run sync:student-id-report -- --schoolId=SCHOOL [--json]');
        process.exit(2);
    }

    const report = formatMigrationReport(docs);
    if (AS_JSON) {
        console.log(
            JSON.stringify(
                {
                    summary: report.summary,
                    copyPlan: report.copyPlan,
                    deletePlan: report.deletePlan
                },
                null,
                2
            )
        );
    } else {
        console.log(report.text);
    }
}

main().catch((err) => {
    console.error('[!] student-id migration report failed:', err.message);
    process.exit(1);
});
