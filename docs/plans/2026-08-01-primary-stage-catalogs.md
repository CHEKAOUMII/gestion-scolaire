# خطة إضافة المرحلة الابتدائية + فهرسة المراحل الثلاث (الابتدائي، الإعدادي، التأهيلي) — الشريحة: البنية والفهارس

**التاريخ:** 2026-08-01
**الحالة:** خطة تنفيذ مقترحة
**النطاق:** البنية (schema) والفهارس (catalogs) فقط — لا تدفقات (import/report) ولا واجهات في هذه الشريحة.
**المصادر:** بحث في أفضل الممارسات (نموذج "قاعدة بيانات واحدة + معرّف المرحلة في كل جدول"، cf. multi-branch school schema) + مطابقة مع بنية Pencil2 الحالية.

---

## 0. الخلاصة التنفيذية

- Pencil2 يمتلك اليوم معظم البنية اللازمة للمراحل: `cycle_code` على **الجداول المقيدة المترحّلة**
  (`absences`, `grades`, `institution_cycles`, `students`, `support_sessions`,
  `teacher_teaching_assignments` — وستضيف شريحة S7 الأربعة: `student_files`,
  `student_movements`, `correspondence`, `student_profile_data`)، إضافة إلى
  `user_cycle_access`، `resolveCycleForRequest`، والجداول المرجعية
  `education_levels` / `education_subjects` (منشأة **فارغة**).
  **الجداول غير المقيدة بعد (قائمة صريحة):** `exams`/`exam_proctors` (S5)،
  `student_orientation`، `staff_attendance`/`teacher_absences` (S8 — مؤسسيان بالتصميم)،
  `tests` (S5). لا تُعدّ هذه الشريحة أن التقييد شامل.
- **القرار التصميمي:** المرحلة = السلك = بُعد `cycle_code` الحالي. لا كيان `stage` جديد، لا قواعد بيانات منفصلة.
- **الفجوة:** `CYCLE_CATALOG` يفتقد الابتدائي؛ فهارس المستويات والمواد غير مزرعة؛
  المعاملات معاملات صلبة على `secondary_qualifiant`؛ قوائم المستويات (`LEVEL_CODES`) تأهيلي فقط ومكررة.
- هذه الشريحة تسد الفجوة: زرع الفهارس + تعميم إعدادات المرحلة + تحقق.

---

## 1. المبادئ

1. **الابتدائي يُضاف بـ `capability: 'not_supported'`** ولا يُرفع إلا في شريحة التدفقات لاحقاً (لا يكسر حارس "آخر سلك مدعوم" في `main/repos/cycles.js`).
2. **الفهرس مصدر واحد للحقيقة:** المستويات والمواد والمرادفات تُزرع من وحدات مركزية، لا نصوص مكررة.
3. **الإعدادي يُكمل ما ينقصه** (مستويات `1APIC`–`3APIC` غير موجودة في `LEVEL_CODES` أصلاً) في نفس الشريحة.
4. **الابتدائي بلا معاملات** — نموذج التقويم المستمر يُعبَّر عنه بعلامة في ملف المرحلة
   (`usesCoefficients: false` + `assessmentModel: 'continuous'`)، **وليس** بتخزين
   `coefficient: null` (التحقق `normalizeMapping` يرفض null/غير الموجب — `main/repos/subject-coefficients.js:25`).
   عدد الفروض للابتدائي لا يُزرع في هذه الشريحة قبل اعتماد القواعد الرسمية (حد `CHECK 1..12`
   لا يمثل «صفر فروض» — `main/db/migrations.js:1915`).
5. **كل تغيير يمر من المعايير الحالية:** `npm test` + `npm run lint`، وقنوات الكتابة عبر repos + capture-port حسب AGENTS.md.

---

## 2. الشريحة S1 — فهرس الأسلاك (SSOT)

**الملف:** `js/shared/education/cycles.js`

- [ ] إضافة `primary` إلى `CYCLE_CATALOG`:
  - `cycleCode: 'primary'`
  - `labelAr: 'سلك التعليم الابتدائي'`، `labelFr: 'Enseignement primaire'`
  - `sortOrder: 5`، `profileVersion: 'primary-2026-v1'`
  - `capability: 'not_supported'`
- [ ] توسيع `inferCycleFromSection` / `inferCycleFromLevel` بأنماط الابتدائي:
  - `[1-6]AP` (مقترح: `1AP`–`6AP`، بنفس أسلوب `1APIC`)
  - الأنماط العربية: `(الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة)\s*ابتدائي`
- [ ] تحديث اختبارات الوحدة للاستدلال (ابتدائي + عدم التصادم مع الإعدادي/التأهيلي).

