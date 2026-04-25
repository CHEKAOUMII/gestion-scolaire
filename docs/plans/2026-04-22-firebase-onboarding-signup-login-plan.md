# Firebase Onboarding + Signup + Login

> **التاريخ:** 2026-04-22  
> **الحالة:** خطة تنفيذ مفصلة  
> **النطاق:** `setup.html`, `login.html`, `js/pages/setup.js`, `js/pages/login.js`, `main/ipc/auth.js`, `main/ipc/linking.js`, `main/ipc/system.js`, `preload.js`, `main/firebase/*`, `firebase/functions/index.js`, `firebase/firestore.rules`, `tests/integration-firebase.js`

---

## 1. الهدف

بعد الانتقال من DynamoDB إلى Firebase، نحتاج إلى توحيد ثلاث طبقات كانت منفصلة أو غير مكتملة:

1. **Onboarding المؤسسة** عند أول تشغيل.
2. **Signup / إنشاء الحساب** لأول مدير وللمستخدمين اللاحقين.
3. **Login / تسجيل الدخول** بهوية Firebase بدل الاعتماد على SQLite فقط.

الهدف ليس فقط “إظهار شاشة دخول جديدة”، بل بناء تدفق كامل يربط:

- المؤسسة `institution_config`
- الجهاز `linked_devices`
- المستخدم `users`
- الهوية السحابية `Firebase Auth`
- صلاحيات المؤسسة `roles`
- المزامنة الحالية المبنية على `schoolId` و`Firebase`

---

## 2. الوضع الحالي المتحقق من الكود

### 2.1 الموجود بالفعل

- يوجد **Onboarding أول تشغيل** عبر:
  - `setup.html`
  - `js/pages/setup.js`
  - قنوات `setup.*` في `preload.js`
  - التنفيذ الفعلي داخل `main/ipc/linking.js`
- يوجد **Login محلي** عبر:
  - `login.html`
  - `js/pages/login.js`
  - `main/ipc/auth.js`
  - جدول SQLite: `users`
- يوجد **Firebase** مستعمل حاليًا في:
  - `main/firebase/config.js`
  - `main/sync/credentials.js`
  - `firebase/functions/index.js`
  - `firebase/firestore.rules`
- يوجد **ربط أجهزة** LAN + OTP بالفعل، وهذا مهم جدًا ولا يجب كسره.

### 2.2 الفجوات الحالية

- `auth:login` و`auth:register` في `main/ipc/auth.js` ما زالا يعتمدان على SQLite فقط.
- تبويب التسجيل في `login.html` موجود لكنه **مخفي ومعطل**.
- `login.js` يوجّه إلى `login.html#change-password` عند `mustChangePassword` لكن لا توجد شاشة حقيقية لهذا التدفق.
- Firebase Auth الحالي مخصص فعليًا لطبقة **sync credentials** وليس لهوية مستخدم التطبيق.
- `settings-users` ينشئ مستخدمين محليين فقط عبر `main/ipc/system.js`.
- `sync_config` يحتوي على `firebase_project_id` و`firebase_functions_url` فقط، لكنه لا يحمل كامل إعدادات Firebase اللازمة لـ email/password auth.

---

## 3. القرار المعماري المقترح

### 3.1 القرار الأساسي

**Firebase Auth يصبح المصدر الرئيسي لهوية المستخدمين**، بينما تبقى SQLite طبقة محلية لـ:

- cache للمستخدمين
- جلسة التطبيق داخل Electron
- fallback محدود عند انقطاع الشبكة
- PIN lock / unlock
- التكامل مع الصلاحيات الحالية وواجهات الإدارة

### 3.2 ما الذي يبقى كما هو

- `institution_config` يبقى هو المؤشر المحلي على أن المؤسسة أُعدّت على الجهاز.
- `linked_devices` يبقى كسجل للأجهزة المصرح لها (revoke/blacklist) فقط.
- `device_otp` يبقى كآلية تحقق عند ربط جهاز جديد بمؤسسة موجودة.
- `schoolId` يبقى هو هوية المؤسسة في السحابة.
- صلاحيات التطبيق الحالية تبقى في `main/auth/permissions.js`.

