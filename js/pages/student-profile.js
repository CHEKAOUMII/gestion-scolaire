/**
 * Student Profile Page — Dynamic Data Controller
 * صفحة ملف التلميذ — المتحكم الديناميكي
 */

const SCHOOL_YEAR = getSchoolYear();

let stageRuleSetPayload = null;
let activeCycleCode = null;

// Risk-tab inputs stashed by the render functions (general average, per-subject
// averages, absence hours) so renderStudentRiskTab() can feed the pure engine
// in js/student-risk.js without re-parsing the DOM. Profile-tab signals
// (economic/social/health) are read live via the existing tab collectors.
const _riskState = {
    generalAverage: null,
    incompleteMetadata: null,
    subjectAverages: [],
    justifiedHours: 0,
    unjustifiedHours: 0
};

// BM Tab_Score results cached per axis (parallels _riskState).
// Each slot holds the last { score, level, subScores } result from bm-scoring.js,
// or null when the scorer has not been run yet / module not loaded.
// UI tabs (one widget each): socioeconomic, health, followup, guidance.
// Internal axes kept for risk engine: economic, social.
const _bmScoreState = {
    economic: null,
    social: null,
    socioeconomic: null,
    health: null,
    followup: null,
    guidance: null
};

/** One score widget per visible profile tab (not per storage key). */
const TAB_SCORE_WIDGETS = [
    {
        key: 'socioeconomic',
        panelId: 'tab-socioeconomic',
        label: 'مؤشر الجانب الاقتصادي والاجتماعي',
        axisName: 'الاقتصادي والاجتماعي'
    },
    {
        key: 'health',
        panelId: 'tab-health',
        label: 'مؤشر الجانب الصحي والنفسي',
        axisName: 'الجانب الصحي والنفسي'
    },
    {
        key: 'followup',
        panelId: 'tab-followup',
        label: 'مؤشر المتابعة والتدخل',
        axisName: 'المتابعة والتدخل'
    },
    {
        key: 'guidance',
        panelId: 'tab-absence',
        label: 'مؤشر فجوة التوجيه المدرسي',
        axisName: 'فجوة التوجيه',
        insertAfter: 'sp-guidance-block' // place at top of guidance block if present
    }
];

// CH8: isMale / isFemale / getGenderLabel / getGenderIcon via js/shared/gender.js
// Pure helpers: js/student-profile/pure.js → window.StudentProfilePure

const _spPure = typeof StudentProfilePure !== 'undefined' ? StudentProfilePure : null;

function getAvatarColor(name) {
    return _spPure ? _spPure.getAvatarColor(name) : '#3B6AC5';
}
function getInitial(name) {
    return _spPure ? _spPure.getInitial(name) : name ? String(name).trim().charAt(0).toUpperCase() : '?';
}
function gradeColor(val) {
    return _spPure ? _spPure.gradeColor(val) : 'grade-poor';
}
function gradeHex(val) {
    return _spPure ? _spPure.gradeHex(val) : '#f44336';
}

// normalizeSubjectName() — provided by js/utils.js

// Grade dedup (shared by renderMiniStats + renderGradesTab) — pure module.
function dedupeGrades(grades) {
    if (_spPure) return _spPure.dedupeGrades(grades);
    const dedup = {};
    (grades || []).forEach((g) => {
        dedup[`${String(g.subject || '').trim()}||${g.semester || ''}`] = g;
    });
    return Object.values(dedup);
}

function _spFallbackSchoolYear(explicit) {
    return (
        explicit ||
        (typeof SCHOOL_YEAR !== 'undefined' ? SCHOOL_YEAR : '') ||
        (typeof getSchoolYear === 'function' ? getSchoolYear() : '') ||
        ''
    );
}

// ─── URL Params ───
function getStudentCodeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('code') || '';
}

async function getActiveCycleCode() {
    if (!window.api?.cycles?.getActive) return null;
    try {
        const response = await window.api.cycles.getActive();
        return response?.success ? response.context?.cycleCode || response.cycle?.cycle_code || null : null;
    } catch (err) {
        console.warn('[student-profile] active cycle unavailable:', err);
        return null;
    }
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
    initGuidanceLive();

    try {
        stageRuleSetPayload = typeof ensureStageRuleSet === 'function' ? await ensureStageRuleSet(SCHOOL_YEAR) : null;
    } catch (err) {
        console.warn('[student-profile] stage rule set unavailable:', err);
    }
    activeCycleCode = await getActiveCycleCode();
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

        // Load saved profile tab data (guidance + other BM tabs) from SQLite
        await loadAllProfileTabs(code, student.id || 0);

        // Fill only empty guidance fields from live grades (DB values win)
        linkGuidanceToResults(student, studentGrades, { onlyEmpty: true });
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
    const levelInfo =
        typeof inferQualifiantLevel === 'function' ? inferQualifiantLevel(branch) : { code: null, label: null };
    const averages =
        typeof computeStudentAverages === 'function'
            ? computeStudentAverages(grades, branch, {
                  schoolYear: SCHOOL_YEAR,
                  streamCode: branch,
                  cycleCode: activeCycleCode,
                  levelCode: levelInfo.code,
                  levelLabel: levelInfo.label,
                  ruleSet: stageRuleSetPayload || undefined
              })
            : { term1: null, term2: null, general: null, incomplete: false };

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
    _riskState.incompleteMetadata = averages.incomplete ? averages.metadata : null;
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
    const levelInfo =
        typeof inferQualifiantLevel === 'function' ? inferQualifiantLevel(branch) : { code: null, label: null };

    // Per-term and general averages via the shared pure computation layer
    // (js/student-averages.js), the same call used by renderMiniStats. This
    // guarantees the grades-tab KPIs and the quick-stats card never drift
    // (Requirement 6.1). `rawGrades` (all terms) is passed; the module handles
    // its own per-term dedup/partitioning internally.
    const averages =
        typeof computeStudentAverages === 'function'
            ? computeStudentAverages(rawGrades, branch, {
                  schoolYear: SCHOOL_YEAR,
                  streamCode: branch,
                  cycleCode: activeCycleCode,
                  levelCode: levelInfo.code,
                  levelLabel: levelInfo.label,
                  ruleSet: stageRuleSetPayload || undefined
              })
            : { term1: null, term2: null, general: null, incomplete: false };
    _riskState.incompleteMetadata = averages.incomplete ? averages.metadata : null;

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

// Absence month helpers — pure module (js/student-profile/pure.js)
function absenceCalendarYear(monthNum, schoolYear) {
    return _spPure
        ? _spPure.absenceCalendarYear(monthNum, _spFallbackSchoolYear(schoolYear))
        : null;
}

function absenceMonthKey(a) {
    return _spPure
        ? _spPure.absenceMonthKey(a, _spFallbackSchoolYear(a?.school_year))
        : String(a?.month || a?.absence_date || 'غير محدد');
}

function formatAbsenceMonthLabel(key, schoolYear) {
    return _spPure
        ? _spPure.formatAbsenceMonthLabel(key, _spFallbackSchoolYear(schoolYear))
        : String(key || 'غير محدد');
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

        const month = absenceMonthKey(a);
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
                                const label = formatAbsenceMonthLabel(m, SCHOOL_YEAR);
                                return `<tr>
                                <td><strong>${escapeHtml(label)}</strong></td>
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

const GUIDE_GRADE_FIELD_IDS = [
    'bm-guide-ar',
    'bm-guide-fr',
    'bm-guide-en',
    'bm-guide-philo',
    'bm-guide-hg',
    'bm-guide-math',
    'bm-guide-pc',
    'bm-guide-svt'
];

/** True after a guidance row was loaded from student_profile_data */
let _guidanceDbLoaded = false;

function collectGuidanceData() {
    // Ensure averages / alignment text are current before snapshotting to DB
    if (typeof updateGuidanceAnalysis === 'function') updateGuidanceAnalysis();

    const litAvgText = document.getElementById('bm-guide-lit-avg')?.textContent || '';
    const sciAvgText = document.getElementById('bm-guide-sci-avg')?.textContent || '';
    const alignText = document.getElementById('bm-guide-align-score')?.textContent || '';
    const alignNum = parseInt(String(alignText).replace(/[^\d]/g, ''), 10);

    const sourceSubjects = [];
    GUIDE_GRADE_FIELD_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const src = el.dataset.sourceSubject || '';
        if (src) sourceSubjects.push(id + ':' + src);
    });

    const anyFromResults = GUIDE_GRADE_FIELD_IDS.some((id) => {
        const el = document.getElementById(id);
        return el && el.dataset.fromResults === '1';
    });

    return {
        current_stream: bmVal('bm-guide-stream'),
        lit_arabic: bmVal('bm-guide-ar'),
        lit_french: bmVal('bm-guide-fr'),
        lit_english: bmVal('bm-guide-en'),
        lit_philosophy: bmVal('bm-guide-philo'),
        lit_history: bmVal('bm-guide-hg'),
        sci_math: bmVal('bm-guide-math'),
        sci_physics: bmVal('bm-guide-pc'),
        sci_svt: bmVal('bm-guide-svt'),
        lit_avg: litAvgText === '—' ? '' : litAvgText,
        sci_avg: sciAvgText === '—' ? '' : sciAvgText,
        alignment_score: Number.isFinite(alignNum) ? alignNum : '',
        analysis_title: document.getElementById('bm-guide-analysis-title')?.textContent || '',
        analysis_body: document.getElementById('bm-guide-analysis-body')?.textContent || '',
        linked_from_grades: anyFromResults ? 1 : 0,
        source_subjects: sourceSubjects,
        notes: bmVal('bm-guide-notes')
    };
}

const TAB_COLLECTORS = {
    economic: collectEconomicData,
    social: collectSocialData,
    health: collectHealthData,
    followup: collectFollowupData,
    guidance: collectGuidanceData
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

function populateGuidanceData(data) {
    if (!data || typeof data !== 'object') return;

    bmSetVal('bm-guide-stream', data.current_stream);
    bmSetVal('bm-guide-ar', data.lit_arabic);
    bmSetVal('bm-guide-fr', data.lit_french);
    bmSetVal('bm-guide-en', data.lit_english);
    bmSetVal('bm-guide-philo', data.lit_philosophy);
    bmSetVal('bm-guide-hg', data.lit_history);
    bmSetVal('bm-guide-math', data.sci_math);
    bmSetVal('bm-guide-pc', data.sci_physics);
    bmSetVal('bm-guide-svt', data.sci_svt);
    bmSetVal('bm-guide-notes', data.notes);

    // Restore per-field source subject metadata when present (id:name pairs)
    const sources = Array.isArray(data.source_subjects) ? data.source_subjects : [];
    const sourceMap = {};
    sources.forEach((entry) => {
        const s = String(entry || '');
        const idx = s.indexOf(':');
        if (idx > 0) sourceMap[s.slice(0, idx)] = s.slice(idx + 1);
    });

    const fieldIds = [
        'bm-guide-ar',
        'bm-guide-fr',
        'bm-guide-en',
        'bm-guide-philo',
        'bm-guide-hg',
        'bm-guide-math',
        'bm-guide-pc',
        'bm-guide-svt'
    ];
    fieldIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const hasVal = String(el.value || '').trim() !== '';
        if (hasVal && (data.linked_from_grades === 1 || data.linked_from_grades === '1' || sourceMap[id])) {
            el.classList.add('sp-guide-from-results');
            el.dataset.fromResults = '1';
            if (sourceMap[id]) {
                el.dataset.sourceSubject = sourceMap[id];
                el.title = 'من النتائج: ' + sourceMap[id];
            } else {
                el.title = 'محفوظ من جلسة سابقة (مربوط بالنتائج)';
            }
        }
    });

    if (data.current_stream) {
        const streamEl = document.getElementById('bm-guide-stream');
        if (streamEl) {
            streamEl.classList.add('sp-guide-from-results');
            streamEl.title = 'محفوظ في قاعدة البيانات';
        }
    }

    // Recompute live averages/gauge from restored field values
    if (typeof updateGuidanceAnalysis === 'function') updateGuidanceAnalysis();

    // If DB had a stored analysis and fields are incomplete, surface the saved text
    if (data.analysis_title && !document.getElementById('bm-guide-stream')?.value) {
        const titleEl = document.getElementById('bm-guide-analysis-title');
        const bodyEl = document.getElementById('bm-guide-analysis-body');
        if (titleEl && data.analysis_title) titleEl.textContent = data.analysis_title;
        if (bodyEl && data.analysis_body) bodyEl.textContent = data.analysis_body;
    }

    _guidanceDbLoaded = true;
}

const TAB_POPULATORS = {
    economic: populateEconomicData,
    social: populateSocialData,
    health: populateHealthData,
    followup: populateFollowupData,
    guidance: populateGuidanceData
};

// ── Save All Tabs ──

const TAB_LABELS = {
    economic: 'الجانب الاقتصادي',
    social: 'الجانب الاجتماعي',
    health: 'الجانب الصحي والنفسي',
    followup: 'المتابعة',
    guidance: 'التوجيه المدرسي'
};
const ALL_TAB_KEYS = ['economic', 'social', 'health', 'followup', 'guidance'];

async function saveAllTabs() {
    if (!_currentStudentCode) {
        if (typeof showToast === 'function') showToast('لا يوجد تلميذ محدد للحفظ', 'warning');
        return;
    }
    if (!window.api?.studentProfile?.saveTab) {
        if (typeof showToast === 'function') showToast('واجهة الحفظ غير متاحة', 'error');
        return;
    }

    // Disable all save buttons + show spinner
    const btns = ALL_TAB_KEYS.map((k) => document.getElementById('bm-save-' + k)).filter(Boolean);
    // Also the guidance button id is bm-save-guidance (in ALL_TAB_KEYS)
    btns.forEach((btn) => {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
    });

    let savedCount = 0;
    let errorCount = 0;
    const errors = [];

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
                    savedEl.innerHTML =
                        '<i class="fas fa-check-circle" style="color:#2ECC71"></i> آخر حفظ: ' +
                        now.toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' });
                }
                if (tabKey === 'guidance') _guidanceDbLoaded = true;
            } else {
                errorCount++;
                errors.push((TAB_LABELS[tabKey] || tabKey) + ': ' + (result?.error || 'فشل'));
            }
        } catch (err) {
            console.error('Save tab error (' + tabKey + '):', err);
            errorCount++;
            errors.push((TAB_LABELS[tabKey] || tabKey) + ': ' + (err?.message || 'خطأ'));
        }
    }

    // Restore all buttons
    ALL_TAB_KEYS.forEach((tabKey) => {
        const btn = document.getElementById('bm-save-' + tabKey);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> حفظ جميع البيانات';
        }
    });

    // Show result
    if (errorCount === 0) {
        if (typeof showToast === 'function') {
            showToast('تم حفظ جميع البيانات بنجاح (' + savedCount + ' تبويبات) بما فيها التوجيه', 'success');
        }
    } else {
        if (typeof showToast === 'function') {
            showToast(
                'تم حفظ ' + savedCount + '، فشل ' + errorCount + (errors[0] ? ' — ' + errors[0] : ''),
                'warning'
            );
        }
    }

    // Auto-update risk indicator
    if (typeof bmUpdateRisk === 'function') bmAutoRiskFromTabs();
}

/**
 * Save only the guidance tab snapshot to student_profile_data (tab_key = guidance).
 * Used by the dedicated guidance save button for clearer feedback.
 */
async function saveGuidanceTab() {
    if (!_currentStudentCode) {
        if (typeof showToast === 'function') showToast('لا يوجد تلميذ محدد للحفظ', 'warning');
        return { success: false };
    }
    if (!window.api?.studentProfile?.saveTab) {
        if (typeof showToast === 'function') showToast('واجهة الحفظ غير متاحة', 'error');
        return { success: false };
    }

    const btn = document.getElementById('bm-save-guidance');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
    }

    try {
        const data = collectGuidanceData();
        const result = await window.api.studentProfile.saveTab({
            student_id: _currentStudentId,
            student_code: _currentStudentCode,
            tab_key: 'guidance',
            data_json: data,
            school_year: SCHOOL_YEAR
        });

        if (result && result.success !== false) {
            _dirtyTabs.delete('guidance');
            _guidanceDbLoaded = true;
            const savedEl = document.getElementById('bm-saved-guidance');
            if (savedEl) {
                const now = new Date();
                savedEl.innerHTML =
                    '<i class="fas fa-check-circle" style="color:#2ECC71"></i> آخر حفظ: ' +
                    now.toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' });
            }
            const statusEl = document.getElementById('bm-guide-link-status');
            if (statusEl && !statusEl.classList.contains('sp-guidance-link-warn')) {
                // Append DB persistence hint without wiping match status
                if (!statusEl.textContent.includes('قاعدة البيانات')) {
                    statusEl.innerHTML +=
                        ' <span class="sp-guidance-db-badge"><i class="fas fa-database"></i> محفوظ</span>';
                }
            }
            if (typeof showToast === 'function') {
                showToast('تم حفظ التوجيه المدرسي في قاعدة البيانات', 'success');
            }
            return { success: true };
        }

        const errMsg = result?.error || 'فشل الحفظ';
        if (typeof showToast === 'function') showToast('فشل حفظ التوجيه: ' + errMsg, 'error');
        return { success: false, error: errMsg };
    } catch (err) {
        console.error('Save guidance error:', err);
        if (typeof showToast === 'function') {
            showToast('فشل حفظ التوجيه: ' + (err?.message || 'خطأ'), 'error');
        }
        return { success: false, error: err?.message };
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> حفظ التوجيه في قاعدة البيانات';
        }
    }
}

// ── Load All Tabs ──

async function loadAllProfileTabs(studentCode, studentId) {
    _currentStudentCode = studentCode;
    _currentStudentId = studentId;
    _guidanceDbLoaded = false;

    try {
        if (!window.api?.studentProfile?.getAllTabs) {
            console.warn('studentProfile.getAllTabs not available');
            return;
        }
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

function showRiskSyncBanner(message) {
    const riskTab = document.getElementById('tab-risk');
    if (!riskTab) return;
    let banner = document.getElementById('risk-sync-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'risk-sync-banner';
        banner.setAttribute('role', 'alert');
        banner.style.cssText =
            'margin-bottom:12px;padding:10px 14px;border-radius:var(--radius-sm);background:color-mix(in srgb, var(--color-danger) 12%, transparent);color:var(--color-danger-text);font-size:14px;border:1px solid color-mix(in srgb, var(--color-danger) 25%, transparent);';
        riskTab.insertBefore(banner, riskTab.firstChild);
    }
    banner.textContent = message;
    banner.hidden = false;
}

function clearRiskSyncBanner() {
    const banner = document.getElementById('risk-sync-banner');
    if (banner) banner.hidden = true;
}

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
            .then((res) => {
                if (res?.success === false || res?.captureWarning) {
                    _lastRiskSnapshot = null;
                    showRiskSyncBanner(
                        res?.captureError ||
                            res?.error ||
                            'تعذر حفظ مؤشر الخطر — قد يكون غير متزامن مع الأجهزة الأخرى'
                    );
                    if (typeof showToast === 'function') {
                        showToast('تعذر حفظ مؤشر الخطر', 'warning');
                    }
                    return;
                }
                clearRiskSyncBanner();
            })
            .catch((err) => {
                _lastRiskSnapshot = null;
                showRiskSyncBanner('تعذر حفظ مؤشر الخطر — قد يكون غير متزامن مع الأجهزة الأخرى');
                if (typeof showToast === 'function') {
                    showToast('تعذر حفظ مؤشر الخطر', 'warning');
                }
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

    // ── Axis Summary Card — one row per profile tab (Req 6.3) ─────────────
    const AXIS_LABELS = {
        socioeconomic: 'الاقتصادي والاجتماعي',
        health: 'الصحي والنفسي',
        followup: 'المتابعة والتدخل',
        guidance: 'فجوة التوجيه'
    };
    const BM_LEVEL_COLOR = {
        منخفض: 'var(--color-success-solid)',
        متوسط: 'var(--color-warning-solid)',
        مرتفع: 'var(--color-danger-solid)'
    };

    const riskTab = document.getElementById('tab-risk');
    if (riskTab && !document.getElementById('bm-axis-summary-card')) {
        riskTab.insertAdjacentHTML(
            'beforeend',
            '<div id="bm-axis-summary-card" class="bm-axis-summary-card" style="display:none">' +
                '<h4 class="sp-section-title"><i class="fas fa-chart-bar"></i> ملخص مؤشرات التبويبات</h4>' +
                '<div id="bm-axis-summary-rows"></div>' +
                '</div>'
        );
    }

    const summaryCard = document.getElementById('bm-axis-summary-card');
    if (summaryCard) {
        // Prefer live tab widgets; fall back to raw economic/social average
        const tabScores = {
            socioeconomic:
                _bmScoreState.socioeconomic?.score ??
                (function () {
                    const a = _bmScoreState.economic?.score;
                    const b = _bmScoreState.social?.score;
                    const p = [a, b].filter((x) => x != null);
                    return p.length ? p.reduce((x, y) => x + y, 0) / p.length : null;
                })(),
            health: _bmScoreState.health?.score ?? null,
            followup: _bmScoreState.followup?.score ?? null,
            guidance: _bmScoreState.guidance?.score ?? null
        };
        const keys = ['socioeconomic', 'health', 'followup', 'guidance'];
        const any = keys.some((k) => tabScores[k] != null && tabScores[k] !== undefined);
        summaryCard.style.display = any ? 'block' : 'none';

        if (any) {
            const rowsEl = document.getElementById('bm-axis-summary-rows');
            if (rowsEl) {
                const levelLabel = (score) => {
                    if (score < 40) return 'منخفض';
                    if (score < 70) return 'متوسط';
                    return 'مرتفع';
                };
                rowsEl.innerHTML = keys
                    .map((k) => {
                        const raw = tabScores[k];
                        if (raw == null) {
                            return (
                                `<div class="bm-progress-row">` +
                                `<span class="bm-progress-lbl">${AXIS_LABELS[k]}</span>` +
                                `<div class="bm-progress-bg"><div class="bm-progress-fill" style="width:0%;background:var(--color-border)"></div></div>` +
                                `<span style="font-size:11px;min-width:64px;text-align:start;color:var(--color-text-muted)">—</span>` +
                                `</div>`
                            );
                        }
                        const score = Math.round(raw);
                        const level = levelLabel(score);
                        const color = BM_LEVEL_COLOR[level] || 'var(--color-accent)';
                        return (
                            `<div class="bm-progress-row">` +
                            `<span class="bm-progress-lbl">${AXIS_LABELS[k]}</span>` +
                            `<div class="bm-progress-bg">` +
                            `<div class="bm-progress-fill" style="width:${score}%;background:${color}"></div>` +
                            `</div>` +
                            `<span style="font-size:11px;min-width:64px;text-align:start;color:${color}">${level} — %${score}</span>` +
                            `</div>`
                        );
                    })
                    .join('');
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
 * Injects exactly ONE Score_Widget per visible tab.
 * Socioeconomic shows a main bar + optional economic/social section breakdown.
 */
function injectScoreWidgets() {
    TAB_SCORE_WIDGETS.forEach(({ key, panelId, label, insertAfter }) => {
        if (document.getElementById('bm-score-widget-' + key)) return;

        const breakdown =
            key === 'socioeconomic'
                ? `<div id="bm-score-sections-${key}" class="bm-score-sections" hidden>
  <div class="bm-score-section-row">
    <span class="bm-score-section-lbl">القسم الاقتصادي</span>
    <div class="bm-progress-bg bm-score-section-bar"><div id="bm-score-sec-eco" class="bm-progress-fill" style="width:0%"></div></div>
    <span id="bm-score-sec-eco-val" class="bm-score-section-val">—</span>
  </div>
  <div class="bm-score-section-row">
    <span class="bm-score-section-lbl">القسم الاجتماعي</span>
    <div class="bm-progress-bg bm-score-section-bar"><div id="bm-score-sec-soc" class="bm-progress-fill" style="width:0%"></div></div>
    <span id="bm-score-sec-soc-val" class="bm-score-section-val">—</span>
  </div>
</div>`
                : '';

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
  ${breakdown}
</div>`;

        if (insertAfter) {
            const anchor = document.getElementById(insertAfter);
            if (anchor) {
                // Prefer inside panel body, before the hint (guidance score at top of section)
                const body = anchor.querySelector('.bm-panel-body');
                const hint = anchor.querySelector('.sp-guidance-hint, .sp-guidance-link-bar');
                if (hint) {
                    hint.insertAdjacentHTML('beforebegin', html);
                } else if (body) {
                    body.insertAdjacentHTML('afterbegin', html);
                } else {
                    anchor.insertAdjacentHTML('afterbegin', html);
                }
                return;
            }
        }

        const panel = document.getElementById(panelId);
        if (!panel) return;
        panel.insertAdjacentHTML('afterbegin', html);
    });
}

