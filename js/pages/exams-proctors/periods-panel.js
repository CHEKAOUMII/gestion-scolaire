/**
 * Exam proctors — Periods sub-panel (WP7 extraction).
 *
 * Owns form state, table render, listeners, and examPeriodsData persistence.
 * Classic script: window.ExamProctorsPeriodsPanel
 *
 * Contract:
 *   await ExamProctorsPeriodsPanel.init(context)
 *   ExamProctorsPeriodsPanel.destroy()
 *   ExamProctorsPeriodsPanel.getPeriods() → array
 *   await ExamProctorsPeriodsPanel.reload()
 *
 * @typedef {object} PeriodsPanelContext
 * @property {() => string} getSchoolYear
 * @property {object} [api] — window.api (examConfig)
 * @property {(msg: string, type?: string) => void} [showToast]
 * @property {(opts: object) => Promise<{confirmed: boolean}>} [showConfirm]
 * @property {(date: string) => string} [formatDateAr]
 * @property {() => void|Promise<void>} [onChanged] — after save/delete/clear
 */
(function (global) {
    'use strict';

    const CONFIG_KEY = 'examPeriodsData';
    const IDS = {
        name: 'period-name',
        dateFrom: 'period-date-from',
        dateTo: 'period-date-to',
        num: 'period-num',
        tbody: 'periods-tbody',
        badge: 'period-count-badge',
        btnSave: 'btn-period-save',
        btnAdd: 'btn-period-add',
        btnCancel: 'btn-period-cancel',
        btnEditMode: 'btn-period-edit-mode',
        btnClearAll: 'btn-periods-clear-all'
    };

    let ctx = null;
    let periodsList = [];
    let periodEditIdx = -1;
    let listeners = [];
    let destroyed = true;

    function el(id) {
        return global.document.getElementById(id);
    }

    function toast(msg, type) {
        if (typeof ctx?.showToast === 'function') ctx.showToast(msg, type);
        else if (typeof global.showToast === 'function') global.showToast(msg, type);
    }

    function confirmDialog(opts) {
        if (typeof ctx?.showConfirm === 'function') return ctx.showConfirm(opts);
        if (typeof global.showConfirm === 'function') return global.showConfirm(opts);
        return Promise.resolve({ confirmed: false });
    }

    function formatDate(value) {
        if (typeof ctx?.formatDateAr === 'function') return ctx.formatDateAr(value);
        if (typeof global.formatDateAr === 'function') return global.formatDateAr(value);
        return value || '';
    }

    function schoolYear() {
        if (typeof ctx?.getSchoolYear === 'function') return ctx.getSchoolYear();
        if (typeof global.getSchoolYear === 'function') return global.getSchoolYear();
        return '';
    }

    function api() {
        return ctx?.api || global.window?.api || global.api;
    }

    function on(id, event, handler) {
        const node = el(id);
        if (!node) return;
        node.addEventListener(event, handler);
        listeners.push({ node, event, handler });
    }

    function clearListeners() {
        listeners.forEach(({ node, event, handler }) => {
            try {
                node.removeEventListener(event, handler);
            } catch (_err) {
                /* ignore */
            }
        });
        listeners = [];
    }

    async function notifyChanged() {
        if (typeof ctx?.onChanged === 'function') {
            await ctx.onChanged({ periods: periodsList.slice() });
        }
    }

    function resetForm() {
        const name = el(IDS.name);
        const dateFrom = el(IDS.dateFrom);
        const dateTo = el(IDS.dateTo);
        const num = el(IDS.num);
        const editMode = el(IDS.btnEditMode);
        const saveBtn = el(IDS.btnSave);
        if (name) name.value = '';
        if (dateFrom) dateFrom.value = '';
        if (dateTo) dateTo.value = '';
        if (num) num.value = periodEditIdx >= 0 ? periodEditIdx + 1 : periodsList.length + 1;
        periodEditIdx = -1;
        if (editMode) editMode.style.display = 'none';
        if (saveBtn) saveBtn.style.display = '';
    }

    function renderTable() {
        const tbody = el(IDS.tbody);
        if (!tbody) return;
        tbody.textContent = '';

        if (!periodsList.length) {
            const tr = global.document.createElement('tr');
            const td = global.document.createElement('td');
            td.colSpan = 5;
            td.style.cssText = 'padding:30px;text-align:center;color:var(--color-text-muted)';
            const icon = global.document.createElement('i');
            icon.className = 'fas fa-info-circle';
            icon.style.marginLeft = '6px';
            td.appendChild(icon);
            td.appendChild(global.document.createTextNode('لم يتم تحديد أي فترة بعد'));
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            periodsList.forEach((p, i) => {
                const tr = global.document.createElement('tr');

                const tdNum = global.document.createElement('td');
                tdNum.textContent = i + 1;
                tr.appendChild(tdNum);

                const tdName = global.document.createElement('td');
                tdName.style.fontWeight = '600';
                tdName.textContent = p.name;
                tr.appendChild(tdName);

                const tdFrom = global.document.createElement('td');
                tdFrom.textContent = formatDate(p.date_from);
                tr.appendChild(tdFrom);

                const tdTo = global.document.createElement('td');
                tdTo.textContent = formatDate(p.date_to);
                tr.appendChild(tdTo);

                const tdActions = global.document.createElement('td');
                tdActions.className = 'no-print';

                const editBtn = global.document.createElement('button');
                editBtn.className = 'sup-del-btn';
                editBtn.title = 'تعديل';
                editBtn.type = 'button';
                editBtn.addEventListener('click', () => editPeriod(i));
                const editIcon = global.document.createElement('i');
                editIcon.className = 'fas fa-edit';
                editBtn.appendChild(editIcon);

                const delBtn = global.document.createElement('button');
                delBtn.className = 'sup-del-btn';
                delBtn.title = 'حذف';
                delBtn.type = 'button';
                delBtn.addEventListener('click', () => {
                    void deletePeriod(i);
                });
                const delIcon = global.document.createElement('i');
                delIcon.className = 'fas fa-times';
                delBtn.appendChild(delIcon);

                tdActions.appendChild(editBtn);
                tdActions.appendChild(global.document.createTextNode(' '));
                tdActions.appendChild(delBtn);
                tr.appendChild(tdActions);

                tbody.appendChild(tr);
            });
        }

        const badge = el(IDS.badge);
        if (badge) badge.textContent = String(periodsList.length);
    }

    function editPeriod(idx) {
        if (idx < 0 || idx >= periodsList.length) return;
        const p = periodsList[idx];
        periodEditIdx = idx;
        const name = el(IDS.name);
        const dateFrom = el(IDS.dateFrom);
        const dateTo = el(IDS.dateTo);
        const num = el(IDS.num);
        const editMode = el(IDS.btnEditMode);
        const saveBtn = el(IDS.btnSave);
        if (name) name.value = p.name;
        if (dateFrom) dateFrom.value = p.date_from;
        if (dateTo) dateTo.value = p.date_to;
        if (num) num.value = idx + 1;
        if (editMode) editMode.style.display = '';
        if (saveBtn) saveBtn.style.display = '';
    }

    async function savePeriod() {
        const name = (el(IDS.name)?.value || '').trim();
        const dateFrom = el(IDS.dateFrom)?.value || '';
        const dateTo = el(IDS.dateTo)?.value || '';

        if (!name) {
            toast('يرجى إدخال اسم الفترة', 'warning');
            return;
        }
        if (!dateFrom || !dateTo) {
            toast('يرجى تحديد تاريخ البداية والنهاية', 'warning');
            return;
        }
        if (dateFrom > dateTo) {
            toast('تاريخ البداية يجب أن يكون قبل تاريخ النهاية', 'warning');
            return;
        }

        const entry = { name, date_from: dateFrom, date_to: dateTo };
        if (periodEditIdx >= 0) {
            periodsList[periodEditIdx] = entry;
            toast('تم تعديل الفترة بنجاح', 'success');
        } else {
            periodsList.push(entry);
            toast('تمت إضافة الفترة بنجاح', 'success');
        }

        const examApi = api()?.examConfig;
        if (examApi?.save) {
            await examApi.save({
                school_year: schoolYear(),
                config_key: CONFIG_KEY,
                data: periodsList
            });
        }

        periodEditIdx = -1;
        resetForm();
        renderTable();
        await notifyChanged();
    }

    async function deletePeriod(idx) {
        if (idx < 0 || idx >= periodsList.length) return;
        const r = await confirmDialog({
            type: 'danger',
            title: 'حذف فترة',
            message: 'حذف "' + periodsList[idx].name + '"؟',
            confirmText: 'حذف'
        });
        if (!r.confirmed) return;

        periodsList.splice(idx, 1);
        const examApi = api()?.examConfig;
        if (examApi?.save) {
            await examApi.save({
                school_year: schoolYear(),
                config_key: CONFIG_KEY,
                data: periodsList
            });
        }
        renderTable();
        resetForm();
        await notifyChanged();
        toast('تم حذف الفترة', 'success');
    }

    async function clearAllPeriods() {
        if (!periodsList.length) {
            toast('لا توجد فترات', 'warning');
            return;
        }
        const r = await confirmDialog({
            type: 'danger',
            title: 'حذف الكل',
            message: 'حذف جميع الفترات (' + periodsList.length + ')؟',
            confirmText: 'حذف الكل'
        });
        if (!r.confirmed) return;

        periodsList = [];
        const examApi = api()?.examConfig;
        if (examApi?.delete) {
            await examApi.delete({ school_year: schoolYear(), config_key: CONFIG_KEY });
        }
        renderTable();
        resetForm();
        await notifyChanged();
        toast('تم حذف جميع الفترات', 'success');
    }

    async function reload() {
        const examApi = api()?.examConfig;
        if (examApi?.get) {
            periodsList = (await examApi.get(schoolYear(), CONFIG_KEY)) || [];
        } else {
            periodsList = [];
        }
        if (!Array.isArray(periodsList)) periodsList = [];
        renderTable();
        resetForm();
        return periodsList.slice();
    }

    /**
     * @param {PeriodsPanelContext} context
     */
    async function init(context) {
        destroy();
        ctx = context || {};
        destroyed = false;

        await reload();

        on(IDS.btnSave, 'click', () => {
            void savePeriod();
        });
        on(IDS.btnAdd, 'click', () => {
            periodEditIdx = -1;
            resetForm();
        });
        on(IDS.btnCancel, 'click', () => {
            periodEditIdx = -1;
            resetForm();
        });
        on(IDS.btnClearAll, 'click', () => {
            void clearAllPeriods();
        });

        return { periods: periodsList.slice() };
    }

    function destroy() {
        clearListeners();
        periodsList = [];
        periodEditIdx = -1;
        ctx = null;
        destroyed = true;
    }

    function getPeriods() {
        return periodsList.slice();
    }

    function isActive() {
        return !destroyed;
    }

    global.ExamProctorsPeriodsPanel = {
        CONFIG_KEY,
        init,
        destroy,
        reload,
        getPeriods,
        isActive
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = global.ExamProctorsPeriodsPanel;
    }
})(typeof window !== 'undefined' ? window : globalThis);
