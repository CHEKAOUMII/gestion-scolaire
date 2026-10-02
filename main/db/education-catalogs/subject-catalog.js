/**
 * Subject catalog for the qualifiant cycle (029-stage-rules-management).
 * Canonical subjects derived from SUBJECT_LABELS (js/data/ma-education-labels.js),
 * DEFAULT_EXAM_COUNTS (main/db/exam-count-defaults.js) and the branch tables
 * extracted from CC_BRANCH_COEFFICIENTS (js/cc-rules.js). Seeded into
 * education_subjects + subject_aliases with source='education-catalogs'.
 */

const { SUBJECT_LABELS, normalizeSubjectName } = require('../../../js/data/ma-education-labels');

const SUBJECT_CATALOG = {
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
    'ENGLISH': {
        labelAr: 'اللغة الإنجليزية',
        labelFr: 'Langue anglaise',
        sortOrder: 2
    },
    'SPANISH': {
        labelAr: 'اللغة الإسبانية',
        labelFr: 'Langue espagnole',
        sortOrder: 3
    },
    'GERMAN': {
        labelAr: 'اللغة الألمانية',
        labelFr: 'Langue allemande',
        sortOrder: 4
    },
    'ITALIAN': {
        labelAr: 'اللغة الإيطالية',
        labelFr: 'Langue italienne',
        sortOrder: 5
    },
    'HISTORY_GEOGRAPHY': {
        labelAr: 'التاريخ والجغرافيا',
        labelFr: 'Histoire et géographie',
        sortOrder: 6
    },
    'MATH': {
        labelAr: 'الرياضيات',
        labelFr: 'Mathématiques',
        sortOrder: 7
    },
    'EARTH_SCIENCES': {
        labelAr: 'علوم الحياة والأرض',
        labelFr: 'Sciences de la vie et de la terre',
        sortOrder: 8
    },
    'PHYSICS_CHEMISTRY': {
        labelAr: 'الفيزياء والكيمياء',
        labelFr: 'Physique et chimie',
        sortOrder: 9
    },
    'ISLAMIC_EDUCATION': {
        labelAr: 'التربية الإسلامية',
        labelFr: 'Éducation islamique',
        sortOrder: 10
    },
    'PHYSICAL_EDUCATION': {
        labelAr: 'التربية البدنية',
        labelFr: 'Éducation physique',
        sortOrder: 11
    },
    'PHYSICAL_EDUCATION_SPORT': {
        labelAr: 'التربية البدنية والرياضية',
        labelFr: 'Éducation physique et sportive',
        sortOrder: 12
    },
    'COMPUTER_SCIENCE': {
        labelAr: 'المعلوميات',
        labelFr: 'Informatique',
        sortOrder: 13
    },
    'PHILOSOPHY': {
        labelAr: 'الفلسفة',
        labelFr: 'Philosophie',
        sortOrder: 14
    },
    'TRANSLATION': {
        labelAr: 'الترجمة',
        labelFr: 'Traduction',
        sortOrder: 15
    },
    'LAW': {
        labelAr: 'القانون',
        labelFr: 'Droit',
        sortOrder: 16
    },
    'ACCOUNTING_FINANCE': {
        labelAr: 'المحاسبة والرياضيات المالية',
        labelFr: 'Comptabilité et mathématiques financières',
        sortOrder: 17
    },
    'ECONOMICS_STATS': {
        labelAr: 'الاقتصاد العام والإحصاء',
        labelFr: 'Économie générale et statistiques',
        sortOrder: 18
    },
    'ECONOMICS_MANAGEMENT': {
        labelAr: 'الاقتصاد والتنظيم الإداري للمقاولات',
        labelFr: 'Économie et organisation administrative des entreprises',
        sortOrder: 19
    },
    'MANAGEMENT_COMPUTER_SCIENCE': {
        labelAr: 'معلوميات التدبير',
        labelFr: 'Informatique de gestion',
        sortOrder: 20
    },
    'PORTUGUESE': {
        labelAr: 'اللغة البرتغالية',
        labelFr: 'Langue portugaise',
        sortOrder: 21
    },
    'RUSSIAN': {
        labelAr: 'اللغة الروسية',
        labelFr: 'Langue russe',
        sortOrder: 22
    },
    'CHINESE': {
        labelAr: 'اللغة الصينية',
        labelFr: 'Langue chinoise',
        sortOrder: 23
    },
    'FOREIGN_LANGUAGE_1': {
        labelAr: 'اللغة الأجنبية الأولى',
        labelFr: 'Première langue étrangère',
        sortOrder: 24
    },
    'FOREIGN_LANGUAGE_2': {
        labelAr: 'اللغة الأجنبية الثانية',
        labelFr: 'Deuxième langue étrangère',
        sortOrder: 25
    },
    'ENGINEERING_SCIENCES': {
        labelAr: 'علوم المهندس',
        labelFr: "Sciences de l'ingénieur",
        sortOrder: 26
    },
    'APPLIED_ARTS': {
        labelAr: 'الفنون التطبيقية',
        labelFr: 'Arts appliqués',
        sortOrder: 27
    },
    'FINE_ARTS': {
        labelAr: 'الفنون الجميلة',
        labelFr: 'Beaux-arts',
        sortOrder: 28
    },
    'ORIGINAL_EDUCATION': {
        labelAr: 'التعليم الأصيل',
        labelFr: 'Enseignement originel',
        sortOrder: 29
    },
    'TECHNOLOGY': {
        labelAr: 'التكنولوجيا',
        labelFr: 'Technologie',
        sortOrder: 30
    },
    'TECHNICAL_SCIENCES': {
        labelAr: 'العلوم التقنية',
        labelFr: 'Sciences techniques',
        sortOrder: 31
    },
    'ELECTRONICS': {
        labelAr: 'الإلكترونيك',
        labelFr: 'Électronique',
        sortOrder: 32
    },
    'ELECTROTECHNICS': {
        labelAr: 'الكهروتقنية',
        labelFr: 'Électrotechnique',
        sortOrder: 33
    },
    'MECHANICS': {
        labelAr: 'الميكانيك',
        labelFr: 'Mécanique',
        sortOrder: 34
    },
    'CIVIL_ENGINEERING': {
        labelAr: 'الهندسة المدنية',
        labelFr: 'Génie civil',
        sortOrder: 35
    },
    'TOPOGRAPHY': {
        labelAr: 'الطوبوغرافيا',
        labelFr: 'Topographie',
        sortOrder: 36
    },
    'AGRICULTURE': {
        labelAr: 'الفلاحة',
        labelFr: 'Agriculture',
        sortOrder: 37
    },
    'AGROFOOD': {
        labelAr: 'الصناعة الغذائية',
        labelFr: 'Agroalimentaire',
        sortOrder: 38
    },
    'TOURISM_HOSPITALITY': {
        labelAr: 'السياحة والفندقة',
        labelFr: 'Tourisme et hôtellerie',
        sortOrder: 39
    },
    'TEXTILE': {
        labelAr: 'النسيج',
        labelFr: 'Textile',
        sortOrder: 40
    },
    'CONSTRUCTION': {
        labelAr: 'البناء والأشغال العامة',
        labelFr: 'Bâtiment',
        sortOrder: 41
    },
    'SEWING': {
        labelAr: 'الخياطة',
        labelFr: 'Couture',
        sortOrder: 42
    },
    'HAIRDRESSING': {
        labelAr: 'الحلاقة والتجميل',
        labelFr: 'Coiffure',
        sortOrder: 43
    },
    'DEEP_ACCOUNTING': {
        labelAr: 'المحاسبة المعمقة',
        labelFr: 'Comptabilité approfondie',
        sortOrder: 44
    },
    'QURAN_HADITH': {
        labelAr: 'علوم القرآن والحديث',
        labelFr: 'Sciences du Coran et du Hadith',
        sortOrder: 45
    },
    'FIQH': {
        labelAr: 'الفقه وأصوله',
        labelFr: 'Fiqh et ses fondements',
        sortOrder: 46
    },
    'TAWHID_ISLAMIC_THOUGHT': {
        labelAr: 'التوحيد والفكر الإسلامي',
        labelFr: 'Tawhid et pensée islamique',
        sortOrder: 47
    }
};

