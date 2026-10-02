# Requirements Document — Proctor Distribution V3

## Introduction

تُحدّد هذه الوثيقة متطلبات بناء **خوارزمية توزيع المراقبين V3** كوحدة Node خالصة جديدة تحت `js/algorithms/proctor-v3/`، مكتوبة من الصفر بناءً على **مواصفة موحَّدة** للقيود تجمع كلّ ما تعلَّمناه من إصلاحات إحدى عشرة spec سابقة على V2 (`js/algorithms/proctor-distribution-v2.js`، 4788 سطراً).

كلّ إصلاح على V2 كشف طبقة أعمق من العيوب البنيوية: عدم تطابق DB↔Memory، ازدواجية شكل المفتاح، حدود غير قابلة للتحقيق للفئات المنفردة، عجز إصلاح التغطية متعدّد الخطوات، وغيرها. سبب هذه الدورة هو غياب مواصفة موحَّدة للقيود منذ البداية.

**الهدف**: إنتاج خوارزمية واحدة نظيفة، مُختبَرة بـ Property-Based Tests، فيها كلّ القيود ثابتة بنيوياً منذ التصميم.

**نطاق الـ requirements (هذه الوثيقة)**: تعريف القيود الصلبة، اللينة، الثوابت، عقد الإدخال/الإخراج، ومعايير القبول. **لا تشمل** اختيار الـ solver أو بنية الـ phases الداخلية — تلك قرارات `design.md`.

---

## Glossary

### مفاهيم نطاق الأعمال

- **Proctor (المراقب)**: أستاذ يُكلَّف بالحراسة في قاعات الامتحانات.
- **Schedule_Entry (جلسة)**: عنصر من `scheduleEntries` يحدّد: تاريخ، يوم (`الأول/الثاني/...`)، فترة (`صباحا/مساء`)، حصّة (`الحصة الأولى/...`)، مادّة، مستوى.
- **Halfday (نصف اليوم)**: زوج (تاريخ، فترة) — مثلاً "2026-06-04 صباحاً". قد يضمّ حصّة أو أكثر متتاليات زمنياً.
- **Day (اليوم)**: تاريخ كامل واحد. يضمّ halfday صباحياً وآخر مسائياً.
- **Session (الحصّة)**: حصّة امتحانية واحدة داخل halfday. الحصص داخل نفس الـ halfday **متتالية زمنياً وليست متزامنة**.
- **Room (القاعة)**: قاعة امتحان واحدة في المؤسسة، تستوعب عدداً معيَّناً من المترشحين.
- **Guard (حراسة)**: تكليف مراقب بقاعة معيَّنة في حصّة معيَّنة.
- **Reserve (احتياط)**: مراقب جاهز للتدخّل عند الضرورة في حصّة معيَّنة، بدون تكليف بقاعة محدَّدة.
- **Duty (المداومة)**: تكليف يدوي يحدّده المستخدم في "Duty Teachers Panel" بربط مراقب بحصّة معيَّنة بصفته مداوماً (يبقى متاحاً لخدمات إدارية لكنّه لا يحرس قاعة).
- **Manual_Exemption (ME)**: تكليف يدوي صريح من المستخدم في `meAssignments` يربط مراقباً بنصف-يوم/مجموعة محدَّدة، يُعامَل كقيد صلب.
- **Exemption (الإعفاء)**: حالة "غير متاح" لمراقب تجاه حصّة معيَّنة بسبب ظروف خاصة، يحدّدها المستخدم في `exemptionsData`.

### مفاهيم تقنية

- **System_V3**: مجموعة الوحدات المُنفَّذة في `js/algorithms/proctor-v3/`، تُصدَّر من `index.js` بدالّة وحيدة `run(input) → { result, diagnostics, algorithmVersion: 'v3' }`.
- **V2_Algorithm**: الخوارزمية القائمة في `js/algorithms/proctor-distribution-v2.js`، تبقى دون تعديل.
- **Orchestrator_V3**: الدالّة العليا في System_V3 التي تستدعي مراحل الخوارزمية بالترتيب وتُنتج النتيجة والتشخيصات.
- **Algorithm_Version_Flag**: حقل `algorithmVersion` المخزَّن في `examAutoDistributionData` بقيم `'v2'` أو `'v3'`.
- **V3_Toggle**: عنصر تحكّم في `exams-proctors.html` يسمح للمستخدم بالتبديل بين V2 و V3.
- **Canonical_Proctor_Key**: السلسلة الوحيدة التي تُمثّل هوية المراقب داخل V3، تُحتسب من `(proc, idx)` بالقاعدة:
  ```
  proc.cin && proc.cin.trim() ? proc.cin.trim() : '__idx_' + idx
  ```
  لا يوجد شكل ثانٍ للمفتاح داخل V3.
