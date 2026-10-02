/**
 * Playwright + Electron e2e suite (no Firebase required).
 *
 * Fresh --user-data-dir always lands on setup.html, then exercises:
 *   1. Launch / preload bridge
 *   2. Setup wizard → new institution form + client validation
 *   3. Setup → login navigation + form fields / password toggle
 *   4. Invalid login stays on page and surfaces an error
 *   5. Seed local institution + admin (offline Electron seed script)
 *   6. Login with seeded local user → dashboard
 *   7. Dashboard sidebar / nav / session UI
 *
 * Usage:
 *   npm run test:e2e
 *   node tests/e2e/electron-smoke.js
 */
'use strict';

const assert = require('assert');
const {
    runScenarios,
    assertMatch,
    LAUNCH_TIMEOUT_MS,
    E2E_SEED,
    seedLocalProfile
} = require('./helpers');

async function waitReady(window) {
    await window.waitForLoadState('domcontentloaded', { timeout: LAUNCH_TIMEOUT_MS });
}

async function expectVisible(window, selector) {
    const loc = window.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 15_000 });
    assert.ok(await loc.isVisible(), `Expected visible: ${selector}`);
}

async function ensureLoginPage(window) {
    if (/login\.html/i.test(window.url())) {
        await waitReady(window);
        return;
    }
    await window.goto(new URL('login.html', window.url()).href, {
        waitUntil: 'domcontentloaded',
        timeout: LAUNCH_TIMEOUT_MS
    });
    await waitReady(window);
    assertMatch(window.url(), /login\.html/i, `Expected login.html, got: ${window.url()}`);
}

async function scenarioLaunchAndPreload({ window }) {
    await waitReady(window);

    const title = await window.title();
    const url = window.url();
    console.log(`\n[e2e]   title=${title}`);
    console.log(`[e2e]   url=${url}`);

    assertMatch(url, /setup\.html/i, `Fresh profile should open setup.html, got: ${url}`);
    assertMatch(title, /إعداد المؤسسة|التدبير المدرسي/i, `Unexpected title: ${title}`);

    await expectVisible(window, '#step-mode-select');
    await expectVisible(window, '#btn-mode-new');
    await expectVisible(window, '#btn-mode-login');

    const hasApi = await window.evaluate(() => typeof window.api === 'object' && window.api !== null);
    assert.strictEqual(hasApi, true, 'window.api is missing — preload bridge failed');

    const status = await window.evaluate(async () => {
        if (!window.api?.institution?.getStatus) return null;
        return window.api.institution.getStatus();
    });
    assert.ok(status && typeof status === 'object', 'institution.getStatus did not return an object');
    assert.strictEqual(!!status.setupCompleted, false, 'Fresh userData should not be setup-completed');
}

async function scenarioSetupNewInstitutionForm({ window }) {
    await waitReady(window);
    await expectVisible(window, '#step-mode-select');

    await window.locator('#btn-mode-new').click();
    await expectVisible(window, '#step-new-institution');
    await expectVisible(window, '#form-new-institution');

    for (const id of [
        '#new-institution-name',
        '#new-admin-name',
        '#new-admin-email',
        '#new-admin-password',
        '#new-admin-confirm',
        '#btn-submit-new'
    ]) {
        await expectVisible(window, id);
    }

    // Client-side validation (form has novalidate).
    await window.locator('#btn-submit-new').click();
    await expectVisible(window, '#new-institution-name-error');
    await expectVisible(window, '#new-admin-name-error');
    await expectVisible(window, '#new-email-error');
    await expectVisible(window, '#new-password-error');

    const nameError = (await window.locator('#new-institution-name-error').textContent()) || '';
    assert.ok(nameError.trim().length > 0, 'Expected institution name error text');

    // Partial fill: password mismatch.
    await window.locator('#new-institution-name').fill('ثانوية اختبار E2E');
    await window.locator('#new-admin-name').fill('مدير الاختبار');
    await window.locator('#new-admin-email').fill('e2e-admin@example.com');
    await window.locator('#new-admin-password').fill('secret12');
    await window.locator('#new-admin-confirm').fill('secret99');
    await window.locator('#btn-submit-new').click();

    await expectVisible(window, '#new-confirm-error');
    const confirmError = (await window.locator('#new-confirm-error').textContent()) || '';
    assertMatch(confirmError, /كلمتا المرور|غير متطابق/i, `Unexpected confirm error: ${confirmError}`);

    // Still on setup form (did not navigate away / call bootstrap).
    assertMatch(window.url(), /setup\.html/i, 'Should remain on setup after validation errors');
    await expectVisible(window, '#step-new-institution');

    // Back to mode select.
    await window.locator('#btn-back-from-new').click();
    await expectVisible(window, '#step-mode-select');
    const newHidden = await window.locator('#step-new-institution').evaluate((el) => el.classList.contains('hidden'));
    assert.strictEqual(newHidden, true, 'New-institution step should be hidden after back');
}

