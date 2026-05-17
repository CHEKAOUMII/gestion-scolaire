'use strict';
/**
 * Fixture builders for proctor-v2 strict-fairness & coverage exploratory tests
 * (spec `proctor-v2-strict-fairness-coverage`, Phase H tasks 38–41).
 *
 * Each builder produces a fixture targeting a specific bug condition (C1 / C2)
 * or UI plumbing path documented in the spec's design.md
 * §"Exploratory Bug Condition Checking" table:
 *
 *   - buildC1SingleClassGapInput()   → C1: 147 proctors all in one eligibility
 *                                          class, 368 guard tasks, D_expected=15
 *                                          → bounds [2, 3], pre-fix yields a
 *                                          max-min gap of 4 on primaryLoad.
 *   - buildC1SoftPenaltyWinsInput()  → C1: 2-class fixture where T_busy is at
 *                                          primaryLoad = upperBound + 1 with a
 *                                          perfect-fit soft profile; T_idle has
 *                                          primaryLoad = 0 and groupMismatch=5.
 *                                          Pre-fix Hungarian picks T_busy.
 *   - buildC2UncoveredTeacherInput() → C2: T_uncov loses every minimum-cost
 *                                          matrix cell to a marginally cheaper
 *                                          peer → exits with primaryLoad = 0.
 *   - buildC2DutyAlreadyCoveredInput() → C2: T has dutyCount = 1, guardCount = 0
 *                                          → primaryLoad = 1; coverage is
 *                                          already satisfied by duty alone, no
 *                                          repair is required.
 *   - buildUiPlumbingStub()          → UI plumbing stub:
 *                                          examCenterConfig.expected_duty_tasks
 *                                          = 15 for buildV2Input verification.
 *
 * The first four builders return self-contained GS2_Input_Contract objects
 * runnable by both the pre-fix snapshot
 * (tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js) and the
 * production v2 module.
 *
 * The fifth (`buildUiPlumbingStub`) returns the raw config the renderer would
 * pass to `buildV2Input` — matching the convention established by
 * `buildC4Input` in proctor-v2-bug-fixtures.js — because UI plumbing is tested
 * at the input-build layer, not the algorithm layer.
 *
 * Node.js-compatible CommonJS module. No external dependencies.
 *
 * _Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6_
 */

// ============================================================
// SHARED HELPERS
// ============================================================

/**
 * Creates a proctor object matching the GS2_Input_Contract proctorsList shape.
 * @param {string} name
 * @param {string} cin       - unique CIN used as exemption/duty key
 * @param {string} [specialty]
 * @param {string} [gender]
 */
function makeProctor(name, cin, specialty, gender) {
  return {
    id: parseInt(cin.replace(/\D/g, ''), 10) || 0,
    teacher_name: name,
    teacher_name_fr: name,
    specialty: specialty || 'عام',
    cin: cin,
    som: '',
    gender: gender || 'ذكر',
    room: ''
  };
}

/**
 * Creates a schedule entry for a given day/period/session combination.
 *
 * @param {Object} opts
 * @param {string} opts.day        - e.g. 'الأول'
 * @param {string} opts.period     - 'صباحا' | 'مساء'
 * @param {string} opts.session    - e.g. 'الحصة الأولى'
 * @param {number} opts.dateDay    - numeric day of month
 * @param {number} opts.dateMonth  - numeric month
 * @param {number} opts.dateYear   - numeric year
 * @param {string} [opts.level]
 * @param {string} [opts.subject]
 */
function makeEntry(opts) {
  return {
    day: opts.day || 'الأول',
    period: opts.period || 'صباحا',
    session: opts.session || 'الحصة الأولى',
    level_name: opts.level || 'الثانية بكالوريا',
    subject_name: opts.subject || 'الرياضيات',
    date_day: String(opts.dateDay || 15),
    date_month: String(opts.dateMonth || 3),
    date_year: String(opts.dateYear || 2026),
    time_from: '08:00',
    time_to: '10:00'
  };
}

