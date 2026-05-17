# Bugfix Requirements Document

## Introduction

بعد تنفيذ الـ specs الثلاث السابقة (`proctor-v2-fairness-duty-reserves`،
`proctor-v2-strict-fairness-coverage`، `proctor-v2-slot-metric-reserves-affinity`)،
أَظهر تشغيل §0.2 verification على fixture المستخدم المرجعي
(147 أستاذاً، 368 سلوت، `D_expected = 15`) أن phase 2 من خوارزمية توزيع المراقبين
في v2 تُنهي عملها قبل ملء كل السلوتات، وتَكشف ثلاث مشاكل مترابطة:

- **`phase2DurationMs = 1635`** (تَجاوز `TIMEOUT_MS = 1500` المُجمَّد).
- **`phase2TimedOut = true`**، **`coverageRepairUnresolved = 51 / 147`**.
- **`total filled = 96 / 368`** → P3 FAIL، Coverage FAIL.

ثلاث جذور:

1. **Timeout قصير وغير قابل للتعديل**: `TIMEOUT_MS = 1500` مُجمَّد داخل
   `phase2Build` (سطر ~1635) ولا يَستجيب لـ option من المُستدعي.
2. **`greedyFallback` (سطر ~1555) قد يَقبل مرشحاً بتكلفة `INFINITY_SENTINEL`** في
   حالات حدية، فيَكسر `classUpperBound`.
3. **`phase2TimedOut` غير صريح**: orchestrator يَستقرئ الـ timeout من
   `phase2DurationMs >= 1500` (سطر ~3907) بدل قراءة حقل boolean صريح.

التأثير على fixture المستخدم: 26% فقط من السلوتات مملوءة، P3 FAIL، Coverage FAIL.
هذا الـ bugfix يُعالج الجذور الثلاثة دون مَسّ specs السابقة، ولا pre-fix snapshot،
ولا v1 byte-equality.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `phase2Build` يَعمل على fixture بحجم سيناريو المستخدم
(147 أستاذاً، 368 سلوت، `D_expected = 15`) THEN النظام يَستعمل
`TIMEOUT_MS = 1500` مُجمَّد (سطر ~1635 في `proctor-distribution-v2.js`)
ويَقطع التنفيذ قبل ملء كل السلوتات، فيُنتِج `total filled < expected_total_slots`.

1.2 WHEN `greedyFallback` (سطر ~1555) يَستقبل قائمة مرشحين كل تكاليفهم تُساوي
`INFINITY_SENTINEL` THEN النظام في حالات حدية يَختار واحداً منهم ويُسنِده إلى
الـ slot، مُنتِجاً مراقباً `getPrimaryLoad > classUpperBound` (كَسْر للقيد الصلب).

1.3 WHEN الـ orchestrator يَحتاج كَشف حدوث timeout في phase 2 THEN النظام يَستقرئ
ذلك عبر `phase2DurationMs >= 1500` (سطر ~3907) كاستدلال غير مباشر بقيمة
سحرية، بدل قراءة حقل boolean صريح من `diagnostics`.

### Expected Behavior (Correct)

2.1 WHEN `phase2Build` يَعمل بدون قيمة timeout مُمرَّرة من المُستدعي THEN النظام
SHALL يَستعمل قيمة افتراضية تُساوي 5000ms.

2.2 WHEN استدعاء التوزيع يَحوي `input.options.phase2TimeoutMs` كقيمة عددية موجبة
THEN النظام SHALL يَستعمل القيمة المُمرَّرة بدل الافتراضية.

2.3 WHEN `phase2Build` يَنتهي بأي مسار (إكمال طبيعي أو timeout) THEN النظام SHALL
يُسَنِد قيمة boolean صريحة إلى `phase2Result.diagnostics.phase2TimedOut`
(`true` لو تَوقَّف بسبب timeout، `false` لو أكمل في الوقت)، AND الحقل SHALL أن
لا يَكون `undefined` أبداً.

2.4 WHEN `greedyFallback` يَجد أن **كل** المرشحين تكلفتهم تُساوي
`INFINITY_SENTINEL` THEN النظام SHALL يَترك الـ slot شاغراً
(`proctor_keys[s] = null`) ويَزيد `shortages` بمقدار 1، AND النظام SHALL يَمتنع
عن إسناد أي مرشح يَكسر `classUpperBound`.

2.5 WHEN الـ orchestrator يَحتاج التحقق من حدوث timeout في phase 2 THEN النظام
SHALL يَقرأ `phase2Result.diagnostics.phase2TimedOut` مباشرةً، AND النظام SHALL
أن لا يَعتمد على مقارنة `phase2DurationMs` بأي قيمة محدَّدة.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN التوزيع يَعمل على input صغير (< 50 أستاذاً، بدون انطلاق timeout) THEN
النظام SHALL CONTINUE TO يُنتج توزيعاً مطابقاً byte-for-byte لنتيجة v1 على
نفس الـ input (v1 byte-equality محفوظ).

3.2 WHEN التوزيع يَعمل على input صغير (< 50 أستاذاً، بدون انطلاق timeout) THEN
النظام SHALL CONTINUE TO يُنتج نفس output الـ snapshot المسجَّل ما قبل هذا
الـ bugfix (pre-fix snapshot لا يُلامَس).

