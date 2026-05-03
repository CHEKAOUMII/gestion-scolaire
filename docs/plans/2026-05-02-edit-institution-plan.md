# خطة تعديل معطيات المؤسسة بعد الإعداد الأولي

التاريخ: 2026-05-02

الهدف: تمكين مدير المؤسسة من طلب تصحيح `code_etablissement` واسم المؤسسة إذا وقع خطأ عند إنشاء حساب المؤسسة لأول مرة، ثم تمكين مدير التطبيق المركزي من مراجعة الطلب والموافقة عليه أو رفضه، مع عدم كسر Firebase Auth أو مسارات Firestore أو نظام المزامنة.

## 1. الخلاصة التنفيذية

تعديل اسم المؤسسة عملية بسيطة نسبيا لأنها لا تغير tenant ولا مسارات Firestore. تغيير `code_etablissement` عملية حساسة لأن التطبيق يستعمله فعليا كـ `school_id` في:

- `sync_config.school_id`
- `institution_config.code_etablissement`
- Firebase Auth custom claim: `schoolId`
- Firestore paths: `schools/{schoolId}/...`
- Sync log path: `syncLog/{schoolId}/changes/...`

لذلك لا يجب تنفيذ تغيير الرمز محليا فقط، ولا يجب أن يكون قرار التغيير بيد مدير المؤسسة مباشرة. التغيير الصحيح يكون عبر نظام طلب وموافقة:

1. مدير المؤسسة `principal` يرسل طلب تعديل من داخل تطبيق مؤسسته.
2. مدير التطبيق المركزي `admin` أو `developer` يراجع الطلب في صفحة "ادارة التطبيق".
3. عند الموافقة فقط، تنفذ Cloud Function بصلاحيات Admin SDK نقل/نسخ بيانات المؤسسة وتحديث claims.
4. أجهزة المؤسسة تطبق نتيجة الموافقة محليا بتحديث SQLite، مسح credentials cache، ثم إجبار تسجيل دخول جديد إذا تغير الرمز.

## 2. قرار الصلاحيات

المطلوب: "مدير التطبيق". في الكود الحالي:

- `admin` = مدير التطبيق حسب `ROLE_LABELS` في `main/auth/permissions.js`
- `principal` = مدير المؤسسة
- `developer` يتجاوز `requireRole()` تلقائيا
- أول حساب ينشئه `bootstrapInstitution` حاليا يأخذ role = `principal`

القرار المعتمد:

- `principal` لا يملك صلاحية تنفيذ التعديل مباشرة. صلاحيته هي إنشاء طلب تعديل من داخل مؤسسة واحدة فقط، وهي المؤسسة المرتبطة بـ `schoolId` الموجود في token.
- `admin` هو مدير التطبيق المركزي، ويملك صلاحية مراجعة طلبات كل المؤسسات والموافقة أو الرفض.
- `developer` يملك نفس صلاحية `admin` عبر bypass الحالي في `requireRole()`.
- تنفيذ migration أو تحديث Auth custom claims لا يتم إلا من Cloud Function بعد موافقة `admin` أو `developer`.
- أي handler محلي ينفذ تغييرا فعليا في هوية المؤسسة يجب أن يرفض `principal` ما لم يكن يطبق قرارا معتمدا مسبقا صادر من Cloud Function.

## 3. الوضع الحالي بعد الفحص

### التخزين المحلي

| المكان | الحقل | الملاحظة |
|---|---|---|
| `institution_config` | `code_etablissement` | الرمز المحلي الأساسي للمؤسسة |
| `institution_config` | `institution_name` | اسم المؤسسة في onboarding/status |
| `institution_config` | `massar_code` | legacy محتمل، يتم تحديثه في بعض المسارات إذا وجد |
| `sync_config` | `school_id` | tenant id الذي يستعمله sync push/pull |
| `school_identity` | `school_name`, `school_code` | هوية التقارير والطباعة، مستقلة عن onboarding |

### Firebase

| المكان | الاستعمال |
|---|---|
| `schools/{schoolId}` | وثيقة جذر المؤسسة |
| `schools/{schoolId}/meta/institution` | بيانات المؤسسة التفصيلية |
| `schools/{schoolId}/users/{uid}` | profiles المستخدمين |
| `schools/{schoolId}/{syncCollection}` | بيانات المزامنة مثل students/teachers/settings/... |
| `syncLog/{schoolId}/changes/{changeId}` | سجل التغييرات الذي يستهلكه pull |
| Firebase Auth custom claims | `schoolId` و `role` لكل مستخدم |

### IPC الحالي

| القناة | الحالة |
|---|---|
| `institution:get-status` | موجودة، قراءة فقط |
| `institution:setup-new` | إنشاء أول مرة فقط، ترفض إذا setup مكتمل |
| `institution:relink` | موجودة لكنها تعيد `setup_completed = 0`، غير مناسبة لتصحيح مؤسسة نشطة |
| `institution:submitIdentityChangeRequest` | غير موجودة، يجب إضافتها لإرسال الطلب من `principal` |
| `institution:getIdentityChangeRequests` | غير موجودة، يجب إضافتها لعرض طلبات المؤسسة الحالية |
| `institution:applyApprovedIdentityChange` | غير موجودة، يجب إضافتها لتطبيق طلب معتمد محليا بعد موافقة المدير المركزي |
| `appAdmin:listIdentityChangeRequests` | غير موجودة، يجب إضافتها لصفحة "ادارة التطبيق" |
| `appAdmin:approveIdentityChangeRequest` | غير موجودة، يجب إضافتها للموافقة وتنفيذ migration |
| `appAdmin:rejectIdentityChangeRequest` | غير موجودة، يجب إضافتها لرفض الطلب |

