# Plan: Timetable Drag & Drop — Optimization & Cleanup

> **Date:** 2026-07-19
> **Status:** Proposed for implementation
> **Scope:** `js/pages/timetable.js`, `js/shared/timetable-move-logic.js`, `css/tailwind-input.css`
> **Analysis:** `docs/drag-drop-analysis.md` (the "what is")
> **History:** `docs/plans/2026-07-09-timetable-tabs-drag-drop-plan-v2.md`, `docs/reviews/2026-07-08-timetable-edit-drag-drop-review.md`
> **Tests:** `tests/timetable-move-logic.test.js`

## 0. Why this round is different

The 2026-07-09 plan targeted **reliability bugs**. Those are now fixed and verified:

- **Cancel restores data** — `restoreTeacherTimetableSnapshot(fetData.timetables, teacher, editMode.originalTimetable)` (~L3175).
- **No listener accumulation** — one delegated binding on `#timetable tbody`, guarded by `dataset.editDelegation`.
- **Dead code removed** — `wouldCreateGap`, `performUndo`/`performRedo` are gone. Redo is intentionally unavailable (single grouped undo stack).
- **The "double lesson crosses noon" concern is a non-issue.** Morning and afternoon **each** hold the full `H1–H4` set; `periodType` is a separate dimension. There is **no band to clamp** — `timetable-move-logic.js` documents this. **Do not add a band clamp.**

So this plan is **purely performance, cleanup, and optional UX** — no behavior/rule changes to validation.

## 1. Baseline (verified)

| Layer | File / anchor | Role |
|-------|---------------|------|
| Pure rules | `timetable-move-logic.js` | `validateMoveTarget`, `causesGapAfterMove`, `hasInternalGap`, `getConsecutivePeriods`, `restoreTeacherTimetableSnapshot`. No DOM/IPC. |
| Thin wrappers | `timetable.js` `getMoveLogic`/`validateMoveTarget` ~2485–2624 | Inject live `fetData` deps. |
| Delegation | `ensureEditEventDelegation` L1984 | Bound once to `#timetable tbody`. |
| Handlers | `handleDragStart` 2345 · `handleDragEnd` 2390 · `handleDrop` 2400 · `handleDragLeave` 2429 · `handleDragOver` 2793 · `_getDragOverCells` 2773 | Native HTML5 DnD. |
| Move engine | `performMoveToDestination` 2686 · `highlightAvailableSlots` 2626 | Mutate `fetData`, then full re-render. |
| Render | `renderTeacherTimetable` 1635 | Rebuilds `tbody.innerHTML`. |

## 2. Prioritized findings

| # | Sev | Finding | Anchor |
|---|-----|---------|--------|
| F1 | HIGH | `validateMoveTarget` runs on **every** `dragover` (~60/s); may rebuild the class timetable each time | `handleDragOver` 2793 |
| F2 | HIGH | Full `tbody` rebuild after every move/undo/cancel (flicker, scroll loss) | `performMoveToDestination` 2686 → `renderTeacherTimetable` 1635 |
| F3 | MED | `highlightAvailableSlots` validates every cell on dragstart; `buildClassTimetable` recomputed per cell | 2626 / 2436 |
| F4 | MED | `buildClassTimetable` never memoized (O(teachers×days×8) per call) | 2436 |
| F5 | MED | `isRoomOccupied` linear-scans all teachers per dest period | 2936 |
| F6 | MED | No touch/pointer fallback (native DnD dead on tablets) | — |
| F7 | LOW | Dead `dataTransfer.setData('text/plain', …)` (never read) | ~2367 |
| F8 | LOW | Dead `_editDelegationBound` variable | ~1971 |
| F9 | LOW | Dead CSS: `.drop-invalid`, `.drop-preview`, `.dragging` | `tailwind-input.css` ~33376–33409 |
| F10 | LOW | Fragile `setTimeout(0)` drag-ghost hack | ~2370 |

## 3. Plan

### Tier 1 — Dead-code cleanup (quick, zero risk)
- **T1.1 (F7)** Remove the `setData('text/plain', JSON.stringify(_dragSource))` line, or, if cross-window DnD is ever wanted, switch `handleDrop` to read it via `getData()` and mark it intentional. Default: remove.
- **T1.2 (F8)** Delete `_editDelegationBound` (declaration + assignment); the `dataset.editDelegation` guard is the real gate.
- **T1.3 (F9)** Delete `.drop-invalid`, `.drop-preview`, `.dragging` from `css/tailwind-input.css` (only referenced by `timetable.html.backup`). Rebuild Tailwind output.

