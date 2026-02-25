// Student Data - Will be loaded from SQLite
let studentsData = [];
let isDbReady = false;
let currentSchoolYear = '2025/2026'; // الموسم الدراسي الحالي

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
            studentsData = students.map(s => ({
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
        const years = new Set(['2025/2026']); // الموسم الافتراضي

        // إضافة الموسم الحالي دائماً
        years.add(currentSchoolYear);

        // إضافة المواسم المحفوظة محلياً
        const savedYears = localStorage.getItem('addedSchoolYears');
        if (savedYears) {
            JSON.parse(savedYears).forEach(y => years.add(y));
        }

        // تحديث القائمة في الواجهة
        const yearSelect = document.getElementById('school-year');
        if (yearSelect) {
            yearSelect.innerHTML = '';

            // ترتيب المواسم تنازلياً
            const sortedYears = [...years].sort().reverse();
            sortedYears.forEach(year => {
                const option = document.createElement('option');
                option.value = year;
                option.textContent = year;
                if (year === currentSchoolYear) option.selected = true;
                yearSelect.appendChild(option);
            });

            // إضافة خيار موسم جديد
            const newOption = document.createElement('option');
            newOption.value = 'new';
            newOption.textContent = '+ إضافة موسم جديد';
            yearSelect.appendChild(newOption);
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
        const dbStudents = students.map(s => ({
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
function getLevelFromSection(section) {
    if (!section) return { code: 'other', name: 'أخرى', order: 99 };
    const s = section.toUpperCase();

    // استخراج البادئة (قبل الرقم مثل TCSF-1 → TCSF)
    const prefix = s.replace(/-\d+$/, '');

    // === الجذع المشترك ===
    if (prefix === 'TCSF' || prefix === 'TCS' || s.startsWith('TCSF')) {
        return { code: 'tcsf', name: 'الجذع المشترك العلمي خيار فرنسية', order: 1 };
    }
    if (prefix === 'TCSA' || s.startsWith('TCSA')) {
        return { code: 'tcsa', name: 'الجذع المشترك العلمي خيار عربية', order: 2 };
    }
    if (prefix === 'TCLSH' || prefix === 'TCL' || s.startsWith('TCLSH') || s.startsWith('TCL')) {
        return { code: 'tclsh', name: 'الجذع المشترك للآداب والعلوم الإنسانية', order: 3 };
    }

    // === الأولى باكالوريا ===
    if (prefix === '1BACSM' || s.startsWith('1BACSM')) {
        return { code: '1bacsm', name: 'الأولى باكالوريا العلوم الرياضية خيار فرنسية', order: 4 };
    }
    if (prefix === '1BACSH' || prefix === '1BACL' || s.startsWith('1BACSH') || s.startsWith('1BACL')) {
        return { code: '1bacsh', name: 'الأولى باكالوريا آداب وعلوم إنسانية', order: 5 };
    }
    if (prefix === '1BACSEF' || s.startsWith('1BACSEF')) {
        return { code: '1bacsef', name: 'الأولى باكالوريا علوم تجريبية خيار فرنسية', order: 6 };
    }
    if (prefix === '1BACECO' || prefix === '1BACGE' || s.startsWith('1BACECO') || s.startsWith('1BACGE')) {
        return { code: '1baceco', name: 'الأولى باكالوريا علوم الإقتصاد والتدبير', order: 7 };
    }
    if (prefix === '1BACSEA' || s.startsWith('1BACSEA')) {
        return { code: '1bacsea', name: 'الأولى باكالوريا علوم تجريبية خيار عربية', order: 8 };
    }
    if (prefix === '1BACSE' || s.startsWith('1BACSE')) {
        return { code: '1bacse', name: 'الأولى باكالوريا علوم تجريبية', order: 6 };
    }

    // === الثانية باكالوريا ===
    if (prefix === '2BACSA' || s.startsWith('2BACSA')) {
        return { code: '2bacsa', name: 'الثانية باكالوريا علوم شرعية', order: 8 };
    }
    if (prefix === '2BACSM' || s.startsWith('2BACSM')) {
        return { code: '2bacsm', name: 'الثانية باكالوريا العلوم الرياضية', order: 8 };
    }
    if (prefix === '2BACSVT' || s.startsWith('2BACSVT') || s.includes('SVT')) {
        return { code: '2bacsvt', name: 'الثانية باكالوريا علوم الحياة والأرض', order: 9 };
    }
    if (prefix === '2BACPC' || s.startsWith('2BACPC') || (s.includes('2BAC') && s.includes('PC'))) {
        return { code: '2bacpc', name: 'الثانية باكالوريا علوم فيزيائية خيار فرنسية', order: 10 };
    }
    if (prefix === '2BACSH' || prefix === '2BACL' || s.startsWith('2BACSH') || s.startsWith('2BACL')) {
        return { code: '2bacsh', name: 'الثانية باكالوريا آداب وعلوم إنسانية', order: 11 };
    }
    if (prefix === '2BACECO' || prefix === '2BACGC' || s.includes('ECO') || s.includes('GESTION')) {
        return { code: '2baceco', name: 'الثانية باكالوريا علوم الإقتصاد والتدبير', order: 12 };
    }

    // Fallbacks
    if (s.includes('1BAC')) return { code: '1bac', name: 'الأولى باكالوريا', order: 13 };
    if (s.includes('2BAC')) return { code: '2bac', name: 'الثانية باكالوريا', order: 14 };
    if (s.startsWith('TC')) return { code: 'tc', name: 'الجذع المشترك', order: 15 };

    return { code: 'other', name: section, order: 99 };
}

// استخراج وحفظ المستويات الفريدة من بيانات التلاميذ
async function saveLevelsFromStudents(students) {
    try {
        const sections = [...new Set(students.map(s => s.section).filter(s => s))];
        const levelsMap = new Map();

        sections.forEach(section => {
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
        console.log('✅ Saved levels:', levels.map(l => l.name).join(', '));

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

        console.log('✅ Saved levels mapping:', levelsArray.map(l => l.name).join(', '));
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
    const females = studentsData.filter(s => s.gender === "أنثى").length;
    const males = studentsData.filter(s => s.gender === "ذكر").length;
    const sections = [...new Set(studentsData.map(s => s.section))];
    // Calculate levels - extract level from section name (e.g., TCSF, 1BAC, 2BAC, etc.)
    const levels = [...new Set(sections.map(s => {
        // Try to extract level prefix from section name
        const match = s ? s.match(/^([A-Z0-9]+)/i) : null;
        return match ? match[1] : s;
    }))];
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
    studentsData.forEach(s => {
        if (!s.birthDate) return;
        const birthYear = parseInt(s.birthDate.split('-')[0]);
        const age = currentYear - birthYear;
        if (!ageGroups[age]) ageGroups[age] = { total: 0, males: 0, females: 0 };
        ageGroups[age].total++;
        s.gender === "ذكر" ? ageGroups[age].males++ : ageGroups[age].females++;
    });
    return ageGroups;
}

// Render Stats Cards
function renderStatsCards(stats) {
    if (!stats) stats = calculateStats();
    const sectionsInfo = stats.sectionsList.length <= 3 ? stats.sectionsList.join(', ') : stats.sectionsList.slice(0, 2).join(', ') + '...';
    const levelsInfo = stats.levelsList.length <= 2 ? stats.levelsList.join(', ') : stats.levelsList[0] + '...';
    const femalesPct = stats.total > 0 ? ((stats.females / stats.total) * 100).toFixed(1) : 0;
    const malesPct = stats.total > 0 ? ((stats.males / stats.total) * 100).toFixed(1) : 0;
    const html = `
        <div class="stats-grid">
            <div class="stat-card total"><div class="stat-icon"><i class="fas fa-users"></i></div><div class="stat-content"><h3>عدد التلاميذ</h3><p class="stat-number">${stats.total}</p></div><div class="stat-footer"><span class="percentage">${stats.sections} أقسام</span></div></div>
            <div class="stat-card females"><div class="stat-icon"><i class="fas fa-female"></i></div><div class="stat-content"><h3>عدد الإناث</h3><p class="stat-number">${stats.females}</p></div><div class="stat-footer"><span class="percentage">${femalesPct}%</span></div></div>
            <div class="stat-card males"><div class="stat-icon"><i class="fas fa-male"></i></div><div class="stat-content"><h3>عدد الذكور</h3><p class="stat-number">${stats.males}</p></div><div class="stat-footer"><span class="percentage">${malesPct}%</span></div></div>
            <div class="stat-card sections"><div class="stat-icon"><i class="fas fa-chalkboard"></i></div><div class="stat-content"><h3>عدد الأقسام</h3><p class="stat-number">${stats.sections}</p></div><div class="stat-footer"><span>${escapeHtml(sectionsInfo)}</span></div></div>
            <div class="stat-card levels"><div class="stat-icon"><i class="fas fa-layer-group"></i></div><div class="stat-content"><h3>عدد المستويات</h3><p class="stat-number">${stats.levels}</p></div><div class="stat-footer"><span>${escapeHtml(levelsInfo)}</span></div></div>
            <div class="stat-card average"><div class="stat-icon"><i class="fas fa-calculator"></i></div><div class="stat-content"><h3>معدل القسم</h3><p class="stat-number">${stats.avgPerSection}</p></div><div class="stat-footer"><span>تلميذ/قسم</span></div></div>
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
        <div class="students-results" style="margin-bottom: 20px; border: 1px dashed #f59e0b; background: #fff8e8;">
            <h3><i class="fas fa-satellite-dish"></i> متابعة الأجهزة المثبّتة</h3>
            <p style="margin: 10px 0; color: #7a4b0e;">${escapeHtml(message || 'تعذر تحميل بيانات الأجهزة')}</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
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
            <div class="students-results" style="margin-bottom: 20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
                    <h3><i class="fas fa-satellite-dish"></i> متابعة الأجهزة المثبّتة</h3>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button type="button" class="btn btn-primary" id="owner-sync-refresh-btn"><i class="fas fa-sync-alt"></i> تحديث</button>
                        <button type="button" class="btn btn-warning" id="owner-sync-sync-btn"><i class="fas fa-cloud-upload-alt"></i> مزامنة الآن</button>
                    </div>
                </div>

                <div class="stats-grid" style="margin-bottom: 10px;">
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
                            ${devices.length
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
                : '<tr><td colspan="5" style="text-align:center;padding:18px;">لا توجد أجهزة بعد</td></tr>'}
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
    place: null
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
    const sectionsOptions = stats.sectionsList.map(s => `<option value="${escapeHtml(s)}" ${filterSection === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');

    const html = `<div class="charts-grid">
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-chart-bar"></i> إحصاء التلاميذ حسب السن</h3><div class="chart-controls"><select id="age-section-filter"><option value="all" ${filterSection === 'all' ? 'selected' : ''}>جميع الأقسام</option>${sectionsOptions}</select><button><i class="fas fa-print"></i> طباعة</button></div></div><div class="chart-body"><canvas id="ageChart"></canvas></div></div>
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-pie-chart"></i> توزيع التلاميذ حسب الجنس</h3></div><div class="chart-body"><canvas id="genderChart"></canvas></div></div>
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-chart-bar"></i> إحصاء التلاميذ حسب المستويات</h3></div><div class="chart-body"><canvas id="levelsChart"></canvas></div></div>
        <div class="chart-card"><div class="chart-header"><h3><i class="fas fa-map-marker-alt"></i> توزيع التلاميذ حسب مكان الازدياد</h3></div><div class="chart-body"><canvas id="placeChart"></canvas></div></div>
    </div>`;
    document.getElementById('charts-section').innerHTML = html;

    // Filter data based on section
    const filteredData = filterSection === 'all' ? studentsData : studentsData.filter(s => s.section === filterSection);

    // Age Chart with filtered data
    const ageStats = {};
    const currentYear = new Date().getFullYear();
    filteredData.forEach(s => {
        if (!s.birthDate) return;
        const birthYear = parseInt(s.birthDate.split('-')[0]);
        const age = currentYear - birthYear;
        if (!ageStats[age]) ageStats[age] = { total: 0, males: 0, females: 0 };
        ageStats[age].total++;
        s.gender === "ذكر" ? ageStats[age].males++ : ageStats[age].females++;
    });

    const ages = Object.keys(ageStats).sort((a, b) => a - b);
    chartInstances.age = new Chart(document.getElementById('ageChart'), {
        type: 'bar',
        data: {
            labels: ages.map(a => a + ' سنة'),
            datasets: [
                { label: 'عدد التلاميذ', data: ages.map(a => ageStats[a].total), backgroundColor: '#2D5F4A', borderRadius: 6 },
                { label: 'الإناث', data: ages.map(a => ageStats[a].females), backgroundColor: '#4A8B6F', borderRadius: 6 },
                { label: 'الذكور', data: ages.map(a => ageStats[a].males), backgroundColor: '#C8A882', borderRadius: 6 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    // Gender Chart
    chartInstances.gender = new Chart(document.getElementById('genderChart'), {
        type: 'doughnut',
        data: { labels: ['الإناث', 'الذكور'], datasets: [{ data: [stats.females, stats.males], backgroundColor: ['#4A8B6F', '#C8A882'], borderWidth: 0, hoverOffset: 8 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    // Levels Chart - Show stats per section
    const sectionStats = {};
    studentsData.forEach(s => {
        if (!sectionStats[s.section]) sectionStats[s.section] = { total: 0, males: 0, females: 0 };
        sectionStats[s.section].total++;
        s.gender === "ذكر" ? sectionStats[s.section].males++ : sectionStats[s.section].females++;
    });
    const sectionNames = Object.keys(sectionStats);
    chartInstances.levels = new Chart(document.getElementById('levelsChart'), {
        type: 'bar',
        data: {
            labels: sectionNames,
            datasets: [
                { label: 'المجموع', data: sectionNames.map(s => sectionStats[s].total), backgroundColor: '#2D5F4A', borderRadius: 6 },
                { label: 'إناث', data: sectionNames.map(s => sectionStats[s].females), backgroundColor: '#4A8B6F', borderRadius: 6 },
                { label: 'ذكور', data: sectionNames.map(s => sectionStats[s].males), backgroundColor: '#C8A882', borderRadius: 6 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    // Birth Place Chart
    const places = {};
    studentsData.forEach(s => { const p = s.birthPlace || '-'; places[p] = (places[p] || 0) + 1; });
    const topPlaces = Object.entries(places).sort((a, b) => b[1] - a[1]).slice(0, 6);
    chartInstances.place = new Chart(document.getElementById('placeChart'), {
        type: 'bar',
        data: { labels: topPlaces.map(p => p[0]), datasets: [{ label: 'العدد', data: topPlaces.map(p => p[1]), backgroundColor: '#1B3D30', borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { reverse: true, position: 'top' }, y: { position: 'right' } }, plugins: { legend: { display: false } } }
    });

    // Add section filter event listener (remove old listener first to avoid leak)
    const filterEl = document.getElementById('age-section-filter');
    if (filterEl) {
        filterEl.onchange = (e) => { renderCharts(e.target.value); };
    }
}

// Render Movement Section
function renderMovement(stats) {
    if (!stats) stats = calculateStats();
    document.getElementById('movement-section').innerHTML = `
        <div class="movement-header"><h3><i class="fas fa-exchange-alt"></i> حركية التلاميذ</h3><div class="movement-filters"><select><option>جميع الأقسام</option></select><select><option>الوضعية الحالية</option></select><button class="btn-apply"><i class="fas fa-check"></i> تحيين</button></div></div>
        <div class="movement-stats">
            <div class="movement-stat registered"><span class="stat-value">${stats.total}</span><span class="stat-label"><i class="fas fa-users"></i> المسجلون</span></div>
            <div class="movement-stat studying"><span class="stat-value">${stats.total}</span><span class="stat-label"><i class="fas fa-book-reader"></i> المتمدرسون</span></div>
            <div class="movement-stat dropouts"><span class="stat-value">0</span><span class="stat-label"><i class="fas fa-user-slash"></i> المنقطعون</span></div>
            <div class="movement-stat non-enrolled"><span class="stat-value">0</span><span class="stat-label"><i class="fas fa-user-times"></i> غير الملتحقين</span></div>
            <div class="movement-stat"><span class="stat-value">0</span><span class="stat-label"><i class="fas fa-sign-out-alt"></i> المغادرون</span></div>
            <div class="movement-stat"><span class="stat-value">0</span><span class="stat-label"><i class="fas fa-handshake"></i> المدمجون</span></div>
            <div class="movement-stat"><span class="stat-value">0</span><span class="stat-label"><i class="fas fa-exchange-alt"></i> المنتقلون</span></div>
            <div class="movement-stat"><span class="stat-value">0</span><span class="stat-label"><i class="fas fa-sign-in-alt"></i> الوافدون</span></div>
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
        filteredStudents = filteredStudents.filter(s => s.section === filterSection);
    }
    if (searchName.trim()) {
        filteredStudents = filteredStudents.filter(s => s.firstName && s.firstName.includes(searchName.trim()));
    }
    if (searchFamily.trim()) {
        filteredStudents = filteredStudents.filter(s => s.familyName && s.familyName.includes(searchFamily.trim()));
    }

    // Pagination calculations
    const totalStudents = filteredStudents.length;
    const totalPages = Math.ceil(totalStudents / STUDENTS_PER_PAGE) || 1;
    currentTablePage = Math.max(1, Math.min(page, totalPages));

    const startIndex = (currentTablePage - 1) * STUDENTS_PER_PAGE;
    const endIndex = startIndex + STUDENTS_PER_PAGE;
    const paginatedStudents = filteredStudents.slice(startIndex, endIndex);

    const stats = calculateStats();
    const sectionsOptions = stats.sectionsList.map(s => `<option value="${escapeHtml(s)}" ${filterSection === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');

    const rows = paginatedStudents.map(s => `<tr><td>${escapeHtml(s.section)}</td><td>${escapeHtml(s.id)}</td><td>${escapeHtml(s.code)}</td><td>${escapeHtml(s.familyName)}</td><td>${escapeHtml(s.firstName)}</td><td class="${s.gender === 'ذكر' ? 'gender-male' : 'gender-female'}">${escapeHtml(s.gender)}</td><td>${escapeHtml(s.birthDate)}</td><td>${escapeHtml(s.birthPlace)}</td><td></td></tr>`).join('');

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
});




function refreshDashboard() {
    const stats = calculateStats();
    renderStatsCards(stats);
    renderCharts('all', stats);
    renderMovement(stats);
    void renderOwnerSyncSection();
}

// ===== وظائف الأزرار =====

// زر الصفحة الرئيسية - إعادة تحميل لوحة التحكم
function goToHome() {
    refreshDashboard();
    // إظهار جميع الأقسام
    document.getElementById('stats-section').style.display = 'block';
    document.getElementById('charts-section').style.display = 'block';
    document.getElementById('movement-section').style.display = 'block';
    showToast('تم تحديث لوحة التحكم', 'success');
}

// زر الإشعارات
function showNotifications() {
    // إنشاء قائمة الإشعارات
    const existingDropdown = document.querySelector('.notifications-dropdown');
    if (existingDropdown) {
        existingDropdown.remove();
        return;
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'notifications-dropdown';
    dropdown.innerHTML = `
        <div class="notifications-header">
            <h4><i class="fas fa-bell"></i> الإشعارات</h4>
            <button class="mark-all-read"><i class="fas fa-check-double"></i> تحديد الكل كمقروء</button>
        </div>
        <div class="notifications-list">
            <div class="notification-item unread">
                <div class="notification-icon"><i class="fas fa-user-plus"></i></div>
                <div class="notification-content">
                    <p>تم تسجيل تلميذ جديد</p>
                    <span class="notification-time">منذ 5 دقائق</span>
                </div>
            </div>
            <div class="notification-item unread">
                <div class="notification-icon"><i class="fas fa-file-import"></i></div>
                <div class="notification-content">
                    <p>تم استيراد لائحة جديدة</p>
                    <span class="notification-time">منذ ساعة</span>
                </div>
            </div>
            <div class="notification-item unread">
                <div class="notification-icon"><i class="fas fa-exclamation-triangle"></i></div>
                <div class="notification-content">
                    <p>يوجد 3 تلاميذ بدون معلومات كاملة</p>
                    <span class="notification-time">منذ يومين</span>
                </div>
            </div>
        </div>
    `;
    document.querySelector('.header-right').appendChild(dropdown);

    // إغلاق عند النقر خارج القائمة
    setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
            if (!e.target.closest('.notification-btn') && !e.target.closest('.notifications-dropdown')) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        });
    }, 100);
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

    const exportData = studentsData.map(s => ({
        'القسم': s.section,
        'الرمز': s.code,
        'النسب': s.familyName,
        'الاسم': s.firstName,
        'النوع': s.gender,
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

    const htmlContent = `
        <div class="print-header">
            <div class="school-name">الثانوية التأهيلية ابن سينا</div>
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

function showToast(message, type = 'success') {
    // إزالة أي toast موجود
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    // إنشاء toast جديد
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = document.createElement('i');
    icon.className = `fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}`;

    const span = document.createElement('span');
    span.textContent = message;

    toast.appendChild(icon);
    toast.appendChild(span);
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
