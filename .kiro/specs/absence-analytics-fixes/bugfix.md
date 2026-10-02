# Bugfix Requirements Document

## Introduction

تجمع هذه الوثيقة ثلاثة أعطال (bugs) مرتبطة بصفحات التقارير والملفات في التطبيق:

1. **لوحة "الأكثر غياباً (Top 5)"** في صفحة `absence-analytics.html` (تحليل الغياب) تظهر فارغة ولا تعرض أي تلميذ، رغم وجود تلاميذ لديهم ساعات غياب. السبب أن القائمة تُرشَّح بشرط تجاوز عتبة التحذير (نسبة ≥ 10٪ من الساعات الشهرية المتوقعة)، وهي عتبة نادراً ما يبلغها أي تلميذ، فتظهر حالة "لا يوجد طلاب فوق العتبة" بدل قائمة الأكثر غياباً.

2. **معاينة الطباعة** في `absence-analytics.html` معطوبة. الاستدعاء الحالي لـ `PrintSystem.preview` لا يمرّر `contentSelector`، فيتم استنساخ كامل `.main-content` (عناصر الفلترة والأزرار ومخططات `canvas` الحية) مما ينتج عنه معاينة مشوّهة أو ناقصة. نظام الطباعة في `student-profile-prototype.html` (عبر `js/pages/student-profile.js`) يعمل بشكل صحيح ويجب اعتماده كمرجع.

3. **لائحة التلاميذ** تظهر أسفل صفحة `student-profile-prototype.html` (ملف التلميذ) ويجب إزالتها، لأنها لا تنتمي إلى صفحة ملف تلميذ مفرد.

الأثر: المرشدون والإدارة لا يستطيعون رؤية التلاميذ الأكثر غياباً، ولا طباعة تقرير تحليل غياب نظيف، كما تظهر لائحة تلاميذ في غير محلها داخل صفحة الملف الفردي.

## Bug Analysis

### Current Behavior (Defect)

السلوك الحالي الخاطئ عند تشغيل كل عطل:

1.1 WHEN يفتح المستخدم صفحة `absence-analytics.html` ولا يوجد أي تلميذ تتجاوز نسبة ساعاته غير المبررة عتبة التحذير (`ratio >= WARNING_THRESHOLD` أي 10٪ من الساعات الشهرية المتوقعة) THEN تعرض لوحة "الأكثر غياباً (Top 5)" حالة فارغة ("لا يوجد طلاب فوق العتبة") حتى وإن كان هناك تلاميذ لديهم ساعات غياب فعلية.

1.2 WHEN يضغط المستخدم زر "معاينة الطباعة" في `absence-analytics.html` THEN يستدعي النظام `PrintSystem.preview` دون تحديد `contentSelector`، فيستنسخ كامل منطقة `.main-content` بما فيها عناصر الفلترة والأزرار ومخططات `canvas`، وتظهر معاينة مشوّهة/ناقصة لا تصلح للطباعة.

1.3 WHEN يفتح المستخدم صفحة `student-profile-prototype.html` THEN تظهر لائحة بالتلاميذ أسفل الصفحة لا تنتمي إلى ملف التلميذ المفرد المعروض.

### Expected Behavior (Correct)

السلوك الصحيح المنشود لنفس الشروط:

2.1 WHEN يفتح المستخدم صفحة `absence-analytics.html` ويوجد تلميذ واحد على الأقل لديه ساعات غياب غير مبررة THEN يجب على النظام أن يعرض في لوحة "الأكثر غياباً (Top 5)" أكثر التلاميذ غياباً مرتّبين تنازلياً حسب ساعات الغياب غير المبررة (حتى 5 تلاميذ)، بصرف النظر عن بلوغهم عتبة التحذير، مع عرض حالة فارغة فقط عندما لا يوجد أي تلميذ بساعات غياب.

2.2 WHEN يضغط المستخدم زر "معاينة الطباعة" في `absence-analytics.html` THEN يجب على النظام أن يعرض معاينة طباعة نظيفة لتقرير تحليل الغياب (ترويسة + مؤشرات + مخططات/جداول دون عناصر الفلترة والأزرار التفاعلية)، باتباع نفس آلية المعاينة المعتمدة في `student-profile` (بناء ورقة تصدير مخصصة وتمرير `contentSelector`).

2.3 WHEN يفتح المستخدم صفحة `student-profile-prototype.html` THEN يجب ألا تظهر أي لائحة تلاميذ أسفل الصفحة.

### Unchanged Behavior (Regression Prevention)

السلوك القائم الذي يجب الحفاظ عليه دون تغيير:

