function injectSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Check if sidebar is already injected
    if (sidebar.dataset.injected === 'true') return;

    sidebar.innerHTML = `
        <div class="school-info">
            <div class="school-icon">
                <i class="fas fa-university"></i>
            </div>
            <div class="school-details min-w-0">
                <h3 id="sidebar-school-type">المؤسسة التعليمية</h3>
                <p id="sidebar-school-name">...</p>
            </div>
        </div>
        <nav class="sidebar-nav flex-1 min-h-0 overflow-y-auto">
            <ul class="list-none">
                <li class="my-[2px] mx-[10px]"><a href="index.html" class="nav-link"><i class="fas fa-chart-pie"></i><span>لوحة التحكم</span></a></li>

                <li class="nav-section-label">إدارة الطلاب</li>

                <li class="expandable my-[2px] mx-[10px]">
                    <button type="button" class="nav-link nav-disclosure" aria-expanded="false" aria-controls="sidebar-students-submenu"><i class="fas fa-user-graduate"></i><span>التلاميذ</span><i class="fas fa-chevron-down arrow"></i></button>
                    <ul class="sub-menu" id="sidebar-students-submenu" hidden>
                        <li><a href="students-list.html"><i class="fas fa-list"></i> لوائح التلاميذ</a></li>
                        <li><a href="students-register.html"><i class="fas fa-user-plus"></i> التسجيل والحركة العامة</a></li>
                        <li><a href="students-files.html"><i class="fas fa-folder-open"></i> ترتيب الملفات</a></li>
                        <li><a href="students-movement.html"><i class="fas fa-exchange-alt"></i> حركية التلاميذ</a></li>
                        <li><a href="student-profile-prototype.html"><i class="fas fa-user-circle"></i> ملف التلميذ</a></li>
                        <li><a href="students-status.html"><i class="fas fa-user-slash"></i> الوضعية الدراسية</a></li>
                    </ul>
                </li>
                <li class="expandable my-[2px] mx-[10px]">
                    <button type="button" class="nav-link nav-disclosure" aria-expanded="false" aria-controls="sidebar-staff-submenu"><i class="fas fa-users-cog"></i><span>تدبير الموظفين</span><i class="fas fa-chevron-down arrow"></i></button>
                    <ul class="sub-menu" id="sidebar-staff-submenu" hidden>
                        <li><a href="teachers-list.html"><i class="fas fa-users"></i> قائمة الأساتذة</a></li>
                        <li><a href="teachers-schedule.html"><i class="fas fa-clock"></i> حصص الأساتذة</a></li>
                        <li><a href="teachers-absence.html"><i class="fas fa-user-minus"></i> غياب الأساتذة</a></li>
                        <li><a href="teachers-performance.html"><i class="fas fa-chart-line"></i> مؤشرات الأداء</a></li>
                        <li><a href="staff-attendance.html"><i class="fas fa-clipboard-check"></i> الحضور والغياب</a></li>
                        <li><a href="staff-daily-report.html"><i class="fas fa-file-alt"></i> التقرير اليومي</a></li>
                        <li><a href="compensation-tracking.html"><i class="fas fa-exchange-alt"></i> الحصص التعويضية</a></li>
                    </ul>
                </li>

                <li class="nav-section-label">التنظيم الدراسي</li>

                <li class="expandable my-[2px] mx-[10px]">
                    <button type="button" class="nav-link nav-disclosure" aria-expanded="false" aria-controls="sidebar-timetable-submenu"><i class="fas fa-calendar-alt"></i><span>تدبير الحصص</span><i class="fas fa-chevron-down arrow"></i></button>
                    <ul class="sub-menu" id="sidebar-timetable-submenu" hidden>
                        <li><a href="timetable.html"><i class="fas fa-table"></i>جدول حصص الأساتذة</a></li>
                        <li><a href="timetable-students.html"><i class="fas fa-user-graduate"></i> جدول حصص التلاميذ</a></li>
                        <li><a href="timetable-rooms.html"><i class="fas fa-door-open"></i> جدول حصص القاعات</a></li>
                        <li><a href="timetable-redistribution.html"><i class="fas fa-random"></i> إعادة توزيع الأقسام</a></li>
                        <li><a href="timetable-teachers.html"><i class="fas fa-chalkboard-teacher"></i> استعمال الزمن الأسبوعي</a></li>
                    </ul>
                </li>
                <li class="expandable my-[2px] mx-[10px]">
                    <button type="button" class="nav-link nav-disclosure" aria-expanded="false" aria-controls="sidebar-grades-submenu"><i class="fas fa-chart-line"></i><span>التقويم والنتائج</span><i class="fas fa-chevron-down arrow"></i></button>
                    <ul class="sub-menu" id="sidebar-grades-submenu" hidden>
                        <li><a href="grades.html"><i class="fas fa-star"></i> النتائج والإحصائيات</a></li>
                        <li><a href="analytics.html"><i class="fas fa-chart-bar"></i> تحليل النتائج</a></li>
                        <li><a href="grades-sheets.html"><i class="fas fa-file-alt"></i> أوراق التنقيط</a></li>
                        <li><a href="grades-results.html"><i class="fas fa-file-invoice"></i> بيان النتائج</a></li>
                        <li><a href="studentzero.html"><i class="fas fa-exclamation-circle"></i> التلاميذ الحاصلون على صفر</a></li>
                        <li><a href="student-support.html"><i class="fas fa-hands-helping"></i> الدعم التربوي</a></li>
                    </ul>
                </li>
                <li class="expandable my-[2px] mx-[10px]">
                    <button type="button" class="nav-link nav-disclosure" aria-expanded="false" aria-controls="sidebar-absence-submenu"><i class="fas fa-user-clock"></i><span>الغياب والمتابعة</span><i class="fas fa-chevron-down arrow"></i></button>
                    <ul class="sub-menu" id="sidebar-absence-submenu" hidden>
                        <li><a href="absence-weekly.html"><i class="fas fa-calendar-week"></i> ورقة الغياب الأسبوعية</a></li>
                        <li><a href="absence-students.html"><i class="fas fa-user-times"></i> غياب التلاميذ</a></li>
                        <li><a href="absence-correspondence.html"><i class="fas fa-envelope"></i> مراسلة الأولياء</a></li>
                        <li><a href="absence-analytics.html"><i class="fas fa-chart-bar"></i> إحصائيات الغياب</a></li>
                    </ul>
                </li>
                <li class="expandable my-[2px] mx-[10px]">
                    <button type="button" class="nav-link nav-disclosure" aria-expanded="false" aria-controls="sidebar-exams-submenu"><i class="fas fa-file-signature"></i><span>مركز الامتحانات</span><i class="fas fa-chevron-down arrow"></i></button>
                    <ul class="sub-menu" id="sidebar-exams-submenu" hidden>
                        <li><a href="exams-schedule.html"><i class="fas fa-calendar-check"></i> برمجة الامتحانات</a></li>
                        <li><a href="exams-proctors.html"><i class="fas fa-user-shield"></i> توزيع الحراسة</a></li>
                        <li><a href="exams-rooms.html"><i class="fas fa-door-open"></i> قاعات الامتحان</a></li>
                        <li><a href="exams-tests.html"><i class="fas fa-clipboard-list"></i> تدبير الفروض</a></li>
                    </ul>
                </li>

                <li class="nav-section-label">التقارير والنظام</li>

                <li class="expandable my-[2px] mx-[10px]">
                    <button type="button" class="nav-link nav-disclosure" aria-expanded="false" aria-controls="sidebar-reports-submenu"><i class="fas fa-file-alt"></i><span>التقارير والوثائق</span><i class="fas fa-chevron-down arrow"></i></button>
                    <ul class="sub-menu" id="sidebar-reports-submenu" hidden>
                        <li><a href="reports-certificates.html"><i class="fas fa-certificate"></i> الشواهد المدرسية</a></li>
                        <li><a href="reports-forms.html"><i class="fas fa-file-invoice"></i> الاستمارات الإدارية</a></li>
                        <li><a href="reports-semester.html"><i class="fas fa-chart-pie"></i> تقارير الفصل</a></li>
                    </ul>
                </li>
                <li class="expandable my-[2px] mx-[10px]">
                    <button type="button" class="nav-link nav-disclosure" aria-expanded="false" aria-controls="sidebar-settings-submenu"><i class="fas fa-cog"></i><span>الإعدادات</span><i class="fas fa-chevron-down arrow"></i></button>
                    <ul class="sub-menu" id="sidebar-settings-submenu" hidden>
                        <li><a href="settings-school.html"><i class="fas fa-school"></i> معلومات المؤسسة</a></li>
                        <li><a href="settings-imports.html"><i class="fas fa-file-import"></i> استيراد البيانات</a></li>
                        <li id="sidebar-users-link" class="hidden" data-dev-only><a href="settings-users.html"><i class="fas fa-users-cog"></i> المستخدمون</a></li>
                        <li><a href="settings-logs.html"><i class="fas fa-history"></i> سجل النشاطات</a></li>
                        <li id="sidebar-license-link" class="hidden" data-dev-only><a href="settings-license.html"><i class="fas fa-key"></i> الترخيص والأجهزة</a></li>
                        <li id="sidebar-sync-link"><a href="settings-sync.html"><i class="fas fa-cloud"></i> المزامنة السحابية <span class="sync-status-badge" id="sidebar-sync-badge"></span></a></li>
                    </ul>
                </li>
                <!-- Prototypes Links for Review -->
                <li class="expandable my-[2px] mx-[10px]">
                    <button type="button" class="nav-link nav-disclosure" aria-expanded="false" aria-controls="sidebar-prototypes-submenu"><i class="fas fa-paint-brush"></i><span>التصاميم الجديدة</span><i class="fas fa-chevron-down arrow"></i></button>
                    <ul class="sub-menu" id="sidebar-prototypes-submenu" hidden>
                        <li><a href="communication-center-prototype.html"><i class="fas fa-comments"></i> مركز التواصل (جديد)</a></li>
                    </ul>
                </li>
            </ul>
        </nav>
        <div class="sidebar-auth-section" id="sidebar-auth-section">
            <div class="sidebar-auth-user" id="sidebar-auth-user" style="display:none;">
                <div class="sidebar-auth-avatar shrink-0">
                    <i class="fas fa-user-circle text-[28px] text-[var(--color-primary)]"></i>
                </div>
                <div class="sidebar-auth-info flex min-w-0 flex-col gap-0.5">
                    <span class="sidebar-auth-name" id="sidebar-auth-name">المستخدم</span>
                    <span class="sidebar-auth-role" id="sidebar-auth-role-badge">Staff</span>
                </div>
            </div>
            <div class="sidebar-auth-actions" id="sidebar-auth-actions">
                <button type="button" class="sidebar-auth-btn sidebar-auth-lock group" id="sidebar-lock-btn" title="قفل الجلسة" style="display:none;">
                    <i class="fas fa-lock"></i>
                    <span>قفل الجلسة</span>
                </button>
                <button type="button" class="sidebar-auth-btn sidebar-auth-pin-setup group" id="sidebar-pin-setup-btn" title="إعداد رمز PIN" style="display:none;">
                    <i class="fas fa-fingerprint"></i>
                    <span>إعداد رمز PIN</span>
                </button>
                <button type="button" class="sidebar-auth-btn sidebar-auth-change-pw group" id="sidebar-change-pw-btn" title="تغيير كلمة المرور" style="display:none;">
                    <i class="fas fa-key"></i>
                    <span>تغيير كلمة المرور</span>
                </button>
                <button type="button" class="sidebar-auth-btn sidebar-auth-activate group" id="sidebar-activate-btn" title="تفعيل البرنامج" style="display:none;">
                    <i class="fas fa-key"></i>
                    <span>تفعيل البرنامج</span>
                </button>
                <button type="button" class="sidebar-auth-btn sidebar-auth-login group" id="sidebar-login-btn">
                    <i class="fas fa-user-shield"></i>
                    <span>تسجيل الدخول أو إنشاء حساب</span>
                </button>
            </div>
        </div>
    `;

    sidebar.dataset.injected = 'true';

    // ── Synchronous early-render from localStorage to prevent flash ──
    try {
        const rawSession = localStorage.getItem('gsl_auth_session_v1');
        if (rawSession) {
            const sess = JSON.parse(rawSession);
            const role = String(sess?.role || '').toLowerCase();
            if (['admin', 'staff', 'viewer', 'developer'].includes(role)) {
                const userSection = document.getElementById('sidebar-auth-user');
                const nameEl = document.getElementById('sidebar-auth-name');
                const loginBtn = document.getElementById('sidebar-login-btn');
                const changePwBtn = document.getElementById('sidebar-change-pw-btn');
                if (userSection) userSection.style.display = '';
                if (nameEl)
                    nameEl.textContent = String(
                        sess.name || sess.email || '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645'
                    ).trim();
                if (loginBtn) {
                    loginBtn.innerHTML =
                        '<i class="fas fa-sign-out-alt w-[18px] text-center text-sm text-[var(--color-primary)] transition-colors group-hover:text-white"></i><span>\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c</span>';
                    loginBtn.classList.remove('sidebar-auth-login');
                    loginBtn.classList.add('sidebar-auth-logout');
                }
                if (changePwBtn) changePwBtn.style.display = '';
                // Show developer-only links
                if (role === 'developer') {
                    const licenseLink = document.getElementById('sidebar-license-link');
                    if (licenseLink) licenseLink.classList.remove('hidden');
                    const usersLink = document.getElementById('sidebar-users-link');
                    if (usersLink) usersLink.classList.remove('hidden');
                }
            }
        }
    } catch (_) {
        /* ignore parse errors */
    }

    // Load school name from database and update sidebar + page title
    loadSchoolIdentity();

    // Re-apply role-based navigation restrictions after sidebar injection.
    // This handles the timing gap: utils.js may run before sidebar.js,
    // so the navigation restrictions need to be re-applied once the sidebar exists.
    // We use both immediate and delayed calls because the auth check in utils.js is async.
    function _reapplyRoleUi() {
        if (typeof getCurrentAppRole !== 'function') return;
        const currentRole = getCurrentAppRole();
        const currentAccess = typeof getAppAccessState === 'function' ? getAppAccessState() : 'blocked';
        if (typeof applyNavigationRestrictions === 'function') {
            applyNavigationRestrictions(currentRole, currentAccess);
        }
        if (typeof applyPageVisibilityToDocument === 'function') {
            applyPageVisibilityToDocument(currentRole);
        }
        if (typeof ensureAdminAuthButton === 'function') {
            ensureAdminAuthButton(currentRole, currentAccess);
        }
    }
    // Load page visibility state from DB before applying, to avoid race condition
    // where _pageVisibilityState is still null and falls back to hardcoded defaults.
    // The delayed re-apply must also wait for DB state to be loaded first.
    if (typeof loadPageVisibilityState === 'function') {
        const visibilityReady = loadPageVisibilityState();
        visibilityReady.then(() => {
            _reapplyRoleUi();
            // Second pass after a short delay (auth state may arrive late),
            // but only after DB visibility state is already loaded.
            setTimeout(_reapplyRoleUi, 500);
        });
    } else {
        _reapplyRoleUi();
        setTimeout(_reapplyRoleUi, 500);
    }

    // Mark current page as active
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.sidebar-nav a').forEach((link) => {
        const href = link.getAttribute('href');
        if (href === currentPage) {
            link.classList.add('active');
            // Also open parent menu if exists
            const parent = link.closest('.expandable');
            if (parent) {
                parent.classList.add('open');
                const disclosure = parent.querySelector('.nav-disclosure');
                const subMenu = parent.querySelector('.sub-menu');
                if (disclosure) disclosure.setAttribute('aria-expanded', 'true');
                if (subMenu) {
                    subMenu.hidden = false;
                    subMenu.style.display = 'block';
                }
            }
        }
    });

    // Mark sidebar setup as complete so utils.js setupSidebar() skips re-binding
    sidebar.dataset.setupComplete = 'true';

    // Setup expandable menu items
    document.querySelectorAll('.expandable > .nav-link').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const parent = link.parentElement;
            const isOpen = parent.classList.toggle('open');
            const subMenu = parent.querySelector('.sub-menu');
            link.setAttribute('aria-expanded', String(isOpen));
            if (subMenu) {
                subMenu.hidden = !isOpen;
                subMenu.style.display = isOpen ? 'block' : 'none';
            }
        });
    });

    // Setup sidebar toggle (canonical implementation — utils.js defers to this)
    const menuToggle = document.getElementById('menu-toggle');
    const mobileSidebarMedia = window.matchMedia('(max-width: 992px)');

    function closeMobileSidebar() {
        sidebar.classList.remove('mobile-open');
        document.body.classList.remove('sidebar-mobile-open');
    }

    function reopenActiveSubmenu() {
        const activeLink = sidebar.querySelector('.nav-link.active, .sub-menu a.active');
        if (!activeLink) return;

        const parent = activeLink.closest('.expandable');
        if (!parent) return;

        parent.classList.add('open');
        const disclosure = parent.querySelector('.nav-disclosure');
        const subMenu = parent.querySelector('.sub-menu');
        if (disclosure) disclosure.setAttribute('aria-expanded', 'true');
        if (subMenu) {
            subMenu.hidden = false;
            subMenu.style.display = 'block';
        }
    }

    function syncSidebarViewportState() {
        closeMobileSidebar();

        if (mobileSidebarMedia.matches) {
            sidebar.classList.remove('collapsed');
            reopenActiveSubmenu();
            return;
        }

        if (!sidebar.classList.contains('collapsed')) {
            reopenActiveSubmenu();
        }
    }

    if (menuToggle) {
        menuToggle.dataset.toggleBound = 'true';
        menuToggle.addEventListener('click', () => {
            if (mobileSidebarMedia.matches) {
                const isOpen = sidebar.classList.toggle('mobile-open');
                document.body.classList.toggle('sidebar-mobile-open', isOpen);
                return;
            }

            sidebar.classList.toggle('collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            // When collapsing: clear inline submenu display so CSS !important hides them
            // When expanding: restore the active page's parent submenu
            if (isCollapsed) {
                sidebar.querySelectorAll('.sub-menu').forEach((sm) => {
                    sm.hidden = true;
                    sm.style.display = '';
                });
                sidebar.querySelectorAll('.nav-disclosure').forEach((button) => {
                    button.setAttribute('aria-expanded', 'false');
                });
            } else {
                reopenActiveSubmenu();
            }
        });
    }

    document.addEventListener('click', (event) => {
        if (!mobileSidebarMedia.matches || !sidebar.classList.contains('mobile-open')) return;
        const clickInsideSidebar = sidebar.contains(event.target);
        const clickOnToggle = menuToggle?.contains(event.target);
        if (!clickInsideSidebar && !clickOnToggle) {
            closeMobileSidebar();
        }
    });

    window.addEventListener('resize', syncSidebarViewportState);
    syncSidebarViewportState();
}

