# المرحلة 1 — جرد البنية الحالية لبيانات مركز الامتحان

> وثيقة مرجعية تسبق أي تنفيذ. تصف كل مفتاح تخزين، شكل بياناته، من يقرأه، من يكتبه، وأين.

---

## 1. آلية التخزين

كل مفاتيح الامتحان مخزنة في جدول `exam_config_data` في SQLite:

```sql
exam_config_data (school_year TEXT, config_key TEXT, data_json TEXT, updated_at TEXT)
-- UNIQUE(school_year, config_key)
```

الوصول عبر IPC (`main/ipc/exam-config-data.js`):
- `window.api.examConfig.get(year, key)` → قراءة
- `window.api.examConfig.save({ school_year, config_key, data })` → كتابة (upsert)
- `window.api.examConfig.delete({ school_year, config_key })` → حذف
- `window.api.examConfig.getAll(year)` → قراءة كل المفاتيح

المفاتيح المسموح بها (VALID_CONFIG_KEYS):
```
examCenterConfig, examCenterLevels, examCenterRoomsData,
examCenterRoomsCount, examScheduleData, examAutoDistributionData,
examPeriodsData, examDistributionRules, examExemptionsData,
examDutyTeachersData, examMorningEveningData,
examAutoDistributionOptions, examCandidatesData
```

### الترحيل من localStorage

كلا الصفحتين (`exams-schedule.html` و `exams-proctors.html`) تحتويان على دالة `migrateExamLocalStorageToDb()` تنقل البيانات من localStorage إلى DB عند أول تحميل.

### مصادر بيانات خارج `exam_config_data`

بعض البيانات الأساسية للخوارزمية لا تمر عبر `exam_config_data`:

| المصدر | الدالة | البيانات |
|--------|--------|----------|
| `window.api.examProctors.getAll(year)` | `loadProctors()` في `exams-proctors.html:6047` | قائمة المراقبين (`proctorsList`) — مخزنة في جدول DB مستقل |
| `window.api.examProctors.delete(id)` | حذف مراقب | — |
| `window.api.examProctors.deleteAll(year)` | حذف كل المراقبين | — |

`input.proctorsList` التي تعتمد عليها الخوارزمية مصدرها `examProctors` وليس `examConfig`.

---

## 2. المفاتيح الأربعة الأساسية

### 2.1 `examCenterConfig`

**الدور:** إعدادات المركز العامة (اسم الامتحان، الشهر، السنة، نوع الدورة، القواعد العامة).

**شكل البيانات:**
```js
{
  exam_name: "الامتحان الجهوي",
  exam_month: "6",
  exam_year: "2026",
  session_type: "العادية",
  exam_type: "جهوي",
  supervisor_arrival_time: "30",      // دقائق قبل الامتحان
  candidate_arrival_time: "30",
  supervision_term: "",
  supervisors_per_room: 2,            // عدد المراقبين لكل قاعة
  max_reserves: 4,                    // عدد الاحتياطيين (وضع ثابت)
  max_reserves_mode: "fixed|percent", // وضع الاحتياط
  max_reserves_percent: 20,           // نسبة الاحتياط (وضع نسبة)
  expected_duty_tasks: 5              // المهام المتوقعة للإنصاف
}
```

**من يكتبه:**

| الملف | الدالة | ماذا يكتب |
|-------|--------|-----------|
| `exams-schedule.html:924` | `initExamForm()` submit | **يكتب كائنا جديدا بالكامل بدون merge** مع القيمة الحالية (exam_name, exam_month, supervisors_per_room, max_reserves...) |
| `exams-proctors.html:1264` | `btn-save-quick-rules` click | `expected_duty_tasks` فقط (يقرا الباقي ويحافظ عليه عبر merge) |

**من يقرأه:**

