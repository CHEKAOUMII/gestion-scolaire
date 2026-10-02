# Teacher Timetable Edit & Drag-Drop Review

**Date:** 2026-07-08  
**Scope:** `js/pages/timetable.js` — edit mode, move mode, HTML5 drag-and-drop  
**Related plan:** `docs/plans/2026-04-11-timetable-tabs-drag-drop-plan.md`  
**Page shell:** `timetable.html`

---

## Summary

The teacher-timetable edit path has a **real, working move/DnD core** (`validateMoveTarget`, live apply + re-render, multi-period cells, green/red slot hints).  
The main risks are **structural**: a god-file, stacked event listeners, cancel that does not restore data, and a second half-dead undo/multi-select layer.

**Bottom line:** validation + move logic are the strong core. Cancel is unsafe, re-render re-binds DnD listeners, and the file is overloaded.

---

## What’s solid

| Area | Why |
|------|-----|
| `validateMoveTarget` | Checks teacher busy, class busy, room, consecutive periods, class gaps |
| Live apply + re-render | Moves/edits update `fetData` then `renderTeacherTimetable` |
| Merged cells | `periodEnd` / `buildPeriodRange` / multi-cell drag-over |
| Move UX | Green/red slot highlighting + title tooltips |
| Undo grouping | `groupId` undoes full multi-period moves |

---

## P0 bugs (fix first)

### 1. Cancel edit does **not** restore data

`buildOriginalTimetable()` snapshots, but `cancelEditMode()` only clears `pendingChanges` and exits UI — **does not reapply the snapshot to `fetData`**.

```js
// cancelEditMode() — current behavior
editMode.pendingChanges = [];
exitEditMode();  // no restore of originalTimetable
```

**Effect:** user edits → Cancel → grid still shows mutations; only the “pending” list is cleared.

**Fix:**

```js
if (editMode.originalTimetable && editMode.currentTeacher) {
  fetData.timetables[editMode.currentTeacher] =
    JSON.parse(JSON.stringify(editMode.originalTimetable));
  renderTeacherTimetable(editMode.currentTeacher, subjectFilter);
}
editMode.pendingChanges = [];
exitEditMode();
```

### 2. Handler stacking on re-render

Every move/edit/undo does:

```js
renderTeacherTimetable(...)
addCellClickHandlers()  // addEventListener again — never removes first
```

`removeCellClickHandlers()` only runs on exit.

**Effect:** after N edits, each click/drop fires N times → duplicate pending changes / double moves.

**Fix:** always `removeCellClickHandlers()` before add, **or** (preferred) event delegation on `#timetable` once.

### 3. Multi-select / double-click / header undo are half-dead

```js
if (!cell || !editMode) return;   // always truthy — object always exists
// should be: editMode.active
```

Also:

| Symbol / path | Problem |
|---------------|---------|
| `performUndo()` → `undoChange()` | Function does not exist (real undo is `undoLastChange`) |
| `performRedo()` | Uses `redoStack` / `changeLog` / `refreshTimetable()` — not wired to `editMode.pendingChanges` |
| `clearSelectedCells()` | Only removes CSS class; no real clear of cell content |
| `updateConflictBadge()` | Depends on undefined `roomConflicts` |

These look like abandoned UX layers next to the real edit system.

---

## Drag & drop

### Works

- Empty cells blocked at `dragstart`
- Invalid drop blocked via `validateMoveTarget` + `dropEffect = 'none'`
- Multi-period source length preserved at destination
- Visual: `drag-source`, `drag-over`, `drag-over-ext`, available slots

### Problems / habits debt

| Issue | Detail |
|-------|--------|
| **Every cell is `draggable=true`** | Including empty ones → bad cursor, accidental drags; only occupied cells should be draggable |
| **Drag handle is decorative** | Grip icon is appended but drag works on whole cell; click vs drag fight |
| **No drag-threshold / handle-only** | Prefer: `draggable` only on handle, or Pointer Events with ~5px threshold |
| **`handleDrop` vs `handleDragEnd` race** | Drop clears `_dragSource`; dragend also clears + highlighting — OK-ish, but fragile |
| **No same-slot short-circuit** | Dropping on source still runs full delete+add pipeline |
| **Click after failed drag** | Can open edit modal unintentionally |
| **No keyboard alternative while dragging** | Move-mode button exists; DnD has no Esc cancel mid-drag |
| **HTML5 DnD on Electron/Windows** | Ghost image + `setTimeout` dimming is fragile; pointer-based drag is more reliable on desktop |

