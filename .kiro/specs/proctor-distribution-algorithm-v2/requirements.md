# Requirements Document

## Introduction

هذه الميزة تُطوّر خوارزمية توزيع المراقبين على قاعات الامتحانات في مشروع Pencil2 من الخوارزمية الجشعة الحالية (Greedy Constructive Heuristic) إلى خوارزمية هجينة على ثلاث مراحل: (1) تحليل جدوى ونشر قيود (CSP + AC-3)، (2) بناء تعيين أمثل محلياً عبر خوارزمية المجرية (Hungarian/Munkres) لكل نصف يوم مع Fallback جشع، (3) صقل الحل بـ Simulated Annealing خفيف. الهدف هو تقليل تشتّت العبء بين المراقبين، رفع نسبة احترام القواعد المرنة (زوج ذكر/أنثى، عدم تكرار القاعة، تجنّب التخصص، احترام المجموعات المتناوبة G1/G2)، مع الحفاظ على كل القيود الصلبة (الإعفاءات، المداومة، عدم التكرار) وعلى الأداء داخل المتصفح بدون مكتبات خارجية.

تُنفَّذ الخوارزمية كوحدة منفصلة في `js/algorithms/proctor-distribution-v2.js`، وتُدمج في `exams-proctors.html` عبر Toggle جديد يسمح بالرجوع إلى الخوارزمية الحالية. تُخزَّن النتائج في نفس مفتاح `localStorage` الحالي `examAutoDistributionData` مع إضافة حقل `algorithmVersion: 'v2'` وحقل `diagnostics` للتقرير التفصيلي.

## Glossary

- **System_V2**: مجموعة الوحدات التي تُنفّذ الخوارزمية الهجينة الجديدة على ثلاث مراحل، تُصدَّر من `js/algorithms/proctor-distribution-v2.js`.
- **Orchestrator**: الدالة العليا في System_V2 التي تستدعي المراحل الثلاث بالترتيب وتُنتج النتيجة النهائية وتقرير Diagnostics.
- **Phase_1_PrePass**: مرحلة تحليل الجدوى ونشر القيود (بناء نموذج CSP، تطبيق AC-3 مبسّط، استخراج Singletons، احتساب Lower_Bound).
- **Phase_2_Build**: مرحلة بناء الحل الأولي لكل نصف يوم عبر Hungarian_Solver مع Greedy_Fallback.
- **Phase_3_Optimize**: مرحلة صقل الحل عبر SA_Optimizer.
- **CSP_Model**: تمثيل مسألة التوزيع كـ Constraint Satisfaction Problem: متغيرات = (حصة، قاعة، فتحة مراقب)، مجالات = قائمة المراقبين المؤهلين لكل متغير.
- **AC_3**: تنفيذ مبسّط لخوارزمية Arc Consistency لتقليص مجالات المتغيرات قبل البناء.
- **Singleton_Assignment**: متغيّر في CSP_Model بقي مجاله بمقاس 1 بعد AC_3، ويُثبَّت مسبقاً قبل Phase_2_Build.
- **Lower_Bound**: الحد الأدنى النظري للتوازن لكل معلم، يُحتسب كـ `ceil(totalTasks / numEligibleTeachers)` بعد خصم الإعفاءات والمداومة.
- **Upper_Bound**: الحد الأقصى النظري للعبء لكل معلم الناتج عن Lower_Bound + 1 لأسباب التقريب.
- **Hungarian_Solver**: تنفيذ vanilla JS لخوارزمية Munkres/Hungarian بتعقيد O(n³) داخل ملف System_V2.
- **Cost_Matrix**: مصفوفة تكلفة مربّعة (rows = مهام القاعات في نصف يوم، columns = المراقبون المتاحون)؛ تُوسَّع بصفوف/أعمدة dummy عند الحاجة.
- **Cost_Function**: دالة تحتسب تكلفة تعيين مراقب واحد لمهمة قاعة = Σ(weights × soft_violations) + penalty(guard_load).
- **Greedy_Fallback**: الخوارزمية الجشعة الحالية المُعاد استخدامها كشبكة أمان عند فشل Hungarian_Solver في إنتاج تعيين صالح.
- **SA_Optimizer**: تنفيذ Simulated Annealing خفيف (500–1000 iteration أو 500ms كحدّ أقصى).
- **Neighborhood_Move**: تعديل محلّي على الحل الحالي من أحد ثلاثة أنواع: `swap_guards`، `swap_roles`، `reassign_reserve`.
- **Objective_Function**: دالة الهدف المرشّحة للتقليل في SA: `α·std(guard_loads) + β·Σ(soft_violations) + γ·morning_evening_imbalance`.
- **Hard_Constraint**: قيد لا يجوز خرقه أبداً (الإعفاء، المداومة، عدم تكرار المراقب في نفس الحصة، عدم تكرار المراقب في نفس نصف اليوم إلا بقاعدة محدّدة، عدم تكرار المراقب في نفس اليوم إلا بقاعدة محدّدة).
- **Soft_Constraint**: قاعدة مرنة يُفضَّل احترامها ويمكن خرقها بعقوبة (زوج ذكر/أنثى، عدم تكرار القاعة للمراقب، تجنّب تخصّص المادة، احترام المجموعة المتناوبة G1/G2).
- **Alternating_Group**: مجموعة G1 أو G2 المُخصّصة لمراقب من أصل تناوب الصباح/المساء، مصدرها `meAssignments`.
- **Diagnostics_Report**: كائن JSON يُصدره Orchestrator بعد التنفيذ يحتوي: مدة كل مرحلة (ms)، عدد Singletons، عدد استدعاءات Greedy_Fallback، std/min/max/gini لتوزيع الحراسة، عدد soft_violations، عدد iterations في SA، حالة التوقف المبكر.
- **Diagnostics_Panel**: قسم UI جديد في `exams-proctors.html` يعرض Diagnostics_Report بعد التنفيذ.
- **Algorithm_Toggle**: زر تبديل في UI `exams-proctors.html` يسمح للمستخدم باختيار v1 (الخوارزمية الحالية) أو v2 (الخوارزمية الهجينة).
- **Weights_Preset**: إعداد مسبق لقيم α/β/γ، يتوفّر ثلاثة خيارات: "توازن"، "احترام المجموعات"، "تنوع القاعات".
- **PBT_Suite**: مجموعة اختبارات Property-Based Tests تُثبت صحّة الخوارزمية.
- **GS2_Input_Contract**: مجموعة الحقول المتوقّعة كمُدخلات: `exemptionsData`, `dutyData`, `meAssignments`, `examDistributionRules`, `scheduleEntries`, `proctorsList`, `roomsList`, بنفس الصيغة التي تستعملها v1.

