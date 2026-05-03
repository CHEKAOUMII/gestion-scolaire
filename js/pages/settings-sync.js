/**
 * Sync Settings Page — js/pages/settings-sync.js
 * إعدادات المزامنة السحابية
 * ⚠️ Sync config section restricted to role === 'admin' OR 'developer'
 * Sync activation is automatic after institution linking/setup; no user toggle.
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
    } catch (_) {
        /* */
    }
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

let statusTimer = null;
let isAdmin = false;
let currentOffset = 0;
const conflictPageSize = 50;
const conflictRowState = new WeakMap();
const syncErrorNoticeState = new Map();
const SYNC_ERROR_TOAST_COOLDOWN_MS = 30000;

function getErrorMessage(err, fallback = 'خطأ غير متوقع') {
    return String(err?.message || err?.error || err || fallback);
}

function notifySyncError(key, userMessage, err, options = {}) {
    const details = getErrorMessage(err, userMessage);
    const shouldLog = options.log !== false;
    const shouldToast = options.toast !== false;
    const now = Date.now();
    const lastShownAt = syncErrorNoticeState.get(key) || 0;
    const immediate = options.immediate === true;

    if (shouldLog) {
        console.error(`[settings-sync] ${key}:`, err);
    }

    if (!shouldToast || typeof showToast !== 'function') {
        return;
    }

    if (!immediate && now - lastShownAt < SYNC_ERROR_TOAST_COOLDOWN_MS) {
        return;
    }

    syncErrorNoticeState.set(key, now);
    showToast(`${userMessage}${details && details !== userMessage ? ': ' + details : ''}`, 'error', options.duration || 5000);
}

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
    window.addEventListener('beforeunload', () => {
        clearInterval(statusTimer);
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

function createSyncIcon(iconName, extraClass = '') {
    const icon = document.createElement('i');
    icon.className = `fas ${iconName}${extraClass ? ` ${extraClass}` : ''}`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function appendText(parent, text) {
    parent.appendChild(document.createTextNode(String(text ?? '')));
}

function createSyncInfoLine({ iconName, iconClass = '', text = '', className = 'text-sm' }) {
    const line = document.createElement('p');
    line.className = className;
    if (iconName) {
        line.appendChild(createSyncIcon(iconName, iconClass));
        appendText(line, ' ');
    }
    appendText(line, text);
    return line;
}

function createSyncResultCard(title, titleIcon, contentNodes = []) {
    const card = document.createElement('div');
    card.className = 'rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3';

    const heading = document.createElement('h4');
    heading.className = 'mb-2 font-bold text-[var(--color-text-main)]';
    heading.appendChild(createSyncIcon(titleIcon, 'me-1'));
    appendText(heading, ` ${title}`);
    card.appendChild(heading);

    contentNodes.forEach((node) => card.appendChild(node));
    return card;
}

function renderSyncResultsPanel(container, result) {
    if (!container) return;

    const grid = document.createElement('div');
    grid.className = 'grid gap-3 sm:grid-cols-3';

    const buildStageNodes = (stage, summaryTextBuilder) => {
        if (!stage) {
            return [createSyncInfoLine({ text: '—', className: 'text-sm text-[var(--color-text-muted)]' })];
        }

        if (stage.skipped) {
            return [
                createSyncInfoLine({
                    text: `تم التخطي: ${stage.reason || '—'}`,
                    className: 'text-sm text-[var(--color-text-muted)]'
                })
            ];
        }

        const success = !!stage.success;
        const summary = createSyncInfoLine({
            iconName: success ? 'fa-check-circle' : 'fa-times-circle',
            iconClass: success ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]',
            text: summaryTextBuilder(stage)
        });

        const nodes = [summary];
        if (stage.lastError) {
            nodes.push(
                createSyncInfoLine({
                    text: stage.lastError,
                    className: 'mt-1 text-xs text-[var(--color-danger-text)]'
                })
            );
        }
        return nodes;
    };

    grid.appendChild(
        createSyncResultCard(
            'الرفع',
            'fa-upload',
            buildStageNodes(result.push, (stage) => `أُرسل: ${stage.sentCount ?? 0} | فشل: ${stage.failedCount ?? 0}`)
        )
    );
    grid.appendChild(
        createSyncResultCard(
            'السحب',
            'fa-download',
            buildStageNodes(
                result.pull,
                (stage) => `تطبيق: ${stage.appliedCount ?? 0} | تعارضات: ${stage.conflictCount ?? 0}`
            )
        )
    );
    grid.appendChild(
        createSyncResultCard(
            'الفحص',
            'fa-camera',
            buildStageNodes(
                result.snapshot,
                (stage) => `تغييرات: ${stage.changesDetected ?? 0} | إضافة: ${stage.enqueued ?? 0}`
            )
        )
    );

    const nodes = [grid];
    if (result?.error) {
        nodes.push(
            createSyncInfoLine({
                iconName: 'fa-exclamation-circle',
                iconClass: 'me-1 text-[var(--color-danger-text)]',
                text: result.error,
                className: 'mt-3 text-sm text-[var(--color-danger-text)]'
            })
        );
    }

    container.replaceChildren(...nodes);
}

function buildHighlightedJsonFragment(data, conflictingFields) {
    const fragment = document.createDocumentFragment();
    if (!data) {
        fragment.appendChild(document.createTextNode('—'));
        return fragment;
    }

    const content = JSON.stringify(data, null, 2);
    if (!content) {
        fragment.appendChild(document.createTextNode('—'));
        return fragment;
    }

    if (!Array.isArray(conflictingFields) || !conflictingFields.length) {
        fragment.appendChild(document.createTextNode(content));
        return fragment;
    }

    const matcher = new RegExp(
        `(${conflictingFields.map((field) => `"${String(field).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).join('|')})`,
        'g'
    );
    let lastIndex = 0;
    let match = matcher.exec(content);

    while (match) {
        if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(content.slice(lastIndex, match.index)));
        }
        const highlight = document.createElement('span');
        highlight.className = 'font-bold text-[var(--color-danger-text)]';
        highlight.textContent = match[0];
        fragment.appendChild(highlight);
        lastIndex = match.index + match[0].length;
        match = matcher.exec(content);
    }

    if (lastIndex < content.length) {
        fragment.appendChild(document.createTextNode(content.slice(lastIndex)));
    }

    return fragment;
}

