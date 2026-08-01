/**
 * cc-rules.js — قواعد حساب معدل المراقبة المستمرة
 *
 * مرجع: مذكرة رقم 142 بتاريخ 16 نونبر 2007
 * المركز الوطني للتقويم والامتحانات — المملكة المغربية
 *
 * Usage (browser):
 *   <script src="js/cc-rules.js"></script>
 *   const avg = computeSubjectAverage('الرياضيات', gradesArray);
 */

// ─── Weight rules per base subject name ────────────────────────────
// examWeight + activityWeight = 1.0
// All keys are LOWERCASE for case-insensitive lookup.
// For subjects not listed here the default is 75% / 25%.

const CC_SUBJECT_WEIGHTS = {
    // ─── الفلسفة — 75% فروض + 25% أنشطة ───
    الفلسفة: { examWeight: 0.75, activityWeight: 0.25 },
    philosophie: { examWeight: 0.75, activityWeight: 0.25 },

    // ─── التاريخ والجغرافيا — 75% / 25% ───
    'التاريخ والجغرافيا': { examWeight: 0.75, activityWeight: 0.25 },
    'histoire et geographie': { examWeight: 0.75, activityWeight: 0.25 },
    'histoire geographie': { examWeight: 0.75, activityWeight: 0.25 },
    'histoire geo': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── الرياضيات — المعدل الحسابي للفروض فقط ───
    الرياضيات: { examWeight: 1.0, activityWeight: 0.0 },
    mathematiques: { examWeight: 1.0, activityWeight: 0.0 },
    mathematique: { examWeight: 1.0, activityWeight: 0.0 },
    maths: { examWeight: 1.0, activityWeight: 0.0 },
    math: { examWeight: 1.0, activityWeight: 0.0 },

    // ─── اللغة الفرنسية — 80% / 20% ───
    'اللغة الفرنسية': { examWeight: 0.8, activityWeight: 0.2 },
    الفرنسية: { examWeight: 0.8, activityWeight: 0.2 },
    'langue francaise': { examWeight: 0.8, activityWeight: 0.2 },
    'langue française': { examWeight: 0.8, activityWeight: 0.2 },
    francais: { examWeight: 0.8, activityWeight: 0.2 },
    français: { examWeight: 0.8, activityWeight: 0.2 },

    // ─── الفيزياء والكيمياء — 75% / 25% ───
    'الفيزياء والكيمياء': { examWeight: 0.75, activityWeight: 0.25 },
    الفيزياء: { examWeight: 0.75, activityWeight: 0.25 },
    'physique chimie': { examWeight: 0.75, activityWeight: 0.25 },
    'physique et chimie': { examWeight: 0.75, activityWeight: 0.25 },
    physique: { examWeight: 0.75, activityWeight: 0.25 },

    // ─── اللغة العربية — 75% / 25% ───
    'اللغة العربية': { examWeight: 0.75, activityWeight: 0.25 },
    العربية: { examWeight: 0.75, activityWeight: 0.25 },
    'langue arabe': { examWeight: 0.75, activityWeight: 0.25 },
    arabe: { examWeight: 0.75, activityWeight: 0.25 },

    // ─── علوم الحياة والأرض — 75% / 25% ───
    'علوم الحياة والأرض': { examWeight: 0.75, activityWeight: 0.25 },
    svt: { examWeight: 0.75, activityWeight: 0.25 },
    'sciences de la vie et de la terre': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── اللغة الأجنبية الثانية — 60% فروض + 40% أنشطة ───
    'اللغة الأجنبية الثانية': { examWeight: 0.6, activityWeight: 0.4 },
    الإنجليزية: { examWeight: 0.6, activityWeight: 0.4 },
    الانجليزية: { examWeight: 0.6, activityWeight: 0.4 },
    'اللغة الإنجليزية': { examWeight: 0.6, activityWeight: 0.4 },
    'اللغة الانجليزية': { examWeight: 0.6, activityWeight: 0.4 },
    anglais: { examWeight: 0.6, activityWeight: 0.4 },
    'langue anglaise': { examWeight: 0.6, activityWeight: 0.4 },
    english: { examWeight: 0.6, activityWeight: 0.4 },
    الإسبانية: { examWeight: 0.6, activityWeight: 0.4 },
    الاسبانية: { examWeight: 0.6, activityWeight: 0.4 },
    'اللغة الإسبانية': { examWeight: 0.6, activityWeight: 0.4 },
    'اللغة الاسبانية': { examWeight: 0.6, activityWeight: 0.4 },
    espagnol: { examWeight: 0.6, activityWeight: 0.4 },
    'langue espagnole': { examWeight: 0.6, activityWeight: 0.4 },
    الألمانية: { examWeight: 0.6, activityWeight: 0.4 },
    الالمانية: { examWeight: 0.6, activityWeight: 0.4 },
    'اللغة الألمانية': { examWeight: 0.6, activityWeight: 0.4 },
    'اللغة الالمانية': { examWeight: 0.6, activityWeight: 0.4 },
    allemand: { examWeight: 0.6, activityWeight: 0.4 },
    الإيطالية: { examWeight: 0.6, activityWeight: 0.4 },
    الايطالية: { examWeight: 0.6, activityWeight: 0.4 },
    'اللغة الإيطالية': { examWeight: 0.6, activityWeight: 0.4 },
    'اللغة الايطالية': { examWeight: 0.6, activityWeight: 0.4 },
    italien: { examWeight: 0.6, activityWeight: 0.4 },

    // ─── التربية الإسلامية — 75% / 25% ───
    'التربية الإسلامية': { examWeight: 0.75, activityWeight: 0.25 },
    'التربية الاسلامية': { examWeight: 0.75, activityWeight: 0.25 },
    'education islamique': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── الاجتماعيات — 75% / 25% ───
    الاجتماعيات: { examWeight: 0.75, activityWeight: 0.25 },

    // ─── التربية البدنية والرياضية ───
    'التربية البدنية': { examWeight: 0.75, activityWeight: 0.25 },
    'التربية البدنية والرياضية': { examWeight: 0.75, activityWeight: 0.25 },
    'education physique': { examWeight: 0.75, activityWeight: 0.25 },
    eps: { examWeight: 0.75, activityWeight: 0.25 },

    // ─── المعلوميات / الإعلاميات ───
    المعلوميات: { examWeight: 0.75, activityWeight: 0.25 },
    الإعلاميات: { examWeight: 0.75, activityWeight: 0.25 },
    الاعلاميات: { examWeight: 0.75, activityWeight: 0.25 },
    informatique: { examWeight: 0.75, activityWeight: 0.25 },

    // ─── علوم المهندس ───
    'علوم المهندس': { examWeight: 0.75, activityWeight: 0.25 },
    "sciences de l'ingenieur": { examWeight: 0.75, activityWeight: 0.25 },
    'sciences ingenieur': { examWeight: 0.75, activityWeight: 0.25 },
    si: { examWeight: 0.75, activityWeight: 0.25 },

    // ─── الاقتصاد والتدبير ───
    'الاقتصاد والتدبير': { examWeight: 0.75, activityWeight: 0.25 },
    الاقتصاد: { examWeight: 0.75, activityWeight: 0.25 },
    'المحاسبة والرياضيات المالية': { examWeight: 0.75, activityWeight: 0.25 },
    القانون: { examWeight: 0.75, activityWeight: 0.25 },
    economie: { examWeight: 0.75, activityWeight: 0.25 },
    'economie et gestion': { examWeight: 0.75, activityWeight: 0.25 },
    comptabilite: { examWeight: 0.75, activityWeight: 0.25 },
    droit: { examWeight: 0.75, activityWeight: 0.25 },

    // ─── الترجمة ───
    traduction: { examWeight: 0.75, activityWeight: 0.25 },

    // ─── المواظبة والسلوك — 100% نقطة واحدة ───
    'المواظبة والسلوك': { examWeight: 1.0, activityWeight: 0.0 },
    'المواظبة و السلوك': { examWeight: 1.0, activityWeight: 0.0 }
};

