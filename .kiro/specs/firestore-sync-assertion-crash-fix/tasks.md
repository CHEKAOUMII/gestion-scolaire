# Implementation Plan

## Overview

خطة تنفيذ إصلاح خطأ تعطّل Firestore بـ `INTERNAL ASSERTION FAILED: Unexpected state (ID: b815 / 3c6b)`
أثناء دورة المزامنة (push)، باتّباع منهجية شرط الخطأ (Bug Condition):
أولًا كتابة اختبار استكشافي يُبرهن الخطأ (Property 1) واختبارات حفاظ تلتقط السلوك القائم (Property 2)
قبل الإصلاح، ثم تطبيق الإصلاح ثلاثي الطبقات (وقاية، التقاط، تعافٍ)، ثم التحقق من الإصلاح وعدم الانحدار.

## Tasks

- [x] 1. كتابة اختبار استكشاف شرط الخطأ (Bug Condition Exploration Test)
  - **Property 1: Bug Condition** - تعافٍ آمن من فشل تجديد الرمز/التأكيد الداخلي
  - **مهم جدًا**: اكتب هذا الاختبار القائم على الخصائص (PBT) قبل تطبيق الإصلاح
  - **حرج**: يجب أن يفشل هذا الاختبار على الكود غير المُصلَح — الفشل يؤكّد وجود الخطأ
  - **لا تحاول إصلاح الاختبار أو الكود عند فشله** في هذه المرحلة
  - **ملاحظة**: هذا الاختبار يُرمّز السلوك المتوقّع — وسيتحقّق من صحّة الإصلاح حين ينجح بعد التنفيذ
  - **الهدف**: إظهار أمثلة مضادّة (counterexamples) تُبرهن وجود الخطأ
  - **نهج PBT مُوجّه (Scoped)**: لأن الخطأ شبه حتمي، وجّه الخاصية إلى الحالات الفاشلة الملموسة عبر حقن الخطأ:
    حقن `auth/network-request-failed` و`INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)` / `(ID: 3c6b)`
    داخل `runTransaction` مع تنويع عدد الصفوف وأنواع الكيانات وموضع/توقيت الحقن
  - يطابق شرط الخطأ من design (isBugCondition): `insideTransaction AND tokenRefreshNeeded AND networkInterrupted AND (code == 'auth/network-request-failed' OR message ~ /INTERNAL ASSERTION FAILED: Unexpected state/ OR ~ /(ID: b815)|(ID: 3c6b)/)`
  - يجب أن تطابق تأكيدات الاختبار خصائص السلوك المتوقّع من design (Property 1):
    عدم انهيار العملية، بقاء الصفوف المتأثرة `pending`، تعافي العميل عبر `terminate(db)` وإعادة التهيئة، و`result.isTransient == true`
  - غطِّ حالات Exploratory من design: (1) Mid-Transaction Auth-Network Failure، (2) Internal Assertion Leak،
    (3) Unhandled Rejection Path (رمي الخطأ من microtask منفصل)، (4) Post-Crash Client Contamination
  - شغّل الاختبار على الكود غير المُصلَح
  - **النتيجة المتوقّعة**: الاختبار يفشل (هذا صحيح — يُثبت وجود الخطأ)
  - وثّق الأمثلة المضادّة المرصودة لفهم السبب الجذري (مثال: "الخطأ يُرمى كـ unhandled rejection يُسقط العملية بدل إبقاء الصفّ pending")
  - أكمل المهمة عند كتابة الاختبار وتشغيله وتوثيق الفشل
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. كتابة اختبارات الحفاظ القائمة على الخصائص (Preservation Property Tests) — قبل تطبيق الإصلاح
  - **Property 2: Preservation** - الحفاظ على سلوك المسار غير المتأثّر
  - **مهم**: اتّبع منهجية الرصد أولًا (observation-first methodology)
  - ارصد سلوك الكود غير المُصلَح للمدخلات التي لا تحقّق شرط الخطأ (`NOT isBugCondition`):
    - ارصد: دفع صفوف `sync_outbox` عبر `runTransaction` ينجح على شبكة مستقرة ورمز صالح (Req 3.1)
    - ارصد: صفّ يفشل بخطأ عابر آخر (`unavailable` / `aborted` / throttling) يبقى في حالة `pending` (Req 3.2)
    - ارصد: البيانات المرفوعة مسبقًا إلى Firestore تبقى سليمة دون فقدان أو ازدواج (Req 3.3)
    - ارصد: منطق الحارس الإصداري (version guard) والمصالحة (reconciliation) يتصرّف كما هو (Req 3.4)
  - اكتب اختبارات قائمة على الخصائص تلتقط هذه الأنماط المرصودة من قسم Preservation Requirements في design:
    لكل مدخل لا يحقّق شرط الخطأ، نتيجة الكود المُصلَح تساوي نتيجة الكود الأصلي تمامًا
  - يولّد الاختبار القائم على الخصائص حالات كثيرة تلقائيًا (أعداد صفوف، أنواع كيانات، رموز أخطاء متنوّعة، تعارضات إصدار) لضمان أقوى
  - شغّل الاختبارات على الكود غير المُصلَح
  - **النتيجة المتوقّعة**: الاختبارات تنجح (هذا يؤكّد السلوك الأساسي المراد الحفاظ عليه)
  - أكمل المهمة عند كتابة الاختبارات وتشغيلها ونجاحها على الكود غير المُصلَح
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. الإصلاح: تعافٍ آمن من فشل تجديد الرمز/التأكيد الداخلي أثناء المزامنة

  - [x] 3.1 إضافة دالة تصنيف الخطأ القابل للتعافي
    - إضافة `isAssertionOrAuthNetworkError(err)` تعيد `true` عندما يكون `err.code === 'auth/network-request-failed'`
      أو تحتوي رسالة الخطأ/سياقه على `INTERNAL ASSERTION FAILED: Unexpected state` (بما في ذلك `ID: b815` / `ID: 3c6b`)
    - تعيد `false` للأخطاء القائمة الأخرى (`unavailable`, `aborted`, `permission-denied`, `VERSION_CONFLICT`) دون تغيير تصنيفها
    - _Bug_Condition: isBugCondition(input) from design_
    - _Expected_Behavior: expectedBehavior(result) — معاملة الخطأ كعابر دون تسرّب_
    - _Requirements: 1.1, 2.1_

  - [x] 3.2 ربط التصنيف داخل writeItemWithVersionCheck ومسار التعافي
    - في `catch` داخل `writeItemWithVersionCheck` (في `main/sync/engine.js`)، عند تطابق `isAssertionOrAuthNetworkError`
      أرجع النتيجة الموحّدة `{ success: false, isRecoverable: true, isTransient: true, errorName: err.code }` دون رمي يتسرّب
    - إضافة `recoverFirestoreClient()` في `main/firebase/config.js`: تستدعي `terminate(_db)` ثم تصفّر `_db`/`_app`
      وتعيد `initFirebase()`، وتستدعي `clearCredentials()` لإجبار تسخين رمز جديد، مع حارس لمنع التعافي المتزامن المتكرّر
    - في `flushSyncOutbox` / منطق وسم النتائج: عند نتيجة `isRecoverable`/`isTransient` يبقى الصفّ `pending`
      (مسار `markEntryFailed` غير القسري) ولا يُحتسب فقدان بيانات؛ توسعة `reopenRecoverableOutbox` إن لزم
    - _Bug_Condition: isBugCondition(input) from design_
    - _Expected_Behavior: لا انهيار، الصفوف pending، تعافي العميل عبر terminate + re-init_
    - _Preservation: المدخلات التي لا تحقّق شرط الخطأ تمرّ عبر نفس المسارات دون تغيير_
    - _Requirements: 2.1, 2.2, 3.2, 3.3_

  - [x] 3.3 الوقاية: تسخين رمز المصادقة والتحقق من الاتصال قبل الدفع
    - في بداية `flushSyncOutbox` وقبل قراءة الصفوف، استدعاء استباقي لـ `getCredentials()` (يجدّد الرمز إن قارب على الانتهاء)
      والتأكد من نجاح اتصال خفيف، لتجنّب تجديد الرمز في منتصف المعاملة
    - إن فشل التسخين بخطأ شبكة، تُؤجَّل الدورة وتبقى الصفوف `pending`
    - _Bug_Condition: isBugCondition(input) — تقليل احتمال تجديد الرمز داخل المعاملة_
    - _Expected_Behavior: تسخين الرمز مسبقًا قبل قراءة الصفوف_
    - _Requirements: 2.4, 1.4_

  - [x] 3.4 التقاط unhandled rejection وتوجيهه إلى مسار التعافي
    - تركيب معالج `process.on('unhandledRejection', ...)` مرة واحدة عند تهيئة المزامنة
    - يفحص الخطأ بـ `isAssertionOrAuthNetworkError`؛ إن تطابق يمنع إسقاط العملية ويستدعي مسار التعافي ويترك الصفوف `pending`
    - إن لم يتطابق، يعيد السلوك الافتراضي (إعادة الرمي/التسجيل) دون تغيير
    - _Bug_Condition: isBugCondition(input) — الخطأ يظهر كـ unhandled rejection من microtask منفصل_
    - _Expected_Behavior: توجيه الخطأ للتعافي بدل إسقاط العملية_
    - _Requirements: 2.3_

  - [x] 3.5 التحقق من نجاح اختبار استكشاف شرط الخطأ الآن
    - **Property 1: Expected Behavior** - تعافٍ آمن من فشل تجديد الرمز/التأكيد الداخلي
    - **مهم**: أعد تشغيل نفس الاختبار من المهمة 1 — لا تكتب اختبارًا جديدًا
    - الاختبار من المهمة 1 يُرمّز السلوك المتوقّع؛ نجاحه يؤكّد تحقّق السلوك المتوقّع
    - شغّل اختبار استكشاف شرط الخطأ من المهمة 1
    - **النتيجة المتوقّعة**: الاختبار ينجح (يؤكّد أن الخطأ أُصلِح: لا انهيار، الصفوف pending، تعافي العميل، isTransient)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.6 التحقق من بقاء اختبارات الحفاظ ناجحة
    - **Property 2: Preservation** - الحفاظ على سلوك المسار غير المتأثّر
    - **مهم**: أعد تشغيل نفس الاختبارات من المهمة 2 — لا تكتب اختبارات جديدة
    - شغّل اختبارات الحفاظ القائمة على الخصائص من المهمة 2
    - **النتيجة المتوقّعة**: الاختبارات تنجح (يؤكّد عدم وجود انحدارات/regressions)
    - تأكّد من بقاء جميع الاختبارات ناجحة بعد الإصلاح
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. نقطة تحقّق — التأكد من نجاح جميع الاختبارات
  - شغّل `npm test` و`npm run lint` للتأكد من نجاح الجناح الكامل دون انحدارات
  - تأكّد من نجاح اختبارات الوحدة (`isAssertionOrAuthNetworkError`، `recoverFirestoreClient`، بقاء الصفوف `pending`، معالج `unhandledRejection`)
  - تأكّد من نجاح الاختبارات القائمة على الخصائص (Property 1 و Property 2)
  - عند ظهور أي إشكال، توقّف واسأل المستخدم

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1", "2"],
      "description": "اختبارات ما قبل الإصلاح: اختبار شرط الخطأ (يجب أن يفشل) واختبارات الحفاظ (يجب أن تنجح) على الكود غير المُصلَح"
    },
    {
      "wave": 2,
      "tasks": ["3.1"],
      "description": "إضافة دالة تصنيف الخطأ القابل للتعافي"
    },
    {
      "wave": 3,
      "tasks": ["3.2", "3.3", "3.4"],
      "description": "ربط التصنيف ومسار التعافي، الوقاية بتسخين الرمز، والتقاط unhandled rejection"
    },
    {
      "wave": 4,
      "tasks": ["3.5", "3.6"],
      "description": "التحقق من نجاح اختبار شرط الخطأ وبقاء اختبارات الحفاظ ناجحة"
    },
    {
      "wave": 5,
      "tasks": ["4"],
      "description": "نقطة التحقّق النهائية — نجاح كامل الجناح دون انحدارات"
    }
  ]
}
```

- المهمة 1 (اختبار شرط الخطأ) والمهمة 2 (اختبارات الحفاظ) مستقلّتان ويجب إنجازهما قبل الإصلاح
- المهام 3.1 → 3.4 هي خطوات التنفيذ المتسلسلة للإصلاح
- المهمة 3.5 تعيد تشغيل اختبار المهمة 1 (يجب أن ينجح الآن)
- المهمة 3.6 تعيد تشغيل اختبارات المهمة 2 (يجب أن تبقى ناجحة)
- المهمة 4 نقطة تحقّق نهائية تعتمد على نجاح كل ما سبق

## Notes

- **منهجية الاختبار قبل الإصلاح**: المهمتان 1 و2 تُكتبان وتُشغَّلان على الكود غير المُصلَح. يجب أن
  يفشل اختبار المهمة 1 (يؤكّد وجود الخطأ) وأن تنجح اختبارات المهمة 2 (تؤكّد السلوك الأساسي).
- **عدم تعديل الاختبارات بعد الإصلاح**: المهمتان 3.5 و3.6 تعيدان تشغيل نفس الاختبارات من 1 و2 دون كتابة جديدة.
- **حقن الأخطاء (fault injection)**: لصعوبة محاكاة انقطاع شبكة حقيقي داخل الـ SDK، تُحقَن أخطاء
  `auth/network-request-failed` و`INTERNAL ASSERTION FAILED` عبر `runTransaction` مُحاكاة (mock/stub).
- **الملفات المتأثرة**: `main/sync/engine.js` (`writeItemWithVersionCheck`, `flushSyncOutbox`)،
  `main/firebase/config.js` (`recoverFirestoreClient`)، و`main/sync/credentials.js` (`clearCredentials`).
- **أوامر التحقق**: `npm test` و`npm run lint`.
