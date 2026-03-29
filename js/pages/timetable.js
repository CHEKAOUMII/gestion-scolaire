// Global data
let fetData = {
    teachers: [],
    subjects: [],
    classes: [],
    timetables: {}, // teacher -> { day -> { period -> { hour -> activity } } }
    teacherMetaByKey: {},
    unresolvedTeacherKeys: []
};

function normalizeImportedTeacherEntry(entry) {
    if (typeof entry === 'string') {
        return {
            key: entry,
            name: entry,
            displayName: entry,
            sourceName: entry,
            sourceDisplayName: entry,
            teacherId: null,
            teacherName: entry,
            matchStatus: 'matched'
        };
    }
    const key = String(entry?.key || entry?.name || '').trim();
    return {
        key,
        name: key,
        displayName: String(entry?.displayName || entry?.teacherName || entry?.sourceDisplayName || key).trim(),
        sourceName: String(entry?.sourceName || key).trim(),
        sourceDisplayName: String(entry?.sourceDisplayName || entry?.displayName || key).trim(),
        teacherId: Number(entry?.teacherId) || null,
        teacherName: String(entry?.teacherName || entry?.displayName || key).trim(),
        matchStatus: String(entry?.matchStatus || 'matched')
    };
}

function getTeacherMeta(teacherKey) {
    return normalizeImportedTeacherEntry(
        fetData.teacherMetaByKey?.[teacherKey] ||
            fetData.teachers.find((teacher) => teacher.name === teacherKey) ||
            teacherKey
    );
}

function getTeacherDisplayName(teacherKey) {
    return getTeacherMeta(teacherKey).displayName || teacherKey;
}

function getTeachersArray() {
    return Array.isArray(fetData.teachers) ? fetData.teachers.map(normalizeImportedTeacherEntry) : [];
}

function renderUnresolvedImportWarning() {
    let banner = document.getElementById('tafwij-unresolved-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'tafwij-unresolved-banner';
        banner.className = 'validation-message warning';
        banner.style.display = 'none';
        banner.style.marginBottom = '14px';
        const filterSection = document.getElementById('filter-section');
        filterSection?.parentNode?.insertBefore(banner, filterSection);
    }
    const unresolvedCount = Array.isArray(fetData.unresolvedTeacherKeys) ? fetData.unresolvedTeacherKeys.length : 0;
    if (!unresolvedCount) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'block';

    const icon = document.createElement('i');
    icon.className = 'fas fa-exclamation-triangle';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createTextNode(
        ` تم تحميل الجدول مع ${unresolvedCount} اسم من ملف tafwij لم تتم مطابقته بعد. يمكنك متابعة العمل مؤقتاً، ثم الرجوع إلى `
    );

    const link = document.createElement('a');
    link.href = 'settings-imports.html';
    link.textContent = 'استيراد البيانات';

    const tail = document.createTextNode(' لإكمال المطابقة.');
    banner.replaceChildren(icon, text, link, tail);
}

function setButtonIconLabel(button, iconClass, label) {
    if (!button) return;

    let icon = button.querySelector('i');
    if (!icon) {
        icon = document.createElement('i');
    }
    icon.className = `fas ${iconClass}`;
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createTextNode(` ${label}`);
    button.replaceChildren(icon, text);
}

// Helper: Extract base class name (remove ONLY grouping suffixes like :G1, :G2)
function getBaseClassName(className) {
    if (!className) return '';
    // Remove ONLY grouping patterns: :G1, :G2 (NOT class numbers like -1, -2)
    return className
        .replace(/:[Gg]\d+$/g, '') // Remove :G1, :G2, :g1, :g2 at end
        .trim();
}

// Day mappings for FET format
const dayMappings = {
    lundi_m: { day: 'الاثنين', period: 'morning', index: 0 },
    lundi_s: { day: 'الاثنين', period: 'afternoon', index: 0 },
    Mardi_m: { day: 'الثلاثاء', period: 'morning', index: 1 },
    Mardi_s: { day: 'الثلاثاء', period: 'afternoon', index: 1 },
    Mercredi_m: { day: 'الأربعاء', period: 'morning', index: 2 },
    Mercredi_s: { day: 'الأربعاء', period: 'afternoon', index: 2 },
    Jeudi_m: { day: 'الخميس', period: 'morning', index: 3 },
    Jeudi_s: { day: 'الخميس', period: 'afternoon', index: 3 },
    Vendredi_m: { day: 'الجمعة', period: 'morning', index: 4 },
    Vendredi_s: { day: 'الجمعة', period: 'afternoon', index: 4 },
    Samedi_m: { day: 'السبت', period: 'morning', index: 5 },
    Samedi_s: { day: 'السبت', period: 'afternoon', index: 5 }
};

const arabicDays = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const periods = ['H1', 'H2', 'H3', 'H4'];

// Store original timetables for diff comparison
let originalTimetables = {};
let diffModeActive = false;

// ==================== UX ENHANCEMENTS: NEW FEATURES ====================

// Redo stack for redo functionality
let redoStack = [];
let selectedCells = [];

// ==================== Dark Mode Toggle ====================
// Local theme functions removed in favor of shared ux-enhancements.js

// ==================== Keyboard Shortcuts ====================
function initLocalKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            // Only handle Escape in inputs
            if (e.key === 'Escape') {
                e.target.blur();
                closeAllModals();
            }
            return;
        }

        // Ctrl+P: Print
        if (e.ctrlKey && e.key === 'p') {
            e.preventDefault();
            openTimetablePrintPreview();
        }

        // Ctrl+E: Toggle Edit Mode
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            toggleEditMode();
        }

        // Ctrl+Z: Undo
        if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
            e.preventDefault();
            performUndo();
        }

        // Ctrl+Shift+Z: Redo
        if (e.ctrlKey && e.shiftKey && e.key === 'z') {
            e.preventDefault();
            performRedo();
        }

        // /: Focus search
        if (e.key === '/' && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('unified-search-input')?.focus();
        }

        // ?: Show shortcuts
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            openShortcutsModal();
        }

        // Escape: Close modals
        if (e.key === 'Escape') {
            closeAllModals();
        }

        // Ctrl+K: Quick nav
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            toggleQuickNav();
        }
    });
}

function closeAllModals() {
    closeShortcutsModal();
    document.getElementById('quick-nav-panel')?.classList.remove('open');
    document.getElementById('quick-nav-panel')?.setAttribute('aria-hidden', 'true');
    document.getElementById('quick-nav-toggle')?.classList.remove('active');
    document.getElementById('quick-nav-toggle')?.setAttribute('aria-expanded', 'false');
    document.getElementById('search-results-dropdown')?.classList.remove('active');
    closeEditModal();
    closeChangeLogModal();
}

function openShortcutsModal() {
    const modal = document.getElementById('shortcuts-modal');
    if (window.UXEnhancements?.openDialog) {
        window.UXEnhancements.openDialog(modal, {
            contentSelector: '.shortcuts-content',
            initialFocus: '#shortcuts-close'
        });
        return;
    }

    modal?.classList.add('active');
    modal?.setAttribute('aria-hidden', 'false');
}

function closeShortcutsModal() {
    const modal = document.getElementById('shortcuts-modal');
    if (window.UXEnhancements?.closeDialog) {
        window.UXEnhancements.closeDialog(modal);
        return;
    }

    modal?.classList.remove('active');
    modal?.setAttribute('aria-hidden', 'true');
}

// ==================== Unified Search ====================
function initUnifiedSearch() {
    const searchInput = document.getElementById('unified-search-input');
    const dropdown = document.getElementById('search-results-dropdown');
    const resultLists = [
        document.getElementById('search-teachers-list'),
        document.getElementById('search-classes-list'),
        document.getElementById('search-subjects-list')
    ];

    if (!searchInput || !dropdown) return;

    resultLists.forEach((list) => {
        list?.addEventListener('click', (event) => {
            const trigger = event.target.closest('.search-result-item[data-result-type]');
            if (!trigger) return;
            selectSearchResult(trigger.dataset.resultType, trigger.dataset.resultValue || '');
        });
    });

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (query.length < 1) {
            dropdown.classList.remove('active');
            return;
        }
        performSearch(query);
        dropdown.classList.add('active');
    });

    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length >= 1) {
            dropdown.classList.add('active');
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.unified-search')) {
            dropdown.classList.remove('active');
        }
    });
}

function createListActionItem({ className, type, value, icon, label }) {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.dataset.resultType = type;
    button.dataset.navType = type;
    button.dataset.resultValue = value;
    button.dataset.navValue = value;

    const iconEl = document.createElement('i');
    iconEl.className = `fas ${icon}`;
    iconEl.setAttribute('aria-hidden', 'true');

    const labelEl = document.createElement('span');
    labelEl.textContent = label;

    button.append(iconEl, labelEl);
    return button;
}

function createListEmptyState(message, className) {
    const empty = document.createElement('div');
    empty.className = className;
    empty.style.color = 'var(--text-muted)';
    empty.textContent = message;
    return empty;
}

function renderActionList(container, items, { className, emptyMessage }) {
    if (!container) return;

    if (!items.length) {
        container.replaceChildren(createListEmptyState(emptyMessage, className));
        return;
    }

    container.replaceChildren(
        ...items.map((item) =>
            createListActionItem({
                className,
                type: item.type,
                value: item.value,
                icon: item.icon,
                label: item.label
            })
        )
    );
}

function performSearch(query) {
    const teachersList = document.getElementById('search-teachers-list');
    const classesList = document.getElementById('search-classes-list');
    const subjectsList = document.getElementById('search-subjects-list');

    // Search teachers
    const matchedTeachers = getTeachersArray()
        .filter((t) => (t.displayName || t.sourceDisplayName || '').toLowerCase().includes(query))
        .slice(0, 5);

    renderActionList(
        teachersList,
        matchedTeachers.map((teacher) => ({
            type: 'teacher',
            value: teacher.name || '',
            icon: 'fa-chalkboard-teacher',
            label: teacher.displayName || teacher.sourceDisplayName || teacher.name || ''
        })),
        { className: 'search-result-item', emptyMessage: 'لا توجد نتائج' }
    );

    // Search classes
    const matchedClasses = fetData.classes.filter((c) => c.toLowerCase().includes(query)).slice(0, 5);

    renderActionList(
        classesList,
        matchedClasses.map((className) => ({
            type: 'class',
            value: className,
            icon: 'fa-users',
            label: className
        })),
        { className: 'search-result-item', emptyMessage: 'لا توجد نتائج' }
    );

    // Search subjects
    const matchedSubjects = fetData.subjects.filter((s) => s.toLowerCase().includes(query)).slice(0, 5);

    renderActionList(
        subjectsList,
        matchedSubjects.map((subject) => ({
            type: 'subject',
            value: subject,
            icon: 'fa-book',
            label: subject
        })),
        { className: 'search-result-item', emptyMessage: 'لا توجد نتائج' }
    );

    // Hide empty groups
    document.getElementById('search-teachers-group').style.display = matchedTeachers.length ? 'block' : 'none';
    document.getElementById('search-classes-group').style.display = matchedClasses.length ? 'block' : 'none';
    document.getElementById('search-subjects-group').style.display = matchedSubjects.length ? 'block' : 'none';
}

function selectSearchResult(type, value) {
    document.getElementById('search-results-dropdown')?.classList.remove('active');
    document.getElementById('unified-search-input').value = '';

    if (type === 'teacher') {
        const teacherSelect = document.getElementById('teacher-select');
        if (teacherSelect) {
            teacherSelect.value = value;
            teacherSelect.dispatchEvent(new Event('change'));
        }
    } else if (type === 'class') {
        // Redirect to the dedicated students timetable page
        window.location.href = 'timetable-students.html';
        return;
    } else if (type === 'subject') {
        // Filter by subject
        const subjectFilter = document.getElementById('subject-filter');
        if (subjectFilter) {
            subjectFilter.value = value;
            subjectFilter.dispatchEvent(new Event('change'));
        }
    }

    showToast(`تم اختيار: ${value}`, 'success');
}

// ==================== Quick Navigation Panel ====================
function initLocalQuickNav() {
    const toggle = document.getElementById('quick-nav-toggle');
    const panel = document.getElementById('quick-nav-panel');
    const close = document.getElementById('quick-nav-close');
    const searchInput = document.getElementById('quick-nav-search-input');
    const teachersList = document.getElementById('quick-nav-teachers-list');
    const classesList = document.getElementById('quick-nav-classes-list');

    if (toggle) {
        toggle.addEventListener('click', toggleQuickNav);
    }

    if (close) {
        close.addEventListener('click', () => {
            panel?.classList.remove('open');
            panel?.setAttribute('aria-hidden', 'true');
            toggle?.classList.remove('active');
            toggle?.setAttribute('aria-expanded', 'false');
        });
    }

    [teachersList, classesList].forEach((list) => {
        list?.addEventListener('click', (event) => {
            const trigger = event.target.closest('.quick-nav-item[data-nav-type]');
            if (!trigger) return;
            quickNavSelect(trigger.dataset.navType, trigger.dataset.navValue || '');
        });
    });

    // Tab switching
    document.querySelectorAll('.quick-nav-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.quick-nav-tab').forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');

            const targetList = tab.dataset.navTab;
            document.getElementById('quick-nav-teachers-list').style.display =
                targetList === 'teachers-list' ? 'block' : 'none';
            document.getElementById('quick-nav-classes-list').style.display =
                targetList === 'classes-list' ? 'block' : 'none';
        });
    });

    // Search filter
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterQuickNavList(e.target.value);
        });
    }
}

function toggleQuickNav() {
    const panel = document.getElementById('quick-nav-panel');
    const toggle = document.getElementById('quick-nav-toggle');
    const isOpen = panel?.classList.toggle('open');
    toggle?.classList.toggle('active', isOpen);
    panel?.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    toggle?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    if (isOpen) {
        populateQuickNav();
        document.getElementById('quick-nav-search-input')?.focus();
    }
}

