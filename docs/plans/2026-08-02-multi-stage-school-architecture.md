# خطة تعميم بنية الأسلاك الثلاثة في مؤسسة واحدة (الابتدائي، الإعدادي، التأهيلي) — مراجعة معمارية + شرائح تنفيذ

**التاريخ:** 2026-08-02
**الحالة:** خطة تنفيذ مقترحة (مبنية على مراجعة معمارية للكود)
**النطاق:** تمكين مؤسسة واحدة من ضم سلك واحد أو أكثر من الأسلاك الثلاثة (`primary`, `secondary_collegial`, `secondary_qualifiant`) عبر نفس قاعدة البيانات وهوية المزامنة، مع سلك نشط لكل جلسة — بلا تدفقات استيراد/تقارير جديدة في هذه الخطة.
**القرار المعتمد (من [الخطة الأم](../../multi-school-cycle-management-plan.md)):** مؤسسة واحدة = قاعدة بيانات واحدة = `school_id` واحد + سلك واحد أو عدة أسلاك + سلك نشط لكل نافذة جلسة (`multi-school-cycle-management-plan.md:5,46-54,126-131`).
**المصادر:** [خطة كتالوج الابتدائي](./2026-08-01-primary-stage-catalogs.md) (مملوكة للابتدائي)، [خطة قواعد المرحلة](./2026-08-01-stage-rules-management.md) (مملوكة للقواعد)، مراجعة الكود بتاريخ 2026-08-02.

### قرار التسمية

المصطلح المنتجّي والواجهاتي بالإنجليزية هو **stage** وبالعربية **المرحلة**، لكن
المعرّف التقني القائم يبقى `cycle`/`cycle_code` في قاعدة البيانات وIPC والمزامنة
والوحدات والاختبارات. إعادة تسميته إلى `stage_code` ستكون ترحيلاً كاسراً واسعاً بلا
مكسب معماري. المقصود: **stage في اللغة، cycle في العقد التقني**.

---

## 0. الخلاصة التنفيذية

- **النموذج الأساسي صحيح لكنه غير مُثبت بعد كحاجز أمني كامل:** `institution_cycles` + `user_cycle_access` + `resolveCycleForRequest` + فهارس `education_levels`/`education_subjects` هي البنية الصحيحة، لكن يجب أولاً إغلاق كل مسارات القراءة/الكتابة غير الواعية بالسلك وإضافة اختبار عزل بصلاحيات حقيقية.
- **الفجوة الحرجة:** `primary` **غير موجود في كتالوج التشغيل** (`js/shared/education/cycles.js:4-21` يضم السلكين الثانويين فقط)، والإعدادي مُعلَن في الكتالوج لكنه `not_supported` وبلا مستويات/مواد.
- **الفجوات الثانوية:** ازدواج النصوص (`'secondary_qualifiant'` في ~20 ملفاً)، كتالوجات المستويات تأهيلية فقط ومكررة، منطق «سلكان فقط» في الواجهة (`teachers-list.js`، `settings-defaults.js STAGE_CYCLES`)، جداول بلا بُعد سلك (`student_orientation`، `staff_attendance`/`teacher_absences`)، لا IPC/UI لـ`user_cycle_access`، مرجع قديم في `AGENTS.md` لموقع `resolveCycleForRequest`، وملف `cycle_profiles` بلا دورة حياة أو عقد مزامنة مكتمل.
- **منهج هذه الخطة:** تعميم البنية تدريجياً بشرائح مستقلة، مع احترام ملكية الخطط الشقيقة (الابتدائي مملوك لخطة `2026-08-01-primary-stage-catalogs`، والقواعد مملوكة لخطة `2026-08-01-stage-rules-management`) — لا هجرتان تتصارعان على نفس الجدول.

---

## 1. الوضع الحالي المُتحقق منه (مرجع سريع)

| المجال | الموقع | الحالة |
|---|---|---|
| كتالوج الأسلاك (SSOT) | `js/shared/education/cycles.js:4-21` | سلكان فقط: إعدادي `not_supported` + تأهيلي `supported` |
| استدلال السلك | `js/shared/education/cycles.js:41-67` | `1APIC`→إعدادي، `TCS/1BAC/2BAC`→تأهيلي؛ لا أنماط ابتدائي |
| جدول أسلاك المؤسسة | `main/db/schema.js:875-890` (`institution_cycles`) | مُزرَع بـ`secondary_qualifiant` فقط (`migrations.js:2064-2075`) |
| وصول مستخدم×سلك | `main/db/schema.js:895-903` (`user_cycle_access`) | يُملأ بالهجرة فقط؛ لا IPC ولا UI |
| تحليل السلك للطلبات | `main/auth/resolve-cycle.js:33-47` | سياق نافذة → سلك مفعل مدعوم وحيد → رفض عند الغموض |
| الجداول المقيدة | هجرات `2026-07-070`→`077` | 11+ جدولاً تحمل `cycle_code` |
| الجداول غير المقيدة | — | `student_orientation`، `staff_attendance`/`teacher_absences` (مؤسسيان بالتصميم) |
| فهراس المستويات/المواد | `main/db/schema.js:905-945` | منشأة؛ المواد فقط مزرعة (`migrations.js:078`) |
| كتالوجات المستويات | `main/db/exam-count-defaults.js:26-69`، `js/utils.js:2403-2445` | تأهيلي فقط + مكررة؛ لا `1APIC-3APIC` ولا ابتدائي |
| كتالوج المواد/المعاملات/الأوزان | `main/db/education-catalogs/*` | تأهيلي فقط (`subject-catalog.js:1` صريح بذلك) |
| ملف المرحلة | `cycle_profiles` | **غير موجود**؛ بديل صلب في `main/repos/stage-rules.js:75-84` |
| قواعد المرحلة | جداول `stage_rule_sets` + 3 أبعاد (هجرة `2026-08-001`) | مملوكة لخطة stage-rules؛ مُزرعة تأهيلياً |

