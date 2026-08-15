
const staffRepo = require('./main/repos/staff.js');
const { setRepoCapturePort, createNoOpCapturePort } = require('./main/repos/capture-port');
setRepoCapturePort(createNoOpCapturePort());
let Database, useNative = true;
try { Database = require('better-sqlite3'); new Database(':memory:').close(); } catch { Database = require('node:sqlite').DatabaseSync; useNative = false; }
const db = new Database(':memory:');
if (!useNative) {
  db.transaction = (fn) => (...args) => { db.exec('BEGIN'); try { const v = fn(...args); db.exec('COMMIT'); return v; } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; } };
}
db.exec(`
CREATE TABLE teachers(id INTEGER PRIMARY KEY AUTOINCREMENT, ppr TEXT, cin TEXT, full_name TEXT NOT NULL, full_name_fr TEXT, subject TEXT, specialty_subject TEXT, gender TEXT, birth_date TEXT, birth_place TEXT, phone TEXT, email TEXT, address TEXT, grade TEXT, cadre TEXT, echelon INTEGER, hire_date TEXT, marital_status TEXT, function_title TEXT, position TEXT, statut TEXT, diploma_school TEXT, diploma_professional TEXT, seniority_admin TEXT, seniority_grade TEXT, echelon_date TEXT, titularization_date TEXT, total_hours REAL, overtime_hours REAL, num_classes REAL, is_surplus INTEGER DEFAULT 0, source TEXT DEFAULT 'manual', school_year TEXT, active INTEGER DEFAULT 1, source_function_code TEXT, source_assignment_mode TEXT, source_cycle_code TEXT, scope_type TEXT NOT NULL DEFAULT 'teaching_assignment', source_updated_at TEXT, source_activity_json TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE teacher_aliases(id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, alias_name TEXT NOT NULL, alias_normalized TEXT NOT NULL, source TEXT, school_year TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(teacher_id, school_year, alias_normalized));
CREATE UNIQUE INDEX idx_teacher_ppr_year ON teachers(ppr, school_year) WHERE ppr IS NOT NULL AND ppr != '';
`);
const year = '2025/2026';
const t = (o) => ({ ppr:'PPR001', full_name:'أستاذ تجريبي', subject:'الرياضيات', specialty_subject:'رياضيات', grade:'أستاذ مبرز', cadre:'التعليم الثانوي', total_hours:21, source:'agent_xml', school_year:year, active:1, source_updated_at:'2026-03-01T10:00:00Z', ...o });
console.log('1:', JSON.stringify(staffRepo.importBulk(db,[t({})])));
console.log('row1:', JSON.stringify(db.prepare('SELECT specialty_subject, grade, source_updated_at FROM teachers').get()));
const r2 = staffRepo.importBulk(db,[t({ specialty_subject:null, grade:null, source_updated_at:'2026-03-02T10:00:00Z' })]);
console.log('2:', JSON.stringify(r2));
console.log('row2:', JSON.stringify(db.prepare('SELECT specialty_subject, grade, source_updated_at FROM teachers').get()));
