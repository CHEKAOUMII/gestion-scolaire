# تصوّر الإصلاح المتبقّي — Fairness Metric & Reserve Affinity

> تاريخ الجلسة: 2026-05-15
> Spec: `proctor-v2-strict-fairness-coverage`
> الحالة: design notes — لاستئناف العمل غداً

---

## 1. السياق

أكمل وكيل سابق المراحل A → G من خطة المهام (40 من 70 مهمة). عند التحقق الفعلي من سيناريو المستخدم (147 أستاذاً، 368 مهمة، D_expected=15)، تبيّن أن الإصلاح المُدَّعى **غير مكتمل**.

### المكتشفات الفعلية بعد التحقق

| المتغيّر | المتوقَّع | الفعلي |
|---------|----------|--------|
| Phase 2 timeout | < 1500ms | 1639ms (يقطع قبل الإكمال) |
| guard slots filled | 368 / 368 | 96 / 368 |
| primaryLoad = 0 (uncovered) | 0 | 51 من 147 |
| coverageRepairSwaps | كبير | 0 |
| coverageRepairUnresolved | 0 | 51 |
| max guardCount (مع timeout مرفوع) | ≤ 3 | 11 |

### التشخيص النهائي

ثلاثة عيوب متراكبة:

1. **Phase 2 `TIMEOUT_MS = 1500` مُجمَّد** (سطر ~1635) ويقطع التشغيل على fixtures كبيرة.
2. **`greedyFallback` كان يقبل `INFINITY_SENTINEL`** — تم إصلاحه أثناء التحقق (التحقق المباشر يُظهر أن الـ check `bestCost < INFINITY_SENTINEL` موجود الآن، يحتاج تأكيد).
3. **`phase2_75CoverageRepair` بحدّ صارم** — يبحث عن peer `>= classUB+1` ثم `>= classUB`، لكن مع cap نشط لا يوجد أحد فوق الحدّ.

### اكتشاف جوهري لاحق

**التضارب الحقيقي ليس في الإصلاح بل في تعريف القياس:**

- `addGuardLoad` يستعمل `guardHalfdays.add(halfdayKey)` ويُزيد `guardCount` فقط على halfdays فريدة.
- إذن أستاذ يحرس **5 جلسات متتابعة في نفس النصف** = `guardCount = 1`.
- الاختبار يَعدّ ظهور `proctor_keys` في الـ rows (= 5 ظهور) بينما الخوارزمية تَعدّ halfdays (= 1).
- النتيجة: `max(appearances) = 11` لكن `max(guardCount) = 3` على الـ fixture الصغير.

**القيد الصلب يعمل صحيحاً على متريكه الداخلي**، لكن المتريك نفسه لا يطابق نيّة المستخدم.

---

## 2. قرار المستخدم: العدّ بالسلوتات

> اخترتُ هذا الحل وهو الأنسب: **B — العدّ بالسلوتات فقط**
> أردت أن الأستاذ في الحصة التالية في نفس اليوم تكون إن أمكن احتياطاً، في حين أن توزيع الاحتياط يكون بعدياً.

### المتريك الجديد

`guardSlotCount(T)` = عدد ظهور `T` في `proctor_keys` عبر كل rows.

كل قاعة × كل جلسة = slot منفصل. الأستاذ الذي يحرس قاعتَين في نفس الجلسة = 2. الذي يحرس جلستَين متتابعتَين = 2.

### القياس النهائي للعدالة

```
G = Σ over rows: |proctor_keys|        ← المهام = إجمالي السلوتات
D_expected = user-supplied (15 في حالة المستخدم)
G_total = G + D_expected
classUpperBound = ceil(G_total / N)
classLowerBound = floor(G_total / N)
```

`primaryLoad(T) = guardSlotCount(T) + dutyCount(T)`

في سيناريو المستخدم: `(368 + 15) / 147 ≈ 2.6` → `classLowerBound = 2`, `classUpperBound = 3`.

---

## 3. قاعدة الاحتياط الجديدة (تأكيد المستخدم)

**السياق:** عدد الحصص في النصف الواحد ≤ 2 (حصة أولى + حصة ثانية، لا أكثر).

### القاعدة

> "احتياط الحصة الثانية في نصف يوم: يُفضَّل أستاذ حرس الحصة الأولى من نفس النصف، بشرط `reserveCount(T) = 0` أولاً، وبقدر الحاجة فقط (`reserveTarget` للحصة)، ومرة واحدة عبر كل التشغيل."

