# Implementation Guide: Timetable Drag & Drop Optimization

> **Date:** 2026-07-19
> **Audience:** Implementing agent (execute top-to-bottom)
> **Design docs:** `docs/drag-drop-analysis.md`, `docs/plans/2026-07-19-timetable-dnd-optimization.md`
> **Files you will edit:** `js/pages/timetable.js`, `js/shared/timetable-move-logic.js`, `css/tailwind-input.css`, `tests/timetable-move-logic.test.js`
> **Verify with:** `npm test` then `npm run lint` (per `AGENTS.md`)

---

## 0. READ FIRST — invariants you must not break

1. **Teacher tab is the only editor.** Do **not** touch `js/pages/timetable-students.js` or `js/pages/timetable-rooms.js`. They are derived read-only views of the *saved* DB snapshot.
2. **No validation-rule changes.** This is perf/cleanup/UX only. `validateMoveTarget`'s six checks must keep identical pass/fail results.
3. **No morning/afternoon "band" clamp.** Morning and afternoon each hold the full `H1–H4`; `periodType` is a separate dimension. `getConsecutivePeriods('H2', 2)` → `['H2','H3']` is correct and stays within one `periodType`. Adding a band clamp is a REGRESSION — a test in this guide locks that.
4. **Keep the pure module DOM-free.** `js/shared/timetable-move-logic.js` must not reference `document`, `window`, or IPC. It must stay `require`-able by Node tests.
5. **Line numbers below are anchors, not guarantees.** Locate by function name / snippet; if a snippet differs, STOP and re-read the file before editing.

Before starting, confirm the baseline builds:
```
npm test
npm run lint
```
Both must pass on the untouched tree. If not, report and stop.

---

## Task order (do in sequence, commit-sized)

- [ ] T1 — Dead-code cleanup
- [ ] T2 — Per-drag class-timetable cache
- [ ] T3 — `dragover` throttle + diff
- [ ] T4 — Surgical DOM update on drop
- [ ] T5 — Room-conflict index (only if profiling still shows cost)
- [ ] T6.1 — `setDragImage()` replaces `setTimeout(0)`
- [ ] T6.2 — Touch/pointer fallback (SEPARATE follow-up; do not bundle)

Run `npm test && npm run lint` after **each** task. Do not proceed if red.

---

## T1 — Dead-code cleanup (zero behavior change)

### T1.1 Remove dead `dataTransfer.setData`
In `handleDragStart` (`js/pages/timetable.js`, ~L2367), delete the `setData` line. Keep `effectAllowed`.

**Before:**
```js
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(_dragSource));
```
**After:**
```js
    e.dataTransfer.effectAllowed = 'move';
    // NOTE: payload intentionally not set — _dragSource (module state) is the source of truth.
    // Native DnD is single-drag; no cross-window transfer is needed.
```
Verify nothing reads it: search the file for `getData(` — there must be **no** occurrences tied to drag.

### T1.2 Remove dead `_editDelegationBound`
Delete its declaration (~L1971 `let _editDelegationBound = false;`) and its assignment inside `ensureEditEventDelegation` (`_editDelegationBound = true;`). The real guard is `tbody.dataset.editDelegation === '1'` — leave that untouched.
Search the file for `_editDelegationBound`: after edit there must be **0** occurrences.

### T1.3 Remove dead CSS
In `css/tailwind-input.css`, delete the rule blocks for `.drop-invalid` (~33376), `.drop-preview` + `.drop-preview::after` (~33397–33409), and `.dragging` (if present ~33301). These are referenced only by `timetable.html.backup`, never by live JS.
Then rebuild the compiled CSS the same way the project already does it (check `package.json` scripts for a `tailwind`/`build:css` script; run it). Do **not** hand-edit `css/tailwind-output.css`.

**T1 acceptance:** `npm run lint` clean; drag still works manually; grep confirms `_editDelegationBound` and the three CSS selectors are gone.

---

## T2 — Per-drag class-timetable cache (fixes F1/F3/F4 hot path)

