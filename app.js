// Student Data - Will be loaded from SQLite
let studentsData = [];
let isDbReady = false;
let currentSchoolYear = typeof getSchoolYear === 'function' ? getSchoolYear() : '2025/2026'; // الموسم الدراسي الحالي

const EXTERNAL_LIBS = {
    chart: 'vendor/chart.min.js',
    xlsx: 'vendor/xlsx.full.min.js'
};

let chartLibPromise = null;
let xlsxLibPromise = null;

function loadExternalScriptOnce(src, globalName) {
    if (globalName && window[globalName]) {
        return Promise.resolve(window[globalName]);
    }

    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-dynamic-src="${src}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.defer = true;
        script.dataset.dynamicSrc = src;
        script.onload = () => resolve(globalName ? window[globalName] : true);
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

function ensureChartLoaded() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (!chartLibPromise) {
        chartLibPromise = loadExternalScriptOnce(EXTERNAL_LIBS.chart, 'Chart');
    }
    return chartLibPromise;
}

function ensureXlsxLoaded() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLibPromise) {
        xlsxLibPromise = loadExternalScriptOnce(EXTERNAL_LIBS.xlsx, 'XLSX');
    }
    return xlsxLibPromise;
}

// === دالة الحماية من XSS ===
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// Initialize data from SQLite
async function initDatabase(schoolYear = null) {
    try {
        // استخدام الموسم المرسل أو الموسم الحالي
        const year = schoolYear || currentSchoolYear;
        currentSchoolYear = year;

        // جلب التلاميذ من SQLite (مع التحقق من وجود المنفذ)
        if (!window.api || !window.api.students) {
            console.warn('⚠️ Students API not available - matching browser environment');
            studentsData = [];
            refreshDashboard();
            return;
        }

        const students = await window.api.students.getAll(year);

        if (students && students.length > 0) {
            studentsData = students.map((s) => ({
                id: s.id,
                code: s.code,
                familyName: s.family_name,
                firstName: s.full_name,
                gender: s.gender,
                birthDate: s.birth_date,
                birthPlace: s.birth_place || '',
                section: s.section,
                schoolYear: s.school_year
            }));
            console.log(`✅ Data loaded for ${year}:`, studentsData.length, 'students');
        } else {
            console.log('📭 No data in database');
            studentsData = [];
        }

        isDbReady = true;

        // تحديث قائمة المواسم المتوفرة
        await updateAvailableYears();

        refreshDashboard();
    } catch (error) {
        console.error('❌ Database error:', error);
        studentsData = [];
        refreshDashboard();
    }
}

// جلب المواسم الدراسية المتوفرة
async function updateAvailableYears() {
    try {
        const activeYear = typeof getSchoolYear === 'function' ? getSchoolYear() : currentSchoolYear;

        // Build a standard range of years (same as setupUnifiedHeader in utils.js)
        const nowYear = new Date().getFullYear();
        const years = new Set();
        for (let y = nowYear + 1; y >= nowYear - 3; y--) {
            years.add(`${y}/${y + 1}`);
        }

        // Also include any extra years saved locally or the current DB year
        years.add(activeYear);
        const savedYears = localStorage.getItem('addedSchoolYears');
        if (savedYears) {
            JSON.parse(savedYears).forEach((y) => years.add(y));
        }

        // تحديث القائمة في الواجهة
        const yearSelect = document.getElementById('school-year');
        if (yearSelect) {
            yearSelect.innerHTML = '';

            // ترتيب المواسم تنازلياً
            const sortedYears = [...years].sort().reverse();
            sortedYears.forEach((year) => {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                if (year === activeYear) option.selected = true;
                yearSelect.appendChild(option);
            });

            // Re-wire change event (header may have been rebuilt)
            yearSelect.onchange = null;
            yearSelect.addEventListener('change', () => {
                const chosen = yearSelect.value;
                if (chosen && chosen !== 'new' && typeof setSchoolYear === 'function') {
                    setSchoolYear(chosen);
                }
            });
        }
    } catch (error) {
        console.error('Error updating years:', error);
    }
}

// حفظ موسم جديد
function saveNewSchoolYear(year) {
    const savedYears = localStorage.getItem('addedSchoolYears');
    const years = savedYears ? JSON.parse(savedYears) : [];
    if (!years.includes(year)) {
        years.push(year);
        localStorage.setItem('addedSchoolYears', JSON.stringify(years));
    }
}

// Save students to SQLite
async function saveToDatabase(students, schoolYear = null) {
    try {
        const year = schoolYear || currentSchoolYear;

        // تحويل البيانات لتناسب SQLite
        const dbStudents = students.map((s) => ({
            code: s.code,
            full_name: s.firstName,
            family_name: s.familyName,
            birth_date: s.birthDate,
            gender: s.gender,
            section: s.section,
            school_year: year,
            status: 'active'
        }));

        const result = await window.api.students.addBulk(dbStudents);

        if (result.success) {
            console.log(`✅ Saved to database (${year}):`, students.length, 'students');
            await updateAvailableYears();

            // استخراج وحفظ المستويات الفريدة
            await saveLevelsFromStudents(students);

            return true;
        } else {
            console.error('❌ Error saving:', result.error);
            return false;
        }
    } catch (error) {
        console.error('❌ Error saving to database:', error);
        return false;
    }
}

// استخراج المستوى من اسم القسم
// Uses shared getLevelFromSection() from utils.js (returns {code, name, order})

// استخراج وحفظ المستويات الفريدة من بيانات التلاميذ
async function saveLevelsFromStudents(students) {
    try {
        const sections = [...new Set(students.map((s) => s.section).filter((s) => s))];
        const levelsMap = new Map();

        sections.forEach((section) => {
            const level = getLevelFromSection(section);
            if (level.code !== 'other' && !levelsMap.has(level.code)) {
                levelsMap.set(level.code, {
                    code: level.code,
                    name: level.name,
                    order: level.order,
                    sections: []
                });
            }
            if (levelsMap.has(level.code)) {
                levelsMap.get(level.code).sections.push(section);
            }
        });

        // ترتيب المستويات
        const levels = [...levelsMap.values()].sort((a, b) => a.order - b.order);

        // حفظ في الإعدادات
        await window.api.settings.set('levels', JSON.stringify(levels));
        console.log('✅ Saved levels:', levels.map((l) => l.name).join(', '));

        return levels;
    } catch (error) {
        console.error('Error saving levels:', error);
        return [];
    }
}

// استرجاع المستويات المحفوظة
async function getSavedLevels() {
    try {
        const levelsJson = await window.api.settings.get('levels');
        if (levelsJson) {
            return JSON.parse(levelsJson);
        }
    } catch (error) {
        console.error('Error getting levels:', error);
    }
    return [];
}

// حفظ الربط بين أسماء الأقسام والمستويات (من العمود DC)
async function saveLevelsMapping(extractedLevels) {
    try {
        const levelsArray = [];
        let order = 1;

        // تجميع المستويات الفريدة
        const uniqueLevels = new Map();
        extractedLevels.forEach((levelName, sectionName) => {
            if (!uniqueLevels.has(levelName)) {
                uniqueLevels.set(levelName, {
                    name: levelName,
                    sections: [],
                    order: order++
                });
            }
            uniqueLevels.get(levelName).sections.push(sectionName);
        });

        // تحويل إلى مصفوفة
        uniqueLevels.forEach((data, levelName) => {
            levelsArray.push({
                code: levelName.replace(/\s+/g, '_').toLowerCase(),
                name: levelName,
                order: data.order,
                sections: data.sections
            });
        });

        // حفظ في الإعدادات
        await window.api.settings.set('levelsMapping', JSON.stringify(Object.fromEntries(extractedLevels)));
        await window.api.settings.set('levels', JSON.stringify(levelsArray));

        console.log('✅ Saved levels mapping:', levelsArray.map((l) => l.name).join(', '));
        return levelsArray;
    } catch (error) {
        console.error('Error saving levels mapping:', error);
        return [];
    }
}

