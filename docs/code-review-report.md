# Code Review Report

Repo reviewed: `D:\Pencil2`
Review scope: repo-level review across Electron shell, renderer/UI, backend IPC, security/config, and test/tooling

## Findings

### 1. Secret Exposure Through Packaged Environment File

- **Severity:** 🔴 Critical
- **Location:** [`.env`](/D:/Pencil2/.env#L6), [`package.json`](/D:/Pencil2/package.json#L53), [`main/updater.js`](/D:/Pencil2/main/updater.js#L10)
- **Issue:** A live `GH_TOKEN` is committed, the build explicitly packages `.env`, and the updater loads `.env` from the packaged app. That exposes repo-scoped credentials to anyone who can inspect the installer or app files.
- **Fix:** Rotate the token immediately, stop shipping `.env`, and require runtime env injection.

```js
// /D:/Pencil2/main/updater.js
const ghToken = process.env.GH_TOKEN;
if (!ghToken) {
  throw new Error('GH_TOKEN must be provided by the runtime environment');
}
```

```json
// /D:/Pencil2/package.json
"files": [
  "**/*",
  "!*.env*",
  "!postcss.config.js",
  "!css/tailwind-input.css"
]
```

### 2. Hardcoded Signing And Telemetry Secrets In Source

- **Severity:** 🔴 Critical
- **Location:** [`main/licensing/licenseDefaults.js`](/D:/Pencil2/main/licensing/licenseDefaults.js#L1), [`main/licensing/ownerSyncDefaults.js`](/D:/Pencil2/main/licensing/ownerSyncDefaults.js#L1)
- **Issue:** The offline license signing secret and owner sync tokens are hardcoded in tracked source. Anyone with source access or a built app can forge licenses or impersonate telemetry clients/readers.
- **Fix:** Move all secrets to environment or secure storage and rotate existing values.

```js
// /D:/Pencil2/main/licensing/licenseDefaults.js
const LICENSE_DEFAULTS = {
  signingSecret: process.env.GESTION_LICENSE_SECRET
};
if (!LICENSE_DEFAULTS.signingSecret || LICENSE_DEFAULTS.signingSecret.length < 32) {
  throw new Error('GESTION_LICENSE_SECRET is required');
}
module.exports = { LICENSE_DEFAULTS };
```

### 3. Remote Script In Privileged Electron Renderer

- **Severity:** 🔴 Critical
- **Location:** [`index.html`](/D:/Pencil2/index.html#L219), [`preload.js`](/D:/Pencil2/preload.js#L4)
- **Issue:** A remote script is loaded into a privileged Electron renderer that also receives a very large `window.api` bridge. That turns any compromise of the remote asset or network path into full access to sensitive IPC operations.
- **Fix:** Remove the remote script from production, or isolate it in an unprivileged surface.

```html
<!-- /D:/Pencil2/index.html -->
<!-- <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script> -->
```

### 4. Renderer XSS Via Unescaped Input Interpolation

- **Severity:** 🔴 Critical
- **Location:** [`app.js`](/D:/Pencil2/app.js#L1397), [`app.js`](/D:/Pencil2/app.js#L1406)
- **Issue:** `renderStudentsTable()` injects `searchName` and `searchFamily` directly into HTML attribute values. A quote in user input can break out of the attribute and inject script into a privileged renderer.
- **Fix:** Stop interpolating untrusted values into `innerHTML`; assign `.value` after rendering.

```js
const container = document.getElementById('table-section');
container.innerHTML = `
  <input id="search-name" placeholder="الاسم...">
  <input id="search-family" placeholder="النسب...">
`;
container.querySelector('#search-name').value = searchName;
container.querySelector('#search-family').value = searchFamily;
```

### 5. Sensitive IPC Operations Exposed Without Real Auth

- **Severity:** 🔴 Critical
- **Location:** [`main/ipc/ipc-helpers.js`](/D:/Pencil2/main/ipc/ipc-helpers.js#L103), [`main/ipc/students.js`](/D:/Pencil2/main/ipc/students.js#L66), [`main/ipc/system.js`](/D:/Pencil2/main/ipc/system.js#L98), [`main/ipc/system.js`](/D:/Pencil2/main/ipc/system.js#L231)
- **Issue:** Sensitive IPC is exposed without real auth in multiple places. `handleWriteSoftAuth()` allows destructive writes before login, `users:resetAdminPassword` is unauthenticated, and `system:backupDb` returns the full DB without a role check.
- **Fix:** Require auth for all sensitive handlers and keep pre-login allowlists tiny.

```js
ipcMain.handle('users:resetAdminPassword', async (event) => {
  try {
    requireRole(event, ['admin']);
    // reset flow
  } catch (err) {
    return authErrorResponse(err);
  }
});

ipcMain.handle('system:backupDb', async (event) => {
  try {
    requireRole(event, ['admin']);
    // backup flow
  } catch (err) {
    return authErrorResponse(err);
  }
});
```

### 6. Owner Telemetry Tokens Readable From Renderer

- **Severity:** 🔴 Critical
- **Location:** [`main/ipc/ownerTelemetry.js`](/D:/Pencil2/main/ipc/ownerTelemetry.js#L13), [`main/licensing/ownerSync.js`](/D:/Pencil2/main/licensing/ownerSync.js#L172)
- **Issue:** `ownerTelemetry:getConfig` returns owner sync config without `requireRole`, and that config includes raw read/write tokens. Any renderer can exfiltrate them.
- **Fix:** Restrict the endpoint to admins and redact secrets in normal responses.

```js
ipcMain.handle('ownerTelemetry:getConfig', async (event) => {
  try {
    requireRole(event, ['admin']);
    const result = getOwnerSyncConfig();
    return {
      ...result,
      config: {
        ...result.config,
        writeToken: result.config.writeToken ? '••••••' : '',
        readToken: result.config.readToken ? '••••••' : ''
      }
    };
  } catch (err) {
    return authErrorResponse(err);
  }
});
```

### 7. Lock Screen State Not Enforced In Auth Guard

- **Severity:** 🔴 Critical
- **Location:** [`main/ipc/auth.js`](/D:/Pencil2/main/ipc/auth.js#L108), [`main/ipc/auth.js`](/D:/Pencil2/main/ipc/auth.js#L481)
- **Issue:** `auth:lockSession` sets `session.locked = true`, but `requireAuth()` and `requireRole()` ignore it. A locked session can still call protected IPC handlers directly.
- **Fix:** Enforce lock state in auth guards.

```js
function requireAuth(event) {
  const session = getSessionByEvent(event);
  if (!session) throw createAuthError('UNAUTHENTICATED', 'الرجاء تسجيل الدخول أولاً');
  if (session.locked) throw createAuthError('SESSION_LOCKED', 'الجلسة مقفلة');
  return session;
}
```

### 8. Insecure Telemetry Server Defaults

- **Severity:** 🟡 Warning
- **Location:** [`server/index.js`](/D:/Pencil2/server/index.js#L6), [`server/index.js`](/D:/Pencil2/server/index.js#L39), [`server/index.js`](/D:/Pencil2/server/index.js#L93)
- **Issue:** The telemetry server accepts a predictable default write token, uses `Access-Control-Allow-Origin: *`, and allows the read token on write endpoints. That weakens separation and makes accidental insecure deployment likely.
- **Fix:** Fail startup if tokens are default or missing, require distinct tokens, and remove or restrict CORS.

```js
if (!OWNER_SYNC_WRITE_TOKEN || OWNER_SYNC_WRITE_TOKEN === 'change-me-write-token') {
  throw new Error('OWNER_SYNC_WRITE_TOKEN must be set');
}
if (isWriteEndpoint(parsed.pathname, req.method || 'GET')) {
  return token && token === OWNER_SYNC_WRITE_TOKEN;
}
```

### 9. Broken Audit Logging For Unauthenticated Writes

- **Severity:** 🟡 Warning
- **Location:** [`main/ipc/ipc-helpers.js`](/D:/Pencil2/main/ipc/ipc-helpers.js#L115), [`main/db/schema.js`](/D:/Pencil2/main/db/schema.js#L252)
- **Issue:** Audit logging for unauthenticated writes is broken: the insert uses `entity` and `timestamp`, but the table defines `entity_type`, `entity_id`, and `created_at`. The failure is swallowed, so you get neither security nor observability.
- **Fix:** Align the insert with the actual schema and surface failures for security-sensitive paths.

```js
db.prepare(`
  INSERT INTO system_logs(action, details, entity_type, entity_id)
  VALUES(?, ?, ?, ?)
`).run(
  'UNAUTHENTICATED_WRITE',
  `Unauthenticated write on channel "${channel}"`,
  'ipc',
  channel
);
```

### 10. Weak Test And CI Coverage

- **Severity:** 🟡 Warning
- **Location:** [`tests/smoke.js`](/D:/Pencil2/tests/smoke.js#L196), [`grades.html`](/D:/Pencil2/grades.html#L11), [`package.json`](/D:/Pencil2/package.json#L12), [`.github/workflows/ci.yml`](/D:/Pencil2/.github/workflows/ci.yml#L24)
- **Issue:** Test and tooling coverage is too thin. The only automated test is one monolithic smoke file, it appears to fail on an inline-style policy in `grades.html`, lint misses core files like `app.js` and `server/index.js`, and CI never runs the packaging build.
- **Fix:** Split smoke checks into focused tests, expand lint globs, and add a build verification step.

```json
"lint": "eslint \"main.js\" \"app.js\" \"preload.js\" \"main/**/*.js\" \"server/**/*.js\" \"js/**/*.js\" \"tests/**/*.js\""
```

```yml
- name: Verify Electron build
  run: npm run build
```

### 11. Maintainability Drift In Shared Contracts

- **Severity:** 🔵 Suggestion
- **Location:** [`preload.js`](/D:/Pencil2/preload.js#L136), [`preload.js`](/D:/Pencil2/preload.js#L286), [`login.html`](/D:/Pencil2/login.html#L179), [`js/utils.js`](/D:/Pencil2/js/utils.js#L101)
- **Issue:** There are maintainability drifts: duplicated `staffAttendance` exposure in the preload bridge and duplicated session-hash logic between `login.html` and `js/utils.js`. These are easy places for behavior to silently diverge.
- **Fix:** Keep one preload contract source and one session helper source.

## Evaluation By Area

### 1. Readability & Clean Code

- Large files like `app.js` and `preload.js` carry too many responsibilities.
- There is duplication in auth/session helpers and preload contract exposure.
- Some UI markup suggests features that are not wired yet, which is misleading for future maintainers.

### 2. Architecture & Design

- The biggest architectural problem is trust-boundary design: privileged Electron surfaces are too broad.
- The preload bridge should be split by page or capability, with least-privilege exposure.
- Security-sensitive configuration should not live in tracked source or packaged environment files.

### 3. Best Practices

- Secret handling is the largest best-practice failure.
- IPC auth is inconsistent and in some places absent for destructive operations.
- Startup and operational safety need stronger guardrails.

### 4. Testing

- There is useful smoke coverage, but it is too centralized and brittle.
- High-risk paths need dedicated tests:
  - sensitive IPC authz
  - locked-session denial
  - owner telemetry secret redaction
  - renderer escaping / XSS safety
  - packaging exclusion of secret files

### 5. Documentation

- The repo would benefit from a short architecture note for renderer lifecycle and preload contract ownership.
- Security-sensitive defaults need explicit documentation around deployment and secret injection.
- Comments that imply temporary insecure behavior is acceptable should be tightened or removed.

## Summary Score

`3/10`

## Top 3 Changes To Make

1. Remove and rotate every shipped or hardcoded secret.
2. Put real authorization in front of every sensitive IPC surface.
3. Remove the remote script and eliminate unsafe renderer HTML interpolation.

## Refactored Direction

A full refactor is too large to include here, but the highest-value direction is:

- make the preload bridge minimal and page-specific
- enforce auth in one place via `requireAuth` and `requireRole`
- remove `handleWriteSoftAuth` for destructive channels
- move all secrets to runtime env or secure OS storage
- replace renderer `innerHTML` paths that interpolate user input with DOM construction or safe property assignment

## Notes

- This report was consolidated from a repo-level review using 5 sub-agents plus direct local verification.
- No code changes were made as part of this export.
