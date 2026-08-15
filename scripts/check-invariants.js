'use strict';

/**
 * check-invariants.js
 *
 * Cheap, deterministic, source-level repository invariant checks wired into
 * `npm test` (tests/run-all.js). No database access, no application requires.
 *
 *   - Check A — main/ literal prohibition: no raw `secondary_qualifiant`
 *     occurrence under main/, including comments (AGENTS.md S1 rule; use the
 *     shared SSOT constants from js/shared/education/cycles.js).
 *   - Check B — appDefaults:listLevels compatibility '*' adapter
 *     (main/ipc/appDefaults.js LEGACY_ALL_LEVELS_ROW): verified present (INFO),
 *     its removal trigger (verdict §5B-5) documented under docs/reviews/ (FAIL
 *     when missing), and tests pinning that adapter reported (INFO). This does
 *     not inspect persisted rule wildcards.
 *   - Check C — core invariant artifacts (verdict §5B-2): the
 *     cycle_profile_assignments FK migration, ensureCycleProfilesSchema,
 *     assertKeepsLastUsableCycle, and the catalog capability vocabulary must
 *     all exist (FAIL when missing).
 *
 * Artifact-presence checks mask same-line comments to avoid accepting a name
 * that exists only in explanatory text. Check A intentionally does not use
 * that masking: its prohibition is literal and grep-equivalent.
 *
 * Usage:
 *   node scripts/check-invariants.js
 *
 * Exit: 0 when no violations; 1 otherwise (process.exitCode).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const QUALIFIANT_LITERAL = 'secondary_qualifiant';
const LEGACY_ROW_IDENTIFIER = 'LEGACY_ALL_LEVELS_ROW';
const LIST_LEVELS_CHANNEL = 'appDefaults:listLevels';

const violations = [];
const infos = [];

function rel(file) {
    return path.relative(ROOT, file).split(path.sep).join('/');
}

function walkJsFiles(dir, out) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') continue;
            walkJsFiles(full, out);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

function commentMaskedRegions(line) {
    const regions = [];
    const n = line.length;
    let i = 0;
    while (i < n) {
        if (line[i] === '/' && line[i + 1] === '/') {
            regions.push([i, n]);
            break;
        }
        if (line[i] === '/' && line[i + 1] === '*') {
            const close = line.indexOf('*/', i + 2);
            if (close === -1) {
                regions.push([i, n]);
                break;
            }
            regions.push([i, close + 2]);
            i = close + 2;
            continue;
        }
        i += 1;
    }
    return regions;
}

function isLiteralInCodeLine(line, needle) {
    const regions = commentMaskedRegions(line);
    let from = 0;
    for (const [start, end] of regions) {
        if (line.slice(from, start).includes(needle)) return true;
        from = end;
    }
    return line.slice(from).includes(needle);
}

function lineOfFirstOccurrence(source, needle) {
    const idx = source.indexOf(needle);
    if (idx === -1) return null;
    return source.slice(0, idx).split('\n').length;
}

function addViolation(file, line, text) {
    violations.push({ rel: rel(file), line, text });
}

function addInfo(file, line, text) {
    infos.push({ rel: rel(file), line, text });
}

function assertFileContains(file, needle, purpose) {
    let source;
    try {
        source = fs.readFileSync(file, 'utf8');
    } catch (err) {
        addViolation(file, 1, `file required for ${purpose} could not be read: ${err.message}`);
        return;
    }
    const lines = source.split('\n');
    for (let idx = 0; idx < lines.length; idx += 1) {
        if (isLiteralInCodeLine(lines[idx], needle)) return;
    }
    addViolation(file, 1, `required artifact '${needle}' not found — needed for ${purpose}`);
}

// ---------------------------------------------------------------------------
// Check A — main/ literal prohibition
// ---------------------------------------------------------------------------

