# خطة Onboarding / Signup / Login (النسخة النهائية)

> خطة مفصلة لإنشاء نظام إعداد المؤسسة، تسجيل الدخول، وإدارة المستخدمين — بعد الانتقال من DynamoDB/Cognito إلى Firebase.
> 
> **آخر تحديث:** 2026-04-22

---

## القرارات المعتمدة

| القرار | الاختيار |
|--------|----------|
| بيانات المستخدمين | **مركزية** — Firebase Auth + Firestore (مصدر رئيسي) + SQLite (cache/offline) |
| ربط الأجهزة | **لا يوجد ربط** — الجهاز الثاني يفتح `login.html` مباشرة |
| إنشاء الأعضاء | **المدير فقط** — من admin panel ينشئ حسابات ويرسل البيانات للأعضاء |
| Signup عام | **لا يوجد** — لا تسجيل ذاتي مفتوح |
| Setup | **صفحة واحدة مبسّطة** — GRESA + اسم المؤسسة + حساب المدير |
| OTP / LAN linking | **إزالة كاملة** |
| نظام التفعيل/الترخيص | **لا يُعدّل الآن** — يُعالج لاحقاً |
| فصل auth | **user auth منفصل عن device/sync auth** |

---

## 1. الوضع الحالي

### 1.1 الموجود

- **`setup.html`** + `js/pages/setup.js` + `css/setup.css` — صفحة onboarding بمسارين (مؤسسة جديدة / ربط بموجودة)
- **`login.html`** + `js/pages/login.js` — تسجيل دخول محلي (SQLite). تبويب تسجيل مخفي/معطل
- **`main/ipc/auth.js`** — `auth:login`, `auth:register`, PIN, session lock, change password
- **`main/ipc/linking.js`** — OTP + LAN linking handlers
- **`main/ipc/system.js`** — `users:add`, `users:updateRole`, `users:disable` (SQLite فقط)
- **`preload.js`** — قنوات `setup.*`, `linking.*`, `auth.*`, `users.*`
- **`main/firebase/config.js`** — Firebase Client SDK (Auth + Firestore) مُهيأ
- **`main/sync/credentials.js`** — device auth tokens للمزامنة (لا يُمس)
- **`firebase/functions/index.js`** — `authExchange` + 3 OTP functions
- **`main/db/schema.js`** — جدول `users`, `institution_config`, `device_otp`, `linked_devices`

### 1.2 الفجوات

- `auth:login` و`auth:register` يعتمدان على SQLite فقط — لا Firebase Auth
- `mustChangePassword` يوجّه لـ `#change-password` بدون شاشة حقيقية
- `settings-users` ينشئ مستخدمين محلياً فقط
- لا مزامنة للمستخدمين بين الأجهزة
- OTP/LAN linking لم يعد مطلوباً

---

## 2. البنية الجديدة

### 2.1 فصل حاسم: User Auth vs Device/Sync Auth

```
User Auth (جديد)                          Device/Sync Auth (لا يُمس)
┌──────────────────────────┐              ┌──────────────────────────┐
│ main/auth/firebase-auth-service.js │    │ main/sync/credentials.js │
│ main/ipc/auth.js          │              │ authExchange Cloud Func  │
│                           │              │                          │
│ هوية المستخدم البشري:     │              │ هوية الجهاز للمزامنة:    │
│  - email/password login   │              │  - device_hash UID       │
│  - role, permissions      │              │  - custom token          │
│  - Firebase Auth user     │              │  - Firestore read/write  │
└──────────────────────────┘              └──────────────────────────┘
          لا يتقاطعان — كل طبقة مستقلة تماماً
```

### 2.2 مصدر الحقيقة

```
Firebase Auth              Firestore                    SQLite (cache)
┌─────────────────┐      ┌────────────────────────┐    ┌────────────────────────┐
│ email/password   │      │ schools/{gresa}/users/  │    │ users table            │
│ uid              │◄────►│   uid, name, email      │◄──►│ id, name, email        │
│ custom claims    │      │   role, status          │    │ role, firebase_uid     │
│ (schoolId, role) │      │   mustChangePassword    │    │ password_hash (cache)  │
│                  │      │   createdBy             │    │ auth_source, last_login│
└─────────────────┘      └────────────────────────┘    └────────────────────────┘
```

### 2.3 هيكل Firestore

```
schools/
  {gresa}/
    institution_name: "..."
    gresa_code: "..."
    created_at: timestamp

    users/
      {firebase_uid}/
        uid, name, email, role
        status: "active" | "disabled"
        mustChangePassword: boolean
        createdAt, createdBy, lastLoginAt
    
    students/    ← (موجود)
    grades/      ← (موجود)
    ...
```