function createConflictStatusBadge(status) {
    const badge = document.createElement('span');
    badge.className =
        status === 'unresolved'
            ? 'inline-block rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-xs text-white'
            : 'inline-block rounded-full bg-[var(--color-success-bg)] px-2 py-0.5 text-xs text-white';
    badge.textContent = status === 'unresolved' ? 'غير محلول' : 'محلول';
    return badge;
}

function createConflictActionButton({ className, iconName, label, title, dataset = {} }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    if (title) button.title = title;
    Object.entries(dataset).forEach(([key, value]) => {
        button.dataset[key] = value;
    });
    button.appendChild(createSyncIcon(iconName));
    if (label) appendText(button, ` ${label}`);
    return button;
}

function createConflictRow(conflict, index) {
    const row = document.createElement('tr');
    conflictRowState.set(row, conflict);

    const cells = [
        String(index),
        entityTypeLabels[conflict.entityType] || conflict.entityType,
        null,
        Array.isArray(conflict.conflictingFields) ? conflict.conflictingFields.join(', ') || '—' : '—',
        null,
        formatRelativeTime(conflict.createdAt),
        null
    ];

    cells.forEach((value, cellIndex) => {
        const td = document.createElement('td');
        if (cellIndex === 2) {
            const shortId =
                conflict.rowSyncId && conflict.rowSyncId.length > 12
                    ? `${conflict.rowSyncId.substring(0, 12)}…`
                    : conflict.rowSyncId || '—';
            td.title = conflict.rowSyncId || '';
            td.textContent = shortId;
        } else if (cellIndex === 4) {
            td.appendChild(createConflictStatusBadge(conflict.status));
        } else if (cellIndex === 6) {
            td.className = 'admin-only';
            td.appendChild(
                createConflictActionButton({
                    className: 'btn btn-sm btn-secondary conflict-expand-btn',
                    iconName: 'fa-eye',
                    title: 'عرض التفاصيل'
                })
            );
            if (conflict.status === 'unresolved' && isAdmin) {
                td.appendChild(document.createTextNode(' '));
                td.appendChild(
                    createConflictActionButton({
                        className: 'btn btn-sm btn-primary admin-only conflict-resolve-btn',
                        iconName: 'fa-desktop',
                        label: 'محلي',
                        dataset: { id: String(conflict.id), action: 'local' }
                    })
                );
                td.appendChild(document.createTextNode(' '));
                td.appendChild(
                    createConflictActionButton({
                        className: 'btn btn-sm btn-warning admin-only conflict-resolve-btn',
                        iconName: 'fa-cloud',
                        label: 'بعيد',
                        dataset: { id: String(conflict.id), action: 'remote' }
                    })
                );
            }
        } else {
            td.textContent = value;
        }
        row.appendChild(td);
    });

    return row;
}