/**
 * Creates a room object.
 * @param {string} key
 * @param {string} [levelName]
 */
function makeRoom(key, levelName) {
  return {
    key: key,
    room_num: key,
    roomName: 'قاعة ' + key,
    level_name: levelName || 'الثانية بكالوريا'
  };
}

/**
 * Builds the base options block shared by most fixtures.
 * @param {Array} rooms
 * @param {Object} [overrides]
 */
function makeOptions(rooms, overrides) {
  var base = {
    roomsList: rooms,
    allowHalfdayReuse: false,
    allowDayReuse: true,
    noRoomRepeat: false,
    avoidSpecialty: false,
    respectMorningEvening: false,
    preferMixedGenderPair: false
  };
  if (overrides) {
    var keys = Object.keys(overrides);
    for (var i = 0; i < keys.length; i++) base[keys[i]] = overrides[keys[i]];
  }
  return base;
}

/**
 * Helper: numeric session names "الحصة 1" .. "الحصة N".
 * Single-class gap fixture needs 368 distinct session slots; reusing this is
 * cheaper than hand-rolled Arabic ordinals.
 */
function makeSessionName(idx) {
  return 'الحصة ' + idx;
}

// ============================================================
// C1 — SINGLE-CLASS GAP (the user's reported run)
// ============================================================

/**
 * buildC1SingleClassGapInput — targets Bug Condition C1 with the user's
 * reported numbers: 147 proctors all in one eligibility class, 368 guard
 * tasks, D_expected = 15 → bounds [floor(383/147), ceil(383/147)] = [2, 3].
 *
 * Setup:
 *   - 147 proctors, no exemptions, no duty pin → single eligibility class.
 *   - 92 schedule entries in distinct sessions × 1 room × 4 proctors/room
 *     = 368 guard tasks.
 *   - `allowHalfdayReuse` = true so any teacher can be picked for any session.
 *   - D_expected = 15 → fairness bounds collapse to {2, 3}.
 *
 * Pre-fix bug: F's soft load-penalty (`4 × max(0, primaryLoad − floor) + 0.5`)
 * loses ties to other soft constraints in deeper rounds. By the time the run
 * finishes, some teacher carries primaryLoad ≥ 5 while another sits at 1
 * (max−min ≥ 4). P1 fails: |primaryLoad(T1) − primaryLoad(T2)| > 1 even
 * though T1 and T2 are in the same eligibility class.
 *
 * Expected counterexample: max(primaryLoad) − min(primaryLoad) ≥ 2.
 *
 * _Validates: C1, P1, P2, Requirements 1.1, 1.6_
 *
 * @returns {Object} GS2_Input_Contract
 */
function buildC1SingleClassGapInput() {
  // 147 proctors. All same level/specialty → single eligibility class.
  var proctors = [];
  for (var i = 1; i <= 147; i++) {
    proctors.push(makeProctor(
      'أستاذ_' + i,
      'C1G' + String(i).padStart(3, '0')
    ));
  }

  // 92 entries × 4 proctors/room × 1 room = 368 guard tasks.
  // Spread across 8 halfdays so dutyHalfdays isn't constrained too tightly,
  // and so allowHalfdayReuse=true lets any teacher cover multiple sessions.
  var entries = [];
  var halfdayCounter = 0;
  var halfdays = [
    { day: 'الأول',   period: 'صباحا', dateDay: 10 },
    { day: 'الأول',   period: 'مساء',  dateDay: 10 },
    { day: 'الثاني',  period: 'صباحا', dateDay: 11 },
    { day: 'الثاني',  period: 'مساء',  dateDay: 11 },
    { day: 'الثالث',  period: 'صباحا', dateDay: 12 },
    { day: 'الثالث',  period: 'مساء',  dateDay: 12 },
    { day: 'الرابع',  period: 'صباحا', dateDay: 13 },
    { day: 'الرابع',  period: 'مساء',  dateDay: 13 }
  ];
  // 92 entries spread evenly: 11–12 per halfday.
  for (var ei = 0; ei < 92; ei++) {
    var hd = halfdays[halfdayCounter % halfdays.length];
    halfdayCounter++;
    entries.push(makeEntry({
      day: hd.day,
      period: hd.period,
      session: makeSessionName(ei + 1),
      dateDay: hd.dateDay,
      dateMonth: 3,
      dateYear: 2026
    }));
  }

  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];

  return {
    proctorsList: proctors,
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 2, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: makeOptions(rooms, { allowHalfdayReuse: true }),
    enablePhase3: true,
    // The post-fix algorithm reads this; the pre-fix snapshot ignores it.
    // Default 0 keeps backward-compatibility with snapshot-only runs.
    D_expected: 15
  };
}

