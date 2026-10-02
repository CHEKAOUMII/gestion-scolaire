// CH11: thin wrapper — roles developer|admin|principal → index.html
(function enforceDeveloperOrAdminSession() {
    if (typeof enforceRoleSession === 'function') {
        enforceRoleSession({
            roles: ['developer', 'admin', 'principal'],
            redirectTo: 'index.html'
        });
        return;
    }
    try {
        const raw = localStorage.getItem('gsl_auth_session_v1');
        if (raw) {
            const session = JSON.parse(raw);
            if (
                session &&
                (session.role === 'developer' || session.role === 'admin' || session.role === 'principal')
            ) {
                return;
            }
        }
    } catch {
        /* ignore */
    }
    window.location.replace('index.html');
})();
