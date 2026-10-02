/**
 * Create or reset a local admin user for development.
 * Run with Electron so better-sqlite3 matches the app ABI:
 *   npx electron scripts/create-admin-user.js
 */
const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3');
const { hashPassword } = require('../main/auth/password');

const EMAIL = 'admin@local.dev';
const NAME = 'Admin Local';
const ROLE = 'admin';
const PASSWORD = 'Admin123!';

// Match the packaged app name so userData resolves to
// %APPDATA%/gestion-scolaire (not the default "Electron" folder).
app.setName('gestion-scolaire');
if (typeof app.setPath === 'function') {
    const roaming = process.env.APPDATA || path.join(app.getPath('home'), 'AppData', 'Roaming');
    app.setPath('userData', path.join(roaming, 'gestion-scolaire'));
}

app.whenReady().then(() => {
    try {
        const dbPath = path.join(app.getPath('userData'), 'gestion-scolaire.db');
        console.log('[create-admin] DB:', dbPath);

        const db = new Database(dbPath);
        try {
            const passwordHash = hashPassword(PASSWORD);
            const existing = db
                .prepare('SELECT id, email, role FROM users WHERE lower(email) = lower(?)')
                .get(EMAIL);

            if (existing) {
                db.prepare(
                    `
                    UPDATE users
                    SET name = ?,
                        role = ?,
                        password_hash = ?,
                        disabled = 0,
                        must_change_password = 0,
                        auth_source = 'local',
                        invite_status = 'active'
                    WHERE id = ?
                `
                ).run(NAME, ROLE, passwordHash, existing.id);
                console.log('[create-admin] Updated existing user id=', existing.id);
            } else {
                const result = db
                    .prepare(
                        `
                    INSERT INTO users(name, email, role, password_hash, disabled, must_change_password, auth_source, invite_status)
                    VALUES(?, ?, ?, ?, 0, 0, 'local', 'active')
                `
                    )
                    .run(NAME, EMAIL, ROLE, passwordHash);
                console.log('[create-admin] Created user id=', result.lastInsertRowid);
            }

            const row = db
                .prepare(
                    'SELECT id, name, email, role, disabled, must_change_password, auth_source FROM users WHERE lower(email) = lower(?)'
                )
                .get(EMAIL);
            console.log('[create-admin] User row:', row);
            console.log('');
            console.log('=== Login credentials ===');
            console.log('Email:   ', EMAIL);
            console.log('Password:', PASSWORD);
            console.log('Role:    ', ROLE);
            console.log('=========================');
        } finally {
            db.close();
        }
    } catch (err) {
        console.error('[create-admin] Failed:', err);
        process.exitCode = 1;
    } finally {
        app.quit();
    }
});
