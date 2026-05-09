(function () {
    'use strict';

    if (window.showConfirm && window.setFieldValidation && window.clearValidation) {
        return;
    }

    var STYLE_ID = 'message-system-styles';
    var activeConfirm = null;
    var validationCounter = 0;

    var TYPE_CONFIG = {
        danger: {
            icon: 'fa-exclamation-triangle',
            headerClass: 'danger',
            confirmClass: 'danger',
            confirmText: 'تأكيد'
        },
        warning: {
            icon: 'fa-exclamation-circle',
            headerClass: 'warning',
            confirmClass: 'warning',
            confirmText: 'متابعة'
        },
        info: {
            icon: 'fa-circle-info',
            headerClass: 'info',
            confirmClass: 'primary',
            confirmText: 'حسنا'
        }
    };

    var VALIDATION_ICON = {
        error: 'fa-circle-exclamation',
        warning: 'fa-triangle-exclamation',
        success: 'fa-circle-check'
    };

    var VALIDATION_FIELD_CLASS = {
        error: 'field-invalid',
        warning: 'field-warning',
        success: 'field-valid'
    };

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.msg-confirm-overlay{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);opacity:0;visibility:hidden;transition:opacity .18s ease,visibility .18s ease;}',
            '.msg-confirm-overlay.active{opacity:1;visibility:visible;}',
            '.msg-confirm-card{width:min(480px,92vw);background:var(--color-surface,#fff);color:var(--color-text-main,#0f172a);border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,.25);overflow:hidden;transform:translateY(12px) scale(.96);transition:transform .18s ease;}',
            '.msg-confirm-overlay.active .msg-confirm-card{transform:translateY(0) scale(1);}',
            '.msg-confirm-header{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--color-accent,#e5e7eb);border-top:4px solid var(--color-primary,#3b6ac5);}',
            '.msg-confirm-header.info{border-top-color:var(--color-primary,#3b6ac5);}',
            '.msg-confirm-header.warning{border-top-color:var(--color-warning-solid,#d97706);}',
            '.msg-confirm-header.danger{border-top-color:var(--color-danger-solid,#dc2626);}',
            '.msg-confirm-icon{font-size:20px;flex:0 0 auto;}',
            '.msg-confirm-header.info .msg-confirm-icon{color:var(--color-primary,#3b6ac5);}',
            '.msg-confirm-header.warning .msg-confirm-icon{color:var(--color-warning-solid,#d97706);}',
            '.msg-confirm-header.danger .msg-confirm-icon{color:var(--color-danger-solid,#dc2626);}',
            '.msg-confirm-title{flex:1 1 auto;margin:0;font-size:16px;font-weight:700;line-height:1.4;}',
            '.msg-confirm-close{border:0;background:transparent;color:var(--color-text-muted,#64748b);font-size:18px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:8px;}',
            '.msg-confirm-close:hover{background:rgba(148,163,184,.16);color:var(--color-text-main,#0f172a);}',
            '.msg-confirm-body{padding:20px;display:grid;gap:10px;}',
            '.msg-confirm-message{margin:0;font-size:14px;line-height:1.7;}',
            '.msg-confirm-detail{margin:0;font-size:13px;line-height:1.6;color:var(--color-text-muted,#64748b);}',
            '.msg-confirm-input{width:100%;padding:11px 14px;border:1px solid var(--color-accent,#cbd5e1);border-radius:10px;background:var(--color-surface,#fff);color:var(--color-text-main,#0f172a);font:inherit;}',
            '.msg-confirm-input:focus{outline:0;border-color:var(--color-primary,#3b6ac5);box-shadow:0 0 0 3px rgba(59,106,197,.18);}',
            '.msg-confirm-actions{display:flex;justify-content:flex-end;gap:10px;padding:16px 20px;border-top:1px solid var(--color-accent,#e5e7eb);}',
            '.msg-confirm-btn{border:0;border-radius:10px;padding:10px 16px;font:inherit;font-weight:700;cursor:pointer;transition:transform .12s ease,opacity .12s ease,background .12s ease,color .12s ease;}',
            '.msg-confirm-btn:hover{transform:translateY(-1px);}',
            '.msg-confirm-btn:disabled{cursor:not-allowed;opacity:.55;transform:none;}',
            '.msg-confirm-btn.secondary{background:rgba(148,163,184,.15);color:var(--color-text-main,#0f172a);}',
            '.msg-confirm-btn.primary{background:var(--color-primary,#3b6ac5);color:#fff;}',
            '.msg-confirm-btn.warning{background:var(--color-warning-solid,#d97706);color:#fff;}',
            '.msg-confirm-btn.danger{background:var(--color-danger-solid,#dc2626);color:#fff;}',
            '.field-validation{display:flex;align-items:flex-start;gap:6px;margin-top:6px;font-size:12px;line-height:1.5;}',
            '.field-validation.error{color:var(--color-danger-solid,#dc2626);}',
            '.field-validation.warning{color:var(--color-warning-solid,#d97706);}',
            '.field-validation.success{color:var(--color-success-solid,#16a34a);}',
            '.field-validation i{margin-top:2px;flex:0 0 auto;}',
            '.field-invalid{border-color:var(--color-danger-solid,#dc2626)!important;}',
            '.field-warning{border-color:var(--color-warning-solid,#d97706)!important;}',
            '.field-valid{border-color:var(--color-success-solid,#16a34a)!important;}',
            '[data-theme="dark"] .msg-confirm-card{background:var(--color-surface,#1e293b);color:var(--color-text-main,#e2e8f0);box-shadow:0 20px 50px rgba(0,0,0,.45);}',
            '[data-theme="dark"] .msg-confirm-close{color:var(--color-text-muted,#94a3b8);}',
            '[data-theme="dark"] .msg-confirm-close:hover{background:rgba(148,163,184,.18);color:var(--color-text-main,#e2e8f0);}',
            '[data-theme="dark"] .msg-confirm-input{background:rgba(15,23,42,.65);color:var(--color-text-main,#e2e8f0);border-color:rgba(148,163,184,.28);}',
            '[data-theme="dark"] .msg-confirm-btn.secondary{background:rgba(148,163,184,.2);color:var(--color-text-main,#e2e8f0);}'
        ].join('');

        document.head.appendChild(style);
    }

    function showConfirm(config) {
        config = config || {};
        ensureStyles();

        if (activeConfirm) {
            resolveConfirm(false, 'dismiss');
        }

        return new Promise(function (resolve) {
            var type = TYPE_CONFIG[config.type] ? config.type : 'info';
            var typeConfig = TYPE_CONFIG[type];

            var overlay = document.createElement('div');
            overlay.className = 'msg-confirm-overlay';
            overlay.setAttribute('role', 'alertdialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-hidden', 'true');

            var card = document.createElement('div');
            card.className = 'msg-confirm-card';

            var header = document.createElement('div');
            header.className = 'msg-confirm-header ' + typeConfig.headerClass;

            var icon = document.createElement('i');
            icon.className = 'msg-confirm-icon fas ' + (config.icon || typeConfig.icon);
            icon.setAttribute('aria-hidden', 'true');

            var title = document.createElement('h3');
            title.className = 'msg-confirm-title';
            title.id = 'msg-confirm-title';
            title.textContent = config.title || 'تأكيد';

            var closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'msg-confirm-close';
            closeBtn.dataset.action = 'close';
            closeBtn.setAttribute('aria-label', 'إغلاق');
            closeBtn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';

            header.appendChild(icon);
            header.appendChild(title);
            header.appendChild(closeBtn);

            var body = document.createElement('div');
            body.className = 'msg-confirm-body';

            var message = document.createElement('p');
            message.className = 'msg-confirm-message';
            message.id = 'msg-confirm-message';
            message.textContent = config.message || '';
            body.appendChild(message);

            if (config.detail) {
                var detail = document.createElement('p');
                detail.className = 'msg-confirm-detail';
                detail.textContent = config.detail;
                body.appendChild(detail);
            }

            var inputEl = null;
            if (config.requireInput) {
                inputEl = document.createElement('input');
                inputEl.type = 'text';
                inputEl.className = 'msg-confirm-input';
                inputEl.id = 'msg-confirm-input';
                inputEl.placeholder = config.inputPlaceholder || '';
                inputEl.value = config.inputValue || '';
                inputEl.autocomplete = 'off';
                body.appendChild(inputEl);
            }

            var actions = document.createElement('div');
            actions.className = 'msg-confirm-actions';

            var cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'msg-confirm-btn secondary';
            cancelBtn.dataset.action = 'cancel';
            cancelBtn.textContent = config.cancelText || 'إلغاء';

            var confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.id = 'msg-confirm-ok';
            confirmBtn.className = 'msg-confirm-btn ' + (config.confirmClass || typeConfig.confirmClass);
            confirmBtn.dataset.action = 'confirm';
            confirmBtn.textContent = config.confirmText || typeConfig.confirmText;

            if (config.requireInput) {
                confirmBtn.disabled = !inputEl.value.trim();
                inputEl.addEventListener('input', function () {
                    confirmBtn.disabled = !inputEl.value.trim();
                });
            }

            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);

            card.appendChild(header);
            card.appendChild(body);
            card.appendChild(actions);

            overlay.appendChild(card);
            overlay.setAttribute('aria-labelledby', title.id);
            overlay.setAttribute('aria-describedby', message.id);

            (document.body || document.documentElement).appendChild(overlay);

            activeConfirm = {
                overlay: overlay,
                resolve: resolve,
                inputEl: inputEl,
                openedWithDialogApi: typeof openDialog === 'function' && typeof closeDialog === 'function'
            };

            requestAnimationFrame(function () {
                overlay.classList.add('active');
                overlay.setAttribute('aria-hidden', 'false');
            });

            if (activeConfirm.openedWithDialogApi) {
                openDialog(overlay, {
                    contentSelector: '.msg-confirm-card',
                    initialFocus: inputEl || confirmBtn,
                    onCloseRequest: function () {
                        resolveConfirm(false, 'dismiss');
                    }
                });
            } else {
                requestAnimationFrame(function () {
                    (inputEl || confirmBtn).focus();
                });
            }

            overlay.addEventListener('click', function (event) {
                var actionTarget = event.target.closest('[data-action]');
                if (actionTarget) {
                    var action = actionTarget.dataset.action;
                    resolveConfirm(action === 'confirm', action);
                    return;
                }

                if (event.target === overlay) {
                    resolveConfirm(false, 'dismiss');
                }
            });

            overlay.addEventListener('keydown', function (event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    resolveConfirm(false, 'dismiss');
                    return;
                }

                if (event.key === 'Enter' && event.target === inputEl && !confirmBtn.disabled) {
                    event.preventDefault();
                    resolveConfirm(true, 'confirm');
                }
            });
        });
    }

    function resolveConfirm(confirmed, action) {
        if (!activeConfirm) {
            return;
        }

        var state = activeConfirm;
        activeConfirm = null;

        state.overlay.classList.remove('active');
        state.overlay.setAttribute('aria-hidden', 'true');

        if (state.openedWithDialogApi) {
            closeDialog(state.overlay);
        }

        setTimeout(function () {
            state.overlay.remove();
        }, 180);

        state.resolve({
            confirmed: confirmed,
            action: action || (confirmed ? 'confirm' : 'dismiss'),
            inputValue: state.inputEl ? state.inputEl.value : undefined
        });
    }

    function setFieldValidation(field, message, type) {
        if (!field || !field.parentNode) {
            return;
        }

        type = VALIDATION_ICON[type] ? type : 'error';
        clearFieldValidation(field);

        if (!message) {
            return;
        }

        ensureStyles();

        var className = VALIDATION_FIELD_CLASS[type];
        if (className) {
            field.classList.add(className);
        }

        if (type === 'error') {
            field.setAttribute('aria-invalid', 'true');
        }

        validationCounter += 1;

        var validation = document.createElement('div');
        validation.className = 'field-validation ' + type;
        validation.id = 'field-validation-' + validationCounter;
        validation.setAttribute('role', type === 'error' ? 'alert' : 'status');

        var icon = document.createElement('i');
        icon.className = 'fas ' + VALIDATION_ICON[type];
        icon.setAttribute('aria-hidden', 'true');

        var text = document.createElement('span');
        text.textContent = String(message);

        validation.appendChild(icon);
        validation.appendChild(text);
        field.insertAdjacentElement('afterend', validation);
        field.dataset.validationMessageId = validation.id;
        field.setAttribute('aria-describedby', validation.id);
    }

    function clearFieldValidation(field) {
        if (!field) {
            return;
        }

        field.classList.remove('field-invalid', 'field-warning', 'field-valid');
        field.removeAttribute('aria-invalid');

        var describedBy = field.getAttribute('aria-describedby');
        var validationId = field.dataset.validationMessageId || describedBy;
        if (validationId) {
            var validation = document.getElementById(validationId);
            if (validation && validation.classList.contains('field-validation')) {
                validation.remove();
            }
        }

        delete field.dataset.validationMessageId;
        field.removeAttribute('aria-describedby');

        var next = field.nextElementSibling;
        if (next && next.classList.contains('field-validation')) {
            next.remove();
        }
    }

    function clearValidation(container) {
        if (!container) {
            return;
        }

        if (typeof container.matches === 'function' && container.matches('input, select, textarea')) {
            clearFieldValidation(container);
            return;
        }

        var fields = container.querySelectorAll('.field-invalid, .field-warning, .field-valid');
        Array.prototype.forEach.call(fields, function (field) {
            clearFieldValidation(field);
        });

        var messages = container.querySelectorAll('.field-validation');
        Array.prototype.forEach.call(messages, function (message) {
            message.remove();
        });
    }

    window.showConfirm = showConfirm;
    window.setFieldValidation = setFieldValidation;
    window.clearValidation = clearValidation;
})();