### 3.3 ما الذي يتغير

- أول مدير للمؤسسة ينشأ في Firebase Auth أثناء onboarding.
- المستخدمون الجدد ينشؤون في Firebase Auth + Firestore profile، وليس في SQLite فقط.
- `auth:login` يصبح Firebase-first بدل SQLite-only.
- `auth:register` لا يبقى self-signup مفتوحًا للجميع.
- إدارة المستخدمين (إضافة/تعطيل/حذف) حصرياً بيد المدير عبر Firebase.

### 3.4 ما يُحذف نهائياً — LAN Linking

**القرار:** LAN linking يُحذف كلياً من المشروع.

**الأسباب:**
- البيانات تُزامن عبر Firestore مع دعم offline-first — لا حاجة لنقل payload بين الأجهزة.
- المدير هو الوحيد الذي يضيف/يعطّل المستخدمين من Firebase مباشرة.
- نقل `password_hash` عبر الشبكة المحلية أصبح مخاطرة أمنية غير مبررة.

**ما يُحذف:**

| المكون | السبب |
|---|---|
| `main/linking/lan.js` | لا حاجة لـ LAN transport |
| `buildLinkBootstrapPayload()` | لا حاجة لنقل users/config عبر الشبكة |
| HTTP server على `:19876` | لا حاجة له |
| UDP broadcast على `:19877` | لا حاجة له |
| نقل `password_hash` و`pin_hash` عبر LAN | Firebase Auth يحل محله |

**ما يبقى من منظومة الربط:**
- OTP فقط كآلية تحقق عند ربط جهاز جديد — يُرسَل عبر Firebase أو يُدخَل يدوياً.
- الجهاز الجديد بعد التحقق من OTP يجلب إعدادات المؤسسة من Firestore مباشرة.

### 3.4 افتراضات الخطة

- **التسجيل العام المفتوح غير مرغوب** في هذا النوع من التطبيقات المدرسية.
- `signup` سيبقى في حالتين فقط:
  - إنشاء أول حساب مدير أثناء إعداد مؤسسة جديدة.
  - إنشاء حسابات لاحقة من طرف المدير أو أثناء ربط جهاز جديد مع OTP صالح.
- في حالة غياب الشبكة، يمكن السماح بـ **offline login محدود** فقط لمستخدم سبق له تسجيل الدخول بنجاح على نفس الجهاز.

---

## 4. الشكل النهائي المطلوب

## 4.1 رحلة 1: مؤسسة جديدة

1. التطبيق يفتح `setup.html` لأن `institution_config.setup_completed = 0`.
2. المستخدم يختار “مؤسسة جديدة”.
3. يُدخل:
   - MASSAR code
   - اسم المؤسسة
   - اسم المدير
   - بريد المدير
   - كلمة المرور
4. التطبيق يستدعي Cloud Function آمنة لإنشاء:
   - المؤسسة في Firestore
   - حساب Firebase Auth للمدير
   - claims: `schoolId`, `role`
   - profile document داخل المدرسة
5. التطبيق يحفظ محليًا:
   - `institution_config`
   - `sync_config`
   - نسخة محلية للمستخدم في `users`
6. يتم auto-login ثم الانتقال إلى `index.html`.

## 4.2 رحلة 2: ربط جهاز جديد بمؤسسة موجودة

1. التطبيق يفتح `setup.html`.
2. المستخدم يختار “ربط بمؤسسة موجودة”.
3. يدخل MASSAR + OTP + بيانات الحساب.
4. بعد نجاح OTP:
   - يتم استيراد إعدادات المؤسسة/السحابة
   - يتم إنشاء أو تفعيل حساب المستخدم في Firebase
   - يتم إنشاء local cache للمستخدم
5. يتم auto-login على الجهاز الجديد.

## 4.3 رحلة 3: مستخدم عائد

1. `institution_config.setup_completed = 1`
2. التطبيق يفتح `index.html` أو `login.html` حسب حالة الجلسة.
3. المستخدم يكتب email/password.
4. التطبيق يسجل الدخول عبر Firebase Auth.
5. يتم جلب profile والصلاحيات.
6. يتم إنشاء جلسة Electron الحالية مثل اليوم.