// ============================================================
// C1 — SOFT PENALTY WINS OVER FAIRNESS
// ============================================================

/**
 * buildC1SoftPenaltyWinsInput — targets the C1 mode where Hungarian picks an
 * over-loaded teacher because the soft groupMismatch penalty on the idle peer
 * outweighs the soft load-penalty on the busy peer.
 *
 * Setup:
 *   - 2 proctors T_busy and T_idle in the same eligibility class.
 *   - T_busy starts at primaryLoad = 1 (one pre-pinned duty halfday on a
 *     non-conflicting halfday) → loadPenalty = 1 once the cost matrix is
 *     evaluated. Soft profile is perfect-fit for the guard entry: M/E group
 *     matches the entry's morning expectedGroup (=1) so groupMismatch = 0.
 *   - T_idle starts at primaryLoad = 0 BUT belongs to evening group (=2),
 *     mismatching the morning entry → groupMismatch = 5.
 *   - Single guard slot to be filled (proctorsPerRoom = 1).
 *
 * Pre-fix cost ranking (verified by instrumenting the snapshot's
 * costFunction; see design.md §"Exploratory Bug Condition Checking" row 1):
 *   T_busy   = 4 × max(0, 1 − floor=0) + 0.5 (freshness, primaryLoad>0) = 4.5
 *   T_idle   = 0 (load-penalty, primaryLoad=0) + 5 (groupMismatch)      = 5.0
 * Hungarian/greedy picks T_busy → guardCount(T_busy) becomes 1 →
 * primaryLoad(T_busy) = 2 (1 dutyCount + 1 guardCount), primaryLoad(T_idle)
 * stays at 0. With classUpperBound_primary = ceil(G_total / N) =
 * ceil((1 + 0) / 2) = 1, T_busy ends at primaryLoad = 2 > classUpperBound →
 * P2 fails. P1 also fails (|2 − 0| = 2 > 1) AND P3 fails (T_idle uncovered).
 *
 * After the fix, the per-class hard cap returns INFINITY_SENTINEL for T_busy
 * (post-assignment primaryLoad would be 2, classUpperBound = 1), so the
 * matching algorithm picks T_idle instead.
 *
 * Three subtleties this fixture has to get right (see scratch instrumentation
 * notes in spec/tasks.md task 39 commentary):
 *   1. `meAssignments` values MUST be the numeric group ids (1 = morning,
 *      2 = evening) — that's what `task.expectedGroup` is set to inside
 *      phase2Build (≈line 1709 in the snapshot). Arabic strings always
 *      mismatch and produce a 5-point penalty for BOTH teachers, masking
 *      the bug.
 *   2. `dutyData` keys MUST be the date-prefixed 5-part format
 *      `${YYYY-MM-DD}|${day}|${period}|${session}|${subject}` so the
 *      Phase-1 pre-load (≈line 1545) extracts the right halfdayKey via
 *      `parts[0] + '|' + parts[2]`. The legacy 4-part format silently
 *      yields a malformed halfdayKey (`'الأول|الحصة الأولى'`), still
 *      increments dutyCount, but doesn't represent a real halfday clash.
 *   3. T_busy's pre-pinned duty halfday MUST NOT collide with the guard
 *      entry's halfday (otherwise T_busy is filtered out at the
 *      `isOnDutyDuringHalfday` hard-constraint check inside costFunction
 *      and the matrix has only one feasible candidate).
 *
 * _Validates: C1, P1, P2, Requirements 1.1, 1.4_
 *
 * @returns {Object} GS2_Input_Contract
 */
