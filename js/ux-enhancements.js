/**
 * UX Enhancements - Shared JavaScript
 * تحسينات تجربة المستخدم المشتركة لجميع الصفحات
 */

// ==================== Theme Management ====================
function updateThemeColor(theme) {
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeMeta) return;

    themeMeta.setAttribute('content', theme === 'dark' ? '#1b211e' : '#3b6ac5');
}

function initTheme() {
    const savedTheme = localStorage.getItem('app-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
    updateThemeColor(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('app-theme', newTheme);
    updateThemeIcon(newTheme);
    updateThemeColor(newTheme);

    // Show toast if available
    if (typeof showToast === 'function') {
        showToast(newTheme === 'dark' ? 'تم تفعيل الوضع الداكن' : 'تم تفعيل الوضع الفاتح', 'info');
    }
}

function updateThemeIcon(theme) {
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        const isDark = theme === 'dark';
        const label = toggle.querySelector('span');
        const icon = toggle.querySelector('i');
        if (label) {
            label.textContent = isDark ? 'السمة الفاتحة' : 'السمة الداكنة';
        }
        if (icon) {
            icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
            icon.setAttribute('aria-hidden', 'true');
        } else {
            toggle.innerHTML = isDark
                ? '<span>السمة الفاتحة</span><i class="fas fa-sun" aria-hidden="true"></i>'
                : '<span>السمة الداكنة</span><i class="fas fa-moon" aria-hidden="true"></i>';
        }
        toggle.setAttribute('aria-pressed', String(isDark));
        toggle.setAttribute('aria-label', isDark ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن');
        toggle.setAttribute('title', isDark ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن');
    }
}

function applySharedAccessibleNames(root = document) {
    if (!root?.querySelectorAll) return;

    root.querySelectorAll('button[title]:not([aria-label]), [role="button"][title]:not([aria-label])').forEach(
        (element) => {
            const title = element.getAttribute('title')?.trim();
            if (title) {
                element.setAttribute('aria-label', title);
            }
        }
    );

    const selectorLabels = [
        ['.menu-toggle', 'فتح القائمة الجانبية'],
        ['#theme-toggle', 'تبديل السمة'],
        ['#shortcuts-btn', 'اختصارات لوحة المفاتيح'],
        ['#backup-btn', 'إدارة النسخة الاحتياطية'],
        ['#quick-nav-toggle', 'فتح لوحة التنقل السريع'],
        ['#header-undo-btn', 'تراجع'],
        ['#header-redo-btn', 'إعادة'],
        ['.close-modal', 'إغلاق'],
        ['.close-btn', 'إغلاق'],
        ['.detail-close', 'إغلاق التفاصيل']
    ];

    selectorLabels.forEach(([selector, label]) => {
        root.querySelectorAll(`${selector}:not([aria-label])`).forEach((element) => {
            element.setAttribute('aria-label', label);
        });
    });

    root.querySelectorAll('button i, [role="button"] i').forEach((icon) => {
        if (!icon.hasAttribute('aria-hidden')) {
            icon.setAttribute('aria-hidden', 'true');
        }
    });
}

const DIALOG_FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(', ');

const dialogStateMap = new WeakMap();

function getFocusableElements(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR)).filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    });
}

function getDialogContent(dialog, options = {}) {
    if (!dialog) return null;
    if (options.contentSelector) {
        return dialog.querySelector(options.contentSelector) || dialog;
    }
    return dialog.querySelector('[role="dialog"], .shortcuts-content, .sl-modal, .import-confirm-box') || dialog;
}

function openDialog(dialog, options = {}) {
    if (!dialog) return;

    const existingState = dialogStateMap.get(dialog);
    if (existingState) {
        const focusTarget =
            (typeof options.initialFocus === 'string' && dialog.querySelector(options.initialFocus)) ||
            options.initialFocus ||
            getFocusableElements(existingState.content)[0] ||
            existingState.content;
        focusTarget?.focus();
        return;
    }

    const content = getDialogContent(dialog, options);
    if (!content) return;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const state = {
        content,
        previousActiveElement,
        onCloseRequest: options.onCloseRequest || null,
        activeClass: options.activeClass || 'active'
    };

    state.keydownHandler = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (typeof state.onCloseRequest === 'function') {
                state.onCloseRequest('escape');
            } else {
                closeDialog(dialog);
            }
            return;
        }

        if (event.key !== 'Tab') return;

        const focusableElements = getFocusableElements(content);
        if (!focusableElements.length) {
            event.preventDefault();
            content.focus();
            return;
        }

        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement;

        if (event.shiftKey && activeElement === firstFocusable) {
            event.preventDefault();
            lastFocusable.focus();
        } else if (!event.shiftKey && activeElement === lastFocusable) {
            event.preventDefault();
            firstFocusable.focus();
        }
    };

    if (!content.hasAttribute('tabindex')) {
        content.setAttribute('tabindex', '-1');
    }

    dialogStateMap.set(dialog, state);
    dialog.classList.add(state.activeClass);
    dialog.setAttribute('aria-hidden', 'false');
    dialog.addEventListener('keydown', state.keydownHandler);

    requestAnimationFrame(() => {
        const initialFocus =
            (typeof options.initialFocus === 'string' && dialog.querySelector(options.initialFocus)) ||
            options.initialFocus ||
            getFocusableElements(content)[0] ||
            content;
        initialFocus?.focus();
    });
}

function closeDialog(dialog, options = {}) {
    if (!dialog) return;

    const state = dialogStateMap.get(dialog);
    if (state?.keydownHandler) {
        dialog.removeEventListener('keydown', state.keydownHandler);
    }

    dialog.classList.remove(state?.activeClass || 'active');
    dialog.setAttribute('aria-hidden', 'true');
    dialogStateMap.delete(dialog);

    if (options.restoreFocus === false) return;

    const previousActiveElement = state?.previousActiveElement;
    if (previousActiveElement?.isConnected) {
        requestAnimationFrame(() => previousActiveElement.focus());
    }
}

