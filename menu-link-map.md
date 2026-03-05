# App Menu Link Map

Sources of truth:

- `js/sidebar.js` (sidebar structure)
- `js/utils.js` (role gating and page-visibility rules)

## Sidebar Tree

- Dashboard
    - `لوحة التحكم` -> `index.html`

- Students (`التلاميذ`)
    - `لوائح التلاميذ` -> `students-list.html`
    - `التسجيل والحركة العامة` -> `students-register.html`
    - `ترتيب الملفات` -> `students-files.html`
    - `حركية التلاميذ` -> `students-movement.html`
    - `ملف التلميذ` -> `student-profile-prototype.html`

- Teachers (`الأساتذة`)
    - `قائمة الأساتذة` -> `teachers-list.html`
    - `حصص الأساتذة` -> `teachers-schedule.html`
    - `غياب الأساتذة` -> `teachers-absence.html`
    - `مؤشرات الأداء` -> `teachers-performance.html`

- Timetable (`الاستعمال الزمني`)
    - `جداول الحصص` -> `timetable.html`
    - `جدول حصص التلاميذ` -> `timetable-students.html`
    - `جدول القاعات` -> `timetable-rooms.html`
    - `جدول حصص الأساتذة` -> `timetable-teachers.html`

- Assessment & Results (`التقويم والنتائج`)
    - `النتائج والإحصائيات` -> `grades.html`
    - `تحليل النتائج` -> `analytics.html`
    - `أوراق التنقيط` -> `grades-sheets.html`
    - `بيان النتائج` -> `grades-results.html`
    - `التلاميذ الحاصلون على صفر` -> `studentzero.html`
    - `الدعم التربوي` -> `student-support.html`

- Attendance (`الغياب والمتابعة`)
    - `ورقة الغياب الأسبوعية` -> `absence-weekly.html`
    - `غياب التلاميذ` -> `absence-students.html`
    - `مراسلة الأولياء` -> `absence-correspondence.html`
    - `إحصائيات الغياب` -> `absence-analytics.html`

- Exams Center (`مركز الامتحانات`)
    - `برمجة الامتحانات` -> `exams-schedule.html`
    - `توزيع الحراسة` -> `exams-proctors.html`
    - `قاعات الامتحان` -> `exams-rooms.html`
    - `تدبير الفروض` -> `exams-tests.html`

- Reports & Documents (`التقارير والوثائق`)
    - `الشواهد المدرسية` -> `reports-certificates.html`
    - `الاستمارات الإدارية` -> `reports-forms.html`
    - `تقارير الفصل` -> `reports-semester.html`

- Settings (`الإعدادات`)
    - `معلومات المؤسسة` -> `settings-school.html`
    - `استيراد البيانات` -> `settings-imports.html`
    - `المستخدمون` -> `settings-users.html`
    - `الترخيص والأجهزة` -> `settings-license.html`
    - `سجل النشاطات` -> `settings-logs.html`

- New Designs (`التصاميم الجديدة`)
    - `مركز التواصل (جديد)` -> `communication-center-prototype.html`

## Header Actions

- `دخول المشرف` -> `login.html?next=<current-page-or-blocked-target>`
- `خروج المشرف` (shown when admin session is active)
- `تفعيل البرنامج` (shown only in limited mode; opens activation modal)

## Access Modes

- Limited mode
    - Allowed pages: `index.html`, `students-list.html`, `settings-imports.html`, `login.html`
    - Sidebar clickable links: `students-list.html`, `settings-imports.html`
    - Admin-only pages are hidden: `settings-users.html`, `settings-license.html`

- Trial mode
    - Same page scope as licensed mode for navigation
    - Admin-only pages are hidden for non-admin users

- Licensed mode
    - All non-admin pages are available
    - Admin-only pages are hidden for non-admin users

- Admin mode
    - Full access to all pages and sections

## Page Visibility Notes

- A configurable visibility catalog is defined in `js/utils.js` and managed from `settings-users.html`.
- Pages with `completed: false` in the catalog are hidden by default for non-admin users:
    - `student-profile-prototype.html`
    - `communication-center-prototype.html`
- `grades-results.html` exists in the sidebar but is not currently part of the visibility catalog.
