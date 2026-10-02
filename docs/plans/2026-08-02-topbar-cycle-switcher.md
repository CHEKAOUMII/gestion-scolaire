# خطة تبديل المرحلة من الشريط العلوي (Top Bar Cycle Switcher)

**التاريخ:** 2026-08-02
**الحالة:** خطة مقترحة — بانتظار اعتماد التنفيذ
**النطاق:** نقل محوّل السلك (المرحلة النشطة) من الشريط الجانبي إلى الشريط العلوي على كل الصفحات، كمتحكّم واحد شامل. لا تغييرات على IPC أو preload أو قاعدة البيانات أو المزامنة.
**المصادر:** [خطة تعميم بنية الأسلاك الثلاثة](./2026-08-02-multi-stage-school-architecture.md) (S5/S6)، `js/sidebar.js`، `main/ipc/cycles.js`.

---

## 1. الخلاصة التنفيذية

- يوجد اليوم محوّل سلك في الشريط الجانبي (`js/sidebar.js:476-516`)، لكنه غير بارز: صغير، داخل القائمة الجانبية، ولا يظهر إلا إذا تجاوز عدد الأسلاك المدعومة سلكاً واحداً.
- البيانات معزولة بالسلك (كل صفحة تعرض بيانات السلك النشط)، لذا فوجود «مؤشر + محوّل» دائم في الشريط العلوي يجعل سياق العمل الحالي ظاهراً على كل صفحة ويمنع العمل على بيانات السلك الخطأ.
- **القرار:** نقل (لا تكرار) — ينتقل المحوّل إلى الشريط العلوي (`header-right`) ويُحذف من الشريط الجانبي. متحكّم واحد لكل الجلسة.
- **آلية الحقن:** الشريط العلوي منسوخ يدوياً في ~47 صفحة HTML — لا نعدّل أي صفحة HTML. `js/sidebar.js` محمّل على كل الصفحات أصلاً، فيقوم بحقن المحوّل في `.header-right` برمجياً (نفس نمط حقن الشريط الجانبي اليوم).

---

## 2. القرارات المعتمدة

| # | القرار | السبب |
|---|---|---|
| D1 | **نقل وليس تكرار** — محوّل واحد في الشريط العلوي، يُحذف محوّل الشريط الجانبي | محوّلان = صيانة مزدوجة (حارس التعديلات غير المحفوظة، إعادة التحميل، تحديث `onConfigurationChanged`) وانتباه مشتت |
| D2 | **معنى «مفعّل» = `is_active` + `capability === 'supported'` + مصرّح به للمستخدم** — بالضبط ما يرجعه `cycles:list` بعد `filterAuthorizedCycles` (`main/ipc/cycles.js:29-32`) | أسلاك `preview` («قيد الإعداد») لا تظهر أبداً كخيار قابل للاختيار |
| D3 | **الحالات الحدّية:** 0 سلك مفعّل → إخفاء المحوّل؛ سلك واحد → إظهاره معطلاً كمؤشر «السلك الحالي»؛ 2+ → محوّل فعلي | اتساق مع `getActive` الفاشل-مغلقاً (`cycles:getActive` يرجع `requiresSelection`) ومع سلوك صفحة الجدول (`timetable.js:836`) |
| D4 | **قيمة المحوّل = سلك الجلسة الحالي** (`getActive` → `context.cycleCode`)، بنفس منطق `sidebar.js:482` — فيعمل كمؤشر حالة ومحوّل معاً | إزالة الغموض: المستخدم يرى دائماً أين يعمل |
| D5 | **إعادة استخدام عقد الحماية القائم:** `[data-unsaved-changes="true"]` + الحدث القابل للإلغاء `app:beforeCycleChange` + `cycles.setActive(value, getSchoolYear())` + إعادة تحميل الصفحة | أي صفحة تتعامل مع الحارس اليوم (sidebar) تتعامل معه غداً بلا تغيير |
| D6 | **إبقاء الاسم العام `window.refreshCycleSwitcher`** وتحديث الاشتراك `cycles.onConfigurationChanged` بنفس الآلية | يُستدعى من `settings-school.js:633` بعد إضافة/تعطيل سلك — بدون تعديله |
| D7 | **لا تغييرات على `preload.js` أو `main/ipc/cycles.js` أو المخازن** — الواجهة `window.api.cycles.{list,getActive,setActive,onConfigurationChanged}` كافية | أصغر سطح تغيير |

---

## 3. الوضع الحالي المُتحقق منه

