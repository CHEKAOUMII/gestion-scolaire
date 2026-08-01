'use strict';

/**
 * D1 student remote identity: year-scoped document IDs + legacy compatibility.
 */

const assert = require('assert');
const {
    buildDocumentId,
    buildLegacyDocumentId,
    parseStudentDocumentId,
    studentLogicalKey,
    COLLECTION_MAP
} = require('../main/firebase/collections');
const {
    getLocalKeyFields,
    getRemoteIdFields,
    getLegacyIdFields,
    findLocalIdByLogicalKeys
} = require('../main/sync/entity-registry');
const {
    classifyStudentRemoteDoc,
    planLegacyToCanonicalCopies,
    planSafeLegacyDeletes,
    summarizeStudentRemoteDocs
} = require('../main/sync/student-remote-id-migration');

console.log('[test] D1 student remote identity');

// --- Registry contracts ---
assert.deepStrictEqual(getLocalKeyFields('students'), ['school_year', 'code']);
assert.deepStrictEqual(getRemoteIdFields('students'), ['school_year', 'code']);
assert.deepStrictEqual(getLegacyIdFields('students'), ['code']);
assert.deepStrictEqual(COLLECTION_MAP.students.idFields, ['school_year', 'code']);
assert.deepStrictEqual(COLLECTION_MAP.students.legacyIdFields, ['code']);
console.log('  [ok] registry uses year-scoped remote idFields');

// --- Document ID builders ---
const yearA = { code: 'S12345', school_year: '2025/2026' };
const yearB = { code: 'S12345', school_year: '2026/2027' };

const idA = buildDocumentId('students', yearA);
const idB = buildDocumentId('students', yearB);
assert.strictEqual(idA, '2025%2F2026__S12345');
assert.strictEqual(idB, '2026%2F2027__S12345');
assert.notStrictEqual(idA, idB, 'cross-year collision must not share document id');
console.log('  [ok] cross-year students get distinct remote document ids');

assert.strictEqual(buildLegacyDocumentId('students', yearA), 'S12345');
assert.strictEqual(buildLegacyDocumentId('students', yearB), 'S12345');
assert.strictEqual(
    buildDocumentId('students', { code: 'S12345' }),
    null,
    'canonical id requires school_year'
);
console.log('  [ok] legacy id remains code-only; canonical requires year');

// --- Parse both shapes ---
assert.deepStrictEqual(parseStudentDocumentId(idA), {
    school_year: '2025/2026',
    code: 'S12345'
});
assert.deepStrictEqual(parseStudentDocumentId('S12345'), {
    code: 'S12345',
    school_year: null
});
assert.deepStrictEqual(studentLogicalKey(yearA), { school_year: '2025/2026', code: 'S12345' });
console.log('  [ok] parse legacy + canonical document ids');

// --- Migration classification ---
const docs = [
    {
        id: 'S12345',
        data: { code: 'S12345', school_year: '2025/2026', full_name: 'A', version: 3 }
    },
    {
        id: '2025%2F2026__S999',
        data: { code: 'S999', school_year: '2025/2026', full_name: 'B', version: 1 }
    },
    {
        id: 'ORPHAN1',
        data: { code: 'ORPHAN1', full_name: 'No year', version: 1 }
    },
    {
        id: 'S777',
        data: { code: 'S777', school_year: '2025/2026', full_name: 'C', version: 2 }
    },
    {
        id: '2025%2F2026__S777',
        data: { code: 'S777', school_year: '2025/2026', full_name: 'C', version: 2 }
    }
];

const c0 = classifyStudentRemoteDoc(docs[0]);
assert.strictEqual(c0.classification, 'legacy');
assert.strictEqual(c0.canonicalId, '2025%2F2026__S12345');

const c1 = classifyStudentRemoteDoc(docs[1]);
assert.strictEqual(c1.classification, 'canonical');

const c2 = classifyStudentRemoteDoc(docs[2]);
assert.strictEqual(c2.classification, 'orphan_legacy');

const { summary } = summarizeStudentRemoteDocs(docs);
assert.strictEqual(summary.legacy, 2);
assert.strictEqual(summary.canonical, 2);
assert.strictEqual(summary.orphanLegacy, 1);
assert.strictEqual(summary.needsCopy, 1, 'S12345 needs copy; S777 already has twin');

const copies = planLegacyToCanonicalCopies(docs);
assert.strictEqual(copies.length, 1);
assert.strictEqual(copies[0].fromId, 'S12345');
assert.strictEqual(copies[0].toId, '2025%2F2026__S12345');

const deletes = planSafeLegacyDeletes(docs);
assert.strictEqual(deletes.length, 1);
assert.strictEqual(deletes[0].legacyId, 'S777');
console.log('  [ok] migration classify / copy / safe-delete plans');

// --- Logical-key local lookup (pull dedup) ---
function createLookupDb(rows) {
    return {
        prepare(sql) {
            const s = String(sql);
            return {
                get(...params) {
                    if (s.includes('FROM "students"') && s.includes('school_year')) {
                        const [year, code] = params;
                        const row = rows.find((r) => r.school_year === year && r.code === code);
                        return row ? { id: row.id } : undefined;
                    }
                    return undefined;
                }
            };
        }
    };
}

const db = createLookupDb([
    { id: 10, code: 'S12345', school_year: '2025/2026' },
    { id: 11, code: 'S12345', school_year: '2026/2027' }
]);

assert.strictEqual(
    findLocalIdByLogicalKeys(db, 'students', { code: 'S12345', school_year: '2025/2026' }),
    10
);
assert.strictEqual(
    findLocalIdByLogicalKeys(db, 'students', { code: 'S12345', school_year: '2026/2027' }),
    11
);
assert.strictEqual(
    findLocalIdByLogicalKeys(db, 'students', { code: 'S12345', school_year: '2099/2100' }),
    null
);
console.log('  [ok] logical-key lookup separates years');

console.log('[test] D1 student remote identity OK');
