// Sync merge module - Phase 5: pure-logic three-way merge + checksum

function fnv1a(str) {
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0; // FNV prime, keep unsigned 32-bit
    }
    return hash.toString(16).padStart(8, '0');
}

function computeRowChecksum(rowData, sensitiveFields) {
    const clone = { ...rowData };
    for (const field of sensitiveFields || []) {
        delete clone[field];
    }

    const keys = Object.keys(clone).sort();
    let concat = '';
    for (const key of keys) {
        const val = clone[key] == null ? '' : String(clone[key]);
        concat += `${key}=${val}|`;
    }

    return fnv1a(concat);
}

function threeWayMerge(ancestor, local, remote, localTimestamp, remoteTimestamp) {
    const allFields = new Set([
        ...(ancestor != null ? Object.keys(ancestor) : []),
        ...Object.keys(local),
        ...Object.keys(remote)
    ]);

    const merged = {};
    const conflicts = [];
    let hadNonOverlap = false;

    for (const field of allFields) {
        const aVal = ancestor != null ? ancestor[field] : undefined;
        const lVal = local[field];
        const rVal = remote[field];

        const lStr = JSON.stringify(lVal);
        const rStr = JSON.stringify(rVal);
        const aStr = JSON.stringify(aVal);

        if (lStr === rStr) {
            merged[field] = lVal; // both agree — no conflict
        } else if (ancestor != null && lStr === aStr) {
            merged[field] = rVal; // only remote changed
            hadNonOverlap = true;
        } else if (ancestor != null && rStr === aStr) {
            merged[field] = lVal; // only local changed
            hadNonOverlap = true;
        } else {
            // True overlap or no ancestor — LWW
            merged[field] = remoteTimestamp >= localTimestamp ? rVal : lVal;
            conflicts.push(field);
        }
    }

    const resolution = conflicts.length > 0 ? 'lww' : hadNonOverlap ? 'merged' : 'clean';

    return { merged, conflicts, resolution };
}

module.exports = { computeRowChecksum, threeWayMerge };