// ── Score_Widget Renderer ──

const _SCORE_LEVEL_COLOR = {
    منخفض: 'var(--color-success-solid)',
    متوسط: 'var(--color-warning-solid)',
    مرتفع: 'var(--color-danger-solid)'
};

/**
 * Updates the Score_Widget for a UI tab key (one widget per tab).
 * @param {string} key - socioeconomic | health | followup | guidance
 * @param {{ score: number|null, level: string|null, subScores?: object }|null} result
 */
function updateScoreWidget(key, result) {
    const meta = TAB_SCORE_WIDGETS.find((w) => w.key === key);
    const axisName = (meta && meta.axisName) || key;

    const container = document.getElementById('bm-score-widget-' + key);
    const valEl = document.getElementById('bm-score-val-' + key);
    const barEl = document.getElementById('bm-score-bar-' + key);
    const badgeEl = document.getElementById('bm-score-badge-' + key);
    const dotEl = document.getElementById('bm-score-dot-' + key);

    if (!container || !valEl || !barEl || !badgeEl) return;

    const score = result && result.score != null ? result.score : null;

    if (score === null) {
        valEl.textContent = '—';
        valEl.style.color = 'var(--color-text-muted)';
        barEl.style.width = '0%';
        barEl.style.background = 'var(--color-border)';
        badgeEl.textContent = '';
        if (dotEl) dotEl.style.background = 'var(--color-border)';
        container.setAttribute('aria-label', 'مؤشر ' + axisName + ': غير محسوب');
    } else {
        const clamped = Math.min(100, Math.max(0, Math.round(score)));
        const level = result.level || '';
        const color = _SCORE_LEVEL_COLOR[level] || 'var(--color-accent)';
        valEl.textContent = level + ' — %' + clamped;
        valEl.style.color = color;
        barEl.style.width = clamped + '%';
        barEl.style.background = color;
        badgeEl.textContent = '';
        if (dotEl) dotEl.style.background = color;
        container.setAttribute('aria-label', 'مؤشر ' + axisName + ': ' + clamped + ' من 100 — ' + level);
    }

    // Socioeconomic: paint economic / social section rows under the main bar
    if (key === 'socioeconomic') {
        _updateSocioeconomicSections(result);
    }
}

function _paintSectionScore(barId, valId, score) {
    const bar = document.getElementById(barId);
    const val = document.getElementById(valId);
    if (!bar || !val) return;
    if (score == null || !Number.isFinite(Number(score))) {
        bar.style.width = '0%';
        bar.style.background = 'var(--color-border)';
        val.textContent = '—';
        val.style.color = 'var(--color-text-muted)';
        return;
    }
    const n = Math.min(100, Math.max(0, Math.round(Number(score))));
    const level =
        typeof window.GS2?.BmScoring?.levelLabel === 'function'
            ? window.GS2.BmScoring.levelLabel(n)
            : n < 40
              ? 'منخفض'
              : n < 70
                ? 'متوسط'
                : 'مرتفع';
    const color = _SCORE_LEVEL_COLOR[level] || 'var(--color-accent)';
    bar.style.width = n + '%';
    bar.style.background = color;
    val.textContent = level + ' — %' + n;
    val.style.color = color;
}

function _updateSocioeconomicSections(result) {
    const wrap = document.getElementById('bm-score-sections-socioeconomic');
    if (!wrap) return;
    const eco = result?.subScores?.economic;
    const soc = result?.subScores?.social;
    const hasAny = eco != null || soc != null;
    wrap.hidden = !hasAny;
    _paintSectionScore('bm-score-sec-eco', 'bm-score-sec-eco-val', eco);
    _paintSectionScore('bm-score-sec-soc', 'bm-score-sec-soc-val', soc);
}

/**
 * Recompute all tab scores into _bmScoreState (internal + UI keys).
 */
function recomputeAllBmScores() {
    if (!window.GS2?.BmScoring) return;
    const {
        computeEconomicScore,
        computeSocialScore,
        computeHealthScore,
        computeFollowupScore,
        computeSocioeconomicScore,
        computeGuidanceScore
    } = window.GS2.BmScoring;

    const ecoData = collectEconomicData();
    const socialData = collectSocialData();
    const healthData = collectHealthData();
    const followupData = collectFollowupData();
    const guidanceData = typeof collectGuidanceData === 'function' ? collectGuidanceData() : {};

    _bmScoreState.economic = computeEconomicScore(ecoData);
    _bmScoreState.social = computeSocialScore(socialData);
    _bmScoreState.socioeconomic = computeSocioeconomicScore(ecoData, socialData);
    _bmScoreState.health = computeHealthScore(healthData);
    _bmScoreState.followup = computeFollowupScore(followupData);
    _bmScoreState.guidance = computeGuidanceScore(guidanceData);
}

// ── BM Scoring Wiring ──

/**
 * Wires live listeners: one recompute pass per tab panel → one widget update.
 */
