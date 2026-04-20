# خطة: إضافة @mention للمفتشين والمواد في التقرير اليومي

## الوضع الحالي (ما يعمل)

### نظام @mention الموجود
- الملف: `js/pages/staff-daily-report.js` (سطور 948–1110)
- عند كتابة `@` في حقل الملاحظة (`tag-note-textarea`)، ينبثق dropdown يعرض:
  - **أساتذة** (👨‍🏫) — من `_teachersCache` عبر `window.api.teachers.getAll(year)`
  - **أقسام** (🏫) — من `_allSectionsCache` (يملأها `dailyReport.getData()` عبر حقل `allSections`)
- نتائج البحث محدودة: 8 أساتذة + 6 أقسام
- عند اختيار عنصر، يُدرج `@اسم` في النص ويُضاف إلى `_confirmedMentions[]` بصيغة `{ type, id, name }`
- عند الحفظ، `saveNote` يرسل المذكورين كـ `mentions[]` → الـ backend يحفظ صف لكل mention في `system_tags` مع `entity_type` = `'teacher'` | `'section'` | `'general'`

### قاعدة البيانات
- جدول `system_tags`: يقبل `entity_type IN ('teacher','section','general')` — يجب توسيعه لـ `'inspector'` و `'subject'`
- جدول `inspectors` موجود بالكامل مع CRUD API:
  - `window.api.inspectors.getAll(schoolYear)` → يعيد `{ id, first_name, last_name, specialty, status, ... }`
- المواد: `window.api.subjects.getAll()` → يعيد قائمة مواد (strings أو `{name}`)

### عرض المذكورين في الجدول
- `renderTagsTable()` (سطر 649): عند عرض الوسوم، يستبدل `@اسم` بـ badge ملون
- حالياً يستخدم أيقونتين فقط: `👨‍🏫` للأستاذ و `🏫` للقسم (سطر 694)
- **مشكلة**: الأيقونة تُحدد بشرط بسيط `entity_type === 'teacher'` → كل ما ليس أستاذ يأخذ 🏫

---

## التغييرات المطلوبة

### المرحلة 1: توسيع قاعدة البيانات (migration جديد)

**الملف:** `main/db/migrations.js`

إضافة migration جديد `2026-04-051-system-tags-inspector-subject` يعيد إنشاء الجدول مع:
```sql
CHECK(entity_type IN ('teacher','section','general','inspector','subject'))
```

نفس نمط migration `2026-04-049`:
1. إنشاء `system_tags_v2` بالـ CHECK الجديد
2. نسخ البيانات
3. حذف الجدول القديم
4. إعادة تسميته
5. إعادة بناء الـ indexes

---

### المرحلة 2: تحديث الـ Mention Dropdown (الواجهة)

**الملف:** `js/pages/staff-daily-report.js`

#### 2.1 — إضافة caches جديدة

```js
// بجانب التعريفات الموجودة (سطر ~38)
let _inspectorsCache = null;
let _subjectsCache = null;
```

#### 2.2 — دوال تحميل البيانات

```js
async function ensureInspectorsCache() {
    if (!_inspectorsCache) {
        try {
            _inspectorsCache = await window.api.inspectors.getAll(year);
        } catch { _inspectorsCache = []; }
    }
    return _inspectorsCache;
}

async function ensureSubjectsCache() {
    if (!_subjectsCache) {
        try {
            const raw = await window.api.subjects.getAll();
            // Normalize: may be strings or {name} objects
            _subjectsCache = (raw || []).map(s => typeof s === 'string' ? s : s.name).filter(Boolean);
            _subjectsCache = [...new Set(_subjectsCache)];
        } catch { _subjectsCache = []; }
    }
    return _subjectsCache;
}
```

#### 2.3 — تحديث `showTagNoteForm()` (سطر 772)

إضافة تحميل المفتشين والمواد بجانب الأساتذة:
```js
async function showTagNoteForm() {
    await Promise.all([
        ensureTeachersCache(),
        ensureInspectorsCache(),
        ensureSubjectsCache()
    ]);
    // ... باقي الكود بدون تغيير
}
```

