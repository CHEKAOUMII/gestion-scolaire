# Bugfix Requirements Document

## Introduction

خوارزمية توزيع المراقبين v2 تفشل في تعيين المراقبين لبعض المستويات عند الاختبار الحقيقي، لأنها تعتمد حصراً على `examCenterRoomsData` كمصدر وحيد لقائمة القاعات لكل مستوى. عندما يكون مستوى مُضافاً إلى جدولة الامتحانات (`examCenterLevels`) لكن لم تُحفظ له صفوف قاعات في صفحة "تهيئ قاعات الامتحان"، تُرجع `getRoomRowsForLevel` مصفوفة فارغة، فتُستبعد مهام هذا المستوى من Phase_2_Build ويبقى المستوى بدون توزيع.

مثال موثّق في ملاحظات الجلسة السابقة (SESSION-NOTES.md): مستويان "الأولى باكالوريا العلوم الرياضية - رسميون" و"الأولى باكالوريا علوم الإقتصاد و التدبير - رسميون" ظهرا بـ 0 rooms رغم وجودهما في الجدولة.

بعد إصلاح قاعدة البيانات، أصبحت `examCenterLevels` للسنة الدراسية 2025/2026 تحوي المعلومات الكاملة لكل مستوى (عدد القاعات `level.rooms` + قائمة المواد `level.subjects`). لذلك يجب على `buildV2Input` في `exams-proctors.html` أن يسحب عدد القاعات من `examCenterLevels` كمصدر مرجعي، ويُكمّل ما ينقص من `examCenterRoomsData` بصفوف قاعات افتراضية (مرقَّمة تسلسلياً داخل المستوى) بدل إسقاط المستوى بصمت.

**الأساس الحسابي لحاجيات المراقبين:** المُدخَل المرجعي للخوارزمية هو الثلاثي `(المستوى/الشعبة) × (عدد القاعات لكل مستوى) × (عدد المواد/الحصص لكل مستوى)`. من هذا الثلاثي تُشتَق حاجيات الأساتذة المراقبين عبر الصيغة: `إجمالي مهام الحراسة = Σ (عدد قاعات المستوى × عدد حصص/مواد المستوى × عدد الحراس لكل قاعة)` لكل مستوى مبرمَج في `scheduleEntries`. إن نقص أي عنصر من هذا الثلاثي في مصدر البيانات (مستوى غائب، أو عدد قاعات ناقص، أو حصص غير مكتملة) يُخلّ مباشرةً بدقة احتساب الحاجيات، ويؤدي إلى توزيع ناقص لا يُغطّي كل القاعات أو الحصص. ومن هنا جاءت ضرورة اعتماد `examCenterLevels` مصدراً مرجعياً لكل أضلاع هذا الثلاثي، بدل الاكتفاء بـ `examCenterRoomsData` الذي قد يكون ناقصاً في أحد أضلاعه.

نطاق الإصلاح مقصور على قراءة بيانات القاعات في `buildV2Input` وما يتصل بها مباشرة من دوال مساعِدة (مثل `getRoomRowsForLevel`) في `exams-proctors.html`. لا يمسّ هذا الإصلاح منطق الخوارزمية داخل `js/algorithms/proctor-distribution-v2.js`، ولا يغيّر صيغة الحفظ في `examCenterRoomsData` التي تستخدمها `exams-rooms.html`. إضافة المداومين والاحتياط من `examCenterLevels` في التوزيع ليست جزءاً من هذا الإصلاح وتُؤجَّل لتحديث لاحق.

## Bug Analysis

### Current Behavior (Defect)

ما يحدث حالياً عندما يكون مستوى موجوداً في `examCenterLevels` وفي `scheduleEntries` لكن بدون صفوف قاعات في `examCenterRoomsData`.

1.1 WHEN مستوى موجود في `examCenterLevels` بعدد قاعات `level.rooms > 0` وفي `scheduleEntries` كمهمة امتحان، ولا يوجد له أي صف في `examCenterRoomsData` THEN the system يستدعي `getRoomRowsForLevel(levelName)` الذي يُرجع مصفوفة فارغة، فيُسجَّل في `roomsList[levelName]` قيمة `[]`.

1.2 WHEN `roomsList[levelName]` فارغ THEN the system لا يُنتج أي مهمة قاعة لهذا المستوى في Phase_2_Build، فتُحذف كل حصص هذا المستوى من التوزيع بدون تحذير مرئي للمستخدم (يظهر فقط `[V2 DEBUG] Level: "..." → 0 rooms` في console).

1.3 WHEN مستوى موجود في `examCenterLevels` بقيمة `level.rooms = N` ولكن `examCenterRoomsData` يحوي عدداً `M < N` من الصفوف لهذا المستوى THEN the system يعتمد فقط القاعات الـ M الموجودة في `examCenterRoomsData` ويتجاهل الفرق `N - M`، فيُوزَّع عدد أقل من القاعات المتوقّعة حسب إعدادات المستوى.

### Expected Behavior (Correct)

ما يجب أن يحدث بعد الإصلاح: اعتماد `examCenterLevels` مصدراً مرجعياً لعدد القاعات لكل مستوى، مع تكميل الصفوف الناقصة في `examCenterRoomsData` بصفوف افتراضية داخل الذاكرة.

2.1 WHEN مستوى موجود في `examCenterLevels` بعدد قاعات `level.rooms > 0` وفي `scheduleEntries` كمهمة امتحان، ولا يوجد له أي صف في `examCenterRoomsData` THEN the system SHALL يُنتج `level.rooms` صفوف قاعات افتراضية في الذاكرة فقط (ترقيم تسلسلي من 1 إلى `level.rooms`) ويُمرّرها إلى `roomsList[levelName]`، بحيث تدخل مهام هذا المستوى إلى Phase_2_Build ويُعيَّن لها مراقبون.