| الملف | الدالة | ماذا يقرأ |
|-------|--------|-----------|
| `exams-schedule.html:874` | `initExamForm()` | كل الحقول لملء النموذج |
| `exams-proctors.html:1191` | `loadBannerFromConfig()` | `exam_name`, `exam_month`, `exam_year` |
| `exams-proctors.html:1575` | `getExamConfig()` | الكائن كاملا |
| `exams-proctors.html:1580` | `getDistributionRules()` | `supervisors_per_room`, `max_reserves`, `max_reserves_mode`, `max_reserves_percent` (كـ fallback) |
| `exams-proctors.html:1619` | `initDistributionRulesPanel()` | `expected_duty_tasks` |
| `exams-proctors.html:2744` | `buildV2Input()` | `max_reserves_mode`, `max_reserves`, `max_reserves_percent`, `expected_duty_tasks` |
| `exams-proctors.html:2906` | `buildV3Input()` | الكائن كاملا ← `input.examCenterConfig` |
| `exams-proctors.html:5707,5893,6594` | دوال الملخص والطباعة | حقول متفرقة |
| `exams-rooms.html:1624` | دالة الطباعة | الكائن كاملا |
| `proctor-v3/phases/03-bounds.js:93` | `computeBounds()` | `expected_duty_tasks` |
| `proctor-v3/phases/09-place-reserves.js:180` | `resolveReserveCap()` | `max_reserves_mode`, `max_reserves`, `max_reserves_percent` |

**ملاحظات:**
- يُكتب من صفحتين مختلفتين: `exams-schedule` (الحقول الكاملة) و `exams-proctors` (`expected_duty_tasks` فقط).
- الخوارزمية تقرأه مباشرة في `input.examCenterConfig`.

---

### 2.2 `examPeriodsData`

**الدور:** فترات الامتحان (مثلا: الفترة الاولى من 10 يونيو إلى 12 يونيو).

**شكل البيانات:**
```js
[
  { name: "الفترة الأولى", date_from: "2026-06-10", date_to: "2026-06-12" },
  { name: "الفترة الثانية", date_from: "2026-06-14", date_to: "2026-06-16" }
]
// مصفوفة من كائنات { name, date_from, date_to }
```

**من يكتبه:**

| الملف | الدالة | العملية |
|-------|--------|---------|
| `exams-proctors.html:1697` | `savePeriod()` | اضافة/تعديل فترة |
| `exams-proctors.html:1788` | `deletePeriod()` | حذف فترة (يحفظ المصفوفة بعد splice) |
| `exams-proctors.html:1800` | `clearAllPeriods()` | حذف المفتاح بالكامل |

**من يقرأه:**

| الملف | الدالة | الاستعمال |
|-------|--------|-----------|
| `exams-proctors.html:1210` | `initDistSettings()` refresh button | تحديث `periodsList` |
| `exams-proctors.html:1300` | `updateDistStatuses()` | التحقق من وجود فترات |
| `exams-proctors.html:1395` | `renderPlanningReadiness()` | عرض ملخص الجاهزية |
| `exams-proctors.html:1650` | `initPeriodsPanel()` | ملء جدول الفترات |

**ملاحظات:**
- يُكتب ويُقرأ فقط من `exams-proctors.html`.
- حسب الخطة الجديدة، يجب أن ينتقل التحرير إلى `exams-schedule.html`. هذا هدف مستقبلي وليس حالة حالية.
- **قرار مطلوب:** هل تبقى الفترات في مفتاح `examPeriodsData` المستقل (وتنتقل واجهة تحريرها فقط)؟ أم تُدمج داخل `examScheduleData`؟ وما ترتيب fallback؟ وهل يُكتب migration أم مجرد reader fallback؟
- الخوارزمية لا تقرأ هذا المفتاح مباشرة — الفترات تمر عبر `scheduleEntries`.

---

### 2.3 `examDistributionRules`

**الدور:** قواعد التوزيع (عدد المراقبين/قاعة، الاحتياط، اصدار الخوارزمية).

**شكل البيانات:**
```js
{
  proctorsPerRoom: 2,           // عدد المراقبين في كل قاعة
  reservesPerSession: 0,        // عدد الاحتياط لكل حصة (وضع ثابت legacy)
  reservesMode: "fixed|percent", // وضع الاحتياط
  reservesPercent: 20,           // نسبة الاحتياط
  algorithmVersion: "v2|v3|v1", // اصدار الخوارزمية
  allowSameDayBothHalfdays: false // السماح بنفس اليوم صباحا ومساء
}
```

**من يكتبه:**

| الملف | الدالة | العملية |
|-------|--------|---------|
| `exams-proctors.html:1261` | `btn-save-quick-rules` | `proctorsPerRoom`, `reservesPerSession` أو `reservesPercent` |
| `exams-proctors.html:1643` | `saveDistributionRule()` | حقل واحد في كل مرة |
| `exams-proctors.html:2620` | `runAutoDistributionV2()` | `algorithmVersion` |
| `exams-proctors.html:3068` | دالة relaxed retry | `allowSameDayBothHalfdays` |

**من يقرأه:**

