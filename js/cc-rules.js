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
    'الفلسفة': { examWeight: 0.75, activityWeight: 0.25 },
    'philosophie': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── التاريخ والجغرافيا — 75% / 25% ───
    'التاريخ والجغرافيا': { examWeight: 0.75, activityWeight: 0.25 },
    'histoire et geographie': { examWeight: 0.75, activityWeight: 0.25 },
    'histoire geographie': { examWeight: 0.75, activityWeight: 0.25 },
    'histoire geo': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── الرياضيات — المعدل الحسابي للفروض فقط ───
    'الرياضيات': { examWeight: 1.00, activityWeight: 0.00 },
    'mathematiques': { examWeight: 1.00, activityWeight: 0.00 },
    'mathematique': { examWeight: 1.00, activityWeight: 0.00 },
    'maths': { examWeight: 1.00, activityWeight: 0.00 },
    'math': { examWeight: 1.00, activityWeight: 0.00 },

    // ─── اللغة الفرنسية — 80% / 20% ───
    'اللغة الفرنسية': { examWeight: 0.80, activityWeight: 0.20 },
    'الفرنسية': { examWeight: 0.80, activityWeight: 0.20 },
    'langue francaise': { examWeight: 0.80, activityWeight: 0.20 },
    'langue française': { examWeight: 0.80, activityWeight: 0.20 },
    'francais': { examWeight: 0.80, activityWeight: 0.20 },
    'français': { examWeight: 0.80, activityWeight: 0.20 },

    // ─── الفيزياء والكيمياء — 75% / 25% ───
    'الفيزياء والكيمياء': { examWeight: 0.75, activityWeight: 0.25 },
    'الفيزياء': { examWeight: 0.75, activityWeight: 0.25 },
    'physique chimie': { examWeight: 0.75, activityWeight: 0.25 },
    'physique et chimie': { examWeight: 0.75, activityWeight: 0.25 },
    'physique': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── اللغة العربية — 75% / 25% ───
    'اللغة العربية': { examWeight: 0.75, activityWeight: 0.25 },
    'العربية': { examWeight: 0.75, activityWeight: 0.25 },
    'langue arabe': { examWeight: 0.75, activityWeight: 0.25 },
    'arabe': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── علوم الحياة والأرض — 75% / 25% ───
    'علوم الحياة والأرض': { examWeight: 0.75, activityWeight: 0.25 },
    'svt': { examWeight: 0.75, activityWeight: 0.25 },
    'sciences de la vie et de la terre': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── اللغة الأجنبية الثانية — 60% فروض + 40% أنشطة ───
    'اللغة الأجنبية الثانية': { examWeight: 0.60, activityWeight: 0.40 },
    'الإنجليزية': { examWeight: 0.60, activityWeight: 0.40 },
    'الانجليزية': { examWeight: 0.60, activityWeight: 0.40 },
    'اللغة الإنجليزية': { examWeight: 0.60, activityWeight: 0.40 },
    'اللغة الانجليزية': { examWeight: 0.60, activityWeight: 0.40 },
    'anglais': { examWeight: 0.60, activityWeight: 0.40 },
    'langue anglaise': { examWeight: 0.60, activityWeight: 0.40 },
    'english': { examWeight: 0.60, activityWeight: 0.40 },
    'الإسبانية': { examWeight: 0.60, activityWeight: 0.40 },
    'الاسبانية': { examWeight: 0.60, activityWeight: 0.40 },
    'اللغة الإسبانية': { examWeight: 0.60, activityWeight: 0.40 },
    'اللغة الاسبانية': { examWeight: 0.60, activityWeight: 0.40 },
    'espagnol': { examWeight: 0.60, activityWeight: 0.40 },
    'langue espagnole': { examWeight: 0.60, activityWeight: 0.40 },
    'الألمانية': { examWeight: 0.60, activityWeight: 0.40 },
    'الالمانية': { examWeight: 0.60, activityWeight: 0.40 },
    'اللغة الألمانية': { examWeight: 0.60, activityWeight: 0.40 },
    'اللغة الالمانية': { examWeight: 0.60, activityWeight: 0.40 },
    'allemand': { examWeight: 0.60, activityWeight: 0.40 },
    'الإيطالية': { examWeight: 0.60, activityWeight: 0.40 },
    'الايطالية': { examWeight: 0.60, activityWeight: 0.40 },
    'اللغة الإيطالية': { examWeight: 0.60, activityWeight: 0.40 },
    'اللغة الايطالية': { examWeight: 0.60, activityWeight: 0.40 },
    'italien': { examWeight: 0.60, activityWeight: 0.40 },

    // ─── التربية الإسلامية — 75% / 25% ───
    'التربية الإسلامية': { examWeight: 0.75, activityWeight: 0.25 },
    'التربية الاسلامية': { examWeight: 0.75, activityWeight: 0.25 },
    'education islamique': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── الاجتماعيات — 75% / 25% ───
    'الاجتماعيات': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── التربية البدنية والرياضية ───
    'التربية البدنية': { examWeight: 0.75, activityWeight: 0.25 },
    'التربية البدنية والرياضية': { examWeight: 0.75, activityWeight: 0.25 },
    'education physique': { examWeight: 0.75, activityWeight: 0.25 },
    'eps': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── المعلوميات / الإعلاميات ───
    'المعلوميات': { examWeight: 0.75, activityWeight: 0.25 },
    'الإعلاميات': { examWeight: 0.75, activityWeight: 0.25 },
    'الاعلاميات': { examWeight: 0.75, activityWeight: 0.25 },
    'informatique': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── علوم المهندس ───
    'علوم المهندس': { examWeight: 0.75, activityWeight: 0.25 },
    "sciences de l'ingenieur": { examWeight: 0.75, activityWeight: 0.25 },
    'sciences ingenieur': { examWeight: 0.75, activityWeight: 0.25 },
    'si': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── الاقتصاد والتدبير ───
    'الاقتصاد والتدبير': { examWeight: 0.75, activityWeight: 0.25 },
    'الاقتصاد': { examWeight: 0.75, activityWeight: 0.25 },
    'المحاسبة والرياضيات المالية': { examWeight: 0.75, activityWeight: 0.25 },
    'القانون': { examWeight: 0.75, activityWeight: 0.25 },
    'economie': { examWeight: 0.75, activityWeight: 0.25 },
    'economie et gestion': { examWeight: 0.75, activityWeight: 0.25 },
    'comptabilite': { examWeight: 0.75, activityWeight: 0.25 },
    'droit': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── الترجمة ───
    'traduction': { examWeight: 0.75, activityWeight: 0.25 },

    // ─── المواظبة والسلوك — 100% نقطة واحدة ───
    'المواظبة والسلوك': { examWeight: 1.00, activityWeight: 0.00 },
    'المواظبة و السلوك': { examWeight: 1.00, activityWeight: 0.00 },
};

