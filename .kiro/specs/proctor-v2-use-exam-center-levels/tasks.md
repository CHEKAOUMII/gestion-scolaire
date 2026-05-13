# Implementation Plan

- [x] 1. كتابة اختبار استكشافي (PBT) لـ bug condition

  - **Property 1: Bug Condition** - تكميل صفوف القاعات الناقصة من `examCenterLevels`
  - **CRITICAL**: هذا الاختبار يجب أن يفشل على الكود غير المُصلَح — الفشل يؤكد وجود الخلل
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: هذا الاختبار يرمِّز السلوك المتوقَّع من Property 1 في `design.md`؛ سيتحوّل إلى نجاح بعد تنفيذ الإصلاح
  - **GOAL**: إنتاج counterexamples حقيقية تُبرهن على الخلل الموصوف في bugfix.md §1.1–1.3
  - **Scoped PBT Approach**: ولّد ثلاثياً `(examCenterLevels, examCenterRoomsData, scheduleEntries)` بحيث يستوفي مستوى `L` شرط `isBugCondition` من `design.md` (`scheduled AND expected > 0 AND actualRows < expected`)؛ واختبر المولِّد يدوياً على حالات صريحة:
    - مستوى `rooms=2` بدون أي صف في `examCenterRoomsData` (M=0, N=2)
    - مستوى `rooms=3` وصفّين فقط في `examCenterRoomsData` (M=2, N=3)
    - مستوى `rooms=1` ومستوى آخر `rooms=4` M=0 في نفس المُدخَل
    - صفّ محفوظ بـ `room_num="5"` ومستوى `rooms=2` (للتحقق لاحقاً من الترقيم التسلسلي > 5)
  - استدعِ `buildV2Input` (أو المنطق المعزول `getEffectiveRoomRowsForLevel` إن كان مُستخرَجاً) وتحقّق: `roomsList[L].length === examCenterLevels[L].rooms` لكل `L` يستوفي bug condition
  - شغِّل الاختبار على الكود غير المُصلَح
  - **EXPECTED OUTCOME**: الاختبار يفشل — الـcounterexamples تُظهر `roomsList[L].length` أصغر من `examCenterLevels[L].rooms` (مثلاً `0 !== 2` أو `2 !== 3`)
  - وثِّق الـcounterexamples المُلتقَطة لفهم السبب الجذري (غياب قراءة `examCenterLevels` من `buildV2Input` + عدم وجود منطق تكميل)
  - ضع علامة completion على المهمة عند كتابة الاختبار وتشغيله وتوثيق الفشل
  - _Requirements: 2.1, 2.3, 2.6, 2.7_

- [x] 2. كتابة اختبارات preservation (PBT) قبل الإصلاح

  - **Property 2: Preservation** - المستويات المكتملة ومصادر البيانات الأخرى
  - **IMPORTANT**: اتبع منهجية observation-first — لاحظ سلوك الكود غير المُصلَح على المدخلات التي لا تستوفي bug condition (`¬C(X)`) ثم ارمِّز الملاحظات في خصائص
  - الحالات المرصودة التي يجب الحفاظ عليها (من `design.md` Preservation Requirements):
    - مستوى بـ `M == N` (صفوف مكتملة): `roomsList[L]` يبقى مطابقاً لما تُرجعه `getRoomRowsForLevel` الحالية (محتوى وترتيب)
    - مستوى خارج `scheduleEntries`: لا يظهر في `roomsList`
    - `level.rooms = 0` أو غير معرَّف: `roomsList[L] = actualRows` بدون صفوف افتراضية
    - `examCenterLevels` فارغ للسنة النشطة: fallback كامل إلى السلوك الحالي
    - مسار v1 (`Algorithm_Toggle = v1`): لا يمرّ عبر `buildV2Input` ولا يتأثر
    - `examCenterRoomsData` في التخزين لا يتغيّر بعد تشغيل v2 (صيغة الحفظ مستقرّة)
  - ولّد مدخلات عشوائية `(examCenterLevels, examCenterRoomsData, scheduleEntries)` بحيث `NOT isBugCondition` لكل مستوى، وتحقّق بـ deep equality أن `buildV2Input_original.roomsList === buildV2Input_original.roomsList` (snapshot stable) و أن `syntheticRoomWarnings` فارغ
  - شغِّل الاختبارات على الكود غير المُصلَح
  - **EXPECTED OUTCOME**: كل الاختبارات تنجح — هذه الخصائص هي baseline السلوك الذي يجب أن يبقى كما هو بعد الإصلاح
  - ضع علامة completion عند كتابة الاختبارات وتشغيلها ونجاحها على الكود غير المُصلَح
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 2.4, 2.5_

