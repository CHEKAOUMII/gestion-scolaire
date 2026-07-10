/**
 * grades-sheets.js — أوراق التنقيط
 * Handles generating, previewing, printing, and exporting grade sheets.
 */

(function () {
    'use strict';

    // ─── State ───
    let currentStudents = [];
    let isGenerated = false;

    // ─── DOM Refs ───
    const $ = (id) => document.getElementById(id);
    const classSelect = () => $('class-select');
    const subjectSelect = () => $('subject-select');
    const semesterSelect = () => $('semester-select');
    const previewBody = () => $('gs-preview-body');
    const countBadge = () => $('gs-count-badge');
    const feedback = () => $('gs-feedback');

    // ─── Buttons ───
    const generateBtn = () => $('generate-btn');
    const printPreviewBtn = () => $('print-btn');

    function getYear() {
        return typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026';
    }

    // ─── Helpers ───
    // Delegates to the canonical escapeHtml in js/utils.js (loaded earlier).
    function escapeHtml(str) {
        if (window.escapeHtml) return window.escapeHtml(str);
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ─── Level Normalization ───
    // Uses shared getLevelFromSection() from utils.js (returns {code, name, order})

    function setFeedback(msg) {
        const el = feedback();
        if (el) el.textContent = msg;
    }

    function updateButtons(enabled) {
        [printPreviewBtn()].forEach((btn) => {
            if (btn) btn.disabled = !enabled;
        });
    }

    function showLoading() {
        const body = previewBody();
        if (!body) return;
        body.innerHTML = `
            <div class="gs-loading-state">
                <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
                <span>جاري توليد ورقة التنقيط...</span>
            </div>
        `;
    }

    function showEmpty() {
        const body = previewBody();
        if (!body) return;
        body.innerHTML = `
            <div class="gs-empty-state" id="gs-empty-state">
                <div class="gs-empty-icon">
                    <i class="fas fa-file-alt"></i>
                </div>
                <h4>لا توجد ورقة تنقيط</h4>
                <p>اختر القسم والمادة ثم اضغط "توليد" لإنشاء ورقة التنقيط</p>
            </div>
        `;
    }

    function showEmptyResults() {
        const body = previewBody();
        if (!body) return;
        body.innerHTML = `
            <div class="gs-empty-state">
                <div class="gs-empty-icon">
                    <i class="fas fa-users-slash"></i>
                </div>
                <h4>لا يوجد تلاميذ في هذا القسم</h4>
                <p>لم يتم العثور على تلاميذ مسجلين في القسم المحدد</p>
            </div>
        `;
    }

    // ─── Load Filters (via shared FilterManager) ───
    let filterManager = null;

    async function loadFilters() {
        try {
            filterManager = new FilterManager({
                selectors: { level: 'level-select', class: 'class-select', subject: 'subject-select' },
                placeholders: { level: 'اختر المستوى', class: 'اختر القسم', subject: 'اختر المادة' }
            });
            await filterManager.init();
        } catch (err) {
            console.warn('Failed to load filters:', err);
            if (typeof showToast === 'function') showToast('تعذر تحميل البيانات', 'error');
        }
    }

    // ─── Build inline letterhead HTML from identity ───
    // Uses shared buildLetterheadHTML() from ux-enhancements.js
    function getLetterhead(id, year) {
        return typeof window.buildLetterheadHTML === 'function' ? window.buildLetterheadHTML(id, year) : '';
    }

    // ─── Generate ───
    async function generate() {
        const className = classSelect()?.value;
        const subject = subjectSelect()?.value;
        const semester = semesterSelect()?.value;
        const year = getYear();

        if (!className || !subject) {
            if (typeof showToast === 'function') showToast('اختر القسم والمادة', 'warning');
            return;
        }

        showLoading();
        updateButtons(false);

        try {
            // Fetch students + identity in parallel
            const [students, identity] = await Promise.all([
                window.api.students.search('', className, '', year).then((r) => r || []),
                window.api.reports.getIdentity().catch(() => ({}))
            ]);
            currentStudents = students;

            if (students.length === 0) {
                showEmptyResults();
                updateButtons(false);
                isGenerated = false;
                return;
            }

            const semesterLabel = semester === '1' ? 'الدورة الأولى' : 'الدورة الثانية';
            const now = new Date();
            const dateStr = new Intl.DateTimeFormat('ar-MA', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(now);

            const letterheadHTML = getLetterhead(identity, year);

            const tableRows = students
                .map(
                    (s, i) => `
                <tr>
                    <td style="text-align:center; font-weight:600; color:#666;">${i + 1}</td>
                    <td>${escapeHtml(s.massar_code || '-')}</td>
                    <td style="font-weight:600;">${escapeHtml(s.full_name || '-')}</td>
                    <td class="gs-grade-cell"></td>
                    <td class="gs-grade-cell"></td>
                    <td class="gs-grade-cell"></td>
                    <td class="gs-grade-cell"></td>
                    <td class="gs-grade-cell" style="min-width:80px;"></td>
                </tr>
            `
                )
                .join('');

            const body = previewBody();
            body.innerHTML = `
                <div class="gs-sheet-wrapper">
                    <div class="gs-sheet" id="gs-sheet-content">
                        ${letterheadHTML}
                        <div class="gs-sheet-title">ورقة التنقيط</div>
                        <div class="gs-sheet-subtitle">${escapeHtml(getLevelFromSection(className).name)} — ${escapeHtml(className)} — ${escapeHtml(subject)}</div>
                        <div class="gs-sheet-meta">
                            <span><i class="fas fa-calendar-alt"></i> الدورة: ${semesterLabel}</span>
                            <span><i class="fas fa-graduation-cap"></i> السنة الدراسية: ${year}</span>
                            <span><i class="fas fa-users"></i> العدد: ${students.length}</span>
                            <span><i class="fas fa-clock"></i> التاريخ: ${dateStr}</span>
                        </div>
                        <table>
                            <thead>
                                <tr>
                                    <th style="text-align:center; width:40px;">#</th>
                                    <th>رمز مسار</th>
                                    <th>الاسم الكامل</th>
                                    <th style="width:60px; text-align:center;">الفرض 1</th>
                                    <th style="width:60px; text-align:center;">الفرض 2</th>
                                    <th style="width:60px; text-align:center;">الفرض 3</th>
                                    <th style="width:60px; text-align:center;">الفرض 4</th>
                                    <th style="width:80px; text-align:center;">ملاحظات</th>
                                </tr>
                            </thead>
                            <tbody>${tableRows}</tbody>
                        </table>
                        <div class="gs-signature-area">
                            <div class="gs-signature-box">
                                <p>توقيع الأستاذ(ة)</p>
                                <div class="gs-sig-line"></div>
                            </div>
                            <div class="gs-signature-box">
                                <p>توقيع الإدارة</p>
                                <div class="gs-sig-line"></div>
                            </div>
                        </div>
                        <div class="gs-footer">
                            <span>تاريخ الطباعة: ${dateStr}</span>
                            <span>برنامج التدبير المدرسي — ${year}</span>
                        </div>
                    </div>
                </div>
            `;

            // Update badge
            const badge = countBadge();
            if (badge) {
                badge.textContent = students.length;
                badge.style.display = '';
            }

            updateButtons(true);
            isGenerated = true;
            setFeedback(`تم توليد ورقة تنقيط بها ${students.length} تلميذ`);
            if (typeof showToast === 'function')
                showToast(`تم توليد ورقة التنقيط — ${students.length} تلميذ(ة)`, 'success');
        } catch (err) {
            console.warn('Generate error:', err);
            const body = previewBody();
            body.innerHTML = `
                <div class="gs-empty-state">
                    <div class="gs-empty-icon" style="background: rgba(232,93,93,0.1);">
                        <i class="fas fa-exclamation-triangle" style="color: var(--color-danger);"></i>
                    </div>
                    <h4>حدث خطأ</h4>
                    <p>${escapeHtml(err.message || 'تعذر توليد ورقة التنقيط')}</p>
                </div>
            `;
            updateButtons(false);
            isGenerated = false;
            if (typeof showToast === 'function') showToast('تعذر توليد ورقة التنقيط', 'error');
        }
    }

    // ─── Collect page-specific styles for the print window ───
    function getPageStyles() {
        const styles = [];
        document.querySelectorAll('style').forEach((s) => {
            styles.push(s.textContent);
        });
        return styles.join('\n');
    }

    // ─── Print Preview (via shared UX preview — includes Print + PDF buttons) ───
    function openPreview() {
        if (!isGenerated || !currentStudents.length) {
            if (typeof showToast === 'function') showToast('قم بتوليد ورقة التنقيط أولاً', 'warning');
            return;
        }
        const sheetEl = document.getElementById('gs-sheet-content');
        if (!sheetEl) return;

        // Use the shared print preview system which has Print + PDF export
        PrintSystem.preview({
            contentSelector: '#gs-sheet-content',
            title: 'ورقة التنقيط',
            pageSize: 'A4',
            noHeader: true
        });
    }

    // ─── Export PDF (via printHTML — auto-injects letterhead) ───
    async function exportPdf() {
        if (!isGenerated || !currentStudents.length) {
            if (typeof showToast === 'function') showToast('قم بتوليد ورقة التنقيط أولاً', 'warning');
            return;
        }
        const sheetEl = document.getElementById('gs-sheet-content');
        if (!sheetEl) return;

        try {
            const result = await window.api.system.printHTML({
                htmlContent: sheetEl.outerHTML,
                inlineStyles: getPageStyles(),
                title: 'ورقة التنقيط',
                pageSize: 'A4',
                mode: 'pdf',
                defaultFileName: 'ورقة_التنقيط'
            });
            if (result?.success) {
                if (typeof showToast === 'function') showToast('تم تصدير ورقة التنقيط بنجاح', 'success');
            } else if (result?.error !== 'Cancelled by user') {
                if (typeof showToast === 'function') showToast('تعذر التصدير: ' + (result?.error || ''), 'error');
            }
        } catch (err) {
            console.warn('PDF export error:', err);
            if (typeof showToast === 'function') showToast('تعذر تصدير الملف', 'error');
        }
    }

    // ─── Init ───
    document.addEventListener('DOMContentLoaded', async () => {
        await loadFilters();

        // Generate
        generateBtn()?.addEventListener('click', generate);

        // Level filter — cascading is handled by FilterManager, reset UI state here
        $('level-select')?.addEventListener('change', () => {
            showEmpty();
            updateButtons(false);
            isGenerated = false;
            currentStudents = [];
            const badge = countBadge();
            if (badge) badge.style.display = 'none';
        });

        // Print Preview (shared UX system)
        printPreviewBtn()?.addEventListener('click', openPreview);
    });
})();