// ==================== Keyboard Shortcuts ====================
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            if (e.key === 'Escape') {
                e.target.blur();
                closeAllUXModals();
            }
            return;
        }

        // Ctrl+P: Print Preview
        if (e.ctrlKey && e.key === 'p') {
            e.preventDefault();
            openPrintPreview();
        }

        // /: Focus search (if exists)
        if (e.key === '/' && !e.ctrlKey && !e.shiftKey) {
            const searchInput =
                document.querySelector('input[type="text"][placeholder*="بحث"]') ||
                document.querySelector('.search-box input');
            if (searchInput) {
                e.preventDefault();
                searchInput.focus();
            }
        }

        // ?: Show shortcuts
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            openShortcutsModal();
        }

        // Escape: Close modals
        if (e.key === 'Escape') {
            closeAllUXModals();
        }

        // Ctrl+K: Quick nav
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            toggleQuickNav();
        }
    });
}

function closeAllUXModals() {
    const shortcutsModal = document.getElementById('shortcuts-modal');
    const backupModal = document.getElementById('backup-modal');
    const quickNavPanel = document.getElementById('quick-nav-panel');
    const quickNavToggle = document.getElementById('quick-nav-toggle');

    closeDialog(shortcutsModal);
    closeDialog(backupModal);

    quickNavPanel?.classList.remove('open');
    quickNavPanel?.setAttribute('aria-hidden', 'true');

    quickNavToggle?.classList.remove('active');
    quickNavToggle?.setAttribute('aria-expanded', 'false');
}

function openShortcutsModal() {
    const shortcutsModal = document.getElementById('shortcuts-modal');
    openDialog(shortcutsModal, {
        contentSelector: '.shortcuts-content',
        initialFocus: '#shortcuts-close'
    });
}

function closeShortcutsModal() {
    const shortcutsModal = document.getElementById('shortcuts-modal');
    closeDialog(shortcutsModal);
}

// ==================== Quick Navigation Panel ====================
function initQuickNav() {
    const toggle = document.getElementById('quick-nav-toggle');
    const panel = document.getElementById('quick-nav-panel');
    const close = document.getElementById('quick-nav-close');
    const searchInput = document.getElementById('quick-nav-search-input');
    const pagesList = document.getElementById('quick-nav-pages-list');
    const tabs = Array.from(document.querySelectorAll('.quick-nav-tab'));
    const lists = Array.from(document.querySelectorAll('.quick-nav-list'));

    // Dynamically populate quick-nav from sidebar links (single source of truth)
    if (pagesList && !pagesList.children.length) {
        const sidebarLinks = document.querySelectorAll(
            '.sidebar .sub-menu a, .sidebar .sidebar-nav > ul > li > a.nav-link[href]:not([href="#"])'
        );
        sidebarLinks.forEach((link) => {
            const href = link.getAttribute('href');
            if (!href || href === '#') return;
            const icon = link.querySelector('i');
            const text = link.querySelector('span')?.textContent?.trim() || link.textContent.trim();
            if (!text) return;
            const navItem = document.createElement('a');
            navItem.href = href;
            navItem.className = 'quick-nav-item';
            navItem.innerHTML = `<i class="${icon ? icon.className : 'fas fa-link'}" aria-hidden="true"></i><span>${text}</span>`;
            pagesList.appendChild(navItem);
        });
    }

    panel?.setAttribute('aria-hidden', panel.classList.contains('open') ? 'false' : 'true');
    toggle?.setAttribute('aria-expanded', panel.classList.contains('open') ? 'true' : 'false');

    if (toggle) {
        toggle.addEventListener('click', toggleQuickNav);
    }

    if (close) {
        close.addEventListener('click', () => {
            panel?.classList.remove('open');
            panel?.setAttribute('aria-hidden', 'true');
            toggle?.classList.remove('active');
            toggle?.setAttribute('aria-expanded', 'false');
        });
    }

    // Tab switching
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            tabs.forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');

            const targetList = tab.dataset.navTab;
            lists.forEach((list) => {
                list.hidden = true;
            });
            const targetElement = document.getElementById('quick-nav-' + targetList);
            if (targetElement) {
                targetElement.hidden = false;
            }
        });
    });

    // Search filter
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterQuickNavItems(e.target.value);
        });
    }
}

function toggleQuickNav() {
    const panel = document.getElementById('quick-nav-panel');
    const toggle = document.getElementById('quick-nav-toggle');
    const isOpen = panel?.classList.toggle('open');
    toggle?.classList.toggle('active', isOpen);
    panel?.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    toggle?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    if (isOpen) {
        document.getElementById('quick-nav-search-input')?.focus();
    }
}

function filterQuickNavItems(query) {
    const items = document.querySelectorAll('.quick-nav-item');
    const lowerQuery = query.toLowerCase();
    items.forEach((item) => {
        if (item.dataset.pageVisibilityHidden === '1') {
            item.style.display = 'none';
            return;
        }
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(lowerQuery) ? 'flex' : 'none';
    });
}

const DASHBOARD_ONBOARDING_DISMISSED_KEY = 'dashboard_onboarding_dismissed_v1';