- [x] 3. إصلاح اعتماد `buildV2Input` على `examCenterLevels` لتكميل القاعات الناقصة

  - [x] 3.1 إضافة دالة `getExamCenterLevelsForActiveYear` في `exams-proctors.html`
    - أضف الدالة المساعدة بحسب Pseudocode في `design.md` §"Data Sources"
    - تقرأ `window.api.examConfig.get(year, 'examCenterLevels')` وتُرجع خريطة `{ [levelName]: { rooms: Number, subjects: Array } }`
    - تتعامل مع `null`/`undefined`/مصفوفة فارغة بإرجاع خريطة فارغة
    - تتجاهل العناصر بدون `name`
    - اكتب اختبار وحدة يغطّي: مصفوفة فارغة، كائنات كاملة، كائنات ناقصة `rooms` (تصير 0)، كائنات ناقصة `subjects` (تصير `[]`)، عناصر بدون `name` (تُتجاهل)
    - _Bug_Condition: isBugCondition(input) يعتمد على قراءة `examCenterLevels[L].rooms` — هذه الدالة هي المدخل الوحيد لهذه القراءة_
    - _Requirements: 2.1, 2.5, 2.7_

  - [x] 3.2 إضافة دالتَي `buildSyntheticRoomRow` و `computeMaxRoomNum` النقيّتَيْن
    - `buildSyntheticRoomRow(levelName, roomNum)` تُرجع كائناً بالحقول المحدَّدة في `design.md` §"Synthetic Room Row Schema": `key`, `level_name`, `room_num: String(roomNum)`, `roomName: 'قاعة افتراضية ' + roomNum`, `count: 0`, `firstNum: null`, `lastNum: null`, `_synthetic: true`
    - `computeMaxRoomNum(rows)` تُرجع أكبر `parseInt(r.room_num, 10)` في `rows`، أو `0` إذا كانت `rows` فارغة أو كل القيم غير صالحة
    - اكتب اختبارات وحدة تغطّي: `rows=[]` → 0؛ `rows` بأرقام متفاوتة → أكبر قيمة؛ `room_num` مفقود أو غير رقمي → يُتجاهل؛ شكل الكائن المُنتَج من `buildSyntheticRoomRow` مطابق للمواصفات بما فيها علامة `_synthetic: true`
    - _Bug_Condition: هذه الدوال تُستعمل لتوليد الصفوف التي تُكمِّل `roomsList[L]` عند `M < N`_
    - _Requirements: 2.1, 2.3_

  - [x] 3.3 استخراج `getEffectiveRoomRowsForLevel(levelName, examCenterLevelsMap)` كدالة مساعدة مشتركة
    - تستدعي `getRoomRowsForLevel(levelName)` للحصول على `actualRows` (بدون تعديل الدالة الأصلية)
    - تحسب `expected = examCenterLevelsMap[levelName]?.rooms || 0`
    - إذا `expected > actualRows.length` و `expected > 0`: تُنشئ `missing = expected - actualRows.length` صفّاً افتراضياً باستعمال `computeMaxRoomNum` و`buildSyntheticRoomRow`، وتُرجع `[...actualRows, ...syntheticArr]`
    - وإلا تُرجع `actualRows` كما هي
    - تُستعمل من: `buildV2Input`، `buildGuardQuota`، `buildPerTeacherQuota`، `getPlanningReadiness` — لضمان تطابق مجموع الحاجيات مع `roomsList` الممرَّر إلى الخوارزمية
    - لا تُستعمل من: `getSummaryCandidateCountForLevel` ولا أي دالة عرض أخرى (تبقى على `getRoomRowsForLevel` الأصلية)
    - اكتب اختبار وحدة يغطّي: `M=0, N=2` → طول 2؛ `M=2, N=3` → طول 3؛ `M==N` → بدون صفوف افتراضية؛ `N=0` → `actualRows` كما هي؛ مستوى غير موجود في الخريطة → `actualRows` كما هي
    - _Bug_Condition: isBugCondition(input) حيث expected > actualRows.length_
    - _Expected_Behavior: roomsList[L].length == examCenterLevels[L].rooms بعد التكميل_
    - _Preservation: عدم تغيير سلوك المستويات المكتملة أو الحالات الحدّية_
    - _Requirements: 2.1, 2.3, 2.6, 3.1, 3.6_

  - [x] 3.4 تحديث `buildV2Input` لاستعمال `getEffectiveRoomRowsForLevel` وتجميع `syntheticRoomWarnings[]`
    - استبدل استدعاء `getRoomRowsForLevel(lvl)` المباشر بـ `getEffectiveRoomRowsForLevel(lvl, examCenterLevelsMap)` داخل حلقة `scheduleEntries`
    - حمِّل `examCenterLevelsMap` مرة واحدة في بداية `buildV2Input` عبر `getExamCenterLevelsForActiveYear`
    - إذا كانت الخريطة فارغة، سجِّل تحذيراً واحداً في console: `[V2 WARN] examCenterLevels not available for active year — falling back to roomsData only`
    - جمِّع `syntheticRoomWarnings[]` بعناصر `{ levelName, added, expected, actual }` لكل مستوى أُضيفت له صفوف افتراضية
    - مرِّر `syntheticRoomWarnings` إلى الكائن المُعاد من `buildV2Input` لاستعماله في UX (المهمة 3.5)
    - تأكد أن الترتيب داخل `roomsList[L]` هو: الصفوف الفعلية أولاً ثم الصفوف الافتراضية (حفظاً لـ Property 2 على الصفوف الفعلية)
    - _Bug_Condition: isBugCondition(input) — `scheduled AND expected > 0 AND actualRows < expected`_
    - _Expected_Behavior: roomsList[L].length == examCenterLevels[L].rooms و syntheticRoomWarnings يحوي المستوى_
    - _Preservation: المستويات المكتملة و v1 و دوال العرض لا تتأثر_
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7_

  - [x] 3.5 إضافة قسم "قاعات افتراضية مُكمَّلة" في Diagnostics Panel + toast مجمَّع واحد
    - أضف قسماً جديداً في لوحة التشخيص يظهر بعد تشغيل التوزيع بشرط `syntheticRoomWarnings.length > 0`
    - اعرض جدولاً بأعمدة: اسم المستوى، العدد المتوقَّع، العدد الفعلي، عدد الصفوف المُكمَّلة
    - أضف ملاحظة تفسيرية: "الصفوف الافتراضية مُستعمَلة فقط لتوزيع المراقبين ولا تُحفظ. أكمِل الصفوف من صفحة 'تهيئ قاعات الامتحان' لإزالتها."
    - أضف زر "الذهاب إلى صفحة القاعات" يفتح `exams-rooms.html`
    - اعرض toast واحد مجمَّع من نوع `warning` بالنص: `تم تكميل N قاعة افتراضية في M مستوى. راجع لوحة التشخيص.` (استخدم أعداد فعلية محسوبة من `syntheticRoomWarnings`)
    - تحقّق يدوياً من عدم ظهور toast متعدّد لكل مستوى على حدة
    - _Bug_Condition: isBugCondition — التحذير يظهر فقط عندما يوجد صفوف افتراضية_
    - _Expected_Behavior: المستخدم يرى تحذيراً مرئياً مجمَّعاً يذكر المستويات المتأثّرة والأعداد_
    - _Requirements: 2.2, 2.6_

  - [x] 3.6 regression check — دوال العرض تبقى على `getRoomRowsForLevel` الأصلية
    - تحقّق بالقراءة الهادفة في `exams-proctors.html` أن `getSummaryCandidateCountForLevel` (حوالي السطر 5882) لا تزال تستدعي `getRoomRowsForLevel` وليس `getEffectiveRoomRowsForLevel`
    - فحص جميع استدعاءات `getRoomRowsForLevel` الأخرى: كل استدعاء يستهدف عرضاً فقط (وليس حساب حاجيات التوزيع) يجب أن يبقى على الدالة الأصلية
    - اكتب اختبار وحدة: عند وجود مستوى بـ `rooms=2` و `M=0`، `getSummaryCandidateCountForLevel(L)` يُرجع `0` (وليس `2`) بعد الإصلاح
    - _Preservation: دوال العرض لا تحتسب الصفوف الافتراضية_
    - _Requirements: 3.6_

  - [x] 3.7 regression check — مسار v1 لا يمرّ بأي منطق جديد
    - تحقّق أن `runAutoDistribution` (v1) لا يستدعي `buildV2Input` ولا `getExamCenterLevelsForActiveYear` ولا `getEffectiveRoomRowsForLevel`
    - اكتب اختبار integration مبسّط: عند `Algorithm_Toggle = v1` وتشغيل التوزيع على سيناريو يستوفي bug condition، النتائج مطابقة للسلوك الحالي قبل الإصلاح (لا صفوف افتراضية، لا `syntheticRoomWarnings`)
    - _Preservation: مسار v1 بالكامل غير متأثر_
    - _Requirements: 3.4, 3.5_

  - [x] 3.8 إعادة تشغيل اختبار bug condition والتحقق من نجاحه
    - **Property 1: Expected Behavior** - تكميل صفوف القاعات الناقصة من `examCenterLevels`
    - **IMPORTANT**: أعد تشغيل الاختبار نفسه من المهمة 1 — لا تكتب اختباراً جديداً
    - الاختبار من المهمة 1 يرمِّز السلوك المتوقَّع؛ عندما ينجح، يؤكّد أن السلوك المتوقَّع مُستوفى
    - **EXPECTED OUTCOME**: الاختبار ينجح (يؤكد أن الخلل مُصلَح)
    - _Requirements: Expected Behavior Properties from design (Property 1)_

  - [x] 3.9 إعادة تشغيل اختبارات preservation والتحقق من بقاء نجاحها
    - **Property 2: Preservation** - المستويات المكتملة ومصادر البيانات الأخرى
    - **IMPORTANT**: أعد تشغيل الاختبارات نفسها من المهمة 2 — لا تكتب اختبارات جديدة
    - **EXPECTED OUTCOME**: كل الاختبارات تنجح (تؤكد عدم وجود regressions)
    - تأكد أن `examCenterRoomsData` في التخزين لم يتغيّر بعد تشغيل v2
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. اختبارات property إضافية (Property 3 و Property 4)

  - [x] 4.1 Property 3 — عدم تداخل ترقيم الصفوف الافتراضية مع الفعلية
    - اكتب PBT يولّد مستويات بصفوف فعلية لها `room_num` متفاوتة (مثلاً `["1","2","5","10"]`)
    - تحقّق أن كل صف افتراضي في `roomsList[L]` يحمل `room_num > max(existingRoomNums)`
    - تحقّق أن أرقام الصفوف الافتراضية متتالية تبدأ من `max + 1`
    - _Expected_Behavior: maxRoomNumInSynthetic > maxRoomNumInActual_
    - _Requirements: 2.3_

  - [x] 4.2 Property 4 — استقرار الحفظ في قاعدة البيانات (`better-sqlite3` عبر `window.api.examConfig`)
    - اكتب PBT يشغِّل `buildV2Input` عدّة مرات متتالية على نفس المُدخَل
    - mock لـ `window.api.examConfig.get/save` يسجِّل كل استدعاءات `save` التي تستهدف المفتاح `'examCenterRoomsData'`
    - تحقّق أن `buildV2Input` لا يستدعي `window.api.examConfig.save` مع مفتاح `'examCenterRoomsData'` (ولا مع أي مفتاح آخر يتعلق بصفوف القاعات) خلال أي تشغيل
    - التقط snapshot منطقيّاً من قيمة `examCenterRoomsData` التي تُرجعها `get` قبل وبعد التشغيل، وتحقّق بـ deep equality أن المحتوى لم يتغيّر (الصفوف الافتراضية لم تُكتَب في قاعدة البيانات)
    - تحقّق أن `_synthetic: true` لا يظهر في أي صفّ داخل `examCenterRoomsData` الذي تُرجعه `get` بعد التشغيل
    - _Preservation: صيغة الحفظ في examCenterRoomsData لا تتغيّر_
    - _Requirements: 3.3_

