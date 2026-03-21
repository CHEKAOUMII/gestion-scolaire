const ROUTING_RULES = {
    'student.enrolled': ['toast', 'center'],
    'student.updated': ['toast'],
    'student.deleted': ['toast'],
    'student.imported': ['toast', 'center'],
    'absence.recorded': ['toast'],
    'absence.threshold': ['toast', 'center', 'native'],
    'grade.saved': ['toast'],
    'grade.published': ['toast', 'center'],
    'backup.completed': ['toast'],
    'backup.failed': ['toast', 'center', 'native'],
    'backup.restored': ['toast', 'center'],
    'exam.scheduled': ['center'],
    'exam.proctor.assigned': ['toast', 'center'],
    'update.available': ['toast', 'center'],
    'update.downloaded': ['toast', 'native'],
    'license.expiring': ['toast', 'center', 'native'],
    'license.activated': ['toast', 'center'],
    'auth.login': ['toast'],
    'auth.logout': ['toast'],
    'system.error': ['toast', 'center']
};

const SEVERITY_ESCALATION = {
    error: ['center', 'native'],
    warning: ['center']
};

function resolveChannels(type, severity) {
    let channels = null;

    // Exact match first
    if (ROUTING_RULES[type]) {
        channels = [...ROUTING_RULES[type]];
    } else {
        // Wildcard prefix match: 'student.enrolled' matches 'student.*'
        for (const [pattern, chs] of Object.entries(ROUTING_RULES)) {
            if (!pattern.includes('*')) continue;
            const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
            if (regex.test(type)) {
                channels = [...chs];
                break;
            }
        }
    }

    // Default fallback
    if (!channels) {
        channels = ['toast'];
    }

    // Severity escalation
    const escalation = SEVERITY_ESCALATION[severity];
    if (escalation) {
        for (const ch of escalation) {
            if (!channels.includes(ch)) channels.push(ch);
        }
    }

    return channels;
}

module.exports = { resolveChannels };
