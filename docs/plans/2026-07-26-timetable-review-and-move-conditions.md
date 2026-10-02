# Timetable page — code review + remediation plan (2026-07-26)

Scope: `timetable.html` (markup/structure) and the drag-and-drop editing system it
loads (`js/pages/timetable.js`, `js/shared/timetable-move-logic.js`).

Prior art (still valid, not duplicated here):
- `docs/reviews/2026-07-08-timetable-edit-drag-drop-review.md`
- `docs/drag-drop-analysis.md`
- `docs/plans/2026-07-19-timetable-dnd-optimization.md` + `-implementation.md`

Already landed from the 2026-07-19 optimization plan (verified in code):
event delegation on `tbody`, per-drag class-timetable cache (`_dragClassTimetable`),
`rAF`-coalesced `dragover` with diff repaint, surgical DOM patch on drop
(`applyMoveToDom`), dead `dataTransfer.setData` and `_editDelegationBound` removed.

---

## Part 1 — Findings

### Drag and drop

| # | Sev | Finding | Anchor |
|---|-----|---------|--------|
| D1 | HIGH | `decorateCellsForEdit()` sets `draggable="true"` on **every** cell, including empty ones. `handleDragStart` then cancels the drag via `preventDefault()`. Result: move cursor + drag ghost on cells that can never be dragged. | `timetable.js` `decorateCellsForEdit` |
| D2 | HIGH | No touch/pointer path. Native HTML5 DnD does not fire on touch, so the whole move feature is unreachable on tablets — the click-based "نقل الحصة" move mode is the only fallback and is not discoverable from a cell. | no `pointerdown`/`touchstart` in `timetable.js` |
| D3 | MED | `dropEffect` is derived from `_lastHoverValid`, which is one frame stale. A fast drag into a *valid* cell followed by an immediate release can be rejected by the browser with no feedback; the user must wiggle the pointer. | `handleDragOver` |
| D4 | MED | Dropping a lesson back on its own slot passes validation (source keys are excluded from every conflict check) and runs the full delete+add pipeline: 2 spurious `pendingChanges`, a "moved successfully" toast, and a dirty editor for a no-op. | `handleDrop` → `performMoveToDestination` |
| D5 | MED | `handleDrop` passes the source through `editMode.moveMode` with `active: false` and a comment explaining the trick, instead of passing an argument. Global mutable state used as a parameter channel. | `handleDrop` |
| D6 | MED | `handleDrop` and `handleDragEnd` duplicate the same 8-line reset (4 module vars + class sweep over all `td`). Two places to keep in sync; `handleDrop` runs it, then `dragend` runs it again. | `handleDrop`, `handleDragEnd` |
| D7 | MED | `applyMoveToDom` is ~130 lines mixing 10 bail-out predicates with DOM surgery, is untestable from Node, and swallows any throw into `return false` after partial mutation (recovered only because the caller re-renders). | `applyMoveToDom` |
| D8 | LOW | The `.drag-handle` grip is decorative — the whole cell is the drag source, so the grip communicates an affordance the code does not implement. | `decorateCellsForEdit` |
| D9 | LOW | `getRenderedCellForSlot` interpolates `day`/`period` straight into a CSS attribute selector without `CSS.escape`; a quote in an imported day label throws. | `getRenderedCellForSlot` |
| D10 | LOW | `isRoomOccupied` linear-scans every teacher for each destination period; `highlightAvailableSlots` calls validation for all ~48 cells on `dragstart`. Mitigated (not fixed) by the new relaxed mode, which skips it entirely. | `isRoomOccupied` |

### Code quality / simplicity

