# خطة تحسين Tabs استعمال الزمن وDrag and Drop (نسخة منقّحة)

> **التاريخ:** 2026-07-09
> **الحالة:** مقترح للتنفيذ — نسخة مصحّحة بناءً على مراجعة الكود الفعلي
> **يحل محل:** `docs/plans/2026-04-11-timetable-tabs-drag-drop-plan.md`
> **المراجعة المرجعية:** `docs/reviews/2026-07-08-timetable-edit-drag-drop-review.md`
> **الملفات المرجعية:**
> - `timetable.html` (منطق `switchTab`، سطور 19–40)
> - `js/pages/timetable.js` (منطق التعديل + Drag and Drop + التحقق)
> - `js/pages/timetable-students.js` (تبويب التلاميذ — عرض مشتق)
> - `js/pages/timetable-rooms.js` (تبويب القاعات — عرض مشتق)

---

## 0. لماذا هذه النسخة

النسخة الأولى (2026-04-11) كانت سليمة في الرؤية لكنها استهدفت أماكن خاطئة في الكود:

- طلبت إعادة كتابة `wouldCreateGap()` وهي **دالة ميتة لا تُستدعى إطلاقًا**.
- وصفت فصل التحقق عن `colspan` كأنه ناقص، **وهو منفَّذ فعلًا**.
- اقترحت نموذج `duration`/`periodKey` غير موجود وغير ضروري.
- بسّطت نموذج المزامنة (التبويبات تقرأ من قاعدة البيانات المحفوظة لا من `fetData` الحيّ).
- أغفلت أخطر خطأين (Cancel لا يستعيد البيانات، وتراكم مستمعي الأحداث).

هذه النسخة تصحّح كل ذلك وتضيف مراسي كود (أرقام سطور) ومعايير قبول.

---

## 1. الوضع الفعلي في الكود (موثّق)

### 1.1 نموذج الحصة الحالي
- الثوابت: `const arabicDays` و `const periods = ['H1', 'H2', 'H3', 'H4']` (سطر 126–127).
- كل حصة تُخزَّن في `fetData.timetables[teacher][day][periodType][period]` حيث `periodType ∈ {morning, afternoon}`.
- مدة الحصة تُشتق من مجال `period` → `periodEnd` عبر `buildPeriodRange(periodStart, periodEnd)` (سطر 3088). **لا حاجة لحقل `duration`.**
- الخلايا المعروضة تحمل `data-day` / `data-period` / `data-period-type` / `data-period-end`.

### 1.2 مسار Drag and Drop الحيّ (يعمل)
- `handleDragStart` (2284) → يلتقط `_dragSource` ويمنع سحب الخلايا الفارغة.
- `handleDragOver` (2791) → يستدعي `validateMoveTarget` ويضبط `dropEffect`.
- `handleDrop` (2338) → ينفّذ `performMoveToDestination`.
- `handleDragEnd` (2328) → ينظّف الأصناف.
- التحقق: `validateMoveTarget` (2549) — يفحص انشغال الأستاذ، انشغال القسم، القاعة، تتالي الخانات، وفراغ القسم.
- فحص الفراغ الحيّ: `causesGapAfterMove` (2544) → `buildOccupancyAfterMove` (2535) → `hasInternalGap` (2514). **هذا هو الفحص الصحيح المستعمل فعليًا** (يُستدعى من داخل `validateMoveTarget` عند سطر 2612).

### 1.3 التبويبات المشتقة
- `StudentTimetable` (`timetable-students.js`) و `RoomTimetable` (`timetable-rooms.js`) يقرآن البيانات عبر:
  `window.api.timetable.get(schoolYear)` — أي من **قاعدة البيانات المحفوظة، وليس من `fetData` الحيّ**.
- التحديث يحدث فقط عند تفعيل التبويب: `switchTab` في `timetable.html` يستدعي `StudentTimetable.init()` أو `RoomTimetable.init()` والتي تعيد استدعاء `loadTimetableData()`.
- **النتيجة:** تعديلات تبويب الأستاذ لا تظهر في تبويبي التلاميذ والقاعات إلا بعد `saveAllChanges()` **ثم** إعادة فتح التبويب.

### 1.4 كود ميت / أنظمة موازية (يجب حذفها)
- `wouldCreateGap()` (2424) — معرّفة ولا تُستدعى أبدًا (تم التحقق). تحتوي شرطًا تكراريًا `targetDay === targetDay` (دائمًا صحيح) و`console.log`.
- `performUndo()` (610) و `performRedo()` (617) — نظام تراجع ميت موازٍ للنظام الحقيقي `undoLastChange()` (3095).

---

## 2. المشاكل الحقيقية (مرتّبة حسب الأولوية)

### P0 — أخطاء تكسر الموثوقية (أعلى أولوية)

**P0-1: Cancel لا يستعيد البيانات.**
`cancelEditMode()` (3135) يمسح `pendingChanges` ويخرج، لكنه **لا يعيد** `editMode.originalTimetable` إلى `fetData`. النتيجة: بعد التعديل ثم الإلغاء، تبقى الشبكة مُعدَّلة فعليًا.
اللقطة تُبنى في `buildOriginalTimetable()` (3162) لكنها لا تُستعمل في الاستعادة.

