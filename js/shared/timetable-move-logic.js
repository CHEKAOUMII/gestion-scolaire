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
            var teacherActivity = getSlotData(teacher, destDay, period, destPeriodType);
            if (teacherActivity && !sourceKeys.has(slotKey)) {
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

            if (room) {
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
        buildTimetableSlotKey: buildTimetableSlotKey,
        getConsecutivePeriods: getConsecutivePeriods,
        buildPeriodRange: buildPeriodRange,
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
