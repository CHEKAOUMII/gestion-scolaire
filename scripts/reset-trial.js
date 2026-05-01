const path = require('path');
const Database = require('better-sqlite3');
const root = path.resolve(__dirname, '..');

const DB_PATH = '/home/chekaoumi/.config/gestion-scolaire/gestion-scolaire.db';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const { setDb } = require(path.join(root, 'main/db/context'));
setDb(db);

const { generateSerialKey, activateLicense } = require(path.join(root, 'main/licensing/service'));

// Generate a pro key for 365 days
const keyResult = generateSerialKey({ planCode: 'pro', days: 365, customerRef: 'CHEKAOUMI-DEV' });
console.log('Generated key:', JSON.stringify(keyResult, null, 2));

if (keyResult.success) {
    const activateResult = activateLicense({ licenseKey: keyResult.serialKey });
    console.log('Activation result:', JSON.stringify(activateResult, null, 2));
}

db.close();
process.exit(0);