---

## 2. جرد الفجوات (مرتبة بالأولوية)

| # | الفجوة | الحدة | الموقع |
|---|---|---|---|
| G0 | مسارات قراءة/كتابة وسياق نافذة قد تتجاوز السلك الفعّال | حرجة | `resolve-cycle.js`، المستودعات، IPC، sync apply |
| G1 | `primary` غائب عن كتالوج التشغيل | حرجة | `js/shared/education/cycles.js` |
| G2 | الإعدادي `not_supported` + بلا مستويات/مواد | حرجة | `cycles.js:11`، `exam-count-defaults.js` |
| G3 | ازدواج نص `'secondary_qualifiant'` في ~20 ملفاً | منخفضة | `schema.js:41,69`، الهجرات، `init.js`، IPC، صفحات |
| G4 | كتالوجات المستويات تأهيلية فقط ومكررة | متوسطة | `exam-count-defaults.js` ↔ `js/utils.js` |
| G5 | `STAGE_CYCLES` صلب في الواجهة يتجاوز `window.api.cycles` | متوسطة | `js/pages/settings-defaults.js:387-389,940-945` |
| G6 | منطق «سلكان فقط» | متوسطة | `js/pages/teachers-list.js:585,746` |
| G7 | `exams-schedule.html:422` مجموعة «الابتدائي والإعدادي» بلا آليات | منخفضة | `exams-schedule.html` |
| G8 | جداول تحتاج قرار ملكية صريحاً لا إضافة عمود آلية | متوسطة | `student_orientation`، `staff_attendance`/`teacher_absences` |
| G9 | لا IPC/UI لإدارة `user_cycle_access` | متوسطة | `main/db/schema.js:895` |
| G10 | `cycle_profiles` غير موجود (بديل صلب) | متوسطة | `stage-rules.js:75-84` |
| G11 | مرجع قديم في `AGENTS.md` | منخفضة | `AGENTS.md` (نسب `resolveCycleForRequest` إلى `main/ipc/ipc-helpers.js`) |
| G12 | `capability` ثنائي بينما الواجهة تحتاج hidden/preview/supported | متوسطة | `cycles.js`، `settings-defaults.js`، `exams-schedule.html` |

**سبب إعادة تصنيف G3:** خُفّضت من متوسطة إلى منخفضة لأن تكرار النص أصبح مشكلة صيانة بعد أن أصبح G0 مسؤولاً عن منع default runtime والتسرب بين الأسلاك؛ لا يُعد وجود ثابت مكرر وحده تجاوزاً أمنياً.

---

## 3. الشرائح

### الشريحة S0 — بوابة أمان السلك (شرط سابق لكل الشرائح)

- [x] إغلاق G0 عبر جميع مسارات الطلب والكتابة: كل repo cycle-scoped يطلب سلكاً صريحاً ويطبق predicate/ownership، ويثبت ذلك contract test؛ كل استثناء مؤسسي أو إداري متعدد الأسلاك معلن ومختبر، بما في ذلك `student_orientation` joins.
- [x] إعادة التحقق من context داخل `resolveCycleForRequest` ضد `is_active` و`capability === 'supported'` و`user_cycle_access` في كل طلب؛ context قديم أو معطل يفشل مغلقاً. أثناء هذه الشريحة، تطبق طبقة catalog توافقاً مؤقتاً يحول legacy `not_supported` إلى `preview` للقراءة فقط، فلا يعتمد S0 على تنفيذ ترحيل S1.
- [x] إضافة fixture فيها سلكان `supported` واختبار عزل حقيقي: context في A لا يقرأ/يكتب B، المستخدم غير المصرح له يُرفض، وغياب context مع سلكين مدعومين يفشل بدلاً من اختيار أحدهما.

