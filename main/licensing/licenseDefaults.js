const LICENSE_DEFAULTS = {
    // Shared signing secret for offline license keys.
    // All installations MUST use the same secret so serials are portable across machines.
    // Set once before building installers.
    signingSecret:
        'b7e9a3f15c8d42e6901fbd7c5a3e8f124d6b9c0e7a2f5d8143b6e9a0c3f7d5128e4f1a6d9c2b5083e7f4a1d6c9b2058f3e6a9d2c5b80714e3f0a9d6c5b2e87f14'
};

module.exports = { LICENSE_DEFAULTS };
