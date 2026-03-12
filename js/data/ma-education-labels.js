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
    'COMPTABILITE':                    'المحاسبة والرياضيات المالية',
    'INFORMATIQUE DE GESTION':         'معلوميات التدبير',
    'DROIT':                           'القانون',
    'TRADUCTION':                      'الترجمة',

    // ── علوم المهندس ──────────────────────────────────────────
    "SCIENCES DE L'INGENIEUR":         'علوم المهندس',
    "SCIENCES DE L INGENIEUR":         'علوم المهندس',
    'SCIENCES INGENIEURS':             'علوم المهندس',
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
// دوال الترجمة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ترجمة اسم التخصص / المادة من الفرنسية إلى العربية
 * تعمل حتى مع الأسماء التي تحوي حروف مشكّلة أو نقط
 * @param {string} raw  - الاسم الخام (فرنسي أو كود)
 * @returns {string}    - الاسم العربي، أو الأصلي إن لم يُعثر عليه
 */
function translateSubject(raw) {
    if (!raw) return raw;
    // دالة تطبيع للمقارنة: حروف كبيرة + إزالة التشكيل + توحيد الفواصل العليا
    const norm = str => String(str)
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u2018\u2019\u02bc]/g, "'")
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const key = norm(raw);
    if (SUBJECT_LABELS[key]) return SUBJECT_LABELS[key];

    // بحث بعد إزالة الفواصل العليا والشرطات
    const keyClean = key.replace(/[' ]/g, '');
    const sorted = Object.keys(SUBJECT_LABELS).sort((a, b) => b.length - a.length);
    for (const k of sorted) {
        const kn = norm(k);
        if (kn === key) return SUBJECT_LABELS[k];
        if (kn.replace(/[' ]/g, '') === keyClean && keyClean.length > 3) return SUBJECT_LABELS[k];
        if (kn.length > 3 && (key.includes(kn) || kn.includes(key))) return SUBJECT_LABELS[k];
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// تصدير (Node.js + Browser)
// ─────────────────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SUBJECT_LABELS,
        CADRE_LABELS,
        GRADE_LABELS,
        MARITAL_LABELS,
        translateSubject,
        translateGrade,
        translateCadre,
        translateMaritalStatus,
    };
}