/**
 * Arabic variants found as text keys in CC_BRANCH_COEFFICIENTS that the app's
 * normalizeSubjectName does not canonicalize (they are not SUBJECT_LABELS
 * values). They are added explicitly so legacy stored names resolve.
 */
const EXTRA_ALIASES = {
    'الفرنسية': 'FRENCH',
    'الإنجليزية': 'ENGLISH',
    'الانجليزية': 'ENGLISH',
    'اللغة الانجليزية': 'ENGLISH',
    'الفيزياء': 'PHYSICS_CHEMISTRY',
    'التاريخ': 'HISTORY_GEOGRAPHY',
    'الجغرافيا': 'HISTORY_GEOGRAPHY',
    'الاجتماعيات': 'HISTORY_GEOGRAPHY',
    'المحاسبة': 'ACCOUNTING_FINANCE',
    'الاقتصاد': 'ECONOMICS_STATS',
    'الاقتصاد والتنظيم الإداري': 'ECONOMICS_MANAGEMENT'
};

/**
 * Normalize an arbitrary subject name into a lookup key.
 * Mirrors the app's normalizeSubjectName behavior (tashkeel stripping, alef
 * normalization, suffix stripping) plus taa-marbuta (ة→ه) and yaa (ى→ي)
 * unification so legacy spellings resolve to the same key.
 */
