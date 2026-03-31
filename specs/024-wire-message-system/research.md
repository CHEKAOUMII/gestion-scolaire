# Research: Wire Message System Across All Pages (024)

**Date**: 2026-03-31
**Phase**: Phase 0 — Codebase Research

---

## Decision 1: Timetable Duplicate Is Intentional — Scope Change Required

**Decision**: Do NOT remove the `showToast` function from `js/pages/timetable.js`. Instead, remove only the unused `timetableShowToast` alias at line 1842.

**Finding**: Line 1881 in `timetable.js` contains the comment:
> "Timetable has its own #toast element; keep local function but do NOT override window.showToast so the unified notification engine (js/notifications.js) continues to work for IPC-driven toasts."

The timetable page declares a dedicated `<div class="toast" id="toast"></div>` in `timetable.html` (line 483). The local `showToast` targets this element via `document.getElementById('toast')` and participates in `updateToastOffsets()` for layout positioning. The global notifications engine (`js/notifications.js`) uses a dynamically created `#toast-container` with appended `.toast` elements — a completely different mechanism.

Deleting the local function would break all 20+ `showToast(...)` call sites within `timetable.js` that rely on the `#toast` element.

**What IS safe to remove**: Line 1842 — `const timetableShowToast = showToast;` — this alias is assigned but never used anywhere in the file. It is dead code per constitution Principle I ("No dead code").

**Rationale**: Removing the alias eliminates the only genuine dead code without touching the intentional local implementation.

**Alternatives considered**: Remove the entire function and convert call sites to the global engine — rejected because it would require migrating the `#toast` HTML element, the `updateToastOffsets()` mechanism, and all 20+ call sites. This is a separate migration task beyond the scope of Phase 4.

---

## Decision 2: Pages Excluded From Script Rollout

**Decision**: Add `message-system.js` to 43 of 46 HTML files. Exclude 3 files.

**Finding**: 46 `.html` files exist in the repo root. Three have no shared script infrastructure:

| File | Reason to Exclude |
|------|-------------------|
| `timetable_body.html` | Contains zero `<script>` tags — appears to be a partial iframe/body fragment, not a standalone page |
| `communication-center-prototype.html` | Prototype file with no shared scripts |
| `login.html` | Has only `ux-enhancements.js` and its own `login.js` — does not yet use notifications or utils; adding the message system here is safe but low value |

**Rationale**: `timetable_body.html` has no script block at all — inserting a script tag into a bare body fragment is incorrect. The two prototypes (`communication-center-prototype.html`, `login.html`) are either not production pages or have no confirmation/toast patterns to adopt yet.

**Refined scope**: 43 pages receive the script tag. `login.html` inclusion is a judgment call — it does load `ux-enhancements.js`, and future login flows may need validation messages. **Recommendation: include `login.html`** after `ux-enhancements.js` since it is a real production page. This brings the total to 44 pages; `timetable_body.html` and `communication-center-prototype.html` are excluded.

---

## Decision 3: Script Tag Placement Rule

**Decision**: Insert `<script src="js/message-system.js" defer></script>` immediately after `<script src="js/notifications.js" defer></script>` on all pages that have it (43 pages). On `login.html` (which has only `ux-enhancements.js`), insert after that tag.

**Finding**: All 43 pages that include `notifications.js` follow the same pattern:
```html
<script src="js/utils.js" defer></script>
<script src="js/notifications.js" defer></script>
<!-- message-system.js goes here -->
<script src="js/ux-enhancements.js" defer></script>
```

No pages have `utils.js` without `notifications.js` in this codebase. The fallback rule from the spec (insert after `utils.js` if no `notifications.js`) applies only to `login.html`.

**Rationale**: Placing it after `notifications.js` ensures the global toast infrastructure is available if `message-system.js` ever needs to call `showToast` during initialisation (it currently does not, but defensive ordering is correct).

---

## Decision 4: No IPC or Main Process Changes Required

**Decision**: This phase is purely renderer-side HTML file edits and one JS line removal.

**Rationale**: `message-system.js` is a browser-side IIFE with no IPC calls. No `preload.js` or `main/ipc/*.js` changes are needed. The smoke test IPC parity check will not be affected.

---

## Decision 5: CSS Rebuild Not Required for This Phase

**Decision**: No `npm run css:build` needed for Phase 4.

**Rationale**: Phase 4 touches only `.html` files and one line in `timetable.js`. No CSS changes are introduced. The CSS changes for the message system were part of Phase 1.