- **Key_Adapter**: دالّة وحيدة عند حدود الإدخال تُحوِّل أيّ مفتاح خارجي قادم من بيانات المُدخَل (دوام، إعفاءات، تكليفات يدوية) إلى Canonical_Proctor_Key، عبر بحث في `proctorsList`.
- **Halfday_Key**: مفتاح نصف اليوم بالشكل `${YYYY-MM-DD}|${period}` حيث `period ∈ {صباحا, مساء}`.
- **Day_Key**: مفتاح اليوم بالشكل `YYYY-MM-DD`.
- **Session_Key**: مفتاح الحصّة الفريد المُشتقّ من Schedule_Entry.
- **Result_Row**: صفّ نتيجة لكلّ (Schedule_Entry × قاعة) بالحقول: `session_key, halfday_key, day_key, room_key, room_name, proctors, proctor_keys, reserves, reserve_keys, duty_teachers, softViolations, notes`. متوافقة شكلياً مع V2.
- **Eligible_Proctor**: مراقب `T ∈ proctorsList` مع وجود حصّة `S` بحيث `T` ليس معفياً من `S`، ليس مداوماً في `S.halfday_key`، وليس مكلَّفاً يدوياً (ME) خارج `S.halfday_key`.
- **Eligibility_Class**: فئة تكافؤ على Eligible_Proctor: `T1 ≡ T2` إذا تساوت مجموعات (الحصص المؤهَّلون لها، نصف-أيام دوامهم، نصف-أيام تكليفهم اليدوي).
- **Guard_Slot**: خلية واحدة في `Result_Row.proctor_keys[i]`.
- **Guard_Count(T)**: عدد ظهورات `T.canonicalKey` في كلّ `proctor_keys` عبر كلّ Result_Row (slot-based).
- **Reserve_Count(T)**: عدد ظهورات `T.canonicalKey` في كلّ `reserve_keys`.
- **Duty_Count(T)**: عدد نصف-أيام الدوام التي يحملها `T` بعد تطبيق Key_Adapter. يُحسَب كعدد الأزواج المتمايزة `(T, halfday_key)` في `dutyData` بعد تَوسيعها — أي **متمايز على مستوى نصف-اليوم**، وليس slot-based. السبب: المداومة في `dutyData` تُحدَّد للـ halfday ككل، وأستاذ مداوم لحصة معيَّنة لا يحرس قاعات تلك الحصة بأكملها بصرف النظر عن عددها.
- **Primary_Load(T)**: `Guard_Count(T) + Duty_Count(T)`. هو **محور الإنصاف الوحيد** في V3 (يَعدّ التكليفات: حراسة + مداومة).
- **Final_Load(T)**: `Guard_Count(T) + Reserve_Count(T) + Duty_Count(T)`.
- **AM_Load(T)**: عدد تكليفات `T` (حراسة + دوام) في halfdays ذات `period = 'صباحا'`.
- **PM_Load(T)**: عدد تكليفات `T` (حراسة + دوام) في halfdays ذات `period = 'مساء'`.
- **AM_PM_Imbalance(T)**: `|AM_Load(T) − PM_Load(T)|`.
- **G_Total_Slots**: مجموع سلوتات الحراسة عبر كلّ (Schedule_Entry, room, slot_index).
- **D_Expected**: عدد صحيح غير سالب يقدّمه المستخدم في `examCenterConfig.expected_duty_tasks`، يدخل في حساب الحدود.
- **Global_Lower_Bound**: `floor((G_Total_Slots + D_Expected) / N_Eligible)`.
- **Global_Upper_Bound**: `Global_Lower_Bound + 1`.
- **Class_Lower_Bound(c)** / **Class_Upper_Bound(c)**: الحدود المطبَّقة على كلّ Eligibility_Class، مَحدودة بالحدود العامّة.
- **Hard_Constraint**: قيد صلب لا يجوز خرقه أبداً.
- **Soft_Constraint**: تفضيل لين، يُحاول النظام احترامه ويُفاضله ضدّ تفضيلات أخرى.
- **Reserves_Config**: كائن `{ mode: 'fixed' | 'percent', fixed: int >= 0, percent: int 0..100 }`.
- **Reserve_Affinity**: قاعدة تفضيل اختيار مراقب حرس الحصّة الأولى من نصف-اليوم كاحتياط للحصّة الثانية من نفس نصف-اليوم.
- **Same_Day_Allowance_Flag**: علم `allowSameDayBothHalfdays` في `examDistributionRules`. افتراضياً `false`. عند `true`، يُسمح للمراقب بالحراسة في صباح ومساء نفس اليوم.
- **Diagnostics_V3**: كائن JSON يُصدره Orchestrator_V3 يحوي histogram, min, max, distinctCount, lowerBound, upperBound, classBoundsByProctorKey, unresolvedCases, warnings, errors, timings.
- **Production_Fixture**: ملف `tests/fixtures/45454.json` (147 مراقب، 30 schedule entry، 191 result row، 382 سلوت). مرجع نهائي للقبول.
- **PBT_Suite_V3**: مجموعة اختبارات الخصائص المُلزمة لـ V3 (fast-check أو مولّد محلّي).
- **GS3_Input_Contract**: نفس `GS2_Input_Contract` الموثَّق في spec V2 الأصلي.

---

## Requirements

### Requirement 1: V3 Module Boundary and Algorithm Selection

**User Story:** بصفتي مستخدماً (مدير مؤسسة)، أريد تشغيل خوارزمية V3 جديدة بشكل اختياري إلى جانب V2 الحالية، حتى أُقارن النتائج وأرجع إلى V2 إذا أعطت V3 نتيجةً غير ملائمة.

#### Acceptance Criteria

1. THE System_V3 SHALL be implemented as a Node-only module rooted at `js/algorithms/proctor-v3/` with entry point `js/algorithms/proctor-v3/index.js` exporting a single **public** function `run(input) → { result, diagnostics, algorithmVersion: 'v3' }`. THE module MAY ALSO expose an `_internals` namespace for testing purposes only; consumers (renderer, IPC layer, end users) SHALL ONLY call `run`.
2. THE System_V3 SHALL be runnable in pure Node without `window`, `document`, `electron`, or `better-sqlite3`.
3. THE System_V3 SHALL accept the same `GS3_Input_Contract` as V2_Algorithm without any new mandatory field.
4. THE System_V3 SHALL produce a result whose `result` array is shape-compatible with V2_Algorithm's output (same Result_Row field set).
5. THE V3_Toggle SHALL expose two mutually exclusive choices in `exams-proctors.html`: V2 (الخوارزمية الحالية) and V3 (الخوارزمية الجديدة).
6. WHEN the user selects V2, THE V2_Algorithm SHALL execute with no behavior change AND System_V3 SHALL NOT be invoked.
7. WHEN the user selects V3, THE Orchestrator_V3 SHALL execute and persist its result with `algorithmVersion: 'v3'`.
8. WHERE `algorithmVersion` is absent from a saved distribution payload, THE V3_Toggle SHALL default to V2 to preserve legacy behavior.
9. THE System_V3 SHALL NOT modify V2_Algorithm source files.
10. THE System_V3 SHALL NOT introduce any new runtime dependency in `package.json` `dependencies`.
11. WHERE the PBT_Suite_V3 requires `fast-check`, `fast-check` SHALL be added only to `devDependencies`.
12. THE System_V3 SHALL NOT introduce a database migration or alter the schema of `exam_config_data`.
13. THE System_V3 SHALL NOT alter the existing IPC contract of `examConfig:get` or `examConfig:save`.
14. WHEN System_V3 is invoked twice on the same input with the same `randomSeed`, THE Orchestrator_V3 SHALL produce byte-identical `result` arrays AND identical `diagnostics` modulo timing fields.

---

### Requirement 2: Single Canonical Proctor Key

**User Story:** بصفتي مطوّراً، أريد ضمان أنّ كلّ مراقب يحمل هويةً واحدةً لا تنقسم بين شكلين، حتى لا تتكرّر ظاهرة dual-identity التي ضربت V2.

#### Acceptance Criteria

