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
    return unique([...preloadSource.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]));
}

function collectHandleChannels(ipcSources) {
    // Match both direct ipcMain.handle('channel') and helper patterns:
    // handleRead(ipcMain, 'channel'), handleWrite(ipcMain, 'channel'),
    // handleWriteSoftAuth(ipcMain, 'channel'), handleAdminRead(ipcMain, 'channel'),
    // registerProtectedRead(ipcMain, 'channel')
    const directMatches = [...ipcSources.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]);
    const helperMatches = [
        ...ipcSources.matchAll(
            /(?:handleRead|handleWrite|handleWriteSoftAuth|handleAdminRead|registerProtectedRead)\(ipcMain,\s*'([^']+)'/g
        )
    ].map((m) => m[1]);
    return unique([...directMatches, ...helperMatches]);
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

function runSyncRegistryCompletenessSmoke() {
    const { CHANNEL_REGISTRY } = require(path.join(root, 'main', 'sync', 'capture'));
    const { writeChannels } = require(path.join(root, 'main', 'ipc', 'ipc-helpers'));
    const { registerAllIpcHandlers } = require(path.join(root, 'main', 'ipc', 'registerAll'));

    // The write channel set persists across requires, so clear it before using
    // a stub ipcMain to rebuild the registration-derived channel inventory.
    writeChannels.clear();

    const stubIpcMain = {
        handle() {}
    };

    registerAllIpcHandlers(stubIpcMain);

    const unmapped = [];
    for (const channel of writeChannels) {
        if (!CHANNEL_REGISTRY[channel]) {
            unmapped.push(channel);
        }
    }

    assert.strictEqual(unmapped.length, 0, `Sync registry missing mappings for write channels: ${unmapped.join(', ')}`);

    const registryChannels = Object.keys(CHANNEL_REGISTRY).filter((channel) => !CHANNEL_REGISTRY[channel].exclude);
    const orphaned = registryChannels.filter((channel) => !writeChannels.has(channel));

    assert.strictEqual(
        orphaned.length,
        0,
        `Sync registry has entries for non-existent write channels: ${orphaned.join(', ')}`
    );

    console.log(
        `  [smoke] Sync registry OK (${Object.keys(CHANNEL_REGISTRY).length} entries, ${writeChannels.size} write channels)`
    );
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
        { html: 'settings-imports.html', script: 'js/pages/settings-imports.js' },
        { html: 'students-status.html', script: 'js/pages/students-status.js' }
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
    // Backup/restore lives in system-backup.js (split from system.js).
    const source = read(path.join('main', 'ipc', 'system-backup.js'));

    const expectedSnippets = ['quick_check', '.validate.tmp', '.restore.bak', 'expectedByteLength'];
    expectedSnippets.forEach((snippet) => {
        assert.ok(source.includes(snippet), `Restore safety check missing: ${snippet}`);
    });

    console.log('[smoke] Restore safety checks OK');
}

function runNoCdnSmoke() {
    const cdnPattern = /https?:\/\/cdn\.(jsdelivr\.net|sheetjs\.com|cloudflare\.com|unpkg\.com|cdnjs\.cloudflare\.com)/;
    const skipDirs = new Set([
        'node_modules',
        'vendor',
        'testsprite_tests',
        'timetables',
        '.git',
        'dist',
        'build',
        '.tmp-analytics-check.js'
    ]);
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
    assert.strictEqual(
        hits.length,
        0,
        `CDN URLs found in source files (vendor locally instead):\n  ${hits.join('\n  ')}`
    );

    // Verify vendor files exist
    assert.ok(fs.existsSync(path.join(root, 'vendor', 'chart.min.js')), 'vendor/chart.min.js missing');
    assert.ok(fs.existsSync(path.join(root, 'vendor', 'xlsx.full.min.js')), 'vendor/xlsx.full.min.js missing');

    console.log('[smoke] No-CDN policy OK (vendor files present)');
}

function runTailwindOutputSmoke() {
    const tailwindOutput = path.join(root, 'css', 'tailwind-output.css');
    assert.ok(fs.existsSync(tailwindOutput), 'css/tailwind-output.css must exist (run npm run css:build)');
    const cssContent = fs.readFileSync(tailwindOutput, 'utf8');
    assert.ok(cssContent.length > 1000, 'css/tailwind-output.css is too small — build may have failed');
    assert.ok(
        cssContent.includes('--color-primary'),
        'css/tailwind-output.css should contain design token --color-primary'
    );
    console.log('[smoke] Tailwind CSS build output OK');
}

