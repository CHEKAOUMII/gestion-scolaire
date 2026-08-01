/**
 * import-query-context.js — Parse contextual shortcut query hints only.
 *
 * type / year / source never start an import.
 * Dual-export: window.ImportQueryContext + module.exports
 */
(function (root, factory) {
    const Contracts =
        (root && root.ImportContracts) ||
        (typeof require === 'function' ? require('./import-contracts.js') : null);
    const api = factory(Contracts);
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ImportQueryContext = api;
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function (Contracts) {
    'use strict';

    const TYPE_MAP = Object.freeze({
        students: 'students',
        grades: 'grades',
        absences: 'absences',
        fet: 'fet',
        agent_xml: 'agent_xml',
        'agent-xml': 'agent_xml',
        agentxml: 'agent_xml',
        student_status: 'student_status',
        'student-status': 'student_status',
        status: 'student_status',
        orientation: 'orientation',
        توجيه: 'orientation',
        generic: 'generic_csv_xlsx',
        generic_csv_xlsx: 'generic_csv_xlsx'
    });

    /**
     * @param {string|URLSearchParams|object} input — search string, params, or plain object
     * @returns {{ typeHint: string|null, yearHint: string|null, sourcePage: string|null, isHintOnly: true, autoExecute: false }}
     */
    function parseQueryContext(input) {
        let params;
        if (input instanceof URLSearchParams) {
            params = input;
        } else if (typeof input === 'string') {
            const q = input.startsWith('?') ? input.slice(1) : input.includes('?') ? input.split('?')[1] : input;
            params = new URLSearchParams(q || '');
        } else if (input && typeof input === 'object') {
            params = new URLSearchParams();
            Object.keys(input).forEach((k) => {
                if (input[k] != null) params.set(k, String(input[k]));
            });
        } else {
            params = new URLSearchParams();
        }

        const rawType = params.get('type') || params.get('importType') || '';
        const mapped = TYPE_MAP[String(rawType).toLowerCase()] || null;
        const yearHint = params.get('year') || params.get('schoolYear') || null;
        const sourcePage = params.get('source') || params.get('from') || null;

        return {
            typeHint: mapped,
            yearHint: yearHint ? String(yearHint) : null,
            sourcePage: sourcePage ? String(sourcePage) : null,
            isHintOnly: true,
            autoExecute: false,
            mode: mapped || yearHint || sourcePage ? 'contextual_shortcut' : 'file_picker'
        };
    }

    /**
     * Parse from browser location when available.
     */
    function fromLocation(loc) {
        const locationObj =
            loc ||
            (typeof window !== 'undefined' && window.location ? window.location : null);
        if (!locationObj) {
            return parseQueryContext('');
        }
        return parseQueryContext(locationObj.search || '');
    }

    /**
     * Build sourceContext for ImportSession.
     */
    function toSourceContext(query) {
        const q = query || parseQueryContext('');
        return {
            mode: q.mode || 'contextual_shortcut',
            typeHint: q.typeHint,
            yearHint: q.yearHint,
            sourcePage: q.sourcePage
        };
    }

    /**
     * Decision invalidation helper for controller.
     * Returns true if type/year/destination change should bump decisionVersion.
     */
    function shouldInvalidateDecision(prev, next) {
        const p = prev || {};
        const n = next || {};
        return (
            (n.selectedType != null && n.selectedType !== p.selectedType) ||
            (n.selectedYear != null && n.selectedYear !== p.selectedYear) ||
            (n.genericDestination != null && n.genericDestination !== p.genericDestination)
        );
    }

    /**
     * Build a contextual shortcut URL into the central import page.
     * Hints only — never encodes auto-execute.
     *
     * @param {{ type?: string, year?: string, source?: string, page?: string }} opts
     * @returns {string} e.g. settings-imports.html?type=grades&year=2026-2027&source=grades-sheets
     */
    function buildImportCenterUrl(opts) {
        const o = opts || {};
        const params = new URLSearchParams();
        if (o.type) {
            const mapped = TYPE_MAP[String(o.type).toLowerCase()] || String(o.type);
            // Use URL-friendly forms for common types
            const urlType =
                mapped === 'agent_xml'
                    ? 'agent-xml'
                    : mapped === 'student_status'
                      ? 'student-status'
                      : mapped;
            params.set('type', urlType);
        }
        if (o.year) params.set('year', String(o.year));
        if (o.source || o.page) params.set('source', String(o.source || o.page));
        // Explicit: never set autoExecute
        const qs = params.toString();
        return qs ? `settings-imports.html?${qs}` : 'settings-imports.html';
    }

    /**
     * Known functional-page shortcut map (type + source page id).
     */
    const SHORTCUT_PAGES = Object.freeze([
        { page: 'students-list.html', type: 'students', source: 'students-list' },
        { page: 'grades-sheets.html', type: 'grades', source: 'grades-sheets' },
        { page: 'grades-results.html', type: 'grades', source: 'grades-results' },
        { page: 'absence-analytics.html', type: 'absences', source: 'absence-analytics' },
        { page: 'absence-students.html', type: 'absences', source: 'absence-students' },
        { page: 'timetable.html', type: 'fet', source: 'timetable' },
        { page: 'teachers-list.html', type: 'agent_xml', source: 'teachers-list' },
        { page: 'students-status.html', type: 'student_status', source: 'students-status' }
    ]);

    /**
     * Enrich anchors marked data-import-shortcut with year when available.
     * Safe no-op without DOM.
     */
    function enhanceShortcutLinks(doc, year) {
        const documentRef = doc || (typeof document !== 'undefined' ? document : null);
        if (!documentRef || !documentRef.querySelectorAll) return 0;
        const y =
            year ||
            (typeof getCurrentSchoolYear === 'function' ? getCurrentSchoolYear() : null);
        let n = 0;
        documentRef.querySelectorAll('a[data-import-shortcut]').forEach((a) => {
            const type = a.getAttribute('data-import-type') || a.dataset.importType;
            const source = a.getAttribute('data-import-source') || a.dataset.importSource;
            a.setAttribute('href', buildImportCenterUrl({ type, year: y, source }));
            a.setAttribute('data-import-hint-only', 'true');
            n += 1;
        });
        return n;
    }

    return {
        TYPE_MAP,
        SHORTCUT_PAGES,
        parseQueryContext,
        fromLocation,
        toSourceContext,
        shouldInvalidateDecision,
        buildImportCenterUrl,
        enhanceShortcutLinks,
        /** Explicit firewall constant */
        AUTO_EXECUTE: false
    };
});