1. THE System_V3 SHALL define exactly one identity function `canonicalProctorKey(proc, idx)` returning `proc.cin.trim()` if `proc.cin` is a non-empty trimmed string, else `'__idx_' + idx`.
2. THE System_V3 SHALL NOT define any second proctor-identity function inside the algorithm core.
3. THE Key_Adapter SHALL be the single boundary translator that converts external keys (from `dutyData`, `exemptionsData`, `meAssignments`) into Canonical_Proctor_Key values, by lookup in `proctorsList` matching on `cin`, `som`, or numeric `idx_N` patterns.
4. WHEN a key from `dutyData`, `exemptionsData`, or `meAssignments` cannot be resolved to any proctor in `proctorsList`, THE Key_Adapter SHALL drop the entry AND increment `diagnostics.orphanInputKeys` with the original key string.
5. FOR EACH Result_Row produced by Orchestrator_V3, every entry in `proctor_keys` AND every entry in `reserve_keys` SHALL be a Canonical_Proctor_Key for some proctor in `proctorsList`.
6. FOR EACH proctor `T ∈ proctorsList`, THE union of occurrences of any other key shape (e.g. `T.som`, `'idx_' + idx`) in `proctor_keys ∪ reserve_keys` SHALL be zero.
7. WHEN the same proctor `T` appears in both `proctor_keys` and `reserve_keys` across the run, both arrays SHALL use the identical Canonical_Proctor_Key string for `T`.
8. WHEN System_V3 runs against Production_Fixture, THE 6 known ghost CIN strings (`1909564, 2367149, 1910812, 2158781, 1545317, 1177902`) SHALL be absent from every `proctor_keys` AND `reserve_keys`.
9. **Duplicate CIN detection**: WHEN two distinct proctors in `proctorsList` have the same non-empty trimmed `cin`, the Key_Adapter SHALL detect this as a fatal input violation AND emit `diagnostics.errors` entry `{ type: 'duplicate_cin', cin: <value>, indices: [i, j] }` AND THE Orchestrator_V3 SHALL fall back to `__idx_N` for both proctors (overriding the cin-based identity for the duplicates) to maintain canonical-key uniqueness within the run.

---

### Requirement 3: Hard Constraints

**User Story:** بصفتي مستخدماً، أريد ضماناً مطلقاً بأنّ القيود الصلبة لا تُكسَر، حتى لا أحتاج فحص النتيجة يدوياً قبل توزيعها على الأساتذة.

#### القيود الصلبة المُنفَّذة (مرجع للأقسام أدناه)

| الرمز | الاسم | الوصف الموجَز |
|-------|-------|----------------|
| **C1** | Coverage | كلّ قاعة-حصّة تحصل على عدد مراقبين = `proctorsPerRoom` (عادةً 2) |
| **C-EXEMPT** | Exemption | المراقب المُعفى من حصّة لا يحرس فيها |
| **C-DUTY** | Duty Exclusion | المراقب المداوم لحصّة لا يحرس قاعات تلك الحصّة |
| **C-ME** | Manual Exemption | المراقب المكلَّف يدوياً (ME) لا يُكلَّف خارج المجموعة المعيَّنة |
| **C-NO-DOUBLE** | No Double-Booking | المراقب لا يحرس قاعتين في نفس الحصّة |
| **C-NO-SAME-DAY** | No Same-Day Both-Halfdays | المراقب لا يحرس صباحاً ومساءً في نفس اليوم (افتراضياً) |
| **C-CANONICAL-KEY** | Single Canonical Key | كلّ مراقب يَستخدم Canonical_Proctor_Key وحيداً (Requirement 2) |
| **C-RESERVES-SEPARATE** | Reserves Separation | الاحتياطيون منفصلون عن الحراس داخل نفس الصفّ |

#### Acceptance Criteria

1. **C1 (Coverage)**: FOR EACH Result_Row R, THE length of `R.proctor_keys` SHALL equal `input.examDistributionRules.proctorsPerRoom` (typically 2), with `null` entries reserved for unresolvable hard-constraint slots only.
2. **C-EXEMPT**: FOR EACH Result_Row R, FOR EACH `i` in `R.proctor_keys`, THE proctor `T = lookup(R.proctor_keys[i])` SHALL NOT be in the exemption set of the schedule entry corresponding to `R.session_key`.
3. **C-DUTY**: FOR EACH Result_Row R, FOR EACH `i` in `R.proctor_keys`, THE proctor `T` SHALL NOT have a duty entry in `dutyData` for `R.halfday_key`.
4. **C-ME**: FOR EACH Result_Row R, FOR EACH `i` in `R.proctor_keys`, THE proctor `T` SHALL NOT have a Manual_Exemption assigning them to a different halfday/group than `R.halfday_key`.
5. **C-NO-DOUBLE (within row)**: FOR EACH Result_Row R, no Canonical_Proctor_Key SHALL appear more than once across `R.proctor_keys ∪ R.reserve_keys`. (This implies no proctor can be both guard and reserve in the same row, AND no proctor can be guard twice in the same row.)
6. **C-NO-DOUBLE (across rows of same session)**: WHEN two Result_Rows R1 and R2 share the same `session_key` (same date+halfday+session, different rooms), no Canonical_Proctor_Key SHALL appear in `R1.proctor_keys ∪ R1.reserve_keys ∪ R2.proctor_keys ∪ R2.reserve_keys` more than once. **Rationale**: a proctor cannot serve as guard in room A and reserve for the same session in room B, because the reserve role replaces a guard if needed and the same person cannot replace themselves.
7. **C-NO-SAME-DAY (default — guards)**: WHILE `Same_Day_Allowance_Flag === false`, FOR ANY two Result_Rows R1, R2 with `R1.day_key === R2.day_key` AND `R1.halfday_key !== R2.halfday_key`, no Canonical_Proctor_Key SHALL appear in both `R1.proctor_keys` AND `R2.proctor_keys`.
7a. **C-NO-SAME-DAY (default — reserves & cross-role)**: WHILE `Same_Day_Allowance_Flag === false`, FOR ANY two Result_Rows R1, R2 with `R1.day_key === R2.day_key` AND `R1.halfday_key !== R2.halfday_key`, no Canonical_Proctor_Key SHALL appear in `R1.proctor_keys ∪ R1.reserve_keys` AND simultaneously in `R2.proctor_keys ∪ R2.reserve_keys`. **Rationale**: a reserve role still ties the proctor to the half-day (they must be physically present), so a proctor cannot guard in the morning and serve as reserve in the afternoon of the same day under the strict policy.
8. **C-NO-SAME-DAY (relaxed)**: WHILE `Same_Day_Allowance_Flag === true`, the constraints in 3.7 AND 3.7a SHALL NOT be enforced; the proctor MAY guard or reserve in both halfdays of the same day if the algorithm finds it necessary for coverage.
9. **C-NO-SAME-DAY (no constraint between days)**: NO constraint SHALL prevent the same proctor from guarding on multiple **different** days; days need not be consecutive.
10. **C-NO-SAME-DAY (sessions within same halfday allowed)**: NO constraint SHALL prevent the same proctor from guarding multiple **sessions** within the same halfday (sessions are sequential, not concurrent).
11. **C-RESERVES-SEPARATE (DEPRECATED — covered by 3.5)**: This criterion is intentionally redundant with 3.5; it is kept here only as a documentation pointer. Implementers SHOULD enforce 3.5, which subsumes this constraint.
12. **Hard-constraint failure handling**: WHEN System_V3 cannot satisfy a Guard_Slot without violating a hard constraint, THE Orchestrator_V3 SHALL leave that slot value as `null` in `proctor_keys` AND increment `diagnostics.unresolvedSlots` with `{ session_key, room_key, slot_index, reason }`.
13. **No silent violation**: THE Orchestrator_V3 SHALL never write a value into `proctor_keys` or `reserve_keys` that violates Acceptance Criteria 3.1 through 3.11.