// استرجاع الربط بين الأقسام والمستويات
async function getLevelForSection(sectionName) {
    try {
        const mappingJson = await window.api.settings.get('levelsMapping');
        if (mappingJson) {
            const mapping = JSON.parse(mappingJson);
            return mapping[sectionName] || null;
        }
    } catch (error) {
        console.error('Error getting level for section:', error);
    }
    return null;
}

// Default students data (backup)
function getDefaultStudents() {
    return [];
}

// Calculate Statistics
function calculateStats() {
    const females = studentsData.filter((s) => s.gender === 'أنثى').length;
    const males = studentsData.filter((s) => s.gender === 'ذكر').length;
    const sections = [...new Set(studentsData.map((s) => s.section))];
    // Calculate levels - extract level from section name (e.g., TCSF, 1BAC, 2BAC, etc.)
    const levels = [
        ...new Set(
            sections.map((s) => {
                // Try to extract level prefix from section name
                const match = s ? s.match(/^([A-Z0-9]+)/i) : null;
                return match ? match[1] : s;
            })
        )
    ];
    const avgPerSection = sections.length > 0 ? Math.round(studentsData.length / sections.length) : 0;
    return {
        total: studentsData.length,
        females,
        males,
        sections: sections.length,
        sectionsList: sections,
        levels: levels.length,
        levelsList: levels,
        avgPerSection
    };
}

// Calculate Age Statistics
function calculateAgeStats() {
    const currentYear = new Date().getFullYear();
    const ageGroups = {};
    studentsData.forEach((s) => {
        if (!s.birthDate) return;
        const birthYear = parseInt(s.birthDate.split('-')[0]);
        const age = currentYear - birthYear;
        if (!ageGroups[age]) ageGroups[age] = { total: 0, males: 0, females: 0 };
        ageGroups[age].total++;
        s.gender === 'ذكر' ? ageGroups[age].males++ : ageGroups[age].females++;
    });
    return ageGroups;
}

// Render Stats Cards
function renderStatsCards(stats) {
    if (!stats) stats = calculateStats();
    const sectionsInfo =
        stats.sectionsList.length <= 3
            ? stats.sectionsList.join(', ')
            : stats.sectionsList.slice(0, 2).join(', ') + '...';
    const levelsInfo = stats.levelsList.length <= 2 ? stats.levelsList.join(', ') : stats.levelsList[0] + '...';
    const femalesPct = stats.total > 0 ? ((stats.females / stats.total) * 100).toFixed(1) : 0;
    const malesPct = stats.total > 0 ? ((stats.males / stats.total) * 100).toFixed(1) : 0;

    function statCard(icon, label, value, footer, delay) {
        return `<div class="stat-card" style="animation-delay:${delay}s">
            <i class="fas fa-${icon}"></i>
            <div class="stat-info">
                <span class="stat-label">${label}</span>
                <span class="stat-value">${value}</span>
            </div>
            <span class="stat-badge">${footer}</span>
        </div>`;
    }

    const html = `<div class="stats-grid">
        ${statCard('users', 'عدد التلاميذ', stats.total, `${stats.sections} أقسام`, 0.0)}
        ${statCard('female', 'عدد الإناث', stats.females, `${femalesPct}%`, 0.06)}
        ${statCard('male', 'عدد الذكور', stats.males, `${malesPct}%`, 0.12)}
        ${statCard('chalkboard', 'عدد الأقسام', stats.sections, escapeHtml(sectionsInfo), 0.18)}
        ${statCard('layer-group', 'عدد المستويات', stats.levels, escapeHtml(levelsInfo), 0.24)}
        ${statCard('calculator', 'معدل القسم', stats.avgPerSection, 'تلميذ/قسم', 0.30)}
    </div>`;
    document.getElementById('stats-section').innerHTML = html;
}

let ownerSyncLastRenderedAt = 0;

function isAdminRoleOnDashboard() {
    const session = window.AuthSession?.get?.();
    return String(session?.role || '').toLowerCase() === 'admin';
}

function renderOwnerSyncError(message) {
    const section = document.getElementById('owner-sync-section');
    if (!section) return;
    section.style.display = 'block';
    section.innerHTML = `
        <div class="students-results mb-5 border border-dashed border-[rgba(240,173,78,0.45)] bg-[rgba(240,173,78,0.08)] dark:border-[rgba(240,173,78,0.55)] dark:bg-[rgba(240,173,78,0.12)]">
            <h3><i class="fas fa-satellite-dish"></i> متابعة الأجهزة المثبّتة</h3>
            <p class="my-2.5 text-[var(--color-warning)] dark:text-[#ffd18a]">${escapeHtml(message || 'تعذر تحميل بيانات الأجهزة')}</p>
            <div class="flex flex-wrap gap-2.5">
                <button type="button" class="btn btn-primary" id="owner-sync-refresh-btn"><i class="fas fa-sync-alt"></i> تحديث</button>
                <button type="button" class="btn btn-warning" id="owner-sync-sync-btn"><i class="fas fa-cloud-upload-alt"></i> مزامنة الآن</button>
            </div>
        </div>
    `;
}