function buildC1SoftPenaltyWinsInput() {
  var T_busy = makeProctor('أستاذ_busy', 'C1S_busy');
  var T_idle = makeProctor('أستاذ_idle', 'C1S_idle');

  // Single guard slot — the assignment row both teachers compete for.
  // Morning of date 2026-03-10 → expectedGroup = 1 (per phase2Build line 1709).
  var guardEntry = makeEntry({
    day: 'الأول',
    period: 'صباحا',
    session: 'الحصة الأولى',
    dateDay: 10,
    dateMonth: 3,
    dateYear: 2026
  });

  // ONE prior duty halfday for T_busy on 2026-03-10 EVENING (a different
  // halfday from the guard entry's morning) so dutyCount(T_busy) = 1 and
  // T_busy is still feasible for the morning guard slot. Date-prefixed
  // 5-part format is required by the snapshot's Phase-1 pre-load (≈1545).
  var dutyData = {};
  var dutyKey = '2026-03-10|الأول|مساء|الحصة الأولى|الرياضيات';
  dutyData[dutyKey] = {};
  dutyData[dutyKey]['C1S_busy'] = true;

  // Wire M/E preference using NUMERIC group ids:
  //   1 = morning, 2 = evening.
  // T_busy → 1 (matches the morning guard entry, perfect-fit).
  // T_idle → 2 (mismatches → groupMismatch = 5).
  var meAssignments = {
    'C1S_busy': 1,
    'C1S_idle': 2
  };

  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];

  return {
    proctorsList: [T_busy, T_idle],
    scheduleEntries: [guardEntry],
    exemptionsData: {},
    dutyData: dutyData,
    meAssignments: meAssignments,
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: makeOptions(rooms, {
      respectMorningEvening: true
    }),
    enablePhase3: false,
    D_expected: 0
  };
}

// ============================================================
// C2 — UNCOVERED ELIGIBLE TEACHER
// ============================================================

/**
 * buildC2UncoveredTeacherInput — targets Bug Condition C2: a teacher who is
 * eligible for at least one session but loses every minimum-cost matrix cell
 * to a marginally cheaper peer, exiting Phase 2 with primaryLoad = 0.
 *
 * Setup:
 *   - 6 proctors all in the same eligibility class:
 *       * 5 generalists (T_peer_1..T_peer_5) — match the entry subject as
 *         specialty conflict, so avoidSpecialty pushes them slightly toward
 *         each other, but they retain a tighter cost profile than T_uncov.
 *       * 1 candidate (T_uncov) carrying a soft penalty stack
 *         (specialty = entry subject + on a different M/E group) so every
 *         min-cost cell is filled by a peer first.
 *   - 5 schedule entries (1 per halfday so allowHalfdayReuse=false stays
 *     binding). 1 room × 1 proctor/room = 5 guard tasks.
 *   - With 5 peers × 1 guard each, every slot can be perfectly covered by
 *     peers alone — T_uncov is never the minimum-cost choice.
 *
 * Pre-fix bug: F's Hungarian/greedy fills all 5 slots with peers; T_uncov
 * exits with guardCount = 0 and dutyCount = 0 → primaryLoad = 0. P3 fails.
 *
 * After the fix, phase2_75CoverageRepair detects T_uncov uncovered and
 * swaps it onto a slot held by an over-loaded peer (any peer at upperBound).
 *
 * _Validates: C2, P3, Requirements 1.2_
 *
 * @returns {Object} GS2_Input_Contract
 */
