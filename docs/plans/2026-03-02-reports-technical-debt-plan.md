# Reports Engine Technical Debt — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 5 technical debt items in the reports/exports subsystem: remove dead code, add error handling, fix hard-coded school name, deduplicate letterhead, and implement 4 admin forms.

**Architecture:** All fixes use the existing unified `printDocument()` engine pipeline. Admin forms follow Approach A — templates in `main/reports/channels/adminForms.js` feed `bodyHTML` to the engine. A new `reports:renderLetterhead` IPC channel eliminates the duplicate client-side letterhead.

**Tech Stack:** Electron IPC, `better-sqlite3`, vanilla JS, HTML templates

---

### Task 1: Remove legacy IPC channels (Fix 5)

**Files:**
- Modify: `main/ipc/reports.js:19-48`
- Modify: `preload.js:169-171`

**Step 1: Remove legacy handlers from `main/ipc/reports.js`**

Delete lines 19–48 (the `// Legacy compat` comment and both `ipcMain.handle` blocks). The file should become:

```js
const { printDocument } = require('../reports/engine');
const { getIdentity, updateIdentity } = require('../reports/identity');

function registerReportsIpc(ipcMain) {
    // Unified document printing — single entry point for all pages
    ipcMain.handle('reports:printDocument', (_event, payload) => {
        return printDocument(payload);
    });

    // Identity management
    ipcMain.handle('reports:getIdentity', () => {
        return getIdentity();
    });

    ipcMain.handle('reports:updateIdentity', (_event, updates) => {
        return updateIdentity(updates);
    });
}

module.exports = { registerReportsIpc };
```

**Step 2: Remove legacy entries from `preload.js`**

Delete lines 169–171 (the `// Legacy compat` comment and both `generateCertificate`/`generateSemesterSummary` entries). The reports namespace should become:

```js
    reports: {
        printDocument: (payload) => ipcRenderer.invoke('reports:printDocument', payload),
        getIdentity: () => ipcRenderer.invoke('reports:getIdentity'),
        updateIdentity: (updates) => ipcRenderer.invoke('reports:updateIdentity', updates)
    },
```

**Step 3: Run smoke tests**

Run: `npm run test:smoke`
Expected: PASS — IPC parity still holds (channels removed from both sides)

