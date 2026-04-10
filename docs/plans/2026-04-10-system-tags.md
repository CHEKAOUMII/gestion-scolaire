# 🏷️ System Tags — خطة النظام المفصلة

> **التاريخ:** 2026-04-10  
> **الحالة:** ✅ التنفيذ الأولي مكتمل  
> **الملفات المعدلة:** `migrations.js`, `staff.js`, `preload.js`, `capture.js`, `staff-daily-report.html`

---

## 1. الرؤية العامة

نظام وسوم (System Tags) يُمكّن المسؤولين من تسجيل ملاحظات يومية مُهيكلة مرتبطة بالأساتذة والأقسام، باستخدام أسلوب **@mention** الطبيعي.

### الأهداف
- تتبع مشاركة الأساتذة في الأنشطة التربوية والاجتماعات
- تسجيل الأحداث المتعلقة بالأقسام (خروج مبكر، حصص ناقصة...)
- توفير بيانات مُهيكلة للتقارير والإحصائيات
- واجهة سهلة وطبيعية (نص حر + @mention autocomplete)

### المثال الأساسي
```
🎓 نشاط تربوي
"تم تنظيم نشاط تربوي من انجاز @نورة الهرموشي و الاستادة @صابرين التابي
 وقد استفاد منه القسم @1bachsh-2"
```

---

## 2. الهندسة المعمارية

### 2.1 مكونات النظام

```
┌─────────────────────────────────────────────────┐
│                  Frontend Layer                  │
│  staff-daily-report.html                         │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ Tag Type       │  │ @Mention Textarea      │  │
│  │ Selector       │  │ + Autocomplete Dropdown│  │
│  └───────────────┘  └────────────────────────┘  │
└──────────────────┬──────────────────────────────┘
                   │ window.api.systemTags.*
┌──────────────────▼──────────────────────────────┐
│                  Preload Layer                    │
│  preload.js — systemTags: {                      │
│    getByDate, save, saveNote,                    │
│    delete, deleteByGroup                         │
│  }                                               │
└──────────────────┬──────────────────────────────┘
                   │ ipcRenderer.invoke(...)
┌──────────────────▼──────────────────────────────┐
│                  IPC Layer                        │
│  main/ipc/staff.js                               │
│  ┌─────────────────────────────────────────────┐ │
│  │ systemTags:getByDate   (handleRead)         │ │
│  │ systemTags:save        (handleWriteSoftAuth)│ │
│  │ systemTags:saveNote    (handleWriteSoftAuth)│ │
│  │ systemTags:delete      (handleWriteSoftAuth)│ │
│  │ systemTags:deleteByGroup (handleWriteSoftAuth)│
│  └─────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────────┘
                   │ better-sqlite3
┌──────────────────▼──────────────────────────────┐
│                  Database Layer                   │
│  system_tags table                               │
│  + sync_outbox (via capture.js)                  │
└─────────────────────────────────────────────────┘
```

### 2.2 تدفق البيانات

```
المستخدم يكتب ملاحظة مع @mentions
        │
        ▼
  [Frontend] اختيار نوع الوسم + كتابة نص + @autocomplete
        │
        ▼
  [saveNote] يُرسل: tag_date, tag_key, tag_label, note_text,
             mentions: [{type, id, name}, ...], school_year
        │
        ▼
  [IPC Handler] يُنشئ note_group UUID
             → transaction: إدراج صف لكل mention
             → كل صف يحمل نفس note_group + note_text
        │
        ▼
  [Sync Capture] → sync_outbox (bulk entry)
        │
        ▼
  [loadReport] → dailyReport:getData → يُرجع tags[]
             → renderTagsTable: يجمع حسب note_group
             → يُبرز @mentions في النص
```

---

## 3. مخطط قاعدة البيانات

### 3.1 جدول `system_tags`

| العمود | النوع | الوصف |
|--------|-------|-------|
| `id` | INTEGER PK | المعرف التلقائي |
| `tag_date` | TEXT NOT NULL | تاريخ الملاحظة (YYYY-MM-DD) |
| `entity_type` | TEXT NOT NULL | `'teacher'` أو `'section'` |
| `entity_id` | INTEGER | معرف الأستاذ (NULL للأقسام) |
| `entity_name` | TEXT NOT NULL | اسم الأستاذ أو القسم |
| `tag_key` | TEXT NOT NULL | مُعرّف الوسم (مثل `educational_activity`) |
| `tag_label` | TEXT NOT NULL | النص العربي المعروض |
| `note_group` | TEXT | UUID يربط وسوم الملاحظة الواحدة |
| `note_text` | TEXT | النص الكامل للملاحظة |
| `details` | TEXT | تفاصيل إضافية (للوسوم الفردية القديمة) |
| `school_year` | TEXT NOT NULL | السنة الدراسية |
| `created_at` | DATETIME | تاريخ الإنشاء |

