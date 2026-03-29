# حصص الدعم (Support Sessions) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** إنشاء صفحة `support-sessions.html` لتسجيل حصص الدعم المنجزة مع بطاقات إحصاء، نموذج إدخال، جدول مفلتر، طباعة، وتصدير/استيراد JSON.

**Architecture:** صفحة HTML واحدة + وحدة JS منفصلة (`js/pages/support-sessions.js`) تتبع نمط المشروع. جدول قاعدة بيانات `support_sessions` جديد مستقل. 6 قنوات IPC جديدة في `main/ipc/staff.js` مكشوفة عبر `preload.js`.

**Tech Stack:** Electron + better-sqlite3 + Vanilla JS + Tailwind CSS v4 + FontAwesome

---

## Task 1: Migration — إنشاء جدول `support_sessions`

**Files:**
- Modify: `main/db/migrations.js`

**Step 1: إضافة migration جديد في نهاية مصفوفة MIGRATIONS**

في `main/db/migrations.js`، أضف في نهاية مصفوفة `MIGRATIONS` (بعد آخر entry):

```js
{
    version: '2026-03-29-support-sessions',
    up: () => {
        const db = getDb();
        db.exec(`
            CREATE TABLE IF NOT EXISTS support_sessions (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                teacher_id        INTEGER,
                teacher_name      TEXT,
                subject           TEXT NOT NULL,
                section           TEXT NOT NULL,
                room              TEXT,
                session_date      TEXT NOT NULL,
                time_from         TEXT NOT NULL,
                time_to           TEXT NOT NULL,
                duration_hours    REAL,
                attendance_status TEXT NOT NULL
                    CHECK(attendance_status IN ('full','partial','absent')),
                school_year       TEXT NOT NULL,
                created_at        TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_support_sessions_year
                ON support_sessions(school_year);
            CREATE INDEX IF NOT EXISTS idx_support_sessions_teacher
                ON support_sessions(teacher_id, school_year);
        `);
    }
},
```

**ملاحظة:** `teacher_name` مخزن مباشرة (كما هو نمط المشروع في `compensation_tracking`) لضمان بقاء السجلات حتى لو حُذف الأستاذ.

**Step 2: تشغيل التطبيق للتحقق من تطبيق Migration**

```bash
npm run start
```

Expected: يعمل التطبيق بدون أخطاء. الجدول `support_sessions` موجود في DB.

**Step 3: Commit**

```bash
git add main/db/migrations.js
git commit -m "feat: add support_sessions table migration"
```

---

## Task 2: IPC Handlers — قنوات البيانات الستة

**Files:**
- Modify: `main/ipc/staff.js`

**Step 1: إضافة الـ handlers في `registerStaffIpc`**

في نهاية دالة `registerStaffIpc(ipcMain)` في `main/ipc/staff.js`، أضف:

```js
// ── Support Sessions ──

handleRead(ipcMain, 'supportSessions:list', (db, filters) => {
    const year = normalizeYear(filters && filters.school_year);
    let sql = `
        SELECT ss.*, t.full_name as teacher_full_name
        FROM support_sessions ss
        LEFT JOIN teachers t ON ss.teacher_id = t.id
        WHERE ss.school_year = ?
    `;
    const params = [year];
    if (filters && filters.teacher_id) { sql += ' AND ss.teacher_id = ?'; params.push(filters.teacher_id); }
    if (filters && filters.section)    { sql += ' AND ss.section = ?';    params.push(filters.section); }
    if (filters && filters.subject)    { sql += ' AND ss.subject = ?';    params.push(filters.subject); }
    if (filters && filters.date_from)  { sql += ' AND ss.session_date >= ?'; params.push(filters.date_from); }
    if (filters && filters.date_to)    { sql += ' AND ss.session_date <= ?'; params.push(filters.date_to); }
    sql += ' ORDER BY ss.session_date DESC, ss.time_from DESC';
    return db.prepare(sql).all(...params);
});

handleRead(ipcMain, 'supportSessions:stats', (db, schoolYear) => {
    const year = normalizeYear(schoolYear);
    const row = db.prepare(`
        SELECT
            COUNT(*)                                        AS total_sessions,
            ROUND(SUM(duration_hours), 1)                  AS total_hours,
            COUNT(DISTINCT COALESCE(teacher_id, teacher_name)) AS total_teachers,
            COUNT(DISTINCT section)                        AS total_sections
        FROM support_sessions
        WHERE school_year = ?
    `).get(year);
    return row;
});

handleWrite(ipcMain, 'supportSessions:add', ['admin', 'staff'], (db, _event, session) => {
    requireFields(session, ['subject', 'section', 'session_date', 'time_from', 'time_to', 'attendance_status', 'school_year']);
    requireSchoolYear(session.school_year);

    // حساب المدة تلقائياً
    const [fh, fm] = session.time_from.split(':').map(Number);
    const [th, tm] = session.time_to.split(':').map(Number);
    const duration = Math.round(((th * 60 + tm) - (fh * 60 + fm)) / 60 * 100) / 100;

    const result = db.prepare(`
        INSERT INTO support_sessions
            (teacher_id, teacher_name, subject, section, room, session_date, time_from, time_to, duration_hours, attendance_status, school_year)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        session.teacher_id || null,
        session.teacher_name || null,
        session.subject,
        session.section,
        session.room || null,
        session.session_date,
        session.time_from,
        session.time_to,
        duration > 0 ? duration : null,
        session.attendance_status,
        session.school_year
    );
    return { id: result.lastInsertRowid };
});