/**
 * Load school identity from database and update the sidebar header + page title.
 * Called automatically after sidebar injection.
 */
async function loadSchoolIdentity() {
    try {
        if (!window.api?.reports?.getIdentity) return;
        const id = await window.api.reports.getIdentity();
        const fullName = (id?.school_name || '').trim();
        if (!fullName) return;

        // Try to split into type (e.g. "الثانوية التأهيلية") and name (e.g. "ابن سينا")
        // Common school type prefixes in Morocco
        const typePatterns = [
            'الثانوية التأهيلية',
            'الثانوية الإعدادية',
            'المدرسة الابتدائية',
            'مجموعة مدارس',
            'الثانوية',
            'الإعدادية',
            'المدرسة'
        ];

        let schoolType = '';
        let schoolName = fullName;

        for (const pattern of typePatterns) {
            if (fullName.startsWith(pattern)) {
                schoolType = pattern;
                schoolName = fullName.slice(pattern.length).trim();
                break;
            }
        }

        // If no pattern matched, use the full name as the school name
        if (!schoolType) {
            schoolType = 'المؤسسة التعليمية';
            schoolName = fullName;
        }

        // Update sidebar elements
        const typeEl = document.getElementById('sidebar-school-type');
        const nameEl = document.getElementById('sidebar-school-name');
        if (typeEl) typeEl.textContent = schoolType;
        if (nameEl) nameEl.textContent = schoolName;

        // Update page title
        const titleEl = document.querySelector('title');
        if (titleEl) {
            const pageName = titleEl.textContent.split('|')[0]?.trim() || 'برنامج التدبير المدرسي';
            titleEl.textContent = `${pageName} | ${fullName}`;
        }
    } catch (err) {
        console.warn('Could not load school identity for sidebar:', err);
    }
}

/** Refresh sidebar school name — callable from other pages (e.g. settings). */
window.refreshSidebarSchoolName = loadSchoolIdentity;

// Auto-inject on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSidebar);
} else {
    injectSidebar();
}

// Export for use in other scripts
window.injectSidebar = injectSidebar;