---

### Requirement 4: Same-Day Allowance Flag (Infeasibility Detection)

**User Story:** بصفتي مستخدماً، عندما يكون عدد الأساتذة قليلاً، أريد التطبيق أن يخبرني صراحةً أنّ التغطية الكاملة غير ممكنة بدون السماح بحراسة نفس الأستاذ صباحاً ومساءً، ويسألني هل أُفعّل هذه الإمكانية الاستثنائية.

#### Acceptance Criteria

1. THE Same_Day_Allowance_Flag SHALL default to `false` for every new distribution.
2. WHEN `Same_Day_Allowance_Flag === false` AND System_V3 cannot achieve full coverage (`unresolvedSlots.length > 0`), THE Orchestrator_V3 SHALL perform a **feasibility pre-check** by re-running Phases 4–5 with `Same_Day_Allowance_Flag = true` (within a separate time budget of up to 5 seconds). WHEN the relaxed run produces `unresolvedSlots.length === 0` AND the strict run did not, THE strict-run unresolved slots SHALL be classified as caused by the same-day constraint, AND `diagnostics.warnings` SHALL contain an entry `{ type: 'same_day_relaxation_suggested', impactedSlotsCount: <number>, message: 'غير ممكن التغطية بدون السماح بحراسة نفس الأستاذ صباحاً ومساءً في نفس اليوم. هل تريد تفعيل هذا الخيار؟' }`.
2a. WHEN the feasibility pre-check shows the relaxed run ALSO fails (`unresolvedSlots.length > 0` even with `Same_Day_Allowance_Flag = true`), THE warning in 4.2 SHALL NOT be emitted; instead, `diagnostics.warnings` SHALL contain `{ type: 'coverage_infeasible_regardless', impactedSlotsCount: <number>, message: 'التغطية الكاملة غير ممكنة حتى مع تفعيل السماح بنفس اليوم — راجع عدد الأساتذة أو الإعفاءات.' }`.
2b. THE feasibility pre-check SHALL be SKIPPED when `Same_Day_Allowance_Flag` is already `true` (no need to test relaxation when already relaxed).
3. WHEN the warning in 4.2 is emitted, THE renderer in `exams-proctors.html` SHALL display a confirmation dialog with two choices: "تفعيل وإعادة التوزيع" / "إلغاء".
4. WHEN the user confirms relaxation, THE renderer SHALL set `Same_Day_Allowance_Flag = true` in `examDistributionRules` AND re-invoke `Orchestrator_V3.run(input)` with the updated rules.
5. THE Same_Day_Allowance_Flag SHALL be persisted as part of `examDistributionRules` in `exam_config_data`; subsequent runs SHALL honor the user's last choice unless they reset it explicitly.
6. THE algorithm SHALL distinguish between unresolved slots due to "same-day-only" versus "any-other-cause"; only the former trigger the warning in 4.2.

---

### Requirement 5: Per-Class Fairness on Primary_Load (Slot-Based)

**User Story:** بصفتي مستخدماً، أريد توزيعاً عادلاً يحتسب الحراسة بالسلوتات (لا بأنصاف الأيام)، يأخذ المداومة في الاعتبار، ولا يجاوز المراقب الأقصى المتوقَّع نظرياً، مع توزيع ثنائي صارم (gap = 0 أو 1، لا أكثر).

#### Acceptance Criteria

1. THE System_V3 SHALL compute `Primary_Load(T) = Guard_Count(T) + Duty_Count(T)` where `Guard_Count` is slot-based.
2. THE System_V3 SHALL compute `Global_Lower_Bound = floor((G_Total_Slots + D_Expected) / N_Eligible)` AND `Global_Upper_Bound = Global_Lower_Bound + 1`.
3. FOR EACH Eligibility_Class `c`, THE `Class_Lower_Bound(c) ≤ Global_Upper_Bound`.
4. FOR EACH Eligibility_Class `c`, THE `Class_Upper_Bound(c) ≤ Global_Upper_Bound + 1`.
5. WHEN the per-class total `(G_class + D_class) ≤ Global_Lower_Bound`, THE `Class_Lower_Bound(c) = (G_class + D_class)` (monotonicity guard).
6. FOR EACH proctor `T ∈ Eligible_Proctor` with class `c`, THE `Class_Lower_Bound(c) ≤ Primary_Load(T) ≤ Class_Upper_Bound(c)`.
7. **Strict bimodal distribution (F3)**: THE `diagnostics.histogramByPrimaryLoad` (Acceptance Criterion 9.3a) over Eligible_Proctor SHALL contain at most **two distinct keys**, AND if there are two keys, they SHALL be **consecutive integers** (i.e., `k` and `k+1`). The acceptable forms are:
   - `{ k: N }` (all eligible proctors carry the same load), OR
   - `{ k: a, k+1: b }` for some integers `k, a, b` with `a + b = N_Eligible`.
8. **F3 violation handling**: WHEN the histogram contains 3 or more distinct keys, OR contains keys with gap > 1 (e.g., `{2, 4}`), THE Orchestrator_V3 SHALL record `diagnostics.errors` entry `{ type: 'fairness_violation', histogram: <object>, message: 'Histogram is not strict bimodal' }` AND attempt corrective swaps until either the property holds OR the time budget is exhausted.
9. WHEN a proctor `T` has `Duty_Count(T) ≥ Class_Upper_Bound(c)` for class `c`, THE System_V3 SHALL NOT assign `T` to any Guard_Slot.
10. **best-effort baseline coverage**: FOR EACH proctor `T ∈ Eligible_Proctor`, THE Orchestrator_V3 SHOULD aim for `Primary_Load(T) ≥ 1` (every eligible proctor carries at least one unit of work; pre-pinned duty alone satisfies this). WHEN total available work `(G_Total_Slots + D_Expected) < N_Eligible`, this property is structurally infeasible AND SHALL NOT block the run; instead, every proctor with `Primary_Load(T) = 0` SHALL be recorded in `diagnostics.zeroLoadProctors` with `{ canonicalKey, classId, reason: 'insufficient_total_work' | 'eligibility_constraints' }`.
11. **Multi-step coverage repair**: WHEN `Class_Lower_Bound(c) − Primary_Load(T) ≥ 2` for an under-loaded `T`, THE Orchestrator_V3 SHALL perform up to `Class_Lower_Bound(c) − Primary_Load(T)` successive swaps for `T` (subject to donor eligibility), not a single swap.
12. **Donor protection**: THE Orchestrator_V3 SHALL NEVER reduce any donor proctor's `Primary_Load` below their own `Class_Lower_Bound` during a coverage repair swap.
13. IF the Orchestrator_V3 cannot raise `Primary_Load(T)` to `Class_Lower_Bound(c)` for some `T` without violating a hard constraint, THEN THE Orchestrator_V3 SHALL record `T.canonicalKey` in `diagnostics.coverageWarnings` with `{ canonicalKey, classLowerBound, initialLoad, finalLoad, attemptedSwaps, reason }` where `reason ∈ { 'no_eligible_donor', 'time_budget' }`.
14. THE `diagnostics.classBoundsByProctorKey` SHALL be a plain JSON-serializable object keyed by Canonical_Proctor_Key, each value `{ classId, classLowerBound, classUpperBound, classSize }`.

