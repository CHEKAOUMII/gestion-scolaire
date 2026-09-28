# Exams Module Isolation Plan («تدبير الامتحانات» / «مركز الامتحانات»)

| | |
|---|---|
| **Date** | 2026-08-26 |
| **Status** | Revised after critical code review (findings F1–F8 incorporated) — ready for approval |
| **Scope** | Structural isolation of the exam-management domain: 5 pages, their renderer modules, 2 IPC registrars, 1 repo, 7 DB tables, sync entries |
| **Not in scope** | `exam_count_rules` / `subject_weight_rules` (grading/stage-rules domain), the exam-center workflow **V2 redesign** (`.kiro/specs/exam-center-redesign/`), any behavior change |
| **Prior art** | `docs/plans/2026-07-20-exam-center-independence-plan.md` (data-layer independence C1–C4, DONE + guarded), wave-based refactor pattern from 027-layering-remediation |

> **One-line goal:** gather every piece of exam-management code behind one owned boundary (`js/exams/**` renderer + the already-isolated `main/repos/exams.js` backend), invert the last cross-domain touchpoints, and lock the boundary with guard tests — without changing behavior, file URLs, or the sync contract.

---

## 1. What "isolated" must mean here (verifiable definition)

The exam center is **already independent at the data layer**: reads are snapshot-only, teacher/student fetches happen only at six whitelisted import/assign entry points, and `tests/exam-center-independence-guard.test.js` enforces it. What remains is **structural scatter**: ~20 exam-owned renderer files live in five different directories mixed with generic code, three shell registries reach into the module, two backend couplings bypass the repo boundary, and nothing prevents new exam code from being written back into generic folders.

The module counts as *isolated* when all of these hold:

1. **Single renderer home** — every exam-only script lives under `js/exams/**`; no exam-only file remains in `js/*.js`, `js/data/*`, `js/algorithms/*`, or `js/pages/*`.
2. **Backend home already clean** — all exam SQL stays in `main/repos/exams.js`; both IPC files stay pure auth/validation; the `staff.js` direct-SQL touchpoint on `exam_proctors`/`tests` is replaced by an exported exams-repo detach function.
3. **Declared seam** — a machine-readable manifest (`js/exams/module-manifest.json`) lists the module's public shell registrations (pages, API namespaces, config keys, tables).
4. **Enforced boundary** — a new guard test fails if (a) non-exam renderer code consumes exam globals, (b) exam renderer code imports anything outside an allowlist of shared modules, or (c) exam files appear outside `js/exams/**` except the manifest-listed exceptions.
5. **Stable external contract** — page URLs (`exams-*.html` at repo root), preload namespaces, IPC channel names, sync collections, and access-control keys are **unchanged**, so zero migration risk for users/devices.

Rationale for keeping HTML at the root: page filenames are routing keys (`location.href='exams-proctors.html'`) **and** access-control identities (`js/utils.js` PAGE_VISIBILITY_CATALOG, `main/db/managed-pages.js:34–37`). Moving them would churn those contracts for no isolation gain. This is revisited as an explicitly deferred Phase R (§8).

---

## 2. Current-state map (verified 2026-08-26)

### 2.1 Frontend inventory (everything exam-owned today)

| File | Lines | Loaded only by | Notes |
|---|---|---|---|
| `exams-schedule.html` | 1049 | sidebar | tiny inline script (~25 L, cycle-catalog gate) |
| `js/pages/exams-schedule.js` | 1696 | schedule page | duplicates LS→DB migration inline (L11–40) |
| `exams-proctors.html` | 1026 | sidebar | no inline logic |
| `js/pages/exams-proctors.js` | **6149** | proctors page | largest chunk; orchestrates v2/v3 |
| `js/pages/exams-proctors/periods-panel.js` | 368 | proctors page | DI-style, `module.exports` too |
| `js/pages/exams-proctors/step-labels.js` | 29 | proctors page | pure map |
| `exams-rooms.html` | 204 | sidebar | no inline logic |
| `js/pages/exams-rooms.js` | 1483 | rooms page | reads siblings' config blobs; attendance UI |
| `exams-tests.html` | 155 | sidebar | **entire logic inline (~76 L); no js file exists** |
| `exam-papers.html` | 199 | sidebar («التقويم والنتائج») | possible dead includes |
| `js/pages/exam-papers.js` | 638 | papers page | persists to **localStorage**, not SQLite |
| `js/exam-data-readers.js` | 207 | schedule (+rooms head) | thin typed readers over config keys |
| `js/exam-sections.js` | 356 | schedule/proctors/rooms | + `css/exam-sections.css` (205) |
| `js/exams/ed-matrix-logic.js` | 1221 | proctors page | pure logic, 23 property-test files |
| `js/exams/exam-config-migration.js` | 92 | proctors page | LS→DB migration |
| `js/data/proctor-key-resolver.js` | 105 | rooms, v3 phases | `window.GS2.*` |
| `js/algorithms/proctor-distribution-v2.js` | 4790 | proctors page | standalone algorithm |
| `js/algorithms/proctor-v3.bundle.js` + `js/algorithms/proctor-v3/` | 10164 bundle | proctors page | built by `scripts/build-proctor-v3-bundle.js` |

