# تصميم إصلاح خطأ تعطّل Firestore بـ INTERNAL ASSERTION FAILED أثناء المزامنة

## Overview

أثناء دورة الدفع (push) في محرّك المزامنة (`main/sync/engine.js`)، تُنفَّذ كتابة كل
صفّ من `sync_outbox` داخل معاملة `runTransaction` عبر `writeItemWithVersionCheck`.
عندما تنقطع الشبكة في اللحظة التي يحتاج فيها الـ SDK إلى تجديد رمز المصادقة
(auth token) في منتصف المعاملة، يُرجع نطاق Auth الرمز `auth/network-request-failed`.
هذا الرمز ليس من رموز Firestore المتوقّعة (`unavailable`, `aborted`, ...)، فيتسرّب إلى
مُصنِّف أخطاء المعاملات (`isPermanentError` / `isRetryableTransactionError`) ويفشل
التأكيد الداخلي → `FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state (ID: b815 / 3c6b)`.

نهج الإصلاح يتكوّن من ثلاث طبقات دفاعية متكاملة، دون تغيير منطق المزامنة الناجح:

1. **الوقاية**: تسخين رمز المصادقة والتحقق من الاتصال قبل بدء الدفع، لتقليل احتمال
   تجديد الرمز في منتصف المعاملة.
2. **الالتقاط**: تصنيف `auth/network-request-failed` و`INTERNAL ASSERTION FAILED`
   كخطأ عابر (transient) وتوجيهه إلى مسار تعافٍ بدل تركه يتسرّب أو يُسقط العملية.
3. **التعافي**: إنهاء عميل Firestore المتلوّث (`terminate(db)`) وإعادة تهيئته دون
   إعادة تشغيل التطبيق، مع إبقاء الصفوف المتأثرة في حالة `pending` لإعادة المحاولة.

الهدف أن يبقى السلوك في المسار السعيد (شبكة مستقرة، رمز صالح) مطابقًا تمامًا لما هو
عليه الآن، وأن يتغيّر السلوك فقط عند تحقّق شرط الخطأ.

## Glossary

- **Bug_Condition (C)**: شرط وقوع الخطأ — انقطاع الشبكة أثناء حاجة الـ SDK لتجديد رمز
  المصادقة في منتصف معاملة `runTransaction`، ما ينتج عنه تسرّب رمز نطاق Auth
  (`auth/network-request-failed`) إلى مُصنِّف أخطاء معاملات Firestore وفشل التأكيد
  الداخلي (`INTERNAL ASSERTION FAILED: Unexpected state`).
- **Property (P)**: السلوك المرغوب عند تحقّق شرط الخطأ — معاملة الخطأ كخطأ عابر دون
  انهيار، إبقاء الصفوف المتأثرة `pending`، والتعافي عبر إعادة تهيئة العميل دون إعادة
  تشغيل التطبيق.
- **Preservation**: السلوك القائم الذي يجب ألّا يتغيّر — الدفع الناجح للصفوف عبر
  المعاملات عند استقرار الشبكة، إبقاء الأخطاء العابرة الأخرى `pending`، سلامة البيانات
  المرفوعة، ومنطق الحارس الإصداري/المصالحة.
- **writeItemWithVersionCheck**: الدالة في `main/sync/engine.js` التي تنفّذ كتابة
  صفّ واحد داخل `runTransaction` مع فحص الإصدار، وتُرجع كائن نتيجة موحّدًا
  (`{ success, error, errorName, isThrottle, ... }`).
- **flushSyncOutbox**: نقطة دخول دورة الدفع في `main/sync/engine.js` التي تقرأ الصفوف
  المعلّقة وتوزّعها وتسجّل النتائج وتحدّث `last_push_at` / `last_push_error`.
- **getCredentials / getFirebaseSession**: آلية الحصول على/تجديد رمز المصادقة في
  `main/sync/credentials.js`.
