'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ── IPC Layering Guard Test ──
// Standing architectural rule (AGENTS.md, 027-layering-remediation):
// 1. All domain SQL must live in main/repos/* — not in main/ipc/*.
// 2. IPC handlers only: role/session auth, field validation, call repo, map response.
// 3. Documented infrastructure exemptions are explicitly whitelisted below.

const EXEMPT_IPC_FILES = new Set([
    'system-backup.js', // sqlite_master introspection, PRAGMAs, dynamic table cloning
    'sync.js',          // sync engine tables (sync_outbox, sync_conflicts, sync_id_map, sync_config)
    'settings-ipc.js',   // generic settings key-value store
    'ipc-helpers.js',   // generic audit/logging plumbing
    'import-audit.js',  // import audit log inserts
    'app-admin.js'      // sync_config administrative identity change approvals
]);

function runIpcLayeringGuard() {
    const ipcDir = path.join(__dirname, '..', 'main', 'ipc');
    const files = fs.readdirSync(ipcDir).filter((f) => f.endsWith('.js') && f !== 'registerAll.js');

    const violations = [];

    for (const file of files) {
        if (EXEMPT_IPC_FILES.has(file)) continue;

        const content = fs.readFileSync(path.join(ipcDir, file), 'utf8');
        const lines = content.split('\n');

        lines.forEach((line, idx) => {
            const trimmed = line.trim();
            // Skip comments
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

            if (
                /\.prepare\(/.test(line) ||
                /db\.exec\(/.test(line) ||
                /db\.transaction\(/.test(line)
            ) {
                violations.push({
                    file,
                    line: idx + 1,
                    code: trimmed
                });
            }
        });
    }

    if (violations.length > 0) {
        const details = violations.map((v) => `  ${v.file}:${v.line} -> ${v.code}`).join('\n');
        assert.fail(`Found inline SQL / database queries in non-exempt IPC handlers:\n${details}\n\nMove these queries to main/repos/ per the 027 layering rule.`);
    }

    console.log(`[ipc-layering-guard] OK: ${files.length - EXEMPT_IPC_FILES.size} non-exempt IPC files are completely free of inline SQL.`);
}

runIpcLayeringGuard();