---

## 3. التدفقات

### تدفق 1: أول تشغيل — إعداد المؤسسة (`setup.html` مبسّط)

```
┌───────────────────────────────────────────┐
│  setup.html (صفحة واحدة — لا خيارات)      │
│                                           │
│  رمز GRESA:       [__________]            │
│  اسم المؤسسة:     [__________]            │
│  ─── حساب المدير ───                      │
│  الاسم الكامل:    [__________]            │
│  البريد الإلكتروني: [__________]           │
│  كلمة المرور:     [__________]            │
│  تأكيد كلمة المرور: [__________]          │
│                                           │
│  [إنشاء المؤسسة]                          │
│                                           │
│  المنطق:                                  │
│  1. Cloud Function: bootstrapInstitution   │
│     → Firestore: schools/{gresa}           │
│     → Firebase Auth: admin user            │
│     → Claims: { schoolId, role: 'admin' }  │
│     → Firestore: users/{uid} profile       │
│  2. حفظ محلي:                             │
│     → institution_config                   │
│     → users table (cache)                  │
│  3. Auto-login → index.html               │
└───────────────────────────────────────────┘
```

### تدفق 2: تسجيل الدخول العادي (`login.html`)

```
┌───────────────────────────────────────────┐
│  login.html                               │
│  (يعرض اسم المؤسسة + رمز GRESA)          │
│                                           │
│  البريد الإلكتروني: [__________]           │
│  كلمة المرور:     [__________]            │
│  [تذكرني]                                 │
│  [تسجيل الدخول]                           │
│                                           │
│  المنطق:                                  │
│  Online → Firebase Auth signIn             │
│    → نجح: sync profile → SQLite → جلسة    │
│    → فشل: رسالة خطأ                       │
│  Offline → SQLite scrypt fallback          │
│    → (فقط إذا سبق له الدخول على الجهاز)   │
│                                           │
│  → mustChangePassword? → شاشة تغيير       │
│  → Dashboard                              │
└───────────────────────────────────────────┘
```

### تدفق 3: جهاز ثاني

```
أول تشغيل على جهاز جديد:
  1. institution_config فارغ → setup.html
  
  لكن... المؤسسة موجودة في Firestore.

  الحل:
  setup.html يتحقق من GRESA في Firestore:
  → إذا موجود: يحفظ institution_config محلياً
    ثم يعرض login.html مباشرة
  → إذا غير موجود: يكمل الإعداد العادي (مؤسسة جديدة)
  
  المستخدم يسجل دخول بالبيانات التي أرسلها المدير.
```

### تدفق 4: المدير ينشئ أعضاء (Admin Panel)

```
┌───────────────────────────────────────────┐
│  settings-users.html                      │
│                                           │
│  Admin يضغط "إضافة مستخدم":               │
│  - الاسم, البريد, الدور                   │
│  - كلمة مرور مؤقتة (يرسلها يدوياً)       │
│                                           │
│  Online:                                  │
│    Cloud Function: provisionSchoolUser     │
│    → Firebase Auth user                   │
│    → Claims { schoolId, role }            │
│    → Firestore profile                    │
│    → SQLite cache                         │
│    → mustChangePassword = true            │
│                                           │
│  Offline:                                 │
│    → SQLite فقط (auth_source='local')    │
│    → يُزامن عند عودة الاتصال             │
│                                           │
│  Admin يرسل للعضو:                        │
│    "البريد: x@y.com / كلمة المرور: ..."   │
│    العضو يسجل دخول → يغيّر كلمة المرور   │
└───────────────────────────────────────────┘
```

### تدفق 5: تغيير كلمة المرور الإلزامي

```
┌───────────────────────────────────────────┐
│  عند mustChangePassword = true:           │
│                                           │
│  login.js يعرض نموذج تغيير حقيقي          │
│  (بدل #change-password الوهمي)            │
│                                           │
│  كلمة المرور الجديدة:  [__________]       │
│  تأكيد:               [__________]       │
│  [حفظ كلمة المرور]                        │
│                                           │
│  Online:                                  │
│    Firebase Auth updatePassword            │
│    + Firestore + SQLite                   │
│  Offline:                                 │
│    SQLite فقط → يُزامن لاحقاً             │
│                                           │
│  → Dashboard                              │
└───────────────────────────────────────────┘
```

---

## 4. الخطة التفصيلية

### المرحلة 0: التنظيف

#### 4.0.1 حذف OTP/LAN بالكامل

**`firebase/functions/index.js`:**
- حذف: `publishOtp`, `cancelOtp`, `verifyOtp`
- حذف: `firebase/functions/password-utils.js`
- إبقاء: `authExchange` (لـ device/sync auth)

