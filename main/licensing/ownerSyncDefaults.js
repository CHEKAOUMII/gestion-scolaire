const OWNER_SYNC_DEFAULTS = {
    // Set these once before building installers.
    // Example: https://your-owner-server.com
    serverUrl: 'https://project62-production.up.railway.app',

    // Write token used by installed clients (register/heartbeat).
    writeToken: '74c31ceb8b7f02decf4e82734da41c694bc3e8bf0b23ba2d964fca92ee576563',

    // Read token for admin dashboards (overview/devices). Optional if server uses same token.
    readToken: '1d769c8078dc30f847a61303d04483aa15bfae805627fd39242d389376aa45c6',

    // Backward-compatible single token fallback.
    ownerToken: '',

    // Enable automatic sync on all installed clients.
    enabled: true,

    // Heartbeat interval in minutes (5..1440)
    heartbeatIntervalMinutes: 360
};

module.exports = { OWNER_SYNC_DEFAULTS };