**Goal:** stop rebuilding the class timetable on every `dragover` and every highlighted cell. Build it once when the drag starts, reuse for the whole drag, drop it on `dragend`.

### T2.1 Add module state
Near `let _dragSource = null;` (~L2343) add:
```js
let _dragClassTimetable = null; // cached class timetable for the active drag session
```

### T2.2 Build once in `handleDragStart`
In `handleDragStart`, right after `_dragSource = {...}` is set and before calling `highlightAvailableSlots`, add:
```js
    _dragClassTimetable = srcData.students ? buildClassTimetable(srcData.students) : null;
```

### T2.3 Reuse it in the validation dep
The renderer wrapper `validateMoveTarget` (~L2577) injects deps `{ getSlotData, isRoomOccupied, buildClassTimetable }`. Change the `buildClassTimetable` dep so that, **during an active drag**, it returns the cached table instead of rebuilding:
```js
            {
                getSlotData,
                isRoomOccupied,
                buildClassTimetable: (className) =>
                    _dragClassTimetable && _dragSource && _dragSource.srcData?.students === className
                        ? _dragClassTimetable
                        : buildClassTimetable(className)
            }
```
Non-drag callers (modal edit, move-mode start) have `_dragSource === null`, so they fall through to the real `buildClassTimetable` — unchanged behavior.

### T2.4 Clear on `dragend`
In `handleDragEnd` (~L2390), add `_dragClassTimetable = null;` alongside `_dragSource = null;`.

### T2.5 (Optional) general memo
If profiling still shows `buildClassTimetable` cost outside drag, wrap it in a `Map` keyed by `className`, and **invalidate** (`cache.clear()`) at the top of every committer: `performMoveToDestination`, `confirmSlotEdit`, `undoLastChange`, and the cancel path. Keep invalidation centralized in one helper `invalidateClassCache()` to avoid stale reads. Skip if not needed.

**T2 acceptance:** dragging over many cells no longer calls `buildClassTimetable` per event (verify by a temporary counter/log, then remove). Highlight colors identical to before. T2 equivalence test (below) green.

---

## T3 — `dragover` throttle + diff (fixes F1)

**Goal:** `handleDragOver` (~L2793) currently re-validates and repaints on every event (~60/s). Skip repeats and coalesce to animation frames.

### T3.1 Add a testable predicate to the pure module
In `js/shared/timetable-move-logic.js`, add and export:
```js
    function hoverKeyChanged(prev, next) {
        return prev !== next; // next = "day|periodType|period"
    }
```
Add `hoverKeyChanged: hoverKeyChanged` to the exported `api` object.

### T3.2 Wire early-exit + rAF in the renderer
Add module state near `_dragSource`:
```js
let _lastHoverKey = null;
let _dragOverFrame = 0;
```
Rewrite the body of `handleDragOver` so it:
1. `e.preventDefault();` (must stay — required for drop).
2. Compute `key = day + '|' + periodType + '|' + period` from `e.currentTarget.dataset`.
3. If `getMoveLogic()?.hoverKeyChanged(_lastHoverKey, key) === false` → return early (dropEffect already set last frame). Fall back to a raw `_lastHoverKey === key` check if the module is absent.
4. Set `_lastHoverKey = key`.
5. If `_dragOverFrame` already queued, return. Else `_dragOverFrame = requestAnimationFrame(() => { _dragOverFrame = 0; <validate + repaint> })`.
6. Move the existing `validateMoveTarget` + `dropEffect` + `.drag-over*` repaint logic inside that rAF callback.

> `dataTransfer.dropEffect` must be set on the real event, not inside rAF, or the cursor lags. Set `dropEffect` synchronously using the cached validity from the last frame for the same key; only recompute inside rAF when the key changes. Simplest correct approach: keep a `_lastHoverValid` boolean, set `e.dataTransfer.dropEffect = _lastHoverValid ? 'move' : 'none'` synchronously, and update `_lastHoverValid` inside the rAF after (re)validating.

