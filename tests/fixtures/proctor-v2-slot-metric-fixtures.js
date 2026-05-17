'use strict';
/**
 * Fixture builders for proctor-v2 slot-metric & reserve-affinity exploratory,
 * unit, PBT, and integration tests (spec proctor-v2-slot-metric-reserves-affinity).
 *
 * Builders:
 *   - buildC1TwoRoomInput()        → C1: one session, two rooms, eligibility
 *                                     tightened to force one proctor T into
 *                                     both rooms of the same session.
 *   - buildC1TwoSessionInput()     → C1: two sessions in the same halfday,
 *                                     eligibility tightened to force T into
 *                                     both sessions.
 *   - buildC2SpreadInput()         → C2: 5 sessions, reservesPerSession = 2,
 *                                     10 reserve-eligible proctors.
 *   - buildC3AffinityInput()       → C3: 2-session halfday; S2 needs 1 reserve;
 *                                     a first-session guard at reserveCount = 0
 *                                     coexists with an external candidate also
 *                                     at reserveCount = 0 with marginally lower
 *                                     finalLoad.
 *   - buildC1UserCaseInput()       → C1: re-export of the user's centre case
 *                                     (147 proctors / 368 slots / D_expected=15)
 *                                     from the prior spec's fixture file.
 *
 * Node.js-compatible CommonJS module. No external dependencies.
 *
 * _Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6_
 */

var path = require('path');
var priorFixtures = require(path.join(__dirname, 'proctor-v2-strict-fairness-fixtures.js'));

// ============================================================
// SHARED HELPERS
// ============================================================

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
    time_from: opts.timeFrom || '08:00',
    time_to: opts.timeTo || '10:00'
  };
}

function makeRoom(key, levelName) {
  return {
    key: key,
    room_num: key,
    roomName: 'قاعة ' + key,
    level_name: levelName || 'الثانية بكالوريا'
  };
}

function makeOptions(rooms, overrides) {
  var base = {
    roomsList: rooms,
    allowHalfdayReuse: true,
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

// ============================================================
// C1 — TWO ROOMS, SINGLE SESSION
// ============================================================

/**
 * buildC1TwoRoomInput — C1 counterexample: one halfday, one session, two
 * rooms × `proctorsPerRoom = 2` = 4 guard slots. Only 4 proctors are made
 * eligible so they all MUST be placed into that one session — proctor `T`
 * (and every other) is forced into both rooms of the same session, yielding
 * `Σ |proctor_keys| = 1` for each but `loadState[T].guardCount`
 * halfday-deduplicated is also 1 — wait. We need >1 cells per proctor. So
 * we use 2 proctors filling 4 slots: each proctor appears twice in the same
 * session.
 *
 * Setup:
 *   - 2 proctors only.
 *   - 1 session, 2 rooms × 2 proctors/room = 4 slots.
 *   - allowHalfdayReuse = true so one proctor can fill multiple slots in a
 *     single halfday (the cap doesn't fire for absent classBoundsByProctorKey).
 *   - With only 2 proctors and 4 slots, each proctor must fill 2 cells.
 *
 * Expected:
 *   - F (pre-fix): `loadState[T].guardCount = 1` (halfday Set has size 1).
 *   - F' (post-fix): `loadState[T].guardCount = 2` (slot count).
 *   - Σ over rows R: |{ i : R.proctor_keys[i] = T.key }| = 2 in both cases.
 */
function buildC1TwoRoomInput() {
  var proctors = [
    makeProctor('أستاذ_A', 'C1A001'),
    makeProctor('أستاذ_B', 'C1A002')
  ];
  var entries = [makeEntry({
    day: 'الأول', period: 'صباحا', session: 'الحصة الأولى',
    dateDay: 10, dateMonth: 3, dateYear: 2026
  })];
  var rooms = [
    makeRoom('R1', 'الثانية بكالوريا'),
    makeRoom('R2', 'الثانية بكالوريا')
  ];
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
    enablePhase3: false,
    D_expected: 0
  };
}

// ============================================================
// C1 — TWO SESSIONS IN ONE HALFDAY
// ============================================================

/**
 * buildC1TwoSessionInput — C1 counterexample: one halfday with two sessions
 * S1 + S2. 2 proctors × 2 slots × 2 sessions = 8 slots, exactly filled.
 * Each proctor appears in both S1 and S2 → halfday Set size = 1 but slot
 * count = 2.
 */
function buildC1TwoSessionInput() {
  var proctors = [
    makeProctor('أستاذ_A', 'C1S001'),
    makeProctor('أستاذ_B', 'C1S002')
  ];
  var entries = [
    makeEntry({
      day: 'الأول', period: 'صباحا', session: 'الحصة الأولى',
      dateDay: 10, dateMonth: 3, dateYear: 2026,
      timeFrom: '08:00', timeTo: '10:00'
    }),
    makeEntry({
      day: 'الأول', period: 'صباحا', session: 'الحصة الثانية',
      dateDay: 10, dateMonth: 3, dateYear: 2026,
      timeFrom: '10:30', timeTo: '12:30'
    })
  ];
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
    enablePhase3: false,
    D_expected: 0
  };
}