#### 2.4 — تحديث `showMentionSuggestions(query)` (سطر 970)

توسيع الدالة لتشمل 4 أقسام بدل 2:

```
👨‍🏫 أساتذة     (teachers)    → max 8
🏫 أقسام       (sections)    → max 6
🔍 مفتشون     (inspectors)  → max 4
📚 مواد        (subjects)    → max 4
```

- **المفتشون**: البحث في `first_name + ' ' + last_name` و `specialty`
  - عند الاختيار: `{ type: 'inspector', id: inspector.id, name: 'الاسم الكامل' }`
- **المواد**: البحث في اسم المادة (string matching)
  - عند الاختيار: `{ type: 'subject', id: null, name: 'اسم المادة' }`

#### 2.5 — تحديث hint text (HTML)

**الملف:** `staff-daily-report.html` (سطر 249)

تغيير نص التلميح من:
```
استخدم @اسم الأستاذ أو @القسم للإشارة إلى أشخاص
```
إلى:
```
استخدم @ للإشارة إلى أستاذ، قسم، مفتش أو مادة
```

وكذلك placeholder الـ textarea (سطر 241):
```
اكتب ملاحظتك هنا... استخدم @ لذكر أستاذ، قسم، مفتش أو مادة
```

---

### المرحلة 3: تحديث العرض (Rendering)

**الملف:** `js/pages/staff-daily-report.js`

#### 3.1 — تحديث `renderTagsTable()` (سطر 694)

استبدال الشرط البسيط:
```js
// قبل
const icon = tag.entity_type === 'teacher' ? '👨‍🏫' : '🏫';
```
بخريطة أيقونات:
```js
const ENTITY_ICONS = {
    teacher: '👨‍🏫',
    section: '🏫',
    inspector: '🔍',
    subject: '📚',
    general: '📝'
};
const icon = ENTITY_ICONS[tag.entity_type] || '📝';
```

هذا التغيير يطبق في **موضعين**:
1. سطر 694 — داخل حلقة الـ grouped notes (الإشارات المجمعة)
2. سطر 733 — داخل حلقة standalone tags (التوافق الخلفي)

---

### المرحلة 4: لا تغييرات مطلوبة على Backend

- الـ `saveNote` handler (`main/ipc/staff.js:1121`) يحفظ `m.type` مباشرة كـ `entity_type` — لا يحتاج تعديل في الكود
- الوحيد الذي يَمنع القيم الجديدة هو الـ CHECK constraint في SQLite — يُحل بالـ migration
- الـ `getByDate` handler يعيد جميع الصفوف بدون فلترة على `entity_type` — يعمل تلقائياً

---

## ملخص الملفات المتأثرة

| الملف | التعديل |
|-------|---------|
| `main/db/migrations.js` | migration جديد لتوسيع CHECK constraint |
| `js/pages/staff-daily-report.js` | caches + dropdown بـ4 أقسام + أيقونات العرض |
| `staff-daily-report.html` | تحديث hint text و placeholder |

## ترتيب التنفيذ

1. Migration (قاعدة البيانات أولاً — بدونها تفشل INSERT)
2. Caches + data loading (`ensureInspectorsCache`, `ensureSubjectsCache`)
3. `showMentionSuggestions()` — إضافة أقسام المفتشين والمواد
4. `renderTagsTable()` — خريطة الأيقونات
5. HTML hints — نصوص التلميح

## ملاحظات

- لا حاجة لتعديل `preload.js` — الـ APIs (`inspectors.getAll`, `subjects.getAll`) موجودة بالفعل
- لا حاجة لتعديل `registerAll.js` — الـ handlers مسجلة
- لا حاجة لتعديل `main/ipc/staff.js` — الـ `saveNote` يقبل أي `type` string
- Smoke test لن يتأثر (لا قنوات IPC جديدة)
