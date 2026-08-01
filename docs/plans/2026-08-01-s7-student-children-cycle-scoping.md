# S7 Completion — Cycle Scoping for student_files / student_movements / correspondence

**التاريخ:** 2026-08-01
**الحالة:** خطة تنفيذ معتمدة
**المرجع الأم:** [2026-07-31-multi-cycle-completion-plan.md](./2026-07-31-multi-cycle-completion-plan.md) (S7)
**الخارطة السابقة:** [2026-07-30-cycle-scoping-remaining-roadmap.md](./2026-07-30-cycle-scoping-remaining-roadmap.md)

هذه الوثيقة تغلق الشريحة S7 من خطة الإتمام: نقل SQL قنوات `student_files` و
`student_movements` و`correspondence` إلى `main/repos/*`، وتقييد القراءة والكتابة
بالسلك، وتصحيح خطأ حمولة `studentMovements:add`، ثم تفعيل حراسة `readScoped`
على الجداول الأربعة.

---

## 0. خط الأساس المتحقق منه (فحص كامل قبل كتابة الخطة)

| # | الحقيقة (متحقق منها في الكود والاختبارات) | الموضع |
|---|---|---|
| 1 | الترحيل 077 يضيف `cycle_code` + backfill + تسجيل `CYCLE_BACKFILL_UNMAPPABLE` لجميع جداول S7 الأربعة — **لا حاجة لترحيل جديد** | `main/db/migrations.js:2286-2314` |
| 2 | السجل يصرّح بالجداول الأربعة `contractVersion: 2` + `requiredColumns: ['cycle_code']` لكن **بدون** `readScoped` (تعليق مقصود 494-495) | `main/sync/entity-registry.js:303-370` |
| 3 | `student_profile_data` **مقيَّد بالكامل بالفعل** (IPC موثّق + repo بـ `requireCycle`/`resolveStudentForCycle`) — وهو النمط الذي يُنسخ | `main/ipc/student-profile.js:63-112`, `main/repos/student-profile.js` |
| 4 | **خطأ حمولة `studentMovements:add`**: المعالج يقرأ `movement.student_id` بينما المرسلون الفعليون يرسلون `massar_code` → better-sqlite3 يرمي على `undefined` → الصفحة تفشل بصمت | `main/ipc/schoolOps.js:104-136` مقابل `students-movement.html:114`, `js/pages/students-status.js:344` |
| 5 | `student_files`/`correspondence` بلا مستدعين فعليين في الصفحات (صفحة `absence-ln.html` غير موجودة، رابط الشريط الجانبي ميت) — خطر تغيير شكل الـ API ضئيل | فحص شامل لـ `js/`, `*.html` |
| 6 | `studentMovements:getStats` قراءة `handleRead` غير مقيدة — **ستفشل حراسة smoke** بعد قلب `readScoped` (SQL داخل الـ IPC على جدول مقيد) | `main/ipc/schoolOps.js:138-152` |
| 7 | الحذف المتسلسل يغطي `grades, absences, correspondence, student_files, student_movements` لكن **ليس** `student_profile_data` | `main/repos/students.js:20` |
| 8 | المجموعة الكاملة خضراء 236/236؛ «الاختبارات السبعة الفاشلة» هي اختبارات استكشاف مستثناة — ليست جزءاً من `npm test` | ترويسة `tests/inv-e-display-aggregation.test.js` |
| 9 | تصنيف إعادة الحفظ المطابق مقابل رفض الحارس صحيح (تحقق تجريبي: no-op upsert → `changes=1`، رفض الحارس → `changes=0`) — **سُحب** من المراجعة السابقة | فحص تجريبي بـ `node:sqlite` |
| 10 | الصفوف الجديدة التي تُنشئها المعالجات الحالية تحذف `cycle_code` → NULL → ستُحجر عند السحب (السجل يتطلب العمود) | `schoolOps.js:36-43,106-119`, `absences.js:231-234` |

**الخلاصة:** العمل المتبقي هو الاستخراج + التقييد + إصلاح الخلل + الاختبارات. لا ترحيل جديد.

---

## 1. الأهداف