### Sync الحالي

- `main/sync/capture.js` يستثني `institution:setup-new` و `institution:relink` من capture.
- `main/sync/engine.js` يقرأ `school_id` عند كل push/pull، لكن listener يحتاج restart بعد تغيير الرمز.
- `main/sync/credentials.js` يرفض credentials إذا `token.schoolId` لا يساوي `readSchoolId(db)`.
- `pull_cursor` مرتبط عمليا بمسار `syncLog/{oldSchoolId}` ويجب تصفيره بعد تغيير الرمز.

## 4. التصميم المعماري المقترح

### 4.1 دورة الطلب والموافقة

المسار المعتمد:

1. `principal` يفتح `settings-users.html` ويرسل طلب تعديل هوية المؤسسة.
2. IPC محلي يتحقق أن الدور `principal` وأن الطلب يخص المؤسسة الحالية فقط.
3. Cloud Function `submitInstitutionIdentityChangeRequest` تحفظ الطلب في collection مركزية:
   - `institutionIdentityRequests/{requestId}`
4. الطلب يبقى بحالة `pending` ولا يحدث أي تغيير في SQLite أو Firebase tenant.
5. `admin` أو `developer` يفتح صفحة "ادارة التطبيق" ويرى طلبات كل المؤسسات.
6. عند الرفض، Cloud Function تغير الحالة إلى `rejected` وتحفظ سبب الرفض.
7. عند الموافقة، Cloud Function `approveInstitutionIdentityChangeRequest` تنفذ التحديث أو migration ثم تغير الحالة إلى `approved`.
8. جهاز المؤسسة يقرأ حالة الطلب المعتمد من شاشة الطلبات، ثم يستدعي `institution:applyApprovedIdentityChange` لتطبيق النتيجة محليا.
9. إذا تغير `code_etablissement`، يتم مسح credentials cache وإجبار تسجيل دخول جديد للحصول على token claim جديد.

### 4.2 تحديث الاسم فقط

حتى تغيير الاسم فقط يمر عبر الطلب والموافقة لأن مدير التطبيق مسؤول مركزيا عن كل المؤسسات. الفرق أنه عند الموافقة:

1. Cloud Function تحدث `schools/{schoolId}` و `schools/{schoolId}/meta/institution`.
2. لا تغير `sync_config.school_id`.
3. `institution:applyApprovedIdentityChange` يحدث SQLite:
   - `institution_config.institution_name`
   - اختياريا `school_identity.school_name` إذا طلبت المؤسسة ذلك.
4. لا حاجة لتصفير `pull_cursor` ولا لإجبار login إذا لم تتغير claims.

### 4.3 تغيير الرمز

المسار الآمن عند موافقة مدير التطبيق:

1. preflight محلي عند إرسال الطلب: التأكد من عدم وجود conflicts غير محلولة، ويفضل دفع pending outbox قبل المتابعة.
2. preflight سحابي عند الموافقة: التأكد أن الطلب ما زال `pending` وأن `schools/{newSchoolId}` غير موجود.
3. Cloud Function بصلاحيات Admin تتحقق من صلاحية الموافق وتنفذ migration من `oldSchoolId` إلى `newSchoolId`.
4. Cloud Function تحدّث custom claims لكل مستخدمي المؤسسة.
5. Cloud Function تضع المدرسة القديمة في حالة `migrated` وتمنع الكتابة عليها عبر Firestore rules.
6. `institution:applyApprovedIdentityChange` يحدّث SQLite في transaction على جهاز المؤسسة.
7. مسح credentials cache وإجبار تسجيل دخول جديد للحصول على token claim جديد.
8. إعادة تشغيل sync push/pull/listener على `newSchoolId`.

مبدأ مهم: لا تحذف pending outbox تلقائيا. حذفها يفقد تعديلات محلية غير مرسلة. الأفضل:

- إما تشغيل push قبل migration والتأكد من `pendingCount = 0`
- أو ترك outbox كما هو ليُرسل إلى المسار الجديد بعد نجاح migration وتحديث token
- لكن في وجود conflicts أو failed outbox يجب منع العملية إلى أن تُحل

## 5. الملفات التي تحتاج تعديل

### 5.1 `firebase/functions/index.js`

إضافة Cloud Functions خاصة بنظام الطلب والموافقة.

#### `submitInstitutionIdentityChangeRequest`

المسؤوليات:

- `POST` فقط.
- تقبل: `{ idToken, newSchoolId?, institutionName?, reason?, syncSchoolIdentity? }`.
- تتحقق أن caller role هو `principal`.
- تعتمد `oldSchoolId` واسم المؤسسة الحالي من decoded token وFirestore، وليس من payload.
- تتحقق من صحة `newSchoolId` بنفس قواعد التطبيق المحلي إذا أرسل.
- تتحقق من وجود تغيير فعلي في الاسم أو الرمز.
- تمنع إنشاء طلب جديد إذا كانت هناك طلبات `pending` لنفس `oldSchoolId`.
- تنشئ وثيقة في `institutionIdentityRequests/{requestId}`:
  - `status: 'pending'`
  - `oldSchoolId`
  - `newSchoolId`
  - `oldInstitutionName`
  - `newInstitutionName`
  - `requestedByUid`
  - `requestedByEmail`
  - `requestedByRole: 'principal'`
  - `reason`
  - `syncSchoolIdentity`
  - `createdAt`
  - `updatedAt`
- لا تعدل `schools/{schoolId}` ولا Auth claims ولا SQLite.

#### `listInstitutionIdentityChangeRequests`

المسؤوليات:

