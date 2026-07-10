# Plan: Find & Centralize Duplicate Functions

| Field | Value |
|-------|-------|
| **Date** | 2026-07-10 |
| **Status** | Approved (Gate 0 / KD defaults) — implement incrementally |
| **Stack** | Electron 35 · Node.js main · vanilla multi-page JS · better-sqlite3 |
| **Related** | [Full design](./2026-07-10-find-centralize-duplicates.md) · [Inventory SoT](./2026-07-10-duplicate-inventory.md) |

---

## Goal

Find duplicated / near-duplicated functions across the app, then centralize them into **domain-owned shared modules** — without breaking behavior, without dumping everything into `js/utils.js`.

---

## Workflow

| Step | What | Status |
|------|------|--------|
| **1** | Detect stack & pick tooling | ✅ Done |
| **2** | Report duplicates (no code changes) | ✅ Done |
| **3** | Propose centralization plan | ✅ Done (this doc) |
| **4** | Refactor one cluster at a time after approval | 🔄 In progress (PR0 tooling landed) |

### Step 4 rules

1. **One cluster per PR/commit** (large clusters may use ordered sub-commits).
2. Extract shared logic → update all call sites → preserve exact behavior.
3. If two copies behave differently, **flag it** (do not silently pick one).
4. Run tests after each cluster; show the diff before moving on.
5. Do not touch code outside the current cluster.
6. If unsure whether two blocks are the same, **ask**.

---

## Step 1 — Stack & tooling

### Stack

```text
Renderer (HTML + js/pages/*.js)
    → preload.js (window.api)
    → main/ipc/*.js
    → SQLite (better-sqlite3)
```

- No React/Vue; no page bundler.
- Shared renderer code loads via ordered `<script>` tags.
- Main process uses CommonJS `require`.

### Tooling

| Tool | Role |
|------|------|
| **jscpd** (primary) | Token/line clone detection |
| Manual semantic review | Same behavior, different wording |
| Characterization tests then extract | Lock pure behavior before move |
| Existing tests | `npm test`, `npm run test:smoke`, `npm run test:v3` |

### Regenerate report

```bash
npm run dup:report
```

Local output: `.jscpd-report/` (gitignored).

### Baseline (2026-07-10)

| Metric | Value |
|--------|-------|
| Files | 158 |
| Lines | 78,648 |
| Clones | **137** |
| Duplicated lines | **3,042 (3.87%)** |
| Duplicated tokens | 17,101 (4.20%) |

---

## Step 2 — Duplicate inventory (clusters)

Priority ≈ total duplicated lines for the file pair.

| ID | Cluster | Type | Clones | Dup lines | Priority | Confidence |
|----|---------|------|--------|-----------|----------|------------|
| **C1** | `teachers-performance.js` ↔ `tracking-teachers-performance.js` | near + exact | 23 | **914** | **P0** | High |
| **C2** | proctor-v3 `05-coverage-repair` ↔ `07-bimodal-repair` | near | 7 | **397** | **P1** | High |
| **C3** | proctor-v3 place-guards ↔ coverage (+ other phases) | near | 5+ | **104+** | **P1** | High |
| **C4** | `analytics.js` ↔ teachers-performance helpers | near | 5 | 98 | P2 | High |
| **C5** | `timetable-rooms.js` ↔ `timetable-students.js` | near | 6 | 97 | P2 | High |
| **C6** | `ipc-helpers.js` internal | near | 3 | 74 | P3 | High |
| **C7** | teachers-performance internal self-dups | near | 4 | 73 | P2 | Medium |
| **C8** | student-profile ↔ students-list gender helpers | exact/near | 5 | 71 | P2 | High |
| **C9** | proctor-distribution-v2 internal | near | 4 | 66 | — | High (**skip**) |
| **C10** | proctor-v3 orchestrator ↔ phase bootstrap | near | many | ~50–59 / pair | P1 | Medium |
| **C11** | `error-log.js` ↔ `conflict-forensics.js` log I/O | near/exact | 2 | 51 | P2 | High |
| C12–C17 | Long-tail (auth, utils, staff, imports, …) | mixed | rest | &lt;45 each | backlog | Low–Med |

### Critical behavioral difference (C1)

| Function | Difference | Approved resolution |
|----------|------------|---------------------|
| `csvEscape` | Tracking hardens formula injection (`[=+\-@\t\r]`); indicators page only quotes | **Unify on hardened** version for both pages |

---

## Step 3 — Centralization plan

### Placement rules

1. **By domain responsibility** — not one giant Utils file.
2. **Do not grow** `js/utils.js` (already large).
3. **Do not invent** catch-all `main/lib/`.
4. Prefer existing SSOTs before new modules (especially proctor).
5. **New** renderer modules: dual export (`module.exports` + `window`) for Node unit tests + `<script>` tags.
6. Main process: plain `require`.

### Proposed module map