1. كل SQL هذه الجداول ينتقل إلى `main/repos/*` (قاعدة AGENTS.md 1؛ خطة الإتمام §6 و§13).
2. كل قراءة موثّقة ومحلولة السلك؛ كل كتابة تحل الملكية وتكتب `cycle_code` وتقيّد التحديث بالمعرف `WHERE id = ? AND cycle_code = ?` (§6: «الكتابة بالمعرف مقيدة»).
3. `CYCLE_SCOPED_TABLES` من 6 إلى 10؛ حراسة smoke تفرض تلقائياً؛ الاستثناءات من 3 إلى 1.
4. إصلاح خلل `studentMovements:add` (massar_code).
5. اختبارات وتوثيق يثبتان عدم الانحدار.

---

## 2. المراحل

### المرحلة 1 — المستودعات (جديدة + ممتدة)

#### 1أ. جديد `main/repos/student-files.js`
يتبع نمط `main/repos/student-profile.js` + `main/repos/student-cycle.js` (`requireCycle`, `resolveStudentForCycle`, `resolveStudentOwnership` — `student-cycle.js:42-64`). **كل الدوال تُصرَّح بـ `function` وليس أسهم** — كاشف smoke يطابق `^function` فقط (smoke.js:141-147)، والدوال السهمية تهرب صامتة من الحراسة.

- `listByYear(db, year, cycleCode)` — نقل `schoolOps.js:11-31`: طلاب مقيدون `WHERE school_year = ? AND cycle_code = ?`، والوثائق مضمومة عبر `student_id` (طلاب سلك الجلسة فقط).
- `upsertOne(db, payload, cycleCode)` — حل الملكية عبر `payload.student_id` بدالة جديدة `findStudentById` (تُضاف إلى `student-cycle.js` بجانب `findStudentOwner`؛ أو عبر `student_code` عند وجوده)؛ خطأ عربي إن كان مجهولاً أو أجنبياً. INSERT مع `cycle_code`؛ حارس upsert `WHERE student_files.cycle_code = excluded.cycle_code` (يشفي صفوف NULL القديمة عند إعادة الكتابة).
- `upsertBulk(db, items, cycleCode, options)` — تخطي + إبلاغ للصفوف الأجنبية، خطأ للرموز المجهولة (مرآة عقد `absences.saveBulk`، `absences.js:74-86`)؛ التقاط صريح داخل المعاملة عبر capture-port.
- `setDocumentStatus(db, payload, cycleCode)` — اسم مستعار رفيع لـ `upsertOne` (تبقى القناة).

#### 1ب. جديد `main/repos/student-movements.js`
- `listByYear(db, year, cycleCode)` — نقل `schoolOps.js:90-102` (LEFT JOIN + `(s.id IS NULL OR s.cycle_code = ?)` — صفوف الحركة اليتيمة تبقى مرئية، نية موثقة).
- `getStats(db, year, cycleCode)` — نقل `schoolOps.js:138-152`، الآن مقيد بالسلك عبر `m.cycle_code = ?`.
- `addMovement(db, movement, cycleCode)` — **يصلح الخلل #4**:
  - حل الملكية عبر `movement.massar_code || movement.student_code` → `resolveStudentForCycle` (خطأ عربي إن كان مجهولاً/أجنبياً)؛
  - INSERT للحركة **مع `cycle_code`**؛
  - `internal` + `to_section` → `UPDATE students SET section = ? WHERE id = ? AND cycle_code = ?`؛
  - `departure`/`dropout`/`arrival` → تحديث الحالة مع `AND cycle_code = ?`.
  - التقاط متعدد الجداول: صف الحركة + صف الطالب (مرآة إدخال `studentMovements:add` في سجل الالتقاط `tables: ['student_movements','students']`، capture.js:172-176؛ يتبع نمط `captureInputUpserts` داخل المعاملة عبر `./capture-port`).

#### 1ج. تمديد `main/repos/absences.js` (كتلة المراسلات، أسطر 227-241)
- `listCorrespondenceByYear(db, year, cycleCode)` — JOIN للطلاب مع فلتر السلك (مرآة شكل `absences.listByYear`، `absences.js:30-40`).
- `listCorrespondenceByStudent(db, studentId, cycleCode)` — حل بالمعرف → السلك → فلتر `WHERE student_id = ? AND cycle_code = ?` (لا حاجة للسنة؛ التوقيع يبقى متوافقاً مع preload).
- `saveCorrespondence(db, letter, cycleCode)` — حل الملكية (عبر `student_code` أو `student_id`)، INSERT **مع `cycle_code`**.
- `markCorrespondencePrinted(db, id, cycleCode)` — `UPDATE correspondence SET printed = 1 WHERE id = ? AND cycle_code = ?`.
- `findByLocalKeys` يبقى بلا سلك (هوية المزامنة — فخ 7 في الخطة).