function initBmScoring() {
    if (!window.GS2?.BmScoring) return;

    const panelKeys = {
        'tab-socioeconomic': ['socioeconomic'],
        'tab-health': ['health'],
        'tab-followup': ['followup'],
        'tab-absence': ['guidance']
    };

    const timers = {};
    Object.entries(panelKeys).forEach(([tabId, keys]) => {
        const tabEl = document.getElementById(tabId);
        if (!tabEl) return;

        const handler = () => {
            clearTimeout(timers[tabId]);
            timers[tabId] = setTimeout(() => {
                recomputeAllBmScores();
                keys.forEach((key) => {
                    setTimeout(() => updateScoreWidget(key, _bmScoreState[key]), 200);
                });
                // Also refresh socioeconomic sections when eco/social change
                if (tabId === 'tab-socioeconomic') {
                    setTimeout(() => updateScoreWidget('socioeconomic', _bmScoreState.socioeconomic), 200);
                }
                if (typeof renderStudentRiskTab === 'function') renderStudentRiskTab();
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
 * Recomputes scores for every UI tab and paints its single Score_Widget.
 * Called after loading tab data from the database via loadAllProfileTabs().
 */
function updateAllScoreWidgets() {
    if (!window.GS2?.BmScoring) return;
    recomputeAllBmScores();
    TAB_SCORE_WIDGETS.forEach(({ key }) => {
        updateScoreWidget(key, _bmScoreState[key]);
    });
}

// ── Dirty Tracking ──

function initDirtyTracking() {
    // Panel → one or more storage keys (merged socioeconomic marks both dirty).
    const tabMapping = {
        'tab-socioeconomic': ['economic', 'social'],
        'tab-health': ['health'],
        'tab-followup': ['followup'],
        'tab-absence': ['guidance']
    };

    Object.entries(tabMapping).forEach(([tabId, tabKeys]) => {
        const tabEl = document.getElementById(tabId);
        if (!tabEl) return;

        const markDirty = () => tabKeys.forEach((k) => _dirtyTabs.add(k));
        tabEl.addEventListener('change', markDirty);
        tabEl.addEventListener('input', (e) => {
            if (e.target.matches('input, textarea, select')) markDirty();
        });
        // Badge clicks
        tabEl.addEventListener('click', (e) => {
            if (e.target.closest('.bm-badge')) markDirty();
        });
    });
}

function initUnsavedWarning() {
    const tabBtns = document.querySelectorAll('.sp-tab-btn');
    const tabMapping = {
        'tab-socioeconomic': ['economic', 'social'],
        'tab-health': ['health'],
        'tab-followup': ['followup'],
        'tab-absence': ['guidance']
    };

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Check if current active tab has unsaved changes
            const activePanel = document.querySelector('.sp-tab-content.active');
            if (activePanel) {
                const keys = tabMapping[activePanel.id] || [];
                if (keys.some((k) => _dirtyTabs.has(k))) {
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
    // Other BM tabs still save everything; guidance has a dedicated DB save.
    const saveAllBtnIds = ['bm-save-economic', 'bm-save-social', 'bm-save-health', 'bm-save-followup'];
    saveAllBtnIds.forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.innerHTML = '<i class="fas fa-save"></i> حفظ جميع البيانات';
            btn.addEventListener('click', () => saveAllTabs());
        }
    });

    const guideBtn = document.getElementById('bm-save-guidance');
    if (guideBtn) {
        guideBtn.innerHTML = '<i class="fas fa-save"></i> حفظ التوجيه في قاعدة البيانات';
        guideBtn.addEventListener('click', () => saveGuidanceTab());
    }
}

// ── School Guidance analysis (live averages + alignment gauge) ──

const GUIDE_STREAM_LABELS = {
    tc_sci: 'جذع مشترك علمي',
    tc_lit: 'جذع مشترك آداب وعلوم إنسانية',
    sm_a: 'علوم رياضية أ',
    sm_b: 'علوم رياضية ب',
    sp: 'علوم فيزيائية',
    svt: 'علوم الحياة والأرض',
    se: 'علوم تجريبية (أولى باك)',
    eco: 'علوم اقتصادية',
    gc: 'علوم التدبير المحاسباتي',
    lettres: 'آداب',
    sh: 'علوم إنسانية',
    tech: 'تكنولوجيات',
    other: 'أخرى'
};

/** detectBranch() code → guidance stream select value */
const BRANCH_TO_GUIDE_STREAM = {
    TCS: 'tc_sci',
    TCLSH: 'tc_lit',
    '1BACSM': 'sm_a',
    '1BACSE': 'se',
    '1BACSEG': 'eco',
    '1BACSH': 'sh',
    '2BACSMA': 'sm_a',
    '2BACSMB': 'sm_b',
    '2BACSP': 'sp',
    '2BACSVT': 'svt',
    '2BACSEC': 'eco',
    '2BACSGC': 'gc',
    '2BACLET': 'lettres',
    '2BACSH': 'sh',
    '2BACAO': 'other'
};

const GUIDE_SCI_STREAMS = new Set(['tc_sci', 'sm_a', 'sm_b', 'sp', 'svt', 'se', 'eco', 'gc', 'tech']);
const GUIDE_LIT_STREAMS = new Set(['tc_lit', 'lettres', 'sh']);

/**
 * Field id → matcher for subject names.
 * Receives a fully lowercased + Arabic-normalized string (see _guideNormalizeName).
 */
const GUIDE_SUBJECT_FIELDS = [
    {
        id: 'bm-guide-ar',
        match: (n) => /عرب|arabe/.test(n) && !/مغرب|تاريخ|جغراف/.test(n)
    },
    {
        id: 'bm-guide-fr',
        match: (n) =>
            /فرنس|francais|francaise|franc/.test(n) ||
            /اجنبيه\s*اول|اجنبية\s*اول|langue\s*etrangere\s*prem|premiere\s*langue/.test(n)
    },
    {
        id: 'bm-guide-en',
        match: (n) =>
            /انجلي|anglais|english/.test(n) ||
            /اجنبيه\s*ثان|اجنبية\s*ثان|langue\s*etrangere\s*deux|deuxieme\s*langue/.test(n)
    },
    {
        id: 'bm-guide-philo',
        match: (n) => /فلسف|philo/.test(n)
    },
    {
        id: 'bm-guide-hg',
        match: (n) =>
            /تاريخ|جغراف|اجتماعي|histoire|geograph|social/.test(n) &&
            !/اقتصاد|اسلام/.test(n)
    },
    {
        id: 'bm-guide-math',
        match: (n) => /رياض|math/.test(n) && !/مالي|phys|فيزي|اقتصاد/.test(n)
    },
    {
        id: 'bm-guide-pc',
        match: (n) => /فيزي|كيمياء|physique|chimie|\bphys\b/.test(n)
    },
    {
        id: 'bm-guide-svt',
        match: (n) => /حياه|ارض|svt|sciences de la vie|vie et de la terre|طبيع/.test(n)
    }
];

/** Cached student + grades for the "تحديث من النتائج" button */
let _guidanceLinkCache = { student: null, grades: [] };

function _guideNormalizeName(name) {
    const raw = String(name || '');
    if (typeof _normalizeArabic === 'function') {
        return _normalizeArabic(raw).toLowerCase();
    }
    return raw
        .trim()
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
        .replace(/\u0629/g, '\u0647')
        .replace(/\u0649/g, '\u064A');
}

/**
 * Build a map of base-subject → continuous-monitoring average from grade rows.
 * Uses the same grouping as the grades tab (ccBaseSubject + computeSubjectAverage).
 */
function buildGuidanceSubjectAverages(rawGrades) {
    const grades = typeof dedupeGrades === 'function' ? dedupeGrades(rawGrades || []) : rawGrades || [];
    const bySubject = {};

    grades.forEach((g) => {
        const subj =
            (typeof ccBaseSubject === 'function'
                ? ccBaseSubject(
                      typeof normalizeSubjectName === 'function'
                          ? normalizeSubjectName(g.subject)
                          : g.subject
                  )
                : typeof normalizeSubjectName === 'function'
                  ? normalizeSubjectName(g.subject)
                  : g.subject) || 'غير محدد';
        if (!bySubject[subj]) bySubject[subj] = [];
        bySubject[subj].push(g);
    });

    const avgs = {};
    Object.keys(bySubject).forEach((s) => {
        const avg =
            typeof computeSubjectAverage === 'function'
                ? computeSubjectAverage(s, bySubject[s])
                : bySubject[s].reduce((a, g) => a + Number(g.grade), 0) / bySubject[s].length;
        if (Number.isFinite(avg)) avgs[s] = Math.round(avg * 100) / 100;
    });
    return avgs;
}

/**
 * Pick the best matching subject average for a guidance field matcher.
 * Prefer exact-ish longer subject names when multiple match.
 */
function pickSubjectAverage(subjectAvgs, matchFn) {
    let best = null;
    let bestLen = -1;
    Object.entries(subjectAvgs).forEach(([name, avg]) => {
        const n = _guideNormalizeName(name);
        if (!matchFn(n)) return;
        if (name.length > bestLen) {
            bestLen = name.length;
            best = { name, avg };
        }
    });
    return best;
}

function mapBranchToGuideStream(branch) {
    if (!branch) return '';
    return BRANCH_TO_GUIDE_STREAM[branch] || '';
}

/**
 * Fill guidance form from live grades + student section.
 *
 * @param {object} student
 * @param {Array} grades - already filtered/entered numeric grades
 * @param {{ force?: boolean, onlyEmpty?: boolean, silent?: boolean }} [opts]
 *   - force: overwrite all grade fields from results + stream from section
 *   - onlyEmpty: only fill empty fields (preserve DB values) — default on load
 */
function linkGuidanceToResults(student, grades, opts) {
    const options = opts || {};
    const force = options.force === true;
    const onlyEmpty = force ? false : options.onlyEmpty !== false;
    _guidanceLinkCache = { student: student || null, grades: grades || [] };

    const statusEl = document.getElementById('bm-guide-link-status');
    const root = document.getElementById('sp-guidance-block');
    if (!root) return { filled: 0, kept: 0, total: GUIDE_SUBJECT_FIELDS.length };

    const list = Array.isArray(grades) ? grades : [];
    let keptFromDb = 0;
    GUIDE_GRADE_FIELD_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el && String(el.value || '').trim() !== '') keptFromDb++;
    });

    if (!list.length) {
        if (statusEl) {
            if (keptFromDb > 0 || _guidanceDbLoaded) {
                statusEl.innerHTML =
                    '<i class="fas fa-database" aria-hidden="true"></i> محمّل من قاعدة البيانات (' +
                    keptFromDb +
                    ' مادة) — لا نقط حية للربط';
                statusEl.className = 'sp-guidance-link-status sp-guidance-link-ok';
            } else {
                statusEl.innerHTML =
                    '<i class="fas fa-unlink" aria-hidden="true"></i> لا توجد نقط لربطها — أدخل المعدلات يدوياً أو استورد النتائج';
                statusEl.className = 'sp-guidance-link-status sp-guidance-link-warn';
            }
        }
        _guideFillStreamFromStudent(student, onlyEmpty);
        updateGuidanceAnalysis();
        return { filled: 0, kept: keptFromDb, total: GUIDE_SUBJECT_FIELDS.length };
    }

    const subjectAvgs = buildGuidanceSubjectAverages(list);
    let filled = 0;
    const matchedNames = [];

    GUIDE_SUBJECT_FIELDS.forEach(({ id, match }) => {
        const el = document.getElementById(id);
        if (!el) return;

        const hasVal = String(el.value || '').trim() !== '';
        if (onlyEmpty && hasVal) {
            matchedNames.push(el.dataset.sourceSubject || 'محفوظ');
            return;
        }

        const hit = pickSubjectAverage(subjectAvgs, match);
        if (!hit) {
            if (force) {
                el.value = '';
                el.classList.remove('sp-guide-from-results');
                el.removeAttribute('title');
                delete el.dataset.fromResults;
                delete el.dataset.sourceSubject;
            }
            return;
        }
        el.value = hit.avg.toFixed(2);
        el.classList.add('sp-guide-from-results');
        el.title = 'من النتائج: ' + hit.name;
        el.dataset.fromResults = '1';
        el.dataset.sourceSubject = hit.name;
        filled++;
        matchedNames.push(hit.name);
    });

    // Stream: keep DB value when onlyEmpty; overwrite on force
    _guideFillStreamFromStudent(student, onlyEmpty);

    // Recount after fill
    let totalFilled = 0;
    GUIDE_GRADE_FIELD_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el && String(el.value || '').trim() !== '') totalFilled++;
    });

    if (statusEl) {
        if (totalFilled > 0) {
            const parts = [];
            if (_guidanceDbLoaded || (onlyEmpty && keptFromDb > 0)) {
                parts.push(
                    '<i class="fas fa-database" aria-hidden="true"></i> قاعدة البيانات'
                );
            }
            parts.push(
                '<i class="fas fa-link" aria-hidden="true"></i> النتائج: ' +
                    totalFilled +
                    ' / ' +
                    GUIDE_SUBJECT_FIELDS.length +
                    ' مادة'
            );
            if (filled > 0 && onlyEmpty) {
                parts.push('(+' + filled + ' من النقط)');
            }
            statusEl.innerHTML =
                parts.join(' · ') +
                (matchedNames.length
                    ? ' <span class="sp-guidance-matched">(' +
                      matchedNames.filter((n) => n && n !== 'محفوظ').slice(0, 4).join('، ') +
                      ')</span>'
                    : '');
            statusEl.className = 'sp-guidance-link-status sp-guidance-link-ok';
        } else {
            statusEl.innerHTML =
                '<i class="fas fa-exclamation-circle" aria-hidden="true"></i> لم تُطابق أي مادة أساسية — تحقق من أسماء المواد في النتائج';
            statusEl.className = 'sp-guidance-link-status sp-guidance-link-warn';
        }
    }

    updateGuidanceAnalysis();
    // Refresh the single guidance tab indicator after grades link
    if (window.GS2?.BmScoring?.computeGuidanceScore && typeof collectGuidanceData === 'function') {
        _bmScoreState.guidance = window.GS2.BmScoring.computeGuidanceScore(collectGuidanceData());
        updateScoreWidget('guidance', _bmScoreState.guidance);
    }
    return { filled, kept: keptFromDb, total: GUIDE_SUBJECT_FIELDS.length, matchedNames };
}

function _guideFillStreamFromStudent(student, onlyIfEmpty) {
    const streamEl = document.getElementById('bm-guide-stream');
    if (!streamEl) return;
    if (onlyIfEmpty && String(streamEl.value || '').trim() !== '') return;

    const section = (student && (student.section || student.class_name)) || '';
    const branch = typeof detectBranch === 'function' ? detectBranch(section) : null;
    const stream = mapBranchToGuideStream(branch);
    if (stream) {
        streamEl.value = stream;
        streamEl.classList.add('sp-guide-from-results');
        streamEl.title = 'من القسم: ' + section + (branch ? ' (' + branch + ')' : '');
    }
}

function _guideParseGrade(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const v = parseFloat(el.value);
    if (!Number.isFinite(v) || v < 0 || v > 20) return null;
    return v;
}

function _guideAvg(ids) {
    const vals = ids.map(_guideParseGrade).filter((v) => v != null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function updateGuidanceAnalysis() {
    const litIds = ['bm-guide-ar', 'bm-guide-fr', 'bm-guide-en', 'bm-guide-philo', 'bm-guide-hg'];
    const sciIds = ['bm-guide-math', 'bm-guide-pc', 'bm-guide-svt'];
    const litAvg = _guideAvg(litIds);
    const sciAvg = _guideAvg(sciIds);
    const stream = bmVal('bm-guide-stream');

    const litEl = document.getElementById('bm-guide-lit-avg');
    const sciEl = document.getElementById('bm-guide-sci-avg');
    const streamLbl = document.getElementById('bm-guide-stream-lbl');
    const titleEl = document.getElementById('bm-guide-analysis-title');
    const bodyEl = document.getElementById('bm-guide-analysis-body');
    const scoreEl = document.getElementById('bm-guide-align-score');
    const arc = document.getElementById('bm-guide-gauge-arc');
    const dot = document.getElementById('bm-guide-gauge-dot');
    const analysisBox = document.querySelector('.sp-guidance-analysis');

    /** Apply attention tone to the analysis summary box (good / warn / danger / neutral). */
    const setAnalysisTone = (tone) => {
        if (analysisBox) {
            analysisBox.classList.remove(
                'sp-guide-tone-good',
                'sp-guide-tone-ok',
                'sp-guide-tone-warn',
                'sp-guide-tone-danger',
                'sp-guide-tone-neutral'
            );
            analysisBox.classList.add('sp-guide-tone-' + (tone || 'neutral'));
            analysisBox.dataset.tone = tone || 'neutral';
        }
        if (titleEl) {
            titleEl.classList.remove(
                'sp-guide-title-good',
                'sp-guide-title-ok',
                'sp-guide-title-warn',
                'sp-guide-title-danger',
                'sp-guide-title-neutral'
            );
            titleEl.classList.add('sp-guide-title-' + (tone || 'neutral'));
        }
        if (bodyEl) {
            bodyEl.classList.remove(
                'sp-guide-body-good',
                'sp-guide-body-ok',
                'sp-guide-body-warn',
                'sp-guide-body-danger',
                'sp-guide-body-neutral'
            );
            bodyEl.classList.add('sp-guide-body-' + (tone || 'neutral'));
        }
    };

    if (litEl) litEl.textContent = litAvg != null ? litAvg.toFixed(2) : '—';
    if (sciEl) sciEl.textContent = sciAvg != null ? sciAvg.toFixed(2) : '—';
    if (streamLbl) streamLbl.textContent = stream ? (GUIDE_STREAM_LABELS[stream] || stream) : '—';

    const ready = stream && litAvg != null && sciAvg != null;
    if (!ready) {
        if (titleEl) titleEl.textContent = 'بانتظار الربط مع النتائج';
        if (bodyEl) {
            bodyEl.textContent =
                !stream && litAvg == null && sciAvg == null
                    ? 'تُعبَّأ المعدلات والشعبة تلقائياً من النتائج الدراسية والقسم. إن لم تظهر، استخدم «تحديث من النتائج».'
                    : 'يحتاج التحليل إلى الشعبة الحالية ومعدل واحد على الأقل في كل مجموعة من المواد.';
        }
        if (scoreEl) scoreEl.textContent = '—';
        setAnalysisTone('neutral');
        if (arc) {
            arc.setAttribute('stroke-dasharray', '0 158');
            arc.setAttribute('stroke', 'var(--color-border, #e5e7eb)');
        }
        if (dot) {
            dot.setAttribute('cx', '10');
            dot.setAttribute('cy', '60');
            dot.setAttribute('fill', 'var(--color-border, #e5e7eb)');
        }
        return;
    }

    const diff = sciAvg - litAvg;
    const isSciStream = GUIDE_SCI_STREAMS.has(stream);
    const isLitStream = GUIDE_LIT_STREAMS.has(stream);

    // Alignment 0–100: stream family matches the stronger subject block.
    // tone: good (≥70) | ok (≥55) | warn (≥40) | danger (<40)
    let alignment = 55;
    let title = 'انسجام متوسط';
    let body = '';
    let tone = 'ok';

    if (isSciStream) {
        if (diff >= 1.5) {
            alignment = 88;
            tone = 'good';
            title = 'انسجام جيد مع الشعبة العلمية';
            body = `معدل المواد العلمية (${sciAvg.toFixed(2)}) أعلى من الأدبية (${litAvg.toFixed(2)}) — النتائج تدعم الشعبة الحالية.`;
        } else if (diff >= 0) {
            alignment = 72;
            tone = 'good';
            title = 'انسجام مقبول مع الشعبة العلمية';
            body = `المواد العلمية قريبة من الأدبية. يُستحسن تعزيز المواد العلمية الأساسية.`;
        } else if (diff >= -2) {
            alignment = 48;
            tone = 'warn';
            title = 'انسجام ضعيف نسبياً';
            body = `معدل المواد الأدبية (${litAvg.toFixed(2)}) أعلى من العلمية (${sciAvg.toFixed(2)}). راجع مدى ملاءمة الشعبة العلمية الحالية.`;
        } else {
            alignment = 28;
            tone = 'danger';
            title = 'عدم انسجام واضح';
            body = `النتائج الأدبية أعلى بكثير. يُفضّل دراسة إعادة التوجيه نحو شعبة أدبية أو علوم إنسانية.`;
        }
    } else if (isLitStream) {
        if (diff <= -1.5) {
            alignment = 88;
            tone = 'good';
            title = 'انسجام جيد مع الشعبة الأدبية';
            body = `معدل المواد الأدبية (${litAvg.toFixed(2)}) أعلى من العلمية (${sciAvg.toFixed(2)}) — النتائج تدعم الشعبة الحالية.`;
        } else if (diff <= 0) {
            alignment = 72;
            tone = 'good';
            title = 'انسجام مقبول مع الشعبة الأدبية';
            body = `المواد الأدبية قريبة من العلمية. يُستحسن تعزيز المواد الأدبية الأساسية.`;
        } else if (diff <= 2) {
            alignment = 48;
            tone = 'warn';
            title = 'انسجام ضعيف نسبياً';
            body = `معدل المواد العلمية (${sciAvg.toFixed(2)}) أعلى من الأدبية (${litAvg.toFixed(2)}). راجع مدى ملاءمة الشعبة الأدبية الحالية.`;
        } else {
            alignment = 28;
            tone = 'danger';
            title = 'عدم انسجام واضح';
            body = `النتائج العلمية أعلى بكثير. يُفضّل دراسة إعادة التوجيه نحو شعبة علمية.`;
        }
    } else {
        alignment = 60;
        tone = 'ok';
        title = 'تحليل عام للنتائج';
        body = `معدل الأدبية: ${litAvg.toFixed(2)} — معدل العلمية: ${sciAvg.toFixed(2)}. قارن النتائج مع متطلبات الشعبة المختارة.`;
    }

    if (titleEl) {
        titleEl.textContent = '';
        // Attention icon for danger/warn (draws the eye to mismatch)
        if (tone === 'danger' || tone === 'warn') {
            const icon = document.createElement('i');
            icon.className = 'fas fa-exclamation-triangle sp-guide-alert-icon';
            icon.setAttribute('aria-hidden', 'true');
            titleEl.appendChild(icon);
            titleEl.appendChild(document.createTextNode(' '));
        }
        titleEl.appendChild(document.createTextNode(title));
    }
    if (bodyEl) bodyEl.textContent = body;
    if (scoreEl) {
        scoreEl.textContent = Math.round(alignment) + '%';
        scoreEl.classList.remove(
            'sp-guide-score-good',
            'sp-guide-score-ok',
            'sp-guide-score-warn',
            'sp-guide-score-danger',
            'sp-guide-score-neutral'
        );
        scoreEl.classList.add('sp-guide-score-' + tone);
    }
    setAnalysisTone(tone);

    // Semicircle arc length ≈ π * 50 ≈ 157
    const ARC = 157;
    const filled = (alignment / 100) * ARC;
    const color =
        tone === 'good' ? '#1d9e75' : tone === 'ok' ? '#378add' : tone === 'warn' ? '#ef9f27' : '#e24b4a';
    if (arc) {
        arc.setAttribute('stroke-dasharray', filled.toFixed(1) + ' ' + ARC);
        arc.setAttribute('stroke', color);
    }
    if (dot) {
        // Angle from π (left) to 0 (right): θ = π * (1 - alignment/100)
        const theta = Math.PI * (1 - alignment / 100);
        const cx = 60 + 50 * Math.cos(theta);
        const cy = 60 - 50 * Math.sin(theta);
        dot.setAttribute('cx', cx.toFixed(1));
        dot.setAttribute('cy', cy.toFixed(1));
        dot.setAttribute('fill', color);
    }
}

function initGuidanceLive() {
    const root = document.getElementById('sp-guidance-block');
    if (!root) return;
    const handler = () => updateGuidanceAnalysis();
    root.addEventListener('input', handler);
    root.addEventListener('change', handler);

    // Manual edit removes the "from results" highlight for that field
    root.addEventListener('input', (e) => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('sp-guide-grade')) {
            t.classList.remove('sp-guide-from-results');
            t.removeAttribute('data-from-results');
        }
    });

    const refreshBtn = document.getElementById('bm-guide-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            const { student, grades } = _guidanceLinkCache;
            if (!grades || !grades.length) {
                if (typeof showToast === 'function') {
                    showToast('لا توجد نقط محملة لإعادة الربط', 'warning');
                }
                return;
            }
            const result = linkGuidanceToResults(student, grades, { force: true, silent: true });
            if (typeof showToast === 'function') {
                showToast(
                    result.filled
                        ? 'تم تحديث ' + result.filled + ' مادة من النتائج — احفظ لتثبيت القيم في قاعدة البيانات'
                        : 'لم تُطابق مواد من النتائج',
                    result.filled ? 'success' : 'warning'
                );
            }
            _dirtyTabs.add('guidance');
        });
    }

    updateGuidanceAnalysis();
}

