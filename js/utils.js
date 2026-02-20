/**
 * Shared Utility Functions
 * ملف الأدوات المشتركة لجميع صفحات برنامج التدبير المدرسي
 */

// ===== App Auth Guard =====
const AUTH_SESSION_KEY = 'gsl_auth_session_v1';
const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const AUTH_ALLOWED_ROLES = new Set(['admin', 'staff', 'viewer']);
const ADMIN_ONLY_PAGES = new Set(['settings-users.html', 'settings-license.html']);
const GUEST_ALLOWED_PAGES = new Set(['index.html', 'students-list.html', 'settings-imports.html', 'login.html']);
const GUEST_ALLOWED_LINKS = new Set(['students-list.html', 'settings-imports.html']);
const BLOCKED_REDIRECT_NOTICE_KEY = 'gsl_blocked_redirect_notice';
const BLOCKED_REDIRECT_NEXT_KEY = 'gsl_blocked_redirect_next';

let _activationModalEl = null;
let _limitedNoticeClosedForPage = false;

function _roleLabel(role) {
    if (role === 'guest') return 'Limited';
    if (role === 'limited') return 'Limited';
    if (role === 'licensed') return 'User';
    const normalized = _normalizeRole(role);
    if (normalized === 'admin') return 'Admin';
    if (normalized === 'viewer') return 'Viewer';
    return 'Staff';
}

function _roleTone(role) {
    if (role === 'guest') return { bg: '#eef2f7', fg: '#3f4b5f', border: '#d3dce8' };
    if (role === 'limited') return { bg: '#eef2f7', fg: '#3f4b5f', border: '#d3dce8' };
    if (role === 'licensed') return { bg: '#e7f7ed', fg: '#0f6a35', border: '#b7e5c8' };
    const normalized = _normalizeRole(role);
    if (normalized === 'admin') return { bg: '#e7f7ed', fg: '#0f6a35', border: '#b7e5c8' };
    if (normalized === 'viewer') return { bg: '#eef2f7', fg: '#3f4b5f', border: '#d3dce8' };
    return { bg: '#fff5e8', fg: '#8a4b00', border: '#f2d6b4' };
}

function _getCurrentPageName() {
    return window.location.pathname.split('/').pop() || 'index.html';
}

function _normalizeRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    return AUTH_ALLOWED_ROLES.has(normalized) ? normalized : 'staff';
}

function getAuthSessionData() {
    let raw = null;
    try {
        raw = localStorage.getItem(AUTH_SESSION_KEY);
    } catch (_err) {
        return null;
    }
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
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
            localStorage.removeItem(AUTH_SESSION_KEY);
        } catch (_err) {
            // ignore storage removal errors
        }
        return false;
    }

    return true;
}

function getAuthRole() {
    const session = getAuthSessionData();
    return _normalizeRole(session?.role || 'staff');
}

function _normalizeHref(href) {
    const value = String(href || '').trim();
    if (!value) return '';
    if (value === '#') return '#';
    return value.split('#')[0].split('?')[0];
}

function _isAdminRole(role) {
    return String(role || '').toLowerCase() === 'admin';
}

function _deriveAppRoleFromSession(session) {
    if (!session || !isAuthSessionActive()) return 'limited';
    return _isAdminRole(_normalizeRole(session.role || 'staff')) ? 'admin' : 'limited';
}

function setCurrentAppRole(role) {
    const normalized = String(role || '').toLowerCase();
    if (_isAdminRole(normalized)) {
        document.documentElement.dataset.currentAppRole = 'admin';
        return;
    }
    if (normalized === 'licensed') {
        document.documentElement.dataset.currentAppRole = 'licensed';
        return;
    }
    document.documentElement.dataset.currentAppRole = 'limited';
}

function getCurrentAppRole() {
    const value = document.documentElement.dataset.currentAppRole;
    if (value === 'admin') return 'admin';
    if (value === 'licensed') return 'licensed';
    return 'limited';
}

function setAuthSession(email = '', user = {}) {
    const safeUser = user && typeof user === 'object' ? user : {};
    try {
        localStorage.setItem(
            AUTH_SESSION_KEY,
            JSON.stringify({
                userId: Number(safeUser.userId || 0),
                name: String(safeUser.name || ''),
                email: String(safeUser.email || email || '')
                    .trim()
                    .toLowerCase(),
                role: _normalizeRole(safeUser.role || 'staff'),
                loggedAt: Date.now(),
                source: 'sqlite'
            })
        );
    } catch (_err) {
        // ignore storage write errors
    }
}

