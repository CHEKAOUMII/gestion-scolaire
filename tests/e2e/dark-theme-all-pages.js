/**
 * Playwright + Electron: dark theme across every application page.
 *
 * Verifies on each page:
 *   - html[data-theme="dark"]
 *   - localStorage app-theme = dark
 *   - dark CSS token overrides (--color-surface, --color-secondary, --color-text-main)
 *   - meta theme-color when present
 *
 * Usage:
 *   npm run test:e2e:dark-theme
 *   node tests/e2e/dark-theme-all-pages.js
 */
'use strict';

const {
    E2E_SEED,
    launchApp,
    seedLocalProfile,
    assertMatch,
    enableDarkTheme,
    readDarkThemeState,
    assertDarkThemeState,
    waitPageReady,
    gotoAppPage,
    waitForDarkThemeApplied,
    loginSeededAdmin
} = require('./helpers');
const { getAllAppPages } = require('./page-catalog');

const SEED_RELEASE_MS = 800;

async function seedAndRelaunch(ctx, overrides = {}) {
    await ctx.app.close().catch(() => {});
    await new Promise((r) => setTimeout(r, SEED_RELEASE_MS));
    await seedLocalProfile(ctx.userDataDir, overrides);
    await ctx.relaunch();
    await waitPageReady(ctx.window);
}

async function assertPageUrl(window, pageFile) {
    const escaped = pageFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assertMatch(window.url(), new RegExp(escaped, 'i'), `Expected URL to include ${pageFile}, got: ${window.url()}`);
}

async function scenarioSetupDarkTheme() {
    const ctx = await launchApp();
    try {
        await waitPageReady(ctx.window);
        assertMatch(ctx.window.url(), /setup\.html/i, `Fresh profile should open setup.html, got: ${ctx.window.url()}`);

        await enableDarkTheme(ctx.window);
        const state = await readDarkThemeState(ctx.window);
        assertDarkThemeState(state, 'setup.html');
        console.log('[e2e:dark] setup.html ok');
    } finally {
        await ctx.close();
        await new Promise((r) => setTimeout(r, SEED_RELEASE_MS));
    }
}

async function scenarioAuthenticatedDarkThemeFlow() {
    const managedPages = getAllAppPages().filter((page) => page !== 'setup.html' && page !== 'login.html');
    const ctx = await launchApp();
    const failures = [];
    let passed = 0;

    try {
        await seedAndRelaunch(ctx, { role: 'developer', name: 'E2E Developer' });
        assertMatch(
            ctx.window.url(),
            /login\.html/i,
            `Seeded profile should open login.html, got: ${ctx.window.url()}`
        );

        await enableDarkTheme(ctx.window);
        let state = await readDarkThemeState(ctx.window);
        assertDarkThemeState(state, 'login.html');
        console.log('[e2e:dark] login.html ok');

        await loginSeededAdmin(ctx.window);

        await enableDarkTheme(ctx.window);
        state = await readDarkThemeState(ctx.window);
        assertDarkThemeState(state, 'index.html (before toggle)');

        await ctx.window.evaluate(() => {
            const toggle = typeof toggleTheme === 'function' ? toggleTheme : window.UXEnhancements?.toggleTheme;
            if (typeof toggle !== 'function') {
                throw new Error('toggleTheme is not available on index.html');
            }
            toggle();
        });
        state = await readDarkThemeState(ctx.window);
        if (state.dataTheme !== 'light') {
            throw new Error(`toggleTheme should switch to light on index.html, got data-theme=${state.dataTheme}`);
        }

        await ctx.window.evaluate(() => {
            const toggle = typeof toggleTheme === 'function' ? toggleTheme : window.UXEnhancements?.toggleTheme;
            toggle();
        });
        state = await readDarkThemeState(ctx.window);
        assertDarkThemeState(state, 'index.html (after toggle back to dark)');
        console.log('[e2e:dark] theme toggle on dashboard ok');

        console.log(`[e2e:dark] Checking ${managedPages.length} pages as ${E2E_SEED.email} (developer)…`);

        for (const pageFile of managedPages) {
            process.stdout.write(`[e2e:dark] › ${pageFile} … `);
            try {
                await gotoAppPage(ctx.window, pageFile);
                await assertPageUrl(ctx.window, pageFile);
                await waitForDarkThemeApplied(ctx.window);

                state = await readDarkThemeState(ctx.window);
                assertDarkThemeState(state, pageFile);
                passed += 1;
                console.log('ok');
            } catch (err) {
                failures.push({ page: pageFile, message: err && err.message ? err.message : String(err) });
                console.log('FAIL');
            }
        }

        if (failures.length) {
            console.error('\n[e2e:dark] Failed pages:');
            for (const failure of failures) {
                console.error(`  - ${failure.page}: ${failure.message}`);
            }
            throw new Error(`Dark theme failed on ${failures.length}/${managedPages.length} pages`);
        }

        console.log(`[e2e:dark] PASS — ${passed}/${managedPages.length} managed pages`);
    } finally {
        await ctx.close();
    }
}

async function main() {
    console.log('[e2e:dark] Dark theme all-pages suite…');
    const started = Date.now();

    await scenarioSetupDarkTheme();
    await scenarioAuthenticatedDarkThemeFlow();

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[e2e:dark] All scenarios passed in ${seconds}s`);
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch((err) => {
        console.error('[e2e:dark] FAIL:', err && err.stack ? err.stack : err);
        process.exit(1);
    });