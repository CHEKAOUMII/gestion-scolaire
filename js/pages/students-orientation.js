/**
 * students-orientation.js — التوجيه المدرسي
 * Visualizes student stream choices by origin stream.
 * Data is loaded from student_orientation (import via settings-imports later).
 */
(function () {
    'use strict';

    const PAGE_SIZE = 20;
    const CHART_COLORS = [
        '#3b82f6',
        '#10b981',
        '#8b5cf6',
        '#f97316',
        '#06b6d4',
        '#ec4899',
        '#84cc16',
        '#eab308',
        '#6366f1',
        '#14b8a6',
        '#f43f5e',
        '#0ea5e9'
    ];

    let allRows = [];
    let filteredRows = [];
    let currentPage = 1;
    let filterManager = null;
    let chartOrigin = null;
    let chartAssigned = null;
    /** Data is loaded only after the user picks a level/category and clicks تحديث */
    let dataLoaded = false;
    let loadInFlight = false;
    /** Monotonic token to discard stale list responses when year/reload races */
    let loadGeneration = 0;

    /** Orientation display errors — OrientationErrorContract (no local competing catalog). */
    function orientationContract() {
        return typeof OrientationErrorContract !== 'undefined' ? OrientationErrorContract : null;
    }

    function orientationDefaultMessage(code) {
        const c = orientationContract();
        if (c) return c.getDefaultMessage(code);
        return 'تعذر تحميل معطيات التوجيه.';
    }

    function orientationCodeKnown(code) {
        const c = orientationContract();
        return !!(c && code && c.getDefinition(code));
    }

    function createDisplayError(code, overrides = {}) {
        const c = orientationContract();
        const def = c && code ? c.getDefinition(code) : null;
        const baseline = def ? def.message : 'حدث خطأ';
        const err = new Error(overrides.message != null ? overrides.message : baseline);
        err.name = 'OrientationDisplayError';
        err.code = code;
        err.details =
            overrides.details != null
                ? c
                    ? c.safeDetails(overrides.details) || overrides.details
                    : overrides.details
                : null;
        err.retryable =
            overrides.retryable != null ? !!overrides.retryable : def ? !!def.retryable : true;
        err.userSafe = true;
        return err;
    }

    function displayUserMessage(err) {
        const c = orientationContract();
        if (err?.userSafe && err.message && /[\u0600-\u06FF]/.test(String(err.message))) {
            if (!/SQLITE|\.js:\d+|at\s+\S+\s+\(|Error:/i.test(String(err.message))) {
                return String(err.message);
            }
        }
        if (c && err) {
            const n = c.normalize({
                success: false,
                code: err.code,
                error: err.message || err.error,
                message: err.message || err.error,
                details: err.details,
                retryable: err.retryable
            });
            return n.message || n.error || 'تعذر تحميل معطيات التوجيه.';
        }
        if (err?.code && orientationCodeKnown(err.code)) {
            return orientationDefaultMessage(err.code);
        }
        const msg = String(err?.message || err?.error || '').trim();
        if (msg && /[\u0600-\u06FF]/.test(msg) && !/SQLITE|\.js:\d+|at\s+\S+\s+\(/i.test(msg)) {
            return msg;
        }
        return 'تعذر تحميل معطيات التوجيه.';
    }

    const els = {
        form: document.getElementById('orientation-filters'),
        level: document.getElementById('level-select'),
        section: document.getElementById('section-select'),
        origin: document.getElementById('origin-select'),
        choice1: document.getElementById('choice1-select'),
        search: document.getElementById('search-input'),
        empty: document.getElementById('empty-state'),
        content: document.getElementById('content-area'),
        resultStatus: document.getElementById('orientation-result-status'),
        filterEmptyBanner: document.getElementById('filter-empty-banner'),
        kpiTotal: document.getElementById('kpi-total'),
        kpiTotalSub: document.getElementById('kpi-total-sub'),
        kpiOrigins: document.getElementById('kpi-origins'),
        kpiChoices: document.getElementById('kpi-choices'),
        kpiAssigned: document.getElementById('kpi-assigned'),
        kpiAssignedSub: document.getElementById('kpi-assigned-sub'),
        kpiAssignedBar: document.getElementById('kpi-assigned-bar'),
        kpiGenderSplit: document.getElementById('kpi-gender-split'),
        kpiGenderBarMale: document.getElementById('kpi-gender-bar-male'),
        kpiGenderBarFemale: document.getElementById('kpi-gender-bar-female'),
        kpiGenderSub: document.getElementById('kpi-gender-sub'),
        resetFilters: document.getElementById('reset-filters-btn'),
        boardTbody: document.getElementById('board-tbody'),
        boardEmpty: document.getElementById('board-empty'),
        boardTable: document.getElementById('board-table'),
        boardSubtitle: document.getElementById('board-subtitle'),
        statusBoardTbody: document.getElementById('status-board-tbody'),
        statusBoardEmpty: document.getElementById('status-board-empty'),
        statusBoardTable: document.getElementById('status-board-table'),
        statusBoardSubtitle: document.getElementById('status-board-subtitle'),
        matrixThead: document.getElementById('matrix-thead'),
        matrixTbody: document.getElementById('matrix-tbody'),
        matrixEmpty: document.getElementById('matrix-empty'),
        matrixTable: document.getElementById('matrix-table'),
        detailTbody: document.getElementById('detail-tbody'),
        pagination: document.getElementById('pagination'),
        tableCount: document.getElementById('table-count'),
        printDate: document.getElementById('print-date'),
        printFilters: document.getElementById('print-filters')
    };

    document.addEventListener('DOMContentLoaded', async () => {
        await initFilters();
        bindEvents();
        // No auto-load — wait for level choice + تحديث
        showChooseLevelState();
    });

    function bindEvents() {
        els.form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await requestLoadOrFilter({ forceReload: true });
        });

        els.level?.addEventListener('change', () => {
            currentPage = 1;
            if (!els.level.value) {
                // Keep cached rows in memory; only hide content until a category is chosen again
                showChooseLevelState(undefined, undefined, { wipe: !dataLoaded });
                return;
            }
            if (dataLoaded) {
                applyClientFilters();
            } else {
                showChooseLevelState(
                    'اضغط «تحديث» للتحميل',
                    `تم اختيار «${printSelectLabel(els.level) || els.level.value}». اضغط <strong>تحديث</strong> لتحميل المعطيات.`,
                    { wipe: false }
                );
            }
        });

        // Section change is owned by FilterManager.onChange — do not double-bind here.
        [els.origin, els.choice1].forEach((el) => {
            el?.addEventListener('change', () => {
                if (!dataLoaded) return;
                currentPage = 1;
                applyClientFilters();
            });
        });

        let searchTimer = null;
        els.search?.addEventListener('input', () => {
            if (!dataLoaded) return;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                currentPage = 1;
                applyClientFilters();
            }, 250);
        });

        const openPrintPreview = async () => {
            if (!window.PrintSystem || typeof window.PrintSystem.preview !== 'function') {
                showToast('نظام معاينة الطباعة غير متاح', 'error');
                return;
            }
            // Once loaded, print the active filter result (including legitimate empty sets).
            if (!dataLoaded) {
                showToast('لا توجد معطيات للطباعة — حمّل أو استورد التوجيه أولاً', 'warning');
                return;
            }
            const handle = typeof showToast?.loading === 'function' ? showToast.loading('جاري تحضير المعاينة...') : null;
            try {
                updatePrintHeader();
                ensureOrientationPrintStyles();
                // Wait a frame so chart canvases are painted before rasterize
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                const printTitle = getOrientationPrintTitle();
                buildOrientationPrintSheet();
                await PrintSystem.preview({
                    contentSelector: '#orientation-export-sheet',
                    title: printTitle,
                    pageSize: 'A4',
                    landscape: true, // paysage — جداول عريضة
                    // Compact top: less sheet padding + smaller Electron PDF margins (inches)
                    sheetPadding: '2mm 5mm 4mm 5mm',
                    pdfMargins: { top: 0.06, bottom: 0.12, left: 0.12, right: 0.12 },
                    defaultFileName: `orientation-${schoolYear() || 'report'}`
                });
                handle?.success?.('جاهز للطباعة');
            } catch (err) {
                console.error(err);
                handle?.error?.(err.message || 'فشلت الطباعة');
                showToast(err.message || 'فشلت الطباعة', 'error');
            }
        };

        // Single print action lives in the sticky unified header (.header.dashboard-topbar) —
        // filters keep only تحديث / مسح الفلاتر. setupUnifiedHeader rebuilds .header, so
        // StickyTopbarPrint moves the static title-row #print-btn into .header-right once unified.
        mountOrientationTopBarPrint(openPrintPreview);

        els.resetFilters?.addEventListener('click', () => {
            if (els.level) els.level.value = '';
            if (els.section) els.section.value = '';
            if (els.origin) els.origin.value = '';
            if (els.choice1) els.choice1.value = '';
            if (els.search) els.search.value = '';
            currentPage = 1;
            // Mirror the level-change path: no category chosen → back to choose-level state
            showChooseLevelState(undefined, undefined, { wipe: !dataLoaded });
        });
    }

    // ── PrintSystem path A (shared preview) ─────────────────────────────

    /**
     * Mount / reattach the single Print Preview control into the sticky unified
     * header (.header.dashboard-topbar > .header-right), shared helper:
     * js/shared/orientation-topbar-print.js.
     */
    function mountOrientationTopBarPrint(openPrintPreview) {
        const api =
            typeof StickyTopbarPrint !== 'undefined'
                ? StickyTopbarPrint
                : typeof OrientationTopbarPrint !== 'undefined'
                  ? OrientationTopbarPrint
                  : typeof window !== 'undefined'
                    ? window.StickyTopbarPrint || window.OrientationTopbarPrint
                    : null;
        if (api && typeof api.ensurePrintInTopBar === 'function') {
            const attach = () => api.ensurePrintInTopBar(document, { onPrint: openPrintPreview });
            const result = attach();
            if (result && result.btn && result.header) return result;
            // setupUnifiedHeader may not have rebuilt .header yet — retry until the
            // sticky header exists so the button lands (and survives) in .header-right.
            let tries = 0;
            const timer = setInterval(() => {
                const r = attach();
                if ((r && r.btn && r.header) || ++tries > 20) clearInterval(timer);
            }, 50);
            return result;
        }
        // Fallback if shared helper script missing: wire existing #print-btn only.
        document.getElementById('print-btn')?.addEventListener('click', openPrintPreview);
        return null;
    }

    /**
     * Page-scoped print overrides (skill: print-preview §2).
     * Critical: do NOT use class `students-table` — global .ux-pp-sheet .students-table
     * nth-child widths (list layout) destroy multi-colspan orientation boards.
     */
    function ensureOrientationPrintStyles() {
        let style = document.getElementById('orientation-print-sheet-styles');
        if (!style) {
            style = document.createElement('style');
            style.id = 'orientation-print-sheet-styles';
            document.head.appendChild(style);
        }
        // Always refresh CSS so PDF layout fixes apply without hard-cache of old rules
        style.textContent = `
            .orientation-export-sheet {
                color: #1f2937 !important;
                font-size: 11px !important;
                line-height: 1.35 !important;
                direction: rtl !important;
                text-align: right !important;
                width: 100% !important;
            }
            .orientation-export-sheet,
            .orientation-export-sheet * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                box-sizing: border-box !important;
            }
            .orientation-export-sheet .or-sec {
                margin: 0 0 12px !important;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .orientation-export-sheet .or-sec-h {
                font-size: 12.5px !important;
                font-weight: 800 !important;
                color: #0f172a !important;
                border-bottom: 2px solid #0d9488 !important;
                padding: 0 0 5px !important;
                margin: 0 0 8px !important;
            }
            .orientation-export-sheet .or-sec-sub {
                font-size: 10px !important;
                color: #64748b !important;
                font-weight: 500 !important;
                margin-inline-start: 8px !important;
            }
            .orientation-export-sheet .or-empty {
                color: #94a3b8 !important;
                font-style: italic !important;
                padding: 6px 0 !important;
                margin: 0 !important;
            }
            /* Landscape: status + chart side by side */
            .orientation-export-sheet.or-landscape .or-row-2 {
                display: grid !important;
                grid-template-columns: 1.1fr 0.9fr !important;
                gap: 12px !important;
                align-items: start !important;
                margin: 0 0 8px !important;
            }
            .orientation-export-sheet.or-landscape .or-row-2 .or-sec {
                margin-bottom: 0 !important;
            }
            .orientation-export-sheet .or-chart {
                page-break-inside: avoid;
                break-inside: avoid;
            }
            .orientation-export-sheet .or-chart img {
                width: 100% !important;
                max-height: 220px !important;
                height: auto !important;
                object-fit: contain !important;
                display: block !important;
                border: 1px solid #cbd5e1 !important;
                border-radius: 6px !important;
                background: #fff !important;
            }

            /* ── Dedicated print table (NOT students-table) ── */
            .ux-pp-sheet .orientation-export-sheet table.or-board,
            .ux-pp-sheet .orientation-export-sheet table.or-status,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-board,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-status {
                width: 100% !important;
                max-width: 100% !important;
                border-collapse: collapse !important;
                table-layout: fixed !important;
                font-size: 9.5px !important;
                margin: 0 !important;
                direction: rtl !important;
            }
            .ux-pp-sheet .orientation-export-sheet table.or-board th,
            .ux-pp-sheet .orientation-export-sheet table.or-board td,
            .ux-pp-sheet .orientation-export-sheet table.or-status th,
            .ux-pp-sheet .orientation-export-sheet table.or-status td,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-board th,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-board td,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-status th,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-status td {
                border: 0.75px solid #64748b !important;
                padding: 3px 4px !important;
                vertical-align: middle !important;
                text-align: center !important;
                white-space: normal !important;
                overflow: visible !important;
                text-overflow: clip !important;
                word-break: break-word !important;
                color: #0f172a !important;
                background: #fff !important;
                width: auto !important;
                max-width: none !important;
                min-width: 0 !important;
            }
            .ux-pp-sheet .orientation-export-sheet table.or-board thead th,
            .ux-pp-sheet .orientation-export-sheet table.or-status thead th,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-board thead th,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-status thead th {
                background: #e2e8f0 !important;
                color: #0f172a !important;
                font-weight: 800 !important;
                font-size: 9px !important;
                line-height: 1.25 !important;
            }
            .ux-pp-sheet .orientation-export-sheet table.or-board tbody tr:nth-child(even) td,
            .ux-pp-sheet .orientation-export-sheet table.or-status tbody tr:nth-child(even) td,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-board tbody tr:nth-child(even) td,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-status tbody tr:nth-child(even) td {
                background: #f8fafc !important;
            }
            .ux-pp-sheet .orientation-export-sheet table.or-board td.or-txt,
            .ux-pp-sheet .orientation-export-sheet table.or-board th.or-txt,
            .ux-pp-sheet .orientation-export-sheet table.or-status td.or-txt,
            .ux-pp-sheet .orientation-export-sheet table.or-status th.or-txt,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-board td.or-txt,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-board th.or-txt,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-status td.or-txt,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-status th.or-txt {
                text-align: right !important;
                font-weight: 700 !important;
                background: #e0f2fe !important;
                color: #0c4a6e !important;
            }
            .ux-pp-sheet .orientation-export-sheet table.or-board td.or-dest,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-board td.or-dest {
                text-align: right !important;
                font-weight: 600 !important;
                background: #fff !important;
                color: #1e293b !important;
            }
            .ux-pp-sheet .orientation-export-sheet table.or-board td.or-ful,
            .ux-pp-sheet .orientation-export-sheet table.or-status td.or-ful,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-board td.or-ful,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-status td.or-ful {
                background: #ecfdf5 !important;
                font-weight: 800 !important;
            }
            .ux-pp-sheet .orientation-export-sheet table.or-board td.or-num,
            .ux-pp-sheet .orientation-export-sheet table.or-status td.or-num,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-board td.or-num,
            body.ux-printing-active #ux-print-root .orientation-export-sheet table.or-status td.or-num {
                font-variant-numeric: tabular-nums !important;
                font-weight: 700 !important;
            }
            /* Compact top margin on preview + PDF export */
            .ux-pp-sheet:has(.orientation-export-sheet),
            body.ux-printing-active #ux-print-root .ux-pp-sheet:has(.orientation-export-sheet),
            body.ux-printing-active #ux-print-root .ux-pp-sheet {
                width: 100% !important;
                min-height: 0 !important;
                padding: 2mm 5mm 4mm 5mm !important;
                overflow: visible !important;
            }
            .ux-pp-sheet:has(.orientation-export-sheet) .ux-pp-letterhead,
            body.ux-printing-active #ux-print-root .ux-pp-letterhead {
                padding-bottom: 4px !important;
                margin-bottom: 6px !important;
                border-bottom-width: 1.5px !important;
            }
            .ux-pp-sheet:has(.orientation-export-sheet) .ux-pp-letterhead img,
            body.ux-printing-active #ux-print-root .ux-pp-letterhead img {
                max-height: 48px !important;
                max-width: 48px !important;
            }
            /* Title badge under letterhead — tighter top gap */
            .ux-pp-sheet:has(.orientation-export-sheet) .ux-pp-letterhead > div,
            body.ux-printing-active #ux-print-root .ux-pp-letterhead > div {
                margin-top: 4px !important;
            }
            .ux-pp-sheet:has(.orientation-export-sheet) .ux-pp-letterhead > div > div,
            body.ux-printing-active #ux-print-root .ux-pp-letterhead > div > div {
                padding: 4px 16px !important;
            }
            .ux-pp-sheet:has(.orientation-export-sheet) .ux-pp-letterhead > div > div > div,
            body.ux-printing-active #ux-print-root .ux-pp-letterhead > div > div > div {
                font-size: 14px !important;
            }
            .orientation-export-sheet .or-sec {
                margin-top: 0 !important;
            }
            .orientation-export-sheet .or-sec-h {
                margin-top: 0 !important;
                margin-bottom: 6px !important;
                padding-bottom: 3px !important;
            }
        `;
    }

    function printTxt(id) {
        return (document.getElementById(id)?.textContent || '').trim();
    }

    function printSelectLabel(selectEl) {
        if (!selectEl || !selectEl.value) return '';
        const opt = selectEl.selectedOptions?.[0];
        return (opt?.textContent || selectEl.value || '').trim();
    }

    function printNum(n) {
        const v = Number(n) || 0;
        return v > 0 ? String(v) : '';
    }

    /**
     * Build orientation board HTML from data model (not DOM clone).
     * Avoids students-table global print nth-child width rules.
     * No rowspan — each row repeats origin (PDF-safe).
     */
    function buildBoardPrintHtml(rows) {
        const model = buildBoardModel(rows);
        if (!model.length) return '';

        // Official order: lowest band first → highest
        const bandLabels = ['أقل من 8', '[10 - 8]', '[12 - 10]', '[14 - 12]', '[16 - 14]', '[20 - 16]'];
        // Landscape A4: origin 16% · dest 22% · M/F 5% each · 6 bands · fulfilled
        let html = `<table class="or-board" dir="rtl">
            <colgroup>
                <col style="width:16%"><col style="width:20%">
                <col style="width:5%"><col style="width:5%">
                <col style="width:7%"><col style="width:7%"><col style="width:7%">
                <col style="width:7%"><col style="width:7%"><col style="width:7%">
                <col style="width:5%">
            </colgroup>
            <thead>
                <tr>
                    <th rowspan="2" class="or-txt">الشعبة الأصلية</th>
                    <th rowspan="2" class="or-dest">إمكانات التوجيه</th>
                    <th colspan="2">المجموع</th>
                    <th colspan="6">مجالات المعدلات السنوية العامة</th>
                    <th rowspan="2">الطلبات الملبية</th>
                </tr>
                <tr>
                    <th>الذكور</th><th>الإناث</th>
                    ${bandLabels.map((l) => `<th>${l}</th>`).join('')}
                </tr>
            </thead>
            <tbody>`;

        for (const group of model) {
            for (const r of group.rows) {
                const bands = (r.bands || []).map((n) => `<td class="or-num">${printNum(n)}</td>`).join('');
                html += `<tr>
                    <td class="or-txt">${esc(group.origin)}</td>
                    <td class="or-dest">${esc(r.dest)}</td>
                    <td class="or-num">${printNum(r.totalM)}</td>
                    <td class="or-num">${printNum(r.totalF)}</td>
                    ${bands}
                    <td class="or-num or-ful">${printNum(r.fulfilled)}</td>
                </tr>`;
            }
        }
        html += `</tbody></table>`;
        return html;
    }

    function buildStatusPrintHtml(rows) {
        const model = buildStatusBoardModel(rows);
        if (!model.length) return '';

        let html = `<table class="or-status" dir="rtl">
            <colgroup>
                <col style="width:40%">
                <col style="width:10%"><col style="width:10%">
                <col style="width:10%"><col style="width:10%">
                <col style="width:10%">
            </colgroup>
            <thead>
                <tr>
                    <th rowspan="2" class="or-txt">الشعبة الأصلية</th>
                    <th colspan="2">المكررون (يكرر)</th>
                    <th colspan="2">المفصولون (يفصل)</th>
                    <th rowspan="2">المجموع</th>
                </tr>
                <tr>
                    <th>الذكور</th><th>الإناث</th>
                    <th>الذكور</th><th>الإناث</th>
                </tr>
            </thead>
            <tbody>`;

        for (const r of model) {
            html += `<tr>
                <td class="or-txt">${esc(r.origin)}</td>
                <td class="or-num">${printNum(r.repM)}</td>
                <td class="or-num">${printNum(r.repF)}</td>
                <td class="or-num">${printNum(r.disM)}</td>
                <td class="or-num">${printNum(r.disF)}</td>
                <td class="or-num or-ful">${printNum(r.total)}</td>
            </tr>`;
        }
        html += `</tbody></table>`;
        return html;
    }

    /** Rasterize a live chart canvas so it survives PrintSystem clone. */
    function chartImageBlock(canvasId, title) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || canvas.tagName !== 'CANVAS') return '';
        let dataUrl = '';
        try {
            dataUrl = canvas.toDataURL('image/png', 1);
        } catch (_) {
            return '';
        }
        if (!dataUrl || dataUrl.length < 100) return '';
        return (
            `<div class="or-chart">` +
            `<img src="${dataUrl}" alt="${esc(title)}">` +
            `</div>`
        );
    }

    /**
     * Dynamic print title from selected level/category + school year.
     * e.g. نتائج التوجيه الخاصة بالأوليات باكالوريا للموسم الدراسي 2025/2026
     */
    function getOrientationPrintTitle() {
        const year = schoolYear() || '—';
        const levelVal = els.level?.value || '';
        let phrase = 'بالتوجيه المدرسي';

        if (levelVal === '__group:tronc') {
            phrase = 'بالجذوع المشتركة';
        } else if (levelVal === '__group:1bac') {
            phrase = 'بالأوليات باكالوريا';
        } else if (levelVal === '__group:2bac') {
            phrase = 'بالثواني باكالوريا';
        } else if (levelVal === '__group:other') {
            phrase = 'بالمستويات الأخرى';
        } else if (levelVal.startsWith('__stream:')) {
            const key = levelVal.slice('__stream:'.length);
            if (key.startsWith('tronc_')) phrase = 'بالجذوع المشتركة';
            else if (key.startsWith('1bac_')) phrase = 'بالأوليات باكالوريا';
            else if (key.startsWith('2bac_')) phrase = 'بالثواني باكالوريا';
            else {
                const label = (printSelectLabel(els.level) || key).replace(/^[\s·]+/, '');
                phrase = `بـ«${label}»`;
            }
        } else if (levelVal) {
            const fam = streamFamilyKey(levelVal);
            if (fam.startsWith('tronc_')) phrase = 'بالجذوع المشتركة';
            else if (fam.startsWith('1bac_')) phrase = 'بالأوليات باكالوريا';
            else if (fam.startsWith('2bac_')) phrase = 'بالثواني باكالوريا';
            else {
                const label = printSelectLabel(els.level) || levelVal;
                phrase = `بـ«${label.replace(/^[\s·]+/, '')}»`;
            }
        }

        return `نتائج التوجيه الخاصة ${phrase} للموسم الدراسي ${year}`;
    }

    /**
     * Build curated landscape (paysage) print DOM from data models.
     * Title comes from PrintSystem letterhead (getOrientationPrintTitle).
     * No filter meta bar (موسم / فئة / تاريخ / Paysage) — removed from print.
     * 1) جدول إمكانات التوجيه  2) المكررون/المفصولون  3) رسم الشعبة الأصلية
     */
    function buildOrientationPrintSheet() {
        // After a successful load, always print the active filter set (may be empty).
        const sourceRows = dataLoaded ? filteredRows : allRows;

        let html = '';

        const boardHtml = buildBoardPrintHtml(sourceRows);
        html += `<section class="or-sec"><h3 class="or-sec-h">جدول إمكانات التوجيه</h3>`;
        html += boardHtml || `<p class="or-empty">لا توجد بيانات لجدول التوجيه (الملبّون).</p>`;
        html += `</section>`;

        const statusHtml = buildStatusPrintHtml(sourceRows);
        const originChart = chartImageBlock('chart-origin', 'التلاميذ حسب الشعبة الأصلية');

        html += `<div class="or-row-2">`;
        html += `<section class="or-sec"><h3 class="or-sec-h">المكررون والمفصولون</h3>`;
        html += statusHtml || `<p class="or-empty">لا يوجد مكررون أو مفصولون في التصفية الحالية.</p>`;
        html += `</section>`;

        html += `<section class="or-sec"><h3 class="or-sec-h">التلاميذ حسب الشعبة الأصلية</h3>`;
        html += originChart || `<p class="or-empty">لا يوجد رسم بياني للشعبة الأصلية.</p>`;
        html += `</section>`;
        html += `</div>`;

        let wrap = document.getElementById('orientation-export-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'orientation-export-wrap';
            wrap.className = 'no-print';
            wrap.style.display = 'none';
            wrap.setAttribute('aria-hidden', 'true');
            document.body.appendChild(wrap);
        }
        wrap.innerHTML = `<div id="orientation-export-sheet" class="orientation-export-sheet or-landscape">${html}</div>`;
    }

    /**
     * Level categories — one clean option per stream family (no spelling/spacing duplicates).
     * Filter values: __group:id | __stream:key
     * Matching uses streamFamilyKey() so Massar variants still count.
     */
    const LEVEL_GROUP_DEFS = [
        {
            id: 'tronc',
            label: 'الجذوع المشتركة',
            allLabel: 'كل الجذوع المشتركة',
            match: (name) => /جذع\s*مشترك|الجذع\s*المشترك/i.test(name),
            streams: [
                {
                    key: 'tronc_sci',
                    label: 'الجذع المشترك العلمي – خيار فرنسية'
                },
                {
                    key: 'tronc_letters',
                    label: 'جذع مشترك الآداب والعلوم الإنسانية'
                }
            ]
        },
        {
            id: '1bac',
            label: 'الأوليات باكالوريا',
            allLabel: 'كل الأوليات باكالوريا',
            match: (name) => /الأولى\s*باك|اولى\s*باك|الأولى\s*باكالوريا|اولى\s*باكالوريا/i.test(name),
            streams: [
                {
                    key: '1bac_math',
                    label: 'الأولى باكالوريا العلوم الرياضية – خيار فرنسية'
                },
                {
                    key: '1bac_exp',
                    label: 'الأولى باكالوريا العلوم التجريبية – خيار فرنسية'
                },
                {
                    key: '1bac_letters',
                    label: 'الأولى باكالوريا الآداب والعلوم الإنسانية'
                },
                {
                    key: '1bac_eco',
                    label: 'الأولى باكالوريا علوم الاقتصاد والتدبير'
                }
            ]
        },
        {
            id: '2bac',
            label: 'الثواني باكالوريا',
            allLabel: 'كل الثواني باكالوريا',
            match: (name) => /الثانية\s*باك|ثانية\s*باك|الثانية\s*باكالوريا|ثانية\s*باكالوريا/i.test(name),
            streams: [
                { key: '2bac_math', label: 'الثانية باكالوريا العلوم الرياضية – خيار فرنسية' },
                { key: '2bac_pc', label: 'الثانية باكالوريا العلوم الفيزيائية – خيار فرنسية' },
                { key: '2bac_svt', label: 'الثانية باكالوريا علوم الحياة والأرض – خيار فرنسية' },
                { key: '2bac_letters', label: 'الثانية باكالوريا الآداب والعلوم الإنسانية' },
                { key: '2bac_eco', label: 'الثانية باكالوريا علوم الاقتصاد والتدبير' }
            ]
        }
    ];

    /** Collapse Massar spelling variants into one family key (dedupe dropdown + filter). */
    function streamFamilyKey(name) {
        const n = String(name || '')
            .trim()
            .replace(/\u0640/g, '')
            .replace(/[–—−]/g, '-')
            .replace(/\s+/g, ' ');
        if (!n) return '';

        // ── Tronc commun ──
        if (/جذع|المشترك/i.test(n)) {
            if (/آداب|انسان|إنسان|للآداب/i.test(n)) return 'tronc_letters';
            if (/علمي|علوم?\s*تجريب|رياض/i.test(n) || /المشترك العلمي|جذع مشترك علمي/i.test(n)) {
                // scientific tronc (with or without French option)
                if (/آداب|إنسان|انسان/i.test(n)) return 'tronc_letters';
                return 'tronc_sci';
            }
            if (/علمي/i.test(n)) return 'tronc_sci';
        }

        // ── 1BAC ──
        if (/الأولى|اولى|1\s*bac/i.test(n)) {
            if (/رياض/i.test(n)) return '1bac_math';
            if (/تجريب/i.test(n)) return '1bac_exp';
            if (/اقتصاد|تدبير|إقتصاد/i.test(n)) return '1bac_eco';
            if (/آداب|إنسان|انسان/i.test(n)) return '1bac_letters';
        }

        // ── 2BAC ──
        if (/الثانية|ثانية|2\s*bac/i.test(n)) {
            if (/رياض/i.test(n)) return '2bac_math';
            if (/فيزي|phys/i.test(n)) return '2bac_pc';
            if (/حياة|أرض|svt|SVT/i.test(n)) return '2bac_svt';
            if (/اقتصاد|تدبير|إقتصاد/i.test(n)) return '2bac_eco';
            if (/آداب|إنسان|انسان/i.test(n)) return '2bac_letters';
        }

        return `raw:${n}`;
    }

    async function initFilters() {
        try {
            // Section cascade only — level select is custom (grouped) for orientation streams.
            // FilterManager owns the section change event (do not also bind section in bindEvents).
            if (typeof FilterManager === 'function') {
                filterManager = new FilterManager({
                    selectors: { class: 'section-select' },
                    placeholders: { class: 'كل الأقسام' },
                    onChange: () => {
                        if (!dataLoaded) return;
                        currentPage = 1;
                        applyClientFilters();
                    },
                    onError: (err, key) => {
                        console.warn('[orientation] FilterManager load warning:', key, err);
                    }
                });
                await filterManager.init();
            }
            // Static groups/streams so user can choose before any IPC load
            populateLevelSelect([]);
        } catch (err) {
            console.error('FilterManager init failed:', err);
            showToast('تعذّر تحميل قائمة الأقسام', 'warning');
        }
    }

    function showChooseLevelState(title, message, { wipe = true } = {}) {
        if (wipe) {
            clearDisplayState();
            dataLoaded = false;
        }
        showEmpty(true);
        const t = document.getElementById('empty-state-title');
        const m = document.getElementById('empty-state-message');
        if (t) t.textContent = title || 'اختر المستوى / الفئة أولاً';
        if (m) {
            m.innerHTML =
                message ||
                'لتخفيف الصفحة، لا تُحمَّل المعطيات تلقائياً. اختر من القائمة <strong>المستوى / الفئة</strong> ثم اضغط <strong>تحديث</strong>.';
        }
    }

    /**
     * Require level selection; load from API once (or force reload), then filter.
     */
    async function requestLoadOrFilter({ forceReload = false } = {}) {
        const levelVal = els.level?.value || '';
        if (!levelVal) {
            showToast('اختر المستوى / الفئة من القائمة أولاً', 'warning');
            showChooseLevelState();
            els.level?.focus();
            return;
        }
        if (loadInFlight) return;

        if (!dataLoaded || forceReload) {
            await loadAll();
            return;
        }
        applyClientFilters();
    }

    function classifyStreamName(name) {
        const n = String(name || '').trim();
        if (!n) return null;
        for (const g of LEVEL_GROUP_DEFS) {
            if (g.match(n)) return g.id;
        }
        return 'other';
    }

    /**
     * Clean dropdown — NO duplicates:
     * - Group header (selectable): الجذوع المشتركة / الأوليات باكالوريا
     * - One line per stream family (variants of Massar spelling are collapsed)
     */
    function populateLevelSelect(rows) {
        if (!els.level) return;
        const current = els.level.value;

        // Families present in loaded data (for "other" leftovers only)
        const dataKeys = new Set();
        for (const r of rows || []) {
            const k1 = streamFamilyKey(r.origin_stream);
            const k2 = streamFamilyKey(r.level);
            if (k1) dataKeys.add(k1);
            if (k2) dataKeys.add(k2);
        }

        const knownStreamKeys = new Set();
        for (const g of LEVEL_GROUP_DEFS) {
            for (const s of g.streams || []) knownStreamKeys.add(s.key);
        }

        els.level.replaceChildren();

        const addOption = (value, text, attrs = {}) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            if (attrs.className) opt.className = attrs.className;
            els.level.appendChild(opt);
            return opt;
        };

        addOption('', '— اختر المستوى / الفئة —');

        for (const g of LEVEL_GROUP_DEFS) {
            const streams = g.streams || [];
            if (!streams.length && !g.match) continue;

            addOption(`__group:${g.id}`, g.label, { className: 'level-group-option' });

            for (const s of streams) {
                // Always list canonical streams (even before load) — one option each
                addOption(`__stream:${s.key}`, ` · ${s.label}`);
            }
        }

        // Any data families not covered by known streams
        const otherKeys = [...dataKeys].filter((k) => k.startsWith('raw:') && !knownStreamKeys.has(k));
        if (otherKeys.length) {
            addOption('__group:other', 'مستويات أخرى', { className: 'level-group-option' });
            for (const k of otherKeys.sort((a, b) => a.localeCompare(b, 'ar'))) {
                const label = k.replace(/^raw:/, '');
                addOption(`__stream:${k}`, ` · ${label}`);
            }
        }

        // Restore selection; map legacy raw stream names → family keys
        let restore = current;
        if (restore && !restore.startsWith('__') && restore !== '') {
            const fam = streamFamilyKey(restore);
            if (fam && !fam.startsWith('raw:')) restore = `__stream:${fam}`;
        }
        const stillValid = [...els.level.options].some((o) => o.value === restore);
        if (stillValid) els.level.value = restore;
    }

    /** True if row belongs to selected group or stream family. */
    function rowMatchesLevelFilter(row, levelVal) {
        if (!levelVal) return true;

        const origin = String(row.origin_stream || '').trim();
        const level = String(row.level || '').trim();
        const sectionLevel =
            typeof getLevelFromSection === 'function'
                ? getLevelFromSection(row.section)?.name || ''
                : '';

        const keys = [streamFamilyKey(origin), streamFamilyKey(level), streamFamilyKey(sectionLevel)].filter(
            Boolean
        );

        if (levelVal.startsWith('__group:')) {
            const groupId = levelVal.slice('__group:'.length);
            if (groupId === 'other') {
                return keys.some((k) => k.startsWith('raw:'));
            }
            const g = LEVEL_GROUP_DEFS.find((x) => x.id === groupId);
            if (!g) return true;
            const groupKeys = new Set((g.streams || []).map((s) => s.key));
            return (
                keys.some((k) => groupKeys.has(k)) ||
                g.match(origin) ||
                g.match(level) ||
                g.match(sectionLevel)
            );
        }

        if (levelVal.startsWith('__stream:')) {
            const want = levelVal.slice('__stream:'.length);
            return keys.includes(want);
        }

        // Legacy plain text value
        const wantFam = streamFamilyKey(levelVal);
        if (wantFam && !wantFam.startsWith('raw:')) {
            return keys.includes(wantFam);
        }
        return origin === levelVal || level === levelVal || sectionLevel === levelVal;
    }

    function schoolYear() {
        return typeof getSchoolYear === 'function' ? getSchoolYear() : '';
    }

    function ensureOk(result, fallbackCode, fallbackMessage) {
        if (result && typeof result === 'object' && result.success === false) {
            const code =
                result.code && orientationCodeKnown(result.code)
                    ? result.code
                    : fallbackCode || 'LIST_LOAD_ERROR';
            throw createDisplayError(code, {
                message:
                    (result.error || result.message) &&
                    /[\u0600-\u06FF]/.test(String(result.error || result.message))
                        ? String(result.error || result.message)
                        : fallbackMessage || orientationDefaultMessage(code),
                details: result.details || null,
                retryable: result.retryable
            });
        }
        return result;
    }

    /** Silent close of loading toast for ordinary stale discard (FR-012a) — no toast/status spam. */
    function dismissLoadingSilently(handle) {
        if (!handle) return;
        try {
            if (typeof handle.success === 'function') handle.success('');
            else if (typeof handle.dismiss === 'function') handle.dismiss();
        } catch (_) {
            /* ignore */
        }
    }

    function clearDisplayState() {
        allRows = [];
        filteredRows = [];
        currentPage = 1;
        if (els.detailTbody) els.detailTbody.replaceChildren();
        if (els.matrixThead) els.matrixThead.replaceChildren();
        if (els.matrixTbody) els.matrixTbody.replaceChildren();
        if (els.kpiTotal) els.kpiTotal.textContent = '—';
        if (els.kpiTotalSub) els.kpiTotalSub.textContent = 'في السنة الحالية';
        if (els.kpiOrigins) els.kpiOrigins.textContent = '—';
        if (els.kpiChoices) els.kpiChoices.textContent = '—';
        if (els.kpiAssigned) els.kpiAssigned.textContent = '—';
        if (els.kpiAssignedSub) els.kpiAssignedSub.textContent = 'مسند / إجمالي';
        if (els.kpiAssignedBar) els.kpiAssignedBar.style.width = '0%';
        if (els.kpiGenderSplit) els.kpiGenderSplit.textContent = '—';
        if (els.kpiGenderBarMale) els.kpiGenderBarMale.style.width = '0%';
        if (els.kpiGenderBarFemale) els.kpiGenderBarFemale.style.width = '0%';
        if (els.kpiGenderSub) els.kpiGenderSub.textContent = 'من التلاميذ';
        if (els.boardTbody) els.boardTbody.replaceChildren();
        if (els.statusBoardTbody) els.statusBoardTbody.replaceChildren();
        if (els.filterEmptyBanner) els.filterEmptyBanner.hidden = true;
        setResultStatus('');
        destroyCharts();
    }

    function setResultStatus(message) {
        if (!els.resultStatus) return;
        els.resultStatus.textContent = message || '';
    }

    /**
     * Build chart series + origin→choice matrix from the same row population used by KPIs/tables.
     * Level groups use family matching client-side, so aggregates must follow filteredRows.
     */
    function buildAggregateFromRows(rows) {
        const list = Array.isArray(rows) ? rows : [];
        const byOriginMap = new Map();
        const byChoice1Map = new Map();
        const byAssignedMap = new Map();
        const cells = {};

        for (const row of list) {
            const origin = String(row.origin_stream || '').trim() || '—';
            const choice = String(row.choice_1 || '').trim() || '—';
            const assigned = String(row.assigned_stream || '').trim() || 'غير مسند';

            byOriginMap.set(origin, (byOriginMap.get(origin) || 0) + 1);
            byChoice1Map.set(choice, (byChoice1Map.get(choice) || 0) + 1);
            byAssignedMap.set(assigned, (byAssignedMap.get(assigned) || 0) + 1);

            if (!cells[origin]) cells[origin] = {};
            cells[origin][choice] = (cells[origin][choice] || 0) + 1;
        }

        const toSeries = (map) =>
            [...map.entries()]
                .map(([key, count]) => ({ key, count }))
                .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'ar'));

        const origins = [...byOriginMap.keys()].sort((a, b) => a.localeCompare(b, 'ar'));
        const choices = [...byChoice1Map.keys()].sort((a, b) => a.localeCompare(b, 'ar'));

        return {
            byOrigin: toSeries(byOriginMap),
            byChoice1: toSeries(byChoice1Map),
            byAssigned: toSeries(byAssignedMap),
            matrix: { origins, choices, cells }
        };
    }

    function destroyCharts() {
        destroyChart(chartOrigin);
        destroyChart(chartAssigned);
        chartOrigin = null;
        chartAssigned = null;
    }

    function isValidOrientationRow(row) {
        if (!row || typeof row !== 'object') return false;
        const code = String(row.student_code || '').trim();
        const origin = String(row.origin_stream || '').trim();
        return !!(code && origin);
    }

    async function loadAll() {
        if (loadInFlight) return;
        loadInFlight = true;
        const generation = ++loadGeneration;
        const handle = typeof showToast?.loading === 'function' ? showToast.loading('جاري تحميل معطيات التوجيه...') : null;
        // Keep level selection while reloading
        const savedLevel = els.level?.value || '';
        clearDisplayState();
        dataLoaded = false;
        showEmpty(true);

        try {
            const year = schoolYear();
            if (!year) {
                const err = createDisplayError('INVALID_SCHOOL_YEAR');
                handle?.error?.(displayUserMessage(err));
                showToast(displayUserMessage(err), 'error');
                showChooseLevelState();
                return;
            }
            if (!window.api?.orientation?.list) {
                const err = createDisplayError('LIST_LOAD_ERROR', {
                    message: 'واجهة التوجيه غير متاحة في هذا الإصدار.'
                });
                handle?.error?.(displayUserMessage(err));
                showChooseLevelState(displayUserMessage(err), 'تأكد من تشغيل التطبيق بنسخة تدعم التوجيه.');
                return;
            }

            // Year-wide list: level groups use stream-family matching client-side, and secondary
            // filters (section/origin/choice/search) must remain interactive without re-fetch.
            let listRes;
            try {
                listRes = await window.api.orientation.list({ schoolYear: year });
            } catch (ipcEx) {
                // Transport / channel throw (distinct from success:false payload)
                throw createDisplayError('LIST_LOAD_ERROR', {
                    message: displayUserMessage(ipcEx),
                    details: { phase: 'ipc_exception' }
                });
            }

            // Discard if school year changed or a newer load started (silent — FR-012a)
            if (generation !== loadGeneration || schoolYear() !== year) {
                dismissLoadingSilently(handle);
                return;
            }

            ensureOk(listRes, 'LIST_LOAD_ERROR', 'فشل تحميل قائمة التوجيه');

            const listYear = listRes.schoolYear || listRes.school_year || null;
            if (listYear && listYear !== year) {
                // Visible non-blocking consistency failure (FR-012b) — not empty success
                throw createDisplayError('YEAR_RESPONSE_MISMATCH', {
                    message: `${orientationDefaultMessage('YEAR_RESPONSE_MISMATCH')} (المطلوب ${year} · القائمة ${listYear || '—'})`,
                    details: { requested: year, listYear }
                });
            }

            // Optional stats channel (when available) — year must match; failure does not block table
            if (typeof window.api.orientation.stats === 'function') {
                try {
                    const statsRes = await window.api.orientation.stats(year);
                    if (generation !== loadGeneration || schoolYear() !== year) {
                        dismissLoadingSilently(handle);
                        return;
                    }
                    if (statsRes && statsRes.success === false) {
                        console.warn('[orientation] stats load failed:', statsRes.code || statsRes.error);
                        setResultStatus(orientationDefaultMessage('STATS_LOAD_ERROR'));
                    } else if (statsRes) {
                        const statsYear = statsRes.schoolYear || statsRes.school_year || null;
                        if (statsYear && statsYear !== year) {
                            throw createDisplayError('YEAR_RESPONSE_MISMATCH', {
                                message: `${orientationDefaultMessage('YEAR_RESPONSE_MISMATCH')} (المطلوب ${year} · الإحصائيات ${statsYear})`,
                                details: { requested: year, statsYear }
                            });
                        }
                    }
                } catch (statsErr) {
                    if (statsErr?.code === 'YEAR_RESPONSE_MISMATCH') throw statsErr;
                    if (statsErr?.code === 'STALE_RESPONSE') {
                        dismissLoadingSilently(handle);
                        return;
                    }
                    console.warn('[orientation] stats exception:', statsErr);
                    // Non-fatal: KPIs/charts derive from list rows client-side
                }
            }

            if (generation !== loadGeneration || schoolYear() !== year) {
                dismissLoadingSilently(handle);
                return;
            }

            const rawRows = Array.isArray(listRes.rows) ? listRes.rows : [];
            allRows = rawRows.filter(isValidOrientationRow);
            dataLoaded = true;

            populateDynamicSelects(allRows);
            if (savedLevel && els.level) {
                const ok = [...els.level.options].some((o) => o.value === savedLevel);
                if (ok) els.level.value = savedLevel;
            }

            if (!allRows.length) {
                showEmpty(true);
                const t = document.getElementById('empty-state-title');
                const m = document.getElementById('empty-state-message');
                if (t) t.textContent = 'لا توجد معطيات توجيه';
                if (m) {
                    m.innerHTML =
                        'لا سجلات لهذه السنة. استورد التوجيه من <a href="settings-imports.html?type=orientation&amp;source=students-orientation">مركز الاستيراد</a>.';
                }
                setResultStatus('لا توجد معطيات توجيه لهذه السنة.');
                handle?.success?.('لا بيانات');
                return;
            }

            // KPIs, boards, charts, and matrix all derive from the same filtered population
            applyClientFilters();
            updatePrintHeader();
            handle?.success?.(`تم التحميل (${filteredRows.length} / ${allRows.length})`);
        } catch (err) {
            if (err?.code === 'STALE_RESPONSE' || generation !== loadGeneration) {
                return;
            }
            console.error('[orientation] loadAll:', err?.code || '', err);
            dataLoaded = false;
            clearDisplayState();
            const msg = displayUserMessage(err);
            showChooseLevelState('فشل التحميل', msg);
            handle?.error?.(msg);
            showToast(msg, 'error');
        } finally {
            if (generation === loadGeneration) {
                loadInFlight = false;
            }
        }
    }

    function showEmpty(isEmpty) {
        if (els.empty) els.empty.hidden = !isEmpty;
        if (els.content) els.content.hidden = isEmpty;
    }

    function populateDynamicSelects(rows) {
        const origins = uniqueSorted(rows.map((r) => r.origin_stream));
        const choices = uniqueSorted(rows.map((r) => r.choice_1));

        populateLevelSelect(rows);
        fillSelect(els.origin, origins, 'كل الشعب');
        fillSelect(els.choice1, choices, 'كل الاختيارات');
    }

    function uniqueSorted(values) {
        return [...new Set(values.map((v) => (v == null ? '' : String(v).trim())).filter(Boolean))].sort((a, b) =>
            a.localeCompare(b, 'ar')
        );
    }

    function fillSelect(select, values, placeholder) {
        if (!select) return;
        const current = select.value;
        select.innerHTML = '';
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = placeholder;
        select.appendChild(opt0);
        for (const v of values) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            select.appendChild(opt);
        }
        if (values.includes(current)) select.value = current;
    }

    function applyClientFilters() {
        if (!dataLoaded) {
            showChooseLevelState();
            return;
        }

        const level = els.level?.value || '';
        if (!level) {
            showToast('اختر المستوى / الفئة من القائمة أولاً', 'warning');
            showChooseLevelState(
                'اختر المستوى / الفئة',
                'حدّد فئة أو مستوى من القائمة لعرض الجداول.',
                { wipe: false }
            );
            return;
        }

        const section = els.section?.value || '';
        const origin = els.origin?.value || '';
        const choice1 = els.choice1?.value || '';
        const q = (els.search?.value || '').trim().toLowerCase();

        filteredRows = allRows.filter((row) => {
            if (section && String(row.section || '') !== section) return false;
            if (origin && String(row.origin_stream || '') !== origin) return false;
            if (choice1 && String(row.choice_1 || '') !== choice1) return false;
            if (!rowMatchesLevelFilter(row, level)) return false;
            if (q) {
                const hay = `${row.student_code || ''} ${row.full_name || ''} ${row.section || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        currentPage = Math.min(currentPage, Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE) || 1));

        // After a successful year load, keep content visible even when filters match zero rows
        // so KPIs (zeros), table headings, and component empty states remain available.
        showEmpty(false);
        if (els.filterEmptyBanner) {
            els.filterEmptyBanner.hidden = filteredRows.length > 0;
        }

        const g = countGenderFromRows(filteredRows);
        const assigned = filteredRows.filter((r) => String(r.assigned_stream || '').trim()).length;
        const origins = new Set(filteredRows.map((r) => String(r.origin_stream || '').trim()).filter(Boolean));
        const choices = new Set(filteredRows.map((r) => String(r.choice_1 || '').trim()).filter(Boolean));
        renderKpis(
            {
                total: filteredRows.length,
                origin_count: origins.size,
                choice1_distinct: choices.size,
                assigned_count: assigned,
                male_count: g.male,
                female_count: g.female
            },
            filteredRows
        );
        renderOrientationBoard(filteredRows);
        renderStatusBoard(filteredRows);
        renderDetailTable();

        const aggregate = buildAggregateFromRows(filteredRows);
        renderCharts(aggregate).catch((chartErr) => {
            console.warn('[orientation] CHART_RENDER_ERROR:', chartErr);
            // Charts must never block tables/KPIs
            setResultStatus(
                (els.resultStatus?.textContent ? els.resultStatus.textContent + ' · ' : '') +
                    orientationDefaultMessage('CHART_RENDER_ERROR')
            );
        });
        try {
            renderMatrix(aggregate.matrix);
        } catch (matrixErr) {
            console.warn('[orientation] matrix failed:', matrixErr);
        }

        setResultStatus(
            filteredRows.length
                ? `${filteredRows.length} تلميذ/ة ضمن التصفية الحالية (من ${allRows.length} محمّل).`
                : 'لا نتائج لهذه التصفية — جرّب فئة أخرى أو ألغِ بعض الفلاتر.'
        );
        updatePrintHeader();
    }

    // ── Official orientation board (جدول إمكانات التوجيه) ──

    function isRowMale(gender) {
        if (typeof isMale === 'function' && isMale(gender)) return true;
        const g = String(gender || '')
            .trim()
            .toLowerCase();
        return g === 'm' || g === 'male' || g === 'ذكر' || g === '1';
    }

    function isRowFemale(gender) {
        if (typeof isFemale === 'function' && isFemale(gender)) return true;
        const g = String(gender || '')
            .trim()
            .toLowerCase();
        return g === 'f' || g === 'female' || g === 'أنثى' || g === '2';
    }

    /**
     * Massar ResultatsList statuses only:
     * - يكرر → المكررون
     * - يفصل → المفصولون
     * - ينتقل → طلب ملبّى (وجهة مسندة)
     */
    function classifyDecision(status) {
        const s = String(status || '').trim();
        if (!s) return 'other';
        if (s === 'يفصل') return 'dismissed';
        if (s === 'يكرر') return 'repeater';
        if (s === 'ينتقل') return 'passed';
        return 'other';
    }

    /**
     * Board destination for guided students only (not يكرر/يفصل).
     */
    function boardDestination(row) {
        const assigned = String(row.assigned_stream || '').trim();
        if (assigned) return assigned;
        const c1 = String(row.choice_1 || '').trim();
        if (c1) return c1;
        return '—';
    }

    /**
     * Average band index — lowest first (matches table headers):
     * 0: أقل من 8 | 1: [10-8] | 2: [12-10] | 3: [14-12] | 4: [16-14] | 5: [20-16]
     */
    function averageBandIndex(avg) {
        if (avg == null || avg === '') return -1;
        const a = Number(avg);
        if (!Number.isFinite(a)) return -1;
        if (a < 8) return 0;
        if (a < 10) return 1;
        if (a < 12) return 2;
        if (a < 14) return 3;
        if (a < 16) return 4;
        return 5; // 16 … 20
    }

    function emptyBucket() {
        return {
            totalM: 0,
            totalF: 0,
            bands: [0, 0, 0, 0, 0, 0],
            fulfilled: 0
        };
    }

    function emptyStatusBucket() {
        return { repM: 0, repF: 0, disM: 0, disF: 0 };
    }

    /**
     * Main board: exclude يكرر / يفصل (they have their own table).
     * المجموع + الطلبات الملبية for guided / other non-status students only.
     */
    function buildBoardModel(rows) {
        /** @type {Map<string, Map<string, ReturnType<typeof emptyBucket>>>} */
        const byOrigin = new Map();

        for (const row of rows || []) {
            const kind = classifyDecision(row.decision_status);
            if (kind === 'repeater' || kind === 'dismissed') continue;

            const origin = String(row.origin_stream || '').trim() || '—';
            const dest = boardDestination(row);
            if (!byOrigin.has(origin)) byOrigin.set(origin, new Map());
            const destMap = byOrigin.get(origin);
            if (!destMap.has(dest)) destMap.set(dest, emptyBucket());
            const b = destMap.get(dest);

            const male = isRowMale(row.gender);
            const female = isRowFemale(row.gender);
            if (male) b.totalM += 1;
            else if (female) b.totalF += 1;

            if (kind === 'passed') b.fulfilled += 1;

            const bi = averageBandIndex(row.average);
            if (bi >= 0) b.bands[bi] += 1;
        }

        const origins = [...byOrigin.keys()].sort((a, b) => a.localeCompare(b, 'ar'));
        return origins.map((origin) => {
            const destMap = byOrigin.get(origin);
            const destinations = [...destMap.keys()].sort((a, b) => a.localeCompare(b, 'ar'));
            return {
                origin,
                rows: destinations.map((dest) => ({ dest, ...destMap.get(dest) }))
            };
        });
    }

    /**
     * Status board: only يكرر / يفصل, totals per origin stream (all sections combined).
     */
    function buildStatusBoardModel(rows) {
        /** @type {Map<string, ReturnType<typeof emptyStatusBucket>>} */
        const byOrigin = new Map();

        for (const row of rows || []) {
            const kind = classifyDecision(row.decision_status);
            if (kind !== 'repeater' && kind !== 'dismissed') continue;

            const origin = String(row.origin_stream || '').trim() || '—';
            if (!byOrigin.has(origin)) byOrigin.set(origin, emptyStatusBucket());
            const b = byOrigin.get(origin);

            const male = isRowMale(row.gender);
            const female = isRowFemale(row.gender);
            if (kind === 'repeater') {
                if (male) b.repM += 1;
                else if (female) b.repF += 1;
            } else {
                if (male) b.disM += 1;
                else if (female) b.disF += 1;
            }
        }

        return [...byOrigin.keys()]
            .sort((a, b) => a.localeCompare(b, 'ar'))
            .map((origin) => {
                const b = byOrigin.get(origin);
                return {
                    origin,
                    ...b,
                    total: b.repM + b.repF + b.disM + b.disF
                };
            });
    }

    function cellNum(n) {
        const v = Number(n) || 0;
        return v > 0 ? String(v) : '';
    }

    function renderOrientationBoard(rows) {
        if (!els.boardTbody) return;

        const model = buildBoardModel(rows);
        els.boardTbody.replaceChildren();

        if (!model.length) {
            if (els.boardTable) els.boardTable.hidden = true;
            if (els.boardEmpty) els.boardEmpty.hidden = false;
            if (els.boardSubtitle) {
                els.boardSubtitle.textContent = 'لا بيانات توجيه (الملبّون فقط في هذا الجدول)';
            }
            return;
        }

        if (els.boardTable) els.boardTable.hidden = false;
        if (els.boardEmpty) els.boardEmpty.hidden = true;

        const fragment = document.createDocumentFragment();
        let destCount = 0;
        let fulfilledTotal = 0;
        let guidedTotal = 0;
        for (const group of model) {
            const span = group.rows.length;
            destCount += span;
            group.rows.forEach((r, idx) => {
                fulfilledTotal += Number(r.fulfilled) || 0;
                guidedTotal += (Number(r.totalM) || 0) + (Number(r.totalF) || 0);
                const tr = document.createElement('tr');
                if (idx === 0) {
                    const thOrigin = document.createElement('th');
                    thOrigin.scope = 'rowgroup';
                    thOrigin.rowSpan = span;
                    thOrigin.className = 'ob-origin-cell';
                    thOrigin.textContent = group.origin;
                    tr.appendChild(thOrigin);
                }

                const tdDest = document.createElement('td');
                tdDest.className = 'ob-dest-cell';
                tdDest.textContent = r.dest;
                tr.appendChild(tdDest);

                const values = [r.totalM, r.totalF, ...r.bands, r.fulfilled];
                values.forEach((n, i) => {
                    const td = document.createElement('td');
                    td.className = i === values.length - 1 ? 'ob-num ob-req' : 'ob-num';
                    td.textContent = cellNum(n);
                    if (n > 0) td.classList.add('ob-has-value');
                    tr.appendChild(td);
                });

                fragment.appendChild(tr);
            });
        }
        els.boardTbody.appendChild(fragment);

        if (els.boardSubtitle) {
            els.boardSubtitle.textContent = `${model.length} شعبة · ${destCount} وجهة · ${guidedTotal} موجّه · ${fulfilledTotal} طلب ملبّى`;
        }
    }

    function renderStatusBoard(rows) {
        if (!els.statusBoardTbody) return;

        const model = buildStatusBoardModel(rows);
        els.statusBoardTbody.replaceChildren();

        if (!model.length) {
            if (els.statusBoardTable) els.statusBoardTable.hidden = true;
            if (els.statusBoardEmpty) els.statusBoardEmpty.hidden = false;
            if (els.statusBoardSubtitle) els.statusBoardSubtitle.textContent = 'لا مكررين ولا مفصولين';
            return;
        }

        if (els.statusBoardTable) els.statusBoardTable.hidden = false;
        if (els.statusBoardEmpty) els.statusBoardEmpty.hidden = true;

        const fragment = document.createDocumentFragment();
        let repTotal = 0;
        let disTotal = 0;
        for (const r of model) {
            repTotal += r.repM + r.repF;
            disTotal += r.disM + r.disF;
            const tr = document.createElement('tr');

            const thOrigin = document.createElement('th');
            thOrigin.scope = 'row';
            thOrigin.className = 'ob-origin-cell';
            thOrigin.textContent = r.origin;
            tr.appendChild(thOrigin);

            [r.repM, r.repF, r.disM, r.disF, r.total].forEach((n, i) => {
                const td = document.createElement('td');
                td.className = i === 4 ? 'ob-num ob-req' : 'ob-num';
                td.textContent = cellNum(n);
                if (n > 0) td.classList.add('ob-has-value');
                tr.appendChild(td);
            });

            fragment.appendChild(tr);
        }
        els.statusBoardTbody.appendChild(fragment);

        if (els.statusBoardSubtitle) {
            els.statusBoardSubtitle.textContent = `يكرر: ${repTotal} · يفصل: ${disTotal} · المجموع: ${repTotal + disTotal}`;
        }
    }

    /**
     * Count male/female from orientation rows.
     * Gender is resolved server-side via students.code + school_year join
     * (Massar results JSON has no gender field).
     */
    function countGenderFromRows(rows) {
        let male = 0;
        let female = 0;
        let unknown = 0;
        for (const row of rows || []) {
            if (typeof isMale === 'function' && isMale(row.gender)) {
                male += 1;
            } else if (typeof isFemale === 'function' && isFemale(row.gender)) {
                female += 1;
            } else {
                const g = String(row.gender || '')
                    .trim()
                    .toLowerCase();
                if (g === 'm' || g === 'male' || g === 'ذكر' || g === '1') male += 1;
                else if (g === 'f' || g === 'female' || g === 'أنثى' || g === '2') female += 1;
                else unknown += 1;
            }
        }
        return { male, female, unknown };
    }

    function renderKpis(summary, rowsForGender) {
        const total = Number(summary.total) || 0;
        const assigned = Number(summary.assigned_count) || 0;
        const pct = total > 0 ? Math.round((assigned / total) * 100) : 0;

        if (els.kpiTotal) els.kpiTotal.textContent = String(total);
        if (els.kpiTotalSub) els.kpiTotalSub.textContent = schoolYear() || 'السنة الحالية';
        if (els.kpiOrigins) els.kpiOrigins.textContent = String(summary.origin_count || 0);
        if (els.kpiChoices) els.kpiChoices.textContent = String(summary.choice1_distinct || 0);
        if (els.kpiAssigned) els.kpiAssigned.textContent = `${pct}%`;
        if (els.kpiAssignedSub) els.kpiAssignedSub.textContent = `${assigned} / ${total}`;
        if (els.kpiAssignedBar) els.kpiAssignedBar.style.width = `${pct}%`;

        // Prefer list rows (gender resolved via students.code JOIN). Fall back to stats.
        const sourceRows = Array.isArray(rowsForGender) ? rowsForGender : allRows;
        const fromRows = countGenderFromRows(sourceRows);
        const useRowCounts = sourceRows.length > 0;
        const male = useRowCounts ? fromRows.male : Number(summary.male_count) || 0;
        const female = useRowCounts ? fromRows.female : Number(summary.female_count) || 0;
        const unknown = useRowCounts ? fromRows.unknown : Math.max(0, total - male - female);
        const known = male + female;
        const base = total > 0 ? total : known + unknown;
        const malePct = base > 0 ? Math.round((male / base) * 100) : 0;
        const femalePct = base > 0 ? Math.round((female / base) * 100) : 0;

        if (els.kpiGenderSplit) els.kpiGenderSplit.textContent = `${male} / ${female}`;
        if (els.kpiGenderBarMale) els.kpiGenderBarMale.style.width = `${malePct}%`;
        if (els.kpiGenderBarFemale) els.kpiGenderBarFemale.style.width = `${femalePct}%`;
        if (els.kpiGenderSub) {
            els.kpiGenderSub.textContent =
                unknown > 0
                    ? `ذكور ${malePct}% · إناث ${femalePct}% · بدون جنس: ${unknown}`
                    : `ذكور ${malePct}% · إناث ${femalePct}%`;
        }
    }

    async function renderCharts(stats) {
        try {
            try {
                if (typeof ensureChartJsLoaded === 'function') {
                    await ensureChartJsLoaded();
                }
            } catch (err) {
                throw createDisplayError('CHART_RENDER_ERROR', {
                    message: 'تعذر تحميل مكتبة المخططات. الجداول ما زالت متاحة.',
                    details: { phase: 'chartjs_load' }
                });
            }
            if (typeof Chart === 'undefined') {
                throw createDisplayError('CHART_RENDER_ERROR', {
                    message: 'مكتبة المخططات غير متاحة. الجداول ما زالت متاحة.'
                });
            }

            const theme = typeof getChartThemeColors === 'function' ? getChartThemeColors() : {};
            const textColor = theme.text || theme.textColor || '#30323a';
            const gridColor = theme.grid || theme.gridColor || 'rgba(0,0,0,0.06)';

            destroyChart(chartOrigin);
            destroyChart(chartAssigned);

            const originData = stats.byOrigin || [];
            const assignedData = stats.byAssigned || [];

            const originCanvas = document.getElementById('chart-origin');
            const assignedCanvas = document.getElementById('chart-assigned');

            if (originCanvas) {
                chartOrigin = new Chart(originCanvas.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: originData.map((d) => d.key),
                        datasets: [
                            {
                                label: 'عدد التلاميذ',
                                data: originData.map((d) => d.count),
                                backgroundColor: originData.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
                                borderRadius: 6
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: {
                                ticks: { color: textColor, maxRotation: 45, minRotation: 0, font: { size: 11 } },
                                grid: { display: false }
                            },
                            y: {
                                beginAtZero: true,
                                ticks: { color: textColor, precision: 0 },
                                grid: { color: gridColor }
                            }
                        }
                    }
                });
                setChartSummary('chart-origin-summary', originData);
            }

            if (assignedCanvas) {
                chartAssigned = new Chart(assignedCanvas.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: assignedData.map((d) => d.key),
                        datasets: [
                            {
                                label: 'الإسناد',
                                data: assignedData.map((d) => d.count),
                                backgroundColor: '#8b5cf6',
                                borderRadius: 6
                            }
                        ]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: {
                                beginAtZero: true,
                                ticks: { color: textColor, precision: 0 },
                                grid: { color: gridColor }
                            },
                            y: {
                                ticks: { color: textColor, font: { size: 11 } },
                                grid: { display: false }
                            }
                        }
                    }
                });
                setChartSummary('chart-assigned-summary', assignedData);
            }
        } catch (err) {
            // Re-throw structured chart errors for caller; never block page content
            if (err?.code === 'CHART_RENDER_ERROR') throw err;
            throw createDisplayError('CHART_RENDER_ERROR', {
                details: { phase: 'chart_render' }
            });
        }
    }

    function setChartSummary(id, data) {
        const el = document.getElementById(id);
        if (!el) return;
        if (!data.length) {
            el.textContent = 'لا توجد بيانات.';
            return;
        }
        el.textContent = data.map((d) => `${d.key}: ${d.count}`).join('، ');
    }

    function destroyChart(instance) {
        if (instance && typeof instance.destroy === 'function') {
            instance.destroy();
        }
    }

    function renderMatrix(matrix) {
        if (!els.matrixThead || !els.matrixTbody) return;

        const origins = matrix?.origins || [];
        const choices = matrix?.choices || [];
        const cells = matrix?.cells || {};

        els.matrixThead.replaceChildren();
        els.matrixTbody.replaceChildren();

        if (!origins.length || !choices.length) {
            if (els.matrixTable) els.matrixTable.hidden = true;
            if (els.matrixEmpty) els.matrixEmpty.hidden = false;
            return;
        }

        if (els.matrixTable) els.matrixTable.hidden = false;
        if (els.matrixEmpty) els.matrixEmpty.hidden = true;

        const headRow = document.createElement('tr');
        const corner = document.createElement('th');
        corner.textContent = 'الشعبة الأصلية \\ الاختيار';
        headRow.appendChild(corner);
        for (const c of choices) {
            const th = document.createElement('th');
            th.textContent = c;
            headRow.appendChild(th);
        }
        const totalTh = document.createElement('th');
        totalTh.textContent = 'المجموع';
        headRow.appendChild(totalTh);
        els.matrixThead.appendChild(headRow);

        // Compute intensity max once (was O(cells²) when recalculated per populated cell)
        const cellMax = maxCell(cells);
        const bodyFragment = document.createDocumentFragment();

        for (const origin of origins) {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.textContent = origin;
            th.className = 'orientation-matrix-origin';
            tr.appendChild(th);

            let rowTotal = 0;
            for (const choice of choices) {
                const n = Number(cells[origin]?.[choice] || 0);
                rowTotal += n;
                const td = document.createElement('td');
                td.textContent = n ? String(n) : '—';
                if (n) {
                    td.className = 'orientation-matrix-heat';
                    const t = Math.min(1, n / cellMax);
                    const alpha = 0.08 + t * 0.35;
                    td.style.setProperty('--matrix-heat-alpha', alpha.toFixed(2));
                }
                tr.appendChild(td);
            }
            const totalTd = document.createElement('td');
            totalTd.textContent = String(rowTotal);
            totalTd.className = 'orientation-matrix-total';
            tr.appendChild(totalTd);
            bodyFragment.appendChild(tr);
        }
        els.matrixTbody.appendChild(bodyFragment);
    }

    function maxCell(cells) {
        let max = 1;
        for (const origin of Object.keys(cells || {})) {
            for (const choice of Object.keys(cells[origin] || {})) {
                max = Math.max(max, Number(cells[origin][choice]) || 0);
            }
        }
        return max;
    }

    function renderDetailTable() {
        if (!els.detailTbody) return;

        const total = filteredRows.length;
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        currentPage = Math.min(currentPage, totalPages);
        const slice = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

        els.detailTbody.replaceChildren();
        const fragment = document.createDocumentFragment();
        if (!slice.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 11;
            td.className = 'empty-state-cell';
            td.textContent = 'لا توجد نتائج مطابقة للفلاتر.';
            tr.appendChild(td);
            fragment.appendChild(tr);
        } else {
            const start = (currentPage - 1) * PAGE_SIZE;
            slice.forEach((row, i) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${start + i + 1}</td>
                    <td>${esc(row.student_code)}</td>
                    <td>${esc(row.full_name)}</td>
                    <td>${genderBadgeHtml(row.gender)}</td>
                    <td>${esc(row.section)}</td>
                    <td>${esc(row.origin_stream)}</td>
                    <td>${esc(row.choice_1)}</td>
                    <td>${esc(row.choice_2)}</td>
                    <td>${esc(row.choice_3)}</td>
                    <td>${esc(row.assigned_stream)}</td>
                    <td>${statusBadgeHtml(row.decision_status)}</td>
                `;
                fragment.appendChild(tr);
            });
        }
        els.detailTbody.appendChild(fragment);

        if (els.tableCount) {
            els.tableCount.textContent = total ? `${total} تلميذ/ة` : '';
        }

        if (typeof renderPaginationControls === 'function') {
            renderPaginationControls(els.pagination, {
                currentPage,
                totalPages,
                infoText: total > PAGE_SIZE ? `${currentPage} / ${totalPages}` : '',
                summaryText: total ? `${total} سجل` : '',
                onNavigate: (page) => {
                    currentPage = page;
                    renderDetailTable();
                }
            });
        }
    }

    function esc(value) {
        if (value == null || value === '') return '—';
        if (typeof escapeHtml === 'function') return escapeHtml(String(value));
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Decision status chip — scannable detail-row badges.
     * Palette: مسند/ينتقل green · غير مسند amber · يكرر gray · يفصل red.
     * Mirrors the sl-gender-badge visual pattern.
     */
    function statusBadgeHtml(status) {
        const s = String(status || '').trim();
        if (!s) return '<span class="sl-status-badge">—</span>';
        let cls = 'neutral';
        if (s === 'ينتقل' || s === 'مسند') cls = 'success';
        else if (s === 'غير مسند') cls = 'warning';
        else if (s === 'يكرر') cls = 'neutral';
        else if (s === 'يفصل') cls = 'danger';
        return `<span class="sl-status-badge ${cls}">${esc(s)}</span>`;
    }

    /**
     * Gender indicator linked from students roster (or orientation import field).
     * Uses shared helpers from js/shared/gender.js when available.
     */
    function genderBadgeHtml(gender) {
        const male = typeof isMale === 'function' ? isMale(gender) : false;
        const female = typeof isFemale === 'function' ? isFemale(gender) : false;
        if (male) {
            return '<span class="sl-gender-badge male"><i class="fas fa-mars" aria-hidden="true"></i> ذكر</span>';
        }
        if (female) {
            return '<span class="sl-gender-badge female"><i class="fas fa-venus" aria-hidden="true"></i> أنثى</span>';
        }
        return '<span class="sl-gender-badge">—</span>';
    }

    function updatePrintHeader() {
        if (els.printDate) {
            els.printDate.textContent = new Date().toLocaleDateString('ar-MA', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }
        if (els.printFilters) {
            const parts = [`السنة: ${schoolYear() || '—'}`];
            if (els.origin?.value) parts.push(`الشعبة: ${els.origin.value}`);
            if (els.choice1?.value) parts.push(`الاختيار: ${els.choice1.value}`);
            if (els.section?.value) parts.push(`القسم: ${els.section.value}`);
            if (els.level?.value) {
                const lv = els.level.value;
                if (lv.startsWith('__group:')) {
                    const id = lv.slice(8);
                    const g = LEVEL_GROUP_DEFS.find((x) => x.id === id);
                    parts.push(`الفئة: ${g?.label || (id === 'other' ? 'مستويات أخرى' : lv)}`);
                } else {
                    parts.push(`المستوى: ${lv}`);
                }
            }
            els.printFilters.textContent = parts.join(' · ');
        }
    }
})();
