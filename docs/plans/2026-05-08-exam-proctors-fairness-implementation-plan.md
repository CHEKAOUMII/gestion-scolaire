# خطّة تنفيذية مفصّلة — تحسين عدالة توزيع المراقبين

**التاريخ:** 2026-05-08
**الحالة:** مقترحة
**الأولوية:** عالية
**الصفحة المعنية:** `exams-proctors.html`
**خطّة مفاهيمية مرجعية:** `docs/plans/2026-05-08-exam-proctors-halfday-balancing-plan.md`

> هذه الوثيقة هي **الخطّة التّنفيذية** التّفصيلية المُكمّلة للخطّة المفاهيمية. تركّز على التّغييرات بمستوى الدّالة والسّطر، تسلسل التّنفيذ، الاختبارات، ومعايير القبول لكلّ مرحلة.

---

## 1. الفلسفة العامّة

### 1.1 ثلاث ركائز للعدالة

| الرّكيزة | التّعريف | الهدف |
|---|---|---|
| `primaryLoad` | `dutyHalfdays + guardHalfdays` | `max - min ≤ 1` |
| `finalLoad` | `primary + reserveHalfdays` | `max - min ≤ 1` |
| `guardLoad` | `guardHalfdays` فقط | متوازن مع تعويض المداومة |

### 1.2 المبادئ التّنفيذية

1. **حصّة شخصية لكلّ أستاذ** بدل سقف موحّد.
2. **الاحتياط أداة تسوية** لا فائض.
3. **التّبديل بعد البناء** للوصول إلى `diff ≤ 1`.
4. **التّشخيص الواضح** عند تعذّر التّساوي.
5. **عدم كسر** ما يعمل حالياً (التّوافق الخلفي مع البيانات المحفوظة).

---

## 2. خريطة التّغييرات في الكود

### 2.1 الدّوال المتأثّرة

| الدّالة | الموقع الحالي | نوع التّعديل |
|---|---|---|
| `buildGuardQuota` | السّطر 2910-2920 | استبدال كامل |
| `buildInitialAutoLoadState` | السّطر 2587-2601 | توسعة |
| `getEligibleProctors` | السّطر 2729-2745 | تعديل سطر السّقف |
| `sortAutoCandidates` | السّطر 2709-2727 | تعديل ترتيب المعايير |
| `getEligibleSessionReserveProctors` | السّطر 2830-2880 | تعديل ترتيب |
| `getSessionReserveTargetCount` | السّطر 2896-2908 | إعادة كتابة الشّرط |
| `rebalanceGuardAssignments` | السّطر 3088-3138 | تعميمه إلى `rebalanceAllRoles` |
| `runAutoDistribution` | السّطر 3140-3286 | إعادة هيكلة المراحل |
| `AUTO_DISTRIBUTION_OPTION_DEFAULTS` | السّطر 2189-2197 | إضافة 3 خيارات |
| `buildAutoDistributionSummary` | السّطر 2922-2944 | إضافة Gini ومؤشّرات |

### 2.2 الدّوال الجديدة

```js
function buildPerTeacherQuota(scheduleEntries, rules, loadState)
function rebalanceAllRoles(rows, options, halfdayLimits, loadState)
function tryThreeWaySwap(rows, highTeacher, lowTeacher, options, halfdayLimits)
function rebalanceReserveAssignments(rows, options, halfdayLimits)
function computeGiniCoefficient(values)
function buildSeededRandom(seed)
function sortRoomsByConstraintTightness(rooms, scheduleEntry, loadState, options)
function getFairnessReport(loadState)
```

### 2.3 خيارات جديدة في الواجهة

```js
AUTO_DISTRIBUTION_OPTION_DEFAULTS = {
    // ... الموجودة
    hardAvoidSubjectSpecialty: false,   // جعل التّخصّص قيداً صلباً
    hardAvoidSameRoomRepeat: false,     // جعل تكرار القاعة قيداً صلباً
    distributionSeed: '',               // بذرة عشوائية قابلة للتّثبيت
    enableThreeWaySwap: true,           // التّبديل الثّلاثي
    enableReserveRebalance: true        // إعادة توازن الاحتياط
};
```

