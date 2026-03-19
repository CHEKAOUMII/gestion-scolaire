/**
 * ma-education-labels.js
 * ═══════════════════════════════════════════════════════════════
 * ملف مركزي لترجمة رموز التعليم المغربي إلى العربية
 * يُستخدم أثناء استيراد ملف الوزارة وعند العرض
 *
 * المصادر:
 *  - DsAgentExport XML (R_Discip, R_GRADE, R_CADRE, R_FONCT, R_SitFam)
 *  - بيانات المنظومة التعليمية المغربية
 * ═══════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. مواد التخصص (Disciplines / Matières)
// ─────────────────────────────────────────────────────────────────────────────
// النسخة الرئيسية: الفرنسية / الاختصارات → العربية
// مثال: disciplineMap.get('CD_DISCIP') يعطي الاسم الكامل الفرنسي
// ثم translateSubject(frenchName) يحوله للعربية
//
// ملاحظة: الأستاذ قد يكون تخصصه "MATHEMATIQUES" لكن يدرس "PHYSIQUE CHIMIE"
// field: specialty_subject = تخصصه الأصلي (من CD_DISCIP)
// field: subject           = المادة التي يدرسها فعلياً (من FET أو يدوي)
// ─────────────────────────────────────────────────────────────────────────────

const SUBJECT_LABELS = Object.freeze({
    // ── رياضيات ──────────────────────────────────────────────
    'MATHEMATIQUES':                   'الرياضيات',
    'MATH':                            'الرياضيات',
    'MATHS':                           'الرياضيات',
    'SCIENCES MATHEMATIQUES':          'الرياضيات',
    'SC MATH':                         'الرياضيات',
    'SC MATHS':                        'الرياضيات',

    // ── فيزياء وكيمياء ────────────────────────────────────────
    'PHYSIQUE CHIMIE':                 'الفيزياء والكيمياء',
    'PHYSIQUE-CHIMIE':                 'الفيزياء والكيمياء',
    'PHYSIQUE ET CHIMIE':              'الفيزياء والكيمياء',
    'PHYSIQUE':                        'الفيزياء والكيمياء',
    'CHIMIE':                          'الفيزياء والكيمياء',
    'SC PHYSIQUE':                     'الفيزياء والكيمياء',
    'SC PHYS':                         'الفيزياء والكيمياء',

    // ── علوم الحياة والأرض ────────────────────────────────────
    'SCIENCES DE LA VIE ET DE LA TERRE': 'علوم الحياة والأرض',
    'SC DE LA VIE ET DE LA TERRE':     'علوم الحياة والأرض',
    'SVT':                             'علوم الحياة والأرض',
    'SCIENCES NATURELLES':             'علوم الحياة والأرض',
    'SC NAT':                          'علوم الحياة والأرض',
    'SC VIE TERRE':                    'علوم الحياة والأرض',

    // ── فلسفة ─────────────────────────────────────────────────
    'PHILOSOPHIE':                     'الفلسفة',
    'PHILO':                           'الفلسفة',

    // ── اللغة العربية ─────────────────────────────────────────
    'LANGUE ARABE':                    'اللغة العربية',
    'ARABE':                           'اللغة العربية',
    'L ARABE':                         'اللغة العربية',

    // ── اللغة الفرنسية ────────────────────────────────────────
    'LANGUE FRANCAISE':                'اللغة الفرنسية',
    'FRANCAIS':                        'اللغة الفرنسية',
    'FRANCAISE':                       'اللغة الفرنسية',
    'LANGUE FRANÇAISE':                'اللغة الفرنسية',
    'FRANÇAIS':                        'اللغة الفرنسية',
    'L FRANCAISE':                     'اللغة الفرنسية',

    // ── اللغة الإنجليزية ──────────────────────────────────────
    'LANGUE ANGLAISE':                 'اللغة الإنجليزية',
    'ANGLAIS':                         'اللغة الإنجليزية',
    'ANGLAISE':                        'اللغة الإنجليزية',
    'LANGUE ANGLAIS':                  'اللغة الإنجليزية',
    'ENGLISH':                         'اللغة الإنجليزية',
    'L ANGLAISE':                      'اللغة الإنجليزية',

    // ── اللغة الإسبانية ───────────────────────────────────────
    'ESPAGNOL':                        'اللغة الإسبانية',
    'LANGUE ESPAGNOLE':                'اللغة الإسبانية',
    'L ESPAGNOLE':                     'اللغة الإسبانية',

    // ── لغات أخرى ────────────────────────────────────────────
    'ALLEMAND':                        'اللغة الألمانية',
    'ITALIEN':                         'اللغة الإيطالية',
    'PORTUGAIS':                       'اللغة البرتغالية',
    'RUSSE':                           'اللغة الروسية',
    'CHINOIS':                         'اللغة الصينية',

    // ── التربية الإسلامية ─────────────────────────────────────
    'EDUCATION ISLAMIQUE':             'التربية الإسلامية',
    'INSTRUCTION ISLAMIQUE':           'التربية الإسلامية',
    'ISLAMIQUE':                       'التربية الإسلامية',
    'ED ISLAMIQUE':                    'التربية الإسلامية',
    'INSTR ISLAMIQUE':                 'التربية الإسلامية',

    // ── التربية البدنية ───────────────────────────────────────
    'EDUCATION PHYSIQUE ET SPORTIVE':  'التربية البدنية والرياضية',
    'ED PHYSIQUE ET SPORTIVE':         'التربية البدنية والرياضية',
    'EDUCATION PHYSIQUE':              'التربية البدنية',
    'ED PHYSIQUE':                     'التربية البدنية',
    'EPS':                             'التربية البدنية',
    'SPORT':                           'التربية البدنية',

    // ── التاريخ والجغرافيا ─────────────────────────────────────
    'HISTOIRE ET GEOGRAPHIE':          'التاريخ والجغرافيا',
    'HISTOIRE-GEOGRAPHIE':             'التاريخ والجغرافيا',
    'HISTOIRE GEOGRAPHIE':             'التاريخ والجغرافيا',
    'HISTOIRE':                        'التاريخ والجغرافيا',
    'GEOGRAPHIE':                      'التاريخ والجغرافيا',
    'HIST GEO':                        'التاريخ والجغرافيا',
    'HIST ET GEO':                     'التاريخ والجغرافيا',
    'HIST GEOGRAPHIE':                 'التاريخ والجغرافيا',

    // ── معلوميات ──────────────────────────────────────────────
    'INFORMATIQUE':                    'المعلوميات',

    // ── اقتصاد وتدبير ────────────────────────────────────────
    'ECONOMIE GENERALE':               'الاقتصاد العام والإحصاء',
    'ECONOMIE GENERALE ET STATISTIQUES': 'الاقتصاد العام والإحصاء',
    'ECO GENERALE ET STATISTIQUES':    'الاقتصاد العام والإحصاء',
    'ECO. GENERALE ET STATISTIQUES':   'الاقتصاد العام والإحصاء',
    'SCIENCES ECONOMIQUES':            'الاقتصاد العام والإحصاء',
    'ECONOMIE':                        'الاقتصاد العام والإحصاء',
    'ECONOMIE ET ORGANISATION ADMINISTRATIVE DES ENTREPRISES': 'الاقتصاد والتنظيم الإداري للمقاولات',
    'ECONOMIE ET ORGANISATION DES ENTREPRISES': 'الاقتصاد والتنظيم الإداري للمقاولات',
    'ECONOMIE ET ORGANISATION':        'الاقتصاد والتنظيم الإداري للمقاولات',
    'ECO ET ORG ADMIN ENTREPRISE':     'الاقتصاد والتنظيم الإداري للمقاولات',
    'ECO. ET ORG. ADMIN. ENTREPRISE':  'الاقتصاد والتنظيم الإداري للمقاولات',
    'ECO ET ORGANISATION':             'الاقتصاد والتنظيم الإداري للمقاولات',
    'COMPTABILITE ET MATHEMATIQUES FINANCIERES': 'المحاسبة والرياضيات المالية',
    'COMPTA ET MATHS FINANCIERES':  'المحاسبة والرياضيات المالية',
    'COMPTABILITE':                    'المحاسبة والرياضيات المالية',
    'INFORMATIQUE DE GESTION':         'معلوميات التدبير',
    'DROIT':                           'القانون',
    'TRADUCTION':                      'الترجمة',

    // ── علوم المهندس ──────────────────────────────────────────
    "SCIENCES DE L'INGENIEUR":         'علوم المهندس',
    "SCIENCES DE L INGENIEUR":         'علوم المهندس',
    'SCIENCES INGENIEURS':             'علوم المهندس',
    'SC DE L INGENIEUR':               'علوم المهندس',
    'SI':                              'علوم المهندس',

    // ── فنون تطبيقية ─────────────────────────────────────────
    'ARTS APPLIQUES':                  'الفنون التطبيقية',
    'DESSIN':                          'الفنون التطبيقية',
    'BEAUX ARTS':                      'الفنون الجميلة',

    // ── التعليم الأصيل ────────────────────────────────────────
    'ENSEIGNEMENT ORIGINEL':           'التعليم الأصيل',

    // ── التعليم التقني والمهني ────────────────────────────────
    'TECHNOLOGIE':                     'التكنولوجيا',
    'SCIENCES TECHNIQUES':             'العلوم التقنية',
    'ELECTRONIQUE':                    'الإلكترونيك',
    'ELECTROTECHNIQUE':                'الكهروتقنية',
    'MECANIQUE':                       'الميكانيك',
    'GENIE CIVIL':                     'الهندسة المدنية',
    'TOPOGRAPHIE':                     'الطوبوغرافيا',
    'AGRICULTURE':                     'الفلاحة',
    'AGROALIMENTAIRE':                 'الصناعة الغذائية',
    'TOURISME ET HOTELLERIE':          'السياحة والفندقة',
    'TEXTILE':                         'النسيج',
    'BATIMENT':                        'البناء والأشغال العامة',
    'COUTURE':                         'الخياطة',
    'COIFFURE':                        'الحلاقة والتجميل',
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. الأطر (Cadres) — القيم الحرفية من XML R_CADRE → LL_CADRE
// ─────────────────────────────────────────────────────────────────────────────
const CADRE_LABELS = Object.freeze({
    // من LL_CADRE مباشرةً (بعد إزالة النقط التشكيلية)
    'PROFESSEUR DE L ENS SECONDAIRE QUALIFIE':       'أستاذ التعليم الثانوي المؤهَّل',
    'PROFESSEUR DE L ENSEIGNEMENT SECONDAIRE QUALIFIE': 'أستاذ التعليم الثانوي المؤهَّل',
    'PROF DE L ENS SECONDAIRE QUALIFIE':             'أستاذ التعليم الثانوي المؤهَّل',
    'PROFESSEUR DE L ENSEIG SECONDAIRE QUALIF':      'أستاذ التعليم الثانوي المؤهَّل',
    'PROFESSEUR DE L ENSEIG. SECONDAIRE QUALIF':     'أستاذ التعليم الثانوي المؤهَّل',
    'PROFESSEUR DE L ENSEIG. SECONDAIRE QUALIF.':    'أستاذ التعليم الثانوي المؤهَّل',
    'CADRE SPECIALISTE PEDAGOGIQUE':                 'إطار متخصص تربوي',
    'SPECIALISTE PEDAGOGIQUE':                       'متخصص تربوي',
    'ADMINISTRATEUR PEDAGOGIQUE':                    'إداري تربوي',
    'INSPECTEUR DE L ENSEIGNEMENT SECONDAIRE':       'مفتش التعليم الثانوي',
    'INSPECTEUR DE L ENS. SECONDAIRE':               'مفتش التعليم الثانوي',
    'PROFESSEUR DE L ENS PRIMAIRE':                  'أستاذ التعليم الابتدائي',
    'PROFESSEUR DE L ENSEIGNEMENT PRIMAIRE':         'أستاذ التعليم الابتدائي',
    'PROFESSEUR DE L ENS SECONDAIRE COLLEGIAL':      'أستاذ التعليم الإعدادي',
    'CONSEILLER D ORIENTATION':                      'مستشار التوجيه',
    'DIRECTEUR D ETABLISSEMENT':                     'مدير مؤسسة',
    // أكواد مختصرة
    'PROF ENS SEC QUAL':    'أستاذ التعليم الثانوي المؤهَّل',
    'PROF ENS SEC':         'أستاذ التعليم الثانوي',
    'PROF ENS PRIM':        'أستاذ التعليم الابتدائي',
    'PROF ENS COLL':        'أستاذ التعليم الإعدادي',
    'ADM PED':              'إداري تربوي',
    'CONS ORI':             'مستشار التوجيه',
    'DIR ETB':              'مدير مؤسسة',
    'INS ENS':              'مفتش التعليم',
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. الدرجات (Grades) — القيم الحرفية من XML R_GRADE → LL_GRADE
// ─────────────────────────────────────────────────────────────────────────────
const GRADE_LABELS = Object.freeze({
    // من LL_GRADE مباشرةً (بعد إزالة النقط التشكيلية)
    'PROF. DE L ENS. SECOND. QUALIFIE 1ER GR.':      'أستاذ التعليم الثانوي المؤهَّل – الدرجة الأولى',
    'PROF. DE L ENS. SECOND. QUALIFIE 2EME GR.':     'أستاذ التعليم الثانوي المؤهَّل – الدرجة الثانية',
    'PROF. DE L ENS. SECOND. QUALIFIE 3EME GR.':     'أستاذ التعليم الثانوي المؤهَّل – الدرجة الثالثة',
    'PROF. DE L ENS. SECOND. QUALIFIE 1ER GR':       'أستاذ التعليم الثانوي المؤهَّل – الدرجة الأولى',
    'PROF. DE L ENS. SECOND. QUALIFIE 2EME GR':      'أستاذ التعليم الثانوي المؤهَّل – الدرجة الثانية',
    'PROF. DE L ENS. SECOND. QUALIFIE 3EME GR':      'أستاذ التعليم الثانوي المؤهَّل – الدرجة الثالثة',
    'PROF. DE L ENS. SECOND. QUALIFIE 1ER GRADE':    'أستاذ التعليم الثانوي المؤهَّل – الدرجة الأولى',
    'PROF. DE L ENS. SECOND. QUALIFIE 2EME GRADE':   'أستاذ التعليم الثانوي المؤهَّل – الدرجة الثانية',
    'PROF. DE L ENS. SECOND. QUALIFIE 3EME GRADE':   'أستاذ التعليم الثانوي المؤهَّل – الدرجة الثالثة',
    // بدون نقط
    'PROF DE L ENS SECOND QUALIFIE 1ER GR':          'أستاذ التعليم الثانوي المؤهَّل – الدرجة الأولى',
    'PROF DE L ENS SECOND QUALIFIE 2EME GR':         'أستاذ التعليم الثانوي المؤهَّل – الدرجة الثانية',
    'PROF DE L ENS SECOND QUALIFIE 3EME GR':         'أستاذ التعليم الثانوي المؤهَّل – الدرجة الثالثة',
    // متخصص تربوي
    'SPECIALISTE PEDAGOGIQUE DE 1EME GR':             'متخصص تربوي – الدرجة الأولى',
    'SPECIALISTE PEDAGOGIQUE DE 1ER GR':              'متخصص تربوي – الدرجة الأولى',
    'SPECIALISTE PEDAGOGIQUE DE 2EME GR':             'متخصص تربوي – الدرجة الثانية',
    'SPECIALISTE PEDAGOGIQUE DE 3EME GR':             'متخصص تربوي – الدرجة الثالثة',
    'SPECIALISTE PEDAGOGIQUE DE 1EME GRADE':          'متخصص تربوي – الدرجة الأولى',
    'SPECIALISTE PEDAGOGIQUE DE 2EME GRADE':          'متخصص تربوي – الدرجة الثانية',
    'SPECIALISTE PEDAGOGIQUE DE 3EME GRADE':          'متخصص تربوي – الدرجة الثالثة',
    // إداري تربوي
    'ADMINISTRATEUR PEDAGOGIQUE':                     'إداري تربوي',
    'ADMINISTRATEUR PEDAGOGIQUE GRADE PRINCIPAL':     'إداري تربوي – درجة رئيسية',
    'ADMINISTRATEUR PEDAGOGIQUE - GRADE PRINCIPAL':   'إداري تربوي – درجة رئيسية',
    'ADMINISTRATEUR PEDAGOGIQUE ECHELLE 11':          'إداري تربوي – السلم 11',
    'CADRE ADJOINT PEDAGOGIQUE':                      'إطار مساعد تربوي',
    // ..ابتدائي وإعدادي
    'PROF. DE L ENS. PRIMAIRE 1ER GR.':               'أستاذ التعليم الابتدائي – الدرجة الأولى',
    'PROF. DE L ENS. PRIMAIRE 2EME GR.':              'أستاذ التعليم الابتدائي – الدرجة الثانية',
    'PROF. DE L ENS. PRIMAIRE 3EME GR.':              'أستاذ التعليم الابتدائي – الدرجة الثالثة',
    'PROF. DE L ENS. COL. QUALIFIE 1ER GR.':          'أستاذ التعليم الإعدادي المؤهَّل – الدرجة الأولى',
    'PROF. DE L ENS. COL. QUALIFIE 2EME GR.':         'أستاذ التعليم الإعدادي المؤهَّل – الدرجة الثانية',
    'PROF. DE L ENS. COL. QUALIFIE 3EME GR.':         'أستاذ التعليم الإعدادي المؤهَّل – الدرجة الثالثة',
    // مفتش ومدير
    'INSPECTEUR DE L ENSEIGNEMENT SECONDAIRE':        'مفتش التعليم الثانوي',
    'DIRECTEUR D ETABLISSEMENT':                      'مدير مؤسسة',
    'CONSEILLER PEDAGOGIQUE':                         'مستشار تربوي',
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. الحالة العائلية (Situation Familiale)
// ─────────────────────────────────────────────────────────────────────────────
const MARITAL_LABELS = Object.freeze({
    'CELIBATAIRE':  'أعزب',
    'MARIE':        'متزوج',
    'MARIE(E)':     'متزوج',
    'DIVORCE':      'مطلق',
    'VEUF':         'أرمل',
    'VEUF(VE)':     'أرمل',
    '1': 'أعزب',
    '2': 'متزوج',
    '3': 'مطلق',
    '4': 'أرمل',
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ترتيب المواد (Subject Display Order)
// ─────────────────────────────────────────────────────────────────────────────
// الترتيب الرسمي للمواد حسب المنظومة التعليمية المغربية
const SUBJECT_ORDER = Object.freeze([
    'اللغة العربية',
    'اللغة الفرنسية',
    'اللغة الإنجليزية',
    'اللغة الإسبانية',
    'اللغة الألمانية',
    'اللغة الإيطالية',
    'التاريخ والجغرافيا',
    'الرياضيات',
    'علوم الحياة والأرض',
    'الفيزياء والكيمياء',
    'التربية الإسلامية',
    'التربية البدنية',
    'التربية البدنية والرياضية',
    'المعلوميات',
    'الفلسفة',
    'الترجمة',
    'القانون',
    'المحاسبة والرياضيات المالية',
    'الاقتصاد العام والإحصاء',
    'الاقتصاد والتنظيم الإداري للمقاولات',
    'معلوميات التدبير',
]);

/**
 * دالة ترتيب المواد حسب الترتيب الرسمي
 * المواد غير الموجودة في القائمة تُوضع في النهاية مرتبة أبجدياً
 * @param {string} a - اسم المادة الأولى
 * @param {string} b - اسم المادة الثانية
 * @returns {number} - نتيجة المقارنة
 */