// ── Save bar + guidance form CSS (injected) ──
(function injectSaveBarStyles() {
    if (document.getElementById('sp-bm-injected-styles')) return;
    const style = document.createElement('style');
    style.id = 'sp-bm-injected-styles';
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

        /* ── School Guidance (التوجيه المدرسي) ── */
        /* Guidance block is now a bm-panel; no extra top rule needed */
        .sp-guidance-block.bm-panel {
            margin-top: 0;
            padding-top: 0;
            border-top-style: solid;
        }
        .sp-guidance-step-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            border-radius: 999px;
            background: #e1f5ee;
            color: #0f6e56;
            font-size: 12px;
            font-weight: 700;
            margin-inline-start: 6px;
        }
        .sp-guidance-hint {
            font-size: 12px;
            color: var(--color-text-muted);
            line-height: 1.6;
            margin: 0 0 10px;
        }
        .sp-guidance-link-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            flex-wrap: wrap;
            margin-bottom: 14px;
            padding: 8px 12px;
            border-radius: 10px;
            background: var(--color-surface-alt, var(--color-secondary, #f0f7f4));
            border: 1px solid var(--color-border, #e0ebe6);
        }
        .sp-guidance-link-status {
            font-size: 12px;
            color: var(--color-text-muted);
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 1;
            min-width: 0;
            line-height: 1.45;
        }
        .sp-guidance-link-status.sp-guidance-link-ok {
            color: #0f6e56;
        }
        .sp-guidance-link-status.sp-guidance-link-warn {
            color: #854f0b;
        }
        .sp-guidance-matched {
            color: var(--color-text-light, #888);
            font-size: 11px;
        }
        .sp-guidance-db-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-inline-start: 6px;
            padding: 1px 8px;
            border-radius: 999px;
            background: #e1f5ee;
            color: #0f6e56;
            font-size: 11px;
            font-weight: 600;
        }
        /* ── Section panels (clear economic|social / health|psych split) ── */
        .bm-panel {
            border: 1px solid var(--color-border, #e5e7eb);
            border-radius: 14px;
            margin-bottom: 16px;
            overflow: hidden;
            background: var(--color-surface, #fff);
            box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        .bm-panel-head {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 14px;
            border-bottom: 1px solid var(--color-border, #e5e7eb);
        }
        .bm-panel-icon {
            width: 40px;
            height: 40px;
            border-radius: 10px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            flex-shrink: 0;
        }
        .bm-panel-head-text {
            flex: 1;
            min-width: 0;
        }
        .bm-panel-title {
            margin: 0;
            font-size: 15px;
            font-weight: 700;
            line-height: 1.3;
        }
        .bm-panel-desc {
            margin: 2px 0 0;
            font-size: 11.5px;
            color: var(--color-text-muted);
            line-height: 1.4;
        }
        .bm-panel-badge {
            font-size: 11px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 999px;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .bm-panel-body {
            padding: 14px;
        }
        /* Amber — economic */
        .bm-panel-amber {
            border-color: #fac775;
            border-inline-start: 4px solid #ef9f27;
        }
        .bm-panel-amber .bm-panel-head {
            background: linear-gradient(90deg, #faeeda 0%, transparent 100%);
        }
        .bm-panel-amber .bm-panel-icon {
            background: #faeeda;
            color: #854f0b;
        }
        .bm-panel-amber .bm-panel-title { color: #854f0b; }
        .bm-panel-amber .bm-panel-badge {
            background: #faeeda;
            color: #854f0b;
        }
        /* Teal — social */
        .bm-panel-teal {
            border-color: #9fe1cb;
            border-inline-start: 4px solid #1d9e75;
        }
        .bm-panel-teal .bm-panel-head {
            background: linear-gradient(90deg, #e1f5ee 0%, transparent 100%);
        }
        .bm-panel-teal .bm-panel-icon {
            background: #e1f5ee;
            color: #0f6e56;
        }
        .bm-panel-teal .bm-panel-title { color: #0f6e56; }
        .bm-panel-teal .bm-panel-badge {
            background: #e1f5ee;
            color: #0f6e56;
        }
        /* Green — physical health */
        .bm-panel-green {
            border-color: #c0dd97;
            border-inline-start: 4px solid #639922;
        }
        .bm-panel-green .bm-panel-head {
            background: linear-gradient(90deg, #eaf3de 0%, transparent 100%);
        }
        .bm-panel-green .bm-panel-icon {
            background: #eaf3de;
            color: #4a7018;
        }
        .bm-panel-green .bm-panel-title { color: #4a7018; }
        .bm-panel-green .bm-panel-badge {
            background: #eaf3de;
            color: #4a7018;
        }
        /* Purple — psychological */
        .bm-panel-purple {
            border-color: #afa9ec;
            border-inline-start: 4px solid #7f77dd;
        }
        .bm-panel-purple .bm-panel-head {
            background: linear-gradient(90deg, #eeedfe 0%, transparent 100%);
        }
        .bm-panel-purple .bm-panel-icon {
            background: #eeedfe;
            color: #3c3489;
        }
        .bm-panel-purple .bm-panel-title { color: #3c3489; }
        .bm-panel-purple .bm-panel-badge {
            background: #eeedfe;
            color: #3c3489;
        }
        /* Blue — absence / attendance */
        .bm-panel-blue {
            border-color: #b5d4f4;
            border-inline-start: 4px solid #378add;
        }
        .bm-panel-blue .bm-panel-head {
            background: linear-gradient(90deg, #e6f1fb 0%, transparent 100%);
        }
        .bm-panel-blue .bm-panel-icon {
            background: #e6f1fb;
            color: #185fa5;
        }
        .bm-panel-blue .bm-panel-title { color: #185fa5; }
        .bm-panel-blue .bm-panel-badge {
            background: #e6f1fb;
            color: #185fa5;
        }
        [data-theme='dark'] .bm-panel {
            background: color-mix(in srgb, var(--color-surface, #1e1e22) 92%, #000);
            box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.35);
        }
        [data-theme='dark'] .bm-panel-amber {
            border-color: rgba(239,159,39,0.55);
            border-inline-start-color: #ef9f27;
        }
        [data-theme='dark'] .bm-panel-teal {
            border-color: rgba(29,158,117,0.55);
            border-inline-start-color: #1d9e75;
        }
        [data-theme='dark'] .bm-panel-green {
            border-color: rgba(99,153,34,0.55);
            border-inline-start-color: #7cbc2b;
        }
        [data-theme='dark'] .bm-panel-purple {
            border-color: rgba(127,119,221,0.55);
            border-inline-start-color: #9b94ef;
        }
        [data-theme='dark'] .bm-panel-blue {
            border-color: rgba(55,138,221,0.55);
            border-inline-start-color: #5ba3e8;
        }
        [data-theme='dark'] .bm-panel-amber .bm-panel-head {
            background: linear-gradient(90deg, rgba(239,159,39,0.28) 0%, rgba(239,159,39,0.04) 100%);
            border-bottom-color: rgba(239,159,39,0.35);
        }
        [data-theme='dark'] .bm-panel-teal .bm-panel-head {
            background: linear-gradient(90deg, rgba(29,158,117,0.28) 0%, rgba(29,158,117,0.04) 100%);
            border-bottom-color: rgba(29,158,117,0.35);
        }
        [data-theme='dark'] .bm-panel-green .bm-panel-head {
            background: linear-gradient(90deg, rgba(124,188,43,0.28) 0%, rgba(124,188,43,0.04) 100%);
            border-bottom-color: rgba(124,188,43,0.35);
        }
        [data-theme='dark'] .bm-panel-purple .bm-panel-head {
            background: linear-gradient(90deg, rgba(155,148,239,0.28) 0%, rgba(155,148,239,0.04) 100%);
            border-bottom-color: rgba(155,148,239,0.35);
        }
        [data-theme='dark'] .bm-panel-blue .bm-panel-head {
            background: linear-gradient(90deg, rgba(55,138,221,0.28) 0%, rgba(55,138,221,0.04) 100%);
            border-bottom-color: rgba(55,138,221,0.35);
        }
        [data-theme='dark'] .bm-panel-amber .bm-panel-icon {
            background: rgba(239,159,39,0.25);
            color: #f5c97a;
        }
        [data-theme='dark'] .bm-panel-teal .bm-panel-icon {
            background: rgba(29,158,117,0.25);
            color: #60d4a8;
        }
        [data-theme='dark'] .bm-panel-green .bm-panel-icon {
            background: rgba(124,188,43,0.25);
            color: #9ed25a;
        }
        [data-theme='dark'] .bm-panel-purple .bm-panel-icon {
            background: rgba(155,148,239,0.25);
            color: #b0aaf0;
        }
        [data-theme='dark'] .bm-panel-blue .bm-panel-icon {
            background: rgba(55,138,221,0.25);
            color: #80b9f0;
        }
        [data-theme='dark'] .bm-panel-amber .bm-panel-title,
        [data-theme='dark'] .bm-panel-amber .bm-panel-badge { color: #f5c97a; }
        [data-theme='dark'] .bm-panel-teal .bm-panel-title,
        [data-theme='dark'] .bm-panel-teal .bm-panel-badge { color: #60d4a8; }
        [data-theme='dark'] .bm-panel-green .bm-panel-title,
        [data-theme='dark'] .bm-panel-green .bm-panel-badge { color: #9ed25a; }
        [data-theme='dark'] .bm-panel-purple .bm-panel-title,
        [data-theme='dark'] .bm-panel-purple .bm-panel-badge { color: #b0aaf0; }
        [data-theme='dark'] .bm-panel-blue .bm-panel-title,
        [data-theme='dark'] .bm-panel-blue .bm-panel-badge { color: #80b9f0; }
        [data-theme='dark'] .bm-panel-amber .bm-panel-badge {
            background: rgba(239,159,39,0.22);
        }
        [data-theme='dark'] .bm-panel-teal .bm-panel-badge {
            background: rgba(29,158,117,0.22);
        }
        [data-theme='dark'] .bm-panel-green .bm-panel-badge {
            background: rgba(124,188,43,0.22);
        }
        [data-theme='dark'] .bm-panel-purple .bm-panel-badge {
            background: rgba(155,148,239,0.22);
        }
        [data-theme='dark'] .bm-panel-blue .bm-panel-badge {
            background: rgba(55,138,221,0.22);
        }
        .bm-panel-split {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 4px 0 18px;
            color: var(--color-text-muted);
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.02em;
        }
        .bm-panel-split::before,
        .bm-panel-split::after {
            content: '';
            flex: 1;
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--color-border, #555), transparent);
        }
        [data-theme='dark'] .bm-panel-split {
            color: rgba(255,255,255,0.45);
        }

        /* One-indicator-per-tab: socioeconomic section breakdown */
        .bm-score-sections {
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px dashed var(--color-border, rgba(0,0,0,0.08));
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .bm-score-section-row {
            display: grid;
            grid-template-columns: 7.5rem 1fr 5.5rem;
            align-items: center;
            gap: 8px;
        }
        .bm-score-section-lbl {
            font-size: 11px;
            color: var(--color-text-muted);
            white-space: nowrap;
        }
        .bm-score-section-bar {
            height: 6px;
            border-radius: 999px;
            overflow: hidden;
        }
        .bm-score-section-val {
            font-size: 11px;
            font-weight: 600;
            text-align: start;
            white-space: nowrap;
        }
        .sp-guidance-refresh-btn {
            font-size: 12px !important;
            padding: 6px 12px !important;
            white-space: nowrap;
        }
        .sp-guide-grade.sp-guide-from-results,
        .sp-guidance-select.sp-guide-from-results {
            border-color: #9fe1cb !important;
            background: #f3fbf8 !important;
        }
        [data-theme='dark'] .sp-guide-grade.sp-guide-from-results,
        [data-theme='dark'] .sp-guidance-select.sp-guide-from-results {
            background: rgba(29, 158, 117, 0.12) !important;
            border-color: rgba(29, 158, 117, 0.4) !important;
        }
        .sp-guidance-select {
            width: 100%;
            max-width: 100%;
            padding: 10px 12px;
            border: 1px solid var(--color-border, #e5e7eb);
            border-radius: 10px;
            background: var(--color-surface, #fff);
            color: var(--color-text-main);
            font-size: 13px;
        }
        .sp-guidance-subjects-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            margin-bottom: 14px;
        }
        .sp-guidance-col {
            background: var(--color-surface-alt, var(--color-secondary, #f8faf9));
            border: 1px solid var(--color-border, #e8ebe9);
            border-radius: 12px;
            padding: 12px 14px;
        }
        .sp-guidance-col-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 700;
            color: var(--color-text-main);
            margin-bottom: 10px;
        }
        .sp-guidance-bar {
            width: 4px;
            height: 16px;
            border-radius: 2px;
            flex-shrink: 0;
        }
        .sp-guidance-bar-lit { background: #1d9e75; }
        .sp-guidance-bar-sci { background: #378add; }
        .sp-guidance-subj-head {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--color-text-muted);
            margin-bottom: 6px;
            padding: 0 2px;
        }
        .sp-guidance-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 6px 0;
            border-bottom: 1px dashed var(--color-border, rgba(0,0,0,0.06));
        }
        .sp-guidance-row:last-child { border-bottom: none; }
        .sp-guidance-row label {
            font-size: 12.5px;
            color: var(--color-text-muted);
            flex: 1;
        }
        .sp-guidance-row .sp-guide-grade {
            width: 72px;
            text-align: center;
            padding: 6px 8px;
            border: 1px solid var(--color-border, #e5e7eb);
            border-radius: 8px;
            background: var(--color-surface, #fff);
            font-size: 13px;
            font-weight: 600;
        }
        .sp-guidance-summary {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 10px;
            margin-bottom: 14px;
        }
        .sp-guidance-sum-card {
            background: var(--color-surface-alt, var(--color-secondary, #f4f6f5));
            border-radius: 12px;
            padding: 14px 10px;
            text-align: center;
        }
        .sp-guidance-sum-val {
            font-size: 20px;
            font-weight: 700;
            color: var(--color-text-main);
            line-height: 1.2;
            margin-bottom: 4px;
        }
        .sp-guidance-sum-stream {
            font-size: 13px;
            font-weight: 600;
            min-height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .sp-guidance-sum-lbl {
            font-size: 11px;
            color: var(--color-text-muted);
        }
        .sp-guidance-analysis {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 14px;
            padding: 14px 16px;
            background: var(--color-surface-alt, var(--color-secondary, #f8faf9));
            border-radius: 12px;
            border: 1px solid var(--color-border, #e5e7eb);
            border-inline-start: 4px solid var(--color-border, #cbd5e1);
            transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .sp-guidance-analysis-text {
            flex: 1;
            min-width: 0;
        }
        .sp-guidance-analysis-text h4 {
            margin: 0 0 6px;
            font-size: 15px;
            font-weight: 800;
            color: var(--color-text-main);
            display: flex;
            align-items: center;
            gap: 8px;
            line-height: 1.35;
        }
        .sp-guidance-analysis-text p {
            margin: 0;
            font-size: 12.5px;
            color: var(--color-text-muted);
            line-height: 1.6;
            font-weight: 500;
        }
        .sp-guide-alert-icon {
            flex-shrink: 0;
            font-size: 15px;
        }
        /* ── Analysis attention tones ── */
        .sp-guidance-analysis.sp-guide-tone-good {
            background: linear-gradient(90deg, #e1f5ee 0%, #f3fbf8 55%, transparent 100%);
            border-color: #9fe1cb;
            border-inline-start-color: #1d9e75;
            box-shadow: 0 0 0 1px rgba(29, 158, 117, 0.08);
        }
        .sp-guide-title-good { color: #0f6e56 !important; }
        .sp-guide-body-good { color: #0f6e56 !important; }
        .sp-guide-score-good { color: #0f6e56 !important; }

        .sp-guidance-analysis.sp-guide-tone-ok {
            background: linear-gradient(90deg, #e6f1fb 0%, #f5f9fd 55%, transparent 100%);
            border-color: #b5d4f4;
            border-inline-start-color: #378add;
        }
        .sp-guide-title-ok { color: #185fa5 !important; }
        .sp-guide-body-ok { color: #185fa5 !important; }
        .sp-guide-score-ok { color: #185fa5 !important; }

        .sp-guidance-analysis.sp-guide-tone-warn {
            background: linear-gradient(90deg, #faeeda 0%, #fef8ef 55%, transparent 100%);
            border-color: #fac775;
            border-inline-start-color: #ef9f27;
            box-shadow: 0 0 0 1px rgba(239, 159, 39, 0.12);
        }
        .sp-guide-title-warn { color: #854f0b !important; }
        .sp-guide-body-warn { color: #854f0b !important; font-weight: 600 !important; }
        .sp-guide-score-warn { color: #854f0b !important; }
        .sp-guide-title-warn .sp-guide-alert-icon { color: #ef9f27; }

        .sp-guidance-analysis.sp-guide-tone-danger {
            background: linear-gradient(90deg, #fcebeb 0%, #fef5f5 55%, transparent 100%);
            border-color: #f09595;
            border-inline-start-color: #e24b4a;
            box-shadow: 0 0 0 1px rgba(226, 75, 74, 0.15), 0 4px 14px rgba(226, 75, 74, 0.12);
            animation: sp-guide-pulse 2.4s ease-in-out infinite;
        }
        .sp-guide-title-danger {
            color: #a32d2d !important;
            font-size: 16px !important;
            letter-spacing: 0.01em;
        }
        .sp-guide-body-danger {
            color: #a32d2d !important;
            font-weight: 700 !important;
            font-size: 13px !important;
        }
        .sp-guide-score-danger { color: #a32d2d !important; font-weight: 800 !important; }
        .sp-guide-title-danger .sp-guide-alert-icon {
            color: #e24b4a;
            animation: sp-guide-icon-bounce 1.2s ease-in-out infinite;
        }

        .sp-guidance-analysis.sp-guide-tone-neutral {
            background: var(--color-surface-alt, var(--color-secondary, #f8faf9));
            border-color: var(--color-border, #e5e7eb);
            border-inline-start-color: var(--color-border, #cbd5e1);
        }
        .sp-guide-title-neutral { color: var(--color-text-main) !important; }
        .sp-guide-body-neutral { color: var(--color-text-muted) !important; }

        @keyframes sp-guide-pulse {
            0%, 100% { box-shadow: 0 0 0 1px rgba(226, 75, 74, 0.15), 0 4px 14px rgba(226, 75, 74, 0.1); }
            50% { box-shadow: 0 0 0 2px rgba(226, 75, 74, 0.28), 0 6px 18px rgba(226, 75, 74, 0.18); }
        }
        @keyframes sp-guide-icon-bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-2px); }
        }

        [data-theme='dark'] .sp-guidance-analysis.sp-guide-tone-good {
            background: linear-gradient(90deg, rgba(29,158,117,0.22) 0%, rgba(29,158,117,0.06) 100%);
            border-color: rgba(29,158,117,0.5);
        }
        [data-theme='dark'] .sp-guide-title-good,
        [data-theme='dark'] .sp-guide-body-good,
        [data-theme='dark'] .sp-guide-score-good { color: #60d4a8 !important; }

        [data-theme='dark'] .sp-guidance-analysis.sp-guide-tone-ok {
            background: linear-gradient(90deg, rgba(55,138,221,0.22) 0%, rgba(55,138,221,0.06) 100%);
            border-color: rgba(55,138,221,0.5);
        }
        [data-theme='dark'] .sp-guide-title-ok,
        [data-theme='dark'] .sp-guide-body-ok,
        [data-theme='dark'] .sp-guide-score-ok { color: #80b9f0 !important; }

        [data-theme='dark'] .sp-guidance-analysis.sp-guide-tone-warn {
            background: linear-gradient(90deg, rgba(239,159,39,0.24) 0%, rgba(239,159,39,0.06) 100%);
            border-color: rgba(239,159,39,0.55);
        }
        [data-theme='dark'] .sp-guide-title-warn,
        [data-theme='dark'] .sp-guide-body-warn,
        [data-theme='dark'] .sp-guide-score-warn { color: #f5c97a !important; }

        [data-theme='dark'] .sp-guidance-analysis.sp-guide-tone-danger {
            background: linear-gradient(90deg, rgba(226,75,74,0.28) 0%, rgba(226,75,74,0.08) 100%);
            border-color: rgba(226,75,74,0.6);
            box-shadow: 0 0 0 1px rgba(226,75,74,0.25), 0 4px 16px rgba(226,75,74,0.2);
        }
        [data-theme='dark'] .sp-guide-title-danger,
        [data-theme='dark'] .sp-guide-body-danger,
        [data-theme='dark'] .sp-guide-score-danger { color: #f0a0a0 !important; }
        .sp-guidance-gauge {
            flex-shrink: 0;
            width: 120px;
            text-align: center;
        }
        .sp-guidance-gauge-svg {
            width: 120px;
            height: 70px;
            display: block;
            margin: 0 auto;
        }
        .sp-guidance-gauge-score {
            font-size: 13px;
            font-weight: 700;
            color: var(--color-text-main);
            margin-top: -4px;
        }
        @media (max-width: 720px) {
            .sp-guidance-subjects-grid,
            .sp-guidance-summary {
                grid-template-columns: 1fr;
            }
            .sp-guidance-analysis {
                flex-direction: column;
                align-items: stretch;
            }
            .sp-guidance-gauge {
                margin: 0 auto;
            }
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
        const metaCode = _riskState.incompleteMetadata && _riskState.incompleteMetadata.code;
        const exportAllowed =
            typeof SubjectCoefficientErrorContract?.isOfficialExportAllowed === 'function'
                ? SubjectCoefficientErrorContract.isOfficialExportAllowed({
                      incomplete: !!_riskState.incompleteMetadata,
                      metadata: _riskState.incompleteMetadata || undefined
                  })
                : !_riskState.incompleteMetadata;
        if (!exportAllowed) {
            showToast(
                metaCode === 'RULES_UNAVAILABLE'
                    ? 'لا تتوفر نسخة قواعد فعالة لهذه السنة الدراسية. لا يمكن تصدير الملف.'
                    : 'لا يمكن تصدير ملف يتضمن نتائج غير مكتملة بسبب معاملات ناقصة',
                'warning'
            );
            return;
        }
        // Recompute guidance analysis so print captures current averages/grades
        if (typeof updateGuidanceAnalysis === 'function') {
            try {
                updateGuidanceAnalysis();
            } catch (_) {
                /* ignore */
            }
        }
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
// Panel frames mirror on-screen .bm-panel (colored border + tinted head + icon).
(function injectPrintSheetStyles() {
    if (document.getElementById('sp-print-sheet-styles')) return;
    const style = document.createElement('style');
    style.id = 'sp-print-sheet-styles';
    style.textContent = `
        .sp-export-sheet { color:#1f2937 !important; font-size:10.5px !important; line-height:1.35 !important; }
        .sp-export-sheet, .sp-export-sheet * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; box-sizing:border-box; }
        .sp-export-sheet, .sp-export-sheet * { max-width:100% !important; }

        /* Identity block — compact, centered */
        .sp-pr-head { display:flex !important; flex-direction:column; align-items:center; text-align:center; gap:4px; margin-bottom:10px; padding-bottom:8px; border-bottom:1.5px solid #2563eb; break-inside:avoid; page-break-inside:avoid; }
        .sp-pr-avatar { width:36px !important; height:36px !important; min-width:36px; border-radius:50%; background:#2563eb; color:#fff; display:flex !important; align-items:center; justify-content:center; font-size:15px; font-weight:700; flex-shrink:0; }
        .sp-pr-name { font-size:14px; font-weight:800; color:#111827; }
        .sp-pr-meta { display:flex !important; flex-wrap:wrap; justify-content:center; gap:8px 12px; font-size:10px; color:#6b7280; margin-top:2px; }
        .sp-pr-meta i { color:#2563eb; margin-inline-end:3px; }

        /* ── Section panels (same language as .bm-panel on the student page) ── */
        .sp-pr-panel {
            margin-bottom: 8px !important;
            border: 1px solid var(--sp-border, #e5e7eb) !important;
            border-inline-start: 4px solid var(--sp-accent, #2563eb) !important;
            border-radius: 10px !important;
            overflow: hidden;
            background: #fff !important;
            /* Prefer moving the whole panel to the next page rather than splitting it.
               Chromium still splits if the panel is taller than one full page. */
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }
        /* Tall panels (e.g. many subjects) may be marked to allow flow */
        .sp-pr-panel.sp-pr-panel--flow {
            break-inside: auto !important;
            page-break-inside: auto !important;
        }
        .sp-pr-panel-head {
            display: flex !important;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            background: linear-gradient(90deg, var(--sp-head, #eef2ff) 0%, transparent 100%) !important;
            border-bottom: 1px solid var(--sp-border, #e5e7eb) !important;
            break-after: avoid !important;
            page-break-after: avoid !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }
        /* Keep-together unit: title + table / subsection + tiles — never mid-split */
        .sp-pr-keep {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }
        .sp-pr-panel-icon {
            width: 26px; height: 26px; min-width: 26px;
            border-radius: 7px;
            display: inline-flex !important; align-items: center; justify-content: center;
            background: var(--sp-head, #eef2ff) !important;
            color: var(--sp-title, #1f2937) !important;
            font-size: 12px;
        }
        .sp-pr-panel-title {
            margin: 0 !important;
            font-size: 12px;
            font-weight: 800;
            color: var(--sp-title, #1f2937) !important;
            line-height: 1.25;
        }
        .sp-pr-panel-body { padding: 8px 10px 9px; }

        /* Keep legacy class names working inside panel body */
        .sp-pr-sec { margin-bottom: 0 !important; }
        .sp-pr-sec-h { display:none !important; } /* replaced by panel head */
        .sp-pr-sub { display:flex !important; align-items:center; gap:5px; font-size:10.5px; font-weight:700; color:var(--sp-title, var(--sp-accent,#374151)); margin:7px 0 4px !important; padding-inline-start:6px; border-inline-start:2.5px solid var(--sp-accent,#cbd5e1); break-after:avoid !important; page-break-after:avoid !important; }

        .sp-pr-grid { display:grid !important; grid-template-columns:minmax(0,1fr) minmax(0,1fr) !important; gap:1px 16px !important; }
        .sp-pr-row { display:flex !important; justify-content:space-between; gap:8px; padding:2px 0; border-bottom:1px dotted #e5e7eb; break-inside:avoid; page-break-inside:avoid; min-width:0 !important; }
        .sp-pr-row-block { flex-direction:column !important; align-items:stretch; grid-column:1 / -1 !important; }
        .sp-pr-lbl { color:#6b7280; min-width:0; overflow-wrap:anywhere; font-size:10px; }
        .sp-pr-val { color:#111827; font-weight:600; text-align:left; min-width:0; overflow-wrap:anywhere; font-size:10.5px; }

        .sp-pr-tiles { display:grid !important; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)) !important; gap:5px !important; margin-bottom:3px; break-inside:avoid !important; page-break-inside:avoid !important; }
        .sp-pr-tile { background:#f9fafb !important; border:1px solid #e5e7eb; border-radius:6px; padding:5px 8px; break-inside:avoid; page-break-inside:avoid; min-width:0; }
        .sp-pr-tile-lbl { font-size:9.5px; color:#6b7280; margin-bottom:2px; overflow-wrap:anywhere; line-height:1.25; }
        .sp-pr-tile-val { font-size:11.5px; font-weight:700; color:#111827; overflow-wrap:anywhere; line-height:1.3; }
        .sp-pr-tile-val.is-danger { color:#dc2626; }
        .sp-pr-tile-val.is-warn { color:#d97706; }
        .sp-pr-tile-val.is-ok { color:#16a34a; }
        .sp-pr-block { grid-column:1 / -1; }
        .sp-pr-block-lbl { font-size:10px; font-weight:600; color:#6b7280; margin-bottom:3px; }
        .sp-pr-chips { display:flex !important; flex-wrap:wrap; gap:4px; margin-top:1px; }
        .sp-pr-chip { background:color-mix(in srgb, var(--sp-accent,#2563eb) 10%, #fff) !important; color:var(--sp-title, var(--sp-accent,#1d4ed8)) !important; border:1px solid color-mix(in srgb, var(--sp-accent,#2563eb) 28%, #fff); border-radius:999px; padding:1px 8px; font-size:10px; font-weight:600; }
        .sp-pr-note { background:#f9fafb !important; border:1px solid #e5e7eb; border-inline-start:2.5px solid var(--sp-accent,#cbd5e1); border-radius:5px; padding:5px 8px; margin-top:2px; white-space:pre-wrap; color:#111827; line-height:1.4; font-size:10.5px; }
        .sp-pr-empty { color:#9ca3af; font-style:italic; padding:3px 0; font-size:10px; }

        /* KPIs / rows / cards — never split mid-element */
        .sp-export-sheet .sp-kpi, .sp-export-sheet .sp-chart-row,
        .sp-export-sheet .bm-progress-row, .sp-export-sheet tr,
        .sp-export-sheet .sp-print-subj-card { break-inside:avoid !important; page-break-inside:avoid !important; }
        /* Tables: never split across pages — move entire table to next page if needed */
        .sp-export-sheet table,
        .sp-export-sheet .sp-absence-table-wrap,
        .ux-pp-sheet .sp-export-sheet table,
        .ux-pp-sheet .sp-export-sheet .sp-absence-table-wrap,
        body.ux-printing-active #ux-print-root .sp-export-sheet table,
        body.ux-printing-active #ux-print-root .sp-export-sheet .sp-absence-table-wrap {
            width: 100% !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }
        .sp-export-sheet thead { display: table-header-group; }
        .sp-export-sheet tr { break-inside: avoid !important; page-break-inside: avoid !important; }
        .sp-export-sheet .sp-section-title {
            break-after: avoid !important;
            page-break-after: avoid !important;
        }
        .sp-export-sheet .sp-kpis-row,
        .sp-export-sheet .sp-print-kpis {
            display: flex !important; flex-wrap: wrap; gap: 5px !important;
            margin-bottom: 6px !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }
        .sp-export-sheet .sp-kpi,
        .sp-export-sheet .sp-print-kpi {
            flex: 1 1 70px; min-width: 64px;
            padding: 4px 6px !important;
            background: #f9fafb !important;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            text-align: center;
        }
        .sp-export-sheet .sp-kpi-val,
        .sp-export-sheet .sp-print-kpi-val { font-size: 13px !important; font-weight: 800; line-height: 1.15; }
        .sp-export-sheet .sp-kpi-label,
        .sp-export-sheet .sp-print-kpi-lbl { font-size: 8.5px !important; color: #6b7280; margin-top: 1px; }
        .sp-export-sheet .sp-section-title {
            font-size: 10.5px !important; margin: 6px 0 4px !important;
            break-after: avoid !important; page-break-after: avoid !important;
        }
        .sp-export-sheet .sp-absence-table th,
        .sp-export-sheet .sp-absence-table td { padding: 3px 6px !important; font-size: 10px !important; }

        /* ── Grades print: compact chart + dense subject grid ── */
        .sp-export-sheet .sp-print-chart {
            margin: 0 0 6px;
            display: flex; flex-direction: column; gap: 2px;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }
        .sp-export-sheet .sp-print-chart-row {
            display: grid !important;
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) 34px;
            align-items: center;
            gap: 5px;
            font-size: 9.5px;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }
        .sp-export-sheet .sp-print-chart-label {
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            color: #374151; font-weight: 600;
        }
        .sp-export-sheet .sp-print-chart-track {
            height: 6px; border-radius: 999px; background: #eef2f7 !important; overflow: hidden;
        }
        .sp-export-sheet .sp-print-chart-fill { height: 100%; border-radius: 999px; }
        .sp-export-sheet .sp-print-chart-val { font-weight: 800; text-align: end; font-size: 10px; }

        .sp-export-sheet .sp-print-subj-title {
            font-size: 10.5px; font-weight: 800; color: #854f0b;
            margin: 4px 0 5px; padding-inline-start: 6px;
            border-inline-start: 2.5px solid #ef9f27;
            break-after: avoid !important;
            page-break-after: avoid !important;
        }
        .sp-export-sheet .sp-print-subj-grid {
            display: grid !important;
            grid-template-columns: 1fr 1fr;
            gap: 5px;
            /* Cards keep themselves together; grid may flow across pages when tall */
        }
        .sp-export-sheet .sp-print-subj-card {
            border: 1px solid #e5e7eb !important;
            border-radius: 6px;
            padding: 4px 6px;
            background: #fafbfc !important;
            min-width: 0;
        }
        .sp-export-sheet .sp-print-subj-head {
            display: flex !important; justify-content: space-between; align-items: center;
            gap: 6px; margin-bottom: 3px;
        }
        .sp-export-sheet .sp-print-subj-name {
            font-size: 10px; font-weight: 700; color: #111827;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            min-width: 0;
        }
        .sp-export-sheet .sp-print-subj-avg {
            font-size: 10.5px; font-weight: 800; color: #fff !important;
            background: #6b7280 !important; border-radius: 999px;
            padding: 1px 7px; flex-shrink: 0; line-height: 1.3;
        }
        .sp-export-sheet .sp-print-subj-grades {
            display: flex !important; flex-wrap: wrap; gap: 3px;
        }
        .sp-export-sheet .sp-print-gchip {
            display: inline-flex !important; align-items: center; gap: 3px;
            font-size: 9px; padding: 1px 5px;
            border-radius: 4px; background: #f3f4f6 !important;
            border: 1px solid #e5e7eb; color: #374151; white-space: nowrap;
        }
        .sp-export-sheet .sp-print-gchip strong { font-weight: 800; font-size: 9.5px; }
        .sp-export-sheet .sp-print-gchip .sem-tag {
            color: #9ca3af; font-size: 8px; font-weight: 600;
        }

        /* Guidance — mirrors on-screen layout */
        .sp-export-sheet .sp-guide-print-stream {
            display:flex !important; align-items:center; gap:8px; flex-wrap:wrap;
            margin:0 0 6px; padding:5px 8px; background:#f0f7f4 !important;
            border:1px solid #d0e8df; border-radius:6px;
        }
        .sp-export-sheet .sp-guide-print-stream-lbl { font-size:10px; color:#6b7280; font-weight:600; }
        .sp-export-sheet .sp-guide-print-stream-val { font-size:12px; font-weight:800; color:#0f6e56; }
        .sp-export-sheet .sp-guide-print-grid {
            display: grid !important; grid-template-columns: 1fr 1fr; gap: 6px; margin: 0 0 6px;
        }
        .sp-export-sheet .sp-guide-print-col {
            border: 1px solid #d1d5db !important; border-radius: 8px;
            padding: 6px 8px; background: #fafbfc !important; break-inside: avoid;
        }
        .sp-export-sheet .sp-guide-print-col-title {
            display: flex !important; align-items: center; gap: 6px;
            font-size: 11px; font-weight: 700; margin-bottom: 4px; padding-bottom: 4px;
            border-bottom: 1px solid #e5e7eb;
        }
        .sp-export-sheet .sp-guide-print-col-title.lit { color: #0f6e56; }
        .sp-export-sheet .sp-guide-print-col-title.sci { color: #185fa5; }
        .sp-export-sheet .sp-guide-print-bar {
            display: inline-block; width: 3px; height: 12px; border-radius: 2px; flex-shrink: 0;
        }
        .sp-export-sheet .sp-guide-print-bar.lit { background: #1d9e75 !important; }
        .sp-export-sheet .sp-guide-print-bar.sci { background: #378add !important; }
        .sp-export-sheet .sp-guide-print-subj-head {
            display: flex !important; justify-content: space-between;
            font-size: 9px; color: #9ca3af; font-weight: 600; padding: 0 2px 3px; margin-bottom: 1px;
        }
        .sp-export-sheet .sp-guide-print-row {
            display: flex !important; justify-content: space-between; align-items: center;
            gap: 6px; padding: 3px 2px; border-bottom: 1px dashed #e5e7eb;
            font-size: 10.5px; color: #111827;
        }
        .sp-export-sheet .sp-guide-print-row:last-child { border-bottom: none; }
        .sp-export-sheet .sp-guide-print-subj { text-align: start; flex: 1; min-width: 0; }
        .sp-export-sheet .sp-guide-print-grade {
            text-align: center; font-weight: 700; font-size: 11.5px;
            min-width: 36px; color: #0f172a !important;
        }
        .sp-export-sheet .sp-guide-print-summary {
            display: grid !important; grid-template-columns: 1fr 1fr 1fr; gap: 5px; margin: 0 0 6px;
        }
        .sp-export-sheet .sp-guide-print-sum-card {
            text-align: center; background: #f9fafb !important;
            border: 1px solid #e5e7eb; border-radius: 6px; padding: 5px 6px; break-inside: avoid;
        }
        .sp-export-sheet .sp-guide-print-sum-val { font-size: 13px; font-weight: 800; color: #0f172a; line-height: 1.2; }
        .sp-export-sheet .sp-guide-print-sum-val.stream { font-size: 11px; color: #0f6e56; }
        .sp-export-sheet .sp-guide-print-sum-lbl { font-size: 9px; color: #6b7280; margin-top: 2px; }
        .sp-export-sheet .sp-guide-print-analysis {
            display: flex !important; gap: 10px; align-items: flex-start;
            border-radius: 8px; padding: 7px 10px; margin: 0 0 5px; border: 1px solid #d1d5db;
        }
        .sp-export-sheet .sp-guide-print-analysis-text { flex: 1; min-width: 0; }
        .sp-export-sheet .sp-guide-print-analysis-title { font-size: 11.5px; font-weight: 800; margin: 0 0 2px; line-height: 1.3; }
        .sp-export-sheet .sp-guide-print-analysis-body { font-size: 10px; font-weight: 600; margin: 0; line-height: 1.4; }
        .sp-export-sheet .sp-guide-print-align { flex-shrink: 0; text-align: center; min-width: 48px; }
        .sp-export-sheet .sp-guide-print-align-score { font-size: 16px; font-weight: 800; line-height: 1.1; }
        .sp-export-sheet .sp-guide-print-align-lbl { font-size: 8.5px; color: #6b7280; margin-top: 1px; }
        .sp-export-sheet .sp-pr-print-val {
            display: inline-block; min-width: 2rem; font-weight: 700; color: #0f172a !important;
        }

        @media (max-width: 600px) {
            .sp-export-sheet .sp-guide-print-grid,
            .sp-export-sheet .sp-guide-print-summary,
            .sp-export-sheet .sp-print-subj-grid { grid-template-columns: 1fr; }
        }

        /* print-preview skill: beat global navy th/td (preview + PDF scopes) */
        .ux-pp-sheet .sp-export-sheet th,
        body.ux-printing-active #ux-print-root .sp-export-sheet th {
            background: #f3f4f6 !important; color: #374151 !important;
            padding: 3px 6px !important; font-size: 10px !important; font-weight: 600 !important;
            border-bottom: 1px solid #e5e7eb !important;
        }
        .ux-pp-sheet .sp-export-sheet td,
        body.ux-printing-active #ux-print-root .sp-export-sheet td {
            padding: 3px 6px !important; color: #111827 !important;
            font-size: 10px !important; border-bottom: 1px solid #e5e7eb !important;
        }
        .ux-pp-sheet .sp-export-sheet tbody tr:nth-child(even),
        body.ux-printing-active #ux-print-root .sp-export-sheet tbody tr:nth-child(even) {
            background: transparent !important;
        }
        .ux-pp-sheet .sp-export-sheet .sp-absence-table th,
        body.ux-printing-active #ux-print-root .sp-export-sheet .sp-absence-table th {
            background: #ecfeff !important; color: #0e7490 !important;
        }
        body.ux-printing-active #ux-print-root .ux-pp-sheet {
            width:100% !important; min-height:0 !important;
            padding:5mm !important; overflow:visible !important;
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

    // Each subsection is a keep-together unit so title+tiles never split mid-page
    return withRows
        .map(
            (s) =>
                `<div class="sp-pr-keep">` +
                (s.title ? `<div class="sp-pr-sub">${_spEsc(s.title)}</div>` : '') +
                _spRenderRows(s.rows) +
                `</div>`
        )
        .join('');
}

// Clone rendered display content, stripping ids and interactive controls.
// Copies live form values onto the clone (cloneNode alone may drop JS-set values).
// opts.stripAbsenceRecords: drop «آخر حالات الغياب» from the PDF source only.
function _spCloneDisplay(srcEl, opts) {
    if (!srcEl) return '';
    const options = opts || {};
    const tmp = srcEl.cloneNode(true);
    const srcFields = srcEl.querySelectorAll('input, select, textarea');
    const destFields = tmp.querySelectorAll('input, select, textarea');
    srcFields.forEach((src, i) => {
        const dest = destFields[i];
        if (!dest) return;
        if (src.type === 'checkbox' || src.type === 'radio') {
            dest.checked = src.checked;
            if (src.checked) dest.setAttribute('checked', 'checked');
            else dest.removeAttribute('checked');
        } else {
            dest.value = src.value;
            dest.setAttribute('value', src.value == null ? '' : String(src.value));
        }
        if (src.tagName === 'TEXTAREA') {
            dest.textContent = src.value || '';
        }
        if (src.tagName === 'SELECT') {
            dest.value = src.value;
            Array.from(dest.options).forEach((opt) => {
                if (opt.value === src.value) opt.setAttribute('selected', 'selected');
                else opt.removeAttribute('selected');
            });
        }
    });
    // Replace filled inputs/selects with static print text so values always show
    tmp.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]), select, textarea').forEach((el) => {
        const v = (el.value || el.textContent || '').trim();
        const span = document.createElement('span');
        span.className = 'sp-pr-print-val';
        span.textContent = v || '—';
        el.replaceWith(span);
    });
    tmp.querySelectorAll('button, .bm-save-bar, .bm-score-widget, script, .fa-spinner, .sp-guidance-link-bar, .sp-guidance-refresh-btn').forEach((e) => e.remove());

    // PDF only: keep KPIs + monthly breakdown; omit the long recent-cases list
    if (options.stripAbsenceRecords) {
        tmp.querySelectorAll('.sp-absence-records').forEach((el) => el.remove());
        tmp.querySelectorAll('.sp-section-title, h4').forEach((h) => {
            if ((h.textContent || '').includes('آخر حالات الغياب')) h.remove();
        });
    }

    // Wrap title + following table so the whole table moves to next page together
    tmp.querySelectorAll('.sp-section-title, h4.sp-section-title').forEach((h) => {
        const next = h.nextElementSibling;
        if (
            next &&
            (next.classList.contains('sp-absence-table-wrap') ||
                next.tagName === 'TABLE' ||
                next.querySelector?.('table'))
        ) {
            const wrap = document.createElement('div');
            wrap.className = 'sp-pr-keep';
            h.parentNode.insertBefore(wrap, h);
            wrap.appendChild(h);
            wrap.appendChild(next);
        }
    });
    // Standalone tables without a title still stay atomic
    tmp.querySelectorAll('table').forEach((tbl) => {
        if (tbl.closest('.sp-pr-keep')) return;
        const wrap = document.createElement('div');
        wrap.className = 'sp-pr-keep';
        tbl.parentNode.insertBefore(wrap, tbl);
        wrap.appendChild(tbl);
    });

    tmp.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    return tmp.innerHTML.trim();
}

/**
 * Print-friendly guidance block matching the on-screen layout order:
 * stream → literary|scientific subject rows → summary cards → analysis → notes.
 * Uses div rows (not <table>) to avoid global print th/td navy overrides.
 */
function _spSummarizeGuidance() {
    // Ensure analysis/averages text nodes are up to date before capture
    if (typeof updateGuidanceAnalysis === 'function') {
        try {
            updateGuidanceAnalysis();
        } catch (_) {
            /* ignore */
        }
    }

    const data =
        typeof collectGuidanceData === 'function'
            ? collectGuidanceData()
            : {};

    const streamEl = document.getElementById('bm-guide-stream');
    const streamVal = data.current_stream || (streamEl ? streamEl.value : '') || '';
    const streamLabel =
        streamVal && typeof GUIDE_STREAM_LABELS !== 'undefined' && GUIDE_STREAM_LABELS[streamVal]
            ? GUIDE_STREAM_LABELS[streamVal]
            : streamEl && streamEl.selectedIndex >= 0
              ? (streamEl.options[streamEl.selectedIndex]?.text || streamVal).replace(/^اختر\.\.\.$/, '')
              : streamVal;

    const litFields = [
        { key: 'lit_arabic', id: 'bm-guide-ar', label: 'اللغة العربية' },
        { key: 'lit_french', id: 'bm-guide-fr', label: 'اللغة الفرنسية' },
        { key: 'lit_english', id: 'bm-guide-en', label: 'اللغة الإنجليزية' },
        { key: 'lit_philosophy', id: 'bm-guide-philo', label: 'الفلسفة' },
        { key: 'lit_history', id: 'bm-guide-hg', label: 'التاريخ والجغرافيا' }
    ];
    const sciFields = [
        { key: 'sci_math', id: 'bm-guide-math', label: 'الرياضيات' },
        { key: 'sci_physics', id: 'bm-guide-pc', label: 'الفيزياء والكيمياء' },
        { key: 'sci_svt', id: 'bm-guide-svt', label: 'علوم الحياة والأرض' }
    ];

    const readGrade = (id, dataKey) => {
        const el = document.getElementById(id);
        let v = '';
        if (el) {
            v = String(el.value != null ? el.value : '').trim();
            if (!v) v = String(el.getAttribute('value') || '').trim();
        }
        if (!v && data && data[dataKey] != null) {
            v = String(data[dataKey]).trim();
        }
        return v;
    };

    const fmtGrade = (g) => {
        if (!g) return '—';
        const n = parseFloat(g);
        return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : g;
    };

    const litRows = litFields.map((f) => ({
        label: f.label,
        grade: fmtGrade(readGrade(f.id, f.key))
    }));
    const sciRows = sciFields.map((f) => ({
        label: f.label,
        grade: fmtGrade(readGrade(f.id, f.key))
    }));

    const litAvg =
        (data.lit_avg && String(data.lit_avg).trim()) ||
        document.getElementById('bm-guide-lit-avg')?.textContent?.trim() ||
        '—';
    const sciAvg =
        (data.sci_avg && String(data.sci_avg).trim()) ||
        document.getElementById('bm-guide-sci-avg')?.textContent?.trim() ||
        '—';
    const streamLbl =
        streamLabel ||
        document.getElementById('bm-guide-stream-lbl')?.textContent?.trim() ||
        '—';
    const align = document.getElementById('bm-guide-align-score')?.textContent?.trim() || '—';
    const analysisTitle = document.getElementById('bm-guide-analysis-title')?.textContent?.trim() || '';
    const analysisBody = document.getElementById('bm-guide-analysis-body')?.textContent?.trim() || '';
    const notes = (data.notes || document.getElementById('bm-guide-notes')?.value || '').trim();

    const hasGrade = (rows) => rows.some((r) => r.grade && r.grade !== '—');
    const hasAny =
        (streamVal && streamVal !== '') ||
        hasGrade(litRows) ||
        hasGrade(sciRows) ||
        (litAvg && litAvg !== '—') ||
        (sciAvg && sciAvg !== '—') ||
        notes;

    if (!hasAny) {
        return '<div class="sp-pr-empty">لا توجد بيانات توجيه مسجلة</div>';
    }

    // Same visual language as page: colored bar + title + subj head + grade rows
    const subjectCol = (title, tone, rows) => {
        const body = rows
            .map(
                (r) =>
                    `<div class="sp-guide-print-row">` +
                    `<span class="sp-guide-print-subj">${_spEsc(r.label)}</span>` +
                    `<span class="sp-guide-print-grade">${_spEsc(r.grade)}</span>` +
                    `</div>`
            )
            .join('');
        return (
            `<div class="sp-guide-print-col">` +
            `<div class="sp-guide-print-col-title ${tone}">` +
            `<span class="sp-guide-print-bar ${tone}"></span>${_spEsc(title)}</div>` +
            `<div class="sp-guide-print-subj-head"><span>المادة</span><span>المعدل (/20)</span></div>` +
            body +
            `</div>`
        );
    };

    let html = '';

    // 1) Stream (same position as page select)
    html +=
        `<div class="sp-pr-keep sp-guide-print-stream">` +
        `<span class="sp-guide-print-stream-lbl">الشعبة الحالية</span>` +
        `<span class="sp-guide-print-stream-val">${_spEsc(streamLbl || '—')}</span>` +
        `</div>`;

    // 2) Literary | scientific columns (page grid order) — atomic block
    html +=
        '<div class="sp-pr-keep sp-guide-print-grid">' +
        subjectCol('المواد الأدبية الأساسية', 'lit', litRows) +
        subjectCol('المواد العلمية الأساسية', 'sci', sciRows) +
        '</div>';

    // 3) Summary strip (lit avg · sci avg · stream) — same 3 cards as page
    html +=
        '<div class="sp-pr-keep sp-guide-print-summary">' +
        `<div class="sp-guide-print-sum-card"><div class="sp-guide-print-sum-val">${_spEsc(litAvg)}</div>` +
        `<div class="sp-guide-print-sum-lbl">معدل المواد الأدبية</div></div>` +
        `<div class="sp-guide-print-sum-card"><div class="sp-guide-print-sum-val">${_spEsc(sciAvg)}</div>` +
        `<div class="sp-guide-print-sum-lbl">معدل المواد العلمية</div></div>` +
        `<div class="sp-guide-print-sum-card"><div class="sp-guide-print-sum-val stream">${_spEsc(streamLbl || '—')}</div>` +
        `<div class="sp-guide-print-sum-lbl">الشعبة الحالية</div></div>` +
        '</div>';

    // 4) Analysis + align score (page analysis card + gauge score)
    if (
        analysisTitle &&
        analysisTitle !== 'أدخل الشعبة ومعدلات المواد لعرض التحليل' &&
        analysisTitle !== 'بانتظار الربط مع النتائج'
    ) {
        const box = document.querySelector('.sp-guidance-analysis');
        const tone =
            (box && box.dataset.tone) ||
            (analysisTitle.includes('عدم انسجام')
                ? 'danger'
                : analysisTitle.includes('ضعيف')
                  ? 'warn'
                  : analysisTitle.includes('جيد') || analysisTitle.includes('مقبول')
                    ? 'good'
                    : 'ok');
        const toneColor =
            tone === 'danger' ? '#a32d2d' : tone === 'warn' ? '#854f0b' : tone === 'good' ? '#0f6e56' : '#185fa5';
        const toneBg =
            tone === 'danger' ? '#fcebeb' : tone === 'warn' ? '#faeeda' : tone === 'good' ? '#e1f5ee' : '#e6f1fb';
        const toneBorder =
            tone === 'danger' ? '#e24b4a' : tone === 'warn' ? '#ef9f27' : tone === 'good' ? '#1d9e75' : '#378add';
        const warnMark = tone === 'danger' || tone === 'warn' ? '⚠ ' : '';
        html +=
            `<div class="sp-pr-keep sp-guide-print-analysis" style="background:${toneBg}!important;border-color:${toneBorder}!important;border-inline-start:3px solid ${toneBorder}!important;">` +
            `<div class="sp-guide-print-analysis-text">` +
            `<div class="sp-guide-print-analysis-title" style="color:${toneColor}!important;">${warnMark}${_spEsc(analysisTitle)}</div>`;
        if (analysisBody) {
            html += `<p class="sp-guide-print-analysis-body" style="color:${toneColor}!important;">${_spEsc(analysisBody)}</p>`;
        }
        html += `</div>`;
        html +=
            `<div class="sp-guide-print-align">` +
            `<div class="sp-guide-print-align-score" style="color:${toneColor}!important;">${_spEsc(align)}</div>` +
            `<div class="sp-guide-print-align-lbl">نسبة الانسجام</div>` +
            `</div></div>`;
    }

    // 5) Notes
    if (notes) {
        html +=
            `<div class="sp-pr-keep"><div class="sp-pr-sub">ملاحظات وتوصيات التوجيه</div>` +
            `<div class="sp-pr-note">${_spEsc(notes)}</div></div>`;
    }

    return html;
}

/**
 * Panel tone tokens — mirrors on-screen .bm-panel-* (border + head tint + title).
 * Used so every print section gets a distinctive colored frame like the student page.
 */
const SP_PRINT_TONES = {
    amber: { accent: '#ef9f27', border: '#fac775', head: '#faeeda', title: '#854f0b' },
    blue: { accent: '#378add', border: '#b5d4f4', head: '#e6f1fb', title: '#185fa5' },
    teal: { accent: '#1d9e75', border: '#9fe1cb', head: '#e1f5ee', title: '#0f6e56' },
    purple: { accent: '#7f77dd', border: '#afa9ec', head: '#eeedfe', title: '#3c3489' },
    green: { accent: '#639922', border: '#c0dd97', head: '#eaf3de', title: '#4a7018' },
    red: { accent: '#e24b4a', border: '#f7c1c1', head: '#fcebeb', title: '#a32d2d' },
    cyan: { accent: '#0891b2', border: '#a5f3fc', head: '#ecfeff', title: '#0e7490' }
};

/**
 * Build a titled section as a colored panel frame (like .bm-panel on the page).
 * @param {string} icon - Font Awesome class without "fas "
 * @param {string} title
 * @param {string} toneKey - key in SP_PRINT_TONES, or a hex accent fallback
 * @param {string} innerHTML
 */
function _spSection(icon, title, toneKey, innerHTML) {
    const tone =
        SP_PRINT_TONES[toneKey] ||
        (toneKey && String(toneKey).startsWith('#')
            ? { accent: toneKey, border: toneKey, head: '#f3f4f6', title: toneKey }
            : SP_PRINT_TONES.blue);
    const vars =
        `--sp-accent:${tone.accent};--sp-border:${tone.border};--sp-head:${tone.head};--sp-title:${tone.title}`;
    return (
        `<section class="sp-pr-panel" style="${vars}">` +
        `<header class="sp-pr-panel-head">` +
        `<span class="sp-pr-panel-icon" aria-hidden="true"><i class="fas ${icon}"></i></span>` +
        `<h3 class="sp-pr-panel-title">${_spEsc(title)}</h3>` +
        `</header>` +
        `<div class="sp-pr-panel-body">${innerHTML || '<div class="sp-pr-empty">لا توجد بيانات</div>'}</div>` +
        `</section>`
    );
}

/**
 * Compact print layout for grades: KPIs + thin chart + 2-col subject cards
 * (replaces bulky per-subject blocks with chip bars that waste vertical space).
 */
function _spSummarizeGradesForPrint() {
    const root = document.getElementById('sp-grades-content');
    if (!root) return '<div class="sp-pr-empty">لا توجد بيانات</div>';
    if (root.querySelector('.sp-empty-tab')) {
        return '<div class="sp-pr-empty">لا توجد نقط مسجلة لهذا التلميذ</div>';
    }

    let html = '';

    // KPIs — keep together as one unit
    const kpis = root.querySelectorAll('.sp-kpi');
    if (kpis.length) {
        html += '<div class="sp-pr-keep sp-print-kpis">';
        kpis.forEach((kpi) => {
            const val = kpi.querySelector('.sp-kpi-val');
            const lbl = kpi.querySelector('.sp-kpi-label');
            const valText = (val?.textContent || '—').trim();
            const lblText = (lbl?.textContent || '').trim();
            const color = val?.style?.color || '';
            const style = color ? ` style="color:${color}"` : '';
            html +=
                `<div class="sp-print-kpi">` +
                `<div class="sp-print-kpi-val"${style}>${_spEsc(valText)}</div>` +
                `<div class="sp-print-kpi-lbl">${_spEsc(lblText)}</div>` +
                `</div>`;
        });
        html += '</div>';
    }

    // Compact horizontal bars — keep whole chart together when it fits a page
    const chartRows = root.querySelectorAll('.sp-chart-row');
    if (chartRows.length) {
        html += '<div class="sp-pr-keep sp-print-chart">';
        chartRows.forEach((row) => {
            const label = (row.querySelector('.sp-chart-label')?.textContent || '').trim();
            const valEl = row.querySelector('.sp-chart-val');
            const val = (valEl?.textContent || '').trim();
            const fill = row.querySelector('.sp-chart-bar-fill');
            const width = fill?.style?.width || '0%';
            const bg = fill?.style?.background || valEl?.style?.color || '#6b7280';
            const color = valEl?.style?.color || bg;
            html +=
                `<div class="sp-print-chart-row">` +
                `<span class="sp-print-chart-label">${_spEsc(label)}</span>` +
                `<div class="sp-print-chart-track"><div class="sp-print-chart-fill" style="width:${width};background:${bg}"></div></div>` +
                `<span class="sp-print-chart-val" style="color:${color}">${_spEsc(val)}</span>` +
                `</div>`;
        });
        html += '</div>';
    }

    // Dense 2-column subject cards — each card is atomic; title sticks to first cards
    const blocks = root.querySelectorAll('.sp-subject-block');
    if (blocks.length) {
        html += '<div class="sp-print-subj-title">تفاصيل النقط حسب المادة</div>';
        html += '<div class="sp-print-subj-grid">';
        blocks.forEach((block) => {
            const nameEl = block.querySelector('.sp-subj-name');
            // strip icon text noise if any
            let name = (nameEl?.textContent || '').replace(/\s+/g, ' ').trim();
            const avgEl = block.querySelector('.sp-subj-avg');
            const avg = (avgEl?.textContent || '—').trim();
            const avgBg = avgEl?.style?.background || '#6b7280';

            // Chips may be under semester columns
            const chips = [];
            block.querySelectorAll('.sp-semester-col').forEach((col) => {
                const sem = (col.querySelector('.sp-semester-header span')?.textContent || '')
                    .replace('الدورة الأولى', 'د1')
                    .replace('الدورة الثانية', 'د2')
                    .replace('غير محدد', '')
                    .trim();
                col.querySelectorAll('.sp-grade-chip').forEach((chip) => {
                    const lab = (chip.querySelector('.chip-label')?.textContent || '').trim();
                    const v = (chip.querySelector('.chip-value')?.textContent || '').trim();
                    const c = chip.querySelector('.chip-value')?.style?.color || '';
                    chips.push({ lab, v, c, sem });
                });
            });
            if (!chips.length) {
                block.querySelectorAll('.sp-grade-chip').forEach((chip) => {
                    const lab = (chip.querySelector('.chip-label')?.textContent || '').trim();
                    const v = (chip.querySelector('.chip-value')?.textContent || '').trim();
                    const c = chip.querySelector('.chip-value')?.style?.color || '';
                    chips.push({ lab, v, c, sem: '' });
                });
            }

            const chipsHtml = chips
                .map((ch) => {
                    const style = ch.c ? ` style="color:${ch.c}"` : '';
                    const tag = ch.sem ? `<span class="sem-tag">${_spEsc(ch.sem)}</span>` : '';
                    return (
                        `<span class="sp-print-gchip">${tag}` +
                        `${_spEsc(ch.lab)} <strong${style}>${_spEsc(ch.v)}</strong></span>`
                    );
                })
                .join('');

            html +=
                `<div class="sp-pr-keep sp-print-subj-card">` +
                `<div class="sp-print-subj-head">` +
                `<span class="sp-print-subj-name">${_spEsc(name)}</span>` +
                `<span class="sp-print-subj-avg" style="background:${avgBg}!important">${_spEsc(avg)}</span>` +
                `</div>` +
                `<div class="sp-print-subj-grades">${chipsHtml || '<span class="sp-pr-empty">—</span>'}</div>` +
                `</div>`;
        });
        html += '</div>';
    }

    return html || '<div class="sp-pr-empty">لا توجد نقط مسجلة</div>';
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
    html += `<div class="sp-pr-keep">`;
    html += `<div class="sp-pr-row"><span class="sp-pr-lbl">المستوى الإجمالي</span><span class="sp-pr-val">${_spEsc(lbl)}</span></div>`;
    html += `<div style="background:#eef2f7;border:1px solid #d1d5db;border-radius:4px;height:8px;overflow:hidden;margin:4px 0 6px;"><div style="height:100%;width:${width};background:${color};"></div></div>`;
    html += `</div>`;
    if (breakdown) {
        html += `<div class="sp-pr-keep"><div class="sp-pr-sub">تفصيل المحاور</div>${breakdown}</div>`;
    }
    if (summary) {
        html += `<div class="sp-pr-keep"><div class="sp-pr-sub">ملخص مؤشرات المحاور</div>${summary}</div>`;
    }
    if (signs.length) {
        html +=
            `<div class="sp-pr-keep"><div class="sp-pr-sub">علامات الخطر النشطة</div>` +
            `<div class="sp-pr-chips">${signs.map((s) => `<span class="sp-pr-chip">${s}</span>`).join('')}</div></div>`;
    }
    if (rec) {
        html += `<div class="sp-pr-keep"><div class="sp-pr-sub">التوصية</div><div class="sp-pr-note">${_spEsc(rec)}</div></div>`;
    }
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

    // Colored panel frames match on-screen .bm-panel tones (amber/blue/teal/…)
    html += _spSection('fa-star', 'النتائج الدراسية', 'amber', _spSummarizeGradesForPrint());
    // Absence: KPIs + monthly table only — «آخر حالات الغياب» stays on screen, not in PDF
    html += _spSection(
        'fa-user-clock',
        'الغياب والمواظبة',
        'blue',
        _spCloneDisplay(document.getElementById('sp-absence-content'), { stripAbsenceRecords: true })
    );
    // Guidance: page-matching layout (stream → subjects → summary → analysis → notes)
    html += _spSection('fa-compass', 'التوجيه المدرسي', 'teal', _spSummarizeGuidance());
    html += _spSection(
        'fa-hand-holding-heart',
        'الجانب الاقتصادي والاجتماعي',
        'amber',
        _spSummarizePanel('tab-socioeconomic')
    );
    html += _spSection('fa-heartbeat', 'الجانب الصحي والنفسي', 'purple', _spSummarizePanel('tab-health'));
    html += _spSection('fa-tasks', 'المتابعة والتدخل', 'blue', _spSummarizePanel('tab-followup'));
    html += _spSection('fa-exclamation-triangle', 'مؤشر الخطر', 'red', _spRiskSection());

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
    // Tall panels that exceed ~one printable page must be allowed to flow;
    // shorter panels stay atomic (move entirely to next page instead of mid-split).
    _spMarkTallPanelsForFlow();
}

/**
 * Measure each print panel off-screen. Panels taller than ~one A4 content
 * area get `.sp-pr-panel--flow` so Chromium can paginate them; shorter ones
 * keep `break-inside: avoid` and jump whole to the next page when needed.
 */
function _spMarkTallPanelsForFlow() {
    const wrap = document.getElementById('sp-export-wrap');
    const sheet = document.getElementById('sp-export-sheet');
    if (!wrap || !sheet) return;

    const PX_PER_MM = 96 / 25.4;
    // Usable content height on A4 with ~5mm margins + letterhead reserve
    const MAX_KEEP_PX = Math.round((297 - 10 - 28) * PX_PER_MM); // ≈980px

    const prev = {
        display: wrap.style.display,
        position: wrap.style.position,
        left: wrap.style.left,
        top: wrap.style.top,
        width: wrap.style.width,
        visibility: wrap.style.visibility,
        zIndex: wrap.style.zIndex
    };

    wrap.style.display = 'block';
    wrap.style.position = 'absolute';
    wrap.style.left = '-99999px';
    wrap.style.top = '0';
    wrap.style.width = '190mm';
    wrap.style.visibility = 'hidden';
    wrap.style.zIndex = '-1';

    try {
        sheet.querySelectorAll('.sp-pr-panel').forEach((panel) => {
            panel.classList.remove('sp-pr-panel--flow');
            const h = panel.getBoundingClientRect().height;
            if (h > MAX_KEEP_PX) {
                panel.classList.add('sp-pr-panel--flow');
            }
        });
    } finally {
        wrap.style.display = prev.display || 'none';
        wrap.style.position = prev.position || '';
        wrap.style.left = prev.left || '';
        wrap.style.top = prev.top || '';
        wrap.style.width = prev.width || '';
        wrap.style.visibility = prev.visibility || '';
        wrap.style.zIndex = prev.zIndex || '';
    }
}


// ═══════════════════════════════════════════════════════════════
// ── Blank "بطاقة التتبع" (hand-fillable tracking card) ──
// Same visual language as معاينة الطباعة (colored .sp-pr-panel frames),
// but EVERY section is empty for pen fill-in: radios → open circles,
// checkboxes/badges → open squares, scales → 1–5 circles, inputs → rules,
// textareas → lined boxes. Includes grades + absence + guidance + forms + risk.
// ═══════════════════════════════════════════════════════════════

(function injectBlankSheetStyles() {
    let style = document.getElementById('sp-blank-sheet-styles');
    if (!style) {
        style = document.createElement('style');
        style.id = 'sp-blank-sheet-styles';
        document.head.appendChild(style);
    }
    style.textContent = `
        /* Blank card shares .sp-export-sheet panel styles; form-only tweaks below */
        .sp-blank-sheet .bm-badge { all: unset; }
        .sp-blank-sheet .bm-rg { display:flex !important; flex-wrap:wrap; gap:4px 12px; margin:2px 0 6px; }
        .sp-blank-sheet .bm-ri { display:inline-flex !important; align-items:center; gap:4px; font-size:10.5px; color:#1f2937; }
        .sp-blank-sheet .bm-check-group { display:flex !important; flex-direction:column; gap:3px; margin:2px 0 6px; }
        .sp-blank-sheet .bm-check-item { display:inline-flex !important; align-items:center; gap:5px; font-size:10.5px; color:#1f2937; }
        .sp-blank-sheet .bm-sub-lbl, .sp-blank-sheet .bm-sec-title {
            font-size:10.5px !important; font-weight:700; color:#374151; margin:6px 0 3px !important;
        }
        .sp-blank-sheet .bm-sec-title { border-inline-start:2.5px solid var(--sp-accent,#cbd5e1); padding-inline-start:6px; }
        .sp-blank-sheet .bm-g2, .sp-blank-sheet .bm-g3 {
            display:grid !important; gap:6px 10px; margin-bottom:6px !important;
        }
        .sp-blank-sheet .bm-g2 { grid-template-columns:1fr 1fr; }
        .sp-blank-sheet .bm-g3 { grid-template-columns:1fr 1fr 1fr; }
        .sp-blank-sheet .bm-mb8, .sp-blank-sheet .bm-mt8 { margin:4px 0 !important; }
        .sp-blank-sheet .sp-guidance-subjects-grid {
            display:grid !important; grid-template-columns:1fr 1fr; gap:6px; margin:4px 0;
        }
        .sp-blank-sheet .sp-guidance-col {
            border:1px solid #e5e7eb; border-radius:6px; padding:5px 7px; background:#fafbfc !important;
        }
        .sp-blank-sheet .sp-guidance-col-title { font-size:11px; font-weight:700; margin-bottom:4px; }
        .sp-blank-sheet .sp-guidance-row, .sp-blank-sheet .sp-guidance-subj-head {
            display:flex !important; justify-content:space-between; align-items:center;
            gap:6px; padding:3px 0; font-size:10.5px; border-bottom:1px dashed #e5e7eb;
        }
        .sp-blank-sheet .sp-guidance-summary {
            display:grid !important; grid-template-columns:1fr 1fr 1fr; gap:5px; margin:6px 0;
        }
        .sp-blank-sheet .sp-guidance-sum-card {
            text-align:center; border:1px solid #e5e7eb; border-radius:6px; padding:6px; background:#f9fafb !important;
        }
        .sp-blank-sheet .sp-guidance-sum-val { min-height:16px; border-bottom:1px solid #9ca3af; margin:0 8px 4px; }
        .sp-blank-sheet .sp-guidance-sum-lbl { font-size:9px; color:#6b7280; }
        .sp-blank-sheet .sp-guidance-analysis { display:none !important; }
        .sp-blank-sheet .sp-guidance-gauge { display:none !important; }

        .sp-bk-radio, .sp-bk-check {
            display:inline-block; width:12px; height:12px; min-width:12px;
            border:1.3px solid #374151; vertical-align:middle; background:#fff !important;
            flex-shrink:0;
        }
        .sp-bk-radio { border-radius:50%; }
        .sp-bk-check { border-radius:2px; }
        .sp-bk-badge {
            display:inline-flex !important; align-items:center; gap:4px;
            border:1px solid #9ca3af; border-radius:999px; padding:1px 8px;
            font-size:10px; color:#1f2937; background:#fff !important; margin:2px;
        }
        .sp-bk-scale {
            display:inline-flex !important; align-items:center; justify-content:center;
            width:22px; height:22px; border:1.3px solid #374151; border-radius:50%;
            font-size:10px; font-weight:600; color:#374151; background:#fff !important;
        }
        .sp-bk-input {
            display:inline-block; min-width:100px; height:16px;
            border-bottom:1px solid #6b7280; vertical-align:middle;
        }
        .sp-bk-input.sp-bk-input-sm { min-width:48px; }
        .sp-bk-input.sp-bk-input-block { display:block; width:100%; min-width:0; margin-top:3px; }
        .sp-bk-textarea {
            height:52px; border:1px solid #d1d5db; border-radius:5px; margin-top:2px;
            background-image:repeating-linear-gradient(#fff, #fff 16px, #e5e7eb 16px, #e5e7eb 17px) !important;
        }
        .sp-blank-sheet .bm-mc {
            background:#f9fafb !important; border:1px solid #e5e7eb; border-radius:6px; padding:5px 8px;
        }
        .sp-blank-sheet .bm-mc-lbl { font-size:9.5px; color:#6b7280; margin-bottom:4px; }
        .sp-blank-sheet .bm-field-row { display:flex !important; flex-direction:column; gap:3px; }

        .sp-bk-hint {
            display:flex; align-items:center; gap:8px; font-size:10.5px; color:#6b7280;
            background:#f0f7ff !important; border:1px dashed #93c5fd; border-radius:6px;
            padding:6px 10px; margin-bottom:8px;
            break-inside:avoid; page-break-inside:avoid;
        }
        .sp-bk-hint i { color:#2563eb; }

        .sp-blank-sheet .sp-bk-table { width:100% !important; border-collapse:collapse; font-size:10px; margin-top:4px; }
        .sp-blank-sheet .sp-bk-table th {
            background:#f3f4f6 !important; color:#374151 !important; font-weight:600;
            padding:4px 6px !important; border:1px solid #e5e7eb !important; text-align:start;
        }
        .sp-blank-sheet .sp-bk-table td {
            height:18px; padding:3px 6px !important; border:1px solid #e5e7eb !important;
        }
        .ux-pp-sheet .sp-blank-sheet .sp-bk-table th,
        body.ux-printing-active #ux-print-root .sp-blank-sheet .sp-bk-table th {
            background:#f3f4f6 !important; color:#374151 !important; padding:4px 6px !important;
        }
        .ux-pp-sheet .sp-blank-sheet .sp-bk-table td,
        body.ux-printing-active #ux-print-root .sp-blank-sheet .sp-bk-table td {
            padding:3px 6px !important; border:1px solid #e5e7eb !important;
        }

        .sp-bk-risk-signs { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
        .sp-blank-sheet .bm-panel, .sp-blank-sheet .bm-panel-head, .sp-blank-sheet .bm-panel-body {
            border:none !important; box-shadow:none !important; background:transparent !important;
            padding:0 !important; margin:0 !important;
        }
        .sp-blank-sheet .bm-panel-icon, .sp-blank-sheet .bm-panel-badge,
        .sp-blank-sheet .bm-panel-desc, .sp-blank-sheet .bm-panel-split { display:none !important; }
        .sp-blank-sheet .bm-panel-title {
            display:block !important; font-size:11px !important; font-weight:800;
            margin:0 0 6px !important; color:var(--sp-title,#374151) !important;
            padding-inline-start:6px; border-inline-start:2.5px solid var(--sp-accent,#cbd5e1);
        }

        @media (max-width: 600px) {
            .sp-blank-sheet .bm-g2, .sp-blank-sheet .bm-g3,
            .sp-blank-sheet .sp-guidance-subjects-grid,
            .sp-blank-sheet .sp-guidance-summary { grid-template-columns:1fr !important; }
        }
    `;
})();

/**
 * Turn a live form subtree into empty hand-fillable HTML (no values).
 * @param {Element|string} srcElOrId - element or id
 * @param {{ bodyOnly?: boolean }} [opts]
 */
function _spBlankifyElement(srcElOrId, opts) {
    const options = opts || {};
    let src =
        typeof srcElOrId === 'string' ? document.getElementById(srcElOrId) : srcElOrId;
    if (!src) return '<div class="sp-pr-empty">لا توجد حقول</div>';

    if (options.bodyOnly) {
        const body = src.querySelector('.bm-panel-body');
        if (body) src = body;
    }

    const clone = src.cloneNode(true);

    // Drop interactive / UI-only chrome
    clone
        .querySelectorAll(
            [
                '.bm-save-bar',
                '.bm-score-widget',
                'script',
                '.fa-spinner',
                '.sp-guidance-link-bar',
                '.sp-guidance-refresh-btn',
                '.sp-guidance-hint',
                '.sp-guidance-analysis',
                '.sp-guidance-gauge',
                '.bm-panel-badge',
                '.bm-panel-desc',
                '.bm-panel-split',
                '.bm-panel-icon'
            ].join(',')
        )
        .forEach((e) => e.remove());

    // Radios → open circles, checkboxes → open squares (always empty)
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

    // Badge buttons → open chips
    clone.querySelectorAll('.bm-badge').forEach((b) => {
        const txt = b.textContent.trim();
        const chip = document.createElement('span');
        chip.className = 'sp-bk-badge';
        chip.innerHTML = '<span class="sp-bk-check"></span>' + _spEsc(txt);
        b.replaceWith(chip);
    });

    // 1–5 scales → open numbered circles
    clone.querySelectorAll('.bm-scale-row').forEach((row) => {
        row.querySelectorAll('span').forEach((s) => s.remove());
        row.querySelectorAll('.bm-scale-btn').forEach((btn) => {
            const c = document.createElement('span');
            c.className = 'sp-bk-scale';
            c.textContent = btn.textContent.trim();
            btn.replaceWith(c);
        });
    });

    // Text / number / date / tel → underline
    clone.querySelectorAll('input').forEach((inp) => {
        const line = document.createElement('span');
        line.className = 'sp-bk-input';
        if (inp.type === 'number' || inp.type === 'date') line.classList.add('sp-bk-input-sm');
        inp.replaceWith(line);
    });

    // Select → underline
    clone.querySelectorAll('select').forEach((sel) => {
        const line = document.createElement('span');
        line.className = 'sp-bk-input';
        if (sel.classList.contains('sp-guidance-select') || sel.id === 'bm-guide-stream') {
            line.classList.add('sp-bk-input-block');
        }
        sel.replaceWith(line);
    });

    // Textarea → lined box
    clone.querySelectorAll('textarea').forEach((ta) => {
        const box = document.createElement('div');
        box.className = 'sp-bk-textarea';
        ta.replaceWith(box);
    });

    // Live computed text nodes (avg cards) → blank lines
    clone.querySelectorAll('.sp-guidance-sum-val, .sp-pr-print-val').forEach((el) => {
        el.textContent = '';
        el.classList.add('sp-bk-input', 'sp-bk-input-block');
    });

    clone.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    clone.querySelectorAll('[onclick]').forEach((e) => e.removeAttribute('onclick'));

    return clone.innerHTML.trim() || '<div class="sp-pr-empty">لا توجد حقول</div>';
}

function _spBlankifyPanel(panelId) {
    return _spBlankifyElement(panelId, { bodyOnly: false });
}

/** Blankify a single .bm-panel (or any selector) — body only for use inside _spSection. */
function _spBlankifySelector(selector) {
    const el = document.querySelector(selector);
    if (!el) return '<div class="sp-pr-empty">لا توجد حقول</div>';
    return _spBlankifyElement(el, { bodyOnly: true });
}

/** Empty grades table for hand fill (same slot as print «النتائج الدراسية»). */
function _spBlankGradesSection() {
    const kpiLabels = ['المعدل العام', 'معدل الدورة 1', 'معدل الدورة 2', 'عدد المواد', 'أعلى نقطة', 'أدنى نقطة'];
    const kpis = kpiLabels
        .map(
            (lbl) =>
                `<div class="sp-print-kpi"><div class="sp-bk-input sp-bk-input-sm" style="min-width:40px;margin:0 auto"></div>` +
                `<div class="sp-print-kpi-lbl">${_spEsc(lbl)}</div></div>`
        )
        .join('');
    const rows = Array.from({ length: 10 }, () => {
        return (
            '<tr>' +
            '<td></td><td></td><td></td><td></td><td></td>' +
            '</tr>'
        );
    }).join('');
    return (
        `<div class="sp-print-kpis">${kpis}</div>` +
        `<div class="sp-pr-sub">تفاصيل النقط حسب المادة</div>` +
        `<table class="sp-bk-table"><thead><tr>` +
        `<th>المادة</th><th>فرض / نقطة</th><th>فرض / نقطة</th><th>المعدل</th><th>ملاحظات</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>`
    );
}

/** Empty absence KPIs + monthly grid for hand fill. */
function _spBlankAbsenceSection() {
    const kpiLabels = ['مجموع الساعات', 'ساعات مبررة', 'ساعات غير مبررة', 'عدد الحالات'];
    const kpis = kpiLabels
        .map(
            (lbl) =>
                `<div class="sp-print-kpi"><div class="sp-bk-input sp-bk-input-sm" style="min-width:40px;margin:0 auto"></div>` +
                `<div class="sp-print-kpi-lbl">${_spEsc(lbl)}</div></div>`
        )
        .join('');
    const monthRows = Array.from({ length: 8 }, () => '<tr><td></td><td></td><td></td><td></td></tr>').join('');
    return (
        `<div class="sp-print-kpis">${kpis}</div>` +
        `<div class="sp-pr-sub">تفصيل شهري</div>` +
        `<table class="sp-bk-table"><thead><tr>` +
        `<th>الشهر</th><th>مبررة</th><th>غير مبررة</th><th>المجموع</th>` +
        `</tr></thead><tbody>${monthRows}</tbody></table>` +
        `<div class="sp-pr-sub">ملاحظات الغياب</div><div class="sp-bk-textarea"></div>`
    );
}

/** Empty risk section: level line, axes, open sign chips, recommendation box. */
function _spBlankRiskSection() {
    const signs = [
        'غياب مفرط',
        'نقط ضعيفة جداً',
        'وضع اقتصادي هش',
        'مشاكل أسرية',
        'أعراض نفسية',
        'مشاكل صحية',
        'تراجع مستمر',
        'تنمر أو عنف'
    ];
    const chips = signs
        .map((s) => `<span class="sp-bk-badge"><span class="sp-bk-check"></span>${_spEsc(s)}</span>`)
        .join('');
    const axes = ['النتائج (A)', 'الغياب (B)', 'الاجتماعي (C)', 'الاقتصادي (D)', 'الصحي (E)'];
    const axisRows = axes
        .map(
            (a) =>
                `<div class="sp-pr-row"><span class="sp-pr-lbl">${_spEsc(a)}</span>` +
                `<span class="sp-bk-input sp-bk-input-sm"></span></div>`
        )
        .join('');
    return (
        `<div class="sp-pr-keep">` +
        `<div class="sp-pr-row"><span class="sp-pr-lbl">المستوى الإجمالي</span>` +
        `<span class="sp-bk-input" style="min-width:100px"></span></div>` +
        `<div style="background:#eef2f7;border:1px solid #d1d5db;border-radius:4px;height:8px;margin:4px 0 6px;"></div>` +
        `</div>` +
        `<div class="sp-pr-sub">تفصيل المحاور</div>${axisRows}` +
        `<div class="sp-pr-sub">علامات الخطر</div><div class="sp-bk-risk-signs">${chips}</div>` +
        `<div class="sp-pr-sub">التوصية</div><div class="sp-bk-textarea"></div>`
    );
}

/**
 * Assemble blank tracking card — same section order & panel style as
 * buildStudentPrintSheet, but every field is empty for handwriting.
 */
function buildBlankTrackingSheet() {
    const name = document.getElementById('sp-student-name')?.textContent.trim() || 'التلميذ';
    const avatarEl = document.querySelector('#sp-profile-header .sp-avatar');
    const initial = avatarEl ? avatarEl.textContent.trim() : name[0] || '?';
    const avatarColor = avatarEl ? getComputedStyle(avatarEl).backgroundColor || '#2563eb' : '#2563eb';
    const metaHtml = document.querySelector('#sp-profile-header .sp-meta')?.innerHTML || '';

    // Identity lines to fill if header meta is incomplete (still printable blank)
    const identityFill =
        `<div class="sp-pr-tiles" style="margin-top:6px">` +
        `<div class="sp-pr-tile"><div class="sp-pr-tile-lbl">الاسم الكامل</div><div class="sp-bk-input sp-bk-input-block"></div></div>` +
        `<div class="sp-pr-tile"><div class="sp-pr-tile-lbl">الرمز / مسار</div><div class="sp-bk-input sp-bk-input-block"></div></div>` +
        `<div class="sp-pr-tile"><div class="sp-pr-tile-lbl">القسم</div><div class="sp-bk-input sp-bk-input-block"></div></div>` +
        `<div class="sp-pr-tile"><div class="sp-pr-tile-lbl">السنة الدراسية</div><div class="sp-bk-input sp-bk-input-block"></div></div>` +
        `</div>`;

    let html = '';
    html +=
        `<div class="sp-pr-head">` +
        `<div class="sp-pr-avatar" style="background:${avatarColor}">${_spEsc(initial)}</div>` +
        `<div><div class="sp-pr-name">${_spEsc(name)}</div><div class="sp-pr-meta">${metaHtml}</div></div>` +
        `</div>`;

    html +=
        `<div class="sp-bk-hint"><i class="fas fa-pen"></i>` +
        `بطاقة تتبع فارغة — نفس ترتيب معاينة الطباعة. عبّئ الخانات بخط اليد ثم أدخل البيانات لاحقاً في النظام.` +
        `</div>`;

    // Optional hand-fill identity strip (useful if printing before opening a student)
    html += _spSection('fa-id-card', 'هوية التلميذ (تعبئة يدوية)', 'blue', identityFill);

    // Same order as buildStudentPrintSheet
    html += _spSection('fa-star', 'النتائج الدراسية', 'amber', _spBlankGradesSection());
    html += _spSection('fa-user-clock', 'الغياب والمواظبة', 'blue', _spBlankAbsenceSection());

    // Guidance form (all subject rows + stream + notes empty)
    html += _spSection(
        'fa-compass',
        'التوجيه المدرسي',
        'teal',
        _spBlankifySelector('#sp-guidance-block') || _spBlankifyPanel('sp-guidance-block')
    );

    // Economic + social as separate framed panels (all options visible empty)
    const ecoBody = _spBlankifySelector('#tab-socioeconomic .bm-panel-amber');
    const socialBody = _spBlankifySelector('#tab-socioeconomic .bm-panel-teal');
    const ecoOk = ecoBody && !ecoBody.includes('لا توجد حقول');
    const socialOk = socialBody && !socialBody.includes('لا توجد حقول');
    if (ecoOk || socialOk) {
        if (ecoOk) html += _spSection('fa-hand-holding-usd', 'الجانب الاقتصادي', 'amber', ecoBody);
        if (socialOk) html += _spSection('fa-users', 'الجانب الاجتماعي', 'teal', socialBody);
    } else {
        html += _spSection(
            'fa-hand-holding-heart',
            'الجانب الاقتصادي والاجتماعي',
            'amber',
            _spBlankifyPanel('tab-socioeconomic')
        );
    }

    // Health: prefer split panels if present, else whole tab
    const healthGreen = _spBlankifySelector('#tab-health .bm-panel-green');
    const healthPurple = _spBlankifySelector('#tab-health .bm-panel-purple');
    const hgOk = healthGreen && !healthGreen.includes('لا توجد حقول');
    const hpOk = healthPurple && !healthPurple.includes('لا توجد حقول');
    if (hgOk || hpOk) {
        if (hgOk) html += _spSection('fa-heartbeat', 'الجانب الصحي', 'green', healthGreen);
        if (hpOk) html += _spSection('fa-brain', 'الجانب النفسي', 'purple', healthPurple);
    } else {
        html += _spSection('fa-heartbeat', 'الجانب الصحي والنفسي', 'purple', _spBlankifyPanel('tab-health'));
    }

    html += _spSection('fa-tasks', 'المتابعة والتدخل', 'blue', _spBlankifyPanel('tab-followup'));
    html += _spSection('fa-exclamation-triangle', 'مؤشر الخطر', 'red', _spBlankRiskSection());

    let wrap = document.getElementById('sp-blank-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'sp-blank-wrap';
        wrap.style.display = 'none';
        document.body.appendChild(wrap);
    }
    wrap.innerHTML = `<div id="sp-blank-sheet" class="sp-export-sheet sp-blank-sheet">${html}</div>`;

    // Reuse tall-panel flow marking (query within blank sheet)
    try {
        const sheet = document.getElementById('sp-blank-sheet');
        if (sheet) {
            const PX_PER_MM = 96 / 25.4;
            const MAX_KEEP_PX = Math.round((297 - 10 - 28) * PX_PER_MM);
            wrap.style.display = 'block';
            wrap.style.position = 'absolute';
            wrap.style.left = '-99999px';
            wrap.style.width = '190mm';
            wrap.style.visibility = 'hidden';
            sheet.querySelectorAll('.sp-pr-panel').forEach((panel) => {
                panel.classList.remove('sp-pr-panel--flow');
                if (panel.getBoundingClientRect().height > MAX_KEEP_PX) {
                    panel.classList.add('sp-pr-panel--flow');
                }
            });
            wrap.style.display = 'none';
            wrap.style.position = '';
            wrap.style.left = '';
            wrap.style.width = '';
            wrap.style.visibility = '';
        }
    } catch (_) {
        /* measure is best-effort */
    }
}
