# مراجعة كود V2 — مرجع لبناء V3

> **الملف المراجَع:** `js/algorithms/proctor-distribution-v2.js` (4789 سطر)
> **تاريخ المراجعة:** 2026-05-19
> **حالة التحقق:** كل الادعاءات الفنية تحقّقت من الكود الفعلي — موثوق
> **الهدف:** توثيق العيوب البنيوية في V2 لتجنّبها في V3

---

## 1. المشكلة الجذرية: ازدواجية مفتاح المراقب

هذه هي السبب الحقيقي وراء دورة الإصلاحات الإحدى عشرة. يحتوي V2 على **دالتين مستقلتين** لحساب هوية المراقب:

```javascript
// المفتاح الداخلي للخوارزمية (السطر ~726)
function getProctorKey(proctor, index) {
  return proctor.cin ? proctor.cin : ('__idx_' + index);
  //                                   ^^^^^ شرطتان
}

// مفتاح الإعفاءات والمداومة (السطر ~743)
function getProctorExemptionKey(proctor, index) {
  return proctor.cin || proctor.som || ('idx_' + index);
  //                    ^^^^^^^^^^      ^^^^ شرطة واحدة
}
```

**التأثير:** نفس المراقب قد يحمل `__idx_5` في `loadState` و`idx_5` في `exemptionsData`، فيبدو للنظام وكأنه **شخصان مختلفان** — يُعيَّن مرتين أو لا تُطبَّق عليه الإعفاءات.

**الحل المؤقت في V2:** `buildKeyAdapter` + `toCanonicalKey` — ضمادة وليست حلاً بنيوياً.

**المطلوب في V3:** دالة وحيدة `canonicalProctorKey(proc, idx)` مع `.trim()` على `cin`:

```javascript
// V3 — الشكل الوحيد المقبول
function canonicalProctorKey(proc, idx) {
  return proc.cin && proc.cin.trim() ? proc.cin.trim() : '__idx_' + idx;
}
```

✅ **متعلّق بـ Requirement 2** (Single Canonical Proctor Key)

---

## 2. عيوب قابلة للإثبات في الكود

### 2.1 غياب `.trim()` عن `getProctorKey`

```javascript
// V2 — خطأ إذا كان cin يحمل مسافة
return proctor.cin ? proctor.cin : ('__idx_' + index);
```

إذا كان `cin = " 12345"` (مسافة في البداية)، يُنتج مفتاحاً مختلفاً عن `"12345"` وينتج ghost key في النتيجة.

**حدّة:** متوسطة. تظهر مع بيانات cin غير نظيفة.

✅ **متعلّق بـ Requirement 2.1**

---

### 2.2 `computeLoadStats` تحسب العدالة على `guardCount` فقط

```javascript
// السطر ~449 — خطأ: يتجاهل Duty_Count
const loads = keys.map(function (key) { return loadState[key].guardCount; });
```

**المطلوب:** `Primary_Load = guardCount + dutyCount`. إحصاءات min / max / std / gini المعروضة في التشخيصات **مضللة** لأي مراقب يحمل مداومة.

**حدّة:** عالية. يؤدّي إلى تشخيصات خاطئة.

✅ **متعلّق بـ Requirement 5.1, 9.3a**

---

### 2.3 `addReserveLoad` نصف-يوم-based بينما `addGuardLoad` أصبح slot-based

```javascript
// addGuardLoad — تمّ تحديثه: يزيد guardCount في كل استدعاء (slot-based ✓)
entry.guardCount++;

// addReserveLoad — لم يُحدَّث: يزيد فقط عند halfday جديدة (halfday-based ✗)
if (entry.reserveHalfdays.size > before) {
  entry.reserveCount++;
}
```

نفس المشكلة في `addDutyLoad`.

**التأثير:** `Reserve_Count` يَعدّ الـ halfdays لا السلوتات، مما يُشوّه `Final_Load` المستخدَم في ترتيب مرشحي الاحتياط (Req 7.5).

