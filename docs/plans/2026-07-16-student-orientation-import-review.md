# مراجعة عميقة: خطة استيراد التوجيه المدرسي

| الحقل | القيمة |
|--------|--------|
| **التاريخ** | 2026-07-16 |
| **المرجع** | [`2026-07-16-student-orientation-import-plan.md`](./2026-07-16-student-orientation-import-plan.md) |
| **النوع** | مراجعة خطة (plan review) + فجوة تنفيذ (gap analysis) |
| **الحالة** | مراجعة مكتملة — الخطة الأصلية **جزئياً منفّذة** و**غير كافية** كمصدر وحيد للتنفيذ |
| **الهدف** | تقييم صحة الخطة، مطابقتها للكود، وتثبيت أولويات التنفيذ التالية |

---

## 1. الخلاصة التنفيذية

الخطة الأصلية **سليمة في المبادئ** (مفتاح فريد، دمج غير هدّام، لا `clearYear` داخل الاستيراد، إبقاء المسار اليدوي)، لكنها كُتبت كأنها **نقطة الصفر**. الواقع اليوم:

| الطبقة | الوضع الفعلي (2026-07-16) | حكم المراجعة |
|--------|---------------------------|--------------|
| UI استيراد | بطاقة + input + إحصاء + حذف في `settings-imports` | ✅ منفّذ |
| تطبيع Massar | طلبات التوجيه (`LstDemande`) + نتائج السنة (`ResultatsList`) | ✅ منفّذ جزئياً في الواجهة |
| Excel/CSV | رؤوس مرنة + `origin_stream` | ✅ منفّذ |
| IPC `bulkUpsert` | `ON CONFLICT DO UPDATE` **يستبدل كل الحقول** بما فيها `NULL` | ❌ **فجوة حرجة** مقابل §3.1 و§5.2 |
| نتيجة الاستيراد | `{ imported, skipped }` فقط | ❌ مقابل §3.2 و§5.1.و |
| دمج frontend | دمج اختيارات **فقط** عند `massar_results` | ⚠️ مؤقت وغير كافٍ |
| صفحة العرض | `students-orientation.js` تحمّل list+stats | ⚠️ بلا تحقق سنة صريح |
| المزامنة | `bulkUpsert` = `exclude: true` + `captureMode: explicit` **بدون كتابة outbox** | ❌ مقابل §5.4 و checklist الكتابة |
| الاختبارات | لا تغطية وحدة لمسار التوجيه | ❌ مستبعد في الخطة لكن مطلوب للقبول |

**الحكم:** اعتمد المبادئ، **لا تنفّذ الخطة سطراً بسطر دون التحديثات أدناه**. الفجوة الأولى والوحيدة التي تمنع «حفظ المعلومات الجديدة فقط» هي **سياسة الدمج في IPC** — أي دمج على الواجهة فقط قابل للتجاوز أو التلف.

---

## 2. منهجية المراجعة

1. قراءة الخطة كاملة (§1–§12).
2. مطابقة كل بند مع الكود:
   - `js/pages/settings-imports.js` (`importOrientation`, Massar parsers)
   - `main/ipc/orientation.js`
   - `js/pages/students-orientation.js`
   - `preload.js` (`window.api.orientation`)
   - `main/sync/capture.js` + `main/sync/entity-registry.js`
   - `main/db/migrations.js` (`2026-07-068-student-orientation`)
   - `settings-imports.html`
3. تشغيل منطق التطبيع على عيّنتين حقيقيتين:
   - `massar_orientation_*.json` (17 طلب)
   - `massar_resultats_*.json` (173 نتيجة)
4. مقارنة سياسة الكتابة مع `docs/plans/2026-07-15-add-write-channel-checklist.md`.

---

## 3. نقاط القوة في الخطة

