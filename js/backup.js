/**
 * Database Backup System
 * نظام النسخ الاحتياطي لقاعدة بيانات المدرسة
 */

const BackupManager = {
    // مفتاح التخزين للإعدادات
    SETTINGS_KEY: 'backup_settings',
    HISTORY_KEY: 'backup_history',

    // الإعدادات الافتراضية
    defaultSettings: {
        autoBackup: false,
        backupInterval: 'daily', // daily, weekly, manual
        maxBackups: 5,
        lastBackup: null
    },

    /**
     * تحميل الإعدادات
     */
    getSettings() {
        try {
            const saved = localStorage.getItem(this.SETTINGS_KEY);
            return saved ? { ...this.defaultSettings, ...JSON.parse(saved) } : this.defaultSettings;
        } catch (e) {
            console.error('Error loading backup settings:', e);
            return this.defaultSettings;
        }
    },

    /**
     * حفظ الإعدادات
     */
    saveSettings(settings) {
        try {
            localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
            return true;
        } catch (e) {
            console.error('Error saving backup settings:', e);
            return false;
        }
    },

    /**
     * الحصول على سجل النسخ الاحتياطية
     */
    getHistory() {
        try {
            const saved = localStorage.getItem(this.HISTORY_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error('Error loading backup history:', e);
            return [];
        }
    },

    /**
     * إضافة نسخة للسجل
     */
    addToHistory(backup) {
        const history = this.getHistory();
        history.unshift(backup);

        // الاحتفاظ بعدد محدد من السجلات
        const settings = this.getSettings();
        while (history.length > settings.maxBackups) {
            history.pop();
        }

        localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
    },

    /**
     * إنشاء نسخة احتياطية محلية من localStorage
     */
    createLocalBackup() {
        try {
            const backup = {
                id: Date.now(),
                date: new Date().toISOString(),
                formatVersion: 1,
                type: 'manual',
                data: {}
            };

            // جمع جميع البيانات من localStorage
            const keysToBackup = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                // استثناء إعدادات النسخ الاحتياطي نفسها
                if (key !== this.SETTINGS_KEY && key !== this.HISTORY_KEY) {
                    keysToBackup.push(key);
                }
            }

            keysToBackup.forEach((key) => {
                backup.data[key] = localStorage.getItem(key);
            });

            backup.itemsCount = Object.keys(backup.data).length;

            // حساب الحجم المبدئي قبل إضافة نسخة قاعدة البيانات
            const localBackupString = JSON.stringify(backup);
            backup.size = new Blob([localBackupString]).size;

            return backup;
        } catch (e) {
            console.error('Error creating local backup:', e);
            throw new Error('فشل إنشاء النسخة المحلية: ' + e.message);
        }
    },

    /**
     * إنشاء نسخة احتياطية كاملة (localStorage + SQLite عبر IPC)
     */
    async createBackup() {
        try {
            console.log('[backup] createBackup: starting...');
            const backup = this.createLocalBackup();
            console.log('[backup] createBackup: local backup created, items:', backup.itemsCount);

            if (window.api && window.api.system && typeof window.api.system.backupDb === 'function') {
                console.log('[backup] createBackup: calling IPC backupDb...');
                const dbResult = await window.api.system.backupDb();
                console.log('[backup] createBackup: IPC result:', dbResult?.success, dbResult?.error || '');
                if (!dbResult || dbResult.success === false) {
                    throw new Error(dbResult?.error || 'فشل أخذ نسخة من قاعدة البيانات');
                }

                if (dbResult.data && dbResult.data.dbBase64) {
                    backup.database = {
                        format: 'sqljs-base64',
                        dbBase64: dbResult.data.dbBase64,
                        byteLength: Number(dbResult.data.byteLength || 0),
                        createdAt: dbResult.data.createdAt || new Date().toISOString()
                    };
                    console.log('[backup] createBackup: DB included, size:', dbResult.data.byteLength, 'bytes');
                }
            } else {
                console.warn('[backup] createBackup: backupDb API not available');
            }

            const backupString = JSON.stringify(backup);
            backup.size = new Blob([backupString]).size;
            console.log('[backup] createBackup: total backup size:', backup.size, 'bytes');

            // تحديث الإعدادات
            const settings = this.getSettings();
            settings.lastBackup = new Date().toISOString();
            this.saveSettings(settings);

            // إضافة للسجل
            const historyEntry = {
                id: backup.id,
                date: backup.date,
                type: backup.type,
                size: backup.size,
                itemsCount: backup.itemsCount
            };
            this.addToHistory(historyEntry);

            console.log('[backup] createBackup: SUCCESS');
            return backup;
        } catch (e) {
            console.error('[backup] createBackup: FAILED —', e.message, e);
            throw new Error('فشل إنشاء النسخة الاحتياطية: ' + e.message);
        }
    },

    /**
     * تحميل النسخة الاحتياطية كملف JSON
     */
    downloadBackup(backup) {
        try {
            const dataStr = JSON.stringify(backup, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const date = new Date(backup.date);
            const fileName = `school_backup_${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}.json`;

            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            return true;
        } catch (e) {
            console.error('Error downloading backup:', e);
            throw new Error('فشل تحميل الملف: ' + e.message);
        }
    },

    /**
     * استعادة نسخة احتياطية من ملف (localStorage + SQLite)
     */
    async restoreFromFile(file) {
        const MAX_BACKUP_SIZE = 500 * 1024 * 1024; // 500 MB
        if (file.size > MAX_BACKUP_SIZE) {
            return Promise.reject(new Error('حجم ملف النسخة الاحتياطية كبير جداً (الحد الأقصى 500 ميغا)'));
        }
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    const backup = JSON.parse(e.target.result);

                    const hasLocalData = backup.data && typeof backup.data === 'object';
                    const hasDbData = backup.database && typeof backup.database.dbBase64 === 'string';

                    if (!hasLocalData && !hasDbData) {
                        throw new Error('ملف النسخة الاحتياطية غير صالح');
                    }

                    let restoredItems = 0;
                    const previousLocalData = {};

                    if (hasLocalData) {
                        for (let i = 0; i < localStorage.length; i++) {
                            const key = localStorage.key(i);
                            if (key !== this.SETTINGS_KEY && key !== this.HISTORY_KEY) {
                                previousLocalData[key] = localStorage.getItem(key);
                            }
                        }
                    }

                    if (hasDbData) {
                        if (backup.database.format && backup.database.format !== 'sqljs-base64') {
                            throw new Error('صيغة نسخة قاعدة البيانات غير مدعومة');
                        }

                        if (!window.api || !window.api.system || typeof window.api.system.restoreDb !== 'function') {
                            throw new Error('استعادة قاعدة البيانات غير مدعومة في هذه النسخة');
                        }

                        const restorePayload = {
                            dbBase64: backup.database.dbBase64,
                            expectedByteLength: Number(backup.database.byteLength || 0)
                        };
                        console.log('[backup] restoreFromFile: calling IPC restoreDb, payload size:', backup.database.dbBase64.length);
                        let dbResult = await window.api.system.restoreDb(restorePayload);
                        console.log('[backup] restoreFromFile: IPC result:', dbResult?.success, dbResult?.error || '');

                        if (
                            dbResult?.success === false &&
                            dbResult?.code === 'FORBIDDEN' &&
                            typeof window.api.system.restoreDbContent === 'function'
                        ) {
                            console.log('[backup] restoreFromFile: full restore forbidden, trying content-only restore');
                            dbResult = await window.api.system.restoreDbContent(restorePayload);
                            console.log('[backup] restoreFromFile: content restore IPC result:', dbResult?.success, dbResult?.error || '');
                        }

                        if (!dbResult || dbResult.success === false) {
                            throw new Error(dbResult?.error || 'فشل استعادة قاعدة البيانات');
                        }
                        if (dbResult.mode === 'content') {
                            restoredItems += Number(dbResult.restoredItems || 0);
                        }
                    }

                    if (hasLocalData) {
                        try {
                            const keysToRemove = [];
                            for (let i = 0; i < localStorage.length; i++) {
                                const key = localStorage.key(i);
                                if (key !== this.SETTINGS_KEY && key !== this.HISTORY_KEY) {
                                    keysToRemove.push(key);
                                }
                            }
                            keysToRemove.forEach((key) => localStorage.removeItem(key));

                            Object.entries(backup.data).forEach(([key, value]) => {
                                localStorage.setItem(key, value);
                            });

                            restoredItems = Object.keys(backup.data).length;
                        } catch (localError) {
                            const keysToRemove = [];
                            for (let i = 0; i < localStorage.length; i++) {
                                const key = localStorage.key(i);
                                if (key !== this.SETTINGS_KEY && key !== this.HISTORY_KEY) {
                                    keysToRemove.push(key);
                                }
                            }
                            keysToRemove.forEach((key) => localStorage.removeItem(key));
                            Object.entries(previousLocalData).forEach(([key, value]) => {
                                localStorage.setItem(key, value);
                            });
                            throw localError;
                        }
                    }

                    resolve({
                        success: true,
                        restoredItems,
                        dbRestored: !!hasDbData,
                        backupDate: backup.date
                    });
                    return;
                } catch (e) {
                    reject(new Error('فشل قراءة ملف النسخة الاحتياطية: ' + e.message));
                }
            };

            reader.onerror = () => {
                reject(new Error('فشل قراءة الملف'));
            };

            reader.readAsText(file);
        });
    },

    /**
     * تنسيق حجم الملف
     */
    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    },

    /**
     * التحقق من الحاجة للنسخ الاحتياطي التلقائي
     */
    shouldAutoBackup() {
        const settings = this.getSettings();
        if (!settings.autoBackup || !settings.lastBackup) return settings.autoBackup;

        const lastBackup = new Date(settings.lastBackup);
        const now = new Date();
        const diffDays = Math.floor((now - lastBackup) / (1000 * 60 * 60 * 24));

        switch (settings.backupInterval) {
            case 'daily':
                return diffDays >= 1;
            case 'weekly':
                return diffDays >= 7;
            default:
                return false;
        }
    },

    /**
     * تهيئة النظام وفحص النسخ الاحتياطي التلقائي
     */
    init() {
        if (this.shouldAutoBackup()) {
            console.log('Auto backup triggered');
            this.createBackup()
                .then((backup) => {
                    if (typeof showToast === 'function') {
                        showToast('تم إنشاء نسخة احتياطية تلقائية', 'info');
                    }
                })
                .catch((error) => {
                    console.error('Auto backup failed:', error);
                });
        }
    }
};

// تهيئة النظام عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    BackupManager.init();
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BackupManager;
}
