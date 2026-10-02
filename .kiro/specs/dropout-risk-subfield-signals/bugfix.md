# Bugfix Requirements Document

## Introduction

في صفحة ملف التلميذ (`student-profile.html` / النموذج `student-profile-prototype.html`)، لا يتفاعل **مؤشر الخطر** (gauge مؤشر خطر الانقطاع) مع معظم الحقول الفرعية للجوانب. فمثلاً في تبويب **الجانب الصحي والنفسي**، يتغيّر المؤشر فقط عند تعديل **الحالة العامة** (`bm-health-gen`)، بينما الحقول الفرعية الأخرى — **النوم والراحة** (`bm-sleep`)، **التغذية** (`bm-nutrition`)، ومقاييس **الحالة النفسية والعاطفية** 1–5 (المزاج `mood`، الدافعية `motivation`، الثقة `confidence`) — لا تؤثر في النتيجة إطلاقاً.

المطلوب أن تساهم **كل** حقل فرعي في نقطة المحور الأب الخاص به، وأن يُعمَّم هذا السلوك على جميع الجوانب (الصحي، الاجتماعي، الاقتصادي) وليس على الصحة فقط، مع تحديث المؤشر **فورياً** أثناء التحرير دون انتظار الحفظ.

تكشف القراءة المؤكّدة للكود ثلاث فجوات متمايزة وراء العطل:

1. **فجوة الحساب** — الدالة `computeHealth(inputs, cfg)` في `js/student-risk.js` لا تستهلك `sleep`/`nutrition`/`mood`/`motivation`/`confidence` أبداً، و`catalogSize` للمحور E ثابتة على 8 ولا تحتسبها.
2. **فجوة تمرير المدخلات** — `collectRiskInputs()` في `js/pages/student-profile.js` (نحو السطر 1089) تبني كائن `health` بدون هذه الحقول الخمسة، رغم أن `collectHealthData()` (نحو السطر 814) تلتقطها فعلاً ثم تُسقَط قبل الوصول إلى المحرك. نفس النمط ينطبق على الاجتماعي والاقتصادي (حقول مثل `parents_edu`/`housing`/`study_place`/`teachers_rel`/`peers_rel` و`family_size`/`schooling_children`/`transport` تُسقَط).
3. **فجوة التحديث الحي** — مستمعو التبويبات (`change`/`input`/`click`) في `initDirtyTracking()` (نحو الأسطر 1199-1210) يكتفون بـ `_dirtyTabs.add(tabKey)` ولا يستدعون `bmUpdateRisk()`/`renderStudentRiskTab()`، فلا يتحدّث المؤشر إلا عند الحفظ أو عبر مسارات محدودة.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN تتغيّر إحدى الإشارات الصحية الفرعية فقط (النوم `sleep`، أو التغذية `nutrition`، أو المزاج `mood`، أو الدافعية `motivation`، أو الثقة `confidence`) مع تثبيت باقي المدخلات THEN the system ينتج نفس نقطة المحور E ونفس المؤشر المركّب تماماً دون أي تغيير

1.2 WHEN يحرّر المستخدم أي حقل فرعي صحي داخل تبويب الصحة (radio أو scale أو badge عدا الحالة العامة) THEN the system لا يعيد حساب المؤشر ولا يحدّث الـ gauge حتى يضغط المستخدم زر الحفظ

1.3 WHEN يحرّر المستخدم حقولاً فرعية في الجانب الاجتماعي (مثل `parents_edu`، `housing`، `study_place`، `teachers_rel`، `peers_rel`) أو الاقتصادي (مثل `family_size`، `schooling_children`، `transport`) THEN the system لا يستهلك بعض هذه الحقول في حساب المحور المعني ولا يحدّث المؤشر فورياً

1.4 WHEN يضغط المستخدم أزرار المقياس 1–5 لإشارة صحية (المزاج/الدافعية/الثقة) THEN the system يعيد الحساب لكن لا يظهر أي تغيير في النتيجة لأن المحرك لا يستهلك هذه القيم

### Expected Behavior (Correct)

2.1 WHEN تسوء أي إشارة صحية فرعية ملتقطة (نوم سيئ، تغذية سيئة، أو قيمة منخفضة في مقاييس المزاج/الدافعية/الثقة) مع تثبيت باقي المدخلات THEN the system SHALL ينتج نقطة محور E (والمؤشر المركّب) غير متناقصة، ويزيدها فعلياً عند التغيّرات ذات الدلالة، بحيث يعكس تفاقم الخطر

