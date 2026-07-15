'use strict';

// Spec: .kiro/specs/exam-center-redesign/
// Tasks 3.3, 4.3, 5.3, 7.2, 7.3, 7.4, 7.5
// Static regression checks for the three exam-center pages.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assertContains(text, needle, message) {
    assert.ok(text.includes(needle), message || `Expected text to contain ${needle}`);
}

function assertBefore(text, first, second, message) {
    const a = text.indexOf(first);
    const b = text.indexOf(second);
    assert.ok(a !== -1, `Missing first marker: ${first}`);
    assert.ok(b !== -1, `Missing second marker: ${second}`);
    assert.ok(a < b, message || `${first} should appear before ${second}`);
}

function uniqueMatches(text, regex) {
    return Array.from(new Set(Array.from(text.matchAll(regex), (match) => match[1])));
}

const examSectionsCss = read('css/exam-sections.css');

const PAGE_JS_BY_HTML = {
    'exams-proctors.html': 'js/pages/exams-proctors.js',
    'exams-rooms.html': 'js/pages/exams-rooms.js',
    'exams-schedule.html': 'js/pages/exams-schedule.js'
};

function assertPageShell(rel) {
    const html = read(rel);
    const pageJsRel = PAGE_JS_BY_HTML[rel];
    const pageJs = pageJsRel ? read(pageJsRel) : '';
    // Markup shell checks on HTML; ExamSections.init lives in page JS after PRA.
    const combined = html + '\n' + pageJs;
    assertContains(html, '<html lang="ar" dir="rtl"', `${rel} should remain Arabic RTL`);
    assertContains(
        html,
        '<link rel="stylesheet" href="css/exam-sections.css"',
        `${rel} should load shared section CSS`
    );
    assert.ok(!html.includes('<style>'), `${rel} should not introduce inline style blocks`);
    assertBefore(
        html,
        '<script src="js/ux-enhancements.js" defer></script>',
        '<script src="js/exam-sections.js" defer></script>',
        `${rel} should load exam-sections after shared UX helpers`
    );
    assertContains(examSectionsCss, '.exam-sections-root', 'section CSS should include root styles');
    assertContains(examSectionsCss, '.exam-section-nav-btn', 'section CSS should style section nav buttons');
    assertContains(examSectionsCss, '@media (max-width: 1023px)', 'section CSS should include tablet breakpoint');
    assertContains(examSectionsCss, '@media (max-width: 767px)', 'section CSS should include mobile breakpoint');
    assertContains(
        examSectionsCss,
        'overflow-x: auto',
        'section CSS should contain horizontal overflow inside nav/tabs only'
    );
    assertContains(
        examSectionsCss,
        'prefers-reduced-motion: reduce',
        'section CSS should include reduced-motion handling'
    );
    assertContains(combined, 'window.ExamSections.init', `${rel} should initialize ExamSections`);
    return combined;
}

function assertTabsHavePanels(rel, tabRegex) {
    const html = read(rel);
    const tabs = uniqueMatches(html, tabRegex);
    assert.ok(tabs.length > 0, `${rel} should expose data-tab buttons`);
    tabs.forEach((tab) => {
        assertContains(html, `id="panel-${tab}"`, `${rel} should keep panel-${tab} for tab ${tab}`);
    });
}

const schedule = assertPageShell('exams-schedule.html');
assertContains(schedule, "tablistSelector: '.exam-tabs-header'", 'schedule should target its existing tablist');
assertContains(schedule, "order: ['settings', 'inputs']", 'schedule should order settings before inputs');
[
    "'add-exam': 'settings'",
    "periods: 'settings'",
    "readiness: 'settings'",
    "branches: 'inputs'",
    "rooms: 'inputs'",
    "supervisors: 'inputs'",
    "candidates: 'inputs'",
    "team: 'inputs'"
].forEach((line) => assertContains(schedule, line, `schedule missing map entry ${line}`));
assertTabsHavePanels('exams-schedule.html', /data-tab="([a-z-]+)"/g);

