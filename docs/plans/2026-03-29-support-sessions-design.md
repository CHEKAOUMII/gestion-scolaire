# تصميم صفحة "حصص الدعم"

**التاريخ:** 2026-03-29
**الحالة:** معتمد

---

## الملخص

صفحة واحدة `support-sessions.html` لتسجيل حصص الدعم المنجزة من طرف الأساتذة، مع تسجيل حضور القسم (كتلة واحدة) وإمكانية التصدير/الاستيراد بصيغة JSON.

---

## السياق

حصص الدعم تُنجز من طرف:
- أساتذة متخصصون في الدعم فقط (جدول عمل مخصص للدعم)
- أساتذة جدولهم الدراسي ناقص (أقل من 21 ساعة ثانوي / 24 إعدادي) يكملون ساعاتهم بحصص دعم

الأستاذ يقدم **بطاقة ورقية** فيها: المادة، القسم، القاعة، التاريخ، التوقيت — الإداري يُدخلها مباشرة في الصفحة.

الحضور يُسجَّل على مستوى القسم ككتلة (ليس تتبعاً فردياً للتلاميذ).

الصفحة **مستقلة تماماً** عن الحصص التعويضية.

---

## الهيكل العام

```
support-sessions.html
├── بطاقات الإحصاء (4 بطاقات)
├── نموذج تسجيل حصة جديدة
└── فلترة + جدول الحصص المسجلة + طباعة + تصدير/استيراد
```

---

## 1. بطاقات الإحصاء

| البطاقة | المحتوى |
|---------|---------|
| إجمالي الحصص | عدد حصص الدعم المنجزة في الموسم الدراسي |
| إجمالي الساعات | مجموع ساعات الدعم المنجزة |
| عدد الأساتذة | عدد الأساتذة المشاركين في الدعم |
| الأقسام المستفيدة | عدد الأقسام التي استفادت من الدعم |

---

## 2. نموذج تسجيل حصة جديدة

يحاكي البطاقة التي يقدمها الأستاذ:

| الحقل | النوع | ملاحظات |
|-------|-------|---------|
| الأستاذ | قائمة منسدلة | من جدول teachers |
| المادة | قائمة منسدلة | تُعبأ تلقائياً بناءً على الأستاذ |
| القسم | قائمة منسدلة | كل أقسام المؤسسة |
| التاريخ | date picker | |
| التوقيت من | time input | |
| التوقيت إلى | time input | المدة تُحسب تلقائياً |
| القاعة | input نصي | |
| حضور القسم | قائمة منسدلة | حضور كلي / حضور جزئي / غياب كلي |

---

## 3. جدول الحصص المسجلة

### فلاتر
- أستاذ / قسم / مادة / من تاريخ / إلى تاريخ

### أعمدة الجدول
```
# | التاريخ | الأستاذ | المادة | القسم | القاعة | التوقيت | المدة | حضور القسم | حذف
```

### حضور القسم — القيم الممكنة
- `full` → حضور كلي
- `partial` → حضور جزئي
- `absent` → غياب كلي

### الإجراءات
- **معاينة الطباعة** — كشف الحصص المفلترة
- **تصدير JSON** — تصدير جميع حصص الدعم للموسم الحالي
- **استيراد JSON** — استيراد حصص من ملف JSON (دمج مع البيانات الموجودة، تجاهل المكررات)

---

## 4. قاعدة البيانات

### جدول جديد: `support_sessions`

```sql
CREATE TABLE IF NOT EXISTS support_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id  INTEGER NOT NULL,
    subject     TEXT NOT NULL,
    section     TEXT NOT NULL,
    room        TEXT,
    session_date TEXT NOT NULL,       -- YYYY-MM-DD
    time_from   TEXT NOT NULL,        -- HH:MM
    time_to     TEXT NOT NULL,        -- HH:MM
    duration_hours REAL,              -- محسوب تلقائياً
    attendance_status TEXT NOT NULL   -- 'full' | 'partial' | 'absent'
        CHECK(attendance_status IN ('full','partial','absent')),
    school_year TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id)
);
CREATE INDEX IF NOT EXISTS idx_support_sessions_year
    ON support_sessions(school_year);
CREATE INDEX IF NOT EXISTS idx_support_sessions_teacher
    ON support_sessions(teacher_id, school_year);
```

### Migration
- رقم migration جديد في `main/db/migrations.js`

---

## 5. IPC

### القنوات الجديدة (في `main/ipc/staff.js`)

| القناة | النوع | الوصف |
|--------|-------|-------|
| `support-sessions:list` | handleRead | جلب الحصص مع فلترة |
| `support-sessions:stats` | handleRead | إحصائيات البطاقات الأربع |
| `support-sessions:add` | handleWrite | إضافة حصة جديدة |
| `support-sessions:delete` | handleWrite | حذف حصة |
| `support-sessions:export` | handleRead | تصدير JSON (كل حصص الموسم) |
| `support-sessions:import` | handleWrite | استيراد JSON (دمج + تجاهل مكررات) |

---

## 6. الملفات المتأثرة

| الملف | التغيير |
|-------|---------|
| `main/db/migrations.js` | migration جديد: جدول `support_sessions` |
| `main/ipc/staff.js` | 6 handlers جديدة |
| `preload.js` | تعريض 6 قنوات جديدة |
| `js/sidebar.js` | إضافة رابط "حصص الدعم" في قسم "التقويم والنتائج" |
| `support-sessions.html` | الصفحة الجديدة |
| `js/pages/support-sessions.js` | منطق الصفحة |

---

## 7. موضع السايدبار

```
التقويم والنتائج
  ├── النتائج والإحصائيات      (grades.html)
  ├── تحليل النتائج            (analytics.html)
  ├── أوراق التنقيط            (grades-sheets.html)
  ├── بيان النتائج             (grades-results.html)
  ├── التلاميذ الحاصلون على صفر (studentzero.html)
  ├── الدعم التربوي            (student-support.html)
  └── حصص الدعم               (support-sessions.html) ← جديد
```

أيقونة: `fas fa-chalkboard`

---

## 8. التصدير/الاستيراد JSON

### هيكل ملف التصدير
```json
{
  "exported_at": "2026-03-29T10:00:00",
  "school_year": "2025-2026",
  "support_sessions": [
    {
      "teacher_id": 5,
      "subject": "الرياضيات",
      "section": "3AC1",
      "room": "القاعة 12",
      "session_date": "2026-03-15",
      "time_from": "10:00",
      "time_to": "11:00",
      "duration_hours": 1.0,
      "attendance_status": "full"
    }
  ]
}
```

### منطق الاستيراد
- التحقق من صحة البنية قبل الإدراج
- تجاهل المكررات بناءً على: `(teacher_id, section, session_date, time_from)`
- عرض ملخص: "تم استيراد X حصة، تم تجاهل Y مكرر"

---

## القيود

- لا تتبع فردي للتلاميذ — الحضور على مستوى القسم فقط
- الإحصائيات التفصيلية لكل أستاذ (ساعات الدعم) تبقى في صفحة مؤشرات الأداء
- لا علاقة بالحصص التعويضية
