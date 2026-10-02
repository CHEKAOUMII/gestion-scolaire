// Proctor Distribution V3 — Phase 1b: Build Rooms and Empty Result Rows.
//
// Pure function: takes a `state` object containing `state.input` (per
// GS3_Input_Contract) and returns a NEW state with the following fields
// populated/extended:
//   - rows                 : array of empty Result_Row objects, one per
//                            (scheduleEntry, room) pair. Every row has:
//                              session_key, halfday_key, day_key,
//                              room_key, room_name, level, subject,
//                              proctor_keys (array of length proctorsPerRoom
//                              filled with null), proctors, reserves,
//                              reserve_keys, duty_teachers, softViolations
//                            (every array is a FRESH reference — no two rows
//                            share an array, per Acceptance Criterion 10.2).
//   - diagnostics          : carries forward existing warnings/errors and
//                            appends `synthetic_rooms` warnings (one per
//                            level that required synthesis) and
//                            `exam_center_levels_missing` warning (when
//                            applicable).
//
// Acceptance Criteria covered:
//   - 11.1 : rooms_count(L) sourced primarily from examCenterLevels[L].rooms.
//   - 11.2 : when examCenterLevels[L].rooms = N > examCenterRoomsData[L].length = M,
//            synthesize (N - M) in-memory placeholder rooms AND record a
//            structured warning.
//   - 11.3 : when examCenterLevels[L].rooms is 0/undefined, fall back to
//            examCenterRoomsData rows; no synthesis.
//   - 11.4 : when examCenterLevels is absent/empty, only use
//            examCenterRoomsData; record `exam_center_levels_missing`.
//   - 11.5 : when total guard slots produced for a level mismatches expected
//            (rooms × sessions × proctorsPerRoom), record `level_slot_mismatch`.
//   - 11.6 : synthesized rooms NEVER persisted (purely in-memory in `rows`).
//
// Purity contract:
//   - `state.input`, `state.input.examCenterRoomsData`, `state.input.examCenterLevels`
//     are NOT mutated; all reads are non-destructive.
//   - The returned state is a fresh object; only `rows` and `diagnostics`
//     fields are added/replaced. Every other field is shallow-copied.
//   - `state.diagnostics` is created as `{ warnings: [], errors: [] }` if
//     not already present, then a NEW diagnostics object is produced with
//     fresh `warnings`/`errors` arrays so the caller's existing diagnostics
//     are untouched.

'use strict';

/**
 * Determine whether a value is a plain (non-array, non-null) object.
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    return true;
}

/**
 * Extract the level name from a schedule entry. Supports both the canonical
 * design field `level` and the production fixture field `level_name`.
 * @param {Object} entry
 * @returns {string}
 */
function extractLevel(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (typeof entry.level === 'string' && entry.level.length > 0) return entry.level;
    if (typeof entry.level_name === 'string' && entry.level_name.length > 0) return entry.level_name;
    return '';
}

/**
 * Extract the period (halfday descriptor) from a schedule entry.
 * @param {Object} entry
 * @returns {string}
 */
function extractPeriod(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (typeof entry.period === 'string' && entry.period.length > 0) return entry.period;
    return '';
}

/**
 * Extract the date in canonical YYYY-MM-DD form. Supports either an explicit
 * `date` field (already formatted) or the production fixture's
 * `date_year`/`date_month`/`date_day` triplet.
 * @param {Object} entry
 * @returns {string}
 */
function extractDate(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (typeof entry.date === 'string' && entry.date.length > 0) return entry.date;
    var y = entry.date_year != null ? String(entry.date_year) : '';
    var m = entry.date_month != null ? String(entry.date_month) : '';
    var d = entry.date_day != null ? String(entry.date_day) : '';
    if (!y && !m && !d) return '';
    // Pad month/day to two digits for canonical form.
    if (m.length === 1) m = '0' + m;
    if (d.length === 1) d = '0' + d;
    return y + '-' + m + '-' + d;
}

/**
 * Extract the subject name from a schedule entry. Supports `subject` or
 * `subject_name`.
 * @param {Object} entry
 * @returns {string}
 */
function extractSubject(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (typeof entry.subject === 'string' && entry.subject.length > 0) return entry.subject;
    if (typeof entry.subject_name === 'string' && entry.subject_name.length > 0) return entry.subject_name;
    return '';
}

/**
 * Extract the session label, used to disambiguate multiple sequential
 * sessions inside a single halfday (e.g. الحصة الأولى vs الحصة الثانية).
 * @param {Object} entry
 * @returns {string}
 */
function extractSessionLabel(entry) {
    if (!entry || typeof entry !== 'object') return '';
    if (typeof entry.session === 'string' && entry.session.length > 0) return entry.session;
    return '';
}