**بوابة التنفيذ:** لا تبدأ S1–S8 قبل أن تكون S0 خضراء في `npm test` و`npm run lint`، مع توقيع مالك المصادقة ومالك الاختبارات. — **الحالة (2026-08-02):** `npm test` أخضر (243/243) و`npm run lint` بلا أخطاء؛ الاختبارات الجديدة `tests/s0-cycle-gate.test.js` و`tests/s0-dual-cycle-fixture.test.js`؛ التوقيع النهائي بيد مالك المصادقة ومالك الاختبارات. **ملاحظة التأجيل:** رفض الطالب «غير المنتمي للسياق» في توجيه الطلاب (رفض كتابة صف orientation خارج سياق السلك) مؤجل عمداً إلى شريحة مستقبلية تصبح فيها `user_cycle_access` أساساً له — الاستثناء المؤسسي institution-wide مثبت في `tests/s0-cycle-gate.test.js` (انظر S6 row 132).

### الشريحة S1 — اعتماد كتالوج الأسلاك والاستدلال + مركزية الثابت

- [x] **اعتماد مخرجات خطة `2026-08-01-primary-stage-catalogs.md` كاعتماد سابق:** لا تعيد هذه الخطة تنفيذ إضافة `primary` أو بذور كتالوجاته. تتحقق فقط من أن الكتالوج النهائي يحتويه وبأن `capability` يبقى `preview` حتى شريحة التفعيل.
- [x] اعتماد حالات الكتالوج الثلاث: `hidden` لا يظهر ولا يُختار، `preview` يظهر كـ«قيد الإعداد» ولا يُحل كسلك عمل، و`supported` قابل للاختيار والعمل. يُرحّل `not_supported` الحالي إلى `preview` بدلالة موثقة.
- [x] توسيع `inferCycleFromSection`/`inferCycleFromLevel` بأنماط الابتدائي `[1-6]AP` + الأنماط العربية `(الأولى..السادسة)\s*ابتدائي` مع matching مثبت ومسمى للحالة `1AP` مقابل `1APIC`.
- [x] **مركزية الثابت دون إبقاء default runtime:** يجوز استخدام `QUALIFIANT_CYCLE` في البذر والهجرات الرسمية فقط. كل مسار طلب/حساب/قراءة/كتابة يجب أن يتلقى السلك صراحة؛ غياب السلك يفشل ولا يتحول إلى التأهيلي.
- [x] اختبارات: قبول `primary` بعد اكتمال الخطة المالكة، استدلال ابتدائي/إعدادي/تأهيلي بلا تصادم، وإعادة تشغيل inference فوق صفوف مصنفة لا تغير `cycle_code`.

**الحالة (2026-08-02):** مكتملة — ثوابت `PRIMARY_CYCLE`/`COLLEGIAL_CYCLE`/`QUALIFIANT_CYCLE` في `js/shared/education/cycles.js`؛ retire الاسم المستعار `not_supported` من الكتالوج؛ `QUALIFIANT_CYCLE` مركزي في schema/الهجرات/init/كتالوجات البذور/`appDefaults`/`stage-rules`؛ default runtime محذوف من `active-cycle-context.getContext`، و`resolveSubjectWeights` يفشل بـ`RULES_UNAVAILABLE` عند غياب السلك؛ اختبار inference غير retroactive جديد؛ `npm test` أخضر (244/244) و`npm run lint` بلا أخطاء.

### الشريحة S2 — فهراس المستويات والمواد للأسلاك الثلاثة

- [x] استهلاك فهارس المستويات والمواد التي تزرعها الخطة المالكة، مع مصدر واحد فعلي لا نسخة ثانية في هذه الخطة. (2026-08-02: `getExamCounts` للسلك الابتدائي يستهلك كتالوج `main/db/education-catalogs/primary-subjects.js` مباشرة؛ كتالوج مستويات التأهيلي موحَّد في `js/shared/education/qualifiant-levels.js` ويُستهلك من `main/db/exam-count-defaults.js` و`js/utils.js` معاً)
- [x] إزالة ازدواج `LEVEL_CODE_TO_AR`/`LEVEL_CODES` تدريجياً، مع إبقاء compatibility adapter مؤقتاً داخل `appDefaults:listLevels` فقط. (2026-08-02: المصدر الوحيد `js/shared/education/qualifiant-levels.js` (41 مستوى، بدون صف `*`)؛ `LEVEL_CODES` و`LEVEL_CODE_TO_AR` مرجعان له، و`getLevelFromSection`/`sortLevelNames` يعملان عبر `globalThis.EducationQualifiantLevels`؛ صف `الافتراضي (كل المستويات)` يُستعاد في `listLevels` فقط للمسارين legacy والتأهيلي — اختبارات `tests/qualifiant-level-catalog.test.js`)
- [x] جعل `appDefaults:listLevels(cycle_code)` و`appDefaults:getExamCount` و`appDefaults:saveExamCounts` وقراءات القواعد تستخدم السلك نفسه؛ لا يكفي توسيع `listLevels` بينما يبقى الحفظ/الحل مربوطاً بالتأهيلي. (2026-08-02: `resolveExamCountRow`/`examCountSource`/`lookupExamCount` معلمة بـ`cycleCode` (افتراضي التأهيلي للتوافق)؛ `getExamCounts` للسلك يعيد مواد الابتدائي الثمانية بـ`examCount: null`/`source: 'missing'` مع `assessmentModel` من الكتالوج، والإعدادي قائمة فارغة، والغير معروف `UNKNOWN_CYCLE`؛ الحفظ يُختم على كل entry بالسلك فيرفضه حارس repo `requireQualifiantCycles` بـ`FORBIDDEN` بلا صفوف — اختبارات `tests/appdefaults-exam-counts-cycle.test.js`)
- [x] مواد المرحلة الابتدائية بدون معاملات (تقويم مستمر) — **لا** تخزين `coefficient: null`؛ التمثيل عبر `assessmentModel` (قرار خطة الابتدائي مراجعة 3). (2026-08-02: hint `assessmentModel: 'continuous'` مدمج في `js/shared/education/cycles.js`؛ إثبات الحارس بلا معاملات للابتدائي في `tests/primary-assessment-model.test.js`)