function clearAuthSession() {
    try {
        localStorage.removeItem(AUTH_SESSION_KEY);
    } catch (_err) {
        // ignore storage removal errors
    }
}

function _isSidebarLinkBlocked(href, role) {
    if (_isAdminRole(role)) return false;
    const normalizedHref = _normalizeHref(href);
    if (!normalizedHref || normalizedHref === '#') return false;

    if (String(role || '').toLowerCase() === 'licensed') {
        return ADMIN_ONLY_PAGES.has(normalizedHref);
    }

    return !GUEST_ALLOWED_LINKS.has(normalizedHref);
}

function applyNavigationRestrictions(role) {
    const isAdmin = _isAdminRole(role);

    document.querySelectorAll('.sidebar-nav a[href]').forEach((link) => {
        if (!link.dataset.limitedGuardBound) {
            link.addEventListener('click', (event) => {
                const mode = getCurrentAppRole();
                if (!_isSidebarLinkBlocked(link.getAttribute('href'), mode)) return;
                event.preventDefault();
                event.stopPropagation();
                const message =
                    mode === 'licensed'
                        ? 'هذه الصفحة مخصصة للمشرف (Admin)'
                        : 'الوصول في الوضع المحدود متاح فقط لصفحتي اللوائح والاستيراد';
                showToast(message, 'warning');
            });
            link.dataset.limitedGuardBound = '1';
        }

        const href = _normalizeHref(link.getAttribute('href'));
        const isAdminOnlyPage = ADMIN_ONLY_PAGES.has(href);
        const blocked = _isSidebarLinkBlocked(link.getAttribute('href'), role);
        const listItem = link.closest('li');

        // Completely hide admin-only pages for non-admin users
        if (isAdminOnlyPage && !isAdmin) {
            if (listItem) listItem.style.display = 'none';
            return;
        } else if (isAdminOnlyPage && isAdmin) {
            if (listItem) listItem.style.display = '';
        }

        if (blocked) {
            link.style.opacity = '0.45';
            link.style.filter = 'grayscale(0.5)';
            link.style.cursor = 'not-allowed';
            link.setAttribute('title', 'مغلق في الوضع المحدود');
        } else {
            link.style.opacity = '';
            link.style.filter = '';
            link.style.cursor = '';
            link.setAttribute('title', '');
        }
    });
}

function applySessionToUI(session, roleOverride = null) {
    const safe = session && typeof session === 'object' ? session : {};
    const effectiveRole = roleOverride || _deriveAppRoleFromSession(session);
    const isAdmin = _isAdminRole(effectiveRole);
    const isLicensed = String(effectiveRole || '').toLowerCase() === 'licensed';
    const displayName = isAdmin
        ? String(safe.name || safe.email || 'المشرف').trim() || 'المشرف'
        : isLicensed
            ? 'مستخدم مرخص'
            : 'مستخدم محدود';
    const role = isAdmin ? _normalizeRole(safe.role || 'admin') : isLicensed ? 'licensed' : 'limited';
    const tone = _roleTone(role);

    document.querySelectorAll('[id="user-email"]').forEach((node) => {
        node.textContent = displayName;
        const container = node.closest('.user-info') || node.parentElement;
        if (!container) return;

        let badge = container.querySelector('[data-role-badge="1"]');
        if (!badge) {
            badge = document.createElement('span');
            badge.setAttribute('data-role-badge', '1');
            badge.style.cssText =
                'margin-inline-start:8px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid transparent;';
            container.appendChild(badge);
        }

        badge.textContent = _roleLabel(role);
        badge.style.background = tone.bg;
        badge.style.color = tone.fg;
        badge.style.borderColor = tone.border;
    });
}

function redirectToLoginPage() {
    const next = encodeURIComponent(_getCurrentPageName());
    window.location.replace(`login.html?next=${next}`);
}

function redirectToIndexPage() {
    window.location.replace('index.html');
}

