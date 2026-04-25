/**
 * students-status.js – Page logic for الوضعية الدراسية للتلاميذ
 */
(function () {
    'use strict';

    const STATUS_LABELS = {
        dropout: 'منقطع',
        expelled: 'مفصول',
        not_enrolled: 'غير ملتحق',
        transferred_in: 'وافد',
        active: 'نشط'
    };

    const STATUS_BADGE_CLASS = {
        dropout: 'badge-dropout',
        expelled: 'badge-expelled',
        not_enrolled: 'badge-not_enrolled',
        transferred_in: 'badge-transferred_in',
        active: 'badge-active'
    };

    const GENDER_LABELS = {
        ذكر: 'ذكر',
        أنثى: 'أنثى',
        M: 'ذكر',
        F: 'أنثى',
        male: 'ذكر',
        female: 'أنثى'
    };

    let allRows = [];
    let filteredRows = [];
    let currentTab = 'all';
    let selectedIds = new Set();
    let allClasses = []; // full list of sections for level filtering

    // ── DOM refs ──
    const tbody = document.getElementById('tbody');
    const selectAllCb = document.getElementById('select-all');
    const btnChangeStatus = document.getElementById('btn-change-status');
    const btnExport = document.getElementById('btn-export');
    const searchInput = document.getElementById('search-input');
    const quickSearchInput = document.getElementById('quick-search-input');
    const searchCount = document.getElementById('search-count');
    const levelSelect = document.getElementById('level-select');
    const sectionSelect = document.getElementById('section-select');

    // Stat elements
    const statTotal = document.getElementById('stat-total');
    const statDropout = document.getElementById('stat-dropout');
    const statExpelled = document.getElementById('stat-expelled');
    const statNotEnrolled = document.getElementById('stat-not-enrolled');
    const statTransferredIn = document.getElementById('stat-transferred-in');

    // Tab count elements
    const countAll = document.getElementById('count-all');
    const countDropout = document.getElementById('count-dropout');
    const countExpelled = document.getElementById('count-expelled');
    const countNotEnrolled = document.getElementById('count-not-enrolled');
    const countTransferredIn = document.getElementById('count-transferred-in');

    // Modal refs
    const modalOverlay = document.getElementById('status-modal-overlay');
    const modalClose = document.getElementById('modal-close');
    const modalCancel = document.getElementById('modal-cancel');
    const modalConfirm = document.getElementById('modal-confirm');
    const modalSelectionInfo = document.getElementById('modal-selection-info');
    const newStatusSelect = document.getElementById('new-status');

    // ── Init ──
    document.addEventListener('DOMContentLoaded', async () => {
        await loadSections();
        await loadData();
        bindEvents();
        updatePrintHeader();
    });

    function bindEvents() {
        document.getElementById('search-btn').addEventListener('click', loadData);
        document.getElementById('print-btn').addEventListener('click', () => PrintSystem.preview());

        // Level change → FilterManager handles section cascading, just reload data
        levelSelect.addEventListener('change', () => {
            loadData();
        });

        // Section change → reload
        sectionSelect.addEventListener('change', loadData);

        // Tab clicks
        document.querySelectorAll('.status-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.status-tab').forEach((t) => t.classList.remove('active'));
                tab.classList.add('active');
                currentTab = tab.dataset.status;
                applyFilters();
            });
        });

        // Quick search
        quickSearchInput.addEventListener('input', applyQuickSearch);

        // Select all checkbox
        selectAllCb.addEventListener('change', () => {
            const checked = selectAllCb.checked;
            document.querySelectorAll('.row-checkbox').forEach((cb) => {
                cb.checked = checked;
                toggleSelection(Number(cb.dataset.id), checked);
            });
            updateChangeButton();
        });

        // Change status button
        btnChangeStatus.addEventListener('click', openModal);

        // Export button
        btnExport.addEventListener('click', exportToExcel);

        // Modal events
        modalClose.addEventListener('click', closeModal);
        modalCancel.addEventListener('click', closeModal);
        modalConfirm.addEventListener('click', confirmStatusChange);
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });
    }

    // ── Data loading ──
    let _filterManager = null;

    async function loadSections() {
        try {
            _filterManager = new FilterManager({
                selectors: { level: 'level-select', class: 'section-select' }
            });
            await _filterManager.init();
        } catch (err) {
            console.error('Failed to load sections:', err);
        }
    }

    async function loadData() {
        try {
            const year = getSchoolYear();
            const filters = {
                schoolYear: year,
                section: sectionSelect.value,
                searchTerm: searchInput.value.trim()
            };

            const result = await window.api.students.getByStatus(filters);
            if (!result || !result.success) {
                showToast('فشل تحميل البيانات', 'error');
                return;
            }

            allRows = result.rows || [];

            // Apply level filter on the client side if a level is selected but no specific section
            const selectedLevel = levelSelect.value;
            if (selectedLevel && !sectionSelect.value) {
                allRows = allRows.filter((r) => {
                    const info =
                        typeof getLevelFromSection === 'function'
                            ? getLevelFromSection(r.section)
                            : { name: r.section };
                    return info.name === selectedLevel;
                });
            }

            updateStats({
                total: allRows.length,
                dropouts: allRows.filter((r) => r.status === 'dropout').length,
                expelled: allRows.filter((r) => r.status === 'expelled').length,
                notEnrolled: allRows.filter((r) => r.status === 'not_enrolled').length,
                transferredIn: allRows.filter((r) => r.status === 'transferred_in').length
            });
            updateTabCounts();
            applyFilters();
        } catch (err) {
            console.error('Failed to load data:', err);
            showToast('خطأ في تحميل البيانات', 'error');
        }
    }

    function updateStats(summary) {
        statTotal.textContent = summary.total;
        statDropout.textContent = summary.dropouts;
        statExpelled.textContent = summary.expelled;
        statNotEnrolled.textContent = summary.notEnrolled;
        statTransferredIn.textContent = summary.transferredIn;
    }

    function updateTabCounts() {
        const counts = { all: 0, dropout: 0, expelled: 0, not_enrolled: 0, transferred_in: 0 };
        allRows.forEach((r) => {
            counts.all++;
            if (counts[r.status] !== undefined) counts[r.status]++;
        });
        countAll.textContent = counts.all;
        countDropout.textContent = counts.dropout;
        countExpelled.textContent = counts.expelled;
        countNotEnrolled.textContent = counts.not_enrolled;
        countTransferredIn.textContent = counts.transferred_in;
    }

    // ── Filtering ──
    function applyFilters() {
        if (currentTab === 'all') {
            filteredRows = [...allRows];
        } else {
            filteredRows = allRows.filter((r) => r.status === currentTab);
        }
        applyQuickSearch();
    }

    function applyQuickSearch() {
        const term = quickSearchInput.value.trim().toLowerCase();
        let displayRows = filteredRows;

        if (term) {
            displayRows = filteredRows.filter(
                (r) => (r.full_name || '').toLowerCase().includes(term) || (r.code || '').toLowerCase().includes(term)
            );
        }

        renderTable(displayRows);
        searchCount.textContent = term ? `${displayRows.length} من ${filteredRows.length}` : '';
    }

    // ── Table rendering ──
    function renderTable(rows) {
        selectedIds.clear();
        selectAllCb.checked = false;
        updateChangeButton();

        if (!rows.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9">
                        <div class="empty-state">
                            <i class="fas fa-user-check"></i>
                            <p>لا يوجد تلاميذ في هذه الفئة</p>
                        </div>
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = rows
            .map((r, i) => {
                const gender = GENDER_LABELS[r.gender] || r.gender || '-';
                const statusLabel = STATUS_LABELS[r.status] || r.status;
                const badgeClass = STATUS_BADGE_CLASS[r.status] || '';
                const dateStr = r.status_date || '-';
                const notes = r.status_notes || '-';

                return `<tr>
                <td data-label="تحديد"><input type="checkbox" class="row-checkbox" data-id="${r.id}" ${selectedIds.has(r.id) ? 'checked' : ''}></td>
                <td data-label="#">${i + 1}</td>
                <td data-label="رمز مسار">${r.code || '-'}</td>
                <td data-label="الاسم الكامل">${r.full_name || '-'}</td>
                <td data-label="القسم">${r.section || '-'}</td>
                <td data-label="الجنس">${gender}</td>
                <td data-label="الحالة"><span class="badge ${badgeClass}">${statusLabel}</span></td>
                <td data-label="التاريخ">${dateStr}</td>
                <td data-label="الملاحظات">${notes}</td>
            </tr>`;
            })
            .join('');

        // Bind row checkboxes
        document.querySelectorAll('.row-checkbox').forEach((cb) => {
            cb.addEventListener('change', () => {
                toggleSelection(Number(cb.dataset.id), cb.checked);
                updateChangeButton();
                // Update select-all state
                const allCbs = document.querySelectorAll('.row-checkbox');
                const checkedCbs = document.querySelectorAll('.row-checkbox:checked');
                selectAllCb.checked = allCbs.length > 0 && allCbs.length === checkedCbs.length;
            });
        });
    }

    function toggleSelection(id, isSelected) {
        if (isSelected) {
            selectedIds.add(id);
        } else {
            selectedIds.delete(id);
        }
    }

    function updateChangeButton() {
        btnChangeStatus.disabled = selectedIds.size === 0;
        if (selectedIds.size > 0) {
            btnChangeStatus.innerHTML = `<i class="fas fa-exchange-alt"></i> تغيير الحالة (${selectedIds.size})`;
        } else {
            btnChangeStatus.innerHTML = `<i class="fas fa-exchange-alt"></i> تغيير الحالة`;
        }
    }

    // ── Modal ──
    function openModal() {
        if (selectedIds.size === 0) return;
        modalSelectionInfo.textContent = `سيتم تغيير حالة ${selectedIds.size} تلميذ(ة) محدد(ة)`;
        newStatusSelect.value = 'dropout';
        document.getElementById('status-reason').value = '';
        modalOverlay.classList.add('active');
    }

    function closeModal() {
        modalOverlay.classList.remove('active');
    }

    async function confirmStatusChange() {
        const newStatus = newStatusSelect.value;
        const reason = document.getElementById('status-reason').value.trim();

        if (!newStatus) {
            showToast('الرجاء اختيار الحالة الجديدة', 'error');
            return;
        }

        const items = Array.from(selectedIds).map((id) => ({
            student_id: id,
            status: newStatus
        }));

        try {
            modalConfirm.disabled = true;
            modalConfirm.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحديث...';

            const result = await window.api.students.updateStatusBulk(items);

            if (result && result.success) {
                if (newStatus !== 'active' && typeof window.api.studentMovements?.add === 'function') {
                    for (const item of items) {
                        const student = allRows.find((r) => r.id === item.student_id);
                        if (student) {
                            try {
                                await window.api.studentMovements.add({
                                    massar_code: student.code,
                                    movement_type: newStatus === 'expelled' ? 'expulsion' : newStatus,
                                    movement_date: new Date().toISOString().slice(0, 10),
                                    notes: reason,
                                    school_year: getSchoolYear()
                                });
                            } catch (_) {
                                /* non-critical */
                            }
                        }
                    }
                }

                showToast(`تم تحديث ${result.count} تلميذ(ة) بنجاح`, 'success');
                closeModal();
                await loadData();
            } else {
                showToast(result?.error || 'فشل التحديث', 'error');
            }
        } catch (err) {
            console.error('Status update failed:', err);
            showToast('خطأ في تحديث الحالة', 'error');
        } finally {
            modalConfirm.disabled = false;
            modalConfirm.innerHTML = '<i class="fas fa-check"></i> تأكيد';
        }
    }

    // ── Export ──
    async function exportToExcel() {
        if (!filteredRows.length) {
            showToast('لا توجد بيانات للتصدير', 'error');
            return;
        }

        try {
            if (typeof XLSX === 'undefined') {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'vendor/xlsx.full.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }

            const exportData = filteredRows.map((r, i) => ({
                '#': i + 1,
                'رمز مسار': r.code || '',
                'الاسم الكامل': r.full_name || '',
                القسم: r.section || '',
                الجنس: GENDER_LABELS[r.gender] || r.gender || '',
                الحالة: STATUS_LABELS[r.status] || r.status || '',
                التاريخ: r.status_date || '',
                الملاحظات: r.status_notes || ''
            }));

            const ws = XLSX.utils.json_to_sheet(exportData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'الوضعية الدراسية');

            const tabLabel = currentTab === 'all' ? 'الكل' : STATUS_LABELS[currentTab] || currentTab;
            const fileName = `الوضعية_الدراسية_${tabLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;
            XLSX.writeFile(wb, fileName);

            showToast(`تم تصدير ${exportData.length} سجل`, 'success');
        } catch (err) {
            console.error('Export failed:', err);
            showToast('فشل التصدير', 'error');
        }
    }

    // ── Print ──
    function updatePrintHeader() {
        const dateEl = document.getElementById('print-date');
        if (dateEl) {
            dateEl.textContent = `تاريخ الطباعة: ${new Date().toLocaleDateString('ar-MA')}`;
        }
    }
})();
