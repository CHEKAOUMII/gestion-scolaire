
function injectSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Check if sidebar is already injected
    if (sidebar.dataset.injected === 'true') return;

    sidebar.innerHTML = `
        <div class="school-info">
            <i class="fas fa-university"></i>
            <div class="school-details">
                <h3 id="sidebar-school-type">المؤسسة التعليمية</h3>
                <p id="sidebar-school-name">...</p>
            </div>
        </div>
        <nav class="sidebar-nav">
            <ul>
                <li><a href="index.html" class="nav-link"><i class="fas fa-chart-pie"></i><span>لوحة التحكم</span></a></li>
                <li class="expandable">
                    <a href="#" class="nav-link"><i class="fas fa-user-graduate"></i><span>التلاميذ</span><i class="fas fa-chevron-down arrow"></i></a>
                    <ul class="sub-menu">
                        <li><a href="students-list.html"><i class="fas fa-list"></i> لوائح التلاميذ</a></li>
                        <li><a href="students-register.html"><i class="fas fa-user-plus"></i> التسجيل والحركة العامة</a></li>
                        <li><a href="students-files.html"><i class="fas fa-folder-open"></i> ترتيب الملفات</a></li>
                        <li><a href="students-movement.html"><i class="fas fa-exchange-alt"></i> حركية التلاميذ</a></li>
                        <li><a href="student-profile-prototype.html"><i class="fas fa-user-circle"></i> ملف التلميذ</a></li>
                    </ul>
                </li>
                <li class="expandable">
                    <a href="#" class="nav-link"><i class="fas fa-chalkboard-teacher"></i><span>الأساتذة</span><i class="fas fa-chevron-down arrow"></i></a>
                    <ul class="sub-menu">
                        <li><a href="teachers-list.html"><i class="fas fa-users"></i> قائمة الأساتذة</a></li>
                        <li><a href="teachers-schedule.html"><i class="fas fa-clock"></i> حصص الأساتذة</a></li>
                        <li><a href="teachers-absence.html"><i class="fas fa-user-minus"></i> غياب الأساتذة</a></li>
                        <li><a href="teachers-performance.html"><i class="fas fa-chart-line"></i> مؤشرات الأداء</a></li>
                    </ul>
                </li>
                <li class="expandable">
                    <a href="#" class="nav-link"><i class="fas fa-calendar-alt"></i><span>تدبير الحصص</span><i class="fas fa-chevron-down arrow"></i></a>
                    <ul class="sub-menu">
                        <li><a href="timetable.html"><i class="fas fa-table"></i>جدول حصص الأساتذة</a></li>
                        <li><a href="timetable-students.html"><i class="fas fa-user-graduate"></i> جدول حصص التلاميذ</a></li>
                        <li><a href="timetable-rooms.html"><i class="fas fa-door-open"></i> جدول حصص القاعات</a></li>
                        <li><a href="timetable-teachers.html"><i class="fas fa-chalkboard-teacher"></i> جدول حصص الأساتذة</a></li>
                    </ul>
                </li>
                <li class="expandable">
                    <a href="#" class="nav-link"><i class="fas fa-chart-line"></i><span>التقويم والنتائج</span><i class="fas fa-chevron-down arrow"></i></a>
                    <ul class="sub-menu">
                        <li><a href="grades.html"><i class="fas fa-star"></i> النتائج والإحصائيات</a></li>
                        <li><a href="analytics.html"><i class="fas fa-chart-bar"></i> تحليل النتائج</a></li>
                        <li><a href="grades-sheets.html"><i class="fas fa-file-alt"></i> أوراق التنقيط</a></li>
                        <li><a href="grades-results.html"><i class="fas fa-file-invoice"></i> بيان النتائج</a></li>
                        <li><a href="studentzero.html"><i class="fas fa-exclamation-circle"></i> التلاميذ الحاصلون على صفر</a></li>
                        <li><a href="student-support.html"><i class="fas fa-hands-helping"></i> الدعم التربوي</a></li>
                    </ul>
                </li>
                <li class="expandable">
                    <a href="#" class="nav-link"><i class="fas fa-user-clock"></i><span>الغياب والمتابعة</span><i class="fas fa-chevron-down arrow"></i></a>
                    <ul class="sub-menu">
                        <li><a href="absence-weekly.html"><i class="fas fa-calendar-week"></i> ورقة الغياب الأسبوعية</a></li>
                        <li><a href="absence-students.html"><i class="fas fa-user-times"></i> غياب التلاميذ</a></li>
                        <li><a href="absence-correspondence.html"><i class="fas fa-envelope"></i> مراسلة الأولياء</a></li>
                        <li><a href="absence-analytics.html"><i class="fas fa-chart-bar"></i> إحصائيات الغياب</a></li>
                    </ul>
                </li>
                <li class="expandable">
                    <a href="#" class="nav-link"><i class="fas fa-file-signature"></i><span>مركز الامتحانات</span><i class="fas fa-chevron-down arrow"></i></a>
                    <ul class="sub-menu">
                        <li><a href="exams-schedule.html"><i class="fas fa-calendar-check"></i> برمجة الامتحانات</a></li>
                        <li><a href="exams-proctors.html"><i class="fas fa-user-shield"></i> توزيع الحراسة</a></li>
                        <li><a href="exams-rooms.html"><i class="fas fa-door-open"></i> قاعات الامتحان</a></li>
                        <li><a href="exams-tests.html"><i class="fas fa-clipboard-list"></i> تدبير الفروض</a></li>
                    </ul>
                </li>
                <li class="expandable">
                    <a href="#" class="nav-link"><i class="fas fa-file-alt"></i><span>التقارير والوثائق</span><i class="fas fa-chevron-down arrow"></i></a>
                    <ul class="sub-menu">
                        <li><a href="reports-certificates.html"><i class="fas fa-certificate"></i> الشواهد المدرسية</a></li>
                        <li><a href="reports-forms.html"><i class="fas fa-file-invoice"></i> الاستمارات الإدارية</a></li>
                        <li><a href="reports-semester.html"><i class="fas fa-chart-pie"></i> تقارير الفصل</a></li>
                    </ul>
                </li>
                <li class="expandable">
                    <a href="#" class="nav-link"><i class="fas fa-cog"></i><span>الإعدادات</span><i class="fas fa-chevron-down arrow"></i></a>
                    <ul class="sub-menu">
                        <li><a href="settings-school.html"><i class="fas fa-school"></i> معلومات المؤسسة</a></li>
                        <li><a href="settings-imports.html"><i class="fas fa-file-import"></i> استيراد البيانات</a></li>
                        <li><a href="settings-users.html"><i class="fas fa-users-cog"></i> المستخدمون</a></li>
                        <li><a href="settings-license.html"><i class="fas fa-key"></i> الترخيص والأجهزة</a></li>
                        <li><a href="settings-logs.html"><i class="fas fa-history"></i> سجل النشاطات</a></li>
                    </ul>
                </li>
                <!-- Prototypes Links for Review -->
                <li class="expandable">
                    <a href="#" class="nav-link"><i class="fas fa-paint-brush"></i><span>التصاميم الجديدة</span><i class="fas fa-chevron-down arrow"></i></a>
                    <ul class="sub-menu">
                        <li><a href="communication-center-prototype.html"><i class="fas fa-comments"></i> مركز التواصل (جديد)</a></li>
                    </ul>
                </li>
            </ul>
        </nav>
    `;

    sidebar.dataset.injected = 'true';

    // Load school name from database and update sidebar + page title
    loadSchoolIdentity();

    // Re-apply role-based navigation restrictions after sidebar injection.
    // This handles the timing gap: utils.js may run before sidebar.js,
    // so the navigation restrictions need to be re-applied once the sidebar exists.
    // We use both immediate and delayed calls because the auth check in utils.js is async.
    function _reapplyRoleUi() {
        if (typeof getCurrentAppRole !== 'function') return;
        const currentRole = getCurrentAppRole();
        if (typeof applyNavigationRestrictions === 'function') {
            applyNavigationRestrictions(currentRole);
        }
        if (typeof applyPageVisibilityToDocument === 'function') {
            applyPageVisibilityToDocument(currentRole);
        }
        if (typeof ensureAdminAuthButton === 'function') {
            ensureAdminAuthButton(currentRole);
        }
    }
    _reapplyRoleUi();
    setTimeout(_reapplyRoleUi, 250);

    // Mark current page as active
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.sidebar-nav a').forEach(link => {
        const href = link.getAttribute('href');
        if (href === currentPage) {
            link.classList.add('active');
            // Also open parent menu if exists
            const parent = link.closest('.expandable');
            if (parent) {
                parent.classList.add('open');
                const subMenu = parent.querySelector('.sub-menu');
                if (subMenu) subMenu.style.display = 'block';
            }
        }
    });

    // Setup expandable menu items
    document.querySelectorAll('.expandable > .nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const parent = link.parentElement;
            parent.classList.toggle('open');
            const subMenu = parent.querySelector('.sub-menu');
            if (subMenu) {
                subMenu.style.display = parent.classList.contains('open') ? 'block' : 'none';
            }
        });
    });

    // Setup sidebar toggle
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.style.marginRight = isCollapsed ? '80px' : '280px';
            }
            // When collapsing: clear inline submenu display so CSS !important hides them
            // When expanding: restore the active page's parent submenu
            if (isCollapsed) {
                sidebar.querySelectorAll('.sub-menu').forEach(sm => {
                    sm.style.display = '';
                });
            } else {
                // Re-open the submenu of the currently active page
                const activeLink = sidebar.querySelector('.nav-link.active, .sub-menu a.active');
                if (activeLink) {
                    const parent = activeLink.closest('.expandable');
                    if (parent) {
                        parent.classList.add('open');
                        const subMenu = parent.querySelector('.sub-menu');
                        if (subMenu) subMenu.style.display = 'block';
                    }
                }
            }
        });
    }
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