function initDashboardOnboarding() {
    const callout = document.getElementById('dashboard-onboarding-callout');
    if (!callout) return;

    const dismissed = localStorage.getItem(DASHBOARD_ONBOARDING_DISMISSED_KEY) === 'true';
    if (!dismissed) {
        callout.classList.remove('hidden');
    }

    const dismiss = () => {
        callout.classList.add('hidden');
        localStorage.setItem(DASHBOARD_ONBOARDING_DISMISSED_KEY, 'true');
    };

    document.getElementById('dashboard-onboarding-dismiss')?.addEventListener('click', dismiss, { once: true });

    document.getElementById('dashboard-onboarding-shortcuts')?.addEventListener('click', () => {
        dismiss();
        openShortcutsModal();
    });

    document.getElementById('shortcuts-btn')?.addEventListener(
        'click',
        () => {
            localStorage.setItem(DASHBOARD_ONBOARDING_DISMISSED_KEY, 'true');
            callout.classList.add('hidden');
        },
        { once: true }
    );
}

// ==================== Initialize All UX Enhancements ====================

function initUXEnhancements() {
    // Robust guard against multiple initializations in the same page session
    if (window.__uxInitialized) return;

    initTheme();
    initKeyboardShortcuts();
    initQuickNav();
    applySharedAccessibleNames();
    initDashboardOnboarding();

    // Theme toggle click handler (Event Delegation for robustness)
    document.addEventListener('click', (e) => {
        const toggle = e.target.closest('#theme-toggle');
        const headerTools = document.querySelector('.header-tools');
        const headerToolsAction = e.target.closest('.header-tools-btn');
        if (toggle) {
            toggleTheme();
            if (headerTools instanceof HTMLDetailsElement) {
                headerTools.open = false;
            }
            return;
        }

        if (headerToolsAction && headerTools instanceof HTMLDetailsElement) {
            headerTools.open = false;
        }

        if (headerTools instanceof HTMLDetailsElement && !e.target.closest('.header-tools')) {
            headerTools.open = false;
        }
    });

    // Shortcuts button click handler

    // Shortcuts button click handler
    document.getElementById('shortcuts-btn')?.addEventListener('click', () => {
        const headerTools = document.querySelector('.header-tools');
        if (headerTools instanceof HTMLDetailsElement) {
            headerTools.open = false;
        }
        openShortcutsModal();
    });
    document.getElementById('shortcuts-close')?.addEventListener('click', closeShortcutsModal);

    // Click outside shortcuts modal to close
    document.getElementById('shortcuts-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'shortcuts-modal') {
            closeShortcutsModal();
        }
    });

    window.__uxInitialized = true;
    console.log('✅ UX Enhancements initialized');
}

// 1. Apply theme immediately to prevent flashing
initTheme();

// 2. Auto-bind UI components on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUXEnhancements);
} else {
    initUXEnhancements();
}

// ==================== Shared Print Preview System ====================

let _printPreviewModal = null;
let _printPreviewOptions = {};
let _printPreviewLandscape = false;
let _savedThemeBeforePrint = null;

// ─── Force light theme for printing (global helpers) ───
function _forceLightThemeForPrint() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme === 'dark') {
        _savedThemeBeforePrint = 'dark';
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        _savedThemeBeforePrint = null;
    }
}

function _restoreThemeAfterPrint() {
    if (_savedThemeBeforePrint) {
        document.documentElement.setAttribute('data-theme', _savedThemeBeforePrint);
        updateThemeIcon(_savedThemeBeforePrint);
        _savedThemeBeforePrint = null;
    }
}

function _ensurePrintPreviewModal() {
    if (_printPreviewModal && document.body.contains(_printPreviewModal)) return;

    _printPreviewModal = document.createElement('div');
    _printPreviewModal.className = 'ux-pp-modal';
    _printPreviewModal.setAttribute('role', 'dialog');
    _printPreviewModal.setAttribute('aria-modal', 'true');
    _printPreviewModal.setAttribute('aria-label', 'معاينة الطباعة');
    _printPreviewModal.style.display = 'none';
    _printPreviewModal.innerHTML = `
        <div class="ux-pp-overlay" data-close="1"></div>
        <div class="ux-pp-dialog">
            <div class="ux-pp-header">
                <h3><i class="fas fa-eye"></i> معاينة الطباعة</h3>
                <button type="button" class="ux-pp-close" aria-label="إغلاق"><i class="fas fa-times"></i></button>
            </div>
            <div class="ux-pp-actions">
                <div class="ux-pp-orient-toggle" role="group" aria-label="اتجاه الصفحة">
                    <button type="button" class="ux-pp-orient-btn ux-pp-orient-portrait active">عمودي</button>
                    <button type="button" class="ux-pp-orient-btn ux-pp-orient-landscape">أفقي</button>
                </div>
                <div>
                    <button type="button" class="btn btn-primary ux-pp-print-btn"><i class="fas fa-print"></i> طباعة</button>
                    <button type="button" class="btn btn-success ux-pp-pdf-btn"><i class="fas fa-file-pdf"></i> PDF</button>
                </div>
            </div>
            <div class="ux-pp-page">
                <div class="ux-pp-sheet"></div>
            </div>
        </div>
    `;

    document.body.appendChild(_printPreviewModal);

    _printPreviewModal.querySelector('.ux-pp-close')?.addEventListener('click', closePrintPreviewGlobal);
    _printPreviewModal.querySelector('.ux-pp-overlay')?.addEventListener('click', closePrintPreviewGlobal);

    _printPreviewModal.querySelector('.ux-pp-orient-portrait')?.addEventListener('click', () => {
        _printPreviewLandscape = false;
        _updateOrientationUI();
    });

    _printPreviewModal.querySelector('.ux-pp-orient-landscape')?.addEventListener('click', () => {
        _printPreviewLandscape = true;
        _updateOrientationUI();
    });

    _printPreviewModal.querySelector('.ux-pp-print-btn')?.addEventListener('click', () => {
        void _executePrintFromPreview();
    });

    _printPreviewModal.querySelector('.ux-pp-pdf-btn')?.addEventListener('click', () => {
        void _exportPdfFromPreview();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && _printPreviewModal?.classList.contains('active')) {
            closePrintPreviewGlobal();
        }
    });
}