3.1 WHEN يوجد تلاميذ تتجاوز نسبتهم عتبة التحذير أو الخطر في `absence-analytics.html` THEN يجب على النظام أن يستمر في عرضهم ضمن لوحة "الأكثر غياباً" مع شارات المستوى الصحيحة (تحذير/خطر) وأشرطة التقدّم والنِّسب كما هي.

3.2 WHEN يستخدم المستخدم باقي عناصر صفحة `absence-analytics.html` (مؤشرات الأداء KPIs، المخططات، الجدول الرئيسي، الفلاتر، البحث، مقارنة الأقسام) THEN يجب على النظام أن يستمر في عملها كما هو دون تغيير.

3.3 WHEN يضغط المستخدم زر معاينة/طباعة الملف أو بطاقة التتبع في `student-profile-prototype.html` THEN يجب على النظام أن يستمر في إنتاج معاينة الطباعة الصحيحة كما تعمل حالياً (المرجع المعتمد).

3.4 WHEN يستخدم المستخدم باقي مكوّنات صفحة `student-profile-prototype.html` (التبويبات: النتائج، الغياب، الاقتصادي، الاجتماعي، الصحي، المتابعة، الخطر، وحفظ البيانات) THEN يجب على النظام أن يستمر في عملها كما هو دون تغيير بعد إزالة لائحة التلاميذ.

## Bug Condition Derivation

### العطل 1 — لوحة الأكثر غياباً الفارغة

**F (الدالة قبل الإصلاح):** بناء `topStudents` في `renderDashboard`/منطق الاشتقاق:
```
topStudents = studentArray.filter(s => s.ratio >= WARNING_THRESHOLD).slice(0, 5)
```

```pascal
FUNCTION isBugCondition_1(state)
  INPUT: state يحوي studentArray (تلاميذ لهم ساعات غياب غير مبررة)
  OUTPUT: boolean

  // العطل يظهر عندما يوجد تلاميذ بساعات غياب لكن لا أحد يبلغ عتبة التحذير
  RETURN (EXISTS s IN state.studentArray WHERE s.unjustified > 0)
         AND (FOR ALL s IN state.studentArray: s.ratio < WARNING_THRESHOLD)
END FUNCTION
```

```pascal
// Property: Fix Checking — عرض الأكثر غياباً
FOR ALL state WHERE isBugCondition_1(state) DO
  result ← buildTopStudents'(state)
  ASSERT result.length = MIN(5, count(s WHERE s.unjustified > 0))
         AND result مرتّب تنازلياً حسب unjustified
         AND NOT isEmptyState(panel)
END FOR
```

### العطل 2 — معاينة الطباعة المعطوبة

**F (قبل الإصلاح):** `PrintSystem.preview({ title, pageSize })` بدون `contentSelector`.

```pascal
FUNCTION isBugCondition_2(printCall)
  INPUT: printCall استدعاء معاينة الطباعة في absence-analytics
  OUTPUT: boolean

  // العطل يظهر عند غياب contentSelector/ورقة تصدير مخصصة
  RETURN printCall.contentSelector IS NULL
         AND NOT existsPreparedExportSheet()
END FUNCTION
```

```pascal
// Property: Fix Checking — معاينة طباعة نظيفة
FOR ALL printCall WHERE isBugCondition_2(printCall) DO
  result ← preview'(printCall)
  ASSERT result يحتوي ترويسة التقرير والمحتوى التحليلي
         AND NOT contains(result, عناصر الفلترة/الأزرار التفاعلية)
END FOR
```

### العطل 3 — لائحة التلاميذ أسفل صفحة الملف

```pascal
FUNCTION isBugCondition_3(page)
  INPUT: page صفحة student-profile-prototype المعروضة
  OUTPUT: boolean

  RETURN existsStudentListAtBottom(page)
END FUNCTION
```

```pascal
// Property: Fix Checking — إزالة اللائحة
FOR ALL page WHERE isBugCondition_3(page) DO
  result ← render'(page)
  ASSERT NOT existsStudentListAtBottom(result)
END FOR
```

### Preservation (لجميع الأعطال)

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT (isBugCondition_1(X) OR isBugCondition_2(X) OR isBugCondition_3(X)) DO
  ASSERT F(X) = F'(X)
END FOR
```

يضمن هذا أن جميع المدخلات/الحالات غير المعطوبة (تلاميذ فوق العتبة، باقي مكوّنات صفحة التحليل، نظام طباعة ملف التلميذ المرجعي، وباقي تبويبات الملف) تبقى سلوكياً مطابقة لما قبل الإصلاح.
