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
    const yearSelect = () => $('school-year');
    const previewBody = () => $('gs-preview-body');
    const countBadge = () => $('gs-count-badge');
    const feedback = () => $('gs-feedback');

    // ─── Buttons ───
    const generateBtn = () => $('generate-btn');
    const printPreviewBtn = () => $('print-btn');


    function getYear() {
        return yearSelect()?.value || '2025/2026';
    }

    // ─── Helpers ───
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function setFeedback(msg) {
        const el = feedback();
        if (el) el.textContent = msg;
    }

    function updateButtons(enabled) {
        [printPreviewBtn()].forEach(btn => {
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

    // ─── Load Filters ───
    async function loadFilters() {
        try {
            const year = getYear();
            const classes = await window.api.classes.getAll(year) || [];
            const cs = classSelect();
            // Keep the first placeholder
            while (cs.options.length > 1) cs.remove(1);
            classes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = c.name;
                cs.appendChild(opt);
            });

            const subjects = await window.api.subjects.getAll() || [];
            const ss = subjectSelect();
            while (ss.options.length > 1) ss.remove(1);

            const normalizeSubjectName = (subject) => String(subject || '')
                .replace(/\s*\(\s*فرض\s*[0-9\u0660-\u0669]+\s*\)\s*$/i, '')
                .replace(/\s*\(الأنشطة المندمجة\)\s*$/, '')
                .trim();

            const uniqueSubjects = Array.from(new Set(
                subjects
                    .map((s) => normalizeSubjectName(s.name))
                    .filter(Boolean)
            )).sort((a, b) => a.localeCompare(b, 'ar'));

            uniqueSubjects.forEach((subjectName) => {
                const opt = document.createElement('option');
                opt.value = subjectName;
                opt.textContent = subjectName;
                ss.appendChild(opt);
            });
        } catch (err) {
            console.warn('Failed to load filters:', err);
            if (typeof showToast === 'function') showToast('تعذر تحميل البيانات', 'error');
        }
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
            const students = await window.api.students.search('', className, '', year) || [];
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
                year: 'numeric', month: '2-digit', day: '2-digit'
            }).format(now);

            const tableRows = students.map((s, i) => `
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
            `).join('');

            const body = previewBody();
            body.innerHTML = `
                <div class="gs-sheet-wrapper">
                    <div class="gs-sheet" id="gs-sheet-content">
                        <div class="gs-sheet-title">ورقة التنقيط</div>
                        <div class="gs-sheet-subtitle">${escapeHtml(className)} — ${escapeHtml(subject)}</div>
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
            if (typeof showToast === 'function') showToast(`تم توليد ورقة التنقيط — ${students.length} تلميذ(ة)`, 'success');
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

    // ─── Print Preview (shared UX system) ───
    function openPreview() {
        if (!isGenerated || !currentStudents.length) {
            if (typeof showToast === 'function') showToast('قم بتوليد ورقة التنقيط أولاً', 'warning');
            return;
        }
        openPrintPreview({
            title: 'ورقة التنقيط',
            pageSize: 'A4',
            contentSelector: '#gs-sheet-content'
        });
    }

    // ─── Export PDF ───
    async function exportPdf() {
        if (!isGenerated || !currentStudents.length) {
            if (typeof showToast === 'function') showToast('قم بتوليد ورقة التنقيط أولاً', 'warning');
            return;
        }

        // Use the shared UX print system
        const sheetEl = document.getElementById('gs-sheet-content');
        if (!sheetEl) return;

        // Capture the sheet HTML
        const capturedHTML = sheetEl.outerHTML;

        // Enable print mode (shared from ux-enhancements)
        let root = document.getElementById('ux-print-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'ux-print-root';
            document.body.appendChild(root);
        }
        root.innerHTML = capturedHTML;
        if (typeof _forceLightThemeForPrint === 'function') _forceLightThemeForPrint();
        document.body.classList.add('ux-printing-active');

        await new Promise(r => setTimeout(r, 300));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        try {
            if (window.api?.system?.printToPDF) {
                const result = await window.api.system.printToPDF({
                    printBackground: true,
                    pageSize: 'A4',
                    landscape: false,
                    margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
                });
                if (result?.success) {
                    if (typeof showToast === 'function') showToast('تم تصدير ورقة التنقيط بنجاح', 'success');
                } else if (result?.error !== 'Cancelled by user') {
                    if (typeof showToast === 'function') showToast('تعذر التصدير: ' + (result?.error || ''), 'error');
                }
            } else {
                if (typeof showToast === 'function') showToast('تصدير PDF غير متاح', 'warning');
            }
        } catch (err) {
            console.warn('PDF export error:', err);
            if (typeof showToast === 'function') showToast('تعذر تصدير الملف', 'error');
        } finally {
            document.body.classList.remove('ux-printing-active');
            if (root) root.innerHTML = '';
            if (typeof _restoreThemeAfterPrint === 'function') _restoreThemeAfterPrint();
        }
    }

    // ─── Direct Print ───
    async function directPrint() {
        if (!isGenerated || !currentStudents.length) {
            if (typeof showToast === 'function') showToast('قم بتوليد ورقة التنقيط أولاً', 'warning');
            return;
        }

        const sheetEl = document.getElementById('gs-sheet-content');
        if (!sheetEl) return;

        const capturedHTML = sheetEl.outerHTML;

        let root = document.getElementById('ux-print-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'ux-print-root';
            document.body.appendChild(root);
        }
        root.innerHTML = capturedHTML;
        if (typeof _forceLightThemeForPrint === 'function') _forceLightThemeForPrint();
        document.body.classList.add('ux-printing-active');

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        try {
            if (window.api?.system?.printCurrentWindow) {
                const result = await window.api.system.printCurrentWindow({
                    printBackground: true,
                    pageSize: 'A4',
                    landscape: false,
                    margins: { marginType: 'default' }
                });
                if (result?.success) {
                    if (typeof showToast === 'function') showToast('تم إرسال ورقة التنقيط للطباعة', 'success');
                }
            } else {
                window.print();
            }
        } catch (err) {
            console.warn('Print error:', err);
        } finally {
            document.body.classList.remove('ux-printing-active');
            if (root) root.innerHTML = '';
            if (typeof _restoreThemeAfterPrint === 'function') _restoreThemeAfterPrint();
        }
    }

    // ─── Init ───
    document.addEventListener('DOMContentLoaded', async () => {
        await loadFilters();

        // Generate
        generateBtn()?.addEventListener('click', generate);

        // Print Preview (shared UX system)
        printPreviewBtn()?.addEventListener('click', openPreview);

        // School year change: reload filters and reset
        yearSelect()?.addEventListener('change', async () => {
            await loadFilters();
            showEmpty();
            updateButtons(false);
            isGenerated = false;
            currentStudents = [];
            const badge = countBadge();
            if (badge) badge.style.display = 'none';
        });
    });
})();