function buildC2UncoveredTeacherInput() {
  // 5 perfect-fit peers + 1 awkward uncovered candidate.
  var peers = [];
  for (var i = 1; i <= 5; i++) {
    peers.push(makeProctor(
      'أستاذ_peer_' + i,
      'C2U_peer_' + i,
      'عام',
      'ذكر'
    ));
  }
  var T_uncov = makeProctor(
    'أستاذ_uncov',
    'C2U_uncov',
    'الرياضيات',  // matches entry subject → specialty conflict
    'أنثى'
  );

  // 5 distinct halfdays, 1 entry per halfday, 1 room, 1 proctor/room.
  var halfdays = [
    { day: 'الأول',   period: 'صباحا', dateDay: 10 },
    { day: 'الأول',   period: 'مساء',  dateDay: 10 },
    { day: 'الثاني',  period: 'صباحا', dateDay: 11 },
    { day: 'الثاني',  period: 'مساء',  dateDay: 11 },
    { day: 'الثالث',  period: 'صباحا', dateDay: 12 }
  ];
  var entries = [];
  for (var hi = 0; hi < halfdays.length; hi++) {
    var hd = halfdays[hi];
    entries.push(makeEntry({
      day: hd.day,
      period: hd.period,
      session: 'الحصة الأولى',
      dateDay: hd.dateDay,
      dateMonth: 3,
      dateYear: 2026,
      subject: 'الرياضيات'
    }));
  }

  var proctorSpecialties = {};
  for (var p = 0; p < peers.length; p++) {
    proctorSpecialties[peers[p].cin] = peers[p].specialty;
  }
  proctorSpecialties[T_uncov.cin] = T_uncov.specialty;

  // M/E preference: peers all morning-friendly; T_uncov on evening so any
  // morning entry adds a groupMismatch = 5 penalty.
  var meAssignments = {};
  for (var pp = 0; pp < peers.length; pp++) {
    meAssignments[peers[pp].cin] = 'صباحا';
  }
  meAssignments[T_uncov.cin] = 'مساء';

  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];

  return {
    proctorsList: peers.concat([T_uncov]),
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: meAssignments,
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: makeOptions(rooms, {
      avoidSpecialty: true,
      respectMorningEvening: true,
      proctorSpecialties: proctorSpecialties
    }),
    enablePhase3: true,
    D_expected: 0
  };
}

// ============================================================
// C2 — COVERAGE ALREADY SATISFIED BY DUTY
// ============================================================

/**
 * buildC2DutyAlreadyCoveredInput — targets the edge case where a teacher
 * has dutyCount = 1, guardCount = 0 → primaryLoad = 1; coverage is already
 * satisfied without any guard placement. The post-fix repair pass MUST NOT
 * mark this teacher as uncovered.
 *
 * Setup:
 *   - 3 proctors. T_dutied has one user-pinned duty halfday (so
 *     dutyCount(T_dutied) = 1 from the Phase 1 pre-pass). The other two
 *     teachers absorb the guard load.
 *   - 4 guard tasks distributed across 4 halfdays. T_dutied is exempt from
 *     the schedule entries that overlap with their pinned duty halfday so
 *     they cannot accidentally be picked for those sessions.
 *
 * Expected behaviour (both pre-fix and post-fix): T_dutied ends with
 * guardCount = 0 BUT primaryLoad = 1 ≥ 1 → P3 holds. The post-fix coverage
 * repair pass sees primaryLoad(T_dutied) > 0 and skips them.
 *
 * This fixture's purpose is to confirm that the repair pass does NOT
 * over-trigger on duty-only-covered teachers (a regression target).
 *
 * _Validates: C2, P3, Requirements 1.2_
 *
 * @returns {Object} GS2_Input_Contract
 */