---

## 3. المراحل التّنفيذية

### 🔥 المرحلة 1 — حصّة شخصية للحراسة (Per-Teacher Guard Quota)

**الهدف:** حلّ المشكلة الجوهرية حيث الأستاذ ذو المداومة الكثيفة يحصل على نفس سقف الحراسة كزميله بدون مداومة.

#### 1.1 الدّوال الجديدة

```js
function buildPerTeacherQuota(scheduleEntries, rules, loadState) {
    // إجمالي المهام
    const totalGuard = scheduleEntries.reduce((s, e) =>
        s + (getRoomRowsForLevel(e.level_name).length * rules.proctorsPerRoom), 0);

    const totalDuty = proctorsList.reduce((s, _, idx) => {
        const exKey = getProctorExemptionKey(proctorsList[idx], idx);
        return s + getTeacherLoadDetails(loadState, exKey).duty;
    }, 0);

    const sessionsCount = countDistinctSessions(scheduleEntries);
    const totalReserve = sessionsCount * rules.reservesPerSession;
    const totalFinal = totalGuard + totalDuty + totalReserve;

    const N = Math.max(proctorsList.length, 1);
    const fairFinalCeil = Math.ceil(totalFinal / N);
    const fairFinalFloor = Math.floor(totalFinal / N);

    const quotas = {};
    proctorsList.forEach((proc, idx) => {
        const exKey = getProctorExemptionKey(proc, idx);
        const dutyI = getTeacherLoadDetails(loadState, exKey).duty;
        // الميزانية المخصّصة للحراسة = الهدف النّهائي - المداومة - الاحتياط المتوقّع
        // تقدير الاحتياط لكلّ أستاذ = totalReserve / N
        const reserveBudgetI = Math.ceil(totalReserve / N);
        quotas[exKey] = {
            targetFinal: fairFinalCeil,
            targetFinalFloor: fairFinalFloor,
            duty: dutyI,
            guardCap: Math.max(0, fairFinalCeil - dutyI - reserveBudgetI),
            guardCapHard: Math.max(0, fairFinalCeil - dutyI), // يستخدم في overflow
            reserveBudget: reserveBudgetI
        };
    });
    return { quotas, totalFinal, totalGuard, totalDuty, totalReserve, fairFinalCeil };
}
```

#### 1.2 تعديل `getEligibleProctors`

استبدل السّطر `2737`:

```js
// قبل
if (guardQuota && !allowGuardOverflow && !hasTeacherHalfdayLoad(loadState, item.exKey, halfdayKey) && getTeacherGuardLoad(loadState, item.exKey) >= guardQuota.max) return false;

// بعد
const personalQuota = guardQuota?.quotas?.[item.exKey];
if (personalQuota && !allowGuardOverflow && !hasTeacherHalfdayLoad(loadState, item.exKey, halfdayKey)) {
    if (getTeacherGuardLoad(loadState, item.exKey) >= personalQuota.guardCap) return false;
}
```

#### 1.3 تعديل `runAutoDistribution`

استبدل السّطر `3149`:

```js
// قبل
const guardQuota = options.balanceTotalTasks ? buildGuardQuota(scheduleEntries, rules) : null;

// بعد
const guardQuota = options.balanceTotalTasks ? buildPerTeacherQuota(scheduleEntries, rules, loadState) : null;
```

#### 1.4 الإبقاء على `buildGuardQuota` القديمة كـ fallback

لا تُحذف الدّالة القديمة لتجنّب كسر استدعاءات أخرى محتملة. تبقى رمزياً وتُستعمل من `buildPerTeacherQuota` لو لزم.

#### 1.5 معايير القبول للمرحلة 1

- [ ] `primaryDiff ≤ 1` لاختبار: 6 أساتذة، 18 حراسة، 3 مداومة موزّعة على أستاذ واحد.
- [ ] لا تراجع في الاختبارات الموجودة (نفس عدد الصّفوف، نفس عدد الإسناد).
- [ ] إن لزم `allowGuardOverflow` تظهر ملاحظة `تجاوز سقف الحراسة الشّخصي` في الصّفّ.

---

