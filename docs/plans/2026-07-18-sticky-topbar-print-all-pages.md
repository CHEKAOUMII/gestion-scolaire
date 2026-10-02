# Investigation: Sticky Top-Bar Print Preview Across All Pages

## Goal of this document

You already moved **معاينة الطباعة** into the sticky shell bar on **التوجيه المدرسي**. This note maps the rest of the app and compares **possible approaches** before a full rollout. It is an options analysis, not an implementation plan yet.

Reference implementation (done):

- `js/shared/orientation-topbar-print.js` — mount/move into `.header.dashboard-topbar .header-right` after `setupUnifiedHeader`
- `js/pages/students-orientation.js` — `mountOrientationTopBarPrint(openPrintPreview)` + retry until unified header exists
- `students-orientation.html` — static `#print-btn` as relocation source (or create if missing)

## Hard constraint (all approaches must respect this)

`setupUnifiedHeader()` in `js/utils.js` **rebuilds** `main > .header` with `innerHTML` and stamps `data-unified-header="true"`. Generated chrome is fixed:

- left: search + menu
- right: theme → optional shortcuts/backup → notifications → year

Anything put in the raw HTML `<header>` **before** unify is wiped. Sticky placement **must** run **after** unify (move existing node or create into `.header-right`).

The sticky CSS host is already global: `.header { position: sticky; ... }` + `.header.dashboard-topbar`.

## Inventory: where Print Preview lives today

### Pattern groups

| Group | Meaning | Examples |
|-------|---------|----------|
| **A — Single page print** | One primary preview for the whole page | orientation (done), staff-daily-report, absence-analytics, students-status, compensation-tracking, teachers-list, analytics |
| **B — Single print, gated** | One button, often `disabled` or `display:none` until data exists | grades-sheets, grades-results, students-list, absence-weekly, timetable-*, tracking-teachers-performance |
| **C — Multi-print page** | Several previews for different sections/tabs | exams-rooms (summary / attendance / invitations), exams-proctors (schedule / auto / summary), student-support (main + sessions), timetable.html (multiple contexts), student-profile (print + blank card) |
| **D — Inline / generated only** | Button not always a static toolbar control | absence-correspondence (string HTML), some reports flows |

### IDs / classes (inconsistent)

| Identifier | Pages (sample) |
|------------|----------------|
| `#print-btn` | orientation, grades-*, absence-*, staff-daily, compensation, students-status, timetable-redistribution, student-support (main) |
| `#print-preview-btn` | students-list, timetable, timetable-rooms, timetable-students, timetable-teachers |
| `#btn-print`, `#tp-print-btn`, `#tp-print-preview-btn`, `#sp-print-btn` | teachers-list, teachers-performance, tracking, student-profile |
| Section ids | `#btn-print-schedule`, `#btn-print-attendance`, `#btn-print-sessions`, … |
| Class | `ux-print-preview-btn` (shared look) vs plain `btn-success` / `sup-btn` / `btn-print-preview` |

Handlers always stay page-local: `PrintSystem.preview({...})` or `PrintSystem.window({...})` with different `contentSelector` / built HTML. **Placement** can be shared; **print payload** cannot be fully generic without per-page callbacks.

### Typical current homes (not sticky shell)

- Filter / form action rows (grades, students-list, support)
- Toolbar next to generate/load (staff-daily, absence-weekly)
- Section headers (exams)
- Title row / custom header actions (orientation was title-row → now sticky; student-profile reattaches to title-row after unify)

## What “the same as orientation” means product-wise

Must define before coding:

1. **Exactly one sticky print per page?**
   - Works for groups A/B.
   - For group C, either: primary action only in sticky bar + section prints stay in place, or a sticky **menu** of print targets (heavier UX).

2. **Always visible vs gated?**
   - Sticky bar can still host a `disabled` button until data is ready (grades/list pattern).
   - Or hide via `display:none` / `hidden` (timetable pattern). Prefer one convention.