function enforcePageRoleOrRedirect(role) {
    const currentPage = _getCurrentPageName();
    const isAdmin = _isAdminRole(role);

    if (isAdmin) return true;

    const mode = String(role || '').toLowerCase();

    if (mode === 'licensed') {
        if (ADMIN_ONLY_PAGES.has(currentPage)) {
            try {
                sessionStorage.setItem(BLOCKED_REDIRECT_NOTICE_KEY, currentPage);
            } catch (_err) {
                // ignore
            }
            redirectToIndexPage();
            return false;
        }
        return true;
    }

    if (!GUEST_ALLOWED_PAGES.has(currentPage)) {
        try {
            sessionStorage.setItem(BLOCKED_REDIRECT_NOTICE_KEY, currentPage);
            sessionStorage.setItem(BLOCKED_REDIRECT_NEXT_KEY, currentPage);
        } catch (_err) {
            // ignore
        }
        redirectToIndexPage();
        return false;
    }

    if (ADMIN_ONLY_PAGES.has(currentPage)) {
        redirectToIndexPage();
        return false;
    }

    return true;
}

function _removeLimitedNotice() {
    const banner = document.getElementById('limited-mode-banner');
    if (banner) banner.remove();
}

function _dismissLimitedNotice() {
    _limitedNoticeClosedForPage = true;
    _removeLimitedNotice();
}

function _ensureActivationModal() {
    if (_activationModalEl && document.body.contains(_activationModalEl)) return _activationModalEl;

    const modal = document.createElement('div');
    modal.id = 'activation-modal-overlay';
    modal.style.cssText =
        'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.55);z-index:10060;padding:16px;';
    modal.innerHTML = `
        <div style="width:min(680px,95vw);background:#fff;border-radius:14px;box-shadow:0 20px 40px rgba(0,0,0,.2);overflow:hidden;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #e5e7eb;">
                <h3 style="margin:0;font-size:18px;color:#111827;"><i class="fas fa-key"></i> تفعيل البرنامج</h3>
                <button type="button" id="activation-close-btn" style="border:none;background:transparent;font-size:18px;cursor:pointer;color:#6b7280;"><i class="fas fa-times"></i></button>
            </div>
            <div style="padding:16px;display:grid;gap:10px;">
                <p style="margin:0;color:#4b5563;font-size:13px;">أرسل رمز الجهاز التالي لمسؤول التراخيص للحصول على السيريال الخاص بهذا الجهاز.</p>
                <input id="activation-device-code" readonly style="direction:ltr;font-family:ui-monospace,Consolas,monospace;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#f9fafb;">
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" id="activation-copy-btn" class="btn btn-secondary"><i class="fas fa-copy"></i> نسخ الرمز</button>
                </div>
                <input id="activation-serial-input" type="text" placeholder="ألصق السيريال هنا" style="direction:ltr;padding:10px;border:1px solid #d1d5db;border-radius:8px;">
                <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
                    <button type="button" id="activation-cancel-btn" class="btn btn-secondary">إغلاق</button>
                    <button type="button" id="activation-submit-btn" class="btn btn-success"><i class="fas fa-check"></i> تفعيل</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    _activationModalEl = modal;

    const close = () => {
        modal.style.display = 'none';
    };

    modal.querySelector('#activation-close-btn')?.addEventListener('click', close);
    modal.querySelector('#activation-cancel-btn')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) close();
    });

    modal.querySelector('#activation-copy-btn')?.addEventListener('click', async () => {
        const deviceCode = modal.querySelector('#activation-device-code')?.value || '';
        if (!deviceCode) return;
        try {
            await navigator.clipboard.writeText(deviceCode);
        } catch (_err) {
            const input = modal.querySelector('#activation-device-code');
            if (input) {
                input.select();
                document.execCommand('copy');
            }
        }
        showToast('تم نسخ رمز الجهاز', 'success');
    });

    modal.querySelector('#activation-submit-btn')?.addEventListener('click', async () => {
        const serialInput = modal.querySelector('#activation-serial-input');
        const licenseKey = String(serialInput?.value || '').trim();
        if (!licenseKey) {
            showToast('الرجاء إدخال السيريال', 'warning');
            return;
        }

        const reqRes = await window.api.licensing.getActivationRequest();
        const res = await window.api.licensing.activatePublic({
            licenseKey,
            deviceName: reqRes?.deviceName || ''
        });

        if (!res?.success) {
            showToast(res?.error || 'فشل التفعيل', 'error');
            return;
        }

        if (serialInput) serialInput.value = '';
        showToast('تم تفعيل البرنامج بنجاح', 'success');
        close();
        refreshLimitedModeNotice(getCurrentAppRole());
    });

    return modal;
}

async function openActivationModal() {
    if (!window.api?.licensing?.getActivationRequest || !window.api?.licensing?.activatePublic) {
        showToast('تعذر تهيئة التفعيل في هذه الصفحة', 'error');
        return;
    }

    const modal = _ensureActivationModal();
    modal.style.display = 'flex';

    const reqRes = await window.api.licensing.getActivationRequest();
    const codeInput = modal.querySelector('#activation-device-code');
    if (codeInput) {
        codeInput.value = reqRes?.success ? reqRes.deviceCode || '' : '';
    }
}

function ensureLimitedModeNotice(role, activationStatus = null) {
    const mode = String(role || '').toLowerCase();
    if (_isAdminRole(mode) || mode === 'licensed') {
        _limitedNoticeClosedForPage = false;
        _removeLimitedNotice();
        return;
    }
    if (_limitedNoticeClosedForPage) {
        _removeLimitedNotice();
        return;
    }

    const mainContent = document.querySelector('main.main-content');
    if (!mainContent) return;

    const isActivated = !!activationStatus?.activated;
    const existing = document.getElementById('limited-mode-banner');
    const html = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <i class="fas fa-info-circle"></i>
                <span>${isActivated ? 'الوضع المحدود مفعل: المسموح فقط لوائح التلاميذ واستيراد البيانات.' : 'الوضع المحدود مفعل: فعّل البرنامج بالسيريال، والمسموح فقط لوائح التلاميذ واستيراد البيانات.'}</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                ${isActivated ? '' : '<button type="button" id="limited-activate-btn" class="btn btn-warning" style="padding:6px 10px;font-size:12px;"><i class="fas fa-key"></i> تفعيل البرنامج</button>'}
                <button type="button" id="limited-close-btn" class="btn btn-secondary" style="padding:6px 10px;font-size:12px;">إغلاق</button>
            </div>
        </div>
    `;

    if (existing) {
        existing.innerHTML = html;
    } else {
        const banner = document.createElement('div');
        banner.id = 'limited-mode-banner';
        banner.style.cssText =
            'margin:14px 20px 0 20px;padding:10px 12px;border:1px dashed #f59e0b;background:#fff8e8;color:#7a4b0e;border-radius:10px;font-weight:600;font-size:13px;';
        banner.innerHTML = html;

        const header = mainContent.querySelector(':scope > .header');
        if (header) {
            header.insertAdjacentElement('afterend', banner);
        } else {
            mainContent.insertAdjacentElement('afterbegin', banner);
        }
    }

    document.getElementById('limited-close-btn')?.addEventListener('click', _dismissLimitedNotice);
    document.getElementById('limited-activate-btn')?.addEventListener('click', () => {
        void openActivationModal();
    });
}