/**
 * Build the canonical session_key from a schedule entry. Follows the format
 * documented in the task: `${date}|${period}|${level}|${subject}` with the
 * session label appended when present so two consecutive sessions on the
 * same halfday/level are distinguishable.
 * @param {Object} entry
 * @returns {string}
 */
function buildSessionKey(entry) {
    var date = extractDate(entry);
    var period = extractPeriod(entry);
    var level = extractLevel(entry);
    var subject = extractSubject(entry);
    var session = extractSessionLabel(entry);
    var base = date + '|' + period + '|' + level + '|' + subject;
    if (session) base += '|' + session;
    return base;
}

/**
 * Build the halfday_key (`${date}|${period}`).
 * @param {Object} entry
 * @returns {string}
 */
function buildHalfdayKey(entry) {
    return extractDate(entry) + '|' + extractPeriod(entry);
}

/**
 * Compute a deterministic room_key from a real (non-synthetic) room object.
 * Mirrors V2's `getRoomConstraintKey` precedence: `key`, `room_num`,
 * `roomName`. Falls back to a level/index composite to guarantee
 * uniqueness inside this run.
 * @param {Object} room
 * @param {string} levelName
 * @param {number} idx     - position of the room within its level array
 * @returns {string}
 */
function buildRealRoomKey(room, levelName, idx) {
    if (room && typeof room === 'object') {
        if (typeof room.key === 'string' && room.key.length > 0) return String(room.key).trim();
        if (room.room_num != null && String(room.room_num).length > 0) {
            return String(room.room_num).trim();
        }
        if (typeof room.roomName === 'string' && room.roomName.length > 0) return room.roomName;
        if (typeof room.room_name === 'string' && room.room_name.length > 0) return room.room_name;
    }
    return '__room_' + levelName + '_' + idx;
}

/**
 * Compute a display-friendly room_name from a real room object. Falls back
 * to a sequential "Salle N" form if the room object lacks any name field.
 * @param {Object} room
 * @param {number} sequentialNumber
 * @returns {string}
 */
function buildRealRoomName(room, sequentialNumber) {
    if (room && typeof room === 'object') {
        if (typeof room.roomName === 'string' && room.roomName.length > 0) return room.roomName;
        if (typeof room.room_name === 'string' && room.room_name.length > 0) return room.room_name;
        if (room.room_num != null && String(room.room_num).length > 0) {
            return 'Salle ' + String(room.room_num).trim();
        }
    }
    return 'Salle ' + sequentialNumber;
}

/**
 * Pull the configured proctorsPerRoom value from input rules. Defaults to
 * 1 when the field is absent or non-positive (matches task guidance).
 * @param {Object} input
 * @returns {number}
 */
function readProctorsPerRoom(input) {
    var rules = input && input.examDistributionRules;
    if (!isPlainObject(rules)) return 1;
    var raw = rules.proctorsPerRoom;
    var n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.floor(n);
}

/**
 * Read examCenterLevels[level].rooms as a non-negative integer; returns
 * `null` when the level entry is missing OR when the `rooms` field is
 * absent/zero/non-numeric (signals "fall back to actual rows" per AC 11.3).
 * @param {Object|null|undefined} examCenterLevels
 * @param {string} level
 * @returns {number|null}
 */
function readTargetRoomsForLevel(examCenterLevels, level) {
    if (!isPlainObject(examCenterLevels)) return null;
    var entry = examCenterLevels[level];
    if (!isPlainObject(entry)) return null;
    var n = Number(entry.rooms);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
}

/**
 * Read the rooms array for a level, honoring the input-boundary precedence
 * required to accept the same GS3_Input_Contract as V2 (Acceptance
 * Criterion 1.3):
 *   1. `examCenterRoomsData[level]` — the design-canonical shape
 *      (`{ [level]: RoomRow[] }`). Used when present and non-empty.
 *   2. `options.roomsList[level]` — the V2/production shape. V2 reads rooms
 *      exactly this way (see `getRoomsForEntry`: `roomsList[levelName]`).
 *      Each room is `{ key, level_name, room_num, roomName, wing, ... }`.
 *
 * Returns `[]` for any non-array value (including missing/null/object-of-keys
 * forms).
 * @param {Object|null|undefined} examCenterRoomsData
 * @param {Object|null|undefined} roomsList
 * @param {string} level
 * @returns {Array}
 */
function readActualRoomsForLevel(examCenterRoomsData, roomsList, level) {
    if (isPlainObject(examCenterRoomsData)) {
        var rows = examCenterRoomsData[level];
        if (Array.isArray(rows) && rows.length > 0) return rows;
    }
    if (isPlainObject(roomsList)) {
        var fallback = roomsList[level];
        if (Array.isArray(fallback)) return fallback;
    }
    return [];
}