| # | نقطة القوة | لماذا مهمة |
|---|------------|------------|
| 1 | مفتاح `school_year + student_code` فقط | يطابق UNIQUE في المخطط و`entity-registry` |
| 2 | رفض `clearYear` داخل الاستيراد | يمنع مسار «حذف ثم إعادة ملء» الكارثي |
| 3 | جدول سياسة الحقول (§6) | مرجع واضح للدمج غير الهدّام |
| 4 | فصل المسار اليدوي عن الذكي (§5.5) | يتوافق مع واقع Import Center (لا محول orientation) |
| 5 | حالات قبول واسعة (§9–§10) | جيدة كـ checklist يدوي/آلي لاحقاً |
| 6 | عدم طلب migration جديد | صحيح — القيد موجود |
| 7 | التمييز بين inserted / updated / unchanged | ضروري للتدقيق التربوي والمزامنة |

---

## 4. أخطاء أو ثغرات داخل نص الخطة نفسها

### 4.1 حالة الوثيقة قديمة

الخطة تصف الوضع كـ«ربط موجود مبدئياً» وتستبعد الاختبارات والتنفيذ. **بعد جلسة 2026-07-16** أصبح هناك:

- مسار استيراد يدوي كامل في UI.
- دعم JSON عام + **صيغتين Massar مختلفتين**.
- صفحة عرض عاملة.

يجب تحديث رأس الخطة إلى: **«منفّذ جزئياً — ينتظر الدمج غير الهدّام + نتيجة تفصيلية + sync exact bulk»**.

### 4.2 ازدواجية سياسة السنة (§5.1.د vs §8)

- §5.1.د: «رفض العملية أو إيقافها».
- §8: «يتوقف الحفظ قبل كتابة البيانات».
- الكود الحالي: `checkYearMismatch` يعرض تأكيداً ويسمح بالمتابعة.

**قرار مطلوب (يجب تثبيته في الخطة):**

| الخيار | السلوك | التوصية |
|--------|--------|---------|
| **A — صارم** | اختلاف السنة → إلغاء بلا استيراد | للإنتاج متعدد السنوات |
| **B — تأكيد صريح** | اختلاف → `showConfirm` ثم المتابعة بالسنة **المختارة في الواجهة** فقط | ✅ موصى به (متوافق مع باقي الاستيراد) |
| **C — صامت** | استخدام سنة الملف | ❌ ممنوع (الخطة محقّة) |

لا تستخدم سنة الملف للكتابة أبداً دون أن تطابق اختيار الواجهة أو تأكيداً صريحاً.

### 4.3 سياسة `notes` معلّقة (§6)

الخطة تؤجل قرار الاستبدال vs الإلحاق. بدون قرار:

- نتائج Massar تبني `notes` من النتيجة/المعدل.
- طلبات التوجيه تبني `notes` من المؤسسات + `requestId`.
- أي upsert هدّام يمسح أحد المصدرين.

**قرار مقترح:**

1. قيمة جديدة غير فارغة **تستبدل** القديمة (أبسط، قابل للتدقيق).
2. لا إلحاق تلقائي بفواصل إلا في مرحلة لاحقة إن طُلب.
3. الفراغ/`NULL` **لا يمسح** الملاحظة القديمة (نفس قاعدة باقي الحقول).

### 4.4 `school_year` على كل صف (§5.1.أ)

الخطة تطلب تضمين `school_year` في السجل المطبّع. IPC الحالي يأخذ السنة من **payload المستوى الأعلى** فقط (`payload.schoolYear`) ويتجاهل سنة الصف. هذا جيد للأمان (لا خلط سنوات داخل دفعة) لكن:

- لا داعي لإجبار الواجهة على وضع `school_year` على كل صف.
- يجب أن **يرفض** IPC أي صف يحمل `school_year` مختلفة عن سنة الطلب (§5.2.د) — **غير منفّذ**.

### 4.5 `mapRow` في IPC لا يعرف حقول Massar الخام

`mapRow` يدعم `student_code|code|massar_code` ولا يدعم `studentCode`, `fullName`, `className`, `currentLevel`, `assignedLevel`, `result`.

الواجهة تطبع قبل الإرسال — **يعتمد المسار على الواجهة فقط**. أي عميل IPC آخر (اختبار، sync apply، استيراد مستقبلي) سيفشل أو ينتج `skipped`.