function refreshLimitedModeNotice(role) {
    const mode = String(role || '').toLowerCase();
    if (_isAdminRole(mode) || mode === 'licensed') {
        _removeLimitedNotice();
        return;
    }

    if (!window.api?.licensing?.getPublicStatus) {
        ensureLimitedModeNotice(role, { activated: false });
        return;
    }

    window.api.licensing
        .getPublicStatus()
        .then((res) => {
            const isActivated = !!(res?.success && res.activated);
            if (isActivated) {
                if (getCurrentAppRole() !== 'licensed') {
                    const session = isAuthSessionActive() ? getAuthSessionData() : null;
                    applyRoleUi('licensed', session);
                } else {
                    _removeLimitedNotice();
                }
                return;
            }

            if (getCurrentAppRole() !== 'limited') {
                const session = isAuthSessionActive() ? getAuthSessionData() : null;
                applyRoleUi('limited', session);
                return;
            }

            ensureLimitedModeNotice('limited', res || { activated: false });
        })
        .catch(() => {
            if (getCurrentAppRole() !== 'limited') {
                const session = isAuthSessionActive() ? getAuthSessionData() : null;
                applyRoleUi('limited', session);
                return;
            }
            ensureLimitedModeNotice('limited', { activated: false });
        });
}

function ensureAdminAuthButton(role) {
    const currentPage = _getCurrentPageName();
    if (currentPage === 'login.html') return;

    const header = document.querySelector('main.main-content > .header') || document.querySelector('.header');
    if (!header) return;

    const target = header.querySelector('.header-right') || header;
    let btn = header.querySelector('[data-admin-auth-btn="1"]');
    let activateBtn = header.querySelector('[data-activate-link-btn="1"]');

    if (!activateBtn) {
        activateBtn = document.createElement('button');
        activateBtn.type = 'button';
        activateBtn.className = 'theme-toggle';
        activateBtn.setAttribute('data-activate-link-btn', '1');
        activateBtn.style.cssText = 'padding:8px 14px;display:flex;align-items:center;gap:6px;width:auto;height:auto;white-space:nowrap;font-size:13px;';
        activateBtn.innerHTML = '<i class="fas fa-key"></i><span>تفعيل البرنامج</span>';
        activateBtn.title = 'فتح نموذج التفعيل';
        activateBtn.addEventListener('click', () => {
            void openActivationModal();
        });
        target.appendChild(activateBtn);
    }

    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-toggle';
        btn.setAttribute('data-admin-auth-btn', '1');
        btn.style.cssText = 'padding:8px 14px;display:flex;align-items:center;gap:6px;width:auto;height:auto;white-space:nowrap;font-size:13px;';
        target.appendChild(btn);
        btn.addEventListener('click', async () => {
            const currentRole = getCurrentAppRole();
            if (_isAdminRole(currentRole)) {
                if (window.api?.auth?.logout) {
                    await window.api.auth.logout();
                }
                clearAuthSession();
                window.location.replace('index.html');
                return;
            }

            let requestedNext = _getCurrentPageName();
            try {
                const stored = sessionStorage.getItem(BLOCKED_REDIRECT_NEXT_KEY);
                if (stored && /^[a-zA-Z0-9._-]+\.html$/.test(stored)) {
                    requestedNext = stored;
                }
            } catch (_err) {
                // ignore
            }

            const next = encodeURIComponent(requestedNext);
            window.location.href = `login.html?next=${next}`;
        });
    }

    if (_isAdminRole(role)) {
        if (activateBtn) activateBtn.style.display = 'none';
        btn.innerHTML = '<i class="fas fa-sign-out-alt"></i><span>خروج المشرف</span>';
        btn.title = 'خروج المشرف';
    } else {
        if (activateBtn) activateBtn.style.display = String(role || '').toLowerCase() === 'limited' ? '' : 'none';
        btn.innerHTML = '<i class="fas fa-user-shield"></i><span>دخول المشرف</span>';
        btn.title = 'دخول المشرف';
    }
}

