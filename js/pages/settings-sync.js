/**
 * Sync Settings Page — js/pages/settings-sync.js
 * إعدادات المزامنة السحابية
 * ⚠️ Sync config section restricted to role === 'admin' OR 'developer'
 */

// ── Hide sync config section for non-admin / non-developer users ──
(function devSectionGuard() {
    let isPrivileged = false;
    try {
        const rawSession = localStorage.getItem('gsl_auth_session_v1');
        if (rawSession) {
            const sess = JSON.parse(rawSession);
            const role = String(sess?.role || '').toLowerCase();
            if (role === 'developer' || role === 'admin') isPrivileged = true;
        }
    } catch (_) { /* */ }
    if (!isPrivileged) {
        // Hide sync config section once DOM is ready
        const hide = () => {
            const configSection = document.getElementById('sync-config-section');
            if (configSection) configSection.style.display = 'none';
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', hide);
        } else {
            hide();
        }
    }
})();

// ── Hardcoded sync defaults (so users don't have to enter these) ──
const SYNC_HARDCODED_DEFAULTS = {
    awsRegion: 'eu-west-1',
    authLambdaUrl: 'https://mntx5r4cijucr5p2cegkc34psi0afavh.lambda-url.eu-west-1.on.aws'
};

let statusTimer = null;
let isAdmin = false;
let currentOffset = 0;
const conflictPageSize = 50;
let otpCountdownTimer = null;

const OTP_SESSION_STORAGE_KEY = 'gsl_linking_active_otp_v1';
const LINK_METHOD_LABELS = {
    setup_new: 'إعداد جديد',
    otp_lan: 'ربط محلي',
    otp_server: 'ربط عبر السيرفر'
};
const DEVICE_STATUS_LABELS = {
    active: 'نشط',
    revoked: 'ملغى'
};

const deviceManagementState = {
    initialized: false,
    refreshPromise: null,
    currentDevice: null,
    institutionStatus: null,
    otp: {
        plaintext: '',
        expiresAt: null,
        countdownOnly: false
    },
    dom: {}
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check user role
    try {
        const rawSession = localStorage.getItem('gsl_auth_session_v1');
        if (rawSession) {
            const sess = JSON.parse(rawSession);
            const role = String(sess?.role || '').toLowerCase();
            isAdmin = role === 'admin' || role === 'developer';
        }
    } catch (_) {
        /* ignore parse errors */
    }

    // 2. Hide admin-only elements for non-privileged users (admin & developer can see all)
    //    But allow staff to see OTP device linking panel
    if (!isAdmin) {
        document.body.classList.add('sync-readonly');
    }

    // Staff role can still access the OTP device linking feature
    {
        const rawSession = localStorage.getItem('gsl_auth_session_v1');
        if (rawSession) {
            try {
                const sess = JSON.parse(rawSession);
                const role = String(sess?.role || '').toLowerCase();
                if (role === 'staff') {
                    const otpPanel = document.getElementById('device-otp-panel');
                    if (otpPanel) otpPanel.classList.remove('otp-role-gated');
                }
            } catch (_) { /* */ }
        }
    }

    // 3. Load initial data
    await loadConfig();
    await refreshStatus();
    await loadConflicts();
    await refreshDeviceManagement({ showLoading: true });

    // 4. Set up auto-refresh (every 10 seconds)
    statusTimer = setInterval(refreshStatus, 10000);

    // 5. Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        clearInterval(statusTimer);
        clearOtpCountdown();
    });
});

// ==================== Status Display (US1) ====================

/**
 * Convert an ISO timestamp to an Arabic relative time string.
 */
function formatRelativeTime(isoString) {
    if (!isoString) return '—';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '—';
        const now = Date.now();
        const diffMs = now - date.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        if (diffSec < 0) return 'الآن';
        if (diffSec < 60) return 'منذ لحظات';
        if (diffMin === 1) return 'منذ دقيقة';
        if (diffMin === 2) return 'منذ دقيقتين';
        if (diffMin <= 10) return `منذ ${diffMin} دقائق`;
        if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
        if (diffHour === 1) return 'منذ ساعة';
        if (diffHour === 2) return 'منذ ساعتين';
        if (diffHour < 24) return `منذ ${diffHour} ساعات`;
        if (diffDay === 1) return 'منذ يوم';
        if (diffDay === 2) return 'منذ يومين';
        if (diffDay <= 10) return `منذ ${diffDay} أيام`;
        return `منذ ${diffDay} يوم`;
    } catch (_) {
        return '—';
    }
}

/**
 * Derive sync state from status object.
 */
function deriveSyncState(status) {
    if (!status || !status.enabled) return 'disabled';
    if (status.pushRunning || status.pullRunning || status.snapshotRunning) return 'syncing';
    if (!status.authenticated) return 'offline';
    if (status.lastPushError || status.lastPullError) return 'error';
    return 'connected';
}

