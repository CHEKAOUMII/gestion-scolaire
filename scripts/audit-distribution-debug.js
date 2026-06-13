#!/usr/bin/env node
/**
 * Independent auditor for a captured V3 distribution-debug JSON.
 * Verifies hard constraints directly from rows (not trusting diagnostics).
 * Usage: node scripts/audit-distribution-debug.js <path-to-json>
 */
'use strict';
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/audit-distribution-debug.js <file.json>'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const dist = data.distribution || {};
const rows = dist.rows || [];
const diag = (dist.diagnostics) || (data.summary && data.summary.savedDiagnostics) || {};
const inputs = data.inputs || {};
const proctors = inputs.proctorsList || [];
const rules = inputs.rules || {};
const proctorsPerRoom = rules.proctorsPerRoom || 2;

// ---- canonical key set + name map
const validKeys = new Set();
const keyToName = {};
proctors.forEach((p, i) => {
  const cin = (p.cin && String(p.cin).trim()) ? String(p.cin).trim() : '';
  const key = cin || ('__idx_' + i);
  validKeys.add(key);
  keyToName[key] = p.teacher_full_name || p.teacher_name || ('#' + i);
});

const issues = [];
const add = (sev, code, msg, extra) => issues.push({ sev, code, msg, extra });

// ===== C1: coverage — each row has exactly proctorsPerRoom guards, no null =====
let nullSlots = 0, wrongLen = 0;
rows.forEach((r, idx) => {
  const ks = r.proctor_keys || [];
  if (ks.length !== proctorsPerRoom) { wrongLen++; add('HARD', 'C1-LEN', `row ${idx} proctor_keys length ${ks.length} != ${proctorsPerRoom}`, r.session_key); }
  ks.forEach((k, si) => { if (!k) { nullSlots++; add('HARD', 'C1-NULL', `row ${idx} slot ${si} is null`, r.session_key); } });
});

// ===== C-CANONICAL: every key in proctor_keys ∪ reserve_keys is valid =====
const guardCount = {}, reserveCount = {};
const orphan = new Set();
rows.forEach(r => {
  (r.proctor_keys || []).forEach(k => { if (k) { guardCount[k] = (guardCount[k] || 0) + 1; if (!validKeys.has(k)) orphan.add(k); } });
  (r.reserve_keys || []).forEach(k => { if (k) { reserveCount[k] = (reserveCount[k] || 0) + 1; if (!validKeys.has(k)) orphan.add(k); } });
});
if (orphan.size) add('HARD', 'C-CANONICAL', `${orphan.size} orphan keys not in proctorsList`, [...orphan]);

const GHOSTS = ['1909564','2367149','1910812','2158781','1545317','1177902'];
const ghostsFound = GHOSTS.filter(g => guardCount[g] || reserveCount[g]);
if (ghostsFound.length) add('HARD', 'GHOST', `ghost keys present`, ghostsFound);

// ===== C-NO-DOUBLE within row (guard ∪ reserve) =====
rows.forEach((r, idx) => {
  const seen = {};
  [...(r.proctor_keys || []), ...(r.reserve_keys || [])].filter(Boolean).forEach(k => { seen[k] = (seen[k] || 0) + 1; });
  Object.entries(seen).forEach(([k, c]) => { if (c > 1) add('HARD', 'C-NO-DOUBLE-ROW', `row ${idx} key ${k} appears ${c}x`, r.session_key); });
});

// ===== C-NO-DOUBLE across rows of same session_key (guard ∪ reserve) =====
const bySession = {};
rows.forEach((r, idx) => { (bySession[r.session_key] = bySession[r.session_key] || []).push({ r, idx }); });
Object.entries(bySession).forEach(([sk, group]) => {
  const seen = {};
  group.forEach(({ r }) => {
    [...(r.proctor_keys || []), ...(r.reserve_keys || [])].filter(Boolean).forEach(k => { seen[k] = (seen[k] || 0) + 1; });
  });
  Object.entries(seen).forEach(([k, c]) => { if (c > 1) add('HARD', 'C-NO-DOUBLE-SESSION', `session ${sk} key ${k} (${keyToName[k]||k}) appears ${c}x across rooms`, null); });
});

// ===== C-NO-SAME-DAY (default strict): no key in two different halfdays of same day (guard∪reserve) =====
const sameDayFlag = (inputs.rules && inputs.rules.allowSameDayBothHalfdays) ||
                    (diag && diag.sameDayAllowed) || false;