async function renderOwnerSyncSection(force = false) {
    const section = document.getElementById('owner-sync-section');
    if (!section) return;

    if (!isAdminRoleOnDashboard()) {
        section.classList.add('hidden');
        section.innerHTML = '';
        return;
    }

    const now = Date.now();
    if (!force && now - ownerSyncLastRenderedAt < 20000) return;
    ownerSyncLastRenderedAt = now;

    if (!window.api?.ownerTelemetry) {
        renderOwnerSyncError('وحدة Owner Telemetry غير متوفرة');
        return;
    }

    try {
        const [overviewRes, devicesRes] = await Promise.all([
            window.api.ownerTelemetry.getOverview(),
            window.api.ownerTelemetry.getDevices({ limit: 10 })
        ]);

        if (!overviewRes?.success) {
            renderOwnerSyncError(overviewRes?.error || 'قم بإعداد مزامنة الأجهزة في صفحة الترخيص');
            return;
        }

        const summary = overviewRes.summary || {};
        const devices = Array.isArray(devicesRes?.devices) ? devicesRes.devices : [];

        section.classList.remove('hidden');
        section.innerHTML = `
            <div class="students-results mb-5">
                <div class="mb-3 flex flex-wrap items-center justify-between gap-2.5">
                    <h3><i class="fas fa-satellite-dish"></i> متابعة الأجهزة المثبّتة</h3>
                    <div class="flex flex-wrap gap-2">
                        <button type="button" class="btn btn-primary" id="owner-sync-refresh-btn"><i class="fas fa-sync-alt"></i> تحديث</button>
                        <button type="button" class="btn btn-warning" id="owner-sync-sync-btn"><i class="fas fa-cloud-upload-alt"></i> مزامنة الآن</button>
                    </div>
                </div>

                <div class="stats-grid mb-2.5">
                    <div class="stat-card total"><div class="stat-content"><h3>إجمالي الأجهزة</h3><p class="stat-number">${Number(summary.totalDevices || 0)}</p></div></div>
                    <div class="stat-card sections"><div class="stat-content"><h3>نشط آخر 24 ساعة</h3><p class="stat-number">${Number(summary.active24h || 0)}</p></div></div>
                    <div class="stat-card females"><div class="stat-content"><h3>أجهزة مفعلة</h3><p class="stat-number">${Number(summary.activatedDevices || 0)}</p></div></div>
                </div>

                <div class="table-wrapper">
                    <table class="students-table">
                        <thead>
                            <tr>
                                <th>الجهاز</th>
                                <th>المنصة</th>
                                <th>الباقة</th>
                                <th>الحالة</th>
                                <th>آخر ظهور</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${
                                devices.length
                                    ? devices
                                          .map(
                                              (d) => `
                                <tr>
                                    <td>${escapeHtml(d.deviceName || d.deviceCode || '-')}</td>
                                    <td>${escapeHtml(d.platform || '-')}</td>
                                    <td>${escapeHtml((d.planCode || '-').toUpperCase())}</td>
                                    <td>${d.activated ? 'مفعّل' : 'غير مفعّل'}</td>
                                    <td>${escapeHtml(d.lastSeenAt || '-')}</td>
                                </tr>`
                                          )
                                          .join('')
                                    : '<tr><td class="px-4 py-[18px] text-center" colspan="5">لا توجد أجهزة بعد</td></tr>'
                            }
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (error) {
        renderOwnerSyncError(error?.message || 'تعذر الاتصال بخادم المتابعة');
    }
}

// Render Charts
const chartInstances = {
    age: null,
    gender: null,
    levels: null,
    place: null,
    teacherSubject: null,
    teacherGender: null,
    teacherAge: null,
    studentStatus: null,
    surplusTeachers: null
};

function destroyChartInstances() {
    Object.keys(chartInstances).forEach((key) => {
        const instance = chartInstances[key];
        if (instance && typeof instance.destroy === 'function') {
            instance.destroy();
        }
        chartInstances[key] = null;
    });
}

// Birth place normalization — module-level so it's allocated once, not per renderCharts() call
const BIRTH_PLACE_MAPPING = {
    الكرعاني: 'الكرعاني',
    'الكرعاني آسفي': 'الكرعاني',
    'الكرعاني أسفي': 'الكرعاني',
    'الكرعاني اسفي': 'الكرعاني',
    '\u200Fالكرعاني آسفي': 'الكرعاني',
    'دوار المخاطرة جماعة الكرعاني': 'الكرعاني',
    'جماعة الكرعاني': 'الكرعاني',
    اسفي: 'اسفي',
    آسفي: 'اسفي',
    أسفي: 'اسفي',
    '\u200Fآسفي': 'اسفي',
    'جمعة سحيم اسفي': 'جمعة سحيم',
    'جمعة سحيم آسفي': 'جمعة سحيم',
    '\u200Fجمعة سحيم آسفي': 'جمعة سحيم',
    'الحي الاداري بلدية جمعة سحيم باشوية  جمعة سحيم إقليم أسفي': 'جمعة سحيم',
    'جمعة اسحيم': 'جمعة سحيم',
    'الحي الاداري جمعة اسحيم': 'جمعة سحيم',
    'الحي الإداري': 'جمعة سحيم',
    'الحي الاداري بلدية جمعة سحيم إقليم أسفي': 'جمعة سحيم',
    'جمعة سحيم': 'جمعة سحيم',
    'ٍجمعة سحيم': 'جمعة سحيم',
    'الحي الإداري جمعة سحيم': 'جمعة سحيم',
    'الحي الاداري جمعة سحيم': 'جمعة سحيم',
    'جمعة اسحيم آسفي': 'جمعة سحيم',
    'بلدية جمعة سحيم': 'جمعة سحيم',
    'بلدية جمعة سحيم إقليم أسفي': 'جمعة سحيم',
    'جماعة جمعة سحيم باشوية  جمعة سحيم إقليم أسفي': 'جمعة سحيم',
    'جماعة جمعة سحيم باشوية جمعة سحيم اقليم اسفي': 'جمعة سحيم',
    'الحي الاداري بلدية جمعة سحيم': 'جمعة سحيم',
    'حي غراب جمعة سحيم': 'جمعة سحيم',
    'شارع محمد الخامس بلدية جمعة سحيم اقليم اسفي': 'جمعة سحيم',
    'شارع محمد الخامس  بلدية جمعة سحيم إقليم أسفي': 'جمعة سحيم',
    'شارع اليوسفية جمعة اسحيم': 'جمعة سحيم',
    'دوار لعباد جمعة سحيم': 'جمعة سحيم',
    'حي الدعيجات جمعة اسحيم': 'جمعة سحيم',
    'جمعة سحيم اقليم اسفي': 'جمعة سحيم',
    'جمعة سحيم إقليم أسفي': 'جمعة سحيم',
    'جمعة اسيم': 'جمعة سحيم',
    'دوار الحميدات بلدية جمعة سحيم باشوية جمعة سحيم اقليم اسفي': 'جمعة سحيم',
    'دوار الحميدات بلدية جمعة سحيم باشوية  جمعة سحيم إقليم أسفي': 'جمعة سحيم',
    'دوار الخربة بلدية جمعة سحيم اقليم اسفي': 'جمعة سحيم',
    'دوار الخربة  بلدية جمعة سحيم إقليم أسفي': 'جمعة سحيم',
    'دوار اولاد ميمون بلدية جمعة سحيم اقليم اسفي': 'جمعة سحيم',
    'دوار أولاد ميمون بلدية جمعة سحيم إقليم أسفي': 'جمعة سحيم',
    'دوار اولاد التومي بلدية جمعة سحيم اقليم اسفي': 'جمعة سحيم',
    'دوار أولاد التومي بلدية جمعة سحيم إقليم أسفي': 'جمعة سحيم',
    'دار سي عيسي': 'دار سي عيسي',
    'دار السي عيسى': 'دار سي عيسي',
    'دار سي عيسى': 'دار سي عيسي',
    'ج سيدي عيسى': 'دار سي عيسي',
    'جماعة دار السي عيسي': 'دار سي عيسي',
    'جماعة دار السي عيسى': 'دار سي عيسي',
    'المصابيح اسفي': 'المصابيح',
    'المصابيح آسفي': 'المصابيح',
    '\u200Fالمصابيح آسفي': 'المصابيح',
    '\u200Fلمصابيح': 'المصابيح',
    'جماعة لمصابيح آسفي': 'المصابيح',
    'جماعة لمصابيح اسفي': 'المصابيح',
    'سيدي عيسى': 'المصابيح',
    'سيدي عيسى آسفي': 'المصابيح',
    'دوار اولاد بوجمعة جماعة لمصابيح دائرة عبدة اسفي': 'المصابيح',
    'جماعة لمصابيح': 'المصابيح',
    'جماعة المصابيح آسفي': 'المصابيح',
    بلمصابيح: 'المصابيح',
    'دوار لمصابيح ج لمصابيح عبدة': 'المصابيح',
    'دوار الطلوح جماعة المصابيح اسفي': 'المصابيح',
    'الدار البيضاء': 'الدار البيضاء',
    البيضاء: 'الدار البيضاء',
    الدارالبيضاء: 'الدار البيضاء',
    الرباط: 'الرباط',
    لحضر: 'لحضر',
    'جماعة لحضر': 'لحضر',
    'جماعة لحضر اقليم اسفي': 'لحضر',
    'جماعة لحضر اقليم آسفي': 'لحضر',
    'جماعة شهدة': 'جماعة شهدة',
    'جماعة شهدة دائرة عبدة إقليم أسفي': 'جماعة شهدة',
    'جماعة شهدة دائرة عبدة اقليم أسفي': 'جماعة شهدة',
    شهدة: 'جماعة شهدة',
    'دوار الجديان جماعة شهدة أسفي': 'جماعة شهدة',
    'جماعة شهدة اسفي': 'جماعة شهدة',
    'دوار أولاد ميمون جماعة شهدة': 'جماعة شهدة',
    'دوار الجديان جماعة شهدة اسفي': 'جماعة شهدة',
    'دوار اولاد ميمون جماعة شهدة': 'جماعة شهدة',
    اليوسفية: 'اليوسفية',
    بوكدرة: 'بوكدرة',
    لعميرات: 'لعميرات',
    مراكش: 'مراكش',
    'دوار اولاد بوعنان': 'دوار اولاد بوعنان',
    'دوار أولاد بوعنان': 'دوار اولاد بوعنان',
    'حي لحرش': 'حي لحرش',
    'انزا اكادير': 'انزا اكادير',
    'اولادد اعبيد': 'اولادد اعبيد',
    'اولاد السي عبد السلام': 'اولاد السي عبد السلام',
    'اولاد يحي': 'اولاد يحي',
    بوشان: 'بوشان',
    'ج المراسلة': 'ج المراسلة',
    تارودانت: 'تارودانت',
    'تجزية الاخلاص': 'تجزية الاخلاص',
    'تجزئة الاخلاص': 'تجزية الاخلاص',
    'ج الكرعاني': 'الكرعاني',
    'ج لبخاتي': 'ج لبخاتي',
    'الجماعة الحضرية لاسفي': 'اسفي',
    SAFI: 'اسفي',
    'دوار اولاد مبارك': 'دوار اولاد مبارك',
    'حي الرزازقة': 'حي الرزازقة',
    'دوار اولاد فارقو': 'دوار اولاد فارقو',
    'دوار أولاد فارقو': 'دوار اولاد فارقو',
    'دوار اولاد عيسي': 'دوار اولاد عيسي',
    'دوار أولاد عيسى': 'دوار اولاد عيسي',
    'حي الدعيجات': 'حي الدعيجات',
    'جماعة سيدي التيجي': 'جماعة سيدي التيجي',
    'حي زمران': 'حي زمران',
    'حي العبيد': 'حي العبيد',
    'دوار اولاد امبارك الشيظمب البخاتي اسفي': 'دوار اولاد امبارك الشيظمب البخاتي اسفي',
    'دوار اولاد امبارك الشيظمب البخاتي  اسفي': 'دوار اولاد امبارك الشيظمب البخاتي اسفي',
    'دوار اولاد بن عليوة جماعة مول البركي اسفي': 'دوار اولاد بن عليوة جماعة مول البركي اسفي',
    'دوار أولاد بن عليوة جماعة مول البركي أسفي': 'دوار اولاد بن عليوة جماعة مول البركي اسفي',
    SELMOUN: 'SELMOUN',
    'دوار اولاد التومي قيادة العامر اسفي': 'دوار اولاد التومي قيادة العامر اسفي',
    'دوار اولاد التومي قيادة  العامر اسفي': 'دوار اولاد التومي قيادة العامر اسفي',
    'دوار اولاد الجيلالي': 'دوار اولاد الجيلالي',
    'دوار اولاد الحاج عيسي': 'دوار اولاد الحاج عيسي',
    'دوار اولاد الحاج عيسى': 'دوار اولاد الحاج عيسي',
    'دوار اولاد زكري الكرعاني': 'الكرعاني',
    'دوار اولاد عزوز العامر اسفي': 'دوار اولاد عزوز العامر اسفي',
    'دوار اولاد عمران': 'دوار اولاد عمران',
    'دوار أولاد عمران': 'دوار اولاد عمران',
    'قصر اعريب': 'قصر اعريب',
    'جماعة سيدي عيسي': 'جماعة سيدي عيسي',
    'جماعة سيدي عيسى': 'جماعة سيدي عيسي',
    'دوار الدعابجة': 'دوار الدعابجة',
    'دوار الزيادنة اقليم اسفي': 'دوار الزيادنة اقليم اسفي',
    'دوار الزيادنة اقليم آسفي': 'دوار الزيادنة اقليم اسفي',
    'دوار البيضان': 'دوار البيضان',
    'دوار الجديات': 'دوار الجديات',
    'دوار الحامات': 'دوار الحامات',
    'دوار دار عزيزي': 'دوار دار عزيزي',
    'دوار الكطاطمة': 'دوار الكطاطمة',
    'سيدي بنور': 'سيدي بنور',
    الزوانة: 'الزوانة',
    وزان: 'وزان',
    'دوار السعادنة': 'دوار السعادنة',
    'دوار الصبيبرات': 'دوار الصبيبرات',
    النواصر: 'النواصر',
    'مركز ايت عميرة': 'مركز ايت عميرة',
    'مركز أيت عميرة': 'مركز ايت عميرة',
    'ولاد علي': 'ولاد علي',
    'دوار لحميدات': 'دوار لحميدات',
    لحميدات: 'لحميدات',
    'دوار اولاد مبارك الشيظمي': 'دوار اولاد مبارك الشيظمي',
    'دوار المخاطرة': 'دوار المخاطرة',
    لعواكل: 'لعواكل',
    'لبخاتي اسفي': 'لبخاتي اسفي',
    'لبخاتي آسفي': 'لبخاتي اسفي',
    'دوار المساعدية جماعة الكرعاني': 'الكرعاني',
    القليعة: 'القليعة',
    'دوار المعاطلة': 'دوار المعاطلة',
    'دوار المعاطلة جماعة مول البركي اسفي': 'دوار المعاطلة جماعة مول البركي اسفي',
    'دوار المعاطلة جماعة مول البركي آسفي': 'دوار المعاطلة جماعة مول البركي اسفي',
    'دوار ولاد داوود': 'دوار ولاد داوود'
};

function resolvePlace(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed || trimmed === '-') return '-';
    if (BIRTH_PLACE_MAPPING[trimmed]) return BIRTH_PLACE_MAPPING[trimmed];
    // Try removing invisible Unicode chars (BOM, RLM, LRM, ZWJ, ZWNJ)
    const cleaned = trimmed.replace(/[\u200F\u200E\u200B\u200C\u200D\uFEFF]/g, '').trim();
    if (BIRTH_PLACE_MAPPING[cleaned]) return BIRTH_PLACE_MAPPING[cleaned];
    return trimmed;
}

function getChartThemeColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const styles = getComputedStyle(document.documentElement);
    const get = (v) => styles.getPropertyValue(v).trim();
    return {
        textColor: get('--color-text-main'),
        mutedColor: get('--color-text-muted'),
        gridColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        primary: get('--color-primary'),
        primaryLight: get('--color-primary-light'),
        primaryDark: get('--color-primary-dark'),
        accent: '#9B64AB'
    };
}

async function renderCharts(filterSection = 'all', stats) {
    try {
        await ensureChartLoaded();
    } catch (error) {
        console.error('Chart.js load failed:', error);
        document.getElementById('charts-section').innerHTML = `
            <div class="chart-card">
                <div class="chart-body" style="padding:20px;text-align:center;color:#8b0000;">
                    تعذر تحميل مكتبة الرسوم البيانية. تحقق من الاتصال ثم أعد المحاولة.
                </div>
            </div>`;
        return;
    }

    destroyChartInstances();

    if (!stats) stats = calculateStats();
    const sortedSectionsList = sortSectionNames(stats.sectionsList);
    const sectionsOptions = sortedSectionsList
        .map(
            (s) => `<option value="${escapeHtml(s)}" ${filterSection === s ? 'selected' : ''}>${escapeHtml(s)}</option>`
        )
        .join('');

    const html = `<div class="charts-grid">
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-chart-bar"></i> إحصاء التلاميذ حسب السن</h3><div class="chart-controls"><select id="age-section-filter"><option value="all" ${filterSection === 'all' ? 'selected' : ''}>جميع الأقسام</option>${sectionsOptions}</select><button><i class="fas fa-print"></i> طباعة</button></div></div><div class="chart-body"><canvas id="ageChart"></canvas></div></div>
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-pie-chart"></i> توزيع التلاميذ حسب الجنس</h3></div><div class="chart-body"><canvas id="genderChart"></canvas></div></div>
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-chart-bar"></i> إحصاء التلاميذ حسب المستويات</h3></div><div class="chart-body"><canvas id="levelsChart"></canvas></div></div>
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-map-marker-alt"></i> توزيع التلاميذ حسب مكان الازدياد</h3></div><div class="chart-body"><canvas id="placeChart"></canvas></div></div>
    </div>`;
    document.getElementById('charts-section').innerHTML = html;

    // Filter data based on section
    const filteredData =
        filterSection === 'all' ? studentsData : studentsData.filter((s) => s.section === filterSection);

    // Age Chart with filtered data
    const ageStats = {};
    const currentYear = new Date().getFullYear();
    filteredData.forEach((s) => {
        if (!s.birthDate) return;
        // Extract birth year from various date formats (YYYY-MM-DD, DD/MM/YYYY, YYYY, etc.)
        let birthYear;
        const parts = s.birthDate.split(/[-/]/);
        if (parts[0].length === 4) {
            birthYear = parseInt(parts[0]); // YYYY-MM-DD
        } else if (parts.length >= 3 && parts[2].length === 4) {
            birthYear = parseInt(parts[2]); // DD/MM/YYYY
        } else {
            birthYear = parseInt(parts[0]);
        }
        if (!birthYear || isNaN(birthYear)) return;
        const age = currentYear - birthYear;
        // Only accept reasonable student ages (10-40)
        if (age < 10 || age > 40) return;
        if (!ageStats[age]) ageStats[age] = { total: 0, males: 0, females: 0 };
        ageStats[age].total++;
        s.gender === 'ذكر' ? ageStats[age].males++ : ageStats[age].females++;
    });

    const ages = Object.keys(ageStats).sort((a, b) => a - b);
    const tc = getChartThemeColors();
    chartInstances.age = new Chart(document.getElementById('ageChart'), {
        type: 'bar',
        data: {
            labels: ages.map((a) => a + ' سنة'),
            datasets: [
                {
                    label: 'عدد التلاميذ',
                    data: ages.map((a) => ageStats[a].total),
                    backgroundColor: tc.primary,
                    borderRadius: 6
                },
                {
                    label: 'الإناث',
                    data: ages.map((a) => ageStats[a].females),
                    backgroundColor: tc.primaryLight,
                    borderRadius: 6
                },
                {
                    label: 'الذكور',
                    data: ages.map((a) => ageStats[a].males),
                    backgroundColor: tc.accent,
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: tc.textColor } } },
            scales: {
                x: { ticks: { color: tc.textColor }, grid: { color: tc.gridColor } },
                y: { ticks: { color: tc.textColor }, grid: { color: tc.gridColor } }
            }
        }
    });

    // Gender Chart
    chartInstances.gender = new Chart(document.getElementById('genderChart'), {
        type: 'doughnut',
        data: {
            labels: ['الإناث', 'الذكور'],
            datasets: [
                {
                    data: [stats.females, stats.males],
                    backgroundColor: [tc.primaryLight, tc.accent],
                    borderWidth: 0,
                    hoverOffset: 8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: tc.textColor } } }
        }
    });

    // Levels Chart - Show stats per section
    const sectionStats = {};
    studentsData.forEach((s) => {
        if (!sectionStats[s.section]) sectionStats[s.section] = { total: 0, males: 0, females: 0 };
        sectionStats[s.section].total++;
        s.gender === 'ذكر' ? sectionStats[s.section].males++ : sectionStats[s.section].females++;
    });
    const sectionNames = sortSectionNames(Object.keys(sectionStats));
    chartInstances.levels = new Chart(document.getElementById('levelsChart'), {
        type: 'bar',
        data: {
            labels: sectionNames,
            datasets: [
                {
                    label: 'المجموع',
                    data: sectionNames.map((s) => sectionStats[s].total),
                    backgroundColor: tc.primary,
                    borderRadius: 6
                },
                {
                    label: 'إناث',
                    data: sectionNames.map((s) => sectionStats[s].females),
                    backgroundColor: tc.primaryLight,
                    borderRadius: 6
                },
                {
                    label: 'ذكور',
                    data: sectionNames.map((s) => sectionStats[s].males),
                    backgroundColor: tc.accent,
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: tc.textColor } } },
            scales: {
                x: { ticks: { color: tc.textColor }, grid: { color: tc.gridColor } },
                y: { ticks: { color: tc.textColor }, grid: { color: tc.gridColor } }
            }
        }
    });

    // Birth Place Chart
    const places = {};
    studentsData.forEach((s) => {
        const raw = (s.birthPlace || '').trim() || '-';
        const key = resolvePlace(raw);
        places[key] = (places[key] || 0) + 1;
    });
    const topPlaces = Object.entries(places)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    chartInstances.place = new Chart(document.getElementById('placeChart'), {
        type: 'bar',
        data: {
            labels: topPlaces.map((p) => p[0]),
            datasets: [
                {
                    label: 'العدد',
                    data: topPlaces.map((p) => p[1]),
                    backgroundColor: tc.primaryDark,
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            animation: { duration: 700, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: { rtl: true, textDirection: 'rtl' }
            },
            scales: {
                x: {
                    reverse: true,
                    position: 'top',
                    min: 0,
                    grid: { color: tc.gridColor },
                    ticks: { color: tc.textColor }
                },
                y: {
                    position: 'right',
                    grid: { display: false },
                    ticks: {
                        color: tc.textColor,
                        crossAlign: 'far',
                        font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '600' },
                        textDirection: 'rtl'
                    }
                }
            }
        }
    });

    // Add section filter event listener (remove old listener first to avoid leak)
    const filterEl = document.getElementById('age-section-filter');
    if (filterEl) {
        filterEl.onchange = (e) => {
            renderCharts(e.target.value);
        };
    }
}

// Render Extra Charts (Teacher stats + Student status)
async function renderExtraCharts() {
    try {
        await ensureChartLoaded();
    } catch (error) {
        console.error('Chart.js load failed for extra charts:', error);
        const section = document.getElementById('extra-charts-section');
        if (section) section.innerHTML = '';
        return;
    }

    // Destroy previous instances
    ['teacherSubject', 'teacherGender', 'teacherAge', 'studentStatus', 'surplusTeachers'].forEach((key) => {
        if (chartInstances[key] && typeof chartInstances[key].destroy === 'function') {
            chartInstances[key].destroy();
        }
        chartInstances[key] = null;
    });

    // Load teacher data and student status data in parallel
    let teachers = [];
    let statusSummary = { dropouts: 0, expelled: 0, notEnrolled: 0, totalStudents: 0 };

    try {
        const [teacherResult, statusResult] = await Promise.all([
            window.api.teachers.getAll(currentSchoolYear),
            window.api.students.getByStatus({ schoolYear: currentSchoolYear })
        ]);
        if (Array.isArray(teacherResult)) teachers = teacherResult;
        if (statusResult && statusResult.success && statusResult.summary) {
            statusSummary = statusResult.summary;
        }
    } catch (err) {
        console.warn('Failed to load extra chart data:', err);
    }

    const tc = getChartThemeColors();

    // --- Teacher by Subject/Specialty ---
    const subjectCounts = {};
    teachers.forEach((t) => {
        const subj = (t.subject || t.specialty_subject || '').trim() || 'غير محدد';
        subjectCounts[subj] = (subjectCounts[subj] || 0) + 1;
    });
    const subjectEntries = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1]);
    const subjectColors = generatePalette(subjectEntries.length);

    // --- Teacher by Gender ---
    let teacherMales = 0;
    let teacherFemales = 0;
    teachers.forEach((t) => {
        if (t.gender === 'ذكر') teacherMales++;
        else if (t.gender === 'أنثى') teacherFemales++;
    });

    // --- Teacher by Age ---
    const teacherAgeGroups = {};
    const currentYear = new Date().getFullYear();
    teachers.forEach((t) => {
        if (!t.birth_date) return;
        const birthYear = parseInt(t.birth_date.split('-')[0]);
        if (!birthYear || isNaN(birthYear)) return;
        const age = currentYear - birthYear;
        // Group by decade ranges
        let group;
        if (age < 30) group = 'أقل من 30';
        else if (age < 40) group = '30-39';
        else if (age < 50) group = '40-49';
        else if (age < 60) group = '50-59';
        else group = '60+';
        teacherAgeGroups[group] = (teacherAgeGroups[group] || 0) + 1;
    });
    const ageOrder = ['أقل من 30', '30-39', '40-49', '50-59', '60+'];
    const ageLabels = ageOrder.filter((g) => teacherAgeGroups[g]);
    const ageData = ageLabels.map((g) => teacherAgeGroups[g]);
    const ageColors = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0'];

    // --- Student Status ---
    const activeStudents =
        statusSummary.totalStudents - statusSummary.dropouts - statusSummary.expelled - statusSummary.notEnrolled;

    // --- Surplus Teachers (فائضون) ---
    function isSurplusDashboard(t) {
        if (Number(t.is_surplus) === 1) return true;
        const pos = (t.position || '').toLowerCase();
        const stat = (t.statut || '').toLowerCase();
        const func = (t.function_title || '').toLowerCase();
        const combined = `${pos} ${stat} ${func}`;
        return (
            combined.includes('surnombre') ||
            combined.includes('exc\u00e9dentaire') ||
            combined.includes('excedentaire') ||
            combined.includes('\u0641\u0627\u0626\u0636')
        );
    }
    const surplusTeachers = teachers.filter(isSurplusDashboard);
    const surplusTotal = surplusTeachers.length;
    const surplusBySubject = {};
    surplusTeachers.forEach((t) => {
        const subj = (t.specialty_subject || t.subject || '').trim() || '\u063a\u064a\u0631 \u0645\u062d\u062f\u062f';
        surplusBySubject[subj] = (surplusBySubject[subj] || 0) + 1;
    });
    const surplusEntries = Object.entries(surplusBySubject).sort((a, b) => b[1] - a[1]);
    const surplusMales = surplusTeachers.filter((t) => t.gender === '\u0630\u0643\u0631').length;
    const surplusFemales = surplusTeachers.filter((t) => t.gender === '\u0623\u0646\u062b\u0649').length;

    // Build HTML
    const html = `<div class="charts-grid">
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-chalkboard-teacher"></i> توزيع الأساتذة حسب التخصص</h3></div><div class="chart-body"><canvas id="teacherSubjectChart"></canvas></div></div>
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-venus-mars"></i> توزيع الأساتذة حسب الجنس</h3></div><div class="chart-body"><canvas id="teacherGenderChart"></canvas></div></div>
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-birthday-cake"></i> توزيع الأساتذة حسب الفئة العمرية</h3></div><div class="chart-body"><canvas id="teacherAgeChart"></canvas></div></div>
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-user-graduate"></i> وضعية التلاميذ</h3></div><div class="chart-body"><canvas id="studentStatusChart"></canvas></div></div>
        ${
            surplusTotal > 0
                ? `<div class="chart-card" style="border-color:var(--color-warning,#f59e0b)">
            <div class="chart-header" style="border-color:var(--color-warning,#f59e0b)">
                <h3 style="color:var(--color-warning,#f59e0b)"><i class="fas fa-exclamation-triangle"></i> الأساتذة الفائضون (${surplusTotal})</h3>
                <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px;">ذكور: ${surplusMales} — إناث: ${surplusFemales}</div>
            </div>
            <div class="chart-body"><canvas id="surplusTeachersChart"></canvas></div>
        </div>`
                : ''
        }
    </div>`;

    const section = document.getElementById('extra-charts-section');
    if (!section) return;
    section.innerHTML = html;

    // Chart 1: Teacher by Subject (horizontal bar)
    if (subjectEntries.length > 0) {
        chartInstances.teacherSubject = new Chart(document.getElementById('teacherSubjectChart'), {
            type: 'bar',
            data: {
                labels: subjectEntries.map((e) => e[0]),
                datasets: [
                    {
                        label: 'عدد الأساتذة',
                        data: subjectEntries.map((e) => e[1]),
                        backgroundColor: subjectColors,
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: { legend: { display: false }, tooltip: { rtl: true, textDirection: 'rtl' } },
                scales: {
                    x: {
                        reverse: true,
                        position: 'top',
                        min: 0,
                        grid: { color: tc.gridColor },
                        ticks: { color: tc.textColor, stepSize: 1 }
                    },
                    y: {
                        position: 'right',
                        grid: { display: false },
                        ticks: {
                            color: tc.textColor,
                            font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '600' }
                        }
                    }
                }
            }
        });
    }

    // Chart 2: Teacher by Gender (doughnut)
    chartInstances.teacherGender = new Chart(document.getElementById('teacherGenderChart'), {
        type: 'doughnut',
        data: {
            labels: ['إناث', 'ذكور'],
            datasets: [
                {
                    data: [teacherFemales, teacherMales],
                    backgroundColor: [tc.primaryLight, tc.accent],
                    borderWidth: 0,
                    hoverOffset: 8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: tc.textColor } } }
        }
    });

    // Chart 3: Teacher by Age Group (bar)
    if (ageLabels.length > 0) {
        chartInstances.teacherAge = new Chart(document.getElementById('teacherAgeChart'), {
            type: 'bar',
            data: {
                labels: ageLabels,
                datasets: [
                    {
                        label: 'عدد الأساتذة',
                        data: ageData,
                        backgroundColor: ageColors.slice(0, ageLabels.length),
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: tc.textColor }, grid: { color: tc.gridColor } },
                    y: { ticks: { color: tc.textColor, stepSize: 1 }, grid: { color: tc.gridColor } }
                }
            }
        });
    }

    // Chart 4: Student Status (doughnut)
    chartInstances.studentStatus = new Chart(document.getElementById('studentStatusChart'), {
        type: 'doughnut',
        data: {
            labels: ['متمدرسون', 'منقطعون', 'مطرودون', 'غير ملتحقين'],
            datasets: [
                {
                    data: [
                        Math.max(activeStudents, 0),
                        statusSummary.dropouts,
                        statusSummary.expelled,
                        statusSummary.notEnrolled
                    ],
                    backgroundColor: ['#4CAF50', '#FF9800', '#F44336', '#9E9E9E'],
                    borderWidth: 0,
                    hoverOffset: 8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: tc.textColor } } }
        }
    });

    // Chart 5: Surplus Teachers by Subject (horizontal bar) — shown only when data exists
    if (surplusTotal > 0) {
        const surplusCanvas = document.getElementById('surplusTeachersChart');
        if (surplusCanvas) {
            const surplusColors = surplusEntries.map(
                (_, i) =>
                    [
                        '#f59e0b',
                        '#ef4444',
                        '#f97316',
                        '#eab308',
                        '#ec4899',
                        '#a78bfa',
                        '#34d399',
                        '#60a5fa',
                        '#fb923c',
                        '#a3e635'
                    ][i % 10]
            );
            chartInstances.surplusTeachers = new Chart(surplusCanvas, {
                type: 'bar',
                data: {
                    labels: surplusEntries.map((e) => e[0]),
                    datasets: [
                        {
                            label: 'عدد الفائضين',
                            data: surplusEntries.map((e) => e[1]),
                            backgroundColor: surplusColors,
                            borderRadius: 6
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            rtl: true,
                            textDirection: 'rtl',
                            callbacks: {
                                label: (ctx) => ` ${ctx.parsed.x} أستاذ فائض`
                            }
                        }
                    },
                    scales: {
                        x: {
                            reverse: true,
                            position: 'top',
                            min: 0,
                            ticks: { color: tc.textColor, stepSize: 1 },
                            grid: { color: tc.gridColor }
                        },
                        y: {
                            position: 'right',
                            grid: { display: false },
                            ticks: {
                                color: '#f59e0b',
                                font: { family: "'IBM Plex Sans Arabic', sans-serif", weight: '700' }
                            }
                        }
                    }
                }
            });
        }
    }
}

function generatePalette(count) {
    const base = [
        '#3B6AC5',
        '#9B64AB',
        '#E8913A',
        '#4CAF50',
        '#F44336',
        '#00BCD4',
        '#795548',
        '#607D8B',
        '#FF5722',
        '#8BC34A',
        '#CDDC39',
        '#FFC107',
        '#03A9F4',
        '#E91E63',
        '#673AB7'
    ];
    const result = [];
    for (let i = 0; i < count; i++) result.push(base[i % base.length]);
    return result;
}

// Render Movement Section
async function renderMovement(stats) {
    if (!stats) stats = calculateStats();

    // Fetch real status and movement data from the database
    let dropouts = 0,
        notEnrolled = 0,
        expelled = 0;
    let departures = 0,
        arrivals = 0,
        internals = 0;

    try {
        const [statusResult, movementStats] = await Promise.all([
            window.api.students.getByStatus({ schoolYear: currentSchoolYear }),
            window.api.studentMovements.getStats(currentSchoolYear)
        ]);
        if (statusResult && statusResult.success && statusResult.summary) {
            dropouts = statusResult.summary.dropouts || 0;
            notEnrolled = statusResult.summary.notEnrolled || 0;
            expelled = statusResult.summary.expelled || 0;
        }
        if (movementStats) {
            departures = movementStats.departure || 0;
            arrivals = movementStats.arrival || 0;
            internals = movementStats.internal || 0;
        }
    } catch (err) {
        console.warn('Failed to load movement data:', err);
    }

    const activeStudents = Math.max(stats.total - dropouts - notEnrolled - expelled, 0);

    document.getElementById('movement-section').innerHTML = `
        <div class="movement-header"><h3><i class="fas fa-exchange-alt"></i> حركية التلاميذ</h3><div class="movement-filters"><select><option>جميع الأقسام</option></select><select><option>الوضعية الحالية</option></select><button class="btn-apply"><i class="fas fa-check"></i> تحيين</button></div></div>
        <div class="movement-stats">
            <div class="movement-stat registered"><span class="stat-value">${stats.total}</span><span class="stat-label"><i class="fas fa-users"></i> المسجلون</span></div>
            <div class="movement-stat studying"><span class="stat-value">${activeStudents}</span><span class="stat-label"><i class="fas fa-book-reader"></i> المتمدرسون</span></div>
            <div class="movement-stat dropouts"><span class="stat-value">${dropouts}</span><span class="stat-label"><i class="fas fa-user-slash"></i> المنقطعون</span></div>
            <div class="movement-stat non-enrolled"><span class="stat-value">${notEnrolled}</span><span class="stat-label"><i class="fas fa-user-times"></i> غير الملتحقين</span></div>
            <div class="movement-stat"><span class="stat-value">${departures}</span><span class="stat-label"><i class="fas fa-sign-out-alt"></i> المغادرون</span></div>
            <div class="movement-stat"><span class="stat-value">0</span><span class="stat-label"><i class="fas fa-handshake"></i> المدمجون</span></div>
            <div class="movement-stat"><span class="stat-value">${internals}</span><span class="stat-label"><i class="fas fa-exchange-alt"></i> المنتقلون</span></div>
            <div class="movement-stat"><span class="stat-value">${arrivals}</span><span class="stat-label"><i class="fas fa-sign-in-alt"></i> الوافدون</span></div>
        </div>`;
}

// Render Students Table
let tableEventsBound = false;
let currentTablePage = 1;
const STUDENTS_PER_PAGE = 20;

function renderStudentsTable(searchName = '', searchFamily = '', filterSection = 'all', page = 1) {
    // Filter students based on search criteria
    let filteredStudents = studentsData;

    if (filterSection !== 'all') {
        filteredStudents = filteredStudents.filter((s) => s.section === filterSection);
    }
    if (searchName.trim()) {
        filteredStudents = filteredStudents.filter((s) => s.firstName && s.firstName.includes(searchName.trim()));
    }
    if (searchFamily.trim()) {
        filteredStudents = filteredStudents.filter((s) => s.familyName && s.familyName.includes(searchFamily.trim()));
    }

    // Pagination calculations
    const totalStudents = filteredStudents.length;
    const totalPages = Math.ceil(totalStudents / STUDENTS_PER_PAGE) || 1;
    currentTablePage = Math.max(1, Math.min(page, totalPages));

    const startIndex = (currentTablePage - 1) * STUDENTS_PER_PAGE;
    const endIndex = startIndex + STUDENTS_PER_PAGE;
    const paginatedStudents = filteredStudents.slice(startIndex, endIndex);

    const stats = calculateStats();
    const sortedSectionsList2 = sortSectionNames(stats.sectionsList);
    const sectionsOptions = sortedSectionsList2
        .map(
            (s) => `<option value="${escapeHtml(s)}" ${filterSection === s ? 'selected' : ''}>${escapeHtml(s)}</option>`
        )
        .join('');

    const rows = paginatedStudents
        .map(
            (s) =>
                `<tr><td>${escapeHtml(s.section)}</td><td>${escapeHtml(s.id)}</td><td>${escapeHtml(s.code)}</td><td>${escapeHtml(s.familyName)}</td><td>${escapeHtml(s.firstName)}</td><td class="${s.gender === 'ذكر' ? 'gender-male' : 'gender-female'}">${escapeHtml(s.gender)}</td><td>${escapeHtml(s.birthDate)}</td><td>${escapeHtml(s.birthPlace)}</td><td></td></tr>`
        )
        .join('');

    // Generate pagination buttons
    let paginationHtml = '';
    if (totalPages > 1) {
        paginationHtml = `
            <div class="pagination">
                <button class="nav-btn" id="prev-page" ${currentTablePage === 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-right"></i> السابق
                </button>
                <div class="page-numbers">`;

        // Show page numbers
        const maxVisiblePages = 5;
        let startPage = Math.max(1, currentTablePage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

        if (endPage - startPage < maxVisiblePages - 1) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        if (startPage > 1) {
            paginationHtml += `<button class="page-btn" data-page="1">1</button>`;
            if (startPage > 2) paginationHtml += `<span class="ellipsis">...</span>`;
        }

        for (let i = startPage; i <= endPage; i++) {
            paginationHtml += `<button class="page-btn ${i === currentTablePage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) paginationHtml += `<span class="ellipsis">...</span>`;
            paginationHtml += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
        }

        paginationHtml += `
                </div>
                <button class="nav-btn" id="next-page" ${currentTablePage === totalPages ? 'disabled' : ''}>
                    التالي <i class="fas fa-chevron-left"></i>
                </button>
            </div>`;
    }

    document.getElementById('table-section').innerHTML = `
        <div class="table-header">
            <div class="table-title">
                <h3><i class="fas fa-list-alt"></i> لوائح التلاميذ</h3>
                <div class="table-filters">
                    <select id="table-section-filter">
                        <option value="all" ${filterSection === 'all' ? 'selected' : ''}>جميع الأقسام</option>
                        ${sectionsOptions}
                    </select>
                    <input id="search-name" placeholder="الاسم..." value="${searchName}">
                    <input id="search-family" placeholder="النسب..." value="${searchFamily}">
                </div>
            </div>
        </div>
        <div class="table-wrapper">
            <table class="students-table">
                <thead><tr><th>القسم</th><th>الرقم</th><th>الرمز</th><th>النسب</th><th>الاسم</th><th>النوع</th><th>تاريخ الازدياد</th><th>مكان الازدياد</th><th>ملاحظات</th></tr></thead>
                <tbody>${rows.length > 0 ? rows : '<tr><td colspan="9" style="text-align:center;padding:30px;color:#666;"><i class="fas fa-search" style="font-size:24px;margin-bottom:10px;display:block;"></i>لا توجد نتائج</td></tr>'}</tbody>
            </table>
        </div>
        ${paginationHtml}
        <div class="table-footer">
            <div class="table-info">
                <span><i class="fas fa-eye"></i> يُعرض: ${paginatedStudents.length} من ${totalStudents}</span>
                <span><i class="fas fa-file-alt"></i> الصفحة: ${currentTablePage} / ${totalPages}</span>
                <span><i class="fas fa-users"></i> المجموع الكلي: ${studentsData.length}</span>
            </div>
        </div>`;

    // Bind events only once
    if (!tableEventsBound) {
        tableEventsBound = true;
        document.getElementById('table-section').addEventListener('click', handleTableClick);
        document.getElementById('table-section').addEventListener('input', handleTableInput);
        document.getElementById('table-section').addEventListener('change', handleTableChange);
    }

    // Keep cursor position in search inputs
    const nameInput = document.getElementById('search-name');
    const familyInput = document.getElementById('search-family');
    if (document.activeElement && document.activeElement.id === 'search-name') {
        nameInput.focus();
        nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
    } else if (document.activeElement && document.activeElement.id === 'search-family') {
        familyInput.focus();
        familyInput.setSelectionRange(familyInput.value.length, familyInput.value.length);
    }
}