---

### Requirement 6: Soft Constraints (Preferences)

**User Story:** بصفتي مستخدماً، أريد توزيعاً يحترم تفضيلات إضافية حتى لو لم تكن قيوداً صلبة، مثل عدم تكليف الأستاذ بحراسة مادة تخصصه، وتوازن تكليفاته بين الصباح والمساء.

#### Soft Constraints المُنفَّذة

| الرمز | الاسم | الوصف الموجَز |
|-------|-------|----------------|
| **S-OWN-SUBJECT** | Subject-Specialist Avoidance | تجنّب تكليف الأستاذ بحراسة مادة تخصصه |
| **S-AM-PM-BALANCE** | Morning/Afternoon Balance | لكلّ أستاذ، توازن عدد التكليفات بين الفترة الصباحية والمسائية |
| **S-NO-ROOM-REPEAT** | Room Variety | تجنّب تكرار نفس القاعة لنفس المراقب |
| **S-GENDER-DIVERSITY** | Gender Diversity | تنويع الجنس بين المراقبين في نفس القاعة (إن كانت بيانات الجنس متوفّرة) |

#### Acceptance Criteria

1. **S-OWN-SUBJECT (penalty fixed)**: THE Orchestrator_V3 SHALL apply a fixed penalty `W_OWN_SUBJECT = 100` to the cost of assigning proctor `T` as guard to a session whose `subject_name` matches `T.subject` (case-insensitive trimmed comparison).
2. **S-OWN-SUBJECT (override)**: WHEN no alternative assignment exists that respects all hard constraints AND fairness bounds, THE Orchestrator_V3 MAY assign `T` to their own subject session AND record in `Result_Row.softViolations` the token `'subjectConflict'`.
3. **S-OWN-SUBJECT (matching rule)**: THE matching SHALL be performed via `proctor.subject` field against `scheduleEntry.subject_name`. WHEN either field is absent, no penalty applies.
4. **S-AM-PM-BALANCE (per-proctor)**: FOR EACH eligible proctor `T`, THE Orchestrator_V3 SHALL apply a penalty proportional to `AM_PM_Imbalance(T)` to the assignment cost, with weight `W_AM_PM = 50`.
5. **S-AM-PM-BALANCE (target)**: THE Orchestrator_V3 SHALL aim for `AM_PM_Imbalance(T) ≤ 1` for every eligible proctor, but SHALL NOT enforce this as a hard constraint.
6. **S-AM-PM-BALANCE (diagnostics)**: THE `diagnostics` SHALL include `amPmImbalanceByProctorKey` mapping each Canonical_Proctor_Key to its final `AM_PM_Imbalance(T)` value.
7. **S-NO-ROOM-REPEAT**: THE Orchestrator_V3 SHALL apply a penalty `W_ROOM_REPEAT = 30` whenever assigning proctor `T` to a room they already guarded in this distribution.
8. **S-GENDER-DIVERSITY**: WHEN proctor gender data is available in `proctorsList[i].gender`, THE Orchestrator_V3 SHALL apply a penalty `W_GENDER = 20` to assignments that produce a same-gender pair in a single room when a mixed pair was feasible.
9. **Soft violations recording**: FOR EACH Result_Row R, THE `R.softViolations` SHALL list the soft-constraint tokens violated by that row's assignments (subset of `{'sameRoomRepeat', 'subjectConflict', 'amPmImbalance', 'genderImbalance'}`).
10. **Soft violations DO NOT cause unresolvedSlots**: A row with non-empty `softViolations` SHALL still have valid (non-null) `proctor_keys`; soft violations are advisory only.

---

### Requirement 7: Reserves Population Policy

**User Story:** بصفتي مستخدماً، أريد توزيعاً للاحتياط يشمل الجميع قدر المستطاع (مشاركة قبل تركيز)، ويُفضّل عند الحاجة من حرس الحصّة الأولى ليكون احتياطاً للثانية في نفس نصف-اليوم.

#### Acceptance Criteria

1. THE Orchestrator_V3 SHALL read Reserves_Config from `examCenterConfig.max_reserves_mode`, `examCenterConfig.max_reserves`, `examCenterConfig.max_reserves_percent` with the same fallback rules used by V2_Algorithm (legacy `examDistributionRules.reservesPerSession` as `{ mode: 'fixed', fixed: N }` when new fields absent).
2. WHEN `Reserves_Config.mode === 'fixed'`, THE number of reserves placed for each Schedule_Entry S SHALL equal `min(Reserves_Config.fixed, eligibleAvailable(S))`.
3. WHEN `Reserves_Config.mode === 'percent'`, THE number of reserves placed for each Schedule_Entry S SHALL equal `min(ceil(Reserves_Config.percent × |guards(S)| / 100), eligibleAvailable(S))`.
4. FOR EACH reserve assignment of proctor `T` to Schedule_Entry `S`, THE `T` SHALL satisfy ALL of the following:
   - NOT exempt for any session within `S` (C-EXEMPT)
   - NOT on duty in `S.halfday_key` (C-DUTY)
   - NOT currently a guard in any row of `S.session_key` (C-NO-DOUBLE within session, guard-side)
   - **NOT currently a reserve in any other row of `S.session_key`** (C-NO-DOUBLE within session, reserve-side; aligned with AC 3.6)
   - Consistent with C-NO-SAME-DAY as defined in AC 3.7a below (treating reserve assignments equivalently to guard assignments for cross-halfday counting).
4a. **Reserve placement uniqueness**: WHEN a session `S` consists of multiple Result_Rows (one per room), reserves are typically shared across all rooms of that session via a single canonical-key list. THE Orchestrator_V3 SHALL ensure that any given Canonical_Proctor_Key appears at most ONCE across the union of `reserve_keys` of all Result_Rows belonging to `S`, regardless of whether the rows share the same array reference or hold independent arrays.
5. WHEN ordering reserve candidates for a Schedule_Entry S, THE Orchestrator_V3 SHALL sort by the lexicographic key `(Reserve_Count(T) ASC, affinityRank ASC, Final_Load(T) ASC, deterministic_tiebreaker ASC)`.
6. WHEN S is the second session of a halfday containing two sessions, `affinityRank(T) = 0` if `T` guarded at least one slot of the first session of the same halfday, otherwise `affinityRank(T) = 1`.
7. WHEN S is the first session of a halfday, OR the halfday contains a single session, `affinityRank(T) = 1` for every candidate (Reserve_Affinity does not apply).
8. THE Orchestrator_V3 SHOULD aim that no eligible proctor has `Reserve_Count` exceeding any other eligible proctor's `Reserve_Count` by more than 1 while the latter has unreserved capacity in any session for which they were eligible (best-effort). WHEN this property cannot be achieved due to exemption, duty, or same-day constraints, THE deviation SHALL be recorded in `diagnostics.reserveImbalances` with entries `{ overloadedKey, underloadedKey, deltaCount, blockingReason }`.
9. THE Orchestrator_V3 SHALL place reserves only AFTER all guard slots have been processed; reserves SHALL NOT cause a guard reassignment.