/** Default weights when subject is not found in the lookup table */
const CC_DEFAULT_WEIGHTS = { examWeight: 0.75, activityWeight: 0.25 };
let CC_SUBJECT_COEFFICIENT_OVERRIDES = [];
let subjectCoefficientMappingsPromise = null;

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Strip the exam/activity suffix from a subject name.
 * "الرياضيات (فرض 1)" → "الرياضيات"
 * "الرياضيات (الأنشطة المندمجة)" → "الرياضيات"
 */
function ccBaseSubject(subj) {
    return String(subj || '')
        .replace(/\s*\(\s*فرض\s*[\d٠-٩]+\s*\)\s*$/i, '')
        .replace(/\s*\(الأنشطة المندمجة\)\s*$/, '')
        .trim();
}

/**
 * Returns true if the raw subject string represents an integrated-activity grade.
 */
function ccIsActivity(subj) {
    return String(subj || '').includes('الأنشطة المندمجة');
}

/**
 * Look up the weight ratios for a given base subject name.
 * Uses case-insensitive matching to handle Latin names like "LANGUE FRANCAISE".
 * @param {string} baseSubjectName  e.g. "الرياضيات" or "LANGUE FRANCAISE"
 * @returns {{ examWeight: number, activityWeight: number }}
 */
function getSubjectWeights(baseSubjectName) {
    const name = String(baseSubjectName || '')
        .trim()
        .toLowerCase();
    return CC_SUBJECT_WEIGHTS[name] || CC_DEFAULT_WEIGHTS;
}