**Step 4: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add main/ipc/reports.js preload.js
git commit -m "refactor: remove dead legacy IPC channels (generateCertificate, generateSemesterSummary)"
```

---

### Task 2: Add try/catch to `engine.js` (Fix 3)

**Files:**
- Modify: `main/reports/engine.js:20-99`

**Step 1: Wrap the pipeline in try/catch**

Replace the body of `printDocument()` so the entire pipeline (steps 1–8) is inside a try block. On error, log with `console.error` and return a structured error response:

```js
async function printDocument(payload) {
    const {
        documentType,
        documentTitle,
        bodyHTML,
        data = {},
        options = {}
    } = payload;

    const {
        mode = 'pdf',
        pageSize = 'A4',
        landscape = false,
        copies = 1,
        bodyHeight,
        showSeal = true,
        showSignature = true,
        showSecurity = true,
        showWatermark = false,
        showLetterhead = true,
        showFooter = true,
        defaultFileName
    } = options;

    try {
        // 1. Generate document reference
        const documentRef = generateDocumentRef(documentType);

        // 2. Render locked letterhead
        const letterheadHTML = showLetterhead
            ? renderLetterhead({
                documentTitle,
                documentRef: showSecurity ? documentRef : ''
            })
            : '';

        // 3. Render locked footer
        const footerHTML = showFooter
            ? renderFooter({ showSeal, showSignature })
            : '';

        // 4. Generate security bar (optional)
        let securityHTML = '';
        if (showSecurity) {
            const secBar = generateSecurityBar({
                documentType,
                documentRef,
                studentName: data.studentName || '',
                issuedAt: new Date().toISOString().slice(0, 10)
            });
            securityHTML = secBar.html;
        }

        // 5. Watermark (optional)
        const identity = getIdentity();
        const watermarkHTML = showWatermark
            ? renderWatermark(identity.school_name || '')
            : '';

        // 6. Assemble complete document
        const fullBodyHTML = assembleDocumentBody(
            { letterheadHTML, bodyHTML, footerHTML, securityHTML, watermarkHTML },
            { pageSize, landscape, bodyHeight, copies }
        );

        // 7. Get base CSS
        const inlineStyles = getBaseDocumentStyles({ landscape });

        // 8. Send to existing print engine (skip auto-letterhead — we render our own)
        const result = await printHTML({
            htmlContent: fullBodyHTML,
            inlineStyles,
            title: documentTitle || 'وثيقة رسمية',
            pageSize,
            landscape,
            mode,
            defaultFileName: defaultFileName || `${documentTitle || documentType}_${documentRef}`,
            skipAutoLetterhead: true
        });

        return { ...result, ref: documentRef };
    } catch (err) {
        console.error('[ReportEngine] printDocument failed:', err);
        return { success: false, error: err.message || 'فشل إنشاء الوثيقة' };
    }
}
```

**Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 3: Run smoke tests**

Run: `npm run test:smoke`
Expected: PASS

**Step 4: Commit**

```bash
git add main/reports/engine.js
git commit -m "fix: add try/catch error handling to report engine pipeline"
```

---

### Task 3: Fix hard-coded school name in `printChart()` (Fix 1)

**Files:**
- Modify: `app.js:1077-1100`

**Step 1: Replace the hard-coded school name with dynamic identity lookup**

The function is already `async`. Fetch identity at the top and use `id.school_name`:

```js
// زر طباعة الرسم البياني
async function printChart(chartId, title) {
    const canvas = document.getElementById(chartId);
    if (!canvas) return;

    let schoolName = '';
    try {
        const id = await window.api.reports.getIdentity();
        schoolName = id?.school_name || '';
    } catch (_) { /* identity unavailable */ }

    const htmlContent = `
        <div class="print-header">
            <div class="school-name">${schoolName}</div>
            <div class="doc-title">${title}</div>
            <div class="doc-date">${new Date().toLocaleDateString('ar-MA')}</div>
        </div>
        <img src="${canvas.toDataURL('image/png')}" alt="${title}">
    `;

    if (typeof electronPrint === 'function') {
        await electronPrint({
            htmlContent,
            title,
            defaultFileName: title.replace(/[\\/:*?"<>|]/g, '_'),
            pageSize: 'A4'
        });
    } else {
        window.print();
    }
}
```

**Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 3: Commit**

```bash
git add app.js
git commit -m "fix: replace hard-coded school name in printChart with dynamic identity lookup"
```

---

### Task 4: Deduplicate letterhead via IPC (Fix 2)

**Files:**
- Modify: `main/ipc/reports.js`
- Modify: `preload.js`
- Modify: `js/ux-enhancements.js:406-454`

**Step 1: Add `renderLetterhead` IPC channel**

In `main/ipc/reports.js`, import `renderLetterhead` and add a new handler. After Task 1, the file should have 3 handlers. Add the new one after `updateIdentity`:

Add this import at the top:

```js
const { renderLetterhead } = require('../reports/letterhead');
```

Add this handler inside `registerReportsIpc`, after the `updateIdentity` handler:

```js
    // Server-rendered letterhead — single source of truth for all contexts
    ipcMain.handle('reports:renderLetterhead', (_event, overrides) => {
        return renderLetterhead(overrides || {});
    });
```

**Step 2: Expose in `preload.js`**

Add `renderLetterhead` to the reports namespace (after `updateIdentity`):

```js
        renderLetterhead: (overrides) => ipcRenderer.invoke('reports:renderLetterhead', overrides),
```

**Step 3: Run smoke tests to verify IPC parity**

Run: `npm run test:smoke`
Expected: PASS

**Step 4: Replace the duplicate letterhead in `ux-enhancements.js`**

Replace lines 406–454 (the entire `if (!options.contentSelector)` block that builds `headerHTML`) with:

```js
        // Build letterhead header (only when cloning raw page content, not custom contentSelector)
        let headerHTML = '';
        if (!options.contentSelector) {
            try {
                const printTitle = options.title || document.querySelector('.page-title h1')?.textContent || document.title || '';
                headerHTML = await window.api.reports.renderLetterhead({ documentTitle: printTitle });
            } catch (_) {
                // Identity not available — fall back to simple header
                const printTitle = options.title || document.title || 'طباعة';
                const now = new Date();
                const dateStr = now.toLocaleDateString('ar-MA', { year: 'numeric', month: 'long', day: 'numeric' });
                headerHTML = `<div class="ux-pp-print-header">
                    <div class="ux-pp-doc-title">${printTitle}</div>
                    <div class="ux-pp-doc-date">${dateStr}</div>
                </div>`;
            }
        }
```

**Step 5: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 6: Commit**

```bash
git add main/ipc/reports.js preload.js js/ux-enhancements.js
git commit -m "refactor: deduplicate letterhead via reports:renderLetterhead IPC channel"
```

---

### Task 5: Create admin forms templates (Fix 4, part 1)

**Files:**
- Create: `main/reports/channels/adminForms.js`

**Step 1: Create the `channels` directory and `adminForms.js`**

Run: `mkdir -p main/reports/channels` (directory may already exist but has no files)

**Step 2: Write 4 template functions**

Create `main/reports/channels/adminForms.js` with these contents. Each template returns a `bodyHTML` string matching the existing report engine's expectations (RTL Arabic, inline styles for print fidelity):

```js
/**
 * Admin form body templates for the unified report engine.
 * Each function returns bodyHTML — the engine wraps it with
 * letterhead, footer, security bar, and watermark.
 */

function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const fieldStyle = 'border-bottom: 1.5px dotted #999; min-width: 140px; display: inline-block; padding: 2px 6px; font-weight: 600; color: #222;';
const labelStyle = 'font-size: 11px; color: #444; margin-left: 4px;';
const sectionStyle = 'margin-bottom: 14px;';
const rowStyle = 'display: flex; flex-wrap: wrap; gap: 8px 24px; margin-bottom: 10px; font-size: 11px; line-height: 2;';
const headingStyle = 'font-size: 12px; font-weight: 700; color: #3B6AC5; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; margin-bottom: 10px;';
const signatureBoxStyle = 'display: inline-block; width: 180px; text-align: center; margin-top: 30px;';
const signatureLineStyle = 'border-top: 1px solid #888; margin-top: 40px; padding-top: 4px; font-size: 10px; color: #555;';

function field(label, value) {
    return `<span style="${labelStyle}">${esc(label)}:</span> <span style="${fieldStyle}">${esc(value)}</span>`;
}

function signatureBlock(label) {
    return `<div style="${signatureBoxStyle}">
        <div style="${signatureLineStyle}">${esc(label)}</div>
    </div>`;
}

/**
 * Registration form — student enrollment
 * @param {object} d
 * @param {string} d.studentName
 * @param {string} d.massarCode
 * @param {string} d.birthDate
 * @param {string} d.birthPlace
 * @param {string} d.gender
 * @param {string} d.nationality
 * @param {string} d.className
 * @param {string} d.guardianName
 * @param {string} d.guardianPhone
 * @param {string} d.address
 * @param {string} d.schoolYear
 */
function buildRegistrationFormHTML(d) {
    return `
    <div style="${sectionStyle}">
        <div style="${headingStyle}">معلومات التلميذ(ة)</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.studentName)}
            ${field('رمز مسار', d.massarCode)}
        </div>
        <div style="${rowStyle}">
            ${field('تاريخ الازدياد', d.birthDate)}
            ${field('مكان الازدياد', d.birthPlace)}
        </div>
        <div style="${rowStyle}">
            ${field('الجنس', d.gender)}
            ${field('الجنسية', d.nationality || 'مغربية')}
        </div>
        <div style="${rowStyle}">
            ${field('القسم', d.className)}
            ${field('السنة الدراسية', d.schoolYear)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">معلومات ولي الأمر</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.guardianName)}
            ${field('رقم الهاتف', d.guardianPhone)}
        </div>
        <div style="${rowStyle}">
            ${field('العنوان', d.address)}
        </div>
    </div>

    <div style="display: flex; justify-content: space-between; margin-top: 20px;">
        ${signatureBlock('توقيع ولي الأمر')}
        ${signatureBlock('توقيع المدير(ة)')}
    </div>`;
}

/**
 * Transfer form — student moving between schools
 * @param {object} d
 * @param {string} d.studentName
 * @param {string} d.massarCode
 * @param {string} d.birthDate
 * @param {string} d.className
 * @param {string} d.originSchool
 * @param {string} d.destinationSchool
 * @param {string} d.reason
 * @param {string} d.guardianName
 * @param {string} d.schoolYear
 */
function buildTransferFormHTML(d) {
    return `
    <div style="${sectionStyle}">
        <div style="${headingStyle}">معلومات التلميذ(ة)</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.studentName)}
            ${field('رمز مسار', d.massarCode)}
        </div>
        <div style="${rowStyle}">
            ${field('تاريخ الازدياد', d.birthDate)}
            ${field('القسم', d.className)}
        </div>
        <div style="${rowStyle}">
            ${field('السنة الدراسية', d.schoolYear)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">تفاصيل الانتقال</div>
        <div style="${rowStyle}">
            ${field('المؤسسة الأصلية', d.originSchool)}
        </div>
        <div style="${rowStyle}">
            ${field('المؤسسة المستقبلة', d.destinationSchool)}
        </div>
        <div style="${rowStyle}">
            ${field('سبب الانتقال', d.reason)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">موافقة ولي الأمر</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.guardianName)}
        </div>
    </div>

    <div style="display: flex; justify-content: space-between; margin-top: 20px;">
        ${signatureBlock('توقيع ولي الأمر')}
        ${signatureBlock('توقيع مدير(ة) المؤسسة الأصلية')}
        ${signatureBlock('توقيع مدير(ة) المؤسسة المستقبلة')}
    </div>`;
}

/**
 * Dropout declaration form
 * @param {object} d
 * @param {string} d.studentName
 * @param {string} d.massarCode
 * @param {string} d.className
 * @param {string} d.lastAttendanceDate
 * @param {string} d.reason
 * @param {string} d.guardianName
 * @param {string} d.guardianPhone
 * @param {string} d.schoolYear
 */
function buildDropoutFormHTML(d) {
    return `
    <div style="${sectionStyle}">
        <div style="${headingStyle}">معلومات التلميذ(ة)</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.studentName)}
            ${field('رمز مسار', d.massarCode)}
        </div>
        <div style="${rowStyle}">
            ${field('القسم', d.className)}
            ${field('السنة الدراسية', d.schoolYear)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">تفاصيل الانقطاع</div>
        <div style="${rowStyle}">
            ${field('آخر يوم حضور', d.lastAttendanceDate)}
        </div>
        <div style="${rowStyle}">
            ${field('سبب الانقطاع', d.reason)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">ولي الأمر</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.guardianName)}
            ${field('رقم الهاتف', d.guardianPhone)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="font-size: 10px; color: #666; border: 1px solid #e0e0e0; border-radius: 6px; padding: 8px; background: #fafafa;">
            <b>ملاحظة:</b> تم إشعار ولي الأمر بانقطاع التلميذ(ة) عن الدراسة وفقا للمقتضيات القانونية المعمول بها.
        </div>
    </div>

    <div style="display: flex; justify-content: space-between; margin-top: 20px;">
        ${signatureBlock('توقيع ولي الأمر')}
        ${signatureBlock('توقيع المدير(ة)')}
    </div>`;
}

/**
 * Absence justification form
 * @param {object} d
 * @param {string} d.studentName
 * @param {string} d.massarCode
 * @param {string} d.className
 * @param {string} d.absenceFrom
 * @param {string} d.absenceTo
 * @param {string} d.totalDays
 * @param {string} d.reason
 * @param {string} d.guardianName
 * @param {string} d.guardianPhone
 * @param {string} d.schoolYear
 */
function buildAbsenceJustificationHTML(d) {
    return `
    <div style="${sectionStyle}">
        <div style="${headingStyle}">معلومات التلميذ(ة)</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.studentName)}
            ${field('رمز مسار', d.massarCode)}
        </div>
        <div style="${rowStyle}">
            ${field('القسم', d.className)}
            ${field('السنة الدراسية', d.schoolYear)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">تفاصيل الغياب</div>
        <div style="${rowStyle}">
            ${field('من تاريخ', d.absenceFrom)}
            ${field('إلى تاريخ', d.absenceTo)}
        </div>
        <div style="${rowStyle}">
            ${field('عدد الأيام', d.totalDays)}
        </div>
        <div style="${rowStyle}">
            ${field('سبب الغياب', d.reason)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">ولي الأمر</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.guardianName)}
            ${field('رقم الهاتف', d.guardianPhone)}
        </div>
    </div>

    <div style="display: flex; justify-content: space-between; margin-top: 20px;">
        ${signatureBlock('توقيع ولي الأمر')}
        ${signatureBlock('توقيع المدير(ة)')}
    </div>`;
}

/** Map of form type keys to builder functions and default titles */
const FORM_BUILDERS = {
    registration: { build: buildRegistrationFormHTML, title: 'استمارة تسجيل التلاميذ' },
    transfer:     { build: buildTransferFormHTML,     title: 'استمارة الانتقال' },
    dropout:      { build: buildDropoutFormHTML,      title: 'استمارة الانقطاع' },
    absence:      { build: buildAbsenceJustificationHTML, title: 'استمارة تبرير الغياب' }
};

module.exports = {
    FORM_BUILDERS,
    buildRegistrationFormHTML,
    buildTransferFormHTML,
    buildDropoutFormHTML,
    buildAbsenceJustificationHTML
};
```

**Step 3: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 4: Commit**

```bash
git add main/reports/channels/adminForms.js
git commit -m "feat: add 4 admin form body templates for report engine"
```

---

### Task 6: Wire admin forms IPC channel (Fix 4, part 2)

**Files:**
- Modify: `main/ipc/reports.js`
- Modify: `preload.js`

**Step 1: Add the `generateAdminForm` handler to `main/ipc/reports.js`**

Add this import at the top of the file:

```js
const { FORM_BUILDERS } = require('../reports/channels/adminForms');
```

Add this handler inside `registerReportsIpc`, after the `renderLetterhead` handler added in Task 4:

```js
    // Admin forms — generates official form PDFs via the unified engine
    ipcMain.handle('reports:generateAdminForm', (_event, payload) => {
        const { formType, data = {}, mode = 'pdf' } = payload;
        const builder = FORM_BUILDERS[formType];
        if (!builder) {
            return { success: false, error: `نوع الاستمارة غير معروف: ${formType}` };
        }
        const bodyHTML = builder.build(data);
        return printDocument({
            documentType: 'admin_form',
            documentTitle: builder.title,
            bodyHTML,
            data: { studentName: data.studentName || '' },
            options: {
                mode,
                showSecurity: true,
                showWatermark: false,
                defaultFileName: `${builder.title}_${data.massarCode || ''}`
            }
        });
    });
```

**Step 2: Expose in `preload.js`**

Add to the `reports` namespace (after `renderLetterhead`):

```js
        generateAdminForm: (payload) => ipcRenderer.invoke('reports:generateAdminForm', payload),
```

**Step 3: Run smoke tests**

Run: `npm run test:smoke`
Expected: PASS — new channel registered on both sides

**Step 4: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add main/ipc/reports.js preload.js
git commit -m "feat: add reports:generateAdminForm IPC channel"
```

---

### Task 7: Build admin forms UI (Fix 4, part 3)

**Files:**
- Rewrite: `reports-forms.html`
- Create: `js/pages/reports-forms.js`

**Step 1: Create `js/pages/reports-forms.js`**

This follows the IIFE pattern used by `grades-sheets.js`. It manages a card grid with expand/collapse forms, collects field data, and calls the `generateAdminForm` IPC:

```js
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    const FORM_CONFIGS = {
        registration: {
            icon: 'fa-user-graduate',
            color: 'var(--primary)',
            title: 'استمارة تسجيل التلاميذ',
            description: 'استمارة التسجيل الأولي للتلاميذ الجدد',
            fields: [
                { id: 'studentName', label: 'الاسم الكامل', required: true },
                { id: 'massarCode', label: 'رمز مسار', required: true },
                { id: 'birthDate', label: 'تاريخ الازدياد', type: 'date', required: true },
                { id: 'birthPlace', label: 'مكان الازدياد' },
                { id: 'gender', label: 'الجنس', type: 'select', options: ['ذكر', 'أنثى'] },
                { id: 'nationality', label: 'الجنسية', placeholder: 'مغربية' },
                { id: 'className', label: 'القسم', required: true },
                { id: 'guardianName', label: 'اسم ولي الأمر', required: true },
                { id: 'guardianPhone', label: 'هاتف ولي الأمر' },
                { id: 'address', label: 'العنوان' }
            ]
        },
        transfer: {
            icon: 'fa-exchange-alt',
            color: 'var(--success)',
            title: 'استمارة الانتقال',
            description: 'طلب انتقال تلميذ من مؤسسة لأخرى',
            fields: [
                { id: 'studentName', label: 'الاسم الكامل', required: true },
                { id: 'massarCode', label: 'رمز مسار', required: true },
                { id: 'birthDate', label: 'تاريخ الازدياد', type: 'date' },
                { id: 'className', label: 'القسم', required: true },
                { id: 'originSchool', label: 'المؤسسة الأصلية', required: true },
                { id: 'destinationSchool', label: 'المؤسسة المستقبلة', required: true },
                { id: 'reason', label: 'سبب الانتقال' },
                { id: 'guardianName', label: 'اسم ولي الأمر', required: true }
            ]
        },
        dropout: {
            icon: 'fa-user-times',
            color: 'var(--warning)',
            title: 'استمارة الانقطاع',
            description: 'تصريح بانقطاع تلميذ عن الدراسة',
            fields: [
                { id: 'studentName', label: 'الاسم الكامل', required: true },
                { id: 'massarCode', label: 'رمز مسار', required: true },
                { id: 'className', label: 'القسم', required: true },
                { id: 'lastAttendanceDate', label: 'آخر يوم حضور', type: 'date', required: true },
                { id: 'reason', label: 'سبب الانقطاع', required: true },
                { id: 'guardianName', label: 'اسم ولي الأمر', required: true },
                { id: 'guardianPhone', label: 'هاتف ولي الأمر' }
            ]
        },
        absence: {
            icon: 'fa-clipboard-check',
            color: 'var(--info)',
            title: 'استمارة تبرير الغياب',
            description: 'نموذج تبرير غياب التلميذ',
            fields: [
                { id: 'studentName', label: 'الاسم الكامل', required: true },
                { id: 'massarCode', label: 'رمز مسار', required: true },
                { id: 'className', label: 'القسم', required: true },
                { id: 'absenceFrom', label: 'من تاريخ', type: 'date', required: true },
                { id: 'absenceTo', label: 'إلى تاريخ', type: 'date', required: true },
                { id: 'totalDays', label: 'عدد الأيام', type: 'number' },
                { id: 'reason', label: 'سبب الغياب', required: true },
                { id: 'guardianName', label: 'اسم ولي الأمر', required: true },
                { id: 'guardianPhone', label: 'هاتف ولي الأمر' }
            ]
        }
    };

    function getSchoolYear() {
        return document.getElementById('school-year')?.value || '';
    }

    function buildFieldHTML(f, formType) {
        const name = `${formType}_${f.id}`;
        const req = f.required ? 'required' : '';

        if (f.type === 'select') {
            const opts = (f.options || []).map(o => `<option value="${o}">${o}</option>`).join('');
            return `<div class="rf-field">
                <label for="${name}">${f.label}${f.required ? ' *' : ''}</label>
                <select id="${name}" class="form-control" ${req}>
                    <option value="">اختر...</option>${opts}
                </select>
            </div>`;
        }

        const type = f.type || 'text';
        const ph = f.placeholder ? `placeholder="${f.placeholder}"` : '';
        return `<div class="rf-field">
            <label for="${name}">${f.label}${f.required ? ' *' : ''}</label>
            <input type="${type}" id="${name}" class="form-control" ${ph} ${req}>
        </div>`;
    }

    function renderCards() {
        const grid = $('forms-grid');
        if (!grid) return;

        grid.innerHTML = Object.entries(FORM_CONFIGS).map(([type, cfg]) => `
            <div class="form-card" id="card-${type}">
                <div class="form-card-header" onclick="toggleForm('${type}')">
                    <i class="fas ${cfg.icon}" style="font-size: 36px; color: ${cfg.color};"></i>
                    <h4>${cfg.title}</h4>
                    <p>${cfg.description}</p>
                    <button class="btn btn-primary btn-sm rf-toggle-btn" type="button">
                        <i class="fas fa-chevron-down"></i> فتح الاستمارة
                    </button>
                </div>
                <div class="form-card-body" id="body-${type}" style="display: none;">
                    <form id="form-${type}" onsubmit="return handleSubmit(event, '${type}')">
                        <div class="rf-fields-grid">
                            ${cfg.fields.map(f => buildFieldHTML(f, type)).join('')}
                        </div>
                        <div class="rf-actions">
                            <button type="submit" class="btn btn-primary">
                                <i class="fas fa-file-pdf"></i> إنشاء PDF
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="toggleForm('${type}')">
                                <i class="fas fa-times"></i> إغلاق
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `).join('');
    }

    window.toggleForm = function (type) {
        const body = $(`body-${type}`);
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        // Close all
        document.querySelectorAll('.form-card-body').forEach(b => b.style.display = 'none');
        document.querySelectorAll('.form-card').forEach(c => c.classList.remove('active'));
        if (!isOpen) {
            body.style.display = 'block';
            $(`card-${type}`).classList.add('active');
        }
    };

    window.handleSubmit = async function (e, formType) {
        e.preventDefault();
        const cfg = FORM_CONFIGS[formType];
        if (!cfg) return false;

        const data = { schoolYear: getSchoolYear() };
        for (const f of cfg.fields) {
            const el = $(`${formType}_${f.id}`);
            const val = el ? el.value.trim() : '';
            if (f.required && !val) {
                showToast(`الرجاء ملء الحقل: ${f.label}`, 'error');
                el?.focus();
                return false;
            }
            data[f.id] = val;
        }

        showToast('جاري إنشاء الاستمارة...', 'info');

        try {
            const result = await window.api.reports.generateAdminForm({
                formType,
                data,
                mode: 'pdf'
            });

            if (result?.success) {
                showToast('تم إنشاء الاستمارة بنجاح', 'success');
            } else {
                showToast(result?.error || 'فشل إنشاء الاستمارة', 'error');
            }
        } catch (err) {
            showToast('خطأ في إنشاء الاستمارة', 'error');
        }

        return false;
    };

    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
        renderCards();
    });
})();
```

**Step 2: Rewrite `reports-forms.html`**

Replace the entire file contents. Keep the existing page structure (sidebar, header, toast container) and add the script reference plus minimal page-specific CSS:

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>الاستمارات الإدارية | برنامج التدبير المدرسي</title>
    <link rel="stylesheet" href="vendor/fonts/google-fonts.css">
    <link rel="stylesheet" href="vendor/fontawesome/css/all.min.css">
    <link rel="stylesheet" href="css/design-system.css">
    <link rel="stylesheet" href="styles.css">
    <link rel="stylesheet" href="ux-enhancements.css">
    <script src="js/utils.js"></script>
    <script src="js/notifications.js"></script>
    <script src="js/sidebar.js"></script>
    <script src="js/ux-enhancements.js"></script>
    <style>
        .rf-fields-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 12px;
            padding: 16px 0;
        }
        .rf-field label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: var(--color-text-muted);
            margin-bottom: 4px;
        }
        .rf-field input,
        .rf-field select {
            width: 100%;
            padding: 8px 10px;
            border: 1.5px solid var(--border-color, #ddd);
            border-radius: 8px;
            font-size: 13px;
            font-family: inherit;
            background: var(--card-bg, #fff);
            color: var(--color-text, #222);
        }
        .rf-field input:focus,
        .rf-field select:focus {
            border-color: var(--primary);
            outline: none;
            box-shadow: 0 0 0 2px rgba(59, 106, 197, 0.15);
        }
        .rf-actions {
            display: flex;
            gap: 10px;
            padding-top: 12px;
            border-top: 1px solid var(--border-color, #eee);
            margin-top: 8px;
        }
        .form-card {
            background: var(--card-bg, white);
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            transition: box-shadow 0.2s;
        }
        .form-card.active {
            box-shadow: 0 4px 20px rgba(59, 106, 197, 0.2);
        }
        .form-card-header {
            padding: 25px;
            text-align: center;
            cursor: pointer;
        }
        .form-card-header p {
            color: var(--color-text-muted);
            margin: 10px 0;
        }
        .form-card-body {
            padding: 0 20px 20px;
        }
        .rf-toggle-btn {
            margin-top: 8px;
        }
    </style>
</head>

<body>
    <div class="toast-container" id="toast-container"></div>

    <aside class="sidebar" id="sidebar"></aside>

    <main class="main-content">
        <header class="header">
            <div class="header-left">
                <button class="menu-toggle" id="menu-toggle"><i class="fas fa-bars"></i></button>
                <h2 class="page-title"><i class="fas fa-file-invoice"></i> الاستمارات الإدارية</h2>
            </div>
            <div class="header-right">
                <button class="theme-toggle" id="theme-toggle" title="تبديل المظهر"><i class="fas fa-moon"></i></button>
            </div>
        </header>

        <div class="grades-container">
            <div class="students-results">
                <h3><i class="fas fa-file-alt"></i> الاستمارات المتاحة</h3>
                <div id="forms-grid"
                    style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; padding: 20px;">
                </div>
            </div>
        </div>
    </main>

    <script src="js/pages/reports-forms.js"></script>
</body>

</html>
```

**Step 3: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 4: Commit**

```bash
git add reports-forms.html js/pages/reports-forms.js
git commit -m "feat: implement 4 admin forms with real PDF generation via report engine"
```

---

### Task 8: Final verification

**Step 1: Run full lint**

Run: `npm run lint`
Expected: PASS — no errors across all changed files

**Step 2: Run smoke tests**

Run: `npm run test:smoke`
Expected: PASS — IPC parity holds with new channels added and legacy removed

**Step 3: Verify file tree**

Confirm these files were touched:
- Modified: `main/reports/engine.js`, `main/ipc/reports.js`, `preload.js`, `app.js`, `js/ux-enhancements.js`, `reports-forms.html`
- Created: `main/reports/channels/adminForms.js`, `js/pages/reports-forms.js`

**Step 4: Final commit (if any remaining changes)**

```bash
git status
```

If clean, done. If any unstaged changes remain, stage and commit them.
