'use strict';

/**
 * Canonical ABI-tolerant in-memory DB fixture for tests.
 *
 * better-sqlite3 in this checkout is typically compiled against Electron's
 * Node ABI, so a plain `require('better-sqlite3')` fails under the system Node
 * that runs tests/run-all.js. This helper probes the native module first and
 * falls back to node:sqlite with the better-sqlite3 API surface repos rely on
 * (pragma + REAL transactional db.transaction).
 *
 * NOTE: several older tests carry their own (looser) variants of this shim —
 * e.g. a no-op `db.transaction = (fn) => fn` in appdefaults-exam-counts-cycle.
 * Do not mass-migrate them blindly: switch a test to this fixture only when
 * its variant is verified equivalent (transactional behavior included).
 */

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        // Native ABI mismatch (module built for Electron) — fall back to node:sqlite.
    }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
    db.transaction = (fn) => (...args) => {
        db.exec('BEGIN');
        try {
            const result = fn(...args);
            db.exec('COMMIT');
            return result;
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    };
    return db;
}

module.exports = { openDb };