| المجال | الموقع | الملاحظة |
|---|---|---|
| ترميز المحوّل (حقن داخل الشريط الجانبي) | `js/sidebar.js:18-21` | `#sidebar-cycle-switcher` + `#sidebar-cycle-select`، Tailwind utilities |
| منطق التحميل | `js/sidebar.js:476-516` | `cycles.list()` + `cycles.getActive()` بالتوازي؛ فلترة `is_active && supported`؛ إخفاء عند <2؛ الحارس؛ `setActive` → إعادة تحميل |
| الاشتراك في تغييرات الإعداد | `js/sidebar.js:209-210` | `cycles.onConfigurationChanged(loadCycleSwitcher)` |
| التحديث من صفحة إعدادات المؤسسة | `settings-school.js:633` | `window.refreshCycleSwitcher()` بعد add/setEnabled |
| الشريط العلوي | `.header` / `.header-right` في كل صفحة (مكرر يدوياً) | `index.html:31-68` النموذج الكامل (بحث، زر القائمة، السمات، الإشعارات، العام الدراسي `dashboard-year-control`)؛ باقي الصفحات نسخ أخف |
| سلك الجلسة | `main/ipc/cycles.js:34-63` (`getActive`، فاشل-مغلقاً + `requiresSelection`) و`71-80` (`setActive` + `assertCycleAuthorized`) | البنية الخلفية جاهزة بلا تغيير |
| `js/sidebar.js` على كل الصفحات | 47 صفحة HTML تستورده | نقطة حقن موحّدة بلا تعديل HTML |

---

## 4. التصميم

### 4.1 الموضع والترميز

- يُحقن المحوّل **في بداية `.header-right`** (الأيمن بصرياً في RTL، قبل زر السمة) على الصفحات التي تحتوي `.header-right` فقط؛ الصفحات بلا `.header-right` تتجاهل الحقن بصمت (مثل `injectSidebar` الحالية).
- الترميز (حقن برمجي):

```html
<div id="topbar-cycle-switcher" class="topbar-cycle-switcher" hidden>
    <label for="topbar-cycle-select">السلك</label>
    <select id="topbar-cycle-select" aria-label="السلك التعليمي النشط"></select>
</div>
```

- التنسيق: نمط مضغوط يستعير مظهر `dashboard-year-control` (تسمية صغيرة + select)؛ إذا كانت الفئة غير متاحة على الصفحة، استخدم utilities عامة (كما يفعل sidebar اليوم). يُحفظ `hidden` حتى يكتمل التحميل (لا وميض).

### 4.2 المنطق (نقل وتنقيح `loadCycleSwitcher`)

| الخطوة | السلوك |
|---|---|
| تحميل | `Promise.all([cycles.list(), cycles.getActive()])`؛ فشل أحدهما → إخفاء المحوّل بصمت (لا نكسر الصفحة) |
| خيارات | `cycles` المفلترة `is_active` (قائمة `cycles:list` مصرّحة أصلاً — D2)؛ صفوف `preview` معروضة **معطّلة** مع لاحقة «قيد الإعداد»؛ فقط `supported` قابلة للاختيار |
| الحالة 0 | `wrapper.hidden = true` (لا توجد أسلاك مفعّلة) |
| الحالة 1 | `wrapper.hidden = false`؛ `select.disabled = true`؛ كل الأسلاك المفعلة ظاهرة (المعاينة رمادية مع «قيد الإعداد»)، الخيار المحدد = سلك الجلسة (أو الوحيد المتاح) |
| الحالة 2+ | `wrapper.hidden = false`؛ `select.disabled = false` (عند 2+ أسلاك `supported`)؛ الخيار المحدد = `active.context?.cycleCode \|\| active.cycle?.cycle_code` |
| عند التبديل | حارس `data-unsaved-changes` + حدث `app:beforeCycleChange` (قابل للإلغاء) → رفض مع toast «احفظ التعديلات الحالية قبل تبديل السلك»؛ الموافقة → `cycles.setActive(value, getSchoolYear())` → نجاح: `window.location.reload()`؛ فشل: إرجاع القيمة القديمة + toast الخطأ |
| إعادة تنسيق | استخراج دالة نقية `buildCycleSwitcherOptions(cycles, activeCycleCode)` (فلترة + تحديد) تُصدَّر من الوحدة لتكون قابلة للاختبار |
| التحديثات | الحفاظ على `window.refreshCycleSwitcher` و`onConfigurationChanged` — الآن يعيدان تعبئة المحوّل العلوي |

### 4.3 الإزالة من الشريط الجانبي

- حذف كتلة `#sidebar-cycle-switcher` من قالب `injectSidebar` (`sidebar.js:18-21`) — الشريط الجانبي يعود نظيفاً؛ التسمية «السلك النشط» تنتقل للشريط العلوي.

---

## 5. خطوات التنفيذ