### الأهداف الثلاثة (بترتيب الأهمية)

1. **الانتشار** — كل أستاذ يحتاط **مرة واحدة** قبل أن يحتاط أحد مرّتَين.
2. **القرب** — حرّاس الحصة الأولى يُقدَّمون على الخارجيين (موجودون في المؤسسة، أخفّ عليهم).
3. **التوازن العام** — `finalLoad = guardSlotCount + reserveCount + dutyCount`.

### ترتيب الفرز في `phase2_5PopulateReserves`

```
hard:   T ليس معفى للحصة، ليس مداوماً في النصف، ليس حارساً في نفس الحصة
soft 1: reserveCount(T) ASC                 ← الانتشار
soft 2: حرس الحصة السابقة من نفس النصف؟ DESC (yes أولاً)   ← القرب (فقط للحصة الثانية)
soft 3: finalLoad ASC                       ← التوازن العام
soft 4: rng() ASC                           ← كسر التعادل (موجود)
```

### الحالة الحدية: عدد الحصص بالنصف ≤ 2

- **الحصة الأولى من النصف**: لا حرّاس سابقون → soft 2 معطَّل، الفرز يصبح `reserveCount ASC, finalLoad ASC, rng()`.
- **الحصة الثانية من النصف**: soft 2 يُفعَّل، حرّاس الحصة الأولى يُقدَّمون.

---

## 4. خطة العمل لغد

### Step 1 — تعديل القياس في الكود

**الملفات المتأثّرة:** `js/algorithms/proctor-distribution-v2.js`

**التغييرات:**

1. **خيار: تغيير `addGuardLoad`** ليعدّ السلوتات (إزالة `Set` للـ halfdays):
   ```js
   function addGuardLoad(loadState, proctorKey, halfdayKey, teacherName) {
     if (!proctorKey || !halfdayKey) return false;
     const entry = getTeacherLoad(loadState, proctorKey);
     if (teacherName && !entry.teacherName) entry.teacherName = teacherName;
     entry.guardHalfdays.add(halfdayKey);   // يبقى لتتبع reuse rules
     entry.guardCount++;                    // ← يُزاد دائماً، لا فقط على halfdays فريدة
     if (isMorningHalfday(halfdayKey)) entry.morningCount++;
     else entry.afternoonCount++;
     return true;
   }
   ```

2. **التحقق من `objectiveFunction`**: تستعمل `proctor_keys.length` وهي صحيحة الآن.

3. **التحقق من Phase 3 SA `swap_guards`**: لا تتأثر.

**الأثر المتوقّع:**
- على fixture المستخدم: `max(primaryLoad)` يصبح `≤ 3` (يطابق `classUpperBound`).
- اختبار v1 byte-equality يجب أن **يبقى صحيحاً** لأن v1 يعمل بنفس المنطق (الكشف يجب).
- `loadState.guardCount` في كل التشغيلات السابقة سيتغيّر — مما قد يكسر اختبارات unit موجودة.

### Step 2 — إصلاح Phase 2 timeout

**التغيير:**
```js
// كان:
var TIMEOUT_MS = 1500;
// يصبح:
var TIMEOUT_MS = (input.options && input.options.phase2TimeoutMs) || 5000;
```

عند الـ timeout، نُعيد فلاج جديد:
```js
return {
  assignments: ...,
  loadState: ...,
  classBoundsByProctorKey: ...,
  classIdByProctorKey: ...,
  diagnostics: {
    ...existing,
    phase2TimedOut: timedOut,
    phase2DurationMs: ...
  }
};
```

في الـ orchestrator (سطر ~3907):
```js
// كان: if (phase2Result.diagnostics.phase2DurationMs >= 1500) {
// يصبح: if (phase2Result.diagnostics.phase2TimedOut) {
```

### Step 3 — مرونة في `phase2_75CoverageRepair`

إضافة مستوى ثالث من التراخي:

```js
var candidates = buildSwapCandidates(rows, uncov, classId, loadState, bounds.classUpperBound + 1, ...);
if (candidates.length === 0) {
  candidates = buildSwapCandidates(rows, uncov, classId, loadState, bounds.classUpperBound, ...);
}
if (candidates.length === 0) {
  // مستوى ثالث جديد: أيّ peer بـ ≥ classLowerBound + 1
  // post-swap: T_over.primaryLoad - 1 ≥ classLowerBound (يبقى داخل النطاق)
  candidates = buildSwapCandidates(rows, uncov, classId, loadState, Math.max(bounds.classLowerBound + 1, 1), ...);
}
if (candidates.length === 0) {
  diagnostics.unresolved++;
  diagnostics.warnings.push({ proctorKey: uncov.key, reason: 'no_swappable_peer' });
  continue;
}
```

