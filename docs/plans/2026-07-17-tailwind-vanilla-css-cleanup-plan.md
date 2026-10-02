# Plan: Finish Tailwind migration (remove remaining vanilla CSS)

**Date:** 2026-07-17  
**Status:** Proposed  
**Scope:** HTML pages, `css/*`, smoke tests, optional markup rewrites  
**Out of scope:** Font Awesome / vendor fonts, Chart.js, third-party assets

---

## 1. Context (audit snapshot)

The app is on a **hybrid** CSS model:

| Layer | Status |
|-------|--------|
| `css/tailwind-output.css` | Loaded by ~50 real app pages |
| Deleted legacy files | Gone (`styles.css`, `design-system.css`, `ux-enhancements.css`, `css/modern-imports.css`, `css/teachers-performance.css`) — smoke enforces this |
| Standalone page CSS still linked | **6 files / 6 pages** (hybrid) |
| Carry-forward vanilla CSS inside `tailwind-input.css` | ~36k lines (tokens + components + legacy) |
| Inline `<style>` blocks | Only allowed on `*-prototype.html` (smoke) |
| Inline `style=""` attributes | Widespread (not smoke-blocked) |

### 1.1 Goal hierarchy

1. **P0 — Single stylesheet contract:** every full page loads only `css/tailwind-output.css` (+ fonts/FA). No extra `css/*.css` links.
2. **P1 — Absorb feature CSS** into `tailwind-input.css` (`@layer components` or documented carry-forward), delete standalone files.
3. **P2 — Shrink carry-forward** by rewriting high-traffic pages to utilities / shared component classes.
4. **P3 — Reduce inline `style=""`** where static; keep dynamic JS-driven styles only when necessary.

Non-goals for this plan:

- Pure utility-only UI with zero custom class names (not realistic short-term).
- Rewriting print engines purely in Tailwind utilities.
- Changing `timetable_body.html` (HTML fragment, not a full page).

---

## 2. Current inventory

### 2.1 Standalone CSS files still in `css/`

| File | Lines (approx) | Linked from | Notes |
|------|----------------|-------------|--------|
| `absence-weekly.css` | ~214 | `absence-weekly.html` | Sheet + print high-contrast layout |
| `exam-sections.css` | ~179 | `exams-proctors`, `exams-rooms`, `exams-schedule` | Shared exam section nav |
| `ed-matrix.css` | ~129 | `exams-proctors.html` | Duty/exemptions matrix grid |
| `setup.css` | ~393 | `setup.html` | Setup wizard card UI |
| `tracking-teachers-performance-print.css` | ~83 | `tracking-teachers-performance.html` | Print / preview grid overrides |
| `print.css` | ~2482 | *(not linked in HTML)* | Already `@import`ed by `tailwind-input.css` |

### 2.2 Pages with extra CSS links (hybrid)

1. `absence-weekly.html` → `absence-weekly.css`
2. `exams-proctors.html` → `exam-sections.css` + `ed-matrix.css`
3. `exams-rooms.html` → `exam-sections.css`
4. `exams-schedule.html` → `exam-sections.css`
5. `setup.html` → `setup.css`
6. `tracking-teachers-performance.html` → `tracking-teachers-performance-print.css`

### 2.3 Carry-forward inside `css/tailwind-input.css`

Approximate structure (line markers may drift after edits):

| Section | Role |
|---------|------|
| `@import 'tailwindcss'` + `@import './print.css'` | Pipeline entry |
| `@theme { … }` | Design tokens |
| **CARRY-FORWARD SHARED CSS** | Former `styles.css`, `ux-enhancements.css`, shell/sidebar, etc. |
| `@layer base` / `@layer components` | Shared product components |
| **CARRY-FORWARD PAGE-SPECIFIC CSS** | Former `modern-imports.css`, `teachers-performance.css`, page fixes |

### 2.4 Special cases

| Item | Policy |
|------|--------|
| `student-profile-prototype.html` | May keep critical `<style>` until fully ported (smoke exemption for `*-prototype.html`) |
| `timetable_body.html` | Fragment; no head CSS — leave alone |
| Vendor `google-fonts.css` / Font Awesome | Keep as separate links (not app vanilla CSS) |

