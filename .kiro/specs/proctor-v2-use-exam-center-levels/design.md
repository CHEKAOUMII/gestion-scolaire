# Bugfix Design — proctor-v2-use-exam-center-levels

## Overview

هذا التصميم يوثّق إصلاحاً موضعياً في طبقة بناء مُدخَل خوارزمية توزيع المراقبين v2 داخل `exams-proctors.html`. الهدف هو جعل `buildV2Input` والدالة المساعدة `getRoomRowsForLevel` تعتمدان على `examCenterLevels` كمصدر مرجعي لعدد القاعات المتوقَّع لكل مستوى، مع تكميل الصفوف الناقصة من `examCenterRoomsData` بصفوف قاعات افتراضية (synthetic room rows) داخل الذاكرة فقط. الإصلاح يمنع إسقاط المستويات بصمت من Phase_2_Build عندما لا تكون صفوف `examCenterRoomsData` محفوظة بشكل كامل، ولا يمسّ منطق `js/algorithms/proctor-distribution-v2.js` ولا صيغة الحفظ في `examCenterRoomsData`.

استراتيجية الإصلاح قائمة على فصل واضح بين مصدرَيْن: `examCenterLevels` يُحدّد "كم قاعة/مادّة يفترض أن توجد" لكل مستوى في السنة الدراسية النشطة، و`examCenterRoomsData` يُحدّد "ما هي الصفوف الفعلية المحفوظة" (أسماء القاعات وأرقامها). عندما يحدث نقص، نُكمِّل الفرق بصفوف افتراضية ونُخطِر المستخدم بتحذير مجمَّع واحد عبر Diagnostics Panel وtoast. التغييرات في الواجهة وفي الحساب محصورة في طبقة بناء المُدخَل، ولا يتأثر أي مسار عرض أو حفظ آخر.

## Glossary

- **Bug_Condition (C)**: حالة أن مستوى `L` يوجد في `scheduleEntries` وفي `examCenterLevels` بقيمة `level.rooms = N > 0`، ويوجد في `examCenterRoomsData` بعدد صفوف `M < N` (بما فيها الحالة الخاصة `M = 0`).
- **Property (P)**: أن يحتوي `roomsList[L]` الممرَّر إلى الخوارزمية على `N` عنصراً من صفوف القاعات (مزيج من الصفوف الفعلية والصفوف الافتراضية) حتى تدخل كل مهام المستوى إلى Phase_2_Build.
- **Preservation**: أن يبقى السلوك الحالي لـ v1، ولمنطق v2 داخل `proctor-distribution-v2.js`، ولصيغة الحفظ في `examCenterRoomsData`، ولدوال العرض (`getSummaryCandidateCountForLevel` وشبيهاتها) دون أي تغيير.
- **Synthetic Room Row**: كائن قاعة يُولَّد في الذاكرة داخل `buildV2Input` (لا يُحفظ في قاعدة البيانات عبر `window.api.examConfig.save`، ولا يُكتَب في أي تخزين دائم) يحمل نفس شكل الكائنات التي تُرجعها `getRoomRowsForLevel` حالياً، مع علامة داخلية `_synthetic: true`.
- **Active Year**: السنة الدراسية النشطة المستخرَجة من `activeSchoolYear` (عبر `getSchoolYear()` في الصفحة)، وهي المفتاح المستعمل مع `window.api.examConfig.get(year, 'examCenterLevels')`.
- **`buildV2Input`**: الدالة في `exams-proctors.html` (السطر 2577) التي تبني الكائن الممرَّر إلى `ProctorDistributionV2.run`.
- **`getRoomRowsForLevel`**: الدالة المساعدة في `exams-proctors.html` (السطر 3155) التي تقرأ `examCenterRoomsData` وتُرجع صفوف قاعات مستوى معيَّن.
- **`getExamCenterLevelsForActiveYear`**: دالة مساعدة جديدة (ستُضاف في هذا الإصلاح) تُرجع خريطة `{ [levelName]: { rooms, subjects } }` للسنة النشطة.

## Bug Details

### Bug Condition