### Step 4 — إعادة هيكلة `phase2_5PopulateReserves` لقاعدة الاحتياط الجديدة

**التغيير الرئيسي:** إضافة soft criteria للفرز.

```js
// قبل (في phase2_5PopulateReserves، عند بناء candidates):
candidates.push({
  key: key, proc: proc, idx: pi,
  finalLoad: getFinalLoad(loadStateForReserves, key),
  tiebreak: rng()
});

// بعد:
const reserveCount = (loadStateForReserves[key] && loadStateForReserves[key].reserveCount) || 0;
const guardedPreviousSession = computeGuardedPreviousSession(key, currentSessionKey, halfdayKey, sessionsBySessionKey);
candidates.push({
  key: key, proc: proc, idx: pi,
  reserveCount: reserveCount,
  guardedPrev: guardedPreviousSession ? 0 : 1,  // 0 = first (better)
  finalLoad: getFinalLoad(loadStateForReserves, key),
  tiebreak: rng()
});

// الفرز:
candidates.sort(function (a, b) {
  if (a.reserveCount !== b.reserveCount) return a.reserveCount - b.reserveCount;  // soft 1
  if (a.guardedPrev !== b.guardedPrev) return a.guardedPrev - b.guardedPrev;      // soft 2
  if (a.finalLoad !== b.finalLoad) return a.finalLoad - b.finalLoad;              // soft 3
  return a.tiebreak - b.tiebreak;                                                  // soft 4
});
```

### Step 5 — التحقق

**سكربت التحقق:** `/tmp/verify-strict-fix-final.js` (موجود من الجلسة).

**المعايير:**
- P1: `max(primaryLoad) − min(primaryLoad) ≤ 1` ✓
- P2: `max(primaryLoad) ≤ classUpperBound` ✓
- P3: `min(primaryLoad) ≥ 1` (التغطية) ✓
- Coverage: `total slots filled === G` ✓

**اختبارات إضافية:**
- `node tests/proctor-distribution-v2-cost.test.js` (44/44)
- `node tests/proctor-v2-bug-c1-fairness.test.js` (must still FAIL on pre-fix)
- `node tests/proctor-v2-strict-bug-c1-fairness.test.js` (must still FAIL on pre-fix snapshot)
- `npm run lint` (no new errors)

---

## 5. مهام Phase H المتبقية (29 من 70)

من خطة `tasks.md`:

| # | الفئة | الحالة |
|---|-------|--------|
| 41 | Exploratory UI plumbing | معطَّل (الوكيل أنشأ مظهر اختبار، يحتاج مراجعة) |
| 16 unit tests (H.2) | في انتظار التنفيذ |
| 42-46 PBT (H.3) | في انتظار التنفيذ |
| 47-51 Integration (H.4) | في انتظار التنفيذ |
| 52 npm test/lint after H | تحقق نهائي |
| 53 Risk register coverage | توثيق |
| 54 Final checkpoint | تحقق نهائي |

**ترتيب الاستئناف غداً:**

1. Step 1 (تعديل المتريك) — يجب أن يحدث **قبل** Phase H Tests، لأن معظم الاختبارات ستقيس بالمتريك الجديد.
2. Step 2 (timeout) + Step 3 (coverage repair flex) معاً.
3. Step 4 (قاعدة الاحتياط) — يحتاج فحص استبدال `phase2_5PopulateReserves`.
4. Step 5 — تشغيل verifier وتأكيد P1, P2, P3 على fixture المستخدم.
5. Phase H — أكمل المهام 41-54 بنفس الـ subagent pattern.

---

## 6. ملاحظات مهمة للذاكرة

- الإصلاح السابق `proctor-v2-fairness-duty-reserves` (C1-C4) **سليم ولا يلامس**.
- الـ pre-fix snapshot في `tests/__snapshots__/proctor-v2-strict-fairness-coverage.pre-fix.js` **لا يلمس**.
- الـ fixtures في `tests/fixtures/proctor-v2-strict-fairness-fixtures.js` **لا تلمس**.
- الـ UI plumbing في `exams-proctors.html` **لا تلمس** (`D_expected` يُمرَّر صحيحاً).

### نقطة حرجة