### T3.3 Diff instead of full sweep
Replace `document.querySelectorAll('#timetable tbody td.drag-over, ...')` clearing with a tracked array:
```js
let _highlightedDragCells = [];
```
In the rAF callback: remove `drag-over`/`drag-over-ext` only from `_highlightedDragCells`, then set `_highlightedDragCells = _getDragOverCells(target)` and add classes to those. Clear the array (and classes) in `handleDragEnd` and `handleDrop`.

### T3.4 Reset on end
In `handleDragEnd` and at the start of `handleDrop`: `if (_dragOverFrame) cancelAnimationFrame(_dragOverFrame); _dragOverFrame = 0; _lastHoverKey = null; _highlightedDragCells = [];`

**T3 acceptance:** no perceptible lag dragging across a full grid; invalid targets still show `no-drop`; `_hoverKeyChanged` unit test green.

---

## T4 — Surgical DOM update on drop (fixes F2)

**Goal:** stop the full `tbody.innerHTML` rebuild inside `performMoveToDestination` (~L2686). Update only the affected cells; preserve scroll.

### T4.1 Add a surgical updater
Add `function applyMoveToDom(teacher, srcSlots, destSlots)` that, for the current rendered table:
- Clears each source cell: set inner HTML to the empty-cell markup (`<span class="empty-cell">—</span>`), remove any merge (`colspan`, `merged-cell`), keep its `data-*`.
- Fills each destination cell with the moved activity markup (reuse the exact cell-render fragment from `renderTeacherTimetable`, L1635 — extract that fragment into a shared helper `buildActivityCellInner(activity, colorMaps)` and call it from both places to avoid divergence).
- Re-applies colspan/merge for the destination if the moved lesson is a double.

### T4.2 Call it from `performMoveToDestination`
Replace:
```js
    const subjectFilter = document.getElementById('subject-filter')?.value || '';
    renderTeacherTimetable(teacher, subjectFilter);
    if (editMode.active) {
        addCellClickHandlers();
        document.getElementById('timetable-wrapper').classList.add('edit-mode-active');
    }
```
with a surgical update + re-decorate of only the touched cells:
```js
    applyMoveToDom(teacher, srcPeriods.map(p => ({ day: mv.sourceDay, periodType: mv.sourcePeriodType, period: p })),
                          destPeriods.map(p => ({ day: destDay, periodType: destPeriodType, period: p })));
    if (editMode.active) decorateCellsForEdit(); // delegation persists; only (re)set draggable+handles
```

### T4.3 Correctness fallback
If a move changes merge boundaries the surgical path cannot express cleanly (e.g., splitting/joining adjacent lessons in the same period), fall back to the existing full `renderTeacherTimetable(teacher, subjectFilter)`. Prefer correctness over the optimization. Undo (`undoLastChange`) may keep using full re-render initially; migrate it to `applyMoveToDom` only after the move path is proven.

### T4.4 Preserve scroll
Capture `const y = scrollContainer.scrollTop` before the update and restore after (identify the scroll container — likely `.table-responsive`).

**T4 acceptance:** dropping a single and a double lesson updates instantly with no flicker/scroll jump; totals/legend still correct (if the legend depends on the full render, call the legend updater explicitly after the surgical swap); undo/cancel still fully correct.

---

## T5 — Room-conflict index (optional, only if needed)

`isRoomOccupied` (~L2936) linear-scans all teachers per dest period. If T2/T3 already made drags smooth, **skip this.** Otherwise:
- Build `Map<'room|day|periodType|period', teacher>` once per drag in `handleDragStart` (store in module state), invalidate in `handleDragEnd` and every committer.
- Have the `isRoomOccupied` dep consult the index during an active drag; fall back to the linear scan otherwise.
- Behavior must be identical — cover with the equivalence test below.

---

## T6.1 — `setDragImage()` replaces the `setTimeout(0)` hack (fixes F10)