function compareSubjects(a, b) {
    const idxA = SUBJECT_ORDER.indexOf(a);
    const idxB = SUBJECT_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b, 'ar');
}

/**
 * ترتيب مصفوفة من أسماء المواد حسب الترتيب الرسمي
 * @param {string[]} subjects - مصفوفة أسماء المواد
 * @returns {string[]} - المصفوفة مرتبة
 */
function sortSubjects(subjects) {
    return [...subjects].sort(compareSubjects);
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال الترجمة
// ─────────────────────────────────────────────────────────────────────────────

// دالة تطبيع للمقارنة: حروف كبيرة + إزالة التشكيل + توحيد الفواصل العليا
function _normKey(str) {
    return String(str)
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u2018\u2019\u02bc]/g, "'")
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Pre-computed sorted keys + normalized forms (built once at load time)
const _SUBJECT_SORTED_ENTRIES = Object.keys(SUBJECT_LABELS)
    .sort((a, b) => b.length - a.length)
    .map(k => {
        const kn = _normKey(k);
        return { key: k, norm: kn, clean: kn.replace(/[' ]/g, '') };
    });

// Memoization cache for translateSubject
const _translateCache = Object.create(null);

// Arabic-only fast check (no Latin letters → skip translation pipeline)
const _HAS_LATIN = /[A-Za-z\u00C0-\u024F]/;

// خريطة عكسية: القيم العربية الأساسية (canonical) لمطابقة المتغيرات المختلفة
// المفتاح = النسخة المطبّعة (بدون مسافات زائدة)، القيمة = الاسم القياسي
const _ARABIC_CANONICAL = Object.create(null);

// إزالة التشكيل فقط (فتحة، ضمة، كسرة، شدة، سكون، تنوين) بدون مس الحروف
const _TASHKEEL = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;

/**
 * تطبيع نص عربي: إزالة التشكيل + توحيد الهمزات + توحيد واو العطف + توحيد المسافات
 * "المحاسبة و الرياضيات" → "المحاسبة والرياضيات"
 * "الإقتصاد" → "الاقتصاد"
 */
function _normArabic(str) {
    return str
        .replace(_TASHKEEL, '')
        // توحيد أشكال الألف: إ أ آ ٱ → ا
        .replace(/[إأآٱ]/g, 'ا')
        // استبدال الشرطة السفلية بمسافة (بيانات FET/tafwij)
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        // واو العطف المنفصلة: "كلمة و كلمة" → "كلمة وكلمة"
        .replace(/\s+و\s+/g, ' و');
}

(function _buildArabicCanonical() {
    const seen = new Set();
    for (const val of Object.values(SUBJECT_LABELS)) {
        if (seen.has(val)) continue;
        seen.add(val);
        _ARABIC_CANONICAL[_normArabic(val)] = val;
    }
})();

/**
 * ترجمة اسم التخصص / المادة من الفرنسية إلى العربية
 * تعمل حتى مع الأسماء التي تحوي حروف مشكّلة أو نقط
 * @param {string} raw  - الاسم الخام (فرنسي أو كود)
 * @returns {string}    - الاسم العربي، أو الأصلي إن لم يُعثر عليه
 */
function translateSubject(raw) {
    if (!raw) return raw;

    // Cache hit → instant return
    if (_translateCache[raw] !== undefined) return _translateCache[raw];

    // Arabic-only text → check canonical map for normalization
    if (!_HAS_LATIN.test(raw)) {
        const normKey = _normArabic(raw);
        const canonical = _ARABIC_CANONICAL[normKey] || raw;
        _translateCache[raw] = canonical;
        return canonical;
    }

    const key = _normKey(raw);
    if (SUBJECT_LABELS[key]) {
        _translateCache[raw] = SUBJECT_LABELS[key];
        return SUBJECT_LABELS[key];
    }

    // بحث بعد إزالة الفواصل العليا والشرطات
    const keyClean = key.replace(/[' ]/g, '');
    for (const entry of _SUBJECT_SORTED_ENTRIES) {
        if (entry.norm === key) { _translateCache[raw] = SUBJECT_LABELS[entry.key]; return SUBJECT_LABELS[entry.key]; }
        if (entry.clean === keyClean && keyClean.length > 3) { _translateCache[raw] = SUBJECT_LABELS[entry.key]; return SUBJECT_LABELS[entry.key]; }
        if (entry.norm.length > 3 && (key.includes(entry.norm) || entry.norm.includes(key))) { _translateCache[raw] = SUBJECT_LABELS[entry.key]; return SUBJECT_LABELS[entry.key]; }
    }
    _translateCache[raw] = raw;
    return raw;
}

/**
 * ترجمة درجة من الفرنسية إلى العربية
 */
function translateGrade(raw) {
    if (!raw) return raw;
    const key = String(raw).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (GRADE_LABELS[key]) return GRADE_LABELS[key];
    // بحث جزئي
    for (const k of Object.keys(GRADE_LABELS).sort((a, b) => b.length - a.length)) {
        if (key.includes(k) || k.includes(key)) return GRADE_LABELS[k];
    }
    return raw;
}

/**
 * ترجمة الإطار من الفرنسية إلى العربية
 */
function translateCadre(raw) {
    if (!raw) return raw;
    const key = String(raw).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (CADRE_LABELS[key]) return CADRE_LABELS[key];
    for (const k of Object.keys(CADRE_LABELS).sort((a, b) => b.length - a.length)) {
        if (key.includes(k) || k.includes(key)) return CADRE_LABELS[k];
    }
    return raw;
}

/**
 * ترجمة الحالة العائلية
 */
function translateMaritalStatus(raw) {
    if (!raw) return raw;
    const key = String(raw).toUpperCase().trim();
    return MARITAL_LABELS[key] || raw;
}

// Memoization cache for normalizeSubjectName
const _normalizeCache = Object.create(null);

/**
 * تطبيع اسم المادة:
 * 1. إزالة لاحقات الفروض (فرض 1) والأنشطة المندمجة
 * 2. ترجمة الأسماء الفرنسية إلى العربية باستخدام translateSubject
 * @param {string} subject - اسم المادة الخام
 * @returns {string} - الاسم المطبّع
 */
function normalizeSubjectName(subject) {
    const raw = String(subject || '');
    if (_normalizeCache[raw] !== undefined) return _normalizeCache[raw];

    const text = raw
        .replace(/\s*\(\s*(?:فرض|نشط)\s*[0-9\u0660-\u0669]+\s*\)\s*$/i, '')
        .replace(/\s*\(الأنشطة المندمجة\)\s*$/i, '')
        .trim();
    if (!text) { _normalizeCache[raw] = text; return text; }
    const result = translateSubject(text);
    _normalizeCache[raw] = result;
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// تصدير (Node.js + Browser)
// ─────────────────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SUBJECT_LABELS,
        SUBJECT_ORDER,
        CADRE_LABELS,
        GRADE_LABELS,
        MARITAL_LABELS,
        translateSubject,
        translateGrade,
        translateCadre,
        translateMaritalStatus,
        compareSubjects,
        sortSubjects,
        normalizeSubjectName,
    };
}
