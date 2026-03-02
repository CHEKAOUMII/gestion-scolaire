const { BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Opens a hidden BrowserWindow, loads the page content with the ACTUAL app CSS,
 * then either prints or exports to PDF — preserving the exact visual formatting.
 *
 * @param {object} opts
 * @param {string} opts.htmlContent       - The inner body HTML to print
 * @param {string} [opts.inlineStyles]    - Inline <style> blocks from the page
 * @param {string} [opts.title]           - Document title
 * @param {string} [opts.pageSize]        - 'A4' | 'A3' | 'Letter' etc.
 * @param {boolean} [opts.landscape]      - landscape orientation
 * @param {string} [opts.mode]            - 'pdf' (save dialog) | 'print' (system dialog) | 'preview' (show window)
 * @param {string} [opts.defaultFileName] - suggested file name for PDF save
 * @param {BrowserWindow} [opts.parentWindow] - parent window for save dialog
 * @returns {Promise<{success: boolean, filePath?: string, error?: string}>}
 */
async function printHTML(opts = {}) {
    const {
        htmlContent = '',
        inlineStyles = '',
        title = 'طباعة',
        pageSize = 'A4',
        landscape = false,
        mode = 'pdf',
        defaultFileName,
        parentWindow,
        skipAutoLetterhead = false
    } = opts;

    // Read actual app CSS files from disk
    const appRoot = path.join(__dirname, '..');
    const cssFiles = [
        path.join(appRoot, 'css', 'design-system.css'),
        path.join(appRoot, 'styles.css'),
        path.join(appRoot, 'ux-enhancements.css')
    ];

    let appCSS = '';
    for (const cssPath of cssFiles) {
        try {
            appCSS += fs.readFileSync(cssPath, 'utf-8') + '\n';
        } catch (_) {
            /* file may not exist */
        }
    }

    // Auto-inject letterhead unless opt-out
    let finalBodyHTML = htmlContent;
    if (!skipAutoLetterhead) {
        try {
            const { renderLetterhead } = require('./reports/letterhead');
            const { getDb } = require('./db/context');
            const db = getDb();
            const yearRow = db.prepare("SELECT value FROM settings WHERE key = 'currentSchoolYear'").get();
            const schoolYear = yearRow?.value || '';
            const letterheadHTML = renderLetterhead({ schoolYear });
            finalBodyHTML = letterheadHTML + finalBodyHTML;
        } catch (err) {
            console.error('[print-window] letterhead injection failed:', err);
        }
    }

    // Build the full HTML document with real app CSS
    const fullHTML = buildPrintDocument(finalBodyHTML, title, appCSS, inlineStyles);

    // Write HTML to a temp file to avoid data-URL size limits (base64 chart images
    // can push the payload well past Chromium's practical data-URL cap).
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `print_${Date.now()}.html`);
    fs.writeFileSync(tmpFile, fullHTML, 'utf-8');

    const printWin = new BrowserWindow({
        width: 1000,
        height: 800,
        show: mode === 'preview',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    try {
        // Load from temp file — no size limit
        await printWin.loadFile(tmpFile);

        // Wait for web fonts to be ready
        try {
            await printWin.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true);
        } catch (_) {
            /* ignore if fonts API not available */
        }

        // Settle time for fonts, images, and layout
        await new Promise((r) => setTimeout(r, 1000));

        if (mode === 'preview') {
            printWin.setTitle(title);
            printWin.on('closed', () => _cleanupTmp(tmpFile));
            return { success: true };
        }

        if (mode === 'print') {
            // System print dialog
            const result = await new Promise((resolve) => {
                printWin.webContents.print(
                    {
                        silent: false,
                        printBackground: true,
                        landscape,
                        pageSize,
                        margins: { marginType: 'default' }
                    },
                    (success, failureReason) => {
                        resolve(
                            success ? { success: true } : { success: false, error: failureReason || 'Print failed' }
                        );
                    }
                );
            });
            printWin.close();
            _cleanupTmp(tmpFile);
            return result;
        }

        // Default: PDF export with save dialog
        const pdfBuffer = await printWin.webContents.printToPDF({
            printBackground: true,
            landscape,
            pageSize,
            margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
        });

        const dialogParent = parentWindow || BrowserWindow.getFocusedWindow();
        const fileName = defaultFileName
            ? defaultFileName.endsWith('.pdf')
                ? defaultFileName
                : defaultFileName + '.pdf'
            : `${title.replace(/[\\/:*?"<>|]/g, '_')}_${Date.now()}.pdf`;
        const dialogOpts = {
            defaultPath: fileName,
            filters: [{ name: 'PDF', extensions: ['pdf'] }]
        };

        const { filePath } = dialogParent
            ? await dialog.showSaveDialog(dialogParent, dialogOpts)
            : await dialog.showSaveDialog(dialogOpts);

        printWin.close();
        _cleanupTmp(tmpFile);

        if (filePath) {
            fs.writeFileSync(filePath, pdfBuffer);
            shell.openPath(filePath);
            return { success: true, filePath };
        }
        return { success: false, error: 'Cancelled by user' };
    } catch (err) {
        if (!printWin.isDestroyed()) printWin.close();
        _cleanupTmp(tmpFile);
        return { success: false, error: err.message };
    }
}

function _cleanupTmp(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}
}

