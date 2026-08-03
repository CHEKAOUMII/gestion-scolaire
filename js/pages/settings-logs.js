/**
 * settings-logs.js — Activity log viewer with an action filter.
 * Renders all rows read-only; known audit actions get Arabic labels.
 */
(function () {
    'use strict';

    const ACTION_LABELS = {
        STAGE_RULE_OVERRIDE: 'تعديل قواعد المرحلة',
        SUBJECT_COEFFICIENT_ADMIN_OVERRIDE: 'تعديل معاملات المواد'
    };

    // Always present in the filter (see ACTION_LABELS); any other distinct
    // action found in the log is appended dynamically.
    const FILTER_ACTIONS = ['STAGE_RULE_OVERRIDE', 'SUBJECT_COEFFICIENT_ADMIN_OVERRIDE'];

    let allLogs = [];

    function safeText(value) {
        if (typeof escapeHtml === 'function') {
            return escapeHtml(String(value || ''));
        }
        return String(value || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function actionLabel(action) {
        return ACTION_LABELS[action] || String(action || '—');
    }

    function formatDetails(details) {
        const text = details == null ? '' : String(details);
        const trimmed = text.trim();
        if (
            (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
            try {
                return `<code class="log-details">${safeText(JSON.stringify(JSON.parse(trimmed), null, 2))}</code>`;
            } catch (_) {
                // not JSON — fall through to plain text
            }
        }
        return safeText(text);
    }

    function renderLogRows() {
        const tbody = document.getElementById('tbody');
        if (!tbody) return;
        const filter = document.getElementById('action-filter')?.value || '';
        const rows = filter ? allLogs.filter((r) => r.action === filter) : allLogs;
        tbody.innerHTML = rows.length
            ? rows
                  .map(
                      (r, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>${safeText(actionLabel(r.action))}</td>
                    <td>${safeText(r.entity_type || '-')}</td>
                    <td>${safeText(r.entity_id || '-')}</td>
                    <td>${formatDetails(r.details)}</td>
                    <td>${safeText(r.created_at || '-')}</td>
                </tr>
            `
                  )
                  .join('')
            : '<tr><td class="px-5 py-5 text-center" colspan="6">لا توجد سجلات</td></tr>';
    }

    function renderActionFilter(rows) {
        const select = document.getElementById('action-filter');
        if (!select) return;
        const actions = FILTER_ACTIONS.slice();
        for (const row of rows) {
            const action = row.action;
            if (action && !actions.includes(action)) actions.push(action);
        }
        actions.sort();
        const current = select.value;
        select.innerHTML =
            '<option value="">كل العمليات</option>' +
            actions
                .map((a) => `<option value="${safeText(a)}">${safeText(actionLabel(a))}</option>`)
                .join('');
        if (actions.includes(current)) select.value = current;
        else select.value = '';
    }

    async function seedLog() {
        if (!window.api?.systemLogs?.add) return;
        await window.api.systemLogs.add({
            action: 'manual:test',
            details: 'seed log from settings-logs',
            entity_type: 'manual',
            entity_id: 'seed'
        });
        await loadLogs();
    }

    async function loadLogs() {
        if (!window.api?.systemLogs?.getAll) return;
        allLogs = (await window.api.systemLogs.getAll(300)) || [];
        renderActionFilter(allLogs);
        renderLogRows();
    }

    function init() {
        document.getElementById('refresh')?.addEventListener('click', loadLogs);
        document.getElementById('seed')?.addEventListener('click', seedLog);
        document.getElementById('action-filter')?.addEventListener('change', renderLogRows);
        loadLogs();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
