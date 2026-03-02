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

        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'toast ' + type;

        const icon = document.createElement('i');
        const iconClass = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle',
        };
        icon.className = 'fas ' + (iconClass[type] || iconClass.info);

        const span = document.createElement('span');
        span.textContent = message;

        toast.appendChild(icon);
        toast.appendChild(span);
        container.appendChild(toast);

        setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(function () {
                toast.remove();
            }, 300);
        }, duration);
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