### ⚡ المرحلة 2 — توحيد دلالة `balanceTotalTasks`

**الهدف:** إزالة التّضارب: الفرز يستعمل `primary` دائماً لكنّ `loadState` فارغ من المداومة عند تعطيل الخيار.

#### 2.1 التّعديل في `buildInitialAutoLoadState` (السّطر 2587-2601)

```js
function buildInitialAutoLoadState(scheduleEntries, options) {
    const loadState = createTeacherLoadState();
    // المداومة تُحمَّل دائماً — الخيار يؤثّر فقط على سياسة الفرز لا على البيانات
    const counted = new Set();
    scheduleEntries.forEach(scheduleEntry => {
        const halfdayKey = getAutoDistributionHalfdayKey(scheduleEntry);
        getDutyTeacherKeysForSchedule(scheduleEntry).forEach(exKey => {
            const countKey = halfdayKey + '|' + exKey;
            if (counted.has(countKey)) return;
            counted.add(countKey);
            addTeacherHalfdayLoad(loadState, exKey, 'duty', halfdayKey);
        });
    });
    return loadState;
}
```

#### 2.2 إعادة تسمية الخيار في الواجهة

غيّر تسمية `auto-rule-balance-load` إلى نصّ أوضح:

```html
<!-- قبل -->
موازنة مجموع التّكليفات

<!-- بعد -->
استعمال سياسة فرز موازنة شاملة (يأخذ المداومة بعين الاعتبار في تسلسل الاختيار)
```

> **ملاحظة:** المداومة تُحمَّل دائماً في loadState؛ الخيار فقط يبدّل بين سياسة `balance` و `groups` في `sortAutoCandidates`.

#### 2.3 معايير القبول للمرحلة 2

- [ ] أستاذ ذو 3 مداومات يظهر في `autoDistributionSummary` بـ `duty=3` بصرف النّظر عن قيمة الخيار.
- [ ] لا يتغيّر سلوك سياسة `groups` بشكل غير متوقّع.

---

### 🔥 المرحلة 3 — إعادة توازن متعدّد الأدوار

**الهدف:** تعميم `rebalanceGuardAssignments` لتشمل تبادل guard↔reserve وسلاسل ثلاثية A→B→C.

#### 3.1 الدّالة الجديدة `tryGuardSwap` (مستخرجة من الموجود)

```js
function tryGuardSwap(rows, highTeacher, lowTeacher, options, halfdayLimits) {
    for (const row of rows) {
        const slotIndex = (row.proctor_keys || []).indexOf(highTeacher.exKey);
        if (slotIndex < 0) continue;
        if (canAssignGuardToRow(row, slotIndex, lowTeacher, rows, options, halfdayLimits)) {
            return { row, slotIndex };
        }
    }
    return null;
}
```

#### 3.2 الدّالة الجديدة `tryGuardReserveSwap`

```js
function tryGuardReserveSwap(rows, highTeacher, lowTeacher, options, halfdayLimits) {
    // عالٍ يفقد حراسة، منخفض يأخذها؛ مَن كان احتياطاً يأخذ مكانه في الاحتياط
    for (const row of rows) {
        const slotIndex = (row.proctor_keys || []).indexOf(highTeacher.exKey);
        if (slotIndex < 0) continue;
        const reserveIdx = (row.reserve_keys || []).indexOf(lowTeacher.exKey);
        if (reserveIdx < 0) continue;
        if (canAssignGuardToRow(row, slotIndex, lowTeacher, rows, options, halfdayLimits)) {
            // نقل lowTeacher من reserve إلى guard
            return { row, slotIndex, reserveIdx, mode: 'guard-reserve' };
        }
    }
    return null;
}
```

#### 3.3 الدّالة الجديدة `tryThreeWaySwap`

