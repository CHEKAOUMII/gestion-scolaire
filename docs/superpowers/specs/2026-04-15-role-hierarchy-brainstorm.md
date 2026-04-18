# نظام الأدوار الهرمي — تلخيص جلسة التصميم
**التاريخ:** 2026-04-15  
**الحالة:** قيد التصميم — لم يبدأ التنفيذ بعد

---

## 1. القرارات المتخذة

### نموذج الصلاحيات
- **الصلاحيات بالصفحة** (page-based permissions) — كل دور يملك قائمة صفحات مسموح له بها
- **ثابتة في الكود** — لا تعديل من الواجهة
- **ملف مركزي واحد:** `main/auth/permissions.js`
- قابل للتوسع: إضافة صفحة جديدة = سطر واحد

### نطاق التطبيق
- **Backend:** حماية قنوات IPC في Main Process
- **Frontend:** إخفاء روابط Sidebar + redirect عند محاولة الوصول المباشر

### تدفق تسجيل المستخدم الجديد
1. المدير يضيف: اسم + بريد + دور
2. النظام يولّد كلمة مرور مؤقتة تلقائياً
3. المدير يرسلها يدوياً (واتساب / بريد)
4. المستخدم يدخل بالبريد + كلمة المرور المؤقتة
5. النظام يطلب تغيير كلمة المرور فوراً (`must_change_password = 1`)
6. يدخل للتطبيق بصلاحيات دوره

---

## 2. الأدوار الهرمية (11 دور)

| المعرّف في الكود | الاسم بالعربية | الاسم بالإنجليزية |
|-----------------|---------------|------------------|
| `developer` | مطوّر التطبيق | Developer |
| `admin` | مدير التطبيق | Admin |
| `principal` (alias: `director`) | مدير المؤسسة | Principal / Director |
| `supervisor` | الناظر | Supervisor |
| `external-guardian` | الحارس العام للخارجية | External Guardian |
| `internal-guardian` | الحارس العام للداخلية | Internal Guardian |
| `admin-assistant` | مساعد إداري | Administrative Assistant |
| `educational-specialist` | مختص تربوي | Educational Specialist |
| `social-specialist` | مختص اجتماعي | Social Specialist |
| `teacher` | أستاذ | Teacher |
| `viewer` | مشاهد فقط | Viewer |

**ملاحظات خاصة:**
- `internal-guardian`: يرى/يكتب غياب الداخليين فقط (`absence_type = 'internal'`) — backend يفلتر
- `teacher`: يرى/يكتب أعداد قسمه فقط — مرتبط بـ `section` في جدول الحصص
- `staff` القديم: يبقى في قاعدة البيانات للتوافق مع البيانات الموجودة

---

## 3. خريطة الصلاحيات بالصفحة

| الصفحة | principal | supervisor | ext-guardian | int-guardian | adm-assistant | edu-specialist | soc-specialist | teacher | viewer |
|--------|:---------:|:----------:|:------------:|:------------:|:-------------:|:--------------:|:--------------:|:-------:|:------:|
| `index.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `students-list.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `students-files.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `students-register.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `students-movement.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `students-status.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `student-support.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `absence-students.html` | ✅ | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ | ✅ | ✅ |
| `absence-weekly.html` | ✅ | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ | ✅ | ✅ |
| `absence-analytics.html` | ✅ | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ | ✅ | ✅ |
| `absence-correspondence.html` | ✅ | ✅ | ✅ | ✅* | ✅ | ❌ | ❌ | ❌ | ❌ |
| `grades-sheets.html` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅* | ✅ |
| `grades-results.html` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅* | ✅ |
| `results-hub.html` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅* | ✅ |
| `exams-schedule.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| `exams-rooms.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `exams-proctors.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `exams-tests.html` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| `teachers-list.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `teachers-schedule.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `teachers-performance.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `teachers-absence.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `staff-attendance.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `staff-daily-report.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `timetable.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `timetable-teachers.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `timetable-students.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `timetable-rooms.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `timetable-redistribution.html` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `compensation-tracking.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `tracking-teachers-performance.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `analytics.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `reports-forms.html` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `reports-certificates.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `reports-semester.html` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `settings-school.html` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `settings-imports.html` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `settings-users.html` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `settings-license.html` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `settings-logs.html` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `settings-sync.html` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

> `*` = مقيّد: `internal-guardian` يرى/يكتب الداخليين فقط. `teacher` يرى/يكتب قسمه فقط.

---

## 4. ما يُلغى

| العنصر | السبب |
|--------|-------|
| `settings-users.html` (القديمة) | كانت تتحكم في رؤية الصفحات — تُستبدل بنظام الأدوار |
| Institution Device Linking (`eager-drifting-yeti.md`) | OTP/LAN linking — ملغى، يُستبدل بـ إضافة مستخدم مباشرة |
| جداول: `linked_devices`, `device_otp` | جزء من الخطة الملغاة |