### Tier 2 — Hot-path perf: cache class timetable per drag (F1, F3, F4)
- **T2.1** In `handleDragStart`, when `srcData.students` exists, build the class timetable **once** and stash it in a module ref `let _dragClassTimetable = null`. Clear it in `handleDragEnd`.
- **T2.2** Route the `validateMoveTarget` deps to reuse `_dragClassTimetable` for the duration of the drag instead of calling `buildClassTimetable` per invocation. Keep the existing `buildClassTimetable` fallback for the non-drag paths (modal, move-mode start).
- **T2.3** Optional general memo: `buildClassTimetable(className)` cached in a `Map`, invalidated on any commit (`performMoveToDestination`, `confirmSlotEdit`, `undoLastChange`, cancel). Keep invalidation centralized to avoid stale reads.

### Tier 3 — Throttle & diff `dragover` (F1)
- **T3.1** Track `_lastHoverKey = 'day|period|periodType'`. If unchanged since the last handled event, return early (dropEffect already set) — no re-validate, no repaint.
- **T3.2** Wrap validate+repaint in a single `requestAnimationFrame`; coalesce bursts (skip if a frame is already queued).
- **T3.3** Replace the full `querySelectorAll('.drag-over, .drag-over-ext')` clear with a tracked `_highlightedDragCells` array; remove only from those, then add to the new set from `_getDragOverCells`.

### Tier 4 — Targeted DOM update on drop (F2)
- **T4.1** Replace the `renderTeacherTimetable` call inside `performMoveToDestination` with a **surgical cell swap**: clear source cell(s), fill destination cell(s), update `data-*` + colspan/merge for the affected cells only. Preserve scroll position.
- **T4.2** Keep `renderTeacherTimetable` as the path for teacher switch / filter change / initial load. Undo may reuse the same surgical updater given the recorded `pendingChanges` group.
- **T4.3** Guard: if a move changes merge boundaries in a way the surgical path can't express cleanly, fall back to full re-render (correctness over cleverness).

### Tier 5 — Room-conflict index (F5, optional)
- **T5.1** Build a `roomBusy` index `Map<'room|day|periodType|period', teacher>` once per drag (or per validation session) so `isRoomOccupied` is O(1) instead of a full teacher scan. Invalidate alongside the class-timetable cache.

### Tier 6 — UX: `setDragImage` + optional touch (F10, F6)
- **T6.1 (F10)** Replace the `setTimeout(0)` hack: build a translucent clone, `e.dataTransfer.setDragImage(clone, x, y)`, then add `.drag-source` synchronously. Removes the ghost/flash race.
- **T6.2 (F6, optional/deferrable)** Pointer-events touch fallback: on `pointerdown`(`pointerType==='touch'`) over a draggable cell, run a manual drag via `pointermove`/`pointerup`, **reusing** `validateMoveTarget` + `_getDragOverCells` + `performMoveToDestination`. No rule duplication.

## 4. Tests

Extend `tests/timetable-move-logic.test.js` (pure module — the only unit-testable layer):
- **Cache equivalence:** validating against a prebuilt `_dragClassTimetable` yields identical `{valid, message}` to rebuilding via `buildClassTimetable` (regression guard for T2).
- **Gap regression:** a move that would split a class day into a gap → `{valid:false}` (locks current rule 6).
- **Consecutive/no-band:** `getConsecutivePeriods('H2', 2)` → `['H2','H3']` stays within one `periodType`; assert **no** band clamp is applied (prevents re-introducing the false v2 P1-1 "bug").
- **Room-index equivalence (if T5):** index lookup == linear `isRoomOccupied` for the same inputs.

Renderer-only logic (rAF throttle, surgical swap) is validated manually + by extracting the pure predicate `_hoverKeyChanged(prev, next)` into a testable helper.

## 5. Verification

- `npm run lint` clean on `timetable.js` and `timetable-move-logic.js`.
- `npm test` green (per `AGENTS.md`: `npm test; npm run lint`).
- Manual, in edit mode on a full timetable:
  - Drag a single cell and a merged double (e.g. `H1-H2`) → highlight, valid drop, undo, cancel-restore all correct.
  - No visible lag while dragging over many cells (F1/F3 fix).
  - No flicker / scroll jump on drop (F2 fix).
  - Re-verify light **and** dark theme drag colors.

## 6. Out of scope

- Students/Rooms tabs (derived read-only views of the saved snapshot).
- IPC/sync capture (unchanged — moves flow through existing `pendingChanges` → `saveAllChanges`).
- Validation **rules** (no rule changes; only their execution cost).
- DB schema (unchanged).

## 7. Suggested order

1. Tier 1 (cleanup) → 2. Tier 2 (class cache) → 3. Tier 3 (dragover throttle) → 4. Tier 4 (surgical drop) → 5. Tier 6.1 (`setDragImage`) → 6. Tier 5 (room index, if profiling shows need) → 7. Tier 6.2 (touch, separate follow-up).

## 8. Open question

Ship touch/pointer support (T6.2) in this round or as a dedicated follow-up? It is the only user-facing behavior addition; T1–T5 + T6.1 are pure perf/cleanup and can land independently.