function createConflictDetailRow(conflict) {
    const detailRow = document.createElement('tr');
    detailRow.className = 'conflict-detail-row';
    const td = document.createElement('td');
    td.colSpan = 7;

    const wrapper = document.createElement('div');
    wrapper.className = 'flex gap-4 p-3';

    const createPane = (title, iconName, data) => {
        const pane = document.createElement('div');
        pane.className = 'flex-1';
        const heading = document.createElement('div');
        heading.className = 'mb-1 text-sm font-bold text-[var(--color-text-muted)]';
        heading.appendChild(createSyncIcon(iconName, 'me-1'));
        appendText(heading, ` ${title}`);
        const pre = document.createElement('pre');
        pre.className = 'max-h-60 overflow-auto rounded bg-[var(--glass-bg)] p-2 text-xs';
        pre.appendChild(
            buildHighlightedJsonFragment(
                data,
                Array.isArray(conflict.conflictingFields) ? conflict.conflictingFields : []
            )
        );
        pane.appendChild(heading);
        pane.appendChild(pre);
        return pane;
    };

    wrapper.appendChild(createPane('البيانات البعيدة', 'fa-cloud', conflict.remoteData));
    wrapper.appendChild(createPane('البيانات المحلية', 'fa-desktop', conflict.localData));
    td.appendChild(wrapper);
    detailRow.appendChild(td);
    return detailRow;
}

function createEmptyTableRow(colspan, text, className = '') {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = colspan;
    if (className) cell.className = className;
    cell.textContent = text;
    row.appendChild(cell);
    return row;
}

/**
 * Derive sync state from status object.
 */
