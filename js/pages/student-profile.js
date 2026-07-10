/**
 * Student Profile Page — Dynamic Data Controller
 * صفحة ملف التلميذ — المتحكم الديناميكي
 */

const SCHOOL_YEAR = getSchoolYear();

// Risk-tab inputs stashed by the render functions (general average, per-subject
// averages, absence hours) so renderStudentRiskTab() can feed the pure engine
// in js/student-risk.js without re-parsing the DOM. Profile-tab signals
// (economic/social/health) are read live via the existing tab collectors.
const _riskState = {
    generalAverage: null,
    subjectAverages: [],
    justifiedHours: 0,
    unjustifiedHours: 0
};

// BM Tab_Score results cached per axis (parallels _riskState).
// Each slot holds the last { score, level, subScores } result from bm-scoring.js,
// or null when the scorer has not been run yet / module not loaded.
const _bmScoreState = {
    economic: null,
    social:   null,
    health:   null,
    followup: null
};

// CH8: isMale / isFemale / getGenderLabel / getGenderIcon via js/shared/gender.js

// ─── Avatar helpers ───
const avatarColors = [
    '#3B6AC5',
    '#3C95D0',
    '#E67F22',
    '#9B59B6',
    '#E74C3C',
    '#1ABC9C',
    '#2980B9',
    '#D35400',
    '#8E44AD',
    '#27AE60',
    '#F39C12',
    '#C0392B',
    '#16A085',
    '#2C3E50',
    '#7F8C8D'
];
function getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return avatarColors[Math.abs(hash) % avatarColors.length];
}
function getInitial(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return parts[0].charAt(0).toUpperCase();
}

// ─── Grade color helpers ───
function gradeColor(val) {
    if (val >= 16) return 'grade-excellent';
    if (val >= 14) return 'grade-good';
    if (val >= 12) return 'grade-average';
    if (val >= 10) return 'grade-pass';
    return 'grade-poor';
}
function gradeHex(val) {
    if (val >= 16) return '#4caf50';
    if (val >= 14) return '#8bc34a';
    if (val >= 12) return '#ff9800';
    if (val >= 10) return '#ffc107';
    return '#f44336';
}

// normalizeSubjectName() — provided by js/utils.js

// ─── Grade dedup helper (shared by renderMiniStats + renderGradesTab) ───
// Collapses grade records to one per (subject, semester) pair so both the
// quick-stats card and the grades tab dedup identically and can never drift.
function dedupeGrades(grades) {
    const dedup = {};
    (grades || []).forEach((g) => {
        const key = `${String(g.subject || '').trim()}||${g.semester || ''}`;
        dedup[key] = g;
    });
    return Object.values(dedup);
}

// ─── URL Params ───
function getStudentCodeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('code') || '';
}

// ─── DOM Ready ───
document.addEventListener('DOMContentLoaded', async () => {
    const code = getStudentCodeFromUrl();

    // Tab switching
    initTabs();

    // Header actions (back + print preview). The shared setupUnifiedHeader()
    // in utils.js rebuilds the .header and discards our original buttons, so we
    // (re)attach the actions into the generated .page-title-row instead.
    setupHeaderActions();

    if (!code) {
        showNoStudentState();
        return;
    }

    // Initialize profile save system
    initSaveButtons();
    initDirtyTracking();
    initUnsavedWarning();
    injectScoreWidgets();
    initBmScoring();

    await loadStudentProfile(code);
});

// ─── Tab Switching ───
function initTabs() {
    const tabBtns = document.querySelectorAll('.sp-tab-btn');
    const tabList = document.querySelector('.sp-tabs-nav');

    function activateTab(btn) {
        tabBtns.forEach((b) => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
            b.setAttribute('tabindex', '-1');
        });
        document.querySelectorAll('.sp-tab-content').forEach((c) => c.classList.remove('active'));

        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        btn.setAttribute('tabindex', '0');
        btn.focus();
        const target = btn.dataset.tab;
        document.getElementById(target)?.classList.add('active');
    }

    tabBtns.forEach((btn, idx) => {
        btn.setAttribute('tabindex', idx === 0 ? '0' : '-1');
        btn.addEventListener('click', () => activateTab(btn));
    });

    if (tabList) {
        tabList.addEventListener('keydown', (e) => {
            const tabs = Array.from(tabBtns);
            const current = tabs.indexOf(document.activeElement);
            if (current < 0) return;
            let next = -1;
            if (e.key === 'ArrowLeft') next = (current + 1) % tabs.length;
            else if (e.key === 'ArrowRight') next = (current - 1 + tabs.length) % tabs.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = tabs.length - 1;
            if (next >= 0) {
                e.preventDefault();
                activateTab(tabs[next]);
            }
        });
    }
}

// ─── No Student State ───
function showNoStudentState() {
    document.getElementById('sp-profile-header').innerHTML = `
        <div style="text-align: center; padding: 60px 20px;">
            <div style="width: 100px; height: 100px; border-radius: 50%; background: rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                <i class="fas fa-user-slash" style="font-size: 42px; opacity: 0.7;"></i>
            </div>
            <h2 style="margin-bottom: 10px;">لم يتم تحديد تلميذ</h2>
            <p style="opacity: 0.8; margin-bottom: 20px;">يرجى الوصول لهذه الصفحة من خلال لائحة التلاميذ</p>
            <a href="students-list.html" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                <i class="fas fa-arrow-right"></i> الذهاب للائحة التلاميذ
            </a>
        </div>
    `;
    // Hide right column
    document.querySelector('.sp-grid')?.style.setProperty('display', 'none');
    document.querySelector('.sp-sidebar-col')?.style.setProperty('display', 'none');
}

// ─── Load Full Profile ───
async function loadStudentProfile(code) {
    try {
        // Fetch student data
        const students = (await window.api.students.search('', '', code, SCHOOL_YEAR)) || [];
        const student = students.find((s) => String(s.massar_code || '').trim() === code.trim());

        if (!student) {
            showNoStudentState();
            if (typeof showToast === 'function') showToast('لم يتم العثور على التلميذ', 'warning');
            return;
        }

        // Render header
        renderProfileHeader(student);

        // Render personal info
        renderPersonalInfo(student);

        // Load grades, absences in parallel — scoped server-side to this
        // student (H1/R6). Results already come back filtered by student_code,
        // so the redundant client-side `=== code` passes are dropped; only the
        // numeric grade normalization/filter is kept.
        const [rawGrades, rawAbsences] = await Promise.all([
            window.api.grades.getByStudentCode(code, SCHOOL_YEAR).catch(() => []),
            window.api.absences.getByStudentCode(code, SCHOOL_YEAR).catch(() => [])
        ]);

        // Classify the RAW value as entered/not-entered BEFORE numeric coercion
        // (Bug 1). `Number(null)`/`Number('')`/`Number('  ')` all evaluate to a
        // finite `0`, so coercing first would smuggle not-entered placeholders
        // in as phantom zeros. Filtering on `isGradeEntered(g.grade)` first keeps
        // only real marks — genuine `0`/`'0'` included — and discards not-entered
        // slots, so `studentGrades` (and every downstream KPI/average/risk input)
        // never contains a phantom zero.
        const studentGrades = (rawGrades || [])
            .filter((g) => (typeof isGradeEntered === 'function'
                ? isGradeEntered(g && g.grade)
                : Number.isFinite(Number(g && g.grade))))
            .map((g) => ({ ...g, grade: Number(g.grade) }));

        const studentAbsences = rawAbsences || [];

        // Render grades tab
        renderGradesTab(student, studentGrades);

        // Render absence tab
        renderAbsenceTab(studentAbsences);

        // Render mini stats
        renderMiniStats(studentGrades, studentAbsences, student);

        // Load saved profile tab data
        await loadAllProfileTabs(code, student.id || 0);
    } catch (err) {
        console.error('Error loading student profile:', err);
        if (typeof showToast === 'function') showToast('خطأ في تحميل ملف التلميذ', 'error');
    }
}

// ─── Render Profile Header ───
function renderProfileHeader(student) {
    const name = student.full_name || '-';
    const initial = getInitial(name);
    const color = getAvatarColor(name);
    const genderLabel = getGenderLabel(student.gender);

    const headerEl = document.getElementById('sp-profile-header');
    headerEl.innerHTML = `
        <div class="sp-avatar" style="background: ${color}">${initial}</div>
        <div class="sp-header-info">
            <h1 id="sp-student-name">${escapeHtml(name)}</h1>
            <div class="sp-meta">
                <span><i class="fas fa-fingerprint"></i> ${escapeHtml(student.massar_code || '-')}</span>
                <span><i class="fas fa-graduation-cap"></i> ${escapeHtml(student.class_name || '-')}</span>
                ${student.birth_date ? `<span><i class="fas fa-calendar"></i> ${escapeHtml(student.birth_date)}</span>` : ''}
                <span><i class="fas fa-venus-mars"></i> ${genderLabel}</span>
            </div>
        </div>
        <div class="sp-status-badge"><i class="fas fa-check-circle"></i> نشط</div>
    `;
}

// ─── Render Personal Info ───
function renderPersonalInfo(student) {
    const infoCard = document.getElementById('sp-personal-info');
    if (!infoCard) return;

    const genderLabel = getGenderLabel(student.gender);

    infoCard.innerHTML = `
        <div class="sp-info-row">
            <span class="sp-info-label">الجنس</span>
            <span class="sp-info-value"><i class="fas ${getGenderIcon(student.gender)}" style="margin-inline-end: 6px;"></i>${genderLabel}</span>
        </div>
        <div class="sp-info-row">
            <span class="sp-info-label">تاريخ الازدياد</span>
            <span class="sp-info-value">${escapeHtml(student.birth_date || '-')}</span>
        </div>
        <div class="sp-info-row">
            <span class="sp-info-label">مكان الازدياد</span>
            <span class="sp-info-value">${escapeHtml(student.birth_place || '-')}</span>
        </div>
        <div class="sp-info-row">
            <span class="sp-info-label">القسم</span>
            <span class="sp-info-value">${escapeHtml(student.class_name || '-')}</span>
        </div>
        <div class="sp-info-row">
            <span class="sp-info-label">رمز مسار</span>
            <span class="sp-info-value" style="direction: ltr; text-align: right;">${escapeHtml(student.massar_code || '-')}</span>
        </div>
        <div class="sp-info-row">
            <span class="sp-info-label">السنة الدراسية</span>
            <span class="sp-info-value">${SCHOOL_YEAR}</span>
        </div>
    `;

    // Update academic timeline
    const timelineClass = document.getElementById('sp-timeline-current');
    if (timelineClass) {
        timelineClass.textContent = student.class_name || 'القسم الحالي';
    }
}