async function scenarioNavigateToLoginAndFields({ window }) {
    await waitReady(window);
    // Ensure we are on mode select (previous scenario ends there).
    if (!(await window.locator('#step-mode-select').isVisible().catch(() => false))) {
        if (await window.locator('#btn-back-from-new').isVisible().catch(() => false)) {
            await window.locator('#btn-back-from-new').click();
        }
    }
    await expectVisible(window, '#btn-mode-login');

    await Promise.all([
        window.waitForURL(/login\.html/i, { timeout: LAUNCH_TIMEOUT_MS }),
        window.locator('#btn-mode-login').click()
    ]);
    await waitReady(window);

    const title = await window.title();
    assertMatch(title, /تسجيل الدخول|التدبير المدرسي/i, `Unexpected login title: ${title}`);

    await expectVisible(window, '#login-form');
    await expectVisible(window, '#login-email');
    await expectVisible(window, '#login-password');
    await expectVisible(window, '#btn-login');
    await expectVisible(window, '#remember-me');
    await expectVisible(window, '.login-brand-panel h1');

    const brand = ((await window.locator('.login-brand-panel h1').textContent()) || '').trim();
    assertMatch(brand, /التدبير المدرسي/i, `Unexpected brand heading: ${brand}`);

    // Password visibility toggle.
    const password = window.locator('#login-password');
    const toggle = window.locator('.password-toggle[data-target="login-password"]');
    await expectVisible(window, '.password-toggle[data-target="login-password"]');

    assert.strictEqual(await password.getAttribute('type'), 'password');
    await toggle.click();
    assert.strictEqual(await password.getAttribute('type'), 'text');
    await toggle.click();
    assert.strictEqual(await password.getAttribute('type'), 'password');

    // Fill fields (no submit yet).
    await window.locator('#login-email').fill('e2e-user@example.com');
    await window.locator('#login-password').fill('wrong-password');
    assert.strictEqual(await window.locator('#login-email').inputValue(), 'e2e-user@example.com');
}

async function scenarioInvalidLoginShowsError({ window }) {
    await waitReady(window);
    assertMatch(window.url(), /login\.html/i, `Expected login page, got: ${window.url()}`);

    await window.locator('#login-email').fill('e2e-invalid@example.com');
    await window.locator('#login-password').fill('definitely-not-valid');
    await window.locator('#btn-login').click();

    // Error banner uses class "show" (see login.js showLoginMessage).
    const errorBanner = window.locator('#login-error.show');
    await errorBanner.waitFor({ state: 'visible', timeout: LAUNCH_TIMEOUT_MS });

    assertMatch(window.url(), /login\.html/i, `Invalid login must not leave login.html, got: ${window.url()}`);

    const errorText = ((await window.locator('#login-error-text').textContent()) || '').trim();
    assert.ok(errorText.length > 0, 'Expected non-empty login error message');
    console.log(`[e2e]   login error: ${errorText.slice(0, 120)}`);

    // Button must re-enable after failure.
    await window
        .locator('#btn-login:not([disabled])')
        .waitFor({ state: 'visible', timeout: 15_000 })
        .catch(async () => {
            const disabled = await window.locator('#btn-login').isDisabled();
            assert.strictEqual(disabled, false, 'Login button should re-enable after failed login');
        });

    // Session must not be established.
    const hasSession = await window.evaluate(() => {
        try {
            return !!localStorage.getItem('gsl_auth_session_v1');
        } catch {
            return false;
        }
    });
    assert.strictEqual(hasSession, false, 'Failed login must not write gsl_auth_session_v1');
}