**حدّة:** عالية. يكسر فرز الاحتياطيين.

✅ **متعلّق بـ Requirement 7.5, 5.1**

---

### 2.4 Monotonicity Guard يستخدم `<` بدلاً من `<=`

```javascript
// السطر ~672 — التعليق يقول <=  لكن الكود يكتب <
if (bTotal < lbGlobal) {
  cappedLower = bTotal;
  cappedUpper = bTotal;
}
```

حين `bTotal === lbGlobal` بالضبط، تفلت الحالة الحدية من الحارس.

**ملاحظة:** الفرع `else` يُمسك معظم الحالات بشكل مقبول، لكن هناك **تناقض بين التعليق والكود**.

**حدّة:** منخفضة-متوسطة.

✅ **متعلّق بـ Requirement 5.5**

---

### 2.5 صيغتان مختلفتان للحدود تعملان في آنٍ واحد

```javascript
// Phase 1 — الصيغة القديمة (السطر ~235)
function computeBounds(totalTasks, fixedReservedTasks, numEligibleTeachers) {
  const lowerBound = Math.floor((totalTasks - fixedReservedTasks) / numEligibleTeachers);
  return { lowerBound, upperBound: lowerBound + 1 };
}

// computeClassBounds — الصيغة الجديدة (السطر ~541)
var lbGlobal = Math.floor((totalGuardSlots + expectedDuty) / eligibleCount);
```

الدالة `computeBounds` القديمة تعتمد على `fixedReservedTasks = singletons.size` من AC-3 — رقم غير ثابت يتغير مع البيانات.

**حدّة:** عالية. مصدر تشويش وأرقام متناقضة.

✅ **متعلّق بـ Requirement 5.2**

---

## 3. مشاكل بنيوية تُعيق بناء V3

### 3.1 التصدير عبر `window` يمنع التشغيل في Node.js

```javascript
// السطر 4712
window.ProctorDistributionV2 = { run: orchestrator, ... };
```

V3 (Req 1.2) يشترط: *"SHALL be runnable in pure Node without `window`, `document`, `electron`, or `better-sqlite3`"*.

**المطلوب:**
```javascript
// V3
module.exports = { run: orchestrator };
```

**حدّة:** حرجة لـ Node testing وللـ verify:v3 script.

✅ **متعلّق بـ Requirement 1.2, 16.6**

---

### 3.2 `getRoomsForEntry` مُعرَّفة في مكانين متطابقين

تعريف مُطابق موجود داخل:
- `buildCSPModel` (السطر ~1003)
- `phase2Build` (السطر ~1980)

أي تعديل في منطق استخراج القاعات يجب أن يُطبَّق يدوياً في مكانين — مصدر تباين مؤكَّد.

**حدّة:** منخفضة-متوسطة.

---

### 3.3 تعليقات "STUBS" مُضلِّلة

```javascript
// PHASE 1: CSP PRE-PASS — STUBS  ← السطر 710
// PHASE 2: HUNGARIAN BUILD — STUBS ← السطر 1423
```

كلتا المرحلتين مُنفَّذتان بالكامل. هذه بقايا من مرحلة التطوير الأولى.

**حدّة:** منخفضة (تنظيف فقط).

---

### 3.4 `_isRunning` كـ module-level mutable state

```javascript
let _isRunning = false; // السطر 41
```

يُخالف Req 12.3: *"phases SHALL NOT rely on hidden module-level mutable state"*.

**حدّة:** متوسطة.

✅ **متعلّق بـ Requirement 12.3**

---

### 3.5 `getScheduleEntryId` تتجاهل المعامل `entryIndex`

```javascript
function getScheduleEntryId(scheduleEntry, entryIndex) {
  // entryIndex مُعرَّف في التوقيع لكنه لا يُستخدَم
  return [level_name, subject_name, halfdayKey, session].join('|');
}
```