async function refreshStatus() {
    try {
        const status = await window.api.sync.getStatus();
        if (!status) return;

        const state = deriveSyncState(status);

        // Update state banner
        const banner = document.getElementById('sync-state-banner');
        if (banner) {
            banner.className = 'mb-4 rounded-xl px-4 py-3.5 flex items-center gap-3';
            let bannerIcon = '';
            let bannerText = '';
            switch (state) {
                case 'connected':
                    banner.classList.add('bg-[rgba(46,204,113,0.12)]', 'text-[var(--color-success-bg)]');
                    bannerIcon = '<i class="fas fa-check-circle text-xl"></i>';
                    bannerText = 'متصل ومزامن';
                    break;
                case 'syncing':
                    banner.classList.add('bg-[rgba(46,204,113,0.12)]', 'text-[var(--color-success-bg)]');
                    bannerIcon = '<i class="fas fa-sync fa-spin text-xl"></i>';
                    bannerText = 'جاري المزامنة...';
                    break;
                case 'offline':
                    banner.classList.add('bg-[rgba(240,173,78,0.12)]', 'text-[var(--color-warning-bg)]');
                    bannerIcon = '<i class="fas fa-exclamation-triangle text-xl"></i>';
                    bannerText = 'غير متصل — التغييرات في قائمة الانتظار';
                    break;
                case 'error':
                    banner.classList.add('bg-[rgba(232,93,93,0.12)]', 'text-[var(--color-danger-bg)]');
                    bannerIcon = '<i class="fas fa-times-circle text-xl"></i>';
                    bannerText = status.lastPushError || status.lastPullError || 'خطأ في المزامنة';
                    break;
                case 'disabled':
                    banner.classList.add('bg-[rgba(150,150,150,0.12)]', 'text-[var(--color-text-muted)]');
                    bannerIcon = '<i class="fas fa-pause-circle text-xl"></i>';
                    bannerText = 'المزامنة معطلة';
                    break;
            }
            banner.innerHTML = `${bannerIcon}<span class="font-bold">${bannerText}</span>`;
        }

        // Update KPI cards
        // 1. Connection state
        const connEl = document.getElementById('status-connection');
        if (connEl) {
            const stateMap = {
                connected: { icon: 'fa-check-circle text-[var(--color-success-bg)]', label: 'متصل' },
                syncing: { icon: 'fa-sync fa-spin text-[var(--color-success-bg)]', label: 'مزامنة' },
                offline: { icon: 'fa-exclamation-triangle text-[var(--color-warning-bg)]', label: 'غير متصل' },
                error: { icon: 'fa-times-circle text-[var(--color-danger-bg)]', label: 'خطأ' },
                disabled: { icon: 'fa-pause-circle text-[var(--color-text-muted)]', label: 'معطل' }
            };
            const s = stateMap[state] || stateMap.disabled;
            connEl.innerHTML = `<i class="fas ${s.icon} me-1"></i> ${s.label}`;
        }

        // 2. Last push
        const pushEl = document.getElementById('status-last-push');
        if (pushEl) {
            pushEl.textContent = formatRelativeTime(status.lastPushAt);
            if (status.lastPushError) {
                let errDiv = pushEl.parentElement.querySelector('.kpi-error');
                if (!errDiv) {
                    errDiv = document.createElement('div');
                    errDiv.className = 'kpi-error text-xs text-[var(--color-danger-bg)] mt-1';
                    pushEl.parentElement.appendChild(errDiv);
                }
                errDiv.textContent = status.lastPushError;
            } else {
                pushEl.parentElement.querySelector('.kpi-error')?.remove();
            }
        }

        // 3. Last pull
        const pullEl = document.getElementById('status-last-pull');
        if (pullEl) {
            pullEl.textContent = formatRelativeTime(status.lastPullAt);
            if (status.lastPullError) {
                let errDiv = pullEl.parentElement.querySelector('.kpi-error');
                if (!errDiv) {
                    errDiv = document.createElement('div');
                    errDiv.className = 'kpi-error text-xs text-[var(--color-danger-bg)] mt-1';
                    pullEl.parentElement.appendChild(errDiv);
                }
                errDiv.textContent = status.lastPullError;
            } else {
                pullEl.parentElement.querySelector('.kpi-error')?.remove();
            }
        }

        // 4. Pending count
        const pendingEl = document.getElementById('status-pending');
        if (pendingEl) {
            pendingEl.textContent = status.pendingCount ?? '—';
            pendingEl.className =
                'text-lg font-bold ' +
                (status.pendingCount > 0 ? 'text-[var(--color-warning-bg)]' : 'text-[var(--color-success-bg)]');
        }

        // 5. Failed count
        const failedEl = document.getElementById('status-failed');
        if (failedEl) {
            failedEl.textContent = status.failedCount ?? '—';
            failedEl.className =
                'text-lg font-bold ' +
                (status.failedCount > 0 ? 'text-[var(--color-danger-bg)]' : 'text-[var(--color-success-bg)]');
        }

        // 6. Conflict count
        const conflictEl = document.getElementById('status-conflicts');
        if (conflictEl) {
            conflictEl.textContent = status.conflictCount ?? '—';
            conflictEl.className =
                'text-lg font-bold ' +
                (status.conflictCount > 0 ? 'text-[var(--color-danger-bg)]' : 'text-[var(--color-success-bg)]');
        }

        // 7. Last snapshot
        const snapEl = document.getElementById('status-last-snapshot');
        if (snapEl) {
            snapEl.textContent = formatRelativeTime(status.lastSnapshotAt);
        }

        // Control Sync Now button state (US3)
        const syncNowBtn = document.getElementById('btn-sync-now');
        if (syncNowBtn) {
            if (!status.enabled) {
                syncNowBtn.disabled = true;
                syncNowBtn.title = 'المزامنة معطلة';
            } else if (status.pushRunning || status.pullRunning) {
                syncNowBtn.disabled = true;
                syncNowBtn.title = 'المزامنة جارية';
            } else {
                syncNowBtn.disabled = false;
                syncNowBtn.title = '';
            }
        }
    } catch (err) {
        console.warn('refreshStatus error:', err);
    }
}

// ==================== Configuration (US2) ====================

async function loadConfig() {
    try {
        const config = await window.api.sync.getConfig();
        const status = await window.api.sync.getStatus();

        if (!config) return;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };
        const setChecked = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!val;
        };

        setChecked('cfg-enabled-toggle', config.enabled);
        // Keep hidden cfg-enabled in sync for the admin form
        const hiddenEnabled = document.getElementById('cfg-enabled');
        if (hiddenEnabled) hiddenEnabled.value = config.enabled ? '1' : '0';
        setVal('cfg-school-id', config.schoolId || '');
        setVal('cfg-auth-url', config.authLambdaUrl || '');
        setVal('cfg-region', config.awsRegion || 'eu-west-1');
        setVal('cfg-interval', config.syncIntervalMinutes || 10);
        setVal('cfg-batch-size', config.pushBatchSize || 100);
        setVal('cfg-max-retries', config.maxRetries || 10);
        setVal('cfg-retention', config.retentionDays || 7);
        // snapshotIntervalMinutes comes from status, not config
        setVal('cfg-snapshot-interval', status?.snapshotIntervalMinutes || 30);
        setVal('cfg-license-key', config.licenseKey || '');
    } catch (err) {
        console.warn('loadConfig error:', err);
    }
}

