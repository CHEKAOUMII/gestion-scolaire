const OWNER_SYNC_DEFAULTS = {
    // Leave sync disabled until a deployment provides explicit configuration.
    serverUrl: '',

    // Tokens are intentionally empty by default.
    writeToken: '',

    readToken: '',

    // Backward-compatible single token fallback.
    ownerToken: '',

    // Enable automatic sync only when explicitly configured.
    enabled: false,

    // Heartbeat interval in minutes (5..1440)
    heartbeatIntervalMinutes: 360
};

module.exports = { OWNER_SYNC_DEFAULTS };
