/**
 * settings-defaults.js — App defaults: exam counts per level + page access matrix + stage rules
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
                const displayCount = count == null ? '' : Number(count);
                return `<tr>
                    <td class="sd-col-num">${index + 1}</td>
                    <td class="sd-subject-cell">${safeText(row.subject)}</td>
                    <td class="sd-col-count">
                        <input type="number" class="sd-exam-count-input"
                            min="1" max="12" step="1"
                            data-subject="${safeText(row.subject)}"
                            value="${displayCount}"
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

    // ─── Tab 3: Stage rules ────────────────────────────────────
    // Cycles exposed by the rules editor, loaded from the education catalog
    // (window.api.cycles.getCatalog). `supported` and `preview` cycles are
    // listed per their capability; `hidden` cycles are excluded. Mirrors
    // cycle_profiles (uses_coefficients = false → coefficient controls hidden);
    // the per-cycle value is filled from stageRules:getActive profiles.
    let stageCycles = [];
    let stageDefaultCycleCode = null;

    // Canonical subject codes (main/db/education-catalogs/subject-catalog.js)
    // that are not keys of SUBJECT_LABELS (js/data/ma-education-labels.js).
    // Lookup order: SUBJECT_LABELS → this map → raw code.
    const STAGE_SUBJECT_CODE_LABELS = {
        ARABIC: 'اللغة العربية',
        FRENCH: 'اللغة الفرنسية',
        SPANISH: 'اللغة الإسبانية',
        GERMAN: 'اللغة الألمانية',
        ITALIAN: 'اللغة الإيطالية',
        HISTORY_GEOGRAPHY: 'التاريخ والجغرافيا',
        EARTH_SCIENCES: 'علوم الحياة والأرض',
        PHYSICS_CHEMISTRY: 'الفيزياء والكيمياء',
        ISLAMIC_EDUCATION: 'التربية الإسلامية',
        PHYSICAL_EDUCATION: 'التربية البدنية',
        PHYSICAL_EDUCATION_SPORT: 'التربية البدنية والرياضية',
        COMPUTER_SCIENCE: 'المعلوميات',
        PHILOSOPHY: 'الفلسفة',
        TRANSLATION: 'الترجمة',
        LAW: 'القانون',
        ACCOUNTING_FINANCE: 'المحاسبة والرياضيات المالية',
        ECONOMICS_STATS: 'الاقتصاد العام والإحصاء',
        ECONOMICS_MANAGEMENT: 'الاقتصاد والتنظيم الإداري للمقاولات',
        MANAGEMENT_COMPUTER_SCIENCE: 'معلوميات التدبير',
        PORTUGUESE: 'اللغة البرتغالية',
        RUSSIAN: 'اللغة الروسية',
        CHINESE: 'اللغة الصينية',
        FOREIGN_LANGUAGE_1: 'اللغة الأجنبية الأولى',
        FOREIGN_LANGUAGE_2: 'اللغة الأجنبية الثانية',
        ENGINEERING_SCIENCES: 'علوم المهندس',
        APPLIED_ARTS: 'الفنون التطبيقية',
        FINE_ARTS: 'الفنون الجميلة',
        ORIGINAL_EDUCATION: 'التعليم الأصيل',
        TECHNOLOGY: 'التكنولوجيا',
        TECHNICAL_SCIENCES: 'العلوم التقنية',
        ELECTRONICS: 'الإلكترونيك',
        ELECTROTECHNICS: 'الكهروتقنية',
        MECHANICS: 'الميكانيك',
        CIVIL_ENGINEERING: 'الهندسة المدنية',
        TOPOGRAPHY: 'الطوبوغرافيا',
        AGRICULTURE: 'الفلاحة',
        AGROFOOD: 'الصناعة الغذائية',
        TOURISM_HOSPITALITY: 'السياحة والفندقة',
        TEXTILE: 'النسيج',
        CONSTRUCTION: 'البناء والأشغال العامة',
        SEWING: 'الخياطة',
        HAIRDRESSING: 'الحلاقة والتجميل',
        DEEP_ACCOUNTING: 'المحاسبة المعمقة',
        QURAN_HADITH: 'علوم القرآن والحديث',
        FIQH: 'الفقه وأصوله',
        TAWHID_ISLAMIC_THOUGHT: 'التوحيد والفكر الإسلامي'
    };

    const STAGE_STATUS_LABELS = { draft: 'مسودة', active: 'نشط', closed: 'مغلق' };
    const STAGE_REASON_MAX_LENGTH = 500;

    let stageLevels = [];
    let stageRuleSet = null;
    let stageCoefficients = [];
    let stageExamCounts = [];
    let stageWeights = [];
    /** rowKey → current displayed values { coefficient?, examCount? } */
    let stageDraft = {};
    /** rowKey → original loaded values for dirty detection */
    let stageBaseline = {};
    /** rowKey → changed values { coefficient?, examCount? } */
    let stageDirty = {};
    /** rowKey → custom rows to restore { cycleCode, levelCode, streamCode, subjectCode }[] */
    let stageRestoreKeys = {};
    let stageSaving = false;
    let stageLocked = false;

    function stageCurrentYear() {
        const select = document.getElementById('stage-year-select');
        return select?.value || (typeof getSchoolYear === 'function' ? getSchoolYear() : '');
    }

    function stageSelectedCycle() {
        const code = document.getElementById('stage-cycle-select')?.value;
        return stageCycles.find((c) => c.cycleCode === code) || stageCycles[0] || null;
    }

    async function loadStageCycles() {
        if (!window.api?.cycles?.getCatalog) return;
        try {
            const response = await window.api.cycles.getCatalog();
            stageCycles = (response?.success && Array.isArray(response.cycles) ? response.cycles : [])
                .filter((cycle) => cycle.capability !== 'hidden')
                .map((cycle) => ({
                    cycleCode: cycle.cycle_code,
                    labelAr: cycle.label_ar,
                    capability: cycle.capability,
                    usesCoefficients: undefined
                }));
            let activeCode = null;
            if (window.api?.cycles?.getActive) {
                try {
                    const active = await window.api.cycles.getActive();
                    activeCode = active?.success ? active.context?.cycleCode || active.cycle?.cycle_code || null : null;
                } catch (err) {
                    console.warn('settings-defaults: active cycle unavailable:', err);
                }
            }
            stageDefaultCycleCode =
                stageCycles.find((c) => c.cycleCode === activeCode)?.cycleCode ||
                stageCycles.find((c) => c.capability === 'supported')?.cycleCode ||
                stageCycles[0]?.cycleCode ||
                null;
        } catch (err) {
            console.warn('settings-defaults: stage cycles unavailable:', err);
        }
    }

    function stageUsesCoefficients() {
        return stageSelectedCycle()?.usesCoefficients !== false;
    }

    function stageRowKey(levelCode, streamCode, subjectCode) {
        return `${levelCode}|${streamCode}|${subjectCode}`;
    }

    function stageLevelLabel(code) {
        const level = stageLevels.find((l) => l.code === code);
        if (level) return level.name;
        return {
            '*': 'الكل',
            TC: 'الجذع المشترك',
            '1BAC': 'السنة الأولى بكالوريا',
            '2BAC': 'السنة الثانية بكالوريا'
        }[code] || code;
    }

    function stageRuleLevelCodes() {
        const codes = new Set(['*']);
        for (const row of stageCoefficients) codes.add(row.level_code);
        for (const row of stageExamCounts) codes.add(row.level_code);
        const order = ['*', 'TC', '1BAC', '2BAC'];
        return Array.from(codes).sort((left, right) => {
            const leftOrder = order.indexOf(left);
            const rightOrder = order.indexOf(right);
            if (leftOrder !== -1 || rightOrder !== -1) {
                return (leftOrder === -1 ? 99 : leftOrder) - (rightOrder === -1 ? 99 : rightOrder);
            }
            return String(left).localeCompare(String(right));
        });
    }

    function stageSubjectLabel(code) {
        if (typeof SUBJECT_LABELS !== 'undefined' && SUBJECT_LABELS[code]) {
            return SUBJECT_LABELS[code];
        }
        return STAGE_SUBJECT_CODE_LABELS[code] || String(code || '—');
    }

    function stageSourceBadge(source) {
        if (source === 'custom') {
            return `<span class="sd-source-badge sd-source-badge--level" data-source="custom"><i class="fas fa-pen-to-square"></i>مخصص</span>`;
        }
        if (source === 'official') {
            return `<span class="sd-source-badge sd-source-badge--seed" data-source="official"><i class="fas fa-seedling"></i>رسمي</span>`;
        }
        return `<span class="sd-source-badge sd-source-badge--seed" data-source="">—</span>`;
    }

    function stageErrorMessage(res) {
        const code = res?.code || res?.errorCode;
        if (code && window.StageRulesErrorContract && typeof window.StageRulesErrorContract.getMessage === 'function') {
            return window.StageRulesErrorContract.getMessage(code);
        }
        return res?.error || res?.message || 'فشل العملية';
    }

    function stageMessageFor(code) {
        if (window.StageRulesErrorContract && typeof window.StageRulesErrorContract.getMessage === 'function') {
            return window.StageRulesErrorContract.getMessage(code);
        }
        return String(code);
    }

    /** Shared mandatory reason gate: returns trimmed reason or null (toast + focus on failure). */
    function stageValidReason() {
        const reason = String(document.getElementById('stage-reason')?.value || '').trim();
        if (!reason) {
            showToast(stageMessageFor('REASON_REQUIRED'), 'error');
            document.getElementById('stage-reason')?.focus();
            return null;
        }
        if (reason.length > STAGE_REASON_MAX_LENGTH) {
            showToast(`سبب التعديل طويل جداً — الحد الأقصى ${STAGE_REASON_MAX_LENGTH} حرف.`, 'error');
            document.getElementById('stage-reason')?.focus();
            return null;
        }
        return reason;
    }

    function stageCustomRowsCount() {
        let count = 0;
        for (const row of stageCoefficients) {
            if (row.source === 'custom') count += 1;
        }
        for (const row of stageExamCounts) {
            if (row.source === 'custom') count += 1;
        }
        for (const row of stageWeights) {
            if (row.source === 'custom') count += 1;
        }
        return count;
    }

    function stageUpdateRestoreUi() {
        const bulk = document.getElementById('restore-stage-rules');
        if (!bulk) return;
        const hasCustom = stageCustomRowsCount() > 0;
        bulk.disabled = !hasCustom || stageLocked || stageSaving;
        bulk.title = hasCustom
            ? 'استعادة جميع القيم المخصصة إلى القيم الرسمية'
            : 'لا توجد قيم مخصصة لاستعادتها';
    }

    // Resolution precedence per stage-rules resolver contract:
    // exact (level, stream) → level exact + stream wildcard → level wildcard + stream exact → both wildcard.
    // Within the winning key, a custom row beats the official row.
    function stageRowForKey(rows, levelCode, streamCode, subjectCode) {
        const matchers = [
            (r) => r.level_code === levelCode && r.stream_code === streamCode,
            (r) => r.level_code === levelCode && r.stream_code === '*',
            (r) => r.level_code === '*' && r.stream_code === streamCode,
            (r) => r.level_code === '*' && r.stream_code === '*'
        ];
        for (const match of matchers) {
            const group = rows.filter((r) => r.subject_code === subjectCode && match(r));
            if (!group.length) continue;
            return group.find((r) => r.source === 'custom') || group[0];
        }
        return null;
    }

    function stageExamFor(levelCode, subjectCode) {
        const exact = stageExamCounts.filter((r) => r.subject_code === subjectCode && r.level_code === levelCode);
        const wildcard = stageExamCounts.filter((r) => r.subject_code === subjectCode && r.level_code === '*');
        const candidates = exact.length ? exact : wildcard;
        if (!candidates.length) return null;
        return candidates.find((r) => r.source === 'custom') || candidates[0];
    }

    function stageWeightFor(subjectCode) {
        const cycleCode = stageSelectedCycle()?.cycleCode;
        const candidates = stageWeights.filter(
            (row) => row.subject_code === subjectCode && row.cycle_code === cycleCode
        );
        if (!candidates.length) return null;
        return candidates.find((row) => row.source === 'custom') || candidates[0];
    }

    function stageScopeSubjects(levelCode, streamCode) {
        const set = new Set();
        if (stageUsesCoefficients()) {
            for (const row of stageCoefficients) {
                if (row.level_code === levelCode || row.level_code === '*') {
                    if (row.stream_code === streamCode || row.stream_code === '*') {
                        set.add(row.subject_code);
                    }
                }
            }
        }
        for (const row of stageExamCounts) {
            if (row.level_code === levelCode || row.level_code === '*') {
                set.add(row.subject_code);
            }
        }
        return Array.from(set);
    }

    function stageUpdateSaveUi() {
        const saveBtn = document.getElementById('save-stage-rules');
        const pending = document.getElementById('stage-pending');
        const dirtyCount = Object.keys(stageDirty).length;
        if (saveBtn) saveBtn.disabled = !dirtyCount || stageSaving || stageLocked;
        if (pending) {
            pending.hidden = !dirtyCount;
            pending.dataset.state = stageSaving ? 'saving' : 'dirty';
            pending.textContent = stageSaving ? 'جاري الحفظ…' : 'غير محفوظ';
        }
        stageUpdateRestoreUi();
    }

    function stageRenderVersion() {
        const chip = document.getElementById('stage-version-badge');
        if (!chip) return;
        const set = stageRuleSet;
        if (!set) {
            chip.dataset.state = 'saving';
            chip.textContent = 'لا توجد نسخة قواعد';
            chip.title = 'ستُنشأ نسخة أولى عند أول حفظ.';
            return;
        }
        chip.dataset.state = set.status === 'closed' ? 'dirty' : set.status === 'draft' ? 'saving' : 'clean';
        chip.textContent = `الإصدار ${set.revision} — ${STAGE_STATUS_LABELS[set.status] || set.status}`;
        chip.title = set.created_by ? `أنشأها: ${set.created_by} · السبب: ${set.reason || ''}` : '';
    }

    function stageApplyCycleVisibility() {
        const usesCoeff = stageUsesCoefficients();
        document.querySelectorAll('.stage-col-coefficient').forEach((el) => {
            el.hidden = !usesCoeff;
        });
        const notice = document.getElementById('stage-primary-notice');
        if (notice) notice.classList.toggle('hidden', usesCoeff);
    }

    function stageApplyLock() {
        stageLocked = stageRuleSet?.status === 'closed';
        const notice = document.getElementById('stage-lock-notice');
        if (notice) {
            notice.classList.toggle('hidden', !stageLocked);
            const text = document.getElementById('stage-lock-notice-text');
            if (text) {
                text.textContent = stageLocked
                    ? 'لا يمكن تعديل نسخة قواعد مغلقة — كل تغيير ينشئ نسخة جديدة فعالة.'
                    : '';
            }
        }
        document.querySelectorAll('#stage-rules-tbody input').forEach((input) => {
            input.disabled = stageLocked;
        });
        document.querySelectorAll('#stage-rules-tbody .stage-restore-row').forEach((btn) => {
            btn.disabled = stageLocked;
        });
        const reason = document.getElementById('stage-reason');
        if (reason) reason.disabled = stageLocked;
    }

    function stageMarkDirty(key, field, value) {
        if (!stageDirty[key]) stageDirty[key] = {};
        const baselineValue = stageBaseline[key]?.[field];
        const same = baselineValue !== undefined && String(value) === String(baselineValue);
        if (same) {
            delete stageDirty[key][field];
            if (!Object.keys(stageDirty[key]).length) delete stageDirty[key];
        } else {
            stageDirty[key][field] = value;
        }
        stageUpdateSaveUi();
    }

    function renderStagePickers() {
        const levelSelect = document.getElementById('stage-level-select');
        const streamSelect = document.getElementById('stage-stream-select');
        const subjectSelect = document.getElementById('stage-subject-select');
        if (!levelSelect || !streamSelect || !subjectSelect) return;

        const usesCoeff = stageUsesCoefficients();
        const previousLevel = levelSelect.value;

        const ruleLevels = stageRuleLevelCodes();
        levelSelect.innerHTML = ruleLevels
            .map((code) => `<option value="${safeText(code)}">${safeText(stageLevelLabel(code))}</option>`)
            .join('');
        levelSelect.disabled = !ruleLevels.length || !usesCoeff;
        if (!usesCoeff || !ruleLevels.length) {
            levelSelect.value = '';
        } else if (ruleLevels.includes(previousLevel)) {
            levelSelect.value = previousLevel;
        } else {
            levelSelect.value = ruleLevels.find((code) => code !== '*') || ruleLevels[0];
        }
        const level = levelSelect.value || '*';

        const streams = new Set(['*']);
        if (usesCoeff) {
            for (const row of stageCoefficients) {
                if (row.level_code === level || row.level_code === '*') {
                    if (row.stream_code && row.stream_code !== '*') streams.add(row.stream_code);
                }
            }
        }
        const streamOptions = Array.from(streams).sort();
        const prevStream = streamSelect.value || '*';
        streamSelect.innerHTML = streamOptions
            .map((s) => `<option value="${safeText(s)}">${s === '*' ? 'الكل' : safeText(s)}</option>`)
            .join('');
        streamSelect.value = streamOptions.includes(prevStream) ? prevStream : '*';
        streamSelect.disabled = !usesCoeff || streamOptions.length <= 1;
        const stream = streamSelect.value || '*';

        const subjects = stageScopeSubjects(level, stream).sort((a, b) =>
            String(stageSubjectLabel(a)).localeCompare(String(stageSubjectLabel(b)), 'ar')
        );
        const prevSubject = subjectSelect.value || '';
        subjectSelect.innerHTML =
            '<option value="">كل المواد</option>' +
            subjects
                .map((s) => `<option value="${safeText(s)}">${safeText(stageSubjectLabel(s))}</option>`)
                .join('');
        subjectSelect.value = subjects.includes(prevSubject) ? prevSubject : '';
        subjectSelect.disabled = !subjects.length;
    }

    function renderStageRules() {
        const tbody = document.getElementById('stage-rules-tbody');
        if (!tbody) return;
        const usesCoeff = stageUsesCoefficients();
        const level = document.getElementById('stage-level-select')?.value || '*';
        const stream = document.getElementById('stage-stream-select')?.value || '*';
        const subjectFilter = document.getElementById('stage-subject-select')?.value || '';

        let subjects = stageScopeSubjects(level, stream);
        if (subjectFilter) subjects = subjects.filter((s) => s === subjectFilter);
        subjects.sort((a, b) =>
            String(stageSubjectLabel(a)).localeCompare(String(stageSubjectLabel(b)), 'ar')
        );

        if (!subjects.length) {
            tbody.innerHTML = `<tr><td colspan="${usesCoeff ? 10 : 9}" class="sd-empty">لا توجد مواد لعرضها في هذا النطاق</td></tr>`;
            return;
        }

        stageRestoreKeys = {};
        tbody.innerHTML = subjects
            .map((subject, index) => {
                const coeffRow = usesCoeff ? stageRowForKey(stageCoefficients, level, stream, subject) : null;
                const examRow = stageExamFor(level, subject);
                const weightRow = stageWeightFor(subject);
                const key = stageRowKey(level, stream, subject);
                if (stageBaseline[key] === undefined && stageDraft[key] === undefined) {
                    stageBaseline[key] = {
                        coefficient: coeffRow ? Number(coeffRow.coefficient) : undefined,
                        examCount: examRow ? Number(examRow.exam_count) : undefined,
                        examWeight: weightRow ? Number(weightRow.exam_weight_bps) / 100 : undefined,
                        activityWeight: weightRow ? Number(weightRow.activity_weight_bps) / 100 : undefined
                    };
                }
                const draft = stageDraft[key] || {};
                const baseline = stageBaseline[key] || {};
                const coeffValue = draft.coefficient ?? baseline.coefficient ?? (coeffRow ? Number(coeffRow.coefficient) : '');
                const examValue = draft.examCount ?? baseline.examCount ?? (examRow ? Number(examRow.exam_count) : '');
                const examWeightValue =
                    draft.examWeight ?? baseline.examWeight ?? (weightRow ? Number(weightRow.exam_weight_bps) / 100 : '');
                const activityWeightValue =
                    draft.activityWeight ?? baseline.activityWeight ??
                    (weightRow ? Number(weightRow.activity_weight_bps) / 100 : '');
                const coeffDisplay = coeffValue === '' || coeffValue === null || coeffValue === undefined ? '' : Number(coeffValue);
                const examDisplay = examValue === '' || examValue === null || examValue === undefined ? '' : Number(examValue);
                const examWeightDisplay =
                    examWeightValue === '' || examWeightValue === null || examWeightValue === undefined
                        ? ''
                        : Number(examWeightValue);
                const activityWeightDisplay =
                    activityWeightValue === '' || activityWeightValue === null || activityWeightValue === undefined
                        ? ''
                        : Number(activityWeightValue);
                const sources = [weightRow?.source, coeffRow?.source, examRow?.source].filter(Boolean);
                const source = sources.includes('custom') ? 'custom' : sources.includes('official') ? 'official' : null;
                const cycleCode = stageSelectedCycle()?.cycleCode;
                const restoreKeys = [];
                if (cycleCode && coeffRow?.source === 'custom') {
                    restoreKeys.push({
                        cycleCode,
                        levelCode: coeffRow.level_code,
                        streamCode: coeffRow.stream_code,
                        subjectCode: coeffRow.subject_code
                    });
                }
                if (cycleCode && examRow?.source === 'custom') {
                    restoreKeys.push({
                        cycleCode,
                        levelCode: examRow.level_code,
                        streamCode: '*',
                        subjectCode: examRow.subject_code
                    });
                }
                if (cycleCode && weightRow?.source === 'custom') {
                    restoreKeys.push({
                        cycleCode,
                        levelCode: '*',
                        streamCode: '*',
                        subjectCode: weightRow.subject_code,
                        ruleType: 'weight'
                    });
                }
                stageRestoreKeys[key] = restoreKeys;
                return `<tr>
                    <td class="sd-col-num">${index + 1}</td>
                    <td class="sd-subject-cell">${safeText(stageSubjectLabel(subject))}</td>
                    <td>${safeText(stageLevelLabel(level))}</td>
                    <td>${stream === '*' ? 'الكل' : safeText(stream)}</td>
                    <td class="sd-col-source">${stageSourceBadge(source)}</td>
                    <td class="sd-col-count stage-col-coefficient">
                        <input type="number" class="sd-exam-count-input"
                            min="1" max="20" step="1"
                            data-key="${safeText(key)}" data-field="coefficient"
                            value="${coeffDisplay}"
                            aria-label="معامل ${safeText(stageSubjectLabel(subject))}" />
                    </td>
                    <td class="sd-col-count">
                        <input type="number" class="sd-exam-count-input"
                            min="0" max="100" step="1"
                            data-key="${safeText(key)}" data-field="examWeight"
                            value="${examWeightDisplay}"
                            aria-label="نسبة الفروض ${safeText(stageSubjectLabel(subject))}" />
                    </td>
                    <td class="sd-col-count">
                        <input type="number" class="sd-exam-count-input"
                            min="0" max="100" step="1"
                            data-key="${safeText(key)}" data-field="activityWeight"
                            value="${activityWeightDisplay}"
                            aria-label="نسبة الأنشطة ${safeText(stageSubjectLabel(subject))}" />
                    </td>
                    <td class="sd-col-count">
                        <input type="number" class="sd-exam-count-input"
                            min="1" max="12" step="1"
                            data-key="${safeText(key)}" data-field="examCount"
                            value="${examDisplay}"
                            aria-label="عدد فروض ${safeText(stageSubjectLabel(subject))}" />
                    </td>
                    <td class="sd-col-action">
                        ${restoreKeys.length
                            ? `<button type="button" class="btn btn-secondary btn-sm stage-restore-row"
                                    data-key="${safeText(key)}"
                                    title="استعادة الافتراضي الرسمي"
                                    aria-label="استعادة الافتراضي الرسمي لـ ${safeText(stageSubjectLabel(subject))}">
                                <i class="fas fa-rotate-left"></i> استعادة
                            </button>`
                            : ''}
                    </td>
                </tr>`;
            })
            .join('');

        tbody.querySelectorAll('input[data-key]').forEach((input) => {
            const key = input.dataset.key;
            const field = input.dataset.field;
            const max = field === 'coefficient' ? 20 : field === 'examCount' ? 12 : 100;
            const min = field === 'coefficient' || field === 'examCount' ? 1 : 0;
            input.addEventListener('input', () => {
                if (stageLocked) return;
                stageDraft[key] = stageDraft[key] || {};
                stageDraft[key][field] = input.value;
                stageMarkDirty(key, field, input.value);
            });
            input.addEventListener('change', () => {
                if (stageLocked) return;
                let n = Number(input.value);
                if (!Number.isFinite(n)) n = min;
                n = Math.min(max, Math.max(min, Math.round(n)));
                input.value = String(n);
                stageDraft[key] = stageDraft[key] || {};
                stageDraft[key][field] = n;
                stageMarkDirty(key, field, n);
            });
        });

        tbody.querySelectorAll('.stage-restore-row').forEach((btn) => {
            btn.addEventListener('click', () => {
                stageRestoreRow(btn.dataset.key);
            });
        });

        stageApplyCycleVisibility();
        stageApplyLock();
        stageUpdateSaveUi();
    }

    function initStagePickers() {
        const yearSelect = document.getElementById('stage-year-select');
        if (yearSelect) {
            const now = new Date();
            const startYear = now.getFullYear();
            const years = [];
            for (let i = 0; i < 6; i += 1) {
                const start = startYear - i;
                const year = `${start}/${start + 1}`;
                if (!years.includes(year)) years.push(year);
            }
            const current = typeof getSchoolYear === 'function' ? getSchoolYear() : '';
            if (current && !years.includes(current)) years.unshift(current);
            yearSelect.innerHTML = years
                .map((y) => `<option value="${safeText(y)}">${safeText(y)}</option>`)
                .join('');
            yearSelect.value = years.includes(current) ? current : years[0];
        }
        const cycleSelect = document.getElementById('stage-cycle-select');
        if (cycleSelect) {
            cycleSelect.innerHTML = stageCycles
                .map(
                    (c) =>
                        `<option value="${safeText(c.cycleCode)}">${safeText(c.labelAr)}${c.capability === 'preview' ? ' — قيد الإعداد' : ''}</option>`
                )
                .join('');
            cycleSelect.value = stageCycles.some((c) => c.cycleCode === stageDefaultCycleCode)
                ? stageDefaultCycleCode
                : '';
        }
    }

    async function loadStageLevels() {
        const select = document.getElementById('stage-level-select');
        if (!select || !window.api?.appDefaults?.listLevels) return;
        const cycleCode = stageSelectedCycle()?.cycleCode || null;
        const res = await window.api.appDefaults.listLevels(cycleCode);
        stageLevels = res?.levels || [];
        const firstSpecificLevel = stageLevels.find((level) => level.code !== '*');
        if (firstSpecificLevel) select.value = firstSpecificLevel.code;
    }

    async function loadStageRules() {
        if (!window.api?.stageRules?.getActive) {
            showToast('واجهة قواعد المرحلة غير متاحة', 'error');
            return;
        }
        const year = stageCurrentYear();
        if (!year) return;
        const handle = showToast.loading('جاري تحميل قواعد المرحلة...');
        try {
            const res = await window.api.stageRules.getActive(year);
            if (!res) {
                handle.error('فشل التحميل');
                return;
            }
            if (res.error || res.code) {
                handle.error(stageErrorMessage(res));
                return;
            }
            stageRuleSet = res.ruleSet || null;
            stageCoefficients = res.rows?.coefficients || [];
            stageExamCounts = res.rows?.examCounts || [];
            stageWeights = res.rows?.weights || [];
            if (Array.isArray(res.profiles)) {
                res.profiles.forEach((profile) => {
                    if (!profile?.cycle_code) return;
                    const cycle = stageCycles.find((c) => c.cycleCode === profile.cycle_code);
                    if (cycle) cycle.usesCoefficients = Number(profile.uses_coefficients) !== 0;
                });
            }
            stageDraft = {};
            stageBaseline = {};
            stageDirty = {};
            stageSaving = false;
            renderStagePickers();
            renderStageRules();
            stageRenderVersion();
            stageUpdateSaveUi();
            const reason = document.getElementById('stage-reason');
            if (reason) reason.value = '';
            handle.success(
                stageRuleSet
                    ? `تم تحميل نسخة الإصدار ${stageRuleSet.revision}`
                    : 'لا توجد نسخة قواعد لهذه السنة'
            );
        } catch (err) {
            handle.error('حدث خطأ: ' + (err.message || err));
        }
    }

    function stageHandleSaveError(res) {
        const message = stageErrorMessage(res);
        const code = res?.code || res?.errorCode;
        showToast(message, 'error');
        if (code === 'INVALID_RULE_VERSION') {
            stageLocked = true;
            stageUpdateSaveUi();
            loadStageRules();
        }
    }

    async function saveStageRules() {
        if (stageSaving || stageLocked) return;
        if (!window.api?.stageRules?.saveAll) {
            showToast('واجهة قواعد المرحلة غير متاحة', 'error');
            return;
        }
        const keys = Object.keys(stageDirty);
        if (!keys.length) return;

        const year = stageCurrentYear();
        const usesCoeff = stageUsesCoefficients();
        const reason = stageValidReason();
        if (!reason) return;

        const coefficientEntries = [];
        const examCountEntries = [];
        const weightEntries = [];
        const cycleCode = stageSelectedCycle()?.cycleCode;
        for (const key of keys) {
            const [levelCode, streamCode, subjectCode] = key.split('|');
            const changes = stageDirty[key];
            if (usesCoeff && changes.coefficient !== undefined) {
                const n = Number(changes.coefficient);
                if (!Number.isInteger(n) || n < 1 || n > 20) {
                    showToast(stageMessageFor('COEFFICIENT_OUT_OF_RANGE'), 'error');
                    return;
                }
                coefficientEntries.push({ cycleCode, levelCode, streamCode, subjectCode, coefficient: n });
            }
            if (changes.examCount !== undefined) {
                const n = Number(changes.examCount);
                if (!Number.isInteger(n) || n < 1 || n > 12) {
                    showToast(stageMessageFor('EXAM_COUNT_OUT_OF_RANGE'), 'error');
                    return;
                }
                examCountEntries.push({ cycleCode, levelCode, subjectCode, examCount: n });
            }
            const hasWeightChange = changes.examWeight !== undefined || changes.activityWeight !== undefined;
            if (hasWeightChange) {
                const examWeight = Number(changes.examWeight ?? stageBaseline[key]?.examWeight);
                const activityWeight = Number(changes.activityWeight ?? stageBaseline[key]?.activityWeight);
                if (
                    !Number.isInteger(examWeight) ||
                    !Number.isInteger(activityWeight) ||
                    examWeight < 0 ||
                    activityWeight < 0 ||
                    examWeight > 100 ||
                    activityWeight > 100 ||
                    examWeight + activityWeight !== 100
                ) {
                    showToast(stageMessageFor('SUBJECT_WEIGHT_OUT_OF_RANGE'), 'error');
                    return;
                }
                weightEntries.push({
                    cycleCode,
                    subjectCode,
                    examWeightBps: examWeight * 100,
                    activityWeightBps: activityWeight * 100
                });
            }
        }
        if (!coefficientEntries.length && !examCountEntries.length && !weightEntries.length) return;

        stageSaving = true;
        stageUpdateSaveUi();
        const handle = showToast.loading('جاري حفظ قواعد المرحلة...');
        try {
            const res = await window.api.stageRules.saveAll({
                schoolYear: year,
                coefficientEntries,
                examCountEntries,
                weightEntries,
                reason
            });
            if (!res?.success) {
                stageSaving = false;
                stageUpdateSaveUi();
                stageHandleSaveError(res);
                return;
            }
            stageSaving = false;
            handle.success('تم حفظ قواعد المرحلة — أُنشئت نسخة جديدة');
            await loadStageRules();
        } catch (err) {
            stageSaving = false;
            stageUpdateSaveUi();
            handle.error('حدث خطأ: ' + (err.message || err));
        }
    }

    async function stageConfirmDiscard() {
        if (!Object.keys(stageDirty).length) return true;
        const { confirmed } = await showConfirm({
            title: 'تعديلات غير محفوظة',
            message: 'توجد تعديلات غير محفوظة في قواعد المرحلة. هل تريد المتابعة وتجاهلها؟',
            type: 'warning',
            confirmText: 'تجاهل'
        });
        return confirmed;
    }

    // ─── Tab 3: Restore official defaults (T029) ──────────────────
    async function stageRunReset({ scope, keys, confirm, reason }) {
        if (!window.api?.stageRules?.resetToOfficial) {
            showToast('واجهة قواعد المرحلة غير متاحة', 'error');
            return;
        }
        const year = stageCurrentYear();
        if (!year) return;
        const payload = { schoolYear: year, scope, reason };
        if (keys && keys.length) payload.keys = keys;
        if (confirm) payload.confirm = true;
        stageSaving = true;
        stageUpdateSaveUi();
        const handle = showToast.loading(scope === 'bulk' ? 'جاري استرجاع القيم الرسمية...' : 'جاري استرجاع القيمة الرسمية...');
        try {
            const res = await window.api.stageRules.resetToOfficial(payload);
            if (!res?.success) {
                stageSaving = false;
                stageUpdateSaveUi();
                stageHandleSaveError(res);
                return;
            }
            stageSaving = false;
            handle.success('تمت الاستعادة — أُنشئت نسخة جديدة');
            await loadStageRules();
        } catch (err) {
            stageSaving = false;
            stageUpdateSaveUi();
            handle.error('حدث خطأ: ' + (err.message || err));
        }
    }

    async function stageRestoreRow(key) {
        if (stageSaving || stageLocked) return;
        const keys = stageRestoreKeys[key];
        if (!keys || !keys.length) return;
        if (!(await stageConfirmDiscard())) return;
        const reason = stageValidReason();
        if (!reason) return;
        const subject = String(key).split('|')[2] || '';
        const { confirmed } = await showConfirm({
            title: 'استعادة الافتراضي الرسمي',
            message: `إزالة التخصيص الحالي للمادة «${stageSubjectLabel(subject)}» والرجوع إلى القيمة الرسمية؟`,
            detail: 'ستُنشأ نسخة جديدة تُسجَّل في سجل النشاطات، والنسخة السابقة تبقى مجمّدة.',
            type: 'warning',
            confirmText: 'استعادة'
        });
        if (!confirmed) return;
        await stageRunReset({ scope: 'row', keys, reason });
    }

    async function stageRestoreBulk() {
        if (stageSaving || stageLocked) return;
        const count = stageCustomRowsCount();
        if (!count) return;
        if (!(await stageConfirmDiscard())) return;
        const reason = stageValidReason();
        if (!reason) return;
        const { confirmed } = await showConfirm({
            title: 'استعادة كل القيم الرسمية',
            message: `سيتم استبدال جميع القيم المخصصة (${count}) بالقيم الرسمية لهذه السنة الدراسية.`,
            detail: 'هذا الإجراء لا يمكن التراجع عنه — ستُنشأ نسخة جديدة تُسجَّل في سجل النشاطات، وستُحذف جميع التخصيصات الحالية.',
            type: 'warning',
            confirmText: 'استعادة الكل'
        });
        if (!confirmed) return;
        await stageRunReset({ scope: 'bulk', confirm: true, reason });
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

        document.getElementById('stage-year-select')?.addEventListener('change', async () => {
            if (!(await stageConfirmDiscard())) return;
            await loadStageRules();
        });
        document.getElementById('stage-cycle-select')?.addEventListener('change', async () => {
            if (!(await stageConfirmDiscard())) return;
            await loadStageLevels();
            renderStagePickers();
            renderStageRules();
        });
        document.getElementById('stage-level-select')?.addEventListener('change', async () => {
            if (!(await stageConfirmDiscard())) return;
            renderStagePickers();
            renderStageRules();
        });
        document.getElementById('stage-stream-select')?.addEventListener('change', async () => {
            if (!(await stageConfirmDiscard())) return;
            renderStagePickers();
            renderStageRules();
        });
        document.getElementById('stage-subject-select')?.addEventListener('change', () => {
            renderStageRules();
        });
        document.getElementById('save-stage-rules')?.addEventListener('click', saveStageRules);
        document.getElementById('restore-stage-rules')?.addEventListener('click', stageRestoreBulk);
        document.getElementById('refresh-stage-rules')?.addEventListener('click', async () => {
            if (!(await stageConfirmDiscard())) return;
            await loadStageRules();
        });

        await loadExamLevels();
        await loadExamCounts();
        await loadPageAccess();
        await loadStageCycles();
        initStagePickers();
        await loadStageLevels();
        await loadStageRules();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