---

### Requirement 8: Determinism and Reproducibility

**User Story:** بصفتي مستخدماً، أريد إعادة إنتاج النتيجة نفسها عند التشغيل مرّتين بنفس البذرة، حتى أتمكّن من المراجعة والتدقيق.

#### Acceptance Criteria

1. THE Orchestrator_V3 SHALL accept an optional `randomSeed` field (finite number) in GS3_Input_Contract.
2. WHEN `randomSeed` is provided, THE Orchestrator_V3 SHALL initialize a seeded PRNG from that value.
3. WHEN `randomSeed` is absent, THE Orchestrator_V3 SHALL generate a seed from `Date.now()` AND record it in `diagnostics.seedUsed`.
4. WHEN System_V3 is invoked twice with byte-identical input AND identical `randomSeed`, THE two `result` arrays SHALL be byte-identical AND `diagnostics.classBoundsByProctorKey` SHALL be byte-identical.
5. THE Orchestrator_V3 SHALL NOT iterate any `Object.keys(...)` of an object derived from input without first sorting; iteration order over input data structures SHALL be deterministic regardless of host JS engine key insertion order.
6. THE Orchestrator_V3 SHALL use stable sort semantics for every tiebreaking comparator; comparators SHALL produce a total order with explicit final `(canonicalKey ASC)` fallback.

---

### Requirement 9: Diagnostics and Observability

**User Story:** بصفتي مستخدماً (ومطوّراً)، أريد تقريراً تشخيصياً شاملاً بعد كلّ تشغيل، حتى أعرف الفارق بين النجاح والفشل وأين تركّز المشكلات.

#### Acceptance Criteria

1. WHEN Orchestrator_V3 completes successfully, THE return value SHALL contain `{ result, diagnostics, algorithmVersion: 'v3' }`.
2. THE `diagnostics` object SHALL contain at minimum: `algorithmVersion`, `seedUsed`, `totalDurationMs`, `phaseDurations` (object), `histogramByGuardCount` (object load → count, slot-based, keyed by canonical key), `histogramByPrimaryLoad` (object load → count, where load = Primary_Load = Guard_Count + Duty_Count), `min`, `max` (referring to `histogramByPrimaryLoad`), `distinctCount`, `globalLowerBound`, `globalUpperBound`, `classBoundsByProctorKey`, `unresolvedSlots`, `coverageWarnings`, `coverageRepairSwaps`, `coverageRepairUnresolved`, `orphanInputKeys`, `amPmImbalanceByProctorKey`, `zeroLoadProctors`, `reserveImbalances`, `warnings`, `errors`.
3. THE `diagnostics.histogramByGuardCount` SHALL be computed strictly from Canonical_Proctor_Key counts across `proctor_keys` only (slot-based, matches `Guard_Count`); duty assignments SHALL NOT be included.
3a. THE `diagnostics.histogramByPrimaryLoad` SHALL be computed from `Primary_Load(T) = Guard_Count(T) + Duty_Count(T)` for every eligible proctor; this is the histogram that the **strict bimodal** property (Acceptance Criterion 5.7) is asserted against.
3b. WHEN tests or display layers refer simply to "the histogram", they SHALL specify which one; the existing `js/data/proctor-key-resolver.js` and `buildSummaryRows` consume `histogramByGuardCount` (matching V2 semantics).
4. THE `diagnostics.distinctCount` SHALL equal the number of distinct Canonical_Proctor_Key values appearing in any `proctor_keys ∪ reserve_keys ∪ duty_teachers` derived from the run.
5. WHEN any hard constraint cannot be satisfied for some `(session_key, room_key, slot_index)`, THE `diagnostics.unresolvedSlots` SHALL contain an entry describing it; THE Orchestrator_V3 SHALL NOT silently produce an invalid assignment.
6. WHEN the count of distinct `(teacher, halfday)` pairs in `input.dutyData` (also referred to as `examDutyTeachersData` in the renderer/IPC layer; the same data set under different names) differs from D_Expected by more than 20% of D_Expected, THE `diagnostics.warnings` SHALL contain `{ type: 'd_expected_divergence', expected: D_Expected, actual: <number> }`.
7. THE `diagnostics.errors` SHALL contain entries for: (a) caught internal exceptions during a phase's execution, (b) constraint or fairness violations that the algorithm could not resolve (e.g., `fairness_violation` from Acceptance Criterion 5.8), (c) input contract violations detected after Phase 0 but during processing. THE `diagnostics.errors` MAY be non-empty even when `result` contains a valid (possibly partial) assignment array; this is the "degraded" outcome described in `orchestratorState`.
8. THE `diagnostics` object SHALL be JSON-serializable without circular references; `JSON.parse(JSON.stringify(diagnostics))` round-trip SHALL preserve every field.

---

### Requirement 10: Round-Trip Integrity Across Save/Load

**User Story:** بصفتي مستخدماً، أريد أنّ الحفظ في قاعدة البيانات والقراءة منها لا يُغيّر التوزيع بأيّ شكل، حتى لا أرى histogram مختلفاً بعد التحديث.

#### Acceptance Criteria

1. THE Orchestrator_V3 output SHALL be JSON-serializable: `JSON.stringify(output)` SHALL succeed AND `JSON.parse(JSON.stringify(output))` SHALL produce a structurally equivalent object.
2. FOR EACH Result_Row field that is an array, THE Orchestrator_V3 SHALL produce a fresh non-shared array reference; no two rows SHALL share the same array reference for `proctors`, `proctor_keys`, `reserves`, `reserve_keys`, `duty_teachers`, or `softViolations`.
3. WHEN the V3 output is persisted via the existing `examConfig:save` IPC and re-loaded via `examConfig:get`, THE round-trip SHALL preserve `histogramByCanonicalKey(loaded) === histogramByCanonicalKey(original)`.
4. WHEN the V3 output is consumed by the existing display layer (`buildSummaryRows` in `exams-rooms.html`) which aggregates by `proctor_keys`, THE displayed histogram SHALL match `diagnostics.histogram` exactly.
5. WHEN the V3 output is loaded by `exams-rooms.html` `buildSummaryRows`, THE display layer SHALL resolve every key in `proctor_keys` and `reserve_keys` to a proctor display name via the existing `js/data/proctor-key-resolver.js` helper without orphan-resolution warnings.

---

### Requirement 11: Exam Center Levels Integration (Rooms Triple)

