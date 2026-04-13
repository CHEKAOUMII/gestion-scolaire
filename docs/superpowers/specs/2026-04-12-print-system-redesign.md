# مواصفات إعادة هيكلة نظام الطباعة

**التاريخ:** 2026-04-12  
**الحالة:** معتمدة — جاهزة للتنفيذ  
**الهدف:** توحيد نظام الطباعة في API مركزية واحدة (`PrintSystem`) تخفي تعقيد المسارين داخلياً وتجعل إضافة الطباعة لأي صفحة جديدة أمراً يتطلب سطراً واحداً.

---

## 1. المشكلة الحالية

### 4 مسارات غير موحدة
| المسار | الصفحات | المشكلة |
|--------|----------|----------|
| `openPrintPreview()` — modal داخل التطبيق | 9 صفحات HTML | المنطق مبعثر في `ux-enhancements.js` |
| `electronPrint({ mode:'preview' })` — BrowserWindow مرئية | `timetable-students`, `timetable-rooms` | مسار مختلف تماماً |
| `window.print()` مباشرة | `timetable-teachers` | لا ترويسة، لا theme normalization |
| `window.api.system.printHTML` + fallback | `reports-semester` | يختار المسار وقت التشغيل بمنطق مبعثر |
| وظائف في `js/pages/*.js` | 15 ملف JS | كل ملف ينفذ منطق الطباعة بطريقته |

### CSS مكررة ثلاث مرات
- `.ux-pp-sheet` — 207 سطر selector في `tailwind-input.css` (نطاق المعاينة)
- `body.ux-printing-active #ux-print-root` — نفس القواعد تقريباً (نطاق الطباعة الفعلية)
- `buildPrintDocument()` في `print-window.js` — نفس القواعد مرة ثالثة (نطاق BrowserWindow)

### مشاكل ثانوية
- معرفات أزرار غير متسقة: `#print-btn`, `#print-preview-btn`, `#export-pdf-btn`, `#zeros-export-btn`, `#tp-print-btn`, `#sp-print-btn`
- الترويسة (letterhead) مُنفَّذة في 3 أماكن مختلفة
- `timetable-teachers.html` يستدعي `window.print()` مباشرة — لا letterhead، لا theme normalization

---

## 2. الحل المقترح — API موحدة بمسارين داخليين

### المبدأ الأساسي
صفحات التطبيق تستدعي **`PrintSystem`** فقط. هي من تقرر داخلياً أي مسار تستخدم.

```
الصفحة
  └─► PrintSystem.preview(options)   ←── الصفحات العادية (تحليل، غياب، طلاب، ...)
  └─► PrintSystem.window(options)    ←── جداول الحصص، التقارير المعقدة
```

### المسار أ — `PrintSystem.preview(options)`
يستبدل: `openPrintPreview()` + `electronPrint()` بدون HTML جاهز  
الآلية: modal داخل الـ renderer → live DOM capture → `#ux-print-root` → `window.api.system.printCurrentWindow` أو `printToPDF`

### المسار ب — `PrintSystem.window(options)`
يستبدل: `window.api.system.printHTML()` + `electronPrint({ htmlContent })`  
الآلية: يرسل HTML جاهز للـ main process → `print-window.js` → hidden BrowserWindow → PDF أو طباعة

---

## 3. الملفات الجديدة والمُعدَّلة

### ملفات جديدة
| الملف | الدور |
|-------|-------|
| `js/print-system.js` | الـ API المركزية — يُعرِّف `window.PrintSystem` |
| `css/print.css` | كل CSS المتعلقة بالطباعة في مكان واحد |

### ملفات مُعدَّلة
| الملف | التعديل |
|-------|---------|
| `js/ux-enhancements.js` | حذف الدوال من السطر 496 إلى 907، إبقاء `buildLetterheadHTML` عاماً |
| `css/tailwind-input.css` | حذف كتل `.ux-pp-sheet` و`body.ux-printing-active #ux-print-root` المكررة، إضافة `@import "print.css"` |
| 9 ملفات HTML | استبدال `openPrintPreview(...)` بـ `PrintSystem.preview(...)` |
| 2 ملف HTML | استبدال `electronPrint(...)` بـ `PrintSystem.window(...)` |
| 1 ملف HTML | استبدال `window.print()` بـ `PrintSystem.preview(...)` |
| 15 ملف `js/pages/*.js` | استبدال استدعاءات الطباعة بـ `PrintSystem.*` |

---

## 4. واجهة `PrintSystem` التفصيلية

