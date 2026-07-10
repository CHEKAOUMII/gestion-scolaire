'use strict';

// CH11: role session guard matrix
//
//   node tests/role-session-guard-unit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    AUTH_SESSION_KEY,
    readAuthSession,
    sessionHasAnyRole,
    enforceRoleSession
} = require('../js/shared/role-session-guard.js');

function mockStorage(map) {
    return {
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
        }
    };
}

// readAuthSession
assert.strictEqual(readAuthSession(mockStorage({})), null);
assert.strictEqual(readAuthSession(mockStorage({ [AUTH_SESSION_KEY]: 'not-json' })), null);
assert.strictEqual(
    readAuthSession(mockStorage({ [AUTH_SESSION_KEY]: JSON.stringify({ role: 'admin' }) })).role,
    'admin'
);

// sessionHasAnyRole
assert.ok(sessionHasAnyRole({ role: 'admin' }, ['admin', 'developer']));
assert.ok(!sessionHasAnyRole({ role: 'staff' }, ['admin', 'developer']));
assert.ok(!sessionHasAnyRole(null, ['admin']));

// enforceRoleSession allow/deny matrix
const redirects = [];
const adminStore = mockStorage({ [AUTH_SESSION_KEY]: JSON.stringify({ role: 'admin' }) });
assert.strictEqual(
    enforceRoleSession({
        roles: ['developer', 'admin'],
        storage: adminStore,
        redirect: (u) => redirects.push(u)
    }),
    true
);
assert.deepStrictEqual(redirects, []);

assert.strictEqual(
    enforceRoleSession({
        roles: ['developer'],
        storage: adminStore,
        redirectTo: 'index.html',
        redirect: (u) => redirects.push(u)
    }),
    false
);
assert.deepStrictEqual(redirects, ['index.html']);

// principal allowed only when listed
const principalStore = mockStorage({ [AUTH_SESSION_KEY]: JSON.stringify({ role: 'principal' }) });
assert.strictEqual(
    enforceRoleSession({
        roles: ['developer', 'admin', 'principal'],
        storage: principalStore,
        redirect: () => assert.fail('should not redirect')
    }),
    true
);
assert.strictEqual(
    enforceRoleSession({
        roles: ['developer', 'admin'],
        storage: principalStore,
        redirect: () => {}
    }),
    false
);

// Guard wrappers use shared helper + never redirect to missing dashboard.html
const guards = [
    'js/pages/app-admin-guard.js',
    'js/pages/settings-defaults-guard.js',
    'js/pages/settings-users-guard.js',
    'js/pages/settings-license-guard.js'
];
for (const rel of guards) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(/enforceRoleSession/.test(src), rel + ' must call enforceRoleSession');
    assert.ok(!/dashboard\.html/.test(src), rel + ' must not redirect to missing dashboard.html');
}

// HTML loads shared module before thin guard
for (const rel of [
    'app-admin.html',
    'settings-defaults.html',
    'settings-users.html',
    'settings-license.html'
]) {
    const html = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(html.includes('js/shared/role-session-guard.js'), rel + ' must load role-session-guard.js');
    const sharedIdx = html.indexOf('role-session-guard.js');
    const guardIdx = html.search(/js\/pages\/.*-guard\.js/);
    assert.ok(sharedIdx !== -1 && guardIdx !== -1 && sharedIdx < guardIdx, rel + ' load order');
}

console.log('role-session-guard-unit: OK');
