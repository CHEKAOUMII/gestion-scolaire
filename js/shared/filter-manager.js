/**
 * FilterManager — unified cascading filters (SOLID WP6).
 * Classic-script module: attaches to window.PencilShared and bare global FilterManager.
 *
 * Runtime dependencies (from js/utils.js / other shared scripts, resolved at init()):
 *   getSchoolYear, setSelectOptions, getLevelFromSection, resolveLevelName,
 *   buildSubjectOptionsFromGrades, normalizeSubjectName, INVALID_SUBJECT_NAMES,
 *   compareSubjects, sortLevelNames, sortSectionNames
 *
 * Load order (defer):
 *   dom-helpers.js → auth-session.js → filter-manager.js → utils.js
 */
(function (global) {
    'use strict';

    const PencilShared = global.PencilShared || (global.PencilShared = {});

    /**
     * FilterManager — مكون فلترة موحد للقوائم المنسدلة المتسلسلة
     *
     * @example
     *   const fm = new FilterManager({
     *       selectors: { level: '#level-select', class: '#class-select', subject: '#subject-select' },
     *       onChange: (values) => console.log(values)
     *   });
     *   await fm.init();
     */
    class FilterManager {
        /**
         * @param {Object} config
         * @param {Object} config.selectors — CSS selectors or element IDs for each filter
         * @param {Function} [config.onChange]
         * @param {Function} [config.onError] — called with Error when a data load step fails
         * @param {Object} [config.placeholders]
         * @param {boolean} [config.subjectsFromGrades=false]
         * @param {string} [config.year]
         * @param {boolean} [config.autoInit=false]
         */
        constructor(config = {}) {
            this._config = config;
            const yearFn = global.getSchoolYear || PencilShared.getSchoolYear;
            this._year = config.year || (typeof yearFn === 'function' ? yearFn() : '2025/2026');
            this._placeholders = Object.assign(
                {
                    level: 'كل المستويات',
                    class: 'كل الأقسام',
                    subject: 'كل المواد',
                    teacher: 'كل الأساتذة'
                },
                config.placeholders || {}
            );
            this._onChange = typeof config.onChange === 'function' ? config.onChange : null;
            this._onError = typeof config.onError === 'function' ? config.onError : null;
            /** @type {{ classes?: Error, levelsMapping?: Error, subjects?: Error, grades?: Error }} */
            this._loadWarnings = {};

            this._els = {};
            this._allClasses = [];
            this._levelMap = new Map();
            this._levelsMapping = {};
            this._allSubjects = [];
            this._allGradesCache = [];
            this._handlers = {};

            if (config.autoInit) {
                Promise.resolve().then(() => this.init());
            }
        }

        async init() {
            this._resolveElements();
            await this._loadData();
            this._populateAll();
            this._bindEvents();
            return this;
        }

        /** Structured warnings from the last `_loadData` (empty object if none). */
        getLoadWarnings() {
            return { ...this._loadWarnings };
        }

        getValues() {
            return {
                level: this._val('level'),
                class: this._val('class'),
                subject: this._val('subject'),
                teacher: this._val('teacher')
            };
        }

        setValues(values = {}) {
            if (values.level !== undefined && this._els.level) {
                this._els.level.value = values.level;
            }
            this._refreshClasses();
            if (values.class !== undefined && this._els.class) {
                this._els.class.value = values.class;
            }
            this._refreshSubjects();
            if (values.subject !== undefined && this._els.subject) {
                this._els.subject.value = values.subject;
            }
            if (values.teacher !== undefined && this._els.teacher) {
                this._els.teacher.value = values.teacher;
            }
        }

        reset() {
            ['level', 'class', 'subject', 'teacher'].forEach((key) => {
                if (this._els[key]) this._els[key].value = '';
            });
            this._refreshClasses();
            this._refreshSubjects();
            this._fireOnChange();
        }

        getData() {
            return {
                classes: this._allClasses.slice(),
                levelMap: new Map(this._levelMap),
                subjects: this._allSubjects.slice(),
                grades: this._allGradesCache.slice()
            };
        }

        destroy() {
            Object.entries(this._handlers).forEach(([key, handler]) => {
                if (this._els[key]) {
                    this._els[key].removeEventListener('change', handler);
                }
            });
            this._handlers = {};
        }

        _resolveElements() {
            const sel = this._config.selectors || {};
            const doc = global.document;
            ['level', 'class', 'subject', 'teacher'].forEach((key) => {
                if (!sel[key]) {
                    this._els[key] = null;
                    return;
                }
                if (sel[key] instanceof global.HTMLElement) {
                    this._els[key] = sel[key];
                } else {
                    const id = String(sel[key]).replace(/^#/, '');
                    this._els[key] = doc ? doc.getElementById(id) : null;
                }
            });
        }

        _needsSelector(key) {
            return !!(this._config.selectors && this._config.selectors[key]);
        }

        _reportLoadError(key, err) {
            const error = err instanceof Error ? err : new Error(String(err || 'unknown'));
            this._loadWarnings[key] = error;
            if (this._onError) {
                try {
                    this._onError(error, key);
                } catch (_) {
                    /* ignore consumer errors */
                }
            }
        }

        async _loadData() {
            const year = this._year;
            const api = global.window && global.window.api;
            this._loadWarnings = {};

            const needsClasses = this._needsSelector('level') || this._needsSelector('class');
            const needsSubjects = this._needsSelector('subject');

            let classes = [];
            if (needsClasses) {
                try {
                    classes = (await api?.classes?.getAll?.(year)) || [];
                } catch (err) {
                    this._reportLoadError('classes', err);
                    classes = [];
                }
            }
            this._allClasses = classes.map((c) => c.name).filter(Boolean);

            if (needsClasses || needsSubjects) {
                try {
                    const mappingRaw = await api?.settings?.get?.('levelsMapping');
                    this._levelsMapping = mappingRaw ? JSON.parse(mappingRaw) : {};
                } catch (err) {
                    this._reportLoadError('levelsMapping', err);
                    this._levelsMapping = {};
                }
            } else {
                this._levelsMapping = {};
            }

            const getLevelFromSection = global.getLevelFromSection;
            this._levelMap = new Map();
            this._allClasses.forEach((name) => {
                const levelInfo =
                    typeof getLevelFromSection === 'function'
                        ? getLevelFromSection(name)
                        : { code: name, name, order: 0 };
                if (!this._levelMap.has(levelInfo.code)) {
                    this._levelMap.set(levelInfo.code, {
                        name: levelInfo.name,
                        order: levelInfo.order,
                        sections: []
                    });
                }
                const entry = this._levelMap.get(levelInfo.code);
                if (!entry.sections.includes(name)) entry.sections.push(name);
            });

            if (!needsSubjects) {
                this._allSubjects = [];
                this._allGradesCache = [];
                return;
            }

            if (this._config.subjectsFromGrades) {
                try {
                    this._allGradesCache = (await api?.grades?.getAll?.(year)) || [];
                } catch (err) {
                    this._reportLoadError('grades', err);
                    this._allGradesCache = [];
                }
                const buildSubjectOptionsFromGrades = global.buildSubjectOptionsFromGrades;
                this._allSubjects =
                    typeof buildSubjectOptionsFromGrades === 'function'
                        ? buildSubjectOptionsFromGrades(this._allGradesCache, {
                              getLevelName: (s) => this._getLocalLevelName(s)
                          })
                        : [];
            } else {
                try {
                    const subjects = (await api?.subjects?.getAll?.()) || [];
                    const normalized = new Set();
                    const normalizeSubjectName = global.normalizeSubjectName;
                    const invalid = global.INVALID_SUBJECT_NAMES;
                    subjects.forEach((s) => {
                        if (s.name) {
                            const n =
                                typeof normalizeSubjectName === 'function'
                                    ? normalizeSubjectName(s.name)
                                    : s.name;
                            if (n && !(invalid && invalid.has(String(n).toLowerCase()))) {
                                normalized.add(n);
                            }
                        }
                    });
                    const compareSubjects = global.compareSubjects;
                    this._allSubjects = Array.from(normalized).sort(
                        typeof compareSubjects === 'function'
                            ? compareSubjects
                            : (a, b) => String(a).localeCompare(String(b), 'ar')
                    );
                } catch (err) {
                    this._reportLoadError('subjects', err);
                    this._allSubjects = [];
                }
            }
        }

        _getLocalLevelName(section) {
            const resolveLevelName = global.resolveLevelName;
            if (typeof resolveLevelName === 'function') {
                return resolveLevelName(section, this._levelsMapping);
            }
            return section;
        }

        _populateAll() {
            this._populateLevels();
            this._refreshClasses();
            this._refreshSubjects();
        }

        _populateLevels() {
            const el = this._els.level;
            if (!el) return;

            const levelNames = new Set();
            this._levelMap.forEach((info) => levelNames.add(info.name));

            const sortLevelNames = global.sortLevelNames;
            const sorted =
                typeof sortLevelNames === 'function'
                    ? sortLevelNames(Array.from(levelNames))
                    : Array.from(levelNames).sort();

            const setSelectOptions = global.setSelectOptions || PencilShared.setSelectOptions;
            if (typeof setSelectOptions === 'function') {
                setSelectOptions(
                    el,
                    sorted.map((name) => ({ value: name, label: name })),
                    {
                        placeholder: this._placeholders.level,
                        getValue: (o) => o.value,
                        getLabel: (o) => o.label
                    }
                );
            }
        }

        _refreshClasses() {
            const el = this._els.class;
            if (!el) return;

            const selectedLevel = this._val('level');
            const previousValue = el.value;
            let list;

            if (selectedLevel) {
                list = this._allClasses.filter((name) => this._getLocalLevelName(name) === selectedLevel);
            } else {
                list = this._allClasses.slice();
            }

            const sortSectionNames = global.sortSectionNames;
            const sorted =
                typeof sortSectionNames === 'function' ? sortSectionNames(list) : list.slice().sort();

            const setSelectOptions = global.setSelectOptions || PencilShared.setSelectOptions;
            if (typeof setSelectOptions === 'function') {
                setSelectOptions(el, sorted, { placeholder: this._placeholders.class });
            }

            if (previousValue && Array.from(el.options).some((o) => o.value === previousValue)) {
                el.value = previousValue;
            }
        }

        _refreshSubjects() {
            const el = this._els.subject;
            if (!el) return;

            const selectedLevel = this._val('level');
            const selectedClass = this._val('class');
            const previousValue = el.value;
            let subjects;

            if (this._config.subjectsFromGrades && this._allGradesCache.length) {
                const buildSubjectOptionsFromGrades = global.buildSubjectOptionsFromGrades;
                subjects =
                    typeof buildSubjectOptionsFromGrades === 'function'
                        ? buildSubjectOptionsFromGrades(this._allGradesCache, {
                              level: selectedLevel,
                              section: selectedClass,
                              getLevelName: (s) => this._getLocalLevelName(s)
                          })
                        : [];
            } else {
                subjects = this._allSubjects;
            }

            const setSelectOptions = global.setSelectOptions || PencilShared.setSelectOptions;
            if (typeof setSelectOptions === 'function') {
                setSelectOptions(
                    el,
                    subjects.map((s) => ({ value: s, label: s })),
                    {
                        placeholder: this._placeholders.subject,
                        getValue: (o) => o.value,
                        getLabel: (o) => o.label
                    }
                );
            }

            if (previousValue && Array.from(el.options).some((o) => o.value === previousValue)) {
                el.value = previousValue;
            }
        }

        _bindEvents() {
            if (this._els.level) {
                this._handlers.level = () => {
                    this._refreshClasses();
                    this._refreshSubjects();
                    this._fireOnChange();
                };
                this._els.level.addEventListener('change', this._handlers.level);
            }

            if (this._els.class) {
                this._handlers.class = () => {
                    this._refreshSubjects();
                    this._fireOnChange();
                };
                this._els.class.addEventListener('change', this._handlers.class);
            }

            if (this._els.subject) {
                this._handlers.subject = () => {
                    this._fireOnChange();
                };
                this._els.subject.addEventListener('change', this._handlers.subject);
            }

            if (this._els.teacher) {
                this._handlers.teacher = () => {
                    this._fireOnChange();
                };
                this._els.teacher.addEventListener('change', this._handlers.teacher);
            }
        }

        _val(key) {
            return this._els[key]?.value || '';
        }

        _fireOnChange() {
            if (this._onChange) this._onChange(this.getValues());
        }
    }

    PencilShared.FilterManager = FilterManager;
    global.FilterManager = FilterManager;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { FilterManager };
    }
})(typeof window !== 'undefined' ? window : globalThis);
