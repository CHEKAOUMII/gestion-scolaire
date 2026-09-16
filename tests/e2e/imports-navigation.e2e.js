'use strict';

// Real Electron regression: Import Settings quick navigation must open Results.
// Uses only a disposable profile and the existing local-admin fixture.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, seedLocalProfile, loginSeededAdmin, gotoAppPage } = require('./helpers');

async function main() {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-nav-e2e-'));
    let ctx;
    try {
        await seedLocalProfile(userDataDir);
        ctx = await launchApp({ userDataDir });
        await loginSeededAdmin(ctx.window);
        await gotoAppPage(ctx.window, 'settings-imports.html');
        await ctx.window.locator('#quick-nav-toggle').click();
        const link = ctx.window.locator('#quick-nav-pages-list a').filter({ hasText: /^النتائج$/ });
        await link.waitFor({ state: 'visible' });
        const href = await link.getAttribute('href');
        console.log(`[navigation] Results link target: ${href}`);
        await Promise.all([
            ctx.window.waitForURL(/results-hub\.html(?:[?#]|$)/, { timeout: 10_000 }),
            link.click()
        ]);
        await ctx.window.locator('#tab-btn-results').waitFor({ state: 'visible' });
        assert.match(ctx.window.url(), /results-hub\.html(?:[?#]|$)/);
        console.log('[navigation] PASS: quick-navigation Results opens the Results Hub');
    } finally {
        if (ctx) await ctx.close();
        else fs.rmSync(userDataDir, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
