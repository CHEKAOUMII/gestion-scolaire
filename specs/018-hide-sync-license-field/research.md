# Research: Hide License Key Field from Sync Settings UI

**Feature**: `018-hide-sync-license-field`
**Date**: 2026-03-26

## Overview

This feature is a straightforward UI cleanup with no unknowns. No external research was required — all decisions are informed by the existing codebase and the parent plan.

## Decisions

### 1. Hiding Mechanism

**Decision**: Use the HTML `hidden` attribute on the wrapper `<div>`.

**Rationale**: The `hidden` attribute is the semantic HTML standard for hiding elements. It is simpler and more readable than adding a Tailwind `hidden` class, and communicates intent clearly. The element remains in the DOM for `loadConfig()` to populate harmlessly.

**Alternatives considered**:
- Tailwind `hidden` class — functionally equivalent (`display: none`) but less semantic; the `hidden` attribute is more explicit about intent.
- CSS `display: none` inline style — less maintainable, harder to spot in code review.
- Deleting the HTML entirely — violates FR-002 (keep element for potential future re-enablement).

### 2. Save Logic Removal Strategy

**Decision**: Remove the two lines that read and include the license key in the save payload entirely (line 345 and line 382 in `js/pages/settings-sync.js`).

**Rationale**: Simply removing the lines is cleaner than commenting them out or adding conditional guards. The hidden field would always contain the current auto-managed value (set by `loadConfig()`), so sending it back is unnecessary and creates an accidental overwrite risk.

**Alternatives considered**:
- Commenting out the lines — violates constitution principle I (no dead code).
- Adding a conditional check (`if (!hidden)`) — over-engineered for a permanently hidden field.
- Keeping the lines — risk of overwriting auto-managed key on save.

### 3. Load Logic Retention

**Decision**: Keep `setVal('cfg-license-key', config.licenseKey || '')` in `loadConfig()` (line 321).

**Rationale**: Per spec FR-004, the load operation MAY continue populating the hidden field. Removing it would be unnecessary churn with no functional benefit. The hidden field having a value causes no side effects.

## Dependencies Verified

- **Feature 1** (auto-save paid key): Already landed on branch `017-auto-sync-trial-key` — the `activateLicense()` function saves the key to `sync_config.license_key`.
- **Feature 2** (auto-generate trial key): In progress on the same branch — `ensureTrialSyncKey()` handles trial key generation at startup.
- Both features ensure `sync_config.license_key` is reliably populated before this UI cleanup ships.