**`main/ipc/linking.js`:**
- حذف handlers: `linking:generateOtp`, `linking:cancelOtp`, `linking:getOtpStatus`, `linking:discover-lan-devices`
- إبقاء: `linking:get-institution-status`, `linking:setup-new-institution`
- تحويل `linking:verify-and-link` → يصبح `linking:join-existing` (GRESA فقط → حفظ محلي → redirect login)

**`preload.js`:**
- إزالة: `linking.generateOtp`, `linking.cancelOtp`, `linking.getOtpStatus`, `linking.discoverLanDevices`
- إزالة: `setup.verifyAndLink`, `setup.discoverLanDevices`
- إبقاء: `setup.getInstitutionStatus`, `setup.setupNewInstitution`
- إضافة: `setup.joinExisting` (GRESA → فحص Firestore → حفظ محلي)

**`main/firebase/collections.js`:**
- إزالة: `OTP_CODES_COLLECTION`

#### 4.0.2 أمان

- نقل `firebase/gestionscholaire-firebase-adminsdk-*.json` خارج الـ repo
- `.gitignore`: إضافة `firebase/*-adminsdk-*.json`

---

### المرحلة 1: البنية التحتية

#### 4.1.1 Migration

```js
// version: '1.0.39'
ensureColumn('users', 'firebase_uid', 'TEXT');
ensureColumn('users', 'gresa_code', 'TEXT');
ensureColumn('users', 'auth_source', "TEXT DEFAULT 'local'");  // 'local' | 'firebase'
ensureColumn('users', 'last_login_at', 'DATETIME');
ensureColumn('users', 'last_auth_mode', 'TEXT');               // 'online' | 'offline'

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid 
         ON users(firebase_uid) WHERE firebase_uid IS NOT NULL`);
db.exec('CREATE INDEX IF NOT EXISTS idx_users_gresa ON users(gresa_code)');
```

#### 4.1.2 `main/auth/firebase-auth-service.js` (ملف جديد)

```
signUpWithFirebase(email, password)    → { uid, email } | null
signInWithFirebase(email, password)    → { uid, email, token } | null
signOutFirebase()                      → void
changeFirebasePassword(newPassword)    → boolean
isOnline()                             → boolean
```

قواعد: non-blocking, graceful degradation, لا exceptions.

#### 4.1.3 `main/auth/user-cache.js` (ملف جديد)

```
syncFirebaseUserToLocal(db, { uid, email, name, role, gresaCode, password })
  → INSERT OR UPDATE في users + firebase_uid + auth_source='firebase'
  → يخزن password_hash (scrypt) كـ offline cache

getLocalUserByFirebaseUid(db, uid)   → user | null
getLocalUserByEmail(db, email)       → user | null
updateLastLogin(db, userId, mode)    → void
```

#### 4.1.4 Cloud Functions جديدة

```
POST /bootstrapInstitution
  body: { gresaCode, institutionName, adminEmail, adminPassword, adminName }
  → يتحقق أن schools/{gresa} غير موجود
  → ينشئ document المؤسسة
  → ينشئ Firebase Auth user
  → claims: { schoolId: gresa, role: 'admin' }
  → profile: schools/{gresa}/users/{uid}
  → يُرجع { customToken, uid, schoolId }

POST /provisionSchoolUser
  body: { idToken, email, name, role, tempPassword }
  → يتحقق أن الطالب admin
  → ينشئ Firebase Auth user + claims + profile
  → mustChangePassword = true
  → يُرجع { uid }

POST /updateSchoolUserRole
  body: { idToken, targetUid, newRole }
  → claims + Firestore

POST /setSchoolUserDisabled
  body: { idToken, targetUid, disabled }
  → Firebase Auth + Firestore
```

#### 4.1.5 Firestore Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /schools/{gresaCode} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth.token.schoolId == gresaCode;

      match /users/{userId} {
        allow read: if request.auth.token.schoolId == gresaCode;
        allow write: if request.auth.uid == userId
                     && request.auth.token.schoolId == gresaCode;
        allow write: if request.auth.token.schoolId == gresaCode
                     && request.auth.token.role in ['admin', 'developer'];
      }

      match /{collection}/{document} {
        allow read, write: if request.auth.token.schoolId == gresaCode;
      }
    }
  }
}
```

---

### المرحلة 2: تحديث Setup

#### 4.2.1 تعديل `setup.html`