/**
 * Compute the weighted continuous-monitoring average for one subject.
 *
 * @param {string} baseSubjectName  The base subject name (without فرض / أنشطة suffix)
 * @param {Array<{subject: string, grade: number}>} grades
 *        All grade records (with original subject names) belonging to this base subject.
 * @returns {number}  The weighted average (0–20)
 */
function computeSubjectAverage(baseSubjectName, grades) {
    if (!grades || !grades.length) return 0;

    const weights = getSubjectWeights(baseSubjectName);

    // Separate exams from activities
    const examGrades = [];
    const activityGrades = [];

    grades.forEach((g) => {
        // Skip not-entered placeholders by inspecting the RAW value before
        // coercion (shared `isGradeEntered` discriminator). A genuine numeric
        // `0` / `'0'` is ENTERED and still counts. The existing
        // `Number.isFinite` guard is kept as a defensive backstop.
        if (typeof isGradeEntered === 'function' && !isGradeEntered(g.grade)) return;
        const val = Number(g.grade);
        if (!Number.isFinite(val)) return;
        if (ccIsActivity(g.subject)) {
            activityGrades.push(val);
        } else {
            examGrades.push(val);
        }
    });

    const examAvg = examGrades.length ? examGrades.reduce((s, v) => s + v, 0) / examGrades.length : 0;
    const activityAvg = activityGrades.length ? activityGrades.reduce((s, v) => s + v, 0) / activityGrades.length : 0;

    // If no activities exist, fall back to pure exam average
    if (!activityGrades.length) return examAvg;

    // If no exams exist (unlikely, but handle gracefully), use activity average
    if (!examGrades.length) return activityAvg;

    return examAvg * weights.examWeight + activityAvg * weights.activityWeight;
}

// ═══════════════════════════════════════════════════════════════════
// معاملات المواد حسب الشعبة والمستوى
// المرجع: الإطار المرجعي للمعاملات — وزارة التربية الوطنية
// ═══════════════════════════════════════════════════════════════════

/**
 * Coefficient tables per branch.
 * Key = branch code, Value = { subjectName: coefficient }
 * Subject names must be lowercase for case-insensitive lookup.
 */
