// Initialize app - Electron + SQLite version
document.addEventListener('DOMContentLoaded', () => {
    // Setup sidebar first
    if (typeof setupSidebar === 'function') {
        setupSidebar();
    }

    // School year change handler
    const schoolYearEl = document.getElementById('school-year');
    if (schoolYearEl) {
        schoolYearEl.addEventListener('change', async (e) => {
            const selectedYear = e.target.value;

            if (selectedYear === 'new') {
                // إضافة موسم جديد
                const newYear = prompt('أدخل الموسم الدراسي الجديد (مثال: 2024/2025):');
                if (newYear && newYear.match(/^\d{4}\/\d{4}$/)) {
                    saveNewSchoolYear(newYear);
                    currentSchoolYear = newYear;
                    await initDatabase(newYear);
                    showToast('تم إضافة الموسم ' + newYear, 'success');
                } else if (newYear) {
                    showToast('صيغة غير صحيحة. استخدم: 2024/2025', 'error');
                    e.target.value = currentSchoolYear;
                } else {
                    e.target.value = currentSchoolYear;
                }
            } else {
                // التبديل إلى موسم موجود
                currentSchoolYear = selectedYear;
                await initDatabase(selectedYear);
                showToast('تم تحميل بيانات الموسم ' + selectedYear, 'success');
            }
        });
    }
});