**قرار:** إما توسيع `mapRow` ليشمل aliases Massar، أو فرض عقد «صف مطبّع فقط» وتوثيقه — الخطة تذكر aliases لكن ليس camelCase مسار.

### 4.6 المزامنة (§5.4) تتعارض مع الواقع والـ checklist

الخطة تطلب التقاطاً فردياً. الكود:

```js
'orientation:bulkUpsert': {
  bulk: true,
  captureMode: 'explicit',
  exclude: true  // لا outbox تلقائي
}
```

بدون `captureInputUpserts` داخل المعاملة = **فجوة مزامنة صامتة** بعد الاستيراد. الخطة لا تشير إلى:

- `docs/plans/2026-07-15-add-write-channel-checklist.md`
- نمط `students:addBulk` / repos كمرجع
- `entity-registry.student_orientation` (المفاتيح صحيحة مسبقاً)

### 4.7 دفعات 500 صف — معاملة جزئية

`importOrientation` يرسل دفعات 500. كل دفعة معاملة مستقلة. فشل الدفعة 2 بعد نجاح 1 = **حالة جزئية**. الخطة لا تذكر:

- إما دفعة واحدة + transaction واحدة للملف، أو
- نتيجة تفصيلية + إمكانية إعادة التشغيل الآمن (idempotent merge) — الدمج غير الهدّام يجعل الإعادة آمنة.

### 4.8 صيغ Massar غير مسمّاة كعقد

الخطة تقول «ملفات JSON الخاصة بتصديرات Massar» دون تمييز:

| المصدر | URL تقريبي | الحقول الحاسمة | دور الدمج |
|--------|------------|----------------|-----------|
| **orientation** | `…/Orientation/LstDemande` | `choices[]`, `status`, `currentLevel` | يغذّي الرغبات |
| **results** | `…/DecisionFinAnnee/ResultatsList` | `result`, `assignedLevel`, `average` | يغذّي الإسناد والمعدل |

استيراد النتائج بعد الطلبات (أو العكس) هو السيناريو التربوي الأساسي — يجب أن يكون **متطلباً صريحاً** وليس «حالة حدّية».

### 4.9 صفحة العرض: لا تحقق `schoolYear` في الرد

§5.3.أ يطلب مقارنة `listRes.schoolYear` و`statsRes.schoolYear`.  
`loadAll()` يمرّر السنة ولا يتحقق من الحقل في الرد، ولا يصفّر العرض قبل الجلب (سباق تغيير السنة).

### 4.10 استبعاد الاختبارات (§1)

مفهوم كمرحلة تخطيط، لكنه **يضعف §9**. بعد التنفيذ الجزئي، الحد الأدنى للاختبارات:

1. وحدة: تطبيع Massar orientation + results (Node بدون Electron).
2. وحدة: دمج IPC (coalesce) — inserted/updated/unchanged.
3. انحدار: وجود `importOrientation` + input في HTML (موجود جزئياً).

---

## 5. مصفوفة الفجوات (خطة × كود)

| بند الخطة | المطلوب | الكود الحالي | الأولوية |
|-----------|---------|--------------|----------|
| §3.1 دمج غير هدّام | NULL/فراغ لا يمسح | `excluded.*` يستبدل الكل | **P0** |
| §5.2.ج تصنيف السجلات | inserted/updated/unchanged/skipped | `imported` + `skipped` فقط | **P0** |
| §5.1.و عرض نتيجة تفصيلية | UI counters | toast بعدد عام | **P1** |
| §5.1.هـ دمج Massar | اختيارات + إسناد | merge اختيارات فقط لـ results في renderer | **P0** (انقل إلى IPC) |
| §5.1.ز لا clearYear | لا استدعاء في import | ✅ محقق | — |
| §8 سنة موحّدة | لا كتابة بسنة خاطئة | تأكيد اختياري؛ الكتابة بسنة الواجهة | **P1** (ثبّت B) |
| §5.3 عرض | تحقق سنة + تفريغ | غير مكتمل | **P1** |
| §5.4 sync | exact bulk outbox | exclude بدون explicit write | **P0** إن كانت المزامنة مستخدمة في الإنتاج |
| §5.5 smart import | إبقاء يدوي | ✅ في contracts (orientation في MANUAL فقط) | — |
| §7 تكرار داخلي | duplicatesInFile | dedupe بـ Map بلا عدّاد في النتيجة | **P1** |
| §6 notes | سياسة ثابتة | تُستبدل عند وجود قيمة | **P1** (ثبّت قرار §4.3) |
| mapRow Massar | aliases كاملة | ناقصة في IPC | **P1** |
| اختبارات | قبول آلي | شبه غائبة | **P2** بعد P0 |