| الملف | الدالة | الاستعمال |
|-------|--------|-----------|
| `exams-proctors.html:1580` | `getDistributionRules()` | دمج مع `examCenterConfig` كـ fallback |
| `exams-proctors.html:2763` | `buildV2Input()` | `input.examDistributionRules` للخوارزمية |
| `proctor-v2.js:1836` | الخوارزمية v2 | قراءة `proctorsPerRoom`, `reservesPerSession` |
| `proctor-v3/*/00-validate.js:128` | التحقق v3 | حقل مطلوب |
| `proctor-v3/*/04-place-guards.js:491` | وضع الحراس | `allowSameDayBothHalfdays` |
| `proctor-v3/*/09-place-reserves.js:192` | الاحتياط | `reservesPerSession` (legacy fallback) |
| `proctor-v3/*/01b-build-rooms-and-rows.js:201` | بناء القاعات | `proctorsPerRoom` |

**ملاحظات:**
- **أهم مفتاح** — تقرأه الخوارزمية (v2 وv3) مباشرة.
- يوجد تداخل مع `examCenterConfig`: كلاهما يحتوي `supervisors_per_room` / `proctorsPerRoom` و`max_reserves` / `reservesPerSession`. الدالة `getDistributionRules()` تدمج بينهما مع أسبقية `examDistributionRules`.
- `allowSameDayBothHalfdays` يُستعمل في 6 أماكن في الخوارزمية.

---

### 2.4 `examDutyTeachersData`

**الدور:** تعيين الاساتذة المداومين لكل حصة/مادة.

**شكل البيانات:**
```js
{
  "sessionKey|subject": {       // مفتاح = حصة + مادة
    "proctorKey1": true,        // الاستاذ معين كمداوم
    "proctorKey2": true
  },
  "الثلاثاء|صباحا|2|الرياضيات": {
    "teacher_0": true,
    "teacher_3": true
  }
}
// كائن من كائنات: كل مفتاح خارجي = حصة|مادة، كل مفتاح داخلي = استاذ
```

**من يكتبه:**

| الملف | الدالة | العملية |
|-------|--------|---------|
| `exams-proctors.html:2121` | `saveDutyTeachers()` | حفظ المداومين المحددين |
| `exams-proctors.html:2133` | `clearCurrentDuty()` | حذف المداومين من حصة |

**من يقرأه:**

| الملف | الدالة | الاستعمال |
|-------|--------|-----------|
| `exams-proctors.html:1298` | `updateDistStatuses()` | التحقق من وجود مداومين |
| `exams-proctors.html:1953` | `initDutyPanel()` | ملء واجهة المداومة |
| `exams-proctors.html:2761` | `buildV2Input()` | `input.dutyData` للخوارزمية |
| `exams-proctors.html:5067` | دالة ملخص | عرض المداومين |
| `proctor-v2.js:751` | الخوارزمية | تحويل المفاتيح الخارجية |

**ملاحظات:**
- يوجد نظام مفتاح قديم (legacy) ومفتاح جديد (canonical). الدالة `renderDutyTable()` تقرا كليهما وتدمج.
- عند الحفظ، يحذف المفتاح القديم (`legacySessionKey`) ويحفظ بالمفتاح الجديد فقط.

---

## 3. مفاتيح تخزين اضافية ذات صلة

| المفتاح | الشكل الفعلي | الدور | يُكتب من | يُقرأ من |
|---------|-------------|-------|---------|---------|
| `examCenterLevels` | `[{name, subjects: [{name, type, duration}], rooms}]` | المستويات والمواد وعدد القاعات | `exams-schedule` | كلا الصفحتين + الخوارزمية |
| `examCenterRoomsData` | `{"المستوى__رقم": {roomName, wing, firstNum, lastNum, count}}` | بيانات القاعات (flat map) | `exams-schedule` | `exams-proctors` + الخوارزمية |
| `examCenterRoomsCount` | `number` (رقم واحد وليس كائنا) | عدد القاعات العام | `exams-schedule` | `exams-proctors` |
| `examScheduleData` | `{[levelName]: [{subject_name, day, date_day, period, session, time_from, time_to}]}` | جدول الامتحان (كائن مفهرس بالمستوى) | **`exams-proctors`** | `exams-proctors` + `exams-rooms` + الخوارزمية |
| `examExemptionsData` | `{contextKey: {proctorKey: true}}` | الاعفاءات | `exams-proctors` | `exams-proctors` + الخوارزمية |
| `examMorningEveningData` | `{proctorKey: 1\|2}` | تفضيل صباح/مساء | `exams-proctors` | `exams-proctors` + الخوارزمية |
| `examAutoDistributionData` | `{rows, algorithmVersion, diagnostics}` | نتيجة التوزيع | `exams-proctors` | كل الصفحات |
| `examAutoDistributionOptions` | `{allowHalfdayReuse, ...}` | خيارات التوزيع | `exams-proctors` | `exams-proctors` |
| `examCandidatesData` | `[{...}]` | بيانات المترشحين | `exams-proctors` | `exams-proctors` + `exams-rooms` |