| Cluster | Shared location | Kind | Notes |
|---------|-----------------|------|-------|
| **C1** | `js/shared/teacher-performance-metrics.js` | Pure functions + dual export | Stats, sanitize, rating, `buildTeacherRows`, hardened `csvEscape` |
| **C8** | `js/shared/gender.js` | Pure functions + dual export | Students only; **not** `teachers-list` gender |
| **C5** | `js/shared/timetable-view.js` | Pure/view helpers | Use `MORNING_HOUR_MAP` / `AFTERNOON_HOUR_MAP` from `utils.js`; host page = **`timetable.html`** only |
| **C11** | `main/diagnostics/log-file-io.js` | CommonJS helpers | Rotate / path / parse / redaction |
| **C2/C3/C10** | Reuse `canonical-key.js` + `utils/load-state.js`; orphans only in phase-helpers/swap-ops | Require + bundle rebuild | Do **not** merge phase swap policies |
| **C6** | Stay inside `main/ipc/ipc-helpers.js` | Internal DRY | Preserve auth wrappers |
| **C9** | — | **No work** | Proctor v2 leave alone until deprecation |

### Renderer script order (example)

```html
<script src="js/utils.js"></script>
<script src="js/data/ma-education-labels.js"></script> <!-- if compareSubjects needed -->
<script src="js/shared/teacher-performance-metrics.js"></script>
<script src="js/pages/teachers-performance.js"></script>
```

### Soft dependency (C1)

`buildTeacherRows` may use global `compareSubjects` from `ma-education-labels.js`.  
Prefer **inject via options**; document script order as fallback. Unit-test both paths.

---

## Step 4 — Execution protocol

### Gates

| Gate | Meaning |
|------|---------|
| **Gate 0** | ✅ Approved: harden `csvEscape` on both pages; keep two performance pages separate |
| Design / KD defaults | ✅ Approved |
| Per-cluster | Re-approve only if behavior matrix shows an unknown diff |

### Per-cluster procedure

1. List functions with a **behavioral-diff matrix**.
2. Write **characterization / unit tests** for pure extracts (mandatory for C1).
3. Extract to agreed home; dual-export if renderer shared.
4. Wire call sites + HTML `<script>` tags if needed.
5. Run required tests; re-run `npm run dup:report` for large clusters.
6. One PR; show diff; stop if any unresolved behavioral question.

### Behavioral-diff matrix template

| Function | Equal? | Delta summary | Resolution (shared / wrapper / ask) |
|----------|--------|---------------|-------------------------------------|
| `csvEscape` | no | tracking hardens formula chars | **shared** (hardened) |

### Tests by area

| Area | Minimum |
|------|---------|
| PR0 | lint globs include new paths; `dup:report` works |
| C1 | **mandatory** Node unit tests + lint + smoke; manual page smoke secondary |
| C8 | unit tests recommended + HTML script tags |
| C5 | smoke via `timetable.html` tabs |
| C11 | extend `tests/error-log-unit.test.js` |
| C2 | `npm run test:v3` + full `npm test` + **rebuild and commit** `proctor-v3.bundle.js` |

### Program exit (core done when)

- **C1**, **C2/C3**, **C5**, **C8**, **C11** landed
- Inventory metrics refreshed
- **C4** optional; **C9** skipped; long-tail opportunistic only

---

## PR plan (ordered)

### Dependency graph

```text
PR0 (tooling)
 ├── PR-G  (C8 gender — practice run)
 ├── PR1   (C1 teacher metrics) ──► PR1b (charts / analytics optional)
 ├── PR2   (C5 timetable)
 ├── PR3   (C11 log I/O)
 ├── PR5   (C6 ipc-helpers)
 └── PR6  (C2 proctor-v3)  ── process: prefer after safer PRs
         └── PR7 (refresh inventory / backlog)
```

### PR0 — Tooling & inventory ✅ (landed locally)

| | |
|--|--|
| **Title** | `chore(dedup): jscpd script, lint shared globs, duplicate inventory doc` |
| **Files** | `package.json` (`dup:report`, lint/format `js/shared/**`, `js/data/**`); inventory + plan docs; `.gitignore` → `.jscpd-report/` |
| **Impact** | No runtime behavior change |

### PR-G — Student gender helpers (C8)

| | |
|--|--|
| **Title** | `refactor(dedup): extract student gender helpers (C8)` |
| **New** | `js/shared/gender.js` |
| **Touch** | `js/pages/students-list.js`, `js/pages/student-profile.js`; HTML: `students-list.html`, **`student-profile-prototype.html`** |
| **Do not** | Fold in `teachers-list.js` gender (different API) |

### PR1 — Teacher performance pure metrics (C1)

| | |
|--|--|
| **Title** | `refactor(dedup): extract teacher performance metrics helpers (C1 pure)` |
| **New** | `js/shared/teacher-performance-metrics.js` + unit tests |
| **Touch** | `teachers-performance.js`, `tracking-teachers-performance.js` + HTML script tags |
| **Sub-commits** | **1a** strings/stats/sanitize/`csvEscape` · **1b** rating/pill · **1c** `buildTeacherRows` + injected `compareSubjects` |
| **Leave local** | DOM / chart renderers |