function populateQuickNav() {
    const teachersList = document.getElementById('quick-nav-teachers-list');
    const classesList = document.getElementById('quick-nav-classes-list');

    if (teachersList) {
        renderActionList(
            teachersList,
            getTeachersArray().map((teacher) => ({
                type: 'teacher',
                value: teacher.name || '',
                icon: 'fa-chalkboard-teacher',
                label: teacher.displayName || teacher.sourceDisplayName || teacher.name || ''
            })),
            { className: 'quick-nav-item', emptyMessage: 'لا توجد بيانات' }
        );
    }

    if (classesList) {
        renderActionList(
            classesList,
            fetData.classes.map((className) => ({
                type: 'class',
                value: className,
                icon: 'fa-users',
                label: className
            })),
            { className: 'quick-nav-item', emptyMessage: 'لا توجد بيانات' }
        );
    }
}

function quickNavSelect(type, value) {
    selectSearchResult(type, value);
    document.getElementById('quick-nav-panel')?.classList.remove('open');
    document.getElementById('quick-nav-panel')?.setAttribute('aria-hidden', 'true');
    document.getElementById('quick-nav-toggle')?.classList.remove('active');
    document.getElementById('quick-nav-toggle')?.setAttribute('aria-expanded', 'false');
}

function filterQuickNavList(query) {
    const items = document.querySelectorAll('.quick-nav-item');
    const lowerQuery = query.toLowerCase();
    items.forEach((item) => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(lowerQuery) ? 'flex' : 'none';
    });
}

// ==================== Print Preview ====================
function getCurrentTimetableWrapper() {
    const wrappers = Array.from(document.querySelectorAll('.timetable-wrapper'));
    const visibleWrapper = wrappers.find((wrapper) => {
        if (!wrapper) return false;
        const styles = window.getComputedStyle(wrapper);
        return styles.display !== 'none' && styles.visibility !== 'hidden' && wrapper.offsetParent !== null;
    });

    return visibleWrapper || document.getElementById('timetable-wrapper');
}

function openTimetablePrintPreview() {
    const wrapper = getCurrentTimetableWrapper();
    if (!wrapper) {
        showToast('لا يوجد جدول للمعاينة', 'error');
        return;
    }
    const teacherName = document.getElementById('current-teacher-name')?.textContent?.trim() || '';
    const title = teacherName ? `الجدول الزمني - ${teacherName}` : 'الجدول الزمني';
    electronPrint({ mode: 'preview', title, pageSize: 'A4', landscape: true });
}

// ==================== Multi-Select Cells ====================
function initMultiSelect() {
    // Add click handler for multi-select (Ctrl+Click)
    document.addEventListener('click', (e) => {
        const cell = e.target.closest('.timetable td:not(.day-cell)');
        if (!cell || !editMode) return;

        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            toggleCellSelection(cell);
        }
    });
}

function toggleCellSelection(cell) {
    cell.classList.toggle('multi-selected');
    updateSelectedCellsCount();
}

function updateSelectedCellsCount() {
    const selected = document.querySelectorAll('.timetable td.multi-selected');
    const count = selected.length;
    const toolbar = document.getElementById('multi-select-toolbar');
    const countSpan = document.getElementById('selected-cells-count');

    if (countSpan) countSpan.textContent = count;
    if (toolbar) {
        toolbar.classList.toggle('active', count > 0);
    }
}

function clearSelectedCells() {
    const selected = document.querySelectorAll('.timetable td.multi-selected');
    selected.forEach((cell) => {
        // Clear cell content logic would go here
        cell.classList.remove('multi-selected');
    });
    updateSelectedCellsCount();
    showToast(`تم مسح ${selected.length} خانة`, 'success');
}

function cancelMultiSelect() {
    document.querySelectorAll('.timetable td.multi-selected').forEach((cell) => {
        cell.classList.remove('multi-selected');
    });
    updateSelectedCellsCount();
}

// ==================== Enhanced Undo/Redo ====================
function performUndo() {
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn && !undoBtn.disabled) {
        undoChange();
    }
}

function performRedo() {
    if (redoStack.length > 0) {
        const action = redoStack.pop();
        // Re-apply the action
        changeLog.push(action);
        refreshTimetable();
        updateUndoRedoButtons();
        showToast('تم إعادة التغيير', 'info');
    }
}

function updateUndoRedoButtons() {
    const headerUndoBtn = document.getElementById('header-undo-btn');
    const headerRedoBtn = document.getElementById('header-redo-btn');
    const undoRedoGroup = document.getElementById('header-undo-redo');

    if (editMode && undoRedoGroup) {
        undoRedoGroup.style.display = 'flex';
    }

    if (headerUndoBtn) {
        headerUndoBtn.disabled = changeLog.length === 0;
    }
    if (headerRedoBtn) {
        headerRedoBtn.disabled = redoStack.length === 0;
    }
}

// ==================== Conflict Notifications ====================
function updateConflictBadge() {
    const badge = document.getElementById('conflict-badge');
    const countSpan = document.getElementById('conflict-count');

    // Count room conflicts
    let conflictCount = 0;
    if (typeof roomConflicts !== 'undefined') {
        conflictCount = Object.keys(roomConflicts).reduce((sum, key) => sum + roomConflicts[key].length, 0);
    }

    if (badge && countSpan) {
        countSpan.textContent = conflictCount;
        badge.classList.toggle('no-conflicts', conflictCount === 0);
    }
}

// ==================== Double-Click Quick Edit ====================
function initDoubleClickEdit() {
    document.addEventListener('dblclick', (e) => {
        const cell = e.target.closest('.timetable td:not(.day-cell)');
        if (!cell || !editMode) return;

        // Trigger the existing cell click handler
        cell.click();
    });
}

// ==================== Initialize All UX Enhancements ====================
function initLocalUXEnhancements() {
    initUnifiedSearch();
    initLocalQuickNav();
    initMultiSelect();
    initDoubleClickEdit();
    initLocalKeyboardShortcuts();
    initStaticActionButtons();

    // Page specific undo/redo buttons in header (timetable only)
    document.getElementById('header-undo-btn')?.addEventListener('click', performUndo);
    document.getElementById('header-redo-btn')?.addEventListener('click', performRedo);

    // Re-render timetable on theme change so subject colors adapt
    const themeObserver = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
            if (m.attributeName === 'data-theme') {
                const teacherSelect = document.getElementById('teacher-select');
                if (teacherSelect?.value) {
                    renderTeacherTimetable(teacherSelect.value, document.getElementById('subject-filter')?.value || '');
                }
            }
        });
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    console.log('Timetable local UX initialized');
}

function initStaticActionButtons() {
    document.getElementById('edit-modal-close')?.addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-cancel')?.addEventListener('click', closeEditModal);
    document.getElementById('move-slot-btn')?.addEventListener('click', startMoveMode);
    document.getElementById('edit-modal-confirm')?.addEventListener('click', confirmSlotEdit);
    document.getElementById('changelog-export-csv')?.addEventListener('click', exportChangeLog);
    document.getElementById('changelog-export-json')?.addEventListener('click', exportChangesJSON);
    document.getElementById('changelog-close')?.addEventListener('click', closeChangeLogModal);
    document.getElementById('shortcuts-close')?.addEventListener('click', closeShortcutsModal);
    document.getElementById('multi-select-clear')?.addEventListener('click', clearSelectedCells);
    document.getElementById('multi-select-cancel')?.addEventListener('click', cancelMultiSelect);

    document.getElementById('edit-modal')?.addEventListener('click', (event) => {
        if (event.target.id === 'edit-modal') {
            closeEditModal();
        }
    });

    document.getElementById('changelog-modal')?.addEventListener('click', (event) => {
        if (event.target.id === 'changelog-modal') {
            closeChangeLogModal();
        }
    });

    document.getElementById('shortcuts-modal')?.addEventListener('click', (event) => {
        if (event.target.id === 'shortcuts-modal') {
            closeShortcutsModal();
        }
    });
}

// Global UX Enhancements are auto-initialized by ux-enhancements.js
document.addEventListener('DOMContentLoaded', initLocalUXEnhancements);

// ==================== END UX ENHANCEMENTS ====================

// Build a deep copy of the current timetables for comparison
function buildOriginalTeacherSnapshot(teacherName) {
    if (!fetData.timetables[teacherName]) return;
    originalTimetables[teacherName] = JSON.parse(JSON.stringify(fetData.timetables[teacherName]));
    console.log('Original timetable saved for:', teacherName);
}

// Calculate and display changes diff
function showTeacherChangesDiff(teacherName) {
    const wrapper = document.getElementById('timetable-wrapper');
    const summaryBar = document.getElementById('changes-summary-bar');

    if (!originalTimetables[teacherName]) {
        showToast('لا توجد بيانات أصلية للمقارنة', 'info');
        return;
    }

    const original = originalTimetables[teacherName];
    const current = fetData.timetables[teacherName];

    let addedCount = 0;
    let deletedCount = 0;
    let modifiedCount = 0;

    // Clear previous diff classes
    document.querySelectorAll('.cell-added, .cell-deleted, .cell-modified').forEach((cell) => {
        cell.classList.remove('cell-added', 'cell-deleted', 'cell-modified');
    });

    // Compare each slot
    const rows = document.querySelectorAll('#timetable tbody tr:not(.separator-row)');
    rows.forEach((row) => {
        const periodRaw = row.children[0].textContent.trim();
        const period = periodRaw.replace(/\s*[صم]\s*$/g, '').trim();
        const periodType = periodRaw.includes('ص') ? 'morning' : 'afternoon';

        for (let i = 1; i < row.children.length; i++) {
            const cell = row.children[i];
            const dayIndex = i - 1;
            const day = arabicDays[dayIndex];

            const originalSlot = original[day]?.[periodType]?.[period];
            const currentSlot = current?.[day]?.[periodType]?.[period];

            const hadData = originalSlot && originalSlot.subject;
            const hasData = currentSlot && currentSlot.subject;

            if (!hadData && hasData) {
                // Added
                cell.classList.add('cell-added');
                addedCount++;
            } else if (hadData && !hasData) {
                // Deleted
                cell.classList.add('cell-deleted');
                deletedCount++;
            } else if (hadData && hasData) {
                // Check if modified
                if (
                    originalSlot.subject !== currentSlot.subject ||
                    originalSlot.students !== currentSlot.students ||
                    originalSlot.room !== currentSlot.room
                ) {
                    cell.classList.add('cell-modified');
                    modifiedCount++;
                }
            }
        }
    });

    // Update summary bar
    document.getElementById('changes-added-count').textContent = addedCount;
    document.getElementById('changes-deleted-count').textContent = deletedCount;
    document.getElementById('changes-modified-count').textContent = modifiedCount;

    // Show summary bar if there are changes
    if (addedCount > 0 || deletedCount > 0 || modifiedCount > 0) {
        summaryBar.classList.add('active');
        wrapper.classList.add('diff-mode-active');
        diffModeActive = true;
    } else {
        summaryBar.classList.remove('active');
        wrapper.classList.remove('diff-mode-active');
        diffModeActive = false;
    }
}