- **حذف**: مسار "ربط بمؤسسة موجودة" بالكامل (step-link-existing + OTP UI)
- **حذف**: شاشة اختيار الوضع (step-mode-select) — لم نعد نحتاج خيارين
- **إبقاء**: نموذج "مؤسسة جديدة" (step-new-institution) يصبح الصفحة الكاملة
- **تعديل**: label "رمز ماسار" → "رمز GRESA"
- **إضافة**: فحص GRESA في Firestore عند الإدخال:
  - موجود → حفظ `institution_config` محلياً + redirect إلى `login.html`
  - غير موجود → متابعة الإنشاء

#### 4.2.2 تعديل `js/pages/setup.js`

```
القديم:
  formNew.submit → window.api.setup.setupNewInstitution(local data)
  formLink.submit → window.api.setup.verifyAndLink(OTP + LAN)

الجديد:
  formNew.submit →
    1. فحص GRESA في Firestore (عبر IPC)
    2. إذا موجود: حفظ institution_config → redirect login.html
    3. إذا غير موجود: Cloud Function bootstrapInstitution
       → حفظ institution_config + users cache
       → auto-login → index.html
```

- حذف: كود OTP digit inputs, formLink handler, LAN discovery

#### 4.2.3 تعديل `main/ipc/linking.js`

**`linking:setup-new-institution`:**
```
القديم: حفظ محلي في institution_config + إنشاء admin في SQLite
الجديد:
  1. فحص GRESA في Firestore
  2. إذا موجود: خطأ "المؤسسة مسجلة مسبقاً"
  3. إذا غير موجود: Cloud Function bootstrapInstitution
  4. حفظ institution_config + sync_config
  5. syncFirebaseUserToLocal (نسخة محلية للـ admin)
  6. إرجاع { success, autoLoginEmail }
```

**إضافة `linking:check-gresa`:**
```
→ فحص Firestore: هل schools/{gresa} موجود؟
→ إذا نعم: إرجاع { exists: true, institutionName }
→ إذا لا: إرجاع { exists: false }
```

**إضافة `linking:join-existing`:**
```
→ params: { gresaCode }
→ حفظ institution_config محلياً (gresa + name من Firestore)
→ setup_completed = 1
→ إرجاع { success: true } → redirect login.html
```

---

### المرحلة 3: تطوير Login

#### 4.3.1 تحديث `auth:login` في `main/ipc/auth.js`

```
التدفق الجديد:
1. Throttle check (كما هو)
2. Developer bypass (كما هو)
3. Online?
   a. نعم → Firebase Auth signInWithEmailAndPassword
      → نجح:
        - جلب profile من Firestore
        - syncFirebaseUserToLocal (name, role, disabled)
        - تحديث password_hash cache
        - updateLastLogin(userId, 'online')
        - إنشاء جلسة Electron
      → فشل: رسالة خطأ مفصلة
   b. لا → SQLite fallback:
      - شرط: firebase_uid IS NOT NULL (سبق له الدخول online)
      - scrypt verify
      - updateLastLogin(userId, 'offline')
      - جلسة محلية
4. Return { success, user }
```

#### 4.3.2 شاشة `mustChangePassword` حقيقية

في `js/pages/login.js` — بدل redirect إلى `#change-password`:

```
عند response.user.mustChangePassword:
  - إخفاء نموذج الدخول
  - إظهار نموذج تغيير كلمة المرور (كلمة جديدة + تأكيد + مؤشر قوة)
  - عند الإرسال:
    Online: Firebase Auth updatePassword + Firestore + SQLite
    Offline: SQLite فقط + flag للمزامنة
  - → Dashboard
```

#### 4.3.3 تحسين `login.html` و `js/pages/login.js`

- عرض اسم المؤسسة ورمز GRESA أعلى النموذج
- **إبقاء تبويب التسجيل مخفياً** (لا self-signup)
- مؤشر حالة الاتصال (online/offline)
- رسائل خطأ عربية:
  - `auth/invalid-credential` → "البريد أو كلمة المرور غير صحيحة"
  - `auth/user-disabled` → "هذا الحساب معطّل"
  - `auth/network-request-failed` → "لا يوجد اتصال — تسجيل دخول محلي"

---

### المرحلة 4: إدارة المستخدمين (Admin Panel)

#### 4.4.1 تحديث `main/ipc/system.js`

```
users:add →
  Online: Cloud Function provisionSchoolUser
          → Firebase Auth + claims + Firestore + SQLite
          → mustChangePassword = true
  Offline: SQLite فقط (auth_source='local')
           → يُزامن عند عودة الاتصال

users:updateRole →
  Online: Cloud Function updateSchoolUserRole
  Offline: SQLite فقط → يُزامن

users:disable →
  Online: Cloud Function setSchoolUserDisabled
  Offline: SQLite فقط → يُزامن
```

