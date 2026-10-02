# Contract: Capture Port (repos ↔ change-tracking)

**Feature**: 027-layering-remediation  
**Consumers**: `main/repos/*`  
**Provider default**: `main/sync/capture.js` via `main/repos/capture-port.js`

## Purpose

Repos must record outbound change-tracking intent without importing the sync engine module graph. This contract freezes the injectable surface used by repositories.

## Module API

```js
// main/repos/capture-port.js (illustrative)

/** @typedef {object} CapturePort */
// Methods match existing capture.js exports used by repos.

function getCapturePort(): CapturePort;
function setRepoCapturePort(port: CapturePort | null): void; // null restores default
function createNoOpCapturePort(): CapturePort;
function createDefaultCapturePort(): CapturePort; // require('../sync/capture') binding

module.exports = {
    getCapturePort,
    setRepoCapturePort,
    createNoOpCapturePort,
    createDefaultCapturePort,
    // convenience: re-export bound functions that always use getCapturePort()
    captureInputUpserts,
    captureResolvedRows,
    captureDeletesFromRows,
    selectRowsBySchoolYear,
    deleteBySchoolYearWithCapture,
    capturePutsByIds,
    notifyCaptureCommitted
    // extend only when a repo extraction needs another capture helper
};
```

## Behavioral requirements

| Rule | Detail |
|------|--------|
| Default port | Production code path uses real capture without callers configuring anything |
| No-op port | Unit tests may set no-op; SQL mutations still apply; outbox tables may be absent |
| Atomicity | Callers must invoke capture helpers **inside** the same `db.transaction` as domain writes for bulk/explicit paths |
| `notifyCaptureCommitted` | Called **after** successful transaction commit (same as today) |
| Threading | Single-threaded Electron main / Node tests only |

## Compatibility

- `CHANNEL_REGISTRY` entries for explicit bulk channels remain `{ captureMode: 'explicit', exclude: true, … }`.
- Smoke registry completeness unchanged.
- `setCaptureGetDb` on real capture continues to work for capture unit tests; orthogonal to repo port.

## Non-goals

- Redesigning outbox schema
- Changing push debounce timing
- Making capture async