---

## 3. Target architecture

```
HTML pages
  ├── vendor/fonts/google-fonts.css
  ├── vendor/fontawesome/css/all.min.css
  └── css/tailwind-output.css   ← sole app stylesheet

css/tailwind-input.css
  ├── @import tailwindcss
  ├── @import print.css          (print engine; keep until print system redesign)
  ├── @theme tokens
  ├── @layer base
  ├── @layer components
  │     ├── shell / shared components
  │     ├── exam-sections
  │     ├── ed-matrix
  │     ├── setup
  │     ├── absence-weekly
  │     └── tracking-print overrides
  └── (shrinking) carry-forward leftovers

css/*.css remaining long-term
  └── print.css only (imported, not linked from HTML)
```

**Acceptance for P0/P1:** no `href="css/<feature>.css"` except that pages never link `print.css` directly (build import only).

---

## 4. Phased plan

### Phase 0 — Guardrails and baseline (0.5 day)

**Tasks**

1. Record baseline:
   - List of hybrid pages and file sizes (this doc §2).
   - `npm run css:build` + `npm run test:smoke` green.
2. Extend smoke (optional but recommended) so hybrid links cannot regress:
   - Fail if any root `*.html` (except prototypes if needed) links `css/` files other than `tailwind-output.css`.
   - Fail if standalone feature CSS files reappear under `css/` after deletion (allowlist: `print.css`, `tailwind-input.css`, `tailwind-output.css` only after Phase 1).
3. Document class prefixes per feature for safe absorb:
   - `aw-*` → absence-weekly  
   - `exam-section*` → exam-sections  
   - `ed-matrix*`, `--ed-*` → ed-matrix  
   - `setup-*` → setup  
   - `tp-*`, `.ux-pp-sheet .tp-*` → tracking print  

**Exit criteria**

- Baseline smoke green.
- Team agrees phases and order below.

---

### Phase 1 — Remove all extra page CSS links (P0/P1) (~2–3 days)

Absorb each standalone file into `tailwind-input.css`, remove `<link>`, delete file, rebuild CSS, smoke + manual smoke of that page.

#### 1.1 `exam-sections.css` (highest leverage — 3 pages)

| Step | Action |
|------|--------|
| 1 | Move rules into `@layer components` block labeled `/* exam-sections */` in `tailwind-input.css` |
| 2 | Drop `<link rel="stylesheet" href="css/exam-sections.css">` from `exams-proctors.html`, `exams-rooms.html`, `exams-schedule.html` |
| 3 | Delete `css/exam-sections.css` |
| 4 | `npm run css:build`; visual check section nav active/hover/dark mode on all three pages |
| 5 | Run `tests/exam-sections-dom.test.js` if present |

#### 1.2 `ed-matrix.css` (proctors only)

| Step | Action |
|------|--------|
| 1 | Move into `@layer components` (or unlayered if sticky/table overrides require it — match current specificity) |
| 2 | Remove link from `exams-proctors.html` |
| 3 | Delete `css/ed-matrix.css` |
| 4 | Manual: matrix scroll, sticky headers, status colors, dark mode |
| 5 | Run ed-matrix unit/property tests under `tests/ed-matrix-*.test.js` |

#### 1.3 `setup.css`

| Step | Action |
|------|--------|
| 1 | Move into `@layer components` under `/* setup wizard */` |
| 2 | Remove link from `setup.html` |
| 3 | Delete `css/setup.css` |
| 4 | Walk setup flow (create school / license / first user) in light + dark |

#### 1.4 `absence-weekly.css`

| Step | Action |
|------|--------|
| 1 | Move into components (or print-adjacent section) preserving `--aw-*` variables and print rules |
| 2 | Remove link from `absence-weekly.html` |
| 3 | Delete `css/absence-weekly.css` |
| 4 | Screen + `PrintSystem` / print preview for weekly sheet |

#### 1.5 `tracking-teachers-performance-print.css`

| Step | Action |
|------|--------|
| 1 | Merge into `print.css` **or** a small labeled block in `tailwind-input` after print import (prefer next to other print overrides) |
| 2 | Remove link from `tracking-teachers-performance.html` |
| 3 | Delete `css/tracking-teachers-performance-print.css` |
| 4 | Print preview: multi-column grids, break-inside, teacher cards |