/**
 * openPrintPreview — opens an in-app A4 print preview modal.
 */
async function openPrintPreview(options = {}) {
    _printPreviewOptions = options;
    _printPreviewLandscape = !!options.landscape;
    _ensurePrintPreviewModal();
    _updateOrientationUI();

    const preparedSelector =
        options.contentSelector || (document.getElementById('support-export-sheet') ? '#support-export-sheet' : null);
    const sourceEl = preparedSelector
        ? document.querySelector(preparedSelector)
        : document.querySelector('.main-content') || document.querySelector('main');
    if (!sourceEl) {
        if (typeof showToast === 'function') showToast('لا يوجد محتوى للطباعة', 'warning');
        return;
    }

    const waitFor = typeof options.waitFor === 'function' ? options.waitFor() : options.waitFor;
    if (waitFor && typeof waitFor.then === 'function') {
        try {
            await waitFor;
        } catch (_) {
            // Ignore caller wait failures and continue with best-effort preview capture.
        }
    }

    // Force light theme BEFORE cloning so canvas images & colors are captured in light mode
    _forceLightThemeForPrint();

    const _hasCanvases = !!sourceEl.querySelector('canvas');
    if (_hasCanvases) {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const _doPreview = async () => {
        const clone = sourceEl.cloneNode(true);

        // When contentSelector or a prepared export sheet is provided, the caller already prepared the content.
        // Only do auto-cleanup when cloning raw page content.
        if (!preparedSelector) {
            // Strip UI controls from clone
            clone
                .querySelectorAll(
                    '.header, .print-header, .search-section, .sl-search-section, .search-form, .filter-section, .filters-section, .import-section, .stats-row, .edit-controls, .changes-summary-bar, .empty-state, .no-print, .toast-container, .loading-overlay, .menu-toggle, .theme-toggle, #print-btn, #print-preview-btn, #export-pdf-btn, #export-btn, .btn-print, .btn-export, .pagination, .sl-pagination, .report-empty-state, .timetable-print-actions, .filter-actions, .no-data-state, .table-toolbar, .page-title-row, .sl-results-header, .sl-results-actions, .sl-action-btn'
                )
                .forEach((el) => el.remove());
            // Hide last column (actions) in any table inside the clone
            clone.querySelectorAll('th:last-child, td:last-child').forEach((el) => {
                if (
                    el.querySelector('.sl-action-btn') ||
                    el.textContent.trim() === '' ||
                    el.textContent.includes('الإجراءات')
                ) {
                    el.style.display = 'none';
                }
            });
            // Force solid white backgrounds on glass/card elements (override CSS variables)
            clone
                .querySelectorAll(
                    '.glass-panel, .stat-card, .report-panel, .report-kpi-card, .card, details, .analysis-panel, .analysis-kpi-card, .analysis-block'
                )
                .forEach((el) => {
                    el.style.background = '#fff';
                    el.style.boxShadow = 'none';
                    el.style.backdropFilter = 'none';
                    el.style.webkitBackdropFilter = 'none';
                    el.style.animation = 'none';
                });
            // Remove IDs to avoid duplicates
            clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));

            // Ensure events table fills full width with Details column taking most space
            clone.querySelectorAll('.events-table').forEach((tbl) => {
                tbl.style.tableLayout = 'auto';
                tbl.style.width = '100%';
                tbl.querySelectorAll('.col-event-type').forEach((c) => { c.style.width = '14%'; c.style.whiteSpace = 'nowrap'; });
                tbl.querySelectorAll('.col-event-details').forEach((c) => { c.style.width = 'auto'; c.style.whiteSpace = 'normal'; c.style.wordBreak = 'break-word'; });
                tbl.querySelectorAll('.col-event-time').forEach((c) => { c.style.width = '10%'; c.style.whiteSpace = 'nowrap'; });
            });

            // Replace canvases with images
            const sourceCanvases = sourceEl.querySelectorAll('canvas');
            const cloneCanvases = clone.querySelectorAll('canvas');
            cloneCanvases.forEach((cc, i) => {
                const sc = sourceCanvases[i];
                if (!sc) {
                    cc.remove();
                    return;
                }
                try {
                    const img = document.createElement('img');
                    img.src = sc.toDataURL('image/png', 1);
                    img.alt = 'رسم بياني';
                    img.style.cssText =
                        'width:100%;height:auto;max-height:200px;object-fit:contain;display:block;border-radius:6px;';
                    cc.replaceWith(img);
                } catch {
                    cc.remove();
                }
            });
        }

        // Restore original theme now that clone + canvas snapshots are done
        _restoreThemeAfterPrint();

        // Build letterhead header (skip only when explicitly disabled via noHeader)
        let headerHTML = '';
        if (!options.noHeader) {
            try {
                const id = await window.api.reports.getIdentity();
                if (id && (id.school_name || id.ministry)) {
                    const _esc = (s) =>
                        String(s || '')
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;');
                    const logo = id.logo_base64
                        ? `<img src="data:image/png;base64,${id.logo_base64}" style="max-width: 300px; max-height: 300px;" alt="logo">`
                        : '<div style="width: 52px; height: 52px; border: 1px dashed var(--color-accent); border-radius: 50%; margin: 0 auto;"></div>';
                    const printTitle =
                        options.title || document.querySelector('.page-title h1')?.textContent || document.title || '';
                    headerHTML = `
                    <div class="ux-pp-letterhead" style="border-bottom: 2.5px solid var(--color-primary); padding-bottom: 10px; margin-bottom: 14px;">
                        <table style="width: 100%; border-collapse: collapse;" role="presentation">
                            <tr>
                                <td style="width: 45%; vertical-align: middle; text-align: center; padding: 0;">
                                    <div style="font-size: 11px; font-weight: 700; color: var(--color-text-main);">${_esc(id.country)}</div>
                                    <div style="font-size: 9.5px; color: var(--color-text-muted); margin-top: 2px;">${_esc(id.ministry)}</div>
                                    ${id.academy ? `<div style="font-size: 9px; color: var(--color-text-light); margin-top: 2px;">${_esc(id.academy)}</div>` : ''}
                                    ${id.directorate ? `<div style="font-size: 9px; color: var(--color-text-light); margin-top: 1px;">${_esc(id.directorate)}</div>` : ''}
                                </td>
                                <td style="width: 10%; text-align: center; vertical-align: middle;">${logo}</td>
                                <td style="width: 45%; vertical-align: middle; text-align: center; padding: 0;">
                                    <div style="font-size: 13px; font-weight: 800; color: var(--color-primary);">${_esc(id.school_name)}</div>
                                    ${id.school_code ? `<div style="font-size: 9px; color: var(--color-text-light); margin-top: 2px;">رمز المؤسسة: ${_esc(id.school_code)}</div>` : ''}
                                    ${id.commune ? `<div style="font-size: 9px; color: var(--color-text-light); margin-top: 1px;">الجماعة: ${_esc(id.commune)}</div>` : ''}
                                    ${document.getElementById('school-year')?.value || id.school_year ? `<div style="font-size: 9px; color: var(--color-text-light); margin-top: 1px;">السنة الدراسية: ${_esc(document.getElementById('school-year')?.value || id.school_year)}</div>` : ''}
                                </td>
                            </tr>
                        </table>
                        ${printTitle
                            ? (() => {
                                const reportDate =
                                    document.getElementById('print-date-display')?.textContent?.trim() ||
                                    document.getElementById('date-display')?.textContent?.trim() ||
                                    '';
                                return `
                        <div style="text-align: center; margin-top: 12px;">
                            <div style="display: inline-block; padding: 7px 30px; border: 2px solid var(--color-primary); border-radius: 8px; background: var(--color-primary-mist);">
                                <div style="font-size: 17px; font-weight: 800; color: var(--color-primary);">${_esc(printTitle)}</div>
                                ${reportDate ? `<div style="font-size: 13px; font-weight: 600; color: var(--color-text-muted); margin-top: 4px;">${_esc(reportDate)}</div>` : ''}
                            </div>
                        </div>`;
                            })()
                            : ''
                        }
                    </div>`;
                }
            } catch (_) {
                // Identity not available — fall back to simple header
                const printTitle = options.title || document.title || 'طباعة';
                const now = new Date();
                const dateStr = now.toLocaleDateString('ar-MA', { year: 'numeric', month: 'long', day: 'numeric' });
                headerHTML = `<div class="ux-pp-print-header">
                    <div class="ux-pp-doc-title">${printTitle}</div>
                    <div class="ux-pp-doc-date">${dateStr}</div>
                </div>`;
            }
        }

        const sheet = _printPreviewModal.querySelector('.ux-pp-sheet');
        // Force sheet to use light theme for the preview
        sheet.setAttribute('data-theme', 'light');
        sheet.replaceChildren();
        if (headerHTML) {
            const template = document.createElement('template');
            template.innerHTML = headerHTML;
            sheet.appendChild(template.content);
        }
        sheet.appendChild(clone);
        _printPreviewModal.classList.add('active');
        _printPreviewModal.style.display = 'flex';
        document.body.classList.add('ux-preview-open');

        _updateOrientationUI();
    };
    return _doPreview();
}