- `POST` فقط.
- تقبل: `{ idToken, status?, schoolId?, limit? }`.
- تتحقق أن caller role هو `admin` أو `developer`.
- ترجع الطلبات المركزية مرتبة من الأحدث إلى الأقدم.
- تدعم فلترة `pending`, `approved`, `rejected`, `failed`.
- لا تعتمد على `schoolId` الموجود في token كحد للقراءة، لأن مدير التطبيق مسؤول عن كل المؤسسات.

#### `rejectInstitutionIdentityChangeRequest`

المسؤوليات:

- `POST` فقط.
- تقبل: `{ idToken, requestId, rejectionReason }`.
- تتحقق أن caller role هو `admin` أو `developer`.
- تتحقق أن الطلب ما زال `pending`.
- تحدث الطلب:
  - `status: 'rejected'`
  - `reviewedByUid`
  - `reviewedByEmail`
  - `reviewedAt`
  - `rejectionReason`
  - `updatedAt`

#### `approveInstitutionIdentityChangeRequest`

المسؤوليات:

- `POST` فقط.
- تقبل: `{ idToken, requestId, dryRun? }`.
- تتحقق أن caller role هو `admin` أو `developer`.
- تتحقق أن الطلب ما زال `pending`.
- تتحقق أن `schools/{oldSchoolId}` موجود.
- تتحقق أن `schools/{newSchoolId}` غير موجود إذا تغير الرمز.
- تنشئ migration marker في `schools/{oldSchoolId}/meta/institutionMigration`.
- إذا تغير الرمز، تنسخ وثيقة الجذر `schools/{old}` إلى `schools/{new}` مع تحديث:
  - `schoolId`
  - `gresaCode`
  - `institutionName`
  - `migratedFrom`
  - `updatedAt`
- إذا تغير الرمز، تنسخ subcollections تحت `schools/{old}` إلى `schools/{new}` باستعمال `listCollections()` و batches.
- إذا تغير الرمز، تنسخ `syncLog/{old}/changes/*` إلى `syncLog/{new}/changes/*`.
- تحدث `schools/{targetSchoolId}/meta/institution` بنفس القيم الجديدة.
- تحدث `schools/{targetSchoolId}/users/{uid}.schoolId` عند الحاجة.
- تحدث Auth custom claims لكل `uid` في users:
  - `{ ...existingClaims, schoolId: newSchoolId, role }`
- تترك `schools/{old}` موجودة بحالة عند تغيير الرمز:
  - `status: 'migrated'`
  - `migratedTo: newSchoolId`
  - `writesDisabled: true`
- تحدث وثيقة الطلب:
  - `status: 'approved'`
  - `approvedByUid`
  - `approvedByEmail`
  - `approvedAt`
  - `migrationId`
  - `resultSchoolId`
  - `requiresLocalApply: true`
  - `requiresRelogin: codeChanged`
  - `updatedAt`
- لا تحذف المسار القديم في نفس الإصدار الأول. الحذف يكون cleanup لاحق بعد التأكد من انتقال كل الأجهزة.

#### `getInstitutionIdentityChangeRequestsForSchool`

المسؤوليات:

- `POST` فقط.
- تقبل: `{ idToken }`.
- تسمح لـ `principal` بقراءة طلبات مؤسسته فقط.
- تعتمد `schoolId` من decoded token، وتبحث في الطلبات التي يكون `oldSchoolId` أو `resultSchoolId` مطابقا له.
- ترجع آخر الطلبات مع الحالة وسبب الرفض أو نتيجة الموافقة.

تعديلات مساعدة:

- إضافة helper `copyDocumentTree(sourceRef, targetRef, options)`.
- إضافة helper `copyCollection(sourceCollectionRef, targetCollectionRef, counters)`.
- رفع إعدادات function: `timeoutSeconds: 540`, `memory: '1GiB'` إذا كانت كمية البيانات كبيرة.
- تحديث `functionError()` لإرجاع أكواد:
  - `REQUEST_NOT_FOUND`
  - `REQUEST_ALREADY_REVIEWED`
  - `PENDING_REQUEST_EXISTS`
  - `TARGET_SCHOOL_EXISTS`
  - `INVALID_SCHOOL_ID`
  - `MIGRATION_IN_PROGRESS`
  - `FORBIDDEN`
  - `SCHOOL_NOT_FOUND`

### 5.2 `firebase/firestore.rules`

تعديل القواعد لمنع الأجهزة القديمة من الكتابة في المؤسسة القديمة بعد migration.

طلبات تعديل هوية المؤسسة يجب ألا تكتب مباشرة من العميل. المسار المعتمد هو Cloud Functions فقط، لذلك أضف قاعدة تمنع الكتابة المباشرة:

```js
match /institutionIdentityRequests/{requestId} {
  allow read, write: if false;
}
```

إذا احتجنا قراءة مباشرة لاحقا يمكن فتح قراءة محدودة، لكن الإصدار الأول يبقي كل القراءة والكتابة عبر Cloud Functions لتفادي تسريب طلبات مؤسسات أخرى.

إضافة دالة:

```js
function isMigratedSchool(schoolId) {
  return exists(/databases/$(database)/documents/schools/$(schoolId))
      && get(/databases/$(database)/documents/schools/$(schoolId)).data.status == 'migrated';
}
```

تعديل writes:

```js
match /schools/{schoolId}/{collection}/{docId} {
  allow read: if !(collection in ['meta', 'users', 'userInvites'])
      && canSyncSchoolData(schoolId);
  allow write: if !(collection in ['meta', 'users', 'userInvites'])
      && canSyncSchoolData(schoolId)
      && !isMigratedSchool(schoolId);
}

match /syncLog/{schoolId}/changes/{changeId} {
  allow read: if canSyncSchoolData(schoolId);
  allow write: if canSyncSchoolData(schoolId) && !isMigratedSchool(schoolId);
}
```