const CC_BRANCH_COEFFICIENTS = {
    // ─── السنة الثانية بكالوريا ─────────────────────────────────
    '2BACSMA': {
        // علوم رياضية أ
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        الرياضيات: 9,
        'الفيزياء والكيمياء': 7,
        الفيزياء: 7,
        'علوم الحياة والأرض': 3,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '2BACSMB': {
        // علوم رياضية ب
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        الرياضيات: 9,
        'الفيزياء والكيمياء': 7,
        الفيزياء: 7,
        'علوم المهندس': 5,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '2BACSP': {
        // علوم فيزيائية
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        الرياضيات: 7,
        'الفيزياء والكيمياء': 7,
        الفيزياء: 7,
        'علوم الحياة والأرض': 5,
        'التربية البدنية': 4,
        'التربية البدنية والرياضية': 4
    },
    '2BACSVT': {
        // علوم الحياة والأرض
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        الرياضيات: 5,
        'الفيزياء والكيمياء': 5,
        الفيزياء: 5,
        'علوم الحياة والأرض': 9,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '2BACSEC': {
        // علوم الاقتصاد
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 3,
        'اللغة الفرنسية': 3,
        الفرنسية: 3,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        الرياضيات: 4,
        'الاقتصاد العام والإحصاء': 6,
        الاقتصاد: 6,
        'الاقتصاد والتنظيم الإداري للمقاولات': 3,
        'الاقتصاد والتنظيم الإداري': 3,
        'المحاسبة والرياضيات المالية': 4,
        المحاسبة: 4,
        القانون: 4,
        'معلوميات التدبير': 4,
        المعلوميات: 4,
        الاجتماعيات: 3,
        'التاريخ والجغرافيا': 3,
        'التربية البدنية': 4,
        'التربية البدنية والرياضية': 4
    },
    '2BACSGC': {
        // علوم التدبير المحاسباتي
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        الرياضيات: 5,
        'المحاسبة المعمقة': 9,
        المحاسبة: 9,
        'الاقتصاد والتنظيم الإداري': 5,
        الاقتصاد: 5,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '2BACLET': {
        // شعبة الآداب
        'اللغة العربية': 4,
        'التربية الإسلامية': 2,
        الفلسفة: 3,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        'التاريخ والجغرافيا': 3,
        الاجتماعيات: 3,
        الرياضيات: 2,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '2BACSH': {
        // شعبة العلوم الإنسانية
        'اللغة العربية': 3,
        'التربية الإسلامية': 2,
        الفلسفة: 4,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 3,
        الإنجليزية: 3,
        الانجليزية: 3,
        'اللغة الإنجليزية': 3,
        'اللغة الانجليزية': 3,
        التاريخ: 4,
        الجغرافيا: 4,
        'التاريخ والجغرافيا': 4,
        الاجتماعيات: 4,
        الرياضيات: 1,
        'التربية البدنية': 4,
        'التربية البدنية والرياضية': 4
    },
    '2BACAO': {
        // شعبة التعليم الأصيل
        'اللغة العربية': 3,
        'علوم القرآن والحديث': 5,
        'الفقه وأصوله': 5,
        'التوحيد والفكر الإسلامي': 4,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 2,
        'اللغة الفرنسية': 2,
        الفرنسية: 2,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        الرياضيات: 2,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },

    // ─── السنة الأولى بكالوريا ──────────────────────────────────
    '1BACSM': {
        // الأولى باكالوريا علوم رياضية
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        الرياضيات: 9,
        'الفيزياء والكيمياء': 7,
        الفيزياء: 7,
        'علوم الحياة والأرض': 3,
        الاجتماعيات: 2,
        'التاريخ والجغرافيا': 2,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '1BACSE': {
        // الأولى باكالوريا العلوم التجريبية
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        الرياضيات: 7,
        'الفيزياء والكيمياء': 7,
        الفيزياء: 7,
        'علوم الحياة والأرض': 7,
        الاجتماعيات: 2,
        'التاريخ والجغرافيا': 2,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '1BACSH': {
        // الأولى باكالوريا الآداب والعلوم الإنسانية
        'اللغة العربية': 4,
        'التربية الإسلامية': 2,
        الفلسفة: 4,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 4,
        الإنجليزية: 4,
        الانجليزية: 4,
        'اللغة الإنجليزية': 4,
        'اللغة الانجليزية': 4,
        الرياضيات: 1,
        الاجتماعيات: 4,
        'التاريخ والجغرافيا': 4,
        'علوم الحياة والأرض': 1,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },

    // ─── الجذع المشترك ────────────────────────────────────────
    TCS: {
        // الجذع المشترك العلمي
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 3,
        'اللغة الفرنسية': 3,
        الفرنسية: 3,
        'اللغة الأجنبية الثانية': 3,
        الإنجليزية: 3,
        الانجليزية: 3,
        'اللغة الإنجليزية': 3,
        'اللغة الانجليزية': 3,
        الرياضيات: 4,
        'الفيزياء والكيمياء': 4,
        الفيزياء: 4,
        'علوم الحياة والأرض': 4,
        الاجتماعيات: 2,
        'التاريخ والجغرافيا': 2,
        المعلوميات: 2,
        'التربية البدنية': 2,
        'التربية البدنية والرياضية': 2
    },
    TCLSH: {
        // جذع مشترك الآداب والعلوم الإنسانية
        'اللغة العربية': 4,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 4,
        'اللغة الفرنسية': 4,
        الفرنسية: 4,
        'اللغة الأجنبية الثانية': 3,
        الإنجليزية: 3,
        الانجليزية: 3,
        'اللغة الإنجليزية': 3,
        'اللغة الانجليزية': 3,
        الرياضيات: 2,
        الاجتماعيات: 4,
        'التاريخ والجغرافيا': 4,
        'علوم الحياة والأرض': 2,
        المعلوميات: 2,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    },
    '1BACSEG': {
        // الأولى باكالوريا علوم الاقتصاد والتدبير
        'اللغة العربية': 2,
        'التربية الإسلامية': 2,
        الفلسفة: 2,
        'اللغة الأجنبية الأولى': 3,
        'اللغة الفرنسية': 3,
        الفرنسية: 3,
        'اللغة الأجنبية الثانية': 2,
        الإنجليزية: 2,
        الانجليزية: 2,
        'اللغة الإنجليزية': 2,
        'اللغة الانجليزية': 2,
        الرياضيات: 4,
        'الاقتصاد العام والإحصاء': 6,
        الاقتصاد: 6,
        'الاقتصاد والتنظيم الإداري للمقاولات': 3,
        'الاقتصاد والتنظيم الإداري': 3,
        'المحاسبة والرياضيات المالية': 4,
        المحاسبة: 4,
        القانون: 1,
        'معلوميات التدبير': 1,
        المعلوميات: 1,
        الاجتماعيات: 3,
        'التاريخ والجغرافيا': 3,
        'التربية البدنية': 1,
        'التربية البدنية والرياضية': 1
    }
};

/**
 * Detect the branch code from a class name (section).
 * Examples:
 *   "2BACSPF-1"    → "2BACSP"
 *   "2BACSVTF-2"   → "2BACSVT"
 *   "2BACSMA-1"    → "2BACSMA"
 *   "2BACSMB-1"    → "2BACSMB"
 *   "2BACSECF-3"   → "2BACSEC"
 *   "2BACSGCF-1"   → "2BACSGC"
 *   "2BACLETF-1"   → "2BACLET"
 *   "2BACSHF-2"    → "2BACSH"
 *   "2BACOAF-1"    → "2BACAO"
 *
 * @param {string} className  The class/section name
 * @returns {string|null}  Branch code or null if unrecognized
 */
function detectBranch(className) {
    if (!className) return null;
    const c = String(className)
        .trim()
        .toUpperCase()
        .replace(/[\s\-_]+/g, '');

    // 2BAC branches — order matters (longest prefixes first)
    if (/^2BAC.*SM.*A/i.test(c)) return '2BACSMA';
    if (/^2BAC.*SM.*B/i.test(c)) return '2BACSMB';
    if (/^2BAC.*SVT/i.test(c)) return '2BACSVT';
    if (/^2BAC.*SP/i.test(c)) return '2BACSP';
    if (/^2BAC.*SGC/i.test(c)) return '2BACSGC';
    if (/^2BAC.*SEC/i.test(c) || /^2BACSE(?!G)/i.test(c)) return '2BACSEC';
    if (/^2BAC.*LET/i.test(c)) return '2BACLET';
    if (/^2BAC.*SH/i.test(c)) return '2BACSH';
    if (/^2BAC.*OA/i.test(c)) return '2BACAO';

    // Arabic class names
    if (/ثانية.*رياضي.*[اأ]/i.test(className)) return '2BACSMA';
    if (/ثانية.*رياضي.*ب/i.test(className)) return '2BACSMB';
    if (/ثانية.*فيزيائ/i.test(className)) return '2BACSP';
    if (/ثانية.*حياة|ثانية.*svt/i.test(className)) return '2BACSVT';
    if (/ثانية.*اقتصاد/i.test(className)) return '2BACSEC';
    if (/ثانية.*تدبير|ثانية.*محاسب/i.test(className)) return '2BACSGC';
    if (/ثانية.*آداب|ثانية.*أداب/i.test(className)) return '2BACLET';
    if (/ثانية.*إنسان|ثانية.*انسان/i.test(className)) return '2BACSH';
    if (/ثانية.*أصيل|ثانية.*اصيل/i.test(className)) return '2BACAO';

    // 1BAC branches
    if (/^1BAC.*SM/i.test(c)) return '1BACSM';
    if (/^1BAC.*SE[^G]/i.test(c) || /^1BACSE$/i.test(c)) return '1BACSE';
    if (/^1BAC.*SEG/i.test(c)) return '1BACSEG';
    if (/^1BAC.*SH/i.test(c)) return '1BACSH';

    // Arabic 1BAC names
    if (/أولى.*رياضي/i.test(className)) return '1BACSM';
    if (/أولى.*تجريب/i.test(className)) return '1BACSE';
    if (/أولى.*اقتصاد|أولى.*تدبير/i.test(className)) return '1BACSEG';
    if (/أولى.*آداب|أولى.*إنسان|أولى.*انسان/i.test(className)) return '1BACSH';

    // Tronc Commun
    if (/^TCS/i.test(c)) return 'TCS';
    if (/^TCL/i.test(c)) return 'TCLSH';

    // Arabic TC names
    if (/جذع.*علمي/i.test(className)) return 'TCS';
    if (/جذع.*آداب|جذع.*إنسان|جذع.*انسان/i.test(className)) return 'TCLSH';

    return null; // unrecognized branch
}

/**
 * Normalize Arabic text for comparison: strip diacritics, normalize alef/hamza/taa.
 * @param {string} s
 * @returns {string}
 */
function _normalizeArabic(s) {
    return String(s || '')
        .trim()
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
        .replace(/\u0629/g, '\u0647')
        .replace(/\u0649/g, '\u064A')
        .replace(/\u0640/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * French → Arabic subject name mapping.
 * Now provided globally by js/utils.js as SUBJECT_FR_TO_AR
 */

function coefficientContextValue(source, camelKey, snakeKey) {
    const value = source && (source[camelKey] ?? source[snakeKey]);
    return value == null || String(value).trim() === '' ? null : String(value).trim();
}

function inferQualifiantLevel(branch) {
    if (/^2BAC/i.test(branch || '')) return { code: '2BAC', label: 'السنة الثانية بكالوريا' };
    if (/^1BAC/i.test(branch || '')) return { code: '1BAC', label: 'السنة الأولى بكالوريا' };
    if (/^TC/i.test(branch || '')) return { code: 'TC', label: 'الجذع المشترك' };
    return { code: null, label: null };
}

function buildCoefficientContext(subjectName, normalizedName, branch, context) {
    const source = context || {};
    const level = inferQualifiantLevel(branch);
    const cycleCode =
        coefficientContextValue(source, 'cycleCode', 'cycle_code') ||
        (CC_BRANCH_COEFFICIENTS[branch] ? 'secondary_qualifiant' : null);
    const levelCode = coefficientContextValue(source, 'levelCode', 'level_code') || level.code;
    const levelLabel = coefficientContextValue(source, 'levelLabel', 'level_label') || level.label;
    const streamCode = coefficientContextValue(source, 'streamCode', 'stream_code') || branch || null;
    const streamLabel =
        coefficientContextValue(source, 'streamLabel', 'stream_label') ||
        coefficientContextValue(source, 'stream', 'stream_name') ||
        streamCode;

    return {
        cycleCode,
        cycleLabel:
            coefficientContextValue(source, 'cycleLabel', 'cycle_label') ||
            (cycleCode === 'secondary_qualifiant' ? 'الثانوي التأهيلي' : null),
        levelCode,
        levelLabel,
        streamCode,
        streamLabel,
        subject: coefficientContextValue(source, 'subject', 'subjectName') || String(subjectName || '').trim(),
        normalizedSubject: normalizedName || null,
        schoolYear:
            coefficientContextValue(source, 'schoolYear', 'school_year') ||
            coefficientContextValue(source, 'year', 'schoolYear')
    };
}

function createLocalMissingCoefficientError(context) {
    const display = (contextValue) => contextValue || 'غير محدد';
    const message = `لا يوجد معامل معتمد للمادة «${display(context.subject)}» ضمن السلك «${display(context.cycleLabel)}»، المستوى «${display(context.levelLabel)}»، المسلك «${display(context.streamLabel)}»، للسنة الدراسية «${display(context.schoolYear)}».`;
    const error = new Error(message);
    error.name = 'MissingSubjectCoefficientError';
    error.code = 'MISSING_SUBJECT_COEFFICIENT';
    error.userMessage = message;
    error.details = context;
    error.context = context;
    error.retryable = false;
    error.severity = 'error';
    error.classification = 'domain';
    error.missingCoefficient = true;
    return error;
}

function createMissingCoefficientError(context) {
    if (
        typeof SubjectCoefficientErrorContract !== 'undefined' &&
        typeof SubjectCoefficientErrorContract.createMissingSubjectCoefficientError === 'function'
    ) {
        return SubjectCoefficientErrorContract.createMissingSubjectCoefficientError(context);
    }
    return createLocalMissingCoefficientError(context);
}

function normalizeCoefficientSubject(subjectName) {
    const normalized =
        typeof normalizeSubjectName === 'function' ? normalizeSubjectName(subjectName) : ccBaseSubject(subjectName);
    return _normalizeArabic(normalized).toLowerCase();
}

function normalizeCoefficientOverride(entry) {
    const streamCode = String(entry?.streamCode || entry?.stream_code || '').trim().toUpperCase();
    const subject = String(entry?.subject || entry?.subjectName || '').trim();
    const coefficient = Number(entry?.coefficient);
    if (!streamCode || !subject || !Number.isFinite(coefficient) || coefficient <= 0 || coefficient > 20) return null;
    return {
        cycleCode: 'secondary_qualifiant',
        streamCode,
        subject,
        normalizedSubject: normalizeCoefficientSubject(subject),
        coefficient
    };
}

function setSubjectCoefficientOverrides(entries) {
    CC_SUBJECT_COEFFICIENT_OVERRIDES = (Array.isArray(entries) ? entries : [])
        .map(normalizeCoefficientOverride)
        .filter(Boolean);
    return CC_SUBJECT_COEFFICIENT_OVERRIDES.slice();
}

function findSubjectCoefficientOverride(subjectName, branch, context) {
    const cycleCode =
        coefficientContextValue(context, 'cycleCode', 'cycle_code') || (branch ? 'secondary_qualifiant' : null);
    if (cycleCode !== 'secondary_qualifiant') return null;

    const streamCode =
        coefficientContextValue(context, 'streamCode', 'stream_code') || String(branch || '').trim().toUpperCase();
    const normalizedSubject = normalizeCoefficientSubject(subjectName);
    return (
        CC_SUBJECT_COEFFICIENT_OVERRIDES.find(
            (entry) => entry.streamCode === streamCode.toUpperCase() && entry.normalizedSubject === normalizedSubject
        ) || null
    );
}

function findCoefficient(table, subjectName) {
    if (!table) return undefined;
    if (table[subjectName] !== undefined) return table[subjectName];

    const lowerName = subjectName.toLowerCase();
    const normalizedName = _normalizeArabic(subjectName).toLowerCase();
    for (const [key, coefficient] of Object.entries(table)) {
        if (key.toLowerCase() === lowerName || _normalizeArabic(key).toLowerCase() === normalizedName) {
            return coefficient;
        }
    }
    return undefined;
}

function resolveSubjectCoefficient(subjectName, branch, context) {
    const name =
        typeof normalizeSubjectName === 'function' ? normalizeSubjectName(subjectName) : ccBaseSubject(subjectName);
    const override = findSubjectCoefficientOverride(name, branch, context);
    if (override) {
        return {
            ok: true,
            success: true,
            coefficient: override.coefficient,
            subject: name,
            branch: branch || null,
            source: 'admin_override'
        };
    }

    const requestedCycle = coefficientContextValue(context, 'cycleCode', 'cycle_code');
    const table = requestedCycle && requestedCycle !== 'secondary_qualifiant' ? null : CC_BRANCH_COEFFICIENTS[branch];
    const coefficient = findCoefficient(table, name);
    if (coefficient !== undefined) {
        return { ok: true, success: true, coefficient, subject: name, branch: branch || null, source: 'rule' };
    }

    const details = buildCoefficientContext(subjectName, name, branch, context);
    const error = createMissingCoefficientError(details);
    return { ok: false, success: false, code: error.code, error, details: error.details, incomplete: true };
}

function getSubjectCoefficient(subjectName, branch, context) {
    const resolution = resolveSubjectCoefficient(subjectName, branch, context);
    if (!resolution.ok) throw resolution.error;
    return resolution.coefficient;
}

/**
 * Resolve the weighted general average without hiding missing coefficients.
 *
 * Formula: Σ(subjectAvg × coefficient) / Σ(coefficients)
 *
 * @param {Array<{subject: string, avg: number}>} subjectAverages
 *        Array of { subject, avg } where avg is the per-subject weighted average
 * @param {string|null} branch  Branch code from detectBranch()
 * @param {object|null} context  Cycle, level, stream, and school-year context
 * @returns {{ok: boolean, value?: number, error?: Error, missingCoefficients: Array<object>}}
 */
function createIncompleteCoefficientMetadata(missingCoefficients) {
    if (
        typeof SubjectCoefficientErrorContract !== 'undefined' &&
        typeof SubjectCoefficientErrorContract.createIncompleteResultMetadata === 'function'
    ) {
        return SubjectCoefficientErrorContract.createIncompleteResultMetadata(missingCoefficients);
    }
    return {
        status: 'incomplete',
        code: 'INCOMPLETE_RESULT_MISSING_SUBJECT_COEFFICIENT',
        reason: 'MISSING_SUBJECT_COEFFICIENT',
        officialExportBlocked: true,
        missingCoefficients
    };
}

function computeWeightedGeneralAverageResult(subjectAverages, branch, context) {
    if (!subjectAverages || !subjectAverages.length) {
        return {
            ok: true,
            success: true,
            value: 0,
            incomplete: false,
            missingCoefficients: [],
            metadata: { status: 'complete', officialExportBlocked: false, missingCoefficients: [] }
        };
    }

    let sumWeighted = 0;
    let sumCoeffs = 0;
    let firstMissingError = null;
    const missingCoefficients = [];

    for (const { subject, avg } of subjectAverages) {
        const resolution = resolveSubjectCoefficient(subject, branch, context);
        if (!resolution.ok) {
            firstMissingError = firstMissingError || resolution.error;
            missingCoefficients.push(resolution.details);
            continue;
        }
        sumWeighted += avg * resolution.coefficient;
        sumCoeffs += resolution.coefficient;
    }

    if (missingCoefficients.length) {
        const error = firstMissingError;
        return {
            ok: false,
            success: false,
            incomplete: true,
            code: error.code,
            error,
            details: error.details,
            missingCoefficients,
            metadata: createIncompleteCoefficientMetadata(missingCoefficients)
        };
    }

    return {
        ok: true,
        success: true,
        value: sumCoeffs > 0 ? sumWeighted / sumCoeffs : 0,
        incomplete: false,
        missingCoefficients: [],
        metadata: { status: 'complete', officialExportBlocked: false, missingCoefficients: [] }
    };
}

/**
 * Compute the weighted general average or throw the structured missing-coefficient error.
 *
 * @param {Array<{subject: string, avg: number}>} subjectAverages
 * @param {string|null} branch  Branch code from detectBranch()
 * @param {object|null} context  Cycle, level, stream, and school-year context
 * @returns {number} The weighted general average
 */
function computeWeightedGeneralAverage(subjectAverages, branch, context) {
    const averageResolution = computeWeightedGeneralAverageResult(subjectAverages, branch, context);
    if (!averageResolution.ok) throw averageResolution.error;
    return averageResolution.value;
}

async function ensureSubjectCoefficientMappings() {
    if (typeof window === 'undefined' || !window.api?.subjectCoefficients?.getAll) return [];
    if (subjectCoefficientMappingsPromise) return subjectCoefficientMappingsPromise;

    subjectCoefficientMappingsPromise = window.api.subjectCoefficients
        .getAll()
        .then((response) => {
            if (response?.success === false) throw new Error(response.error || 'تعذر تحميل معاملات المواد');
            return setSubjectCoefficientOverrides(response?.mappings || []);
        })
        .catch((error) => {
            subjectCoefficientMappingsPromise = null;
            throw error;
        });
    return subjectCoefficientMappingsPromise;
}
