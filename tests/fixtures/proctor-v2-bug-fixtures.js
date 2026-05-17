'use strict';
/**
 * Fixture builders for proctor-v2 bug condition tests (tasks 23-27).
 *
 * Each builder produces a valid GS2_Input_Contract targeting a specific bug condition:
 *   - buildC1Input()       → C1: supply > demand, fairness bug
 *   - buildC2Input()       → C2: duty-aware peers, duty ignored in cost
 *   - buildC3FixedInput()  → C3 (fixed mode): reserves never populated
 *   - buildC3PercentInput()→ C3 (percent mode): reserves never populated
 *   - buildC4Input()       → C4: buildV2Input config plumbing (max_reserves_mode not forwarded)
 *
 * All inputs are self-contained (no external dependencies).
 * Node.js-compatible CommonJS module.
 *
 * _Validates: Requirements 1.1, 1.2, 1.3, 1.4, 3.5_
 */

// ============================================================
// SHARED HELPERS
// ============================================================

/**
 * Creates a proctor object matching the GS2_Input_Contract proctorsList shape.
 * @param {string} name
 * @param {string} cin  - unique CIN used as exemption/duty key
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
 * All entries share the same level and subject so eligibility is uniform.
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
 * Builds the base options block shared by all fixtures.
 * @param {Array} rooms
 */
function makeOptions(rooms) {
  return {
    roomsList: rooms,
    allowHalfdayReuse: false,
    allowDayReuse: true,
    noRoomRepeat: false,
    avoidSpecialty: false,
    respectMorningEvening: false,
    preferMixedGenderPair: false
  };
}

// ============================================================
// C1 FIXTURE — Supply > Demand, Fairness Bug
// ============================================================

/**
 * buildC1Input — targets Bug Condition C1.
 *
 * Setup:
 *   - 30 proctors, all eligible for all sessions (no exemptions, no duty)
 *   - 30 schedule entries × 1 room × 1 proctor/room = 30 guard tasks
 *   - Supply = Demand = 30 → lowerBound = floor(30/30) = 1
 *   - allowHalfdayReuse: true so the same teacher CAN be reused across
 *     sessions in the same halfday
 *   - avoidSpecialty: true — 10 proctors have specialties matching the subjects
 *     so they incur a soft penalty (cost+2)
 *
 * Pre-fix bug: with lowerBound=1, teachers with 0 OR 1 guards both have
 * loadPenalty=0. A used generalist (cost=0) ties with an unused specialist
 * (cost=2). The Hungarian solver may arbitrarily pick the used generalist,
 * leaving some teachers with 2 guards while others have 0.
 *
 * The fix adds a 0.5 freshness bonus so unused teachers always win ties.
 *
 * Expected failure on pre-fix: min(finalLoad)=0 while max(finalLoad)≥2.
 *
 * _Validates: C1, Requirements 1.1_
 *
 * @returns {Object} GS2_Input_Contract
 */