handleWrite(ipcMain, 'supportSessions:delete', ['admin', 'staff'], (db, _event, id) => {
    db.prepare('DELETE FROM support_sessions WHERE id = ?').run(id);
    return { ok: true };
});

handleRead(ipcMain, 'supportSessions:export', (db, schoolYear) => {
    const year = normalizeYear(schoolYear);
    const sessions = db.prepare(`
        SELECT teacher_id, teacher_name, subject, section, room,
               session_date, time_from, time_to, duration_hours, attendance_status
        FROM support_sessions WHERE school_year = ?
        ORDER BY session_date, time_from
    `).all(year);
    return {
        exported_at: new Date().toISOString(),
        school_year: year,
        support_sessions: sessions
    };
});

handleWrite(ipcMain, 'supportSessions:import', ['admin', 'staff'], (db, _event, payload) => {
    if (!payload || !Array.isArray(payload.support_sessions)) {
        throw new Error('ملف JSON غير صالح');
    }
    const schoolYear = normalizeYear(payload.school_year);
    requireSchoolYear(schoolYear);

    const insert = db.prepare(`
        INSERT OR IGNORE INTO support_sessions
            (teacher_id, teacher_name, subject, section, room, session_date, time_from, time_to, duration_hours, attendance_status, school_year)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // UNIQUE constraint للكشف عن المكررات — نضيف unique index مؤقتاً عبر SELECT
    let imported = 0;
    let skipped = 0;

    const txn = db.transaction(() => {
        for (const s of payload.support_sessions) {
            if (!s.subject || !s.section || !s.session_date || !s.time_from || !s.time_to || !s.attendance_status) {
                skipped++;
                continue;
            }
            // تحقق من وجود مكرر
            const exists = db.prepare(`
                SELECT 1 FROM support_sessions
                WHERE section = ? AND session_date = ? AND time_from = ? AND school_year = ?
                  AND COALESCE(teacher_id, -1) = COALESCE(?, -1)
            `).get(s.section, s.session_date, s.time_from, schoolYear, s.teacher_id || null);

            if (exists) { skipped++; continue; }

            insert.run(
                s.teacher_id || null,
                s.teacher_name || null,
                s.subject,
                s.section,
                s.room || null,
                s.session_date,
                s.time_from,
                s.time_to,
                s.duration_hours || null,
                s.attendance_status,
                schoolYear
            );
            imported++;
        }
    });
    txn();
    return { imported, skipped };
});
```

**Step 2: تشغيل smoke test**

```bash
npm run test:smoke
```

Expected: PASS — القنوات الجديدة ستُضاف لـ `preload.js` في Task 3.

**Step 3: Commit**

```bash
git add main/ipc/staff.js
git commit -m "feat: add supportSessions IPC handlers (list, stats, add, delete, export, import)"
```

---

## Task 3: Preload — تعريض القنوات

**Files:**
- Modify: `preload.js`

**Step 1: إضافة كتلة `supportSessions` بعد كتلة `compensation`**

في `preload.js`، بعد:
```js
    // Compensation tracking
    compensation: { ... },
```

أضف:
```js
    // Support sessions
    supportSessions: {
        list:   (filters)            => ipcRenderer.invoke('supportSessions:list', filters),
        stats:  (schoolYear)         => ipcRenderer.invoke('supportSessions:stats', schoolYear),
        add:    (session)            => ipcRenderer.invoke('supportSessions:add', session),
        delete: (id)                 => ipcRenderer.invoke('supportSessions:delete', id),
        export: (schoolYear)         => ipcRenderer.invoke('supportSessions:export', schoolYear),
        import: (payload)            => ipcRenderer.invoke('supportSessions:import', payload),
    },
```

**Step 2: smoke test**

```bash
npm run test:smoke
```

Expected: PASS — IPC parity مضمون.

**Step 3: Commit**

```bash
git add preload.js
git commit -m "feat: expose supportSessions API via contextBridge"
```

---

## Task 4: Sidebar — إضافة الرابط

**Files:**
- Modify: `js/sidebar.js`

**Step 1: إضافة رابط "حصص الدعم" في قسم "التقويم والنتائج"**

في `js/sidebar.js`، ابحث عن:
```html
<li><a href="student-support.html"><i class="fas fa-hands-helping"></i> الدعم التربوي</a></li>
```

أضف مباشرة بعده:
```html
<li><a href="support-sessions.html"><i class="fas fa-chalkboard"></i> حصص الدعم</a></li>
```

**Step 2: Commit**

```bash
git add js/sidebar.js
git commit -m "feat: add support-sessions link to sidebar"
```

---

## Task 5: HTML — بناء الصفحة

**Files:**
- Create: `support-sessions.html`

**Step 1: إنشاء الصفحة الكاملة**

انسخ هيكل `compensation-tracking.html` كنقطة انطلاق وعدّل المحتوى التالي:

```html
<!doctype html>
<html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>حصص الدعم | برنامج التدبير المدرسي</title>
        <link rel="stylesheet" href="vendor/fonts/google-fonts.css" />
        <link rel="stylesheet" href="vendor/fontawesome/css/all.min.css" />
        <link rel="stylesheet" href="css/tailwind-output.css" />
        <script src="js/data/ma-education-labels.js"></script>
        <script src="js/utils.js" defer></script>
        <script src="js/notifications.js" defer></script>
        <script src="js/sidebar.js" defer></script>
        <script src="js/ux-enhancements.js" defer></script>
        <script src="js/pages/support-sessions.js" defer></script>
    </head>
    <body>
        <div class="toast-container" id="toast-container"></div>
        <aside class="sidebar" id="sidebar"></aside>

        <main class="main-content">
            <header class="header">
                <div class="header-left">
                    <button class="menu-toggle" id="menu-toggle" type="button"
                        aria-controls="sidebar" aria-expanded="false" aria-label="فتح القائمة الجانبية">
                        <i class="fas fa-bars" aria-hidden="true"></i>
                    </button>
                    <h2 class="page-title"><i class="fas fa-chalkboard"></i> حصص الدعم</h2>
                </div>
                <div class="header-right">
                    <button class="theme-toggle" id="theme-toggle" title="تبديل المظهر">
                        <i class="fas fa-moon"></i>
                    </button>
                </div>
            </header>

            <!-- Print header -->
            <div class="print-header" id="print-header">
                <h1><i class="fas fa-chalkboard"></i> كشف حصص الدعم</h1>
                <p id="print-date"></p>
                <p id="print-filters"></p>
            </div>

            <div class="grades-container" style="padding-top: 18px">

                <!-- ── بطاقات الإحصاء ── -->
                <div class="support-stats" id="stats-cards" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px,1fr)); gap:12px; margin-bottom:20px;">
                    <div class="stat-card">
                        <div class="stat-icon total"><i class="fas fa-chalkboard"></i></div>
                        <div class="stat-info">
                            <h4>إجمالي الحصص</h4>
                            <div class="stat-value" id="stat-sessions">0</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon percent"><i class="fas fa-clock"></i></div>
                        <div class="stat-info">
                            <h4>إجمالي الساعات</h4>
                            <div class="stat-value" id="stat-hours">0</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon subject"><i class="fas fa-users"></i></div>
                        <div class="stat-info">
                            <h4>عدد الأساتذة</h4>
                            <div class="stat-value" id="stat-teachers">0</div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon critical"><i class="fas fa-school"></i></div>
                        <div class="stat-info">
                            <h4>الأقسام المستفيدة</h4>
                            <div class="stat-value" id="stat-sections">0</div>
                        </div>
                    </div>
                </div>

                <!-- ── نموذج تسجيل حصة جديدة ── -->
                <div class="gs-form-section no-print">
                    <div class="gs-form-header"><i class="fas fa-plus-circle"></i> تسجيل حصة دعم جديدة</div>
                    <div class="gs-form-grid">
                        <div class="gs-form-group">
                            <label for="form-teacher"><i class="fas fa-user-tie"></i> الأستاذ</label>
                            <select id="form-teacher">
                                <option value="">-- اختر الأستاذ --</option>
                            </select>
                        </div>
                        <div class="gs-form-group">
                            <label for="form-subject"><i class="fas fa-book"></i> المادة</label>
                            <select id="form-subject">
                                <option value="">-- اختر المادة --</option>
                            </select>
                        </div>
                        <div class="gs-form-group">
                            <label for="form-section"><i class="fas fa-users"></i> القسم</label>
                            <select id="form-section">
                                <option value="">-- اختر القسم --</option>
                            </select>
                        </div>
                        <div class="gs-form-group">
                            <label for="form-date"><i class="fas fa-calendar-day"></i> التاريخ</label>
                            <input type="date" id="form-date" />
                        </div>
                        <div class="gs-form-group">
                            <label for="form-time-from"><i class="fas fa-clock"></i> من</label>
                            <input type="time" id="form-time-from" />
                        </div>
                        <div class="gs-form-group">
                            <label for="form-time-to">إلى <span id="form-duration" style="font-size:12px; color:var(--color-primary)"></span></label>
                            <input type="time" id="form-time-to" />
                        </div>
                        <div class="gs-form-group">
                            <label for="form-room"><i class="fas fa-door-open"></i> القاعة</label>
                            <input type="text" id="form-room" placeholder="رقم أو اسم القاعة" />
                        </div>
                        <div class="gs-form-group">
                            <label for="form-attendance"><i class="fas fa-user-check"></i> حضور القسم</label>
                            <select id="form-attendance">
                                <option value="full">حضور كلي</option>
                                <option value="partial">حضور جزئي</option>
                                <option value="absent">غياب كلي</option>
                            </select>
                        </div>
                    </div>
                    <div style="display:flex; justify-content:flex-end; margin-top:12px;">
                        <button class="btn btn-primary" id="btn-add-session" type="button">
                            <i class="fas fa-save"></i> تسجيل الحصة
                        </button>
                    </div>
                </div>

                <!-- ── فلترة وبحث ── -->
                <div class="gs-form-section no-print" style="margin-top:16px;">
                    <div class="gs-form-header"><i class="fas fa-filter"></i> فلترة وبحث</div>
                    <div class="gs-form-grid">
                        <div class="gs-form-group">
                            <label for="filter-teacher">الأستاذ</label>
                            <select id="filter-teacher">
                                <option value="">الكل</option>
                            </select>
                        </div>
                        <div class="gs-form-group">
                            <label for="filter-section">القسم</label>
                            <select id="filter-section">
                                <option value="">الكل</option>
                            </select>
                        </div>
                        <div class="gs-form-group">
                            <label for="filter-subject">المادة</label>
                            <select id="filter-subject">
                                <option value="">الكل</option>
                            </select>
                        </div>
                        <div class="gs-form-group">
                            <label for="filter-date-from">من تاريخ</label>
                            <input type="date" id="filter-date-from" />
                        </div>
                        <div class="gs-form-group">
                            <label for="filter-date-to">إلى تاريخ</label>
                            <input type="date" id="filter-date-to" />
                        </div>
                        <div class="gs-form-group" style="display:flex; align-items:flex-end; gap:8px;">
                            <button class="btn btn-primary" id="btn-filter" type="button" style="flex:1">
                                <i class="fas fa-search"></i> بحث
                            </button>
                        </div>
                    </div>
                </div>

                <!-- ── شريط الإجراءات ── -->
                <div class="results-action-bar no-print" style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                    <h3 style="margin:0; flex:1">الحصص المسجلة <span id="sessions-count" style="font-size:14px; color:var(--color-text-muted)"></span></h3>
                    <button class="btn btn-success ux-print-preview-btn" id="btn-print" type="button">
                        <i class="fas fa-eye"></i> معاينة الطباعة
                    </button>
                    <button class="btn btn-secondary" id="btn-export" type="button">
                        <i class="fas fa-file-export"></i> تصدير JSON
                    </button>
                    <label class="btn btn-secondary" style="cursor:pointer; margin:0;">
                        <i class="fas fa-file-import"></i> استيراد JSON
                        <input type="file" id="input-import" accept=".json" style="display:none;" />
                    </label>
                </div>

                <!-- ── جدول الحصص ── -->
                <div class="table-responsive" style="margin-top:12px;">
                    <table class="students-table students-table-card" id="sessions-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>التاريخ</th>
                                <th>الأستاذ</th>
                                <th>المادة</th>
                                <th>القسم</th>
                                <th>القاعة</th>
                                <th>التوقيت</th>
                                <th>المدة (س)</th>
                                <th>حضور القسم</th>
                                <th class="no-print">حذف</th>
                            </tr>
                        </thead>
                        <tbody id="sessions-tbody">
                            <tr id="empty-row">
                                <td colspan="10" style="text-align:center; color:var(--color-text-muted); padding:32px;">
                                    <i class="fas fa-inbox" style="font-size:32px; display:block; margin-bottom:8px;"></i>
                                    لا توجد حصص مسجلة
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

            </div><!-- /grades-container -->
        </main>
    </body>
</html>
```

**Step 2: Commit**

```bash
git add support-sessions.html
git commit -m "feat: add support-sessions.html page structure"
```

---

## Task 6: JS — منطق الصفحة

**Files:**
- Create: `js/pages/support-sessions.js`

**Step 1: إنشاء الوحدة الكاملة**

```js
/* global showToast */
(async function () {
    'use strict';

    const ATTENDANCE_LABELS = {
        full: 'حضور كلي',
        partial: 'حضور جزئي',
        absent: 'غياب كلي',
    };
    const ATTENDANCE_COLORS = {
        full: 'color:var(--color-success, #22c55e)',
        partial: 'color:var(--color-warning, #f59e0b)',
        absent: 'color:var(--color-danger, #ef4444)',
    };

    // ── school year ──
    const schoolYear = (await window.api.settings.get('school_year')) || '';

    // ── state ──
    let teachers = [];
    let sessions = [];

    // ── refs ──
    const formTeacher   = document.getElementById('form-teacher');
    const formSubject   = document.getElementById('form-subject');
    const formSection   = document.getElementById('form-section');
    const formDate      = document.getElementById('form-date');
    const formTimeFrom  = document.getElementById('form-time-from');
    const formTimeTo    = document.getElementById('form-time-to');
    const formRoom      = document.getElementById('form-room');
    const formAttendance= document.getElementById('form-attendance');
    const formDuration  = document.getElementById('form-duration');

    const filterTeacher = document.getElementById('filter-teacher');
    const filterSection = document.getElementById('filter-section');
    const filterSubject = document.getElementById('filter-subject');
    const filterFrom    = document.getElementById('filter-date-from');
    const filterTo      = document.getElementById('filter-date-to');

    const tbody         = document.getElementById('sessions-tbody');
    const sessionsCount = document.getElementById('sessions-count');

    // ── helpers ──
    function calcDuration(from, to) {
        if (!from || !to) return null;
        const [fh, fm] = from.split(':').map(Number);
        const [th, tm] = to.split(':').map(Number);
        const mins = (th * 60 + tm) - (fh * 60 + fm);
        return mins > 0 ? Math.round(mins / 60 * 100) / 100 : null;
    }

    function formatTime(t) {
        return t ? t.substring(0, 5) : '';
    }

    // ── load teachers ──
    async function loadTeachers() {
        teachers = await window.api.teachers.getAll(schoolYear);
        [formTeacher, filterTeacher].forEach(sel => {
            const placeholder = sel === formTeacher ? '-- اختر الأستاذ --' : 'الكل';
            sel.innerHTML = `<option value="">${placeholder}</option>`;
            teachers.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.dataset.subject = t.subject || '';
                opt.textContent = t.full_name;
                sel.appendChild(opt);
            });
        });
    }

    // ── load sections ──
    async function loadSections() {
        const classes = await window.api.classes.getAll(schoolYear);
        const sections = classes.map(c => c.name || c.class_name || c).filter(Boolean);
        [formSection, filterSection].forEach(sel => {
            const placeholder = sel === formSection ? '-- اختر القسم --' : 'الكل';
            sel.innerHTML = `<option value="">${placeholder}</option>`;
            sections.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                sel.appendChild(opt);
            });
        });
    }

    // ── load subjects (from ma-education-labels or teachers) ──
    function loadSubjects() {
        const subjectSet = new Set(teachers.map(t => t.subject).filter(Boolean));
        filterSubject.innerHTML = '<option value="">الكل</option>';
        formSubject.innerHTML = '<option value="">-- اختر المادة --</option>';
        subjectSet.forEach(s => {
            [formSubject, filterSubject].forEach(sel => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                sel.appendChild(opt);
            });
        });
    }

    // ── auto-fill subject when teacher changes ──
    formTeacher.addEventListener('change', () => {
        const selected = formTeacher.options[formTeacher.selectedIndex];
        const subject = selected ? selected.dataset.subject : '';
        if (subject) formSubject.value = subject;
    });

    // ── auto-calculate duration ──
    [formTimeFrom, formTimeTo].forEach(el => {
        el.addEventListener('change', () => {
            const d = calcDuration(formTimeFrom.value, formTimeTo.value);
            formDuration.textContent = d ? `(${d} ساعة)` : '';
        });
    });

    // ── render stats ──
    async function loadStats() {
        const s = await window.api.supportSessions.stats(schoolYear);
        document.getElementById('stat-sessions').textContent  = s.total_sessions || 0;
        document.getElementById('stat-hours').textContent     = s.total_hours || 0;
        document.getElementById('stat-teachers').textContent  = s.total_teachers || 0;
        document.getElementById('stat-sections').textContent  = s.total_sections || 0;
    }

    // ── render table ──
    function renderTable(rows) {
        if (!rows.length) {
            tbody.innerHTML = `
                <tr id="empty-row">
                    <td colspan="10" style="text-align:center; color:var(--color-text-muted); padding:32px;">
                        <i class="fas fa-inbox" style="font-size:32px; display:block; margin-bottom:8px;"></i>
                        لا توجد حصص مسجلة
                    </td>
                </tr>`;
            sessionsCount.textContent = '';
            return;
        }
        sessionsCount.textContent = `(${rows.length})`;
        tbody.innerHTML = rows.map((s, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${s.session_date}</td>
                <td>${s.teacher_name || s.teacher_full_name || '-'}</td>
                <td>${s.subject}</td>
                <td>${s.section}</td>
                <td>${s.room || '-'}</td>
                <td>${formatTime(s.time_from)} – ${formatTime(s.time_to)}</td>
                <td>${s.duration_hours || '-'}</td>
                <td style="${ATTENDANCE_COLORS[s.attendance_status] || ''}">
                    ${ATTENDANCE_LABELS[s.attendance_status] || s.attendance_status}
                </td>
                <td class="no-print">
                    <button class="btn btn-danger btn-sm" data-delete="${s.id}" title="حذف">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // ── load & filter sessions ──
    async function loadSessions() {
        const filters = {
            school_year: schoolYear,
            teacher_id:  filterTeacher.value || undefined,
            section:     filterSection.value || undefined,
            subject:     filterSubject.value || undefined,
            date_from:   filterFrom.value || undefined,
            date_to:     filterTo.value || undefined,
        };
        sessions = await window.api.supportSessions.list(filters);
        renderTable(sessions);
    }

    // ── add session ──
    document.getElementById('btn-add-session').addEventListener('click', async () => {
        const teacherOpt = formTeacher.options[formTeacher.selectedIndex];
        const payload = {
            teacher_id:        formTeacher.value ? Number(formTeacher.value) : null,
            teacher_name:      teacherOpt && formTeacher.value ? teacherOpt.textContent.trim() : null,
            subject:           formSubject.value,
            section:           formSection.value,
            room:              formRoom.value.trim(),
            session_date:      formDate.value,
            time_from:         formTimeFrom.value,
            time_to:           formTimeTo.value,
            attendance_status: formAttendance.value,
            school_year:       schoolYear,
        };
        if (!payload.subject || !payload.section || !payload.session_date || !payload.time_from || !payload.time_to) {
            showToast('الرجاء ملء جميع الحقول الإلزامية', 'error');
            return;
        }
        try {
            await window.api.supportSessions.add(payload);
            showToast('تم تسجيل الحصة بنجاح', 'success');
            // reset form
            formTeacher.value = ''; formSubject.value = ''; formSection.value = '';
            formDate.value = ''; formTimeFrom.value = ''; formTimeTo.value = '';
            formRoom.value = ''; formAttendance.value = 'full'; formDuration.textContent = '';
            await Promise.all([loadStats(), loadSessions()]);
        } catch (e) {
            showToast(`خطأ: ${e.message}`, 'error');
        }
    });

    // ── filter ──
    document.getElementById('btn-filter').addEventListener('click', loadSessions);

    // ── delete ──
    tbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-delete]');
        if (!btn) return;
        if (!confirm('هل تريد حذف هذه الحصة؟')) return;
        try {
            await window.api.supportSessions.delete(Number(btn.dataset.delete));
            showToast('تم حذف الحصة', 'success');
            await Promise.all([loadStats(), loadSessions()]);
        } catch (e) {
            showToast(`خطأ: ${e.message}`, 'error');
        }
    });

    // ── export JSON ──
    document.getElementById('btn-export').addEventListener('click', async () => {
        try {
            const data = await window.api.supportSessions.export(schoolYear);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `حصص-الدعم-${schoolYear}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            showToast(`خطأ في التصدير: ${e.message}`, 'error');
        }
    });

    // ── import JSON ──
    document.getElementById('input-import').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const payload = JSON.parse(text);
            const result = await window.api.supportSessions.import(payload);
            showToast(`تم الاستيراد: ${result.imported} حصة جديدة، ${result.skipped} مكرر`, 'success');
            await Promise.all([loadStats(), loadSessions()]);
        } catch (e) {
            showToast(`خطأ في الاستيراد: ${e.message}`, 'error');
        }
        e.target.value = '';
    });

    // ── print ──
    document.getElementById('btn-print').addEventListener('click', () => {
        document.getElementById('print-date').textContent = `تاريخ الطباعة: ${new Date().toLocaleDateString('ar-MA')}`;
        const filterParts = [];
        if (filterTeacher.value) filterParts.push(`الأستاذ: ${filterTeacher.options[filterTeacher.selectedIndex].textContent}`);
        if (filterSection.value) filterParts.push(`القسم: ${filterSection.value}`);
        if (filterSubject.value) filterParts.push(`المادة: ${filterSubject.value}`);
        document.getElementById('print-filters').textContent = filterParts.join(' | ');
        window.print();
    });

    // ── init ──
    await loadTeachers();
    loadSubjects();
    await loadSections();
    await Promise.all([loadStats(), loadSessions()]);

    // set default date to today
    formDate.value = new Date().toISOString().substring(0, 10);
})();
```

**Step 2: تشغيل التطبيق والتحقق اليدوي**

```bash
npm run start
```

افتح صفحة "حصص الدعم" وتحقق من:
- [ ] بطاقات الإحصاء تظهر بالقيم الصحيحة
- [ ] قوائم الأستاذ والقسم والمادة تُحمَّل
- [ ] اختيار الأستاذ يملأ المادة تلقائياً
- [ ] حساب المدة يظهر تلقائياً عند اختيار التوقيت
- [ ] تسجيل حصة جديدة يعمل ويظهر في الجدول
- [ ] الفلترة تعمل
- [ ] الحذف يعمل
- [ ] التصدير ينتج ملف JSON صحيح
- [ ] الاستيراد يعمل ويتجاهل المكررات
- [ ] الطباعة تظهر فقط الجدول بدون أزرار

**Step 3: Smoke test**

```bash
npm run test:smoke
```

Expected: PASS

**Step 4: Commit**

```bash
git add js/pages/support-sessions.js
git commit -m "feat: implement support-sessions page logic (CRUD, stats, export/import JSON)"
```

---

## Task 7: CSS Build — التحقق من Tailwind

**Step 1: بناء CSS**

```bash
npm run css:build
```

Expected: بدون أخطاء، `css/tailwind-output.css` يُحدَّث.

**Step 2: Lint**

```bash
npm run lint
```

Expected: PASS بدون أخطاء في `js/pages/support-sessions.js`.

**Step 3: Commit النهائي**

```bash
git add css/tailwind-output.css
git commit -m "chore: rebuild Tailwind CSS to include support-sessions styles"
```

---

## ملخص الملفات المعدلة

| الملف | التغيير |
|-------|---------|
| `main/db/migrations.js` | migration `2026-03-29-support-sessions` |
| `main/ipc/staff.js` | 6 handlers: list, stats, add, delete, export, import |
| `preload.js` | كتلة `supportSessions` (6 قنوات) |
| `js/sidebar.js` | رابط "حصص الدعم" في "التقويم والنتائج" |
| `support-sessions.html` | الصفحة الجديدة |
| `js/pages/support-sessions.js` | منطق الصفحة الكامل |
| `css/tailwind-output.css` | إعادة بناء |

## ترتيب التنفيذ الإلزامي

```
Task 1 (migration) → Task 2 (IPC) → Task 3 (preload) → Task 4 (sidebar) → Task 5 (HTML) → Task 6 (JS) → Task 7 (build)
```