// ─── Render Mini Stats ───
function renderMiniStats(grades, absences, student) {
    // Detect the student's branch once; reused for the shared computation below.
    const branch =
        typeof detectBranch === 'function' ? detectBranch(student.section || student.class_name || '') : null;

    // Per-term and general averages via the shared pure computation layer
    // (js/student-averages.js). This replaces the previous inline pooled
    // computation so the quick-stats card and grades tab can never drift.
    const averages =
        typeof computeStudentAverages === 'function'
            ? computeStudentAverages(grades, branch)
            : { term1: null, term2: null, general: null };

    // Subject count for the quick-stats card (unchanged behavior): count the
    // distinct base subjects across the student's grade records.
    const subjectSet = new Set();
    dedupeGrades(grades).forEach((g) => {
        const subj =
            (typeof ccBaseSubject === 'function'
                ? ccBaseSubject(normalizeSubjectName(g.subject))
                : normalizeSubjectName(g.subject)) || 'غير محدد';
        subjectSet.add(subj);
    });
    const subjectCount = subjectSet.size;

    // Absence hours
    let justifiedHours = 0;
    let unjustifiedHours = 0;
    absences.forEach((a) => {
        const h = Number(a.hours) || 0;
        if (a.absence_type === 'justified') justifiedHours += h;
        else if (a.absence_type === 'unjustified') unjustifiedHours += h;
    });
    const totalAbsHours = justifiedHours + unjustifiedHours;

    // Stash absence + general average for the dropout-risk engine (Axis A/B).
    _riskState.generalAverage = typeof averages.general === 'number' ? averages.general : null;
    _riskState.justifiedHours = justifiedHours;
    _riskState.unjustifiedHours = unjustifiedHours;

    // Render an average value cell: show the formatted text, applying grade
    // color only when formatAverage returns a non-null color (placeholders
    // are rendered without color).
    const renderAvgCell = (el, value) => {
        if (!el) return;
        const formatted =
            typeof formatAverage === 'function'
                ? formatAverage(value)
                : { text: value == null ? '—' : Number(value).toFixed(2), color: null };
        if (formatted.color) {
            el.innerHTML = `<span style="color:${formatted.color}">${formatted.text}</span>`;
        } else {
            el.textContent = formatted.text;
        }
    };

    // Update mini stats
    const avgEl = document.getElementById('sp-stat-avg');
    const term1El = document.getElementById('sp-stat-term1');
    const term2El = document.getElementById('sp-stat-term2');
    const subjectsEl = document.getElementById('sp-stat-subjects');
    const absEl = document.getElementById('sp-stat-absence');

    // sp-stat-avg holds General_Average so the print/risk consumer that reads
    // parseFloat(textContent) keeps working (numeric value or NaN-placeholder).
    renderAvgCell(avgEl, averages.general);
    renderAvgCell(term1El, averages.term1);
    renderAvgCell(term2El, averages.term2);

    if (subjectsEl) {
        subjectsEl.textContent = subjectCount;
    }
    if (absEl) {
        absEl.innerHTML = `<span style="color:${totalAbsHours > 10 ? '#f44336' : '#4caf50'}">${totalAbsHours}</span>`;
    }
}