function buildC1Input() {
  // 30 proctors: first 10 are specialists (specialty matches subjects below),
  // remaining 20 are generalists. Specialists incur avoidSpecialty penalty.
  var subjects = [
    'الرياضيات', 'الفيزياء', 'العربية', 'الفرنسية', 'التاريخ',
    'الجغرافيا', 'الفلسفة', 'الإنجليزية', 'الإسلامية', 'الاقتصاد'
  ];
  var proctors = [];
  for (var i = 1; i <= 10; i++) {
    // Specialist: specialty matches one of the exam subjects
    proctors.push(makeProctor(
      'متخصص_' + i,
      'CIN' + String(i).padStart(3, '0'),
      subjects[i - 1]  // specialty = subject name
    ));
  }
  for (var j = 11; j <= 30; j++) {
    // Generalist: no specialty conflict
    proctors.push(makeProctor(
      'عام_' + j,
      'CIN' + String(j).padStart(3, '0'),
      'عام'
    ));
  }

  // 30 schedule entries in the SAME halfday (day 1 morning), different sessions.
  // With allowHalfdayReuse=true, the same teacher can be assigned to multiple sessions.
  // With 30 proctors and 30 tasks, lowerBound=floor(30/30)=1.
  // With lowerBound=1: teachers with 0 OR 1 guards both have loadPenalty=0.
  // A used generalist (cost=0) ties with an unused specialist (cost=2).
  // The pre-fix Hungarian may pick the used generalist, causing unfair distribution.
  var sessionNames = [
    'الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة', 'الحصة الرابعة', 'الحصة الخامسة',
    'الحصة السادسة', 'الحصة السابعة', 'الحصة الثامنة', 'الحصة التاسعة', 'الحصة العاشرة',
    'الحصة الحادية عشرة', 'الحصة الثانية عشرة', 'الحصة الثالثة عشرة', 'الحصة الرابعة عشرة',
    'الحصة الخامسة عشرة', 'الحصة السادسة عشرة', 'الحصة السابعة عشرة', 'الحصة الثامنة عشرة',
    'الحصة التاسعة عشرة', 'الحصة العشرون',
    'الحصة الحادية والعشرون', 'الحصة الثانية والعشرون', 'الحصة الثالثة والعشرون',
    'الحصة الرابعة والعشرون', 'الحصة الخامسة والعشرون', 'الحصة السادسة والعشرون',
    'الحصة السابعة والعشرون', 'الحصة الثامنة والعشرون', 'الحصة التاسعة والعشرون',
    'الحصة الثلاثون'
  ];
  // Cycle through subjects so some sessions have specialist-matching subjects
  var entrySubjects = [
    'الرياضيات', 'الفيزياء', 'العربية', 'الفرنسية', 'التاريخ',
    'الجغرافيا', 'الفلسفة', 'الإنجليزية', 'الإسلامية', 'الاقتصاد',
    'الرياضيات', 'الفيزياء', 'العربية', 'الفرنسية', 'التاريخ',
    'الجغرافيا', 'الفلسفة', 'الإنجليزية', 'الإسلامية', 'الاقتصاد',
    'الرياضيات', 'الفيزياء', 'العربية', 'الفرنسية', 'التاريخ',
    'الجغرافيا', 'الفلسفة', 'الإنجليزية', 'الإسلامية', 'الاقتصاد'
  ];
  var entries = [];
  for (var e = 0; e < 30; e++) {
    entries.push(makeEntry({
      day: 'الأول',
      period: 'صباحا',
      session: sessionNames[e],
      dateDay: 10,
      dateMonth: 3,
      dateYear: 2026,
      subject: entrySubjects[e]
    }));
  }

  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];

  // allowHalfdayReuse: true is critical — without it, each teacher can only be
  // used once per halfday, which naturally prevents the C1 bug from manifesting.
  // avoidSpecialty: true creates the soft-constraint interaction that exposes C1.
  // Build proctorSpecialties map for the avoidSpecialty option.
  var proctorSpecialties = {};
  for (var k = 0; k < proctors.length; k++) {
    proctorSpecialties[proctors[k].cin] = proctors[k].specialty;
  }

  var options = {
    roomsList: rooms,
    allowHalfdayReuse: true,   // MUST be true to expose C1
    allowDayReuse: true,
    noRoomRepeat: false,
    avoidSpecialty: true,      // creates soft-constraint interaction
    respectMorningEvening: false,
    preferMixedGenderPair: false,
    proctorSpecialties: proctorSpecialties
  };

  return {
    proctorsList: proctors,
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: options,
    enablePhase3: true
    // No reservesConfig — defaults to { mode:'fixed', fixed:0, percent:0 }
  };
}

// ============================================================
// C2 FIXTURE — Duty-Aware Peers, Duty Ignored in Cost
// ============================================================

/**
 * buildC2Input — targets Bug Condition C2.
 *
 * Setup:
 *   - 2 proctors T1 (CIN_T1) and T2 (CIN_T2) with identical eligibility
 *   - T1 has 2 duty halfdays injected via dutyData
 *   - 4 guard tasks (4 schedule entries × 1 room × 1 proctor/room)
 *
 * Pre-fix bug: costFunction reads getGuardCount, not getPrimaryLoad, so
 * dutyCount is invisible to Hungarian. T1 and T2 get equal guard assignments
 * even though T1 already has 2 duty halfdays → finalLoad(T1) >> finalLoad(T2).
 * Expected failure: |finalLoad(T1) − finalLoad(T2)| ≥ 2.
 *
 * _Validates: C2, Requirements 1.2_
 *
 * @returns {Object} GS2_Input_Contract
 */
