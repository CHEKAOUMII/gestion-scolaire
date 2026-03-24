/**
 * Shared Utility Functions
 * ملف الأدوات المشتركة لجميع صفحات برنامج التدبير المدرسي
 */

// ===== App Auth Guard =====
const AUTH_SESSION_KEY = 'gsl_auth_session_v1';
const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_ONLY_PAGES = new Set(['settings-users.html', 'settings-license.html']);
const GUEST_ALLOWED_PAGES = new Set(['index.html', 'students-list.html', 'settings-imports.html', 'login.html']);
const GUEST_ALLOWED_LINKS = new Set(['students-list.html', 'settings-imports.html']);
const BLOCKED_REDIRECT_NOTICE_KEY = 'gsl_blocked_redirect_notice';
const BLOCKED_REDIRECT_NEXT_KEY = 'gsl_blocked_redirect_next';
const PAGE_VISIBILITY_BLOCKED_NOTICE_KEY = 'gsl_page_visibility_blocked_notice';

const PAGE_VISIBILITY_CATALOG = Object.freeze([
    { page: 'index.html', title: 'لوحة التحكم', group: 'عام', completed: true },
    { page: 'students-list.html', title: 'لوائح التلاميذ', group: 'التلاميذ', completed: true },
    { page: 'students-register.html', title: 'التسجيل والحركة العامة', group: 'التلاميذ', completed: true },
    { page: 'students-files.html', title: 'ترتيب الملفات', group: 'التلاميذ', completed: true },
    { page: 'students-movement.html', title: 'حركية التلاميذ', group: 'التلاميذ', completed: true },
    { page: 'teachers-list.html', title: 'قائمة الأساتذة', group: 'تدبير الموظفين', completed: true },
    { page: 'teachers-schedule.html', title: 'حصص الأساتذة', group: 'تدبير الموظفين', completed: true },
    { page: 'teachers-absence.html', title: 'غياب الأساتذة', group: 'تدبير الموظفين', completed: true },
    { page: 'teachers-performance.html', title: 'مؤشرات الأداء', group: 'تدبير الموظفين', completed: true },
    { page: 'staff-attendance.html', title: 'الحضور والغياب', group: 'تدبير الموظفين', completed: true },
    { page: 'staff-daily-report.html', title: 'التقرير اليومي', group: 'تدبير الموظفين', completed: true },
    { page: 'timetable.html', title: 'جداول الحصص', group: 'الاستعمال الزمني', completed: true },
    { page: 'timetable-redistribution.html', title: 'إعادة توزيع الأقسام', group: 'الاستعمال الزمني', completed: true },
    { page: 'timetable-students.html', title: 'جدول حصص التلاميذ', group: 'الاستعمال الزمني', completed: true },
    { page: 'timetable-rooms.html', title: 'جدول القاعات', group: 'الاستعمال الزمني', completed: true },
    { page: 'timetable-teachers.html', title: 'جدول حصص الأساتذة', group: 'الاستعمال الزمني', completed: true },
    { page: 'grades.html', title: 'النتائج والإحصائيات', group: 'التقويم والنتائج', completed: true },
    { page: 'analytics.html', title: 'تحليل النتائج', group: 'التقويم والنتائج', completed: true },
    { page: 'grades-sheets.html', title: 'أوراق التنقيط', group: 'التقويم والنتائج', completed: true },
    { page: 'studentzero.html', title: 'التلاميذ الحاصلون على صفر', group: 'التقويم والنتائج', completed: true },
    { page: 'student-support.html', title: 'الدعم التربوي', group: 'التقويم والنتائج', completed: true },
    { page: 'absence-weekly.html', title: 'ورقة الغياب الأسبوعية', group: 'الغياب والمتابعة', completed: true },
    { page: 'absence-students.html', title: 'غياب التلاميذ', group: 'الغياب والمتابعة', completed: true },
    { page: 'absence-correspondence.html', title: 'مراسلة الأولياء', group: 'الغياب والمتابعة', completed: true },
    { page: 'absence-analytics.html', title: 'إحصائيات الغياب', group: 'الغياب والمتابعة', completed: true },
    { page: 'exams-schedule.html', title: 'برمجة الامتحانات', group: 'مركز الامتحانات', completed: true },
    { page: 'exams-proctors.html', title: 'توزيع الحراسة', group: 'مركز الامتحانات', completed: true },
    { page: 'exams-rooms.html', title: 'قاعات الامتحان', group: 'مركز الامتحانات', completed: true },
    { page: 'exams-tests.html', title: 'تدبير الفروض', group: 'مركز الامتحانات', completed: true },
    { page: 'reports-certificates.html', title: 'الشواهد المدرسية', group: 'التقارير والوثائق', completed: true },
    { page: 'reports-forms.html', title: 'الاستمارات الإدارية', group: 'التقارير والوثائق', completed: true },
    { page: 'reports-semester.html', title: 'تقارير الفصل', group: 'التقارير والوثائق', completed: true },
    { page: 'settings-school.html', title: 'معلومات المؤسسة', group: 'الإعدادات', completed: true },
    { page: 'settings-imports.html', title: 'استيراد البيانات', group: 'الإعدادات', completed: true },
    { page: 'settings-users.html', title: 'المستخدمون', group: 'الإعدادات', completed: true },
    { page: 'settings-license.html', title: 'الترخيص والأجهزة', group: 'الإعدادات', completed: true },
    { page: 'settings-logs.html', title: 'سجل النشاطات', group: 'الإعدادات', completed: true },
    { page: 'student-profile-prototype.html', title: 'ملف التلميذ', group: 'التلاميذ', completed: false },
    {
        page: 'communication-center-prototype.html',
        title: 'مركز التواصل (جديد)',
        group: 'التصاميم الجديدة',
        completed: false
    }
]);

const PAGE_DEFAULT_VISIBILITY = Object.freeze(
    PAGE_VISIBILITY_CATALOG.reduce((acc, entry) => {
        acc[entry.page] = entry.completed !== false;
        return acc;
    }, {})
);

const MANAGED_PAGE_SET = new Set(Object.keys(PAGE_DEFAULT_VISIBILITY));

const TRIAL_BANNER_DISMISSED_KEY = 'trial_banner_dismissed';
const TRIAL_BANNER_SHOWN_ON_OPEN_KEY = 'trial_banner_shown_on_open';

// ── Separated State Model ──
// appAccessState: 'blocked' | 'trial' | 'licensed'  (from licensing, never a role)
// authState: 'anonymous' | 'authenticated'           (from session)
// userRole: 'admin' | 'staff' | 'viewer' | null      (only real DB roles)
// sessionLockState: 'unlocked' | 'locked'             (PIN lock)
const LEGACY_PSEUDO_ROLES = new Set(['limited', 'guest', 'trial', 'licensed']);

let _activationModalEl = null;
let _lockScreenEl = null;
let _pinSetupModalEl = null;
let _sessionLocked = false;
let _limitedNoticeClosedForPage = false;
try {
    _limitedNoticeClosedForPage = sessionStorage.getItem(TRIAL_BANNER_DISMISSED_KEY) === '1';
} catch (_err) {
    _limitedNoticeClosedForPage = false;
}
let _refreshToken = 0; // stale-request guard for refreshLimitedModeNotice
let _pageVisibilityState = null;
let _pageVisibilityLoadPromise = null;

function _getCurrentPageName() {
    return window.location.pathname.split('/').pop() || 'index.html';
}