## Requirements

### Requirement 1: Algorithm Orchestration and Toggle

**User Story:** As a مستخدم (مدير مؤسسة)، I want تبديل الخوارزمية بين v1 و v2 من واجهة التوزيع، so that أستطيع مقارنة النتائج والرجوع بأمان إذا أعطت v2 نتيجة غير مناسبة لحالتي.

#### Acceptance Criteria

1. THE Algorithm_Toggle SHALL يعرض خيارَين حصريَّين: "الخوارزمية الحالية (v1)" و"الخوارزمية المُحسَّنة (v2)".
2. WHEN المستخدم يختار v2 ويضغط زر التوزيع التلقائي، THE Orchestrator SHALL ينفّذ Phase_1_PrePass ثم Phase_2_Build ثم Phase_3_Optimize بالترتيب.
2.1. WHEN Phase_3_Optimize ينتهي بنجاح (أو يُتخطّى بحسب الإعداد)، THE Orchestrator SHALL ينتقل تلقائياً إلى الحالة `COMPLETED` ويُسجّلها في `diagnostics.orchestratorState`.
3. WHEN المستخدم يختار v1، THE System_V2 SHALL لا يُستدعى، وتُستعمل الخوارزمية الحالية كما هي بدون أي تغيير في سلوكها.
3.1. WHERE المستخدم لم يختر بعد v1 ولا v2 (الحالة الافتراضية الأولى لجلسة جديدة)، THE System_V2 SHALL يُعتمَد افتراضياً ويُعامَل الأمر كاختيار ضمني لـ v2.
4. THE Orchestrator SHALL يُرجع كائناً يحتوي حقلَي `result` (مصفوفة التوزيع بنفس شكل v1) و`diagnostics` (Diagnostics_Report).
5. WHEN Orchestrator ينتهي بنجاح، THE System_V2 SHALL يحفظ النتيجة في `localStorage` تحت المفتاح `examAutoDistributionData` مع إضافة `algorithmVersion: 'v2'` و`diagnostics`.
6. IF المستخدم ضغط زر التوزيع التلقائي بينما v2 قيد التنفيذ، THEN THE Orchestrator SHALL يتجاهل الضغطة الثانية ويُكمل التنفيذ الأول بدون إعادة تشغيل.
7. THE System_V2 SHALL يقبل نفس GS2_Input_Contract المستعمل في v1 بدون تعديل على بنية البيانات.
8. IF أحد الحقول في GS2_Input_Contract غير متوفّر أو فارغ، THEN THE Orchestrator SHALL يُعيد خطأ وصفياً ويوقف التنفيذ قبل بدء Phase_1_PrePass.