function showPendingBlockedPageToast() {
    try {
        const blockedPage = sessionStorage.getItem(BLOCKED_REDIRECT_NOTICE_KEY);
        if (!blockedPage) return;
        sessionStorage.removeItem(BLOCKED_REDIRECT_NOTICE_KEY);
        showToast(`الصفحة ${blockedPage} غير متاحة في الوضع المحدود`, 'warning');
    } catch (_err) {
        // ignore
    }
}

async function resolvePublicAccessMode() {
    if (!window.api?.licensing?.getPublicStatus) return 'limited';
    try {
        const res = await window.api.licensing.getPublicStatus();
        if (res?.success && res.activated) return 'licensed';
    } catch (_err) {
        // ignore and fallback to limited mode
    }
    return 'limited';
}

function applyRoleUi(role, session) {
    setCurrentAppRole(role);

    if (_isAdminRole(role) || String(role || '').toLowerCase() === 'licensed') {
        try {
            sessionStorage.removeItem(BLOCKED_REDIRECT_NEXT_KEY);
        } catch (_err) {
            // ignore
        }
    }

    applySessionToUI(session, role);
    applyNavigationRestrictions(role);
    ensureAdminAuthButton(role);
    refreshLimitedModeNotice(role);
    showPendingBlockedPageToast();

    setTimeout(() => {
        const currentRole = getCurrentAppRole();
        applyNavigationRestrictions(currentRole);
        ensureAdminAuthButton(currentRole);
        refreshLimitedModeNotice(currentRole);
    }, 120);
}