const proctors = assertPageShell('exams-proctors.html');
assertContains(proctors, "tablistSelector: '#epm-tabs'", 'proctors should target #epm-tabs');
assertContains(proctors, "tabSelector: '.epm-tab[data-tab]'", 'proctors should not classify close button');
["scheduling: 'settings'", "proctors: 'settings'", "candidates: 'settings'", "attendance: 'production'"].forEach(
    (line) => assertContains(proctors, line, `proctors missing map entry ${line}`)
);
assertContains(proctors, 'id="epm-close"', 'proctors close button should be preserved');
assertContains(proctors, 'id="dist-stepper"', 'distribution stepper should remain in page markup');
assertTabsHavePanels('exams-proctors.html', /class="epm-tab[^"']*"[^>]*data-tab="([a-z-]+)"/g);

const rooms = assertPageShell('exams-rooms.html');
assertContains(rooms, "tablistSelector: '.erm-tabs'", 'rooms should target .erm-tabs');
assertContains(rooms, "order: ['production']", 'rooms should show production as the only section');
["summary: 'production'", "invitations: 'production'", "attendance: 'production'"].forEach((line) =>
    assertContains(rooms, line, `rooms missing map entry ${line}`)
);
assertContains(rooms, 'ensureAria: true', 'rooms must use additive ARIA repair');
assertContains(rooms, 'PrintSystem', 'rooms printing flow should remain referenced');
assertTabsHavePanels('exams-rooms.html', /class="erm-tab[^"']*"[^>]*data-tab="([a-z-]+)"/g);

const examSections = read('js/exam-sections.js');
assertContains(examSections, "title: 'المدخلات'", 'registry should keep Arabic inputs title');
assertContains(examSections, "title: 'الإعدادات'", 'registry should keep Arabic settings title');
assertContains(examSections, "title: 'الإنتاج'", 'registry should keep Arabic production title');
assertContains(examSections, "case 'ArrowRight':", 'keyboard support should include ArrowRight');
assertContains(examSections, "case 'ArrowLeft':", 'keyboard support should include ArrowLeft');
assertContains(examSections, "case 'Home':", 'keyboard support should include Home');
assertContains(examSections, "case 'End':", 'keyboard support should include End');
assertContains(examSections, "case 'Enter':", 'keyboard support should include Enter');
assertContains(examSections, "case ' ':", 'keyboard support should include Space');
assertContains(examSections, "setAttribute('aria-current', 'true')", 'section nav should expose aria-current');
assertContains(examSections, "setAttribute('aria-label'", 'interactive section buttons should have accessible names');

const sharedCss = read('css/tailwind-output.css');
assert.ok(!sharedCss.includes('exam-section-nav'), 'exam-section CSS should remain outside tailwind-output.css');

const tailwindInput = read('css/tailwind-input.css');
assert.ok(
    contrast(hexVar(tailwindInput, '--color-text-main'), hexVar(tailwindInput, '--color-surface')) >= 4.5,
    'light theme main text on surface should satisfy WCAG AA'
);
assert.ok(contrast('#e8e8e8', '#1a1a1a') >= 4.5, 'dark theme main text on surface should satisfy WCAG AA');
assert.ok(contrast('#3b6ac5', '#ffffff') >= 4.5, 'Pencil Blue on white should satisfy WCAG AA for text-sized accents');

function hexVar(css, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(match, `Missing hex CSS variable ${name}`);
    return match[1];
}

function contrast(hexA, hexB) {
    const lumA = luminance(hexA);
    const lumB = luminance(hexB);
    const lighter = Math.max(lumA, lumB);
    const darker = Math.min(lumA, lumB);
    return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex) {
    const rgb = hex
        .replace('#', '')
        .match(/.{2}/g)
        .map((part) => parseInt(part, 16) / 255);
    const linear = rgb.map((channel) => {
        if (channel <= 0.03928) return channel / 12.92;
        return Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

console.log('exam-sections-pages.test.js passed');
