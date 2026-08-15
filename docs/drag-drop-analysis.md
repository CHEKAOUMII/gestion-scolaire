# Drag & Drop Analysis Report — Timetable Module

> **Date:** 2026-07-19
> **Status:** Verified against source (line numbers current as of this date)
> **Companion plan:** `docs/plans/2026-07-19-timetable-dnd-optimization.md`
> **History:** `docs/plans/2026-07-09-timetable-tabs-drag-drop-plan-v2.md`, `docs/reviews/2026-07-08-timetable-edit-drag-drop-review.md`

This report documents *what exists today*. The companion plan documents *what to change*.

---

## Scope

The teacher-timetable drag-and-drop system lives in `js/pages/timetable.js` (DOM + orchestration) with all pure move/validation rules extracted into `js/shared/timetable-move-logic.js` (DOM-free, IPC-free, unit-tested in Node). CSS lives in `css/tailwind-input.css`. `timetable.html` carries no DnD logic — only `<script>` includes and the tab switcher.

| File | Total lines | DnD-related | Notes |
|---|---|---|---|
| `js/pages/timetable.js` | ~3,714 | ~1,970–2,940 (host of all handlers, render, edit mode) | The only editor |
| `js/shared/timetable-move-logic.js` | ~272 | whole file | Pure rules; `module.exports` + `window.TimetableMoveLogic` |
| `css/tailwind-input.css` | ~36,467 | ~33,296–33,409 | Source CSS (compiled to `tailwind-output.css`) |
| `timetable.html` | — | none | Script includes + `switchTab` only |

**Architectural rule (do not break):** the **teacher tab is the only editor**. The Students and Rooms tabs (`timetable-students.js`, `timetable-rooms.js`) are **derived, read-only views of the *saved* DB snapshot** (`window.api.timetable.get`), not of live `fetData`. Unsaved teacher edits appear there only after `saveAllChanges()` and a tab re-open.

---

## Architecture Overview

### Pattern: event delegation on `<tbody>` (good)

All drag/click events are bound **once** to `#timetable tbody` via `ensureEditEventDelegation()` (L1984), guarded by `tbody.dataset.editDelegation === '1'`. Re-rendered cells are never re-bound; they only get `draggable="true"` + a `.drag-handle` grip via `decorateCellsForEdit()` (L2052). `getEditTargetCell()` (L1974) resolves each delegated event to the nearest `td[data-day][data-period][data-period-type]`.

> This delegation was introduced specifically to fix the **listener-accumulation bug** flagged in the 2026-07-09 plan (P0-2). That bug is **resolved** — this report treats delegation as the baseline.

### State

- **`_dragSource`** (L2343): module-level `{ day, period, periodEnd, periodType, numPeriods, srcData }`. Set on `dragstart`, read on `dragover`/`drop`, cleared on `dragend`. Native DnD is single-drag, so shared mutable state is safe here.
- **`editMode`**: master edit state (`active`, `currentTeacher`, `pendingChanges`, `moveMode`, `originalTimetable`, …).
- **`_editDelegationBound`** (~L1971): set to `true`, **never read** — dead. The real guard is `tbody.dataset.editDelegation`.

### Data model (critical — kills the recurring "band" myth)

Slots live at `fetData.timetables[teacher][day][periodType][period]` where `periodType ∈ {morning, afternoon}` and `period ∈ {H1, H2, H3, H4}`. **Morning and afternoon EACH contain the full H1–H4 set.** The morning/afternoon split is the separate `periodType` dimension — it is **never** encoded inside the H-keys.

Consequence: `getConsecutivePeriods('H2', 2)` → `['H2','H3']`, and both belong to the *same* `periodType`, so a double lesson can never straddle the morning/afternoon boundary. A single drag targets exactly one `periodType`. **There is no "band" to clamp**, and the old "double lesson crosses noon" concern (v2 plan P1-1) does not apply to this model. `timetable-move-logic.js` documents this explicitly in its header comment. Do not re-introduce a band clamp.

### Data flow

```
dragstart  →  _dragSource = { source info }
            →  effectAllowed='move'; setData('text/plain', JSON)   ← payload never read back
            →  setTimeout(0) → add .drag-source (after ghost captured)
            →  highlightAvailableSlots()        ← validates EVERY cell

dragover   →  validateMoveTarget(...)           ← runs continuously (~60/s)
            →  dropEffect = valid ? 'move' : 'none'
            →  clear old .drag-over* from all cells → add to _getDragOverCells()

drop       →  performMoveToDestination()
            →  mutate fetData → renderTeacherTimetable()   ← FULL tbody rebuild
            →  addCellClickHandlers()

dragend    →  clear all drag CSS from all cells → _dragSource = null
```

---

## Function Inventory (verified line numbers)

