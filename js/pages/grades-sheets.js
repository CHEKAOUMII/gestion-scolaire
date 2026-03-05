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

    // ─── Load Filters ───
    let classLevelMap = new Map(); // code → { name, order, sections[] }

    async function loadFilters() {
        try {
            const year = getYear();
            const classes = (await window.api.classes.getAll(year)) || [];

            // Build level → sections map
            classLevelMap = new Map();
            classes.forEach((c) => {
                const levelInfo = getLevelFromSection(c.name);
                if (!classLevelMap.has(levelInfo.code)) {
                    classLevelMap.set(levelInfo.code, { name: levelInfo.name, order: levelInfo.order, sections: [] });
                }
                const entry = classLevelMap.get(levelInfo.code);
                if (!entry.sections.includes(c.name)) entry.sections.push(c.name);
            });

            // Populate level dropdown
            const ls = $('level-select');
            if (ls) {
                while (ls.options.length > 1) ls.remove(1);
                [...classLevelMap.entries()]
                    .sort((a, b) => a[1].order - b[1].order)
                    .forEach(([code, info]) => {
                        const opt = document.createElement('option');
                        opt.value = code;
                        opt.textContent = info.name;
                        ls.appendChild(opt);
                    });
            }

            // Populate class dropdown from level selection (or all if no level select)
            updateClassDropdown();

            const subjects = (await window.api.subjects.getAll()) || [];
            const ss = subjectSelect();
            while (ss.options.length > 1) ss.remove(1);

            const normalizeSubjectName = (subject) =>
                String(subject || '')
                    .replace(/\s*\(\s*فرض\s*[0-9\u0660-\u0669]+\s*\)\s*$/i, '')
                    .replace(/\s*\(الأنشطة المندمجة\)\s*$/, '')
                    .trim();

            const uniqueSubjects = Array.from(
                new Set(subjects.map((s) => normalizeSubjectName(s.name)).filter(Boolean))
            ).sort((a, b) => a.localeCompare(b, 'ar'));

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

    function updateClassDropdown() {
        const cs = classSelect();
        const ls = $('level-select');
        while (cs.options.length > 1) cs.remove(1);

        const selectedLevel = ls?.value || '';
        if (selectedLevel && classLevelMap.has(selectedLevel)) {
            const entry = classLevelMap.get(selectedLevel);
            entry.sections.sort().forEach((name) => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                cs.appendChild(opt);
            });
        } else if (!selectedLevel) {
            // Show all classes grouped by level
            [...classLevelMap.entries()]
                .sort((a, b) => a[1].order - b[1].order)
                .forEach(([, info]) => {
                    info.sections.sort().forEach((name) => {
                        const opt = document.createElement('option');
                        opt.value = name;
                        opt.textContent = name;
                        cs.appendChild(opt);
                    });
                });
        }
    }

    // ─── Build inline letterhead HTML from identity ───
    function buildLetterheadHTML(id, year) {
        if (!id || (!id.school_name && !id.ministry)) return '';
        const e = escapeHtml;
        const logo = id.logo_base64
            ? `<img src="data:image/png;base64,${id.logo_base64}" style="max-width: 300px; max-height: 300px;" alt="logo">`
            : '<div style="width: 52px; height: 52px; border: 1px dashed #ccc; border-radius: 50%; margin: 0 auto;"></div>';

        return `
        <div class="gs-letterhead" style="border-bottom: 2.5px solid #3B6AC5; padding-bottom: 10px; margin-bottom: 14px;">
            <table style="width: 100%; border-collapse: collapse;" role="presentation">
                <tr>
                    <td style="width: 45%; vertical-align: middle; text-align: center; padding: 0;">
                        <div style="font-size: 11px; font-weight: 700; color: #222;">${e(id.country || '')}</div>
                        <div style="font-size: 9.5px; color: #555; margin-top: 2px;">${e(id.ministry || '')}</div>
                        ${id.academy ? `<div style="font-size: 9px; color: #666; margin-top: 2px;">${e(id.academy)}</div>` : ''}
                        ${id.directorate ? `<div style="font-size: 9px; color: #666; margin-top: 1px;">${e(id.directorate)}</div>` : ''}
                    </td>
                    <td style="width: 10%; text-align: center; vertical-align: middle;">${logo}</td>
                    <td style="width: 45%; vertical-align: middle; text-align: center; padding: 0;">
                        <div style="font-size: 13px; font-weight: 800; color: #3B6AC5;">${e(id.school_name || '')}</div>
                        ${id.school_code ? `<div style="font-size: 9px; color: #888; margin-top: 2px;">رمز المؤسسة: ${e(id.school_code)}</div>` : ''}
                        ${id.commune ? `<div style="font-size: 9px; color: #888; margin-top: 1px;">الجماعة: ${e(id.commune)}</div>` : ''}
                        ${year ? `<div style="font-size: 9px; color: #888; margin-top: 1px;">السنة الدراسية: ${e(year)}</div>` : (id.school_year ? `<div style="font-size: 9px; color: #888; margin-top: 1px;">السنة الدراسية: ${e(id.school_year)}</div>` : '')}
                    </td>
                </tr>
            </table>
        </div>`;
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

            const letterheadHTML = buildLetterheadHTML(identity, year);

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
        openPrintPreview({
            contentSelector: '#gs-sheet-content',
            title: 'ورقة التنقيط',
            pageSize: 'A4'
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

    // ─── Direct Print (via printHTML — auto-injects letterhead) ───
    async function directPrint() {
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
                mode: 'print'
            });
            if (result?.success) {
                if (typeof showToast === 'function') showToast('تم إرسال ورقة التنقيط للطباعة', 'success');
            }
        } catch (err) {
            console.warn('Print error:', err);
        }
    }

    // ─── Init ───
    document.addEventListener('DOMContentLoaded', async () => {
        await loadFilters();

        // Generate
        generateBtn()?.addEventListener('click', generate);

        // Level filter chains to class dropdown
        $('level-select')?.addEventListener('change', () => {
            updateClassDropdown();
            showEmpty();
            updateButtons(false);
            isGenerated = false;
            currentStudents = [];
            const badge = countBadge();
            if (badge) badge.style.display = 'none';
        });

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
