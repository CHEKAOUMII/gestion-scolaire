# ربط الجدول الزمني للرحلة بتقويم Google مركزي — خطة تنفيذ

**التاريخ:** 2026-07-23  
**الحالة:** Draft / خطة تنفيذ مستقبلية  
**النطاق:** `index.html`، `app.js`، خادم Node الحالي، وطبقة IPC في Electron  
**الهدف:** عرض أحداث الموسم الدراسي الحالي — الأحداث المشتركة وأحداث السلك الذي يختاره المستعمل — من تقاويم Google مركزية للقراءة فقط داخل بطاقة **الجدول الزمني للرحلة (Milestone Timeline)**، مع إبراز الحدث الأقرب زمنياً.

---

## 1. الهدف وقواعد العمل

نريد أن يرى المستعمل أحداث **الموسم الدراسي الحالي** التي يديرها المسؤول في تقاويم Google مركزية. المستعمل النهائي لا ينشئ أحداثاً، ولا يسجل الدخول إلى Google، ولا ينفذ إعداداً يدوياً؛ **كل ما يفعله هو اختيار السلك الخاص به**، فتظهر له الأحداث المشتركة إضافةً إلى أحداث ذلك السلك. المسؤول عن التطبيق يحدّث هذه التقاويم **سنوياً**.

نموذج التقاويم المعتمد: **تقويم مشترك واحد + تقويم لكل سلك**. الأحداث المشتركة تخص جميع الأسلاك (بداية الموسم، العطل، اجتماعات عامة)، وأحداث السلك تخص سلكاً واحداً. المسؤول يضع كل حدث في التقويم المناسب من واجهة Google العادية، دون بادئات في العناوين ولا حقول مخفية.

القواعد الأساسية:

- المصدر مركزي تديره الإدارة: تقويم مشترك + تقويم لكل سلك، وكلها للقراءة فقط.
- التكامل **قراءة فقط**؛ لا يوجد أي write endpoint.
- المستعمل يختار سلكه فقط؛ لا حساب Google ولا تسجيل دخول ولا إعداد يدوي.
- لكل سلك يُدمج **تقويم السلك + التقويم المشترك دائماً**.
- تُعرض **أحداث الموسم الدراسي الحالي كاملةً** لذلك السلك (لا سقف ثابت = 3)، مرتّبة زمنياً، **مع إبراز الحدث الأقرب** زمنياً.
- الدمج والترتيب وإزالة التكرار تتم على **الخادم**، لا في renderer.
- اختيار السلك يُحفظ كإعداد **محلي للجهاز وغير متزامن** (على غرار بقية App Defaults)، فلا يُعاد سؤال المستعمل كل مرة.
- يُخزَّن آخر جلب ناجح **محلياً (cache غير سري)** ليعمل العرض دون اتصال، لأن التقويم يتغيّر مرة في السنة فقط.
- لا تُضمَّن بيانات اعتماد Google داخل تطبيق Electron أو ملفات renderer أو حزمة التوزيع.
- لا يُعرض payload Google الخام في الواجهة؛ يعيد الخادم DTO مبسطاً ومحدوداً مع حقل `scope` للتمييز بين المشترك والسلك.
- إذا تعذر الاتصال أو لم توجد أحداث، تُعرض حالة واضحة، ولا تُعرض بيانات افتراضية على أنها أحداث حقيقية من Google.
- يبقى `SJ_DEFAULT_MILESTONES` احتياطياً بصرياً/توافقياً إلى أن يُتخذ قرار منتج صريح؛ والأفضل إظهار الـ cache الأخير أو حالة عدم التوفر بدلاً من خلط الأحداث الافتراضية بأحداث التقويم.

> **مهم:** هذه الوثيقة خطة وليست دليلاً على أن التكامل منفذ. كل ما يرد بعبارة «مقترح» أو «سيُضاف» يحتاج إلى تنفيذ واختبار لاحق.

---

## 2. الوضع الحالي المؤكد

### 2.1 واجهة الجدول الزمني

المصدر الحالي في `index.html` هو:

```html
<div class="sj-timeline" id="sj-timeline"></div>
```

العنصر موجود داخل بطاقة عنوانها:

```text
الجدول الزمني للرحلة (Milestone Timeline)
```

### 2.2 بيانات العرض الحالية

في `app.js` توجد المصفوفة:

```js
const SJ_DEFAULT_MILESTONES = [
    { kind, title, date, text },
    ...
];
```

وتوجد الدالة الحالية:

```js
function sjRenderTimeline(items) { ... }
```

أما `renderStudentJourney(stats)` فتستدعي حالياً:

```js
sjRenderTimeline(SJ_DEFAULT_MILESTONES);
```

لذلك فإن نقطة الاستبدال الأساسية المقترحة هي تحميل الأحداث قبل استدعاء `sjRenderTimeline`، ثم تمرير DTO المطبع إلى الدالة نفسها أو إلى دالة تحويل صغيرة قبلها.

### 2.3 الخادم الحالي

`server/index.js` خادم Node HTTP خام يعتمد على `http.createServer`، وليس Express. المنفذ الحالي:

```js
const PORT = Number(process.env.PORT || 8787);
```

النقاط الحالية المؤكدة:

- `GET /api/health`
- `POST /api/telemetry/register`
- `POST /api/telemetry/heartbeat`
- `GET /api/telemetry/overview`
- `GET /api/telemetry/devices`
- `GET /api/telemetry/auth-check`
- المصادقة الحالية لنقاط telemetry عبر رأس `x-owner-token`.
- التخزين الحالي لبيانات telemetry في JSON محلي، وليس مخزناً لأحداث Google.

