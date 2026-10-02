/**
 * Exam proctors distribution wizard step labels (WP7 extraction).
 * Classic script: exposes window.ExamProctorsStepLabels
 */
(function (global) {
    'use strict';

    const DISTRIBUTION_STEP_LABELS = {
        'proctors-data': 'لائحة المراقبين',
        participants: 'المشاركون الإضافيون',
        'exemptions-duty': 'الإعفاءات والمداومة',
        periods: 'تحديد فترات الامتحان',
        'morning-evening': 'توزيع المجموعتين المتناوبتين',
        'proctors-per-room': 'عدد المراقبين في كل قاعة',
        'reserves-per-session': 'عدد الاحتياطي في كل حصة',
        reserves: 'لائحة الاحتياطيين',
        'manual-adjust': 'التعديل اليدوي',
        'auto-distribute': 'التوزيع الآلي'
    };

    function getDistributionStepLabel(stepKey) {
        return DISTRIBUTION_STEP_LABELS[stepKey] || stepKey || '';
    }

    global.ExamProctorsStepLabels = {
        DISTRIBUTION_STEP_LABELS,
        getDistributionStepLabel
    };
})(typeof window !== 'undefined' ? window : globalThis);