function initConfigForm() {
    const form = document.getElementById('sync-config-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const validationDiv = document.getElementById('config-validation');

        const enabled = document.getElementById('cfg-enabled-toggle')?.checked;
        const schoolId = document.getElementById('cfg-school-id')?.value?.trim();
        const authUrl = document.getElementById('cfg-auth-url')?.value?.trim();
        const region = document.getElementById('cfg-region')?.value?.trim();
        const interval = parseInt(document.getElementById('cfg-interval')?.value, 10);
        const batchSize = parseInt(document.getElementById('cfg-batch-size')?.value, 10);
        const maxRetries = parseInt(document.getElementById('cfg-max-retries')?.value, 10);
        const retention = parseInt(document.getElementById('cfg-retention')?.value, 10);
        const snapshotInterval = parseInt(document.getElementById('cfg-snapshot-interval')?.value, 10);

        // Client-side validation
        const errors = [];
        if (isNaN(interval) || interval < 1 || interval > 30) {
            errors.push('فترة المزامنة يجب أن تكون بين 1 و 30 دقيقة');
        }
        if (enabled && !schoolId) {
            errors.push('معرف المؤسسة مطلوب عند تفعيل المزامنة');
        }
        if (enabled && !authUrl) {
            errors.push('رابط المصادقة مطلوب عند تفعيل المزامنة');
        }
        if (enabled && !region) {
            errors.push('المنطقة مطلوبة عند تفعيل المزامنة');
        }

        if (errors.length) {
            if (validationDiv) {
                validationDiv.textContent = errors.join(' | ');
                validationDiv.classList.remove('hidden');
            }
            return;
        }
        if (validationDiv) validationDiv.classList.add('hidden');

        const updates = {
            enabled: enabled ? 1 : 0,
            schoolId,
            authLambdaUrl: authUrl,
            awsRegion: region,
            syncIntervalMinutes: interval
        };
        if (!isNaN(batchSize)) updates.pushBatchSize = batchSize;
        if (!isNaN(maxRetries)) updates.maxRetries = maxRetries;
        if (!isNaN(retention)) updates.retentionDays = retention;
        if (!isNaN(snapshotInterval)) updates.snapshotIntervalMinutes = snapshotInterval;

        try {
            const result = await window.api.sync.setConfig(updates);
            if (result.success) {
                showToast('تم حفظ الإعدادات بنجاح', 'success');
                await loadConfig();
                await refreshStatus();
            } else {
                showToast(result.error || 'فشل حفظ الإعدادات', 'error');
            }
        } catch (err) {
            console.error('setConfig error:', err);
            showToast('حدث خطأ أثناء الحفظ', 'error');
        }
    });
}

// ==================== Standalone Sync Toggle (visible to all users) ====================

function initSyncToggle() {
    const toggle = document.getElementById('cfg-enabled-toggle');
    if (!toggle) return;

    toggle.addEventListener('change', async () => {
        // Admins use the full config form — don't double-save
        if (isAdmin) return;

        try {
            const result = await window.api.sync.toggleEnabled(toggle.checked);
            if (result.success) {
                showToast(
                    toggle.checked ? 'تم تفعيل المزامنة' : 'تم تعطيل المزامنة',
                    'success'
                );
                await refreshStatus();
            } else {
                showToast(result.error || 'فشل تحديث حالة المزامنة', 'error');
                // Revert the toggle on failure
                toggle.checked = !toggle.checked;
            }
        } catch (err) {
            console.error('sync toggle error:', err);
            showToast('حدث خطأ أثناء تحديث حالة المزامنة', 'error');
            toggle.checked = !toggle.checked;
        }
    });
}

// ==================== Test Connection ====================

function initTestConnection() {
    const btn = document.getElementById('btn-test-connection');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const resultDiv = document.getElementById('test-connection-result');
        btn.disabled = true;
        const origHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الاختبار...';
        if (resultDiv) {
            resultDiv.classList.add('hidden');
            resultDiv.textContent = '';
        }

        try {
            const result = await window.api.sync.testConnection();
            if (resultDiv) {
                resultDiv.classList.remove('hidden');
                if (result.success) {
                    resultDiv.className =
                        'mt-3 rounded-lg px-4 py-3 text-sm bg-[rgba(46,204,113,0.12)] text-[var(--color-success-bg)]';
                    resultDiv.innerHTML = `<i class="fas fa-check-circle me-2"></i>الاتصال ناجح${result.schoolId ? ' — معرف المؤسسة: ' + result.schoolId : ''}`;
                } else {
                    const stepLabel = { lambda: 'Lambda', cognito: 'Cognito', dynamodb: 'DynamoDB' }[result.step] || '';
                    resultDiv.className =
                        'mt-3 rounded-lg px-4 py-3 text-sm bg-[rgba(232,93,93,0.12)] text-[var(--color-danger-bg)]';
                    resultDiv.innerHTML = `<i class="fas fa-times-circle me-2"></i>${stepLabel ? stepLabel + ': ' : ''}${result.error || 'فشل الاتصال'}`;
                }
            }
        } catch (err) {
            if (resultDiv) {
                resultDiv.classList.remove('hidden');
                resultDiv.className =
                    'mt-3 rounded-lg px-4 py-3 text-sm bg-[rgba(232,93,93,0.12)] text-[var(--color-danger-bg)]';
                resultDiv.textContent = err.message || 'خطأ غير متوقع';
            }
        } finally {
            btn.innerHTML = origHTML;
            btn.disabled = false;
        }
    });
}

// ==================== Manual Sync (US3) ====================

function initSyncNow() {
    const btn = document.getElementById('btn-sync-now');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        if (btn.disabled) return;

        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري المزامنة...';

        try {
            const result = await window.api.sync.triggerNow();

            // Show results
            const resultsDiv = document.getElementById('sync-results');
            if (resultsDiv && result) {
                resultsDiv.classList.remove('hidden');
                let html = '<div class="grid gap-3 sm:grid-cols-3">';

                // Push results
                html += '<div class="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">';
                html +=
                    '<h4 class="mb-2 font-bold text-[var(--color-text-main)]"><i class="fas fa-upload me-1"></i> الرفع</h4>';
                if (result.push) {
                    if (result.push.skipped) {
                        html += `<p class="text-sm text-[var(--color-text-muted)]">تم التخطي: ${result.push.reason || '—'}</p>`;
                    } else {
                        const pushIcon = result.push.success
                            ? '<i class="fas fa-check-circle text-[var(--color-success-bg)]"></i>'
                            : '<i class="fas fa-times-circle text-[var(--color-danger-bg)]"></i>';
                        html += `<p class="text-sm">${pushIcon} أُرسل: ${result.push.sentCount ?? 0} | فشل: ${result.push.failedCount ?? 0}</p>`;
                        if (result.push.lastError) {
                            html += `<p class="text-xs text-[var(--color-danger-bg)] mt-1">${result.push.lastError}</p>`;
                        }
                    }
                } else {
                    html += '<p class="text-sm text-[var(--color-text-muted)]">—</p>';
                }
                html += '</div>';

                // Pull results
                html += '<div class="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">';
                html +=
                    '<h4 class="mb-2 font-bold text-[var(--color-text-main)]"><i class="fas fa-download me-1"></i> السحب</h4>';
                if (result.pull) {
                    if (result.pull.skipped) {
                        html += '<p class="text-sm text-[var(--color-text-muted)]">تم التخطي</p>';
                    } else {
                        const pullIcon = result.pull.success
                            ? '<i class="fas fa-check-circle text-[var(--color-success-bg)]"></i>'
                            : '<i class="fas fa-times-circle text-[var(--color-danger-bg)]"></i>';
                        html += `<p class="text-sm">${pullIcon} تطبيق: ${result.pull.appliedCount ?? 0} | تعارضات: ${result.pull.conflictCount ?? 0}</p>`;
                        if (result.pull.lastError) {
                            html += `<p class="text-xs text-[var(--color-danger-bg)] mt-1">${result.pull.lastError}</p>`;
                        }
                    }
                } else {
                    html += '<p class="text-sm text-[var(--color-text-muted)]">—</p>';
                }
                html += '</div>';

                // Snapshot results
                html += '<div class="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3">';
                html +=
                    '<h4 class="mb-2 font-bold text-[var(--color-text-main)]"><i class="fas fa-camera me-1"></i> الفحص</h4>';
                if (result.snapshot) {
                    if (result.snapshot.skipped) {
                        html += `<p class="text-sm text-[var(--color-text-muted)]">تم التخطي: ${result.snapshot.reason || '—'}</p>`;
                    } else {
                        const snapIcon = result.snapshot.success
                            ? '<i class="fas fa-check-circle text-[var(--color-success-bg)]"></i>'
                            : '<i class="fas fa-times-circle text-[var(--color-danger-bg)]"></i>';
                        html += `<p class="text-sm">${snapIcon} تغييرات: ${result.snapshot.changesDetected ?? 0} | إضافة: ${result.snapshot.enqueued ?? 0}</p>`;
                        if (result.snapshot.lastError) {
                            html += `<p class="text-xs text-[var(--color-danger-bg)] mt-1">${result.snapshot.lastError}</p>`;
                        }
                    }
                } else {
                    html += '<p class="text-sm text-[var(--color-text-muted)]">—</p>';
                }
                html += '</div>';

                html += '</div>';

                if (result.error) {
                    html += `<div class="mt-3 text-sm text-[var(--color-danger-bg)]"><i class="fas fa-exclamation-circle me-1"></i> ${result.error}</div>`;
                }

                resultsDiv.innerHTML = html;
            }

            if (result?.error) {
                showToast(result.error, 'error');
            }

            await refreshStatus();
        } catch (err) {
            console.error('triggerNow error:', err);
            showToast('حدث خطأ أثناء المزامنة', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    });
}