| # | Sev | Finding | Anchor |
|---|-----|---------|--------|
| Q1 | HIGH | `timetable.js` is 3971 lines / 154 KB in one file: render, edit mode, DnD, validation, import/export, search, print. No seams for testing. | whole file |
| Q2 | HIGH | 8 `if (logic) … else <reimplementation>` branches duplicate `timetable-move-logic.js` (`buildTimetableSlotKey`, `getConsecutivePeriods`, `hasInternalGap`, `buildOccupancyAfterMove`, `causesGapAfterMove`, `validateMoveTarget`, …). The module is a deferred script loaded **before** `timetable.js`, so the fallbacks are unreachable — dead code that can silently drift from the tested implementation. | `timetable.js` ~2533–2660 |
| Q3 | MED | Tab logic lives in an inline `<script defer>` in `<head>`, and `localStorage['timetableActiveTab']` is read both there and in `timetable.js`. Two owners of one piece of state. | `timetable.html` head, `timetable.js` |
| Q4 | MED | Tabs are `<button>`s with no `role="tablist"` / `aria-selected` / `aria-controls`, panels have no `role="tabpanel"`, and there is no arrow-key navigation. | `timetable.html` `.primary-tabs` |
| Q5 | MED | Visibility is expressed three ways: inline `style="display:none"`, `.active` class (`#edit-controls`), and JS-assigned `style.display`. Inline styles also carry layout (`.primary-tabs`, every `.primary-tab`, several form rows). | `timetable.html` |
| Q6 | LOW | Seven module-level drag variables (`_dragSource`, `_dragClassTimetable`, `_renderedHoverKey`, `_pendingDragOverTarget`, `_lastHoverValid`, `_dragOverFrame`, `_highlightedDragCells`) instead of one `dragState` object — the reason D6's reset is easy to get wrong. | `timetable.js` ~2356 |
| Q7 | LOW | `#conflict-badge` count updates are not announced (`aria-live` missing); `.user-info` is hardcoded to "المستخدم". | `timetable.html` |
| Q8 | LOW | Four modals repeat identical header/close scaffolding. | `timetable.html` |

---

## Part 2 — Selectable move conditions (implemented)

Requirement: the drag-and-drop system must either enforce **teacher availability +
class availability + room availability**, or **teacher + class availability only**,
with the room condition dropped — user's choice.

Model: teacher availability, class availability and "no gap in the class day" are
always enforced. Only the room condition is selectable.

| Mode | id | Conditions |
|------|----|-----------|
| الأستاذ + القسم + القاعة | `strict` (default) | teacher free · class free · no class gap · room free |
| الأستاذ + القسم (بدون شرط القاعة) | `no-room` | teacher free · class free · no class gap |

Implementation:

- `js/shared/timetable-move-logic.js` — added `MOVE_CONDITIONS`,
  `isRoomCheckEnabled(mode)`, and `input.checkRoom` in `validateMoveTarget`.
  `checkRoom` defaults to strict when omitted, so existing callers are unchanged.
- `timetable.html` — `#move-condition-mode` select in the edit-controls bar (only
  visible in edit mode, next to "عرض التغييرات").
- `js/pages/timetable.js` — `getMoveConditionMode` / `setMoveConditionMode` /
  `isRoomConditionEnabled` (persisted in `localStorage['timetableMoveConditionMode']`,
  device-local, not synced — same treatment as `timetableActiveTab`);
  `validateMoveTarget` wrapper forwards `checkRoom`; changing the mode invalidates
  the cached hover validity and repaints highlights if a move is in progress.
- `validateChange` (modal path) — room conflict is a blocking `error` in `strict`
  and an informational `warning` in `no-room`, so the modal and DnD obey the same
  choice instead of disagreeing.
- `tests/timetable-move-logic.test.js` — 7 new cases: mode mapping (unknown mode
  fails safe to strict), strict rejects a room clash, omitted `checkRoom` stays
  strict, `checkRoom:false` accepts the same move, and `checkRoom:false` still
  rejects teacher conflict / class conflict / class-day gap. 24/24 pass.

Not covered (deliberate): the `#conflict-badge` room-conflict counter stays
informational in both modes, and room conflicts are still recorded in the
changelog. Relaxed mode changes what is *blocked*, never what is *reported*.

---

## Part 3 — Task plan

Ordered by risk-adjusted value. Each task is independently shippable.

### Phase 0 — done
- [x] **T0** Selectable move conditions + tests (Part 2).

### Phase 1 — correctness (no refactor)
- [ ] **T1 (D1)** In `decorateCellsForEdit`, set `draggable="true"` only on cells
      containing an activity; drop the attribute on empty cells. Keep the
      `handleDragStart` guard as defense in depth.
      *Accept:* empty cells show the default cursor and produce no drag ghost.