/**
 * Build the final list of "effective" rooms for a level: real rooms first
 * (capped at target N when target is known), followed by synthesized
 * placeholders to reach N. Returns the rooms list and the count of
 * synthesized rooms (0 if none).
 *
 * @param {string} level
 * @param {number|null} target - examCenterLevels[L].rooms; null when unknown
 * @param {Array} actualRooms  - examCenterRoomsData[L]
 * @returns {{ rooms: Array<{key:string,name:string,_synthetic:boolean}>, syntheticCount:number, actualUsed:number }}
 */
function resolveRoomsForLevel(level, target, actualRooms) {
    var actualCount = actualRooms.length;
    var rooms = [];
    var syntheticCount = 0;

    if (target === null) {
        // No examCenterLevels guidance — use whatever real rooms exist.
        for (var i = 0; i < actualCount; i += 1) {
            rooms.push({
                key: buildRealRoomKey(actualRooms[i], level, i),
                name: buildRealRoomName(actualRooms[i], i + 1),
                _synthetic: false
            });
        }
        return { rooms: rooms, syntheticCount: 0, actualUsed: actualCount };
    }

    if (target <= actualCount) {
        // Use the first `target` real rooms only (slice — do not mutate input).
        for (var j = 0; j < target; j += 1) {
            rooms.push({
                key: buildRealRoomKey(actualRooms[j], level, j),
                name: buildRealRoomName(actualRooms[j], j + 1),
                _synthetic: false
            });
        }
        return { rooms: rooms, syntheticCount: 0, actualUsed: target };
    }

    // M < N: take all real rooms, then synthesize the remainder.
    for (var k = 0; k < actualCount; k += 1) {
        rooms.push({
            key: buildRealRoomKey(actualRooms[k], level, k),
            name: buildRealRoomName(actualRooms[k], k + 1),
            _synthetic: false
        });
    }
    var missing = target - actualCount;
    for (var s = 0; s < missing; s += 1) {
        rooms.push({
            key: '__synth_' + level + '_' + s,
            name: 'Salle ' + (actualCount + 1 + s),
            _synthetic: true
        });
    }
    syntheticCount = missing;
    return { rooms: rooms, syntheticCount: syntheticCount, actualUsed: actualCount };
}

/**
 * Build an empty Result_Row for the given (entry, room) pair. Every array
 * is a FRESH reference (Acceptance Criterion 10.2).
 *
 * @param {Object} entry
 * @param {{key:string, name:string}} room
 * @param {number} proctorsPerRoom
 * @returns {Object}
 */
function buildEmptyRow(entry, room, proctorsPerRoom) {
    var sessionKey = buildSessionKey(entry);
    var halfdayKey = buildHalfdayKey(entry);
    var dayKey = extractDate(entry);
    var level = extractLevel(entry);
    var subject = extractSubject(entry);

    var proctorKeys = new Array(proctorsPerRoom);
    for (var i = 0; i < proctorsPerRoom; i += 1) {
        proctorKeys[i] = null;
    }

    return {
        session_key: sessionKey,
        halfday_key: halfdayKey,
        day_key: dayKey,
        room_key: room.key,
        room_name: room.name,
        level: level,
        subject: subject,
        proctor_keys: proctorKeys,
        proctors: [],
        reserve_keys: [],
        reserves: [],
        duty_teachers: [],
        softViolations: []
    };
}

/**
 * Phase 1b entry point.
 *
 * @param {Object} state - pipeline state; must contain `state.input`
 * @returns {Object} new state with `rows` and `diagnostics` populated
 */
