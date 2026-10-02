'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const v2Src = fs.readFileSync('js/algorithms/proctor-distribution-v2.js', 'utf8');
const sb = { console: { log:()=>{}, warn:()=>{}, error:()=>{} }, Date: Date, Math: Math, Number: Number, Object: Object, Array: Array, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite, isNaN: isNaN, Infinity: Infinity, parseInt: parseInt };
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(v2Src, sb);
const V2 = sb.ProctorDistributionV2;

const input = JSON.parse(fs.readFileSync('tests/fixtures/45454.json', 'utf8'));
const out = V2.run(input);
const d = out.diagnostics;

const perKey = {};
for (let i = 0; i < out.result.length; i++) {
  const keys = out.result[i].proctor_keys || [];
  for (let j = 0; j < keys.length; j++) {
    const k = keys[j];
    if (k) perKey[k] = (perKey[k] || 0) + 1;
  }
}

const hist = {};
let max = 0, min = Infinity;
const counts = Object.values(perKey);
for (let i = 0; i < counts.length; i++) {
  const c = counts[i];
  hist[c] = (hist[c] || 0) + 1;
  if (c > max) max = c;
  if (c < min) min = c;
}

const zeroLoad = [];
for (let i = 0; i < input.proctorsList.length; i++) {
  const proc = input.proctorsList[i];
  const canon = proc.cin || ('__idx_' + i);
  if (!perKey[canon]) {
    let dutyCount = 0;
    const dutyData = input.dutyData || {};
    const exKey = proc.cin || proc.som || ('idx_' + i);
    Object.keys(dutyData).forEach(function (dk) {
      const ent = dutyData[dk];
      if (ent && ent[exKey]) dutyCount++;
    });
    zeroLoad.push({ idx: i, name: proc.teacher_name, som: proc.som, cin: proc.cin, dutyCount: dutyCount });
  }
}

process.stdout.write('histogram: ' + JSON.stringify(hist) + '\n');
process.stdout.write('min: ' + min + ' max: ' + max + ' distinct: ' + Object.keys(perKey).length + '\n');
process.stdout.write('coverageRepairSwaps: ' + d.coverageRepairSwaps + ' coverageRepairUnresolved: ' + d.coverageRepairUnresolved + '\n');
process.stdout.write('lowerBound: ' + d.lowerBound + ' upperBound: ' + d.upperBound + '\n');
process.stdout.write('zero-load proctors: ' + zeroLoad.length + '\n');
zeroLoad.forEach(function (p) {
  process.stdout.write('  idx=' + p.idx + ' ' + p.name + ' (som=' + p.som + ', dutyCount=' + p.dutyCount + ')\n');
});

const minLoadProctors = [];
for (let i = 0; i < input.proctorsList.length; i++) {
  const proc = input.proctorsList[i];
  const canon = proc.cin || ('__idx_' + i);
  if (perKey[canon] === 1) {
    minLoadProctors.push({ idx: i, name: proc.teacher_name });
  }
}
process.stdout.write('proctors at load=1 count: ' + minLoadProctors.length + '\n');
