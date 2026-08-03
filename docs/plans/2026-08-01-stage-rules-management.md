# خطة إدارة قواعد المراحل — فهرس شامل (صلب/قابل للتعديل) + مقارنة الأساليب

**التاريخ:** 2026-08-01
**الحالة:** خطة تنفيذ مقترحة
**النطاق:** تحويل قواعد المراحل (المعاملات، نسب الأنشطة المندمجة، عدد الفروض، المواد، المستويات) من صلابة الكود إلى فهارس مؤسسية قابلة للتعديل مع حوكمة — خطة مستقلة مبنية على [خطة كتالوج الابتدائي](./2026-08-01-primary-stage-catalogs.md). التنفيذ يشمل المعاملات وعدد الفروض ونسب الفروض/الأنشطة للسلك الثانوي التأهيلي.
**القرارات المعتمدة من المستخدم:**
1. صلاحية التعديل: **admin + principal** (مع سبب إجباري مسجل).
2. القواعد الرسمية (الوزارة): **الرسمي يُحدَّث تلقائياً عند تحديث التطبيق، التجاوزات المخصصة تبقى محفوظة**.
3. التنفيذ: **خطة مستقلة** تمدّد خطة المرحلة الابتدائية.
4. الصف الرسمي والصف المخصص **يتعايشان**؛ لا يُستبدل الرسمي عند إنشاء التجاوز.
5. كل قاعدة تؤثر في النتائج مرتبطة بسنة دراسية وبـ **نسخة قواعد فعالة**؛ لا تعديل صامت لنسخة مغلقة.
6. الإصدار الحالي يشمل المعاملات وعدد الفروض ونسب الفروض/الأنشطة للسلك الثانوي التأهيلي؛ الصيغة الحسابية نفسها تبقى ثابتة.

---

## 0. الخلاصة التنفيذية

- اليوم معظم قواعد المرحلة **صلبة في الكود** (`js/cc-rules.js`، `js/shared/education/cycles.js`، `main/db/exam-count-defaults.js`)؛ القابل للتعديل فقط: عدد الفروض، وصول الصفحات، أسلاك المؤسسة، وتجاوز معاملات إداري **مقيّد بالسلك التأهيلي** مخزّن كـ JSON في `settings`.
- **الفجوات:** لا تعديل لنسب الأنشطة المندمجة إطلاقاً، لا إنشاء مواد/مستويات من الواجهة، ازدواجية أسماء المواد في 4+ أماكن، `exam_count_rules` بلا بعد السلك، لا قواعد ترقية.
- **النهج المختار:** «فهارس مركّزة في DB + عمود `source` (official/custom) + إصدارات» — طبقتان: صيغ الحساب تبقى صلبة، والبيانات المرجعية تنتقل إلى جداول متزامنة قابلة للتعديل (admin/principal) مع تدقيق كامل.
- **تصحيح جوهري للنهج:** `source` وحده لا يصنع إصدارات. تُنشأ مجموعة قواعد versioned لكل سنة دراسية، وتكون صفوفها غير قابلة للتعديل بعد تفعيلها؛ الحفظ/الاستعادة ينشئان نسخة فعالة جديدة.
- **تقليل المخاطر:** الأوزان ليست في الإصدار الأول؛ فهي قدرة جديدة تغيّر المعدلات وليست مجرد ترحيل للسلوك الحالي.
- **الترابط:** تستفيد من بنية خطة الابتدائي (`education_levels`، `education_subjects`، `cycle_profiles`) وتُوسّعها بجداول القواعد ذات النسخ + الواجهة.

---

## 1. الفهرس الشامل — كل عنصر: صلب أم قابل للتعديل (الوضع الحالي)

### 1.1 عناصر صلبة 100% (تغييرها يتطلب إصدار تطبيق جديد)