## 3. الشريحة S2 — فهارس المستويات والمواد

**ملفات جديدة:** `main/db/education-catalogs/primary-levels.js`, `primary-subjects.js`, `primary-aliases.js`
**ملف:** `main/db/exam-count-defaults.js` (إعادة هيكلة)

- [ ] **مستويات الابتدائي (6):** `1AP`–`6AP` بأسماء عربية (الأولى ابتدائي … السادسة ابتدائي)،
      وتُضاف أيضاً `1APIC`–`3APIC` للإعدادي (ناقصة حالياً).
- [ ] **إعادة هيكلة `LEVEL_CODES` إلى فهرس لكل سلك** (`PRIMARY_LEVEL_CODES`, `COLLEGIAL_LEVEL_CODES`, `QUALIFIANT_LEVEL_CODES`) — يظل شكله القديم متوافقاً مع `appDefaults:listLevels` الحالي.
- [ ] **مواد الابتدائي:** اللغة العربية، الرياضيات، النشاط العلمي، الاجتماعيات، التربية الإسلامية، اللغة الفرنسية، التربية الفنية، التربية البدنية والحركية (+ مدخل التقويم المستمر).
- [ ] **قرار صريح — المواد فهرس مؤسسي مشترك (مراجعة 1):** `education_subjects.subject_code`
      PK عالمي و`subject_aliases.normalized_alias` فريد عالمياً بلا `cycle_code`
      (`main/db/schema.js:930-946`)، والمزامنة تعاملهما كمؤسسيين
      (`tests/sync-multi-cycle-contracts.test.js:64-68`). المواد مشتركة فعلياً بين المراحل
      (العربية، الفرنسية، الرياضيات…)، لذلك **لا تُنشأ جداول `cycle_subjects`**، ولا تُكرَّر
      المواد الموجودة. زرع الابتدائي = اتحاد `INSERT OR IGNORE` للرموز الغائبة فقط،
      وانتماء المرحلة يُنمذج لاحقاً عبر ربط مستوى↔مادة في ملف المرحلة (S4) — لا في فهرس المواد.
      تصادم `subject_aliases` يُحسم «الأول يفوز» بفعل القيد الفريد العالمي.
- [ ] **مرادفات استيراد الابتدائي:** `level_aliases` (مثل `السنة الاولى` → `1AP`، `السادسه` → `6AP`) و`subject_aliases` للمواد الابتدائية.

## 4. الشريحة S3 — الهجرة والزرع

**الملف:** `main/db/migrations.js` (هجرة جديدة، مثل `2026-08-01-primary-stage-catalogs`)

- [ ] زرع `education_levels` (الأسلاك الثلاثة)، `education_subjects`، `level_aliases`، `subject_aliases` — **عند غيابها** (idempotent، دمج بـ PK لا إعادة إدراج). زرع الـ`education_subjects` اتحاد عالمي (مراجعة 1).
- [ ] إدراج صف `institution_cycles` للابتدائي **بجملة SQL مباشرة idempotent داخل الهجرة** (نمط الهجرة القائمة `migrations.js:2064-2073`)، **لا** عبر `main/repos/cycles.js` — `addCycle` ينفّذ التقاط outbox و`notifyCaptureCommitted` (مراجعة 4، `main/repos/cycles.js:57-77`) وهي آثار جانبية مرفوضة أثناء الهجرة.
      **قرار صريح:** الصفوف المزرعة (أسلاك + فهارس) هي **بيانات بذر محلية** تُكتب عبر SQL الهجرة بلا outbox — لا عمليات مستخدم. `institution_cycles` يبقى قابلاً للمزامنة كجدول مقيد كالمعتاد للعمليات اللاحقة (add/setEnabled عبر IPC).
- [ ] **إعادة بناء `exam_count_rules` ببعد السلك (مراجعة 2 و7):** المفتاح يصبح
      `PRIMARY KEY (cycle_code, level_code, subject)` — رغم أن رموز المستويات فريدة عالمياً،
      يُضاف `cycle_code` اتساقاً مع بقية الجداول المقيدة وجعل النية صريحة.
      `backfill` الصفوف القائمة إلى `secondary_qualifiant`، ورفع `contractVersion`/`requiredColumns`
      في السجل عند إضافة الجدول للمزامنة، وتحديث مسارات `appDefaults.js:74-90` (lookup/save)
      ونقاط ما قبل التحميل.
      **لا تُزرع قواعد فروض الابتدائي في هذه الشريحة** — القاعدة الرسمية غير معتمدة،
      وحد `CHECK 1..12` لا يمثل «صفر فروض»؛ يُؤجَّل إلى شريحة التدفقات بعد تأكيد نموذج التقويم المستمر.