**حدّة:** منخفضة. لكن قد يُنتج تصادماً إذا تكررت نفس المادة في نفس الجلسة لمستويين بنفس الاسم.

---

### 3.6 منطق `orchestratorState` فيه فرع ميت

```javascript
// السطران 4688-4692
} else if (diagnostics.errors.length > 0) {
  diagnostics.orchestratorState = 'COMPLETED'; // ← نفس قيمة الفرع التالي
} else {
  diagnostics.orchestratorState = 'COMPLETED';
}
```

التعليق يقول "degraded" لكن القيمة لا تعكس ذلك.

**حدّة:** منخفضة-متوسطة. يُصعّب اكتشاف الفشل الجزئي.

✅ **متعلّق بـ Requirement 9.7** (errors non-empty IFF internal failure)

---

## 4. ميزات مطلوبة في V3 غائبة كلياً عن V2

| المطلب | ما يوجد في V2 | المطلوب في V3 |
|--------|--------------|--------------|
| **Req 3.12** | عداد `totalInfeasibleSlots` فقط | مصفوفة `unresolvedSlots` مفصّلة بـ `{ session_key, room_key, slot_index, reason }` |
| **Req 4** | لا يوجد | كشف infeasibility بسبب قيد same-day + ديالوج للمستخدم + feasibility pre-check |
| **Req 9.2** | `morningCount/afternoonCount` في loadState لكن لا تظهر في diagnostics | `amPmImbalanceByProctorKey` مُصدَّرة في diagnostics |
| **Req 11** | لا يوجد | إنشاء synthetic room rows عند نقص `examCenterRoomsData` |
| **Req 16.6** | لا يوجد | أمر `verify:v3` في `package.json` |
| **Req 9.2 (errors shape)** | `diagnostics.errors` مصفوفة نصوص | مصفوفة كائنات `{ type, message, ... }` |
| **Req 5.7** | لا فحص bimodal | `histogramByPrimaryLoad` strict bimodal `{k}` أو `{k, k+1}` |
| **Req 6.4-6.6 (S-AM-PM)** | counters فقط | penalty في cost function + diagnostics |

---

## 5. ما يُحتفظ به في V3 (قابل لإعادة الاستخدام)

هذه الأجزاء صحيحة وجيدة — تُنقل مع تنظيف التسمية وتوحيد المفتاح:

| المكوّن | الملاحظة |
|---------|---------|
| `hungarianSolver` | تنفيذ O(n³) potential-based صحيح ومختبَر — يُمكن استخدامه كـ baseline داخل CP solver |
| `buildSeededPRNG` (Mulberry32) | خفيف وحتمي ومناسب للـ PBT |
| `phase2_75CoverageRepair` | منطق الإصلاح متعدد الخطوات سليم — يحتاج تكييفاً مع المفتاح الموحَّد فقط |
| `computeEligibilityClasses` | المنطق صحيح — يُربط بـ `canonicalProctorKey` فقط |
| `computeAffinityRank` + `phase2_5PopulateReserves` | منطق الاحتياطيين والـ Reserve_Affinity سليم |
| `isMorningHalfday` + `computeHalfdayKey` | دوال مساعدة بسيطة وصحيحة |
| `isProctorExemptForEntry` | منطق الإعفاء صحيح (بعد ربطه بالمفتاح الموحَّد) |
| AC-3 propagation logic | الفكرة صحيحة، تحتاج فصل عن CSP-specific code |

---

## 6. خريطة الأولويات لبناء V3

### الأولوية 1 — قبل كتابة أي كود آخر
- ✦ دالة `canonicalProctorKey` وحيدة مع `.trim()` (Req 2.1)
- ✦ Key_Adapter عند حدود الإدخال فقط (لا يدخل داخل الخوارزمية) (Req 2.3)
- ✦ `module.exports` بدل `window` (Req 1.2)
- ✦ حذف `computeBounds` القديمة — الاعتماد على `computeClassBounds` فقط (Req 5.2)
- ✦ توحيد `getRoomsForEntry` في دالة واحدة في `utils/`