function handleTableClick(e) {
    if (e.target.id === 'prev-page' || e.target.closest('#prev-page')) {
        goToPage(currentTablePage - 1);
    } else if (e.target.id === 'next-page' || e.target.closest('#next-page')) {
        goToPage(currentTablePage + 1);
    } else if (e.target.classList.contains('page-btn')) {
        const page = parseInt(e.target.dataset.page);
        if (!isNaN(page)) goToPage(page);
    }
}

function handleTableInput(e) {
    if (e.target.id === 'search-name' || e.target.id === 'search-family') {
        performSearch();
    }
}

function handleTableChange(e) {
    if (e.target.id === 'table-section-filter') {
        currentTablePage = 1; // Reset to first page when filter changes
        performSearch();
    }
}

function goToPage(page) {
    const searchName = document.getElementById('search-name').value;
    const searchFamily = document.getElementById('search-family').value;
    const filterSection = document.getElementById('table-section-filter').value;
    renderStudentsTable(searchName, searchFamily, filterSection, page);
}

function performSearch() {
    const searchName = document.getElementById('search-name').value;
    const searchFamily = document.getElementById('search-family').value;
    const filterSection = document.getElementById('table-section-filter').value;
    renderStudentsTable(searchName, searchFamily, filterSection, currentTablePage);
}

