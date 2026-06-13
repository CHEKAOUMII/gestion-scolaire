'use strict';

/**
 * Exemptions & Duty Matrix Grid — pure logic layer.
 *
 * Spec: .kiro/specs/exemptions-duty-matrix-grid/
 * Task 1 (foundation): status constants + canonical key derivation.
 *
 * This module is the single source of truth for the matrix-grid logic that
 * powers the redesigned "الإعفاءات والمداومة" sub-panel in
 * `exams-proctors.html`. It is a pure logic layer with NO DOM and NO IPC, so
 * it can be exercised by the Node test runner (`npm test`, fast-check) without
 * booting Electron, and attached to the renderer as a browser global.
 *
 * Subsequent tasks extend this same module with the remaining pure functions
 * (buildSessionColumns, buildDateGroups, resolveCellStatus, buildProctorRows,
 * buildMatrixModel, computeRowSummary, reduceMatrixToStore,
 * applySearchFilterSort, honorsUserChoices). To keep that extension clean,
 * everything is collected into a single `api` object that is exported through
 * both module systems at the bottom of the file.
 *
 * Key derivation is intentionally centralized here so the matrix grid, the
 * persistence layer, and the distribution constraint adapter all agree on the
 * exact store keys. These mirror the helpers currently inlined in
 * `exams-proctors.html`:
 *   - getProctorExemptionKey  (≈ line 1825)
 *   - getScheduleDateKey      (≈ line 3808)
 *   - getScheduleSortKey      (≈ line 3811)
 *   - getScheduleSessionKey   (≈ line 3817)
 *   - getLegacyScheduleSessionKey (≈ line 3821)
 *
 * Loaded via `<script src="js/exams/ed-matrix-logic.js"></script>` in the
 * renderer, and `require`-able from Node tests.
 *
 * @see .kiro/specs/exemptions-duty-matrix-grid/design.md
 */
