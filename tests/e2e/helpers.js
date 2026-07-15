/**
 * Shared helpers for Playwright + Electron e2e tests.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LAUNCH_TIMEOUT_MS = 60_000;
const SEED_SCRIPT = path.join(__dirname, 'seed-profile.js');

/** Known local credentials for e2e (auth_source=local — no Firebase). */
const E2E_SEED = {
    email: 'e2e@local.test',
    password: 'E2eTest123!',
    name: 'E2E Admin',
    role: 'admin',
    institutionName: 'ثانوية اختبار E2E',
    massarCode: 'E2E001',
    schoolId: 'E2E001'
};

function buildEnv() {
    const env = { ...process.env };
    // Parent shells (especially Electron-based IDEs) may set this; Electron
    // treats any presence as "run as Node" and never starts the GUI app.
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
}

function getElectronBinary() {
    const electronBinary = require('electron');
    if (typeof electronBinary !== 'string' || !fs.existsSync(electronBinary)) {
        throw new Error(`[e2e] Electron binary not found: ${electronBinary}`);
    }
    return electronBinary;
}

/**
 * Seed institution + local admin by running a short Electron process against userDataDir.
 * Must NOT run while another Electron instance holds the same userDataDir.
 *
 * @param {string} userDataDir
 * @param {Partial<typeof E2E_SEED>} [overrides]
 */
async function seedLocalProfile(userDataDir, overrides = {}) {
    const seed = { ...E2E_SEED, ...overrides };
    const electronBinary = getElectronBinary();
    const env = buildEnv();
    env.E2E_SEED_JSON = JSON.stringify(seed);

    const result = await new Promise((resolve, reject) => {
        const child = spawn(
            electronBinary,
            [SEED_SCRIPT, `--user-data-dir=${userDataDir}`],
            {
                cwd: ROOT,
                env,
                stdio: ['ignore', 'pipe', 'pipe']
            }
        );

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(
                    new Error(
                        `[e2e] seed-profile exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`
                    )
                );
                return;
            }
            const match = stdout.match(/\[e2e-seed\] OK\s+(\{.*\})/);
            if (!match) {
                reject(new Error(`[e2e] seed-profile produced no OK payload\nstdout:\n${stdout}\nstderr:\n${stderr}`));
                return;
            }
            try {
                resolve(JSON.parse(match[1]));
            } catch (err) {
                reject(new Error(`[e2e] seed-profile JSON parse failed: ${err.message}\n${match[1]}`));
            }
        });
    });

    if (!result?.ok) {
        throw new Error(`[e2e] seedLocalProfile failed: ${JSON.stringify(result)}`);
    }
    return result;
}

/**
 * @param {{ userDataDir?: string, cleanUserData?: boolean }} [options]
 * @returns {Promise<{ app: import('playwright').ElectronApplication, window: import('playwright').Page, userDataDir: string, close: (opts?: { deleteUserData?: boolean }) => Promise<void>, relaunch: () => Promise<void> }>}
 */
async function launchApp(options = {}) {
    let electron;
    try {
        ({ _electron: electron } = require('playwright'));
    } catch (err) {
        console.error('[e2e] Playwright is not installed. Run: npm i -D playwright');
        throw err;
    }

    const electronBinary = getElectronBinary();
    const userDataDir =
        options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'gs-e2e-'));
    const cleanUserData = options.cleanUserData !== false;

    async function start() {
        const app = await electron.launch({
            executablePath: electronBinary,
            args: [ROOT, `--user-data-dir=${userDataDir}`],
            cwd: ROOT,
            env: buildEnv(),
            timeout: LAUNCH_TIMEOUT_MS
        });
        const window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
        await window.waitForLoadState('domcontentloaded', { timeout: LAUNCH_TIMEOUT_MS });
        return { app, window };
    }

    let { app, window } = await start();

    async function close(closeOpts = {}) {
        const deleteUserData = closeOpts.deleteUserData ?? cleanUserData;
        await app.close().catch(() => {});
        if (deleteUserData) {
            try {
                fs.rmSync(userDataDir, { recursive: true, force: true });
            } catch (_) {
                /* ignore locked files */
            }
        }
    }

    /**
     * Quit and relaunch Electron on the same userDataDir (e.g. after offline seed).
     */
    async function relaunch() {
        await app.close().catch(() => {});
        // Brief pause so Windows releases DB/WAL locks.
        await new Promise((r) => setTimeout(r, 400));
        const next = await start();
        app = next.app;
        window = next.window;
    }

    const ctx = {
        get app() {
            return app;
        },
        get window() {
            return window;
        },
        userDataDir,
        close,
        relaunch
    };

    return ctx;
}

/**
 * Run named scenarios serially; abort on first failure.
 * @param {Array<{ name: string, run: (ctx: Awaited<ReturnType<typeof launchApp>>) => Promise<void> }>} scenarios
 * @param {{ userDataDir?: string, cleanUserData?: boolean }} [launchOptions]
 */
async function runScenarios(scenarios, launchOptions = {}) {
    const ctx = await launchApp(launchOptions);
    console.log('[e2e] userDataDir:', ctx.userDataDir);
    let passed = 0;

    try {
        for (const scenario of scenarios) {
            process.stdout.write(`[e2e] › ${scenario.name} … `);
            await scenario.run(ctx);
            passed += 1;
            console.log('ok');
        }
        console.log(`[e2e] PASS — ${passed}/${scenarios.length} scenarios`);
    } catch (err) {
        console.log('FAIL');
        console.error(`[e2e] failed after ${passed}/${scenarios.length} scenarios`);
        throw err;
    } finally {
        await ctx.close();
    }

    return ctx.userDataDir;
}