In `handleDragStart`, replace:
```js
    setTimeout(() => {
        cell.classList.add('drag-source');
        if (srcPeriods.length > 1) cell.classList.add('drag-source-double');
    }, 0);
```
with a synchronous custom drag image:
```js
    const ghost = cell.cloneNode(true);
    ghost.style.position = 'absolute';
    ghost.style.top = '-9999px';
    ghost.style.opacity = '0.85';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    // cleanup after the browser has snapshotted it
    requestAnimationFrame(() => ghost.remove());
    cell.classList.add('drag-source');
    if (srcPeriods.length > 1) cell.classList.add('drag-source-double');
```
**T6.1 acceptance:** the dragged ghost is NOT dimmed/striped; the source cell dims immediately with no flash. Verify in light and dark theme.

---

## T6.2 — Touch/pointer fallback (SEPARATE follow-up)

Do **not** bundle with T1–T6.1. When done as its own change:
- On `pointerdown` with `pointerType === 'touch'` over a draggable cell, start a manual drag: track `pointermove` to compute the hovered cell (`document.elementFromPoint`), reuse `_getDragOverCells` + `validateMoveTarget` for highlight/validity, and on `pointerup` over a valid cell call `performMoveToDestination`.
- Reuse ALL existing pure logic — no rule duplication.
- Respect `prefers-reduced-motion` for any transition.

---

## Tests to add — `tests/timetable-move-logic.test.js`

Add these (pure module is the unit-testable layer):

1. **No band clamp (locks invariant #3):**
   ```js
   test('getConsecutivePeriods keeps a double lesson within one periodType (no band clamp)', () => {
       assert.deepStrictEqual(Move.getConsecutivePeriods('H2', 2, 'morning'), ['H2', 'H3']);
       assert.deepStrictEqual(Move.getConsecutivePeriods('H3', 2, 'afternoon'), ['H3', 'H4']);
   });
   ```
2. **Cache equivalence (locks T2):** validating with a prebuilt class timetable passed via `deps.buildClassTimetable = () => prebuilt` yields the same `{valid,...}`/`{valid:false,message}` as building it fresh, for (a) a valid empty destination, (b) a class-busy destination, (c) a gap-creating move.
3. **Gap regression (locks rule 6):** construct a class day `H1,H2,H4` occupied; moving to create `H1,_,H3,H4`-style split → `{valid:false}` with the gap message.
4. **`hoverKeyChanged` predicate (locks T3.1):** `hoverKeyChanged('a|morning|H1','a|morning|H1') === false`; different key `=== true`.
5. **Room-index equivalence (only if T5 done):** index lookup result == linear `isRoomOccupied` for occupied and free slots.

Use the existing `makeTimetables()` / `Move` harness already in the file.

---

## Final verification (run before declaring done)

```
npm test
npm run lint
```
Both green. Then manual pass in edit mode on a real, full timetable:

- [ ] Drag single cell → valid drop → correct render, no flicker/scroll jump.
- [ ] Drag merged double (e.g. `H1-H2`) → both cells move together.
- [ ] Drag onto teacher-busy / class-busy / room-busy target → rejected with correct Arabic message + `no-drop` cursor.
- [ ] Undo restores the moved lesson(s); Cancel restores the whole grid.
- [ ] No lag while dragging across the full grid (T3).
- [ ] Dragged ghost is not dimmed; source dims instantly (T6.1).
- [ ] Light and dark theme both correct.
- [ ] Save → open Students and Rooms tabs → edits reflected (derived views unchanged in behavior).

If any manual check fails, fix before marking the task complete. Report exactly which tier introduced a regression.

---

## Rollback notes

Each tier is independent and revertable:
- T1 is pure deletion (safe).
- T2/T3/T5 add caches/throttles behind `_dragSource`-gated branches — reverting the branch restores the original path.
- T4 keeps `renderTeacherTimetable` intact as the fallback; if `applyMoveToDom` misbehaves, route `performMoveToDestination` back to the full re-render (one-line change) while keeping the rest.
