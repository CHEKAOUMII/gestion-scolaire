# قائمة الإصلاحات — `settings-sync.html` ومسار المزامنة

> مراجعة كود مؤرّخة 2026-07-02. الملف يجمع كل ما يحتاج إصلاحاً بعد **التحقق الفعلي** من الادعاءات
> مقابل المخطط (`schema.js` + `migrations.js`) والكود. الأسطر مرجعية وقد تنزاح بعد أي تعديل.

## الملفات المعنية

| الملف | الدور |
|-------|-------|
| [settings-sync.html](../../settings-sync.html) | الواجهة (بنية الأقسام فقط) |
| [js/pages/settings-sync.js](../../js/pages/settings-sync.js) | منطق الـ renderer |
| [main/ipc/sync.js](../../main/ipc/sync.js) | قنوات IPC + منطق حل التعارض |
| [main/sync/credentials.js](../../main/sync/credentials.js) | `testConnection` |
| [main/db/migrations.js](../../main/db/migrations.js) | مخطط `sync_conflicts` / `sync_id_map` |

## ملخّص الأولويات

| # | الأولوية | المشكلة | الملف |
|---|----------|---------|-------|
| 1 | 🔴 حرجة | حل التعارض اليدوي لا يطبّق الاختيار على البيانات فعلياً | `main/ipc/sync.js:302-351` |
| 2 | 🟠 مهمة | `deriveSyncState` يتجاهل `status.enabled` | `js/pages/settings-sync.js:486-492` |
| 3 | 🟠 مهمة | JSON parsing غير محمي لـ `local_data`/`remote_data` يُظهر «لا توجد تعارضات» | `main/ipc/sync.js:281-282` |
| 4 | 🟡 تحسين | ملف الـ renderer ضخم (~1292 سطر) يخلط مسؤوليات | `js/pages/settings-sync.js` |
| 5 | ⚪ Nit | بقايا تسميات AWS في اختبار الاتصال | `js/pages/settings-sync.js:828` |
| 6 | ⚪ Nit | صياغة تعليق الصلاحيات مربكة | `js/pages/settings-sync.js:4` |

---

## 1) 🔴 حل التعارض اليدوي لا يطبّق الاختيار فعلياً

