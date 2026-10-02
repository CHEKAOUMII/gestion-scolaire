'use strict';

/**
 * Collegial-cycle subject catalog (secondary_collegial).
 *
 * Source of truth: the school dossier at `D:\secondaire\` —
 *   - `معاملات المواد -نتاءئج مدرسية.md` (بيان النتائج الدراسية, 1APIC/2APIC/3APIC report cards):
 *     the actual subject set used in the collegial cycle;
 *   - `نسبة_الأنشطة_المندمجة_الشامل.md` (same school, same levels).
 *
 * Subjects are an institution-wide shared catalog (education_subjects.subject_code
 * global PK, subject_aliases globally unique — schema.js review decision 1), so
 * this module UNION-seeds only the missing codes (INSERT OR IGNORE). Most codes
 * already exist from the qualifiant/primary catalogs; `TECHNOLOGY` (التكنولوجيا)
 * is new for collegial. Alias collisions resolve first-wins via the global unique
 * constraint — e.g. «الاجتماعيات» keeps the legacy HISTORY_GEOGRAPHY binding, while
 * SOCIAL_STUDIES keeps its own catalog row (per primary-stage-catalogs plan).
 * «المعلوماتيات» is a collegial report-card spelling of COMPUTER_SCIENCE.
 */

const { normalizeAliasKey } = require('./subject-catalog');

const COLLEGIAL_SUBJECTS = {
    'ARABIC': {
        labelAr: 'اللغة العربية',
        labelFr: 'Langue arabe',
        sortOrder: 0
    },
    'FRENCH': {
        labelAr: 'اللغة الفرنسية',
        labelFr: 'Langue française',
        sortOrder: 1
    },
    'MATH': {
        labelAr: 'الرياضيات',
        labelFr: 'Mathématiques',
        sortOrder: 2
    },
    'SOCIAL_STUDIES': {
        labelAr: 'الاجتماعيات',
        labelFr: 'Sciences sociales',
        sortOrder: 3
    },
    'EARTH_SCIENCES': {
        labelAr: 'علوم الحياة والأرض',
        labelFr: 'Sciences de la vie et de la terre',
        sortOrder: 4
    },
    'PHYSICS_CHEMISTRY': {
        labelAr: 'الفيزياء والكيمياء',
        labelFr: 'Physique et chimie',
        sortOrder: 5
    },
    'ISLAMIC_EDUCATION': {
        labelAr: 'التربية الإسلامية',
        labelFr: 'Éducation islamique',
        sortOrder: 6
    },
    'COMPUTER_SCIENCE': {
        labelAr: 'المعلوميات',
        labelFr: 'Informatique',
        sortOrder: 7
    },
    'PHYSICAL_EDUCATION': {
        labelAr: 'التربية البدنية',
        labelFr: 'Éducation physique',
        sortOrder: 8
    },
    'ENGLISH': {
        labelAr: 'اللغة الإنجليزية',
        labelFr: 'Langue anglaise',
        sortOrder: 9
    },
    'TECHNOLOGY': {
        labelAr: 'التكنولوجيا',
        labelFr: 'Technologie',
        sortOrder: 10
    }
};

/** Collegial-only extra import aliases (labels map themselves). */
const EXTRA_COLLEGIAL_ALIASES = {
    'التكنولوجيا': 'TECHNOLOGY',
    'تكنولوجيا': 'TECHNOLOGY',
    'Technologie': 'TECHNOLOGY',
    'technologie': 'TECHNOLOGY',
    'المعلوماتيات': 'COMPUTER_SCIENCE',
    'المعلوماتية': 'COMPUTER_SCIENCE'
};

function _buildAliases() {
    const map = Object.create(null);
    const add = (raw, code) => {
        const key = normalizeAliasKey(raw);
        if (!key || !code || map[key]) return;
        map[key] = code;
    };
    for (const [code, meta] of Object.entries(COLLEGIAL_SUBJECTS)) {
        add(meta.labelAr, code);
    }
    for (const [raw, code] of Object.entries(EXTRA_COLLEGIAL_ALIASES)) {
        add(raw, code);
    }
    return map;
}

const COLLEGIAL_SUBJECT_ALIASES = Object.freeze(_buildAliases());

/**
 * Idempotent UNION seed: missing subject rows and missing aliases only.
 * Existing rows and aliases (any cycle) are never overwritten — first wins.
 */
function seedCollegialSubjects(db) {
    const insertSubject = db.prepare(
        `INSERT OR IGNORE INTO education_subjects(subject_code, label_ar, label_fr, sort_order)
         VALUES (?, ?, ?, ?)`
    );
    const insertAlias = db.prepare(
        `INSERT OR IGNORE INTO subject_aliases(raw_alias, normalized_alias, subject_code, source)
         VALUES (?, ?, ?, 'education-catalogs')`
    );
    const seed = db.transaction(() => {
        for (const [code, meta] of Object.entries(COLLEGIAL_SUBJECTS)) {
            insertSubject.run(code, meta.labelAr, meta.labelFr || null, meta.sortOrder);
        }
        for (const [raw, code] of Object.entries(COLLEGIAL_SUBJECT_ALIASES)) {
            const normalized = normalizeAliasKey(raw);
            if (normalized) insertAlias.run(raw, normalized, code);
        }
    });
    seed();
}

module.exports = {
    COLLEGIAL_SUBJECTS,
    COLLEGIAL_SUBJECT_ALIASES,
    seedCollegialSubjects
};
