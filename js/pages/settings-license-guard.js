// CH11: thin wrapper — role developer only → index.html
(function enforceDeveloperSession() {
    if (typeof enforceRoleSession === 'function') {
        enforceRoleSession({ roles: ['developer'], redirectTo: 'index.html' });
        return;
    }
    try {
        const raw = localStorage.getItem('gsl_auth_session_v1');
        if (raw) {
            const session = JSON.parse(raw);
            if (session && session.role === 'developer') return;
        }
    } catch {
        /* ignore */
    }
    window.location.replace('index.html');
})();
