/**
 * role-session-guard.js — Shared client session role gate (CH11)
 *
 * Dual-export for tests; HTML loads this **without defer** before thin guard scripts.
 *
 * KD9 matrix (redirect + roles preserved as config, not silent merge):
 *
 * | Guard file | Allowed roles | Redirect (was) | Redirect (now) |
 * |------------|---------------|----------------|----------------|
 * | app-admin-guard | developer, admin | dashboard.html (missing) | index.html |
 * | settings-defaults-guard | developer, admin | index.html | index.html |
 * | settings-users-guard | developer, admin, principal | dashboard.html (missing) | index.html |
 * | settings-license-guard | developer | dashboard.html (missing) | index.html |
 *
 * Note: `dashboard.html` does not exist in this app (dashboard is `index.html`).
 * Unifying failed redirects onto `index.html` is a fix, not a privilege change.
 * Main-process IPC role checks remain the real enforcement boundary.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.AUTH_SESSION_KEY = api.AUTH_SESSION_KEY;
        root.readAuthSession = api.readAuthSession;
        root.sessionHasAnyRole = api.sessionHasAnyRole;
        root.enforceRoleSession = api.enforceRoleSession;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const AUTH_SESSION_KEY = 'gsl_auth_session_v1';
    const DEFAULT_REDIRECT = 'index.html';

    function readAuthSession(storage) {
        try {
            const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
            if (!store || typeof store.getItem !== 'function') return null;
            const raw = store.getItem(AUTH_SESSION_KEY);
            if (!raw) return null;
            const session = JSON.parse(raw);
            return session && typeof session === 'object' ? session : null;
        } catch {
            return null;
        }
    }

    function sessionHasAnyRole(session, roles) {
        if (!session || !session.role) return false;
        const allowed = Array.isArray(roles) ? roles : [];
        return allowed.includes(session.role);
    }

    /**
     * @param {object} options
     * @param {string[]} options.roles - Allowed session.role values
     * @param {string} [options.redirectTo='index.html']
     * @param {Storage} [options.storage] - inject for tests
     * @param {function} [options.redirect] - inject for tests (url) => void
     * @returns {boolean} true if allowed to stay
     */
    function enforceRoleSession(options) {
        const opts = options || {};
        const roles = Array.isArray(opts.roles) ? opts.roles : [];
        const redirectTo = opts.redirectTo || DEFAULT_REDIRECT;
        const session = readAuthSession(opts.storage);
        if (sessionHasAnyRole(session, roles)) {
            return true;
        }
        const go = typeof opts.redirect === 'function' ? opts.redirect : null;
        if (go) {
            go(redirectTo);
        } else if (typeof window !== 'undefined' && window.location && typeof window.location.replace === 'function') {
            window.location.replace(redirectTo);
        }
        return false;
    }

    return {
        AUTH_SESSION_KEY,
        DEFAULT_REDIRECT,
        readAuthSession,
        sessionHasAnyRole,
        enforceRoleSession
    };
});