الـ README الحالي يشغل الخادم عبر:

```bash
npm run owner:server
```

ولا توجد حالياً نقطة `/api/calendar/upcoming`.

### 2.4 طبقة Electron

- `main/ipc/registerAll.js` يسجل وحدات IPC الحالية، ولا توجد وحدة Google Calendar.
- `preload.js` يعرّض واجهات `window.api` عبر `contextBridge`، ولا توجد حالياً مساحة `window.api.calendar`.
- توجد وحدة `main/ipc/ownerTelemetry.js` كنمط قائم لتسجيل IPC متعلق بخادم المالك، لكنها لا تنفذ تكامل Google Calendar.
- `main/sync/credentials.js` مخصص حالياً لتخزين اعتماد Firebase عبر `safeStorage` وبديل AES؛ لا يُعاد استخدامه تلقائياً لاعتماد Google، لأن اعتماد Google يجب أن يبقى في الخادم المركزي.

### 2.5 التاريخ والتنسيق

`js/shared/date-utils.js` يوفّر، من بين وظائف أخرى:

- `parseLocalDate`
- `formatDateAr`
- `todayStr`

ينبغي استخدامه أو إضافة دالة صغيرة موثقة إليه بعد الاتفاق على شكل التاريخ القادم من الخادم، بدلاً من إنشاء صيغ متعارضة داخل `app.js`.

### 2.6 الحزم الحالية

`package.json` يحتوي على Firebase وElectron و`better-sqlite3`، ولا يحتوي حالياً على:

- `googleapis`
- `google-auth-library`

إضافة مكتبة Google ليست جزءاً من هذه الخطة التنفيذية قبل اعتماد خيار الاعتماد النهائي، لكنها ستكون تغييراً مطلوباً عند تنفيذ Service Account server-side.

---

## 3. القرار المعماري المقترح

### 3.1 الخيار الأساسي: Service Account على الخادم

يُنشأ Service Account في Google Cloud، ويُشارك معه التقويم المركزي بصلاحية قراءة الأحداث فقط. يحتفظ الخادم بمفتاح Service Account، ويستدعي Google Calendar API، ثم يعيد أحداثاً مطبعة للتطبيق.

```text
تقاويم Google مركزية
  - تقويم مشترك
  - تقويم لكل سلك
        ▲
        │  events.list — read-only (نفس Service Account لكل التقاويم)
        │
خادم Node المركزي
  - GOOGLE_CALENDAR_SHARED_ID
  - GOOGLE_CALENDAR_CYCLES { code -> calendarId }
  - Service Account secret
  - /api/calendar/upcoming?cycle=<code>   (يدمج المشترك + السلك)
        ▲
        │  HTTPS + client access policy
        │
Electron main process
  - calendar IPC client
        ▲
        │  contextBridge / IPC
        │
Renderer: app.js
  - اختيار السلك (إعداد محلي) + cache محلي
  - loading / success / empty / error
  - #sj-timeline (أحداث الموسم كاملة، إبراز الأقرب)
```

هذا الخيار يحقق المتطلبات التالية:

- المستخدم لا يحتاج إلى حساب Google.
- كل المستخدمين يرون نفس التقويم.
- مفتاح Google لا يصل إلى Electron.
- يمكن إبقاء التقويم خاصاً ومشاركته فقط مع Service Account.
- يمكن تغيير التقويم أو تدوير المفتاح على الخادم دون إصدار نسخة جديدة من التطبيق.

### 3.2 الخيار البديل: OAuth server-side لحساب إداري

إذا لم يُرَد استخدام Service Account، يمكن لمسؤول واحد إتمام OAuth مرة واحدة على الخادم، وتخزين refresh token مشفراً على الخادم. لا يُنفذ OAuth داخل Electron لكل مستخدم.

مقايضات هذا الخيار:

- الاعتماد مرتبط بحساب إداري شخصي.
- قد يُلغى refresh token أو تتغير صلاحيته.
- يجب إدارة شاشة الموافقة ونطاقات Google ومتطلبات الإنتاج.
- يبقى الخادم هو المكان الوحيد الذي يرى refresh token.

### 3.3 البدائل غير المختارة

- **OAuth لكل مستخدم داخل Electron:** مرفوض لأنه يطلب إجراءً وتسجيل دخول من كل مستخدم ولا يحقق نموذج التقويم المركزي الصامت.
- **وضع Service Account private key أو OAuth secret داخل Electron:** مرفوض؛ محتوى حزمة Electron قابل للاستخراج.
- **استدعاء Google مباشرة من renderer أو main مع سر مضمّن:** مرفوض للسبب نفسه.
- **تقويم عام مع API key داخل التطبيق:** يصلح فقط إذا كانت الأحداث عامة فعلاً؛ API key قابل للاستخراج ولا يناسب تقويماً خاصاً.
- **رابط ICS سري داخل التطبيق:** ممكن تقنياً لكنه يعامل الرابط ككلمة مرور، ويحتاج parsing للتكرارات والمناطق الزمنية والإلغاءات؛ لا يُعتمد مع وجود خادم مركزي إلا كخطة بديلة.

---

## 4. إعداد Google Cloud والتقويم

### 4.1 إعداد Google Cloud

قبل التنفيذ:

1. إنشاء أو اختيار Google Cloud Project مخصص للتكامل.
2. تفعيل Google Calendar API.
3. إنشاء Service Account.
4. إنشاء مفتاح JSON فقط إذا كانت بيئة النشر لا توفر Secret Manager؛ والأفضل استخدام Secret Manager أو متغير سري في بيئة الخادم.
5. عدم حفظ المفتاح في Git أو `firebase/` أو `dist/` أو ملفات logs.
6. عدم تضمين المفتاح في `extraResources` أو حزمة Electron.

