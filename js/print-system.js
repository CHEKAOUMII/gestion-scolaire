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
let _density = 1; // 1 = جدول لكل صفحة، 2 = جدولان في الصفحة
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
                <div class="ux-pp-actions-left">
                    <div class="ux-pp-orient-toggle" role="group" aria-label="اتجاه الصفحة">
                        <button type="button" class="ux-pp-orient-btn ux-pp-orient-portrait active">عمودي</button>
                        <button type="button" class="ux-pp-orient-btn ux-pp-orient-landscape">أفقي</button>
                    </div>
                    <div class="ux-pp-density-toggle" role="group" aria-label="عدد الجداول في الصفحة" hidden>
                        <button type="button" class="ux-pp-density-btn active" data-density="1">جدول / صفحة</button>
                        <button type="button" class="ux-pp-density-btn" data-density="2">جدولان / صفحة</button>
                    </div>
                </div>
                <div class="ux-pp-actions-right">
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
    _modal.querySelector('.ux-pp-orient-portrait')?.addEventListener('click', () => {
        _landscape = false;
        _updateOrientationUI();
        _applyDensityLayout();
    });
    _modal.querySelector('.ux-pp-orient-landscape')?.addEventListener('click', () => {
        _landscape = true;
        _updateOrientationUI();
        _applyDensityLayout();
    });
    _modal.querySelectorAll('.ux-pp-density-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const next = Number(btn.dataset.density) === 2 ? 2 : 1;
            if (next === _density) return;
            _density = next;
            _updateDensityUI();
            _applyDensityLayout();
        });
    });
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
        const sheet = _modal.querySelector('.ux-pp-sheet');
        if (sheet) {
            sheet.replaceChildren();
            sheet._sourceClone = null;
            sheet._headerNode = null;
            delete sheet.dataset.density;
        }
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
        sheet.dataset.density = String(_density);
        sheet.dataset.orient = _landscape ? 'landscape' : 'portrait';
        // Fixed page box so density=2 half-slots can be measured in mm
        sheet.style.width = _landscape ? '297mm' : '210mm';
        if (_density === 2) {
            sheet.style.height = _landscape ? '210mm' : '297mm';
            sheet.style.minHeight = _landscape ? '210mm' : '297mm';
            sheet.style.maxHeight = _landscape ? '210mm' : '297mm';
            sheet.style.overflow = 'hidden';
            if (!Object.prototype.hasOwnProperty.call(_options || {}, 'sheetPadding')) {
                sheet.style.setProperty('padding', '4mm', 'important');
            }
        } else {
            sheet.style.height = '';
            sheet.style.maxHeight = '';
            sheet.style.minHeight = _landscape ? '210mm' : '297mm';
            sheet.style.overflow = '';
            if (!Object.prototype.hasOwnProperty.call(_options || {}, 'sheetPadding')) {
                sheet.style.removeProperty('padding');
            }
        }
        if (Object.prototype.hasOwnProperty.call(_options || {}, 'sheetPadding')) {
            sheet.style.setProperty('padding', String(_options.sheetPadding || 0), 'important');
        }
    }
}