### 3.2 القيود والفهارس

```sql
-- منع التكرار
UNIQUE(tag_date, entity_type, entity_name, tag_key, school_year)

-- فهارس البحث
idx_system_tags_date   ON (tag_date, school_year)
idx_system_tags_entity ON (entity_type, entity_name, school_year)
```

### 3.3 Migrations

| إصدار | الوصف |
|--------|-------|
| `2026-04-045-system-tags` | إنشاء الجدول + الفهارس |
| `2026-04-046-system-tags-notes` | إضافة `note_group` + `note_text` |

---

## 4. أنواع الوسوم المُعرّفة

### 4.1 القائمة الموحدة (`ALL_TAG_TYPES`)

| المفتاح | العنوان | أيقونة | الاستخدام |
|---------|---------|--------|-----------|
| `educational_activity` | نشاط تربوي | 🎓 | أساتذة + أقسام |
| `meeting` | اجتماع | 📋 | أساتذة |
| `competition` | مسابقة | 🏆 | أساتذة + أقسام |
| `training` | تكوين / ورشة | 📝 | أساتذة |
| `inspection` | زيارة تفتيشية | 🔍 | أساتذة |
| `field_trip` | خرجة دراسية | 📍 | أساتذة + أقسام |
| `early_release` | خروج مبكر | ⏰ | أقسام |
| `short_session` | حصة ناقصة | 📉 | أقسام |
| `cancelled_session` | إلغاء حصة | 🚫 | أقسام |
| `cultural_activity` | نشاط ثقافي | 🎭 | أقسام |
| `sports_activity` | نشاط رياضي | 🏃 | أقسام |
| `other` | أخرى | 📌 | عام |

---

## 5. واجهة المستخدم

### 5.1 نموذج الإضافة

```
┌─────────────────────────────────────────────────────────┐
│  🏷️ نوع الوسم: [🎓 نشاط تربوي ▾]                      │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ تم تنظيم نشاط تربوي من انجاز @نو█                 │ │
│  │                                                     │ │
│  │  ┌──────────────────────────┐  ◄── autocomplete    │ │
│  │  │ 👨‍🏫 نورة الهرموشي  أستاذ │                      │ │
│  │  │ 👨‍🏫 نوال الحياني   أستاذ │                      │ │
│  │  │ 🏫  1bachsh-2      قسم  │                      │ │
│  │  └──────────────────────────┘                      │ │
│  └─────────────────────────────────────────────────────┘ │
│  ℹ️ استخدم @ لذكر أستاذ أو قسم          [✓ حفظ] [✕]   │
└─────────────────────────────────────────────────────────┘
```

### 5.2 جدول العرض

```
┌───┬──────────────────┬──────────────────────────────────────────┬────┐
│ # │ الوسم            │ الملاحظة                                 │ 🗑 │
├───┼──────────────────┼──────────────────────────────────────────┼────┤
│ 1 │ 🎓 نشاط تربوي   │ تم تنظيم نشاط من انجاز                  │ ✕  │
│   │                  │ [👨‍🏫 نورة الهرموشي] و [👨‍🏫 صابرين التابي] │    │
│   │                  │ واستفاد منه [🏫 1bachsh-2]              │    │
├───┼──────────────────┼──────────────────────────────────────────┼────┤
│ 2 │ ⏰ خروج مبكر    │ تم تسريح [🏫 2bacSVT-1] الساعة 15:00    │ ✕  │
│   │                  │ بسبب غياب @أحمد المنصوري                │    │
└───┴──────────────────┴──────────────────────────────────────────┴────┘
```

### 5.3 الـ Autocomplete

| الميزة | التفاصيل |
|--------|----------|
| **التفعيل** | كتابة `@` (مسبوقة بمسافة أو بداية سطر) |
| **الفلترة** | فورية عند الكتابة بعد @ |
| **التنقل** | ↑↓ بالأسهم + Enter للاختيار |
| **الإغلاق** | Escape أو النقر خارج القائمة |
| **المنع** | التكرار ممنوع (deduplicate) |
| **التحقق** | عند الحفظ، يُتحقق أن @mention لا يزال موجوداً في النص |
| **المصادر** | الأساتذة من `teachers.getAll()` + الأقسام من `dailyReport.getData().allSections` |

