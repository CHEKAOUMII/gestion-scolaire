# Research: Enhanced Toast Variants

**Branch**: `021-enhanced-toast-variants` | **Date**: 2026-03-31
**Phase**: 0 — Outline & Research

---

## Decision 1: Placement of new code within `notifications.js`

**Decision**: Add new functions inside the existing IIFE closure, after `renderToast`, before the `window.showToast = renderToast` assignment line. Attach variants as properties after that line.

**Rationale**: The existing file uses a single `(function(){ 'use strict'; ... })()` IIFE wrapper. All helpers (`formatRelativeTime`, `escapeHtml`, etc.) are private to that closure. The new helpers follow the same pattern. Attaching `window.showToast.loading` and `window.showToast.action` after `window.showToast = renderToast` (line 227) is the minimal additive change that preserves backward compatibility and matches the existing code style.

**Alternatives considered**:
- New separate file (`js/toast-variants.js`): Rejected — adds deployment surface (new `<script>` tag on 40+ pages) and creates a split point in a cohesive module. The plan scope is Phase 2 only; Phase 4 handles the script-tag rollout for `message-system.js` specifically.
- Overwrite `renderToast` to handle all types: Rejected — risks breaking existing callers that pass `type` as a string; violates the "no dead code / no breaking changes" principle.

---

## Decision 2: Deduplication strategy

**Decision**: Module-level variables `_lastToastMessage` (string) and `_lastToastTime` (timestamp). If the same message string is triggered within 2000ms, the new call returns a no-op handle without creating a DOM element.

**Rationale**: Stateless approach. No external state store. Works within the IIFE's private scope. The 2-second window is derived from the implementation plan and matches common UX patterns for debouncing rapid feedback.

**Alternatives considered**:
- Per-message Map with expiry: More precise for multi-message scenarios but adds complexity not warranted by the problem scope (single-user desktop app, not a high-concurrency system).
- CSS-based detection (check active toasts): Fragile — relies on DOM state rather than intent.

---

## Decision 3: Loading toast state machine

**Decision**: A boolean `dismissed` flag local to each `renderLoadingToast` call. All handle methods (`success`, `error`, `progress`, `dismiss`) guard on `if (dismissed) return;` before acting.

**Rationale**: Simple, correct, and idiomatic for the existing codebase. No class instances or prototype chains needed. The handle object is a plain object literal with closures — consistent with how `renderToast`'s auto-dismiss timeout already captures `toast` via closure.

**Alternatives considered**:
- Enum state machine (`LOADING | SUCCESS | ERROR | DISMISSED`): More expressive but overkill for a two-state guard (active vs dismissed).
- WeakMap keyed on DOM element: Unnecessary indirection when the closure already owns the state.

---

## Decision 4: Progress bar implementation

**Decision**: A `<div class="toast-progress-bar">` child inside the loading toast. Width set via `progressBar.style.width = percent + '%'`. CSS `transition: width 0.3s ease` handles animation. `.progress(percent)` clamps input to `[0, 100]` via `Math.max(0, Math.min(100, Number(percent) || 0))`.

**Rationale**: Pure CSS transition — no `requestAnimationFrame` loop, no external animation library. Matches the existing toast fade-out pattern (which also uses inline style transitions). The progress bar is removed on `.error()` (no progress bar for an error state) and set to 100% on `.success()`.

**Alternatives considered**:
- SVG circle progress: Disproportionate complexity for a toast-sized indicator.
- CSS animation with `animation-duration` set dynamically: Incompatible with caller-controlled progress updates (caller may not know total duration upfront).

---

## Decision 5: Action toast click handling

**Decision**: Event delegation on the toast element. A listener on `toast` checks `e.target.closest('.toast-action-btn')` — if hit, invoke callback then dismiss; if not, dismiss only. This prevents the action-button click from also triggering the outer body-dismiss path.

**Rationale**: Single listener, no need to re-attach on dynamic button content. Matches the existing delegation pattern used in `message-system.js`. `e.stopPropagation()` inside the action button listener is deliberately avoided — delegation on the same element is cleaner.

**Alternatives considered**:
- Separate listeners on button vs body: Requires `stopPropagation` on the button to prevent double-dismiss. More fragile under DOM changes.

---

## Decision 6: RTL close-button positioning

**Decision**: `.toast-close` uses `inset-inline-start: 6px` (logical property) instead of `left: 6px`. This places the close button on the right edge in RTL (Arabic) and left edge in LTR — matching the expected RTL UX where the dismiss affordance is on the reading-start side.

**Rationale**: Constitution III mandates logical CSS properties. Physical `left`/`right` in new code is prohibited.

**Alternatives considered**:
- `position: absolute; right: 6px`: Would put close button on the wrong side in RTL.
- Flex-based positioning: Would require restructuring toast layout beyond the scope of this feature.

---

## Decision 7: `_ensureToastContainer` extraction

**Decision**: Extract the toast-container creation logic from `renderToast` into a shared private helper `_ensureToastContainer()`. Both `renderToast` (existing) and the new variants call this helper.

**Rationale**: Eliminates code duplication in an additive-only way. The existing `renderToast` body is left structurally unchanged except for the container retrieval call, which is now a one-liner.

**Alternatives considered**:
- Duplicate the container logic in each new function: Creates maintenance risk and violates DRY within 3 functions in the same file.

---

## No NEEDS CLARIFICATION markers

All decisions above are fully resolved from:
1. The implementation plan (`docs/superpowers/plans/2026-03-31-message-system.md`)
2. The existing `js/notifications.js` code structure
3. The project constitution