// Toggle diff mode display
function toggleTeacherDiffMode() {
    const wrapper = document.getElementById('timetable-wrapper');

    if (diffModeActive) {
        // Hide diff
        wrapper.classList.remove('diff-mode-active');
        document.querySelectorAll('.cell-added, .cell-deleted, .cell-modified').forEach((cell) => {
            cell.classList.remove('cell-added', 'cell-deleted', 'cell-modified');
        });
        diffModeActive = false;
    } else {
        // Show diff
        if (editMode.currentTeacher) {
            showTeacherChangesDiff(editMode.currentTeacher);
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupSidebar();
    loadSavedData(); // Load saved data from localStorage
});

// Save data to localStorage
function saveDataToStorage() {
    try {
        const dataToSave = {
            teachers: getTeachersArray(),
            subjects: fetData.subjects instanceof Set ? Array.from(fetData.subjects) : fetData.subjects,
            classes: fetData.classes instanceof Set ? Array.from(fetData.classes) : fetData.classes,
            timetables: fetData.timetables,
            teacherMetaByKey: fetData.teacherMetaByKey || {},
            unresolvedTeacherKeys: Array.isArray(fetData.unresolvedTeacherKeys) ? fetData.unresolvedTeacherKeys : []
        };
        localStorage.setItem('timetableData', JSON.stringify(dataToSave));
        console.log('Data saved to localStorage');
    } catch (e) {
        console.error('Error saving to localStorage:', e);
    }
}

// Load saved data from localStorage
function loadSavedData() {
    try {
        const savedData = localStorage.getItem('timetableData');
        if (savedData) {
            const parsed = JSON.parse(savedData);
            fetData.teachers = (parsed.teachers || []).map(normalizeImportedTeacherEntry);
            fetData.subjects = new Set(parsed.subjects || []);
            fetData.classes = new Set(parsed.classes || []);
            fetData.timetables = parsed.timetables || {};
            fetData.teacherMetaByKey = parsed.teacherMetaByKey || {};
            fetData.unresolvedTeacherKeys = parsed.unresolvedTeacherKeys || [];

            if (!Object.keys(fetData.teacherMetaByKey).length) {
                fetData.teachers.forEach((teacher) => {
                    fetData.teacherMetaByKey[teacher.name] = teacher;
                });
            }

            // Fix: migrate 'الإثنين' (hamza) to 'الاثنين' (plain alef) in cached data
            Object.keys(fetData.timetables).forEach((teacher) => {
                if (fetData.timetables[teacher]['الإثنين']) {
                    fetData.timetables[teacher]['الاثنين'] = fetData.timetables[teacher]['الإثنين'];
                    delete fetData.timetables[teacher]['الإثنين'];
                }
            });

            if (fetData.teachers.length > 0) {
                updateStats();
                populateTeacherSelect();
                showDataSections();
                renderUnresolvedImportWarning();

                // File info section removed - data loaded from imports page
                setFileStats(`البيانات المحملة: ${fetData.teachers.length} أستاذ`, 'fa-database');

                showToast('تم تحميل البيانات المحفوظة بنجاح', 'success');
                console.log('Data restored from localStorage');
            }
        }
    } catch (e) {
        console.error('Error loading from localStorage:', e);
    }
}

// Clear saved data
function clearSavedData() {
    localStorage.removeItem('timetableData');
    fetData.teacherMetaByKey = {};
    fetData.unresolvedTeacherKeys = [];
    renderUnresolvedImportWarning();
    showToast('تم مسح البيانات المحفوظة', 'info');
}

function setupEventListeners() {
    // Teacher select
    document.getElementById('teacher-select').addEventListener('change', (e) => {
        if (e.target.value) {
            renderTeacherTimetable(e.target.value);
        }
    });

    // Subject filter - filter teachers who teach this subject
    document.getElementById('subject-filter').addEventListener('change', (e) => {
        const selectedSubject = e.target.value;
        const teacherSelect = document.getElementById('teacher-select');

        // Filter teachers based on selected subject
        if (selectedSubject) {
            // Find teachers who teach this subject
            const teachersWithSubject = getTeachersArray().filter((teacher) => {
                const timetable = fetData.timetables[teacher.name];
                if (!timetable) return false;

                // Check all days and periods for this subject
                const _norm = typeof normalizeSubjectName === 'function' ? normalizeSubjectName : (s) => s;
                return Object.values(timetable).some((dayData) => {
                    const morningMatch =
                        dayData.morning &&
                        Object.values(dayData.morning).some((a) => _norm(a.subject) === selectedSubject);
                    const afternoonMatch =
                        dayData.afternoon &&
                        Object.values(dayData.afternoon).some((a) => _norm(a.subject) === selectedSubject);
                    return morningMatch || afternoonMatch;
                });
            });

            // Update teachers dropdown
            setSelectOptions(teacherSelect, teachersWithSubject, {
                placeholder: '-- اختر الأستاذ --',
                getValue: (teacher) => teacher.name,
                getLabel: (teacher) =>
                    teacher.matchStatus === 'matched' || teacher.matchStatus === 'manual'
                        ? teacher.displayName
                        : `${teacher.displayName} (غير محسوم)`
            });

            showToast(`${teachersWithSubject.length} أستاذ يدرسون هذه المادة`, 'info');
        } else {
            // Reset to all teachers
            populateTeacherSelect();
        }

        // If teacher is already selected, update their timetable
        if (teacherSelect.value) {
            renderTeacherTimetable(teacherSelect.value, selectedSubject);
        }
    });

    // Print preview button
    document.getElementById('print-preview-btn')?.addEventListener('click', openTimetablePrintPreview);
}

function setupSidebar() {
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');

    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    document.querySelectorAll('.expandable > a').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const parent = link.parentElement;
            parent.classList.toggle('open');
            const submenu = parent.querySelector('.sub-menu');
            if (submenu) {
                submenu.style.display = parent.classList.contains('open') ? 'block' : 'none';
            }
        });
    });
}

// Handle file upload
function handleFile(file) {
    showToast('جاري معالجة الملف...', 'info');
    console.log('Processing file:', file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(e.target.result, 'text/xml');

            // Check file type based on root element
            const rootElement = xmlDoc.documentElement.tagName;
            console.log('Detected root element:', rootElement);

            if (rootElement === 'Teachers_Timetable') {
                // XML timetable file - parse directly
                console.log('Parsing as Teachers_Timetable XML');
                parseTeachersXML(xmlDoc);
            } else if (rootElement === 'fet') {
                // FET file - extract basic info only
                console.log('Parsing as FET file');
                parseFetFile(xmlDoc);
            } else {
                throw new Error('صيغة غير مدعومة. يرجى استخدام _teachers.xml أو .fet');
            }

            // Update UI
            updateStats();
            populateTeacherSelect();
            showDataSections();

            showToast(`تم تحميل ${fetData.teachers.length} أستاذ`, 'success');

            // Save to localStorage
            saveDataToStorage();

            // Show file info
            // File info section removed - data loaded from imports page
            setFileStats(
                `${fetData.teachers.length} أستاذ | ${fetData.subjects.size || fetData.subjects.length || 0} مادة`,
                'fa-users'
            );
        } catch (error) {
            console.error('Error parsing file:', error);
            showToast('خطأ في المعالجة: ' + error.message, 'error');
        }
    };

    reader.readAsText(file, 'UTF-8');
}

// Parse Teachers_Timetable XML (export from FET)
function parseTeachersXML(xmlDoc) {
    fetData.teachers = [];
    fetData.timetables = {};
    fetData.subjects = new Set();
    fetData.classes = new Set();

    const teachers = xmlDoc.querySelectorAll('Teachers_Timetable > Teacher');
    console.log('Found teachers in XML:', teachers.length);

    teachers.forEach((teacher) => {
        const rawName = teacher.getAttribute('name');
        if (!rawName) return;

        // Clean the tafwij name: remove underscores and trim trailing spaces
        // e.g. "مينة_حمزاوي_" → "مينة حمزاوي"
        const cleanName = rawName.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

        fetData.teachers.push({
            name: cleanName,
            displayName: cleanName
        });

        // Initialize timetable for this teacher (using the clean name as key)
        fetData.timetables[cleanName] = {};

        const days = teacher.querySelectorAll('Day');
        console.log(`Teacher ${cleanName}: found ${days.length} days`);

        days.forEach((day) => {
            const dayName = day.getAttribute('name');
            console.log(`  Day: ${dayName}, mapping exists: ${!!dayMappings[dayName]}`);
            if (!dayName || !dayMappings[dayName]) return;

            const mapping = dayMappings[dayName];
            const arabicDay = mapping.day;
            const periodType = mapping.period;

            if (!fetData.timetables[cleanName][arabicDay]) {
                fetData.timetables[cleanName][arabicDay] = {
                    morning: {},
                    afternoon: {}
                };
            }

            const hours = day.querySelectorAll('Hour');
            hours.forEach((hour) => {
                const hourName = hour.getAttribute('name');
                if (!hourName) return;

                const subject = hour.querySelector('Subject');
                const students = hour.querySelector('Students');
                const room = hour.querySelector('Room');

                if (subject) {
                    const subjectName = (subject.getAttribute('name') || '').replace(/_/g, ' ').trim();
                    const studentsName = students ? students.getAttribute('name') || '' : '';
                    const roomName = room ? room.getAttribute('name') || '' : '';

                    console.log(`    Hour ${hourName} (${periodType}): ${subjectName} - ${studentsName}`);

                    fetData.subjects.add(subjectName);
                    if (studentsName) {
                        const baseClass = getBaseClassName(studentsName);
                        if (baseClass) fetData.classes.add(baseClass);
                    }

                    fetData.timetables[cleanName][arabicDay][periodType][hourName] = {
                        subject: subjectName,
                        students: studentsName,
                        room: roomName
                    };
                }
            });
        });
    });

    console.log('Final timetables object:', fetData.timetables);
    console.log(
        'Teachers:',
        fetData.teachers.map((t) => t.name)
    );
    console.log('Classes found:', fetData.classes.size);

    // Sort teachers alphabetically
    fetData.teachers.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ar'));
}

// Parse FET file - extract activities and timetable from constraints
function parseFetFile(xmlDoc) {
    fetData.teachers = [];
    fetData.timetables = {};
    fetData.subjects = new Set();
    fetData.classes = new Set();

    // Build activities map: activityId -> activity details
    const activitiesMap = {};
    const activities = xmlDoc.querySelectorAll('Activities_List > Activity');
    console.log('Found activities:', activities.length);

    activities.forEach((activity) => {
        const id = activity.querySelector('Id')?.textContent || '';
        const teacher = activity.querySelector('Teacher')?.textContent || '';
        const subject = (activity.querySelector('Subject')?.textContent || '').replace(/_/g, ' ').trim();
        const studentsGroup = activity.querySelector('Students')?.textContent || '';
        const room = activity.querySelector('Room')?.textContent || '';

        if (id && teacher) {
            activitiesMap[id] = {
                teacher: teacher,
                subject: subject,
                students: studentsGroup,
                room: room
            };

            if (subject) fetData.subjects.add(subject);
            if (studentsGroup) {
                const baseClass = getBaseClassName(studentsGroup);
                if (baseClass) fetData.classes.add(baseClass);
            }
        }
    });

    console.log('Activities map built:', Object.keys(activitiesMap).length);

    // Extract teachers
    const teachers = xmlDoc.querySelectorAll('Teachers_List > Teacher');
    teachers.forEach((t) => {
        const name = t.querySelector('Name')?.textContent || '';
        if (name) {
            fetData.teachers.push({
                name: name,
                displayName: name.replace(/_/g, ' ')
            });
            fetData.timetables[name] = {};
        }
    });

    console.log('Teachers found:', fetData.teachers.length);

    // Build day and hour mappings from FET file
    const daysList = [];
    const daysElements = xmlDoc.querySelectorAll('Days_List > Day');
    daysElements.forEach((d) => {
        const name = d.querySelector('Name')?.textContent || '';
        if (name) daysList.push(name);
    });
    console.log('Days from FET:', daysList);

    const hoursList = [];
    const hoursElements = xmlDoc.querySelectorAll('Hours_List > Hour');
    hoursElements.forEach((h) => {
        const name = h.querySelector('Name')?.textContent || '';
        if (name) hoursList.push(name);
    });
    console.log('Hours from FET:', hoursList);

    // Map FET days to Arabic days (flexible mapping)
    const fetDayToArabic = {};
    const dayKeywords = {
        lundi: 'الاثنين',
        monday: 'الاثنين',
        الاثنين: 'الاثنين',
        mardi: 'الثلاثاء',
        tuesday: 'الثلاثاء',
        الثلاثاء: 'الثلاثاء',
        mercredi: 'الأربعاء',
        wednesday: 'الأربعاء',
        الأربعاء: 'الأربعاء',
        jeudi: 'الخميس',
        thursday: 'الخميس',
        الخميس: 'الخميس',
        vendredi: 'الجمعة',
        friday: 'الجمعة',
        الجمعة: 'الجمعة',
        samedi: 'السبت',
        saturday: 'السبت',
        السبت: 'السبت',
        dimanche: 'الأحد',
        sunday: 'الأحد',
        الأحد: 'الأحد'
    };

    daysList.forEach((day, index) => {
        const dayLower = day.toLowerCase();
        // Check if it contains morning/afternoon indicator
        let baseDayName = day;
        let periodType = 'morning';

        if (dayLower.includes('_m') || dayLower.endsWith('_m')) {
            baseDayName = day.replace(/_m$/i, '').replace(/_m/i, '');
            periodType = 'morning';
        } else if (dayLower.includes('_s') || dayLower.endsWith('_s') || dayLower.includes('_a')) {
            baseDayName = day.replace(/_s$/i, '').replace(/_s/i, '').replace(/_a$/i, '');
            periodType = 'afternoon';
        }

        // Find Arabic equivalent
        const baseDayLower = baseDayName.toLowerCase();
        for (const [keyword, arabicDay] of Object.entries(dayKeywords)) {
            if (baseDayLower.includes(keyword)) {
                fetDayToArabic[day] = { arabicDay: arabicDay, period: periodType };
                break;
            }
        }

        // Fallback: use arabic days in order if no mapping found
        if (!fetDayToArabic[day] && index < arabicDays.length) {
            fetDayToArabic[day] = { arabicDay: arabicDays[index % arabicDays.length], period: periodType };
        }
    });

    console.log('Day mappings:', fetDayToArabic);

    // Map hours to periods (H1, H2, H3, H4)
    const fetHourToPeriod = {};
    hoursList.forEach((hour, index) => {
        // Extract hour number
        const hourMatch = hour.match(/H?(\d+)/i);
        if (hourMatch) {
            fetHourToPeriod[hour] = `H${hourMatch[1]}`;
        } else {
            fetHourToPeriod[hour] = `H${(index % 4) + 1}`;
        }
    });
    console.log('Hour mappings:', fetHourToPeriod);

    // Extract timetable from ConstraintActivityPreferredStartingTime
    const constraints = xmlDoc.querySelectorAll('Time_Constraints_List > ConstraintActivityPreferredStartingTime');
    console.log('Found time constraints:', constraints.length);

    // Debug: show first 3 constraints structure
    if (constraints.length > 0) {
        console.log('=== DEBUGGING FIRST 3 CONSTRAINTS ===');
        for (let i = 0; i < Math.min(3, constraints.length); i++) {
            const c = constraints[i];
            console.log(`Constraint ${i}:`, c.outerHTML.substring(0, 500));
        }
    }

    constraints.forEach((constraint, idx) => {
        const activityId = constraint.querySelector('Activity_Id')?.textContent || '';
        const preferredDay = constraint.querySelector('Preferred_Day')?.textContent || '';
        const preferredHour = constraint.querySelector('Preferred_Hour')?.textContent || '';

        // Debug first 5 constraints
        if (idx < 5) {
            console.log(`Constraint ${idx}: activityId=${activityId}, day=${preferredDay}, hour=${preferredHour}`);
            console.log(`  - Activity exists: ${!!activitiesMap[activityId]}`);
            console.log(`  - Day mapping exists: ${!!fetDayToArabic[preferredDay]}`);
            console.log(`  - fetDayToArabic keys:`, Object.keys(fetDayToArabic));
        }

        const activity = activitiesMap[activityId];
        if (!activity || !preferredDay || !preferredHour) return;

        const dayMapping = fetDayToArabic[preferredDay];
        if (!dayMapping) {
            console.log('No mapping for day:', preferredDay);
            return;
        }

        const arabicDay = dayMapping.arabicDay;
        const periodType = dayMapping.period;
        const period = fetHourToPeriod[preferredHour] || preferredHour;

        const teacherName = activity.teacher;

        // Initialize timetable structure if needed
        if (!fetData.timetables[teacherName]) {
            fetData.timetables[teacherName] = {};
        }
        if (!fetData.timetables[teacherName][arabicDay]) {
            fetData.timetables[teacherName][arabicDay] = {
                morning: {},
                afternoon: {}
            };
        }

        // Store the activity
        fetData.timetables[teacherName][arabicDay][periodType][period] = {
            subject: activity.subject,
            students: activity.students,
            room: activity.room
        };

        console.log(`Scheduled: ${teacherName} - ${arabicDay} ${periodType} ${period}: ${activity.subject}`);
    });

    // Count scheduled activities
    let totalScheduled = 0;
    Object.values(fetData.timetables).forEach((teacherData) => {
        Object.values(teacherData).forEach((dayData) => {
            if (dayData.morning) totalScheduled += Object.keys(dayData.morning).length;
            if (dayData.afternoon) totalScheduled += Object.keys(dayData.afternoon).length;
        });
    });

    console.log('Total scheduled activities:', totalScheduled);

    fetData.teachers.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ar'));

    if (totalScheduled === 0) {
        showToast('ملف FET لا يحتوي على جدول زمني. يرجى استخدام ملف _teachers.xml أو تصدير FET مع الجدول.', 'error');
    } else {
        showToast(`تم تحميل ${totalScheduled} حصة بنجاح`, 'success');
    }
}