// ─── Render Grades Tab ───
function renderGradesTab(student, rawGrades) {
    const container = document.getElementById('sp-grades-content');
    if (!container) return;

    // Deduplicate via the shared helper (keeps this tab in sync with the
    // quick-stats card — same (subject, semester) collapse).
    const studentGrades = dedupeGrades(rawGrades);

    if (!studentGrades.length) {
        container.innerHTML = `
            <div class="sp-empty-tab">
                <i class="fas fa-inbox"></i>
                <p>لا توجد نقط مسجلة لهذا التلميذ</p>
            </div>
        `;
        return;
    }

    // Group by subject
    const bySubject = {};
    studentGrades.forEach((g) => {
        const subj =
            (typeof ccBaseSubject === 'function'
                ? ccBaseSubject(normalizeSubjectName(g.subject))
                : normalizeSubjectName(g.subject)) || 'غير محدد';
        if (!bySubject[subj]) bySubject[subj] = [];
        bySubject[subj].push(g);
    });

    const subjects = Object.keys(bySubject).sort(
        typeof compareSubjects === 'function' ? compareSubjects : (a, b) => a.localeCompare(b, 'ar')
    );

    // KPIs
    const subjectAvgsArr = subjects.map((s) => {
        const avg =
            typeof computeSubjectAverage === 'function'
                ? computeSubjectAverage(s, bySubject[s])
                : bySubject[s].reduce((a, g) => a + g.grade, 0) / bySubject[s].length;
        return { subject: s, avg };
    });

    // Stash per-subject averages for the dropout-risk engine (Axis A: share of
    // subjects below the pass mark).
    _riskState.subjectAverages = subjectAvgsArr
        .map((x) => x.avg)
        .filter((v) => typeof v === 'number' && isFinite(v));

    const branch =
        typeof detectBranch === 'function' ? detectBranch(student.section || student.class_name || '') : null;

    // Per-term and general averages via the shared pure computation layer
    // (js/student-averages.js), the same call used by renderMiniStats. This
    // guarantees the grades-tab KPIs and the quick-stats card never drift
    // (Requirement 6.1). `rawGrades` (all terms) is passed; the module handles
    // its own per-term dedup/partitioning internally.
    const averages =
        typeof computeStudentAverages === 'function'
            ? computeStudentAverages(rawGrades, branch)
            : { term1: null, term2: null, general: null };

    // reduce-based max/min avoids the call-stack overflow risk of
    // Math.max(...arr) / Math.min(...arr) on large grade arrays (L3).
    const maxGrade = studentGrades.reduce((m, g) => (g.grade > m ? g.grade : m), -Infinity);
    const minGrade = studentGrades.reduce((m, g) => (g.grade < m ? g.grade : m), Infinity);

    // Build an average KPI cell, applying grade color only when formatAverage
    // returns a non-null color (placeholders are rendered without color).
    const avgKpi = (label, value) => {
        const f =
            typeof formatAverage === 'function'
                ? formatAverage(value)
                : { text: value == null ? '—' : Number(value).toFixed(2), color: null };
        const style = f.color ? ` style="color:${f.color}"` : '';
        return `
            <div class="sp-kpi">
                <div class="sp-kpi-val"${style}>${f.text}</div>
                <div class="sp-kpi-label">${label}</div>
            </div>`;
    };

    let html = `
        <div class="sp-kpis-row">
            ${avgKpi('المعدل العام', averages.general)}
            ${avgKpi('معدل الدورة 1', averages.term1)}
            ${avgKpi('معدل الدورة 2', averages.term2)}
            <div class="sp-kpi">
                <div class="sp-kpi-val">${subjects.length}</div>
                <div class="sp-kpi-label">عدد المواد</div>
            </div>
            <div class="sp-kpi">
                <div class="sp-kpi-val">${studentGrades.length}</div>
                <div class="sp-kpi-label">عدد النقط</div>
            </div>
            <div class="sp-kpi">
                <div class="sp-kpi-val" style="color:#4caf50">${maxGrade.toFixed(1)}</div>
                <div class="sp-kpi-label">أعلى نقطة</div>
            </div>
            <div class="sp-kpi">
                <div class="sp-kpi-val" style="color:#f44336">${minGrade.toFixed(1)}</div>
                <div class="sp-kpi-label">أدنى نقطة</div>
            </div>
        </div>
    `;

    // Subject visual chart (horizontal bars)
    html += `<div class="sp-subjects-chart">`;
    subjectAvgsArr.forEach(({ subject, avg }) => {
        const pct = Math.min((avg / 20) * 100, 100);
        html += `
            <div class="sp-chart-row">
                <span class="sp-chart-label">${escapeHtml(subject)}</span>
                <div class="sp-chart-bar-track">
                    <div class="sp-chart-bar-fill" style="width: ${pct}%; background: ${gradeHex(avg)}"></div>
                </div>
                <span class="sp-chart-val" style="color:${gradeHex(avg)}">${avg.toFixed(2)}</span>
            </div>
        `;
    });
    html += `</div>`;

    // Subject detail blocks
    html += `<h4 class="sp-section-title"><i class="fas fa-book-open"></i> تفاصيل النقط حسب المادة</h4>`;
    subjects.forEach((subj) => {
        const grades = bySubject[subj];
        const avg =
            typeof computeSubjectAverage === 'function'
                ? computeSubjectAverage(subj, grades)
                : grades.reduce((a, g) => a + g.grade, 0) / grades.length;

        // Group by semester
        const bySemester = {};
        grades.forEach((g) => {
            const sem = g.semester || 0;
            if (!bySemester[sem]) bySemester[sem] = [];
            bySemester[sem].push(g);
        });
        const semesterKeys = Object.keys(bySemester).sort((a, b) => Number(a) - Number(b));
        const semesterNames = { 1: 'الدورة الأولى', 2: 'الدورة الثانية', 0: 'غير محددة' };
        const hasMultipleSemesters = semesterKeys.length > 1 || (semesterKeys.length === 1 && semesterKeys[0] !== '0');

        let bodyHtml = '';
        if (hasMultipleSemesters) {
            const cols = semesterKeys
                .map((sem) => {
                    const semName = semesterNames[sem] || `الدورة ${sem}`;
                    let examIdx = 0;
                    const chips = bySemester[sem]
                        .map((g) => {
                            const pct = Math.min((g.grade / 20) * 100, 100);
                            const isActv = typeof ccIsActivity === 'function' && ccIsActivity(g.subject);
                            const chipLabel = isActv ? 'أنشطة مندمجة' : `فرض ${++examIdx}`;
                            return `<div class="sp-grade-chip">
                        <span class="chip-label">${chipLabel}</span>
                        <span class="chip-value" style="color:${gradeHex(g.grade)}">${g.grade.toFixed(2)}</span>
                        <div class="chip-bar"><div class="chip-bar-fill" style="width:${pct}%;background:${gradeHex(g.grade)}"></div></div>
                    </div>`;
                        })
                        .join('');
                    return `<div class="sp-semester-col">
                    <div class="sp-semester-header"><span>${semName}</span></div>
                    <div class="sp-grades-chips">${chips}</div>
                </div>`;
                })
                .join('');
            bodyHtml = `<div class="sp-semesters-grid">${cols}</div>`;
        } else {
            let examIdx = 0;
            const chips = grades
                .map((g) => {
                    const pct = Math.min((g.grade / 20) * 100, 100);
                    const isActv = typeof ccIsActivity === 'function' && ccIsActivity(g.subject);
                    const chipLabel = isActv ? 'أنشطة مندمجة' : `فرض ${++examIdx}`;
                    return `<div class="sp-grade-chip">
                    <span class="chip-label">${chipLabel}</span>
                    <span class="chip-value" style="color:${gradeHex(g.grade)}">${g.grade.toFixed(2)}</span>
                    <div class="chip-bar"><div class="chip-bar-fill" style="width:${pct}%;background:${gradeHex(g.grade)}"></div></div>
                </div>`;
                })
                .join('');
            bodyHtml = `<div class="sp-grades-chips">${chips}</div>`;
        }

        html += `
            <div class="sp-subject-block">
                <div class="sp-subject-header">
                    <span class="sp-subj-name"><i class="fas fa-book"></i> ${escapeHtml(subj)}</span>
                    <span class="sp-subj-avg" style="background: ${gradeHex(avg)}">${avg.toFixed(2)}</span>
                </div>
                <div class="sp-subject-body">${bodyHtml}</div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// ─── Render Absence Tab ───
function renderAbsenceTab(absences) {
    const container = document.getElementById('sp-absence-content');
    if (!container) return;

    if (!absences.length) {
        container.innerHTML = `
            <div class="sp-empty-tab">
                <i class="fas fa-check-circle grade-excellent"></i>
                <p>لا يوجد غياب مسجل لهذا التلميذ</p>
            </div>
        `;
        return;
    }

    let justifiedHours = 0;
    let unjustifiedHours = 0;
    const byMonth = {};

    absences.forEach((a) => {
        const h = Number(a.hours) || 0;
        if (a.absence_type === 'justified') justifiedHours += h;
        else if (a.absence_type === 'unjustified') unjustifiedHours += h;

        const month = a.month || a.absence_date?.slice(0, 7) || 'غير محدد';
        if (!byMonth[month]) byMonth[month] = { justified: 0, unjustified: 0 };
        if (a.absence_type === 'justified') byMonth[month].justified += h;
        else byMonth[month].unjustified += h;
    });

    const totalHours = justifiedHours + unjustifiedHours;

    let html = `
        <div class="sp-kpis-row">
            <div class="sp-kpi">
                <div class="sp-kpi-val" style="color:${totalHours > 10 ? '#f44336' : '#4caf50'}">${totalHours}</div>
                <div class="sp-kpi-label">مجموع الساعات</div>
            </div>
            <div class="sp-kpi">
                <div class="sp-kpi-val" style="color:#4caf50">${justifiedHours}</div>
                <div class="sp-kpi-label">ساعات مبررة</div>
            </div>
            <div class="sp-kpi">
                <div class="sp-kpi-val" style="color:#f44336">${unjustifiedHours}</div>
                <div class="sp-kpi-label">ساعات غير مبررة</div>
            </div>
            <div class="sp-kpi">
                <div class="sp-kpi-val">${absences.length}</div>
                <div class="sp-kpi-label">عدد الحالات</div>
            </div>
        </div>
    `;

    // Monthly breakdown table
    const months = Object.keys(byMonth).sort();
    if (months.length) {
        html += `
            <h4 class="sp-section-title"><i class="fas fa-calendar-alt"></i> تفصيل شهري</h4>
            <div class="sp-absence-table-wrap">
                <table class="sp-absence-table">
                    <thead>
                        <tr>
                            <th>الشهر</th>
                            <th>مبررة</th>
                            <th>غير مبررة</th>
                            <th>المجموع</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${months
                            .map((m) => {
                                const data = byMonth[m];
                                const total = data.justified + data.unjustified;
                                return `<tr>
                                <td><strong>${escapeHtml(m)}</strong></td>
                                <td style="color:#4caf50; font-weight: 700;">${data.justified}</td>
                                <td style="color:#f44336; font-weight: 700;">${data.unjustified}</td>
                                <td style="font-weight: 800;">${total}</td>
                            </tr>`;
                            })
                            .join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // Recent absence records
    html += `
        <h4 class="sp-section-title"><i class="fas fa-list"></i> آخر حالات الغياب</h4>
        <div class="sp-absence-records">
            ${absences
                .slice(0, 15)
                .map((a) => {
                    const isJustified = a.absence_type === 'justified';
                    const typeLabel = isJustified ? 'مبرر' : 'غير مبرر';
                    const typeColor = isJustified ? '#2ECC71' : '#E85D5D';
                    const hours = Number(a.hours) || 0;
                    return `
                    <div class="sp-absence-record">
                        <div class="sp-abs-type" style="color: ${typeColor}">
                            <i class="fas ${isJustified ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                            ${typeLabel}
                        </div>
                        <div class="sp-abs-hours">${hours} <small>ساعة</small></div>
                        <div class="sp-abs-date">${escapeHtml(a.absence_date || a.month || '-')}</div>
                    </div>
                `;
                })
                .join('')}
        </div>
    `;

    container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// ── Profile Data Persistence (Bataqa Mutabaat) ──
// ═══════════════════════════════════════════════════════════════

let _currentStudentCode = '';
let _currentStudentId = 0;
const _dirtyTabs = new Set();

// ── Helper: get selected radio value ──
function bmRadio(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : null;
}

// ── Helper: set radio value ──
function bmSetRadio(name, val) {
    if (!val) return;
    const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
    if (el) el.checked = true;
}

// ── Helper: get checked checkboxes as array ──
function bmCheckboxes(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
        .map(el => el.value)
        .filter(Boolean);
}

// ── Helper: set checkboxes from array ──
function bmSetCheckboxes(containerId, values) {
    if (!Array.isArray(values)) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('input[type="checkbox"]').forEach(el => {
        el.checked = values.includes(el.value);
    });
}

// ── Helper: get active badges (data-value) from a container ──
function bmBadges(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.bm-badge:not(.bm-badge-off)'))
        .map(el => el.dataset.value)
        .filter(Boolean);
}

// ── Helper: set badges from array ──
function bmSetBadges(containerId, values, colorMap) {
    if (!Array.isArray(values)) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.bm-badge').forEach(el => {
        const val = el.dataset.value;
        if (values.includes(val)) {
            const color = colorMap?.[val] || el.className.replace(/bm-badge\s*bm-badge-off/, '').trim();
            // Color comes from the declarative data-color attribute (H2/R9),
            // matching the badge's onclick color, with a 'blue' fallback.
            const badgeColor = el.dataset.color || 'blue';
            el.className = 'bm-badge bm-badge-' + badgeColor;
            el.setAttribute('aria-checked', 'true');
        } else {
            el.className = 'bm-badge bm-badge-off';
            el.setAttribute('aria-checked', 'false');
        }
    });
}

// ── Helper: input value ──
function bmVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

function bmSetVal(id, val) {
    const el = document.getElementById(id);
    if (el && val != null) el.value = val;
}

// ── Data Collectors per Tab ──

function collectEconomicData() {
    return {
        eco_status: bmRadio('bm-eco'),
        income_source: bmRadio('bm-income'),
        family_size: bmVal('bm-family-size'),
        schooling_children: bmVal('bm-schooling-children'),
        distance_km: bmVal('bm-distance-km'),
        transport: bmRadio('bm-transport'),
        support_programs: bmCheckboxes('bm-support-programs'),
        unmet_needs: bmCheckboxes('bm-unmet-needs'),
        notes: bmVal('bm-eco-notes')
    };
}

function collectSocialData() {
    return {
        family_status: bmRadio('bm-family'),
        parents_edu: bmRadio('bm-parents-edu'),
        housing: bmRadio('bm-housing'),
        study_place: bmRadio('bm-study-place'),
        teachers_rel: bmRadio('bm-teachers-rel'),
        peers_rel: bmRadio('bm-peers-rel'),
        social_risks: bmBadges('bm-social-risks'),
        notes: bmVal('bm-social-notes')
    };
}

function collectHealthData() {
    return {
        health_gen: bmRadio('bm-health-gen'),
        disability: bmRadio('bm-disability'),
        learning_disorders: bmBadges('bm-learning-disorders'),
        sleep: bmRadio('bm-sleep'),
        nutrition: bmRadio('bm-nutrition'),
        substances: bmBadges('bm-substances'),
        chronic: bmVal('bm-chronic'),
        treatment: bmRadio('bm-treatment'),
        mood: typeof bmScaleVals !== 'undefined' ? bmScaleVals.mood : null,
        motivation: typeof bmScaleVals !== 'undefined' ? bmScaleVals.motiv : null,
        confidence: typeof bmScaleVals !== 'undefined' ? bmScaleVals.conf : null,
        psych_symptoms: bmBadges('bm-psych-symptoms'),
        psych_support: bmRadio('bm-psych-supp'),
        psych_referral: bmRadio('bm-psych-ref'),
        health_notes: bmVal('bm-health-notes'),
        psych_notes: bmVal('bm-psych-notes')
    };
}

function collectFollowupData() {
    return {
        guardian_name: bmVal('bm-guardian-name'),
        guardian_phone: bmVal('bm-guardian-phone'),
        calls_count: bmVal('bm-calls-count'),
        meetings_count: bmVal('bm-meetings-count'),
        last_contact: bmVal('bm-last-contact'),
        actions_taken: bmBadges('bm-actions-taken'),
        interview_notes: bmVal('bm-interview-notes'),
        plan_notes: bmVal('bm-plan-notes'),
        next_date: bmVal('bm-next-date')
    };
}

const TAB_COLLECTORS = {
    economic: collectEconomicData,
    social: collectSocialData,
    health: collectHealthData,
    followup: collectFollowupData
};

// ── Populate Form from Saved Data ──

function populateEconomicData(data) {
    bmSetRadio('bm-eco', data.eco_status);
    bmSetRadio('bm-income', data.income_source);
    bmSetVal('bm-family-size', data.family_size);
    bmSetVal('bm-schooling-children', data.schooling_children);
    bmSetVal('bm-distance-km', data.distance_km);
    bmSetRadio('bm-transport', data.transport);
    bmSetCheckboxes('bm-support-programs', data.support_programs);
    bmSetCheckboxes('bm-unmet-needs', data.unmet_needs);
    bmSetVal('bm-eco-notes', data.notes);
}

function populateSocialData(data) {
    bmSetRadio('bm-family', data.family_status);
    bmSetRadio('bm-parents-edu', data.parents_edu);
    bmSetRadio('bm-housing', data.housing);
    bmSetRadio('bm-study-place', data.study_place);
    bmSetRadio('bm-teachers-rel', data.teachers_rel);
    bmSetRadio('bm-peers-rel', data.peers_rel);
    bmSetBadges('bm-social-risks', data.social_risks);
    bmSetVal('bm-social-notes', data.notes);
}

function populateHealthData(data) {
    bmSetRadio('bm-health-gen', data.health_gen);
    bmSetRadio('bm-disability', data.disability);
    bmSetBadges('bm-learning-disorders', data.learning_disorders);
    bmSetRadio('bm-sleep', data.sleep);
    bmSetRadio('bm-nutrition', data.nutrition);
    bmSetBadges('bm-substances', data.substances);
    bmSetVal('bm-chronic', data.chronic);
    bmSetRadio('bm-treatment', data.treatment);
    if (data.mood && typeof bmSelectScale === 'function') {
        const btn = document.querySelector(`#bm-mood-scale .bm-scale-btn:nth-child(${data.mood})`);
        if (btn) bmSelectScale('mood', data.mood, btn);
    }
    if (data.motivation && typeof bmSelectScale === 'function') {
        const btn = document.querySelector(`#bm-motiv-scale .bm-scale-btn:nth-child(${data.motivation})`);
        if (btn) bmSelectScale('motiv', data.motivation, btn);
    }
    if (data.confidence && typeof bmSelectScale === 'function') {
        const btn = document.querySelector(`#bm-conf-scale .bm-scale-btn:nth-child(${data.confidence})`);
        if (btn) bmSelectScale('conf', data.confidence, btn);
    }
    bmSetBadges('bm-psych-symptoms', data.psych_symptoms);
    bmSetRadio('bm-psych-supp', data.psych_support);
    bmSetRadio('bm-psych-ref', data.psych_referral);
    bmSetVal('bm-health-notes', data.health_notes);
    bmSetVal('bm-psych-notes', data.psych_notes);
}

function populateFollowupData(data) {
    bmSetVal('bm-guardian-name', data.guardian_name);
    bmSetVal('bm-guardian-phone', data.guardian_phone);
    bmSetVal('bm-calls-count', data.calls_count);
    bmSetVal('bm-meetings-count', data.meetings_count);
    bmSetVal('bm-last-contact', data.last_contact);
    bmSetBadges('bm-actions-taken', data.actions_taken);
    bmSetVal('bm-interview-notes', data.interview_notes);
    bmSetVal('bm-plan-notes', data.plan_notes);
    bmSetVal('bm-next-date', data.next_date);
}

const TAB_POPULATORS = {
    economic: populateEconomicData,
    social: populateSocialData,
    health: populateHealthData,
    followup: populateFollowupData
};

// ── Save All Tabs ──

const TAB_LABELS = {
    economic: 'الجانب الاقتصادي',
    social: 'الجانب الاجتماعي',
    health: 'الجانب الصحي والنفسي',
    followup: 'المتابعة'
};
const ALL_TAB_KEYS = ['economic', 'social', 'health', 'followup'];

async function saveAllTabs() {
    if (!_currentStudentCode) return;

    // Disable all save buttons + show spinner
    const btns = ALL_TAB_KEYS.map(k => document.getElementById('bm-save-' + k)).filter(Boolean);
    btns.forEach(btn => {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
    });

    let savedCount = 0;
    let errorCount = 0;

    for (const tabKey of ALL_TAB_KEYS) {
        if (!TAB_COLLECTORS[tabKey]) continue;
        const data = TAB_COLLECTORS[tabKey]();
        try {
            const result = await window.api.studentProfile.saveTab({
                student_id: _currentStudentId,
                student_code: _currentStudentCode,
                tab_key: tabKey,
                data_json: data,
                school_year: SCHOOL_YEAR
            });

            if (result && result.success !== false) {
                savedCount++;
                _dirtyTabs.delete(tabKey);
                const savedEl = document.getElementById('bm-saved-' + tabKey);
                if (savedEl) {
                    const now = new Date();
                    savedEl.innerHTML = '<i class="fas fa-check-circle" style="color:#2ECC71"></i> آخر حفظ: ' +
                        now.toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' });
                }
            } else {
                errorCount++;
            }
        } catch (err) {
            console.error('Save tab error (' + tabKey + '):', err);
            errorCount++;
        }
    }

    // Restore all buttons
    ALL_TAB_KEYS.forEach(tabKey => {
        const btn = document.getElementById('bm-save-' + tabKey);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> حفظ جميع البيانات';
        }
    });

    // Show result
    if (errorCount === 0) {
        if (typeof showToast === 'function') showToast('تم حفظ جميع البيانات بنجاح (' + savedCount + ' تبويبات)', 'success');
    } else {
        if (typeof showToast === 'function') showToast('تم حفظ ' + savedCount + ' تبويبات، فشل ' + errorCount, 'warning');
    }

    // Auto-update risk indicator
    if (typeof bmUpdateRisk === 'function') bmAutoRiskFromTabs();
}

// ── Load All Tabs ──

async function loadAllProfileTabs(studentCode, studentId) {
    _currentStudentCode = studentCode;
    _currentStudentId = studentId;

    try {
        const tabs = await window.api.studentProfile.getAllTabs(studentCode, SCHOOL_YEAR);
        if (!Array.isArray(tabs)) return;

        for (const row of tabs) {
            const populator = TAB_POPULATORS[row.tab_key];
            if (!populator) continue;
            try {
                const data = typeof row.data_json === 'string' ? JSON.parse(row.data_json) : row.data_json;
                populator(data);
                // Show last-saved timestamp
                const savedEl = document.getElementById('bm-saved-' + row.tab_key);
                if (savedEl && row.updated_at) {
                    const d = new Date(row.updated_at);
                    savedEl.innerHTML = '<i class="fas fa-check-circle" style="color:#2ECC71"></i> آخر حفظ: ' +
                        d.toLocaleDateString('ar-MA') + ' ' + d.toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' });
                }
            } catch (parseErr) {
                console.warn('Parse error for tab', row.tab_key, parseErr);
            }
        }

        // Auto-update risk from profile data
        bmAutoRiskFromTabs();
        updateAllScoreWidgets();
    } catch (err) {
        console.error('Load profile tabs error:', err);
    }
}

// ── Auto Risk from All Tabs ──
// Reads profile data to auto-activate risk badges

function bmAutoRiskFromTabs() {
    // Read economic data
    const ecoStatus = bmRadio('bm-eco');
    if (ecoStatus === 'poor' || ecoStatus === 'vpoor') {
        activateRiskBadge('economic_fragile');
    }

    // Read social data
    const socialRisks = bmBadges('bm-social-risks');
    if (socialRisks.includes('domestic_violence') || socialRisks.includes('neglect') || socialRisks.includes('harassment')) {
        activateRiskBadge('family_issues');
    }

    // Read health/psych data
    const psychSymptoms = bmBadges('bm-psych-symptoms');
    if (psychSymptoms.length >= 2) {
        activateRiskBadge('psych_symptoms');
    }

    const healthGen = bmRadio('bm-health-gen');
    const learningDisorders = bmBadges('bm-learning-disorders');
    if (healthGen === 'bad' || learningDisorders.length >= 2) {
        activateRiskBadge('health_issues');
    }

    // Recalculate risk score
    if (typeof bmUpdateRisk === 'function') bmUpdateRisk();
}

function activateRiskBadge(dataValue) {
    const badge = document.querySelector(`#tab-risk .bm-badge[data-value="${dataValue}"]`);
    if (badge && badge.classList.contains('bm-badge-off')) {
        // Color comes from the declarative data-color attribute (H2/R9), with
        // an 'amber' fallback (the prior default for risk badges).
        const color = badge.dataset.color || 'amber';
        badge.className = 'bm-badge bm-badge-' + color;
        badge.setAttribute('aria-checked', 'true');
    }
}

// ── Dropout-Risk Tab Renderer ──
// Gathers the real grades/absence/profile signals and runs the pure two-layer
// engine in js/student-risk.js (per .kiro/مؤشر_الخطر_دليل_الحساب.md), then
// paints the gauge, the per-axis breakdown and the recommendation. Exposed as
// window.renderStudentRiskTab so the inline bmUpdateRisk() wrapper, the badge
// onclick handlers and the scale handlers all route here.

const _RISK_LEVEL_SOLID = ['var(--color-success-solid)', 'var(--color-warning-solid)', 'var(--color-danger-solid)'];
const _RISK_LEVEL_TEXT = ['var(--color-success-text)', 'var(--color-warning-text)', 'var(--color-danger-text)'];

// ── Risk snapshot persistence (H3/R7) ──
// Persists the computed dropout-risk score/level into student_risk_snapshot
// (keyed by student_code + school_year). Debounced so rapid edits collapse
// into a single write, deduped so identical values are not re-sent, and fails
// silently (console.error) so a write error never blocks the UI.
let _riskSnapshotTimer = null;
let _lastRiskSnapshot = null;

function persistRiskSnapshot(score, level) {
    if (!_currentStudentCode) return;
    if (score == null) return;
    if (!window.api?.studentProfile?.saveRiskSnapshot) return;

    const snapshotKey = `${score}|${level}`;
    if (snapshotKey === _lastRiskSnapshot) return; // unchanged → skip the write

    clearTimeout(_riskSnapshotTimer);
    _riskSnapshotTimer = setTimeout(() => {
        _lastRiskSnapshot = snapshotKey;
        window.api.studentProfile
            .saveRiskSnapshot({
                student_id: _currentStudentId,
                student_code: _currentStudentCode,
                risk_score: score,
                risk_level: level,
                school_year: SCHOOL_YEAR
            })
            .catch((err) => {
                // Allow a later edit with the same values to retry the write.
                _lastRiskSnapshot = null;
                console.error('Save risk snapshot error:', err);
            });
    }, 800);
}

function collectRiskInputs() {
    const eco = typeof collectEconomicData === 'function' ? collectEconomicData() : {};
    const social = typeof collectSocialData === 'function' ? collectSocialData() : {};
    const health = typeof collectHealthData === 'function' ? collectHealthData() : {};

    const distance = Number(eco.distance_km);

    return {
        generalAverage: _riskState.generalAverage,
        subjectAverages: _riskState.subjectAverages,
        justifiedHours: _riskState.justifiedHours,
        unjustifiedHours: _riskState.unjustifiedHours,
        // disciplinePenalties / scheduledHours are not tracked yet → left undefined
        social: {
            risks: social.social_risks || [],
            familyStatus: social.family_status,
            distanceKm: isFinite(distance) ? distance : null
        },
        economic: {
            status: eco.eco_status,
            supportPrograms: eco.support_programs || [],
            unmetNeeds: eco.unmet_needs || [],
            incomeSource: eco.income_source
        },
        health: {
            healthGen: health.health_gen,
            disability: health.disability,
            learningDisorders: health.learning_disorders || [],
            psychSymptoms: health.psych_symptoms || [],
            substances: health.substances || [],
            treatment: health.treatment,
            psychSupport: health.psych_support,
            psychReferral: health.psych_referral
        },
        // NEW: BM Tab_Scores attached for the axis-summary card (Req 6.3).
        // Not consumed by computeStudentRisk() — backward compatible.
        bmScores: {
            economic: _bmScoreState.economic?.score ?? null,
            social:   _bmScoreState.social?.score   ?? null,
            health:   _bmScoreState.health?.score   ?? null,
            followup: _bmScoreState.followup?.score ?? null
        }
    };
}

function renderStudentRiskTab() {
    if (typeof window.computeStudentRisk !== 'function') return;

    const result = window.computeStudentRisk(collectRiskInputs());
    const { layer1, layer2, final } = result;

    // Persist the computed dropout-risk snapshot (H3/R7). Debounced + guarded
    // internally so it never fires on every keystroke and never blocks the UI.
    persistRiskSnapshot(final.score, final.label);

    const bar = document.getElementById('bm-risk-bar');
    const lbl = document.getElementById('bm-risk-main-lbl');
    const rec = document.getElementById('bm-recommendation');
    const breakdown = document.getElementById('bm-axis-breakdown');
    if (!bar || !lbl) return;

    const solid = _RISK_LEVEL_SOLID[final.level] || 'var(--color-accent)';

    // Gauge.
    bar.style.width = final.score + '%';
    bar.style.background = solid;
    lbl.style.color = _RISK_LEVEL_TEXT[final.level] || 'var(--color-text)';
    lbl.textContent = final.label + ' — ' + final.score + '%';

    // Per-axis breakdown rows (reuses the .bm-progress-* styles).
    if (breakdown) {
        breakdown.innerHTML = layer2 && layer2.axes
            ? Object.keys(layer2.axes)
                  .map((key) => {
                      const axis = layer2.axes[key];
                      const meta = layer1.criteria.find((c) => c.key === key) || {};
                      const axColor = _RISK_LEVEL_SOLID[axis.level] || 'var(--color-accent)';
                      const weightPct = Math.round((axis.weight || 0) * 100);
                      const levelLbl = axis.level != null ? (window.GS2?.StudentRisk?.LEVEL_LABEL[axis.level] || '') : '—';
                      return `
                        <div class="bm-progress-row" title="${escapeHtml(meta.detail || '')}">
                            <span class="bm-progress-lbl">${escapeHtml(meta.label || key)} <small style="color:var(--color-text-light)">(${weightPct}%)</small></span>
                            <div class="bm-progress-bg"><div class="bm-progress-fill" style="width:${axis.score}%;background:${axColor}"></div></div>
                            <span style="font-size:11px;min-width:64px;text-align:start;color:var(--color-text-muted)">${Math.round(axis.score)} · ${levelLbl}</span>
                        </div>`;
                  })
                  .join('')
            : '';
    }

    // Recommendation. The worst-wins axis attribution is no longer inlined here;
    // it is promoted to a prominent on-gauge badge (see below) so the gauge and
    // its label never read as a self-contradiction.
    if (rec) {
        rec.style.borderInlineEndColor = solid;
        rec.textContent = result.recommendation;
    }

    // ── Bug 2 display-only fix — color by final level, separate composite/axis
    // facts, triggering-axis badge, preliminary marker. The pure engine
    // (js/student-risk.js) is untouched: the gauge is colored strictly by
    // `final.level` (see `solid` above) while `layer2.composite` and the highest
    // axis are surfaced as SEPARATE, non-contradictory facts. A worst-wins
    // escalation therefore never looks like an error.
    const LEVEL_LABEL = (window.GS2 && window.GS2.StudentRisk && window.GS2.StudentRisk.LEVEL_LABEL)
        || ['عادي', 'خطر', 'حرج'];

    // Composite index + highest axis as distinct, labeled facts.
    const facts = document.getElementById('bm-risk-facts');
    if (facts) {
        facts.innerHTML =
            `<span class="bm-risk-fact">المؤشر المركّب = ${layer2.composite}%</span>` +
            `<span class="bm-risk-fact">أعلى محور = ${escapeHtml(LEVEL_LABEL[layer1.level] || '—')}</span>`;
    }

    // Triggering-axis badge — shown only when a single axis (worst-wins) escalates
    // the file above the composite zone.
    const badge = document.getElementById('bm-risk-badge');
    if (badge) {
        if (layer1.level > layer2.level) {
            const triggering = layer1.criteria
                .filter((c) => c.level === layer1.level)
                .map((c) => c.label)
                .join('، ');
            badge.style.display = '';
            badge.style.background = solid;
            badge.style.color = _RISK_LEVEL_TEXT[final.level] || 'var(--color-text)';
            badge.textContent = `صُنّف «${final.label}» بسبب محور: ${triggering}`;
        } else {
            badge.style.display = 'none';
            badge.textContent = '';
        }
    }

    // Preliminary marker — the index is computed on available data only while the
    // year is in progress (a term with no entered marks).
    const prelim = document.getElementById('bm-risk-prelim');
    if (prelim) {
        if (_riskState && _riskState.dataIncomplete) {
            prelim.style.display = '';
            prelim.textContent = 'أولي / قيد الإنجاز';
        } else {
            prelim.style.display = 'none';
            prelim.textContent = '';
        }
    }

    // ── Axis Summary Card (Req 6.3) ───────────────────────────────────────
    // Inject the card container once; re-render its rows on every call.
    // Shows economic, social, health only — followup excluded (social worker).
    const AXIS_LABELS = {
        economic: 'الجانب الاقتصادي',
        social:   'الجانب الاجتماعي',
        health:   'الجانب الصحي والنفسي'
    };
    const BM_LEVEL_COLOR = {
        'منخفض': 'var(--color-success-solid)',
        'متوسط': 'var(--color-warning-solid)',
        'مرتفع': 'var(--color-danger-solid)'
    };

    const riskTab = document.getElementById('tab-risk');
    if (riskTab && !document.getElementById('bm-axis-summary-card')) {
        riskTab.insertAdjacentHTML('beforeend',
            '<div id="bm-axis-summary-card" class="bm-axis-summary-card" style="display:none">' +
                '<h4 class="sp-section-title"><i class="fas fa-chart-bar"></i> ملخص مؤشرات المحاور</h4>' +
                '<div id="bm-axis-summary-rows"></div>' +
            '</div>'
        );
    }

    const summaryCard = document.getElementById('bm-axis-summary-card');
    if (summaryCard) {
        const inputs = collectRiskInputs();
        const bm = inputs.bmScores || {};
        const keys = ['economic', 'social', 'health'];
        const allNonNull = keys.every(k => bm[k] !== null && bm[k] !== undefined);

        summaryCard.style.display = allNonNull ? 'block' : 'none';

        if (allNonNull) {
            const rowsEl = document.getElementById('bm-axis-summary-rows');
            if (rowsEl) {
                const levelLabel = (score) => {
                    if (score < 40) return 'منخفض';
                    if (score < 70) return 'متوسط';
                    return 'مرتفع';
                };
                rowsEl.innerHTML = keys.map(k => {
                    const score = Math.round(bm[k]);
                    const level = levelLabel(score);
                    const color = BM_LEVEL_COLOR[level] || 'var(--color-accent)';
                    return `<div class="bm-progress-row">` +
                        `<span class="bm-progress-lbl">${AXIS_LABELS[k]}</span>` +
                        `<div class="bm-progress-bg">` +
                            `<div class="bm-progress-fill" style="width:${score}%;background:${color}"></div>` +
                        `</div>` +
                        `<span style="font-size:11px;min-width:64px;text-align:start;color:${color}">${level} — %${score}</span>` +
                    `</div>`;
                }).join('');
            }
        }
    }
    // ─────────────────────────────────────────────────────────────────────────
}

// Expose for the inline bmUpdateRisk() wrapper and event handlers.
if (typeof window !== 'undefined') {
    window.renderStudentRiskTab = renderStudentRiskTab;
}

// ── Score_Widget Injection ──

/**
 * Injects a Score_Widget at the top of each BM tab panel (economic, social, health only).
 * The followup tab is excluded — it belongs to the social worker.
 * Called once at DOMContentLoaded, before initBmScoring().
 */
function injectScoreWidgets() {
    const TAB_LABELS = {
        economic: 'مؤشر الجانب الاقتصادي',
        social:   'مؤشر الجانب الاجتماعي',
        health:   'مؤشر الجانب الصحي والنفسي'
    };

    Object.entries(TAB_LABELS).forEach(([key, label]) => {
        const panel = document.getElementById('tab-' + key);
        if (!panel) return;

        // Widget layout mirrors the existing risk indicator style:
        // • Title row: dot + label name (top)
        // • Bar row: level+percentage on the left, full-width bar (RTL)
        const html = `<div id="bm-score-widget-${key}" class="bm-score-widget" role="status" aria-live="polite" aria-label="${label}: غير محسوب" style="margin-bottom:12px">
  <div class="bm-sec-title" style="margin-bottom:4px">
    <span class="bm-dot" id="bm-score-dot-${key}" style="background:var(--color-border)"></span>
    ${label}
  </div>
  <div class="bm-risk-wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span id="bm-score-val-${key}" style="font-size:13px;font-weight:500;color:var(--color-text-muted)">—</span>
      <span id="bm-score-badge-${key}" style="font-size:12px;color:var(--color-text-muted)"></span>
    </div>
    <div class="bm-risk-bar-bg">
      <div id="bm-score-bar-${key}" class="bm-risk-bar-fill" style="width:0%;background:var(--color-border);transition:width 0.3s ease,background 0.3s ease"></div>
    </div>
  </div>
</div>`;

        panel.insertAdjacentHTML('afterbegin', html);
    });
}

// ── Score_Widget Renderer ──

/**
 * Updates the Score_Widget for a given axis key with a TabScoreResult.
 * Only handles economic, social, health — followup has no widget.
 * @param {'economic'|'social'|'health'} key
 * @param {{ score: number|null, level: string|null, subScores: object }|null} result
 */
function updateScoreWidget(key, result) {
    // Followup tab has no widget — skip silently
    if (key === 'followup') return;

    const AXIS_NAMES = {
        economic: 'الجانب الاقتصادي',
        social:   'الجانب الاجتماعي',
        health:   'الجانب الصحي والنفسي'
    };

    const COLOR_MAP = {
        'منخفض': 'var(--color-success-solid)',
        'متوسط': 'var(--color-warning-solid)',
        'مرتفع': 'var(--color-danger-solid)'
    };

    const container = document.getElementById('bm-score-widget-' + key);
    const valEl     = document.getElementById('bm-score-val-' + key);
    const barEl     = document.getElementById('bm-score-bar-' + key);
    const badgeEl   = document.getElementById('bm-score-badge-' + key);
    const dotEl     = document.getElementById('bm-score-dot-' + key);

    // Guard: return silently if any element is missing
    if (!container || !valEl || !barEl || !badgeEl) return;

    const axisName = AXIS_NAMES[key] || key;
    const score = result && result.score != null ? result.score : null;

    if (score === null) {
        // Null / not-computed state
        valEl.textContent      = '—';
        valEl.style.color      = 'var(--color-text-muted)';
        barEl.style.width      = '0%';
        barEl.style.background = 'var(--color-border)';
        badgeEl.textContent    = '';
        if (dotEl) dotEl.style.background = 'var(--color-border)';
        container.setAttribute('aria-label', 'مؤشر ' + axisName + ': غير محسوب');
    } else {
        // Non-null state
        const clamped = Math.min(100, Math.max(0, score));
        const level   = result.level || '';
        const color   = COLOR_MAP[level] || 'var(--color-accent)';

        // Left side: "مرتفع — %47" style (mirrors the risk indicator)
        valEl.textContent      = level + ' — %' + clamped;
        valEl.style.color      = color;
        barEl.style.width      = clamped + '%';
        barEl.style.background = color;
        badgeEl.textContent    = '';  // no separate badge — info is in valEl
        if (dotEl) dotEl.style.background = color;
        container.setAttribute('aria-label',
            'مؤشر ' + axisName + ': ' + clamped + ' من 100 — ' + level);
    }
}

// ── BM Scoring Wiring ──

/**
 * Wires live event listeners on each BM tab to trigger score recomputation.
 * Uses a 500 ms debounce per tab; score display updates after an additional 200 ms.
 * Called once at DOMContentLoaded, after injectScoreWidgets().
 * Requirements: 1.3, 2.3, 3.3, 4.3, 7.4
 */
function initBmScoring() {
    if (!window.GS2?.BmScoring) return;  // graceful degradation

    const { computeEconomicScore, computeSocialScore, computeHealthScore, computeFollowupScore } = window.GS2.BmScoring;

    const tabMapping = {
        'tab-economic': { key: 'economic', scorer: computeEconomicScore, collector: collectEconomicData },
        'tab-social':   { key: 'social',   scorer: computeSocialScore,   collector: collectSocialData   },
        'tab-health':   { key: 'health',   scorer: computeHealthScore,   collector: collectHealthData   }
        // followup tab excluded — belongs to the social worker, no widget
    };

    const timers = {};  // debounce timer handles, one per tab key

    Object.entries(tabMapping).forEach(([tabId, { key, scorer, collector }]) => {
        const tabEl = document.getElementById(tabId);
        if (!tabEl) return;

        const handler = () => {
            clearTimeout(timers[key]);
            timers[key] = setTimeout(() => {
                const result = scorer(collector());
                _bmScoreState[key] = result;
                // Display update after additional 200ms
                setTimeout(() => updateScoreWidget(key, result), 200);
                renderStudentRiskTab();
            }, 500);
        };

        tabEl.addEventListener('change', handler);
        tabEl.addEventListener('input', handler);
        tabEl.addEventListener('click', (e) => {
            if (e.target.closest('.bm-badge') || e.target.closest('.bm-scale-btn')) {
                handler();
            }
        });
    });
}

/**
 * Recomputes scores for all four BM axes and updates their Score_Widgets.
 * Called after loading tab data from the database via loadAllProfileTabs().
 * Requirement: 7.5
 */
function updateAllScoreWidgets() {
    if (!window.GS2?.BmScoring) return;
    const { computeEconomicScore, computeSocialScore, computeHealthScore, computeFollowupScore } = window.GS2.BmScoring;
    _bmScoreState.economic = computeEconomicScore(collectEconomicData());
    _bmScoreState.social   = computeSocialScore(collectSocialData());
    _bmScoreState.health   = computeHealthScore(collectHealthData());
    _bmScoreState.followup = computeFollowupScore(collectFollowupData()); // still computed for risk engine, no widget
    ['economic', 'social', 'health'].forEach(key => {
        updateScoreWidget(key, _bmScoreState[key]);
    });
}

// ── Dirty Tracking ──

function initDirtyTracking() {
    const tabMapping = {
        'tab-economic': 'economic',
        'tab-social': 'social',
        'tab-health': 'health',
        'tab-followup': 'followup'
    };

    Object.entries(tabMapping).forEach(([tabId, tabKey]) => {
        const tabEl = document.getElementById(tabId);
        if (!tabEl) return;

        tabEl.addEventListener('change', () => _dirtyTabs.add(tabKey));
        tabEl.addEventListener('input', (e) => {
            if (e.target.matches('input, textarea')) _dirtyTabs.add(tabKey);
        });
        // Badge clicks
        tabEl.addEventListener('click', (e) => {
            if (e.target.closest('.bm-badge')) _dirtyTabs.add(tabKey);
        });
    });
}

function initUnsavedWarning() {
    const tabBtns = document.querySelectorAll('.sp-tab-btn');
    const tabMapping = {
        'tab-economic': 'economic',
        'tab-social': 'social',
        'tab-health': 'health',
        'tab-followup': 'followup'
    };

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Check if current active tab has unsaved changes
            const activePanel = document.querySelector('.sp-tab-content.active');
            if (activePanel) {
                const currentTabKey = tabMapping[activePanel.id];
                if (currentTabKey && _dirtyTabs.has(currentTabKey)) {
                    if (typeof showToast === 'function') {
                        showToast('⚠️ يوجد تغييرات غير محفوظة في التبويب السابق', 'warning');
                    }
                }
            }
        });
    });
}