## 4.4 رحلة 4: أول دخول بكلمة مؤقتة

1. المدير ينشئ المستخدم من `settings-users`.
2. يتم تعيين `mustChangePassword = true`.
3. عند أول login:
   - يظهر نموذج تغيير كلمة المرور الحقيقي
   - بعد التغيير يتم تحديث Firebase + SQLite
   - تكمل الجلسة بشكل طبيعي

---

## 5. النموذج البياني المستهدف

## 5.1 SQLite

### جدول `users`

إضافة أعمدة جديدة:

- `firebase_uid TEXT`
- `auth_source TEXT DEFAULT 'firebase'`
- `email_verified INTEGER DEFAULT 0`
- `invite_status TEXT DEFAULT 'active'`
- `last_login_at DATETIME`
- `last_auth_mode TEXT`  — `online` أو `offline`

ملاحظات:

- `password_hash` لا يُحذف.
- سيُستخدم كـ offline fallback وكآلية متوافقة مع PIN/change password الحالية.
- `firebase_uid` يجب أن يكون `UNIQUE` عندما يكون غير فارغ.

### جدول `sync_config`

إضافة إعدادات Firebase client اللازمة للمصادقة:

- `firebase_api_key TEXT DEFAULT ''`
- `firebase_auth_domain TEXT DEFAULT ''`
- `firebase_app_id TEXT DEFAULT ''`
- `firebase_storage_bucket TEXT DEFAULT ''`
- `firebase_messaging_sender_id TEXT DEFAULT ''`

السبب:

- `main/firebase/config.js` يحتاج أكثر من `projectId` و`functionsUrl` إذا أردنا `email/password login`.

### جدول `institution_config`

إضافة حقول تنظيمية اختيارية:

- `onboarding_version INTEGER DEFAULT 1`
- `onboarding_completed_at DATETIME`

ليست إلزامية تقنيًا، لكنها تفيد في الترقية وإعادة الدخول إلى wizard عند الحاجة.

## 5.2 Firestore

إضافة بنية مستخدمين داخل المدرسة:

```text
schools/{schoolId}/meta/institution
schools/{schoolId}/users/{uid}
schools/{schoolId}/userInvites/{inviteId}
```

### `schools/{schoolId}/users/{uid}`

حقول مقترحة:

- `uid`
- `name`
- `email`
- `role`
- `status`  — `active`, `disabled`, `pending`
- `mustChangePassword`
- `createdAt`
- `updatedAt`
- `createdBy`
- `lastLoginAt`

### Claims في Firebase Auth

لكل مستخدم:

- `schoolId`
- `role`

هذه claims ستُستخدم في:

- Firestore Rules
- التحقق من الانتماء للمؤسسة
- الحماية من وصول مستخدم مدرسة إلى بيانات مدرسة أخرى

---

## 6. الملفات المطلوب إنشاؤها أو تعديلها

## 6.1 ملفات جديدة

| الملف | المسؤولية |
|---|---|
| `main/auth/firebase-auth-service.js` | تسجيل الدخول/الخروج عبر Firebase + جلب profile + fallback محلي |
| `main/auth/user-cache.js` | توحيد upsert بين Firebase profile وSQLite `users` |
| `js/pages/change-password.js` أو دمجها داخل `login.js` | شاشة تغيير كلمة المرور الأولى |
| `tests/auth-firebase-flow.js` أو توسعة `tests/integration-firebase.js` | اختبارات onboarding/login/signup |

## 6.2 ملفات تُعدّل

