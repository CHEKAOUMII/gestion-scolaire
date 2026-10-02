'use strict';

const fs = require('fs');
const path = require('path');

const utilsPath = path.join(__dirname, '..', 'js', 'utils.js');
let s = fs.readFileSync(utilsPath, 'utf8');

// --- Remove FilterManager class (lives in js/shared/filter-manager.js) ---
const fmStart = s.indexOf('// ===== Unified Filter Manager =====');
const fmEnd = s.indexOf('// ===== Auto-init =====');
if (fmStart === -1 || fmEnd === -1 || fmEnd <= fmStart) {
    console.warn('FilterManager block not found or already removed');
} else {
    const replacement = `// ===== Unified Filter Manager =====
// Canonical class: js/shared/filter-manager.js (PencilShared.FilterManager).
// Loaded before this file on pages; bind fallback for late/legacy load order.
(function bindFilterManager() {
    const g = typeof window !== 'undefined' ? window : globalThis;
    const ps = g.PencilShared || (g.PencilShared = {});
    if (typeof ps.FilterManager === 'function') {
        g.FilterManager = ps.FilterManager;
    } else if (typeof g.FilterManager === 'function') {
        ps.FilterManager = g.FilterManager;
    } else {
        console.warn(
            '[utils] FilterManager missing — include <script src="js/shared/filter-manager.js" defer> before utils.js'
        );
    }
})();

`;
    s = s.slice(0, fmStart) + replacement + s.slice(fmEnd);
    console.log('Removed FilterManager class body');
}

// --- Auth/session fallback wrappers: only define if shared module not loaded ---
// Replace core session function definitions with guarded versions that skip when PencilShared already has them.

function wrapFn(name, body) {
    // body is full "function name(...) { ... }"
    const re = new RegExp(
        'function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}',
        'm'
    );
    // Only first top-level occurrence — non-greedy may fail on nested braces.
    // Use manual brace matching instead.
    const marker = 'function ' + name + '(';
    const idx = s.indexOf(marker);
    if (idx === -1) {
        console.warn('function not found:', name);
        return;
    }
    // find opening brace
    let i = s.indexOf('{', idx);
    let depth = 0;
    let end = -1;
    for (; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end === -1) {
        console.warn('could not end function', name);
        return;
    }
    s = s.slice(0, idx) + body + s.slice(end + 1);
    console.log('wrapped', name);
}

// After auth-session loads, these function declarations would overwrite shared ones.
// Convert to: if already present, no-op declaration that reuses global.

const guarded = {
    getAuthSessionData: `function getAuthSessionData() {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.getAuthSessionData === 'function') {
        return window.PencilShared.getAuthSessionData();
    }
    // Fallback when auth-session.js was not loaded
    let raw = null;
    try { raw = localStorage.getItem(AUTH_SESSION_KEY); } catch (_err) { return null; }
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (parsed._h !== _computeSessionHash(parsed)) return null;
        return parsed;
    } catch (_err) { return null; }
}`,
    isAuthSessionActive: `function isAuthSessionActive() {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.isAuthSessionActive === 'function') {
        return window.PencilShared.isAuthSessionActive();
    }
    const data = getAuthSessionData();
    if (!data) return false;
    const loggedAt = Number(data.loggedAt || 0);
    if (!Number.isFinite(loggedAt) || loggedAt <= 0) return false;
    if (Date.now() - loggedAt > AUTH_SESSION_TTL_MS) {
        try { localStorage.removeItem(AUTH_SESSION_KEY); } catch (_err) {}
        return false;
    }
    return true;
}`,
    getAuthRole: `function getAuthRole() {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.getAuthRole === 'function') {
        return window.PencilShared.getAuthRole();
    }
    const session = getAuthSessionData();
    return _normalizeRole(session?.role || '');
}`,
    setAuthSession: `function setAuthSession(email = '', user = {}) {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.setAuthSession === 'function') {
        return window.PencilShared.setAuthSession(email, user);
    }
    const safeUser = user && typeof user === 'object' ? user : {};
    try {
        const sessionData = {
            userId: Number(safeUser.userId || 0),
            name: String(safeUser.name || ''),
            email: String(safeUser.email || email || '').trim().toLowerCase(),
            role: _normalizeRole(safeUser.role || ''),
            loggedAt: Date.now(),
            source: 'sqlite'
        };
        sessionData._h = _computeSessionHash(sessionData);
        localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionData));
    } catch (_err) {}
}`,
    clearAuthSession: `function clearAuthSession() {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.clearAuthSession === 'function') {
        return window.PencilShared.clearAuthSession();
    }
    try { localStorage.removeItem(AUTH_SESSION_KEY); } catch (_err) {}
}`,
    getSchoolYear: `function getSchoolYear() {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.getSchoolYear === 'function') {
        return window.PencilShared.getSchoolYear();
    }
    return localStorage.getItem(SCHOOL_YEAR_KEY) || '2025/2026';
}`,
    setSchoolYear: `function setSchoolYear(newYear) {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.setSchoolYear === 'function') {
        return window.PencilShared.setSchoolYear(newYear);
    }
    if (!newYear) return;
    localStorage.setItem(SCHOOL_YEAR_KEY, newYear);
    const saveToDb =
        window.api && window.api.settings && window.api.settings.setSchoolYear
            ? window.api.settings.setSchoolYear(newYear)
            : window.api && window.api.settings && window.api.settings.set
              ? window.api.settings.set('currentSchoolYear', newYear)
              : Promise.resolve();
    saveToDb.finally(() => { window.location.reload(); });
}`,
    initSchoolYear: `async function initSchoolYear() {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.initSchoolYear === 'function') {
        return window.PencilShared.initSchoolYear();
    }
    const localYear = localStorage.getItem(SCHOOL_YEAR_KEY);
    if (!localYear) {
        if (window.api && window.api.settings && window.api.settings.get) {
            try {
                const dbYear = await window.api.settings.get('currentSchoolYear');
                localStorage.setItem(SCHOOL_YEAR_KEY, dbYear || '2025/2026');
            } catch (e) {
                console.error('Error fetching school year from DB:', e);
                localStorage.setItem(SCHOOL_YEAR_KEY, '2025/2026');
            }
        } else {
            localStorage.setItem(SCHOOL_YEAR_KEY, '2025/2026');
        }
    }
    const resolvedYear = localStorage.getItem(SCHOOL_YEAR_KEY);
    const yearSelect = document.getElementById('school-year');
    if (yearSelect && resolvedYear) {
        let opt = yearSelect.querySelector('option[value="' + resolvedYear + '"]');
        if (!opt) {
            opt = document.createElement('option');
            opt.value = resolvedYear;
            opt.textContent = resolvedYear;
            yearSelect.insertBefore(opt, yearSelect.firstChild);
        }
        yearSelect.value = resolvedYear;
    }
}`
};