(async function enforceProtectedPagesAuth() {
    const currentPage = _getCurrentPageName();
    if (currentPage === 'login.html') return;

    let session = isAuthSessionActive() ? getAuthSessionData() : null;
    let mode = _deriveAppRoleFromSession(session);

    if (window.api?.auth?.getSession) {
        try {
            const authRes = await window.api.auth.getSession();
            if (authRes?.success && authRes?.authenticated && _isAdminRole(_normalizeRole(authRes.user?.role || 'staff'))) {
                session = authRes.user || {};
                setAuthSession(session.email || '', session);
                mode = 'admin';
            } else {
                clearAuthSession();
                session = null;
            }
        } catch (_err) {
            clearAuthSession();
            session = null;
        }
    }

    if (!_isAdminRole(mode)) {
        mode = await resolvePublicAccessMode();
    }

    if (!enforcePageRoleOrRedirect(mode)) {
        return;
    }

    applyRoleUi(mode, session);

    const params = new URLSearchParams(window.location.search);
    if (params.has('loggedin')) {
        params.delete('loggedin');
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, '', nextUrl);
    }
})();

window.AuthSession = {
    isActive: isAuthSessionActive,
    get: getAuthSessionData,
    set: setAuthSession,
    clear: clearAuthSession
};

// ===== XSS Protection =====
/**
 * حماية النص من هجمات XSS
 * @param {string} text - النص المراد تأمينه
 * @returns {string} - النص الآمن
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// ===== Toast Messages =====
/**
 * عرض رسالة Toast
 * @param {string} message - نص الرسالة
 * @param {string} type - نوع الرسالة: 'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - مدة الظهور بالمللي ثانية (افتراضي: 3000)
 */
function showToast(message, type = 'success', duration = 3000) {
    // إنشاء container إذا لم يكن موجوداً
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // إنشاء Toast جديد مع حماية XSS
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = document.createElement('i');
    const iconClass = {
        'success': 'fa-check-circle',
        'error': 'fa-exclamation-circle',
        'warning': 'fa-exclamation-triangle',
        'info': 'fa-info-circle'
    };
    icon.className = `fas ${iconClass[type] || iconClass.info}`;

    const span = document.createElement('span');
    span.textContent = message; // آمن من XSS

    toast.appendChild(icon);
    toast.appendChild(span);
    container.appendChild(toast);

    // إزالة Toast بعد المدة المحددة
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ===== Date Formatting =====
/**
 * تنسيق التاريخ بالعربية
 * @param {Date|string} date - التاريخ
 * @param {string} format - التنسيق: 'short' | 'long' | 'time' | 'datetime'
 * @returns {string} - التاريخ المنسق
 */
function formatDate(date, format = 'short') {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';

    const arabicMonths = [
        'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];

    const arabicDays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    switch (format) {
        case 'short':
            return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        case 'long':
            return `${arabicDays[d.getDay()]} ${d.getDate()} ${arabicMonths[d.getMonth()]} ${d.getFullYear()}`;
        case 'time':
            return d.toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' });
        case 'datetime':
            return `${d.getDate()} ${arabicMonths[d.getMonth()]} ${d.getFullYear()} - ${d.toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' })}`;
        default:
            return d.toLocaleDateString('ar-MA');
    }
}

// ===== Number Formatting =====
/**
 * تنسيق الأرقام بالفواصل
 * @param {number} num - الرقم
 * @returns {string} - الرقم المنسق
 */
function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    return num.toLocaleString('ar-MA');
}

/**
 * تنسيق المعدل مع لونه
 * @param {number} average - المعدل
 * @returns {object} - {value, class}
 */
function formatAverage(average) {
    if (average === null || average === undefined || isNaN(average)) {
        return { value: '--', class: '' };
    }

    const value = average.toFixed(2);
    let className = '';

    if (average >= 14) className = 'excellent';
    else if (average >= 12) className = 'good';
    else if (average >= 10) className = 'average';
    else className = 'poor';

    return { value, class: className };
}

// ===== Sidebar Setup =====
/**
 * إعداد الشريط الجانبي
 */
function setupSidebar() {
    // Toggle sidebar
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.style.marginRight = sidebar.classList.contains('collapsed') ? '80px' : '280px';
            }
        });
    }

    // Expandable menu items
    document.querySelectorAll('.expandable > .nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            link.parentElement.classList.toggle('open');
        });
    });

    // Check for current page to mark active
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.sidebar-nav a').forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage) {
            link.classList.add('active');
            // Also open parent menu if exists
            const parent = link.closest('.expandable');
            if (parent) {
                parent.classList.add('open');
            }
        }
    });
}

