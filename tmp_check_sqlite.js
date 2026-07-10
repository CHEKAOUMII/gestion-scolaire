try {
  const D = require('better-sqlite3');
  const db = new D(':memory:');
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, school_year TEXT)');
  const cols = db.prepare('PRAGMA table_info("t")').all();
  console.log('OK better-sqlite3 loads, cols=', cols.length);
} catch (e) {
  console.log('NO', e.message);
}
