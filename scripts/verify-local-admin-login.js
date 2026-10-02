/**
 * Verify local admin credentials against the app DB (no Firebase).
 *   npx electron scripts/verify-local-admin-login.js
 */
const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3');
const { verifyPassword } = require('../main/auth/password');

const EMAIL = 'admin@local.dev';
const PASSWORD = 'Admin123!';

app.setName('gestion-scolaire');
const roaming = process.env.APPDATA || path.join(app.getPath('home'), 'AppData', 'Roaming');
app.setPath('userData', path.join(roaming, 'gestion-scolaire'));

app.whenReady().then(() => {
    try {
        const dbPath = path.join(app.getPath('userData'), 'gestion-scolaire.db');
        const db = new Database(dbPath, { readonly: true });
        const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(EMAIL);
        console.log('[verify] DB:', dbPath);
        if (!user) {
            console.error('[verify] FAIL: user not found:', EMAIL);
            process.exitCode = 1;
            app.quit();
            return;
        }
        console.log('[verify] user:', {
            id: user.id,
            email: user.email,
            role: user.role,
            auth_source: user.auth_source,
            disabled: user.disabled
        });
        const ok = verifyPassword(PASSWORD, user.password_hash);
        console.log('[verify] password matches:', ok);
        console.log('[verify] auth_source is local:', String(user.auth_source).toLowerCase() === 'local');
        if (!ok || Number(user.disabled) === 1 || String(user.role).toLowerCase() !== 'admin') {
            process.exitCode = 1;
            console.error('[verify] FAIL');
        } else {
            console.log('[verify] OK — restart the app, then login with:');
            console.log('  Email:', EMAIL);
            console.log('  Password:', PASSWORD);
        }
        db.close();
    } catch (err) {
        console.error('[verify] error', err);
        process.exitCode = 1;
    } finally {
        app.quit();
    }
});