- [ ] التحقق: فهارس الابتدائي تظهر في `appDefaults:listLevels` عند تمرير `cycle_code: 'primary'` (توسيع `main/ipc/appDefaults.js` لتقبل السلك).

## 5. الشريحة S4 — ملفات المرحلة (بدل الصلابة)

- [ ] **`main/repos/subject-coefficients.js` (مراجعة 3):** تعميم `QUALIFIANT_CYCLE` إلى مفتاح تخزين لكل سلك
      (`subjectCoefficientMappings:{cycleCode}:v1`)؛ قبول `cycleCode` في حمولة الاعتماد؛
      قناة `subjectCoefficients:getAll` تنتقل إلى `handleAuthedRead` مع `resolveCycleForRequest`
      (اليوم `handleRead` بلا سلك — `main/ipc/subject-coefficients.js:8-16`).
      **لا يُخزَّن أي `coefficient: null`** — الابتدائي «بلا معاملات» يُعبَّر عنه عبر
      `usesCoefficients: false` في ملف المرحلة فقط، وقراءة المعاملات لسلك بلا معاملات ترجع قائمة فارغة.
- [ ] **جدول `cycle_profiles` (قرار ثابت — مراجعة 8):** جدول مقيد بالسلك، ليس JSON في `settings` —
      السبب: ملف المرحلة بيانات مؤسسية منظمة ومُتحقق منها ومُصدارتها وتحتاج المزامنة بين الأجهزة،
      بينما `settings` مخصص للإعداد المحلي للجهاز. أعمدة مقترحة:
      `cycle_code TEXT PK`, `profile_version`, `assessment_model` (`'exams'`|`'continuous'`),
      `periods` (JSON)، `default_exam_counts` (JSON)، `uses_coefficients INTEGER`,
      `report_template_key`, `updated_at`.
- [ ] إبقاء `grades.semester` (1/2) لكن قراءته تصبح مدفوعة بالملف لا مفترضة.

## 6. الشريحة S5 — التوصيل

- [ ] `populateSectionsFromStudents` في `main/db/migrations.js` يستقبل استدلال الابتدائي (S1) تلقائياً.
- [ ] التحقق من `main/sync/entity-registry.js`: سجلات الفهارس المزرعة لا تُنشئ outbox (بيانات بذر، لا عمليات مستخدم).
- [ ] **لا واجهات في هذه الشريحة (قرار مراجعة 5):** بند «تبويب مرحلة» في `settings-defaults.html` يُحذف من
      هذه الشريحة — تعارض مع نطاق «لا واجهات» (سطر 5). واجهة المرحلة (بما فيها استهلاك
      `appDefaults.listLevels(cycleCode)` في `js/pages/settings-defaults.js:136-160` بعد توسيع
      نقاط ما قبل التحميل `preload.js:70-75`) تُؤجَّل إلى شريحة التدفقات مع رفع `capability`.
      التوسيع البرمجي لنقاط `appDefaults` يقبل السلك (مراجعة 5) لكن بلا استهلاك واجهة.
- [ ] ملخص: أي استعلام قراءة/كتابة يمر بـ `resolveCycleForRequest` يظل محايداً للسلك.

## 7. الشريحة S6 — التحقق والتوثيق

- [ ] `npm test` + `npm run lint`.
- [ ] اختبارات repos: الزرع (idempotence)، الاستدلال، نقاط النهاية الواعية بالسلك، ملف المعاملات متعدد الأسلاك.
- [ ] **اختبارات قرارات المراجعة:** (1) اتحاد زرع `education_subjects` لا يكرر رموزاً قائمة و`subject_aliases` بلا تصادم؛
      (2) `backfill` صفوف `exam_count_rules` القائمة إلى `secondary_qualifiant` وإعادة بناء المفتاح؛
      (3) `cycle_profiles` جدولاً بمفتاح `cycle_code` و`uses_coefficients`/`assessment_model`؛
      (4) الهجرة تزرع `institution_cycles` مباشرة بلا outbox (فحص `sync_outbox` فارغ بعد الهجرة).
- [ ] تحديث `AGENTS.md` (قسم المراحل/الأسلاك).
- [ ] هذا الملف + ملاحظات التنفيذ في `specs/`.

---

## 8. خارج النطاق (شريحة لاحقة)

- تدفق استيراد الابتدائي، قوالب بيانات النتائج/الشواهد، مبدّل المرحلة في الواجهة،
  رفع `capability` إلى `supported`، صلاحيات صفحات لكل سلك.

