# Implementation Plan: Message System — Verification & Polish

**Branch**: `026-message-system-verification` | **Date**: 2026-04-01 | **Spec**: [spec.md](spec.md)

---

## Summary

Close two blocking gaps left from Phases 2–3 of the message system (missing CSS classes in `css/tailwind-input.css`, missing `showToast.loading`/`showToast.action` attachment in `js/notifications.js`), then execute the full Phase 6 verification pass: dark theme, RTL layout, keyboard navigation, toast variant lifecycle, error boundary flood protection, and settings-imports end-to-end flows. All CI gates must pass before branch merge.

---

## Technical Context

**Language/Version**: Vanilla JavaScript (ES5-compatible renderer code), Node.js 24 (main process)
**Primary Dependencies**: Electron, better-sqlite3, Tailwind CSS v4 (PostCSS), Font Awesome (vendored)
**Storage**: N/A — this feature involves no database reads or writes
**Testing**: Manual visual inspection via DevTools console + `npm run test:smoke` (CI gate)
**Target Platform**: Windows desktop (Electron), RTL Arabic UI
**Project Type**: Desktop app — multi-page HTML + vanilla JS, no bundler
**Performance Goals**: CSS build < 10 s; app startup < 3 s
**Constraints**: No new npm packages; no CDN references; no bundler; logical CSS properties only (RTL-first)
**Scale/Scope**: 44 HTML pages already have `message-system.js` script tag; ~150 lines of CSS to add

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Requirement | Status |
|-----------|-------------|--------|
| I — Formatting | Prettier: single quotes, 4-space indent, 120-char, semicolons | ✅ No new JS logic; CSS follows existing style |
| I — Naming | camelCase JS, snake_case DB, kebab-case IPC | ✅ No new names introduced |
| I — No dead code | Remove unused functions/blocks | ✅ Gap-close adds code, removes nothing |
| II — CI gate | `npm run lint` + `npm run css:build` + `npm run test:smoke` must pass | ✅ Gated as final step |
| II — No CDN | All vendor libs in `vendor/` | ✅ Font Awesome already vendored; no new deps |
| II — Manual visual check | RTL + both themes before commit | ✅ Explicit verification steps 4a–4b |
| III — RTL-first | Logical CSS properties (`ps-*`, `pe-*`, `start-*`) | ✅ Plan CSS uses logical properties; `left`/`right` prohibited |
| III — Dark mode | `@variant dark` / `[data-theme="dark"]` overrides | ✅ CSS blocks include dark-theme overrides |
| III — Consistent patterns | `showToast()` is the shared utility; no duplicates | ✅ Adding variants to existing `showToast`, not bypassing it |
| III — Accessibility | Keyboard navigable, ARIA attributes, WCAG AA contrast | ✅ Focus trap, `aria-modal`, `aria-invalid` already in `message-system.js` |
| IV — No bundler | Vanilla JS, multi-page HTML | ✅ No bundler introduced |
| IV — IPC contract | No new IPC channels | ✅ Renderer-side only; `preload.js` untouched |
| V — CSS build < 10 s | Adding ~150 lines CSS | ✅ Well within budget |

**No violations. All gates pass.**

---

## Project Structure

### Documentation (this feature)

```text
specs/026-message-system-verification/
├── plan.md          ← this file
├── spec.md          ← feature specification
├── research.md      ← Phase 0: implementation state audit + decisions
├── data-model.md    ← Phase 1: runtime entities + CSS class inventory
├── quickstart.md    ← Phase 1: step-by-step verification guide
├── checklists/
│   └── requirements.md
└── tasks.md         ← Phase 2 output (/speckit.tasks — not yet created)
```

### Source Code (affected files)

```text
css/
└── tailwind-input.css      ← ADD: ~150 lines of .msg-confirm-*, .field-validation-*, toast variant CSS

js/
├── message-system.js       ← EXISTS ✅ (380 lines — no changes needed)
├── notifications.js        ← ADD: renderLoadingToast, renderActionToast, _ensureToastContainer functions
│                              CHANGE: line 227 — attach .loading and .action to window.showToast
│                              ADD: click-to-dismiss on base renderToast
└── utils.js                ← EXISTS ✅ (error boundary present — no changes needed)

settings-imports.html       ← EXISTS ✅ (message-system.js script tag present, old overlay removed)
js/pages/settings-imports.js ← EXISTS ✅ (showConfirm() wired at 4 call sites)
```

**Structure Decision**: Single-project vanilla JS desktop app. No new files are created — all changes are additive edits to existing files, plus the verification exercise itself.

---

## Phase 0: Research Output

See [research.md](research.md) for full findings. Key decisions:

1. **Gap-close before verify**: CSS and toast variants must be added before any Phase 6 test can pass. The plan gates verification tests behind these prerequisites.
2. **Manual visual inspection**: No automated visual regression tooling is introduced. Constitution § II mandates a manual RTL visual check before commit.
3. **DevTools console as test harness**: All five verification areas can be exercised by calling `showConfirm()`, `showToast.*()`, and `throw` from DevTools on a running `npm start` instance.
4. **`@variant dark` for dark overrides**: CSS additions use `[data-theme='dark']` selector which maps to the project's `@variant dark` Tailwind v4 mechanism.

---

## Phase 1: Design Output

See [data-model.md](data-model.md) and [quickstart.md](quickstart.md).

**No contracts directory** — this feature adds no public APIs, IPC channels, or external interfaces.

**Runtime entities** (transient, no persistence):
- `_activeConfirm` — singleton confirm dialog slot (overlay + resolve + inputEl)
- Toast handle — returned by `showToast.loading()`, exposes `.success()/.error()/.progress()/.dismiss()`
- Error boundary counters — throttle timestamp + flood window state in `js/utils.js`

**CSS gap summary** (20 classes missing, all in `css/tailwind-input.css`):
- Confirm dialog: `.msg-confirm-overlay`, `.msg-confirm-card`, `.msg-confirm-header.*`, `.msg-confirm-title`, `.msg-confirm-close`, `.msg-confirm-body`, `.msg-confirm-message`, `.msg-confirm-detail`, `.msg-confirm-input`, `.msg-confirm-actions`
- Inline validation: `.field-validation`, `.field-validation.visible`, `.field-validation.error/warning/success`, `.field-invalid`, `.field-warning`, `.field-valid`
- Toast variants: `.toast.loading`, `.toast-progress-bar`, `.toast-action-btn`, `.toast-close`

---

## Complexity Tracking

*No constitution violations — this section is empty.*