| # | العنصر | الملف/الموقع | ملاحظات |
|---|---|---|---|
| 1 | كتالوج الأسلاك (أسماء AR/FR، `capability`، `sortOrder`، `profileVersion`) | `js/shared/education/cycles.js:4-21` | لا override — خطاف المزامنة يعيد الاشتقاق من الكتالوج (`main/sync/apply-hooks.js:63-74`) |
| 2 | استدلال السلك (`inferCycleFromSection/Level`) | `js/shared/education/cycles.js:41-60` | أنماط `1APIC`، `TCS`، `2BAC` |
| 3 | معاملات المواد الرسمية `CC_BRANCH_COEFFICIENTS` (13 شعبة: 2BAC×8، 1BAC×3، جذع×2) | `js/cc-rules.js:224-554` | مرجع مذكرة 142 لوزارة التربية |
| 4 | **نسبة الأنشطة المندمجة** `CC_SUBJECT_WEIGHTS` (75/25 افتراضي، فرنسية 80/20، لغات أجنبية ثانية 60/40، رياضيات 100/0، مواظبة 100/0) | `js/cc-rules.js:17-132` | **لا override إطلاقاً** |
| 5 | خوارزميات الحساب (`computeSubjectAverage`، `computeWeightedGeneralAverage`) | `js/cc-rules.js:178-212, 831-895` | Σ(معدل×معامل)/Σ(معاملات) |
| 6 | استدلال المسالك `detectBranch` | `js/cc-rules.js:572-622` | regex عربي/فرنسي |
| 7 | قائمة مستويات التأهيلي `LEVEL_CODES` (37 + `*`) | `main/db/exam-count-defaults.js:26-69` | القائمة صلبة؛ قيم الجدول أدناه قابلة للتعديل |
| 8 | الأسماء الافتراضية للمواد `DEFAULT_EXAM_COUNTS` (15 مادة) | `main/db/exam-count-defaults.js:7-23` | بذرة |
| 9 | الحدود التقنية: `CHECK 1..12` للفروض، المعامل 1..20 | `main/db/migrations.js:1915`؛ `main/repos/subject-coefficients.js:25` | قيود schema |
| 10 | عتبات النتائج/الترقية (مقبول ≥10، فئات 10–12...) | `js/pages/results-hub.js:233`؛ `js/pages/analytics.js:16` | لا توجد قواعد ترقية حقيقية |
| 11 | ملصقات الصفحات `PAGE_LABELS` | `main/db/exam-count-defaults.js:72-122` | |
| 12 | ترجمة المواد فرنسي→عربي | `js/utils.js` (`SUBJECT_FR_TO_AR`)؛ `js/data/ma-education-labels.js` | |

### 1.2 عناصر قابلة للتعديل (الوضع الحالي)

| # | العنصر | التخزين | من يعدّل | الواجهة | المزامنة |
|---|---|---|---|---|---|
| 1 | عدد الفروض `exam_count_rules` | جدول SQLite (بذرة من `DEFAULT_EXAM_COUNTS`) | admin + developer (`appDefaults:saveExamCounts`) | `settings-defaults.html` (تبويب 1) | ✅ `examCountRules` snapshot |
| 2 | تجاوز معاملات المواد `subjectCoefficientMappings:v1` | JSON في `settings` | admin فقط + سبب إجباري + سجل `SUBJECT_COEFFICIENT_ADMIN_OVERRIDE` | IPC (يستهلكه cc-rules) | ✅ snapshot `settings` |
| 3 | وصول الصفحات `page_role_access` | جدول SQLite (افتراضي من `PAGE_PERMISSIONS`) | admin + developer | `settings-defaults.html` (تبويب 2) | ✅ `pageRoleAccess` |
| 4 | أسلاك المؤسسة `institution_cycles` | جدول SQLite | admin + principal | `settings-school.html` | ✅ |
| 5 | إخفاء صفحات لكل مستخدم `page_visibility` | جدول SQLite | admin | `settings-users.html` | ✅ |

### 1.3 عناصر شبه منفذة (جداول فارغة بلا زرع ولا UI)

| العنصر | الجدول | الحالة |
|---|---|---|
| المستويات الرسمية | `education_levels` (`schema.js:905`) | فارغ |
| مرادفات المستويات | `level_aliases` (`schema.js:917`) | فارغ |
| المواد الرسمية | `education_subjects` (`schema.js:929`) | فارغ |
| مرادفات المواد | `subject_aliases` (`schema.js:937`) | فارغ |
| وصول مستخدم×سلك | `user_cycle_access` (`schema.js:895`) | يُملأ بالهجرة؛ لا IPC ولا UI |

---

## 2. المشاكل الجوهرية في الوضع الحالي