function deriveSyncState(status) {
    if (!status || !status.configured) return 'disabled';
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
            banner.className = 'mb-4 flex items-center gap-3 rounded-xl border px-4 py-3.5';
            let bannerIcon = '';
            let bannerText = '';
            switch (state) {
                case 'connected':
                    banner.classList.add(
                        'border-[var(--color-success-border)]',
                        'bg-[var(--color-success-surface)]',
                        'text-[var(--color-success-text)]'
                    );
                    bannerIcon = '<i class="fas fa-check-circle text-xl"></i>';
                    bannerText = 'متصل ومزامن';
                    break;
                case 'syncing':
                    banner.classList.add(
                        'border-[var(--color-success-border)]',
                        'bg-[var(--color-success-surface)]',
                        'text-[var(--color-success-text)]'
                    );
                    bannerIcon = '<i class="fas fa-sync fa-spin text-xl"></i>';
                    bannerText = 'جاري المزامنة...';
                    break;
                case 'offline':
                    banner.classList.add(
                        'border-[var(--color-warning-border)]',
                        'bg-[var(--color-warning-surface)]',
                        'text-[var(--color-warning-text)]'
                    );
                    bannerIcon = '<i class="fas fa-exclamation-triangle text-xl"></i>';
                    bannerText = 'غير متصل — التغييرات في قائمة الانتظار';
                    break;
                case 'error':
                    banner.classList.add(
                        'border-[var(--color-danger-border)]',
                        'bg-[var(--color-danger-surface)]',
                        'text-[var(--color-danger-text)]'
                    );
                    bannerIcon = '<i class="fas fa-times-circle text-xl"></i>';
                    bannerText = status.lastPushError || status.lastPullError || 'خطأ في المزامنة';
                    break;
                case 'disabled':
                    banner.classList.add(
                        'border-[var(--color-neutral-border)]',
                        'bg-[var(--color-neutral-surface)]',
                        'text-[var(--color-neutral-text)]'
                    );
                    bannerIcon = '<i class="fas fa-pause-circle text-xl"></i>';
                    bannerText = 'المزامنة تنتظر إعداد المؤسسة';
                    break;
            }
            banner.innerHTML = `${bannerIcon}<span class="font-bold">${bannerText}</span>`;
        }

        // Update KPI cards
        // 1. Connection state
        const connEl = document.getElementById('status-connection');
        if (connEl) {
            const stateMap = {
                connected: { icon: 'fa-check-circle text-[var(--color-success-text)]', label: 'متصل' },
                syncing: { icon: 'fa-sync fa-spin text-[var(--color-success-text)]', label: 'مزامنة' },
                offline: { icon: 'fa-exclamation-triangle text-[var(--color-warning-text)]', label: 'غير متصل' },
                error: { icon: 'fa-times-circle text-[var(--color-danger-text)]', label: 'خطأ' },
                disabled: { icon: 'fa-pause-circle text-[var(--color-text-muted)]', label: 'غير مهيأة' }
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
                    errDiv.className = 'kpi-error mt-1 text-xs text-[var(--color-danger-text)]';
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
                    errDiv.className = 'kpi-error mt-1 text-xs text-[var(--color-danger-text)]';
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
                (status.pendingCount > 0 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-success-text)]');
        }

        // 5. Failed count
        const failedEl = document.getElementById('status-failed');
        if (failedEl) {
            failedEl.textContent = status.failedCount ?? '—';
            failedEl.className =
                'text-lg font-bold ' +
                (status.failedCount > 0 ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-success-text)]');
        }

        // 6. Conflict count
        const conflictEl = document.getElementById('status-conflicts');
        if (conflictEl) {
            conflictEl.textContent = status.conflictCount ?? '—';
            conflictEl.className =
                'text-lg font-bold ' +
                (status.conflictCount > 0 ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-success-text)]');
        }

        // 7. Last snapshot
        const snapEl = document.getElementById('status-last-snapshot');
        if (snapEl) {
            snapEl.textContent = formatRelativeTime(status.lastSnapshotAt);
        }

        // Control Sync Now button state (US3)
        const syncNowBtn = document.getElementById('btn-sync-now');
        if (syncNowBtn) {
            if (!status.configured) {
                syncNowBtn.disabled = true;
                syncNowBtn.title = 'أكمل إعداد المؤسسة أولاً';
            } else if (status.pushRunning || status.pullRunning) {
                syncNowBtn.disabled = true;
                syncNowBtn.title = 'المزامنة جارية';
            } else {
                syncNowBtn.disabled = false;
                syncNowBtn.title = '';
            }
        }
    } catch (err) {
        notifySyncError('refreshStatus', 'تعذر تحديث حالة المزامنة', err, { immediate: false });
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
        setVal('cfg-school-id', config.schoolId || '');
        setVal('cfg-functions-url', config.firebaseFunctionsUrl || '');
        setVal('cfg-project-id', config.firebaseProjectId || '');
        setVal('cfg-api-key', config.firebaseApiKey || '');
        setVal('cfg-auth-domain', config.firebaseAuthDomain || '');
        setVal('cfg-app-id', config.firebaseAppId || '');
        setVal('cfg-interval', config.syncIntervalMinutes || 10);
        setVal('cfg-batch-size', config.pushBatchSize || 100);
        setVal('cfg-max-retries', config.maxRetries || 10);
        setVal('cfg-retention', config.retentionDays || 7);
        // snapshotIntervalMinutes comes from status, not config
        setVal('cfg-snapshot-interval', status?.snapshotIntervalMinutes || 30);
    } catch (err) {
        notifySyncError('loadConfig', 'تعذر تحميل إعدادات المزامنة', err, { immediate: true });
    }
}