// build day -> halfday -> set(keys guard∪reserve)
const dayMap = {};
rows.forEach(r => {
  const day = r.day_key, hd = r.halfday_key;
  if (!day || !hd) return;
  dayMap[day] = dayMap[day] || {};
  const set = (dayMap[day][hd] = dayMap[day][hd] || new Set());
  [...(r.proctor_keys || []), ...(r.reserve_keys || [])].filter(Boolean).forEach(k => set.add(k));
});
let sameDayViol = 0;
Object.entries(dayMap).forEach(([day, hds]) => {
  const hdKeys = Object.keys(hds);
  for (let a = 0; a < hdKeys.length; a++) {
    for (let b = a + 1; b < hdKeys.length; b++) {
      const A = hds[hdKeys[a]], B = hds[hdKeys[b]];
      A.forEach(k => { if (B.has(k)) { sameDayViol++; add(sameDayFlag ? 'INFO' : 'HARD', 'C-NO-SAME-DAY', `${keyToName[k]||k} appears in ${hdKeys[a]} AND ${hdKeys[b]} (day ${day})`, null); } });
    }
  }
});

// ===== Fairness: strict bimodal on histogramByPrimaryLoad =====
const histGuard = {};
Object.values(guardCount).forEach(c => { histGuard[c] = (histGuard[c] || 0) + 1; });
const histPrimary = diag.histogramByPrimaryLoad || null;
function checkBimodal(h, label) {
  if (!h) return;
  const keys = Object.keys(h).map(Number).sort((a, b) => a - b);
  if (keys.length > 2) add('FAIR', 'BIMODAL', `${label} has ${keys.length} distinct keys: ${keys.join(',')}`);
  else if (keys.length === 2 && keys[1] - keys[0] !== 1) add('FAIR', 'BIMODAL-GAP', `${label} keys not consecutive: ${keys.join(',')}`);
}
checkBimodal(histGuard, 'histogramByGuardCount(recomputed)');
checkBimodal(histPrimary, 'histogramByPrimaryLoad(diag)');

// ===== zero-load proctors =====
const zero = [];
validKeys.forEach(k => { if (!guardCount[k]) zero.push(keyToName[k] || k); });

// ===== bounds compliance per proctor (guard count vs class bounds) =====
const cb = diag.classBoundsByProctorKey || {};
let boundViol = 0;
Object.entries(cb).forEach(([k, b]) => {
  const load = guardCount[k] || 0; // note: primary load adds duty; guard-only check is a subset
  // We can't recompute duty here reliably; just flag guard load above upper bound
  if (load > b.classUpperBound) { boundViol++; add('FAIR', 'UPPER', `${keyToName[k]||k} guardCount ${load} > classUpperBound ${b.classUpperBound}`); }
});

// ===== dutyCount computation =====
const dutyCount = {};
const adapter = {};
proctors.forEach((p, i) => {
  const cin = (p.cin && String(p.cin).trim()) ? String(p.cin).trim() : '';
  const canonical = cin || ('__idx_' + i);
  adapter[canonical] = canonical;
  if (cin) {
    adapter[cin] = canonical;
  }
  const som = (p.som && String(p.som).trim()) ? String(p.som).trim() : '';
  if (som) {
    if (adapter[som] === undefined) {
      adapter[som] = canonical;
    }
  }
  adapter['idx_' + i] = canonical;
  adapter['__idx_' + i] = canonical;
});
function toCanonical(extKey) {
  if (!extKey) return null;
  const s = String(extKey).trim();
  return adapter[s] || null;
}
if (inputs.dutyData) {
  Object.values(inputs.dutyData).forEach(inner => {
    if (inner && typeof inner === 'object') {
      Object.keys(inner).forEach(extKey => {
        const canonical = toCanonical(extKey);
        if (canonical) {
          dutyCount[canonical] = (dutyCount[canonical] || 0) + 1;
        }
      });
    }
  });
}

// ===== Reserve_Global_Upper (cap) =====
const G = Object.values(guardCount).reduce((a, b) => a + b, 0);
const R = Object.values(reserveCount).reduce((a, b) => a + b, 0);
let capD = 0;
if (diag && diag.bounds && diag.bounds.global && typeof diag.bounds.global.dExpected === 'number') {
  capD = diag.bounds.global.dExpected;
} else if (inputs.examCenterConfig && inputs.examCenterConfig.expected_duty_tasks != null) {
  capD = Math.max(0, Math.floor(Number(inputs.examCenterConfig.expected_duty_tasks)));
} else if (inputs.D_expected != null) {
  capD = Math.max(0, Math.floor(Number(inputs.D_expected)));
}
let capN = proctors.length;
if (diag && diag.bounds && diag.bounds.global && typeof diag.bounds.global.nEligible === 'number') {
  capN = diag.bounds.global.nEligible;
}
const cap = capN > 0 ? Math.ceil((G + R + capD) / capN) : 0;

