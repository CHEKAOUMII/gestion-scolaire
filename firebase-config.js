// Compatibility auth helpers (SQLite-based)
// الملف بقي بنفس الاسم للحفاظ على التوافق مع الصفحات القديمة

function checkAuthentication(redirectToLogin = true) {
    return new Promise((resolve, reject) => {
        const isActive = !!(window.AuthSession && window.AuthSession.isActive && window.AuthSession.isActive());
        if (!isActive) {
            if (redirectToLogin) {
                window.location.replace('login.html');
            }
            reject(new Error('Not authenticated'));
            return;
        }

        if (window.api?.auth?.getSession) {
            window.api.auth
                .getSession()
                .then((res) => {
                    if (!res?.success || !res?.authenticated) {
                        window.AuthSession?.clear?.();
                        if (redirectToLogin) {
                            window.location.replace('login.html');
                        }
                        reject(new Error('Not authenticated'));
                        return;
                    }
                    resolve(res.user || null);
                })
                .catch((err) => {
                    if (redirectToLogin) {
                        window.location.replace('login.html');
                    }
                    reject(err);
                });
            return;
        }

        resolve(window.AuthSession?.get?.() || null);
    });
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

async function logout() {
    if (!confirm('هل تريد تسجيل الخروج؟')) return;

    if (window.api?.auth?.logout) {
        await window.api.auth.logout();
    }

    try {
        localStorage.removeItem('gsl_auth_session_v1');
        sessionStorage.setItem('justLoggedOut', '1');
    } catch (_err) {
        // ignore storage errors
    }

    window.location.replace('login.html');
}

// showToast is now provided by js/notifications.js (Unified Notification Engine)
