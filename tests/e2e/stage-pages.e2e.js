/**
 * Playwright + Electron: stage (educational cycle) UI coverage.
 *
 * Seeds a local institution + admin, then exercises every stage-related
 * control and page:
 *   1. Seed + local login (admin, full cycle access)
 *   2. Top-bar stage switcher on the dashboard (qualifiant selected, primary
 *      preview row greyed out as «قيد الإعداد», no sidebar remnant)
 *   3. Pure buildCycleSwitcherOptions filtering + live-data agreement with
 *      the rendered switcher
 *   4. Switcher present on every stage-scoped page
 *   5. settings-school «أسلاك المؤسسة»: add / enable / disable cycle buttons
 *      (the approved collegial stage becomes switchable after it is added)
 *   6. settings-users «صلاحيات الأسلاك» admin matrix + per-cycle actions
 *   7. timetable cycle selector + settings-defaults «قواعد المرحلة» tab
 *   8. Top-bar stage switching: unsaved edits block a collegial switch, and
 *      the cycles:setActive success round-trip pins the session context.
 *
 * Usage:
 *   npm run test:e2e:stage
 *   node tests/e2e/stage-pages.e2e.js
 */
'use strict';

const assert = require('assert');
const {
    runScenarios,
    assertMatch,
    LAUNCH_TIMEOUT_MS,
    seedLocalProfile,
    gotoAppPage,
    loginSeededAdmin
} = require('./helpers');

const QUALIFIANT_LABEL = 'السلك الثانوي التأهيلي';
const SEED_RELEASE_MS = 800;

async function expectVisible(window, selector) {
    const loc = window.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 15_000 });
    assert.ok(await loc.isVisible(), `Expected visible: ${selector}`);
}

async function seedAndRelaunch(ctx, overrides = {}) {
    await ctx.app.close().catch(() => {});
    await new Promise((r) => setTimeout(r, SEED_RELEASE_MS));
    const seedResult = await seedLocalProfile(ctx.userDataDir, overrides);
    assert.strictEqual(seedResult.setupCompleted, true, 'Seed should mark setup_completed');
    await ctx.relaunch();
    assertMatch(ctx.window.url(), /login\.html/i, `Seeded profile should open login.html, got: ${ctx.window.url()}`);
}

/**
 * The app currently ships exactly one supported stage (secondary_qualifiant),
 * so the global top-bar switcher renders as a visible, disabled indicator:
 * every ACTIVE institution stage appears in the dropdown — preview rows
 * disabled and labelled «قيد الإعداد» — while the qualifiant option is
 * selected and no switch is possible.
 */
async function assertTopbarSwitcherSingleState(window, pageLabel) {
    const wrapper = window.locator('#topbar-cycle-switcher');
    await wrapper.waitFor({ state: 'visible', timeout: 15_000 });

    const select = window.locator('#topbar-cycle-select');
    assert.strictEqual(
        await select.isDisabled(),
        false,
        `${pageLabel}: select should remain openable to inspect active preview stages`
    );

    const options = select.locator('option');
    const count = await options.count();
    assert.ok(count >= 2, `${pageLabel}: active preview stages must appear in the dropdown, got ${count} option(s)`);

    const qualifiant = select.locator('option[value="secondary_qualifiant"]').first();
    assert.strictEqual(
        await qualifiant.getAttribute('value'),
        'secondary_qualifiant',
        `${pageLabel}: qualifiant option present`
    );
    assert.strictEqual(await qualifiant.isDisabled(), false, `${pageLabel}: qualifiant option must be selectable`);
    assert.ok(await qualifiant.evaluate((el) => el.selected), `${pageLabel}: qualifiant option must be selected`);
    const qualifiantText = ((await qualifiant.textContent()) || '').trim();
    assert.ok(
        qualifiantText.includes(QUALIFIANT_LABEL),
        `${pageLabel}: qualifiant option text should name the stage, got: ${qualifiantText}`
    );

    for (const previewCode of ['primary']) {
        const preview = select.locator(`option[value="${previewCode}"]`);
        if ((await preview.count()) > 0) {
            assert.strictEqual(await preview.isDisabled(), true, `${pageLabel}: ${previewCode} must render disabled`);
            const text = ((await preview.textContent()) || '').trim();
            assert.ok(
                text.includes('قيد الإعداد'),
                `${pageLabel}: ${previewCode} must be labelled «قيد الإعداد», got: ${text}`
            );
        }
    }

    assert.strictEqual(
        await wrapper.evaluate((el) => el.hidden),
        false,
        `${pageLabel}: wrapper must not be hidden when at least one active stage exists`
    );
}

