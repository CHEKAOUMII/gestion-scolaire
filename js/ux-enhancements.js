/**
 * UX Enhancements - Shared JavaScript
 * تحسينات تجربة المستخدم المشتركة لجميع الصفحات
 */

// ==================== Theme Management ====================
function initTheme() {
    const savedTheme = localStorage.getItem('app-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('app-theme', newTheme);
    updateThemeIcon(newTheme);

    // Show toast if available
    if (typeof showToast === 'function') {
        showToast(newTheme === 'dark' ? 'تم تفعيل الوضع الداكن' : 'تم تفعيل الوضع الفاتح', 'info');
    }
}

function updateThemeIcon(theme) {
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.innerHTML = theme === 'dark'
            ? '<i class="fas fa-sun"></i>'
            : '<i class="fas fa-moon"></i>';
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
            const searchInput = document.querySelector('input[type="text"][placeholder*="بحث"]') ||
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
    const quickNavPanel = document.getElementById('quick-nav-panel');
    const quickNavToggle = document.getElementById('quick-nav-toggle');

    shortcutsModal?.classList.remove('active');
    shortcutsModal?.setAttribute('aria-hidden', 'true');

    quickNavPanel?.classList.remove('open');
    quickNavPanel?.setAttribute('aria-hidden', 'true');

    quickNavToggle?.classList.remove('active');
    quickNavToggle?.setAttribute('aria-expanded', 'false');
}

function openShortcutsModal() {
    const shortcutsModal = document.getElementById('shortcuts-modal');
    const shortcutsContent = shortcutsModal?.querySelector('.shortcuts-content');
    shortcutsModal?.classList.add('active');
    shortcutsModal?.setAttribute('aria-hidden', 'false');
    shortcutsContent?.focus();
}

function closeShortcutsModal() {
    const shortcutsModal = document.getElementById('shortcuts-modal');
    shortcutsModal?.classList.remove('active');
    shortcutsModal?.setAttribute('aria-hidden', 'true');
}

// ==================== Quick Navigation Panel ====================
function initQuickNav() {
    const toggle = document.getElementById('quick-nav-toggle');
    const panel = document.getElementById('quick-nav-panel');
    const close = document.getElementById('quick-nav-close');
    const searchInput = document.getElementById('quick-nav-search-input');

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
    document.querySelectorAll('.quick-nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.quick-nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Toggle lists based on tab
            const targetList = tab.dataset.navTab;
            document.querySelectorAll('.quick-nav-list').forEach(list => {
                list.style.display = 'none';
            });
            const targetElement = document.getElementById('quick-nav-' + targetList);
            if (targetElement) {
                targetElement.style.display = 'block';
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
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(lowerQuery) ? 'flex' : 'none';
    });
}

// ==================== Initialize All UX Enhancements ====================

function initUXEnhancements() {
    // Robust guard against multiple initializations in the same page session
    if (window.__uxInitialized) return;

    initTheme();
    initKeyboardShortcuts();
    initQuickNav();

    // Theme toggle click handler (Event Delegation for robustness)
    document.addEventListener('click', (e) => {
        const toggle = e.target.closest('#theme-toggle');
        if (toggle) {
            toggleTheme();
        }
    });

    // Shortcuts button click handler

    // Shortcuts button click handler
    document.getElementById('shortcuts-btn')?.addEventListener('click', openShortcutsModal);
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
let _savedThemeBeforePreview = null;
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

    const dialog = _printPreviewModal.querySelector('.ux-pp-dialog');
    const overlay = _printPreviewModal.querySelector('.ux-pp-overlay');
    const page = _printPreviewModal.querySelector('.ux-pp-page');
    const sheet = _printPreviewModal.querySelector('.ux-pp-sheet');
    if (overlay) overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);';
    if (dialog) dialog.style.cssText = 'position:relative;width:min(1180px,95vw);max-height:92vh;background:#fff;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;z-index:1;';
    if (page) page.style.cssText = 'padding:16px;background:#eef2f7;overflow:auto;';
    if (sheet) sheet.style.cssText = 'background:#fff;color:#111;width:210mm;min-height:297mm;margin:0 auto;padding:10mm;box-shadow:0 8px 28px rgba(0,0,0,.15);';
    _printPreviewModal.style.cssText += 'position:fixed;inset:0;z-index:10050;align-items:center;justify-content:center;';

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
function openPrintPreview(options = {}) {
    _printPreviewOptions = options;
    _printPreviewLandscape = !!options.landscape;
    _ensurePrintPreviewModal();
    _updateOrientationUI();

    const sourceEl = options.contentSelector
        ? document.querySelector(options.contentSelector)
        : (document.querySelector('.main-content') || document.querySelector('main'));
    if (!sourceEl) {
        if (typeof showToast === 'function') showToast('لا يوجد محتوى للطباعة', 'warning');
        return;
    }

    const clone = sourceEl.cloneNode(true);
    // Strip UI controls from clone
    clone.querySelectorAll('.header, .search-section, .search-form, .filter-section, .import-section, .stats-row, .edit-controls, .changes-summary-bar, .empty-state, .no-print, .toast-container, .menu-toggle, .theme-toggle, #print-btn, #print-preview-btn, #export-pdf-btn, .btn-print, .btn-export, .pagination, .report-empty-state, .timetable-print-actions, .filter-actions, .no-data-state').forEach(el => el.remove());
    // Force solid white backgrounds on glass/card elements (override CSS variables)
    clone.querySelectorAll('.glass-panel, .stat-card, .report-panel, .report-kpi-card, .card, details').forEach(el => {
        el.style.background = '#fff';
        el.style.boxShadow = 'none';
        el.style.backdropFilter = 'none';
        el.style.webkitBackdropFilter = 'none';
        el.style.animation = 'none';
    });
    // Remove IDs to avoid duplicates
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));

    // Replace canvases with images
    const sourceCanvases = sourceEl.querySelectorAll('canvas');
    const cloneCanvases = clone.querySelectorAll('canvas');
    cloneCanvases.forEach((cc, i) => {
        const sc = sourceCanvases[i];
        if (!sc) { cc.remove(); return; }
        try {
            const img = document.createElement('img');
            img.src = sc.toDataURL('image/png', 1);
            img.alt = 'رسم بياني';
            img.style.cssText = 'width:100%;height:auto;max-height:200px;object-fit:contain;display:block;border-radius:6px;';
            cc.replaceWith(img);
        } catch { cc.remove(); }
    });

    // Build print header
    const printTitle = options.title || document.querySelector('.page-title h1')?.textContent || document.title || 'طباعة';
    const schoolName = localStorage.getItem('schoolName') || '';
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-MA', { year: 'numeric', month: 'long', day: 'numeric' });
    const headerHTML = `<div class="ux-pp-print-header">
        ${schoolName ? `<div class="ux-pp-school-name">${schoolName}</div>` : ''}
        <div class="ux-pp-doc-title">${printTitle}</div>
        <div class="ux-pp-doc-date">${dateStr}</div>
    </div>`;

    const sheet = _printPreviewModal.querySelector('.ux-pp-sheet');
    sheet.innerHTML = headerHTML;
    sheet.appendChild(clone);
    _printPreviewModal.classList.add('active');
    _printPreviewModal.style.display = 'flex';
    document.body.classList.add('ux-preview-open');

    // Force light theme during print preview
    _savedThemeBeforePreview = document.documentElement.getAttribute('data-theme');
    if (_savedThemeBeforePreview === 'dark') {
        document.documentElement.setAttribute('data-theme', 'light');
        updateThemeIcon('light');
    }

    _updateOrientationUI();
}