1. **ازدواجية أسماء المواد/المستويات في 4+ أماكن** — أي مادة جديدة = تعديلات متزامنة، عدم التطابق ينكسر بصمت.
2. **نسب الأنشطة المندمجة غير قابلة للتعديل إطلاقاً**.
3. **تجاوز المعاملات مقيد بالسلك التأهيلي صراحة** (`main/repos/subject-coefficients.js:4,27,51`) — غير جاهز للإعدادي/الابتدائي.
4. **`exam_count_rules` بلا بعد السلك** — PK `(level_code, subject)` (تُعالج في خطة الابتدائي S3).
5. **لا UI لإنشاء مادة أو مستوى جديد**.
6. **لا قواعد ترقية** — ستُحتاج لاحقاً.

---

## 3. مقارنة الأساليب (Debate) والقرار

### الأسلوب أ — صلبة 100%
- **+** دقة القواعد الرسمية، بلا أخطاء إدارية، أسهل اختباراً، إصدار موحد.
- **−** كل تعديل قانوني = إصدار جديد؛ المؤسسات الخاصة بمقررات مختلفة محرومة. **مرفوض وحده.**

### الأسلوب ب — قابلة للتعديل 100%
- **+** مرونة قصوى.
- **−** تناقض بين الأجهزة، لا نسخة رسمية، أخطاء إدارية تسمم المعدلات، تعقيد. **مرفوض.**

### الأسلوب ج — هجين خفيف (الوضع الحالي)
- **+** قاعدة رسمية افتراضية + تجاوز مسجل.
- **−** تجاوز جزئي (لا أوزان)، لا إنشاء مواد/مستويات، ازدواجية قائمة، لا «إصدار قاعدة». **نقطة انطلاق فقط.**

### الأسلوب د — فهارس مؤسسية مركّزة + `source` + إصدارات ✅ (المعتمد)
نقل القواعد إلى جداول مرجعية متزامنة بعمود `source` (`official`/`custom`) وسجل تدقيق وإصدار profile:
- البذرة `official` تُشحن مع التطبيق وتُحدَّث تلقائياً بإصدار قواعد جديد؛ لا يجوز لجهاز أقدم أن يعيد إصداراً رسمياً أقدم.
- تجاوز الإداري يكتب صفاً `custom` في النسخة الفعالة ويفوز في الحل؛ عند تحديث الرسمي تُنسخ التجاوزات إلى النسخة الجديدة ولا تُحذف.
- **+** مصدر واحد للحقيقة، مرونة محكومة، تدقيق كامل، مزامنة طبيعية، جاهزية للابتدائي/الإعدادي.
- **−** تكلفة تطوير أعلى.

### الأسلوب هـ — استيراد/تصدير JSON لقواعد كاملة
- **+** نسخ القواعد بين المؤسسات.
- **−** تباين محتمل، تحقق معقد. **مكمّل اختياري لاحقاً، ليس في النطاق.**

### القرار النهائي
**الأسلوب د المقسّم (طبقتان):**
- **طبقة صلبة (لا تُعدَّل من الواجهة):** صيغ الحساب، حدود التحقق (1..12، 1..20)، `capability` الأسلاك.
- **طبقة قابلة للتعديل (admin + principal):** المستويات + مرادفاتها، المواد + مرادفاتها، المعاملات، عدد الفروض؛ نسب الأنشطة وقواعد الترقية لاحقاً بعد تثبيت دورة حياة النسخ.

---

## 4. الشرائح

### الشريحة M1 — البنية ونسخ القواعد (مبنية على خطة الابتدائي)

- [ ] جدول `stage_rule_sets` لإصدارات القواعد:
      `id INTEGER PRIMARY KEY AUTOINCREMENT`, `school_year TEXT NOT NULL`,
      `revision INTEGER NOT NULL`, `status TEXT NOT NULL CHECK(status IN ('draft','active','closed'))`,
      `created_by TEXT`, `reason TEXT NOT NULL`, `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
      `UNIQUE(school_year, revision)`، مع فهرس فريد جزئي يسمح بنسخة `active` واحدة لكل سنة.
- [ ] جدول `subject_coefficients`:
      `id INTEGER PRIMARY KEY AUTOINCREMENT`, `rule_set_id INTEGER NOT NULL`,
      `cycle_code TEXT NOT NULL`, `level_code TEXT NOT NULL`, `stream_code TEXT NOT NULL`,
      `subject_code TEXT NOT NULL`, `coefficient INTEGER NOT NULL CHECK(coefficient BETWEEN 1 AND 20)`,
      `source TEXT NOT NULL CHECK(source IN ('official','custom'))`,
      `updated_by TEXT`, `reason TEXT`, `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
      `FOREIGN KEY(rule_set_id) REFERENCES stage_rule_sets(id)`,
      `UNIQUE(rule_set_id, cycle_code, level_code, stream_code, subject_code, source)`.
      **لا يُستخدم composite PK مكان `id`** لأن طبقة المزامنة تعتمد على `localIdField: 'id'`.
