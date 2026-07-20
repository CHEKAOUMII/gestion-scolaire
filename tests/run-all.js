#!/usr/bin/env node
/**
 * Aggregated test runner for Pencil2.
 *
 * Discovers and runs:
 *   1. tests/smoke.js                          (existing IPC/contract smoke checks)
 *   2. tests/proctor-v3/*.test.js              (V3 algorithm tests — Section 3+)
 *   3. tests/proctor-distribution-v2-*.test.js (existing V2 algorithm tests)
 *   4. tests/proctor-v2-*.test.js              (V2 regression / PBT tests)
 *   5. Hand-picked V2 / display tests at the repo root of tests/
 *
 * Each test file is spawned as an independent `node` subprocess so that
 * isolated state (require cache, module-level mutables, process.exit calls)
 * does not leak between files.
 *
 * Exit code: 0 if all files exit 0; non-zero otherwise.
 *
 * Pure Node (no Electron, no extra deps). Satisfies Requirement 14.9 of the
 * proctor-distribution-v3 spec: every tests/proctor-v3/*.test.js is picked up
 * automatically — no risk of forgetting to register a test.
 *
 * Usage:
 *   npm test
 *   node tests/run-all.js
 *   node tests/run-all.js --filter proctor-v3
 *   node tests/run-all.js --only tests/proctor-v3/prng.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS_DIR = __dirname;
const ROOT = path.resolve(TESTS_DIR, '..');

// ---------------------------------------------------------------------------
// Argv parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { filter: null, only: null, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--filter' && i + 1 < argv.length) {
      args.filter = argv[i + 1];
      i += 1;
    } else if (a === '--only' && i + 1 < argv.length) {
      args.only = argv[i + 1];
      i += 1;
    } else if (a === '-v' || a === '--verbose') {
      args.verbose = true;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Recursively list *.test.js files under `dir`, sorted for deterministic order.
 */
function listTestFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip known non-test subdirs.
      // e2e needs Playwright + a real Electron window; run via `npm run test:e2e`.
      if (['fixtures', '__snapshots__', 'integration', 'e2e'].includes(entry.name)) continue;
      out.push(...listTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  out.sort();
  return out;
}

/**
 * Build the ordered list of test groups.
 *
 * The smoke suite runs first because it validates structural invariants
 * (IPC contract, migrations, vendor presence) that, if broken, will cause
 * misleading failures in the algorithm tests.
 */
function buildPlan() {
  const plan = [];

  // 1. Smoke checks (single self-contained script).
  const smoke = path.join(TESTS_DIR, 'smoke.js');
  if (fs.existsSync(smoke)) {
    plan.push({ group: 'smoke', file: smoke });
  }

  // 2. V3 tests (auto-discovered — Requirement 14.9).
  const v3Dir = path.join(TESTS_DIR, 'proctor-v3');
  for (const f of listTestFiles(v3Dir)) {
    plan.push({ group: 'proctor-v3', file: f });
  }

  // 3. Top-level *.test.js (V2 + display + PBT regressions).
  const topLevel = fs
    .readdirSync(TESTS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.test.js'))
    .map((e) => path.join(TESTS_DIR, e.name))
    .sort();
  for (const f of topLevel) {
    plan.push({ group: 'top-level', file: f });
  }

  // 4. Import center phase-one suite (smart-central-import-center).
  const importCenterDir = path.join(TESTS_DIR, 'import-center');
  for (const f of listTestFiles(importCenterDir)) {
    plan.push({ group: 'import-center', file: f });
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function relFromRoot(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function runOne(file, verbose) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    stdio: verbose ? 'inherit' : 'pipe',
    env: process.env
  });
  const ms = Date.now() - started;
  const ok = result.status === 0 && !result.error;
  return {
    file,
    ok,
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout ? result.stdout.toString() : '',
    stderr: result.stderr ? result.stderr.toString() : '',
    ms
  };
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let plan = buildPlan();

  if (args.only) {
    const target = path.resolve(ROOT, args.only);
    plan = plan.filter((p) => p.file === target);
    if (plan.length === 0) {
      console.error(`[run-all] --only target not found: ${args.only}`);
      process.exit(2);
    }
  } else if (args.filter) {
    const needle = args.filter.toLowerCase();
    plan = plan.filter((p) => p.file.toLowerCase().includes(needle));
    if (plan.length === 0) {
      console.error(`[run-all] --filter "${args.filter}" matched no test files`);
      process.exit(2);
    }
  }

  if (plan.length === 0) {
    console.error('[run-all] No test files discovered');
    process.exit(2);
  }

  console.log(`[run-all] Running ${plan.length} test file(s)\n`);

  const failures = [];
  const startedAll = Date.now();

  for (const item of plan) {
    const rel = relFromRoot(item.file);
    process.stdout.write(`▶ ${rel} ... `);
    const res = runOne(item.file, args.verbose);
    if (res.ok) {
      console.log(`ok (${formatDuration(res.ms)})`);
    } else {
      console.log(`FAIL (${formatDuration(res.ms)}, exit=${res.status}${res.signal ? `, signal=${res.signal}` : ''})`);
      failures.push({ rel, res });
    }
  }

  const totalMs = Date.now() - startedAll;
  console.log(`\n[run-all] ${plan.length - failures.length}/${plan.length} passed in ${formatDuration(totalMs)}`);

  if (failures.length > 0) {
    console.log('\n[run-all] Failures:\n');
    for (const f of failures) {
      console.log(`── ${f.rel} ──`);
      if (f.res.error) {
        console.log(`spawn error: ${f.res.error.message}`);
      }
      if (f.res.stdout && f.res.stdout.trim()) {
        console.log('--- stdout ---');
        console.log(f.res.stdout.trimEnd());
      }
      if (f.res.stderr && f.res.stderr.trim()) {
        console.log('--- stderr ---');
        console.log(f.res.stderr.trimEnd());
      }
      console.log('');
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