| الملف | التعديل |
|---|---|
| `main/ipc/auth.js` | تحويل `auth:login` إلى Firebase-first، ضبط الجلسة، إلغاء self-signup المفتوح |
| `main/ipc/linking.js` | onboarding لمؤسسة جديدة + account creation عند OTP link |
| `main/ipc/system.js` | `users:add/updateRole/disable` تصبح متزامنة مع Firebase Auth/Firestore |
| `preload.js` | قنوات auth/setup الجديدة أو المعدلة |
| `login.html` | تفعيل تدفق login/change-password وإعادة تعريف signup |
| `js/pages/login.js` | Firebase login, error mapping, must-change-password flow |
| `setup.html` | تحويله إلى onboarding موحد بدل setup تقني فقط |
| `js/pages/setup.js` | bootstrap المؤسسة + auto-login + linked-device signup |
| `main/firebase/config.js` | قراءة كامل Firebase client config من env أو SQLite |
| `main/firebase/collections.js` | إضافة collections الخاصة بالمستخدمين |
| `firebase/functions/index.js` | bootstrap institution, provision user, role update, disable/enable |
| `firebase/firestore.rules` | قواعد users/meta/invites داخل `schools/{schoolId}` |
| `main/db/migrations.js` | migrations الخاصة بالمستخدمين وFirebase client config |
| `tests/integration-firebase.js` | توسيع اختبارات Emulator لتشمل auth user flows |

---

## 7. مراحل التنفيذ

## Phase 0: تثبيت القرارات والحدود

- [ ] اعتماد أن `signup` ليس public self-signup بعد اكتمال المؤسسة.
- [ ] فصل واضح بين:
  - user auth
  - sync/device auth
- [ ] اعتماد `schoolId = MASSAR code normalized` كمصدر موحد.
- [ ] اعتماد Firebase Auth كمصدر حقيقة، وSQLite كـ cache/fallback.

**معيار القبول:**

- توجد وثيقة قرار قصيرة داخل هذا الملف أو README الداخلي توضّح السياسة.

## Phase 1: توسعة قاعدة البيانات المحلية

- [ ] إضافة migration لحقول `users` الجديدة:
  - `firebase_uid`
  - `auth_source`
  - `email_verified`
  - `invite_status`
  - `last_login_at`
  - `last_auth_mode`
- [ ] إضافة migration لحقول Firebase client config في `sync_config`.
- [ ] إضافة index/constraint على `firebase_uid`.
- [ ] كتابة backfill آمن:
  - `auth_source = 'local'` للمستخدمين القدامى إن لم يُربطوا بعد
  - تحديثها إلى `firebase` بعد migration الناجحة

**معيار القبول:**

- تشغيل التطبيق على قاعدة قديمة لا يكسر login الحالي.
- قاعدة جديدة تحتوي الحقول الجديدة تلقائيًا.

## Phase 2: بناء طبقة Firebase Auth للمستخدمين

- [ ] إنشاء `main/auth/firebase-auth-service.js`.
- [ ] توفير API موحّد:
  - `loginWithEmailPassword`
  - `logoutCurrentUser`
  - `loadCurrentUserProfile`
  - `changePassword`
  - `canUseOfflineLogin`
- [ ] تعديل `main/firebase/config.js` ليقرأ config من:
  - env أولًا
  - ثم `sync_config` إن وجدت القيم
- [ ] عدم تخزين refresh tokens في SQLite.

**معيار القبول:**

- يمكن تسجيل دخول Firebase من main process بشكل موثوق.
- عند غياب config، تظهر رسائل خطأ واضحة بدل الانهيار.

## Phase 3: Cloud Functions للمؤسسة والمستخدمين

- [ ] إضافة function `bootstrapInstitution`.
- [ ] إضافة function `provisionSchoolUser`.
- [ ] إضافة function `updateSchoolUserRole`.
- [ ] إضافة function `setSchoolUserDisabled`.
- [ ] عند bootstrap:
  - إنشاء document المؤسسة
  - إنشاء Firebase user لأول مدير
  - تعيين claims
  - إنشاء profile داخل `schools/{schoolId}/users/{uid}`
- [ ] عند provisioning:
  - إنشاء user أو تحديثه
  - ضبط claims
  - حفظ profile
  - إرجاع temporary password عند الحاجة

**معيار القبول:**

- يمكن إنشاء مؤسسة جديدة end-to-end عبر Emulator.
- يمكن إنشاء مستخدم جديد من admin panel مع profile + claims.

## Phase 4: تحديث Firestore Rules