function _computeSessionHash(data) {
    const payload = [data.userId, data.role, data.loggedAt].join('|');
    let hash = 0;
    const key = 'gsl_session_integrity_2024';
    const combined = key + ':' + payload;
    for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
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
        if (parsed._h !== _computeSessionHash(parsed)) {
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

function _normalizePageKey(value) {
    const normalizedHref = _normalizeHref(value).replace(/\\/g, '/');
    if (!normalizedHref || normalizedHref === '#') return '';
    const fileName = normalizedHref.split('/').pop() || '';
    if (!/^[a-zA-Z0-9._-]+\.html$/.test(fileName)) return '';
    return fileName;
}

function _getDefaultPageVisibilityMap() {
    return { ...PAGE_DEFAULT_VISIBILITY };
}

function _isManagedPage(pageName) {
    return MANAGED_PAGE_SET.has(pageName);
}

function _isPageVisibleByAdminConfig(pageName) {
    if (!_isManagedPage(pageName)) return true;
    if (!_pageVisibilityState || typeof _pageVisibilityState !== 'object') {
        return PAGE_DEFAULT_VISIBILITY[pageName] !== false;
    }
    const storedValue = _pageVisibilityState[pageName];
    if (typeof storedValue === 'boolean') return storedValue;
    return PAGE_DEFAULT_VISIBILITY[pageName] !== false;
}

function _isPageHiddenByAdminToggle(pageName, role) {
    if (_isAdminRole(role)) return false;
    const normalizedPage = _normalizePageKey(pageName);
    if (!normalizedPage) return false;
    return !_isPageVisibleByAdminConfig(normalizedPage);
}

function _canRoleOpenPage(pageName, authRole, accessState) {
    const normalizedPage = _normalizePageKey(pageName);
    if (!normalizedPage) return false;
    if (_isAdminRole(authRole)) return true;
    if (_isPageHiddenByAdminToggle(normalizedPage, authRole)) return false;
    if (ADMIN_ONLY_PAGES.has(normalizedPage)) return false;

    // Authenticated users (any role) can access non-admin pages
    if (_isAuthenticatedRole(authRole)) return true;

    // Non-authenticated: access depends on activation state
    const state = String(accessState || '').toLowerCase();
    if (state === 'licensed' || state === 'trial') return true;
    return GUEST_ALLOWED_PAGES.has(normalizedPage);
}

function _pickSafeRedirectPage(authRole, accessState, blockedPage = '') {
    const blocked = _normalizePageKey(blockedPage);
    const candidates = ['index.html', 'students-list.html', 'settings-imports.html', 'login.html'];
    for (const page of candidates) {
        if (page === blocked) continue;
        if (page === 'login.html') return page;
        if (_canRoleOpenPage(page, authRole, accessState)) return page;
    }
    return 'login.html';
}

function _extractLinkedPageFromElement(node) {
    if (!node || typeof node.getAttribute !== 'function') return '';
    const dataPage = _normalizePageKey(node.getAttribute('data-page-link'));
    if (dataPage) return dataPage;

    const href = _normalizePageKey(node.getAttribute('href'));
    if (href) return href;

    const onClick = String(node.getAttribute('onclick') || '');
    if (!onClick) return '';
    const match = onClick.match(/location\.href\s*=\s*['\"]([^'\"]+)['\"]/i);
    if (!match) return '';
    return _normalizePageKey(match[1]);
}

function _setPageLinkElementHidden(node, hidden) {
    if (!node) return;
    const container = node.closest('.quick-nav-item, li') || node;
    if (hidden) {
        container.style.display = 'none';
        container.setAttribute('aria-hidden', 'true');
        container.dataset.pageVisibilityHidden = '1';
        return;
    }
    container.style.display = '';
    container.removeAttribute('aria-hidden');
    delete container.dataset.pageVisibilityHidden;
}

function applyPageVisibilityToDocument(role) {
    const isAdmin = _isAdminRole(role);
    document.querySelectorAll('a[href], [onclick*="location.href"], [data-page-link]').forEach((node) => {
        const linkedPage = _extractLinkedPageFromElement(node);
        if (!linkedPage) return;
        const shouldHide =
            !isAdmin && (ADMIN_ONLY_PAGES.has(linkedPage) || _isPageHiddenByAdminToggle(linkedPage, role));
        _setPageLinkElementHidden(node, shouldHide);
    });
}

function getPageVisibilityCatalog() {
    return PAGE_VISIBILITY_CATALOG.map((entry) => {
        const page = _normalizePageKey(entry.page);
        return {
            page,
            title: entry.title,
            group: entry.group,
            completed: entry.completed !== false,
            isAdminOnly: ADMIN_ONLY_PAGES.has(page),
            visible: _isPageVisibleByAdminConfig(page)
        };
    });
}

function getPageVisibilityMapSnapshot() {
    return {
        ..._getDefaultPageVisibilityMap(),
        ...(_pageVisibilityState || {})
    };
}

async function loadPageVisibilityState(forceRefresh = false) {
    if (!forceRefresh && _pageVisibilityState) {
        return _pageVisibilityState;
    }
    if (!forceRefresh && _pageVisibilityLoadPromise) {
        return _pageVisibilityLoadPromise;
    }

    const defaults = _getDefaultPageVisibilityMap();
    const mergeVisibilityMap = (sourceMap) => {
        const merged = { ...defaults };
        if (!sourceMap || typeof sourceMap !== 'object') return merged;
        for (const [page, isVisible] of Object.entries(sourceMap)) {
            const key = _normalizePageKey(page);
            if (!key || !_isManagedPage(key)) continue;
            merged[key] = isVisible === true;
        }
        return merged;
    };

    const run = async () => {
        if (window.api?.pageVisibility?.getMap) {
            try {
                const response = await window.api.pageVisibility.getMap();
                if (response?.success && response.map && typeof response.map === 'object') {
                    _pageVisibilityState = mergeVisibilityMap(response.map);
                    return _pageVisibilityState;
                }
            } catch (_err) {
                // fallback to settings-based storage
            }
        }

        if (window.api?.settings?.get) {
            try {
                const raw = await window.api.settings.get('pageVisibilityMap');
                if (raw) {
                    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    _pageVisibilityState = mergeVisibilityMap(parsed);
                    return _pageVisibilityState;
                }
            } catch (_err) {
                // ignore parse/storage errors and fallback to defaults
            }
        }

        _pageVisibilityState = defaults;
        return _pageVisibilityState;
    };

    _pageVisibilityLoadPromise = run().finally(() => {
        _pageVisibilityLoadPromise = null;
    });

    return _pageVisibilityLoadPromise;
}

async function setPageVisibilityForAdmin(page, isVisible) {
    const pageKey = _normalizePageKey(page);
    if (!pageKey || !_isManagedPage(pageKey)) {
        return { success: false, error: 'اسم الصفحة غير صالح' };
    }
    if (window.api?.pageVisibility?.setVisibility) {
        try {
            const response = await window.api.pageVisibility.setVisibility({
                pageKey,
                isVisible: isVisible === true
            });

            if (response?.success) {
                if (!_pageVisibilityState) {
                    _pageVisibilityState = _getDefaultPageVisibilityMap();
                }
                _pageVisibilityState[pageKey] = isVisible === true;
                return response;
            }

            if (response?.code === 'UNAUTHENTICATED' || response?.code === 'FORBIDDEN') {
                return response;
            }
        } catch (_err) {
            // fallback to settings-based storage
        }
    }

    if (!window.api?.settings?.set) {
        return { success: false, error: 'تعذر حفظ حالة ظهور الصفحة' };
    }

    await loadPageVisibilityState();
    const nextMap = {
        ..._getDefaultPageVisibilityMap(),
        ...(_pageVisibilityState || {})
    };
    nextMap[pageKey] = isVisible === true;

    const saveRes = await window.api.settings.set('pageVisibilityMap', JSON.stringify(nextMap));
    if (!saveRes?.success) {
        return {
            success: false,
            code: saveRes?.code || 'SAVE_FAILED',
            error: saveRes?.error || 'تعذر حفظ حالة ظهور الصفحة'
        };
    }

    _pageVisibilityState = nextMap;
    return {
        success: true,
        pageKey,
        isVisible: isVisible === true
    };
}

function _isAdminRole(role) {
    return String(role || '').toLowerCase() === 'admin';
}

function _isAuthenticatedRole(role) {
    return ['admin', 'staff', 'viewer'].includes(String(role || '').toLowerCase());
}

function _deriveAuthRoleFromSession(session) {
    if (!session || !isAuthSessionActive()) return null;
    const normalized = _normalizeRole(session.role || 'staff');
    if (['admin', 'staff', 'viewer'].includes(normalized)) return normalized;
    return null;
}

function setAppAccessState(state) {
    const s = String(state || '').toLowerCase();
    if (['licensed', 'trial', 'blocked'].includes(s)) {
        document.documentElement.dataset.appAccessState = s;
    } else {
        document.documentElement.dataset.appAccessState = 'blocked';
    }
}

function getAppAccessState() {
    const value = document.documentElement.dataset.appAccessState;
    if (value === 'licensed') return 'licensed';
    if (value === 'trial') return 'trial';
    return 'blocked';
}

function getCurrentAppRole() {
    const session = getAuthSessionData();
    if (!session || !isAuthSessionActive()) return null;
    const normalized = _normalizeRole(session.role || '');
    if (['admin', 'staff', 'viewer', 'developer'].includes(normalized)) return normalized;
    return null;
}

function setAuthSession(email = '', user = {}) {
    const safeUser = user && typeof user === 'object' ? user : {};
    try {
        const sessionData = {
            userId: Number(safeUser.userId || 0),
            name: String(safeUser.name || ''),
            email: String(safeUser.email || email || '')
                .trim()
                .toLowerCase(),
            role: _normalizeRole(safeUser.role || 'staff'),
            loggedAt: Date.now(),
            source: 'sqlite'
        };
        sessionData._h = _computeSessionHash(sessionData);
        localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionData));
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

function _isSidebarLinkBlocked(href, authRole, accessState) {
    if (_isAdminRole(authRole)) return false;
    const normalizedHref = _normalizePageKey(href);
    if (!normalizedHref || normalizedHref === '#') return false;

    if (_isPageHiddenByAdminToggle(normalizedHref, authRole)) {
        return true;
    }

    // Authenticated users can see everything except admin-only
    if (_isAuthenticatedRole(authRole)) {
        return ADMIN_ONLY_PAGES.has(normalizedHref);
    }

    // Non-authenticated: licensed/trial can see non-admin pages
    const state = String(accessState || '').toLowerCase();
    if (state === 'licensed' || state === 'trial') {
        return ADMIN_ONLY_PAGES.has(normalizedHref);
    }

    return !GUEST_ALLOWED_LINKS.has(normalizedHref);
}

function applyNavigationRestrictions(authRole, accessState) {
    const isAdmin = _isAdminRole(authRole);

    document.querySelectorAll('.sidebar-nav a[href]').forEach((link) => {
        if (!link.dataset.limitedGuardBound) {
            link.addEventListener('click', (event) => {
                const currentRole = getCurrentAppRole();
                const currentAccess = getAppAccessState();
                if (!_isSidebarLinkBlocked(link.getAttribute('href'), currentRole, currentAccess)) return;
                event.preventDefault();
                event.stopPropagation();
                const href = _normalizePageKey(link.getAttribute('href'));
                if (_isPageHiddenByAdminToggle(href, currentRole)) {
                    showToast('هذه الصفحة غير متاحة حالياً', 'warning');
                    return;
                }
                const isAuth = _isAuthenticatedRole(currentRole);
                const message = isAuth
                    ? 'هذه الصفحة مخصصة للمشرف (Admin)'
                    : currentAccess === 'licensed' || currentAccess === 'trial'
                      ? 'هذه الصفحة مخصصة للمشرف (Admin)'
                      : 'الوصول في الوضع المحدود متاح فقط لصفحتي اللوائح والاستيراد';
                showToast(message, 'warning');
            });
            link.dataset.limitedGuardBound = '1';
        }

        const href = _normalizePageKey(link.getAttribute('href'));
        const isAdminOnlyPage = ADMIN_ONLY_PAGES.has(href);
        const isHiddenByAdmin = _isPageHiddenByAdminToggle(href, authRole);
        const blocked = _isSidebarLinkBlocked(link.getAttribute('href'), authRole, accessState);
        const listItem = link.closest('li');

        if (!isAdmin && (isAdminOnlyPage || isHiddenByAdmin)) {
            if (listItem) listItem.style.display = 'none';
            return;
        } else if (isAdminOnlyPage || isHiddenByAdmin) {
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

function applySessionToUI(session, authRole, accessState) {
    const safe = session && typeof session === 'object' ? session : {};
    const isAuthenticated = _isAuthenticatedRole(authRole);
    const state = String(accessState || '').toLowerCase();

    let displayName, badgeLabel, tone;
    if (isAuthenticated) {
        displayName = String(safe.name || safe.email || 'المستخدم').trim() || 'المستخدم';
        const normalized = _normalizeRole(authRole);
        badgeLabel = _roleLabel(normalized);
        tone = _roleTone(normalized);
    } else if (state === 'trial') {
        displayName = 'فترة تجريبية';
        badgeLabel = 'تجريبي';
        tone = { bg: '#FEF9C3', fg: '#854D0E', border: '#FDE68A' };
    } else if (state === 'licensed') {
        displayName = 'مستخدم مرخص';
        badgeLabel = 'مرخص';
        tone = { bg: '#e7f7ed', fg: '#0f6a35', border: '#b7e5c8' };
    } else {
        displayName = 'وضع محدود';
        badgeLabel = 'محدود';
        tone = { bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA' };
    }

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

        badge.textContent = badgeLabel;
        badge.style.background = tone.bg;
        badge.style.color = tone.fg;
        badge.style.borderColor = tone.border;
    });
}

function redirectToLoginPage() {
    const next = encodeURIComponent(_getCurrentPageName());
    window.location.replace(`login.html?next=${next}`);
}

function redirectToSafePage(authRole, accessState, blockedPage = '') {
    const target = _pickSafeRedirectPage(authRole, accessState, blockedPage);
    window.location.replace(target);
}

function enforcePageRoleOrRedirect(authRole, accessState) {
    const currentPage = _normalizePageKey(_getCurrentPageName());
    const isAdmin = _isAdminRole(authRole);

    if (isAdmin) return true;

    if (_isPageHiddenByAdminToggle(currentPage, authRole)) {
        try {
            sessionStorage.setItem(PAGE_VISIBILITY_BLOCKED_NOTICE_KEY, '1');
        } catch (_err) {
            // ignore
        }
        redirectToSafePage(authRole, accessState, currentPage);
        return false;
    }

    // Authenticated non-admin users can access everything except admin-only
    if (_isAuthenticatedRole(authRole)) {
        if (ADMIN_ONLY_PAGES.has(currentPage)) {
            try {
                sessionStorage.setItem(BLOCKED_REDIRECT_NOTICE_KEY, currentPage);
            } catch (_err) {
                // ignore
            }
            redirectToSafePage(authRole, accessState, currentPage);
            return false;
        }
        return true;
    }

    // Non-authenticated: check access state
    const state = String(accessState || '').toLowerCase();
    if (state === 'licensed' || state === 'trial') {
        if (ADMIN_ONLY_PAGES.has(currentPage)) {
            try {
                sessionStorage.setItem(BLOCKED_REDIRECT_NOTICE_KEY, currentPage);
            } catch (_err) {
                // ignore
            }
            redirectToSafePage(authRole, accessState, currentPage);
            return false;
        }
        return true;
    }

    // Blocked/unactivated — only guest-allowed pages
    if (!GUEST_ALLOWED_PAGES.has(currentPage)) {
        try {
            sessionStorage.setItem(BLOCKED_REDIRECT_NOTICE_KEY, currentPage);
            sessionStorage.setItem(BLOCKED_REDIRECT_NEXT_KEY, currentPage);
        } catch (_err) {
            // ignore
        }
        redirectToSafePage(authRole, accessState, currentPage);
        return false;
    }

    if (ADMIN_ONLY_PAGES.has(currentPage)) {
        redirectToSafePage(authRole, accessState, currentPage);
        return false;
    }

    return true;
}

function _removeLimitedNotice() {
    const banner = document.getElementById('limited-mode-banner');
    if (banner) banner.remove();
}

function _isLimitedNoticeShownThisAppOpen() {
    try {
        return sessionStorage.getItem(TRIAL_BANNER_SHOWN_ON_OPEN_KEY) === '1';
    } catch (_err) {
        return false;
    }
}

function _markLimitedNoticeShownThisAppOpen() {
    try {
        sessionStorage.setItem(TRIAL_BANNER_SHOWN_ON_OPEN_KEY, '1');
    } catch (_err) {
        // ignore storage write errors
    }
}

function _dismissLimitedNotice() {
    _limitedNoticeClosedForPage = true;
    try {
        sessionStorage.setItem(TRIAL_BANNER_DISMISSED_KEY, '1');
    } catch (_err) {
        // ignore storage write errors
    }
    _removeLimitedNotice();
}

function _ensureActivationModal(forced = false) {
    // If forced mode changed, recreate the modal
    if (_activationModalEl && document.body.contains(_activationModalEl)) {
        const wasForced = _activationModalEl.dataset.forced === '1';
        if (wasForced === forced) return _activationModalEl;
        _activationModalEl.remove();
        _activationModalEl = null;
    }

    const modal = document.createElement('div');
    modal.id = 'activation-modal-overlay';
    modal.dataset.forced = forced ? '1' : '0';
    modal.style.cssText =
        'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.55);z-index:10060;padding:16px;';

    const forcedNotice = forced
        ? `<div style="padding:10px 16px;background:#fef2f2;border-bottom:1px solid #fecaca;color:#991b1b;font-size:13px;font-weight:600;"><i class="fas fa-exclamation-triangle"></i> انتهت الفترة التجريبية. يجب تفعيل البرنامج للمتابعة أو سيتم إغلاق التطبيق.</div>`
        : '';

    const closeButtonHtml = forced
        ? `<button type="button" id="activation-close-btn" style="border:none;background:transparent;font-size:18px;cursor:pointer;color:#dc2626;" title="إغلاق التطبيق"><i class="fas fa-power-off"></i></button>`
        : `<button type="button" id="activation-close-btn" style="border:none;background:transparent;font-size:18px;cursor:pointer;color:#6b7280;"><i class="fas fa-times"></i></button>`;

    const cancelButtonHtml = forced
        ? `<button type="button" id="activation-cancel-btn" class="btn btn-danger"><i class="fas fa-power-off"></i> إغلاق التطبيق</button>`
        : `<button type="button" id="activation-cancel-btn" class="btn btn-secondary">إغلاق</button>`;

    modal.innerHTML = `
        <div style="width:min(680px,95vw);background:#fff;border-radius:14px;box-shadow:0 20px 40px rgba(0,0,0,.2);overflow:hidden;">
            ${forcedNotice}
            <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #e5e7eb;">
                <h3 style="margin:0;font-size:18px;color:#111827;"><i class="fas fa-key"></i> تفعيل البرنامج</h3>
                ${closeButtonHtml}
            </div>
            <div style="padding:16px;display:grid;gap:10px;">
                <p style="margin:0;color:#4b5563;font-size:13px;">أرسل رمز الجهاز التالي لمسؤول التراخيص للحصول على السيريال الخاص بهذا الجهاز.</p>
                <input id="activation-device-code" readonly style="direction:ltr;font-family:ui-monospace,Consolas,monospace;padding:10px;border:1px solid #d1d5db;border-radius:8px;background:#f9fafb;">
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" id="activation-copy-btn" class="btn btn-secondary"><i class="fas fa-copy"></i> نسخ الرمز</button>
                </div>
                <input id="activation-serial-input" type="text" placeholder="ألصق السيريال هنا" style="direction:ltr;padding:10px;border:1px solid #d1d5db;border-radius:8px;">
                <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
                    ${cancelButtonHtml}
                    <button type="button" id="activation-submit-btn" class="btn btn-success"><i class="fas fa-check"></i> تفعيل</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    _activationModalEl = modal;

    const closeAction = forced
        ? () => {
              if (window.api?.system?.quit) window.api.system.quit();
          }
        : () => {
              modal.style.display = 'none';
          };

    modal.querySelector('#activation-close-btn')?.addEventListener('click', closeAction);
    modal.querySelector('#activation-cancel-btn')?.addEventListener('click', closeAction);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            if (forced) {
                // In forced mode, clicking backdrop also quits
                closeAction();
            } else {
                modal.style.display = 'none';
            }
        }
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
        modal.style.display = 'none';
        // Reload the page to apply licensed mode properly
        window.location.reload();
    });

    return modal;
}

async function openActivationModal() {
    if (!window.api?.licensing?.getActivationRequest || !window.api?.licensing?.activatePublic) {
        showToast('تعذر تهيئة التفعيل في هذه الصفحة', 'error');
        return;
    }

    const modal = _ensureActivationModal(false);
    modal.style.display = 'flex';

    const reqRes = await window.api.licensing.getActivationRequest();
    const codeInput = modal.querySelector('#activation-device-code');
    if (codeInput) {
        codeInput.value = reqRes?.success ? reqRes.deviceCode || '' : '';
    }
}

async function openForcedActivationModal() {
    if (!window.api?.licensing?.getActivationRequest || !window.api?.licensing?.activatePublic) {
        // Can't show modal, must quit
        if (window.api?.system?.quit) window.api.system.quit();
        return;
    }

    const modal = _ensureActivationModal(true);
    modal.style.display = 'flex';

    const reqRes = await window.api.licensing.getActivationRequest();
    const codeInput = modal.querySelector('#activation-device-code');
    if (codeInput) {
        codeInput.value = reqRes?.success ? reqRes.deviceCode || '' : '';
    }
}

function ensureLimitedModeNotice(authRole, accessState, activationStatus = null) {
    const state = String(accessState || '').toLowerCase();
    if (_isAuthenticatedRole(authRole) || state === 'licensed') {
        _limitedNoticeClosedForPage = false;
        _removeLimitedNotice();
        return;
    }

    const existingBanner = document.getElementById('limited-mode-banner');

    if (_limitedNoticeClosedForPage) {
        _removeLimitedNotice();
        return;
    }

    if (!existingBanner && _isLimitedNoticeShownThisAppOpen()) {
        return;
    }

    // Trial mode: show trial info banner
    if (state === 'trial') {
        const mainContent = document.querySelector('main.main-content');
        if (!mainContent) return;

        const daysRemaining = activationStatus?.trialDaysRemaining ?? 0;
        const existing = existingBanner;
        const urgency =
            daysRemaining <= 7
                ? 'border:1px solid #fecaca;background:#fef2f2;color:#991b1b;'
                : daysRemaining <= 30
                  ? 'border:1px dashed #f59e0b;background:#fff8e8;color:#7a4b0e;'
                  : 'border:1px solid #b4c9f0;background:#e8f0fe;color:#1a56db;';
        const icon = daysRemaining <= 7 ? 'fa-exclamation-triangle' : 'fa-clock';

        const html = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <i class="fas ${icon}"></i>
                    <span>الفترة التجريبية: متبقي <strong>${daysRemaining}</strong> يوم${daysRemaining <= 7 ? ' — يرجى تفعيل البرنامج قريباً' : ''}</span>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button type="button" id="limited-activate-btn" class="btn btn-warning" style="padding:6px 10px;font-size:12px;"><i class="fas fa-key"></i> تفعيل البرنامج</button>
                    <button type="button" id="limited-close-btn" class="btn btn-secondary" style="padding:6px 10px;font-size:12px;">إغلاق</button>
                </div>
            </div>
        `;

        if (existing) {
            existing.style.cssText = `margin:14px 20px 0 20px;padding:10px 12px;${urgency}border-radius:10px;font-weight:600;font-size:13px;`;
            existing.innerHTML = html;
        } else {
            const banner = document.createElement('div');
            banner.id = 'limited-mode-banner';
            banner.style.cssText = `margin:14px 20px 0 20px;padding:10px 12px;${urgency}border-radius:10px;font-weight:600;font-size:13px;`;
            banner.innerHTML = html;
            const header = mainContent.querySelector(':scope > .header');
            if (header) {
                header.insertAdjacentElement('afterend', banner);
            } else {
                mainContent.insertAdjacentElement('afterbegin', banner);
            }
        }

        _markLimitedNoticeShownThisAppOpen();

        document.getElementById('limited-close-btn')?.addEventListener('click', _dismissLimitedNotice);
        document.getElementById('limited-activate-btn')?.addEventListener('click', () => {
            void openActivationModal();
        });
        return;
    }

    // Limited mode (original behavior)
    const mainContent = document.querySelector('main.main-content');
    if (!mainContent) return;

    const isActivated = !!activationStatus?.activated;
    const existing = existingBanner;
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

    _markLimitedNoticeShownThisAppOpen();

    document.getElementById('limited-close-btn')?.addEventListener('click', _dismissLimitedNotice);
    document.getElementById('limited-activate-btn')?.addEventListener('click', () => {
        void openActivationModal();
    });
}

function refreshLimitedModeNotice(authRole, accessState) {
    const state = String(accessState || '').toLowerCase();
    if (_isAuthenticatedRole(authRole) || state === 'licensed') {
        _removeLimitedNotice();
        return;
    }
    // Trial mode: don't short-circuit, continue to fetch status for days remaining

    if (!window.api?.licensing?.getPublicStatus) {
        ensureLimitedModeNotice(authRole, 'blocked', { activated: false });
        return;
    }

    const token = ++_refreshToken;

    window.api.licensing
        .getPublicStatus()
        .then((res) => {
            // Stale-request guard: ignore if a newer request was issued
            if (token !== _refreshToken) return;
            // Never downgrade an admin role from a licensing callback
            if (_isAuthenticatedRole(getCurrentAppRole())) return;

            if (!res?.success) {
                ensureLimitedModeNotice(authRole, 'blocked', { activated: false });
                return;
            }

            // Trial active
            if (res.status === 'trial') {
                if (getAppAccessState() !== 'trial') {
                    const session = isAuthSessionActive() ? getAuthSessionData() : null;
                    applyAppUi(authRole, 'trial', session);
                } else {
                    ensureLimitedModeNotice(authRole, 'trial', res);
                }
                return;
            }

            // Trial expired — show forced activation
            if (res.status === 'trial_expired') {
                void openForcedActivationModal();
                return;
            }

            const isActivated = !!res.activated;
            if (isActivated) {
                if (getAppAccessState() !== 'licensed') {
                    const session = isAuthSessionActive() ? getAuthSessionData() : null;
                    applyAppUi(authRole, 'licensed', session);
                } else {
                    _removeLimitedNotice();
                }
                return;
            }

            if (getAppAccessState() !== 'blocked') {
                const session = isAuthSessionActive() ? getAuthSessionData() : null;
                applyAppUi(authRole, 'blocked', session);
                return;
            }

            ensureLimitedModeNotice(authRole, 'blocked', res || { activated: false });
        })
        .catch(() => {
            // Stale-request guard
            if (token !== _refreshToken) return;
            // Never downgrade admin
            if (_isAuthenticatedRole(getCurrentAppRole())) return;

            if (getAppAccessState() !== 'blocked') {
                const session = isAuthSessionActive() ? getAuthSessionData() : null;
                applyAppUi(authRole, 'blocked', session);
                return;
            }
            ensureLimitedModeNotice(authRole, 'blocked', { activated: false });
        });
}

// ── Role display helpers ──
function _normalizeRole(raw) {
    const r = String(raw || '')
        .trim()
        .toLowerCase();
    if (['admin', 'مشرف'].includes(r)) return 'admin';
    if (['staff', 'موظف'].includes(r)) return 'staff';
    if (['viewer', 'مشاهد'].includes(r)) return 'viewer';
    return r || 'staff';
}

function _roleLabel(normalized) {
    const labels = { admin: 'مشرف', staff: 'موظف', viewer: 'مشاهد' };
    return labels[normalized] || normalized;
}

function _roleTone(normalized) {
    const tones = {
        admin: { bg: '#EBF4FF', fg: '#1E40AF', border: '#93B3F2' },
        staff: { bg: '#e7f7ed', fg: '#0f6a35', border: '#b7e5c8' },
        viewer: { bg: '#FEF9C3', fg: '#854D0E', border: '#FDE68A' }
    };
    return tones[normalized] || tones.staff;
}

// ── Change password modal ──
function openChangePasswordModal() {
    const old = document.getElementById('change-pw-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'change-pw-modal';
    modal.style.cssText =
        'position:fixed;inset:0;z-index:10100;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.5);';
    modal.innerHTML =
        '' +
        '<div style="background:var(--color-surface,#fff);border-radius:16px;padding:28px 24px;width:min(400px,90vw);box-shadow:0 20px 50px rgba(0,0,0,0.2);position:relative;direction:rtl;font-family:var(--font-main);">' +
        '<button type="button" id="cpw-close" style="position:absolute;top:12px;left:12px;width:32px;height:32px;border-radius:8px;border:1px solid var(--color-accent,#e5e7eb);background:transparent;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);"><i class="fas fa-times"></i></button>' +
        '<h3 style="margin:0 0 20px;font-size:18px;font-weight:700;color:var(--color-text-main);"><i class="fas fa-key" style="margin-left:8px;color:var(--color-primary);"></i>تغيير كلمة المرور</h3>' +
        '<div id="cpw-error" style="display:none;background:#FED7D7;color:#C53030;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:13px;"></div>' +
        '<div id="cpw-success" style="display:none;background:#C6F6D5;color:#22543D;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:13px;"></div>' +
        '<form id="cpw-form" style="display:flex;flex-direction:column;gap:14px;">' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">كلمة المرور الحالية</label><input type="password" id="cpw-current" required style="width:100%;padding:11px 14px;border:1px solid var(--color-accent,#e5e7eb);border-radius:8px;font-size:14px;font-family:inherit;"></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">كلمة المرور الجديدة</label><input type="password" id="cpw-new" required minlength="6" style="width:100%;padding:11px 14px;border:1px solid var(--color-accent,#e5e7eb);border-radius:8px;font-size:14px;font-family:inherit;"></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">تأكيد كلمة المرور الجديدة</label><input type="password" id="cpw-confirm" required minlength="6" style="width:100%;padding:11px 14px;border:1px solid var(--color-accent,#e5e7eb);border-radius:8px;font-size:14px;font-family:inherit;"></div>' +
        '<button type="submit" style="padding:12px;background:var(--color-primary,#3B6AC5);color:white;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">تغيير كلمة المرور</button>' +
        '</form></div>';
    document.body.appendChild(modal);

    document.getElementById('cpw-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    document.getElementById('cpw-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('cpw-error');
        const successEl = document.getElementById('cpw-success');
        errorEl.style.display = 'none';
        successEl.style.display = 'none';

        const currentPassword = document.getElementById('cpw-current').value;
        const newPassword = document.getElementById('cpw-new').value;
        const confirmPassword = document.getElementById('cpw-confirm').value;

        if (newPassword !== confirmPassword) {
            errorEl.textContent = 'كلمتا المرور الجديدتان غير متطابقتين';
            errorEl.style.display = 'block';
            return;
        }

        try {
            const res = await window.api.auth.changePassword({ currentPassword, newPassword });
            if (!res?.success) {
                errorEl.textContent = res?.error || 'فشل تغيير كلمة المرور';
                errorEl.style.display = 'block';
                return;
            }
            successEl.textContent = 'تم تغيير كلمة المرور بنجاح';
            successEl.style.display = 'block';
            document.getElementById('cpw-form').reset();
            setTimeout(() => modal.remove(), 1500);
        } catch (err) {
            errorEl.textContent = err.message || 'حدث خطأ';
            errorEl.style.display = 'block';
        }
    });
}

// ── Lock screen ──
function isSessionLocked() {
    return _sessionLocked;
}

function lockScreen() {
    if (!isAuthSessionActive()) return;
    _sessionLocked = true;
    if (window.api?.auth?.lockSession) {
        window.api.auth.lockSession().catch(() => {});
    }
    showLockScreen();
}

function showLockScreen() {
    if (_lockScreenEl && document.body.contains(_lockScreenEl)) {
        _lockScreenEl.style.display = 'flex';
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'lock-screen-overlay';
    overlay.style.cssText =
        'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.85);z-index:10200;padding:16px;';

    const session = getAuthSessionData();
    const userName = String(session?.name || session?.email || 'المستخدم').trim() || 'المستخدم';

    overlay.innerHTML = `
        <div style="width:min(380px,90vw);background:#fff;border-radius:16px;box-shadow:0 20px 40px rgba(0,0,0,0.3);overflow:hidden;direction:rtl;text-align:center;">
            <div style="padding:30px 24px 10px;">
                <div style="width:64px;height:64px;border-radius:50%;background:#EBF4FF;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                    <i class="fas fa-lock" style="font-size:24px;color:#1E40AF;"></i>
                </div>
                <h3 style="margin:0 0 6px;font-size:18px;color:#111827;">${escapeHtml(userName)}</h3>
                <p style="margin:0 0 20px;font-size:13px;color:#6b7280;">الجلسة مقفلة</p>
            </div>
            <div id="lock-pin-section" style="padding:0 24px 10px;display:none;">
                <input id="lock-pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="أدخل رمز PIN" style="direction:ltr;width:100%;padding:12px;border:1px solid #d1d5db;border-radius:8px;text-align:center;font-size:18px;letter-spacing:8px;font-family:ui-monospace,monospace;">
                <div id="lock-pin-error" style="display:none;color:#DC2626;font-size:12px;margin-top:8px;"></div>
            </div>
            <div id="lock-password-section" style="padding:0 24px 10px;display:none;">
                <input id="lock-pw-input" type="password" placeholder="أدخل كلمة المرور" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;font-family:inherit;">
                <div id="lock-pw-error" style="display:none;color:#DC2626;font-size:12px;margin-top:8px;"></div>
            </div>
            <div style="padding:0 24px 24px;display:flex;flex-direction:column;gap:8px;">
                <button type="button" id="lock-unlock-btn" class="btn btn-success" style="width:100%;padding:12px;font-size:15px;"><i class="fas fa-unlock"></i> فتح القفل</button>
                <button type="button" id="lock-use-password-btn" style="display:none;border:none;background:transparent;color:#3B6AC5;font-size:13px;cursor:pointer;padding:8px;">استخدم كلمة المرور بدلاً من PIN</button>
                <button type="button" id="lock-logout-btn" style="border:none;background:transparent;color:#DC2626;font-size:12px;cursor:pointer;padding:8px;">تسجيل الخروج</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    _lockScreenEl = overlay;

    // Determine if PIN is available
    let usePinMode = false;
    if (window.api?.auth?.getPinStatus) {
        window.api.auth
            .getPinStatus()
            .then((res) => {
                if (res?.success && res.configured && !res.locked) {
                    usePinMode = true;
                    overlay.querySelector('#lock-pin-section').style.display = '';
                    overlay.querySelector('#lock-use-password-btn').style.display = '';
                    overlay.querySelector('#lock-pin-input')?.focus();
                } else {
                    overlay.querySelector('#lock-password-section').style.display = '';
                    overlay.querySelector('#lock-pw-input')?.focus();
                }
            })
            .catch(() => {
                overlay.querySelector('#lock-password-section').style.display = '';
                overlay.querySelector('#lock-pw-input')?.focus();
            });
    } else {
        overlay.querySelector('#lock-password-section').style.display = '';
        overlay.querySelector('#lock-pw-input')?.focus();
    }

    // Switch to password mode
    overlay.querySelector('#lock-use-password-btn')?.addEventListener('click', () => {
        usePinMode = false;
        overlay.querySelector('#lock-pin-section').style.display = 'none';
        overlay.querySelector('#lock-password-section').style.display = '';
        overlay.querySelector('#lock-use-password-btn').style.display = 'none';
        overlay.querySelector('#lock-pw-input')?.focus();
    });

    // Unlock handler
    overlay.querySelector('#lock-unlock-btn')?.addEventListener('click', async () => {
        if (usePinMode) {
            const pin = overlay.querySelector('#lock-pin-input')?.value || '';
            if (!pin) return;
            const errorEl = overlay.querySelector('#lock-pin-error');
            try {
                const res = await window.api.auth.verifyPin({ pin });
                if (res?.success) {
                    _sessionLocked = false;
                    hideLockScreen();
                    return;
                }
                if (res?.code === 'PIN_LOCKED' || res?.requirePassword) {
                    usePinMode = false;
                    overlay.querySelector('#lock-pin-section').style.display = 'none';
                    overlay.querySelector('#lock-password-section').style.display = '';
                    overlay.querySelector('#lock-use-password-btn').style.display = 'none';
                    overlay.querySelector('#lock-pw-input')?.focus();
                    const pwError = overlay.querySelector('#lock-pw-error');
                    if (pwError) {
                        pwError.textContent = 'تم تجاوز محاولات PIN. استخدم كلمة المرور.';
                        pwError.style.display = '';
                    }
                    return;
                }
                if (errorEl) {
                    errorEl.textContent = res?.error || 'رمز PIN غير صحيح';
                    if (res?.attemptsRemaining != null) {
                        errorEl.textContent += ` (${res.attemptsRemaining} محاولات متبقية)`;
                    }
                    errorEl.style.display = '';
                }
            } catch (_err) {
                if (errorEl) {
                    errorEl.textContent = 'حدث خطأ';
                    errorEl.style.display = '';
                }
            }
            overlay.querySelector('#lock-pin-input').value = '';
            overlay.querySelector('#lock-pin-input')?.focus();
        } else {
            const password = overlay.querySelector('#lock-pw-input')?.value || '';
            if (!password) return;
            const errorEl = overlay.querySelector('#lock-pw-error');
            try {
                const res = await window.api.auth.unlockWithPassword({ password });
                if (res?.success) {
                    _sessionLocked = false;
                    hideLockScreen();
                    return;
                }
                if (errorEl) {
                    errorEl.textContent = res?.error || 'كلمة المرور غير صحيحة';
                    errorEl.style.display = '';
                }
            } catch (_err) {
                if (errorEl) {
                    errorEl.textContent = 'حدث خطأ';
                    errorEl.style.display = '';
                }
            }
            overlay.querySelector('#lock-pw-input').value = '';
            overlay.querySelector('#lock-pw-input')?.focus();
        }
    });

    // Allow Enter key to submit
    overlay.querySelector('#lock-pin-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') overlay.querySelector('#lock-unlock-btn')?.click();
    });
    overlay.querySelector('#lock-pw-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') overlay.querySelector('#lock-unlock-btn')?.click();
    });

    // Logout handler
    overlay.querySelector('#lock-logout-btn')?.addEventListener('click', async () => {
        if (window.api?.auth?.logout) {
            await window.api.auth.logout();
        }
        clearAuthSession();
        _sessionLocked = false;
        hideLockScreen();
        window.location.replace('index.html');
    });
}

function hideLockScreen() {
    if (_lockScreenEl) {
        _lockScreenEl.style.display = 'none';
    }
}

// ── PIN setup modal ──
function openPinSetupModal() {
    const old = document.getElementById('pin-setup-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'pin-setup-modal';
    modal.style.cssText =
        'position:fixed;inset:0;z-index:10100;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.5);';
    modal.innerHTML =
        '' +
        '<div style="background:var(--color-surface,#fff);border-radius:16px;padding:28px 24px;width:min(380px,90vw);box-shadow:0 20px 50px rgba(0,0,0,0.2);position:relative;direction:rtl;font-family:var(--font-main);">' +
        '<button type="button" id="pin-close" style="position:absolute;top:12px;left:12px;width:32px;height:32px;border-radius:8px;border:1px solid var(--color-accent,#e5e7eb);background:transparent;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);"><i class="fas fa-times"></i></button>' +
        '<h3 style="margin:0 0 8px;font-size:18px;font-weight:700;color:var(--color-text-main);"><i class="fas fa-lock" style="margin-left:8px;color:var(--color-primary);"></i>إعداد رمز PIN</h3>' +
        '<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">رمز PIN يتيح لك قفل الجلسة وفتحها بسرعة دون الحاجة لكلمة المرور.</p>' +
        '<div id="pin-error" style="display:none;background:#FED7D7;color:#C53030;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:13px;"></div>' +
        '<div id="pin-success" style="display:none;background:#C6F6D5;color:#22543D;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:13px;"></div>' +
        '<form id="pin-form" style="display:flex;flex-direction:column;gap:14px;">' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">رمز PIN (4-6 أرقام)</label><input type="password" id="pin-new" inputmode="numeric" pattern="[0-9]*" required minlength="4" maxlength="6" style="width:100%;padding:11px 14px;border:1px solid var(--color-accent,#e5e7eb);border-radius:8px;font-size:18px;text-align:center;letter-spacing:8px;direction:ltr;font-family:ui-monospace,monospace;"></div>' +
        '<div><label style="display:block;margin-bottom:4px;font-size:13px;font-weight:600;">تأكيد رمز PIN</label><input type="password" id="pin-confirm" inputmode="numeric" pattern="[0-9]*" required minlength="4" maxlength="6" style="width:100%;padding:11px 14px;border:1px solid var(--color-accent,#e5e7eb);border-radius:8px;font-size:18px;text-align:center;letter-spacing:8px;direction:ltr;font-family:ui-monospace,monospace;"></div>' +
        '<button type="submit" style="padding:12px;background:var(--color-primary,#3B6AC5);color:white;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">حفظ رمز PIN</button>' +
        '</form></div>';
    document.body.appendChild(modal);
    _pinSetupModalEl = modal;

    document.getElementById('pin-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    document.getElementById('pin-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('pin-error');
        const successEl = document.getElementById('pin-success');
        errorEl.style.display = 'none';
        successEl.style.display = 'none';

        const pin = document.getElementById('pin-new').value;
        const confirmPin = document.getElementById('pin-confirm').value;

        if (!/^\d{4,6}$/.test(pin)) {
            errorEl.textContent = 'رمز PIN يجب أن يكون من 4 إلى 6 أرقام';
            errorEl.style.display = 'block';
            return;
        }

        if (pin !== confirmPin) {
            errorEl.textContent = 'رمزا PIN غير متطابقين';
            errorEl.style.display = 'block';
            return;
        }

        try {
            const res = await window.api.auth.setupPin({ pin });
            if (!res?.success) {
                errorEl.textContent = res?.error || 'فشل حفظ رمز PIN';
                errorEl.style.display = 'block';
                return;
            }
            successEl.textContent = 'تم حفظ رمز PIN بنجاح';
            successEl.style.display = 'block';
            document.getElementById('pin-form').reset();
            setTimeout(() => modal.remove(), 1500);
        } catch (err) {
            errorEl.textContent = err.message || 'حدث خطأ';
            errorEl.style.display = 'block';
        }
    });
}

function ensureAdminAuthButton(authRole, accessState) {
    const currentPage = _getCurrentPageName();
    if (currentPage === 'login.html') return;

    // ── Sidebar auth section ──
    const loginBtn = document.getElementById('sidebar-login-btn');
    const changePwBtn = document.getElementById('sidebar-change-pw-btn');
    const activateBtn = document.getElementById('sidebar-activate-btn');
    const lockBtn = document.getElementById('sidebar-lock-btn');
    const pinSetupBtn = document.getElementById('sidebar-pin-setup-btn');
    const userSection = document.getElementById('sidebar-auth-user');
    const nameEl = document.getElementById('sidebar-auth-name');
    const roleBadge = document.getElementById('sidebar-auth-role-badge');

    if (!loginBtn) return;

    // Bind events once
    if (!loginBtn.dataset.authBound) {
        loginBtn.dataset.authBound = '1';
        loginBtn.addEventListener('click', async () => {
            const currentRole = getCurrentAppRole();
            if (isAuthSessionActive() && _isAuthenticatedRole(currentRole)) {
                // Logout
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

    if (activateBtn && !activateBtn.dataset.authBound) {
        activateBtn.dataset.authBound = '1';
        activateBtn.addEventListener('click', () => {
            void openActivationModal();
        });
    }

    if (changePwBtn && !changePwBtn.dataset.authBound) {
        changePwBtn.dataset.authBound = '1';
        changePwBtn.addEventListener('click', () => {
            if (typeof openChangePasswordModal === 'function') {
                openChangePasswordModal();
            }
        });
    }

    if (lockBtn && !lockBtn.dataset.authBound) {
        lockBtn.dataset.authBound = '1';
        lockBtn.addEventListener('click', () => {
            lockScreen();
        });
    }

    if (pinSetupBtn && !pinSetupBtn.dataset.authBound) {
        pinSetupBtn.dataset.authBound = '1';
        pinSetupBtn.addEventListener('click', () => {
            openPinSetupModal();
        });
    }

    // ── Remove old header-based auth/activate buttons ──
    document.querySelectorAll('[data-admin-auth-btn="1"], [data-activate-link-btn="1"]').forEach((el) => el.remove());

    // ── Update UI based on role ──
    const isAuthenticated = _isAuthenticatedRole(authRole);

    if (isAuthenticated) {
        // User is logged in (any role)
        const session = getAuthSessionData();
        if (userSection) userSection.style.display = '';
        if (nameEl) {
            nameEl.textContent = String(session?.name || session?.email || 'المستخدم').trim() || 'المستخدم';
        }
        if (roleBadge) {
            const normalized = _normalizeRole(session?.role || authRole);
            const tone = _roleTone(normalized);
            roleBadge.textContent = _roleLabel(normalized);
            roleBadge.style.background = tone.bg;
            roleBadge.style.color = tone.fg;
            roleBadge.style.borderColor = tone.border;
        }
        if (activateBtn) activateBtn.style.display = 'none';
        if (changePwBtn) changePwBtn.style.display = '';
        if (lockBtn) lockBtn.style.display = '';
        if (pinSetupBtn) pinSetupBtn.style.display = '';
        loginBtn.innerHTML =
            '<i class="fas fa-sign-out-alt"></i><span>\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c</span>';
        loginBtn.title = '\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c';
        loginBtn.classList.remove('sidebar-auth-login');
        loginBtn.classList.add('sidebar-auth-logout');
    } else {
        // Not logged in
        if (userSection) userSection.style.display = 'none';
        if (changePwBtn) changePwBtn.style.display = 'none';
        if (lockBtn) lockBtn.style.display = 'none';
        if (pinSetupBtn) pinSetupBtn.style.display = 'none';
        if (activateBtn) activateBtn.style.display = accessState === 'blocked' ? '' : 'none';
        loginBtn.innerHTML =
            '<i class="fas fa-user-shield"></i><span>\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0623\u0648 \u0625\u0646\u0634\u0627\u0621 \u062d\u0633\u0627\u0628</span>';
        loginBtn.title =
            '\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0623\u0648 \u0625\u0646\u0634\u0627\u0621 \u062d\u0633\u0627\u0628';
        loginBtn.classList.remove('sidebar-auth-logout');
        loginBtn.classList.add('sidebar-auth-login');
    }
}

function showPendingBlockedPageToast() {
    try {
        const blockedByVisibility = sessionStorage.getItem(PAGE_VISIBILITY_BLOCKED_NOTICE_KEY);
        if (blockedByVisibility) {
            sessionStorage.removeItem(PAGE_VISIBILITY_BLOCKED_NOTICE_KEY);
            showToast('هذه الصفحة غير متاحة حالياً', 'warning');
            return;
        }

        const blockedPage = sessionStorage.getItem(BLOCKED_REDIRECT_NOTICE_KEY);
        if (!blockedPage) return;
        sessionStorage.removeItem(BLOCKED_REDIRECT_NOTICE_KEY);
        showToast(`الصفحة ${blockedPage} غير متاحة في الوضع المحدود`, 'warning');
    } catch (_err) {
        // ignore
    }
}

async function resolveAccessState() {
    if (!window.api?.licensing?.getPublicStatus) return 'blocked';
    try {
        const res = await window.api.licensing.getPublicStatus();
        if (res?.success && res.status === 'trial') return 'trial';
        if (res?.success && res.status === 'trial_expired') {
            void openForcedActivationModal();
            return 'blocked';
        }
        if (res?.success && res.activated) return 'licensed';
    } catch (_err) {
        // ignore and fallback
    }
    return 'blocked';
}

function applyAppUi(authRole, accessState, session) {
    setAppAccessState(accessState);

    if (_isAuthenticatedRole(authRole) || accessState === 'licensed' || accessState === 'trial') {
        try {
            sessionStorage.removeItem(BLOCKED_REDIRECT_NEXT_KEY);
        } catch (_err) {
            // ignore
        }
    }

    applySessionToUI(session, authRole, accessState);
    applyNavigationRestrictions(authRole, accessState);
    applyPageVisibilityToDocument(authRole);
    ensureAdminAuthButton(authRole, accessState);
    refreshLimitedModeNotice(authRole, accessState);
    showPendingBlockedPageToast();

    setTimeout(() => {
        const currentRole = getCurrentAppRole();
        const currentAccess = getAppAccessState();
        applyNavigationRestrictions(currentRole, currentAccess);
        applyPageVisibilityToDocument(currentRole);
        ensureAdminAuthButton(currentRole, currentAccess);
        refreshLimitedModeNotice(currentRole, currentAccess);
    }, 120);
}

(async function enforceProtectedPagesAuth() {
    const currentPage = _getCurrentPageName();
    if (currentPage === 'login.html') return;

    let session = isAuthSessionActive() ? getAuthSessionData() : null;
    let authRole = _deriveAuthRoleFromSession(session);
    let accessState = 'blocked';

    if (window.api?.auth?.getSession) {
        try {
            const authRes = await window.api.auth.getSession();
            const role = _normalizeRole(authRes?.user?.role || '');
            const isAuth = ['admin', 'staff', 'viewer'].includes(role);
            if (authRes?.success && authRes?.authenticated && isAuth) {
                session = authRes.user || {};
                setAuthSession(session.email || '', session);
                authRole = role;
            } else {
                clearAuthSession();
                session = null;
                authRole = null;
            }
        } catch (_err) {
            clearAuthSession();
            session = null;
            authRole = null;
        }
    }

    // Always resolve access state from licensing (independent of auth)
    accessState = await resolveAccessState();

    await loadPageVisibilityState();

    if (!enforcePageRoleOrRedirect(authRole, accessState)) {
        return;
    }

    applyAppUi(authRole, accessState, session);

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

window.PageVisibility = {
    getCatalog: getPageVisibilityCatalog,
    getMap: getPageVisibilityMapSnapshot,
    loadState: loadPageVisibilityState,
    setVisibility: setPageVisibilityForAdmin,
    applyForCurrentRole: () => {
        const role = getCurrentAppRole();
        const access = getAppAccessState();
        applyNavigationRestrictions(role, access);
        applyPageVisibilityToDocument(role);
    }
};

// ===== XSS Protection =====
/**
 * حماية النص من هجمات XSS
 * @param {string} text - النص المراد تأمينه
 * @returns {string} - النص الآمن
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ===== Toast Messages =====
/**
 * عرض رسالة Toast
 * Delegates to the unified Notification Engine (js/notifications.js).
 * Kept as a thin wrapper so pages that load utils.js before notifications.js
 * still get a working showToast until the full script loads.
 */
function showToast(message, type = 'success', duration = 3000) {
    // If the unified SDK has loaded it will have set window.showToast.
    // Avoid infinite recursion: only delegate when window.showToast !== this function.
    if (window.showToast && window.showToast !== showToast) {
        return window.showToast(message, type, duration);
    }

    // Inline fallback (identical to js/notifications.js renderToast)
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = document.createElement('i');
    const iconClass = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    icon.className = `fas ${iconClass[type] || iconClass.info}`;

    const span = document.createElement('span');
    span.textContent = message;

    toast.appendChild(icon);
    toast.appendChild(span);
    container.appendChild(toast);

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
        'يناير',
        'فبراير',
        'مارس',
        'أبريل',
        'مايو',
        'يونيو',
        'يوليو',
        'أغسطس',
        'سبتمبر',
        'أكتوبر',
        'نوفمبر',
        'ديسمبر'
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
    const sidebar = document.getElementById('sidebar');

    // sidebar.js owns the canonical setup (toggle, expandable menus, active page).
    // If it already ran, skip all re-binding to avoid double-click issues.
    if (sidebar && sidebar.dataset.setupComplete === 'true') return;

    // Toggle sidebar
    const menuToggle = document.getElementById('menu-toggle');

    if (menuToggle && sidebar && menuToggle.dataset.toggleBound !== 'true') {
        menuToggle.dataset.toggleBound = 'true';
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                const sidebarWidth =
                    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width').trim() || '280px';
                mainContent.style.marginRight = sidebar.classList.contains('collapsed') ? '' : sidebarWidth;
            }
        });
    }

    // Expandable menu items
    document.querySelectorAll('.expandable > .nav-link').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            link.parentElement.classList.toggle('open');
        });
    });

    // Check for current page to mark active
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.sidebar-nav a').forEach((link) => {
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

    // Build year options dynamically
    const currentYear = new Date().getFullYear();
    const activeYear = typeof getSchoolYear === 'function' ? getSchoolYear() : `${currentYear}/${currentYear + 1}`;
    const yearOptions = [];
    for (let y = currentYear + 1; y >= currentYear - 3; y--) {
        const yStr = `${y}/${y + 1}`;
        yearOptions.push(`<option value="${yStr}"${yStr === activeYear ? ' selected' : ''}>${yStr}</option>`);
    }

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
                ${yearOptions.join('')}
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

    // Wire school-year select change
    const yearSelect = header.querySelector('#school-year');
    if (yearSelect) {
        yearSelect.addEventListener('change', () => {
            const chosen = yearSelect.value;
            if (typeof setSchoolYear === 'function') {
                setSchoolYear(chosen);
            }
        });
    }

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

// ===== Level Code Normalization (مصدر موحد لأسماء المستويات) =====
/**
 * القاموس المرجعي: رمز المستوى → { الاسم العربي, ترتيب العرض }
 * لإضافة مستوى جديد: أضف سطراً واحداً هنا فقط.
 */
const LEVEL_CODE_TO_AR = Object.freeze({
    TCSF: { name: 'الجذع المشترك العلمي خيار فرنسية', order: 1 },
    TCSA: { name: 'الجذع المشترك العلمي خيار عربية', order: 2 },
    TCS: { name: 'الجذع المشترك العلمي', order: 1 },
    TCLSH: { name: 'الجذع المشترك للآداب والعلوم الإنسانية', order: 3 },
    TCL: { name: 'الجذع المشترك للآداب والعلوم الإنسانية', order: 3 },
    TCTF: { name: 'الجذع المشترك التكنولوجي', order: 4 },
    '1BACSMF': { name: 'الأولى باكالوريا علوم رياضية خيار فرنسية', order: 5 },
    '1BACSMA': { name: 'الأولى باكالوريا علوم رياضية خيار عربية', order: 6 },
    '1BACSM': { name: 'الأولى باكالوريا العلوم الرياضية', order: 5 },
    '1BACSEF': { name: 'الأولى باكالوريا علوم تجريبية خيار فرنسية', order: 7 },
    '1BACSEA': { name: 'الأولى باكالوريا علوم تجريبية خيار عربية', order: 8 },
    '1BACSE': { name: 'الأولى باكالوريا علوم تجريبية', order: 7 },
    '1BACSH': { name: 'الأولى باكالوريا آداب وعلوم إنسانية', order: 9 },
    '1BACL': { name: 'الأولى باكالوريا آداب وعلوم إنسانية', order: 9 },
    '1BACSEG': { name: 'الأولى باكالوريا علوم الإقتصاد والتدبير', order: 10 },
    '1BACECO': { name: 'الأولى باكالوريا علوم الإقتصاد والتدبير', order: 10 },
    '1BACGE': { name: 'الأولى باكالوريا علوم الإقتصاد والتدبير', order: 10 },
    '2BACSMA': { name: 'الثانية باكالوريا علوم رياضية أ', order: 11 },
    '2BACSMB': { name: 'الثانية باكالوريا علوم رياضية ب', order: 12 },
    '2BACSM': { name: 'الثانية باكالوريا علوم رياضية', order: 11 },
    '2BACSVTF': { name: 'الثانية باكالوريا علوم الحياة والأرض', order: 13 },
    '2BACSVT': { name: 'الثانية باكالوريا علوم الحياة والأرض', order: 13 },
    '2BACPCF': { name: 'الثانية باكالوريا علوم فيزيائية خيار فرنسية', order: 14 },
    '2BACPC': { name: 'الثانية باكالوريا علوم فيزيائية', order: 14 },
    '2BACSPF': { name: 'الثانية باكالوريا علوم فيزيائية خيار فرنسية', order: 14 },
    '2BACSP': { name: 'الثانية باكالوريا علوم فيزيائية', order: 14 },
    '2BACSHF': { name: 'الثانية باكالوريا آداب وعلوم إنسانية', order: 15 },
    '2BACSH': { name: 'الثانية باكالوريا آداب وعلوم إنسانية', order: 15 },
    '2BACL': { name: 'الثانية باكالوريا آداب وعلوم إنسانية', order: 15 },
    '2BACLETF': { name: 'الثانية باكالوريا آداب', order: 16 },
    '2BACLET': { name: 'الثانية باكالوريا آداب', order: 16 },
    '2BACSECF': { name: 'الثانية باكالوريا علوم الإقتصاد والتدبير', order: 17 },
    '2BACSEC': { name: 'الثانية باكالوريا علوم الإقتصاد والتدبير', order: 17 },
    '2BACSE': { name: 'الثانية باكالوريا علوم الإقتصاد والتدبير', order: 17 },
    '2BACECO': { name: 'الثانية باكالوريا علوم الإقتصاد والتدبير', order: 17 },
    '2BACSGCF': { name: 'الثانية باكالوريا علوم التدبير المحاسباتي', order: 18 },
    '2BACSGC': { name: 'الثانية باكالوريا علوم التدبير المحاسباتي', order: 18 },
    '2BACGC': { name: 'الثانية باكالوريا علوم التدبير المحاسباتي', order: 18 },
    '2BACSA': { name: 'الثانية باكالوريا علوم شرعية', order: 19 },
    '2BACOAF': { name: 'الثانية باكالوريا تعليم أصيل', order: 20 },
    '2BACAO': { name: 'الثانية باكالوريا تعليم أصيل', order: 20 }
});
const _LEVEL_KEYS_DESC = Object.keys(LEVEL_CODE_TO_AR).sort((a, b) => b.length - a.length);

/**
 * تحويل رمز القسم إلى كائن { code, name, order }
 * @param {string} section - رمز القسم (مثل "TCSF-1")
 * @returns {{ code: string, name: string, order: number }}
 */
function getLevelFromSection(section) {
    if (!section) return { code: 'other', name: 'أخرى', order: 99 };
    const s = String(section).trim();
    const upper = s
        .toUpperCase()
        .replace(/[-_\s]?\d+$/, '')
        .trim();
    for (const key of _LEVEL_KEYS_DESC) {
        if (upper === key || upper.startsWith(key)) {
            const info = LEVEL_CODE_TO_AR[key];
            return { code: key.toLowerCase(), name: info.name, order: info.order };
        }
    }
    if (upper.startsWith('TC')) return { code: 'tc', name: 'الجذع المشترك', order: 90 };
    if (upper.startsWith('1BAC')) return { code: '1bac', name: 'الأولى باكالوريا', order: 91 };
    if (upper.startsWith('2BAC')) return { code: '2bac', name: 'الثانية باكالوريا', order: 92 };
    return { code: 'other', name: section, order: 99 };
}

/**
 * تحويل رمز القسم إلى الاسم العربي فقط (نص)
 * @param {string} section - رمز القسم
 * @returns {string} - الاسم العربي
 */
function getLevelNameFromSection(section) {
    return getLevelFromSection(section).name;
}

/**
 * استخراج اسم المستوى من القسم (للتصفية في التقارير)
 * Alias مستخدم في reports-semester.html
 * @param {string} section - رمز القسم
 * @returns {string} - الاسم العربي
 */
function extractLevelFromSection(section) {
    const s = String(section || '').trim();
    if (!s) return s;
    return getLevelNameFromSection(s);
}

/**
 * ترتيب أسماء المستويات حسب الترتيب التعليمي (الجذوع ← الأوليات ← الثانيات)
 * @param {string[]} levelNames - مصفوفة أسماء المستويات بالعربية
 * @returns {string[]} - مصفوفة مرتبة
 */
function sortLevelNames(levelNames) {
    // Build a map from Arabic level name → minimum order
    const nameOrderMap = {};
    for (const [, info] of Object.entries(LEVEL_CODE_TO_AR)) {
        if (!(info.name in nameOrderMap) || info.order < nameOrderMap[info.name]) {
            nameOrderMap[info.name] = info.order;
        }
    }
    return [...levelNames].sort((a, b) => {
        const orderA = nameOrderMap[a] ?? 99;
        const orderB = nameOrderMap[b] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        return String(a).localeCompare(String(b), 'ar');
    });
}

/**
 * ترتيب أسماء الأقسام حسب ترتيب المستوى أولاً، ثم أبجدياً داخل نفس المستوى
 * @param {string[]} sectionNames - مصفوفة أسماء الأقسام
 * @returns {string[]} - مصفوفة مرتبة
 */
function sortSectionNames(sectionNames) {
    return [...sectionNames].sort((a, b) => {
        const infoA = getLevelFromSection(a);
        const infoB = getLevelFromSection(b);
        if (infoA.order !== infoB.order) return infoA.order - infoB.order;
        return String(a).localeCompare(String(b), 'ar');
    });
}

/**
 * تعبئة قائمة أساتذة مجمّعة حسب المادة في عنصر <select>
 * @param {HTMLSelectElement} selectEl - عنصر القائمة المنسدلة
 * @param {Array} grades - مصفوفة النقاط (كل عنصر يحتوي على _teacherKey و _teacher و _subject)
 * @param {string} [defaultLabel='كل الأساتذة'] - نص الخيار الافتراضي
 * @returns {string[]} - قائمة مفاتيح الأساتذة المدرجة
 */
function populateTeachersBySubject(selectEl, grades, defaultLabel) {
    if (!selectEl) return [];
    defaultLabel = defaultLabel || 'كل الأساتذة';

    // Build teacher → subject frequency map
    const teacherSubjectCount = new Map();
    grades.forEach((g) => {
        if (!g._teacherKey || !g._teacher || !g._subject) return;
        if (!teacherSubjectCount.has(g._teacherKey)) {
            teacherSubjectCount.set(g._teacherKey, { teacher: g._teacher, subjects: new Map() });
        }
        const entry = teacherSubjectCount.get(g._teacherKey);
        const subMap = entry.subjects;
        subMap.set(g._subject, (subMap.get(g._subject) || 0) + 1);
    });

    // Find primary subject (most frequent) for each teacher
    const teacherPrimarySubject = new Map();
    teacherSubjectCount.forEach((entry, teacherKey) => {
        let maxSubject = '',
            maxCount = 0;
        entry.subjects.forEach((count, subject) => {
            if (count > maxCount) {
                maxCount = count;
                maxSubject = subject;
            }
        });
        teacherPrimarySubject.set(teacherKey, { teacher: entry.teacher, subject: maxSubject });
    });

    // Group teachers by primary subject
    const subjectTeachers = new Map();
    teacherPrimarySubject.forEach((entry, teacherKey) => {
        const key = entry.subject || 'أخرى';
        if (!subjectTeachers.has(key)) subjectTeachers.set(key, []);
        subjectTeachers.get(key).push({ key: teacherKey, label: entry.teacher });
    });

    // Sort subjects alphabetically, sort teachers within each group
    const sortedSubjects = Array.from(subjectTeachers.keys()).sort(
        typeof compareSubjects === 'function' ? compareSubjects : (a, b) => a.localeCompare(b, 'ar')
    );
    sortedSubjects.forEach((subj) => subjectTeachers.get(subj).sort((a, b) => a.label.localeCompare(b.label, 'ar')));

    // Populate the select element
    selectEl.innerHTML = `<option value="">${escapeHtml(defaultLabel)}</option>`;
    const allTeachers = [];
    sortedSubjects.forEach((subject) => {
        const sep = document.createElement('option');
        sep.disabled = true;
        sep.textContent = `──── ${subject} ────`;
        sep.style.fontWeight = '700';
        sep.style.color = '#3B6AC5';
        selectEl.appendChild(sep);

        subjectTeachers.get(subject).forEach((teacher) => {
            const o = document.createElement('option');
            o.value = teacher.key;
            o.textContent = teacher.label;
            selectEl.appendChild(o);
            allTeachers.push(teacher.key);
        });
    });

    return allTeachers;
}

// ===== Subject Name Normalization =====
// Delegated to translateSubject() from js/data/ma-education-labels.js
// Local cache for pages where ma-education-labels.js may not be loaded
const _utilsNormalizeCache = Object.create(null);
function normalizeSubjectName(subject) {
    const raw = String(subject || '');
    if (_utilsNormalizeCache[raw] !== undefined) return _utilsNormalizeCache[raw];
    const text = raw
        .replace(/\s*\(\s*(?:فرض|نشط)\s*[0-9\u0660-\u0669]+\s*\)\s*$/i, '')
        .replace(/\s*\(الأنشطة المندمجة\)\s*$/i, '')
        .trim();
    if (!text) {
        _utilsNormalizeCache[raw] = text;
        return text;
    }
    const result = typeof translateSubject === 'function' ? translateSubject(text) : text;
    _utilsNormalizeCache[raw] = result;
    return result;
}

// ===== Unified Subject List Builder =====
const INVALID_SUBJECT_NAMES = new Set([
    'sheet', 'sheet1', 'feuil1', 'notes', 'notescc', 'note', 'ورقة1', 'ورقة'
]);

/**
 * Build a normalized, sorted, deduplicated subject list from grade records.
 * @param {Array} grades - array of grade objects with .subject property
 * @param {Object} [options]
 * @param {string} [options.level] - filter by level name
 * @param {string} [options.section] - filter by section/class name
 * @param {Function} [options.getLevelName] - function to derive level from section
 * @returns {string[]} sorted normalized subject names
 */
function buildSubjectOptionsFromGrades(grades, options = {}) {
    let filtered = grades;
    if (options.section) {
        filtered = filtered.filter(g => (g.section || '') === options.section);
    } else if (options.level && typeof options.getLevelName === 'function') {
        filtered = filtered.filter(g => options.getLevelName(g.section) === options.level);
    }

    const subjects = new Set();
    filtered.forEach(g => {
        if (g.subject) {
            const normalized = normalizeSubjectName(g.subject);
            if (normalized && !INVALID_SUBJECT_NAMES.has(normalized.toLowerCase())) {
                subjects.add(normalized);
            }
        }
    });

    return Array.from(subjects).sort(
        typeof compareSubjects === 'function'
            ? compareSubjects
            : (a, b) => String(a).localeCompare(String(b), 'ar')
    );
}

/**
 * Build a normalized, sorted, deduplicated subject list from a raw Set/Array of subject names.
 * Used by timetable pages where subjects come from FET/XML imports (not grade records).
 * @param {Set|Array} subjectCollection - Set or Array of raw subject name strings
 * @returns {string[]} sorted normalized subject names
 */
function buildSubjectOptionsFromSet(subjectCollection) {
    const raw = subjectCollection instanceof Set ? Array.from(subjectCollection) : subjectCollection || [];
    const subjects = new Set();
    raw.forEach(name => {
        if (!name) return;
        const normalized = typeof normalizeSubjectName === 'function' ? normalizeSubjectName(name) : name;
        if (normalized && !INVALID_SUBJECT_NAMES.has(normalized.toLowerCase())) {
            subjects.add(normalized);
        }
    });
    return Array.from(subjects).sort(
        typeof compareSubjects === 'function'
            ? compareSubjects
            : (a, b) => String(a).localeCompare(String(b), 'ar')
    );
}

// ===== Dynamic School Year =====
const SCHOOL_YEAR_KEY = 'gsl_current_school_year';

function getSchoolYear() {
    return localStorage.getItem(SCHOOL_YEAR_KEY) || '2025/2026';
}

function setSchoolYear(newYear) {
    if (!newYear) return;
    localStorage.setItem(SCHOOL_YEAR_KEY, newYear);
    // Use no-auth endpoint specifically for school year to avoid auth rejection
    const saveToDb =
        window.api && window.api.settings && window.api.settings.setSchoolYear
            ? window.api.settings.setSchoolYear(newYear)
            : window.api && window.api.settings && window.api.settings.set
              ? window.api.settings.set('currentSchoolYear', newYear)
              : Promise.resolve();
    saveToDb.finally(() => {
        window.location.reload();
    });
}

async function initSchoolYear() {
    const localYear = localStorage.getItem(SCHOOL_YEAR_KEY);

    if (!localYear) {
        // localStorage is empty = first launch or cleared cache.
        // Use DB value as the source of truth.
        if (window.api && window.api.settings && window.api.settings.get) {
            try {
                const dbYear = await window.api.settings.get('currentSchoolYear');
                if (dbYear) {
                    localStorage.setItem(SCHOOL_YEAR_KEY, dbYear);
                } else {
                    localStorage.setItem(SCHOOL_YEAR_KEY, '2025/2026');
                }
            } catch (e) {
                console.error('Error fetching school year from DB:', e);
                localStorage.setItem(SCHOOL_YEAR_KEY, '2025/2026');
            }
        } else {
            localStorage.setItem(SCHOOL_YEAR_KEY, '2025/2026');
        }
    }
    // When localStorage already has a value (set by setSchoolYear after user choice),
    // keep it as-is. The DB will have been updated by setSchoolYear() already.

    // Sync the toolbar year select to match the resolved value
    const resolvedYear = localStorage.getItem(SCHOOL_YEAR_KEY);
    const yearSelect = document.getElementById('school-year');
    if (yearSelect && resolvedYear) {
        // Make sure the option exists in the select; if not, add it
        let opt = yearSelect.querySelector(`option[value="${resolvedYear}"]`);
        if (!opt) {
            opt = document.createElement('option');
            opt.value = resolvedYear;
            opt.textContent = resolvedYear;
            yearSelect.insertBefore(opt, yearSelect.firstChild);
        }
        yearSelect.value = resolvedYear;
    }
}

// ===== Auto-init =====
document.addEventListener('DOMContentLoaded', () => {
    initSchoolYear();
    setupUnifiedHeader();
    setupSidebar();

    const session = isAuthSessionActive() ? getAuthSessionData() : null;
    const authRole = _deriveAuthRoleFromSession(session);
    const accessState = getAppAccessState();
    applyAppUi(authRole, accessState, session);
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
        debounce,
        LEVEL_CODE_TO_AR,
        getLevelFromSection,
        getLevelNameFromSection,
        extractLevelFromSection,
        normalizeSubjectName,
        sortLevelNames,
        sortSectionNames,
        populateTeachersBySubject,
        getSchoolYear,
        setSchoolYear,
        getAppAccessState,
        setAppAccessState,
        getCurrentAppRole,
        lockScreen,
        isSessionLocked,
        openPinSetupModal
    };
}
