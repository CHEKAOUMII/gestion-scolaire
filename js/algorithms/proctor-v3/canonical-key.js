// Proctor Distribution V3 — canonical proctor key + key adapter.
//
// Single source of truth for proctor identity inside V3. Every proctor in
// `proctorsList` is represented by exactly ONE canonical key, derived from
// `(proc, idx)` via `canonicalProctorKey`.
//
// The Key Adapter exists at the boundary between the algorithm and external
// data (`dutyData`, `exemptionsData`, `meAssignments`). Legacy callers may
// reference proctors by `cin`, `som`, or numeric `idx_N` / `__idx_N` forms;
// `buildKeyAdapter` accepts every plausible external shape and maps it to the
// single canonical form. Internal V3 code never branches on key shape.
//
// V2 pitfalls deliberately avoided:
//   - V2 had TWO competing identity functions (cin||__idx_N vs cin||som||idx_N)
//     producing dual identities. V3 has exactly ONE canonical function.
//   - V2 omitted `.trim()` on `cin`, generating ghost keys when inputs had
//     trailing whitespace. V3 trims `cin` (and `som` on the adapter side).

'use strict';

/**
 * Compute the canonical proctor key for a given proctor and its 0-based
 * index in `proctorsList`.
 *
 * Rule:
 *   trimmed non-empty `cin` → use that string
 *   otherwise               → fallback to `'__idx_' + idx`
 *
 * `som` is NEVER part of the canonical form (only the adapter recognizes it
 * as an input alias).
 *
 * @param {object} proc - proctor object; may be null/undefined or missing cin
 * @param {number} idx  - 0-based index of this proctor in proctorsList
 * @returns {string} canonical key
 */
function canonicalProctorKey(proc, idx) {
    var cin = proc && proc.cin != null ? String(proc.cin).trim() : '';
    if (cin) {
        return cin;
    }
    return '__idx_' + idx;
}

/**
 * Build a lookup map from every plausible external key form to the canonical
 * key for the corresponding proctor.
 *
 * For each proctor at index `i`, the following input-side aliases all map
 * to `canonicalProctorKey(proctorsList[i], i)`:
 *   - the canonical key itself (identity)
 *   - trimmed `cin`            (when non-empty)
 *   - untrimmed `cin`          (when it differs from trimmed and is non-empty)
 *   - trimmed `som`            (when non-empty)
 *   - untrimmed `som`          (when it differs from trimmed and is non-empty)
 *   - `'idx_' + i`             (legacy short form)
 *   - `'__idx_' + i`           (canonical fallback form)
 *
 * Earlier entries in `proctorsList` win on alias collisions: if two proctors
 * happen to share the same `som` value, the adapter keeps the first one's
 * mapping (canonical-identity entries are still written for both).
 *
 * @param {Array<object>} proctorsList - array of proctor records
 * @returns {Object<string,string>} adapter map (plain object, null-prototype)
 */
function buildKeyAdapter(proctorsList) {
    var adapter = Object.create(null);
    if (!Array.isArray(proctorsList)) {
        return adapter;
    }

    function setIfAbsent(key, value) {
        if (key == null) return;
        if (adapter[key] === undefined) {
            adapter[key] = value;
        }
    }

    for (var i = 0; i < proctorsList.length; i += 1) {
        var proc = proctorsList[i] || {};
        var canonical = canonicalProctorKey(proc, i);

        // Canonical identity must always resolve to itself, even if a prior
        // proctor's som happened to equal this canonical string.
        adapter[canonical] = canonical;

        var rawCin = proc.cin != null ? String(proc.cin) : '';
        var trimmedCin = rawCin.trim();
        if (trimmedCin) {
            setIfAbsent(trimmedCin, canonical);
            if (rawCin !== trimmedCin) {
                setIfAbsent(rawCin, canonical);
            }
        }

        var rawSom = proc.som != null ? String(proc.som) : '';
        var trimmedSom = rawSom.trim();
        if (trimmedSom) {
            setIfAbsent(trimmedSom, canonical);
            if (rawSom !== trimmedSom) {
                setIfAbsent(rawSom, canonical);
            }
        }

        setIfAbsent('idx_' + i, canonical);
        setIfAbsent('__idx_' + i, canonical);
    }

    return adapter;
}

/**
 * Resolve an external key to its canonical form via the adapter.
 * Accepts strings; performs a trimmed lookup as a fallback when the raw
 * form is not present in the adapter.
 *
 * @param {Object<string,string>} adapter
 * @param {string} externalKey
 * @returns {string|null} canonical key, or null if unresolvable
 */
function toCanonical(adapter, externalKey) {
    if (adapter == null) return null;
    if (externalKey == null) return null;
    if (typeof externalKey !== 'string') {
        externalKey = String(externalKey);
    }

    if (adapter[externalKey] !== undefined) {
        return adapter[externalKey];
    }
    var trimmed = externalKey.trim();
    if (trimmed !== externalKey && adapter[trimmed] !== undefined) {
        return adapter[trimmed];
    }
    return null;
}

module.exports = { canonicalProctorKey, buildKeyAdapter, toCanonical };
