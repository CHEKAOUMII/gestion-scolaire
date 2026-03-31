# Implementation Plan: Enhanced Toast Variants

**Branch**: `021-enhanced-toast-variants` | **Date**: 2026-03-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/021-enhanced-toast-variants/spec.md`

## Summary

Extend `js/notifications.js` with two new toast variants — `showToast.loading()` (returns a stateful handle with `.success()`, `.error()`, `.progress()`, `.dismiss()`) and `showToast.action()` (inline action-button toast) — plus a click-to-dismiss enhancement on all existing toasts. All changes are renderer-side only, additive, and require CSS additions to `css/tailwind-input.css`.

## Technical Context

**Language/Version**: Vanilla JavaScript (ES5-compatible IIFE pattern, matching existing codebase)
**Primary Dependencies**: Font Awesome icons (vendored), existing `showToast` / `renderToast` in `js/notifications.js`
**Storage**: N/A — no persistence required
**Testing**: `npm run test:smoke` (CI gate) + manual RTL visual check per constitution
**Target Platform**: Electron renderer process (Chromium), Windows desktop
**Project Type**: Desktop app (multi-page HTML, no bundler)
**Performance Goals**: Toast appearance within one rendered frame; CSS build under 10 seconds
**Constraints**: No CDN references; no new npm dependencies; must not break existing `window.showToast` signature; CSS compiled via `npm run css:build`
**Scale/Scope**: Single file modification (`js/notifications.js`) + CSS additions; affects all 40+ HTML pages at runtime through the shared script

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I — Prettier formatting | All new JS uses single quotes, 4-space indent, no trailing commas, 120-char width, semicolons | PASS |
| I — ESLint (relaxed renderer rules) | Renderer JS has relaxed rules; `no-unused-vars` off — new vars follow existing patterns | PASS |
| I — No dead code | Existing `renderToast` unchanged; new functions are strictly additive | PASS |
| II — `npm run test:smoke` must pass | No IPC changes; no new CDN refs; CSS build touched but no breaking changes | PASS |
| II — No CDN references | Font Awesome already vendored; no new external refs | PASS |
| II — Manual RTL visual check | Required before merge (constitutionally mandated for all UI changes) | REQUIRED |
| III — RTL-first layout | CSS uses logical properties; close button position uses `inset-inline-start` | PASS |
| III — Arabic text | All user-facing strings already in Arabic in spec; implementation must preserve this | PASS |
| III — Dark mode | New CSS classes need `[data-theme="dark"]` overrides in `css/tailwind-input.css` | REQUIRED |
| III — Consistent interaction pattern | New variants attach to existing `window.showToast` global — no bypass | PASS |
| IV — No IPC changes | Pure renderer-side; no `preload.js` or `main/ipc/` touches | PASS |
| IV — No bundler | Plain JS IIFE added inside existing IIFE wrapper | PASS |
| V — CSS build under 10s | Additions are minimal; no utility explosion | PASS |

**Post-design re-check**: No violations found. No complexity justification table needed.

## Project Structure

### Documentation (this feature)

```text
specs/021-enhanced-toast-variants/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
js/
└── notifications.js     # MODIFY — add renderLoadingToast, renderActionToast,
                         #          _ensureToastContainer, _deduplicateToast helpers;
                         #          attach as window.showToast.loading / .action;
                         #          add click-to-dismiss on renderToast

css/
└── tailwind-input.css   # MODIFY — add .toast.loading, .toast-progress-bar,
                         #          .toast-action-btn, .toast-close CSS classes
                         #          + dark theme overrides
```

**Structure Decision**: Single-project, no new files. All changes are additive modifications to two existing files. The IIFE in `notifications.js` is extended internally — new functions are defined inside the existing closure and attached as properties on `window.showToast` after the existing `window.showToast = renderToast` assignment.