### 4.2 مشاركة التقاويم

1. إنشاء تقويم **مشترك** واحد، وتقويم منفصل **لكل سلك**.
2. نسخ Calendar ID لكل تقويم من إعداداته، وتعبئة `GOOGLE_CALENDAR_SHARED_ID` وخريطة `GOOGLE_CALENDAR_CYCLES`.
3. مشاركة **كل** هذه التقاويم مع بريد Service Account نفسه.
4. منح صلاحية قراءة مناسبة، مثل **See all event details**، دون صلاحية تعديل أو إدارة مشاركة.
5. اختبار أن Service Account يقرأ هذه التقاويم فقط، لا غيرها.
6. تحديد المنطقة الزمنية الرسمية للمدرسة والتأكد من أن الأحداث المدخلة في Google تستخدمها بوضوح.
7. توثيق قاعدة العمل للمسؤول: الحدث العام يوضع في التقويم المشترك، وحدث السلك يوضع في تقويم ذلك السلك فقط.

### 4.3 نطاق Google المقترح

يُطلب أقل نطاق مناسب للقراءة فقط، مثل:

```text
https://www.googleapis.com/auth/calendar.events.readonly
```

يجب التحقق من النطاق النهائي أثناء تنفيذ مكتبة Google المختارة ومن إعداد OAuth إن استُخدم الخيار البديل.

مرجع Google الموجود في الخطة السابقة:

- [Google Calendar API authentication and scopes](https://developers.google.com/workspace/calendar/api/auth)
- [events.list reference](https://developers.google.com/google-apps/calendar/v3/reference/events/list)

---

## 5. متغيرات البيئة والإعدادات

### 5.1 متغيرات الخادم المقترحة

| المتغير | الحالة | الغرض |
|---|---|---|
| `PORT` | موجود حالياً | منفذ خادم Node؛ الافتراضي `8787` |
| `CALENDAR_API_BASE_URL` | سيُضاف عند تنفيذ Electron | عنوان HTTPS للخادم المركزي الذي سيستدعيه Electron |
| `GOOGLE_CALENDAR_SHARED_ID` | سيُضاف | Calendar ID للتقويم المشترك (يُدمج مع كل سلك) |
| `GOOGLE_CALENDAR_CYCLES` | سيُضاف | خريطة JSON من رمز السلك إلى Calendar ID، مثل `{"secondary":"...","middle":"...","primary":"..."}` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | سيُضاف للتطوير فقط | JSON سري كامل؛ لا يُستخدم في مستودع أو إنتاج دون حماية مناسبة |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | سيُضاف/بديل | مسار ملف سري خارج المستودع في بيئة الخادم |
| `CALENDAR_API_CLIENT_TOKEN` | اختياري | حماية نقطة القراءة بين التطبيق والخادم؛ ليس بديلاً عن حماية مفتاح Google |
| `CALENDAR_MAX_RESULTS` | اختياري | حد أمان علوي لعدد الأحداث المجلوبة لكل تقويم (سقف تقني ضد استجابات ضخمة)، وليس سقفاً للعرض؛ العرض يشمل كل أحداث الموسم |
| `SCHOOL_YEAR_START_MONTH` | اختياري | شهر بداية الموسم الدراسي لاشتقاق `timeMin`/`timeMax` (الافتراضي: سبتمبر) |
| `CALENDAR_TIME_ZONE` | اختياري | المنطقة الزمنية المعتمدة للعرض عند الحاجة؛ الأفضل احترام timezone القادم من Google |

لا ينبغي اعتماد `CALENDAR_API_PORT` كمنفذ مستقل ما دام التكامل سيضاف إلى خادم `server/index.js` الحالي؛ استخدام `PORT` القائم يقلل تعقيد النشر. يمكن إنشاء خدمة منفصلة لاحقاً إذا ظهرت حاجة تشغيلية واضحة.

### 5.2 ملاحظات عن رمز وصول التطبيق

إذا كانت بيانات الأحداث غير حساسة، يمكن جعل endpoint القراءة محدوداً ومتاحاً دون Google credential، مع rate limiting وتحديد الحقول.

إذا كان التقويم خاصاً، يمكن استخدام `CALENDAR_API_CLIENT_TOKEN` أو آلية وصول مخصصة. يجب توضيح أن أي رمز مضمّن داخل تطبيق Electron قابل للاستخراج؛ لذلك:

- لا يُعامل هذا الرمز كسر Google.
- لا يمنح الرمز صلاحية Google مباشرة.
- يقتصر على endpoint قراءة مطبع.
- يُدعم بإيقاف/تدوير، rate limiting، وHTTPS.
- لا يُسمح له بالكتابة أو الوصول إلى endpoint آخر.

الخيار الأفضل إنتاجياً هو أن يكون الخادم خلف HTTPS وطبقة وصول مناسبة، مع عدم وضع أي Service Account secret أو refresh token في التطبيق.

---

## 6. عقد endpoint المقترح

### 6.1 الطلب

```http
GET /api/calendar/upcoming?cycle=secondary
```

القيود المقترحة:

- `cycle` **إلزامي**؛ قيمته رمز سلك موجود في خريطة `GOOGLE_CALENDAR_CYCLES`. إذا كان غير معروف يُرفض بـ `INVALID_CYCLE`.
- لا يوجد `limit` للعرض: يعيد الخادم **أحداث الموسم الدراسي الحالي كاملةً** للسلك + المشترك. يبقى `CALENDAR_MAX_RESULTS` سقف أمان تقنياً فقط ضد الاستجابات الضخمة.
- يجب رفض أو تطبيع القيم غير الصحيحة بدلاً من تمريرها مباشرة إلى Google.
- لا توجد عملية POST أو PUT أو DELETE لهذا التكامل.

### 6.2 طلب الخادم إلى Google

عند استقبال `cycle`، يحدّد الخادم **تقويمين**: تقويم المشترك (`GOOGLE_CALENDAR_SHARED_ID`) وتقويم السلك المطابق من `GOOGLE_CALENDAR_CYCLES`. يستدعي `events.list` على كل منهما بنفس القيم:

```text
timeMin = بداية الموسم الدراسي الحالي (ISO 8601)
timeMax = نهاية الموسم الدراسي الحالي (ISO 8601)
singleEvents = true
orderBy = startTime
maxResults = CALENDAR_MAX_RESULTS (حد أمان)
showDeleted = false
```

`timeMin`/`timeMax` يُشتقّان من الموسم الدراسي الحالي (باستخدام `SCHOOL_YEAR_START_MONTH`) حتى لا تتسرّب أحداث موسم قادم قبل أوانه. `singleEvents=true` يوسّع الأحداث المتكررة إلى occurrences، و`orderBy=startTime` مناسب معه.

بعد الجلب، ينفّذ الخادم:

1. تطبيع كل حدث عبر mapper وإسناد `scope` (`shared` لأحداث المشترك، `cycle` لأحداث السلك).
2. **دمج** القائمتين.
3. **إزالة التكرار** بمعرّف الحدث (احتياطاً لو ظهر حدث في التقويمين).
4. الترتيب الزمني تصاعدياً.
5. تعليم الحدث **الأقرب زمنياً** الذي لم يبدأ/ينتهِ بعد بـ `isNext: true` (أول حدث قادم بعد الوقت الحالي).

### 6.3 الاستجابة الناجحة المقترحة

```json
{
  "success": true,
  "cycle": "secondary",
  "schoolYear": "2026-2027",
  "events": [
    {
      "id": "google-event-id",
      "title": "اجتماع مجلس المؤسسة",
      "scope": "cycle",
      "isNext": true,
      "start": "2026-09-15T09:00:00+01:00",
      "end": "2026-09-15T11:00:00+01:00",
      "allDay": false,
      "description": null,
      "location": "قاعة الاجتماعات"
    }
  ],
  "fetchedAt": "2026-07-23T10:00:00.000Z"
}
```

القواعد:

- `cycle`: رمز السلك المطلوب، معاداً كما فُهم للتأكيد.
- `schoolYear`: الموسم الدراسي الذي جُلبت أحداثه.
- `id`: معرف الحدث بعد التحقق من كونه نصاً محدود الطول.
- `title`: من `summary`، مع قيمة آمنة مثل `حدث بدون عنوان` عند غيابه.
- `scope`: `shared` أو `cycle` لتمييز مصدر الحدث في الواجهة.
- `isNext`: `true` لحدث واحد فقط هو الأقرب زمنياً القادم؛ يستخدم لإبرازه بصرياً.
- `start` و`end`: من `dateTime` أو `date` للأحداث طوال اليوم.
- `allDay`: `true` عندما يكون المصدر يستخدم `start.date`.
- `description` و`location`: يضافان فقط إذا احتاجت الواجهة إليهما، وبعد القص والتنقية.
- لا تُعاد حقول المشاركين، access tokens، raw Google response، روابط سرية، أو بيانات غير لازمة.
- `fetchedAt` للمراقبة والتشخيص، وليس لعرضه بالضرورة للمستخدم.

### 6.4 حدث طوال اليوم

إذا كان الحدث يستخدم:

```json
{
  "start": { "date": "2026-09-15" },
  "end": { "date": "2026-09-16" }
}
```

يجب أن يفهم mapper أن `end.date` في Google للأحداث طوال اليوم هو حد نهائي حصري، وألا يعرضه كأنه يوم إضافي دون تحقق. يمكن أن يعيد DTO التاريخ فقط مع `allDay: true`، ثم تتولى الواجهة صياغته بالعربية.

### 6.5 أخطاء endpoint

| الحالة | HTTP | payload مقترح | معنى الواجهة |
|---|---:|---|---|
| إعداد ناقص | 500 | `CONFIGURATION_ERROR` | الخدمة غير مهيأة؛ لا تعرض بيانات افتراضية كأنها Google |
| Google credentials غير صالحة | 502 | `UPSTREAM_AUTH_ERROR` | تعذر جلب التقويم؛ يسجل الخادم التفاصيل الداخلية فقط |
| Google API متوقف/محدود | 502 أو 503 | `UPSTREAM_UNAVAILABLE` | إعادة المحاولة لاحقاً |
| العميل غير مصرح | 401/403 | `UNAUTHORIZED` | لا تعرض تفاصيل سرية في التطبيق |
| `cycle` مفقود أو غير معروف | 400 | `INVALID_CYCLE` | خطأ طلب قابل للتصحيح؛ الواجهة تطلب اختيار سلك صالح |
| لا توجد أحداث للسلك في الموسم | 200 | `events: []` | حالة «لا توجد أحداث لهذا السلك في الموسم» وليست خطأ |

رسائل الخطأ العائدة للعميل تكون عامة. تفاصيل Google، stack traces، ومحتوى الاستجابة الخام تبقى في logging آمن للخادم دون أسرار.

---

## 7. خطة التعديلات المقترحة في الكود

### 7.1 وحدة Google Calendar في الخادم

**ملفات مقترحة ستُضاف:**

```text
server/integrations/google-calendar/client.js
server/integrations/google-calendar/config.js
server/integrations/google-calendar/mapper.js
```

المسؤوليات:

- `config.js`: قراءة والتحقق من المتغيرات (`GOOGLE_CALENDAR_SHARED_ID`، خريطة `GOOGLE_CALENDAR_CYCLES`، `SCHOOL_YEAR_START_MONTH`)، وحلّ رمز السلك إلى Calendar ID، دون طباعة السر.
- `client.js`: إنشاء auth client على الخادم، واستدعاء `events.list` على **تقويمين** (المشترك + السلك) ضمن حدود الموسم، مع تطبيق timeout.
- `mapper.js`: تحويل Google event إلى DTO المعلن أعلاه (مع `scope`)، والتحقق والقص والتعامل مع all-day/recurrence.
- **الدمج**: وحدة تجمع نتيجتي التقويمين، تزيل التكرار بالمعرّف، ترتّب زمنياً، وتعلّم `isNext` على أول حدث قادم.

لا توضع SQL أو منطق Google داخل IPC. الخادم الحالي مستقل عن Electron ويمكن إبقاء `server/index.js` بسيطاً عبر استدعاء وحدة التكامل.

### 7.2 تعديل `server/index.js`

**تعديل مقترح:**

- إضافة تعريف route لـ `GET /api/calendar/upcoming`.
- إضافة تحقق من `cycle` (إلزامي وموجود في خريطة الأسلاك، وإلا `INVALID_CYCLE`).
- إضافة authorization خاص بنقطة التقويم بدلاً من افتراض أن token telemetry الحالي مناسب تلقائياً.
- استدعاء وحدة `google-calendar/client.js` لجلب المشترك + السلك ثم الدمج.
- إرجاع DTO فقط عبر `sendJson` (مع `cycle`، `schoolYear`، `scope`، `isNext`).
- تحويل أخطاء Google إلى رموز عامة مناسبة.
- إبقاء `GET /api/health` وendpoints telemetry الحالية دون تغيير.

يجب تحديث `server/README.md` بعد التنفيذ لشرح المتغيرات الجديدة، طريقة مشاركة التقويم، ونقطة API الجديدة دون تضمين أي قيمة سرية.

### 7.3 إضافة عميل HTTP في Electron main

**ملف مقترح سيُضاف:**

```text
main/integrations/calendar-api.js
```

المسؤوليات:

- معرفة `CALENDAR_API_BASE_URL` أو مصدر إعداد endpoint المعتمد.
- طلب `/api/calendar/upcoming?cycle=<code>` عبر HTTPS في الإنتاج.
- تطبيق timeout وإلغاء الطلب عند الحاجة.
- التحقق من شكل الاستجابة قبل إرسالها إلى renderer.
- **cache محلي**: حفظ آخر استجابة ناجحة لكل سلك (بيانات غير سرية) في مسار بيانات التطبيق، وإعادتها عند offline/timeout مع وسم أنها من الـ cache.
- إعادة نتيجة عامة وآمنة عند offline أو timeout (الـ cache إن وُجد، وإلا حالة خطأ).
- عدم تسجيل headers أو tokens أو raw response.

### 7.4 إضافة IPC

**ملف مقترح سيُضاف:**

```text
main/ipc/calendar.js
```

الدالة المقترحة:

```js
function registerCalendarIpc(ipcMain) { ... }
```

والقناة المقترحة:

```text
calendar:getUpcoming
```

سلوك IPC:

- يستقبل `cycle` (رمز السلك) من renderer ويمرّره للعميل.
- لا يستقبل Calendar ID أو Service Account secret من renderer؛ خريطة الأسلاك تبقى على الخادم.
- يستدعي عميل HTTP في main فقط.
- يعيد DTO المطبع (أو الـ cache) أو error code عاماً.
- لا يحتاج إلى تسجيل دخول Google للمستخدم.

في `main/ipc/registerAll.js` يُقترح:

```js
const { registerCalendarIpc } = require('./calendar');
```

ثم استدعاء `registerCalendarIpc(ipcMain)` داخل `registerAllIpcHandlers`.

### 7.5 إضافة namespace في `preload.js`

**تعديل مقترح:**

```js
calendar: {
    getUpcoming: (cycle) => ipcRenderer.invoke('calendar:getUpcoming', { cycle })
},
```

الواجهة العامة المقترحة هي `window.api.calendar.getUpcoming(cycle)` فقط. لا تُعرض وظائف Google auth، Calendar ID، أو إعدادات الأسرار.

### 7.6 تعديل `app.js`

**تعديل مقترح:**

1. إضافة **منتقي السلك** بجوار بطاقة الجدول الزمني (قائمة صغيرة من الأسلاك المعرّفة). قيمته المختارة تُحفظ كإعداد **محلي للجهاز غير متزامن** (على غرار App Defaults في `AGENTS.md`)، وتُقرأ عند فتح القسم.
2. إضافة دالة تحميل مثل:

   ```js
   async function sjLoadCalendarMilestones(cycle) { ... }
   ```

3. استدعاء `window.api.calendar.getUpcoming(selectedCycle)` من مسار `renderStudentJourney`، وإعادة الاستدعاء عند تغيير السلك من المنتقي.
4. تحويل DTO إلى shape العرض الحالي، مع اشتقاق `kind` من `isNext`/`scope`:

   ```js
   {
       kind: event.isNext ? 'primary' : (event.scope === 'shared' ? 'success' : 'muted'),
       title: event.title,
       date: formattedArabicDate,
       text: event.description || event.location || ''
   }
   ```

5. عرض **كل أحداث الموسم** المعادة (لا قصّ إلى 3)، مع إبراز الحدث ذي `isNext` بصرياً (وسم «الأقرب»/تمييز اللون + نص، لا اللون وحده).
6. تمرير النتائج إلى `sjRenderTimeline`.
7. عدم إدخال HTML من Google مباشرة؛ تبقى `escapeHtml` مستخدمة قبل العرض.
8. عدم تغيير `sjRenderTimeline` ليقبل raw Google events (يمكن توسيعه ليقبل حقل «الأقرب» فقط، أو تمرير `kind` مناسب).
9. إضافة رسائل حالة في بطاقة الجدول الزمني أو عنصر status ملاصق لها، بما فيها حالة «عرض من نسخة محفوظة» عند استخدام الـ cache.

يمكن إبقاء `SJ_DEFAULT_MILESTONES` مؤقتاً كـ fallback منفصل، لكن لا يُستخدم عند نجاح endpoint بإرجاع `events: []`؛ فالإرجاع الفارغ يعني فعلياً «لا توجد أحداث لهذا السلك في الموسم».

### 7.7 تنسيق التاريخ

يجب توحيد DTO أولاً على ISO date/dateTime. بعد ذلك:

- الحدث ذو الوقت: يعرض التاريخ والوقت بالمنطقة الزمنية المعتمدة.
- الحدث طوال اليوم: يعرض التاريخ فقط.
- يستخدم `parseLocalDate` و`formatDateAr` أو helper جديد موثق في `js/shared/date-utils.js`.
- لا يُعتمد على `new Date('YYYY-MM-DD')` دون تحديد السلوك المحلي، لأن ذلك قد يسبب انزياحاً في بعض المناطق الزمنية.
- يجب توثيق هل العرض النهائي يعتمد `ar-MA` أو أسماء الشهور المغربية الموجودة في `MOROCCAN_MONTHS`.

---

## 8. حالات واجهة المستخدم

يجب أن تميز الواجهة بين الحالات التالية، دون الاعتماد على اللون وحده:

### Loading

- إظهار placeholder أو نص `جارٍ تحميل الأحداث...` داخل البطاقة.
- عدم عرض أحداث `SJ_DEFAULT_MILESTONES` أثناء الانتظار إذا كان الهدف هو إظهار Google فقط.
- تعطيل أي تفاعل غير ضروري؛ لا توجد عملية يدوية مطلوبة من المستخدم.

### اختيار السلك

- منتقي سلك ظاهر بجوار البطاقة؛ تغييره يعيد التحميل فوراً للسلك الجديد.
- القيمة المختارة محفوظة محلياً، فتُستعاد عند إعادة فتح التطبيق دون سؤال المستعمل.
- إن لم يُختَر سلك بعد، تُعرض دعوة لطيفة لاختيار السلك بدل حالة خطأ.

### Success

- عرض **كل أحداث الموسم الدراسي الحالي** للسلك المختار + الأحداث المشتركة، بالترتيب الزمني القادم من الخادم دون إعادة ترتيب غير موثق في renderer.
- **إبراز الحدث الأقرب** (`isNext`) بوسم نصي واضح («الأقرب») إضافةً إلى التمييز اللوني، لا اللون وحده.
- تمييز الأحداث المشتركة عن أحداث السلك بصرياً عبر `scope` (مثلاً وسم «مشترك»).
- عرض العنوان والتاريخ، والوصف/المكان فقط عند توفرهما.

### No events

- عرض رسالة مثل: `لا توجد أحداث لهذا السلك في الموسم الحالي.`
- لا تعرض الحالة كخطأ تقني.
- لا تستبدلها تلقائياً بأحداث افتراضية.

### Error / Offline

- إن وُجد **cache** لهذا السلك: عرض أحداثه مع وسم `عرض من نسخة محفوظة`.
- إن لم يوجد cache: رسالة عامة مثل `تعذر تحميل أحداث التقويم حالياً.`
- إبقاء بقية لوحة التحكم تعمل.
- تسجيل تفاصيل تشخيصية محلية محدودة دون credentials أو raw response.
- إعادة المحاولة تلقائياً عند فتح الصفحة أو عبر polling، دون مطالبة المستخدم بأي إعداد.

### التحديث

النسخة الأولى المقترحة:

- جلب عند فتح/عرض قسم الصفحة.
- إعادة جلب دورية كل 10–15 دقيقة أثناء بقاء التطبيق مفتوحاً.
- timeout قصير وbackoff عند الفشل.
- إيقاف polling عند عدم وجود الصفحة أو عند إغلاق النافذة.

لا حاجة إلى Google push notifications في النسخة الأولى؛ webhook يحتاج endpoint HTTPS عاماً ولا يرسل مباشرة إلى Electron المحلي.

---

## 9. الأمن والخصوصية

### متطلبات إلزامية

- Service Account private key أو OAuth refresh token في الخادم فقط.
- عدم وضع أي Google secret في `app.js` أو `preload.js` أو `main` الموزع.
- عدم كتابة السر في `.env` المرفق بحزمة Electron؛ `package.json` الحالي يحتوي `extraResources` لـ `.env`، لذلك يجب عدم إضافة أسرار Google إلى ذلك الملف الموزع.
- إضافة secret files إلى `.gitignore` إن لزم، مع التحقق من Git history قبل النشر.
- استخدام HTTPS بين Electron والخادم في الإنتاج.
- تقييد Service Account على تقاويم التكامل فقط (المشترك + الأسلاك)، لا غيرها.
- صلاحية كل التقاويم مشاركة للقراءة فقط.
- خريطة `GOOGLE_CALENDAR_CYCLES` والتقويم المشترك تبقى على الخادم، ولا تُرسل إلى renderer.
- عدم دعم أي write endpoint للتقويم.
- rate limiting وtimeout وحجم response محدود.
- تدوير Service Account key أو إلغاؤه عند الشك في تسربه.
- عدم إرجاع `htmlLink` أو attendees أو conference data إلا إذا ثبتت حاجة المنتج إليها.

### Logging

يسمح بتسجيل:

- timestamp
- status code الداخلي
- latency
- error category
- calendar integration health

لا يسمح بتسجيل:

- Service Account JSON
- access token أو refresh token
- client token
- Authorization header
- raw Google response

---

## 10. الاختبارات والتحقق

لا تُضاف اختبارات جديدة في هذه الخطة نفسها؛ عند التنفيذ يجب إضافة اختبارات السلوك المتغير فقط.

### 10.1 اختبارات mapper

- تحويل event بوقت محدد.
- تحويل event طوال اليوم.
- غياب `summary`.
- غياب `description` و`location`.
- event متكرر بعد `singleEvents=true`.
- event ملغى أو ناقص الحقول.
- قص strings الطويلة ومنع قيم غير نصية.
- إسناد `scope` الصحيح (shared مقابل cycle).
- دمج تقويمين مع إزالة تكرار بالمعرّف.
- تعليم `isNext` على أول حدث قادم فقط (وعدم تعليمه إن مرّت كل الأحداث).
- الترتيب الزمني الصحيح لأحداث الموسم كاملة.

### 10.2 اختبارات عميل Google

- نجاح `events.list`.
- رفض credentials ناقصة.
- Google 401/403.
- Google 429/5xx.
- timeout/network failure.
- التأكد أن Authorization لا يظهر في logs أو DTO.

### 10.3 اختبارات endpoint

- `GET /api/calendar/upcoming?cycle=<code>` يعيد أحداث المشترك + السلك مدمجة ومرتّبة.
- `cycle` مفقود أو غير معروف → `INVALID_CYCLE` (400).
- `events: []` عند عدم وجود أحداث للسلك في الموسم.
- التقيّد بحدود الموسم الدراسي (`timeMin`/`timeMax`) وعدم تسرّب أحداث خارجه.
- إسناد `scope` و`isNext` في الاستجابة.
- 401/403 حسب سياسة الوصول المختارة.
- عدم تأثر endpoints telemetry الموجودة.
- عدم إعادة payload Google الخام.

### 10.4 اختبارات Electron/UI

- IPC يمرّر `cycle` ويعيد DTO الصحيح فقط.
- عمل الـ cache: عرض آخر نسخة محفوظة عند offline مع وسم واضح.
- ثبات اختيار السلك بعد إعادة فتح التطبيق.
- `window.api.calendar` لا يكشف أسراراً أو وظائف غير مطلوبة.
- render loading/success/no events/error، وإبراز `isNext`، وتمييز `scope`.
- HTML escaping للعناوين والوصف والمكان.
- التطبيق يبقى قابلاً للاستخدام عند توقف الخادم.
- التحقق من 375px/شاشات صغيرة وعدم قص العناوين العربية مع قائمة أحداث أطول.

### 10.5 أوامر المشروع

بعد التنفيذ، يشغّل الفريق على الأقل:

```bash
npm run lint
npm test
npm run test:smoke
```

ويُشغّل اختبار endpoint في بيئة معزولة ببيانات اعتماد اختبارية، دون وضع المفتاح في المستودع. إذا كان اختبار Google الحقيقي غير مناسب في CI، يستخدم mock لـ `events.list` مع اختبار تكامل منفصل محمي بالأسرار في بيئة النشر.

---

## 11. خطة التنفيذ المرحلية

### المرحلة 0 — اعتماد القرار

- تأكيد Service Account كخيار أساسي.
- تحديد قائمة الأسلاك ورموزها، والتقويم المشترك، والمنطقة الزمنية، وشهر بداية الموسم.
- تحديد هل endpoint قراءة التقويم عام محدود أم يحتاج client token.
- تحديد عنوان HTTPS للخادم في الإنتاج.

### المرحلة 1 — إعداد Google Cloud

- إنشاء المشروع/الخدمة، وإنشاء التقويم المشترك وتقويم لكل سلك.
- مشاركة **كل** التقاويم مع Service Account للقراءة فقط، وتعبئة `GOOGLE_CALENDAR_SHARED_ID` و`GOOGLE_CALENDAR_CYCLES`.
- اختبار API خارج التطبيق على تقويمين على الأقل.
- وضع secret في Secret Manager أو مخزن أسرار الخادم.

### المرحلة 2 — تنفيذ الخادم

- إضافة مكتبة Google المختارة بإصدار مثبت ومراجعته أمنياً.
- إضافة `config.js`, `client.js`, `mapper.js`.
- إضافة `/api/calendar/upcoming`.
- إضافة timeout، rate limiting، authorization، وتطبيع الأخطاء.
- تحديث `server/README.md`.

### المرحلة 3 — تنفيذ Electron

- إضافة HTTP client في main.
- إضافة `main/ipc/calendar.js`.
- تسجيل الوحدة في `main/ipc/registerAll.js`.
- إضافة namespace في `preload.js`.
- عدم تخزين Google credential في Electron.

### المرحلة 4 — تنفيذ الواجهة

- إضافة منتقي السلك وحفظ اختياره محلياً (غير متزامن).
- إضافة loading/success/empty/error + حالة الـ cache.
- استبدال مصدر `SJ_DEFAULT_MILESTONES` في مسار العرض بناتج Google، وعرض أحداث الموسم كاملةً مع إبراز `isNext` وتمييز `scope`.
- توحيد تنسيق التاريخ عبر `date-utils`.
- إبقاء escaping وعدم عرض raw data.
- إضافة polling/backoff حسب القرار النهائي.

### المرحلة 5 — التحقق والنشر التجريبي

- تشغيل الاختبارات المحلية.
- اختبار خادم staging بتقويم تجريبي.
- اختبار نسخة Electron على جهاز غير مسجل في Google.
- مراقبة logs والتأكد من غياب الأسرار.
- اختبار توقف الخادم وعودة الشبكة.

### المرحلة 6 — الإنتاج

- نشر الخادم مع secret manager/متغيرات بيئة آمنة.
- التأكد من HTTPS وDNS/firewall/rate limit.
- التأكد من صحة خريطة الأسلاك والتقويم المشترك على الخادم فقط.
- إصدار Electron بعد التأكد أن الحزمة لا تحتوي Google secret.

---

## 12. التراجع والمخاطر

### التراجع

إذا فشل التكامل بعد النشر:

1. تعطيل route أو feature flag من الخادم.
2. إعادة الواجهة إلى حالة «التقويم غير متاح» بدلاً من بيانات مضللة.
3. إبقاء `SJ_DEFAULT_MILESTONES` في الكود فقط كخيار توافق مؤقت، إن وافق المنتج على ذلك.
4. إعادة نشر نسخة Electron السابقة إذا كان الخلل في IPC أو preload.
5. تدوير Google credentials فوراً عند الاشتباه في التسرب.

### المخاطر

| الخطر | الأثر | المعالجة |
|---|---|---|
| وضع المفتاح في حزمة Electron | قراءة كل الأحداث/الوصول للتقويم | Service Account على الخادم فقط |
| اختلاف المنطقة الزمنية | تاريخ/وقت خاطئ | ISO + timezone واتفاق واضح على `ar-MA` |
| أحداث متكررة | تكرار أو ترتيب غير صحيح | `singleEvents=true`, `orderBy=startTime` |
| توقف Google أو الخادم | عدم ظهور الأحداث | empty/error state وpolling/backoff |
| client token مستخرج من التطبيق | إساءة استخدام endpoint | token محدود + HTTPS + rate limiting + تدوير |
| event description يحتوي HTML | XSS في الواجهة | `escapeHtml` وعدم استخدام `innerHTML` غير المنقّى |
| تغير Google schema أو مكتبة auth | فشل الخادم | mapper اختباري ومراقبة وصحة endpoint |
| خلط الافتراضي بالحقيقي | معلومات مدرسية مضللة | تمييز الحالات وعدم fallback صامت |
| المسؤول يضع حدثاً في التقويم الخطأ | ظهوره لسلك غير مقصود | توثيق قاعدة العمل (مشترك مقابل سلك) + وسم `scope` واضح للمراجعة |
| رمز سلك غير موجود في الخريطة | فشل الطلب | `INVALID_CYCLE` + منتقي يعرض الأسلاك المعرّفة فقط |
| cache قديم بعد تحديث المسؤول | عرض أحداث موسم سابق | ربط الـ cache بالموسم الدراسي + polling + وسم «نسخة محفوظة» |

---

## 13. معايير قبول التنفيذ

يُعتبر التنفيذ مستوفياً عندما تتحقق جميع النقاط التالية:

- [ ] المستعمل يختار سلكه فقط (دون Google login أو إجراء يدوي)، ويُحفظ الاختيار محلياً.
- [ ] لكل سلك تُعرض الأحداث المشتركة + أحداث السلك، أي **أحداث الموسم الدراسي الحالي كاملةً**، مع إبراز الحدث الأقرب.
- [ ] الأحداث المشتركة تُميَّز بصرياً عن أحداث السلك عبر `scope`.
- [ ] لا يظهر Service Account key أو OAuth secret أو refresh token داخل Electron أو renderer أو logs.
- [ ] كل التقاويم (المشترك + الأسلاك) مشتركة مع Service Account بصلاحية قراءة فقط.
- [ ] endpoint `GET /api/calendar/upcoming?cycle=<code>` يعمل ويدمج المشترك + السلك عبر الخادم المركزي.
- [ ] الأحداث مقيّدة بحدود الموسم الدراسي ولا تتسرّب أحداث خارجه.
- [ ] response DTO لا يحتوي raw Google payload أو credentials، ويتضمن `scope` و`isNext`.
- [ ] `#sj-timeline` يعرض loading/success/no events/error + حالة «نسخة محفوظة» بوضوح.
- [ ] الأحداث طوال اليوم والأحداث ذات الوقت تعرض بشكل صحيح بالعربية.
- [ ] فشل الشبكة لا يعطل بقية لوحة التحكم، ويظهر آخر cache إن وُجد.
- [ ] `npm run lint` و`npm test` و`npm run test:smoke` ناجحة بعد التنفيذ.
- [ ] تم اختبار staging ثم الإنتاج، مع إمكانية تعطيل التكامل والتراجع.

---

## مراجع

- الخطة السابقة: `docs/plans/2026-07-18-google-calendar-shared-admin-plan.md`
- عنصر الواجهة: `index.html` — `#sj-timeline`
- مصدر العرض: `app.js` — `SJ_DEFAULT_MILESTONES`, `sjRenderTimeline`, `renderStudentJourney`
- الخادم: `server/index.js`
- توثيق الخادم: `server/README.md`
- تسجيل IPC: `main/ipc/registerAll.js`
- جسر Electron: `preload.js`
- التاريخ: `js/shared/date-utils.js`
- [Google Calendar API authentication and scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Google Calendar events.list](https://developers.google.com/google-apps/calendar/v3/reference/events/list)

Content based on external Google documentation is paraphrased rather than reproduced verbatim.
