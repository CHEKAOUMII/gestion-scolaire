'use strict';

/**
 * Proctor Key Resolver — H5 fix helper
 *
 * Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
 * Task 6.H5.1.
 *
 * Pure helpers for resolving a proctor display name from the stable
 * key emitted by `getProctorKey` in `js/algorithms/proctor-distribution-v2.js`:
 *
 *     key := proc.cin || ('__idx_' + idx)
 *
 * Two functions are exposed:
 *
 *   • `resolveProctorDisplayName(key, proctorsList)`
 *       Resolve a single key to a display name. Falls back to the raw key
 *       when the proctor cannot be located or the resolved name is empty.
 *
 *   • `buildProctorDisplayMap(proctorsList)`
 *       Pre-compute a `Map<key, name>` for O(1) lookups during summary
 *       aggregation in `buildSummaryRows()` and the related helpers in
 *       `exams-rooms.html` / `exams-proctors.html`.
 *
 * Loaded via `<script src="js/data/proctor-key-resolver.js"></script>` in
 * the renderer (vanilla-renderer-script convention). Also `require`-able
 * from Node so unit tests under `tests/` can exercise the contract
 * without booting Electron.
 *
 * @see .kiro/specs/proctor-distribution-db-memory-mismatch/design.md
 *      → "Key→name resolution helper (H5 fix)"
 */
(function () {
    var IDX_KEY_RE = /^__idx_(\d+)$/;

    /**
     * Resolve a proctor display name for `key` against `proctorsList`.
     * Falls back to `key` whenever the proctor cannot be located or the
     * resolved name is empty.
     *
     * @param {string} key — `proc.cin` or `'__idx_' + idx`.
     * @param {Array<{cin?: string, teacher_name?: string, teacher_full_name?: string}>|null|undefined} proctorsList
     * @returns {string} Display name, or the raw key when no name is available.
     */
    function resolveProctorDisplayName(key, proctorsList) {
        if (!proctorsList || typeof proctorsList.length !== 'number') {
            return key;
        }

        var match = typeof key === 'string' ? key.match(IDX_KEY_RE) : null;
        if (match) {
            var idx = parseInt(match[1], 10);
            if (idx < 0 || idx >= proctorsList.length) {
                return key;
            }
            var byIdx = proctorsList[idx];
            if (!byIdx) {
                return key;
            }
            return byIdx.teacher_full_name || byIdx.teacher_name || key;
        }

        // CIN-keyed lookup.
        for (var i = 0; i < proctorsList.length; i++) {
            var proc = proctorsList[i];
            if (proc && proc.cin === key) {
                return proc.teacher_full_name || proc.teacher_name || key;
            }
        }
        return key;
    }

    /**
     * Pre-compute a `Map<key, displayName>` for fast lookups during
     * summary aggregation. The key for each entry is exactly what
     * `getProctorKey` would emit: `proc.cin || ('__idx_' + i)`.
     *
     * @param {Array<{cin?: string, teacher_name?: string, teacher_full_name?: string}>|null|undefined} proctorsList
     * @returns {Map<string, string>}
     */
    function buildProctorDisplayMap(proctorsList) {
        var map = new Map();
        if (!proctorsList || typeof proctorsList.length !== 'number') {
            return map;
        }
        for (var i = 0; i < proctorsList.length; i++) {
            var proc = proctorsList[i];
            var key = (proc && proc.cin) ? proc.cin : ('__idx_' + i);
            map.set(key, resolveProctorDisplayName(key, proctorsList));
        }
        return map;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            resolveProctorDisplayName: resolveProctorDisplayName,
            buildProctorDisplayMap: buildProctorDisplayMap
        };
    }
    if (typeof window !== 'undefined') {
        window.GS2 = window.GS2 || {};
        window.GS2.resolveProctorDisplayName = resolveProctorDisplayName;
        window.GS2.buildProctorDisplayMap = buildProctorDisplayMap;
    }
})();
