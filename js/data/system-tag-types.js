/**
 * System Tag Types — Centralized Definition
 *
 * Single source of truth for all system tag categories used across the app.
 * Consumed by: staff-daily-report.html, tracking-teachers-performance.html, etc.
 *
 * Each entry:
 *   key   — unique DB identifier (stored in system_tags.tag_key)
 *   label — Arabic display name (stored in system_tags.tag_label)
 *   icon  — emoji prefix for UI display
 */
const ALL_TAG_TYPES = [
    { key: 'educational_activity', label: 'نشاط تربوي', icon: '🎓' },
    { key: 'meeting',              label: 'اجتماع',      icon: '📋' },
    { key: 'competition',          label: 'مسابقة',      icon: '🏆' },
    { key: 'training',             label: 'تكوين / ورشة', icon: '📝' },
    { key: 'inspection',           label: 'زيارة تفتيشية', icon: '🔍' },
    { key: 'field_trip',           label: 'خرجة دراسية',  icon: '📍' },
    { key: 'early_release',        label: 'خروج مبكر',    icon: '⏰' },
    { key: 'short_session',        label: 'حصة ناقصة',   icon: '📉' },
    { key: 'cancelled_session',    label: 'إلغاء حصة',   icon: '🚫' },
    { key: 'cultural_activity',    label: 'نشاط ثقافي',  icon: '🎭' },
    { key: 'sports_activity',      label: 'نشاط رياضي',  icon: '🏃' },
    { key: 'other',                label: 'أخرى',        icon: '📌' }
];