function updateStats() {
    document.getElementById('teachers-count').textContent = fetData.teachers.length;
    document.getElementById('subjects-count').textContent = fetData.subjects.size || fetData.subjects.length || 0;
    document.getElementById('classes-count').textContent = fetData.classes.size || fetData.classes.length || 0;
    document.getElementById('activities-count').textContent =
        Object.keys(fetData.timetables).length > 0
            ? fetData.unresolvedTeacherKeys?.length
                ? `نشط جزئياً (${fetData.unresolvedTeacherKeys.length})`
                : 'نشط'
            : 'غير محمل';
}

function populateTeacherSelect() {
    const select = document.getElementById('teacher-select');
    setSelectOptions(select, getTeachersArray(), {
        placeholder: '-- اختر الأستاذ --',
        getValue: (teacher) => teacher.name,
        getLabel: (teacher) =>
            teacher.matchStatus === 'matched' || teacher.matchStatus === 'manual'
                ? teacher.displayName
                : `${teacher.displayName} (غير محسوم)`
    });

    // Populate subject filter (unified: normalized, filtered, sorted)
    const subjectFilter = document.getElementById('subject-filter');
    setSelectOptions(subjectFilter, buildSubjectOptionsFromSet(fetData.subjects), {
        placeholder: '-- اختر المادة --',
        getValue: (subject) => subject,
        getLabel: (subject) => subject.replace(/_/g, ' ')
    });
}

function setFileStats(message, iconClass = 'fa-database') {
    const container = document.getElementById('file-stats');
    if (!container) return;

    const icon = document.createElement('i');
    icon.className = `fas ${iconClass}`;
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createTextNode(` ${message}`);
    container.replaceChildren(icon, text);
}

function showDataSections() {
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('stats-row').style.display = 'grid';
    document.getElementById('filter-section').style.display = 'flex';
}

// ==================== COLOR CODING SYSTEM ====================

const colorPalette = window.UXEnhancements?.getSharedSubjectPalette?.() || [];

// Map to store class/subject -> color assignment
const colorMaps = {
    classes: new Map(),
    subjects: new Map()
};

// Detect current theme
function isDarkTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

// Get or assign color for a class/subject (theme-aware)
function getColorFor(type, name) {
    if (!name) return null;

    const map = colorMaps[type];
    if (!map.has(name)) {
        const colorIndex = map.size % colorPalette.length;
        map.set(name, colorIndex);
    }
    const colorIndex = map.get(name);
    const palette = colorPalette[colorIndex];
    return isDarkTheme() ? palette.dark : palette.light;
}

// Reset color maps (call when switching views)
function resetColorMaps() {
    colorMaps.classes.clear();
    colorMaps.subjects.clear();
}

// Generate color legend HTML
function generateColorLegend(type, items) {
    let html = '<div class="color-legend">';
    html += `<div class="legend-title"><i class="fas fa-palette"></i> دليل الألوان:</div>`;
    html += '<div class="legend-items">';

    items.forEach((item) => {
        const color = getColorFor(type, item);
        if (color) {
            html += `
                        <div class="legend-item">
                            <span class="legend-color" style="background: ${color.bg}; border: 2px solid ${color.border};"></span>
                            <span class="legend-name">${item.replace(/_/g, ' ')}</span>
                        </div>
                    `;
        }
    });

    html += '</div></div>';
    return html;
}

function ensureTeacherTimetableHeader(table, allSlots, separatorAfter, getSlotLabel) {
    if (!table) return null;

    let thead = table.tHead;
    if (!thead) {
        thead = table.createTHead();
    }

    if (thead.dataset.built === 'true') {
        return table.querySelector('#timetable-total-hours');
    }

    const row = document.createElement('tr');
    const totalHeader = document.createElement('th');
    totalHeader.className = 'total-header';

    const totalWrap = document.createElement('div');
    totalWrap.style.display = 'flex';
    totalWrap.style.flexDirection = 'column';
    totalWrap.style.alignItems = 'center';
    totalWrap.style.gap = '2px';

    const totalValue = document.createElement('span');
    totalValue.id = 'timetable-total-hours';
    totalValue.style.fontSize = '1.1rem';
    totalWrap.appendChild(totalValue);
    totalHeader.appendChild(totalWrap);
    row.appendChild(totalHeader);

    allSlots.forEach((slot, index) => {
        if (index === separatorAfter) {
            const separator = document.createElement('th');
            separator.style.width = '3px';
            separator.style.padding = '0';
            separator.style.background = 'var(--color-accent, #1e3a6e)';
            row.appendChild(separator);
        }

        const cell = document.createElement('th');
        cell.textContent = getSlotLabel(slot);
        row.appendChild(cell);
    });

    thead.replaceChildren(row);
    thead.dataset.built = 'true';

    if (!table.tBodies.length) {
        table.appendChild(document.createElement('tbody'));
    }

    return totalValue;
}

function renderTeacherFooterLegend(container, teacherClasses) {
    if (!container) return;

    container.replaceChildren();
    if (!teacherClasses.size) return;

    const classesList = Array.from(teacherClasses)
        .sort()
        .map((className) => className.replace(/_/g, ' '))
        .join(' + ');

    const section = document.createElement('div');
    section.className = 'timetable-footer-section';

    const row = document.createElement('div');
    row.className = 'timetable-footer-row';

    const label = document.createElement('span');
    label.className = 'footer-sections-label';
    label.textContent = 'لائحة الأقسام المسندة للأستاذ(ة):';

    const list = document.createElement('span');
    list.className = 'footer-sections-list';
    list.textContent = classesList;

    row.append(label, list);

    const signature = document.createElement('div');
    signature.className = 'footer-signature';
    signature.textContent = 'خاتم و توقيع السيد مدير المؤسسة';

    section.append(row, signature);
    container.appendChild(section);
}

function createSummaryItem(kind, iconClass, text, extraStyle = '') {
    const item = document.createElement('div');
    item.className = `summary-item ${kind}`;
    if (extraStyle) item.style.cssText = extraStyle;

    const icon = document.createElement('i');
    icon.className = `fas ${iconClass}`;

    const label = document.createElement('span');
    label.textContent = text;

    item.append(icon, label);
    return item;
}

function renderChangeLogRows(tbody, rows) {
    if (!tbody) return;

    if (!rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.style.textAlign = 'center';
        td.style.color = 'var(--text-muted)';
        td.textContent = 'لا توجد تغييرات مسجلة';
        tr.appendChild(td);
        tbody.replaceChildren(tr);
        return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach((change) => {
        const tr = document.createElement('tr');
        const typeLabel = change.type === 'add' ? 'إضافة' : change.type === 'edit' ? 'تعديل' : 'حذف';
        const values = [
            new Date(change.savedAt || change.timestamp).toLocaleString('ar-MA'),
            null,
            change.teacher,
            change.newData?.subject || '-',
            change.newData?.students || '-',
            change.day,
            change.period
        ];

        values.forEach((value, index) => {
            const td = document.createElement('td');
            if (index === 1) {
                const badge = document.createElement('span');
                badge.className = `change-type ${change.type}`;
                badge.textContent = typeLabel;
                td.appendChild(badge);
            } else {
                td.textContent = value;
            }
            tr.appendChild(td);
        });

        fragment.appendChild(tr);
    });

    tbody.replaceChildren(fragment);
}

function renderTeacherTimetable(teacherName, subjectFilter = '') {
    const wrapper = document.getElementById('timetable-wrapper');
    const table = document.getElementById('timetable');
    const teacherTimetable = fetData.timetables[teacherName];

    if (!teacherTimetable || Object.keys(teacherTimetable).length === 0) {
        showToast('لا توجد بيانات جدول لهذا الأستاذ. يرجى استخدام ملف _teachers.xml', 'error');
        return;
    }

    resetColorMaps();

    const _normSubj = typeof normalizeSubjectName === 'function' ? normalizeSubjectName : (s) => s;
    const matchesFilter = (activity) => {
        if (!subjectFilter) return true;
        return activity && _normSubj(activity.subject) === subjectFilter;
    };

    const teacherClasses = new Set();
    const teacherSubjects = new Set();

    // Build hour slots: morning H1-H4 then afternoon H1-H4
    const allSlots = [];
    periods.forEach((p) => allSlots.push({ key: p, period: 'morning' }));
    periods.forEach((p) => allSlots.push({ key: p, period: 'afternoon' }));
    const separatorAfter = periods.length;

    // Time labels for each slot
    const morningTimeLabels = ['08:30-09:30', '09:30-10:30', '10:30-11:30', '11:30-12:30'];
    const afternoonTimeLabels = ['14:30-15:30', '15:30-16:30', '16:30-17:30', '17:30-18:30'];
    function getSlotLabel(slot) {
        const labels = slot.period === 'morning' ? morningTimeLabels : afternoonTimeLabels;
        const idx = periods.indexOf(slot.key);
        return labels[idx] || slot.key;
    }

    // Count total hours
    let totalHours = 0;
    arabicDays.forEach((day) => {
        periods.forEach((period) => {
            const m = teacherTimetable[day]?.morning?.[period];
            const a = teacherTimetable[day]?.afternoon?.[period];
            if (m?.subject && matchesFilter(m)) totalHours++;
            if (a?.subject && matchesFilter(a)) totalHours++;
        });
    });

    const totalHoursLabel = ensureTeacherTimetableHeader(table, allSlots, separatorAfter, getSlotLabel);
    if (totalHoursLabel) {
        totalHoursLabel.textContent = `${totalHours} h`;
    }

    let bodyHtml = '';

    // Day rows
    arabicDays.forEach((day) => {
        // Build cells for this day
        const dayCells = allSlots.map((slot) => {
            const activity = teacherTimetable[day]?.[slot.period]?.[slot.key];
            const filtered = activity?.subject && matchesFilter(activity) ? activity : null;
            return {
                period: slot.period,
                hourKey: slot.key,
                activity: filtered,
                skip: false,
                colspan: 1
            };
        });

        // Merge consecutive same-subject+same-students cells within same period
        for (let i = 0; i < dayCells.length - 1; i++) {
            if (i === separatorAfter - 1) continue; // don't merge across separator
            const curr = dayCells[i];
            const next = dayCells[i + 1];
            if (
                curr.activity &&
                next.activity &&
                !curr.skip &&
                curr.activity.subject === next.activity.subject &&
                curr.activity.students === next.activity.students &&
                curr.period === next.period
            ) {
                curr.colspan += next.colspan;
                curr.hourKeyEnd = next.hourKey; // track last merged period key
                next.skip = true;
            }
        }

        // Build row
        bodyHtml += `<tr><td class="day-cell">${day}</td>`;

        dayCells.forEach((cell, i) => {
            // Insert separator column
            if (i === separatorAfter) {
                bodyHtml += '<td style="width:3px; padding:0; background: var(--color-accent); border: none;"></td>';
            }
            if (cell.skip) return;

            // Build data attributes for reliable click identification
            const dataStart = cell.hourKey;
            const dataEnd = cell.hourKeyEnd || cell.hourKey;
            const dataPeriodEnd = dataEnd !== dataStart ? ` data-period-end="${dataEnd}"` : '';
            const dataAttrs = `data-day="${day}" data-period="${dataStart}" data-period-type="${cell.period}"${dataPeriodEnd}`;

            const colspanPart = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
            const mergedClass = cell.colspan > 1 ? ' merged-cell' : '';

            if (cell.activity) {
                const color = getColorFor('classes', cell.activity.students);
                if (cell.activity.students) teacherClasses.add(cell.activity.students);
                teacherSubjects.add(cell.activity.subject);

                const cellStyle = color ? `style="background: ${color.bg};"` : '';
                const classNameStyle = color
                    ? `style="color: ${color.text}; font-weight: 700; font-size: 0.78rem;"`
                    : '';
                const roomStyle = color
                    ? `style="color: ${color.text}; font-weight: 600; font-size: 0.7rem; opacity: 0.7;"`
                    : '';
                const subjectDisplay = cell.activity.subject ? cell.activity.subject.replace(/_/g, ' ') : '';
                const classDisplay = cell.activity.students ? cell.activity.students.replace(/_/g, ' ') : '';

                const subjectStyle = color
                    ? `style="font-size:0.82rem; font-weight:700; color:${color.text}; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"`
                    : `style="font-size:0.82rem; font-weight:700; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"`;

                bodyHtml += `<td class="${mergedClass}"${colspanPart} ${dataAttrs} ${cellStyle}>
                            <div class="activity-cell" style="border-right: none; background: none;">
                                <div class="subject" ${subjectStyle}>${subjectDisplay}</div>
                                ${classDisplay ? `<div class="class" ${classNameStyle}>${classDisplay}</div>` : ''}
                                ${cell.activity.room ? `<div class="room" ${roomStyle}>${cell.activity.room}</div>` : ''}
                            </div>
                        </td>`;
            } else {
                bodyHtml += `<td class="${mergedClass}"${colspanPart} ${dataAttrs}><span class="empty-cell">—</span></td>`;
            }
        });

        bodyHtml += '</tr>';
    });

    const tbody = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
    tbody.innerHTML = bodyHtml;

    // Update UI
    const teacher = fetData.teachers.find((t) => t.name === teacherName);
    document.getElementById('current-teacher-name').textContent =
        teacher?.displayName || teacherName.replace(/_/g, ' ');
    document.getElementById('print-teacher-name').textContent = teacher?.displayName || teacherName.replace(/_/g, ' ');

    wrapper.style.display = 'block';
    document.getElementById('print-preview-btn').style.display = '';

    // Add clean footer after the wrapper
    let legendContainer = document.getElementById('teacher-legend-container');
    if (!legendContainer) {
        legendContainer = document.createElement('div');
        legendContainer.id = 'teacher-legend-container';
        wrapper.after(legendContainer);
    }

    renderTeacherFooterLegend(legendContainer, teacherClasses);
}

// Student timetable moved to timetable-students.html
// Legacy function kept as stub for compatibility
function renderStudentTimetable(className) {
    return;
}

function updateToastOffsets() {
    const root = document.documentElement;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (isMobile) {
        root.style.setProperty('--toast-right-offset', '12px');
        root.style.setProperty('--toast-bottom-offset', '12px');
        return;
    }

    let rightOffset = 24;
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        const rect = sidebar.getBoundingClientRect();
        const isOnScreen = rect.width > 0 && rect.left < window.innerWidth && rect.right > 0;
        const sticksToRight = Math.abs(rect.right - window.innerWidth) <= 2;

        if (isOnScreen && sticksToRight) {
            const visibleSidebarWidth = Math.max(0, Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left));
            if (visibleSidebarWidth > 0 && visibleSidebarWidth < window.innerWidth * 0.6) {
                rightOffset = visibleSidebarWidth + 24;
            }
        }
    }

    root.style.setProperty('--toast-right-offset', `${Math.round(rightOffset)}px`);
    root.style.setProperty('--toast-bottom-offset', '24px');
}