## 9. أسئلة مفتوحة للمستخدم

1. رموز مستويات الابتدائي: مقترح `1AP`–`6AP` (تناسق مع `1APIC`). بديل: `P1`–`P6`.
2. الابتدائي بلا معاملات (تقويم مستمر) — مؤكد بـ `usesCoefficients: false` / `assessmentModel: 'continuous'`
   (أجابت المراجعة 3 و7 على طريقة التمثيل؛ يبقى التأكيد التربوي للمستخدم).
3. قواعد عدد الفروض الرسمية للابتدائي غير معتمدة بعد — لا تُزرع في هذه الشريحة (مراجعة 7).

---

## 10. ملاحظات المراجعة — ثماني ملاحظات مُتحقق منها ومقبولة (2026-08-01)

راجَع فريق التنفيذ الخطة مقابل الكود قبل البدء؛ كل ملاحظة أدناه تحقّقت من موضعها وأُدمج إصلاحها في
الشرائح أعلاه. **الخلاصة: الخطة سليمة الاتجاه، وتُنفَّذ بعد دمج الملاحظات 1–4 في النص (تم).**

| # | الملاحظة | الحدة | التحقق في الكود | القرار المدمج |
|---|---|---|---|---|
| 1 | مواد/مرادفات المرحلة غير قابلة للتمثيل (فهرس عالمي بلا سلك) | عالية | `schema.js:930-946` (PK عالمي + `UNIQUE` عالمي)؛ `sync-multi-cycle-contracts.test.js:64-68` (مؤسسي) | **قرار صريح:** الفهرس يبقى مؤسسياً مشتركاً، زرع اتحادي، انتماء المرحلة في ملف المرحلة (S2) |
| 2 | `exam_count_rules` بلا بُعد السلك | عالية | `migrations.js:1913-1919` (PK `(level_code, subject)`)؛ `appDefaults.js:74-90` | إعادة بناء المفتاح `(cycle_code, level_code, subject)` + backfill + تحديث مسارات (S3) |
| 3 | `coefficient: null` يناقض التحقق الحالي | عالية | `subject-coefficients.js:21-31` (يرفض null)؛ `subject-coefficients.js:4,27,51-53` (سلك صلب)؛ IPC/preload بلا سلك | `usesCoefficients: false` في ملف المرحلة، لا null؛ IPC → `handleAuthedRead` + سلك (S4) |
| 4 | الهجرة لا تزرع عبر `cyclesRepo.addCycle` | عالية | `cycles.js:57-77` (التقاط outbox + `notifyCaptureCommitted`)؛ `migrations.js:2064-2073` (نمط SQL مباشر) | زرع بـ SQL مباشر idempotent؛ قرار صريح: صفوف البذر محلية بلا outbox (S3) |
| 5 | تناقض النطاق: «لا واجهات» مقابل «تبويب مرحلة» | متوسطة | السطران 5 و79 (ترقيم الخطة الأصلية)؛ `preload.js:70-75`؛ `settings-defaults.js:136-160` | حذف الواجهة من الشريحة؛ التوسيع البرمجي للـ API فقط (S5) |
| 6 | ادعاء الخط الأساس واسع | متوسطة | `migrations.js:2020-2040` (`student_orientation` بلا `cycle_code`)؛ `sync-multi-cycle-contracts.test.js:71-75` (التقييد محدود بـ 6 جداول) | إعادة صياغة الخط الأساس مع قائمة الفجوات الصريحة (§0) |
| 7 | افتراضات تقييم الابتدائي متعارضة (بلا فروض مقابل افتراضي 2) | متوسطة | `appDefaults.js:76-81` (حد 1..12)؛ `migrations.js:1915` (CHECK 1..12) | لا زرع لفروض الابتدائي قبل اعتماد القاعدة؛ التمثيل عبر `assessmentModel` (S3/§0) |
| 8 | تنفيذ `cycle_profiles` غير محسوم (جدول أم JSON) | متوسطة | — | **جدول** بمفتاح `cycle_code`: منظم، مُتحقق، مُصدَّر، متزامن (S4) |

**ملاحظتان توضيحيتان للقرارات:** (2) رموز المستويات فريدة عالمياً، فـ`cycle_code` في مفتاح الفروض
تقوية اتساق لا ضرورة منطقية؛ أُضيف لمواءمة النمط العام. (1) اختير «فهرس عالمي + انتماء منفصل»
بدل `cycle_subjects` لأن المواد مشتركة فعلياً بين المراحل، والانتماء الحقيقي عند مستوى
مستوى↔مادة في ملف المرحلة لا في كتالوج المواد.