function normalizeAliasKey(text) {
    return String(text || '')
        .replace(/\s*\(\s*(?:فرض|نشط)\s*[0-9\u0660-\u0669]+\s*\)\s*$/i, '')
        .replace(/\s*\(الأنشطة المندمجة\)\s*$/i, '')
        .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g, '')
        .replace(/[إأآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/_/g, ' ')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u2018\u2019\u02bc]/g, "'")
        .replace(/[\-\.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function _buildLabelIndex() {
    const index = Object.create(null);
    for (const [code, meta] of Object.entries(SUBJECT_CATALOG)) {
        const key = normalizeAliasKey(meta.labelAr);
        if (!index[key]) index[key] = code;
    }
    return index;
}

const _LABEL_TO_CODE = Object.freeze(_buildLabelIndex());

const SUBJECT_ALIASES = Object.freeze(_buildAliases());

function _buildAliases() {
    const map = Object.create(null);
    const add = (raw, code) => {
        const key = normalizeAliasKey(raw);
        if (!key || !code) return;
        if (!map[key]) map[key] = code;
    };
    for (const [code, meta] of Object.entries(SUBJECT_CATALOG)) {
        add(meta.labelAr, code);
    }
    for (const raw of Object.keys(SUBJECT_LABELS)) {
        add(raw, _LABEL_TO_CODE[normalizeAliasKey(normalizeSubjectName(raw))]);
    }
    for (const [raw, code] of Object.entries(EXTRA_ALIASES)) {
        add(raw, code);
    }
    return map;
}

(function _validateCatalog() {
    for (const value of Object.values(SUBJECT_LABELS)) {
        const code = _LABEL_TO_CODE[normalizeAliasKey(value)];
        if (!code) {
            throw new Error(`subject-catalog: SUBJECT_LABELS value "${value}" has no catalog entry`);
        }
    }
})();

/**
 * Resolve a subject name (canonical Arabic label, legacy variant or French
 * source name) into a subject_code. Returns null when unmappable.
 */
function mapSubjectToCode(name) {
    if (!name) return null;
    const canonical = normalizeSubjectName(name);
    const byLabel = _LABEL_TO_CODE[normalizeAliasKey(canonical)];
    if (byLabel) return byLabel;
    return SUBJECT_ALIASES[normalizeAliasKey(name)] || null;
}

/**
 * Idempotent seed of the catalog into education_subjects + subject_aliases.
 */
function seedSubjectCatalog(db) {
    const insertSubject = db.prepare(
        `INSERT OR IGNORE INTO education_subjects(subject_code, label_ar, label_fr, sort_order)
         VALUES (?, ?, ?, ?)`
    );
    const insertAlias = db.prepare(
        `INSERT OR IGNORE INTO subject_aliases(raw_alias, normalized_alias, subject_code, source)
         VALUES (?, ?, ?, 'education-catalogs')`
    );
    const seed = db.transaction(() => {
        for (const [code, meta] of Object.entries(SUBJECT_CATALOG)) {
            insertSubject.run(code, meta.labelAr, meta.labelFr || null, meta.sortOrder);
        }
        for (const [normalized, code] of Object.entries(SUBJECT_ALIASES)) {
            insertAlias.run(normalized, normalized, code);
        }
    });
    seed();
}

module.exports = {
    SUBJECT_CATALOG,
    SUBJECT_ALIASES,
    normalizeAliasKey,
    mapSubjectToCode,
    seedSubjectCatalog
};