```js
function tryThreeWaySwap(rows, highTeacher, lowTeacher, options, halfdayLimits) {
    // ابحث عن وسيط B بحيث:
    //  high يخرج من صفّ R1 ⇒ B يدخل R1 ⇒ B يخرج من R2 ⇒ low يدخل R2
    for (const intermediate of proctorsList) {
        const bExKey = getProctorExemptionKey(intermediate, /*idx*/ 0);
        if (bExKey === highTeacher.exKey || bExKey === lowTeacher.exKey) continue;
        const bItem = wrapProctorAsCandidate(intermediate);

        // R1: high → B
        for (const r1 of rows) {
            const slot1 = (r1.proctor_keys || []).indexOf(highTeacher.exKey);
            if (slot1 < 0) continue;
            if (!canAssignGuardToRow(r1, slot1, bItem, rows, options, halfdayLimits)) continue;

            // R2: B → low
            for (const r2 of rows) {
                if (r2 === r1) continue;
                const slot2 = (r2.proctor_keys || []).indexOf(bExKey);
                if (slot2 < 0) continue;
                if (!canAssignGuardToRow(r2, slot2, lowTeacher, rows, options, halfdayLimits)) continue;
                return { r1, slot1, r2, slot2, intermediate: bItem };
            }
        }
    }
    return null;
}
```

#### 3.4 إعادة هيكلة `rebalanceGuardAssignments` → `rebalanceAllRoles`

```js
function rebalanceAllRoles(rows, options, halfdayLimits) {
    let loadState = buildAutoLoadStateFromRows(rows, true); // مع الاحتياط
    let range = getLoadRange(loadState, 'final');
    const notes = [];
    let iterations = 0;
    const MAX_ITER = 500;

    while (range.diff > 1 && iterations < MAX_ITER) {
        iterations++;
        const stats = buildPerTeacherStats(loadState);
        const highs = stats.filter(t => t.final === range.max);
        const lows = stats.filter(t => t.final === range.min);

        let moved = false;

        // محاولة 1: تبديل guard↔guard
        for (const high of highs) {
            for (const low of lows) {
                const swap = tryGuardSwap(rows, high, low, options, halfdayLimits);
                if (swap) { applyGuardSwap(rows, swap, high, low); moved = true; break; }
            }
            if (moved) break;
        }

        // محاولة 2: تبديل guard↔reserve إن فعّل
        if (!moved && options.enableReserveRebalance) {
            for (const high of highs) {
                for (const low of lows) {
                    const swap = tryGuardReserveSwap(rows, high, low, options, halfdayLimits);
                    if (swap) { applyGuardReserveSwap(rows, swap, high, low); moved = true; break; }
                }
                if (moved) break;
            }
        }

        // محاولة 3: تبديل ثلاثي إن فعّل
        if (!moved && options.enableThreeWaySwap) {
            for (const high of highs) {
                for (const low of lows) {
                    const swap = tryThreeWaySwap(rows, high, low, options, halfdayLimits);
                    if (swap) { applyThreeWaySwap(rows, swap, high, low); moved = true; break; }
                }
                if (moved) break;
            }
        }

        if (!moved) break;
        loadState = buildAutoLoadStateFromRows(rows, true);
        range = getLoadRange(loadState, 'final');
    }

    return { loadState, range, movedCount: notes.length, unresolved: range.diff > 1, iterations };
}
```

#### 3.5 معايير القبول للمرحلة 3

- [ ] حالة لا يحلّها التّبديل الثّنائي تُحلّ بالثّلاثي.
- [ ] التّبديل بين guard وreserve يُسجَّل في `row.notes` بصيغة `تسوية: حراسة ↔ احتياط`.
- [ ] لا يتجاوز عدد التّكرارات `MAX_ITER` لأيّ سيناريو واقعي.

---

### 🔥 المرحلة 4 — إعادة توازن مخصّصة للاحتياط

**الهدف:** عند الانتهاء من تعيين الاحتياط، إن بقي `finalDiff > 1` تُجرى دورة ثانية تستبدل المرتفعين بالمنخفضين.

#### 4.1 الدّالة الجديدة