---

## 6. IPC Handlers

### 6.1 `systemTags:getByDate` (Read)
```js
// المدخلات: date, schoolYear
// المخرجات: system_tags[] مرتبة حسب entity_type, entity_name
```

### 6.2 `systemTags:save` (Write — وسم فردي)
```js
// المدخلات: { tag_date, entity_type, entity_id, entity_name,
//             tag_key, tag_label, details, school_year }
// يدعم INSERT (بدون id) و UPDATE (مع id)
```

### 6.3 `systemTags:saveNote` (Write — ملاحظة مع @mentions)
```js
// المدخلات: { tag_date, tag_key, tag_label, note_text,
//             mentions: [{type, id, name}], school_year }
// → ينشئ note_group UUID
// → transaction: صف لكل mention
```

### 6.4 `systemTags:delete` (Write — حذف فردي)
```js
// المدخلات: tagId
```

### 6.5 `systemTags:deleteByGroup` (Write — حذف ملاحظة كاملة)
```js
// المدخلات: noteGroup UUID
// → يحذف كل الصفوف بنفس note_group
```

---

## 7. التكامل مع النظام

### 7.1 التقرير اليومي (`dailyReport:getData`)
- يُرجع `tags[]` ضمن بيانات التقرير
- التحميل تلقائي مع تغيير التاريخ

### 7.2 Sync Capture (`capture.js`)
| القناة | الجدول | العملية | الاستخراج |
|--------|--------|---------|-----------|
| `systemTags:save` | `system_tags` | PUT | `argIdOrLastInsert` |
| `systemTags:saveNote` | `system_tags` | PUT | `inputArray` (bulk) |
| `systemTags:delete` | `system_tags` | DEL | `argId` |
| `systemTags:deleteByGroup` | `system_tags` | DEL | `preQuery` (bulk) |

### 7.3 الصلاحيات
- **القراءة:** جميع المستخدمين (handleRead)
- **الكتابة:** `admin` و `staff` فقط (handleWriteSoftAuth)

---

## 8. التوسعات المستقبلية

### 8.1 صفحة تحليل الوسوم (مخطط)
- إحصائيات شهرية: عدد الأنشطة، المشاركين، الأقسام المتأثرة
- فلترة حسب الأستاذ أو القسم أو نوع الوسم
- رسوم بيانية (charts)

### 8.2 التكامل مع تتبع أداء الأساتذة
```sql
-- في tracking-teachers-performance.html
-- عرض كل الوسوم المرتبطة بأستاذ معين
SELECT tag_key, tag_label, tag_date, note_text
FROM system_tags
WHERE entity_type = 'teacher'
  AND entity_name = ?
  AND school_year = ?
ORDER BY tag_date DESC
```

### 8.3 التكامل مع التعويضات
- ربط وسوم "حصة ناقصة" و "إلغاء حصة" مع `compensation_tracking`
- حساب تلقائي للساعات الضائعة

### 8.4 تقارير مطبوعة
- الوسوم تظهر في معاينة الطباعة (ليست `no-print`)
- إمكانية تصدير ملخص الوسوم كتقرير منفصل

### 8.5 وسوم مخصصة
- إضافة إمكانية للمستخدم لإنشاء أنواع وسوم جديدة
- جدول `tag_types` مستقل

---

## 9. أمثلة استعلامات مفيدة

```sql
-- كل الأساتذة الذين ساهموا في أنشطة تربوية
SELECT DISTINCT entity_name, COUNT(*) as activity_count
FROM system_tags
WHERE entity_type = 'teacher'
  AND tag_key = 'educational_activity'
  AND school_year = '2025/2026'
GROUP BY entity_name
ORDER BY activity_count DESC;

-- كل الأقسام التي خرجت مبكراً
SELECT entity_name, tag_date, note_text
FROM system_tags
WHERE entity_type = 'section'
  AND tag_key = 'early_release'
  AND school_year = '2025/2026'
ORDER BY tag_date DESC;

-- ملخص الوسوم حسب النوع
SELECT tag_key, tag_label, COUNT(DISTINCT note_group) as note_count
FROM system_tags
WHERE school_year = '2025/2026'
GROUP BY tag_key
ORDER BY note_count DESC;

-- كل ما حدث لقسم معين
SELECT tag_date, tag_label, note_text
FROM system_tags
WHERE entity_type = 'section'
  AND entity_name = '1bachsh-2'
  AND school_year = '2025/2026'
ORDER BY tag_date DESC;
```