function runLegacyCssSmoke() {
    const legacyFiles = [
        'css/design-system.css',
        'styles.css',
        'ux-enhancements.css',
        'css/modern-imports.css',
        'css/teachers-performance.css'
    ];

    legacyFiles.forEach((file) => {
        assert.strictEqual(fs.existsSync(path.join(root, file)), false, `Legacy CSS file still exists: ${file}`);
    });

    const htmlFiles = fs.readdirSync(root).filter((file) => file.endsWith('.html'));
    const legacyRefs = [];
    const inlineStyleHits = [];

    htmlFiles.forEach((file) => {
        const content = fs.readFileSync(path.join(root, file), 'utf8');
        legacyFiles.forEach((cssFile) => {
            if (content.includes(`href="${cssFile}"`)) {
                legacyRefs.push(`${file} -> ${cssFile}`);
            }
        });

        const styleMatches = content.match(/<style[\s>]/g);
        if (styleMatches && styleMatches.length > 0) {
            inlineStyleHits.push(`${file} (${styleMatches.length} <style> block(s))`);
        }
    });

    assert.strictEqual(legacyRefs.length, 0, `HTML files still reference deleted CSS:\n  ${legacyRefs.join('\n  ')}`);
    assert.strictEqual(
        inlineStyleHits.length,
        0,
        `HTML files still have inline <style> blocks:\n  ${inlineStyleHits.join('\n  ')}`
    );

    console.log('[smoke] Legacy CSS cleanup complete (no legacy files, no stale refs, no inline styles)');
}

function runValidationTests() {
    const validation = require(path.join(root, 'main', 'ipc', 'validation.js'));
    const { requireFields, validateRange, validateDate, validateSchoolYear } = validation;

    // ── requireFields ──
    // Valid data — should not throw
    requireFields({ name: 'Ali', age: 20 }, ['name', 'age']);

    // Missing field
    try {
        requireFields({ name: 'Ali' }, ['name', 'email']);
        assert.fail('requireFields should throw on missing field');
    } catch (err) {
        assert.ok(err.message.includes('email'), 'Error should mention the missing field');
    }

    // Null data
    try {
        requireFields(null, ['name']);
        assert.fail('requireFields should throw on null data');
    } catch (err) {
        assert.ok(err.message.length > 0, 'Error message should be non-empty for null data');
    }

    // Non-object data (string)
    try {
        requireFields('not-an-object', ['name']);
        assert.fail('requireFields should throw on non-object data');
    } catch (err) {
        assert.ok(err.message.length > 0, 'Error message should be non-empty for non-object data');
    }

    // Empty string field treated as missing
    try {
        requireFields({ name: '   ' }, ['name']);
        assert.fail('requireFields should throw on empty/whitespace string field');
    } catch (err) {
        assert.ok(err.message.includes('name'), 'Error should mention the empty field');
    }

    // ── validateRange ──
    // Valid range
    const result = validateRange('score', 15, 0, 20);
    assert.strictEqual(result, 15, 'validateRange should return the numeric value');

    // Below min
    try {
        validateRange('score', -1, 0, 20);
        assert.fail('validateRange should throw when below min');
    } catch (err) {
        assert.ok(err.message.includes('score'), 'Error should mention the field name');
    }

    // Above max
    try {
        validateRange('score', 21, 0, 20);
        assert.fail('validateRange should throw when above max');
    } catch (err) {
        assert.ok(err.message.includes('score'), 'Error should mention the field name');
    }

    // NaN value
    try {
        validateRange('score', 'abc', 0, 20);
        assert.fail('validateRange should throw on NaN');
    } catch (err) {
        assert.ok(err.message.includes('score'), 'Error should mention the field name for NaN');
    }

    // Null value
    try {
        validateRange('score', null, 0, 20);
        assert.fail('validateRange should throw on null');
    } catch (err) {
        assert.ok(err.message.length > 0, 'Error message should be non-empty for null');
    }

    // ── validateDate ──
    // Valid date
    const dateResult = validateDate('birthday', '2024-09-15');
    assert.strictEqual(dateResult, '2024-09-15', 'validateDate should return the trimmed date string');

    // Invalid format (no separators)
    try {
        validateDate('birthday', '20240915');
        assert.fail('validateDate should throw on invalid format');
    } catch (err) {
        assert.ok(err.message.includes('birthday'), 'Error should mention the field name');
    }

    // Null value
    try {
        validateDate('birthday', null);
        assert.fail('validateDate should throw on null');
    } catch (err) {
        assert.ok(err.message.includes('birthday'), 'Error should mention the field name for null');
    }

    // Empty string
    try {
        validateDate('birthday', '');
        assert.fail('validateDate should throw on empty string');
    } catch (err) {
        assert.ok(err.message.includes('birthday'), 'Error should mention the field name for empty');
    }

    // ── validateSchoolYear ──
    // Valid school year
    const yearResult = validateSchoolYear('2024/2025');
    assert.strictEqual(yearResult, '2024/2025', 'validateSchoolYear should return the school year string');

    // Invalid format with dash
    try {
        validateSchoolYear('2024-2025');
        assert.fail('validateSchoolYear should throw on dash-separated year');
    } catch (err) {
        assert.ok(err.message.includes('YYYY/YYYY'), 'Error should mention the expected format');
    }

    // Wrong format (single year)
    try {
        validateSchoolYear('2024');
        assert.fail('validateSchoolYear should throw on single year');
    } catch (err) {
        assert.ok(err.message.length > 0, 'Error message should be non-empty for wrong format');
    }

    // Null value
    try {
        validateSchoolYear(null);
        assert.fail('validateSchoolYear should throw on null');
    } catch (err) {
        assert.ok(err.message.length > 0, 'Error message should be non-empty for null');
    }

    console.log('[smoke] Validation module behavioral tests OK');
}