### Core drag handlers
| Function | Line | Role |
|---|---|---|
| `handleDragStart(e)` | 2345 | Guards edit mode; reads `data-*`; aborts on empty cell; sets `_dragSource`; highlights valid slots |
| `handleDragEnd(e)` | 2390 | Clears all drag classes + highlighting; `_dragSource = null` |
| `handleDrop(e)` | 2400 | Builds `moveMode` context; delegates to `performMoveToDestination` |
| `handleDragLeave(e)` | 2429 | Removes `.drag-over*` only when genuinely leaving the cell |
| `handleDragOver(e)` | 2793 | Full `validateMoveTarget` per event; sets `dropEffect`; repaints `.drag-over*` |
| `_getDragOverCells(targetCell)` | 2773 | Resolves the consecutive cells a (possibly double) lesson covers |

### Delegation / decoration
| Function | Line | Role |
|---|---|---|
| `getEditTargetCell(target)` | 1974 | Resolves an event to a valid data-stamped `td` inside tbody |
| `ensureEditEventDelegation()` | 1984 | Binds click/dragstart/dragend/dragover/drop/dragleave once to tbody |
| `decorateCellsForEdit()` | 2052 | Sets `draggable="true"` + appends `.drag-handle` per cell |
| `addCellClickHandlers()` | ~2078 | `ensureEditEventDelegation()` + `decorateCellsForEdit()` |
| `removeCellClickHandlers()` | ~2088 | Strips `draggable` + handles (delegation listeners persist) |

### Validation / move
| Function | Line | Role |
|---|---|---|
| `buildClassTimetable(className)` | 2436 | Scans **all teachers × days × 8 periods** to assemble one class schedule |
| `getMoveLogic()` | ~2485 | Returns `window.TimetableMoveLogic` (pure module) |
| `getRenderedCellForSlot(...)` | ~2554 | Finds DOM cell for a slot (merged-colspan aware) |
| `validateMoveTarget(...)` (wrapper) | 2577 | Injects live `fetData` deps into the pure validator; inline fallback if module missing |
| `highlightAvailableSlots(className, opts)` | 2626 | Runs `validateMoveTarget` for **every** rendered cell; paints green/red |
| `clearSlotHighlighting()` | ~2684 | Removes `.slot-*` classes + titles |
| `performMoveToDestination(...)` | 2686 | Re-validates; mutates `fetData`; records grouped `pendingChanges`; full re-render |
| `getSlotData(...)` | 2908 | Reads one slot from `fetData.timetables` |
| `isRoomOccupied(...)` | 2936 | **Linear scan of all teachers** for one (room, day, period, periodType) |
| `buildPeriodRange(start, end)` | 3109 | Period keys in a range |
| `renderTeacherTimetable(teacher, filter)` | 1635 | Rebuilds `tbody.innerHTML` from scratch (merges consecutive same-subject cells into colspans) |

### Pure module (`timetable-move-logic.js`)
| Function | ~Line | Role |
|---|---|---|
| `getConsecutivePeriods(start, count, periodType)` | 31 | Consecutive H-keys; `periodType` accepted but intentionally unused (no band clamp) |
| `buildPeriodRange(start, end)` | 46 | Range of H-keys |
| `hasInternalGap(occupancy)` | 52 | True if occupied slots enclose an empty one |
| `buildOccupancyAfterMove(...)` | 72 | Occupancy vector after applying source→dest move |
| `causesGapAfterMove(...)` | 82 | `hasInternalGap(buildOccupancyAfterMove(...))` |
| `validateMoveTarget(input, deps)` | 94 | The core validator (see below) |
| `restoreTeacherTimetableSnapshot(...)` | 225 | Deep-restores a teacher snapshot (used by Cancel) |
| `buildEditedSlotData(opts)` | 236 | Preserves non-form fields (`activityId`, `tags`) during modal edit |

### Click-based fallback ("move mode")
`startMoveMode()` / `cancelMoveMode()` / the destination branch of `handleCellClick()` (L2079) provide a two-step **click-to-move** alternative to dragging (source is remembered, valid slots highlighted, a second click commits). This is the closest thing to a keyboard/touch-accessible path today, though it still requires pointer clicks.

---

## `validateMoveTarget()` — rule order

**Inputs:** `{ teacher, className, room, sourceDay, sourcePeriodType, sourcePeriods, destDay, destPeriod, destPeriodType }`
**Deps injected by the renderer:** `getSlotData`, `isRoomOccupied`, `buildClassTimetable`.

| # | Check | Fails when |
|---|---|---|
| 1 | Input sanity | Missing teacher/dest fields or empty `sourcePeriods` |
| 2 | Consecutive range | Destination can't fit `sourcePeriods.length` consecutive slots |
| 3 | Teacher busy | Teacher already has an activity at a dest period (excluding vacated source) |
| 4 | Class busy | Class already has an activity with *another* teacher at a dest period |
| 5 | Room busy | `isRoomOccupied` true for another teacher at a dest period |
| 6 | Gap prevention | Move would create an internal gap in the class day for the source **or** dest `day|periodType` slice |

**Returns:** `{ valid, destPeriods }` or `{ valid: false, message }` (Arabic). This is **move-with-conflict-block**, not swap — an occupied non-source destination is rejected, never swapped.