// ==================== Conflict Log (US4) ====================

const entityTypeLabels = {
    STUDENT: 'تلميذ',
    GRADE: 'نقطة',
    ABSENCE: 'غياب',
    TIMETABLE: 'جدول زمني',
    STAFF: 'موظف',
    TEACHER: 'أستاذ',
    SCHOOL: 'مؤسسة',
    CONFIG: 'إعدادات',
    EXAM: 'امتحان'
};

async function loadConflicts() {
    try {
        const filterEl = document.getElementById('conflict-filter');
        const filterValue = filterEl?.value || 'unresolved';

        const conflicts = await window.api.sync.getConflictLog({
            status: filterValue,
            limit: conflictPageSize,
            offset: currentOffset
        });

        const tbody = document.getElementById('conflict-tbody');
        const badge = document.getElementById('conflict-badge');
        if (!tbody) return;

        if (!conflicts || conflicts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">لا توجد تعارضات</td></tr>';
            if (badge) badge.textContent = '';
            updateConflictPagination(0);
            return;
        }

        if (badge) badge.textContent = conflicts.length >= conflictPageSize ? `${conflictPageSize}+` : conflicts.length;

        tbody.innerHTML = conflicts
            .map((c, i) => {
                const idx = currentOffset + i + 1;
                const typeLabel = entityTypeLabels[c.entityType] || c.entityType;
                const shortId =
                    c.rowSyncId && c.rowSyncId.length > 12 ? c.rowSyncId.substring(0, 12) + '…' : c.rowSyncId || '—';
                const fields = Array.isArray(c.conflictingFields) ? c.conflictingFields.join(', ') : '—';
                const statusBadge =
                    c.status === 'unresolved'
                        ? '<span class="inline-block rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-xs text-white">غير محلول</span>'
                        : '<span class="inline-block rounded-full bg-[var(--color-success-bg)] px-2 py-0.5 text-xs text-white">محلول</span>';
                const dateStr = formatRelativeTime(c.createdAt);

                let actionHtml =
                    '<button class="btn btn-sm btn-secondary conflict-expand-btn" type="button" title="عرض التفاصيل"><i class="fas fa-eye"></i></button>';
                if (c.status === 'unresolved' && isAdmin) {
                    actionHtml += ` <button class="btn btn-sm btn-primary admin-only conflict-resolve-btn" data-id="${c.id}" data-action="local" type="button"><i class="fas fa-desktop"></i> محلي</button>`;
                    actionHtml += ` <button class="btn btn-sm btn-warning admin-only conflict-resolve-btn" data-id="${c.id}" data-action="remote" type="button"><i class="fas fa-cloud"></i> بعيد</button>`;
                }

                return `<tr data-conflict='${JSON.stringify(c).replace(/'/g, '&#39;')}'>
                    <td>${idx}</td>
                    <td>${typeLabel}</td>
                    <td title="${c.rowSyncId || ''}">${shortId}</td>
                    <td>${fields}</td>
                    <td>${statusBadge}</td>
                    <td>${dateStr}</td>
                    <td class="admin-only">${actionHtml}</td>
                </tr>`;
            })
            .join('');

        updateConflictPagination(conflicts.length);
    } catch (err) {
        console.warn('loadConflicts error:', err);
    }
}

function updateConflictPagination(resultCount) {
    const paginationDiv = document.getElementById('conflict-pagination');
    if (!paginationDiv) return;

    const page = Math.floor(currentOffset / conflictPageSize) + 1;
    const prevBtn = paginationDiv.querySelector('.conflict-prev-btn');
    const nextBtn = paginationDiv.querySelector('.conflict-next-btn');
    const pageInfo = paginationDiv.querySelector('.conflict-page-info');

    if (prevBtn) prevBtn.disabled = currentOffset === 0;
    if (nextBtn) nextBtn.disabled = resultCount < conflictPageSize;
    if (pageInfo) pageInfo.textContent = `صفحة ${page}`;
}

