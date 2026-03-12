// Temporary script to reset admin password — run with: npx electron reset-admin.js
const path = require('path');
const Database = require('better-sqlite3');
const { hashPassword } = require('./main/auth/password');

const dbPath = path.join(process.env.APPDATA, 'gestion-scolaire', 'gestion-scolaire.db');
const db = new Database(dbPath);
const newPass = 'admin123';
const hash = hashPassword(newPass);
db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = 1').run(hash);
const user = db.prepare('SELECT email FROM users WHERE id = 1').get();
console.log('Done! Admin password reset.');
console.log('Email:', user?.email || 'admin@school.local');
console.log('Password:', newPass);
db.close();
process.exit(0);