// ===== Final_Load histogram + violations =====
const finalLoads = {};
const histFinalLoad = {};
let finalLoadViolations = 0;
validKeys.forEach(k => {
  const g = guardCount[k] || 0;
  const d = dutyCount[k] || 0;
  const r = reserveCount[k] || 0;
  const fl = g + d + r;
  finalLoads[k] = fl;
  histFinalLoad[fl] = (histFinalLoad[fl] || 0) + 1;
  if (fl > cap) {
    finalLoadViolations++;
    add('FAIR', 'FINAL-LOAD-OVERFLOW', `${keyToName[k]||k} Final_Load ${fl} > cap ${cap} (G=${g}, D=${d}, R=${r})`, { key: k, fl, cap });
  }
});

// ===== Cross-check finalLoadOverflows =====
const jsonOverflows = diag.finalLoadOverflows || [];
const jsonOverflowKeys = new Set(jsonOverflows.map(o => o.canonicalKey));
validKeys.forEach(k => {
  const fl = finalLoads[k] || 0;
  const rc = reserveCount[k] || 0;
  if (fl > cap && rc > 0) {
    if (!jsonOverflowKeys.has(k)) {
      add('HARD', 'OVERFLOW-MISSING-DIAG', `Proctor ${keyToName[k]||k} (key ${k}) has Final_Load ${fl} > cap ${cap} and Reserve_Count ${rc} > 0, but is missing from diagnostics.finalLoadOverflows`, k);
    }
  }
});
jsonOverflows.forEach(o => {
  const k = o.canonicalKey;
  if (!validKeys.has(k)) {
    add('HARD', 'OVERFLOW-INVALID-KEY', `diagnostics.finalLoadOverflows contains invalid key ${k}`, o);
  } else {
    const fl = finalLoads[k] || 0;
    if (fl <= cap) {
      add('HARD', 'OVERFLOW-FALSE-POSITIVE', `diagnostics.finalLoadOverflows lists ${keyToName[k]||k} (key ${k}) as overflow, but their actual Final_Load is ${fl} <= cap ${cap}`, o);
    }
  }
});

// ===== reserves config sanity =====
const totalReserves = Object.values(reserveCount).reduce((a, b) => a + b, 0);

// ---------- report ----------
const hard = issues.filter(i => i.sev === 'HARD');
const fair = issues.filter(i => i.sev === 'FAIR');
const info = issues.filter(i => i.sev === 'INFO');

console.log('══════════════════════════════════════════');
console.log(' تدقيق مستقل لنتيجة التوزيع (V3)');
console.log('══════════════════════════════════════════');
console.log('algorithmVersion :', dist.algorithmVersion);
console.log('proctors         :', proctors.length);
console.log('result rows      :', rows.length);
console.log('total guard slots:', G);
console.log('total reserves   :', totalReserves);
console.log('histogram(guard) :', JSON.stringify(histGuard));
console.log('histogram(primary,diag):', JSON.stringify(histPrimary));
console.log('histogram(final) :', JSON.stringify(histFinalLoad));
console.log('Reserve_Global_Upper (cap) :', cap, '(G=' + G + ', R=' + R + ', D=' + capD + ', N=' + capN + ')');
console.log('finalLoadOverflows (diag)  :', jsonOverflows.length, 'entries');
console.log('globalLowerBound :', diag.globalLowerBound, '| globalUpperBound:', diag.globalUpperBound);
console.log('same-day flag    :', sameDayFlag);
console.log('');
console.log('── القيود الصلبة (HARD) ──');
console.log('  C1 coverage: nullSlots=' + nullSlots + ', wrongLen=' + wrongLen);
console.log('  orphan keys:', orphan.size, '| ghost keys:', ghostsFound.length);
console.log('  same-day violations:', sameDayViol);
console.log('  HARD issues total:', hard.length);
console.log('');
console.log('── الإنصاف (FAIR) ──');
console.log('  zero-load proctors:', zero.length, zero.slice(0, 10));
console.log('  bound violations:', boundViol);
console.log('  FAIR issues total:', fair.length);
console.log('');
console.log('── معلوماتية (INFO) ──:', info.length);
console.log('');

if (issues.length === 0) {
  console.log('✅ لا مخالفات. النتيجة مطابقة للمتفق عليه على مستوى القيود الصلبة والإنصاف.');
} else {
  console.log('تفاصيل المخالفات (حتى 40):');
  issues.slice(0, 40).forEach(i => console.log(`  [${i.sev}] ${i.code}: ${i.msg}` + (i.extra ? ` | ${JSON.stringify(i.extra)}` : '')));
}

// machine-readable verdict
console.log('\nVERDICT:', JSON.stringify({
  hard: hard.length, fair: fair.length, info: info.length,
  pass: hard.length === 0 && fair.length === 0
}));