ملاحظة: Cloud Function تستخدم Admin SDK ولا تتأثر بالقواعد.

### 5.3 `main/ipc/institution.js`

إضافة handlers لمسار المؤسسة المحلية.

#### `institution:submitIdentityChangeRequest`

يستخدم `handleWrite` لأن العملية إدارية:

```js
handleWrite(ipcMain, 'institution:submitIdentityChangeRequest', ['principal'], async (db, event, payload) => {
  // developer bypass موجود في requireRole، لكن الواجهة تعرضه لـ principal فقط
});
```

المسؤوليات:

- قراءة الوضع الحالي عبر `getInstitutionStatusRecord(db)`.
- رفض العملية إذا `setupCompleted` غير صحيح.
- validation:
  - `institutionName`: غير فارغ إذا أرسل.
  - `code_etablissement`: حاليا الكود يستعمل `MASSAR_REGEX`. يجب إعادة تسمية helper إلى `normalizeInstitutionCode`.
  - إذا كان code etablissement الفعلي ليس Massar regex، يجب توسيع regex بدل إبقاء رسالة "رمز ماسار".
- مقارنة القيم الجديدة بالقديمة والتأكد من وجود تغيير فعلي.
- preflight قبل إرسال طلب تغيير الرمز:
  - إذا يوجد `failed` أو `pending` كثير في `sync_outbox`: أرجع رسالة تطلب تشغيل sync أولا.
  - إذا يوجد `unresolved` في `sync_conflicts`: ارفض إلى أن تُحل.
- الحصول على Firebase id token عبر `getCurrentFirebaseIdToken(true)`.
- استدعاء `${functionsUrl}/submitInstitutionIdentityChangeRequest`.
- لا تعدل SQLite عند إنشاء الطلب.
- إرجاع:
  - `{ success: true, requestId, status: 'pending' }`

#### `institution:getIdentityChangeRequests`

```js
handleRead(ipcMain, 'institution:getIdentityChangeRequests', ['principal'], async (db, event, payload) => {
  // يعرض طلبات المؤسسة الحالية فقط
});
```

المسؤوليات:

- الحصول على Firebase id token.
- استدعاء `${functionsUrl}/getInstitutionIdentityChangeRequestsForSchool`.
- عرض الطلبات المرتبطة بالمؤسسة الحالية فقط، بما فيها `pending`, `approved`, `rejected`, `failed`.

#### `institution:applyApprovedIdentityChange`

يستخدم `handleWrite` لكنه لا يسمح بقرار تعديل جديد. وظيفته تطبيق قرار موافقة صادر من Cloud Function:

```js
handleWrite(ipcMain, 'institution:applyApprovedIdentityChange', ['principal'], async (db, event, payload) => {
  // يتحقق من requestId وحالة approved من Cloud Function قبل تعديل SQLite
});
```

المسؤوليات:

- قراءة الوضع الحالي عبر `getInstitutionStatusRecord(db)`.
- رفض العملية إذا `setupCompleted` غير صحيح.
- الحصول على Firebase id token عبر `getCurrentFirebaseIdToken(true)`.
- استدعاء Cloud Function للتحقق أن الطلب `approved` وأنه يخص المؤسسة الحالية.
- إذا لم يكن الطلب معتمدا، لا تعدل SQLite.
- إذا كان معتمدا، نفذ transaction محلي:
  - `institution_config.code_etablissement = newCode`
  - `institution_config.institution_name = newName`
  - `institution_config.massar_code = newCode` إذا وجد العمود
  - `sync_config.school_id = newCode` إذا تغير الرمز
  - `sync_config.pull_cursor = NULL` إذا تغير الرمز
  - `sync_config.last_pull_at = NULL` إذا تغير الرمز
  - `sync_config.last_pull_error = NULL`
  - `sync_config.last_push_error = NULL`
  - `sync_config.updated_at = CURRENT_TIMESTAMP`
  - تحديث `school_identity.school_code` و `school_identity.school_name` إذا طلب المستخدم ذلك
- بعد transaction:
  - `clearCredentials()` إذا تغير الرمز
  - `restartSyncPushBackground()` إذا تغير الرمز
  - `restartSyncPullBackground()` إذا تغير الرمز
  - `restartSnapshotBackground()` إذا تغير الرمز
- إرجاع:
  - `{ success: true, codeChanged, requireRelogin: codeChanged, institution: {...} }`

### 5.4 `main/ipc/app-admin.js`

إضافة ملف IPC جديد خاص بادارة التطبيق المركزية، أو إضافته إلى ملف IPC إداري موجود إذا كان هناك نمط قائم.

القنوات:

```js
handleRead(ipcMain, 'appAdmin:listIdentityChangeRequests', ['admin'], async (db, event, payload) => {});
handleWrite(ipcMain, 'appAdmin:approveIdentityChangeRequest', ['admin'], async (db, event, payload) => {});
handleWrite(ipcMain, 'appAdmin:rejectIdentityChangeRequest', ['admin'], async (db, event, payload) => {});
```

ملاحظة: `developer` يستفيد من bypass الحالي في `requireRole()`.

المسؤوليات:

- الحصول على Firebase id token عبر `getCurrentFirebaseIdToken(true)`.
- استدعاء Cloud Functions المركزية:
  - `listInstitutionIdentityChangeRequests`
  - `approveInstitutionIdentityChangeRequest`
  - `rejectInstitutionIdentityChangeRequest`
