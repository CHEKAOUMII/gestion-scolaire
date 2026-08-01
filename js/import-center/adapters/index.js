/**
 * adapters/index.js — Registry of import type adapters (Package 3).
 * Dual-export: window.ImportAdapters + module.exports
 */
(function (root, factory) {
    function load(name, globalName) {
        if (root && root[globalName]) return root[globalName];
        if (typeof require === 'function') {
            try {
                return require(name);
            } catch (_e) {
                return null;
            }
        }
        return null;
    }
    const api = factory(
        load('./students-import-adapter.js', 'StudentsImportAdapter'),
        load('./grades-import-adapter.js', 'GradesImportAdapter'),
        load('./absences-import-adapter.js', 'AbsencesImportAdapter'),
        load('./fet-import-adapter.js', 'FetImportAdapter'),
        load('./agent-xml-import-adapter.js', 'AgentXmlImportAdapter'),
        load('./student-status-import-adapter.js', 'StudentStatusImportAdapter')
    );
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.ImportAdapters = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (
    students,
    grades,
    absences,
    fet,
    agentXml,
    studentStatus
) {
    'use strict';

    const byType = Object.freeze({
        students: students,
        grades: grades,
        absences: absences,
        fet: fet,
        agent_xml: agentXml,
        student_status: studentStatus
    });

    const MANUAL_FUNCTION_MAP = Object.freeze({
        students: 'importStudents',
        grades: 'importGrades',
        absences: 'importAbsences',
        fet: 'importFetXml',
        agent_xml: 'importAgentXml',
        student_status: 'importStudentStatus'
    });

    function getAdapter(type) {
        return byType[type] || null;
    }

    function listAdapters() {
        return Object.keys(byType)
            .map((k) => byType[k])
            .filter(Boolean);
    }

    function listTypes() {
        return Object.keys(byType);
    }

    /**
     * True if every registered adapter exposes analyze + guarded execute.
     */
    function contractOk() {
        for (const type of listTypes()) {
            const a = byType[type];
            if (!a) return false;
            if (typeof a.analyze !== 'function') return false;
            if (typeof a.execute !== 'function') return false;
            if (typeof a.canAnalyze !== 'function') return false;
            if (a.type !== type) return false;
        }
        return true;
    }

    return {
        byType,
        MANUAL_FUNCTION_MAP,
        getAdapter,
        listAdapters,
        listTypes,
        contractOk
    };
});