3.3 WHEN أي مراقب يُسنَد إلى slot عبر أي مسار (`phase1`، `phase2Build`،
`phase2_75CoverageRepair`، `greedyFallback`) THEN النظام SHALL CONTINUE TO
يَضمن `getPrimaryLoad(loadState, key) <= classUpperBound[key.class]` (الـ hard
cap في `costFunction` يَبقى inviolate).

3.4 WHEN التوزيع يَعمل THEN النظام SHALL CONTINUE TO يَحترم كل قيود الـ specs
السابقة الثلاث:
- `proctor-v2-fairness-duty-reserves` (C1-C4): per-class reserves وضوابط الإنصاف.
- `proctor-v2-strict-fairness-coverage`: per-class fairness و coverage repair.
- `proctor-v2-slot-metric-reserves-affinity`: slot metric و reserve affinity.

3.5 WHEN `greedyFallback` يَجد مرشحاً واحداً على الأقل بتكلفة محدودة
(< `INFINITY_SENTINEL`) THEN النظام SHALL CONTINUE TO يَختار الأقل تكلفة كما
في السلوك الحالي (التغيير محصور في حالة "كل المرشحين بتكلفة لانهائية" فقط).

## Bug Conditions

تَستعمل هذه الـ spec المنهجية الرسمية لـ bug condition (`C(X)`) لتَوصيف كل مشكلة
فرعية بدقة قابلة للتحقُّق.

### C1 — Phase 2 Premature Termination + Incomplete Coverage

```pascal
FUNCTION isBugCondition_C1(X)
  INPUT: X of type ProctorDistributionInput
  OUTPUT: boolean

  LET result ← F(X)            // F = الكود قبل الإصلاح
  RETURN result.diagnostics.phase2DurationMs >= TIMEOUT_MS_DEFAULT_OLD
       AND filledSlotsCount(result) < expectedTotalSlots(X)
END FUNCTION
```

تُمثِّل: input يَستهلك أكثر من `TIMEOUT_MS_DEFAULT_OLD = 1500` ms في phase 2
ويُنتِج توزيعاً ناقصاً. counterexample مرجعي: fixture المستخدم
(147 أستاذاً / 368 سلوت / D=15) → `phase2DurationMs = 1635`،
`filled = 96`، `expected = 368`.

### C2 — greedyFallback Admits Over-Cap Candidate

```pascal
FUNCTION isBugCondition_C2(X)
  INPUT: X of type ProctorDistributionInput
  OUTPUT: boolean

  LET result ← F(X)
  RETURN EXISTS row R, slot s :
    R.proctor_keys[s] != null
    AND getPrimaryLoad(result.loadState, R.proctor_keys[s])
        > classUpperBound[R.proctor_keys[s].class]
END FUNCTION
```

تُمثِّل: حالة يُنتج فيها `greedyFallback` مراقباً يَتجاوز `classUpperBound` في
الـ output النهائي بسبب قبول مرشح بتكلفة `INFINITY_SENTINEL`.

## Properties

### P1 — Timeout Sufficiency على Fixture المرجعي

```pascal
LET X_ref ← reference_fixture()  // 147 proctors, 368 slots, D=15
LET result ← F'(X_ref)
ASSERT result.diagnostics.phase2DurationMs < result.diagnostics.phase2TimeoutMs
ASSERT filledSlotsCount(result) = 368
```

### P2 — Hard Cap Inviolate (Fix Checking لـ C2)

```pascal
FOR ALL X DO
  LET result ← F'(X)
  FOR ALL row R, slot s WHERE R.proctor_keys[s] != null DO
    ASSERT getPrimaryLoad(result.loadState, R.proctor_keys[s])
        <= classUpperBound[R.proctor_keys[s].class]
  END FOR
END FOR
```

### P3 — Diagnostic Field Always Boolean

```pascal
FOR ALL X DO
  LET result ← F'(X)
  ASSERT typeof result.diagnostics.phase2TimedOut = 'boolean'
END FOR
```

### P4 — Preservation على Fixtures الصغيرة (Preservation Checking)

```pascal
// لكل input صغير (< 50 proctors) لا يَضرب الـ timeout الجديد
FOR ALL X WHERE proctorCount(X) < 50
              AND F'(X).diagnostics.phase2TimedOut = false DO
  ASSERT outputEquals(F(X), F'(X))   // byte-equality
END FOR
```

### Definitions

- **F**: الكود قبل تطبيق هذا الإصلاح (الحالة الحالية في
  `js/algorithms/proctor-distribution-v2.js`).
- **F'**: الكود بعد تطبيق هذا الإصلاح.
- **`TIMEOUT_MS_DEFAULT_OLD`**: 1500 (القيمة المُجمَّدة قبل الإصلاح).
- **`expectedTotalSlots(X)`**: مجموع `slot_count` عبر كل rows في `X`.
- **`filledSlotsCount(result)`**: عدد slots حيث `proctor_keys[s] !== null`.
- **`outputEquals`**: مساواة deep-structural شاملة لكل
  `rows`، `loadState`، `diagnostics` (مع استثناء الحقول الجديدة
  `phase2TimeoutMs` و `phase2TimedOut`).
