const { createOfflineLicenseKey } = require('../main/licensing/offlineKey');

function parseArgs(argv) {
    const args = {};
    argv.forEach((entry) => {
        const [key, value] = entry.split('=');
        if (!key || value === undefined) return;
        args[key.replace(/^--/, '')] = value;
    });
    return args;
}

function addDays(days) {
    const ms = Number(days || 0) * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ms).toISOString();
}

function run() {
    const args = parseArgs(process.argv.slice(2));

    const plan = String(args.plan || 'basic').toLowerCase();
    const days = Number(args.days || 365);
    const customer = String(args.customer || '');
    const online = String(args.online || 'false').toLowerCase() === 'true';
    const device = String(args.device || '')
        .trim()
        .toLowerCase();
    const expiresAt = Number.isFinite(days) && days > 0 ? addDays(days) : null;

    const key = createOfflineLicenseKey({
        planCode: plan,
        expiresAt,
        customerRef: customer,
        requiresOnlineValidation: online,
        deviceCode: device
    });

    console.log('Generated key:');
    console.log(key);
    console.log('---');
    console.log(`plan=${plan} days=${days} onlineValidation=${online}`);
    if (device) {
        console.log(`device=${device}`);
    }
    if (customer) {
        console.log(`customer=${customer}`);
    }
}

run();