- [ ] نقل `exam_count_rules` إلى النسخة الفعالة: إضافة `id INTEGER PRIMARY KEY AUTOINCREMENT` و`rule_set_id` و`cycle_code` وإعادة بناء المفتاح المنطقي إلى
      `(rule_set_id, cycle_code, level_code, subject_code)` مع backfill الصفوف القائمة إلى نسخة `secondary_qualifiant`.
      إذا بقي اسم العمود `subject` في الإصدار الانتقالي، يجب توثيق أنه legacy وتحديثه لاحقاً ضمن عقد واحد مع IPC والمزامنة.
- [x] **أُضيف `subject_weight_rules` لنفس `rule_set_id`.** uniqueness تشمل
      `(rule_set_id, cycle_code, subject_code, source)`؛ تخزَّن نسبتا الفروض والأنشطة بوحدة basis points ومجموعهما 10000.
- [x] استخراج بيانات `CC_BRANCH_COEFFICIENTS` و`CC_SUBJECT_WEIGHTS` إلى وحدات بذرة `main/db/education-catalogs/*` — `js/cc-rules.js` يحتفظ بالتوافق القديم فقط، والحساب يستخدم النسخة النشطة.
- [x] زرع idempotent (الهجرتان `2026-08-078` و`2026-08-079`): إنشاء نسخة قواعد رسمية، وبذر المعاملات والفروض والأوزان المدعومة، بدمج logical key لا إعادة إدراج.
- [ ] عدم زرع معاملات للابتدائي: `cycle_profiles.uses_coefficients = false` هو العقد، وأي حساب ابتدائي يجب أن يتوقف قبل استدعاء resolver المعاملات.
- [ ] **ربط effectivity:** `cycle_profile_assignments.rule_set_id` هو نسخة القواعد التي يقرأها runtime لكل `(school_year, cycle_code)`؛ كل revision جديد أو ترقية رسمية تحدث assignment المرتبط داخل نفس transaction، وتُرفض أي تركيبة profile/rule-set غير متوافقة.
- [ ] ترحيل `subject` النصي الحالي إلى `subject_code` عبر catalog/aliases. الصفوف غير القابلة للمطابقة تُسجل كفشل ترحيل ولا تُحوّل إلى رمز تخميني.

### الشريحة M2 — طبقة الوصول

- [ ] `main/repos/subject-coefficients.js`: قراءة النسخة الفعالة حسب `schoolYear`، وإنشاء نسخة جديدة عند كل حفظ أو استعادة؛ الانتقال عبر `capture-port` وعدم الكتابة إلى صف `official` من مسار المستخدم.
- [ ] resolver لا يختار `MAX(revision)` مستقلاً عن profile assignment: يقرأ assignment authoritative ثم `rule_set_id` المشار إليه، ويتحقق من تطابق السنة والحالة `active` و`uses_coefficients`.
- [ ] تحديث `main/repos/subject-coefficients.js` لإزالة `QUALIFIANT_CYCLE` والـ JSON القديم بعد ترحيله؛ يبقى مفتاح `subjectCoefficientMappings:v1` legacy غير مقروء وغير قابل للكتابة خلال فترة rollback محددة.
- [ ] IPC: `stageRules:getActive`, `stageRules:saveCoefficients`, و`stageRules:resetToOfficial` عبر `handleAuthedRead` و`handleWriteSoftAuth(admin, principal)` مع `withContext: true`؛ تحديد السلك من session/`resolveCycleForRequest` والتحقق من `user_cycle_access`.
- [ ] `stageRules:saveCoefficients` ينشئ `custom` فقط، و`stageRules:resetToOfficial` ينشئ نسخة فعالة جديدة بإزالة التجاوز المحدد؛ توفير reset صفّي وreset جماعي بتأكيد صريح.
- [ ] سجل التدقيق الموحد للإصدارات الجديدة: `STAGE_RULE_OVERRIDE`. يبقى فلتر السجلات قادراً على عرض `SUBJECT_COEFFICIENT_ADMIN_OVERRIDE` التاريخي.
- [ ] **ترقية الرسمي:** عند تحديث التطبيق تُنشأ نسخة رسمية جديدة، وتُنقل إليها صفوف `custom` من النسخة السابقة. لا يسمح apply/sync بإنزال `revision` أقدم فوق الأحدث.
- [ ] تعريف عقد الحل قبل كتابة الواجهة: ترتيب البحث هو exact `(cycle, level, stream, subject)`، ثم wildcard stream، ثم wildcard level، ثم default cycle؛ `custom` يفوز داخل نفس المفتاح، وعدم وجود قاعدة يرجع خطأ مجالياً.
- [ ] `js/cc-rules.js`: تحميل نسخة القواعد كاملة قبل الحساب؛ لا fallback صامت إلى الثوابت عند فشل IPC، بل حالة `RULES_UNAVAILABLE` تمنع التصدير الرسمي. يجب تمرير `cycleCode`, `levelCode`, `streamCode`, و`schoolYear` إلى resolver.