### Requirement 2: Phase 1 — Pre-pass Constraint Propagation and Feasibility

**User Story:** As a مستخدم، I want تقرير جدوى واضحاً قبل التوزيع، so that أعرف ما إذا كانت القيود قابلة للتحقيق وأتّخذ قراراً مسبقاً بتعديل الإعفاءات أو المداومة.

#### Acceptance Criteria

1. WHEN Phase_1_PrePass يبدأ، THE Phase_1_PrePass SHALL يبني CSP_Model من المدخلات بحيث يكون كل متغيّر ثلاثية (schedule_entry_id، room_key، slot_index).
2. THE Phase_1_PrePass SHALL يُطبّق AC_3 على CSP_Model حتى الاستقرار أو بلوغ عدد أقصى من التكرارات قدره 1000.
3. WHEN AC_3 يكتشف مجالاً فارغاً لمتغير ما، THE Phase_1_PrePass SHALL يُضيف سطراً إلى `diagnostics.infeasibilities` يصف (المتغيّر، السبب) ويُكمل التنفيذ بدون توقف.
4. WHEN متغيّر يحمل مجالاً من عنصر واحد بعد AC_3، THE Phase_1_PrePass SHALL يصنّفه كـ Singleton_Assignment ويُثبّته في قائمة `prefixed_assignments`.
4.1. THE Phase_1_PrePass SHALL يُعدّل `prefixed_assignments` حصراً نتيجةً لاكتشاف Singleton_Assignment، ولا يُضاف إليها أيّ تعيين من مصدر آخر (إعفاء، مداومة، تجاوز يدوي).
5. THE Phase_1_PrePass SHALL يحتسب Lower_Bound لكل معلم وفق الصيغة: `floor((totalTasks - fixedReservedTasks) / numEligibleTeachers)`.
6. THE Phase_1_PrePass SHALL يحتسب Upper_Bound لكل معلم وفق الصيغة: `Lower_Bound + 1`.
7. WHEN Phase_1_PrePass ينتهي، THE Phase_1_PrePass SHALL يُدرج في `diagnostics` الحقول التالية: `lowerBound`, `upperBound`, `singletonCount`, `domainReductionPercent`, `phase1DurationMs`.
8. WHILE Phase_1_PrePass قيد التنفيذ، THE Orchestrator SHALL يعرض مؤشّر تقدّم في Diagnostics_Panel يدلّ على المرحلة الحالية.
8.1. WHEN Phase_1_PrePass انتهى وبدأ Phase_2_Build، THE Orchestrator SHALL يُخفي مؤشّر تقدّم Phase_1 فوراً؛ مؤشّر Phase_1 يظهر حصراً طيلة تنفيذ Phase_1_PrePass.
9. IF عدد التكرارات في AC_3 يتجاوز 1000 قبل الاستقرار، THEN THE Phase_1_PrePass SHALL يوقف AC_3 ويسجّل تحذيراً في `diagnostics.warnings` ويُكمل إلى Phase_2_Build.

### Requirement 3: Phase 2 — Hungarian-per-Halfday Assignment with Greedy Fallback

**User Story:** As a مستخدم، I want حلاً أولياً أمثل محلياً لكل نصف يوم، so that تشتّت العبء بين المراقبين يقلّ والقواعد المرنة تُحترم أكثر من الخوارزمية الحالية.

#### Acceptance Criteria