function closePrintPreviewGlobal() {
    if (_printPreviewModal) {
        _printPreviewModal.classList.remove('active');
        _printPreviewModal.style.display = 'none';
        const sheet = _printPreviewModal.querySelector('.ux-pp-sheet');
        if (sheet) sheet.innerHTML = '';
    }
    document.body.classList.remove('ux-preview-open');

    // Restore saved theme after closing print preview
    if (_savedThemeBeforePreview) {
        document.documentElement.setAttribute('data-theme', _savedThemeBeforePreview);
        updateThemeIcon(_savedThemeBeforePreview);
        _savedThemeBeforePreview = null;
    }
}

function _updateOrientationUI() {
    if (!_printPreviewModal) return;
    const page = _printPreviewModal.querySelector('.ux-pp-page');
    const btnL = _printPreviewModal.querySelector('.ux-pp-orient-landscape');
    const btnP = _printPreviewModal.querySelector('.ux-pp-orient-portrait');
    if (page) page.classList.toggle('landscape', _printPreviewLandscape);
    if (btnL) btnL.classList.toggle('active', _printPreviewLandscape);
    if (btnP) btnP.classList.toggle('active', !_printPreviewLandscape);
}

function _captureSheetHTML() {
    if (!_printPreviewModal) return null;
    const sheet = _printPreviewModal.querySelector('.ux-pp-sheet');
    return sheet ? sheet.innerHTML : null;
}

function _enablePrintMode(capturedHTML) {
    _forceLightThemeForPrint();
    let root = document.getElementById('ux-print-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'ux-print-root';
        document.body.appendChild(root);
    }
    root.innerHTML = capturedHTML;
    document.body.classList.add('ux-printing-active');
}

function _disablePrintMode() {
    document.body.classList.remove('ux-printing-active');
    const root = document.getElementById('ux-print-root');
    if (root) root.innerHTML = '';
    _restoreThemeAfterPrint();
}

async function _executePrintFromPreview() {
    const capturedHTML = _captureSheetHTML();
    if (!capturedHTML) return;
    closePrintPreviewGlobal();
    _enablePrintMode(capturedHTML);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
        if (window.api?.system?.printCurrentWindow) {
            await window.api.system.printCurrentWindow({
                printBackground: true,
                pageSize: _printPreviewOptions.pageSize || 'A4',
                landscape: _printPreviewLandscape,
                margins: { marginType: 'default' }
            });
        } else {
            window.print();
        }
    } finally {
        _disablePrintMode();
    }
}

async function _exportPdfFromPreview() {
    const capturedHTML = _captureSheetHTML();
    if (!capturedHTML) return;
    closePrintPreviewGlobal();
    _enablePrintMode(capturedHTML);
    await new Promise(r => setTimeout(r, 300));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
        if (window.api?.system?.printToPDF) {
            const result = await window.api.system.printToPDF({
                printBackground: true,
                pageSize: _printPreviewOptions.pageSize || 'A4',
                landscape: _printPreviewLandscape,
                margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
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
            await window.api.updater.downloadUpdate();
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

window.UXEnhancements = {
    initTheme,
    toggleTheme,
    openShortcutsModal,
    closeShortcutsModal,
    toggleQuickNav,
    closeAllUXModals,
    electronPrint,
    openPrintPreview,
    closePrintPreview: closePrintPreviewGlobal,
    forceLightThemeForPrint: _forceLightThemeForPrint,
    restoreThemeAfterPrint: _restoreThemeAfterPrint
};