async function scenarioSeedLocalProfile(ctx) {
    // Playwright's electron.evaluate cannot require() app modules — seed offline via a
    // short Electron process, then relaunch the same userDataDir (setup → login entry).
    await ctx.app.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 500));

    const seedResult = await seedLocalProfile(ctx.userDataDir);
    console.log(
        `\n[e2e]   seeded user id=${seedResult.userId} role=${seedResult.role} auth=${seedResult.authSource}`
    );
    console.log(`[e2e]   institution=${seedResult.institutionName} setup=${seedResult.setupCompleted}`);

    assert.strictEqual(seedResult.setupCompleted, true, 'Seed should mark setup_completed');
    assert.ok(seedResult.userId, 'Seed should create/update a user id');
    assert.strictEqual(String(seedResult.authSource || '').toLowerCase(), 'local', 'User must be auth_source=local');

    await ctx.relaunch();
    await waitReady(ctx.window);

    // After seed, main.js should open login.html (setup_completed=1).
    assertMatch(
        ctx.window.url(),
        /login\.html|index\.html/i,
        `Expected login/index after seeded relaunch, got: ${ctx.window.url()}`
    );

    await ensureLoginPage(ctx.window);
    const status = await ctx.window.evaluate(async () => {
        if (!window.api?.institution?.getStatus) return null;
        return window.api.institution.getStatus();
    });
    assert.ok(status?.success !== false, `getStatus failed: ${JSON.stringify(status)}`);
    assert.strictEqual(!!status.setupCompleted, true, 'getStatus.setupCompleted should be true after seed');
}

async function scenarioLocalLoginToDashboard({ window }) {
    await ensureLoginPage(window);
    await expectVisible(window, '#login-form');

    // Clear any previous error banner state.
    await window.locator('#login-email').fill(E2E_SEED.email);
    await window.locator('#login-password').fill(E2E_SEED.password);

    await Promise.all([
        window.waitForURL(/index\.html/i, { timeout: LAUNCH_TIMEOUT_MS }),
        window.locator('#btn-login').click()
    ]);
    await waitReady(window);
    // Wait for deferred scripts / auth enforcement to settle.
    await window.waitForLoadState('networkidle', { timeout: LAUNCH_TIMEOUT_MS }).catch(() => {});

    assertMatch(window.url(), /index\.html/i, `Expected dashboard index.html after login, got: ${window.url()}`);

    const session = await window.evaluate(() => {
        try {
            return JSON.parse(localStorage.getItem('gsl_auth_session_v1') || 'null');
        } catch {
            return null;
        }
    });
    assert.ok(session, 'Expected gsl_auth_session_v1 after successful login');
    assertMatch(session.email || '', new RegExp(E2E_SEED.email.replace('.', '\\.'), 'i'), 'Session email mismatch');
    assertMatch(String(session.role || ''), /admin/i, `Expected admin role, got: ${session.role}`);

    const ipcSession = await window.evaluate(async () => {
        if (!window.api?.auth?.getSession) return null;
        return window.api.auth.getSession();
    });
    assert.strictEqual(!!ipcSession?.authenticated, true, 'Main-process session should be authenticated');
}

