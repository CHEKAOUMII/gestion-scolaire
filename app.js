// Student Data - Will be loaded from SQLite
let studentsData = [];
let isDbReady = false;
let currentSchoolYear = '2025/2026'; // الموسم الدراسي الحالي

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

        // جلب التلاميذ من SQLite
        const students = await window.api.students.getAll(year);

        if (students && students.length > 0) {
            studentsData = students.map(s => ({
                id: s.id,
                code: s.code,
                familyName: s.family_name,
                firstName: s.full_name,
                gender: s.gender,
                birthDate: s.birth_date,
                birthPlace: '', // Add if needed
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
function renderStatsCards() {
    const stats = calculateStats();
    const sectionsInfo = stats.sectionsList.length <= 3 ? stats.sectionsList.join(', ') : stats.sectionsList.slice(0, 2).join(', ') + '...';
    const levelsInfo = stats.levelsList.length <= 2 ? stats.levelsList.join(', ') : stats.levelsList[0] + '...';
    const html = `
        <div class="stats-grid">
            <div class="stat-card total"><div class="stat-icon"><i class="fas fa-users"></i></div><div class="stat-content"><h3>عدد التلاميذ</h3><p class="stat-number">${stats.total}</p></div><div class="stat-footer"><span class="trend up"><i class="fas fa-arrow-up"></i> +5%</span></div></div>
            <div class="stat-card females"><div class="stat-icon"><i class="fas fa-female"></i></div><div class="stat-content"><h3>عدد الإناث</h3><p class="stat-number">${stats.females}</p></div><div class="stat-footer"><span class="percentage">${stats.total > 0 ? ((stats.females / stats.total) * 100).toFixed(1) : 0}%</span></div></div>
            <div class="stat-card males"><div class="stat-icon"><i class="fas fa-male"></i></div><div class="stat-content"><h3>عدد الذكور</h3><p class="stat-number">${stats.males}</p></div><div class="stat-footer"><span class="percentage">${stats.total > 0 ? ((stats.males / stats.total) * 100).toFixed(1) : 0}%</span></div></div>
            <div class="stat-card sections"><div class="stat-icon"><i class="fas fa-chalkboard"></i></div><div class="stat-content"><h3>عدد الأقسام</h3><p class="stat-number">${stats.sections}</p></div><div class="stat-footer"><span>${sectionsInfo}</span></div></div>
            <div class="stat-card levels"><div class="stat-icon"><i class="fas fa-layer-group"></i></div><div class="stat-content"><h3>عدد المستويات</h3><p class="stat-number">${stats.levels}</p></div><div class="stat-footer"><span>${levelsInfo}</span></div></div>
            <div class="stat-card average"><div class="stat-icon"><i class="fas fa-calculator"></i></div><div class="stat-content"><h3>معدل القسم</h3><p class="stat-number">${stats.avgPerSection}</p></div><div class="stat-footer"><span>تلميذ/قسم</span></div></div>
        </div>`;
    document.getElementById('stats-section').innerHTML = html;
}

// Render Charts
let ageChartInstance = null;

function renderCharts(filterSection = 'all') {
    const stats = calculateStats();
    const sectionsOptions = stats.sectionsList.map(s => `<option value="${s}" ${filterSection === s ? 'selected' : ''}>${s}</option>`).join('');

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
    ageChartInstance = new Chart(document.getElementById('ageChart'), {
        type: 'bar',
        data: {
            labels: ages.map(a => a + ' سنة'),
            datasets: [
                { label: 'عدد التلاميذ', data: ages.map(a => ageStats[a].total), backgroundColor: '#8b0000' },
                { label: 'الإناث', data: ages.map(a => ageStats[a].females), backgroundColor: '#00bcd4' },
                { label: 'الذكور', data: ages.map(a => ageStats[a].males), backgroundColor: '#ff5722' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    // Gender Chart
    new Chart(document.getElementById('genderChart'), {
        type: 'doughnut',
        data: { labels: ['الإناث', 'الذكور'], datasets: [{ data: [stats.females, stats.males], backgroundColor: ['#00bcd4', '#ff5722'] }] },
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
    new Chart(document.getElementById('levelsChart'), {
        type: 'bar',
        data: {
            labels: sectionNames,
            datasets: [
                { label: 'المجموع', data: sectionNames.map(s => sectionStats[s].total), backgroundColor: '#8b0000' },
                { label: 'إناث', data: sectionNames.map(s => sectionStats[s].females), backgroundColor: '#00bcd4' },
                { label: 'ذكور', data: sectionNames.map(s => sectionStats[s].males), backgroundColor: '#ff5722' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });

    // Birth Place Chart
    const places = {};
    studentsData.forEach(s => { const p = s.birthPlace || '-'; places[p] = (places[p] || 0) + 1; });
    const topPlaces = Object.entries(places).sort((a, b) => b[1] - a[1]).slice(0, 6);
    new Chart(document.getElementById('placeChart'), {
        type: 'bar',
        data: { labels: topPlaces.map(p => p[0]), datasets: [{ label: 'العدد', data: topPlaces.map(p => p[1]), backgroundColor: '#00838f' }] },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } }
    });

    // Add section filter event listener
    document.getElementById('age-section-filter').addEventListener('change', (e) => {
        renderCharts(e.target.value);
    });
}

// Render Movement Section
function renderMovement() {
    const stats = calculateStats();
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
    const sectionsOptions = stats.sectionsList.map(s => `<option value="${s}" ${filterSection === s ? 'selected' : ''}>${s}</option>`).join('');

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
            <div class="table-actions">
                <button class="btn btn-import" id="btn-import"><i class="fas fa-file-import"></i> استيراد لائحة</button>
                <button class="btn btn-search" id="btn-search"><i class="fas fa-search"></i> بحث</button>
                <button class="btn btn-clear" id="btn-clear"><i class="fas fa-times"></i> مسح</button>
                <button class="btn btn-print"><i class="fas fa-print"></i> طباعة</button>
                <button class="btn btn-export"><i class="fas fa-file-excel"></i> تصدير</button>
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
    if (e.target.id === 'btn-search' || e.target.closest('#btn-search')) {
        performSearch();
    } else if (e.target.id === 'btn-clear' || e.target.closest('#btn-clear')) {
        clearSearch();
    } else if (e.target.id === 'prev-page' || e.target.closest('#prev-page')) {
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

// Update Time
function updateTime() {
    const now = new Date();
    const time = now.toLocaleTimeString('ar-MA', { hour: '2-digit', minute: '2-digit' });
    const date = `${now.getDate()}/${now.getMonth() + 1}`;
    document.getElementById('current-time').textContent = time;
    document.getElementById('current-date').textContent = date;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize database
    initDatabase();

    renderStatsCards();
    renderCharts();
    renderMovement();
    renderStudentsTable();
    updateTime();
    setInterval(updateTime, 1000);

    // Sidebar toggle
    document.getElementById('menu-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('collapsed');
        document.querySelector('.main-content').style.marginRight = document.getElementById('sidebar').classList.contains('collapsed') ? '80px' : '280px';
    });

    // Expandable menu
    document.querySelectorAll('.expandable > a').forEach(el => {
        el.addEventListener('click', (e) => { e.preventDefault(); el.parentElement.classList.toggle('open'); });
    });

    // Initialize import functionality
    initImport();

    // Initialize extra buttons (notifications, home, print, export)
    initExtraButtons();
});

// Import functionality
let importedData = [];
let currentWorkbook = null;

function initImport() {
    const modal = document.getElementById('import-modal');
    const fileInput = document.getElementById('file-input');
    const dropzone = document.getElementById('dropzone');
    const browseBtn = document.getElementById('browse-btn');
    const modalClose = document.getElementById('modal-close');
    const cancelImport = document.getElementById('cancel-import');
    const confirmImport = document.getElementById('confirm-import');

    document.addEventListener('click', (e) => {
        if (e.target.closest('#btn-import')) openModal();
    });

    function openModal() { modal.classList.add('active'); resetModal(); }
    function closeModal() { modal.classList.remove('active'); }

    modalClose.addEventListener('click', closeModal);
    cancelImport.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
    fileInput.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFile(e.target.files[0]); });

    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault(); dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });

    confirmImport.addEventListener('click', async () => {
        if (importedData.length > 0) {
            studentsData = importedData;
            refreshDashboard();

            // Save to SQLite
            const saved = await saveToDatabase(importedData);
            closeModal();

            if (saved) {
                showToast('تم استيراد ' + importedData.length + ' تلميذ وحفظهم في قاعدة البيانات', 'success');
            } else {
                showToast('تم استيراد ' + importedData.length + ' تلميذ (حدث خطأ في الحفظ)', 'error');
            }
        }
    });

    // Back to upload button
    document.getElementById('back-to-upload').addEventListener('click', resetModal);
}

function resetModal() {
    document.getElementById('dropzone').style.display = 'block';
    document.getElementById('import-progress').style.display = 'none';
    document.getElementById('import-preview').style.display = 'none';
    document.getElementById('sheet-selector').style.display = 'none';
    document.getElementById('file-input').value = '';
    document.getElementById('progress-fill').style.width = '0%';
    importedData = [];
    currentWorkbook = null;
}

function handleFile(file) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
        showToast('يرجى اختيار ملف Excel صالح', 'error'); return;
    }
    document.getElementById('dropzone').style.display = 'none';
    document.getElementById('import-progress').style.display = 'block';

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            currentWorkbook = XLSX.read(data, { type: 'array' });

            let progress = 0;
            const progressFill = document.getElementById('progress-fill');
            const interval = setInterval(() => {
                progress += 10; progressFill.style.width = progress + '%';
                if (progress >= 100) {
                    clearInterval(interval);
                    // Check if multiple sheets
                    if (currentWorkbook.SheetNames.length > 1) {
                        showSheetSelector();
                    } else {
                        processSheet(currentWorkbook.SheetNames[0]);
                    }
                }
            }, 50);
        } catch (error) { showToast('خطأ: ' + error.message, 'error'); resetModal(); }
    };
    reader.readAsArrayBuffer(file);
}

function showSheetSelector() {
    document.getElementById('import-progress').style.display = 'none';
    document.getElementById('sheet-selector').style.display = 'block';

    const sheetsList = document.getElementById('sheets-list');
    sheetsList.innerHTML = '';

    // Calculate total rows for all sheets info
    let totalRows = 0;
    currentWorkbook.SheetNames.forEach(sheetName => {
        const sheet = currentWorkbook.Sheets[sheetName];
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
        totalRows += range.e.r - range.s.r + 1;
    });

    currentWorkbook.SheetNames.forEach((sheetName, index) => {
        const sheet = currentWorkbook.Sheets[sheetName];
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
        const rowCount = range.e.r - range.s.r + 1;

        const sheetItem = document.createElement('div');
        sheetItem.className = 'sheet-item';
        sheetItem.innerHTML = `
            <span class="sheet-name"><i class="fas fa-file-alt"></i> ${sheetName}</span>
            <span class="sheet-rows">${rowCount} صف</span>
        `;
        sheetItem.addEventListener('click', () => {
            document.getElementById('sheet-selector').style.display = 'none';
            document.getElementById('import-progress').style.display = 'block';
            document.getElementById('progress-fill').style.width = '0%';

            let progress = 0;
            const progressFill = document.getElementById('progress-fill');
            const interval = setInterval(() => {
                progress += 20; progressFill.style.width = progress + '%';
                if (progress >= 100) {
                    clearInterval(interval);
                    processSheet(sheetName);
                }
            }, 30);
        });
        sheetsList.appendChild(sheetItem);
    });

    // Add Import All button listener
    document.getElementById('import-all-sheets').onclick = () => {
        document.getElementById('sheet-selector').style.display = 'none';
        document.getElementById('import-progress').style.display = 'block';
        document.getElementById('import-status').textContent = 'جاري استيراد جميع الأوراق...';
        document.getElementById('progress-fill').style.width = '0%';

        let progress = 0;
        const progressFill = document.getElementById('progress-fill');
        const interval = setInterval(() => {
            progress += 10; progressFill.style.width = progress + '%';
            if (progress >= 100) {
                clearInterval(interval);
                processAllSheets();
            }
        }, 40);
    };
}

function processAllSheets() {
    importedData = [];
    let studentId = 1;
    const extractedLevels = new Map(); // لحفظ المستويات المستخرجة

    currentWorkbook.SheetNames.forEach(sheetName => {
        const sheet = currentWorkbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        // Find header row
        let headerRowIndex = -1, headers = {};
        for (let i = 0; i < Math.min(jsonData.length, 15); i++) {
            const row = jsonData[i];
            if (row && row.some(cell => cell && (String(cell).includes('الرمز') || String(cell).includes('ر.ت')))) {
                headerRowIndex = i;
                row.forEach((cell, idx) => {
                    const c = String(cell || '').trim();
                    if (c.includes('ر.ت') || c === 'الرقم') headers.id = idx;
                    if (c === 'الرمز') headers.code = idx;
                    if (c === 'النسب') headers.familyName = idx;
                    if (c === 'الإسم' || c === 'الاسم') headers.firstName = idx;
                    if (c === 'النوع') headers.gender = idx;
                    if (c.includes('تاريخ')) headers.birthDate = idx;
                    if (c.includes('مكان')) headers.birthPlace = idx;
                });
                break;
            }
        }

        if (headerRowIndex === -1) return; // Skip sheets without valid headers

        // البحث عن عمود المستوى ديناميكياً
        let levelColumnIndex = -1;
        const headerRow = jsonData[headerRowIndex];
        if (headerRow) {
            // طباعة جميع أسماء الأعمدة للتشخيص
            console.log(`📊 Sheet: ${sheetName}, Headers (${headerRow.length} columns):`, headerRow.filter(h => h).join(' | '));

            headerRow.forEach((cell, idx) => {
                const c = String(cell || '').trim();
                if (c === 'المستوى' || c.includes('مستوى') || c.includes('Level')) {
                    levelColumnIndex = idx;
                    console.log(`📍 Found level column at index ${idx}: "${c}"`);
                }
            });
        }

        // Fallback: جرب العمود DC (index 107) أو 106
        if (levelColumnIndex === -1) {
            // حساب عمود DC: A-Z = 0-25, AA-AZ = 26-51, BA-BZ = 52-77, CA-CZ = 78-103, DA-DC = 104-106
            levelColumnIndex = 106; // DC
            console.log(`📍 Using fallback column DC (index 106)`);
        }

        // طباعة قيمة الصف الأول للتشخيص
        const firstDataRow = jsonData[headerRowIndex + 1];
        if (firstDataRow) {
            console.log(`🔍 First data row, column ${levelColumnIndex} value:`, firstDataRow[levelColumnIndex]);
            // طباعة عدة أعمدة للمساعدة في التشخيص
            console.log(`🔍 Columns 100-110:`, firstDataRow.slice(100, 111));
        }

        // Extract students from this sheet
        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || !row[headers.code]) continue;

            let birthDate = row[headers.birthDate] || '';
            if (typeof birthDate === 'number') {
                const date = new Date((birthDate - 25569) * 86400 * 1000);
                birthDate = date.toISOString().split('T')[0];
            }

            // استخراج اسم المستوى من العمود المحدد
            const levelName = row[levelColumnIndex] ? String(row[levelColumnIndex]).trim() : '';

            // ربط اسم القسم (sheetName) بالمستوى
            if (levelName && !extractedLevels.has(sheetName)) {
                extractedLevels.set(sheetName, levelName);
                console.log(`📋 Level extracted: ${sheetName} → ${levelName}`);
            }

            importedData.push({
                id: studentId++,
                code: String(row[headers.code] || ''),
                familyName: String(row[headers.familyName] || ''),
                firstName: String(row[headers.firstName] || ''),
                gender: String(row[headers.gender] || ''),
                birthDate: String(birthDate),
                birthPlace: String(row[headers.birthPlace] || '-'),
                section: sheetName, // Use sheet name as section
                level: levelName // اسم المستوى من العمود DC
            });
        }
    });

    // حفظ المستويات المستخرجة
    if (extractedLevels.size > 0) {
        saveLevelsMapping(extractedLevels);
    }

    if (importedData.length === 0) {
        showToast('لم يتم العثور على بيانات صالحة في الأوراق', 'error');
        resetModal();
        return;
    }

    showPreview();
}

function processSheet(sheetName) {
    const sheet = currentWorkbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    processExcelData(jsonData, sheetName);
}

function processExcelData(jsonData, sheetName = 'TCSF-1') {
    let headerRowIndex = -1, headers = {};
    for (let i = 0; i < Math.min(jsonData.length, 15); i++) {
        const row = jsonData[i];
        if (row && row.some(cell => cell && (String(cell).includes('الرمز') || String(cell).includes('ر.ت')))) {
            headerRowIndex = i;
            row.forEach((cell, idx) => {
                const c = String(cell || '').trim();
                if (c.includes('ر.ت') || c === 'الرقم') headers.id = idx;
                if (c === 'الرمز') headers.code = idx;
                if (c === 'النسب') headers.familyName = idx;
                if (c === 'الإسم' || c === 'الاسم') headers.firstName = idx;
                if (c === 'النوع') headers.gender = idx;
                if (c.includes('تاريخ')) headers.birthDate = idx;
                if (c.includes('مكان')) headers.birthPlace = idx;
            });
            break;
        }
    }
    if (headerRowIndex === -1) { showToast('لم يتم العثور على رؤوس الأعمدة', 'error'); resetModal(); return; }

    importedData = [];
    for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || !row[headers.code]) continue;
        let birthDate = row[headers.birthDate] || '';
        if (typeof birthDate === 'number') {
            const date = new Date((birthDate - 25569) * 86400 * 1000);
            birthDate = date.toISOString().split('T')[0];
        }
        importedData.push({
            id: importedData.length + 1, code: String(row[headers.code] || ''),
            familyName: String(row[headers.familyName] || ''), firstName: String(row[headers.firstName] || ''),
            gender: String(row[headers.gender] || ''), birthDate: String(birthDate),
            birthPlace: String(row[headers.birthPlace] || '-'), section: sheetName
        });
    }
    if (importedData.length === 0) { showToast('لم يتم العثور على بيانات', 'error'); resetModal(); return; }
    showPreview();
}

