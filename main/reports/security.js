const crypto = require('crypto');

/**
 * Generates a verification security bar for any printed document.
 *
 * @param {object} params
 * @param {string} params.documentType - e.g. 'certificate', 'semester_report'
 * @param {string} params.documentRef  - Unique reference number
 * @param {string} params.studentName  - For hash input
 * @param {string} params.issuedAt     - ISO date string
 * @returns {{ html: string, hash: string, ref: string }}
 */
function generateSecurityBar(params) {
    const { documentType, documentRef, studentName, issuedAt } = params;

    const hashInput = [documentType, documentRef, studentName, issuedAt].join('|');
    const fullHash = crypto.createHash('sha256').update(hashInput, 'utf-8').digest('hex');
    const shortHash = fullHash.substring(0, 16).toUpperCase();

    const qrPayload = `DOC:${documentRef}|HASH:${shortHash}`;

    const html = `
    <div class="doc-security-bar" style="
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
        border: 1px solid #cfd8df;
        border-radius: 6px;
        padding: 6px 10px;
        margin-top: 8px;
        background: linear-gradient(180deg, #f8fbfd, #eef4f8);
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        page-break-inside: avoid;
        font-family: 'Noto Kufi Arabic', 'IBM Plex Sans Arabic', sans-serif;
    ">
        <div style="display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 9px; color: #1f2f3a;">
            <span>النوع: <b>${esc(documentType)}</b></span>
            <span>المرجع: <b style="direction: ltr; font-family: Consolas, monospace;">${esc(documentRef)}</b></span>
            <span>التاريخ: <b>${esc(issuedAt)}</b></span>
            <span>رمز التحقق: <b style="direction: ltr; font-family: Consolas, monospace; letter-spacing: 0.05em;">${shortHash}</b></span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; border-right: 1px dashed #b8c5cf; padding-right: 10px;">
            <div id="qr-${esc(documentRef)}" style="width: 48px; height: 48px;"></div>
        </div>
    </div>
    <script>
        (function() {
            if (typeof QRCode !== 'undefined') {
                new QRCode(document.getElementById('qr-${escJs(documentRef)}'), {
                    text: '${escJs(qrPayload)}',
                    width: 48, height: 48, colorDark: '#1a2e3b', colorLight: '#ffffff'
                });
            }
        })();
    </script>`;

    return { html, hash: shortHash, ref: documentRef };
}

/**
 * Generates a sequential document reference number.
 * @param {string} type - Document type key
 * @returns {string}
 */
function generateDocumentRef(type) {
    const year = new Date().getFullYear();
    const seq = crypto.randomBytes(3).toString('hex').toUpperCase();
    const prefix = {
        certificate: 'CERT',
        semester_report: 'SEM',
        correspondence: 'COR',
        grade_report: 'GRD',
        absence_report: 'ABS',
        timetable: 'TBL',
        student_list: 'LST',
        admin_form: 'FRM'
    };
    return `${prefix[type] || 'DOC'}-${year}-${seq}`;
}

/**
 * Generates a diagonal watermark overlay.
 * @param {string} text
 * @returns {string} HTML
 */
function renderWatermark(text) {
    return `
    <div class="doc-watermark" style="
        position: fixed; inset: 0;
        display: grid; place-items: center;
        pointer-events: none; z-index: 0;
    ">
        <span style="
            font-size: 50px; letter-spacing: 0.14em; font-weight: 800;
            color: rgba(25, 55, 72, 0.035); transform: rotate(-28deg);
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
        ">${esc(text)}</span>
    </div>`;
}

function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escJs(s) {
    return String(s || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"');
}

module.exports = { generateSecurityBar, generateDocumentRef, renderWatermark };