function initConflictHandlers() {
    // Filter change
    const filterEl = document.getElementById('conflict-filter');
    if (filterEl) {
        filterEl.addEventListener('change', () => {
            currentOffset = 0;
            loadConflicts();
        });
    }

    // Pagination
    const paginationDiv = document.getElementById('conflict-pagination');
    if (paginationDiv) {
        paginationDiv.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            if (btn.classList.contains('conflict-prev-btn')) {
                currentOffset = Math.max(0, currentOffset - conflictPageSize);
                loadConflicts();
            } else if (btn.classList.contains('conflict-next-btn')) {
                currentOffset += conflictPageSize;
                loadConflicts();
            }
        });
    }

    // Delegated handlers on tbody
    const tbody = document.getElementById('conflict-tbody');
    if (!tbody) return;

    tbody.addEventListener('click', async (e) => {
        // Expand/collapse detail
        const expandBtn = e.target.closest('.conflict-expand-btn');
        if (expandBtn) {
            const row = expandBtn.closest('tr');
            if (!row) return;
            const nextRow = row.nextElementSibling;
            if (nextRow && nextRow.classList.contains('conflict-detail-row')) {
                nextRow.remove();
                return;
            }
            // Create detail row
            let conflict;
            try {
                conflict = JSON.parse(row.dataset.conflict);
            } catch (_) {
                return;
            }
            const detailRow = document.createElement('tr');
            detailRow.className = 'conflict-detail-row';

            const conflictingFields = Array.isArray(conflict.conflictingFields) ? conflict.conflictingFields : [];

            const highlightFields = (data) => {
                if (!data) return '—';
                const str = JSON.stringify(data, null, 2);
                let result = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                conflictingFields.forEach((field) => {
                    const regex = new RegExp(`("${field}")`, 'g');
                    result = result.replace(regex, '<span class="font-bold text-[var(--color-danger-bg)]">$1</span>');
                });
                return result;
            };

            detailRow.innerHTML = `<td colspan="7">
                <div class="flex gap-4 p-3">
                    <div class="flex-1">
                        <div class="mb-1 text-sm font-bold text-[var(--color-text-muted)]"><i class="fas fa-cloud me-1"></i> البيانات البعيدة</div>
                        <pre class="text-xs overflow-auto max-h-60 p-2 rounded bg-[var(--glass-bg)]">${highlightFields(conflict.remoteData)}</pre>
                    </div>
                    <div class="flex-1">
                        <div class="mb-1 text-sm font-bold text-[var(--color-text-muted)]"><i class="fas fa-desktop me-1"></i> البيانات المحلية</div>
                        <pre class="text-xs overflow-auto max-h-60 p-2 rounded bg-[var(--glass-bg)]">${highlightFields(conflict.localData)}</pre>
                    </div>
                </div>
            </td>`;
            row.after(detailRow);
            return;
        }

        // Resolve conflict
        const resolveBtn = e.target.closest('.conflict-resolve-btn');
        if (resolveBtn) {
            const conflictId = parseInt(resolveBtn.dataset.id, 10);
            const resolution = resolveBtn.dataset.action;
            if (!conflictId || !resolution) return;

            // Disable buttons on this row
            const row = resolveBtn.closest('tr');
            const buttons = row?.querySelectorAll('.conflict-resolve-btn');
            buttons?.forEach((b) => (b.disabled = true));

            try {
                const result = await window.api.sync.resolveConflict({ conflictId, resolution });
                if (result.success) {
                    showToast('تم حل التعارض بنجاح', 'success');
                    await loadConflicts();
                    await refreshStatus();
                } else {
                    showToast(result.error || 'فشل حل التعارض', 'error');
                    buttons?.forEach((b) => (b.disabled = false));
                }
            } catch (err) {
                console.error('resolveConflict error:', err);
                showToast('حدث خطأ أثناء حل التعارض', 'error');
                buttons?.forEach((b) => (b.disabled = false));
            }
        }
    });
}

// ==================== Device Management (Phase 7.7) ====================