// ── Initialize Save Buttons ──

function initSaveButtons() {
    ALL_TAB_KEYS.forEach(tabKey => {
        const btn = document.getElementById('bm-save-' + tabKey);
        if (btn) {
            btn.innerHTML = '<i class="fas fa-save"></i> حفظ جميع البيانات';
            btn.addEventListener('click', () => saveAllTabs());
        }
    });
}

// ── Save bar CSS (injected) ──
(function injectSaveBarStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .bm-save-bar {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid var(--color-border, rgba(0,0,0,0.08));
        }
        .bm-save-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            font-weight: 600;
            padding: 10px 24px;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .bm-save-btn:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .bm-save-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .bm-last-saved {
            font-size: 12px;
            color: var(--color-text-muted, #888);
            display: flex;
            align-items: center;
            gap: 6px;
        }
    `;
    document.head.appendChild(style);
})();

// ═══════════════════════════════════════════════════════════════
// ── Header Actions (back + print preview) ──
// The shared unified header (utils.js → setupUnifiedHeader) rebuilds .header
// on load and removes the page's own buttons, then moves the title into a
// generated .page-title-row. We attach our actions there so they survive and
// stay visible next to the page title. Falls back to the static header buttons
// if the unified header is not present.
// ═══════════════════════════════════════════════════════════════
function setupHeaderActions() {
    const openPreview = () => {
        buildStudentPrintSheet();
        PrintSystem.preview({
            contentSelector: '#sp-export-sheet',
            title: 'ملف التلميذ',
            pageSize: 'A4'
        });
    };
    // Blank "بطاقة التتبع": prints only the four follow-up form tabs
    // (economic/social/health/follow-up) as an empty, hand-fillable form so a
    // counselor can complete it on paper and digitize it later.
    const openBlankCard = () => {
        buildBlankTrackingSheet();
        PrintSystem.preview({
            contentSelector: '#sp-blank-sheet',
            title: 'بطاقة التتبع',
            pageSize: 'A4'
        });
    };
    const goBack = () => {
        window.location.href = 'students-list.html';
    };

    // Fallback: wire the original header buttons if they still exist.
    document.getElementById('sp-print-btn')?.addEventListener('click', openPreview);
    document.getElementById('sp-blank-card-btn')?.addEventListener('click', openBlankCard);
    document.getElementById('sp-back-btn')?.addEventListener('click', goBack);

    const attach = () => {
        if (document.getElementById('sp-print-btn-row')) return true; // already added
        const titleRow =
            document.querySelector('.main-content > .page-title-row') ||
            document.querySelector('.page-title-row');
        if (!titleRow) return false; // unified header not ready yet → retry

        // Lay the title and actions on opposite ends of the row.
        titleRow.style.display = 'flex';
        titleRow.style.alignItems = 'center';
        titleRow.style.justifyContent = 'space-between';
        titleRow.style.gap = '10px';
        titleRow.style.flexWrap = 'wrap';

        const actions = document.createElement('div');
        actions.className = 'sp-header-actions';
        actions.innerHTML =
            '<button class="btn btn-secondary" id="sp-back-btn-row" title="العودة للائحة التلاميذ"><i class="fas fa-arrow-right"></i> العودة</button>' +
            '<button class="btn btn-secondary" id="sp-blank-card-btn-row" title="طباعة بطاقة تتبع فارغة لتعبئتها يدوياً"><i class="fas fa-clipboard-list"></i> بطاقة تتبع فارغة</button>' +
            '<button class="btn btn-primary" id="sp-print-btn-row" title="معاينة وطباعة ملف التلميذ"><i class="fas fa-print"></i> معاينة الطباعة</button>';
        titleRow.appendChild(actions);

        document.getElementById('sp-print-btn-row')?.addEventListener('click', openPreview);
        document.getElementById('sp-blank-card-btn-row')?.addEventListener('click', openBlankCard);
        document.getElementById('sp-back-btn-row')?.addEventListener('click', goBack);
        return true;
    };

    // The unified header normally runs first, but retry briefly in case it
    // hasn't rebuilt the header yet.
    if (!attach()) {
        let tries = 0;
        const timer = setInterval(() => {
            if (attach() || ++tries > 20) clearInterval(timer);
        }, 50);
    }
}


// Builds a single, vertically-stacked document of every tab so the shared
// PrintSystem can preview/print it. Display tabs (grades/absence/risk) are
// cloned as-is; the form tabs (economic/social/health/followup) are flattened
// into clean label→value summaries (no raw radios/checkboxes/textareas).
// ═══════════════════════════════════════════════════════════════

// One-time stylesheet for the print sheet (available in both the preview modal
// and the print root since they live in the same document).
(function injectPrintSheetStyles() {
    if (document.getElementById('sp-print-sheet-styles')) return;
    const style = document.createElement('style');
    style.id = 'sp-print-sheet-styles';
    style.textContent = `
        .sp-export-sheet { color:#1f2937 !important; font-size:12px !important; line-height:1.5 !important; }
        .sp-export-sheet, .sp-export-sheet * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; box-sizing:border-box; }
        .sp-export-sheet, .sp-export-sheet * { max-width:100% !important; }
        /* Identity block: stacked and centered under the "ملف التلميذ" title. */
        .sp-pr-head { display:flex !important; flex-direction:column; align-items:center; text-align:center; gap:9px; margin-bottom:18px; padding-bottom:14px; border-bottom:2px solid #2563eb; break-inside:avoid; page-break-inside:avoid; }
        .sp-pr-avatar { width:54px !important; height:54px !important; min-width:54px; border-radius:50%; background:#2563eb; color:#fff; display:flex !important; align-items:center; justify-content:center; font-size:22px; font-weight:700; flex-shrink:0; }
        .sp-pr-name { font-size:18px; font-weight:800; color:#111827; }
        .sp-pr-meta { display:flex !important; flex-wrap:wrap; justify-content:center; gap:14px; font-size:12px; color:#6b7280; margin-top:4px; }
        .sp-pr-meta i { color:#2563eb; margin-inline-end:4px; }
        /* Let sections flow across pages so the first page isn't left half-empty;
           inner cards/rows keep their own break-inside guards. */
        .sp-pr-sec { margin-bottom:16px !important; }
        .sp-pr-sec-h { display:flex !important; align-items:center; gap:8px; font-size:14px; font-weight:700; color:#1f2937; border-bottom:2px solid var(--sp-accent,#2563eb); padding-bottom:6px; margin:0 0 10px !important; break-after:avoid; page-break-after:avoid; }
        .sp-pr-sec-h i { color:var(--sp-accent,#2563eb); }
        /* Accent subsection header: small caps label with a leading accent rule. */
        .sp-pr-sub { display:flex !important; align-items:center; gap:7px; font-size:12px; font-weight:700; color:var(--sp-accent,#374151); margin:14px 0 9px !important; padding-inline-start:9px; border-inline-start:3px solid var(--sp-accent,#cbd5e1); break-after:avoid; page-break-after:avoid; }
        /* Legacy two-column rows — still used by the risk section. */
        .sp-pr-grid { display:grid !important; grid-template-columns:minmax(0,1fr) minmax(0,1fr) !important; gap:2px 24px !important; }
        .sp-pr-row { display:flex !important; justify-content:space-between; gap:10px; padding:4px 0; border-bottom:1px dotted #e5e7eb; break-inside:avoid; page-break-inside:avoid; min-width:0 !important; }
        .sp-pr-row-block { flex-direction:column !important; align-items:stretch; grid-column:1 / -1 !important; }
        .sp-pr-lbl { color:#6b7280; min-width:0; overflow-wrap:anywhere; }
        .sp-pr-val { color:#111827; font-weight:600; text-align:left; min-width:0; overflow-wrap:anywhere; }
        /* Info-tile grid — matches the on-screen quick-stat / KPI card language. */
        .sp-pr-tiles { display:grid !important; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)) !important; gap:8px !important; margin-bottom:4px; }
        .sp-pr-tile { background:#f9fafb !important; border:1px solid #e5e7eb; border-radius:8px; padding:8px 11px; break-inside:avoid; page-break-inside:avoid; min-width:0; }
        .sp-pr-tile-lbl { font-size:10.5px; color:#6b7280; margin-bottom:4px; overflow-wrap:anywhere; line-height:1.3; }
        .sp-pr-tile-val { font-size:13px; font-weight:700; color:#111827; overflow-wrap:anywhere; line-height:1.35; }
        .sp-pr-tile-val.is-danger { color:#dc2626; }
        .sp-pr-tile-val.is-warn { color:#d97706; }
        .sp-pr-tile-val.is-ok { color:#16a34a; }
        /* Full-width blocks for chip groups and free-text notes inside the tile grid. */
        .sp-pr-block { grid-column:1 / -1; }
        .sp-pr-block-lbl { font-size:11px; font-weight:600; color:#6b7280; margin-bottom:6px; }
        .sp-pr-chips { display:flex !important; flex-wrap:wrap; gap:6px; margin-top:2px; }
        .sp-pr-chip { background:color-mix(in srgb, var(--sp-accent,#2563eb) 10%, #fff) !important; color:var(--sp-accent,#1d4ed8) !important; border:1px solid color-mix(in srgb, var(--sp-accent,#2563eb) 28%, #fff); border-radius:999px; padding:3px 11px; font-size:11px; font-weight:600; }
        .sp-pr-note { background:#f9fafb !important; border:1px solid #e5e7eb; border-inline-start:3px solid var(--sp-accent,#cbd5e1); border-radius:6px; padding:8px 10px; margin-top:2px; white-space:pre-wrap; color:#111827; line-height:1.5; }
        .sp-pr-empty { color:#9ca3af; font-style:italic; padding:6px 0; }
        /* Keep cloned tab cards intact across page breaks */
        .sp-export-sheet .sp-kpi, .sp-export-sheet .sp-subject-block, .sp-export-sheet .sp-absence-record,
        .sp-export-sheet .sp-chart-row, .sp-export-sheet .bm-progress-row, .sp-export-sheet tr { break-inside:avoid; page-break-inside:avoid; }
        .sp-export-sheet table { width:100% !important; }
        /* PDF/print only: the shared sheet is a fixed 210mm with overflow:hidden,
           which is wider than the printable area and clips the (RTL) left edge.
           Make it fit the page width so nothing is cut. */
        body.ux-printing-active #ux-print-root .ux-pp-sheet {
            width:100% !important;
            min-height:0 !important;
            padding:6mm !important;
            overflow:visible !important;
        }
    `;
    document.head.appendChild(style);
})();

// Escape helper (falls back if the shared one is unavailable).
function _spEsc(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(s == null ? '' : s));
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}

// Map a (human-readable) value to a severity tone, mirroring the app's risk
// color language so a counselor scanning the print can spot concerns at a
// glance. Conservative: unknown values stay neutral (no class).
function _spValueTone(text) {
    const t = String(text || '');
    const danger = ['ضعيفة', 'ضعيف', 'متوترة', 'سيء جدًا', 'سيء', 'سيئة', 'فقر مدقع', 'هشة', 'هش', 'غير لائقة', 'مطلقون', 'أرملة', 'أرمل', 'غائب', 'بدون تعليم', 'بدون دخل', 'غير كافية', 'غير كافٍ', 'منخفض جدًا', 'معدومة'];
    const warn = ['متوسطة', 'متوسط', 'عادية', 'عادي', 'أحياناً', 'مكتظة', 'غير منتظم', 'متقطع', 'ابتدائي'];
    const ok = ['جيدة', 'جيد', 'ممتاز', 'ميسور', 'كافٍ', 'كافية', 'عالٍ', 'عالية', 'مكتملة', 'ملائمة', 'مرتفع'];
    if (danger.some((w) => t.includes(w))) return 'is-danger';
    if (warn.some((w) => t.includes(w))) return 'is-warn';
    if (ok.some((w) => t.includes(w))) return 'is-ok';
    return '';
}

// Render a flat list of { label, type, html?, chips? } rows as a tile grid that
// matches the on-screen quick-stat card language. Inline values become tiles;
// chip groups and notes span the full width.
function _spRenderRows(rows) {
    if (!rows.length) return '<div class="sp-pr-empty">لا توجد بيانات مسجلة</div>';
    return (
        '<div class="sp-pr-tiles">' +
        rows
            .map((r) => {
                if (r.type === 'chips') {
                    const chips = r.chips.map((c) => `<span class="sp-pr-chip">${c}</span>`).join('');
                    return `<div class="sp-pr-block">${r.label ? `<div class="sp-pr-block-lbl">${_spEsc(r.label)}</div>` : ''}<div class="sp-pr-chips">${chips}</div></div>`;
                }
                if (r.type === 'note') {
                    return `<div class="sp-pr-block"><div class="sp-pr-block-lbl">${_spEsc(r.label)}</div><div class="sp-pr-note">${r.html}</div></div>`;
                }
                const tone = _spValueTone(r.html);
                return `<div class="sp-pr-tile"><div class="sp-pr-tile-lbl">${_spEsc(r.label)}</div><div class="sp-pr-tile-val${tone ? ' ' + tone : ''}">${r.html}</div></div>`;
            })
            .join('') +
        '</div>'
    );
}

// Resolve the human-readable text of a radio/checkbox option. Reads the text
// that follows the input (handles `<label><input> نص</label>` and bare
// `<input> نص`), falling back to a wrapping/associated label, then the value.
function _spOptionLabel(input) {
    let txt = '';
    let n = input.nextSibling;
    while (n && !(n.nodeType === 1 && (n.tagName === 'INPUT' || n.tagName === 'LABEL'))) {
        txt += n.textContent || '';
        n = n.nextSibling;
    }
    txt = txt.replace(/\s+/g, ' ').trim();
    if (txt) return txt;

    const lbl = input.closest('label');
    if (lbl) {
        const lt = lbl.textContent.replace(/\s+/g, ' ').trim();
        if (lt) return lt;
    }
    if (input.id) {
        const f = document.querySelector('label[for="' + input.id + '"]');
        if (f) {
            const ft = f.textContent.replace(/\s+/g, ' ').trim();
            if (ft) return ft;
        }
    }
    return input.value;
}

// Extract a readable value from the control element associated with a label.
function _spControlValue(ctrl) {
    if (!ctrl) return null;
    const tag = ctrl.tagName;

    if (tag === 'TEXTAREA') {
        const v = (ctrl.value || '').trim();
        return v ? { type: 'note', html: _spEsc(v) } : null;
    }
    if (tag === 'INPUT') {
        const v = (ctrl.value || '').trim();
        return v ? { type: 'inline', html: _spEsc(v) } : null;
    }

    // Radio group → selected option's label text
    const radio = ctrl.querySelector && ctrl.querySelector('input[type="radio"]:checked');
    if (radio) {
        return { type: 'inline', html: _spEsc(_spOptionLabel(radio)) };
    }

    // Checkbox group → list of checked labels
    const checks = ctrl.querySelectorAll ? ctrl.querySelectorAll('input[type="checkbox"]:checked') : [];
    if (checks.length) {
        return {
            type: 'chips',
            chips: Array.from(checks).map((c) => _spEsc(_spOptionLabel(c)))
        };
    }

    // Badge group → active badges
    const badges = ctrl.querySelectorAll ? ctrl.querySelectorAll('.bm-badge:not(.bm-badge-off)') : [];
    if (badges.length) {
        return { type: 'chips', chips: Array.from(badges).map((b) => _spEsc(b.textContent.trim())) };
    }

    // Scale row → selected number + its descriptive label
    if (ctrl.classList && ctrl.classList.contains('bm-scale-row')) {
        const sel = ctrl.querySelector('.bm-sel-scale');
        if (!sel) return null;
        const lblSpan = ctrl.querySelector('span[id$="-lbl"]');
        const extra = lblSpan ? lblSpan.textContent.replace('←', '').trim() : '';
        return { type: 'inline', html: _spEsc(sel.textContent.trim() + (extra ? ' / ' + extra : '')) };
    }

    // Nested single input/textarea fallback (text/number/date only — never
    // radios/checkboxes, otherwise an unselected group would wrongly surface
    // its first option's value).
    const inner = ctrl.querySelector && ctrl.querySelector('input:not([type="radio"]):not([type="checkbox"]), textarea');
    if (inner) {
        const v = (inner.value || '').trim();
        return v ? { type: 'inline', html: _spEsc(v) } : null;
    }
    return null;
}

// Does an element directly hold badges (and no field labels)? Used to capture
// badge groups that follow a section title without their own .bm-sub-lbl.
function _spIsBadgeContainer(el) {
    return !!(el && el.querySelector && el.querySelector('.bm-badge') && !el.querySelector('.bm-sub-lbl'));
}

// Flatten a form tab panel into readable section/row HTML.
function _spSummarizePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return '<div class="sp-pr-empty">لا توجد بيانات مسجلة</div>';

    const nodes = panel.querySelectorAll('.bm-sec-title, .bm-sub-lbl, .bm-mc-lbl');
    const sections = [];
    let cur = null;
    const ensure = () => {
        if (!cur) {
            cur = { title: '', rows: [] };
            sections.push(cur);
        }
        return cur;
    };

    nodes.forEach((node) => {
        if (node.closest('.bm-score-widget') || node.closest('.bm-save-bar')) return;

        if (node.classList.contains('bm-sec-title')) {
            cur = { title: node.textContent.trim(), rows: [] };
            sections.push(cur);
            // A badge group may directly follow the section title (no label).
            const sib = node.nextElementSibling;
            if (_spIsBadgeContainer(sib)) {
                const v = _spControlValue(sib);
                if (v) cur.rows.push({ label: '', ...v });
            }
            return;
        }

        // Field label → pair with its control (next sibling).
        const v = _spControlValue(node.nextElementSibling);
        if (v) ensure().rows.push({ label: node.textContent.trim(), ...v });
    });

    const withRows = sections.filter((s) => s.rows.length);
    if (!withRows.length) return '<div class="sp-pr-empty">لا توجد بيانات مسجلة</div>';

    return withRows
        .map((s) => (s.title ? `<div class="sp-pr-sub">${_spEsc(s.title)}</div>` : '') + _spRenderRows(s.rows))
        .join('');
}

// Clone rendered display content, stripping ids and interactive controls.
function _spCloneDisplay(srcEl) {
    if (!srcEl) return '';
    const tmp = srcEl.cloneNode(true);
    tmp.querySelectorAll('button, .bm-save-bar, .bm-score-widget, script, .fa-spinner').forEach((e) => e.remove());
    tmp.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    return tmp.innerHTML.trim();
}

// Build a titled section wrapper.
function _spSection(icon, title, accent, innerHTML) {
    return (
        `<section class="sp-pr-sec" style="--sp-accent:${accent}">` +
        `<h3 class="sp-pr-sec-h"><i class="fas ${icon}"></i> ${_spEsc(title)}</h3>` +
        (innerHTML || '<div class="sp-pr-empty">لا توجد بيانات</div>') +
        `</section>`
    );
}

// Build the risk section from the live, computed risk DOM.
function _spRiskSection() {
    const lbl = document.getElementById('bm-risk-main-lbl')?.textContent.trim() || '—';
    const bar = document.getElementById('bm-risk-bar');
    const width = bar?.style.width || '0%';
    const color = bar?.style.background || '#9ca3af';
    const breakdown = document.getElementById('bm-axis-breakdown')?.innerHTML || '';
    const summaryCard = document.getElementById('bm-axis-summary-card');
    const summary =
        summaryCard && summaryCard.style.display !== 'none'
            ? document.getElementById('bm-axis-summary-rows')?.innerHTML || ''
            : '';
    const rec = document.getElementById('bm-recommendation')?.textContent.trim() || '';
    const signs = Array.from(document.querySelectorAll('#tab-risk .bm-badge:not(.bm-badge-off)')).map((b) =>
        _spEsc(b.textContent.trim())
    );

    let html = '';
    html += `<div class="sp-pr-row"><span class="sp-pr-lbl">المستوى الإجمالي</span><span class="sp-pr-val">${_spEsc(lbl)}</span></div>`;
    html += `<div style="background:#eef2f7;border:1px solid #d1d5db;border-radius:6px;height:14px;overflow:hidden;margin:8px 0 12px;"><div style="height:100%;width:${width};background:${color};"></div></div>`;
    if (breakdown) html += `<div class="sp-pr-sub">تفصيل المحاور</div>${breakdown}`;
    if (summary) html += `<div class="sp-pr-sub">ملخص مؤشرات المحاور</div>${summary}`;
    if (signs.length) {
        html += `<div class="sp-pr-sub">علامات الخطر النشطة</div><div class="sp-pr-chips">${signs.map((s) => `<span class="sp-pr-chip">${s}</span>`).join('')}</div>`;
    }
    if (rec) html += `<div class="sp-pr-sub">التوصية</div><div class="sp-pr-note">${_spEsc(rec)}</div>`;
    return html;
}

// Assemble the full stacked sheet into a hidden wrapper.
function buildStudentPrintSheet() {
    // Identity header
    const name = document.getElementById('sp-student-name')?.textContent.trim() || 'التلميذ';
    const avatarEl = document.querySelector('#sp-profile-header .sp-avatar');
    const initial = avatarEl ? avatarEl.textContent.trim() : (name[0] || '?');
    const avatarColor = avatarEl ? getComputedStyle(avatarEl).backgroundColor || '#2563eb' : '#2563eb';
    const metaHtml = document.querySelector('#sp-profile-header .sp-meta')?.innerHTML || '';

    // Personal info + quick stats are intentionally omitted here: the identity
    // header above already carries name/code/class/birth date/gender, and the
    // averages + absence figures are shown in full inside the النتائج الدراسية
    // and الغياب والمواظبة sections — so a dedicated stats block would duplicate.

    let html = '';
    html +=
        `<div class="sp-pr-head">` +
        `<div class="sp-pr-avatar" style="background:${avatarColor}">${_spEsc(initial)}</div>` +
        `<div><div class="sp-pr-name">${_spEsc(name)}</div><div class="sp-pr-meta">${metaHtml}</div></div>` +
        `</div>`;

    html += _spSection('fa-star', 'النتائج الدراسية', '#d97706', _spCloneDisplay(document.getElementById('sp-grades-content')));
    html += _spSection('fa-user-clock', 'الغياب والمواظبة', '#0891b2', _spCloneDisplay(document.getElementById('sp-absence-content')));
    html += _spSection('fa-hand-holding-usd', 'الجانب الاقتصادي', '#854f0b', _spSummarizePanel('tab-economic'));
    html += _spSection('fa-users', 'الجانب الاجتماعي', '#0f6e56', _spSummarizePanel('tab-social'));
    html += _spSection('fa-heartbeat', 'الجانب الصحي والنفسي', '#3c3489', _spSummarizePanel('tab-health'));
    html += _spSection('fa-tasks', 'المتابعة والتدخل', '#185fa5', _spSummarizePanel('tab-followup'));
    html += _spSection('fa-exclamation-triangle', 'مؤشر الخطر', '#a32d2d', _spRiskSection());

    // Hidden wrapper keeps the source off-screen; the inner sheet has no
    // display:none so its clone renders inside the PrintSystem preview.
    let wrap = document.getElementById('sp-export-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'sp-export-wrap';
        wrap.style.display = 'none';
        document.body.appendChild(wrap);
    }
    wrap.innerHTML = `<div id="sp-export-sheet" class="sp-export-sheet">${html}</div>`;
}


// ═══════════════════════════════════════════════════════════════
// ── Blank "بطاقة التتبع" (hand-fillable follow-up card) ──
// Prints ONLY the four follow-up form tabs (economic / social / health /
// follow-up) as an EMPTY paper form: radios become open circles, checkboxes
// and badges become open squares, 1–5 scales become numbered circles, text
// fields become blank rules and textareas become ruled writing boxes. This
// lets a counselor print the card and fill it by hand, then digitize it later.
// It deliberately ignores any data already entered on screen.
// ═══════════════════════════════════════════════════════════════

(function injectBlankSheetStyles() {
    if (document.getElementById('sp-blank-sheet-styles')) return;
    const style = document.createElement('style');
    style.id = 'sp-blank-sheet-styles';
    style.textContent = `
        /* Neutralize the live form's colored badge/scale states inside the blank card. */
        .sp-blank-sheet .bm-badge { all: unset; }
        .sp-blank-sheet .bm-rg { display:flex !important; flex-wrap:wrap; gap:8px 18px; }
        .sp-blank-sheet .bm-ri { display:inline-flex !important; align-items:center; gap:5px; font-size:12px; color:#1f2937; }
        .sp-blank-sheet .bm-check-group { display:flex !important; flex-direction:column; gap:6px; }
        .sp-blank-sheet .bm-check-item { display:inline-flex !important; align-items:center; gap:6px; font-size:12px; color:#1f2937; }
        /* Open markers for hand-checking. */
        .sp-bk-radio, .sp-bk-check {
            display:inline-block; width:14px; height:14px; min-width:14px;
            border:1.4px solid #374151; vertical-align:middle; background:#fff !important;
        }
        .sp-bk-radio { border-radius:50%; }
        .sp-bk-check { border-radius:3px; }
        /* Blank outlined chips (badge groups) with a leading open box. */
        .sp-bk-badge {
            display:inline-flex !important; align-items:center; gap:6px;
            border:1.2px solid #9ca3af; border-radius:999px; padding:3px 11px;
            font-size:11.5px; color:#1f2937; background:#fff !important;
        }
        /* 1–5 scale → numbered open circles. */
        .sp-bk-scale {
            display:inline-flex !important; align-items:center; justify-content:center;
            width:26px; height:26px; border:1.4px solid #374151; border-radius:50%;
            font-size:12px; font-weight:600; color:#374151; background:#fff !important;
        }
        /* Blank inline field (text / number / date / tel). */
        .sp-bk-input {
            display:inline-block; min-width:130px; height:18px;
            border-bottom:1px solid #6b7280; vertical-align:middle;
        }
        .sp-bk-input.sp-bk-input-sm { min-width:70px; }
        /* Blank ruled writing box (textarea). */
        .sp-bk-textarea {
            height:76px; border:1px solid #d1d5db; border-radius:6px; margin-top:2px;
            background-image:repeating-linear-gradient(#fff, #fff 23px, #e5e7eb 23px, #e5e7eb 24px) !important;
        }
        /* Compact the mini-cards so number boxes become blank rules. */
        .sp-blank-sheet .bm-mc { background:#f9fafb !important; border:1px solid #e5e7eb; border-radius:8px; padding:8px 11px; }
        .sp-blank-sheet .bm-mc-lbl { font-size:10.5px; color:#6b7280; margin-bottom:6px; }
        .sp-blank-sheet .bm-field-row { display:flex !important; flex-direction:column; gap:5px; }
        /* Hint banner at the top of the blank card. */
        .sp-bk-hint {
            display:flex; align-items:center; gap:8px; font-size:11.5px; color:#6b7280;
            background:#f9fafb !important; border:1px dashed #d1d5db; border-radius:6px;
            padding:7px 10px; margin-bottom:16px;
        }
        .sp-bk-hint i { color:#2563eb; }
    `;
    document.head.appendChild(style);
})();

// Transform one live form panel into an empty, hand-fillable clone (HTML string).
function _spBlankifyPanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return '<div class="sp-pr-empty">لا توجد بيانات</div>';

    const clone = panel.cloneNode(true);

    // Drop interactive chrome that has no place on a paper form.
    clone.querySelectorAll('.bm-save-bar, .bm-score-widget, script, .fa-spinner').forEach((e) => e.remove());

    // Radios → open circles, checkboxes → open squares.
    clone.querySelectorAll('input[type="radio"]').forEach((inp) => {
        const m = document.createElement('span');
        m.className = 'sp-bk-radio';
        inp.replaceWith(m);
    });
    clone.querySelectorAll('input[type="checkbox"]').forEach((inp) => {
        const m = document.createElement('span');
        m.className = 'sp-bk-check';
        inp.replaceWith(m);
    });

    // Badge buttons → blank outlined chips with a leading open box.
    clone.querySelectorAll('.bm-badge').forEach((b) => {
        const txt = b.textContent.trim();
        const chip = document.createElement('span');
        chip.className = 'sp-bk-badge';
        chip.innerHTML = '<span class="sp-bk-check"></span>' + _spEsc(txt);
        b.replaceWith(chip);
    });

    // 1–5 scale rows → numbered open circles (drop the live descriptive label).
    clone.querySelectorAll('.bm-scale-row').forEach((row) => {
        row.querySelectorAll('span').forEach((s) => s.remove());
        row.querySelectorAll('.bm-scale-btn').forEach((btn) => {
            const c = document.createElement('span');
            c.className = 'sp-bk-scale';
            c.textContent = btn.textContent.trim();
            btn.replaceWith(c);
        });
    });

    // Remaining text/number/date/tel inputs → blank inline rules.
    clone.querySelectorAll('input').forEach((inp) => {
        const line = document.createElement('span');
        line.className = 'sp-bk-input';
        if (inp.type === 'number' || inp.type === 'date') line.classList.add('sp-bk-input-sm');
        inp.replaceWith(line);
    });

    // Textareas → ruled writing boxes.
    clone.querySelectorAll('textarea').forEach((ta) => {
        const box = document.createElement('div');
        box.className = 'sp-bk-textarea';
        ta.replaceWith(box);
    });

    // Strip ids so the off-screen clone can never collide with the live page.
    clone.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));

    return clone.innerHTML;
}

// Assemble the blank tracking card (identity header + the four form sections).
function buildBlankTrackingSheet() {
    const name = document.getElementById('sp-student-name')?.textContent.trim() || 'التلميذ';
    const avatarEl = document.querySelector('#sp-profile-header .sp-avatar');
    const initial = avatarEl ? avatarEl.textContent.trim() : (name[0] || '?');
    const avatarColor = avatarEl ? getComputedStyle(avatarEl).backgroundColor || '#2563eb' : '#2563eb';
    const metaHtml = document.querySelector('#sp-profile-header .sp-meta')?.innerHTML || '';

    let html = '';
    html +=
        `<div class="sp-pr-head">` +
        `<div class="sp-pr-avatar" style="background:${avatarColor}">${_spEsc(initial)}</div>` +
        `<div><div class="sp-pr-name">${_spEsc(name)}</div><div class="sp-pr-meta">${metaHtml}</div></div>` +
        `</div>`;

    html +=
        `<div class="sp-bk-hint"><i class="fas fa-info-circle"></i>` +
        `بطاقة فارغة للتعبئة اليدوية — تُملأ الخانات بخط اليد ثم تُدخل البيانات لاحقاً.` +
        `</div>`;

    html += _spSection('fa-hand-holding-usd', 'الجانب الاقتصادي', '#854f0b', _spBlankifyPanel('tab-economic'));
    html += _spSection('fa-users', 'الجانب الاجتماعي', '#0f6e56', _spBlankifyPanel('tab-social'));
    html += _spSection('fa-heartbeat', 'الجانب الصحي والنفسي', '#3c3489', _spBlankifyPanel('tab-health'));
    html += _spSection('fa-tasks', 'المتابعة والتدخل', '#185fa5', _spBlankifyPanel('tab-followup'));

    let wrap = document.getElementById('sp-blank-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'sp-blank-wrap';
        wrap.style.display = 'none';
        document.body.appendChild(wrap);
    }
    wrap.innerHTML = `<div id="sp-blank-sheet" class="sp-export-sheet sp-blank-sheet">${html}</div>`;
}
