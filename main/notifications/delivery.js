const toastAdapter = require('./channels/toast');
const centerAdapter = require('./channels/center');
const nativeAdapter = require('./channels/native');
const emailAdapter = require('./channels/email');

const adapters = {
    toast: toastAdapter,
    center: centerAdapter,
    native: nativeAdapter,
    email: emailAdapter,
};

function deliver(channels, rendered, event) {
    const results = {};
    for (const ch of channels) {
        const adapter = adapters[ch];
        if (!adapter) {
            results[ch] = { success: false, error: `Unknown channel: ${ch}` };
            continue;
        }
        try {
            results[ch] = adapter.send(rendered[ch] || rendered.toast, event);
        } catch (err) {
            console.error(`[notification] delivery error on channel "${ch}":`, err.message);
            results[ch] = { success: false, error: err.message };
        }
    }
    return results;
}

module.exports = { deliver, adapters };