function runAuthTests() {
    const { hashPassword, verifyPassword } = require(path.join(root, 'main', 'auth', 'password'));
    const { authErrorResponse } = require(path.join(root, 'main', 'ipc', 'ipc-helpers'));

    // ── hashPassword + verifyPassword ──
    // Correct password verifies
    const hash = hashPassword('MySecretPass123');
    assert.ok(hash.startsWith('scrypt$'), 'Hash should start with scrypt$ prefix');
    assert.strictEqual(verifyPassword('MySecretPass123', hash), true, 'Correct password should verify');

    // Wrong password fails
    assert.strictEqual(verifyPassword('WrongPassword', hash), false, 'Wrong password should not verify');

    // ── authErrorResponse ──
    // UNAUTHENTICATED error
    const unauthErr = new Error('Not logged in');
    unauthErr.code = 'UNAUTHENTICATED';
    const unauthResp = authErrorResponse(unauthErr);
    assert.strictEqual(unauthResp.success, false, 'authErrorResponse should set success=false');
    assert.strictEqual(unauthResp.code, 'UNAUTHENTICATED', 'Should preserve UNAUTHENTICATED code');
    assert.strictEqual(unauthResp.error, 'Not logged in', 'Should preserve error message');

    // FORBIDDEN error
    const forbiddenErr = new Error('No permission');
    forbiddenErr.code = 'FORBIDDEN';
    const forbiddenResp = authErrorResponse(forbiddenErr);
    assert.strictEqual(forbiddenResp.code, 'FORBIDDEN', 'Should preserve FORBIDDEN code');
    assert.strictEqual(forbiddenResp.error, 'No permission', 'Should preserve error message');

    // Unknown English error code is sanitized (no internal leakage)
    const genericErr = new Error('Something broke');
    genericErr.code = 'SOME_RANDOM_CODE';
    const genericResp = authErrorResponse(genericErr);
    assert.strictEqual(genericResp.code, 'INTERNAL_ERROR', 'Unknown code should default to INTERNAL_ERROR');
    assert.strictEqual(genericResp.error, 'حدث خطأ داخلي', 'English internal errors should be sanitized');

    const sqliteErr = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: grades.student_code');
    const sqliteResp = authErrorResponse(sqliteErr);
    assert.strictEqual(sqliteResp.error, 'حدث خطأ داخلي', 'SQLite errors should be sanitized');

    const validationErr = new Error('الحقول المطلوبة ناقصة: student_code');
    const validationResp = authErrorResponse(validationErr);
    assert.strictEqual(validationResp.error, validationErr.message, 'Arabic validation errors should pass through');

    console.log('[smoke] Auth module behavioral tests OK');
}