**Fallback:** if `TimetableMoveLogic` fails to load, the wrapper (L2577) only checks the consecutive-range rule.

---

## Reliability bugs from prior plans — status

| Prior issue | Source | Status today |
|---|---|---|
| Cancel doesn't restore data | v2 P0-1 | **Fixed.** Cancel restores `editMode.originalTimetable` via `restoreTeacherTimetableSnapshot` (~L3175) then re-renders. |
| Listener accumulation on re-render | v2 P0-2 | **Fixed.** Single delegated binding on tbody (`dataset.editDelegation` guard). |
| Double lesson crosses morning/afternoon | v2 P1-1 | **Not a bug** for this data model (each `periodType` holds full H1–H4). No clamp needed; do not add one. |
| Dead `wouldCreateGap()` / parallel `performUndo`/`performRedo` | v2 P1-2 | **Removed** — not present in current `timetable.js`. Redo is intentionally unavailable (single grouped undo stack). |

The reliability layer is therefore sound. The remaining items are **performance, dead code, and UX** — see the companion plan.

---

## Issues & Anti-Patterns (current)

### Performance
1. **Full `tbody` rebuild on every mutation (HIGH).** `performMoveToDestination` (2686), modal confirm, undo, and cancel all end in `renderTeacherTimetable` → `tbody.innerHTML = …` + `addCellClickHandlers()`. Causes flicker, scroll loss, and re-decoration of all cells.
2. **`validateMoveTarget` on every `dragover` (HIGH).** Fires ~60×/s; each call may run `buildClassTimetable` + gap analysis. Hottest path in the module.
3. **`highlightAvailableSlots` validates every cell on dragstart (MED).** O(cells × teachers × days × periods) because `buildClassTimetable` recomputes per cell.
4. **`buildClassTimetable` recomputed, never cached (MED).** O(teachers × days × 8) rebuilt inside validation on every call — no memoization by `className`.
5. **`isRoomOccupied` linear scan (MED).** Full sweep of every teacher's timetable per destination period, multiplied by dragover frequency and highlight passes.
6. **Repeated `querySelectorAll('#timetable tbody td')` sweeps** in `handleDragEnd`, `handleDragOver`, `clearSlotHighlighting`.

### Dead code / cleanup
7. **Dead `dataTransfer.setData('text/plain', …)` (LOW).** Set in `handleDragStart` (~L2367); never read via `getData()`. `_dragSource` is the real channel.
8. **Dead `_editDelegationBound` variable (LOW).** Set, never read; guard uses `dataset.editDelegation`.
9. **Dead CSS classes (LOW).** `.drop-invalid` (`tailwind-input.css` ~33376), `.drop-preview` (~33397; garbled `content: 'إلغاء حفظ ??'`), and `.dragging` are defined but applied only in the legacy `timetable.html.backup`, never by live JS.
10. **`setTimeout(0)` ghost hack (LOW).** Defers `.drag-source` so the drag ghost isn't dimmed; flash-prone. `setDragImage()` is the clean replacement.

### UX / robustness
11. **No touch/pointer support (MED).** Native HTML5 DnD does not fire on touch devices; tablet users must use click "move mode".
12. **No `dragenter` handler (LOW).** Only `dragover` (continuous). A `dragenter` could host one-time hover setup, leaving `dragover` for `preventDefault`/`dropEffect`.
13. **No `data-*` schema assertion (LOW).** DnD silently depends on `data-day/period/period-type/period-end`; a render-format change breaks drag with no error.

---

## MDN Best-Practices Comparison

| Practice | Recommendation | Status | Gap |
|---|---|---|---|
| `draggable="true"` on source | Required | Done (`decorateCellsForEdit`) | — |
| `preventDefault()` on `dragover` | Required to allow drop | Done | — |
| `dropEffect` feedback | Set move/none | Done (`move`/`none`) | — |
| `effectAllowed` on dragstart | Restrict ops | Done (`move`) | — |
| `getData()` in drop | Read serialized payload | Uses `_dragSource` instead | Dead `setData` |
| `setDragImage()` | Custom ghost | Not used (`setTimeout(0)` hack) | Minor |
| `dragenter` for setup | One-time zone init | Missing | Efficiency |
| Touch / Pointer support | Polyfill or pointer events | Missing | Mobile/tablet |
| Keyboard accessibility | Keyboard reorder | Partial (click move mode) | Accessibility |

---

## Files Referenced

| File | Role |
|---|---|
| `timetable.html` | Structure + `<script>` includes + `switchTab` |
| `js/pages/timetable.js` | All handlers, state, edit mode, render, thin validation wrappers |
| `js/shared/timetable-move-logic.js` | Pure validation/move rules (unit-tested) |
| `tests/timetable-move-logic.test.js` | Node tests for the pure module (incl. cancel-restore scenario) |
| `css/tailwind-input.css` | Source CSS for all drag classes |
| `css/tailwind-output.css` | Compiled output |