### 2.2 Backend inventory

| Piece | Location | State |
|---|---|---|
| Repo (all SQL, 27 exported fns over 7 tables) | `main/repos/exams.js` (797 L) | ✅ isolation contract C1–C4 in header + guard test |
| IPC: 25 channels (exams/proctors/rooms/tests/invitations/attendance) | `main/ipc/exams.js` | ⚠️ `examInvitations:*`, `examAttendance:getAll/getBySession` use **unauthenticated `handleRead`** (L85, L102, L106) — contradicts the security direction of commit `a182ca8` |
| IPC: 4 channels (config KV, 13-key whitelist) | `main/ipc/exam-config-data.js` | ✅ (wave-1 refactor already moved its SQL out) |
| Registration | `main/ipc/registerAll.js`:17/:57 and :31/:71 | clean |
| Preload (7 namespaces) | `preload.js`:240–300 | `api.exams/.examProctors/.examInvitations/.examAttendance/.examRooms/.examConfig/.tests` |
| Tables | `exams`, `exam_proctors`, `exam_rooms`, `tests`, `exam_invitations`, `exam_attendance`, `exam_config_data` | `schema.js:217–270` + migrations 2026-05-055…061, 065, 077 |

> **Not this module:** `exam_count_rules`, `subject_weight_rules`, `cycle_profiles.assessment_model`, `main/db/exam-count-defaults.js`, stage-rules seeds — they are the **grading/rules domain** (029). They merely share the word "exam". Do **not** move them.

### 2.3 Sync integration (contract — must stay byte-compatible)

