/**
 * Sync Settings Page — js/pages/settings-sync.js
 * إعدادات المزامنة السحابية
 * ⚠️ Sync config, conflict log, and forensics actions are restricted to admin/developer users.
 * Sync activation is automatic after institution linking/setup; no user toggle.
 */

const SYNC_ADMIN_ROLES = new Set(['admin', 'developer']);
const AUTH_FAILURE_CODES = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_LOCKED']);
const SYNC_ERROR_TOAST_COOLDOWN_MS = 30000;

let statusTimer = null;
let isAdmin = canManageSync();
let currentOffset = 0;
const conflictPageSize = 50;
const conflictRowState = new WeakMap();
const syncErrorNoticeState = new Map();

if (!isAdmin && document.body) {
    document.body.classList.add('sync-readonly');
}

function readLocalSession() {
    try {
        const rawSession = localStorage.getItem('gsl_auth_session_v1');
        return rawSession ? JSON.parse(rawSession) : null;
    } catch (err) {
        console.warn('[settings-sync] ignored invalid local auth session:', err);
        return null;
    }
}

function canManageSync() {
    const role = String(readLocalSession()?.role || '').toLowerCase();
    return SYNC_ADMIN_ROLES.has(role);
}

function applySyncAccessMode() {
    document.body.classList.toggle('sync-readonly', !isAdmin);
}

function isAuthFailure(response) {
    return response?.success === false && AUTH_FAILURE_CODES.has(response.code);
}

function requireSyncAdmin(actionLabel = 'تنفيذ هذا الإجراء') {
    if (isAdmin) return true;
    if (typeof showToast === 'function') {
        showToast(`ليست لديك صلاحية ${actionLabel}`, 'error');
    }
    return false;
}

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
    showToast(
        `${userMessage}${details && details !== userMessage ? ': ' + details : ''}`,
        'error',
        options.duration || 5000
    );
}