3. **Scope of rollout**
   - All HTML pages with any print, or only “list/report” pages, excluding complex exam multi-print UIs first.

## Possible approaches

### Approach 1 — Generalize the orientation helper (recommended baseline)

**Idea:** Extract `orientation-topbar-print.js` → something like `js/shared/sticky-topbar-print.js` (or keep name but de-brand).

```js
StickyTopbarPrint.ensure({
  onPrint: openPreview,          // required per page
  btnId: 'print-btn',            // optional, default print-btn
  sourceSelector: '#print-btn',  // optional relocate source
  className: 'btn btn-success ux-print-preview-btn',
  removeDuplicates: true
});
```

**Per page work:**

1. Call ensure after DOM ready (with retry until unified header).
2. Remove/relocate old markup so only one control remains.
3. Keep existing click logic; only re-bind once (dataset flag).
4. For gated buttons, continue toggling `disabled` / `hidden` on the **same** node after move.

**Pros**

- Proven (orientation already does this).
- Print logic stays in the page (correct for different selectors/options).
- No change to `setupUnifiedHeader` contract.
- Incremental: migrate page-by-page.

**Cons**

- Many pages still need a small wiring pass.
- Must handle ID collisions carefully if two buttons share patterns.
- Multi-print pages need an explicit product rule.

**Best for:** rolling out groups A/B first, then C carefully.

---

### Approach 2 — Slot inside `setupUnifiedHeader` (framework hook)

**Idea:** Extend `setupUnifiedHeader()` so every unified page can declare page actions.

Options for declaration:

| Mechanism | Example |
|-----------|---------|
| Data attribute on `<body>` or `<main>` | `data-sticky-print="1"` |
| Static marker left outside wiped header | `<template id="topbar-page-actions">…</template>` cloned after rebuild |
| JS registry before/after init | `window.PageTopbar.register({ print: handler })` then header init mounts empty shell |

**Pros**

- One structural home for “things that belong in sticky bar.”
- Future actions (export, import) can use the same slot.
- Consistent DOM position and CSS.

**Cons**

- Touches global `utils.js` (high blast radius).
- Timing: pages must register handlers before or re-run after header build.
- Still need per-page handlers; only placement is centralized.
- Orientation helper becomes redundant or a thin wrapper.

**Best for:** if you expect many sticky page actions beyond print soon.

---

### Approach 3 — Convention + auto-discovery (attribute-driven)

**Idea:** Markup contract:

```html
<button type="button"
  class="ux-print-preview-btn"
  data-sticky-print
  data-print-mode="preview"
  data-print-title="..."
  data-print-selector="#export-sheet"
  data-print-landscape="true">
```

A single script (loaded with `print-system.js`) on DOMContentLoaded:

1. Finds `[data-sticky-print]`.
2. Moves the first one into sticky header.
3. Wires default `PrintSystem.preview` from data-* attributes.
4. Removes other marked duplicates or non-sticky marked buttons.

**Pros**

- Very little per-page JS for simple pages.
- Easy audit: search `data-sticky-print`.

**Cons**

- Fails for pages that need prep work before preview (build export sheet, wait for charts, enable only if rows). Those still need custom `onPrint`.
- Multi-print and conditional enable are awkward in pure attributes.
- Risk of double-binding if page scripts also attach listeners.

**Best for:** simple analytics-style pages; hybrid with Approach 1 for complex ones.

---

### Approach 4 — Copy orientation pattern page-by-page (no shared module)

**Idea:** Duplicate move/mount logic in each `js/pages/*.js`.

**Pros:** zero shared-API design debate; maximum isolation.  
**Cons:** high drift, hard tests, worse than Approach 1 for 20+ pages.

**Verdict:** only acceptable for 1–2 more pages; not for “all pages.”

---

### Approach 5 — CSS-only “sticky toolbar” (not real shell bar)

**Idea:** Make the filter/title row `position: sticky` under the header instead of moving the button into `.dashboard-topbar`.

