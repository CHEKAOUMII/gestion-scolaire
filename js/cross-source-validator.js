// js/cross-source-validator.js
// Depends on: js/name-resolver.js (must load first)
// Future: will be imported by js/master-data.js

'use strict';

class CrossSourceValidator {
    /**
     * @param {string} schoolYear
     */
    constructor(schoolYear) {
        this._year = schoolYear;
    }

    /**
     * Run consistency checks after an import completes.
     * Never throws — returns warnings list instead.
     * @param {'students'|'grades'|'absences'|'fet'|'agent_xml'|'status'} importType
     * @param {object} importedData
     * @returns {Promise<{ valid: boolean, warnings: Array }>}
     */
    async validateAfterImport(importType, importedData) {
        const warnings = [];
        try {
            if (importType === 'grades')    await this._validateGrades(importedData, warnings);
            if (importType === 'absences')  await this._validateAbsences(importedData, warnings);
            if (importType === 'fet')       await this._validateFet(importedData, warnings);
            if (importType === 'agent_xml') await this._validateAgentXml(importedData, warnings);
        } catch (_) { /* validation errors should never crash the import */ }
        return { valid: warnings.filter((w) => w.level === 'error').length === 0, warnings };
    }

    // ── internal: build a NameResolver with DB teachers + timetable teachers ──
    async _buildResolver() {
        const dbTeachers = await window.api.teachers.getAll(this._year).catch(() => []);
        let timetableTeachers = [];
        try {
            const td = await window.api?.timetable?.get?.(this._year);
            timetableTeachers = ((td?.teachers || []).map((t) => ({
                id: t.teacherId || null,
                name: t.displayName || t.teacherName || (typeof t === 'string' ? t : '')
            }))).filter((t) => t.name);
        } catch (_) { /* ignore */ }
        return new NameResolver([...dbTeachers, ...timetableTeachers]);
    }

    async _validateGrades(data, warnings) {
        // data: { sections: string[], teacherNames: string[], levels: {section, level}[] }
        const students = await window.api.students.getAll(this._year).catch(() => []);
        const knownSections = new Set((students || []).map((s) => String(s.section || '').trim()));

        const unknownSections = (data.sections || []).filter((sec) => sec && !knownSections.has(sec));
        if (unknownSections.length) {
            warnings.push({
                level: 'error',
                code: 'SECTION_NOT_FOUND',
                message: `${unknownSections.length} قسم في ملف النقط غير موجود في لائحة التلاميذ: ${unknownSections.slice(0, 3).join('، ')}${unknownSections.length > 3 ? '...' : ''}`,
                count: unknownSections.length
            });
        }

        const resolver = await this._buildResolver();
        for (const name of (data.teacherNames || [])) {
            if (!name) continue;
            const result = await resolver.resolveAsync(name, this._year);
            if (result.needsReview || result.matchType === 'unmatched') {
                warnings.push({
                    level: 'warning',
                    code: 'TEACHER_IN_GRADES_UNRESOLVED',
                    message: `أستاذ "${name}" في ملف النقط غير معروف`,
                    count: 1
                });
            }
        }

        for (const { section, level } of (data.levels || [])) {
            if (!section || !level) continue;
            const derivedLevel = section.match(/^(\d[A-Za-z]+)/)?.[1] || '';
            const normLevel   = NameResolver.normalizeName(level);
            const normDerived = NameResolver.normalizeName(derivedLevel);
            if (normDerived && normLevel && !normDerived.includes(normLevel) && !normLevel.includes(normDerived)) {
                warnings.push({
                    level: 'warning',
                    code: 'LEVEL_SECTION_MISMATCH',
                    message: `المستوى "${level}" في الملف قد لا يتطابق مع القسم "${section}"`,
                    count: 1
                });
            }
        }
    }

    async _validateAbsences(data, warnings) {
        // data: { studentCodes: string[], teacherNames: string[] }
        const students = await window.api.students.getAll(this._year).catch(() => []);
        const knownCodes = new Set((students || []).map((s) => String(s.code || '').trim()));

        const unknownCodes = (data.studentCodes || []).filter((c) => c && !knownCodes.has(c));
        if (unknownCodes.length) {
            warnings.push({
                level: 'error',
                code: 'STUDENT_CODE_NOT_FOUND',
                message: `${unknownCodes.length} رمز مسار في ملف الغياب غير موجود في لائحة التلاميذ`,
                count: unknownCodes.length
            });
        }

        const resolver = await this._buildResolver();
        for (const name of (data.teacherNames || [])) {
            if (!name) continue;
            const result = await resolver.resolveAsync(name, this._year);
            if (result.needsReview || result.matchType === 'unmatched') {
                warnings.push({
                    level: 'warning',
                    code: 'TEACHER_IN_ABSENCES_UNRESOLVED',
                    message: `اسم الأستاذ "${name}" غير معروف في سجل الغياب`,
                    count: 1
                });
            }
        }
    }

    async _validateFet(data, warnings) {
        // data: { teacherNames: string[] }
        const resolver = await this._buildResolver();
        const unresolved = [];
        for (const name of (data.teacherNames || [])) {
            if (!name) continue;
            const result = await resolver.resolveAsync(name, this._year);
            if (result.needsReview || result.matchType === 'unmatched') unresolved.push(name);
        }
        if (unresolved.length) {
            warnings.push({
                level: 'warning',
                code: 'TEACHER_FET_UNRESOLVED',
                message: `${unresolved.length} أستاذ في FET لم يُربط بملف الوزارة: ${unresolved.slice(0, 3).join('، ')}${unresolved.length > 3 ? '...' : ''}`,
                count: unresolved.length,
                names: unresolved
            });
        }
    }

    async _validateAgentXml(data, warnings) {
        // data: { pprList: string[] }
        const pprSet = new Set();
        const duplicates = [];
        for (const ppr of (data.pprList || [])) {
            if (!ppr) continue;
            if (pprSet.has(ppr)) duplicates.push(ppr);
            else pprSet.add(ppr);
        }
        if (duplicates.length) {
            warnings.push({
                level: 'warning',
                code: 'DUPLICATE_PPR',
                message: `${duplicates.length} رقم PPR مكرر في ملف الوزارة`,
                count: duplicates.length
            });
        }
    }
}