/** Default weights when subject is not found in the lookup table */
const CC_DEFAULT_WEIGHTS = { examWeight: 0.75, activityWeight: 0.25 };

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
    const name = String(baseSubjectName || '').trim().toLowerCase();
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

    grades.forEach(g => {
        const val = Number(g.grade);
        if (!Number.isFinite(val)) return;
        if (ccIsActivity(g.subject)) {
            activityGrades.push(val);
        } else {
            examGrades.push(val);
        }
    });

    const examAvg = examGrades.length
        ? examGrades.reduce((s, v) => s + v, 0) / examGrades.length
        : 0;
    const activityAvg = activityGrades.length
        ? activityGrades.reduce((s, v) => s + v, 0) / activityGrades.length
        : 0;

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
    '2BACSMA': { // علوم رياضية أ
        'اللغة العربية': 2, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'الرياضيات': 9, 'الفيزياء والكيمياء': 7, 'الفيزياء': 7,
        'علوم الحياة والأرض': 3, 'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
    },
    '2BACSMB': { // علوم رياضية ب
        'اللغة العربية': 2, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'الرياضيات': 9, 'الفيزياء والكيمياء': 7, 'الفيزياء': 7,
        'علوم المهندس': 5, 'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
    },
    '2BACSP': { // علوم فيزيائية
        'اللغة العربية': 2, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'الرياضيات': 7, 'الفيزياء والكيمياء': 7, 'الفيزياء': 7,
        'علوم الحياة والأرض': 5, 'التربية البدنية': 4, 'التربية البدنية والرياضية': 4
    },
    '2BACSVT': { // علوم الحياة والأرض
        'اللغة العربية': 2, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'الرياضيات': 5, 'الفيزياء والكيمياء': 5, 'الفيزياء': 5,
        'علوم الحياة والأرض': 9, 'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
    },
    '2BACSEC': { // علوم الاقتصاد
        'اللغة العربية': 2, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 3, 'اللغة الفرنسية': 3, 'الفرنسية': 3,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'الرياضيات': 4, 'الاقتصاد العام والإحصاء': 6, 'الاقتصاد': 6,
        'الاقتصاد والتنظيم الإداري للمقاولات': 3, 'الاقتصاد والتنظيم الإداري': 3,
        'المحاسبة والرياضيات المالية': 4, 'المحاسبة': 4,
        'القانون': 4, 'معلوميات التدبير': 4, 'المعلوميات': 4,
        'الاجتماعيات': 3, 'التاريخ والجغرافيا': 3,
        'التربية البدنية': 4, 'التربية البدنية والرياضية': 4
    },
    '2BACSGC': { // علوم التدبير المحاسباتي
        'اللغة العربية': 2, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'الرياضيات': 5, 'المحاسبة المعمقة': 9, 'المحاسبة': 9,
        'الاقتصاد والتنظيم الإداري': 5, 'الاقتصاد': 5,
        'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
    },
    '2BACLET': { // شعبة الآداب
        'اللغة العربية': 4, 'التربية الإسلامية': 2, 'الفلسفة': 3,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'التاريخ والجغرافيا': 3, 'الاجتماعيات': 3,
        'الرياضيات': 2, 'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
    },
    '2BACSH': { // شعبة العلوم الإنسانية
        'اللغة العربية': 3, 'التربية الإسلامية': 2, 'الفلسفة': 4,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 3, 'الإنجليزية': 3, 'الانجليزية': 3,
        'اللغة الإنجليزية': 3, 'اللغة الانجليزية': 3,
        'التاريخ': 4, 'الجغرافيا': 4, 'التاريخ والجغرافيا': 4, 'الاجتماعيات': 4,
        'الرياضيات': 1, 'التربية البدنية': 4, 'التربية البدنية والرياضية': 4
    },
    '2BACAO': { // شعبة التعليم الأصيل
        'اللغة العربية': 3, 'علوم القرآن والحديث': 5, 'الفقه وأصوله': 5,
        'التوحيد والفكر الإسلامي': 4, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 2, 'اللغة الفرنسية': 2, 'الفرنسية': 2,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'الرياضيات': 2, 'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
    },

    // ─── السنة الأولى بكالوريا ──────────────────────────────────
    '1BACSM': { // الأولى باكالوريا علوم رياضية
        'اللغة العربية': 2, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'الرياضيات': 9, 'الفيزياء والكيمياء': 7, 'الفيزياء': 7,
        'علوم الحياة والأرض': 3, 'الاجتماعيات': 2,
        'التاريخ والجغرافيا': 2, 'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
    },
    '1BACSE': { // الأولى باكالوريا العلوم التجريبية
        'اللغة العربية': 2, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'الرياضيات': 7, 'الفيزياء والكيمياء': 7, 'الفيزياء': 7,
        'علوم الحياة والأرض': 7, 'الاجتماعيات': 2,
        'التاريخ والجغرافيا': 2, 'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
    },
    '1BACSH': { // الأولى باكالوريا الآداب والعلوم الإنسانية
        'اللغة العربية': 4, 'التربية الإسلامية': 2, 'الفلسفة': 4,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 4, 'الإنجليزية': 4, 'الانجليزية': 4,
        'اللغة الإنجليزية': 4, 'اللغة الانجليزية': 4,
        'الرياضيات': 1, 'الاجتماعيات': 4,
        'التاريخ والجغرافيا': 4, 'علوم الحياة والأرض': 1,
        'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
    },

    // ─── الجذع المشترك ────────────────────────────────────────
    'TCS': { // الجذع المشترك العلمي
        'اللغة العربية': 2, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 3, 'اللغة الفرنسية': 3, 'الفرنسية': 3,
        'اللغة الأجنبية الثانية': 3, 'الإنجليزية': 3, 'الانجليزية': 3,
        'اللغة الإنجليزية': 3, 'اللغة الانجليزية': 3,
        'الرياضيات': 4, 'الفيزياء والكيمياء': 4, 'الفيزياء': 4,
        'علوم الحياة والأرض': 4, 'الاجتماعيات': 2,
        'التاريخ والجغرافيا': 2, 'المعلوميات': 2,
        'التربية البدنية': 2, 'التربية البدنية والرياضية': 2
    },
    'TCLSH': { // جذع مشترك الآداب والعلوم الإنسانية
        'اللغة العربية': 4, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 4, 'اللغة الفرنسية': 4, 'الفرنسية': 4,
        'اللغة الأجنبية الثانية': 3, 'الإنجليزية': 3, 'الانجليزية': 3,
        'اللغة الإنجليزية': 3, 'اللغة الانجليزية': 3,
        'الرياضيات': 2, 'الاجتماعيات': 4,
        'التاريخ والجغرافيا': 4, 'علوم الحياة والأرض': 2,
        'المعلوميات': 2,
        'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
    },
    '1BACSEG': { // الأولى باكالوريا علوم الاقتصاد والتدبير
        'اللغة العربية': 2, 'التربية الإسلامية': 2, 'الفلسفة': 2,
        'اللغة الأجنبية الأولى': 3, 'اللغة الفرنسية': 3, 'الفرنسية': 3,
        'اللغة الأجنبية الثانية': 2, 'الإنجليزية': 2, 'الانجليزية': 2,
        'اللغة الإنجليزية': 2, 'اللغة الانجليزية': 2,
        'الرياضيات': 4, 'الاقتصاد العام والإحصاء': 6, 'الاقتصاد': 6,
        'الاقتصاد والتنظيم الإداري للمقاولات': 3, 'الاقتصاد والتنظيم الإداري': 3,
        'المحاسبة والرياضيات المالية': 4, 'المحاسبة': 4,
        'القانون': 1, 'معلوميات التدبير': 1, 'المعلوميات': 1,
        'الاجتماعيات': 3, 'التاريخ والجغرافيا': 3,
        'التربية البدنية': 1, 'التربية البدنية والرياضية': 1
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
    const c = String(className).trim().toUpperCase().replace(/[\s\-_]+/g, '');

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
    return String(s || '').trim()
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
 * Keys are UPPERCASE French names (as they appear in the imported data).
 */
const SUBJECT_FR_TO_AR = {
    'MATHEMATIQUES': 'الرياضيات',
    'MATH': 'الرياضيات',
    'MATHS': 'الرياضيات',
    'PHYSIQUE CHIMIE': 'الفيزياء والكيمياء',
    'PHYSIQUE-CHIMIE': 'الفيزياء والكيمياء',
    'PHYSIQUE': 'الفيزياء والكيمياء',
    'SCIENCES DE LA VIE ET DE LA TERRE': 'علوم الحياة والأرض',
    'SVT': 'علوم الحياة والأرض',
    'SCIENCES NATURELLES': 'علوم الحياة والأرض',
    'PHILOSOPHIE': 'الفلسفة',
    'PHILO': 'الفلسفة',
    'LANGUE ARABE': 'اللغة العربية',
    'ARABE': 'اللغة العربية',
    'LANGUE FRANCAISE': 'اللغة الفرنسية',
    'FRANCAIS': 'اللغة الفرنسية',
    'FRANCAISE': 'اللغة الفرنسية',
    'LANGUE FRANÇAISE': 'اللغة الفرنسية',
    'FRANÇAIS': 'اللغة الفرنسية',
    'LANGUE ANGLAISE': 'اللغة الإنجليزية',
    'ANGLAIS': 'اللغة الإنجليزية',
    'ANGLAISE': 'اللغة الإنجليزية',
    'LANGUE ANGLAIS': 'اللغة الإنجليزية',
    'ENGLISH': 'اللغة الإنجليزية',
    'EDUCATION ISLAMIQUE': 'التربية الإسلامية',
    'INSTRUCTION ISLAMIQUE': 'التربية الإسلامية',
    'ISLAMIQUE': 'التربية الإسلامية',
    'EDUCATION PHYSIQUE': 'التربية البدنية',
    'EDUCATION PHYSIQUE ET SPORTIVE': 'التربية البدنية والرياضية',
    'EPS': 'التربية البدنية',
    'SPORT': 'التربية البدنية',
    'HISTOIRE GEOGRAPHIE': 'التاريخ والجغرافيا',
    'HISTOIRE-GEOGRAPHIE': 'التاريخ والجغرافيا',
    'HISTOIRE ET GEOGRAPHIE': 'التاريخ والجغرافيا',
    'HISTOIRE': 'التاريخ والجغرافيا',
    'GEOGRAPHIE': 'التاريخ والجغرافيا',
    'INFORMATIQUE': 'المعلوميات',
    'ECONOMIE': 'الاقتصاد والتدبير',
    'ECONOMIE GENERALE': 'الاقتصاد والتدبير',
    'ECONOMIE ET ORGANISATION': 'الاقتصاد والتدبير',
    'COMPTABILITE': 'المحاسبة والرياضيات المالية',
    'COMPTABILITE ET MATHEMATIQUES FINANCIERES': 'المحاسبة والرياضيات المالية',
    'DROIT': 'القانون',
    'SCIENCES ECONOMIQUES': 'الاقتصاد والتدبير',
    'TRADUCTION': 'الترجمة',
    'SCIENCES DE L\'INGENIEUR': 'علوم المهندس',
    'SCIENCES INGENIEURS': 'علوم المهندس',
    'SI': 'علوم المهندس',
    'SCIENCES MATHEMATIQUES': 'الرياضيات',
    'ARTS APPLIQUES': 'الفنون التطبيقية',
    'DESSIN': 'الفنون التطبيقية',
};

function getSubjectCoefficient(subjectName, branch) {
    if (!branch || !CC_BRANCH_COEFFICIENTS[branch]) return 1;
    const table = CC_BRANCH_COEFFICIENTS[branch];
    let name = String(subjectName || '').trim();

    // 0. French → Arabic translation
    const upper = name.toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
        .replace(/[_-]+/g, ' ').trim();
    if (SUBJECT_FR_TO_AR[upper]) {
        name = SUBJECT_FR_TO_AR[upper];
    } else {
        // Partial match for French names
        for (const [frKey, arVal] of Object.entries(SUBJECT_FR_TO_AR)) {
            if (upper.includes(frKey) || frKey.includes(upper)) {
                name = arVal;
                break;
            }
        }
    }

    // 1. Direct lookup
    if (table[name] !== undefined) return table[name];
    // 2. Case-insensitive fallback
    const lower = name.toLowerCase();
    for (const [key, val] of Object.entries(table)) {
        if (key.toLowerCase() === lower) return val;
    }
    // 3. Arabic normalized comparison
    const normName = _normalizeArabic(name);
    for (const [key, val] of Object.entries(table)) {
        if (_normalizeArabic(key) === normName) return val;
    }
    // 4. Substring / contains check
    for (const [key, val] of Object.entries(table)) {
        const normKey = _normalizeArabic(key);
        if (normKey.includes(normName) || normName.includes(normKey)) return val;
    }
    return 1; // default coefficient for unlisted subjects
}

/**
 * Compute the weighted general average for a student.
 *
 * Formula: Σ(subjectAvg × coefficient) / Σ(coefficients)
 *
 * @param {Array<{subject: string, avg: number}>} subjectAverages
 *        Array of { subject, avg } where avg is the per-subject weighted average
 * @param {string|null} branch  Branch code from detectBranch()
 * @returns {number}  The weighted general average
 */
function computeWeightedGeneralAverage(subjectAverages, branch) {
    if (!subjectAverages || !subjectAverages.length) return 0;

    let sumWeighted = 0;
    let sumCoeffs = 0;

    subjectAverages.forEach(({ subject, avg }) => {
        const coeff = getSubjectCoefficient(subject, branch);
        sumWeighted += avg * coeff;
        sumCoeffs += coeff;
    });

    return sumCoeffs > 0 ? sumWeighted / sumCoeffs : 0;
}