**Pros:** almost no JS; keeps button next to filters.  
**Cons:** **does not** match your target class (`header.unified-header.dashboard-topbar`); two sticky layers; inconsistent with orientation.

**Verdict:** reject if the requirement is literally the shell top bar.

---

### Approach 6 — Hybrid phased strategy (practical recommendation)

Combine Approach **1** (shared helper) with optional Approach **2** later if needed.

| Phase | Scope | Rule |
|-------|--------|------|
| **0** | Document inventory + taxonomy A/B/C | Done in this file |
| **1** | Generalize orientation helper → shared module; keep orientation as first consumer | One source of truth for mount |
| **2** | Migrate group **A** (single always-on print) | 1 sticky button, remove old |
| **3** | Migrate group **B** (gated) | Same node, preserve disabled/hidden APIs |
| **4** | Group **C** policy | **Primary** print in sticky only; keep section-specific prints in section toolbars **or** sticky dropdown — decide per page |
| **5** | Smoke tests / placement tests per critical page | Mirror orientation test pattern |

Optional later: if 5+ pages need more sticky actions, add a formal **page-actions slot** in `setupUnifiedHeader` (Approach 2) and make the print helper fill that slot.

## Design decisions you should lock before coding

1. **One sticky print control per page** vs allow multi-action sticky menus.
2. **Canonical button API:** prefer one id class (`ux-print-preview-btn`) + stable id or `data-role="print-preview"`.
3. **Remove vs hide** old locations (requirement: remove/relocate, not `display:none` leftovers that still count as duplicates).
4. **Exams / multi-tab pages:** which button is the “page-level” print?
5. **Prototypes** (`student-profile-prototype`, `timetable_body.html`, etc.): in or out of scope?

## Risks (any approach)

| Risk | Mitigation |
|------|------------|
| Mount before header unify → button wiped | Retry until `data-unified-header` / `.dashboard-topbar` |
| Double click listeners | One-shot dataset flag; move node instead of clone |
| Disabled state lost | Move same DOM node; page code keeps updating that id |
| Crowded topbar (RTL + year + bell + print) | Compact styles (orientation CSS pattern); allow wrap |
| Multi-print confusion | Explicit product rule for group C |
| Global ID `#print-btn` on many pages | Fine per document; don’t assume cross-page uniqueness |

## Suggested decision matrix

| If you want… | Choose |
|--------------|--------|
| Safest incremental rollout matching orientation | **Approach 1** (+ phase plan 6) |
| Long-term “any page action in sticky bar” | **Approach 2** after 1 stabilizes |
| Minimal JS for dumb pages only | **Approach 3** hybrid for A, 1 for B/C |
| Fastest for one more page only | Copy orientation once, then extract |
| Pixel-perfect “in shell bar” | Avoid Approach 5 |

## Recommended next step (when you approve implementation)

1. Rename/generalize `orientation-topbar-print.js` → shared sticky print mounter (keep orientation working).
2. Standard CSS: `.header.dashboard-topbar .page-topbar-actions` (rename from orientation-specific class).
3. Migrate 2–3 group-A pages as pilot (e.g. `staff-daily-report`, `students-status`, `absence-analytics`).
4. Write one shared placement unit test + page-source checks.
5. Expand to group B, then decide group C product rules.

## Out of scope for pure investigation

- Implementing the migrations
- Changing `PrintSystem` preview/window APIs
- Unifying every print **payload** across domains

---

## Summary

The problem is **not** “how to print” — that is already per-page via `PrintSystem`. The problem is **where the trigger lives** after a global header rebuild, with **one sticky instance**, inconsistent IDs, and some pages having **multiple legitimate print targets**.

**Best default:** generalize the orientation sticky-mount helper (Approach 1) and roll out by taxonomy A → B → C, with a clear multi-print policy. Add a formal header slot (Approach 2) only if sticky page actions become a platform pattern beyond print.