function cacheDeviceManagementDom() {
    deviceManagementState.dom = {
        section: document.getElementById('device-management-section'),
        loading: document.getElementById('device-management-loading'),
        setupRequired: document.getElementById('device-management-setup-required'),
        setupText: document.getElementById('device-management-setup-text'),
        retryButtons: [
            document.getElementById('device-management-retry-btn'),
            document.getElementById('linked-devices-retry-btn')
        ].filter(Boolean),
        content: document.getElementById('device-management-content'),
        currentDeviceName: document.getElementById('current-device-name'),
        currentDeviceHash: document.getElementById('current-device-hash'),
        currentDeviceMassar: document.getElementById('current-device-massar'),
        currentDeviceInstitution: document.getElementById('current-device-institution'),
        currentDeviceNote: document.getElementById('current-device-note'),
        devicesCount: document.getElementById('linked-devices-count'),
        devicesNote: document.getElementById('linked-devices-note'),
        devicesError: document.getElementById('linked-devices-error'),
        devicesTableWrap: document.getElementById('linked-devices-table-wrap'),
        devicesTbody: document.getElementById('devices-tbody'),
        otpPanel: document.getElementById('device-otp-panel'),
        otpInitial: document.getElementById('device-otp-initial'),
        otpActive: document.getElementById('device-otp-active'),
        otpDigits: Array.from(document.querySelectorAll('[data-otp-digit]')),
        otpCountdown: document.getElementById('device-otp-countdown'),
        otpStatusText: document.getElementById('device-otp-status-text'),
        otpRestoredNote: document.getElementById('device-otp-restored-note'),
        otpIpNote: document.getElementById('device-otp-ip'),
        generateOtpBtn: document.getElementById('generate-linking-otp-btn'),
        cancelOtpBtn: document.getElementById('cancel-linking-otp-btn')
    };

    return deviceManagementState.dom;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatLanEndpointLabel(endpoint) {
    const address = String(endpoint?.address || '').trim();
    if (!address) return '';

    const interfaceName = String(endpoint?.interfaceName || '').trim();
    return interfaceName ? `${address} (${interfaceName})` : address;
}

function renderOtpLanEndpointNote(lanState) {
    const dom = deviceManagementState.dom;
    if (!dom.otpIpNote) return;

    const lanEndpoints = Array.isArray(lanState?.lanEndpoints) ? lanState.lanEndpoints : [];
    const preferredEndpoint =
        lanEndpoints.find((endpoint) => endpoint.preferred) ||
        (lanState?.preferredLanIp ? { address: lanState.preferredLanIp, interfaceName: '' } : null);

    if (!preferredEndpoint) {
        dom.otpIpNote.textContent = 'عنوان الربط الموصى به غير متوفر حالياً';
        return;
    }

    const alternateLabels = lanEndpoints
        .filter((endpoint) => endpoint.address && endpoint.address !== preferredEndpoint.address)
        .map(formatLanEndpointLabel)
        .filter(Boolean);

    let text = 'الموصى به: ' + formatLanEndpointLabel(preferredEndpoint);
    if (alternateLabels.length > 0) {
        text += ' | عناوين أخرى: ' + alternateLabels.join(' / ');
    }

    dom.otpIpNote.textContent = text;
}

function clearOtpCountdown() {
    if (otpCountdownTimer) {
        clearInterval(otpCountdownTimer);
        otpCountdownTimer = null;
    }
}

function computeRemainingSeconds(expiresAt) {
    const expiresAtMs = new Date(expiresAt || '').getTime();
    if (!Number.isFinite(expiresAtMs)) {
        return 0;
    }
    return Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
}

function formatCountdown(seconds) {
    const formatter = new Intl.NumberFormat('ar-EG', {
        minimumIntegerDigits: 2,
        useGrouping: false
    });
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${formatter.format(minutes)}:${formatter.format(remainingSeconds)}`;
}

function readStoredOtp() {
    try {
        const raw = sessionStorage.getItem(OTP_SESSION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            sessionStorage.removeItem(OTP_SESSION_STORAGE_KEY);
            return null;
        }
        if (!parsed.expiresAt || computeRemainingSeconds(parsed.expiresAt) <= 0) {
            sessionStorage.removeItem(OTP_SESSION_STORAGE_KEY);
            return null;
        }
        const otp = String(parsed.otp || '').trim();
        return otp ? { otp, expiresAt: parsed.expiresAt } : null;
    } catch (_) {
        try {
            sessionStorage.removeItem(OTP_SESSION_STORAGE_KEY);
        } catch {
            // ignore storage cleanup errors
        }
        return null;
    }
}

function storeOtp(otp, expiresAt) {
    const normalizedOtp = String(otp || '').trim();
    deviceManagementState.otp.plaintext = normalizedOtp;
    deviceManagementState.otp.expiresAt = expiresAt || null;
    deviceManagementState.otp.countdownOnly = false;

    if (!normalizedOtp || !expiresAt) {
        return;
    }

    try {
        sessionStorage.setItem(
            OTP_SESSION_STORAGE_KEY,
            JSON.stringify({
                otp: normalizedOtp,
                expiresAt
            })
        );
    } catch {
        // ignore storage quota/access errors
    }
}

function clearStoredOtp() {
    deviceManagementState.otp.plaintext = '';
    deviceManagementState.otp.expiresAt = null;
    deviceManagementState.otp.countdownOnly = false;
    try {
        sessionStorage.removeItem(OTP_SESSION_STORAGE_KEY);
    } catch {
        // ignore storage cleanup errors
    }
}

function showDeviceManagementLoading() {
    const dom = deviceManagementState.dom.section ? deviceManagementState.dom : cacheDeviceManagementDom();
    if (!dom.section) return;
    dom.loading?.classList.remove('hidden');
    dom.setupRequired?.classList.add('hidden');
    dom.content?.classList.add('hidden');
}

function showDeviceManagementSetupRequired(message) {
    const dom = deviceManagementState.dom.section ? deviceManagementState.dom : cacheDeviceManagementDom();
    if (!dom.section) return;
    if (dom.setupText) {
        dom.setupText.textContent = message;
    }
    dom.loading?.classList.add('hidden');
    dom.setupRequired?.classList.remove('hidden');
    dom.content?.classList.add('hidden');
}

function showDeviceManagementContent() {
    const dom = deviceManagementState.dom.section ? deviceManagementState.dom : cacheDeviceManagementDom();
    if (!dom.section) return;
    dom.loading?.classList.add('hidden');
    dom.setupRequired?.classList.add('hidden');
    dom.content?.classList.remove('hidden');
}

function setOtpDigits(otp, masked = false) {
    const dom = deviceManagementState.dom;
    const value = String(otp || '');
    dom.otpDigits.forEach((digitEl, index) => {
        const digit = value[index];
        if (digit) {
            digitEl.textContent = masked ? '•' : digit;
            digitEl.classList.toggle('is-muted', masked);
            return;
        }

        digitEl.textContent = masked ? '•' : '—';
        digitEl.classList.add('is-muted');
    });
}

function showOtpInitialState() {
    const dom = deviceManagementState.dom;
    if (!dom.otpPanel) return;

    clearOtpCountdown();
    dom.otpInitial?.classList.remove('hidden');
    dom.otpActive?.classList.add('hidden');
    if (dom.otpCountdown) {
        dom.otpCountdown.textContent = '00:00';
    }
    if (dom.otpStatusText) {
        dom.otpStatusText.textContent = 'لا يوجد كود نشط حالياً.';
    }
    if (dom.otpRestoredNote) {
        dom.otpRestoredNote.textContent = '';
        dom.otpRestoredNote.classList.add('hidden');
    }
    if (dom.otpIpNote) {
        dom.otpIpNote.textContent = '—';
    }
    setOtpDigits('', false);
}

function startOtpCountdown(expiresAt) {
    const dom = deviceManagementState.dom;
    if (!dom.otpCountdown) return;

    clearOtpCountdown();

    const tick = () => {
        const remainingSeconds = computeRemainingSeconds(expiresAt);
        if (remainingSeconds <= 0) {
            clearOtpCountdown();
            clearStoredOtp();
            showOtpInitialState();
            showToast('انتهت صلاحية كود الربط', 'info');
            return;
        }

        dom.otpCountdown.textContent = formatCountdown(remainingSeconds);
    };

    tick();
    otpCountdownTimer = setInterval(tick, 1000);
}

function renderOtpState(statusResult) {
    const dom = deviceManagementState.dom;
    if (!dom.otpPanel || !isAdmin) return;

    if (!statusResult?.success || !statusResult.active) {
        clearStoredOtp();
        showOtpInitialState();
        return;
    }

    const storedOtp =
        deviceManagementState.otp.plaintext && deviceManagementState.otp.expiresAt === statusResult.expiresAt
            ? { otp: deviceManagementState.otp.plaintext, expiresAt: deviceManagementState.otp.expiresAt }
            : readStoredOtp();
    const plaintextOtp =
        String(statusResult.otp || '').trim() || (storedOtp?.expiresAt === statusResult.expiresAt ? storedOtp.otp : '');
    const countdownOnly = !plaintextOtp;

    deviceManagementState.otp.expiresAt = statusResult.expiresAt || null;
    deviceManagementState.otp.countdownOnly = countdownOnly;
    if (plaintextOtp) {
        storeOtp(plaintextOtp, statusResult.expiresAt);
    } else {
        deviceManagementState.otp.plaintext = '';
    }

    dom.otpInitial?.classList.add('hidden');
    dom.otpActive?.classList.remove('hidden');
    setOtpDigits(plaintextOtp, countdownOnly);

    if (dom.otpStatusText) {
        dom.otpStatusText.textContent = countdownOnly
            ? 'الكود ما يزال نشطاً، لكن لا يمكن استعادة أرقامه في هذه الجلسة.'
            : 'الكود صالح حالياً ويمكن استخدامه لربط جهاز جديد.';
    }

    if (dom.otpRestoredNote) {
        let note = '';
        if (statusResult.otp) {
            note = '';
        } else if (plaintextOtp) {
            note = 'تمت استعادة الكود بعد العودة إلى صفحة المزامنة.';
        } else {
            note = 'تم العثور على كود نشط من جلسة سابقة، لكن التطبيق لا يخزن أرقامه بعد إعادة التشغيل.';
        }

        dom.otpRestoredNote.textContent = note;
        dom.otpRestoredNote.classList.toggle('hidden', !note);
    }

    startOtpCountdown(statusResult.expiresAt);

    if (Array.isArray(statusResult.lanEndpoints) && statusResult.lanEndpoints.length > 0) {
        renderOtpLanEndpointNote(statusResult);
    } else {
        window.api.linking
            .getCurrentDevice()
            .then((result) => {
                renderOtpLanEndpointNote(result);
            })
            .catch(() => {
                if (dom.otpIpNote) {
                    dom.otpIpNote.textContent = 'عنوان الربط الموصى به غير متوفر حالياً';
                }
            });
    }
}

function renderCurrentDevice(currentResult, institutionStatus) {
    const dom = deviceManagementState.dom;
    if (!dom.currentDeviceName) return null;

    if (!currentResult?.success) {
        dom.currentDeviceName.textContent = 'تعذر التحميل';
        dom.currentDeviceHash.textContent = '—';
        dom.currentDeviceMassar.textContent = institutionStatus?.massarCode || '—';
        dom.currentDeviceInstitution.textContent = institutionStatus?.institutionName || 'غير محدد';
        dom.currentDeviceNote.textContent =
            'تعذر تحميل بيانات الجهاز الحالي حالياً. يمكنك إعادة المحاولة من القسم نفسه.';
        deviceManagementState.currentDevice = null;
        return null;
    }

    const truncatedHash = String(currentResult.deviceHash || '').slice(0, 8) || '—';
    const massarCode = currentResult.massarCode || institutionStatus?.massarCode || '—';
    const institutionName = currentResult.institutionName || institutionStatus?.institutionName || 'غير محدد';

    dom.currentDeviceName.textContent = currentResult.deviceName || 'جهاز بدون اسم';
    dom.currentDeviceHash.textContent = truncatedHash;
    dom.currentDeviceHash.title = currentResult.deviceHash || '';
    dom.currentDeviceMassar.textContent = massarCode;
    dom.currentDeviceInstitution.textContent = institutionName;
    const preferredIpText = currentResult.preferredLanIp ? ` • IP الربط الموصى به: ${currentResult.preferredLanIp}` : '';
    dom.currentDeviceNote.textContent = `المنصة: ${currentResult.platform || 'غير معروفة'} • الإصدار: ${currentResult.appVersion || 'غير محدد'}${preferredIpText}`;

    deviceManagementState.currentDevice = currentResult;
    return currentResult;
}

function renderLinkedDevices(devicesResult, currentDeviceHash) {
    const dom = deviceManagementState.dom;
    if (!dom.devicesTbody) return;

    if (!devicesResult?.success) {
        dom.devicesCount.textContent = '—';
        dom.devicesNote.textContent = 'تعذر تحميل قائمة الأجهزة المرتبطة. حاول مرة أخرى.';
        dom.devicesError?.classList.remove('hidden');
        dom.devicesTableWrap?.classList.add('hidden');
        dom.devicesTbody.innerHTML = '';
        return;
    }

    const devices = Array.isArray(devicesResult.devices) ? devicesResult.devices : [];
    dom.devicesError?.classList.add('hidden');
    dom.devicesTableWrap?.classList.remove('hidden');
    dom.devicesCount.textContent = String(devices.length);

    if (!devices.length) {
        dom.devicesNote.textContent = 'لا توجد أجهزة مرتبطة بهذه المؤسسة حالياً.';
        dom.devicesTbody.innerHTML = `
            <tr class="device-empty-row">
                <td colspan="5">لا توجد أي أجهزة مرتبطة بالمؤسسة حالياً.</td>
            </tr>
        `;
        return;
    }

    const hasOnlyCurrentDevice =
        devices.length === 1 && (devices[0].isCurrentDevice || devices[0].deviceHash === currentDeviceHash);
    dom.devicesNote.textContent = hasOnlyCurrentDevice
        ? 'لا توجد أجهزة أخرى مرتبطة حالياً غير هذا الجهاز.'
        : `عدد الأجهزة المرتبطة حالياً: ${devices.length}`;

    dom.devicesTbody.innerHTML = devices
        .map((device) => {
            const isCurrentDevice = !!device.isCurrentDevice || device.deviceHash === currentDeviceHash;
            const isRevoked = device.status === 'revoked';
            const linkedByLabel = LINK_METHOD_LABELS[device.linkedBy] || 'غير معروف';
            const statusLabel = DEVICE_STATUS_LABELS[device.status] || 'غير معروف';
            const deviceName = escapeHtml(device.deviceName || 'جهاز بدون اسم');
            const deviceHash = escapeHtml(String(device.deviceHash || '').slice(0, 8));
            const lastSeen = device.lastSeenAt ? formatRelativeTime(device.lastSeenAt) : 'لم يسجل بعد';

            let actionContent = '—';
            if (isAdmin && !isCurrentDevice && !isRevoked) {
                actionContent = `
                    <button
                        class="btn btn-danger btn-sm device-revoke-btn"
                        type="button"
                        data-device-hash="${escapeHtml(device.deviceHash)}"
                        data-device-name="${deviceName}"
                    >
                        <i class="fas fa-user-slash"></i> إلغاء
                    </button>
                `;
            } else if (isCurrentDevice) {
                actionContent = '<span class="device-note">هذا هو الجهاز الحالي</span>';
            }

            return `
                <tr class="${isCurrentDevice ? 'device-row-current ' : ''}${isRevoked ? 'device-row-revoked' : ''}">
                    <td>
                        <div class="device-name-stack">
                            <span class="device-row-title">${deviceName}</span>
                            <span class="device-row-subtitle"><bdi>${deviceHash || '—'}</bdi></span>
                            ${isCurrentDevice ? '<span class="device-current-badge">هذا الجهاز</span>' : ''}
                        </div>
                    </td>
                    <td><span class="device-method-badge">${linkedByLabel}</span></td>
                    <td>${lastSeen}</td>
                    <td>
                        <span class="device-status-badge ${isRevoked ? 'is-revoked' : 'is-active'}">${statusLabel}</span>
                    </td>
                    <td class="admin-only device-action-cell">${actionContent}</td>
                </tr>
            `;
        })
        .join('');
}

async function getInstitutionStatus() {
    if (window.api?.linking?.getInstitutionStatus) {
        return window.api.linking.getInstitutionStatus();
    }
    if (window.api?.setup?.getInstitutionStatus) {
        return window.api.setup.getInstitutionStatus();
    }
    return { success: false, error: 'تعذر الوصول إلى حالة المؤسسة' };
}

function normalizeSettledResult(result) {
    if (result.status === 'fulfilled') {
        return result.value;
    }
    return {
        success: false,
        error: result.reason?.message || 'حدث خطأ غير متوقع'
    };
}

async function refreshDeviceManagement(options = {}) {
    const { showLoading = false } = options;
    const dom = cacheDeviceManagementDom();
    if (!dom.section || !window.api?.linking) {
        return;
    }

    if (deviceManagementState.refreshPromise) {
        return deviceManagementState.refreshPromise;
    }

    if (showLoading) {
        showDeviceManagementLoading();
    }

    deviceManagementState.refreshPromise = (async () => {
        try {
            const institutionStatus = await getInstitutionStatus();
            deviceManagementState.institutionStatus = institutionStatus;

            if (!institutionStatus?.success) {
                clearStoredOtp();
                showDeviceManagementSetupRequired('تعذر التحقق من حالة المؤسسة حالياً. حاول مرة أخرى.');
                return;
            }

            if (!institutionStatus.setupCompleted) {
                clearStoredOtp();
                showDeviceManagementSetupRequired('يجب إتمام إعداد المؤسسة أولاً قبل إدارة الأجهزة المرتبطة.');
                return;
            }

            showDeviceManagementContent();

            const requests = [
                window.api.linking.getCurrentDevice(),
                window.api.linking.getLinkedDevices(),
                isAdmin ? window.api.linking.getOtpStatus() : Promise.resolve({ success: true, active: false })
            ];
            const [currentResult, devicesResult, otpResult] = (await Promise.allSettled(requests)).map(
                normalizeSettledResult
            );
            const currentDevice = renderCurrentDevice(currentResult, institutionStatus);
            renderLinkedDevices(devicesResult, currentDevice?.deviceHash || null);
            if (isAdmin) {
                renderOtpState(otpResult);
            } else {
                showOtpInitialState();
            }
        } catch (err) {
            console.warn('refreshDeviceManagement error:', err);
            showDeviceManagementSetupRequired('تعذر تحميل إدارة الأجهزة حالياً. حاول مرة أخرى.');
        } finally {
            deviceManagementState.refreshPromise = null;
        }
    })();

    return deviceManagementState.refreshPromise;
}

async function handleGenerateOtp() {
    const dom = deviceManagementState.dom;
    const button = dom.generateOtpBtn;
    if (!button) return;

    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التوليد...';

    try {
        const result = await window.api.linking.generateOtp();
        if (!result?.success || !result.otp || !result.expiresAt) {
            showToast(result?.error || 'تعذر توليد كود الربط', 'error');
            return;
        }

        storeOtp(result.otp, result.expiresAt);
        renderOtpState({
            success: true,
            active: true,
            otp: result.otp,
            expiresAt: result.expiresAt,
            remainingSeconds: result.remainingSeconds,
            preferredLanIp: result.preferredLanIp,
            lanEndpoints: result.lanEndpoints
        });

        if (result.lanServerStarted === false) {
            const reason = result.lanServerError || 'سبب غير معروف';
            showToast(
                'تنبيه: تعذر تشغيل خادم الشبكة المحلية (' + reason + '). قد يحتاج الجهاز الثاني إلى إدخال عنوان Wi-Fi أو Ethernet المعروض هنا يدوياً.',
                'warning'
            );
        } else {
            showToast('تم توليد كود الربط بنجاح', 'success');
        }
    } catch (err) {
        console.error('generateOtp error:', err);
        showToast('حدث خطأ أثناء توليد كود الربط', 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = originalHtml;
    }
}

async function handleCancelOtp() {
    const dom = deviceManagementState.dom;
    const button = dom.cancelOtpBtn;
    if (!button) return;

    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإلغاء...';

    try {
        const result = await window.api.linking.cancelOtp();
        if (!result?.success) {
            showToast(result?.error || 'تعذر إلغاء الكود الحالي', 'error');
            return;
        }

        clearStoredOtp();
        showOtpInitialState();
        showToast(result.message || 'تم إلغاء كود الربط', 'success');
    } catch (err) {
        console.error('cancelOtp error:', err);
        showToast('حدث خطأ أثناء إلغاء الكود', 'error');
    } finally {
        button.disabled = false;
        button.innerHTML = originalHtml;
    }
}

async function handleDeviceRevoke(event) {
    const button = event.target.closest('.device-revoke-btn');
    if (!button) return;

    const deviceHash = String(button.dataset.deviceHash || '').trim();
    const deviceName = button.dataset.deviceName || 'هذا الجهاز';
    if (!deviceHash) return;

    const confirmed = window.confirm(`هل تريد تأكيد إلغاء ربط الجهاز "${deviceName}"؟`);
    if (!confirmed) return;

    const originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التنفيذ...';

    try {
        const result = await window.api.linking.revokeDevice(deviceHash);
        if (!result?.success) {
            showToast(result?.error || 'تعذر إلغاء الجهاز المحدد', 'error');
            button.disabled = false;
            button.innerHTML = originalHtml;
            return;
        }

        showToast(result.message || 'تم إلغاء الجهاز بنجاح', 'success');
        await refreshDeviceManagement();
    } catch (err) {
        console.error('revokeDevice error:', err);
        showToast('حدث خطأ أثناء إلغاء الجهاز', 'error');
        button.disabled = false;
        button.innerHTML = originalHtml;
    }
}

function initDeviceManagement() {
    const dom = cacheDeviceManagementDom();
    if (!dom.section || deviceManagementState.initialized) return;

    dom.retryButtons.forEach((button) => {
        button.addEventListener('click', () => {
            refreshDeviceManagement({ showLoading: true });
        });
    });
    dom.generateOtpBtn?.addEventListener('click', handleGenerateOtp);
    dom.cancelOtpBtn?.addEventListener('click', handleCancelOtp);
    dom.devicesTbody?.addEventListener('click', handleDeviceRevoke);

    showOtpInitialState();
    deviceManagementState.initialized = true;
}

// ==================== Initialize (after DOM) ====================

// These run after DOMContentLoaded fires (the listener above handles data loading)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initSyncToggle();
        initConfigForm();
        initTestConnection();
        initSyncNow();
        initConflictHandlers();
        initDeviceManagement();
    });
} else {
    initSyncToggle();
    initConfigForm();
    initTestConnection();
    initSyncNow();
    initConflictHandlers();
    initDeviceManagement();
}
