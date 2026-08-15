(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) {
        root.PencilShared = root.PencilShared || {};
        root.PencilShared.TeacherIdentity = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TITLE_TOKENS = new Set([
        'استاذ',
        'استاذة',
        'السيد',
        'السييد',
        'السيدة',
        'السييدة',
        'الدكتور',
        'البروفيسور',
        'مدام',
        'مستر',
        'مادام',
        'انسة',
        'ميم',
        'ميس',
        'مستر',
        'سي',
        'سيد',
        'سيدة',
        'استاد',
        'prof',
        'professor',
        'doctor',
        'dr',
        'mr',
        'mrs',
        'ms',
        'miss',
        'mister',
        'm',
        'mme',
        'mlle',
        'mdm',
        'sir',
        'madam'
    ]);

    const TITLE_PREFIXES = [
        'الاستاذة',
        'الاستاذ',
        'استاذة',
        'استاذ',
        'السيدة',
        'السييدة',
        'السيد',
        'السييد',
        'الدكتورة',
        'الدكتور',
        'البروفيسور',
        'ا.د.',
        'ا.د',
        'ا.',
        'د.',
        'mrs',
        'mister',
        'miss',
        'professor',
        'prof',
        'madam',
        'mlle',
        'mme',
        'mrs.',
        'mr.',
        'ms.',
        'miss.',
        'dr.',
        'prof.',
        'm.',
        'doctor',
        'madame'
    ].map((t) => foldArabic(t).toLowerCase());

    function foldArabic(value) {
        if (typeof ImportCenterNormalize !== 'undefined' && ImportCenterNormalize.foldArabic) return ImportCenterNormalize.foldArabic(value);
        if (typeof window !== 'undefined' && window.ImportCenterNormalize && window.ImportCenterNormalize.foldArabic) return window.ImportCenterNormalize.foldArabic(value);
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
            .replace(/[أإآٱ]/g, 'ا')
            .replace(/[ؤ]/g, 'و')
            .replace(/[ئى]/g, 'ي')
            .replace(/[ة]/g, 'ه');
    }

    function isTitleToken(token) {
        const t = foldArabic(token).toLowerCase();
        if (TITLE_TOKENS.has(t)) return true;
        const bare = t.startsWith('ال') ? t.slice(2) : t;
        return TITLE_TOKENS.has(bare);
    }

    function stripTitlePrefix(value) {
        let current = String(value || '').trim();
        for (let pass = 0; pass < 4; pass += 1) {
            const folded = foldArabic(current).toLowerCase();
            if (!folded) return '';
            let stripped = false;
            for (const prefix of TITLE_PREFIXES) {
                if (!prefix) continue;
                if (folded === prefix) return '';
                if (folded.startsWith(prefix)) {
                    const next = folded[prefix.length] || '';
                    if (/[\s\-_:،,.]/.test(next)) {
                        const rest = folded
                            .slice(prefix.length)
                            .replace(/^[\s\-_:،,]+/, '')
                            .trim();
                        if (rest) {
                            current = rest;
                            stripped = true;
                            break;
                        }
                        return '';
                    }
                }
            }
            if (!stripped) break;
        }
        return current;
    }

    function tokenizeName(value) {
        const stripped = stripTitlePrefix(value);
        if (!stripped) return [];
        return foldArabic(stripped)
            .toLowerCase()
            .split(/[^a-z0-9\u0600-\u06ff]+/i)
            .filter(Boolean)
            .filter((token) => !isTitleToken(token));
    }

    function normalizeIdentityKey(value) {
        const tokens = tokenizeName(value);
        if (!tokens.length) return '';
        return [...tokens].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(' ');
    }

    function buildNameVariants(value) {
        const tokens = tokenizeName(value);
        if (!tokens.length) return [];
        const variants = new Set();
        variants.add(tokens.join(' '));
        const reversed = [...tokens].reverse();
        variants.add(reversed.join(' '));
        return Array.from(variants);
    }

    function groupEntriesByKey(entries, keyOf) {
        const groups = new Map();
        for (const entry of entries) {
            const key = keyOf ? keyOf(entry) : normalizeIdentityKey(entry && entry.name);
            if (!key) continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(entry);
        }
        return groups;
    }

    function matchEntriesByKey(entries, value, keyOf) {
        const key = normalizeIdentityKey(value);
        if (!key) return { key: '', matches: [] };
        const groups = groupEntriesByKey(entries, keyOf);
        return { key, matches: groups.get(key) || [] };
    }

    return {
        foldArabic,
        isTitleToken,
        stripTitlePrefix,
        tokenizeName,
        normalizeIdentityKey,
        buildNameVariants,
        groupEntriesByKey,
        matchEntriesByKey
    };
});
