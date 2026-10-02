/**
 * Auth session + school-year storage helpers (SOLID WP6).
 * Classic-script module: attaches to window.PencilShared and bare globals.
 *
 * Consumers that only need session/year (without full utils) can load this alone.
 * Pages that load js/utils.js should load this file first so utils can bind compatibility.
 */
(function (global) {
    'use strict';

    const PencilShared = global.PencilShared || (global.PencilShared = {});
    const storage = global.localStorage;

    const AUTH_SESSION_KEY = 'gsl_auth_session_v1';
    const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
    const SCHOOL_YEAR_KEY = 'gsl_current_school_year';
    const KNOWN_ROLES = [
        'developer',
        'admin',
        'principal',
        'supervisor',
        'external-guardian',
        'internal-guardian',
        'admin-assistant',
        'educational-specialist',
        'social-specialist',
        'teacher',
        'viewer'
    ];

    function computeSessionHash(data) {
        const payload = [data.userId, data.role, data.loggedAt].join('|');
        let hash = 0;
        const key = 'gsl_session_integrity_2024';
        const combined = key + ':' + payload;
        for (let i = 0; i < combined.length; i++) {
            const char = combined.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    function normalizeRole(raw) {
        const r = String(raw || '')
            .trim()
            .toLowerCase();
        if (r === 'staff' || r === 'director') return 'principal';
        return KNOWN_ROLES.includes(r) ? r : 'viewer';
    }

    function getAuthSessionData() {
        let raw = null;
        try {
            raw = storage.getItem(AUTH_SESSION_KEY);
        } catch (_err) {
            return null;
        }
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            if (parsed._h !== computeSessionHash(parsed)) {
                return null;
            }
            return parsed;
        } catch (_err) {
            return null;
        }
    }

    function isAuthSessionActive() {
        const data = getAuthSessionData();
        if (!data) return false;

        const loggedAt = Number(data.loggedAt || 0);
        if (!Number.isFinite(loggedAt) || loggedAt <= 0) return false;

        const isExpired = Date.now() - loggedAt > AUTH_SESSION_TTL_MS;
        if (isExpired) {
            try {
                storage.removeItem(AUTH_SESSION_KEY);
            } catch (_err) {
                // ignore
            }
            return false;
        }

        return true;
    }

    function getAuthRole() {
        const session = getAuthSessionData();
        return normalizeRole(session?.role || '');
    }

    function setAuthSession(email, user) {
        const safeUser = user && typeof user === 'object' ? user : {};
        try {
            const sessionData = {
                userId: Number(safeUser.userId || 0),
                name: String(safeUser.name || ''),
                email: String(safeUser.email || email || '')
                    .trim()
                    .toLowerCase(),
                role: normalizeRole(safeUser.role || ''),
                loggedAt: Date.now(),
                source: 'sqlite'
            };
            sessionData._h = computeSessionHash(sessionData);
            storage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionData));
        } catch (_err) {
            // ignore storage write errors
        }
    }

    function clearAuthSession() {
        try {
            storage.removeItem(AUTH_SESSION_KEY);
        } catch (_err) {
            // ignore
        }
    }

    function isAdminRole(role) {
        return String(role || '').toLowerCase() === 'admin';
    }

    function isPrincipalRole(role) {
        return String(role || '').toLowerCase() === 'principal';
    }

    function isDeveloperRole(role) {
        return String(role || '').toLowerCase() === 'developer';
    }

    function isAuthenticatedRole(role) {
        return KNOWN_ROLES.includes(String(role || '').toLowerCase());
    }

    function deriveAuthRoleFromSession(session) {
        if (!session || !isAuthSessionActive()) return null;
        const normalized = normalizeRole(session.role || '');
        return normalized || null;
    }

    function setAppAccessState(state) {
        const doc = global.document;
        if (!doc || !doc.documentElement) return;
        const s = String(state || '').toLowerCase();
        if (['licensed', 'trial', 'blocked'].includes(s)) {
            doc.documentElement.dataset.appAccessState = s;
        } else {
            doc.documentElement.dataset.appAccessState = 'blocked';
        }
    }

    function getAppAccessState() {
        const doc = global.document;
        if (!doc || !doc.documentElement) return 'blocked';
        const value = doc.documentElement.dataset.appAccessState;
        if (value === 'licensed') return 'licensed';
        if (value === 'trial') return 'trial';
        return 'blocked';
    }

    function getCurrentAppRole() {
        const session = getAuthSessionData();
        if (!session || !isAuthSessionActive()) return null;
        const normalized = normalizeRole(session.role || '');
        return normalized || null;
    }

    function getSchoolYear() {
        try {
            return storage.getItem(SCHOOL_YEAR_KEY) || '2025/2026';
        } catch (_err) {
            return '2025/2026';
        }
    }

    function setSchoolYear(newYear) {
        if (!newYear) return;
        try {
            storage.setItem(SCHOOL_YEAR_KEY, newYear);
        } catch (_err) {
            // ignore
        }
        const api = (global.window && global.window.api) || global.api;
        const saveToDb =
            api && api.settings && api.settings.setSchoolYear
                ? api.settings.setSchoolYear(newYear)
                : api && api.settings && api.settings.set
                  ? api.settings.set('currentSchoolYear', newYear)
                  : Promise.resolve();
        Promise.resolve(saveToDb)
            .catch(() => {})
            .finally(() => {
                if (global.window && global.window.location && typeof global.window.location.reload === 'function') {
                    global.window.location.reload();
                }
            });
    }

    async function initSchoolYear() {
        let localYear = null;
        try {
            localYear = storage.getItem(SCHOOL_YEAR_KEY);
        } catch (_err) {
            localYear = null;
        }

        if (!localYear) {
            const api = global.window && global.window.api;
            if (api && api.settings && api.settings.get) {
                try {
                    const dbYear = await api.settings.get('currentSchoolYear');
                    storage.setItem(SCHOOL_YEAR_KEY, dbYear || '2025/2026');
                } catch (e) {
                    console.error('Error fetching school year from DB:', e);
                    try {
                        storage.setItem(SCHOOL_YEAR_KEY, '2025/2026');
                    } catch (_err) {
                        // ignore
                    }
                }
            } else {
                try {
                    storage.setItem(SCHOOL_YEAR_KEY, '2025/2026');
                } catch (_err) {
                    // ignore
                }
            }
        }

        const resolvedYear = getSchoolYear();
        const doc = global.document;
        if (!doc) return resolvedYear;
        const yearSelect = doc.getElementById('school-year');
        if (yearSelect && resolvedYear) {
            let opt = yearSelect.querySelector(`option[value="${resolvedYear}"]`);
            if (!opt) {
                opt = doc.createElement('option');
                opt.value = resolvedYear;
                opt.textContent = resolvedYear;
                yearSelect.insertBefore(opt, yearSelect.firstChild);
            }
            yearSelect.value = resolvedYear;
        }
        return resolvedYear;
    }

    // PencilShared namespace
    PencilShared.AUTH_SESSION_KEY = AUTH_SESSION_KEY;
    PencilShared.AUTH_SESSION_TTL_MS = AUTH_SESSION_TTL_MS;
    PencilShared.SCHOOL_YEAR_KEY = SCHOOL_YEAR_KEY;
    PencilShared.getAuthSessionData = getAuthSessionData;
    PencilShared.isAuthSessionActive = isAuthSessionActive;
    PencilShared.getAuthRole = getAuthRole;
    PencilShared.setAuthSession = setAuthSession;
    PencilShared.clearAuthSession = clearAuthSession;
    PencilShared.normalizeRole = normalizeRole;
    PencilShared.isAdminRole = isAdminRole;
    PencilShared.isPrincipalRole = isPrincipalRole;
    PencilShared.isDeveloperRole = isDeveloperRole;
    PencilShared.isAuthenticatedRole = isAuthenticatedRole;
    PencilShared.deriveAuthRoleFromSession = deriveAuthRoleFromSession;
    PencilShared.setAppAccessState = setAppAccessState;
    PencilShared.getAppAccessState = getAppAccessState;
    PencilShared.getCurrentAppRole = getCurrentAppRole;
    PencilShared.getSchoolYear = getSchoolYear;
    PencilShared.setSchoolYear = setSchoolYear;
    PencilShared.initSchoolYear = initSchoolYear;
    PencilShared.computeSessionHash = computeSessionHash;

    // Bare globals (classic multi-page convention)
    global.getAuthSessionData = getAuthSessionData;
    global.isAuthSessionActive = isAuthSessionActive;
    global.getAuthRole = getAuthRole;
    global.setAuthSession = setAuthSession;
    global.clearAuthSession = clearAuthSession;
    global.getCurrentAppRole = getCurrentAppRole;
    global.setAppAccessState = setAppAccessState;
    global.getAppAccessState = getAppAccessState;
    global.getSchoolYear = getSchoolYear;
    global.setSchoolYear = setSchoolYear;
    global.initSchoolYear = initSchoolYear;

    // Underscore-prefixed names used heavily by js/utils.js
    global._normalizeRole = normalizeRole;
    global._isAdminRole = isAdminRole;
    global._isPrincipalRole = isPrincipalRole;
    global._isDeveloperRole = isDeveloperRole;
    global._isAuthenticatedRole = isAuthenticatedRole;
    global._deriveAuthRoleFromSession = deriveAuthRoleFromSession;
    global._computeSessionHash = computeSessionHash;

    global.AuthSession = {
        isActive: isAuthSessionActive,
        get: getAuthSessionData,
        set: setAuthSession,
        clear: clearAuthSession
    };

    // Node/CommonJS optional export (for unit tests)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            AUTH_SESSION_KEY,
            AUTH_SESSION_TTL_MS,
            SCHOOL_YEAR_KEY,
            getAuthSessionData,
            isAuthSessionActive,
            getAuthRole,
            setAuthSession,
            clearAuthSession,
            normalizeRole,
            isAdminRole,
            isPrincipalRole,
            isDeveloperRole,
            isAuthenticatedRole,
            deriveAuthRoleFromSession,
            setAppAccessState,
            getAppAccessState,
            getCurrentAppRole,
            getSchoolYear,
            setSchoolYear,
            initSchoolYear,
            computeSessionHash
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