function runRoleHierarchySmoke() {
    const permissions = require(path.join(root, 'main', 'auth', 'permissions'));
    assert.strictEqual(
        permissions.canAccessPage('principal', 'settings-users'),
        true,
        'principal should be able to open settings-users'
    );
    assert.strictEqual(
        permissions.canAccessPage('supervisor', 'settings-users'),
        false,
        'supervisor should not be able to open settings-users'
    );
    assert.strictEqual(
        permissions.canAccessPage('admin', 'settings-users'),
        true,
        'admin should be able to open settings-users through bypass'
    );
    assert.ok(
        permissions.getAllowedPages('principal').includes('settings-users'),
        'settings-users should be in principal allowed pages'
    );

    const systemSource = read(path.join('main', 'ipc', 'system.js'));
    assert.ok(
        systemSource.includes("requireRole(event, ['admin', 'principal'])"),
        'users management IPC should allow principal'
    );
    assert.ok(
        systemSource.includes('FORBIDDEN_ROLE'),
        'principal should be blocked from assigning or modifying privileged roles'
    );

    const authSource = read(path.join('main', 'ipc', 'auth.js'));
    assert.ok(
        authSource.includes("requireRole(event, ['admin', 'principal'])"),
        'link request IPC should allow principal'
    );
    assert.ok(
        authSource.includes('FORBIDDEN_ROLE'),
        'principal should be blocked from approving link requests as admin'
    );

    const functionsSource = read(path.join('firebase', 'functions', 'index.js'));
    assert.ok(
        functionsSource.includes("const SCHOOL_ADMIN_ROLES = new Set(['principal'])"),
        'Firebase functions should treat only principal as a school admin'
    );
    assert.ok(
        functionsSource.includes('normalizeSchoolUserRole'),
        'Firebase functions should reject app-admin roles for school staff'
    );

    const settingsUsersSource = read(path.join('js', 'pages', 'settings-users.js'));
    assert.ok(
        settingsUsersSource.includes('getAssignableRoleOptions'),
        'settings-users UI should filter role options by current role'
    );

    const utilsSource = read(path.join('js', 'utils.js'));
    assert.ok(
        utilsSource.includes('loadAllowedPagesState'),
        'active page guard should load role-specific allowed pages'
    );
    assert.ok(
        utilsSource.includes('_allowedPagesState.includes'),
        'active page guard should enforce role-specific allowed pages'
    );
    assert.strictEqual(
        utilsSource.includes('Authenticated users (any role) can access non-admin pages'),
        false,
        'authenticated users should not have blanket access to non-admin pages'
    );

    console.log('[smoke] Role hierarchy principal user-management checks OK');
}

function runConsolidationSmoke() {
    // 1. No legacy channel aliases in preload.js
    const preloadSource = read('preload.js');
    const legacyPatterns = ['proctors:', 'rooms:', 'teacherAbsence:', 'absence:getByClass'];
    const legacyHits = legacyPatterns.filter((p) => preloadSource.includes(`'${p}`));
    assert.strictEqual(legacyHits.length, 0, `Legacy channels still in preload.js: ${legacyHits.join(', ')}`);

    // 2. No handleWriteNoAuth usage in IPC handler files
    const ipcDir = path.join(root, 'main', 'ipc');
    const ipcFiles = fs.readdirSync(ipcDir).filter((f) => f.endsWith('.js'));
    const noAuthHits = [];
    ipcFiles.forEach((file) => {
        const source = read(path.join('main', 'ipc', file));
        if (source.includes('handleWriteNoAuth')) {
            noAuthHits.push(file);
        }
    });
    assert.strictEqual(noAuthHits.length, 0, `handleWriteNoAuth still used in: ${noAuthHits.join(', ')}`);

    // 3. Validation module exists and exports expected functions
    const validationPath = path.join(root, 'main', 'ipc', 'validation.js');
    assert.ok(fs.existsSync(validationPath), 'validation.js module missing');
    const validation = require(validationPath);
    assert.strictEqual(typeof validation.requireFields, 'function', 'requireFields not exported');
    assert.strictEqual(typeof validation.validateRange, 'function', 'validateRange not exported');
    assert.strictEqual(typeof validation.validateDate, 'function', 'validateDate not exported');
    assert.strictEqual(typeof validation.validateSchoolYear, 'function', 'validateSchoolYear not exported');

    console.log('[smoke] Consolidation checks OK (no legacy channels, no handleWriteNoAuth, validation module)');
}

