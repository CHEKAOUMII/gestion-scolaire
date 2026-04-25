/**
 * PrintSystem — API مركزية موحدة لجميع عمليات الطباعة والتصدير.
 *
 * مسار أ: PrintSystem.preview(options)
 *   للصفحات التي تطبع محتوى DOM الحالي (تحليل، غياب، طلاب، درجات...).
 *   يفتح modal للمعاينة ثم يطبع أو يصدر PDF.
 *
 * مسار ب: PrintSystem.window(options)
 *   للصفحات التي تبني HTML خاصاً بها (جداول الحصص، الشهادات، التقارير المعقدة).
 *   يرسل HTML جاهز للـ main process عبر hidden BrowserWindow.
 *
 * لا تستدعِ openPrintPreview() أو electronPrint() أو window.print() مباشرة.
 */

// ─── حالة الوحدة ───────────────────────────────────────────────────────────
let _modal = null;
let _options = {};
let _landscape = false;
let _savedTheme = null;

// ─── إدارة الثيم ─────────────────────────────────────────────────────────
function _forceLightTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme === 'dark') {
        _savedTheme = 'dark';
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        _savedTheme = null;
    }
}

function _restoreTheme() {
    if (_savedTheme) {
        document.documentElement.setAttribute('data-theme', _savedTheme);
        if (typeof updateThemeIcon === 'function') updateThemeIcon(_savedTheme);
        _savedTheme = null;
    }
}

