const Database = require('better-sqlite3');
const db = new Database('/home/chekaoumi/.config/gestion-scolaire/gestion-scolaire.db');

const SCHOOL_ID = '14007Z';

console.log('=== BEFORE ===');
try { console.log('institution_config:', db.prepare('SELECT id, code_etablissement, setup_completed, setup_mode FROM institution_config WHERE id = 1').get()); } catch(e) { console.log('institution_config error:', e.message); }
try { console.log('sync_config:', db.prepare('SELECT id, school_id, enabled FROM sync_config WHERE id = 1').get()); } catch(e) { console.log('sync_config error:', e.message); }

try {
    const inst = db.prepare('SELECT id FROM institution_config WHERE id = 1').get();
    if (inst) {
        db.prepare("UPDATE institution_config SET code_etablissement = ?, setup_completed = 1, setup_mode = COALESCE(NULLIF(setup_mode, ''), 'firebase-login') WHERE id = 1").run(SCHOOL_ID);
    } else {
        db.prepare("INSERT INTO institution_config(id, code_etablissement, setup_completed, setup_mode) VALUES(1, ?, 1, 'firebase-login')").run(SCHOOL_ID);
    }
    console.log('institution_config UPDATED');
} catch(e) { console.log('institution_config fix error:', e.message); }

try {
    const sync = db.prepare('SELECT id FROM sync_config WHERE id = 1').get();
    if (sync) {
        db.prepare('UPDATE sync_config SET school_id = ?, enabled = 1 WHERE id = 1').run(SCHOOL_ID);
    } else {
        db.prepare('INSERT INTO sync_config(id, school_id, enabled, sync_interval_minutes, retention_days) VALUES(1, ?, 1, 10, 7)').run(SCHOOL_ID);
    }
    console.log('sync_config UPDATED');
} catch(e) { console.log('sync_config fix error:', e.message); }

console.log('=== AFTER ===');
try { console.log('institution_config:', db.prepare('SELECT id, code_etablissement, setup_completed, setup_mode FROM institution_config WHERE id = 1').get()); } catch(e) { console.log('ERROR:', e.message); }
try { console.log('sync_config:', db.prepare('SELECT id, school_id, enabled FROM sync_config WHERE id = 1').get()); } catch(e) { console.log('ERROR:', e.message); }

db.close();
process.exit(0);