- **getFirestoreDb / initFirebase**: تهيئة عميل Firestore في `main/firebase/config.js`
  (تحتفظ بمرجع وحيد `_db`).
- **terminate(db)**: دالة من `firebase/firestore` تُنهي عميل Firestore وتحرّر حالته
  الداخلية، تمهيدًا لإعادة التهيئة.
- **isThrottleError**: الدالة الموجودة التي تصنّف أخطاء التحميل الزائد
  (`resource-exhausted`, `unavailable`, `aborted`) كأخطاء throttling.

## Bug Details

### Bug Condition

يتجلّى الخطأ عندما تنقطع الشبكة بينما معاملة `runTransaction` قيد التنفيذ ويحتاج الـ
SDK إلى تجديد رمز المصادقة. عندها يتسرّب رمز نطاق Auth (`auth/network-request-failed`)
إلى مُصنِّف أخطاء معاملات Firestore الذي لا يعرف إلا رموز Firestore، فيفشل التأكيد
الداخلي ويُرمى الخطأ — وقد يظهر كـ unhandled rejection من microtask منفصل لا يلتقطه
`try/catch` المحيط بـ `await runTransaction(...)`. بعد وقوعه تتلوّث الحالة الداخلية
للعميل فتفشل العمليات اللاحقة.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type SyncPushAttempt {
           networkInterrupted: boolean,   // الشبكة انقطعت أثناء المحاولة
           tokenRefreshNeeded: boolean,   // الـ SDK احتاج تجديد رمز المصادقة
           insideTransaction: boolean,    // الحدث وقع داخل runTransaction
           thrownError: { code: string, message: string }
         }
  OUTPUT: boolean

  RETURN input.insideTransaction
         AND input.tokenRefreshNeeded
         AND input.networkInterrupted
         AND (
              input.thrownError.code == 'auth/network-request-failed'
              OR matches(input.thrownError.message, /INTERNAL ASSERTION FAILED: Unexpected state/)
              OR matches(input.thrownError.message, /\(ID: b815\)|\(ID: 3c6b\)/)
         )