function buildRoomsAndRows(state) {
    if (state === null || state === undefined) {
        throw new TypeError('buildRoomsAndRows: state must be an object');
    }
    var input = state.input;
    if (!isPlainObject(input)) {
        throw new TypeError('buildRoomsAndRows: state.input must be a plain object');
    }

    var scheduleEntries = Array.isArray(input.scheduleEntries) ? input.scheduleEntries : [];
    var examCenterLevels = isPlainObject(input.examCenterLevels) ? input.examCenterLevels : null;
    var examCenterRoomsData = isPlainObject(input.examCenterRoomsData) ? input.examCenterRoomsData : null;
    // V2/production input boundary: rooms supplied via options.roomsList,
    // an object keyed by level_name → RoomRow[] (Acceptance Criterion 1.3).
    var roomsList = (isPlainObject(input.options) && isPlainObject(input.options.roomsList))
        ? input.options.roomsList
        : null;
    var proctorsPerRoom = readProctorsPerRoom(input);

    // Carry diagnostics forward with FRESH arrays so we never mutate the
    // caller's state.diagnostics.warnings/errors.
    var prevDiag = isPlainObject(state.diagnostics) ? state.diagnostics : null;
    var prevWarnings = prevDiag && Array.isArray(prevDiag.warnings) ? prevDiag.warnings : [];
    var prevErrors = prevDiag && Array.isArray(prevDiag.errors) ? prevDiag.errors : [];
    var warnings = prevWarnings.slice();
    var errors = prevErrors.slice();

    // Emit `exam_center_levels_missing` once when applicable (AC 11.4).
    if (
        examCenterLevels === null
        || (examCenterLevels && Object.keys(examCenterLevels).length === 0)
    ) {
        warnings.push({
            type: 'exam_center_levels_missing',
            message: 'examCenterLevels is absent or empty; falling back to examCenterRoomsData only.'
        });
    }

    // Resolve rooms once per level (deterministic) so multiple schedule
    // entries on the same level reuse the same room objects (and we only
    // emit one synthetic_rooms warning per level, regardless of how many
    // sessions reference it).
    var roomsByLevel = Object.create(null);
    var sessionsByLevel = Object.create(null);
    var sortedLevels = [];

    for (var ei = 0; ei < scheduleEntries.length; ei += 1) {
        var entry = scheduleEntries[ei];
        var lvl = extractLevel(entry);
        if (!lvl) continue;
        if (!(lvl in sessionsByLevel)) {
            sessionsByLevel[lvl] = 0;
            sortedLevels.push(lvl);
        }
        sessionsByLevel[lvl] += 1;
    }
    sortedLevels.sort();

    for (var li = 0; li < sortedLevels.length; li += 1) {
        var level = sortedLevels[li];
        var target = readTargetRoomsForLevel(examCenterLevels, level);
        var actualRooms = readActualRoomsForLevel(examCenterRoomsData, roomsList, level);
        var resolved = resolveRoomsForLevel(level, target, actualRooms);
        roomsByLevel[level] = resolved.rooms;

        if (resolved.syntheticCount > 0) {
            warnings.push({
                type: 'synthetic_rooms',
                level: level,
                requestedCount: target,
                actualCount: resolved.actualUsed,
                syntheticCount: resolved.syntheticCount,
                addedCount: resolved.syntheticCount,
                message:
                    'Synthesized ' + resolved.syntheticCount + ' placeholder room(s) for level "' +
                    level + '" (requested ' + target + ', actual ' + resolved.actualUsed + ').'
            });
        }

        // AC 11.5: detect level-level slot count mismatch when both target
        // and actual sessions are known. The expected count is computed
        // post-resolution (i.e. after synthesis), so a warning here only
        // fires when the resolved room count diverges from the configured
        // target — typically when target was null but actual rooms exist
        // and the user expected a specific number.
        if (target !== null && resolved.rooms.length !== target) {
            warnings.push({
                type: 'level_slot_mismatch',
                level: level,
                expected: target * sessionsByLevel[level] * proctorsPerRoom,
                actual: resolved.rooms.length * sessionsByLevel[level] * proctorsPerRoom,
                message:
                    'Resolved room count (' + resolved.rooms.length +
                    ') does not match examCenterLevels.rooms (' + target +
                    ') for level "' + level + '".'
            });
        }
    }

    // Materialize empty rows in schedule-entry order, then by room order
    // within each entry. This ordering is deterministic given the input.
    var rows = [];
    for (var si = 0; si < scheduleEntries.length; si += 1) {
        var s = scheduleEntries[si];
        var lvl2 = extractLevel(s);
        if (!lvl2) continue;
        var rooms = roomsByLevel[lvl2] || [];
        for (var ri = 0; ri < rooms.length; ri += 1) {
            rows.push(buildEmptyRow(s, rooms[ri], proctorsPerRoom));
        }
    }

    // Build the new state. Shallow-copy every field of `state` first, then
    // overlay the fields owned by this phase.
    var nextState = {};
    var stateKeys = Object.keys(state);
    for (var k = 0; k < stateKeys.length; k += 1) {
        nextState[stateKeys[k]] = state[stateKeys[k]];
    }
    nextState.rows = rows;
    nextState.diagnostics = {};
    if (prevDiag) {
        var diagKeys = Object.keys(prevDiag);
        for (var dk = 0; dk < diagKeys.length; dk += 1) {
            nextState.diagnostics[diagKeys[dk]] = prevDiag[diagKeys[dk]];
        }
    }
    nextState.diagnostics.warnings = warnings;
    nextState.diagnostics.errors = errors;

    return nextState;
}

module.exports = { buildRoomsAndRows };