for (const [name, body] of Object.entries(guarded)) {
    wrapFn(name, body);
}

// Also guard setAppAccessState / getAppAccessState / getCurrentAppRole
const more = {
    setAppAccessState: `function setAppAccessState(state) {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.setAppAccessState === 'function') {
        return window.PencilShared.setAppAccessState(state);
    }
    const s = String(state || '').toLowerCase();
    if (['licensed', 'trial', 'blocked'].includes(s)) {
        document.documentElement.dataset.appAccessState = s;
    } else {
        document.documentElement.dataset.appAccessState = 'blocked';
    }
}`,
    getAppAccessState: `function getAppAccessState() {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.getAppAccessState === 'function') {
        return window.PencilShared.getAppAccessState();
    }
    const value = document.documentElement.dataset.appAccessState;
    if (value === 'licensed') return 'licensed';
    if (value === 'trial') return 'trial';
    return 'blocked';
}`,
    getCurrentAppRole: `function getCurrentAppRole() {
    if (typeof window !== 'undefined' && window.PencilShared && typeof window.PencilShared.getCurrentAppRole === 'function') {
        return window.PencilShared.getCurrentAppRole();
    }
    const session = getAuthSessionData();
    if (!session || !isAuthSessionActive()) return null;
    const normalized = _normalizeRole(session.role || '');
    return normalized || null;
}`
};

for (const [name, body] of Object.entries(more)) {
    wrapFn(name, body);
}

// Ensure module.exports FilterManager references global
s = s.replace(
    /FilterManager\n    \};\n\}/,
    `typeof FilterManager !== 'undefined' ? FilterManager : (typeof globalThis !== 'undefined' && globalThis.FilterManager) || null
    };
}`
);

// Prefer AuthSession from shared if present
if (!s.includes('PencilShared AuthSession prefer')) {
    s = s.replace(
        'window.AuthSession = {\n    isActive: isAuthSessionActive,\n    get: getAuthSessionData,\n    set: setAuthSession,\n    clear: clearAuthSession\n};',
        `// PencilShared AuthSession prefer — keep facade in sync with shared module
window.AuthSession = window.AuthSession || {
    isActive: isAuthSessionActive,
    get: getAuthSessionData,
    set: setAuthSession,
    clear: clearAuthSession
};
window.AuthSession.isActive = isAuthSessionActive;
window.AuthSession.get = getAuthSessionData;
window.AuthSession.set = setAuthSession;
window.AuthSession.clear = clearAuthSession;`
    );
}

fs.writeFileSync(utilsPath, s);
console.log('utils.js patched for WP6');
console.log('lines', s.split('\n').length);