---

## 6. مخاطر حرجة إن بقي التنفيذ كما هو

### R1 — مسح الرغبات عند استيراد النتائج (أو العكس)

`ON CONFLICT DO UPDATE SET choice_1 = excluded.choice_1` مع `choice_1 = null` من ملف النتائج يصفّر الرغبات حتى لو الواجهة دمجت **في جلسة واحدة**. أي مسار لا يمرّ بالدمج المؤقت (إعادة تشغيل، أداة، sync apply) يفسد البيانات.

### R2 — استيراد جزئي متعدد الدفعات

500+ صف: نجاح جزئي بدون تقرير per-batch واضح.

### R3 — مزامنة عمياء

أجهزة أخرى لا ترى مستورد التوجيه إذا كان `exclude: true` بلا explicit capture.

### R4 — `allowNoSession: true` على `bulkUpsert`

مناسب للاستيراد قبل الجلسة، لكن يجب أن يبقى محصوراً بأدوار الكتابة عند وجود جلسة (الـ soft auth يفعل ذلك جزئياً). الخطة لا تذكر هذا البعد الأمني.

### R5 — `origin_stream` من `filterLevel` الطويل

نتائج Massar تضع مستوى كاملاً كـ«شعبة أصلية». الفلاتر والرسوم تعمل لكن التسميات قد تتفرع (`جذع مشترك…` vs `الجذع المشترك…`). الخطة تطلب تطبيع فلاتر العرض — **لم يُنفَّذ تطبيع قاموسي** للمستويات.

---

## 7. ما يجب الإبقاء عليه من التنفيذ الحالي

لا تعِد البناء من الصفر. احتفظ بـ:

1. بطاقة الاستيراد + `orientation-file-input` + بطاقة الإحصاء/الحذف.
2. `parseOrientationJsonFile` / `normalizeOrientationRecord` / دعم Excel.
3. كشف سنة Massar من `context.schoolYear`.
4. `DataSourceRegistry` مفتاح `orientation`.
5. صفحة `students-orientation.html` + KPI/مصفوفة/جدول مفصّل.
6. قيد UNIQUE والمخطط الحالي.

**انقل** منطق «لا تمسح القيم القديمة» من renderer إلى **IPC** كمصدر حقيقة وحيد.

---

## 8. خطة تنفيذ منقّحة (بعد المراجعة)

### المرحلة 0 — قرارات مغلقة (قبل الكود)

| قرار | القيمة المعتمدة |
|------|-----------------|
| سنة مختلفة | **B**: تأكيد صريح؛ الكتابة دائماً بسنة الواجهة |
| notes | استبدال إن وُجدت قيمة جديدة؛ وإلا الإبقاء |
| صفر عددي | صالح لـ average/rank (لا يُعامل كفراغ) |
| مسار ذكي | مؤجّل — لا adapter |
| دمج | **IPC فقط**؛ إزالة الاعتماد على merge الواجهة كضمان |

### المرحلة 1 — P0: `main/ipc/orientation.js` (يوم 1)

1. استبدل upsert الهدّام بـ:
   - `SELECT` للسجل الحالي بالمفتاح، أو
   - `INSERT … ON CONFLICT DO UPDATE SET col = COALESCE(excluded.col, student_orientation.col)` مع استثناء: **لا** تستخدم COALESCE أعمى لـ `origin_stream` إن أردت السماح بتحديث الشعبة — فضّل دالة `pickNew(old, new)`.
2. نفّذ:

```text
pickText(old, incoming)  → incoming غير فارغ ? incoming : old
pickNum(old, incoming)   → incoming رقم صالح ? incoming : old
```

3. صنّف كل صف: `inserted | updated | unchanged | skipped` + سبب التجاوز.
4. أرجع:

```js
{
  success: true,
  schoolYear,
  inserted, updated, unchanged, skipped,
  duplicatesInFile: 0, // يُملأ من الواجهة أو يُحسب قبل الإرسال
  details: [ /* اختياري، محدود الحجم */ ]
}
```

5. وسّع `mapRow` لـ camelCase Massar: `studentCode`, `fullName`, `className`, `currentLevel`, `assignedLevel`, `result`, `resultCategory`.
6. ارفض صفاً بـ `school_year` مختلفة عن سنة الطلب إن وُجدت على الصف.
7. أبقِ transaction واحدة لكل استدعاء `bulkUpsert`.

### المرحلة 2 — P0: المزامنة (إن لزم للإنتاج)

1. داخل نفس transaction بعد الكتابة الناجحة: `captureInputUpserts` / صفوف محلولة بمفتاح `(school_year, student_code)`.
2. اتبع checklist الكتابة؛ شغّل smoke + exact bulk tests.
3. اترك `clearYear` = `exclude` مع تعليق واضح.

### المرحلة 3 — P1: الواجهة `settings-imports.js`

1. مرّر عدّاد `duplicatesInFile` من الـ Map.
2. اعرض `inserted/updated/unchanged/skipped` في toast و/أو لوحة صغيرة (HTML إن لزم).
3. بسّط merge الواجهة لـ massar_results (اختياري كتحسين شبكة فقط — **ليس** مصدر الحقيقة).
4. ثبّت نص تأكيد السنة حسب قرار B.

### المرحلة 4 — P1: `students-orientation.js`

1. بعد الجلب: إن `listRes.schoolYear !== year` أو stats مختلف → لا تعرض؛ toast خطأ.
2. عند بدء التحميل / تغيير السنة: صفّر `allRows` والجداول فوراً.
3. صفوف بلا `student_code` أو `origin_stream`: استبعد من الجدول أو علّمها.
4. `await`/try مستقل لـ charts (موجود جزئياً — تأكد من عدم إسقاط الجدول).

### المرحلة 5 — P2: اختبارات + توثيق

1. `tests/orientation/` — fixtures JSON مصغّرة من Massar.
2. حدّث رأس الخطة الأصلية أو ضع رابطاً لهذه المراجعة كـ **SSOT للتنفيذ**.
3. عيّنة أعمدة Excel في README قصير داخل `docs/` إن لزم للمستخدم.

---

## 9. وصف SQL مقترح للدمج غير الهدّام

**الخيار المفضّل (وضوح التصنيف):** قراءة + مقارنة في JS داخل transaction (مثل أنماط repos أخرى):

```text
for each mapped row:
  if !code || !origin_stream → skipped
  existing = SELECT * WHERE student_code=? AND school_year=?
  if !existing → INSERT; inserted++
  else:
    next = merge(existing, incoming)  // pickText/pickNum
    if shallowEqual(existing, next) → unchanged++
    else UPDATE …; updated++
```

**الخيار البديل (SQL فقط):**  
`col = COALESCE(NULLIF(trim(excluded.col), ''), student_orientation.col)`  
صعب على الأرقام والتمييز updated/unchanged — **غير مفضّل** إن أردنا §5.2.ج.

---

## 10. حالات القبول — قائمة منقّحة (يجب أن تمر بعد P0–P1)

### استيراد

| # | الحالة | متوقع |
|---|--------|--------|
| A1 | ملف orientation Massar جديد | inserted = N |
| A2 | إعادة نفس الملف | unchanged = N، لا صفوف إضافية |
| A3 | results بعد orientation | assigned/average/status تتحدث؛ choices تبقى |
| A4 | orientation بعد results | choices تُملأ؛ assigned لا يُمسح إن غاب |
| A5 | قيم فارغة في الملف | لا NULL فوق قيمة قديمة |
| A6 | تكرار code داخل الملف | صف واحد؛ duplicatesInFile ≥ 1 |
| A7 | سنة ملف ≠ واجهة + إلغاء التأكيد | 0 كتابة |
| A8 | لا استدعاء clearYear | محقق |
| A9 | صف بلا code أو origin | skipped + سبب |