```js
function rebalanceReserveAssignments(rows, options, halfdayLimits) {
    let loadState = buildAutoLoadStateFromRows(rows, true);
    let range = getLoadRange(loadState, 'final');
    const moves = [];
    let iter = 0;

    while (range.diff > 1 && iter < 200) {
        iter++;
        const stats = buildPerTeacherStats(loadState);
        const highs = stats.filter(t => t.final === range.max);
        const lows = stats.filter(t => t.final === range.min);

        let moved = false;
        for (const high of highs) {
            for (const row of rows) {
                const reserveIdx = (row.reserve_keys || []).indexOf(high.exKey);
                if (reserveIdx < 0) continue;
                for (const low of lows) {
                    if (!canAssignReserveToRow(row, reserveIdx, low, rows, options, halfdayLimits)) continue;
                    applyReserveSwap(rows, row, reserveIdx, high, low);
                    moves.push(`${high.name} ← ${low.name}`);
                    moved = true;
                    break;
                }
                if (moved) break;
            }
            if (moved) break;
        }

        if (!moved) break;
        loadState = buildAutoLoadStateFromRows(rows, true);
        range = getLoadRange(loadState, 'final');
    }

    return { loadState, range, movedCount: moves.length, unresolved: range.diff > 1 };
}
```

#### 4.2 الدّالة المساعدة `canAssignReserveToRow`

نسخة مماثلة لـ `canAssignGuardToRow` مع منع وقوع الأستاذ في `proctor_keys` لنفس الصّفّ.

#### 4.3 الاستدعاء في `runAutoDistribution`

أضف بعد إسناد الاحتياط (بعد السّطر 3279):

```js
if (options.enableReserveRebalance) {
    const reserveRepair = rebalanceReserveAssignments(result, options, halfdayLimits);
    if (reserveRepair.unresolved) {
        result[0].notes = [result[0].notes, 'تعذّر إنهاء توازن الاحتياط'].filter(Boolean).join('، ');
    }
}
```

#### 4.4 معايير القبول للمرحلة 4

- [ ] في اختبار 4 (`4,4,3,3` + 2 احتياط) تكون النّتيجة النّهائية `4,4,4,4`.
- [ ] إن تعذّر، تظهر ملاحظة في الصّفّ الأوّل بسبب التّعذّر.

---

### ⚡ المرحلة 5 — قيود صلبة قابلة للتّفعيل

**الهدف:** السّماح للمستخدم بترقية القيود الرّخوة (تخصّص المادّة، تكرار القاعة) إلى صلبة عند توفّر التّجمّعات.

#### 5.1 إضافة الخيارين

```html
<!-- في panel-proctors > dist-sub-auto-distribute -->
<label><input type="checkbox" id="auto-rule-hard-specialty"> منع صارم لتكليف الأستاذ في تخصّصه</label>
<label><input type="checkbox" id="auto-rule-hard-room-repeat"> منع صارم لتكرار نفس القاعة</label>
<label>بذرة عشوائية: <input type="text" id="auto-rule-seed" placeholder="فارغ = عشوائي"></label>
```

#### 5.2 التّعديل في `getEligibleProctors`

أضف قبل `return true` (السّطر 2741):

```js
if (options.hardAvoidSubjectSpecialty &&
    proctorMatchesDutySubject(item.proc, scheduleEntry.subject_name || '')) return false;
if (options.hardAvoidSameRoomRepeat && roomKey &&
    roomUseMap[roomKey] && roomUseMap[roomKey].has(item.exKey)) return false;
```

#### 5.3 تنبيه ما قبل التّشغيل

في `renderMorningEveningFeasibilityNote` أو دالّة جاهزية مماثلة، أضف فحصاً:

```js
function checkHardConstraintsFeasibility(options, scheduleEntries) {
    if (!options.hardAvoidSubjectSpecialty && !options.hardAvoidSameRoomRepeat) return null;
    // عدّ التّجمّعات المتوقّعة لكلّ حصّة بعد تطبيق القيود الصّلبة
    // وأرجع تحذيراً إذا قلّ التّجمّع عن proctorsPerRoom
}
```

#### 5.4 معايير القبول للمرحلة 5

- [ ] عند تفعيل `hardAvoidSubjectSpecialty`، لا يظهر أيّ أستاذ تخصّصه = مادّة الإجراء في صفوفه.
- [ ] إن كانت القيود غير ممكنة، يظهر تحذير قبل تشغيل التّوزيع.

---

### 💡 المرحلة 6 — التّشخيص وقابلية إعادة الإنتاج

