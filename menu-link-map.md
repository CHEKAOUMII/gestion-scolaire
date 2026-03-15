# App Menu Link Map

Source of truth:

- `js/sidebar.js` for the rendered sidebar structure
- `js/utils.js` for access control and page-visibility rules

## Sidebar Tree

- Dashboard
  - `لوحة التحكم` -> `index.html`

- Students (`التلاميذ`)
  - `لوائح التلاميذ` -> `students-list.html`
  - `التسجيل والحركة العامة` -> `students-register.html`
  - `ترتيب الملفات` -> `students-files.html`
  - `حركية التلاميذ` -> `students-movement.html`
  - `ملف التلميذ` -> `student-profile-prototype.html`
  - `الوضعية الدراسية` -> `students-status.html`

- Staff Management (`تدبير الموظفين`)
  - `قائمة الأساتذة` -> `teachers-list.html`
  - `حصص الأساتذة` -> `teachers-schedule.html`
  - `غياب الأساتذة` -> `teachers-absence.html`
  - `مؤشرات الأداء` -> `teachers-performance.html`
  - `الحضور والغياب` -> `staff-attendance.html`
  - `التقرير اليومي` -> `staff-daily-report.html`
  - `تتبع التعويضات` -> `compensation-tracking.html`

- Timetable Management (`تدبير الحصص`)
  - `جدول حصص الأساتذة` -> `timetable.html`
  - `إعادة توزيع الأقسام` -> `timetable-redistribution.html`
  - `جدول حصص التلاميذ` -> `timetable-students.html`
  - `جدول حصص القاعات` -> `timetable-rooms.html`
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

## Sidebar Auth Actions

- `تسجيل الدخول أو إنشاء حساب` -> auth flow
- `تسجيل الخروج` -> shown when a valid session exists
- `قفل الجلسة` -> shown for authenticated users with PIN support
- `إعداد رمز PIN` -> shown when relevant
- `تغيير كلمة المرور` -> shown for authenticated users
- `تفعيل البرنامج` -> shown in blocked mode

## Access Rules

- Guest / blocked access
  - Allowed pages: `index.html`, `students-list.html`, `settings-imports.html`, `login.html`
  - Sidebar clickable links: `students-list.html`, `settings-imports.html`
  - Everything else is blocked or redirected

- Trial access
  - All non-admin pages are available
  - `settings-users.html` and `settings-license.html` remain hidden for non-admin users

- Licensed access
  - All non-admin pages are available
  - `settings-users.html` and `settings-license.html` remain hidden for non-admin users

- Authenticated staff/viewer
  - Can open any non-admin page, regardless of license state

- Admin
  - Full access to all pages and admin-only settings pages

## Visibility Notes

- `js/utils.js` maintains a page visibility catalog for admin-controlled hiding/showing.
- Hidden by default for non-admin users because `completed: false`:
  - `student-profile-prototype.html`
  - `communication-center-prototype.html`
- Present in sidebar but not in `PAGE_VISIBILITY_CATALOG`:
  - `grades-results.html`
  - `compensation-tracking.html`
