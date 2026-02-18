# App Menu Link Map

Source of truth: `js/sidebar.js`

## Sidebar Tree

- Dashboard
  - `لوحة التحكم` -> `index.html`

- Students (`التلاميذ`)
  - `لوائح التلاميذ` -> `students-list.html`
  - `التسجيل والحركة العامة` -> `students-register.html`
  - `ترتيب الملفات` -> `students-files.html`
  - `حركية التلاميذ` -> `students-movement.html`

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
  - `التلاميذ الحاصلون على صفر` -> `studentzero.html`
  - `الدعم التربوي` -> `student-support.html`
  - `مؤشرات أداء الأساتذة` -> `teachers-performance.html`

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
  - `ملف التلميذ (جديد)` -> `student-profile-prototype.html`
  - `مركز التواصل (جديد)` -> `communication-center-prototype.html`

## Header Actions

- `دخول المشرف` -> `login.html?next=<current-page>`
- `خروج المشرف` (shown when admin session is active)
- `تفعيل البرنامج` (shown in limited mode; opens activation modal)

## Access Modes

- Limited mode (before activation)
  - Allowed pages: `index.html`, `students-list.html`, `settings-imports.html`
  - Sidebar active links: `students-list.html`, `settings-imports.html`

- Licensed mode (after activation)
  - All regular pages available
  - Admin-only pages blocked: `settings-users.html`, `settings-license.html`

- Admin mode (after admin login)
  - Full access to all pages and admin sections

## Note

- `teachers-performance.html` appears in two menu groups:
  - `الأساتذة`
  - `التقويم والنتائج`