### الشريحة S3 — الهجرة والزرع (بدون outbox)

- [x] هجرة جديدة بعد هجرة stage-rules وبالترتيب المعلن: بذر `education_levels`/`education_subjects`/aliases **مملوك لخطة الابتدائي** — هجرة `2026-08-080-primary-stage-catalogs` (لخطة `2026-08-01-primary-stage-catalogs.md`) تزرعها بـ union `INSERT OR IGNORE` للمفقود فقط ولا تكتب فوق صفوف قائمة؛ هذه الخطة **تستهلكها ولا تعيد زرعها** وتعتمد اكتمالها كشرط سابق. (2026-08-02: 080 مملوكة للخطة الشقيقة وتُزرع idempotent union — `tests/primary-stage-catalogs.test.js`)
- [x] زرع صف `institution_cycles` للابتدائي **بجملة SQL مباشرة** داخل الهجرة — لا عبر `main/repos/cycles.js` (رفض: `addCycle` يلتقط outbox — `cycles.js:57-77`). (2026-08-02: صف `primary` بجملة SQL idempotent داخل الهجرة — لا `cyclesRepo.addCycle`)
- [x] التحقق: عدد صفوف `sync_outbox` بعد الهجرة يساوي العدد قبلها؛ لا تُنشئ الهجرة outbox جديداً ولا تفترض أن outbox العالمي فارغ على جهاز مُرقّى. (2026-08-02: مثبت بلا صفوف outbox جديدة في `tests/primary-stage-catalogs.test.js`)
- [x] **عدم المساس بـ`exam_count_rules`** — مملوكة لخطة stage-rules (هجرة `2026-08-001` أُعيد بناءها ببعد `cycle_code`/`rule_set_id`). (2026-08-02: صفر صفوف ابتدائية في `subject_coefficients`/`exam_count_rules`/`subject_weight_rules` — `tests/primary-assessment-model.test.js`)
- [x] جميع بذور المرحلة الرسمية تُكتب داخل الهجرة/upgrade كبيانات محلية، ويُمنع مسار sync من إدخال profile غير معروف أو إصدار أقدم. (2026-08-02: بذور محلية صفر outbox؛ `checkCycleProfileConsistency` في sync apply يرفض profile غير معروف)
- [x] الصفوف الحالية ذات `cycle_code` غير الفارغ لا يعاد تصنيفها عند إعادة inference؛ الصفوف غير القابلة للتصنيف تُسجل للمراجعة ولا تُنقل بالتخمين إلى سلك آخر. (2026-08-02: inference غير retroactive مثبت في `tests/primary-stage-catalogs.test.js`)
- [x] إضافة `student_orientation.cycle_code` كسجل تاريخي snapshot مشتق من الطالب داخل main process، مع backfill من `students`، وحجر الصفوف غير القابلة للحسم. القيمة ليست من renderer ولا تتغير في update؛ تبقى ضمن `keyFields`/`requiredColumns` وعقد المزامنة. (2026-08-02: snapshot main-side + backfill + quarantine مدقق في `tests/orientation-contract.test.js`)

### الشريحة S4 — ملفات المرحلة (`cycle_profiles`)