- [x] **1.`js/sidebar.js`:** إزالة كتلة `#sidebar-cycle-switcher` من قالب الحقن (الأسطر 18-21).
- [x] **2.`js/sidebar.js`:** استبدال `loadCycleSwitcher` بـ `loadTopbarCycleSwitcher` يعمل على `.header-right`؛ حقن الترميز + الحالات 0/1/2+ (D2/D3/D4) + الحارس (D5) + إعادة التحميل/التراجع.
- [x] **3.`js/sidebar.js`:** استخراج `buildCycleSwitcherOptions(cycles, activeCycleCode)` كدالة نقية معلنة على `window` (نفس نمط `refreshCycleSwitcher`) للاختبار.
- [x] **4.`js/sidebar.js`:** إبقاء `window.refreshCycleSwitcher` + الاشتراك `onConfigurationChanged` (نُقل إلى مستوى الوحدة، مستقلاً عن الشريط الجانبي) (D6) — `settings-school.js:633` لا يتغير.
- [x] **5.اختبارات:** ملف جديد `tests/cycle-switcher.test.js` بنمط منصة DOM الخفيفة (`vm` — النمط في `tests/exam-sections-dom.test.js`):
  - `buildCycleSwitcherOptions`: يعرض كل الأسلاك **المفعّلة** (`is_active`)، يعلّم صفوف `preview` كمعطّلة مع لاحقة «قيد الإعداد»، يعيّن الخيار المحدد من `context.cycleCode` (للـ `supported` فقط)، يستبعد غير المفعّل؛ يرجع قائمة فارغة عند 0.
  - الوحدة الكاملة: إخفاء عند 0؛ تعطيل عند 1؛ تفعيل عند 2+؛ الحارس يرفض مع وجود `[data-unsaved-changes]` (select يعود للقيمة القديمة)؛ إلغاء حدث `app:beforeCycleChange` يمنع التبديل؛ نجاح `setActive` → reload؛ فشل → إرجاع القيمة القديمة + toast.
  - صفحات بلا `.header-right` → لا حقن ولا أخطاء.
  - `refreshCycleSwitcher` يُعاد تثبيته و`onConfigurationChanged` مشترك.
- [x] **6.فحص أثر:** grep لا يتبقى أي مرجع `sidebar-cycle-select`؛ `settings-school.js:633` يعمل دون تعديل.
- [x] **7.توثيق:** إضافة سطر إلى `AGENTS.md` (قسم Manual Additions) يصف محوّل الشريط العلوي.

**حالة التنفيذ (2026-08-02):** اكتملت جميع الخطوات؛ `npm test` أخضر (252 ملفاً — الملف الجديد `tests/cycle-switcher.test.js` 13 حالة) و`npm run lint` بلا أخطاء.

**تحديث (2026-08-02):** قرار UX — كل الأسلاك المفعلة تظهر في القائمة المنسدلة؛ صفوف `preview` («قيد الإعداد») معطّلة ومرئية حتى يرى المستخدم سبب عدم إمكانية العمل بها (كانت مخفية سابقاً). القابل للاختيار يبقى `supported` فقط؛ الحالة 1 تعرض المؤشر المعطّل مع كل الأسلاك المفعلة. تم تحديث `AGENTS.md`، `tests/cycle-switcher.test.js` (حالة جديدة: preview-only → مؤشر معطّل)، و`tests/e2e/stage-pages.e2e.js` (مشاهد 2/3/8).

---

## 6. نطاق خارجي (خارج هذه الخطة)

- ترقية `capability` من `preview` إلى `supported` للابتدائي/الإعدادي — قرار كتالوجي بخطة الأسلاك (لا UI).
- تعديل تخطيط الشريط العلوي لكل صفحة يدوياً — غير مطلوب بفضل الحقن البرمجي.
- أي تغيير على `cycles:*` IPC أو `user_cycle_access` — مملوك للخطط الأم.

---

## 7. التحقق

- `npm test` أخضر بالكامل (251 ملفاً حالي) + الملف الجديد `tests/cycle-switcher.test.js` أخضر.
- `npm run lint` بلا أخطاء جديدة (لا يزيد عن 55 تحذيراً قائماً).
- فحص يدوي: `index.html` (سلك واحد اليوم: يظهر معطلاً كمؤشر «التأهيلي»)؛ الصفحات بلا `.header-right` (إن وُجدت)؛ عدم كسر `settings-school.js` عند إضافة/تعطيل سلك (إعادة التعبئة).

## 8. الملفات المتأثرة

| ملف | نوع التغيير |
|---|---|
| `js/sidebar.js` | تعديل (نقل + حقن + إزالة) |
| `tests/cycle-switcher.test.js` | جديد |
| `AGENTS.md` | تعديل (توثيق) |