function buildC2Input() {
  var T1 = makeProctor('أستاذ_T1', 'CIN_T1');
  var T2 = makeProctor('أستاذ_T2', 'CIN_T2');

  // 4 schedule entries across 4 different halfdays so allowHalfdayReuse=false
  // doesn't prevent either teacher from being assigned multiple times.
  var entries = [
    makeEntry({ day: 'الأول',   period: 'صباحا', session: 'الحصة الأولى',  dateDay: 10, dateMonth: 3, dateYear: 2026 }),
    makeEntry({ day: 'الأول',   period: 'مساء',  session: 'الحصة الأولى',  dateDay: 10, dateMonth: 3, dateYear: 2026 }),
    makeEntry({ day: 'الثاني',  period: 'صباحا', session: 'الحصة الأولى',  dateDay: 11, dateMonth: 3, dateYear: 2026 }),
    makeEntry({ day: 'الثاني',  period: 'مساء',  session: 'الحصة الأولى',  dateDay: 11, dateMonth: 3, dateYear: 2026 })
  ];

  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];

  // Inject duty for T1 on the first two halfdays.
  // dutyData key format: `${YYYY-MM-DD}|${day}|${period}|${session}|${subject_name}`
  // The algorithm also checks the legacy format: `${day}|${period}|${session}|${subject_name}`
  // We use the legacy format here for simplicity (both are checked).
  var dutyData = {};
  var dutyHalfday1 = 'الأول|صباحا|الحصة الأولى|الرياضيات';
  var dutyHalfday2 = 'الأول|مساء|الحصة الأولى|الرياضيات';
  dutyData[dutyHalfday1] = {};
  dutyData[dutyHalfday1]['CIN_T1'] = true;
  dutyData[dutyHalfday2] = {};
  dutyData[dutyHalfday2]['CIN_T1'] = true;

  return {
    proctorsList: [T1, T2],
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: dutyData,
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: makeOptions(rooms),
    enablePhase3: true
  };
}

// ============================================================
// C3-FIXED FIXTURE — Reserves Never Populated (fixed mode)
// ============================================================

/**
 * buildC3FixedInput — targets Bug Condition C3 with fixed mode.
 *
 * Setup:
 *   - 20 proctors, all eligible (no exemptions, no duty)
 *   - 8 schedule entries × 1 room × 1 proctor/room = 8 guard tasks
 *   - reservesConfig = { mode: 'fixed', fixed: 4 }
 *   - eligibleAvailable >> 4 for every session
 *
 * Pre-fix bug: Phase 2 hard-codes reserves:[], reserve_keys:[] and no
 * Phase 2.5 exists. Expected failure: |reserves(S)| = 0 ≠ 4 for every S.
 *
 * _Validates: C3 (fixed), Requirements 1.3, 1.5_
 *
 * @returns {Object} GS2_Input_Contract
 */
function buildC3FixedInput() {
  var proctors = [];
  for (var i = 1; i <= 20; i++) {
    proctors.push(makeProctor(
      'أستاذ_' + i,
      'C3F' + String(i).padStart(3, '0')
    ));
  }

  var entries = [
    makeEntry({ day: 'الأول',   period: 'صباحا', session: 'الحصة الأولى',  dateDay: 10, dateMonth: 4, dateYear: 2026 }),
    makeEntry({ day: 'الأول',   period: 'صباحا', session: 'الحصة الثانية', dateDay: 10, dateMonth: 4, dateYear: 2026 }),
    makeEntry({ day: 'الأول',   period: 'مساء',  session: 'الحصة الأولى',  dateDay: 10, dateMonth: 4, dateYear: 2026 }),
    makeEntry({ day: 'الأول',   period: 'مساء',  session: 'الحصة الثانية', dateDay: 10, dateMonth: 4, dateYear: 2026 }),
    makeEntry({ day: 'الثاني',  period: 'صباحا', session: 'الحصة الأولى',  dateDay: 11, dateMonth: 4, dateYear: 2026 }),
    makeEntry({ day: 'الثاني',  period: 'صباحا', session: 'الحصة الثانية', dateDay: 11, dateMonth: 4, dateYear: 2026 }),
    makeEntry({ day: 'الثاني',  period: 'مساء',  session: 'الحصة الأولى',  dateDay: 11, dateMonth: 4, dateYear: 2026 }),
    makeEntry({ day: 'الثاني',  period: 'مساء',  session: 'الحصة الثانية', dateDay: 11, dateMonth: 4, dateYear: 2026 })
  ];

  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];

  return {
    proctorsList: proctors,
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    reservesConfig: { mode: 'fixed', fixed: 4, percent: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: makeOptions(rooms),
    enablePhase3: true
  };
}

// ============================================================
// C3-PERCENT FIXTURE — Reserves Never Populated (percent mode)
// ============================================================