- [ ] توسيع `firebase/firestore.rules` لتشمل:
  - `schools/{schoolId}/meta/*`
  - `schools/{schoolId}/users/{uid}`
  - `schools/{schoolId}/userInvites/{inviteId}`
- [ ] اعتماد claim `schoolId` للحماية.
- [ ] السماح للمدير فقط بكتابة users/invites.
- [ ] السماح للمستخدم بقراءة profile الخاص به، وبالقراءة الإدارية عند الحاجة.

**معيار القبول:**

- مستخدم مدرسة A لا يستطيع قراءة users أو data لمدرسة B.
- المستخدم disabled لا يحصل على صلاحيات كتابة بعد التعطيل.

## Phase 5: إعادة تصميم `setup` إلى onboarding حقيقي

- [ ] إبقاء `setup.html` كنقطة الدخول لأول تشغيل.
- [ ] تحويل “مؤسسة جديدة” من local bootstrap إلى Firebase bootstrap.
- [ ] حفظ config العائد من bootstrap داخل:
  - `institution_config`
  - `sync_config`
  - local cached admin user
- [ ] في مسار “ربط بمؤسسة موجودة”:
  - بعد OTP الناجح، إنشاء/تفعيل حساب Firebase للمستخدم الجديد
  - ثم auto-login
- [ ] إضافة خطوة نهائية واضحة:
  - “تم إعداد المؤسسة”
  - “تم إنشاء حسابك”
  - “جاري تسجيل الدخول”

**معيار القبول:**

- جهاز جديد يمكنه إنشاء مؤسسة كاملة من الصفر.
- جهاز جديد يمكنه الالتحاق بمؤسسة موجودة وإنشاء حسابه من OTP flow.

## Phase 6: تحديث login/signup/change-password

- [ ] تعديل `login.html` ليصبح context-aware:
  - إن لم تكن المؤسسة مجهزة: redirect إلى `setup.html`
  - إن كانت المؤسسة مجهزة: إظهار login
  - إظهار signup فقط عندما يكون مسموحًا في السياق
- [ ] تعديل `js/pages/login.js`:
  - Firebase-first login
  - offline fallback عند فشل الشبكة فقط
  - حفظ local session كما هو لكن مع `source: 'firebase'`
- [ ] تنفيذ شاشة حقيقية لـ change password بدل `#change-password` فقط.
- [ ] تحديث رسائل الأخطاء لتغطي:
  - invalid credentials
  - disabled user
  - email not found
  - weak password
  - network unavailable

**معيار القبول:**

- login ينجح online عبر Firebase.
- offline fallback يعمل فقط لمستخدم سبق له login على هذا الجهاز.
- تدفق `mustChangePassword` مكتمل فعليًا.

## Phase 7: مزامنة إدارة المستخدمين مع Firebase

- [ ] تعديل `main/ipc/system.js` بحيث:
  - `users:add` ينشئ المستخدم في Firebase + Firestore + SQLite
  - `users:updateRole` يحدّث role محليًا وسحابيًا
  - `users:disable` يعطّل المستخدم محليًا وسحابيًا
- [ ] تعديل `settings-users.js` لعرض:
  - حالة الربط مع Firebase
  - هل المستخدم local-only أم migrated
  - هل يجب تغيير كلمة المرور
- [ ] إضافة خطوة migration للمستخدمين الحاليين:
  - فحص الإيميلات المكررة/غير الصالحة
  - Provision لكل user موجود
  - حفظ `firebase_uid`

**معيار القبول:**

- لوحة المستخدمين لا تنشئ حسابات محلية orphan بعد الآن.
- الأدوار والتعطيل تنعكس في Firebase وSQLite معًا.

## Phase 8: Backfill وترقية المستخدمين القدامى

- [ ] إنشاء أداة ترحيل one-time للمستخدمين المحليين الحاليين.
- [ ] قواعد migration:
  - المستخدم الذي بلا email صالح لا يُرحّل تلقائيًا
  - المستخدم ذو email مكرر يدخل في تقرير خطأ
  - `must_change_password` يُحترم
- [ ] بعد نجاح الترحيل:
  - `firebase_uid` يُخزن محليًا
  - `auth_source` يصبح `firebase`