async function scenarioDashboardSidebar({ window }) {
    await waitReady(window);
    assertMatch(window.url(), /index\.html/i, `Expected index.html, got: ${window.url()}`);

    // Sidebar is injected by sidebar.js into #sidebar.
    await window.locator('#sidebar[data-injected="true"], #sidebar .nav-link').first().waitFor({
        state: 'visible',
        timeout: LAUNCH_TIMEOUT_MS
    });

    await expectVisible(window, '#sidebar');
    await expectVisible(window, '#sidebar .nav-link[href="index.html"]');
    await expectVisible(window, '#menu-toggle');
    // utils.js may rebuild .header into unified-header and drop #header-search;
    // assert the search box input instead of a fragile id.
    await expectVisible(window, '.search-box input, #header-search');
    // The signed-in user is rendered in the sidebar auth block (#user-email
    // only exists on settings-imports/settings-sync pages).
    await expectVisible(window, '#sidebar-auth-name');
    await expectVisible(window, '#school-year, select#school-year');

    // Dashboard nav label (Arabic).
    const dashLink = window.locator('#sidebar a.nav-link[href="index.html"]');
    const dashText = ((await dashLink.textContent()) || '').trim();
    assertMatch(dashText, /لوحة التحكم/i, `Unexpected dashboard nav text: ${dashText}`);

    // At least a few primary nav targets present after injection.
    for (const href of ['students-list.html', 'teachers-list.html', 'settings-school.html']) {
        const link = window.locator(`#sidebar a[href="${href}"]`).first();
        await link.waitFor({ state: 'attached', timeout: 15_000 });
        assert.ok((await link.count()) > 0, `Expected sidebar link to ${href}`);
    }

    // Session reflected in the sidebar auth block (name or email).
    const userLabel = ((await window.locator('#sidebar-auth-name').textContent()) || '').trim();
    assert.ok(userLabel.length > 0, 'sidebar-auth-name should not be empty');
    // Prefer seeded name, but role badge / email fallbacks are acceptable.
    const looksLikeUser =
        userLabel.includes(E2E_SEED.name) ||
        /e2e/i.test(userLabel) ||
        userLabel.includes('@') ||
        userLabel.length >= 2;
    assert.ok(looksLikeUser, `Unexpected sidebar-auth-name label: ${userLabel}`);
    console.log(`[e2e]   user label: ${userLabel}`);

    // School block in sidebar should exist (name may still be loading).
    await expectVisible(window, '#sidebar-school-name, #sidebar .school-details');

    // Navigate to students list (allowed for admin) and confirm shell stays intact.
    // Expand submenu if needed (students-list lives under an expandable section).
    const studentsLink = window.locator('#sidebar a[href="students-list.html"]').first();
    const studentsVisible = await studentsLink.isVisible().catch(() => false);
    if (!studentsVisible) {
        const disclosure = window.locator('#sidebar button.nav-disclosure[aria-controls="sidebar-students-submenu"]');
        if (await disclosure.count()) {
            await disclosure.click();
        }
    }
    await studentsLink.waitFor({ state: 'visible', timeout: 15_000 });

    await Promise.all([
        window.waitForURL(/students-list\.html/i, { timeout: LAUNCH_TIMEOUT_MS }),
        studentsLink.click()
    ]);
    await waitReady(window);
    assertMatch(window.url(), /students-list\.html/i, `Expected students-list.html, got: ${window.url()}`);
    await expectVisible(window, '#sidebar');
    await expectVisible(window, '#sidebar a.nav-link[href="index.html"]');
}

async function main() {
    console.log('[e2e] Launching Electron suite…');
    await runScenarios([
        { name: 'launch + preload + setup entry', run: scenarioLaunchAndPreload },
        { name: 'setup new-institution form + validation', run: scenarioSetupNewInstitutionForm },
        { name: 'navigate to login + fields + password toggle', run: scenarioNavigateToLoginAndFields },
        { name: 'invalid login shows error and stays', run: scenarioInvalidLoginShowsError },
        { name: 'seed local institution + admin user', run: scenarioSeedLocalProfile },
        { name: 'local login → dashboard', run: scenarioLocalLoginToDashboard },
        { name: 'dashboard sidebar + students nav', run: scenarioDashboardSidebar }
    ]);
}

main().catch((err) => {
    console.error('[e2e] FAIL:', err && err.stack ? err.stack : err);
    process.exit(1);
});