function checkMainLiteral() {
    const mainDir = path.join(ROOT, 'main');
    if (!fs.existsSync(mainDir)) {
        addViolation(mainDir, 1, 'main/ directory is missing');
        return;
    }
    const files = walkJsFiles(mainDir, []);
    for (const file of files) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        for (let idx = 0; idx < lines.length; idx += 1) {
            if (lines[idx].includes(QUALIFIANT_LITERAL)) {
                addViolation(
                    file,
                    idx + 1,
                    `'${QUALIFIANT_LITERAL}' raw occurrence is prohibited in main/, including comments (AGENTS.md S1 rule) — use the shared SSOT constants exported by js/shared/education/cycles.js`
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Check B — appDefaults:listLevels compatibility '*' adapter and its removal trigger
// ---------------------------------------------------------------------------

function checkLegacyAllLevelsRow() {
    const appDefaultsFile = path.join(ROOT, 'main', 'ipc', 'appDefaults.js');
    let source;
    try {
        source = fs.readFileSync(appDefaultsFile, 'utf8');
    } catch (err) {
        addViolation(appDefaultsFile, 1, `file could not be read: ${err.message}`);
        return;
    }

    if (!source.includes(LIST_LEVELS_CHANNEL)) {
        addViolation(
            appDefaultsFile,
            1,
            `legacy '*' adapter check is scoped to ${LIST_LEVELS_CHANNEL}, but that channel is missing`
        );
    }

    const rowLine = lineOfFirstOccurrence(source, LEGACY_ROW_IDENTIFIER);
    if (rowLine === null) {
        addInfo(
            appDefaultsFile,
            1,
            'LEGACY_ALL_LEVELS_ROW is gone — expected only after the removal trigger (below) is met and evidence recorded'
        );
    } else {
        addInfo(
            appDefaultsFile,
            rowLine,
            "LEGACY_ALL_LEVELS_ROW present — legacy '*' adapter is intentionally kept today (compat for appDefaults:listLevels)"
        );
    }

    const adapterLine = lineOfFirstOccurrence(source, 'withLegacyAllRow');
    if (adapterLine === null) {
        addInfo(appDefaultsFile, 1, "withLegacyAllRow is missing — no legacy '*' row is prepended by appDefaults:listLevels");
    } else {
        addInfo(
            appDefaultsFile,
            adapterLine,
            "withLegacyAllRow present — appDefaults:listLevels prepends LEGACY_ALL_LEVELS_ROW for the no-cycle/qualifiant shapes"
        );
    }

    // Removal trigger documentation (verdict §5B-5): remove the adapter only
    // after one full release cycle with no appDefaults:listLevels legacy
    // caller/payload, backed by telemetry or equivalent test evidence. The
    // trigger itself must be documented under docs/reviews/ and scoped to this
    // compatibility API, not to persisted rule wildcard rows.
    const reviewsDir = path.join(ROOT, 'docs', 'reviews');
    const triggerDocs = [];
    if (fs.existsSync(reviewsDir)) {
        for (const entry of fs.readdirSync(reviewsDir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
            const file = path.join(reviewsDir, entry.name);
            const docSource = fs.readFileSync(file, 'utf8');
            if (
                docSource.includes(LEGACY_ROW_IDENTIFIER) &&
                docSource.includes(LIST_LEVELS_CHANNEL)
            ) {
                triggerDocs.push({ file, line: lineOfFirstOccurrence(docSource, LEGACY_ROW_IDENTIFIER) });
            }
        }
    }
    if (triggerDocs.length === 0) {
        addViolation(
            reviewsDir,
            1,
            `removal trigger for ${LEGACY_ROW_IDENTIFIER} is not documented for ${LIST_LEVELS_CHANNEL} under docs/reviews/ — document the §5B-5 trigger ('remove only after one full release cycle with no legacy caller/payload, supported by telemetry or equivalent test evidence')`
        );
        return;
    }
    for (const doc of triggerDocs) {
        addInfo(
            doc.file,
            doc.line,
            `removal trigger for ${LEGACY_ROW_IDENTIFIER} documented here for ${LIST_LEVELS_CHANNEL} (§5B-5: one full release cycle with no legacy caller/payload, telemetry or test evidence)`
        );
    }

    // Tests that still exercise/pin the '*' adapter via appDefaults:listLevels.
    const testsDir = path.join(ROOT, 'tests');
    if (!fs.existsSync(testsDir)) return;
    const testFiles = walkJsFiles(testsDir, []).filter((file) => file.endsWith('.test.js'));
    for (const file of testFiles) {
        const testSource = fs.readFileSync(file, 'utf8');
        const lines = testSource.split('\n');
        const listLevelsMarkers = lines
            .map((line, idx) => (isLiteralInCodeLine(line, LIST_LEVELS_CHANNEL) ? idx : -1))
            .filter((idx) => idx !== -1);
        if (listLevelsMarkers.length === 0) continue;

        for (let idx = 0; idx < lines.length; idx += 1) {
            const line = lines[idx];
            if (!/(['"])\*\1/.test(line)) continue;
            if (!isLiteralInCodeLine(line, '*')) continue;
            if (!/\blegacy\b|\blevels\b/i.test(line)) continue;
            if (!/\bassert(?:\.|\s*\()|\.levels\b|\.some\s*\(|console\.log/.test(line)) continue;
            if (!listLevelsMarkers.some((marker) => Math.abs(marker - idx) <= 20)) continue;
            addInfo(
                file,
                idx + 1,
                `test references/pins the legacy '*' adapter returned by ${LIST_LEVELS_CHANNEL} — keep until the §5B-5 removal trigger is met`
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Check C — core invariant artifacts (verdict §5B-2)
// ---------------------------------------------------------------------------

function checkCoreArtifacts() {
    assertFileContains(
        path.join(ROOT, 'main', 'db', 'migrations.js'),
        '2026-08-083-cycle-profile-assignments-fk',
        'the cycle_profile_assignments FK migration (source artifact only; does not prove assignment uniqueness)'
    );
    assertFileContains(
        path.join(ROOT, 'main', 'db', 'schema.js'),
        'function ensureCycleProfilesSchema',
        'the canonical cycle_profiles/assignments DDL helper (source artifact only; does not prove database semantics)'
    );
    assertFileContains(
        path.join(ROOT, 'main', 'auth', 'cycle-access.js'),
        'assertKeepsLastUsableCycle',
        'the user grant-retention guard (source artifact only; does not prove revocation behavior)'
    );
    assertFileContains(
        path.join(ROOT, 'js', 'shared', 'education', 'cycles.js'),
        'supported',
        'the catalog capability vocabulary (source artifact only; does not prove every write path is gated)'
    );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

checkMainLiteral();
checkLegacyAllLevelsRow();
checkCoreArtifacts();

for (const info of infos) {
    console.log(`  [info] ${info.rel}:${info.line} — ${info.text}`);
}
for (const violation of violations) {
    console.error(`  [violation] ${violation.rel}:${violation.line} — ${violation.text}`);
}

if (violations.length === 0) {
    console.log(`check-invariants: OK (${infos.length} info line${infos.length === 1 ? '' : 's'})`);
} else {
    console.error(
        `check-invariants: FAILED (${violations.length} violation${violations.length === 1 ? '' : 's'})`
    );
    process.exitCode = 1;
}