```js
// js/print-system.js

window.PrintSystem = {

    /**
     * المسار أ — معاينة وطباعة محتوى موجود في DOM الحالي.
     * يفتح modal للمعاينة، ثم يطبع أو يصدر PDF.
     *
     * @param {object} options
     * @param {string}  [options.contentSelector]   CSS selector للعنصر المصدر
     *                                               (fallback: '#support-export-sheet' → '.main-content' → 'main')
     * @param {string}  [options.title]              عنوان الوثيقة في الترويسة
     * @param {boolean} [options.landscape=false]    اتجاه الصفحة
     * @param {string}  [options.pageSize='A4']      حجم الصفحة
     * @param {boolean} [options.noHeader=false]     تخطي الترويسة المدرسية
     * @param {Promise} [options.waitFor]            Promise ينتظر قبل الالتقاط
     * @returns {Promise<void>}
     */
    async preview(options = {}) { ... },

    /**
     * المسار ب — طباعة HTML جاهز عبر hidden BrowserWindow في Main process.
     * للتقارير وجداول الحصص التي تبني HTML خاصاً بها.
     *
     * @param {object} options
     * @param {string}  options.htmlContent          HTML كامل للمحتوى (بدون letterhead — يُضاف تلقائياً)
     * @param {string}  [options.title]              عنوان الوثيقة
     * @param {string}  [options.mode='pdf']         'pdf' | 'print' | 'preview'
     * @param {boolean} [options.landscape=false]    اتجاه الصفحة
     * @param {string}  [options.pageSize='A4']      حجم الصفحة
     * @param {string}  [options.defaultFileName]    اسم ملف PDF المقترح
     * @param {string}  [options.inlineStyles]       CSS إضافية تُحقن في الوثيقة
     * @param {boolean} [options.skipAutoLetterhead=false]  تخطي الترويسة التلقائية
     * @returns {Promise<void>}
     */
    async window(options = {}) { ... },
};
```

### مثال الاستخدام في صفحة عادية
```js
// قبل
openPrintPreview({ title: 'تقرير الغياب', pageSize: 'A4', landscape: true });

// بعد
PrintSystem.preview({ title: 'تقرير الغياب', pageSize: 'A4', landscape: true });
```

### مثال الاستخدام في صفحة جداول الحصص
```js
// قبل
electronPrint({ htmlContent: builtHTML, mode: 'preview', title: 'جدول الحصص', landscape: true });

// بعد
PrintSystem.window({ htmlContent: builtHTML, mode: 'preview', title: 'جدول الحصص', landscape: true });
```

---

## 5. بنية `css/print.css`

```css
/* ============================================================
   print.css — كل CSS المتعلقة بالطباعة في مكان واحد
   ============================================================ */

/* 1. Modal المعاينة (.ux-pp-*) */
.ux-pp-modal { ... }
.ux-pp-sheet {
    background: #fff;
    color: #111;
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 10mm;
}

/* 2. scope موحد: يطبق على .ux-pp-sheet و #ux-print-root معاً */
.ux-pp-sheet, #ux-print-root {
    /* جميع overrides للـ KPI cards، جداول الحصص، التحليل، ... */
    .kpi-card { ... }
    .section-card { ... }
    /* ... */
}

/* 3. @media print — قواعد محرك الطباعة */
@media print {
    @page { margin: 0.5cm; size: A4 portrait; }
    body > *:not(#ux-print-root):not(#printable-bulletin):not(...) {
        display: none !important;
    }
    #ux-print-root { display: block !important; }
}

/* 4. Dark mode suppression */
[data-theme="dark"] .ux-pp-sheet,
[data-theme="dark"] #ux-print-root {
    background: #fff !important;
    color: #111 !important;
}
```

**المكسب الرئيسي:** scope واحد `(.ux-pp-sheet, #ux-print-root)` بدل نسختين مكررتين.

---

## 6. خطة التنفيذ خطوة بخطوة

### المرحلة 1 — إنشاء `js/print-system.js` (الأساس)
1. إنشاء `js/print-system.js` الجديد
2. نقل دوال الطباعة من `js/ux-enhancements.js` (السطر 496–907) إلى الملف الجديد
3. تغليفها داخل `window.PrintSystem = { preview, window: windowPrint }`
4. إضافة `<script src="js/print-system.js">` في جميع الصفحات التي تستخدم الطباعة (أو في template مشترك)
5. التحقق أن `window.UXEnhancements.electronPrint` و`window.UXEnhancements.openPrintPreview` لا تزال تعمل (للتوافق العكسي خلال مرحلة الانتقال)

### المرحلة 2 — إنشاء `css/print.css` (CSS الموحدة)
1. إنشاء `css/print.css`
2. نقل كتلة `.ux-pp-modal` كاملة من `tailwind-input.css` (السطر 3989–4921)
3. دمج كتل `.ux-pp-sheet` و`body.ux-printing-active #ux-print-root` في scope موحد (`.ux-pp-sheet, #ux-print-root`)
4. نقل كتل `@media print` الرئيسية (السطر 3446–3496 و6073–6456)
5. إضافة `@import "./print.css"` في `css/tailwind-input.css` واحذف الكتل المنقولة
6. تشغيل `npm run css:build` والتحقق من عدم وجود أخطاء

### المرحلة 3 — تحديث صفحات HTML (المسار أ)
تحديث كل صفحة لاستخدام `PrintSystem.preview(...)` بدل `openPrintPreview(...)`:

| الصفحة | التغيير |
|--------|---------|
| `absence-analytics.html` | `openPrintPreview(...)` → `PrintSystem.preview(...)` |
| `absence-weekly.html` | `openPrintPreview(...)` → `PrintSystem.preview(...)` |
| `absence-correspondence.html` | `openPrintPreview(...)` → `PrintSystem.preview(...)` |
| `analytics.html` | `openPrintPreview(...)` → `PrintSystem.preview(...)` |
| `compensation-tracking.html` | `openPrintPreview(...)` → `PrintSystem.preview(...)` |
| `grades-results.html` | `openPrintPreview(...)` → `PrintSystem.preview(...)` |
| `reports-semester.html` | `openPrintPreview(...)` → `PrintSystem.preview(...)` |
| `results-hub.html` | كل fallbacks → `PrintSystem.preview(...)` |
| `student-support.html` | `openPrintPreview(...)` → `PrintSystem.preview(...)` |
| `timetable-teachers.html` | `window.print()` → `PrintSystem.preview(...)` |

### المرحلة 4 — تحديث صفحات HTML (المسار ب)
| الصفحة | التغيير |
|--------|---------|
| `timetable-students.html` | `electronPrint({ mode:'preview', ... })` → `PrintSystem.window({ mode:'preview', ... })` |
| `timetable-rooms.html` | `electronPrint({ mode:'preview', ... })` → `PrintSystem.window({ mode:'preview', ... })` |

### المرحلة 5 — تحديث ملفات `js/pages/*.js`
| الملف | التغيير |
|-------|---------|
| `staff-daily-report.js` | استبدال استدعاء الطباعة بـ `PrintSystem.preview(...)` |
| `timetable.js` | استبدال استدعاءات الطباعة الثلاث |
| `teachers-performance.js` | استبدال `#tp-print-btn` و`#tp-export-btn` |
| `timetable-rooms.js` | استبدال استدعاء `electronPrint` |
| `timetable-students.js` | استبدال استدعاء `electronPrint` |
| `tracking-teachers-performance.js` | استبدال استدعاء الطباعة |
| `support-sessions.js` | استبدال استدعاء الطباعة |
| `timetable-redistribution.js` | استبدال استدعاء الطباعة |
| `students-status.js` | استبدال استدعاء الطباعة |
| `students-list.js` | استبدال استدعاء الطباعة |
| `grades-sheets.js` | استبدال استدعاء الطباعة |
| `teachers-list.js` | استبدال استدعاء الطباعة |
| `reports-certificates.js` | استبدال استدعاء الطباعة |
| `student-profile.js` | استبدال استدعاء الطباعة |

### المرحلة 6 — تنظيف `js/ux-enhancements.js`
1. حذف الدوال من السطر 496 إلى 907 (كل دوال الطباعة)
2. إبقاء `buildLetterheadHTML` (السطر 1056–1087) وتصديرها من `print-system.js` بدلاً منه
3. تحديث `window.UXEnhancements` (السطر 1318–1337) لإزالة `electronPrint` و`openPrintPreview`

### المرحلة 7 — التحقق النهائي
1. تشغيل `npm run css:build` — لا أخطاء
2. تشغيل `npm run lint` — لا أخطاء
3. تشغيل `npm run test:smoke` — نجاح
4. اختبار يدوي: طباعة من 3 صفحات مختلفة (صفحة عادية، جدول الحصص، تقرير مُعقد)
5. اختبار الـ dark mode: التحقق أن المعاينة تظهر دائماً بخلفية بيضاء

---

## 7. ما لا يتغير

- **`main/print-window.js`** — لا يُعدَّل، `PrintSystem.window()` يستدعيه كما هو عبر `window.api.system.printHTML`
- **`preload.js`** — لا يُعدَّل، القنوات الثلاث (`printCurrentWindow`, `printToPDF`, `printHTML`) تبقى كما هي
- **المسارات الخاصة** (`correspondence:markPrinted`, `reports:printDocument`) — لا علاقة لها بهذا التغيير
- **CSS خاصة بكل صفحة** (المبعثرة في أماكن متعددة) — تُنقل فقط إذا كانت مرتبطة بالطباعة مباشرة

---

## 8. المكاسب بعد التنفيذ

| قبل | بعد |
|-----|-----|
| 4 طرق مختلفة لاستدعاء الطباعة | طريقتان فقط: `preview` و`window` |
| ~3000 سطر CSS مكررة في 3 أماكن | ملف `print.css` واحد، scope واحد |
| إضافة صفحة جديدة = نسخ منطق معقد | إضافة صفحة جديدة = سطر واحد |
| تعديل لون في المعاينة = 3 أماكن | تعديل لون في المعاينة = مكان واحد |
| `timetable-teachers` يطبع بدون letterhead | كل الصفحات ترويسة موحدة |
| معرفات أزرار غير متسقة | لا تغيير في هذه المرحلة (مشكلة منفصلة) |