1. WHEN Phase_2_Build يبدأ، THE Phase_2_Build SHALL يُقسّم scheduleEntries إلى مجموعات نصف يوم باستعمال نفس المفتاح `halfdayKey` الذي تستخدمه v1.
2. FOR EACH مجموعة نصف يوم، THE Phase_2_Build SHALL يبني Cost_Matrix عبر Cost_Function حيث الصفوف = مهام القاعات في هذا نصف اليوم والأعمدة = المراقبون المتاحون لهذا نصف اليوم.
3. IF عدد الأعمدة في Cost_Matrix أقل من عدد الصفوف، THEN THE Phase_2_Build SHALL يُضيف أعمدة dummy بتكلفة عالية جداً (Infinity_Sentinel = 1e9) ويُكمل Hungarian_Solver.
4. WHEN Hungarian_Solver يُنتج تعييناً كل عنصر فيه تكلفته أقل من Infinity_Sentinel، THE Phase_2_Build SHALL يعتمد هذا التعيين للنصف اليوم الحالي.
5. IF Hungarian_Solver يُنتج تعييناً يحتوي عنصراً بتكلفة ≥ Infinity_Sentinel، THEN THE Phase_2_Build SHALL يستدعي Greedy_Fallback لإكمال المهام غير المحلولة فقط ويزيد عدّاد `diagnostics.fallbackCount`.
6. THE Cost_Function SHALL يُرجع `Infinity_Sentinel` لأي تعيين يخرق Hard_Constraint.
7. THE Cost_Function SHALL يُضيف عقوبة موزونة عن كل Soft_Constraint مخروق: `5` لخرق المجموعة المتناوبة، `3` لتكرار القاعة، `2` لتخصّص المادة، `1` لعدم الحصول على زوج ذكر/أنثى.
8. THE Cost_Function SHALL يُضيف عقوبة `max(0, guardLoad - Lower_Bound) × 4` لموازنة الحمولة.
9. WHERE قاعة تتطلّب مراقبَيْن اثنين، THE Phase_2_Build SHALL يُشغّل Hungarian_Solver مرتَيْن متتاليتَيْن: الأولى لاختيار المراقب الأول، والثانية لاختيار المُكمِّل مع تعديل Cost_Function لتفضيل الجنس المُخالف (إضافة عقوبة +3 إذا نفس الجنس).
10. WHEN Phase_2_Build ينتهي، THE Phase_2_Build SHALL يُدرج في `diagnostics` الحقول: `phase2DurationMs`, `fallbackCount`, `totalHalfdaysProcessed`, `averageCostPerAssignment`.
11. IF Hungarian_Solver يفشل (throws exception أو يرجع null) لنصف يوم، THEN THE Phase_2_Build SHALL يلجأ إلى Greedy_Fallback لكامل هذا النصف يوم ويُسجّل خطأ في `diagnostics.errors`.

### Requirement 4: Phase 3 — Simulated Annealing Optimization

**User Story:** As a مستخدم، I want تحسيناً إضافياً على الحل الأولي، so that يصل التوزيع إلى جودة أقرب للمثالية دون انتظار طويل.

#### Acceptance Criteria