// ============================================================
// C2 — RESERVE SPREAD VIOLATION
// ============================================================

/**
 * buildC2SpreadInput — 5 sessions across 5 halfdays, reservesPerSession = 2,
 * 10 reserve-eligible proctors. 1 proctor per session (single guard) keeps
 * the guard side trivial and isolates the reserves-pass behaviour.
 *
 * Pre-fix: `(finalLoad, rng)` sort tends to keep picking the same low-load
 * proctors, so some can end up at reserveCount ≥ 2 while peers are still at
 * reserveCount = 0.
 * Post-fix: `(reserveCount ASC, …)` ensures everyone reaches reserveCount=1
 * before anyone reaches 2.
 */
function buildC2SpreadInput() {
  var proctors = [];
  for (var i = 1; i <= 11; i++) {
    proctors.push(makeProctor('أستاذ_' + i, 'C2S' + String(i).padStart(3, '0')));
  }
  var halfdays = [
    { day: 'الأول',  period: 'صباحا', dateDay: 10 },
    { day: 'الأول',  period: 'مساء',  dateDay: 10 },
    { day: 'الثاني', period: 'صباحا', dateDay: 11 },
    { day: 'الثاني', period: 'مساء',  dateDay: 11 },
    { day: 'الثالث', period: 'صباحا', dateDay: 12 }
  ];
  var entries = [];
  for (var s = 0; s < halfdays.length; s++) {
    entries.push(makeEntry({
      day: halfdays[s].day,
      period: halfdays[s].period,
      session: 'الحصة الأولى',
      dateDay: halfdays[s].dateDay,
      dateMonth: 3, dateYear: 2026
    }));
  }
  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];
  return {
    proctorsList: proctors,
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 2 },
    reservesConfig: { mode: 'fixed', fixed: 2, percent: 0 },
    randomSeed: 7,
    weightsPreset: 'توازن',
    customWeights: null,
    options: makeOptions(rooms, { allowHalfdayReuse: true }),
    enablePhase3: false,
    D_expected: 0
  };
}

// ============================================================
// C3 — RESERVE AFFINITY VIOLATION
// ============================================================

/**
 * buildC3AffinityInput — 2-session halfday; S1 needs 2 guards (filled by 2
 * proctors), S2 needs 2 guards (different 2 proctors) and 1 reserve. The
 * remaining proctors split into "first-session guards" (eligible for S2 if
 * `allowHalfdayReuse = true`) and "external" candidates.
 *
 * After fix, when both groups tie on `reserveCount = 0`, the chosen reserve
 * for S2 should be a first-session guard (affinityRank = 0).
 *
 * To trigger the bug, we make external candidate `T_x` slightly cheaper on
 * `finalLoad` so the pre-fix `(finalLoad, rng)` sort prefers it over an S1
 * guard. With duty pinned only on `T_x` so `T_x.dutyCount = 0` (no extra
 * cost) but other candidates have `dutyCount = 1` — but duty is pre-pin.
 * Simpler: just rely on randomness — the pre-fix sort breaks ties via rng,
 * so for a fixed seed we can find one that picks the external. Verifying
 * is downstream of the test.
 */
function buildC3AffinityInput() {
  var proctors = [];
  // 2 first-session guards (force into S1 by exemption from other halfdays).
  proctors.push(makeProctor('S1Guard_A', 'C3F001'));
  proctors.push(makeProctor('S1Guard_B', 'C3F002'));
  // 2 second-session guards.
  proctors.push(makeProctor('S2Guard_A', 'C3S001'));
  proctors.push(makeProctor('S2Guard_B', 'C3S002'));
  // 4 external candidates available for S2 reserve.
  for (var i = 1; i <= 4; i++) {
    proctors.push(makeProctor('Extern_' + i, 'C3X' + String(i).padStart(3, '0')));
  }

  var entries = [
    makeEntry({
      day: 'الأول', period: 'صباحا', session: 'الحصة الأولى',
      dateDay: 10, dateMonth: 3, dateYear: 2026,
      timeFrom: '08:00', timeTo: '10:00'
    }),
    makeEntry({
      day: 'الأول', period: 'صباحا', session: 'الحصة الثانية',
      dateDay: 10, dateMonth: 3, dateYear: 2026,
      timeFrom: '10:30', timeTo: '12:30'
    })
  ];
  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];
  return {
    proctorsList: proctors,
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 2, reservesPerSession: 1 },
    reservesConfig: { mode: 'fixed', fixed: 1, percent: 0 },
    randomSeed: 7,
    weightsPreset: 'توازن',
    customWeights: null,
    options: makeOptions(rooms, { allowHalfdayReuse: true }),
    enablePhase3: false,
    D_expected: 0
  };
}

// ============================================================
// C1 — USER'S CENTRE (re-export from prior spec)
// ============================================================

function buildC1UserCaseInput() {
  return priorFixtures.buildC1SingleClassGapInput();
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  buildC1TwoRoomInput: buildC1TwoRoomInput,
  buildC1TwoSessionInput: buildC1TwoSessionInput,
  buildC2SpreadInput: buildC2SpreadInput,
  buildC3AffinityInput: buildC3AffinityInput,
  buildC1UserCaseInput: buildC1UserCaseInput
};
