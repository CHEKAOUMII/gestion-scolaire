/**
 * Student Profile Page — Dynamic Data Controller
 * صفحة ملف التلميذ — المتحكم الديناميكي
 */

const SCHOOL_YEAR = getSchoolYear();

// ─── Gender helpers (shared with students-list.js) ───
function isMale(gender) {
    const g = String(gender || '')
        .trim()
        .toLowerCase();
    return g === 'm' || g === 'male' || g === 'ذكر';
}
function isFemale(gender) {
    const g = String(gender || '')
        .trim()
        .toLowerCase();
    return g === 'f' || g === 'female' || g === 'أنثى';
}
function getGenderLabel(gender) {
    if (isMale(gender)) return 'ذكر';
    if (isFemale(gender)) return 'أنثى';
    return '-';
}
function getGenderIcon(gender) {
    if (isMale(gender)) return 'fa-mars';
    if (isFemale(gender)) return 'fa-venus';
    return 'fa-genderless';
}

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

    // Back button
    document.getElementById('sp-back-btn')?.addEventListener('click', () => {
        window.location.href = 'students-list.html';
    });

    // Print button
    document.getElementById('sp-print-btn')?.addEventListener('click', () => {
        PrintSystem.preview({ title: 'ملف التلميذ', pageSize: 'A4' });
    });

    if (!code) {
        showNoStudentState();
        return;
    }

    // Initialize profile save system
    initSaveButtons();
    initDirtyTracking();
    initUnsavedWarning();

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

        // Load grades, absences in parallel
        const [allGrades, allAbsences] = await Promise.all([
            window.api.grades.getAll(SCHOOL_YEAR).catch(() => []),
            window.api.absences.getAll(SCHOOL_YEAR).catch(() => [])
        ]);

        const studentGrades = (allGrades || [])
            .filter((g) => String(g.student_code || g.student_id || '').trim() === code.trim())
            .map((g) => ({ ...g, grade: Number(g.grade) }))
            .filter((g) => Number.isFinite(g.grade));

        const studentAbsences = (allAbsences || []).filter((a) => String(a.student_code || '').trim() === code.trim());

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
    // Calculate general average
    const dedup = {};
    grades.forEach((g) => {
        const key = `${String(g.subject || '').trim()}||${g.semester || ''}`;
        dedup[key] = g;
    });
    const dedupedGrades = Object.values(dedup);

    const bySubject = {};
    dedupedGrades.forEach((g) => {
        const subj =
            (typeof ccBaseSubject === 'function'
                ? ccBaseSubject(normalizeSubjectName(g.subject))
                : normalizeSubjectName(g.subject)) || 'غير محدد';
        if (!bySubject[subj]) bySubject[subj] = [];
        bySubject[subj].push(g);
    });

    const subjects = Object.keys(bySubject);
    const subjectAvgsArr = subjects.map((s) => {
        const avg =
            typeof computeSubjectAverage === 'function'
                ? computeSubjectAverage(s, bySubject[s])
                : bySubject[s].reduce((a, g) => a + g.grade, 0) / bySubject[s].length;
        return { subject: s, avg };
    });

    const branch =
        typeof detectBranch === 'function' ? detectBranch(student.section || student.class_name || '') : null;
    const generalAvg =
        typeof computeWeightedGeneralAverage === 'function'
            ? computeWeightedGeneralAverage(subjectAvgsArr, branch)
            : subjectAvgsArr.length
              ? subjectAvgsArr.reduce((a, s) => a + s.avg, 0) / subjectAvgsArr.length
              : 0;

    // Absence hours
    let justifiedHours = 0;
    let unjustifiedHours = 0;
    absences.forEach((a) => {
        const h = Number(a.hours) || 0;
        if (a.absence_type === 'justified') justifiedHours += h;
        else if (a.absence_type === 'unjustified') unjustifiedHours += h;
    });
    const totalAbsHours = justifiedHours + unjustifiedHours;

    // Update mini stats
    const avgEl = document.getElementById('sp-stat-avg');
    const subjectsEl = document.getElementById('sp-stat-subjects');
    const absEl = document.getElementById('sp-stat-absence');

    if (avgEl) {
        avgEl.innerHTML = `<span style="color:${gradeHex(generalAvg)}">${generalAvg.toFixed(2)}</span>`;
    }
    if (subjectsEl) {
        subjectsEl.textContent = subjects.length;
    }
    if (absEl) {
        absEl.innerHTML = `<span style="color:${totalAbsHours > 10 ? '#f44336' : '#4caf50'}">${totalAbsHours}</span>`;
    }
}

// ─── Render Grades Tab ───
function renderGradesTab(student, rawGrades) {
    const container = document.getElementById('sp-grades-content');
    if (!container) return;

    // Deduplicate
    const dedup = {};
    rawGrades.forEach((g) => {
        const key = `${String(g.subject || '').trim()}||${g.semester || ''}`;
        dedup[key] = g;
    });
    const studentGrades = Object.values(dedup);

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

    const branch =
        typeof detectBranch === 'function' ? detectBranch(student.section || student.class_name || '') : null;
    const generalAvg =
        typeof computeWeightedGeneralAverage === 'function'
            ? computeWeightedGeneralAverage(subjectAvgsArr, branch)
            : subjectAvgsArr.length
              ? subjectAvgsArr.reduce((a, s) => a + s.avg, 0) / subjectAvgsArr.length
              : 0;
    const maxGrade = Math.max(...studentGrades.map((g) => g.grade));
    const minGrade = Math.min(...studentGrades.map((g) => g.grade));

    let html = `
        <div class="sp-kpis-row">
            <div class="sp-kpi">
                <div class="sp-kpi-val" style="color:${gradeHex(generalAvg)}">${generalAvg.toFixed(2)}</div>
                <div class="sp-kpi-label">المعدل العام</div>
            </div>
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
            // Extract color from onclick attribute
            const onclickStr = el.getAttribute('onclick') || '';
            const colorMatch = onclickStr.match(/bmTog\(this,'(\w+)'/);
            const badgeColor = colorMatch ? colorMatch[1] : 'blue';
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
        const onclickStr = badge.getAttribute('onclick') || '';
        const colorMatch = onclickStr.match(/bmTog\(this,'(\w+)'/);
        const color = colorMatch ? colorMatch[1] : 'amber';
        badge.className = 'bm-badge bm-badge-' + color;
        badge.setAttribute('aria-checked', 'true');
    }
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
