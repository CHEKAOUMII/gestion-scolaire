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
function openBackupModal() {
    const modal = document.getElementById('backup-modal');
    if (!modal) return;

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
            const backup = await BackupManager.createBackup();
            BackupManager.downloadBackup(backup);
            showToast('تم إنشاء النسخة الاحتياطية بنجاح!', 'success');
            closeBackupModal();
        } catch (e) {
            showToast('خطأ: ' + e.message, 'error');
        }
    });
}

const _restoreBackupBtn = document.getElementById('restore-backup-btn');
if (_restoreBackupBtn) {
    _restoreBackupBtn.addEventListener('click', () => {
        const fileInput = document.getElementById('backup-file-input');
        if (fileInput) fileInput.click();
    });
}

const _backupFileInput = document.getElementById('backup-file-input');
if (_backupFileInput) {
    _backupFileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            try {
                const result = await BackupManager.restoreFromFile(e.target.files[0]);
                const dbPart = result.dbRestored ? ' مع قاعدة البيانات' : '';
                showToast(`تم استعادة ${result.restoredItems} عنصر${dbPart} بنجاح!`, 'success');
                closeBackupModal();
                setTimeout(() => location.reload(), 1500);
            } catch (err) {
                showToast('خطأ: ' + err.message, 'error');
            }
        }
    });
}