**P0-2: تراكم مستمعي الأحداث عند إعادة الرسم.**
`performMoveToDestination` (2684) و `undoLastChange` (3095) يستدعيان `addCellClickHandlers()` بعد كل إعادة رسم **دون** `removeCellClickHandlers()` مسبقًا (`removeCellClickHandlers` يعمل فقط عند الخروج). بعد N عملية، كل إفلات/نقر يُطلَق N مرات → تكرار التغييرات المعلّقة ونقل مزدوج. هذا يضرب مباشرة موثوقية Drag and Drop.

### P1 — أخطاء منطقية في النقل

**P1-1: عبور حد الصباح/المساء في الحصة الثنائية.**
`getConsecutivePeriods(periodStart, count)` (2478) يمشي على مصفوفة مسطّحة `periods = ['H1','H2','H3','H4']` بلا فصل بين الفترتين. حصة ثنائية مرساتها H2 (صباح) تُنتج `['H2','H3']` — وH3 مساء. ثم `validateMoveTarget` يطبّق `destPeriodType` واحدًا على الاثنين، فيسمح بكتابة كتلة ثنائية في خانة `morning.H3` غير الموجودة.

**P1-2: حذف الكود الميت لمنع الإصلاح الخاطئ.**
وجود `wouldCreateGap()` الميتة يغري بإصلاح الدالة الخطأ (كما حصل في النسخة الأولى). حذفها يوجّه أي مطوّر مستقبلي إلى `causesGapAfterMove`/`hasInternalGap` الصحيحة.

### P2 — مزامنة ومنطق العرض

**P2-1: نموذج مزامنة غير موثّق.**
خطر فقدان `students`/`room` ليس في مسار النقل (`performMoveToDestination` ينسخ `{ ...mv.sourceData }` فيحافظ على كل الحقول) بل في **مسار التعديل بالنافذة** `confirmSlotEdit` (2819). الحماية يجب أن تتوجّه هناك.

**P2-2: التبويبات لا تعكس التعديلات غير المحفوظة.**
يجب توثيق أن التلاميذ/القاعات تعكس فقط الحالة المحفوظة، وإضافة تحديث صريح بعد `saveAllChanges()`.

---

## 3. الإصلاحات المقترحة (مع مراسي الكود)

### 3.1 [P0-1] استعادة اللقطة عند الإلغاء
داخل `cancelEditMode()` (3135)، قبل `exitEditMode()`:

```js
if (editMode.originalTimetable && editMode.currentTeacher) {
    fetData.timetables[editMode.currentTeacher] =
        JSON.parse(JSON.stringify(editMode.originalTimetable));
    const subjectFilter = document.getElementById('subject-filter')?.value || '';
    renderTeacherTimetable(editMode.currentTeacher, subjectFilter);
}
editMode.pendingChanges = [];
exitEditMode();
```

### 3.2 [P0-2] إيقاف تراكم المستمعين
الحل المفضّل: تفويض حدث واحد على `#timetable tbody` بدل الربط لكل خلية.
الحل الأدنى: استدعاء `removeCellClickHandlers()` قبل كل `addCellClickHandlers()` في:
- `performMoveToDestination` (2684)
- `undoLastChange` (3095)
- أي مسار آخر يعيد الرسم داخل وضع التعديل.

### 3.3 [P1-1] منع عبور حد الفترة في الحصة الثنائية
تقوية `validateMoveTarget` (2549): بعد حساب `destPeriods`، رفض النقل إذا خرجت أي خانة عن الفترة المستهدفة الحقيقية. أبسط تنفيذ: قصر `getConsecutivePeriods` على نطاق الفترة، أو إضافة فحص:

```js
const morning = ['H1', 'H2'];
const afternoon = ['H3', 'H4'];
const band = destPeriodType === 'morning' ? morning : afternoon;
if (!destPeriods.every((p) => band.includes(p))) {
    return { valid: false, message: 'لا يمكن نقل الحصة الثنائية عبر حد الصباح/المساء.' };
}
```

### 3.4 [P1-2] حذف الكود الميت
- حذف `wouldCreateGap()` (2424) بالكامل.
- حذف `performUndo()` (610) و`performRedo()` (617) أو ربطهما بـ`editMode.pendingChanges` إن أُريد إبقاء أزرار الرأس.
- إبقاء `undoLastChange()` النظامَ الوحيد للتراجع.

### 3.5 [P2-1] حماية بيانات الحصة في التعديل بالنافذة
في `confirmSlotEdit` (2819): ضمان أن `subject` و`students` و`room` لا تُفقد أو تُصفّر دون قصد عند التعديل الجزئي، وأن التحقق (`validateChange`, 2951) يشترك مع منطق النقل قدر الإمكان.

