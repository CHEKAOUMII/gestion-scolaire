/**
 * ExamDataReaders — unified read layer for exam center data.
 *
 * Reads from the current storage (exam_config_data via IPC) with
 * fallback logic, merge-safe writes, and consistent shapes.
 *
 * Usage (renderer process):
 *   const readers = new ExamDataReaders(window.api, year);
 *   const config = await readers.getCenterConfig();
 *   const rules  = await readers.getDistributionRules();
 */
'use strict';

class ExamDataReaders {
    constructor(api, schoolYear) {
        this._api = api;
        this._year = schoolYear;
    }

    get year() { return this._year; }
    set year(v) { this._year = v; }

    async getCenterConfig() {
        return (await this._api.examConfig.get(this._year, 'examCenterConfig')) || {};
    }

    async saveCenterConfigMerged(fields) {
        const existing = await this.getCenterConfig();
        const merged = Object.assign({}, existing, fields);
        await this._api.examConfig.save({
            school_year: this._year,
            config_key: 'examCenterConfig',
            data: merged
        });
        return merged;
    }

    async getPeriods() {
        const periods = await this._api.examConfig.get(this._year, 'examPeriodsData');
        return Array.isArray(periods) ? periods : [];
    }

    async getDistributionRules() {
        const config = await this.getCenterConfig();
        const saved = (await this._api.examConfig.get(this._year, 'examDistributionRules')) || {};

        const proctorsPerRoomRaw = Number(saved.proctorsPerRoom ?? config.supervisors_per_room ?? 2);
        const reservesPerSessionRaw = Number(saved.reservesPerSession ?? config.max_reserves ?? 0);
        const reservesMode = (saved.reservesMode ?? config.max_reserves_mode) === 'percent' ? 'percent' : 'fixed';
        const reservesPercentRaw = Number(saved.reservesPercent ?? config.max_reserves_percent ?? 20);
        const reservesPercent = Number.isFinite(reservesPercentRaw) && reservesPercentRaw >= 0
            ? Math.min(reservesPercentRaw, 100) : 20;
        const algorithmVersion = (saved.algorithmVersion === 'v3') ? 'v3'
            : (saved.algorithmVersion === 'v1') ? 'v1' : 'v2';

        return {
            proctorsPerRoom: Number.isFinite(proctorsPerRoomRaw) && proctorsPerRoomRaw > 0 ? proctorsPerRoomRaw : 2,
            reservesPerSession: Number.isFinite(reservesPerSessionRaw) && reservesPerSessionRaw >= 0 ? reservesPerSessionRaw : 0,
            reservesMode,
            reservesPercent,
            algorithmVersion,
            allowSameDayBothHalfdays: saved.allowSameDayBothHalfdays === true
        };
    }

    async saveDistributionRules(fields) {
        const current = await this.getDistributionRules();
        const merged = Object.assign({}, current, fields);
        await this._api.examConfig.save({
            school_year: this._year,
            config_key: 'examDistributionRules',
            data: merged
        });
        return merged;
    }

    async getDutyTeachers() {
        return (await this._api.examConfig.get(this._year, 'examDutyTeachersData')) || {};
    }

    async getExemptions() {
        return (await this._api.examConfig.get(this._year, 'examExemptionsData')) || {};
    }

    async getMorningEvening() {
        return (await this._api.examConfig.get(this._year, 'examMorningEveningData')) || {};
    }

    async getScheduleRaw() {
        return (await this._api.examConfig.get(this._year, 'examScheduleData')) || {};
    }

    async getScheduleEntries() {
        const data = await this.getScheduleRaw();
        return Object.entries(data).flatMap(function (entry) {
            var levelName = entry[0];
            var arr = entry[1];
            if (!Array.isArray(arr)) return [];
            return arr.map(function (item) {
                return Object.assign({ level_name: levelName }, item || {});
            });
        });
    }

    async getLevels() {
        const levels = await this._api.examConfig.get(this._year, 'examCenterLevels');
        return Array.isArray(levels) ? levels : [];
    }

    async getRoomsData() {
        return (await this._api.examConfig.get(this._year, 'examCenterRoomsData')) || {};
    }

    async getRoomsCount() {
        const val = await this._api.examConfig.get(this._year, 'examCenterRoomsCount');
        return Number(val) || 5;
    }

    async getAutoDistributionResult() {
        return (await this._api.examConfig.get(this._year, 'examAutoDistributionData')) || null;
    }

    async getReadinessStatus() {
        var roomsData = await this.getRoomsData();
        var roomRows = Object.values(roomsData).filter(function (r) {
            return r && (r.roomName || r.count || r.firstNum || r.lastNum);
        });
        var scheduleEntries = await this.getScheduleEntries();
        var scheduledEntries = scheduleEntries.filter(function (s) {
            return s && (s.date_day || s.date || s.time_from || s.time);
        });
        var periods = await this.getPeriods();
        var levels = await this.getLevels();
        var rules = await this.getDistributionRules();
        var config = await this.getCenterConfig();

        var roomsCount = roomRows.length;
        var sessionsCount = scheduledEntries.length;
        var periodsCount = periods.length;
        var examDays = ExamDataReaders.generateExamDaysFromPeriods(periods);

        var issues = [];
        if (roomsCount === 0) issues.push('لا توجد قاعات');
        if (sessionsCount === 0) issues.push('لا توجد حصص مبرمجة');
        if (periodsCount === 0) issues.push('لا توجد فترات');
        if (!levels.length) issues.push('لا توجد مستويات');

        var scheduledWithoutTime = scheduledEntries.length > 0
            ? scheduleEntries.filter(function (s) {
                return s && s.subject_name && !s.time_from;
            })
            : [];
        if (scheduledWithoutTime.length > 0) {
            issues.push(scheduledWithoutTime.length + ' مادة بدون توقيت');
        }

        return {
            roomsCount: roomsCount,
            sessionsCount: sessionsCount,
            periodsCount: periodsCount,
            levelsCount: levels.length,
            examDaysCount: examDays.length,
            proctorsPerRoom: rules.proctorsPerRoom,
            guardTasks: roomsCount * Math.max(examDays.length * 2, sessionsCount ? 1 : 0),
            hasRooms: roomsCount > 0,
            hasSchedule: sessionsCount > 0,
            hasPeriods: periodsCount > 0,
            hasLevels: levels.length > 0,
            hasProctorsPerRoom: rules.proctorsPerRoom > 0,
            examName: config.exam_name || '',
            issues: issues,
            ready: issues.length === 0
        };
    }

    static generateExamDaysFromPeriods(periods) {
        var days = [];
        if (!Array.isArray(periods)) return days;
        periods.forEach(function (period) {
            if (!period.date_from || !period.date_to) return;
            var start = new Date(period.date_from);
            var end = new Date(period.date_to);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
            for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                days.push(d.toISOString().slice(0, 10));
            }
        });
        return Array.from(new Set(days));
    }

    async computeReservesForSession(guardNeed) {
        var rules = await this.getDistributionRules();
        if (rules.reservesMode === 'percent') {
            var need = Number(guardNeed) || 0;
            var pct = Number(rules.reservesPercent) || 0;
            return Math.max(0, Math.round(need * pct / 100));
        }
        return Math.max(0, Number(rules.reservesPerSession) || 0);
    }
}

if (typeof window !== 'undefined') {
    window.ExamDataReaders = ExamDataReaders;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExamDataReaders;
}