function assertMatch(actual, re, message) {
    assert.ok(re.test(String(actual || '')), message || `Expected ${re} to match: ${actual}`);
}

/** Final dark tokens — single [data-theme='dark'] product shell (dashboard Zen cool-slate). */
const DARK_THEME_TOKENS = Object.freeze({
    surface: '#22262e',
    secondary: '#191c23',
    textMain: '#eeeae2',
    themeColor: '#22262e'
});

function normalizeHex(value) {
    return String(value || '').trim().toLowerCase();
}

/**
 * Persist dark theme the same way ux-enhancements.js does.
 * @param {import('playwright').Page} window
 */
async function enableDarkTheme(window) {
    await window.evaluate(() => {
        localStorage.setItem('app-theme', 'dark');
        document.documentElement.setAttribute('data-theme', 'dark');
        if (typeof updateThemeIcon === 'function') {
            updateThemeIcon('dark');
        }
        if (typeof updateThemeColor === 'function') {
            updateThemeColor('dark');
        }
    });
}

/**
 * @param {import('playwright').Page} window
 */
async function readDarkThemeState(window) {
    return window.evaluate(() => {
        const html = document.documentElement;
        const styles = getComputedStyle(html);
        const themeMeta = document.querySelector('meta[name="theme-color"]');
        return {
            dataTheme: html.getAttribute('data-theme'),
            storedTheme: localStorage.getItem('app-theme'),
            surface: styles.getPropertyValue('--color-surface').trim(),
            secondary: styles.getPropertyValue('--color-secondary').trim(),
            textMain: styles.getPropertyValue('--color-text-main').trim(),
            themeColor: themeMeta ? themeMeta.getAttribute('content') : null,
            url: window.location.href
        };
    });
}

/**
 * @param {Awaited<ReturnType<typeof readDarkThemeState>>} state
 * @param {string} pageLabel
 */
function assertDarkThemeState(state, pageLabel) {
    assert.strictEqual(state.dataTheme, 'dark', `${pageLabel}: html[data-theme] should be "dark"`);
    assert.strictEqual(state.storedTheme, 'dark', `${pageLabel}: localStorage app-theme should be "dark"`);
    assert.strictEqual(
        normalizeHex(state.surface),
        DARK_THEME_TOKENS.surface,
        `${pageLabel}: --color-surface should be ${DARK_THEME_TOKENS.surface}, got ${state.surface}`
    );
    assert.strictEqual(
        normalizeHex(state.secondary),
        DARK_THEME_TOKENS.secondary,
        `${pageLabel}: --color-secondary should be ${DARK_THEME_TOKENS.secondary}, got ${state.secondary}`
    );
    assert.strictEqual(
        normalizeHex(state.textMain),
        DARK_THEME_TOKENS.textMain,
        `${pageLabel}: --color-text-main should be ${DARK_THEME_TOKENS.textMain}, got ${state.textMain}`
    );
    // setup.html has no ux-enhancements.js — tokens apply but meta theme-color stays light.
    if (state.themeColor && !/setup\.html$/i.test(pageLabel)) {
        assert.strictEqual(
            normalizeHex(state.themeColor),
            DARK_THEME_TOKENS.themeColor,
            `${pageLabel}: meta theme-color should be ${DARK_THEME_TOKENS.themeColor}, got ${state.themeColor}`
        );
    }
}

/**
 * @param {import('playwright').Page} window
 */
async function waitPageReady(window) {
    await window.waitForLoadState('domcontentloaded', { timeout: LAUNCH_TIMEOUT_MS });
    await window
        .waitForFunction(() => document.readyState === 'complete', { timeout: 15_000 })
        .catch(() => {});
    await window.waitForTimeout(250);
}

/**
 * @param {import('playwright').Page} window
 * @param {string} pageFile
 */
async function gotoAppPage(window, pageFile) {
    const target = new URL(pageFile, window.url()).href;
    await window.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: LAUNCH_TIMEOUT_MS
    });
    await waitPageReady(window);
}

/**
 * Wait for initTheme() to apply persisted dark mode; re-apply if a page loads late.
 * @param {import('playwright').Page} window
 */
async function waitForDarkThemeApplied(window) {
    const applied = await window
        .waitForFunction(
            () =>
                document.documentElement.getAttribute('data-theme') === 'dark' &&
                localStorage.getItem('app-theme') === 'dark',
            { timeout: 5000 }
        )
        .then(() => true)
        .catch(() => false);

    if (!applied) {
        await enableDarkTheme(window);
    }

    await window.waitForTimeout(150);
}

/**
 * @param {import('playwright').Page} window
 */
async function loginSeededAdmin(window) {
    await waitPageReady(window);
    assertMatch(window.url(), /login\.html/i, `Expected login.html before admin login, got: ${window.url()}`);

    await window.locator('#login-email').fill(E2E_SEED.email);
    await window.locator('#login-password').fill(E2E_SEED.password);

    await Promise.all([
        window.waitForURL(/index\.html/i, { timeout: LAUNCH_TIMEOUT_MS }),
        window.locator('#btn-login').click()
    ]);
    await waitPageReady(window);
    await window.waitForLoadState('networkidle', { timeout: LAUNCH_TIMEOUT_MS }).catch(() => {});
    assertMatch(window.url(), /index\.html/i, `Expected index.html after login, got: ${window.url()}`);
}

module.exports = {
    ROOT,
    LAUNCH_TIMEOUT_MS,
    E2E_SEED,
    DARK_THEME_TOKENS,
    launchApp,
    seedLocalProfile,
    runScenarios,
    assertMatch,
    enableDarkTheme,
    readDarkThemeState,
    assertDarkThemeState,
    waitPageReady,
    gotoAppPage,
    waitForDarkThemeApplied,
    loginSeededAdmin
};