### الشريحة M3 — الواجهة

- [ ] تبويب «قواعد المرحلة» في `settings-defaults.html`: اختيار سنة دراسية ← سلك ← مستوى/شعبة ← مادة ← (معامل، عدد فروض) + شارة المصدر/النسخة + زر «استعادة الافتراضي الرسمي» لكل صف + حقل سبب إجباري عند الحفظ.
- [ ] `js/pages/settings-defaults.js`: استهلاك نقاط `appDefaults.listLevels(cycleCode)` (التوسيع البرمجي من خطة الابتدائي S5) + نماذج الجداول الجديدة.
- [ ] `settings-defaults.js`: عرض النسخة الفعالة وحالتها (`draft`/`active`/`closed`) وعدم السماح بتعديل نسخة `closed`.
- [ ] `settings-logs.html`: ربط سجلات التدقيق الجديدة (`STAGE_RULE_OVERRIDE`) مع إبقاء الإجراء التاريخي للقراءة فقط.

### الشريحة M4 — التحقق والتوثيق

- [ ] اختبارات: تعايش `custom` و`official`؛ reset يعيد الرسمي دون فقده؛ إنشاء نسخة جديدة عند كل حفظ؛ النسخة المغلقة غير قابلة للتعديل؛ migration لا تمس `custom`.
- [ ] اختبارات resolver لكل فروع precedence، وكل combination تنتجه `detectBranch`، وفشل واضح عند غياب القاعدة أو فشل تحميل IPC.
- [ ] تحديث `main/sync/entity-registry.js`: تسجيل `stage_rule_sets` و`subject_coefficients` و`exam_count_rules`، مع `localIdField: 'id'`؛ و`keyFields`/remote `idFields` تشمل `rule_set_id` وجميع أبعاد القاعدة و`source`؛ تحديث `contractVersion` و`requiredColumns`.
- [ ] عقد sync المشترك مع خطة catalogs يسجل `cycle_profiles` و`cycle_profile_assignments` ويفرض `minAppVersion`؛ مالك الحقل هو sync/registry، والمقارنة semantic-version مع إصدار التطبيق المحلي، وجهاز أقدم يحجر الصف قبل apply، ولا يسمح downgrade أو profile غير معروف.
- [ ] اختيار نمط الالتقاط كتابةً: إما explicit outbox داخل معاملة repo مع `exclude: true`، أو snapshot-only مثل `examCountRules`؛ لا تخلط السلوكين بلا سبب موثق. اختبار conflict/LWW والمستخدمين المتزامنين.
- [ ] اختبار ترقية رسمي من جهاز قديم لا يعيد revision أقدم، واختبار أن migration لا تنشئ outbox لبيانات البذر المحلية إلا إذا كان ذلك مقصوداً في عقد المزامنة.
- [ ] `npm test` + `npm run lint`.
- [ ] تحديث `AGENTS.md` (قسم قواعد المراحل).
- [ ] ملاحظات التنفيذ في `specs/`.

---