1. WHEN Phase_3_Optimize يبدأ، THE Phase_3_Optimize SHALL يأخذ نتيجة Phase_2_Build كحل أولي.
2. THE SA_Optimizer SHALL يبدأ بحرارة ابتدائية `T0 = 1.0` وحرارة دنيا `T_min = 0.01` ومعدّل تبريد `cooling_rate = 0.95`.
3. WHILE `T > T_min` AND `iterationCount < maxIterations` AND `elapsedMs < maxDurationMs`، THE SA_Optimizer SHALL يختار Neighborhood_Move عشوائياً ويُقيّمه بمعيار Metropolis.
4. THE SA_Optimizer SHALL يدعم ثلاثة أنواع Neighborhood_Move: `swap_guards` (تبادل حارسَيْن بين قاعتَيْن في نفس الحصّة)، `swap_roles` (تبادل حارس واحتياطي في نفس نصف اليوم)، `reassign_reserve` (نقل احتياطي بين حصص متاحة).
5. THE SA_Optimizer SHALL يرفض أي Neighborhood_Move يُنتج حالة تخرق Hard_Constraint، بدون احتساب تكلفة.
6. WHEN Neighborhood_Move يُخفّض Objective_Function، THE SA_Optimizer SHALL يقبله دائماً.
7. WHEN Neighborhood_Move يرفع Objective_Function بقيمة ΔE، THE SA_Optimizer SHALL يقبله باحتمال `exp(-ΔE / T)`.
8. THE Objective_Function SHALL تحتسب: `α·std(guardLoads) + β·totalSoftViolations + γ·morningEveningImbalance` حيث `morningEveningImbalance = |meanMorningLoad - meanAfternoonLoad|` لكل معلم معنيّ.
9. THE SA_Optimizer SHALL يدعم ثلاثة Weights_Preset: "توازن" (α=3, β=1, γ=2)، "احترام المجموعات" (α=1, β=1, γ=5)، "تنوع القاعات" (α=1, β=4, γ=1).
9.1. WHERE المستخدم يُقدّم قيم α/β/γ مخصّصة عبر UI أو GS2_Input_Contract، THE SA_Optimizer SHALL يستعمل القيم المُقدَّمة بدلاً من قيم Weights_Preset، ويُسجّل القيم الفعلية في `diagnostics.weightsUsed`.
10. IF لم تتحسّن Objective_Function لمدة 100 iteration متتالية، THEN THE SA_Optimizer SHALL يتوقّف مبكراً ويُسجّل `earlyStop = true` في `diagnostics`.
11. THE maxIterations SHALL يكون 1000، وTHE maxDurationMs SHALL يكون 500.
12. WHEN Phase_3_Optimize ينتهي، THE Phase_3_Optimize SHALL يُدرج في `diagnostics` الحقول: `phase3DurationMs`, `iterationsExecuted`, `acceptedMoves`, `rejectedMoves`, `earlyStop`, `initialObjective`, `finalObjective`, `preset`.
12.1. THE Phase_3_Optimize SHALL يسمح بكتابة حقول `diagnostics` في أي لحظة (حتى أثناء التنفيذ)، بما فيها قيم مدّة غير نهائية أو سالبة (مثلاً `-1`) للدلالة على حالة جارية أو غير مكتملة.
13. IF Phase_3_Optimize مُعطَّل في الإعدادات قبل بدء التنفيذ، THEN THE Orchestrator SHALL يتخطّى حلقة SA الرئيسية (الخطوات 3-10) ويُسجّل `phase3Skipped = true` في `diagnostics`، مع الإبقاء على تهيئة ثوابت المرحلة (T0, T_min, cooling_rate, maxIterations, maxDurationMs) كما هي في تعريف الدالة.
13.1. IF إعداد تعطيل Phase_3_Optimize تغيّر إلى "معطَّل" بعدما بدأ التنفيذ الفعلي للمرحلة، THEN THE Phase_3_Optimize SHALL يُكمل التشغيل الحالي دون توقف، ويُطبَّق الإعداد الجديد على التشغيل التالي فقط.

### Requirement 5: Hard Constraint Preservation

**User Story:** As a مستخدم، I want ضماناً بأن القيود الصلبة لا تُكسر أبداً، so that النتيجة تُحترم الإعفاءات والمداومة ولا تُسبّب تعارضات قانونية أو تنظيمية.

#### Acceptance Criteria

1. FOR EACH تعيين نهائي، THE System_V2 SHALL يضمن أنّ المراقب ليس في قائمة إعفاءات الحصّة.
2. FOR EACH تعيين نهائي، THE System_V2 SHALL يضمن أنّ المراقب ليس في قائمة المداومين للمادّة المُمتحَنة.
3. FOR EACH تعيين نهائي، THE System_V2 SHALL يضمن أنّ نفس المراقب لا يظهر مرّتَيْن في نفس الحصّة.
4. IF خيار `allowHalfdayReuse` غير مُفعَّل، THEN THE System_V2 SHALL يضمن أنّ نفس المراقب لا يظهر مرّتَيْن في نفس نصف اليوم.
5. IF خيار `allowDayReuse` غير مُفعَّل، THEN THE System_V2 SHALL يضمن أنّ نفس المراقب لا يظهر مرّتَيْن في نفس اليوم.
6. IF Phase_2_Build أو Phase_3_Optimize اضطُرّ إلى انتهاك Hard_Constraint لأنّ Greedy_Fallback لم يجد بديلاً، THEN THE System_V2 SHALL يترك الفتحة فارغة ويُسجّل `missingCount` في `diagnostics.shortages` بدل إنتاج تعيين غير صالح.
7. WHILE SA_Optimizer يُقيّم Neighborhood_Move، THE SA_Optimizer SHALL يتحقّق من Hard_Constraint قبل احتساب تكلفة الحل الجديد.

### Requirement 6: Soft Constraint Weighting and Observability

**User Story:** As a مستخدم، I want التحكّم في أولويات القواعد المرنة، so that أختار إعداداً يناسب مؤسّستي (موازنة كاملة، أو احترام المجموعات، أو تنوّع القاعات).

#### Acceptance Criteria