#### 4.4.2 تحسين واجهة `settings-users`

- عمود "المصدر": Firebase ✅ أو محلي ⚠️
- عمود "يجب تغيير كلمة المرور": ✅/❌
- زر "مزامنة" للمستخدمين المحليين

#### 4.4.3 Backfill المستخدمين القدامى

أداة migration:
1. فحص users حيث `firebase_uid IS NULL`
2. email صالح + فريد → Cloud Function provisionSchoolUser → حفظ `firebase_uid`
3. email مشكل → تقرير خطأ للمدير
4. نجاح → `auth_source = 'firebase'`

---

## 5. هيكل الملفات

### ملفات جديدة:
```
main/auth/firebase-auth-service.js     ← Firebase Auth (signUp/signIn/changePassword)
main/auth/user-cache.js                ← sync بين Firebase profile و SQLite
```

### ملفات معدّلة:
```
setup.html                             ← تبسيط: صفحة واحدة بدون خيارات
js/pages/setup.js                      ← Cloud Function bootstrap + فحص GRESA
css/setup.css                          ← حذف أنماط OTP/linking
main/ipc/linking.js                    ← حذف OTP + إضافة check-gresa/join-existing
login.html                             ← عرض اسم المؤسسة + مؤشر offline
js/pages/login.js                      ← Firebase login + offline fallback + mustChangePassword
main/ipc/auth.js                       ← Firebase-first login
main/ipc/system.js                     ← users:add/updateRole/disable عبر Cloud Functions
preload.js                             ← إزالة OTP channels + إضافة check-gresa/join-existing
main/db/migrations.js                  ← firebase_uid, auth_source, last_login_at, last_auth_mode
main/firebase/collections.js           ← إزالة OTP + إضافة users mapping
firebase/functions/index.js            ← حذف OTP + إضافة bootstrap/provision/updateRole/disable
firebase/firestore.rules               ← قواعد users subcollection
.gitignore                             ← firebase/*-adminsdk-*.json
```

### ملفات تُحذف:
```
firebase/functions/password-utils.js
```

### ملفات لا تُمس:
```
main/sync/credentials.js               ← device/sync auth — مستقل
main/auth/password.js                  ← scrypt — offline cache
main/firebase/config.js                ← يبقى
main/licensing/                        ← يُعالج لاحقاً
main/db/schema.js                      ← institution_config موجود
```

---

## 6. ترتيب التنفيذ

```
المرحلة 0: التنظيف (يوم 1)
├── حذف OTP من Cloud Functions + linking.js + preload.js + collections.js
├── حذف password-utils.js
├── نقل Service Account Key + .gitignore
└── Deploy Cloud Functions المنظّفة

المرحلة 1: البنية التحتية (يوم 2-3)
├── Migration: أعمدة users الجديدة
├── main/auth/firebase-auth-service.js
├── main/auth/user-cache.js
├── Cloud Functions: bootstrap + provision + updateRole + disable
├── Firestore Rules
└── Deploy

المرحلة 2: Setup (يوم 4)
├── تبسيط setup.html (صفحة واحدة)
├── تعديل js/pages/setup.js (Cloud Function + فحص GRESA)
├── تعديل main/ipc/linking.js (check-gresa + join-existing)
└── اختبار: مؤسسة جديدة + جهاز ثاني

المرحلة 3: Login (يوم 5-6)
├── تحديث main/ipc/auth.js (Firebase-first + offline)
├── تحديث js/pages/login.js (mustChangePassword + رسائل خطأ)
├── تحديث login.html (اسم المؤسسة + مؤشر offline)
└── اختبار: online + offline + تغيير كلمة مرور

المرحلة 4: إدارة المستخدمين (يوم 7-8)
├── تعديل main/ipc/system.js (Cloud Functions)
├── تحسين واجهة settings-users
├── أداة backfill
└── اختبار شامل

المرحلة 5: اختبارات (يوم 9)
├── Emulator Suite
├── smoke test updates
└── regression: sync credentials لم تنكسر
```

---

## 7. المخاطر والتخفيف

| الخطر | التخفيف |
|-------|---------|
| خلط user auth مع device auth → كسر sync | `credentials.js` مستقل. لا merge |
| فقدان offline usability | `password_hash` cache + offline fallback |
| GRESA مكرر (مؤسستان بنفس الرمز) | `bootstrapInstitution` يرفض إذا GRESA موجود |
| تعارض users حاليين مع Firebase | تقرير migration واضح + تصحيح يدوي |
| Firebase config ناقص → crash | فحص config قبل أي عملية + رسائل واضحة |
