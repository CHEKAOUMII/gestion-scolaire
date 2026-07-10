/**
 * settings-defaults.js — App defaults: exam counts per level + page access matrix
 */
(function () {
    'use strict';

    let examLevels = [];
    let examSubjects = [];
    let examDraft = {};
    let examDirty = false;
    let examSaving = false;

    let accessRoles = [];
    let accessPages = [];
    /** pageKey → Set of allowed roles (draft) */
    let accessDraft = {};
    /** pageKey → original joined roles string for dirty detect */
    let accessBaseline = {};
    let accessDirtyPages = new Set();
    let accessSaving = false;

    function safeText(value) {
        if (typeof escapeHtml === 'function') {
            return escapeHtml(String(value || ''));
        }
        return String(value || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function sourceLabel(source) {
        const map = {
            level: { text: 'مخصّص للمستوى', variant: 'level', icon: 'fa-bullseye' },
            default: { text: 'من الافتراضي', variant: 'default', icon: 'fa-layer-group' },
            seed: { text: 'افتراضي البرنامج', variant: 'seed', icon: 'fa-seedling' }
        };
        const meta = map[source];
        if (!meta) {
            return `<span class="sd-source-badge sd-source-badge--seed">${safeText(source || '—')}</span>`;
        }
        return `<span class="sd-source-badge sd-source-badge--${meta.variant}">
            <i class="fas ${meta.icon}"></i>${meta.text}
        </span>`;
    }

    // ─── Tabs ─────────────────────────────────────────────────────
    function initTabs() {
        const buttons = document.querySelectorAll('.rh-tab-btn');
        const panels = document.querySelectorAll('.rh-tab-panel');
        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                buttons.forEach((b) => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
                });
                panels.forEach((panel) => {
                    const match = panel.id === `tab-${tab}`;
                    panel.classList.toggle('active', match);
                    if (match) {
                        panel.removeAttribute('hidden');
                    } else {
                        panel.setAttribute('hidden', '');
                    }
                });
            });
        });
    }

    // ─── Tab 1: Exam counts ───────────────────────────────────────
    function updateExamSaveUi() {
        const saveBtn = document.getElementById('save-exam-counts');
        const chip = document.getElementById('exam-counts-pending');
        if (saveBtn) saveBtn.disabled = !examDirty || examSaving;
        if (chip) {
            if (examSaving) {
                chip.dataset.state = 'saving';
                chip.textContent = 'جاري الحفظ…';
            } else if (examDirty) {
                chip.dataset.state = 'dirty';
                chip.textContent = 'غير محفوظ';
            } else {
                chip.dataset.state = 'clean';
                chip.textContent = 'محفوظ';
            }
        }
    }

    function renderExamCounts() {
        const tbody = document.getElementById('exam-counts-tbody');
        if (!tbody) return;
        if (!examSubjects.length) {
            tbody.innerHTML =
                '<tr><td colspan="4" class="sd-empty">لا توجد مواد لعرضها</td></tr>';
            return;
        }
        tbody.innerHTML = examSubjects
            .map((row, index) => {
                const count = examDraft[row.subject] ?? row.examCount;
                return `<tr>
                    <td class="sd-col-num">${index + 1}</td>
                    <td class="sd-subject-cell">${safeText(row.subject)}</td>
                    <td class="sd-col-count">
                        <input type="number" class="sd-exam-count-input"
                            min="1" max="12" step="1"
                            data-subject="${safeText(row.subject)}"
                            value="${Number(count)}"
                            aria-label="عدد فروض ${safeText(row.subject)}" />
                    </td>
                    <td class="sd-col-source">${sourceLabel(row.source)}</td>
                </tr>`;
            })
            .join('');

        tbody.querySelectorAll('input[data-subject]').forEach((input) => {
            input.addEventListener('input', () => {
                examDirty = true;
                updateExamSaveUi();
            });
            input.addEventListener('change', () => {
                const subject = input.dataset.subject;
                let n = Number(input.value);
                if (!Number.isFinite(n)) n = 2;
                n = Math.min(12, Math.max(1, Math.round(n)));
                input.value = String(n);
                examDraft[subject] = n;
                examDirty = true;
                updateExamSaveUi();
            });
        });
    }

    async function loadExamLevels() {
        const select = document.getElementById('exam-level-select');
        if (!select || !window.api?.appDefaults?.listLevels) return;
        const res = await window.api.appDefaults.listLevels();
        examLevels = res?.levels || [];
        select.innerHTML = examLevels
            .map(
                (l) =>
                    `<option value="${safeText(l.code)}">${safeText(l.name)}${l.code !== '*' ? ` (${safeText(l.code)})` : ''}</option>`
            )
            .join('');
        if (!select.value && examLevels.length) select.value = examLevels[0].code;
    }

    async function loadExamCounts() {
        const select = document.getElementById('exam-level-select');
        const level = select?.value || '*';
        if (!window.api?.appDefaults?.getExamCounts) {
            showToast('واجهة الإعدادات غير متاحة', 'error');
            return;
        }
        const handle = showToast.loading('جاري تحميل عدد الفروض...');
        try {
            const res = await window.api.appDefaults.getExamCounts(level);
            if (!res?.success) {
                handle.error(res?.error || 'فشل التحميل');
                return;
            }
            examSubjects = res.subjects || [];
            examDraft = {};
            examSubjects.forEach((s) => {
                examDraft[s.subject] = s.examCount;
            });
            examDirty = false;
            renderExamCounts();
            updateExamSaveUi();
            handle.success(`تم تحميل ${examSubjects.length} مادة`);
        } catch (err) {
            handle.error('حدث خطأ: ' + (err.message || err));
        }
    }

    async function saveExamCounts() {
        if (examSaving || !examDirty) return;
        const select = document.getElementById('exam-level-select');
        const levelCode = select?.value || '*';
        const subjects = Object.keys(examDraft).map((subject) => ({
            subject,
            examCount: examDraft[subject]
        }));
        examSaving = true;
        updateExamSaveUi();
        const handle = showToast.loading('جاري الحفظ...');
        try {
            const res = await window.api.appDefaults.saveExamCounts({ levelCode, subjects });
            if (!res?.success) {
                handle.error(res?.error || 'فشل الحفظ');
                examSaving = false;
                updateExamSaveUi();
                return;
            }
            examDirty = false;
            examSaving = false;
            handle.success('تم حفظ عدد الفروض');
            await loadExamCounts();
        } catch (err) {
            examSaving = false;
            updateExamSaveUi();
            handle.error('حدث خطأ: ' + (err.message || err));
        }
    }

    // ─── Tab 2: Page access matrix ────────────────────────────────
    function rolesKey(roles) {
        return [...roles].sort().join(',');
    }

    function updateAccessSaveUi() {
        const saveBtn = document.getElementById('save-page-access');
        const chip = document.getElementById('page-access-pending');
        const dirty = accessDirtyPages.size > 0;
        if (saveBtn) saveBtn.disabled = !dirty || accessSaving;
        if (chip) {
            if (accessSaving) {
                chip.dataset.state = 'saving';
                chip.textContent = 'جاري الحفظ…';
            } else if (dirty) {
                chip.dataset.state = 'dirty';
                chip.textContent = `${accessDirtyPages.size} معدّلة`;
            } else {
                chip.dataset.state = 'clean';
                chip.textContent = 'محفوظ';
            }
        }
    }

    function markAccessDirty(pageKey) {
        const current = rolesKey(accessDraft[pageKey] || []);
        if (current === accessBaseline[pageKey]) {
            accessDirtyPages.delete(pageKey);
        } else {
            accessDirtyPages.add(pageKey);
        }
        updateAccessSaveUi();
    }

    function renderAccessMatrix() {
        const thead = document.getElementById('page-access-thead');
        const tbody = document.getElementById('page-access-tbody');
        if (!thead || !tbody) return;

        const meta = document.getElementById('page-access-meta');
        if (meta) {
            meta.textContent = accessPages.length
                ? `${accessPages.length} صفحة · ${accessRoles.length} دور`
                : '';
        }

        if (!accessPages.length) {
            thead.innerHTML = '';
            tbody.innerHTML = '<tr><td class="sd-empty">لا توجد صفحات</td></tr>';
            return;
        }

        const roleHeads = accessRoles
            .map((r) => `<th class="sd-matrix-role-head" title="${safeText(r.role)}">${safeText(r.label)}</th>`)
            .join('');
        thead.innerHTML = `<tr>
            <th class="sd-matrix-sticky">الصفحة</th>
            ${roleHeads}
        </tr>`;

        let html = '';
        let lastGroup = null;
        const colSpan = accessRoles.length + 1;

        for (const page of accessPages) {
            if (page.group !== lastGroup) {
                lastGroup = page.group;
                html += `<tr class="sd-matrix-group-row"><td colspan="${colSpan}"><i class="fas fa-folder-open sd-group-icon"></i>${safeText(page.group || 'أخرى')}</td></tr>`;
            }
            const allowed = new Set(accessDraft[page.pageKey] || []);
            const dirtyClass = accessDirtyPages.has(page.pageKey) ? ' sd-matrix-row--dirty' : '';
            const cells = accessRoles
                .map((r) => {
                    const checked = allowed.has(r.role) ? 'checked' : '';
                    return `<td class="sd-matrix-check">
                        <input type="checkbox" data-page="${safeText(page.pageKey)}" data-role="${safeText(r.role)}"
                            ${checked} aria-label="${safeText(page.title)} — ${safeText(r.label)}" />
                    </td>`;
                })
                .join('');
            html += `<tr class="${dirtyClass.trim()}" data-page-row="${safeText(page.pageKey)}">
                <td class="sd-matrix-sticky">
                    <span class="sd-matrix-page-title">${safeText(page.title)}</span>
                    <span class="sd-matrix-page-path">${safeText(page.page)}</span>
                </td>
                ${cells}
            </tr>`;
        }
        tbody.innerHTML = html;

        tbody.querySelectorAll('input[type="checkbox"][data-page]').forEach((input) => {
            input.addEventListener('change', () => {
                const pageKey = input.dataset.page;
                const role = input.dataset.role;
                if (!accessDraft[pageKey]) accessDraft[pageKey] = [];
                const set = new Set(accessDraft[pageKey]);
                if (input.checked) set.add(role);
                else set.delete(role);
                accessDraft[pageKey] = Array.from(set);
                markAccessDirty(pageKey);
                const row = tbody.querySelector(`tr[data-page-row="${pageKey}"]`);
                if (row) {
                    row.classList.toggle('sd-matrix-row--dirty', accessDirtyPages.has(pageKey));
                }
            });
        });
    }

    async function loadPageAccess() {
        if (!window.api?.appDefaults?.listPages) {
            showToast('واجهة الصلاحيات غير متاحة', 'error');
            return;
        }
        const handle = showToast.loading('جاري تحميل صلاحيات الصفحات...');
        try {
            const res = await window.api.appDefaults.listPages();
            if (!res?.success) {
                handle.error(res?.error || 'فشل التحميل');
                return;
            }
            accessRoles = res.roles || [];
            accessPages = res.pages || [];
            accessDraft = {};
            accessBaseline = {};
            accessDirtyPages = new Set();
            for (const page of accessPages) {
                const roles = (page.roles || []).filter((r) => r.allowed).map((r) => r.role);
                accessDraft[page.pageKey] = roles.slice();
                accessBaseline[page.pageKey] = rolesKey(roles);
            }
            renderAccessMatrix();
            updateAccessSaveUi();
            handle.success(`تم تحميل ${accessPages.length} صفحة`);
        } catch (err) {
            handle.error('حدث خطأ: ' + (err.message || err));
        }
    }

    async function savePageAccess() {
        if (accessSaving || !accessDirtyPages.size) return;
        const pages = Array.from(accessDirtyPages).map((pageKey) => ({
            pageKey,
            roles: accessDraft[pageKey] || []
        }));

        const { confirmed } = await showConfirm({
            title: 'حفظ صلاحيات الصفحات',
            message: `هل تريد حفظ التعديلات على ${pages.length} صفحة؟`,
            detail: 'ستُطبَّق الصلاحيات فوراً على جميع المستخدمين بعد إعادة تحميل الصفحات.',
            type: 'warning',
            confirmText: 'حفظ'
        });
        if (!confirmed) return;

        accessSaving = true;
        updateAccessSaveUi();
        const handle = showToast.loading('جاري حفظ الصلاحيات...');
        try {
            const res = await window.api.appDefaults.savePageAccess({ pages });
            if (!res?.success) {
                handle.error(res?.error || 'فشل الحفظ');
                accessSaving = false;
                updateAccessSaveUi();
                return;
            }
            accessSaving = false;
            handle.success('تم حفظ صلاحيات الصفحات');
            await loadPageAccess();
        } catch (err) {
            accessSaving = false;
            updateAccessSaveUi();
            handle.error('حدث خطأ: ' + (err.message || err));
        }
    }

    // ─── Init ─────────────────────────────────────────────────────
    async function init() {
        initTabs();

        document.getElementById('exam-level-select')?.addEventListener('change', async () => {
            if (examDirty) {
                const { confirmed } = await showConfirm({
                    title: 'تعديلات غير محفوظة',
                    message: 'توجد تعديلات غير محفوظة. هل تريد المتابعة وتجاهلها؟',
                    type: 'warning',
                    confirmText: 'تجاهل'
                });
                if (!confirmed) {
                    // restore previous — reload keeps current; re-select after load
                    return;
                }
            }
            await loadExamCounts();
        });
        document.getElementById('save-exam-counts')?.addEventListener('click', saveExamCounts);
        document.getElementById('refresh-exam-counts')?.addEventListener('click', async () => {
            if (examDirty) {
                const { confirmed } = await showConfirm({
                    title: 'تحديث',
                    message: 'ستُفقد التعديلات غير المحفوظة. متابعة؟',
                    type: 'warning',
                    confirmText: 'تحديث'
                });
                if (!confirmed) return;
            }
            await loadExamCounts();
        });

        document.getElementById('save-page-access')?.addEventListener('click', savePageAccess);
        document.getElementById('refresh-page-access')?.addEventListener('click', async () => {
            if (accessDirtyPages.size) {
                const { confirmed } = await showConfirm({
                    title: 'تحديث',
                    message: 'ستُفقد التعديلات غير المحفوظة. متابعة؟',
                    type: 'warning',
                    confirmText: 'تحديث'
                });
                if (!confirmed) return;
            }
            await loadPageAccess();
        });

        await loadExamLevels();
        await loadExamCounts();
        await loadPageAccess();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