(function () {
    // -----------------------------------------------------------------------
    // Status constants
    // -----------------------------------------------------------------------

    /**
     * The four Proctor_Status values. Guard is the implicit default and is the
     * only status never persisted to the store (it is represented by absence).
     * @enum {string}
     */
    var STATUS = Object.freeze({
        GUARD: 'guard',
        EXEMPT: 'exempt',
        DUTY: 'duty',
        RESERVE: 'reserve'
    });

    /**
     * One-to-one mapping from Proctor_Status to its short visible Status_Code.
     * The mapping is injective (no two statuses share a code) — Requirement 3.1.
     *   guard   → ك   (حراسة)
     *   exempt  → معفى (معفى)
     *   duty    → م   (مداومة)
     *   reserve → إح  (احتياط)
     * @type {Readonly<Object<string,string>>}
     */
    var STATUS_CODE = Object.freeze({
        guard: 'ك',
        exempt: 'معفى',
        duty: 'م',
        reserve: 'إح'
    });

    /**
     * Background color token per Proctor_Status. The four tokens are pairwise
     * distinct so each status maps to its own background — Requirement 3.2.
     * Values are CSS custom-property references resolved by the renderer's
     * stylesheet; keeping them as tokens (not literal colors) lets the theme
     * own the actual palette while this module owns the status→token mapping.
     * @type {Readonly<Object<string,string>>}
     */
    var STATUS_COLOR = Object.freeze({
        guard: 'var(--ed-guard-bg)',
        exempt: 'var(--ed-exempt-bg)',
        duty: 'var(--ed-duty-bg)',
        reserve: 'var(--ed-reserve-bg)'
    });

    /**
     * The set of statuses that are actually recorded in the Exemptions_Duty_Store
     * (guard is never persisted). Useful for validation in later tasks.
     * @type {ReadonlyArray<string>}
     */
    var PERSISTED_STATUSES = Object.freeze([STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE]);

    // -----------------------------------------------------------------------
    // Key derivation (single source of truth)
    // -----------------------------------------------------------------------

    /**
     * Canonical proctor key. Mirrors the helper inlined in
     * `exams-proctors.html`. Every status persisted by the matrix is keyed by
     * this value (Requirement 6.2).
     *
     * @param {{cin?: string, som?: string}} proc — proctor record.
     * @param {number} idx — index of the proctor in the proctors list.
     * @returns {string} `proc.cin || proc.som || ('idx_' + idx)`.
     */
    function getProctorExemptionKey(proc, idx) {
        if (!proc) {
            return 'idx_' + idx;
        }
        return proc.cin || proc.som || ('idx_' + idx);
    }

    /**
     * Date key for a schedule entry: `YYYY-MM-DD` (empty components dropped).
     * Dependency of `getScheduleSessionKey` and `getScheduleSortKey`.
     *
     * @param {{date_year?: (string|number), date_month?: (string|number), date_day?: (string|number)}} scheduleEntry
     * @returns {string}
     */
    function getScheduleDateKey(scheduleEntry) {
        if (!scheduleEntry) {
            return '';
        }
        var year = scheduleEntry.date_year || '';
        var month = scheduleEntry.date_month ? String(scheduleEntry.date_month).padStart(2, '0') : '';
        var day = scheduleEntry.date_day ? String(scheduleEntry.date_day).padStart(2, '0') : '';
        return [year, month, day].filter(Boolean).join('-');
    }

    /**
     * Explicit session-sequence rank table — the single source of truth for the
     * canonical session ordering الأولى < الثانية < الثالثة (Requirement 1.4).
     *
     * The previous digit-extraction approach was fragile: the canonical session
     * names (الحصة الأولى/الثانية/الثالثة) carry NO digits, so stripping
     * non-digits yielded an empty token and the sort fell back to raw lexical
     * comparison of the Arabic strings — where الحصة الثالثة (ل U+0644) sorts
     * BEFORE الحصة الثانية (ن U+0646), inverting the third/second order. Mapping
     * the canonical names to explicit ranks removes that ambiguity. Unknown
     * names get a high rank so they sort last, deterministically.
     * @type {Readonly<Object<string,number>>}
     */
    var SESSION_SEQUENCE_RANK = Object.freeze({
        'الحصة الأولى': 1,
        'الحصة الثانية': 2,
        'الحصة الثالثة': 3
    });

    /**
     * Rank for a session name, as a fixed-width single-digit token so it
     * composes correctly into the pipe-joined sort key. Canonical Arabic names
     * map via SESSION_SEQUENCE_RANK (the source of truth); anything else
     * (including the rare digit-bearing form) sorts last under rank 9.
     *
     * @param {string} session
     * @returns {string} a single-character sortable token ('1'..'3', else '9').
     */
    function getSessionSequenceOrder(session) {
        var rank = SESSION_SEQUENCE_RANK[session];
        return String(rank ? rank : 9);
    }

    /**
     * Chronological sort key: date asc, then period (صباحا before زوالا), then
     * session sequence, then order, then subject. Used to order Session_Columns
     * (Requirement 1.3, 1.4).
     *
     * @param {object} scheduleEntry
     * @returns {string}
     */
    function getScheduleSortKey(scheduleEntry) {
        if (!scheduleEntry) {
            return '';
        }
        var period = scheduleEntry.period || '';
        var periodOrder = period === 'صباحا' ? '1' : period === 'زوالا' ? '2' : '9';
        var sessionOrder = getSessionSequenceOrder(scheduleEntry.session || '');
        var order = String(scheduleEntry.order || '').padStart(3, '0');
        return [getScheduleDateKey(scheduleEntry), periodOrder, sessionOrder, order, scheduleEntry.subject_name || ''].join('|');
    }

    /**
     * Dated session key used for duty/reserve store lookups:
     * `YYYY-MM-DD|day|period|session`. Mirrors the helper inlined in
     * `exams-proctors.html`.
     *
     * @param {object} scheduleEntry
     * @returns {string}
     */
    function getScheduleSessionKey(scheduleEntry) {
        if (!scheduleEntry) {
            return ['', 'الأول', 'صباحا', 'الحصة الأولى'].join('|');
        }
        return [
            getScheduleDateKey(scheduleEntry),
            scheduleEntry.day || 'الأول',
            scheduleEntry.period || 'صباحا',
            scheduleEntry.session || 'الحصة الأولى'
        ].join('|');
    }

    /**
     * Legacy (no date prefix) session key: `day|period|session`. Pre-dated
     * store buckets use this shape; status resolution checks both shapes so
     * legacy data renders without migration.
     *
     * @param {object} scheduleEntry
     * @returns {string}
     */
    function getLegacyScheduleSessionKey(scheduleEntry) {
        if (!scheduleEntry) {
            return ['الأول', 'صباحا', 'الحصة الأولى'].join('|');
        }
        return [
            scheduleEntry.day || 'الأول',
            scheduleEntry.period || 'صباحا',
            scheduleEntry.session || 'الحصة الأولى'
        ].join('|');
    }

    // -----------------------------------------------------------------------
    // Session column + date-group construction (Task 2.1)
    // -----------------------------------------------------------------------

    /**
     * Reformat a `YYYY-MM-DD` date key into the renderer's display form
     * `DD/MM/YYYY`. Mirrors `formatDateAr` in `exams-proctors.html`. Returns an
     * empty string for a missing/empty key (the renderer supplies any visible
     * placeholder); a non-3-part key is returned unchanged.
     *
     * @param {string} dateKey
     * @returns {string}
     */
    function formatDateLabel(dateKey) {
        if (!dateKey) {
            return '';
        }
        var parts = String(dateKey).split('-');
        if (parts.length !== 3) {
            return String(dateKey);
        }
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    /**
     * The exempt-scope key for a session: `['session', day, period, session]`.
     * This is the bucket key used by `examExemptionsData` (Requirement design
     * "Session column model"), distinct from the dated duty/reserve session key.
     *
     * @param {object} scheduleEntry
     * @returns {string}
     */
    function getScheduleExemptKey(scheduleEntry) {
        if (!scheduleEntry) {
            return ['session', 'الأول', 'صباحا', 'الحصة الأولى'].join('|');
        }
        return [
            'session',
            scheduleEntry.day || 'الأول',
            scheduleEntry.period || 'صباحا',
            scheduleEntry.session || 'الحصة الأولى'
        ].join('|');
    }

    /**
     * Collapse raw schedule entries into the ordered list of distinct
     * Session_Columns that drive the matrix grid (Requirement 1.2, 1.3, 1.4).
     *
     * Entries are grouped by their dated `sessionKey` (the canonical
     * `getScheduleSessionKey` value used for duty/reserve store lookups), which
     * encodes the distinct (date, day, period, session) tuple. Each distinct
     * session becomes one column; every subject scheduled in that session is
     * collected (de-duplicated, first-seen order) into `subjects`.
     *
     * Columns are ordered chronologically: date ascending, then period
     * (صباحا before زوالا), then session sequence (الحصة الأولى/الثانية/الثالثة),
     * via `getScheduleSortKey`.
     *
     * @param {Array<object>} scheduleEntries
     * @returns {Array<{sessionKey:string, exemptKey:string, dateKey:string, dateLabel:string, day:string, period:string, session:string, subjects:string[], sortKey:string}>}
     */
    function buildSessionColumns(scheduleEntries) {
        var entries = Array.isArray(scheduleEntries) ? scheduleEntries : [];
        var byKey = Object.create(null);
        var columns = [];

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (!entry) {
                continue;
            }
            var sessionKey = getScheduleSessionKey(entry);
            var col = byKey[sessionKey];
            if (!col) {
                var dateKey = getScheduleDateKey(entry);
                col = {
                    sessionKey: sessionKey,
                    exemptKey: getScheduleExemptKey(entry),
                    dateKey: dateKey,
                    dateLabel: formatDateLabel(dateKey),
                    day: entry.day || 'الأول',
                    period: entry.period || 'صباحا',
                    session: entry.session || 'الحصة الأولى',
                    subjects: [],
                    sortKey: getScheduleSortKey(entry)
                };
                byKey[sessionKey] = col;
                columns.push(col);
            }
            var subject = entry.subject_name;
            if (subject && col.subjects.indexOf(subject) === -1) {
                col.subjects.push(subject);
            }
        }

        columns.sort(function (a, b) {
            if (a.sortKey < b.sortKey) {
                return -1;
            }
            if (a.sortKey > b.sortKey) {
                return 1;
            }
            return 0;
        });

        return columns;
    }

    /**
     * Partition ordered Session_Columns into Date_Group_Headers, one per
     * distinct date, ordered chronologically ascending (Requirement 1.3).
     *
     * Columns are assumed to already be ordered by `buildSessionColumns`; within
     * each group the column order is preserved, and `span` is the number of
     * columns in the group (for the header `colspan`). Date keys are `YYYY-MM-DD`
     * so lexical ascending order equals chronological ascending order.
     *
     * @param {Array<object>} sessionColumns
     * @returns {Array<{dateKey:string, dateLabel:string, span:number, columns:object[]}>}
     */
    function buildDateGroups(sessionColumns) {
        var columns = Array.isArray(sessionColumns) ? sessionColumns : [];
        var byDate = Object.create(null);
        var groups = [];

        for (var i = 0; i < columns.length; i++) {
            var col = columns[i];
            if (!col) {
                continue;
            }
            var dateKey = col.dateKey || '';
            var group = byDate[dateKey];
            if (!group) {
                group = {
                    dateKey: dateKey,
                    dateLabel: col.dateLabel || formatDateLabel(dateKey),
                    span: 0,
                    columns: []
                };
                byDate[dateKey] = group;
                groups.push(group);
            }
            group.columns.push(col);
            group.span = group.columns.length;
        }

        groups.sort(function (a, b) {
            if (a.dateKey < b.dateKey) {
                return -1;
            }
            if (a.dateKey > b.dateKey) {
                return 1;
            }
            return 0;
        });

        return groups;
    }

    // -----------------------------------------------------------------------
    // Status resolution from the store (Task 3.1)
    // -----------------------------------------------------------------------

    /**
     * Build the legacy (no date prefix) session key for a Session_Column by
     * reusing `getLegacyScheduleSessionKey`. The session column does not carry
     * the raw schedule entry, so we reconstruct the minimal shape it needs
     * (day / period / session) and delegate to the existing helper. This keeps
     * the legacy key shape (`day|period|session`) defined in exactly one place.
     *
     * @param {{day?:string, period?:string, session?:string}} sessionColumn
     * @returns {string}
     */
    function getSessionColumnLegacyKey(sessionColumn) {
        return getLegacyScheduleSessionKey({
            day: sessionColumn.day,
            period: sessionColumn.period,
            session: sessionColumn.session
        });
    }

    /**
     * True iff `proctorKey` has a truthy duty/reserve entry in `map` under any
     * of the candidate `sessionKey|subject` buckets. Mirrors the existing
     * `getEdDutyReserveKeySets` lookup in `exams-proctors.html`, which checks
     * `if (map[bucket][proctorKey])` (truthy) across both the dated and legacy
     * key shapes for each subject.
     *
     * @param {Object<string, Object<string, *>>} map — dutyData or reservesData.
     * @param {string[]} bucketKeys — candidate `sessionKey|subject` bucket keys.
     * @param {string} proctorKey
     * @returns {boolean}
     */
    function hasTruthyBucketEntry(map, bucketKeys, proctorKey) {
        if (!map) {
            return false;
        }
        for (var i = 0; i < bucketKeys.length; i++) {
            var bucket = map[bucketKeys[i]];
            if (bucket && bucket[proctorKey]) {
                return true;
            }
        }
        return false;
    }

    /**
     * Collect the duty/reserve bucket keys for a Session_Column: for every
     * subject scheduled in the session, both the dated `sessionKey|subject`
     * shape and the legacy `day|period|session|subject` shape. A session with
     * no subjects still yields the bare dated/legacy keys (with a trailing
     * empty subject) so pre-existing subject-less buckets still resolve.
     *
     * @param {object} sessionColumn
     * @returns {string[]}
     */
    function getSessionColumnBucketKeys(sessionColumn) {
        var datedBase = sessionColumn.sessionKey || '';
        var legacyBase = getSessionColumnLegacyKey(sessionColumn);
        var subjects = Array.isArray(sessionColumn.subjects) ? sessionColumn.subjects : [];
        var subjectList = subjects.length ? subjects : [''];
        var keys = [];
        for (var i = 0; i < subjectList.length; i++) {
            var subject = subjectList[i] || '';
            keys.push(datedBase + '|' + subject);
            keys.push(legacyBase + '|' + subject);
        }
        return keys;
    }

    /**
     * Resolve the Proctor_Status for one proctor in one session from the store.
     *
     * Precedence (mirrors the existing `getProctorEdStatus`):
     *   reserve → duty → exempt → guard (default).
     *
     * Lookups:
     *   - reserve / duty: by `sessionKey|subject` across the session's subjects
     *     AND the legacy `day|period|session|subject` key shape, treating any
     *     truthy bucket entry as a match.
     *   - exempt: `exemptionsData[exemptKey][proctorKey] === 'no'`.
     *
     * Returns guard for any missing entry, a null/undefined store or sub-map,
     * a missing proctor key, or any value not in {exempt, duty, reserve}
     * (Requirements 4.1, 4.3).
     *
     * @param {{exemptionsData?:object, dutyData?:object, reservesData?:object}} store
     * @param {string} proctorKey — canonical key from getProctorExemptionKey.
     * @param {object} sessionColumn — a SessionColumn from buildSessionColumns.
     * @returns {string} one of STATUS.RESERVE / DUTY / EXEMPT / GUARD.
     */
    function resolveCellStatus(store, proctorKey, sessionColumn) {
        if (!store || !proctorKey || !sessionColumn) {
            return STATUS.GUARD;
        }

        var bucketKeys = getSessionColumnBucketKeys(sessionColumn);

        if (hasTruthyBucketEntry(store.reservesData, bucketKeys, proctorKey)) {
            return STATUS.RESERVE;
        }
        if (hasTruthyBucketEntry(store.dutyData, bucketKeys, proctorKey)) {
            return STATUS.DUTY;
        }

        var exemptionsData = store.exemptionsData;
        var exemptKey = sessionColumn.exemptKey;
        if (exemptionsData && exemptKey && exemptionsData[exemptKey] && exemptionsData[exemptKey][proctorKey] === 'no') {
            return STATUS.EXEMPT;
        }

        return STATUS.GUARD;
    }

    // -----------------------------------------------------------------------
    // Proctor row + matrix model construction (Task 4.1)
    // -----------------------------------------------------------------------

    /**
     * Normalize one raw Identity_Column value into the row's `identity` shape.
     * A value that is null/undefined or — after trimming — an empty string is
     * treated as "no value" and stored as `null`; otherwise the ORIGINAL value
     * (coerced to a string, untrimmed so display is faithful) is kept.
     *
     * Storing empties as a uniform `null` lets the renderer (Task 11) show one
     * identical placeholder for every missing field (Requirement 2.2) and lets
     * the emptiness test for row omission (Requirement 2.3) be a simple
     * `=== null` check.
     *
     * @param {*} value — a raw proctor field (teacher_name / som / workplace / specialty).
     * @returns {?string} the string value, or null when empty/absent.
     */
    function normalizeIdentityField(value) {
        if (value == null) {
            return null;
        }
        var str = String(value);
        return str.trim() === '' ? null : str;
    }

    /**
     * Build the ordered, identity-filtered list of Proctor_Rows for the matrix
     * grid (Requirements 1.1, 2.3, 2.4, 2.5).
     *
     * For each proctor (iterated WITH its original index `idx`):
     *   - `proctorKey` = `getProctorExemptionKey(proc, idx)` — the canonical
     *     store key. The ORIGINAL index is used so omitting identity-empty rows
     *     never shifts the key derivation of the rows that are kept
     *     (`idx_<index>` fallbacks stay stable).
     *   - `identity` maps the four data Identity_Columns:
     *     name←`teacher_name`, registration←`som`, institution←`workplace`,
     *     specialty←`specialty`, each normalized (empty → null).
     *   - `hasAnyIdentity` is true iff at least one of those four fields is
     *     non-empty. A proctor whose four data identity fields are all empty/null
     *     is OMITTED from the result (Requirement 2.3). (ترتيب is a derived
     *     display index, not a data field, so it does not enter this test.)
     *   - `cells` is a `Map<sessionKey, status>` with one resolved status per
     *     Session_Column via `resolveCellStatus` (absence/unrecognized → guard).
     *   - `summary` is the per-status count over those cells via
     *     `computeRowSummary`.
     *
     * Kept rows are numbered with a gapless `order` = 1..n in display (input)
     * order; omitted rows do not consume an `order` value, so the sequence has
     * no gaps and no repeats (Requirements 2.4, 2.5).
     *
     * Neither the proctor records nor the session columns are mutated.
     *
     * @param {Array<object>} proctorsList — raw proctor records (loadProctors order).
     * @param {Array<object>} sessionColumns — SessionColumns from buildSessionColumns.
     * @param {{exemptionsData?:object, dutyData?:object, reservesData?:object}} store
     * @returns {Array<{proctor:object, proctorKey:string, identity:{name:?string, registration:?string, institution:?string, specialty:?string}, cells:Map<string,string>, summary:{guard:number, exempt:number, duty:number, reserve:number}, hasAnyIdentity:boolean, order:number}>}
     */
    function buildProctorRows(proctorsList, sessionColumns, store) {
        var proctors = Array.isArray(proctorsList) ? proctorsList : [];
        var columns = Array.isArray(sessionColumns) ? sessionColumns : [];
        var rows = [];
        var order = 0;

        for (var idx = 0; idx < proctors.length; idx++) {
            var proc = proctors[idx];
            // proctorKey MUST use the original list index so row omission never
            // shifts the idx_<index> fallback for the rows we keep.
            var proctorKey = getProctorExemptionKey(proc, idx);

            var identity = {
                name: normalizeIdentityField(proc ? proc.teacher_name : null),
                registration: normalizeIdentityField(proc ? proc.som : null),
                institution: normalizeIdentityField(proc ? proc.workplace : null),
                specialty: normalizeIdentityField(proc ? proc.specialty : null)
            };

            var hasAnyIdentity = identity.name !== null ||
                identity.registration !== null ||
                identity.institution !== null ||
                identity.specialty !== null;

            // Omit a proctor whose four data identity fields are all empty/null
            // (Requirement 2.3).
            if (!hasAnyIdentity) {
                continue;
            }

            var cells = new Map();
            for (var c = 0; c < columns.length; c++) {
                var col = columns[c];
                if (!col) {
                    continue;
                }
                cells.set(col.sessionKey, resolveCellStatus(store, proctorKey, col));
            }

            order++; // gapless 1..n across KEPT rows, in display order.
            rows.push({
                proctor: proc,
                proctorKey: proctorKey,
                identity: identity,
                cells: cells,
                summary: computeRowSummary(cells.values()),
                hasAnyIdentity: hasAnyIdentity,
                order: order
            });
        }

        return rows;
    }

    /**
     * Assemble the full in-memory MatrixModel from proctors, session columns,
     * and the store (Requirement 1.1). This is the transient model the renderer
     * consumes and the Save path reduces back to the store; it is never
     * persisted.
     *
     * @param {Array<object>} proctors — raw proctor records.
     * @param {Array<object>} sessions — SessionColumns from buildSessionColumns.
     * @param {{exemptionsData?:object, dutyData?:object, reservesData?:object}} store
     * @returns {{sessions:Array<object>, dateGroups:Array<object>, rows:Array<object>, totalSessions:number}}
     */
    function buildMatrixModel(proctors, sessions, store) {
        var sessionColumns = Array.isArray(sessions) ? sessions : [];
        return {
            sessions: sessionColumns,
            dateGroups: buildDateGroups(sessionColumns),
            rows: buildProctorRows(proctors, sessionColumns, store),
            totalSessions: sessionColumns.length
        };
    }

    // -----------------------------------------------------------------------
    // Row summary computation (Task 5.1)
    // -----------------------------------------------------------------------

    /**
     * Count the four Proctor_Status values across one Proctor_Row's cells
     * (Requirements 8.1–8.4, 8.6).
     *
     * `cellStatuses` is an iterable of Proctor_Status strings — typically an
     * array of resolved statuses, or the `.values()` of a `Map<sessionKey,
     * status>`. A `Map` itself is accepted as a convenience: its values are
     * counted (not its entries). Any other non-iterable input is treated as
     * empty.
     *
     * Any value that is not one of the four known statuses is counted as guard
     * (the default), mirroring `resolveCellStatus`'s "unrecognized → guard"
     * treatment. This guarantees the conservation invariant
     * `guard + exempt + duty + reserve === <number of input cells>`
     * (Requirement 8.7) for every input.
     *
     * @param {Iterable<string>|Map<*, string>} cellStatuses
     * @returns {{guard:number, exempt:number, duty:number, reserve:number}}
     */
    function computeRowSummary(cellStatuses) {
        var summary = { guard: 0, exempt: 0, duty: 0, reserve: 0 };

        if (!cellStatuses) {
            return summary;
        }

        // A Map is iterable as [key, value] entries; we want its values.
        var iterable = (typeof Map !== 'undefined' && cellStatuses instanceof Map)
            ? cellStatuses.values()
            : cellStatuses;

        // Guard against non-iterables (e.g. a plain object): treat as empty.
        if (typeof iterable !== 'string' &&
            (iterable == null || typeof iterable[Symbol.iterator] !== 'function')) {
            return summary;
        }

        var status;
        for (status of iterable) {
            if (status === STATUS.EXEMPT) {
                summary.exempt++;
            } else if (status === STATUS.DUTY) {
                summary.duty++;
            } else if (status === STATUS.RESERVE) {
                summary.reserve++;
            } else {
                // guard, plus any unrecognized value (default → guard).
                summary.guard++;
            }
        }

        return summary;
    }

    // -----------------------------------------------------------------------
    // Store reduction for Save (Task 6.1)
    // -----------------------------------------------------------------------

    /**
     * Read a Proctor_Row's resolved status for one session. The matrix model
     * carries `cells` as a `Map<sessionKey, status>`, but a plain object map is
     * also accepted for robustness. A missing entry (or missing `cells`) means
     * the proctor was never assigned anything for that session, which resolves
     * to guard (the default).
     *
     * @param {Map<string,string>|Object<string,string>|null|undefined} cells
     * @param {string} sessionKey
     * @returns {string} the cell's status, or STATUS.GUARD when absent.
     */
    function readMatrixCellStatus(cells, sessionKey) {
        if (!cells) {
            return STATUS.GUARD;
        }
        if (typeof Map !== 'undefined' && cells instanceof Map) {
            return cells.has(sessionKey) ? cells.get(sessionKey) : STATUS.GUARD;
        }
        if (typeof cells === 'object' && Object.prototype.hasOwnProperty.call(cells, sessionKey)) {
            return cells[sessionKey];
        }
        return STATUS.GUARD;
    }

    /**
     * Write a duty/reserve entry for one proctor into every subject bucket of a
     * Session_Column. Mirrors the exact key shape produced by the existing
     * `saveExemptionsDuty` path in `exams-proctors.html`:
     *
     *   bucketKey = getScheduleSessionKey(entry) + '|' + (subject_name || '')
     *
     * i.e. the dated `sessionKey|subject` shape (NOT the legacy no-date shape —
     * the save path only ever writes the dated key and prunes the legacy one).
     * For a multi-subject session, one entry is written under each subject's
     * dated key. For a subject-less session, a single bucket with an empty
     * subject (`sessionKey + '|'`) is written, again matching the save path's
     * `(e.subject_name || '')` fallback.
     *
     * @param {Object<string, Object<string, boolean>>} map — dutyData or reservesData.
     * @param {object} sessionColumn — a SessionColumn from buildSessionColumns.
     * @param {string} proctorKey — canonical key from getProctorExemptionKey.
     */
    function writeDutyReserveBuckets(map, sessionColumn, proctorKey) {
        var datedBase = sessionColumn.sessionKey || '';
        var subjects = Array.isArray(sessionColumn.subjects) ? sessionColumn.subjects : [];
        var subjectList = subjects.length ? subjects : [''];
        for (var i = 0; i < subjectList.length; i++) {
            var subject = subjectList[i] || '';
            var bucketKey = datedBase + '|' + subject;
            if (!map[bucketKey]) {
                map[bucketKey] = {};
            }
            map[bucketKey][proctorKey] = true;
        }
    }

    /**
     * Reduce the full in-memory matrix model back into the three persisted
     * store maps, ready to be saved through `window.api.examConfig`
     * (Requirements 6.1, 6.2, 6.3).
     *
     * Routing per cell status:
     *   - exempt  → `exemptionsData[col.exemptKey][proctorKey] = 'no'`
     *   - duty    → `dutyData[col.sessionKey + '|' + subject][proctorKey] = true`
     *   - reserve → `reservesData[col.sessionKey + '|' + subject][proctorKey] = true`
     *   - guard (and any unrecognized value) → NO entry in any map (Req 6.3).
     *
     * Duty/reserve are written under each of the session's subjects using the
     * dated `sessionKey|subject` shape (subject-less sessions use a trailing
     * empty subject), exactly matching the existing save path so the rest of
     * the app and the distribution algorithm read what the matrix writes.
     *
     * Every inner key is `row.proctorKey`, which is `getProctorExemptionKey`'s
     * output captured on the row at build time (Requirement 6.2). Three fresh
     * objects are always returned; the input model is never mutated.
     *
     * @param {{sessions?: object[], rows?: object[]}} matrixModel
     * @returns {{exemptionsData: object, dutyData: object, reservesData: object}}
     */
    function reduceMatrixToStore(matrixModel) {
        var exemptionsData = {};
        var dutyData = {};
        var reservesData = {};

        if (!matrixModel) {
            return { exemptionsData: exemptionsData, dutyData: dutyData, reservesData: reservesData };
        }

        var sessions = Array.isArray(matrixModel.sessions) ? matrixModel.sessions : [];
        var rows = Array.isArray(matrixModel.rows) ? matrixModel.rows : [];

        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            if (!row || !row.proctorKey) {
                continue;
            }
            var proctorKey = row.proctorKey;
            var cells = row.cells;

            for (var s = 0; s < sessions.length; s++) {
                var col = sessions[s];
                if (!col) {
                    continue;
                }
                var status = readMatrixCellStatus(cells, col.sessionKey);

                if (status === STATUS.EXEMPT) {
                    var exemptKey = col.exemptKey;
                    if (exemptKey) {
                        if (!exemptionsData[exemptKey]) {
                            exemptionsData[exemptKey] = {};
                        }
                        exemptionsData[exemptKey][proctorKey] = 'no';
                    }
                } else if (status === STATUS.DUTY) {
                    writeDutyReserveBuckets(dutyData, col, proctorKey);
                } else if (status === STATUS.RESERVE) {
                    writeDutyReserveBuckets(reservesData, col, proctorKey);
                }
                // guard (and any unrecognized value) → omitted from all maps.
            }
        }

        return { exemptionsData: exemptionsData, dutyData: dutyData, reservesData: reservesData };
    }

    // -----------------------------------------------------------------------
    // Search / filter / sort (Task 8.1)
    // -----------------------------------------------------------------------

    /**
     * The Identity_Columns that are sortable, mapped to where their value lives
     * on a ProctorRow. `order` is the row-level ترتيب number (numeric compare);
     * the other four read `row.identity.<field>` (locale-aware text compare).
     * @type {Readonly<Object<string,string>>}
     */
    var SORTABLE_COLUMNS = Object.freeze({
        order: 'order',
        name: 'name',
        registration: 'registration',
        institution: 'institution',
        specialty: 'specialty'
    });

    /**
     * Compute the next sort state when a sortable Identity_Column header is
     * activated (Requirement 9.5). This encodes the toggle semantics the view
     * layer (Task 15.1) drives:
     *   - Activating a column that is NOT the current sort column → ascending.
     *   - Activating the SAME column again → toggle asc ⇄ desc.
     * The returned object is the `sort` argument shape consumed by
     * `applySearchFilterSort` (`{ column, direction }`), so a header click is
     * simply `state.sort = nextSortState(state.sort, column)` followed by a
     * re-render. Pure: it never mutates `currentSort`.
     *
     * @param {?{column?:string, direction?:string}} currentSort — the active sort, or null.
     * @param {string} column — the activated column id (key of SORTABLE_COLUMNS).
     * @returns {{column:string, direction:('asc'|'desc')}}
     */
    function nextSortState(currentSort, column) {
        if (!currentSort || currentSort.column !== column) {
            return { column: column, direction: 'asc' };
        }
        return {
            column: column,
            direction: currentSort.direction === 'asc' ? 'desc' : 'asc'
        };
    }

    /**
     * True iff a ProctorRow matches the (already trimmed + lower-cased,
     * non-empty) search needle against its name (الاسم) OR specialty
     * (مادة التخصص), case-insensitively (Requirement 9.1). Missing fields are
     * treated as the empty string.
     *
     * @param {object} row — a ProctorRow.
     * @param {string} needle — trimmed, lower-cased, non-empty search text.
     * @returns {boolean}
     */
    function rowMatchesSearch(row, needle) {
        var identity = (row && row.identity) ? row.identity : {};
        var name = identity.name == null ? '' : String(identity.name);
        var specialty = identity.specialty == null ? '' : String(identity.specialty);
        return name.toLowerCase().indexOf(needle) !== -1 ||
            specialty.toLowerCase().indexOf(needle) !== -1;
    }

    /**
     * True iff a ProctorRow has at least one Status_Cell holding `status`
     * (Requirement 9.3). Prefers the row's precomputed `summary` count; when no
     * usable summary is present it falls back to counting the row's `cells` via
     * `computeRowSummary` (which also handles the Map shape and counts
     * unrecognized values as guard, so guard-by-default cells are included).
     *
     * @param {object} row — a ProctorRow.
     * @param {string} status — one of STATUS.GUARD/EXEMPT/DUTY/RESERVE.
     * @returns {boolean}
     */
    function rowHasStatus(row, status) {
        if (!row) {
            return false;
        }
        var summary = row.summary;
        if (!summary || typeof summary[status] !== 'number') {
            summary = computeRowSummary(row.cells);
        }
        return summary[status] > 0;
    }

    /**
     * Extract the comparable value for a row on a sortable column. `order` is
     * numeric; every other column is the corresponding `identity` field coerced
     * to a string (missing → '').
     *
     * @param {object} row
     * @param {string} column — a key of SORTABLE_COLUMNS.
     * @returns {(number|string)}
     */
    function getSortValue(row, column) {
        if (column === 'order') {
            return (row && typeof row.order === 'number') ? row.order : 0;
        }
        var identity = (row && row.identity) ? row.identity : {};
        var value = identity[column];
        return value == null ? '' : String(value);
    }

    /**
     * Filter, then sort, then renumber a ProctorRow array for display
     * (Requirements 9.1–9.5, 9.7).
     *
     * Contract
     * --------
     * `rows` — the full, ordered array of ProctorRows (the matrix model's
     *   `rows`). Never mutated. Each row is expected to carry
     *   `{ order, identity:{ name, registration, institution, specialty },
     *      cells:Map<sessionKey,status>, summary:{guard,exempt,duty,reserve} }`.
     *
     * `options` — `{ searchText, statusFilter, sort }`:
     *   - `searchText` {string=}: matched against name OR specialty after
     *     trimming and case-folding. Empty / whitespace-only / missing imposes
     *     NO search restriction (Requirement 9.2).
     *   - `statusFilter` {string=}: one of 'guard'|'exempt'|'duty'|'reserve' to
     *     keep only rows with ≥1 cell of that status (Requirement 9.3). Any
     *     other value — 'all', '', null, undefined — imposes NO status
     *     restriction (Requirement 9.4).
     *   - `sort` {?{column,direction}}: `column` is one of
     *     'order'|'name'|'registration'|'institution'|'specialty' and
     *     `direction` is 'asc'|'desc' (anything other than 'desc' is treated as
     *     'asc'). A null/absent `sort`, or an unrecognized `column`, preserves
     *     the input order. Use `nextSortState` to derive this object from header
     *     activations (ascending first, toggling on repeat — Requirement 9.5).
     *     Text columns compare with locale-aware `localeCompare` ('ar') so
     *     Arabic names/specialties order naturally; `order` compares numerically.
     *     The sort is stable: rows that compare equal keep their input order.
     *
     * Return value
     * ------------
     * A NEW array containing a shallow copy of each visible row, in display
     * order, with its `order` (ترتيب) reassigned to a gapless 1..n sequence
     * matching the returned order (Requirements 2.4/2.5, supports Property 5).
     * Input rows are never mutated and every cell's status is preserved: copies
     * share the original `cells`/`identity`/`summary` references, which this
     * function only reads (Requirement 9.7).
     *
     * @param {Array<object>} rows
     * @param {{searchText?:string, statusFilter?:string, sort?:?object}} [options]
     * @returns {Array<object>} the visible, renumbered row copies.
     */
    function applySearchFilterSort(rows, options) {
        var list = Array.isArray(rows) ? rows : [];
        var opts = options || {};

        // 1. Search — trim + case-fold; empty/whitespace imposes no restriction.
        var rawSearch = opts.searchText == null ? '' : String(opts.searchText);
        var needle = rawSearch.trim().toLowerCase();
        var hasSearch = needle.length > 0;

        // 2. Status filter — only the four known statuses restrict; else none.
        var statusFilter = opts.statusFilter;
        var hasStatusFilter = statusFilter === STATUS.GUARD ||
            statusFilter === STATUS.EXEMPT ||
            statusFilter === STATUS.DUTY ||
            statusFilter === STATUS.RESERVE;

        // Decorate with the input index so the sort can stay stable and so an
        // absent sort preserves input order exactly.
        var decorated = [];
        for (var i = 0; i < list.length; i++) {
            var row = list[i];
            if (!row) {
                continue;
            }
            if (hasSearch && !rowMatchesSearch(row, needle)) {
                continue;
            }
            if (hasStatusFilter && !rowHasStatus(row, statusFilter)) {
                continue;
            }
            decorated.push({ row: row, idx: i });
        }

        // 3. Sort — only for a recognized column; otherwise preserve input order.
        var sort = opts.sort;
        var column = (sort && typeof sort === 'object') ? sort.column : null;
        if (column && Object.prototype.hasOwnProperty.call(SORTABLE_COLUMNS, column)) {
            var direction = sort.direction === 'desc' ? -1 : 1;
            var numeric = column === 'order';
            decorated.sort(function (a, b) {
                var va = getSortValue(a.row, column);
                var vb = getSortValue(b.row, column);
                var cmp;
                if (numeric) {
                    cmp = va - vb;
                } else {
                    cmp = String(va).localeCompare(String(vb), 'ar');
                }
                if (cmp !== 0) {
                    return cmp * direction;
                }
                // Stable tiebreaker: equal rows keep their original order.
                return a.idx - b.idx;
            });
        }

        // 4. Shallow-copy each visible row and renumber ترتيب to a gapless 1..n
        //    sequence in display order (cells/identity/summary are shared, not
        //    mutated, so every cell status is preserved — Req 9.7).
        var result = [];
        for (var j = 0; j < decorated.length; j++) {
            var copy = Object.assign({}, decorated[j].row);
            copy.order = j + 1;
            result.push(copy);
        }
        return result;
    }

    // -----------------------------------------------------------------------
    // Distribution constraint adapter (Task 9.1)
    // -----------------------------------------------------------------------

    /**
     * Default-guard predicate — the verification-side mirror of the
     * distribution algorithm's "absence resolves to guard-eligible" behavior
     * (Requirements 4.2, 4.4).
     *
     * The V3 distribution algorithm (`js/algorithms/proctor-v3.bundle.js`)
     * decides eligibility per (proctor, session) with three hard-constraint
     * predicates over the NORMALIZED store:
     *   - `isExempt(proctor, idx, sessionKey, exemptionsData)`  → true iff the
     *      proctor's canonical key is *present* under `exemptionsData[sessionKey]`
     *      (presence encodes the exemption, regardless of stored value).
     *   - `isOnDuty(proctor, idx, halfdayKey, dutyData)`        → true iff the
     *      proctor's canonical key is *present* under `dutyData[halfdayKey]`.
     *   - (reserve occupancy is tracked separately via `reserveSessions`.)
     * A proctor with NO matching entry in any of these maps is treated as
     * guard-eligible for that session — exactly the case where `resolveCellStatus`
     * returns guard. We therefore express guard-eligibility in store terms by
     * delegating to `resolveCellStatus`, which itself encodes the same
     * reserve/duty/exempt precedence and treats any missing or unrecognized
     * entry as guard (Requirement 4.1, 4.3). This keeps the matrix display, the
     * Save reduction, and this verification predicate reading the store the same
     * way the algorithm does.
     *
     * @param {{exemptionsData?:object, dutyData?:object, reservesData?:object}} store
     * @param {string} proctorKey — canonical key from getProctorExemptionKey.
     * @param {object} sessionColumn — a SessionColumn from buildSessionColumns.
     * @returns {boolean} true iff the proctor/session resolves to guard (i.e. the
     *   store has no exempt/duty/reserve entry for it), meaning the proctor is
     *   guard-eligible for the distribution.
     */
    function isGuardEligible(store, proctorKey, sessionColumn) {
        return resolveCellStatus(store, proctorKey, sessionColumn) === STATUS.GUARD;
    }

    /**
     * @typedef {Object} GuardAssignment
     * @property {string} proctorKey — canonical key (getProctorExemptionKey) of
     *   the proctor the distribution placed on a generated guard duty.
     * @property {object} sessionColumn — the SessionColumn (from
     *   buildSessionColumns) the guard duty is for. Carrying the column object
     *   directly (rather than a bare key) lets this predicate resolve the cell's
     *   status against the store without a separate lookup table.
     */

    /**
     * @typedef {Object} AssignmentResult
     * The result of one distribution run, in the shape this verification layer
     * inspects. It is a thin, store-oriented projection of what the real V3
     * algorithm produces (its Result_Rows carry `session_key` +
     * `proctor_keys`/`reserve_keys`/`duty_teachers`; the distribution properties
     * 9.3/9.4 translate those rows into the fields below using the run's
     * SessionColumns). Construct it directly in unit tests, or build it from a
     * real `proctor-v3.bundle.js` run for the property tests.
     *
     * @property {Array<object>} sessions — the SessionColumns the run covered.
     *   Used to enumerate every (proctor, session) cell when checking that no
     *   user-selected status changed.
     * @property {Array<string>} proctorKeys — the canonical keys of every proctor
     *   in the run (the universe of rows to check for status preservation).
     * @property {{exemptionsData?:object, dutyData?:object, reservesData?:object}} storeAfter
     *   — the exempt/duty/reserve store as it stands AFTER the run. The
     *   distribution must not flip or remove any user-selected status, so for
     *   every non-guard cell this must resolve to the same status as
     *   `storeBefore` (Requirements 7.1, 7.2, 7.4).
     * @property {Array<GuardAssignment>} guardAssignments — every generated guard
     *   duty produced by the run. Each must target a cell whose PRE-run status
     *   was guard (Requirements 7.3, and the "skip" half of 7.2).
     */

    /**
     * Verify that a distribution run honored the user's manual choices
     * (Requirements 7.1, 7.2, 7.3, 7.4). Pure: reads only its arguments.
     *
     * Returns true iff BOTH hold:
     *
     *   (a) Status preservation — for every proctor in `result.proctorKeys` and
     *       every session in `result.sessions`, if the cell's status in
     *       `storeBefore` is exempt/duty/reserve (a user-selected status), then
     *       the same cell resolves to the IDENTICAL status in `result.storeAfter`.
     *       Nothing user-selected may be flipped to another status or removed
     *       (Requirements 7.1, 7.4). Because a skipped guard assignment leaves
     *       the cell untouched, this also covers the "leave unchanged" half of
     *       Requirement 7.2. Guard cells are unconstrained here — the algorithm
     *       is free to assign guards to them.
     *
     *   (b) Guard targeting — every generated guard duty in
     *       `result.guardAssignments` targets a (proctor, session) whose PRE-run
     *       status (resolved from `storeBefore`) is guard. No generated guard may
     *       land on an exempt/duty/reserve cell (Requirements 7.3, and the "skip
     *       the assignment" half of 7.2).
     *
     * A null/missing `result` (or its absent fields default to empty) yields
     * true vacuously: no choices to violate. `storeBefore` is never mutated.
     *
     * @param {{exemptionsData?:object, dutyData?:object, reservesData?:object}} storeBefore
     *   — the Exemptions_Duty_Store as recorded before the run.
     * @param {AssignmentResult} assignmentResult — the run's result projection.
     * @returns {boolean} true iff the run preserved every user choice and only
     *   placed generated guards on guard-status cells.
     */
    function honorsUserChoices(storeBefore, assignmentResult) {
        var result = assignmentResult || {};
        var sessions = Array.isArray(result.sessions) ? result.sessions : [];
        var proctorKeys = Array.isArray(result.proctorKeys) ? result.proctorKeys : [];
        var storeAfter = result.storeAfter || {};
        var guardAssignments = Array.isArray(result.guardAssignments) ? result.guardAssignments : [];

        // (a) Every user-selected (non-guard) status is identical after the run.
        for (var p = 0; p < proctorKeys.length; p++) {
            var proctorKey = proctorKeys[p];
            if (!proctorKey) {
                continue;
            }
            for (var s = 0; s < sessions.length; s++) {
                var sessionColumn = sessions[s];
                if (!sessionColumn) {
                    continue;
                }
                var before = resolveCellStatus(storeBefore, proctorKey, sessionColumn);
                if (before === STATUS.GUARD) {
                    continue; // guard cells may freely receive generated guards.
                }
                var after = resolveCellStatus(storeAfter, proctorKey, sessionColumn);
                if (after !== before) {
                    return false; // a user-selected status was flipped or removed.
                }
            }
        }

        // (b) Every generated guard duty targets a pre-run guard cell.
        for (var g = 0; g < guardAssignments.length; g++) {
            var ga = guardAssignments[g];
            if (!ga) {
                continue;
            }
            if (!isGuardEligible(storeBefore, ga.proctorKey, ga.sessionColumn)) {
                return false; // generated guard landed on an exempt/duty/reserve cell.
            }
        }

        return true;
    }

    // -----------------------------------------------------------------------
    // Public surface
    // -----------------------------------------------------------------------

    var api = {
        // Status constants
        STATUS: STATUS,
        STATUS_CODE: STATUS_CODE,
        STATUS_COLOR: STATUS_COLOR,
        PERSISTED_STATUSES: PERSISTED_STATUSES,
        // Key derivation
        getProctorExemptionKey: getProctorExemptionKey,
        getScheduleDateKey: getScheduleDateKey,
        getScheduleSortKey: getScheduleSortKey,
        getScheduleSessionKey: getScheduleSessionKey,
        getLegacyScheduleSessionKey: getLegacyScheduleSessionKey,
        getScheduleExemptKey: getScheduleExemptKey,
        // Session column + date-group construction (Task 2.1)
        formatDateLabel: formatDateLabel,
        buildSessionColumns: buildSessionColumns,
        buildDateGroups: buildDateGroups,
        // Status resolution (Task 3.1)
        resolveCellStatus: resolveCellStatus,
        // Proctor row + matrix model construction (Task 4.1)
        buildProctorRows: buildProctorRows,
        buildMatrixModel: buildMatrixModel,
        // Row summary computation (Task 5.1)
        computeRowSummary: computeRowSummary,
        // Store reduction for Save (Task 6.1)
        reduceMatrixToStore: reduceMatrixToStore,
        // Search / filter / sort (Task 8.1)
        SORTABLE_COLUMNS: SORTABLE_COLUMNS,
        nextSortState: nextSortState,
        applySearchFilterSort: applySearchFilterSort,
        // Distribution constraint adapter (Task 9.1)
        isGuardEligible: isGuardEligible,
        honorsUserChoices: honorsUserChoices
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.GS2 = window.GS2 || {};
        window.GS2.EdMatrixLogic = api;
        // Convenience direct global for the renderer (vanilla-script convention).
        window.EdMatrixLogic = api;
    }
})();