/**
 * Builds a full HTML document using the ACTUAL app CSS files,
 * with print-specific overrides to hide sidebar/header/controls.
 */
function buildPrintDocument(bodyHTML, title, appCSS, inlineStyles) {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${escapeHTML(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<style>
/* ===== App CSS (from disk) ===== */
${appCSS}
</style>
<style>
/* ===== Page inline styles ===== */
${inlineStyles}
</style>
<style>
/* ===== Print overrides — hide UI chrome, full-width content ===== */
body {
    display: block !important;
    background: #fff !important;
    background-image: none !important;
    min-height: auto !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
}
.sidebar,
.header,
.menu-toggle,
.theme-toggle,
.toast-container,
.toast,
.quick-nav-panel,
.shortcuts-modal,
.modal-overlay,
#quick-nav-toggle,
#shortcuts-btn,
#print-btn,
#print-preview-btn,
.btn-print,
.btn-export,
.search-section,
.filter-section,
.filter-actions,
.import-section,
.stats-row,
.edit-controls,
.changes-summary-bar,
.empty-state,
.no-data-state,
.timetable-print-actions,
.table-actions,
.table-filters,
.pagination,
.notification-btn,
.home-btn {
    display: none !important;
}
.main-content {
    margin: 0 !important;
    padding: 15px !important;
    width: 100% !important;
    flex: none !important;
}
.print-header {
    display: block !important;
    text-align: center;
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--color-primary, #3B6AC5);
}
.print-header .school-name,
.print-header h1 {
    font-size: 20px;
    font-weight: 700;
    color: var(--color-primary, #3B6AC5);
}
.print-header .doc-title { font-size: 15px; color: #333; margin-top: 4px; }
.print-header .doc-date  { font-size: 11px; color: #777; margin-top: 2px; }
.print-header p { margin: 4px 0; font-size: 13px; color: #666; }

/* Grade sheet — flatten the A4 "page-within-page" when printed via printHTML */
.gs-sheet-wrapper { display: block !important; }
.gs-sheet {
    width: 100% !important;
    min-height: auto !important;
    padding: 0 !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    border: none !important;
}
.gs-sheet-title { display: none !important; }
.gs-letterhead { display: none !important; }

/* Table print adjustments */
table { page-break-inside: auto; border-collapse: collapse !important; width: 100% !important; }
tr { page-break-inside: avoid; page-break-after: auto; }
.students-table th {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
}

/* Cards: remove hover transforms for print */
.stat-card, .chart-card, .soft-card, .frosted-card {
    transform: none !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
}

/* Timetable compact print */
.timetable-wrapper { border: none !important; box-shadow: none !important; }
.timetable-container { padding: 0 !important; }
.table-responsive { padding: 0 !important; overflow: visible !important; }
.timetable, .room-timetable, .room-timetable-wrapper table, .class-timetable-wrapper table {
    width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important;
}
.timetable th, .room-timetable th, .room-timetable-wrapper th, .class-timetable-wrapper th {
    background: linear-gradient(135deg, #3B6AC5, #5B84D6) !important;
    color: #fff !important; padding: 4px 3px !important; font-size: 8px !important; font-weight: 600 !important;
    -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
}
.timetable td, .room-timetable td, .room-timetable-wrapper td, .class-timetable-wrapper td {
    padding: 2px 3px !important; font-size: 7.5px !important; border: 1px solid #e2e8f0 !important;
    vertical-align: middle !important; line-height: 1.3 !important; min-width: 0 !important;
}
.room-timetable, .class-timetable {
    width: 100% !important; table-layout: fixed !important; border-collapse: collapse !important;
    page-break-inside: avoid;
}
.timetable .period-cell { background: #f0f4f8 !important; font-weight: 700 !important; font-size: 7px !important; }
.lesson-cell { padding: 2px !important; }
.lesson-cell .lesson-teacher, .lesson-cell .lesson-subject, .lesson-cell .lesson-class { font-size: 7px !important; line-height: 1.2 !important; }
.activity-cell { padding: 1px 2px !important; }
.activity-cell .subject { font-size: 7px !important; line-height: 1.2 !important; }
.activity-cell .class-name { font-size: 6.5px !important; line-height: 1.2 !important; }
.activity-cell .room { font-size: 6px !important; line-height: 1.2 !important; }
.timetable-header-info { margin-bottom: 6px !important; }
.timetable-header-info h3 { font-size: 11px !important; }
.room-stats-grid, .class-stats-grid { opacity: 1 !important; transform: none !important; }
.room-stat-card .stat-value, .class-stat-card .stat-value { font-size: 14px !important; }
.room-stat-card .stat-label, .class-stat-card .stat-label { font-size: 8px !important; }
.period-separator td { height: 2px !important; padding: 0 !important; }

/* ===== Semester Report — compact layout for A4 print ===== */
.report-print-document {
    font-family: "Noto Kufi Arabic", "IBM Plex Sans Arabic", sans-serif;
    font-size: 11px;
    color: #111;
    background: #fff;
    padding: 0 !important;
    margin: 0 !important;
    width: 100% !important;
}
.report-print-document .header,
.report-print-document .search-section,
.report-print-document .no-print { display: none !important; }

/* KPI cards grid — compact 4 columns */
.report-kpis {
    display: grid !important;
    grid-template-columns: repeat(4, 1fr) !important;
    gap: 6px !important;
    margin-bottom: 10px !important;
}
.report-kpi-card {
    position: relative;
    background: #fff !important;
    border: 1px solid #dde5ea !important;
    border-radius: 6px !important;
    padding: 8px 8px 6px !important;
    box-shadow: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    break-inside: avoid;
    page-break-inside: avoid;
    animation: none !important;
}
.report-kpi-card::before {
    content: '';
    position: absolute;
    top: 0; right: 0;
    width: 100%; height: 3px;
    border-radius: 6px 6px 0 0;
}
.report-kpi-card:nth-child(1)::before { background: linear-gradient(135deg, #3B6AC5, #5B84D6); }
.report-kpi-card:nth-child(2)::before { background: linear-gradient(90deg, #2ECC71, #38ef7d); }
.report-kpi-card:nth-child(3)::before { background: linear-gradient(90deg, #F0AD4E, #ffd200); }
.report-kpi-card:nth-child(4)::before { background: linear-gradient(90deg, #a770ef, #cf8bf3); }
.report-kpi-card:nth-child(5)::before { background: linear-gradient(90deg, #E85D5D, #ff9a76); }
.report-kpi-card:nth-child(6)::before { background: linear-gradient(90deg, #11998e, #38ef7d); }
.report-kpi-card:nth-child(7)::before { background: linear-gradient(90deg, #667eea, #764ba2); }
.report-kpi-card:nth-child(8)::before { background: linear-gradient(90deg, #f093fb, #f5576c); }
.report-kpi-icon {
    width: 26px; height: 26px;
    border-radius: 5px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; margin-bottom: 4px; color: #fff;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
}
.report-kpi-label { font-size: 9px; color: #6B7B72; font-weight: 600; margin-bottom: 2px; }
.report-kpi-value { font-size: 16px; font-weight: 800; color: #111111; line-height: 1.1; margin-bottom: 1px; }
.report-kpi-sub { font-size: 8px; color: #9CA8A0; }

/* Grid layouts — compact */
.report-grid-two {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr) !important;
    gap: 8px !important;
    margin-bottom: 8px !important;
}
.report-grid-three {
    display: grid !important;
    grid-template-columns: repeat(3, 1fr) !important;
    gap: 8px !important;
    margin-bottom: 8px !important;
}

/* Panels — compact */
.report-panel {
    background: #fff !important;
    border: 1px solid #dde5ea !important;
    border-radius: 8px !important;
    padding: 10px !important;
    box-shadow: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    break-inside: avoid;
    page-break-inside: avoid;
}
.report-panel h4 {
    margin: 0 0 8px !important;
    color: #3B6AC5 !important;
    font-size: 11px !important;
    font-weight: 700 !important;
    display: flex !important;
    align-items: center !important;
    gap: 5px !important;
    padding-bottom: 6px !important;
    border-bottom: 1.5px solid #E8E8E8 !important;
}
.report-panel h4 i { font-size: 12px; color: #5B84D6; }

/* Canvas / chart images — constrained height */
.report-canvas,
.report-canvas-preview-image {
    width: 100% !important;
    max-width: 100% !important;
    max-height: 160px !important;
    height: auto !important;
    display: block;
    border-radius: 6px;
    object-fit: contain;
}

/* Collapsible blocks — compact for print */
details.report-block {
    display: block !important;
    border: 1px solid #d6dde3 !important;
    border-radius: 8px !important;
    box-shadow: none !important;
    margin-bottom: 8px !important;
    break-inside: avoid;
    page-break-inside: avoid;
    overflow: hidden;
}
details.report-block > summary {
    display: block !important;
    background: #edf2f6 !important;
    color: #162730 !important;
    padding: 8px 12px !important;
    font-size: 12px !important;
    font-weight: 800 !important;
    border-bottom: 1px solid #d6dde3 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
}
details.report-block > summary::after { display: none !important; }
details.report-block > .report-block-body {
    display: block !important;
    padding: 8px !important;
}

/* Progress bars — compact */
.report-progress-grid {
    display: grid !important;
    grid-template-columns: 1fr !important;
    gap: 5px !important;
}
.report-progress-item {
    background: #f8faf9 !important;
    border: 1px solid #E8E8E8 !important;
    border-radius: 6px !important;
    padding: 7px 10px !important;
    break-inside: avoid;
    page-break-inside: avoid;
}
.report-progress-title {
    font-size: 10px; color: #111111; font-weight: 700;
    margin-bottom: 4px; display: flex; align-items: center; gap: 4px;
}
.report-progress-title i { font-size: 11px; }
.report-progress-track {
    height: 14px;
    background: #F6F5F2 !important;
    border-radius: 9999px;
    overflow: hidden;
    margin-bottom: 3px;
}
.report-progress-value {
    height: 100%;
    border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    font-size: 8px; font-weight: 700; color: #fff;
    min-width: 20px;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
}
.report-progress-value::after { display: none !important; }
.report-progress-meta { font-size: 9px; color: #6B7B72; display: flex; justify-content: space-between; }

/* Summary table — compact */
.report-summary-table {
    width: 100% !important;
    border-collapse: collapse !important;
    border: 1px solid #d6dde3 !important;
    border-radius: 6px !important;
    overflow: hidden;
}
.report-summary-table th,
.report-summary-table td {
    padding: 5px 8px !important;
    text-align: right !important;
    font-size: 10px !important;
}
.report-summary-table th {
    background: linear-gradient(135deg, #3B6AC5, #5B84D6) !important;
    color: #fff !important;
    font-weight: 700 !important;
    font-size: 10px !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
}
.report-summary-table td {
    color: #111111 !important;
    border-bottom: 1px solid #E8E8E8 !important;
}
.report-summary-table tbody tr:nth-child(even) {
    background: #f8faf9 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
}
.report-summary-table thead { display: table-header-group; }
.report-summary-table tr { break-inside: avoid; page-break-inside: avoid; }

/* Grade pills — compact */
.report-grade-pill {
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 9999px; padding: 2px 8px;
    font-size: 9px; font-weight: 700; color: #fff;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
}

/* Security bar — compact */
.report-print-security-bar {
    display: grid !important;
    grid-template-columns: 1fr auto !important;
    gap: 8px; align-items: center;
    border: 1px solid #cfd8df; border-radius: 6px;
    padding: 6px 10px; margin-bottom: 8px;
    background: linear-gradient(180deg, #f8fbfd, #eef4f8) !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    break-inside: avoid; page-break-inside: avoid;
}
.report-print-security-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 9px; color: #1f2f3a; }
.report-print-security-meta b { color: #10212a; margin-left: 3px; }
.report-print-verify { display: flex; align-items: center; gap: 8px; border-right: 1px dashed #b8c5cf; padding-right: 10px; }
.report-print-qr { width: 52px; height: 52px; border: 1px solid #aebdca; border-radius: 4px; object-fit: contain; background: #fff; }
.report-print-code { display: flex; flex-direction: column; gap: 2px; font-size: 8px; color: #20333f; }
.report-print-code .mono { font-family: Consolas, "Courier New", monospace; letter-spacing: 0.04em; direction: ltr; }

/* Watermark */
.report-print-watermark {
    position: fixed; inset: 0;
    display: grid; place-items: center;
    pointer-events: none; z-index: 0;
}
.report-print-watermark span {
    font-size: 50px; letter-spacing: 0.14em; font-weight: 800;
    color: rgba(25, 55, 72, 0.04); transform: rotate(-28deg);
}

@media print {
    @page { margin: 1cm; }
    body { padding: 0 !important; }
}
</style>
</head>
<body>
${bodyHTML}
</body>
</html>`;
}

function escapeHTML(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { printHTML };
