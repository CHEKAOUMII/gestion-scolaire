const OWNER_SYNC_DEFAULTS = {
    // Set these once before building installers.
    // Example: https://your-owner-server.com
    serverUrl: '',

    // Write token used by installed clients (register/heartbeat).
    writeToken: '',

    // Read token for admin dashboards (overview/devices). Optional if server uses same token.
    readToken: '',

    // Backward-compatible single token fallback.
    ownerToken: '',

    // Enable automatic sync on all installed clients.
    enabled: false,

    // Heartbeat interval in minutes (5..1440)
    heartbeatIntervalMinutes: 360
};

module.exports = { OWNER_SYNC_DEFAULTS };