let toastHideTimer = null;
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    updateToastOffsets();

    // Ensure toast is a direct child of body so position:fixed works correctly
    // (backdrop-filter on ancestors creates a new containing block)
    if (toast.parentElement !== document.body) {
        document.body.appendChild(toast);
    }

    const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'info-circle';
    toast.className = 'toast ' + type;

    let toastIcon = toast.querySelector('i');
    let toastText = toast.querySelector('.toast-text');
    if (!toastIcon || !toastText) {
        toastIcon = document.createElement('i');
        toastText = document.createElement('span');
        toastText.className = 'toast-text';
        toast.replaceChildren(toastIcon, toastText);
    }

    toastIcon.className = `fas fa-${icon}`;
    toastText.textContent = String(message || '');

    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}
const timetableShowToast = showToast;
// ==================== EDIT MODE SYSTEM ====================

// Edit mode state
let editMode = {
    active: false,
    currentTeacher: null,
    pendingChanges: [],
    changeHistory: [],
    currentEditSlot: null,
    originalTimetable: null,
    diffModeActive: false,
    moveMode: { active: false }
};

// Initialize edit mode controls when teacher is selected
function initEditControls() {
    const teacherSelect = document.getElementById('teacher-select');
    const editModeBtn = document.getElementById('edit-mode-btn');
    const changelogBtn = document.getElementById('changelog-btn');
    const exportXmlBtn = document.getElementById('export-xml-btn');
    const printBtn = document.getElementById('print-preview-btn');

    if (teacherSelect.value) {
        editModeBtn.style.display = 'flex';
        changelogBtn.style.display = 'flex';
        if (exportXmlBtn) exportXmlBtn.style.display = 'inline-flex';
        if (printBtn) printBtn.style.display = 'flex';
    } else {
        editModeBtn.style.display = 'none';
        changelogBtn.style.display = 'none';
        if (exportXmlBtn) exportXmlBtn.style.display = 'none';
        if (printBtn) printBtn.style.display = 'none';
    }
}

// Toggle edit mode
document.addEventListener('DOMContentLoaded', () => {
    // Timetable has its own #toast element; keep local function but
    // do NOT override window.showToast so the unified notification
    // engine (js/notifications.js) continues to work for IPC-driven toasts.
    updateToastOffsets();
    window.addEventListener('resize', updateToastOffsets);
    document.getElementById('edit-mode-btn')?.addEventListener('click', toggleEditMode);
    document.getElementById('save-changes-btn')?.addEventListener('click', saveAllChanges);
    document.getElementById('cancel-changes-btn')?.addEventListener('click', cancelEditMode);
    document.getElementById('undo-btn')?.addEventListener('click', undoLastChange);
    document.getElementById('changelog-btn')?.addEventListener('click', openChangeLogModal);
    document.getElementById('toggle-diff-btn')?.addEventListener('click', toggleDiffMode);
    document.getElementById('export-xml-btn')?.addEventListener('click', exportTeachersXML);
});

function toggleEditMode() {
    const teacherSelect = document.getElementById('teacher-select');
    if (!teacherSelect.value) {
        showToast('يرجى اختيار أستاذ أولاً', 'error');
        return;
    }

    editMode.active = !editMode.active;
    editMode.currentTeacher = teacherSelect.value;

    const timetableWrapper = document.getElementById('timetable-wrapper');
    const editControls = document.getElementById('edit-controls');
    const editModeBtn = document.getElementById('edit-mode-btn');

    if (editMode.active) {
        timetableWrapper.classList.add('edit-mode-active');
        editControls.classList.add('active');
        setButtonIconLabel(editModeBtn, 'fa-times', 'إلغاء وضع التعديل');
        editModeBtn.classList.remove('btn-warning');
        editModeBtn.classList.add('btn-danger');

        // Save original timetable for diff comparison
        buildOriginalTimetable(editMode.currentTeacher);

        // Add click handlers to cells
        addCellClickHandlers();
        showToast('تم تفعيل وضع التعديل', 'info');
    } else {
        exitEditMode();
    }
}

function exitEditMode() {
    editMode.active = false;
    const timetableWrapper = document.getElementById('timetable-wrapper');
    const editControls = document.getElementById('edit-controls');
    const editModeBtn = document.getElementById('edit-mode-btn');

    timetableWrapper.classList.remove('edit-mode-active');
    editControls.classList.remove('active');
    setButtonIconLabel(editModeBtn, 'fa-edit', 'وضع التعديل');
    editModeBtn.classList.remove('btn-danger');
    editModeBtn.classList.add('btn-warning');

    // Clear slot highlighting
    clearSlotHighlighting();

    // Remove click handlers
    removeCellClickHandlers();
}

function addCellClickHandlers() {
    const cells = document.querySelectorAll('#timetable tbody td');
    cells.forEach((cell) => {
        cell.addEventListener('click', handleCellClick);

        // Skip period header cells
        if (cell.parentElement && cell.parentElement.children[0] === cell) return;

        // Add drag and drop functionality
        cell.setAttribute('draggable', 'true');
        cell.addEventListener('dragstart', handleDragStart);
        cell.addEventListener('dragend', handleDragEnd);
        cell.addEventListener('dragover', handleDragOver);
        cell.addEventListener('drop', handleDrop);
        cell.addEventListener('dragleave', handleDragLeave);

        // Add drag handle icon
        if (!cell.querySelector('.drag-handle')) {
            const handle = document.createElement('i');
            handle.className = 'fas fa-grip-vertical drag-handle';
            handle.title = 'اسحب للنقل';
            cell.appendChild(handle);
        }
    });
}

function removeCellClickHandlers() {
    const cells = document.querySelectorAll('#timetable tbody td');
    cells.forEach((cell) => {
        cell.removeEventListener('click', handleCellClick);

        // Remove drag and drop
        cell.removeAttribute('draggable');
        cell.removeEventListener('dragstart', handleDragStart);
        cell.removeEventListener('dragend', handleDragEnd);
        cell.removeEventListener('dragover', handleDragOver);
        cell.removeEventListener('drop', handleDrop);
        cell.removeEventListener('dragleave', handleDragLeave);

        // Remove drag handle
        const handle = cell.querySelector('.drag-handle');
        if (handle) handle.remove();
    });
}

function handleCellClick(e) {
    if (!editMode.active) return;

    const cell = e.currentTarget;

    // Read identification from data attributes stamped during render
    const day = cell.dataset.day;
    const period = cell.dataset.period;
    const periodType = cell.dataset.periodType;
    const periodEnd = cell.dataset.periodEnd || period;

    if (!day || !period || !periodType) return;

    // === MOVE MODE: destination pick ===
    if (editMode.moveMode && editMode.moveMode.active) {
        // Only allow clicking a green (available) slot
        if (cell.classList.contains('slot-available')) {
            performMoveToDestination(day, period, periodType);
        } else if (cell.classList.contains('slot-occupied')) {
            showToast('هذا المكان غير متاح', 'error');
        } else {
            // Clicking the source or elsewhere cancels
            cancelMoveMode();
        }
        return;
    }

    openEditModal(day, period, periodType, cell, periodEnd);
}

// Open edit modal
function openEditModal(day, period, periodType, cell, periodEnd) {
    periodEnd = periodEnd || period;
    editMode.currentEditSlot = { day, period, periodEnd, periodType, cell };

    const modal = document.getElementById('edit-modal');
    const slotInfo = document.getElementById('edit-slot-info');
    const subjectSelect = document.getElementById('edit-subject');
    const classSelect = document.getElementById('edit-class');
    const deleteCheckbox = document.getElementById('delete-slot');

    const isMerged = periodEnd !== period;
    const periodLabel = isMerged ? `${period}–${periodEnd}` : period;
    slotInfo.value = `${day} - ${periodLabel} ${periodType === 'morning' ? 'صباحاً' : 'مساءً'}`;

    // Populate subjects (unified: normalized, filtered, sorted)
    setSelectOptions(subjectSelect, buildSubjectOptionsFromSet(fetData.subjects), {
        placeholder: '-- اختر المادة --',
        getValue: (subject) => subject,
        getLabel: (subject) => subject
    });

    // Populate classes
    const classes = Array.from(fetData.classes).sort();
    setSelectOptions(classSelect, classes, {
        placeholder: '-- اختر القسم --',
        getValue: (cls) => cls,
        getLabel: (cls) => cls
    });

    // Populate rooms from all timetable data
    const roomSelect = document.getElementById('edit-room');
    const allRooms = new Set();
    Object.values(fetData.timetables).forEach((teacherTT) => {
        Object.values(teacherTT).forEach((dayData) => {
            ['morning', 'afternoon'].forEach((pt) => {
                if (dayData[pt]) {
                    Object.values(dayData[pt]).forEach((act) => {
                        if (act && act.room) allRooms.add(act.room);
                    });
                }
            });
        });
    });
    setSelectOptions(roomSelect, Array.from(allRooms).sort(), {
        placeholder: '-- اختر القاعة --',
        getValue: (room) => room,
        getLabel: (room) => room
    });

    // Get current slot data using the correct periodType
    const timetable = fetData.timetables[editMode.currentTeacher];
    const currentActivity = timetable?.[day]?.[periodType]?.[period];

    if (currentActivity) {
        subjectSelect.value = currentActivity.subject || '';
        classSelect.value = currentActivity.students || '';
        roomSelect.value = currentActivity.room || '';
    } else {
        subjectSelect.value = '';
        classSelect.value = '';
        roomSelect.value = '';
    }

    // Show "نقل الحصة" button only when slot has content
    const moveBtn = document.getElementById('move-slot-btn');
    if (moveBtn) moveBtn.style.display = currentActivity ? 'flex' : 'none';

    deleteCheckbox.checked = false;
    document.getElementById('validation-message').style.display = 'none';

    // Replace listener to avoid duplicates
    const newClassSelect = classSelect.cloneNode(true);
    classSelect.parentNode.replaceChild(newClassSelect, classSelect);
    newClassSelect.value = currentActivity?.students || '';
    newClassSelect.addEventListener('change', function () {
        highlightAvailableSlots(this.value);
    });

    if (window.UXEnhancements?.openDialog) {
        window.UXEnhancements.openDialog(modal, {
            contentSelector: '.edit-modal-content',
            initialFocus: '#edit-modal-close'
        });
    } else {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    }

    // If there's already a class selected, highlight immediately
    if (newClassSelect.value) {
        highlightAvailableSlots(newClassSelect.value);
    }
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    if (window.UXEnhancements?.closeDialog) {
        window.UXEnhancements.closeDialog(modal);
    } else {
        modal?.classList.remove('active');
        modal?.setAttribute('aria-hidden', 'true');
    }

    // Clear all highlighting (unless in move mode — keep destination hints visible)
    if (!editMode.moveMode?.active) {
        clearSlotHighlighting();
    }
}