**ملاحظات مهمة حول الاشكال:**
- `examCenterLevels` لا يحتوي حقول `official` أو `free` أو `branches` — الشكل الفعلي هو `{name, subjects, rooms}` فقط. يُبنى في `exams-schedule.html:1060`.
- `examCenterRoomsData` ليس مصفوفة قاعات لكل مستوى — هو flat map بمفتاح `"المستوى__الرقم"` يحتوي بيانات خام (`roomName`, `wing`, `firstNum`, `lastNum`, `count`). التحويل إلى صفوف قاعات يحدث في `exams-proctors.html` عبر `getEffectiveRoomRowsForLevel()`.
- `examCenterRoomsCount` رقم عام واحد (`Number`)، وليس كائنا مفهرسا بالمستوى. يُحفظ في `exams-schedule.html:785`.
- `examScheduleData` كائن مفهرس باسم المستوى وليس مصفوفة مسطحة. الدالة `getScheduleEntries()` في `exams-proctors.html:1382` تحوّله الى مصفوفة مسطحة باضافة حقل `level_name`.
- `examScheduleData` يُكتب حصريا من `exams-proctors.html` (دوال `saveScheduleData()` سطر 5996 و`resetScheduleData()` سطر 6012). `exams-schedule.html` لا يكتبه حاليا الا ضمن ترحيل localStorage.

---

## 4. خريطة الدوال الرئيسية

### صفحة البرمجة (`exams-schedule.html`)

| الدالة | الدور | المفاتيح |
|--------|-------|----------|
| `initExamForm()` | نموذج اعداد الامتحان | يقرأ/يكتب `examCenterConfig` |
| `initBranchesPanel()` | المستويات والشعب | `examCenterLevels` |
| `initRoomsPanel()` / `saveRoomsData()` | قاعات الامتحان | `examCenterRoomsData`, `examCenterRoomsCount` |
| `migrateExamLocalStorageToDb()` | ترحيل localStorage | كل المفاتيح |

> **ملاحظة:** `exams-schedule.html` لا يحتوي حاليا على `initSchedulePanel()` ولا يكتب `examScheduleData`. نقل الجدولة اليها هدف مستقبلي.

### صفحة التوزيع (`exams-proctors.html`)

| الدالة | الدور | المفاتيح |
|--------|-------|----------|
| `loadBannerFromConfig()` | عرض اسم الامتحان | `examCenterConfig` (قراءة) |
| `getDistributionRules()` | دمج قواعد التوزيع | `examDistributionRules` + `examCenterConfig` |
| `getExamConfig()` | قراءة الاعدادات العامة | `examCenterConfig` |
| `initPeriodsPanel()` | ادارة الفترات | `examPeriodsData` |
| `initExemptionsPanel()` | ادارة الاعفاءات | `examExemptionsData` |
| `initDutyPanel()` | ادارة المداومة | `examDutyTeachersData` |
| `initDistributionRulesPanel()` | عرض قواعد التوزيع | `examDistributionRules` + `examCenterConfig` |
| `initMorningEveningPanel()` | تفضيل صباح/مساء | `examMorningEveningData` |
| `initSchedulePanel()` (سطر 5701) | **ادارة جدول الامتحان** | `examScheduleData` (قراءة/كتابة) |
| `saveScheduleData()` (سطر 5996) | حفظ الجدولة لمستوى | `examScheduleData` |
| `buildV2Input()` | **بناء مدخلات الخوارزمية** | يقرأ كل المفاتيح تقريبا |
| `buildV3Input()` | بناء مدخلات v3 | يستدعي `buildV2Input()` + يضيف `allowSameDayBothHalfdays` |
| `runAutoDistributionV2()` | تشغيل التوزيع | يستدعي `buildV2Input()` |
| `saveV2ResultToLocalStorage()` | حفظ النتيجة (الاسم legacy فقط — التخزين الفعلي SQLite عبر IPC) | `examAutoDistributionData` |
| `renderPlanningReadiness()` | ملخص الجاهزية | `examPeriodsData`, `examScheduleData`, اخرى |
| `updateDistStatuses()` | تحديث حالات الخطوات | كل المفاتيح |
| `loadProctors()` (سطر 6045) | تحميل المراقبين | `window.api.examProctors.getAll()` (خارج exam_config_data) |

