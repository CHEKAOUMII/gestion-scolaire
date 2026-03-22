const { Notification } = require('electron');

const lastSent = new Map();
const THROTTLE_MS = 30_000; // max 1 native notification per type every 30s

module.exports = {
    send(rendered, event) {
        if (!Notification.isSupported()) {
            return { success: false, error: 'OS notifications not supported' };
        }

        // Per-type throttle
        const now = Date.now();
        const lastTime = lastSent.get(event.type);
        if (lastTime && now - lastTime < THROTTLE_MS) {
            return { success: false, error: 'throttled' };
        }
        lastSent.set(event.type, now);

        const notif = new Notification({
            title: rendered.title || '',
            body: rendered.body || ''
        });
        notif.show();
        return { success: true };
    }
};