// ============================================================
// MOVE MODE — two-step: pick source → pick destination
// ============================================================
function startMoveMode() {
    const slot = editMode.currentEditSlot;
    if (!slot) return;

    // Close modal WITHOUT clearing highlights
    if (window.UXEnhancements?.closeDialog) {
        window.UXEnhancements.closeDialog(document.getElementById('edit-modal'));
    } else {
        document.getElementById('edit-modal')?.classList.remove('active');
        document.getElementById('edit-modal')?.setAttribute('aria-hidden', 'true');
    }

    // Store move context
    editMode.moveMode = {
        active: true,
        sourceDay: slot.day,
        sourcePeriod: slot.period,
        sourcePeriodEnd: slot.periodEnd || slot.period,
        sourcePeriodType: slot.periodType,
        sourceData: getSlotData(editMode.currentTeacher, slot.day, slot.period, slot.periodType)
    };

    // Show cancel bar
    let cancelBar = document.getElementById('move-mode-bar');
    if (!cancelBar) {
        cancelBar = document.createElement('div');
        cancelBar.id = 'move-mode-bar';
        cancelBar.style.cssText = [
            'position:fixed',
            'bottom:24px',
            'left:50%',
            'transform:translateX(-50%)',
            'background:var(--color-success-bg)',
            'color:var(--color-text-main)',
            'padding:12px 24px',
            'border-radius:12px',
            'display:flex',
            'align-items:center',
            'gap:12px',
            'z-index:9999',
            'box-shadow:var(--shadow-elevated)',
            'border:1px solid var(--color-success-border)',
            'font-size:0.95rem'
        ].join(';');

        const icon = document.createElement('i');
        icon.className = 'fas fa-arrows-alt';
        icon.style.fontSize = '1.1rem';

        const text = document.createElement('span');
        text.textContent = 'انقر على خلية خضراء لنقل الحصة إليها';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.style.cssText =
            'background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--color-text-main);padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.9rem;';
        cancelButton.addEventListener('click', cancelMoveMode);

        const cancelIcon = document.createElement('i');
        cancelIcon.className = 'fas fa-times';
        cancelButton.append(cancelIcon, document.createTextNode(' إلغاء'));

        cancelBar.replaceChildren(icon, text, cancelButton);
        document.body.appendChild(cancelBar);
    }
    cancelBar.style.display = 'flex';

    // Highlight available destination slots for this class
    if (editMode.moveMode.sourceData?.students) {
        highlightAvailableSlots(editMode.moveMode.sourceData.students);
    }

    showToast('انقر على المكان الجديد أو اضغط إلغاء للتراجع', 'info');
}

function cancelMoveMode() {
    if (editMode.moveMode) editMode.moveMode.active = false;
    const bar = document.getElementById('move-mode-bar');
    if (bar) bar.style.display = 'none';
    clearSlotHighlighting();
    showToast('تم إلغاء وضع النقل', 'info');
}

function performMoveToDestination(destDay, destPeriod, destPeriodType) {
    const mv = editMode.moveMode;
    if (!mv || !mv.sourceData) return;

    // Determine all COVERED periods in the SOURCE
    const srcPeriods = buildPeriodRange(mv.sourcePeriod, mv.sourcePeriodEnd);
    const numPeriods = srcPeriods.length; // 1 or 2

    // Build destination period list: start at destPeriod, need exactly numPeriods consecutive slots
    const destStartIdx = periods.indexOf(destPeriod);
    if (destStartIdx === -1) return;

    const destPeriods = [];
    for (let i = 0; i < numPeriods; i++) {
        const pk = periods[destStartIdx + i];
        if (!pk) break; // ran out of periods (e.g. H4 + 1 doesn't exist)
        destPeriods.push(pk);
    }

    // Strict check: destination must have exactly the same number of periods as source
    if (destPeriods.length !== numPeriods) {
        showToast(`لا يمكن النقل: تحتاج ${numPeriods} خانات متتالية ولا توجد خانات كافية`, 'error');
        return;
    }

    // Validate destination has enough consecutive free slots
    const teacher = editMode.currentTeacher;
    for (const dp of destPeriods) {
        const existing = getSlotData(teacher, destDay, dp, destPeriodType);
        // Allow overwriting if it's a source period being vacated
        const isSource = mv.sourceDay === destDay && srcPeriods.includes(dp) && destPeriodType === mv.sourcePeriodType;
        if (existing && !isSource) {
            showToast(`الوجهة غير متاحة كاملاً (${dp} مشغول)`, 'error');
            return;
        }
    }

    // Ensure data structure
    if (!fetData.timetables[teacher][destDay]) {
        fetData.timetables[teacher][destDay] = { morning: {}, afternoon: {} };
    }

    const groupId = Date.now() + '_' + Math.random().toString(36).slice(2);

    // 1. Clear source periods
    srcPeriods.forEach((sp) => {
        const oldData = getSlotData(teacher, mv.sourceDay, sp, mv.sourcePeriodType);
        editMode.pendingChanges.push({
            teacher,
            day: mv.sourceDay,
            period: sp,
            periodType: mv.sourcePeriodType,
            oldData,
            newData: null,
            timestamp: new Date().toISOString(),
            type: 'delete',
            groupId,
            cell: null
        });
        delete fetData.timetables[teacher][mv.sourceDay][mv.sourcePeriodType][sp];
    });

    // 2. Fill destination periods with source data
    destPeriods.forEach((dp, idx) => {
        const oldData = getSlotData(teacher, destDay, dp, destPeriodType);
        const newData = { ...mv.sourceData };
        editMode.pendingChanges.push({
            teacher,
            day: destDay,
            period: dp,
            periodType: destPeriodType,
            oldData,
            newData,
            timestamp: new Date().toISOString(),
            type: oldData ? 'edit' : 'add',
            groupId,
            cell: null
        });
        fetData.timetables[teacher][destDay][destPeriodType][dp] = newData;
    });

    // Re-render live
    const subjectFilter = document.getElementById('subject-filter')?.value || '';
    renderTeacherTimetable(teacher, subjectFilter);
    if (editMode.active) {
        addCellClickHandlers();
        document.getElementById('timetable-wrapper').classList.add('edit-mode-active');
    }

    updateUndoButton();

    // Exit move mode
    editMode.moveMode = { active: false };
    const bar = document.getElementById('move-mode-bar');
    if (bar) bar.style.display = 'none';
    clearSlotHighlighting();

    const srcLabel =
        mv.sourcePeriodEnd !== mv.sourcePeriod ? `${mv.sourcePeriod}–${mv.sourcePeriodEnd}` : mv.sourcePeriod;
    const destLabel =
        destPeriods.length > 1 ? `${destPeriods[0]}–${destPeriods[destPeriods.length - 1]}` : destPeriods[0];
    showToast(`تم نقل الحصة من ${srcLabel} إلى ${destLabel} بنجاح`, 'success');
}

// ============================================================
// DRAG & DROP HANDLERS — full implementation for merged cells
// ============================================================
let _dragSource = null; // { day, period, periodEnd, periodType, numPeriods }

function handleDragStart(e) {
    if (!editMode.active) {
        e.preventDefault();
        return;
    }
    const cell = e.currentTarget;
    const day = cell.dataset.day;
    const period = cell.dataset.period;
    const periodEnd = cell.dataset.periodEnd || period;
    const periodType = cell.dataset.periodType;
    if (!day || !period || !periodType) {
        e.preventDefault();
        return;
    }

    const srcData = getSlotData(editMode.currentTeacher, day, period, periodType);
    if (!srcData) {
        e.preventDefault();
        return;
    } // don't drag empty cells

    const srcPeriods = buildPeriodRange(period, periodEnd);
    _dragSource = { day, period, periodEnd, periodType, numPeriods: srcPeriods.length, srcData };

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(_dragSource));

    // Hack: Wait for browser to take the drag ghost IMAGE of the native DOM, THEN apply the dimming CSS!
    setTimeout(() => {
        cell.classList.add('drag-source');
    }, 0);

    // Highlight available slots for this class so user sees valid destinations
    if (srcData.students) {
        highlightAvailableSlots(srcData.students);
    }
}

function handleDragEnd(e) {
    document.querySelectorAll('#timetable tbody td').forEach((c) => {
        c.classList.remove('drag-over', 'drag-over-ext', 'drag-source');
    });
    clearSlotHighlighting();
    _dragSource = null;
}

function _getDragOverCells(targetCell) {
    // Returns the DOM cells that will be covered by this drop.
    // Uses data attributes for lookup — immune to merged-cell DOM index shifts.
    if (!_dragSource) return [targetCell];
    const n = _dragSource.numPeriods;
    const day = targetCell.dataset.day;
    const pType = targetCell.dataset.periodType;
    const startPeriod = targetCell.dataset.period;
    if (!day || !pType || !startPeriod) return [targetCell];

    // Build the period key range starting at startPeriod, length n
    const startIdx = periods.indexOf(startPeriod);
    if (startIdx === -1) return [targetCell];

    const result = [];
    for (let i = 0; i < n; i++) {
        const pk = periods[startIdx + i];
        if (!pk) break;
        // Each period key must be in the same periodType
        const c = document.querySelector(
            `#timetable tbody td[data-day="${day}"][data-period="${pk}"][data-period-type="${pType}"]`
        );
        if (!c) break;
        result.push(c);
    }
    return result.length > 0 ? result : [targetCell];
}

function handleDragOver(e) {
    e.preventDefault();
    if (!_dragSource) return;
    e.dataTransfer.dropEffect = 'move';

    // Clear previous highlight
    document
        .querySelectorAll('#timetable tbody td.drag-over, #timetable tbody td.drag-over-ext')
        .forEach((c) => c.classList.remove('drag-over', 'drag-over-ext'));

    const cells = _getDragOverCells(e.currentTarget);
    cells.forEach((c, i) => c.classList.add(i === 0 ? 'drag-over' : 'drag-over-ext'));
}

function handleDrop(e) {
    e.preventDefault();
    document
        .querySelectorAll('#timetable tbody td')
        .forEach((c) => c.classList.remove('drag-over', 'drag-over-ext', 'drag-source'));

    if (!_dragSource) return;

    const destCell = e.currentTarget;
    const destDay = destCell.dataset.day;
    const destPeriod = destCell.dataset.period;
    const destPeriodType = destCell.dataset.periodType;

    if (!destDay || !destPeriod || !destPeriodType) return;

    // Activate move mode context then perform the move
    editMode.moveMode = {
        active: false, // we call performMoveToDestination directly
        sourceDay: _dragSource.day,
        sourcePeriod: _dragSource.period,
        sourcePeriodEnd: _dragSource.periodEnd,
        sourcePeriodType: _dragSource.periodType,
        sourceData: _dragSource.srcData
    };

    performMoveToDestination(destDay, destPeriod, destPeriodType);
    _dragSource = null;
}

function handleDragLeave(e) {
    // Only remove highlight if truly leaving (not entering a child)
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
        e.currentTarget.classList.remove('drag-over', 'drag-over-ext');
    }
}

function buildClassTimetable(className) {
    const classTimetable = {};

    // Initialize structure
    arabicDays.forEach((day) => {
        classTimetable[day] = {
            morning: {},
            afternoon: {}
        };
    });

    // Go through all teachers and find activities for this class
    const teachersList = Object.keys(fetData.timetables);

    for (const teacher of teachersList) {
        const teacherTimetable = fetData.timetables[teacher];

        arabicDays.forEach((day) => {
            if (!teacherTimetable[day]) return;

            // Morning periods
            if (teacherTimetable[day].morning) {
                Object.entries(teacherTimetable[day].morning).forEach(([period, activity]) => {
                    if (activity.students === className) {
                        classTimetable[day].morning[period] = {
                            ...activity,
                            teacher
                        };
                    }
                });
            }

            // Afternoon periods
            if (teacherTimetable[day].afternoon) {
                Object.entries(teacherTimetable[day].afternoon).forEach(([period, activity]) => {
                    if (activity.students === className) {
                        classTimetable[day].afternoon[period] = {
                            ...activity,
                            teacher
                        };
                    }
                });
            }
        });
    }

    return classTimetable;
}

// Check if placing a lesson at a slot would create a gap in the class schedule
function wouldCreateGap(classTimetable, targetDay, targetPeriod, currentDay, currentPeriod) {
    const periods = ['H1', 'H2', 'H3', 'H4'];

    // Build the day's schedule AFTER the potential move
    const daySchedule = periods.map((p) => {
        const periodType = ['H1', 'H2'].includes(p) ? 'morning' : 'afternoon';

        // If this is the target slot, it will be occupied
        if (targetDay === targetDay && p === targetPeriod) return true;

        // If this is the source slot being moved FROM (same day), it will be empty
        if (targetDay === currentDay && p === currentPeriod) return false;

        // Otherwise check current timetable
        return !!classTimetable[targetDay]?.[periodType]?.[p];
    });

    console.log(`Gap check for ${targetDay} ${targetPeriod}:`, daySchedule);

    // Find first and last occupied slots
    let firstOccupied = -1;
    let lastOccupied = -1;

    for (let i = 0; i < periods.length; i++) {
        if (daySchedule[i]) {
            if (firstOccupied === -1) firstOccupied = i;
            lastOccupied = i;
        }
    }

    // If no occupied slots or only one, no gap possible
    if (firstOccupied === -1 || firstOccupied === lastOccupied) return false;

    // Check for gaps between first and last occupied
    for (let i = firstOccupied + 1; i < lastOccupied; i++) {
        if (!daySchedule[i]) {
            console.log(`Gap detected at period ${periods[i]}`);
            return true; // Found a gap
        }
    }

    return false;
}