### الأولوية 2 — صحة العدالة
- ✦ إصلاح `addReserveLoad` لتكون slot-based (Req 7.5)
- ✦ إصلاح `addDutyLoad` لتكون slot-based إذا كان منطقياً
- ✦ إصلاح `computeLoadStats` لتستخدم `getPrimaryLoad` (Req 5.1)
- ✦ إصلاح monotonicity guard من `<` إلى `<=` (Req 5.5)

### الأولوية 3 — ميزات جديدة
- ✦ `unresolvedSlots` مفصّلة (Req 3.12)
- ✦ `amPmImbalanceByProctorKey` في diagnostics (Req 6.6)
- ✦ same-day infeasibility detection + ديالوج + feasibility pre-check (Req 4)
- ✦ synthetic room rows (Req 11)
- ✦ `histogramByPrimaryLoad` للفحص البَيمودالي (Req 5.7)

### الأولوية 4 — تنظيف
- ✦ إزالة `_isRunning` module-level (Req 12.3)
- ✦ إصلاح فرع `orchestratorState` (Req 9.7)
- ✦ إزالة `entryIndex` المعامل الميت من `getScheduleEntryId`
- ✦ حذف تعليقات "STUBS" المضلِّلة

---

## 7. مرجع سريع للتغييرات الحرجة بين V2 و V3

| الجانب | V2 | V3 |
|--------|----|----|
| هوية المراقب | دالتان: `getProctorKey` + `getProctorExemptionKey` | دالة وحيدة: `canonicalProctorKey` |
| تصدير الوحدة | `window.ProctorDistributionV2` | `module.exports` / ESM export |
| حساب العدالة | `guardCount` فقط | `guardCount + dutyCount` (Primary_Load) |
| `reserveCount` | halfday-based | slot-based |
| الحدود | صيغتان متوازيتان | صيغة وحيدة: `floor((G + D) / N)` |
| `unresolvedSlots` | عداد رقمي | مصفوفة كائنات مفصّلة |
| حالة الوحدة | `_isRunning` module-level | لا حالة مشتركة |
| تشخيص الـ infeasibility | لا يوجد | feasibility pre-check + ديالوج |
| histogram | واحد فقط | `histogramByGuardCount` + `histogramByPrimaryLoad` |
| AM/PM balance | counters فقط | penalty في cost + diagnostics |

---

## 8. ملاحظات منهجية مستفادة

1. **مصدر الحقيقة الواحد**: V2 لديه دالتان لنفس الشيء (`getProctorKey` و `getProctorExemptionKey`) — هذا أنشأ **dual-identity bug** الذي ضرب الإصدار. V3 يُلزم بدالة واحدة لكل مفهوم.

2. **التعليقات تخالف الكود**: في V2 وجدنا تعليق `(bTotal <= lbGlobal)` لكن الكود يكتب `<`. هذا يدلّ على أن الكود **خرج عن المواصفة الذهنية** للمطوّر بدون توثيق. V3 سيستخدم PBT لمنع هذا الانحراف.

3. **Module exports**: ربط الكود بـ `window` يجعل الاختبار في Node مستحيلاً. V3 يبدأ بـ Node-first ثم يُغلَّف للمتصفح.

4. **Mutation سرّاً**: `_isRunning` module-level يُخفي حالة عبر استدعاءات. V3 يُلزم بحالة محلية في كل استدعاء `run(input)`.

5. **عداد بدلاً من تفاصيل**: V2 لديه `totalInfeasibleSlots` (رقم) — V3 يستلزم مصفوفة مفصّلة كي يتمكن المستخدم من معرفة **أيّ** سلوت فشل ولماذا.
