# Research: Message System Foundation — CSS + Core API

**Branch**: `020-message-system-foundation` | **Date**: 2026-03-31

## Questions Resolved

### R-001: RTL directional properties in new CSS classes

**Decision**: Use logical CSS properties throughout all new classes.

**Rationale**: Constitution §III explicitly prohibits physical `left`/`right` in new code. The plan spec draft included `.toast .toast-close { left: 6px }` — this MUST be `inset-inline-start: 6px` instead. Similarly, `border-right-color` on `.toast.loading` must become `border-inline-end-color`. All `padding-left`/`padding-right` become `padding-inline-start`/`padding-inline-end`.

**Alternatives considered**: Physical properties — rejected (constitution violation).

---

### R-002: IIFE pattern vs ES module

**Decision**: IIFE (`(function(){ 'use strict'; ... })()`), exported via `window.*`.

**Rationale**: The project uses no bundler (constitution §IV). Every existing renderer JS file — `utils.js`, `notifications.js`, `ux-enhancements.js` — uses either IIFE or bare script. ES `import/export` requires a bundler or `type="module"` which conflicts with `defer` ordering and the existing pattern. The smoke test would flag any deviation from the established file structure.

**Alternatives considered**: ES modules — rejected (no bundler, incompatible with existing script loading pattern).

---

### R-003: openDialog() / closeDialog() integration boundary

**Decision**: Call `openDialog(overlay, { contentSelector: '.msg-confirm-card', initialFocus, onCloseRequest })` when available; fall back to `requestAnimationFrame` focus if `openDialog` is not defined.

**Rationale**: `openDialog` (from `js/ux-enhancements.js`) provides: focus trap via Tab/Shift+Tab, Escape key handling, focus restoration on close, and `aria-hidden` toggling. These are exactly what `showConfirm` needs. Using it avoids duplicating ~80 lines of focus-trap logic. The fallback covers pages that don't load `ux-enhancements.js` (currently none, but defensively required per spec edge cases).

**Key finding**: `openDialog` signature is `openDialog(dialog, options)` where `options.initialFocus` accepts a CSS selector string or HTMLElement, `options.onCloseRequest` is the cancel callback, and `options.contentSelector` identifies the focusable card within the overlay. `closeDialog(dialog)` restores focus to the previously active element automatically — `showConfirm` must NOT call `closeDialog` after the overlay is already removed from DOM.

**Alternatives considered**: Duplicate focus-trap implementation — rejected (dead code violation, constitution §I).

---

### R-004: Dark theme mechanism

**Decision**: Use `[data-theme='dark'] .msg-confirm-*` selector pattern, matching the project's existing dark theme system.

**Rationale**: The `@variant dark` in `css/tailwind-input.css` is defined as targeting `[data-theme="dark"]` on the document root. All existing dark overrides follow this pattern. Using `@media (prefers-color-scheme: dark)` would diverge from the project's deliberate manual theme toggle.

**Alternatives considered**: `@media prefers-color-scheme` — rejected (conflicts with manual theme toggle).

---

### R-005: CSS class insertion point in tailwind-input.css

**Decision**: Append all three new CSS blocks (confirm dialog, inline validation, toast variants) at the end of the `@layer components {}` block, after existing component definitions.

**Rationale**: Tailwind v4 compiles `@layer components` blocks in source order. Appending at the end avoids any cascade conflict with existing classes and is the simplest, least-risky insertion point. The existing pattern (e.g., import-confirm styles) follows the same approach.

**Alternatives considered**: Separate `@layer` block — unnecessary, same specificity, added complexity.

---

### R-006: Singleton confirm dialog guard

**Decision**: Use a module-level `_activeConfirm` variable. Calling `showConfirm()` while one is active calls `_resolveConfirm(false)` synchronously before opening the new one.

**Rationale**: FR-008 requires only one dialog at a time. Synchronous resolution ensures the first caller's Promise settles before the second dialog appears, preventing race conditions. The 200ms CSS transition still plays for the outgoing dialog (cosmetic only — the Promise is already resolved).

**Alternatives considered**: Queue-based approach — rejected (over-engineering; the app never needs queued confirmations).

---

### R-007: Validation message deduplication strategy

**Decision**: `setFieldValidation` calls an internal `_clearFieldValidation(field)` first, then inserts the new message. Detection of an existing message uses `field.nextElementSibling?.classList.contains('field-validation')`.

**Rationale**: Inserting via `parentNode.insertBefore(div, field.nextSibling)` places the message immediately after the field in DOM order. Checking `nextElementSibling` is O(1) and reliable given this insertion contract. Re-calling `setFieldValidation` replaces rather than accumulates (FR-011).

**Edge case confirmed**: If a field has other siblings between it and the validation div (e.g., a hint span), `nextElementSibling` check would miss it. **Mitigation**: The validation div is given a unique `id` and stored as `field.dataset.validationId`, allowing direct lookup via `document.getElementById`. This is the implementation approach.

**Alternatives considered**: `querySelectorAll('.field-validation')` on parentNode — rejected (would remove validation from sibling fields).

---

### R-008: `_escHtml` XSS safety

**Decision**: Use `div.textContent = str; return div.innerHTML` pattern for HTML escaping all user-provided strings inserted into the dialog (title, message, detail, placeholder, button labels).

**Rationale**: Dialog config values come from developer-controlled call sites (not end-user input directly), but using `innerHTML` with unescaped strings would still be an XSS vector if config is ever constructed from DB data. The textContent/innerHTML round-trip is a well-established safe escaping pattern with zero dependencies.

**Alternatives considered**: Template literal with manual escape — rejected (error-prone). DOMPurify — rejected (no new vendor libraries per constitution).