- عدم تعديل SQLite الخاص بجهاز مدير التطبيق عند مراجعة طلب مؤسسة أخرى.
- إرجاع نتائج واضحة للواجهة:
  - عدد الطلبات
  - حالة كل طلب
  - سبب الرفض إن وجد
  - نتيجة migration عند الموافقة

### 5.5 `main/sync/capture.js`

إضافة القنوات الجديدة إلى `CHANNEL_REGISTRY` كقنوات مستثناة من sync capture:

```js
'institution:submitIdentityChangeRequest': {
  tables: [],
  operation: 'POST',
  idExtractor: 'none',
  exclude: true
},
'institution:getIdentityChangeRequests': {
  tables: [],
  operation: 'GET',
  idExtractor: 'none',
  exclude: true
},
'institution:applyApprovedIdentityChange': {
  tables: [],
  operation: 'PUT',
  idExtractor: 'none',
  exclude: true
},
'appAdmin:listIdentityChangeRequests': {
  tables: [],
  operation: 'GET',
  idExtractor: 'none',
  exclude: true
},
'appAdmin:approveIdentityChangeRequest': {
  tables: [],
  operation: 'PUT',
  idExtractor: 'none',
  exclude: true
},
'appAdmin:rejectIdentityChangeRequest': {
  tables: [],
  operation: 'PUT',
  idExtractor: 'none',
  exclude: true
}
```

السبب: بيانات المؤسسة tenant metadata وليست row عادية داخل collections المزامنة.

### 5.6 `preload.js`

إضافة APIs في `window.api.institution`:

```js
submitIdentityChangeRequest: (payload) => ipcRenderer.invoke('institution:submitIdentityChangeRequest', payload),
getIdentityChangeRequests: (payload) => ipcRenderer.invoke('institution:getIdentityChangeRequests', payload),
applyApprovedIdentityChange: (payload) => ipcRenderer.invoke('institution:applyApprovedIdentityChange', payload)
```

إضافة namespace جديد:

```js
appAdmin: {
  listIdentityChangeRequests: (payload) => ipcRenderer.invoke('appAdmin:listIdentityChangeRequests', payload),
  approveIdentityChangeRequest: (payload) => ipcRenderer.invoke('appAdmin:approveIdentityChangeRequest', payload),
  rejectIdentityChangeRequest: (payload) => ipcRenderer.invoke('appAdmin:rejectIdentityChangeRequest', payload)
}
```

### 5.7 `settings-users.html`

إضافة قسم خاص بـ `principal` داخل صفحة المستخدمين لإرسال طلب تعديل هوية المؤسسة.

العنوان المقترح:

- "طلب تعديل هوية المؤسسة"

الحقول:

- حقل `code_etablissement` الجديد.
- حقل `institution_name` الجديد.
- textarea: سبب الطلب.
- checkbox اختياري: "تحديث بيانات رأس الوثائق أيضا".
- زر: "إرسال طلب التعديل".

تنبيه واضح عند تغيير الرمز:

- الطلب سيصل إلى مدير التطبيق المركزي للمراجعة.
- لا يتم أي تغيير قبل الموافقة.
- عند الموافقة قد تحتاج المؤسسة إلى إعادة تسجيل الدخول.
- لا ترسل الطلب أثناء وجود مزامنة معلقة أو تعارضات غير محلولة.

إظهار القسم:

- `principal` فقط.
- لا يظهر لـ `staff` أو أدوار القراءة.
- لا يستخدمه `admin/developer` لأن مراجعتهم تتم من صفحة "ادارة التطبيق".

### 5.8 `js/pages/settings-users.js`

التعديلات:

- تحميل `window.api.institution.getStatus()` عند فتح الصفحة.
- تعبئة القيم الحالية في حقول الطلب.
- تحميل `window.api.institution.getIdentityChangeRequests()` لعرض آخر الطلبات وحالاتها.
- التحقق من regex محليا بنفس منطق main.
- مقارنة القيم الجديدة بالقديمة للتأكد من وجود تغيير.
- عند تغيير الرمز:
  - استخدام confirmation قوي من `message-system.js` إذا متوفر.
  - تعطيل الزر ومنع تكرار الإرسال.
  - إظهار رسالة أن الطلب ينتظر موافقة مدير التطبيق.
- استدعاء:

```js
window.api.institution.submitIdentityChangeRequest({
  codeEtablissement,
  institutionName,
  reason,
  syncSchoolIdentity: true
});
```

- عند وجود طلب `approved` ولم يطبق محليا:

```js
window.api.institution.applyApprovedIdentityChange({ requestId });
```

- عند `requireRelogin`:
  - عرض رسالة نجاح.
  - استدعاء `window.api.auth.logout()`.
  - إعادة التوجيه إلى `login.html`.

### 5.9 صفحة "ادارة التطبيق"

إنشاء صفحة جديدة خاصة بمدير التطبيق، مثلا:

- `app-admin.html`
- `js/pages/app-admin.js`

اسم الصفحة في الواجهة:

- "ادارة التطبيق"

الصلاحيات:

- `admin`
- `developer`

المحتوى:

- قائمة طلبات تعديل هوية المؤسسة من كل المؤسسات.
- فلاتر: `pending`, `approved`, `rejected`, `failed`.
- عرض معلومات الطلب:
  - المؤسسة الحالية
  - الرمز الحالي
  - الرمز المطلوب
  - الاسم الحالي
  - الاسم المطلوب
  - صاحب الطلب
  - تاريخ الطلب
  - سبب الطلب
  - حالة المزامنة إن أرسلت في payload أو أضيفت لاحقا
- أزرار:
  - "موافقة"
  - "رفض"
  - "تحديث القائمة"
