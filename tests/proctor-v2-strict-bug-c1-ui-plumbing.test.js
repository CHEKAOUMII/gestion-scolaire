'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buildUiPlumbingStub } = require('./fixtures/proctor-v2-strict-fairness-fixtures');

function extractFunctionBody(source, pattern) {
  const match = pattern.exec(source);
  assert.ok(match, 'buildV2Input function should exist');
  const bodyStart = match.index + match[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    i++;
  }
  assert.strictEqual(depth, 0, 'buildV2Input body should parse with balanced braces');
  return source.slice(bodyStart, i - 1);
}

async function runExtractedBuildV2Input(fixture) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'exams-proctors.html'), 'utf8');
  const body = extractFunctionBody(html, /async\s+function\s+buildV2Input\s*\(\s*\)\s*\{/);
  const sandbox = {
    console: {
      warn: function () {},
      log: function () {},
      error: function () {}
    },
    Math: Math,
    Number: Number,
    Object: Object,
    year: '2026-2027',
    proctorsList: [],
    meAssignments: {},
    getAutoDistributionOptions: async function () {
      return {};
    },
    getDistributionRules: async function () {
      return fixture.examDistributionRules;
    },
    getScheduleEntries: async function () {
      return [];
    },
    getExamCenterLevelsForActiveYear: async function () {
      return {};
    },
    getEffectiveRoomRowsForLevel: async function () {
      return { rows: [], synthetic: 0, expected: 0, actual: 0 };
    },
    getWeightsPresetSelection: function () {
      return { weightsPreset: 'توازن', customWeights: null };
    },
    window: {
      api: {
        examConfig: {
          get: async function (_year, key) {
            if (key === 'examCenterConfig') return fixture.examCenterConfig;
            if (key === 'examExemptionsData') return {};
            if (key === 'examDutyTeachersData') return {};
            return null;
          }
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    'async function buildV2Input() {' + body + '}\nthis.__buildV2Input = buildV2Input;',
    sandbox
  );
  return sandbox.__buildV2Input();
}

(async function main() {
  const fixture = buildUiPlumbingStub();
  const input = await runExtractedBuildV2Input(fixture);

  assert.strictEqual(
    input.D_expected,
    fixture.expectedDExpected,
    'buildV2Input must pass examCenterConfig.expected_duty_tasks into input.D_expected'
  );
  assert.deepStrictEqual(input.examDistributionRules, fixture.examDistributionRules);
  assert.strictEqual(input.reservesConfig.mode, 'fixed');

  console.log('[pass] C1 UI plumbing guard: buildV2Input passes expected_duty_tasks as D_expected');
})().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