1. THE System_V2 SHALL يقرأ إعداد Weights_Preset من UI قبل بدء التنفيذ.
2. WHEN Weights_Preset = "توازن"، THE Cost_Function AND THE Objective_Function SHALL يستعملان (α=3, β=1, γ=2).
3. WHEN Weights_Preset = "احترام المجموعات"، THE Cost_Function AND THE Objective_Function SHALL يستعملان (α=1, β=1, γ=5).
4. WHEN Weights_Preset = "تنوع القاعات"، THE Cost_Function AND THE Objective_Function SHALL يستعملان (α=1, β=4, γ=1).
5. THE Diagnostics_Report SHALL يحتوي حقل `softViolationsByType` يعدّ كل نوع انتهاك على حدة: `sameRoomRepeats`, `subjectConflicts`, `groupMismatches`, `genderImbalances`.
6. FOR EACH تعيين نهائي، THE System_V2 SHALL يُلحق به قائمة `softViolations` (قد تكون فارغة) تصف أيّ قواعد مرنة خُرقت.

### Requirement 7: Performance Budget

**User Story:** As a مستخدم، I want أداءً سريعاً، so that لا أنتظر أكثر من ثانيتَيْن لإتمام توزيع كبير في المتصفح.

#### Acceptance Criteria

1. WHEN المدخل يحتوي ≤ 50 مراقبين و≤ 30 حصّة، THE Phase_2_Build SHALL ينتهي في أقل من 1000 ms.
2. WHEN المدخل يحتوي ≤ 100 مراقبين و≤ 50 حصّة و≤ 10 قاعات، THE Orchestrator (المراحل الثلاث مجتمعة) SHALL ينتهي في أقل من 2000 ms.
3. THE Phase_3_Optimize SHALL ينتهي في أقل من 500 ms إضافية مهما كان حجم المدخل.
4. WHEN Orchestrator يُتمّ التنفيذ، THE Diagnostics_Report SHALL يتضمّن `totalDurationMs` ويَعرِضه Diagnostics_Panel.
4.1. WHERE Diagnostics_Report لا يتضمّن `totalDurationMs` أو Orchestrator لم يُكمِل، THE Diagnostics_Panel SHALL يعرض مدّة مستقلّة مُحتسبة من الطابع الزمني للعرض والطابع الزمني لبدء التشغيل، مع الإشارة إلى أنّها مدّة تقديرية.
5. IF Phase_2_Build يتجاوز 1500 ms، THEN THE Orchestrator SHALL يوقف المرحلة ويُكمل بالحل الأولي الموجود ويُسجّل `timeoutExceeded = true` في `diagnostics.warnings`.
5.1. IF Phase_2_Build انتهى بسبب `timeoutExceeded`، THEN THE Orchestrator SHALL يُكمل إلى Phase_3_Optimize ويُطبّق عليها نفس حدود الأداء (maxDurationMs = 500ms, maxIterations = 1000).

### Requirement 8: Diagnostics Panel

**User Story:** As a مستخدم، I want لوحة تشخيصية بعد التوزيع، so that أرى جودة الحل ومدى نجاح كل مرحلة وأقرّر ما إذا كنت سأعيد التشغيل.

#### Acceptance Criteria

1. WHEN Orchestrator يُتمّ التنفيذ، THE Diagnostics_Panel SHALL يظهر تحت جدول التوزيع في `exams-proctors.html`.
2. THE Diagnostics_Panel SHALL يعرض مدة كل مرحلة بالميلي-ثانية.
3. THE Diagnostics_Panel SHALL يعرض إحصائيات توازن الحراسة: `std`, `min`, `max`, `giniCoefficient`.
4. THE Diagnostics_Panel SHALL يعرض عدد انتهاكات القواعد المرنة موزّعاً على الأنواع الأربعة.
5. THE Diagnostics_Panel SHALL يعرض `fallbackCount` مع قائمة نصف-الأيام التي استُعمل فيها Greedy_Fallback.
6. THE Diagnostics_Panel SHALL يعرض عدد `iterationsExecuted` وحالة `earlyStop` للمرحلة الثالثة.
7. THE Diagnostics_Panel SHALL يعرض قائمة `shortages` و`infeasibilities` و`warnings` في لوحات قابلة للطيّ.
8. WHERE المستخدم اختار v1، THE Diagnostics_Panel SHALL يكون مخفياً عند التشغيل التالي للخوارزمية.
8.1. WHEN المستخدم يبدّل Algorithm_Toggle من v2 إلى v1 بينما Diagnostics_Panel مرئي من تنفيذ v2 سابق، THE Diagnostics_Panel SHALL يبقى مرئياً بنتائجه السابقة حتى التشغيل التالي للخوارزمية.

### Requirement 9: Backward Compatibility and Persistence