الخلل يظهر حين يكون مستوى مبرمَجاً في `scheduleEntries` وموجوداً في `examCenterLevels` بعدد قاعات مُعرَّف، لكن عدد صفوفه المحفوظة في `examCenterRoomsData` أقل من المتوقَّع. في هذه الحالة، `getRoomRowsForLevel` تُرجع ما هو موجود فقط (قد يكون صفراً)، فيدخل `roomsList[L]` إلى المُدخَل بقيمة ناقصة، ويُسقِط Phase_2_Build مهام هذا المستوى كلياً أو جزئياً.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input = { levelName, scheduleEntries, examCenterLevels, examCenterRoomsData }
  OUTPUT: boolean

  LET level       := examCenterLevels[input.levelName]
  LET expected    := (level AND level.rooms > 0) ? level.rooms : 0
  LET actualRows  := countRoomRowsInRoomsData(input.examCenterRoomsData, input.levelName)
  LET scheduled   := ANY entry IN input.scheduleEntries WHERE entry.level_name == input.levelName

  RETURN scheduled
         AND expected > 0
         AND actualRows < expected
END FUNCTION
```

### Examples

- **مثال 1 (نقص كلي M=0)**: "الأولى باكالوريا العلوم الرياضية - رسميون" موجود في `scheduleEntries` وفي `examCenterLevels` بـ `rooms=2`، لا يوجد له أي صف في `examCenterRoomsData`. المتوقَّع: `roomsList[L]` يحتوي صفّين افتراضيّيْن. الحالي: `roomsList[L] = []` فيُسقَط المستوى من Phase_2_Build.
- **مثال 2 (نقص جزئي M<N)**: مستوى `rooms=3` في `examCenterLevels`، ويوجد صفّان فقط في `examCenterRoomsData`. المتوقَّع: `roomsList[L].length = 3` (صفّان فعليّان + صف افتراضي واحد). الحالي: `roomsList[L].length = 2` فيُعيَّن مراقب ناقص.
- **مثال 3 (سلوك غير متأثر)**: مستوى `rooms=2` في `examCenterLevels` وله صفّان محفوظان في `examCenterRoomsData`. المتوقَّع والحالي: `roomsList[L].length = 2` بدون أي صف افتراضي.
- **مثال 4 (حالة حافّة — `level.rooms = 0`)**: مستوى `rooms=0` أو غير معرَّف. المتوقَّع: fallback إلى السلوك الحالي، لا صفوف افتراضية.
- **مثال 5 (حالة حافّة — `examCenterLevels` فارغ)**: السنة الدراسية لا تحوي إعدادات `examCenterLevels` أصلاً. المتوقَّع: fallback كامل إلى السلوك الحالي مع تحذير واحد في console.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- منطق `js/algorithms/proctor-distribution-v2.js` (Phase_1_PrePass، Phase_2_Build، Phase_3_Optimize) يبقى كما هو بدون أي تغيير.
- الخوارزمية v1 تبقى على مسارها الأصلي بدون مرور عبر قراءة `examCenterLevels` ولا عبر توليد صفوف افتراضية.
- صيغة الحفظ في `examCenterRoomsData` عبر `exams-rooms.html` (المُمرَّرة إلى `window.api.examConfig.save` ومن ثم إلى `better-sqlite3`) تبقى كما هي؛ الصفوف الافتراضية مولَّدة في الذاكرة ولا تُكتَب في قاعدة البيانات ولا تمرّ عبر أي استدعاء حفظ.
- كل مستوى له صفوف مكتملة في `examCenterRoomsData` (أي `M == N`) يبقى له نفس `roomsList[L]` الحالي، بنفس الترتيب ونفس المحتوى، بدون أي صف افتراضي.
- دوال العرض (`getSummaryCandidateCountForLevel` وشبيهاتها) تبقى مبنية على `examCenterRoomsData` فقط ولا تحتسب الصفوف الافتراضية.
- فلاتر `getPlanningReadiness` و`buildGuardQuota` و`buildPerTeacherQuota` وغيرها من المستهلكين لـ `getRoomRowsForLevel` تُكيَّف بحيث تستعمل الصفوف المكمَّلة حيث يلزم (بناء المُدخَل) وتحافظ على عدّ الصفوف الفعلية حيث يلزم (واجهات العرض).

**Scope:**

كل المدخلات التي لا تستوفي bug condition يجب أن تبقى غير متأثرة بهذا الإصلاح. هذا يشمل:

- المستويات التي لها صفوف مكتملة في `examCenterRoomsData` (`M == N`).
- المستويات غير المبرمَجة في `scheduleEntries`.
- المستويات التي `level.rooms` لها 0 أو غير معرَّف.
- الحالات التي `examCenterLevels` فيها غير متاح للسنة النشطة.
- مسار v1 بالكامل (`Algorithm_Toggle = v1`).

## Hypothesized Root Cause

بناءً على تحليل الكود ومذكرة الجلسة السابقة، السبب الجذري المُرجَّح هو:

1. **اعتماد مصدر وحيد لبناء `roomsList`**: `buildV2Input` يستدعي `getRoomRowsForLevel` الذي يقرأ حصراً من `examCenterRoomsData`. لا يوجد تقاطع مع `examCenterLevels` لتعويض النقص.
2. **سلوك "الإسقاط الصامت"**: عند غياب صفوف للمستوى، `getRoomRowsForLevel` تُرجع `[]` بدل رفع تحذير في الواجهة. النتيجة: المستوى يختفي من Phase_2_Build بدون ما يلاحظه المستخدم (فقط `console.log` يُظهر `0 rooms`).
3. **عدم استعمال `level.rooms` المرجعي**: `examCenterLevels[L].rooms` متوفّر في نفس السنة الدراسية لكنه لا يُقرأ حالياً في مسار بناء المُدخَل.
4. **فجوة بين صفحتين**: `exams-schedule.html` تُخزّن `level.rooms` و`level.subjects` في `examCenterLevels`، بينما `exams-rooms.html` تُخزّن الصفوف الفعلية في `examCenterRoomsData`. إن لم يكمّل المستخدم الحفظ في الصفحة الثانية، يظهر النقص.

السبب الأكثر احتمالاً هو (1) و(3) معاً: الإصلاح يعالجهما بإضافة قراءة `examCenterLevels` ومنطق تكميل في طبقة واحدة.

## Correctness Properties

Property 1: Bug Condition - تكميل صفوف القاعات الناقصة من `examCenterLevels`

_For any_ input where the bug condition holds (isBugCondition returns true)، أي مستوى `L` مبرمَج في `scheduleEntries` وموجود في `examCenterLevels` بقيمة `level.rooms = N > 0`، ويوجد في `examCenterRoomsData` بعدد صفوف `M < N`، the fixed `buildV2Input` SHALL يُنتج `roomsList[L]` بطول يساوي `N` بالضبط، مكوَّناً من `M` صفّاً فعلياً (كما تُرجعها `getRoomRowsForLevel` الحالية) و`N - M` صفّاً افتراضياً مرقَّماً تسلسلياً بدءاً من `max(existingRoomNums) + 1`، ويُسجّل اسم المستوى وعدد الصفوف المُكمَّلة في `syntheticRoomWarnings[]` لعرضها لاحقاً.

**Validates: Requirements 2.1, 2.2, 2.3, 2.6, 2.7**

Property 2: Preservation - المستويات المكتملة ومصادر البيانات الأخرى

_For any_ input where the bug condition does NOT hold (isBugCondition returns false)، أي عندما يكون `M >= N`، أو `level.rooms = 0`، أو المستوى غير مبرمَج، أو `examCenterLevels` غير متاح، أو الخوارزمية v1 قيد التشغيل، the fixed code SHALL يُنتج نفس النتيجة التي تُنتجها الشيفرة الأصلية بالضبط: نفس `roomsList[L]` (محتوى وترتيب)، نفس صيغة الحفظ في `examCenterRoomsData`، ونفس مخرجات دوال العرض (`getSummaryCandidateCountForLevel` وغيرها).

**Validates: Requirements 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

افتراض أن تحليل السبب الجذري صحيح، تنحصر التعديلات في `exams-proctors.html` فقط.

**File**: `exams-proctors.html`

**Functions**: `buildV2Input`، `getRoomRowsForLevel`، إضافة دوال مساعِدة جديدة.

### Data Sources

| المصدر | المفتاح | ما يُستخرَج | الدور في الإصلاح |
|---|---|---|---|
| `examCenterLevels` (للسنة النشطة) | `window.api.examConfig.get(year, 'examCenterLevels')` | مصفوفة `[{ name, rooms, subjects, ... }]` | مصدر مرجعي لعدد القاعات المتوقَّع `N` لكل مستوى. |
| `examCenterRoomsData` (للسنة النشطة) | `window.api.examConfig.get(year, 'examCenterRoomsData')` | كائن مفاتيح `"<levelName>__<roomNum>"` مع قيم القاعة | مصدر الصفوف الفعلية `M`، يُستعمل كما هو اليوم. |
| `scheduleEntries` | `getScheduleEntries()` | قائمة الامتحانات المبرمَجة | لتحديد المستويات التي تستحق إدخالها في `roomsList`. |

**دالة مساعدة جديدة:**

```js
async function getExamCenterLevelsForActiveYear() {
  const arr = (await window.api.examConfig.get(year, 'examCenterLevels')) || [];
  const map = Object.create(null);
  for (const level of arr) {
    if (!level || !level.name) continue;
    map[level.name] = {
      rooms: Number(level.rooms) || 0,
      subjects: Array.isArray(level.subjects) ? level.subjects : []
    };
  }
  return map;
}
```

### Synthetic Room Row Schema

الصف الافتراضي يتبع نفس شكل الكائن الذي تُرجعه `getRoomRowsForLevel` الحالية (انظر السطر 3155 في `exams-proctors.html`). الحقول:

| الحقل | النوع | القيمة للصف الافتراضي |
|---|---|---|
| `key` | string | `"<levelName>__<roomNum>__synthetic"` (لتفادي أي تصادم مع مفاتيح `examCenterRoomsData`). |
| `level_name` | string | `levelName` (نفس اسم المستوى). |
| `room_num` | string | `String(roomNum)` حيث `roomNum` يبدأ من `max(existingRoomNums) + 1`. |
| `roomName` | string | `"قاعة افتراضية " + roomNum` (قابل للتخصيص، لا يُعرَض للمستخدم، يُستعمل داخلياً فقط). |
| `count` | number | `0` أو القيمة الافتراضية المستعملة للصفوف الفعلية؛ Phase_2_Build لا يعتمد عليها لإنتاج مهام الحراسة. |
| `firstNum` | `null` | لا يُستعمل في الصفوف الافتراضية. |
| `lastNum` | `null` | لا يُستعمل في الصفوف الافتراضية. |
| `_synthetic` | boolean | `true` — علامة داخلية لتمييز الصف الافتراضي. |

**ملاحظة:** الشكل الأدنى الذي يضمن أن Phase_2_Build يتعامل مع الصف كصف "صالح" هو وجود `level_name` و`room_num` واسم عرض. باقي الحقول (`count`, `firstNum`, `lastNum`) تُضاف لتماثل شكل الصفوف الفعلية وتفادي أي أثر جانبي في فلاتر لاحقة.

### Control Flow

**Pseudocode لـ `buildV2Input` المحدَّث:**

```
FUNCTION buildV2Input()
  options          := getAutoDistributionOptions()
  rules            := await getDistributionRules()
  scheduleEntries  := filter((await getScheduleEntries()), hasValidEntry)

  examCenterLevelsMap := await getExamCenterLevelsForActiveYear()
  allRoomsData        := (await window.api.examConfig.get(year, 'examCenterRoomsData')) OR {}

  roomsList               := {}
  syntheticRoomWarnings   := []
  levelsSeen              := {}

  IF examCenterLevelsMap IS empty THEN
    log warning: 'examCenterLevels not available for active year — falling back to roomsData only'
  END IF

  FOR EACH entry IN scheduleEntries DO
    lvl := entry.level_name OR ''
    IF lvl IS empty OR levelsSeen[lvl] THEN CONTINUE
    levelsSeen[lvl] := true

    actualRows := await getRoomRowsForLevel(lvl)          // unchanged — reads examCenterRoomsData
    expected   := (examCenterLevelsMap[lvl] AND examCenterLevelsMap[lvl].rooms > 0)
                    ? examCenterLevelsMap[lvl].rooms
                    : 0

    IF expected > actualRows.length AND expected > 0 THEN
      missing      := expected - actualRows.length
      maxNum       := computeMaxRoomNum(actualRows)       // scans room_num fields
      syntheticArr := []
      FOR i := 1 TO missing DO
        syntheticArr.push(buildSyntheticRoomRow(lvl, maxNum + i))
      END FOR
      roomsList[lvl] := actualRows CONCAT syntheticArr
      syntheticRoomWarnings.push({ levelName: lvl, added: missing, expected: expected, actual: actualRows.length })
    ELSE
      roomsList[lvl] := actualRows
    END IF
  END FOR

  IF syntheticRoomWarnings.length > 0 THEN
    renderSyntheticRoomWarnings(syntheticRoomWarnings)   // Diagnostics Panel + toast
  END IF

  RETURN {
    proctorsList, scheduleEntries, exemptionsData, dutyData, meAssignments,
    examDistributionRules: rules,
    options: { roomsList, ...otherOptions },
    randomSeed, weightsPreset, customWeights, enablePhase3: true
  }
