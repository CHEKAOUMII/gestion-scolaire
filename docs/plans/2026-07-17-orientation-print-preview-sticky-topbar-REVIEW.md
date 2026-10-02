# Review: Orientation Print Preview → Sticky Top Bar (plan vs. reality)

Reviews `docs/plans/2026-07-17-orientation-print-preview-sticky-topbar.md` against the
current codebase (verified 2026-07-17). Goal recap: move the single **معاينة الطباعة**
control into the sticky app-shell header `<header class="header unified-header dashboard-topbar">`.

**Verdict:** Plan is accurate and implementable. Core assumptions all check out against code.
A few refinements below are needed for the JS retry path, the test harness, and print-capture
(which is *already* safe). No blockers.

---

## 1. Verified against code — plan is correct

| Plan claim | Reality | Evidence |
|------------|---------|----------|
| `setupUnifiedHeader()` replaces `header.innerHTML` and destroys static header content | True | `js/utils.js:2220` (`header.innerHTML = ...`), guarded by `data-unified-header` at `:2188` |
| Rebuilt header gains classes `unified-header dashboard-topbar` + `data-unified-header="true"` | True | `js/utils.js:2219`, `:2265` |
| Header found via `main.main-content > .header` | True (`:scope > .header`) | `js/utils.js:2184`, `:2187` |
| Rebuilt `.header-right` holds theme toggle, notifications, divider, year — insert before `#theme-toggle` is a valid target | True; `#theme-toggle` is first child of `.header-right` | `js/utils.js:2241`–`2262` |
| Helper currently mounts into `.page-title-row`, not the sticky header | True | `orientation-topbar-print.js:22`–`40` (`findTitleRow` / `ensureActionsHost`) |
| Static `#print-btn` lives in title-row `.orientation-header-actions` (one instance) | True | `students-orientation.html:64`–`92` |
| Page wires `openPrintPreview` → `PrintSystem.preview({ contentSelector:'#orientation-export-sheet', landscape:true, ... })` via `mountOrientationTopBarPrint` | True | `students-orientation.js:192`–`230`, `:250`–`272` |
| Test asserts print is inside `.page-title-row` and **outside** wiped `.header` | True | `tests/orientation/topbar-print-placement.test.js:28`–`43` |
| `setupUnifiedHeader()` runs on `DOMContentLoaded` (so mount must run after) | True | `js/utils.js:2879`–`2882` |

## 2. `#print-btn` is loaded with `defer` — retry loop is genuinely required

`students-orientation.html:16` loads the helper with `defer`, and both `setupUnifiedHeader()`
and the page module fire on `DOMContentLoaded`. Execution order isn't guaranteed to put unify
first, so the plan's retry-until-header-exists requirement (step 4) is not optional. Confirmed
the current retry loop exists at `students-orientation.js:262`–`266`.

**Refinement (important):** the current mount short-circuits on `result.btn` before retrying:

```js
const result = attach();
if (result && result.btn) return result;   // students-orientation.js:259-260
```

If you keep **Option B** (a static `#print-btn` still in the title-row as a relocation source),
`getElementById('print-btn')` returns that node on the very first `attach()` *before* the sticky
header exists, so `result.btn` is truthy and the function returns early — the button never gets
moved into the sticky bar. Two safe fixes:

- **Prefer Option A** (recommended in the plan): zero static print button in HTML. Then the
  first `attach()` finds no host / no btn until the sticky header is built, and the retry keys on
  header presence. Cleanest.
- If Option B is kept, change the early-return and the retry stop-condition to key on
  *placement* (`isPrintInTopBar` true / button under `.header.dashboard-topbar`), **not** on
  `result.btn` existence. Retry line `:265` currently stops on `r.btn && r.titleRow` — that
  `titleRow` field must be replaced with the sticky-header check.

## 3. Test harness needs more than an assertion rewrite (effort call-out)

`tests/orientation/topbar-print-placement.test.js` uses a hand-rolled mock DOM (`makeDoc`,
`:80`–`275`) that only builds `.page-title-row` + `#orientation-filters` and special-cases the
selector `.main-content > .page-title-row` (`:255`–`257`). To test sticky-header placement you must:

- Add a `.header.unified-header.dashboard-topbar` node with a `.header-right` child to `makeDoc`.
- Teach the mock `querySelector` about the new host selector(s) (`.header.dashboard-topbar`,
  `.header-right`) the way it already special-cases the title row.
- Update the HTML source assertions at `:29`–`43`: under Option A there is **zero** static
  `id="print-btn"` in HTML, so `printIdMatches.length` becomes `0` (not `1`), and the
  "inside page-title-row" ordering checks (`:32`–`37`) must be dropped/inverted.

This is real work beyond a one-line contract flip — budget for it in the same PR (plan step 7).

## 4. Print-capture compatibility is *already* guaranteed (plan step 6 is safe)

`js/print-system.js:299` blanket-excludes `.header` (and `.page-title-row`, and `#print-btn`)
from the captured clone in `_cleanClone`. So moving the button into `.header.dashboard-topbar`
keeps it excluded from print output twice over — no `print-system.js` change needed, and the
risk of the button appearing in the printout is nil. Content still comes from the separate
`#orientation-export-sheet`, unaffected by button location.

## 5. Design note — button style in the topbar

The topbar's own controls are icon buttons `.topbar-icon-btn` (~36–44px, `js/utils.js:2242`+),
while `#print-btn` is a full-label green `.btn.btn-success` (`students-orientation.html:82`).
Dropping it as-is into `.header-right` will look heavier than the surrounding chrome. The plan's
"compact but keep label" CSS guidance (step 5) is the right call; scope it under
`.header.dashboard-topbar .orientation-topbar-actions` and rebuild via `npm run css:build`.

## 6. Minor doc-accuracy fixes to fold into the plan

- Plan's return-value table (step 2) should drop `titleRow` from `{ btn, created, moved }`
  and add the header/host reference, because `students-orientation.js:265` reads `r.titleRow`
  today — that call site must change in lockstep or the retry never stops.
- The HTML comment block at `students-orientation.html:59`–`63` explicitly says "Keep Print
  Preview here — not in `.header-right`". That comment must be inverted (plan step 3 mentions
  updating comments — this is the exact location).
- `isPrintInTopBar` (`orientation-topbar-print.js:105`–`116`) currently returns true only under
  `.page-title-row`; retarget to `.header.dashboard-topbar` / `.header.unified-header` while
  still returning false under `#orientation-filters`.

---

## Files confirmed in scope (matches plan "Files to touch")

- `js/shared/orientation-topbar-print.js` — retarget host, dedup, `isPrintInTopBar`, return shape.
- `students-orientation.html` — remove static print btn (Option A), invert comment `:59`–`63`.
- `js/pages/students-orientation.js` — retry/early-return keyed on sticky header (`:259`–`266`).
- `css/tailwind-input.css` (+ `npm run css:build` → `css/tailwind-output.css`).
- `tests/orientation/topbar-print-placement.test.js` — mock DOM + contract rewrite (§3 above).

No change required: `js/print-system.js` (already excludes `.header` / `#print-btn`).

## Acceptance criteria — unchanged, all achievable

The plan's 5 acceptance criteria remain valid. The only added implementation risk is the
JS retry/early-return interaction (§2) — resolve by adopting Option A.