function closePrintPreviewGlobal() {
    if (_printPreviewModal) {
        _printPreviewModal.classList.remove('active');
        _printPreviewModal.style.display = 'none';
        const sheet = _printPreviewModal.querySelector('.ux-pp-sheet');
        if (sheet) sheet.replaceChildren();
    }
    document.body.classList.remove('ux-preview-open');
}

function _updateOrientationUI() {
    if (!_printPreviewModal) return;
    const page = _printPreviewModal.querySelector('.ux-pp-page');
    const sheet = _printPreviewModal.querySelector('.ux-pp-sheet');
    const btnL = _printPreviewModal.querySelector('.ux-pp-orient-landscape');
    const btnP = _printPreviewModal.querySelector('.ux-pp-orient-portrait');
    if (page) page.classList.toggle('landscape', _printPreviewLandscape);
    if (btnL) btnL.classList.toggle('active', _printPreviewLandscape);
    if (btnP) btnP.classList.toggle('active', !_printPreviewLandscape);
    // Visually resize the A4 sheet in the preview
    if (sheet) {
        if (_printPreviewLandscape) {
            sheet.style.width = '297mm';
            sheet.style.minHeight = '210mm';
        } else {
            sheet.style.width = '210mm';
            sheet.style.minHeight = '297mm';
        }
    }
}

function _captureSheetContent() {
    if (!_printPreviewModal) return null;
    const sheet = _printPreviewModal.querySelector('.ux-pp-sheet');
    return sheet ? sheet.cloneNode(true) : null;
}

function _enablePrintMode(capturedSheet) {
    _forceLightThemeForPrint();
    let root = document.getElementById('ux-print-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'ux-print-root';
        document.body.appendChild(root);
    }
    root.replaceChildren();
    if (capturedSheet) {
        Array.from(capturedSheet.childNodes).forEach((node) => {
            root.appendChild(node.cloneNode(true));
        });
    }
    document.body.classList.add('ux-printing-active');
    document.body.classList.toggle('ux-print-landscape', _printPreviewLandscape);

    // Inject @page CSS rule so printToPDF / printCurrentWindow respects orientation
    let pageStyle = document.getElementById('ux-print-page-rule');
    if (!pageStyle) {
        pageStyle = document.createElement('style');
        pageStyle.id = 'ux-print-page-rule';
        document.head.appendChild(pageStyle);
    }
    const pageSize = _printPreviewOptions.pageSize || 'A4';
    const orient = _printPreviewLandscape ? 'landscape' : 'portrait';
    pageStyle.textContent = `@page { size: ${pageSize} ${orient}; margin: 5mm 4mm; }`;
}