#### Phase 1 exit criteria

- [ ] Zero HTML links to feature CSS under `css/` (only `tailwind-output.css` + vendor).
- [ ] `css/` contains only: `tailwind-input.css`, `tailwind-output.css`, `print.css` (imported).
- [ ] `npm run css:build && npm run test:smoke` green.
- [ ] Smoke optionally enforces “no extra css links.”

---

### Phase 2 — Smoke & CI policy (0.5 day)

**Tasks**

1. Update `tests/smoke.js` `runLegacyCssSmoke()`:
   - Keep existing “deleted legacy files” checks.
   - Add allowlist for remaining `css/*.css` files.
   - Add HTML link policy: only `css/tailwind-output.css` for app stylesheets.
2. Document in `Claude.md` / `Agents.md` (short bullet): new page styles go into `tailwind-input.css`, never a new `css/page.css` + link.

**Exit criteria**

- CI fails if someone reintroduces a page-level CSS file link.

---

### Phase 3 — Shrink carry-forward (P2, multi-sprint)

Work page-by-page; do not big-bang rewrite 36k lines.

#### 3.1 Prioritization (suggested)

| Priority | Area | Why |
|----------|------|-----|
| High | Shell: sidebar, topbar, cards, tables, filters | Touches every page |
| High | Settings / imports carry-forward (`modern-imports`) | Dense custom CSS |
| Medium | Teachers performance page CSS | Large carry-forward block |
| Medium | Grades / timetable view fixes | Smaller fix blocks |
| Low | One-off page rules unused by any HTML/JS | Dead CSS deletion |

#### 3.2 Method per feature chunk

1. Grep for class selectors in the carry-forward block.
2. Confirm usage in `*.html` / `js/**/*.js`.
3. If unused → delete.
4. If used on one page → prefer Tailwind utilities in markup + remove rule.
5. If used on many pages → promote to a named `@layer components` class (keep one semantic class).
6. Rebuild CSS; visual check light/dark + RTL.
7. Commit per chunk (small diffs).

#### 3.3 Metrics (optional dashboard)

- Lines in `tailwind-input.css` (target: trending down after Phase 1 absorbs).
- Count of carry-forward section markers.
- Count of unique custom class names used in HTML outside Tailwind utilities.

**Exit criteria (ongoing)**

- No new carry-forward dumps without a ticket.
- Dead CSS removed when touched.

---

### Phase 4 — Inline styles hygiene (P3, opportunistic)

| Type | Action |
|------|--------|
| Static layout in HTML (`style="display:none"` etc.) | Prefer Tailwind (`hidden`, `flex`, spacing utilities) or component classes |
| Dynamic colors/sizes from JS | Prefer CSS variables + classes (`setProperty`, toggle class) over long `element.style` strings |
| Chart/canvas sizing | Keep inline if required by library |
| Prototype critical CSS | Port `student-profile-prototype` then remove `<style>` and drop exemption if desired |

Focus first on high-count pages from audit:

- `exams-proctors.html`, `exams-schedule.html`, `staff-daily-report.html`, timetable pages.

**Exit criteria**

- No requirement for zero `style=""`; reduce static cases on touched pages.

---

### Phase 5 — Print CSS strategy (later)

`print.css` (~2.5k lines) stays imported into the Tailwind pipeline for now.

Future options (pick one later):

1. Keep as dedicated print module (status quo).
2. Split by domain (`print/absence.css`, `print/timetable.css`) still imported once.
3. Align more templates with `PrintSystem` + shared print utilities to shrink rules.

Do **not** block Phase 1–2 on print redesign.

---

## 5. Task checklist (execution order)

### Phase 0

- [ ] Baseline: `npm run css:build`, `npm run test:smoke`
- [ ] Confirm inventory still matches §2 (re-run link grep)
- [ ] Agree smoke allowlist policy

### Phase 1