function initConfigForm() {
    const form = document.getElementById('sync-config-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const validationDiv = document.getElementById('config-validation');

        const schoolId = document.getElementById('cfg-school-id')?.value?.trim();
        const functionsUrl = document.getElementById('cfg-functions-url')?.value?.trim();
        const projectId = document.getElementById('cfg-project-id')?.value?.trim();
        const apiKey = document.getElementById('cfg-api-key')?.value?.trim();
        const authDomain = document.getElementById('cfg-auth-domain')?.value?.trim();
        const appId = document.getElementById('cfg-app-id')?.value?.trim();
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
        if (!schoolId) {
            errors.push('معرف المؤسسة مطلوب للمزامنة');
        }
        if (!functionsUrl) {
            errors.push('رابط Firebase Functions مطلوب للمزامنة');
        }
        if (!projectId) {
            errors.push('معرف مشروع Firebase مطلوب للمزامنة');
        }
        if (!apiKey) {
            errors.push('Firebase API Key مطلوب لتسجيل الدخول السحابي');
        }
        if (!appId) {
            errors.push('Firebase App ID مطلوب لتسجيل الدخول السحابي');
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
            enabled: 1,
            schoolId,
            firebaseFunctionsUrl: functionsUrl,
            firebaseProjectId: projectId,
            firebaseApiKey: apiKey,
            firebaseAuthDomain: authDomain,
            firebaseAppId: appId,
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
            notifySyncError('setConfig', 'حدث خطأ أثناء حفظ إعدادات المزامنة', err, { immediate: true });
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
        setButtonContent(btn, { icon: 'fa-spinner', text: 'جاري الاختبار...', spin: true });
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
                        'mt-3 rounded-lg border border-[var(--color-success-border)] bg-[var(--color-success-surface)] px-4 py-3 text-sm text-[var(--color-success-text)]';
                    resultDiv.innerHTML = `<i class="fas fa-check-circle me-2"></i>الاتصال ناجح${result.schoolId ? ' — معرف المؤسسة: ' + result.schoolId : ''}`;
                } else {
                    const stepLabel = { lambda: 'Lambda', cognito: 'Cognito', dynamodb: 'DynamoDB' }[result.step] || '';
                    resultDiv.className =
                        'mt-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] px-4 py-3 text-sm text-[var(--color-danger-text)]';
                    resultDiv.innerHTML = `<i class="fas fa-times-circle me-2"></i>${stepLabel ? stepLabel + ': ' : ''}${result.error || 'فشل الاتصال'}`;
                }
            }
        } catch (err) {
            notifySyncError('testConnection', 'حدث خطأ أثناء اختبار الاتصال', err, { immediate: true });
            if (resultDiv) {
                resultDiv.classList.remove('hidden');
                resultDiv.className =
                    'mt-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] px-4 py-3 text-sm text-[var(--color-danger-text)]';
                resultDiv.textContent = getErrorMessage(err);
            }
        } finally {
            setButtonContent(btn, { icon: 'fa-plug', text: 'اختبار الاتصال' });
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

        btn.disabled = true;
        setButtonContent(btn, { icon: 'fa-spinner', text: 'جاري المزامنة...', spin: true });

        try {
            const loadingToast =
                typeof window.showToast?.loading === 'function' ? window.showToast.loading('جاري تنفيذ المزامنة...') : null;
            const result = await window.api.sync.triggerNow();

            // Show results
            const resultsDiv = document.getElementById('sync-results');
            if (resultsDiv && result) {
                resultsDiv.classList.remove('hidden');
                renderSyncResultsPanel(resultsDiv, result);
            }

            if (result?.error) {
                if (loadingToast) loadingToast.error(result.error);
                else showToast(result.error, 'error');
            } else if (loadingToast) {
                loadingToast.success('اكتملت المزامنة');
            }

            await refreshStatus();
        } catch (err) {
            notifySyncError('triggerNow', 'حدث خطأ أثناء المزامنة', err, { immediate: true });
        } finally {
            btn.disabled = false;
            setButtonContent(btn, { icon: 'fa-sync', text: 'مزامنة الآن' });
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
            tbody.replaceChildren(createEmptyTableRow(7, 'لا توجد تعارضات', 'loading-cell'));
            if (badge) badge.textContent = '';
            updateConflictPagination(0);
            return;
        }

        if (badge) badge.textContent = conflicts.length >= conflictPageSize ? `${conflictPageSize}+` : conflicts.length;
        tbody.replaceChildren(
            ...conflicts.map((conflict, index) => createConflictRow(conflict, currentOffset + index + 1))
        );

        updateConflictPagination(conflicts.length);
    } catch (err) {
        notifySyncError('loadConflicts', 'تعذر تحميل تعارضات المزامنة', err, { immediate: false });
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
            const conflict = conflictRowState.get(row);
            if (!conflict) return;
            const detailRow = createConflictDetailRow(conflict);
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
                notifySyncError('resolveConflict', 'حدث خطأ أثناء حل التعارض', err, { immediate: true });
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
        initTestConnection();
        initSyncNow();
        initConflictHandlers();
    });
} else {
    initConfigForm();
    initTestConnection();
    initSyncNow();
    initConflictHandlers();
}