---

## 5. البنية التقنية المقترحة

### `main/auth/permissions.js` (ملف جديد)
```js
// ملاحظة: 'principal' و 'director' معرّفان مكافئان — كلاهما مقبول في قاعدة البيانات
const ROLE_ALIASES = { 'director': 'principal' };

const ALL_STAFF = [
    'principal','supervisor','external-guardian','internal-guardian',
    'admin-assistant','educational-specialist','social-specialist','teacher','viewer'
];

const PAGE_PERMISSIONS = {
    'index':                         [...ALL_STAFF],
    'students-list':                 [...ALL_STAFF],
    'students-files':                [...ALL_STAFF],
    'students-register':             ['principal','supervisor','external-guardian','admin-assistant'],
    'students-movement':             ['principal','supervisor','external-guardian','admin-assistant'],
    'students-status':               ['principal','supervisor','external-guardian','admin-assistant'],
    'student-support':               ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'absence-students':              [...ALL_STAFF],
    'absence-weekly':                [...ALL_STAFF],
    'absence-analytics':             [...ALL_STAFF],
    'absence-correspondence':        ['principal','supervisor','external-guardian','internal-guardian','admin-assistant'],
    'grades-sheets':                 ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'grades-results':                ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'results-hub':                   ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'exams-schedule':                ['principal','supervisor','external-guardian','admin-assistant','educational-specialist','teacher','viewer'],
    'exams-rooms':                   ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'exams-proctors':                ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'exams-tests':                   ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'teachers-list':                 ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','viewer'],
    'teachers-schedule':             ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'teachers-performance':          ['principal','supervisor','external-guardian','admin-assistant','educational-specialist','viewer'],
    'teachers-absence':              ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','viewer'],
    'staff-attendance':              ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','viewer'],
    'staff-daily-report':            ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','viewer'],
    'timetable':                     [...ALL_STAFF],
    'timetable-teachers':            ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'timetable-students':            [...ALL_STAFF],
    'timetable-rooms':               ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'timetable-redistribution':      ['principal','supervisor','admin-assistant'],
    'compensation-tracking':         ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'tracking-teachers-performance': ['principal','supervisor','external-guardian','admin-assistant','educational-specialist','viewer'],
    'analytics':                     ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'reports-forms':                 ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist'],
    'reports-certificates':          ['principal','supervisor','external-guardian','admin-assistant'],
    'reports-semester':              ['principal','supervisor','external-guardian','admin-assistant','educational-specialist'],
    'settings-school':               ['principal','external-guardian'],
    'settings-imports':              ['principal','supervisor','external-guardian'],
    'settings-users':                [], // admin فقط
    'settings-license':              [],
    'settings-logs':                 [],
    'settings-sync':                 [],
};

const SCOPED_ROLES = {
    'internal-guardian': { absences: { absence_type: 'internal' } },
    'teacher':           { grades: 'by-section', absences: 'by-section' },
};

function canAccessPage(role, pageKey) {
    if (role === 'developer' || role === 'admin') return true;
    return (PAGE_PERMISSIONS[pageKey] || []).includes(role);
}

function getAllowedPages(role) {
    if (role === 'developer' || role === 'admin') return Object.keys(PAGE_PERMISSIONS);
    return Object.keys(PAGE_PERMISSIONS).filter(p => PAGE_PERMISSIONS[p].includes(role));
}

module.exports = { PAGE_PERMISSIONS, SCOPED_ROLES, canAccessPage, getAllowedPages };
```

### قاعدة البيانات
- Migration جديدة تُوسّع قيم `role` في جدول `users` لتشمل الأدوار الـ 9 الجديدة
- لا تغيير في بنية الجداول

### صفحة إدارة المستخدمين (جديدة تحل محل القديمة)
- إضافة مستخدم: اسم + بريد + دور
- كلمة مرور مؤقتة تُولّد تلقائياً وتظهر مرة واحدة للمدير
- `must_change_password = 1` عند الإنشاء
- تعديل الدور / تعطيل الحساب

---

## 6. أسئلة معلقة (لم تُحسم)

- [ ] كيف يتم استخدام التطبيق: جهاز واحد مشترك أم أجهزة متعددة + DynamoDB sync؟
      (هذا يؤثر على كيفية مزامنة بيانات المستخدمين بين الأجهزة)
- [ ] هل `mxt-ijtimaii` يحتاج قراءة الأعداد؟ (أجاب: لا — تأكيد نهائي مطلوب)

---

## 7. الخطوات التالية

1. مراجعة هذا الملف والموافقة النهائية
2. كتابة مواصفة التنفيذ الرسمية (implementation plan)
3. تنفيذ بالترتيب:
   - Migration قاعدة البيانات
   - `main/auth/permissions.js`
   - تعديل `ipc-helpers.js`
   - صفحة إدارة المستخدمين الجديدة
   - حماية Frontend (sidebar + redirect)