### عرض

| # | الحالة | متوقع |
|---|--------|--------|
| V1 | list/stats.schoolYear | يطابق الواجهة أو فراغ + خطأ |
| V2 | تبديل السنة | لا وميض بيانات السنة السابقة |
| V3 | فشل chart | الجدول يبقى |

### مزامنة (إن مفعّلة)

| # | الحالة | متوقع |
|---|--------|--------|
| S1 | بعد bulkUpsert | outbox per-row بمفتاح السنة+الرمز |
| S2 | clearYear | ليس expand كامل غير مقصود |
| S3 | delete فردي | DEL بالمعرّف |

---

## 11. حدود تعديل منقّحة

| ملف | إجراء |
|-----|--------|
| `main/ipc/orientation.js` | **يجب** — دمج + نتيجة + aliases |
| `main/sync/capture.js` + مسار capture الصريح | **يجب** إن sync حي |
| `js/pages/settings-imports.js` | عرض نتيجة + duplicates؛ تخفيف merge المحلي |
| `js/pages/students-orientation.js` | تحقق سنة + تفريغ |
| `settings-imports.html` | اختياري — لوحة نتيجة |
| `preload.js` | فقط إن تغيّر شكل API للنتيجة (غالباً لا) |
| `main/db/migrations.js` | لا |
| `import-contracts` / adapters | لا (مرحلة لاحقة) |
| `tests/orientation/*` | يُضاف بعد P0 |

---

## 12. تقييم جودة الخطة (درجات)

| المعيار | الدرجة /5 | تعليق |
|---------|-----------|--------|
| وضوح الهدف | 5 | ممتاز |
| صحة نموذج البيانات | 5 | يطابق المخطط |
| اكتمال الوضع الحالي | 2 | تأخّر عن التنفيذ الجزئي |
| قابلية التنفيذ التقني | 3 | ينقص وصف SQL/API النتيجة |
| المزامنة والـ checklist | 2 | سطحي مقابل معايير المشروع |
| Massar ثنائي الصيغة | 2 | غير مفصّل |
| الاختبارات | 1 | مستبعدة صراحة |
| إدارة المخاطر | 3 | جيدة في المبادئ؛ ضعيفة في الدفعات/sync |
| **المتوسط** | **~2.9 / 5** | **صالحة كاتجاه؛ غير كافية كـ runbook تنفيذ** |

---

## 13. التوصية النهائية

1. **أبقِ** `2026-07-16-student-orientation-import-plan.md` كوثيقة مبادئ + قبول.
2. **نفّذ** حسب **هذه المراجعة** (المراحل 0→5) لا حسب ترتيب §11 وحده دون P0 IPC.
3. **لا** تعتمد على دمج الواجهة كحماية بيانات.
4. **أغلق** قرارات السنة و`notes` قبل الـ PR.
5. بعد إغلاق P0: حدّث حالة الخطة الأصلية إلى `partially-implemented` مع رابط إلى هذا الملف.

---

## 14. ملحق — عيّنات حقيقية معتمدة للقبول

### Massar orientation (طلبات)

```text
top: ok, context, students, stats
student: studentCode, fullName, currentLevel, className, status, choices[{order,targetLevel,receivingSchool}]
```

### Massar results (نتائج)

```text
top: ok, pageType=results, context, summary, students, stats
student: studentCode, fullName, className, average("12,13"), result, assignedLevel, resultCategory
context.filterLevel → origin_stream عند غياب currentLevel
```

كلاهما يجب أن يمرّا عبر **نفس** `orientation:bulkUpsert` بعد التطبيع، بنفس سياسة الدمج.

---

*نهاية المراجعة. أي تنفيذ لاحق يُفضَّل أن يفتح PR يشير إلى: مبادئ الخطة الأصلية + مراحل P0–P1 من هذه الوثيقة.*
)
