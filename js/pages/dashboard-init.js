// Initialize app - Electron + SQLite version
document.addEventListener('DOMContentLoaded', () => {
    // Setup sidebar first
    if (typeof setupSidebar === 'function') {
        setupSidebar();
    }

    // School year change handler
    document.getElementById('school-year').addEventListener('change', async (e) => {
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
});

// Backup button handler
document.getElementById('backup-btn').addEventListener('click', () => {
    document.getElementById('backup-modal').classList.add('active');
});

// Backup modal handlers
document.getElementById('backup-close').addEventListener('click', () => {
    document.getElementById('backup-modal').classList.remove('active');
});

document.getElementById('create-backup-btn').addEventListener('click', async () => {
    try {
        const backup = await BackupManager.createBackup();
        BackupManager.downloadBackup(backup);
        showToast('تم إنشاء النسخة الاحتياطية بنجاح!', 'success');
        document.getElementById('backup-modal').classList.remove('active');
    } catch (e) {
        showToast('خطأ: ' + e.message, 'error');
    }
});

document.getElementById('restore-backup-btn').addEventListener('click', () => {
    document.getElementById('backup-file-input').click();
});

document.getElementById('backup-file-input').addEventListener('change', async (e) => {
    if (e.target.files.length > 0) {
        try {
            const result = await BackupManager.restoreFromFile(e.target.files[0]);
            const dbPart = result.dbRestored ? ' مع قاعدة البيانات' : '';
            showToast(`تم استعادة ${result.restoredItems} عنصر${dbPart} بنجاح!`, 'success');
            document.getElementById('backup-modal').classList.remove('active');
            setTimeout(() => location.reload(), 1500);
        } catch (err) {
            showToast('خطأ: ' + err.message, 'error');
        }
    }
});