// Highlight available and occupied slots
function highlightAvailableSlots(className) {
    if (!className) {
        clearSlotHighlighting();
        return;
    }

    const classTimetable = buildClassTimetable(className);
    const { day: currentDay, period: currentPeriod, periodType: currentPeriodType } = editMode.currentEditSlot || {};

    console.log('=== HIGHLIGHT DEBUG ===');
    console.log('Class Name:', className);
    console.log('Teacher:', editMode.currentTeacher);
    console.log('Class Timetable:', classTimetable);
    console.log('Current slot:', currentDay, currentPeriod, currentPeriodType);

    // Layout: days as rows, time-slots as columns
    // col 0 = day name | col 1-4 = morning H1-H4 | col 5 = separator | col 6-9 = afternoon H1-H4
    const separatorCol = periods.length + 1; // = 5

    // Go through all cells in the timetable
    const rows = document.querySelectorAll('#timetable tbody tr');

    rows.forEach((row) => {
        // Skip separator row
        if (row.classList.contains('separator-row')) return;

        // Read the day from the day-name cell (col 0)
        const day = row.children[0].textContent.trim();

        for (let i = 1; i < row.children.length; i++) {
            const cell = row.children[i];

            // Skip separator column
            if (i === separatorCol) continue;

            // Determine period key and type from column index
            let period, periodType;
            if (i <= periods.length) {
                period = periods[i - 1];
                periodType = 'morning';
            } else {
                period = periods[i - separatorCol - 1];
                periodType = 'afternoon';
            }
            if (!period) continue;

            // Remove previous highlighting
            cell.classList.remove('slot-available', 'slot-occupied', 'slot-current', 'slot-gap-warning');

            // Check if this is the current slot being edited
            if (day === currentDay && period === currentPeriod && periodType === currentPeriodType) {
                cell.classList.add('slot-current');
                console.log(`Current slot: ${day} ${period} ${periodType} - Yellow`);
                continue;
            }

            // Check if CLASS has activity at this time
            const classHasActivity = classTimetable[day]?.[periodType]?.[period];

            // Check if TEACHER has activity at this time
            let teacherHasActivity = null;
            if (!(day === currentDay && period === currentPeriod && periodType === currentPeriodType)) {
                teacherHasActivity = getSlotData(editMode.currentTeacher, day, period, periodType);
            }

            if (classHasActivity) {
                // Class is occupied
                cell.classList.add('slot-occupied');
                cell.title = `مشغول: ${classHasActivity.subject} مع ${classHasActivity.teacher}`;
                console.log(`Class occupied: ${day} ${period} ${periodType} - Red`);
            } else if (teacherHasActivity) {
                // Class is free but teacher is occupied
                cell.classList.add('slot-occupied');
                cell.title = `الأستاذ مشغول: ${teacherHasActivity.subject} مع ${teacherHasActivity.students}`;
                console.log(`Teacher occupied: ${day} ${period} ${periodType} - Red`);
            } else {
                // Check if placing here would create a gap
                const createsGap = wouldCreateGap(classTimetable, day, period, currentDay, currentPeriod);

                if (createsGap) {
                    cell.classList.add('slot-occupied');
                    cell.title = 'غير متاح: سيتسبب في فراغ (ساعات غير متتالية)';
                    console.log(`Would create gap: ${day} ${period} ${periodType} - Red`);
                } else {
                    // Both class AND teacher are available, no gap
                    cell.classList.add('slot-available');
                    cell.title = 'متاح للحصة (القسم والأستاذ متاحان)';
                    console.log(`Both available: ${day} ${period} ${periodType} - Green`);
                }
            }
        }
    });
}

// Clear all slot highlighting
function clearSlotHighlighting() {
    document.querySelectorAll('#timetable tbody td').forEach((cell) => {
        cell.classList.remove('slot-available', 'slot-occupied', 'slot-current');
        cell.removeAttribute('title');
    });
}

// Confirm slot edit — applies changes LIVE to fetData then re-renders
function confirmSlotEdit() {
    const subject = document.getElementById('edit-subject').value;
    const className = document.getElementById('edit-class').value;
    const room = document.getElementById('edit-room').value;
    const deleteSlot = document.getElementById('delete-slot').checked;

    const { day, period, cell, periodType } = editMode.currentEditSlot;

    // Validate (including room conflict check)
    const validation = validateChange(day, period, subject, className, deleteSlot, room, periodType);
    if (!validation.valid) {
        showValidationMessage(validation.messages);
        return;
    }
    if (validation.messages.length > 0) {
        showValidationMessage(validation.messages);
    }

    // Determine covered periods (merged cell may span 2)
    const periodStart = period;
    const periodEnd = editMode.currentEditSlot.periodEnd || period;
    const coveredPeriods = buildPeriodRange(periodStart, periodEnd);

    // Group ID so undo can pop the whole merged group together
    const groupId = Date.now() + '_' + Math.random().toString(36).slice(2);

    // Ensure timetable structure exists
    if (!fetData.timetables[editMode.currentTeacher]) {
        fetData.timetables[editMode.currentTeacher] = {};
    }
    if (!fetData.timetables[editMode.currentTeacher][day]) {
        fetData.timetables[editMode.currentTeacher][day] = { morning: {}, afternoon: {} };
    }

    coveredPeriods.forEach((p, idx) => {
        const oldData = getSlotData(editMode.currentTeacher, day, p, periodType);
        const newData = deleteSlot ? null : { subject, students: className, room };

        // Record for undo
        editMode.pendingChanges.push({
            teacher: editMode.currentTeacher,
            day,
            period: p,
            periodType,
            oldData,
            newData,
            timestamp: new Date().toISOString(),
            type: deleteSlot ? 'delete' : oldData ? 'edit' : 'add',
            groupId,
            cell: idx === 0 ? cell : null
        });

        // *** APPLY IMMEDIATELY to fetData ***
        if (deleteSlot || newData === null) {
            delete fetData.timetables[editMode.currentTeacher][day][periodType][p];
        } else {
            fetData.timetables[editMode.currentTeacher][day][periodType][p] = newData;
        }
    });

    // Re-render the timetable so changes appear live
    const subjectFilter = document.getElementById('subject-filter')?.value || '';
    renderTeacherTimetable(editMode.currentTeacher, subjectFilter);

    // Re-attach edit handlers (renderTeacherTimetable rebuilds the DOM)
    if (editMode.active) {
        addCellClickHandlers();
        document.getElementById('timetable-wrapper').classList.add('edit-mode-active');
    }

    updateUndoButton();
    closeEditModal();
    const periodLabel = periodEnd !== periodStart ? `${periodStart}–${periodEnd}` : periodStart;
    showToast(`تم تسجيل التغيير بنجاح (${periodLabel})`, 'success');
}

function getSlotData(teacher, day, period, periodType = null) {
    // If periodType not provided, calculate from period name (for backwards compatibility)
    // But this is only accurate when period names are unique (not H1 morning and H1 afternoon)
    if (!periodType) {
        periodType = ['H1', 'H2'].includes(period) ? 'morning' : 'afternoon';
    }
    return fetData.timetables[teacher]?.[day]?.[periodType]?.[period] || null;
}

function showValidationMessage(messages) {
    const msgDiv = document.getElementById('validation-message');
    msgDiv.className = 'validation-message';

    const hasError = messages.some((m) => m.type === 'error');
    msgDiv.classList.add(hasError ? 'error' : 'warning');

    msgDiv.innerHTML = messages
        .map(
            (m) =>
                `<div><i class="fas fa-${m.type === 'error' ? 'times-circle' : 'exclamation-triangle'}"></i> ${m.message}</div>`
        )
        .join('');
    msgDiv.style.display = 'block';
}

// Check if a room is already occupied at a specific time slot
function isRoomOccupied(room, day, period, periodType, excludeTeacher = null) {
    if (!room || room.trim() === '') return { occupied: false };

    // Check all teachers' timetables
    const teachers = Object.keys(fetData.timetables);

    for (const teacher of teachers) {
        // Skip the current teacher when editing
        if (excludeTeacher && teacher === excludeTeacher) continue;

        const teacherTimetable = fetData.timetables[teacher];
        if (!teacherTimetable || !teacherTimetable[day]) continue;

        const slot = teacherTimetable[day][periodType]?.[period];
        if (slot && slot.room === room) {
            return {
                occupied: true,
                byTeacher: teacher,
                subject: slot.subject,
                students: slot.students
            };
        }
    }

    return { occupied: false };
}

// Validation functions
function validateChange(day, period, subject, className, deleteSlot, room = null, periodType = null) {
    if (deleteSlot) {
        return { valid: true, messages: [] };
    }

    if (!subject || !className) {
        return {
            valid: false,
            messages: [{ type: 'error', message: 'يرجى اختيار المادة والقسم' }]
        };
    }

    const messages = [];

    // Rule 1: No duplicate subject same day
    if (!validateNoDuplicateSubject(className, day, subject)) {
        messages.push({
            type: 'warning',
            message: 'تنبيه: هذه المادة موجودة بالفعل في جدول هذا القسم في نفس اليوم'
        });
    }

    // Rule 2: Room conflict check
    if (room && periodType) {
        const roomCheck = isRoomOccupied(room, day, period, periodType, editMode.currentTeacher);
        if (roomCheck.occupied) {
            messages.push({
                type: 'error',
                message: `تعارض: القاعة ${room} مشغولة من طرف ${roomCheck.byTeacher} (${roomCheck.subject} - ${roomCheck.students})`
            });
        }
    }

    // Rule 3: No gaps (will be checked after all changes)
    const gapWarning = validateNoGapsAfterChange(editMode.currentTeacher, className, day, period, deleteSlot);
    if (gapWarning) {
        messages.push({
            type: 'warning',
            message: gapWarning
        });
    }

    // Rule 4: Max 7 hours per day
    if (!validateMaxHours(className, day, period, deleteSlot)) {
        messages.push({
            type: 'error',
            message: 'خطأ: تجاوز الحد الأقصى للحصص (7 ساعات/يوم)'
        });
        return { valid: false, messages };
    }

    return {
        valid: messages.filter((m) => m.type === 'error').length === 0,
        messages
    };
}

function validateNoDuplicateSubject(className, day, subject) {
    // Check in class timetable for same subject on same day
    // This is simplified - you'd need to build class timetables from teacher data
    const teachersList = Object.keys(fetData.timetables);

    for (const teacher of teachersList) {
        const timetable = fetData.timetables[teacher][day];
        if (!timetable) continue;

        const activities = [
            ...(timetable.morning ? Object.values(timetable.morning) : []),
            ...(timetable.afternoon ? Object.values(timetable.afternoon) : [])
        ];

        const hasDuplicate = activities.some(
            (activity) => activity.students === className && activity.subject === subject
        );

        if (hasDuplicate) return false;
    }

    return true;
}

function validateNoGapsAfterChange(teacher, className, day, period, isDelete) {
    // Simplified gap detection - checks if deleting would create a gap
    if (!isDelete) return null;

    const periodType = ['H1', 'H2'].includes(period) ? 'morning' : 'afternoon';
    const timetable = fetData.timetables[teacher][day];
    if (!timetable) return null;

    const periodsInSlot = periodType === 'morning' ? ['H1', 'H2'] : ['H3', 'H4'];
    const hasOtherPeriods = periodsInSlot.some((p) => p !== period && timetable[periodType]?.[p]);

    if (hasOtherPeriods) {
        return 'تنبيه: قد يتسبب الحذف في فراغ بالجدول';
    }

    return null;
}

function validateMaxHours(className, day, period, isDelete) {
    if (isDelete) return true; // Deleting won't exceed limit

    // Count current hours for this class on this day
    let hourCount = 0;
    const teachersList = Object.keys(fetData.timetables);

    for (const teacher of teachersList) {
        const timetable = fetData.timetables[teacher][day];
        if (!timetable) continue;

        const morningActivities = timetable.morning ? Object.values(timetable.morning) : [];
        const afternoonActivities = timetable.afternoon ? Object.values(timetable.afternoon) : [];

        hourCount += morningActivities.filter((a) => a.students === className).length;
        hourCount += afternoonActivities.filter((a) => a.students === className).length;
    }

    // Adding one more hour
    return hourCount + 1 <= 7;
}

// Undo system
function updateUndoButton() {
    const undoBtn = document.getElementById('undo-btn');
    const undoCount = document.getElementById('undo-count');

    if (editMode.pendingChanges.length > 0) {
        undoBtn.disabled = false;
        undoCount.textContent = editMode.pendingChanges.length;
        undoCount.style.display = 'inline-block';
    } else {
        undoBtn.disabled = true;
        undoCount.style.display = 'none';
    }
}

// Helper: return all period keys between periodStart and periodEnd (inclusive)
function buildPeriodRange(periodStart, periodEnd) {
    const startIdx = periods.indexOf(periodStart);
    const endIdx = periods.indexOf(periodEnd);
    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return [periodStart];
    return periods.slice(startIdx, endIdx + 1);
}

function undoLastChange() {
    if (editMode.pendingChanges.length === 0) return;

    // Pop the last group (all changes sharing the same groupId)
    const last = editMode.pendingChanges[editMode.pendingChanges.length - 1];
    const gid = last.groupId;

    const removed = [];
    while (editMode.pendingChanges.length > 0) {
        const top = editMode.pendingChanges[editMode.pendingChanges.length - 1];
        if (gid && top.groupId === gid) {
            removed.push(editMode.pendingChanges.pop());
        } else {
            break;
        }
    }

    // Revert each change in fetData
    removed.forEach((ch) => {
        if (!fetData.timetables[ch.teacher]?.[ch.day]) return;
        if (ch.oldData) {
            fetData.timetables[ch.teacher][ch.day][ch.periodType][ch.period] = ch.oldData;
        } else {
            delete fetData.timetables[ch.teacher][ch.day][ch.periodType][ch.period];
        }
    });

    // Re-render so the reversion is visible immediately
    const subjectFilter = document.getElementById('subject-filter')?.value || '';
    renderTeacherTimetable(editMode.currentTeacher, subjectFilter);
    if (editMode.active) {
        addCellClickHandlers();
        document.getElementById('timetable-wrapper').classList.add('edit-mode-active');
    }

    updateUndoButton();
    updateUndoRedoButtons();
    showToast('تم التراجع عن آخر تغيير', 'info');
}

function cancelEditMode() {
    if (editMode.pendingChanges.length > 0) {
        if (!confirm('هل تريد إلغاء جميع التعديلات المعلقة؟')) {
            return;
        }
    }

    // Clear all pending changes
    editMode.pendingChanges = [];

    // Remove all modified markers
    document.querySelectorAll('.cell-modified').forEach((cell) => {
        cell.classList.remove('cell-modified');
    });

    exitEditMode();
    showToast('تم إلغاء وضع التعديل', 'info');
}

// Build a copy of the original timetable before editing
function buildOriginalTimetable(teacherName) {
    const teacherTimetable = fetData.timetables[teacherName];
    if (teacherTimetable) {
        // Deep copy the timetable
        editMode.originalTimetable = JSON.parse(JSON.stringify(teacherTimetable));
    }
}