function _updateDensityUI() {
    if (!_modal) return;
    const show = !!_options.showDensityControl;
    const toggle = _modal.querySelector('.ux-pp-density-toggle');
    if (toggle) toggle.hidden = !show;
    _modal.querySelectorAll('.ux-pp-density-btn').forEach((btn) => {
        const on = Number(btn.dataset.density) === _density;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const sheet = _modal.querySelector('.ux-pp-sheet');
    if (sheet) {
        sheet.dataset.density = String(_density);
        sheet.dataset.orient = _landscape ? 'landscape' : 'portrait';
    }
}

function _normalizeDensity(value) {
    return Number(value) === 2 ? 2 : 1;
}

function _buildCutLine() {
    const cut = document.createElement('div');
    cut.className = 'ux-pp-cut-line';
    cut.setAttribute('aria-hidden', 'true');
    cut.innerHTML = '<span class="ux-pp-cut-label">\u2702 \u062e\u0637 \u0627\u0644\u0642\u0635</span>';
    return cut;
}

/**
 * Rebuild sheet body for density=1 (single) or density=2 (two stacked copies + cut line).
 * Letterhead once at top; two equal half-page slots below.
 */
function _applyDensityLayout() {
    if (!_modal) return;
    const sheet = _modal.querySelector('.ux-pp-sheet');
    if (!sheet || !sheet._sourceClone) return;

    const headerNode = sheet._headerNode || null;
    const sourceClone = sheet._sourceClone;

    sheet.replaceChildren();
    if (headerNode) sheet.appendChild(headerNode.cloneNode(true));

    const pack = document.createElement('div');
    pack.className = 'ux-pp-density-pack';
    pack.dataset.density = String(_density);
    pack.dataset.orient = _landscape ? 'landscape' : 'portrait';

    const slotA = document.createElement('div');
    slotA.className = 'ux-pp-density-slot';
    slotA.appendChild(sourceClone.cloneNode(true));
    pack.appendChild(slotA);

    if (_density === 2) {
        pack.appendChild(_buildCutLine());
        const slotB = document.createElement('div');
        slotB.className = 'ux-pp-density-slot';
        slotB.appendChild(sourceClone.cloneNode(true));
        pack.appendChild(slotB);
    }

    sheet.appendChild(pack);
    _updateOrientationUI();
}

function _safePdfFileName(title) {
    const base = String(title || 'document')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 80);
    return `${base || 'document'}.pdf`;
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
        printSheet.dataset.density = String(_density);
        printSheet.dataset.orient = _landscape ? 'landscape' : 'portrait';
        printSheet.style.boxShadow = 'none';
        printSheet.style.borderRadius = '0';
        printSheet.style.margin = '0 auto';
        printSheet.style.boxSizing = 'border-box';

        if (_density === 2) {
            // Keep the exact page box from preview so the two half-slots don't collapse/overlap.
            const pageW = _landscape ? '297mm' : '210mm';
            const pageH = _landscape ? '210mm' : '297mm';
            printSheet.style.width = pageW;
            printSheet.style.maxWidth = pageW;
            printSheet.style.height = pageH;
            printSheet.style.minHeight = pageH;
            printSheet.style.maxHeight = pageH;
            printSheet.style.overflow = 'hidden';
            printSheet.style.padding = '4mm';
            printSheet.style.display = 'flex';
            printSheet.style.flexDirection = 'column';
        } else {
            // Density=1: fill printable width (avoids RTL edge clip against @page margins)
            printSheet.style.width = '100%';
            printSheet.style.maxWidth = '100%';
            printSheet.style.minHeight = '0';
            printSheet.style.height = '';
            printSheet.style.maxHeight = '';
            printSheet.style.overflow = 'visible';
        }
        root.appendChild(printSheet);
    }
    document.body.classList.add('ux-printing-active');
    document.body.classList.toggle('ux-print-edge-to-edge', !!_options.edgeToEdge);
    document.body.classList.toggle('ux-print-landscape', _landscape);
    document.body.classList.toggle('ux-print-density-2', _density === 2);

    let pageStyle = document.getElementById('ux-print-page-rule');
    if (!pageStyle) {
        pageStyle = document.createElement('style');
        pageStyle.id = 'ux-print-page-rule';
        document.head.appendChild(pageStyle);
    }
    const pageSize = _options.pageSize || 'A4';
    const orient = _landscape ? 'landscape' : 'portrait';
    // Density=2: zero CSS @page margin — sheet owns the padding; Electron margins handle outer inset.
    const margin = Object.assign(
        _density === 2
            ? { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
            : { top: '5mm', right: '4mm', bottom: '5mm', left: '4mm' },
        _options.pageMargins || {}
    );

    let densityRules = '';
    if (_density === 2) {
        const pageW = _landscape ? '297mm' : '210mm';
        const pageH = _landscape ? '210mm' : '297mm';
        densityRules = [
            '#ux-print-root{width:100%!important;}',
            `#ux-print-root .ux-pp-sheet{display:flex!important;flex-direction:column!important;box-sizing:border-box!important;overflow:hidden!important;padding:4mm!important;margin:0 auto!important;width:${pageW}!important;max-width:${pageW}!important;height:${pageH}!important;min-height:${pageH}!important;max-height:${pageH}!important;}`,
            '#ux-print-root .ux-pp-letterhead{flex:0 0 auto!important;margin-bottom:2mm!important;padding-bottom:2mm!important;}',
            '#ux-print-root .ux-pp-letterhead img{max-width:90px!important;max-height:42px!important;}',
            '#ux-print-root .ux-pp-density-pack{flex:1 1 auto!important;display:flex!important;flex-direction:column!important;min-height:0!important;height:100%!important;gap:0!important;}',
            '#ux-print-root .ux-pp-density-slot{flex:1 1 0!important;min-height:0!important;overflow:hidden!important;}',
            '#ux-print-root .ux-pp-density-slot > *{max-height:100%!important;overflow:hidden!important;}',
            '#ux-print-root .ux-pp-cut-line{flex:0 0 auto!important;margin:1.5mm 0!important;border-top:1.2px dashed #9ca3af!important;position:relative!important;height:0!important;}',
            '#ux-print-root .ux-pp-cut-label{position:absolute!important;top:-0.55em!important;left:50%!important;transform:translateX(-50%)!important;background:#fff!important;padding:0 8px!important;font-size:8px!important;color:#9ca3af!important;}',
            '#ux-print-root .timetable-wrapper,#ux-print-root .class-timetable-wrapper,#ux-print-root .room-timetable-wrapper,#ux-print-root .table-responsive{overflow:hidden!important;max-height:100%!important;border-radius:0!important;}',
            '#ux-print-root .timetable-header-info,#ux-print-root .class-info-bar{padding:2px 4px!important;margin:0 0 2px!important;}',
            '#ux-print-root .timetable-header-info h3,#ux-print-root .class-info-bar h4{font-size:9px!important;margin:0!important;}',
            '#ux-print-root .timetable,#ux-print-root .class-timetable,#ux-print-root .room-timetable{width:100%!important;table-layout:fixed!important;font-size:6.5px!important;}',
            '#ux-print-root .timetable th,#ux-print-root .class-timetable th,#ux-print-root .room-timetable th{padding:2px 1px!important;font-size:6.5px!important;}',
            '#ux-print-root .timetable td,#ux-print-root .class-timetable td,#ux-print-root .room-timetable td{padding:1px!important;font-size:6px!important;line-height:1.15!important;}',
            '#ux-print-root .activity-cell,#ux-print-root .lesson-cell{padding:0 1px!important;margin:0!important;}',
            '#ux-print-root .activity-cell .subject,#ux-print-root .lesson-cell .lesson-subject{font-size:6px!important;margin:0!important;}'
        ].join('');
    }

    const extraRules = _options.edgeToEdge
        ? '#ux-print-root .ux-pp-sheet{padding:0!important;margin:0 auto!important;width:100%!important;min-height:auto!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important;}' +
          '#ux-print-root .gs-sheet{padding:0!important;margin:0!important;min-height:auto!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important;}'
        : (_density === 2
            ? ''
            : '#ux-print-root .ux-pp-sheet{width:100%!important;max-width:100%!important;margin:0 auto!important;overflow:visible!important;}');

    pageStyle.textContent = `@page { size: ${pageSize} ${orient}; margin: ${margin.top} ${margin.right} ${margin.bottom} ${margin.left}; }${extraRules}${densityRules}`;
}

function _disablePrintMode() {
    document.body.classList.remove(
        'ux-printing-active',
        'ux-print-landscape',
        'ux-print-edge-to-edge',
        'ux-print-density-2'
    );
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
            const printMargins = _density === 2
                ? { marginType: 'custom', top: 0.08, bottom: 0.08, left: 0.08, right: 0.08 }
                : { marginType: 'custom', top: 0.2, bottom: 0.2, left: 0.16, right: 0.16 };
            await window.api.system.printCurrentWindow({
                printBackground: true,
                pageSize: _options.pageSize || 'A4',
                landscape: _landscape,
                margins: Object.assign(printMargins, _options.pdfMargins || {}),
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
    // Wait for layout/paint so flex half-slots settle before Chromium captures PDF
    await new Promise((r) => setTimeout(r, 80));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
        if (window.api?.system?.printToPDF) {
            const suggested =
                _options.defaultFileName ||
                _safePdfFileName(_options.title || document.title || 'document');
            // Density=2 sheet is already a full page box; keep Electron margins tiny
            // and honor CSS page size so landscape/portrait matches the preview.
            const pdfMargins = _density === 2
                ? { top: 0.08, bottom: 0.08, left: 0.08, right: 0.08 }
                : { top: 0.2, bottom: 0.2, left: 0.16, right: 0.16 };
            const result = await window.api.system.printToPDF({
                printBackground: true,
                pageSize: _options.pageSize || 'A4',
                landscape: _landscape,
                preferCSSPageSize: true,
                defaultFileName: suggested,
                margins: Object.assign(pdfMargins, _options.pdfMargins || {}),
            });
            if (result?.success && typeof showToast === 'function') {
                showToast('تم تصدير الملف بنجاح', 'success');
            } else if (result && result.success === false && result.error && result.error !== 'Cancelled by user') {
                if (typeof showToast === 'function') showToast(result.error, 'error');
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
     * @param {string}  [options.contentSelector]  CSS selector للعنصر المصدر
     * @param {string}  [options.title]             عنوان الوثيقة في الترويسة
     * @param {boolean} [options.landscape=false]   اتجاه الصفحة
     * @param {string}  [options.pageSize='A4']     حجم الصفحة
     * @param {boolean} [options.noHeader=false]    تخطي الترويسة المدرسية
     * @param {Promise|Function} [options.waitFor]  ينتظر قبل الالتقاط
     * @param {number}  [options.density=1]         1 = جدول لكل صفحة، 2 = جدولان في الصفحة
     * @param {boolean} [options.showDensityControl=false] إظهار مبدّل الكثافة في المعاينة
     * @param {string}  [options.defaultFileName]   اسم ملف PDF المقترح
     */
    async preview(options = {}) {
        _options = options;
        _landscape = !!options.landscape;
        _density = _normalizeDensity(options.density);
        _ensureModal();
        _updateDensityUI();
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

        // Keep pristine source + header so density toggle can rebuild without re-cloning live DOM
        sheet._sourceClone = clone;
        if (headerHTML) {
            const tpl = document.createElement('template');
            tpl.innerHTML = headerHTML;
            sheet._headerNode = tpl.content.firstElementChild || null;
        } else {
            sheet._headerNode = null;
        }

        _applyDensityLayout();

        _modal.classList.add('active');
        _modal.style.display = 'flex';
        document.body.classList.add('ux-preview-open');
        _updateDensityUI();
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