async function scenarioSeedAndLogin(ctx) {
    await seedAndRelaunch(ctx);
    await loginSeededAdmin(ctx.window);
    console.log('[e2e:stage]   logged in as seeded admin');
}

async function scenarioDashboardSwitcher({ window }) {
    assertMatch(window.url(), /index\.html/i, `Expected dashboard, got: ${window.url()}`);

    await assertTopbarSwitcherSingleState(window, 'index.html');

    // Old sidebar switcher must be gone entirely.
    assert.strictEqual(
        await window.locator('#sidebar-cycle-switcher').count(),
        0,
        'Legacy #sidebar-cycle-switcher must not exist'
    );
    assert.strictEqual(
        await window.locator('#sidebar select, #sidebar .topbar-cycle-switcher').count(),
        0,
        'No cycle control inside the sidebar'
    );

    // The refresh alias is the same loader (settings-school.js calls it).
    const aliases = await window.evaluate(() => ({
        same: window.refreshCycleSwitcher === window.loadTopbarCycleSwitcher,
        hasBuilder: typeof window.buildCycleSwitcherOptions === 'function'
    }));
    assert.strictEqual(aliases.same, true, 'window.refreshCycleSwitcher must alias loadTopbarCycleSwitcher');
    assert.strictEqual(aliases.hasBuilder, true, 'window.buildCycleSwitcherOptions must be exposed');

    // Session context must already pin the qualifiant stage.
    const active = await window.evaluate(async () => {
        const response = await window.api.cycles.getActive();
        return response?.success ? response.context?.cycleCode || response.cycle?.cycle_code || null : null;
    });
    assert.strictEqual(active, 'secondary_qualifiant', `Active cycle should be qualifiant, got: ${active}`);
}

async function scenarioSwitcherFiltering({ window }) {
    // Pure builder: active stages all ship; preview rows are disabled and
    // labelled «قيد الإعداد», inactive rows never appear.
    const synthetic = await window.evaluate(() => {
        const cycles = [
            { cycle_code: 'a', label_ar: 'أ', is_active: 1, capability: 'supported' },
            { cycle_code: 'b', label_ar: 'ب', is_active: 0, capability: 'supported' },
            { cycle_code: 'p', label_ar: 'ب-قيد', is_active: 1, capability: 'preview' },
            { cycle_code: 'q', label_ar: 'ق', is_active: 1, capability: 'supported' }
        ];
        const opts = window.buildCycleSwitcherOptions(cycles, 'q');
        return {
            values: opts.map((o) => o.value),
            selected: opts.map((o) => o.selected),
            disabled: opts.map((o) => o.disabled),
            labels: opts.map((o) => o.label)
        };
    });
    assert.deepStrictEqual(synthetic.values, ['a', 'p', 'q'], 'Every active stage appears; inactive rows never do');
    assert.deepStrictEqual(synthetic.selected, [false, false, true], 'Selected flag must follow activeCycleCode');
    assert.deepStrictEqual(
        synthetic.disabled,
        [false, true, false],
        'Preview rows are disabled, supported rows selectable'
    );
    assert.strictEqual(synthetic.labels[1], 'ب-قيد (قيد الإعداد)', 'Preview label carries the «قيد الإعداد» suffix');
    assert.strictEqual(synthetic.labels[2], 'ق', 'Supported label is untouched');

    // Live agreement: the rendered switcher options equal the pure builder
    // output for the real cycles:list + cycles:getActive payloads.
    const live = await window.evaluate(async () => {
        const listResponse = await window.api.cycles.list();
        const activeResponse = await window.api.cycles.getActive();
        const activeCode = activeResponse?.context?.cycleCode || activeResponse?.cycle?.cycle_code || null;
        const options = window.buildCycleSwitcherOptions(listResponse.cycles, activeCode);
        const rendered = Array.from(document.querySelectorAll('#topbar-cycle-select option')).map((option) => ({
            value: option.value,
            label: (option.textContent || '').trim(),
            selected: option.selected,
            disabled: option.disabled
        }));
        return { options, rendered, list: listResponse.cycles };
    });
    assert.deepStrictEqual(live.rendered, live.options, 'Rendered switcher must equal the pure builder output');
    assert.ok(
        live.options.some((o) => o.value === 'secondary_qualifiant' && !o.disabled && o.selected),
        'Qualifiant must be selected and selectable'
    );
    assert.ok(
        live.options.some((o) => o.value === 'primary' && o.disabled && o.label.includes('قيد الإعداد')),
        'Seeded primary stage must be present, disabled and labelled «قيد الإعداد»'
    );
    assert.ok(live.list.length >= 2, 'cycles:list should include preview stages too (primary is seeded)');
    assert.ok(
        live.list.some((cycle) => cycle.cycle_code === 'primary' && cycle.capability === 'preview'),
        'Seeded primary stage should be present and preview'
    );
}