### 3.6 [P2-2] تحديث التبويبات بعد الحفظ
بعد نجاح `saveAllChanges()` (3310): إعادة تهيئة التبويب النشط إن كان تلاميذ/قاعات، أو تعليم البيانات كـ"متسخة" حتى يعيد `switchTab` تحميلها. توثيق أن العرض المشتق = الحالة المحفوظة.

---

## 4. ما لا يحتاج عملًا (موجود فعلًا)

- **فصل التحقق عن `colspan`:** المسار الحيّ يعتمد على `data-*` فقط (`handleDragStart`, `handleDragOver`, `validateMoveTarget`, `getRenderedCellForSlot`). يُبقى كحارس انحدار فقط.
- **احترام تتالي الخانات:** `getConsecutivePeriods` + `validateMoveTarget` ينفّذانه (يبقى فقط إصلاح حد الفترة في 3.3).
- **حفظ `students`/`room` أثناء النقل:** `performMoveToDestination` ينسخ كامل `sourceData`.

---

## 5. تحسينات UX (بعد إصلاح P0/P1)

- تمييز أوضح بين الحصة المفردة والثنائية (يعتمد على `numPeriods` في `_dragSource`).
- تظليل الخانات المتأثرة أثناء السحب موجود عبر `highlightAvailableSlots` (2624) — يُحسَّن رسائل الرفض فقط.
- في تبويب القاعات: إبراز نسبة الاستغلال العالية (المعطى `usagePercent` محسوب فعلًا في `showRoomSchedule`).

---

## 6. سيناريوهات الاختبار ومعايير القبول

| # | السيناريو | النتيجة المتوقعة | آلية |
|---|-----------|------------------|------|
| 1 | نقل حصة مفردة إلى خانة فارغة صالحة | نجاح + Toast نجاح | يدوي |
| 2 | نقل مفردة إلى خانة بها تعارض أستاذ | رفض برسالة الأستاذ مشغول | آلي (`validateMoveTarget`) |
| 3 | نقل مفردة إلى تعارض قسم | رفض برسالة القسم مشغول | آلي |
| 4 | نقل مفردة إلى تعارض قاعة | رفض برسالة القاعة مشغولة | آلي |
| 5 | نقل ثنائية إلى خانتين متتاليتين صالحتين | نجاح، الخانتان معًا | آلي |
| 6 | نقل ثنائية إلى خانة لا تكفي لحصتين | رفض (تتالي غير كافٍ) | آلي |
| 7 | نقل ثنائية عبر حد الصباح/المساء (مرساة H2) | **رفض** (إصلاح P1-1) | آلي |
| 8 | Undo بعد نقل مفرد وثنائي | استرجاع كامل المجموعة | آلي |
| 9 | تعديل ثم **Cancel** | استعادة الشبكة الأصلية بالكامل (إصلاح P0-1) | آلي |
| 10 | تنفيذ N نقلات متتالية ثم إفلات واحد | إطلاق الحدث مرة واحدة فقط (إصلاح P0-2) | آلي |
| 11 | حفظ ثم فتح تبويبي التلاميذ/القاعات | انعكاس التعديلات المحفوظة | يدوي |

> الأمر المرجعي من `AGENTS.md`: `npm test; npm run lint`. السيناريوهات المعلّمة "آلي" تُغطّى باختبارات وحدة على الدوال النقية (`validateMoveTarget`, `getConsecutivePeriods`, `causesGapAfterMove`).

---

## 7. ترتيب التنفيذ

1. **P0-1** استعادة اللقطة عند Cancel.
2. **P0-2** إيقاف تراكم المستمعين (تفويض أو remove-before-add).
3. **P1-1** حارس حد الصباح/المساء في `validateMoveTarget`.
4. **P1-2** حذف الكود الميت (`wouldCreateGap`, `performUndo`/`performRedo`).
5. **P2-1** توحيد حماية بيانات الحصة في `confirmSlotEdit`.
6. **P2-2** تحديث التبويبات بعد الحفظ + توثيق نموذج المزامنة.
7. **UX** تحسينات العرض ورسائل الرفض.

---

## 8. ملاحظات تنفيذ

- تبويب الأستاذ يبقى مصدر التعديل الوحيد.
- تبويبا التلاميذ والقاعات = عرض مشتق من **الحالة المحفوظة**، يُعاد تحميله عند تفعيل التبويب.
- لا تغيير في schema قاعدة البيانات.
- لا حاجة لنموذج `duration`/`periodKey` جديد؛ يُعتمد `period`/`periodEnd` القائم.
- الأولوية القصوى لإصلاحات P0 لأنها تضرب موثوقية Drag and Drop مباشرة.

---

## 9. الخلاصة

الخطة الآن:

- **موجّهة للكود الفعلي** بمراسي سطور دقيقة.
- **تصلح الأخطاء الحقيقية** (Cancel، تراكم المستمعين، حد الفترة) بدل الكود الميت.
- **تحذف** المسارات الميتة لمنع الإصلاح الخاطئ.
- **توثّق نموذج المزامنة الحقيقي** (محفوظ لا حيّ).
- **تربط كل سيناريو بمعيار قبول** وآلية اختبار.
