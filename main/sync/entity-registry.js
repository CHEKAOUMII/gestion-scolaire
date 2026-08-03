'use strict';

/**
 * Canonical sync entity metadata (WP2).
 * Capability flags preserve distinct scopes:
 *   - local.snapshot: included in periodic local snapshot drift checks
 *   - remote: Firestore collection / document identity
 *   - authority.writers: roles allowed to push
 *   - remoteOnly: no local snapshot / no capture tables required
 *
 * D1 student remote identity is year-scoped for writers (`school_year` + `code`).
 * Pull accepts legacy code-only document IDs until operator retirement.
 */

const ALL_WRITERS = [
    'admin',
    'principal',
    'supervisor',
    'teacher',
    'staff',
    'external-guardian',
    'internal-guardian',
    'admin-assistant',
    'educational-specialist',
    'social-specialist'
];

/** @type {Record<string, object>} */
const ENTITY_REGISTRY = {
    students: {
        entityType: 'student',
        local: {
            table: 'students',
            keyFields: ['school_year', 'code'],
            localIdField: 'id',
            snapshot: true,
            // Cycle-carrying, not cycle-keyed: a student is identified by school_year+code
            // whichever cycle they study in, so identity is unchanged. Requiring the column
            // makes a device that has not run migration 071 quarantine these rows instead
            // of writing them with no cycle at all.
            contractVersion: 2,
            requiredColumns: ['cycle_code'],
            readScoped: true
        },
        remote: {
            collection: 'students',
            // D1: writers use year-scoped document IDs. Pull still accepts legacy
            // code-only docs (legacyIdFields) until operator-controlled retirement.
            idFields: ['school_year', 'code'],
            legacyIdFields: ['code'],
            canonicalIdFields: ['school_year', 'code']
        },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    grades: {
        entityType: 'grade',
        local: {
            table: 'grades',
            keyFields: ['school_year', 'student_code', 'subject', 'semester'],
            localIdField: 'id',
            snapshot: true,
            // Cycle-carrying: grade identity is already anchored by the student code.
            contractVersion: 2,
            requiredColumns: ['cycle_code'],
            readScoped: true
        },
        remote: {
            collection: 'grades',
            idFields: ['student_code', 'subject', 'semester', 'school_year']
        },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    absences: {
        entityType: 'absence',
        local: {
            table: 'absences',
            keyFields: ['school_year', 'student_code', 'month', 'absence_type'],
            localIdField: 'id',
            snapshot: true,
            // Cycle-carrying: absence identity is already anchored by the student code.
            contractVersion: 2,
            requiredColumns: ['cycle_code'],
            readScoped: true
        },
        remote: {
            collection: 'absences',
            idFields: ['student_code', 'month', 'school_year', 'absence_type']
        },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    teachers: {
        entityType: 'teacher',
        local: { table: 'teachers', keyFields: ['id'], localIdField: 'id', snapshot: true },
        remote: { collection: 'teachers', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    teacher_aliases: {
        entityType: 'teacher_alias',
        local: { table: 'teacher_aliases', keyFields: ['id'], localIdField: 'id', snapshot: true },
        remote: { collection: 'teacherAliases', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    teacher_teaching_assignments: {
        entityType: 'teacher_teaching_assignment',
        local: {
            table: 'teacher_teaching_assignments',
            keyFields: ['teacher_id', 'school_year', 'cycle_code', 'level_code', 'section', 'subject_code'],
            localIdField: 'id',
            snapshot: true,
            cycleKeyed: true,
            contractVersion: 2,
            requiredColumns: ['cycle_code'],
            readScoped: true
        },
        remote: {
            collection: 'teacherTeachingAssignments',
            idFields: ['teacher_id', 'school_year', 'cycle_code', 'level_code', 'section', 'subject_code']
        },
        authority: { writers: ['admin', 'principal'] },
        applyHooks: {}
    },
    staff_attendance: {
        entityType: 'staff_attendance',
        local: {
            table: 'staff_attendance',
            keyFields: ['teacher_id', 'date'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'staffAttendance', idFields: ['teacher_id', 'date'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    teacher_absences: {
        entityType: 'teacher_absence',
        local: {
            table: 'teacher_absences',
            keyFields: ['teacher_id', 'date'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'teacherAbsences', idFields: ['teacher_id', 'date'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    // Cycle-specific reference data: the same level code may exist in more than one cycle.
    education_levels: {
        entityType: 'education_level',
        local: {
            table: 'education_levels',
            keyFields: ['cycle_code', 'level_code'],
            localIdField: 'id',
            snapshot: true,
            cycleKeyed: true,
            contractVersion: 2,
            requiredColumns: ['cycle_code']
        },
        remote: { collection: 'educationLevels', idFields: ['cycle_code', 'level_code'] },
        authority: { writers: ['admin', 'principal'] },
        applyHooks: {}
    },
    level_aliases: {
        entityType: 'level_alias',
        local: {
            table: 'level_aliases',
            keyFields: ['cycle_code', 'normalized_alias'],
            localIdField: 'id',
            snapshot: true,
            cycleKeyed: true,
            contractVersion: 2,
            requiredColumns: ['cycle_code']
        },
        remote: { collection: 'levelAliases', idFields: ['cycle_code', 'normalized_alias'] },
        authority: { writers: ['admin', 'principal'] },
        applyHooks: {}
    },
    education_subjects: {
        entityType: 'education_subject',
        local: {
            table: 'education_subjects',
            keyFields: ['subject_code'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'educationSubjects', idFields: ['subject_code'] },
        authority: { writers: ['admin', 'principal'] },
        applyHooks: {}
    },
    subject_aliases: {
        entityType: 'subject_alias',
        local: {
            table: 'subject_aliases',
            keyFields: ['normalized_alias'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'subjectAliases', idFields: ['normalized_alias'] },
        authority: { writers: ['admin', 'principal'] },
        applyHooks: {}
    },
    sections: {
        entityType: 'section',
        local: {
            table: 'sections',
            keyFields: ['school_year', 'cycle_code', 'section_code'],
            localIdField: 'id',
            snapshot: true,
            cycleKeyed: true,
            contractVersion: 2,
            requiredColumns: ['cycle_code']
        },
        remote: {
            collection: 'sections',
            idFields: ['school_year', 'cycle_code', 'section_code']
        },
        authority: { writers: ['admin', 'principal'] },
        applyHooks: {}
    },
    exams: {
        entityType: 'exam',
        local: {
            table: 'exams',
            keyFields: ['id'],
            localIdField: 'id',
            snapshot: true,
            // Cycle-carrying: the generated id remains the exam identity.
            contractVersion: 2,
            requiredColumns: ['cycle_code']
        },
        remote: { collection: 'exams', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    exam_proctors: {
        entityType: 'exam_proctor',
        local: {
            table: 'exam_proctors',
            keyFields: ['exam_id', 'teacher_id'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'examProctors', idFields: ['exam_id', 'teacher_id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    exam_rooms: {
        entityType: 'exam_room',
        local: {
            table: 'exam_rooms',
            keyFields: ['exam_id', 'room_id'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'examRooms', idFields: ['exam_id', 'room_id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    // Local snapshot/capture entities (remote collection names reserved for future sync).
    exam_attendance: {
        entityType: 'exam_attendance',
        local: {
            table: 'exam_attendance',
            keyFields: ['id'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'examAttendance', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    exam_invitations: {
        entityType: 'exam_invitation',
        local: {
            table: 'exam_invitations',
            keyFields: ['id'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'examInvitations', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    tests: {
        entityType: 'test',
        local: {
            table: 'tests',
            keyFields: ['id'],
            localIdField: 'id',
            snapshot: true,
            // Cycle-carrying: the generated id remains the test identity.
            contractVersion: 2,
            requiredColumns: ['cycle_code']
        },
        remote: { collection: 'tests', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    correspondence: {
        entityType: 'correspondence',
        local: {
            table: 'correspondence',
            keyFields: ['id'],
            localIdField: 'id',
            snapshot: true,
            // Cycle-carrying student child: row id remains the event identity.
            contractVersion: 2,
            requiredColumns: ['cycle_code'],
            readScoped: true
        },
        remote: { collection: 'correspondence', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    student_files: {
        entityType: 'student_file',
        local: {
            table: 'student_files',
            // Local unique key uses student_id (remote id still uses student_code).
            keyFields: ['student_id', 'doc_key', 'school_year'],
            localIdField: 'id',
            snapshot: true,
            // Cycle-carrying: student_id + document identity stays stable.
            contractVersion: 2,
            requiredColumns: ['cycle_code'],
            readScoped: true
        },
        remote: {
            collection: 'studentFiles',
            idFields: ['student_code', 'doc_key', 'school_year']
        },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    student_movements: {
        entityType: 'student_movement',
        local: {
            table: 'student_movements',
            keyFields: ['id'],
            localIdField: 'id',
            snapshot: true,
            // Cycle-carrying history row: row id remains the movement identity.
            contractVersion: 2,
            requiredColumns: ['cycle_code'],
            readScoped: true
        },
        remote: { collection: 'studentMovements', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    student_profile_data: {
        entityType: 'student_profile_data',
        local: {
            table: 'student_profile_data',
            // The profile table is unique by student, tab, and school year; cycle is
            // carrying metadata and must not split an existing logical profile row.
            keyFields: ['student_code', 'tab_key', 'school_year'],
            localIdField: 'id',
            snapshot: true,
            contractVersion: 2,
            requiredColumns: ['cycle_code'],
            readScoped: true
        },
        remote: {
            collection: 'studentProfileData',
            idFields: ['student_code', 'tab_key', 'school_year']
        },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    support_sessions: {
        entityType: 'support_session',
        local: {
            table: 'support_sessions',
            keyFields: ['id'],
            localIdField: 'id',
            snapshot: true,
            contractVersion: 2,
            requiredColumns: ['cycle_code'],
            readScoped: true
        },
        remote: { collection: 'supportSessions', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    student_orientation: {
        entityType: 'student_orientation',
        local: {
            table: 'student_orientation',
            keyFields: ['school_year', 'student_code'],
            localIdField: 'id',
            snapshot: true,
            // Cycle-carrying: the orientation row keeps a cycle_code snapshot, but its
            // identity stays school_year + student_code (a student is the same person
            // whichever cycle they study in). Requiring the column makes a device that
            // has not run the cycle-code migration quarantine these rows instead of
            // writing them with no cycle at all.
            contractVersion: 2,
            requiredColumns: ['cycle_code']
        },
        remote: {
            collection: 'studentOrientation',
            idFields: ['school_year', 'student_code']
        },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    compensation_tracking: {
        entityType: 'compensation',
        local: {
            table: 'compensation_tracking',
            keyFields: ['id'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'compensation', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    institution_cycles: {
        entityType: 'institution_cycle',
        local: {
            table: 'institution_cycles',
            keyFields: ['cycle_code'],
            localIdField: 'id',
            snapshot: true,
            // §9.2: a device that has not run the institution-cycles migration must refuse
            // these rows rather than write them without their cycle identity.
            contractVersion: 2,
            requiredColumns: ['cycle_code'],
            readScoped: true
        },
        remote: { collection: 'institutionCycles', idFields: ['cycle_code'] },
        authority: { writers: ['admin', 'principal'] },
        applyHooks: {}
    },
    settings: {
        entityType: 'settings',
        local: { table: 'settings', keyFields: ['key'], localIdField: 'id', snapshot: true },
        remote: { collection: 'settings', idFields: ['key'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    page_visibility: {
        entityType: 'page_visibility',
        local: {
            table: 'page_visibility',
            keyFields: ['page_key'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'pageVisibility', idFields: ['page_key'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    stage_rule_sets: {
        entityType: 'stage_rule_set',
        local: {
            table: 'stage_rule_sets',
            keyFields: ['school_year', 'revision'],
            localIdField: 'id',
            snapshot: false,
            contractVersion: 2,
            requiredColumns: ['status', 'reason']
        },
        remote: { collection: 'stageRuleSets', idFields: ['school_year', 'revision'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    subject_coefficients: {
        entityType: 'subject_coefficient',
        local: {
            table: 'subject_coefficients',
            keyFields: ['rule_set_id', 'cycle_code', 'level_code', 'stream_code', 'subject_code', 'source'],
            localIdField: 'id',
            snapshot: false,
            contractVersion: 2,
            requiredColumns: ['rule_set_id', 'cycle_code', 'subject_code', 'source']
        },
        remote: {
            collection: 'subjectCoefficients',
            idFields: ['rule_set_id', 'cycle_code', 'level_code', 'stream_code', 'subject_code', 'source']
        },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    exam_count_rules: {
        entityType: 'exam_count_rule',
        local: {
            table: 'exam_count_rules',
            keyFields: ['rule_set_id', 'cycle_code', 'level_code', 'subject_code', 'source'],
            localIdField: 'id',
            snapshot: false,
            contractVersion: 2,
            requiredColumns: ['rule_set_id', 'cycle_code', 'subject_code', 'source']
        },
        remote: {
            collection: 'examCountRules',
            idFields: ['rule_set_id', 'cycle_code', 'level_code', 'subject_code', 'source']
        },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    subject_weight_rules: {
        entityType: 'subject_weight_rule',
        local: {
            table: 'subject_weight_rules',
            keyFields: ['rule_set_id', 'cycle_code', 'subject_code', 'source'],
            localIdField: 'id',
            snapshot: false,
            contractVersion: 2,
            requiredColumns: ['rule_set_id', 'cycle_code', 'subject_code', 'source']
        },
        remote: {
            collection: 'subjectWeightRules',
            idFields: ['rule_set_id', 'cycle_code', 'subject_code', 'source']
        },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    // S4 stage profiles (docs/plans/2026-08-02-multi-stage-school-architecture.md rows 105-115).
    // Official immutable rows; the EFFECTIVE profile per school year is decided by
    // cycle_profile_assignments — never by CYCLE_CATALOG.profileVersion. Both tables
    // declare minAppVersion: the field is owned by the sync/registry, compared with
    // semantic-version semantics against the local app version, and a device older
    // than the minimum quarantines the row before apply instead of writing a shape
    // it cannot interpret (plan row 112).
    cycle_profiles: {
        entityType: 'cycle_profile',
        local: {
            table: 'cycle_profiles',
            keyFields: ['cycle_code', 'profile_version'],
            localIdField: 'id',
            snapshot: false,
            contractVersion: 2,
            requiredColumns: ['cycle_code', 'profile_version'],
            minAppVersion: '1.0.42'
        },
        remote: { collection: 'cycleProfiles', idFields: ['cycle_code', 'profile_version'] },
        authority: { writers: ['admin', 'principal'] },
        applyHooks: {}
    },
    cycle_profile_assignments: {
        entityType: 'cycle_profile_assignment',
        local: {
            table: 'cycle_profile_assignments',
            keyFields: ['school_year', 'cycle_code'],
            localIdField: 'id',
            snapshot: false,
            contractVersion: 2,
            requiredColumns: ['school_year', 'cycle_code', 'profile_version'],
            minAppVersion: '1.0.42'
        },
        remote: { collection: 'cycleProfileAssignments', idFields: ['school_year', 'cycle_code'] },
        authority: { writers: ['admin', 'principal'] },
        applyHooks: {}
    },
    page_role_access: {
        entityType: 'page_role_access',
        local: {
            table: 'page_role_access',
            keyFields: ['page_key', 'role'],
            localIdField: 'id',
            snapshot: true
        },
        remote: { collection: 'pageRoleAccess', idFields: ['page_key', 'role'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    system_tags: {
        entityType: 'system_tag',
        local: { table: 'system_tags', keyFields: ['id'], localIdField: 'id', snapshot: true },
        remote: { collection: 'systemTags', idFields: ['id'] },
        authority: { writers: ALL_WRITERS },
        applyHooks: {}
    },
    // Remote-only: not snapshotted locally, not in write-capture authority set.
    device_revocation: {
        entityType: 'device_revocation',
        local: { table: null, keyFields: [], localIdField: null, snapshot: false },
        remote: {
            collection: 'deviceRevocations',
            idFields: ['revokedDeviceHash']
        },
        authority: { writers: [] },
        remoteOnly: true,
        applyHooks: {}
    }
};

// Contract-required columns also cover entities whose schema/IPC migration is planned but
// not yet complete. Keep read enforcement limited to entities with cycle-aware reads today.
const CYCLE_SCOPED_TABLES = Object.freeze(
    Object.values(ENTITY_REGISTRY)
        .filter(
            (entity) =>
                entity.local?.readScoped === true && entity.local?.requiredColumns?.includes('cycle_code')
        )
        .map((entity) => entity.local.table)
);

function getEntity(tableName) {
    return ENTITY_REGISTRY[tableName] || null;
}

function isKnownSyncTable(tableName) {
    const entity = getEntity(tableName);
    return !!(entity && !entity.remoteOnly && entity.local?.table);
}

function getLocalKeyFields(tableName) {
    return getEntity(tableName)?.local?.keyFields || null;
}

function getLocalIdField(tableName) {
    return getEntity(tableName)?.local?.localIdField || 'id';
}

function getRemoteIdFields(tableName) {
    const fields = getEntity(tableName)?.remote?.idFields;
    return Array.isArray(fields) ? fields.slice() : null;
}

function getLegacyIdFields(tableName) {
    const fields = getEntity(tableName)?.remote?.legacyIdFields;
    return Array.isArray(fields) && fields.length ? fields.slice() : null;
}

function getCanonicalIdFields(tableName) {
    const entity = getEntity(tableName);
    if (!entity?.remote) return null;
    if (Array.isArray(entity.remote.canonicalIdFields) && entity.remote.canonicalIdFields.length) {
        return entity.remote.canonicalIdFields.slice();
    }
    return getRemoteIdFields(tableName);
}

/**
 * Resolve a local PK by declared logical key fields (pull dedup / mixed remote IDs).
 * @returns {*|null} local id field value
 */
function findLocalIdByLogicalKeys(db, tableName, data) {
    if (!db || !tableName || !data || typeof data !== 'object') return null;
    const keys = getLocalKeyFields(tableName);
    if (!keys || !keys.length) return null;

    const clauses = [];
    const values = [];
    for (const field of keys) {
        const value = data[field];
        if (value === undefined || value === null || String(value).trim() === '') {
            return null;
        }
        clauses.push(`"${field}" = ?`);
        values.push(value);
    }

    const idField = getLocalIdField(tableName);
    try {
        const row = db
            .prepare(`SELECT "${idField}" AS id FROM "${tableName}" WHERE ${clauses.join(' AND ')} LIMIT 1`)
            .get(...values);
        return row?.id != null ? row.id : null;
    } catch {
        return null;
    }
}

function resolveLocalId(tableName, row) {
    if (!row || typeof row !== 'object') return null;
    const field = getLocalIdField(tableName);
    if (field && row[field] != null && String(row[field]).trim() !== '') {
        return row[field];
    }
    // Fallback for key-only tables without numeric id in edge fixtures
    const keys = getLocalKeyFields(tableName) || [];
    if (keys.length === 1 && row[keys[0]] != null) return row[keys[0]];
    return null;
}

function getSnapshotTables() {
    return Object.keys(ENTITY_REGISTRY).filter((name) => {
        const e = ENTITY_REGISTRY[name];
        return e?.local?.snapshot && e.local.table;
    });
}

function getEntityType(tableName) {
    return getEntity(tableName)?.entityType || null;
}

function getWriters(tableName) {
    return getEntity(tableName)?.authority?.writers || [];
}

function canPush(tableName, role) {
    return getWriters(tableName).includes(role);
}

function getAuthorizedTables(role) {
    return Object.keys(ENTITY_REGISTRY).filter((t) => canPush(t, role));
}

function getApplyHooks(tableName) {
    return getEntity(tableName)?.applyHooks || {};
}

/**
 * Columns a pulled row cannot be applied without (multi-cycle plan §9.2).
 *
 * Devices in one institution are not upgraded at the same moment. Without this,
 * a device on an older schema silently drops columns it does not know
 * (filterToValidColumns) and writes a stripped row — e.g. a cycle-scoped record
 * landing unscoped and mixing into another cycle's lists. Declaring the column
 * here turns that silent acceptance into a recorded apply failure instead.
 *
 * Entities that declare nothing behave exactly as before.
 */
function getRequiredColumns(tableName) {
    const required = getEntity(tableName)?.local?.requiredColumns;
    return Array.isArray(required) ? required : [];
}

/** Contract version of an entity's local shape — bumped when requiredColumns change. */
function getContractVersion(tableName) {
    return Number(getEntity(tableName)?.local?.contractVersion || 1);
}

/**
 * S4 sync version gate — the minAppVersion field is owned by the sync/registry
 * (docs/plans/2026-08-02-multi-stage-school-architecture.md row 112).
 * `getMinAppVersion(tableName)` returns the entity's declared minimum; the
 * comparison is semantic-version and the LOCAL app version comes from the
 * electron app when available (overridable for tests). An older device must
 * quarantine the row before apply — it cannot interpret the shape correctly.
 */

let _localAppVersionOverride = null;

/** Test seam: inject the local app version without an electron runtime. */
function setLocalAppVersionForTests(version) {
    _localAppVersionOverride = version == null ? null : String(version).trim();
}

function getMinAppVersion(tableName) {
    return getEntity(tableName)?.local?.minAppVersion || null;
}

function getLocalAppVersion() {
    if (_localAppVersionOverride != null) return _localAppVersionOverride;
    try {
        const { app } = require('electron');
        const version = app && typeof app.getVersion === 'function' ? app.getVersion() : null;
        return version && String(version).trim() !== '' ? String(version).trim() : null;
    } catch {
        // No electron runtime (pure-node tests / tooling): the gate is skipped.
        return null;
    }
}

/**
 * Pure semantic-version comparison owned by the sync/registry.
 * Returns -1 | 0 | 1 when both sides parse, null when either side is unparseable.
 */
function compareSemanticVersions(a, b) {
    const parse = (raw) => {
        const normalized = String(raw || '')
            .trim()
            .replace(/^v/i, '');
        if (!normalized) return null;
        const nums = normalized.split('.').map((part) => {
            const stripped = part.replace(/[^0-9].*$/, '');
            if (!stripped) return null;
            const num = Number(stripped);
            return Number.isFinite(num) ? num : null;
        });
        if (nums.some((num) => num === null)) return null;
        return nums;
    };
    const pa = parse(a);
    const pb = parse(b);
    if (!pa || !pb) return null;
    const length = Math.max(pa.length, pb.length);
    for (let i = 0; i < length; i++) {
        const left = pa[i] ?? 0;
        const right = pb[i] ?? 0;
        if (left !== right) return left < right ? -1 : 1;
    }
    return 0;
}

/**
 * Quarantine gate evaluated by the sync engine BEFORE any write of an entity that
 * declares minAppVersion: `{ allowed: true }`, or `{ allowed: false, reason }`.
 */
function checkAppVersionGate(tableName) {
    const minAppVersion = getMinAppVersion(tableName);
    if (!minAppVersion) return { allowed: true };
    const localVersion = getLocalAppVersion();
    if (!localVersion) return { allowed: true };
    const comparison = compareSemanticVersions(localVersion, minAppVersion);
    if (comparison === null) {
        return {
            allowed: false,
            minAppVersion,
            reason: `app version ${localVersion} cannot be compared against minAppVersion ${minAppVersion}`
        };
    }
    if (comparison < 0) {
        return {
            allowed: false,
            minAppVersion,
            reason: `app version ${localVersion} is older than minAppVersion ${minAppVersion}`
        };
    }
    return { allowed: true };
}

/**
 * Entities whose education cycle participates in row identity.
 *
 * Two distinct kinds of entity carry a cycle, and conflating them corrupts data in
 * opposite directions:
 *
 *   cycle-carrying — the row has a cycle, but its logical key is already unique
 *                    institution-wide (a student is identified by school_year + code
 *                    whichever cycle they study in). Declares `requiredColumns` only.
 *                    Adding cycle_code to its key would break identity with documents
 *                    already written under the old key.
 *
 *   cycle-keyed    — the logical key can repeat across cycles (a section named "1A"
 *                    may exist in both), so cycle_code must take part in the merge key
 *                    or two different rows fuse into one. Declares `cycleKeyed: true`.
 */
function isCycleKeyed(tableName) {
    return getEntity(tableName)?.local?.cycleKeyed === true;
}

function setApplyHooks(tableName, hooks) {
    const entity = getEntity(tableName);
    if (!entity) {
        throw new Error(`Unknown entity for apply hooks: ${tableName}`);
    }
    entity.applyHooks = { ...entity.applyHooks, ...hooks };
}

/** Compatibility: shape used by main/firebase/collections.js */
function buildCollectionMap() {
    const map = {};
    for (const [tableName, entity] of Object.entries(ENTITY_REGISTRY)) {
        if (!entity.remote?.collection) continue;
        const idFields = entity.remote.idFields.slice();
        map[tableName] = {
            collection: entity.remote.collection,
            idFields,
            legacyIdFields: Array.isArray(entity.remote.legacyIdFields)
                ? entity.remote.legacyIdFields.slice()
                : null,
            canonicalIdFields: Array.isArray(entity.remote.canonicalIdFields)
                ? entity.remote.canonicalIdFields.slice()
                : idFields.slice()
        };
    }
    return map;
}

/** Compatibility: WRITER_AUTHORITY map */
function buildWriterAuthority() {
    const map = {};
    for (const [tableName, entity] of Object.entries(ENTITY_REGISTRY)) {
        if (entity.remoteOnly) continue;
        if (!entity.local?.table) continue;
        map[tableName] = (entity.authority?.writers || []).slice();
    }
    return map;
}

/** Compatibility: ENTITY_TYPE_REGISTRY map */
function buildEntityTypeRegistry() {
    const map = {};
    for (const [tableName, entity] of Object.entries(ENTITY_REGISTRY)) {
        if (entity.remoteOnly) continue;
        if (!entity.local?.table) continue;
        map[tableName] = { entityType: entity.entityType };
    }
    return map;
}

function validateEntityRegistry() {
    const errors = [];
    for (const [name, entity] of Object.entries(ENTITY_REGISTRY)) {
        if (!entity.entityType) errors.push(`${name}: missing entityType`);
        if (!entity.remoteOnly) {
            if (!entity.local?.table) errors.push(`${name}: missing local.table`);
            if (!Array.isArray(entity.local?.keyFields) || !entity.local.keyFields.length) {
                errors.push(`${name}: missing local.keyFields`);
            }
        }
        if (!entity.remote?.collection) errors.push(`${name}: missing remote.collection`);
        if (!Array.isArray(entity.remote?.idFields) || !entity.remote.idFields.length) {
            errors.push(`${name}: missing remote.idFields`);
        }
        // §9.2: a cycle-keyed entity whose merge keys ignore cycle_code can fuse two
        // different cycles' rows that share a logical key (e.g. a section name reused
        // across cycles) into a single record. Cycle-carrying entities keep their key.
        if (entity.local?.cycleKeyed) {
            if (!entity.local.keyFields?.includes('cycle_code')) {
                errors.push(`${name}: cycleKeyed entity must include cycle_code in local.keyFields`);
            }
            if (!entity.local.requiredColumns?.includes('cycle_code')) {
                errors.push(`${name}: cycleKeyed entity must require cycle_code`);
            }
            if (!entity.remote?.idFields?.includes('cycle_code')) {
                errors.push(`${name}: cycleKeyed entity must include cycle_code in remote.idFields`);
            }
        }
        const required = entity.local?.requiredColumns;
        if (required !== undefined && !Array.isArray(required)) {
            errors.push(`${name}: local.requiredColumns must be an array`);
        }
        if (Array.isArray(required) && required.length && !(Number(entity.local?.contractVersion) > 1)) {
            errors.push(`${name}: declaring requiredColumns needs local.contractVersion > 1`);
        }
    }
    return errors;
}

module.exports = {
    ALL_WRITERS,
    ENTITY_REGISTRY,
    CYCLE_SCOPED_TABLES,
    getEntity,
    isKnownSyncTable,
    getLocalKeyFields,
    getLocalIdField,
    getRemoteIdFields,
    getLegacyIdFields,
    getCanonicalIdFields,
    findLocalIdByLogicalKeys,
    resolveLocalId,
    getSnapshotTables,
    getEntityType,
    getWriters,
    canPush,
    getAuthorizedTables,
    getApplyHooks,
    setApplyHooks,
    getRequiredColumns,
    getContractVersion,
    getMinAppVersion,
    getLocalAppVersion,
    setLocalAppVersionForTests,
    compareSemanticVersions,
    checkAppVersionGate,
    isCycleKeyed,
    buildCollectionMap,
    buildWriterAuthority,
    buildEntityTypeRegistry,
    validateEntityRegistry
};