#### 6.1 بذرة عشوائية مضبوطة

```js
function buildSeededRandom(seedString) {
    if (!seedString) return Math.random;
    let h = 1779033703 ^ seedString.length;
    for (let i = 0; i < seedString.length; i++) {
        h = Math.imul(h ^ seedString.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function() {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
}
```

استبدل في `runAutoDistribution` (السّطر 3181):

```js
const rng = buildSeededRandom(options.distributionSeed);
for (var ri = rooms.length - 1; ri > 0; ri--) {
    var rj = Math.floor(rng() * (ri + 1));
    // ... باقي shuffle
}
```

#### 6.2 ترتيب القاعات بالشُّحّ (Most Constrained Variable)

استبدل الـshuffle العشوائي بترتيب قائم على عدد المرشّحين الصّالحين لكلّ قاعة:

```js
function sortRoomsByConstraintTightness(rooms, scheduleEntry, loadState, options) {
    return rooms.slice().sort((a, b) => {
        const ca = countEligibleForRoom(a, scheduleEntry, loadState, options);
        const cb = countEligibleForRoom(b, scheduleEntry, loadState, options);
        return ca - cb; // الأقلّ مرشّحين أوّلاً
    });
}
```

> يبقى الـshuffle خياراً للحفاظ على التّوافق الخلفي إن طُلب (`options.useMCV = true` افتراضياً).

#### 6.3 معامل Gini ولوحة تشخيص

```js
function computeGiniCoefficient(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((s, v) => s + v, 0);
    if (sum === 0) return 0;
    let cum = 0;
    sorted.forEach((v, i) => { cum += (i + 1) * v; });
    return (2 * cum) / (n * sum) - (n + 1) / n;
}

function getFairnessReport(loadState) {
    const finals = proctorsList.map((p, i) =>
        getTeacherFinalLoad(loadState, getProctorExemptionKey(p, i)));
    return {
        gini: computeGiniCoefficient(finals),
        primaryRange: getLoadRange(loadState, 'primary'),
        finalRange: getLoadRange(loadState, 'final'),
        guardRange: getLoadRange(loadState, 'guard'),
        perTeacher: buildAutoDistributionSummary(loadState).perTeacher
    };
}
```

#### 6.4 عرض في الواجهة

أضف في `renderAutoDistributionSummary`:

```js
const report = getFairnessReport(loadState);
box.innerHTML += `
    <div style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap">
        <span><strong>Gini:</strong> ${report.gini.toFixed(3)}</span>
        <span><strong>تكرارات الإصلاح:</strong> ${rebalanceIterations}</span>
        ${distributionSeedUsed ? `<span><strong>البذرة:</strong> ${distributionSeedUsed}</span>` : ''}
    </div>`;
```

#### 6.5 معايير القبول للمرحلة 6

- [ ] تشغيلان متعاقبان بنفس البذرة يعطيان نفس النّتيجة.
- [ ] قيمة Gini تظهر للمستخدم وتنخفض بعد إعادة التّوازن.

---

## 4. تسلسل التّنفيذ

```text
[المرحلة 1] حصّة شخصية              ← تأثير عالٍ، مخاطر منخفضة، يبدأ أوّلاً
       ↓
[المرحلة 2] توحيد balanceTotalTasks  ← مرتبطة بالمرحلة 1، تنظيف
       ↓
[المرحلة 4] توازن الاحتياط            ← يكمل المرحلة 1
       ↓
[المرحلة 3] تبديل متعدّد الأدوار      ← يكمل ما لم تحلّه المراحل السّابقة
       ↓
[المرحلة 5] قيود صلبة                 ← مستقلّة، اختيارية للمستخدم
       ↓
[المرحلة 6] تشخيص + بذرة + MCV       ← تجربة مستخدم وجودة
```

كلّ مرحلة قابلة للنّشر مستقلّة.

---

## 5. خطّة الاختبارات

### 5.1 اختبارات وحدة (Unit Tests)

ستضاف في `tests/unit/exams-proctors-fairness.test.js` (إن لم يوجد، يُنشأ):