### صفحة الطباعة (`exams-rooms.html`)

| الدالة | الدور | المفاتيح |
|--------|-------|----------|
| دالة الطباعة (سطر 1624) | طباعة التكليفات | `examCenterConfig` (قراءة) |
| قراءة الجدولة (سطر 737) | عرض بيانات الجدول | `examScheduleData` (قراءة) |

### الخوارزمية (`proctor-distribution-v2.js` + `proctor-v3/`)

| المدخل | المصدر |
|--------|--------|
| `input.proctorsList` | `window.api.examProctors.getAll()` (خارج `exam_config_data`) |
| `input.scheduleEntries` | `examScheduleData` عبر `getScheduleEntries()` |
| `input.exemptionsData` | `examExemptionsData` |
| `input.dutyData` | `examDutyTeachersData` |
| `input.meAssignments` | `examMorningEveningData` |
| `input.examDistributionRules` | `examDistributionRules` (**مطلوب في v3**) |
| `input.examCenterConfig` | `examCenterConfig` (لـ `expected_duty_tasks`, `max_reserves_*`) |
| `input.reservesConfig` | مشتق من `examCenterConfig` مع fallback من `examDistributionRules` |
| `input.D_expected` | `examCenterConfig.expected_duty_tasks` |
| `input.options.roomsList` | `examCenterRoomsData` + `examCenterLevels` |

---

## 5. أخطاء فعلية (Bugs) مكتشفة

### 5.1 BUG: حذف `expected_duty_tasks` عند حفظ نموذج الامتحان

**الحالة:** مؤكدة وفعّالة حاليا.

`exams-schedule.html:910-924` يبني كائن `config` جديدا من حقول النموذج ويكتبه بالكامل الى `examCenterConfig` **بدون قراءة القيمة الحالية اولا**. لا يتضمن حقل `expected_duty_tasks` — لذلك يحذفه عند كل حفظ.

**الاثر:** اذا حدد المستخدم `expected_duty_tasks` من صفحة التوزيع، ثم عاد لصفحة البرمجة وحفظ النموذج، تضيع القيمة.

**الاصلاح المقترح (المرحلة 2):** قراءة `examCenterConfig` الحالية قبل الكتابة ودمج الحقول الجديدة فوقها (`Object.assign(existing, newFields)`).

### 5.2 BUG: اسقاط `allowSameDayBothHalfdays` من `getDistributionRules()`

**الحالة:** مؤكدة.

`getDistributionRules()` في `exams-proctors.html:1578-1596` يقرأ `examDistributionRules` ويبني كائنا جديدا يحتوي فقط:
```js
{ proctorsPerRoom, reservesPerSession, reservesMode, reservesPercent, algorithmVersion }
```

**لا يرجع** `allowSameDayBothHalfdays` رغم أنها محفوظة في نفس المفتاح.

**الاثر:** عندما يستدعي `btn-save-quick-rules` (سطر 1254-1261) دالة `getDistributionRules()` ثم يحفظ النتيجة، **يمسح** `allowSameDayBothHalfdays` من `examDistributionRules`. أي تشغيل لاحق قد يعيدها الى `false` رغم أن المستخدم وافق على السماح.

ملاحظة: `buildV3Input()` (سطر 2921-2929) يقرأ `input.examDistributionRules.allowSameDayBothHalfdays` مباشرة من الكائن الخام (عبر `buildV2Input()` سطر 2763 الذي يمرر `rules` كما هي)، لذلك يعمل بشكل صحيح **طالما لم يتم الحفظ عبر `getDistributionRules()`**.

**الاصلاح المقترح (المرحلة 2):** جعل `getDistributionRules()` يحافظ على الحقول الاضافية:
```js
allowSameDayBothHalfdays: saved.allowSameDayBothHalfdays === true
```

---

## 6. نقاط التداخل والتكرار (مشاكل يجب حلها في المرحلة 2)

### 6.1 تداخل `examCenterConfig` و `examDistributionRules`