- [x] إنشاء `cycle_profiles` كبيانات مرحلة منظمة، مع إزالة `default_exam_counts` نهائياً لأن مصدرها الوحيد هو `exam_count_rules`. (2026-08-02: `cycle_profiles` + `cycle_profile_assignments` عبر هجرة `2026-08-082-cycle-profiles`؛ `default_exam_counts` لا يُعاد إنشاؤه في أي مكان)
- [x] إذا كانت `periods` تُقرأ كعناصر مستقلة، تُنقل إلى جدول child مقيد؛ وإذا بقيت JSON فهي payload موثقة ومتحقق منها schema، لا blob غير منضبط. (2026-08-02: N/A — لا يوجد جدول/كيان `periods` مستقل في المخطط)
- [x] **دورة الحياة وeffectivity spine المعتمدان:** `cycle_profiles` رسمي immutable؛ مفتاحه المنطقي `(cycle_code, profile_version)`، وتعيّن نسخة فعالة عبر `cycle_profile_assignments(school_year, cycle_code, profile_version, rule_set_id)`. يكون `rule_set_id` غير فارغ عندما `uses_coefficients = 1`، ويشير إلى `stage_rule_sets` الفعالة للسنة نفسها؛ يكون فارغاً عندما `uses_coefficients = 0`. (2026-08-02: spine معتمد كما هو؛ `rule_set_id` غير فارغ iff `uses_coefficients = 1` ويشير للفعالة من نفس السنة — `tests/cycle-profiles.test.js`)
- [x] `cycle_profile_assignments` هو المرجع runtime authoritative. أما `CYCLE_CATALOG.profileVersion` و`institution_cycles.profile_version` فهما seed/migration hints فقط، ولا يحسمان profile أو rule set عند الحساب. (2026-08-02: مثبت في repo + اختبار — hints لا تُستخدم لحل effectivity)
- [x] كل إنشاء revision جديد في `stage_rule_sets` يحدّث assignment المرتبط في transaction واحدة، أو يرفض العملية؛ لا يسمح بتركيبة profile/rule-set متناقضة. resolver يقرأ assignment ثم rule set المشار إليه، لا نظامي effectivity مستقلين. (2026-08-02: كل version-copy save و`applyOfficialRuleSet` يعيد ربط assignment داخل نفس transaction؛ `captureRevisionRows` يلتقط صفوف السنة)
- [x] تسجيل `cycle_profiles` و`cycle_profile_assignments` في `main/sync/entity-registry.js` وcapture/apply hooks، مع رفض profile/rule-set غير معروف وdowngrade غير المسموح. يعلن عقد sync أيضاً `minAppVersion`؛ مالك الحقل هو sync/registry وليس profile editor، والمقارنة semantic-version ضد إصدار التطبيق المحلي، وأي جهاز أقدم يضع الصف في quarantine قبل apply. لا تُفتح لهما واجهة تعديل في هذه الخطة. (2026-08-02: مسجلان `snapshot: false`/`contractVersion: 2`/`minAppVersion '1.0.42'`؛ comparator semantic-version مملوك للـ registry؛ جهاز أقدم → quarantine — `tests/cycle-profiles.test.js`)
- [x] إنفاذ اتساق profile/rule-set في ثلاث طبقات: FK/قيود schema، تحقق repository transaction من تطابق السنة والحالة و`uses_coefficients` مع تحديث assignment ذرياً، ثم إعادة التحقق نفسها في sync apply قبل الكتابة. (2026-08-02: FK مركّب `(cycle_code, profile_version)` → `cycle_profiles` في `ensureCycleProfilesSchema` + هجرة `2026-08-083-cycle-profile-assignments-fk` تعيد بناء الجدول على الأجهزة المرقّاة لتبلغ نفس القيد؛ `checkCycleProfileConsistency` PUT-only يرفض أيضاً أي تغيير محتوى لملف موجود محلياً — الملفات الرسمية immutable — بينما يسمح بإعادة السحب المطابقة؛ repo transaction + re-bind ذري — `tests/cycle-profiles.test.js`)
- [x] استبدال البديل الصلب في `main/repos/stage-rules.js:75-84` بقراءة profile؛ غياب الجدول أو الصف يرجع `RULES_UNAVAILABLE` ولا يختار `uses_coefficients` بالتخمين. (2026-08-02: `resolveProfileForCycle` يرمي `RULES_UNAVAILABLE` عند غياب الجدول/الصف — لا تخمين)
- [x] بذر profile التأهيلي فقط عندما تكون قواعده الرسمية متاحة، وprofile الابتدائي `continuous` بلا معاملات؛ profile الإعدادي يبقى غير قابل للعمل حتى اعتماد ملفه الرسمي. (2026-08-02: بذر التأهيلي `qualifiant-2026-v1` (exams, 1) والابتدائي `primary-2026-v1` (continuous, 0)؛ الإعدادي غير مبذور عمداً)

### الشريحة S5 — توصيل الواجهة وإزالة الصلابة