function runSyncDefaultsSmoke() {
    const { applySyncDefaults } = require(path.join(root, 'main', 'sync', 'defaults'));

    const firebaseFirst = applySyncDefaults(
        { firebase_functions_url: '', firebase_project_id: '' },
        {
            FIREBASE_FUNCTIONS_URL: 'https://firebase.example.com/',
            FIREBASE_PROJECT_ID: 'gestionscholaire-prod',
            AUTH_LAMBDA_URL: 'https://legacy.lambda-url.on.aws/',
            AWS_REGION: 'eu-west-3'
        }
    );

    assert.strictEqual(
        firebaseFirst.firebaseFunctionsUrl,
        'https://firebase.example.com',
        'Firebase sync defaults should prefer FIREBASE_FUNCTIONS_URL and trim trailing slashes'
    );
    assert.strictEqual(
        firebaseFirst.firebaseProjectId,
        'gestionscholaire-prod',
        'Firebase sync defaults should prefer FIREBASE_PROJECT_ID'
    );
    assert.strictEqual(
        firebaseFirst.authLambdaUrl,
        'https://firebase.example.com',
        'Backward-compatible authLambdaUrl alias should mirror the Firebase functions URL'
    );

    const derivedFirebaseUrl = applySyncDefaults(
        { firebase_functions_url: '', firebase_project_id: '' },
        { FIREBASE_PROJECT_ID: 'gestionscholaire-prod', FIREBASE_FUNCTIONS_REGION: 'europe-west1' }
    );

    assert.strictEqual(
        derivedFirebaseUrl.firebaseFunctionsUrl,
        'https://europe-west1-gestionscholaire-prod.cloudfunctions.net',
        'Firebase sync defaults should derive the standard functions URL from project id and region'
    );

    const legacyFallback = applySyncDefaults(
        { auth_lambda_url: '', aws_region: '' },
        { AUTH_LAMBDA_URL: 'https://example.lambda-url.on.aws/', AWS_REGION: 'eu-west-3' }
    );

    assert.strictEqual(
        legacyFallback.authLambdaUrl,
        'https://example.lambda-url.on.aws',
        'App sync defaults should still accept AUTH_LAMBDA_URL as a fallback input'
    );
    assert.strictEqual(
        legacyFallback.awsRegion,
        'eu-west-3',
        'App sync defaults should still fall back to environment region values for the legacy alias'
    );

    console.log('[smoke] Sync default resolution OK');
}

function runUpdaterErrorSmoke() {
    const { getUpdaterErrorMessage, isTransientUpdaterError } = require(path.join(root, 'main', 'updater-errors'));

    const gatewayTimeoutError = {
        message:
            '504 "method: GET url: https://github.com/CHEKAOUMII/project6.2/releases.atom Data: <html><body><h1>504 Gateway Time-out</h1></body></html>"'
    };
    assert.strictEqual(
        isTransientUpdaterError(gatewayTimeoutError),
        true,
        'GitHub 504 update feed failures should be classified as transient'
    );
    assert.strictEqual(
        getUpdaterErrorMessage(gatewayTimeoutError, { interactive: true }),
        'تعذر الوصول مؤقتًا إلى خادم التحديث. حاول مرة أخرى بعد قليل.',
        'Transient updater errors should map to a friendly user-facing message'
    );

    const accessError = {
        message: '404 method: GET url: https://github.com/CHEKAOUMII/project6.2/releases.atom',
        statusCode: 404
    };
    assert.strictEqual(
        getUpdaterErrorMessage(accessError, { interactive: true }),
        'تعذر الوصول إلى تحديثات GitHub. تحقق من إعدادات الوصول أو من GH_TOKEN.',
        'GitHub access failures should suggest checking updater credentials'
    );

    console.log('[smoke] Updater transient error handling OK');
}

function run() {
    runContractSmoke();
    runSyncRegistryCompletenessSmoke();
    runModuleExportsSmoke();
    runPageScriptExtractionSmoke();
    runMigrationSmoke();
    runLazyLoadSmoke();
    runRestoreSafetySmoke();
    runNoCdnSmoke();
    runTailwindOutputSmoke();
    runLegacyCssSmoke();
    runConsolidationSmoke();
    runSyncDefaultsSmoke();
    runUpdaterErrorSmoke();
    runValidationTests();
    runAuthTests();
    runRoleHierarchySmoke();
    console.log('[smoke] All smoke checks passed');
}

run();
