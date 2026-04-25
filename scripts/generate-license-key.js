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
    // Pre-flight: this CLI runs outside Electron, so GESTION_LICENSE_SECRET is required
    const secret = (process.env.GESTION_LICENSE_SECRET || '').trim();
    if (!secret) {
        console.error('ERROR: GESTION_LICENSE_SECRET environment variable is required.');
        console.error('');
        console.error('Usage:');
        console.error('  set GESTION_LICENSE_SECRET=<your-secret>&& node scripts/generate-license-key.js --plan=basic --days=365');
        console.error('');
        console.error('The secret must match the one used by the Electron app (stored in userData/.license-secret).');
        console.error('To use the same secret, copy it from: %APPDATA%/برنامج التدبير المدرسي/.license-secret');
        process.exit(1);
    }

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