| رقم | الاختبار | المتوقّع |
|---|---|---|
| U1 | `buildPerTeacherQuota` لـ 6 أساتذة و 18 حراسة و 3 مداومة | كلّ أستاذ بدون مداومة: cap=3؛ أستاذ بـ 3 مداومات: cap=0 أو 1 |
| U2 | `computeGiniCoefficient([3,3,3,3])` | 0 |
| U3 | `computeGiniCoefficient([0,0,0,12])` | ≈ 0.75 |
| U4 | `tryGuardSwap` مع تجمّع مغلق | يُرجع `null` |
| U5 | `buildSeededRandom('abc')` | تشغيلان يعطيان نفس التّسلسل |
| U6 | `rebalanceReserveAssignments` لحالة 4,4,3,3 + 2 احتياط | 4,4,4,4 |
| U7 | `getEligibleProctors` مع `hardAvoidSubjectSpecialty` | تستبعد أستاذ التّخصّص |

### 5.2 اختبارات تكامل (مستندة إلى الخطّة المرجعية §13)

استنادا إلى Tests 1–5 من الخطّة المفاهيمية:

| الاختبار | الحجم | معيار النّجاح |
|---|---|---|
| T1 — توزيع عادي | 10 أ × 20 ح × 5 م × 5 احتياط | `primaryDiff ≤ 1` و `finalDiff ≤ 1` |
| T2 — مداومة مكثّفة على أستاذ | 1 أستاذ بـ 3 م، 9 آخرون بدون | حراسة الأستاذ ≤ متوسّط ناقص 3 |
| T3 — خصاص في مجموعة | المجموعة 1 < الحاجة | خروج عن المجموعة مسجّل، `primaryDiff` يظلّ ≤ 1 إن أمكن |
| T4 — تسوية بالاحتياط | 4,4,3,3 + 2 احتياط | 4,4,4,4 |
| T5 — تعذّر التّساوي | إعفاءات مكثّفة | ملاحظة سبب التّعذّر ظاهرة |
| T6 — قابلية الإعادة | بذرة `"test123"` تشغيلان | نفس النّتيجة بايت ببايت |
| T7 — قيد صلب للتّخصّص | تشغيل مع `hardAvoidSubjectSpecialty` | لا يظهر أستاذ تخصّصه = مادّة |

### 5.3 اختبارات اختراقية (Regression)

- [ ] فتح ملفّ `examAutoDistributionData` محفوظ من نسخة قديمة، التّأكّد من عدم انكسار العرض.
- [ ] التّوزيع بـ `proctorsPerRoom = 1` و `reservesPerSession = 0`.
- [ ] التّوزيع بدون أيّ مداومة مسجّلة.

### 5.4 الأوامر المُقترحة للمستخدم

```bash
# اختبارات الوحدة (إن وُجد setup)
npm test -- exams-proctors-fairness

# Lint
npm run lint -- exams-proctors.html

# تشغيل التطبيق محلّياً
npm start
```

---

## 6. المخاطر والتّقييدات

| المخاطرة | الاحتمال | التّأثير | التّخفيف |
|---|---|---|---|
| تعطّل التّوافق مع البيانات المحفوظة | منخفض | متوسّط | إبقاء `buildGuardQuota` القديمة، عدم تغيير شكل صفوف `result` |
| ارتفاع زمن التّنفيذ مع الثّلاثي | متوسّط | منخفض | حدّ أعلى `MAX_ITER = 500`، خيار تعطيل |
| كسر اختبارات قائمة | منخفض | عالٍ | تشغيل مجموعة Regression قبل كلّ Push |
| تشويش المستخدم بكثرة الخيارات | متوسّط | منخفض | إخفاء الخيارات المتقدّمة خلف "إعدادات متقدّمة" |
| تغيير نتائج توزيع موجودة فجأة | عالٍ | متوسّط | تنبيه المستخدم في أوّل تشغيل بعد التّحديث، وتوفير زرّ "العودة إلى المنطق القديم" |

---

## 7. خطّة التّراجع

كلّ مرحلة محميّة عبر:

1. **Feature flag** في `AUTO_DISTRIBUTION_OPTION_DEFAULTS`:
   ```js
   useNewFairnessEngine: true  // إن جُعل false يُستعمل المنطق القديم
   ```