function _disablePrintMode() {
    document.body.classList.remove('ux-printing-active', 'ux-print-landscape');
    const root = document.getElementById('ux-print-root');
    if (root) root.replaceChildren();
    // Remove the injected @page rule
    document.getElementById('ux-print-page-rule')?.remove();
    _restoreThemeAfterPrint();
}

async function _executePrintFromPreview() {
    const capturedSheet = _captureSheetContent();
    if (!capturedSheet) return;
    closePrintPreviewGlobal();
    _enablePrintMode(capturedSheet);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
        if (window.api?.system?.printCurrentWindow) {
            await window.api.system.printCurrentWindow({
                printBackground: true,
                pageSize: _printPreviewOptions.pageSize || 'A4',
                landscape: _printPreviewLandscape,
                margins: { marginType: 'custom', top: 0.2, bottom: 0.2, left: 0.16, right: 0.16 }
            });
        } else {
            window.print();
        }
    } finally {
        _disablePrintMode();
    }
}

async function _exportPdfFromPreview() {
    const capturedSheet = _captureSheetContent();
    if (!capturedSheet) return;
    closePrintPreviewGlobal();
    _enablePrintMode(capturedSheet);
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
        if (window.api?.system?.printToPDF) {
            const result = await window.api.system.printToPDF({
                printBackground: true,
                pageSize: _printPreviewOptions.pageSize || 'A4',
                landscape: _printPreviewLandscape,
                margins: { top: 0.2, bottom: 0.2, left: 0.16, right: 0.16 }
            });
            if (result?.success && typeof showToast === 'function') {
                showToast('تم تصدير الملف بنجاح', 'success');
            }
        } else {
            window.print();
        }
    } finally {
        _disablePrintMode();
    }
}

async function electronPrint(options = {}) {
    if (options.htmlContent && window.api?.system?.printHTML) {
        return await window.api.system.printHTML(options);
    }
    openPrintPreview(options);
    return { success: true };
}

// ==================== Auto-Updater Notification UI ====================

let _updateBanner = null;

function _ensureUpdateBanner() {
    if (_updateBanner && document.body.contains(_updateBanner)) return;

    _updateBanner = document.createElement('div');
    _updateBanner.id = 'ux-update-banner';
    _updateBanner.className = 'ux-update-banner';
    _updateBanner.setAttribute('role', 'alert');
    _updateBanner.innerHTML = `
        <div class="ux-update-icon"><i class="fas fa-arrow-circle-up"></i></div>
        <div class="ux-update-body">
            <div class="ux-update-title"></div>
            <div class="ux-update-subtitle"></div>
            <div class="ux-update-progress" style="display:none">
                <div class="ux-update-progress-bar"><div class="ux-update-progress-fill"></div></div>
                <span class="ux-update-progress-text">0%</span>
            </div>
        </div>
        <div class="ux-update-actions">
            <button class="ux-update-btn ux-update-download" style="display:none">تحميل</button>
            <button class="ux-update-btn ux-update-install" style="display:none">تثبيت وإعادة التشغيل</button>
            <button class="ux-update-close" title="إغلاق">&times;</button>
        </div>
    `;
    document.body.appendChild(_updateBanner);

    // Download button
    _updateBanner.querySelector('.ux-update-download').addEventListener('click', async () => {
        if (window.api?.updater?.downloadUpdate) {
            const btn = _updateBanner.querySelector('.ux-update-download');
            btn.disabled = true;
            btn.textContent = 'جاري التحميل...';
            try {
                const result = await window.api.updater.downloadUpdate();
                if (result && !result.success) {
                    btn.textContent = 'إعادة المحاولة';
                    btn.disabled = false;
                    console.error('[updater-ui] Download failed:', result.error);
                }
            } catch (err) {
                btn.textContent = 'إعادة المحاولة';
                btn.disabled = false;
                console.error('[updater-ui] Download error:', err);
            }
        }
    });

    // Install button
    _updateBanner.querySelector('.ux-update-install').addEventListener('click', () => {
        if (window.api?.updater?.installUpdate) {
            window.api.updater.installUpdate();
        }
    });

    // Close button
    _updateBanner.querySelector('.ux-update-close').addEventListener('click', () => {
        _updateBanner.classList.remove('visible');
    });
}