// Toggle diff mode to show changes
function toggleDiffMode() {
    editMode.diffModeActive = !editMode.diffModeActive;

    const timetableWrapper = document.getElementById('timetable-wrapper');
    const diffBtn = document.getElementById('toggle-diff-btn');
    const summaryBar = document.getElementById('changes-summary-bar');

    if (editMode.diffModeActive) {
        timetableWrapper.classList.add('diff-mode-active');
        if (diffBtn) {
            setButtonIconLabel(diffBtn, 'fa-eye-slash', 'إخفاء التغييرات');
            diffBtn.classList.add('active');
        }

        // Show changes summary and highlight cells
        showChangesDiff();
        showToast('تم تفعيل وضع المقارنة', 'info');
    } else {
        timetableWrapper.classList.remove('diff-mode-active');
        if (diffBtn) {
            setButtonIconLabel(diffBtn, 'fa-eye', 'عرض التغييرات');
            diffBtn.classList.remove('active');
        }

        // Hide summary and remove highlighting
        if (summaryBar) summaryBar.classList.remove('active');
        clearDiffHighlighting();
        showToast('تم إلغاء وضع المقارنة', 'info');
    }
}

// Show the differences between original and current timetable
function showChangesDiff() {
    if (!editMode.originalTimetable || !editMode.currentTeacher) return;

    const currentTimetable = fetData.timetables[editMode.currentTeacher];
    const original = editMode.originalTimetable;

    let addedCount = 0;
    let deletedCount = 0;
    let modifiedCount = 0;

    // Clear previous highlighting
    clearDiffHighlighting();

    // Get all table cells
    const tbody = document.getElementById('timetable-body');
    if (!tbody) return;

    const rows = tbody.querySelectorAll('tr:not(.separator-row)');

    rows.forEach((row) => {
        const periodCell = row.children[0];
        if (!periodCell) return;

        const periodRaw = periodCell.textContent.trim();
        const period = periodRaw.replace(/\s*[صم]\s*$/g, '').trim();
        const periodType = periodRaw.includes('ص') ? 'morning' : 'afternoon';

        for (let i = 1; i < row.children.length; i++) {
            const cell = row.children[i];
            const day = arabicDays[i - 1];

            const originalSlot = original[day]?.[periodType]?.[period];
            const currentSlot = currentTimetable[day]?.[periodType]?.[period];

            // Check for changes
            const wasEmpty = !originalSlot || !originalSlot.subject;
            const isNowEmpty = !currentSlot || !currentSlot.subject;

            if (wasEmpty && !isNowEmpty) {
                // Added
                cell.classList.add('cell-added');
                addedCount++;
            } else if (!wasEmpty && isNowEmpty) {
                // Deleted
                cell.classList.add('cell-deleted');
                deletedCount++;
            } else if (!wasEmpty && !isNowEmpty) {
                // Check if modified
                if (
                    originalSlot.subject !== currentSlot.subject ||
                    originalSlot.students !== currentSlot.students ||
                    originalSlot.room !== currentSlot.room
                ) {
                    cell.classList.add('cell-modified');
                    modifiedCount++;
                }
            }
        }
    });

    // Update summary bar
    updateChangesSummary(addedCount, deletedCount, modifiedCount);
}

// Update the changes summary bar
function updateChangesSummary(added, deleted, modified) {
    let summaryBar = document.getElementById('changes-summary-bar');

    // Create summary bar if it doesn't exist
    if (!summaryBar) {
        const filterSection = document.getElementById('filter-section');
        if (filterSection) {
            summaryBar = document.createElement('div');
            summaryBar.id = 'changes-summary-bar';
            summaryBar.className = 'changes-summary-bar';
            filterSection.after(summaryBar);
        }
    }

    if (summaryBar) {
        const title = document.createElement('div');
        title.className = 'summary-title';
        title.style.fontWeight = '600';
        title.style.color = 'var(--text)';

        const titleIcon = document.createElement('i');
        titleIcon.className = 'fas fa-chart-bar';
        title.append(titleIcon, document.createTextNode(' ملخص التغييرات:'));

        summaryBar.replaceChildren(
            title,
            createSummaryItem('added', 'fa-plus-circle', `${added} إضافة`),
            createSummaryItem('modified', 'fa-edit', `${modified} تعديل`, 'background: var(--color-warning-bg);'),
            createSummaryItem('deleted', 'fa-minus-circle', `${deleted} حذف`)
        );
        summaryBar.classList.add('active');
    }
}

// Clear diff highlighting
function clearDiffHighlighting() {
    document.querySelectorAll('.cell-added, .cell-deleted, .cell-modified').forEach((cell) => {
        cell.classList.remove('cell-added', 'cell-deleted', 'cell-modified');
    });
}

// Save all changes — data already applied live; just persist to storage and exit
function saveAllChanges() {
    if (editMode.pendingChanges.length === 0) {
        showToast('لا توجد تغييرات معلقة', 'info');
        return;
    }

    // Move pending changes to permanent history
    const savedAt = new Date().toISOString();
    editMode.pendingChanges.forEach((change) => {
        editMode.changeHistory.push({ ...change, savedAt });
    });
    const savedCount = editMode.pendingChanges.length;

    // Persist to localStorage
    saveDataToStorage();

    // Clear pending changes
    editMode.pendingChanges = [];
    updateUndoButton();

    exitEditMode();
    showToast(`تم حفظ ${savedCount} تغيير بنجاح`, 'success');
}

// Change log
function openChangeLogModal() {
    const modal = document.getElementById('changelog-modal');
    const tbody = document.getElementById('changelog-body');
    renderChangeLogRows(tbody, [...editMode.changeHistory].reverse());

    if (window.UXEnhancements?.openDialog) {
        window.UXEnhancements.openDialog(modal, {
            contentSelector: '.changelog-content',
            initialFocus: '#changelog-close'
        });
    } else {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    }
}

function closeChangeLogModal() {
    const modal = document.getElementById('changelog-modal');
    if (window.UXEnhancements?.closeDialog) {
        window.UXEnhancements.closeDialog(modal);
        return;
    }

    modal?.classList.remove('active');
    modal?.setAttribute('aria-hidden', 'true');
}

function exportChangeLog() {
    if (editMode.changeHistory.length === 0) {
        showToast('لا توجد تغييرات للتصدير', 'info');
        return;
    }

    // Create CSV content
    const headers = ['التاريخ والوقت', 'النوع', 'الأستاذ', 'المادة', 'القسم', 'اليوم', 'الحصة'];
    const rows = editMode.changeHistory.map((change) => [
        new Date(change.savedAt || change.timestamp).toLocaleString('ar-MA'),
        change.type === 'add' ? 'إضافة' : change.type === 'edit' ? 'تعديل' : 'حذف',
        change.teacher,
        change.newData?.subject || '-',
        change.newData?.students || '-',
        change.day,
        change.period
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    // Download
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `سجل_التغييرات_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    showToast('تم تصدير سجل التغييرات', 'success');
}

// Export changes as JSON (for sharing/backup)
function exportChangesJSON() {
    if (editMode.changeHistory.length === 0 && editMode.pendingChanges.length === 0) {
        showToast('لا توجد تغييرات للتصدير', 'info');
        return;
    }

    const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        pendingChanges: editMode.pendingChanges,
        changeHistory: editMode.changeHistory
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `تغييرات_الجدول_${new Date().toISOString().split('T')[0]}.json`;
    link.click();

    showToast('تم تصدير التغييرات كملف JSON', 'success');
}

// Import changes from JSON file
function importChangesJSON(file) {
    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            if (!data.version || !data.changeHistory) {
                showToast('ملف غير صالح', 'error');
                return;
            }

            // Ask user what to do
            const action = confirm(
                'كيف تريد الاستيراد؟\n- موافق: دمج مع التغييرات الحالية\n- إلغاء: استبدال التغييرات الحالية'
            );

            if (action) {
                // Merge
                editMode.changeHistory = [...editMode.changeHistory, ...data.changeHistory];
                if (data.pendingChanges) {
                    editMode.pendingChanges = [...editMode.pendingChanges, ...data.pendingChanges];
                }
                showToast(`تم دمج ${data.changeHistory.length} تغيير`, 'success');
            } else {
                // Replace
                editMode.changeHistory = data.changeHistory;
                editMode.pendingChanges = data.pendingChanges || [];
                showToast(`تم استيراد ${data.changeHistory.length} تغيير`, 'success');
            }

            // Apply changes to fetData
            data.changeHistory.forEach((change) => {
                const { teacher, day, period, periodType, newData } = change;

                if (!fetData.timetables[teacher]) {
                    fetData.timetables[teacher] = {};
                }
                if (!fetData.timetables[teacher][day]) {
                    fetData.timetables[teacher][day] = { morning: {}, afternoon: {} };
                }

                if (newData === null) {
                    delete fetData.timetables[teacher][day][periodType][period];
                } else {
                    fetData.timetables[teacher][day][periodType][period] = newData;
                }
            });

            // Save to localStorage
            saveDataToStorage();

            // Refresh view
            const teacherSelect = document.getElementById('teacher-select');
            if (teacherSelect.value) {
                renderTeacherTimetable(teacherSelect.value);
            }
        } catch (error) {
            console.error('Import error:', error);
            showToast('خطأ في استيراد الملف', 'error');
        }
    };

    reader.readAsText(file);
}

// Update the teacher select listener to show edit controls
const origTeacherSelectListener = document.getElementById('teacher-select')?.addEventListener;
if (document.getElementById('teacher-select')) {
    document.getElementById('teacher-select').addEventListener('change', (e) => {
        initEditControls();
    });
}

// ==================== EXPORT TEACHERS XML ====================
/**
 * Reconstruct and download a teachers.xml file from the current
 * in-memory timetable data (fetData.timetables), preserving the
 * exact format used by the original tafwij XML files.
 *
 * Format per hour (if occupied):
 *   <Hour name="H1">
 *     <Activity id="..."></Activity>   (if activityId stored)
 *     <Subject name="..."></Subject>
 *     <Students name="..."></Students>
 *     <Room name="..."></Room>
 *   </Hour>
 * Empty hours are output as self-contained <Hour name="H1"></Hour>.
 */
function exportTeachersXML() {
    const timetables = fetData.timetables;
    const teacherKeys = Object.keys(timetables);

    if (!teacherKeys.length) {
        showToast('لا توجد بيانات لتصديرها', 'error');
        return;
    }

    // Ordered list of XML Day keys (same order as original files)
    const xmlDayKeys = [
        'lundi_m',
        'lundi_s',
        'Mardi_m',
        'Mardi_s',
        'Mercredi_m',
        'Mercredi_s',
        'Jeudi_m',
        'Jeudi_s',
        'Vendredi_m',
        'Vendredi_s',
        'Samedi_m',
        'Samedi_s'
    ];

    const xmlHourKeys = ['H1', 'H2', 'H3', 'H4'];

    // Escape XML attribute values
    function escXml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Convert display name back to underscore format for XML attribute
    // e.g. "نور الدين السعيدي" → "نور_الدين_السعيدي_"
    // The original XML had trailing underscore; we preserve it only when
    // the original key (sourceName) is available in teacherMetaByKey.
    function teacherKeyToXmlName(teacherKey) {
        const meta = fetData.teacherMetaByKey?.[teacherKey];
        // Use sourceName if it has underscores (original format)
        if (meta?.sourceName && meta.sourceName.includes('_')) {
            return meta.sourceName;
        }
        // Fallback: replace spaces with underscores + trailing underscore
        return teacherKey.replace(/ /g, '_') + '_';
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<Teachers_Timetable>\n';

    teacherKeys.forEach((teacherKey) => {
        const xmlName = escXml(teacherKeyToXmlName(teacherKey));
        xml += `  <Teacher name="${xmlName}">\n`;

        xmlDayKeys.forEach((dayKey) => {
            const mapping = dayMappings[dayKey];
            if (!mapping) return;

            const arabicDay = mapping.day;
            const periodType = mapping.period;

            xml += `    <Day name="${dayKey}">\n`;

            xmlHourKeys.forEach((hourKey) => {
                const slot = timetables[teacherKey]?.[arabicDay]?.[periodType]?.[hourKey];

                if (slot && slot.subject) {
                    xml += `      <Hour name="${hourKey}">\n`;

                    // Activity id (preserved if stored, otherwise omit)
                    if (slot.activityId) {
                        xml += `        <Activity id="${escXml(String(slot.activityId))}"></Activity>\n`;
                    }

                    // Subject (convert spaces back to underscores for XML)
                    const subjectXml = escXml(slot.subject.replace(/ /g, '_'));
                    xml += `        <Subject name="${subjectXml}"></Subject>\n`;

                    // Activity tags (preserved if stored)
                    if (Array.isArray(slot.tags)) {
                        slot.tags.forEach((tag) => {
                            xml += `        <Activity_Tag name="${escXml(tag)}"></Activity_Tag>\n`;
                        });
                    }

                    // Students
                    if (slot.students) {
                        xml += `        <Students name="${escXml(slot.students)}"></Students>\n`;
                    }

                    // Room
                    if (slot.room) {
                        xml += `        <Room name="${escXml(slot.room)}"></Room>\n`;
                    }

                    xml += `      </Hour>\n`;
                } else {
                    // Empty slot
                    xml += `      <Hour name="${hourKey}">\n`;
                    xml += `      </Hour>\n`;
                }
            });

            xml += `    </Day>\n`;
        });

        xml += `  </Teacher>\n`;
    });

    xml += '</Teachers_Timetable>\n';

    // Download the file
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Generate filename with today's date
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.download = `teachers_export_${today}.xml`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }, 500);

    showToast(`تم تصدير ${teacherKeys.length} أستاذ بنجاح`, 'success');
}
// ==================== END EXPORT TEACHERS XML ====================