2. **حفظ النّسخة القديمة** عبر `git tag pre-fairness-v1` قبل البدء.
3. **عدم حذف** أيّ دالّة قديمة في المراحل 1-4؛ فقط تعميمها.
4. **نقطة استرجاع** بعد كلّ مرحلة في `git`.

---

## 8. التّأثير على وحدات أخرى

### 8.1 لا تأثير متوقّع على:

- IPC channels (`window.api.*`)
- قاعدة البيانات (`system_tags`, `staff`...)
- نظام المزامنة (`main/sync/*`)

### 8.2 تأثير محتمل على:

- `localStorage`:
  - `examAutoDistributionData` → نفس الشّكل.
  - `examAutoDistributionOptions` → خيارات إضافية اختيارية.
- الواجهة: ثلاث خانات اختيار جديدة + حقل بذرة + لوحة تشخيص.

---

## 9. معايير القبول النّهائية

التّسليم مقبول عندما:

1. ✅ كلّ اختبارات الوحدة (U1-U7) تنجح.
2. ✅ كلّ اختبارات التّكامل (T1-T7) تنجح.
3. ✅ في 90% من السّيناريوهات الواقعية (10 سيناريوهات نموذجية)، `finalDiff ≤ 1`.
4. ✅ معامل Gini ≤ 0.10 في السّيناريوهات الممكنة هندسياً.
5. ✅ زمن التّنفيذ لـ 50 أستاذ × 100 حصّة ≤ 5 ثوان على جهاز متوسّط.
6. ✅ التّوافق الكامل مع البيانات المحفوظة قبل التّحديث.
7. ✅ توثيق المستخدم محدَّث في `docs/user-guide/` (إن وُجد).
8. ✅ وثيقة Changelog محدَّثة.

---

## 10. الجدول الزّمني المقترح

| المرحلة | مدّة تقديرية | مسؤولية |
|---|---|---|
| المرحلة 1 — حصّة شخصية | يوم واحد | مطوّر رئيسي |
| المرحلة 2 — توحيد balanceTotalTasks | نصف يوم | مطوّر رئيسي |
| المرحلة 4 — توازن الاحتياط | يوم واحد | مطوّر رئيسي |
| المرحلة 3 — تبديل متعدّد الأدوار | يومان | مطوّر رئيسي |
| المرحلة 5 — قيود صلبة | نصف يوم | مطوّر + UX |
| المرحلة 6 — تشخيص + بذرة + MCV | يوم واحد | مطوّر |
| الاختبارات والتّوثيق | يوم واحد | QA |
| **الإجمالي** | **7 أيام عمل** | |

---

## 11. ملاحظات تنفيذية

1. **عدم تعديل أيّ سلوك خارج `exams-proctors.html`** في هذه الخطّة.
2. **الاحتفاظ بأسماء الدّوال القديمة** ولو أصبحت Wrappers، لتفادي كسر استدعاءات داخلية.
3. **إضافة تعليقات JSDoc** للدّوال الجديدة لتسهيل الصّيانة لاحقاً.
4. **تجنّب أيّ تغيير في شكل البيانات المحفوظة** (`row.proctor_keys`, `row.reserve_keys`, إلخ).
5. **استشارة المستخدم** قبل تفعيل أيّ خيار افتراضياً يغيّر النّتائج المتوقّعة.

---

## 12. ملخّص القرار

- خمس خطوات مرتّبة بالأولوية (1 → 2 → 4 → 3 → 5 → 6).
- كلّ خطوة قابلة للتّسليم وحدها وللتّراجع.
- الأثر الأعلى: المرحلة 1 (حصّة شخصية).
- الإغلاق الكامل للفجوة: المرحلتان 3 و 4.
- التّجربة والشّفافية: المرحلتان 5 و 6.

> *الخوارزمية الجديدة لا تستبدل الفلسفة الحالية بل تكمّلها: الموازنة بين الأدوار الثّلاثة (مداومة، حراسة، احتياط) عبر حصّة شخصية ومراحل تسوية مرتّبة.*