function _showUpdateBanner(state) {
    _ensureUpdateBanner();
    const title = _updateBanner.querySelector('.ux-update-title');
    const subtitle = _updateBanner.querySelector('.ux-update-subtitle');
    const progress = _updateBanner.querySelector('.ux-update-progress');
    const progressFill = _updateBanner.querySelector('.ux-update-progress-fill');
    const progressText = _updateBanner.querySelector('.ux-update-progress-text');
    const downloadBtn = _updateBanner.querySelector('.ux-update-download');
    const installBtn = _updateBanner.querySelector('.ux-update-install');
    const icon = _updateBanner.querySelector('.ux-update-icon i');

    switch (state.status) {
        case 'available':
            icon.className = 'fas fa-arrow-circle-up';
            title.textContent = `تحديث جديد متوفر: v${state.version}`;
            subtitle.textContent = 'يتوفر إصدار جديد من البرنامج';
            progress.style.display = 'none';
            downloadBtn.style.display = 'inline-flex';
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'تحميل';
            installBtn.style.display = 'none';
            _updateBanner.classList.add('visible');
            break;

        case 'downloading':
            icon.className = 'fas fa-cloud-download-alt';
            title.textContent = 'جاري تحميل التحديث...';
            subtitle.textContent = `${state.percent}% مكتمل`;
            progress.style.display = 'flex';
            progressFill.style.width = state.percent + '%';
            progressText.textContent = state.percent + '%';
            downloadBtn.style.display = 'none';
            installBtn.style.display = 'none';
            _updateBanner.classList.add('visible');
            break;

        case 'downloaded':
            icon.className = 'fas fa-check-circle';
            title.textContent = `تم تحميل التحديث v${state.version}`;
            subtitle.textContent = 'أعد تشغيل البرنامج لتثبيت التحديث';
            progress.style.display = 'none';
            downloadBtn.style.display = 'none';
            installBtn.style.display = 'inline-flex';
            _updateBanner.classList.add('visible');
            break;

        case 'error':
            icon.className = 'fas fa-exclamation-triangle';
            title.textContent = 'خطأ في التحديث';
            subtitle.textContent = state.error || 'تعذر التحقق من التحديثات';
            progress.style.display = 'none';
            downloadBtn.style.display = 'none';
            installBtn.style.display = 'none';
            _updateBanner.classList.add('visible');
            // Auto-hide errors after 8 seconds
            setTimeout(() => _updateBanner?.classList.remove('visible'), 8000);
            break;

        default:
            // 'checking', 'up-to-date': do nothing visible
            break;
    }
}

function initUpdaterUI() {
    if (!window.api?.updater?.onStatus) return;

    window.api.updater.onStatus((data) => {
        _showUpdateBanner(data);
    });

    console.log('[updater-ui] Update notification listener active');
}

// Initialize updater UI on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpdaterUI);
} else {
    // Small delay to ensure preload API is available
    setTimeout(initUpdaterUI, 100);
}

