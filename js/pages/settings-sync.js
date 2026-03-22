/**
 * Sync Settings Page — js/pages/settings-sync.js
 * إعدادات المزامنة السحابية
 */

let statusTimer = null;
let isAdmin = false;
let currentOffset = 0;
const conflictPageSize = 50;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check user role
    try {
        const rawSession = localStorage.getItem('gsl_auth_session_v1');
        if (rawSession) {
            const sess = JSON.parse(rawSession);
            const role = String(sess?.role || '').toLowerCase();
            isAdmin = role === 'admin';
        }
    } catch (_) {
        /* ignore parse errors */
    }

    // 2. Hide admin-only elements for non-admin users
    if (!isAdmin) {
        document.body.classList.add('sync-readonly');
    }

    // 3. Load initial data
    await loadConfig();
    await refreshStatus();
    await loadConflicts();

    // 4. Set up auto-refresh (every 10 seconds)
    statusTimer = setInterval(refreshStatus, 10000);

    // 5. Cleanup on page unload
    window.addEventListener('beforeunload', () => clearInterval(statusTimer));
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

        setChecked('cfg-enabled', config.enabled);
        setVal('cfg-school-id', config.schoolId || '');
        setVal('cfg-auth-url', config.authLambdaUrl || '');
        setVal('cfg-region', config.awsRegion || 'us-east-1');
        setVal('cfg-interval', config.syncIntervalMinutes || 10);
        setVal('cfg-batch-size', config.pushBatchSize || 100);
        setVal('cfg-max-retries', config.maxRetries || 10);
        setVal('cfg-retention', config.retentionDays || 7);
        // snapshotIntervalMinutes comes from status, not config
        setVal('cfg-snapshot-interval', status?.snapshotIntervalMinutes || 30);
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

        const enabled = document.getElementById('cfg-enabled')?.checked;
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

// ==================== Initialize (after DOM) ====================

// These run after DOMContentLoaded fires (the listener above handles data loading)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initConfigForm();
        initSyncNow();
        initConflictHandlers();
    });
} else {
    initConfigForm();
    initSyncNow();
    initConflictHandlers();
}