END FUNCTION
```

**دوال مساعدة جديدة:**

```
FUNCTION computeMaxRoomNum(rows)
  max := 0
  FOR EACH r IN rows DO
    n := parseInt(r.room_num, 10)
    IF n > max THEN max := n
  END FOR
  RETURN max
END FUNCTION

FUNCTION buildSyntheticRoomRow(levelName, roomNum)
  RETURN {
    key:         levelName + '__' + roomNum + '__synthetic',
    level_name:  levelName,
    room_num:    String(roomNum),
    roomName:    'قاعة افتراضية ' + roomNum,
    count:       0,
    firstNum:    null,
    lastNum:     null,
    _synthetic:  true
  }
END FUNCTION
```

`getRoomRowsForLevel` تبقى كما هي — تقرأ فقط `examCenterRoomsData`. منطق التكميل يُضاف في `buildV2Input` حصراً، بحيث تبقى الدالة المساعدة صافية الغرض وتُستعمل من مواضع أخرى (مثل `getPlanningReadiness` و`buildGuardQuota`) بدون آثار جانبية.

**ملاحظة حول المستهلكين الآخرين لـ `getRoomRowsForLevel`**: الدوال `buildGuardQuota`, `buildPerTeacherQuota`, `getPlanningReadiness` (السطور 3741, 3772, 1439) تستدعي `getRoomRowsForLevel` لحساب `totalGuardTasks`. لكي يتطابق مجموع الحاجيات مع `roomsList` الممرَّر إلى الخوارزمية، هذه الدوال يجب أن تستعمل نفس منطق التكميل. الحل: استخراج منطق التكميل في دالة مساعدة `getEffectiveRoomRowsForLevel(levelName, examCenterLevelsMap)` تُرجع الصفوف الفعلية مكمَّلة بالافتراضية، ويُستدعى من `buildV2Input` ومن الدوال الثلاث المذكورة. دوال العرض (`getSummaryCandidateCountForLevel`) تبقى على `getRoomRowsForLevel` الأصلية.

### Warning UX

**الهدف**: إخطار المستخدم بشكل واضح ومجمَّع أن بيانات `examCenterRoomsData` ناقصة، دون إغراقه بتحذيرات متعدّدة.

**Diagnostics Panel**: يُضاف قسم جديد بعنوان "قاعات افتراضية مُكمَّلة" داخل لوحة التشخيص التي تظهر بعد تشغيل التوزيع. القسم يعرض جدولاً بأعمدة: اسم المستوى، العدد المتوقَّع (من `examCenterLevels`)، العدد الفعلي (من `examCenterRoomsData`)، عدد الصفوف المُكمَّلة. مع ملاحظة تفسيرية: "الصفوف الافتراضية مُستعمَلة فقط لتوزيع المراقبين ولا تُحفظ. أكمِل الصفوف من صفحة 'تهيئ قاعات الامتحان' لإزالتها."

**Toast**: يُعرَض toast واحد مجمَّع من نوع `warning` عند نهاية `buildV2Input` إذا `syntheticRoomWarnings.length > 0`. النص: `"تم تكميل N قاعة افتراضية في M مستوى. راجع لوحة التشخيص."`.

**رابط سريع**: داخل القسم الجديد في لوحة التشخيص، زر "الذهاب إلى صفحة القاعات" يفتح `exams-rooms.html` لتسهيل إكمال البيانات.

**ملاحظة:** التحذير في `console` يبقى للمطوّرين (`[V2 WARN] synthetic rooms added for level "..."`)، لكنه ليس بديلاً عن التحذير المرئي.

## Regression Prevention

ما يبقى دون تغيير:

- **منطق v2 الداخلي**: `js/algorithms/proctor-distribution-v2.js` لا يُمَسّ. Phase_1_PrePass و Phase_2_Build و Phase_3_Optimize تستقبل نفس شكل المُدخَل.
- **منطق v1**: مسار `runAutoDistribution` (v1) لا يمرّ عبر `buildV2Input` ولا يستعمل منطق التكميل.
- **صيغة الحفظ في `examCenterRoomsData`**: `exams-rooms.html` تكتب نفس البنية؛ الصفوف الافتراضية في الذاكرة فقط، ولا تُمرَّر إلى أي استدعاء حفظ.
- **دوال العرض**: `getSummaryCandidateCountForLevel` (السطر 5882) وأي دالة أخرى تقرأ `examCenterRoomsData` لأغراض العرض تبقى على `getRoomRowsForLevel` الأصلية بدون احتساب صفوف افتراضية.
- **`getRoomRowsForLevel` نفسها**: منطقها الداخلي (قراءة `examCenterRoomsData` + fuzzy fallback) يبقى كما هو؛ الإضافة فقط في طبقة أعلى.
- **المستويات المكتملة**: أي مستوى يستوفي `M >= N` يعبر `buildV2Input` بنفس النتيجة الحالية بدون أي صف افتراضي.
- **حالات fallback**: `level.rooms = 0` أو غير معرَّف، أو `examCenterLevels` فارغ — كلها تؤول إلى السلوك الحالي (`roomsList[L] = actualRows`).

## Testing Strategy

### Validation Approach

استراتيجية الاختبار من شقّين: أولاً إنشاء اختبارات استكشافية تُظهر الخلل على الكود غير المُصلَح (counterexamples)، ثم التحقق من أن الإصلاح يُكمِّل `roomsList` بالطول المتوقَّع ويحافظ على سلوك الحالات غير المتأثرة.

### Exploratory Bug Condition Checking

**Goal**: إظهار الخلل على الكود غير المُصلَح وتأكيد/نفي فرضية السبب الجذري. إن نُفيت الفرضية، تُعاد صياغة التحليل.

**Test Plan**: اختبارات تبني حالات `examCenterLevels` و`examCenterRoomsData` و`scheduleEntries` يدوياً في الذاكرة (أو عبر mocks)، تستدعي `buildV2Input`، وتتحقق من طول `roomsList[L]`. تُنفَّذ أولاً على الكود غير المُصلَح لملاحظة الإسقاط.

**Test Cases**:

1. **Level Missing All Rows**: `examCenterLevels[L].rooms = 2` ولا صفوف في `examCenterRoomsData` → المتوقَّع `roomsList[L].length == 2` (will fail on unfixed code → يُرجع 0).
2. **Level Partial Rows**: `examCenterLevels[L].rooms = 3`، صفّان محفوظان → المتوقَّع `roomsList[L].length == 3` (will fail on unfixed code → يُرجع 2).
3. **Synthetic Row Numbering**: صفّ محفوظ واحد بـ `room_num = "5"`، المتوقَّع قاعة افتراضية بـ `room_num = "6"` (will fail on unfixed code → لا يوجد صف افتراضي).
4. **Phase_2_Build Coverage (integration)**: عند تمرير مُدخَل يحوي مستوى ناقصاً إلى `ProctorDistributionV2.run`، المتوقَّع أن يُنتج المستوى مهام حراسة (will fail on unfixed code → المستوى يختفي من النتائج).

**Expected Counterexamples**:

- `roomsList[levelName].length` أقل من `examCenterLevels[levelName].rooms` في الكود غير المُصلَح.
- Possible causes: اعتماد `getRoomRowsForLevel` على مصدر واحد؛ غياب قراءة `examCenterLevels` من `buildV2Input`؛ عدم وجود منطق تكميل.

### Fix Checking

**Goal**: التحقق أن `buildV2Input` المُصلَح يُنتج `roomsList[L]` بطول صحيح لكل مدخل يستوفي bug condition.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  result := buildV2Input_fixed(input)
  ASSERT result.options.roomsList[input.levelName].length == input.examCenterLevels[input.levelName].rooms
  ASSERT countSynthetic(result.options.roomsList[input.levelName])
         == input.examCenterLevels[input.levelName].rooms - countActual(input.examCenterRoomsData, input.levelName)
  ASSERT maxRoomNumInSynthetic > maxRoomNumInActual
  ASSERT result.syntheticRoomWarnings contains { levelName: input.levelName, ... }
END FOR
```