function clearSearch() {
    currentTablePage = 1;
    renderStudentsTable('', '', 'all', 1);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize database
    initDatabase();

    // Initial skeleton render is handled by initDatabase() -> refreshDashboard()

    // Initialize extra buttons (notifications, home, print, export)
    initExtraButtons();

    // Re-render charts when theme changes so colors adapt
    const themeObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.attributeName === 'data-theme') {
                const filterEl = document.getElementById('age-section-filter');
                const currentFilter = filterEl ? filterEl.value : 'all';
                renderCharts(currentFilter);
                void renderExtraCharts();
                break;
            }
        }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});

function refreshDashboard() {
    const stats = calculateStats();
    renderStatsCards(stats);
    renderCharts('all', stats);
    void renderExtraCharts();
    void renderMovement(stats);
    void renderOwnerSyncSection();
}

// ===== وظائف الأزرار =====

// زر الصفحة الرئيسية - إعادة تحميل لوحة التحكم
function goToHome() {
    refreshDashboard();
    // إظهار جميع الأقسام
    document.getElementById('stats-section').style.display = 'block';
    document.getElementById('charts-section').style.display = 'block';
    document.getElementById('extra-charts-section').style.display = 'block';
    document.getElementById('movement-section').style.display = 'block';
    showToast('تم تحديث لوحة التحكم', 'success');
}

