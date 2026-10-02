// js/name-resolver.js
// Standalone — no dependencies. Load before any script that uses NameResolver.
// Dual-export: global NameResolver + module.exports for Node tests.
// Future: will be imported by js/master-data.js

'use strict';

const _NR_TITLES = [
    'الأستاذ', 'الأستاذة', 'أستاذ', 'أستاذة',
    'م', 'د', 'دكتور', 'دكتورة',
    'mr', 'mme', 'mme.', 'mr.', 'pr', 'pr.', 'm.'
];

class NameResolver {
    /**
     * @param {Array<{id: number|null, name: string}>} candidates
     */
    constructor(candidates) {
        this._candidates = (candidates || []).filter((c) => c && c.name);
        this._normalized = this._candidates.map((c) => ({
            ...c,
            _norm: NameResolver.normalizeName(c.name)
        }));
    }

    /**
     * Normalize a name string for comparison.
     * Removes diacritics, normalizes Arabic letter variants, collapses whitespace.
     * @param {string} str
     * @returns {string}
     */
    static normalizeName(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .replace(/[\u0610-\u061A\u064B-\u065F]/g, '')   // Arabic diacritics
            .replace(/[أإآ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي')
            .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')      // keep Arabic + latin + digits
            .replace(/\s+/g, ' ')
            .trim();
    }

    static _stripTitles(norm) {
        let result = norm;
        for (const t of _NR_TITLES) {
            const pattern = new RegExp(
                `(^|\\s)${NameResolver.normalizeName(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`,
                'g'
            );
            result = result.replace(pattern, ' ');
        }
        return result.replace(/\s+/g, ' ').trim();
    }

    static _levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) =>
            Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
        );
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        return dp[m][n];
    }

    static _similarity(a, b) {
        if (!a && !b) return 1;
        if (!a || !b) return 0;
        const dist = NameResolver._levenshtein(a, b);
        return 1 - dist / Math.max(a.length, b.length);
    }

    /** Arabic-to-Latin phonetic skeleton for transliteration comparison. */
    static _latinSkeleton(norm) {
        const map = {
            'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh',
            'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's',
            'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
            'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y'
        };
        return norm.split('').map((c) => map[c] ?? c).join('').replace(/\s+/g, ' ').trim();
    }

    /**
     * Synchronous resolution — steps 1-5 only (no DB).
     * @param {string} rawName
     * @returns {{ candidateId: number|null, confidence: number, matchType: string, normalizedName?: string, needsReview?: boolean, candidates?: Array }}
     */
    resolve(rawName) {
        if (!rawName) return { candidateId: null, confidence: 0, matchType: 'unmatched', needsReview: true };

        const norm = NameResolver.normalizeName(rawName);

        // Step 1 — exact match after normalization
        for (const c of this._normalized) {
            if (c._norm === norm)
                return { candidateId: c.id, confidence: 1.0, matchType: 'exact', normalizedName: c.name };
        }

        // Step 2 — swap first/family name order
        const parts = norm.split(/\s+/).filter(Boolean);
        if (parts.length === 2) {
            const swapped = `${parts[1]} ${parts[0]}`;
            for (const c of this._normalized) {
                if (c._norm === swapped)
                    return { candidateId: c.id, confidence: 0.97, matchType: 'swapped', normalizedName: c.name };
            }
        }

        // Step 3 — strip honorific titles, then re-run steps 1-2
        const stripped = NameResolver._stripTitles(norm);
        if (stripped && stripped !== norm) {
            const inner = new NameResolver(this._candidates).resolve(stripped);
            if (inner.matchType === 'exact' || inner.matchType === 'swapped') {
                return { ...inner, confidence: Math.min(inner.confidence, 0.93), matchType: 'stripped' };
            }
        }

        // Step 4 — Arabic↔Latin transliteration skeleton
        const inputSkeleton = NameResolver._latinSkeleton(norm);
        for (const c of this._normalized) {
            const cSkeleton = NameResolver._latinSkeleton(c._norm);
            if (inputSkeleton && cSkeleton && NameResolver._similarity(inputSkeleton, cSkeleton) >= 0.88) {
                return { candidateId: c.id, confidence: 0.88, matchType: 'transliterated', normalizedName: c.name };
            }
        }

        // Step 5 — fuzzy Levenshtein ≥ 85%
        const fuzzyMatches = this._normalized
            .map((c) => ({ ...c, score: NameResolver._similarity(norm, c._norm) }))
            .filter((c) => c.score >= 0.85)
            .sort((a, b) => b.score - a.score);

        if (fuzzyMatches.length === 1)
            return { candidateId: fuzzyMatches[0].id, confidence: fuzzyMatches[0].score, matchType: 'fuzzy', normalizedName: fuzzyMatches[0].name };

        if (fuzzyMatches.length > 1)
            return {
                candidates: fuzzyMatches.map((c) => ({ candidateId: c.id, confidence: c.score, name: c.name })),
                matchType: 'fuzzy',
                needsReview: true
            };

        return { candidateId: null, confidence: 0, matchType: 'unmatched', needsReview: true };
    }

    /**
     * Async resolution — step 6: checks DB aliases first, then falls back to resolve().
     * @param {string} rawName
     * @param {string} schoolYear
     * @returns {Promise<object>}
     */
    async resolveAsync(rawName, schoolYear) {
        if (window.api?.teachers?.getNameAliases) {
            try {
                const aliases = await window.api.teachers.getNameAliases('teacher', schoolYear);
                const normInput = NameResolver.normalizeName(rawName);
                const match = (aliases || []).find((a) => a.alias_normalized === normInput);
                if (match) {
                    const candidate = this._candidates.find((c) => c.id === match.canonical_id);
                    return {
                        candidateId: match.canonical_id,
                        confidence: 1.0,
                        matchType: 'alias',
                        normalizedName: candidate?.name || rawName
                    };
                }
            } catch (_) { /* fall through */ }
        }
        return this.resolve(rawName);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NameResolver;
}
if (typeof globalThis !== 'undefined') {
    globalThis.NameResolver = NameResolver;
} else if (typeof window !== 'undefined') {
    window.NameResolver = NameResolver;
}
