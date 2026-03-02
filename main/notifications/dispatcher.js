const { validateEvent } = require('./schema');
const { resolveChannels } = require('./router');
const { renderTemplate } = require('./templates');
const { deliver } = require('./delivery');
const store = require('./store');

const recentSourceIds = new Map();
const DEDUP_TTL = 300_000; // 5 minutes

function notify(rawEvent) {
    // 1. Validate & normalize
    const event = validateEvent(rawEvent);

    // 2. Idempotency check
    if (event.sourceId) {
        if (recentSourceIds.has(event.sourceId)) {
            return { status: 'deduplicated', id: event.id };
        }
        recentSourceIds.set(event.sourceId, event.timestamp);
        // Evict stale entries
        for (const [key, ts] of recentSourceIds) {
            if (Date.now() - ts > DEDUP_TTL) recentSourceIds.delete(key);
        }
    }

    // 3. Resolve channels
    const channels = event.channels || resolveChannels(event.type, event.severity);

    // 4. Render templates per channel
    const rendered = {};
    for (const ch of channels) {
        rendered[ch] = renderTemplate(event.type, ch, event.payload, event.severity);
    }

    // 5. Persist to store (for notification center + history)
    if (channels.includes('center')) {
        try {
            store.insert(event, rendered.center);
        } catch (err) {
            console.error('[notification] store insert error:', err.message);
        }
    }

    // 6. Deliver to each channel adapter
    const results = deliver(channels, rendered, event);

    console.log(`[notification] dispatched type="${event.type}" severity=${event.severity} channels=[${channels}]`);
    return { status: 'dispatched', id: event.id, channels, results };
}

module.exports = { notify };