2.2 WHEN `buildV2Input` يُنتج صفوف قاعات افتراضية لتكميل مستوى ناقص THEN the system SHALL يُسجّل تحذيراً واحداً مرئياً في الواجهة (toast أو داخل Diagnostics_Panel) يذكر اسم المستوى وعدد القاعات المُكمَّلة، ليعرف المستخدم أن البيانات الرسمية في `examCenterRoomsData` ما تزال ناقصة.

2.3 WHEN مستوى موجود في `examCenterLevels` بقيمة `level.rooms = N` ولكن `examCenterRoomsData` يحوي `M < N` صفوف فقط لهذا المستوى THEN the system SHALL يُكمّل الفرق `N - M` بصفوف قاعات افتراضية مرقَّمة تسلسلياً (تفادياً للتصادم مع أرقام الصفوف الموجودة) بحيث يصبح `roomsList[levelName].length = N`.

2.4 WHEN `level.rooms` يساوي `0` أو غير معرَّف في مستوى ما من `examCenterLevels` THEN the system SHALL يرجع إلى سلوك v1 الحالي: يستعمل فقط صفوف `examCenterRoomsData` المتاحة (قد تكون صفراً) ولا يُنشئ صفوف افتراضية.

2.5 WHEN `examCenterLevels` غير متاح أو فارغ لسنة دراسية ما THEN the system SHALL يرجع إلى السلوك الحالي (قراءة `examCenterRoomsData` فقط) دون إخفاق، مع تحذير واحد في console يذكر عدم توفر `examCenterLevels`.

2.6 WHEN `buildV2Input` يبني مهام Phase_2 لمستوى `L` مبرمَج في `scheduleEntries` THEN the system SHALL يتأكد أن عدد مهام الحراسة المُنتَجة لهذا المستوى يساوي الحاصل `rooms(L) × sessions(L) × guardsPerRoom`، حيث `rooms(L)` هو عدد القاعات المعتمَد بعد تطبيق قواعد التكميل (2.1–2.5) و`sessions(L)` هو عدد حصص/مواد المستوى المستخرَج من `examCenterLevels[L].subjects` أو من `scheduleEntries` الخاصة بالمستوى، و`guardsPerRoom` هو العدد المُعتمَد للحراس لكل قاعة في إعدادات التوزيع؛ وإذا لم يتطابق العدد المُنتَج مع هذا الحاصل، يُسجَّل تحذير تشخيصي واضح في Diagnostics_Panel يذكر المستوى وقيم الضلع الناقص.

2.7 WHEN `buildV2Input` يُنتج مُدخَل الخوارزمية THEN the system SHALL يعتمد `examCenterLevels` مصدراً مرجعياً لكل أضلاع الثلاثي `(المستوى، عدد القاعات، عدد المواد/الحصص)` بحيث يُستعمل `level.rooms` لضلع القاعات و`level.subjects` (أو ما يوافقه في `scheduleEntries`) لضلع الحصص، قبل الرجوع إلى `examCenterRoomsData` كمصدر تفصيلي للصفوف، لضمان أن إجمالي مهام الحراسة المُحتسَب يعكس الحاجيات الفعلية للمركز.

### Unchanged Behavior (Regression Prevention)

السلوك القائم الذي يجب أن يبقى كما هو لكل المستويات غير المتأثّرة بالعيب.

3.1 WHEN مستوى موجود في `examCenterLevels` بقيمة `level.rooms = N` ويوجد له `N` صفوف فعلية في `examCenterRoomsData` (كل الصفوف محفوظة بشكل كامل) THEN the system SHALL CONTINUE TO يستعمل صفوف `examCenterRoomsData` كما هي بدون إنشاء أي صف افتراضي، ومحتوى `roomsList[levelName]` يبقى مطابقاً لما تُرجعه `getRoomRowsForLevel` حالياً.

3.2 WHEN مستوى لا يوجد في `scheduleEntries` (غير مبرمج لأي امتحان) THEN the system SHALL CONTINUE TO لا يُضيفه إلى `roomsList`، حتى لو كان موجوداً في `examCenterLevels` بقاعات مُعرَّفة.

3.3 WHEN المستخدم يحفظ/يعدّل صفوف قاعات من `exams-rooms.html` THEN the system SHALL CONTINUE TO يكتب في `examCenterRoomsData` عبر `window.api.examConfig.save` (قاعدة `better-sqlite3` في العملية الرئيسية) بنفس الصيغة الحالية بدون أي تغيير، والصفوف الافتراضية المُولَّدة في الذاكرة لا تُحفظ في قاعدة البيانات ولا تمرّ عبر أي استدعاء حفظ.

3.4 WHEN الخوارزمية v1 (Algorithm_Toggle = v1) تُشغَّل THEN the system SHALL CONTINUE TO تعمل بنفس المنطق القائم وتقرأ مصادر البيانات كما كانت دون أي مسار مختلف.

3.5 WHEN Phase_1_PrePass وPhase_2_Build وPhase_3_Optimize تُستدعى داخل `js/algorithms/proctor-distribution-v2.js` THEN the system SHALL CONTINUE TO تنفّذ منطقها الداخلي بدون تغيير؛ الإصلاح مقتصر على طبقة بناء المُدخَل في `buildV2Input` ودوالها المساعدة في `exams-proctors.html`.

3.6 WHEN `getSummaryCandidateCountForLevel` وبقية الدوال التي تقرأ `examCenterRoomsData` لأغراض العرض (غير توزيع المراقبين) تُستدعى THEN the system SHALL CONTINUE TO تُرجع نتائجها الحالية دون احتساب الصفوف الافتراضية، لأن هذه الصفوف مقصورة على مسار بناء مُدخَل v2.
