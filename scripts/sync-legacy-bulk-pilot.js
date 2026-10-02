'use strict';

/**
 * Sync bulk-capture pilot CLI (Milestone A rollout).
 *
 * DRY-RUN BY DEFAULT — never quarantines unless --apply-quarantine is set.
 *
 * Usage (prefer npm — uses Electron Node so better-sqlite3 ABI matches):
 *   npm run sync:pilot-report
 *   npm run sync:pilot-report -- --json
 *   npm run sync:pilot-report -- --apply-quarantine
 *   npm run sync:pilot-report -- --db="C:\Users\…\gestion-scolaire.db"
 *
 * Manual (Electron as Node):
 *   cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/sync-legacy-bulk-pilot.js
 *
 * Plain `node scripts/…` only works if better-sqlite3 was rebuilt for that Node.
 *
 * Default DB search order:
 *   1) --db=path
 *   2) GESTION_SCOLAIRE_DB env
 *   3) %APPDATA%/gestion-scolaire/gestion-scolaire.db  (Windows Electron userData)
 *   4) ~/.config/gestion-scolaire/gestion-scolaire.db  (Linux)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ARGS = process.argv.slice(2);
const OPT = Object.fromEntries(
    ARGS.filter((a) => a.startsWith('--')).map((a) => {
        const eq = a.indexOf('=');
        if (eq === -1) return [a.replace(/^--/, ''), true];
        return [a.slice(2, eq), a.slice(eq + 1)];
    })
);

const APPLY = OPT['apply-quarantine'] === true || OPT['apply-quarantine'] === 'true';
const AS_JSON = OPT.json === true || OPT.json === 'true';
const DETAIL_LIMIT = OPT['detail-limit'] != null ? Number(OPT['detail-limit']) : 200;

function candidateDbPaths() {
    const list = [];
    if (OPT.db) list.push(path.resolve(String(OPT.db)));
    if (process.env.GESTION_SCOLAIRE_DB) {
        list.push(path.resolve(String(process.env.GESTION_SCOLAIRE_DB).trim()));
    }
    // Electron default: app.getPath('userData') under package name
    if (process.env.APPDATA) {
        list.push(path.join(process.env.APPDATA, 'gestion-scolaire', 'gestion-scolaire.db'));
    }
    if (process.env.HOME || os.homedir()) {
        const home = process.env.HOME || os.homedir();
        list.push(path.join(home, '.config', 'gestion-scolaire', 'gestion-scolaire.db'));
        // macOS
        list.push(
            path.join(home, 'Library', 'Application Support', 'gestion-scolaire', 'gestion-scolaire.db')
        );
    }
    return list;
}

function resolveDbPath() {
    for (const p of candidateDbPaths()) {
        if (p && fs.existsSync(p)) return p;
    }
    return null;
}

function openDb(dbPath) {
    let Database;
    let db;
    try {
        Database = require('better-sqlite3');
        db = new Database(dbPath, { readonly: !APPLY, fileMustExist: true });
    } catch (err) {
        const isElectron = !!(process.versions && process.versions.electron);
        console.error('[!] better-sqlite3 failed under this runtime (or DB open failed).');
        console.error(`    Runtime: Node ${process.version} MODULE_VERSION=${process.versions.modules}` +
            (isElectron ? ` Electron ${process.versions.electron}` : ' (system Node — wrong ABI for this project)'));
        console.error('    Fix:');
        console.error('      npm run sync:pilot-report');
        console.error('    That runs via Electron (matches better-sqlite3 built for Electron 35).');
        console.error('    Or: cross-env ELECTRON_RUN_AS_NODE=1 npx electron scripts/sync-legacy-bulk-pilot.js');
        console.error('    Detail:', err.message.split('\n')[0]);
        process.exit(2);
    }
    if (!APPLY) {
        try {
            db.pragma('query_only = ON');
        } catch {
            /* older SQLite */
        }
    }
    return db;
}

function main() {
    const dbPath = resolveDbPath();
    if (!dbPath) {
        console.error('[!] Could not find gestion-scolaire.db');
        console.error('    Tried:');
        for (const p of candidateDbPaths()) console.error('     -', p);
        console.error('    Pass --db="C:\\\\path\\\\to\\\\gestion-scolaire.db"');
        process.exit(1);
    }

    if (APPLY) {
        console.warn('[!] APPLY MODE: quarantine rows will be marked status=failed');
        console.warn('    Re-run only after reviewing a report-only pass.');
    }

    console.log(`[i] Database: ${dbPath}`);
    console.log(`[i] Mode: ${APPLY ? 'apply-quarantine' : 'report-only (safe)'}`);

    const db = openDb(dbPath);
    try {
        // Ensure outbox exists
        const hasOutbox = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_outbox'")
            .get();
        if (!hasOutbox) {
            console.error('[!] sync_outbox table not found — is this a gestion-scolaire database?');
            process.exit(1);
        }

        const { runPilotReport } = require('../main/sync/legacy-bulk-repair');
        const report = runPilotReport(db, {
            applyQuarantine: APPLY,
            includeDetails: true,
            detailLimit: DETAIL_LIMIT
        });

        if (AS_JSON) {
            console.log(
                JSON.stringify(
                    {
                        dbPath,
                        mode: APPLY ? 'apply-quarantine' : 'report-only',
                        health: report.health,
                        classification: report.classification
                    },
                    null,
                    2
                )
            );
        } else {
            console.log('');
            console.log(report.text);
        }

        // Exit codes for automation / monitoring
        // 0 = clean or report-only success
        // 3 = pending legacy bulk still present after report
        // 4 = quarantine applied but some bulk still pending (exact/empty remain)
        if (report.health.bulkPendingCount > 0 && !APPLY) {
            process.exitCode = 3;
        } else if (APPLY && report.classification.quarantine > 0 && report.health.bulkPendingCount > 0) {
            process.exitCode = 4;
        }
    } finally {
        db.close();
    }
}

main();
