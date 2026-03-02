const { getIdentity, getAssetBase64 } = require('./identity');

/**
 * Renders the official, locked document letterhead.
 * Assembled server-side — renderer pages never touch this.
 *
 * @param {object} [overrides]
 * @param {string} [overrides.documentTitle] - e.g. "شهادة التمدرس"
 * @param {string} [overrides.documentRef]   - e.g. "CERT-2026-A3F2B1"
 * @returns {string} HTML
 */
function renderLetterhead(overrides = {}) {
    const id = getIdentity();
    const logo = getAssetBase64('logo_base64');
    const documentTitle = overrides.documentTitle || '';
    const documentRef = overrides.documentRef || '';

    return `
    <div class="doc-letterhead" style="
        border-bottom: 2.5px solid #3B6AC5;
        padding-bottom: 10px;
        margin-bottom: 14px;
        page-break-inside: avoid;
    ">
        <table style="width: 100%; border-collapse: collapse;" role="presentation">
            <tr>
                <!-- Right column: Ministry hierarchy (RTL) -->
                <td style="width: 45%; vertical-align: middle; text-align: center; padding: 0;">
                    <div style="font-size: 11px; font-weight: 700; color: #222;">${esc(id.country)}</div>
                    <div style="font-size: 9.5px; color: #555; margin-top: 2px;">${esc(id.ministry)}</div>
                    ${id.academy ? `<div style="font-size: 9px; color: #666; margin-top: 2px;">${esc(id.academy)}</div>` : ''}
                    ${id.directorate ? `<div style="font-size: 9px; color: #666; margin-top: 1px;">${esc(id.directorate)}</div>` : ''}
                </td>

                <!-- Center column: Logo -->
                <td style="width: 10%; text-align: center; vertical-align: middle;">
                    ${logo
            ? `<img src="data:image/png;base64,${logo}" style="max-width: 300px; max-height: 300px;" alt="logo">`
            : '<div style="width: 52px; height: 52px; border: 1px dashed #ccc; border-radius: 50%; margin: 0 auto;"></div>'
        }
                </td>

                <!-- Left column: School identity -->
                <td style="width: 45%; vertical-align: middle; text-align: center; padding: 0;">
                    <div style="font-size: 13px; font-weight: 800; color: #3B6AC5;">${esc(id.school_name)}</div>
                    ${id.school_code ? `<div style="font-size: 9px; color: #888; margin-top: 2px;">رمز المؤسسة: ${esc(id.school_code)}</div>` : ''}
                    ${documentRef ? `<div style="font-size: 9px; color: #888; margin-top: 1px;">المرجع: ${esc(documentRef)}</div>` : ''}
                    ${overrides.schoolYear ? `<div style="font-size: 9px; color: #888; margin-top: 1px;">السنة الدراسية: ${esc(overrides.schoolYear)}</div>` : ''}
                </td>
            </tr>
        </table>

        ${documentTitle ? `
        <div style="text-align: center; margin-top: 12px;">
            <div style="
                display: inline-block;
                padding: 7px 30px;
                border: 2px solid #3B6AC5;
                border-radius: 8px;
            ">
                <div style="font-size: 17px; font-weight: 800; color: #3B6AC5;">${esc(documentTitle)}</div>
            </div>
        </div>` : ''}
    </div>`;
}

function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

module.exports = { renderLetterhead };
