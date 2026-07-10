# وثيقة متطلبات إصلاح الخطأ (Bugfix Requirements)

## Introduction

أثناء دورة المزامنة (push)، يتعطّل عميل Firestore بخطأ داخلي
`INTERNAL ASSERTION FAILED: Unexpected state (ID: b815 / 3c6b)`.

يحدث الخطأ عندما تنقطع الشبكة بينما يحتاج الـ SDK إلى تجديد رمز المصادقة
(auth token) في منتصف معاملة `runTransaction`. فيُرجع نطاق المصادقة الخطأ
`auth/network-request-failed`، وهذا الرمز يتسرّب إلى مُصنِّف أخطاء المعاملات
في Firestore (`isPermanentError` / `isRetryableTransactionError`) الذي يتوقع
رموز Firestore فقط (مثل `unavailable` و`aborted`)، فيفشل التأكيد الداخلي.

بعد وقوع هذا الخطأ مرة واحدة، يبدو أن الحالة الداخلية لعميل Firestore تتلوّث،
فتفشل العمليات اللاحقة حتى إعادة إنشاء العميل أو إعادة تشغيل التطبيق. كما أن
نهاية الـ stack (`process.processTicksAndRejections`) تشير إلى أن الخطأ قد
يُرمى كـ unhandled rejection من microtask منفصل، فلا يلتقطه `try/catch`
المحيط بـ `await runTransaction(...)`.

الأثر: تعطّل دورة المزامنة وعدم القدرة على المتابعة دون إعادة تشغيل التطبيق،
مع بقاء البيانات على Firestore سليمة والصفوف الفاشلة في حالة `pending`.

## Bug Analysis

### Current Behavior (Defect)

ما يحدث حاليًا عند تشغيل الخطأ:

1.1 WHEN تنقطع الشبكة بينما معاملة `runTransaction` قيد التنفيذ ويحتاج الـ SDK إلى تجديد رمز المصادقة THEN the system يرمي `INTERNAL ASSERTION FAILED: Unexpected state (ID: b815 / 3c6b)` بسبب تسرّب الرمز `auth/network-request-failed` إلى مُصنِّف أخطاء معاملات Firestore

1.2 WHEN يُرمى الخطأ كـ unhandled rejection من microtask منفصل THEN the system لا يلتقطه `try/catch` المحيط بـ `await runTransaction(...)` وقد تنهار العملية (process)

1.3 WHEN يقع `INTERNAL ASSERTION FAILED` مرة واحدة THEN the system يبقى بعميل Firestore متلوّث الحالة فتفشل جميع عمليات المزامنة اللاحقة حتى إعادة تشغيل التطبيق

1.4 WHEN يرسل الدفع المتوازي عددًا كبيرًا (10–50) من معاملات `runTransaction` المتزامنة أثناء عدم استقرار الشبكة THEN the system يزيد احتمال تصادم نافذة تجديد الرمز مع انقطاع الشبكة ووقوع الانهيار

### Expected Behavior (Correct)

ما ينبغي أن يحدث بدلًا من ذلك:

2.1 WHEN تنقطع الشبكة أثناء تجديد رمز المصادقة في منتصف معاملة THEN the system SHALL يعامل الخطأ كخطأ عابر (transient) دون انهيار، ويُبقي الصفوف المتأثرة في حالة `pending` لإعادة المحاولة

2.2 WHEN يقع `auth/network-request-failed` أو `INTERNAL ASSERTION FAILED` THEN the system SHALL يتعافى عبر مسار تعافٍ يُنهي العميل الحالي (`terminate(db)`) ويعيد تهيئة عميل Firestore دون إعادة تشغيل التطبيق

2.3 WHEN يظهر الخطأ كـ unhandled rejection THEN the system SHALL يوجّهه إلى مسار التعافي بدل إسقاط العملية (process)

2.4 WHEN تبدأ دورة الدفع (push) THEN the system SHALL يتحقق من الاتصال ويُسخّن رمز المصادقة مسبقًا لتجنّب تجديد الرمز في منتصف المعاملة

### Unchanged Behavior (Regression Prevention)

السلوك القائم الذي يجب الحفاظ عليه:

3.1 WHEN تكون الشبكة مستقرة ورمز المصادقة صالحًا THEN the system SHALL CONTINUE TO يدفع صفوف `sync_outbox` عبر `runTransaction` بنجاح

3.2 WHEN يفشل صفّ لسبب عابر (transient) THEN the system SHALL CONTINUE TO يُبقيه في حالة `pending` لإعادة المحاولة دون فقدان بيانات

3.3 WHEN تكون البيانات قد رُفعت بالفعل إلى Firestore THEN the system SHALL CONTINUE TO يبقيها سليمة دون فقدان أو ازدواج

3.4 WHEN يعمل منطق الحارس الإصداري (version guard) أو المصالحة (reconciliation) THEN the system SHALL CONTINUE TO يتصرّف كما هو دون تغيير