تعديل `addGuardLoad` (Step 1) **سيكسر** اختبارات سابقة تعتمد على القيم القديمة لـ `loadState.guardCount`. هذا متوقَّع — اعتبره breaking change داخل v2 محسوب في v1 byte-equality (لأن v1 يستعمل مساره الخاص). يجب التحقق من:
- v1 byte-equality test (متوقَّع PASS).
- v2 cost test (`proctor-distribution-v2-cost.test.js`) — قد يحتاج تعديل بسيط.
- v2 phase2 test — يجب أن يَعكس المتريك الجديد.

### السبب الرئيسي للقرار B

الفرق بين A (per-halfday) و B (per-slot):
- **A**: عدّ "يومات حضور الأستاذ" — جيد لـ M/E balance، سيء لـ workload.
- **B**: عدّ "ساعات الحراسة الفعلية" — يطابق نيّة المستخدم تماماً.

المستخدم أكَّد أن أستاذ يحرس جلستَين متتابعتَين **يجب أن يُعَدّ بـ 2** لأن العبء الفعلي 2.

---

## 7. مرجع سريع للاستئناف

```bash
# تشغيل التحقق
node /tmp/verify-strict-fix-final.js  # موجود من اليوم

# اختبارات critical
node tests/proctor-distribution-v2-cost.test.js
node tests/proctor-v2-strict-bug-c1-fairness.test.js  # must FAIL on pre-fix

# lint
npm run lint
```

**نقطة دخول للكود:** `js/algorithms/proctor-distribution-v2.js`
- `addGuardLoad` ≈ سطر 283
- `phase2Build` ≈ سطر 1634
- `costFunction` ≈ سطر 1450 (مع hard cap)
- `phase2_5PopulateReserves` ≈ سطر 2200
- `phase2_75CoverageRepair` ≈ سطر 2750
- `orchestrator` ≈ سطر 3850

**Spec docs:**
- `bugfix.md`: تعريفات Bug Conditions و Properties
- `design.md`: التصميم الكامل
- `tasks.md`: 70 مهمة، 40 منها مكتمل


---

## 8. تحسين مستقبلي مخطَّط: Morning/Evening Balance لكل أستاذ

### الفكرة
قيد لين تدريجي يوازن `morningCount` و `afternoonCount` لكل أستاذ منفرداً. مثال نية المستخدم:
> أستاذ يحرس 2 صباحاً + 3 زوالاً ✓ (متوازن نسبياً)
> أستاذ يحرس 0 صباحاً + 5 زوالاً ✗ (مُختل)

### البنية التحتية الموجودة
- `loadState[key].morningCount` و `afternoonCount` موجودان ومُحدَّثان عبر `addGuardLoad`.
- `isMorningHalfday(halfdayKey)` helper موجود.
- `objectiveFunction` (Phase 3) يحسب `morningEveningImbalance` ضمن دالة هدفه — لكن SA وحده لا يكفي لأن Phase 2 لا يراه.

### التصميم المقترح
قيد لين جديد في `costFunction` (وزن مقترح: 2):
```
if (options.balanceMorningEvening !== false):
  imbalance = |morningCount(T) − afternoonCount(T)|
  isMorningTask = isMorningHalfday(task.halfdayKey)
  wouldWorsen = (isMorningTask AND morningCount(T) >= afternoonCount(T))
              OR (!isMorningTask AND afternoonCount(T) >= morningCount(T))
  IF wouldWorsen AND imbalance >= 1:
    cost += 2
```

### الفرق عن `respectMorningEvening` الحالي
- `respectMorningEvening` (وزن 5): يفرض أن المجموعة (G1/G2) تحرس وقتها فقط.
- `balanceMorningEvening` (وزن 2): يضمن لكل أستاذ توازناً داخلياً صباح/زوال.
- يكمّلان بعضهما: الأول يحدّد متى يحرس، الثاني يضمن التوازن عبر التشغيل.

### Spec المخطَّط له
- اسم: `proctor-v2-morning-evening-balance`
- نوع: enhancement (ليس bugfix)
- نطاق: تعديل `costFunction` فقط + flag في `input.options` + checkbox في UI.
- تكلفة تنفيذ مقدَّرة: ~1 ساعة + 3 unit tests + 1 PBT + 1 integration.

### الجدولة
**بعد** اكتمال spec الحالي (`proctor-v2-strict-fairness-coverage`). لا يُخلَط معه لأن:
1. هذا تحسين، ليس إصلاح خلل.
2. الـ spec الحالي معقَّد بما فيه الكفاية.
3. التحسين مستقل تماماً (لا يلامس fairness cap أو coverage repair).