// Backup button handler
function formatBackupDate(value) {
    if (!value) return 'لا توجد نسخة مسجلة بعد';
    try {
        return new Intl.DateTimeFormat('ar-MA', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(new Date(value));
    } catch {
        return value;
    }
}

function updateBackupModalSummary(selectedFile) {
    const lastRunEl = document.getElementById('backup-last-run');
    const lastSizeEl = document.getElementById('backup-last-size');
    const lastContentsEl = document.getElementById('backup-last-contents');
    const fileSummary = document.getElementById('backup-file-summary');
    const fileNameEl = document.getElementById('backup-file-name');
    const fileMetaEl = document.getElementById('backup-file-meta');

    const settings = typeof BackupManager?.getSettings === 'function' ? BackupManager.getSettings() : null;
    const history = typeof BackupManager?.getHistory === 'function' ? BackupManager.getHistory() : [];
    const latest = history[0] || null;

    if (lastRunEl) {
        lastRunEl.textContent = formatBackupDate(latest?.date || settings?.lastBackup || null);
    }

    if (lastSizeEl) {
        lastSizeEl.textContent = latest?.size ? BackupManager.formatSize(latest.size) : 'غير متوفر بعد';
    }

    if (lastContentsEl) {
        const hasHistory = Boolean(latest);
        lastContentsEl.textContent = hasHistory
            ? `${latest.itemsCount || 0} عنصر محفوظ${latest.size ? ' - جاهز للتنزيل' : ''}`
            : 'إعدادات محلية وقاعدة البيانات عند توفرها';
    }

    if (fileSummary && fileNameEl && fileMetaEl) {
        if (selectedFile) {
            fileSummary.classList.remove('hidden');
            fileNameEl.textContent = selectedFile.name;
            const sizeLabel =
                typeof BackupManager?.formatSize === 'function' ? BackupManager.formatSize(selectedFile.size) : '';
            fileMetaEl.textContent = `${sizeLabel} - ${selectedFile.type || 'ملف نسخ احتياطي'}`;
        } else {
            fileSummary.classList.add('hidden');
            fileNameEl.textContent = '—';
            fileMetaEl.textContent = 'JSON / BAK حتى 500MB';
        }
    }
}

function setBackupButtonState(button, loadingText) {
    if (!button) return;
    const icon = button.querySelector('i');
    const textNode = Array.from(button.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);

    if (!button.dataset.defaultText) {
        button.dataset.defaultText = (textNode?.textContent || '').trim();
    }
    if (!button.dataset.defaultIcon && icon) {
        button.dataset.defaultIcon = icon.className;
    }

    const isLoading = Boolean(loadingText);
    button.disabled = isLoading;
    if (icon) {
        icon.className = isLoading ? 'fas fa-spinner fa-spin' : button.dataset.defaultIcon;
    }
    if (textNode) {
        textNode.textContent = ` ${isLoading ? loadingText : button.dataset.defaultText}`;
    }
}

function openBackupModal() {
    const modal = document.getElementById('backup-modal');
    if (!modal) return;

    const confirmRestore = document.getElementById('restore-backup-confirm');
    const backupFileInput = document.getElementById('backup-file-input');
    if (confirmRestore) confirmRestore.checked = false;
    if (backupFileInput) backupFileInput.value = '';
    updateBackupModalSummary();

    if (window.UXEnhancements?.openDialog) {
        window.UXEnhancements.openDialog(modal, {
            contentSelector: '.shortcuts-content',
            initialFocus: '#backup-close'
        });
        return;
    }

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
}

function closeBackupModal() {
    const modal = document.getElementById('backup-modal');
    if (!modal) return;

    if (window.UXEnhancements?.closeDialog) {
        window.UXEnhancements.closeDialog(modal);
        return;
    }

    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

const _backupBtn = document.getElementById('backup-btn');
if (_backupBtn) {
    _backupBtn.addEventListener('click', () => {
        const headerTools = document.querySelector('.header-tools');
        if (headerTools instanceof HTMLDetailsElement) {
            headerTools.open = false;
        }
        openBackupModal();
    });
}

// Backup modal handlers
const _backupClose = document.getElementById('backup-close');
if (_backupClose) {
    _backupClose.addEventListener('click', () => {
        closeBackupModal();
    });
}

const _backupModal = document.getElementById('backup-modal');
if (_backupModal) {
    _backupModal.addEventListener('click', (event) => {
        if (event.target === _backupModal) closeBackupModal();
    });
}

const _createBackupBtn = document.getElementById('create-backup-btn');
if (_createBackupBtn) {
    _createBackupBtn.addEventListener('click', async () => {
        try {
            setBackupButtonState(_createBackupBtn, 'جاري الإنشاء...');
            const backup = await BackupManager.createBackup();
            BackupManager.downloadBackup(backup);
            updateBackupModalSummary();
            showToast(`تم إنشاء النسخة الاحتياطية بنجاح (${BackupManager.formatSize(backup.size)})`, 'success');
        } catch (e) {
            showToast('خطأ: ' + e.message, 'error');
        } finally {
            setBackupButtonState(_createBackupBtn);
        }
    });
}

const _restoreBackupBtn = document.getElementById('restore-backup-btn');
if (_restoreBackupBtn) {
    _restoreBackupBtn.addEventListener('click', () => {
        const confirmRestore = document.getElementById('restore-backup-confirm');
        if (!confirmRestore?.checked) {
            showToast('أكد أولا أنك تحتفظ بنسخة حديثة قبل بدء الاستعادة', 'warning');
            confirmRestore?.focus();
            return;
        }
        const fileInput = document.getElementById('backup-file-input');
        if (fileInput) fileInput.click();
    });
}

const _backupFileInput = document.getElementById('backup-file-input');
if (_backupFileInput) {
    _backupFileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            updateBackupModalSummary(file);
            const confirmed = window.confirm(`سيتم استبدال البيانات الحالية بالملف: ${file.name}. هل تريد المتابعة؟`);
            if (!confirmed) {
                e.target.value = '';
                updateBackupModalSummary();
                return;
            }

            try {
                setBackupButtonState(_restoreBackupBtn, 'جاري الاستعادة...');
                const result = await BackupManager.restoreFromFile(file);
                const dbPart = result.dbRestored ? ' مع قاعدة البيانات' : '';
                showToast(`تم استعادة ${result.restoredItems} عنصر${dbPart} بنجاح!`, 'success');
                closeBackupModal();
                setTimeout(() => location.reload(), 1500);
            } catch (err) {
                showToast('خطأ: ' + err.message, 'error');
            } finally {
                setBackupButtonState(_restoreBackupBtn);
                e.target.value = '';
                updateBackupModalSummary();
            }
        }
    });
}
