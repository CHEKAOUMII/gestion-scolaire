# Implementation Plan: Loading Toast Variant

**Branch**: `022-loading-toast` | **Date**: 2026-03-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/022-loading-toast/spec.md`

## Summary

Extend `js/notifications.js` with a `showToast.loading()` variant that returns a lifecycle handle (`{ success, error, progress, dismiss }`), enabling callers to show a persistent spinner toast that transitions in-place to success or error. The feature is renderer-only — no IPC, no main-process changes, no new HTML pages.

> **Status note**: Core implementation (`renderLoadingToast`) already landed in commit `0d7a23d`. This plan covers the **verification, CSS completeness, and smoke-test gate** needed to formally close the feature.

---

## Technical Context

**Language/Version**: Vanilla JavaScript (ES5 IIFE pattern, matching existing `notifications.js`)
**Primary Dependencies**: Font Awesome icons (vendored), existing `_ensureToastContainer()` helper
**Storage**: N/A — ephemeral DOM only
**Testing**: `npm run test:smoke` (CI gate) + manual RTL visual check
**Target Platform**: Electron renderer process (Chromium, Windows)
**Project Type**: Desktop app — renderer-side UI module
**Performance Goals**: Toast appears within 100ms of call; transitions are CSS-driven (no jank)
**Constraints**: No bundler; no CDN; vanilla JS only; must pass `npm run lint` and `npm run test:smoke`
**Scale/Scope**: Single new function property on `window.showToast`; touches 1 JS file + 1 CSS source file

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Requirement | Status |
|-----------|-------------|--------|
| I — Code Quality | Prettier + ESLint must pass; camelCase; no dead code | PASS — existing code follows conventions; new code must match |
| I — Single responsibility | `notifications.js` owns all toast logic; no new file needed | PASS |
| II — CI gate | `npm run test:smoke` must pass after changes | PASS — feature is renderer-only; no IPC changes, no parity risk |
| II — No CDN | Font Awesome already vendored | PASS |
| II — Manual visual check | RTL + dark/light theme check required before merge | REQUIRED — developer must run `npm run dev` |
| III — RTL-first | Logical CSS properties; Arabic text in UI copy | PASS — `closeBtn` already uses `aria-label="إغلاق"` |
| III — Dark mode | `@variant dark` in `css/tailwind-input.css` | REQUIRED — toast variant CSS must include dark overrides |
| III — Consistent patterns | Feature extends `showToast`, not a parallel system | PASS |
| IV — No bundler | IIFE pattern, no `import`/`export` | PASS |
| IV — IPC contract | No new IPC channels; renderer-only | PASS — no `preload.js` or `main/ipc/` changes |
| V — CSS build time | One new CSS block in `tailwind-input.css` | PASS — minimal addition |

**No violations. No Complexity Tracking table needed.**

---

## Project Structure

### Documentation (this feature)

```text
specs/022-loading-toast/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
js/
└── notifications.js     # renderLoadingToast() — already implemented (lines 91–170)

css/
└── tailwind-input.css   # .toast.loading, .toast-progress-bar, .toast-close styles
                         # — needs audit; dark-mode overrides may be missing
```

---

## Phase 0: Research

### Findings

#### Finding 1: Implementation already exists

**Decision**: `renderLoadingToast` is fully implemented in `js/notifications.js` (lines 91–170, commit `0d7a23d`). `window.showToast.loading` is exposed at line 422.

**Rationale**: The plan document referenced in the original spec (`docs/superpowers/plans/2026-03-31-message-system.md`) was the source for the earlier implementation work.

**Alternatives considered**: Re-implementing from scratch — rejected; existing code already satisfies FR-001 through FR-009.

#### Finding 2: CSS completeness unknown

**Decision**: Audit `css/tailwind-input.css` for `.toast.loading`, `.toast-progress-bar`, `.toast-close` classes and their dark-mode counterparts before closing the branch.

**Rationale**: The JS is complete but the visual layer requires the matching CSS. Without it, the feature degrades silently (no spinner animation, no progress bar, close button unstyled).

**Alternatives considered**: Inline styles — rejected; constitution mandates all styles in `css/tailwind-input.css`.

#### Finding 3: Deduplication key differs from spec

**Decision**: Existing `_deduplicateToast` uses `(type, message)` as the key (line 72–79). Loading toasts are keyed as `('loading', message)`. This satisfies FR-007 (same message within 2 seconds → suppressed).

**Rationale**: The spec assumed a message-only key; the actual implementation adds a type dimension which is strictly more correct (prevents cross-variant false deduplication).

**Alternatives considered**: Message-only key — rejected; type-scoped key is better.

#### Finding 4: `resolved` flag protects against double-resolution

**Decision**: The handle tracks a `resolved` boolean (line 125) in addition to `dismissed`. Once `.success()` or `.error()` is called, neither can be called again. This satisfies FR-009.

**Rationale**: Prevents race conditions if a caller accidentally calls both `.success()` and `.error()`.

---

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](data-model.md).

### Contracts

See [contracts/loading-toast-handle.md](contracts/loading-toast-handle.md).

### Quickstart

See [quickstart.md](quickstart.md).
