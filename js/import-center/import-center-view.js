/**
 * import-center-view.js — Queue/review presentation for Import Center (phase one).
 *
 * Renders session state only. Never calls write APIs.
 * Dual-export: window.ImportCenterView + module.exports
 */
(function (root, factory) {
    const Contracts =
        (root && root.ImportContracts) ||
        (typeof require === 'function' ? require('./import-contracts.js') : null);
    const api = factory(Contracts);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportCenterView = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (Contracts) {
    'use strict';

    const LABELS = (Contracts && Contracts.ARABIC_LABELS) || {};

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function typeLabel(type) {
        return LABELS[type] || type || LABELS.unknown || 'غير معروف';
    }

    function statusLabel(status) {
        return LABELS[status] || status || '';
    }

    function confidenceText(score) {
        const n = Number(score) || 0;
        const pct = Math.round(n * 100);
        if (n >= 0.85) return `ثقة عالية (${pct}%)`;
        if (n >= 0.6) return `ثقة متوسطة (${pct}%)`;
        return `ثقة منخفضة (${pct}%)`;
    }

    function statusIcon(status) {
        switch (status) {
            case 'ready':
                return 'fa-check-circle';
            case 'needs_review':
                return 'fa-exclamation-triangle';
            case 'analyzing':
            case 'queued':
                return 'fa-clock';
            case 'failed':
                return 'fa-times-circle';
            case 'skipped':
                return 'fa-forward';
            case 'blocked':
                return 'fa-ban';
            case 'succeeded':
                return 'fa-check-double';
            case 'importing':
                return 'fa-spinner';
            default:
                return 'fa-file';
        }
    }

    /**
     * Actions available for a given file status (Property 20).
     */
    function actionsForStatus(status) {
        switch (status) {
            case 'queued':
            case 'analyzing':
                return ['remove'];
            case 'needs_review':
                return ['change_type', 'reanalyze', 'skip', 'remove'];
            case 'ready':
                return ['reanalyze', 'skip', 'remove'];
            case 'failed':
                return ['retry', 'reanalyze', 'skip', 'remove'];
            case 'skipped':
                return ['reanalyze', 'remove'];
            case 'importing':
                return [];
            case 'succeeded':
                return [];
            case 'blocked':
                return ['retry', 'skip', 'remove'];
            default:
                return ['remove'];
        }
    }

    function renderEvidence(evidence) {
        const list = Array.isArray(evidence) ? evidence : [];
        if (!list.length) return '<p class="ic-muted">لا توجد أدلة معروضة</p>';
        return (
            '<ul class="ic-evidence-list">' +
            list
                .slice(0, 6)
                .map(
                    (e) =>
                        `<li class="ic-evidence ic-evidence--${escapeHtml(e.strength || 'supporting')}">` +
                        `<span class="ic-evidence-label">${escapeHtml(e.label || e.kind)}</span>` +
                        `<span class="ic-evidence-detail">${escapeHtml(e.detail || '')}</span>` +
                        `</li>`
                )
                .join('') +
            '</ul>'
        );
    }

    function renderFileCard(item) {
        const id = escapeHtml(item.id);
        const name = escapeHtml(item.name);
        const status = item.status || 'queued';
        const actions = actionsForStatus(status);
        const type = item.selectedType || item.detectedType || 'unknown';
        const conf = confidenceText(item.confidence);
        const year = item.detectedYear || item._selectedYear || '—';
        const est = item.recordEstimate != null ? `${item.recordEstimate} سجل` : '—';
        const reasons = Array.isArray(item.reviewReasons) ? item.reviewReasons : [];

        const actionHtml = actions
            .map((a) => {
                const labels = {
                    reanalyze: 'إعادة التحليل',
                    skip: 'تخطي',
                    remove: 'إزالة',
                    change_type: 'تغيير النوع',
                    retry: 'إعادة المحاولة'
                };
                const icons = {
                    reanalyze: 'fa-sync',
                    skip: 'fa-forward',
                    remove: 'fa-trash-alt',
                    change_type: 'fa-edit',
                    retry: 'fa-redo'
                };
                return (
                    `<button type="button" class="ic-action-btn" data-ic-action="${a}" data-file-id="${id}" ` +
                    `aria-label="${escapeHtml(labels[a] || a)}: ${name}">` +
                    `<i class="fas ${icons[a] || 'fa-circle'}" aria-hidden="true"></i>` +
                    `<span>${escapeHtml(labels[a] || a)}</span></button>`
                );
            })
            .join('');

        const typeOptions = ['students', 'grades', 'absences', 'fet', 'agent_xml', 'student_status', 'generic_csv_xlsx']
            .map(
                (t) =>
                    `<option value="${t}" ${t === type ? 'selected' : ''}>${escapeHtml(typeLabel(t))}</option>`
            )
            .join('');

        return (
            `<article class="ic-file-card ic-status-${escapeHtml(status)}" data-file-id="${id}" data-status="${escapeHtml(status)}">` +
            `<div class="ic-file-card-main">` +
            `<div class="ic-file-name" title="${name}"><i class="fas fa-file-alt" aria-hidden="true"></i> ${name}</div>` +
            `<div class="ic-file-meta">` +
            `<span class="ic-badge ic-type" data-type="${escapeHtml(type)}">${escapeHtml(typeLabel(type))}</span>` +
            `<span class="ic-badge ic-confidence" data-confidence="${Number(item.confidence) || 0}">` +
            `<i class="fas fa-chart-line" aria-hidden="true"></i> ${escapeHtml(conf)}</span>` +
            `<span class="ic-badge ic-year"><i class="fas fa-calendar" aria-hidden="true"></i> ${escapeHtml(String(year))}</span>` +
            `<span class="ic-badge ic-estimate">${escapeHtml(est)}</span>` +
            `</div>` +
            `<div class="ic-file-status" data-status-text="${escapeHtml(status)}">` +
            `<i class="fas ${statusIcon(status)}" aria-hidden="true"></i> ` +
            `<span class="ic-status-text">${escapeHtml(statusLabel(status))}</span>` +
            `</div>` +
            `</div>` +
            `<div class="ic-file-evidence">${renderEvidence(item.evidence)}</div>` +
            (reasons.length
                ? `<p class="ic-review-reasons">${escapeHtml(reasons.join(' · '))}</p>`
                : '') +
            (status === 'needs_review'
                ? `<div class="ic-type-picker"><label for="ic-type-${id}">النوع</label>` +
                  `<select id="ic-type-${id}" class="ic-type-select" data-file-id="${id}" aria-label="اختيار نوع الاستيراد لـ ${name}">${typeOptions}</select></div>`
                : '') +
            `<div class="ic-file-actions">${actionHtml}</div>` +
            `</article>`
        );
    }

    function renderQueue(session, container) {
        if (!container) return;
        const files = (session && session.files) || [];
        if (!files.length) {
            container.innerHTML =
                `<div class="ic-empty-state" role="status">` +
                `<i class="fas fa-inbox" aria-hidden="true"></i>` +
                `<p>لم تُضف ملفات بعد. اسحب الملفات أو اخترها للتحليل دون حفظ تلقائي.</p>` +
                `</div>`;
            return;
        }
        container.innerHTML = files.map(renderFileCard).join('');
    }

    function renderLiveStatus(session, el) {
        if (!el) return;
        const files = (session && session.files) || [];
        const n = files.length;
        const reviewing = files.filter((f) => f.status === 'needs_review').length;
        const ready = files.filter((f) => f.status === 'ready').length;
        el.textContent = n
            ? `${n} ملف · ${reviewing} يحتاج مراجعة · ${ready} جاهز`
            : 'لا توجد ملفات في الطابور';
    }

    function renderConfirmation(session, el) {
        if (!el) return;
        const files = ((session && session.files) || []).filter((f) => f.status === 'ready' || f.status === 'needs_review');
        if (!files.length) {
            el.innerHTML = '<p class="ic-muted">لا عناصر للتأكيد بعد.</p>';
            return;
        }
        const rows = files
            .map((f) => {
                const t = f.selectedType || f.detectedType;
                return (
                    `<li><strong>${escapeHtml(f.name)}</strong> — ${escapeHtml(typeLabel(t))}` +
                    ` · ${escapeHtml(String(f.detectedYear || '—'))}` +
                    ` · ${f.recordEstimate != null ? f.recordEstimate + ' سجل' : '—'}` +
                    ` · ${escapeHtml(statusLabel(f.status))}</li>`
                );
            })
            .join('');
        const readyCount = ((session && session.files) || []).filter((f) => f.status === 'ready').length;
        el.innerHTML =
            `<p class="ic-confirm-lead">ملخص المراجعة — أكّد ثم ابدأ استيراد الجاهز فقط (${readyCount} جاهز):</p>` +
            `<ul class="ic-confirm-list">${rows}</ul>`;
    }

    function renderSessionReport(session, el) {
        if (!el) return;
        const report = session && session.report;
        if (!report) {
            el.innerHTML = '<p class="ic-muted">لا تقرير بعد. سيظهر بعد اكتمال التنفيذ.</p>';
            return;
        }
        const t = report.totals || {};
        el.innerHTML =
            `<div class="ic-report-summary" role="status">` +
            `<p><strong>النتيجة:</strong> نجح ${t.succeeded || 0} · فشل ${t.failed || 0} · تخطي ${t.skipped || 0} · محجوب ${t.blocked || 0}</p>` +
            `<p>سجلات مكتوبة: ${t.recordsWritten || 0} · مرفوضة: ${t.recordsRejected || 0} · تحذيرات: ${t.warningCount || 0}</p>` +
            `</div>`;
    }

    function updateStartButton(session, btn) {
        if (!btn) return;
        const importing = session && session.status === 'importing';
        const canRun =
            session &&
            typeof session.canExecute === 'function' &&
            session.canExecute() &&
            !importing;
        const hasReady = session && Array.isArray(session.files) && session.files.some((f) => f.status === 'ready');
        // Enable when there are ready items (confirm+run) or confirmed snapshot
        btn.disabled = importing || (!canRun && !hasReady);
        btn.setAttribute('aria-busy', importing ? 'true' : 'false');
        if (importing) {
            btn.title = 'جاري الاستيراد — يُرفض الإرسال المكرر';
        } else if (hasReady || canRun) {
            btn.title = 'تأكيد وبدء استيراد الملفات الجاهزة';
        } else {
            btn.title = 'لا توجد ملفات جاهزة — أكمل المراجعة أولاً';
        }
    }

    /**
     * Bind queue action clicks to controller callbacks.
     */
    function bindQueueEvents(container, handlers) {
        if (!container || !handlers) return;
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-ic-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-ic-action');
            const fileId = btn.getAttribute('data-file-id');
            if (action && fileId && typeof handlers[action] === 'function') {
                handlers[action](fileId);
            }
        });
        container.addEventListener('change', (e) => {
            const sel = e.target.closest('.ic-type-select');
            if (!sel) return;
            const fileId = sel.getAttribute('data-file-id');
            if (fileId && typeof handlers.change_type === 'function') {
                handlers.change_type(fileId, sel.value);
            }
        });
    }

    return {
        escapeHtml,
        typeLabel,
        statusLabel,
        confidenceText,
        actionsForStatus,
        renderFileCard,
        renderQueue,
        renderLiveStatus,
        renderConfirmation,
        renderSessionReport,
        updateStartButton,
        bindQueueEvents
    };
});
