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
let otpCountdownTimer = null;
const conflictRowState = new WeakMap();

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
    if (!isAdmin) {
        document.body.classList.add('sync-readonly');
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

function createLinkedDeviceRow(device, currentDeviceHash) {
    const row = document.createElement('tr');
    const isCurrentDevice = !!device.isCurrentDevice || device.deviceHash === currentDeviceHash;
    const isRevoked = device.status === 'revoked';
    row.className = `${isCurrentDevice ? 'device-row-current ' : ''}${isRevoked ? 'device-row-revoked' : ''}`.trim();

    const nameCell = document.createElement('td');
    const stack = document.createElement('div');
    stack.className = 'device-name-stack';
    const title = document.createElement('span');
    title.className = 'device-row-title';
    title.textContent = device.deviceName || 'جهاز بدون اسم';
    const subtitle = document.createElement('span');
    subtitle.className = 'device-row-subtitle';
    const code = document.createElement('bdi');
    code.textContent = String(device.deviceHash || '').slice(0, 8) || '—';
    subtitle.appendChild(code);
    stack.appendChild(title);
    stack.appendChild(subtitle);
    if (isCurrentDevice) {
        const badge = document.createElement('span');
        badge.className = 'device-current-badge';
        badge.textContent = 'هذا الجهاز';
        stack.appendChild(badge);
    }
    nameCell.appendChild(stack);

    const linkedByCell = document.createElement('td');
    const methodBadge = document.createElement('span');
    methodBadge.className = 'device-method-badge';
    methodBadge.textContent = LINK_METHOD_LABELS[device.linkedBy] || 'غير معروف';
    linkedByCell.appendChild(methodBadge);

    const lastSeenCell = document.createElement('td');
    lastSeenCell.textContent = device.lastSeenAt ? formatRelativeTime(device.lastSeenAt) : 'لم يسجل بعد';

    const statusCell = document.createElement('td');
    const statusBadge = document.createElement('span');
    statusBadge.className = `device-status-badge ${isRevoked ? 'is-revoked' : 'is-active'}`;
    statusBadge.textContent = DEVICE_STATUS_LABELS[device.status] || 'غير معروف';
    statusCell.appendChild(statusBadge);

    const actionCell = document.createElement('td');
    actionCell.className = 'admin-only device-action-cell';
    if (isAdmin && !isCurrentDevice && !isRevoked) {
        const button = document.createElement('button');
        button.className = 'btn btn-danger btn-sm device-revoke-btn';
        button.type = 'button';
        button.dataset.deviceHash = String(device.deviceHash || '');
        button.dataset.deviceName = device.deviceName || 'هذا الجهاز';
        button.appendChild(createSyncIcon('fa-user-slash'));
        appendText(button, ' إلغاء');
        actionCell.appendChild(button);
    } else if (isCurrentDevice) {
        const note = document.createElement('span');
        note.className = 'device-note';
        note.textContent = 'هذا هو الجهاز الحالي';
        actionCell.appendChild(note);
    } else {
        actionCell.textContent = '—';
    }

    row.append(nameCell, linkedByCell, lastSeenCell, statusCell, actionCell);
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
        console.warn('loadConfig error:', err);
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
            console.error('setConfig error:', err);
            showToast('حدث خطأ أثناء الحفظ', 'error');
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
            if (resultDiv) {
                resultDiv.classList.remove('hidden');
                resultDiv.className =
                    'mt-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] px-4 py-3 text-sm text-[var(--color-danger-text)]';
                resultDiv.textContent = err.message || 'خطأ غير متوقع';
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
            const result = await window.api.sync.triggerNow();

            // Show results
            const resultsDiv = document.getElementById('sync-results');
            if (resultsDiv && result) {
                resultsDiv.classList.remove('hidden');
                renderSyncResultsPanel(resultsDiv, result);
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
    const preferredIpText = currentResult.preferredLanIp
        ? ` • IP الربط الموصى به: ${currentResult.preferredLanIp}`
        : '';
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
        dom.devicesTbody.replaceChildren();
        return;
    }

    const devices = Array.isArray(devicesResult.devices) ? devicesResult.devices : [];
    dom.devicesError?.classList.add('hidden');
    dom.devicesTableWrap?.classList.remove('hidden');
    dom.devicesCount.textContent = String(devices.length);

    if (!devices.length) {
        dom.devicesNote.textContent = 'لا توجد أجهزة مرتبطة بهذه المؤسسة حالياً.';
        const emptyRow = createEmptyTableRow(5, 'لا توجد أي أجهزة مرتبطة بالمؤسسة حالياً.');
        emptyRow.className = 'device-empty-row';
        dom.devicesTbody.replaceChildren(emptyRow);
        return;
    }

    const hasOnlyCurrentDevice =
        devices.length === 1 && (devices[0].isCurrentDevice || devices[0].deviceHash === currentDeviceHash);
    dom.devicesNote.textContent = hasOnlyCurrentDevice
        ? 'لا توجد أجهزة أخرى مرتبطة حالياً غير هذا الجهاز.'
        : `عدد الأجهزة المرتبطة حالياً: ${devices.length}`;

    dom.devicesTbody.replaceChildren(...devices.map((device) => createLinkedDeviceRow(device, currentDeviceHash)));
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
                'تنبيه: تعذر تشغيل خادم الشبكة المحلية (' +
                    reason +
                    '). قد يحتاج الجهاز الثاني إلى إدخال عنوان Wi-Fi أو Ethernet المعروض هنا يدوياً.',
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

    const { confirmed } = await showConfirm({
        title: 'إلغاء ربط الجهاز',
        message: `هل تريد تأكيد إلغاء ربط الجهاز "${deviceName}"؟`,
        type: 'warning',
        confirmText: 'إلغاء الربط'
    });
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
        initConfigForm();
        initTestConnection();
        initSyncNow();
        initConflictHandlers();
        initDeviceManagement();
    });
} else {
    initConfigForm();
    initTestConnection();
    initSyncNow();
    initConflictHandlers();
    initDeviceManagement();
}