// ─── Shared Letterhead Builder ───
// Used by grades-sheets, students-list, studentzero, teachers-list, etc.
function buildLetterheadHTML(id, year) {
    if (!id || (!id.school_name && !id.ministry)) return '';
    const e = (v) => {
        if (!v) return '';
        const d = document.createElement('div');
        d.textContent = v;
        return d.innerHTML;
    };
    const logo = id.logo_base64
        ? `<img src="data:image/png;base64,${id.logo_base64}" style="max-width:300px;max-height:300px;" alt="logo">`
        : '<div style="width:52px;height:52px;border:1px dashed var(--color-accent);border-radius:50%;margin:0 auto;"></div>';
    return `
    <div class="gs-letterhead" style="border-bottom:2.5px solid var(--color-primary);padding-bottom:10px;margin-bottom:14px;">
        <table style="width:100%;border-collapse:collapse;" role="presentation">
            <tr>
                <td style="width:45%;vertical-align:middle;text-align:center;padding:0;">
                    <div style="font-size:11px;font-weight:700;color:var(--color-text-main);">${e(id.country || '')}</div>
                    <div style="font-size:9.5px;color:var(--color-text-muted);margin-top:2px;">${e(id.ministry || '')}</div>
                    ${id.academy ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:2px;">${e(id.academy)}</div>` : ''}
                    ${id.directorate ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:1px;">${e(id.directorate)}</div>` : ''}
                </td>
                <td style="width:10%;text-align:center;vertical-align:middle;">${logo}</td>
                <td style="width:45%;vertical-align:middle;text-align:center;padding:0;">
                    <div style="font-size:13px;font-weight:800;color:var(--color-primary);">${e(id.school_name || '')}</div>
                    ${id.school_code ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:2px;">رمز المؤسسة: ${e(id.school_code)}</div>` : ''}
                    ${id.commune ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:1px;">الجماعة: ${e(id.commune)}</div>` : ''}
                    ${year ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:1px;">السنة الدراسية: ${e(year)}</div>` : id.school_year ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:1px;">السنة الدراسية: ${e(id.school_year)}</div>` : ''}
                </td>
            </tr>
        </table>
    </div>`;
}

function buildSharedPaletteEntry(
    lightBg,
    lightBorder,
    lightText,
    darkBg,
    darkBorder = lightBorder,
    darkText = lightText
) {
    return {
        light: { bg: lightBg, border: lightBorder, text: lightText },
        dark: { bg: darkBg, border: darkBorder, text: darkText }
    };
}

function getSharedSubjectPalette() {
    return [
        buildSharedPaletteEntry(
            'var(--color-primary-mist)',
            'var(--color-primary-light)',
            'var(--color-primary-dark)',
            'var(--color-primary-mist)',
            'var(--color-primary-light)',
            'var(--color-info-text)'
        ),
        buildSharedPaletteEntry(
            'var(--color-info-surface)',
            'var(--color-info-border)',
            'var(--color-info-text)',
            'var(--color-info-surface)'
        ),
        buildSharedPaletteEntry(
            'var(--color-warning-surface)',
            'var(--color-warning-border)',
            'var(--color-warning-text)',
            'var(--color-warning-surface)'
        ),
        buildSharedPaletteEntry(
            'var(--color-success-surface)',
            'var(--color-success-border)',
            'var(--color-success-text)',
            'var(--color-success-surface)'
        ),
        buildSharedPaletteEntry(
            'var(--color-danger-surface)',
            'var(--color-danger-border)',
            'var(--color-danger-text)',
            'var(--color-danger-surface)'
        ),
        buildSharedPaletteEntry(
            'var(--color-neutral-surface)',
            'var(--color-neutral-border)',
            'var(--color-text-main)',
            'var(--color-neutral-surface)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--avatar-color-2) 16%, transparent)',
            'var(--avatar-color-2)',
            'var(--color-primary-dark)',
            'color-mix(in srgb, var(--avatar-color-2) 20%, transparent)',
            'var(--avatar-color-2)',
            'var(--color-info-text)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--avatar-color-3) 16%, transparent)',
            'var(--avatar-color-3)',
            'var(--avatar-color-3)',
            'color-mix(in srgb, var(--avatar-color-3) 20%, transparent)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--avatar-color-4) 16%, transparent)',
            'var(--avatar-color-4)',
            'var(--avatar-color-4)',
            'color-mix(in srgb, var(--avatar-color-4) 20%, transparent)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--avatar-color-5) 16%, transparent)',
            'var(--avatar-color-5)',
            'var(--avatar-color-5)',
            'color-mix(in srgb, var(--avatar-color-5) 20%, transparent)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--avatar-color-6) 16%, transparent)',
            'var(--avatar-color-6)',
            'var(--avatar-color-6)',
            'color-mix(in srgb, var(--avatar-color-6) 20%, transparent)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--avatar-color-7) 16%, transparent)',
            'var(--avatar-color-7)',
            'var(--avatar-color-7)',
            'color-mix(in srgb, var(--avatar-color-7) 20%, transparent)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--avatar-color-8) 16%, transparent)',
            'var(--avatar-color-8)',
            'var(--avatar-color-8)',
            'color-mix(in srgb, var(--avatar-color-8) 20%, transparent)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--color-female) 16%, transparent)',
            'var(--color-female)',
            'var(--color-female)',
            'color-mix(in srgb, var(--color-female) 20%, transparent)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--color-male) 16%, transparent)',
            'var(--color-male)',
            'var(--color-male)',
            'color-mix(in srgb, var(--color-male) 20%, transparent)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--color-grade-average) 16%, transparent)',
            'var(--color-grade-average)',
            'var(--color-warning-text)',
            'color-mix(in srgb, var(--color-grade-average) 20%, transparent)',
            'var(--color-grade-average)',
            'var(--color-warning-text)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--color-grade-good) 16%, transparent)',
            'var(--color-grade-good)',
            'var(--color-success-text)',
            'color-mix(in srgb, var(--color-grade-good) 20%, transparent)',
            'var(--color-grade-good)',
            'var(--color-success-text)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--color-grade-excellent) 16%, transparent)',
            'var(--color-grade-excellent)',
            'var(--color-success-text)',
            'color-mix(in srgb, var(--color-grade-excellent) 20%, transparent)',
            'var(--color-grade-excellent)',
            'var(--color-success-text)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--color-grade-poor) 16%, transparent)',
            'var(--color-grade-poor)',
            'var(--color-danger-text)',
            'color-mix(in srgb, var(--color-grade-poor) 20%, transparent)',
            'var(--color-grade-poor)',
            'var(--color-danger-text)'
        ),
        buildSharedPaletteEntry(
            'color-mix(in srgb, var(--color-total) 16%, transparent)',
            'var(--color-total)',
            'var(--color-primary-dark)',
            'color-mix(in srgb, var(--color-total) 20%, transparent)',
            'var(--color-total)',
            'var(--color-info-text)'
        )
    ];
}

function getSharedChartPalette() {
    return [
        'var(--color-primary)',
        'var(--color-info)',
        'var(--color-warning)',
        'var(--avatar-color-3)',
        'var(--color-danger)',
        'var(--color-success)',
        'var(--avatar-color-4)'
    ];
}
window.buildLetterheadHTML = buildLetterheadHTML;

// ==================== Sync Status Indicator (US5) ====================

function initSyncIndicator() {
    try {
        const badge = document.getElementById('sidebar-sync-badge');
        if (!badge || !window.api?.sync?.getStatus) return;

        async function updateSyncBadge() {
            try {
                const status = await window.api.sync.getStatus();
                // Derive state
                let state = 'disabled';
                if (status && status.enabled) {
                    if (status.pushRunning || status.pullRunning || status.snapshotRunning) {
                        state = 'syncing';
                    } else if (!status.authenticated) {
                        state = 'offline';
                    } else if (status.lastPushError || status.lastPullError) {
                        state = 'error';
                    } else {
                        state = 'connected';
                    }
                }

                // Update badge classes
                badge.classList.remove(
                    'sync-badge-connected',
                    'sync-badge-syncing',
                    'sync-badge-offline',
                    'sync-badge-error',
                    'sync-badge-disabled'
                );
                badge.classList.add('sync-badge-' + state);

                // Set tooltip
                const labels = {
                    connected: 'متصل',
                    syncing: 'جاري المزامنة',
                    offline: 'غير متصل',
                    error: 'خطأ في المزامنة',
                    disabled: 'المزامنة معطلة'
                };
                badge.title = labels[state] || '';
            } catch (_) {
                /* silent */
            }
        }

        updateSyncBadge();
        setInterval(updateSyncBadge, 15000);
    } catch (_) {
        /* silent — don't break other pages */
    }
}

// Initialize sync indicator on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSyncIndicator);
} else {
    // Small delay to ensure sidebar is injected first
    setTimeout(initSyncIndicator, 200);
}

window.UXEnhancements = {
    initTheme,
    toggleTheme,
    applySharedAccessibleNames,
    openDialog,
    closeDialog,
    openShortcutsModal,
    closeShortcutsModal,
    toggleQuickNav,
    closeAllUXModals,
    electronPrint,
    openPrintPreview,
    closePrintPreview: closePrintPreviewGlobal,
    forceLightThemeForPrint: _forceLightThemeForPrint,
    restoreThemeAfterPrint: _restoreThemeAfterPrint,
    buildLetterheadHTML,
    getSharedSubjectPalette,
    getSharedChartPalette,
    initSyncIndicator
};
