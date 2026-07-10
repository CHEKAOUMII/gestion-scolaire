// CH11: thin wrapper — roles developer|admin → index.html
(function enforceAppAdminSession() {
    if (typeof enforceRoleSession === 'function') {
        enforceRoleSession({ roles: ['developer', 'admin'], redirectTo: 'index.html' });
        return;
    }
    // Fallback if shared module failed to load
    try {
        const raw = localStorage.getItem('gsl_auth_session_v1');
        if (raw) {
            const session = JSON.parse(raw);
            if (session && (session.role === 'developer' || session.role === 'admin')) return;
        }
    } catch {
        /* ignore */
    }
    window.location.replace('index.html');
})();