function showPreview() {
    document.getElementById('import-progress').style.display = 'none';
    document.getElementById('import-preview').style.display = 'block';
    const previewRows = importedData.slice(0, 10);

    // Count unique sections
    const sections = [...new Set(importedData.map(s => s.section))];
    const sectionCount = sections.length;

    document.getElementById('preview-table').innerHTML = `
        <thead><tr><th>الرقم</th><th>القسم</th><th>الرمز</th><th>النسب</th><th>الاسم</th><th>النوع</th></tr></thead>
        <tbody>${previewRows.map(s => `<tr><td>${s.id}</td><td>${s.section}</td><td>${s.code}</td><td>${s.familyName}</td><td>${s.firstName}</td><td>${s.gender}</td></tr>`).join('')}</tbody>`;

    const sectionInfo = sectionCount > 1 ? ` - ${sectionCount} أقسام` : '';
    document.querySelector('#import-preview h4').textContent = `معاينة البيانات (${importedData.length} تلميذ${sectionInfo})`;
}

function refreshDashboard() { renderStatsCards(); renderCharts(); renderMovement(); renderStudentsTable(); }

// ===== وظائف الأزرار =====

// زر الصفحة الرئيسية - إعادة تحميل لوحة التحكم
function goToHome() {
    refreshDashboard();
    // إظهار جميع الأقسام
    document.getElementById('stats-section').style.display = 'block';
    document.getElementById('charts-section').style.display = 'block';
    document.getElementById('movement-section').style.display = 'block';
    document.getElementById('table-section').style.display = 'block';
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
function printTable() {
    const tableSection = document.getElementById('table-section');
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <meta charset="UTF-8">
            <title>طباعة لائحة التلاميذ</title>
            <style>
                body { font-family: 'Tajawal', Arial, sans-serif; direction: rtl; padding: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #333; padding: 8px; text-align: center; }
                th { background: #8b0000; color: white; }
                h1 { text-align: center; color: #8b0000; }
                .print-header { text-align: center; margin-bottom: 20px; }
                @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
            </style>
        </head>
        <body>
            <div class="print-header">
                <h1>الثانوية التأهيلية ابن سينا</h1>
                <h2>لائحة التلاميذ - ${currentSchoolYear}</h2>
            </div>
            ${tableSection.querySelector('.table-wrapper').innerHTML}
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
}

// زر تصدير إلى Excel
function exportToExcel() {
    if (studentsData.length === 0) {
        showToast('لا توجد بيانات للتصدير', 'error');
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
function printChart(chartId, title) {
    const canvas = document.getElementById(chartId);
    if (!canvas) return;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <meta charset="UTF-8">
            <title>${title}</title>
            <style>
                body { font-family: 'Tajawal', Arial, sans-serif; direction: rtl; padding: 20px; text-align: center; }
                h1 { color: #8b0000; }
                img { max-width: 100%; margin-top: 20px; }
            </style>
        </head>
        <body>
            <h1>الثانوية التأهيلية ابن سينا</h1>
            <h2>${title}</h2>
            <img src="${canvas.toDataURL('image/png')}" alt="${title}">
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
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