**User Story:** بصفتي مستخدماً، أريد أنّ كلّ مستوى مبرمج في الجدولة يحصل على عدد مهام الحراسة الصحيح، حتى عند عدم حفظ صفوف القاعات في `examCenterRoomsData`.

#### Acceptance Criteria

1. WHEN building Schedule_Entry-level guard tasks, THE Orchestrator_V3 SHALL derive the room count for each level `L` mentioned in `scheduleEntries` from `(level, rooms_count, sessions_count)` where `rooms_count` is sourced primarily from `examCenterLevels[L].rooms`.
2. WHEN `examCenterLevels[L].rooms = N` AND `examCenterRoomsData` contains `M < N` rows for L, THE Orchestrator_V3 SHALL synthesize `(N − M)` in-memory placeholder room rows numbered sequentially after the existing rows, AND record `diagnostics.warnings` entry `{ type: 'synthetic_rooms', level: L, addedCount: N − M }`.
3. WHEN `examCenterLevels[L].rooms` is `0` or undefined, THE Orchestrator_V3 SHALL fall back to whatever rows `examCenterRoomsData` provides for L (no synthesis).
4. WHEN `examCenterLevels` is absent or empty for the school year, THE Orchestrator_V3 SHALL use only `examCenterRoomsData` (no synthesis), AND record `diagnostics.warnings` entry `{ type: 'exam_center_levels_missing' }`.
5. WHEN total guard slots produced for level L does NOT equal `rooms_count(L) × sessions_count(L) × proctorsPerRoom`, THE Orchestrator_V3 SHALL record `diagnostics.warnings` entry `{ type: 'level_slot_mismatch', level: L, expected: <num>, actual: <num> }`.
6. THE synthesized in-memory room rows SHALL NEVER be persisted to `examCenterRoomsData`.

---

### Requirement 12: Phase Structure (Algorithmic Pipeline)

**User Story:** بصفتي مطوّراً، أريد بنيةً صريحةً لمراحل الخوارزمية، حتى أستطيع التنقّل بسهولة بين الكود والاختبارات والوثائق.

#### Acceptance Criteria

1. THE Orchestrator_V3 SHALL execute a documented sequence of phases. The exact decomposition is left to `design.md`, but the pipeline SHALL include at minimum: input validation, eligibility-class derivation, bounds computation (with global cap), guard placement, multi-step coverage repair, reserves population, finalization (soft-violation tagging, AM/PM balance check, diagnostics aggregation).
2. THE Orchestrator_V3 SHALL maintain a single in-memory `loadState` keyed by Canonical_Proctor_Key only; no other key shape SHALL be written into `loadState`.
3. EVERY phase SHALL be implemented as a pure function with signature `phase(stateIn, ctx) → stateOut`: it takes inputs explicitly, returns a new state object, AND SHALL NOT rely on hidden module-level mutable state. The diagnostics fields (`errors`, `warnings`, `unresolvedSlots`, etc.) ARE part of the `state` object; phases produce a `stateOut` whose diagnostics fields are an extended copy of `stateIn.diagnostics` plus any new entries.
4. THE Orchestrator_V3 SHALL ensure that any post-placement optimization phase respects every hard constraint AND respects the lower-bound protection (no move SHALL push a proctor below their Class_Lower_Bound).
5. WHEN any phase throws an exception, THE Orchestrator_V3 SHALL catch it AND construct a successor `state` whose `diagnostics.errors` extends the prior state's errors with a structured entry; the orchestrator SHALL then continue with subsequent phases using that successor state, returning whatever partial result was produced before the exception (with `unresolvedSlots` populated for any uncomputed work).
6. THE Orchestrator_V3 SHALL enforce a global time budget of **30 seconds** for the full run on Production_Fixture-scale inputs (147 proctors, ~30 schedule entries). WHEN any phase exhausts its allotted budget, THE Orchestrator_V3 SHALL return the best partial result AND record `diagnostics.warnings` entry `{ type: 'phase_timeout', phase: <name>, durationMs: <num> }`.

---

### Requirement 13: Backward Compatibility with V2 Output Shape

**User Story:** بصفتي مطوّراً، أريد أنّ مخرجات V3 تُستهلك دون تعديل من طبقة العرض الحالية، حتى لا أحتاج تعديل صفحات HTML.

#### Acceptance Criteria

1. EVERY Result_Row produced by Orchestrator_V3 SHALL contain the field set: `session_key, halfday_key, day_key, room_key, room_name, proctors, proctor_keys, reserves, reserve_keys, duty_teachers, softViolations, notes`.
2. THE `proctors` array SHALL contain display names matching `proctor_keys` index-by-index (resolved via the existing `js/data/proctor-key-resolver.js` helper).
3. THE `reserves` array SHALL contain display names matching `reserve_keys` index-by-index.
4. THE `softViolations` array SHALL contain string tokens drawn from `{'sameRoomRepeat', 'subjectConflict', 'amPmImbalance', 'genderImbalance'}`.
5. THE field types of every Result_Row SHALL match V2_Algorithm's field types exactly (string, array, etc.).
6. WHEN the existing `buildSummaryRows` in `exams-rooms.html` consumes a V3 result array, the function SHALL produce a histogram that matches `diagnostics.histogram` byte-equal in counts.

---

### Requirement 14: Property-Based Testing Suite

**User Story:** بصفتي مطوّراً، أريد كلّ ثابتٍ بنيوي للخوارزمية مُختبَراً بـ 100 إدخال عشوائي على الأقل، حتى لا تتسرّب طبقات جديدة من العيوب.

#### Acceptance Criteria

1. THE PBT_Suite_V3 SHALL contain a property test asserting Acceptance Criterion 2.5 (every key in `proctor_keys ∪ reserve_keys` is a Canonical_Proctor_Key) over at least 100 random inputs.
2. THE PBT_Suite_V3 SHALL contain a property test asserting Acceptance Criterion 3.5 (no Canonical_Proctor_Key appears twice in the same row) over at least 100 random inputs.
3. THE PBT_Suite_V3 SHALL contain a property test asserting Acceptance Criterion 5.6 (`Class_Lower_Bound(c) ≤ Primary_Load(T) ≤ Class_Upper_Bound(c)` for every eligible T) over at least 100 random inputs.
4. THE PBT_Suite_V3 SHALL contain a property test asserting Acceptance Criterion 5.7 (strict bimodal histogram) over at least 100 random inputs.
5. THE PBT_Suite_V3 SHALL contain a property test asserting Acceptance Criterion 8.4 (determinism: same input + same seed → byte-identical output) over at least 100 random inputs.
6. THE PBT_Suite_V3 SHALL contain a property test asserting Acceptance Criterion 10.2 (no shared array references across rows) over at least 100 random inputs.
7. THE PBT_Suite_V3 SHALL contain an **acceptance test** (not a property test) pinning the production fixture invariant. The test SHALL load `tests/fixtures/45454.json` and assert that `node tests/run-v3.js tests/fixtures/45454.json` reports `min ≥ globalLowerBound` AND `max ≤ globalUpperBound + 1` AND zero ghost CIN keys AND `unresolvedSlots.length === 0` AND `distinctCount === 147` AND `histogramByPrimaryLoad` is strict bimodal. **Note**: this fixture is the **initial acceptance benchmark** for V3 production-readiness, not a permanent structural constraint. Future fixtures MAY be added to `tests/fixtures/` and tested similarly without modifying the spec.
8. THE PBT_Suite_V3 SHALL contain a round-trip property test asserting `JSON.parse(JSON.stringify(output))` preserves the structural identity of the result, AND that recomputing `histogramByGuardCount` from the parsed result yields the same object as `output.diagnostics.histogramByGuardCount`, over at least 100 random inputs.
9. THE PBT_Suite_V3 SHALL be executable via `npm test` without requiring any environment variable, network access, or Electron runtime.
10. EVERY property test in PBT_Suite_V3 SHALL emit, on failure, a counterexample input sufficient to reproduce the failure deterministically (seed + minimal input).

