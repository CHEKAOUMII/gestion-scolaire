const TEMPLATES = {
    'student.enrolled': {
        toast: { message: 'تم تسجيل التلميذ {{studentName}} في {{className}}' },
        center: { title: 'تسجيل جديد', body: 'تم تسجيل {{studentName}} في {{className}}', icon: 'fa-user-plus' },
        native: { title: 'تسجيل جديد', body: '{{studentName}} — {{className}}' },
    },
    'student.updated': {
        toast: { message: 'تم تحديث بيانات التلميذ {{studentName}}' },
    },
    'student.deleted': {
        toast: { message: 'تم حذف التلميذ {{studentName}}' },
        center: { title: 'حذف تلميذ', body: 'تم حذف {{studentName}}', icon: 'fa-user-minus' },
    },
    'student.imported': {
        toast: { message: 'تم استيراد {{count}} تلميذ بنجاح' },
        center: { title: 'استيراد التلاميذ', body: 'تم استيراد {{count}} تلميذ', icon: 'fa-file-import' },
    },
    'absence.recorded': {
        toast: { message: 'تم تسجيل الغياب' },
    },
    'absence.threshold': {
        toast: { message: 'تنبيه: {{studentName}} وصل إلى {{count}} غيابات من أصل {{max}}', duration: 5000 },
        center: {
            title: 'تنبيه غياب',
            body: '{{studentName}} — {{count}}/{{max}} غيابات',
            icon: 'fa-exclamation-triangle',
        },
        native: { title: 'تنبيه غياب', body: '{{studentName}} — {{count}} غيابات' },
    },
    'grade.saved': {
        toast: { message: 'تم حفظ النقط بنجاح' },
    },
    'grade.published': {
        toast: { message: 'تم نشر نقط {{className}} — {{subjectName}}' },
        center: { title: 'نشر النقط', body: '{{className}} — {{subjectName}}', icon: 'fa-chart-bar' },
    },
    'backup.completed': {
        toast: { message: 'تم إنشاء النسخة الاحتياطية بنجاح' },
    },
    'backup.failed': {
        toast: { message: 'فشل إنشاء النسخة الاحتياطية: {{error}}' },
        center: { title: 'فشل النسخ الاحتياطي', body: '{{error}}', icon: 'fa-exclamation-circle' },
        native: { title: 'فشل النسخ الاحتياطي', body: '{{error}}' },
    },
    'backup.restored': {
        toast: { message: 'تم استعادة النسخة الاحتياطية بنجاح' },
        center: { title: 'استعادة النسخة', body: 'تم استعادة النسخة الاحتياطية', icon: 'fa-undo' },
    },
    'exam.scheduled': {
        center: { title: 'جدولة امتحان', body: '{{examName}} — {{date}}', icon: 'fa-calendar-check' },
    },
    'exam.proctor.assigned': {
        toast: { message: 'تم تعيين الحراس للامتحان' },
        center: { title: 'تعيين الحراس', body: '{{examName}}', icon: 'fa-user-shield' },
    },
    'update.available': {
        toast: { message: 'يتوفر تحديث جديد: الإصدار {{version}}', duration: 5000 },
        center: { title: 'تحديث متوفر', body: 'الإصدار {{version}} جاهز للتنزيل', icon: 'fa-download' },
    },
    'update.downloaded': {
        toast: { message: 'تم تنزيل التحديث. أعد التشغيل للتثبيت', duration: 8000 },
        native: { title: 'تحديث جاهز', body: 'أعد تشغيل التطبيق لتثبيت الإصدار {{version}}' },
    },
    'license.expiring': {
        toast: { message: 'تنبيه: الرخصة تنتهي خلال {{days}} يوم', duration: 5000 },
        center: { title: 'انتهاء الرخصة', body: 'الرخصة تنتهي خلال {{days}} يوم', icon: 'fa-key' },
        native: { title: 'انتهاء الرخصة', body: 'تبقى {{days}} يوم' },
    },
    'license.activated': {
        toast: { message: 'تم تفعيل الرخصة بنجاح' },
        center: { title: 'تفعيل الرخصة', body: 'تم تفعيل خطة {{plan}}', icon: 'fa-check-circle' },
    },
    'auth.login': {
        toast: { message: 'مرحبا {{userName}}' },
    },
    'auth.logout': {
        toast: { message: 'تم تسجيل الخروج' },
    },
    'system.error': {
        toast: { message: 'خطأ في النظام: {{error}}', duration: 5000 },
        center: { title: 'خطأ في النظام', body: '{{error}}', icon: 'fa-exclamation-circle' },
    },
};

const FALLBACK = {
    toast: { message: '{{message}}' },
    center: { title: '{{title}}', body: '{{message}}', icon: 'fa-bell' },
    native: { title: '{{title}}', body: '{{message}}' },
};

function interpolate(template, data) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const val = data[key];
        return val !== undefined && val !== null ? String(val) : '';
    });
}

function renderTemplate(type, channel, payload, _severity) {
    const tmplSet = TEMPLATES[type] || FALLBACK;
    const tmpl = tmplSet[channel] || FALLBACK[channel];

    if (!tmpl) {
        return { message: payload.message || type };
    }

    const rendered = {};
    for (const [key, val] of Object.entries(tmpl)) {
        rendered[key] = typeof val === 'string' ? interpolate(val, payload) : val;
    }
    return rendered;
}

module.exports = { renderTemplate, TEMPLATES };