- [ ] Absorb `exam-sections.css` → remove links on 3 exam pages → delete file
- [ ] Absorb `ed-matrix.css` → remove link → delete file
- [ ] Absorb `setup.css` → remove link → delete file
- [ ] Absorb `absence-weekly.css` → remove link → delete file
- [ ] Absorb `tracking-teachers-performance-print.css` → remove link → delete file
- [ ] `css:build` + smoke + manual page checks

### Phase 2

- [ ] Extend `runLegacyCssSmoke` for extra-link ban + css/ allowlist
- [ ] One-line docs update (Agents.md / Claude.md)

### Phase 3+

- [ ] Dead CSS pass on oldest carry-forward blocks
- [ ] Shell / shared components consolidation
- [ ] Page-specific carry-forward reductions (imports, performance, grades/timetable)
- [ ] Opportunistic inline style cleanup when editing pages

---

## 6. Verification matrix

| Check | Command / method |
|-------|------------------|
| Build | `npm run css:build` |
| Smoke | `npm run test:smoke` |
| Lint | `npm run lint` |
| Exam sections | `node tests/exam-sections-dom.test.js` (if applicable) |
| Ed matrix | `node tests/ed-matrix-*.test.js` or package script if defined |
| Visual | Light + dark, RTL, each hybrid page’s primary flow |
| Print | `PrintSystem.preview` / window print on absence-weekly + tracking-teachers-performance |
| Grep guard | No `href="css/` except `tailwind-output.css` in root HTML |

Suggested one-liner audit after Phase 1:

```powershell
Select-String -Path *.html -Pattern 'href="css/(?!tailwind-output\.css)[^"]+"' | Select-Object Path, Line
```

(Expect no matches on production pages.)

---

## 7. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Specificity change when moving into `@layer components` | Match layer strategy to current file; use unlayered block only if sticky/table rules break |
| Print color / break rules lost | Keep `@media print` blocks intact; test real print preview |
| Dark mode token drift | Use existing CSS variables (`var(--color-*)`), not hard-coded hex where possible |
| Bundle size grows after absorb | Absorb is zero-sum (rules move); size drop comes from Phase 3 dead CSS |
| Regression on exam matrix | Run property tests; manual sticky scroll + status toggle |
| Smoke too strict for prototypes | Keep prototype exemption for `<style>`; still ban extra CSS files |

---

## 8. Definition of done

### Done for this plan’s primary goal (Phase 0–2)

- Every full app page uses a **single** app stylesheet: `css/tailwind-output.css`.
- Feature CSS lives only inside the Tailwind pipeline (or `print.css` import).
- CI/smoke prevents reintroduction of page-level CSS links.
- Manual smoke of previously hybrid pages is green.

### Stretch (Phase 3–5)

- Measurable reduction of carry-forward lines.
- Fewer static inline styles on high-traffic pages.
- Documented print CSS strategy.

---

## 9. Suggested PR breakdown

| PR | Contents |
|----|----------|
| PR1 | Absorb `exam-sections.css` + drop 3 links |
| PR2 | Absorb `ed-matrix.css` |
| PR3 | Absorb `setup.css` |
| PR4 | Absorb `absence-weekly.css` |
| PR5 | Absorb tracking print CSS |
| PR6 | Smoke allowlist + docs bullet |
| PR7+ | Carry-forward shrinkage (one domain per PR) |

Keep PRs small so visual review stays feasible.

---

## 10. Related files

| Path | Role |
|------|------|
| `css/tailwind-input.css` | Source of truth for app CSS |
| `css/tailwind-output.css` | Built artifact (do not hand-edit) |
| `css/print.css` | Print engine (imported) |
| `tests/smoke.js` | `runTailwindOutputSmoke`, `runLegacyCssSmoke` |
| `postcss.config.js` | Build pipeline |
| Root `*.html` | Stylesheet links |

---

## 11. Audit reference (2026-07-17)

- Hybrid pages: 6 (listed in §2.2).
- Standalone feature CSS: 5 linked + `print.css` imported.
- Full pages without `tailwind-output.css`: only `timetable_body.html` (fragment).
- Inline `<style>` in production pages: none (prototype exception only).
- Deleted legacy files already enforced by smoke:  
  `css/design-system.css`, `styles.css`, `ux-enhancements.css`, `css/modern-imports.css`, `css/teachers-performance.css`.
