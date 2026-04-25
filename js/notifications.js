/**
 * Unified Notification SDK (renderer-side)
 *
 * Replaces all competing showToast definitions with a single implementation.
 * Listens for IPC events from the main-process Notification Engine and
 * provides window.showToast + window.notify for backward compat and new usage.
 */
(function () {
    'use strict';

    // ===== Toast renderer =====

    function renderToast(message, type, duration) {
        type = type || 'success';
        duration = duration || 3000;

        var container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        var toast = document.createElement('div');
        toast.className = 'toast ' + type;

        var icon = document.createElement('i');
        var iconClass = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        icon.className = 'fas ' + (iconClass[type] || iconClass.info);

        var span = document.createElement('span');
        span.textContent = message;

        toast.appendChild(icon);
        toast.appendChild(span);
        container.appendChild(toast);

        requestAnimationFrame(function () {
            toast.classList.add('show');
        });

        var dismissed = false;

        function dismissToast() {
            if (dismissed) return;
            dismissed = true;
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(function () {
                toast.remove();
            }, 300);
        }

        toast.style.cursor = 'pointer';
        toast.addEventListener('click', dismissToast);

        setTimeout(dismissToast, duration);
    }

    // ===== Enhanced toast variants =====

    var _lastToastMessage = '';
    var _lastToastTime = 0;

    function _deduplicateToast(message) {
        var now = Date.now();
        if (message === _lastToastMessage && now - _lastToastTime < 2000) return true;
        _lastToastMessage = message;
        _lastToastTime = now;
        return false;
    }

    function _ensureToastContainer() {
        var container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'true');
        return container;
    }

    function _createNoopHandle() {
        return {
            success: function () {},
            error: function () {},
            progress: function () {},
            dismiss: function () {}
        };
    }

    function renderLoadingToast(message) {
        if (_deduplicateToast(message)) return _createNoopHandle();

        var container = _ensureToastContainer();
        var toast = document.createElement('div');
        toast.className = 'toast loading';
        toast.style.position = 'relative';

        var spinner = document.createElement('i');
        spinner.className = 'fas fa-spinner fa-spin';

        var span = document.createElement('span');
        span.textContent = message;

        var progressBar = document.createElement('div');
        progressBar.className = 'toast-progress-bar';
        progressBar.style.width = '0%';

        var closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        closeBtn.setAttribute('aria-label', 'إغلاق');

        toast.appendChild(spinner);
        toast.appendChild(span);
        toast.appendChild(progressBar);
        toast.appendChild(closeBtn);
        container.appendChild(toast);

        requestAnimationFrame(function () {
            toast.classList.add('show');
        });

        var dismissed = false;

        function dismiss() {
            if (dismissed) return;
            dismissed = true;
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(function () {
                toast.remove();
            }, 300);
        }

        closeBtn.addEventListener('click', dismiss);

        return {
            success: function (msg) {
                if (dismissed) return;
                spinner.className = 'fas fa-check-circle';
                toast.className = 'toast success';
                if (msg) span.textContent = msg;
                progressBar.style.width = '100%';
                setTimeout(dismiss, 3000);
            },
            error: function (msg) {
                if (dismissed) return;
                spinner.className = 'fas fa-exclamation-circle';
                toast.className = 'toast error';
                if (msg) span.textContent = msg;
                progressBar.remove();
                setTimeout(dismiss, 5000);
            },
            progress: function (percent) {
                if (dismissed) return;
                var clamped = Math.max(0, Math.min(100, Number(percent) || 0));
                progressBar.style.width = clamped + '%';
            },
            dismiss: dismiss
        };
    }

    function renderActionToast(message, actionConfig, opts) {
        if (_deduplicateToast(message)) return;
        opts = opts || {};
        var duration = opts.duration || 8000;

        var container = _ensureToastContainer();
        var toast = document.createElement('div');
        toast.className = 'toast ' + (opts.type || 'info');

        var iconMap = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        var icon = document.createElement('i');
        icon.className = 'fas ' + (iconMap[opts.type] || iconMap.info);

        var span = document.createElement('span');
        span.textContent = message;

        toast.appendChild(icon);
        toast.appendChild(span);

        var actionFired = false;

        if (actionConfig && actionConfig.label) {
            var actionBtn = document.createElement('button');
            actionBtn.className = 'toast-action-btn';
            actionBtn.type = 'button';
            if (actionConfig.icon) {
                var btnIcon = document.createElement('i');
                btnIcon.className = 'fas ' + actionConfig.icon;
                actionBtn.appendChild(btnIcon);
                actionBtn.appendChild(document.createTextNode(' '));
            }
            actionBtn.appendChild(document.createTextNode(actionConfig.label));
            actionBtn.addEventListener('click', function () {
                if (!actionFired && typeof actionConfig.onClick === 'function') {
                    actionFired = true;
                    actionConfig.onClick();
                }
                dismissToast();
            });
            toast.appendChild(actionBtn);
        }

        container.appendChild(toast);

        requestAnimationFrame(function () {
            toast.classList.add('show');
        });

        var dismissed = false;

        function dismissToast() {
            if (dismissed) return;
            dismissed = true;
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(function () {
                toast.remove();
            }, 300);
        }

        toast.addEventListener('click', function (e) {
            if (e.target.closest('.toast-action-btn')) return;
            dismissToast();
        });

        setTimeout(dismissToast, duration);
    }

    // ===== Notification center helpers =====

    function formatRelativeTime(timestamp) {
        var diff = Date.now() - timestamp;
        var minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'الآن';
        if (minutes < 60) return 'منذ ' + minutes + ' دقيقة';
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return 'منذ ' + hours + ' ساعة';
        var days = Math.floor(hours / 24);
        return 'منذ ' + days + ' يوم';
    }

    function updateBadge() {
        if (!window.api || !window.api.notifications) return;
        window.api.notifications.unreadCount().then(function (count) {
            var btn = document.querySelector('.notification-btn');
            if (!btn) return;
            var badge = btn.querySelector('.notification-badge');
            if (count > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'notification-badge';
                    btn.appendChild(badge);
                }
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = '';
            } else if (badge) {
                badge.style.display = 'none';
            }
        });
    }

    function createNotificationItem(data) {
        var item = document.createElement('div');
        item.className = 'notification-item' + (data.read ? '' : ' unread');
        item.dataset.id = data.id;
        item.innerHTML =
            '<div class="notification-icon"><i class="fas ' +
            (data.icon || 'fa-bell') +
            '"></i></div>' +
            '<div class="notification-content">' +
            '<p>' +
            escapeHtml(data.body || data.title || '') +
            '</p>' +
            '<span class="notification-time">' +
            formatRelativeTime(data.created_at || data.timestamp) +
            '</span>' +
            '</div>';

        item.addEventListener('click', function () {
            if (!data.read && window.api && window.api.notifications) {
                window.api.notifications.markRead(data.id);
                item.classList.remove('unread');
                updateBadge();
            }
        });

        return item;
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    // ===== Real notification panel =====

    function showNotificationsPanel() {
        var existing = document.querySelector('.notifications-dropdown');
        if (existing) {
            existing.remove();
            return;
        }

        var dropdown = document.createElement('div');
        dropdown.className = 'notifications-dropdown';

        var header = document.createElement('div');
        header.className = 'notifications-header';
        header.innerHTML =
            '<h4><i class="fas fa-bell"></i> الإشعارات</h4>' +
            '<button class="mark-all-read"><i class="fas fa-check-double"></i> تحديد الكل كمقروء</button>';
        dropdown.appendChild(header);

        var list = document.createElement('div');
        list.className = 'notifications-list';
        list.innerHTML = '<div class="notification-loading">جاري التحميل...</div>';
        dropdown.appendChild(list);

        var headerRight = document.querySelector('.header-right');
        if (headerRight) {
            headerRight.appendChild(dropdown);
        } else {
            document.body.appendChild(dropdown);
        }

        // Mark all read button
        header.querySelector('.mark-all-read').addEventListener('click', function () {
            if (window.api && window.api.notifications) {
                window.api.notifications.markAllRead().then(function () {
                    var items = list.querySelectorAll('.notification-item.unread');
                    for (var i = 0; i < items.length; i++) {
                        items[i].classList.remove('unread');
                    }
                    updateBadge();
                });
            }
        });

        // Load real notifications
        if (window.api && window.api.notifications) {
            window.api.notifications.getRecent(20).then(function (notifications) {
                list.innerHTML = '';
                if (!notifications || notifications.length === 0) {
                    list.innerHTML = '<div class="notification-empty">لا توجد إشعارات</div>';
                    return;
                }
                for (var i = 0; i < notifications.length; i++) {
                    list.appendChild(createNotificationItem(notifications[i]));
                }
            });
        } else {
            list.innerHTML = '<div class="notification-empty">لا توجد إشعارات</div>';
        }

        // Close on outside click
        setTimeout(function () {
            document.addEventListener('click', function closeDropdown(e) {
                if (!e.target.closest('.notification-btn') && !e.target.closest('.notifications-dropdown')) {
                    dropdown.remove();
                    document.removeEventListener('click', closeDropdown);
                }
            });
        }, 100);
    }

    // ===== IPC listeners =====

    if (window.api && window.api.notifications) {
        // Listen for toast events from the main process
        if (window.api.notifications.onToast) {
            window.api.notifications.onToast(function (data) {
                renderToast(data.message, data.type, data.duration);
            });
        }

        // Listen for notification center updates
        if (window.api.notifications.onCenterUpdate) {
            window.api.notifications.onCenterUpdate(function (data) {
                updateBadge();
                var panel = document.querySelector('.notifications-dropdown .notifications-list');
                if (panel) {
                    // Remove empty/loading message
                    var empty = panel.querySelector('.notification-empty, .notification-loading');
                    if (empty) empty.remove();
                    // Prepend new item
                    panel.insertBefore(createNotificationItem(data), panel.firstChild);
                }
            });
        }

        // Initial badge update on page load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', updateBadge);
        } else {
            updateBadge();
        }
    }

    // ===== Global API =====

    // Backward-compatible global showToast (replaces all 3 competing definitions)
    window.showToast = renderToast;
    window.showToast.loading = renderLoadingToast;
    window.showToast.action = renderActionToast;

    // New unified dispatch — sends through the engine
    window.notify = function (event) {
        if (window.api && window.api.notifications && window.api.notifications.send) {
            return window.api.notifications.send(event);
        }
        // Fallback: local toast only
        renderToast(event.payload && event.payload.message ? event.payload.message : event.type, event.severity);
    };

    // Expose panel function for the notification bell button
    window.showNotificationsPanel = showNotificationsPanel;
})();