### Preservation Checking

**Goal**: التحقق أن `buildV2Input` المُصلَح يُنتج نفس النتيجة تماماً للمدخلات التي لا تستوفي bug condition.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT deepEquals(
    buildV2Input_original(input).options.roomsList,
    buildV2Input_fixed(input).options.roomsList
  )
  ASSERT buildV2Input_fixed(input).syntheticRoomWarnings IS empty
END FOR
```

**Testing Approach**: property-based testing مناسب هنا لأن المدخلات تتكوّن من ثلاثة عوامل (`examCenterLevels`, `examCenterRoomsData`, `scheduleEntries`) بتوافيق كثيرة، وقد تُسقط اختبارات الوحدة اليدوية حالات حدّية (مثل `rooms=0`، أسماء مستويات بها فراغات مزدوجة، مستويات في `scheduleEntries` فقط بدون `examCenterLevels`).

**Test Plan**: ملاحظة السلوك على الكود غير المُصلَح للحالات المكتملة (`M == N`)، ثم كتابة اختبارات تؤكد استمرار نفس المخرجات بعد الإصلاح.

**Test Cases**:

1. **Fully-Saved Level**: مستوى بـ `rooms=2` وصفّين محفوظين — `roomsList` نفسه قبل وبعد.
2. **Unscheduled Level**: مستوى في `examCenterLevels` لكنه غير موجود في `scheduleEntries` — لا يظهر في `roomsList` قبل ولا بعد.
3. **`level.rooms = 0`**: `roomsList[L]` يساوي `actualRows` قبل وبعد، ولا صفوف افتراضية.
4. **`examCenterLevels` فارغ**: `roomsList` يساوي بالكامل ما تنتجه الشيفرة الحالية، مع تحذير console واحد.
5. **v1 Path**: تشغيل `runAutoDistribution` (v1) بدون المرور عبر `buildV2Input` — لا تغيير في النتائج.
6. **Save Format in `examCenterRoomsData`**: بعد تشغيل v2 مع صفوف افتراضية، `examCenterRoomsData` في التخزين لا يتغيّر.
7. **Display Functions**: `getSummaryCandidateCountForLevel` لا تحتسب الصفوف الافتراضية.

### Unit Tests

- اختبار `getExamCenterLevelsForActiveYear` مع مدخلات متعدّدة (فارغ، مصفوفة صحيحة، كائنات ناقصة الحقول).
- اختبار `buildSyntheticRoomRow` للتأكد من شكل الكائن المُنتَج ومن علامة `_synthetic`.
- اختبار `computeMaxRoomNum` مع صفوف بأرقام متفاوتة وبحقول `room_num` مفقودة.
- اختبار منطق التكميل في `buildV2Input`: حالات `M=0`، `M<N`، `M==N`، `M>N`، `N=0`، `level` غير موجود.
- اختبار أن `syntheticRoomWarnings[]` يحوي المستويات الصحيحة بالأرقام الصحيحة.

### Property-Based Tests

- **Property 1 (تكميل العدد)**: لأي ثلاثي `(examCenterLevels, examCenterRoomsData, scheduleEntries)` يستوفي bug condition لمستوى `L`، `buildV2Input_fixed` يُنتج `roomsList[L].length == examCenterLevels[L].rooms`.
- **Property 2 (حفظ المحتوى)**: لأي ثلاثي لا يستوفي bug condition، `roomsList` المنتَج يساوي ما تنتجه الشيفرة الأصلية (deep equality).
- **Property 3 (عدم تداخل الترقيم)**: لأي مستوى تُولَّد له صفوف افتراضية، أرقام الصفوف الافتراضية لا تتقاطع مع `room_num` لأي صف فعلي في `examCenterRoomsData`.
- **Property 4 (استقرار الحفظ)**: تشغيل `buildV2Input` عدّة مرات لا يغيّر `examCenterRoomsData` في التخزين.

### Integration Tests

- تشغيل `runAutoDistributionV2` على سيناريو يحوي مستويَيْن ناقصَيْن (كما في ملاحظات الجلسة: العلوم الرياضية + الاقتصاد)، والتحقق من أن كل المستويات تُعيَّن لها مهام حراسة في النتائج.
- التحقق من ظهور قسم "قاعات افتراضية مُكمَّلة" في Diagnostics Panel وظهور toast واحد مجمَّع.
- اختبار تبديل Algorithm Toggle بين v1 و v2 والتحقق من أن v1 لا يتأثر بمنطق التكميل.
- اختبار end-to-end: بعد حفظ قاعات مفقودة عبر `exams-rooms.html`، إعادة تشغيل التوزيع تُنتج `0` صفوف افتراضية ولا يظهر التحذير.