END FUNCTION
```

### Examples

- **انهيار في منتصف المعاملة**: أثناء `writeItemWithVersionCheck` لصفّ واحد، تنقطع
  الشبكة ويفشل تجديد الرمز → يُرمى
  `INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)` مع
  `CONTEXT: {"code":"auth/network-request-failed"}`.
  المتوقّع: معاملة الخطأ كعابر، إبقاء الصفّ `pending`، عدم الانهيار.
- **unhandled rejection يُسقط العملية**: يُرمى نفس الخطأ من microtask منفصل فلا
  يلتقطه `try/catch` حول `await runTransaction(...)`، فتنهار العملية.
  المتوقّع: توجيه الخطأ إلى مسار التعافي بدل إسقاط العملية.
- **تلوّث الحالة بعد أول انهيار**: بعد وقوع التأكيد مرة واحدة، تفشل كل العمليات
  اللاحقة على نفس عميل Firestore حتى إعادة تشغيل التطبيق.
  المتوقّع: `terminate(db)` + إعادة تهيئة العميل يستعيدان القدرة على المزامنة دون
  إعادة تشغيل.
- **الدفع المتوازي يضخّم الاحتمال**: 10–50 معاملة `runTransaction` متزامنة أثناء عدم
  استقرار الشبكة تزيد فرصة تصادم نافذة تجديد الرمز مع الانقطاع.
  المتوقّع: تسخين الرمز مسبقًا يقلّل التصادم؛ وأي خطأ يقع يُعامَل كعابر ويُتعافى منه.
- **حالة حدّية (لا خطأ)**: شبكة مستقرة ورمز صالح أثناء المعاملة → لا يتحقّق شرط الخطأ،
  ويجب أن يبقى السلوك الناجح دون تغيير.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- عند استقرار الشبكة وصلاحية الرمز، يستمر دفع صفوف `sync_outbox` عبر `runTransaction`
  بنجاح كما هو (Req 3.1).
- عند فشل صفّ لسبب عابر آخر (throttling/`unavailable`/`aborted`)، يبقى الصفّ `pending`
  لإعادة المحاولة دون فقدان بيانات (Req 3.2).
- البيانات المرفوعة مسبقًا إلى Firestore تبقى سليمة دون فقدان أو ازدواج (Req 3.3).
- منطق الحارس الإصداري (version guard) والمصالحة (reconciliation) يتصرّف كما هو دون
  تغيير (Req 3.4).

**Scope:**
كل المدخلات التي لا تحقّق شرط الخطأ (`NOT isBugCondition`) يجب أن تبقى غير متأثرة تمامًا
بهذا الإصلاح، ويشمل ذلك:
- المعاملات الناجحة عند استقرار الشبكة وصلاحية الرمز.
- تعارضات الإصدار (`VERSION_CONFLICT`) ومسار المصالحة.
- أخطاء throttling/الرفض (`permission-denied`) القائمة وتصنيفها الحالي.
- مسارات السحب (pull) وتسجيل التغييرات (syncLog) غير المعنيّة بهذا الخطأ.

**ملاحظة:** السلوك الصحيح المتوقّع عند تحقّق شرط الخطأ معرّف في قسم Correctness
Properties (Property 1). هذا القسم يركّز على ما يجب ألّا يتغيّر.

## Hypothesized Root Cause

بناءً على نص الخطأ وتحليله، الأسباب الأكثر احتمالًا:

1. **تسرّب رمز خطأ من نطاق Auth إلى مُصنِّف معاملات Firestore**: عندما يفشل تجديد
   الرمز بـ `auth/network-request-failed` أثناء المعاملة، يصل رمز غير معروف إلى
   `isPermanentError` / `isRetryableTransactionError` فيفشل التأكيد الداخلي. هذا تفاعل
   معروف بين `firebase/auth` و`firebase/firestore` عند الانقطاع أثناء تجديد الرمز.

2. **تجديد الرمز في منتصف المعاملة بدل تسخينه مسبقًا**: لا تُسخّن الجلسة/الرمز قبل
   بدء دورة الدفع، فيقع التجديد في أسوأ توقيت (داخل `runTransaction`)؛ والدفع المتوازي
   (10–50 معاملة) يوسّع نافذة التصادم.

3. **الخطأ يُرمى كـ unhandled rejection من microtask منفصل**: نهاية الـ stack
   (`process.processTicksAndRejections`) تشير إلى أن `try/catch` المحيط بـ
   `await runTransaction(...)` قد لا يلتقطه، فيتسرّب كرفض غير معالَج ويُسقط العملية.

4. **تلوّث الحالة الداخلية لعميل Firestore بعد التأكيد**: لا يوجد مسار يُنهي العميل
   ويعيد تهيئته بعد التأكيد، فتبقى الحالة معطوبة وتفشل العمليات اللاحقة حتى إعادة تشغيل
   التطبيق (لا تعافٍ ذاتي).

## Correctness Properties

Property 1: Bug Condition - تعافٍ آمن من فشل تجديد الرمز/التأكيد الداخلي

_For any_ مدخل يتحقّق فيه شرط الخطأ (isBugCondition تُرجع true) — أي وقوع
`auth/network-request-failed` أو `INTERNAL ASSERTION FAILED` بسبب انقطاع الشبكة أثناء
تجديد الرمز في منتصف معاملة — فإن الدالة بعد الإصلاح SHALL تعامل الخطأ كخطأ عابر دون
انهيار العملية، وتُبقي الصفوف المتأثرة في حالة `pending` لإعادة المحاولة، وتتعافى عبر
إنهاء عميل Firestore (`terminate(db)`) وإعادة تهيئته دون إعادة تشغيل التطبيق، حتى لو
ظهر الخطأ كـ unhandled rejection.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - الحفاظ على سلوك المسار غير المتأثّر

_For any_ مدخل لا يتحقّق فيه شرط الخطأ (isBugCondition تُرجع false) — معاملات ناجحة
على شبكة مستقرة، أخطاء عابرة أخرى (throttling)، تعارضات إصدار، أو بيانات مرفوعة
مسبقًا — فإن الكود بعد الإصلاح SHALL ينتج نفس النتيجة التي ينتجها الكود الأصلي تمامًا،
محافظًا على نجاح الدفع عبر `runTransaction`، وإبقاء الأخطاء العابرة `pending`، وسلامة
البيانات بلا فقدان أو ازدواج، وسلوك الحارس الإصداري والمصالحة دون تغيير.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

بافتراض صحّة تحليل السبب الجذري:

**File**: `main/sync/engine.js` (مع مساعدات في `main/firebase/config.js`)

**Functions**: `writeItemWithVersionCheck`، `flushSyncOutbox`، ومساعد تعافٍ جديد
(`recoverFirestoreClient`) ودالة تصنيف جديدة (`isAssertionOrAuthNetworkError`).

**Specific Changes**:

1. **تصنيف الخطأ كعابر قابل للتعافي**: إضافة دالة
   `isAssertionOrAuthNetworkError(err)` تعيد `true` عندما يكون
   `err.code === 'auth/network-request-failed'` أو تحتوي رسالة الخطأ (أو سياقها) على
   `INTERNAL ASSERTION FAILED: Unexpected state` (بما في ذلك `ID: b815` / `ID: 3c6b`).
   ربط هذا التصنيف داخل `catch` في `writeItemWithVersionCheck` بحيث تُرجع النتيجة
   `{ success: false, isRecoverable: true, isTransient: true, errorName: err.code }`
   دون رمي يتسرّب.

2. **مسار التعافي وإعادة تهيئة العميل**: إضافة `recoverFirestoreClient()` في
   `main/firebase/config.js` تستدعي `terminate(_db)` ثم تصفّر `_db`/`_app` المخزّنة
   وتعيد `initFirebase()`، وتستدعي `clearCredentials()` (من `credentials.js`) لإجبار
   تسخين رمز جديد في الدورة التالية. تُستدعى مرة واحدة لكل دورة عند رصد خطأ قابل للتعافي،
   مع حارس لمنع التعافي المتكرّر المتزامن.

3. **إبقاء الصفوف pending بدل failed**: في `flushSyncOutbox` / منطق وسم النتائج، عند
   نتيجة `isRecoverable`/`isTransient` يُعامَل الصفّ كخطأ عابر فيبقى `pending` (مسار
   `markEntryFailed` غير القسري) ولا يُحتسب فقدان بيانات. توسعة `reopenRecoverableOutbox`
   أو ما يماثلها لإعادة فتح الصفوف الموسومة بهذا الخطأ إن لزم.

4. **تسخين الرمز والتحقق من الاتصال قبل الدفع (وقاية)**: في بداية `flushSyncOutbox`
   وقبل قراءة الصفوف، استدعاء استباقي لـ `getCredentials()` (الذي يجدّد الرمز إن قارب
   على الانتهاء) والتأكد من نجاح اتصال خفيف، لتجنّب تجديد الرمز في منتصف المعاملة
   (Req 2.4). إن فشل التسخين بخطأ شبكة، تُؤجَّل الدورة وتبقى الصفوف `pending`.

5. **التقاط unhandled rejection وتوجيهه للتعافي**: تركيب معالج `process.on('unhandledRejection', ...)`
   (مرة واحدة عند تهيئة المزامنة) يفحص الخطأ بـ `isAssertionOrAuthNetworkError`؛ إن
   تطابق، يمنع إسقاط العملية ويستدعي مسار التعافي ويترك الصفوف `pending` (Req 2.3)،
   وإلا يعيد رمي/تسجيل السلوك الافتراضي دون تغيير.

> **ملاحظة معمارية**: التغييرات محصورة في مسار الدفع والتهيئة. أي مدخل لا يحقّق شرط
> الخطأ يمرّ عبر نفس المسارات القائمة دون تعديل سلوكها (انظر Property 2).

## Testing Strategy

### Validation Approach

نتبع نهجًا من مرحلتين: أولًا نُظهر أمثلة مضادّة (counterexamples) تُبرهن الخطأ على الكود
غير المُصلَح، ثم نتحقّق من أن الإصلاح يعمل بشكل صحيح ويحافظ على السلوك القائم. نظرًا
لصعوبة محاكاة انقطاع شبكة حقيقي داخل الـ SDK، نعتمد على حقن أخطاء (fault injection)
عبر دالة `runTransaction` مُحاكاة (mock/stub) تُرجع/ترمي `auth/network-request-failed`
و`INTERNAL ASSERTION FAILED`، مع اختبار تكامل اختياري على محاكي Firestore.

### Exploratory Bug Condition Checking

**Goal**: إظهار أمثلة مضادّة تُبرهن الخطأ قبل تطبيق الإصلاح، وتأكيد أو دحض تحليل السبب
الجذري. إن دُحض، نعيد صياغة الفرضية.

**Test Plan**: كتابة اختبارات تحقن `auth/network-request-failed` و
`INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)` أثناء `runTransaction`،
وتشغيلها على الكود غير المُصلَح لرصد الفشل وفهم السبب: هل يُرمى عبر `try/catch`
المحيط أم كـ unhandled rejection؟ وهل تتلوّث الحالة فتفشل العملية التالية؟

**Test Cases**:
1. **Mid-Transaction Auth-Network Failure**: حقن `auth/network-request-failed` داخل
   معاملة صفّ واحد (will fail on unfixed code — لا تُعامَل كعابر/يتسرّب).
2. **Internal Assertion Leak**: حقن `INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)`
   داخل المعاملة (will fail on unfixed code).
3. **Unhandled Rejection Path**: رمي الخطأ من microtask منفصل بعد بدء المعاملة
   للتحقق من تسرّبه خارج `try/catch` (will fail on unfixed code — يُسقط العملية).
4. **Post-Crash Client Contamination**: بعد أول خطأ، محاولة عملية كتابة ثانية على نفس
   العميل (may fail on unfixed code — تفشل بسبب تلوّث الحالة).

**Expected Counterexamples**:
- الخطأ لا يُعامَل كعابر؛ إمّا يتسرّب خارج النتيجة الموحّدة أو يُرمى كرفض غير معالَج.
- العملية تنهار بدل إبقاء الصفّ `pending`.
- العمليات اللاحقة تفشل على العميل المتلوّث.
- الأسباب المحتملة: تسرّب رمز نطاق Auth، غياب مسار تعافٍ، عدم التقاط unhandled rejection.

### Fix Checking

**Goal**: التحقق أنه لكل مدخل يتحقّق فيه شرط الخطأ، تنتج الدالة المُصلَحة السلوك المتوقّع
(عابر، لا انهيار، الصفّ `pending`، تعافٍ ناجح).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := flushSyncOutbox_fixed(input)
  ASSERT NOT processCrashed()
  ASSERT affectedRowsStatus(input) == 'pending'
  ASSERT firestoreClientRecovered()          // terminate + re-init تمّا دون إعادة تشغيل
  ASSERT result.isTransient == true
END FOR
```

