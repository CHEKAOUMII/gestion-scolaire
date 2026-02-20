const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function unique(values) {
    return [...new Set(values)].sort();
}

function collectInvokeChannels(preloadSource) {
    return unique([...preloadSource.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]));
}

function collectHandleChannels(ipcSources) {
    return unique([...ipcSources.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]));
}

function runContractSmoke() {
    const preloadSource = read('preload.js');
    const preloadChannels = collectInvokeChannels(preloadSource);

    const ipcDir = path.join(root, 'main', 'ipc');
    const ipcFiles = fs
        .readdirSync(ipcDir)
        .filter((file) => file.endsWith('.js') && file !== 'registerAll.js')
        .sort();

    const ipcSource = ipcFiles.map((file) => read(path.join('main', 'ipc', file))).join('\n');
    const mainChannels = collectHandleChannels(ipcSource);

    const missingInMain = preloadChannels.filter((channel) => !mainChannels.includes(channel));
    const extraInMain = mainChannels.filter((channel) => !preloadChannels.includes(channel));

    assert.strictEqual(missingInMain.length, 0, `Missing handlers: ${missingInMain.join(', ')}`);
    assert.strictEqual(extraInMain.length, 0, `Unexposed handlers: ${extraInMain.join(', ')}`);
    console.log(`[smoke] IPC channels parity OK (${preloadChannels.length} channels)`);
}

function runModuleExportsSmoke() {
    const { initDatabase } = require(path.join(root, 'main', 'db', 'init'));
    const { registerAllIpcHandlers } = require(path.join(root, 'main', 'ipc', 'registerAll'));

    assert.strictEqual(typeof initDatabase, 'function', 'initDatabase export missing');
    assert.strictEqual(typeof registerAllIpcHandlers, 'function', 'registerAllIpcHandlers export missing');
    console.log('[smoke] Module exports OK');
}

function runPageScriptExtractionSmoke() {
    const checks = [
        { html: 'index.html', script: 'js/pages/dashboard-init.js' },
        { html: 'students-list.html', script: 'js/pages/students-list.js' },
        { html: 'settings-imports.html', script: 'js/pages/settings-imports.js' }
    ];

    checks.forEach(({ html, script }) => {
        const source = read(html);
        assert.ok(source.includes(`<script src="${script}" defer></script>`), `${html} missing extracted script tag`);

        const trailingInline = /<script>\s*[\s\S]*\s*<\/script>\s*<\/body>/.test(source);
        assert.strictEqual(trailingInline, false, `${html} still has trailing inline script`);
    });

    console.log('[smoke] Page script extraction OK');
}

function runMigrationSmoke() {
    const source = read(path.join('main', 'db', 'migrations.js'));
    assert.ok(source.includes('const MIGRATIONS = ['), 'MIGRATIONS list is missing');

    const versions = [...source.matchAll(/version:\s*'([^']+)'/g)].map((m) => m[1]);
    assert.ok(versions.length >= 3, 'Expected multiple versioned migrations');
    assert.strictEqual(new Set(versions).size, versions.length, 'Migration versions must be unique');

    console.log(`[smoke] Migrations versioned OK (${versions.length} steps)`);
}

function runLazyLoadSmoke() {
    const dashboardHtml = read('index.html');
    const importsHtml = read('settings-imports.html');
    const analyticsHtml = read('analytics.html');
    const absenceAnalyticsHtml = read('absence-analytics.html');

    assert.strictEqual(
        /<script[^>]+src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js/.test(dashboardHtml),
        false,
        'index.html should not hard-load Chart.js in head'
    );
    assert.strictEqual(
        /<script[^>]+src="https:\/\/cdn\.sheetjs\.com/.test(dashboardHtml),
        false,
        'index.html should not hard-load XLSX in head'
    );
    assert.strictEqual(
        /<script[^>]+src="https:\/\/cdn\.sheetjs\.com/.test(importsHtml),
        false,
        'settings-imports.html should not hard-load XLSX in head'
    );
    assert.strictEqual(
        /<script[^>]+src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js/.test(analyticsHtml),
        false,
        'analytics.html should not hard-load Chart.js in head'
    );
    assert.strictEqual(
        /<script[^>]+src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js/.test(absenceAnalyticsHtml),
        false,
        'absence-analytics.html should not hard-load Chart.js in head'
    );

    console.log('[smoke] Lazy-load script policy OK');
}

function runRestoreSafetySmoke() {
    const source = read(path.join('main', 'ipc', 'system.js'));

    const expectedSnippets = ['quick_check', '.validate.tmp', '.restore.bak', 'expectedByteLength'];
    expectedSnippets.forEach((snippet) => {
        assert.ok(source.includes(snippet), `Restore safety check missing: ${snippet}`);
    });

    console.log('[smoke] Restore safety checks OK');
}

function runNoCdnSmoke() {
    const cdnPattern = /https?:\/\/cdn\.(jsdelivr\.net|sheetjs\.com|cloudflare\.com|unpkg\.com|cdnjs\.cloudflare\.com)/;
    const skipDirs = new Set(['node_modules', 'vendor', 'timetables', '.git', 'dist', 'build', '.tmp-analytics-check.js']);
    const extensions = new Set(['.js', '.html']);

    function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const hits = [];
        for (const entry of entries) {
            if (skipDirs.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                hits.push(...walk(full));
            } else if (extensions.has(path.extname(entry.name))) {
                const content = fs.readFileSync(full, 'utf8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (cdnPattern.test(lines[i])) {
                        hits.push(`${path.relative(root, full)}:${i + 1}`);
                    }
                }
            }
        }
        return hits;
    }

    const hits = walk(root);
    assert.strictEqual(hits.length, 0, `CDN URLs found in source files (vendor locally instead):\n  ${hits.join('\n  ')}`);

    // Verify vendor files exist
    assert.ok(fs.existsSync(path.join(root, 'vendor', 'chart.min.js')), 'vendor/chart.min.js missing');
    assert.ok(fs.existsSync(path.join(root, 'vendor', 'xlsx.full.min.js')), 'vendor/xlsx.full.min.js missing');

    console.log('[smoke] No-CDN policy OK (vendor files present)');
}

function run() {
    runContractSmoke();
    runModuleExportsSmoke();
    runPageScriptExtractionSmoke();
    runMigrationSmoke();
    runLazyLoadSmoke();
    runRestoreSafetySmoke();
    runNoCdnSmoke();
    console.log('[smoke] All smoke checks passed');
}

run();
