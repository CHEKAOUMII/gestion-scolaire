# Research: Message System — Verification & Polish

**Branch**: `026-message-system-verification` | **Date**: 2026-04-01

---

## Implementation State Audit

### Decision: Treat Phase 6 as a gated verification pass

**Rationale**: Before running the Phase 6 test checklist, the plan must first confirm
which Phase 1–5 artifacts are actually present. This audit (run at plan time) determines
the true starting state.

**Findings**:

| Artifact | Expected | Actual State |
|----------|----------|--------------|
| `js/message-system.js` | Created | ✅ Present (380 lines) |
| `showConfirm()` wired in `settings-imports.js` | ✅ | ✅ Confirmed (4 call sites) |
| Error boundary in `js/utils.js` | ✅ | ✅ Confirmed (`_floodStopped` logic present) |
| `message-system.js` script tag in `settings-imports.html` | ✅ | ✅ Confirmed (line 14) |
| `showToast.loading` / `showToast.action` on `window.showToast` | Expected | ❌ NOT FOUND in `js/notifications.js` |
| `.msg-confirm-overlay`, `.field-validation`, `.toast-progress-bar` CSS | Expected | ❌ NOT FOUND in `css/tailwind-input.css` |
| Old `import-confirm-overlay` HTML removed from `settings-imports.html` | Expected | ✅ Absent (clean) |

**Alternatives considered**: Running Phase 6 tests against the current state. Rejected —
two blocking gaps (CSS missing, toast variants missing) would cause test failures unrelated
to Phase 6 logic. The plan gates Phase 6 testing behind a brief Phase 5.5 gap-close step.

---

## Verification Approach Decisions

### Decision: Manual visual inspection for theme and RTL

**Rationale**: The project has no automated visual regression tooling. The constitution
(§ II) explicitly requires manual RTL visual checks before committing UI changes.
Automated contrast scanners are not part of the CI pipeline.

**Alternatives considered**: Introducing an automated a11y scanner (e.g., axe-core).
Rejected — adds a new dependency, spec marks screen-reader testing as optional, and
the constitution discourages new npm dependencies without justification.

---

### Decision: Browser DevTools console as the test harness for Phase 6

**Rationale**: All five verification areas (theme, RTL, keyboard, toast lifecycle,
error boundary) can be exercised by triggering `showConfirm()`, `showToast.*()`, and
`throw` from the DevTools console on a running `npm start` instance. No new test
infrastructure is required.

**Alternatives considered**: Adding unit tests. Rejected — this is a UI/visual/behavioral
verification pass. The existing smoke test (`npm run test:smoke`) covers structural
integrity. A runtime visual pass is the appropriate tool here.

---

### Decision: CSS build must be run before any visual verification

**Rationale**: The `.msg-confirm-*`, `.field-validation`, and toast variant CSS classes
do not exist in `css/tailwind-output.css` yet (they are absent from
`css/tailwind-input.css`). All visual tests will fail until the CSS source is populated
and rebuilt. This is the first blocking prerequisite.

---

### Decision: `showToast.loading` and `showToast.action` must be attached before toast lifecycle tests

**Rationale**: `js/notifications.js` currently only exposes `window.showToast = renderToast`.
The `renderLoadingToast` and `renderActionToast` functions and their attachment as
`window.showToast.loading` / `window.showToast.action` are absent. Toast variant tests
(User Story 4) cannot run until this is in place.

---

## Constitution Compliance Notes

- **RTL-first (§ III)**: The confirm dialog uses `justify-content: flex-end` which in RTL
  naturally places Confirm on the left. Logical CSS properties must be used for any
  padding/margin in CSS additions. Physical `left`/`right` are prohibited in new code.
- **Dark mode (§ III)**: The `[data-theme='dark']` overrides in the CSS block must be
  authored using `@variant dark` (the project's Tailwind v4 mechanism), not bare
  attribute selectors in new component blocks.
- **CSS build gate (§ II, § V)**: `npm run css:build` must complete under 10 seconds.
  Adding ~150 lines of source CSS is well within that budget.
- **No CDN (§ IV)**: No new external resources are introduced. All icons are Font Awesome
  (already vendored). No new npm packages needed.
