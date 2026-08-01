'use strict';

/**
 * WP6: auth-session + FilterManager classic shared modules.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Minimal browser shims for classic scripts under Node
global.window = global;
global.document = {
    documentElement: { dataset: {} },
    getElementById: () => null,
    createElement: () => ({})
};
global.localStorage = (() => {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k)
    };
})();
global.HTMLElement = class HTMLElement {};

console.log('[test] WP6 auth-session + filter-manager');

const auth = require('../js/shared/auth-session.js');
assert.strictEqual(typeof auth.getAuthSessionData, 'function');
assert.strictEqual(typeof auth.setAuthSession, 'function');
assert.strictEqual(typeof auth.getSchoolYear, 'function');

auth.clearAuthSession();
assert.strictEqual(auth.isAuthSessionActive(), false);

auth.setAuthSession('a@school.ma', {
    userId: 7,
    name: 'Admin',
    email: 'a@school.ma',
    role: 'admin'
});
assert.strictEqual(auth.isAuthSessionActive(), true);
assert.strictEqual(auth.getAuthRole(), 'admin');
assert.strictEqual(auth.getCurrentAppRole(), 'admin');
assert.strictEqual(auth.normalizeRole('staff'), 'principal');
assert.strictEqual(auth.isAuthenticatedRole('viewer'), true);
assert.strictEqual(auth.isAuthenticatedRole('guest'), false);

const session = auth.getAuthSessionData();
assert.ok(session);
assert.ok(session._h, 'session integrity hash present');
assert.strictEqual(session.email, 'a@school.ma');

// Tamper → rejected
const raw = global.localStorage.getItem(auth.AUTH_SESSION_KEY);
const parsed = JSON.parse(raw);
parsed.role = 'teacher';
global.localStorage.setItem(auth.AUTH_SESSION_KEY, JSON.stringify(parsed));
assert.strictEqual(auth.getAuthSessionData(), null, 'tampered session must fail hash');

auth.setSchoolYear('2026/2027');
// setSchoolYear triggers reload in browser; under node it may still write
assert.strictEqual(auth.getSchoolYear(), '2026/2027');
console.log('  [ok] auth-session storage, roles, integrity hash, school year');

const { FilterManager } = require('../js/shared/filter-manager.js');
assert.strictEqual(typeof FilterManager, 'function');
assert.strictEqual(global.FilterManager, FilterManager);
assert.strictEqual(global.PencilShared.FilterManager, FilterManager);

const fm = new FilterManager({
    selectors: {},
    year: '2025/2026'
});
assert.deepStrictEqual(fm.getValues(), { level: '', class: '', subject: '', teacher: '' });
console.log('  [ok] FilterManager class published on PencilShared + bare global');

// HTML pages that load utils.js must load shared scripts first
const root = path.join(__dirname, '..');
const htmlFiles = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
let checked = 0;
for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    if (!html.includes('js/utils.js')) continue;
    assert.ok(html.includes('js/shared/auth-session.js'), `${file} missing auth-session.js`);
    assert.ok(html.includes('js/shared/filter-manager.js'), `${file} missing filter-manager.js`);
    assert.ok(html.includes('js/shared/dom-helpers.js'), `${file} missing dom-helpers.js`);

    const authIdx = html.indexOf('js/shared/auth-session.js');
    const fmIdx = html.indexOf('js/shared/filter-manager.js');
    const utilsIdx = html.indexOf('js/utils.js');
    assert.ok(authIdx < utilsIdx, `${file}: auth-session must load before utils`);
    assert.ok(fmIdx < utilsIdx, `${file}: filter-manager must load before utils`);
    checked += 1;
}
assert.ok(checked >= 40, `expected many pages, got ${checked}`);
console.log(`  [ok] ${checked} HTML pages load shared scripts before utils.js`);

// utils.js must not re-declare class FilterManager
const utilsSrc = fs.readFileSync(path.join(root, 'js', 'utils.js'), 'utf8');
assert.ok(!/class\s+FilterManager\b/.test(utilsSrc), 'utils.js must not define class FilterManager');
assert.ok(utilsSrc.includes('bindFilterManager'), 'utils.js must bind FilterManager from shared');
assert.ok(utilsSrc.includes('PencilShared.getAuthSessionData'), 'utils.js must prefer PencilShared auth helpers');
console.log('  [ok] utils.js is a compatibility façade for moved symbols');

console.log('[test] WP6 auth-session + filter-manager OK');
