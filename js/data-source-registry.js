// js/data-source-registry.js
// Standalone — depends only on localStorage.
// Future: will be imported by js/master-data.js

'use strict';

const _DSR_STORAGE_KEY = 'dataSourceRegistry';

class DataSourceRegistry {
    static _load() {
        try {
            return JSON.parse(localStorage.getItem(_DSR_STORAGE_KEY) || '{}');
        } catch (_) {
            return {};
        }
    }

    static _save(data) {
        localStorage.setItem(_DSR_STORAGE_KEY, JSON.stringify(data));
    }

    /**
     * Record a successful import for a source.
     * @param {string} source      — 'students' | 'grades' | 'absences' | 'fet' | 'agent_xml' | 'status'
     * @param {string} schoolYear
     * @param {object} meta        — { count?, sections?, subjects?, teachers?, pprList? }
     * @param {Array}  warnings    — CrossSourceValidator warnings for this source
     */
    static update(source, schoolYear, meta = {}, warnings = []) {
        const data = DataSourceRegistry._load();
        if (!data[schoolYear]) data[schoolYear] = {};
        data[schoolYear][source] = { importedAt: new Date().toISOString(), ...meta };
        // replace warnings for this source, keep others
        data[schoolYear].warnings = [
            ...(data[schoolYear].warnings || []).filter((w) => w.source !== source),
            ...warnings.map((w) => ({ ...w, source }))
        ];
        DataSourceRegistry._save(data);
    }

    /**
     * Get full state for a school year.
     * @param {string} schoolYear
     * @returns {object}
     */
    static getYear(schoolYear) {
        return DataSourceRegistry._load()[schoolYear] || {};
    }

    /**
     * Clear a source entry (call when data is deleted).
     * @param {string} source
     * @param {string} schoolYear
     */
    static clear(source, schoolYear) {
        const data = DataSourceRegistry._load();
        if (data[schoolYear]) {
            delete data[schoolYear][source];
            data[schoolYear].warnings = (data[schoolYear].warnings || []).filter(
                (w) => w.source !== source
            );
        }
        DataSourceRegistry._save(data);
    }
}