#### 1د. إصلاح فجوة الحذف المتسلسل
إضافة `'student_profile_data'` إلى `STUDENT_DEPENDENT_TABLES` (`main/repos/students.js:20`).

### المرحلة 2 — إعادة توصيل IPC (SQL خارج، القنوات كما هي)

#### 2أ. `main/ipc/schoolOps.js`
- `studentFiles:getByYear` → `studentFilesRepo.listByYear(db, normalizeYear(year), resolveCycleForRequest(db, event))` (يبقى `handleAuthedRead`).
- `studentFiles:upsert` / `upsertBulk` / `setDocumentStatus` → استدعاء repo؛ معالجات `handleWrite` تمرر `resolveCycleForRequest(db, event)` (الحدث متاح كوسيط ثانٍ).
- `studentMovements:getAll` → استدعاء repo (يبقى `handleAuthedRead`).
- `studentMovements:add` → استدعاء repo؛ المعالج يحل السلك ويمرره — حل في main دائماً، لا `cycle_code` من العميل (§5.4).
- `studentMovements:getStats` → **`handleAuthedRead`** + استدعاء repo (الخلل #6؛ إحصاء لوحة القيادة يصبح متسقاً مع بقية القراءات المقيدة).

#### 2ب. `main/ipc/absences.js`
- `correspondence:getAll` → `handleAuthedRead` + سلك؛ `correspondence:getByStudent` → `handleAuthedRead` + سلك؛ `correspondence:save` / `markPrinted` → `handleWrite` + سلك.
- لا حذف من preload (`preload.js:112-117,120-132` يبقى؛ شكل الحمولة كما هو — الصفحات ترسل `massar_code`، المستودع يحل).

### المرحلة 3 — السجل + حراسة smoke

#### 3أ. `main/sync/entity-registry.js`
إضافة `readScoped: true` إلى `student_files`, `student_movements`, `correspondence`, `student_profile_data` (profile_data متوافق أصلاً — قنواته موثقة). `CYCLE_SCOPED_TABLES` يصبح 10 (مشتق، entity-registry.js:496-503).

#### 3ب. `tests/smoke.js`
- حذف `correspondence:getAll`, `correspondence:getByStudent` من `EXEMPT_CHANNELS` (smoke.js:193).
- **إبقاء** `cycles:getCatalog` مستثنى — متحقق: قراءة `handleRead` قبل تسجيل الدخول (cycles.js:28) تحتاجها شاشة اختيار السلك؛ مطاردة النطاق تكسر الدخول. تحديث التعليق ليقول ذلك.
- الناتج المتوقع: «10 scoped tables, N scoped repo functions» — N تنمو مع المستودعات الجديدة.

### المرحلة 4 — اتساق المزامنة (تحقق + اختبار، لا كود جديد متوقع)

- إدخالات سجل الالتقاط (capture.js:157-176) تبقى؛ المستودعات الجديدة تكتب صفوفاً **مع** `cycle_code` حتى تكون المستندات الملتقطة/المعاد تشغيلها سليمة العقد.
- **اختبار حجر جديد**: مستند مدفوع لهذه الجداول بلا `cycle_code` → `missingInPayload` → `sync_quarantine` برسالة عربية + إعادة تشغيل عند إعادة المحاولة (يختبر المعالجة المقصودة لصفوف NULL القديمة؛ صفوف NULL بعد 077 لم تعد قابلة للإنتاج بعد المرحلة 1).
- تأكيد مرور `tests/sync-bulk-channels-explicit.test.js` (يصرح بإدخالات الالتقاط الصريح ومنها `studentFiles:upsertBulk` — بلا تغيير).

### المرحلة 5 — الاختبارات

#### 5أ. جديد `tests/cycle-isolation-student-children.test.js` (نمط: `tests/cycle-isolation-grades-absences.test.js`)
1. القراءة مقيدة: `studentFiles.getByYear`, `studentMovements.getAll/getStats`, `correspondence.getAll/getByStudent` ترجع صفوف سلك الجلسة فقط؛ الحركات اليتيمة تبقى مرئية.
2. الكتابة: معرف/رمز أجنبي → خطأ (مفرد) / تخطي+إبلاغ (دفعة)؛ رمز مجهول → خطأ.
3. `studentMovements.add` بـ `massar_code` تنجح (انحدار الخلل #4)؛ تحديث `section`/`status` للطالب مقيد بالسلك.
4. لا صفوف `cycle_code` NULL تُنشأ بأي قناة (تأكيد على الصفوف المُدرجة).
5. الحذف المتسلسل: `studentsRepo.deleteByYear` ينظف الجداول الخمسة الفرعية ومنها `student_profile_data`.

#### 5ب. تمديد الاختبارات القائمة
- `tests/read-contract-coverage.test.js` — ينمو تلقائياً؛ تحقق من اكتشاف دوال المستودعات الجديدة (يتطلب تصريحات `function` — قيد المرحلة 1).
- `tests/sync-multi-cycle-contracts.test.js` — إضافة رحلة دفع/سحب للجداول الثلاثة مع `cycle_code`؛ تأكيد حجر مستند بلا سلك.
- `tests/repos-domain-key-fields.test.js` — keyFields المستودعات الجديدة يجب أن تطابق السجل (`student_files: ['student_id','doc_key','school_year']`, الحركات/المراسلات: `['id']`).
- `tests/migration-077-cycle-reference-schema.test.js` — تمديد لتأكيد backfill الجداول الثلاثة وتسجيل `CYCLE_BACKFILL_UNMAPPABLE`.

### المرحلة 6 — التوثيق

1. `docs/plans/2026-07-31-multi-cycle-completion-plan.md` جدول §0: 6 → 10 جداول مقيدة؛ وسم `student_profile_data` منجز؛ تفقيط بنود S7 في §6/§7.
2. `docs/api-channel-map.md:16-17` — تحديث صفوف correspondence/studentFiles/studentMovements إلى «cycle-scoped».
3. `docs/plans/2026-07-30-cycle-scoping-remaining-roadmap.md` — إزالة عبارة «ثغرة الكتابة المتبقية» إن وجدت؛ ملاحظة إصلاح خلل حمولة `studentMovements:add`.

---

## 3. التحقق (أوامر دقيقة)

```
npm run test:smoke        # توقع سطر "10 scoped tables" و 0 مخالفين
npm run lint              # 0 أخطاء (53 تحذيراً سابقة دون تغيير)
node tests/run-all.js --filter cycle-isolation        # كلها تمر
node tests/run-all.js --filter sync-                 # عقود + حجر تمر
node tests/run-all.js --filter repos-domain          # عقد key-fields قائم
npm test                  # 236+ ملفاً، 0 إخفاق
```

---

## 4. خارج النطاق (مقصود)

- `exams`/`tests`/`exam_proctors`/`exam_rooms` — S5 (شريحة مستقلة تعتمد على S4).
- `staff_attendance`/`teacher_absences` — S8 (مؤسسيان بالتصميم).
- استعمال الزمن (`localStorage`) — S6. القواعد التربوية — S1-S3, S10 (محجوبة بالمصادر الرسمية).
- استثناء `cycles:getCatalog` — يبقى بالتصميم (قراءة قبل الدخول).
- تقوية كاشف smoke للدوال السهمية — متابعة منفصلة؛ المرحلة 1 تتجنبه بالاتفاق.

## 5. قرارات معتمدة (حكمي في الخطة)

1. تقييد `getStats` بسلك الجلسة بدلاً من إبقائه مؤسسياً.
2. إبقاء `cycles:getCatalog` مستثنى من حراسة القراءة.
3. إضافة `student_profile_data` إلى قائمة الحذف المتسلسل.

---

## 6. المخاطر

| الخطر | الأثر | التخفيف |
|---|---|---|
| تحطيم قناة بلا مستدعي صفحة فعلي | لا مستخدم متأثر لكن اختبارات قديمة تتحطم | تمديد الاختبارات في نفس PR قبل أي دمج |
| صفوف NULL القديمة في المزامنة | حجر مؤقت على أجهزة أخرى | اختبار حجر يثبّت السلوك المقصود + شفاء عند إعادة الكتابة |
| كاشف smoke لا يلتقط دوالاً سهمية | نطاق جديد يهرب من الحراسة | التزام `function` في المستودعات الجديدة + متابعة منفصلة |
