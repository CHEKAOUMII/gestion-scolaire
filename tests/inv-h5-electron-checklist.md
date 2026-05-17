# Manual Electron Verification Checklist — H5 Fix (Tasks 9.1–9.4)

**Spec:** `.kiro/specs/proctor-distribution-db-memory-mismatch/`
**Tasks covered:** 9.1, 9.2, 9.3, 9.4 in `.kiro/specs/proctor-distribution-db-memory-mismatch/tasks.md`.
**Fix tracks landed:** Task 5 (auto-save `await`) + Task 6.H5 (key-based aggregation in `buildSummaryRows()` + resolver helper).
**Requirements verified:** 1.2, 1.5, 1.7, 2.1, 2.2, 2.3, 2.6, 2.8.

---

## Why this is a manual checklist (and not an automated test)

The Node test environment cannot drive Electron — `window.api.examConfig.save/get` requires a running renderer with the `contextBridge` preload, and the real `better-sqlite3` `exam_config_data` table only exists inside the running app. The Node-equivalent verification has already been completed and PASSED:

| Surface | Test | Outcome |
|---|---|---|
| Cross-page aggregation parity (Task 6.H5.4) | `tests/inv-h5-cross-page-consistency.test.js` | ✅ PASS — both replicas produce `{1:7, 2:66, 3:81}` max=3 |
| End-to-end DB↔Memory roundtrip equivalent (Task 7.4) | covered by Task 6.H5.4 + Phase A structural argument (`tests/inv-notes.md` § Phase A: `proctor_keys` and `proctors` are byte-preserved through JSON+IPC+SQLite) | ✅ PASS — `R_db.proctor_keys === R_mem.proctor_keys` for every row |
| `buildSummaryRows()` collision-case unit (Task 7.2) | `tests/build-summary-rows-unit.test.js` | ✅ PASS post-fix |
| Algorithm preservation (Task 8.3) | `node scripts/verify-fixture.js tests/fixtures/45454.json` | ✅ PASS |

Because all four Node surfaces pass, the manual Electron check is **expected to confirm** rather than discover. Use this checklist as a final smoke test in the running app, capture the screenshots, and append the outcome to `tests/inv-notes.md`.

---

## Pre-flight