- [x] 5. اختبارات integration لسيناريو حقيقي
  - شغّل `runAutoDistributionV2` على سيناريو مستويَيْن ناقصَيْن (مستوحى من SESSION-NOTES.md): "الأولى باكالوريا العلوم الرياضية - رسميون" بـ `rooms=2, M=0` + "الأولى باكالوريا علوم الإقتصاد و التدبير - رسميون" بـ `rooms=2, M=0`
  - تحقّق أن كلا المستويَيْن يظهر في النتائج بمهام حراسة (لم يعودا يُسقطان من Phase_2_Build)
  - تحقّق من ظهور قسم "قاعات افتراضية مُكمَّلة" في Diagnostics Panel بالمستويَيْن وأعدادهما الصحيحة
  - تحقّق من ظهور toast واحد مجمَّع فقط (وليس toast لكل مستوى)
  - تحقّق من ظهور مهام الحراسة لكل مستوى في Phase_2_Build بعدد = `rooms × sessions × guardsPerRoom`
  - اختبار end-to-end إضافي: بعد حفظ الصفوف المفقودة عبر `exams-rooms.html`، إعادة تشغيل التوزيع تُنتج 0 صفوف افتراضية ولا يظهر قسم التحذير
  - _Requirements: 2.1, 2.2, 2.6, 2.7_

