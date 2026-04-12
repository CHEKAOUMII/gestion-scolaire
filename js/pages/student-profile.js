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

// ─── Grade color helper ───
function gradeColor(val) {
    if (val >= 16) return '#2ECC71';
    if (val >= 14) return '#3b82f6';
    if (val >= 12) return '#f59e0b';
    if (val >= 10) return '#f97316';
    return '#E85D5D';
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

    await loadStudentProfile(code);
});

// ─── Tab Switching ───
function initTabs() {
    const tabBtns = document.querySelectorAll('.sp-tab-btn');
    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            // Deactivate all
            tabBtns.forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.sp-tab-content').forEach((c) => c.classList.remove('active'));

            // Activate clicked
            btn.classList.add('active');
            const target = btn.dataset.tab;
            document.getElementById(target)?.classList.add('active');
        });
    });
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
            <span class="sp-info-value"><i class="fas ${getGenderIcon(student.gender)}" style="margin-left: 6px;"></i>${genderLabel}</span>
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
        avgEl.innerHTML = `<span style="color: ${gradeColor(generalAvg)}">${generalAvg.toFixed(2)}</span>`;
    }
    if (subjectsEl) {
        subjectsEl.textContent = subjects.length;
    }
    if (absEl) {
        absEl.innerHTML = `<span style="color: ${totalAbsHours > 10 ? '#E85D5D' : '#2ECC71'}">${totalAbsHours}</span>`;
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
                <div class="sp-kpi-val" style="color: ${gradeColor(generalAvg)}">${generalAvg.toFixed(2)}</div>
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
                <div class="sp-kpi-val" style="color: #2ECC71">${maxGrade.toFixed(1)}</div>
                <div class="sp-kpi-label">أعلى نقطة</div>
            </div>
            <div class="sp-kpi">
                <div class="sp-kpi-val" style="color: #E85D5D">${minGrade.toFixed(1)}</div>
                <div class="sp-kpi-label">أدنى نقطة</div>
            </div>
        </div>
    `;

    // Subject visual chart (horizontal bars)
    html += `<div class="sp-subjects-chart">`;
    subjectAvgsArr.forEach(({ subject, avg }) => {
        const pct = Math.min((avg / 20) * 100, 100);
        const clr = gradeColor(avg);
        html += `
            <div class="sp-chart-row">
                <span class="sp-chart-label">${escapeHtml(subject)}</span>
                <div class="sp-chart-bar-track">
                    <div class="sp-chart-bar-fill" style="width: ${pct}%; background: ${clr};"></div>
                </div>
                <span class="sp-chart-val" style="color: ${clr}">${avg.toFixed(2)}</span>
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
        const clr = gradeColor(avg);

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
                            const gc = gradeColor(g.grade);
                            const pct = Math.min((g.grade / 20) * 100, 100);
                            const isActv = typeof ccIsActivity === 'function' && ccIsActivity(g.subject);
                            const chipLabel = isActv ? 'أنشطة مندمجة' : `فرض ${++examIdx}`;
                            return `<div class="sp-grade-chip">
                        <span class="chip-label">${chipLabel}</span>
                        <span class="chip-value" style="color:${gc}">${g.grade.toFixed(2)}</span>
                        <div class="chip-bar"><div class="chip-bar-fill" style="width:${pct}%;background:${gc}"></div></div>
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
                    const gc = gradeColor(g.grade);
                    const pct = Math.min((g.grade / 20) * 100, 100);
                    const isActv = typeof ccIsActivity === 'function' && ccIsActivity(g.subject);
                    const chipLabel = isActv ? 'أنشطة مندمجة' : `فرض ${++examIdx}`;
                    return `<div class="sp-grade-chip">
                    <span class="chip-label">${chipLabel}</span>
                    <span class="chip-value" style="color:${gc}">${g.grade.toFixed(2)}</span>
                    <div class="chip-bar"><div class="chip-bar-fill" style="width:${pct}%;background:${gc}"></div></div>
                </div>`;
                })
                .join('');
            bodyHtml = `<div class="sp-grades-chips">${chips}</div>`;
        }

        html += `
            <div class="sp-subject-block">
                <div class="sp-subject-header">
                    <span class="sp-subj-name"><i class="fas fa-book"></i> ${escapeHtml(subj)}</span>
                    <span class="sp-subj-avg" style="background: ${clr}">${avg.toFixed(2)}</span>
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
                <i class="fas fa-check-circle" style="color: #2ECC71;"></i>
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
                <div class="sp-kpi-val" style="color: ${totalHours > 10 ? '#E85D5D' : '#2ECC71'}">${totalHours}</div>
                <div class="sp-kpi-label">مجموع الساعات</div>
            </div>
            <div class="sp-kpi">
                <div class="sp-kpi-val" style="color: #2ECC71">${justifiedHours}</div>
                <div class="sp-kpi-label">ساعات مبررة</div>
            </div>
            <div class="sp-kpi">
                <div class="sp-kpi-val" style="color: #E85D5D">${unjustifiedHours}</div>
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
                                <td style="color: #2ECC71; font-weight: 700;">${data.justified}</td>
                                <td style="color: #E85D5D; font-weight: 700;">${data.unjustified}</td>
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