| الحقل | في examCenterConfig | في examDistributionRules | من يربح؟ |
|-------|--------------------|-----------------------|----------|
| عدد المراقبين/قاعة | `supervisors_per_room` | `proctorsPerRoom` | `proctorsPerRoom` أولا (في `getDistributionRules()`) |
| عدد الاحتياط | `max_reserves` | `reservesPerSession` | `reservesPerSession` أولا |
| وضع الاحتياط | `max_reserves_mode` | `reservesMode` | `reservesMode` أولا |
| نسبة الاحتياط | `max_reserves_percent` | `reservesPercent` | `reservesPercent` أولا |

**المشكلة:** نفس القيمة مخزنة في مكانين. `exams-schedule` يكتب `examCenterConfig`، و`exams-proctors` يكتب `examDistributionRules`. يمكن أن تتعارض القيمتان.

### 6.2 الفترات والجدولة مملوكتان لصفحة التوزيع (وليس البرمجة)

- `examPeriodsData` تُكتب حصريا من `exams-proctors.html`.
- `examScheduleData` تُكتب حصريا من `exams-proctors.html` (دوال `initSchedulePanel`, `saveScheduleData`, `resetScheduleData`).
- `exams-schedule.html` لا يكتب ايا منهما حاليا (فقط ترحيل localStorage).
- حسب الخطة الجديدة، يجب نقلهما الى `exams-schedule.html` تدريجيا.

### 6.3 نظام المفاتيح المزدوج في `examDutyTeachersData`

يوجد `sessionKey` (جديد) و`legacySessionKey` (قديم). الكود يقرأ كليهما ويدمج، لكن يحفظ بالجديد فقط. هذا يعني أن البيانات القديمة ترحّل تدريجيا عند الحفظ.

### 6.4 اسم `saveV2ResultToLocalStorage()` مضلل

الدالة اسمها يشير الى localStorage لكنها تحفظ فعليا عبر `window.api.examConfig.save()` في SQLite. الاسم بقايا من قبل الترحيل.

---

## 7. ملخص القرارات المطلوبة قبل التنفيذ

| # | القرار | الاقتراح |
|---|--------|----------|
| 1 | أين يُحفظ `proctorsPerRoom` نهائيا؟ | `examCenterConfig` فقط (مصدر واحد)، مع fallback من `examDistributionRules` |
| 2 | أين يُحفظ عدد/نسبة الاحتياط نهائيا؟ | `examCenterConfig` فقط |
| 3 | هل تُنقل الفترات الى `exams-schedule`؟ | نعم. تبقى في مفتاح `examPeriodsData` المستقل وتنتقل واجهة تحريرها فقط. Reader fallback يقرأ من القيمة الحالية |
| 4 | هل تُنقل الجدولة الى `exams-schedule`؟ | نعم مستقبلا. حاليا `examScheduleData` مملوك لـ `exams-proctors` بالكامل |
| 5 | كيف نحمي `expected_duty_tasks`؟ | اصلاح Bug 5.1: merge قبل الكتابة في `exams-schedule` |
| 6 | كيف نحمي `allowSameDayBothHalfdays`؟ | اصلاح Bug 5.2: اضافة الحقل الى ما يرجعه `getDistributionRules()` |
| 7 | هل نحذف `examDistributionRules` مستقبلا؟ | لا الان — الخوارزمية v3 تتطلبه كحقل مطلوب. نبني طبقة قراءة موحدة |
| 8 | هل نوحد مفاتيح المداومة؟ | نعم تدريجيا — المفتاح الجديد يصبح المصدر |

---

## 8. الخطوة التالية

بناء `js/exam-data-readers.js` — وحدة قراءة موحدة تقرأ من البنية الجديدة أو القديمة (fallback)، وتُصدّر دوال مثل:

```js
ExamDataReaders.getCenterConfig(year)        // merge-safe: يقرأ ثم يدمج
ExamDataReaders.getPeriods(year)              // examPeriodsData (مفتاح مستقل، مصدر واحد)
ExamDataReaders.getDistributionRules(year)    // يدمج examDistributionRules + examCenterConfig + يحافظ على allowSameDayBothHalfdays
ExamDataReaders.getDutyTeachers(year)         // examDutyTeachersData (مفاتيح موحدة)
ExamDataReaders.getScheduleEntries(year)      // examScheduleData مسطحة مع level_name
ExamDataReaders.getReadinessStatus(year)      // ملخص الجاهزية
ExamDataReaders.buildAlgorithmInput(year)     // المدخلات الكاملة للخوارزمية
```

**قبل بناء هذه الوحدة يجب حسم القرارات 3-6 من القسم 7.**