**User Story:** As a مستخدم، I want دعم الرجوع إلى الخوارزمية الحالية، so that لا أفقد سير عملي الحالي ولا تتأثّر البيانات المخزّنة.

#### Acceptance Criteria

1. THE System_V2 SHALL يحفظ النتيجة في `localStorage.examAutoDistributionData` بنفس بنية الحقول المستعملة في v1 بالإضافة إلى `algorithmVersion` و`diagnostics`.
2. WHEN صفحة `exams-proctors.html` تُحمَّل ووجدت بيانات محفوظة بـ `algorithmVersion = 'v2'`، THE Algorithm_Toggle SHALL يُضبط تلقائياً على v2 وDiagnostics_Panel يُعرض من بيانات `diagnostics` المحفوظة.
2.1. THE Algorithm_Toggle SHALL يثق بقيمة حقل `algorithmVersion` المقروءة من `localStorage` بدون محاولة التحقق من سلامة أو صحة باقي الحقول؛ إذا كان الحقل موجوداً بقيمة `'v2'` يُضبط المفتاح على v2 حتى لو تعذّر لاحقاً عرض Diagnostics_Panel (حالة المعالجة في القاعدة 9.5).
3. WHEN صفحة `exams-proctors.html` تُحمَّل ولم تجد حقل `algorithmVersion` أو لم تجد بيانات محفوظة أصلاً في `examAutoDistributionData`، THE Algorithm_Toggle SHALL يُضبط افتراضياً على v1.
4. THE System_V2 SHALL لا يُعدّل شكل صف التوزيع المُستهلَك في `exams-rooms.html` (نفس الحقول: `session_key`, `room_name`, `proctors`, `reserves`, `notes`…).
5. IF بيانات محفوظة قديمة تحتوي `algorithmVersion = 'v2'` لكن بدون حقل `diagnostics`، THEN THE Diagnostics_Panel SHALL يَعرض رسالة "لا توجد بيانات تشخيصية متاحة لهذا التوزيع".

### Requirement 10: Testing Suite

**User Story:** As a مطوّر، I want اختبارات خاصية تُثبت صحّة الخوارزمية، so that لا تتسرّب أخطاء منطقية إلى الإنتاج.

#### Acceptance Criteria

1. THE PBT_Suite SHALL يحتوي اختباراً يُثبت أنّ Hard_Constraint لا يُكسر لأي مدخل صالح مُولَّد عشوائياً.
2. THE PBT_Suite SHALL يحتوي اختباراً يُثبت أنّ `std(guardLoads)` في نتيجة v2 ≤ `std(guardLoads)` في نتيجة v1 لنفس المدخل في 95% من الحالات المُولَّدة على الأقل.
3. THE PBT_Suite SHALL يحتوي اختباراً يُثبت أنّ نسبة المراقبين المُكلَّفين خارج Alternating_Group الخاصّة بهم في v2 ≤ نفس النسبة في v1 لنفس المدخل في 95% من الحالات على الأقل.
4. THE PBT_Suite SHALL يحتوي اختباراً يُثبت أنّ نسبة القاعات التي حصلت على زوج ذكر/أنثى في v2 ≥ نفس النسبة في v1 حين يتوفّر عدد كافٍ من الجنسَيْن في المجموعة.
5. THE PBT_Suite SHALL يحتوي اختباراً يُثبت Idempotence: تشغيل Orchestrator مرتَيْن متتاليتَيْن على نفس المدخل ونفس `randomSeed` يُنتج نفس النتيجة.
6. THE PBT_Suite SHALL يحتوي اختباراً يُثبت أنّ Hungarian_Solver المُنفَّذ يُنتج مجموع تكلفة أدنى أو مساوٍ لمجموع تكلفة التعيين الجشع على مصفوفات الاختبار المُولَّدة.
7. THE PBT_Suite SHALL يحتوي اختباراً يُثبت أنّ AC_3 لا يُزيل قيمة من أيّ مجال إلّا إذا كانت بالفعل متعارضة مع قيد.
8. THE PBT_Suite SHALL يُنفَّذ بمكتبة fast-check (أو ما يعادلها في البيئة) ويُدمَج في `npm test`.

### Requirement 11: Vanilla JS Implementation Constraints

**User Story:** As a مطوّر، I want تنفيذاً بدون تبعيات جديدة، so that المشروع يبقى خفيفاً ومتوافقاً مع بيئة Electron الحالية.

#### Acceptance Criteria

