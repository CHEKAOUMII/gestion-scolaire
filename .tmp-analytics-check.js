const year = '2025/2026';
        const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js';
        let detailChart = null;
        let barChart = null;
        let donutChart = null;
        let zeroSectionsChart = null;
        let chartLoaderPromise = null;
        let analyzeInProgress = false;
        let allSections = [];
        let allGradesCache = [];
        let sectionToLevel = {};
        const gradeBands = [
            { key: 'excellent', label: 'ممتاز', min: 16, max: 20, color: '#2FB36D' },
            { key: 'veryGood', label: 'حسن جدا', min: 14, max: 16, color: '#3C95D0' },
            { key: 'good', label: 'حسن', min: 12, max: 14, color: '#F0C20E' },
            { key: 'acceptable', label: 'مقبول', min: 10, max: 12, color: '#E67F22' },
            { key: 'weak', label: 'ضعيف', min: 0, max: 10, color: '#E74C3C' }
        ];

        document.addEventListener('DOMContentLoaded', async () => {
            try {
                await loadFilters();

                const analyzeBtn = document.getElementById('analyze-btn');
                if (analyzeBtn) analyzeBtn.addEventListener('click', analyze);

                const levelSelect = document.getElementById('level-select');
                const classSelect = document.getElementById('class-select');
                const typeSelect = document.getElementById('analysis-type');

                // Cascading: Level → Class → Subject
                if (levelSelect) {
                    levelSelect.addEventListener('change', () => {
                        renderClassOptions(levelSelect.value);
                        renderSubjectOptions(levelSelect.value, '');
                        renderTeacherSubjectOptions(levelSelect.value, '');
                    });
                }

                if (classSelect) {
                    classSelect.addEventListener('change', () => {
                        const levelName = levelSelect ? levelSelect.value : '';
                        renderSubjectOptions(levelName, classSelect.value);
                        renderTeacherSubjectOptions(levelName, classSelect.value);
                    });
                }

                if (typeSelect) {
                    typeSelect.addEventListener('change', () => {
                        const levelName = levelSelect ? levelSelect.value : '';
                        const className = classSelect ? classSelect.value : '';
                        renderTeacherSubjectOptions(levelName, className);
                        toggleTeacherSubjectFilter();
                    });
                }

                const form = document.getElementById('analysis-form');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        await analyze();
                    });
                }

                await analyze();
            } catch (error) {
                console.error('Analytics init error:', error);
                showToast('تعذر تحميل صفحة التحليل', 'error');
            }
        });

        function ensureChartJsLoaded() {
            if (window.Chart) return Promise.resolve(window.Chart);
            if (chartLoaderPromise) return chartLoaderPromise;

            chartLoaderPromise = new Promise((resolve, reject) => {
                const existing = document.querySelector(`script[data-dynamic-src="${CHART_JS_CDN}"]`);
                if (existing) {
                    existing.addEventListener('load', () => resolve(window.Chart), { once: true });
                    existing.addEventListener('error', () => reject(new Error('تعذر تحميل مكتبة الرسوم البيانية')), { once: true });
                    return;
                }

                const script = document.createElement('script');
                script.src = CHART_JS_CDN;
                script.async = true;
                script.defer = true;
                script.dataset.dynamicSrc = CHART_JS_CDN;
                script.onload = () => resolve(window.Chart);
                script.onerror = () => reject(new Error('تعذر تحميل مكتبة الرسوم البيانية'));
                document.head.appendChild(script);
            });

            return chartLoaderPromise;
        }

        function destroyAnalysisCharts() {
            if (detailChart) detailChart.destroy();
            if (barChart) barChart.destroy();
            if (donutChart) donutChart.destroy();
            if (zeroSectionsChart) zeroSectionsChart.destroy();
            detailChart = null;
            barChart = null;
            donutChart = null;
            zeroSectionsChart = null;
        }

        function asNumber(value) {
            const n = Number(value);
            return Number.isFinite(n) ? n : NaN;
        }

        function avg(values) {
            if (!values.length) return 0;
            return values.reduce((s, x) => s + x, 0) / values.length;
        }

        function percentage(part, whole) {
            if (!whole) return 0;
            return (part / whole) * 100;
        }

        function median(values) {
            if (!values.length) return 0;
            const sorted = [...values].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        }

        function stdDev(values) {
            if (values.length < 2) return 0;
            const m = avg(values);
            const variance = values.reduce((s, x) => s + (x - m) ** 2, 0) / values.length;
            return Math.sqrt(variance);
        }

        function studentIdentity(record) {
            return String(record.student_id || record.student_code || record.full_name || 'غير محدد');
        }

        function studentLabel(record) {
            return String(record.full_name || record.student_code || record.student_id || 'غير محدد');
        }

        function tooltipLabelWithPercent(context, total) {
            const label = context.label || '';
            const value = Number(context.raw || 0);
            const pct = percentage(value, total);
            return `${label}: ${value} (${pct.toFixed(1)}%)`;
        }

        function getLevelFromSection(section) {
            const s = String(section || '').trim();
            if (!s) return '';
            if (sectionToLevel[s]) return sectionToLevel[s];

            const compact = s.replace(/[\s_]/g, '').toUpperCase();
            if (compact.startsWith('TCS')) return 'الجذع المشترك';
            if (compact.startsWith('1BACSEF')) return 'الأولى باكالوريا العلوم التجريبية – خيار فرنسية';
            if (compact.startsWith('1BACSMF')) return 'الأولى باكالوريا العلوم الرياضية – خيار فرنسية';
            if (compact.startsWith('1BACSH')) return 'الأولى باكالوريا العلوم الإنسانية';
            if (compact.startsWith('1BACSEG')) return 'الأولى باكالوريا العلوم الاقتصادية والتدبير';
            if (compact.startsWith('1BAC')) return 'الأولى باكالوريا';
            if (compact.startsWith('2BACSPF')) return 'الثانية باكالوريا العلوم الفيزيائية – خيار فرنسية';
            if (compact.startsWith('2BACSE')) return 'الثانية باكالوريا علوم الحياة والأرض';
            if (compact.startsWith('2BACSH')) return 'الثانية باكالوريا العلوم الإنسانية';
            if (compact.startsWith('2BAC')) return 'الثانية باكالوريا';

            if (s.includes('-')) return s.split('-')[0].trim();
            if (s.includes(' ')) return s.split(' ')[0].trim();
            return s;
        }

        function renderClassOptions(selectedLevel = '') {
            const classSelect = document.getElementById('class-select');
            if (!classSelect) return;
            classSelect.innerHTML = '<option value="">كل الأقسام</option>';

            const list = selectedLevel
                ? allSections.filter(section => getLevelFromSection(section) === selectedLevel)
                : allSections.slice();

            list
                .sort((a, b) => String(a).localeCompare(String(b), 'ar'))
                .forEach(section => {
                    const opt = document.createElement('option');
                    opt.value = section;
                    opt.textContent = section;
                    classSelect.appendChild(opt);
                });
        }

        function getAvailableSubjects(selectedLevel = '', selectedClass = '') {
            let filteredGrades = allGradesCache;
            if (selectedClass) {
                filteredGrades = filteredGrades.filter(g => (g.section || '') === selectedClass);
            } else if (selectedLevel) {
                filteredGrades = filteredGrades.filter(g => getLevelFromSection(g.section) === selectedLevel);
            }

            const subjects = new Set();
            const invalidSubjectNames = ['sheet', 'sheet1', 'feuil1', 'notes', 'notescc', 'note', 'ورقة1', 'ورقة'];
            filteredGrades.forEach(g => {
                if (g.subject) {
                    const normalizedSubject = normalizeSubjectName(g.subject);
                    const normalized = normalizedSubject.toLowerCase();
                    if (!invalidSubjectNames.includes(normalized)) {
                        subjects.add(normalizedSubject);
                    }
                }
            });

            return Array.from(subjects).sort((a, b) => String(a).localeCompare(String(b), 'ar'));
        }

        function renderSubjectOptions(selectedLevel = '', selectedClass = '') {
            const subjectSelect = document.getElementById('subject-select');
            if (!subjectSelect) return;
            subjectSelect.innerHTML = '<option value="">كل المواد</option>';

            getAvailableSubjects(selectedLevel, selectedClass).forEach(subject => {
                const opt = document.createElement('option');
                opt.value = subject;
                opt.textContent = subject;
                subjectSelect.appendChild(opt);
            });
        }

        function renderTeacherSubjectOptions(selectedLevel = '', selectedClass = '') {
            const teacherSubjectSelect = document.getElementById('teacher-subject-select');
            if (!teacherSubjectSelect) return;
            const previousValue = teacherSubjectSelect.value;
            teacherSubjectSelect.innerHTML = '<option value="">كل المواد (مقارنة الأساتذة)</option>';

            getAvailableSubjects(selectedLevel, selectedClass).forEach(subject => {
                const opt = document.createElement('option');
                opt.value = subject;
                opt.textContent = subject;
                teacherSubjectSelect.appendChild(opt);
            });

            if (previousValue && Array.from(teacherSubjectSelect.options).some(opt => opt.value === previousValue)) {
                teacherSubjectSelect.value = previousValue;
            }
        }

        function toggleTeacherSubjectFilter() {
            const typeSelect = document.getElementById('analysis-type');
            const subjectSelect = document.getElementById('subject-select');
            const teacherSubjectSelect = document.getElementById('teacher-subject-select');
            if (!typeSelect || !subjectSelect || !teacherSubjectSelect) return;

            const isTeacherMode = typeSelect.value === 'teachers';
            subjectSelect.style.display = isTeacherMode ? 'none' : '';
            teacherSubjectSelect.style.display = isTeacherMode ? '' : 'none';
        }

        // Calculate general average per student (average of all subject averages)
        function calculateStudentGeneralAverage(grades, studentId) {
            const studentGrades = grades.filter(g => studentIdentity(g) === studentId);
            const bySubject = {};
            studentGrades.forEach(g => {
                const subject = normalizeSubjectName(g.subject);
                if (!bySubject[subject]) bySubject[subject] = [];
                bySubject[subject].push(g.grade);
            });
            const subjectAverages = Object.values(bySubject).map(arr => avg(arr));
            return avg(subjectAverages);
        }

        function normalizeSubjectName(subject) {
            const clean = String(subject || '')
                .replace(/\s*\(\s*فرض\s*\d+\s*\)\s*$/i, '')
                .replace(/\s*\(الأنشطة المندمجة\)\s*$/, '')
                .trim();
            return clean || 'غير محدد';
        }

        function normalizeLoose(value) {
            return String(value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim()
                .toLowerCase()
                .replace(/[\u064B-\u065F]/g, '')
                .replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
        }

        function sanitizeTeacherName(value) {
            const raw = String(value || '')
                .replace(/_/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (!raw) return '';
            if (/^\d+([.,]\d+)?$/.test(raw)) return '';

            const normalized = normalizeLoose(raw);
            if (!normalized) return '';

            const invalidExact = new Set([
                'teacher',
                'teachername',
                'enseignant',
                'prof',
                'professeur',
                'استاذ',
                'الاستاذ',
                'الأستاذ',
                'ملاحظات',
                'ملاحظة',
                'ملاحظاتالاستاذ',
                'ملاحظاتالأستاذ',
                'notes',
                'note',
                'observation',
                'observations',
                'comment',
                'comments',
                'remarque',
                'remarques',
                'غيرمحدد',
                'unknown',
                'na',
                'n/a'
            ].map(normalizeLoose));
            if (invalidExact.has(normalized)) return '';

            const invalidContains = ['ملاحظات', 'ملاحظة', 'observation', 'comment', 'remarque', 'notes', 'note'].map(
                normalizeLoose
            );
            if (invalidContains.some((x) => normalized.includes(x))) return '';

            return raw;
        }

        function buildTeacherPerformanceRows(grades) {
            const byTeacher = new Map();
            grades.forEach(g => {
                const teacher = sanitizeTeacherName(g.teacher_name);
                if (!teacher) return;

                let agg = byTeacher.get(teacher);
                if (!agg) {
                    agg = { sum: 0, count: 0, pass: 0, students: new Set() };
                    byTeacher.set(teacher, agg);
                }

                agg.sum += g.grade;
                agg.count += 1;
                if (g.grade >= 10) agg.pass += 1;
                agg.students.add(studentIdentity(g));
            });

            return Array.from(byTeacher.entries())
                .map(([name, stats]) => ({
                    name,
                    avg: stats.count ? stats.sum / stats.count : 0,
                    passRate: stats.count ? percentage(stats.pass, stats.count) : 0,
                    gradeCount: stats.count,
                    studentCount: stats.students.size
                }))
                .sort((a, b) => b.avg - a.avg || b.passRate - a.passRate || b.gradeCount - a.gradeCount);
        }

        async function loadFilters() {
            const levelSelect = document.getElementById('level-select');
            const students = await window.api.students.getAll(year) || [];
            const grades = await window.api.grades.getAll(year) || [];
            allGradesCache = grades;

            // Debug: Log loaded data
            console.log('Analytics - Students loaded:', students.length);
            console.log('Analytics - Grades loaded:', grades.length);
            if (grades.length > 0) {
                console.log('Analytics - Sample grade:', grades[0]);
                console.log('Analytics - Unique subjects:', [...new Set(grades.map(g => normalizeSubjectName(g.subject)).filter(Boolean))]);
            }

            const mappingRaw = await window.api.settings.get('levelsMapping');
            let parsedMapping = {};
            try { parsedMapping = mappingRaw ? JSON.parse(mappingRaw) : {}; } catch (_) { parsedMapping = {}; }
            sectionToLevel = parsedMapping || {};

            const sections = new Set();
            const levels = new Set();
            students.forEach(s => { if (s.section) sections.add(s.section); });
            grades.forEach(g => { if (g.section) sections.add(g.section); });
            allSections = Array.from(sections);
            sections.forEach(section => {
                const level = getLevelFromSection(section);
                if (level) levels.add(level);
            });

            renderClassOptions('');
            renderSubjectOptions('', '');
            renderTeacherSubjectOptions('', '');
            toggleTeacherSubjectFilter();

            Array.from(levels)
                .sort((a, b) => String(a).localeCompare(String(b), 'ar'))
                .forEach(level => {
                    const opt = document.createElement('option');
                    opt.value = level;
                    opt.textContent = level;
                    levelSelect.appendChild(opt);
                });
        }

        async function analyze() {
            if (analyzeInProgress) return;

            const analyzeBtn = document.getElementById('analyze-btn');
            analyzeInProgress = true;
            if (analyzeBtn) {
                analyzeBtn.disabled = true;
                analyzeBtn.setAttribute('aria-busy', 'true');
            }

            try {
                const className = document.getElementById('class-select').value;
                const levelName = document.getElementById('level-select').value;
                const subjectName = document.getElementById('subject-select').value;
                const teacherSubjectName = document.getElementById('teacher-subject-select')?.value || '';
                const type = document.getElementById('analysis-type').value;

                const allGrades = allGradesCache.length ? allGradesCache : await window.api.grades.getAll(year) || [];
                const grades = allGrades
                    .map(g => ({ ...g, grade: asNumber(g.grade) }))
                    .filter(g => Number.isFinite(g.grade));

                let filtered = grades;
                if (className) filtered = filtered.filter(g => (g.section || '') === className);
                if (levelName) filtered = filtered.filter(g => getLevelFromSection(g.section) === levelName);
                if (type === 'teachers') {
                    if (teacherSubjectName) filtered = filtered.filter(g => normalizeSubjectName(g.subject) === teacherSubjectName);
                } else if (subjectName) {
                    filtered = filtered.filter(g => normalizeSubjectName(g.subject) === subjectName);
                }

                if (!filtered.length) {
                    document.getElementById('analysis-kpis').innerHTML = '';
                    document.getElementById('analysis-progress').innerHTML = '';
                    document.getElementById('analysis-summary').innerHTML = '<p>لا توجد معطيات نقط مطابقة للفلاتر الحالية.</p>';
                    document.getElementById('zero-students-list').innerHTML = '<p>لا توجد معطيات.</p>';
                    destroyAnalysisCharts();
                    showToast('لا توجد معطيات للتحليل', 'warning');
                    return;
                }

                await ensureChartJsLoaded();

                const passCount = filtered.filter(g => g.grade >= 10).length;
                const passRate = filtered.length ? (passCount / filtered.length) * 100 : 0;
                const globalAvg = avg(filtered.map(g => g.grade));
                const excellenceCount = filtered.filter(g => g.grade >= 16).length;
                const zeroCount = filtered.filter(g => g.grade === 0).length;
                const sectionsCount = new Set(filtered.map(g => g.section || 'غير محدد')).size;
                const studentCount = new Set(filtered.map(studentIdentity)).size;
                const minGrade = Math.min(...filtered.map(g => g.grade));
                const maxGrade = Math.max(...filtered.map(g => g.grade));

                // Calculate subject and student averages in one pass
                const subjectStats = new Map();
                const studentStats = new Map();
                filtered.forEach(g => {
                    const subject = normalizeSubjectName(g.subject);

                    const subjectAgg = subjectStats.get(subject) || { sum: 0, count: 0 };
                    subjectAgg.sum += g.grade;
                    subjectAgg.count += 1;
                    subjectStats.set(subject, subjectAgg);

                    const id = studentIdentity(g);
                    let studentAgg = studentStats.get(id);
                    if (!studentAgg) {
                        studentAgg = new Map();
                        studentStats.set(id, studentAgg);
                    }

                    const studentSubjectAgg = studentAgg.get(subject) || { sum: 0, count: 0 };
                    studentSubjectAgg.sum += g.grade;
                    studentSubjectAgg.count += 1;
                    studentAgg.set(subject, studentSubjectAgg);
                });

                const subjectAverages = Array.from(subjectStats.entries(), ([subject, stats]) => ({
                    subject,
                    avg: stats.sum / stats.count
                }));
                const overallSubjectAvg = avg(subjectAverages.map(s => s.avg));

                const studentGeneralAverages = Array.from(studentStats.values(), bySubject => {
                    const studentSubjectAvgs = Array.from(bySubject.values(), stats => stats.sum / stats.count);
                    return avg(studentSubjectAvgs);
                });
                const generalAvg = avg(studentGeneralAverages);

                const distribution = gradeBands.map(band => {
                    const count = filtered.filter(g => g.grade >= band.min && g.grade < band.max + (band.max === 20 ? 0.001 : 0)).length;
                    return {
                        ...band,
                        count,
                        ratio: percentage(count, filtered.length)
                    };
                });

                const gradeValues = filtered.map(g => g.grade);
                const medianGrade = median(gradeValues);
                const stdDevGrade = stdDev(gradeValues);

                document.getElementById('analysis-kpis').innerHTML = `
                    <div class="analysis-kpi-card">
                        <div class="analysis-kpi-icon" style="background: var(--gradient-primary);"><i class="fas fa-users"></i></div>
                        <div class="analysis-kpi-label">عدد التلاميذ</div>
                        <div class="analysis-kpi-value">${studentCount}</div>
                        <div class="analysis-kpi-sub">${sectionsCount} قسم · ${subjectStats.size} مادة</div>
                    </div>
                    <div class="analysis-kpi-card">
                        <div class="analysis-kpi-icon" style="background: linear-gradient(135deg, var(--color-success), #38ef7d);"><i class="fas fa-calculator"></i></div>
                        <div class="analysis-kpi-label">المعدل العام</div>
                        <div class="analysis-kpi-value">${generalAvg.toFixed(2)}</div>
                        <div class="analysis-kpi-sub">الوسيط: ${medianGrade.toFixed(2)}</div>
                    </div>
                    <div class="analysis-kpi-card">
                        <div class="analysis-kpi-icon" style="background: linear-gradient(135deg, var(--color-warning), #ffd200);"><i class="fas fa-chart-area"></i></div>
                        <div class="analysis-kpi-label">الانحراف المعياري</div>
                        <div class="analysis-kpi-value">${stdDevGrade.toFixed(2)}</div>
                        <div class="analysis-kpi-sub">أدنى: ${minGrade.toFixed(1)} · أعلى: ${maxGrade.toFixed(1)}</div>
                    </div>
                    <div class="analysis-kpi-card">
                        <div class="analysis-kpi-icon" style="background: linear-gradient(135deg, #a770ef, #cf8bf3);"><i class="fas fa-trophy"></i></div>
                        <div class="analysis-kpi-label">نسبة النجاح</div>
                        <div class="analysis-kpi-value">${passRate.toFixed(1)}%</div>
                        <div class="analysis-kpi-sub">${passCount} ناجح من ${filtered.length} نقطة</div>
                    </div>
                    <div class="analysis-kpi-card">
                        <div class="analysis-kpi-icon" style="background: linear-gradient(135deg, var(--color-danger), #ff9a76);"><i class="fas fa-star"></i></div>
                        <div class="analysis-kpi-label">نسبة التفوق</div>
                        <div class="analysis-kpi-value">${percentage(excellenceCount, filtered.length).toFixed(1)}%</div>
                        <div class="analysis-kpi-sub">${excellenceCount} بنقطة ≥ 16</div>
                    </div>
                    <div class="analysis-kpi-card">
                        <div class="analysis-kpi-icon" style="background: linear-gradient(135deg, var(--info), #89bfe8);"><i class="fas fa-exclamation-triangle"></i></div>
                        <div class="analysis-kpi-label">الحاصلون على 0</div>
                        <div class="analysis-kpi-value">${zeroCount}</div>
                        <div class="analysis-kpi-sub">${percentage(zeroCount, filtered.length).toFixed(1)}% من المجموع</div>
                    </div>
                `;

                const improved = filtered.filter(g => g.grade >= 12).length;
                const stable = filtered.filter(g => g.grade >= 10 && g.grade < 12).length;
                const declined = filtered.filter(g => g.grade < 10).length;
                document.getElementById('analysis-progress').innerHTML = `
                    <div class="analysis-progress-item">
                        <div class="analysis-progress-title"><i class="fas fa-arrow-trend-up"></i> نقط 12 فأكثر (جيد وأعلى)</div>
                        <div class="analysis-progress-track"><div class="analysis-progress-value" style="width:${percentage(improved, filtered.length).toFixed(1)}%; background:linear-gradient(90deg, var(--color-success), #38ef7d);">${percentage(improved, filtered.length).toFixed(0)}%</div></div>
                        <div class="analysis-progress-meta"><span>${percentage(improved, filtered.length).toFixed(1)}%</span><span>${improved} نقطة</span></div>
                    </div>
                    <div class="analysis-progress-item">
                        <div class="analysis-progress-title"><i class="fas fa-minus"></i> نقط 10 - 12 (مقبول)</div>
                        <div class="analysis-progress-track"><div class="analysis-progress-value" style="width:${percentage(stable, filtered.length).toFixed(1)}%; background:linear-gradient(90deg, var(--color-warning), #ffd200);">${percentage(stable, filtered.length).toFixed(0)}%</div></div>
                        <div class="analysis-progress-meta"><span>${percentage(stable, filtered.length).toFixed(1)}%</span><span>${stable} نقطة</span></div>
                    </div>
                    <div class="analysis-progress-item">
                        <div class="analysis-progress-title"><i class="fas fa-arrow-trend-down"></i> نقط أقل من 10 (ضعيف)</div>
                        <div class="analysis-progress-track"><div class="analysis-progress-value" style="width:${percentage(declined, filtered.length).toFixed(1)}%; background:linear-gradient(90deg, var(--color-danger), #ff9a76);">${percentage(declined, filtered.length).toFixed(0)}%</div></div>
                        <div class="analysis-progress-meta"><span>${percentage(declined, filtered.length).toFixed(1)}%</span><span>${declined} نقطة</span></div>
                    </div>
                `;

                const summaryRows = distribution.map(row => {
                    const maxLabel = row.max === 20 ? '20' : (row.max - 0.01).toFixed(2);
                    return `
                        <tr>
                            <td><span class="analysis-grade-pill" style="background:${row.color};">${row.label}</span></td>
                            <td>${row.min} - ${maxLabel}</td>
                            <td>${row.count}</td>
                            <td>${row.ratio.toFixed(1)}%</td>
                        </tr>
                    `;
                }).join('');
                document.getElementById('analysis-summary').innerHTML = `
                    <table class="analysis-summary-table">
                        <thead>
                            <tr>
                                <th>التقدير</th>
                                <th>النطاق</th>
                                <th>عدد التلاميذ</th>
                                <th>النسبة</th>
                            </tr>
                        </thead>
                        <tbody>${summaryRows}</tbody>
                    </table>
                `;

                const zeroByStudent = {};
                filtered.forEach(g => {
                    if (g.grade !== 0) return;
                    const key = studentIdentity(g);
                    if (!zeroByStudent[key]) {
                        zeroByStudent[key] = {
                            label: studentLabel(g),
                            section: g.section || 'غير محدد',
                            count: 0
                        };
                    }
                    zeroByStudent[key].count += 1;
                });
                const topZeroStudents = Object.values(zeroByStudent)
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5);
                document.getElementById('zero-students-list').innerHTML = topZeroStudents.length
                    ? topZeroStudents.map((s, i) => `
                        <div class="analysis-zero-item">
                            <div><strong>${i + 1}. ${s.label}</strong><div style="font-size:12px; color:#6b7280;">${s.section}</div></div>
                            <span class="analysis-zero-badge">${s.count} صفر</span>
                        </div>
                    `).join('')
                    : '<p>لا يوجد تلاميذ حاصلون على 0 ضمن الفلاتر الحالية.</p>';

                const zeroBySection = {};
                filtered.forEach(g => {
                    if (g.grade !== 0) return;
                    const section = g.section || 'غير محدد';
                    zeroBySection[section] = (zeroBySection[section] || 0) + 1;
                });
                const zeroSectionLabels = Object.keys(zeroBySection).sort((a, b) => zeroBySection[b] - zeroBySection[a]).slice(0, 8);
                const zeroSectionData = zeroSectionLabels.map(label => zeroBySection[label]);
                if (zeroSectionsChart) zeroSectionsChart.destroy();
                zeroSectionsChart = new Chart(document.getElementById('zero-sections-chart').getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: zeroSectionLabels.length ? zeroSectionLabels : ['لا توجد بيانات'],
                        datasets: [{
                            label: 'عدد الأصفار',
                            data: zeroSectionLabels.length ? zeroSectionData : [0],
                            backgroundColor: 'rgba(232, 93, 93, 0.8)',
                            borderRadius: 6,
                            borderSkipped: false
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 800, easing: 'easeOutQuart' },
                        plugins: {
                            legend: { display: false },
                            tooltip: { callbacks: { label: (ctx) => `عدد الأصفار: ${ctx.raw}` } }
                        },
                        scales: { x: { grid: { display: false } }, y: { grid: { display: false } } }
                    }
                });

                const distributionLabels = distribution.map(d => d.label);
                const distributionCounts = distribution.map(d => d.count);
                const distributionColors = distribution.map(d => d.color);

                if (barChart) barChart.destroy();
                barChart = new Chart(document.getElementById('grades-bar-chart').getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: distributionLabels,
                        datasets: [{
                            label: 'عدد التلاميذ',
                            data: distributionCounts,
                            backgroundColor: distributionColors.map(c => c + 'CC'),
                            borderRadius: 8,
                            borderSkipped: false
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 800, easing: 'easeOutQuart' },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => tooltipLabelWithPercent(ctx, filtered.length)
                                }
                            }
                        },
                        scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(0,0,0,0.04)' } } }
                    }
                });

                if (donutChart) donutChart.destroy();
                donutChart = new Chart(document.getElementById('grades-donut-chart').getContext('2d'), {
                    type: 'doughnut',
                    data: {
                        labels: distributionLabels,
                        datasets: [{
                            data: distributionCounts,
                            backgroundColor: distributionColors,
                            borderWidth: 3,
                            borderColor: 'rgba(255,255,255,0.9)',
                            hoverOffset: 8
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '60%',
                        animation: { duration: 800, easing: 'easeOutQuart' },
                        plugins: {
                            legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' } },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => tooltipLabelWithPercent(ctx, filtered.length)
                                }
                            }
                        }
                    }
                });

                if (detailChart) detailChart.destroy();
                const detailCtx = document.getElementById('detail-chart').getContext('2d');
                if (type === 'distribution') {
                    const ranges = ['0-5', '5-8', '8-10', '10-12', '12-14', '14-16', '16-20'];
                    const counts = [
                        filtered.filter(g => g.grade < 5).length,
                        filtered.filter(g => g.grade >= 5 && g.grade < 8).length,
                        filtered.filter(g => g.grade >= 8 && g.grade < 10).length,
                        filtered.filter(g => g.grade >= 10 && g.grade < 12).length,
                        filtered.filter(g => g.grade >= 12 && g.grade < 14).length,
                        filtered.filter(g => g.grade >= 14 && g.grade < 16).length,
                        filtered.filter(g => g.grade >= 16).length
                    ];

                    detailChart = new Chart(detailCtx, {
                        type: 'bar',
                        data: {
                            labels: ranges,
                            datasets: [{ label: 'عدد النقط', data: counts, backgroundColor: 'rgba(59, 106, 197, 0.7)', borderRadius: 6, borderSkipped: false }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            animation: { duration: 800, easing: 'easeOutQuart' },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) => tooltipLabelWithPercent(ctx, filtered.length)
                                    }
                                }
                            },
                            scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(0,0,0,0.04)' } } }
                        }
                    });
                } else if (type === 'comparison') {
                    const bySection = {};
                    filtered.forEach(g => {
                        const s = g.section || 'غير محدد';
                        if (!bySection[s]) bySection[s] = [];
                        bySection[s].push(g.grade);
                    });

                    const labels = Object.keys(bySection).sort((a, b) => a.localeCompare(b, 'ar'));
                    const data = labels.map(s => Number(avg(bySection[s]).toFixed(2)));

                    detailChart = new Chart(detailCtx, {
                        type: 'bar',
                        data: {
                            labels,
                            datasets: [{ label: 'معدل القسم', data, backgroundColor: 'rgba(91, 132, 214, 0.7)', borderRadius: 6, borderSkipped: false }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            animation: { duration: 800, easing: 'easeOutQuart' },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) => `معدل القسم: ${Number(ctx.raw).toFixed(2)}`
                                    }
                                }
                            },
                            scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(0,0,0,0.04)' }, beginAtZero: true } }
                        }
                    });
                } else if (type === 'teachers') {
                    const teacherRows = buildTeacherPerformanceRows(filtered).sort(
                        (a, b) => b.passRate - a.passRate || b.avg - a.avg || b.gradeCount - a.gradeCount
                    );
                    const topTeachers = teacherRows.slice(0, 20);
                    const labels = topTeachers.map(t => t.name);
                    const data = topTeachers.map(t => Number(t.passRate.toFixed(1)));
                    const colors = topTeachers.map(t => {
                        if (t.passRate >= 85) return 'rgba(47, 179, 109, 0.85)';
                        if (t.passRate >= 70) return 'rgba(60, 149, 208, 0.85)';
                        if (t.passRate >= 50) return 'rgba(240, 194, 14, 0.85)';
                        return 'rgba(231, 76, 60, 0.85)';
                    });

                    detailChart = new Chart(detailCtx, {
                        type: 'bar',
                        data: {
                            labels,
                            datasets: [{
                                label: 'نسبة نجاح الأستاذ (%)',
                                data,
                                backgroundColor: colors,
                                borderRadius: 6,
                                borderSkipped: false
                            }]
                        },
                        options: {
                            indexAxis: 'y',
                            responsive: true,
                            maintainAspectRatio: false,
                            animation: { duration: 800, easing: 'easeOutQuart' },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) => `نسبة النجاح: ${Number(ctx.raw).toFixed(1)}%`,
                                        afterBody: (items) => {
                                            const idx = items[0]?.dataIndex ?? -1;
                                            const row = topTeachers[idx];
                                            if (!row) return '';
                                            return [
                                                `معدل الأستاذ: ${row.avg.toFixed(2)}`,
                                                `عدد النقط: ${row.gradeCount}`,
                                                `عدد التلاميذ: ${row.studentCount}`
                                            ];
                                        }
                                    }
                                }
                            },
                            scales: {
                                x: {
                                    min: 0,
                                    max: 100,
                                    ticks: {
                                        stepSize: 10,
                                        callback: (value) => `${value}%`
                                    },
                                    grid: { color: 'rgba(0,0,0,0.04)' }
                                },
                                y: { grid: { display: false } }
                            }
                        }
                    });
                }

                showToast('تم التحليل', 'success');
            } catch (error) {
                console.error('Analyze error:', error);
                showToast('تعذر تنفيذ التحليل، تحقق من المعطيات', 'error');
            } finally {
                analyzeInProgress = false;
                if (analyzeBtn) {
                    analyzeBtn.disabled = false;
                    analyzeBtn.removeAttribute('aria-busy');
                }
            }
        }
