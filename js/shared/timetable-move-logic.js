/**
 * timetable-move-logic.js — Pure move/edit helpers for teacher timetable DnD.
 *
 * No DOM, no IPC. Require-able from Node tests; attached to window for the renderer.
 *
 * Teacher tab is the only editor. Students/rooms tabs are derived views of the
 * *saved* timetable snapshot (not live fetData).
 */
(function () {
    'use strict';

    // Period keys WITHIN a single half-day. morning AND afternoon each contain the
    // full set H1–H4 (see FET import + renderTeacherTimetable, which builds morning
    // H1–H4 then afternoon H1–H4). The morning/afternoon split is the SEPARATE
    // `periodType` dimension, never encoded inside these keys — so there is no
    // "band" to clamp H-keys against.
    var PERIODS = ['H1', 'H2', 'H3', 'H4'];

    /**
     * Which conditions a move must satisfy.
     *
     * - STRICT  : teacher availability + class availability + no class gap + room free
     * - NO_ROOM : teacher availability + class availability + no class gap (room reuse allowed)
     *
     * Teacher/class availability and the "no gap in the class day" rule are always
     * enforced — only the room-availability condition is user-selectable.
     */
    var MOVE_CONDITIONS = { STRICT: 'strict', NO_ROOM: 'no-room' };

    function isRoomCheckEnabled(mode) {
        return mode !== MOVE_CONDITIONS.NO_ROOM;
    }

    /**
     * Detect resource conflicts across every supplied cycle timetable.
     * `scopeCycles: 'all'` is mandatory because teacher and room resources are
     * institution-wide even when policy rules belong to `policyCycle`.
     */
    function detectConflicts(request) {
        if (!request || request.scopeCycles !== 'all') {
            throw new TypeError("detectConflicts requires scopeCycles: 'all'");
        }
        if (typeof request.policyCycle !== 'string' || request.policyCycle.trim() === '') {
            throw new TypeError('detectConflicts requires policyCycle');
        }
        if (!Array.isArray(request.timetableEntries)) return [];

        var conflicts = [];
        var entries = request.timetableEntries.slice().sort(function (a, b) {
            return String(a && a[0]).localeCompare(String(b && b[0]));
        });
        var teacherMatcher = typeof request.teacherMatcher === 'function'
            ? request.teacherMatcher
            : function (candidateTeacher) { return candidateTeacher === request.teacher; };

        for (var i = 0; i < entries.length; i += 1) {
            var cycleCode = entries[i] && entries[i][0];
            var timetableData = entries[i] && entries[i][1];
            var timetables = timetableData && timetableData.timetables;
            if (!timetables || typeof timetables !== 'object') continue;

            var teacherKeys = Object.keys(timetables).sort();
            for (var j = 0; j < teacherKeys.length; j += 1) {
                var candidateTeacher = teacherKeys[j];
                if (cycleCode === request.policyCycle && candidateTeacher === request.excludeTeacher) continue;
                var teacherTimetable = timetables[candidateTeacher];
                var slot = teacherTimetable && teacherTimetable[request.day]
                    && teacherTimetable[request.day][request.periodType]
                    && teacherTimetable[request.day][request.periodType][request.period];
                if (!slot) continue;

                if (request.teacher && teacherMatcher(candidateTeacher, timetableData, cycleCode)) {
                    conflicts.push({ type: 'teacher', cycleCode: cycleCode, teacher: candidateTeacher, slot: slot });
                }
                if (request.room && slot.room === request.room) {
                    conflicts.push({ type: 'room', cycleCode: cycleCode, teacher: candidateTeacher, slot: slot });
                }
            }
        }
        return conflicts;
    }

    function buildTimetableSlotKey(day, periodType, period) {
        return day + '|' + periodType + '|' + period;
    }

    /**
     * Consecutive period keys starting at periodStart, length count.
     * All four keys H1–H4 are valid, adjacent time slots inside one periodType,
     * so a multi-hour lesson may span any consecutive pair (H1-H2, H2-H3, H3-H4).
     * A single drag always targets one periodType, so the range can never cross
     * the morning/afternoon boundary. `periodType` is accepted for call-site
     * compatibility but intentionally unused.
     */
    function getConsecutivePeriods(periodStart, count, periodType) {
        var startIdx = PERIODS.indexOf(periodStart);
        if (startIdx === -1 || count <= 0) return [];

        var result = [];
        for (var i = 0; i < count; i++) {
            var period = PERIODS[startIdx + i];
            if (!period) break;
            result.push(period);
        }
        return result;
    }

    function buildPeriodRange(periodStart, periodEnd) {
        var startIdx = PERIODS.indexOf(periodStart);
        var endIdx = PERIODS.indexOf(periodEnd);
        if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return [periodStart];
        return PERIODS.slice(startIdx, endIdx + 1);
    }

    /**
     * Predicate used by the dragover throttle to detect whether the hovered
     * cell (encoded as "day|periodType|period") has actually changed between
     * events. Returning false lets the renderer skip the per-event validate +
     * repaint when the cursor is still over the same cell.
     */
    function hoverKeyChanged(prev, next) {
        return prev !== next;
    }

    function hasInternalGap(occupancy) {
        var firstIndex = occupancy.findIndex(Boolean);
        if (firstIndex === -1) return false;

        var lastIndex = -1;
        for (var index = occupancy.length - 1; index >= 0; index--) {
            if (occupancy[index]) {
                lastIndex = index;
                break;
            }
        }

        if (lastIndex <= firstIndex) return false;

        for (var i = firstIndex + 1; i < lastIndex; i++) {
            if (!occupancy[i]) return true;
        }

        return false;
    }

    function buildOccupancyAfterMove(classTimetable, day, periodType, sourceKeys, destinationKeys) {
        return PERIODS.map(function (period) {
            var slotKey = buildTimetableSlotKey(day, periodType, period);
            if (destinationKeys.has(slotKey)) return true;
            if (sourceKeys.has(slotKey)) return false;
            return !!(classTimetable[day] && classTimetable[day][periodType] && classTimetable[day][periodType][period]);
        });
    }

    function causesGapAfterMove(classTimetable, day, periodType, sourceKeys, destinationKeys) {
        var occupancy = buildOccupancyAfterMove(classTimetable, day, periodType, sourceKeys, destinationKeys);
        return hasInternalGap(occupancy);
    }

    /**
     * Pure move validation.
     *
     * input.checkRoom — when explicitly `false`, the room-availability condition is
     * skipped (see MOVE_CONDITIONS.NO_ROOM). Omitted/undefined keeps the strict
     * behaviour, so existing call sites are unaffected.
     *
     * deps: {
     *   getSlotData(teacher, day, period, periodType) -> activity|null
     *   isRoomOccupied(room, day, period, periodType, excludeTeacher) -> { occupied, ... }
     *   buildClassTimetable(className) -> classTimetable
     * }
     */
    function validateMoveTarget(input, deps) {
        deps = deps || {};
        var teacher = input.teacher;
        var className = input.className;
        var room = input.room;
        var sourceDay = input.sourceDay;
        var sourcePeriodType = input.sourcePeriodType;
        var sourcePeriods = input.sourcePeriods;
        var destDay = input.destDay;
        var destPeriod = input.destPeriod;
        var destPeriodType = input.destPeriodType;
        var checkRoom = input.checkRoom !== false;

        if (
            !teacher ||
            !destDay ||
            !destPeriod ||
            !destPeriodType ||
            !Array.isArray(sourcePeriods) ||
            sourcePeriods.length === 0
        ) {
            return { valid: false, message: 'الوجهة غير صالحة.' };
        }

        var destPeriods = getConsecutivePeriods(destPeriod, sourcePeriods.length, destPeriodType);
        if (destPeriods.length !== sourcePeriods.length) {
            return {
                valid: false,
                message: 'لا يمكن النقل: تحتاج ' + sourcePeriods.length + ' خانات متتالية داخل نفس الفترة.'
            };
        }

        var sourceKeys = new Set(
            sourcePeriods.map(function (period) {
                return buildTimetableSlotKey(sourceDay, sourcePeriodType, period);
            })
        );
        var destinationKeys = new Set(
            destPeriods.map(function (period) {
                return buildTimetableSlotKey(destDay, destPeriodType, period);
            })
        );

        var getSlotData = deps.getSlotData || function () {
            return null;
        };
        var isRoomOccupied =
            deps.isRoomOccupied ||
            function () {
                return { occupied: false };
            };
        var buildClassTimetable =
            deps.buildClassTimetable ||
            function () {
                return null;
            };

        var classTimetable = className ? buildClassTimetable(className) : null;

        for (var i = 0; i < destPeriods.length; i++) {
            var period = destPeriods[i];
            var slotKey = buildTimetableSlotKey(destDay, destPeriodType, period);
            const teacherCheck = deps.isTeacherOccupied
                ? deps.isTeacherOccupied(teacher, destDay, period, destPeriodType)
                : getSlotData(teacher, destDay, period, destPeriodType);
            const teacherOccupied = deps.isTeacherOccupied
                ? Boolean(teacherCheck && (teacherCheck.occupied ?? teacherCheck))
                : Boolean(teacherCheck);
            if (teacherOccupied && !sourceKeys.has(slotKey)) {
                return {
                    valid: false,
                    message: 'غير متاح: الأستاذ مشغول في ' + destDay + ' ' + period + '.'
                };
            }

            if (classTimetable) {
                var classActivity =
                    classTimetable[destDay] &&
                    classTimetable[destDay][destPeriodType] &&
                    classTimetable[destDay][destPeriodType][period];
                var isVacatedSourceSlot = sourceKeys.has(slotKey) && classActivity && classActivity.teacher === teacher;
                if (classActivity && !isVacatedSourceSlot) {
                    return {
                        valid: false,
                        message:
                            'غير متاح: القسم مشغول في ' +
                            destDay +
                            ' ' +
                            period +
                            ' مع ' +
                            classActivity.teacher +
                            '.'
                    };
                }
            }

            if (room && checkRoom) {
                var roomCheck = isRoomOccupied(room, destDay, period, destPeriodType, teacher);
                if (roomCheck && roomCheck.occupied) {
                    return {
                        valid: false,
                        message: 'غير متاح: القاعة ' + room + ' مشغولة في ' + destDay + ' ' + period + '.'
                    };
                }
            }
        }

        if (classTimetable) {
            var affectedSlices = {};
            affectedSlices[sourceDay + '|' + sourcePeriodType] = true;
            affectedSlices[destDay + '|' + destPeriodType] = true;
            var sliceKeys = Object.keys(affectedSlices);
            for (var s = 0; s < sliceKeys.length; s++) {
                var parts = sliceKeys[s].split('|');
                var day = parts[0];
                var periodType = parts[1];
                if (causesGapAfterMove(classTimetable, day, periodType, sourceKeys, destinationKeys)) {
                    return {
                        valid: false,
                        message:
                            'غير متاح: النقل سيُحدث فراغًا في جدول القسم خلال ' +
                            day +
                            ' ' +
                            (periodType === 'morning' ? 'الصباح' : 'المساء') +
                            '.'
                    };
                }
            }
        }

        return { valid: true, destPeriods: destPeriods };
    }

    /**
     * Restore a deep-copied teacher snapshot into the live timetables map.
     * Returns true when a restore was applied.
     */
    function restoreTeacherTimetableSnapshot(timetables, teacher, snapshot) {
        if (!timetables || !teacher || !snapshot) return false;
        timetables[teacher] = JSON.parse(JSON.stringify(snapshot));
        return true;
    }

    /**
     * Build slot payload for modal edit while preserving non-form fields
     * (activityId, tags, …) from the previous slot data.
     */
    function buildEditedSlotData(options) {
        options = options || {};
        if (options.deleteSlot) return null;

        var preserved = options.oldData && typeof options.oldData === 'object' ? Object.assign({}, options.oldData) : {};
        var subject = options.subject != null ? options.subject : preserved.subject || '';
        var students = options.students != null ? options.students : preserved.students || '';
        var room = options.room != null ? options.room : preserved.room || '';

        return Object.assign({}, preserved, {
            subject: subject,
            students: students,
            room: room
        });
    }

    var api = {
        PERIODS: PERIODS,
        MOVE_CONDITIONS: MOVE_CONDITIONS,
        isRoomCheckEnabled: isRoomCheckEnabled,
        detectConflicts: detectConflicts,
        buildTimetableSlotKey: buildTimetableSlotKey,
        getConsecutivePeriods: getConsecutivePeriods,
        buildPeriodRange: buildPeriodRange,
        hoverKeyChanged: hoverKeyChanged,
        hasInternalGap: hasInternalGap,
        buildOccupancyAfterMove: buildOccupancyAfterMove,
        causesGapAfterMove: causesGapAfterMove,
        validateMoveTarget: validateMoveTarget,
        restoreTeacherTimetableSnapshot: restoreTeacherTimetableSnapshot,
        buildEditedSlotData: buildEditedSlotData
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.GS2 = window.GS2 || {};
        window.GS2.TimetableMoveLogic = api;
        window.TimetableMoveLogic = api;
    }
})();