// زر الإشعارات — delegates to the unified Notification Engine panel (js/notifications.js)
function showNotifications() {
    if (typeof window.showNotificationsPanel === 'function') {
        window.showNotificationsPanel();
    }
}

// زر طباعة الجدول
async function printTable() {
    const tableSection = document.getElementById('table-section');
    if (!tableSection) return;

    const wrapper = tableSection.querySelector('.table-wrapper');
    if (!wrapper) return;

    const htmlContent = `
        <div class="print-header">
            <div class="school-name">الثانوية التأهيلية ابن سينا</div>
            <div class="doc-title">لائحة التلاميذ - ${currentSchoolYear}</div>
            <div class="doc-date">${new Date().toLocaleDateString('ar-MA')}</div>
        </div>
        ${wrapper.innerHTML}
    `;

    if (typeof electronPrint === 'function') {
        await electronPrint({
            htmlContent,
            title: 'لائحة التلاميذ - ' + currentSchoolYear,
            defaultFileName: 'لائحة_التلاميذ_' + currentSchoolYear.replace('/', '-'),
            pageSize: 'A4'
        });
    } else {
        window.print();
    }
}

// زر تصدير إلى Excel
async function exportToExcel() {
    if (studentsData.length === 0) {
        showToast('لا توجد بيانات للتصدير', 'error');
        return;
    }

    try {
        await ensureXlsxLoaded();
    } catch (error) {
        showToast('تعذر تحميل مكتبة Excel: ' + error.message, 'error');
        return;
    }

    const exportData = studentsData.map((s) => ({
        القسم: s.section,
        الرمز: s.code,
        النسب: s.familyName,
        الاسم: s.firstName,
        النوع: s.gender,
        'تاريخ الازدياد': s.birthDate,
        'مكان الازدياد': s.birthPlace
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'التلاميذ');
    XLSX.writeFile(wb, `لائحة_التلاميذ_${currentSchoolYear.replace('/', '-')}.xlsx`);
    showToast('تم تصدير البيانات بنجاح', 'success');
}

// زر طباعة الرسم البياني
async function printChart(chartId, title) {
    const canvas = document.getElementById(chartId);
    if (!canvas) return;

    let schoolName = '';
    try {
        const id = await window.api.reports.getIdentity();
        schoolName = id?.school_name || '';
    } catch (_) {
        /* identity unavailable */
    }

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

// تهيئة الأزرار الإضافية
function initExtraButtons() {
    // زر الإشعارات
    const notificationBtn = document.querySelector('.notification-btn');
    if (notificationBtn) {
        notificationBtn.addEventListener('click', showNotifications);
    }

    // زر الصفحة الرئيسية
    const homeBtn = document.querySelector('.home-btn');
    if (homeBtn) {
        homeBtn.addEventListener('click', goToHome);
    }

    // أزرار الطباعة في الرسوم البيانية
    document.addEventListener('click', (e) => {
        if (e.target.closest('#owner-sync-refresh-btn')) {
            void renderOwnerSyncSection(true);
        }

        if (e.target.closest('#owner-sync-sync-btn')) {
            if (!window.api?.ownerTelemetry?.syncNow) {
                showToast('خدمة المزامنة غير متاحة', 'error');
            } else {
                window.api.ownerTelemetry
                    .syncNow()
                    .then((res) => {
                        if (!res?.success) {
                            showToast(res?.error || 'فشلت المزامنة', 'error');
                            return;
                        }
                        showToast('تمت مزامنة الأجهزة بنجاح', 'success');
                        void renderOwnerSyncSection(true);
                    })
                    .catch((err) => showToast(err?.message || 'فشلت المزامنة', 'error'));
            }
        }

        if (e.target.closest('.chart-card button')) {
            const chartCard = e.target.closest('.chart-card');
            const canvas = chartCard.querySelector('canvas');
            const title = chartCard.querySelector('h3').textContent;
            if (canvas) {
                printChart(canvas.id, title);
            }
        }

        // زر طباعة الجدول
        if (e.target.closest('.btn-print')) {
            printTable();
        }

        // زر التصدير
        if (e.target.closest('.btn-export')) {
            exportToExcel();
        }
    });
}