2.2 WHEN يحرّر المستخدم أي حقل فرعي صحي داخل تبويب الصحة THEN the system SHALL يعيد حساب المؤشر ويحدّث الـ gauge والتفصيل فورياً دون انتظار الحفظ

2.3 WHEN يحرّر المستخدم حقول الجوانب الاجتماعية والاقتصادية الفرعية THEN the system SHALL يستهلك كل حقل ملتقط ضمن نقطة محوره (C أو D) ويحدّث المؤشر فورياً، تعميماً لنفس السلوك على كل الجوانب

2.4 WHEN يضغط المستخدم أزرار المقياس 1–5 لإشارة صحية THEN the system SHALL يستهلك القيمة المختارة في حساب المحور E ويعكس أثرها في النتيجة فوراً

2.5 WHEN يُحسب المحور بعد إضافة الإشارات الفرعية الجديدة THEN the system SHALL يبقي النقطة المطبّعة ضمن المجال 0–100 (عبر ضبط `catalogSize`/عدّ العوامل) ويُبقي جميع العتبات والأوزان داخل CONFIG وقابلة للتجاوز، وفق المنهجية في `.kiro/مؤشر_الخطر_دليل_الحساب.md`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN تكون كل الإشارات الفرعية الجديدة غير محدّدة/فارغة (المدخلات المطابقة للسلوك القديم) THEN the system SHALL CONTINUE TO ينتج نفس نقاط المحاور ونفس المؤشر المركّب ونفس التصنيف النهائي كما قبل الإصلاح

3.2 WHEN تتغيّر الحالة العامة للصحة (`bm-health-gen` = `bad`) THEN the system SHALL CONTINUE TO رفع نقطة المحور E وتصنيف الطبقة الأولى كما هو الآن

3.3 WHEN تُحسب المحاور A (الدراسي) وB (الغياب والمواظبة) THEN the system SHALL CONTINUE TO إنتاج نفس النقاط والتصنيفات تماماً دون أي تأثّر بهذا الإصلاح

3.4 WHEN تُطبّق قاعدة «الأسوأ يفوز» (التصنيف النهائي = الأسوأ بين الطبقة 1 والطبقة 2) THEN the system SHALL CONTINUE TO احتساب التصنيف النهائي بنفس المنطق الحالي

3.5 WHEN يُحفظ تبويب أو يُحمّل ملف تلميذ (`bmAutoRiskFromTabs`، `sp-stats-updated`) THEN the system SHALL CONTINUE TO إعادة الحساب وتفعيل شارات الخطر التلقائية كما هي الآن

## Deriving the Bug Condition

**Bug Condition Function** — يحدّد المدخلات التي تُظهر العطل (تركيز على المحور E كحالة تمثيلية):

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type RiskInputs (with X.health sub-signals)
  OUTPUT: boolean

  // العطل قائم عندما يختلف تلميذان فقط في إشارة صحية فرعية ملتقطة
  // (نوم/تغذية/مزاج/دافعية/ثقة) لكن المحرك ينتج نفس النتيجة لأنه لا يستهلكها.
  RETURN capturedHealthSubSignalDiffers(X)        // sleep/nutrition/mood/motivation/confidence
         AND allOtherInputsHeldConstant(X)
END FUNCTION
```

**Property Specification (Fix Checking)** — السلوك الصحيح للمدخلات التي تحقق شرط العطل:

```pascal
// Property: Fix Checking — تساهم كل إشارة فرعية في نقطة المحور
FOR ALL X WHERE isBugCondition(X) DO
  worse  ← worsenOneHealthSubSignal(X)            // مثال: sleep: avg → bad
  ASSERT axisE(F'(worse)) >= axisE(F'(X))         // غير متناقصة
  AND   (meaningfulChange(X, worse) ⇒ axisE(F'(worse)) > axisE(F'(X)))
END FOR
```

**Preservation Goal** — للمدخلات التي لا تحقق شرط العطل (لا إشارات فرعية جديدة)، يجب أن يتطابق المحرك المُصلَح مع الأصلي:

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

حيث **F** هي الدالة الأصلية (قبل الإصلاح) و**F'** الدالة بعد الإصلاح.