function buildC2DutyAlreadyCoveredInput() {
  var T_dutied = makeProctor('أستاذ_dutied', 'C2D_dutied');
  var T_guard1 = makeProctor('أستاذ_guard1', 'C2D_guard1');
  var T_guard2 = makeProctor('أستاذ_guard2', 'C2D_guard2');

  // 4 entries across 4 halfdays.
  var entries = [
    makeEntry({ day: 'الأول',   period: 'صباحا', session: 'الحصة الأولى', dateDay: 10, dateMonth: 3, dateYear: 2026 }),
    makeEntry({ day: 'الأول',   period: 'مساء',  session: 'الحصة الأولى', dateDay: 10, dateMonth: 3, dateYear: 2026 }),
    makeEntry({ day: 'الثاني',  period: 'صباحا', session: 'الحصة الأولى', dateDay: 11, dateMonth: 3, dateYear: 2026 }),
    makeEntry({ day: 'الثاني',  period: 'مساء',  session: 'الحصة الأولى', dateDay: 11, dateMonth: 3, dateYear: 2026 })
  ];

  // T_dutied is on duty for the first halfday morning.
  var dutyData = {};
  var dutyKey = 'الأول|صباحا|الحصة الأولى|الرياضيات';
  dutyData[dutyKey] = {};
  dutyData[dutyKey]['C2D_dutied'] = true;

  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];

  return {
    proctorsList: [T_dutied, T_guard1, T_guard2],
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: dutyData,
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: makeOptions(rooms),
    enablePhase3: true,
    D_expected: 0
  };
}

// ============================================================
// UI PLUMBING STUB — buildV2Input verification
// ============================================================

/**
 * buildUiPlumbingStub — returns the raw renderer-side config the
 * exam-proctors page would feed `buildV2Input`. Mirrors the convention of
 * `buildC4Input` in proctor-v2-bug-fixtures.js: the test for this fixture
 * runs `buildV2Input` directly and asserts that the returned input has
 * `D_expected === 15` (Requirement 2.9 / 2.11).
 *
 * Pre-fix bug: `buildV2Input` does not yet read
 * `examCenterConfig.expected_duty_tasks`, so `input.D_expected` is undefined
 * (or absent) on the pre-fix code path. The exploratory test that consumes
 * this fixture asserts the OPPOSITE on F (assertion fails) and the EXPECTED
 * shape on F' (assertion passes).
 *
 * Returns the raw config objects (not a GS2_Input_Contract) because UI
 * plumbing is verified at the input-build layer, not the algorithm layer.
 *
 * _Validates: UI plumbing, Requirements 1.6, 2.9, 2.11_
 *
 * @returns {{
 *   examCenterConfig: Object,
 *   examDistributionRules: Object,
 *   expectedDExpected: number
 * }}
 */
function buildUiPlumbingStub() {
  return {
    // New-style config: expected_duty_tasks = 15 (the user's reported value).
    examCenterConfig: {
      expected_duty_tasks: 15,
      // Co-existing fields that should NOT be touched by the new plumbing —
      // included so the test asserts D_expected is plumbed without dropping
      // the existing reservesConfig wiring delivered by the prior spec.
      max_reserves_mode: 'fixed',
      max_reserves: 0,
      max_reserves_percent: 0
    },
    // Legacy fields untouched — already plumbed by buildV2Input.
    examDistributionRules: {
      proctorsPerRoom: 1,
      reservesPerSession: 0
    },
    // Convenience: the value the test asserts on input.D_expected.
    expectedDExpected: 15
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  buildC1SingleClassGapInput: buildC1SingleClassGapInput,
  buildC1SoftPenaltyWinsInput: buildC1SoftPenaltyWinsInput,
  buildC2UncoveredTeacherInput: buildC2UncoveredTeacherInput,
  buildC2DutyAlreadyCoveredInput: buildC2DutyAlreadyCoveredInput,
  buildUiPlumbingStub: buildUiPlumbingStub,
  // Re-export helpers so tests can build custom variants.
  makeProctor: makeProctor,
  makeEntry: makeEntry,
  makeRoom: makeRoom,
  makeOptions: makeOptions
};