// ─── بناء الـ Modal (lazy) ────────────────────────────────────────────────
function _ensureModal() {
    if (_modal && document.body.contains(_modal)) return;

    _modal = document.createElement('div');
    _modal.className = 'ux-pp-modal';
    _modal.setAttribute('role', 'dialog');
    _modal.setAttribute('aria-modal', 'true');
    _modal.setAttribute('aria-label', 'معاينة الطباعة');
    _modal.style.display = 'none';
    _modal.innerHTML = `
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

    document.body.appendChild(_modal);

    _modal.querySelector('.ux-pp-close')?.addEventListener('click', _closeModal);
    _modal.querySelector('.ux-pp-overlay')?.addEventListener('click', _closeModal);
    _modal.querySelector('.ux-pp-orient-portrait')?.addEventListener('click', () => { _landscape = false; _updateOrientationUI(); });
    _modal.querySelector('.ux-pp-orient-landscape')?.addEventListener('click', () => { _landscape = true; _updateOrientationUI(); });
    _modal.querySelector('.ux-pp-print-btn')?.addEventListener('click', () => { void _executePrint(); });
    _modal.querySelector('.ux-pp-pdf-btn')?.addEventListener('click', () => { void _exportPdf(); });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _modal?.classList.contains('active')) _closeModal();
    });
}

function _closeModal() {
    if (_modal) {
        _modal.classList.remove('active');
        _modal.style.display = 'none';
        _modal.querySelector('.ux-pp-sheet')?.replaceChildren();
    }
    document.body.classList.remove('ux-preview-open');
}

function _updateOrientationUI() {
    if (!_modal) return;
    const page = _modal.querySelector('.ux-pp-page');
    const sheet = _modal.querySelector('.ux-pp-sheet');
    const btnL = _modal.querySelector('.ux-pp-orient-landscape');
    const btnP = _modal.querySelector('.ux-pp-orient-portrait');
    if (page) page.classList.toggle('landscape', _landscape);
    if (btnL) btnL.classList.toggle('active', _landscape);
    if (btnP) btnP.classList.toggle('active', !_landscape);
    if (sheet) {
        sheet.style.width = _landscape ? '297mm' : '210mm';
        sheet.style.minHeight = _landscape ? '210mm' : '297mm';
    }
}

// ─── بناء الترويسة ────────────────────────────────────────────────────────
async function _buildLetterhead(title) {
    try {
        const id = await window.api.reports.getIdentity();
        if (!id || (!id.school_name && !id.ministry)) return '';
        const _esc = (s) =>
            String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        const logo = id.logo_base64
            ? `<img src="data:image/png;base64,${id.logo_base64}" style="max-width:300px;max-height:300px;" alt="logo">`
            : '<div style="width:52px;height:52px;border:1px dashed var(--color-accent);border-radius:50%;margin:0 auto;"></div>';
        const printTitle = title || document.querySelector('.page-title h1')?.textContent || document.title || '';
        const reportDate =
            document.getElementById('print-date-display')?.textContent?.trim() ||
            document.getElementById('date-display')?.textContent?.trim() ||
            '';
        return `
        <div class="ux-pp-letterhead" style="border-bottom:2.5px solid var(--color-primary);padding-bottom:10px;margin-bottom:14px;">
            <table style="width:100%;border-collapse:collapse;" role="presentation">
                <tr>
                    <td style="width:45%;vertical-align:middle;text-align:center;padding:0;">
                        <div style="font-size:11px;font-weight:700;color:var(--color-text-main);">${_esc(id.country)}</div>
                        <div style="font-size:9.5px;color:var(--color-text-muted);margin-top:2px;">${_esc(id.ministry)}</div>
                        ${id.academy ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:2px;">${_esc(id.academy)}</div>` : ''}
                        ${id.directorate ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:1px;">${_esc(id.directorate)}</div>` : ''}
                    </td>
                    <td style="width:10%;text-align:center;vertical-align:middle;">${logo}</td>
                    <td style="width:45%;vertical-align:middle;text-align:center;padding:0;">
                        <div style="font-size:13px;font-weight:800;color:var(--color-primary);">${_esc(id.school_name)}</div>
                        ${id.school_code ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:2px;">رمز المؤسسة: ${_esc(id.school_code)}</div>` : ''}
                        ${id.commune ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:1px;">الجماعة: ${_esc(id.commune)}</div>` : ''}
                        ${document.getElementById('school-year')?.value || id.school_year ? `<div style="font-size:9px;color:var(--color-text-light);margin-top:1px;">السنة الدراسية: ${_esc(document.getElementById('school-year')?.value || id.school_year)}</div>` : ''}
                    </td>
                </tr>
            </table>
            ${printTitle ? `
            <div style="text-align:center;margin-top:12px;">
                <div style="display:inline-block;padding:7px 30px;border:2px solid var(--color-primary);border-radius:8px;background:var(--color-primary-mist);">
                    <div style="font-size:17px;font-weight:800;color:var(--color-primary);">${_esc(printTitle)}</div>
                    ${reportDate ? `<div style="font-size:13px;font-weight:600;color:var(--color-text-muted);margin-top:4px;">${_esc(reportDate)}</div>` : ''}
                </div>
            </div>` : ''}
        </div>`;
    } catch (_) {
        const printTitle = title || document.title || 'طباعة';
        const dateStr = new Date().toLocaleDateString('ar-MA', { year: 'numeric', month: 'long', day: 'numeric' });
        return `<div class="ux-pp-print-header">
            <div class="ux-pp-doc-title">${printTitle}</div>
            <div class="ux-pp-doc-date">${dateStr}</div>
        </div>`;
    }
}

// ─── تنظيف clone من عناصر الواجهة ────────────────────────────────────────
function _cleanClone(clone, sourceEl) {
    clone.querySelectorAll(
        '.header,.print-header,.search-section,.sl-search-section,.search-form,' +
        '.filter-section,.filters-section,.import-section,.stats-row,.edit-controls,' +
        '.changes-summary-bar,.empty-state,.no-print,.toast-container,.loading-overlay,' +
        '.menu-toggle,.theme-toggle,#print-btn,#print-preview-btn,#export-pdf-btn,' +
        '#export-btn,.btn-print,.btn-export,.pagination,.sl-pagination,' +
        '.report-empty-state,.timetable-print-actions,.filter-actions,.no-data-state,' +
        '.table-toolbar,.page-title-row,.sl-results-header,.sl-results-actions,' +
        '.sl-action-btn,.tp-filters-grid,.tp-kpi-toggle,.tp-state-line,' +
        '.tp-loading-overlay,.tp-filters-actions'
    ).forEach((el) => el.remove());

    clone.querySelectorAll('th:last-child,td:last-child').forEach((el) => {
        if (el.querySelector('.sl-action-btn') || el.textContent.trim() === '' || el.textContent.includes('الإجراءات')) {
            el.style.display = 'none';
        }
    });

    clone.querySelectorAll(
        '.glass-panel,.stat-card,.report-panel,.report-kpi-card,.card,details,' +
        '.analysis-panel,.analysis-kpi-card,.analysis-block,.tp-kpi,.tp-panel,' +
        '.tp-teacher-card,.tp-cs-kpi,.tp-cs-card'
    ).forEach((el) => {
        el.style.background = '#fff';
        el.style.boxShadow = 'none';
        el.style.backdropFilter = 'none';
        el.style.webkitBackdropFilter = 'none';
        el.style.animation = 'none';
    });

    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));

    clone.querySelectorAll('.events-table').forEach((tbl) => {
        tbl.style.tableLayout = 'auto';
        tbl.style.width = '100%';
        tbl.querySelectorAll('.col-event-type').forEach((c) => { c.style.width = '14%'; c.style.whiteSpace = 'nowrap'; });
        tbl.querySelectorAll('.col-event-details').forEach((c) => { c.style.width = 'auto'; c.style.whiteSpace = 'normal'; c.style.wordBreak = 'break-word'; });
        tbl.querySelectorAll('.col-event-time').forEach((c) => { c.style.width = '10%'; c.style.whiteSpace = 'nowrap'; });
    });

    // استبدال canvas بصور
    const sourceCanvases = sourceEl.querySelectorAll('canvas');
    clone.querySelectorAll('canvas').forEach((cc, i) => {
        const sc = sourceCanvases[i];
        if (!sc) { cc.remove(); return; }
        try {
            const img = document.createElement('img');
            img.src = sc.toDataURL('image/png', 1);
            img.alt = 'رسم بياني';
            img.style.cssText = 'width:100%;height:auto;max-height:200px;object-fit:contain;display:block;border-radius:6px;';
            cc.replaceWith(img);
        } catch {
            cc.remove();
        }
    });
}

// ─── وضع الطباعة الفعلية (DOM container) ─────────────────────────────────
function _enablePrintMode(capturedSheet) {
    _forceLightTheme();
    let root = document.getElementById('ux-print-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'ux-print-root';
        document.body.appendChild(root);
    }
    root.replaceChildren();
    if (capturedSheet) {
        const printSheet = capturedSheet.cloneNode(true);
        printSheet.setAttribute('data-theme', 'light');
        printSheet.style.boxShadow = 'none';
        printSheet.style.borderRadius = '0';
        printSheet.style.margin = '0 auto';
        printSheet.style.overflow = 'visible';
        root.appendChild(printSheet);
    }
    document.body.classList.add('ux-printing-active');
    document.body.classList.toggle('ux-print-landscape', _landscape);

    let pageStyle = document.getElementById('ux-print-page-rule');
    if (!pageStyle) {
        pageStyle = document.createElement('style');
        pageStyle.id = 'ux-print-page-rule';
        document.head.appendChild(pageStyle);
    }
    const pageSize = _options.pageSize || 'A4';
    const orient = _landscape ? 'landscape' : 'portrait';
    pageStyle.textContent = `@page { size: ${pageSize} ${orient}; margin: 5mm 4mm; }`;
}

function _disablePrintMode() {
    document.body.classList.remove('ux-printing-active', 'ux-print-landscape');
    document.getElementById('ux-print-root')?.replaceChildren();
    document.getElementById('ux-print-page-rule')?.remove();
    _restoreTheme();
}

// ─── تنفيذ الطباعة / PDF من داخل المعاينة ────────────────────────────────
async function _executePrint() {
    const sheet = _modal?.querySelector('.ux-pp-sheet');
    const captured = sheet ? sheet.cloneNode(true) : null;
    if (!captured) return;
    _closeModal();
    _enablePrintMode(captured);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
        if (window.api?.system?.printCurrentWindow) {
            await window.api.system.printCurrentWindow({
                printBackground: true,
                pageSize: _options.pageSize || 'A4',
                landscape: _landscape,
                margins: { marginType: 'custom', top: 0.2, bottom: 0.2, left: 0.16, right: 0.16 },
            });
        } else {
            window.print();
        }
    } finally {
        _disablePrintMode();
    }
}

async function _exportPdf() {
    const sheet = _modal?.querySelector('.ux-pp-sheet');
    const captured = sheet ? sheet.cloneNode(true) : null;
    if (!captured) return;
    _closeModal();
    _enablePrintMode(captured);
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
        if (window.api?.system?.printToPDF) {
            const result = await window.api.system.printToPDF({
                printBackground: true,
                pageSize: _options.pageSize || 'A4',
                landscape: _landscape,
                margins: { top: 0.2, bottom: 0.2, left: 0.16, right: 0.16 },
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

// ─── API العامة ───────────────────────────────────────────────────────────
window.PrintSystem = {
    /**
     * مسار أ — معاينة وطباعة محتوى موجود في DOM الحالي.
     *
     * @param {object}  [options]
     * @param {string}  [options.contentSelector]  CSS selector للعنصر المصدر
     * @param {string}  [options.title]             عنوان الوثيقة في الترويسة
     * @param {boolean} [options.landscape=false]   اتجاه الصفحة
     * @param {string}  [options.pageSize='A4']     حجم الصفحة
     * @param {boolean} [options.noHeader=false]    تخطي الترويسة المدرسية
     * @param {Promise|Function} [options.waitFor]  ينتظر قبل الالتقاط
     */
    async preview(options = {}) {
        _options = options;
        _landscape = !!options.landscape;
        _ensureModal();
        _updateOrientationUI();

        const preparedSelector =
            options.contentSelector ||
            (document.getElementById('support-export-sheet') ? '#support-export-sheet' : null);
        const sourceEl = preparedSelector
            ? document.querySelector(preparedSelector)
            : document.querySelector('.main-content') || document.querySelector('main');

        if (!sourceEl) {
            if (typeof showToast === 'function') showToast('لا يوجد محتوى للطباعة', 'warning');
            return;
        }

        const waitFor = typeof options.waitFor === 'function' ? options.waitFor() : options.waitFor;
        if (waitFor && typeof waitFor.then === 'function') {
            try { await waitFor; } catch (_) { /* best-effort */ }
        }

        _forceLightTheme();

        if (sourceEl.querySelector('canvas')) {
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }

        const clone = sourceEl.cloneNode(true);
        if (!preparedSelector) _cleanClone(clone, sourceEl);
        _restoreTheme();

        const headerHTML = options.noHeader ? '' : await _buildLetterhead(options.title);

        const sheet = _modal.querySelector('.ux-pp-sheet');
        sheet.setAttribute('data-theme', 'light');
        sheet.replaceChildren();
        if (headerHTML) {
            const tpl = document.createElement('template');
            tpl.innerHTML = headerHTML;
            sheet.appendChild(tpl.content);
        }
        sheet.appendChild(clone);

        _modal.classList.add('active');
        _modal.style.display = 'flex';
        document.body.classList.add('ux-preview-open');
        _updateOrientationUI();
    },

    /**
     * مسار ب — طباعة HTML جاهز عبر hidden BrowserWindow في Main process.
     *
     * @param {object}  options
     * @param {string}  options.htmlContent              HTML المحتوى (بدون letterhead)
     * @param {string}  [options.title]                  عنوان الوثيقة
     * @param {string}  [options.mode='pdf']             'pdf' | 'print' | 'preview'
     * @param {boolean} [options.landscape=false]        اتجاه الصفحة
     * @param {string}  [options.pageSize='A4']          حجم الصفحة
     * @param {string}  [options.defaultFileName]        اسم ملف PDF المقترح
     * @param {string}  [options.inlineStyles]           CSS إضافية
     * @param {boolean} [options.skipAutoLetterhead=false] تخطي الترويسة التلقائية
     */
    async window(options = {}) {
        if (!window.api?.system?.printHTML) {
            if (typeof showToast === 'function') showToast('الطباعة غير متاحة في هذا السياق', 'error');
            return;
        }
        return await window.api.system.printHTML(options);
    },

    /** للتوافق العكسي فقط — لا تستخدمه في كود جديد */
    closePrintPreview() {
        _closeModal();
    },
};
