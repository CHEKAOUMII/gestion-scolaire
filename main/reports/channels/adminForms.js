/**
 * Admin form body templates for the unified report engine.
 * Each function returns bodyHTML — the engine wraps it with
 * letterhead, footer, security bar, and watermark.
 */

function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const fieldStyle = 'border-bottom: 1.5px dotted #999; min-width: 140px; display: inline-block; padding: 2px 6px; font-weight: 600; color: #222;';
const labelStyle = 'font-size: 11px; color: #444; margin-left: 4px;';
const sectionStyle = 'margin-bottom: 14px;';
const rowStyle = 'display: flex; flex-wrap: wrap; gap: 8px 24px; margin-bottom: 10px; font-size: 11px; line-height: 2;';
const headingStyle = 'font-size: 12px; font-weight: 700; color: #3B6AC5; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; margin-bottom: 10px;';
const signatureBoxStyle = 'display: inline-block; width: 180px; text-align: center; margin-top: 30px;';
const signatureLineStyle = 'border-top: 1px solid #888; margin-top: 40px; padding-top: 4px; font-size: 10px; color: #555;';

function field(label, value) {
    return `<span style="${labelStyle}">${esc(label)}:</span> <span style="${fieldStyle}">${esc(value)}</span>`;
}

function signatureBlock(label) {
    return `<div style="${signatureBoxStyle}">
        <div style="${signatureLineStyle}">${esc(label)}</div>
    </div>`;
}

/**
 * Registration form — student enrollment
 */
function buildRegistrationFormHTML(d) {
    return `
    <div style="${sectionStyle}">
        <div style="${headingStyle}">معلومات التلميذ(ة)</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.studentName)}
            ${field('رمز مسار', d.massarCode)}
        </div>
        <div style="${rowStyle}">
            ${field('تاريخ الازدياد', d.birthDate)}
            ${field('مكان الازدياد', d.birthPlace)}
        </div>
        <div style="${rowStyle}">
            ${field('الجنس', d.gender)}
            ${field('الجنسية', d.nationality || 'مغربية')}
        </div>
        <div style="${rowStyle}">
            ${field('القسم', d.className)}
            ${field('السنة الدراسية', d.schoolYear)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">معلومات ولي الأمر</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.guardianName)}
            ${field('رقم الهاتف', d.guardianPhone)}
        </div>
        <div style="${rowStyle}">
            ${field('العنوان', d.address)}
        </div>
    </div>

    <div style="display: flex; justify-content: space-between; margin-top: 20px;">
        ${signatureBlock('توقيع ولي الأمر')}
        ${signatureBlock('توقيع المدير(ة)')}
    </div>`;
}

/**
 * Transfer form — student moving between schools
 */
function buildTransferFormHTML(d) {
    return `
    <div style="${sectionStyle}">
        <div style="${headingStyle}">معلومات التلميذ(ة)</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.studentName)}
            ${field('رمز مسار', d.massarCode)}
        </div>
        <div style="${rowStyle}">
            ${field('تاريخ الازدياد', d.birthDate)}
            ${field('القسم', d.className)}
        </div>
        <div style="${rowStyle}">
            ${field('السنة الدراسية', d.schoolYear)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">تفاصيل الانتقال</div>
        <div style="${rowStyle}">
            ${field('المؤسسة الأصلية', d.originSchool)}
        </div>
        <div style="${rowStyle}">
            ${field('المؤسسة المستقبلة', d.destinationSchool)}
        </div>
        <div style="${rowStyle}">
            ${field('سبب الانتقال', d.reason)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">موافقة ولي الأمر</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.guardianName)}
        </div>
    </div>

    <div style="display: flex; justify-content: space-between; margin-top: 20px;">
        ${signatureBlock('توقيع ولي الأمر')}
        ${signatureBlock('توقيع مدير(ة) المؤسسة الأصلية')}
        ${signatureBlock('توقيع مدير(ة) المؤسسة المستقبلة')}
    </div>`;
}

/**
 * Dropout declaration form
 */
function buildDropoutFormHTML(d) {
    return `
    <div style="${sectionStyle}">
        <div style="${headingStyle}">معلومات التلميذ(ة)</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.studentName)}
            ${field('رمز مسار', d.massarCode)}
        </div>
        <div style="${rowStyle}">
            ${field('القسم', d.className)}
            ${field('السنة الدراسية', d.schoolYear)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">تفاصيل الانقطاع</div>
        <div style="${rowStyle}">
            ${field('آخر يوم حضور', d.lastAttendanceDate)}
        </div>
        <div style="${rowStyle}">
            ${field('سبب الانقطاع', d.reason)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">ولي الأمر</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.guardianName)}
            ${field('رقم الهاتف', d.guardianPhone)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="font-size: 10px; color: #666; border: 1px solid #e0e0e0; border-radius: 6px; padding: 8px; background: #fafafa;">
            <b>ملاحظة:</b> تم إشعار ولي الأمر بانقطاع التلميذ(ة) عن الدراسة وفقا للمقتضيات القانونية المعمول بها.
        </div>
    </div>

    <div style="display: flex; justify-content: space-between; margin-top: 20px;">
        ${signatureBlock('توقيع ولي الأمر')}
        ${signatureBlock('توقيع المدير(ة)')}
    </div>`;
}

/**
 * Absence justification form
 */
function buildAbsenceJustificationHTML(d) {
    return `
    <div style="${sectionStyle}">
        <div style="${headingStyle}">معلومات التلميذ(ة)</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.studentName)}
            ${field('رمز مسار', d.massarCode)}
        </div>
        <div style="${rowStyle}">
            ${field('القسم', d.className)}
            ${field('السنة الدراسية', d.schoolYear)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">تفاصيل الغياب</div>
        <div style="${rowStyle}">
            ${field('من تاريخ', d.absenceFrom)}
            ${field('إلى تاريخ', d.absenceTo)}
        </div>
        <div style="${rowStyle}">
            ${field('عدد الأيام', d.totalDays)}
        </div>
        <div style="${rowStyle}">
            ${field('سبب الغياب', d.reason)}
        </div>
    </div>

    <div style="${sectionStyle}">
        <div style="${headingStyle}">ولي الأمر</div>
        <div style="${rowStyle}">
            ${field('الاسم الكامل', d.guardianName)}
            ${field('رقم الهاتف', d.guardianPhone)}
        </div>
    </div>

    <div style="display: flex; justify-content: space-between; margin-top: 20px;">
        ${signatureBlock('توقيع ولي الأمر')}
        ${signatureBlock('توقيع المدير(ة)')}
    </div>`;
}

/** Map of form type keys to builder functions and default titles */
const FORM_BUILDERS = {
    registration: { build: buildRegistrationFormHTML, title: 'استمارة تسجيل التلاميذ' },
    transfer:     { build: buildTransferFormHTML,     title: 'استمارة الانتقال' },
    dropout:      { build: buildDropoutFormHTML,      title: 'استمارة الانقطاع' },
    absence:      { build: buildAbsenceJustificationHTML, title: 'استمارة تبرير الغياب' }
};

module.exports = {
    FORM_BUILDERS,
    buildRegistrationFormHTML,
    buildTransferFormHTML,
    buildDropoutFormHTML,
    buildAbsenceJustificationHTML
};