## 5. خارج النطاق (شريحة لاحقة)

- قواعد الترقية `promotion_rules` وقواعد أخرى غير مرتبطة بحساب المعدل.
- قواعد الترقية/النجاح `promotion_rules` (جدول وعتبات).
- استيراد/تصدير ملف قواعد JSON (الأسلوب هـ).
- تحويل `inferCycle`/`detectBranch` إلى aliases قابلة للتعديل.
- `capability` الأسلاك غير المدعومة (رفع الدعم = قرار إصدارات).

---

## 6. قرارات دورة الحياة والأسئلة المفتوحة

1. هل تُغلق نسخة القواعد عند إغلاق الفصل أم عند إغلاق السنة الدراسية؟ الافتراضي: إغلاق السنة، مع إمكانية إنشاء نسخة جديدة قبل الإغلاق.
2. تجاوزات المعاملات الحالية المخزنة في `settings` (مفتاح `subjectCoefficientMappings:v1`) تُرحَّل كصفوف `custom` بسبب migration، ثم يتوقف الكود عن قراءة/كتابة المفتاح. يبقى rollback-only لإصدار واحد فقط، ولا تُكتب إليه تغييرات جديدة.
3. نطاق «استعادة الافتراضي الرسمي»: كلاهما؛ reset صفّي افتراضي، وreset جماعي بتأكيد صريح وسجل تدقيق.
4. صلاحية `principal`: يعدّل القيم فقط (المعامل وعدد الفروض)، بينما إنشاء/تعطيل المواد والمستويات والمرادفات من صلاحية `admin`.

## 7. عقد التنفيذ الإلزامي قبل بدء البرمجة

- [x] اعتماد نموذج `stage_rule_sets` والنسخ immutable؛ لا يكفي إضافة `updated_at` أو `source` إلى جدول mutable.
- [x] اعتماد subject catalog كمرجع canonical، وتوثيق mapping/فشل ترحيل الأسماء النصية.
- [x] اعتماد remote identity والمزامنة قبل كتابة repos: `id` محلي، logical keys كاملة، وrevision يمنع الرجوع للخلف.
- [x] اعتماد سياق الحساب الإلزامي (`cycleCode`, `levelCode`, `streamCode`, `schoolYear`) وسياسة `RULES_UNAVAILABLE`.
- [x] تحديث هذه الخطة وخطة `primary-stage-catalogs` معاً عند تغيير ملكية `exam_count_rules` أو `subject-coefficients` (ملاحظات الملكية في §8 أدناه وملاحظة الملكية في الخطة الشقيقة).

## 8. حالة التنفيذ (2026-08-02)

نُفذت جميع الشرائح M1–M4 على الفرع `029-stage-rules-management`:

| الشريحة | الحالة | ملاحظات |
|---|---|---|
| M1 — البنية والنسخ | ✅ | `ensureStageRulesSchema` في `schema.js`؛ هجرة `2026-08-001` idempotent بلا outbox؛ البذور في `main/db/education-catalogs/` |
| M2 — طبقة الوصول | ✅ | `main/repos/stage-rules.js` + `main/ipc/stage-rules.js` + `revisionGuard`؛ إيقاف `subjectCoefficients:*` (rollback-only) |
| M3 — الواجهة | ✅ | تبويب «قواعد المرحلة» + الاستعادة الصفّية/الجماعية + فلتر التدقيق في `settings-logs` |
| M4 — التحقق والتوثيق | ✅ | `npm test` 241/241، lint 0 أخطاء، smoke ✅، css:build ✅، قسم `AGENTS.md`، ملاحظات التنفيذ في `specs/029-stage-rules-management/implementation-notes.md` |

- الحل المدمج: exact → stream wildcard → level wildcard → cycle default → `MISSING_RULE`؛ لا fallback للثوابت؛ `custom` يفوز داخل المفتاح.
- مرجع SSOT: `specs/029-stage-rules-management/contracts/{stage-rules.ipc,resolver,sync-entities}.md`.
- **ملكية `exam_count_rules`:** انتقلت فعلياً إلى خطة stage-rules (إعادة البناء ببعد السلك والنسخ في الهجرة) — أُنجز بند التسليم في الخطة الشقيقة.
- **مؤجل:** بوابة التصدير الرئيسية `reports:printDocument`، حالة `draft`.
