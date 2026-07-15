/**
 * exam-papers.js — تتبع أوراق التحرير
 * Records handover of teachers' answer sheets (أوراق التحرير) as a section × exam matrix.
 * Reference data (subjects, teachers, assigned sections) is fetched from the app DB via IPC
 * (same approach as grades-sheets / support-sessions). Handover records are stored locally
 * (localStorage) per school year — a SQLite backend is a planned follow-up.
 *
 * Matrix layout: rows = assigned sections, columns = [التقويم التشخيصي (الدورة 1 فقط)] then
 * الفرض الكتابي 1..N where N depends on the subject.
 */
(function () {
    'use strict';

    const STORE_KEY = 'examPapers_handovers_v2';

    function getYear() {
        return typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026';
    }
    const schoolYear = getYear();

    // ─── DOM refs ───
    const $ = (id) => document.getElementById(id);
    const sessionSel = $('ep-session');
    const subjectSel = $('ep-subject');
    const teacherSel = $('ep-teacher');
    const dateInp = $('ep-date');
    const notesInp = $('ep-notes');
    const matrixBox = $('ep-matrix');
    const saveBtn = $('ep-save');
    const resetBtn = $('ep-reset');

    const fSubject = $('ep-f-subject');
    const fTeacher = $('ep-f-teacher');
    const fKind = $('ep-f-kind');
    const fFrom = $('ep-f-from');
    const fTo = $('ep-f-to');
    const tbody = $('ep-tbody');
    const countBadge = $('ep-count');
    const exportBtn = $('ep-export');
    const importInput = $('ep-import');
    const statTotal = $('ep-stat-total');
    const statComplete = $('ep-stat-complete');
    const statPartial = $('ep-stat-partial');
    const statTeachers = $('ep-stat-teachers');

    // ─── State ───
    let teachers = [];
    let _timetable = undefined; // undefined = not loaded, null = unavailable
    let _currentSections = []; // assigned sections currently shown in the matrix

    // ─── Number of written exams (فروض) per subject — SSOT is main/db/exam-count-defaults.js ───
    // via window.api.appDefaults (CH7). Renderer never re-declares the subject→count table.
    // Sync paths (getExamColumns / saveHandover) read a cache pre-warmed from getExamCounts.
    const DEFAULT_FROUD_COUNT = 3;
    /** Cache: `${levelCode}::${normalizedSubject}` → count */
    const _froudCache = new Map();
    const _froudWarmedLevels = new Set();

    // ─── Helpers ───
    const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s));
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const todayISO = () => new Date().toISOString().slice(0, 10);

    function normSubj(s) {
        return typeof normalizeSubjectName === 'function' ? normalizeSubjectName(s || '') : String(s || '').trim();
    }
    // CH2: name normalize / teacher key resolve via js/shared/timetable-utils.js

    /**
     * Bulk-load exam counts for a level into _froudCache (getExamCounts already merges seed + DB).
     * Safe to call repeatedly; each level is warmed once per page load.
     */
    async function warmFroudCache(levelCode) {
        const level = levelCode || '*';
        if (_froudWarmedLevels.has(level)) return;
        if (!window.api?.appDefaults?.getExamCounts) return;
        try {
            const res = await window.api.appDefaults.getExamCounts(level);
            const subjects = Array.isArray(res?.subjects) ? res.subjects : [];
            for (const row of subjects) {
                const subj = normSubj(row.subject);
                const n = Number(row.examCount);
                if (subj && Number.isFinite(n) && n > 0) {
                    _froudCache.set(`${level}::${subj}`, n);
                }
            }
            _froudWarmedLevels.add(level);
        } catch {
            /* leave cache empty; sync path falls back to DEFAULT_FROUD_COUNT */
        }
    }

    function lookupFroudInCache(subject, levelCode) {
        if (!subject) return null;
        const level = levelCode || '*';
        const t = normSubj(subject);
        const exact = `${level}::${t}`;
        if (_froudCache.has(exact)) return _froudCache.get(exact);
        if (level !== '*') {
            const globalExact = `*::${t}`;
            if (_froudCache.has(globalExact)) return _froudCache.get(globalExact);
        }
        // Fuzzy: same partial-match idea as main lookupExamCount, but only over cached keys.
        const prefixes = level === '*' ? ['*::'] : [`${level}::`, '*::'];
        for (const prefix of prefixes) {
            for (const [key, n] of _froudCache) {
                if (!key.startsWith(prefix)) continue;
                const k = key.slice(prefix.length);
                if (k && (t === k || t.includes(k) || k.includes(t))) return n;
            }
        }
        return null;
    }

    function froudCountSync(subject, levelCode) {
        const hit = lookupFroudInCache(subject, levelCode);
        return hit != null ? hit : DEFAULT_FROUD_COUNT;
    }

    async function froudCount(subject, levelCode) {
        if (!subject) return DEFAULT_FROUD_COUNT;
        const level = levelCode || '*';
        await warmFroudCache('*');
        if (level !== '*') await warmFroudCache(level);
        const cached = lookupFroudInCache(subject, level);
        if (cached != null) return cached;
        try {
            if (window.api?.appDefaults?.getExamCount) {
                const res = await window.api.appDefaults.getExamCount(level, subject);
                const n = Number(res?.count);
                if (Number.isFinite(n) && n > 0) {
                    _froudCache.set(`${level}::${normSubj(subject)}`, n);
                    return n;
                }
            }
        } catch {
            /* fall through */
        }
        _froudCache.set(`${level}::${normSubj(subject)}`, DEFAULT_FROUD_COUNT);
        return DEFAULT_FROUD_COUNT;
    }

    // Intentional: this returns a level CODE (e.g. "1BACSE") for the exam-count SSOT
    // (main/db/exam-count-defaults.js keys by code), NOT a level name. The user
    // levelsMapping is section→Arabic-name, so it is not consulted here — the shared
    // getLevelFromSection() code parser is the correct source for this code lookup.
    function inferLevelCodeFromSections(sections) {
        if (!Array.isArray(sections) || !sections.length) return '*';
        if (typeof getLevelFromSection !== 'function') return '*';
        const codes = sections
            .map((s) => {
                const info = getLevelFromSection(s);
                return info?.code ? String(info.code).toUpperCase() : '';
            })
            .filter(Boolean);
        if (!codes.length) return '*';
        const first = codes[0];
        return codes.every((c) => c === first) ? first : '*';
    }

    function loadRecords() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }
    function saveRecords(list) {
        localStorage.setItem(STORE_KEY, JSON.stringify(list));
    }

    // ─── Load subjects + teachers (same DB source as support-sessions) ───
    async function loadReferenceData() {
        const result = await window.api.teachers.getAll(schoolYear).catch(() => []);
        teachers = Array.isArray(result) ? result : [];

        let subjects = [];
        try {
            const raw = (await window.api.subjects.getAll()) || [];
            const invalid = new Set(['sheet', 'sheet1', 'feuil1', 'notes', 'notescc', 'note', 'ورقة1', 'ورقة']);
            const set = new Set();
            raw.forEach((s) => {
                const n = normSubj(s.name || s);
                if (n && !invalid.has(n.toLowerCase())) set.add(n);
            });
            subjects = Array.from(set).sort(
                typeof compareSubjects === 'function' ? compareSubjects : (a, b) => a.localeCompare(b, 'ar')
            );
        } catch (_) {
            subjects = [...new Set(teachers.map((t) => t.subject).filter(Boolean))].sort();
        }

        subjectSel.innerHTML = '<option value="">اختر المادة</option>';
        fSubject.innerHTML = '<option value="">الكل</option>';
        subjects.forEach((s) => {
            subjectSel.appendChild(new Option(s, s));
            fSubject.appendChild(new Option(s, s));
        });

        fTeacher.innerHTML = '<option value="">الكل</option>';
        teachers
            .slice()
            .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ar'))
            .forEach((t) => fTeacher.appendChild(new Option(t.full_name, t.full_name)));
    }

    function filterTeachersBySubject(subject) {
        const current = teacherSel.value;
        teacherSel.innerHTML = '<option value="">اختر الأستاذ</option>';
        const list = subject ? teachers.filter((t) => (t.subject || '') === subject) : teachers;
        list.slice()
            .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'ar'))
            .forEach((t) => {
                const o = new Option(t.full_name, t.id);
                o.dataset.name = t.full_name;
                teacherSel.appendChild(o);
            });
        if (list.some((t) => String(t.id) === current)) teacherSel.value = current;
    }

    // ─── Exam columns (diagnostic first, session 1 only; then فروض حسب المادة) ───
    function getExamColumns(examCountOverride) {
        const session = sessionSel.value;
        const cols = [];
        if (session === '1') {
            cols.push({ id: 'diag', kind: 'diagnostic', label: 'تشخيصي', title: 'التقويم التشخيصي' });
        }
        const n =
            Number.isFinite(examCountOverride) && examCountOverride > 0
                ? examCountOverride
                : froudCountSync(subjectSel.value, '*');
        for (let i = 1; i <= n; i++) {
            cols.push({ id: 's' + session + '_fk' + i, kind: 'fk', label: 'فرض ' + i, title: 'الفرض الكتابي ' + i });
        }
        return cols;
    }

    // ─── Assigned sections from the timetable (per teacher + subject) ───
    async function getTimetable() {
        if (_timetable !== undefined) return _timetable;
        try {
            _timetable = (await window.api.timetable.get(schoolYear)) || null;
        } catch (_) {
            _timetable = null;
        }
        return _timetable;
    }

    async function getAssignedSections(teacherName, subject, teacherId) {
        const tt = await getTimetable();
        const withSubj = new Set();
        const anySubj = new Set();
        if (tt && tt.timetables && typeof ttResolveTeacherKeys === 'function') {
            const wantSubj = normSubj(subject);
            // CH2: 4-phase resolver (ID → exact → normalized → partial/meta) — stronger than name-only loop
            const keys = ttResolveTeacherKeys(tt, teacherId, teacherName);
            for (const key of keys) {
                const days = tt.timetables[key];
                if (!days || typeof days !== 'object') continue;
                for (const day of Object.values(days)) {
                    if (!day || typeof day !== 'object') continue;
                    for (const period of Object.values(day)) {
                        if (!period || typeof period !== 'object') continue;
                        for (const lesson of Object.values(period)) {
                            if (!lesson) continue;
                            const sec = (lesson.students || '').trim();
                            if (!sec) continue;
                            anySubj.add(sec);
                            if (wantSubj && normSubj(lesson.subject) === wantSubj) withSubj.add(sec);
                        }
                    }
                }
            }
        }
        if (withSubj.size) return [...withSubj];
        if (anySubj.size) return [...anySubj];
        try {
            const classes = await window.api.classes.getAll(schoolYear);
            return (Array.isArray(classes) ? classes : []).map((c) => c.name || c.class_name).filter(Boolean);
        } catch (_) {
            return [];
        }
    }

    // ─── Matrix rendering ───
    function getPrechecks(session, subject, teacherId) {
        const map = new Map();
        loadRecords().forEach((h) => {
            if (
                h.schoolYear === schoolYear &&
                h.session === session &&
                h.subject === subject &&
                h.teacherId === teacherId
            ) {
                map.set(h.examId, new Set(h.receivedSections || []));
            }
        });
        return map;
    }

    function renderMatrix(sections, cols, prechecks) {
        const head = cols
            .map(
                (c) =>
                    `<th class="${c.kind === 'diagnostic' ? 'ep-col-diagnostic' : ''}">${c.kind === 'diagnostic' ? '★ ' : ''}${esc(c.label)}</th>`
            )
            .join('');
        const body = sections
            .map((sec) => {
                const cells = cols
                    .map((c) => {
                        const on = prechecks.get(c.id)?.has(sec) ? 'checked' : '';
                        return `<td><input type="checkbox" class="ep-matrix-checkbox" data-exam="${c.id}" data-section="${esc(sec)}" ${on} aria-label="${esc(sec)} — ${esc(c.title)}"></td>`;
                    })
                    .join('');
                return `<tr><th>${esc(sec)}</th>${cells}</tr>`;
            })
            .join('');
        return `<div class="ep-matrix-scroll"><table class="ep-matrix-table"><thead><tr><th>القسم \\ الفرض</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }

    async function buildMatrix() {
        const teacherOpt = teacherSel.options[teacherSel.selectedIndex];
        const teacherName = teacherSel.value ? (teacherOpt.dataset.name || teacherOpt.textContent).trim() : '';
        const subject = subjectSel.value;
        const session = Number(sessionSel.value);
        const teacherId = teacherSel.value ? Number(teacherSel.value) : null;

        if (!subject || !teacherId) {
            _currentSections = [];
            matrixBox.innerHTML =
                '<div class="ep-matrix-empty"><i class="fas fa-arrow-up" aria-hidden="true"></i>اختر المادة والأستاذ لعرض جدول الأقسام والفروض</div>';
            return;
        }
        matrixBox.innerHTML =
            '<div class="ep-matrix-loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i>جارٍ جلب الأقسام المسندة…</div>';

        const sections = await getAssignedSections(teacherName, subject, teacherId);
        // Guard against stale async (selection changed while awaiting)
        if (teacherSel.value !== String(teacherId) || subjectSel.value !== subject) return;

        _currentSections = sections.slice().sort((a, b) => a.localeCompare(b, 'ar'));
        if (!_currentSections.length) {
            matrixBox.innerHTML =
                '<div class="ep-matrix-empty"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>لا أقسام مسندة لهذا الأستاذ (تحقّق من الجدول الزمني)</div>';
            return;
        }
        const levelCode = inferLevelCodeFromSections(_currentSections);
        const examN = await froudCount(subject, levelCode);
        if (teacherSel.value !== String(teacherId) || subjectSel.value !== subject) return;
        const cols = getExamColumns(examN);
        const pre = getPrechecks(session, subject, teacherId);
        matrixBox.innerHTML = renderMatrix(_currentSections, cols, pre);
    }

    // ─── Save (one record per exam column that has checked sections) ───
    function saveHandover() {
        const session = Number(sessionSel.value);
        const subject = subjectSel.value;
        const teacherId = teacherSel.value ? Number(teacherSel.value) : null;
        const teacherOpt = teacherSel.options[teacherSel.selectedIndex];
        const teacherName = teacherId ? (teacherOpt.dataset.name || teacherOpt.textContent).trim() : '';
        const date = dateInp.value;

        if (!subject || !teacherId) {
            showToast('اختر المادة والأستاذ', 'error');
            return;
        }
        if (!_currentSections.length) {
            showToast('لا أقسام مسندة لعرضها', 'error');
            return;
        }
        if (!date) {
            showToast('حدّد تاريخ التسليم', 'error');
            return;
        }

        const levelCode = inferLevelCodeFromSections(_currentSections);
        const examN = froudCountSync(subject, levelCode);
        const cols = getExamColumns(examN);
        const list = loadRecords();
        let changed = 0;

        cols.forEach((col) => {
            const checked = [...matrixBox.querySelectorAll(`input[data-exam="${col.id}"]:checked`)].map(
                (i) => i.dataset.section
            );
            const idx = list.findIndex(
                (h) =>
                    h.schoolYear === schoolYear &&
                    h.session === session &&
                    h.subject === subject &&
                    h.teacherId === teacherId &&
                    h.examId === col.id
            );
            if (checked.length) {
                const rec = {
                    id: idx >= 0 ? list[idx].id : uid(),
                    schoolYear,
                    session,
                    subject,
                    teacherId,
                    teacherName,
                    examId: col.id,
                    examKind: col.kind,
                    examLabel: col.title,
                    assignedSections: _currentSections.slice(),
                    receivedSections: checked,
                    status: checked.length >= _currentSections.length ? 'received' : 'partial',
                    handoverDate: date,
                    notes: notesInp.value.trim(),
                    recordedAt: new Date().toISOString()
                };
                if (idx >= 0) list[idx] = rec;
                else list.unshift(rec);
                changed++;
            } else if (idx >= 0) {
                // Column cleared → remove the previously saved record
                list.splice(idx, 1);
                changed++;
            }
        });

        if (!changed) {
            showToast('علّم خانة واحدة على الأقل قبل الحفظ', 'warning');
            return;
        }
        saveRecords(list);
        showToast('تم حفظ استلام أوراق التحرير', 'success');
        populateFilters();
        renderLog();
    }

    function resetForm() {
        subjectSel.value = '';
        filterTeachersBySubject('');
        teacherSel.value = '';
        sessionSel.value = '1';
        dateInp.value = todayISO();
        notesInp.value = '';
        _currentSections = [];
        matrixBox.innerHTML =
            '<div class="ep-matrix-empty"><i class="fas fa-arrow-up" aria-hidden="true"></i>اختر المادة والأستاذ لعرض جدول الأقسام والفروض</div>';
    }

    // ─── Log rendering ───
    function examBadge(kind, label) {
        const cls = kind === 'diagnostic' ? 'ep-badge-diagnostic' : 'ep-badge-fk';
        return `<span class="ep-badge ${cls}">${esc(label || (kind === 'diagnostic' ? 'تشخيصي' : 'فرض'))}</span>`;
    }
    function statusBadge(st) {
        return st === 'received'
            ? '<span class="ep-badge ep-status-received"><i class="fas fa-check-double"></i> مستلم كاملاً</span>'
            : '<span class="ep-badge ep-status-partial"><i class="fas fa-hourglass-half"></i> جزئي</span>';
    }
    function sectionChips(h) {
        const assigned = h.assignedSections || [];
        const received = h.receivedSections || [];
        const list = assigned.length ? assigned : received;
        const chips = list
            .map((s) => {
                const got = received.includes(s);
                return `<span class="ep-chip ${got ? 'ep-chip-received' : ''}">${esc(s)}</span>`;
            })
            .join('');
        return `<div class="ep-chips">${chips}</div><div class="ep-chip-ratio">${received.length}/${assigned.length || received.length}</div>`;
    }

    function filteredRecords() {
        const subj = fSubject.value;
        const teach = fTeacher.value;
        const kind = fKind.value;
        const from = fFrom.value;
        const to = fTo.value;
        return loadRecords()
            .filter((h) => h.schoolYear === schoolYear)
            .filter((h) => !subj || h.subject === subj)
            .filter((h) => !teach || h.teacherName === teach)
            .filter((h) => !kind || h.examKind === kind)
            .filter((h) => !from || (h.handoverDate || '') >= from)
            .filter((h) => !to || (h.handoverDate || '') <= to)
            .sort((a, b) => (b.handoverDate || '').localeCompare(a.handoverDate || ''));
    }

    function updateStats() {
        const recs = loadRecords().filter((h) => h.schoolYear === schoolYear);
        statTotal.textContent = recs.length;
        statComplete.textContent = recs.filter((h) => h.status === 'received').length;
        statPartial.textContent = recs.filter((h) => h.status === 'partial').length;
        statTeachers.textContent = new Set(recs.map((h) => h.teacherId).filter((id) => id != null)).size;
    }

    function renderLog() {
        const rows = filteredRecords();
        countBadge.textContent = rows.length;
        updateStats();
        if (!rows.length) {
            tbody.innerHTML =
                '<tr class="empty-row"><td colspan="10">لا تسليمات مطابقة</td></tr>';
            return;
        }
        tbody.innerHTML = rows
            .map(
                (h, i) => `<tr>
                <td data-label="#">${i + 1}</td>
                <td data-label="التاريخ">${esc(h.handoverDate || '')}</td>
                <td data-label="الدورة">${h.session || ''}</td>
                <td data-label="المادة">${esc(h.subject || '')}</td>
                <td data-label="الأستاذ(ة)">${esc(h.teacherName || '')}</td>
                <td data-label="التقويم / الفرض">${examBadge(h.examKind, h.examLabel)}</td>
                <td data-label="الأقسام">${sectionChips(h)}</td>
                <td data-label="الحالة">${statusBadge(h.status)}</td>
                <td data-label="ملاحظات" style="color:var(--color-text-muted);font-size:12px">${esc(h.notes || '')}</td>
                <td data-label="حذف" class="no-print"><button class="btn btn-danger btn-sm" data-delete="${h.id}" title="حذف"><i class="fas fa-trash"></i></button></td>
            </tr>`
            )
            .join('');
    }

    function populateFilters() {
        const curS = fSubject.value;
        const curT = fTeacher.value;
        const recs = loadRecords().filter((h) => h.schoolYear === schoolYear);
        const subjects = [...new Set(recs.map((h) => h.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
        const teacherNames = [...new Set(recs.map((h) => h.teacherName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
        if (subjects.length) {
            fSubject.innerHTML = '<option value="">الكل</option>';
            subjects.forEach((s) => fSubject.appendChild(new Option(s, s)));
            fSubject.value = curS;
        }
        if (teacherNames.length) {
            fTeacher.innerHTML = '<option value="">الكل</option>';
            teacherNames.forEach((t) => fTeacher.appendChild(new Option(t, t)));
            fTeacher.value = curT;
        }
    }

    async function deleteRecord(id) {
        const { confirmed } = await showConfirm({
            title: 'حذف التسجيل',
            message: 'سيتم حذف هذا التسجيل نهائياً.',
            type: 'danger',
            confirmText: 'حذف'
        });
        if (!confirmed) return;
        saveRecords(loadRecords().filter((h) => h.id !== id));
        showToast('تم الحذف', 'success');
        renderLog();
    }

    // ─── Export / import ───
    function exportJSON() {
        const payload = {
            format: 'examPapers_backup_v2',
            schoolYear,
            exportedAt: new Date().toISOString(),
            handovers: loadRecords()
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'اوراق-التحرير-' + schoolYear.replace('/', '-') + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('تم تصدير النسخة الاحتياطية', 'success');
    }

    async function importJSON(file) {
        try {
            const data = JSON.parse(await file.text());
            const incoming = Array.isArray(data) ? data : data.handovers;
            if (!Array.isArray(incoming)) throw new Error('صيغة غير معروفة');
            const { confirmed } = await showConfirm({
                title: 'استيراد التسليمات',
                message: `سيتم دمج ${incoming.length} تسجيل مع البيانات الحالية.`,
                type: 'warning',
                confirmText: 'استيراد'
            });
            if (!confirmed) return;
            const list = loadRecords();
            const ids = new Set(list.map((h) => h.id));
            incoming.forEach((h) => {
                if (h && h.id && !ids.has(h.id)) {
                    list.push(h);
                    ids.add(h.id);
                }
            });
            saveRecords(list);
            showToast('تم الاستيراد', 'success');
            populateFilters();
            renderLog();
        } catch (e) {
            showToast('فشل الاستيراد: ' + e.message, 'error');
        }
    }

    // ─── Init ───
    document.addEventListener('DOMContentLoaded', async () => {
        dateInp.value = todayISO();
        try {
            // CH7: pre-warm global exam-count cache so froudCountSync never needs a local table.
            await warmFroudCache('*');
            await loadReferenceData();
        } catch (e) {
            console.warn('[exam-papers] reference load failed:', e);
            if (typeof showToast === 'function') showToast('تعذر تحميل المواد/الأساتذة', 'error');
        }

        sessionSel.addEventListener('change', buildMatrix);
        subjectSel.addEventListener('change', () => {
            filterTeachersBySubject(subjectSel.value);
            buildMatrix();
        });
        teacherSel.addEventListener('change', buildMatrix);
        saveBtn.addEventListener('click', saveHandover);
        resetBtn.addEventListener('click', resetForm);

        [fSubject, fTeacher, fKind, fFrom, fTo].forEach((el) => {
            el.addEventListener('change', renderLog);
            el.addEventListener('input', renderLog);
        });
        exportBtn.addEventListener('click', exportJSON);
        importInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) importJSON(file);
            e.target.value = '';
        });

        tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-delete]');
            if (btn) deleteRecord(btn.dataset.delete);
        });

        renderLog();
    });
})();
