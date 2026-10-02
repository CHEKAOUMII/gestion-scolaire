/**
 * Default exam (فرض) counts and level codes for app defaults settings.
 * Seeded into exam_count_rules with level_code = '*'.
 * Level-specific rows override the global default at lookup time.
 */

const DEFAULT_EXAM_COUNTS = [
    ['الرياضيات', 3],
    ['الفيزياء والكيمياء', 3],
    ['علوم الحياة والأرض', 2],
    ['اللغة العربية', 2],
    ['اللغة الفرنسية', 4],
    ['الفلسفة', 2],
    ['التاريخ والجغرافيا', 2],
    ['التربية الإسلامية', 2],
    ['الاجتماعيات', 2],
    ['اللغة الإنجليزية', 2],
    ['اللغة الأجنبية الثانية', 2],
    ['المعلوميات', 2],
    ['التربية البدنية', 2],
    ['الاقتصاد العام والإحصاء', 2],
    ['المحاسبة والرياضيات المالية', 2]
];

/** Pedagogical level codes with Arabic labels (single canonical source: js/shared/education/qualifiant-levels.js). */
const { QUALIFIANT_LEVELS } = require('../../js/shared/education/qualifiant-levels');
const LEVEL_CODES = QUALIFIANT_LEVELS;

/** Page labels for auto-discovered HTML files (mirrors PAGE_VISIBILITY_CATALOG). */
const PAGE_LABELS = {
    'index.html': { title: 'لوحة التحكم', group: 'عام' },
    'students-list.html': { title: 'لوائح التلاميذ', group: 'التلاميذ' },
    'students-register.html': { title: 'التسجيل والحركة العامة', group: 'التلاميذ' },
    'students-files.html': { title: 'ترتيب الملفات', group: 'التلاميذ' },
    'students-movement.html': { title: 'حركية التلاميذ', group: 'التلاميذ' },
    'students-status.html': { title: 'الوضعية الدراسية', group: 'التلاميذ' },
    'students-orientation.html': { title: 'التوجيه المدرسي', group: 'التلاميذ' },
    'student-profile-prototype.html': { title: 'ملف التلميذ', group: 'التلاميذ' },
    'teachers-list.html': { title: 'قائمة الأساتذة', group: 'تدبير الموظفين' },
    'inspectors.html': { title: 'المفتشون', group: 'تدبير الموظفين' },
    'teachers-schedule.html': { title: 'حصص الأساتذة', group: 'تدبير الموظفين' },
    'teachers-absence.html': { title: 'غياب الأساتذة', group: 'تدبير الموظفين' },
    'teachers-performance.html': { title: 'مؤشرات الأداء', group: 'تدبير الموظفين' },
    'staff-attendance.html': { title: 'الحضور والغياب', group: 'تدبير الموظفين' },
    'staff-daily-report.html': { title: 'التقرير اليومي', group: 'تدبير الموظفين' },
    'tracking-teachers-performance.html': { title: 'متابعة الأداء', group: 'تدبير الموظفين' },
    'compensation-tracking.html': { title: 'الحصص التعويضية', group: 'تدبير الموظفين' },
    'timetable.html': { title: 'جداول الحصص', group: 'الاستعمال الزمني' },
    'timetable-redistribution.html': { title: 'إعادة توزيع الأقسام', group: 'الاستعمال الزمني' },
    'timetable-students.html': { title: 'جدول حصص التلاميذ', group: 'الاستعمال الزمني' },
    'timetable-rooms.html': { title: 'جدول القاعات', group: 'الاستعمال الزمني' },
    'timetable-teachers.html': { title: 'جدول حصص الأساتذة', group: 'الاستعمال الزمني' },
    'results-hub.html': { title: 'مركز النتائج', group: 'التقويم والنتائج' },
    'analytics.html': { title: 'تحليل النتائج', group: 'التقويم والنتائج' },
    'grades-sheets.html': { title: 'أوراق التنقيط', group: 'التقويم والنتائج' },
    'grades-results.html': { title: 'بيان النتائج', group: 'التقويم والنتائج' },
    'exam-papers.html': { title: 'تتبع أوراق التحرير', group: 'التقويم والنتائج' },
    'student-support.html': { title: 'الدعم التربوي', group: 'التقويم والنتائج' },
    'support-sessions.html': { title: 'تتبع حصص الدعم', group: 'التقويم والنتائج' },
    'absence-weekly.html': { title: 'ورقة الغياب الأسبوعية', group: 'الغياب والمتابعة' },
    'absence-students.html': { title: 'غياب التلاميذ', group: 'الغياب والمتابعة' },
    'absence-correspondence.html': { title: 'مراسلة الأولياء', group: 'الغياب والمتابعة' },
    'absence-analytics.html': { title: 'إحصائيات الغياب', group: 'الغياب والمتابعة' },
    'exams-schedule.html': { title: 'برمجة الامتحانات', group: 'مركز الامتحانات' },
    'exams-proctors.html': { title: 'توزيع الحراسة', group: 'مركز الامتحانات' },
    'exams-rooms.html': { title: 'ملخص تكليفات الأساتذة', group: 'مركز الامتحانات' },
    'exams-tests.html': { title: 'تدبير الفروض', group: 'مركز الامتحانات' },
    'reports-certificates.html': { title: 'الشواهد المدرسية', group: 'التقارير والوثائق' },
    'reports-forms.html': { title: 'الاستمارات الإدارية', group: 'التقارير والوثائق' },
    'reports-semester.html': { title: 'تقارير الفصل', group: 'التقارير والوثائق' },
    'settings-school.html': { title: 'معلومات المؤسسة', group: 'الإعدادات' },
    'settings-imports.html': { title: 'استيراد البيانات', group: 'الإعدادات' },
    'settings-users.html': { title: 'المستخدمون', group: 'الإعدادات' },
    'settings-defaults.html': { title: 'إعدادات التطبيق', group: 'الإعدادات' },
    'app-admin.html': { title: 'إدارة التطبيق', group: 'الإعدادات' },
    'settings-license.html': { title: 'الترخيص والأجهزة', group: 'الإعدادات' },
    'settings-logs.html': { title: 'سجل النشاطات', group: 'الإعدادات' },
    'settings-sync.html': { title: 'المزامنة السحابية', group: 'الإعدادات' },
    'communication-center-prototype.html': { title: 'مركز التواصل (جديد)', group: 'التصاميم الجديدة' }
};

const EXCLUDED_HTML_PAGES = new Set(['login.html', 'setup.html']);

module.exports = {
    DEFAULT_EXAM_COUNTS,
    LEVEL_CODES,
    // Per-cycle catalog symmetry (2026-08-01-primary-stage-catalogs.md, S2):
    // the qualifiant catalog keeps its legacy name for appDefaults compatibility.
    QUALIFIANT_LEVEL_CODES: LEVEL_CODES,
    PAGE_LABELS,
    EXCLUDED_HTML_PAGES
};
