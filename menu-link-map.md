# App Menu Map

Source of truth:

- `js/sidebar.js` for the rendered sidebar structure
- `js/utils.js` for access control and admin-controlled page visibility

## Sidebar Tree

- Dashboard
    - `لوحة التحكم` -> `index.html`

- Student Management (`إدارة الطلاب`)
    - `التلاميذ`
        - `لوائح التلاميذ` -> `students-list.html`
        - `التسجيل والحركة العامة` -> `students-register.html`
        - `ترتيب الملفات` -> `students-files.html`
        - `حركية التلاميذ` -> `students-movement.html`
        - `ملف التلميذ` -> `student-profile-prototype.html`
        - `الوضعية الدراسية` -> `students-status.html`
        - `التوجيه المدرسي` -> `students-orientation.html`
    - `تدبير الموظفين`
        - `قائمة الأساتذة` -> `teachers-list.html`
        - `حصص الأساتذة` -> `teachers-schedule.html`
        - `غياب الأساتذة` -> `teachers-absence.html`
        - `مؤشرات الأداء` -> `teachers-performance.html`
        - `الحضور والغياب` -> `staff-attendance.html`
        - `التقرير اليومي` -> `staff-daily-report.html`
        - `الحصص التعويضية` -> `compensation-tracking.html`

- Academic Organization (`التنظيم الدراسي`)
    - `تدبير الحصص`
        - `جدول حصص الأساتذة` -> `timetable.html`
        - `جدول حصص التلاميذ` -> `timetable-students.html`
        - `جدول حصص القاعات` -> `timetable-rooms.html`
        - `إعادة توزيع الأقسام` -> `timetable-redistribution.html`
        - `استعمال الزمن الأسبوعي` -> `timetable-teachers.html`
    - `التقويم والنتائج`
        - `مركز النتائج` -> `results-hub.html`
        - `تحليل النتائج` -> `analytics.html`
        - `أوراق التنقيط` -> `grades-sheets.html`
        - `بيان النتائج` -> `grades-results.html`
        - `الدعم التربوي` -> `student-support.html`
        - `تتبع حصص الدعم` -> `support-sessions.html`
    - `الغياب والمتابعة`
        - `ورقة الغياب الأسبوعية` -> `absence-weekly.html`
        - `غياب التلاميذ` -> `absence-students.html`
        - `مراسلة الأولياء` -> `absence-correspondence.html`
        - `إحصائيات الغياب` -> `absence-analytics.html`
    - `مركز الامتحانات`
        - `برمجة الامتحانات` -> `exams-schedule.html`
        - `توزيع الحراسة` -> `exams-proctors.html`
        - `قاعات الامتحان` -> `exams-rooms.html`
        - `تدبير الفروض` -> `exams-tests.html`

- Reports & System (`التقارير والنظام`)
    - `التقارير والوثائق`
        - `الشواهد المدرسية` -> `reports-certificates.html`
        - `الاستمارات الإدارية` -> `reports-forms.html`
        - `تقارير الفصل` -> `reports-semester.html`
    - `الإعدادات`
        - `معلومات المؤسسة` -> `settings-school.html`
        - `استيراد البيانات` -> `settings-imports.html`
        - `المستخدمون` -> `settings-users.html` (admin/developer only)
        - `سجل النشاطات` -> `settings-logs.html`
        - `الترخيص والأجهزة` -> `settings-license.html` (admin/developer only)
        - `المزامنة السحابية` -> `settings-sync.html`
    - `التصاميم الجديدة`
        - `مركز التواصل (جديد)` -> `communication-center-prototype.html`

## Sidebar Auth Actions

- `تسجيل الدخول أو إنشاء حساب` -> opens auth flow when no active session
- `تسجيل الخروج` -> replaces login action when a session exists
- `قفل الجلسة` -> shown for authenticated users with PIN lock support
- `إعداد رمز PIN` -> shown when relevant
- `تغيير كلمة المرور` -> shown for authenticated users
- `تفعيل البرنامج` -> shown in blocked or trial scenarios when relevant

## Access Rules

- Guest / blocked access
    - Allowed pages: `index.html`, `students-list.html`, `settings-imports.html`, `login.html`
    - Sidebar active links: `students-list.html`, `settings-imports.html`
    - Other sidebar links stay visible in limited mode but are blocked on click unless hidden by admin config

- Trial access
    - All non-admin pages are accessible
    - `settings-users.html` and `settings-license.html` remain restricted to admin/developer users

- Licensed access without login
    - All non-admin pages are accessible
    - `settings-users.html` and `settings-license.html` remain restricted to admin/developer users

- Authenticated users
    - `admin`, `staff`, `viewer`, and `developer` can open all non-admin pages regardless of license state
    - `admin` can open admin-only pages
    - `developer` bypasses page visibility and admin-page restrictions in the UI layer

## Visibility Notes

- Admin-only pages:
    - `settings-users.html`
    - `settings-license.html`

- Hidden by default for non-admin users because `completed: false` in `PAGE_VISIBILITY_CATALOG`:
    - `student-profile-prototype.html`
    - `communication-center-prototype.html`

- Present in the sidebar but not in `PAGE_VISIBILITY_CATALOG`:
    - `compensation-tracking.html`
    - `grades-results.html`
    - `settings-sync.html`

- Present in `PAGE_VISIBILITY_CATALOG` but not as a current sidebar link:
    - none