async function scenarioSwitcherAcrossPages({ window }) {
    const stagePages = [
        'students-list.html',
        'teachers-list.html',
        'analytics.html',
        'results-hub.html',
        'timetable.html',
        'settings-school.html',
        'settings-users.html',
        'settings-defaults.html'
    ];
    for (const pageFile of stagePages) {
        await gotoAppPage(window, pageFile);
        assertMatch(
            window.url(),
            new RegExp(pageFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
            `Expected ${pageFile}`
        );
        await assertTopbarSwitcherSingleState(window, pageFile);
        await expectVisible(window, '#sidebar');
        console.log(`[e2e:stage]   switcher ok on ${pageFile}`);
    }
}

async function scenarioCycleManagementButtons({ window }) {
    await gotoAppPage(window, 'settings-school.html');
    await expectVisible(window, '#institution-cycles-list');

    // Seeded institution has primary + qualifiant; collegial is not added yet.
    const collegialAdd = window.locator('#institution-cycles-list .cycle-add[data-cycle-code="secondary_collegial"]');
    await collegialAdd.waitFor({ state: 'visible', timeout: 15_000 });
    assert.strictEqual(
        await window.locator('#institution-cycles-list .cycle-toggle').count(),
        2,
        'primary + qualifiant rows should show toggle buttons'
    );
    assert.strictEqual(
        await window.locator('#institution-cycles-list .cycle-add').count(),
        1,
        'exactly one not-added catalog cycle (collegial)'
    );

    // Add collegial via the real button.
    await collegialAdd.click();
    const collegialToggle = window.locator(
        '#institution-cycles-list .cycle-toggle[data-cycle-code="secondary_collegial"]'
    );
    await collegialToggle.waitFor({ state: 'visible', timeout: 15_000 });
    assert.strictEqual(await collegialToggle.getAttribute('data-active'), '1', 'collegial should be added and active');
    assertMatch(
        (await collegialToggle.textContent()) || '',
        /تعطيل/i,
        'Toggle should read «تعطيل» for an enabled cycle'
    );

    // The approved collegial cycle becomes a second selectable work stage.
    const topbarSelect = window.locator('#topbar-cycle-select');
    assert.strictEqual(await topbarSelect.isDisabled(), false, 'two supported stages must enable the switcher');
    for (const supportedCode of ['secondary_qualifiant', 'secondary_collegial']) {
        assert.strictEqual(
            await topbarSelect.locator(`option[value="${supportedCode}"]`).isDisabled(),
            false,
            `${supportedCode} must be selectable after approval`
        );
    }
    assert.strictEqual(
        await topbarSelect.locator('option[value="primary"]').isDisabled(),
        true,
        'primary remains a disabled preview option'
    );

    // Disable / re-enable round trip through the toggle button.
    await collegialToggle.click();
    await window
        .locator('#institution-cycles-list .cycle-toggle[data-cycle-code="secondary_collegial"][data-active="0"]')
        .waitFor({ state: 'visible', timeout: 15_000 });
    await window.locator('#institution-cycles-list .cycle-toggle[data-cycle-code="secondary_collegial"]').click();
    await window
        .locator('#institution-cycles-list .cycle-toggle[data-cycle-code="secondary_collegial"][data-active="1"]')
        .waitFor({ state: 'visible', timeout: 15_000 });

    // IPC state agrees: three institution cycles, collegial re-enabled.
    const state = await window.evaluate(async () => {
        const response = await window.api.cycles.list();
        const catalog = await window.api.cycles.getCatalog();
        const collegial = response.cycles.find((cycle) => cycle.cycle_code === 'secondary_collegial');
        return {
            count: response.cycles.length,
            collegialActive: collegial ? Number(collegial.is_active) : null,
            catalogCount: catalog.cycles.length
        };
    });
    assert.strictEqual(state.count, 3, 'cycles:list should include the added collegial cycle');
    assert.strictEqual(state.collegialActive, 1, 'collegial should be active after re-enable');
    assert.strictEqual(state.catalogCount, 3, 'catalog always lists the three official stages');
}

async function scenarioCycleAccessMatrix({ window }) {
    await gotoAppPage(window, 'settings-users.html');

    // «صلاحيات الأسلاك» admin section (hidden for non-admin).
    await expectVisible(window, '#cycle-access-panel');
    await expectVisible(window, '#cycle-access-tbody');

    const theadText = ((await window.locator('#cycle-access-thead-row').textContent()) || '').trim();
    assert.ok(theadText.includes(QUALIFIANT_LABEL), 'Matrix header should include the qualifiant stage');
    assert.ok(
        theadText.includes('السلك الثانوي الإعدادي'),
        'Matrix header should include the collegial stage (added earlier)'
    );

    // Seeded admin holds full access — matrix shows the protected row, no checkboxes.
    const bodyText = ((await window.locator('#cycle-access-tbody').textContent()) || '').trim();
    assert.ok(bodyText.includes('صلاحية كاملة'), 'Admin row should show full access');

    // Per-cycle «تفعيل للجميع» / «تعطيل للجميع» actions are wired per active cycle.
    const chipCount = await window.locator('#cycle-access-cycle-actions .su-status-chip').count();
    assert.ok(
        chipCount >= 3,
        `Expected a chip per active institution cycle (primary/collegial/qualifiant), got ${chipCount}`
    );
    assert.ok(
        (await window.locator('#cycle-access-cycle-actions button:has-text("تفعيل للجميع")').count()) >= 3,
        'Every active cycle should have a «تفعيل للجميع» button'
    );
    assert.ok(
        (await window.locator('#cycle-access-cycle-actions button:has-text("تعطيل للجميع")').count()) >= 3,
        'Every active cycle should have a «تعطيل للجميع» button'
    );
}

async function scenarioTopbarSwitching({ window }) {
    await gotoAppPage(window, 'students-list.html');
    const select = window.locator('#topbar-cycle-select');
    await select.waitFor({ state: 'visible', timeout: 15_000 });
    await select.locator('option').first().waitFor({ state: 'attached', timeout: 15_000 });

    const attemptSwitch = (value) =>
        window.evaluate((cycleCode) => {
            const el = document.querySelector('#topbar-cycle-select');
            el.value = cycleCode;
            el.dispatchEvent(new Event('change'));
        }, value);

    // Unsaved edits block a switch to the approved collegial stage.
    await window.evaluate(() => document.body.setAttribute('data-unsaved-changes', 'true'));
    await attemptSwitch('secondary_collegial');
    await window.waitForTimeout(700);
    assertMatch(window.url(), /students-list\.html/i, 'Blocked switch must not reload the page');
    const toastText = ((await window.locator('#toast-container').textContent()) || '').trim();
    assert.ok(toastText.includes('احفظ التعديلات'), 'Blocked switch must explain that edits must be saved');
    assert.strictEqual(await select.isDisabled(), false, 'approved collegial stage remains selectable');
    await window.evaluate(() => document.body.removeAttribute('data-unsaved-changes'));

    // The success branch of the same code path (cycles:setActive) works and
    // pins the session context.
    const switched = await window.evaluate(async () => {
        const response = await window.api.cycles.setActive(
            'secondary_qualifiant',
            typeof getSchoolYear === 'function' ? getSchoolYear() : ''
        );
        return {
            success: response?.success,
            cycleCode: response?.context?.cycleCode || null,
            hasError: Boolean(response?.error)
        };
    });
    assert.strictEqual(switched.success, true, 'cycles:setActive must succeed for the supported stage');
    assert.strictEqual(switched.cycleCode, 'secondary_qualifiant', 'setActive must pin the qualifiant context');
    assert.strictEqual(switched.hasError, false, 'setActive must not return an error');
}

async function scenarioTimetableAndStageRules({ window }) {
    await gotoAppPage(window, 'timetable.html');

    const timetableSelect = window.locator('#timetable-cycle-select');
    await timetableSelect.waitFor({ state: 'visible', timeout: 15_000 });
    assert.strictEqual(
        await timetableSelect.isDisabled(),
        false,
        'timetable cycle select should enable with two supported stages'
    );
    assert.strictEqual(
        await timetableSelect.inputValue(),
        'secondary_qualifiant',
        'timetable cycle select should hold the qualifiant stage'
    );
    const statusText = ((await window.locator('#timetable-cycle-status').textContent()) || '').trim();
    assert.ok(
        statusText.includes(QUALIFIANT_LABEL),
        `timetable status should name the qualifiant stage, got: ${statusText}`
    );

    await gotoAppPage(window, 'settings-defaults.html');

    // «قواعد المرحلة» tab: catalog-driven stage selector, qualifiant preselected.
    const stageSelect = window.locator('#stage-cycle-select');
    await stageSelect.waitFor({ state: 'attached', timeout: 15_000 });
    const optionCount = await stageSelect.locator('option').count();
    assert.strictEqual(optionCount, 3, `stage rules cycle select should list the 3 catalog stages, got ${optionCount}`);
    assert.strictEqual(
        await stageSelect.inputValue(),
        'secondary_qualifiant',
        'stage rules should preselect the active stage'
    );

    const optionTexts = await stageSelect.locator('option').allTextContents();
    assert.ok(
        optionTexts.some((text) => text.includes('السلك الثانوي الإعدادي') && !text.includes('قيد الإعداد')),
        'Approved collegial stage must not be labelled «قيد الإعداد»'
    );
    assert.ok(
        optionTexts.some((text) => text.includes('سلك التعليم الابتدائي') && text.includes('قيد الإعداد')),
        'Primary preview must be labelled «قيد الإعداد»'
    );

    await window.locator('#tab-btn-rules').click();
    await expectVisible(window, '#tab-rules');
    await expectVisible(window, '#stage-year-select');
    assert.ok(
        (await window.locator('#stage-year-select option').count()) >= 1,
        'stage rules year select should have options'
    );
}

async function main() {
    console.log('[e2e:stage] Launching Electron stage-pages suite…');
    await runScenarios([
        { name: 'seed local institution + admin, login', run: scenarioSeedAndLogin },
        { name: 'top-bar stage switcher on dashboard', run: scenarioDashboardSwitcher },
        { name: 'switcher filtering + live data agreement', run: scenarioSwitcherFiltering },
        { name: 'switcher across stage-scoped pages', run: scenarioSwitcherAcrossPages },
        { name: 'settings-school cycle management buttons', run: scenarioCycleManagementButtons },
        { name: 'settings-users cycle access matrix', run: scenarioCycleAccessMatrix },
        { name: 'timetable selector + stage rules tab', run: scenarioTimetableAndStageRules },
        { name: 'top-bar stage switching (guard + refusal + setActive)', run: scenarioTopbarSwitching }
    ]);
}

main().catch((err) => {
    console.error('[e2e:stage] FAIL:', err && err.stack ? err.stack : err);
    process.exit(1);
});
