/**
 * theme-boot.js — apply persisted theme before paint (no FOUC).
 * Load synchronously in <head> without defer/async, before CSS if possible.
 * Full theme UI (icons, meta) is handled later by ux-enhancements.js.
 */
(function () {
    try {
        var t = localStorage.getItem('app-theme') || 'light';
        document.documentElement.setAttribute('data-theme', t);
    } catch (e) {
        /* ignore */
    }
})();