- [ ] **T2 (D4)** Short-circuit a same-slot drop: in `handleDrop`, if destination
      `(day, periodType, period)` equals the source anchor, reset drag state and
      return without touching `fetData` or `pendingChanges`.
      *Accept:* dropping a lesson on itself leaves the undo count and changelog
      untouched and shows no success toast.
- [ ] **T3 (D3)** Remove the stale-validity window: validate the newly entered
      cell synchronously (cheap now — the class timetable is cached per drag) and
      keep only the *repaint* inside the `rAF`.
      *Accept:* a drag entering a valid cell and released in the same frame drops.
- [ ] **T4 (D9)** Escape dataset values in `getRenderedCellForSlot`
      (`CSS.escape`) or resolve cells from a `Map` built at render time.

### Phase 2 — simplification (behavior-preserving)
- [ ] **T5 (Q2)** Delete the 8 fallback reimplementations. On missing
      `TimetableMoveLogic`, disable edit mode and surface one clear error instead
      of silently running an untested second implementation.
      *Accept:* `if (logic)` count is 0; move-logic tests unchanged and green.
- [ ] **T6 (D6, Q6)** Collapse the seven drag variables into one `dragState`
      object and extract `resetDragState()` used by both `handleDrop` and
      `handleDragEnd`.
- [ ] **T7 (D5)** Change `performMoveToDestination(destDay, destPeriod,
      destPeriodType, moveContext)` to take the source explicitly; keep
      `editMode.moveMode` for click-driven move mode only.
- [ ] **T8 (D7)** Extract the bail-out predicates of `applyMoveToDom` into a pure
      `planMoveDomPatch(input)` in `timetable-move-logic.js` returning
      `{ strategy: 'surgical' | 'rerender', … }`; add Node tests for the
      merge-boundary cases. Keep the DOM writes in `timetable.js`.
- [ ] **T9 (Q3)** Move the inline head script to `js/pages/timetable-tabs.js` and
      give the active-tab key a single owner.
- [ ] **T10 (Q1)** Split `timetable.js` along existing seams:
      `timetable-render.js`, `timetable-edit.js`, `timetable-dnd.js`,
      `timetable-io.js`. Mechanical moves only, one module per commit.

### Phase 3 — accessibility & polish
- [ ] **T11 (Q4)** Proper tablist semantics + arrow-key navigation for the three
      primary tabs.
- [ ] **T12 (D8)** Make the grip real: `draggable` on the handle only, or remove
      the grip and rely on the cell.
- [ ] **T13 (Q5)** Replace inline `display`/layout styles with state classes
      (`.is-hidden`, `.primary-tabs`, `.move-condition-field`).
- [ ] **T14 (Q7)** `aria-live="polite"` on the conflict badge; bind `.user-info`
      to the real session user.
- [ ] **T15 (D2)** Pointer-events drag fallback (~5px threshold) reusing
      `validateMoveTarget` / `performMoveToDestination`, so tablets can move
      lessons. Largest item in the plan — schedule separately.

### Phase 4 — performance (only if profiling justifies)
- [ ] **T16 (D10)** Build a room-occupancy index per drag session, mirroring
      `_dragClassTimetable`, and clear it in `resetDragState`.

### Deferred
- **Q8** shared modal scaffolding — cosmetic, no functional payoff.

---

## Verification

- `node tests/timetable-move-logic.test.js` — 24/24 pass.
- `npx eslint js/pages/timetable.js js/shared/timetable-move-logic.js tests/timetable-move-logic.test.js` — clean.
- `npm test` — timetable suites pass (`timetable-move-logic`, `timetable-resolver-unit`,
  `timetable-view-unit`). Pre-existing unrelated failures in the `proctor-v2-*` suites
  were confirmed present on the untouched baseline (verified by stashing these edits).
- Manual (not executed here — Electron UI): enter edit mode, drag a single and a
  double lesson under both condition modes, confirm a room-clashing destination is
  red/blocked in `strict` and green/allowed in `no-room`, and that the choice
  survives a page reload.
