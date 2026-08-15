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

// ─── Legacy weight fallback per base subject name ──────────────────
// examWeight + activityWeight = 1.0
// All keys are LOWERCASE for case-insensitive lookup.
// The active stage-rule payload overrides these values at runtime.

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

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Strip the exam/activity suffix from a subject name.
 * "الرياضيات (فرض 1)" → "الرياضيات"
 * "الرياضيات (الأنشطة المندمجة)" → "الرياضيات"
 * "الرياضيات — الفرض الأول" → "الرياضيات"
 */
function ccBaseSubject(subj) {
    return String(subj || '')
        .replace(/\s*\(\s*فرض\s*[\d٠-٩]+\s*\)\s*$/i, '')
        .replace(/\s*\(الأنشطة المندمجة\)\s*$/, '')
        .replace(/\s*[—–-]\s*(?:الفرض\s*(?:الأول|الاول|الثاني|الثالث|[\d٠-٩]+)|الأنشطة\s*المندمجة|التقييم(?:\s*[\d٠-٩]+)?)\s*$/i, '')
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
function getSubjectWeights(baseSubjectName, context) {
    const name = String(baseSubjectName || '')
        .trim()
        .toLowerCase();
    const ruleResolution = resolveSubjectWeights(baseSubjectName, context);
    if (ruleResolution && ruleResolution.ok) {
        return {
            examWeight: ruleResolution.examWeight,
            activityWeight: ruleResolution.activityWeight
        };
    }
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
function computeSubjectAverage(baseSubjectName, grades, context) {
    if (!grades || !grades.length) return 0;

    const weights = getSubjectWeights(baseSubjectName, context);

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

// ═══════════════════════════════════════════════════════════════════
// قواعد المرحلة (029) — المعاملات وعدد الفروض من النسخة الفعالة
// Subject coefficients and exam counts resolve against the ACTIVE rule set
// of the school year (window.api.stageRules.getActive). Resolution NEVER
// falls back to hardcoded constants: a missing rule marks results incomplete
// and blocks official export (stage-rules-error-contract.js).
// ═══════════════════════════════════════════════════════════════════

/**
 * Canonical subject-code → Arabic label map (thin renderer copy of the
 * main-side subject catalog; rows reference subject_code). Used only to
 * derive a code from a subject name when the caller passes no subjectCode.
 */
const STAGE_RULES_SUBJECT_CODE_LABELS = Object.freeze({
    ARABIC: 'اللغة العربية',
    FRENCH: 'اللغة الفرنسية',
    ENGLISH: 'اللغة الإنجليزية',
    SPANISH: 'اللغة الإسبانية',
    GERMAN: 'اللغة الألمانية',
    ITALIAN: 'اللغة الإيطالية',
    PORTUGUESE: 'اللغة البرتغالية',
    RUSSIAN: 'اللغة الروسية',
    CHINESE: 'اللغة الصينية',
    FOREIGN_LANGUAGE_1: 'اللغة الأجنبية الأولى',
    FOREIGN_LANGUAGE_2: 'اللغة الأجنبية الثانية',
    HISTORY_GEOGRAPHY: 'التاريخ والجغرافيا',
    MATH: 'الرياضيات',
    EARTH_SCIENCES: 'علوم الحياة والأرض',
    PHYSICS_CHEMISTRY: 'الفيزياء والكيمياء',
    ISLAMIC_EDUCATION: 'التربية الإسلامية',
    PHYSICAL_EDUCATION: 'التربية البدنية',
    PHYSICAL_EDUCATION_SPORT: 'التربية البدنية والرياضية',
    COMPUTER_SCIENCE: 'المعلوميات',
    PHILOSOPHY: 'الفلسفة',
    TRANSLATION: 'الترجمة',
    LAW: 'القانون',
    ACCOUNTING_FINANCE: 'المحاسبة والرياضيات المالية',
    ECONOMICS_STATS: 'الاقتصاد العام والإحصاء',
    ECONOMICS_MANAGEMENT: 'الاقتصاد والتنظيم الإداري للمقاولات',
    MANAGEMENT_COMPUTER_SCIENCE: 'معلوميات التدبير',
    ENGINEERING_SCIENCES: 'علوم المهندس',
    DEEP_ACCOUNTING: 'المحاسبة المعمقة',
    QURAN_HADITH: 'علوم القرآن والحديث',
    FIQH: 'الفقه وأصوله',
    TAWHID_ISLAMIC_THOUGHT: 'التوحيد والفكر الإسلامي',
    APPLIED_ARTS: 'الفنون التطبيقية',
    FINE_ARTS: 'الفنون الجميلة',
    ORIGINAL_EDUCATION: 'التعليم الأصيل',
    TECHNOLOGY: 'التكنولوجيا',
    TECHNICAL_SCIENCES: 'العلوم التقنية',
    ELECTRONICS: 'الإلكترونيك',
    ELECTROTECHNICS: 'الكهروتقنية',
    MECHANICS: 'الميكانيك',
    CIVIL_ENGINEERING: 'الهندسة المدنية',
    TOPOGRAPHY: 'الطوبوغرافيا',
    AGRICULTURE: 'الفلاحة',
    AGROFOOD: 'الصناعة الغذائية',
    TOURISM_HOSPITALITY: 'السياحة والفندقة',
    TEXTILE: 'النسيج',
    CONSTRUCTION: 'البناء والأشغال العامة',
    SEWING: 'الخياطة',
    HAIRDRESSING: 'الحلاقة والتجميل'
});

/** Reverse index: normalized Arabic label → subject_code. */
const STAGE_RULES_SUBJECT_CODES = (function () {
    const index = Object.create(null);
    for (const [code, label] of Object.entries(STAGE_RULES_SUBJECT_CODE_LABELS)) {
        index[_normalizeArabic(label).toLowerCase()] = code;
    }
    return Object.freeze(index);
})();

/** Active rule set of the current page: { schoolYear, ruleSet, rows }. */
let stageRuleSetCache = null;
let stageRuleSetLoadPromise = null;

/**
 * Coerce an IPC payload ({ ruleSet, rows: { coefficients, examCounts } }) or a
 * bare rows object into the normalized { ruleSet, rows } shape.
 */
function normalizeRuleSetPayload(input) {
    if (!input) return null;
    if (input.ruleSet === undefined && (Array.isArray(input.coefficients) || Array.isArray(input.examCounts))) {
        return {
            ruleSet: null,
            rows: {
                coefficients: input.coefficients || [],
                examCounts: input.examCounts || [],
                weights: input.weights || []
            }
        };
    }
    return {
        ruleSet: input.ruleSet || null,
        rows: {
            coefficients: Array.isArray(input.rows && input.rows.coefficients) ? input.rows.coefficients : [],
            examCounts: Array.isArray(input.rows && input.rows.examCounts) ? input.rows.examCounts : [],
            weights: Array.isArray(input.rows && input.rows.weights) ? input.rows.weights : []
        }
    };
}

/**
 * The rule-set payload to resolve against: context.ruleSet wins, otherwise the
 * per-page cache — and only for the SAME school year (never reused across
 * years). Returns null when no active set is available.
 */
function getActiveRuleSetPayload(context) {
    if (context && context.ruleSet) return normalizeRuleSetPayload(context.ruleSet);
    const schoolYear = context ? coefficientContextValue(context, 'schoolYear', 'school_year') : null;
    if (stageRuleSetCache && (schoolYear === null || stageRuleSetCache.schoolYear === schoolYear)) {
        return stageRuleSetCache;
    }
    return null;
}

/**
 * Load the ACTIVE rule set for a school year once per page
 * (replaces the legacy ensureSubjectCoefficientMappings). In Node tests the
 * window.api stub resolves the payload. Returns null when window.api is absent.
 */
async function ensureStageRuleSet(schoolYear) {
    if (typeof window === 'undefined' || !window.api?.stageRules?.getActive) return null;
    const year = String(schoolYear == null ? '' : schoolYear).trim();
    if (stageRuleSetCache && stageRuleSetCache.schoolYear === year) return stageRuleSetCache;
    if (stageRuleSetLoadPromise) return stageRuleSetLoadPromise;

    stageRuleSetLoadPromise = window.api.stageRules
        .getActive(year)
        .then((response) => {
            if (response && response.success === false) {
                throw new Error((response.error && response.error.message) || 'تعذر تحميل قواعد المرحلة');
            }
            const payload = normalizeRuleSetPayload(response || {});
            stageRuleSetCache = { schoolYear: year, ruleSet: payload.ruleSet, rows: payload.rows };
            return stageRuleSetCache;
        })
        .catch((error) => {
            stageRuleSetLoadPromise = null;
            throw error;
        });
    return stageRuleSetLoadPromise;
}

/**
 * Resolve the canonical subject_code for a lookup: context.subjectCode wins,
 * otherwise the normalized Arabic label (via the embedded catalog copy).
 * Returns null when the name cannot be mapped — never guessed.
 */
function resolveStageSubjectCode(subjectName, context) {
    const explicit = coefficientContextValue(context, 'subjectCode', 'subject_code');
    if (explicit) return String(explicit).trim().toUpperCase();
    const name =
        typeof normalizeSubjectName === 'function' ? normalizeSubjectName(subjectName) : ccBaseSubject(subjectName);
    return STAGE_RULES_SUBJECT_CODES[_normalizeArabic(name).toLowerCase()] || null;
}

function resolveSubjectWeights(subjectName, context) {
    const payload = getActiveRuleSetPayload(context);
    if (!payload || !payload.ruleSet) return null;
    const normalizedName =
        typeof normalizeSubjectName === 'function' ? normalizeSubjectName(subjectName) : ccBaseSubject(subjectName);
    const subjectCode = resolveStageSubjectCode(normalizedName, context);
    // S1 (multi-stage plan, G3): a missing cycle must fail closed — the engine
    // never guesses qualifiant when the caller did not pass a cycle explicitly.
    const cycleCode = coefficientContextValue(context, 'cycleCode', 'cycle_code');
    if (!cycleCode) return { ok: false, code: 'RULES_UNAVAILABLE' };
    if (!subjectCode) return { ok: false, code: 'MISSING_RULE' };
    const rows = payload.rows && Array.isArray(payload.rows.weights) ? payload.rows.weights : [];
    const matches = rows.filter(
        (row) =>
            String(row.subject_code || '').toUpperCase() === subjectCode.toUpperCase() &&
            (String(row.cycle_code || '') === cycleCode || String(row.cycle_code || '') === '*')
    );
    if (!matches.length) return { ok: false, code: 'MISSING_RULE' };
    const selected = matches.find((row) => String(row.source || '').toLowerCase() === 'custom') || matches[0];
    return {
        ok: true,
        source: String(selected.source || '').toLowerCase() === 'custom' ? 'admin_override' : 'rule',
        examWeight: Number(selected.exam_weight_bps) / 10000,
        activityWeight: Number(selected.activity_weight_bps) / 10000
    };
}

/** Precedence steps for coefficient rows. */
const STAGE_COEFFICIENT_LOOKUP_STEPS = [
    (k) => ({ cycle_code: k.cycle_code, level_code: k.level_code, stream_code: k.stream_code, subject_code: k.subject_code }),
    (k) => ({ cycle_code: k.cycle_code, level_code: k.level_code, stream_code: '*', subject_code: k.subject_code }),
    (k) => ({ cycle_code: k.cycle_code, level_code: '*', stream_code: k.stream_code, subject_code: k.subject_code }),
    (k) => ({ cycle_code: k.cycle_code, level_code: '*', stream_code: '*', subject_code: k.subject_code }),
    (k) => ({ cycle_code: '*', level_code: '*', stream_code: '*', subject_code: k.subject_code })
];

/** Precedence steps for exam-count rows: exact level → '*' → cycle default. */
const STAGE_EXAM_COUNT_LOOKUP_STEPS = [
    (k) => ({ cycle_code: k.cycle_code, level_code: k.level_code, subject_code: k.subject_code }),
    (k) => ({ cycle_code: k.cycle_code, level_code: '*', subject_code: k.subject_code }),
    (k) => ({ cycle_code: '*', level_code: '*', subject_code: k.subject_code })
];

function stageRuleDimsMatch(row, dims) {
    return Object.keys(dims).every((field) => {
        const rowValue = String(row[field] == null ? '' : row[field]).trim();
        const dimValue = String(dims[field] == null ? '' : dims[field]).trim();
        return field === 'stream_code' || field === 'subject_code'
            ? rowValue.toUpperCase() === dimValue.toUpperCase()
            : rowValue === dimValue;
    });
}

/** Within one key, the custom row beats the official row. */
function findBestStageRule(rows, dims) {
    const matches = rows.filter((row) => stageRuleDimsMatch(row, dims));
    if (!matches.length) return null;
    return matches.find((row) => String(row.source || '').trim().toLowerCase() === 'custom') || matches[0];
}

/** First precedence step yielding any row wins; null when none matches. */
function lookupStageRule(rows, steps, key) {
    if (!key.cycle_code || !key.subject_code) return null;
    for (const step of steps) {
        const dims = step(key);
        const rule = findBestStageRule(rows, dims);
        if (rule) return { rule, dims };
    }
    return null;
}

function createStageRulesUnavailableError(context) {
    const display = (contextValue) => contextValue || 'غير محدد';
    const message = `لا تتوفر نسخة قواعد فعالة للسنة الدراسية «${display(context.schoolYear)}».`;
    const error = new Error(message);
    error.name = 'StageRulesUnavailableError';
    error.code = 'RULES_UNAVAILABLE';
    error.userMessage = message;
    error.details = context;
    error.context = context;
    error.retryable = false;
    error.severity = 'error';
    error.classification = 'domain';
    return error;
}

function createMissingRuleError(context) {
    const display = (contextValue) => contextValue || 'غير محدد';
    const message = `لا توجد قاعدة معتمدة للمادة «${display(context.subject)}» ضمن السلك «${display(context.cycleLabel)}»، المستوى «${display(context.levelLabel)}»، المسلك «${display(context.streamLabel)}»، للسنة الدراسية «${display(context.schoolYear)}».`;
    const error = new Error(message);
    error.name = 'MissingStageRuleError';
    error.code = 'MISSING_RULE';
    error.userMessage = message;
    error.details = context;
    error.context = context;
    error.retryable = false;
    error.severity = 'error';
    error.classification = 'domain';
    error.missingCoefficient = true;
    return error;
}

/**
 * Resolve the coefficient of a subject against the active rule set of the
 * school year, using the 5-step precedence (exact → stream wildcard →
 * level wildcard → cycle default). NEVER falls back to hardcoded constants.
 *
 * @param {string} subjectName  Subject name (canonical label or alias)
 * @param {string|null} branch  Branch code from detectBranch()
 * @param {object|null} context { cycleCode, levelCode, streamCode, subjectCode, schoolYear, ruleSet }
 * @returns {{ok: boolean, success?: boolean, coefficient?: number, error?: Error, details?: object, incomplete?: boolean, source?: string, ruleSet?: object}}
 */
function resolveSubjectCoefficient(subjectName, branch, context) {
    const name =
        typeof normalizeSubjectName === 'function' ? normalizeSubjectName(subjectName) : ccBaseSubject(subjectName);
    const details = buildCoefficientContext(subjectName, name, branch, context);
    const payload = getActiveRuleSetPayload(context);
    if (!payload || !payload.ruleSet) {
        const error = createStageRulesUnavailableError(details);
        return { ok: false, success: false, code: error.code, error, details: error.details, incomplete: true };
    }

    const subjectCode = resolveStageSubjectCode(name, context);
    details.subjectCode = subjectCode;
    const rows = payload.rows && Array.isArray(payload.rows.coefficients) ? payload.rows.coefficients : [];
    const found = lookupStageRule(rows, STAGE_COEFFICIENT_LOOKUP_STEPS, {
        cycle_code: details.cycleCode,
        level_code: details.levelCode,
        stream_code: details.streamCode,
        subject_code: subjectCode
    });
    if (found) {
        return {
            ok: true,
            success: true,
            coefficient: Number(found.rule.coefficient),
            subject: name,
            branch: branch || null,
            source: String(found.rule.source || '').trim().toLowerCase() === 'custom' ? 'admin_override' : 'rule',
            ruleSet: payload.ruleSet ? { id: payload.ruleSet.id, revision: payload.ruleSet.revision } : null
        };
    }

    const error = createMissingRuleError(details);
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
    let metadata;
    if (
        typeof StageRulesErrorContract !== 'undefined' &&
        typeof StageRulesErrorContract.createIncompleteResultMetadata === 'function'
    ) {
        metadata = StageRulesErrorContract.createIncompleteResultMetadata(missingCoefficients);
    } else {
        metadata = {
            status: 'incomplete',
            code: 'MISSING_RULE',
            reason: 'missing_rule',
            officialExportBlocked: true,
            missingRules: Array.isArray(missingCoefficients) ? missingCoefficients : []
        };
    }
    // Compatibility key: existing gates read metadata.missingCoefficients.
    if (Array.isArray(missingCoefficients)) metadata.missingCoefficients = missingCoefficients;
    return metadata;
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

    const payload = getActiveRuleSetPayload(context);
    if (!payload || !payload.ruleSet) {
        const details = buildCoefficientContext(null, null, branch, context);
        const error = createStageRulesUnavailableError(details);
        return {
            ok: false,
            success: false,
            incomplete: true,
            code: error.code,
            error,
            details: error.details,
            missingCoefficients: [],
            metadata: { status: 'incomplete', code: error.code, officialExportBlocked: true }
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

/**
 * @deprecated 029 — legacy callers only (pages still awaiting migration).
 * The overrides/mappings channel was replaced by stage rule sets
 * (ensureStageRuleSet); this stub accepts and ignores legacy payloads.
 */
function setSubjectCoefficientOverrides() {}

/**
 * @deprecated 029 — legacy callers only (pages still awaiting migration).
 * Mappings are now rule-set rows loaded via ensureStageRuleSet; returns an
 * empty list without side effects so old pages keep working unchanged.
 */
async function ensureSubjectCoefficientMappings() {
    return [];
}

/**
 * @deprecated 029 — legacy callers only. Overrides were folded into custom
 * rule rows; resolves to an empty list.
 */
function getSubjectCoefficientOverrides() {
    return [];
}

/**
 * Resolve the exam count of a subject against the active rule set of the
 * school year: exact level → level wildcard ('*') → cycle default. Missing
 * rules produce MISSING_RULE; an unavailable rule set produces
 * RULES_UNAVAILABLE. No fallback to a hardcoded count.
 *
 * @param {string} subjectName  Subject name (canonical label or alias)
 * @param {string|null} branch  Branch code from detectBranch()
 * @param {object|null} context { cycleCode, levelCode, subjectCode, schoolYear, ruleSet }
 * @returns {{ok: boolean, success?: boolean, examCount?: number, error?: Error, details?: object, incomplete?: boolean, source?: string}}
 */
function resolveExamCount(subjectName, branch, context) {
    const name =
        typeof normalizeSubjectName === 'function' ? normalizeSubjectName(subjectName) : ccBaseSubject(subjectName);
    const details = buildCoefficientContext(subjectName, name, branch, context);
    const payload = getActiveRuleSetPayload(context);
    if (!payload || !payload.ruleSet) {
        const error = createStageRulesUnavailableError(details);
        return { ok: false, success: false, code: error.code, error, details: error.details, incomplete: true };
    }

    const subjectCode = resolveStageSubjectCode(name, context);
    details.subjectCode = subjectCode;
    const rows = payload.rows && Array.isArray(payload.rows.examCounts) ? payload.rows.examCounts : [];
    const found = lookupStageRule(rows, STAGE_EXAM_COUNT_LOOKUP_STEPS, {
        cycle_code: details.cycleCode,
        level_code: details.levelCode,
        stream_code: null,
        subject_code: subjectCode
    });
    if (found) {
        return {
            ok: true,
            success: true,
            examCount: Number(found.rule.exam_count),
            subject: name,
            branch: branch || null,
            source: String(found.rule.source || '').trim().toLowerCase() === 'custom' ? 'admin_override' : 'rule',
            ruleSet: payload.ruleSet ? { id: payload.ruleSet.id, revision: payload.ruleSet.revision } : null
        };
    }

    const error = createMissingRuleError(details);
    return { ok: false, success: false, code: error.code, error, details: error.details, incomplete: true };
}

/**
 * Resolve the exam count or throw the structured error (MISSING_RULE /
 * RULES_UNAVAILABLE).
 */
function getExamCount(subjectName, branch, context) {
    const resolution = resolveExamCount(subjectName, branch, context);
    if (!resolution.ok) throw resolution.error;
    return resolution.examCount;
}