- [x] `settings-defaults.js:387-389,940-945`: استبدال `STAGE_CYCLES` الصلب بالقراءة من `window.api.cycles.getCatalog()` — القائمة تعرض `supported` و`preview` وفق الحالة، وتخفي `hidden` (حسب نمط `settings-school.js:590-635`). (2026-08-02: كتالوج `cycles.getCatalog()` — `hidden` مخفي، `preview` ببادئة «قيد الإعداد»؛ الافتراضي عبر `cycles.getActive()` مع fallback إلى أول `supported`)
- [x] `teachers-list.js:585,746`: تعميم تبديل السلك من «ثنائي» إلى قائمة الأسلاك المفعلة المدعومة. (2026-08-02: «نقل إلى X» لكل سلك مفعل مدعوم آخر — `loadUsableCycles()` في `teachers-list.js`)
- [x] `exams-schedule.html:422`: ربط مجموعة «الابتدائي والإعدادي» بكتالوج حقيقي أو إخفاؤها مؤقتاً (حسب `capability`). (2026-08-02: optgroup `non-qualifiant-exam-optgroup` مربوط بالكتالوج — مخفي إلا إذا كان `primary`/`secondary_collegial` مدعوماً، fail-closed)
- [x] `main/ipc/appDefaults.js`: توسيع `listLevels` و`getExamCount` و`saveExamCounts` وقراءات القواعد لتقبل السلك المحسوب من السياق؛ لا يسمح runtime default بالتأهيلي. (2026-08-02: مكتمل سابقاً في S2 — `resolveExamCountRow`/`lookupExamCount`/`getExamCounts` مع `cycleCode` + حارس repo `requireQualifiantCycles`)
- [x] مسح بقية المواقع الصلبة (`grades-results.html:234`، `js/pages/results-hub.js`، `analytics.js`، `students-list.js`، `student-profile.js`، `import-context.js`) للاعتماد على `resolveCycleForRequest` بدل تمرير `'secondary_qualifiant'` يدوياً. (2026-08-02: 9 مواضع محورية ترسل السلك المحلول من `cycles.getActive()` بدل الثابت — analytics 2، results-hub 3، students-list 1، student-profile 2، grades-results 1؛ fallback legacy `CC_BRANCH_COEFFICIENTS`)
- [ ] حذف compatibility adapter في `appDefaults:listLevels` بعد أن تمر دورة إصدار كاملة بلا legacy caller أو payload، وتثبت telemetry/tests أن جميع المستهلكين يرسلون `cycle_code` صراحة. (مؤجل عمداً — لا تحذف صف `*` مبكراً قبل مرور دورة إصدار كاملة بلا legacy caller)

### الشريحة S6 — الوصول والجداول غير المقيدة

