# gestionScholaire — Architecture Review Report
**Date:** 2026-04-08
**Reviewer:** Architecture Review Plan (automated)
**Scope:** Full codebase — process boundary, IPC, DB, auth, renderer, CSS, tests, reports, notifications

---

## Severity Legend
| Level | Meaning |
|---|---|
| 🔴 Critical | Security vulnerability or data loss risk — fix before any release |
| 🟠 Important | Structural violation that will cause bugs — fix before merge |
| 🟡 Minor | Code quality degradation — schedule for cleanup sprint |
| 🟢 Good | Explicitly noteworthy positive pattern |

---

## 1. Process Boundary & Electron Security

### Findings

**🟢 Good — `main.js`:144-148 — BrowserWindow security options are correctly set.**
`nodeIntegration: false` and `contextIsolation: true` are both explicitly declared in the `webPreferences` block. The preload script is resolved with `path.join(__dirname, 'preload.js')`, which is the correct absolute-path pattern.

**🟢 Good — `main.js`:25-48 — `shell.openExternal()` inputs are sanitized before use.**
A `parseUrl()` helper validates that the URL is parseable, and `openExternallyIfSupported()` then enforces an allowlist of protocols (`http:`, `https:`, `mailto:`, `tel:`) before calling `shell.openExternal()`. Navigation and new-window events are also intercepted by `installWebContentsGuards()` (lines 51-73), which blocks all non-`file:` URLs inline and redirects them through the same sanitizer. Webview attachment is unconditionally blocked (`will-attach-webview` at line 70-72).

**🟡 Minor — `main.js`:179 — DevTools not disabled in production builds.**
Line 179 contains `// window.webContents.openDevTools();` commented out. There is no programmatic guard using `app.isPackaged` or `process.env.NODE_ENV` to ensure DevTools cannot be opened in a production package (e.g. via keyboard shortcut `F12` or `Ctrl+Shift+I`). In a packaged Electron app, DevTools remain available to end users by default unless explicitly disabled.

Recommended fix in `createWindow()`, after the `loadFile` call:
```js
if (app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
            event.preventDefault();
        }
    });
} else {
    window.webContents.openDevTools();
}
```
Or more simply, set `devTools: false` inside `webPreferences` when `app.isPackaged` is true.

**🟡 Minor — `main.js`:139 — `sandbox` option is absent from `webPreferences`.**
Electron's renderer-process sandbox (`sandbox: true`) is not set. While `contextIsolation: true` and `nodeIntegration: false` mitigate most renderer-level risks, enabling `sandbox: true` provides an additional OS-level process isolation layer (Chromium sandbox). Its absence is low risk in this app because the renderer loads only local `file:` URLs and no remote content, but it is a missing defence-in-depth layer per current Electron security recommendations.

**🟢 Good — `preload.js`:1-335 — `contextBridge` is used correctly throughout.**
All renderer-facing APIs are exposed exclusively through `contextBridge.exposeInMainWorld('api', {...})`. No raw `require`, `fs`, `shell`, or the `ipcRenderer` object itself is exposed. Every method wraps `ipcRenderer.invoke()` in a thin arrow function, keeping the IPC surface properly encapsulated.

**🟡 Minor — `preload.js`:270-279 — Push-channel listener callbacks not validated.**
The `notifications.onToast` and `notifications.onCenterUpdate` methods (and `updater.onStatus` at line 287-291) accept a raw `callback` argument and register it directly with `ipcRenderer.on()`. There is no type-check that `callback` is a function before calling `ipcRenderer.on()`. If a renderer page passes a non-function (e.g. `undefined` due to a wiring bug), the error will surface as an obscure runtime crash in the main-process event dispatch rather than a clear preload-level failure. A one-line `if (typeof callback !== 'function') return;` guard would suffice.

**🟢 Good — `preload.js`:271, 276, 288 — Listener cleanup functions are returned.**
All three push-channel registrations (`onToast`, `onCenterUpdate`, `onStatus`) return a cleanup function that calls `ipcRenderer.removeListener()`. This prevents listener accumulation across page navigations — a common source of memory leaks in multi-page Electron apps.

**IPC channel count:** 34 namespaced groups, totalling approximately 120 individual channel methods exposed through `window.api`.

### Checklist
- [x] `contextIsolation: true` — **PASS** (`main.js`:146)
- [x] `nodeIntegration: false` — **PASS** (`main.js`:145)
- [x] `webSecurity: true` (not disabled) — **PASS** (option is absent from `webPreferences`, which means it defaults to `true`; it is not explicitly disabled anywhere)
- [ ] `sandbox: true` — **FAIL** (option is absent; sandbox is not enabled — `main.js`:144-148)
- [x] No raw `require`/`fs`/`shell` exposed in preload — **PASS** (`preload.js`:1-335)
- [ ] `devTools` disabled in production — **FAIL** (no `app.isPackaged` or `NODE_ENV` guard present — `main.js`:179)
- [x] `shell.openExternal()` inputs sanitized — **PASS** (`main.js`:38-48, protocol allowlist enforced)

### Summary
The process boundary is in solid shape for the two highest-priority controls: `contextIsolation` and `nodeIntegration` are both correctly configured, and `shell.openExternal()` has a well-implemented protocol allowlist with navigation guards. The two gaps — absence of `sandbox: true` and no DevTools production guard — are minor hardening items rather than exploitable vulnerabilities in this local-file-only deployment context, but both should be addressed before any public distribution release.