1. THE System_V2 SHALL يُكتب بـ JavaScript vanilla (ES2019+ المدعوم في Electron 35).
2. THE System_V2 SHALL لا يُضيف أيّ تبعية إلى `package.json` في قسم `dependencies`.
3. THE Hungarian_Solver SHALL يُنفَّذ من الصفر داخل `js/algorithms/proctor-distribution-v2.js` ولا يستورد أيّ مكتبة خارجية.
4. THE SA_Optimizer SHALL يُنفَّذ من الصفر داخل نفس الملف ولا يستورد أيّ مكتبة خارجية.
5. WHERE اختبار PBT يتطلّب مكتبة fast-check، THE fast-check SHALL يُضاف فقط في قسم `devDependencies`.
5.1. THE PBT_Suite SHALL يظلّ مطلوباً ومُنفَّذاً بغضّ النظر عن وجود fast-check في `devDependencies`؛ إذا تعذّر استعمال fast-check، يُنفَّذ PBT_Suite عبر مولّد خصائص محلّي داخل `tests/` يُحاكي واجهة Arbitraries اللازمة.

### Requirement 12: Deterministic Reproducibility

**User Story:** As a مستخدم، I want تشغيلاً قابلاً للتكرار، so that أُعيد نفس التوزيع مرّة أخرى للمراجعة أو تصحيح الأخطاء.

#### Acceptance Criteria

1. THE Orchestrator SHALL يقبل خياراً `randomSeed` ضمن GS2_Input_Contract.
2. WHEN `randomSeed` مُعطَى ومُدخَلات الأخرى متطابقة، THE Orchestrator SHALL يُنتج نفس نتيجة التوزيع بايت-بايت.
3. THE SA_Optimizer SHALL يستعمل مولّد عشوائي بذري (seeded PRNG) مبنيّ من `randomSeed` المُقدَّم من المستخدم إن وُجد، وإلا من `seedUsed` التلقائي المُولَّد في القاعدة 4.
3.1. IF تعذّرت تهيئة PRNG باستعمال البذرة المُقدَّمة (مثلاً نوع غير مدعوم أو قيمة غير صالحة)، THEN THE Orchestrator SHALL يفشل التنفيذ فوراً ويُسجّل الخطأ في `diagnostics.errors` بدون الانتقال إلى Phase_2_Build.
4. IF `randomSeed` غير مُعطى، THEN THE Orchestrator SHALL يُولِّد seed من `Date.now()` ويُدرجه في `diagnostics.seedUsed`.

### Requirement 13: Error Handling and Graceful Degradation

**User Story:** As a مستخدم، I want أن تتعامل الخوارزمية مع الأخطاء بسلاسة، so that لا تتحطّم الواجهة عند وجود بيانات غير مكتملة.

#### Acceptance Criteria

1. IF Phase_1_PrePass يكشف عدم جدوى كاملة (مهمّة واحدة على الأقلّ بدون أيّ مرشّح)، THEN THE Orchestrator SHALL يُكمل التنفيذ، ويترك الفتحات غير القابلة للحل فارغة، ويُسجّل `totalInfeasibleSlots` في `diagnostics`.
2. IF Hungarian_Solver يُطلق استثناء، THEN THE Phase_2_Build SHALL يلتقط الاستثناء ويلجأ إلى Greedy_Fallback للنصف يوم المتأثّر ويُسجّل الخطأ في `diagnostics.errors`.
3. IF SA_Optimizer يُطلق استثناء، THEN THE Phase_3_Optimize SHALL يُرجع الحل الأولي من Phase_2_Build بدون تعديل ويُسجّل الخطأ تلقائياً في `diagnostics.errors` قبل الإرجاع.
4. WHEN Orchestrator يُسجّل خطأ في `diagnostics.errors`، THE Diagnostics_Panel SHALL يعرض هذه الأخطاء بشكل بارز (أيقونة تحذير).
4.1. IF Diagnostics_Panel فشل في عرض الأخطاء (استثناء في DOM أو تعذّر الوصول إلى العنصر)، THEN THE System_V2 SHALL يوقف المعالجة التالية (حفظ localStorage، تحديث الواجهة) ويَطرح خطأ بارزاً (toast) لضمان إخبار المستخدم بوجود مشكلة.
5. IF مدخل GS2_Input_Contract يحتوي مرجعاً إلى معلم غير موجود في `proctorsList`، THEN THE Orchestrator SHALL يتجاهل هذا المرجع ويُسجّل تحذيراً في `diagnostics.warnings`.