/**
 * buildC3PercentInput — targets Bug Condition C3 with percent mode.
 *
 * Setup:
 *   - 20 proctors, all eligible
 *   - 8 schedule entries × 1 room × 1 proctor/room = 8 guard tasks
 *   - reservesConfig = { mode: 'percent', percent: 25 }
 *   - With 8 guards/session: ceil(0.25 × 8) = 2 expected reserves per session
 *
 * Pre-fix bug: Phase 2 hard-codes reserves:[]. Expected failure: |reserves(S)|=0 ≠ 2.
 *
 * _Validates: C3 (percent), Requirements 1.3, 1.4_
 *
 * @returns {Object} GS2_Input_Contract
 */
function buildC3PercentInput() {
  var proctors = [];
  for (var i = 1; i <= 20; i++) {
    proctors.push(makeProctor(
      'أستاذ_' + i,
      'C3P' + String(i).padStart(3, '0')
    ));
  }

  // 8 entries in a single halfday so each session has 8 guards
  // (8 different sessions in the same halfday, each with 1 room × 1 proctor)
  var entries = [
    makeEntry({ day: 'الأول', period: 'صباحا', session: 'الحصة الأولى',   dateDay: 15, dateMonth: 4, dateYear: 2026, subject: 'الرياضيات' }),
    makeEntry({ day: 'الأول', period: 'صباحا', session: 'الحصة الثانية',  dateDay: 15, dateMonth: 4, dateYear: 2026, subject: 'الفيزياء' }),
    makeEntry({ day: 'الأول', period: 'صباحا', session: 'الحصة الثالثة',  dateDay: 15, dateMonth: 4, dateYear: 2026, subject: 'العربية' }),
    makeEntry({ day: 'الأول', period: 'صباحا', session: 'الحصة الرابعة',  dateDay: 15, dateMonth: 4, dateYear: 2026, subject: 'الفرنسية' }),
    makeEntry({ day: 'الأول', period: 'مساء',  session: 'الحصة الأولى',   dateDay: 15, dateMonth: 4, dateYear: 2026, subject: 'الرياضيات' }),
    makeEntry({ day: 'الأول', period: 'مساء',  session: 'الحصة الثانية',  dateDay: 15, dateMonth: 4, dateYear: 2026, subject: 'الفيزياء' }),
    makeEntry({ day: 'الأول', period: 'مساء',  session: 'الحصة الثالثة',  dateDay: 15, dateMonth: 4, dateYear: 2026, subject: 'العربية' }),
    makeEntry({ day: 'الأول', period: 'مساء',  session: 'الحصة الرابعة',  dateDay: 15, dateMonth: 4, dateYear: 2026, subject: 'الفرنسية' })
  ];

  var rooms = [makeRoom('R1', 'الثانية بكالوريا')];

  return {
    proctorsList: proctors,
    scheduleEntries: entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    reservesConfig: { mode: 'percent', percent: 25, fixed: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: makeOptions(rooms),
    enablePhase3: true
  };
}

// ============================================================
// C4 FIXTURE — buildV2Input Config Plumbing
// ============================================================

/**
 * buildC4Input — targets Bug Condition C4.
 *
 * This fixture simulates the raw data that buildV2Input receives from the
 * Electron renderer (examCenterConfig + legacy examDistributionRules).
 * The test for C4 (task 27) calls buildV2Input directly and asserts that
 * the returned input.reservesConfig.mode === 'percent'.
 *
 * Pre-fix bug: buildV2Input never reads examCenterConfig.max_reserves_mode,
 * so it always falls back to reservesPerSession=0 → mode='fixed'.
 *
 * Returns the raw config objects (not a GS2_Input_Contract) because C4 tests
 * the plumbing layer, not the algorithm itself.
 *
 * _Validates: C4, Requirements 1.4_
 *
 * @returns {{ examCenterConfig: Object, examDistributionRules: Object, legacyReservesPerSession: number }}
 */
function buildC4Input() {
  return {
    // New-style config: max_reserves_mode is set to 'percent'
    examCenterConfig: {
      max_reserves_mode: 'percent',
      max_reserves: 0,           // ignored when mode='percent'
      max_reserves_percent: 25
    },
    // Legacy field: should be ignored when max_reserves_mode is present
    examDistributionRules: {
      proctorsPerRoom: 1,
      reservesPerSession: 0      // legacy fallback — should NOT be used when max_reserves_mode set
    },
    legacyReservesPerSession: 0  // convenience alias for test assertions
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  buildC1Input: buildC1Input,
  buildC2Input: buildC2Input,
  buildC3FixedInput: buildC3FixedInput,
  buildC3PercentInput: buildC3PercentInput,
  buildC4Input: buildC4Input,
  // Re-export helpers so tests can build custom variants
  makeProctor: makeProctor,
  makeEntry: makeEntry,
  makeRoom: makeRoom,
  makeOptions: makeOptions
};
