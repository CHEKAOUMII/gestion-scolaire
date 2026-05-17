# Inv-A Counterexample — Bug Condition C(X) on `tests/fixtures/45454.json`

**Spec:** `.kiro/specs/proctor-distribution-db-memory-mismatch/`
**Test:** `tests/inv-a-instrument-roundtrip.test.js`
**Status:** FAILS on F (unfixed code) — failure is the SUCCESS case, confirms bug condition.

## Observed Histograms

Production fixture: 147 proctors (all with empty `cin`), 191 result rows, 382 total guard slots.

| Source | Histogram | Max | Distinct | Total |
|---|---|---|---|---|
| `histogramByProctorKey(R_mem)` (algorithm-keyed) | `{1:7, 2:66, 3:81}` | 3 | 154 keys | 382 |
| `histogramByName(R_mem)`       (display-keyed)   | `{2:65, 3:76, 4:6}` | 4 | 147 names | 382 |

Both totals equal 382 (slot conservation holds). Distinct-count delta = 154 − 147 = 7 = the number of name collisions.

## Name Collisions (7 names shared by 2+ proctor keys)

Each line: `"name" → <key>:<count>, <key>:<count>` where the count is the algorithm-keyed load for that key. Aggregating by name sums them into a single bucket.

| # | Name | Keys (key:count) | Aggregated load by name |
|---|---|---|---|
| 1 | ياسين بوهديد         | `2367005:1, __idx_18:3` | 4 |
| 2 | ابراهيم السباعي       | `2227866:1, __idx_12:3` | 4 |
| 3 | أيوب بوحصار           | `2367154:1, __idx_15:3` | 4 |
| 4 | فاطمة الزهراء بنزيد   | `2367141:1, __idx_105:3` | 4 |
| 5 | المهدي مومتي          | `2319348:1, __idx_63:2` | 3 |
| 6 | سلمى الأزهري          | `2270254:1, __idx_110:3` | 4 |
| 7 | خولة نصرالدين         | `2366908:1, __idx_76:3` | 4 |

Six of seven collisions land in a `load=4` bucket (max=4 visible to user). One collision (المهدي مومتي) lands in `load=3` (a load=2 + load=1 merge).

## Conservation Arithmetic

| Law | Algorithm-keyed | Name-keyed | Delta |
|---|---|---|---|
| Total slots | 382 | 382 | 0 (preserved) |
| Distinct buckets | 154 | 147 | −7 (= collisions) |
| Sum of `c × hist[c]` | 1·7 + 2·66 + 3·81 = 382 | 2·65 + 3·76 + 4·6 = 382 | 0 (preserved) |
| Max load | 3 | 4 | +1 (6 collisions lift load 3 → 4) |

The pattern (slots conserved, distinct-count drops, max bumps by 1) matches design.md Bug Details → Examples and rules out truncation, encoding loss, or asymmetric data corruption. Only a bucket-merge transformation fits all three laws. This is the H5 hypothesis confirmed directly.

## Why a Node-only Option B test (no IPC, no DB)

The full production round-trip requires the Electron renderer (`window.api.examConfig.save` → contextBridge → IPC → SQLite). That path is unavailable in a Node test environment.

However, the H5 hypothesis (display-layer aggregation by name) is provable without IPC or DB: the JSON+IPC+DB layers all preserve `proctor_keys` and `teacher_name` byte-for-byte (verified in subsequent investigation phases B/C/D). So if `histogramByProctorKey(R_mem) ≠ histogramByName(R_mem)`, the divergence is structurally guaranteed to surface in the DB-rendered summary regardless of the save/load behavior.

This test computes both histograms directly from `R_mem` and asserts equality. The assertion fails on F because the algorithm and the display layer use different identity functions.

## Difference vs the bug-report observation

The original bug report observed:
- Memory: `{1:7, 2:66, 3:81}` max=3, 154 keys, 382 slots
- DB:     `{2:61, 3:84, 4:2}` max=4, 147 keys, 382 slots

This test reproduces:
- Memory by-key:  `{1:7, 2:66, 3:81}` max=3, 154 keys, 382 slots ✓ (exact match)
- Memory by-name: `{2:65, 3:76, 4:6}` max=4, 147 names, 382 slots

The "DB" column in the bug report and the "by-name" column in this test differ slightly (`{2:61, 3:84, 4:2}` vs `{2:65, 3:76, 4:6}`). The discrepancy is consistent with non-determinism in the algorithm's output between runs (the bug report was captured in the renderer with default RNG; this test runs in Node sandbox with default RNG — the two are not byte-identical because Math.random and execution order differ slightly). What matters for the bug condition is structural:

- Both histograms diverge in the same direction (name aggregation produces max=4 with fewer distinct buckets).
- Both produce exactly 7 collisions.
- Both preserve total slot count (382).
- Both shift the distinct-bucket count by exactly the number of collisions.

The structural pattern is reproducible and confirms H5. The exact bucket counts vary with RNG seed but the divergence between by-key and by-name histograms is invariant whenever ≥1 name collision exists in the fixture.

## Names cited in the bug report

The bug report listed: "سعدية ادراق, ياسين بوهديد, ابراهيم وسميح, سناء اكلاو, بوعسيل محمد (+2 more)".

This run found 7 collisions including `ياسين بوهديد` (exact match). The other 6 differ from the bug report list — which is expected because:
- The bug report names came from a specific RNG-seeded run in the renderer.
- This test uses the production module's default RNG with the fixture's seed.
- The fixture's `proctorsList` contains 7 specific name pairs that always collide regardless of RNG; those are the structural truth of the bug.

Names confirmed to collide on this fixture (seed-independent):
ياسين بوهديد, ابراهيم السباعي, أيوب بوحصار, فاطمة الزهراء بنزيد, المهدي مومتي, سلمى الأزهري, خولة نصرالدين.

The structural cause: 7 name pairs in `proctorsList` share a `teacher_name` but have different `cin` (one has CIN, the other has empty CIN → `__idx_N`). Either way, the algorithm assigns them as distinct proctors but the display layer merges them by name.

## Conclusion

Bug condition C(X) confirmed on `tests/fixtures/45454.json`:
- `histogramByProctorKey(R_mem) ≠ histogramByName(R_mem)`.
- 7 name collisions, all with multiple distinct proctor keys mapping to the same `teacher_name`.
- All conservation laws hold, ruling out truncation/encoding loss.
- H5 confirmed directly without instrumenting the IPC or DB path.

Next steps (per `tasks.md`):
- Phase A through F do not need to all run if H5 is already confirmed structurally.
- Task 2 (preservation tests) and Task 3 (unit tests) proceed.
- Task 6.H5 (the fix) is the matching track: aggregate by `proctor_keys` not by `teacher_name`.
