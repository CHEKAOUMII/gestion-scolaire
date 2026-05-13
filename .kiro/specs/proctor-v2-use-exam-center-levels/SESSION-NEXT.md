# ملاحظات للجلسة القادمة — خوارزمية توزيع المراقبين v2

## تاريخ: 2026-05-13

## ما تم إنجازه في هذه الجلسة

### 1. Bugfix: proctor-v2-use-exam-center-levels (18/18 مهمة مكتملة)

**المشكلة**: `buildV2Input` كان يعتمد فقط على `examCenterRoomsData` لبناء `roomsList`. المستويات التي لم تُحفظ لها قاعات كانت تُسقَط بصمت من Phase_2_Build.

**الحل**: `buildV2Input` الآن يقرأ `examCenterLevels` (من `better-sqlite3` عبر `window.api.examConfig.get`) ويكمّل الصفوف الناقصة بصفوف افتراضية في الذاكرة فقط (لا تُحفظ).

**الدوال المُضافة في `exams-proctors.html`**:
- `buildExamCenterLevelsMap(rawArray)` — نقية، تحوّل المصفوفة إلى خريطة
- `getExamCenterLevelsForActiveYear()` — async wrapper يقرأ من DB
- `buildSyntheticRoomRow(levelName, roomNum)` — تُنتج صف قاعة افتراضي
- `computeMaxRoomNum(rows)` — أكبر room_num في الصفوف
- `computeEffectiveRoomRows(levelName, actualRows, map)` — منطق التكميل النقي
- `getEffectiveRoomRowsForLevel(levelName, map)` — async wrapper
- `escapeHtmlSafe(s)` — escape لـ innerHTML
- `renderSyntheticRoomWarnings(warnings)` — قسم Diagnostics Panel + toast

**إصلاح إضافي**: `var input = buildV2Input()` → `var input = await buildV2Input()` في `runAutoDistributionV2`.

**تنظيف**: إزالة كل `[V2 DEBUG]` (15 سطراً)، تحويل 3 سطور fuzzy-match إلى `[V2 WARN]`.

### 2. تحسين UI: عرض تفصيل مهام القاعات

في chip "مهام القاعات" أُضيف:
- **نص مختصر**: `(172 مهمة × 2 حارس/قاعة = 344 تكليف)`
- **tooltip per-شعبة**: كل شعبة بقاعاتها × موادها × حراسها = تكاليفها

### 3. الاختبارات

- **12 ملف اختبار جديد** (`tests/proctor-v2-*.test.js`) — 145 assertion
- **اختبارات v2 الأصلية** (8 ملفات) — 105 pass، 1 pre-existing fail (`testProctorKeyUsesIndex`)

---

## ما يجب فعله في الجلسة القادمة

### أولوية 1: إضافة الاحتياط والمداومة في التوزيع

المستخدم ذكر أن **الاحتياط والمداومة ليست مدمجة ضمن المهام** المعروضة في chip "مهام القاعات". المطلوب:

1. **عرض الاحتياط في التفصيل**: إضافة عدد الاحتياط (`reservesPerSession × sessions`) إلى الـchip أو tooltip.
2. **عرض المداومة**: إضافة عدد المداومين (`dutyTeachers`) إلى التفصيل.
3. **الصيغة الكاملة المطلوبة**:
   ```
   إجمالي التكاليف = مهام الحراسة + الاحتياط + المداومة
                    = Σ(rooms_L × subjects_L × guardsPerRoom) + (sessions × reservesPerSession) + dutyCount
   ```

### أولوية 2: مهمة 3.10 — محاذاة quota helpers مع effective room rows

من SESSION-NOTES.md (Task 3.6 caveat):
- `buildGuardQuota`, `buildPerTeacherQuota`, `getPlanningReadiness` لا تزال تستعمل `getRoomRowsForLevel` الأصلية
- يجب تحديثها لاستعمال `getEffectiveRoomRowsForLevel` حتى تتطابق أرقام الحاجيات مع `roomsList` الممرَّر إلى الخوارزمية
- مسار v1 يجب أن يبقى معزولاً

### أولوية 3: إزالة الفشل المسبق في `testProctorKeyUsesIndex`

في `tests/proctor-distribution-v2-csp.test.js` — فشل موجود قبل عملنا. يحتاج تحقيقاً منفصلاً.

---

## بنية البيانات المرجعية

### `examCenterLevels` (المصدر: `exams-schedule.html` → `window.api.examConfig.save`)

```js
[
  {
    name: "الثانية باكالوريا العلوم الفيزيائية – خ. فرنسية - رسميون",
    subjects: [
      { name: "الفيزياء والكيمياء", type: "وطني", duration: "3س" },
      { name: "الرياضيات", type: "وطني", duration: "3س" },
      // ...
    ],
    rooms: 8
  },
  // ... باقي الشعب
]
```

### المستويات المضافة حالياً (7 شعب)

| الشعبة | مواد | قاعات | تكاليف (×2 حارس) |
|--------|------|-------|-------------------|
| الثانية باك العلوم الفيزيائية – خ. فرنسية | 5 | 8 | 80 |
| الثانية باك علوم إنسانية | 4 | 10 | 80 |
| الأولى باك الآداب والعلوم الإنسانية | 3 | 12 | 72 |
| الأولى باك العلوم التجريبية – خيار فرنسية | 4 | 10 | 80 |
| الأولى باك العلوم الرياضية | 4 | 2 | 16 |
| الأولى باك علوم الاقتصاد والتدبير | 4 | 2 | 16 |
| الثانية باك علوم الاقتصاد | 6 | 2 | 24 |
| **المجموع** | **30** | **46** | **368** |

### الصيغة الحسابية

```
مجموع مهام الحراسة = Σ per_level (rooms_L × subjects_L) × guardsPerRoom
                    = 184 × 2 = 368 تكليف

مجموع الاحتياط = sessions × reservesPerSession
مجموع المداومة = عدد المداومين المعيَّنين

الإجمالي الكامل = حراسة + احتياط + مداومة
```

---

## الملفات المعدَّلة في هذه الجلسة

- `exams-proctors.html` — 8 دوال جديدة + تحديث `buildV2Input` + `renderSyntheticRoomWarnings` + تنظيف DEBUG + تحسين chip UI
- `tests/proctor-v2-*.test.js` — 12 ملف اختبار جديد (145 assertion)
- `.kiro/specs/proctor-v2-use-exam-center-levels/` — bugfix.md, design.md, tasks.md, SESSION-NOTES.md

## أوامر الاختبار

```bash
cd /home/chekaoumi/Desktop/gestionScholaire2

# اختبارات bugfix الجديدة (145 test)
for f in tests/proctor-v2-*.test.js; do node "$f"; done

# اختبارات v2 الأصلية (105 test + 1 pre-existing fail)
for f in tests/proctor-distribution-v2-*.test.js; do node "$f"; done
```