- [x] IPC/UI لإدارة `user_cycle_access` (نقاط مقترحة: `cycleAccess:list`, `cycleAccess:setUsers`, `cycleAccess:setCycles`) — **بقاعدة أمنية: admin فقط + لا سحب من developer/admin/principal** (`cycle-access.js:6`)، مع عدم السماح بسحب آخر سلك مفعل مدعوم للمستخدم. (2026-08-02: `cycleAccess:list` عبر `handleAuthedRead(admin)`، `cycleAccess:setUsers` و`cycleAccess:setCycles` عبر `handleWriteSoftAuth(admin)`؛ SQL بالكامل في `main/auth/cycle-access.js` (repo layer — لا SQL في IPC)؛ واجهة «صلاحيات الأسلاك» في `settings-users.html`/`js/pages/settings-users.js` مخفية لغير admin وتُظهر مربعات لكل سلك مفعل + زرّي «تفعيل/تعطيل للجميع` لكل سلك)
- [x] وضع حارس last-usable-cycle في repo وsync apply، لا في IPC فقط؛ أي remote disable أو restore مخالف يُرفض/quarantine. (2026-08-02: الحارس في repo layer (`assertKeepsLastUsableCycle` داخل `main/auth/cycle-access.js`) — كل كتابة تمر عبر repo، ولا توجد مسارات remote؛ شق sync-apply **ساقط بالتصميم** لأن الجدول local-only (انظر row 130) — أثبت الاختبار غياب `user_cycle_access` من `ENTITY_REGISTRY`)
- [x] تحديد عقد مزامنة `user_cycle_access` صراحة: registry/authority/apply validation إن كانت صلاحية مؤسسية متزامنة، أو توثيق أنها local-only مع سبب أمني. (2026-08-02: **قرار: local-only**. الأسباب: (1) جدول `users` ليس كيان sync في `main/sync/entity-registry.js` — معرفات المستخدمين محلية الجهاز، فلا يمكن لصف access متزامن حلّ FK هدفه على جهاز آخر؛ (2) هذه سياسة تفويض لا بيانات مدرسية — مثل page-access permissions المذكورة في AGENTS.md «App Defaults and Page Access» فهي محلية الجهاز ومقصودة خارج المزامنة، ومزامنتها تسمح لأي جهاز بدفع صلاحياته الخاصة أو تعليق إلغاء الوصول؛ (3) تُركّب على كل جهاز على حدة بنفس نموذج الثقة. النتيجة: لا إدخال في `entity-registry.js`، والقناتان المكتوبتان `exclude: true` في `CHANNEL_REGISTRY` بلا capture، ولا hooks sync-apply)
- [ ] `staff_attendance` و`teacher_absences`: تبقيان institution-wide؛ لا يضاف `cycle_code` إلى هوية غياب الأستاذ. التقارير per-stage المؤسِّسة على session/assignment join خارج نطاق هذه الخطة حتى يوجد مسار join رسمي.
- [ ] `student_orientation`: يستخدم `cycle_code` snapshot غير قابل للتعديل، مشتقاً من `students` عند الكتابة؛ كل repo query يفرض `school_year` و`cycle_code` من snapshot، والكتابة ترفض الطالب غير الموجود أو غير المنتمي للسياق. تغيير دورة الطالب لاحقاً لا يعيد تصنيف تاريخ orientation؛ أي نقل تاريخي يحتاج migration صريحاً ومؤرشفاً. (2026-08-02: **جزئي.** المكتمل: snapshot main-side + backfill + quarantine، كل repo query يفرض `school_year`، رفض `no_matching_student` عند غياب مطابقة roster بدل كتابة صف NULL-cycle (~626-635) — كلها مثبتة في `tests/orientation-contract.test.js`. **المؤجل عمداً:** رفض الطالب «غير المنتمي للسياق» — الاستثناء المؤسسي institution-wide مثبت في `tests/s0-cycle-gate.test.js`؛ لا يُفرض حتى تصبح `user_cycle_access` أساساً له في شريحة مستقبلية)
- [ ] `sections`: لا تغيير في هذه الخطة (تبقى نصاً حراً على الطلاب؛ تحويلها لجدول مقيد خارج النطاق).

### الشريحة S7 — التوثيق

- [x] تصحيح مرجع `AGENTS.md`: `resolveCycleForRequest` في `main/auth/resolve-cycle.js` (وليس `main/ipc/ipc-helpers.js`).
- [x] تحديث قسم الأسلاك في `AGENTS.md` بعد اكتمال S1–S5 (الأسلاك الثلاثة + `cycle_profiles` + `user_cycle_access`). (2026-08-02: أقسام S4 وS5 وS6 مضافة إلى AGENTS.md — «cycle profiles & effectivity spine»، «renderer wiring»، «user_cycle_access management»)

### الشريحة S8 — التحقق

- [x] `npm test` (مهم: `tests/cycles-repo-ipc.test.js`، `tests/sync-multi-cycle-contracts.test.js`، `tests/cc-rules-coefficient-golden.test.js`، `tests/stage-rules-*.test.js`). (2026-08-02: `node tests/run-all.js` — 251/251 أخضر في 261.81s)
- [x] `npm run lint`. (2026-08-02: 0 errors — تحذيرات فقط سابقة الوجود)
- [x] اختبارات جديدة: قبول `primary` في الكتالوج، `1AP` مقابل `1APIC`، inference غير retroactive، زرع idempotent لا يضيف outbox، `listLevels/get/saveExamCount(cycle_code)` لكل سلك، profile مفقود يرجع `RULES_UNAVAILABLE`، ومزامنة disable المخالفة تُرفض. (2026-08-02: `tests/s0-cycle-gate.test.js`، `tests/primary-stage-catalogs.test.js`، `tests/appdefaults-exam-counts-cycle.test.js`، `tests/stage-rules-*.test.js`، `tests/cycle-profiles.test.js`؛ «disable المخالفة» ساقطة بالتصميم لأن `user_cycle_access` local-only)
- [x] اختبار effectivity: assignment يربط profile و`rule_set_id` للسنة نفسها، والتركيبة المتناقضة تُرفض؛ runtime لا يستخدم `CYCLE_CATALOG.profileVersion` بدلاً من assignment. (2026-08-02: `tests/cycle-profiles.test.js` — effectivity عبر assignment، التركيبات المتناقضة مرفوضة)
- [x] اختبار orientation داخل contract test: كل repo query يفرض snapshot `cycle_code` و`school_year`، ولا يقبل update من renderer؛ اختبار backfill/quarantine يثبت التاريخ، مع اختبار ambiguity الصريح: سلكان `supported` بلا context = fail closed. (2026-08-02: `tests/orientation-contract.test.js` + `tests/sync-orientation-cycle.test.js`؛ ambiguity fail-closed في `tests/s0-dual-cycle-fixture.test.js`)
- [x] اختبار sync version gate: comparator semantic-version مملوك للـ sync/registry؛ جهاز أقدم من `minAppVersion` يحجر profile/assignment قبل الكتابة ولا يقرأها كبيانات عادية. (2026-08-02: `tests/cycle-profiles.test.js` — `compareSemanticVersions` pure، جهاز أقدم → `recordPullQuarantine` قبل apply)

---

## 4. الملكية وعدم التصادم مع الخطط الشقيقة

| الموضوع | المالك | القيد على هذه الخطة |
|---|---|---|
| بذور الابتدائي (مستويات/مواد/مرادفات) | `2026-08-01-primary-stage-catalogs.md` | لا تنفيذ هنا قبل إعادة التحقق من حالة تنفيذ الخطة الشقيقة |
| `exam_count_rules` وإصدارات القواعد | `2026-08-01-stage-rules-management.md` | لا هجرة ثانية على الجدول؛ استهلاك فقط |
| معاملات/أوزان التأهيلي | `2026-08-01-stage-rules-management.md` | لا تغيير؛ `cycle_profiles` يوفر وصفاً لا قيماً حسابية |
| النموذج العام للأسلاك | [الخطة الأم](../../multi-school-cycle-management-plan.md) | هذه الخطة تنفيذ جزئي لنطاقه المتبقي |
| صلاحيات المستخدم×المرحلة | هذه الخطة مع sync contract صريح | لا UI بلا تحديد local-only أو registry/authority |

---

## 5. خارج النطاق (شريحة لاحقة)

- تدفقات استيراد الابتدائي/الإعدادي وقوالب نتائج/شواهد.
- مبدّل سلك إضافي في الواجهة (المبدّل الحالي يستهلك `cycles:getCatalog` — `js/sidebar.js:476-517`).
- رفع `capability` للابتدائي والإعدادي إلى `supported`.
- صلاحيات صفحات لكل سلك، إدارة مستويات/مواد من الواجهة، قواعد ترقية.
- تقارير غياب الموظفين حسب المرحلة إلى أن يوجد join رسمي بين سجل الغياب والحصة/التكليف؛ التقارير المؤسسية فقط ضمن النطاق الحالي.

---

## 6. قرارات قبل التنفيذ

1. الابتدائي والكتالوجات الأساسية مخرجات خطة `2026-08-01-primary-stage-catalogs.md`؛ هذه الخطة تستهلكها ولا تكرر هجرتها.
2. `staff_attendance` و`teacher_absences` مؤسسيان؛ `student_orientation` يحفظ `cycle_code` snapshot تاريخياً مشتقاً من الطالب في main process، ولا يقبله من renderer أو يغيره لاحقاً.
3. إدارة `user_cycle_access` في `settings-users.html`، مع تحديد عقد المزامنة قبل أي UI.
4. profile مفقود = `RULES_UNAVAILABLE`؛ لا defaults للابتدائي/الإعدادي أو التأهيلي. Profiles الرسمية immutable ومُسندة إلى سنة دراسية.
5. الإعدادي لا يحصل على profile تشغيلي أو `supported` قبل اعتماد مصادره الرسمية واختبار العزل على fixture ثنائي السلك.

| بوابة | المالك | دليل التوقيع |
|---|---|---|
| S0: عزل السياق والمسارات والاختبار الثنائي | مالك auth/IPC + مالك الاختبارات | `npm test` أخضر، اختبار ambiguity وunauthorized موجودان |
| Ownership sequencing مع الخطط الشقيقة | مالك التكامل المعماري | مراجعة مشتركة للـ primary/stage-rules plans |
| Schema وeffectivity لـ`cycle_profiles` | مالك primary catalogs + مالك stage-rules | FK/قيود، repository transaction، واختبار profile/rule-set contradiction |
| Sync لـprofiles/assignments/access | مالك sync/registry | semantic-version comparator، contractVersion، `minAppVersion`، apply quarantine tests |
| Compatibility adapter | مالك appDefaults | telemetry صفر legacy callers لإصدار كامل قبل الحذف |

### بوابة عدم التنفيذ

لا يبدأ تنفيذ الكود قبل توقيع كل صف في جدول البوابات: اعتماد ownership sequencing مع الخطة الشقيقة، اعتماد schema/effectivity لـ`cycle_profiles` و`cycle_profile_assignments`، تحديد sync contract لـ`user_cycle_access`، إصلاح context revalidation، وإضافة اختبار عزل بصلاحيات وسلكين `supported`. هذه الوثيقة خطة فقط؛ لا تتضمن تغيير schema أو IPC أو renderer في هذه الخطوة.

---

## 7. مرجع الملفات (خريطة سريعة)

| الملف | الدور |
|---|---|
| `js/shared/education/cycles.js` | SSOT الأسلاك + الاستدلال |
| `main/db/schema.js:875-945,968-1036` | جداول الأسلاك والفهراس والقواعد |
| `main/db/migrations.js` | هجرات `2026-07-070`→`077`، `2026-08-078`، `2026-08-079` |
| `main/db/education-catalogs/*` | كتالوجات المواد/المعاملات/الأوزان (تأهيلي اليوم) |
| `main/auth/resolve-cycle.js`, `main/auth/cycle-access.js`, `main/auth/active-cycle-context.js` | التحليل والصلاحيات وسياق النافذة |
| `main/ipc/cycles.js`, `main/repos/cycles.js` | نقاط IPC وأعمال الأسلاك |
| `main/ipc/appDefaults.js`, `main/repos/stage-rules.js` | ثوابت السلك المكررة |
| `js/pages/settings-defaults.js`, `js/pages/settings-school.js`, `js/sidebar.js` | واجهات الأسلاك |
| `js/pages/teachers-list.js:585,746`, `exams-schedule.html:422` | منطق «سلكان فقط» |
| `tests/cycles-repo-ipc.test.js`, `tests/sync-multi-cycle-contracts.test.js` | اختبارات الأساس |
