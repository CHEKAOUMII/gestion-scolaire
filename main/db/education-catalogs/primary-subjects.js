'use strict';

/**
 * Primary-cycle subject catalog (docs/plans/2026-08-01-primary-stage-catalogs.md, S2).
 *
 * Subjects are an institution-wide shared catalog: education_subjects.subject_code
 * is a global PK and subject_aliases.normalized_alias is globally unique
 * (schema.js, review decision 1). Primary seeding is therefore a UNION of
 * INSERT OR IGNORE for missing codes only — shared subjects (العربية، الرياضيات،
 * التربية الإسلامية، الفرنسية) reuse their existing codes, and alias collisions
 * resolve first-wins via the global unique constraint (e.g. 'الاجتماعيات' keeps
 * pointing at HISTORY_GEOGRAPHY for the qualifiant legacy import; SOCIAL_STUDIES
 * still gets its own catalog row for the stage-profile binding).
 */

const { normalizeAliasKey } = require('./subject-catalog');

const PRIMARY_SUBJECTS = {
    'ARABIC': {
        labelAr: 'اللغة العربية',
        labelFr: 'Langue arabe',
        sortOrder: 0
    },
    'MATH': {
        labelAr: 'الرياضيات',
        labelFr: 'Mathématiques',
        sortOrder: 1
    },
    'SCIENCE_ACTIVITY': {
        labelAr: 'النشاط العلمي',
        labelFr: 'Activités scientifiques',
        sortOrder: 2
    },
    'SOCIAL_STUDIES': {
        labelAr: 'الاجتماعيات',
        labelFr: 'Sciences sociales',
        sortOrder: 3
    },
    'ISLAMIC_EDUCATION': {
        labelAr: 'التربية الإسلامية',
        labelFr: 'Éducation islamique',
        sortOrder: 4
    },
    'FRENCH': {
        labelAr: 'اللغة الفرنسية',
        labelFr: 'Langue française',
        sortOrder: 5
    },
    'ARTS_EDUCATION': {
        labelAr: 'التربية الفنية',
        labelFr: 'Éducation artistique',
        sortOrder: 6
    },
    'PHYSICAL_MOTOR_EDUCATION': {
        labelAr: 'التربية البدنية والحركية',
        labelFr: 'Éducation physique et motrice',
        sortOrder: 7
    }
};

/** Extra import aliases for the primary-only codes (labels map themselves). */
const EXTRA_PRIMARY_ALIASES = {
    'النشاط العلمي والاجتماعيات': 'SCIENCE_ACTIVITY',
    'البدنية': 'PHYSICAL_MOTOR_EDUCATION'
};

function _buildAliases() {
    const map = Object.create(null);
    const add = (raw, code) => {
        const key = normalizeAliasKey(raw);
        if (!key || !code || map[key]) return;
        map[key] = code;
    };
    for (const [code, meta] of Object.entries(PRIMARY_SUBJECTS)) {
        add(meta.labelAr, code);
    }
    for (const [raw, code] of Object.entries(EXTRA_PRIMARY_ALIASES)) {
        add(raw, code);
    }
    return map;
}

const PRIMARY_SUBJECT_ALIASES = Object.freeze(_buildAliases());

/**
 * Idempotent UNION seed: missing subject rows and missing aliases only.
 * Existing rows and aliases (any cycle) are never overwritten — first wins.
 */
function seedPrimarySubjects(db) {
    const insertSubject = db.prepare(
        `INSERT OR IGNORE INTO education_subjects(subject_code, label_ar, label_fr, sort_order)
         VALUES (?, ?, ?, ?)`
    );
    const insertAlias = db.prepare(
        `INSERT OR IGNORE INTO subject_aliases(raw_alias, normalized_alias, subject_code, source)
         VALUES (?, ?, ?, 'education-catalogs')`
    );
    const seed = db.transaction(() => {
        for (const [code, meta] of Object.entries(PRIMARY_SUBJECTS)) {
            insertSubject.run(code, meta.labelAr, meta.labelFr || null, meta.sortOrder);
        }
        for (const [normalized, code] of Object.entries(PRIMARY_SUBJECT_ALIASES)) {
            insertAlias.run(normalized, normalized, code);
        }
    });
    seed();
}

module.exports = {
    PRIMARY_SUBJECTS,
    PRIMARY_SUBJECT_ALIASES,
    seedPrimarySubjects
};
