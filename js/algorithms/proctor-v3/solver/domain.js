'use strict';

/**
 * Domain — set of candidate canonical proctor keys for a single CP variable.
 *
 * Wraps a `Set<string>` (canonical keys) and provides only the operations the
 * AC-3 propagator and CP solver need:
 *
 *   - `intersect(other)` — pure; returns a NEW Domain containing keys present
 *                          in both `this` and `other`. Neither operand is
 *                          mutated. Used by the AC-3 propagator to compute
 *                          the next candidate domain without losing the
 *                          previous snapshot.
 *   - `remove(value)`    — in-place; removes `value` from this Domain and
 *                          returns `this` for chaining.
 *   - `size()`           — number of remaining values.
 *   - `isEmpty()`        — `true` iff `size() === 0`.
 *   - `toArray()`        — returns a NEW array of the values in ascending
 *                          lexicographic order (Requirement 8.5: deterministic
 *                          iteration over input data structures regardless of
 *                          host JS engine insertion order).
 *   - `clone()`          — returns a NEW Domain with the same values; the
 *                          clone is independent (mutating one does not affect
 *                          the other).
 *
 * Invariants:
 *   - All stored values are strings (canonical proctor keys). The constructor
 *     coerces inputs via `String(...)` defensively, but callers SHOULD pass
 *     already-canonical keys produced by `canonicalProctorKey`.
 *   - `null` / `undefined` values are silently dropped at construction time.
 *   - `toArray()` is the ONLY iteration entry point; callers MUST use it
 *     instead of iterating the underlying Set directly to preserve
 *     deterministic order.
 */

/**
 * Construct a Domain.
 *
 * @param {Iterable<string>} [values] - optional iterable of canonical keys.
 *   Accepts arrays, Sets, or any iterable. Duplicates are collapsed.
 *   `null` / `undefined` entries are skipped.
 */
function Domain(values) {
    if (!(this instanceof Domain)) {
        return new Domain(values);
    }
    this._set = new Set();
    if (values == null) {
        return;
    }
    if (typeof values[Symbol.iterator] !== 'function') {
        throw new TypeError('Domain: values must be iterable');
    }
    for (const v of values) {
        if (v == null) continue;
        this._set.add(typeof v === 'string' ? v : String(v));
    }
}

/**
 * Intersect with another Domain.
 *
 * Pure: returns a NEW Domain whose values are the keys present in both
 * `this` and `other`. Neither operand is mutated.
 *
 * Iterates the smaller of the two sets for efficiency.
 *
 * @param {Domain} other
 * @returns {Domain}
 */
Domain.prototype.intersect = function (other) {
    if (!(other instanceof Domain)) {
        throw new TypeError('Domain.intersect: argument must be a Domain');
    }
    const result = new Domain();
    const a = this._set;
    const b = other._set;
    // Iterate the smaller set; lookup in the larger one.
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const v of small) {
        if (large.has(v)) {
            result._set.add(v);
        }
    }
    return result;
};

/**
 * Remove a value from this Domain in place.
 *
 * Returns `this` for fluent chaining. No-op when the value is absent.
 *
 * @param {string} value - canonical key to remove
 * @returns {Domain} this
 */
Domain.prototype.remove = function (value) {
    if (value == null) return this;
    this._set.delete(typeof value === 'string' ? value : String(value));
    return this;
};

/**
 * @returns {number} number of values currently in this Domain.
 */
Domain.prototype.size = function () {
    return this._set.size;
};

/**
 * @returns {boolean} true iff `size() === 0`.
 */
Domain.prototype.isEmpty = function () {
    return this._set.size === 0;
};

/**
 * Return the Domain values as a sorted array.
 *
 * Sort is ascending lexicographic on the canonical-key strings (default
 * `Array.prototype.sort`). This guarantees deterministic iteration regardless
 * of host JS engine `Set` insertion order (Requirement 8.5).
 *
 * @returns {string[]} new array, freshly allocated; safe for caller mutation.
 */
Domain.prototype.toArray = function () {
    return Array.from(this._set).sort();
};

/**
 * Return an independent copy of this Domain.
 *
 * Mutating the clone (`remove`) does NOT affect the original, and vice-versa.
 *
 * @returns {Domain}
 */
Domain.prototype.clone = function () {
    const copy = new Domain();
    for (const v of this._set) {
        copy._set.add(v);
    }
    return copy;
};

module.exports = { Domain };
