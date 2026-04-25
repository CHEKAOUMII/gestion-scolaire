# Research: Loading Toast Variant

**Branch**: `022-loading-toast` | **Date**: 2026-03-31

## Finding 1: Core Implementation Already Complete

**Decision**: `renderLoadingToast()` is fully implemented in [js/notifications.js](../../js/notifications.js) (lines 91–170), exposed as `window.showToast.loading` at line 422. Landed in commit `0d7a23d`.

**Rationale**: The earlier message-system plan (`docs/superpowers/plans/2026-03-31-message-system.md`) was already executed. The JS fully satisfies FR-001 through FR-009.

**Alternatives considered**: Re-implementing from scratch — rejected; existing code is correct and complete.

---

## Finding 2: CSS Layer Is Also Present and Correct

**Decision**: All required CSS classes are present in `css/tailwind-input.css` — `.toast.loading` (lines 8015–8018), `.toast.loading i.fa-spinner` (8020–8022), `.toast .toast-progress-bar` (8024–8035), `.toast .toast-close` (8054–8071), and dark-mode override `[data-theme='dark'] .toast.loading` (8073–8075). No CSS gaps exist.

**Rationale**: Grep of the compiled source confirmed all classes. The dark-mode override uses `rgba(59, 106, 197, 0.15)` which provides correct low-opacity blue on dark backgrounds.

**Alternatives considered**: Adding additional dark-mode rules — not needed; coverage is complete.

---

## Finding 3: Deduplication Key Is Type-Scoped

**Decision**: `_deduplicateToast('loading', message)` — loading toasts deduplicate on the combination of type + message within 2 seconds. This is strictly correct.

**Rationale**: Type-scoped key prevents cross-variant false deduplication (e.g., a `loading` toast and an `action` toast with the same message text do not interfere with each other).

**Alternatives considered**: Message-only key — rejected; type-scoped is more precise and already implemented.

---

## Finding 4: `resolved` Flag Prevents Double-Resolution

**Decision**: Handle tracks both `dismissed` (bool) and `resolved` (bool). `.success()` and `.error()` check both before acting. Once either is called, neither can be called again. `.progress()` also respects both flags.

**Rationale**: Prevents race conditions when callers accidentally invoke `.success()` and `.error()` in quick succession or after a manual dismiss. Satisfies FR-009 completely.

**Alternatives considered**: Single `dismissed` flag — sufficient for dismiss-only protection but insufficient for double-resolution guard. Current two-flag approach is correct.

---

## Finding 5: `border-inline-end` Used for RTL Compliance

**Decision**: `.toast.loading` uses `border-inline-end: 3px solid var(--color-primary)` — a logical CSS property — rather than `border-right`. This satisfies Constitution §III RTL-first requirement.

**Rationale**: In an RTL document, `inline-end` maps to the visual left, which is the correct accent-border side for Arabic layout.

**Alternatives considered**: `border-right` — prohibited by constitution for new code.

---

## Summary: What Remains

The implementation is complete. The only remaining work is:

1. **Verification gate**: Manual RTL + dark/light visual check (`npm run dev`) per Constitution §II.
2. **Smoke test**: `npm run test:smoke` must pass (trivially, since no IPC changes were made).
3. **CSS rebuild**: `npm run css:build` to confirm no regressions.
