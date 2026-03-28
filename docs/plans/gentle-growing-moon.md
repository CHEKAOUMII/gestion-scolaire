# خطة: ملء مفتاح الترخيص تلقائياً في إعدادات المزامنة

## Context

صفحة إعدادات المزامنة (`settings-sync.html`) تتطلب حقل **مفتاح الترخيص** (`license_key`) في جدول `sync_config` لتتمكن من المصادقة مع Auth Lambda. حالياً:

- المفتاح يجب إدخاله يدوياً من المدير في صفحة الإعدادات
- المستخدم النهائي (end user) لا يصل لهذه الصفحة ولا يجب أن يتدخل
- عند تفعيل ترخيص مدفوع، المفتاح يُهاش فوراً ولا يُحفظ كنص
- النسخة التجريبية ليس لها مفتاح ترخيص أصلاً

**المطلوب:** ملء `sync_config.license_key` تلقائياً في الخلفية بدون تدخل المستخدم:
- **مدفوع** → حفظ المفتاح الأصلي عند التفعيل في `sync_config`
- **تجريبي** → توليد مفتاح مزامنة تجريبي تلقائياً

---

## الخطة

### 1. حفظ المفتاح عند تفعيل الترخيص المدفوع

**ملف:** `main/licensing/service.js` — دالة `activateLicense()`

قبل هاش المفتاح (سطر ~342)، نضيف حفظ النص الأصلي في `sync_config`:

```js
// بعد التحقق من صحة المفتاح وقبل الهاش
// حفظ المفتاح في sync_config للمزامنة
try {
    const db = getDb();
    db.prepare(`UPDATE sync_config SET license_key = ? WHERE id = 1`).run(decoded.normalizedKey);
} catch (_) { /* sync_config قد لا يكون موجوداً بعد */ }
```

### 2. توليد مفتاح مزامنة تجريبي تلقائياً

**ملف:** `main/licensing/service.js` أو `main/sync/credentials.js`

عند بدء التطبيق، إذا كانت النسخة تجريبية و `sync_config.license_key` فارغ:

```js
// استيراد
const { createOfflineLicenseKey } = require('../licensing/offlineKey');

// توليد مفتاح تجريبي
function ensureTrialSyncKey(db) {
    const config = db.prepare('SELECT license_key FROM sync_config WHERE id = 1').get();
    if (config && config.license_key) return; // مفتاح موجود بالفعل

    const status = getPublicActivationStatus(); // أو getLicenseStatus()
    if (status.status === 'trial' && status.trialActive) {
        const trialKey = createOfflineLicenseKey({
            planCode: 'basic',
            expiresAt: status.trialEndDate, // ينتهي مع انتهاء الفترة التجريبية
            customerRef: 'TRIAL',
            requiresOnlineValidation: false
        });
        db.prepare('UPDATE sync_config SET license_key = ? WHERE id = 1').run(trialKey);
    }
}
```

**نقطة الاستدعاء:** في `main.js` أو `main/sync/engine.js` عند بدء المزامنة.

### 3. إزالة/إخفاء حقل مفتاح الترخيص من صفحة الإعدادات

**ملف:** `settings-sync.html`

إخفاء حقل `cfg-license-key` من واجهة المستخدم بما أن العملية أصبحت تلقائية. يمكن إبقاؤه مخفياً (لا حذفه) للاستخدام المستقبلي.

### 4. تحديث المفتاح عند تغيير الترخيص

**ملف:** `main/licensing/service.js`

إذا انتقل المستخدم من تجريبي إلى مدفوع (أو العكس: انتهى الترخيص)، يجب تحديث `sync_config.license_key` تلقائياً.

---

## الملفات المعنية

| الملف | التعديل |
|-------|---------|
| `main/licensing/service.js` | حفظ المفتاح في `sync_config` عند `activateLicense()` + دالة `ensureTrialSyncKey()` |
| `main/sync/credentials.js` | التحقق من وجود مفتاح عند `readLicenseKey()` |
| `settings-sync.html` | إخفاء حقل مفتاح الترخيص |
| `js/pages/settings-sync.js` | إزالة منطق حقل المفتاح من الفورم |
| `main.js` أو `main/sync/engine.js` | استدعاء `ensureTrialSyncKey()` عند البدء |

## الدوال الموجودة للاستخدام

- `createOfflineLicenseKey()` — `main/licensing/offlineKey.js` — توليد مفتاح
- `getPublicActivationStatus()` — `main/licensing/service.js` — حالة الترخيص/التجربة
- `readSyncConfig()` — `main/sync/credentials.js` — قراءة إعدادات المزامنة
- `getSigningSecret()` — `main/licensing/offlineKey.js` — سر التوقيع

## ملاحظة أمنية مهمة

السر المحلي (`userData/.license-secret`) يجب أن يكون **نفسه** المخزن في AWS Secrets Manager (`pencil2/license-secret`). وإلا:
- المفتاح المولّد محلياً لن يُقبل من Auth Lambda
- هذا يعني أن النشر يتطلب مزامنة السر بين البيئة المحلية و AWS

## التحقق

1. تشغيل التطبيق بنسخة تجريبية → التحقق أن `sync_config.license_key` يُملأ تلقائياً
2. تفعيل ترخيص مدفوع → التحقق أن المفتاح يُحدَّث في `sync_config`
3. `npm run test:smoke` — يجب أن تمر جميع الاختبارات
4. `npm run lint` — بدون أخطاء