- [x] 6. تنظيف — إزالة `console.log DEBUG` القديمة من الإصلاحات السابقة
  - راجع SESSION-NOTES.md لتحديد كل `console.log('[V2 DEBUG] ...')` المضافة في محاولات الإصلاح السابقة
  - احذف سطور DEBUG التي لم تعد ضرورية من `exams-proctors.html` (خصوصاً حول `getRoomRowsForLevel` و`buildV2Input`)
  - احتفظ فقط بـ `[V2 WARN]` ذات القيمة التشخيصية الدائمة (مثل تحذير `examCenterLevels not available`)
  - تحقّق بعد التنظيف أن كل الاختبارات من المهام 1–5 لا تزال تنجح
  - _Requirements: (صيانة — لا يرتبط بمتطلّب محدَّد)_

- [x] 7. Checkpoint — التأكد من نجاح جميع الاختبارات
  - شغّل `npm test` للتحقق من نجاح كل اختبارات الوحدة والـPBT والـintegration
  - شغّل `npm run lint` للتحقق من عدم وجود أخطاء lint في `exams-proctors.html`
  - راجع Diagnostics Panel يدوياً على سيناريو كامل وتأكد من وضوح التحذير ودقّة أعداده
  - إذا ظهرت أسئلة أو حالات غير مغطّاة، اطلب توضيحاً من المستخدم قبل إغلاق الإصلاح