document.addEventListener('DOMContentLoaded', async () => {
    isAdmin = canManageSync();
    applySyncAccessMode();

    if (isAdmin) {
        await loadConfig();
    }
    await refreshStatus();
    if (isAdmin) {
        await loadConflicts();
    }

    statusTimer = setInterval(refreshStatus, 10000);

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

function createInlineCode(text) {
    const code = document.createElement('code');
    code.dir = 'ltr';
    code.textContent = String(text ?? '');
    return code;
}

function setLiveRegionTone(container, tone = 'status') {
    if (!container) return;
    const isAlert = tone === 'danger' || tone === 'error';
    container.setAttribute('role', isAlert ? 'alert' : 'status');
    container.setAttribute('aria-live', isAlert ? 'assertive' : 'polite');
    container.setAttribute('aria-atomic', 'true');
}

function createSyncStatusBannerIcon(iconName, iconClass = '') {
    const wrapper = document.createElement('div');
    wrapper.className = 'sync-status-banner-icon';
    const indicator = document.createElement('span');
    indicator.className = 'sync-status-banner-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    wrapper.append(indicator, createSyncIcon(iconName, iconClass));
    return wrapper;
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
    card.className = 'min-w-0 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3';

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

    setLiveRegionTone(container, result?.error || result?.success === false ? 'danger' : 'status');

    const grid = document.createElement('div');
    grid.className = 'grid min-w-0 gap-3 sm:grid-cols-3';

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

function createConflictActionButton({
    className,
    iconName,
    label,
    title,
    ariaLabel,
    controls,
    expanded,
    dataset = {}
}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    if (title) button.title = title;
    const accessibleName = ariaLabel || title || label;
    if (accessibleName) button.setAttribute('aria-label', accessibleName);
    if (controls) button.setAttribute('aria-controls', controls);
    if (expanded !== undefined) button.setAttribute('aria-expanded', String(expanded));
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
            const detailId = `conflict-detail-${conflict.id}`;
            td.className = 'admin-only';
            td.appendChild(
                createConflictActionButton({
                    className: 'btn btn-sm btn-secondary conflict-expand-btn',
                    iconName: 'fa-eye',
                    title: 'عرض تفاصيل التعارض',
                    ariaLabel: 'عرض تفاصيل التعارض',
                    controls: detailId,
                    expanded: false
                })
            );
            if (conflict.status === 'unresolved' && isAdmin) {
                td.appendChild(document.createTextNode(' '));
                td.appendChild(
                    createConflictActionButton({
                        className: 'btn btn-sm btn-primary admin-only conflict-resolve-btn',
                        iconName: 'fa-desktop',
                        label: 'محلي',
                        ariaLabel: 'استخدام النسخة المحلية لحل التعارض',
                        dataset: { id: String(conflict.id), action: 'local' }
                    })
                );
                td.appendChild(document.createTextNode(' '));
                td.appendChild(
                    createConflictActionButton({
                        className: 'btn btn-sm btn-warning admin-only conflict-resolve-btn',
                        iconName: 'fa-cloud',
                        label: 'بعيد',
                        ariaLabel: 'استخدام النسخة البعيدة لحل التعارض',
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
    detailRow.id = `conflict-detail-${conflict.id}`;
    const td = document.createElement('td');
    td.colSpan = 7;

    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col gap-4 p-3 lg:flex-row';

    const createPane = (title, iconName, data) => {
        const pane = document.createElement('div');
        pane.className = 'min-w-0 flex-1';
        const heading = document.createElement('div');
        heading.className = 'mb-1 text-sm font-bold text-[var(--color-text-muted)]';
        heading.appendChild(createSyncIcon(iconName, 'me-1'));
        appendText(heading, ` ${title}`);
        const pre = document.createElement('pre');
        pre.className = 'max-h-60 overflow-auto rounded bg-[var(--glass-bg)] p-2 text-xs';
        pre.dir = 'ltr';
        pre.tabIndex = 0;
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
 *
 * The spinning 'syncing' state is driven from `pushCycleActive` / `pullCycleActive`
 * (an actual in-flight cycle), NOT from `pushRunning`/`pullRunning` which only
 * report whether the background timer is installed. A stalled engine — timer
 * installed but every cycle failing with permission-denied — used to spin forever
 * because `pushRunning` stayed true; with the cycle flags it correctly falls through
 * to the `error` branch between ticks so the translated message is shown.
 */
function deriveSyncState(status) {
    if (!status || !status.configured) return 'disabled';
    if (status.pushCycleActive || status.pullCycleActive || status.snapshotRunning) return 'syncing';
    if (!status.authenticated) return 'offline';
    if (status.lastPushError || status.lastPullError) return 'error';
    return 'connected';
}

async function refreshStatus() {
    try {
        const status = await window.api.sync.getStatus();
        if (!status) return;

        const state = deriveSyncState(status);

        const stateMap = {
            connected: {
                bannerClass: 'sync-status-banner--success',
                icon: 'fa-check-circle',
                iconClass: 'text-xl',
                label: 'متصل ومزامن',
                connectionLabel: 'متصل',
                connectionIconClass: 'text-[var(--color-success-text)]'
            },
            syncing: {
                bannerClass: 'sync-status-banner--success',
                icon: 'fa-sync',
                iconClass: 'fa-spin text-xl',
                label: 'جاري المزامنة...',
                connectionLabel: 'مزامنة',
                connectionIconClass: 'fa-spin text-[var(--color-success-text)]'
            },
            offline: {
                bannerClass: 'sync-status-banner--warning',
                icon: 'fa-exclamation-triangle',
                iconClass: 'text-xl',
                label: 'غير متصل — التغييرات في قائمة الانتظار',
                connectionLabel: 'غير متصل',
                connectionIconClass: 'text-[var(--color-warning-text)]'
            },
            error: {
                bannerClass: 'sync-status-banner--danger',
                icon: 'fa-times-circle',
                iconClass: 'text-xl',
                label: status.lastPushError || status.lastPullError || 'خطأ في المزامنة',
                connectionLabel: 'خطأ',
                connectionIconClass: 'text-[var(--color-danger-text)]'
            },
            disabled: {
                bannerClass: 'sync-status-banner--neutral',
                icon: 'fa-pause-circle',
                iconClass: 'text-xl',
                label: 'المزامنة تنتظر إعداد المؤسسة',
                connectionLabel: 'غير مهيأة',
                connectionIconClass: 'text-[var(--color-text-muted)]'
            }
        };
        const stateMeta = stateMap[state] || stateMap.disabled;

        const banner = document.getElementById('sync-state-banner');
        if (banner) {
            const text = document.createElement('span');
            text.className = 'font-bold';
            text.textContent = stateMeta.label;
            banner.className = `sync-status-banner ${stateMeta.bannerClass}`;
            banner.replaceChildren(createSyncStatusBannerIcon(stateMeta.icon, stateMeta.iconClass), text);
        }

        const connEl = document.getElementById('status-connection');
        if (connEl) {
            connEl.replaceChildren(
                createSyncIcon(stateMeta.icon, `${stateMeta.connectionIconClass} me-1`),
                document.createTextNode(` ${stateMeta.connectionLabel}`)
            );
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

        const syncNowBtn = document.getElementById('btn-sync-now');
        if (syncNowBtn) {
            if (!isAdmin) {
                syncNowBtn.disabled = true;
                syncNowBtn.title = 'ليست لديك صلاحية تشغيل المزامنة';
            } else if (!status.configured) {
                syncNowBtn.disabled = true;
                syncNowBtn.title = 'أكمل إعداد المؤسسة أولاً';
            } else if (status.pushCycleActive || status.pullCycleActive) {
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
    if (!isAdmin) return;

    try {
        const config = await window.api.sync.getConfig();
        const status = await window.api.sync.getStatus();

        if (isAuthFailure(config)) {
            isAdmin = false;
            applySyncAccessMode();
            return;
        }
        if (!config || config.success === false) return;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };
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
        if (!requireSyncAdmin('حفظ إعدادات المزامنة')) return;

        const validationDiv = document.getElementById('config-validation');

        const functionsUrl = document.getElementById('cfg-functions-url')?.value?.trim();
        const projectId = document.getElementById('cfg-project-id')?.value?.trim();
        const apiKey = document.getElementById('cfg-api-key')?.value?.trim();
        const authDomain = document.getElementById('cfg-auth-domain')?.value?.trim();
        const appId = document.getElementById('cfg-app-id')?.value?.trim();
        const numberValue = (id) => {
            const rawValue = document.getElementById(id)?.value?.trim();
            return rawValue === '' ? NaN : Number(rawValue);
        };
        const interval = numberValue('cfg-interval');
        const batchSize = numberValue('cfg-batch-size');
        const maxRetries = numberValue('cfg-max-retries');
        const retention = numberValue('cfg-retention');
        const snapshotInterval = numberValue('cfg-snapshot-interval');

        const errors = [];
        if (!Number.isInteger(interval) || interval < 1 || interval > 30) {
            errors.push('فترة المزامنة يجب أن تكون بين 1 و 30 دقيقة');
        }
        if (!isNaN(batchSize) && (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)) {
            errors.push('حجم الدفعة يجب أن يكون بين 1 و 1000');
        }
        if (!isNaN(maxRetries) && (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 50)) {
            errors.push('أقصى محاولات يجب أن يكون بين 0 و 50');
        }
        if (!isNaN(retention) && (!Number.isInteger(retention) || retention < 1 || retention > 365)) {
            errors.push('أيام الاحتفاظ يجب أن تكون بين 1 و 365');
        }
        if (
            !isNaN(snapshotInterval) &&
            (!Number.isInteger(snapshotInterval) || snapshotInterval < 5 || snapshotInterval > 1440)
        ) {
            errors.push('فترة الفحص يجب أن تكون بين 5 و 1440 دقيقة');
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
                validationDiv.focus();
            }
            return;
        }
        if (validationDiv) {
            validationDiv.textContent = '';
            validationDiv.classList.add('hidden');
        }

        const updates = {
            enabled: 1,
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
                if (isAuthFailure(result)) {
                    isAdmin = false;
                    applySyncAccessMode();
                }
                showToast(result.error || 'فشل حفظ الإعدادات', 'error');
            }
        } catch (err) {
            notifySyncError('setConfig', 'حدث خطأ أثناء حفظ إعدادات المزامنة', err, { immediate: true });
        }
    });
}

// ==================== Test Connection ====================

function showSyncResultMessage(container, tone, iconName, text) {
    if (!container) return;
    const toneClasses = {
        success:
            'mt-3 rounded-lg border border-[var(--color-success-border)] bg-[var(--color-success-surface)] px-4 py-3 text-sm text-[var(--color-success-text)]',
        warning:
            'mt-3 rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-surface)] px-4 py-3 text-sm text-[var(--color-warning-text)]',
        danger: 'mt-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] px-4 py-3 text-sm text-[var(--color-danger-text)]'
    };
    setLiveRegionTone(container, tone);
    container.className = toneClasses[tone] || toneClasses.danger;
    container.replaceChildren(createSyncIcon(iconName, 'me-2'), document.createTextNode(text));
    container.classList.remove('hidden');
    container.focus();
}

function initTestConnection() {
    const btn = document.getElementById('btn-test-connection');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        if (!requireSyncAdmin('اختبار الاتصال')) return;

        const resultDiv = document.getElementById('test-connection-result');
        btn.disabled = true;
        setButtonContent(btn, { icon: 'fa-spinner', text: 'جاري الاختبار...', spin: true });
        if (resultDiv) {
            resultDiv.classList.add('hidden');
            resultDiv.replaceChildren();
            setLiveRegionTone(resultDiv, 'status');
        }

        try {
            const result = await window.api.sync.testConnection();
            if (result.success) {
                showSyncResultMessage(resultDiv, 'success', 'fa-check-circle', 'الاتصال ناجح');
            } else {
                const stepLabel = { lambda: 'Lambda', cognito: 'Cognito', dynamodb: 'DynamoDB' }[result.step] || '';
                if (isAuthFailure(result)) {
                    isAdmin = false;
                    applySyncAccessMode();
                }
                showSyncResultMessage(
                    resultDiv,
                    'danger',
                    'fa-times-circle',
                    `${stepLabel ? stepLabel + ': ' : ''}${result.error || 'فشل الاتصال'}`
                );
            }
        } catch (err) {
            notifySyncError('testConnection', 'حدث خطأ أثناء اختبار الاتصال', err, { immediate: true });
            showSyncResultMessage(resultDiv, 'danger', 'fa-times-circle', getErrorMessage(err));
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
        if (btn.disabled || !requireSyncAdmin('تشغيل المزامنة')) return;

        btn.disabled = true;
        setButtonContent(btn, { icon: 'fa-spinner', text: 'جاري المزامنة...', spin: true });
        const resultsDiv = document.getElementById('sync-results');
        if (resultsDiv) {
            resultsDiv.classList.add('hidden');
            resultsDiv.replaceChildren();
            setLiveRegionTone(resultsDiv, 'status');
        }

        try {
            const loadingToast =
                typeof window.showToast?.loading === 'function'
                    ? window.showToast.loading('جاري تنفيذ المزامنة...')
                    : null;
            const result = await window.api.sync.triggerNow();

            // Show results
            if (resultsDiv && result) {
                resultsDiv.classList.remove('hidden');
                renderSyncResultsPanel(resultsDiv, result);
                resultsDiv.focus();
            }

            if (isAuthFailure(result)) {
                isAdmin = false;
                applySyncAccessMode();
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
    if (!isAdmin) return;

    try {
        const filterEl = document.getElementById('conflict-filter');
        const filterValue = filterEl?.value || 'unresolved';

        const conflicts = await window.api.sync.getConflictLog({
            status: filterValue,
            limit: conflictPageSize,
            offset: currentOffset
        });

        if (isAuthFailure(conflicts)) {
            isAdmin = false;
            applySyncAccessMode();
            return;
        }

        const tbody = document.getElementById('conflict-tbody');
        const badge = document.getElementById('conflict-badge');
        if (!tbody) return;

        if (!Array.isArray(conflicts) || conflicts.length === 0) {
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
            if (!isAdmin) return;
            currentOffset = 0;
            loadConflicts();
        });
    }

    // Pagination
    const paginationDiv = document.getElementById('conflict-pagination');
    if (paginationDiv) {
        paginationDiv.addEventListener('click', (e) => {
            if (!isAdmin) return;
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
        if (!isAdmin) return;

        // Expand/collapse detail
        const expandBtn = e.target.closest('.conflict-expand-btn');
        if (expandBtn) {
            const row = expandBtn.closest('tr');
            if (!row) return;
            const nextRow = row.nextElementSibling;
            if (nextRow && nextRow.classList.contains('conflict-detail-row')) {
                expandBtn.setAttribute('aria-expanded', 'false');
                nextRow.remove();
                return;
            }
            // Create detail row
            const conflict = conflictRowState.get(row);
            if (!conflict) return;
            const detailRow = createConflictDetailRow(conflict);
            const controls = expandBtn.getAttribute('aria-controls');
            if (controls) detailRow.id = controls;
            row.after(detailRow);
            expandBtn.setAttribute('aria-expanded', 'true');
            return;
        }

        // Resolve conflict
        const resolveBtn = e.target.closest('.conflict-resolve-btn');
        if (resolveBtn) {
            if (!requireSyncAdmin('حل التعارض')) return;

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
                    if (isAuthFailure(result)) {
                        isAdmin = false;
                        applySyncAccessMode();
                    }
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
        initForensics();
        initErrorLog();
    });
} else {
    initConfigForm();
    initTestConnection();
    initSyncNow();
    initConflictHandlers();
    initForensics();
    initErrorLog();
}

// ==================== Conflict Forensics / Root-Cause Analyzer ====================

function createForensicsStatCard(label, value, accentClass = 'text-[var(--color-text-main)]') {
    const card = document.createElement('div');
    card.className = 'rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 text-center';
    const valueEl = document.createElement('div');
    valueEl.className = `text-2xl font-bold ${accentClass}`;
    valueEl.textContent = String(value);
    const labelEl = document.createElement('div');
    labelEl.className = 'mt-1 text-xs text-[var(--color-text-muted)]';
    labelEl.textContent = label;
    card.appendChild(valueEl);
    card.appendChild(labelEl);
    return card;
}

function createForensicsSimpleTable(headers, rows) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-responsive mt-2';
    const table = document.createElement('table');
    table.className = 'students-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headers.forEach((h) => {
        const th = document.createElement('th');
        th.textContent = h;
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach((cells) => {
        const tr = document.createElement('tr');
        cells.forEach((c) => {
            const td = document.createElement('td');
            td.textContent = String(c ?? '—');
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
}

function createForensicsSubheading(text, iconName) {
    const h = document.createElement('h4');
    h.className = 'mt-5 mb-2 font-bold text-[var(--color-text-main)]';
    if (iconName) {
        h.appendChild(createSyncIcon(iconName, 'me-1'));
    }
    appendText(h, ` ${text}`);
    return h;
}

function renderForensicsResult(container, data) {
    if (!container) return;
    const nodes = [];

    // Not enabled / not available banner
    if (!data || !data.available) {
        const banner = document.createElement('div');
        banner.className =
            'rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-surface)] px-4 py-3 text-sm text-[var(--color-warning-text)]';
        banner.appendChild(createSyncIcon('fa-info-circle', 'me-1'));
        if (data && !data.enabled) {
            appendText(banner, ' التسجيل الجنائي معطّل. شغّل التطبيق مع ');
            banner.appendChild(createInlineCode('SYNC_CONFLICT_FORENSICS=1'));
            appendText(banner, ' ثم استخدم النظام لتوليد بيانات.');
        } else {
            appendText(banner, ' لا يوجد ملف سجل بعد. لم تُسجَّل أي تعارضات حتى الآن.');
        }
        setLiveRegionTone(container, 'warning');
        container.replaceChildren(banner);
        container.classList.remove('hidden');
        return;
    }

    // Diagnoses (most important — show first)
    if (Array.isArray(data.diagnoses) && data.diagnoses.length) {
        const diagBox = document.createElement('div');
        diagBox.className =
            'rounded-lg border border-[var(--color-info-border)] bg-[var(--color-info-surface)] px-4 py-3 text-sm text-[var(--color-info-text)]';
        const title = document.createElement('div');
        title.className = 'mb-2 font-bold';
        title.appendChild(createSyncIcon('fa-lightbulb', 'me-1'));
        appendText(title, ' التشخيص');
        diagBox.appendChild(title);
        const ul = document.createElement('ul');
        ul.className = 'list-disc space-y-1 pe-5';
        data.diagnoses.forEach((d) => {
            const li = document.createElement('li');
            li.textContent = d;
            ul.appendChild(li);
        });
        diagBox.appendChild(ul);
        nodes.push(diagBox);
    }

    // Stat cards
    const statsGrid = document.createElement('div');
    statsGrid.className = 'mt-4 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5';
    statsGrid.appendChild(createForensicsStatCard('إجمالي التعارضات', data.total));
    statsGrid.appendChild(createForensicsStatCard('رفع (push)', data.byPhase?.push || 0));
    statsGrid.appendChild(createForensicsStatCard('سحب (pull)', data.byPhase?.pull || 0));
    statsGrid.appendChild(
        createForensicsStatCard(
            'بلا سلف (ancestor)',
            `${data.noAncestorPct}%`,
            data.noAncestorPct >= 40 ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-text-main)]'
        )
    );
    statsGrid.appendChild(
        createForensicsStatCard(
            'فروق زمنية مشبوهة',
            data.clockSkew?.suspicious || 0,
            (data.clockSkew?.suspicious || 0) > 0 ? 'text-[var(--color-warning-text)]' : 'text-[var(--color-text-main)]'
        )
    );
    nodes.push(statsGrid);

    // Repeated rows (version desync signal)
    if (Array.isArray(data.repeatedRows) && data.repeatedRows.length) {
        nodes.push(createForensicsSubheading('صفوف متكرّرة التعارض (مؤشّر اختلال الإصدار)', 'fa-repeat'));
        nodes.push(
            createForensicsSimpleTable(
                ['الجدول', 'المعرّف', 'عدد التعارضات', 'أعلى إصدار بعيد', 'أدنى إصدار محلي'],
                data.repeatedRows.map((r) => [
                    r.table,
                    r.rowSyncId && r.rowSyncId.length > 28 ? r.rowSyncId.slice(0, 28) + '…' : r.rowSyncId,
                    r.count,
                    r.maxRemoteVersion,
                    r.minLocalVersion ?? '—'
                ])
            )
        );
    }

    // Top conflicting fields
    if (Array.isArray(data.topConflictingFields) && data.topConflictingFields.length) {
        nodes.push(createForensicsSubheading('أكثر الحقول تعارضاً', 'fa-list-ol'));
        nodes.push(
            createForensicsSimpleTable(
                ['الحقل', 'عدد المرات'],
                data.topConflictingFields.map((f) => [f.field, f.count])
            )
        );
    }

    // Log path footnote
    if (data.logPath) {
        const foot = document.createElement('p');
        foot.className = 'mt-4 text-xs text-[var(--color-text-muted)]';
        foot.appendChild(createSyncIcon('fa-file-lines', 'me-1'));
        appendText(foot, ` مصدر البيانات: ${data.logPath}`);
        nodes.push(foot);
    }

    setLiveRegionTone(container, 'status');
    container.replaceChildren(...nodes);
    container.classList.remove('hidden');
}

function initForensics() {
    const btn = document.getElementById('btn-analyze-forensics');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        if (!requireSyncAdmin('تحليل سجل التعارضات')) return;

        const resultDiv = document.getElementById('forensics-result');
        const statusEl = document.getElementById('forensics-status');
        btn.disabled = true;
        setButtonContent(btn, { icon: 'fa-spinner', text: 'جاري التحليل...', spin: true });
        if (resultDiv) {
            resultDiv.classList.add('hidden');
            resultDiv.replaceChildren();
            setLiveRegionTone(resultDiv, 'status');
        }
        if (statusEl) statusEl.textContent = 'جاري التحليل...';

        try {
            const data = await window.api.sync.getConflictForensics({ maxLines: 5000 });
            if (isAuthFailure(data)) {
                isAdmin = false;
                applySyncAccessMode();
                showSyncResultMessage(resultDiv, 'danger', 'fa-times-circle', data.error || 'ليست لديك صلاحية التحليل');
                return;
            }

            renderForensicsResult(resultDiv, data);
            resultDiv?.focus();
            if (statusEl) {
                statusEl.textContent = data?.available
                    ? `آخر تحليل: ${new Date().toLocaleTimeString('ar')}`
                    : 'لا توجد بيانات بعد';
            }
        } catch (err) {
            notifySyncError('getConflictForensics', 'تعذّر تحليل سجل التعارضات', err, { immediate: true });
            showSyncResultMessage(resultDiv, 'danger', 'fa-times-circle', getErrorMessage(err));
            if (statusEl) statusEl.textContent = 'فشل التحليل';
        } finally {
            btn.disabled = false;
            setButtonContent(btn, { icon: 'fa-stethoscope', text: 'تحليل السجل' });
        }
    });
}

// ==================== Error Log (available to all users) ====================

const ERROR_SOURCE_LABELS = {
    main: 'العملية الرئيسية',
    ipc: 'الخادم الداخلي',
    renderer: 'الواجهة',
    unparsed: 'غير مقروء',
    unknown: 'غير معروف'
};

// Render the file-log error entries plus, optionally, the DB-stored
// `last_push_error` / `last_pull_error` (which live on sync_config, NOT the file
// log). Without the DB errors, an empty file log would show the misleading banner
// "لا توجد أخطاء مسجّلة — كل شيء يعمل بشكل سيم." even when a push cycle just
// failed with PERMISSION_DENIED — because push errors are written to the DB column
// by recordPushMeta, not to the file app log. When `dbErrors` carries a non-empty
// push/pull error, it is surfaced (danger styling) ahead of the file-log table,
// so the user sees the real cause of the stall instead of the reassuring banner.
function renderRecentErrors(container, data, dbErrors) {
    if (!container) return;

    const hasDbError = !!(
        dbErrors &&
        (String(dbErrors.lastPushError || '').trim() || String(dbErrors.lastPullError || '').trim())
    );
    const hasFileEntries = !!(data && data.available && Array.isArray(data.entries) && data.entries.length);

    if (!hasDbError && !hasFileEntries) {
        const empty = document.createElement('div');
        empty.className =
            'rounded-lg border border-[var(--color-info-border)] bg-[var(--color-info-surface)] px-4 py-3 text-sm text-[var(--color-info-text)]';
        empty.appendChild(createSyncIcon('fa-circle-check', 'me-1'));
        appendText(empty, ' لا توجد أخطاء مسجّلة — كل شيء يعمل بشكل سليم.');
        container.replaceChildren(empty);
        container.classList.remove('hidden');
        return;
    }

    const nodes = [];

    // DB-stored sync errors first (they are the actionable ones — the file log may
    // contain nothing while a push cycle is failing on PERMISSION_DENIED).
    if (hasDbError) {
        const dbBox = document.createElement('div');
        dbBox.className =
            'mb-3 rounded-lg border border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] px-4 py-3 text-sm text-[var(--color-danger-text)]';
        const dbTitle = document.createElement('div');
        dbTitle.className = 'mb-1 font-bold';
        dbTitle.appendChild(createSyncIcon('fa-cloud-arrow-up', 'me-1'));
        appendText(dbTitle, ' أخطاء مزامنة مسجّلة في قاعدة البيانات');
        dbBox.appendChild(dbTitle);

        if (dbErrors.lastPushError) {
            const line = document.createElement('p');
            line.className = 'mt-1';
            line.appendChild(createSyncIcon('fa-upload', 'me-1'));
            appendText(line, ` الرفع: ${dbErrors.lastPushError}`);
            dbBox.appendChild(line);
        }
        if (dbErrors.lastPullError) {
            const line = document.createElement('p');
            line.className = 'mt-1';
            line.appendChild(createSyncIcon('fa-download', 'me-1'));
            appendText(line, ` السحب: ${dbErrors.lastPullError}`);
            dbBox.appendChild(line);
        }
        nodes.push(dbBox);
    }

    // File-log entries (when present)
    if (hasFileEntries) {
        const summary = document.createElement('p');
        summary.className = 'mb-2 text-xs text-[var(--color-text-muted)]';
        appendText(summary, `إجمالي الأسطر المسجّلة: ${data.total} — تُعرض أحدث ${Math.min(data.entries.length, 100)}`);
        nodes.push(summary);

        const wrapper = document.createElement('div');
        wrapper.className = 'table-responsive';
        const table = document.createElement('table');
        table.className = 'students-table';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['#', 'المصدر', 'العملية', 'الرسالة', 'الصفحة', 'الوقت'].forEach((label) => {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        data.entries.slice(0, 100).forEach((entry, index) => {
            const tr = document.createElement('tr');
            const cells = [
                String(index + 1),
                ERROR_SOURCE_LABELS[entry.source] || entry.source || '—',
                entry.action || '—',
                entry.message || '—',
                entry.page || '—',
                formatRelativeTime(entry.ts)
            ];
            cells.forEach((value, cellIndex) => {
                const td = document.createElement('td');
                td.textContent = value;
                if (cellIndex === 3) {
                    td.title = entry.stack || entry.message || '';
                    td.className = 'max-w-md truncate';
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrapper.appendChild(table);
        nodes.push(wrapper);
    }

    container.replaceChildren(...nodes);
    container.classList.remove('hidden');
}

function initErrorLog() {
    const exportBtn = document.getElementById('btn-export-error-log');
    const revealBtn = document.getElementById('btn-reveal-error-log');
    const viewBtn = document.getElementById('btn-view-recent-errors');
    const resultDiv = document.getElementById('recent-errors-result');

    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            exportBtn.disabled = true;
            setButtonContent(exportBtn, { icon: 'fa-spinner', text: 'جاري التصدير...', spin: true });
            try {
                const result = await window.api.diagnostics.exportLog();
                if (result?.success) {
                    showToast('تم تصدير سجل الأخطاء بنجاح', 'success');
                } else {
                    showToast(result?.error || 'تعذّر تصدير السجل', 'error');
                }
            } catch (err) {
                notifySyncError('exportErrorLog', 'حدث خطأ أثناء تصدير السجل', err, { immediate: true });
            } finally {
                exportBtn.disabled = false;
                setButtonContent(exportBtn, { icon: 'fa-file-export', text: 'تصدير سجل الأخطاء (ملف نصي)' });
            }
        });
    }

    if (revealBtn) {
        revealBtn.addEventListener('click', async () => {
            try {
                const result = await window.api.diagnostics.revealLog();
                if (!result?.success) {
                    showToast(result?.error || 'تعذّر فتح مجلد السجلّات', 'error');
                }
            } catch (err) {
                notifySyncError('revealErrorLog', 'حدث خطأ أثناء فتح المجلد', err, { immediate: true });
            }
        });
    }

    if (viewBtn) {
        viewBtn.addEventListener('click', async () => {
            viewBtn.disabled = true;
            setButtonContent(viewBtn, { icon: 'fa-spinner', text: 'جاري التحميل...', spin: true });
            if (resultDiv) {
                resultDiv.classList.add('hidden');
                resultDiv.replaceChildren();
            }
            try {
                // Fetch both the file-log entries and the live DB-stored sync
                // errors in parallel — the latter live on sync_config
                // (last_push_error / last_pull_error), NOT the file log, and are
                // the actionable cause of a stalled "uploading" state.
                const [data, status] = await Promise.all([
                    window.api.diagnostics.getRecent({ maxLines: 500 }),
                    window.api.sync.getStatus().catch(() => null)
                ]);
                const dbErrors = status
                    ? { lastPushError: status.lastPushError, lastPullError: status.lastPullError }
                    : null;
                renderRecentErrors(resultDiv, data, dbErrors);
                resultDiv?.focus();
            } catch (err) {
                notifySyncError('getRecentErrors', 'تعذّر تحميل الأخطاء', err, { immediate: true });
            } finally {
                viewBtn.disabled = false;
                setButtonContent(viewBtn, { icon: 'fa-list-ul', text: 'عرض آخر الأخطاء' });
            }
        });
    }
}
