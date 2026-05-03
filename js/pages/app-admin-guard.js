(function enforceAppAdminSession() {
    try {
        const raw = localStorage.getItem('gsl_auth_session_v1');
        if (raw) {
            const session = JSON.parse(raw);
            if (session && (session.role === 'developer' || session.role === 'admin')) {
                return;
            }
        }
    } catch {}

    window.location.replace('dashboard.html');
})();