// ===== Shared Top Bar =====
/**
 * توحيد شريط الهيدر في جميع الصفحات
 */
function setupUnifiedHeader() {
    const currentPage = window.location.pathname.split('/').pop() || '';
    if (currentPage === 'login.html') return;

    const mainContent = document.querySelector('main.main-content');
    if (!mainContent) return;

    const header = mainContent.querySelector(':scope > .header');
    if (!header || header.dataset.unifiedHeader === 'true') return;

    // Extract the page title before rebuilding the header
    const existingTitle = header.querySelector('h1, h2, h3');
    const titleText = existingTitle ? existingTitle.textContent.replace(/\s+/g, ' ').trim() : '';
    const titleIcon = existingTitle?.querySelector('i')?.className || '';
    const hasSidebar = !!document.getElementById('sidebar');

    header.classList.add('unified-header');
    header.innerHTML = `
        <div class="header-left">
            <div class="user-info" id="user-info">
                <span id="user-email">المستخدم</span>
            </div>
            <button class="notification-btn" title="الإشعارات">
                <i class="fas fa-bell"></i>
                <span class="badge">3</span>
            </button>
            <button class="backup-btn" id="backup-btn" title="النسخ الاحتياطي">
                <i class="fas fa-database"></i>
            </button>
            <select id="school-year" title="الموسم الدراسي">
                <option value="2025/2026" selected>2025/2026</option>
            </select>
            <button class="theme-toggle" id="theme-toggle" title="تبديل المظهر">
                <i class="fas fa-moon"></i>
            </button>
        </div>
        <div class="header-right">
            <div class="search-box">
                <input type="text" placeholder="بحث...">
                <i class="fas fa-search"></i>
            </div>
            <button class="menu-toggle" id="menu-toggle" title="${hasSidebar ? 'القائمة' : 'الصفحة الرئيسية'}">
                <i class="fas fa-bars"></i>
            </button>
        </div>
    `;
    header.dataset.unifiedHeader = 'true';

    if (!hasSidebar) {
        mainContent.classList.add('standalone-page');
        const menuToggle = header.querySelector('#menu-toggle');
        if (menuToggle) {
            menuToggle.addEventListener('click', () => {
                window.location.href = 'index.html';
            });
        }
    }

    const existingTitleRow = mainContent.querySelector(':scope > .page-title-row');
    if (!existingTitleRow && titleText) {
        const titleRow = document.createElement('div');
        titleRow.className = 'page-title-row';
        titleRow.innerHTML = `
            <h2>
                ${titleIcon ? `<i class="${escapeHtml(titleIcon)}"></i>` : ''}
                <span>${escapeHtml(titleText)}</span>
            </h2>
        `;
        header.insertAdjacentElement('afterend', titleRow);
    }
}

// ===== LocalStorage Helpers =====
/**
 * حفظ البيانات في localStorage مع التعامل مع الأخطاء
 * @param {string} key - مفتاح التخزين
 * @param {*} data - البيانات المراد حفظها
 * @returns {boolean} - نجاح العملية
 */
function saveToStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
        return true;
    } catch (e) {
        console.error('Error saving to localStorage:', e);
        return false;
    }
}

/**
 * استرجاع البيانات من localStorage
 * @param {string} key - مفتاح التخزين
 * @param {*} defaultValue - القيمة الافتراضية
 * @returns {*} - البيانات المسترجعة
 */
function loadFromStorage(key, defaultValue = null) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : defaultValue;
    } catch (e) {
        console.error('Error loading from localStorage:', e);
        return defaultValue;
    }
}

// ===== Debounce Helper =====
/**
 * تأخير تنفيذ الدالة (مفيد للبحث)
 * @param {Function} func - الدالة
 * @param {number} wait - وقت الانتظار
 * @returns {Function}
 */
function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ===== Auto-init =====
document.addEventListener('DOMContentLoaded', () => {
    setupUnifiedHeader();
    setupSidebar();

    const session = isAuthSessionActive() ? getAuthSessionData() : null;
    const role = getCurrentAppRole();
    applyRoleUi(role, session);
});

// Export for module usage (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml,
        showToast,
        formatDate,
        formatNumber,
        formatAverage,
        setupUnifiedHeader,
        setupSidebar,
        saveToStorage,
        loadFromStorage,
        debounce
    };
}