---

### Requirement 15: Production Fixture Acceptance

**User Story:** بصفتي مستخدماً، أريد أنّ ملفّ المركز الحقيقي 45454 يُنتج توزيعاً صحيحاً متّصفاً بكلّ الثوابت، لأنّ هذا الملف هو معيار النجاح النهائي.

#### Acceptance Criteria

1. WHEN System_V3 runs against Production_Fixture with default Reserves_Config and default D_Expected, THE result SHALL contain `proctor_keys` summing to **382 slots filled** (zero unresolved guard slots).
2. WHEN System_V3 runs against Production_Fixture, EVERY one of the **147 proctors** SHALL have `Primary_Load(T) ≥ Global_Lower_Bound = 2`.
3. WHEN System_V3 runs against Production_Fixture, the `histogramByPrimaryLoad` SHALL be **strict bimodal** (Acceptance Criterion 5.7): either `{k: 147}` for some `k`, OR `{k: a, k+1: b}` with `a + b = 147`.
4. WHEN System_V3 runs against Production_Fixture, NO proctor SHALL have `Primary_Load(T) > Global_Upper_Bound + 1 = 4`; in the typical configuration the histogram SHALL satisfy `max ≤ 3`.
5. WHEN System_V3 runs against Production_Fixture, THE result SHALL contain **zero ghost CIN keys** (the 6 known `som`-shaped strings SHALL not appear in any `proctor_keys` or `reserve_keys`).
6. WHEN System_V3 runs against Production_Fixture twice with `randomSeed = 42`, THE two outputs SHALL be byte-identical.
7. WHEN System_V3 runs against Production_Fixture, THE `diagnostics.coverageRepairUnresolved` SHALL equal `0`.
8. WHEN System_V3 runs against Production_Fixture, THE total wall-clock duration SHALL NOT exceed **30 seconds** on a reference machine (single CPU core, no other heavy load).
9. WHEN System_V3 runs against Production_Fixture, THE `diagnostics.amPmImbalanceByProctorKey` SHALL satisfy: at most 10% of eligible proctors have `AM_PM_Imbalance(T) ≥ 2`.

---

### Requirement 16: Migration Strategy and Rollback

**User Story:** بصفتي مستخدماً، أريد أن يبقى V2 كاحتياط فعّال أثناء استقرار V3، وأن لا تُفقد توزيعاتي المحفوظة.

#### Acceptance Criteria

1. WHILE V3 is opt-in (controlled by V3_Toggle), V2_Algorithm SHALL remain fully functional and selectable in `exams-proctors.html`.
2. WHEN a previously-saved distribution carries `algorithmVersion: 'v2'`, THE display pages (`exams-rooms.html`, `exams-proctors.html`) SHALL continue to render it without modification.
3. WHEN a previously-saved distribution carries no `algorithmVersion` field (legacy), THE display pages SHALL continue to render it under the V2 contract.
4. THE System_V3 SHALL NOT silently rewrite or migrate previously-saved distributions; the user SHALL re-run distribution under V3 to obtain a V3 payload.
5. WHEN the user runs V3 then switches V3_Toggle back to V2 and re-runs, THE V2_Algorithm SHALL produce its own V2 result and overwrite the previously-saved V3 payload (standard save semantics; no preservation of V3 across toggle switch).
6. THE `package.json` `scripts` section SHALL include a `verify:v3` command that runs the V3 production-fixture acceptance test from CLI without Electron.

---

### Requirement 17: Documentation Deliverables

**User Story:** بصفتي مطوّراً مستقبليّاً، أريد توثيقاً واضحاً لقرارات التصميم وعقد الـ API، حتى لا تتكرّر دورة الإصلاحات الإحدى عشرة التي عاشتها V2.

#### Acceptance Criteria

1. THE design phase SHALL produce `design.md` documenting at minimum: chosen phase decomposition, determinism contract, per-phase time budget, donor-eligibility predicate for coverage repair, solver choice rationale, AND traceability between Acceptance Criteria and implementation components.
2. THE `js/algorithms/proctor-v3/README.md` SHALL describe the public API (`run(input) → output`), the input contract, the output contract, AND the supported flags.
3. THE `design.md` SHALL document the exclusive-OR boundary between V2_Algorithm and System_V3: which files each owns, which input/output contracts they share, AND the rule for adding new constraints (V2 frozen; new constraints land in V3 only).

> **Note**: The detailed "constraint matrix" (mapping each Acceptance Criterion to its enforcing component) AND the "test surface" (mapping each property test to its target criterion) are **structural artefacts of the design**, not requirements; they are produced and maintained in `design.md` per Acceptance Criterion 17.1 above.

---

## Out of Scope (Explicitly Deferred)

The following concerns are **explicitly deferred** to future specs and NOT in scope for V3:

1. **Exam Period Isolation (Regional vs National)**: The current V3 treats all schedule entries uniformly under one fairness scope. The user has indicated this is acceptable for now; a future spec may introduce optional period-isolated distribution.
2. **Cross-Period Fairness Balancing**: Even if period isolation is added later, the V3 spec does not constrain how fairness should be computed across multiple isolated periods.
3. **DB Schema Migrations**: V3 reads the same `exam_config_data.examAutoDistributionData` shape used by V2. No migration script is required.
4. **Display Layer Refactoring**: V3 emits the same Result_Row shape as V2; `exams-rooms.html`, `exams-proctors.html`, and `js/data/proctor-key-resolver.js` are NOT modified.
5. **User-Configurable Soft-Constraint Weights**: Soft constraint weights (W_OWN_SUBJECT, W_AM_PM, W_ROOM_REPEAT, W_GENDER) are fixed in code for V3. A future spec may expose them in `examDistributionRules`.
6. **Removal of V2**: V3 ships alongside V2 as opt-in. A separate future decision will determine when (if ever) V2 is removed.