### Preservation Checking

**Goal**: التحقق أنه لكل مدخل لا يتحقّق فيه شرط الخطأ، تنتج الدالة المُصلَحة نفس نتيجة
الدالة الأصلية.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT flushSyncOutbox_original(input) == flushSyncOutbox_fixed(input)
END FOR
```

**Testing Approach**: يُنصح بالاختبار القائم على الخصائص (PBT) للتحقق من الحفاظ، لأنه:
- يولّد حالات اختبار كثيرة تلقائيًا عبر فضاء المدخلات (صفوف، حالات، رموز أخطاء متنوّعة).
- يلتقط حالات حدّية قد تفوّتها اختبارات الوحدة اليدوية.
- يوفّر ضمانًا قويًا بعدم تغيّر السلوك لكل المدخلات غير المُصابة.

**Test Plan**: رصد سلوك الكود غير المُصلَح أولًا للمعاملات الناجحة وأخطاء throttling
وتعارضات الإصدار، ثم كتابة اختبارات قائمة على الخصائص تلتقط ذلك السلوك وتؤكّد بقاءه بعد
الإصلاح.

**Test Cases**:
1. **Successful Push Preservation**: رصد نجاح دفع الصفوف على شبكة مستقرة في الكود غير
   المُصلَح، ثم اختبار بقائه بعد الإصلاح (Req 3.1).
2. **Transient Throttle Preservation**: رصد بقاء صفّ فاشل بخطأ `unavailable`/`aborted`
   في حالة `pending`، ثم اختبار بقاء هذا السلوك (Req 3.2).
3. **Uploaded Data Integrity Preservation**: رصد سلامة البيانات المرفوعة (لا فقدان/ازدواج)،
   ثم اختبار بقائها (Req 3.3).
4. **Version Guard / Reconciliation Preservation**: رصد سلوك الحارس الإصداري والمصالحة،
   ثم اختبار عدم تغيّره (Req 3.4).

### Unit Tests

- اختبار `isAssertionOrAuthNetworkError` على عيّنة رموز/رسائل: `auth/network-request-failed`،
  `INTERNAL ASSERTION FAILED ... (ID: b815)`، `(ID: 3c6b)` → true؛ و`unavailable`،
  `aborted`، `permission-denied`، `VERSION_CONFLICT` → false.
- اختبار أن `writeItemWithVersionCheck` تُرجع نتيجة موحّدة `isRecoverable/isTransient`
  عند حقن خطأ التأكيد، دون رمي يتسرّب.
- اختبار أن `recoverFirestoreClient` يستدعي `terminate` ثم يعيد التهيئة ويصفّر المراجع
  المخزّنة، مع حارس ضد التعافي المتزامن المتكرّر.
- اختبار أن الصفوف المتأثرة تبقى `pending` (وليس `failed`) بعد خطأ قابل للتعافي.
- اختبار أن معالج `unhandledRejection` يلتقط خطأ التأكيد ولا يُسقط العملية، ويتجاهل
  الأخطاء غير المطابقة.

### Property-Based Tests

- توليد حالات دفع عشوائية (أعداد صفوف، أنواع كيانات، توقيت/موضع حقن الخطأ داخل المعاملة)
  والتحقق من Property 1: لا انهيار، الصفوف `pending`، تعافٍ ناجح.
- توليد رموز/رسائل أخطاء عشوائية والتحقق من تصنيفها الصحيح (قابل للتعافي مقابل غير ذلك)
  دون تغيير تصنيف الأخطاء القائمة.
- توليد سيناريوهات لا تحقّق شرط الخطأ (نجاح، throttling، تعارض إصدار) والتحقق من Property 2:
  تطابق نتيجة الكود المُصلَح مع الأصلي عبر آلاف الحالات.

### Integration Tests

- تدفّق دفع كامل على محاكي Firestore مع حقن انقطاع/فشل تجديد رمز في منتصف المعاملة،
  والتأكد من التعافي ومتابعة المزامنة في الدورة التالية دون إعادة تشغيل التطبيق.
- اختبار الدفع المتوازي (10–50 معاملة) تحت عدم استقرار محاكى، والتأكد من بقاء الصفوف
  `pending` والتعافي مرة واحدة لكل دورة.
- اختبار أن تسخين الرمز قبل الدورة يقلّل تجديد الرمز في منتصف المعاملة (التحقق من
  استدعاء `getCredentials` قبل قراءة الصفوف)، وأن السلوك الناجح يبقى كما هو.
