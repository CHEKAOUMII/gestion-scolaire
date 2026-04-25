(async function enforcePageAccess() {
    if (!window.api?.auth?.getAllowedPages) return;
    try {
        const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
        // Pages that don't require page-level access control
        const EXEMPT_PAGES = ['login', 'dashboard', 'index'];
        if (!currentPage || EXEMPT_PAGES.includes(currentPage)) return;

        const allowed = await window.api.auth.getAllowedPages();
        if (!Array.isArray(allowed)) return; // not logged in — login.html handles that
        if (!allowed.includes(currentPage)) {
            window.location.replace('index.html');
        }
    } catch {
        // silently ignore — don't lock users out on error
    }
})();
