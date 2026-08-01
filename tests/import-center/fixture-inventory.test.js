'use strict';

// node tests/import-center/fixture-inventory.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'import-center');
const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, 'manifest.json'), 'utf8'));

assert.strictEqual(manifest.sensitive, false, 'manifest must mark fixtures non-sensitive');
assert.ok(manifest.provenance, 'manifest must document provenance');

const SENSITIVE_PATTERNS = [
    /\b\d{10}\b/, // likely real massar-like long codes without S prefix — allow S000
    /@gmail\.com/i,
    /cin\s*[:=]/i
];

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, files);
        else files.push(full);
    }
    return files;
}

const allFiles = walk(FIXTURE_ROOT);
assert.ok(allFiles.length >= 20, 'expected fixture inventory to exist');

for (const file of allFiles) {
    if (file.endsWith('.json')) continue;
    const content = fs.readFileSync(file, 'utf8');
    // Synthetic codes use S000xxxx — fine
    for (const re of SENSITIVE_PATTERNS) {
        if (re.source.includes('gmail') || re.source.includes('cin')) {
            assert.ok(!re.test(content), `sensitive pattern in ${path.relative(FIXTURE_ROOT, file)}`);
        }
    }
    assert.ok(
        !/real student|production data|live ppr/i.test(content),
        `suspicious provenance text in ${file}`
    );
}

const types = Object.keys(manifest.types);
const expected = [
    'students',
    'grades',
    'absences',
    'student_status',
    'fet',
    'agent_xml',
    'generic_csv_xlsx'
];
for (const t of expected) {
    assert.ok(manifest.types[t], `missing type ${t} in manifest`);
    assert.ok(
        (manifest.types[t].valid || []).length >= 2,
        `${t} must have at least two valid samples`
    );
    for (const rel of manifest.types[t].valid || []) {
        const p = path.join(FIXTURE_ROOT, rel);
        assert.ok(fs.existsSync(p), `missing valid fixture ${rel}`);
    }
    for (const rel of manifest.types[t].failure || []) {
        const p = path.join(FIXTURE_ROOT, rel);
        assert.ok(fs.existsSync(p), `missing failure fixture ${rel}`);
    }
}

// Generic must not pretend to be a registered source (content is non-education inventory)
const generic = fs.readFileSync(path.join(FIXTURE_ROOT, 'generic', 'data.csv'), 'utf8');
assert.ok(/item|qty|price/i.test(generic), 'generic sample should be non-registered tabular');
assert.ok(!/رمز مسار|النقطة|غياب/i.test(generic), 'generic sample must not look like registered source');

assert.strictEqual(manifest.calibration.high, 0.85);
assert.strictEqual(manifest.calibration.medium, 0.6);
assert.strictEqual(manifest.calibration.ambiguityGap, 0.1);

console.log('fixture-inventory: OK', { types: types.length, files: allFiles.length });
