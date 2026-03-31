/**
 * Message System - Unified confirmations and field validation
 * نظام الرسائل الموحد - تأكيدات والتحقق من الحقول
 */
(function () {
    'use strict';

    var MSG_TYPE_CONFIG = {
        danger: { headerClass: 'danger', icon: 'fa-exclamation-triangle', confirmClass: 'btn-danger' },
        warning: { headerClass: 'warning', icon: 'fa-exclamation-circle', confirmClass: 'btn-warning' },
        info: { headerClass: 'info', icon: 'fa-info-circle', confirmClass: 'btn-primary' }
    };

    var _activeConfirm = null;

    function _escHtml(str) {
        var div = document.createElement('div');
        div.textContent = String(str || '');
        return div.innerHTML;
    }

    function _resolveConfirm(confirmed) {
        if (!_activeConfirm) return;

        var overlay = _activeConfirm.overlay;
        var resolve = _activeConfirm.resolve;
        var inputEl = _activeConfirm.inputEl;
        var inputValue = inputEl ? inputEl.value : undefined;
        var dialogClose = typeof closeDialog === 'function' ? closeDialog : null;

        _activeConfirm = null;
        overlay.classList.remove('active');

        if (dialogClose) {
            dialogClose(overlay);
        }

        setTimeout(function () {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 200);

        resolve({ confirmed: confirmed, inputValue: inputValue });
    }

    function showConfirm(config) {
        if (_activeConfirm) {
            _resolveConfirm(false);
        }

        config = config || {};

        return new Promise(function (resolve) {
            var type = config.type || 'info';
            var typeConfig = MSG_TYPE_CONFIG[type] || MSG_TYPE_CONFIG.info;
            var icon = config.icon || typeConfig.icon;
            var confirmText = config.confirmText || 'تأكيد';
            var cancelText = config.cancelText || 'إلغاء';
            var confirmBtnClass = config.confirmClass || typeConfig.confirmClass;
            var dialogOpen = typeof openDialog === 'function' ? openDialog : null;

            var overlay = document.createElement('div');
            overlay.className = 'msg-confirm-overlay';
            overlay.setAttribute('role', 'alertdialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'msg-confirm-title');
            overlay.setAttribute('aria-describedby', 'msg-confirm-message');

            var inputHTML = config.requireInput
                ? '<input class="msg-confirm-input" id="msg-confirm-input" type="text" placeholder="' +
                  _escHtml(config.inputPlaceholder || '') +
                  '" autocomplete="off" />'
                : '';

            var detailHTML = config.detail ? '<p class="msg-confirm-detail">' + _escHtml(config.detail) + '</p>' : '';

            overlay.innerHTML =
                '<div class="msg-confirm-card">' +
                '  <div class="msg-confirm-header ' +
                typeConfig.headerClass +
                '">' +
                '    <i class="fas ' +
                _escHtml(icon) +
                '" aria-hidden="true"></i>' +
                '    <h3 class="msg-confirm-title" id="msg-confirm-title">' +
                _escHtml(config.title || 'تأكيد') +
                '</h3>' +
                '    <button type="button" class="msg-confirm-close" data-action="cancel" aria-label="إغلاق">' +
                '      <i class="fas fa-times" aria-hidden="true"></i>' +
                '    </button>' +
                '  </div>' +
                '  <div class="msg-confirm-body">' +
                '    <p class="msg-confirm-message" id="msg-confirm-message">' +
                _escHtml(config.message || '') +
                '</p>' +
                detailHTML +
                inputHTML +
                '  </div>' +
                '  <div class="msg-confirm-actions">' +
                '    <button type="button" class="btn btn-secondary" data-action="cancel">' +
                '      <i class="fas fa-times" aria-hidden="true"></i> ' +
                _escHtml(cancelText) +
                '    </button>' +
                '    <button type="button" class="btn ' +
                _escHtml(confirmBtnClass) +
                '" data-action="confirm" id="msg-confirm-ok">' +
                '      <i class="fas fa-check" aria-hidden="true"></i> ' +
                _escHtml(confirmText) +
                '    </button>' +
                '  </div>' +
                '</div>';

            document.body.appendChild(overlay);

            var confirmBtn = overlay.querySelector('[data-action="confirm"]');
            var inputEl = overlay.querySelector('#msg-confirm-input');

            if (config.requireInput && confirmBtn) {
                confirmBtn.disabled = true;

                if (inputEl) {
                    inputEl.addEventListener('input', function () {
                        confirmBtn.disabled = !inputEl.value.trim();
                    });
                }
            }

            _activeConfirm = { overlay: overlay, resolve: resolve, inputEl: inputEl };

            requestAnimationFrame(function () {
                overlay.classList.add('active');
            });

            if (dialogOpen) {
                dialogOpen(overlay, {
                    contentSelector: '.msg-confirm-card',
                    initialFocus: config.requireInput ? '#msg-confirm-input' : '#msg-confirm-ok',
                    onCloseRequest: function () {
                        _resolveConfirm(false);
                    }
                });
            } else {
                requestAnimationFrame(function () {
                    var target = config.requireInput ? inputEl : confirmBtn;
                    if (target) {
                        target.focus();
                    }
                });
            }

            overlay.addEventListener('click', function (e) {
                var action = e.target.closest('[data-action]');

                if (action && action.dataset.action === 'confirm') {
                    _resolveConfirm(true);
                } else if (action && action.dataset.action === 'cancel') {
                    _resolveConfirm(false);
                } else if (e.target === overlay) {
                    _resolveConfirm(false);
                }
            });

            overlay.addEventListener('keydown', function (e) {
                if (!dialogOpen && e.key === 'Escape') {
                    e.preventDefault();
                    _resolveConfirm(false);
                }

                if (e.key === 'Enter' && e.target === inputEl && confirmBtn && !confirmBtn.disabled) {
                    e.preventDefault();
                    _resolveConfirm(true);
                }
            });
        });
    }

    var VALIDATION_ICON = {
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        success: 'fa-check-circle'
    };

    var VALIDATION_FIELD_CLASS = {
        error: 'field-invalid',
        warning: 'field-warning',
        success: 'field-valid'
    };

    function _clearFieldValidation(field) {
        if (!field) return;

        field.classList.remove('field-invalid', 'field-warning', 'field-valid');
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');

        var existingId = field.dataset.validationId;
        if (existingId) {
            var existingEl = document.getElementById(existingId);
            if (existingEl && existingEl.parentNode) {
                existingEl.parentNode.removeChild(existingEl);
            }
            delete field.dataset.validationId;
        }
    }

    function setFieldValidation(field, message, type) {
        if (!field) return;

        type = type || 'error';

        _clearFieldValidation(field);

        if (!message) return;
        if (!field.parentNode) return;

        var cls = VALIDATION_FIELD_CLASS[type];
        if (cls) {
            field.classList.add(cls);
        }

        if (type === 'error') {
            field.setAttribute('aria-invalid', 'true');
        }

        var id = 'fv-' + Math.random().toString(36).slice(2, 8);
        field.dataset.validationId = id;
        field.setAttribute('aria-describedby', id);

        var div = document.createElement('div');
        div.className = 'field-validation ' + type;
        div.setAttribute('role', type === 'error' ? 'alert' : 'status');
        div.id = id;

        var icon = document.createElement('i');
        icon.className = 'fas ' + (VALIDATION_ICON[type] || VALIDATION_ICON.error);
        icon.setAttribute('aria-hidden', 'true');

        var span = document.createElement('span');
        span.textContent = message;

        div.appendChild(icon);
        div.appendChild(span);
        field.parentNode.insertBefore(div, field.nextSibling);

        requestAnimationFrame(function () {
            div.classList.add('visible');
        });
    }

    function clearValidation(container) {
        if (!container) return;

        var messages = container.querySelectorAll('.field-validation');
        messages.forEach(function (el) {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        });

        var fields = container.querySelectorAll('.field-invalid, .field-warning, .field-valid');
        fields.forEach(function (el) {
            el.classList.remove('field-invalid', 'field-warning', 'field-valid');
            el.removeAttribute('aria-invalid');
            el.removeAttribute('aria-describedby');
            delete el.dataset.validationId;
        });
    }

    window.showConfirm = showConfirm;
    window.setFieldValidation = setFieldValidation;
    window.clearValidation = clearValidation;
})();
