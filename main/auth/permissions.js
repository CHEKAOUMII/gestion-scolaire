// main/auth/permissions.js
// Single source of truth for page-level access control.
// 'developer' and 'admin' bypass all checks (handled in canAccessPage).
// 'principal' can access settings-users to manage institution users.

const ALL_STAFF = [
    'principal', 'supervisor', 'external-guardian', 'internal-guardian',
    'admin-assistant', 'educational-specialist', 'social-specialist', 'teacher', 'viewer',
];

// All valid role slugs that can be stored in the DB (excludes 'developer' — never stored).
const ALLOWED_ROLES = [
    'admin', 'principal', 'supervisor', 'external-guardian', 'internal-guardian',
    'admin-assistant', 'educational-specialist', 'social-specialist', 'teacher', 'viewer',
];

// Map of role slug → Arabic display label for UI.
const ROLE_LABELS = {
    'developer':            'مطوّر التطبيق',
    'admin':                'مدير التطبيق',
    'principal':            'مدير المؤسسة',
    'supervisor':           'الناظر',
    'external-guardian':    'الحارس العام للخارجية',
    'internal-guardian':    'الحارس العام للداخلية',
    'admin-assistant':      'مساعد إداري',
    'educational-specialist':'مختص تربوي',
    'social-specialist':    'مختص اجتماعي',
    'teacher':              'أستاذ',
    'viewer':               'مشاهد فقط',
};

// Aliases: legacy role slugs stored in DB rows resolve to current slugs.
// 'staff' → 'principal': safety net before migration 050 runs (prevents lockout).
const ROLE_ALIASES = { director: 'principal', staff: 'principal' };

const PAGE_PERMISSIONS = {
    'index':                         [...ALL_STAFF],
    'students-list':                 [...ALL_STAFF],
    'students-files':                [...ALL_STAFF],
    'students-register':             ['principal','supervisor','external-guardian','admin-assistant'],
    'students-movement':             ['principal','supervisor','external-guardian','admin-assistant'],
    'students-status':               ['principal','supervisor','external-guardian','admin-assistant'],
    'student-profile-prototype':     [...ALL_STAFF],
    'student-support':               ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'absence-students':              [...ALL_STAFF],
    'absence-weekly':                [...ALL_STAFF],
    'absence-analytics':             [...ALL_STAFF],
    'absence-correspondence':        ['principal','supervisor','external-guardian','internal-guardian','admin-assistant'],
    'grades-sheets':                 ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'grades-results':                ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'results-hub':                   ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'exams-schedule':                ['principal','supervisor','external-guardian','admin-assistant','educational-specialist','teacher','viewer'],
    'exams-rooms':                   ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'exams-proctors':                ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'exams-tests':                   ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'teachers-list':                 ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','viewer'],
    'inspectors':                    ['principal','supervisor','external-guardian'],
    'teachers-schedule':             ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'teachers-performance':          ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'teachers-absence':              ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','viewer'],
    'staff-attendance':              ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','viewer'],
    'staff-daily-report':            ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','viewer'],
    'timetable':                     [...ALL_STAFF],
    'timetable-teachers':            ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'timetable-students':            [...ALL_STAFF],
    'timetable-rooms':               ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'timetable-redistribution':      ['principal','supervisor','admin-assistant'],
    'compensation-tracking':         ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'tracking-teachers-performance': ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'analytics':                     ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'reports-forms':                 ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist'],
    'reports-certificates':          ['principal','supervisor','external-guardian','admin-assistant'],
    'reports-semester':              ['principal','supervisor','external-guardian','admin-assistant','educational-specialist'],
    'settings-school':               ['principal','external-guardian'],
    'settings-imports':              ['principal','supervisor','external-guardian'],
    'settings-users':                ['principal'], // principal manages institution users; admin + developer bypass
    'app-admin':                     [], // app admin only — admin + developer bypass
    'settings-license':              [], // developer only — bypass; admin excluded by design
    'settings-logs':                 [], // developer only — bypass; admin excluded by design
    'settings-sync':                 ['principal','supervisor','external-guardian'],
};

// Scoped restrictions applied on top of page access (enforced individually in each IPC handler).
const SCOPED_ROLES = {
    'internal-guardian': { absences: { absence_type: 'internal' } },
    'teacher':           { grades: 'by-section', absences: 'by-section' },
};

function resolveRole(role) {
    return ROLE_ALIASES[role] || role;
}

function canAccessPage(role, pageKey) {
    const r = resolveRole(role);
    if (r === 'developer' || r === 'admin') return true;
    return (PAGE_PERMISSIONS[pageKey] || []).includes(r);
}

function getAllowedPages(role) {
    const r = resolveRole(role);
    if (r === 'developer' || r === 'admin') return Object.keys(PAGE_PERMISSIONS);
    return Object.keys(PAGE_PERMISSIONS).filter((p) => PAGE_PERMISSIONS[p].includes(r));
}

module.exports = { PAGE_PERMISSIONS, SCOPED_ROLES, ALLOWED_ROLES, ROLE_LABELS, ROLE_ALIASES, canAccessPage, getAllowedPages, resolveRole };