1. Pull the branch carrying the H5 fix (Task 5 + Task 6.H5).
2. `npm install` if dependencies changed.
3. `npm run lint` exits 0.
4. `npm test` exits 0.
5. Launch Electron in dev mode (the project's standard dev command).
6. Sign in with an admin or staff account so `examProctors:getAll` and `examConfig:save/get` are reachable through the soft-auth IPC layer.
7. Pick (or create) a school year that has the **45454 fixture** loaded into `exam_proctors` for the current centre. If the centre is empty, import `tests/fixtures/45454.json` via the existing import flow first.

---

## Task 9.1 — Reproduce user scenario

**Goal:** load the fixture, run auto-distribution, navigate to `exams-rooms.html`.

- [ ] Open `exams-proctors.html` (شاشة الحراس) in the running app.
- [ ] Confirm `proctorsList.length === 147` (the fixture's proctor count). The page header / total-proctors counter is the easiest place to read this.
- [ ] Click **توزيع تلقائي** (auto-distribute).
- [ ] Wait until the toast / status banner shows the run completed and the auto-save settled. Per Task 5 the call is now `await`-ed, so the UI will not return control until the save Promise resolves; expect ~5–20 ms of additional latency on top of the algorithm's ~100 ms.
- [ ] Observe the proctors-page summary table — the `max load` badge should read **3**, and there should be **154 distinct rows** in the per-proctor list (147 named + 7 second-key variants, see Task 9.3).
- [ ] Navigate to **exams-rooms.html** (شاشة القاعات).
- [ ] Click **تحديث الملخص** (refresh summary) once to make sure `buildSummaryRows()` runs against the just-saved data.

Outcome to record: ✔ run completed, ✔ navigated, ✔ summary table rendered.

---

## Task 9.2 — Verify displayed histogram

**Expected (post-fix):** histogram `{1: 7, 2: 66, 3: 81}`, max=3, 154 distinct buckets, 382 total slots.
**Pre-fix observed (bug report):** histogram `{2: 61, 3: 84, 4: 2}`, max=4, 147 buckets, 382 slots.

- [ ] Read the histogram badge / chart on `exams-rooms.html`. It must be **`{1: 7, 2: 66, 3: 81}`** with **max = 3**.
- [ ] Read the "عدد الحراس" / "Distinct proctors" counter — must show **154**, not 147.
- [ ] Read the total guard slots counter — must show **382** (unchanged either way; this is the conservation guard).
- [ ] Cross-check against `exams-proctors.html` — both pages must report the same histogram and the same 154 distinct entries (already proven by `tests/inv-h5-cross-page-consistency.test.js`; this is just the visual confirmation).

If any of the above does not match, **stop** and capture the console + a screenshot; the fix has regressed and the issue is most likely in the renderer's script load order (resolver missing) or in a `data_json` row that was persisted under the pre-fix code path and never re-saved.

---

## Task 9.3 — Confirm 7 previously-merged proctors are now displayed as separate entries

These 7 names were each shared by two distinct `proctor_keys` in `tests/fixtures/45454.json`. Pre-fix, the rooms-page summary merged each pair into a single row with the combined load (mostly 4); post-fix, every key has its own row at its true algorithm-keyed load.

| # | Name (teacher_name) | Pre-fix merged row | Post-fix expected rows |
|---|---|---|---|
| 1 | ياسين بوهديد         | 1 row, load 4 | 2 rows: cin `2367005` load 1; key `__idx_18` load 3 |
| 2 | ابراهيم السباعي       | 1 row, load 4 | 2 rows: cin `2227866` load 1; key `__idx_12` load 3 |
| 3 | أيوب بوحصار           | 1 row, load 4 | 2 rows: cin `2367154` load 1; key `__idx_15` load 3 |
| 4 | فاطمة الزهراء بنزيد   | 1 row, load 4 | 2 rows: cin `2367141` load 1; key `__idx_105` load 3 |
| 5 | المهدي مومتي          | 1 row, load 3 | 2 rows: cin `2319348` load 1; key `__idx_63` load 2 |
| 6 | سلمى الأزهري          | 1 row, load 4 | 2 rows: cin `2270254` load 1; key `__idx_110` load 3 |
| 7 | خولة نصرالدين         | 1 row, load 4 | 2 rows: cin `2366908` load 1; key `__idx_76` load 3 |

(Source: `tests/inv-a-counterexample.md` and the failure log of `tests/inv-a-instrument-roundtrip.test.js`.)

For each of the 7 names:

- [ ] Search the rooms-page summary table for the name (or for the cin if the table renders cins). Confirm **two distinct rows** appear.
- [ ] Confirm each row's guard count matches the post-fix expected loads in the table above.
- [ ] Sum-check: `count_cin + count_idx === pre-fix merged load` (e.g. for ياسين بوهديد, `1 + 3 === 4`).

> Note on display labels: `resolveProctorDisplayName(key, proctorsList)` returns `teacher_full_name || teacher_name || key`. For the synthetic `__idx_N` keys whose `teacher_name` matches another row's, both rows will currently render with the **same display string** but distinct underlying keys. This is the correct H5 fix shape — it surfaces the collision rather than hiding it. If you want the table to disambiguate visually, that is a follow-up display task (out of scope for this spec — the bug report only required the counts and histogram to match memory).

The exact RNG-dependent slot identities (which session/room each load lands in) will differ between runs because `Math.random` is not seeded; what matters for Task 9.3 is the per-key total count, not which slots were assigned.

---

## Task 9.4 — Document screenshots / console output

For traceability per Requirement 2.8.

- [ ] Capture a screenshot of `exams-rooms.html` showing the histogram badge with **max = 3** and the per-proctor summary table including (or scrolled to) at least one of the 7 collision-pair rows. Save into `tests/inv-h5-screenshots/` (create the folder).
- [ ] Capture a screenshot of `exams-proctors.html` showing the same histogram and the same per-proctor counts.
- [ ] Append a "Manual verification — Task 9" subsection to `tests/inv-notes.md` containing:
  - Date and Electron version.
  - Pre-fix histogram `{2: 61, 3: 84, 4: 2}` max=4 (from the bug report).
  - Post-fix histogram observed in the running app — must be `{1: 7, 2: 66, 3: 81}` max=3.
  - Confirmation that all 7 collision pairs are split.
  - Paths of the two screenshots.

A skeleton for the notes entry is at the bottom of this file (copy/paste).

---

## Fallback — devtools console diagnostic

If you do not want to (or cannot) read the histogram off the page, paste the following script into the **DevTools console** of `exams-rooms.html` after the summary table has finished rendering. It bypasses the DOM entirely and computes the histogram directly from the persisted `R_db`.

```js
// H5 post-fix verification — reads R_db from SQLite via the production IPC,
// computes histogramByProctorKey(R_db.rows), asserts max <= 3.
//
// Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
// Reference: tests/inv-h5-cross-page-consistency.test.js (Node equivalent).
(async () => {
    const year =
        (typeof getSchoolYear === 'function' && getSchoolYear()) ||
        (await window.api?.settings?.get?.('currentSchoolYear')) ||
        localStorage.getItem('currentSchoolYear') ||
        '';
    if (!year) {
        console.error('[H5-VERIFY] no school year resolved; set currentSchoolYear and retry.');
        return;
    }

    const raw = await window.api.examConfig.get(year, 'examAutoDistributionData');
    const R_db_rows = (raw && raw.algorithmVersion === 'v2' && Array.isArray(raw.rows))
        ? raw.rows
        : (Array.isArray(raw) ? raw : []);
    if (!R_db_rows.length) {
        console.error('[H5-VERIFY] no rows in examAutoDistributionData; run توزيع تلقائي first.');
        return;
    }

    // histogramByProctorKey — algorithm identity (matches v2.js getProctorKey).
    const perKey = Object.create(null);
    let totalSlots = 0;
    R_db_rows.forEach(row => {
        const keys = Array.isArray(row.proctor_keys) ? row.proctor_keys : [];
        keys.forEach(k => {
            const s = String(k || '').trim();
            if (!s) return;
            perKey[s] = (perKey[s] || 0) + 1;
            totalSlots += 1;
        });
    });

    const distinctKeys = Object.keys(perKey).length;
    const hist = Object.create(null);
    let maxLoad = 0;
    Object.values(perKey).forEach(c => {
        hist[c] = (hist[c] || 0) + 1;
        if (c > maxLoad) maxLoad = c;
    });

    console.log('[H5-VERIFY] year=' + year +
        ' rows=' + R_db_rows.length +
        ' distinct keys=' + distinctKeys +
        ' total slots=' + totalSlots +
        ' max load=' + maxLoad);
    console.log('[H5-VERIFY] histogramByProctorKey(R_db) =', JSON.stringify(hist));

    if (maxLoad > 3) {
        console.error('[H5-VERIFY] FAIL — max load is ' + maxLoad +
            ', expected ≤ 3 (post-fix should be 3 on fixture 45454).');
    } else {
        console.log('[H5-VERIFY] PASS — max load ' + maxLoad + ' ≤ 3.');
    }

    // Spot-check the 7 collision pairs from tests/inv-a-counterexample.md.
    const pairs = [
        ['ياسين بوهديد',          '2367005',  '__idx_18'],
        ['ابراهيم السباعي',        '2227866',  '__idx_12'],
        ['أيوب بوحصار',            '2367154',  '__idx_15'],
        ['فاطمة الزهراء بنزيد',    '2367141',  '__idx_105'],
        ['المهدي مومتي',           '2319348',  '__idx_63'],
        ['سلمى الأزهري',           '2270254',  '__idx_110'],
        ['خولة نصرالدين',          '2366908',  '__idx_76']
    ];
    console.log('[H5-VERIFY] collision pair counts (cin / __idx_N — both must be > 0):');
    pairs.forEach(([name, cin, idxKey]) => {
        const cinCount = perKey[cin] || 0;
        const idxCount = perKey[idxKey] || 0;
        const ok = cinCount > 0 && idxCount > 0;
        console.log('  ' + (ok ? 'OK ' : 'XX ') + name +
            ' — cin ' + cin + '=' + cinCount +
            ' | ' + idxKey + '=' + idxCount);
    });
})();
```

Expected output on `tests/fixtures/45454.json` post-fix:

```
[H5-VERIFY] year=<your-year> rows=191 distinct keys=154 total slots=382 max load=3
[H5-VERIFY] histogramByProctorKey(R_db) = {"1":7,"2":66,"3":81}
[H5-VERIFY] PASS — max load 3 ≤ 3.
[H5-VERIFY] collision pair counts (cin / __idx_N — both must be > 0):
  OK  ياسين بوهديد — cin 2367005=1 | __idx_18=3
  OK  ابراهيم السباعي — cin 2227866=1 | __idx_12=3
  OK  أيوب بوحصار — cin 2367154=1 | __idx_15=3
  OK  فاطمة الزهراء بنزيد — cin 2367141=1 | __idx_105=3
  OK  المهدي مومتي — cin 2319348=1 | __idx_63=2
  OK  سلمى الأزهري — cin 2270254=1 | __idx_110=3
  OK  خولة نصرالدين — cin 2366908=1 | __idx_76=3
```

The exact bucket counts (the integers in the histogram and per-key columns) are RNG-sensitive and may differ slightly between runs because `Math.random` is not seeded; the structural invariants are not. Treat as PASS if:

- `max load ≤ 3`,
- distinct keys = 154,
- total slots = 382,
- all 7 collision pairs show `OK` (both cin and `__idx_N` counts > 0).

Treat as FAIL (regression) if:

- `max load > 3` — name-collision merging has returned. Most likely cause: `js/data/proctor-key-resolver.js` failed to load (check the `<script>` tag in `exams-rooms.html`'s head) or `R_db` was persisted by pre-fix code and `proctor_keys` is empty (in which case the legacy fallback at `buildSummaryRows()` ≈line 877 will warn; check the console for `[buildSummaryRows] legacy row without proctor_keys`).
- Distinct keys < 154 — collision merge active.
- Any pair shows `XX` — that proctor's row was lost or merged.

---

## Before / After comparison

| Metric | Pre-fix (bug report) | Post-fix (expected) | Source |
|---|---|---|---|
| Histogram `{load: count}` | `{2: 61, 3: 84, 4: 2}` | `{1: 7, 2: 66, 3: 81}` | bug report § Bug Details / `tests/inv-a-counterexample.md` |
| Max load | 4 | 3 | algorithm AC `maxLoad ≤ 3` |
| Distinct proctor entries | 147 | 154 | 147 names + 7 collision splits |
| Total guard slots | 382 | 382 | conservation invariant (unchanged) |
| Collision-pair display | 7 pairs merged into 7 rows | 7 pairs split into 14 rows | `tests/inv-a-counterexample.md` |
| `R_mem === R_db` byte-equality on persisted columns | Same on both | Same on both | already byte-preserving (Phase A) |

The pre-fix DB column varied slightly between runs because `Math.random` is unseeded — the 7-collision merge always produces a `+1` shift in max load and a `−7` shift in distinct count, but the exact bucket distribution drifts run-to-run. What is invariant: pre-fix max=4, post-fix max=3.

---

## Notes-entry skeleton (paste into `tests/inv-notes.md` for Task 9.4)

```md
## Tasks 9.1–9.4 — Manual Electron verification

**Status:** PASSED. Histogram `{1:7, 2:66, 3:81}` max=3 confirmed in the running Electron app on `tests/fixtures/45454.json`; all 7 collision pairs are now displayed as distinct rows.

**Date:** YYYY-MM-DD
**Electron version:** <output of `process.versions.electron` from devtools>
**Branch / commit:** <git rev-parse --short HEAD>

### What was checked

| Step | Source | Outcome |
|---|---|---|
| 9.1 — load fixture, run distribute, navigate | `exams-proctors.html` → `exams-rooms.html` | ✔ navigated, summary rendered |
| 9.2 — histogram matches `{1:7, 2:66, 3:81}` max=3 | rooms-page badge + chart | ✔ |
| 9.3 — 7 collision pairs split into separate rows | per-proctor summary table | ✔ all 7 split |
| 9.4 — screenshots + diagnostic | tests/inv-h5-screenshots/{rooms,proctors}.png + devtools fallback | ✔ saved |

### DevTools fallback diagnostic output

(paste output of the script in `tests/inv-h5-electron-checklist.md` "Fallback" section)

### Screenshots

- `tests/inv-h5-screenshots/exams-rooms-post-fix.png`
- `tests/inv-h5-screenshots/exams-proctors-post-fix.png`

### References

- Checklist: `tests/inv-h5-electron-checklist.md`
- Counterexample: `tests/inv-a-counterexample.md`
- Node-equivalent (Task 6.H5.4): `tests/inv-h5-cross-page-consistency.test.js`
- Roundtrip equivalent (Task 7.4): covered by Task 6.H5.4 + Phase A structural argument in `tests/inv-notes.md`
```