- عند الموافقة على تغيير الرمز:
  - confirmation قوي يوضح أن العملية ستنقل بيانات Firebase وتحدث claims.
  - تعطيل أزرار الطلب أثناء التنفيذ.
  - إظهار progress/status لأن العملية قد تستغرق وقتا.
- عند الرفض:
  - طلب سبب الرفض وحفظه في الطلب.

### 5.10 `settings-school.html`

لا يكون مكان إرسال الطلب حسب القرار الجديد. يبقى لعرض معلومات المؤسسة أو هوية التقارير فقط.

إذا أضيف قسم معلومات، يجب أن يكون للقراءة فقط:

- عنوان: "هوية المؤسسة المرتبطة بالمزامنة"
- عرض `code_etablissement`
- عرض `institution_name`
- رابط أو زر ينتقل إلى `settings-users.html` إذا كان المستخدم `principal`

### 5.11 `js/pages/settings-school.js`

التعديلات:

- تحميل `window.api.institution.getStatus()` عند فتح الصفحة.
- عرض القيم الحالية للقراءة فقط.
- عدم استدعاء update مباشر.

### 5.12 `main/firebase/collections.js`

لا يحتاج تعديل إلزامي إذا بقيت البنية كما هي.

تعديل اختياري إذا أردنا alias collection لاحقا:

- إضافة ثابت مثل `SCHOOL_ALIASES_COLLECTION = 'schoolAliases'`
- هذا ليس ضروريا للمرحلة الأولى إذا اعتمدنا `status: migrated` في الوثيقة القديمة.

### 5.13 `main/firebase/config.js`

لا تعديل إلزامي. `readSchoolId(db)` يقرأ بالترتيب:

1. `sync_config.school_id`
2. `institution_config.code_etablissement`
3. `institution_config.massar_code`

بعد تحديث SQLite سيقرأ الرمز الجديد تلقائيا.

### 5.14 `main/auth/firebase-auth-service.js`

لا تعديل إلزامي في login flow، لكنه يتأثر مباشرة:

- `loginWithFirebase()` يقارن `claimSchoolId` مع `expectedSchoolId`.
- بعد تغيير الرمز، token القديم سيفشل.
- لذلك يجب إجبار logout/login.

تعديل اختياري:

- تحسين رسالة `FIREBASE_SCHOOL_MISMATCH` لتذكر أن المؤسسة ربما غُيّر رمزها ويجب تسجيل الدخول من جديد.

### 5.15 `main/sync/credentials.js`

لا تعديل إلزامي، لكن handler الجديد يجب أن يستعمل:

- `clearCredentials()`

السبب: cached credentials القديمة تحمل `schoolId` القديم.

### 5.16 `main/sync/engine.js`

لا تعديل إلزامي لأن exports موجودة:

- `restartSyncPushBackground`
- `restartSyncPullBackground`

لكن يجب التأكد أثناء التنفيذ من أن `restartSyncPullBackground()` يوقف listener القديم عبر `stopRemoteChangeListener()` قبل تشغيل الجديد.

### 5.17 `main/sync/snapshot.js`

لا تعديل إلزامي، لكن handler يجب أن يستدعي:

- `restartSnapshotBackground()`

ملاحظة: `sync_snapshots` لا يحتوي `school_id`، لذلك لا يجب مسحه تلقائيا. مسحه سيولد outbox كامل وقد يكرر push. إذا أردنا force snapshot بعد migration، نفذه فقط بعد أول login ناجح وبقرار صريح.

### 5.18 `main/ipc/system.js`

لا تعديل إلزامي. `getSchoolId()` يقرأ من `sync_config.school_id` ثم `institution_config.code_etablissement`.

### 5.19 `main/ipc/auth.js`

لا تعديل إلزامي. طلبات الربط تقرأ `code_etablissement` مباشرة.

تعديل اختياري:

- في `handleLinkRequest()`: إذا عاد `SCHOOL_NOT_FOUND` وكانت المؤسسة القديمة `migrated`, أظهر رسالة تطلب تحديث المؤسسة محليا.

### 5.20 `main/reports/identity.js` و `main/ipc/reports.js`

لا تغير إلزامي. لكن من الأفضل ألا يعتمد تعديل `school_identity` على `reports:updateIdentity` لأن handler التقارير حاليا غير محمي auth.

التحديث الأمن:

- handler `institution:applyApprovedIdentityChange` يحدّث `school_identity` داخليا إذا طلب المستخدم sync ووافق مدير التطبيق على الطلب.

### 5.21 `main/db/schema.js` و `main/db/migrations.js`

لا توجد حاجة لجدول محلي جديد للحد الأدنى، لأن الطلبات المركزية تحفظ في Firestore collection:

- `institutionIdentityRequests`

لكن يمكن إضافة جدول محلي اختياري لتتبع الطلبات التي أرسلتها المؤسسة وتطبيق الموافقة محليا حتى لو تعذر الاتصال لاحقا.

تعديل اختياري مستحسن للتدقيق:

إضافة جدول:

