# Implementation Plan: Message System Foundation — CSS + Core API

**Branch**: `020-message-system-foundation` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/020-message-system-foundation/spec.md`

## Summary

Create `js/message-system.js` — a self-contained vanilla JS IIFE module exposing three global functions (`showConfirm`, `setFieldValidation`, `clearValidation`) — and add all required CSS classes to `css/tailwind-input.css`. The module replaces native `confirm()` dialogs with a Promise-based, RTL-aware, keyboard/ARIA-accessible confirmation dialog, and adds animated inline field validation. No IPC, no bundler, no new npm packages. All styles use existing design tokens and compile via `npm run css:build`.

## Technical Context

**Language/Version**: Vanilla JavaScript (ES2019+, no modules/bundler), CSS via Tailwind CSS v4 PostCSS pipeline
**Primary Dependencies**: Font Awesome (vendored), existing `js/ux-enhancements.js` (`openDialog`/`closeDialog`) — optional graceful degradation if absent
**Storage**: N/A — renderer-only, no DB or IPC changes
**Testing**: Manual via DevTools console + `npm run test:smoke` (CSS build + lint gates); no automated UI test suite
**Target Platform**: Electron renderer process (Chromium-based), Windows desktop
**Project Type**: Desktop app — multi-page HTML, vanilla JS, no bundler
**Performance Goals**: Dialog animation completes in ≤200ms; no measurable DOM overhead (single overlay element lifecycle)
**Constraints**: Zero new npm packages; zero CDN references (smoke test enforces this); must pass `npm run lint` and `npm run css:build`; IIFE pattern (no ES modules)
**Scale/Scope**: One new JS file (~250 lines), one CSS section addition (~120 lines); touches no IPC, no DB, no main process

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| **I — Formatting** | New JS must pass Prettier (single quotes, 4-space indent, 120-char width, semicolons) | ✅ Plan complies — IIFE uses `var` and function declarations matching existing renderer style |
| **I — Linting** | ESLint renderer rules apply (`no-undef` off, relaxed). No `no-unused-vars` violations. | ✅ All exported symbols attached to `window.*`; no dead code |
| **I — Naming** | Functions: camelCase (`showConfirm`, `setFieldValidation`). Internal: camelCase. CSS classes: BEM-ish kebab (`msg-confirm-overlay`). | ✅ |
| **I — Single responsibility** | `js/message-system.js` owns confirmations + validation only. Does not duplicate `showToast` or `openDialog`. | ✅ |
| **II — CI gate** | `npm run css:build` must succeed with new CSS. `npm run lint` must pass. `npm run test:smoke` must pass (no new IPC channels, no CDN refs). | ✅ No new channels, no CDN |
| **II — No CDN** | Font Awesome already vendored. No external script loads. | ✅ |
| **III — RTL-first** | Dialog uses logical CSS (`padding-inline`, `gap`); physical `left`/`right` avoided in new classes. Toast close button already uses `left: 6px` in plan spec — **MUST use `inset-inline-start: 6px` instead**. | ⚠️ Corrected in design (see research.md) |
| **III — Arabic typography** | All user-facing strings default to Arabic. Config allows override. | ✅ |
| **III — Consistent interactions** | `showConfirm` calls `openDialog`/`closeDialog` from `ux-enhancements.js` for focus trap — does not duplicate. Graceful fallback if absent. | ✅ |
| **III — Dark mode** | All new CSS classes use `var(--color-*)` tokens. Dark overrides use `[data-theme='dark']` selector (not `@media prefers-color-scheme`). | ✅ |
| **III — Accessibility** | `role="alertdialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`, `aria-invalid`, `aria-hidden` used correctly. | ✅ |
| **IV — No IPC** | Pure renderer module. No `window.api` calls, no `ipcRenderer`. | ✅ |
| **IV — No bundler** | IIFE wrapped in `(function(){ 'use strict'; ... })()`. Loaded via `<script defer>` tag. | ✅ |
| **IV — Vendor isolation** | No new vendored libraries introduced. | ✅ |
| **V — CSS build time** | Adding ~120 lines of plain CSS to `tailwind-input.css` has negligible build-time impact. | ✅ |

**Post-design re-check**: ✅ All gates pass after RTL correction noted in research.md.

## Project Structure

### Documentation (this feature)

```text
specs/020-message-system-foundation/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── contracts/
│   └── global-api.md   ← Phase 1 output
└── tasks.md             ← Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
js/
└── message-system.js       ← NEW: showConfirm, setFieldValidation, clearValidation

css/
└── tailwind-input.css      ← MODIFIED: 3 new @layer components blocks appended
```

**Structure Decision**: Single-file renderer module. No new directories. Follows the established pattern of `js/utils.js`, `js/notifications.js` — global IIFE, exported via `window.*`, loaded via `<script defer>` in HTML pages.

## Complexity Tracking

*No constitution violations requiring justification.*
