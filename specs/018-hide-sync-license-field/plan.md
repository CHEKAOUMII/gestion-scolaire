# Implementation Plan: Hide License Key Field from Sync Settings UI

**Branch**: `018-hide-sync-license-field` | **Date**: 2026-03-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/018-hide-sync-license-field/spec.md`

## Summary

Hide the `cfg-license-key` input field from the sync settings form since the license key is now auto-managed (by Features 1 & 2). The wrapper `<div>` containing the label and input gets a `hidden` attribute (not deleted). The form save logic stops reading and sending the license key value, ensuring the auto-managed key in the database is never overwritten by form submissions. The load logic may continue populating the hidden field harmlessly.

## Technical Context

**Language/Version**: JavaScript (ES2020), HTML5, Tailwind CSS v4
**Primary Dependencies**: Electron (main + renderer), better-sqlite3, Tailwind CSS
**Storage**: SQLite (`sync_config` table — `license_key` column, auto-managed)
**Testing**: `npm run lint` + `npm run test:smoke` (IPC parity, no CDN refs, Tailwind output)
**Target Platform**: Windows desktop (Electron)
**Project Type**: Desktop app (Electron, multi-page HTML, vanilla JS)
**Performance Goals**: N/A — no performance-sensitive changes
**Constraints**: RTL (Arabic) layout must remain intact; no new dependencies
**Scale/Scope**: 2 files modified (`settings-sync.html`, `js/pages/settings-sync.js`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applicable? | Status | Notes |
|-----------|-------------|--------|-------|
| I. Code Quality & Consistency | Yes | PASS | Changes follow Prettier/ESLint conventions. No dead code introduced — hidden HTML preserved per spec requirement. |
| II. Testing Standards | Yes | PASS | `npm run lint` + `npm run test:smoke` will validate. No new IPC channels. Manual RTL visual check required. |
| III. User Experience Consistency | Yes | PASS | RTL layout preserved. No new UI patterns introduced. Hiding a field reduces complexity for admin. |
| IV. Good Practices & Architecture | Yes | PASS | No IPC changes. No bundler changes. Renderer-only modifications. Three-file rule N/A (no new IPC). |
| V. Performance Requirements | No | N/A | No performance-sensitive changes. |
| Security & Data Integrity | Yes | PASS | Removing license key from save payload *improves* security — prevents accidental overwrites of auto-managed key. |
| Development Workflow | Yes | PASS | Work on dedicated branch. Pre-merge checklist applies. |

**Gate result**: PASS — no violations. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/018-hide-sync-license-field/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (files to modify)

```text
settings-sync.html           # Add hidden attribute to license key wrapper div (lines 198-210)
js/pages/settings-sync.js    # Remove licenseKey from save payload (lines 345, 382)
```

**Structure Decision**: No new files or directories. Two existing files are modified in-place. This is a pure UI cleanup — no structural changes to the project.

## Complexity Tracking

No constitution violations. This section is intentionally empty.

## Change Details

### 1. settings-sync.html (lines 198–210)

**What**: Add `hidden` attribute to the `<div>` wrapping the license key label and input.

**Before** (line 198):
```html
<div>
    <label for="cfg-license-key" ...>مفتاح الترخيص</label>
    <input type="text" id="cfg-license-key" ... />
</div>
```

**After**:
```html
<div hidden>
    <label for="cfg-license-key" ...>مفتاح الترخيص</label>
    <input type="text" id="cfg-license-key" ... />
</div>
```

**Rationale**: The `hidden` attribute is the simplest, most semantic way to hide the element. It preserves the DOM structure for `loadConfig()` to continue populating the value harmlessly, and allows easy re-enablement by removing the attribute.

### 2. js/pages/settings-sync.js — initConfigForm() (lines 345, 382)

**What**: Remove the two lines that read the license key from the form and add it to the save payload.

**Remove line 345**:
```js
const licenseKey = document.getElementById('cfg-license-key')?.value?.trim() || null;
```

**Remove line 382**:
```js
if (licenseKey !== null) updates.licenseKey = licenseKey;
```

**Rationale**: With the field hidden, the value would always be whatever `loadConfig()` set it to (the current auto-managed key). Sending it back on save is at best a no-op and at worst an accidental overwrite vector. Removing these lines ensures the save payload never touches `license_key`.

### 3. js/pages/settings-sync.js — loadConfig() (line 321)

**What**: Keep as-is.

```js
setVal('cfg-license-key', config.licenseKey || '');
```

**Rationale**: Per FR-004, the load operation MAY continue populating the hidden field. This is harmless and maintains data flow consistency. Removing it would be unnecessary churn.

## Verification Plan

1. `npm run lint` — zero errors
2. `npm run css:build` — succeeds (no CSS changes, but part of CI gate)
3. `npm run test:smoke` — passes (no IPC changes)
4. Manual check: open sync settings page → license key field is invisible
5. Manual check: save sync settings → succeeds, no errors
6. Manual check: verify `sync_config.license_key` in DB is unchanged after save
7. Manual check: RTL layout has no gaps where the field was
