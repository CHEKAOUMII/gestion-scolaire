const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database('/home/chekaoumi/.config/gestion-scolaire/gestion-scolaire.db');

const now = new Date().toISOString();
const hmac = crypto.createHmac('sha256', 'gestion-scolaire-trial').update(now).digest('hex');

db.prepare("UPDATE settings SET value = ? WHERE key = 'trial_start_date'").run(now);
db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('trial_start_hmac', ?)").run(hmac);
db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('trial_duration', ?)").run('6months');

console.log('Trial reset to:', now);
console.log('New HMAC:', hmac);
console.log('Duration: 6months');

db.close();
process.exit(0);