**الموضع:** `sync:resolveConflict` في [main/ipc/sync.js:302-351](../../main/ipc/sync.js#L302)

**الوضع الحالي** — عند الضغط على «محلي»/«بعيد» يجري:
- تحديث `sync_conflicts.status = 'resolved'` + `resolution` + `resolved_at`.
- تحديث `resolved_data` و`resolution_method = 'manual'`.
- تحديث `sync_id_map.ancestor_data` فقط.
- عند «محلي» فقط: إدراج صف **جديد** في `sync_outbox`.

**ما لا يحدث (مؤكَّد بالتحقق من المخطط):**
- ❌ لا يُطبَّق `remote_data` على الجدول المحلي عند اختيار «بعيد» — الصف المحلي يبقى بقيمته القديمة.
- ❌ لا يُحدَّث `sync_id_map.version` إلى `remote_version` (العمود موجود عبر migration `2026-03-033`، [migrations.js:660](../../main/db/migrations.js#L660)).
- ❌ لا يُعالَج `sync_conflicts.local_outbox_id` الأصلي الفاشل (العمود موجود، [migrations.js:606](../../main/db/migrations.js#L606)) — يبقى `failed`.
- ❌ لا يُعاد استخدام منطق تطبيق remote الموجود في مسار السحب (`pullRemoteChanges`).

**الأثر:**
- «بعيد» يظهر كأنه حُلّ بينما البيانات المحلية لم تتغيّر → فقدان صامت لقرار المستخدم.
- «محلي» قد يُعيد التعارض نفسه لأن `version` يبقى قديماً عند الرفع التالي.
- عدّاد «العناصر الفاشلة» يبقى مرتفعاً بسبب صف الـ outbox الأصلي.
- عند «محلي»: صف outbox مكرَّر بدل إعادة فتح الأصلي.

**الإصلاح المقترح:**
- [ ] لفّ `resolveConflict` كاملاً داخل `db.transaction(...)`.
- [ ] **عند «بعيد»:**
  - [ ] تطبيق `remote_data` على الجدول المحلي عبر `sync_id_map.local_id` (يُفضَّل إعادة استخدام دالة التطبيق نفسها المستعملة في `pullRemoteChanges` بدل تكرار المنطق).
  - [ ] `UPDATE sync_id_map SET version = remote_version, ancestor_data = remote_data WHERE row_sync_id = ?`.
  - [ ] تعليم `local_outbox_id` الأصلي كـ `sent`/`resolved` أو تعطيله حسب سياسة المشروع.
- [ ] **عند «محلي»:**
  - [ ] `UPDATE sync_id_map SET version = remote_version, ancestor_data = remote_data` **قبل** إعادة الرفع (حتى لا يُرفض الرفع بتعارض إصدار جديد).
  - [ ] إعادة فتح `local_outbox_id` الأصلي (`status='pending'`, تصفير `last_error`) بدل إدراج صف outbox جديد، إن أمكن.
- [ ] إضافة اختبار يغطّي المسارين (`local` و`remote`) ويؤكّد: تغيّر الصف المحلي، وتحديث `version`، وحالة الـ outbox.

**ملاحظة تنفيذ:** يجب مراجعة `main/sync/engine.js` لمعرفة كيف يطبّق السحب remote_data واستخراج الدالة لإعادة استخدامها هنا (تجنّب ازدواج المنطق / DRY).

---

## 2) 🟠 `deriveSyncState` يتجاهل `status.enabled`

**الموضع:** [js/pages/settings-sync.js:486-492](../../js/pages/settings-sync.js#L486)

الدالة تشتقّ `connected/syncing/offline/error` اعتماداً على `configured` فقط، ولا تفحص `enabled`
رغم أن الخلفية ترجعه صراحةً: `enabled: configured && !!config.enabled` في [main/ipc/sync.js:122](../../main/ipc/sync.js#L122).

**النتيجة:** لو صار `enabled = 0` مع بقاء `configured = true`، تعرض الواجهة «متصل» بينما مؤقتات الخلفية متوقفة.

**الإصلاح المقترح:**
- [ ] إرجاع `'disabled'` أيضاً عندما `!status.enabled`:
  ```js
  if (!status || !status.configured || !status.enabled) return 'disabled';
  ```
- [ ] **أو** — إن لم يعد لـ `enabled` معنى وظيفي مستقل — حذفه من مخرجات `getStatus` لتفادي الالتباس. (اختَر مساراً واحداً واذكر السبب.)

---

## 3) 🟠 JSON parsing غير محمي يُظهر «لا توجد تعارضات» زوراً

**الموضع:** [main/ipc/sync.js:281-282](../../main/ipc/sync.js#L281) داخل `sync:getConflictLog`

بقية الحقول (`ancestor_data`, `conflicting_fields`, `resolved_data`) محميّة بـ try/catch، لكن:
```js
localData: row.local_data ? JSON.parse(row.local_data) : null,
remoteData: row.remote_data ? JSON.parse(row.remote_data) : null,
```
غير محميّة. عند فشل الـ parse يرمي المعالج، فيلتقطه `handleAdminRead` ويرجع كائن خطأ (غير مصفوفة)،
وفي الواجهة [settings-sync.js:941](../../js/pages/settings-sync.js#L941) أي قيمة غير مصفوفة تُعامَل كفراغ → «لا توجد تعارضات».

**الإصلاح المقترح:**
- [ ] parsing آمن لـ `local_data` و`remote_data` (نفس نمط الحقول الأخرى: try/catch يُرجع القيمة الخام أو `null`).
- [ ] في الواجهة: التمييز بين «رد خطأ `{ success:false }`» و«مصفوفة فارغة» — عرض رسالة خطأ حقيقية في الحالة الأولى بدل «لا توجد تعارضات».

---

## 4) 🟡 (تحسين) ملف الـ renderer ضخم ويخلط مسؤوليات

**الموضع:** كامل [js/pages/settings-sync.js](../../js/pages/settings-sync.js) (~1292 سطراً)

يجمع: الصلاحيات، الحالة، الإعدادات، نتائج المزامنة، جدول التعارضات، تظليل JSON، الترقيم، وتحليل forensics —
ما يصعّب إصلاح المسارات الحساسة (كالتعارضات).

**الإصلاح المقترح (غير عاجل، ليس عيباً وظيفياً):**
- [ ] تقسيم لاحق إلى وحدات: `sync-status-view.js`, `sync-config-form.js`, `sync-conflicts-view.js`, `sync-forensics-view.js`, `sync-api-client.js`.
- ⚠️ يُنفَّذ **بعد** إصلاح البند 1 لتفادي تعارض التعديلات؛ الأولوية للسلوك لا للبنية.

---

## 5) ⚪ (Nit) بقايا تسميات AWS في اختبار الاتصال

**الموضع:** [js/pages/settings-sync.js:828](../../js/pages/settings-sync.js#L828)

```js
const stepLabel = { lambda: 'Lambda', cognito: 'Cognito', dynamodb: 'DynamoDB' }[result.step] || '';
```
بينما `testConnection` الحالي يُرجع `step: 'firestore'` ([credentials.js:293,298](../../main/sync/credentials.js#L293)) — فالخريطة لا تطابق أبداً و`stepLabel` يبقى فارغاً.

**الإصلاح المقترح:**
- [ ] استبدال الخريطة بمصطلحات Firebase: `{ firestore: 'Firestore', auth: 'Firebase Auth', functions: 'Firebase Functions' }`.

---

## 6) ⚪ (Nit) صياغة تعليق الصلاحيات مربكة

**الموضع:** [js/pages/settings-sync.js:4](../../js/pages/settings-sync.js#L4) و[main/ipc/sync.js:18](../../main/ipc/sync.js#L18)

ليس خطأً وظيفياً: الواجهة تسمح لـ `{admin, developer}`، والخلفية `['admin']` **لكن** `requireRole` يمنح
`developer` تجاوزاً عاماً ([auth.js:169](../../main/ipc/auth.js#L169)) — فالطرفان متطابقان فعلياً في السماح لـ admin+developer.

**الإصلاح المقترح:**
- [ ] توحيد الصياغة في التعليقات: «admin، مع تجاوز عام لدور developer عبر `requireRole`» لتفادي التباس القارئ.

---

## نقاط إيجابية (لا تحتاج إصلاحاً — للتوثيق)

- الخلفية تفرض الصلاحيات فعلياً عبر `handleWrite`/`handleAdminRead` ولا تعتمد على الإخفاء البصري.
- استخدام `textContent`/`replaceChildren` بدل `innerHTML` يقلّل مخاطر XSS.
- تقسيم وظيفي واضح للواجهة (حالة، إعدادات، مزامنة يدوية، تعارضات، تشخيص).
- `aria-live` و`role=status/alert` وRTL مضبوطة.
- `schoolId` مُستبعَد عمداً من `setConfig` ([sync.js:163-166](../../main/ipc/sync.js#L163)) — مفتاح المستأجر الثابت لا يُكتب إلا عبر إعداد/ربط المؤسسة.

## حالة التحقق

- [x] البند 1: أعمدة `local_outbox_id` / `version` / `ancestor_data` مؤكَّدة في المخطط.
- [x] البند 2: `deriveSyncState` يفحص `configured` فقط — مؤكَّد.
- [x] البند 3: `local_data`/`remote_data` بلا حماية parse — مؤكَّد.
- [x] البند 5: `testConnection` يُرجع `firestore` بينما الخريطة AWS — مؤكَّد.
- [x] البند 6: تجاوز `developer` في `requireRole` — مؤكَّد.