**معيار القبول:**

- مؤسسة قائمة تستطيع الترقية دون فقدان المستخدمين.
- تظهر قائمة واضحة بالحالات التي تحتاج تصحيحًا يدويًا.

## Phase 9: الاختبارات

- [ ] اختبار onboarding لمؤسسة جديدة.
- [ ] اختبار linking لمؤسسة موجودة عبر OTP.
- [ ] اختبار login ناجح.
- [ ] اختبار login بفشل كلمة المرور.
- [ ] اختبار disabled user.
- [ ] اختبار must-change-password.
- [ ] اختبار users:add من admin panel.
- [ ] اختبار role update.
- [ ] اختبار offline fallback.
- [ ] اختبار أن sync credentials لم تنكسر بعد إضافة user auth.

**معيار القبول:**

- Emulator suite تغطي auth + firestore + functions.
- لا يوجد regression في `tests/integration-firebase.js`.

---

## 8. ترتيب التنفيذ العملي الموصى به

1. ابدأ بالمهايئات والموديل المحلي `Phase 1`.
2. أنشئ Cloud Functions وRules `Phase 3 + Phase 4`.
3. ابنِ طبقة `firebase-auth-service` في main process `Phase 2`.
4. حدّث `setup` قبل `login`.
5. حدّث `login` و`change-password`.
6. حدّث `settings-users`.
7. نفّذ migration للمستخدمين الحاليين.
8. أخيرًا فعّل الاختبارات وrollout التدريجي.

السبب:

- `setup` و`login` سيعتمدان على backend contract جديد.
- إدارة المستخدمين لا يجب أن تُحدّث قبل أن تصبح claims/profiles جاهزة.
- migration للمستخدمين الحاليين يجب أن تأتي بعد ثبات العقدة الجديدة.

---

## 9. مخاطر يجب الانتباه لها

## 9.1 خلط user auth مع device auth

الخطر:

- كسر المزامنة الحالية إذا حاولنا إعادة استخدام custom token الخاص بالجهاز كأنه جلسة مستخدم.

التخفيف:

- إبقاء `main/sync/credentials.js` منفصلًا عن `main/ipc/auth.js`.

## 9.2 فقدان offline usability

الخطر:

- لو أصبح login سحابيًا صرفًا، سيفشل العمل عندما تنقطع الشبكة.

التخفيف:

- الاحتفاظ بـ `password_hash` المحلي كـ fallback محدود.

## 9.3 open signup غير المنضبط

الخطر:

- أي شخص يعرف project config قد يحاول إنشاء حسابات غير مصرح بها.

التخفيف:

- منع public signup بعد bootstrap الأول.
- إنشاء المستخدمين عبر admin/OTP/Cloud Function فقط.

## 9.4 تعارض users الحاليين مع Firebase

الخطر:

- وجود إيميلات مكررة أو ناقصة يمنع backfill.

التخفيف:

- تقرير migration واضح قبل التنفيذ النهائي.

---

## 10. النتيجة النهائية المتوقعة

عند اكتمال هذه الخطة سيصبح لدينا:

- Onboarding موحد للمؤسسة والجهاز والمستخدم.
- Signup مضبوط ومغلق حسب صلاحيات المؤسسة.
- Login مبني على Firebase Auth مع تجربة Electron مناسبة.
- Users management متزامنة محليًا وسحابيًا.
- Change password وmust-change-password مكتملان فعليًا.
- احتفاظ بمزايا SQLite وPIN وoffline-first بدل خسارتها.

---

## 11. أول Sprint مقترح

- [ ] Migration لحقول `users` و`sync_config`
- [ ] `main/auth/firebase-auth-service.js`
- [ ] Cloud Function `bootstrapInstitution`
- [ ] تعديل `setup-new-institution`
- [ ] login عبر Firebase
- [ ] شاشة change-password حقيقية
- [ ] اختبار مؤسسة جديدة end-to-end على Emulator

إذا نجح هذا الـ Sprint، ننتقل إلى:

- linked-device signup
- admin user provisioning
- local users backfill