```sql
CREATE TABLE IF NOT EXISTS institution_identity_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT UNIQUE,
  old_code TEXT,
  new_code TEXT,
  old_name TEXT,
  new_name TEXT,
  requested_by_user_id INTEGER,
  requested_by_email TEXT,
  reviewed_by_email TEXT,
  firebase_migration_id TEXT,
  status TEXT NOT NULL,
  rejection_reason TEXT,
  applied_locally_at DATETIME,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

هذا مفيد لأن تغيير tenant حدث إداري حساس، ولأن الموافقة تحدث مركزيا بينما تطبيق النتيجة يحدث على أجهزة المؤسسة.

## 6. الملفات التي لا يجب الاعتماد عليها لتغيير الرمز

| الملف | السبب |
|---|---|
| `main/sync/capture.js` | capture مخصص لجداول entity، وليس tenant rename |
| `main/sync/merge.js` | لا يحل مشكلة نقل Firestore paths |
| `main/sync/authority.js` | صلاحيات push للجداول فقط |
| `settings-sync.html/js` | إعدادات sync تقنية، وليست مكان تصحيح هوية المؤسسة |
| `settings-school.html/js` | يعرض معلومات المؤسسة فقط، وليس مكان إرسال الطلب حسب القرار الجديد |
| `reports:updateIdentity` | يحدث رأس الوثائق فقط، ولا يغير tenant أو Firebase claims |

## 7. تسلسل التنفيذ التفصيلي

### المرحلة 1: بنية الطلبات المركزية

1. إضافة collection مركزية `institutionIdentityRequests`.
2. إضافة Cloud Functions:
   - `submitInstitutionIdentityChangeRequest`
   - `getInstitutionIdentityChangeRequestsForSchool`
   - `listInstitutionIdentityChangeRequests`
   - `rejectInstitutionIdentityChangeRequest`
3. إضافة Firestore rule تمنع القراءة/الكتابة المباشرة على `institutionIdentityRequests`.
4. إضافة IPC محلي لإرسال الطلب وقراءة طلبات المؤسسة.
5. إضافة preload APIs.
6. إضافة قسم الطلب في `settings-users.html` لـ `principal`.
7. اختبار:
   - `principal` يرسل طلبا.
   - `staff` لا يرى القسم ولا يستطيع الإرسال.
   - طلبان `pending` لنفس المؤسسة لا يسمح بهما.

### المرحلة 2: شاشة ادارة التطبيق

1. إنشاء صفحة `app-admin.html`.
2. إنشاء `js/pages/app-admin.js`.
3. إضافة navigation entry باسم "ادارة التطبيق" يظهر لـ `admin` و `developer` فقط.
4. إضافة IPC `appAdmin:*`.
5. ربط القائمة بـ `listInstitutionIdentityChangeRequests`.
6. تنفيذ الرفض مع سبب الرفض.
7. اختبار:
   - `admin/developer` يرى كل الطلبات.
   - `principal` لا يستطيع فتح الصفحة أو استدعاء قنوات `appAdmin:*`.
   - الرفض يظهر في شاشة طلبات المؤسسة.

### المرحلة 3: الموافقة وتغيير الاسم فقط

1. إضافة دعم الموافقة على طلبات تغيير الاسم بدون `newSchoolId`.
2. تحديث `schools/{schoolId}` و `schools/{schoolId}/meta/institution`.
3. إضافة `institution:applyApprovedIdentityChange` لتحديث `institution_config.institution_name`.
4. اختبار:
   - تغيير الاسم سحابيا بعد موافقة `admin`.
   - تطبيق الموافقة محليا في مؤسسة الطلب.
   - عدم تغير `sync_config.school_id`.
   - استمرار push/pull.

### المرحلة 4: الموافقة وتغيير الرمز

1. تحديث Firestore rules لمنع writes على المدارس migrated.
2. نشر rules.
3. تطوير `approveInstitutionIdentityChangeRequest` مع migration و `dryRun`.
4. اختبار function على Firebase emulator أو مشروع staging.
5. تطوير `institution:applyApprovedIdentityChange` مع preflight وtransaction.
6. إضافة confirmation قوي في صفحة "ادارة التطبيق" عند الموافقة.
7. اختبار end-to-end:
   - مؤسسة OLD بها users وstudents وsyncLog.
   - `principal` يرسل طلب NEW.
   - `admin` يوافق من "ادارة التطبيق".
   - Auth claims تتغير.
   - SQLite يتحدث بعد تطبيق الموافقة محليا.
   - logout/login ينجح.
   - push/pull يشتغل على NEW.
   - الكتابة على OLD تفشل بالقواعد.

### المرحلة 5: تنظيف لاحق

1. إضافة Cloud Function cleanup لحذف `schools/{old}` بعد مدة.
2. إضافة UI يعرض أن المؤسسة انتقلت من OLD إلى NEW.
3. إضافة آلية إشعار للأجهزة الأخرى إن كانت online.

## 8. سيناريوهات الفشل وكيف نتعامل معها

| السيناريو | السلوك المطلوب |
|---|---|
| إرسال الطلب فشل | لا تعدل SQLite، اعرض الخطأ، واترك المستخدم يعيد المحاولة |
| يوجد طلب `pending` سابق لنفس المؤسسة | امنع إنشاء طلب جديد واعرض الطلب الحالي |
| مدير التطبيق رفض الطلب | اعرض سبب الرفض في شاشة طلبات المؤسسة ولا تغير SQLite |
| function فشلت قبل نسخ البيانات عند الموافقة | غيّر الطلب إلى `failed` أو أبقه `pending` مع error واضح حسب نقطة الفشل |
| function نسخت البيانات وفشلت عند claims | لا تطلب تطبيقا محليا، اترك migration marker لفحص يدوي وحالة الطلب `failed` |
| SQLite transaction فشل بعد نجاح الموافقة | أرجع خطأ واضح، واترك الطلب `approved` غير مطبق محليا ليعاد تطبيقه |
| token قديم بعد تغيير الرمز | force logout/login |
| جهاز آخر ظل بالرمز القديم | rules تمنع الكتابة على OLD، ويحتاج login جديد أو relink |
| يوجد pending outbox قبل التغيير | امنع العملية أو ادفعه أولا، لا تحذفه |
| يوجد unresolved conflict | امنع العملية حتى الحل |
| `newSchoolId` موجود مسبقا عند الإرسال | يمكن قبول الطلب مع تحذير أو رفضه مبكرا إذا تحققنا سحابيا |
| `newSchoolId` موجود مسبقا عند الموافقة | function ترجع `TARGET_SCHOOL_EXISTS` ولا تغير شيئا |

## 9. اختبارات مطلوبة

### اختبارات محلية

- `npm test`
- `npm run lint`

### Smoke متوقعة

- `tests/smoke.js` سيتحقق من parity بين preload و IPC.
- عند إضافة write channel يجب إضافته إلى `CHANNEL_REGISTRY` حتى لا يفشل sync registry smoke.
- التأكد أن قنوات `appAdmin:*` مكشوفة في preload ومسجلة كـ excluded من capture.

### اختبارات يدوية

1. إرسال طلب من مدير المؤسسة:
   - `principal` يرى قسم "طلب تعديل هوية المؤسسة" في `settings-users.html`.
   - `staff` لا يرى القسم.
   - الطلب يظهر بحالة `pending`.
2. مراجعة الطلب من مدير التطبيق:
   - `admin/developer` يرى صفحة "ادارة التطبيق".
   - الطلبات من كل المؤسسات تظهر في القائمة.
   - الرفض يحفظ سبب الرفض ويظهر في مؤسسة الطلب.
3. الموافقة على تغيير الاسم فقط:
   - تحقق من `institution_config.institution_name` بعد تطبيق الموافقة محليا.
   - تحقق من `schools/{schoolId}.institutionName`.
   - تحقق من `schools/{schoolId}/meta/institution.institutionName`.
   - تحقق أن `sync_config.school_id` لم يتغير.
4. الموافقة على تغيير الرمز:
   - تحقق من `sync_config.school_id` بعد تطبيق الموافقة محليا.
   - تحقق من `institution_config.code_etablissement` بعد تطبيق الموافقة محليا.
   - تحقق من وجود `schools/{new}`.
   - تحقق من `schools/{old}.status == 'migrated'`.
   - تحقق من claims عبر login جديد.
   - تحقق من أن push/pull لا يكتب إلى OLD.

## 10. قائمة الملفات النهائية

### تعديلات إلزامية

| الملف | التعديل |
|---|---|
| `firebase/functions/index.js` | إضافة functions الطلبات والموافقة و helpers للنسخ وتحديث claims |
| `firebase/firestore.rules` | منع الوصول المباشر إلى requests ومنع writes إلى مدرسة `status: migrated` |
| `main/ipc/institution.js` | إضافة إرسال الطلب، قراءة طلبات المؤسسة، وتطبيق الموافقة محليا |
| `main/ipc/app-admin.js` | إضافة قنوات مراجعة طلبات كل المؤسسات والموافقة/الرفض |
| `main/sync/capture.js` | تسجيل قنوات المؤسسة و`appAdmin:*` كـ `exclude: true` |
| `preload.js` | كشف `window.api.institution.*` و `window.api.appAdmin.*` |
| `settings-users.html` | إضافة شاشة إرسال طلب تعديل هوية المؤسسة لـ `principal` |
| `js/pages/settings-users.js` | validation، إرسال الطلب، عرض الحالات، تطبيق الموافقة |
| `app-admin.html` | صفحة "ادارة التطبيق" لـ `admin/developer` |
| `js/pages/app-admin.js` | قائمة الطلبات، فلاتر، موافقة، رفض |
| navigation/sidebar files | إظهار "ادارة التطبيق" لـ `admin/developer` فقط |
| `settings-school.html` | عرض هوية المؤسسة للقراءة فقط أو رابط لطلب التعديل |
| `js/pages/settings-school.js` | تحميل status وعرضه دون تعديل مباشر |

### تعديلات اختيارية

| الملف | التعديل |
|---|---|
| `main/db/migrations.js` | إضافة جدول audit لتغييرات هوية المؤسسة |
| `main/db/schema.js` | ضمان جدول audit في قواعد جديدة |
| `main/auth/firebase-auth-service.js` | تحسين رسالة mismatch بعد تغيير الرمز |
| `main/firebase/collections.js` | ثوابت alias إذا تم اعتماد alias مستقبلا |
| `tests/*` | اختبارات مخصصة للhandler أو function إذا توفر test harness |

### ملفات تُراجع فقط

| الملف | سبب المراجعة |
|---|---|
| `main/sync/engine.js` | التأكد من restart pull/push/listener |
| `main/sync/credentials.js` | استعمال `clearCredentials()` |
| `main/sync/snapshot.js` | استعمال `restartSnapshotBackground()` |
| `main/firebase/config.js` | التأكد من أولوية قراءة school id |
| `main/ipc/auth.js` | تأثير طلبات الربط |
| `main/ipc/system.js` | تأثير `getSchoolId()` |
| `main/reports/identity.js` | تمييز هوية التقارير عن tenant identity |

## 11. توصية التنفيذ

ابدأ ببناء نظام الطلب والموافقة قبل تنفيذ أي تعديل مباشر، لأن مدير التطبيق مسؤول مركزيا عن مؤسسات متعددة وفي مناطق مختلفة. المرحلة الأولى يجب أن تسمح لـ `principal` بإرسال الطلب من `settings-users.html`، ولـ `admin/developer` بمراجعته من صفحة "ادارة التطبيق". بعدها نفذ تغيير الاسم ثم تغيير الرمز كعملية migration كاملة عبر Cloud Function. تغيير الرمز محليا فقط سيؤدي غالبا إلى فشل login/sync بسبب عدم تطابق Firebase Auth claim ومسارات Firestore.