### Recommended DnD contract

```text
editMode.active
  → only cells with lesson: draggable / pointer-drag
  → dragstart: capture immutable source snapshot (not live refs)
  → dragover: validateMoveTarget (pure)
  → drop: if valid → performMove once; else toast + no-op
  → dragend: always cleanup classes + highlights
  → never stack listeners; delegate from tbody
```

---

## Structure / good habits

### God-file anti-pattern

One file (~3641 lines, ~112 functions) owns: import/XML parse, search, quick-nav, print, multi-select, conflicts, edit modal, DnD, validation, undo, changelog, export.

**Preferred split:**

```text
timetable/
  state.js          // fetData, editMode, pendingChanges
  render-teacher.js
  edit-session.js   // enter/exit/cancel/save + snapshot restore
  move-validate.js  // validateMoveTarget pure functions
  drag-drop.js      // only DnD listeners
  modal-edit.js
  history.js        // undo/redo single stack
```

### Two parallel history systems

| Real | Dead |
|------|------|
| `editMode.pendingChanges` + `undoLastChange` | `redoStack` / `changeLog` / `performUndo` / `performRedo` |

**Habit:** one history model. Delete or finish the header undo/redo — never leave both.

### Mutation style

Edits mutate `fetData` immediately, track reverse ops in `pendingChanges`. Fine for desktop admin, but:

- Cancel must restore snapshot (**broken today**)
- Save only flushes history + storage — OK if cancel is fixed
- Prefer pure `applyChange(state) → nextState` for testability of moves

### Validation inconsistency

| Path | Strength |
|------|----------|
| Move / DnD | Strong (`validateMoveTarget`) |
| Modal edit | Weaker / hardcoded (`H1/H2` morning, simplified gaps, duplicate subject can false-positive on same slot) |

**Habit:** one validator shared by modal edit, move-mode, and DnD.

### Listener lifecycle

```text
BAD:  render → add listeners (stack)
GOOD: one delegated listener on table; render only stamps data-*
```

### Naming / API hygiene

- `if (!editMode)` vs `if (!editMode.active)`
- Dead symbols (`roomConflicts`, `undoChange`, `refreshTimetable`)
- Inline style injection for move bar (should be CSS class)

---

## Priority fix order

1. **P0** Restore snapshot on cancel  
2. **P0** Stop stacking DnD/click listeners (remove-before-add or delegate)  
3. **P1** Draggable only when cell has lesson; prefer handle-only drag  
4. **P1** Wire multi-select clear to real deletes **or** remove multi-select UI  
5. **P1** Kill or finish header undo/redo against `pendingChanges`  
6. **P2** Extract move/DnD/validate into modules; pure tests for `validateMoveTarget`  
7. **P2** Shared validator for modal + DnD  

---

## Good-habits checklist

- [ ] Enter edit → snapshot  
- [ ] Mutate only through one `applyOp` / `undoOp` API  
- [ ] Cancel → restore snapshot + re-render  
- [ ] Save → persist + clear pending + new snapshot  
- [ ] Listeners attached once (delegation)  
- [ ] DnD and modal use same validation  
- [ ] No dead alternate undo stacks  
- [ ] Empty cells not draggable  

---

## Key symbols (current)

| Symbol | Role |
|--------|------|
| `editMode` | Session state: active, teacher, pendingChanges, originalTimetable, moveMode |
| `addCellClickHandlers` / `removeCellClickHandlers` | Click + HTML5 DnD bind/unbind |
| `handleDragStart` / `handleDragOver` / `handleDrop` / `handleDragEnd` | DnD pipeline |
| `validateMoveTarget` | Pure-ish move validation |
| `performMoveToDestination` | Apply move + pendingChanges + re-render |
| `confirmSlotEdit` | Modal apply + pendingChanges + re-render |
| `undoLastChange` | Real undo (groupId-aware) |
| `cancelEditMode` | Exit path (**missing restore**) |
| `buildOriginalTimetable` | Snapshot on enter edit |

---

## Suggested next implementation

**P0 only (minimal, high impact):**

1. Restore `originalTimetable` into `fetData` on cancel, then re-render.  
2. `removeCellClickHandlers()` before every `addCellClickHandlers()`, or switch to tbody delegation.

**Optional follow-up:** extract `move-validate.js` + `drag-drop.js` and delete the dead undo/multi-select layer.
