'use strict';

/**
 * Stage-suite constitution test (isolation plan, Slice 7).
 *
 *   node tests/stage-isolation-constitution.test.js
 *
 * Proves the per-stage suites are independent:
 *   1. every tests/collegial/*.test.js and tests/qualifiant/*.test.js passes
 *      STANDALONE (exact commands printed below — each file runs in its own
 *      process with a fresh in-memory DB, no shared mutable state);
 *   2. no collegial suite file imports a qualifiant fixture and vice versa —
 *      both suites may import ONLY the shared builders module
 *      (tests/stage-isolation-builders.js) plus production code;
 *   3. the shared builders module holds no mutable DB state (factories only).
 *
 * Together (2)+(3) prove a policy/fixture change in one stage cannot fail the
 * other stage's suite. Standalone commands:
 *   node tests/collegial/resolver-golden.test.js
 *   node tests/collegial/missing-rule-fail-closed.test.js
 *   node tests/collegial/report-isolation.test.js
 *   node tests/collegial/permission-matrix.test.js
 *   node tests/collegial/config-resolution.test.js
 *   node tests/collegial/seed-invariant.test.js
 *   node tests/qualifiant/resolver-golden.test.js
 *   node tests/qualifiant/missing-rule-fail-closed.test.js
 *   node tests/qualifiant/report-isolation.test.js
 *   node tests/qualifiant/permission-matrix.test.js
 *   node tests/qualifiant/config-resolution.test.js
 *   node tests/qualifiant/seed-invariant.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TESTS_DIR = __dirname;
const STAGE_DIRS = ['collegial', 'qualifiant'];
const SHARED_BUILDERS = 'stage-isolation-builders';

console.log('[test] stage-suite constitution (slice 7)');

function listStageSuites() {
    const files = [];
    for (const stage of STAGE_DIRS) {
        const dir = path.join(TESTS_DIR, stage);
        assert.ok(fs.existsSync(dir), `stage suite dir missing: tests/${stage}/`);
        for (const entry of fs.readdirSync(dir).sort()) {
            if (entry.endsWith('.test.js')) files.push(path.join(dir, entry));
        }
    }
    return files;
}

function runStandalone(file) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const command = `node ${rel}`;
    const result = spawnSync(process.execPath, [file], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(
        result.status,
        0,
        `${command} must pass standalone\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`
    );
    console.log(`  [ok] standalone PASS: ${command}`);
}

// 1. Every stage suite passes standalone in its own process.
{
    const suites = listStageSuites();
    assert.strictEqual(suites.length, 12, 'expected 6 collegial + 6 qualifiant suites');
    for (const file of suites) runStandalone(file);
    console.log('  [ok] all 12 stage suites pass standalone');
}

// 2. Import-direction guard: a collegial suite file must never require a
//    qualifiant tests/ module and vice versa. Relative requires may only
//    target the shared builders module or production code (non-tests/ paths).
{
    const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const file of listStageSuites()) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        const stage = rel.includes('/collegial/') ? 'collegial' : 'qualifiant';
        const other = stage === 'collegial' ? 'qualifiant' : 'collegial';
        const source = fs.readFileSync(file, 'utf8');
        let match = null;
        while ((match = requirePattern.exec(source)) !== null) {
            const specifier = match[1];
            if (!specifier.startsWith('.')) continue; // node builtins / node_modules
            const resolved = path.normalize(path.join(path.dirname(file), specifier));
            const resolvedRel = path.relative(ROOT, resolved).split(path.sep).join('/');
            assert.ok(
                !resolvedRel.startsWith('tests/') ||
                    resolvedRel === `tests/${SHARED_BUILDERS}` ||
                    resolvedRel.startsWith(`tests/${SHARED_BUILDERS}.`) ||
                    resolvedRel.startsWith(`tests/${stage}/`),
                `${rel}: forbidden cross-stage import ${specifier} (resolves to ${resolvedRel})`
            );
            assert.ok(
                !resolvedRel.includes(`tests/${other}/`),
                `${rel}: must not import ${other} fixtures`
            );
        }
    }
    console.log('  [ok] no cross-stage fixture imports (shared builders only)');
}

// 3. The shared builders module carries no mutable DB state: factories only,
//    no process-global database handles, no out-of-function connections.
{
    const buildersPath = path.join(TESTS_DIR, `${SHARED_BUILDERS}.js`);
    assert.ok(fs.existsSync(buildersPath), 'shared builders module must exist');
    const source = fs.readFileSync(buildersPath, 'utf8');
    assert.ok(!source.includes('setDb('), 'builders must never call setDb (process-global state)');
    assert.ok(!source.includes('getDb('), 'builders must never call getDb (process-global state)');
    assert.ok(/module\.exports\s*=/.test(source), 'builders must export factories');
    for (const file of listStageSuites()) {
        const suiteSource = fs.readFileSync(file, 'utf8');
        assert.ok(
            suiteSource.includes('openDb()') || suiteSource.includes('loadCcRules('),
            `${path.relative(ROOT, file)}: suite must open its own DB/sandbox (no shared state)`
        );
    }
    console.log('  [ok] shared builders hold no mutable DB state; suites self-provision');
}

console.log('[pass] stage-suite constitution: 12/12 standalone, imports isolated');