- `entity-registry.js`: `exams` (v2), `tests` (v2), `exam_proctors`, `exam_rooms`, `exam_attendance`, `exam_invitations` — all `snapshot:true`; **`exam_config_data` deliberately excluded from sync** (`capture.js:518–519 exclude:true`) = device-local KV.
- `capture.js`: 17 exam write channels auto-captured; `teachers:delete`/`deleteByYear` cascade lists include `exam_proctors`/`tests` (:186–215).
- Engine hooks (hard-coded names): `TOPO_ORDER_PUT` puts `exams` early (#3) and children late (#22–24) in `engine/helpers.js:10–38`; `PULL_SOFT_FOREIGN_KEYS` for proctors/invitations/attendance in `engine/apply.js:24–34`; `engine/doc-build.js:93–98` special-case for `exam_rooms`.
- `system-backup.js:42–45` backup set includes `exams/tests/exam_rooms/exam_proctors` — **audit whether `exam_invitations`, `exam_attendance`, `exam_config_data` belong there too** (likely yes; fix in Wave 3).

### 2.4 Cross-domain seams (the actual isolation work)

| # | Seam | Direction | Detail |
|---|---|---|---|
| S1 | `main/repos/staff.js:138–175` | staff → exams | Direct SQL `UPDATE exam_proctors SET teacher_id=NULL`, `UPDATE tests …` inside `detachTeacherReferences` — **only backend violation of repo ownership** |
| S2 | `main/teachers/identity.js` | exams → teachers | Whitelisted C2 fetch helper used by repo — legal by contract, keep; declare in manifest |
| S3 | `api.reports.getIdentity*` | rooms page → reports | Used for invitation school-identity resolution (exams-rooms.js:14, :635) — evaluate replacing with `api.settings.get('school_info')` which rooms already falls back to |
| S4 | `exam-papers.js` reads | papers page → 5 domains | Read-only: `teachers.getAll`, `subjects.getAll`, `classes.getAll`, `timetable.get`, `appDefaults.getExamCount(s)` — legitimate consumer reads, keep but declare |
| S5 | Shell registries | shell → exams | `js/sidebar.js:63,:78–83`; `js/utils.js:136–139` (PAGE_VISIBILITY_CATALOG group «مركز الامتحانات»); `main/db/managed-pages.js:34–37`; legacy dead `timetable_body.html:78–82` |
| S6 | Tests | tests → exams | ~25 test files `require()` paths that actually move (the suite is larger: ~85 exam-*related* files, but most pin `js/exams/ed-matrix-logic.js`, which already sits at its final address). HTML-parsing tests are unaffected (pages stay rooted) except any asserting `<script src>` paths — audit once in Wave 1a |
| S7 | Tooling & verification scripts | tooling → exams | `scripts/build-proctor-v3-bundle.js` (source-dir constants + `ENTRY_ID`-style module ids) **plus four fixture/verification scripts referencing moving paths**: `scripts/verify-end-to-end.js`, `verify-fixture.js`, `verify-real-centre.js`, `inspect-fixture-state.js` |

**Reverse coupling is zero**: no non-exam page, page-script, or repo imports any exam global (`ExamDataReaders`, `ExamSections`, `EdMatrixLogic`, `ProctorDistributionV2/V3`, `GS2.buildProctorDisplayMap`, `ExamConfigMigration` are consumed only inside the exam pages + tests). The module's internal pages link to each other only (schedule↔proctors↔rooms).

### 2.5 Known hygiene findings (fix opportunistically in Waves 1–3)

- Unauthenticated read channels (see §2.2 ⚠️) — security inconsistency.
- Lint/format blind spot: `package.json` lint+format globs cover flat `js/pages/*.js` (so today's `js/pages/exams-proctors/` subfolder is **already unlinted**) and have no `js/exams/**` entry at all — any module move without a glob update silently drops these files from lint coverage entirely.
- `filter-manager.js` loaded by all 5 exam HTMLs but **never constructed** anywhere in exam code.
- `exam-papers.html` loads `qualifiant-levels.js` and `ma-education-labels.js` with no usage found in `exam-papers.js`.
- `exams-schedule.js` duplicates `exam-config-migration.js` logic + its own year resolution ignoring shared `getSchoolYear()`.
- `exam-papers.js` handover records live only in **localStorage** (`examPapers_handovers_v2`) — device-local, unsynced, unaudited; its own header defers SQLite.
- Auth-role breadth: `WRITE_ROLES` (incl. ordinary teachers) can wipe proctors via `bulkImport` while `deleteAll` needs admin — review mapping once, don't change silently.

---

## 3. Design decisions (defaults chosen; each reversible before its wave starts)

| D# | Decision | Choice | Why |
|---|---|---|---|
| D1 | Module home (renderer) | `js/exams/**` (exists already for 2 files; extend it) | Matches current partial layout; shorter `<script>` diffs than a new top-level dir |
| D2 | HTML page locations | Keep at repo root (unchanged) | Filenames are routing + access-control keys (§1) |
| D3 | Test path strategy | Update `require()` paths mechanically; **no shims** | Shims would freeze old layout forever; one sed-able commit; repo has precedent of aligning tests with refactors (`4681ff6`) |
| D4 | Proctor v3 | Move source dir + rebuild bundle; keep bundle filename/steps identical | Bundle is generated; only `build-proctor-v3-bundle.js` path constants change |
| D5 | Globals/window names | Unchanged | Inline `onclick=` handlers + `window.GS2`/`window.ProctorDistributionV3` depend on them |
| D6 | Exams-tests page | Extract inline script → `js/exams/pages/exams-tests.js` | Only page whose logic isn't already modular; trivial extraction |
| D7 | Boundary enforcement | New `tests/exams-module-boundary.guard.test.js` modeled on the existing independence guard | House pattern (grep-guards over registries) |
| D8 | Security fix of 3 read channels | Upgrade `examInvitations:getAll`, `examAttendance:getAll/getBySession` to `handleAuthedRead` in Wave 3 | Rationale is **contract consistency**, not safety theater: the sibling exam read channels (`exams:getAll`, `examProctors:getAll`, `tests:getAll`, `examRooms:getAll`) already require a session, and `a182ca8` set this precedent for reports/notifications. Known consequence, accepted explicitly: these reads will fail in «licensed access without login» mode — but the rooms page already partially fails there today via the sibling channels. Vetoable until Wave 3 lands; verified manually then |

---

## 4. Target architecture

```text
js/exams/
  module-manifest.json          ← NEW: pages, namespaces, config keys, tables, allowed imports
  pages/
    exams-schedule.js           ← from js/pages/
    exams-proctors.js           ← from js/pages/
    periods-panel.js            ← from js/pages/exams-proctors/
    step-labels.js              ← from js/pages/exams-proctors/
    exams-rooms.js              ← from js/pages/
    exams-tests.js              ← NEW (extracted inline script)
    exam-papers.js              ← from js/pages/
  exam-data-readers.js          ← from js/
  exam-sections.js              ← from js/
  ed-matrix-logic.js            ← stays (already home)
  exam-config-migration.js      ← stays (already home)
  proctor-key-resolver.js       ← from js/data/
  algorithms/
    proctor-distribution-v2.js  ← from js/algorithms/
    proctor-v3/                 ← from js/algorithms/proctor-v3/
    proctor-v3.bundle.js        ← rebuilt in place by updated script
css/exam-sections.css           ← stays (css/ is generic shell; referenced by URL)

main/repos/exams.js             ← + exported detachTeacherExamRefs(db, teacherId) for S1
main/ipc/{exams,exam-config-data}.js  ← auth upgrades only, D8
```

Allowed shared imports for the module (manifest-enforced): `js/utils.js`, `js/shared/*` (`date-utils`, `dom-helpers`, `auth-session`, `timetable-utils`, `education/*`), `js/notifications.js`, `js/message-system.js`, `js/print-system.js`, `js/sidebar.js`, app chrome (`theme-boot`, `ux-enhancements`), `vendor/xlsx.full.min.js`. Backend allowlist: `./capture-port`, `../teachers/identity`.

Shell registration points (S5) remain where they are — they are the **declared seams**, documented in the manifest and pinned by the guard test, not folded into the module.

---

## 5. Execution waves

Each wave = one commit (Wave 1 deliberately ships two: 1a pure moves, 1b content cleanups), suite green (`npm test` + `npm run lint`) before the next. Pure-move commits carry no behavior change by construction.

### Wave 0 — Baseline + branch precondition

**Precondition — land the in-flight exam WIP first (F1).** This branch currently carries *uncommitted modifications* to 20+ exam files (`exams-{schedule,proctors,rooms}.html`, all four `js/pages/exams-*` scripts + subfolder, `main/repos/exams.js`, `css/exam-sections.css`, `js/exams/ed-matrix-logic.js`, `js/algorithms/proctor-v3/*`, the v3 build script, several tests). Additionally `main` lacks ~10 commits of exam-relevant history that only exist on this line of work: proctor v3 itself (`7b2d222`), the template-escaping security fix (`0d9be7f`), and the ipc wave-1 refactor (`b8552f9`). Isolating on top of dirty WIP would mix refactoring with unrelated behavior change; isolating off `main` would miss half the domain.

1. Commit or merge the working-tree exam WIP so `git status --porcelain | grep -iE 'exam|proctor'` returns empty.
2. Branch `exams-isolation` off **the branch containing that landed WIP** (currently `029-stage-rules-management` HEAD) — never off `main`.
3. Run full suite + lint; record pass/fail counts as the baseline. Snapshot the grep inventory numbers of §2 as the guard's expected values.

### Wave 1 — Renderer consolidation

**Commit 1a — pure moves and path rewrites only (zero content edits):**

1. `git mv` the §2.1 files into the §4 layout; update every `<script src>` in the 5 HTMLs accordingly.
2. Update `scripts/build-proctor-v3-bundle.js` path constants (`V3_DIR`, `OUT_FILE`, `ENTRY_ID`); regenerate the bundle. The bundle diff must contain **path/module-ID string changes only — any logic hunk fails the rebuild-determinism check**.
3. Path rewrites beyond tests (S7): the four fixture/verification scripts — `scripts/verify-end-to-end.js`, `scripts/verify-fixture.js`, `scripts/verify-real-centre.js`, `scripts/inspect-fixture-state.js`.
4. Mechanical `require()` path rewrite in the ~25 affected test files (D3). Audit HTML-parsing tests for `<script src>` path assertions.
5. Extend `package.json` lint+format globs with `js/exams/**/*.js` **excluding `**/*.bundle.js`** — its own commit step. Expected fallout: ~16k lines of algorithm/ed-matrix code get linted for the first time; budget a style-only cleanup commit, never a logic tweak. Without this step every moved file silently exits lint coverage (the existing glob is flat `js/pages/*.js`, which is also why `js/pages/exams-proctors/*.js` escapes lint today).
6. **DoD 1a:** suite + lint green with count parity vs Wave 0; guard skeleton asserts no exam-only file lives outside `js/exams/**`; all 5 repo-root HTML pages still open.

**Commit 1b — content-level cleanups (individually revertible):**

7. Extract `exams-tests.html` inline script → `js/exams/pages/exams-tests.js` (behavior-identical; keep its 4 shared deps).
8. Drop the dead includes (§2.5: `filter-manager.js` ×5 pages; 2 labels files on exam-papers) — re-confirm zero references at execution time, noted per-file in the commit message.
9. **DoD 1b:** pages load and function manually (schedule CRUD, proctors wizard dry-run render, rooms redirect, tests CRUD, papers matrix).

### Wave 2 — Internal normalization (module-internal, still no contracts changed)
1. Deduplicate LS→DB migration in `exams-schedule.js` onto `js/exams/exam-config-migration.js`; route its year resolution through shared `getSchoolYear()` (the `selectedSchoolYear` localStorage key semantics must be preserved exactly — verify against `js/utils.js:2647` first; if divergent, leave year code alone and note why).
2. Adopt `ExamDataReaders` in `exams-rooms.js` where it currently hand-reads the same keys. Splitting up `exams-proctors.js` itself (≥1500-line reduction) is an **optional stretch goal**, deliberately deferred: the V2 redesign (`.kiro/specs/exam-center-redesign/`) will rewrite these pages soon, so heavy internal surgery buys little now — keep review capacity for the moves.
3. Consolidate duplicated Arabic level/label constants from `exams-schedule.js:74–211` onto `js/shared/education/*` catalogs where equivalents exist (skip quietly where none exist).
4. **DoD:** diff-reviewed behavioral equivalence; property-test suites (ed-matrix ×23, proctor-v2 ×~50) untouched and green.

### Wave 3 — Backend seam inversion + hardening
1. S1: add `detachTeacherExamRefs(db, teacherId)` to `main/repos/exams.js` (same UPDATE statements); call it from `repos/staff.js::detachTeacherReferences` inside its existing transaction; delete the inline SQL. Grep-guard extends: no exam-table identifiers in `main/repos/staff.js`.
2. D8: upgrade `examInvitations:getAll`, `examAttendance:getAll/getBySession` from `handleRead` to `handleAuthedRead`. Why the break is acceptable: `requireAuth` (`main/ipc/auth.js:248`) throws `UNAUTHENTICATED` when no session exists, and «licensed access without login» is a supported mode — but the sibling channels listed in D8 already fail there for the same pages, so this aligns stragglers with the established contract rather than creating a new restriction. Verify manually after landing: rooms attendance panel works signed-in, and licensed-no-login degrades to a visible auth error, never a silent empty panel.
3. Audit `system-backup.js` table list → add `exam_invitations`, `exam_attendance`, `exam_config_data` if confirmed missing (they are user data even though device-local).
4. Decide S3: try switching rooms invitation identity fallback order to plain `settings.get('school_info')`; keep `reports.getIdentity` only if diagnostics prove it adds value — either way record decision in manifest.
5. Extend `exam-center-independence-guard.test.js` nit list if needed (C4 comment markers above whitelisted fns — some predate; verify present).
6. **DoD:** staff-delete a teacher with proctor/test rows → rows survive with `teacher_id NULL` (manual check + existing staff-detach tests green); locked/unauthenticated `invoke` on the 3 upgraded channels returns an auth error; rooms page renders correctly signed-in, and in licensed-no-login mode surfaces auth errors instead of silent empty panels.

### Wave 4 — Boundary locks
1. Write `js/exams/module-manifest.json` (public surfaces + allowed imports + known consumers, S4 list included).
2. New guard test enforcing: (a) manifest allowlisted imports only inside `js/exams/**`; (b) zero exam-global consumers outside exam files + tests; (c) `registerAll.js` contains exactly the 2 exam registrations; (d) sync registry holds exactly the 6 declared exam entries + excluded `examConfigData` channels; (e) no exam-only file outside `js/exams/**`.
3. Register the guard in the default test glob (matches how other guards run via `npm test`).
4. **DoD:** intentionally reintroducing a violation in a scratch edit makes `npm test` red; reverting goes green.

### Wave 5 — Docs
AGENTS.md manual-addition section «Exams module isolation» (boundary rules + manifest pointer); `docs/database-schema.md` gets the exam-domain map annotated with the module root; this plan marked Executed with wave outcomes; `.kiro/specs/exam-center-redesign/workflow-redesign-v2-plan.md` §5/§7–8 get a one-line note that file paths changed per this plan (protects the next redesign agent from stale paths).

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Inline `onclick=` handlers lose their functions if wrappers change | D5 keeps global names; Wave 1 DoD includes clicking the affected buttons manually |
| Test-path churn (~25 `require()` files) hides a real breakage | Wave 0 baseline counts; mechanical rename verified by `node --test` exit + count equality |
| v3 bundle regeneration masks regressions (F6) | Regenerate from unchanged sources; assert the diff is path/module-ID strings only — the bundle embeds `ENTRY_ID`-style module ids, so any logic hunk fails the check |
| Newly linted legacy code floods CI with style errors (F3) | Bundle excluded by glob; remaining fallout handled as style-only fixes inside the dedicated lint-glob commit, never touching logic |
| Redesign collision: V2 workflow redesign will rewrite these same 3 pages | Land Waves 1–4 **first**; post-move merge surface is smaller and paths stabilize before V2 starts (notify via Wave 5 note) |
| In-flight WIP + stale base (F1): 20+ dirty exam files on `029-stage-rules-management`; `main` misses ~10 exam-relevant commits | Wave 0 precondition: land/commit the WIP first, then branch off that HEAD — never off `main`, never carrying dirty files into isolation commits |
| Hidden dynamic references to moved paths (string-built requires/srcs) | Wave 1 grep for `exams-schedule.js|proctors/periods-panel|algorithms/proctor` across js/html/main/tests/scripts before committing |

---

## 7. Out of scope (explicit)

- Moving HTML pages to the module tree — see §8 Phase R.
- Making `exam-papers` handovers a synced SQLite entity (that's a feature: follow the write-channel checklist + snapshot/fetch contract; independent plan).
- Any change to grading-side "exam count/weight" rules, sync topology/ordering, or channel names.
- Functional redesign (V2 workflow) — separate spec.

## 8. Deferred Phase R (records-only decision)

Physical relocation of the 5 HTML files into `js/exams/pages/` becomes worthwhile only if filenames stop being access/routing keys — i.e., after a router indirection exists. Until then the cost (registries in `sidebar.js`, `utils.js`, `managed-pages.js`, session bookmarks, user muscle memory) exceeds the benefit. Revisit after the navigation shell sees its next structural change.

---

## 9. Definition of Done (module level)

- [ ] Every §2.1 file lives in `js/exams/**` (except root HTMLs, css, manifest-listed shell seams); §2.4 S1 inverted; D8 applied; manifest + boundary guard active.
- [ ] `grep -rn "js/pages/exams\|js/exam-data-readers\|js/exam-sections\|js/algorithms/proctor\|js/data/proctor-key-resolver"` outside `js/exams/`, updated tests, and the five covered scripts (`build-proctor-v3-bundle.js` + the 4 verify/fixture scripts) → empty.
- [ ] Full suite + lint green **with lint actually covering `js/exams/**`** via the extended glob (bundle excluded); count parity with Wave 0 baseline; manual smoke of the 5 pages passes including the Wave 3 auth-mode checks.
- [ ] Sync round-trip smoke on a seeded fixture: pull/push still orders exams before proctors/rooms/tests; `exam_config_data` never leaves the device.
- [ ] Docs (AGENTS.md, database-schema.md, this plan) updated; V2-spec path note added.