### PR1b — Charts / analytics (optional)

Wire residual chart lifecycle + `analytics.js` as third consumer of pure helpers.

### PR2 — Timetable rooms/students (C5)

| | |
|--|--|
| **New** | `js/shared/timetable-view.js` |
| **Touch** | `js/pages/timetable-rooms.js`, `timetable-students.js`; **`timetable.html`** only |
| **Out of DoD** | Standalone `timetable-rooms.html` / `timetable-students.html` (inline forks) unless separate follow-up |
| **Must use** | Hour maps from `js/utils.js` — no local H1–H4 maps |

### PR3 — Diagnostics log I/O (C11)

| | |
|--|--|
| **New** | `main/diagnostics/log-file-io.js` |
| **Touch** | `error-log.js`, `conflict-forensics.js` + unit tests |
| **Preserve** | Public log APIs and redaction field lists |

### PR5 — ipc-helpers micro-DRY (C6)

Internal only in `main/ipc/ipc-helpers.js`. Preserve auth semantics. Smoke test.

### PR6 — Proctor-v3 (C2/C3/C10) — highest risk

| | |
|--|--|
| **Order** | (1) Replace local keys with `canonicalProctorKey` · (2) Align load mutators with `load-state.js` via matrix · (3) Extract proven-identical orphans only |
| **Must** | `npm run build:v3-bundle` and **commit** `proctor-v3.bundle.js` |
| **Must not** | Unify phase swap policies; touch proctor v2; change fairness semantics |
| **jscpd** | Before/after table for named pairs (at least `05↔07`, `04↔05`) |

### PR7 — Refresh inventory / backlog

Update metrics in inventory doc; optional long-tail only if high-churn and approved.

---

## Key decisions (approved)

| # | Decision |
|---|----------|
| KD1 | jscpd primary; human semantic review secondary |
| KD2 | Work in **clusters**, not 137 raw clones |
| KD3 | Domain modules under `js/shared/` / existing `main/<domain>/` — no mega-utils / no `main/lib/` |
| KD4 | New shared renderer modules dual-export for Node tests |
| KD5 | Two performance pages stay separate; one shared library |
| KD6 | Proctor: reuse `canonical-key` + `load-state` first |
| KD7 | Proctor v2 internal dedup is non-goal |
| KD8 | One cluster per PR; C1 may use ordered sub-commits |
| KD9 | Behavioral-diff matrix required for near-duplicates |
| KD10 | Prefer pure functions before DOM/Chart |
| KD11 | Harden `csvEscape` for both pages (Gate 0) |
| KD12 | Tooling + lint globs first (PR0) |
| KD13 | Mandatory Node unit tests for C1 |
| KD14 | PR6 must rebuild and commit proctor bundle |
| KD15 | Program exit = C1 + C2/C3 + C5 + C8 + C11 |

---

## Non-goals

- Mass rewrite or framework migration
- Introducing a renderer bundler as a prerequisite
- Renaming public APIs for style only
- Growing `js/utils.js` or inventing `main/lib/`
- Deduping `vendor/`, `node_modules/`, or HTML cosmetics (except required proctor bundle regen)
- Auto-refactor without human review per cluster
- Merging student gender with teacher-list gender
- Changing proctor fairness “while we’re here”

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Behavior drift between pages | High | Diff matrix; pure extracts; Gate 0 for csvEscape |
| Proctor fairness regression | High | Full `test:v3`; no policy merge; characterization first |
| Stale proctor bundle | High | Mandatory `build:v3-bundle` + commit |
| Missing `<script>` tags | Medium | Dual export + HTML checklist per PR |
| Soft global `compareSubjects` | Medium | Inject option + tests with/without |
| Lint missing `js/shared` | High | PR0 expanded globs ✅ |
| Timetable standalone HTML forks | Medium | C5 DoD = modular path on `timetable.html` only |

---

## Constraints (recap)

- Small, reviewable commits — **one cluster per commit/PR**.
- Do not touch code outside the current cluster.
- Preserve exact existing behavior; ask when unsure.
- No silent merge of behavioral differences.

---

## Next actions

1. **Commit PR0** (tooling + docs) when ready.
2. Implement **PR-G** (C8 gender) as script-tag rehearsal.
3. Implement **PR1** (C1 teacher metrics) with unit tests and hardened `csvEscape`.
4. Continue PR2 → PR3 → PR5 → PR6 → PR7 as listed above.

---

## References

- Full design (design-review consensus): [`2026-07-10-find-centralize-duplicates.md`](./2026-07-10-find-centralize-duplicates.md)
- Short inventory: [`2026-07-10-duplicate-inventory.md`](./2026-07-10-duplicate-inventory.md)
- Architecture notes: `Claude.md`, `Agents.md`, `Architecture.md`
- Existing shared patterns: `js/shared/timetable-utils.js`, `js/data/system-tag-types.js`
- Proctor SSOT: `js/algorithms/proctor-v3/canonical-key.js`, `utils/load-state.js`
- Main teacher identity (do not conflate with renderer sanitize): `main/teachers/identity.js`
